---
class:   truth
updated: 2026-11-09
status:  RECONSTRUCTED-UNCONFIRMED
---

# Invariants of HTML Lab

C1 to C42 were reconstructed from the code on 2026-11-08 (version 0.1.4), and
none of their tests has been through the teeth ritual, which means breaking the
rule on purpose and watching the test go red. C43 to C48 were written with 0.3.0
and confirmed by the owner through NEXT-0.3.0.md; each entry says which of its
tests failed with the defect put back, as HANDBACK-0.3.0.md records it.

**A test that would pass either way is worse than no test, because it certifies
the defect.**

Paths are relative to `app/`. Line numbers were read on 2026-11-08, and on
2026-11-09 for C9, C10, C37, C38 and C43 to C48; they will drift, the quoted
text will not.

Numbers are permanent. A retired entry keeps its number and is marked RETIRED
with a date and a reason. Never renumber, never reuse a number.

---

## Enforced invariants

None. Before 0.3.0 no entry had had its guard test run against the restored
defect. C43 to C48 now have guard tests that did fail that way (see each entry),
but each covers part of its rule only, so they stay listed with their topics
below; moving one here is the owner's call.

---

## Candidate invariants (unguarded)

This section certifies nothing. It is a worklist. "Appears covered by" names a
test that looks related; nobody has proven that it fails when the rule breaks.

**Standing rule: no guard test may be written against an invariant the project
owner has not confirmed.**

Test names come from these places: Rust `#[test]` functions in `core/src`,
`src-tauri/src` and `src-tauri/tests`, `t('...')` in `ui/self-test.js` and its
modules `ui/self-test-*.js`, and `step('...')` in `ui/smoke-test.js`.

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

### C9. Nothing on disk changes until Save, Save Automatically, or a rename the user confirmed in its dialog

- evidence: `ui/flows.js:652` (in `autosaveNow`) and `ui/flows.js:668` (in `noteChangeForAutosave`) `if (!S.prefs.autosave) return;`; `ui/rename.js:374` `const outcome = await doRename(tab, newName, plan, ticked);`, called only from the dialog's `submit`; `ui/rename.js:427` `` const got = await invoke('rename_file', { from: oldPath, to: `${dirName(oldPath)}/${newName}` }); ``, inside `doRename`. A file made with the + is written only by Save or Save Automatically, with `mustNotExist` (C4)
- origin: reconstructed; reworded with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09, the new wording)
- appears covered by: self-test `typing updates the page without saving`, self-test `E12: Save Automatically writes in about 2 s, and a failure gives one message`, self-test `editing and saving a sample leaves the one in the app unchanged`, self-test `a file from the + is on disk only after Save, and Save never overwrites one copied in (C4, C9)`, self-test `Tab to Keep the old name and Enter changes nothing on disk`, self-test `a changed tab keeps its edits unsaved under its new name, and only the disk copy moves (C9)`
- teeth: the three 0.3.0 tests above failed with their defects put back (HANDBACK-0.3.0.md, WP4 and WP5); the three older ones have not been through it
- note: Undo on the toast after a rename also writes the disk; it is a click of the user's own on a confirmed rename
- what a guard would have to do: compare the disk before and after typing with the preference off, and before and after a dialog left with Keep the old name

### C10. Reading takes UTF-8, or UTF-16 with a BOM; anything else is refused with its own message

- evidence: `core/src/files.rs:192` `pub fn decode_text(bytes: &[u8]) -> Result<Decoded, &'static str> {`, the one decoder for reading and for the preview (`src-tauri/src/preview.rs:112` `match files::decode_text(&bytes) {`); `core/src/files.rs:206` `return Err(NOT_TEXT);` for a zero 16-bit unit after a UTF-16 BOM; `core/src/files.rs:209` `return Err(OTHER_ENCODING);` for an odd length; `core/src/files.rs:218` `if bytes.contains(&0) {` (not text) without a UTF-16 BOM; `core/src/files.rs:225` `let text = std::str::from_utf8(rest).map_err(|_| OTHER_ENCODING)?;`; `core/src/files.rs:12` `const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;` (too big); `ui/flows.js:232` `if (error === 'other_encoding') {` gives the copy-table message
- origin: reconstructed; reworded with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09, the new wording)
- appears covered by: `read_refuses_over_5_mb`, `read_refuses_a_nul_byte`, `read_refuses_invalid_utf8`, `read_strips_a_byte_order_mark`, `utf16_edge_cases_are_other_encoding_or_not_text`, `a_utf16_file_over_5_mb_is_still_too_big`, `the_preview_decoder_is_the_reader`, self-test `a binary file and a too big file each give a message and open nothing`, self-test `a file in another encoding gives its own message and opens nothing`
- teeth: the self-test `a file in another encoding gives its own message and opens nothing` failed without the `other_encoding` branch in `messageForRead` (HANDBACK-0.3.0.md, WP1); the handback names no teeth run for the core tests
- what a guard would have to do: fail when a 5 MB plus 1 byte file opens, or when a Latin-1 file opens

