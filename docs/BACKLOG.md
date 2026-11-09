---
class:   state
updated: 2026-11-09
status:  current
---

# Open work: HTML Lab

## Measurement provenance

Every rate here was produced on 2026-11-08 by one of these probes:

```bash
python3 app/scripts/speed-run.py <app> --runs 3   # Intel test Mac, medians of 3, result in app/speed-history/
python3 app/scripts/template-status.py            # stages of each template
grep -rnE "<private strings>" app                 # publication sweep
```

Re-measure anything older than one session before trusting it.

## Status enum (closed set)

LEAD, OPEN, WIP, MITIGATED, FIXED, WONTFIX, STALE, as defined by the project's wrap-up procedure. LEAD may never go straight to FIXED.

## Blocks publication

| Id | Status | Item | Where |
|---|---|---|---|
| P1 | FIXED | Test Mac names now in `app/scripts/local.json`, not in git. Guard: the export sweep. | scan of the export |
| P2 | FIXED | Signing identity and notary profile now in `app/scripts/local.json`, not in git. | scan of the export |
| P3 | FIXED | Personal wording and links to the design record removed from code and tooling. | scan of the export |
| P4 | STALE | The library and startup template hits are made-up page text, no personal data. | read 2026-11-08 |
| P5 | OPEN | The bundle id contains a family domain; changing it moves saved preferences | `app/src-tauri/tauri.conf.json` |

## Speed rows over budget (Intel test Mac, 0.1.4 at 247e22328486)

| Id | Status | Row | Measured |
|---|---|---|---|
| S1 | OPEN | Letter painted in the code | p95 38 ms, limit 37 |
| S2 | OPEN | Typing on a 5,000-line page | p95 40 ms, limit 37 |
| S3 | OPEN | Scrolling a 5,000-line page | 7.33 % of frames over 20 ms, limit 2 % |
| S4 | OPEN | Tab switch | p95 52 ms, limit 50 |
| S5 | OPEN | Help topic opens | p95 53 ms, limit 50; 39 one build earlier |
| S6 | OPEN | Template gallery opens | p95 113 ms, limit 100 |
| S7 | OPEN | Idle CPU after the workload | 1.48 %, limit 1 %; 0.00 s in 20 s when launched normally and left alone |
| S8 | OPEN | Memory | 383.5 MB, limit 300 MB |

## Tooling and docs

| Id | Status | Item | Evidence |
|---|---|---|---|
| T1 | STALE | `template-status.py` reports tested 0 of 42. The folder move was not the cause: it counts a build as tested only with all four runs, Intel and mini, and no build since 0.1.4 has Intel runs. See T6 | `python3 app/scripts/template-status.py`, 2026-11-09: tested 0 of 42; `ls app/test-history/*/` |
| T2 | FIXED | `MIN_TEMPLATES` was 6 while 42 ship. 0.2.1 pins 42 in the self-test and the smoke test. A test build with one template taken out of its gallery failed 5 self-tests and the gallery smoke step | 56ad9968 |
| T3 | FIXED | `speed-run.py` wrote over a build's record when run again for the same revision. `keep` now adds `-2`, `-3`; checked on a fake history folder (two runs, two files) | b747250e, `app/scripts/speed-run.py` `keep` |
| T4 | LEAD | `intel-run.sh` builds an app with no `Resources/gallery`, so gallery tests likely fail there. From reading the script, not run. | `app/scripts/intel-run.sh` |
| T5 | FIXED | `app/docs/CONTRACTS.md` was stale: 5 Help group ids where 8 exist, `ContentFile` lacks `picture`, and more. Every name was checked; the commands are at its end | 23f6362a |
| T6 | OPEN | No Intel test runs since 0.1.4, so `template-status.py` counts 0 templates as tested and the oldest engine (macOS 12) is unchecked for 0.1.5 to 0.2.1 | `ls app/test-history/*/` |
| T7 | FIXED | `ARCHITECTURE.md` listed the core dependencies as `serde`, `serde_json`, `libc`; `dunce` was missing and `libc` is Unix only (found while checking CONTRACTS.md). 0.3.0 adds `unicode-normalization` and, on Windows only, `windows-sys`. Fixed in 0.3.0: the WP9 docs pass rewrites the list in `ARCHITECTURE.md` | `app/core/Cargo.toml` |

