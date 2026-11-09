use crate::kinds::KINDS;
use serde::Serialize;
use std::fs;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

const MAX_NAME_CHARS: usize = 60;
const MAX_NAME_BYTES: usize = 255;
const WINDOWS_BAD_CHARS: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

pub fn clean_file_name(raw: &str) -> String {
    let stem = clean_stem(raw);
    let mut stem = stem.as_str();
    for ext in KINDS.iter().flat_map(|k| k.extensions) {
        if let Some(rest) = stem
            .strip_suffix(ext)
            .and_then(|rest| rest.strip_suffix('.'))
        {
            stem = rest;
            break;
        }
    }

    stem.chars().take(MAX_NAME_CHARS).collect()
}

// Lowercase, Finnish letters mapped, space runs to one dash, other characters dropped,
// leading dots stripped. No ending is stripped and nothing is cut.
fn clean_stem(raw: &str) -> String {
    let mut stem = String::with_capacity(raw.len());
    let mut in_space = false;
    for c in raw.trim().to_lowercase().chars() {
        if c.is_whitespace() {
            if !in_space {
                stem.push('-');
            }
            in_space = true;
            continue;
        }
        in_space = false;
        let mapped = match c {
            'ä' | 'å' => 'a',
            'ö' => 'o',
            'ü' => 'u',
            'é' | 'è' => 'e',
            other => other,
        };
        if mapped.is_ascii_lowercase() || mapped.is_ascii_digit() || "._-".contains(mapped) {
            stem.push(mapped);
        }
    }
    stem.trim_start_matches('.').to_string()
}

/// Why a new name for a file is refused. Serialized as `{ "code": "...", "char": "..." }`;
/// `char` is there only for `bad_char`. The UI shows the copy-table field message:
///
/// | code         | field message (copy table, "Change a name")                          |
/// |--------------|-----------------------------------------------------------------------|
/// | `empty`      | Type a name first.                                                     |
/// | `dots`       | A name cannot end with a dot.                                          |
/// | `space_edge` | A name cannot start or end with a space.                               |
/// | `bad_char`   | A name cannot have {char} in it.  ({char} = the `char` field)          |
/// | `too_long`   | This name is too long. Make it shorter.                                |
/// | `reserved`   | {name} is a name the computer keeps for itself. Pick another name.     |
///
/// `char` for `bad_char` is the character itself (`/`, a backslash, `<` ...), except for a control
/// character or NUL, which cannot be seen: then it is written as `U+0009` style text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NameProblem {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub char: Option<String>,
}

impl NameProblem {
    fn new(code: &'static str) -> Self {
        NameProblem { code, char: None }
    }
}

/// The name a file will get when the user types `new` as the new name of `old`.
/// Ok holds the name that will be used: for names ending in .html, .htm or .css (any case)
/// the web cleaner's result plus the lowercase ending; for every other name `new` as typed.
/// A `new` equal to `old` is always Ok(old), so a file opened with an untidy name is never
/// renamed just by pressing Enter.
pub fn check_rename(old: &str, new: &str) -> Result<String, NameProblem> {
    check_rename_for(old, new, cfg!(windows))
}

/// check_rename with the platform as a parameter, so tests can run both rule sets anywhere.
pub fn check_rename_for(old: &str, new: &str, windows: bool) -> Result<String, NameProblem> {
    if new == old {
        return Ok(old.to_string());
    }
    if new.trim().is_empty() {
        return Err(NameProblem::new("empty"));
    }
    let name = match web_ending(new) {
        Some((stem, ending)) => {
            let stem: String = clean_stem(stem).chars().take(MAX_NAME_CHARS).collect();
            if stem.is_empty() {
                return Err(NameProblem::new("empty"));
            }
            format!("{stem}.{ending}")
        }
        None => new.to_string(),
    };
    if let Some(bad) = name.chars().find(|c| bad_char(*c, windows)) {
        let shown = if bad.is_control() {
            format!("U+{:04X}", bad as u32)
        } else {
            bad.to_string()
        };
        return Err(NameProblem {
            code: "bad_char",
            char: Some(shown),
        });
    }
    if name.ends_with('.') {
        return Err(NameProblem::new("dots"));
    }
    if name.starts_with(char::is_whitespace) || name.ends_with(char::is_whitespace) {
        return Err(NameProblem::new("space_edge"));
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(NameProblem::new("too_long"));
    }
    if windows && windows_reserved(&name) {
        return Err(NameProblem::new("reserved"));
    }
    Ok(name)
}