### C43. Every save path writes back the file's own line ending, BOM, encoding and final newline

Every save path (Save, Save Automatically, first save, Save a Copy, rename rewrites) writes back the file's own line ending (the most-used one), BOM, encoding and final newline. A file opened and saved without an edit is byte-identical, except a mixed-ending file, which gets its most-used ending.

- evidence: `core/src/files.rs:314` `// The one encoder for every save path (C43): LF becomes the file's own line ending,` above `core/src/files.rs:316` `pub fn encode_text(`; its callers `core/src/files.rs:465` `let written = encode_text(&file.text, file.bom, &file.encoding, &file.eol)` (`write_files`: Save and Save Automatically), `core/src/files.rs:528` `encode_text(&file.text, file.bom, &file.encoding, &file.eol).map_err(|_| ())?` (`write_named_files`: first save and Save a Copy) and `core/src/files.rs:1120` `None => encode_text(&patched, file.bom, &file.encoding, &file.eol)?,` and `core/src/files.rs:1143` `(encode_text(&patched, decoded.bom, encoding, eol)?, None)` (`rewrite_one`, open tab and closed file); the style comes from `detect_style` (`core/src/files.rs:234`) in `ReadResult.style`, is kept as `tab.style`, and is sent by `ui/state.js:99` `export const writeStyle = (style) => ({` from `ui/flows.js:485` `...writeStyle(tab.style),` (`writeChanged`) and `ui/flows.js:374` (`allFiles`). The final newline is part of the text and `encode_text` neither adds nor removes one
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: `every_style_reads_and_saves_back_byte_for_byte` (LF, CRLF, CR, mixed, BOM, UTF-16 LE and BE, only a BOM, tabs, 4 spaces, no final newline), `line_endings_count_and_ties_go_to_lf`, `encode_text_writes_the_ending_the_encoding_and_the_bom`, `encode_text_refuses_an_unknown_encoding_or_ending`, `write_files_refuses_only_the_file_with_an_unknown_style`, `save_project_writes_each_file_in_its_own_style`, `save_copy_keeps_a_crlf_bom_file_and_a_utf16_file_byte_for_byte`, `rewrite_changes_only_the_spans_in_every_style`, self-test `a CRLF file opened with Open keeps its CRLF endings when saved (C43)`, self-test `a CRLF page opened by a link keeps its CRLF endings when saved (C43)`, self-test `a CRLF file from a restored session keeps its CRLF endings when saved (C43)`, self-test `Save a Copy keeps a CRLF file with a BOM and a UTF-16 LE file as they were (C43)`
- teeth: the four self-tests failed with their defects put back, among them no `eol` sent from `writeChanged` and no style in `allFiles` (HANDBACK-0.3.0.md, WP1); the handback names no teeth run for the WP1 core tests
- note: two choices from the handback refine the wording. UTF-16 is always written with its BOM (`core/src/files.rs:356`), since it is read only by its BOM. A rename rewrite keeps every ending of a mixed-ending file, so that only the spans change (`core/src/files.rs:1130` to `:1133` for a closed file, and since cdfab87b `core/src/files.rs:1121` `splice_keeping_endings` for an open tab; C45 wins there)
- what a guard would have to do: already test-shaped; the core tests need the teeth ritual

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
- note: until 0.2.0 `MIN_TEMPLATES` was 6 while 42 templates ship. Since 0.2.1 it is 42 in `ui/self-test.js` and `ui/smoke-test.js`; a test build with one template taken out of its gallery failed both runs (BACKLOG T2)
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

