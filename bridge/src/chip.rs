//! The chips that the bridge runs, and the pin setup that esp32sim does not
//! report.

use emu_core::Bus;
use esp_periph::AnalogSource;
use esp_soc::{Board, Machine, Soc, SocBus, Stop};

use crate::Mode;

/// A chip that esp32sim emulates.
pub(crate) trait Chip: Soc + Sized {
    /// The addresses of GPIO_PIN0_REG and GPIO_FUNC0_OUT_SEL_CFG_REG.
    const PIN_REG: u32;
    const OUT_SEL_REG: u32;
    /// The OUT_SEL bits of GPIO_FUNCn_OUT_SEL_CFG_REG, and the OUT_SEL value
    /// that gives a pad to GPIO_OUT, not to a peripheral.
    const OUT_SEL_MASK: u32;
    const GPIO_OUT_SIGNAL: u32;

    /// A machine that calls `board` at each GPIO change.
    fn machine(board: Board) -> Machine<Self>;

    /// Whether a GPIO can connect to the circuit. Some GPIOs are not on the
    /// chip, and some connect to the flash or PSRAM chip.
    fn usable(gpio: u8) -> bool;

    /// Pulls that `SocBus::gpio_state` does not report, as (up, down).
    fn hidden_pulls(_bus: &mut Self::Bus, _gpio: u8) -> (bool, bool) {
        (false, false)
    }
}

/// A booted chip. The bridge picks the chip from diagram.json at run time,
/// so it uses the chip through this trait.
pub(crate) trait Esp {
    fn hz(&self) -> u64;
    fn cycles(&self) -> u64;
    /// Runs to `end` cycles or a stop before it.
    fn run(&mut self, end: u64) -> Stop;
    fn reboot(&mut self);
    /// Moves the UART0 output to `out`.
    fn take_serial(&mut self, out: &mut Vec<u8>);
    fn serial_input(&mut self, data: &[u8]);
    fn mode(&mut self, gpio: u8) -> Mode;
    fn set_analog(&mut self, gpio: u8, volts: f64);
    /// A word of memory, or None if the address faults.
    fn read_word(&mut self, addr: u32) -> Option<u32>;
}

impl<S: Chip> Esp for Machine<S> {
    fn hz(&self) -> u64 {
        S::CPU_HZ
    }

    fn cycles(&self) -> u64 {
        self.bus.cycles()
    }

    fn run(&mut self, end: u64) -> Stop {
        self.max_cycles = end;
        Machine::run(self, u64::MAX)
    }

    fn reboot(&mut self) {
        Machine::reboot(self);
    }

    fn take_serial(&mut self, out: &mut Vec<u8>) {
        out.append(&mut self.console.uart0);
    }

    fn serial_input(&mut self, data: &[u8]) {
        self.bus.uart_input(0, data);
    }

    fn mode(&mut self, gpio: u8) -> Mode {
        let bus = &mut self.bus;
        let mut mode = Mode::default();
        if let Some(state) = bus.gpio_state(gpio) {
            mode.out = state.output;
            mode.out_enable = state.output_enable;
            mode.pull_up = state.pull_up;
            mode.pull_down = state.pull_down;
        }
        // PAD_DRIVER is bit 2 of GPIO_PINn_REG on each chip.
        let pin_reg = bus.read32_unpriced(S::PIN_REG + 4 * u32::from(gpio));
        mode.open_drain = pin_reg.is_ok_and(|v| v & 1 << 2 != 0);
        let out_sel = bus.read32_unpriced(S::OUT_SEL_REG + 4 * u32::from(gpio));
        mode.peripheral = out_sel.is_ok_and(|v| v & S::OUT_SEL_MASK != S::GPIO_OUT_SIGNAL);
        let (up, down) = S::hidden_pulls(bus, gpio);
        mode.pull_up |= up;
        mode.pull_down |= down;
        mode.pwm = bus
            .pwm_output(gpio)
            .map(|(hz, duty)| (hz, f64::from(duty) / 65535.0));
        mode
    }

    fn set_analog(&mut self, gpio: u8, volts: f64) {
        self.bus.analog_set(gpio, AnalogSource::Const(volts as f32));
    }

    fn read_word(&mut self, addr: u32) -> Option<u32> {
        self.bus.read32_unpriced(addr).ok()
    }
}

/// Boots a chip with a board model, a flash image and a mask ROM ELF.
type Boot = fn(Board, &[u8], &[u8]) -> Result<Box<dyn Esp>, String>;

/// How to boot the chip of a board.
pub(crate) struct ChipEntry {
    pub rom_elf: &'static str,
    pub hz: u64,
    pub usable: fn(u8) -> bool,
    pub boot: Boot,
}

/// The chip on a board part type, such as "board-esp32-devkit-c-v4".
pub(crate) fn for_board(kind: &str) -> Option<ChipEntry> {
    match kind {
        "board-esp32-devkit-c-v4" | "wokwi-esp32-devkit-v1" => Some(entry::<esp32::Esp32>()),
        "board-esp32-s3-devkitc-1" => Some(entry::<esp32s3::S3>()),
        "board-esp32-c3-devkitm-1" => Some(entry::<esp32c3::C3>()),
        "board-esp32-c6-devkitc-1" => Some(entry::<esp32c6::C6>()),
        _ => None,
    }
}

fn entry<S: Chip>() -> ChipEntry {
    ChipEntry {
        rom_elf: S::ROM_ELF,
        hz: S::CPU_HZ,
        usable: S::usable,
        boot: boot::<S>,
    }
}