// The stem and the lowercase ending of a name with a teaching kind's ending (.html, .htm, .css).
fn web_ending(name: &str) -> Option<(&str, String)> {
    let (stem, ending) = name.rsplit_once('.')?;
    let ending = ending.to_ascii_lowercase();
    let web = KINDS.iter().flat_map(|k| k.extensions).any(|e| *e == ending);
    web.then_some((stem, ending))
}

fn bad_char(c: char, windows: bool) -> bool {
    c == '/' || c == '\\' || c.is_control() || (windows && WINDOWS_BAD_CHARS.contains(&c))
}

// The form two names are compared in: NFC, then lowercase.
fn folded(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

fn nfc(name: &str) -> String {
    name.nfc().collect()
}

pub fn clean_project_name(raw: &str) -> String {
    let mut replaced = raw.trim().replace(['/', ':'], "-");
    if cfg!(windows) {
        replaced = replaced.replace(['\\', '<', '>', '"', '|', '?', '*'], "-");
    }
    let stripped = replaced.trim_start_matches(|c: char| c == '.' || c.is_whitespace());
    let cut: String = stripped.chars().take(MAX_NAME_CHARS).collect();
    let done = cut.trim_end();
    if !cfg!(windows) {
        return done.to_string();
    }
    let done = done.trim_end_matches(['.', ' ']);
    if windows_reserved(done) {
        format!("{done}-project")
    } else {
        done.to_string()
    }
}

pub fn windows_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// Is `file` free in `folder` and among the open `tabs` (names compared ignoring case, after NFC)?
/// `except` is the current name of a file being renamed. It is left out of the tab list and
/// the disk check ONLY when `file` equals it ignoring case (a case-only rename, such as
/// notes.txt to Notes.txt). Every other match, in a tab or on disk, still counts as taken.
pub fn file_name_free(tabs: &[String], folder: Option<&Path>, file: &str, except: Option<&str>) -> bool {
    if cfg!(windows) && windows_reserved(file) {
        return false;
    }
    let wanted = folded(file);
    let own = except.filter(|old| folded(old) == wanted).map(nfc);
    let is_own = |name: &str| own.as_deref() == Some(nfc(name).as_str());
    if tabs.iter().any(|tab| folded(tab) == wanted && !is_own(tab)) {
        return false;
    }
    let Some(folder) = folder else {
        return true;
    };
    let direct = folder.join(file);
    if direct.symlink_metadata().is_ok() {
        let same = own
            .as_deref()
            .is_some_and(|old| same_entry(&direct, &folder.join(old)));
        if !same {
            return false;
        }
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return true;
    };
    !entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        folded(&name) == wanted && !is_own(&name)
    })
}