- evidence: `scripts/speed-run.py`, `if revision != "unstamped" and not revision.endswith("-dirty"):`; since 0.2.1 `keep` writes a second run for the same build as `<version>-<revision>-2` instead of over the first (BACKLOG T3)
- origin: reconstructed
- confirmed: false
- appears covered by: no test found
- what a guard would have to do: run a dirty build and see nothing written

### Speed

### C29. Every row of the speed budget is pass or fail on the Intel Mac

- evidence: `scripts/speed-budgets.json` (29 rows since 0.3.0 WP2 added `editorAllKb`); `scripts/speed-gate.py:69` `bad = failed or missing or errors`
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
- appears covered by: self-test `typing <h2 above a paragraph does not make it vanish`, self-test `3 < 4 in the text never holds`, self-test `changing blue inside a style attribute updates on every key`
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

### C37. KINDS names the teaching kinds, LANGUAGES names languages, CODE_KIND is the one generic kind; nothing else names either

- evidence: `core/src/kinds.rs:28` `pub const KINDS: &[Kind] = &[` (html and css, `teaching: true`); `core/src/kinds.rs:61` `// The one kind for every file that is not a teaching kind. It is not a row of KINDS (C37).` above `core/src/kinds.rs:62` `pub const CODE_KIND: Kind = Kind {`; `core/src/kinds.rs:91` `// Languages only add comfort when editing. They never decide what is a web file (C37),` above `core/src/kinds.rs:95` `pub const LANGUAGES: &[Language] = &[`. The UI reads all three from `app_config` (`kinds`, `codeKind`, `languages`) through `kindForName`, `kindOrCode` and `languageForName` in `ui/state.js`. Outside `kinds.rs`, no Rust code before a `#[cfg(test)]` names `"html"` or `"css"` (searched 2026-11-09)
- origin: reconstructed; reworded with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09, the new wording)
- appears covered by: `table_has_two_rows_with_the_contract_values`, `the_code_kind_has_the_contract_values_and_is_not_a_row`, `languages_table_has_the_26_plan_rows_in_order`, `languages_rows_are_unique_and_leave_the_teaching_kinds_out` (its message `{ext} is a teaching kind (C37)`), self-test `app config comes from the kinds table`
- **known exceptions** (2026-11-09): `ui/flows.js:954` `if (lang === 'css') {` and `ui/engine-check.js:234` `if (lang === 'css') return text.includes('{') ? checkCss(text, where) : checkStyleAttribute(text, where, new Map());` branch on a language name; `ui-src/editor.js:49` `function teachingLanguage(language) {` and `ui-src/editor.js:328` `if (language === 'html' || language === 'css') return [part, teachingLanguage(language).extension];` name the two built-in editor languages; `LANGUAGE_CHUNKS` (`ui-src/editor.js:60`) repeats the ids of `LANGUAGES`, one import per row, so esbuild can split them; `core/src/refs.rs:327` `// HTML and CSS come from the kinds table (C37); the other reference syntaxes are named here.` names endings by hand (`core/src/refs.rs:342` `"js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" => Some(Syntax::Js),`). Either the rule is narrower than stated or these are defects. Undecided
- what a guard would have to do: a source scan outside `kinds.rs`, once the exceptions are ruled on

### C38. Names for web files are cleaned to 60 characters; other names are kept as typed and checked by check_rename

