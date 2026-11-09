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
    pub teaching: bool,
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
        teaching: true,
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
        teaching: true,
    },
];

// The one kind for every file that is not a teaching kind. It is not a row of KINDS (C37).
pub const CODE_KIND: Kind = Kind {
    id: "code",
    extensions: &[],
    label: "File",
    blurb: "",
    default_stem: "",
    primary_ext: "",
    icon: "files",
    color_token: "ink2",
    language: "text",
    preview_mode: "none",
    is_page: false,
    open_first: "",
    teaching: false,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub id: &'static str,
    pub label: &'static str,
    pub extensions: &'static [&'static str],
    pub names: &'static [&'static str],
    pub tidy: &'static str,
    pub letters: &'static str,
}

const TEXT_LANGUAGE: &str = "text";

// Languages only add comfort when editing. They never decide what is a web file (C37),
// and html and css are not rows here: they are the teaching kinds in KINDS.
// `tidy` is the only source for Tidy: "on", "off-meaning" (spaces change what the code
// means) or "off-no-rules". The UI reads every row from app_config (config.languages).
pub const LANGUAGES: &[Language] = &[
    Language {
        id: "javascript",
        label: "JavaScript",
        extensions: &["js", "mjs", "cjs", "jsx"],
        names: &[],
        tidy: "on",
        letters: "JS",
    },
    Language {
        id: "typescript",
        label: "TypeScript",
        extensions: &["ts", "mts", "cts", "tsx"],
        names: &[],
        tidy: "on",
        letters: "TS",
    },
    Language {
        id: "json",
        label: "JSON",
        extensions: &["json", "jsonc", "webmanifest"],
        names: &[],
        tidy: "on",
        letters: "JSON",
    },
    Language {
        id: "markdown",
        label: "Markdown",
        extensions: &["md", "markdown"],
        names: &[],
        tidy: "off-meaning",
        letters: "MD",
    },
    Language {
        id: "xml",
        label: "XML",
        extensions: &["xml", "svg", "xsl", "plist"],
        names: &[],
        tidy: "on",
        letters: "XML",
    },
    Language {
        id: "scss",
        label: "SCSS",
        extensions: &["scss"],
        names: &[],
        tidy: "on",
        letters: "SCSS",
    },
    Language {
        id: "sass",
        label: "Sass",
        extensions: &["sass"],
        names: &[],
        tidy: "off-meaning",
        letters: "SASS",
    },
    Language {
        id: "less",
        label: "Less",
        extensions: &["less"],
        names: &[],
        tidy: "on",
        letters: "LESS",
    },
    Language {
        id: "yaml",
        label: "YAML",
        extensions: &["yml", "yaml"],
        names: &[],
        tidy: "off-meaning",
        letters: "YAML",
    },
    Language {
        id: "python",
        label: "Python",
        extensions: &["py", "pyw"],
        names: &[],
        tidy: "off-meaning",
        letters: "PY",
    },
    Language {
        id: "php",
        label: "PHP",
        extensions: &["php"],
        names: &[],
        tidy: "on",
        letters: "PHP",
    },
    Language {
        id: "sql",
        label: "SQL",
        extensions: &["sql"],
        names: &[],
        tidy: "on",
        letters: "SQL",
    },
    Language {
        id: "cpp",
        label: "C and C++",
        extensions: &["c", "h", "cpp", "cc", "cxx", "hpp", "hh"],
        names: &[],
        tidy: "on",
        letters: "C",
    },
    Language {
        id: "java",
        label: "Java",
        extensions: &["java"],
        names: &[],
        tidy: "on",
        letters: "JAVA",
    },
    Language {
        id: "go",
        label: "Go",
        extensions: &["go"],
        names: &[],
        tidy: "on",
        letters: "GO",
    },
    Language {
        id: "rust",
        label: "Rust",
        extensions: &["rs"],
        names: &[],
        tidy: "on",
        letters: "RS",
    },
    // C#, Kotlin, Swift and Lua were "test-decided" (WP2 step 9). In Swift """ strings and
    // Lua [[ ]] strings Tidy also moved text inside the string, which changes what the
    // program prints, so they are off-no-rules. C# and Kotlin are plain text: the legacy
    // clike mode builds its word lists with obj[word] = true, and with the app's
    // freezePrototype (tauri.conf.json) Kotlin's word "constructor" throws when the module
    // loads, so the clike chunk cannot load at all. They have no wrapper and no Tidy.
    Language {
        id: "csharp",
        label: "C#",
        extensions: &["cs"],
        names: &[],
        tidy: "off-no-rules",
        letters: "C#",
    },
    Language {
        id: "kotlin",
        label: "Kotlin",
        extensions: &["kt", "kts"],
        names: &[],
        tidy: "off-no-rules",
        letters: "KT",
    },
    Language {
        id: "swift",
        label: "Swift",
        extensions: &["swift"],
        names: &[],
        tidy: "off-no-rules",
        letters: "SWFT",
    },
    Language {
        id: "lua",
        label: "Lua",
        extensions: &["lua"],
        names: &[],
        tidy: "off-no-rules",
        letters: "LUA",
    },
    Language {
        id: "shell",
        label: "Shell",
        extensions: &["sh", "bash", "zsh"],
        names: &[".bashrc", ".zshrc", ".profile"],
        tidy: "off-no-rules",
        letters: "SH",
    },
    Language {
        id: "powershell",
        label: "PowerShell",
        extensions: &["ps1", "psm1", "psd1"],
        names: &[],
        tidy: "off-no-rules",
        letters: "PS",
    },
    Language {
        id: "ruby",
        label: "Ruby",
        extensions: &["rb"],
        names: &["Gemfile", "Rakefile"],
        tidy: "off-meaning",
        letters: "RB",
    },
    Language {
        id: "toml",
        label: "TOML",
        extensions: &["toml"],
        names: &[],
        tidy: "off-no-rules",
        letters: "TOML",
    },
    Language {
        id: "ini",
        label: "Settings",
        extensions: &["ini", "cfg", "conf", "env", "properties"],
        names: &[".env", ".editorconfig"],
        tidy: "off-no-rules",
        letters: "INI",
    },
    Language {
        id: TEXT_LANGUAGE,
        label: "Text",
        extensions: &["txt", "log", "csv", "tsv"],
        names: &[],
        tidy: "off-no-rules",
        letters: "TXT",
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

// Only for a file that is opened or given a tab. Every other caller asks kind_for_name.
pub fn kind_or_code(file_name: &str) -> &'static Kind {
    kind_for_name(file_name).unwrap_or(&CODE_KIND)
}

fn language_row(file_name: &str) -> Option<&'static Language> {
    let by_name = LANGUAGES
        .iter()
        .find(|l| l.names.iter().any(|n| n.eq_ignore_ascii_case(file_name)));
    by_name.or_else(|| {
        let ext = extension_of(file_name)?;
        LANGUAGES
            .iter()
            .find(|l| l.extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)))
    })
}

