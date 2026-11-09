// Counts of folder reads, so a test can see that a huge folder is read once and capped (C48).
// scan_folder, the folder listing of plan_open and folder_stamp count here; nothing else does.
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

static READ_DIRS: AtomicU64 = AtomicU64::new(0);
static ENTRIES_READ: AtomicU64 = AtomicU64::new(0);
static STATS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCounts {
    pub read_dirs: u64,
    pub entries_read: u64,
    pub stats: u64,
}

#[cfg(test)]
thread_local! {
    // Tests run side by side, so each test thread also keeps its own counts.
    static LOCAL: std::cell::Cell<FsCounts> = const {
        std::cell::Cell::new(FsCounts { read_dirs: 0, entries_read: 0, stats: 0 })
    };
}

#[cfg(test)]
fn local_add(add: impl Fn(&mut FsCounts)) {
    LOCAL.with(|cell| {
        let mut counts = cell.get();
        add(&mut counts);
        cell.set(counts);
    });
}

pub(crate) fn read_dir() {
    READ_DIRS.fetch_add(1, Ordering::Relaxed);
    #[cfg(test)]
    local_add(|c| c.read_dirs += 1);
}

pub(crate) fn entry() {
    ENTRIES_READ.fetch_add(1, Ordering::Relaxed);
    #[cfg(test)]
    local_add(|c| c.entries_read += 1);
}

pub(crate) fn stat() {
    STATS.fetch_add(1, Ordering::Relaxed);
    #[cfg(test)]
    local_add(|c| c.stats += 1);
}

// The counts since the last reset. With reset, they start again from zero.
pub fn fs_counts(reset: bool) -> FsCounts {
    let take = |counter: &AtomicU64| {
        if reset {
            counter.swap(0, Ordering::Relaxed)
        } else {
            counter.load(Ordering::Relaxed)
        }
    };
    FsCounts {
        read_dirs: take(&READ_DIRS),
        entries_read: take(&ENTRIES_READ),
        stats: take(&STATS),
    }
}

#[cfg(test)]
pub(crate) fn local_counts(reset: bool) -> FsCounts {
    LOCAL.with(|cell| {
        let counts = cell.get();
        if reset {
            cell.set(FsCounts::default());
        }
        counts
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_add_up_and_reset_to_zero() {
        local_counts(true);
        read_dir();
        entry();
        entry();
        stat();
        stat();
        stat();
        let here = local_counts(true);
        assert_eq!(
            here,
            FsCounts {
                read_dirs: 1,
                entries_read: 2,
                stats: 3
            }
        );
        assert_eq!(local_counts(false), FsCounts::default());

        let all = fs_counts(false);
        assert!(all.read_dirs >= 1 && all.entries_read >= 2 && all.stats >= 3);
    }

    #[test]
    fn counts_serialize_camel_case() {
        let value = serde_json::to_value(FsCounts {
            read_dirs: 1,
            entries_read: 2,
            stats: 3,
        })
        .unwrap();
        assert_eq!(value["readDirs"], 1);
        assert_eq!(value["entriesRead"], 2);
        assert_eq!(value["stats"], 3);
    }
}