## Not yet done

| Id | Status | Item |
|---|---|---|
| N1 | OPEN | Hand checks: Finnish keyboard, Dock Quit with a native panel open, Open in Safari, cold start, hover effects on the Intel Mac |
| N2 | OPEN | A child uses it alone for 20 minutes |
| N3 | OPEN | Monkey test, full read of Help and samples, design detector style findings, two near-limit contrasts (harbour 4.56:1, resume 3.04:1) |

## Open after 0.2.0 (see how it fits)

| Id | Status | Item | Evidence |
|---|---|---|---|
| V1 | MITIGATED | The page and code line-up can pair the wrong elements where the browser rebuilds the code a lot, such as a `<p>` holding a `<div>` (`R32` in PLAN.md). The in-step check and the look-ahead of 8 limit it | `ui-src/link-editor.js` `alignPage` |
| V2 | OPEN | Tests cannot set CSS `:hover`, so the page's own hover effects under Point and Show the Boxes are checked by eye only (`R33`) | `ui/self-test-see.js` |
| V3 | FIXED | Show the Boxes: a nested box's label sat over the first letter of the box above it. Labels now take the first spot clear of text and other labels. Self-test `Boxes: no label covers a letter` (2 labels over text before, 0 after) | 31f78c20, `smoke-35-show-the-boxes.png` of 0.2.1 at 428fcaa2ab7a |
| V4 | FIXED | Show the Boxes stayed checked after the last tab closed and came back on with the next page. Closing the last tab turns it off | 050c6a10, self-test `Boxes: closing the last tab` |
| V5 | OPEN | In the Windows VM the template and lesson loops of the self-test time out now and then (`preview to settle`), most under host load; 0.1.7 does the same there. The 0.2.0 signed exe passed 137 of 137 when the host was idle. Message improved in 0.2.1 (9ef9d8c2): the settle timeout now names phase, page version, waiting HTML and CSS, and the last page message when the wait ran out. The flakiness itself is not fixed | `ui/self-test.js` `settle` |
| V6 | FIXED | Self-test names and messages said "his" in 12 places; now "the" | 149ae958; a grep for his, her, he and she in `app/ui/self-test*.js` and `app/ui/smoke-test*.js` finds nothing |

## Open after 0.3.0 (any text file, the side, new file, rename)

Found while building 0.3.0 (`docs/HANDBACK-0.3.0.md`, "Added to BACKLOG" and "Unsure").

