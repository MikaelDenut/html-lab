use crate::counts;
use crate::files::{path_text, read_text};
use crate::kinds::{is_picture, kind_for_name, KINDS};
use serde::Serialize;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::Path;

const MAX_PROJECT_FILES: usize = 20;
const MAX_LINKED_CSS: usize = 5;
// Opening a file reads its folder once and at most this many entries (C48).
pub const MAX_SCAN_ENTRIES: usize = 2_000;
const MAX_TEXT_FILES: usize = 10;
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
const SNIFF_BYTES: u64 = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFile {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub picked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub folder: String,
    pub folder_name: String,
    pub is_project: bool,
    pub refused: bool,
    pub too_big: bool,
    // The scan stopped at too many web files, before the end of the folder (C48).
    pub stopped_early: bool,
    pub files: Vec<ScanFile>,
    pub linked_css: Vec<ScanFile>,
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn scan_result(folder: &Path) -> ScanResult {
    ScanResult {
        folder: path_text(&folder),
        folder_name: name_of(folder),
        is_project: false,
        refused: false,
        too_big: false,
        stopped_early: false,
        files: Vec::new(),
        linked_css: Vec::new(),
    }
}

fn refused(folder: &Path) -> ScanResult {
    ScanResult {
        refused: true,
        ..scan_result(folder)
    }
}

fn opening_rank(file: &ScanFile) -> (bool, bool, usize, String, String) {
    let table_row = KINDS.iter().position(|k| k.id == file.kind);
    let is_page = table_row.is_some_and(|row| KINDS[row].is_page);
    (
        !file.picked,
        !is_page,
        table_row.unwrap_or(KINDS.len()),
        file.name.to_lowercase(),
        file.name.clone(),
    )
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOpen {
    pub folder_name: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPlan {
    pub folders: Vec<FolderOpen>,
    pub files: Vec<String>,
    pub empty_folders: Vec<String>,
    pub others: Vec<String>,
}

fn folder_rank(name: &str) -> (u8, String) {
    let lower = name.to_lowercase();
    let page = kind_for_name(name).is_some_and(|k| k.is_page);
    let first = if lower == "index.html" || lower == "index.htm" {
        0
    } else if page {
        1
    } else {
        2
    };
    (first, lower)
}

fn folder_files(folder: &Path) -> Vec<String> {
    counts::read_dir();
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        counts::entry();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with('.') {
            names.push(name);
        }
    }
    let is_file = |name: &String| {
        counts::stat();
        fs::metadata(folder.join(name)).is_ok_and(|m| m.is_file())
    };
    let mut web: Vec<String> = names
        .iter()
        .filter(|n| kind_for_name(n).is_some())
        .filter(|n| is_file(n))
        .cloned()
        .collect();
    if web.is_empty() {
        return text_files(folder, names);
    }
    web.sort_by_key(|n| folder_rank(n));
    if web.len() > MAX_PROJECT_FILES {
        web.truncate(1);
    }
    web.into_iter().map(|n| path_text(folder.join(n))).collect()
}

fn text_rank(name: &str) -> (bool, String, String) {
    let lower = name.to_lowercase();
    (!lower.starts_with("readme"), lower, name.to_string())
}

// A folder with no web files opens its first text files, README first, then by name.
fn text_files(folder: &Path, mut names: Vec<String>) -> Vec<String> {
    names.retain(|n| !is_picture(n));
    names.sort_by_key(|n| text_rank(n));
    let mut found = Vec::new();
    for name in names.into_iter().take(MAX_SCAN_ENTRIES) {
        let path = folder.join(&name);
        counts::stat();
        let fits = fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= MAX_TEXT_BYTES);
        if fits && looks_like_text(&path) {
            found.push(path_text(&path));
            if found.len() == MAX_TEXT_FILES {
                break;
            }
        }
    }
    found
}

// A quick look at the start of a file: a NUL byte means it is not text. With a UTF-16
// BOM the NUL test looks at whole 16-bit units instead, as the reader does.
fn looks_like_text(path: &Path) -> bool {
    let mut start = Vec::new();
    let read = fs::File::open(path).and_then(|file| file.take(SNIFF_BYTES).read_to_end(&mut start));
    if read.is_err() {
        return false;
    }
    match start.get(..2) {
        Some([0xFF, 0xFE] | [0xFE, 0xFF]) => start[2..].chunks_exact(2).all(|u| u != [0, 0]),
        _ => !start.contains(&0),
    }
}

pub fn plan_open(paths: &[String]) -> OpenPlan {
    let mut plan = OpenPlan::default();
    for given in paths {
        let Ok(path) = dunce::canonicalize(given) else {
            plan.others.push(name_of(Path::new(given)));
            continue;
        };
        let Ok(meta) = fs::metadata(&path) else {
            plan.others.push(name_of(&path));
            continue;
        };
        if meta.is_dir() {
            let files = folder_files(&path);
            if files.is_empty() {
                plan.empty_folders.push(name_of(&path));
            } else {
                plan.folders.push(FolderOpen { folder_name: name_of(&path), files });
            }
        } else if meta.is_file() {
            // Any regular file opens; the read decides whether it is text.
            let text = path_text(&path);
            if !plan.files.contains(&text) {
                plan.files.push(text);
            }
        } else {
            plan.others.push(name_of(&path));
        }
    }
    plan
}

// Only teaching-kind files count towards a project. The folder is read once, at most
// MAX_SCAN_ENTRIES entries, and only web file names are statted (C48).
pub fn scan_folder(picked: &Path) -> ScanResult {
    let given_folder = picked.parent().unwrap_or(Path::new(""));
    let Ok(picked) = dunce::canonicalize(picked) else {
        return refused(given_folder);
    };
    counts::stat();
    let (Some(folder), Ok(picked_meta)) = (picked.parent(), fs::metadata(&picked)) else {
        return refused(given_folder);
    };
    if !picked_meta.is_file() {
        return refused(folder);
    }
    let picked_name = name_of(&picked);
    let Some(picked_kind) = kind_for_name(&picked_name) else {
        return scan_result(folder);
    };

    let mut result = scan_result(folder);
    let mut project_files = Vec::new();
    // A picked dotfile is never part of a project, so its folder need not be read.
    let mut answer_known = picked_name.starts_with('.');
    if !answer_known {
        counts::read_dir();
        let Ok(entries) = fs::read_dir(folder) else {
            return refused(folder);
        };
        let mut seen = 0;
        for entry in entries {
            if seen == MAX_SCAN_ENTRIES {
                result.too_big = true;
                break;
            }
            seen += 1;
            counts::entry();
            let Ok(entry) = entry else {
                return refused(folder);
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Some(kind) = kind_for_name(&name) else {
                continue;
            };
            counts::stat();
            let Ok(meta) = fs::metadata(entry.path()) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            #[cfg(unix)]
            let is_picked = name == picked_name
                || (meta.ino() == picked_meta.ino() && meta.dev() == picked_meta.dev());
            #[cfg(not(unix))]
            let is_picked = name.eq_ignore_ascii_case(&picked_name);
            project_files.push(ScanFile {
                path: path_text(folder.join(&name)),
                name,
                kind: kind.id.to_string(),
                picked: is_picked,
            });
            if project_files.len() > MAX_PROJECT_FILES {
                answer_known = true;
                result.stopped_early = true;
                break;
            }
        }
    }

    result.is_project = !answer_known
        && !result.too_big
        && project_files.len() > 1
        && project_files.iter().any(|f| f.picked);
    if result.is_project {
        project_files.sort_by_key(opening_rank);
        result.files = project_files;
    } else if picked_kind.is_page {
        if let Ok(html) = read_text(&picked) {
            result.linked_css = linked_css(&html, folder)
                .into_iter()
                .filter_map(|name| {
                    let kind = kind_for_name(&name)?;
                    Some(ScanFile {
                        path: path_text(folder.join(&name)),
                        kind: kind.id.to_string(),
                        name,
                        picked: false,
                    })
                })
                .collect();
        }
    }
    result
}

pub fn linked_css(html: &str, folder: &Path) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for href in stylesheet_hrefs(&tags(html)) {
        let Some(name) = flat_stylesheet_name(href) else {
            continue;
        };
        if found.iter().any(|f| f.eq_ignore_ascii_case(name)) {
            continue;
        }
        counts::stat();
        if !folder.join(name).is_file() {
            continue;
        }
        found.push(name.to_string());
        if found.len() == MAX_LINKED_CSS {
            break;
        }
    }
    found
}

fn stylesheet_hrefs<'a>(tags: &[Tag<'a>]) -> Vec<&'a str> {
    tags.iter()
        .filter(|t| !t.closing && t.name == "link")
        .filter(|t| {
            t.attr("rel").is_some_and(|rel| {
                rel.split_ascii_whitespace()
                    .any(|token| token.eq_ignore_ascii_case("stylesheet"))
            })
        })
        .filter_map(|t| t.attr("href"))
        .collect()
}