- evidence: `core/src/names.rs:7` `const MAX_NAME_CHARS: usize = 60;`; `core/src/names.rs:11` `pub fn clean_file_name(raw: &str) -> String {` cuts at `core/src/names.rs:24` `stem.chars().take(MAX_NAME_CHARS).collect()`; `core/src/names.rs:92` `pub fn check_rename_for(old: &str, new: &str, windows: bool) -> Result<String, NameProblem> {` cleans a name ending in html, htm or css (`core/src/names.rs:101` `let stem: String = clean_stem(stem).chars().take(MAX_NAME_CHARS).collect();`) and keeps every other name (`core/src/names.rs:107` `None => new.to_string(),`), then refuses bad characters, a trailing dot, a space at either end, more than 255 bytes and, on Windows, reserved names. Change Name asks it through the `check_name` command (`src-tauri/src/main.rs:213`, called at `ui/rename.js:224`); the Make a new file dialog sends web endings to the web cleaner and every other name to `check_name` (`ui/dialogs.js:588`, `ui/flows.js:744`)
- origin: reconstructed; reworded with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09, the new wording)
- appears covered by: `file_name_cuts_to_sixty`, `rename_cleans_web_names_like_new_web_files`, `rename_keeps_case_and_characters_of_other_names`, `rename_refuses_bad_characters_and_names_the_character`, `rename_refuses_more_than_255_bytes`, `rename_refuses_reserved_names_on_windows_only`, self-test `Other with notes.md gives notes.md, and a name with no dot is a text file`, self-test `the Change Name field gives the copy-table line for a taken or bad name, and Enter then does nothing`
- teeth: the two self-tests failed with their defects put back (HANDBACK-0.3.0.md, WP4 and WP5); the handback names no teeth run for the core tests
- what a guard would have to do: raise the limit and see `file_name_cuts_to_sixty` fail; clean a `.py` name and see `rename_keeps_case_and_characters_of_other_names` fail

### C47. Teaching features run only for kinds with `teaching: true` (html, css), decided by kind flags, never by extension strings outside the tables

- evidence: in the editor, `ui-src/editor.js:327` `if (teaching && teachingLanguage(language)) return [part, teachingExtensions(language)];` (structure, page lighting, explanations, HTML hints) and `ui-src/editor.js:248` `if (!teaching) return [closeBrackets(), keymap.of(closeBracketsKeymap)];` (no tag closing or completion), both fed by `kind.teaching` (`ui/flows.js:93`); `ui/inside.js:38` `if (kindOf(tab).teaching) return S.E.insidePath(view.state);`; `ui/app.js:212` `if (!tab || !kindOf(tab).teaching || !S.ed || !S.ed.view.hasFocus) return;` (Help on This Word); `ui-src/editor.js:556` `// Help shows only teaching code (C47).`. The language wrappers leave out the teaching helpers their packages bring: `ui-src/langs/javascript.js:5` `// JSX parsing without the tag closer that javascript({ jsx: true }) adds: autoCloseTags is a teaching helper (C47).`
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: `kind_or_code_gives_the_teaching_kind_or_the_code_kind`, `the_code_kind_has_the_contract_values_and_is_not_a_row`, self-test `Typing Helpers off and on with a .py tab: "pri" gives no suggestions (C47)`, self-test `Hover explanations, Help on This Word and the tag row do nothing outside HTML and CSS (C47)`, self-test `every language opens with its label, letters, folding and Tidy rule (C21)`
- teeth: the three self-tests failed with their defects put back (teaching helpers for every tab, the tag path for every file, explanations for every language; HANDBACK-0.3.0.md, WP2)
- note: the Help highlighter (`highlightRuns`) and `teachingLanguage` key on the editor language id `html` or `css`, not on the flag; see C37's exceptions
- what a guard would have to do: give `CODE_KIND` `teaching: true` and see the C47 tests fail

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

### C46. While the My page side is hidden, the preview sends no message, starts no load and lights no code; it catches up when shown

