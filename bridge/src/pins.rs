//! Finds the ESP32 board in a diagram.json and the GPIO of each wired pin.

use serde_json::Value;

/// A board pin that is wired to the circuit.
#[derive(Clone, Debug, PartialEq)]
pub struct BoardPin {
    /// The pin reference, such as "esp:2".
    pub name: String,
    pub gpio: u8,
}

/// Returns the GPIO pins of the ESP32 board that connect to circuit parts.
pub fn board_pins(diagram: &Value) -> Result<Vec<BoardPin>, String> {
    let board = diagram["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|part| part["type"].as_str().is_some_and(is_board))
        .ok_or("diagram.json has no ESP32 board part")?;
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
            let Some(gpio) = end.strip_prefix(&prefix).and_then(|n| gpio(kind, n)) else {
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

fn is_board(kind: &str) -> bool {
    matches!(kind, "board-esp32-devkit-c-v4" | "wokwi-esp32-devkit-v1")
}

/// The GPIO behind a board pin name. Pin names are in docs/circuit-format.md.
fn gpio(kind: &str, name: &str) -> Option<u8> {
    let number = match (kind, name) {
        (_, "VP") => return Some(36),
        (_, "VN") => return Some(39),
        ("board-esp32-devkit-c-v4", "TX") | ("wokwi-esp32-devkit-v1", "TX0") => return Some(1),
        ("board-esp32-devkit-c-v4", "RX") | ("wokwi-esp32-devkit-v1", "RX0") => return Some(3),
        ("wokwi-esp32-devkit-v1", "TX2") => return Some(17),
        ("wokwi-esp32-devkit-v1", "RX2") => return Some(16),
        ("board-esp32-devkit-c-v4", n) => n,
        (_, n) => n.strip_prefix('D')?,
    };
    // Digits only: "D2" on the C-V4 board is a flash pin, not GPIO 2.
    if !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // GPIO 6 to 11 connect to the flash chip.
    number
        .parse()
        .ok()
        .filter(|&n| n <= 39 && !(6..=11).contains(&n))
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
        let kind = "wokwi-esp32-devkit-v1";
        assert_eq!(gpio(kind, "D23"), Some(23));
        assert_eq!(gpio(kind, "TX2"), Some(17));
        assert_eq!(gpio(kind, "RX0"), Some(3));
        assert_eq!(gpio(kind, "23"), None);
        assert_eq!(gpio(kind, "VIN"), None);
    }

    #[test]
    fn needs_a_board() {
        let diagram = json!({ "parts": [], "connections": [] });
        assert!(board_pins(&diagram).is_err());
    }
}
