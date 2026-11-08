---
class:   history
updated: 2026-11-08
status:  current
---

# Changelog: HTML Lab

All notable changes to HTML Lab. The format follows Keep a Changelog. Every change
that leaves the build folder bumps the version by one, and 0.1.9 is followed by
0.2.0. Decisions are recorded in [docs/adr/](docs/adr/).

## [0.1.6] - 2026-11-08

### Added

- A new Find bar made for kids: "Find a word" and "Change it to" boxes, Back, Next,
  Change and Change all, a count such as "2 of 5", and "Not found".
- Esc closes the Find bar from the code too.

### Fixed

- A selection on one line can now be seen. The highlight of the cursor's line was
  hiding it.

### Changed

- Found words use the app's own colours, in light and dark mode.

## [0.1.5] - 2026-11-08

### Added

- Windows and Linux builds: Ctrl shortcuts, a File and Help menu layout off the Mac,
  Windows paths and file names, "Open in Browser", and copy to the clipboard.
- Free look-alike fonts (SIL OFL) for the Mac fonts the templates use, served to the
  preview on Windows and Linux only.
- The canonical project documents, including architecture decision records in
  `docs/adr/`.
- MIT licence.

### Changed

- The app id is now `fi.cyborvent.htmllab`. Preferences saved by 0.1.4 and earlier
  are not carried over.
- Code comments removed; authors are Mikael Denut + Claude AI.
- The project moved to a new folder.

## [0.1.4] - 2026-11-08

Self-test 85 of 85 and smoke test 32 of 32 on the 2016 Intel Mac (macOS 12.7.6) and
on a Mac mini with the newest macOS. `cargo test`: 194 core tests. Speed on the
Intel Mac: 20 of 28 measured budget rows pass.

### Added

- 42 multi-page templates in six categories, each checked and reviewed.
- Help lesson on pictures for the web: which format for what, sizes, `width` and
  `height`, `loading="lazy"` and alt text.
- A template can declare `needs`, and the gallery hides it only on a Mac whose
  engine lacks the feature (ADR 0005). No template needs this yet.
- A design detector for contrast and style findings
  (`scripts/design-detect.mjs`).

### Changed

- Gallery previews and thumbnails are WebP (ADR 0006). The app bundle grew from
  12.2 MB in 0.1.1 to 21.0 MB, and its budget was raised to 30 MB.
- Release builds refuse uncommitted code and stamp the commit into the app, so a
  test result or an installed copy can be traced to its code (ADR 0007).
- Gates hardened: content checks added, the speed gate fails on scenario errors, and
  self-test minimums are pinned.
- Test and speed reports are kept per build, as `<version>-<revision>`.

### Fixed

- A link to `#place` on another page now lands on that place.
- Template gallery on Safari 15.6: the list spilled out of its dialog over Back. The
  grid row is now bounded and the list scrolls inside the dialog. Caught by the smoke
  test on the Intel Mac only.
- The engine check read `style="..."` in caption text as code. It now reads real
  attributes from `DOMParser`.
- The caret blinked forever in a tab that opened with focus, costing 1.5 % of a core
  at idle on the Intel Mac. It now rests 5 s after focus as well as after a caret
  move.
- The speed history overwrote one file on every run, so builds were never compared.

### Known

- Over budget on the Intel Mac and deferred to 0.1.5: gallery open (p95 113 ms,
  budget 100 ms) and memory (384 MB, budget 300 MB), among the 8 failing rows.

## [0.1.3]

A build that was measured on the Intel Mac and has no commit of its own. It had the
six JPEG templates (gallery open p95 98 ms, memory 334 MB). Its source changes are
part of the 0.1.4 commit.

## [0.1.2] - 2026-11-07

Self-test 77 of 77 and smoke test 30 of 30 on the Mac mini and the Intel Mac.

### Added

- Template gallery: a row in the New dialog opens a list with a big preview per
  template. Hover or arrow keys swap the preview, and a click opens a copy.
- Six three-page templates with public domain or CC0 pictures, checked by
  `scripts/check-template.py` and drawn to previews by
  `scripts/build-templates.py`.
- Core template checks, self-test steps for the gallery and every template page, and
  smoke steps by pointer events.

### Changed

- App bundle budget raised to 20 MB.

### Fixed

- The page helper waits for linked stylesheets before reporting ready (500 ms cap),
  so a page never shows unstyled. Found by the self-test on the Intel Mac.

## [0.1.1] - 2026-11-07

Speed: 20 of 25 budget rows on the Intel Mac. The 23 reported for 0.1.0 had been
measured with the real screen pushed out of the window.

### Added

- Smoke test (`--smoke-test`) that clicks through every screen at the middle of each
  button, types into the editor and saves a picture per step (ADR 0008).
- Script errors are written to a log file.

### Changed

- Test mode keeps animation frames running behind a lock screen, so the full tests
  run on the Mac mini.
- Every shipped change bumps the version.

### Fixed

- Empty window in 0.1.0: CodeMirror tooltip boxes carried the editor theme and
  covered New and Help.
- Squeezed tab names and a clipped close button.
- Add to my code inserted before the doctype.
- Stale line height after changing the text size.
- Lost page loads are retried after 3 s instead of 10 s.

## [0.1.0] - 2026-11-07

First version. It passed its function-level tests but was broken in use: see the
0.1.1 fix and ADR 0008.

Tested: `cargo test` (187 core, 14 Tauri), self-test 73 of 73 on the 2016 Intel Mac
with the signed universal build.

### Added

- Tauri 2 and Rust for the window, files and preview serving, and CodeMirror 6 for
  the editor (ADR 0002).
- Live preview by morphing, with scripts blocked (ADR 0004).
- 30 Help topics with recipes, 5 samples and 7 built-in public domain or CC0 photos.
- The extras E1 to E14, among them mistake hints, Save Automatically and Save a Copy.
- Signed, notarized and stapled universal build for macOS 12 and later (ADR 0003).
