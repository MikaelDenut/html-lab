use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kind {
    pub id: &'static str,
    pub extensions: &'static [&'static str],
    pub label: &'static str,
    pub blurb: &'static str,
    pub default_stem: &'static str,
    pub primary_ext: &'static str,
    pub icon: &'static str,
    pub color_token: &'static str,
    pub language: &'static str,
    pub preview_mode: &'static str,
    pub is_page: bool,
    pub open_first: &'static str,
}

impl Kind {
    pub(crate) fn is_stylesheet(&self) -> bool {
        self.preview_mode == "swap"
    }
}

pub const KINDS: &[Kind] = &[
    Kind {
        id: "html",
        extensions: &["html", "htm"],
        label: "HTML page",
        blurb: "A new page",
        default_stem: "planets",
        primary_ext: "html",
        icon: "html-file",
        color_token: "html",
        language: "html",
        preview_mode: "morph",
        is_page: true,
        open_first: "Open an HTML page first.",
    },
    Kind {
        id: "css",
        extensions: &["css"],
        label: "CSS file",
        blurb: "A place for style",
        default_stem: "more-style",
        primary_ext: "css",
        icon: "css-file",
        color_token: "css",
        language: "css",
        preview_mode: "swap",
        is_page: false,
        open_first: "Open a CSS file first.",
    },
];

pub const PICTURES: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "heic", "tif", "tiff", "avif",
];

fn extension_of(file_name: &str) -> Option<&str> {
    Path::new(file_name).extension().and_then(|e| e.to_str())
}

pub fn kind_for_extension(ext: &str) -> Option<&'static Kind> {
    KINDS
        .iter()
        .find(|k| k.extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)))
}

pub fn kind_for_name(file_name: &str) -> Option<&'static Kind> {
    extension_of(file_name).and_then(kind_for_extension)
}

pub fn is_picture(file_name: &str) -> bool {
    extension_of(file_name).is_some_and(|ext| PICTURES.iter().any(|p| p.eq_ignore_ascii_case(ext)))
}

pub fn mime_for(file_name: &str) -> &'static str {
    let ext = extension_of(file_name).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScriptPolicy {
    Blocked,
    Run,
}

pub const SCRIPT_POLICY: ScriptPolicy = ScriptPolicy::Blocked;