- evidence: `ui/preview.js:103` `if (!S.sideShown) return;` at the top of `pump`; `ui/preview.js:184` `// A hidden side starts no load: it is remembered and done when the side comes back (C46).` and `ui/preview.js:185` `if (!S.sideShown) {`, which sets `P.loadWanted` before `P.loadId += 1` (`ui/preview.js:191`); since cdfab87b a load already running checks again after its awaits (`ui/preview.js:216` `if (!S.sideShown) {` with ``note(`load ${id} waits for the side`)``, before any address is set), a page that says ready while hidden is not made live (`ui/preview.js:336`, ``note(`ready v${msg.v} while hidden`)``), `sendAgain` and `goToPlace` stop while hidden (`ui/preview.js:242`, `:416`), `onSideHidden` marks a running load as wanted again (`ui/preview.js:595` to `:597`), and every message to the page goes through `postNow` (`ui/preview.js:90`), which counts `P.posted`; `ui/preview.js:360` `if (!S.sideShown || P.phase !== 'live' || S.rightView === 'help') return false;` in `inSync` (C39), and `ui/preview.js:371` the same check in `showingPageTab`, which `ui/app.js:595` gives `link.js` as `showingPage`; hiding calls `link.onHelpShown` (`ui/app.js:580`), which turns Point off and clears the lit lines; `ui/preview.js:605` `export function onSideShown() {` loads if a load was wanted, else pumps. A hide with the focus in the side moves it to the side button (a side button hid it) or to the code (`ui/app.js:168` `const focusOut = !shown && sideHasFocus();`)
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: self-test `C46: a hidden side sends nothing and loads nothing, then catches up with one load` (asserts `P.nextId`, `P.loadId`, the frame address, `inSync()` and `showingPageTab()` while hidden, then exactly one load and the typed text and style), self-test `C46: a load already running when the side hides sends nothing, and the side comes back with the boxes on` (cdfab87b, `ui/self-test-side.js`: asserts `P.nextId`, `P.posted`, `P.loadId` and the frame address for a hide before the address is set and one after it, then one fresh load with the boxes on), self-test `Hide this side gives the focus to the side button, and View > My Page Side from the switch gives it to the code` (cdfab87b), smoke step `The side button hides My page and brings it back`
- teeth: the self-test failed with the hidden check taken out of `pump()` (messages to a hidden page: 6, wanted 2) and, in a build of its own, out of `load()` (loads of a hidden page: 4, wanted 2) (HANDBACK-0.3.0.md, WP3); the teeth of the two cdfab87b self-tests are in HANDBACK-0.3.0.md, "Fixes after review (2026-11-09)"
- what a guard would have to do: already test-shaped; the lit-lines half has no assertion of its own

### Files and names (0.3.0)

### C44. A rename never replaces an existing file, on any platform, case-only renames included

Where the file system cannot rename exclusively, a check-then-rename is used and the small race is recorded in ADR 0010.

- evidence: `core/src/files.rs:749` `pub fn rename_file(from: &str, to: &str) -> Result<String, String> {`; `core/src/files.rs:797` `if to.symlink_metadata().is_ok() {` gives `file_exists` for a name that is taken, and `core/src/files.rs:806` does the same for a case-only rename onto another file; the move is `move_no_replace` (`core/src/files.rs:869`): `core/src/files.rs:924` `if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) } == 0 {` (macOS), `core/src/files.rs:941` `libc::RENAME_NOREPLACE,` (Linux `renameat2`), `core/src/files.rs:958` `if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) } != 0 {` (Windows); the fallbacks are `core/src/files.rs:873` `Err(_) => match (ops.link)(from, to) {` (hard link, then remove) and `core/src/files.rs:885` `if to.symlink_metadata().is_ok() {` before `fs::rename` (the accepted race); the command checks the root first (`src-tauri/src/main.rs:482`)
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: `rename_never_replaces_an_existing_file`, `rename_to_a_name_taken_in_another_case_is_file_exists`, `rename_onto_a_hard_link_to_the_same_file_is_file_exists`, `rename_onto_a_symlink_or_a_folder_is_file_exists`, `a_case_only_rename_changes_the_case_and_leaves_no_temp`, `a_case_only_rename_onto_another_file_with_that_case_is_file_exists`, `a_file_made_between_the_check_and_the_rename_is_not_replaced`, `without_an_exclusive_rename_a_hard_link_is_used`, `without_links_either_a_check_then_rename_is_used`, `an_nfd_name_to_its_nfc_form_is_a_case_only_rename_on_macos`, self-test `a case-only Change Name, notes.txt to Notes.txt`
- teeth: `a_file_made_between_the_check_and_the_rename_is_not_replaced` failed with `fs::rename` in place of the exclusive call, and the handback says each fallback defect failed its test (HANDBACK-0.3.0.md, WP5; it does not name those tests); the self-test failed with its defect put back
- limit: both fallback tests are `#[cfg(unix)]`, and the Windows run of 0.3.0 did not happen (HANDBACK-0.3.0.md, WP8), so the Windows branch is untested
- what a guard would have to do: already test-shaped for macOS and Linux; Windows needs a run

