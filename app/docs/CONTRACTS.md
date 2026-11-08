# HTML Lab - contracts between the parts

Status:
- state: current
- reviewed: 2026-11-07
- owner: maintainers

Purpose:
- Fix the seams between the parts of the app, so they can be built side by side and still fit.
- This file only fixes names and shapes. Behaviour is described in `../../docs/ARCHITECTURE.md`.

## Rust core, `core/` (crate `htmllab_core`, no Tauri)

All results derive `serde::Serialize` with `rename_all = "camelCase"`. All inputs from JavaScript derive `Deserialize` the same way. Dependencies: `serde`, `serde_json`, `libc`. Tests with `tempfile` as a dev dependency are fine.

`kinds.rs`:

```rust
pub struct Kind {
    pub id: &'static str,              // "html", "css"
    pub extensions: &'static [&'static str], // ["html", "htm"], ["css"]
    pub label: &'static str,           // "HTML page", "CSS file"
    pub blurb: &'static str,           // "A new page", "A place for style"
    pub default_stem: &'static str,    // "planets", "more-style"
    pub primary_ext: &'static str,     // "html", "css"
    pub icon: &'static str,            // sprite id: "html-file", "css-file"
    pub color_token: &'static str,     // "html", "css"
    pub language: &'static str,        // "html", "css"
    pub preview_mode: &'static str,    // "morph", "swap"
    pub is_page: bool,
    pub open_first: &'static str,      // "Open an HTML page first."
}
pub const KINDS: &[Kind];
pub const PICTURES: &[&str];           // the list in "Folder scan"
pub fn kind_for_extension(ext: &str) -> Option<&'static Kind>; // any case
pub fn kind_for_name(file_name: &str) -> Option<&'static Kind>;
pub fn is_picture(file_name: &str) -> bool;
pub fn mime_for(file_name: &str) -> &'static str;
pub enum ScriptPolicy { Blocked, Run }
pub const SCRIPT_POLICY: ScriptPolicy;
pub fn csp_for(policy: ScriptPolicy, nonce: &str) -> String;   // one line
pub struct AppConfig { pub kinds: &'static [Kind], pub script_policy: ScriptPolicy }
pub fn app_config() -> AppConfig;
```

`names.rs`:

```rust
pub fn clean_file_name(raw: &str) -> String;     // the stem, may be empty
pub fn clean_project_name(raw: &str) -> String;  // may be empty
pub fn file_name_free(tabs: &[String], folder: Option<&Path>, file: &str) -> bool;
```

`project.rs`:

```rust
pub struct ScanFile { pub path: String, pub name: String, pub kind: String, pub picked: bool }
pub struct ScanResult {
    pub folder: String, pub folder_name: String,
    pub is_project: bool, pub refused: bool,
    pub files: Vec<ScanFile>,      // opening order, when is_project
    pub linked_css: Vec<ScanFile>, // E6, only when not a project and a page was picked
}
pub fn scan_folder(picked: &Path) -> ScanResult;
pub fn linked_css(html: &str, folder: &Path) -> Vec<String>;
pub struct LinkInsert { pub line: usize, pub text: String } // 0-based line to insert before, text with indent, no newline
pub fn add_link(html: &str, css_file: &str) -> Option<LinkInsert>;
```

`files.rs`:

```rust
pub struct ReadResult { pub path: String, pub name: String, pub text: Option<String>, pub error: Option<String> } // not_text, too_big, cannot_read
pub fn read_files(paths: &[String]) -> Vec<ReadResult>;
pub struct WriteFile { pub path: String, pub text: String, pub must_not_exist: bool }
pub struct WriteResult { pub path: String, pub ok: bool, pub error: Option<String> } // file_exists, folder_gone, cannot_write
pub fn write_files(files: &[WriteFile]) -> Vec<WriteResult>;
pub struct NamedFile { pub name: String, pub text: String }
pub struct SavedProject { pub folder: String, pub paths: Vec<String> } // same order as files
pub fn save_project(parent: &str, name: &str, files: &[NamedFile]) -> Result<SavedProject, String>; // folder_exists, cannot_write
pub fn save_copy(folder: &str, parent: &str, name: &str, files: &[NamedFile]) -> Result<SavedProject, String>; // + too_big
pub fn folder_stamp(folder: &str) -> u64; // ms since epoch, 0 when unreadable
pub fn atomic_write(path: &Path, bytes: &[u8], must_not_exist: bool) -> Result<(), String>;
```

