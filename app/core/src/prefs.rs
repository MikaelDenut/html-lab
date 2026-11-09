use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

const TEXT_SIZE_MIN: f64 = 13.0;
const TEXT_SIZE_MAX: f64 = 24.0;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub tabs: Vec<String>,
    #[serde(default)]
    pub active: Option<String>,
    /// The My page side with these tabs: "shown" or "hidden" (WP3). Anything else is None.
    #[serde(default)]
    pub side: Option<String>,
}

pub const SIDE_SHOWN: &str = "shown";
pub const SIDE_HIDDEN: &str = "hidden";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub text_size: u32,
    pub save_place: Option<String>,
    pub tried: Vec<String>,
    pub typing_helpers: bool,
    pub autosave: bool,
    pub session: Option<Session>,
    pub window_size: Option<WindowSize>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            text_size: 16,
            save_place: None,
            tried: Vec::new(),
            typing_helpers: true,
            autosave: false,
            session: None,
            window_size: None,
        }
    }
}

pub fn load(path: &Path) -> Prefs {
    let mut prefs = Prefs::default();
    let Ok(text) = fs::read_to_string(path) else {
        return prefs;
    };
    let Ok(stored) = serde_json::from_str::<Value>(&text) else {
        return prefs;
    };
    merge(&mut prefs, &stored);
    prefs.window_size = stored
        .get("windowSize")
        .and_then(|size| serde_json::from_value(size.clone()).ok());
    if prefs
        .save_place
        .as_deref()
        .is_some_and(|place| !Path::new(place).is_dir())
    {
        prefs.save_place = None;
    }
    prefs
}

pub fn save(path: &Path, prefs: &Prefs) -> Result<(), String> {
    let text = serde_json::to_vec_pretty(prefs).map_err(|_| "cannot_write".to_string())?;
    if let Some(folder) = path.parent() {
        let _ = fs::create_dir_all(folder);
    }
    atomic_write(path, &text, false)
}

pub fn merge(prefs: &mut Prefs, patch: &Value) {
    if let Some(size) = patch.get("textSize").and_then(Value::as_f64) {
        prefs.text_size = size.round().clamp(TEXT_SIZE_MIN, TEXT_SIZE_MAX) as u32;
    }
    match patch.get("savePlace") {
        Some(Value::String(place)) => prefs.save_place = Some(place.clone()),
        Some(Value::Null) => prefs.save_place = None,
        _ => {}
    }
    if let Some(Ok(tried)) = patch
        .get("tried")
        .map(|tried| serde_json::from_value(tried.clone()))
    {
        prefs.tried = tried;
    }
    if let Some(on) = patch.get("typingHelpers").and_then(Value::as_bool) {
        prefs.typing_helpers = on;
    }
    if let Some(on) = patch.get("autosave").and_then(Value::as_bool) {
        prefs.autosave = on;
    }
    match patch.get("session") {
        Some(Value::Null) => prefs.session = None,
        Some(session) => {
            if let Ok(mut session) = serde_json::from_value::<Session>(session.clone()) {
                if !matches!(session.side.as_deref(), Some(SIDE_SHOWN | SIDE_HIDDEN)) {
                    session.side = None;
                }
                prefs.session = Some(session);
            }
        }
        None => {}
    }
}

