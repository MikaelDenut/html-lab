use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use htmllab_core::{content, files, kinds};
use percent_encoding::percent_decode_str;
use tauri::http::{header, Response, StatusCode};

const HELPER: &str = include_str!("../helper.min.js");
include!(concat!(env!("OUT_DIR"), "/fonts.rs"));
const NOT_A_PAGE_CSP: &str =
    "default-src 'none'; img-src preview: data:; style-src preview: 'unsafe-inline'; font-src preview: data:";

#[derive(Default)]
pub struct Store {
    pub buffers: RwLock<HashMap<String, String>>,
    pub pictures: RwLock<HashMap<String, &'static [u8]>>,
    pub roots: RwLock<HashSet<PathBuf>>,
}

impl Store {
    pub fn add_root(&self, folder: &str) {
        let path = dunce::canonicalize(folder).unwrap_or_else(|_| PathBuf::from(folder));
        self.roots.write().unwrap().insert(path);
    }

    pub fn remove_root(&self, folder: &str) {
        let path = dunce::canonicalize(folder).unwrap_or_else(|_| PathBuf::from(folder));
        self.roots.write().unwrap().remove(&path);
    }

    pub fn inside_root(&self, path: &Path) -> bool {
        let Ok(real) = dunce::canonicalize(path) else {
            return false;
        };
        self.roots
            .read()
            .unwrap()
            .iter()
            .any(|root| real.starts_with(root))
    }
}

pub fn respond(store: &Store, raw_path: &str, nonce: &str) -> Response<Vec<u8>> {
    let decoded = percent_decode_str(raw_path)
        .decode_utf8_lossy()
        .into_owned();
    let rel = decoded.trim_start_matches('/');
    let name = rel.rsplit('/').next().unwrap_or("").to_string();

    if rel.split('/').any(|seg| seg == "..") {
        return missing(&name, nonce);
    }

    if let Some(file) = rel.strip_prefix("__fonts/") {
        return match FONTS.iter().find(|(known, _)| *known == file) {
            Some((_, bytes)) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "font/woff2")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(bytes.to_vec())
                .unwrap(),
            None => empty_404(),
        };
    }

    if let Some(rest) = rel.strip_prefix("__help/") {
        let mut parts = rest.splitn(2, '/');
        let (topic, file) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        return match content::help_bytes(topic, file) {
            Some(bytes) => serve(bytes, &name, nonce, false),
            None => empty_404(),
        };
    }

    let is_new = rel.starts_with("__new/");
    let key = if is_new || cfg!(windows) {
        rel.to_string()
    } else {
        format!("/{rel}")
    };

    let buffer = store.buffers.read().unwrap().get(&key).cloned();
    if let Some(text) = buffer {
        return serve_text(text, &name, nonce);
    }
    let picture = store.pictures.read().unwrap().get(&key).copied();
    if let Some(bytes) = picture {
        return serve(bytes.to_vec(), &name, nonce, false);
    }
    if is_new {
        return missing(&name, nonce);
    }

    let path = PathBuf::from(&key);
    if !store.inside_root(&path) {
        return missing(&name, nonce);
    }
    match std::fs::read(&path) {
        Ok(bytes) => serve_disk(bytes, &name, nonce),
        Err(_) => missing(&name, nonce),
    }
}

// Text from disk goes through the reader's decoder, so a UTF-16 file reaches the page as
// UTF-8 without its BOM. Pictures and fonts stay raw, and so does anything that is not text.
fn serve_disk(bytes: Vec<u8>, name: &str, nonce: &str) -> Response<Vec<u8>> {
    let mime = kinds::mime_for(name);
    if kinds::is_picture(name) || mime.starts_with("image/") || mime.starts_with("font/") {
        return serve(bytes, name, nonce, true);
    }
    match files::decode_text(&bytes) {
        Ok(decoded) => serve_text(decoded.text, name, nonce),
        Err(_) => serve(bytes, name, nonce, true),
    }
}