fn without_query(href: &str) -> &str {
    href.trim().split(['?', '#']).next().unwrap_or("")
}

fn flat_stylesheet_name(href: &str) -> Option<&str> {
    let name = without_query(href);
    let leaves_folder = name.contains('/') || name.contains('\\') || name.contains("..");
    if name.is_empty() || leaves_folder || name.contains(':') {
        return None;
    }
    kind_for_name(name)
        .filter(|k| k.is_stylesheet())
        .map(|_| name)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInsert {
    pub line: usize,
    pub text: String,
}

pub fn add_link(html: &str, css_file: &str) -> Option<LinkInsert> {
    let tags = tags(html);
    let wanted = css_file.to_lowercase();
    let already_linked = stylesheet_hrefs(&tags).into_iter().any(|href| {
        let name = without_query(href);
        name.strip_prefix("./").unwrap_or(name).to_lowercase() == wanted
    });
    if already_linked {
        return None;
    }

    let link = format!("<link rel=\"stylesheet\" href=\"{css_file}\">");
    if let Some(head_end) = tags.iter().find(|t| t.closing && t.name == "head") {
        let line = line_at(html, head_end.start);
        let indent = indent_of_line(html, head_end.start);
        return Some(LinkInsert {
            line,
            text: format!("{indent}  {link}"),
        });
    }
    if let Some(body) = tags.iter().find(|t| !t.closing && t.name == "body") {
        let line = line_at(html, body.start);
        let indent = indent_of_line(html, body.start);
        return Some(LinkInsert {
            line,
            text: format!("{indent}{link}"),
        });
    }
    let line = tags
        .iter()
        .find(|t| t.name == DOCTYPE)
        .map_or(0, |doctype| line_at(html, doctype.end - 1) + 1);
    Some(LinkInsert { line, text: link })
}

fn line_at(html: &str, offset: usize) -> usize {
    html[..offset].matches('\n').count()
}

fn indent_of_line(html: &str, offset: usize) -> &str {
    let line_start = html[..offset].rfind('\n').map_or(0, |n| n + 1);
    let line = &html[line_start..];
    let indent_len = line.len() - line.trim_start_matches([' ', '\t']).len();
    &line[..indent_len]
}

const DOCTYPE: &str = "!doctype";

const RAW_TEXT_ELEMENTS: &[&str] = &["script", "style", "title", "textarea"];

pub(crate) struct Tag<'a> {
    pub name: String,
    pub closing: bool,
    pub start: usize,
    pub end: usize,
    attrs: Vec<(String, &'a str)>,
}

impl<'a> Tag<'a> {
    pub fn attr(&self, name: &str) -> Option<&'a str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, value)| *value)
    }
}

