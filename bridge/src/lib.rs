//! Runs ESP32 firmware in esp32sim, in lockstep with a circuit simulation.
//!
//! The ESP32 is the clock. Each GPIO pin that is wired in diagram.json is a
//! board pin. The bridge gives the circuit the drive of each board pin when
//! it changes, at the exact emulated time. The circuit gives back the
//! voltage of each board pin. The bridge changes the voltages to GPIO input
//! levels and ADC inputs.

use std::cell::{RefCell, RefMut};
use std::rc::Rc;

use emu_core::Bus;
use esp_periph::AnalogSource;
use esp_soc::board::{BoardEdge, BoardModel};
use esp_soc::{SocBus, Stop};

pub mod circuit;
pub mod pins;

pub use circuit::{Circuit, DeferredCircuit, Drive, ProcessCircuit};

/// The name of the mask ROM file that the bridge boots from.
pub const ROM_ELF: &str = "esp32_rev300_rom.elf";

const CPU_HZ: u64 = 240_000_000;
/// How often the circuit catches up with the ESP32 when no pin changes.
/// GPIO reads see the circuit as of the last catch-up.
const STEP_CYCLES: u64 = CPU_HZ / 10_000;
/// How often the bridge reads the pin modes that the board callbacks do not
/// get. A GPIO read sees a new mode only after this delay.
const POLL_CYCLES: u64 = CPU_HZ / 1_000_000;
const VDD: f64 = 3.3;
/// Output resistance and pull resistance, from docs/circuit-format.md.
const OUTPUT_OHMS: f64 = 40.0;
const PULL_OHMS: f64 = 45_000.0;

/// An ESP32 that runs firmware against a circuit.
pub struct Bridge<C: Circuit> {
    machine: esp32::Machine,
    shared: Rc<RefCell<Shared<C>>>,
    serial: Vec<u8>,
}

impl<C: Circuit + 'static> Bridge<C> {
    /// Loads a merged flash image (bootloader at 0x1000, partition table at
    /// 0x8000, app at 0x10000) and the ESP32 mask ROM ELF, and boots from
    /// the ROM. `diagram` is the diagram.json text.
    pub fn new(diagram: &str, flash: &[u8], rom: &[u8], circuit: C) -> Result<Self, String> {
        let diagram = serde_json::from_str(diagram).map_err(|e| format!("diagram.json: {e}"))?;
        let pins: Vec<Pin> = pins::board_pins(&diagram)?
            .into_iter()
            .map(Pin::new)
            .collect();
        let names = pins.iter().map(|p| p.name.clone()).collect();
        let mut shared = Shared {
            circuit,
            pins,
            names,
            // Below 0, so that the first sync gets the voltages at 0.
            time: f64::NEG_INFINITY,
            next_sync: 0,
            dirty: false,
            edges: Vec::new(),
            error: None,
        };
        shared.sync(0);
        if let Some(e) = shared.error {
            return Err(e);
        }
        let shared = Rc::new(RefCell::new(shared));

        let mut machine = esp32::machine([0x24, 0x6f, 0x28, 0x00, 0x11, 0x22], 4 << 20);
        machine.bus.board = Box::new(Board(shared.clone()));
        machine.bus.attach_board_devices();
        machine.load_rom(rom)?;
        esp_soc::load::check_flash_image::<esp32::Esp32>(flash)?;
        machine.write_flash(0, flash)?;
        machine.console.capture = true;
        machine.boot_rom();
        Ok(Bridge {
            machine,
            shared,
            serial: Vec::new(),
        })
    }

    /// Runs for `seconds` of emulated time.
    pub fn run_for(&mut self, seconds: f64) -> Result<(), String> {
        let end = self.machine.bus.cycles() + (seconds * CPU_HZ as f64).round() as u64;
        while self.machine.bus.cycles() < end {
            self.machine.max_cycles = (self.machine.bus.cycles() + POLL_CYCLES).min(end);
            match self.machine.run(u64::MAX) {
                Stop::Halted => {}
                // A software or watchdog reset reboots the chip, as on a board.
                Stop::SwReset => {
                    self.machine.reboot();
                }
                stop => return Err(format!("the ESP32 stopped: {stop:?}")),
            }
            self.poll()?;
        }
        Ok(())
    }

    /// Runs until the serial output contains `text`, for at most `timeout`
    /// seconds. Returns whether the text came.
    pub fn run_until_serial(&mut self, text: &str, timeout: f64) -> Result<bool, String> {
        let end = self.time() + timeout;
        while !self.serial().contains(text) {
            if self.time() >= end {
                return Ok(false);
            }
            self.run_for(STEP_CYCLES as f64 / CPU_HZ as f64)?;
        }
        Ok(true)
    }

    /// Emulated time in seconds.
    pub fn time(&self) -> f64 {
        self.machine.seconds()
    }

    /// All UART0 output so far.
    pub fn serial(&self) -> String {
        String::from_utf8_lossy(&self.serial).into_owned()
    }

    /// All UART0 output so far, as bytes.
    pub fn serial_bytes(&self) -> &[u8] {
        &self.serial
    }

    /// Sends bytes to UART0, as from a serial monitor.
    pub fn serial_input(&mut self, data: &[u8]) {
        self.machine.bus.uart_input(0, data);
    }

    /// The voltage at a board pin, such as "esp:2", as of the last step.
    pub fn voltage(&self, pin: &str) -> Option<f64> {
        let shared = self.shared.borrow();
        shared.pins.iter().find(|p| p.name == pin).map(|p| p.volts)
    }

    /// The circuit, to change its controls. Its time is the ESP32 time.
    pub fn circuit(&self) -> RefMut<'_, C> {
        RefMut::map(self.shared.borrow_mut(), |s| &mut s.circuit)
    }

    /// Reads the pin modes that the board callbacks do not get (pulls and
    /// PWM), and sets the ADC inputs.
    fn poll(&mut self) -> Result<(), String> {
        // Bus reads can call the board, so read them before the borrow.
        let bus = &mut self.machine.bus;
        let gpios: Vec<u8> = self.shared.borrow().pins.iter().map(|p| p.gpio).collect();
        let modes: Vec<Mode> = gpios
            .into_iter()
            .map(|gpio| Mode::read(bus, gpio))
            .collect();
        let mut shared = self.shared.borrow_mut();
        shared.catch_up(bus.cycles());
        let mut adc = Vec::new();
        for (pin, mode) in shared.pins.iter_mut().zip(modes) {
            pin.mode = mode;
            if pin.adc_volts != Some(pin.volts) {
                pin.adc_volts = Some(pin.volts);
                adc.push((pin.gpio, pin.volts));
            }
        }
        shared.apply_drives();
        let error = shared.error.clone();
        drop(shared);
        for (gpio, volts) in adc {
            bus.analog_set(gpio, AnalogSource::Const(volts as f32));
        }
        self.serial.append(&mut self.machine.console.uart0);
        error.map_or(Ok(()), Err)
    }
}

