---
class:   truth
updated: 2026-11-08
status:  current
---

# Architecture of HTML Lab

This document explains the shape of the code: where the code that does X lives, and what may not depend on what. Paths are relative to `app/`. A citation such as `ui/preview.js:89` was opened when this was written (2026-11-08). If a line has moved, the symbol named next to it is the reference. Exact values (limits, timings, policies) live in the cited code and are not repeated as authority here. See [INDEX.md](INDEX.md) for the tie-break rule.

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
 |       project, files, content, prefs                        |
 +-------------------------------------------------------------+
        ^  invoke / events              ^  preview:// and gallery://
        |  (ui/api.js only)             |
 Web view (WebKit)                      |
 +--------------------------------------|----------------------+
 | ui/: app, flows, tabs, preview,      |                      |
 |      dialogs, help, views, state     |                      |
 | ui/editor.bundle.js (CodeMirror)     |                      |
 |    |  postMessage (ui/preview.js)    |                      |
 |    v                                 |                      |
 | iframe#preview sandbox="allow-scripts"                      |
 |    the learner's page + ui-src/helper.js, injected by Rust  |
 +-------------------------------------------------------------+
```

Rules the sketch encodes. Breaking one is a regression, not a refactor.

- `core/` has no Tauri dependency (`core/Cargo.toml` lists `serde`, `serde_json`, `libc`), so `cargo test` in `core/` needs no window.
- `ui/api.js` is the only file that touches `window.__TAURI__` (searched: `grep -ln "__TAURI__" ui/*.js ui-src/*.js`, excluding the bundle).
- `ui/preview.js` is the only production file that uses the iframe's `contentWindow` and `src` (searched: `grep -ln contentWindow ui/*.js`; the other hits are the test harnesses `ui/self-test.js:302` and `ui/speed-check.js:441`).
- `core/src/kinds.rs` is the only Rust code that names `"html"` and `"css"` (searched: `grep` for both strings in `core/src/*.rs` and `src-tauri/src/*.rs`, 0 hits before each `#[cfg(test)]` outside `kinds.rs`). The JavaScript counterpart is `languageFor` in `ui-src/editor.js:42`.
- `kinds::csp_for` (`core/src/kinds.rs:115`) is the only code that writes `script-src`.
- `files::atomic_write` (`core/src/files.rs:130`) is the path for saved text and preferences. The other direct disk writes are the `fs::copy` of existing files in Save a Copy (`core/src/files.rs:379`) and the test-only or log commands in `src-tauri/src/main.rs` (`write_log_file`, `log_error`, the `test_*` commands).

## Module map

One owner per concern.

### Rust core, `core/src/`

| Module | Owns |
|---|---|
| `kinds.rs` | The `KINDS` table (`:31`), the picture extension list (`:62`), MIME types (`mime_for`, `:84`), the script policy (`SCRIPT_POLICY`, `:112`) and the page CSP (`csp_for`, `:115`) |
| `names.rs` | Cleaning file and project names; whether a file name is free (`file_name_free`, `:58`) |
| `project.rs` | What counts as a project when a file is opened (`scan_folder`, `:72`), which CSS a page links (`linked_css`, `:149`), where a new `<link>` goes (`add_link`, `:205`) |
| `files.rs` | Read rules (`read_text`, `:102`), atomic writes (`atomic_write`, `:130`), first save (`save_project`, `:303`), Save a Copy (`save_copy`, `:385`), the folder change stamp (`folder_stamp`, `:435`) |
| `content.rs` | Starters, samples, Help and pictures as data (`include_str!` and `include_bytes!`, `:11` to `:39`), and reading the gallery folder at run time (`gallery_dir`, `:58`) |
| `prefs.rs` | The preferences shape, its defaults, and merging a patch (`merge`, `:89`) |

### Tauri shell, `src-tauri/src/`

| Module | Owns |
|---|---|
| `main.rs` | The command list (`generate_handler!`, `:1058`), `AppState` (`:21`), the one quit flow (`begin_quit`, `:473`), the macOS terminate handler (`mod mac`, `:829`), native panels (`PanelGuard`, `:58`), launch flags (`read_flags`, `:797`), registration of both URL schemes (`:964`, `:977`) |
| `menu.rs` | The native menu items and which are enabled (`item_enabled`). Custom ids go to JavaScript as the `menu` event, except `quit` (`on_menu_event`, `main.rs:948`) |
| `preview.rs` | Answering `preview://` (`respond`, `:49`), the in-memory `Store` of buffers, pictures and allowed roots (`:18`), placing the helper in a page (`insert_position`, `:168`) |

### Screens, `ui/`

| Module | Owns |
|---|---|
| `api.js` | The bridge to Tauri (`invoke`, `listen`) |
| `state.js` | The shared in-memory state `S` and its read-only accessors |
| `app.js` | Boot (`boot`, `:380`), which screens show (`layout`, `:73`), menu command dispatch (`COMMANDS`, `:176`), loading the editor bundle (`whenEditor`, `:35`) |
| `flows.js` | The order of steps in New, Open, Save, Close, Quit, Try it and autosave |
| `tabs.js` | The tab strip, the status line, and the single sender of `set_menu_state` |
| `preview.js` | The preview update loop and the page header |
| `dialogs.js` | All in-app dialogs. Takes rules through callbacks, never imports `api.js` |
| `help.js` | The Help panel. Receives Tauri access through `deps`, never imports `api.js` |
| `views.js` | Pure string builders |
| `icons.js` | The icon sprite. Generated by `scripts/build-icons.mjs` |

### Bundled sources, `ui-src/`

| Module | Built into | Owns |
|---|---|---|
| `editor.js` | `ui/editor.bundle.js` | The CodeMirror setup, one view with one `EditorState` per tab, `languageFor`, Tidy |
| `hints.js` | `ui/editor.bundle.js` | Mistake hints (`findMistake`, `:67`) and the unfinished-tag test (`unfinishedTagAt`, `:17`), which the update loop reuses at `ui/preview.js:412` |
| `helper.js` | `src-tauri/helper.min.js` | Everything that runs inside the learner's page |

Both built files are tracked in git, and both are rebuilt by esbuild at `scripts/sign-notarize.sh:16` and `:17`.

## Boundaries

Allow-list for imports. A new edge is a decision, not a convenience.

| Layer | May depend on |
|---|---|
| `core/` | `serde`, `serde_json`, `libc`. Inside the crate: `content`, `names`, `project` use `kinds`; `files` uses `names`; `prefs` uses `files`; `project` uses `files` and `kinds` |
| `src-tauri/` | `htmllab_core`, Tauri and its dialog and opener plugins, `percent-encoding`, and the `objc2` crates on macOS |
| `ui/api.js` | Only `window.__TAURI__` |
| `ui/state.js`, `ui/views.js`, `ui/help.js` | No project imports (`grep -n "import " ui/*.js`) |
| `ui/dialogs.js` | `views.js` |
| `ui/preview.js` | `api.js`, `state.js` |
| `ui/tabs.js` | `api.js`, `state.js`, `views.js`, `help.js`, `preview.js` |
| `ui/flows.js` | `api.js`, `state.js`, `preview.js`, `tabs.js`, `dialogs.js` |
| `ui/app.js` | All of the above. Test harnesses load only through dynamic `import()` (`ui/app.js:446`, `:449`, `:452`) |
| `ui-src/helper.js` | `morphdom` only. It talks to the app through `postMessage`, never through Tauri |

Enforced by:

- The `core/` boundary: the crate cannot name Tauri types without a `Cargo.toml` change.
- `ui/`, helper and html/css-naming boundaries: nothing automated (searched `core/src`, `ui/self-test.js` for a test asserting them; none found).

Known departures from the single-owner rule, measured 2026-11-08:

- The picture extension list exists in `core/src/kinds.rs:62` and again in `ui/preview.js:21`.
- The text size limits exist in `core/src/prefs.rs` (`TEXT_SIZE_MIN`, `TEXT_SIZE_MAX`) and in `ui/app.js:126`.
- The list of built-in photos exists in `core/src/content.rs:26`, in `BUILT_IN` at `scripts/build-templates.py:30`, and in `scripts/template-status.py`.
- `ui/flows.js:878` branches on `lang === 'css'` when placing a Help snippet, outside `languageFor`.

## The URL schemes

Both are registered at `src-tauri/src/main.rs:964` and `:977`, and both answer on a blocking thread. The app window's own policy is `app.security.csp` in `src-tauri/tauri.conf.json:26`: frames may come only from `preview:`, and images from the app, `data:` and `gallery:`.

### `preview://`

`preview::respond` (`src-tauri/src/preview.rs:49`) serves three kinds of path. Query strings do not reach it, because the handler passes `request.uri().path()`.

| Path | Source |
|---|---|
| `/__help/<topic>/<file>` | Help data only (`content::help_bytes`, `preview.rs:60`). No helper is injected |
| `/__new/<project>/<file>` | A project with no folder yet. Memory only (`buffers`, then `pictures`), never disk |
| any other absolute path | Buffer first (unsaved text), then disk, and disk only inside a registered root (`Store::inside_root`, `:36`) |

Order of checks: a `..` segment is refused first (`:56`), then Help (`:60`), then the buffer (`:76`), then the picture table (`:80`), then the root check (`:89`). `inside_root` canonicalizes, so a symlink leading out of a root is refused too. Roots are added and removed by the `add_root` and `remove_root` commands as projects open and close.

Every successful response carries a policy (`serve`, `:98`). A page gets `kinds::csp_for`, with a per-run nonce made once at launch (`make_nonce`, `main.rs:815`). Anything else gets `NOT_A_PAGE_CSP` (`preview.rs:14`), so an SVG opened as its own page runs nothing. A missing page gets a friendly page with the helper and status 404 (`missing`, `:123`); other missing files get an empty 404 (`:139`).

### `gallery://`

Serves template previews and thumbnails to the New dialog (`ui/dialogs.js:258`). `content::gallery_image` (`core/src/content.rs:68`) accepts only `/previews/<name>` and `/thumbs/<name>`, and `plain_picture_name` (`:77`) refuses any other file name shape. Template photos do not use this scheme. They go through the `preview://` picture table like built-in photos (see "Template and sample content").

## The sandboxed iframe and the helper

The iframe is declared in `ui/index.html:123` with `sandbox="allow-scripts"`, without `allow-same-origin`. Help's result frames use an empty sandbox (`ui/help.js:441`) and carry no helper.

`preview.rs::inject_helper` (`:156`) places the helper as an inline script with the nonce, at the start of the document or right after the doctype (`insert_position`, `:168`). With `SCRIPT_POLICY` set to `Blocked`, the nonce is the only script source the page CSP allows, so the helper runs and the learner's scripts do not.

The helper (`ui-src/helper.js`):

- removes its own tag at once (`:6` to `:7`);
- applies HTML updates by parsing with `DOMParser` and calling `morphdom` (`updateHtml`, `:76`), and reports `fail` if the quirks mode would change (`:80`);
- applies live CSS by replacing each matching `<link>` with `<style data-hl-file>` in the same place (`applyOverride`, `:55`);
- catches clicks and turns them into `nav` or `ext` messages (`:149`);
- posts `ready` after `DOMContentLoaded`, once linked sheets have loaded or failed, with a capped wait (`whenStyled`, `:218`). This is the one timer in the file, despite the comment at `:2`;
- ignores messages from any source but the parent (`:130`). Both sides ignore unknown message types.

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
- On window focus, `folder_stamp` decides whether files changed outside the app (`onWindowFocused`, `:561`).

## Project and file handling

- Tabs and projects live in `S` (`ui/state.js`). A project with no folder uses paths `__new/<id>/<file>` (`ui/flows.js:93`), so the same path works as a tab key and a `preview://` buffer key.
- Open: native panel (`pick_files`), then `scan_folder`. A folder counts as a project under the conditions at `core/src/project.rs:122` to `:125`. Pictures and subfolders do not disqualify it (`:103`); any other file kind does.
- Read: `read_text` (`core/src/files.rs:102`) refuses files over its limit, non-UTF-8, and files with a NUL byte.
- First save: `save_project` uses `fs::create_dir` (`files.rs:309`), which fails if the folder exists, so an existing folder is never merged. A partial failure removes what was created (`created.remove()`).
- Later saves: `write_files` through `atomic_write`, which writes `.<name>.htmllab-tmp`, syncs, then renames. With `must_not_exist` it publishes through a hard link so it cannot replace a file (`publish_no_clobber`).
- Autosave is off by default (`core/src/prefs.rs`, `Prefs::default`) and runs from `autosaveNow` (`ui/flows.js:601`) only for projects with a folder.
- Quit: every route reaches `begin_quit` (`main.rs:473`): the Quit menu item, the window close event (`:916`), `RunEvent::ExitRequested` (`:1113`), and Dock Quit or logout through `should_terminate` (`:837`). JavaScript must acknowledge with `close_ack`, or a native question appears after a fixed wait (`:493`).

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
| Rust unit tests | `#[cfg(test)]` in each module: 194 in `core/src/`, 14 in `src-tauri/src/` (`grep -c "#\[test\]"`, 2026-11-08) | Pure rules, the responder, menu accelerators |
| Self-test | `ui/self-test.js`, launched with `--self-test` or `--self-test=WORDS` | Real app logic against real Rust commands, through dispatch and DOM clicks. Includes `ui/engine-check.js`, which asks the running WebKit whether shipped CSS works |
| Smoke test | `ui/smoke-test.js`, launched with `--smoke-test` | Real pointer sequences at `elementFromPoint`; photographs every screen through `test_snapshot` (`main.rs:633`) |
| Speed check | `ui/speed-check.js`, launched with `--speed-check` | A fixed measured scenario. Budgets in `scripts/speed-budgets.json`, compared by `scripts/speed-gate.py` |

- Launch flags are parsed by `read_flags` (`main.rs:797`). The harness modules load only when a flag is set (`ui/app.js:445` to `:453`), so they are inert in normal use, though shipped.
- The `test_*` commands refuse unless `test_mode` is on (`main.rs:604`), and those touching disk also require the temp folder (`test_path_ok`, `:712`). `test_window_state` is the exception: it reads window state without that check (`:781`).
- `scripts/selftest-run.py` copies a build to a test Mac, runs it, and does not trust the report's own counts (`problems`, `:63`). A run with fewer tests than the pinned `MIN_TESTS` or `MIN_STEPS` fails.
- `scripts/speed-run.py` measures on the Intel test Mac. `scripts/intel-run.sh` builds and starts a quick x86_64 test build there.
- No CI configuration found (searched: `ls app/.github`, `ls .github` at the project root).

## Release traceability

- Version: `src-tauri/tauri.conf.json:3` is shown to users. `scripts/sign-notarize.sh:33` to `:39` refuses a build when it differs from `package.json` or `src-tauri/Cargo.toml`. The `core` crate has its own unrelated version.
- Commit: the script refuses uncommitted changes under `app/` (`:23` to `:32`). `HTMLLAB_TEST_BUILD=1` permits them and marks the revision `-dirty`. The revision is written to `Info.plist` as `HTMLLabRevision` before signing (`:45`).
- Output: `app/src-tauri/target/hand-over/build.json` next to the zip records version, revision and the zip's SHA-256 (`:62`), in `app/src-tauri/target/hand-over/`, which is gitignored.
- Test evidence: `test-history/<version>-<revision>/<host>-<kind>.json` (`history_file`, `scripts/selftest-run.py:49`) and `speed-history/<version>-<revision>.json` and `.txt` (`scripts/speed-run.py:195`). Both folders are tracked in git. A build with no revision is reported as `unstamped` (`build_of`, `selftest-run.py:34`).
- Bundles: both esbuild outputs are tracked and rebuilt before the uncommitted-change check, so a commit whose bundle is older than its source is refused (comment at `sign-notarize.sh:14`).

## Data and state

| What | Where | Lifetime |
|---|---|---|
| Learner's projects | A folder the learner chooses | Permanent, written only by save paths in `files.rs` |
| Preferences, including reopened tabs and window size | prefs.json in the app config folder (`main.rs:998`) | Permanent. Atomic save |
| Script errors | `errors.log` in the app log folder, size-capped (`log_error`, `main.rs:612`) | Permanent until removed |
| Test reports and screenshots | App log folder, test flags only | Replaced by the next run |
| Unsaved text, built-in pictures in use, allowed roots | `preview::Store`, memory | One run |
| Tabs, editor states, dialog state | `S`, memory | One run |

On upgrade there is no migration step. `Prefs` has no version field (`core/src/prefs.rs:30`). `prefs::load` merges what it can read: a missing or broken file gives the defaults, and a key of the wrong type keeps its default (comment at `prefs.rs:54`).

## What this architecture deliberately does not do

- **Run the learner's scripts.** `SCRIPT_POLICY` is `Blocked` (`core/src/kinds.rs:112`). The `Run` arm of `csp_for` exists and `SCRIPT_POLICY` is not switched by any setting.
- **Merge into an existing folder.** See `save_project` above.
- **Treat a stylesheet in another folder as live.** The helper treats a stylesheet as local only in the page's own folder (`ui-src/helper.js:18`), so live CSS applies to flat projects only.
- **Update itself.** No updater plugin in `src-tauri/Cargo.toml` (searched: `grep -n updater`, 0 hits).
- **Submit forms from the preview.** The page CSP has `form-action 'none'` (`core/src/kinds.rs:128`).

Decisions with a recorded reason are under [adr/](adr/).