pub(crate) fn tags(html: &str) -> Vec<Tag<'_>> {
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(found) = html[at..].find('<') {
        let start = at + found;
        if lower[start..].starts_with("<!--") {
            let Some(close) = lower[start + 2..].find("-->") else {
                break;
            };
            at = start + 2 + close + 3;
            continue;
        }
        if matches!(bytes.get(start + 1), Some(b'!' | b'?')) {
            let Some(close) = html[start..].find('>') else {
                break;
            };
            let end = start + close + 1;
            if lower[start..end].starts_with("<!doctype") {
                out.push(Tag {
                    name: DOCTYPE.to_string(),
                    closing: false,
                    start,
                    end,
                    attrs: Vec::new(),
                });
            }
            at = end;
            continue;
        }

        let closing = bytes.get(start + 1) == Some(&b'/');
        let name_start = start + 1 + usize::from(closing);
        if !bytes.get(name_start).is_some_and(u8::is_ascii_alphabetic) {
            at = start + 1;
            continue;
        }
        let mut name_end = name_start;
        while name_end < bytes.len() && !ends_tag_name(bytes[name_end]) {
            name_end += 1;
        }
        let Some((attrs, end)) = parse_attrs(html, name_end) else {
            break;
        };
        let name = lower[name_start..name_end].to_string();
        let is_raw = !closing && RAW_TEXT_ELEMENTS.contains(&name.as_str());
        let close_tag = format!("</{name}");
        out.push(Tag {
            name,
            closing,
            start,
            end,
            attrs,
        });
        at = end;
        if is_raw {
            let Some(close) = lower[end..].find(&close_tag) else {
                break;
            };
            at = end + close;
        }
    }
    out
}

fn ends_tag_name(byte: u8) -> bool {
    byte.is_ascii_whitespace() || byte == b'/' || byte == b'>'
}

