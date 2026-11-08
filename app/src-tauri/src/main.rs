#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod preview;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use htmllab_core::{content, files, kinds, names, prefs, project};
use serde::{Deserialize, Serialize};
use tauri::menu::MenuEvent;
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, RunEvent, WebviewWindow, WindowEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

struct AppState {
    store: preview::Store,
    nonce: String,
    prefs: Mutex<prefs::Prefs>,
    prefs_path: PathBuf,
    menu: Mutex<Option<menu::MenuHandles<Wry>>>,
    quitting: AtomicBool,
    any_changed: AtomicBool,
    panel_open: AtomicBool,
    quit_waiting_on_panel: AtomicBool,
    ack_generation: AtomicU64,
    ack_waiting: AtomicU64,
    window_shown: AtomicBool,
    flags: LaunchFlags,
    preview_trace: Mutex<std::collections::VecDeque<String>>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchFlags {
    speed_check: bool,
    speed_start: Option<u64>,
    self_test: Option<String>,
    smoke_test: bool,
    #[serde(skip)]
    open_paths: Vec<String>,
}

static APP: OnceLock<AppHandle> = OnceLock::new();

// A Mac hands over the files of a cold launch before setup has run, so the queue lives outside AppState.
static OPEN_REQUESTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

struct PanelGuard(AppHandle);

impl PanelGuard {
    fn new(app: &AppHandle) -> Self {
        state(app).panel_open.store(true, Ordering::SeqCst);
        PanelGuard(app.clone())
    }
}

impl Drop for PanelGuard {
    fn drop(&mut self) {
        let st = state(&self.0);
        st.panel_open.store(false, Ordering::SeqCst);
        if st.quit_waiting_on_panel.swap(false, Ordering::SeqCst) {
            let app = self.0.clone();
            let _ = self.0.run_on_main_thread(move || begin_quit(&app));
        }
    }
}

#[tauri::command(async)]
fn pick_files(app: AppHandle) -> Vec<String> {
    let exts: Vec<&str> = kinds::KINDS
        .iter()
        .flat_map(|k| k.extensions.iter().copied())
        .collect();
    let _guard = PanelGuard::new(&app);
    let picked = app
        .dialog()
        .file()
        .add_filter("Web pages and style files", &exts)
        .blocking_pick_files();
    picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| htmllab_core::files::path_text(p))
        .collect()
}

#[tauri::command(async)]
fn pick_folder(app: AppHandle, start: Option<String>) -> Option<String> {
    let _guard = PanelGuard::new(&app);
    let mut dialog = app.dialog().file();
    if let Some(dir) = start.filter(|d| std::path::Path::new(d).is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    dialog
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| htmllab_core::files::path_text(p))
}

#[tauri::command(async)]
fn get_app_config() -> kinds::AppConfig {
    kinds::app_config()
}

#[tauri::command(async)]
fn scan_folder(picked: String) -> project::ScanResult {
    project::scan_folder(std::path::Path::new(&picked))
}

#[tauri::command(async)]
fn read_files(paths: Vec<String>) -> Vec<files::ReadResult> {
    files::read_files(&paths)
}

#[tauri::command(async)]
fn write_files(files: Vec<files::WriteFile>) -> Vec<files::WriteResult> {
    files::write_files(&files)
}

#[tauri::command(async)]
fn folder_stamp(folder: String) -> u64 {
    files::folder_stamp(&folder)
}

#[tauri::command(async)]
fn save_project(
    parent: String,
    name: String,
    files: Vec<files::NamedFile>,
) -> Result<files::SavedProject, String> {
    files::save_project(&parent, &name, &files)
}

#[tauri::command(async)]
fn save_copy(
    folder: String,
    parent: String,
    name: String,
    files: Vec<files::NamedFile>,
) -> Result<files::SavedProject, String> {
    files::save_copy(&folder, &parent, &name, &files)
}

#[derive(Serialize)]
struct CleanedFile {
    stem: String,
    seq: u64,
}

