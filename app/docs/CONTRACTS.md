# HTML Lab - contracts between the parts

Status:
- state: current
- reviewed: 2026-11-09
- owner: maintainers

Purpose:
- Fix the seams between the parts of the app, so they can be built side by side and still fit.
- This file only fixes names and shapes. Behaviour is described in `../../docs/ARCHITECTURE.md`.
- Every name below was checked against the code on the reviewed date, see "Checked against the code".

## Rust core, `core/` (crate `htmllab_core`, no Tauri)

All results derive `serde::Serialize` with `rename_all = "camelCase"`. All inputs from JavaScript derive `Deserialize` the same way. Dependencies: `serde`, `serde_json`, `dunce`, `unicode-normalization` (exactly 0.1.26, NFC for name matching, 0.3.0), `libc` on Unix only and `windows-sys` (exactly 0.61.2, `Win32_Storage_FileSystem`, the no-replace rename) on Windows only. Tests use `tempfile` as a dev dependency.

`kinds.rs`. A teaching kind (html, css) decides what is a web file; a language only adds comfort when editing (C37, ADR 0009):

```rust
pub struct Kind {
    pub id: &'static str,              // "html", "css"; "code" for CODE_KIND
    pub extensions: &'static [&'static str], // ["html", "htm"], ["css"]
    pub label: &'static str,           // "HTML page", "CSS file"
    pub blurb: &'static str,           // "A new page", "A place for style"
    pub default_stem: &'static str,    // "planets", "more-style"
    pub primary_ext: &'static str,     // "html", "css"
    pub icon: &'static str,            // sprite id: "html-file", "css-file"; "files" for CODE_KIND
    pub color_token: &'static str,     // "html", "css"; "ink2" for CODE_KIND
    pub language: &'static str,        // "html", "css"; "text" for CODE_KIND
    pub preview_mode: &'static str,    // "morph", "swap"; "none" for CODE_KIND
    pub is_page: bool,
    pub open_first: &'static str,      // "Open an HTML page first."
    pub teaching: bool,                // true for KINDS rows, false for CODE_KIND (0.3.0)
}
pub const KINDS: &[Kind];              // html and css only
pub const CODE_KIND: Kind;             // the one kind of every other text file; not a row of KINDS
pub struct Language {
    pub id: &'static str,              // "javascript", "json", "python", ..., "text"
    pub label: &'static str,           // "JavaScript", shown in #lang-label
    pub extensions: &'static [&'static str],
    pub names: &'static [&'static str], // whole file names, such as "Gemfile", ".env"
    pub tidy: &'static str,            // "on", "off-meaning" or "off-no-rules"
    pub letters: &'static str,         // the tab icon's letters: "JS", "JSON", "TXT"
}
pub const LANGUAGES: &[Language];      // never html or css; has a "text" row
pub const PICTURES: &[&str];           // the list in "Folder scan"
pub fn kind_for_extension(ext: &str) -> Option<&'static Kind>; // any case
pub fn kind_for_name(file_name: &str) -> Option<&'static Kind>;
pub fn kind_or_code(file_name: &str) -> &'static Kind;       // only for a file that gets a tab
pub fn language_for_name(file_name: &str) -> &'static Language; // by whole name, then ending, else "text"
pub fn is_picture(file_name: &str) -> bool;
pub fn mime_for(file_name: &str) -> &'static str;            // js, mjs text/javascript; other LANGUAGES endings text/plain
pub enum ScriptPolicy { Blocked, Run }
pub const SCRIPT_POLICY: ScriptPolicy;
pub fn csp_for(policy: ScriptPolicy, nonce: &str) -> String;   // one line
pub struct AppConfig { pub kinds: &'static [Kind], pub code_kind: &'static Kind,
                       pub languages: &'static [Language], pub script_policy: ScriptPolicy }
pub fn app_config() -> AppConfig;      // get_app_config: { kinds, codeKind, languages, scriptPolicy }
```

`counts.rs` (0.3.0, C48): `pub struct FsCounts { pub read_dirs: u64, pub entries_read: u64, pub stats: u64 }` and `pub fn fs_counts(reset: bool) -> FsCounts`. Only `scan_folder`, the folder listing of `plan_open` and `folder_stamp` count; `test_fs_counts` reads them.

`names.rs`:

```rust
pub fn clean_file_name(raw: &str) -> String;     // the stem, may be empty
pub fn clean_project_name(raw: &str) -> String;  // may be empty
pub fn windows_reserved(name: &str) -> bool;     // CON, NUL, COM1 and the like
pub fn file_name_free(tabs: &[String], folder: Option<&Path>, file: &str, except: Option<&str>) -> bool;
// names compared ignoring case and after NFC; except (a renamed file's own name) is left out only
// for a case-only change of that name, and on disk only when it is the very same file (dev, inode)
pub struct NameProblem { pub code: &'static str, pub char: Option<String> } // code: empty, dots, space_edge, bad_char, too_long, reserved
pub fn check_rename(old: &str, new: &str) -> Result<String, NameProblem>;   // web endings cleaned, other names as typed
pub fn check_rename_for(old: &str, new: &str, windows: bool) -> Result<String, NameProblem>;
```

