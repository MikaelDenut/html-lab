---
class:   truth
updated: 2026-11-09
status:  current
---

# Architecture of HTML Lab

This document explains the shape of the code: where the code that does X lives, and what may not depend on what. Paths are relative to `app/`. A citation such as `ui/preview.js:89` was opened when this was written (2026-11-08; the 0.3.0 parts on 2026-11-09). If a line has moved, the symbol named next to it is the reference. Exact values (limits, timings, policies) live in the cited code and are not repeated as authority here. See [INDEX.md](INDEX.md) for the tie-break rule.

Names and shapes at the seams between the parts are fixed in [app/docs/CONTRACTS.md](../app/docs/CONTRACTS.md).

## The division of labour

Three layers run in one Mac app. A pure Rust library holds the rules and the content. A Tauri shell owns the window, the menus, the quit flow and two custom URL schemes. JavaScript in the system web view draws the screens and the editor. A fourth piece, the helper, is JavaScript that runs inside the learner's own page, in a sandboxed iframe.

```
 Tauri shell process (src-tauri/, binary "html-lab")
 +-------------------------------------------------------------+
 | main.rs: commands, quit flow, launch flags                  |
 | menu.rs: native menus      preview.rs: preview:// responder |
 |        |                                                    |
 |        | calls                                              |
 |        v                                                    |
 | core/ (crate htmllab_core, no Tauri): kinds, names,         |
 |       project, files, refs, counts, content, prefs          |
 +-------------------------------------------------------------+
        ^  invoke / events              ^  preview:// and gallery://
        |  (ui/api.js only)             |
 Web view (WebKit)                      |
 +--------------------------------------|----------------------+
 | ui/: app, flows, tabs, preview,      |                      |
 |      dialogs, help, views, state,    |                      |
 |      rename                          |                      |
 | ui/editor.bundle.js (CodeMirror)     |                      |
 |    + language chunks in ui/editor/   |                      |
 |    |  postMessage (ui/preview.js)    |                      |
 |    v                                 |                      |
 | iframe#preview sandbox="allow-scripts"                      |
 |    the learner's page + ui-src/helper.js, injected by Rust  |
 +-------------------------------------------------------------+
```

Rules the sketch encodes. Breaking one is a regression, not a refactor.

- `core/` has no Tauri dependency, so `cargo test` in `core/` needs no window. `core/Cargo.toml` lists `serde`, `serde_json`, `dunce` and `unicode-normalization` (pinned `=0.1.26`, for NFC name matching), `libc` for Unix only (`[target.'cfg(unix)'.dependencies]`) and `windows-sys` for Windows only (`[target.'cfg(windows)'.dependencies]`, pinned `=0.61.2`, feature `Win32_Storage_FileSystem`, for a rename that never replaces). The two pins and why they were added: [ADR 0010](adr/0010-rename-and-reference-rules.md). This list closes BACKLOG T7.
- `ui/api.js` is the only file that touches `window.__TAURI__` (searched: `grep -ln "__TAURI__" ui/*.js ui-src/*.js`, excluding the bundle).
- `ui/preview.js` is the only production file that uses the iframe's `contentWindow` and `src` (searched: `grep -ln contentWindow ui/*.js`; the other hits are the test harnesses `ui/self-test.js:302` and `ui/speed-check.js:441`).
- `core/src/kinds.rs` is the only Rust code that names `"html"` and `"css"` (searched 2026-11-09: `grep` for both strings in `core/src/*.rs` and `src-tauri/src/*.rs`, 0 hits before each `#[cfg(test)]` outside `kinds.rs`). It holds the three tables of C37: `KINDS` (the teaching kinds), `CODE_KIND` (the one kind of every other file) and `LANGUAGES`. The UI gets them from `app_config` and looks them up in `ui/state.js` (`kindForName`, `kindOrCode`, `languageForName`); in the editor, `teachingLanguage` (`ui-src/editor.js:49`) names the two built-in languages. `refs.rs` names reference syntaxes by file ending (`syntax_for`), a known exception of C37.
- `kinds::csp_for` (`core/src/kinds.rs:393`) is the only code that writes `script-src`.
- `files::atomic_write` (`core/src/files.rs:369`) is the path for saved text and preferences, and every saved text goes through `files::encode_text` (`:316`) first (C43). The other direct disk changes are the `fs::copy` of existing files in Save a Copy (`core/src/files.rs:607`), the rename of a learner's file in `files::rename_file` (`:749`, C44), and the test-only or log commands in `src-tauri/src/main.rs` (`write_log_file`, `log_error`, the `test_*` commands). `rewrite_references` and `restore_bytes` write through `atomic_write`.

## Module map

One owner per concern.

### Rust core, `core/src/`

