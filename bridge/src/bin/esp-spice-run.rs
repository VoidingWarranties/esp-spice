//! Runs ESP32 firmware against the circuit in a diagram.json.
//!
//! esp-spice-run DIAGRAM FIRMWARE [--seconds S] [--set T:NAME=VALUE]...
//!     [--trace FILE] [--server circuit/server.js] [--elf FILE]
//!     [--heap-interval S] [--heap-csv FILE] [--heap-min-free BYTES]
//!
//! FIRMWARE is a merged flash image. `--set 0.5:btn1.pressed=1` changes a
//! control at 0.5 s. The serial output goes to stdout. `--trace` writes the
//! circuit trace (docs/circuit-format.md) at the end.
//!
//! `--elf`, the ELF of the app, turns on free heap samples every
//! `--heap-interval` seconds (default 0.1). `--heap-csv` writes the
//! samples. The run fails with exit code 1 when the free heap drops below
//! `--heap-min-free`, or when there are no samples.

use std::io::Write;
use std::process::{exit, Command};

use esp_bridge::{rom_elf, Bridge, Heap, ProcessCircuit};
use serde_json::{json, Value};

const USAGE: &str = "usage: esp-spice-run DIAGRAM FIRMWARE [--seconds S] \
    [--set T:NAME=VALUE]... [--trace FILE] [--server circuit/server.js] \
    [--elf FILE] [--heap-interval S] [--heap-csv FILE] [--heap-min-free BYTES]";

struct Options {
    diagram: String,
    firmware: String,
    seconds: f64,
    sets: Vec<(f64, String, Value)>,
    trace: Option<String>,
    server: String,
    elf: Option<String>,
    heap_interval: Option<f64>,
    heap_csv: Option<String>,
    heap_min_free: Option<u32>,
}

fn main() {
    let options =
        parse(std::env::args().skip(1)).unwrap_or_else(|e| fail(&format!("{e}\n{USAGE}")));
    match run(&options) {
        Ok(None) => {}
        Ok(Some(failure)) => {
            eprintln!("{failure}");
            exit(1)
        }
        Err(e) => fail(&e),
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
        elf: None,
        heap_interval: None,
        heap_csv: None,
        heap_min_free: None,
    };
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or(format!("{arg} needs a value"));
        match arg.as_str() {
            "--seconds" => options.seconds = value()?.parse().map_err(|_| "bad --seconds")?,
            "--trace" => options.trace = Some(value()?),
            "--server" => options.server = value()?,
            "--set" => options.sets.push(parse_set(&value()?).ok_or("bad --set")?),
            "--elf" => options.elf = Some(value()?),
            "--heap-interval" => {
                options.heap_interval = Some(
                    value()?
                        .parse()
                        .ok()
                        .filter(|&s: &f64| s > 0.0)
                        .ok_or("bad --heap-interval")?,
                )
            }
            "--heap-csv" => options.heap_csv = Some(value()?),
            "--heap-min-free" => {
                options.heap_min_free = Some(value()?.parse().map_err(|_| "bad --heap-min-free")?)
            }
            _ if arg.starts_with('-') => return Err(format!("unknown option {arg}")),
            _ => positional.push(arg),
        }
    }
    let [diagram, firmware] =
        <[String; 2]>::try_from(positional).map_err(|_| "need DIAGRAM and FIRMWARE")?;
    let heap_options = options.heap_interval.is_some()
        || options.heap_csv.is_some()
        || options.heap_min_free.is_some();
    if heap_options && options.elf.is_none() {
        return Err("the heap options need --elf".into());
    }
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

/// Runs the firmware. Returns the reason that a check failed, if one did.
fn run(options: &Options) -> Result<Option<String>, String> {
    let read = |path: &str| std::fs::read(path).map_err(|e| format!("{path}: {e}"));
    let diagram = String::from_utf8(read(&options.diagram)?).map_err(|e| e.to_string())?;
    let flash = read(&options.firmware)?;
    let rom_name = rom_elf(&diagram)?;
    let rom_path = esp_soc::rom::find(rom_name).ok_or(format!(
        "no {rom_name}: run tools/fetch-esp32-rom.sh and set ESP32SIM_ROM_DIR"
    ))?;
    let rom = read(&rom_path.to_string_lossy())?;
    let circuit =
        ProcessCircuit::spawn(Command::new("node").args([&options.server, &options.diagram]))?;
    let mut bridge = Bridge::new(&diagram, &flash, &rom, circuit)?;
    if let Some(path) = &options.elf {
        bridge.load_elf(&read(path)?)?;
    }

    let mut printed = 0;
    let mut sets = options.sets.iter().peekable();
    let interval = options.heap_interval.unwrap_or(0.1);
    let mut next_sample = options.elf.is_some().then_some(0.0);
    let mut samples = Vec::new();
    let mut failure = None;
    let mut stopped = None;
    while bridge.time() < options.seconds && failure.is_none() {
        while let Some((_, name, value)) = sets.next_if(|s| s.0 <= bridge.time()) {
            bridge
                .circuit()
                .request(&json!({ "cmd": "set", "name": name, "value": value }))?;
        }
        if let Some(t) = next_sample.filter(|&t| t <= bridge.time()) {
            if let Some(heap) = bridge.heap() {
                samples.push((bridge.time(), heap));
                if let Some(min) = options.heap_min_free.filter(|&m| heap.free < m) {
                    failure = Some(format!(
                        "free heap {} dropped below {min} bytes at {:.3}s",
                        heap.free,
                        bridge.time()
                    ));
                }
            }
            next_sample = Some(t + interval);
        }
        let next = sets
            .peek()
            .map_or(options.seconds, |s| s.0)
            .min(next_sample.unwrap_or(f64::INFINITY));
        let ran = bridge.run_for((next.min(bridge.time() + 0.01) - bridge.time()).max(1e-6));
        let serial = bridge.serial_bytes();
        let mut stdout = std::io::stdout();
        let _ = stdout
            .write_all(&serial[printed..])
            .and_then(|_| stdout.flush());
        printed = serial.len();
        if let Err(e) = ran {
            stopped = Some(e);
            break;
        }
    }
    // Write the samples first, as they can show why the firmware stopped.
    if options.elf.is_some() {
        eprintln!("{}", heap_summary(&samples));
        if let Some(path) = &options.heap_csv {
            std::fs::write(path, heap_csv(&samples)).map_err(|e| format!("{path}: {e}"))?;
        }
        if samples.is_empty() {
            failure = Some(
                "no heap samples: the firmware did not set up its heap, \
                 or the ELF is not of this firmware"
                    .into(),
            );
        }
    }
    if let Some(e) = stopped {
        return Err(e);
    }
    if let Some(path) = &options.trace {
        let trace = bridge.circuit().request(&json!({ "cmd": "trace" }))?;
        std::fs::write(path, trace.to_string()).map_err(|e| format!("{path}: {e}"))?;
    }
    Ok(failure)
}

fn heap_summary(samples: &[(f64, Heap)]) -> String {
    let (Some((_, first)), Some((_, last))) = (samples.first(), samples.last()) else {
        return "Heap: 0 samples".into();
    };
    let lowest = samples.iter().map(|(_, h)| h.min_free).min().unwrap();
    format!(
        "Heap: {} samples, free {} -> {}, lowest {lowest}",
        samples.len(),
        first.free,
        last.free
    )
}

fn heap_csv(samples: &[(f64, Heap)]) -> String {
    let rows: String = samples
        .iter()
        .map(|(t, h)| format!("{t:.6},{},{}\n", h.free, h.min_free))
        .collect();
    format!("time_s,free,min_free\n{rows}")
}
