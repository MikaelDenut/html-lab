// The places in a project that use a file's name, for Change Name (F3, C45). Pure: it reads
// files and the open tabs' texts and returns a plan; it never writes anything.
//
// A place is only one of the forms below, never a name in prose:
// - HTML: href, src, srcset (each candidate), poster, data (on object), action, xlink:href,
//   url() in a style attribute, url() and @import inside <style>.
// - CSS, SCSS, Less: url() quoted or not, @import "...", @import url(), @use, @forward.
// - JS, TS, JSX, TSX: import ... from '...', import '...', export ... from '...', import('...'),
//   require('...'), new URL('...', import.meta.url). String literals only.
// - SVG: href, xlink:href.
// - Markdown: [text](path), ![alt](path), and the HTML forms inside it (code is skipped).
use crate::files::{decode_text, path_text};
use crate::kinds::kind_for_name;
use crate::project::tags;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::hash::Hasher;
use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

pub const MAX_REF_FILES: usize = 2_000;
pub const MAX_REF_DEPTH: usize = 6;
pub const MAX_REF_BYTES: u64 = 5 * 1024 * 1024;
// A line longer than this many characters is cut around the place, with "..." at each cut end.
const LINE_TEXT_CHARS: usize = 300;
const LINE_CONTEXT_CHARS: usize = 120;

/// An open tab's current saved text, sent by the UI. Its path wins over the disk copy.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenText {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefPlan {
    pub files: Vec<RefFile>,
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefFile {
    pub path: String,
    pub open: bool,
    pub size: u64,
    pub hash: String,
    pub spans: Vec<Span>,
}

/// One place. `from` and `to` are BYTE offsets into the decoded text (BOM removed, CR kept)
/// for a closed file, and UTF-16 code units into the given text for an open tab.
/// `lineFrom` and `lineTo` mark the old text inside `lineText`, always in UTF-16 units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub line: usize,
    pub from: usize,
    pub to: usize,
    pub old_text: String,
    pub new_text: String,
    pub line_text: String,
    pub line_from: usize,
    pub line_to: usize,
}

/// The hash a plan and a later rewrite compare: std DefaultHasher over the raw bytes, as hex.
/// Stable within one run of the app, which is all the plan and Undo need.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    format!("{:016x}", hasher.finish())
}

/// Every place under `root` that uses `target`, with `new_name` (the name check_rename gave)
/// as the new text. On macOS and Windows names match ignoring case and after NFC.
pub fn find_references(root: &Path, target: &Path, new_name: &str, open: &[OpenText]) -> RefPlan {
    find_references_with(root, target, new_name, open, cfg!(any(target_os = "macos", windows)))
}

/// find_references with the matching rule as a parameter: `fold` true matches ignoring case
/// and after NFC (macOS, Windows), false matches exactly (Linux). Tests run both anywhere.
pub fn find_references_with(
    root: &Path,
    target: &Path,
    new_name: &str,
    open: &[OpenText],
    fold: bool,
) -> RefPlan {
    let mut plan = RefPlan {
        files: Vec::new(),
        capped: false,
    };
    let canon_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let Some(target_parts) = parts_under(root, &canon_root, target) else {
        return plan;
    };
    let Some((target_name, target_folder)) = target_parts.split_last() else {
        return plan;
    };
    let want = Want {
        folder: target_folder.iter().map(|p| key(p, fold)).collect(),
        name: key(target_name, fold),
        fold,
        new_name,
    };

    let mut seen: HashSet<String> = HashSet::new();
    for tab in open {
        let Some(parts) = parts_under(root, &canon_root, Path::new(&tab.path)) else {
            continue;
        };
        let Some((name, folder)) = parts.split_last() else {
            continue;
        };
        let Some(syntax) = syntax_for(name) else {
            continue;
        };
        if !seen.insert(path_key(&parts, fold)) {
            continue;
        }
        let spans = spans_in(&tab.text, syntax, folder, &want, true);
        if spans.is_empty() {
            continue;
        }
        plan.files.push(RefFile {
            path: tab.path.clone(),
            open: true,
            size: tab.text.len() as u64,
            hash: content_hash(tab.text.as_bytes()),
            spans,
        });
    }

    // Breadth first, each folder in name order, so files near the root are read first.
    let mut reads = 0usize;
    let mut queue: VecDeque<(PathBuf, Vec<String>, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), Vec::new(), 0));
    'walk: while let Some((dir, rel, depth)) = queue.pop_front() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<(String, fs::FileType)> = entries
            .flatten()
            .filter_map(|e| Some((e.file_name().to_str()?.to_string(), e.file_type().ok()?)))
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, kind) in entries {
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if name.starts_with('.') || name == "node_modules" || depth >= MAX_REF_DEPTH {
                    continue;
                }
                let mut sub = rel.clone();
                sub.push(name.clone());
                queue.push_back((dir.join(&name), sub, depth + 1));
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let Some(syntax) = syntax_for(&name) else {
                continue;
            };
            let mut parts = rel.clone();
            parts.push(name.clone());
            if seen.contains(&path_key(&parts, fold)) {
                continue;
            }
            let path = dir.join(&name);
            if fs::symlink_metadata(&path).map_or(true, |m| m.len() > MAX_REF_BYTES) {
                continue;
            }
            if reads == MAX_REF_FILES {
                plan.capped = true;
                break 'walk;
            }
            reads += 1;
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(decoded) = decode_text(&bytes) else {
                continue;
            };
            let spans = spans_in(&decoded.text, syntax, &rel, &want, false);
            if spans.is_empty() {
                continue;
            }
            plan.files.push(RefFile {
                path: path_text(&path),
                open: false,
                size: bytes.len() as u64,
                hash: content_hash(&bytes),
                spans,
            });
        }
    }
    plan
}

/// For the My page side (WP3): at most this many entries of the file's folder are read, and
/// at most this many pages in it.
pub const MAX_SIDE_ENTRIES: usize = 500;
pub const MAX_SIDE_PAGES: usize = 50;

/// The pages (kind is_page) in the file's own folder whose text uses it, as absolute paths:
/// index.html first, then by name. Only for a file that is not a web file (not in KINDS);
/// a web file, a folder or a missing file gives an empty list. It never writes anything.
pub fn pages_using(file: &Path) -> Vec<String> {
    pages_using_with(
        file,
        cfg!(any(target_os = "macos", windows)),
        MAX_SIDE_ENTRIES,
        MAX_SIDE_PAGES,
    )
}

/// pages_using with the matching rule and both caps as parameters, for the tests.
pub fn pages_using_with(file: &Path, fold: bool, max_entries: usize, max_pages: usize) -> Vec<String> {
    let mut found = Vec::new();
    let (Some(folder), Some(name)) = (file.parent(), file.file_name().and_then(|n| n.to_str())) else {
        return found;
    };
    if kind_for_name(name).is_some() || !fs::metadata(file).is_ok_and(|m| m.is_file()) {
        return found;
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return found;
    };
    let mut pages: Vec<String> = entries
        .take(max_entries)
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| kind_for_name(n).is_some_and(|k| k.is_page))
        .collect();
    pages.sort_by(|a, b| page_order(a).cmp(&page_order(b)));
    let want = Want {
        folder: Vec::new(),
        name: key(name, fold),
        fold,
        new_name: name,
    };
    for page in pages.into_iter().take(max_pages) {
        let path = folder.join(&page);
        if fs::metadata(&path).map_or(true, |m| m.len() > MAX_REF_BYTES) {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(decoded) = decode_text(&bytes) else {
            continue;
        };
        if !spans_in(&decoded.text, Syntax::Html, &[], &want, false).is_empty() {
            found.push(path_text(&path));
        }
    }
    found
}

// index.html first (any case), then by name ignoring case, then exactly.
fn page_order(name: &str) -> (bool, String, String) {
    (
        !name.eq_ignore_ascii_case("index.html"),
        name.to_lowercase(),
        name.to_string(),
    )
}

struct Want<'a> {
    folder: Vec<String>,
    name: String,
    fold: bool,
    new_name: &'a str,
}

// The path's parts below the root, or None when it is not inside the root.
fn parts_under(root: &Path, canon_root: &Path, path: &Path) -> Option<Vec<String>> {
    let rel = path
        .strip_prefix(root)
        .or_else(|_| path.strip_prefix(canon_root))
        .map(Path::to_path_buf)
        .or_else(|_| {
            let parent = dunce::canonicalize(path.parent().ok_or(())?).map_err(|_| ())?;
            let rel = parent.strip_prefix(canon_root).map_err(|_| ())?;
            Ok::<PathBuf, ()>(rel.join(path.file_name().ok_or(())?))
        })
        .ok()?;
    rel.components()
        .map(|c| match c {
            Component::Normal(part) => part.to_str().map(str::to_string),
            _ => None,
        })
        .collect()
}

fn key(part: &str, fold: bool) -> String {
    if fold {
        part.nfc().collect::<String>().to_lowercase()
    } else {
        part.to_string()
    }
}