| Module | Owns |
|---|---|
| `kinds.rs` | The `KINDS` table of teaching kinds, html and css, each with `teaching: true` (`:28`); `CODE_KIND`, the one generic kind for every other file, which is not a row of `KINDS` (`:62`); the `LANGUAGES` table, 26 rows with endings, names, label, Tidy rule and tab letters (`:95`); `kind_or_code` (`:331`), used only where a file is opened or given a tab, and `language_for_name` (`:347`); the picture extension list (`:312`), MIME types (`mime_for`, `:360`), the script policy (`SCRIPT_POLICY`, `:391`), the page CSP (`csp_for`, `:393`) and `app_config` (`:419`, with `codeKind` and `languages` since 0.3.0) |
| `names.rs` | Cleaning file and project names (`clean_file_name`, `:11`); the new name of a renamed file and why it is refused (`check_rename`, `:87`, with `NameProblem`, `:70`): web names cleaned to 60 characters, other names kept as typed (C38); whether a file name is free (`file_name_free`, `:187`), compared ignoring case and after NFC, with `except` for a case-only rename |
| `project.rs` | What to open for the paths given (`plan_open`, `:177`: any regular file, a folder by its web files or else up to 10 text files); what counts as a project when a file is opened (`scan_folder`, `:210`: only teaching-kind files count, at most `MAX_SCAN_ENTRIES` entries read, C48); which CSS a page links (`linked_css`, `:305`), where a new `<link>` goes (`add_link`, `:361`) |
| `files.rs` | Reading (`read_files`, `:125`) through the one decoder (`decode_text`, `:192`: UTF-8 with or without a BOM, UTF-16 with a BOM, C10) and the style of the text (`detect_style`, `:234`, giving `TextStyle`, `:51`: BOM, encoding, most-used line ending, mixed endings, final newline, indent); the one encoder of every save path (`encode_text`, `:316`, C43); atomic writes (`atomic_write`, `:369`); first save (`save_project`, `:537`), Save a Copy (`save_copy`, `:612`); the folder change stamp (`folder_stamp`, `:673`, at most `MAX_STAMP_STATS` stats, C48); Change Name: the rename that never replaces (`rename_file`, `:749`, C44), the rewrite of the places (`rewrite_references`, `:1024`, C45) and putting their bytes back (`restore_bytes`, `:1203`) |
| `refs.rs` | The places in a project that use a file's name (`find_references`, `:81`): which forms count, how they resolve, what is skipped, and the spans to change, with a size and `content_hash` (`:73`) per file. Pure: it reads, never writes. Also `pages_using` (`:215`), the pages in a non-web file's own folder that use it, for the My page side. Rules and their reasons: [ADR 0010](adr/0010-rename-and-reference-rules.md) |
| `counts.rs` | Counters of folder reads, entries read and stats (`FsCounts`), bumped by `scan_folder`, the folder listing of `plan_open` and `folder_stamp`, so a test can see C48 hold |
| `content.rs` | Starters, samples, Help and pictures as data (`include_str!` and `include_bytes!`, `:11` to `:39`), and reading the gallery folder at run time (`gallery_dir`, `:58`) |
| `prefs.rs` | The preferences shape, its defaults, and merging a patch (`merge`, `:89`) |

### Tauri shell, `src-tauri/src/`

| Module | Owns |
|---|---|
| `main.rs` | The command list (`generate_handler!`, `:1416`), `AppState` (`:19`, since 0.3.0 with `rewritten`, the bytes each Change Name rewrite replaced, kept for Undo until the toast ends), the menu state from JavaScript (`MenuState`, `:620`, with `sideShown`, `renamable` and `undoRename` since 0.3.0), the one quit flow (`begin_quit`, `:788`), the macOS terminate handler (`mod mac`, `:1177`), native panels (`PanelGuard`, `:60`), launch flags (`read_flags`, `:1148`), registration of both URL schemes (`:1325`, `:1337`) |
| `menu.rs` | The native menu items and which are enabled (`item_enabled`, and `state_allows`, `:377`, for the items that follow `MenuState`). Since 0.3.0: View > My Page Side (`SIDE_ID` `toggle-side`, `SIDE_KEY` `CmdOrCtrl+Shift+Y`, `:27`), File > Change Name... (`RENAME_ID`, `:48`) and File > Undo Change Name. Custom ids go to JavaScript as the `menu` event, except `quit` (`on_menu_event`, `main.rs:1288`) |
| `preview.rs` | Answering `preview://` (`respond`, `:44`), the in-memory `Store` of buffers, pictures and allowed roots (`:15`), text from disk decoded with `files::decode_text` and served as UTF-8 (`serve_disk`, `:107`), placing the helper in a page (`insert_position`, `:209`) |

Commands added in 0.3.0 (compared with the `generate_handler!` list of 0.2.1). Each is a thin wrapper over core; the ones that touch a file check `Store::inside_root` first.

| Command | Does | Core |
|---|---|---|
| `check_name(old, new)` | The name a file gets for what was typed, or the problem (`{ name, problem }`); a blank name is always `empty` | `names::check_rename` |
| `pages_using(path)` | The pages in a non-web file's own folder that use it, for the My page side | `refs::pages_using` |
| `find_references(root, target, newName, open, walk)` | The places that use a name. With `walk` the folder is read too and `root` must be inside an open root; without it only the given texts are read (a project with no folder, the saved text of changed tabs) | `refs::find_references` |
| `rename_file(from, to)` | The rename that never replaces (C44); a file that is gone is `not_found` while its folder is inside a root | `files::rename_file` |
| `rewrite_references(plan)` | Writes the places (C45), one result per file, and keeps each file's old bytes in `AppState.rewritten` | `files::rewrite_references` |
| `restore_references(files, check)` | Undo and rollback: puts the kept bytes back where a file still holds what HTML Lab wrote; with `check` it writes nothing and runs the write's own guards (plain, writable, inside a root, same bytes) | `files::restore_bytes`, `files::check_restore` |
| `forget_rewrites()` | Lets the kept bytes go when the Undo toast ends | |
| `test_read_bytes`, `test_make_tree`, `test_fs_counts`, `test_set_window_size` | Test-only, see "Test harnesses" | |