#[tauri::command(async)]
fn clean_file_name(raw: String, seq: u64) -> CleanedFile {
    CleanedFile {
        stem: names::clean_file_name(&raw),
        seq,
    }
}

#[derive(Serialize)]
struct CleanedProject {
    name: String,
    seq: u64,
}

#[tauri::command(async)]
fn clean_project_name(raw: String, seq: u64) -> CleanedProject {
    CleanedProject {
        name: names::clean_project_name(&raw),
        seq,
    }
}

#[tauri::command(async)]
fn file_name_free(tabs: Vec<String>, folder: Option<String>, file: String) -> bool {
    names::file_name_free(&tabs, folder.as_deref().map(std::path::Path::new), &file)
}

#[tauri::command(async)]
fn add_link(html: String, css_file: String) -> Option<project::LinkInsert> {
    project::add_link(&html, &css_file)
}

#[tauri::command(async)]
fn new_project(style: String) -> Option<content::ProjectContent> {
    content::new_project(&style)
}

#[tauri::command(async)]
fn new_file(kind: String, stem: String, css: Option<String>) -> Option<content::NewFileContent> {
    content::new_file(&kind, &stem, css.as_deref())
}

#[tauri::command(async)]
fn samples() -> Vec<content::SampleSummary> {
    content::samples()
}

#[tauri::command(async)]
fn open_sample(id: String) -> Option<content::ProjectContent> {
    content::open_sample(&id)
}

#[tauri::command(async)]
fn open_practice(topic_id: String) -> Option<content::ProjectContent> {
    content::open_practice(&topic_id)
}

#[tauri::command(async)]
fn help_index() -> serde_json::Value {
    localized(content::help_index())
}

#[tauri::command(async)]
fn help_topic(id: String) -> Option<serde_json::Value> {
    content::help_topic(&id).map(localized)
}

#[derive(Deserialize)]
struct BufferFile {
    path: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    picture: bool,
}

#[tauri::command(async)]
fn set_buffers(app: AppHandle, files: Vec<BufferFile>) {
    let st = state(&app);
    let mut map = st.store.buffers.write().unwrap();
    let mut pictures = st.store.pictures.write().unwrap();
    for f in files {
        if f.picture {
            let name = f.path.rsplit('/').next().unwrap_or("");
            if let Some(bytes) = content::picture(name) {
                pictures.insert(f.path, bytes);
            }
        } else {
            map.insert(f.path, f.text);
        }
    }
}

#[tauri::command(async)]
fn drop_buffers(app: AppHandle, paths: Vec<String>) {
    let st = state(&app);
    let mut map = st.store.buffers.write().unwrap();
    let mut pictures = st.store.pictures.write().unwrap();
    for p in paths {
        map.remove(&p);
        pictures.remove(&p);
    }
}

#[tauri::command(async)]
fn add_root(app: AppHandle, folder: String) {
    state(&app).store.add_root(&folder);
}

#[tauri::command(async)]
fn remove_root(app: AppHandle, folder: String) {
    state(&app).store.remove_root(&folder);
}

#[tauri::command(async)]
fn get_prefs(app: AppHandle) -> prefs::Prefs {
    let st = state(&app);
    let mut p = st.prefs.lock().unwrap().clone();
    let place_ok = p
        .save_place
        .as_deref()
        .map(|d| std::path::Path::new(d).is_dir())
        .unwrap_or(false);
    if !place_ok {
        p.save_place = app
            .path()
            .document_dir()
            .ok()
            .map(|d| htmllab_core::files::path_text(d));
    }
    p
}

#[tauri::command(async)]
fn set_prefs(app: AppHandle, patch: serde_json::Value) {
    let st = state(&app);
    let mut p = st.prefs.lock().unwrap();
    prefs::merge(&mut p, &patch);
    let _ = prefs::save(&st.prefs_path, &p);
}

#[tauri::command(async)]
fn open_external(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = tauri_plugin_opener::open_url(url, None::<&str>);
    }
}

