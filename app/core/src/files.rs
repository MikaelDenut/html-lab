use crate::counts;
use crate::names::clean_project_name;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
#[cfg(unix)]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;
const MAX_COPY_FILES: usize = 500;
const MAX_COPY_BYTES: u64 = 500 * 1024 * 1024;

const NOT_TEXT: &str = "not_text";
const OTHER_ENCODING: &str = "other_encoding";
const TOO_BIG: &str = "too_big";
const CANNOT_READ: &str = "cannot_read";
const FILE_EXISTS: &str = "file_exists";
const FOLDER_GONE: &str = "folder_gone";
const FOLDER_EXISTS: &str = "folder_exists";
const CANNOT_WRITE: &str = "cannot_write";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Utf16le,
    Utf16be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Indent {
    pub tabs: bool,
    pub width: u8,
}

// How a file is written, so a save gives back the same bytes (C43).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub bom: bool,
    pub encoding: Encoding,
    pub eol: Eol,
    pub mixed_eol: bool,
    pub final_newline: bool,
    pub indent: Indent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub path: String,
    pub name: String,
    pub text: Option<String>,
    pub error: Option<String>,
    pub style: Option<TextStyle>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFile {
    pub path: String,
    pub text: String,
    #[serde(default)]
    pub must_not_exist: bool,
    #[serde(default)]
    pub bom: bool,
    #[serde(default)]
    pub encoding: String,
    #[serde(default)]
    pub eol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedFile {
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub picture: bool,
    #[serde(default)]
    pub bom: bool,
    #[serde(default)]
    pub encoding: String,
    #[serde(default)]
    pub eol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProject {
    pub folder: String,
    pub paths: Vec<String>,
}

pub fn path_text(path: impl AsRef<Path>) -> String {
    let text = path.as_ref().to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

pub fn read_files(paths: &[String]) -> Vec<ReadResult> {
    paths.iter().map(|path| read_one(path)).collect()
}

fn read_one(given: &str) -> ReadResult {
    let found = dunce::canonicalize(given);
    let path = found.as_deref().unwrap_or(Path::new(given));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let read = match &found {
        Ok(real) => read_decoded(real),
        Err(_) => Err(CANNOT_READ),
    };
    let (text, error, style) = match read {
        Ok(decoded) => {
            let teaching = crate::kinds::kind_for_name(&name).is_some();
            let style = detect_style(&decoded.text, decoded.bom, decoded.encoding, teaching);
            (Some(decoded.text), None, Some(style))
        }
        Err(code) => (None, Some(code.to_string()), None),
    };
    ReadResult {
        path: path_text(path),
        name,
        text,
        error,
        style,
    }
}

pub(crate) fn read_text(path: &Path) -> Result<String, &'static str> {
    read_decoded(path).map(|decoded| decoded.text)
}

fn read_decoded(path: &Path) -> Result<Decoded, &'static str> {
    let meta = fs::metadata(path).map_err(|_| CANNOT_READ)?;
    if !meta.is_file() {
        return Err(CANNOT_READ);
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(TOO_BIG);
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    File::open(path)
        .and_then(|file| file.take(MAX_READ_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| CANNOT_READ)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(TOO_BIG);
    }
    decode_text(&bytes)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub text: String,
    pub bom: bool,
    pub encoding: Encoding,
}

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
const UTF16LE_BOM: &[u8] = b"\xFF\xFE";
const UTF16BE_BOM: &[u8] = b"\xFE\xFF";

// The one decoder for reading files and for serving them to the preview (C10).
// UTF-16 is known only by its BOM, and that is checked before the NUL test.
pub fn decode_text(bytes: &[u8]) -> Result<Decoded, &'static str> {
    let utf16 = if let Some(rest) = bytes.strip_prefix(UTF16LE_BOM) {
        Some((rest, Encoding::Utf16le))
    } else {
        bytes.strip_prefix(UTF16BE_BOM).map(|rest| (rest, Encoding::Utf16be))
    };
    if let Some((rest, encoding)) = utf16 {
        let unit = |pair: &[u8]| match encoding {
            Encoding::Utf16be => u16::from_be_bytes([pair[0], pair[1]]),
            _ => u16::from_le_bytes([pair[0], pair[1]]),
        };
        let units: Vec<u16> = rest.chunks_exact(2).map(unit).collect();
        // A zero unit is always U+0000; this is also how a UTF-32 file shows itself.
        if units.contains(&0) {
            return Err(NOT_TEXT);
        }
        if rest.len() % 2 != 0 {
            return Err(OTHER_ENCODING);
        }
        let text = String::from_utf16(&units).map_err(|_| OTHER_ENCODING)?;
        return Ok(Decoded {
            text,
            bom: true,
            encoding,
        });
    }
    if bytes.contains(&0) {
        return Err(NOT_TEXT);
    }
    let (rest, bom) = match bytes.strip_prefix(UTF8_BOM) {
        Some(rest) => (rest, true),
        None => (bytes, false),
    };
    let text = std::str::from_utf8(rest).map_err(|_| OTHER_ENCODING)?;
    Ok(Decoded {
        text: text.to_string(),
        bom,
        encoding: Encoding::Utf8,
    })
}

// A pure look at the text: the most-used line ending, the final newline and the indent.
pub fn detect_style(text: &str, bom: bool, encoding: Encoding, teaching: bool) -> TextStyle {
    let bytes = text.as_bytes();
    let (mut lf, mut crlf, mut cr) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    let eol = if lf >= crlf && lf >= cr {
        Eol::Lf
    } else if crlf >= cr {
        Eol::Crlf
    } else {
        Eol::Cr
    };
    let kinds_used = [lf, crlf, cr].iter().filter(|n| **n > 0).count();
    TextStyle {
        bom,
        encoding,
        eol,
        mixed_eol: kinds_used > 1,
        final_newline: text.ends_with(['\n', '\r']),
        indent: detect_indent(text, teaching),
    }
}

const MIN_INDENT: usize = 2;
const MAX_INDENT: usize = 8;

fn detect_indent(text: &str, teaching: bool) -> Indent {
    let default_width: u8 = if teaching { 2 } else { 4 };
    let (mut tab_lines, mut space_lines) = (0usize, 0usize);
    let mut steps = [0usize; MAX_INDENT + 1];
    let mut previous = 0usize;
    for line in text.split(['\n', '\r']) {
        if line.trim().is_empty() {
            continue;
        }
        let spaces = line.len() - line.trim_start_matches(' ').len();
        if line.starts_with('\t') {
            tab_lines += 1;
        } else if spaces > 0 {
            space_lines += 1;
        }
        if line.starts_with('\t') {
            continue;
        }
        let step = spaces.abs_diff(previous);
        if (MIN_INDENT..=MAX_INDENT).contains(&step) {
            steps[step] += 1;
        }
        previous = spaces;
    }
    if tab_lines > space_lines {
        return Indent {
            tabs: true,
            width: default_width,
        };
    }
    // The most common step between lines; a tie goes to the smaller step.
    let mut best: Option<(usize, usize)> = None;
    for (width, count) in steps.iter().enumerate() {
        if *count > 0 && best.is_none_or(|(_, most)| *count > most) {
            best = Some((width, *count));
        }
    }
    Indent {
        tabs: false,
        width: best.map_or(default_width, |(width, _)| width as u8),
    }
}

// The one encoder for every save path (C43): LF becomes the file's own line ending,
// then the text is encoded and its BOM goes first. An unknown value writes nothing.
pub fn encode_text(text: &str, bom: bool, encoding: &str, eol: &str) -> Result<Vec<u8>, &'static str> {
    let encoding = match encoding {
        "" | "utf8" => Encoding::Utf8,
        "utf16le" => Encoding::Utf16le,
        "utf16be" => Encoding::Utf16be,
        _ => return Err(CANNOT_WRITE),
    };
    let eol = match eol {
        "" | "lf" => Eol::Lf,
        "crlf" => Eol::Crlf,
        "cr" => Eol::Cr,
        _ => return Err(CANNOT_WRITE),
    };
    let ending = match eol {
        Eol::Lf => "\n",
        Eol::Crlf => "\r\n",
        Eol::Cr => "\r",
    };
    let mut lined = String::with_capacity(text.len() + text.len() / 16);
    let mut previous = '\0';
    for c in text.chars() {
        if c == '\n' {
            // A text that already has CRLF keeps one line break per line.
            if previous == '\r' && eol != Eol::Lf {
                lined.pop();
            }
            lined.push_str(ending);
        } else {
            lined.push(c);
        }
        previous = c;
    }
    let mut out = Vec::with_capacity(lined.len() + 3);
    match encoding {
        Encoding::Utf8 => {
            if bom {
                out.extend_from_slice(UTF8_BOM);
            }
            out.extend_from_slice(lined.as_bytes());
        }
        // UTF-16 is only read with its BOM, so it is always written with it.
        Encoding::Utf16le => {
            out.extend_from_slice(UTF16LE_BOM);
            lined.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_le_bytes()));
        }
        Encoding::Utf16be => {
            out.extend_from_slice(UTF16BE_BOM);
            lined.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_be_bytes()));
        }
    }
    Ok(out)
}

pub fn atomic_write(path: &Path, bytes: &[u8], must_not_exist: bool) -> Result<(), String> {
    let folder = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let Some(name) = path.file_name() else {
        return Err(CANNOT_WRITE.to_string());
    };
    if !folder.is_dir() {
        return Err(FOLDER_GONE.to_string());
    }
    if must_not_exist && path.symlink_metadata().is_ok() {
        return Err(FILE_EXISTS.to_string());
    }

    let mut temp_name = OsString::from(".");
    temp_name.push(name);
    temp_name.push(".htmllab-tmp");
    let temp = folder.join(temp_name);

    write_with_retry(path, &temp, bytes, must_not_exist, folder).map_err(|code| {
        let _ = fs::remove_file(&temp);
        if code == CANNOT_WRITE && !folder.is_dir() {
            FOLDER_GONE.to_string()
        } else {
            code.to_string()
        }
    })
}

// On Windows a virus scanner or the search indexer can hold a file it just saw written for a
// moment, so a replace fails once and works a little later. Retry for about 1.5 s before saying
// the file could not be written. A file that really cannot be written still fails, only later.
#[cfg(windows)]
const WRITE_RETRIES: u64 = 8;
#[cfg(not(windows))]
const WRITE_RETRIES: u64 = 0;

fn write_with_retry(
    path: &Path,
    temp: &Path,
    bytes: &[u8],
    must_not_exist: bool,
    folder: &Path,
) -> Result<(), &'static str> {
    let mut attempt = 0;
    loop {
        match write_and_publish(path, temp, bytes, must_not_exist) {
            Err(CANNOT_WRITE) if attempt < WRITE_RETRIES && folder.is_dir() => {
                let _ = fs::remove_file(temp);
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(40 * attempt));
            }
            other => return other,
        }
    }
}

fn write_and_publish(
    path: &Path,
    temp: &Path,
    bytes: &[u8],
    must_not_exist: bool,
) -> Result<(), &'static str> {
    let _ = fs::remove_file(temp);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(|_| CANNOT_WRITE)?;
    file.write_all(bytes).map_err(|_| CANNOT_WRITE)?;
    sync_with_fallback(&file, File::sync_all).map_err(|_| CANNOT_WRITE)?;
    drop(file);

    if must_not_exist {
        return publish_no_clobber(temp, path);
    }
    if let Ok(old) = fs::metadata(path) {
        let _ = fs::set_permissions(temp, old.permissions());
    }
    fs::rename(temp, path).map_err(|_| CANNOT_WRITE)
}

fn sync_with_fallback(file: &File, full_sync: impl Fn(&File) -> io::Result<()>) -> io::Result<()> {
    #[cfg(not(unix))]
    return full_sync(file);
    #[cfg(unix)]
    match full_sync(file) {
        Err(error)
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOTSUP | libc::EINVAL | libc::ENOTTY)
            ) =>
        {
            if unsafe { libc::fsync(file.as_raw_fd()) } == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
        other => other,
    }
}

fn publish_no_clobber(temp: &Path, target: &Path) -> Result<(), &'static str> {
    match fs::hard_link(temp, target) {
        Ok(()) => {
            let _ = fs::remove_file(temp);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(FILE_EXISTS),
        Err(_) => {
            if target.symlink_metadata().is_ok() {
                return Err(FILE_EXISTS);
            }
            fs::rename(temp, target).map_err(|_| CANNOT_WRITE)
        }
    }
}

pub fn write_files(files: &[WriteFile]) -> Vec<WriteResult> {
    files
        .iter()
        .map(|file| {
            let written = encode_text(&file.text, file.bom, &file.encoding, &file.eol)
                .map_err(str::to_string)
                .and_then(|bytes| {
                    atomic_write(Path::new(&file.path), &bytes, file.must_not_exist)
                });
            WriteResult {
                path: file.path.clone(),
                ok: written.is_ok(),
                error: written.err(),
            }
        })
        .collect()
}

#[derive(Default)]
struct Created {
    dirs: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

impl Created {
    fn remove(&self) {
        for file in self.files.iter().rev() {
            let _ = fs::remove_file(file);
        }
        for dir in self.dirs.iter().rev() {
            let _ = fs::remove_file(dir.join(".DS_Store"));
            let _ = fs::remove_dir(dir);
        }
    }
}

fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && name != "."
        && name != ".."
        && (!cfg!(windows) || (!name.contains('\\') && !crate::names::windows_reserved(name)))
}

fn create_folder_error(error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::AlreadyExists {
        FOLDER_EXISTS.to_string()
    } else {
        CANNOT_WRITE.to_string()
    }
}

fn write_named_files(
    folder: &Path,
    files: &[NamedFile],
    must_not_exist: bool,
    created: &mut Created,
) -> Result<Vec<String>, ()> {
    let mut paths = Vec::with_capacity(files.len());
    for file in files {
        if !is_plain_name(&file.name) {
            return Err(());
        }
        let path = folder.join(&file.name);
        let bytes = if file.picture {
            crate::content::picture(&file.name).ok_or(())?.to_vec()
        } else {
            encode_text(&file.text, file.bom, &file.encoding, &file.eol).map_err(|_| ())?
        };
        atomic_write(&path, &bytes, must_not_exist).map_err(|_| ())?;
        paths.push(path_text(&path));
        created.files.push(path);
    }
    Ok(paths)
}

pub fn save_project(parent: &str, name: &str, files: &[NamedFile]) -> Result<SavedProject, String> {
    let name = clean_project_name(name);
    if name.is_empty() {
        return Err(CANNOT_WRITE.to_string());
    }
    let given = Path::new(parent).join(&name);
    fs::create_dir(&given).map_err(|error| create_folder_error(&error))?;
    let folder = dunce::canonicalize(&given).unwrap_or(given);

    let mut created = Created::default();
    created.dirs.push(folder.clone());
    match write_named_files(&folder, files, true, &mut created) {
        Ok(paths) => Ok(SavedProject {
            folder: path_text(&folder),
            paths,
        }),
        Err(()) => {
            created.remove();
            Err(CANNOT_WRITE.to_string())
        }
    }
}

#[derive(Debug, Default)]
struct CopyPlan {
    dirs: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

fn plan_copy(folder: &Path) -> Result<CopyPlan, &'static str> {
    let mut plan = CopyPlan::default();
    let mut total_bytes = 0u64;
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let entries = fs::read_dir(folder.join(&relative)).map_err(|_| CANNOT_WRITE)?;
        let mut entries = entries
            .collect::<io::Result<Vec<_>>>()
            .map_err(|_| CANNOT_WRITE)?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            let child = relative.join(&name);
            let kind = entry.file_type().map_err(|_| CANNOT_WRITE)?;
            if kind.is_dir() {
                plan.dirs.push(child.clone());
                pending.push(child);
            } else if kind.is_file() {
                total_bytes += entry.metadata().map_err(|_| CANNOT_WRITE)?.len();
                plan.files.push(child);
                if plan.files.len() > MAX_COPY_FILES || total_bytes > MAX_COPY_BYTES {
                    return Err(TOO_BIG);
                }
            }
        }
    }
    Ok(plan)
}

fn copy_planned(old: &Path, new: &Path, plan: &CopyPlan, created: &mut Created) -> Result<(), ()> {
    for dir in &plan.dirs {
        let target = new.join(dir);
        fs::create_dir(&target).map_err(|_| ())?;
        created.dirs.push(target);
    }
    for file in &plan.files {
        let target = new.join(file);
        created.files.push(target.clone());
        fs::copy(old.join(file), &target).map_err(|_| ())?;
    }
    Ok(())
}

