//! Runs the esp32-button-led example firmware against a stub circuit.

mod common;

use common::StubCircuit;
use esp_bridge::{Bridge, Drive};

#[test]
fn button_lights_led() {
    let circuit = StubCircuit::default();
    let mut bridge = Bridge::new(
        &common::diagram(),
        &common::flash(),
        &common::rom(),
        circuit,
    )
    .unwrap();
    assert!(
        bridge.run_until_serial("ready", 2.0).unwrap(),
        "{}",
        bridge.serial()
    );
    bridge.run_for(0.05).unwrap();
    // INPUT_PULLUP reaches the circuit as a pull-up drive, in time for the
    // first read.
    assert_eq!(bridge.circuit().drives["esp:4"], Drive::new(3.3, 45_000.0));
    assert!(bridge.voltage("esp:4").unwrap() > 3.2);
    assert!(bridge.voltage("esp:2").unwrap() < 0.1);
    assert!(!bridge.serial().contains("pressed"), "{}", bridge.serial());

    // Press: a switch to ground.
    bridge
        .circuit()
        .sources
        .insert("esp:4".into(), Drive::new(0.0, 0.05));
    let pressed_at = bridge.time();
    assert!(
        bridge.run_until_serial("pressed", 0.1).unwrap(),
        "{}",
        bridge.serial()
    );
    assert!(bridge.time() - pressed_at < 0.02);
    bridge.run_for(0.001).unwrap();
    assert!(bridge.voltage("esp:2").unwrap() > 3.2);

    // Release.
    bridge.circuit().sources.clear();
    assert!(
        bridge.run_until_serial("released", 0.1).unwrap(),
        "{}",
        bridge.serial()
    );
    bridge.run_for(0.001).unwrap();
    assert!(bridge.voltage("esp:2").unwrap() < 0.1);
}
