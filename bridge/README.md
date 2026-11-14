# ESP32 bridge

Runs ESP32 firmware in [esp32sim], in lockstep with the circuit in a
`diagram.json`. The circuit runs in ngspice through
`node circuit/server.js` (see [docs/circuit-format.md](../docs/circuit-format.md)).

[esp32sim]: https://github.com/mikroverk/esp32sim

## Set up

1.  Set up the circuit simulation (libngspice and `npm install`), as the
    [top README](../README.md) tells.
2.  Get the mask ROMs. esp32sim boots from them.

    ```sh
    tools/fetch-esp32-rom.sh roms
    export ESP32SIM_ROM_DIR=$PWD/roms
    ```

## Run

From the repository root:

```sh
cargo run --release --manifest-path bridge/Cargo.toml -- \
    examples/esp32-s3-button-led/diagram.json \
    examples/esp32-s3-button-led/firmware.bin \
    --seconds 1 --set 0.3:btn1.pressed=1 --set 0.6:pot1.value=1023 \
    --trace trace.json
```

The firmware is a merged flash image, such as PlatformIO's
`firmware.factory.bin`. `--set T:NAME=VALUE` changes a circuit control at
time T. The serial output goes to stdout. `--trace` writes the circuit trace.
`--probe PIN` adds the voltage of a pin's net to the trace, for example
`--probe c1:1`.

## Library

```rust
let circuit = ProcessCircuit::spawn(Command::new("node").args(["circuit/server.js", "diagram.json"]))?;
let mut bridge = Bridge::new(&diagram, &flash, &rom, circuit)?;
bridge.run_until_serial("ready", 2.0)?;
bridge.circuit().request(&json!({ "cmd": "set", "name": "btn1.pressed", "value": 1 }))?;
bridge.run_for(0.1)?;
```

The board part in the diagram selects the chip. `rom_elf(&diagram)` gives
the name of the mask ROM file that the chip boots from.

A `Circuit` is anything that can set a pin drive and advance in time.
`ProcessCircuit` speaks the process protocol. `DeferredCircuit` is for an
async circuit, such as ngspice in a browser: the caller replays the drives
after each `run_for` and gives back the pin voltages.

## How it works

- **Pins.** Each GPIO pin of the board part that connects to a circuit part
  is a board pin, for example `esp:2`. Pin names are in
  [docs/circuit-format.md](../docs/circuit-format.md#boards).
- **Time.** The ESP32 is the clock. The circuit advances every 100 µs of
  emulated time, and after each drive change.
- **Outputs.** esp32sim calls the bridge at each GPIO output or output-enable
  write. The bridge advances the circuit to that exact time, then changes
  the pin drive: 3.3 V or 0 V through 40 Ω.
- **Inputs.** At each GPIO read, the input level comes from the pin voltage
  at the last circuit step. Above 0.75 × 3.3 V is high, below 0.25 × 3.3 V
  is low, and between them the level does not change.
- **Pulls and PWM.** The bridge reads the pulls (IO_MUX, and RTC IO on the
  classic ESP32) and the PWM (LEDC, and MCPWM on the S3 and C6) of each pin
  every 1 µs. A pull is 45 kΩ to 3.3 V or 0 V. A PWM pin gives its
  frequency and duty to the circuit, and ngspice makes the edges.
- **ADC.** The ADC input of a pin is its voltage at the last circuit step.
- **Serial.** UART0 output is in `Bridge::serial`. `Bridge::serial_input`
  sends bytes to UART0.

## Limits

- The chips are the classic ESP32 (`board-esp32-devkit-c-v4` and
  `wokwi-esp32-devkit-v1`), the ESP32-S3 (`board-esp32-s3-devkitc-1`), the
  ESP32-C3 (`board-esp32-c3-devkitm-1`) and the ESP32-C6
  (`board-esp32-c6-devkitc-1`). esp32sim rates the C3 and C6 as drafts, so
  some firmware may not boot on them.
- An input sees the circuit up to 100 µs late.
- Only GPIO levels (push-pull and open-drain) and LEDC PWM go to the
  circuit. I2C, SPI, UART and RMT signals and the DAC do not: a pin that
  the GPIO matrix gives to one of them has only its pulls in the circuit.

## Test

```sh
cd bridge && cargo test
```

The tests need the ROM, Node, `npm install` and libngspice.