fn path_key(parts: &[String], fold: bool) -> String {
    parts.iter().map(|p| key(p, fold)).collect::<Vec<_>>().join("/")
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Syntax {
    Html,
    Css,
    Scss,
    Less,
    Js,
    Svg,
    Markdown,
}

// HTML and CSS come from the kinds table (C37); the other reference syntaxes are named here.
fn syntax_for(name: &str) -> Option<Syntax> {
    if let Some(kind) = kind_for_name(name) {
        return if kind.is_page {
            Some(Syntax::Html)
        } else if kind.is_stylesheet() {
            Some(Syntax::Css)
        } else {
            None
        };
    }
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "scss" => Some(Syntax::Scss),
        "less" => Some(Syntax::Less),
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" => Some(Syntax::Js),
        "svg" => Some(Syntax::Svg),
        "md" | "markdown" => Some(Syntax::Markdown),
        _ => None,
    }
}

// How Sass and Less find a file from a name written without its ending or underscore.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Implied {
    None,
    Sass,
    Less,
}

// A piece of text that is a reference by its form: bytes start..end of the text.
struct Cand {
    start: usize,
    end: usize,
    // Characters that would end or break the reference here, so a new name must encode them.
    unsafe_chars: String,
    relative_only: bool,
    implied: Implied,
}

impl Cand {
    fn new(start: usize, end: usize, unsafe_chars: &str) -> Self {
        Cand {
            start,
            end,
            unsafe_chars: unsafe_chars.to_string(),
            relative_only: false,
            implied: Implied::None,
        }
    }
}

fn spans_in(text: &str, syntax: Syntax, folder: &[String], want: &Want, utf16: bool) -> Vec<Span> {
    let mut cands = Vec::new();
    match syntax {
        Syntax::Html => html_cands(text, HTML_ATTRS, true, &mut cands),
        Syntax::Svg => html_cands(text, SVG_ATTRS, false, &mut cands),
        Syntax::Css => css_cands(text, 0, Syntax::Css, "", true, &mut cands),
        Syntax::Scss => css_cands(text, 0, Syntax::Scss, "", true, &mut cands),
        Syntax::Less => css_cands(text, 0, Syntax::Less, "", true, &mut cands),
        Syntax::Js => js_cands(text, &mut cands),
        Syntax::Markdown => {
            let masked = mask_markdown_code(text);
            html_cands(&masked, HTML_ATTRS, true, &mut cands);
            markdown_cands(&masked, &mut cands);
        }
    }
    let folder: Vec<String> = folder.iter().map(|p| key(p, want.fold)).collect();
    let mut hits: Vec<(usize, usize, String)> = cands
        .iter()
        .filter_map(|cand| {
            let (from, to, new_text) = match_ref(&text[cand.start..cand.end], cand, &folder, want)?;
            Some((cand.start + from, cand.start + to, new_text))
        })
        .collect();
    hits.sort_by_key(|h| (h.0, h.1));
    hits.dedup_by_key(|h| (h.0, h.1));
    make_spans(text, &hits, utf16)
}

// ---------- matching one reference ----------

struct Form {
    encoded: bool,
    lower_hex: bool,
    dropped_ext: Option<&'static str>,
    dropped_underscore: bool,
    // The new name has the target's ending, so a dropped ending or underscore stays dropped.
    same_ending: bool,
}

// Where the file-name part of `raw` is (bytes, relative to raw) and the new text for it.
fn match_ref(raw: &str, cand: &Cand, folder: &[String], want: &Want) -> Option<(usize, usize, String)> {
    let lead = raw.len() - raw.trim_start_matches(is_url_space).len();
    let trimmed = raw.trim_matches(is_url_space);
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("//")
        || trimmed.starts_with('\\')
        || has_scheme(trimmed)
    {
        return None;
    }
    if cand.relative_only
        && !(trimmed.starts_with("./") || trimmed.starts_with("../") || trimmed.starts_with('/'))
    {
        return None;
    }
    let path = &trimmed[..trimmed.find(['?', '#']).unwrap_or(trimmed.len())];
    let (mut stack, rest) = match path.strip_prefix('/') {
        Some(rest) => (Vec::new(), rest),
        None => (folder.to_vec(), path),
    };
    let name_at = rest.rfind('/').map_or(0, |i| i + 1);
    let name_raw = &rest[name_at..];
    for seg in rest[..name_at].split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                stack.pop()?;
            }
            _ => stack.push(key(&percent_decode(seg)?, want.fold)),
        }
    }
    if name_raw.is_empty() || name_raw == "." || name_raw == ".." || stack != want.folder {
        return None;
    }
    let name = key(&percent_decode(name_raw)?, want.fold);
    let form = name_form(&name, name_raw, cand.implied, want)?;
    let start = lead + (path.len() - rest.len()) + name_at;
    let new_text = write_name(want.new_name, &form, &cand.unsafe_chars);
    Some((start, start + name_raw.len(), new_text))
}

const SASS_ENDINGS: &[&str] = &[".scss", ".sass"];
const LESS_ENDINGS: &[&str] = &[".less"];

// Does the written name (already decoded and keyed) name the target, and in which form?
fn name_form(name: &str, name_raw: &str, implied: Implied, want: &Want) -> Option<Form> {
    let mut form = Form {
        encoded: is_encoded(name_raw),
        lower_hex: lower_hex(name_raw),
        dropped_ext: None,
        dropped_underscore: false,
        same_ending: ending_of(&want.name) == ending_of(&want.new_name.to_lowercase()),
    };
    if name == want.name {
        return Some(form);
    }
    let (endings, underscore) = match implied {
        Implied::None => return None,
        Implied::Sass => (SASS_ENDINGS, true),
        Implied::Less => (LESS_ENDINGS, false),
    };
    for with_underscore in [false, true] {
        if with_underscore && (!underscore || name.starts_with('_')) {
            continue;
        }
        let prefix = if with_underscore { "_" } else { "" };
        if with_underscore && format!("_{name}") == want.name {
            form.dropped_underscore = true;
            return Some(form);
        }
        for ending in endings {
            if format!("{prefix}{name}{}", key(ending, want.fold)) == want.name {
                form.dropped_ext = Some(ending);
                form.dropped_underscore = with_underscore;
                return Some(form);
            }
        }
    }
    None
}

fn ending_of(name: &str) -> Option<&str> {
    name.rsplit_once('.').map(|(_, ending)| ending)
}

// The new name written the way the old one was: the same dropped ending and underscore
// (only when the new name keeps the target's ending; otherwise the whole new name, which
// always resolves), and encoded when the old one was encoded.
// An unencoded name still encodes %, #, ? and whatever would end the reference here.
fn write_name(new_name: &str, form: &Form, unsafe_chars: &str) -> String {
    let mut name = new_name;
    let keeps_ending = form.same_ending
        && form
            .dropped_ext
            .is_none_or(|ext| name.len() > ext.len() && name.to_ascii_lowercase().ends_with(ext));
    if keeps_ending {
        if let Some(ext) = form.dropped_ext {
            name = &name[..name.len() - ext.len()];
        }
        if form.dropped_underscore && name.len() > 1 {
            name = name.strip_prefix('_').unwrap_or(name);
        }
    }
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        let keep = if form.encoded {
            c.is_ascii_alphanumeric() || "-._~".contains(c)
        } else {
            !(c == '%' || c == '#' || c == '?' || c.is_control() || unsafe_chars.contains(c))
        };
        if keep {
            out.push(c);
            continue;
        }
        let mut buf = [0u8; 4];
        for byte in c.encode_utf8(&mut buf).bytes() {
            if form.lower_hex {
                out.push_str(&format!("%{byte:02x}"));
            } else {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
}

fn is_url_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0c')
}

fn has_scheme(text: &str) -> bool {
    let Some(colon) = text.find(':') else {
        return false;
    };
    let scheme = &text[..colon];
    scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
}

fn hex_pair(bytes: &[u8], at: usize) -> Option<u8> {
    let hi = (*bytes.get(at + 1)? as char).to_digit(16)?;
    let lo = (*bytes.get(at + 2)? as char).to_digit(16)?;
    Some((hi * 16 + lo) as u8)
}

fn is_encoded(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    (0..bytes.len()).any(|i| bytes[i] == b'%' && hex_pair(bytes, i).is_some())
}

fn lower_hex(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    (0..bytes.len())
        .find(|&i| bytes[i] == b'%' && hex_pair(bytes, i).is_some())
        .is_some_and(|i| bytes[i + 1..i + 3].iter().any(u8::is_ascii_lowercase))
}

// %XX decoded; a % without two hex digits stays as it is. None when the result is not UTF-8.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(byte) = hex_pair(bytes, i) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

// ---------- HTML, SVG ----------

const HTML_ATTRS: &[&str] = &["href", "src", "poster", "data", "action", "xlink:href"];
const SVG_ATTRS: &[&str] = &["href", "xlink:href"];
const HTML_UNQUOTED_UNSAFE: &str = " \t\n\r\x0c\"'=<>`";

fn html_cands(text: &str, attrs: &[&str], full: bool, out: &mut Vec<Cand>) {
    let all = tags(text);
    for tag in all.iter().filter(|t| !t.closing) {
        for name in attrs {
            if *name == "data" && tag.name != "object" {
                continue;
            }
            if let Some((at, value, quote)) = attr_at(text, tag.attr(name)) {
                let unsafe_chars = quote_unsafe(quote, HTML_UNQUOTED_UNSAFE);
                out.push(Cand::new(at, at + value.len(), &unsafe_chars));
            }
        }
        if !full {
            continue;
        }
        if let Some((at, value, quote)) = attr_at(text, tag.attr("srcset")) {
            let unsafe_chars = quote_unsafe(quote, HTML_UNQUOTED_UNSAFE) + " \t\n\r\x0c,";
            srcset_cands(value, at, &unsafe_chars, out);
        }
        if let Some((at, value, quote)) = attr_at(text, tag.attr("style")) {
            let extra = quote_unsafe(quote, HTML_UNQUOTED_UNSAFE);
            css_cands(value, at, Syntax::Css, &extra, false, out);
        }
        if tag.name == "style" {
            let lower_rest = text[tag.end..].to_ascii_lowercase();
            let end = tag.end + lower_rest.find("</style").unwrap_or(lower_rest.len());
            css_cands(&text[tag.end..end], tag.end, Syntax::Css, "", true, out);
        }
    }
}

// The attribute value's byte offset in the text, the value, and its quote (0 when unquoted).
fn attr_at<'a>(text: &str, value: Option<&'a str>) -> Option<(usize, &'a str, u8)> {
    let value = value.filter(|v| !v.is_empty())?;
    let base = text.as_ptr() as usize;
    let at = (value.as_ptr() as usize).checked_sub(base)?;
    if at + value.len() > text.len() {
        return None;
    }
    let quote = at
        .checked_sub(1)
        .map(|i| text.as_bytes()[i])
        .filter(|b| *b == b'"' || *b == b'\'')
        .unwrap_or(0);
    Some((at, value, quote))
}

