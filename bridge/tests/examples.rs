//! Runs the ESP32 examples (GPIO, PWM, ADC) against ngspice, through
//! `node circuit/server.js`. Needs Node, `npm install` and libngspice.

mod common;

use std::process::Command;

use esp_bridge::{Bridge, ProcessCircuit};
use serde_json::{json, Value};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");

/// Starts an example and runs it until the firmware is ready.
fn start(name: &str) -> Bridge<ProcessCircuit> {
    let dir = format!("{ROOT}/examples/{name}");
    let diagram = format!("{dir}/diagram.json");
    let mut node = Command::new("node");
    node.current_dir(ROOT).args(["circuit/server.js", &diagram]);
    let mut bridge = Bridge::new(
        &std::fs::read_to_string(&diagram).unwrap(),
        &std::fs::read(format!("{dir}/firmware.bin")).unwrap(),
        &common::rom(),
        ProcessCircuit::spawn(&mut node).unwrap(),
    )
    .unwrap();
    wait(&mut bridge, "ready");
    bridge
}

fn wait(bridge: &mut Bridge<ProcessCircuit>, text: &str) {
    assert!(
        bridge.run_until_serial(text, 0.5).unwrap(),
        "no {text:?} in:\n{}",
        bridge.serial()
    );
}

fn request(bridge: &mut Bridge<ProcessCircuit>, command: Value) -> Value {
    bridge.circuit().request(&command).unwrap()
}

fn set(bridge: &mut Bridge<ProcessCircuit>, name: &str, value: i32) {
    request(
        bridge,
        json!({ "cmd": "set", "name": name, "value": value }),
    );
}

fn state(bridge: &mut Bridge<ProcessCircuit>, part: &str) -> Value {
    request(bridge, json!({ "cmd": "state", "part": part }))
}

/// The values of a trace prop of a part, one for each keyframe that sets
/// it.
fn keyframes(bridge: &mut Bridge<ProcessCircuit>, part: &str, prop: &str) -> Vec<Value> {
    let trace = request(bridge, json!({ "cmd": "trace" }));
    trace["parts"][part]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|frame| frame.get(prop).cloned())
        .collect()
}

#[test]
fn gpio_switch_blinks_and_button_lights() {
    let mut bridge = start("esp32-gpio");
    bridge.run_for(0.05).unwrap();
    assert_eq!(keyframes(&mut bridge, "led1", "value"), [false]);

    // INPUT_PULLDOWN holds the switch pin low until the switch connects it
    // to 3.3 V.
    set(&mut bridge, "sw1.value", 1);
    wait(&mut bridge, "switch on");
    bridge.run_for(0.2).unwrap();
    // 50 ms per toggle.
    let blinks = keyframes(&mut bridge, "led1", "value");
    assert!((4..=6).contains(&blinks.len()), "{blinks:?}");

    set(&mut bridge, "btn1.pressed", 1);
    wait(&mut bridge, "pressed");
    bridge.run_for(0.001).unwrap();
    assert_eq!(state(&mut bridge, "led2")["value"], true);
    set(&mut bridge, "btn1.pressed", 0);
    wait(&mut bridge, "released");
    bridge.run_for(0.001).unwrap();
    assert_eq!(state(&mut bridge, "led2")["value"], false);
}

#[test]
fn pwm_fades_rgb_and_drives_buzzer() {
    let mut bridge = start("esp32-pwm");
    // One fade cycle is 3 * 32 steps of 2 ms.
    bridge.run_for(0.2).unwrap();
    for color in ["ledRed", "ledGreen", "ledBlue"] {
        let values: Vec<f64> = keyframes(&mut bridge, "rgb1", color)
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        let max = values.iter().copied().fold(0.0, f64::max);
        assert!(max > 0.5, "{color}: {values:?}");
        assert!(values[1..].contains(&0.0), "{color}: {values:?}");
    }

    assert_eq!(state(&mut bridge, "bz1")["hasSignal"], false);
    set(&mut bridge, "btn1.pressed", 1);
    wait(&mut bridge, "tone on");
    bridge.run_for(0.01).unwrap();
    assert_eq!(state(&mut bridge, "bz1")["hasSignal"], true);
    set(&mut bridge, "btn1.pressed", 0);
    wait(&mut bridge, "tone off");
    bridge.run_for(0.01).unwrap();
    assert_eq!(state(&mut bridge, "bz1")["hasSignal"], false);
}

#[test]
fn pwm_square_wave_feeds_rectifier() {
    let mut bridge = start("esp32-rectifier");
    bridge.run_for(0.1).unwrap();
    let v = request(&mut bridge, json!({ "cmd": "voltage", "pin": "c1:1" }));
    // See the esp32-rectifier test in circuit/test/examples.test.js.
    let v = v["v"].as_f64().unwrap();
    assert!((v - 2.72).abs() < 0.03, "{v}");
}

/// The last "pot N mV, level L" line, as (N, L).
fn last_reading(bridge: &Bridge<ProcessCircuit>) -> (f64, i64) {
    let serial = bridge.serial();
    let line = serial.lines().filter(|l| l.starts_with("pot ")).last();
    let parse = |line: &str| {
        let (mv, level) = line.strip_prefix("pot ")?.split_once(" mV, level ")?;
        Some((mv.parse().ok()?, level.parse().ok()?))
    };
    line.and_then(parse).unwrap_or_else(|| panic!("{serial}"))
}

#[test]
fn adc_reads_pot_into_bar_graph() {
    let mut bridge = start("esp32-adc");
    bridge.run_for(0.02).unwrap();
    // 3.3 V * 512 / 1023 = 1652 mV, so 5 segments of 300 mV.
    let (mv, level) = last_reading(&bridge);
    assert!((mv - 1652.0).abs() < 1652.0 * 0.03, "{mv}");
    assert_eq!(level, 5);
    assert_eq!(
        state(&mut bridge, "bar1")["values"],
        json!([1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    );

    set(&mut bridge, "pot1.value", 100);
    wait(&mut bridge, "level 1");
    // 3.3 V * 100 / 1023 = 323 mV.
    let (mv, _) = last_reading(&bridge);
    assert!((mv - 323.0).abs() < 323.0 * 0.05, "{mv}");
}
