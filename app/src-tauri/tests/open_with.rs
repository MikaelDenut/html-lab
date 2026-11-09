// The Open With file types are listed in four places: the macOS config, the Linux
// config, the Windows installer hooks and the README. This test reads all four and
// checks they name the same endings, so one place cannot drift from the others.
//
// Teeth: take the `!insertmacro HL_ADD_TYPE "md"` line out of windows/file-types.nsh
// and `open_with_types_match_everywhere` fails on the Windows set.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

fn here(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn read(rel: &str) -> String {
    let path = here(rel);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn json(rel: &str) -> serde_json::Value {
    serde_json::from_str(&read(rel)).unwrap_or_else(|e| panic!("{rel} is not JSON: {e}"))
}

fn associations(conf: &serde_json::Value, rel: &str) -> Vec<serde_json::Value> {
    conf["bundle"]["fileAssociations"]
        .as_array()
        .unwrap_or_else(|| panic!("{rel} has no bundle.fileAssociations list"))
        .clone()
}

fn exts_of(entry: &serde_json::Value) -> Vec<String> {
    entry["ext"]
        .as_array()
        .map(|a| a.iter().filter_map(|e| e.as_str()).map(str::to_string).collect())
        .unwrap_or_default()
}

/// Endings from a Tauri config. Entries with an empty `ext` (the macOS folder entry)
/// are not file types and are skipped.
fn config_set(rel: &str) -> BTreeSet<String> {
    let conf = json(rel);
    associations(&conf, rel).iter().flat_map(exts_of).collect()
}

/// Endings from the Windows installer hooks: one set from HL_ADD_TYPE lines and one
/// from HL_REMOVE_TYPE lines.
fn nsh_sets() -> (BTreeSet<String>, BTreeSet<String>) {
    let text = read("windows/file-types.nsh");
    let mut add = BTreeSet::new();
    let mut remove = BTreeSet::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("!insertmacro ") else { continue };
        let mut parts = rest.split_whitespace();
        let (Some(name), Some(arg)) = (parts.next(), parts.next()) else { continue };
        let ext = arg.trim_matches('"').to_string();
        match name {
            "HL_ADD_TYPE" => add.insert(ext),
            "HL_REMOVE_TYPE" => remove.insert(ext),
            _ => false,
        };
    }
    (add, remove)
}

/// Endings from the README sentence that tells people how to use Open With: every
/// `.ext` written in backticks on that line.
fn readme_set() -> BTreeSet<String> {
    let text = read("../../README.md");
    let lines: Vec<&str> = text.lines().filter(|l| l.contains("choose Open With")).collect();
    assert_eq!(lines.len(), 1, "README.md must have exactly one Open With line, found {}", lines.len());
    lines[0]
        .split('`')
        .skip(1)
        .step_by(2)
        .filter_map(|code| code.strip_prefix('.'))
        .map(str::to_string)
        .collect()
}

#[test]
fn open_with_types_match_everywhere() {
    let mac = config_set("tauri.macos.conf.json");
    let linux = config_set("tauri.linux.conf.json");
    let (win_add, win_remove) = nsh_sets();
    let readme = readme_set();

    for must in ["html", "htm", "css", "js", "json", "md", "txt"] {
        assert!(mac.contains(must), "macOS config lacks {must}: {mac:?}");
    }
    assert_eq!(linux, mac, "Linux config and macOS config differ");
    assert_eq!(win_add, mac, "Windows HL_ADD_TYPE lines and macOS config differ");
    assert_eq!(win_remove, mac, "Windows HL_REMOVE_TYPE lines and macOS config differ");
    assert_eq!(readme, mac, "README Open With line and macOS config differ");
}

#[test]
fn new_text_types_are_never_the_default_on_macos() {
    let rel = "tauri.macos.conf.json";
    let conf = json(rel);
    for entry in associations(&conf, rel) {
        let exts = exts_of(&entry);
        if exts.iter().any(|e| ["js", "json", "md", "txt"].contains(&e.as_str())) {
            assert_eq!(entry["rank"], "Alternate", "{exts:?} must have rank Alternate");
            assert_eq!(entry["role"], "Editor", "{exts:?} must have role Editor");
        }
    }
}

#[test]
fn linux_mime_types_for_text_files() {
    let rel = "tauri.linux.conf.json";
    let conf = json(rel);
    let mimes: BTreeSet<String> = associations(&conf, rel)
        .iter()
        .filter_map(|e| e["mimeType"].as_str().map(str::to_string))
        .collect();
    for must in ["text/javascript", "application/json", "text/markdown", "text/plain"] {
        assert!(mimes.contains(must), "Linux config lacks {must}: {mimes:?}");
    }
}