fn quote_unsafe(quote: u8, unquoted: &str) -> String {
    if quote == 0 {
        unquoted.to_string()
    } else {
        (quote as char).to_string()
    }
}

fn is_html_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

// Each image candidate of a srcset, as the HTML standard splits them.
fn srcset_cands(value: &str, base: usize, unsafe_chars: &str, out: &mut Vec<Cand>) {
    let bytes = value.as_bytes();
    let mut i = 0;
    loop {
        while i < bytes.len() && (is_html_space(bytes[i]) || bytes[i] == b',') {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let start = i;
        while i < bytes.len() && !is_html_space(bytes[i]) {
            i += 1;
        }
        let mut end = i;
        while end > start && bytes[end - 1] == b',' {
            end -= 1;
        }
        out.push(Cand::new(base + start, base + end, unsafe_chars));
        if end < i {
            continue;
        }
        let mut depth = 0usize;
        while i < bytes.len() {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth = depth.saturating_sub(1),
                b',' if depth == 0 => {
                    i += 1;
                    break;
                }
                _ => {}
            }
            i += 1;
        }
    }
}

// ---------- CSS, SCSS, Less ----------

const CSS_UNQUOTED_UNSAFE: &str = " \t\n\r\x0c()'\"\\";

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn starts_with_ci(bytes: &[u8], at: usize, word: &str) -> bool {
    bytes
        .get(at..at + word.len())
        .is_some_and(|s| s.eq_ignore_ascii_case(word.as_bytes()))
}

// The end of a quoted string that opens at `at` (the index just past the closing quote is
// end + 1), or None when the line or the text ends first.
fn string_end(bytes: &[u8], at: usize) -> Option<usize> {
    let quote = bytes[at];
    let mut i = at + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'\n' => return None,
            b if b == quote => return Some(i),
            _ => i += 1,
        }
    }
    None
}

// CSS comments (and // line comments in SCSS and Less) turned into spaces, same length.
fn mask_css(text: &str, line_comments: bool) -> String {
    let bytes = text.as_bytes();
    let mut out = bytes.to_vec();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' || b == b'\'' {
            i = string_end(bytes, i).map_or(i + 1, |end| end + 1);
            continue;
        }
        if starts_with_ci(bytes, i, "url(") && (i == 0 || !is_ident_byte(bytes[i - 1])) {
            let mut j = i + 4;
            while j < bytes.len() && is_html_space(bytes[j]) {
                j += 1;
            }
            if j < bytes.len() && bytes[j] != b'"' && bytes[j] != b'\'' {
                while j < bytes.len() && bytes[j] != b')' {
                    j += 1;
                }
            }
            i = j;
            continue;
        }
        let end = if bytes[i..].starts_with(b"/*") {
            find_from(bytes, i + 2, b"*/").map_or(bytes.len(), |e| e + 2)
        } else if line_comments && bytes[i..].starts_with(b"//") {
            find_from(bytes, i, b"\n").unwrap_or(bytes.len())
        } else {
            i += 1;
            continue;
        };
        out[i..end].fill(b' ');
        i = end;
    }
    String::from_utf8(out).expect("only ASCII bytes of whole characters were replaced")
}

fn find_from(bytes: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| from + p)
}

fn css_cands(text: &str, base: usize, dialect: Syntax, extra: &str, imports: bool, out: &mut Vec<Cand>) {
    let masked = mask_css(text, matches!(dialect, Syntax::Scss | Syntax::Less));
    let bytes = masked.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' || b == b'\'' {
            i = string_end(bytes, i).map_or(i + 1, |end| end + 1);
            continue;
        }
        if starts_with_ci(bytes, i, "url(") && (i == 0 || !is_ident_byte(bytes[i - 1])) {
            let mut j = i + 4;
            while j < bytes.len() && is_html_space(bytes[j]) {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                if let Some(end) = string_end(bytes, j) {
                    let unsafe_chars = format!("{}\\\n{extra}", bytes[j] as char);
                    out.push(Cand::new(base + j + 1, base + end, &unsafe_chars));
                    i = end + 1;
                } else {
                    i = j + 1;
                }
                continue;
            }
            let start = j;
            while j < bytes.len() && !b")\"'".contains(&bytes[j]) && !is_html_space(bytes[j]) {
                j += 1;
            }
            if j > start {
                out.push(Cand::new(base + start, base + j, &format!("{CSS_UNQUOTED_UNSAFE}{extra}")));
            }
            i = j;
            continue;
        }
        if b == b'@' && imports {
            let mut j = i + 1;
            while j < bytes.len() && is_ident_byte(bytes[j]) {
                j += 1;
            }
            let word = masked[i + 1..j].to_ascii_lowercase();
            if !matches!(word.as_str(), "import" | "use" | "forward") {
                i = j;
                continue;
            }
            let implied = match dialect {
                Syntax::Scss => Implied::Sass,
                Syntax::Less if word == "import" => Implied::Less,
                _ => Implied::None,
            };
            let skip_space = |mut k: usize| {
                while k < bytes.len() && is_html_space(bytes[k]) {
                    k += 1;
                }
                k
            };
            let mut k = skip_space(j);
            if dialect == Syntax::Less && bytes.get(k) == Some(&b'(') {
                k = find_from(bytes, k, b")").map_or(bytes.len(), |e| e + 1);
                k = skip_space(k);
            }
            while k < bytes.len() && (bytes[k] == b'"' || bytes[k] == b'\'') {
                let Some(end) = string_end(bytes, k) else {
                    break;
                };
                let mut cand = Cand::new(base + k + 1, base + end, &format!("{}\\\n{extra}", bytes[k] as char));
                cand.implied = implied;
                out.push(cand);
                k = skip_space(end + 1);
                if word == "import" && bytes.get(k) == Some(&b',') {
                    k = skip_space(k + 1);
                    continue;
                }
                break;
            }
            i = k.max(j);
            continue;
        }
        i += 1;
    }
}

// ---------- JS, TS, JSX, TSX ----------

#[derive(Debug, PartialEq, Eq)]
enum Tok<'a> {
    Ident(&'a str),
    // A string literal with no escapes and no ${}: content bytes start..end and its quote.
    Str(usize, usize, u8),
    // Any other value: a string with escapes, a template with ${}, a regular expression.
    Value,
    Punct(u8),
}

const REGEX_AFTER_WORDS: &[&str] = &[
    "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw",
    "instanceof", "yield", "await",
];

fn is_js_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

