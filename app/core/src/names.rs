use crate::kinds::KINDS;
use std::fs;
use std::path::Path;

const MAX_NAME_CHARS: usize = 60;

pub fn clean_file_name(raw: &str) -> String {
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

    let mut stem = stem.trim_start_matches('.');
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

pub fn file_name_free(tabs: &[String], folder: Option<&Path>, file: &str) -> bool {
    if cfg!(windows) && windows_reserved(file) {
        return false;
    }
    let wanted = file.to_lowercase();
    if tabs.iter().any(|tab| tab.to_lowercase() == wanted) {
        return false;
    }
    let Some(folder) = folder else {
        return true;
    };
    if folder.join(file).symlink_metadata().is_ok() {
        return false;
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return true;
    };
    !entries
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().to_lowercase() == wanted)
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
        assert!(!file_name_free(&tabs, None, "my-page.html"));
        assert!(!file_name_free(&tabs, None, "STYLE.CSS"));
        assert!(file_name_free(&tabs, None, "planets.html"));
        assert!(file_name_free(&[], None, "planets.html"));
    }

    #[test]
    fn name_free_checks_the_disk_only_with_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("planets.html"), "x").unwrap();
        assert!(!file_name_free(&[], Some(dir.path()), "planets.html"));
        assert!(!file_name_free(&[], Some(dir.path()), "PLANETS.html"));
        assert!(file_name_free(&[], Some(dir.path()), "moons.html"));
        assert!(file_name_free(&[], None, "planets.html"));
    }

    #[cfg(unix)]
    #[test]
    fn name_free_counts_a_dangling_symlink_as_taken() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("nowhere", dir.path().join("link.html")).unwrap();
        assert!(!file_name_free(&[], Some(dir.path()), "link.html"));
    }

    #[test]
    fn name_free_with_a_gone_folder_is_free() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone");
        assert!(file_name_free(&[], Some(&gone), "a.html"));
    }
}