Tauri commands added or changed in 0.3.0 (`src-tauri/src/main.rs`, results camelCase):

```rust
fn check_name(old: String, new: String) -> CheckedName;  // check_rename; old is "" for a new file (WP4)
struct CheckedName { name: Option<String>, problem: Option<NameProblem> }
// A blank new is always { name: null, problem: { code: "empty" } }, so old "" never lets "" through.
fn file_name_free(tabs: Vec<String>, folder: Option<String>, file: String, except: Option<String>) -> bool;
// except: the renamed file's own name (Change Name, WP5); left out for a new file
fn folder_stamp(folder: String, files: Option<Vec<String>>) -> u64; // files: stamp only these (a lone
// project, C48); left out or empty: the folder and one level down, at most MAX_STAMP_STATS stats
fn pages_using(path: String) -> Vec<String>; // refs::pages_using, for the My page side (WP3);
// path must be inside an open root, else []
// Change Name (WP5, F3; C9, C44, C45, C5). JSON fields camelCase.
fn find_references(root: String, target: String, new_name: String, open: Vec<OpenText>, walk: bool) -> RefPlan;
// walk: refs::find_references over root (which must be inside an open root, else an empty plan)
// and the open texts; !walk: the open texts only, never the disk (a project with no folder, root
// "__new/<projectId>", and the saved text of changed tabs). Texts outside root are left out.
fn rename_file(from: String, to: String) -> Result<String, String>; // files::rename_file; from inside an
// open root (or gone, its folder inside one), else "cannot_write". -> the new path. Errors: file_exists, not_found, cannot_write
fn rewrite_references(plan: Vec<RewriteFile>) -> Vec<RewriteResult>; // files::rewrite_references with the
// open roots; one result per file (C5). The bytes from before each written file stay in AppState for Undo.
fn restore_references(files: Vec<WrittenFile>, check: bool) -> Vec<RestoreResult>;
struct WrittenFile { path: String, at: Option<String>, size: u64, hash: String } // path as written, at where it is now
struct RestoreResult { path: String, ok: bool, error: Option<String> } // changed_on_disk, cannot_write, read_only
// check: files::check_restore, the write's own guards with nothing written (a plain, writable file inside
// an open root that still holds the bytes HTML Lab wrote), so a file that became read-only stops Undo
// before it starts; else files::restore_bytes the kept bytes
fn forget_rewrites(); // lets go of the kept bytes when Undo is over
```

Test-only commands (`src-tauri/src/main.rs`). Each does nothing and gives `false`, `None` or `[]` unless the app was started for a self-test, smoke test or speed check (`test_mode`); only `test_window_state` answers in any mode. The ones with a path accept only paths under the system temp folder (`test_path_ok`); `test_delete_tree` also needs `htmllab-` in the path.

```rust
fn test_temp_folder(name: String) -> Option<String>;          // <temp>/htmllab-<pid>-<name>, made, real path
fn test_write_bytes(path: String, bytes: Vec<u8>) -> bool;
fn test_read_bytes(path: String) -> Option<Vec<u8>>;          // 0.3.0 WP1: the bytes a save wrote
fn test_write_big(path: String, size: usize) -> bool;         // size bytes of "a"
fn test_make_tree(path: String, count: usize, ext: Option<String>) -> bool; // 0.3.0 WP1: count empty files
// e00000.<ext> ..., at most 100,000; ext left out is "dat", else 1 to 8 ASCII letters or digits ("html": C48)
fn test_fs_counts(reset: bool) -> Option<FsCounts>;           // 0.3.0 WP1: counts::fs_counts, { readDirs, entriesRead, stats }
fn test_make_folder(path: String) -> bool;
fn test_move(from: String, to: String) -> bool;
fn test_list_folder(path: String) -> Vec<String>;             // names, sorted
fn test_delete_tree(path: String) -> bool;
fn test_minimize() -> bool;
fn test_window_state() -> Value;                              // { minimized, visible, focused, width, height, theme }
fn test_set_window_size(width: f64, height: f64) -> bool;     // 0.3.0 WP4: logical points (the 960 px toolbar test)
fn test_snapshot(name: String) -> bool;                       // a picture of the window into the log folder, macOS only
fn test_preview_trace() -> Vec<String>;                       // "<ms> <line>", the last 3,000 preview events
fn test_browser_opened() -> Vec<String>;                      // in test mode open_in_safari only records its path; read and cleared
fn test_queue_open(paths: Vec<String>);                       // as if the system opened these files
fn test_quit();
```

