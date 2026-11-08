---
class:   truth
updated: 2026-11-08
status:  current
---

# Glossary: HTML Lab

Terms whose meaning in this code is narrower or different from what a reader
would assume. Paths are relative to `app/`.

## Preview

| Term | Means here | Does NOT mean |
|---|---|---|
| preview scheme | The `preview:` URL scheme served by Rust (`src-tauri/src/preview.rs`, registered at `src-tauri/src/main.rs:964`). Form: `preview://localhost/<encoded path>`. Unsaved text is served first, then disk | A local web server. No port is opened |
| gallery scheme | The `gallery:` URL scheme (`src-tauri/src/main.rs:977`) that serves template previews and thumbnails to the New dialog | The preview of a template opened as a project, which uses `preview:` |
| helper | The small script (`ui-src/helper.js`, built to `src-tauri/helper.min.js`) that Rust puts at the start of every served page except Help results. It applies updates and reports links | A helper of the user's, or Typing Helpers. It is the only script allowed to run in the page, by its nonce |
| tier 1 | Style swap: a key in a CSS tab sends the text and the helper replaces the style. The `preview_mode` value `swap` in `core/src/kinds.rs` | A page reload |
| tier 2 | Morph: a key in the HTML tab, or a tab switch inside one project, sends the page and the helper morphs the DOM with morphdom. The `preview_mode` value `morph` | A reload. Scroll and images stay |
| tier 3 | Full load: the iframe navigates to `preview://`. Used for a first load, another project, a first Save, and after a failure | The normal path while typing |
| phase | `none`, `loading` or `live` in `ui/preview.js`: whether a page with a live helper is showing | The app's state as a whole |
| lost load | A tier 3 load that stayed silent and was tried again. `lostLoads` in `ui/preview.js`; both test reports print it | A failed test |
| root | A folder the preview may serve from (`inside_root`, `src-tauri/src/preview.rs:36`): an open project's folder | The Mac's root folder |
| buffer | Unsaved text sent to Rust so the preview can serve it | An editor object |
| `__new` | Path prefix for a project with no folder: `__new/<projectId>/<file>` | A real folder |
| `__help` | Path prefix for Help results: `__help/<topicId>/<file>`. These get no helper and an empty `sandbox` | A file on disk |
| page tab | `pageTab`: the HTML tab the preview follows. A CSS tab leaves it in place | The tab that has focus |

## Projects and files

| Term | Means here | Does NOT mean |
|---|---|---|
| project | A named group of files in one flat folder, or with no folder yet. Project kinds are `new`, `sample`, `practice` and `saved` | Something with a project file. There is none |
| kinds table | `KINDS` in `core/src/kinds.rs`: the list of file kinds (HTML, CSS) that drives extensions, labels and preview mode | The project kinds above |
| changed | The editor's text differs from `savedDoc` | A file changed on disk |
| dot | The unsaved mark on a tab | Part of a file name |
| hidden file | A file of a project that travels with it (`hiddenFiles`) but has no tab (`ui/flows.js:99`) | A dotfile |
| Save Automatically | Opt-in preference (`autosave`): saves about 2 s after the last change, for projects with a folder | The default. Off means disk changes only on Save |
| Save a Copy | Writes a new folder, pictures too, and leaves the old one as it was | Save As, which would move the project |

## Content

| Term | Means here | Does NOT mean |
|---|---|---|
| starter | The text of a new file or project, from `core/content/starters.json` | A sample |
| sample | A ready project in `core/content/samples.json`, opened as a copy. 5 ship | A template. The two share the `samples` command, and templates have `group` set to `template` |
| template | A multi-page site in `core/content/templates/<id>/`, packed into `core/content/gallery/`. 42 ship. Opens as a copy | A starter, or a page layout engine |
| gallery | The Template gallery view in the New dialog: category filter, list, large preview | A photo gallery. "Photo gallery" is the name of one sample |
| built-in picture | One of the 7 photos compiled into the program (`PICTURES` at `core/src/content.rs:26`, from `core/content/pictures/`) | A template's photo. Those sit in the gallery folder in Resources and are read when wanted |
| `needs` | A list of `CSS.supports` conditions in a `template.json`. If one fails in this Mac's WebKit, `shownHere` (`ui/flows.js:125`) hides the template on that Mac. No template uses it today | Software dependencies |
| lesson | A Help topic with `"kind": "lesson"`, with a working example | Any Help topic |
| recipe | A Help entry under "I want to...", saying what to type and where | A lesson |
| Try it | Opens a lesson's example as a `practice` project | Running a test |
| Add to my code | Inserts a Help snippet into the open file as one undoable change | Copy, which only fills the clipboard |

## Screens and commands

| Term | Means here | Does NOT mean |
|---|---|---|
| My page / Help | The switch over the right panel | Separate windows |
| mistake hint | The note under the code for a likely HTML mistake (`ui-src/hints.js`), with Hide this hint | A compiler error. Pages always render |
| unfinished-tag hold | Pausing preview updates while the cursor is in a tag still being typed (`unfinishedTagAt`, `ui-src/hints.js:17`) | Debounce on every key. Normal pages update at once |
| Tidy | Fixes indentation in one undo step and leaves `<pre>` alone | A formatter that changes content |
| Typing Helpers | Preference for auto-closing tags and similar | The preview helper |
| Help on This Word | Opens the Help topic for the word under the cursor (Cmd+Shift+L) | Help search |
| Keep working | The button that cancels a close or quit | A Save |

## Testing and release

| Term | Means here | Does NOT mean |
|---|---|---|
| self-test | Hidden mode started with `--self-test`, code in `ui/self-test.js`. Drives the real logic through dispatch and DOM clicks. 85 tests. Run by `scripts/selftest-run.py` | A user-level test. It calls functions and can pass while a button is covered |
| smoke test | Hidden mode `--smoke-test`, `ui/smoke-test.js`. Clicks whatever is on top at a button's middle, types through the focused element, and photographs each step. 32 steps | A short or shallow test |
| engine check | `ui/engine-check.js`: asks the running WebKit whether it accepts every piece of CSS and HTML shipped or taught | A static list of features |
| speed check | Hidden mode `--speed-check`, `ui/speed-check.js`. Measures a fixed scenario. `scripts/speed-run.py` runs it and `scripts/speed-gate.py` compares with `scripts/speed-budgets.json` | A benchmark of the code in isolation. It runs in the visible window |
| painted | Time until two animation frames have passed after an action | Time until the code returned |
| pinned minimum | `MIN_TESTS` and `MIN_STEPS`: the count below which a run fails, so a test cannot vanish silently | A coverage target |
| test-history | `test-history/<version>-<revision>/`: reports kept in git, with the runner's verdict | A CI service |
| speed-history | `speed-history/<version>-<revision>.json` and `.txt`, for committed builds | Every run |
| revision | The commit, 12 characters, written to `Info.plist` as `HTMLLabRevision`. `-dirty` marks a test build, and `unstamped` means none | The version number |
| hand-over zip | `app/src-tauri/target/hand-over/HTML Lab.zip`: the signed, notarized, stapled build, with `app/src-tauri/target/hand-over/build.json` beside it holding version, revision and checksum | A source archive |
| quick profile | Cargo profile `quick`: release settings without LTO, for fast test builds | The shipped build |

Finnish, Swedish or Hungarian vocabulary in the code: none needing definition.
The one Finnish string found in test names is a folder-name test case (`Minun sivu ä`).
Searched: the test names in `ui/self-test.js`.