fn js_tokens(text: &str) -> Vec<Tok<'_>> {
    let bytes = text.as_bytes();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() {
            i += 1;
        } else if bytes[i..].starts_with(b"//") {
            i = find_from(bytes, i, b"\n").unwrap_or(bytes.len());
        } else if bytes[i..].starts_with(b"/*") {
            i = find_from(bytes, i + 2, b"*/").map_or(bytes.len(), |e| e + 2);
        } else if b == b'"' || b == b'\'' {
            let mut j = i + 1;
            let mut plain = true;
            let mut closed = false;
            while j < bytes.len() && bytes[j] != b'\n' {
                if bytes[j] == b'\\' {
                    plain = false;
                    j += 2;
                    continue;
                }
                if bytes[j] == b {
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed && plain {
                toks.push(Tok::Str(i + 1, j, b));
            } else {
                toks.push(Tok::Value);
            }
            i = if closed { j + 1 } else { j };
        } else if b == b'`' {
            let mut j = i + 1;
            let mut plain = true;
            while j < bytes.len() && bytes[j] != b'`' {
                if bytes[j] == b'\\' {
                    plain = false;
                    j += 2;
                    continue;
                }
                if bytes[j..].starts_with(b"${") {
                    plain = false;
                }
                j += 1;
            }
            if plain && j < bytes.len() {
                toks.push(Tok::Str(i + 1, j, b));
            } else {
                toks.push(Tok::Value);
            }
            i = j + 1;
        } else if b == b'/' && regex_may_start(toks.last()) {
            let mut j = i + 1;
            let mut in_class = false;
            while j < bytes.len() && bytes[j] != b'\n' {
                match bytes[j] {
                    b'\\' => {
                        j += 2;
                        continue;
                    }
                    b'[' => in_class = true,
                    b']' => in_class = false,
                    b'/' if !in_class => {
                        j += 1;
                        break;
                    }
                    _ => {}
                }
                j += 1;
            }
            while j < bytes.len() && is_js_ident_byte(bytes[j]) {
                j += 1;
            }
            toks.push(Tok::Value);
            i = j.min(bytes.len());
        } else if is_js_ident_byte(b) {
            let mut j = i;
            while j < bytes.len() && is_js_ident_byte(bytes[j]) {
                j += 1;
            }
            toks.push(Tok::Ident(&text[i..j]));
            i = j;
        } else {
            toks.push(Tok::Punct(b));
            i += 1;
        }
    }
    toks
}

fn regex_may_start(prev: Option<&Tok>) -> bool {
    match prev {
        None => true,
        Some(Tok::Punct(p)) => b"(,=:[!&|?{};+-*%<>~^".contains(p),
        Some(Tok::Ident(word)) => REGEX_AFTER_WORDS.contains(word),
        _ => false,
    }
}

fn js_cands(text: &str, out: &mut Vec<Cand>) {
    let toks = js_tokens(text);
    let at = |i: usize| toks.get(i);
    let ident = |i: usize, word: &str| at(i) == Some(&Tok::Ident(word));
    let punct = |i: usize, p: u8| at(i) == Some(&Tok::Punct(p));
    let after_dot = |i: usize| i > 0 && punct(i - 1, b'.');
    let push = |out: &mut Vec<Cand>, tok: Option<&Tok>, relative_only: bool| {
        if let Some(Tok::Str(start, end, quote)) = tok {
            let unsafe_chars = format!("{}\\\n\r", *quote as char);
            let mut cand = Cand::new(*start, *end, &unsafe_chars);
            cand.relative_only = relative_only;
            out.push(cand);
        }
    };
    for i in 0..toks.len() {
        if after_dot(i) {
            continue;
        }
        if ident(i, "from") || ident(i, "import") {
            push(out, at(i + 1), true);
        }
        if (ident(i, "import") || ident(i, "require"))
            && punct(i + 1, b'(')
            && (punct(i + 3, b')') || punct(i + 3, b','))
        {
            push(out, at(i + 2), true);
        }
        if ident(i, "new")
            && ident(i + 1, "URL")
            && punct(i + 2, b'(')
            && punct(i + 4, b',')
            && ident(i + 5, "import")
            && punct(i + 6, b'.')
            && ident(i + 7, "meta")
            && punct(i + 8, b'.')
            && ident(i + 9, "url")
        {
            push(out, at(i + 3), false);
        }
    }
}

// ---------- Markdown ----------

// Fenced code blocks and inline code spans turned into spaces, same length.
fn mask_markdown_code(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = bytes.to_vec();
    let mut fence: Option<(u8, usize)> = None;
    let mut line_start = 0;
    while line_start < bytes.len() {
        let line_end = find_from(bytes, line_start, b"\n").map_or(bytes.len(), |e| e + 1);
        let line = &bytes[line_start..line_end];
        let indent = line.iter().take_while(|b| **b == b' ').count();
        let rest = &line[indent.min(line.len())..];
        let run_char = rest.first().copied().filter(|c| *c == b'`' || *c == b'~');
        let run = run_char.map_or(0, |c| rest.iter().take_while(|b| **b == c).count());
        match fence {
            Some((c, len)) => {
                out[line_start..line_end].fill(b' ');
                if indent < 4 && run_char == Some(c) && run >= len {
                    fence = None;
                }
            }
            None if indent < 4 && run >= 3 => {
                out[line_start..line_end].fill(b' ');
                fence = run_char.map(|c| (c, run));
            }
            None => mask_inline_code(bytes, &mut out, line_start, line_end),
        }
        line_start = line_end;
    }
    String::from_utf8(out).expect("only whole characters were replaced with spaces")
}

fn mask_inline_code(bytes: &[u8], out: &mut [u8], from: usize, to: usize) {
    let mut i = from;
    while i < to {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let run = bytes[i..to].iter().take_while(|b| **b == b'`').count();
        let mut j = i + run;
        let mut closed = None;
        while j < to {
            if bytes[j] == b'`' {
                let other = bytes[j..to].iter().take_while(|b| **b == b'`').count();
                if other == run {
                    closed = Some(j + other);
                    break;
                }
                j += other;
            } else {
                j += 1;
            }
        }
        match closed {
            Some(end) => {
                out[i..end].fill(b' ');
                i = end;
            }
            None => i += run,
        }
    }
}

// [text](path) and ![alt](path): the link destination.
fn markdown_cands(text: &str, out: &mut Vec<Cand>) {
    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(at) = find_from(bytes, from, b"](") {
        from = at + 2;
        let mut i = at + 2;
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
            i += 1;
        }
        if bytes.get(i) == Some(&b'<') {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && !b"<>\n".contains(&bytes[j]) {
                j += 1;
            }
            if bytes.get(j) == Some(&b'>') && j > start {
                out.push(Cand::new(start, j, "<>\n"));
            }
            continue;
        }
        let start = i;
        let mut depth = 0usize;
        let mut j = start;
        while j < bytes.len() && !bytes[j].is_ascii_whitespace() && !bytes[j].is_ascii_control() {
            match bytes[j] {
                b'\\' => {
                    j += 2;
                    continue;
                }
                b'(' => depth += 1,
                b')' if depth == 0 => break,
                b')' => depth -= 1,
                _ => {}
            }
            j += 1;
        }
        let j = j.min(bytes.len());
        if j > start {
            out.push(Cand::new(start, j, " \t\n\r()<>"));
        }
    }
}

// ---------- spans, lines, UTF-16 ----------

fn make_spans(text: &str, hits: &[(usize, usize, String)], utf16: bool) -> Vec<Span> {
    let bytes = text.as_bytes();
    let mut line_starts = vec![0usize];
    for (i, b) in bytes.iter().enumerate() {
        let breaks = *b == b'\n' || (*b == b'\r' && bytes.get(i + 1) != Some(&b'\n'));
        if breaks {
            line_starts.push(i + 1);
        }
    }
    let mut units = Utf16Cursor::new(text);
    hits.iter()
        .map(|(from, to, new_text)| {
            let line = line_starts.partition_point(|s| *s <= *from);
            let line_start = line_starts[line - 1];
            let line_end = line_starts
                .get(line)
                .copied()
                .unwrap_or(bytes.len());
            let line_end = line_start + text[line_start..line_end].trim_end_matches(['\r', '\n']).len();
            let (line_text, line_from, line_to) = line_window(text, line_start, line_end, *from, *to);
            let (from_out, to_out) = if utf16 {
                (units.at(*from), units.at(*to))
            } else {
                (*from, *to)
            };
            Span {
                line,
                from: from_out,
                to: to_out,
                old_text: text[*from..*to].to_string(),
                new_text: new_text.clone(),
                line_text,
                line_from,
                line_to,
            }
        })
        .collect()
}

// The line's text (cut around the place when it is long) and where the old text is in it.
fn line_window(text: &str, start: usize, end: usize, from: usize, to: usize) -> (String, usize, usize) {
    let line = &text[start..end];
    let units = |s: &str| s.encode_utf16().count();
    if line.chars().count() <= LINE_TEXT_CHARS {
        let line_from = units(&text[start..from]);
        return (line.to_string(), line_from, line_from + units(&text[from..to]));
    }
    let before: Vec<usize> = text[start..from].char_indices().map(|(i, _)| start + i).collect();
    let cut_start = before
        .len()
        .checked_sub(LINE_CONTEXT_CHARS)
        .map_or(start, |k| before[k]);
    let cut_end = text[to..end]
        .char_indices()
        .nth(LINE_CONTEXT_CHARS)
        .map_or(end, |(i, _)| to + i);
    let head = if cut_start > start { "..." } else { "" };
    let tail = if cut_end < end { "..." } else { "" };
    let line_from = head.len() + units(&text[cut_start..from]);
    let shown = format!("{head}{}{tail}", &text[cut_start..cut_end]);
    (shown, line_from, line_from + units(&text[from..to]))
}