`MenuState` (`set_menu_state`, from `tabs.syncMenu`): `{ hasTabs, hasFolder, dialogOpen, anyChanged, typingHelpers, autosave, boxes, pointable, sideShown, renamable, undoRename }`, the last five `#[serde(default)]`. `renamable` (the active project is not a practice copy) is ANDed into `rename` (File > Change Name...) and `undoRename` (the toast offers Undo) into `undo-rename` (File > Undo Change Name), as `pointable` is into `point` (`menu::state_allows`). `sideShown` sets the check of `toggle-side` (View > My Page Side, `CmdOrCtrl+Shift+Y`, enabled by `menu::item_enabled` like every item that needs a tab) and greys View > Show the Boxes while the side is hidden (C46). `Session` is unchanged by WP5: a rename writes the session with the new paths.

Menu ids added or renamed in 0.3.0 (`src-tauri/src/menu.rs`): `new` is "New Project...", `add-file` is "New File..." (`CmdOrCtrl+Shift+N`, opens Make a new file), `rename` "Change Name..." and `undo-rename` "Undo Change Name" (`FILE_ITEMS_2`, before `close-tab`), `toggle-side` (`SIDE_ID`, a check item). All three new ids are in `NEEDS_TAB` and `APP_COMMANDS`.

`refs.rs` (pure, WP2b; read by the Change Name commands):

```rust
pub struct OpenText { pub path: String, pub text: String }
pub struct RefPlan { pub files: Vec<RefFile>, pub capped: bool } // capped: the 2,000-file scan cap was hit
pub struct RefFile { pub path: String, pub open: bool, pub size: u64, pub hash: String, pub spans: Vec<Span> }
pub struct Span { pub line: usize, pub from: usize, pub to: usize, pub old_text: String, pub new_text: String,
                  pub line_text: String, pub line_from: usize, pub line_to: usize }
// from/to: UTF-16 offsets into an open text, byte offsets into a closed file's decoded text
pub fn find_references(root: &Path, target: &Path, new_name: &str, open: &[OpenText]) -> RefPlan;
pub fn find_references_with(root: &Path, target: &Path, new_name: &str, open: &[OpenText], fold: bool) -> RefPlan;
// fold: match ignoring case and after NFC (macOS, Windows); exact on Linux. find_references picks it.
pub const MAX_REF_FILES: usize = 2_000; pub const MAX_REF_DEPTH: usize = 6; pub const MAX_REF_BYTES: u64; // 5 MB
pub fn content_hash(bytes: &[u8]) -> String;     // 16 hex digits; stable within one run (plan and Undo)
pub fn pages_using(file: &Path) -> Vec<String>;  // pages in the file's own folder that use it, index.html
// first; [] for a web file, a folder or a missing file. Reads at most MAX_SIDE_ENTRIES (500) entries and
// MAX_SIDE_PAGES (50) pages. pages_using_with(file, fold, max_entries, max_pages) for the tests.
```

`files.rs` for Change Name: `rename_file(from, to) -> Result<String, String>` (never replaces, C44), `RewriteFile { path, open, size, hash, spans: [RewriteSpan { from, to, oldText, newText }], text (open tabs: the saved text), bom, encoding, eol }`, `RewriteResult { path, ok, error, size, hash, text }` plus `original` (the bytes from before, `#[serde(skip)]`, kept by the command) (errors cannot_write, read_only, changed_on_disk, folder_gone), `restore_bytes(path, original, size, hash, roots)`, and `check_restore(path, size, hash, roots) -> Result<(), String>` (the Undo check: the guards and bytes test of `restore_bytes`, nothing written; errors cannot_write, read_only, changed_on_disk). An open tab of a file with mixed line endings is still the planned file when its own text, with every CR LF and CR made LF, is the tab's text; then only the spans change and every ending stays (C45).

`project.rs`:

```rust
pub struct ScanFile { pub path: String, pub name: String, pub kind: String, pub picked: bool }
pub struct ScanResult {
    pub folder: String, pub folder_name: String,
    pub is_project: bool, pub refused: bool,
    pub too_big: bool,             // 0.3.0 C48: the folder has more than MAX_SCAN_ENTRIES entries, so never a project
    pub stopped_early: bool,       // 0.3.0 C48: the scan stopped at more than 20 web files, before the end of the
                                   // folder; openPaths then opens the file lone, as for too_big (JSON stoppedEarly)
    pub files: Vec<ScanFile>,      // opening order, when is_project
    pub linked_css: Vec<ScanFile>, // E6, only when not a project and a page was picked
}
pub const MAX_SCAN_ENTRIES: usize = 2_000;
pub fn scan_folder(picked: &Path) -> ScanResult; // reads the folder once; only teaching-kind files make a
// project; a picked file that is not a web file gives a plain result (not a project, not refused)
pub struct FolderOpen { pub folder_name: String, pub files: Vec<String> }
pub struct OpenPlan { pub folders: Vec<FolderOpen>, pub files: Vec<String>, pub empty_folders: Vec<String>, pub others: Vec<String> }
pub fn plan_open(paths: &[String]) -> OpenPlan;   // what to do with files and folders opened from outside
pub fn linked_css(html: &str, folder: &Path) -> Vec<String>;
pub struct LinkInsert { pub line: usize, pub text: String } // 0-based line to insert before, text with indent, no newline
pub fn add_link(html: &str, css_file: &str) -> Option<LinkInsert>;
```

`files.rs`:

```rust
pub enum Encoding { Utf8, Utf16le, Utf16be }      // "utf8", "utf16le", "utf16be"
pub enum Eol { Lf, Crlf, Cr }                      // "lf", "crlf", "cr"
pub struct Indent { pub tabs: bool, pub width: u8 }
pub struct TextStyle {                             // how the file was written, so a save gives the same bytes (C43)
    pub bom: bool, pub encoding: Encoding,
    pub eol: Eol,                                  // the most-used ending
    pub mixed_eol: bool, pub final_newline: bool, pub indent: Indent,
}
pub struct ReadResult { pub path: String, pub name: String, pub text: Option<String>, pub error: Option<String>,
                        pub style: Option<TextStyle> } // style with text, None with error
// errors: not_text (a NUL, UTF-32), other_encoding (not UTF-8, bad UTF-16), too_big (over 5 MB), cannot_read
// text: decoded, BOM removed, line endings as in the file
pub fn read_files(paths: &[String]) -> Vec<ReadResult>;
pub struct Decoded { pub text: String, pub bom: bool, pub encoding: Encoding }
pub fn decode_text(bytes: &[u8]) -> Result<Decoded, &'static str>; // the one decoder, also for the preview (C10)
pub fn detect_style(text: &str, bom: bool, encoding: Encoding, teaching: bool) -> TextStyle;
pub fn encode_text(text: &str, bom: bool, encoding: &str, eol: &str) -> Result<Vec<u8>, &'static str>;
// the one encoder of every save path: LF becomes eol, BOM first, UTF-16 always with its BOM;
// "" means utf8 / lf; an unknown value is cannot_write
pub struct WriteFile { pub path: String, pub text: String, pub must_not_exist: bool,
                       pub bom: bool, pub encoding: String, pub eol: String } // last four #[serde(default)]
// the UI sends the tab's style flat, from state.js writeStyle: { bom, encoding, eol }
pub struct WriteResult { pub path: String, pub ok: bool, pub error: Option<String> } // file_exists, folder_gone, cannot_write
pub fn write_files(files: &[WriteFile]) -> Vec<WriteResult>;
pub struct NamedFile { pub name: String, pub text: String, pub picture: bool,
                       pub bom: bool, pub encoding: String, pub eol: String } // all but name #[serde(default)]
// picture: write the built-in picture of that name, not text
pub struct SavedProject { pub folder: String, pub paths: Vec<String> } // same order as files
pub fn save_project(parent: &str, name: &str, files: &[NamedFile]) -> Result<SavedProject, String>; // folder_exists, cannot_write
pub fn save_copy(folder: &str, parent: &str, name: &str, files: &[NamedFile]) -> Result<SavedProject, String>; // + too_big
pub const MAX_STAMP_STATS: usize = 2_000;
pub fn folder_stamp(folder: &str, files: Option<&[String]>) -> u64; // ms since epoch, 0 when unreadable;
// with files only those are statted; else the folder and one level down, skipping node_modules and
// dot folders, at most MAX_STAMP_STATS stats, the folder's own included (C48)
pub fn atomic_write(path: &Path, bytes: &[u8], must_not_exist: bool) -> Result<(), String>;
pub fn path_text(path: impl AsRef<Path>) -> String; // a path as the UI shows and sends it
```

`content.rs`. Data through `include_str!` of `content/*.json`, parsed on first use with `OnceLock`. Templates are read at run time from the gallery folder (`templates.json` there), not built in:

```rust
pub struct ContentFile { pub name: String, pub code: String, pub hidden: bool, pub picture: bool } // picture: a built-in or gallery picture, left out when false
pub struct ProjectContent { pub id: String, pub name: String, pub files: Vec<ContentFile> }
pub struct SampleSummary {
    pub id: String, pub title: String, pub blurb: String, pub style: String,
    pub group: String,      // "template" for a template, else empty
    pub shows: Vec<String>, pub accent: String, pub category: String, pub layout: String,
    pub needs: Vec<String>, // CSS this template needs from the engine (D11)
}
pub struct NewFileContent { pub file: String, pub text: String }
pub fn new_project(style: &str) -> Option<ProjectContent>; // "inline", "file"
pub fn new_file(kind: &str, stem: &str, css: Option<&str>) -> Option<NewFileContent>;
pub fn samples() -> Vec<SampleSummary>;  // the five samples in the New dialog's order (Space poster, Space club website, My hobby page, Pancake recipe, Photo gallery), then the templates
pub fn open_sample(id: &str) -> Option<ProjectContent>;
pub fn open_practice(topic_id: &str) -> Option<ProjectContent>;
pub fn help_index() -> serde_json::Value;  // { groups: [...], topics: [{ id, group, kind, section, title, short, keywords }] }
pub fn help_topic(id: &str) -> Option<serde_json::Value>;
pub fn help_file(topic_id: &str, file: &str) -> Option<String>; // for preview://localhost/__help/<id>/<file>
pub fn help_bytes(topic_id: &str, file: &str) -> Option<Vec<u8>>; // the same, pictures included
pub fn picture(name: &str) -> Option<&'static [u8]>;               // a built-in picture
pub fn set_gallery_dir(dir: PathBuf);
pub fn gallery_dir() -> Option<&'static Path>;
pub fn gallery_image(path: &str) -> Option<Vec<u8>>;              // gallery://, /previews/<name> and /thumbs/<name> only
```

`help.json` shape: `{ "groups": [{ "id", "title", "line", "tile", "color", "icon" }], "topics": [ ...as in the plan's "Help and teaching"... ] }`. `help-design.json` and `help-effects.json` add topics only. Group ids, in order: `start`, `recipes`, `html`, `ways`, `css`, `design`, `effects`, `lookup`.

`prefs.rs`:

```rust
pub struct Session { pub tabs: Vec<String>, pub active: Option<String>, pub side: Option<String> } // side: the My page side chosen by hand with these tabs (0.3.0 WP3)
pub const SIDE_SHOWN: &str = "shown"; pub const SIDE_HIDDEN: &str = "hidden"; // any other side becomes None in merge
pub struct WindowSize { pub width: f64, pub height: f64 }
pub struct Prefs {
    pub text_size: u32, pub save_place: Option<String>, pub tried: Vec<String>,
    pub typing_helpers: bool, pub autosave: bool,
    pub session: Option<Session>, pub window_size: Option<WindowSize>,
}
impl Default for Prefs { /* 16, None, [], true, false, None, None */ }
pub fn load(path: &Path) -> Prefs;               // missing or broken -> defaults
pub fn save(path: &Path, prefs: &Prefs) -> Result<(), String>; // atomic
pub fn merge(prefs: &mut Prefs, patch: &serde_json::Value);    // only keys present; never windowSize
pub fn set_window_size(prefs: &mut Prefs, w: f64, h: f64);
```

## Screens, `ui/`

`ui/index.html` holds the full static skeleton with these ids. JavaScript fills it and shows or hides parts by the `hidden` attribute.

```text
#toolbar [data-tauri-drag-region]
  #btn-new  #btn-open  #btn-save (.label inside)  #btn-side (last in .tb-left, 0.3.0 WP3)
  #seg-page  #seg-help  .brand
#main
  #left
    #welcome-start
      #w-new  #w-open  #w-sample
    #code-panel
      #tabstrip  (the tabs go in #tab-list, then #tab-add stays last)
      #rename-tip  (role="status", the Change Name field's tooltip under its tab, 0.3.0 WP5)
      #rename-toast  (role="status": #rename-toast-text  #rename-undo, before #editor-host so Shift+Tab reaches Undo)
      #editor-host
      #inside-line  (the "You are inside" row, 0.2.0, filled by inside.js)
      #statusline
        #status-mark  #status-text  #lang-label (the language of a non-web tab, 0.3.0 WP2)  #tidy-off (why Tidy is off, Tidy's aria-describedby)  #btn-tidy  #size-value (hidden)  #size-minus  #size-plus
  #divider
  #right
    #welcome-how
      #w-open-help
    #page-panel
      #page-header
        #page-label  #page-hint (holds #hint-browser while the page has a script, 0.2.1)  #btn-point  #btn-boxes  .page-btn-gap  #w-phone  #w-tablet  #w-full  #btn-safari
      #page-frame-wrap
        iframe#preview  #page-empty (with #page-empty-link)
      #page-none (the no-page side, 0.3.0 WP3: #page-none-line  #btn-hide-side  #page-none-help)
      #practice-bar
        #practice-text  #btn-back-help
    #help-panel
#dialog-root
#drop-overlay
#blank-panels (two empty panels shown during a relaunch, E5)
```