// Do two paths name the very same directory entry's file (a case-insensitive disk)?
fn same_entry(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (a.symlink_metadata(), b.symlink_metadata()) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (dunce::canonicalize(a), dunce::canonicalize(b)) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn file_name_lowercases_and_trims() {
        assert_eq!(clean_file_name("  Planets  "), "planets");
        assert_eq!(clean_file_name("MY_page.v2"), "my_page.v2");
    }

    #[test]
    fn file_name_maps_finnish_letters() {
        assert_eq!(clean_file_name("Äiti"), "aiti");
        assert_eq!(clean_file_name("Åland"), "aland");
        assert_eq!(clean_file_name("Pöytä"), "poyta");
        assert_eq!(clean_file_name("Müsli"), "musli");
        assert_eq!(clean_file_name("Café Crème"), "cafe-creme");
        assert_eq!(clean_file_name("po\u{308}yta\u{308}"), "poyta");
    }

    #[test]
    fn file_name_turns_space_runs_into_one_dash() {
        assert_eq!(clean_file_name("my  cool\t page"), "my-cool-page");
        assert_eq!(clean_file_name("a\u{a0}b"), "a-b");
    }

    #[test]
    fn file_name_drops_other_characters() {
        assert_eq!(clean_file_name("what?! a/b:c*d"), "what-abcd");
        assert_eq!(clean_file_name("日本語"), "");
        assert_eq!(clean_file_name("ok\u{1F600}ok"), "okok");
    }

    #[test]
    fn file_name_strips_leading_dots() {
        assert_eq!(clean_file_name(".hidden"), "hidden");
        assert_eq!(clean_file_name("...hidden.page"), "hidden.page");
        assert_eq!(clean_file_name("..."), "");
    }

    #[test]
    fn file_name_strips_a_trailing_extension_from_the_table() {
        assert_eq!(clean_file_name("Planets.HTML"), "planets");
        assert_eq!(clean_file_name("planets.htm"), "planets");
        assert_eq!(clean_file_name("style.css"), "style");
        assert_eq!(clean_file_name("a.css.html"), "a.css");
        assert_eq!(clean_file_name("notes.txt"), "notes.txt");
        assert_eq!(clean_file_name("html"), "html");
        assert_eq!(clean_file_name(".html"), "html");
        for kind in KINDS {
            for ext in kind.extensions {
                assert_eq!(clean_file_name(&format!("x.{ext}")), "x", "{ext}");
            }
        }
    }

    #[test]
    fn file_name_cuts_to_sixty() {
        assert_eq!(clean_file_name(&"a".repeat(80)).len(), 60);
        assert_eq!(
            clean_file_name(&format!("{}.html", "b".repeat(70))).len(),
            60
        );
        assert_eq!(
            clean_file_name(&format!("{}.html", "c".repeat(60))),
            "c".repeat(60)
        );
    }

    #[test]
    fn file_name_may_end_up_empty() {
        assert_eq!(clean_file_name(""), "");
        assert_eq!(clean_file_name("   "), "");
        assert_eq!(clean_file_name("?!*"), "");
    }

    #[test]
    fn project_name_keeps_letters_and_case() {
        assert_eq!(clean_project_name("  Space Club  "), "Space Club");
        assert_eq!(clean_project_name("Äidin Pöytä"), "Äidin Pöytä");
    }

    #[test]
    fn project_name_replaces_slash_and_colon() {
        assert_eq!(clean_project_name("a/b:c"), "a-b-c");
    }

    #[test]
    fn project_name_keeps_a_trailing_extension() {
        assert_eq!(clean_project_name("Site.html"), "Site.html");
    }

    #[test]
    fn project_name_strips_leading_dots() {
        assert_eq!(clean_project_name(".secret"), "secret");
        assert_eq!(clean_project_name("...secret.v2"), "secret.v2");
        assert_eq!(clean_project_name(".."), "");
        assert_eq!(clean_project_name(". .secret"), "secret");
    }

    #[test]
    fn project_name_cuts_to_sixty_characters_not_bytes() {
        let cut = clean_project_name(&"ä".repeat(80));
        assert_eq!(cut.chars().count(), 60);
        assert!(cut.chars().all(|c| c == 'ä'));
    }

    #[test]
    fn project_name_has_no_trailing_space_after_the_cut() {
        let raw = format!("{} tail", "a".repeat(59));
        assert_eq!(clean_project_name(&raw), "a".repeat(59));
    }

    #[test]
    fn project_name_may_end_up_empty() {
        assert_eq!(clean_project_name(""), "");
        assert_eq!(clean_project_name("   "), "");
        assert_eq!(clean_project_name(" . "), "");
    }

    #[test]
    fn cleaning_twice_changes_nothing() {
        let long = "y".repeat(99);
        for raw in ["Pöytä Lamppu.html", "...a b", "x.css.css", long.as_str()] {
            let once = clean_project_name(raw);
            assert_eq!(clean_project_name(&once), once);
        }
    }

    #[test]
    fn name_free_compares_tabs_ignoring_case() {
        let tabs = vec!["My-Page.html".to_string(), "style.css".to_string()];
        assert!(!file_name_free(&tabs, None, "my-page.html", None));
        assert!(!file_name_free(&tabs, None, "STYLE.CSS", None));
        assert!(file_name_free(&tabs, None, "planets.html", None));
        assert!(file_name_free(&[], None, "planets.html", None));
    }

    #[test]
    fn name_free_checks_the_disk_only_with_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("planets.html"), "x").unwrap();
        assert!(!file_name_free(&[], Some(dir.path()), "planets.html", None));
        assert!(!file_name_free(&[], Some(dir.path()), "PLANETS.html", None));
        assert!(file_name_free(&[], Some(dir.path()), "moons.html", None));
        assert!(file_name_free(&[], None, "planets.html", None));
    }

    #[cfg(unix)]
    #[test]
    fn name_free_counts_a_dangling_symlink_as_taken() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("nowhere", dir.path().join("link.html")).unwrap();
        assert!(!file_name_free(&[], Some(dir.path()), "link.html", None));
    }

    #[test]
    fn name_free_with_a_gone_folder_is_free() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone");
        assert!(file_name_free(&[], Some(&gone), "a.html", None));
    }

    fn refused(old: &str, new: &str, windows: bool) -> &'static str {
        check_rename_for(old, new, windows).unwrap_err().code
    }

    #[test]
    fn rename_keeps_case_and_characters_of_other_names() {
        for windows in [false, true] {
            assert_eq!(check_rename_for("a.txt", "My Notes.TXT", windows).unwrap(), "My Notes.TXT");
            assert_eq!(check_rename_for("a.py", "Pöytä_ÄÖ.py", windows).unwrap(), "Pöytä_ÄÖ.py");
            assert_eq!(check_rename_for("a.md", ".gitignore", windows).unwrap(), ".gitignore");
            assert_eq!(check_rename_for("a.md", "README", windows).unwrap(), "README");
            assert_eq!(check_rename_for("a.js", "game (2).js", windows).unwrap(), "game (2).js");
        }
    }

    #[test]
    fn rename_cleans_web_names_like_new_web_files() {
        for windows in [false, true] {
            assert_eq!(check_rename_for("a.html", "My Page.HTML", windows).unwrap(), "my-page.html");
            assert_eq!(check_rename_for("a.html", "Äiti ja Pöytä.htm", windows).unwrap(), "aiti-ja-poyta.htm");
            assert_eq!(check_rename_for("a.css", "Main Style!.CsS", windows).unwrap(), "main-style.css");
            assert_eq!(check_rename_for("a.txt", "what?/x.html", windows).unwrap(), "whatx.html");
            assert_eq!(check_rename_for("a.html", "a.css.html", windows).unwrap(), "a.css.html");
            assert_eq!(check_rename_for("a.html", "...hidden.html", windows).unwrap(), "hidden.html");
            let long = format!("{}.html", "b".repeat(70));
            assert_eq!(check_rename_for("a.html", &long, windows).unwrap(), format!("{}.html", "b".repeat(60)));
        }
        // Only the three web endings are cleaned; xhtml is another name.
        assert_eq!(check_rename_for("a.html", "My Page.xhtml", false).unwrap(), "My Page.xhtml");
    }

    #[test]
    fn rename_to_the_same_name_is_always_ok() {
        for windows in [false, true] {
            assert_eq!(check_rename_for("My Page.html", "My Page.html", windows).unwrap(), "My Page.html");
            assert_eq!(check_rename_for("x.", "x.", windows).unwrap(), "x.");
        }
    }

    #[test]
    fn rename_refuses_an_empty_name() {
        for windows in [false, true] {
            assert_eq!(refused("a.txt", "", windows), "empty");
            assert_eq!(refused("a.txt", "   ", windows), "empty");
            assert_eq!(refused("a.html", ".html", windows), "empty");
            assert_eq!(refused("a.html", "?!.html", windows), "empty");
            assert_eq!(refused("a.html", "日本.css", windows), "empty");
        }
    }

    #[test]
    fn rename_refuses_dots_only_and_a_trailing_dot() {
        for windows in [false, true] {
            assert_eq!(refused("a.txt", ".", windows), "dots");
            assert_eq!(refused("a.txt", "..", windows), "dots");
            assert_eq!(refused("a.txt", "....", windows), "dots");
            assert_eq!(refused("a.txt", "notes.", windows), "dots");
            assert_eq!(refused("a.txt", "notes.txt.", windows), "dots");
        }
    }

    #[test]
    fn rename_refuses_a_space_at_either_end() {
        for windows in [false, true] {
            assert_eq!(refused("a.txt", " notes.txt", windows), "space_edge");
            assert_eq!(refused("a.txt", "notes.txt ", windows), "space_edge");
            assert_eq!(refused("a.txt", "notes.txt\u{a0}", windows), "space_edge");
        }
        // A web name is cleaned instead, so its spaces never refuse it.
        assert_eq!(check_rename_for("a.html", " x y .html", false).unwrap(), "x-y.html");
    }

    #[test]
    fn rename_refuses_bad_characters_and_names_the_character() {
        for windows in [false, true] {
            for (name, shown) in [
                ("a/b.txt", "/"),
                ("a\\b.txt", "\\"),
                ("a\u{0}b.txt", "U+0000"),
                ("a\tb.txt", "U+0009"),
                ("a\nb.txt", "U+000A"),
                ("a\u{7f}b.txt", "U+007F"),
            ] {
                let problem = check_rename_for("x.txt", name, windows).unwrap_err();
                assert_eq!(problem.code, "bad_char", "{name:?}");
                assert_eq!(problem.char.as_deref(), Some(shown), "{name:?}");
            }
        }
        for bad in ['<', '>', ':', '"', '|', '?', '*'] {
            let name = format!("a{bad}b.txt");
            let problem = check_rename_for("x.txt", &name, true).unwrap_err();
            assert_eq!(problem.code, "bad_char");
            assert_eq!(problem.char, Some(bad.to_string()));
            assert_eq!(check_rename_for("x.txt", &name, false).unwrap(), name);
        }
    }

    #[test]
    fn rename_refuses_more_than_255_bytes() {
        for windows in [false, true] {
            let fits = format!("{}.txt", "a".repeat(251));
            assert_eq!(check_rename_for("x.txt", &fits, windows).unwrap(), fits);
            assert_eq!(refused("x.txt", &format!("{}.txt", "a".repeat(252)), windows), "too_long");
            // 128 two-byte letters are 256 bytes but only 128 characters.
            assert_eq!(refused("x.txt", &"ä".repeat(128), windows), "too_long");
        }
    }

    #[test]
    fn rename_refuses_reserved_names_on_windows_only() {
        for name in ["con", "CON.txt", "prn.md", "Aux", "nul.tar.gz", "com1.py", "LPT9.txt", "con.html"] {
            assert_eq!(refused("x.txt", name, true), "reserved", "{name}");
            assert!(check_rename_for("x.txt", name, false).is_ok(), "{name}");
        }
        for name in ["console.txt", "com.txt", "lpt10.txt", "icon.txt"] {
            assert!(check_rename_for("x.txt", name, true).is_ok(), "{name}");
        }
    }

    #[test]
    fn rename_problem_serializes_as_code_and_char() {
        let bad = check_rename_for("x.txt", "a/b", false).unwrap_err();
        assert_eq!(serde_json::to_string(&bad).unwrap(), r#"{"code":"bad_char","char":"/"}"#);
        let empty = check_rename_for("x.txt", "", false).unwrap_err();
        assert_eq!(serde_json::to_string(&empty).unwrap(), r#"{"code":"empty"}"#);
    }

    #[test]
    fn name_free_allows_a_case_only_rename_of_the_file_itself() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let tabs = vec!["notes.txt".to_string(), "story.html".to_string()];
        assert!(file_name_free(&tabs, Some(dir.path()), "Notes.txt", Some("notes.txt")));
        assert!(file_name_free(&tabs, Some(dir.path()), "NOTES.TXT", Some("notes.txt")));
        // Without except, the same check says taken, as before.
        assert!(!file_name_free(&tabs, Some(dir.path()), "Notes.txt", None));
    }

    #[test]
    fn name_free_with_except_still_counts_other_names_and_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        fs::write(dir.path().join("todo.txt"), "y").unwrap();
        let tabs = vec!["notes.txt".to_string(), "story.html".to_string()];
        // Another file on disk, another tab, and a name that is not a case change.
        assert!(!file_name_free(&tabs, Some(dir.path()), "todo.txt", Some("notes.txt")));
        assert!(!file_name_free(&tabs, Some(dir.path()), "Todo.txt", Some("notes.txt")));
        assert!(!file_name_free(&tabs, Some(dir.path()), "Story.html", Some("notes.txt")));
        assert!(file_name_free(&tabs, Some(dir.path()), "plan.txt", Some("notes.txt")));
        // Only tabs, no folder: the own tab is left out, another tab is not.
        assert!(file_name_free(&tabs, None, "NOTES.txt", Some("notes.txt")));
        assert!(!file_name_free(&tabs, None, "STORY.html", Some("notes.txt")));
    }

    #[test]
    fn name_free_with_except_counts_a_tab_that_only_differs_in_case() {
        // Two tabs, notes.txt (being renamed) and NOTES.txt (another file): the other one stays taken.
        let tabs = vec!["notes.txt".to_string(), "NOTES.txt".to_string()];
        assert!(!file_name_free(&tabs, None, "Notes.txt", Some("notes.txt")));
    }

    #[test]
    fn name_free_with_except_counts_another_file_that_only_differs_in_case() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let other = dir.path().join("NOTES.txt");
        let sensitive = other.symlink_metadata().is_err();
        if sensitive {
            // A case-sensitive disk can hold both names: the other file keeps its name taken.
            fs::write(&other, "y").unwrap();
            assert!(!file_name_free(&[], Some(dir.path()), "Notes.txt", Some("notes.txt")));
        }
        // On any disk, a case change of a file that is not the one being renamed is taken.
        fs::write(dir.path().join("plan.txt"), "z").unwrap();
        assert!(!file_name_free(&[], Some(dir.path()), "Plan.txt", Some("notes.txt")));
    }

    #[test]
    fn name_free_matches_nfd_and_nfc_names() {
        let tabs = vec!["pa\u{308}iva\u{308}.txt".to_string()];
        assert!(!file_name_free(&tabs, None, "päivä.txt", None));
        assert!(file_name_free(&tabs, None, "Päivä.txt", Some("pa\u{308}iva\u{308}.txt")));
    }
}