pub fn language_for_name(file_name: &str) -> &'static Language {
    language_row(file_name).unwrap_or_else(|| {
        LANGUAGES
            .iter()
            .find(|l| l.id == TEXT_LANGUAGE)
            .expect("LANGUAGES has a text row")
    })
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
        "json" => "application/json",
        "xml" => "application/xml",
        _ if language_row(file_name).is_some() => "text/plain",
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
    pub code_kind: &'static Kind,
    pub languages: &'static [Language],
    pub script_policy: ScriptPolicy,
}

pub fn app_config() -> AppConfig {
    AppConfig {
        kinds: KINDS,
        code_kind: &CODE_KIND,
        languages: LANGUAGES,
        script_policy: SCRIPT_POLICY,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

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
        assert!(html.teaching);

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
        assert!(css.teaching);
    }

    #[test]
    fn the_code_kind_has_the_contract_values_and_is_not_a_row() {
        assert_eq!(CODE_KIND.id, "code");
        assert!(CODE_KIND.extensions.is_empty());
        assert_eq!(CODE_KIND.label, "File");
        assert_eq!(CODE_KIND.blurb, "");
        assert_eq!(CODE_KIND.default_stem, "");
        assert_eq!(CODE_KIND.primary_ext, "");
        assert_eq!(CODE_KIND.icon, "files");
        assert_eq!(CODE_KIND.color_token, "ink2");
        assert_eq!(CODE_KIND.language, "text");
        assert_eq!(CODE_KIND.preview_mode, "none");
        assert!(!CODE_KIND.is_page);
        assert_eq!(CODE_KIND.open_first, "");
        assert!(!CODE_KIND.teaching);
        assert!(!CODE_KIND.is_stylesheet());
        assert!(KINDS.iter().all(|k| k.id != CODE_KIND.id));
    }

    #[test]
    fn kind_or_code_gives_the_teaching_kind_or_the_code_kind() {
        assert_eq!(kind_or_code("a.HTML").id, "html");
        assert_eq!(kind_or_code("a.css").id, "css");
        for name in [
            "notes.txt",
            "game.py",
            "Makefile",
            ".bashrc",
            "",
            "a.html.bak",
        ] {
            assert_eq!(kind_or_code(name).id, "code", "{name}");
            assert!(kind_for_name(name).is_none(), "{name}");
        }
    }

    // The WP2 table, row by row and in order: (id, label, extensions, names, tidy, letters).
    const PLAN: &[(&str, &str, &[&str], &[&str], &str, &str)] = &[
        (
            "javascript",
            "JavaScript",
            &["js", "mjs", "cjs", "jsx"],
            &[],
            "on",
            "JS",
        ),
        (
            "typescript",
            "TypeScript",
            &["ts", "mts", "cts", "tsx"],
            &[],
            "on",
            "TS",
        ),
        (
            "json",
            "JSON",
            &["json", "jsonc", "webmanifest"],
            &[],
            "on",
            "JSON",
        ),
        (
            "markdown",
            "Markdown",
            &["md", "markdown"],
            &[],
            "off-meaning",
            "MD",
        ),
        (
            "xml",
            "XML",
            &["xml", "svg", "xsl", "plist"],
            &[],
            "on",
            "XML",
        ),
        ("scss", "SCSS", &["scss"], &[], "on", "SCSS"),
        ("sass", "Sass", &["sass"], &[], "off-meaning", "SASS"),
        ("less", "Less", &["less"], &[], "on", "LESS"),
        ("yaml", "YAML", &["yml", "yaml"], &[], "off-meaning", "YAML"),
        ("python", "Python", &["py", "pyw"], &[], "off-meaning", "PY"),
        ("php", "PHP", &["php"], &[], "on", "PHP"),
        ("sql", "SQL", &["sql"], &[], "on", "SQL"),
        (
            "cpp",
            "C and C++",
            &["c", "h", "cpp", "cc", "cxx", "hpp", "hh"],
            &[],
            "on",
            "C",
        ),
        ("java", "Java", &["java"], &[], "on", "JAVA"),
        ("go", "Go", &["go"], &[], "on", "GO"),
        ("rust", "Rust", &["rs"], &[], "on", "RS"),
        ("csharp", "C#", &["cs"], &[], "off-no-rules", "C#"),
        ("kotlin", "Kotlin", &["kt", "kts"], &[], "off-no-rules", "KT"),
        ("swift", "Swift", &["swift"], &[], "off-no-rules", "SWFT"),
        ("lua", "Lua", &["lua"], &[], "off-no-rules", "LUA"),
        (
            "shell",
            "Shell",
            &["sh", "bash", "zsh"],
            &[".bashrc", ".zshrc", ".profile"],
            "off-no-rules",
            "SH",
        ),
        (
            "powershell",
            "PowerShell",
            &["ps1", "psm1", "psd1"],
            &[],
            "off-no-rules",
            "PS",
        ),
        (
            "ruby",
            "Ruby",
            &["rb"],
            &["Gemfile", "Rakefile"],
            "off-meaning",
            "RB",
        ),
        ("toml", "TOML", &["toml"], &[], "off-no-rules", "TOML"),
        (
            "ini",
            "Settings",
            &["ini", "cfg", "conf", "env", "properties"],
            &[".env", ".editorconfig"],
            "off-no-rules",
            "INI",
        ),
        (
            "text",
            "Text",
            &["txt", "log", "csv", "tsv"],
            &[],
            "off-no-rules",
            "TXT",
        ),
    ];

    #[test]
    fn languages_table_has_the_26_plan_rows_in_order() {
        assert_eq!(LANGUAGES.len(), 26);
        assert_eq!(PLAN.len(), 26);
        for (row, plan) in LANGUAGES.iter().zip(PLAN) {
            let (id, label, extensions, names, tidy, letters) = *plan;
            assert_eq!(row.id, id);
            assert_eq!(row.label, label, "{id}");
            assert_eq!(row.extensions, extensions, "{id}");
            assert_eq!(row.names, names, "{id}");
            assert_eq!(row.tidy, tidy, "{id}");
            assert_eq!(row.letters, letters, "{id}");
        }
    }

    #[test]
    fn languages_rows_are_unique_and_leave_the_teaching_kinds_out() {
        let ids: HashSet<&str> = LANGUAGES.iter().map(|l| l.id).collect();
        assert_eq!(ids.len(), LANGUAGES.len());
        assert!(ids.contains("text"));
        let letters: HashSet<&str> = LANGUAGES.iter().map(|l| l.letters).collect();
        assert_eq!(letters.len(), LANGUAGES.len());
        let mut seen: HashSet<String> = HashSet::new();
        for row in LANGUAGES {
            assert!(
                matches!(row.tidy, "on" | "off-meaning" | "off-no-rules"),
                "{}",
                row.id
            );
            assert!(
                !row.letters.is_empty() && row.letters.len() <= 4,
                "{}",
                row.id
            );
            assert!(!row.label.is_empty(), "{}", row.id);
            assert!(!row.extensions.is_empty(), "{}", row.id);
            for key in row.extensions.iter().chain(row.names) {
                assert_eq!(key.trim(), *key, "{}", row.id);
                assert!(!key.is_empty(), "{}", row.id);
                assert!(
                    seen.insert(key.to_ascii_lowercase()),
                    "{key} is in two rows (or twice in {})",
                    row.id
                );
            }
            for ext in row.extensions {
                assert!(!ext.starts_with('.'), "{ext}");
                assert!(
                    kind_for_extension(ext).is_none(),
                    "{ext} is a teaching kind (C37)"
                );
                assert!(!matches!(*ext, "html" | "htm" | "css"), "{ext}");
            }
            assert!(!matches!(row.id, "html" | "css" | "code"), "{}", row.id);
        }
    }

    #[test]
    fn every_row_finds_itself_by_extension_and_name() {
        for row in LANGUAGES {
            for ext in row.extensions {
                assert_eq!(
                    language_for_name(&format!("game.{ext}")).id,
                    row.id,
                    "{ext}"
                );
                assert_eq!(
                    language_for_name(&format!("GAME.{}", ext.to_ascii_uppercase())).id,
                    row.id,
                    "{ext}"
                );
            }
            for name in row.names {
                assert_eq!(language_for_name(name).id, row.id, "{name}");
            }
        }
    }

    #[test]
    fn language_for_name_takes_names_first_then_extensions_then_text() {
        assert_eq!(language_for_name(".bashrc").id, "shell");
        assert_eq!(language_for_name(".ZSHRC").id, "shell");
        assert_eq!(language_for_name("Gemfile").id, "ruby");
        assert_eq!(language_for_name("gemfile").id, "ruby");
        assert_eq!(language_for_name("Rakefile").id, "ruby");
        assert_eq!(language_for_name(".env").id, "ini");
        assert_eq!(language_for_name(".editorconfig").id, "ini");
        assert_eq!(language_for_name("site.env").id, "ini");
        assert_eq!(language_for_name("A.PY").id, "python");
        assert_eq!(language_for_name("Main.Java").id, "java");
        assert_eq!(language_for_name("app.TSX").id, "typescript");
        assert_eq!(language_for_name("logo.SVG").id, "xml");
        assert_eq!(language_for_name("my.game.rs").id, "rust");
        assert_eq!(language_for_name("README.md").id, "markdown");
        for name in [
            "a.txt",
            "B.LOG",
            "c.csv",
            "d.Tsv",
            "Makefile",
            "notes",
            "",
            "a.html",
            "b.css",
            "a.htm",
            "x.unknown",
            "py",
            ".py",
            "Gemfile.lock",
            "a.bashrc",
        ] {
            assert_eq!(language_for_name(name).id, "text", "{name}");
        }
        assert!(language_row("a.txt").is_some());
        assert!(language_row("game.py").is_some());
        assert!(language_row("Makefile").is_none());
        assert!(language_row("a.html").is_none());
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
            ("a.json", "application/json"),
            ("a.JSON", "application/json"),
            ("a.xml", "application/xml"),
            ("a.txt", "text/plain"),
            ("a.TXT", "text/plain"),
            ("a.md", "text/plain"),
            ("a.log", "text/plain"),
            ("a.csv", "text/plain"),
            ("a.tsv", "text/plain"),
            ("a.py", "text/plain"),
            ("Gemfile", "text/plain"),
            (".bashrc", "text/plain"),
            ("a.jsonc", "text/plain"),
            ("a.xsl", "text/plain"),
            ("a.heic", "application/octet-stream"),
            ("noextension", "application/octet-stream"),
            ("", "application/octet-stream"),
        ];
        for (name, mime) in cases {
            assert_eq!(mime_for(name), mime, "{name}");
        }
    }

    #[test]
    fn mime_follows_the_languages_table() {
        let mut checked = 0;
        for row in LANGUAGES {
            for ext in row.extensions {
                let want = match *ext {
                    "json" => "application/json",
                    "xml" => "application/xml",
                    "svg" => "image/svg+xml",
                    "js" | "mjs" => "text/javascript; charset=utf-8",
                    _ => "text/plain",
                };
                assert_eq!(mime_for(&format!("a.{ext}")), want, "{ext}");
                assert_eq!(
                    mime_for(&format!("A.{}", ext.to_ascii_uppercase())),
                    want,
                    "{ext}"
                );
                checked += 1;
            }
            for name in row.names {
                assert_eq!(mime_for(name), "text/plain", "{name}");
            }
        }
        assert_eq!(checked, 58);
        assert!(is_picture("a.svg"));
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
        assert_eq!(row["teaching"], true);
        assert_eq!(value["kinds"].as_array().unwrap().len(), KINDS.len());
        assert_eq!(value["kinds"].as_array().unwrap().len(), 2);

        let code = &value["codeKind"];
        assert_eq!(code["id"], "code");
        assert_eq!(code["teaching"], false);
        assert_eq!(code["isPage"], false);
        assert_eq!(code["previewMode"], "none");
        assert_eq!(code["colorToken"], "ink2");
        assert_eq!(code["language"], "text");
        assert_eq!(code["extensions"].as_array().unwrap().len(), 0);

        let languages = value["languages"].as_array().unwrap();
        assert_eq!(languages.len(), LANGUAGES.len());
        assert_eq!(languages.len(), 26);
        assert_eq!(languages[0]["id"], "javascript");
        let text = &languages[25];
        assert_eq!(text["id"], "text");
        assert_eq!(text["label"], "Text");
        assert_eq!(text["extensions"][3], "tsv");
        assert_eq!(text["names"].as_array().unwrap().len(), 0);
        assert_eq!(text["tidy"], "off-no-rules");
        assert_eq!(text["letters"], "TXT");
        let shell = languages.iter().find(|l| l["id"] == "shell").unwrap();
        assert_eq!(shell["names"][0], ".bashrc");
        assert_eq!(shell["letters"], "SH");
        for row in languages {
            let keys: Vec<&String> = row.as_object().unwrap().keys().collect();
            assert_eq!(keys.len(), 6, "{}", row["id"]);
            for key in ["id", "label", "extensions", "names", "tidy", "letters"] {
                assert!(row.get(key).is_some(), "{key}");
            }
        }
    }

    #[test]
    fn exactly_the_style_kind_is_a_stylesheet() {
        assert!(!KINDS[0].is_stylesheet());
        assert!(KINDS[1].is_stylesheet());
    }
}
