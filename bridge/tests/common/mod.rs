//! Shared test setup: the example project and a stub circuit.

// Each test file uses a different part of this module.
#![allow(dead_code)]

use std::collections::HashMap;

use esp_bridge::{Circuit, Drive};

pub const EXAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/esp32-button-led");

pub fn diagram() -> String {
    std::fs::read_to_string(format!("{EXAMPLE}/diagram.json")).unwrap()
}

pub fn flash() -> Vec<u8> {
    std::fs::read(format!("{EXAMPLE}/firmware.bin")).unwrap()
}

pub fn rom() -> Vec<u8> {
    std::fs::read(esp_soc::rom::require(
        esp_bridge::rom_elf(&diagram()).unwrap(),
    ))
    .unwrap()
}

/// Each board pin is its own net: the pin drive in parallel with the
/// sources that the test connects.
#[derive(Default)]
pub struct StubCircuit {
    pub drives: HashMap<String, Drive>,
    pub sources: HashMap<String, Drive>,
}

impl StubCircuit {
    pub fn voltage(&self, pin: &str) -> f64 {
        let drive = self.drives.get(pin).copied().unwrap_or(Drive::HIGH_Z);
        let all = [Some(drive), self.sources.get(pin).copied()];
        let (current, conductance) = all.iter().flatten().fold((0.0, 0.0), |(i, g), d| {
            (i + d.volts / d.ohms, g + 1.0 / d.ohms)
        });
        current / conductance
    }
}

impl Circuit for StubCircuit {
    fn set_pin(&mut self, pin: &str, drive: Drive) -> Result<(), String> {
        self.drives.insert(pin.to_string(), drive);
        Ok(())
    }

    fn advance_to(&mut self, _t: f64, pins: &[String]) -> Result<Vec<f64>, String> {
        Ok(pins.iter().map(|pin| self.voltage(pin)).collect())
    }
}