`content.rs`. Data through `include_str!` of `content/*.json`, parsed on first use with `OnceLock`:

```rust
pub struct ContentFile { pub name: String, pub code: String, pub hidden: bool }
pub struct ProjectContent { pub id: String, pub name: String, pub files: Vec<ContentFile> }
pub struct SampleSummary { pub id: String, pub title: String, pub blurb: String, pub style: String }
pub struct NewFileContent { pub file: String, pub text: String }
pub fn new_project(style: &str) -> Option<ProjectContent>; // "inline", "file"
pub fn new_file(kind: &str, stem: &str, css: Option<&str>) -> Option<NewFileContent>;
pub fn samples() -> Vec<SampleSummary>;  // the New dialog's order: Space poster, Space club website, My hobby page, Pancake recipe, Photo gallery
pub fn open_sample(id: &str) -> Option<ProjectContent>;
pub fn open_practice(topic_id: &str) -> Option<ProjectContent>;
pub fn help_index() -> serde_json::Value;  // { groups: [...], topics: [{ id, group, kind, title, short, keywords }] }
pub fn help_topic(id: &str) -> Option<serde_json::Value>;
pub fn help_file(topic_id: &str, file: &str) -> Option<String>; // for preview://localhost/__help/<id>/<file>
```

`help.json` shape: `{ "groups": [{ "id", "title", "line", "tile", "color", "icon" }], "topics": [ ...as in the plan's "Help and teaching"... ] }`. Group ids: `start`, `html`, `ways`, `css`, `lookup`.

`prefs.rs`:

```rust
pub struct Session { pub tabs: Vec<String>, pub active: Option<String> }
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
```

## Screens, `ui/`

`ui/index.html` holds the full static skeleton with these ids. JavaScript fills it and shows or hides parts by the `hidden` attribute.

```text
#toolbar [data-tauri-drag-region]
  #btn-new  #btn-open  #btn-save (.label inside)
  #seg-page  #seg-help  .brand
#main
  #left
    #welcome-start
      #w-new  #w-open  #w-sample
    #code-panel
      #tabstrip  (the tabs go in #tab-list, then #tab-add stays last)
      #editor-host
      #statusline
        #status-mark  #status-text  #btn-tidy  #size-minus  #size-value (optional)  #size-plus
  #divider
  #right
    #welcome-how
      #w-open-help
    #page-panel
      #page-header
        #page-label  #page-hint  #w-phone  #w-tablet  #w-full  #btn-safari
      #page-frame-wrap
        iframe#preview  #page-empty (with #page-empty-link)
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
- Width buttons take `aria-pressed`.

`ui/views.js`, pure, no state, no Tauri:

```js
export function icon(id, cls)      // <svg><use href="#i-id"></svg> string
export function tabHtml({ path, name, label, kind, kindIcon, kindColor, dirty, active, tooltip })
// returns a string: an element with class .tab, data-path, .tab-close inside, active as .active
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

`ui/style.css` also defines: `.cm-mistake` (the wavy amber underline) and code color classes `.c-tag .c-attr .c-str .c-text .c-dim .c-prop .c-val` on the code tokens. The editor theme itself lives in `ui-src/editor.js`, built on the same CSS variables (`--win --panel --strip --line --ink --ink2 --num --active --brand --onBrand --html --css --amber --hintBg --hintLine --segBg --segOn`, `--c-tag --c-attr --c-str --c-text --c-dim --c-prop --c-val`, `--code-size --code-lh`, `--font-ui --font-code`).