fn serve_text(text: String, name: &str, nonce: &str) -> Response<Vec<u8>> {
    let mut res = serve(text.into_bytes(), name, nonce, true);
    let mime = kinds::mime_for(name);
    let textual = mime.starts_with("text/") || mime.ends_with("/json") || mime.ends_with("/xml");
    if textual && !mime.contains("charset") {
        let typed = format!("{mime}; charset=utf-8");
        res.headers_mut()
            .insert(header::CONTENT_TYPE, typed.parse().unwrap());
    }
    res
}

fn serve(bytes: Vec<u8>, name: &str, nonce: &str, with_helper: bool) -> Response<Vec<u8>> {
    let is_page = kinds::kind_for_name(name)
        .map(|k| k.is_page)
        .unwrap_or(false);
    let mut body = bytes;
    if is_page && with_helper {
        body = inject_helper(&body, nonce);
    }
    if is_page && !FONT_STYLE.is_empty() {
        body = inject_fonts(&body);
    }
    let mut res = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, kinds::mime_for(name))
        .header(header::CACHE_CONTROL, "no-store");
    let csp = if is_page {
        kinds::csp_for(kinds::SCRIPT_POLICY, nonce)
    } else {
        NOT_A_PAGE_CSP.to_string()
    };
    let csp = if cfg!(windows) {
        csp.replace("preview:", "http://preview.localhost")
    } else {
        csp
    };
    res = res.header(header::CONTENT_SECURITY_POLICY, csp);
    res.body(body).unwrap()
}

fn missing(name: &str, nonce: &str) -> Response<Vec<u8>> {
    let is_page = kinds::kind_for_name(name)
        .map(|k| k.is_page)
        .unwrap_or(false);
    if !is_page {
        return empty_404();
    }
    let page = format!(
        "<!doctype html>\n<html><head><title>Not found</title></head><body style=\"font-family: -apple-system, Helvetica, Arial; color: #14233C; padding: 24px; line-height: 1.5;\"><h1 style=\"font-size: 22px; margin: 0 0 8px;\">This page does not exist yet.</h1><p style=\"margin: 0;\">Check the file name in your link: {}</p></body></html>\n",
        escape_html(name)
    );
    let mut res = serve(page.into_bytes(), name, nonce, true);
    *res.status_mut() = StatusCode::NOT_FOUND;
    res
}

fn empty_404() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap()
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn inject_helper(html: &[u8], nonce: &str) -> Vec<u8> {
    let at = insert_position(html);
    let tag = format!("<script nonce=\"{nonce}\">{HELPER}</script>");
    let mut out = Vec::with_capacity(html.len() + tag.len());
    out.extend_from_slice(&html[..at]);
    out.extend_from_slice(tag.as_bytes());
    out.extend_from_slice(&html[at..]);
    out
}

fn inject_fonts(html: &[u8]) -> Vec<u8> {
    let at = insert_position(html);
    let mut out = Vec::with_capacity(html.len() + FONT_STYLE.len());
    out.extend_from_slice(&html[..at]);
    out.extend_from_slice(FONT_STYLE.as_bytes());
    out.extend_from_slice(&html[at..]);
    out
}