fn localized(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    if cfg!(target_os = "macos") {
        return value;
    }
    match value {
        Value::String(text) => Value::String(localize_text(&text)),
        Value::Array(list) => Value::Array(list.into_iter().map(localized).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, localized(v))).collect())
        }
        other => other,
    }
}

// Help text as Windows and Linux show it. The fold keys go first: there they are
// Ctrl+Shift, because Ctrl+Alt is AltGr (see FOLD_KEY in menu.rs).
fn localize_text(text: &str) -> String {
    text.replace("Cmd+Alt+[", "Ctrl+Shift+[")
        .replace("Cmd+Alt+]", "Ctrl+Shift+]")
        .replace("Cmd+", "Ctrl+")
        .replace("Safari", "your browser")
        .replace(" Mac", " computer")
}

#[tauri::command(async)]
fn show_folder(app: AppHandle, path: String) {
    if state(&app).store.inside_root(std::path::Path::new(&path)) {
        let _ = tauri_plugin_opener::open_path(path, None::<&str>);
    }
}

#[tauri::command(async)]
fn copy_text(app: AppHandle, text: String) -> bool {
    write_pasteboard(&app, &text)
}

#[cfg(target_os = "macos")]
fn write_pasteboard(_app: &AppHandle, text: &str) -> bool {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        if board.is_null() {
            return false;
        }
        let _: isize = msg_send![board, clearContents];
        let string = NSString::from_str(text);
        let kind = NSString::from_str("public.utf8-plain-text");
        msg_send![board, setString: &*string, forType: &*kind]
    })
}

#[cfg(not(target_os = "macos"))]
fn write_pasteboard(app: &AppHandle, text: &str) -> bool {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).is_ok()
}

#[tauri::command(async)]
fn open_in_safari(app: AppHandle, path: String) -> bool {
    if !state(&app).store.inside_root(std::path::Path::new(&path)) {
        return false;
    }
    let browser = if cfg!(target_os = "macos") {
        Some("Safari")
    } else {
        None
    };
    tauri_plugin_opener::open_path(path, browser).is_ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MenuState {
    has_tabs: bool,
    has_folder: bool,
    dialog_open: bool,
    any_changed: bool,
    typing_helpers: bool,
    autosave: bool,
    #[serde(default)]
    boxes: bool,
    #[serde(default)]
    pointable: bool,
}

#[tauri::command(async)]
fn set_menu_state(app: AppHandle, menu_state: MenuState) {
    let st = state(&app);
    st.any_changed
        .store(menu_state.any_changed, Ordering::SeqCst);
    let guard = st.menu.lock().unwrap();
    if let Some(handles) = guard.as_ref() {
        for (id, item) in &handles.items {
            // Point needs the page tab's own page, not one reached by a link.
            let on = menu::item_enabled(
                id,
                menu_state.has_tabs,
                menu_state.has_folder,
                menu_state.dialog_open,
            ) && (*id != "point" || menu_state.pointable);
            let _ = item.set_enabled(on);
        }
        let _ = handles
            .typing_helpers
            .set_checked(menu_state.typing_helpers);
        let _ = handles.autosave.set_checked(menu_state.autosave);
        let _ = handles.typing_helpers.set_enabled(!menu_state.dialog_open);
        let _ = handles.autosave.set_enabled(!menu_state.dialog_open);
        let _ = handles.boxes.set_checked(menu_state.boxes);
        let _ = handles
            .boxes
            .set_enabled(!menu_state.dialog_open && menu_state.has_tabs);
    }
}

fn gallery_dir(app: &tauri::App) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        return dir.join("gallery");
    }
    let real = std::env::current_exe().and_then(|exe| exe.canonicalize());
    match real {
        Ok(exe) => exe
            .parent()
            .map(|macos| macos.join("../Resources/gallery"))
            .unwrap_or_default(),
        Err(err) => {
            eprintln!("HTML Lab: no place for the template gallery: {err}");
            PathBuf::new()
        }
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn reveal_window(app: &AppHandle) {
    if state(app).window_shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn bring_to_front(app: &AppHandle) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    if !st.window_shown.load(Ordering::SeqCst) {
        return;
    }
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn queue_open(app: &AppHandle, paths: Vec<String>) {
    if !paths.is_empty() {
        OPEN_REQUESTS.lock().unwrap().extend(paths);
        let _ = app.emit("open-requested", ());
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || bring_to_front(&handle));
}

fn arg_paths(args: impl IntoIterator<Item = String>, cwd: &std::path::Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| files::path_text(cwd.join(a)))
        .collect()
}

#[tauri::command]
fn take_open_requests() -> Vec<String> {
    std::mem::take(&mut *OPEN_REQUESTS.lock().unwrap())
}

#[tauri::command(async)]
fn plan_open(paths: Vec<String>) -> project::OpenPlan {
    project::plan_open(&paths)
}

#[tauri::command]
fn test_queue_open(app: AppHandle, paths: Vec<String>) {
    if test_mode(&app) {
        queue_open(&app, paths);
    }
}

#[tauri::command(async)]
fn show_window(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || reveal_window(&handle));
}