Rules:
- The iframe has `sandbox="allow-scripts"` in the HTML. Only `preview.js` touches it.
- `#page-frame-wrap` lays the iframe out. `preview.js` sets the width and the scale for E3.
- While Help shows, `#page-panel` uses `visibility: hidden` and `position: absolute`, never `display: none`. The class is `.behind`.
- `#status-mark` takes `data-state`: `amber`, `bulb`, `check`.
- Width buttons, `#btn-point` and `#btn-boxes` take `aria-pressed`.
- `#btn-point` is disabled unless the page shows the page tab (`updatePointButton` in `preview.js`).
- `#hint-browser` is a `.link` button made by `setHint` in `preview.js`; `app.js` runs Open in Browser when it is clicked.

`ui/views.js`, pure, no state, no Tauri:

```js
export function escapeHtml(value)
export function icon(id, cls, color) // <svg><use href="#i-id"></svg> string
export function lettersIcon(letters, color) // a file outline with a language's letters (0.3.0 WP2)
export function tabHtml({ path, name, label, kind, kindIcon, kindColor, letters, dirty, active, tooltip })
// returns a string: an element with class .tab, data-path, .tab-close inside, active as .active;
// with letters the tab shows lettersIcon, else icon(kindIcon)
```

Mistake hint box, built by `ui-src/hints.js`, styled in `ui/style.css`:

```html
<div class="hint-box">
  <span class="hint-icon"><svg>...</svg></span>
  <div class="hint-body">
    <div class="hint-title">Oops, this tag never closes.</div>
    <div class="hint-text">A closing tag needs a slash. Try <code>&lt;/h1&gt;</code> here.</div>
    <div class="hint-links">
      <button class="hint-link" data-act="learn">Learn about tags</button>
      <button class="hint-link" data-act="hide">Hide this hint</button>
    </div>
  </div>
</div>
```

`ui-src/code-hints.js` (0.3.0 WP6) gives the JSON, JavaScript and TypeScript mistakes in the same box and field; only the json, javascript and typescript language chunks load it.

`ui/style.css` also defines: `.cm-mistake` (the wavy amber underline) and code color classes `.c-tag .c-attr .c-str .c-text .c-dim .c-prop .c-val`, and for the languages (0.3.0 WP2) `.c-var .c-type .c-op .c-head .c-em .c-link .c-meta .c-re .c-bool`, on the code tokens (`codeColors` in `ui-src/editor.js`). The editor theme itself lives in `ui-src/editor.js`, built on the same CSS variables (`--win --panel --strip --line --ink --ink2 --num --active --brand --onBrand --html --css --amber --hintBg --hintLine --segBg --segOn`, `--c-tag --c-attr --c-str --c-text --c-dim --c-prop --c-val --c-var --c-type --c-op --c-head --c-link --c-meta --c-re --c-bool`, `--code-size --code-lh`, `--font-ui --font-code`).

`ui/icons.js` inserts the sprite: `export function installSprite()`. Icons from `@phosphor-icons/core` (already in `node_modules`), duotone when large and bold when small, as in the `Icons` board.

`ui/dialogs.js`. Every function returns a Promise. Only one dialog at a time. It owns the scrim, `inert` on `#toolbar` and `#main`, the focus rules, Enter and Esc as in "Dialog rules". It calls `onDialogChange(open)` from `setDialogListener(fn)` on open and close. It never calls Tauri itself: rules come in through callbacks.

