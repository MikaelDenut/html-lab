---
class:   truth
updated: 2026-11-08
status:  RECONSTRUCTED-UNCONFIRMED
---

# Invariants of HTML Lab

Reconstructed from the code on 2026-11-08 (version 0.1.4). Nothing here has been
through the teeth ritual, which means breaking the rule on purpose and watching
the test go red.

**A test that would pass either way is worse than no test, because it certifies
the defect.**

Paths are relative to `app/`. Line numbers were read on 2026-11-08 and will
drift; the quoted text will not.

Numbers are permanent. A retired entry keeps its number and is marked RETIRED
with a date and a reason. Never renumber, never reuse a number.

---

## Enforced invariants

None. No entry has had its guard test run against the restored defect.

---

## Candidate invariants (unguarded)

This section certifies nothing. It is a worklist. "Appears covered by" names a
test that looks related; nobody has proven that it fails when the rule breaks.

**Standing rule: no guard test may be written against an invariant the project
owner has not confirmed.**

Test names come from three places: Rust `#[test]` functions in `core/src` and
`src-tauri/src`, `t('...')` in `ui/self-test.js`, and `step('...')` in
`ui/smoke-test.js`.

### Not losing work

### C1. A file is written through a temp file in its own folder and then renamed

- evidence: `core/src/files.rs:130` `pub fn atomic_write(`; `core/src/files.rs:147` `temp_name.push(".htmllab-tmp");`; `core/src/files.rs:174` flushes with `File::sync_all` before publishing
- origin: reconstructed
- confirmed: false
- appears covered by: `atomic_write_leaves_no_temp_behind_on_success`, `atomic_write_failure_deletes_the_temp_file`, `atomic_write_read_only_folder_is_cannot_write_and_old_file_stays`, `atomic_write_keeps_the_old_permissions`
- what a guard would have to do: fail when the file is written in place, restored against a version that calls `fs::write` on the target

### C2. A first Save or Save a Copy never merges into an existing folder

- evidence: `core/src/files.rs:309` and `core/src/files.rs:406` use `fs::create_dir`, which fails on an existing folder, and report `folder_exists`
- origin: reconstructed
- confirmed: false
- appears covered by: `save_project_existing_folder_changes_nothing`, `save_copy_existing_target_is_folder_exists`, self-test `Save where a folder of that name exists asks for another name`
- what a guard would have to do: fail when `create_dir` becomes `create_dir_all`

### C3. A failed first Save removes only what that call wrote

- evidence: `core/src/files.rs:253` comment `Never `remove_dir_all``; `core/src/files.rs:261` `let _ = fs::remove_dir(dir);`
- origin: reconstructed
- confirmed: false
- appears covered by: `cleanup_removes_only_what_it_made_plus_ds_store`
- what a guard would have to do: fail when an unrelated file placed in the folder is deleted by cleanup

### C4. A file added in the app never overwrites a file of that name on disk

- evidence: `core/src/files.rs:141` `if must_not_exist && path.symlink_metadata().is_ok()`; `ui/flows.js:428` sends `wasNew: tab.savedDoc === null`
- origin: reconstructed
- confirmed: false
- appears covered by: `atomic_write_must_not_exist_changes_nothing_when_taken`, `atomic_write_must_not_exist_counts_a_dangling_symlink`, self-test `a file copied in after + made the same name is not overwritten`
- what a guard would have to do: fail when `mustNotExist` is dropped between the UI and `atomic_write`

### C5. A failed write keeps the text and its unsaved mark, and does not stop the other files

- evidence: `core/src/files.rs:226` `pub fn write_files`, which returns one result per file; `ui/flows.js:440` to `ui/flows.js:442` collect failures and leave `savedDoc` alone
- origin: reconstructed
- confirmed: false
- appears covered by: `write_files_one_failure_does_not_stop_the_others`, self-test `moving the folder away keeps the text and offers Save it somewhere new`
- what a guard would have to do: fail when a failed tab loses its unsaved mark

### C6. After a write, the saved state is the text that was sent, not the current text