fn remember_window_size(app: &AppHandle) {
    let Some(w) = main_window(app) else { return };
    if w.is_fullscreen().unwrap_or(false) {
        return;
    }
    let (Ok(size), Ok(scale)) = (w.inner_size(), w.scale_factor()) else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    let st = state(app);
    let mut p = st.prefs.lock().unwrap();
    prefs::set_window_size(&mut p, logical.width, logical.height);
    let _ = prefs::save(&st.prefs_path, &p);
}

fn exit_now(app: &AppHandle) {
    state(app).quitting.store(true, Ordering::SeqCst);
    remember_window_size(app);
    app.exit(0);
}

fn begin_quit(app: &AppHandle) {
    let st = state(app);
    if st.quitting.load(Ordering::SeqCst) || !st.any_changed.load(Ordering::SeqCst) {
        exit_now(app);
        return;
    }
    if st.panel_open.load(Ordering::SeqCst) {
        st.quit_waiting_on_panel.store(true, Ordering::SeqCst);
        return;
    }
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let generation = st.ack_generation.fetch_add(1, Ordering::SeqCst) + 1;
    st.ack_waiting.store(generation, Ordering::SeqCst);
    let _ = app.emit("close-requested", ());

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let st = state(&handle);
        if st.ack_waiting.load(Ordering::SeqCst) != generation {
            return;
        }
        st.ack_waiting.store(0, Ordering::SeqCst);
        let quit_anyway = {
            let _guard = PanelGuard::new(&handle);
            handle
                .dialog()
                .message("Quit anyway? Changes since your last Save may be lost.")
                .title("HTML Lab is not answering.")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Quit anyway".into(),
                    "Keep working".into(),
                ))
                .blocking_show()
        };
        if quit_anyway {
            let main = handle.clone();
            let _ = handle.run_on_main_thread(move || exit_now(&main));
        }
    });
}

#[tauri::command(async)]
fn close_ack(app: AppHandle) {
    state(&app).ack_waiting.store(0, Ordering::SeqCst);
}

#[tauri::command(async)]
fn quit_now(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || exit_now(&handle));
}

#[tauri::command(async)]
fn get_launch_flags(app: AppHandle) -> LaunchFlags {
    state(&app).flags.clone()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInfo {
    pid: u32,
    log_dir: String,
}

#[tauri::command(async)]
fn write_log_file(app: AppHandle, name: String, text: String) -> Option<ProcessInfo> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    if name.contains(['/', '\\']) || name.starts_with('.') {
        return None;
    }
    std::fs::write(dir.join(name), text).ok()?;
    Some(ProcessInfo {
        pid: std::process::id(),
        log_dir: htmllab_core::files::path_text(&dir),
    })
}