pub fn save_copy(
    folder: &str,
    parent: &str,
    name: &str,
    files: &[NamedFile],
) -> Result<SavedProject, String> {
    let cannot_write = |_| CANNOT_WRITE.to_string();
    let name = clean_project_name(name);
    if name.is_empty() {
        return Err(CANNOT_WRITE.to_string());
    }
    let old = dunce::canonicalize(folder).map_err(cannot_write)?;
    let place = dunce::canonicalize(parent).map_err(cannot_write)?;
    let new = place.join(&name);
    if new.symlink_metadata().is_ok() {
        return Err(FOLDER_EXISTS.to_string());
    }
    if place.starts_with(&old) {
        return Err(CANNOT_WRITE.to_string());
    }
    let plan = plan_copy(&old).map_err(str::to_string)?;
    fs::create_dir(&new).map_err(|error| create_folder_error(&error))?;

    let mut created = Created::default();
    created.dirs.push(new.clone());
    let written = copy_planned(&old, &new, &plan, &mut created)
        .and_then(|()| write_named_files(&new, files, false, &mut created));
    match written {
        Ok(paths) => Ok(SavedProject {
            folder: path_text(&new),
            paths,
        }),
        Err(()) => {
            created.remove();
            Err(CANNOT_WRITE.to_string())
        }
    }
}

fn millis(time: io::Result<SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64)
}

// A window focus never stats more than this many entries, the folder's own included (C48).
pub const MAX_STAMP_STATS: usize = 2_000;

fn stamp_skips(entry: &fs::DirEntry) -> bool {
    let name = entry.file_name();
    if name == ".DS_Store" {
        return true;
    }
    let text = name.to_string_lossy();
    let skipped_folder = text.starts_with('.') || text == "node_modules";
    skipped_folder && entry.file_type().is_ok_and(|kind| kind.is_dir())
}

// With files, only those files are stamped and no folder is listed. Without them, the folder
// and one level of subfolders, skipping node_modules and dot folders, in at most
// MAX_STAMP_STATS stats.
pub fn folder_stamp(folder: &str, files: Option<&[String]>) -> u64 {
    if let Some(files) = files.filter(|files| !files.is_empty()) {
        return files
            .iter()
            .filter_map(|path| {
                counts::stat();
                fs::metadata(path).ok()
            })
            .map(|meta| millis(meta.modified()))
            .max()
            .unwrap_or(0);
    }
    let root = Path::new(folder);
    counts::stat();
    let Ok(meta) = fs::metadata(root) else {
        return 0;
    };
    counts::read_dir();
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut budget = MAX_STAMP_STATS - 1;
    let mut newest = millis(meta.modified());
    for entry in entries.flatten() {
        counts::entry();
        if stamp_skips(&entry) {
            continue;
        }
        if budget == 0 {
            break;
        }
        budget -= 1;
        counts::stat();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        newest = newest.max(millis(meta.modified()));
        if !meta.is_dir() {
            continue;
        }
        counts::read_dir();
        let Ok(children) = fs::read_dir(entry.path()) else {
            continue;
        };
        for child in children.flatten() {
            counts::entry();
            if stamp_skips(&child) {
                continue;
            }
            if budget == 0 {
                break;
            }
            budget -= 1;
            counts::stat();
            if let Ok(meta) = child.metadata() {
                newest = newest.max(millis(meta.modified()));
            }
        }
    }
    newest
}

// ---------------------------------------------------------------------------------------------
// Change Name (F3): the rename itself (C44) and the rewrite of the places that use the name (C45).

const NOT_FOUND: &str = "not_found";
const READ_ONLY: &str = "read_only";
const CHANGED_ON_DISK: &str = "changed_on_disk";

/// Gives `from` the name of `to` and returns the new path (the real folder plus the new name as
/// given, never a later canonicalize, so the case the user typed is kept).
/// Errors: `file_exists` (a file of that name is there, even a hard link to the same file, or
/// it appeared while renaming), `not_found` (`from` is gone), `cannot_write` (another folder,
/// not a plain file, or the file system said no).
/// A rename never replaces a file (C44). A case-only rename (notes.txt to Notes.txt) goes
/// through a temporary name in two steps, so file systems that ignore a case change still work.
pub fn rename_file(from: &str, to: &str) -> Result<String, String> {
    let ops = RenameOps {
        after_check: &|| {},
        exclusive: &rename_no_replace,
        link: &|a: &Path, b: &Path| fs::hard_link(a, b),
    };
    rename_file_with(Path::new(from), Path::new(to), &ops).map_err(str::to_string)
}

// The three steps a test can replace: a hook right after the check that `to` is free, the
// exclusive rename, and the hard link of the first fallback.
struct RenameOps<'a> {
    after_check: &'a dyn Fn(),
    exclusive: &'a dyn Fn(&Path, &Path) -> io::Result<()>,
    link: &'a dyn Fn(&Path, &Path) -> io::Result<()>,
}

fn rename_file_with(from: &Path, to: &Path, ops: &RenameOps) -> Result<String, &'static str> {
    let meta = match from.symlink_metadata() {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(NOT_FOUND),
        Err(_) => return Err(CANNOT_WRITE),
    };
    if !meta.is_file() {
        return Err(CANNOT_WRITE);
    }
    let (Some(from_name), Some(to_name)) = (from.file_name(), to.file_name()) else {
        return Err(CANNOT_WRITE);
    };
    let (Some(old), Some(new)) = (from_name.to_str(), to_name.to_str()) else {
        return Err(CANNOT_WRITE);
    };
    let parent = |path: &Path| match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let folder = dunce::canonicalize(parent(from)).map_err(|_| NOT_FOUND)?;
    if dunce::canonicalize(parent(to)).ok().as_deref() != Some(folder.as_path()) {
        return Err(CANNOT_WRITE);
    }
    let from = folder.join(from_name);
    let to = folder.join(to_name);
    let done = path_text(&to);
    if old == new {
        return Ok(done);
    }

    if !same_name_ignoring_case(old, new) {
        if to.symlink_metadata().is_ok() {
            return Err(FILE_EXISTS);
        }
        (ops.after_check)();
        return move_no_replace(&from, &to, ops).map(|()| done);
    }

    // Case-only. A `to` that is there must be this very entry (a case-insensitive disk);
    // a different file, on a disk that keeps case apart, is taken.
    if to.symlink_metadata().is_ok() && !same_file(&from, &to) {
        return Err(FILE_EXISTS);
    }
    (ops.after_check)();
    let temp = rename_temp(&folder, old, &from, ops)?;
    match move_no_replace(&temp, &to, ops) {
        Ok(()) => Ok(done),
        Err(code) => match move_no_replace(&temp, &from, ops) {
            Ok(()) => Err(code),
            // The file now has the temporary name; there is nothing safe left to try.
            Err(_) => Err(CANNOT_WRITE),
        },
    }
}

// Step one of a case-only rename: move `from` to a fresh hidden name next to it.
fn rename_temp(folder: &Path, old: &str, from: &Path, ops: &RenameOps) -> Result<PathBuf, &'static str> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    for _ in 0..3 {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let temp = folder.join(format!(".{old}.{}-{n}.htmllab-rename", std::process::id()));
        match move_no_replace(from, &temp, ops) {
            Err(FILE_EXISTS) => continue,
            other => return other.map(|()| temp),
        }
    }
    Err(CANNOT_WRITE)
}

// Equal ignoring case, and on macOS also after NFC (the disk treats both forms as one name).
fn same_name_ignoring_case(a: &str, b: &str) -> bool {
    if cfg!(target_os = "macos") {
        use unicode_normalization::UnicodeNormalization;
        let fold = |s: &str| s.nfc().collect::<String>().to_lowercase();
        fold(a) == fold(b)
    } else {
        a.to_lowercase() == b.to_lowercase()
    }
}

// Do two paths reach the same file (the same entry on a case-insensitive disk)?
fn same_file(a: &Path, b: &Path) -> bool {
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

// Move without replacing. Where the file system has no exclusive rename (exFAT, FAT, many SMB
// shares): a hard link plus removing the old name; where it has no links either, a check and
// then a plain rename (the small race recorded in ADR 0010).
fn move_no_replace(from: &Path, to: &Path, ops: &RenameOps) -> Result<(), &'static str> {
    match (ops.exclusive)(from, to) {
        Ok(()) => Ok(()),
        Err(error) if !unsupported(&error) => Err(rename_error(&error)),
        Err(_) => match (ops.link)(from, to) {
            Ok(()) => {
                if fs::remove_file(from).is_err() {
                    let _ = fs::remove_file(to);
                    return Err(CANNOT_WRITE);
                }
                Ok(())
            }
            Err(error) if matches!(error.kind(), io::ErrorKind::AlreadyExists | io::ErrorKind::NotFound) => {
                Err(rename_error(&error))
            }
            Err(_) => {
                if to.symlink_metadata().is_ok() {
                    return Err(FILE_EXISTS);
                }
                fs::rename(from, to).map_err(|error| rename_error(&error))
            }
        },
    }
}

fn rename_error(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::AlreadyExists => FILE_EXISTS,
        io::ErrorKind::NotFound => NOT_FOUND,
        _ => CANNOT_WRITE,
    }
}

// The errors that mean "this file system cannot rename exclusively", not "no".
fn unsupported(error: &io::Error) -> bool {
    #[cfg(unix)]
    if matches!(
        error.raw_os_error(),
        Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
    ) {
        return true;
    }
    error.kind() == io::ErrorKind::Unsupported
}

#[cfg(unix)]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let (a, b) = (c_path(from)?, c_path(to)?);
    if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let (a, b) = (c_path(from)?, c_path(to)?);
    let done = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if done == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let wide = |path: &Path| -> Vec<u16> { path.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (a, b) = (wide(from), wide(to));
    // No MOVEFILE_REPLACE_EXISTING: an existing target is ERROR_ALREADY_EXISTS (C44).
    if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
fn rename_no_replace(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

/// One place to change, as find_references gives it (its other fields are ignored).
/// `from` and `to` are BYTE offsets into the decoded file text for a closed file, and UTF-16
/// code units into `text` for an open tab.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteSpan {
    pub from: usize,
    pub to: usize,
    pub old_text: String,
    pub new_text: String,
}

/// One referring file of the plan: a RefFile from find_references, and for an open tab also
/// the tab's saved text (the text the spans were found in) and its style.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteFile {
    pub path: String,
    #[serde(default)]
    pub open: bool,
    pub size: u64,
    pub hash: String,
    pub spans: Vec<RewriteSpan>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub bom: bool,
    #[serde(default)]
    pub encoding: String,
    #[serde(default)]
    pub eol: String,
}

/// One result per file (C5). `size` and `hash` describe the bytes now on disk; `text` is the
/// patched text for an open tab. `original` holds the file's bytes from before the write, for
/// a rollback with restore_bytes; it never goes to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    pub size: Option<u64>,
    pub hash: Option<String>,
    pub text: Option<String>,
    #[serde(skip)]
    pub original: Option<Vec<u8>>,
}

/// Puts the planned new names into every referring file (C45). A file is refused, and not
/// written, when it is outside `roots` or not a plain file (`cannot_write`), read-only
/// (`read_only`), or its bytes are not the ones planned (`changed_on_disk`); a span that does
/// not fit the text is `cannot_write`. Everything outside the spans keeps its bytes, and the
/// file keeps its BOM, encoding and line endings (C43). One file never stops the others.
pub fn rewrite_references(plan: &[RewriteFile], roots: &[PathBuf]) -> Vec<RewriteResult> {
    let roots: Vec<PathBuf> = roots.iter().filter_map(|r| dunce::canonicalize(r).ok()).collect();
    plan.iter()
        .map(|file| {
            let done = rewrite_one(file, &roots);
            let mut result = RewriteResult {
                path: file.path.clone(),
                ok: done.is_ok(),
                error: None,
                size: None,
                hash: None,
                text: None,
                original: None,
            };
            match done {
                Ok(written) => {
                    result.size = Some(written.bytes.len() as u64);
                    result.hash = Some(crate::refs::content_hash(&written.bytes));
                    result.text = written.text;
                    result.original = Some(written.original);
                }
                Err(code) => result.error = Some(code.to_string()),
            }
            result
        })
        .collect()
}

struct Rewritten {
    bytes: Vec<u8>,
    original: Vec<u8>,
    text: Option<String>,
}

// The real path of a plain, writable file inside one of the roots, or why not.
fn writable_inside(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, &'static str> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(CANNOT_WRITE);
    };
    let real = dunce::canonicalize(parent).map_err(|_| CANNOT_WRITE)?.join(name);
    if !roots.iter().any(|root| real.starts_with(root)) {
        return Err(CANNOT_WRITE);
    }
    let meta = real.symlink_metadata().map_err(|_| CANNOT_WRITE)?;
    if !meta.is_file() {
        return Err(CANNOT_WRITE);
    }
    if meta.permissions().readonly() || !may_write(&real) {
        return Err(READ_ONLY);
    }
    Ok(real)
}

// atomic_write replaces the file through its folder, so a file this user may not write
// would still be replaced: ask the system first.
fn may_write(path: &Path) -> bool {
    #[cfg(unix)]
    {
        c_path(path).is_ok_and(|p| unsafe { libc::access(p.as_ptr(), libc::W_OK) } == 0)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        true
    }
}

fn rewrite_one(file: &RewriteFile, roots: &[PathBuf]) -> Result<Rewritten, &'static str> {
    let real = writable_inside(Path::new(&file.path), roots)?;
    let original = fs::read(&real).map_err(|_| CANNOT_WRITE)?;

    let (bytes, tab_text) = if file.open {
        let text = file.text.clone().ok_or(CANNOT_WRITE)?;
        // The fingerprint find_references gives an open tab (its text), or the one a rewrite
        // gave (the bytes on disk).
        let planned = |bytes: &[u8]| {
            bytes.len() as u64 == file.size && crate::refs::content_hash(bytes) == file.hash
        };
        if !planned(text.as_bytes()) && !planned(&original) {
            return Err(CHANGED_ON_DISK);
        }
        let expected = encode_text(&text, file.bom, &file.encoding, &file.eol)?;
        // A file with mixed line endings never comes back from the editor's LF text. It is still
        // the planned file when its own text, with every CR LF and CR made LF as the editor does,
        // is the tab's text: then the spans go into its own text, so every ending stays (C45).
        let kept = if expected == original {
            None
        } else {
            let own = decode_text(&original).map_err(|_| CHANGED_ON_DISK)?;
            if editor_text(&own.text) != text || encode_text(&own.text, file.bom, &file.encoding, "lf")? != original {
                return Err(CHANGED_ON_DISK);
            }
            Some(own.text)
        };
        let patched = splice_spans(&text, &file.spans, true)?;
        let bytes = match kept {
            None => encode_text(&patched, file.bom, &file.encoding, &file.eol)?,
            Some(own) => encode_text(&splice_keeping_endings(&own, &text, &file.spans)?, file.bom, &file.encoding, "lf")?,
        };
        (bytes, Some(patched))
    } else {
        if original.len() as u64 != file.size || crate::refs::content_hash(&original) != file.hash {
            return Err(CHANGED_ON_DISK);
        }
        let decoded = decode_text(&original).map_err(|_| CHANGED_ON_DISK)?;
        let style = detect_style(&decoded.text, decoded.bom, decoded.encoding, false);
        // The decoded text keeps its CRs, so its own ending gives the same bytes back. A file
        // with mixed endings is written as it is ("lf" adds nothing), so only the spans change.
        let eol = match (style.mixed_eol, style.eol) {
            (true, _) | (false, Eol::Lf) => "lf",
            (false, Eol::Crlf) => "crlf",
            (false, Eol::Cr) => "cr",
        };
        let encoding = match decoded.encoding {
            Encoding::Utf8 => "utf8",
            Encoding::Utf16le => "utf16le",
            Encoding::Utf16be => "utf16be",
        };
        let patched = splice_spans(&decoded.text, &file.spans, false)?;
        (encode_text(&patched, decoded.bom, encoding, eol)?, None)
    };

    if bytes != original {
        atomic_write(&real, &bytes, false).map_err(|code| if code == FOLDER_GONE { FOLDER_GONE } else { CANNOT_WRITE })?;
    }
    Ok(Rewritten {
        bytes,
        original,
        text: tab_text,
    })
}

