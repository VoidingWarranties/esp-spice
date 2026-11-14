//! Runs the button and LED examples against ngspice, through
//! `node circuit/server.js`. Needs Node, `npm install` and libngspice.

mod common;

use std::process::Command;

use esp_bridge::{Bridge, ProcessCircuit};
use serde_json::json;

fn set(bridge: &mut Bridge<ProcessCircuit>, name: &str, value: i32) {
    let command = json!({ "cmd": "set", "name": name, "value": value });
    bridge.circuit().request(&command).unwrap();
}

#[test]
fn firmware_reads_button_and_pot_in_ngspice_esp32() {
    firmware_reads_button_and_pot_in_ngspice(common::ESP32);
}

#[test]
fn firmware_reads_button_and_pot_in_ngspice_s3() {
    firmware_reads_button_and_pot_in_ngspice(common::S3);
}

fn firmware_reads_button_and_pot_in_ngspice(example: &str) {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
    let diagram = format!("{example}/diagram.json");
    let mut node = Command::new("node");
    node.current_dir(root).args(["circuit/server.js", &diagram]);
    let circuit = ProcessCircuit::spawn(&mut node).unwrap();
    let mut bridge = Bridge::new(
        &common::diagram(example),
        &common::flash(example),
        &common::rom(example),
        circuit,
    )
    .unwrap();
    assert!(
        bridge.run_until_serial("ready", 2.0).unwrap(),
        "{}",
        bridge.serial()
    );
    bridge.run_for(0.05).unwrap();
    assert!(!bridge.serial().contains("pressed"), "{}", bridge.serial());

    set(&mut bridge, "btn1.pressed", 1);
    assert!(
        bridge.run_until_serial("pressed", 0.1).unwrap(),
        "{}",
        bridge.serial()
    );
    bridge.run_for(0.001).unwrap();
    let led = bridge
        .circuit()
        .request(&json!({ "cmd": "state", "part": "led1" }))
        .unwrap();
    assert_eq!(led["value"], true, "{led}");

    // The ADC reads the wiper, and the firmware sets the green LED from it
    // with PWM.
    set(&mut bridge, "pot1.value", 1023);
    bridge.run_for(0.05).unwrap();
    let serial = bridge.serial();
    let pot: i32 = serial
        .lines()
        .filter_map(|l| l.strip_prefix("pot ")?.parse().ok())
        .next_back()
        .unwrap();
    assert!(pot > 3500, "{serial}");
    let led = bridge
        .circuit()
        .request(&json!({ "cmd": "state", "part": "led2" }))
        .unwrap();
    assert!(led["brightness"].as_f64().unwrap() > 0.1, "{led}");
}