#[tauri::command(async)]
fn test_temp_folder(app: AppHandle, name: String) -> Option<String> {
    if !test_mode(&app) {
        return None;
    }
    let dir = std::env::temp_dir().join(format!("htmllab-{}-{}", std::process::id(), name));
    std::fs::create_dir_all(&dir).ok()?;
    let real = dunce::canonicalize(&dir).ok()?;
    Some(htmllab_core::files::path_text(&real))
}

fn trace_preview(app: &AppHandle, line: impl FnOnce() -> String) {
    let st = state(app);
    if !(st.flags.self_test.is_some() || st.flags.speed_check || st.flags.smoke_test) {
        return;
    }
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut trace = st.preview_trace.lock().unwrap();
    trace.push_back(format!("{ms} {}", line()));
    if trace.len() > 3000 {
        trace.pop_front();
    }
}

#[tauri::command]
fn test_preview_trace(app: AppHandle) -> Vec<String> {
    if !test_mode(&app) {
        return Vec::new();
    }
    state(&app).preview_trace.lock().unwrap().iter().cloned().collect()
}

#[tauri::command(async)]
fn test_quit(app: AppHandle) {
    if test_mode(&app) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || exit_now(&handle));
    }
}

fn test_mode(app: &AppHandle) -> bool {
    let flags = &state(app).flags;
    flags.self_test.is_some() || flags.speed_check || flags.smoke_test
}

#[tauri::command(async)]
fn log_error(app: AppHandle, text: String) {
    use std::io::Write;
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join("errors.log");
    if std::fs::metadata(&file).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
        return;
    }
    if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
        let line: String = text.chars().take(4000).collect();
        let _ = writeln!(out, "{line}");
    }
}

#[tauri::command(async)]
fn test_snapshot(app: AppHandle, name: String) -> bool {
    if !test_mode(&app) || name.contains(['/', '\\']) || name.starts_with('.') {
        return false;
    }
    let Ok(dir) = app.path().app_log_dir() else {
        return false;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let Some(window) = main_window(&app) else {
            return false;
        };
        let path = dir.join(name).to_string_lossy().into_owned();
        let (done, result) = std::sync::mpsc::channel::<bool>();
        if window
            .with_webview(move |webview| snapshot::take(webview.inner(), path, done))
            .is_err()
        {
            return false;
        }
        result.recv_timeout(Duration::from_secs(10)).unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
mod snapshot {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, sel};
    use objc2_foundation::NSString;
    use std::sync::mpsc::Sender;

    pub fn take(webview: *mut std::ffi::c_void, path: String, done: Sender<bool>) {
        let webview = webview.cast::<AnyObject>();
        let handler = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            let ok = !image.is_null() && unsafe { write_png(image, &path) };
            let _ = done.send(ok);
        });
        unsafe {
            let whole_view: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![webview, takeSnapshotWithConfiguration: whole_view, completionHandler: &*handler];
        }
    }

    pub fn keep_frames_when_covered(webview: *mut std::ffi::c_void) -> bool {
        let webview = webview.cast::<AnyObject>();
        unsafe {
            let can: bool = msg_send![webview, respondsToSelector: sel!(_setWindowOcclusionDetectionEnabled:)];
            if can {
                let _: () = msg_send![webview, _setWindowOcclusionDetectionEnabled: false];
            }
            can
        }
    }

    unsafe fn write_png(image: *mut AnyObject, path: &str) -> bool {
        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return false;
        }
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if rep.is_null() {
            return false;
        }
        let props: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        let png: *mut AnyObject = msg_send![rep, representationUsingType: 4usize, properties: props];
        if png.is_null() {
            return false;
        }
        let file = NSString::from_str(path);
        msg_send![png, writeToFile: &*file, atomically: true]
    }
}

fn test_path_ok(path: &str) -> bool {
    let temp = dunce::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| std::env::temp_dir());
    let parent = std::path::Path::new(path);
    let mut probe = Some(parent);
    while let Some(p) = probe {
        if let Ok(real) = dunce::canonicalize(p) {
            return real.starts_with(&temp);
        }
        probe = p.parent();
    }
    false
}