- evidence: `ui/flows.js:437` to `ui/flows.js:438`, `tab.savedDoc = doc;`, with `doc` captured at `ui/flows.js:428` before the write
- origin: reconstructed
- confirmed: false
- appears covered by: no test name found; searched the `t('...')` names in `ui/self-test.js` for a key pressed during a write
- what a guard would have to do: type during a slow write and assert the tab still counts as changed

### C7. Closing a tab with unsaved changes asks first

- evidence: `ui/flows.js:490` offers `Keep working`; `ui/flows.js:781` `onCloseRequested`
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `closing a changed tab warns, and Keep working keeps it`, self-test `closing untouched style.css in an unsaved project asks, Keep it keeps it`, smoke step `Closing a changed tab asks first`
- what a guard would have to do: fail when the question is skipped for a changed tab

### C8. Every way of quitting asks when something is unsaved

- evidence: `src-tauri/src/main.rs:472` comment `The one quit flow, for Cmd+Q, the red button, Dock Quit and logout.`; `src-tauri/src/main.rs:475` checks `any_changed`; `src-tauri/src/main.rs:869` adds `applicationShouldTerminate:`; `ui/tabs.js:99` computes `anyChanged`
- origin: reconstructed
- confirmed: false
- appears covered by: no test found; `grep -n -i quit ui/self-test.js ui/smoke-test.js` returns only the `test_quit` calls that end each run
- what a guard would have to do: drive a real terminate request with a changed tab, restored against a build without the delegate method

### C9. Nothing on disk changes until the user saves, unless Save Automatically is on

- evidence: `ui/flows.js:605` and `ui/flows.js:621` `if (!S.prefs.autosave) return;`
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `typing updates the page without saving`, self-test `E12: Save Automatically writes in about 2 s, and a failure gives one message`, self-test `editing and saving a sample leaves the one in the app unchanged`
- what a guard would have to do: compare the disk before and after typing with the preference off

### C10. Reading refuses a file over 5 MB, with a NUL byte, or not valid UTF-8

- evidence: `core/src/files.rs:13` `const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;`; `core/src/files.rs:121` `String::from_utf8(bytes)`
- origin: reconstructed
- confirmed: false
- appears covered by: the size checks in `core/src/files.rs` tests around line 581, self-test `a binary file and a too big file each give a message and open nothing`
- what a guard would have to do: fail when a 5 MB plus 1 byte file opens

### Preview safety

### C11. Scripts typed by the user do not run in the preview

- evidence: `core/src/kinds.rs:112` `pub const SCRIPT_POLICY: ScriptPolicy = ScriptPolicy::Blocked;`; `core/src/kinds.rs:117` `script-src 'nonce-{nonce}'`; `ui/index.html:123` `sandbox="allow-scripts"`
- origin: reconstructed
- confirmed: false
- appears covered by: `policy_is_blocked_and_serializes_lowercase`, `csp_blocked_is_the_plans_line`, `a_picture_shown_as_a_page_runs_no_script`, self-test `a script with while(true) cannot freeze the editor, and the note shows`
- what a guard would have to do: fail when a page's own script executes in the real WebKit

### C12. The preview serves only what is inside an open project's folder

- evidence: `src-tauri/src/preview.rs:36` `pub fn inside_root`, which compares the canonical path with the roots
- origin: reconstructed
- confirmed: false
- appears covered by: `roots_keep_files_inside`, `dot_dot_never_leaves`
- what a guard would have to do: fail when a `..` path or a symlink outside the root is served

### C13. Help results run with an empty sandbox

- evidence: `ui/help.js:441` `frame.setAttribute('sandbox', '');`
- origin: reconstructed
- confirmed: false
- appears covered by: no test name found; self-test `every topic renders its screen` loads topics but its name does not claim this
- what a guard would have to do: assert the attribute on the live frame

### C14. Only `http:` and `https:` addresses leave the app

- evidence: `src-tauri/src/main.rs:321` `if url.starts_with("https://") || url.starts_with("http://") {`
- origin: reconstructed
- confirmed: false
- appears covered by: no test found; `grep -n open_external ui/self-test.js` is the search to repeat
- what a guard would have to do: fail when a `file:` address reaches the opener