### C45. A rename with reference updates changes only the matched reference spans, keeps each file's style, never writes a read-only or changed file, and reports per file

In each file it changes only the matched reference spans, keeps each file's style (C43), never writes a read-only file, never writes a file whose bytes changed since the plan, and reports per file.

- evidence: `core/src/files.rs:1024` `pub fn rewrite_references(plan: &[RewriteFile], roots: &[PathBuf]) -> Vec<RewriteResult> {`, one `RewriteResult` per file; `writable_inside` refuses a path outside the roots or not a regular file (`cannot_write`) and `core/src/files.rs:1071` `if meta.permissions().readonly() || !may_write(&real) {` (`read_only`); `core/src/files.rs:1125` `if original.len() as u64 != file.size || crate::refs::content_hash(&original) != file.hash {` (`changed_on_disk`, closed files) and `core/src/files.rs:1109` `let kept = if expected == original {` (open tabs: the tab's saved text, encoded, must be the bytes on disk; since cdfab87b a mixed-ending file also passes when its own text with every CR LF and CR made LF is the tab's text, and then `splice_keeping_endings` (`core/src/files.rs:1164`) puts the spans into its own text, so every ending stays); `core/src/files.rs:1118` `let patched = splice_spans(&text, &file.spans, true)?;` and `:1142` the same with `false` for closed files, where `splice_spans` refuses a span that does not hold its old text; then `encode_text` (C43); Undo checks every file first with `files::check_restore` (`core/src/files.rs:1266`, from `src-tauri/src/main.rs:545`), the guards and bytes test of `restore_bytes` with nothing written, so a file that became read-only stops Undo before anything is written; Undo ends when a file it wrote is opened in a new tab (`ui/rename.js:145` and `:749`, `openedOutside`), and a half-done Undo names the files that still say the new name (`ui/rename.js:736`); a new name sets the language again, so `.ts` to `.tsx` reads TSX (`ui/rename.js:598`); spans come from `refs::find_references` (`core/src/refs.rs:81`) and cover only the file-name part. In the UI the editors get the same spans as a transaction that Cmd+Z never undoes (`ui/rename.js:64` `annotations: [S.E.renameEdit.of(true), S.E.Transaction.addToHistory.of(false)],`)
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: `rewrite_changes_only_the_spans_in_every_style`, `the_plan_from_find_references_goes_straight_in`, `an_open_tab_uses_utf16_offsets_into_its_text_and_its_own_style`, `a_span_that_does_not_fit_writes_nothing`, `spans_in_any_order_are_all_put_in`, `read_only_changed_symlinked_outside_and_missing_files_are_reported_and_not_written`, `rewrite_keeps_the_file_permissions_and_leaves_no_temp`, `a_file_with_no_spans_is_ok_and_not_written`, `rewrite_shapes_are_camel_case_and_never_send_the_original`, `the_span_covers_only_the_file_name`, `offsets_point_at_the_name_in_lf_crlf_bom_and_utf16_files`, self-test `Change Name on a comic copy changes story.html and its 4 places, on disk and in the tabs, and My page follows the links`, self-test `after Change Name a clean open tab that used the old name shows no unsaved dot`, self-test `a changed tab that used the old name keeps its own edit unsaved, and undoing that edit takes its dot away`, self-test `Cmd+Z in a tab that Change Name changed does not bring back the old name`, self-test `css/style.css open as its own tab is changed too, and a Save keeps the new name`; added in cdfab87b: `an_open_tab_of_a_mixed_ending_file_changes_only_its_spans_and_keeps_every_ending` and `check_restore_refuses_what_restore_bytes_would_refuse_and_writes_nothing` (`core/src/files.rs`), self-test `an open, unchanged tab of a file with mixed line endings is changed too and keeps every ending (C45)`, self-test `opening a file that Change Name wrote ends Undo, so its tab always shows what is on disk`, self-test `Change Name from app.ts to app.tsx reads TSX, so valid TSX shows no bracket hint` (`ui/self-test-rename.js`); the Cmd+Z self-test now types a part first and waits for the first Cmd+Z to take it away, so it proves Undo ran
- teeth: all 15 Change Name self-tests failed with their defects put back, among them no savedDoc patch (the clean-tab and own-edit tests) and no `addToHistory.of(false)` (the Cmd+Z test); the handback says each guard and encoding defect failed its core test (HANDBACK-0.3.0.md, WP5; it does not name those tests). The cdfab87b tests: HANDBACK-0.3.0.md, "Fixes after review (2026-11-09)"
- limit: between the size and hash check and the write in `atomic_write` another program's write can be lost; ADR 0010 records this race. A mixed-ending file keeps all its endings here, closed or open in a tab (C43's note)
- what a guard would have to do: already test-shaped