```js
export function setDialogListener(fn)
export function isDialogOpen()
export function cancelDialog()                        // resolves the open one as its cancel answer
export const SAVE_COPY_TEXT                           // the Save a Copy dialog's words
export function showNewDialog({ samples, templates, focusSamples, focusTemplates })
  // -> { type: 'project', style: 'inline'|'file' } | { type: 'sample', id } | { type: 'templates' } | null
export function showTemplateDialog({ templates })
  // -> { type: 'sample', id } | { type: 'back' } | null
export function templatePreviewUrl(template, size)    // size 'previews' or 'thumbs', a gallery:// address
export function showSaveDialog({ heading, line, button, name, place, placePath, files, extraLine,
                                 cleanName, choosePlace, submit })
  // heading default "Save your project". files: [{ name, icon }].
  // cleanName(raw) -> Promise<string>  (shown in the folder line, empty turns the button off)
  // choosePlace(currentPath) -> Promise<{ path, name } | null>
  // submit({ name, parent }) -> Promise<null | { error: string }>; null closes, error stays open and shows the text
  // -> { name, parent } | null
export function showNewFileDialog({ kinds, startChip, cssName, pageName, cleanName, checkName, nameFree })
  // Make a new file (0.3.0 WP4, mockup 11). Field #dlg-file, chips as native radios in
  // role="radiogroup" aria-label "Kind of file": page (Web page .html), style (Style .css),
  // script (Script .js), text (Text .txt), other (Other, no ending). startChip: 'page' | 'text'.
  // kinds: from the app config (page and style chips take primaryExt and defaultStem from them).
  // cssName / pageName: the 0.2.1 tick row for the page / style chip, or null (no tick for others).
  // cleanName(raw) -> Promise<string> for page and style; checkName(name) -> Promise<{ name, problem }>
  // (the check_name command) for every other name; nameFree(fileName) -> Promise<boolean>.
  // -> { chip, kind: 'html' | 'css' | null, stem: string | null, file, tick: boolean } | null
  // kind is set when the final name has a teaching kind's ending (an Other name may end in .html).
export function nameProblemText(problem, name)        // the "Change a name" field line for a NameProblem
export function showOpenAsk({ pickedName, folderName, files })
  // files: [{ name, icon, picked }] -> 'all' | 'one'
export function showLinkedCssAsk({ pageName, files }) // -> 'yes' | 'no'
export function showSaveAsk({ fileName, count, wholeFile })
  // one file: fileName; several: count. wholeFile switches to the "whole file" line -> 'save' | 'discard' | 'cancel'
export function showTakeOutAsk({ fileName })          // -> 'remove' | 'keep'
export function showMessage({ title, text, buttons }) // buttons: [{ id, label, primary }] -> id
export function showRenameDialog({ oldName, newName, places, capped, saved, extra, submit })
  // Change Name (0.3.0 WP5, mockups 06, 07, 09). places: [{ file, line, lineText, lineFrom, lineTo }],
  // the old name marked from lineFrom to lineTo. capped: the scan stopped at 2,000 files. saved: the
  // project has a folder (the tick's small line). extra: more lines (type change, no longer a page).
  // The tick [data-tick] starts on; unticked shows [data-warn] (role="alert") and the amber
  // [data-only] "Change only the file name", never data-primary. submit(ticked) runs while busy and
  // -> { places, capped } (show the new list) | { value } (close with value). -> 'keep' | value
```

`openDialog` (inside dialogs.js) takes `onEnter(event)`: when given, Enter calls it instead of pressing `[data-primary]`.

`ui/help.js`. It renders inside `#help-panel`. It keeps topic, open group, search and scroll until the app quits. Tauri comes in through `deps`.

```js
export function initHelp(container, deps)
// deps: { helpIndex() -> Promise, helpTopic(id) -> Promise,
//         highlight(code, lang) -> Promise<[{ text, cls }]>   // cls: "c-tag c-attr c-str c-text c-dim c-prop c-val", or ""
//         onTryIt(topicId), onAddToCode({ lang, text }), canAdd(lang) -> { ok, reason },
//         isTried(id) -> bool, openExternal(url), copyText(text), resultUrl(topicId, file) }
// help.js splits those runs itself to tint each legend word's first occurrence.
export function showHome()
export function showGroup(groupId)
export function showTopic(topicId)
export function showWord(word)      // E2
export function refreshTried()
export function refreshCanAdd()
```

Result iframes in Help: `sandbox=""`, `src` from `deps.resultUrl`, else `<previewBase>__help/<id>/<file>` (`preview://localhost/` on Mac and Linux, `http://preview.localhost/` on Windows), height from `result.height`.

## App logic, written alongside

`ui/app.js`, `ui/tabs.js`, `ui/preview.js`, `ui/api.js`, `ui/rename.js`, `ui-src/editor.js`, `ui-src/hints.js`, `ui-src/helper.js`, `src-tauri/src/main.rs`, `menu.rs`, `preview.rs`.

Language chunks (0.3.0 WP2, ADR 0009): `ui-src/langs/<id>.js` for each `LANGUAGES` row with colours (not `text`, `csharp`, `kotlin`), built by esbuild with splitting into `ui/editor/<id>-<hash>.js` plus shared `chunk-<hash>.js` files. Each exports `support()` (a CodeMirror `LanguageSupport` or language), `legacy` (true for a legacy stream mode: ini, lua, powershell, ruby, shell, swift, toml), and json, javascript and typescript also `findMistake`. `ui-src/editor.js` exports `loadLanguages(ids) -> Promise` and `languageLoaded(id)`; html, css and text are built in. A chunk that fails to load leaves the file as plain text and throws the error later, so a test run sees it.