// What CodeMirror holds for a text: every CR LF and every lone CR becomes LF.
fn editor_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

// The spans of an open tab (UTF-16 offsets into `lf`, the editor's text) put into `own`, the
// file's text with its CRs, where `editor_text(own) == lf`. The caller has checked the spans
// against `lf` with splice_spans.
fn splice_keeping_endings(own: &str, lf: &str, spans: &[RewriteSpan]) -> Result<String, &'static str> {
    // at[i]: the byte of `own` that byte i of `lf` comes from; a CR LF is one byte in `lf`.
    let raw = own.as_bytes();
    let mut at = Vec::with_capacity(lf.len() + 1);
    let mut j = 0;
    while j < raw.len() {
        at.push(j);
        j += if raw[j] == b'\r' && raw.get(j + 1) == Some(&b'\n') { 2 } else { 1 };
    }
    at.push(j);
    if at.len() != lf.len() + 1 {
        return Err(CHANGED_ON_DISK);
    }
    let mut spans: Vec<&RewriteSpan> = spans.iter().collect();
    spans.sort_by_key(|s| (s.from, s.to));
    let units: Vec<usize> = spans.iter().flat_map(|s| [s.from, s.to]).collect();
    let bytes = bytes_at_units(lf, &units).ok_or(CANNOT_WRITE)?;
    let mut out = String::with_capacity(own.len());
    let mut last = 0;
    for (k, span) in spans.iter().enumerate() {
        let (from, to) = (at[bytes[2 * k]], at[bytes[2 * k + 1]]);
        out.push_str(&own[last..from]);
        out.push_str(&span.new_text);
        last = to;
    }
    out.push_str(&own[last..]);
    Ok(out)
}

// The text with each span's old text replaced by its new text. Spans may come in any order but
// must not overlap, must sit on character boundaries and must hold their old text.
fn splice_spans(text: &str, spans: &[RewriteSpan], utf16: bool) -> Result<String, &'static str> {
    let mut spans: Vec<&RewriteSpan> = spans.iter().collect();
    spans.sort_by_key(|s| (s.from, s.to));
    let mut edges = Vec::with_capacity(spans.len() * 2);
    let mut last = 0;
    for span in &spans {
        if span.from > span.to || span.from < last {
            return Err(CANNOT_WRITE);
        }
        last = span.to;
        edges.push(span.from);
        edges.push(span.to);
    }
    let bytes = if utf16 {
        bytes_at_units(text, &edges).ok_or(CANNOT_WRITE)?
    } else {
        if edges.iter().any(|at| !text.is_char_boundary(*at)) {
            return Err(CANNOT_WRITE);
        }
        edges
    };
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (k, span) in spans.iter().enumerate() {
        let (from, to) = (bytes[2 * k], bytes[2 * k + 1]);
        if &text[from..to] != span.old_text.as_str() {
            return Err(CANNOT_WRITE);
        }
        out.push_str(&text[at..from]);
        out.push_str(&span.new_text);
        at = to;
    }
    out.push_str(&text[at..]);
    Ok(out)
}

// Byte offsets for UTF-16 offsets given in rising order; None past the end or inside a pair.
fn bytes_at_units(text: &str, units: &[usize]) -> Option<Vec<usize>> {
    let mut out = Vec::with_capacity(units.len());
    let mut chars = text.char_indices();
    let (mut byte, mut unit) = (0usize, 0usize);
    for &wanted in units {
        while unit < wanted {
            let (i, c) = chars.next()?;
            unit += c.len_utf16();
            byte = i + c.len_utf8();
        }
        if unit != wanted {
            return None;
        }
        out.push(byte);
    }
    Some(out)
}

/// Writes `original` back over a file rewrite_references changed, only while the file still
/// has the bytes that were written (`size` and `hash` from its result); otherwise
/// `changed_on_disk` and nothing is written. The same guards as the rewrite apply.
pub fn restore_bytes(path: &str, original: &[u8], size: u64, hash: &str, roots: &[PathBuf]) -> Result<(), String> {
    let roots: Vec<PathBuf> = roots.iter().filter_map(|r| dunce::canonicalize(r).ok()).collect();
    let real = writable_inside(Path::new(path), &roots).map_err(str::to_string)?;
    let now = still_written(&real, size, hash)?;
    if now == original {
        return Ok(());
    }
    atomic_write(&real, original, false)
}

/// The Undo check: whether restore_bytes could write `path` now, with nothing written. The same
/// guards as the write (a plain, writable file inside the roots, `cannot_write` or `read_only`)
/// and the same bytes (`changed_on_disk`), so Undo never stops half way through.
pub fn check_restore(path: &str, size: u64, hash: &str, roots: &[PathBuf]) -> Result<(), String> {
    let roots: Vec<PathBuf> = roots.iter().filter_map(|r| dunce::canonicalize(r).ok()).collect();
    let real = writable_inside(Path::new(path), &roots).map_err(str::to_string)?;
    still_written(&real, size, hash).map(|_| ())
}