### C48. Opening a file in a huge folder reads it at most once and at most 2,000 entries; a window focus never stats more than 2,000 entries

Opening a file in a folder with tens of thousands of entries reads that folder at most once and at most 2,000 entries; a window focus never stats more than 2,000 entries.

- evidence: `core/src/project.rs:14` `pub const MAX_SCAN_ENTRIES: usize = 2_000;`; `core/src/project.rs:212` `// MAX_SCAN_ENTRIES entries, and only web file names are statted (C48).`; `core/src/project.rs:241` `if seen == MAX_SCAN_ENTRIES {`, which sets `too_big` (the file then opens alone); since cdfab87b a scan that stops at more than 20 web files sets `core/src/project.rs:277` `result.stopped_early = true;`, and `ui/flows.js:279` `big = !!(scan.tooBig || scan.stoppedEarly);` opens the file lone, so `folder_stamp` does not read the folder a second time; `core/src/files.rs:657` `// A window focus never stats more than this many entries, the folder's own included (C48).` above `core/src/files.rs:658` `pub const MAX_STAMP_STATS: usize = 2_000;`; with the files of a lone project `folder_stamp` stats only those files (`core/src/files.rs:674` to `:684`); the counts come from `core/src/counts.rs`, read by the test-only `test_fs_counts` (`src-tauri/src/main.rs:1059`) on a tree from `test_make_tree` (`src-tauri/src/main.rs:1047`, with `ext` for a tree of web files)
- origin: written with 0.3.0 (NEXT-0.3.0.md)
- confirmed: true (owner, NEXT-0.3.0.md, 2026-11-09)
- appears covered by: `scan_stops_at_2000_entries_and_opens_the_file_alone`, `scan_stops_early_once_there_are_too_many_web_files`, `scan_stats_only_web_file_names`, `a_picked_file_that_is_not_a_web_file_opens_alone_without_reading_the_folder`, `stamp_stats_at_most_2000_entries_in_all`, `stamp_skips_node_modules_and_dot_folders`, `stamp_of_given_files_looks_at_nothing_else`, `counts_add_up_and_reset_to_zero`, self-test `a file in a folder of 20,000 files: one read of at most 2,000 entries, and a focus stats at most 2,000 (C48)`; added in cdfab87b: `a_scan_that_reads_the_whole_folder_did_not_stop_early` and the `stopped_early` asserts in `scan_stops_early_once_there_are_too_many_web_files` and `scan_result_says_too_big_in_camel_case` (`core/src/project.rs`), self-test `a page in a folder of 20,000 web files: the scan stops early and the folder is read once (C48)` (`ui/self-test-files.js`)
- teeth: the self-test failed with its defect put back (HANDBACK-0.3.0.md, WP1; the brief's defect is the 2,000 cap removed); the handback names no teeth run for the core tests. The cdfab87b tests: HANDBACK-0.3.0.md, "Fixes after review (2026-11-09)"
- measured: on the Mac mini, 20,000 entries: open 16 ms (1 folder read, 2,000 entries, 3 stats), focus 0 ms (1 stat) (HANDBACK-0.3.0.md, information only)
- limit: opening a whole folder (`plan_open`'s listing of its web files) is not capped; C48 covers opening a file (BACKLOG, from the handback)
- what a guard would have to do: already test-shaped

---

## Adding an invariant

1. Write the check as a pure function, where it belongs in the code.
2. Wire it into whatever refuses invalid input, if a violation should be refused rather than merely reported.
3. Write the test.
4. **Restore the defect, run the test, watch it FAIL, restore the fix, watch it pass.** Back the file up first.
5. Record it here, with the measurement that motivated it.

Skipping step 4 keeps the entry under **Candidate invariants**.
