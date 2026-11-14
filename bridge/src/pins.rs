//! Finds the ESP32 board in a diagram.json and the GPIO of each wired pin.

use serde_json::Value;

use crate::chip::{self, ChipEntry};

/// A board pin that is wired to the circuit.
#[derive(Clone, Debug, PartialEq)]
pub struct BoardPin {
    /// The pin reference, such as "esp:2".
    pub name: String,
    pub gpio: u8,
}

/// The ESP32 board part and its chip.
fn board(diagram: &Value) -> Result<(&Value, ChipEntry), String> {
    diagram["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|part| Some((part, chip::for_board(part["type"].as_str()?)?)))
        .ok_or_else(|| "diagram.json has no ESP32 board part".into())
}

/// The chip on the board.
pub(crate) fn chip(diagram: &Value) -> Result<ChipEntry, String> {
    Ok(board(diagram)?.1)
}

/// Returns the GPIO pins of the ESP32 board that connect to circuit parts.
pub fn board_pins(diagram: &Value) -> Result<Vec<BoardPin>, String> {
    let (board, chip) = board(diagram)?;
    let kind = board["type"].as_str().unwrap();
    let prefix = format!("{}:", board["id"].as_str().ok_or("board part has no id")?);
    let mut pins: Vec<BoardPin> = Vec::new();
    for connection in diagram["connections"].as_array().into_iter().flatten() {
        let ends = [connection[0].as_str(), connection[1].as_str()];
        let [Some(a), Some(b)] = ends else { continue };
        // A part id that starts with "$" is not in the circuit.
        if a.starts_with('$') || b.starts_with('$') {
            continue;
        }
        for end in [a, b] {
            let Some(gpio) = end
                .strip_prefix(&prefix)
                .and_then(|n| gpio(kind, n, chip.usable))
            else {
                continue;
            };
            if !pins.iter().any(|p| p.name == end) {
                pins.push(BoardPin {
                    name: end.to_string(),
                    gpio,
                });
            }
        }
    }
    Ok(pins)
}

/// The GPIO behind a board pin name. Pin names are in docs/circuit-format.md.
fn gpio(kind: &str, name: &str, usable: fn(u8) -> bool) -> Option<u8> {
    let number = match (kind, name) {
        (_, "VP") => return Some(36),
        (_, "VN") => return Some(39),
        ("board-esp32-s3-devkitc-1", "TX") => return Some(43),
        ("board-esp32-s3-devkitc-1", "RX") => return Some(44),
        ("board-esp32-c3-devkitm-1", "TX") => return Some(21),
        ("board-esp32-c3-devkitm-1", "RX") => return Some(20),
        ("board-esp32-c6-devkitc-1", "TX") => return Some(16),
        ("board-esp32-c6-devkitc-1", "RX") => return Some(17),
        ("board-esp32-devkit-c-v4", "TX") | ("wokwi-esp32-devkit-v1", "TX0") => return Some(1),
        ("board-esp32-devkit-c-v4", "RX") | ("wokwi-esp32-devkit-v1", "RX0") => return Some(3),
        ("wokwi-esp32-devkit-v1", "TX2") => return Some(17),
        ("wokwi-esp32-devkit-v1", "RX2") => return Some(16),
        ("wokwi-esp32-devkit-v1", n) => n.strip_prefix('D')?,
        (_, n) => n,
    };
    // Digits only: "D2" on the C-V4 board is a flash pin, not GPIO 2.
    if !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    number.parse().ok().filter(|&n| usable(n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_wired_pins_of_each_board() {
        let diagram = json!({
            "parts": [
                { "type": "wokwi-led", "id": "led1" },
                { "type": "board-esp32-devkit-c-v4", "id": "esp" },
            ],
            "connections": [
                ["esp:2", "led1:A", "green", []],
                ["led1:C", "esp:GND.1", "black", []],
                ["esp:TX", "$serialMonitor:RX", "", []],
                ["esp:VP", "led1:A", "", []],
                ["esp:D2", "led1:A", "", []],
                ["esp:2", "led1:A", "", []],
            ],
        });
        let pins = board_pins(&diagram).unwrap();
        let pins: Vec<_> = pins.iter().map(|p| (p.name.as_str(), p.gpio)).collect();
        assert_eq!(pins, [("esp:2", 2), ("esp:VP", 36)]);
    }

    #[test]
    fn maps_devkit_v1_names() {
        let pin = |name| usable_gpio("wokwi-esp32-devkit-v1", name);
        assert_eq!(pin("D23"), Some(23));
        assert_eq!(pin("TX2"), Some(17));
        assert_eq!(pin("RX0"), Some(3));
        assert_eq!(pin("D6"), None);
        assert_eq!(pin("23"), None);
        assert_eq!(pin("VIN"), None);
    }

    #[test]
    fn maps_s3_names() {
        let pin = |name| usable_gpio("board-esp32-s3-devkitc-1", name);
        assert_eq!(pin("48"), Some(48));
        assert_eq!(pin("TX"), Some(43));
        assert_eq!(pin("RX"), Some(44));
        assert_eq!(pin("26"), None);
        assert_eq!(pin("3V3.1"), None);
    }

    #[test]
    fn maps_c3_and_c6_names() {
        let c3 = |name| usable_gpio("board-esp32-c3-devkitm-1", name);
        assert_eq!(c3("TX"), Some(21));
        assert_eq!(c3("RX"), Some(20));
        assert_eq!(c3("10"), Some(10));
        assert_eq!(c3("12"), None);
        let c6 = |name| usable_gpio("board-esp32-c6-devkitc-1", name);
        assert_eq!(c6("TX"), Some(16));
        assert_eq!(c6("RX"), Some(17));
        assert_eq!(c6("23"), Some(23));
        assert_eq!(c6("24"), None);
    }

    fn usable_gpio(kind: &str, name: &str) -> Option<u8> {
        gpio(kind, name, chip::for_board(kind).unwrap().usable)
    }

    #[test]
    fn needs_a_board() {
        let diagram = json!({ "parts": [], "connections": [] });
        assert!(board_pins(&diagram).is_err());
    }
}