### Engine limits

### C15. Everything the app ships or teaches works in the Safari 15.6 engine

- evidence: `ui/engine-check.js:122` `export function checkCss`; `ui/engine-check.js:207` `export function checkHtml`; `ui/engine-check.js:278` `export function checkTopic`. WebKit itself is the judge, through `CSS.supports` and dropped rules
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `every template, sample and Help topic uses only CSS and HTML this WebKit understands`
- limit: the check speaks for the engine it runs in, so only a run on the Intel Mac on macOS 12 proves this rule
- what a guard would have to do: add a `color-mix()` rule to a template, run on that Mac, and see the test fail

### C16. A template may not use features the oldest engine lacks

- evidence: `scripts/check-template.py:33` `CSS_FORBIDDEN`, including `color-mix(` and `@container`; `scripts/check-template.py:286` refuses nested rules; `scripts/build-templates.py:154` runs the checker while packing
- origin: reconstructed
- confirmed: false
- appears covered by: no test of the checker found; `scripts/` holds no test file for it
- what a guard would have to do: run the checker on a fixture with each forbidden feature

### C17. The app's own code is built for the same engine and system floor

- evidence: `scripts/sign-notarize.sh:17` and `scripts/sign-notarize.sh:18` `--target=safari15`; `src-tauri/tauri.conf.json` `"minimumSystemVersion": "12.0"`
- origin: reconstructed
- confirmed: false
- appears covered by: no direct test; the self-test and smoke test run on the Intel Mac on macOS 12 exercise the result
- what a guard would have to do: fail when the target or the floor is raised

### C18. A template that needs CSS this engine lacks is hidden on that Mac only

- evidence: `ui/flows.js:125` `export function shownHere(template)`; `ui/flows.js:138` filters the gallery with it
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `a template that needs CSS this Mac lacks stays out of the gallery (D11)`
- note: no shipped template uses `needs` today (0 of 42 in `core/content/gallery/templates.json`)
- what a guard would have to do: fail when `shownHere` returns true for a broken condition

### Test honesty

### C19. A full self-test run registers at least the pinned number of tests

- evidence: `ui/self-test.js:14` `export const MIN_TESTS = 85;`; `scripts/selftest-run.py`, function `problems`, `the pinned minimum is`
- origin: reconstructed
- confirmed: false
- appears covered by: the runner itself; no test of `problems()` found
- what a guard would have to do: delete one `t(...)` and see the run reported NOT PASSED

### C20. A smoke run has at least the pinned steps, each with a picture

- evidence: `ui/smoke-test.js:18` `export const MIN_STEPS = 32;`; `scripts/selftest-run.py`, function `problems`, `steps have no picture`
- origin: reconstructed
- confirmed: false
- appears covered by: the runner itself
- what a guard would have to do: delete one `step(...)` and see the run reported NOT PASSED

### C21. Loops over content assert how much they saw

- evidence: `ui/self-test.js:19` to `ui/self-test.js:21`, `MIN_TOPICS = 97`, `MIN_LESSONS = 53`, `MIN_ENGINE = { pages: 112, sheets: 11, snippets: 259 }`; `ui/self-test.js:901` asserts them
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `every template, sample and Help topic uses only CSS and HTML this WebKit understands`
- note: `MIN_TEMPLATES` at `ui/self-test.js:17` is 6 while 42 templates ship, so this floor would not notice 36 templates disappearing
- what a guard would have to do: shorten a content list and see the floor fail

### C22. The runner does not trust the app's report

- evidence: `scripts/selftest-run.py`, function `problems`, comment `The report's own counts are not trusted`; a stale report is deleted before the run
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: feed `problems()` a report whose counts disagree with its rows

### C23. Test-only commands work only in a test run

- evidence: `src-tauri/src/main.rs:604` `fn test_mode`; `test_snapshot` returns false when it is off
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: call each `test_` command in a normal launch

### Release

### C24. A release comes only from committed code

