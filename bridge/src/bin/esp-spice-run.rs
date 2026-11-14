//! Runs ESP32 firmware against the circuit in a diagram.json.
//!
//! esp-spice-run DIAGRAM FIRMWARE [--seconds S] [--set T:NAME=VALUE]...
//!     [--trace FILE] [--server circuit/server.js]
//!
//! FIRMWARE is a merged flash image. `--set 0.5:btn1.pressed=1` changes a
//! control at 0.5 s. The serial output goes to stdout. `--trace` writes the
//! circuit trace (docs/circuit-format.md) at the end.

use std::io::Write;
use std::process::{exit, Command};

use esp_bridge::{Bridge, ProcessCircuit, ROM_ELF};
use serde_json::{json, Value};

const USAGE: &str = "usage: esp-spice-run DIAGRAM FIRMWARE [--seconds S] \
    [--set T:NAME=VALUE]... [--trace FILE] [--server circuit/server.js]";

struct Options {
    diagram: String,
    firmware: String,
    seconds: f64,
    sets: Vec<(f64, String, Value)>,
    trace: Option<String>,
    server: String,
}

fn main() {
    let options =
        parse(std::env::args().skip(1)).unwrap_or_else(|e| fail(&format!("{e}\n{USAGE}")));
    if let Err(e) = run(&options) {
        fail(&e);
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(2)
}

fn parse(mut args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut positional = Vec::new();
    let mut options = Options {
        diagram: String::new(),
        firmware: String::new(),
        seconds: 1.0,
        sets: Vec::new(),
        trace: None,
        server: "circuit/server.js".into(),
    };
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or(format!("{arg} needs a value"));
        match arg.as_str() {
            "--seconds" => options.seconds = value()?.parse().map_err(|_| "bad --seconds")?,
            "--trace" => options.trace = Some(value()?),
            "--server" => options.server = value()?,
            "--set" => options.sets.push(parse_set(&value()?).ok_or("bad --set")?),
            _ if arg.starts_with('-') => return Err(format!("unknown option {arg}")),
            _ => positional.push(arg),
        }
    }
    let [diagram, firmware] =
        <[String; 2]>::try_from(positional).map_err(|_| "need DIAGRAM and FIRMWARE")?;
    options.diagram = diagram;
    options.firmware = firmware;
    options.sets.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(options)
}

/// Parses "T:NAME=VALUE".
fn parse_set(text: &str) -> Option<(f64, String, Value)> {
    let (t, rest) = text.split_once(':')?;
    let (name, value) = rest.split_once('=')?;
    Some((
        t.parse().ok()?,
        name.into(),
        serde_json::from_str(value).ok()?,
    ))
}

fn run(options: &Options) -> Result<(), String> {
    let read = |path: &str| std::fs::read(path).map_err(|e| format!("{path}: {e}"));
    let diagram = String::from_utf8(read(&options.diagram)?).map_err(|e| e.to_string())?;
    let flash = read(&options.firmware)?;
    let rom_path = esp_soc::rom::find(ROM_ELF).ok_or(format!(
        "no {ROM_ELF}: run tools/fetch-esp32-rom.sh and set ESP32SIM_ROM_DIR"
    ))?;
    let rom = read(&rom_path.to_string_lossy())?;
    let circuit =
        ProcessCircuit::spawn(Command::new("node").args([&options.server, &options.diagram]))?;
    let mut bridge = Bridge::new(&diagram, &flash, &rom, circuit)?;

    let mut printed = 0;
    let mut sets = options.sets.iter().peekable();
    while bridge.time() < options.seconds {
        while let Some((_, name, value)) = sets.next_if(|s| s.0 <= bridge.time()) {
            bridge
                .circuit()
                .request(&json!({ "cmd": "set", "name": name, "value": value }))?;
        }
        let next = sets.peek().map_or(options.seconds, |s| s.0);
        bridge.run_for((next.min(bridge.time() + 0.01) - bridge.time()).max(1e-6))?;
        let serial = bridge.serial_bytes();
        let mut stdout = std::io::stdout();
        let _ = stdout
            .write_all(&serial[printed..])
            .and_then(|_| stdout.flush());
        printed = serial.len();
    }
    if let Some(path) = &options.trace {
        let trace = bridge.circuit().request(&json!({ "cmd": "trace" }))?;
        std::fs::write(path, trace.to_string()).map_err(|e| format!("{path}: {e}"))?;
    }
    Ok(())
}