// Byte offsets to UTF-16 code units, for offsets asked in rising order.
struct Utf16Cursor<'a> {
    text: &'a str,
    byte: usize,
    unit: usize,
}

impl<'a> Utf16Cursor<'a> {
    fn new(text: &'a str) -> Self {
        Utf16Cursor { text, byte: 0, unit: 0 }
    }

    fn at(&mut self, byte: usize) -> usize {
        if byte < self.byte {
            self.byte = 0;
            self.unit = 0;
        }
        for (i, c) in self.text[self.byte..].char_indices() {
            if self.byte + i >= byte {
                break;
            }
            self.unit += c.len_utf16();
        }
        self.byte = byte;
        self.unit
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn project(files: &[(&str, &[u8])]) -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (rel, bytes) in files {
            let path = dir.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }
        dir
    }

    fn find(dir: &TempDir, target: &str, new: &str, open: &[OpenText], fold: bool) -> RefPlan {
        find_references_with(dir.path(), &dir.path().join(target), new, open, fold)
    }

    fn entry<'a>(plan: &'a RefPlan, dir: &TempDir, rel: &str) -> Option<&'a RefFile> {
        let path = path_text(dir.path().join(rel));
        plan.files.iter().find(|f| f.path == path)
    }

    // Puts each span's new text in place of its old text (byte offsets), checking the old text.
    fn splice(text: &str, spans: &[Span]) -> String {
        let mut out = String::new();
        let mut at = 0;
        for span in spans {
            assert_eq!(&text[span.from..span.to], span.old_text);
            out.push_str(&text[at..span.from]);
            out.push_str(&span.new_text);
            at = span.to;
        }
        out.push_str(&text[at..]);
        out
    }

    // The same with UTF-16 offsets, as for an open tab.
    fn splice16(text: &str, spans: &[Span]) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut out: Vec<u16> = Vec::new();
        let mut at = 0;
        for span in spans {
            assert_eq!(String::from_utf16(&units[span.from..span.to]).unwrap(), span.old_text);
            out.extend_from_slice(&units[at..span.from]);
            out.extend(span.new_text.encode_utf16());
            at = span.to;
        }
        out.extend_from_slice(&units[at..]);
        String::from_utf16(&out).unwrap()
    }

    // The referring file on disk after its spans are put in, or None when it is not listed.
    fn after(plan: &RefPlan, dir: &TempDir, rel: &str) -> Option<String> {
        let file = entry(plan, dir, rel)?;
        let bytes = fs::read(dir.path().join(rel)).unwrap();
        Some(splice(&decode_text(&bytes).unwrap().text, &file.spans))
    }

    fn both() -> [bool; 2] {
        [true, false]
    }

    #[test]
    fn html_attributes_style_and_style_blocks_are_found() {
        let before = r#"<!doctype html>
<link rel="icon" href="img/old.png?v=2">
<img src='./img/old.png#top' srcset="img/old.png 1x, ./img/old.png?x=1 2x,img/old.png" alt="img/old.png">
<video poster=img/old.png></video>
<object data="/img/old.png"></object>
<form action="img/old.png"></form>
<svg><use xlink:href="img/old.png#a"></use><image href="img/old.png"/></svg>
<div style="background: url(img/old.png), url('img/old.png?q')"></div>
<style>
  body { background: url("img/old.png#h"); }
  @import "img/old.png";
  /* url(img/old.png) */
</style>
<p>The file img/old.png is in prose.</p>
<!-- <img src="img/old.png"> -->
<div data="img/old.png" title="img/old.png"></div>
<img src="other/old.png"><img src="img/old.pngx"><img src="img/xold.png">
"#;
        let wanted = r#"<!doctype html>
<link rel="icon" href="img/new.png?v=2">
<img src='./img/new.png#top' srcset="img/new.png 1x, ./img/new.png?x=1 2x,img/new.png" alt="img/old.png">
<video poster=img/new.png></video>
<object data="/img/new.png"></object>
<form action="img/new.png"></form>
<svg><use xlink:href="img/new.png#a"></use><image href="img/new.png"/></svg>
<div style="background: url(img/new.png), url('img/new.png?q')"></div>
<style>
  body { background: url("img/new.png#h"); }
  @import "img/new.png";
  /* url(img/old.png) */
</style>
<p>The file img/old.png is in prose.</p>
<!-- <img src="img/old.png"> -->
<div data="img/old.png" title="img/old.png"></div>
<img src="other/old.png"><img src="img/old.pngx"><img src="img/xold.png">
"#;
        let dir = project(&[("index.html", before.as_bytes()), ("img/old.png", b"png")]);
        for fold in both() {
            let plan = find(&dir, "img/old.png", "new.png", &[], fold);
            assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted, "fold {fold}");
            assert_eq!(plan.files.len(), 1);
            assert!(!plan.capped);
        }
    }

    #[test]
    fn absolute_and_special_urls_are_left_alone() {
        let before = r##"<a href="https://example.com/old.png">a</a>
<a href="//cdn.example.com/old.png">b</a>
<img src="data:image/png;base64,old.png">
<a href="mailto:old.png@example.com">c</a>
<a href="#old.png">d</a>
<a href="file:old.png">e</a>
<a href="old.png">f</a>
"##;
        let wanted = before.replace(r#"<a href="old.png">f"#, r#"<a href="new.png">f"#);
        let dir = project(&[("index.html", before.as_bytes())]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);
        assert_eq!(entry(&plan, &dir, "index.html").unwrap().spans.len(), 1);
    }

    #[test]
    fn paths_resolve_from_the_referring_folder_and_the_root() {
        let page = r#"<img src="../img/old.png"><img src="./../img/old.png?a#b"><img src="/img/old.png">
<img src="img/old.png"><img src="../../img/old.png"><img src="../img/./old.png"><img src="..//img/old.png">
"#;
        let page_after = r#"<img src="../img/new.png"><img src="./../img/new.png?a#b"><img src="/img/new.png">
<img src="img/old.png"><img src="../../img/old.png"><img src="../img/./new.png"><img src="..//img/new.png">
"#;
        // From the root, ../ leaves the project, so nothing there is the target.
        let root_page = r#"<img src="../img/old.png"><img src="img/old.png">"#;
        let root_after = r#"<img src="../img/old.png"><img src="img/new.png">"#;
        let dir = project(&[("pages/a.html", page.as_bytes()), ("index.html", root_page.as_bytes())]);
        for fold in both() {
            let plan = find(&dir, "img/old.png", "new.png", &[], fold);
            assert_eq!(after(&plan, &dir, "pages/a.html").unwrap(), page_after);
            assert_eq!(after(&plan, &dir, "index.html").unwrap(), root_after);
        }
    }

    #[test]
    fn the_span_covers_only_the_file_name() {
        let dir = project(&[("pages/a.html", br#"<img src="../img/old.png?v=1#top">"#)]);
        let plan = find(&dir, "img/old.png", "new.png", &[], true);
        let span = &entry(&plan, &dir, "pages/a.html").unwrap().spans[0];
        assert_eq!((span.from, span.to), (17, 24));
        assert_eq!(span.old_text, "old.png");
        assert_eq!(span.new_text, "new.png");
        assert_eq!(span.line, 1);
        assert_eq!(span.line_text, r#"<img src="../img/old.png?v=1#top">"#);
        assert_eq!((span.line_from, span.line_to), (17, 24));
    }

    #[test]
    fn a_query_or_a_hash_is_kept_and_not_matched() {
        let before = "<a href=\"page.html?x=1\">a</a><a href=\"page.html#top\">b</a><a href=\"page.html?\">c</a>\n";
        let wanted = "<a href=\"next.html?x=1\">a</a><a href=\"next.html#top\">b</a><a href=\"next.html?\">c</a>\n";
        let dir = project(&[("index.html", before.as_bytes())]);
        for fold in both() {
            let plan = find(&dir, "page.html", "next.html", &[], fold);
            assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);
        }
    }

    #[test]
    fn percent_encoding_is_decoded_to_match_and_kept_in_the_new_name() {
        let before = r#"<img src="img/my%20old.png"><img src="img/my old.png"><img src="img%2Fmy%20old.png">
<img srcset="img/my%20old.png 1x"><div style="background: url(img/my%20old.png)"></div>
<img src="img/my%c3%a4old.png">
"#;
        let wanted = r#"<img src="img/your%20new%20%C3%A4.png"><img src="img/your new ä.png"><img src="img%2Fmy%20old.png">
<img srcset="img/your%20new%20%C3%A4.png 1x"><div style="background: url(img/your%20new%20%C3%A4.png)"></div>
<img src="img/my%c3%a4old.png">
"#;
        let dir = project(&[("index.html", before.as_bytes())]);
        let plan = find(&dir, "img/my old.png", "your new ä.png", &[], true);
        assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);

        // Lowercase hex in the old name gives lowercase hex in the new one.
        let plan = find(&dir, "img/myäold.png", "uusi ä.png", &[], true);
        let span = entry(&plan, &dir, "index.html").unwrap().spans.last().cloned().unwrap();
        assert_eq!(span.old_text, "my%c3%a4old.png");
        assert_eq!(span.new_text, "uusi%20%c3%a4.png");
    }

    #[test]
    fn an_unencoded_new_name_encodes_what_would_break_the_reference() {
        let before = r#"<a href="old.html">a</a><a href=old.html>b</a><img srcset="old.html 1x">
<p style="background: url(old.html)"></p>
"#;
        let wanted = r#"<a href="my page 100%25 %231.html">a</a><a href=my%20page%20100%25%20%231.html>b</a><img srcset="my%20page%20100%25%20%231.html 1x">
<p style="background: url(my%20page%20100%25%20%231.html)"></p>
"#;
        let dir = project(&[("index.html", before.as_bytes())]);
        let plan = find(&dir, "old.html", "my page 100% #1.html", &[], true);
        assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);
    }

    #[test]
    fn css_url_and_import_forms_are_found() {
        let before = r#"@import "base.css";
@import url(base.css);
@import url("./base.css?x");
@import 'base.css' screen;
.a { background: url(../img/old.png) }
.b { background: url( "../img/old.png#x" ) }
.c { background: URL('/img/old.png') }
/* url(../img/old.png) and @import "base.css"; */
.d::after { content: "url(../img/old.png)"; }
.e { background: myurl(../img/old.png) }
"#;
        let img_after = r#"@import "base.css";
@import url(base.css);
@import url("./base.css?x");
@import 'base.css' screen;
.a { background: url(../img/new.png) }
.b { background: url( "../img/new.png#x" ) }
.c { background: URL('/img/new.png') }
/* url(../img/old.png) and @import "base.css"; */
.d::after { content: "url(../img/old.png)"; }
.e { background: myurl(../img/old.png) }
"#;
        let base_after = r#"@import "reset.css";
@import url(reset.css);
@import url("./reset.css?x");
@import 'reset.css' screen;
.a { background: url(../img/old.png) }
.b { background: url( "../img/old.png#x" ) }
.c { background: URL('/img/old.png') }
/* url(../img/old.png) and @import "base.css"; */
.d::after { content: "url(../img/old.png)"; }
.e { background: myurl(../img/old.png) }
"#;
        let dir = project(&[("css/style.css", before.as_bytes())]);
        for fold in both() {
            let plan = find(&dir, "img/old.png", "new.png", &[], fold);
            assert_eq!(after(&plan, &dir, "css/style.css").unwrap(), img_after);
            let plan = find(&dir, "css/base.css", "reset.css", &[], fold);
            assert_eq!(after(&plan, &dir, "css/style.css").unwrap(), base_after);
        }
    }

    #[test]
    fn scss_use_forward_and_import_find_partials() {
        let before = r#"@use "colors";
@use 'colors' as c;
@forward "colors";
@import "colors", "other";
@use "./colors.scss";
@use "_colors";
@use "sass:math";
// @use "colors";
.a { background: url(../img/old.png); } // url(../img/old.png)
"#;
        let wanted = r#"@use "palette";
@use 'palette' as c;
@forward "palette";
@import "palette", "other";
@use "./palette.scss";
@use "_palette";
@use "sass:math";
// @use "colors";
.a { background: url(../img/old.png); } // url(../img/old.png)
"#;
        let wanted_css = r#"@use "_palette.css";
@use '_palette.css' as c;
@forward "_palette.css";
@import "_palette.css", "other";
@use "./_palette.css";
@use "_palette.css";
@use "sass:math";
// @use "colors";
.a { background: url(../img/old.png); } // url(../img/old.png)
"#;
        let dir = project(&[("scss/main.scss", before.as_bytes())]);
        let plan = find(&dir, "scss/_colors.scss", "_palette.scss", &[], true);
        assert_eq!(after(&plan, &dir, "scss/main.scss").unwrap(), wanted);
        let plan = find(&dir, "scss/_colors.scss", "_palette.css", &[], true);
        assert_eq!(after(&plan, &dir, "scss/main.scss").unwrap(), wanted_css);
        // The url() in SCSS is found, the one in the // comment is not.
        let plan = find(&dir, "img/old.png", "new.png", &[], true);
        assert_eq!(entry(&plan, &dir, "scss/main.scss").unwrap().spans.len(), 1);
    }

    #[test]
    fn less_import_finds_a_name_without_its_ending() {
        let before = "@import (reference) \"theme\";\n@import \"theme.less\";\n@import url(theme.less);\n// @import \"theme\";\n";
        let wanted = "@import (reference) \"dark\";\n@import \"dark.less\";\n@import url(dark.less);\n// @import \"theme\";\n";
        let dir = project(&[("styles/main.less", before.as_bytes())]);
        let plan = find(&dir, "styles/theme.less", "dark.less", &[], true);
        assert_eq!(after(&plan, &dir, "styles/main.less").unwrap(), wanted);
    }

    #[test]
    fn js_module_forms_are_found_and_nothing_else() {
        let before = r#"import x from './util.js';
import { a,
  b } from "./util.js?v=1";
import './util.js';
export * from '../js/util.js';
export { c } from "/js/util.js";
const m = await import('./util.js');
const n = import("./util.js", { with: {} });
const r = require("./util.js");
const u = new URL('./util.js', import.meta.url);
const v = new URL('util.js', import.meta.url);
const s = './util.js';
// import y from './util.js';
/* require('./util.js') */
const t = `./util.js`;
import z from 'util.js';
const re = /'.\/util.js'/g;
obj.require('./util.js');
const e = require('./util\x2ejs');
"#;
        let wanted = r#"import x from './tools.js';
import { a,
  b } from "./tools.js?v=1";
import './tools.js';
export * from '../js/tools.js';
export { c } from "/js/tools.js";
const m = await import('./tools.js');
const n = import("./tools.js", { with: {} });
const r = require("./tools.js");
const u = new URL('./tools.js', import.meta.url);
const v = new URL('tools.js', import.meta.url);
const s = './util.js';
// import y from './util.js';
/* require('./util.js') */
const t = `./util.js`;
import z from 'util.js';
const re = /'.\/util.js'/g;
obj.require('./util.js');
const e = require('./util\x2ejs');
"#;
        for name in ["app.js", "app.mjs", "app.cjs", "app.ts", "app.mts", "app.cts", "app.jsx", "app.tsx"] {
            let rel = format!("js/{name}");
            let dir = project(&[(rel.as_str(), before.as_bytes())]);
            for fold in both() {
                let plan = find(&dir, "js/util.js", "tools.js", &[], fold);
                assert_eq!(after(&plan, &dir, &rel).unwrap(), wanted, "{name}");
            }
        }
    }

    #[test]
    fn jsx_text_with_an_apostrophe_does_not_hide_a_later_import() {
        let before = "const p = <p>Don't import './util.js' here</p>;\nimport y from './util.js';\n";
        let wanted = "const p = <p>Don't import './util.js' here</p>;\nimport y from './tools.js';\n";
        let dir = project(&[("app.jsx", before.as_bytes())]);
        let plan = find(&dir, "util.js", "tools.js", &[], true);
        assert_eq!(after(&plan, &dir, "app.jsx").unwrap(), wanted);
    }

    #[test]
    fn svg_href_and_xlink_href_are_found() {
        let before = r#"<svg xmlns="http://www.w3.org/2000/svg"><use href="old.svg#a"/><image xlink:href='./old.svg'/><text>old.svg</text><image src="old.svg"/></svg>"#;
        let wanted = r#"<svg xmlns="http://www.w3.org/2000/svg"><use href="new.svg#a"/><image xlink:href='./new.svg'/><text>old.svg</text><image src="old.svg"/></svg>"#;
        let dir = project(&[("img/icons.svg", before.as_bytes())]);
        let plan = find(&dir, "img/old.svg", "new.svg", &[], true);
        assert_eq!(after(&plan, &dir, "img/icons.svg").unwrap(), wanted);
    }

    #[test]
    fn markdown_links_images_and_html_are_found_but_not_code_or_prose() {
        let before = r#"# Title
See [the picture](../img/old.png) and ![pic](../img/old.png "Old").
Also [angle](<../img/old.png?x>) and <img src="../img/old.png">.
The name old.png in prose and ../img/old.png too.
Inline `![code](../img/old.png)` is code.
```
![fenced](../img/old.png)
```
[web](https://example.com/img/old.png) [up](../img/old.png#top)
"#;
        let wanted = r#"# Title
See [the picture](../img/new.png) and ![pic](../img/new.png "Old").
Also [angle](<../img/new.png?x>) and <img src="../img/new.png">.
The name old.png in prose and ../img/old.png too.
Inline `![code](../img/old.png)` is code.
```
![fenced](../img/old.png)
```
[web](https://example.com/img/old.png) [up](../img/new.png#top)
"#;
        for name in ["readme.md", "readme.markdown"] {
            let rel = format!("docs/{name}");
            let dir = project(&[(rel.as_str(), before.as_bytes())]);
            let plan = find(&dir, "img/old.png", "new.png", &[], true);
            assert_eq!(after(&plan, &dir, &rel).unwrap(), wanted, "{name}");
        }
    }

    #[test]
    fn markdown_link_new_name_with_a_space_is_encoded() {
        let dir = project(&[("a.md", b"[x](old.md) [y](<old.md>)\n")]);
        let plan = find(&dir, "old.md", "new notes.md", &[], true);
        assert_eq!(after(&plan, &dir, "a.md").unwrap(), "[x](new%20notes.md) [y](<new notes.md>)\n");
    }

    #[test]
    fn single_and_double_quotes_and_unquoted_values_all_match() {
        let before = "<a href='a.html'>1</a><a href=\"a.html\">2</a><a href=a.html>3</a><a href = \" a.html \">4</a>\n";
        let wanted = "<a href='b.html'>1</a><a href=\"b.html\">2</a><a href=b.html>3</a><a href = \" b.html \">4</a>\n";
        let dir = project(&[("index.html", before.as_bytes())]);
        let plan = find(&dir, "a.html", "b.html", &[], true);
        assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);
    }

    const REFERRER_LF: &str = "ä\n<p>ä 😀 <img src=\"old.png\"></p>\n";

    fn utf16_bytes(text: &str, big_endian: bool) -> Vec<u8> {
        let mut bytes = if big_endian { vec![0xFE, 0xFF] } else { vec![0xFF, 0xFE] };
        for unit in text.encode_utf16() {
            let pair = if big_endian { unit.to_be_bytes() } else { unit.to_le_bytes() };
            bytes.extend_from_slice(&pair);
        }
        bytes
    }

    #[test]
    fn offsets_point_at_the_name_in_lf_crlf_bom_and_utf16_files() {
        let crlf = REFERRER_LF.replace('\n', "\r\n");
        let mut bom = b"\xEF\xBB\xBF".to_vec();
        bom.extend_from_slice(REFERRER_LF.as_bytes());
        // (file, raw bytes, from, to) with the offsets counted by hand in the decoded text:
        // "ä\n" is 3 bytes (4 with CR), then "<p>ä 😀 <img src=\"" is 3 + 2 + 1 + 4 + 1 + 10 = 21.
        let cases: Vec<(&str, Vec<u8>, usize, usize)> = vec![
            ("lf.html", REFERRER_LF.as_bytes().to_vec(), 24, 31),
            ("crlf.html", crlf.as_bytes().to_vec(), 25, 32),
            ("bom.html", bom, 24, 31),
            ("le.html", utf16_bytes(REFERRER_LF, false), 24, 31),
            ("be.html", utf16_bytes(REFERRER_LF, true), 24, 31),
        ];
        let files: Vec<(&str, &[u8])> = cases.iter().map(|(n, b, _, _)| (*n, b.as_slice())).collect();
        let dir = project(&files);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert_eq!(plan.files.len(), 5);
        for (name, raw, from, to) in &cases {
            let file = entry(&plan, &dir, name).unwrap();
            assert_eq!(file.spans.len(), 1, "{name}");
            let span = &file.spans[0];
            assert_eq!((span.from, span.to), (*from, *to), "{name}");
            assert_eq!(span.line, 2, "{name}");
            assert_eq!(span.line_text, "<p>ä 😀 <img src=\"old.png\"></p>", "{name}");
            // In UTF-16 units: "<p>ä 😀 <img src=\"" is 3 + 1 + 1 + 2 + 1 + 10 = 18.
            assert_eq!((span.line_from, span.line_to), (18, 25), "{name}");
            assert_eq!(file.size, raw.len() as u64, "{name}");
            assert_eq!(file.hash, content_hash(raw), "{name}");
            let text = decode_text(raw).unwrap().text;
            let wanted = if *name == "crlf.html" {
                "ä\r\n<p>ä 😀 <img src=\"new.png\"></p>\r\n"
            } else {
                "ä\n<p>ä 😀 <img src=\"new.png\"></p>\n"
            };
            assert_eq!(splice(&text, &file.spans), wanted, "{name}");
        }
        let hashes: HashSet<&str> = plan.files.iter().map(|f| f.hash.as_str()).collect();
        assert_eq!(hashes.len(), 5);
    }

    #[test]
    fn an_open_tab_gets_utf16_offsets_and_wins_over_the_disk() {
        let dir = project(&[
            ("tab.html", b"<img src=\"old.png\"><img src=\"old.png\">"),
            ("quiet.html", b"<img src=\"old.png\">"),
        ]);
        let open = vec![
            OpenText {
                path: path_text(dir.path().join("tab.html")),
                text: REFERRER_LF.to_string(),
            },
            // An open tab with no place hides the disk copy that has one.
            OpenText {
                path: path_text(dir.path().join("quiet.html")),
                text: "<p>nothing here</p>".to_string(),
            },
        ];
        for fold in both() {
            let plan = find(&dir, "old.png", "new.png", &open, fold);
            assert_eq!(plan.files.len(), 1);
            let file = &plan.files[0];
            assert!(file.open);
            assert_eq!(file.path, open[0].path);
            assert_eq!(file.size, REFERRER_LF.len() as u64);
            assert_eq!(file.hash, content_hash(REFERRER_LF.as_bytes()));
            // "ä\n" is 2 units, then 18 units to the name.
            assert_eq!((file.spans[0].from, file.spans[0].to), (20, 27));
            assert_eq!(splice16(REFERRER_LF, &file.spans), "ä\n<p>ä 😀 <img src=\"new.png\"></p>\n");
        }
    }

    #[test]
    fn an_open_tab_is_listed_once_and_open_tabs_outside_the_root_are_skipped() {
        let dir = project(&[("a.html", b"<img src=\"old.png\">")]);
        let other = tempfile::tempdir().unwrap();
        let tab = OpenText {
            path: path_text(dir.path().join("a.html")),
            text: "<img src=\"old.png\">".to_string(),
        };
        let outside = OpenText {
            path: path_text(other.path().join("b.html")),
            text: "<img src=\"old.png\">".to_string(),
        };
        let plan = find(&dir, "old.png", "new.png", &[tab.clone(), tab, outside], true);
        assert_eq!(plan.files.len(), 1);
        assert!(plan.files[0].open);
    }

    #[test]
    fn an_nfd_file_name_matches_an_nfc_reference_when_folding() {
        let before = "<img src=\"kuvat/päivä.png\"><img src=\"kuvat/pa\u{308}iva\u{308}.png\">\n";
        let wanted = "<img src=\"kuvat/yö.png\"><img src=\"kuvat/yö.png\">\n";
        let dir = project(&[("index.html", before.as_bytes())]);
        let nfd_target = "kuvat/pa\u{308}iva\u{308}.png";
        let plan = find(&dir, nfd_target, "yö.png", &[], true);
        assert_eq!(after(&plan, &dir, "index.html").unwrap(), wanted);
        // Exact matching (Linux) finds only the reference written the same way.
        let plan = find(&dir, nfd_target, "yö.png", &[], false);
        let spans = &entry(&plan, &dir, "index.html").unwrap().spans;
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].old_text, "pa\u{308}iva\u{308}.png");
    }

    #[test]
    fn case_is_ignored_when_folding_and_kept_when_exact() {
        let before = "<img src=\"IMG/Old.PNG\"><img src=\"img/old.png\">\n";
        let dir = project(&[("index.html", before.as_bytes())]);
        let plan = find(&dir, "img/old.png", "New.png", &[], true);
        assert_eq!(
            after(&plan, &dir, "index.html").unwrap(),
            "<img src=\"IMG/New.png\"><img src=\"img/New.png\">\n"
        );
        let plan = find(&dir, "img/old.png", "New.png", &[], false);
        assert_eq!(
            after(&plan, &dir, "index.html").unwrap(),
            "<img src=\"IMG/Old.PNG\"><img src=\"img/New.png\">\n"
        );
    }

    #[test]
    fn a_target_outside_the_root_finds_nothing() {
        let dir = project(&[("index.html", b"<img src=\"../old.png\">")]);
        let other = tempfile::tempdir().unwrap();
        let plan = find_references_with(dir.path(), &other.path().join("old.png"), "new.png", &[], true);
        assert!(plan.files.is_empty());
    }

    #[test]
    fn the_scan_stops_after_two_thousand_files() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..MAX_REF_FILES {
            fs::write(dir.path().join(format!("p{i:04}.html")), "<p>x</p>").unwrap();
        }
        // Read last in name order: the scan stops before it.
        fs::write(dir.path().join("zz.html"), "<img src=\"old.png\">").unwrap();
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert!(plan.capped);
        assert!(plan.files.is_empty());

        // Exactly 2,000 files are all read, and the cap is not reported.
        fs::remove_file(dir.path().join("p0000.html")).unwrap();
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert!(!plan.capped);
        assert_eq!(plan.files.len(), 1);
    }

    #[test]
    fn files_of_other_types_do_not_count_toward_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..MAX_REF_FILES + 5 {
            fs::write(dir.path().join(format!("n{i:04}.txt")), "old.png").unwrap();
        }
        fs::write(dir.path().join("zz.html"), "<img src=\"old.png\">").unwrap();
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert!(!plan.capped);
        assert_eq!(plan.files.len(), 1);
    }

    #[test]
    fn node_modules_and_dot_folders_are_skipped() {
        let page: &[u8] = b"<img src=\"../old.png\">";
        let dir = project(&[
            ("node_modules/a.html", page),
            (".git/a.html", page),
            (".hidden/a.html", page),
            ("sub/a.html", page),
            (".dotfile.html", b"<img src=\"old.png\">"),
        ]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        let paths: Vec<&str> = plan.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [path_text(dir.path().join(".dotfile.html")), path_text(dir.path().join("sub/a.html"))]
        );
    }

    #[test]
    fn the_scan_goes_six_folders_deep() {
        let deep = "1/2/3/4/5/6/a.html";
        let deeper = "1/2/3/4/5/6/7/a.html";
        let dir = project(&[
            (deep, b"<img src=\"/old.png\">"),
            (deeper, b"<img src=\"/old.png\">"),
        ]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert!(entry(&plan, &dir, deep).is_some());
        assert!(entry(&plan, &dir, deeper).is_none());
    }

    #[test]
    fn big_and_binary_files_are_skipped() {
        let mut big = b"<img src=\"old.png\">".to_vec();
        big.resize(MAX_REF_BYTES as usize + 1, b' ');
        let dir = project(&[
            ("big.html", big.as_slice()),
            ("binary.html", b"<img src=\"old.png\">\0"),
            ("bad.html", b"<img src=\"old.png\">\xff"),
            ("ok.html", b"<img src=\"old.png\">"),
        ]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        assert_eq!(plan.files.len(), 1);
        assert!(entry(&plan, &dir, "ok.html").is_some());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_folders_and_files_are_skipped() {
        let dir = project(&[("real/a.html", b"<img src=\"../old.png\">")]);
        std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("link")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("real/a.html"), dir.path().join("b.html")).unwrap();
        let plan = find(&dir, "old.png", "new.png", &[], true);
        let paths: Vec<&str> = plan.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, [path_text(dir.path().join("real/a.html"))]);
    }

    #[test]
    fn a_long_line_is_cut_around_the_place() {
        let line = format!("{}<img src=\"old.png\">{}", "x".repeat(500), "y".repeat(500));
        let dir = project(&[("min.html", line.as_bytes())]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        let span = &entry(&plan, &dir, "min.html").unwrap().spans[0];
        assert_eq!(span.line_text, format!("...{}<img src=\"old.png\">{}...", "x".repeat(110), "y".repeat(118)));
        let units: Vec<u16> = span.line_text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[span.line_from..span.line_to]).unwrap(), "old.png");
        assert_eq!((span.from, span.to), (510, 517));
    }

    #[test]
    fn a_page_that_uses_its_own_name_is_listed() {
        let dir = project(&[("story.html", b"<a href=\"story.html#top\">Top</a>")]);
        let plan = find(&dir, "story.html", "tale.html", &[], true);
        assert_eq!(after(&plan, &dir, "story.html").unwrap(), "<a href=\"tale.html#top\">Top</a>");
    }

    #[test]
    fn lines_count_lf_crlf_and_lone_cr() {
        let dir = project(&[("a.html", b"one\rtwo\r\nthree\n<img src=\"old.png\">\r\n")]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        let span = &entry(&plan, &dir, "a.html").unwrap().spans[0];
        assert_eq!(span.line, 4);
        assert_eq!(span.line_text, "<img src=\"old.png\">");
    }

    #[test]
    fn the_plan_serializes_in_camel_case() {
        let dir = project(&[("a.html", b"<img src=\"old.png\">")]);
        let plan = find(&dir, "old.png", "new.png", &[], true);
        let json = serde_json::to_value(&plan).unwrap();
        let file = &json["files"][0];
        assert_eq!(json["capped"], false);
        assert_eq!(file["open"], false);
        assert_eq!(file["size"], 19);
        assert!(file["hash"].as_str().unwrap().len() == 16);
        let span = &file["spans"][0];
        for k in ["line", "from", "to", "oldText", "newText", "lineText", "lineFrom", "lineTo"] {
            assert!(span.get(k).is_some(), "{k}");
        }
        let open: Vec<OpenText> = serde_json::from_str(r#"[{"path":"/x/a.html","text":"hi"}]"#).unwrap();
        assert_eq!(open[0].text, "hi");
    }

    // ---------- pages_using (WP3) ----------

    fn listed(dir: &TempDir, names: &[&str]) -> Vec<String> {
        names.iter().map(|n| path_text(dir.path().join(n))).collect()
    }

    #[test]
    fn pages_using_lists_only_the_pages_that_use_the_file() {
        for fold in both() {
            let dir = project(&[
                ("game.js", b"let x = 1;"),
                ("zoo.html", b"<script src=\"game.js\"></script>"),
                ("about.html", b"<script src=\"./game.js?v=2\"></script>"),
                ("index.html", b"<script src='game.js'></script>"),
                ("plain.html", b"<p>game.js is a script, but this is prose.</p>"),
                ("other.html", b"<script src=\"other.js\"></script>"),
                ("sub/deep.html", b"<script src=\"../game.js\"></script>"),
                ("style.css", b"@import 'game.js';"),
                ("notes.md", b"[game](game.js)"),
            ]);
            let got = pages_using_with(&dir.path().join("game.js"), fold, 500, 50);
            assert_eq!(got, listed(&dir, &["index.html", "about.html", "zoo.html"]), "fold {fold}");
        }
    }

    #[test]
    fn pages_using_puts_index_first_then_names() {
        let dir = project(&[
            ("data.json", b"{}"),
            ("b.html", b"<a href=\"data.json\">x</a>"),
            ("A.html", b"<a href=\"data.json\">x</a>"),
            ("index.html", b"<a href=\"data.json\">x</a>"),
            ("c.htm", b"<a href=\"data.json\">x</a>"),
        ]);
        let got = pages_using_with(&dir.path().join("data.json"), false, 500, 50);
        assert_eq!(got, listed(&dir, &["index.html", "A.html", "b.html", "c.htm"]));
    }

    #[test]
    fn pages_using_reads_at_most_50_pages() {
        let mut files: Vec<(String, Vec<u8>)> = vec![("app.js".to_string(), b"1".to_vec())];
        for i in 0..60 {
            files.push((format!("p{i:02}.html"), b"<script src=\"app.js\"></script>".to_vec()));
        }
        let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        let dir = project(&refs);
        let got = pages_using_with(&dir.path().join("app.js"), false, 500, 50);
        assert_eq!(got.len(), 50);
        assert_eq!(got[0], path_text(dir.path().join("p00.html")));
        assert_eq!(got[49], path_text(dir.path().join("p49.html")));
        // The real caps are the ones the brief names.
        assert_eq!((MAX_SIDE_ENTRIES, MAX_SIDE_PAGES), (500, 50));
        assert_eq!(pages_using(&dir.path().join("app.js")).len(), 50);
    }

    #[test]
    fn pages_using_reads_at_most_500_entries_of_the_folder() {
        let mut files: Vec<(String, Vec<u8>)> = vec![("app.js".to_string(), b"1".to_vec())];
        for i in 0..600 {
            files.push((format!("p{i:03}.html"), b"<script src=\"app.js\"></script>".to_vec()));
        }
        let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        let dir = project(&refs);
        let file = dir.path().join("app.js");
        // 601 entries, every one but app.js a page that uses it, and no page cap: the whole
        // folder finds 600, the 500-entry cap 499 or 500 (app.js itself may be one of the 500).
        assert_eq!(pages_using_with(&file, false, 10_000, 10_000).len(), 600);
        let capped = pages_using_with(&file, false, MAX_SIDE_ENTRIES, 10_000).len();
        assert!((499..=500).contains(&capped), "{capped}");
        assert!(pages_using_with(&file, false, 0, 10_000).is_empty());
    }

    #[test]
    fn pages_using_refuses_web_files_folders_and_missing_files() {
        let dir = project(&[
            ("index.html", b"<link href=\"style.css\" rel=\"stylesheet\"><a href=\"other.html\">x</a><a href=\"gone.js\">x</a><a href=\"sub\">x</a>"),
            ("style.css", b"p {}"),
            ("other.html", b"<p>x</p>"),
            ("sub/a.txt", b"x"),
        ]);
        for name in ["style.css", "other.html", "gone.js", "sub"] {
            assert!(pages_using_with(&dir.path().join(name), false, 500, 50).is_empty(), "{name}");
        }
    }

    #[test]
    fn pages_using_matches_case_only_where_names_fold() {
        let dir = project(&[
            ("Game.js", b"1"),
            ("index.html", b"<script src=\"game.js\"></script>"),
        ]);
        let file = dir.path().join("Game.js");
        assert_eq!(pages_using_with(&file, true, 500, 50), listed(&dir, &["index.html"]));
        assert!(pages_using_with(&file, false, 500, 50).is_empty());
    }
}