- evidence: `scripts/sign-notarize.sh:23` `CHANGED="$(git status --porcelain -- .)"`; the `release build refused` branch; `HTMLLAB_TEST_BUILD=1` turns the refusal into a `-dirty` revision
- origin: reconstructed
- confirmed: false
- appears covered by: no test found; the script is the check
- what a guard would have to do: run the script with a changed file and see exit 1 before any build

### C25. A bundle older than its source blocks a release

- evidence: `scripts/sign-notarize.sh:17` and `scripts/sign-notarize.sh:18` rebuild both bundles before the check at line 23, so a stale bundle shows as a change
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: change `ui-src/editor.js` without rebuilding, commit, and see the refusal

### C26. The three version numbers agree

- evidence: `scripts/sign-notarize.sh`, the `versions differ:` branch, comparing `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`
- origin: reconstructed
- confirmed: false
- appears covered by: no test found. `core/Cargo.toml` is not compared and stays at 0.1.0
- what a guard would have to do: change one number and see exit 1

### C27. Every release names the commit it was built from

- evidence: `scripts/sign-notarize.sh`, `PlistBuddy -c "Add :HTMLLabRevision string $REV"`, before the signature; `scripts/selftest-run.py`, function `build_of`
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: read the key back from a signed build

### C28. Speed history keeps committed builds only

- evidence: `scripts/speed-run.py:199` `if revision != "unstamped" and not revision.endswith("-dirty"):`
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: run a dirty build and see nothing written

### Speed

### C29. Every row of the speed budget is pass or fail on the Intel Mac

- evidence: `scripts/speed-budgets.json` (28 rows); `scripts/speed-gate.py:74` `bad = failed or missing or errors`
- origin: reconstructed
- confirmed: false
- appears covered by: `scripts/speed-run.py` and `scripts/speed-gate.py`
- **currently not holding**: `speed-history/0.1.4-247e22328486.txt` shows 20 PASS, 8 FAIL
- what a guard would have to do: this is measured, not unit tested; a guard needs a decision on which rows are binding

### C30. No repeating timer runs in the app while it is idle

- evidence: `grep -n setInterval ui/app.js ui/tabs.js ui/preview.js ui/flows.js ui/dialogs.js ui/help.js ui-src/*.js` returns 0 hits; `ui/flows.js:623` autosave is a one-shot `setTimeout`
- origin: reconstructed
- confirmed: false
- appears covered by: the `idleCpu` row of the speed gate, which is failing at 1.53 against a limit of 1 in the same history file
- what a guard would have to do: a source scan for `setInterval`, plus the idle measurement

### Editor and content

### C31. Only the active tab's editor is painted, and hidden ones keep their layout

- evidence: `ui/style.css:2399` `.editor-box[hidden]` sets `display: block` and `visibility: hidden`; `ui-src/editor.js:218` `box.className = 'editor-box';`
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `only the active tab editor is drawn, at the top of its box`
- what a guard would have to do: fail with two boxes visible

### C32. Editor theme rules must not reach tooltip boxes

- evidence: `ui-src/editor.js:70` `'&.cm-editor': {`; `ui-src/editor.js:126` `tipRoot.id = 'tooltip-root';`; `ui/style.css:1217` `#tooltip-root`
- origin: reconstructed
- confirmed: false
- appears covered by: the smoke test's real clicks, for example step `New dialog`, which fail when a target is covered
- what a guard would have to do: restore the theme rule on `&` and see a smoke step fail

### C33. Typing an unfinished tag does not blank the page

- evidence: `ui-src/hints.js:17` `export function unfinishedTagAt(doc, pos)`; `ui/preview.js:412` calls it
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `typing <h2 above a paragraph does not make it vanish`, self-test `3 < 4 in his text never holds`, self-test `changing blue inside a style attribute updates on every key`
- what a guard would have to do: remove the hold and see the first test fail

### C34. Preview URLs encode each path segment alone

- evidence: `ui/preview.js:151` `clean.split('/').map(encodeURIComponent).join('/')`
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `a folder named Minun sivu ä works`, `buffers_win_and_encoded_paths_decode`
- what a guard would have to do: encode the whole path at once and see the folder test fail

