//! Reads the free heap from ESP-IDF's own counters in emulated memory, so
//! that the firmware needs no code to report it.
//!
//! `registered_heaps` is a list of `heap_t`, one per memory region. From
//! ESP-IDF v5.5.4 components/heap/heap_private.h: `uint32_t caps[3];
//! intptr_t start, end; multi_heap_lock_t heap_mux (8 bytes);
//! multi_heap_handle_t heap; heap_t *next;`. The heap handle points to
//! `multi_heap_info` at the start of the region. Its words 1 and 2 are
//! `free_bytes` and `minimum_free_bytes` (multi_heap.c). With heap
//! poisoning, multi_heap_poisoning.c takes 12 bytes (POISON_OVERHEAD) off
//! each.

/// The free heap that `esp_get_free_heap_size()` and
/// `esp_get_minimum_free_heap_size()` give, in bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Heap {
    pub free: u32,
    pub min_free: u32,
}

/// The symbol of the list head.
pub(crate) const SYMBOL: &str = "registered_heaps";
/// A function of multi_heap_poisoning.c, which ESP-IDF builds only with
/// heap poisoning.
pub(crate) const POISONING_SYMBOL: &str = "poison_allocated_region";
pub(crate) const POISON_OVERHEAD: u32 = 12;
/// From components/heap/include/esp_heap_caps.h.
const MALLOC_CAP_DEFAULT: u32 = 1 << 12;
const START_OFFSET: u32 = 12;
const END_OFFSET: u32 = 16;
const HEAP_OFFSET: u32 = 28;
const NEXT_OFFSET: u32 = 32;
/// Stops the walk if the list is corrupt or the ELF is not of this firmware.
const MAX_HEAPS: usize = 64;

/// Adds up the heaps that `malloc` uses, as `heap_caps_get_free_size`
/// does. None before the firmware registers its heaps, or if the memory
/// does not have this layout.
/// `overhead` is what the firmware takes off each heap.
pub(crate) fn read(
    head: u32,
    overhead: u32,
    mut word: impl FnMut(u32) -> Option<u32>,
) -> Option<Heap> {
    let mut heap = Heap {
        free: 0,
        min_free: 0,
    };
    let mut node = word(head)?;
    if node == 0 {
        return None;
    }
    for _ in 0..MAX_HEAPS {
        if node == 0 {
            return Some(heap);
        }
        let caps = (0..3).try_fold(0, |all, i| Some(all | word(node + 4 * i)?))?;
        let info = word(node + HEAP_OFFSET)?;
        if !(word(node + START_OFFSET)?..word(node + END_OFFSET)?).contains(&info) {
            return None;
        }
        if caps & MALLOC_CAP_DEFAULT != 0 {
            heap.free += word(info + 4)?.saturating_sub(overhead);
            heap.min_free += word(info + 8)?.saturating_sub(overhead);
        }
        node = word(node + NEXT_OFFSET)?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn sums_default_heaps_only() {
        let head = 0x100;
        let mem: HashMap<u32, u32> = [
            (head, 0x200),
            // A DRAM heap with MALLOC_CAP_DEFAULT in its second caps word.
            (0x200, 0),
            (0x204, MALLOC_CAP_DEFAULT),
            (0x20c, 0x400),
            (0x210, 0x500),
            (0x21c, 0x400),
            (0x220, 0x300),
            // An IRAM-only heap.
            (0x300, 1),
            (0x30c, 0x500),
            (0x310, 0x600),
            (0x31c, 0x500),
            (0x320, 0),
            (0x404, 1000),
            (0x408, 900),
            (0x504, 7),
            (0x508, 7),
            // A heap whose handle is outside its region.
            (0x600, 0x700),
            (0x70c, 0x800),
            (0x710, 0x900),
            (0x71c, 0x400),
        ]
        .into();
        let word = |a| Some(mem.get(&a).copied().unwrap_or(0));
        assert_eq!(
            read(head, 0, word),
            Some(Heap {
                free: 1000,
                min_free: 900
            })
        );
        assert_eq!(
            read(head, POISON_OVERHEAD, word),
            Some(Heap {
                free: 988,
                min_free: 888
            })
        );
        // No heaps yet, or another layout.
        assert_eq!(read(0x999, 0, word), None);
        assert_eq!(read(0x600, 0, word), None);
    }
}
