//! Runs ESP32 firmware in esp32sim, in lockstep with a circuit simulation.
//!
//! The ESP32 is the clock. Each GPIO pin that is wired in diagram.json is a
//! board pin. The bridge gives the circuit the drive of each board pin when
//! it changes, at the exact emulated time. The circuit gives back the
//! voltage of each board pin. The bridge changes the voltages to GPIO input
//! levels and ADC inputs.

use std::cell::{RefCell, RefMut};
use std::rc::Rc;

use esp_soc::board::{BoardEdge, BoardModel};
use esp_soc::Stop;

mod chip;
pub mod circuit;
mod heap;
pub mod pins;

use chip::Esp;
pub use circuit::{Circuit, DeferredCircuit, Drive, ProcessCircuit};
pub use heap::Heap;

/// How often the circuit catches up with the ESP32 when no pin changes, per
/// second. GPIO reads see the circuit as of the last catch-up.
const STEPS_PER_SECOND: u64 = 10_000;
/// How often the bridge reads the pin modes that the board callbacks do not
/// get, per second. A GPIO read sees a new mode only after this delay.
const POLLS_PER_SECOND: u64 = 1_000_000;
const VDD: f64 = 3.3;
/// Output resistance and pull resistance, from docs/circuit-format.md.
const OUTPUT_OHMS: f64 = 40.0;
const PULL_OHMS: f64 = 45_000.0;

/// The name of the mask ROM ELF that `Bridge::new` needs for the board in
/// `diagram`, the diagram.json text.
pub fn rom_elf(diagram: &str) -> Result<&'static str, String> {
    Ok(pins::chip(&parse(diagram)?)?.rom_elf)
}

fn parse(diagram: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(diagram).map_err(|e| format!("diagram.json: {e}"))
}

/// An ESP32 that runs firmware against a circuit.
pub struct Bridge<C: Circuit> {
    machine: Box<dyn Esp>,
    shared: Rc<RefCell<Shared<C>>>,
    serial: Vec<u8>,
    /// The address of ESP-IDF's heap list, from the firmware ELF, and the
    /// bytes that the firmware takes off each heap.
    heap_list: Option<(u32, u32)>,
}

impl<C: Circuit + 'static> Bridge<C> {
    /// Loads a merged flash image (app at 0x10000) and the mask ROM ELF
    /// from `rom_elf`, and boots from the ROM. `diagram` is the
    /// diagram.json text. Its board part selects the chip.
    pub fn new(diagram: &str, flash: &[u8], rom: &[u8], circuit: C) -> Result<Self, String> {
        let diagram = parse(diagram)?;
        let chip = pins::chip(&diagram)?;
        let pins: Vec<Pin> = pins::board_pins(&diagram)?
            .into_iter()
            .map(Pin::new)
            .collect();
        let names = pins.iter().map(|p| p.name.clone()).collect();
        let mut shared = Shared {
            hz: chip.hz,
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

        let machine = (chip.boot)(Box::new(Board(shared.clone())), flash, rom)?;
        Ok(Bridge {
            machine,
            shared,
            serial: Vec::new(),
            heap_list: None,
        })
    }

    /// Runs for `seconds` of emulated time.
    pub fn run_for(&mut self, seconds: f64) -> Result<(), String> {
        let hz = self.machine.hz();
        let end = self.machine.cycles() + (seconds * hz as f64).round() as u64;
        while self.machine.cycles() < end {
            match self
                .machine
                .run((self.machine.cycles() + hz / POLLS_PER_SECOND).min(end))
            {
                Stop::Halted => {}
                // A software or watchdog reset reboots the chip, as on a board.
                Stop::SwReset => {
                    self.machine.reboot();
                    // RAM keeps the old heap list until the new app sets up
                    // its heap. Clear it, so that no sample reads old heaps.
                    if let Some((list, _)) = self.heap_list {
                        self.machine.write_word(list, 0);
                    }
                }
                stop => {
                    // Keep the firmware's last output, such as a panic message.
                    self.machine.take_serial(&mut self.serial);
                    return Err(format!("the ESP32 stopped: {stop:?}"));
                }
            }
            self.poll()?;
        }
        Ok(())
    }

    /// Runs until the serial output after this call contains `text`, for at
    /// most `timeout` seconds. Returns whether the text came.
    pub fn run_until_serial(&mut self, text: &str, timeout: f64) -> Result<bool, String> {
        let end = self.time() + timeout;
        let start = self.serial.len();
        let text = text.as_bytes();
        while !self.serial[start..].windows(text.len()).any(|w| w == text) {
            if self.time() >= end {
                return Ok(false);
            }
            self.run_for(1.0 / STEPS_PER_SECOND as f64)?;
        }
        Ok(true)
    }

    /// Emulated time in seconds.
    pub fn time(&self) -> f64 {
        self.machine.cycles() as f64 / self.machine.hz() as f64
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
        self.machine.serial_input(data);
    }

    /// Loads the symbols of the firmware ELF, for `heap`. It must be the ELF
    /// of the app in the flash image.
    pub fn load_elf(&mut self, elf: &[u8]) -> Result<(), String> {
        let symbols = esp_soc::elf::parse(elf)?.by_name;
        let list = *symbols.get(heap::SYMBOL).ok_or(format!(
            "the ELF has no {} symbol, so it is not ESP-IDF firmware",
            heap::SYMBOL
        ))?;
        let overhead = if heap::poisoned(&symbols) {
            heap::POISON_OVERHEAD
        } else {
            0
        };
        self.heap_list = Some((list, overhead));
        Ok(())
    }

    /// The free heap now, from ESP-IDF's own counters. None without
    /// `load_elf`, or before the firmware sets up its heap.
    pub fn heap(&mut self) -> Option<Heap> {
        let (list, overhead) = self.heap_list?;
        heap::read(list, overhead, |addr| self.machine.read_word(addr))
    }

    /// The voltage at a board pin, such as "esp:2", as of the last step.
    pub fn voltage(&self, pin: &str) -> Option<f64> {
        let shared = self.shared.borrow();
        shared.pins.iter().find(|p| p.name == pin).map(|p| p.volts)
    }

    /// The circuit, to change its controls. It is first advanced to the
    /// ESP32 time.
    pub fn circuit(&self) -> RefMut<'_, C> {
        let mut shared = self.shared.borrow_mut();
        shared.sync(self.machine.cycles());
        RefMut::map(shared, |s| &mut s.circuit)
    }

    /// Reads the pin modes that the board callbacks do not get (pulls and
    /// PWM), and sets the ADC inputs.
    fn poll(&mut self) -> Result<(), String> {
        // Bus reads can call the board, so read them before the borrow.
        let gpios: Vec<u8> = self.shared.borrow().pins.iter().map(|p| p.gpio).collect();
        let modes: Vec<Mode> = gpios
            .into_iter()
            .map(|gpio| self.machine.mode(gpio))
            .collect();
        let mut shared = self.shared.borrow_mut();
        let cycle = self.machine.cycles();
        shared.catch_up(cycle);
        let mut adc = Vec::new();
        for (pin, mode) in shared.pins.iter_mut().zip(modes) {
            pin.mode = mode;
            if pin.adc_volts != Some(pin.volts) {
                pin.adc_volts = Some(pin.volts);
                adc.push((pin.gpio, pin.volts));
            }
        }
        shared.apply_drives(cycle);
        let error = shared.error.clone();
        drop(shared);
        for (gpio, volts) in adc {
            self.machine.set_analog(gpio, volts);
        }
        self.machine.take_serial(&mut self.serial);
        error.map_or(Ok(()), Err)
    }
}