#[tauri::command(async)]
fn test_write_bytes(app: AppHandle, path: String, bytes: Vec<u8>) -> bool {
    test_mode(&app) && test_path_ok(&path) && std::fs::write(path, bytes).is_ok()
}

#[tauri::command(async)]
fn test_write_big(app: AppHandle, path: String, size: usize) -> bool {
    test_mode(&app) && test_path_ok(&path) && std::fs::write(path, vec![b'a'; size]).is_ok()
}

#[tauri::command(async)]
fn test_make_folder(app: AppHandle, path: String) -> bool {
    test_mode(&app) && test_path_ok(&path) && std::fs::create_dir_all(path).is_ok()
}

#[tauri::command(async)]
fn test_move(app: AppHandle, from: String, to: String) -> bool {
    test_mode(&app) && test_path_ok(&from) && test_path_ok(&to) && std::fs::rename(from, to).is_ok()
}

#[tauri::command(async)]
fn test_list_folder(app: AppHandle, path: String) -> Vec<String> {
    if !test_mode(&app) || !test_path_ok(&path) {
        return Vec::new();
    }
    let mut names: Vec<String> = std::fs::read_dir(path)
        .map(|it| {
            it.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[tauri::command(async)]
fn test_delete_tree(app: AppHandle, path: String) -> bool {
    test_mode(&app)
        && path.contains("htmllab-")
        && test_path_ok(&path)
        && std::fs::remove_dir_all(path).is_ok()
}

#[tauri::command(async)]
fn test_minimize(app: AppHandle) -> bool {
    if !test_mode(&app) {
        return false;
    }
    main_window(&app)
        .map(|w| w.minimize().is_ok())
        .unwrap_or(false)
}

#[tauri::command(async)]
fn test_window_state(app: AppHandle) -> serde_json::Value {
    let Some(w) = main_window(&app) else {
        return serde_json::Value::Null;
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let size = w.inner_size().map(|s| s.to_logical::<f64>(scale)).ok();
    serde_json::json!({
        "minimized": w.is_minimized().unwrap_or(false),
        "visible": w.is_visible().unwrap_or(false),
        "focused": w.is_focused().unwrap_or(false),
        "width": size.map(|s| s.width),
        "height": size.map(|s| s.height),
        "theme": format!("{:?}", w.theme().ok()),
    })
}

fn read_flags() -> LaunchFlags {
    let mut flags = LaunchFlags::default();
    for arg in std::env::args().skip(1) {
        if arg == "--speed-check" {
            flags.speed_check = true;
        } else if let Some(v) = arg.strip_prefix("--speed-start=") {
            flags.speed_start = v.parse().ok();
        } else if let Some(v) = arg.strip_prefix("--self-test=") {
            flags.self_test = Some(v.to_string());
        } else if arg == "--self-test" {
            flags.self_test = Some("all".into());
        } else if arg == "--smoke-test" {
            flags.smoke_test = true;
        } else if !arg.starts_with('-') {
            flags.open_paths.push(arg);
        }
    }
    flags
}

fn make_nonce() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let a = RandomState::new().build_hasher().finish();
    let b = RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::runtime::{AnyClass, AnyObject, Sel};
    use objc2::sel;

    const NS_TERMINATE_CANCEL: usize = 0;
    const NS_TERMINATE_NOW: usize = 1;

    extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _sel: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        let Some(app) = APP.get() else {
            return NS_TERMINATE_NOW;
        };
        let st = state(app);
        if st.quitting.load(Ordering::SeqCst) || !st.any_changed.load(Ordering::SeqCst) {
            st.quitting.store(true, Ordering::SeqCst);
            remember_window_size(app);
            return NS_TERMINATE_NOW;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || begin_quit(&handle));
        NS_TERMINATE_CANCEL
    }

    pub fn install_terminate_handler() -> bool {
        let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else {
            return false;
        };
        unsafe {
            let imp: objc2::ffi::IMP = Some(std::mem::transmute::<
                extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                unsafe extern "C-unwind" fn(),
            >(should_terminate));
            let class_ptr = class as *const AnyClass as *mut AnyClass;
            objc2::ffi::class_addMethod(
                class_ptr,
                sel!(applicationShouldTerminate:),
                imp.unwrap(),
                c"Q@:@".as_ptr(),
            )
            .as_bool()
        }
    }
}

fn prepare_window(app: &AppHandle, stored: Option<prefs::WindowSize>) {
    let Some(w) = main_window(app) else { return };
    let mut width = stored
        .as_ref()
        .map(|s| s.width)
        .unwrap_or(1280.0)
        .max(960.0);
    let mut height = stored
        .as_ref()
        .map(|s| s.height)
        .unwrap_or(800.0)
        .max(600.0);
    if let Ok(Some(monitor)) = w.current_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        width = width.min(area.size.width as f64 / scale);
        height = height.min(area.size.height as f64 / scale);
    }
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    let _ = w.center();
    let dark = matches!(w.theme(), Ok(tauri::Theme::Dark));
    let color = if dark {
        tauri::window::Color(0x0F, 0x1A, 0x2B, 0xFF)
    } else {
        tauri::window::Color(0xE8, 0xED, 0xF4, 0xFF)
    };
    let _ = w.set_background_color(Some(color));
}

fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            begin_quit(app);
        }
        WindowEvent::Focused(true) => {
            let _ = app.emit("window-focused", ());
        }
        WindowEvent::Focused(false) => {
            let _ = app.emit("window-blurred", ());
        }
        WindowEvent::DragDrop(drop) => match drop {
            DragDropEvent::Enter { paths, .. } if !paths.is_empty() => {
                let _ = app.emit("drag-state", "enter");
            }
            DragDropEvent::Leave => {
                let _ = app.emit("drag-state", "leave");
            }
            DragDropEvent::Drop { paths, .. } if !paths.is_empty() => {
                let _ = app.emit("drag-state", "leave");
                let list: Vec<String> = paths
                    .iter()
                    .map(|p| htmllab_core::files::path_text(p))
                    .collect();
                let _ = app.emit("files-dropped", list);
            }
            _ => {}
        },
        _ => {}
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref().to_string();
    if id == "quit" {
        begin_quit(app);
    } else {
        let _ = app.emit("menu", id);
    }
}