pub fn csp_for(policy: ScriptPolicy, nonce: &str) -> String {
    let script_src = match policy {
        ScriptPolicy::Blocked => format!("script-src 'nonce-{nonce}'"),
        ScriptPolicy::Run => format!("script-src 'nonce-{nonce}' preview: 'unsafe-inline'"),
    };
    format!(
        "default-src 'none'; \
         img-src preview: data: https:; \
         media-src preview: data: https:; \
         font-src preview: data: https:; \
         style-src preview: 'unsafe-inline' https:; \
         {script_src}; \
         base-uri preview:; \
         form-action 'none'"
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub kinds: &'static [Kind],
    pub script_policy: ScriptPolicy,
}

pub fn app_config() -> AppConfig {
    AppConfig {
        kinds: KINDS,
        script_policy: SCRIPT_POLICY,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_has_two_rows_with_the_contract_values() {
        assert_eq!(KINDS.len(), 2);
        let html = &KINDS[0];
        assert_eq!(html.id, "html");
        assert_eq!(html.extensions, &["html", "htm"]);
        assert_eq!(html.label, "HTML page");
        assert_eq!(html.blurb, "A new page");
        assert_eq!(html.default_stem, "planets");
        assert_eq!(html.primary_ext, "html");
        assert_eq!(html.icon, "html-file");
        assert_eq!(html.color_token, "html");
        assert_eq!(html.language, "html");
        assert_eq!(html.preview_mode, "morph");
        assert!(html.is_page);
        assert_eq!(html.open_first, "Open an HTML page first.");

        let css = &KINDS[1];
        assert_eq!(css.id, "css");
        assert_eq!(css.extensions, &["css"]);
        assert_eq!(css.label, "CSS file");
        assert_eq!(css.blurb, "A place for style");
        assert_eq!(css.default_stem, "more-style");
        assert_eq!(css.primary_ext, "css");
        assert_eq!(css.icon, "css-file");
        assert_eq!(css.color_token, "css");
        assert_eq!(css.language, "css");
        assert_eq!(css.preview_mode, "swap");
        assert!(!css.is_page);
        assert_eq!(css.open_first, "Open a CSS file first.");
    }

    #[test]
    fn kind_lookup_ignores_case() {
        assert_eq!(kind_for_extension("HTM").map(|k| k.id), Some("html"));
        assert_eq!(kind_for_extension("Css").map(|k| k.id), Some("css"));
        assert!(kind_for_extension("js").is_none());
        assert!(kind_for_extension("").is_none());
        assert_eq!(kind_for_name("My.Page.HTML").map(|k| k.id), Some("html"));
        assert_eq!(kind_for_name("style.CSS").map(|k| k.id), Some("css"));
        assert!(kind_for_name("notes.txt").is_none());
        assert!(kind_for_name("html").is_none());
        assert!(kind_for_name(".css").is_none());
    }

    #[test]
    fn picture_list_matches_the_plan_in_any_case() {
        for name in [
            "a.png", "a.jpg", "a.jpeg", "a.gif", "a.svg", "a.webp", "a.bmp", "a.ico", "a.heic",
            "a.tif", "a.tiff", "a.avif", "A.PNG", "b.JpEg",
        ] {
            assert!(is_picture(name), "{name}");
        }
        assert_eq!(PICTURES.len(), 12);
        for name in ["a.html", "a.css", "a.txt", "png", ".png"] {
            assert!(!is_picture(name), "{name}");
        }
    }

    #[test]
    fn mime_table_matches_the_plan_in_any_case() {
        let cases = [
            ("a.html", "text/html; charset=utf-8"),
            ("a.htm", "text/html; charset=utf-8"),
            ("A.HTML", "text/html; charset=utf-8"),
            ("a.css", "text/css; charset=utf-8"),
            ("a.CsS", "text/css; charset=utf-8"),
            ("a.js", "text/javascript; charset=utf-8"),
            ("a.mjs", "text/javascript; charset=utf-8"),
            ("a.JS", "text/javascript; charset=utf-8"),
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.JPG", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.bmp", "image/bmp"),
            ("a.ico", "image/x-icon"),
            ("a.svg", "image/svg+xml"),
            ("a.SVG", "image/svg+xml"),
            ("a.woff", "font/woff"),
            ("a.woff2", "font/woff2"),
            ("a.ttf", "font/ttf"),
            ("a.otf", "font/otf"),
            ("a.txt", "application/octet-stream"),
            ("a.heic", "application/octet-stream"),
            ("noextension", "application/octet-stream"),
            ("", "application/octet-stream"),
        ];
        for (name, mime) in cases {
            assert_eq!(mime_for(name), mime, "{name}");
        }
    }

    #[test]
    fn csp_blocked_is_the_plans_line() {
        let csp = csp_for(ScriptPolicy::Blocked, "abc123");
        assert_eq!(
            csp,
            "default-src 'none'; img-src preview: data: https:; media-src preview: data: https:; \
             font-src preview: data: https:; style-src preview: 'unsafe-inline' https:; \
             script-src 'nonce-abc123'; base-uri preview:; form-action 'none'"
        );
        assert!(!csp.contains('\n'));
    }

    #[test]
    fn csp_run_opens_scripts_for_the_later_version() {
        let csp = csp_for(ScriptPolicy::Run, "xyz");
        assert!(csp.contains("script-src 'nonce-xyz' preview: 'unsafe-inline';"));
        assert!(!csp.contains('\n'));
        assert!(csp.starts_with("default-src 'none';"));
        assert!(csp.ends_with("form-action 'none'"));
    }

    #[test]
    fn policy_is_blocked_and_serializes_lowercase() {
        assert_eq!(SCRIPT_POLICY, ScriptPolicy::Blocked);
        assert_eq!(
            serde_json::to_string(&ScriptPolicy::Blocked).unwrap(),
            "\"blocked\""
        );
        assert_eq!(
            serde_json::to_string(&ScriptPolicy::Run).unwrap(),
            "\"run\""
        );
    }

    #[test]
    fn app_config_serializes_camel_case() {
        let value = serde_json::to_value(app_config()).unwrap();
        assert_eq!(value["scriptPolicy"], "blocked");
        let row = &value["kinds"][0];
        assert_eq!(row["id"], "html");
        assert_eq!(row["defaultStem"], "planets");
        assert_eq!(row["primaryExt"], "html");
        assert_eq!(row["colorToken"], "html");
        assert_eq!(row["previewMode"], "morph");
        assert_eq!(row["isPage"], true);
        assert_eq!(row["openFirst"], "Open an HTML page first.");
        assert_eq!(value["kinds"].as_array().unwrap().len(), KINDS.len());
    }

    #[test]
    fn exactly_the_style_kind_is_a_stylesheet() {
        assert!(!KINDS[0].is_stylesheet());
        assert!(KINDS[1].is_stylesheet());
    }
}
