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
const TOO_BIG: &str = "too_big";
const CANNOT_READ: &str = "cannot_read";
const FILE_EXISTS: &str = "file_exists";
const FOLDER_GONE: &str = "folder_gone";
const FOLDER_EXISTS: &str = "folder_exists";
const CANNOT_WRITE: &str = "cannot_write";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub path: String,
    pub name: String,
    pub text: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFile {
    pub path: String,
    pub text: String,
    #[serde(default)]
    pub must_not_exist: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedFile {
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub picture: bool,
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
        Ok(real) => read_text(real),
        Err(_) => Err(CANNOT_READ),
    };
    let (text, error) = match read {
        Ok(text) => (Some(text), None),
        Err(code) => (None, Some(code.to_string())),
    };
    ReadResult {
        path: path_text(path),
        name,
        text,
        error,
    }
}

pub(crate) fn read_text(path: &Path) -> Result<String, &'static str> {
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
    if bytes.contains(&0) {
        return Err(NOT_TEXT);
    }
    let text = String::from_utf8(bytes).map_err(|_| NOT_TEXT)?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
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

    write_and_publish(path, &temp, bytes, must_not_exist).map_err(|code| {
        let _ = fs::remove_file(&temp);
        if code == CANNOT_WRITE && !folder.is_dir() {
            FOLDER_GONE.to_string()
        } else {
            code.to_string()
        }
    })
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
            let written = atomic_write(
                Path::new(&file.path),
                file.text.as_bytes(),
                file.must_not_exist,
            );
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
            crate::content::picture(&file.name).ok_or(())?
        } else {
            file.text.as_bytes()
        };
        atomic_write(&path, bytes, must_not_exist).map_err(|_| ())?;
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

pub fn folder_stamp(folder: &str) -> u64 {
    let root = Path::new(folder);
    let (Ok(meta), Ok(entries)) = (fs::metadata(root), fs::read_dir(root)) else {
        return 0;
    };
    let mut newest = millis(meta.modified());
    for entry in entries.flatten() {
        if entry.file_name() == ".DS_Store" {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        newest = newest.max(millis(meta.modified()));
        if !meta.is_dir() {
            continue;
        }
        let Ok(children) = fs::read_dir(entry.path()) else {
            continue;
        };
        for child in children.flatten() {
            if child.file_name() == ".DS_Store" {
                continue;
            }
            if let Ok(meta) = child.metadata() {
                newest = newest.max(millis(meta.modified()));
            }
        }
    }
    newest
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
            picture: false,
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
        assert_eq!(read_single(&path).error.as_deref(), Some("not_text"));
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
            must_not_exist: false,
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
        let stamp = folder_stamp(&s(&old));
        save_copy(&s(&old), &s(&parent), "c", &[named("a.html", "changed")]).unwrap();
        assert_eq!(snapshot(&old), before);
        assert_eq!(folder_stamp(&s(&old)), stamp);
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
        assert_eq!(folder_stamp(&s(&parent.join("gone"))), 0);

        let locked = parent.join("locked");
        fs::create_dir(&locked).unwrap();
        set_mode(&locked, 0o000);
        let stamp = folder_stamp(&s(&locked));
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
        let stamp = folder_stamp(&s(&folder));
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
        let stamp = folder_stamp(&s(&folder));
        assert_eq!(folder_stamp(&s(&folder)), stamp);
    }

    #[test]
    fn stamp_moves_when_a_file_with_an_old_date_is_copied_in() {
        let (_dir, parent) = real_tempdir();
        let folder = parent.join("project");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a.html"), "x").unwrap();
        set_mtime(&folder.join("a.html"), an_hour_ago());
        set_mtime(&folder, an_hour_ago());
        let before = folder_stamp(&s(&folder));

        let picture = folder.join("old.png");
        fs::write(&picture, "png").unwrap();
        set_mtime(&picture, an_hour_ago());
        let picture_time = millis(fs::metadata(&picture).unwrap().modified());
        let after = folder_stamp(&s(&folder));
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
        let before = folder_stamp(&s(&folder));
        fs::write(&page, "y").unwrap();
        assert!(folder_stamp(&s(&folder)) > before);
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
        let before = folder_stamp(&s(&folder));

        let future = SystemTime::now() + Duration::from_secs(3600);
        set_mtime(&in_deep, future);
        assert_eq!(folder_stamp(&s(&folder)), before);

        set_mtime(&in_sub, future);
        assert!(folder_stamp(&s(&folder)) > before);
    }

    #[test]
    #[cfg(not(windows))]
    fn stamp_ignores_ds_store() {
        let (_dir, folder) = real_tempdir();
        fs::create_dir(folder.join("images")).unwrap();
        fs::write(folder.join(".DS_Store"), "finder").unwrap();
        fs::write(folder.join("images/.DS_Store"), "finder").unwrap();
        let before = folder_stamp(&s(&folder));

        let future = SystemTime::now() + Duration::from_secs(3600);
        set_mtime(&folder.join(".DS_Store"), future);
        set_mtime(&folder.join("images/.DS_Store"), future);
        assert_eq!(folder_stamp(&s(&folder)), before);
    }

    #[cfg(unix)]
    #[test]
    fn stamp_does_not_mind_a_dangling_symlink() {
        let (_dir, folder) = real_tempdir();
        std::os::unix::fs::symlink("nowhere", folder.join("link")).unwrap();
        assert!(folder_stamp(&s(&folder)) > 0);
    }
}