### C35. A release build reads the gallery only from the folder the app gave it

- evidence: `core/src/content.rs:59` to `core/src/content.rs:63`, `None if cfg!(debug_assertions) => Some(Path::new(SOURCE_GALLERY)),`
- origin: reconstructed
- confirmed: false
- appears covered by: `every_template_has_its_gallery_pictures`, debug only
- what a guard would have to do: run a release binary with no gallery and see an empty list, not a read of the source tree

### C36. Help content contains no em or en dashes and only valid links

- evidence: `core/src/content.rs:683` `fn check_help`; `core/src/content.rs:1064` `help_check_finds_em_and_en_dashes_anywhere`
- origin: reconstructed
- confirmed: false
- appears covered by: `the_real_help_file_passes_every_check`, `help_check_finds_a_broken_href`, `help_check_finds_a_broken_src`
- what a guard would have to do: already test-shaped; needs the teeth ritual

### C37. Only the kinds table names file kinds

- evidence: `core/src/kinds.rs:1` `The kinds table. This is the one place that may name "html" and "css".`
- origin: reconstructed
- confirmed: false
- appears covered by: self-test `app config comes from the kinds table`
- **known exception**: `ui/flows.js:878` `if (lang === 'css') {` branches on the name, and `ui/engine-check.js:262` does too. Either the rule is narrower than stated or these are defects. Undecided
- what a guard would have to do: a source scan outside `kinds.rs`, once the exceptions are ruled on

### C38. File names are cleaned to at most 60 characters

- evidence: `core/src/names.rs:7` `const MAX_NAME_CHARS: usize = 60;`; `core/src/names.rs:10` `pub fn clean_file_name`
- origin: reconstructed
- confirmed: false
- appears covered by: the tests in `core/src/names.rs` around line 138
- what a guard would have to do: raise the limit and see the test fail

### Page lighting (0.2.0)

### C39. The code lights up only for the text the page shows

- evidence: `ui/preview.js` `export function inSync`; `ui/link.js` drops replies whose `pv` is not the current one
- origin: written with 0.2.0
- confirmed: false
- appears covered by: self-test `Lit: out of step the code does not light, but the page still outlines`
- what a guard would have to do: make `inSync()` return true always and watch that test fail

### C40. The helper's own nodes are never counted or morphed as page elements

- evidence: `ui-src/helper.js` `function nodeKey` and `onBeforeNodeDiscarded`; `ui-src/helper-inspect.js` `const own`
- origin: written with 0.2.0, after the morph removed `style[data-hl-fonts]` on Windows and Linux
- confirmed: false
- appears covered by: self-test `Line-up: every sample and template page pairs each element with an id with its code`, and the Linux check of the built-in fonts after a change
- what a guard would have to do: drop the key for `hl-layer` and watch the line-up test fail

### C41. A reply to a page question asked before a clear changes nothing

- evidence: `ui/link.js` `dropReplies`
- origin: found by the first 0.2.0 self-test run: a stale `ruled` reply set the hint after the cursor left the rule
- confirmed: true (the test failed before the fix)
- appears covered by: self-test `Rule: after a page update the count is asked again, without outlines`

### C42. Fold keys use no AltGr chord off the Mac

- evidence: `src-tauri/src/menu.rs` `FOLD_KEY`, `UNFOLD_KEY`
- origin: written with 0.2.0: Ctrl+Alt is AltGr on Windows, and AltGr+[ types a bracket on many keyboards
- confirmed: false
- appears covered by: `fold_keys_avoid_altgr_off_the_mac` in `src-tauri/src/menu.rs`, `help_keys_match_the_menu_off_the_mac` in `src-tauri/src/main.rs`

---

## Adding an invariant

1. Write the check as a pure function, where it belongs in the code.
2. Wire it into whatever refuses invalid input, if a violation should be refused rather than merely reported.
3. Write the test.
4. **Restore the defect, run the test, watch it FAIL, restore the fix, watch it pass.** Back the file up first.
5. Record it here, with the measurement that motivated it.

Skipping step 4 keeps the entry under **Candidate invariants**.