// The bytes now in the file, while they are the ones HTML Lab wrote (`size`, `hash`).
fn still_written(real: &Path, size: u64, hash: &str) -> Result<Vec<u8>, String> {
    let now = fs::read(real).map_err(|_| CANNOT_WRITE.to_string())?;
    if now.len() as u64 != size || crate::refs::content_hash(&now) != hash {
        return Err(CHANGED_ON_DISK.to_string());
    }
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs::FileTimes;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    use tempfile::{tempdir, TempDir};

    fn real_tempdir() -> (TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    fn text(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    fn s(path: &Path) -> String {
        path_text(path)
    }

    fn named(name: &str, text: &str) -> NamedFile {
        NamedFile {
            name: name.to_string(),
            text: text.to_string(),
            ..NamedFile::default()
        }
    }

    fn listing(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    fn set_mode(path: &Path, mode: u32) {
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn set_mtime(path: &Path, time: SystemTime) {
        let mut options = OpenOptions::new();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.write(true).custom_flags(0x0200_0000);
        }
        #[cfg(not(windows))]
        options.read(true);
        let file = options.open(path).unwrap();
        file.set_times(FileTimes::new().set_modified(time)).unwrap();
    }

    fn snapshot(folder: &Path) -> BTreeMap<PathBuf, (Vec<u8>, SystemTime)> {
        let mut seen = BTreeMap::new();
        let mut pending = vec![folder.to_path_buf()];
        while let Some(dir) = pending.pop() {
            let meta = fs::metadata(&dir).unwrap();
            seen.insert(dir.clone(), (Vec::new(), meta.modified().unwrap()));
            for entry in fs::read_dir(&dir).unwrap() {
                let entry = entry.unwrap();
                let meta = entry.path().symlink_metadata().unwrap();
                if meta.is_dir() {
                    pending.push(entry.path());
                } else if meta.is_file() {
                    seen.insert(
                        entry.path(),
                        (fs::read(entry.path()).unwrap(), meta.modified().unwrap()),
                    );
                } else {
                    seen.insert(entry.path(), (Vec::new(), meta.modified().unwrap()));
                }
            }
        }
        seen
    }

    fn read_single(path: &Path) -> ReadResult {
        read_files(&[s(path)]).remove(0)
    }

    #[test]
    fn read_returns_text_with_the_canonical_path() {
        let (_dir, folder) = real_tempdir();
        fs::create_dir(folder.join("sub")).unwrap();
        fs::write(folder.join("a.html"), "<p>hello</p>\n").unwrap();
        let result = read_single(&folder.join("sub/../a.html"));
        assert_eq!(result.path, s(&folder.join("a.html")));
        assert_eq!(result.name, "a.html");
        assert_eq!(result.text.as_deref(), Some("<p>hello</p>\n"));
        assert_eq!(result.error, None);
    }

    #[cfg(unix)]
    #[test]
    fn read_goes_through_a_symlinked_folder_to_the_real_path() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("a.html"), "x").unwrap();
        let other = tempdir().unwrap();
        let link = other.path().join("link");
        std::os::unix::fs::symlink(&folder, &link).unwrap();
        assert_eq!(
            read_single(&link.join("a.html")).path,
            s(&folder.join("a.html"))
        );
    }

    #[test]
    fn read_refuses_over_5_mb() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("big.html");
        fs::write(&path, vec![b'a'; 5 * 1024 * 1024]).unwrap();
        assert_eq!(
            read_single(&path).text.map(|t| t.len()),
            Some(5 * 1024 * 1024)
        );

        fs::write(&path, vec![b'a'; 5 * 1024 * 1024 + 1]).unwrap();
        let result = read_single(&path);
        assert_eq!(result.text, None);
        assert_eq!(result.error.as_deref(), Some("too_big"));
    }

    #[test]
    fn read_refuses_a_nul_byte() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, b"abc\0def").unwrap();
        let result = read_single(&path);
        assert_eq!(result.text, None);
        assert_eq!(result.error.as_deref(), Some("not_text"));
    }

    #[test]
    fn read_refuses_invalid_utf8() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, [b'a', 0xff, 0xfe, b'b']).unwrap();
        let result = read_single(&path);
        assert_eq!(result.error.as_deref(), Some("other_encoding"));
        assert_eq!(result.text, None);
        assert_eq!(result.style, None);
    }

    #[test]
    fn read_strips_a_byte_order_mark() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, "\u{feff}<p>ä</p>").unwrap();
        assert_eq!(read_single(&path).text.as_deref(), Some("<p>ä</p>"));
        fs::write(&path, "\u{feff}").unwrap();
        assert_eq!(read_single(&path).text.as_deref(), Some(""));
        fs::write(&path, "a\u{feff}b").unwrap();
        assert_eq!(read_single(&path).text.as_deref(), Some("a\u{feff}b"));
    }

    #[test]
    fn read_opens_an_empty_file_as_empty_text() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, "").unwrap();
        let result = read_single(&path);
        assert_eq!(result.text.as_deref(), Some(""));
        assert_eq!(result.error, None);
    }

    #[cfg(unix)]
    #[test]
    fn read_reports_missing_unreadable_and_folder() {
        let (_dir, folder) = real_tempdir();
        let missing = read_single(&folder.join("gone.html"));
        assert_eq!(missing.error.as_deref(), Some("cannot_read"));
        assert_eq!(missing.name, "gone.html");
        assert_eq!(missing.path, s(&folder.join("gone.html")));

        assert_eq!(read_single(&folder).error.as_deref(), Some("cannot_read"));

        let locked = folder.join("locked.html");
        fs::write(&locked, "x").unwrap();
        set_mode(&locked, 0o000);
        let result = read_single(&locked);
        set_mode(&locked, 0o644);
        assert_eq!(result.error.as_deref(), Some("cannot_read"));
    }

    #[cfg(unix)]
    #[test]
    fn read_does_not_hang_on_a_pipe() {
        let (_dir, folder) = real_tempdir();
        let pipe = folder.join("pipe.html");
        let c_path = std::ffi::CString::new(std::os::unix::ffi::OsStrExt::as_bytes(pipe.as_os_str())).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o644) }, 0);
        assert_eq!(read_single(&pipe).error.as_deref(), Some("cannot_read"));
    }

    #[test]
    fn read_handles_each_file_on_its_own() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("good.html"), "x").unwrap();
        let results = read_files(&[s(&folder.join("gone.html")), s(&folder.join("good.html"))]);
        assert_eq!(results.len(), 2);
        assert!(results[0].error.is_some());
        assert_eq!(results[1].text.as_deref(), Some("x"));
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        atomic_write(&path, b"one", false).unwrap();
        assert_eq!(text(&path), "one");
        atomic_write(&path, b"two", false).unwrap();
        assert_eq!(text(&path), "two");
        assert_eq!(listing(&folder), ["a.html"]);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_the_old_permissions() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, "old").unwrap();
        set_mode(&path, 0o640);
        atomic_write(&path, b"new", false).unwrap();
        assert_eq!(mode_of(&path), 0o640);
        assert_eq!(text(&path), "new");

        set_mode(&path, 0o600);
        atomic_write(&path, b"newer", false).unwrap();
        assert_eq!(mode_of(&path), 0o600);
    }

    #[test]
    fn atomic_write_leaves_no_temp_behind_on_success() {
        let (_dir, folder) = real_tempdir();
        atomic_write(&folder.join("a.html"), b"x", false).unwrap();
        atomic_write(&folder.join("b.html"), b"x", true).unwrap();
        assert_eq!(listing(&folder), ["a.html", "b.html"]);
    }

    #[test]
    fn atomic_write_must_not_exist_writes_when_free() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        atomic_write(&path, b"new", true).unwrap();
        assert_eq!(text(&path), "new");
    }

    #[test]
    fn atomic_write_must_not_exist_changes_nothing_when_taken() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, "his own file").unwrap();
        let error = atomic_write(&path, b"new", true).unwrap_err();
        assert_eq!(error, "file_exists");
        assert_eq!(text(&path), "his own file");
        assert_eq!(listing(&folder), ["a.html"]);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_must_not_exist_counts_a_dangling_symlink() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        std::os::unix::fs::symlink("nowhere", &path).unwrap();
        assert_eq!(
            atomic_write(&path, b"new", true).unwrap_err(),
            "file_exists"
        );
    }

    #[test]
    fn no_clobber_publish_never_replaces_a_file_that_appeared_late() {
        let (_dir, folder) = real_tempdir();
        let temp = folder.join(".a.html.htmllab-tmp");
        let target = folder.join("a.html");
        fs::write(&temp, "new").unwrap();
        fs::write(&target, "copied in meanwhile").unwrap();
        assert_eq!(publish_no_clobber(&temp, &target), Err("file_exists"));
        assert_eq!(text(&target), "copied in meanwhile");

        fs::remove_file(&target).unwrap();
        assert_eq!(publish_no_clobber(&temp, &target), Ok(()));
        assert_eq!(text(&target), "new");
        assert!(!temp.exists());
    }

    #[test]
    fn atomic_write_gone_folder_reports_folder_gone() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("gone/a.html");
        assert_eq!(atomic_write(&path, b"x", false).unwrap_err(), "folder_gone");
        assert_eq!(atomic_write(&path, b"x", true).unwrap_err(), "folder_gone");
    }

    #[test]
    fn atomic_write_failure_deletes_the_temp_file() {
        let (_dir, folder) = real_tempdir();
        fs::create_dir(folder.join("a.html")).unwrap();
        let error = atomic_write(&folder.join("a.html"), b"x", false).unwrap_err();
        assert_eq!(error, "cannot_write");
        assert_eq!(listing(&folder), ["a.html"]);
        assert!(folder.join("a.html").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_read_only_folder_is_cannot_write_and_old_file_stays() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("a.html");
        fs::write(&path, "old").unwrap();
        set_mode(&folder, 0o555);
        let result = atomic_write(&path, b"new", false);
        set_mode(&folder, 0o755);
        assert_eq!(result.unwrap_err(), "cannot_write");
        assert_eq!(text(&path), "old");
        assert_eq!(listing(&folder), ["a.html"]);
    }

    #[test]
    fn atomic_write_overcomes_a_temp_file_left_by_a_crash() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join(".a.html.htmllab-tmp"), "stale").unwrap();
        atomic_write(&folder.join("a.html"), b"new", false).unwrap();
        assert_eq!(text(&folder.join("a.html")), "new");
        assert_eq!(listing(&folder), ["a.html"]);
    }

    // Teeth: with WRITE_RETRIES 0 on Windows the replace fails while the file is held.
    #[cfg(windows)]
    #[test]
    fn atomic_write_waits_for_a_file_held_for_a_moment_on_windows() {
        use std::os::windows::fs::OpenOptionsExt;
        let (_dir, folder) = real_tempdir();
        let target = folder.join("a.html");
        fs::write(&target, "old").unwrap();
        // Shared for reading only, as a scanner may hold it: no replace while it is open.
        let held = OpenOptions::new().read(true).share_mode(1).open(&target).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            drop(held);
        });
        atomic_write(&target, b"new", false).unwrap();
        release.join().unwrap();
        assert_eq!(text(&target), "new");
        assert_eq!(listing(&folder), ["a.html"]);
    }

    #[cfg(unix)]
    #[test]
    fn sync_falls_back_to_fsync_on_the_three_errors() {
        let (_dir, folder) = real_tempdir();
        let file = File::create(folder.join("a")).unwrap();
        for code in [libc::ENOTSUP, libc::EINVAL, libc::ENOTTY] {
            sync_with_fallback(&file, |_| Err(io::Error::from_raw_os_error(code))).unwrap();
        }
        sync_with_fallback(&file, |_| Ok(())).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn sync_reports_any_other_error() {
        let (_dir, folder) = real_tempdir();
        let file = File::create(folder.join("a")).unwrap();
        let result = sync_with_fallback(&file, |_| Err(io::Error::from_raw_os_error(libc::EIO)));
        assert_eq!(result.unwrap_err().raw_os_error(), Some(libc::EIO));
    }

    #[test]
    fn write_files_writes_and_reports_each() {
        let (_dir, folder) = real_tempdir();
        let one = folder.join("a.html");
        let results = write_files(&[WriteFile {
            path: s(&one),
            text: "x".to_string(),
            ..WriteFile::default()
        }]);
        assert_eq!(
            results,
            [WriteResult {
                path: s(&one),
                ok: true,
                error: None,
            }]
        );
        assert_eq!(text(&one), "x");
    }

    #[test]
    fn write_files_one_failure_does_not_stop_the_others() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("taken.html"), "his").unwrap();
        let file = |path: PathBuf, must_not_exist| WriteFile {
            path: s(&path),
            text: "new".to_string(),
            must_not_exist,
            ..WriteFile::default()
        };
        let results = write_files(&[
            file(folder.join("first.html"), false),
            file(folder.join("gone/x.html"), false),
            file(folder.join("taken.html"), true),
            file(folder.join("last.html"), true),
        ]);
        assert_eq!(results[0].error, None);
        assert_eq!(results[1].error.as_deref(), Some("folder_gone"));
        assert!(!results[1].ok);
        assert_eq!(results[2].error.as_deref(), Some("file_exists"));
        assert!(!results[2].ok);
        assert!(results[3].ok);
        assert_eq!(text(&folder.join("first.html")), "new");
        assert_eq!(text(&folder.join("taken.html")), "his");
        assert_eq!(text(&folder.join("last.html")), "new");
    }

    #[test]
    fn write_file_accepts_camel_case_and_a_missing_flag() {
        let file: WriteFile =
            serde_json::from_str(r#"{ "path": "/a", "text": "b", "mustNotExist": true }"#).unwrap();
        assert!(file.must_not_exist);
        let file: WriteFile = serde_json::from_str(r#"{ "path": "/a", "text": "b" }"#).unwrap();
        assert!(!file.must_not_exist);
    }

    #[test]
    fn save_project_writes_every_file_hidden_too_in_order() {
        let (_dir, parent) = real_tempdir();
        let saved = save_project(
            &s(&parent),
            "My gallery",
            &[
                named("gallery.html", "<p>x</p>\n"),
                named("style.css", "p {}\n"),
                named("sun.svg", "<svg/>\n"),
            ],
        )
        .unwrap();
        let folder = parent.join("My gallery");
        assert_eq!(saved.folder, s(&folder));
        assert_eq!(
            saved.paths,
            [
                s(&folder.join("gallery.html")),
                s(&folder.join("style.css")),
                s(&folder.join("sun.svg")),
            ]
        );
        assert_eq!(text(&folder.join("sun.svg")), "<svg/>\n");
        assert_eq!(listing(&folder), ["gallery.html", "style.css", "sun.svg"]);
    }

    #[cfg(unix)]
    #[test]
    fn save_project_returns_real_paths() {
        let (_dir, parent) = real_tempdir();
        let other = tempdir().unwrap();
        let link = other.path().join("link");
        std::os::unix::fs::symlink(&parent, &link).unwrap();
        let saved = save_project(&s(&link), "P", &[named("a.html", "x")]).unwrap();
        assert_eq!(saved.folder, s(&parent.join("P")));
        assert_eq!(saved.paths, [s(&parent.join("P/a.html"))]);
    }

    #[test]
    fn save_project_existing_folder_changes_nothing() {
        let (_dir, parent) = real_tempdir();
        let folder = parent.join("Mine");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("keep.html"), "keep").unwrap();
        let before = snapshot(&folder);
        let error = save_project(&s(&parent), "Mine", &[named("keep.html", "new")]).unwrap_err();
        assert_eq!(error, "folder_exists");
        assert_eq!(snapshot(&folder), before);
    }

    #[test]
    fn save_project_failure_leaves_nothing_and_a_retry_works() {
        let (_dir, parent) = real_tempdir();
        let long_name = "x".repeat(300);
        let error = save_project(
            &s(&parent),
            "Mine",
            &[
                named("a.html", "x"),
                named("b.css", "y"),
                named(&long_name, "z"),
            ],
        )
        .unwrap_err();
        assert_eq!(error, "cannot_write");
        assert!(listing(&parent).is_empty());

        let saved = save_project(
            &s(&parent),
            "Mine",
            &[named("a.html", "x"), named("b.css", "y")],
        )
        .unwrap();
        assert_eq!(saved.paths.len(), 2);
        assert_eq!(listing(&parent.join("Mine")), ["a.html", "b.css"]);
    }

    #[test]
    fn save_project_refuses_a_file_name_that_leaves_the_folder() {
        let (_dir, parent) = real_tempdir();
        for bad in ["../evil.html", "sub/a.html", "..", ".", ""] {
            let error = save_project(
                &s(&parent),
                "Mine",
                &[named("a.html", "x"), named(bad, "y")],
            );
            assert_eq!(error.unwrap_err(), "cannot_write", "{bad}");
            assert!(listing(&parent).is_empty(), "{bad}");
        }
    }

    #[test]
    fn save_project_failure_on_a_name_twice_loses_nothing() {
        let (_dir, parent) = real_tempdir();
        let error = save_project(
            &s(&parent),
            "Mine",
            &[named("a.html", "x"), named("a.html", "y")],
        );
        assert_eq!(error.unwrap_err(), "cannot_write");
        assert!(listing(&parent).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn save_project_in_a_gone_or_locked_parent_is_cannot_write() {
        let (_dir, parent) = real_tempdir();
        let gone = parent.join("gone");
        let error = save_project(&s(&gone), "Mine", &[named("a.html", "x")]).unwrap_err();
        assert_eq!(error, "cannot_write");
        assert!(!gone.exists());

        set_mode(&parent, 0o555);
        let error = save_project(&s(&parent), "Mine", &[named("a.html", "x")]).unwrap_err();
        set_mode(&parent, 0o755);
        assert_eq!(error, "cannot_write");
        assert!(listing(&parent).is_empty());
    }

    #[test]
    fn save_project_cleans_the_name_it_gets() {
        let (_dir, parent) = real_tempdir();
        let saved = save_project(&s(&parent), " ../a:b ", &[named("x.html", "x")]).unwrap();
        assert_eq!(saved.folder, s(&parent.join("-a-b")));
        let error = save_project(&s(&parent), " .. ", &[named("x.html", "x")]).unwrap_err();
        assert_eq!(error, "cannot_write");
        assert_eq!(listing(&parent), ["-a-b"]);
    }

    #[test]
    fn cleanup_removes_only_what_it_made_plus_ds_store() {
        let (_dir, parent) = real_tempdir();
        let folder = parent.join("new");
        fs::create_dir_all(folder.join("sub")).unwrap();
        fs::write(folder.join("made.html"), "x").unwrap();
        fs::write(folder.join(".DS_Store"), "finder").unwrap();
        fs::write(folder.join("sub/.DS_Store"), "finder").unwrap();
        let created = Created {
            dirs: vec![folder.clone(), folder.join("sub")],
            files: vec![folder.join("made.html")],
        };
        created.remove();
        assert!(listing(&parent).is_empty());

        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("made.html"), "x").unwrap();
        fs::write(folder.join("his.html"), "his").unwrap();
        let created = Created {
            dirs: vec![folder.clone()],
            files: vec![folder.join("made.html")],
        };
        created.remove();
        assert_eq!(listing(&folder), ["his.html"]);
    }

    #[cfg(unix)]
    fn old_project(parent: &Path) -> PathBuf {
        let old = parent.join("old");
        fs::create_dir_all(old.join("images/deep")).unwrap();
        fs::create_dir(old.join(".git")).unwrap();
        fs::write(old.join("a.html"), "old a").unwrap();
        fs::write(old.join("style.css"), "old css").unwrap();
        fs::write(old.join("notes.txt"), "notes").unwrap();
        fs::write(old.join("images/sun.png"), "png").unwrap();
        fs::write(old.join("images/deep/moon.png"), "moon").unwrap();
        fs::write(old.join(".secret"), "dot").unwrap();
        fs::write(old.join("images/.hidden.png"), "dot").unwrap();
        fs::write(old.join(".git/config"), "dot").unwrap();
        std::os::unix::fs::symlink(old.join("a.html"), old.join("link.html")).unwrap();
        std::os::unix::fs::symlink(old.join("images"), old.join("link-dir")).unwrap();
        old
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_copies_subfolders_and_writes_the_tabs_over_the_copies() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let saved = save_copy(
            &s(&old),
            &s(&parent),
            "old copy",
            &[named("a.html", "new a"), named("added.css", "added")],
        )
        .unwrap();
        let new = parent.join("old copy");
        assert_eq!(saved.folder, s(&new));
        assert_eq!(
            saved.paths,
            [s(&new.join("a.html")), s(&new.join("added.css"))]
        );
        assert_eq!(text(&new.join("a.html")), "new a");
        assert_eq!(text(&new.join("added.css")), "added");
        assert_eq!(text(&new.join("style.css")), "old css");
        assert_eq!(text(&new.join("notes.txt")), "notes");
        assert_eq!(text(&new.join("images/sun.png")), "png");
        assert_eq!(text(&new.join("images/deep/moon.png")), "moon");
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_skips_dotfiles_and_symlinks() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        save_copy(&s(&old), &s(&parent), "c", &[]).unwrap();
        let new = parent.join("c");
        assert_eq!(
            listing(&new),
            ["a.html", "images", "notes.txt", "style.css"]
        );
        assert_eq!(listing(&new.join("images")), ["deep", "sun.png"]);
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_leaves_the_old_folder_unchanged() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let before = snapshot(&old);
        let stamp = folder_stamp(&s(&old), None);
        save_copy(&s(&old), &s(&parent), "c", &[named("a.html", "changed")]).unwrap();
        assert_eq!(snapshot(&old), before);
        assert_eq!(folder_stamp(&s(&old), None), stamp);
        assert_eq!(text(&old.join("a.html")), "old a");
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_existing_target_is_folder_exists() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        fs::create_dir(parent.join("taken")).unwrap();
        let error = save_copy(&s(&old), &s(&parent), "taken", &[named("a.html", "x")]).unwrap_err();
        assert_eq!(error, "folder_exists");
        assert!(listing(&parent.join("taken")).is_empty());
        let error = save_copy(&s(&old), &s(&parent), "old", &[named("a.html", "x")]).unwrap_err();
        assert_eq!(error, "folder_exists");
        assert_eq!(text(&old.join("a.html")), "old a");
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_inside_the_old_folder_is_refused() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let before = snapshot(&old);
        for place in [old.clone(), old.join("images"), old.join("images/deep")] {
            let error = save_copy(&s(&old), &s(&place), "inside", &[]).unwrap_err();
            assert_eq!(error, "cannot_write", "{}", place.display());
        }
        assert_eq!(snapshot(&old), before);
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_inside_the_old_folder_is_refused_through_a_symlink() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let other = tempdir().unwrap();
        let link = other.path().join("link");
        std::os::unix::fs::symlink(old.join("images"), &link).unwrap();
        let error = save_copy(&s(&old), &s(&link), "inside", &[]).unwrap_err();
        assert_eq!(error, "cannot_write");
        assert!(!old.join("images/inside").exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_a_folder_with_a_name_that_starts_alike_is_not_inside() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let beside = parent.join("old-beside");
        fs::create_dir(&beside).unwrap();
        save_copy(&s(&old), &s(&beside), "c", &[]).unwrap();
        assert!(beside.join("c/a.html").is_file());
    }

    #[test]
    fn save_copy_exactly_500_files_is_allowed_and_501_is_too_big() {
        let (_dir, parent) = real_tempdir();
        let old = parent.join("old");
        fs::create_dir_all(old.join("sub")).unwrap();
        for n in 0..250 {
            fs::write(old.join(format!("f{n}.txt")), "x").unwrap();
            fs::write(old.join("sub").join(format!("g{n}.txt")), "x").unwrap();
        }
        fs::write(old.join(".DS_Store"), "x").unwrap();
        save_copy(&s(&old), &s(&parent), "ok", &[]).unwrap();
        assert_eq!(listing(&parent.join("ok")).len(), 251);

        fs::write(old.join("one-more.txt"), "x").unwrap();
        let error = save_copy(&s(&old), &s(&parent), "big", &[]).unwrap_err();
        assert_eq!(error, "too_big");
        assert!(!parent.join("big").exists());
    }

    #[test]
    fn save_copy_over_500_mb_is_too_big_before_anything_is_written() {
        let (_dir, parent) = real_tempdir();
        let old = parent.join("old");
        fs::create_dir(&old).unwrap();
        let file = File::create(old.join("big.bin")).unwrap();
        file.set_len(MAX_COPY_BYTES + 1).unwrap();
        let error = save_copy(&s(&old), &s(&parent), "c", &[]).unwrap_err();
        assert_eq!(error, "too_big");
        assert!(!parent.join("c").exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_failure_while_copying_removes_all_it_made() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let locked = old.join("zzz-locked.html");
        fs::write(&locked, "x").unwrap();
        set_mode(&locked, 0o000);
        let result = save_copy(&s(&old), &s(&parent), "c", &[named("a.html", "x")]);
        set_mode(&locked, 0o644);
        assert_eq!(result.unwrap_err(), "cannot_write");
        assert!(!parent.join("c").exists());
        assert_eq!(listing(&parent), ["old"]);
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_failure_while_writing_tabs_removes_all_it_made_and_a_retry_works() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let long_name = "x".repeat(300);
        let error = save_copy(
            &s(&old),
            &s(&parent),
            "c",
            &[named("a.html", "x"), named(&long_name, "y")],
        )
        .unwrap_err();
        assert_eq!(error, "cannot_write");
        assert_eq!(listing(&parent), ["old"]);

        save_copy(&s(&old), &s(&parent), "c", &[named("a.html", "x")]).unwrap();
        assert_eq!(text(&parent.join("c/a.html")), "x");
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_of_a_read_only_page_can_still_write_over_its_copy() {
        let (_dir, parent) = real_tempdir();
        let old = parent.join("old");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("a.html"), "old").unwrap();
        set_mode(&old.join("a.html"), 0o444);
        save_copy(&s(&old), &s(&parent), "c", &[named("a.html", "new")]).unwrap();
        assert_eq!(text(&parent.join("c/a.html")), "new");
        assert_eq!(text(&old.join("a.html")), "old");
    }

    #[cfg(unix)]
    #[test]
    fn save_copy_gone_folder_or_parent_is_cannot_write() {
        let (_dir, parent) = real_tempdir();
        let old = old_project(&parent);
        let gone = parent.join("gone");
        assert_eq!(
            save_copy(&s(&gone), &s(&parent), "c", &[]).unwrap_err(),
            "cannot_write"
        );
        assert_eq!(
            save_copy(&s(&old), &s(&gone), "c", &[]).unwrap_err(),
            "cannot_write"
        );
        assert!(!parent.join("c").exists());
    }

    #[test]
    fn saved_project_serializes_camel_case() {
        let value = serde_json::to_value(SavedProject {
            folder: "/a".to_string(),
            paths: vec!["/a/b".to_string()],
        })
        .unwrap();
        assert_eq!(value["folder"], "/a");
        assert_eq!(value["paths"][0], "/a/b");
    }

    fn an_hour_ago() -> SystemTime {
        SystemTime::now() - Duration::from_secs(3600)
    }

    #[cfg(unix)]
    #[test]
    fn stamp_of_an_unreadable_or_gone_folder_is_zero() {
        let (_dir, parent) = real_tempdir();
        assert_eq!(folder_stamp(&s(&parent.join("gone")), None), 0);

        let locked = parent.join("locked");
        fs::create_dir(&locked).unwrap();
        set_mode(&locked, 0o000);
        let stamp = folder_stamp(&s(&locked), None);
        set_mode(&locked, 0o755);
        assert_eq!(stamp, 0);
    }

    #[test]
    fn stamp_is_ms_since_the_epoch() {
        let (_dir, folder) = real_tempdir();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let stamp = folder_stamp(&s(&folder), None);
        assert!(
            stamp > now - 60_000 && stamp <= now + 60_000,
            "{stamp} vs {now}"
        );
    }

    #[test]
    fn stamp_stays_when_nothing_changed() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("a.html"), "x").unwrap();
        fs::create_dir(folder.join("images")).unwrap();
        fs::write(folder.join("images/a.png"), "x").unwrap();
        let stamp = folder_stamp(&s(&folder), None);
        assert_eq!(folder_stamp(&s(&folder), None), stamp);
    }

    #[test]
    fn stamp_moves_when_a_file_with_an_old_date_is_copied_in() {
        let (_dir, parent) = real_tempdir();
        let folder = parent.join("project");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a.html"), "x").unwrap();
        set_mtime(&folder.join("a.html"), an_hour_ago());
        set_mtime(&folder, an_hour_ago());
        let before = folder_stamp(&s(&folder), None);

        let picture = folder.join("old.png");
        fs::write(&picture, "png").unwrap();
        set_mtime(&picture, an_hour_ago());
        let picture_time = millis(fs::metadata(&picture).unwrap().modified());
        let after = folder_stamp(&s(&folder), None);
        assert!(after > before, "{after} vs {before}");
        assert!(after >= picture_time + 3_000_000);
    }

    #[test]
    fn stamp_sees_a_file_changed_in_place() {
        let (_dir, folder) = real_tempdir();
        let page = folder.join("a.html");
        fs::write(&page, "x").unwrap();
        set_mtime(&page, an_hour_ago());
        set_mtime(&folder, an_hour_ago());
        let before = folder_stamp(&s(&folder), None);
        fs::write(&page, "y").unwrap();
        assert!(folder_stamp(&s(&folder), None) > before);
    }

    #[test]
    fn stamp_sees_one_level_of_subfolders_only() {
        let (_dir, folder) = real_tempdir();
        let sub = folder.join("images");
        let deep = sub.join("deep");
        fs::create_dir_all(&deep).unwrap();
        let in_sub = sub.join("a.png");
        let in_deep = deep.join("b.png");
        fs::write(&in_sub, "x").unwrap();
        fs::write(&in_deep, "x").unwrap();
        let old = an_hour_ago();
        for path in [&in_sub, &in_deep, &deep, &sub, &folder] {
            set_mtime(path, old);
        }
        let before = folder_stamp(&s(&folder), None);

        let future = SystemTime::now() + Duration::from_secs(3600);
        set_mtime(&in_deep, future);
        assert_eq!(folder_stamp(&s(&folder), None), before);

        set_mtime(&in_sub, future);
        assert!(folder_stamp(&s(&folder), None) > before);
    }

    #[test]
    #[cfg(not(windows))]
    fn stamp_ignores_ds_store() {
        let (_dir, folder) = real_tempdir();
        fs::create_dir(folder.join("images")).unwrap();
        fs::write(folder.join(".DS_Store"), "finder").unwrap();
        fs::write(folder.join("images/.DS_Store"), "finder").unwrap();
        let before = folder_stamp(&s(&folder), None);

        let future = SystemTime::now() + Duration::from_secs(3600);
        set_mtime(&folder.join(".DS_Store"), future);
        set_mtime(&folder.join("images/.DS_Store"), future);
        assert_eq!(folder_stamp(&s(&folder), None), before);
    }

    #[cfg(unix)]
    #[test]
    fn stamp_does_not_mind_a_dangling_symlink() {
        let (_dir, folder) = real_tempdir();
        std::os::unix::fs::symlink("nowhere", folder.join("link")).unwrap();
        assert!(folder_stamp(&s(&folder), None) > 0);
    }

    // ---- 0.3.0: a file is saved exactly as it was (C43, C10) ----

    struct Row {
        name: &'static str,
        bytes: &'static [u8],
        text: &'static str,
        bom: bool,
        encoding: &'static str,
        eol: &'static str,
        mixed: bool,
        final_newline: bool,
        tabs: bool,
        width: u64,
        saved: &'static [u8],
    }

    const ROUND_TRIP: &[Row] = &[
        Row {
            name: "lf.html",
            bytes: b"<p>a</p>\n<p>b</p>\n",
            text: "<p>a</p>\n<p>b</p>\n",
            bom: false, encoding: "utf8", eol: "lf", mixed: false, final_newline: true,
            tabs: false, width: 2,
            saved: b"<p>a</p>\n<p>b</p>\n",
        },
        Row {
            name: "crlf.html",
            bytes: b"<ul>\r\n  <li>x</li>\r\n</ul>\r\n",
            text: "<ul>\r\n  <li>x</li>\r\n</ul>\r\n",
            bom: false, encoding: "utf8", eol: "crlf", mixed: false, final_newline: true,
            tabs: false, width: 2,
            saved: b"<ul>\r\n  <li>x</li>\r\n</ul>\r\n",
        },
        Row {
            name: "cr.txt",
            bytes: b"a\rb\rc",
            text: "a\rb\rc",
            bom: false, encoding: "utf8", eol: "cr", mixed: false, final_newline: false,
            tabs: false, width: 4,
            saved: b"a\rb\rc",
        },
        Row {
            name: "mixed.txt",
            bytes: b"one\r\ntwo\r\nthree\nfour\r\n",
            text: "one\r\ntwo\r\nthree\nfour\r\n",
            bom: false, encoding: "utf8", eol: "crlf", mixed: true, final_newline: true,
            tabs: false, width: 4,
            saved: b"one\r\ntwo\r\nthree\r\nfour\r\n",
        },
        Row {
            name: "bom.css",
            bytes: b"\xEF\xBB\xBFp { color: red; }\r\n",
            text: "p { color: red; }\r\n",
            bom: true, encoding: "utf8", eol: "crlf", mixed: false, final_newline: true,
            tabs: false, width: 2,
            saved: b"\xEF\xBB\xBFp { color: red; }\r\n",
        },
        Row {
            name: "le.ps1",
            bytes: b"\xFF\xFE<\x00p\x00>\x00\xE4\x00<\x00/\x00p\x00>\x00=\xD8\x00\xDE\r\x00\n\x00",
            text: "<p>\u{e4}</p>\u{1f600}\r\n",
            bom: true, encoding: "utf16le", eol: "crlf", mixed: false, final_newline: true,
            tabs: false, width: 4,
            saved: b"\xFF\xFE<\x00p\x00>\x00\xE4\x00<\x00/\x00p\x00>\x00=\xD8\x00\xDE\r\x00\n\x00",
        },
        Row {
            name: "be.txt",
            bytes: b"\xFE\xFF\x00a\x00\n\x00\xE4",
            text: "a\n\u{e4}",
            bom: true, encoding: "utf16be", eol: "lf", mixed: false, final_newline: false,
            tabs: false, width: 4,
            saved: b"\xFE\xFF\x00a\x00\n\x00\xE4",
        },
        Row {
            name: "only-bom.html",
            bytes: b"\xEF\xBB\xBF",
            text: "",
            bom: true, encoding: "utf8", eol: "lf", mixed: false, final_newline: false,
            tabs: false, width: 2,
            saved: b"\xEF\xBB\xBF",
        },
        Row {
            name: "only-bom-le.txt",
            bytes: b"\xFF\xFE",
            text: "",
            bom: true, encoding: "utf16le", eol: "lf", mixed: false, final_newline: false,
            tabs: false, width: 4,
            saved: b"\xFF\xFE",
        },
        Row {
            name: "tabs.css",
            bytes: b"div {\n\tcolor: red;\n\tmargin: 0;\n}\n",
            text: "div {\n\tcolor: red;\n\tmargin: 0;\n}\n",
            bom: false, encoding: "utf8", eol: "lf", mixed: false, final_newline: true,
            tabs: true, width: 2,
            saved: b"div {\n\tcolor: red;\n\tmargin: 0;\n}\n",
        },
        Row {
            name: "four.py",
            bytes: b"def f():\n    if x:\n        return 1\n    return 2\n",
            text: "def f():\n    if x:\n        return 1\n    return 2\n",
            bom: false, encoding: "utf8", eol: "lf", mixed: false, final_newline: true,
            tabs: false, width: 4,
            saved: b"def f():\n    if x:\n        return 1\n    return 2\n",
        },
        Row {
            name: "four.html",
            bytes: b"<ul>\n    <li>x</li>\n</ul>\n",
            text: "<ul>\n    <li>x</li>\n</ul>\n",
            bom: false, encoding: "utf8", eol: "lf", mixed: false, final_newline: true,
            tabs: false, width: 4,
            saved: b"<ul>\n    <li>x</li>\n</ul>\n",
        },
        Row {
            name: "no-final.html",
            bytes: b"<p>x</p>\r\n<p>y</p>",
            text: "<p>x</p>\r\n<p>y</p>",
            bom: false, encoding: "utf8", eol: "crlf", mixed: false, final_newline: false,
            tabs: false, width: 2,
            saved: b"<p>x</p>\r\n<p>y</p>",
        },
    ];

    // What CodeMirror hands back: every line break becomes LF.
    fn as_the_editor_sends(text: &str) -> String {
        text.replace("\r\n", "\n").replace('\r', "\n")
    }

    fn style_strings(result: &ReadResult) -> (bool, String, String) {
        let style = serde_json::to_value(result.style.unwrap()).unwrap();
        (
            style["bom"].as_bool().unwrap(),
            style["encoding"].as_str().unwrap().to_string(),
            style["eol"].as_str().unwrap().to_string(),
        )
    }

    #[test]
    fn every_style_reads_and_saves_back_byte_for_byte() {
        let (_dir, folder) = real_tempdir();
        for row in ROUND_TRIP {
            let path = folder.join(row.name);
            fs::write(&path, row.bytes).unwrap();
            let read = read_single(&path);
            assert_eq!(read.error, None, "{}", row.name);
            assert_eq!(read.text.as_deref(), Some(row.text), "{}", row.name);
            let style = serde_json::to_value(read.style.unwrap()).unwrap();
            assert_eq!(style["bom"], row.bom, "{}", row.name);
            assert_eq!(style["encoding"], row.encoding, "{}", row.name);
            assert_eq!(style["eol"], row.eol, "{}", row.name);
            assert_eq!(style["mixedEol"], row.mixed, "{}", row.name);
            assert_eq!(style["finalNewline"], row.final_newline, "{}", row.name);
            assert_eq!(style["indent"]["tabs"], row.tabs, "{}", row.name);
            assert_eq!(style["indent"]["width"], row.width, "{}", row.name);

            let (bom, encoding, eol) = style_strings(&read);
            let results = write_files(&[WriteFile {
                path: read.path.clone(),
                text: as_the_editor_sends(row.text),
                bom,
                encoding,
                eol,
                ..WriteFile::default()
            }]);
            assert!(results[0].ok, "{} {:?}", row.name, results[0].error);
            assert_eq!(fs::read(&path).unwrap(), row.saved, "{}", row.name);
        }
    }

    #[test]
    fn read_result_serializes_its_style_and_null_without_text() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("a.html"), "\u{feff}<p>\r\n").unwrap();
        let value = serde_json::to_value(read_single(&folder.join("a.html"))).unwrap();
        assert_eq!(
            value["style"],
            serde_json::json!({
                "bom": true,
                "encoding": "utf8",
                "eol": "crlf",
                "mixedEol": false,
                "finalNewline": true,
                "indent": { "tabs": false, "width": 2 }
            })
        );
        let value = serde_json::to_value(read_single(&folder.join("gone.html"))).unwrap();
        assert!(value["style"].is_null());
        assert!(value["text"].is_null());
    }

    #[test]
    fn utf16_edge_cases_are_other_encoding_or_not_text() {
        let (_dir, folder) = real_tempdir();
        let cases: &[(&str, &[u8], &str)] = &[
            ("odd length", b"\xFF\xFEa\x00b", "other_encoding"),
            ("odd length be", b"\xFE\xFF\x00a\x00", "other_encoding"),
            ("lone high surrogate", b"\xFF\xFE=\xD8a\x00", "other_encoding"),
            ("lone low surrogate", b"\xFF\xFE\x00\xDE", "other_encoding"),
            ("high surrogate at the end", b"\xFF\xFEa\x00=\xD8", "other_encoding"),
            ("be lone high surrogate", b"\xFE\xFF\xD8=\x00a", "other_encoding"),
            ("utf-16 text with U+0000", b"\xFF\xFEa\x00\x00\x00b\x00", "not_text"),
            ("utf-32 le bom", b"\xFF\xFE\x00\x00a\x00\x00\x00", "not_text"),
            ("utf-32 be bom", b"\x00\x00\xFE\xFF\x00\x00\x00a", "not_text"),
            ("invalid utf-8", b"a\xFFb", "other_encoding"),
            ("latin-1", b"p\xE4iv\xE4", "other_encoding"),
            ("cut utf-8", b"abc\xC3", "other_encoding"),
            ("nul without a utf-16 bom", b"a\x00b\x00", "not_text"),
        ];
        for (what, bytes, code) in cases {
            let path = folder.join("x.txt");
            fs::write(&path, bytes).unwrap();
            let result = read_single(&path);
            assert_eq!(result.error.as_deref(), Some(*code), "{what}");
            assert_eq!(result.text, None, "{what}");
            assert_eq!(result.style, None, "{what}");
        }
    }

    #[test]
    fn a_utf16_file_over_5_mb_is_still_too_big() {
        let (_dir, folder) = real_tempdir();
        let path = folder.join("big.txt");
        let mut bytes = b"\xFF\xFE".to_vec();
        bytes.resize(5 * 1024 * 1024 + 2, b'a');
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_single(&path).error.as_deref(), Some("too_big"));
    }

    #[test]
    fn line_endings_count_and_ties_go_to_lf() {
        let eol = |text: &str| detect_style(text, false, Encoding::Utf8, true);
        let cases: &[(&str, Eol, bool, bool)] = &[
            ("", Eol::Lf, false, false),
            ("no break", Eol::Lf, false, false),
            ("a\nb\r\n", Eol::Lf, true, true),
            ("a\r\nb\r", Eol::Crlf, true, true),
            ("a\rb\r\nc\r", Eol::Cr, true, true),
            ("a\r\n\r\nb", Eol::Crlf, false, false),
            ("a\n\rb", Eol::Lf, true, false),
            ("\r", Eol::Cr, false, true),
        ];
        for (text, want, mixed, final_newline) in cases {
            let style = eol(text);
            assert_eq!(style.eol, *want, "{text:?}");
            assert_eq!(style.mixed_eol, *mixed, "{text:?}");
            assert_eq!(style.final_newline, *final_newline, "{text:?}");
        }
    }

    #[test]
    fn indent_follows_most_indented_lines() {
        let indent = |text: &str, teaching: bool| detect_style(text, false, Encoding::Utf8, teaching).indent;
        let spaces = |width| Indent { tabs: false, width };
        let tabs = |width| Indent { tabs: true, width };
        assert_eq!(indent("", true), spaces(2));
        assert_eq!(indent("a\nb\n", false), spaces(4));
        assert_eq!(indent("a\n\tb\n\tc\n  d\n", true), tabs(2));
        assert_eq!(indent("a\n\tb\n\tc\n  d\n", false), tabs(4));
        assert_eq!(indent("a\n\tb\n  c\n  d\n", false), spaces(2));
        assert_eq!(indent("a\n\tb\n  c\n", false), spaces(2));
        assert_eq!(indent("a\n   b\n      c\n   d\n", true), spaces(3));
        assert_eq!(indent("a\n        b\n", true), spaces(8));
        assert_eq!(indent("a\n            b\n", true), spaces(2));
        assert_eq!(indent("/**\n * a\n * b\n */\nf() {\n    x\n}\n", false), spaces(4));
        assert_eq!(indent("a\r\n  b\r\n    c\r\n", false), spaces(2));
        assert_eq!(indent("a\n  \n\t\n  b\n", true), spaces(2));
    }

    #[test]
    fn encode_text_writes_the_ending_the_encoding_and_the_bom() {
        let cases: &[(&str, bool, &str, &str, &[u8])] = &[
            ("a\nb\n", false, "", "", b"a\nb\n"),
            ("a\nb\n", false, "utf8", "lf", b"a\nb\n"),
            ("a\nb\n", false, "utf8", "crlf", b"a\r\nb\r\n"),
            ("a\nb\n", false, "utf8", "cr", b"a\rb\r"),
            ("a\r\nb", false, "utf8", "crlf", b"a\r\nb"),
            ("a\r\nb", false, "utf8", "cr", b"a\rb"),
            ("a\r\nb", false, "utf8", "lf", b"a\r\nb"),
            ("\u{e4}\n", true, "utf8", "lf", b"\xEF\xBB\xBF\xC3\xA4\n"),
            ("", true, "utf8", "crlf", b"\xEF\xBB\xBF"),
            ("", false, "utf8", "crlf", b""),
            ("\u{e4}\n", true, "utf16le", "crlf", b"\xFF\xFE\xE4\x00\r\x00\n\x00"),
            ("\u{e4}\n", false, "utf16le", "lf", b"\xFF\xFE\xE4\x00\n\x00"),
            ("\u{1f600}", true, "utf16be", "lf", b"\xFE\xFF\xD8\x3D\xDE\x00"),
            ("", true, "utf16be", "lf", b"\xFE\xFF"),
        ];
        for (text, bom, encoding, eol, want) in cases {
            assert_eq!(
                encode_text(text, *bom, encoding, eol).unwrap(),
                want.to_vec(),
                "{text:?} {bom} {encoding} {eol}"
            );
        }
    }

    #[test]
    fn encode_text_refuses_an_unknown_encoding_or_ending() {
        for (encoding, eol) in [
            ("latin1", "lf"),
            ("UTF8", "lf"),
            ("utf-8", "lf"),
            ("utf32", "lf"),
            ("utf8", "LF"),
            ("utf8", "mixed"),
            ("utf8", "\n"),
        ] {
            assert_eq!(
                encode_text("x", false, encoding, eol),
                Err("cannot_write"),
                "{encoding} {eol}"
            );
        }
    }

    #[test]
    fn write_files_refuses_only_the_file_with_an_unknown_style() {
        let (_dir, folder) = real_tempdir();
        let old = folder.join("old.txt");
        fs::write(&old, b"his\r\n").unwrap();
        let results = write_files(&[
            WriteFile {
                path: s(&old),
                text: "new\n".to_string(),
                eol: "mixed".to_string(),
                ..WriteFile::default()
            },
            WriteFile {
                path: s(&folder.join("made.txt")),
                text: "x".to_string(),
                must_not_exist: true,
                encoding: "latin1".to_string(),
                ..WriteFile::default()
            },
            WriteFile {
                path: s(&folder.join("good.txt")),
                text: "a\nb\n".to_string(),
                eol: "crlf".to_string(),
                bom: true,
                encoding: "utf8".to_string(),
                ..WriteFile::default()
            },
        ]);
        assert_eq!(results[0].error.as_deref(), Some("cannot_write"));
        assert!(!results[0].ok);
        assert_eq!(results[1].error.as_deref(), Some("cannot_write"));
        assert!(results[2].ok);
        assert_eq!(fs::read(&old).unwrap(), b"his\r\n");
        assert!(!folder.join("made.txt").exists());
        assert_eq!(fs::read(folder.join("good.txt")).unwrap(), b"\xEF\xBB\xBFa\r\nb\r\n");
        assert_eq!(listing(&folder), ["good.txt", "old.txt"]);
    }

    #[test]
    fn write_file_and_named_file_accept_a_style_or_none() {
        let file: WriteFile = serde_json::from_str(
            r#"{ "path": "/a", "text": "b", "mustNotExist": true, "bom": true, "encoding": "utf16le", "eol": "crlf" }"#,
        )
        .unwrap();
        assert!(file.bom && file.must_not_exist);
        assert_eq!((file.encoding.as_str(), file.eol.as_str()), ("utf16le", "crlf"));
        let file: WriteFile = serde_json::from_str(r#"{ "path": "/a", "text": "b" }"#).unwrap();
        assert!(!file.bom);
        assert_eq!((file.encoding.as_str(), file.eol.as_str()), ("", ""));

        let file: NamedFile = serde_json::from_str(
            r#"{ "name": "a.txt", "text": "x", "picture": false, "bom": true, "encoding": "utf16be", "eol": "cr" }"#,
        )
        .unwrap();
        assert!(file.bom && !file.picture);
        assert_eq!((file.encoding.as_str(), file.eol.as_str()), ("utf16be", "cr"));
        let file: NamedFile = serde_json::from_str(r#"{ "name": "a.txt" }"#).unwrap();
        assert!(!file.bom);
        assert_eq!((file.text.as_str(), file.encoding.as_str(), file.eol.as_str()), ("", "", ""));
    }

    #[test]
    fn save_project_writes_each_file_in_its_own_style() {
        let (_dir, parent) = real_tempdir();
        let styled = |name: &str, text: &str, bom, encoding: &str, eol: &str| NamedFile {
            name: name.to_string(),
            text: text.to_string(),
            bom,
            encoding: encoding.to_string(),
            eol: eol.to_string(),
            ..NamedFile::default()
        };
        save_project(
            &s(&parent),
            "P",
            &[
                named("plain.html", "<p>x</p>\n"),
                styled("dos.css", "a {}\nb {}\n", true, "utf8", "crlf"),
                styled("wide.txt", "\u{e4}\n", true, "utf16le", "lf"),
            ],
        )
        .unwrap();
        let folder = parent.join("P");
        assert_eq!(fs::read(folder.join("plain.html")).unwrap(), b"<p>x</p>\n");
        assert_eq!(fs::read(folder.join("dos.css")).unwrap(), b"\xEF\xBB\xBFa {}\r\nb {}\r\n");
        assert_eq!(fs::read(folder.join("wide.txt")).unwrap(), b"\xFF\xFE\xE4\x00\n\x00");

        let error = save_project(
            &s(&parent),
            "Q",
            &[named("a.html", "x"), styled("b.txt", "y", false, "ascii", "lf")],
        )
        .unwrap_err();
        assert_eq!(error, "cannot_write");
        assert_eq!(listing(&parent), ["P"]);
    }

    #[test]
    fn save_copy_keeps_a_crlf_bom_file_and_a_utf16_file_byte_for_byte() {
        let (_dir, parent) = real_tempdir();
        let old = parent.join("old");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("page.html"), b"\xEF\xBB\xBF<p>a</p>\r\n<p>b</p>\r\n").unwrap();
        fs::write(old.join("notes.txt"), b"\xFF\xFEh\x00i\x00\n\x00\xE4\x00").unwrap();
        fs::write(old.join("untouched.txt"), b"x\r\ny").unwrap();

        let reads = read_files(&[s(&old.join("page.html")), s(&old.join("notes.txt"))]);
        let typed = ["<p>ab</p>\r\n<p>b</p>\r\n", "hi!\n\u{e4}"];
        let tabs: Vec<NamedFile> = reads
            .iter()
            .zip(typed)
            .map(|(read, text)| {
                let (bom, encoding, eol) = style_strings(read);
                NamedFile {
                    name: read.name.clone(),
                    text: as_the_editor_sends(text),
                    bom,
                    encoding,
                    eol,
                    ..NamedFile::default()
                }
            })
            .collect();
        save_copy(&s(&old), &s(&parent), "copy", &tabs).unwrap();
        let new = parent.join("copy");
        assert_eq!(
            fs::read(new.join("page.html")).unwrap(),
            b"\xEF\xBB\xBF<p>ab</p>\r\n<p>b</p>\r\n"
        );
        assert_eq!(
            fs::read(new.join("notes.txt")).unwrap(),
            b"\xFF\xFEh\x00i\x00!\x00\n\x00\xE4\x00"
        );
        assert_eq!(fs::read(new.join("untouched.txt")).unwrap(), b"x\r\ny");

        let mut bad = tabs.clone();
        bad[1].eol = "unix".to_string();
        let error = save_copy(&s(&old), &s(&parent), "copy2", &bad).unwrap_err();
        assert_eq!(error, "cannot_write");
        assert!(!parent.join("copy2").exists());
    }

    #[test]
    fn stamp_stats_at_most_2000_entries_in_all() {
        let (_dir, folder) = real_tempdir();
        let sub = folder.join("sub");
        fs::create_dir(&sub).unwrap();
        for n in 0..10 {
            fs::write(folder.join(format!("f{n}.txt")), "").unwrap();
        }
        for n in 0..2500 {
            fs::write(sub.join(format!("e{n:05}.dat")), "").unwrap();
        }
        crate::counts::local_counts(true);
        assert!(folder_stamp(&s(&folder), None) > 0);
        let used = crate::counts::local_counts(true);
        assert_eq!(used.stats, MAX_STAMP_STATS as u64);
        assert_eq!(used.read_dirs, 2);
    }

    #[test]
    fn stamp_skips_node_modules_and_dot_folders() {
        let (_dir, folder) = real_tempdir();
        fs::write(folder.join("a.html"), "x").unwrap();
        fs::write(folder.join(".htaccess"), "x").unwrap();
        let sub = folder.join("css");
        let skipped = [
            folder.join("node_modules"),
            folder.join(".git"),
            sub.join("node_modules"),
            sub.join(".cache"),
        ];
        for dir in &skipped {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("inside.txt"), "x").unwrap();
        }
        let old = an_hour_ago();
        for path in [folder.join("a.html"), folder.join(".htaccess"), sub.clone(), folder.clone()] {
            set_mtime(&path, old);
        }
        crate::counts::local_counts(true);
        let before = folder_stamp(&s(&folder), None);
        let used = crate::counts::local_counts(true);
        assert_eq!(used.read_dirs, 2);
        assert_eq!(used.stats, 4, "the folder, a.html, .htaccess and css");

        let future = SystemTime::now() + Duration::from_secs(3600);
        for dir in &skipped {
            set_mtime(&dir.join("inside.txt"), future);
            set_mtime(dir, future);
        }
        set_mtime(&sub, old);
        set_mtime(&folder, old);
        assert_eq!(folder_stamp(&s(&folder), None), before);

        set_mtime(&folder.join(".htaccess"), future);
        assert!(folder_stamp(&s(&folder), None) > before);
    }

    #[test]
    fn stamp_of_given_files_looks_at_nothing_else() {
        let (_dir, folder) = real_tempdir();
        let mine = folder.join("notes.txt");
        let other = folder.join("other.txt");
        fs::write(&mine, "x").unwrap();
        fs::write(&other, "x").unwrap();
        let old = an_hour_ago();
        set_mtime(&mine, old);
        set_mtime(&other, old);
        let files = [s(&mine), s(&folder.join("gone.txt"))];
        crate::counts::local_counts(true);
        let stamp = folder_stamp(&s(&folder), Some(&files));
        let used = crate::counts::local_counts(true);
        assert_eq!(stamp, millis(fs::metadata(&mine).unwrap().modified()));
        assert_eq!(used.read_dirs, 0);
        assert_eq!(used.entries_read, 0);
        assert_eq!(used.stats, 2);

        let future = SystemTime::now() + Duration::from_secs(3600);
        set_mtime(&other, future);
        set_mtime(&folder, future);
        assert_eq!(folder_stamp(&s(&folder), Some(&files)), stamp);
        set_mtime(&mine, future);
        assert!(folder_stamp(&s(&folder), Some(&files)) > stamp);

        assert_eq!(folder_stamp(&s(&folder), Some(&[s(&folder.join("gone.txt"))])), 0);
        assert_eq!(folder_stamp(&s(&folder), Some(&[])), folder_stamp(&s(&folder), None));
    }

    #[test]
    fn the_preview_decoder_is_the_reader() {
        assert_eq!(
            decode_text(b"\xFF\xFE<\x00p\x00>\x00\xE4\x00").unwrap(),
            Decoded {
                text: "<p>\u{e4}".to_string(),
                bom: true,
                encoding: Encoding::Utf16le
            }
        );
        assert_eq!(
            decode_text(b"\xEF\xBB\xBFa\r\n").unwrap(),
            Decoded {
                text: "a\r\n".to_string(),
                bom: true,
                encoding: Encoding::Utf8
            }
        );
        assert_eq!(decode_text(b"\x89PNG\r\n\x1a\n\x00"), Err("not_text"));
    }

    // ----- Change Name: rename_file (C44) -----

    fn no_hook() {}

    fn real_link(a: &Path, b: &Path) -> io::Result<()> {
        fs::hard_link(a, b)
    }

    fn rename_with(
        from: &Path,
        to: &Path,
        after_check: &dyn Fn(),
        exclusive: &dyn Fn(&Path, &Path) -> io::Result<()>,
        link: &dyn Fn(&Path, &Path) -> io::Result<()>,
    ) -> Result<String, &'static str> {
        let ops = RenameOps {
            after_check,
            exclusive,
            link,
        };
        rename_file_with(from, to, &ops)
    }

    fn case_insensitive_disk(folder: &Path) -> bool {
        let probe = folder.join("probe-case.txt");
        fs::write(&probe, b"x").unwrap();
        let folds = folder.join("PROBE-CASE.TXT").symlink_metadata().is_ok();
        fs::remove_file(probe).unwrap();
        folds
    }

    #[test]
    fn rename_moves_the_file_and_returns_the_new_path() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"hello\n").unwrap();
        let got = rename_file(&s(&real.join("a.txt")), &s(&real.join("b.txt"))).unwrap();
        assert_eq!(got, s(&real.join("b.txt")));
        assert_eq!(listing(&real), ["b.txt"]);
        assert_eq!(fs::read(real.join("b.txt")).unwrap(), b"hello\n");
    }

    #[test]
    fn rename_returns_the_real_folder_and_the_name_as_typed() {
        let dir = tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        fs::create_dir(real.join("sub")).unwrap();
        fs::write(real.join("sub/a.txt"), b"x").unwrap();
        // Given through "sub/../sub", answered with the real folder.
        let from = dir.path().join("sub/../sub/a.txt");
        let got = rename_file(&s(&from), &s(&dir.path().join("sub/Ünï.txt"))).unwrap();
        assert_eq!(got, s(&real.join("sub/Ünï.txt")));
    }

    #[test]
    fn rename_never_replaces_an_existing_file() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        fs::write(real.join("b.txt"), b"keep me").unwrap();
        let got = rename_file(&s(&real.join("a.txt")), &s(&real.join("b.txt")));
        assert_eq!(got, Err("file_exists".to_string()));
        assert_eq!(fs::read(real.join("a.txt")).unwrap(), b"mine");
        assert_eq!(fs::read(real.join("b.txt")).unwrap(), b"keep me");
    }

    #[test]
    fn rename_to_a_name_taken_in_another_case_is_file_exists() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        fs::write(real.join("Notes.txt"), b"keep me").unwrap();
        let got = rename_file(&s(&real.join("a.txt")), &s(&real.join("notes.txt")));
        if case_insensitive_disk(&real) {
            assert_eq!(got, Err("file_exists".to_string()));
            assert_eq!(listing(&real), ["Notes.txt", "a.txt"]);
        } else {
            assert!(got.is_ok());
        }
        assert_eq!(fs::read(real.join("Notes.txt")).unwrap(), b"keep me");
    }

    #[cfg(unix)]
    #[test]
    fn rename_onto_a_hard_link_to_the_same_file_is_file_exists() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"one file").unwrap();
        fs::hard_link(real.join("a.txt"), real.join("b.txt")).unwrap();
        let got = rename_file(&s(&real.join("a.txt")), &s(&real.join("b.txt")));
        assert_eq!(got, Err("file_exists".to_string()));
        assert_eq!(listing(&real), ["a.txt", "b.txt"]);
    }

    #[cfg(unix)]
    #[test]
    fn rename_onto_a_symlink_or_a_folder_is_file_exists() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        std::os::unix::fs::symlink("nowhere", real.join("dangling.txt")).unwrap();
        fs::create_dir(real.join("folder.txt")).unwrap();
        for taken in ["dangling.txt", "folder.txt"] {
            let got = rename_file(&s(&real.join("a.txt")), &s(&real.join(taken)));
            assert_eq!(got, Err("file_exists".to_string()), "{taken}");
        }
        assert_eq!(fs::read(real.join("a.txt")).unwrap(), b"mine");
    }

    #[test]
    fn a_case_only_rename_changes_the_case_and_leaves_no_temp() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("notes.txt"), b"my notes\n").unwrap();
        let got = rename_file(&s(&real.join("notes.txt")), &s(&real.join("Notes.txt"))).unwrap();
        assert_eq!(got, s(&real.join("Notes.txt")));
        assert_eq!(listing(&real), ["Notes.txt"]);
        assert_eq!(fs::read(real.join("Notes.txt")).unwrap(), b"my notes\n");
    }

    #[test]
    fn a_case_only_rename_onto_another_file_with_that_case_is_file_exists() {
        let (_dir, real) = real_tempdir();
        if case_insensitive_disk(&real) {
            return; // two such files cannot both exist here
        }
        fs::write(real.join("notes.txt"), b"mine").unwrap();
        fs::write(real.join("Notes.txt"), b"keep me").unwrap();
        let got = rename_file(&s(&real.join("notes.txt")), &s(&real.join("Notes.txt")));
        assert_eq!(got, Err("file_exists".to_string()));
        assert_eq!(listing(&real), ["Notes.txt", "notes.txt"]);
        assert_eq!(fs::read(real.join("Notes.txt")).unwrap(), b"keep me");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_second_step_puts_the_old_name_back() {
        use std::cell::Cell;
        for (code, wanted) in [(libc::EEXIST, "file_exists"), (libc::EIO, "cannot_write")] {
            let (_dir, real) = real_tempdir();
            fs::write(real.join("notes.txt"), b"my notes\n").unwrap();
            let calls = Cell::new(0);
            let exclusive = |a: &Path, b: &Path| {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    Err(io::Error::from_raw_os_error(code))
                } else {
                    rename_no_replace(a, b)
                }
            };
            let got = rename_with(
                &real.join("notes.txt"),
                &real.join("Notes.txt"),
                &no_hook,
                &exclusive,
                &real_link,
            );
            assert_eq!(got, Err(wanted));
            assert_eq!(calls.get(), 3, "temp, new name, back");
            assert_eq!(listing(&real), ["notes.txt"]);
            assert_eq!(fs::read(real.join("notes.txt")).unwrap(), b"my notes\n");
        }
    }

    #[test]
    fn a_file_made_between_the_check_and_the_rename_is_not_replaced() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        let target = real.join("b.txt");
        let sneak = || fs::write(&target, b"theirs").unwrap();
        let got = rename_with(&real.join("a.txt"), &target, &sneak, &rename_no_replace, &real_link);
        assert_eq!(got, Err("file_exists"));
        assert_eq!(fs::read(&target).unwrap(), b"theirs");
        assert_eq!(fs::read(real.join("a.txt")).unwrap(), b"mine");
    }

    #[cfg(unix)]
    #[test]
    fn without_an_exclusive_rename_a_hard_link_is_used() {
        use std::cell::Cell;
        for code in [libc::ENOTSUP, libc::EOPNOTSUPP, libc::EINVAL, libc::ENOSYS] {
            let (_dir, real) = real_tempdir();
            fs::write(real.join("a.txt"), b"mine").unwrap();
            let refuse = |_: &Path, _: &Path| Err(io::Error::from_raw_os_error(code));
            let links = Cell::new(0);
            let counted_link = |a: &Path, b: &Path| {
                links.set(links.get() + 1);
                fs::hard_link(a, b)
            };
            let got = rename_with(&real.join("a.txt"), &real.join("b.txt"), &no_hook, &refuse, &counted_link);
            assert_eq!(got, Ok(s(&real.join("b.txt"))), "{code}");
            assert_eq!(links.get(), 1, "{code}: the link was not used");
            assert_eq!(listing(&real), ["b.txt"], "{code}");
            assert_eq!(fs::read(real.join("b.txt")).unwrap(), b"mine");

            // The same race, through the fallback: the link sees the new file.
            fs::write(real.join("c.txt"), b"mine").unwrap();
            let target = real.join("d.txt");
            let sneak = || fs::write(&target, b"theirs").unwrap();
            let got = rename_with(&real.join("c.txt"), &target, &sneak, &refuse, &counted_link);
            assert_eq!(got, Err("file_exists"), "{code}");
            assert_eq!(links.get(), 2, "{code}: the link was not used");
            assert_eq!(fs::read(&target).unwrap(), b"theirs");
            assert_eq!(fs::read(real.join("c.txt")).unwrap(), b"mine");
        }
    }

    #[cfg(unix)]
    #[test]
    fn without_links_either_a_check_then_rename_is_used() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        let refuse = |_: &Path, _: &Path| Err(io::Error::from_raw_os_error(libc::ENOTSUP));
        let no_links = |_: &Path, _: &Path| Err(io::Error::from_raw_os_error(libc::EPERM));
        let got = rename_with(&real.join("a.txt"), &real.join("b.txt"), &no_hook, &refuse, &no_links);
        assert_eq!(got, Ok(s(&real.join("b.txt"))));
        assert_eq!(listing(&real), ["b.txt"]);

        // A file made before that last check is still seen.
        fs::write(real.join("c.txt"), b"mine").unwrap();
        let target = real.join("d.txt");
        let sneak = || fs::write(&target, b"theirs").unwrap();
        let got = rename_with(&real.join("c.txt"), &target, &sneak, &refuse, &no_links);
        assert_eq!(got, Err("file_exists"));
        assert_eq!(fs::read(&target).unwrap(), b"theirs");

        // A case-only rename works through both fallbacks too.
        let got = rename_with(&real.join("b.txt"), &real.join("B.txt"), &no_hook, &refuse, &no_links);
        assert_eq!(got, Ok(s(&real.join("B.txt"))));
        assert!(listing(&real).contains(&"B.txt".to_string()));
        assert!(!listing(&real).iter().any(|n| n.ends_with(".htmllab-rename")));
    }

    #[test]
    fn rename_refuses_another_folder_a_folder_and_a_missing_file() {
        let (_dir, real) = real_tempdir();
        fs::create_dir(real.join("sub")).unwrap();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        let to_sub = rename_file(&s(&real.join("a.txt")), &s(&real.join("sub/a.txt")));
        assert_eq!(to_sub, Err("cannot_write".to_string()));
        let folder = rename_file(&s(&real.join("sub")), &s(&real.join("sub2")));
        assert_eq!(folder, Err("cannot_write".to_string()));
        let gone = rename_file(&s(&real.join("gone.txt")), &s(&real.join("b.txt")));
        assert_eq!(gone, Err("not_found".to_string()));
        let gone_folder = rename_file(&s(&real.join("nope/a.txt")), &s(&real.join("nope/b.txt")));
        assert_eq!(gone_folder, Err("not_found".to_string()));
        assert_eq!(listing(&real), ["a.txt", "sub"]);
        assert_eq!(listing(&real.join("sub")), Vec::<String>::new());
    }

    #[test]
    fn rename_to_the_same_name_changes_nothing() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.txt"), b"mine").unwrap();
        let got = rename_file(&s(&real.join("a.txt")), &s(&real.join("a.txt")));
        assert_eq!(got, Ok(s(&real.join("a.txt"))));
        assert_eq!(listing(&real), ["a.txt"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_nfd_name_to_its_nfc_form_is_a_case_only_rename_on_macos() {
        use unicode_normalization::UnicodeNormalization;
        let (_dir, real) = real_tempdir();
        let nfd = "pa\u{308}iva\u{308}.txt";
        let nfc = "p\u{e4}iv\u{e4}.txt";
        fs::write(real.join(nfd), b"x").unwrap();
        let got = rename_file(&s(&real.join(nfd)), &s(&real.join(nfc))).unwrap();
        assert_eq!(got, s(&real.join(nfc)));
        let names = listing(&real);
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].nfc().collect::<String>(), nfc);
        assert_eq!(fs::read(real.join(nfc)).unwrap(), b"x");
    }

    // ----- Change Name: rewrite_references (C45) -----

    // "ä😀\n<link href=\"a.css\">ä\n" in each style, before and after a.css becomes bb.css.
    // Every byte is written out by hand.
    const LF_BEFORE: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"a.css\">\xC3\xA4\n";
    const LF_AFTER: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"bb.css\">\xC3\xA4\n";
    const CRLF_BEFORE: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\r\n<link href=\"a.css\">\xC3\xA4\r\n";
    const CRLF_AFTER: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\r\n<link href=\"bb.css\">\xC3\xA4\r\n";
    const BOM_BEFORE: &[u8] = b"\xEF\xBB\xBF\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"a.css\">\xC3\xA4\n";
    const BOM_AFTER: &[u8] = b"\xEF\xBB\xBF\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"bb.css\">\xC3\xA4\n";
    const LE_BEFORE: &[u8] = b"\xFF\xFE\xE4\x00\x3D\xD8\x00\xDE\n\x00<\x00l\x00i\x00n\x00k\x00 \x00h\x00r\x00e\x00f\x00=\x00\"\x00a\x00.\x00c\x00s\x00s\x00\"\x00>\x00\xE4\x00\n\x00";
    const LE_AFTER: &[u8] = b"\xFF\xFE\xE4\x00\x3D\xD8\x00\xDE\n\x00<\x00l\x00i\x00n\x00k\x00 \x00h\x00r\x00e\x00f\x00=\x00\"\x00b\x00b\x00.\x00c\x00s\x00s\x00\"\x00>\x00\xE4\x00\n\x00";
    const BE_BEFORE: &[u8] = b"\xFE\xFF\x00\xE4\xD8\x3D\xDE\x00\x00\n\x00<\x00l\x00i\x00n\x00k\x00 \x00h\x00r\x00e\x00f\x00=\x00\"\x00a\x00.\x00c\x00s\x00s\x00\"\x00>\x00\xE4\x00\n";
    const BE_AFTER: &[u8] = b"\xFE\xFF\x00\xE4\xD8\x3D\xDE\x00\x00\n\x00<\x00l\x00i\x00n\x00k\x00 \x00h\x00r\x00e\x00f\x00=\x00\"\x00b\x00b\x00.\x00c\x00s\x00s\x00\"\x00>\x00\xE4\x00\n";
    // Two CRLF and one LF: the lone LF stays, only the name changes.
    const MIXED_BEFORE: &[u8] = b"a\r\nb\n<link href=\"a.css\">\r\n";
    const MIXED_AFTER: &[u8] = b"a\r\nb\n<link href=\"bb.css\">\r\n";

    fn span(from: usize, to: usize, old: &str, new: &str) -> RewriteSpan {
        RewriteSpan {
            from,
            to,
            old_text: old.to_string(),
            new_text: new.to_string(),
        }
    }

    fn closed(path: &Path, raw: &[u8], spans: Vec<RewriteSpan>) -> RewriteFile {
        RewriteFile {
            path: s(path),
            size: raw.len() as u64,
            hash: crate::refs::content_hash(raw),
            spans,
            ..RewriteFile::default()
        }
    }

    fn style_cases() -> Vec<(&'static str, &'static [u8], &'static [u8], usize)> {
        // Byte offsets of "a.css" in the decoded text, counted by hand: "ä" 2, "😀" 4, the line
        // break 1 (2 with CR), "<link href=\"" 12.
        vec![
            ("lf.html", LF_BEFORE, LF_AFTER, 19),
            ("crlf.html", CRLF_BEFORE, CRLF_AFTER, 20),
            ("bom.html", BOM_BEFORE, BOM_AFTER, 19),
            ("le.html", LE_BEFORE, LE_AFTER, 19),
            ("be.html", BE_BEFORE, BE_AFTER, 19),
            ("mixed.html", MIXED_BEFORE, MIXED_AFTER, 17),
        ]
    }

    #[test]
    fn rewrite_changes_only_the_spans_in_every_style() {
        let (_dir, real) = real_tempdir();
        let mut plan = Vec::new();
        for (name, before, _, from) in style_cases() {
            fs::write(real.join(name), before).unwrap();
            plan.push(closed(&real.join(name), before, vec![span(from, from + 5, "a.css", "bb.css")]));
        }
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert_eq!(results.len(), plan.len());
        for ((name, before, after, _), result) in style_cases().into_iter().zip(&results) {
            assert!(result.ok, "{name}: {:?}", result.error);
            assert_eq!(result.path, s(&real.join(name)));
            assert_eq!(fs::read(real.join(name)).unwrap(), after, "{name}");
            assert_eq!(result.size, Some(after.len() as u64), "{name}");
            assert_eq!(result.hash.as_deref(), Some(crate::refs::content_hash(after).as_str()));
            assert_eq!(result.original.as_deref(), Some(before), "{name}");
            assert_eq!(result.text, None);
        }
    }

    #[test]
    fn the_plan_from_find_references_goes_straight_in() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("a.css"), b"p { color: red; }\n").unwrap();
        for (name, before, _, _) in style_cases() {
            fs::write(real.join(name), before).unwrap();
        }
        let found = crate::refs::find_references_with(&real, &real.join("a.css"), "bb.css", &[], true);
        assert_eq!(found.files.len(), style_cases().len());
        // The RefFile JSON the UI got back is the plan it sends.
        let json = serde_json::to_value(&found.files).unwrap();
        let plan: Vec<RewriteFile> = serde_json::from_value(json).unwrap();
        rename_file(&s(&real.join("a.css")), &s(&real.join("bb.css"))).unwrap();
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert!(results.iter().all(|r| r.ok), "{results:?}");
        for (name, _, after, _) in style_cases() {
            assert_eq!(fs::read(real.join(name)).unwrap(), after, "{name}");
        }
    }

    #[test]
    fn an_nfd_file_name_found_by_an_nfc_reference_is_renamed_and_rewritten() {
        let (_dir, real) = real_tempdir();
        fs::create_dir(real.join("kuvat")).unwrap();
        let nfd = "pa\u{308}iva\u{308}.png";
        fs::write(real.join("kuvat").join(nfd), b"\x89PNG").unwrap();
        // NFC "päivä" in the page, before and after, by hand.
        fs::write(real.join("index.html"), b"<img src=\"kuvat/p\xC3\xA4iv\xC3\xA4.png\">\n").unwrap();
        let target = real.join("kuvat").join(nfd);
        let found = crate::refs::find_references_with(&real, &target, "y\u{f6}.png", &[], true);
        let plan: Vec<RewriteFile> = serde_json::from_value(serde_json::to_value(&found.files).unwrap()).unwrap();
        assert_eq!(plan.len(), 1);
        rename_file(&s(&target), &s(&real.join("kuvat/y\u{f6}.png"))).unwrap();
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert!(results[0].ok, "{results:?}");
        assert_eq!(fs::read(real.join("index.html")).unwrap(), b"<img src=\"kuvat/y\xC3\xB6.png\">\n");
    }

    // The open tab's saved text, LF in the editor and CRLF on disk.
    const TAB_TEXT: &str = "\u{e4}\u{1F600}\n<link href=\"a.css\">\n";
    const TAB_DISK: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\r\n<link href=\"a.css\">\r\n";
    const TAB_DISK_AFTER: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\r\n<link href=\"bb.css\">\r\n";

    fn open_tab(path: &Path, spans: Vec<RewriteSpan>) -> RewriteFile {
        RewriteFile {
            path: s(path),
            open: true,
            size: TAB_TEXT.len() as u64,
            hash: crate::refs::content_hash(TAB_TEXT.as_bytes()),
            spans,
            text: Some(TAB_TEXT.to_string()),
            eol: "crlf".to_string(),
            encoding: "utf8".to_string(),
            bom: false,
        }
    }

    #[test]
    fn an_open_tab_uses_utf16_offsets_into_its_text_and_its_own_style() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("tab.html"), TAB_DISK).unwrap();
        // UTF-16 units: "ä" 1, "😀" 2, "\n" 1, "<link href=\"" 12.
        let plan = vec![open_tab(&real.join("tab.html"), vec![span(16, 21, "a.css", "bb.css")])];
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(fs::read(real.join("tab.html")).unwrap(), TAB_DISK_AFTER);
        assert_eq!(results[0].text.as_deref(), Some("\u{e4}\u{1F600}\n<link href=\"bb.css\">\n"));
        assert_eq!(results[0].hash.as_deref(), Some(crate::refs::content_hash(TAB_DISK_AFTER).as_str()));

        // Undo, as the UI would send it: the patched text, the fingerprint the result gave,
        // the spans the other way round.
        let back = RewriteFile {
            size: results[0].size.unwrap(),
            hash: results[0].hash.clone().unwrap(),
            text: results[0].text.clone(),
            spans: vec![span(16, 22, "bb.css", "a.css")],
            ..plan[0].clone()
        };
        let undone = rewrite_references(&[back], std::slice::from_ref(&real));
        assert!(undone[0].ok, "{:?}", undone[0].error);
        assert_eq!(fs::read(real.join("tab.html")).unwrap(), TAB_DISK);
    }

    // An open, never saved tab of a file with CR LF, LF and a lone CR. The editor holds LF only,
    // and the tab's style is the most-used ending (CR LF), as rename.js sends it.
    const MIXED_TAB_TEXT: &str = "\u{e4}\n<img src=\"cat.png\">\n<p>a</p>\n<a href=\"cat.png\">b</a>\n";
    const MIXED_TAB_DISK: &[u8] = b"\xC3\xA4\r\n<img src=\"cat.png\">\n<p>a</p>\r\n<a href=\"cat.png\">b</a>\r";
    const MIXED_TAB_AFTER: &[u8] = b"\xC3\xA4\r\n<img src=\"kitty.png\">\n<p>a</p>\r\n<a href=\"kitty.png\">b</a>\r";

    fn mixed_tab(path: &Path) -> RewriteFile {
        // UTF-16 offsets of each "cat.png" in the editor's text ("ä" is 1 unit, 2 bytes).
        let units = |at: usize| MIXED_TAB_TEXT[..at].encode_utf16().count();
        let spans = MIXED_TAB_TEXT
            .match_indices("cat.png")
            .map(|(at, _)| span(units(at), units(at) + 7, "cat.png", "kitty.png"))
            .collect();
        RewriteFile {
            path: s(path),
            open: true,
            size: MIXED_TAB_TEXT.len() as u64,
            hash: crate::refs::content_hash(MIXED_TAB_TEXT.as_bytes()),
            spans,
            text: Some(MIXED_TAB_TEXT.to_string()),
            eol: "crlf".to_string(),
            encoding: "utf8".to_string(),
            bom: false,
        }
    }

    #[test]
    fn an_open_tab_of_a_mixed_ending_file_changes_only_its_spans_and_keeps_every_ending() {
        let (_dir, real) = real_tempdir();
        let path = real.join("page.html");
        fs::write(&path, MIXED_TAB_DISK).unwrap();
        let plan = vec![mixed_tab(&path)];
        assert_eq!(plan[0].spans.iter().map(|x| x.from).collect::<Vec<_>>(), [12, 40]);
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(fs::read(&path).unwrap(), MIXED_TAB_AFTER);
        assert_eq!(
            results[0].text.as_deref(),
            Some("\u{e4}\n<img src=\"kitty.png\">\n<p>a</p>\n<a href=\"kitty.png\">b</a>\n")
        );
        assert_eq!(results[0].size, Some(MIXED_TAB_AFTER.len() as u64));
        assert_eq!(results[0].hash.as_deref(), Some(crate::refs::content_hash(MIXED_TAB_AFTER).as_str()));
        assert_eq!(results[0].original.as_deref(), Some(MIXED_TAB_DISK));

        // Undo puts the very same bytes back.
        let r = &results[0];
        restore_bytes(&s(&path), MIXED_TAB_DISK, r.size.unwrap(), r.hash.as_deref().unwrap(), std::slice::from_ref(&real)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), MIXED_TAB_DISK);

        // A mixed file whose text is not the tab's text, or whose BOM is not the tab's, is still
        // changed on disk and keeps its bytes.
        for other in [
            &b"\xC3\xA4\r\n<img src=\"cat.png\">\n<p>X</p>\r\n<a href=\"cat.png\">b</a>\r"[..],
            &b"\xEF\xBB\xBF\xC3\xA4\r\n<img src=\"cat.png\">\n<p>a</p>\r\n<a href=\"cat.png\">b</a>\r"[..],
        ] {
            fs::write(&path, other).unwrap();
            let results = rewrite_references(&plan, std::slice::from_ref(&real));
            assert_eq!(results[0].error.as_deref(), Some("changed_on_disk"));
            assert_eq!(fs::read(&path).unwrap(), other);
        }
    }

    #[test]
    fn an_open_tab_whose_disk_copy_is_not_its_saved_text_is_not_written() {
        let (_dir, real) = real_tempdir();
        let edited: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\r\n<link href=\"a.css\">\r\nmore\r\n";
        fs::write(real.join("tab.html"), edited).unwrap();
        let plan = vec![open_tab(&real.join("tab.html"), vec![span(16, 21, "a.css", "bb.css")])];
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert_eq!(results[0].error.as_deref(), Some("changed_on_disk"));
        assert_eq!(fs::read(real.join("tab.html")).unwrap(), edited);

        // Another text than the one planned.
        fs::write(real.join("tab.html"), TAB_DISK).unwrap();
        let mut other = open_tab(&real.join("tab.html"), vec![span(16, 21, "a.css", "bb.css")]);
        other.hash = crate::refs::content_hash(b"something else");
        let results = rewrite_references(&[other], std::slice::from_ref(&real));
        assert_eq!(results[0].error.as_deref(), Some("changed_on_disk"));

        // An open tab without its text.
        let mut bare = open_tab(&real.join("tab.html"), vec![span(16, 21, "a.css", "bb.css")]);
        bare.text = None;
        let results = rewrite_references(&[bare], std::slice::from_ref(&real));
        assert_eq!(results[0].error.as_deref(), Some("cannot_write"));
        assert_eq!(fs::read(real.join("tab.html")).unwrap(), TAB_DISK);
    }

    #[test]
    fn a_span_that_does_not_fit_writes_nothing() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("lf.html"), LF_BEFORE).unwrap();
        let path = real.join("lf.html");
        let bad = vec![
            // Old text not there.
            vec![span(19, 24, "b.css", "bb.css")],
            // Overlapping.
            vec![span(19, 24, "a.css", "x"), span(20, 22, ".c", "y")],
            // Past the end.
            vec![span(40, 45, "a.css", "bb.css")],
            // Inside the "😀" (bytes 2 to 6).
            vec![span(3, 5, "\u{1F600}", "x")],
            // From after to.
            vec![span(24, 19, "a.css", "bb.css")],
        ];
        for spans in bad {
            let results = rewrite_references(&[closed(&path, LF_BEFORE, spans.clone())], std::slice::from_ref(&real));
            assert_eq!(results[0].error.as_deref(), Some("cannot_write"), "{spans:?}");
            assert_eq!(fs::read(&path).unwrap(), LF_BEFORE);
        }
        // UTF-16 offset 2 is inside the pair of "😀" (units 1 to 3). Read as "after the pair",
        // 2 to 4 would hold the line break, so only the boundary check refuses it.
        fs::write(real.join("tab.html"), TAB_DISK).unwrap();
        let plan = vec![open_tab(&real.join("tab.html"), vec![span(2, 4, "\n", "y")])];
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert_eq!(results[0].error.as_deref(), Some("cannot_write"));
        assert_eq!(fs::read(real.join("tab.html")).unwrap(), TAB_DISK);
    }

    #[test]
    fn spans_in_any_order_are_all_put_in() {
        let (_dir, real) = real_tempdir();
        let before: &[u8] = b"<a href=\"a.css\"></a><a href=\"a.css\"></a>";
        let after: &[u8] = b"<a href=\"bb.css\"></a><a href=\"bb.css\"></a>";
        fs::write(real.join("two.html"), before).unwrap();
        let spans = vec![span(29, 34, "a.css", "bb.css"), span(9, 14, "a.css", "bb.css")];
        let results = rewrite_references(&[closed(&real.join("two.html"), before, spans)], std::slice::from_ref(&real));
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(fs::read(real.join("two.html")).unwrap(), after);
    }

    #[cfg(unix)]
    #[test]
    fn read_only_changed_symlinked_outside_and_missing_files_are_reported_and_not_written() {
        let (_dir, real) = real_tempdir();
        let (_other, outside) = real_tempdir();
        let one = vec![span(19, 24, "a.css", "bb.css")];
        for name in ["ro.html", "same-size.html", "other-size.html", "target.html", "good.html"] {
            fs::write(real.join(name), LF_BEFORE).unwrap();
        }
        fs::write(outside.join("out.html"), LF_BEFORE).unwrap();
        set_mode(&real.join("ro.html"), 0o444);
        std::os::unix::fs::symlink(real.join("target.html"), real.join("link.html")).unwrap();
        let plan = vec![
            closed(&real.join("ro.html"), LF_BEFORE, one.clone()),
            closed(&real.join("same-size.html"), LF_BEFORE, one.clone()),
            closed(&real.join("other-size.html"), LF_BEFORE, one.clone()),
            closed(&real.join("link.html"), LF_BEFORE, one.clone()),
            closed(&outside.join("out.html"), LF_BEFORE, one.clone()),
            closed(&real.join("gone.html"), LF_BEFORE, one.clone()),
            closed(&real.join("sub/../../x.html"), LF_BEFORE, one.clone()),
            closed(&real.join("good.html"), LF_BEFORE, one.clone()),
        ];
        // Changed after the plan: once with the same length, once longer.
        let same_size: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"a.css\">\xC3\xA4\r";
        fs::write(real.join("same-size.html"), same_size).unwrap();
        let longer: &[u8] = b"\xC3\xA4\xF0\x9F\x98\x80\n<link href=\"a.css\">\xC3\xA4\nmore\n";
        fs::write(real.join("other-size.html"), longer).unwrap();

        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        let codes: Vec<Option<&str>> = results.iter().map(|r| r.error.as_deref()).collect();
        assert_eq!(
            codes,
            [
                Some("read_only"),
                Some("changed_on_disk"),
                Some("changed_on_disk"),
                Some("cannot_write"),
                Some("cannot_write"),
                Some("cannot_write"),
                Some("cannot_write"),
                None,
            ]
        );
        assert!(results.iter().zip(&plan).all(|(r, p)| r.path == p.path));
        assert!(results[..7].iter().all(|r| !r.ok && r.size.is_none() && r.original.is_none()));
        assert_eq!(fs::read(real.join("ro.html")).unwrap(), LF_BEFORE);
        assert_eq!(mode_of(&real.join("ro.html")), 0o444);
        assert_eq!(fs::read(real.join("same-size.html")).unwrap(), same_size);
        assert_eq!(fs::read(real.join("other-size.html")).unwrap(), longer);
        assert_eq!(fs::read(real.join("target.html")).unwrap(), LF_BEFORE);
        assert!(real.join("link.html").symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read(outside.join("out.html")).unwrap(), LF_BEFORE);
        assert_eq!(fs::read(real.join("good.html")).unwrap(), LF_AFTER);
    }

    #[cfg(unix)]
    #[test]
    fn rewrite_keeps_the_file_permissions_and_leaves_no_temp() {
        let (_dir, real) = real_tempdir();
        fs::write(real.join("lf.html"), LF_BEFORE).unwrap();
        set_mode(&real.join("lf.html"), 0o640);
        let plan = vec![closed(&real.join("lf.html"), LF_BEFORE, vec![span(19, 24, "a.css", "bb.css")])];
        assert!(rewrite_references(&plan, std::slice::from_ref(&real))[0].ok);
        assert_eq!(mode_of(&real.join("lf.html")), 0o640);
        assert_eq!(listing(&real), ["lf.html"]);
    }

    #[test]
    fn a_file_with_no_spans_is_ok_and_not_written() {
        let (_dir, real) = real_tempdir();
        let path = real.join("lf.html");
        fs::write(&path, LF_BEFORE).unwrap();
        // An hour back, so a write would show in the date.
        set_mtime(&path, an_hour_ago());
        let set = fs::metadata(&path).unwrap().modified().unwrap();
        let plan = vec![closed(&path, LF_BEFORE, vec![])];
        let results = rewrite_references(&plan, std::slice::from_ref(&real));
        assert!(results[0].ok);
        assert_eq!(results[0].hash.as_deref(), Some(crate::refs::content_hash(LF_BEFORE).as_str()));
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), set);
    }

    #[test]
    fn restore_bytes_puts_the_original_back_only_over_what_was_written() {
        let (_dir, real) = real_tempdir();
        let path = real.join("crlf.html");
        fs::write(&path, CRLF_BEFORE).unwrap();
        let plan = vec![closed(&path, CRLF_BEFORE, vec![span(20, 25, "a.css", "bb.css")])];
        let result = rewrite_references(&plan, std::slice::from_ref(&real)).remove(0);
        let original = result.original.clone().unwrap();
        let (size, hash) = (result.size.unwrap(), result.hash.clone().unwrap());
        restore_bytes(&s(&path), &original, size, &hash, std::slice::from_ref(&real)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), CRLF_BEFORE);

        // Written again, then changed by someone else: the restore leaves their change.
        let result = rewrite_references(&plan, std::slice::from_ref(&real)).remove(0);
        let theirs: &[u8] = b"their own edit\r\n";
        fs::write(&path, theirs).unwrap();
        let got = restore_bytes(
            &s(&path),
            &original,
            result.size.unwrap(),
            result.hash.as_deref().unwrap(),
            std::slice::from_ref(&real),
        );
        assert_eq!(got, Err("changed_on_disk".to_string()));
        assert_eq!(fs::read(&path).unwrap(), theirs);

        // Outside the roots it is refused.
        let (_other, outside) = real_tempdir();
        let got = restore_bytes(&s(&path), &original, 16, &crate::refs::content_hash(theirs), &[outside]);
        assert_eq!(got, Err("cannot_write".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn check_restore_refuses_what_restore_bytes_would_refuse_and_writes_nothing() {
        let (_dir, real) = real_tempdir();
        let roots = std::slice::from_ref(&real);
        let path = real.join("crlf.html");
        fs::write(&path, CRLF_BEFORE).unwrap();
        let plan = vec![closed(&path, CRLF_BEFORE, vec![span(20, 25, "a.css", "bb.css")])];
        let result = rewrite_references(&plan, roots).remove(0);
        let (size, hash) = (result.size.unwrap(), result.hash.clone().unwrap());
        assert_eq!(check_restore(&s(&path), size, &hash, roots), Ok(()));
        assert_eq!(fs::read(&path).unwrap(), CRLF_AFTER);

        // Read-only after the change of name: the check says so, as the write would.
        set_mode(&path, 0o444);
        assert_eq!(check_restore(&s(&path), size, &hash, roots), Err("read_only".to_string()));
        assert_eq!(restore_bytes(&s(&path), CRLF_BEFORE, size, &hash, roots), Err("read_only".to_string()));
        assert_eq!(fs::read(&path).unwrap(), CRLF_AFTER);
        set_mode(&path, 0o644);

        // A symlink to the same bytes is not a plain file, and outside the roots is refused.
        fs::rename(&path, real.join("target.html")).unwrap();
        std::os::unix::fs::symlink(real.join("target.html"), &path).unwrap();
        assert_eq!(check_restore(&s(&path), size, &hash, roots), Err("cannot_write".to_string()));
        let (_other, outside) = real_tempdir();
        assert_eq!(check_restore(&s(&real.join("target.html")), size, &hash, &[outside]), Err("cannot_write".to_string()));

        // Changed by someone else.
        fs::write(real.join("target.html"), b"theirs").unwrap();
        assert_eq!(check_restore(&s(&real.join("target.html")), size, &hash, roots), Err("changed_on_disk".to_string()));
    }

    #[test]
    fn rewrite_shapes_are_camel_case_and_never_send_the_original() {
        let plan: Vec<RewriteFile> = serde_json::from_str(
            r#"[{"path":"/p/a.html","open":true,"size":3,"hash":"00ff","text":"abc",
                 "bom":true,"encoding":"utf16le","eol":"crlf",
                 "spans":[{"line":1,"from":0,"to":1,"oldText":"a","newText":"b",
                           "lineText":"abc","lineFrom":0,"lineTo":1}]},
                {"path":"/p/b.css","size":0,"hash":"","spans":[]}]"#,
        )
        .unwrap();
        assert_eq!(
            plan[0],
            RewriteFile {
                path: "/p/a.html".to_string(),
                open: true,
                size: 3,
                hash: "00ff".to_string(),
                spans: vec![span(0, 1, "a", "b")],
                text: Some("abc".to_string()),
                bom: true,
                encoding: "utf16le".to_string(),
                eol: "crlf".to_string(),
            }
        );
        assert!(!plan[1].open && plan[1].text.is_none() && plan[1].encoding.is_empty());
        let result = RewriteResult {
            path: "/p/a.html".to_string(),
            ok: true,
            error: None,
            size: Some(3),
            hash: Some("00ff".to_string()),
            text: Some("bbc".to_string()),
            original: Some(b"abc".to_vec()),
        };
        assert_eq!(
            serde_json::to_string(&result).unwrap(),
            r#"{"path":"/p/a.html","ok":true,"error":null,"size":3,"hash":"00ff","text":"bbc"}"#
        );
    }
}