/// How the firmware set up a pin.
#[derive(Clone, Copy, Default)]
pub(crate) struct Mode {
    out: bool,
    out_enable: bool,
    pull_up: bool,
    pull_down: bool,
    /// The pin drives only low; high releases it.
    open_drain: bool,
    /// The GPIO matrix routes a peripheral signal, not GPIO_OUT, to the pin.
    peripheral: bool,
    /// (frequency in Hz, duty from 0 to 1).
    pwm: Option<(f64, f64)>,
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
            // The bridge does not model peripheral signals, and an open-drain
            // high is released, so they fall through to the pulls.
            (None, true, ..) if !mode.peripheral && !(mode.open_drain && mode.out) => {
                Drive::new(if mode.out { VDD } else { 0.0 }, OUTPUT_OHMS)
            }
            (None, _, true, true) => Drive::new(VDD / 2.0, PULL_OHMS / 2.0),
            (None, _, true, false) => Drive::new(VDD, PULL_OHMS),
            (None, _, false, true) => Drive::new(0.0, PULL_OHMS),
            (None, _, false, false) => Drive::HIGH_Z,
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
    /// The chip clock, in cycles per second.
    hz: u64,
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
        let t = cycle as f64 / self.hz as f64;
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
        let step = self.hz / STEPS_PER_SECOND;
        self.next_sync = (cycle / step + 1) * step;
        self.dirty = false;
    }

    /// Syncs at each step, and after a drive change.
    fn catch_up(&mut self, cycle: u64) {
        if cycle >= self.next_sync || self.dirty {
            self.sync(cycle);
        }
    }

    /// Sends the drives that changed to the circuit, at `cycle`.
    fn apply_drives(&mut self, cycle: u64) {
        for i in 0..self.pins.len() {
            let drive = self.pins[i].wanted_drive();
            if self.error.is_none() && drive != self.pins[i].drive {
                self.sync(cycle);
                let pin = &mut self.pins[i];
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
        for pin in &mut shared.pins {
            pin.mode.out_enable = enabled >> pin.gpio & 1 != 0;
            pin.mode.out = output >> pin.gpio & 1 != 0;
        }
        shared.apply_drives(cycle);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(mode: Mode) -> Drive {
        let mut pin = Pin::new(pins::BoardPin {
            name: "esp:2".into(),
            gpio: 2,
        });
        pin.mode = mode;
        pin.wanted_drive()
    }

    #[test]
    fn drives_follow_pin_mode() {
        let output = Mode {
            out_enable: true,
            out: true,
            ..Mode::default()
        };
        assert_eq!(drive(output), Drive::new(VDD, OUTPUT_OHMS));
        let pull_up = Mode {
            pull_up: true,
            ..Mode::default()
        };
        assert_eq!(drive(pull_up), Drive::new(VDD, PULL_OHMS));
        assert_eq!(drive(Mode::default()), Drive::HIGH_Z);
        let pwm = Mode {
            pwm: Some((5000.0, 0.25)),
            ..output
        };
        assert_eq!(drive(pwm).pwm, Some((5000.0, 0.25)));
    }

    #[test]
    fn open_drain_high_and_peripheral_pins_release() {
        let open_drain = Mode {
            out_enable: true,
            open_drain: true,
            pull_up: true,
            ..Mode::default()
        };
        assert_eq!(
            drive(Mode {
                out: true,
                ..open_drain
            }),
            Drive::new(VDD, PULL_OHMS)
        );
        assert_eq!(drive(open_drain), Drive::new(0.0, OUTPUT_OHMS));
        let peripheral = Mode {
            out_enable: true,
            peripheral: true,
            ..Mode::default()
        };
        assert_eq!(drive(peripheral), Drive::HIGH_Z);
    }
}