pub fn insert_position(html: &[u8]) -> usize {
    const BOM: &[u8] = b"\xEF\xBB\xBF";
    let start = if html.starts_with(BOM) { BOM.len() } else { 0 };
    let mut i = start;
    loop {
        while i < html.len() && html[i].is_ascii_whitespace() {
            i += 1;
        }
        if html[i..].starts_with(b"<!--") {
            match find(&html[i..], b"-->") {
                Some(end) => i += end + 3,
                None => return start,
            }
            continue;
        }
        break;
    }
    const DOCTYPE: &[u8] = b"<!doctype";
    if html.len() >= i + DOCTYPE.len() && html[i..i + DOCTYPE.len()].eq_ignore_ascii_case(DOCTYPE) {
        return match html[i..].iter().position(|&b| b == b'>') {
            Some(end) => i + end + 1,
            None => start,
        };
    }
    start
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_byte_order_mark_stays_first() {
        let page = b"\xEF\xBB\xBF<!doctype html>\n<p>x</p>";
        assert_eq!(insert_position(page), 18);
        assert_eq!(insert_position(b"\xEF\xBB\xBF<p>x</p>"), 3);
        let out = inject_helper(page, "n");
        assert!(out.starts_with(b"\xEF\xBB\xBF<!doctype html><script"));
    }

    #[test]
    fn a_picture_shown_as_a_page_runs_no_script() {
        let store = Store::default();
        store.buffers.write().unwrap().insert(
            "__new/p1/star.svg".into(),
            "<svg><script>x()</script></svg>".into(),
        );
        let res = respond(&store, "/__new/p1/star.svg", "n");
        let csp = res.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.starts_with("default-src 'none'"), "{csp}");
        assert!(!csp.contains("script-src"), "{csp}");
    }

    #[test]
    fn helper_goes_after_the_doctype() {
        assert_eq!(insert_position(b"<!doctype html>\n<html>"), 15);
        assert_eq!(insert_position(b"  <!DOCTYPE html><p>"), 17);
        assert_eq!(insert_position(b"<!-- hi --><!doctype html><p>"), 26);
    }

    #[test]
    fn helper_goes_first_with_no_doctype() {
        assert_eq!(insert_position(b"<h1>Hi</h1>"), 0);
        assert_eq!(insert_position(b""), 0);
        assert_eq!(insert_position(b"<!-- never closes <p>"), 0);
        assert_eq!(insert_position(b"<!doctype"), 0);
    }

    #[test]
    fn injected_page_starts_with_the_doctype() {
        let out = inject_helper(b"<!doctype html><p>", "abc");
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("<!doctype html><script nonce=\"abc\">"));
        assert!(text.ends_with("</script><p>"));
    }

    #[test]
    fn roots_keep_files_inside() {
        let dir = std::env::temp_dir().join(format!("htmllab-root-{}", std::process::id()));
        let sub = dir.join("proj");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.html"), "<p>in</p>").unwrap();
        std::fs::write(dir.join("secret.html"), "<p>out</p>").unwrap();

        let store = Store::default();
        store.add_root(sub.to_str().unwrap());
        assert!(store.inside_root(&sub.join("a.html")));
        assert!(!store.inside_root(&dir.join("secret.html")));
        assert!(!store.inside_root(&sub.join("..").join("secret.html")));

        let inside = format!(
            "/{}",
            sub.join("a.html").to_str().unwrap().trim_start_matches('/')
        );
        let res = respond(&store, &inside, "n");
        assert_eq!(res.status(), StatusCode::OK);
        assert!(String::from_utf8_lossy(res.body()).contains("<p>in</p>"));

        let outside = format!(
            "/{}",
            dir.join("secret.html")
                .to_str()
                .unwrap()
                .trim_start_matches('/')
        );
        let res = respond(&store, &outside, "n");
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert!(!String::from_utf8_lossy(res.body()).contains("<p>out</p>"));

        store.remove_root(sub.to_str().unwrap());
        assert!(!store.inside_root(&sub.join("a.html")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn buffers_win_and_encoded_paths_decode() {
        let store = Store::default();
        store
            .buffers
            .write()
            .unwrap()
            .insert("__new/p1/my page ä.html".into(), "<p>hi</p>".into());
        let res = respond(&store, "/__new/p1/my%20page%20%C3%A4.html", "n");
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            res.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        assert!(res.headers().get(header::CONTENT_SECURITY_POLICY).is_some());
        assert!(String::from_utf8_lossy(res.body()).contains("<script nonce=\"n\">"));
    }

    #[test]
    fn missing_page_is_friendly_and_other_files_are_empty() {
        let store = Store::default();
        let res = respond(&store, "/__new/p1/planets.html", "n");
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        let body = String::from_utf8_lossy(res.body()).into_owned();
        assert!(body.contains("This page does not exist yet."));
        assert!(body.contains("planets.html"));
        assert!(body.contains("<script nonce=\"n\">"));

        let res = respond(&store, "/__new/p1/cat.png", "n");
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert!(res.body().is_empty());
    }

    #[test]
    fn built_in_pictures_serve_as_jpeg_for_new_projects_and_help() {
        let store = Store::default();
        store.pictures.write().unwrap().insert(
            "__new/p1/sun.jpg".into(),
            content::picture("sun.jpg").unwrap(),
        );
        let res = respond(&store, "/__new/p1/sun.jpg", "n");
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(res.body().as_slice(), content::picture("sun.jpg").unwrap());
        let res = respond(&store, "/__help/pictures/saturn.jpg", "n");
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.body().as_slice(),
            content::picture("saturn.jpg").unwrap()
        );
    }

    fn temp_root(name: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("htmllab-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dunce::canonicalize(&dir).unwrap();
        let store = Store::default();
        store.add_root(dir.to_str().unwrap());
        (store, dir)
    }

    fn served(store: &Store, path: &Path) -> Response<Vec<u8>> {
        let raw = format!("/{}", path.to_str().unwrap().trim_start_matches('/'));
        respond(store, &raw, "n")
    }

    #[test]
    fn a_utf16_page_on_disk_is_served_as_utf8_with_the_helper() {
        let (store, dir) = temp_root("utf16-page");
        let page = dir.join("page.html");
        // "<!doctype html>\n<p>ä</p>" in UTF-16 LE with its BOM, written out by hand.
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for c in b"<!doctype html>\n<p>" {
            bytes.extend_from_slice(&[*c, 0x00]);
        }
        bytes.extend_from_slice(&[0xE4, 0x00]);
        for c in b"</p>" {
            bytes.extend_from_slice(&[*c, 0x00]);
        }
        std::fs::write(&page, &bytes).unwrap();

        let res = served(&store, &page);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        let body = res.body();
        assert!(body.starts_with(b"<!doctype html><script nonce=\"n\">"));
        assert!(!body.contains(&0));
        let tail = b"\n<p>\xC3\xA4</p>";
        assert!(body.ends_with(tail), "{}", String::from_utf8_lossy(body));
        let text = String::from_utf8(body.clone()).unwrap();
        assert!(text.contains("<script nonce=\"n\">"));
        assert!(text.contains("<p>\u{e4}</p>"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn disk_text_loses_its_bom_and_pictures_stay_raw() {
        let (store, dir) = temp_root("disk-kinds");
        std::fs::write(dir.join("style.css"), b"\xEF\xBB\xBFp { color: red; }").unwrap();
        std::fs::write(dir.join("notes.txt"), b"\xFE\xFF\x00h\x00i").unwrap();
        std::fs::write(dir.join("data.json"), b"{\"a\": 1}").unwrap();
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR";
        std::fs::write(dir.join("cat.png"), png).unwrap();
        let svg = b"\xEF\xBB\xBF<svg/>";
        std::fs::write(dir.join("star.svg"), svg).unwrap();
        let font = b"wOF2\x00\x01";
        std::fs::write(dir.join("a.woff2"), font).unwrap();
        std::fs::write(dir.join("odd.css"), b"p\xFF").unwrap();

        let res = served(&store, &dir.join("style.css"));
        assert_eq!(res.body().as_slice(), b"p { color: red; }");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/css; charset=utf-8");
        let res = served(&store, &dir.join("notes.txt"));
        assert_eq!(res.body().as_slice(), b"hi");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/plain; charset=utf-8");
        assert!(!res.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("script-src"));
        let res = served(&store, &dir.join("data.json"));
        assert_eq!(res.headers()[header::CONTENT_TYPE], "application/json; charset=utf-8");
        let res = served(&store, &dir.join("cat.png"));
        assert_eq!(res.body().as_slice(), png);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
        let res = served(&store, &dir.join("star.svg"));
        assert_eq!(res.body().as_slice(), svg);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/svg+xml");
        let res = served(&store, &dir.join("a.woff2"));
        assert_eq!(res.body().as_slice(), font);
        let res = served(&store, &dir.join("odd.css"));
        assert_eq!(res.body().as_slice(), b"p\xFF");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn dot_dot_never_leaves() {
        let store = Store::default();
        store
            .buffers
            .write()
            .unwrap()
            .insert("__new/p1/a.html".into(), "x".into());
        let res = respond(&store, "/__new/p2/../p1/a.html", "n");
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}