`file_name_free` also gained an optional `except` (the renamed file's own name, for a case-only rename).

### Screens, `ui/`

| Module | Owns |
|---|---|
| `api.js` | The bridge to Tauri (`invoke`, `listen`) |
| `state.js` | The shared in-memory state `S` and its read-only accessors. Since 0.3.0 also the kind and language lookups over `app_config` (`kindForName`, `kindOrCode`, `languageForName`, `languageIdFor`, `languageRow`), each tab's write style (`writeStyle`, `plainStyle`), and the side and rename state (`S.sideShown`, `S.sideManual`, `S.renaming`) |
| `app.js` | Boot (`boot`), which screens show (`layout`), menu command dispatch (`COMMANDS`), loading the editor bundle (`whenEditor`). Since 0.3.0 also the My page side: the automatic choice (`autoSide`), a choice by hand (`toggleSide`, `S.sideManual`), drawing it (`drawSide`) and `showSide` for Help and View > My Page |
| `rename.js` | Change Name (0.3.0): the field on the active tab's name, the dialog, the rename and the places in the project's write queue (`renameFlow`, `doRename`), the toast and Undo (`undoRename`). Rules: [ADR 0010](adr/0010-rename-and-reference-rules.md) |
| `platform.js` | Which platform the web view runs on, and the words and keys that differ (Safari or your browser, Finder or File Explorer, Cmd or Ctrl) |
| `flows.js` | The order of steps in New, Open, Save, Close, Quit, Try it and autosave |
| `tabs.js` | The tab strip (with language letters on non-web tabs, 0.3.0), the status line and footer language label, the single sender of `set_menu_state`, and `withSide`, which decides the side before the preview hears of a tab switch |
| `preview.js` | The preview update loop and the page header. Knows which text the page shows (`inSync`, `pageVersion`). Pauses while the My page side is hidden (C46, see "The My page side") and picks the page shown beside a non-web file (`relatedPage`). A page with a script gets a header hint whose words "Open in Safari" (or "Open in your browser") are a button, `#hint-browser`, made by `setHint`; `app.js` runs the Open in Browser command when it is clicked (0.2.1) |
| `link.js` | Page and code lighting each other up (0.2.0): hover on the page, Point at the Page, the 2 second outline, CSS rule counts, Show the Boxes. Talks to the page only through `preview.postToPage`, and acts only while `inSync()` holds |
| `inside.js` | The "You are inside" row under the code: the tag or rule path for teaching kinds, `codePath` for other languages (C47) |
| `dialogs.js` | All in-app dialogs. Takes rules through callbacks, never imports `api.js` |
| `help.js` | The Help panel. Receives Tauri access through `deps`, never imports `api.js` |
| `views.js` | Pure string builders |
| `icons.js` | The icon sprite. Generated by `scripts/build-icons.mjs` |

### Bundled sources, `ui-src/`

| Module | Built into | Owns |
|---|---|---|
| `editor.js` | `ui/editor.bundle.js` | The CodeMirror setup, one view with one `EditorState` per tab, the two built-in languages (`teachingLanguage`), loading the other languages (`LANGUAGE_CHUNKS`, `loadLanguages`), per-state Compartments for the language, the typing helpers (`helpersFor`, which gives the teaching helpers only to teaching kinds, C47) and the indent unit, Tidy |
| `hints.js` | `ui/editor.bundle.js` | HTML mistake hints (`findMistake`, `:62`), the hint widget every detector shares (`mistakeHints`, `:179`, with `forDetector`) and the unfinished-tag test (`unfinishedTagAt`, `:14`), which the update loop reuses at `ui/preview.js:468` |
| `code-hints.js` | its own chunk in `ui/editor/` | Mistake hints for JSON, JavaScript and TypeScript (0.3.0): a missing JSON comma, a bracket or a quote that never closes (`findMistake`). Only the json, javascript and typescript language chunks import it |
| `code-path.js` | `ui/editor.bundle.js` | The "You are inside" row for JavaScript, TypeScript, Python and JSON (`codePath`); null for other languages |
| `legacy-fold.js` | `ui/editor.bundle.js` | Folding for the legacy stream modes (`legacyFolding`): by bracket, else by indentation |
| `langs/<id>.js` | one chunk each in `ui/editor/` | One wrapper per language row (see below): `support(fileName)`, `legacy`, and for json, javascript and typescript also `findMistake` from `code-hints.js` |
| `structure.js` | `ui/editor.bundle.js` | Fold arrows, fold pills (with the Oops pill), the soft band, `insidePath`, `cssRuleAt` |
| `link-editor.js` | `ui/editor.bundle.js` | The editor half of page lighting: `codeElements` (elements in code order), `alignPage` (code list against the page's list), the lit lines and the tag-name pair |
| `explain.js` | `ui/editor.bundle.js` | Explanations on hover for tag names, CSS words, colour names and picture file names |
| `helper.js` | `src-tauri/helper.min.js` | Everything that runs inside the learner's page |
| `helper-inspect.js` | `src-tauri/helper.min.js` | The page half of page lighting: element numbering, hover, pick, outlines and box labels, drawn in a `<hl-layer>` with a closed shadow root |

Both built files are tracked in git, and both are rebuilt by esbuild at `scripts/sign-notarize.sh:12` and `:13`. The editor build uses code splitting: the entry stays `ui/editor.bundle.js` (the one `app.js` imports), and every other output is a chunk in `ui/editor/`, named `[name]-[hash]` (the hash depends only on content, and keeps esbuild's repeated `chunk` and `dist` names apart). Each language outside html and css has one wrapper module, `ui-src/langs/<id>.js` (one per row of `LANGUAGES` in `core/src/kinds.rs`, except `text`, and except `csharp` and `kotlin`, which are plain text because the legacy clike mode cannot load under the app's `freezePrototype`), which exports `support(fileName)` and `legacy`, and for json, javascript and typescript also `findMistake`. `editor.js` loads them only through `import()` (`LANGUAGE_CHUNKS`), so each language becomes its own chunk that is fetched the first time a file of that language opens; the paths that make tabs await `loadLanguages` first (`loadLanguagesFor` in `ui/flows.js`, also used by `ui/rename.js`), and `newState` throws for a language whose chunk is not loaded (`languageExtensions`), so a path that forgot fails a test. Code shared with the entry goes into chunks the entry imports statically, and code shared only by language chunks into chunks of their own: `code-hints.js` is one, imported by the json, javascript and typescript chunks only. Measured on 2026-11-09 at the WP6 bundle: 23 language chunks and 8 shared chunks in `ui/editor/`; the entry (93,150 bytes) and the 6 chunks it imports statically make 597.8 KB, everything together 1,169.8 KB in 32 files. The chunks are same-origin files, so the window CSP (`default-src 'self'` in `src-tauri/tauri.conf.json`) allows them. The build starts with `rm -rf ui/editor`, so a stale chunk shows up in git as a deletion; chunks are tracked in git with the entry, and additions and deletions are committed together. Size budgets: `editorBundleKb` is the entry plus the chunks it imports statically (what loads at start), `editorAllKb` is the entry plus every file in `ui/editor/` (`scripts/speed-run.py`, `static_closure` and `editor_files`).

## Boundaries

Allow-list for imports. A new edge is a decision, not a convenience.

| Layer | May depend on |
|---|---|
| `core/` | `serde`, `serde_json`, `dunce`, `unicode-normalization`; `libc` on Unix only; `windows-sys` on Windows only. Inside the crate: `content`, `names` use `kinds`; `files` uses `names`, `kinds`, `content`, `counts` and `refs` (for `content_hash`); `refs` uses `files`, `kinds` and `project` (its tag scanner); `prefs` uses `files`; `project` uses `files`, `kinds` and `counts`. `files` and `refs` use each other |
| `src-tauri/` | `htmllab_core`, Tauri and its dialog and opener plugins, `percent-encoding`, `dunce`, the `objc2` crates on macOS, and the clipboard-manager and single-instance plugins everywhere else |
| `ui/api.js` | Only `window.__TAURI__` |
| `ui/state.js`, `ui/views.js`, `ui/platform.js` | No project imports (`grep -n "import " ui/*.js`) |
| `ui/help.js` | `platform.js` |
| `ui/dialogs.js` | `views.js`, `platform.js` |
| `ui/link.js` | `state.js`. Everything else comes in as hooks through `initLink` |
| `ui/inside.js` | `state.js` (since 0.3.0, for `kindOf`). The rest comes in through `initInside` |
| `ui/preview.js` | `api.js`, `state.js`, `link.js`, `platform.js` |
| `ui/tabs.js` | `api.js`, `state.js`, `views.js`, `help.js`, `preview.js`, `link.js`, `inside.js` |
| `ui/flows.js` | `api.js`, `state.js`, `preview.js`, `tabs.js`, `dialogs.js`, `inside.js`, `platform.js` |
| `ui/rename.js` | `api.js`, `state.js`, `tabs.js`, `preview.js`, `flows.js`, `dialogs.js`, `inside.js`, `views.js`. `app.js` calls it for the `rename` command, so `flows.js` need not import it (no cycle) |
| `ui/app.js` | All of the above. Test harnesses load only through dynamic `import()` (`ui/app.js:622`, `:625`, `:628`); `ui/self-test.js` imports its modules `ui/self-test-*.js` statically |
| `ui-src/helper.js` | `morphdom` and `helper-inspect.js` only. It talks to the app through `postMessage`, never through Tauri |
| `ui-src/structure.js`, `link-editor.js`, `explain.js`, `code-path.js`, `legacy-fold.js` | CodeMirror packages only. App data (Help rows, picture URLs) comes in through `explainExtension`'s callbacks |
| `ui-src/code-hints.js` | Nothing. It reads the syntax tree it is given |
| `ui-src/langs/<id>.js` | Its language package (or `@codemirror/legacy-modes` and `@codemirror/language`); json, javascript and typescript also `code-hints.js` |

Enforced by:

- The `core/` boundary: the crate cannot name Tauri types without a `Cargo.toml` change.
- `ui/`, helper and html/css-naming boundaries: nothing automated (searched `core/src`, `ui/self-test.js` for a test asserting them; none found).

Known departures from the single-owner rule, measured 2026-11-08 and checked again 2026-11-09:

- The picture extension list exists in `core/src/kinds.rs:312` and again in `ui/preview.js:25`.
- The text size limits exist in `core/src/prefs.rs` (`TEXT_SIZE_MIN`, `TEXT_SIZE_MAX`) and in `ui/app.js:219` (`SIZE_MIN`, `SIZE_MAX`).
- The list of built-in photos exists in `core/src/content.rs:18` (`PICTURES`), in `BUILT_IN` at `scripts/build-templates.py:12`, and in `scripts/template-status.py`.
- `ui/flows.js:954` branches on `lang === 'css'` when placing a Help snippet, outside the kinds table.
- The language ids of `LANGUAGES` are repeated in `LANGUAGE_CHUNKS` (`ui-src/editor.js:60`), one `import()` per row, a static map so that esbuild can split them (the comment above it). `languageForName` in `ui/state.js` mirrors `language_for_name` in `core/src/kinds.rs`.
- `core/src/refs.rs` (`syntax_for`) names the endings of the reference syntaxes it reads (scss, less, js and the other script endings, svg, md), outside `LANGUAGES` (C37, known exception).

## The URL schemes

Both are registered at `src-tauri/src/main.rs:1325` and `:1337`, and both answer on a blocking thread. The app window's own policy is `app.security.csp` in `src-tauri/tauri.conf.json:26`: frames may come only from `preview:`, and images from the app, `data:`, `gallery:` and `preview:` (the picture shown when the mouse rests on a picture's file name, 0.2.0).

### `preview://`

`preview::respond` (`src-tauri/src/preview.rs:44`) serves three kinds of path, besides the app's own fonts under `/__fonts/`. Query strings do not reach it, because the handler passes `request.uri().path()`.

| Path | Source |
|---|---|
| `/__help/<topic>/<file>` | Help data only (`content::help_bytes`, `preview.rs:70`). No helper is injected |
| `/__new/<project>/<file>` | A project with no folder yet. Memory only (`buffers`, then `pictures`), never disk |
| any other absolute path | Buffer first (unsaved text), then disk, and disk only inside a registered root (`Store::inside_root`, `:32`). Text from disk goes through `files::decode_text`, the reader's own decoder, so a UTF-16 file reaches the page as UTF-8 without its BOM; pictures, fonts and anything that is not text stay raw (`serve_disk`, `:107`, 0.3.0) |

Order of checks: a `..` segment is refused first (`:51`), then the fonts (`:55`), then Help (`:67`), then the buffer (`:83`), then the picture table (`:87`), then the root check (`:96`). `inside_root` canonicalizes, so a symlink leading out of a root is refused too. Roots are added and removed by the `add_root` and `remove_root` commands as projects open and close.

Every successful response carries a policy (`serve`, `:130`). A page gets `kinds::csp_for`, with a per-run nonce made once at launch (`make_nonce`, `main.rs:1168`). Anything else gets `NOT_A_PAGE_CSP` (`preview.rs:11`), so an SVG opened as its own page runs nothing; since 0.3.0 that includes JSON, XML, plain text and Markdown (`mime_for`). A missing page gets a friendly page with the helper and status 404 (`missing`, `:159`); other missing files get an empty 404 (`empty_404`, `:175`).

### `gallery://`

Serves template previews and thumbnails to the New dialog (`ui/dialogs.js:258`). `content::gallery_image` (`core/src/content.rs:68`) accepts only `/previews/<name>` and `/thumbs/<name>`, and `plain_picture_name` (`:77`) refuses any other file name shape. Template photos do not use this scheme. They go through the `preview://` picture table like built-in photos (see "Template and sample content").

## The sandboxed iframe and the helper

The iframe is declared in `ui/index.html:123` with `sandbox="allow-scripts"`, without `allow-same-origin`. Help's result frames use an empty sandbox (`ui/help.js:441`) and carry no helper.

`preview.rs::inject_helper` (`:190`) places the helper as an inline script with the nonce, at the start of the document or right after the doctype (`insert_position`, `:209`). With `SCRIPT_POLICY` set to `Blocked`, the nonce is the only script source the page CSP allows, so the helper runs and the learner's scripts do not.

The helper (`ui-src/helper.js`):

- removes its own tag at once (`:6` to `:7`);
- applies HTML updates by parsing with `DOMParser` and calling `morphdom` (`updateHtml`, `:76`), and reports `fail` if the quirks mode would change (`:80`);
- applies live CSS by replacing each matching `<link>` with `<style data-hl-file>` in the same place (`applyOverride`, `:55`);
- catches clicks and turns them into `nav` or `ext` messages (`:149`);
- posts `ready` after `DOMContentLoaded`, once linked sheets have loaded or failed, with a capped wait (`whenStyled`, `:218`). This is the one timer in the file, despite the comment at `:2`;
- ignores messages from any source but the parent (`:130`). Both sides ignore unknown message types.

### Page lighting (0.2.0)

`helper-inspect.js` numbers the page's elements in document order, leaving out its own nodes (`<hl-layer>` and `style[data-hl-fonts]`). morphdom keys those own nodes by name, so they are never paired with the learner's elements and never discarded. Every change bumps a page version `pv`, sent in `ready` and `done`.

The app asks once per `pv` for the list of names (`names`), and `link-editor.js` `alignPage` pairs it with the elements in the code. A number from the page is used only while `inSync()` holds and its `pv` is the current one, so a reply about older text is dropped rather than lighting the wrong line.

| App to page | Page to app |
|---|---|
| `names` | `names` (list, `pv`) |
| `mark` (number, `pv`): the 2 second outline | `over` (chain of numbers, `pv`), `out` |
| `rule` (selector, or null to clear) | `ruled` (count, `pv`) |
| `point` (on or off) | `pick` (chain, `pv`), `pointOff` (Esc in the page) |
| `boxes` (on or off) | `boxed` (count, `pv`) |

A `ruled` reply to an ask sent before a clear is dropped (`dropReplies` in `link.js`).

Box labels (0.2.1): `boxOutlines` in `helper-inspect.js` tries the spots of `labelSpots` in turn (above the box, then inside its top, each at the left and then at the right) and takes the first that covers no line of text and no other label. The lines of text come from `textRows`. The count of labels still over text is in the probe's `inspect` (`labelsOverText`) for the self-test.

Closing the last tab turns Show the Boxes off (`link.onAllClosed`, called by `preview.reset`), so the next page starts without boxes (0.2.1).

## The preview update loop

Owner: `ui/preview.js`. All state is in `P` (`:23`).

`S.ed` reports a change to `onEditorUpdate` (`ui/app.js:51`), which calls `preview.onKey` (`ui/preview.js:428`). There are three ways to update the page:

| Tier | When | How |
|---|---|---|
| CSS message | a tab whose kind has `previewMode: 'swap'` changed | `pump` sends `{ t: 'css' }` (`:97`) |
| HTML message | a page tab changed | `pump` sends `{ t: 'html' }` with the latest text (`:104`), helper morphs |
| Real load | first show, another project, a lost helper | `load` (`:172`) sets `iframe.src` with `?v=<loadId>` |

- One message is out at a time (`P.out`). Text is read when sending, not when typing (`pump`, `:89`), so no queue forms.
- `pump` sends nothing while Help shows, while an unfinished tag is being typed (`updateHold`, `:407`), or during the wait for a slow page (`restartBigWait`, `:395`).
- Before a real load, `syncBuffers` (`:161`) sends Rust the text of changed or unsaved tabs. `set_buffers` is not called per key by the loop.
- `ready` carrying another `v` is dropped (`:243`). A silent first load is retried once (`armReadyWait`, `:212`). A `done` that never comes triggers a real load through the two-stage watchdog (`armWatchdog`, `:135`).
- Clicks in the page arrive as `nav` (`onNav`, `:338`). A click on an open page follows its tab; a click on a picture shows it with no helper (`:372`).
- `pump` also sends nothing while the My page side is hidden, and `load` then only records `P.loadWanted` (C46, see "The My page side" below).
- On window focus, `folder_stamp` decides whether files changed outside the app (`onWindowFocused`, `:746`). It stats at most 2,000 entries, and for a lone project (opened alone in a big folder, or made of non-web files) only its open files that are on disk (`stampArgs` in `ui/state.js`, C48).

## The My page side (0.3.0)

The right half of the window (My page and Help) can be hidden. Owners: `ui/app.js` for the choice and the layout, `ui/tabs.js` for when it is decided, `ui/preview.js` for the pause.

- The choice: `S.sideShown` is what shows, `S.sideManual` is the user's own choice (`null`, `'shown'` or `'hidden'`). With no choice by hand the side follows the active tab (`autoSide`): shown for a page or a `swap` kind (style files), hidden for every other file (`isOther` in `ui/state.js`). A click on `#btn-side` or View > My Page Side sets `S.sideManual`, and clears it when the new state equals the automatic one (`toggleSide`). The start screen always shows the side (`sideWanted`). `S.sideManual` goes back to `null` when the last tab closes and when New project, a sample, a template or Try it opens (`ui/flows.js`).
- When: `withSide` in `ui/tabs.js` decides the side before the preview hears of a tab switch, and draws it after (`drawSide`), so a hidden side pauses at once and a side that comes back loads only once. Help, Help on This Word, Start here and View > My Page or Help show the side first, as a click would (`showSide`).
- Layout: `#main.side-hidden` hides `#divider` and `#right` and gives `#left` the full width over any width left by a divider drag (`ui/style.css`); the drag width comes back when shown.
- The pause (C46): while hidden, `pump` returns at once, `load` records `P.loadWanted` instead of setting `iframe.src`, and `inSync` and `showingPageTab` are false, so nothing lights in the code; hiding turns Point off and clears the lit lines (`link.onHelpShown`). `onSideShown` then loads if a load was wanted, or else pumps, and puts the header and the width back. While hidden, `set_menu_state` gets `sideShown: false`, so Show the Boxes is greyed.
- Beside a file that is not a web page (shown by hand), `relatedPage` in `ui/preview.js` picks the page to show, in this order: an open page tab whose text uses the file; a page in the file's own folder that uses it (`pages_using`, at most 500 entries and 50 pages, `core/src/refs.rs`); the project's page tab or any page of that folder, with the hint "A page from this folder"; or the no-page state. The page is served from disk through the existing root and never opens as a tab.
- Session: `Session.side` in `core/src/prefs.rs` holds `S.sideManual`, written with the tabs and restored only with them (`ui/flows.js`); a test run ignores it.

## Project and file handling

- Tabs and projects live in `S` (`ui/state.js`). A project with no folder uses paths `__new/<id>/<file>` (`newPath`, `ui/flows.js:116`), so the same path works as a tab key and a `preview://` buffer key.
- Open: native panel (`pick_files`, `main.rs:81`; since 0.3.0 with no filter on macOS, and "All files" first elsewhere), then `plan_open` and, for a file, `scan_folder` (`core/src/project.rs:210`). Any regular file opens; the read decides whether it is text. Only teaching-kind files count towards a project (2 to 20), so other files no longer stop a folder from being one. The folder is read once and at most 2,000 entries (`MAX_SCAN_ENTRIES`); past that, the file opens alone and the project is marked `lone` (C48). A scan that stops early at more than 20 web files says so (`stoppedEarly`); the file then opens lone too, so the folder is read once, not again by `folder_stamp` (C48, since cdfab87b). A folder with no web files opens up to 10 text files, `README*` first.
- Read: `read_files` (`core/src/files.rs:125`) refuses a file over 5 MB (`too_big`), a NUL byte without a UTF-16 BOM (`not_text`) and text that is neither UTF-8 nor UTF-16 with a BOM (`other_encoding`), all through `decode_text` (`:192`, C10). Each result carries the text's `TextStyle` (`detect_style`, `:234`), which `addTab` keeps as `tab.style`. The editor itself holds only LF text.
- Writing a text: every save path sends the text with `writeStyle(tab.style)` (`ui/state.js`), and Rust turns it back into the file's own bytes with `encode_text` (`core/src/files.rs:316`): line ending, encoding, BOM (C43). An unknown style value writes nothing for that file (`cannot_write`).
- First save: `save_project` uses `fs::create_dir` (`files.rs:543`), which fails if the folder exists, so an existing folder is never merged. A partial failure removes what was created (`created.remove()`).
- Later saves: `write_files` through `atomic_write`, which writes `.<name>.htmllab-tmp`, syncs, then renames. With `must_not_exist` it publishes through a hard link so it cannot replace a file (`publish_no_clobber`).
- Autosave is off by default (`core/src/prefs.rs`, `Prefs::default`) and runs from `autosaveNow` (`ui/flows.js:648`) only for projects with a folder.
- Change Name (0.3.0): `ui/rename.js`. A click on the active tab's name opens a field; `check_name` and `file_name_free` check the new name as it is typed. Enter asks `find_references` for the places (`walk` true reads the project folder, and open tabs send their current text; a second call with `walk` false reads the saved text of changed tabs, which is what is on disk) and opens the dialog. On "Change the name", inside the project's write queue: plan again and compare with the dialog's plan; `rename_file` (C44), or a change in memory only for a tab never written; then, when ticked, `rewrite_references` for closed files and open tabs alike, each in its own project's queue (C45), and the same spans as an editor transaction that Cmd+Z never undoes; then tab, path, kind, language, buffers, session, stamp and preview. Undo on the toast checks with `restore_references` (`check: true`) that every touched file is as the rename left it and can still be written, then puts the bytes and the name back; a file it could not write back is named on the toast, and a file the rename wrote that was opened in a new tab afterwards ends Undo; `forget_rewrites` lets the kept bytes go when the toast ends. Rules and races: [ADR 0010](adr/0010-rename-and-reference-rules.md).
- Quit: every route reaches `begin_quit` (`main.rs:788`): the Quit menu item, the window close event (`:1257`), `RunEvent::ExitRequested` (`:1486`), and Dock Quit or logout through `should_terminate` (`:1185`). JavaScript must acknowledge with `close_ack` (`:835`), or a native question appears after a fixed wait.

## Template and sample content

Authored sources and packed output live side by side in `core/content/`.

| Path | What it is | How the app gets it |
|---|---|---|
| `starters.json`, `samples.json`, `help.json`, `help-design.json`, `help-effects.json` | Starters, samples, Help topics | Compiled in with `include_str!` (`core/src/content.rs:11` to `:17`) |
| `pictures/` | Built-in photos | Compiled in with `include_bytes!` (`content.rs:26`) |
| `templates/<id>/` | Template source folders. Authoring rules: `templates/RULES.md` | Not read by the app |
| `gallery/` | Output of the packer: `templates.json`, `pictures/`, `previews/`, `thumbs/`, `SOURCES.md` | Copied to the app's Resources by `bundle.resources` (`src-tauri/tauri.conf.json:34`), read from disk at run time |

The gallery is outside the binary on purpose (comment at `content.rs:42`). `gallery_dir` (`main.rs:413`) finds it in Resources and has a fallback for a program reached through a symlink. In a release build with no directory set the gallery is empty; only a debug build falls back to the source folder (`content.rs:58`).

Counts on 2026-11-08: 42 template folders (`ls -d core/content/templates/*/ | wc -l`), 42 entries in `gallery/templates.json` (`json.load` length), 5 samples, 7 built-in photos, 97 Help topics (66 + 10 + 21, `len(topics)` of the three Help files), 8 Help groups.

Pipeline: `core/content/templates/<id>/` -> `scripts/build-templates.py` -> `core/content/gallery/`.

1. Every folder needs a `template.json`, and each category must be known (`build-templates.py:137`, `:148`).
2. Each template must get a `PASS` line from `scripts/check-template.py` (`:154` to `:165`). `--draft` and `--only=` exist for trying things, and report partial output out loud (`:235`).
3. Pages, `style.css`, pictures and SVGs become entries of `templates.json` (`:167` to `:204`). Pictures that are not built in are copied to `gallery/pictures/`.
4. `scripts/render-page.swift`, compiled on demand (`renderer`, `:45`), draws each home page. `cwebp` makes the preview and the thumbnail under size limits (`webp`, `:68`).
5. Anything no template uses any more is deleted from the gallery (`:219` to `:226`).

Opening a template or sample is the same path as any content: `open_sample` returns a `ProjectContent` copy, and `openContent` (`ui/flows.js:101`) sends text and picture flags through `set_buffers`, where `main.rs:252` resolves a picture through `content::picture`. A template whose `needs` conditions fail in this WebKit is left out of the list by `shownHere` (`ui/flows.js:125`).

Adjacent tools: `scripts/template-status.py` reports each template's stage from evidence; `scripts/design-detect.mjs` runs a design detector over the templates; `scripts/build-icons.mjs` writes `ui/icons.js`.

## Test harnesses

| Harness | Where | What it drives |
|---|---|---|
| Rust tests | `#[cfg(test)]` in each module: 315 in `core/src/`, 24 in `src-tauri/src/`, and 3 in `src-tauri/tests/open_with.rs`, which checks that the four Open With lists agree (`grep -c "#\[test\]"`, 2026-11-09) | Pure rules, the responder, menu accelerators, the Open With lists |
| Self-test | `ui/self-test.js` and its modules, launched with `--self-test` or `--self-test=WORDS`. Each module exports one `xTests(h)` and its count: `self-test-see.js` (0.2.0), and for 0.3.0 `self-test-files.js` (text styles, encodings, huge folders), `self-test-langs.js` (languages), `self-test-side.js` (the My page side), `self-test-newfile.js` (the +), `self-test-rename.js` (Change Name) and `self-test-hints-code.js` (JSON, JavaScript and TypeScript hints) | Real app logic against real Rust commands, through dispatch and DOM clicks. Includes `ui/engine-check.js`, which asks the running WebKit whether shipped CSS works |
| Smoke test | `ui/smoke-test.js`, launched with `--smoke-test` | Real pointer sequences at `elementFromPoint`; photographs every screen through `test_snapshot` (`main.rs:947`) |
| Speed check | `ui/speed-check.js`, launched with `--speed-check` | A fixed measured scenario. Budgets in `scripts/speed-budgets.json`, compared by `scripts/speed-gate.py` |

- Launch flags are parsed by `read_flags` (`main.rs:1148`). The harness modules load only when a flag is set (`ui/app.js:621` to `:629`), so they are inert in normal use, though shipped.
- In test mode `open_in_safari` opens nothing: it keeps the path for `test_browser_opened`, so a test can check the command ran (0.2.1).
- The self-test's `settle` builds its timeout message when the wait ends, so the message shows the phase, page version and last page message at that moment (0.2.1, BACKLOG V5).
- The `test_*` commands refuse unless `test_mode` is on (`main.rs:922`), and those touching disk also require the temp folder (`test_path_ok`, `:1028`). `test_window_state` is the exception: it reads window state without that check (`:1121`). Added in 0.3.0: `test_read_bytes` (a file's raw bytes, so a test sees what was really written), `test_make_tree` (a folder of many empty files, for C48; `ext` picks their ending, `dat` when left out), `test_fs_counts` (the `counts.rs` counters, with a reset) and `test_set_window_size`.
- `scripts/selftest-run.py` copies a build to a test Mac, runs it, and does not trust the report's own counts (`problems`, `:63`). A run with fewer tests than the pinned `MIN_TESTS` or `MIN_STEPS` fails.
- `scripts/speed-run.py` measures on the Intel test Mac. `scripts/intel-run.sh` builds and starts a quick x86_64 test build there.
- No CI configuration found (searched: `ls app/.github`, `ls .github` at the project root).

## Release traceability

- Version: `src-tauri/tauri.conf.json:3` is shown to users. `scripts/sign-notarize.sh:33` to `:39` refuses a build when it differs from `package.json` or `src-tauri/Cargo.toml`. The `core` crate has its own unrelated version.
- Commit: the script refuses uncommitted changes under `app/` (`:23` to `:32`). `HTMLLAB_TEST_BUILD=1` permits them and marks the revision `-dirty`. The revision is written to `Info.plist` as `HTMLLabRevision` before signing (`:45`).
- Output: `app/src-tauri/target/hand-over/build.json` next to the zip records version, revision and the zip's SHA-256 (`:62`), in `app/src-tauri/target/hand-over/`, which is gitignored.
- Test evidence: `test-history/<version>-<revision>/<host>-<kind>.json` (`history_file`, `scripts/selftest-run.py:49`) and `speed-history/<version>-<revision>.json` and `.txt` (`scripts/speed-run.py:195`). Both folders are tracked in git. A build with no revision is reported as `unstamped` (`build_of`, `selftest-run.py:34`).
- Bundles: both esbuild outputs (the editor entry with its chunks in `ui/editor/`, and the helper) are tracked and rebuilt before the uncommitted-change check, so a commit whose bundle is older than its source is refused (`sign-notarize.sh:12` and `:13` build, `:16` checks).

## Data and state

| What | Where | Lifetime |
|---|---|---|
| Learner's projects | A folder the learner chooses | Permanent, written only by save paths in `files.rs` |
| Preferences, including reopened tabs, the My page side choice (`Session.side`, 0.3.0) and window size | prefs.json in the app config folder | Permanent. Atomic save |
| Script errors | `errors.log` in the app log folder, size-capped (`log_error`, `main.rs:612`) | Permanent until removed |
| Test reports and screenshots | App log folder, test flags only | Replaced by the next run |
| Unsaved text, built-in pictures in use, allowed roots | `preview::Store`, memory | One run |
| The bytes each Change Name rewrite replaced, for Undo (0.3.0) | `AppState.rewritten`, memory. Never sent to the UI | Until the Undo toast ends (`forget_rewrites`) |
| Tabs, editor states, dialog state | `S`, memory | One run |

On upgrade there is no migration step. `Prefs` has no version field (`core/src/prefs.rs:30`). `prefs::load` merges what it can read: a missing or broken file gives the defaults, and a key of the wrong type keeps its default (comment at `prefs.rs:54`).

## What this architecture deliberately does not do

- **Run the learner's scripts.** `SCRIPT_POLICY` is `Blocked` (`core/src/kinds.rs:391`). The `Run` arm of `csp_for` exists and `SCRIPT_POLICY` is not switched by any setting. Since 0.3.0 JavaScript, Python and the other languages open, get colours, folding and Tidy, but nothing in them is run, compiled or evaluated (NEXT-0.3.0.md, O2).
- **Replace a file when renaming.** `files::rename_file` never replaces an existing file (C44); see [ADR 0010](adr/0010-rename-and-reference-rules.md) for the fallbacks and their race.
- **Change a name in prose.** Change Name rewrites only the reference forms `refs.rs` knows (C45).
- **Merge into an existing folder.** See `save_project` above.
- **Treat a stylesheet in another folder as live.** The helper treats a stylesheet as local only in the page's own folder (`ui-src/helper.js:18`), so live CSS applies to flat projects only.
- **Update itself.** No updater plugin in `src-tauri/Cargo.toml` (searched: `grep -n updater`, 0 hits).
- **Submit forms from the preview.** The page CSP has `form-action 'none'` (`core/src/kinds.rs:406`).

Decisions with a recorded reason are under [adr/](adr/).
