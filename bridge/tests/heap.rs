//! Reads the free heap of the leaky example firmware, and checks it against
//! the values that the firmware prints.

mod common;

use common::StubCircuit;
use esp_bridge::{Bridge, Drive, Heap};

const EXAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/esp32-heap-leak");

/// Runs until a whole "PREFIX N free F min M" line comes, and returns its
/// heap.
fn printed(bridge: &mut Bridge<StubCircuit>, prefix: &str) -> Heap {
    assert!(
        bridge.run_until_serial(prefix, 0.5).unwrap(),
        "{}",
        bridge.serial()
    );
    while !bridge.serial().ends_with('\n') {
        bridge.run_for(1e-4).unwrap();
    }
    let serial = bridge.serial();
    let words: Vec<&str> = serial.lines().last().unwrap().split(' ').collect();
    Heap {
        free: words[3].parse().unwrap(),
        min_free: words[5].parse().unwrap(),
    }
}

#[test]
fn heap_matches_firmware_and_shows_leak() {
    let mut bridge = Bridge::new(
        &common::diagram(EXAMPLE),
        &common::flash(EXAMPLE),
        &common::rom(EXAMPLE),
        StubCircuit::default(),
    )
    .unwrap();
    assert_eq!(bridge.heap(), None);
    bridge
        .load_elf(&std::fs::read(format!("{EXAMPLE}/firmware.elf")).unwrap())
        .unwrap();
    let start = printed(&mut bridge, "ready");
    assert_eq!(bridge.heap(), Some(start));

    for n in 1..=3 {
        let press = Drive::new(0.0, 0.05);
        bridge.circuit().sources.insert("esp:4".into(), press);
        let heap = printed(&mut bridge, &format!("request {n} "));
        assert_eq!(bridge.heap(), Some(heap));
        bridge.circuit().sources.remove("esp:4");
        bridge.run_for(0.05).unwrap();
    }
    // Each request leaks 1000 bytes and a block header.
    let lost = start.free - bridge.heap().unwrap().free;
    assert!((3000..3200).contains(&lost), "lost {lost}");
}

#[test]
fn elf_without_heap_is_an_error() {
    let mut bridge = Bridge::new(
        &common::diagram(EXAMPLE),
        &common::flash(EXAMPLE),
        &common::rom(EXAMPLE),
        StubCircuit::default(),
    )
    .unwrap();
    let rom = common::rom(EXAMPLE);
    assert!(bridge
        .load_elf(&rom)
        .unwrap_err()
        .contains("registered_heaps"));
}