/// How the firmware set up a pin.
#[derive(Clone, Copy, Default)]
struct Mode {
    out: bool,
    out_enable: bool,
    pull_up: bool,
    pull_down: bool,
    /// (frequency in Hz, duty from 0 to 1).
    pwm: Option<(f64, f64)>,
}

impl Mode {
    fn read(bus: &mut esp32::bus::SocBus, gpio: u8) -> Self {
        let mut mode = Mode::default();
        if let Some(state) = bus.gpio_state(gpio) {
            mode.out = state.output;
            mode.out_enable = state.output_enable;
            mode.pull_up = state.pull_up;
            mode.pull_down = state.pull_down;
        }
        if let Some((off, up, down)) = rtc_pulls(gpio) {
            let reg = bus.read32_unpriced(RTCIO_BASE + off).unwrap_or(0);
            mode.pull_up |= reg >> up & 1 != 0;
            mode.pull_down |= reg >> down & 1 != 0;
        }
        mode.pwm = bus
            .pwm_output(gpio)
            .map(|(hz, duty)| (hz, f64::from(duty) / 65535.0));

        mode
    }
}

const RTCIO_BASE: u32 = 0x3ff4_8400;

/// The RTC IO pull register of a pad as (offset, pull-up bit, pull-down bit).
/// ESP-IDF sets the pulls of RTC pads here, not in IO_MUX, and esp32sim
/// does not report them. From ESP-IDF v5.5.4
/// components/soc/esp32/register/soc/rtc_io_reg.h.
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

/// A board pin and what the bridge knows about it.
struct Pin {
    name: String,
    gpio: u8,
    mode: Mode,
    /// The drive that the circuit has.
    drive: Drive,
    volts: f64,
    level: bool,
    adc_volts: Option<f64>,
}

impl Pin {
    fn new(pin: pins::BoardPin) -> Self {
        Pin {
            name: pin.name,
            gpio: pin.gpio,
            mode: Mode::default(),
            drive: Drive::HIGH_Z,
            volts: 0.0,
            level: false,
            adc_volts: None,
        }
    }

