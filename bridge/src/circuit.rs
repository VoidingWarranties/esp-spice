//! The circuit side of the co-simulation.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

/// How an ESP32 pin drives its net: a voltage source behind a series
/// resistor. See "Boards" in docs/circuit-format.md.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Drive {
    pub volts: f64,
    pub ohms: f64,
    /// PWM as (frequency in Hz, duty from 0 to 1). The circuit makes the
    /// edges itself, so the bridge does not step for each edge.
    pub pwm: Option<(f64, f64)>,
}

impl Drive {
    /// An input pin with no pull.
    pub const HIGH_Z: Drive = Drive::new(0.0, 1e9);

    pub const fn new(volts: f64, ohms: f64) -> Self {
        Drive {
            volts,
            ohms,
            pwm: None,
        }
    }
}

/// A circuit that steps in time with the ESP32. The ESP32 owns time: the
/// circuit time never passes the ESP32 time.
pub trait Circuit {
    /// Sets the drive of a board pin, such as "esp:2", from the current time.
    fn set_pin(&mut self, pin: &str, drive: Drive) -> Result<(), String>;

    /// Advances to `t` seconds and returns the voltage at each of `pins`.
    fn advance_to(&mut self, t: f64, pins: &[String]) -> Result<Vec<f64>, String>;
}

/// A circuit in a child process that speaks the process protocol of
/// docs/circuit-format.md, such as `node circuit/server.js diagram.json`.
pub struct ProcessCircuit {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl ProcessCircuit {
    pub fn spawn(command: &mut Command) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("cannot start the circuit process: {e}"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Ok(ProcessCircuit {
            child,
            stdin,
            stdout,
        })
    }

    /// Sends one command and returns its reply.
    pub fn request(&mut self, command: &Value) -> Result<Value, String> {
        let io = |e: std::io::Error| format!("circuit process: {e}");
        writeln!(self.stdin, "{command}").map_err(io)?;
        self.stdin.flush().map_err(io)?;
        let mut line = String::new();
        if self.stdout.read_line(&mut line).map_err(io)? == 0 {
            return Err("circuit process: closed its output".into());
        }
        let reply: Value =
            serde_json::from_str(&line).map_err(|e| format!("circuit process: {e}: {line}"))?;
        match reply.get("error") {
            Some(error) => Err(format!("circuit process: {command}: {error}")),
            None => Ok(reply),
        }
    }
}

impl Circuit for ProcessCircuit {
    fn set_pin(&mut self, pin: &str, drive: Drive) -> Result<(), String> {
        let mut command = json!({
            "cmd": "set_pin", "pin": pin, "volts": drive.volts, "ohms": drive.ohms,
        });
        if let Some((freq_hz, duty)) = drive.pwm {
            command["freq_hz"] = json!(freq_hz);
            command["duty"] = json!(duty);
        }
        self.request(&command).map(drop)
    }

    fn advance_to(&mut self, t: f64, pins: &[String]) -> Result<Vec<f64>, String> {
        let reply = self.request(&json!({ "cmd": "advance_to", "t": t, "pins": pins }))?;
        pins.iter()
            .map(|pin| {
                reply["v"][pin]
                    .as_f64()
                    .ok_or_else(|| format!("circuit process: no voltage for {pin}"))
            })
            .collect()
    }
}

impl Drop for ProcessCircuit {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A circuit that the caller steps after each `Bridge::run_for`, for a
/// circuit that cannot answer at once, such as an async simulator in a
/// browser. The caller replays the drives and gives back the voltages, so
/// the inputs lag the circuit by up to one run.
#[derive(Default)]
pub struct DeferredCircuit {
    time: f64,
    drives: Vec<(f64, String, Drive)>,
    volts: HashMap<String, f64>,
}

impl DeferredCircuit {
    /// The drive changes since the last call, as (time, pin, drive), in
    /// time order.
    pub fn take_drives(&mut self) -> Vec<(f64, String, Drive)> {
        std::mem::take(&mut self.drives)
    }

    /// Sets the voltage at a board pin. The bridge reads it at its next step.
    pub fn set_voltage(&mut self, pin: &str, volts: f64) {
        self.volts.insert(pin.to_string(), volts);
    }
}

impl Circuit for DeferredCircuit {
    fn set_pin(&mut self, pin: &str, drive: Drive) -> Result<(), String> {
        self.drives.push((self.time, pin.to_string(), drive));
        Ok(())
    }

    fn advance_to(&mut self, t: f64, pins: &[String]) -> Result<Vec<f64>, String> {
        self.time = t;
        Ok(pins
            .iter()
            .map(|pin| self.volts.get(pin).copied().unwrap_or(0.0))
            .collect())
    }
}