fn parse_attrs(html: &str, mut at: usize) -> Option<(Vec<(String, &str)>, usize)> {
    let bytes = html.as_bytes();
    let mut attrs = Vec::new();
    loop {
        while bytes
            .get(at)
            .is_some_and(|b| b.is_ascii_whitespace() || *b == b'/')
        {
            at += 1;
        }
        match bytes.get(at) {
            None => return None,
            Some(b'>') => return Some((attrs, at + 1)),
            Some(_) => {}
        }

        let name_start = at;
        at += 1;
        while bytes
            .get(at)
            .is_some_and(|b| !b.is_ascii_whitespace() && !matches!(*b, b'/' | b'>' | b'='))
        {
            at += 1;
        }
        let name = html[name_start..at].to_ascii_lowercase();

        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        if bytes.get(at) != Some(&b'=') {
            attrs.push((name, ""));
            continue;
        }
        at += 1;
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        let value = match bytes.get(at) {
            None => return None,
            Some(quote @ (b'"' | b'\'')) => {
                let value_start = at + 1;
                let len = bytes[value_start..].iter().position(|b| b == quote)?;
                at = value_start + len + 1;
                &html[value_start..value_start + len]
            }
            Some(_) => {
                let value_start = at;
                while bytes
                    .get(at)
                    .is_some_and(|b| !b.is_ascii_whitespace() && *b != b'>')
                {
                    at += 1;
                }
                &html[value_start..at]
            }
        };
        attrs.push((name, value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use tempfile::{tempdir, TempDir};

    #[test]
    fn plan_open_sorts_a_folder_with_its_home_page_first() {
        let (_dir, folder) = folder_with(&["style.css", "about.html", "index.html", "photo.jpg", "notes.txt"]);
        let plan = plan_open(&[path_text(&folder)]);
        assert_eq!(plan.folders.len(), 1);
        let names: Vec<String> = plan.folders[0].files.iter().map(|f| name_of(Path::new(f))).collect();
        assert_eq!(names, ["index.html", "about.html", "style.css"]);
        assert!(plan.files.is_empty() && plan.others.is_empty() && plan.empty_folders.is_empty());
    }

    #[test]
    fn plan_open_keeps_pages_and_style_files_and_names_the_rest() {
        let (_dir, folder) = folder_with(&["a.html", "b.CSS", "c.txt"]);
        let paths: Vec<String> = ["a.html", "b.CSS", "c.txt", "gone.html", "a.html"]
            .iter()
            .map(|n| path_text(folder.join(n)))
            .collect();
        let plan = plan_open(&paths);
        assert_eq!(
            plan.files,
            [
                path_text(folder.join("a.html")),
                path_text(folder.join("b.CSS")),
                path_text(folder.join("c.txt"))
            ]
        );
        assert_eq!(plan.others, ["gone.html"]);
        assert!(plan.folders.is_empty() && plan.empty_folders.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn plan_open_names_what_is_not_a_regular_file() {
        let (_dir, folder) = folder_with(&["photo.jpg"]);
        let pipe = folder.join("pipe.txt");
        let c_path = std::ffi::CString::new(std::os::unix::ffi::OsStrExt::as_bytes(pipe.as_os_str())).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o644) }, 0);
        let plan = plan_open(&[path_text(&pipe), path_text(folder.join("photo.jpg"))]);
        assert_eq!(plan.others, ["pipe.txt"]);
        assert_eq!(plan.files, [path_text(folder.join("photo.jpg"))]);
    }

    #[test]
    fn plan_open_reports_a_folder_with_nothing_to_open() {
        let (_dir, folder) = folder_with(&["notes.txt", "photo.jpg"]);
        let plan = plan_open(&[path_text(&folder)]);
        assert_eq!(plan.folders.len(), 1);
        assert_eq!(plan.folders[0].files, [path_text(folder.join("notes.txt"))]);
        assert!(plan.empty_folders.is_empty());

        let (_empty, empty) = folder_with(&[]);
        fs::create_dir(empty.join("sub")).unwrap();
        fs::write(empty.join("sub/notes.txt"), "x").unwrap();
        let (_pictures, pictures) = folder_with(&["a.png", "b.JPG", "c.svg", ".hidden.txt"]);
        let plan = plan_open(&[path_text(&empty), path_text(&pictures)]);
        assert!(plan.folders.is_empty());
        assert_eq!(plan.empty_folders, [name_of(&empty), name_of(&pictures)]);
        assert!(plan.files.is_empty() && plan.others.is_empty());
    }

    #[test]
    fn plan_open_opens_ten_text_files_readme_first_when_a_folder_has_no_web_files() {
        let (_dir, folder) = folder_with(&[]);
        let mut names: Vec<String> = (0..12).map(|n| format!("n{n:02}.txt")).collect();
        names.extend(["ReadMe.md", "b.json", "README", "a.py", ".env"].map(String::from));
        for name in &names {
            fs::write(folder.join(name), "text\n").unwrap();
        }
        fs::write(folder.join("Makefile"), "all:\n").unwrap();
        fs::write(folder.join("aa.bin"), b"PK\x03\x04\0\0rest").unwrap();
        fs::write(folder.join("ab.dat"), [vec![b'a'; 9000], vec![0]].concat()).unwrap();
        let big = fs::File::create(folder.join("ac.log")).unwrap();
        big.set_len(5 * 1024 * 1024 + 1).unwrap();
        fs::write(folder.join("ad.txt"), b"\xFF\xFEa\0b\0").unwrap();
        fs::create_dir(folder.join("ae.txt")).unwrap();
        let plan = plan_open(&[path_text(&folder)]);
        assert_eq!(plan.folders.len(), 1);
        assert_eq!(plan.folders[0].folder_name, name_of(&folder));
        let opened: Vec<String> = plan.folders[0].files.iter().map(|f| name_of(Path::new(f))).collect();
        assert_eq!(
            opened,
            ["README", "ReadMe.md", "a.py", "ab.dat", "ad.txt", "b.json", "Makefile", "n00.txt", "n01.txt", "n02.txt"]
        );
    }

    #[test]
    fn plan_open_web_files_still_win_over_text_files() {
        let (_dir, folder) = folder_with(&["README.md", "notes.txt", "page.html"]);
        let plan = plan_open(&[path_text(&folder)]);
        assert_eq!(plan.folders[0].files, [path_text(folder.join("page.html"))]);
    }

    #[test]
    fn plan_open_lists_a_folder_once_and_stats_only_names_that_can_open() {
        let (_dir, folder) = folder_with(&["a.html", "b.css", "c.png", "d.txt", ".e.html"]);
        counts::local_counts(true);
        let plan = plan_open(&[path_text(&folder)]);
        let used = counts::local_counts(true);
        assert_eq!(plan.folders[0].files.len(), 2);
        assert_eq!(used.read_dirs, 1);
        assert_eq!(used.entries_read, 5);
        assert_eq!(used.stats, 2);
    }

    #[test]
    fn plan_open_opens_only_the_first_page_of_a_huge_folder() {
        let names: Vec<String> = (0..30).map(|i| format!("page{i:02}.html")).collect();
        let refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
        let (_dir, folder) = folder_with(&refs);
        let plan = plan_open(&[path_text(&folder)]);
        assert_eq!(plan.folders[0].files.len(), 1);
        assert!(plan.folders[0].files[0].ends_with("page00.html"));
    }

    fn folder_with(names: &[&str]) -> (TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        for name in names {
            fs::write(dir.path().join(name), "").unwrap();
        }
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    fn names(files: &[ScanFile]) -> Vec<&str> {
        files.iter().map(|f| f.name.as_str()).collect()
    }

    #[test]
    fn two_project_files_are_a_project() {
        let (_dir, folder) = folder_with(&["a.html", "style.css"]);
        let scan = scan_folder(&folder.join("a.html"));
        assert!(scan.is_project);
        assert!(!scan.refused);
        assert_eq!(names(&scan.files), ["a.html", "style.css"]);
        assert_eq!(scan.files[0].kind, "html");
        assert_eq!(scan.files[1].kind, "css");
        assert_eq!(scan.folder, path_text(&folder));
        assert_eq!(
            scan.folder_name,
            folder.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(scan.files[0].path, path_text(folder.join("a.html")));
    }

    #[test]
    fn pictures_in_the_folder_still_make_a_project() {
        let (_dir, folder) =
            folder_with(&["a.html", "b.html", "c.png", "d.JPG", "e.svg", "f.heic"]);
        let scan = scan_folder(&folder.join("a.html"));
        assert!(scan.is_project);
        assert_eq!(names(&scan.files), ["a.html", "b.html"]);
    }

    #[test]
    fn a_picture_subfolder_still_makes_a_project() {
        let (_dir, folder) = folder_with(&["a.html", "b.css"]);
        fs::create_dir(folder.join("images")).unwrap();
        fs::write(folder.join("images/notes.txt"), "x").unwrap();
        let scan = scan_folder(&folder.join("a.html"));
        assert!(scan.is_project);
        assert_eq!(names(&scan.files), ["a.html", "b.css"]);
    }

    #[test]
    fn one_project_file_is_not_a_project() {
        let (_dir, folder) = folder_with(&["a.html", "c.png"]);
        let scan = scan_folder(&folder.join("a.html"));
        assert!(!scan.is_project);
        assert!(!scan.refused);
        assert!(scan.files.is_empty());
    }

    #[test]
    fn twenty_is_a_project_and_twenty_one_is_not() {
        let names_20: Vec<String> = (0..20).map(|n| format!("p{n}.html")).collect();
        let refs: Vec<&str> = names_20.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        assert!(scan_folder(&folder.join("p0.html")).is_project);
        fs::write(folder.join("p20.html"), "").unwrap();
        let scan = scan_folder(&folder.join("p0.html"));
        assert!(!scan.is_project);
        assert!(scan.files.is_empty());
    }

    #[test]
    fn another_kind_no_longer_stops_a_project() {
        let (_dir, folder) = folder_with(&["a.html", "b.css", "notes.txt", "game.js"]);
        let scan = scan_folder(&folder.join("a.html"));
        assert!(scan.is_project);
        assert_eq!(names(&scan.files), ["a.html", "b.css"]);
        let (_dir, folder) = folder_with(&["a.html", "b.css", "no-extension"]);
        assert!(scan_folder(&folder.join("a.html")).is_project);
        let (_dir, folder) = folder_with(&["a.html", "notes.txt", "data.json"]);
        assert!(!scan_folder(&folder.join("a.html")).is_project);
    }

    #[test]
    fn a_picked_file_that_is_not_a_web_file_opens_alone_without_reading_the_folder() {
        let (_dir, folder) = folder_with(&["a.html", "b.css", "notes.txt"]);
        counts::local_counts(true);
        let scan = scan_folder(&folder.join("notes.txt"));
        let used = counts::local_counts(true);
        assert!(!scan.is_project && !scan.refused && !scan.too_big);
        assert!(scan.files.is_empty() && scan.linked_css.is_empty());
        assert_eq!(scan.folder, path_text(&folder));
        assert_eq!(used.read_dirs, 0);
        assert_eq!(used.entries_read, 0);
    }

    #[test]
    fn scan_stats_only_web_file_names() {
        let mut list: Vec<String> = (0..100).map(|n| format!("n{n}.txt")).collect();
        list.extend(["a.html", "b.css", "c.png"].map(String::from));
        let refs: Vec<&str> = list.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        counts::local_counts(true);
        let scan = scan_folder(&folder.join("a.html"));
        let used = counts::local_counts(true);
        assert!(scan.is_project);
        assert_eq!(used.read_dirs, 1);
        assert_eq!(used.entries_read, 103);
        assert_eq!(used.stats, 3);
    }

    #[test]
    fn scan_stops_at_2000_entries_and_opens_the_file_alone() {
        let (_dir, folder) = folder_with(&["a.html", "b.css"]);
        fs::write(folder.join("a.html"), "<link rel=\"stylesheet\" href=\"b.css\">").unwrap();
        for n in 0..(MAX_SCAN_ENTRIES - 2) {
            fs::write(folder.join(format!("e{n:05}.dat")), "").unwrap();
        }
        counts::local_counts(true);
        let scan = scan_folder(&folder.join("a.html"));
        let used = counts::local_counts(true);
        assert!(scan.is_project, "exactly 2,000 entries is still read whole");
        assert!(!scan.too_big && !scan.stopped_early);
        assert_eq!(used.entries_read, 2000);

        fs::write(folder.join("one-more.dat"), "").unwrap();
        counts::local_counts(true);
        let scan = scan_folder(&folder.join("a.html"));
        let used = counts::local_counts(true);
        assert!(scan.too_big);
        assert!(!scan.is_project && !scan.refused);
        assert!(scan.files.is_empty());
        assert_eq!(names(&scan.linked_css), ["b.css"]);
        assert_eq!(used.read_dirs, 1);
        assert_eq!(used.entries_read, 2000);
        assert!(used.stats <= 2000, "{used:?}");
    }

    #[test]
    fn scan_stops_early_once_there_are_too_many_web_files() {
        let list: Vec<String> = (0..30).map(|n| format!("p{n:02}.html")).collect();
        let refs: Vec<&str> = list.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        counts::local_counts(true);
        let scan = scan_folder(&folder.join("p00.html"));
        let used = counts::local_counts(true);
        assert!(!scan.is_project && !scan.too_big);
        assert!(scan.stopped_early, "the folder was not read to its end");
        assert_eq!(used.entries_read, 21);
        assert_eq!(used.stats, 1 + 21);
    }

    #[test]
    fn a_scan_that_reads_the_whole_folder_did_not_stop_early() {
        let names_20: Vec<String> = (0..20).map(|n| format!("p{n}.html")).collect();
        let refs: Vec<&str> = names_20.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        let scan = scan_folder(&folder.join("p0.html"));
        assert!(scan.is_project && !scan.stopped_early);
        let (_dir, folder) = folder_with(&["a.html", "notes.txt"]);
        assert!(!scan_folder(&folder.join("a.html")).stopped_early);
        assert!(!scan_folder(&folder.join("notes.txt")).stopped_early);
    }

    #[test]
    fn scan_result_says_too_big_in_camel_case() {
        let value = serde_json::to_value(scan_result(Path::new("/a/b"))).unwrap();
        assert_eq!(value["tooBig"], false);
        assert_eq!(value["stoppedEarly"], false);
    }

    #[test]
    fn dotfiles_are_skipped() {
        let (_dir, folder) = folder_with(&["a.html", "b.css", ".DS_Store", ".hidden.html", ".txt"]);
        let scan = scan_folder(&folder.join("a.html"));
        assert!(scan.is_project);
        assert_eq!(names(&scan.files), ["a.html", "b.css"]);
    }

    #[test]
    fn extensions_count_in_any_case() {
        let (_dir, folder) = folder_with(&["A.HTML", "B.Htm", "C.CSS"]);
        let scan = scan_folder(&folder.join("A.HTML"));
        assert!(scan.is_project);
        assert_eq!(names(&scan.files), ["A.HTML", "B.Htm", "C.CSS"]);
    }

    #[test]
    fn order_is_picked_then_pages_then_css_ignoring_case() {
        let (_dir, folder) = folder_with(&[
            "zebra.html",
            "Apple.html",
            "banana.htm",
            "Yellow.css",
            "aqua.css",
            "middle.html",
        ]);
        let scan = scan_folder(&folder.join("middle.html"));
        assert!(scan.is_project);
        assert_eq!(
            names(&scan.files),
            [
                "middle.html",
                "Apple.html",
                "banana.htm",
                "zebra.html",
                "aqua.css",
                "Yellow.css"
            ]
        );
        assert!(scan.files[0].picked);
        assert!(scan.files[1..].iter().all(|f| !f.picked));
    }

    #[test]
    fn a_picked_css_file_comes_first() {
        let (_dir, folder) = folder_with(&["a.html", "b.css", "c.css"]);
        let scan = scan_folder(&folder.join("c.css"));
        assert_eq!(names(&scan.files), ["c.css", "a.html", "b.css"]);
        assert!(scan.files[0].picked);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_listed_is_refused() {
        let (_dir, folder) = folder_with(&["a.html", "b.css"]);
        let picked = folder.join("a.html");
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o311)).unwrap();
        let scan = scan_folder(&picked);
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(scan.refused);
        assert!(!scan.is_project);
        assert!(scan.files.is_empty());
        assert!(scan.linked_css.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_entered_is_refused() {
        let (_dir, folder) = folder_with(&["a.html", "b.css"]);
        let picked = folder.join("a.html");
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o000)).unwrap();
        let scan = scan_folder(&picked);
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(scan.refused);
        assert!(!scan.is_project);
    }

    #[test]
    fn a_missing_file_is_refused() {
        let (_dir, folder) = folder_with(&[]);
        let scan = scan_folder(&folder.join("gone.html"));
        assert!(scan.refused);
        assert!(!scan.is_project);
    }

    #[cfg(unix)]
    #[test]
    fn scan_canonicalizes_the_picked_path() {
        let (_dir, folder) = folder_with(&["a.html", "b.css"]);
        fs::create_dir(folder.join("sub")).unwrap();
        let roundabout = folder.join("sub").join("..").join("a.html");
        let scan = scan_folder(&roundabout);
        assert_eq!(scan.folder, path_text(&folder));
        assert_eq!(scan.files[0].path, path_text(folder.join("a.html")));

        let via_link = tempdir().unwrap();
        let link = via_link.path().join("link");
        std::os::unix::fs::symlink(&folder, &link).unwrap();
        let scan = scan_folder(&link.join("a.html"));
        assert_eq!(scan.folder, path_text(&folder));
    }

    #[test]
    fn a_picked_dotfile_is_never_a_project() {
        let (_dir, folder) = folder_with(&[".secret.html", "a.html", "b.css"]);
        let scan = scan_folder(&folder.join(".secret.html"));
        assert!(!scan.is_project);
    }

    fn pages(count: usize) -> Vec<String> {
        (0..count).map(|n| format!("filler{n:02}.html")).collect()
    }

    #[test]
    fn not_a_project_and_a_page_picked_returns_linked_css() {
        let mut list = pages(19);
        list.extend(["style.css", "notes.txt", "other.css"].map(String::from));
        let refs: Vec<&str> = list.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        fs::write(
            folder.join("page.html"),
            "<link rel=\"stylesheet\" href=\"style.css\"><link rel=\"stylesheet\" href=\"gone.css\">",
        )
        .unwrap();
        let scan = scan_folder(&folder.join("page.html"));
        assert!(!scan.is_project);
        assert_eq!(names(&scan.linked_css), ["style.css"]);
        assert_eq!(scan.linked_css[0].kind, "css");
        assert!(!scan.linked_css[0].picked);
        assert_eq!(
            scan.linked_css[0].path,
            path_text(folder.join("style.css"))
        );
    }

    #[test]
    fn a_project_returns_no_linked_css() {
        let (_dir, folder) = folder_with(&["style.css"]);
        fs::write(
            folder.join("page.html"),
            "<link rel=stylesheet href=style.css>",
        )
        .unwrap();
        let scan = scan_folder(&folder.join("page.html"));
        assert!(scan.is_project);
        assert!(scan.linked_css.is_empty());
    }

    #[test]
    fn a_picked_css_file_returns_no_linked_css() {
        let mut list = pages(20);
        list.extend(["notes.txt", "other.css"].map(String::from));
        let refs: Vec<&str> = list.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        fs::write(folder.join("a.css"), "<link rel=stylesheet href=other.css>").unwrap();
        let scan = scan_folder(&folder.join("a.css"));
        assert!(!scan.is_project);
        assert!(scan.linked_css.is_empty());
    }

    #[test]
    fn linked_css_reads_link_tags_in_any_case_and_order() {
        let (_dir, folder) = folder_with(&["a.css", "b.css", "c.CSS", "d.css", "e.css"]);
        let html = r#"
            <LINK REL="STYLESHEET" HREF="a.css">
            <link href='b.css' rel='stylesheet'>
            <link rel=stylesheet href=c.CSS>
            <link
                 rel = "alternate stylesheet"
                 href = "d.css"
            >
            <link rel="stylesheet" href="e.css" />
        "#;
        assert_eq!(
            linked_css(html, &folder),
            ["a.css", "b.css", "c.CSS", "d.css", "e.css"]
        );
    }

    #[test]
    fn linked_css_ignores_what_is_not_a_stylesheet_link() {
        let (_dir, folder) = folder_with(&[
            "a.css", "b.css", "c.css", "d.css", "e.css", "f.css", "icon.png",
        ]);
        let html = r#"
            <link rel="icon" href="a.css">
            <link href="b.css">
            <a rel="stylesheet" href="c.css">x</a>
            <linked rel="stylesheet" href="d.css">
            <!-- <link rel="stylesheet" href="e.css"> -->
            <style>/* <link rel="stylesheet" href="f.css"> */</style>
            <link rel="stylesheet" href="icon.png">
        "#;
        assert!(linked_css(html, &folder).is_empty());
    }

    #[test]
    fn linked_css_skips_subfolders_parents_and_schemes() {
        let (_dir, folder) = folder_with(&["ok.css"]);
        fs::create_dir(folder.join("css")).unwrap();
        fs::write(folder.join("css/sub.css"), "").unwrap();
        let inner = folder.join("inner");
        fs::create_dir(&inner).unwrap();
        fs::write(folder.join("up.css"), "").unwrap();
        let html = r#"
            <link rel="stylesheet" href="css/sub.css">
            <link rel="stylesheet" href="css\sub.css">
            <link rel="stylesheet" href="../up.css">
            <link rel="stylesheet" href="..">
            <link rel="stylesheet" href="./up.css">
            <link rel="stylesheet" href="/up.css">
            <link rel="stylesheet" href="https://example.com/up.css">
            <link rel="stylesheet" href="//example.com/up.css">
            <link rel="stylesheet" href="file:up.css">
            <link rel="stylesheet" href="data:text/css,up.css">
            <link rel="stylesheet" href="">
            <link rel="stylesheet" href="ok.css">
        "#;
        assert_eq!(linked_css(html, &inner), Vec::<String>::new());
        assert_eq!(linked_css(html, &folder), ["ok.css"]);
    }

    #[test]
    fn linked_css_skips_files_not_on_disk() {
        let (_dir, folder) = folder_with(&["here.css"]);
        fs::create_dir(folder.join("folder.css")).unwrap();
        let html = r#"
            <link rel="stylesheet" href="gone.css">
            <link rel="stylesheet" href="folder.css">
            <link rel="stylesheet" href="here.css">
        "#;
        assert_eq!(linked_css(html, &folder), ["here.css"]);
    }

    #[test]
    fn linked_css_returns_at_most_five() {
        let names: Vec<String> = (0..8).map(|n| format!("s{n}.css")).collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let (_dir, folder) = folder_with(&refs);
        let html: String = names
            .iter()
            .map(|n| format!("<link rel=\"stylesheet\" href=\"{n}\">\n"))
            .collect();
        assert_eq!(
            linked_css(&html, &folder),
            ["s0.css", "s1.css", "s2.css", "s3.css", "s4.css"]
        );
    }

    #[test]
    fn linked_css_counts_only_files_on_disk_toward_the_five() {
        let (_dir, folder) =
            folder_with(&["s0.css", "s1.css", "s2.css", "s3.css", "s4.css", "s5.css"]);
        let mut html = String::from("<link rel=\"stylesheet\" href=\"gone.css\">\n");
        for n in 0..6 {
            html.push_str(&format!("<link rel=\"stylesheet\" href=\"s{n}.css\">\n"));
        }
        assert_eq!(linked_css(&html, &folder).len(), 5);
        assert_eq!(linked_css(&html, &folder)[4], "s4.css");
    }

    #[test]
    fn linked_css_lists_a_file_once_and_ignores_a_query() {
        let (_dir, folder) = folder_with(&["a.css"]);
        let html = r#"
            <link rel="stylesheet" href="a.css?v=2">
            <link rel="stylesheet" href="a.css">
            <link rel="stylesheet" href="A.CSS#x">
        "#;
        assert_eq!(linked_css(html, &folder), ["a.css"]);
    }

    #[test]
    fn linked_css_copes_with_a_half_typed_page() {
        let (_dir, folder) = folder_with(&["a.css", "b.css"]);
        assert!(linked_css("<link rel=\"stylesheet\" href=\"a.css\"", &folder).is_empty());
        assert!(linked_css("<link rel=\"stylesheet\" href=\"a.css", &folder).is_empty());
        assert!(linked_css("<!-- <link rel=\"stylesheet\" href=\"a.css\">", &folder).is_empty());
        assert!(linked_css("<", &folder).is_empty());
        assert!(linked_css("< link", &folder).is_empty());
        assert!(linked_css("<link =", &folder).is_empty());
        assert!(linked_css("<link rel=", &folder).is_empty());
        assert_eq!(
            linked_css(
                "<p title=\"ä>ö\"><link rel=\"stylesheet\" href=\"b.css\"><link ",
                &folder
            ),
            ["b.css"]
        );
    }

    const LINK: &str = "<link rel=\"stylesheet\" href=\"style.css\">";

    #[test]
    fn add_link_goes_before_head_end_with_two_more_spaces() {
        let html = "<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body>\n  </body>\n</html>\n";
        let insert = add_link(html, "style.css").unwrap();
        assert_eq!(insert.line, 4);
        assert_eq!(insert.text, format!("    {LINK}"));
    }

    #[test]
    fn add_link_finds_head_end_in_any_case_and_keeps_tabs() {
        let html = "<HTML>\n\t</HEAD>\n<BODY>";
        let insert = add_link(html, "style.css").unwrap();
        assert_eq!(insert.line, 1);
        assert_eq!(insert.text, format!("\t  {LINK}"));
    }

    #[test]
    fn add_link_with_no_head_goes_before_body_with_its_indent() {
        let html = "<!doctype html>\n<html>\n    <body class=\"x\">\n    </body>\n</html>";
        let insert = add_link(html, "style.css").unwrap();
        assert_eq!(insert.line, 2);
        assert_eq!(insert.text, format!("    {LINK}"));

        let insert = add_link("<BODY>", "style.css").unwrap();
        assert_eq!(insert.line, 0);
        assert_eq!(insert.text, LINK);
    }

    #[test]
    fn add_link_with_neither_goes_after_the_doctype() {
        let html = "\n<!DOCTYPE html>\n<p>Hello</p>\n";
        let insert = add_link(html, "style.css").unwrap();
        assert_eq!(insert.line, 2);
        assert_eq!(insert.text, LINK);
    }

    #[test]
    fn add_link_with_nothing_goes_on_the_first_line() {
        let insert = add_link("<p>Hello</p>\n", "style.css").unwrap();
        assert_eq!(insert.line, 0);
        assert_eq!(insert.text, LINK);
        let insert = add_link("", "style.css").unwrap();
        assert_eq!(insert.line, 0);
    }

    #[test]
    fn add_link_after_a_doctype_that_is_the_last_line() {
        let insert = add_link("<!doctype html>", "style.css").unwrap();
        assert_eq!(insert.line, 1);
    }

    #[test]
    fn add_link_already_linked_is_nothing() {
        let page = "<head><link rel=\"stylesheet\" href=\"style.css\"></head>";
        assert_eq!(add_link(page, "style.css"), None);
        assert_eq!(
            add_link("<LINK HREF=STYLE.CSS REL=STYLESHEET>", "style.css"),
            None
        );
        assert_eq!(
            add_link("<link rel=stylesheet href=./style.css>", "style.css"),
            None
        );
        assert_eq!(
            add_link("<link rel=stylesheet href='style.css?v=1'>", "style.css"),
            None
        );
    }

    #[test]
    fn add_link_is_not_fooled_by_other_links() {
        for page in [
            "<link rel=\"stylesheet\" href=\"other.css\">",
            "<link rel=\"icon\" href=\"style.css\">",
            "<!-- <link rel=\"stylesheet\" href=\"style.css\"> -->",
            "<a href=\"style.css\">Look</a>",
        ] {
            assert!(add_link(page, "style.css").is_some(), "{page}");
        }
    }

    #[test]
    fn add_link_skips_tags_in_comments_and_style_blocks() {
        let html = "<!-- </head> -->\n<style>/* </head> */</style>\n<head>\n</head>\n";
        assert_eq!(add_link(html, "style.css").unwrap().line, 3);
    }

    #[test]
    fn add_link_puts_the_file_name_in_the_text() {
        let insert = add_link("", "more-style.css").unwrap();
        assert_eq!(
            insert.text,
            "<link rel=\"stylesheet\" href=\"more-style.css\">"
        );
    }

    #[test]
    fn the_tag_scanner_reads_values_with_non_ascii_text() {
        let html = "<a title='pöytä>' href=pöytä.html data-x>ä</a>";
        let found = tags(html);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].attr("title"), Some("pöytä>"));
        assert_eq!(found[0].attr("href"), Some("pöytä.html"));
        assert_eq!(found[0].attr("data-x"), Some(""));
        assert_eq!(found[1].name, "a");
        assert!(found[1].closing);
    }

    #[test]
    fn scan_result_serializes_camel_case() {
        let value = serde_json::to_value(scan_result(Path::new("/a/b"))).unwrap();
        assert_eq!(value["folderName"], "b");
        assert_eq!(value["isProject"], false);
        assert_eq!(value["linkedCss"].as_array().unwrap().len(), 0);
    }
}