    fn wanted_drive(&self) -> Drive {
        let mode = self.mode;
        match (mode.pwm, mode.out_enable, mode.pull_up, mode.pull_down) {
            (Some((hz, duty)), ..) if duty > 0.0 && duty < 1.0 => Drive {
                pwm: Some((hz, duty)),
                ..Drive::new(VDD, OUTPUT_OHMS)
            },
            (Some((_, duty)), ..) => Drive::new(if duty > 0.0 { VDD } else { 0.0 }, OUTPUT_OHMS),
            (None, true, ..) => Drive::new(if mode.out { VDD } else { 0.0 }, OUTPUT_OHMS),
            (None, false, true, true) => Drive::new(VDD / 2.0, PULL_OHMS / 2.0),
            (None, false, true, false) => Drive::new(VDD, PULL_OHMS),
            (None, false, false, true) => Drive::new(0.0, PULL_OHMS),
            (None, false, false, false) => Drive::HIGH_Z,
        }
    }

    /// Updates the input level from the voltage. Between the ESP32 input
    /// thresholds (0.25 and 0.75 of VDD) the level does not change.
    fn set_volts(&mut self, volts: f64) -> bool {
        self.volts = volts;
        let level = if volts >= 0.75 * VDD {
            true
        } else if volts <= 0.25 * VDD {
            false
        } else {
            self.level
        };
        std::mem::replace(&mut self.level, level) != level
    }
}

/// The state that the bridge and the board callbacks share.
struct Shared<C> {
    circuit: C,
    pins: Vec<Pin>,
    names: Vec<String>,
    /// The circuit time in seconds.
    time: f64,
    next_sync: u64,
    /// A drive changed after the last sync, so the voltages are old.
    dirty: bool,
    edges: Vec<BoardEdge>,
    /// The first circuit error. The bridge stops at the end of the step.
    error: Option<String>,
}

impl<C: Circuit> Shared<C> {
    /// Advances the circuit to `cycle` and queues the input edges.
    fn sync(&mut self, cycle: u64) {
        let t = cycle as f64 / CPU_HZ as f64;
        if self.error.is_some() || t <= self.time {
            return;
        }
        match self.circuit.advance_to(t, &self.names) {
            Ok(volts) => {
                for (pin, v) in self.pins.iter_mut().zip(volts) {
                    if pin.set_volts(v) {
                        self.edges.push(BoardEdge {
                            cycle,
                            pin: pin.gpio,
                            level: pin.level,
                        });
                    }
                }
            }
            Err(e) => self.error = Some(e),
        }
        self.time = self.time.max(t);
        self.next_sync = (cycle / STEP_CYCLES + 1) * STEP_CYCLES;
        self.dirty = false;
    }

    /// Syncs at each step, and after a drive change.
    fn catch_up(&mut self, cycle: u64) {
        if cycle >= self.next_sync || self.dirty {
            self.sync(cycle);
        }
    }

    /// Sends the drives that changed to the circuit.
    fn apply_drives(&mut self) {
        for pin in &mut self.pins {
            let drive = pin.wanted_drive();
            if self.error.is_none() && drive != pin.drive {
                pin.drive = drive;
                self.dirty = true;
                if let Err(e) = self.circuit.set_pin(&pin.name, drive) {
                    self.error = Some(e);
                }
            }
        }
    }
}

/// The esp32sim board model: it sees GPIO writes and reads as they happen.
struct Board<C>(Rc<RefCell<Shared<C>>>);

impl<C: Circuit> BoardModel for Board<C> {
    fn name(&self) -> &'static str {
        "esp-spice"
    }

    fn gpio_output_at(&mut self, cycle: u64, _: &[(u8, bool)], enabled: u64, output: u64) {
        let mut shared = self.0.borrow_mut();
        shared.sync(cycle);
        for pin in &mut shared.pins {
            pin.mode.out_enable = enabled >> pin.gpio & 1 != 0;
            pin.mode.out = output >> pin.gpio & 1 != 0;
        }
        shared.apply_drives();
    }

    fn advance_to(&mut self, cycle: u64) {
        let mut shared = self.0.borrow_mut();
        shared.catch_up(cycle);
    }

    fn next_deadline(&self) -> Option<u64> {
        Some(self.0.borrow().next_sync)
    }

    fn take_edges(&mut self) -> Vec<BoardEdge> {
        std::mem::take(&mut self.0.borrow_mut().edges)
    }

    fn input_levels(&self) -> Vec<(u8, bool)> {
        self.0
            .borrow()
            .pins
            .iter()
            .map(|p| (p.gpio, p.level))
            .collect()
    }
}