pub fn set_window_size(prefs: &mut Prefs, w: f64, h: f64) {
    prefs.window_size = Some(WindowSize {
        width: w,
        height: h,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn defaults_match_the_contract() {
        let prefs = Prefs::default();
        assert_eq!(prefs.text_size, 16);
        assert_eq!(prefs.save_place, None);
        assert!(prefs.tried.is_empty());
        assert!(prefs.typing_helpers);
        assert!(!prefs.autosave);
        assert_eq!(prefs.session, None);
        assert_eq!(prefs.window_size, None);
    }

    #[test]
    fn a_missing_file_gives_defaults() {
        let dir = tempdir().unwrap();
        assert_eq!(load(&dir.path().join("prefs.json")), Prefs::default());
    }

    #[test]
    fn a_broken_file_gives_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        for broken in ["{ not json", "", "[1, 2]", "42", "null"] {
            fs::write(&path, broken).unwrap();
            assert_eq!(load(&path), Prefs::default(), "{broken}");
        }
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(load(&path), Prefs::default());
    }

    #[test]
    fn a_wrong_key_keeps_its_default_and_the_others_count() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        fs::write(
            &path,
            r#"{ "textSize": "huge", "autosave": true, "windowSize": 3 }"#,
        )
        .unwrap();
        let prefs = load(&path);
        assert_eq!(prefs.text_size, 16);
        assert!(prefs.autosave);
        assert_eq!(prefs.window_size, None);
    }

    #[test]
    fn a_stored_text_size_is_clamped() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        fs::write(&path, r#"{ "textSize": 99 }"#).unwrap();
        assert_eq!(load(&path).text_size, 24);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        let mut prefs = Prefs {
            text_size: 20,
            save_place: Some(dir.path().to_string_lossy().into_owned()),
            tried: vec!["inline-style".to_string()],
            typing_helpers: false,
            autosave: true,
            session: Some(Session {
                tabs: vec!["/a/b.html".to_string()],
                active: Some("/a/b.html".to_string()),
                side: Some("hidden".to_string()),
            }),
            window_size: None,
        };
        set_window_size(&mut prefs, 1200.0, 800.5);
        save(&path, &prefs).unwrap();
        assert_eq!(load(&path), prefs);
    }

    #[test]
    fn prefs_serialize_camel_case() {
        let value = serde_json::to_value(Prefs::default()).unwrap();
        assert_eq!(
            value,
            json!({
                "textSize": 16,
                "savePlace": null,
                "tried": [],
                "typingHelpers": true,
                "autosave": false,
                "session": null,
                "windowSize": null,
            })
        );
    }

    #[test]
    fn save_makes_the_config_folder_on_the_first_launch() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("app/config/prefs.json");
        save(&path, &Prefs::default()).unwrap();
        assert_eq!(load(&path), Prefs::default());
    }

    #[test]
    fn a_save_place_that_is_gone_comes_back_as_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        let place = dir.path().join("place");
        fs::create_dir(&place).unwrap();
        let prefs = Prefs {
            save_place: Some(place.to_string_lossy().into_owned()),
            ..Prefs::default()
        };
        save(&path, &prefs).unwrap();
        assert!(load(&path).save_place.is_some());
        fs::remove_dir(&place).unwrap();
        assert_eq!(load(&path).save_place, None);
    }

    #[test]
    fn merge_applies_only_the_keys_present() {
        let mut prefs = Prefs::default();
        merge(&mut prefs, &json!({ "autosave": true }));
        assert!(prefs.autosave);
        assert_eq!(prefs.text_size, 16);
        assert!(prefs.typing_helpers);

        merge(
            &mut prefs,
            &json!({
                "textSize": 18,
                "savePlace": "/somewhere",
                "tried": ["a", "b"],
                "typingHelpers": false,
                "session": { "tabs": ["/x.html"], "active": "/x.html" },
            }),
        );
        assert!(prefs.autosave);
        assert_eq!(prefs.text_size, 18);
        assert_eq!(prefs.save_place.as_deref(), Some("/somewhere"));
        assert_eq!(prefs.tried, ["a", "b"]);
        assert!(!prefs.typing_helpers);
        assert_eq!(prefs.session.as_ref().unwrap().tabs, ["/x.html"]);
        assert_eq!(
            prefs.session.as_ref().unwrap().active.as_deref(),
            Some("/x.html")
        );
    }

    #[test]
    fn merge_clamps_the_text_size() {
        let mut prefs = Prefs::default();
        merge(&mut prefs, &json!({ "textSize": 5 }));
        assert_eq!(prefs.text_size, 13);
        merge(&mut prefs, &json!({ "textSize": 100 }));
        assert_eq!(prefs.text_size, 24);
        merge(&mut prefs, &json!({ "textSize": -3 }));
        assert_eq!(prefs.text_size, 13);
        merge(&mut prefs, &json!({ "textSize": 17.4 }));
        assert_eq!(prefs.text_size, 17);
        merge(&mut prefs, &json!({ "textSize": 13 }));
        assert_eq!(prefs.text_size, 13);
        merge(&mut prefs, &json!({ "textSize": 24 }));
        assert_eq!(prefs.text_size, 24);
    }

    #[test]
    fn merge_never_touches_window_size() {
        let mut prefs = Prefs::default();
        merge(
            &mut prefs,
            &json!({ "windowSize": { "width": 1, "height": 2 } }),
        );
        assert_eq!(prefs.window_size, None);
        set_window_size(&mut prefs, 900.0, 700.0);
        merge(&mut prefs, &json!({ "windowSize": null }));
        assert_eq!(prefs.window_size.as_ref().unwrap().width, 900.0);
        assert_eq!(prefs.window_size.as_ref().unwrap().height, 700.0);
    }

    #[test]
    fn merge_ignores_unknown_keys_and_wrong_types() {
        let mut prefs = Prefs::default();
        merge(
            &mut prefs,
            &json!({
                "nonsense": 1,
                "textSize": "big",
                "savePlace": 3,
                "tried": "not a list",
                "typingHelpers": "no",
                "autosave": 1,
                "session": 5,
            }),
        );
        assert_eq!(prefs, Prefs::default());
    }

    #[test]
    fn merge_can_clear_with_null() {
        let mut prefs = Prefs {
            save_place: Some("/x".to_string()),
            session: Some(Session {
                tabs: Vec::new(),
                active: None,
                side: None,
            }),
            ..Prefs::default()
        };
        merge(&mut prefs, &json!({ "savePlace": null, "session": null }));
        assert_eq!(prefs.save_place, None);
        assert_eq!(prefs.session, None);
    }

    #[test]
    fn a_session_side_defaults_to_none() {
        let mut prefs = Prefs::default();
        merge(
            &mut prefs,
            &json!({ "session": { "tabs": ["/x.py"], "active": "/x.py" } }),
        );
        assert_eq!(prefs.session.as_ref().unwrap().side, None);
        let old: Session = serde_json::from_value(json!({ "tabs": ["/x.py"] })).unwrap();
        assert_eq!(old.side, None);
    }

    #[test]
    fn a_session_side_round_trips_with_its_tabs() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        for side in ["shown", "hidden"] {
            let mut prefs = Prefs::default();
            merge(
                &mut prefs,
                &json!({ "session": { "tabs": ["/a/run.py"], "active": "/a/run.py", "side": side } }),
            );
            assert_eq!(prefs.session.as_ref().unwrap().side.as_deref(), Some(side));
            save(&path, &prefs).unwrap();
            let back = load(&path);
            assert_eq!(back, prefs);
            assert_eq!(
                serde_json::to_value(back.session.unwrap()).unwrap(),
                json!({ "tabs": ["/a/run.py"], "active": "/a/run.py", "side": side })
            );
        }
    }

    #[test]
    fn a_strange_session_side_becomes_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        for side in [json!("Hidden"), json!("gone"), json!(""), json!(null)] {
            let mut prefs = Prefs::default();
            merge(&mut prefs, &json!({ "session": { "tabs": ["/a.txt"], "side": side } }));
            let session = prefs.session.as_ref().unwrap();
            assert_eq!(session.tabs, ["/a.txt"], "{side}");
            assert_eq!(session.side, None, "{side}");
        }
        fs::write(
            &path,
            r#"{ "session": { "tabs": ["/a.txt"], "side": "sideways" } }"#,
        )
        .unwrap();
        assert_eq!(load(&path).session.unwrap().side, None);
        // A side of the wrong type drops the whole session, as any wrong session does.
        let mut prefs = Prefs::default();
        merge(&mut prefs, &json!({ "session": { "tabs": ["/a.txt"], "side": 3 } }));
        assert_eq!(prefs.session, None);
    }
}
