//! Steps a circuit after each run, as a browser host does.

mod common;

use common::StubCircuit;
use esp_bridge::{Bridge, DeferredCircuit};

/// Runs for `seconds` in steps, and replays the drives on `circuit` after
/// each step.
fn run(bridge: &mut Bridge<DeferredCircuit>, circuit: &mut StubCircuit, seconds: f64) {
    let end = bridge.time() + seconds;
    while bridge.time() < end {
        bridge.run_for(100e-6).unwrap();
        for (_, pin, drive) in bridge.circuit().take_drives() {
            circuit.drives.insert(pin, drive);
        }
        for pin in ["esp:2", "esp:4"] {
            bridge.circuit().set_voltage(pin, circuit.voltage(pin));
        }
    }
}

#[test]
fn deferred_circuit_drives_firmware_esp32() {
    deferred_circuit_drives_firmware(common::ESP32);
}

#[test]
fn deferred_circuit_drives_firmware_s3() {
    deferred_circuit_drives_firmware(common::S3);
}

#[test]
fn deferred_circuit_drives_firmware_c3() {
    deferred_circuit_drives_firmware(common::C3);
}

#[test]
fn deferred_circuit_drives_firmware_c6() {
    deferred_circuit_drives_firmware(common::C6);
}

fn deferred_circuit_drives_firmware(example: &str) {
    let mut circuit = StubCircuit::default();
    let deferred = DeferredCircuit::default();
    let mut bridge = Bridge::new(
        &common::diagram(example),
        &common::flash(example),
        &common::rom(example),
        deferred,
    )
    .unwrap();
    run(&mut bridge, &mut circuit, 0.1);
    assert!(bridge.serial().contains("ready"), "{}", bridge.serial());

    circuit
        .sources
        .insert("esp:4".into(), esp_bridge::Drive::new(0.0, 0.05));
    run(&mut bridge, &mut circuit, 0.05);
    assert!(bridge.serial().contains("pressed"), "{}", bridge.serial());
    assert!(circuit.voltage("esp:2") > 3.2);
}