fn base_builder(flags: &LaunchFlags) -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    #[cfg(not(target_os = "macos"))]
    let builder = if flags.self_test.is_some() || flags.smoke_test || flags.speed_check {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = arg_paths(args.into_iter().skip(1), std::path::Path::new(&cwd));
            queue_open(app, paths);
        }))
    };
    #[cfg(target_os = "macos")]
    let _ = flags;
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
}

fn main() {
    let flags = read_flags();
    if let Ok(cwd) = std::env::current_dir() {
        OPEN_REQUESTS.lock().unwrap().extend(arg_paths(flags.open_paths.clone(), &cwd));
    }
    let nonce = make_nonce();

    let app = base_builder(&flags)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("preview", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let raw = request.uri().path().to_string();
            let uri = request.uri().to_string();
            trace_preview(&app, || format!("req {uri}"));
            tauri::async_runtime::spawn_blocking(move || {
                let st = state(&app);
                let answer = preview::respond(&st.store, &raw, &st.nonce);
                trace_preview(&app, || format!("answer {} {} bytes {uri}", answer.status().as_u16(), answer.body().len()));
                responder.respond(answer);
            });
        })
        .register_asynchronous_uri_scheme_protocol("gallery", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let answer = match content::gallery_image(&path) {
                    Some(bytes) => tauri::http::Response::builder()
                        .header("Content-Type", kinds::mime_for(&path))
                        .header("Cache-Control", "max-age=31536000")
                        .body(bytes),
                    None => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(answer.unwrap_or_default());
            });
        })
        .setup(move |app| {
            content::set_gallery_dir(gallery_dir(app));
            std::thread::spawn(|| drop(content::samples()));
            let handle = app.handle().clone();
            let _ = APP.set(handle.clone());

            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let prefs_path = config_dir.join("prefs.json");
            let loaded = prefs::load(&prefs_path);
            let stored_size = loaded.window_size.clone();
            let (typing, autosave) = (loaded.typing_helpers, loaded.autosave);

            app.manage(AppState {
                store: preview::Store::default(),
                nonce: nonce.clone(),
                prefs: Mutex::new(loaded),
                prefs_path,
                menu: Mutex::new(None),
                quitting: AtomicBool::new(false),
                any_changed: AtomicBool::new(false),
                panel_open: AtomicBool::new(false),
                quit_waiting_on_panel: AtomicBool::new(false),
                ack_generation: AtomicU64::new(0),
                ack_waiting: AtomicU64::new(0),
                window_shown: AtomicBool::new(false),
                flags: flags.clone(),
                preview_trace: Mutex::new(std::collections::VecDeque::new()),
            });

            let (menu_bar, handles) = menu::build(&handle, typing, autosave)?;
            app.set_menu(menu_bar)?;
            *state(&handle).menu.lock().unwrap() = Some(handles);

            prepare_window(&handle, stored_size);

            #[cfg(target_os = "macos")]
            if flags.self_test.is_some() || flags.smoke_test {
                if let Some(window) = main_window(&handle) {
                    let _ = window.with_webview(|webview| {
                        if !snapshot::keep_frames_when_covered(webview.inner()) {
                            eprintln!("HTML Lab: frames may stop while the window is covered.");
                        }
                    });
                }
            }

            #[cfg(target_os = "macos")]
            if !mac::install_terminate_handler() {
                eprintln!(
                    "HTML Lab: could not add the terminate handler. Dock Quit will not ask (R23)."
                );
            }

            let fallback = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                let main = fallback.clone();
                let _ = fallback.run_on_main_thread(move || reveal_window(&main));
            });
            Ok(())
        })
        .on_window_event(on_window_event)
        .on_menu_event(on_menu_event)
        .invoke_handler(tauri::generate_handler![
            pick_files,
            pick_folder,
            get_app_config,
            scan_folder,
            read_files,
            write_files,
            folder_stamp,
            save_project,
            save_copy,
            clean_file_name,
            clean_project_name,
            file_name_free,
            add_link,
            new_project,
            new_file,
            samples,
            open_sample,
            open_practice,
            help_index,
            help_topic,
            set_buffers,
            drop_buffers,
            add_root,
            remove_root,
            get_prefs,
            set_prefs,
            open_external,
            show_folder,
            open_in_safari,
            set_menu_state,
            show_window,
            close_ack,
            quit_now,
            get_launch_flags,
            write_log_file,
            test_temp_folder,
            test_quit,
            test_write_bytes,
            test_write_big,
            copy_text,
            test_make_folder,
            test_move,
            test_list_folder,
            test_delete_tree,
            test_minimize,
            test_window_state,
            test_snapshot,
            test_preview_trace,
            test_queue_open,
            take_open_requests,
            plan_open,
            log_error,
        ])
        .build(tauri::generate_context!())
        .expect("HTML Lab could not start");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !state(app).quitting.load(Ordering::SeqCst) {
                api.prevent_exit();
                begin_quit(app);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(files::path_text)
                .collect();
            queue_open(app, paths);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::localize_text;

    #[test]
    fn help_keys_match_the_menu_off_the_mac() {
        assert_eq!(localize_text("Cmd+Alt+["), "Ctrl+Shift+[");
        assert_eq!(localize_text("Cmd+Alt+]"), "Ctrl+Shift+]");
        assert_eq!(localize_text("Cmd+Shift+I"), "Ctrl+Shift+I");
        assert_eq!(localize_text("Open in Safari"), "Open in your browser");
        assert_eq!(localize_text("on your Mac"), "on your computer");
    }
}