| Id | Status | Item | Evidence |
|---|---|---|---|
| U1 | OPEN | A page opened alone in a folder of more than 2,000 entries (a lone project) does not notice a new picture in its folder until the page reloads, because `folder_stamp` then stamps only the open files | `ui/state.js` `stampArgs`, C48 |
| U2 | OPEN | One unreadable entry in a folder still refuses the whole folder scan, as before 0.3.0 | `core/src/project.rs` `scan_folder` |
| U3 | OPEN | The web-file listing in `plan_open` for an opened folder has no cap; C48 covers opening a file, not a folder | `core/src/project.rs` `plan_open` |
| U4 | OPEN | A text file whose first NUL byte comes after 8 KB is picked by the folder fallback (no web files), then refused by the read | `core/src/project.rs` `SNIFF_BYTES` |
| U5 | OPEN | C# and Kotlin have no colours: the legacy clike mode builds its word lists with `obj[word] = true`, and under `freezePrototype: true` Kotlin's word `constructor` throws when the module loads. A patched copy of the mode, or an upstream fix, would bring them back | `core/src/kinds.rs` `LANGUAGES`, `src-tauri/tauri.conf.json` |
| U6 | OPEN | Tidy now keeps the lines inside multi-line strings (Java text block, PHP heredoc and nowdoc, SQL, C++ raw, Go raw, Rust raw, Python strings, JS and TS template literals) and keeps `<pre>` and `<textarea>` inside PHP (cdfab87b). Still open: Swift `"""` and Lua `[[ ]]` are legacy modes whose strings the check does not see, so Tidy stays off for them; C# and Kotlin are still plain text (U5) | `ui-src/editor.js` `tidyKeepsLine`, self-tests `Tidy leaves the lines inside a Java text block, a PHP heredoc and a JS template literal alone` and `Tidy leaves <pre> alone in a PHP file` |
| U7 | OPEN | The native menu cannot grey Tidy for languages where Tidy is off (`set_menu_state` has no Tidy field); the menu item does nothing there | `src-tauri/src/main.rs` `set_menu_state` |
| U8 | FIXED | AGENTS.md and CONTRIBUTING.md "Committed bundles" did not name the `ui/editor/` chunks. Fixed in 0.3.0 (WP9) | `AGENTS.md`, `CONTRIBUTING.md` |
| U9 | OPEN | The editor's start budget (entry plus static chunks, 600 KB) had 2.2 KB left at 62c55061 (597.8 KB). Code for later work has to live in chunks or outside the editor bundle | `docs/HANDBACK-0.3.0.md` "Bundle sizes" |
| U10 | OPEN | In the "Make a new file" dialog the ending (`.html`) sits at the right end of the field, as in 0.2.1, not right after the typed name as mockup 11 shows | `docs/mockups-0.3.0/` 11 |
| U11 | OPEN | After a rename the changed text gets no green mark (mockup 08). It needs a decoration in the editor bundle, which is near its start budget (U9) | `docs/mockups-0.3.0/` 08 |
| U12 | OPEN | No test checks the rename dialog's "The file type changes" and "will not be a web page any more" lines, or the 2,000-file lines | `ui/self-test-rename.js` |
| U13 | OPEN | In the editor Shift+Tab is "indent less", so the rename toast's Undo is reached by Esc and then Shift+Tab, or by File > Undo Change Name, not by Shift+Tab alone | `ui/rename.js` |
| U14 | LEAD | While Undo is offered, typing in a tab the rename did not touch restarts auto-save; that save can write a touched tab that has unsaved changes, and Undo is then refused. From reading the code, not seen in a test | `ui/rename.js`, `ui/flows.js` auto-save |
| U15 | OPEN | The CSS file type is still rank Default on macOS, so HTML Lab is the default app for `.css` when no other app claims it; the four 0.3.0 types are Alternate | `src-tauri/tauri.macos.conf.json` |
| U16 | FIXED | The notary keychain profile seemed to disappear (30.10 and 9.11). It was never deleted: it lives in the data-protection keychain, which can only be read while the Mac is unlocked. `sign-notarize.sh` now checks it before building (cdfab87b) | `docs/RUNBOOK.md` "notarization fails", `app/scripts/sign-notarize.sh` |
| U17 | OPEN | Reference forms a rename does not find yet: JSX attribute references, TS imports without an ending, Markdown reference definitions, `<base href>`, imports in inline module scripts, HTML entities in file names | `core/src/refs.rs` |
| U18 | OPEN | The older save messages ("There is already a file called...") still show names without code styling | `ui/flows.js` |

## Open after 0.1.5 (Windows and Linux)

- The Windows smoke test was run on a 1024 x 768 screen; the layout below 1280 wide is not yet reviewed.
- The Intel test Mac was off the network for 0.1.5; only the Mac mini ran the Mac tests.
- Some stand-in fonts lack letters such as Hungarian ő and ű (Rockwell, Marker Felt, Chalkduster, Noteworthy) and two run about 25 % wider or narrower than the Mac font (Phosphate, Chalkduster).
- Help text still names Mac fonts as present "on every computer"; on Windows and Linux the app rewrites "Mac" to "computer" but a few font claims stay Mac-specific.
- Core permission tests fail when run as root on Linux (root ignores file permissions); run them as a normal user.