`ui/rename.js` (Change Name, 0.3.0 WP5): `renameFlow(path)` opens the field in the active tab (false for a practice copy): an `input.tab-rename` right after the tab's `.tab-main`, the tab marked `.renaming`, `aria-describedby="rename-tip"`; `cancelRename()`, `clickOpens(path)` and `closedByPointer(event)` for the tab-list click, `noteUserEdit(tab)` from the editor (an edit without the `renameEdit` annotation ends Undo), `undoRename()`, `initRename()`. `ui-src/editor.js` exports `renameEdit` (an `Annotation`) and `Transaction`; every edit Change Name makes in a tab carries `renameEdit` and `Transaction.addToHistory.of(false)`. `flows.js` exports `clearAutosave()`, and `queued`, `refreshLone`, `pathInProject`, `newPath`, `loadLanguagesFor`, `findOpen` for it. `tabs.js` exports `activeFor()`, `setStripHooks({ before, after })` (around a rebuild of `#tab-list`) and `menuState()`.

## House rules for all parts

- No em or en dashes anywhere, code comments and data included. Regular hyphen only.
- English only in the interface and in Help.
- No branch on `"html"` or `"css"` by name outside `kinds.rs`, `languageFor` and tests.
- Use nothing from the engine's "does not work" list: CSS nesting, `color-mix()`, container queries, `subgrid`, `text-wrap: balance`. `esbuild --target=safari15`.
- No transitions, no animation, no `blur`, no `backdrop-filter` in the app's own screens.
- Never commit. Never run `git add`. Never run a command that kills processes by name. Never upgrade the Rust toolchain.

## Checked against the code

Run from `app/`. Each command prints the names one part of this file states; a name that changed shows up as different output.

```bash
# core: public names and struct fields, test code left out
for f in kinds counts names project files content prefs refs; do awk '/#\[cfg\(test\)\]/{exit} {print}' core/src/$f.rs | grep -nE "^pub (fn|struct|enum|const)|^    pub [a-z_]+:"; done
sed -n '/dependencies/,$p' core/Cargo.toml                 # core dependencies
grep -n "pub picture: bool" core/src/content.rs core/src/files.rs
awk '/^ +id: "/{if(id)print id; id=$2} /^ +letters: "/{id=id" "$2} END{print id}' core/src/kinds.rs | tr '\n' ' '; echo   # kind ids, then language ids with letters (the text row has no literal id)
grep -n "impl Default for Prefs" -A12 core/src/prefs.rs   # Prefs defaults
grep -n "INDEX_FIELDS" -A2 core/src/content.rs            # help index fields
python3 -c "import json;print([g['id'] for g in json.load(open('core/content/help.json'))['groups']])"
python3 -c "import json;print([s['title'] for s in json.load(open('core/content/samples.json'))])"
# Tauri commands, their signatures, MenuState and the menu ids
sed -n '/generate_handler!\[/,/\])/p' src-tauri/src/main.rs | tr -d ' ,' | grep -v '^$' | tr '\n' ' '; echo
grep -nE "^fn (check_name|file_name_free|folder_stamp|pages_using|find_references|rename_file|rewrite_references|restore_references|forget_rewrites|test_[a-z_]+)\(" src-tauri/src/main.rs
grep -n "^struct \(CheckedName\|WrittenFile\|RestoreResult\|MenuState\)" -A18 src-tauri/src/main.rs | grep -E "struct|^[0-9]+-    [a-z_]+:"
awk '/#\[cfg\(test\)\]/{exit} {print NR": "$0}' src-tauri/src/menu.rs | grep -E '^[0-9]+: pub const (SIDE|RENAME|UNDO_RENAME)_|"(New Project|New File)\.\.\."' 
grep -n "^ *const state = {" -A14 ui/tabs.js | grep -oE "^[0-9]+- +[a-zA-Z]+:"   # MenuState as sent
# language chunks and the editor's language exports
grep -oE "^  [a-z]+: \(\) => import" ui-src/editor.js | awk '{print $1}' | tr '\n' ' '; echo
grep -ln "export const legacy = true" ui-src/langs/*.js | tr '\n' ' '; echo
grep -l "findMistake" ui-src/langs/*.js | tr '\n' ' '; echo
grep -n "^export function \(loadLanguages\|languageLoaded\)\|^export const renameEdit" ui-src/editor.js
grep -o "class: 'c-[a-z]*'" ui-src/editor.js | sort -u | tr '\n' ' '; echo
# screens
grep -o 'id="[^"]*"' ui/index.html | grep -v '"i-'
grep -n "hint-browser" ui/preview.js ui/app.js
grep -n "mark: '" ui/tabs.js                              # status marks
grep -n "hint-\|cm-mistake" ui-src/hints.js               # hint box classes
grep -oE "^ +--[a-zA-Z-]+:" ui/style.css | sort -u        # CSS variables
grep -n "^export" ui/dialogs.js ui/help.js ui/views.js ui/icons.js
grep -o "deps\.[a-zA-Z]*" ui/help.js | sort -u            # Help deps
grep -n "answer({ type" ui/dialogs.js                     # New and template dialog answers
```