`ui/icons.js` inserts the sprite: `export function installSprite()`. Icons from `@phosphor-icons/core` (already in `node_modules`), duotone when large and bold when small, as in the `Icons` board.

`ui/dialogs.js`. Every function returns a Promise. Only one dialog at a time. It owns the scrim, `inert` on `#toolbar` and `#main`, the focus rules, Enter and Esc as in "Dialog rules". It calls `onDialogChange(open)` from `setDialogListener(fn)` on open and close. It never calls Tauri itself: rules come in through callbacks.

```js
export function setDialogListener(fn)
export function isDialogOpen()
export function cancelDialog()                        // resolves the open one as its cancel answer
export function showNewDialog({ samples, focusSamples })
  // -> { type: 'project', style: 'inline'|'file' } | { type: 'sample', id } | null
export function showSaveDialog({ heading, line, button, name, place, placePath, files, extraLine,
                                 cleanName, choosePlace, submit })
  // heading default "Save your project". files: [{ name, icon }].
  // cleanName(raw) -> Promise<string>  (shown in the folder line, empty turns the button off)
  // choosePlace(currentPath) -> Promise<{ path, name } | null>
  // submit({ name, parent }) -> Promise<null | { error: string }>; null closes, error stays open and shows the text
  // -> { name, parent } | null
export function showAddFileDialog({ kinds, kindDefault, cssName, pageName, cleanName, nameFree })
  // kinds: from the app config. cssName: the file for the tick box on a page, or null. pageName: the page for the tick box on a CSS file, or null.
  // cleanName(raw) -> Promise<string>. nameFree(fileName) -> Promise<boolean>.
  // -> { kind, stem, file, tick: boolean } | null
export function showOpenAsk({ pickedName, folderName, files })
  // files: [{ name, icon, picked }] -> 'all' | 'one'
export function showLinkedCssAsk({ pageName, files }) // -> 'yes' | 'no'
export function showSaveAsk({ fileName, count, wholeFile })
  // one file: fileName; several: count. wholeFile switches to the "whole file" line -> 'save' | 'discard' | 'cancel'
export function showTakeOutAsk({ fileName })          // -> 'remove' | 'keep'
export function showMessage({ title, text, buttons }) // buttons: [{ id, label, primary }] -> id
```

`ui/help.js`. It renders inside `#help-panel`. It keeps topic, open group, search and scroll until the app quits. Tauri comes in through `deps`.

```js
export function initHelp(container, deps)
// deps: { helpIndex() -> Promise, helpTopic(id) -> Promise,
//         highlight(code, lang) -> Promise<[{ text, cls }]>   // cls: "c-tag c-attr c-str c-text c-dim c-prop c-val", or ""
//         onTryIt(topicId), onAddToCode({ lang, text }), canAdd(lang) -> { ok, reason },
//         isTried(id) -> bool, openExternal(url) }
// help.js splits those runs itself to tint each legend word's first occurrence.
export function showHome()
export function showGroup(groupId)
export function showTopic(topicId)
export function showWord(word)      // E2
export function refreshTried()
```

Result iframes in Help: `sandbox=""`, `src="preview://localhost/__help/<id>/<file>"`, height from `result.height`.

## App logic, written alongside

`ui/app.js`, `ui/tabs.js`, `ui/preview.js`, `ui/api.js`, `ui-src/editor.js`, `ui-src/hints.js`, `ui-src/helper.js`, `src-tauri/src/main.rs`, `menu.rs`, `preview.rs`.

## House rules for all parts

- No em or en dashes anywhere, code comments and data included. Regular hyphen only.
- English only in the interface and in Help.
- No branch on `"html"` or `"css"` by name outside `kinds.rs`, `languageFor` and tests.
- Use nothing from the engine's "does not work" list: CSS nesting, `color-mix()`, container queries, `subgrid`, `text-wrap: balance`. `esbuild --target=safari15`.
- No transitions, no animation, no `blur`, no `backdrop-filter` in the app's own screens.
- Never commit. Never run `git add`. Never run a command that kills processes by name. Never upgrade the Rust toolchain.