/// Loads a merged flash image and the mask ROM ELF, and boots from the ROM.
fn boot<S: Chip>(board: Board, flash: &[u8], rom: &[u8]) -> Result<Box<dyn Esp>, String> {
    let mut machine = S::machine(board);
    machine.load_rom(rom)?;
    esp_soc::load::check_flash_image::<S>(flash)?;
    machine.write_flash(0, flash)?;
    machine.console.capture = true;
    machine.boot_rom();
    Ok(Box::new(machine))
}

impl Chip for esp32::Esp32 {
    // From ESP-IDF v5.5.4 components/soc/esp32/register/soc/gpio_reg.h.
    const PIN_REG: u32 = 0x3ff4_4088;
    const OUT_SEL_REG: u32 = 0x3ff4_4530;
    const OUT_SEL_MASK: u32 = 0x1ff;
    const GPIO_OUT_SIGNAL: u32 = 256;

    fn machine(board: Board) -> Machine<Self> {
        let mut machine = esp32::machine([0x24, 0x6f, 0x28, 0x00, 0x11, 0x22], 4 << 20);
        machine.bus.board = board;
        machine.bus.attach_board_devices();
        machine
    }

    /// GPIO 6 to 11 connect to the flash chip.
    fn usable(gpio: u8) -> bool {
        gpio <= 39 && !(6..=11).contains(&gpio)
    }

    /// ESP-IDF sets the pulls of RTC pads in the RTC IO registers, not in
    /// IO_MUX, and esp32sim does not report them.
    fn hidden_pulls(bus: &mut Self::Bus, gpio: u8) -> (bool, bool) {
        let Some((offset, up, down)) = rtc_pulls(gpio) else {
            return (false, false);
        };
        let reg = bus.read32_unpriced(0x3ff4_8400 + offset).unwrap_or(0);
        (reg >> up & 1 != 0, reg >> down & 1 != 0)
    }
}

impl Chip for esp32s3::S3 {
    // From ESP-IDF v5.5.4 components/soc/esp32s3/register/soc/gpio_reg.h.
    const PIN_REG: u32 = 0x6000_4074;
    const OUT_SEL_REG: u32 = 0x6000_4554;
    const OUT_SEL_MASK: u32 = 0x1ff;
    const GPIO_OUT_SIGNAL: u32 = 256;

    fn machine(board: Board) -> Machine<Self> {
        let mut machine = esp32s3::machine([0x34, 0x85, 0x18, 0x00, 0x11, 0x22]);
        machine.bus.board = board;
        machine.bus.attach_board_devices();
        machine
    }

    /// GPIO 22 to 25 are not on the chip. GPIO 26 to 32 connect to the flash
    /// and PSRAM chips.
    fn usable(gpio: u8) -> bool {
        gpio <= 48 && !(22..=32).contains(&gpio)
    }
}

impl Chip for esp32c3::C3 {
    // From ESP-IDF v5.5.4 components/soc/esp32c3/register/soc/gpio_reg.h.
    const PIN_REG: u32 = 0x6000_4074;
    const OUT_SEL_REG: u32 = 0x6000_4554;
    const OUT_SEL_MASK: u32 = 0xff;
    const GPIO_OUT_SIGNAL: u32 = 128;

    fn machine(board: Board) -> Machine<Self> {
        let mut machine = esp32c3::machine([0x34, 0x85, 0x18, 0x00, 0x33, 0x44], 4 << 20);
        machine.bus.board = board;
        machine.bus.attach_board_devices();
        machine
    }

    /// GPIO 11 to 17 connect to the flash chip.
    fn usable(gpio: u8) -> bool {
        gpio <= 21 && !(11..=17).contains(&gpio)
    }
}

impl Chip for esp32c6::C6 {
    // From ESP-IDF v5.5.4 components/soc/esp32c6/register/soc/gpio_reg.h.
    const PIN_REG: u32 = 0x6009_1074;
    const OUT_SEL_REG: u32 = 0x6009_1554;
    const OUT_SEL_MASK: u32 = 0xff;
    const GPIO_OUT_SIGNAL: u32 = 128;

    fn machine(board: Board) -> Machine<Self> {
        let mut machine = esp32c6::machine([0x40, 0x4c, 0xca, 0x00, 0x55, 0x66], 8 << 20);
        machine.bus.board = board;
        machine.bus.attach_board_devices();
        machine
    }

    /// GPIO 24 to 30 connect to the flash chip.
    fn usable(gpio: u8) -> bool {
        gpio <= 23
    }
}

/// The RTC IO pull register of a pad as (offset, pull-up bit, pull-down bit).
/// From ESP-IDF v5.5.4 components/soc/esp32/register/soc/rtc_io_reg.h.
fn rtc_pulls(gpio: u8) -> Option<(u32, u32, u32)> {
    Some(match gpio {
        25 => (0x84, 27, 28),
        26 => (0x88, 27, 28),
        32 => (0x8c, 22, 23),
        33 => (0x8c, 27, 28),
        4 => (0x94, 27, 28),
        0 => (0x98, 27, 28),
        2 => (0x9c, 27, 28),
        15 => (0xa0, 27, 28),
        13 => (0xa4, 27, 28),
        12 => (0xa8, 27, 28),
        14 => (0xac, 27, 28),
        27 => (0xb0, 27, 28),
        _ => return None,
    })
}
