//! A C ABI over `esp_bridge::Bridge<DeferredCircuit>` for web/sim-worker.js.
//!
//! The host writes inputs into memory from `esp_web_alloc`. Text results go
//! to an output buffer, which the host reads with `esp_web_out_ptr` and
//! `esp_web_out_len`. The module holds one bridge.

use std::cell::{Cell, RefCell};

use esp_bridge::{Bridge, DeferredCircuit};
use serde_json::json;

thread_local! {
    static BRIDGE: RefCell<Option<Bridge<DeferredCircuit>>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SERIAL_READ: Cell<usize> = const { Cell::new(0) };
}

/// Gives the host `len` bytes to write an input into. The module keeps it.
#[no_mangle]
pub extern "C" fn esp_web_alloc(len: usize) -> *mut u8 {
    Box::leak(vec![0u8; len].into_boxed_slice()).as_mut_ptr()
}

/// Frees memory from `esp_web_alloc`.
///
/// # Safety
/// `ptr` and `len` must come from one `esp_web_alloc` call.
#[no_mangle]
pub unsafe extern "C" fn esp_web_free(ptr: *mut u8, len: usize) {
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
}

#[no_mangle]
pub extern "C" fn esp_web_out_ptr() -> *const u8 {
    OUT.with_borrow(|out| out.as_ptr())
}

#[no_mangle]
pub extern "C" fn esp_web_out_len() -> usize {
    OUT.with_borrow(|out| out.len())
}

fn set_out(bytes: &[u8]) {
    OUT.with_borrow_mut(|out| {
        out.clear();
        out.extend_from_slice(bytes);
    });
}

/// Returns 0, or 1 with the error text in the output buffer.
fn status(result: Result<(), String>) -> u32 {
    match result {
        Ok(()) => 0,
        Err(e) => {
            set_out(e.as_bytes());
            1
        }
    }
}

/// # Safety
/// The pointer and length must give readable memory.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

fn with_bridge<T>(f: impl FnOnce(&mut Bridge<DeferredCircuit>) -> T) -> Result<T, String> {
    BRIDGE.with_borrow_mut(|b| b.as_mut().map(f).ok_or_else(|| "no bridge".into()))
}

/// Boots the ESP32 from the mask ROM with a merged flash image.
///
/// # Safety
/// Each pointer and length must give readable memory.
#[no_mangle]
pub unsafe extern "C" fn esp_web_new(
    diagram: *const u8,
    diagram_len: usize,
    flash: *const u8,
    flash_len: usize,
    rom: *const u8,
    rom_len: usize,
) -> u32 {
    let (diagram, flash, rom) = unsafe {
        (
            bytes(diagram, diagram_len),
            bytes(flash, flash_len),
            bytes(rom, rom_len),
        )
    };
    status((|| {
        let diagram = std::str::from_utf8(diagram).map_err(|e| e.to_string())?;
        let bridge = Bridge::new(diagram, flash, rom, DeferredCircuit::default())?;
        BRIDGE.set(Some(bridge));
        SERIAL_READ.set(0);
        Ok(())
    })())
}

#[no_mangle]
pub extern "C" fn esp_web_run_for(seconds: f64) -> u32 {
    status(with_bridge(|b| b.run_for(seconds)).and_then(|r| r))
}

#[no_mangle]
pub extern "C" fn esp_web_time() -> f64 {
    with_bridge(|b| b.time()).unwrap_or(0.0)
}

/// Puts the drive changes since the last call in the output buffer, as a
/// JSON array of {t, pin, volts, ohms, freqHz, duty}.
#[no_mangle]
pub extern "C" fn esp_web_take_drives() -> u32 {
    status(with_bridge(|b| {
        let drives: Vec<_> = b
            .circuit()
            .take_drives()
            .into_iter()
            .map(|(t, pin, d)| {
                let (freq_hz, duty) = d.pwm.unwrap_or((0.0, 0.0));
                json!({"t": t, "pin": pin, "volts": d.volts, "ohms": d.ohms,
                       "freqHz": freq_hz, "duty": duty})
            })
            .collect();
        set_out(json!(drives).to_string().as_bytes());
    }))
}

/// Sets the voltage at a board pin, such as "esp:2".
///
/// # Safety
/// The pointer and length must give readable memory.
#[no_mangle]
pub unsafe extern "C" fn esp_web_set_voltage(pin: *const u8, pin_len: usize, volts: f64) -> u32 {
    let pin = String::from_utf8_lossy(unsafe { bytes(pin, pin_len) }).into_owned();
    status(with_bridge(|b| b.circuit().set_voltage(&pin, volts)))
}

/// Puts the UART0 output since the last call in the output buffer.
#[no_mangle]
pub extern "C" fn esp_web_take_serial() -> u32 {
    status(with_bridge(|b| {
        let all = b.serial_bytes();
        let start = SERIAL_READ.get().min(all.len());
        set_out(&all[start..]);
        SERIAL_READ.set(all.len());
    }))
}
