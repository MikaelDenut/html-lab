---
class:   history
updated: 2026-11-09
status:  current
---

# Changelog: HTML Lab

All notable changes to HTML Lab. The format follows Keep a Changelog. Every change
that leaves the build folder bumps the version by one, and 0.1.9 is followed by
0.2.0. Decisions are recorded in [docs/adr/](docs/adr/).

## [0.3.0] - 2026-11-09

Contains 0.2.1, which was never released on its own.

### Added

- Any text file under 5 MB opens, edits and saves, not only HTML and CSS. Pictures and
  other files that are not text are still refused, with a message that says so.
- A file is saved the way it was: its line endings, tabs or spaces, indent width, final
  newline, BOM and encoding stay. Only your edit changes. A file opened and saved without
  an edit is the same file, byte for byte. A file with mixed line endings gets the one
  it uses most.
- Text saved as UTF-16 with a BOM opens and saves. A file in another encoding gets its
  own message: "HTML Lab cannot read this file."
- Colours and folding for JavaScript, TypeScript, JSON, Markdown, XML and SVG, SCSS,
  Sass, Less, YAML, Python, PHP, SQL, C and C++, Java, Go, Rust, Swift, Lua, Shell,
  PowerShell, Ruby, TOML and settings files (ini, env and the like). Each language
  loads only when a file needs it. C# and Kotlin files open as plain text, with no
  colours yet.
- Tidy for the languages where it is safe. Where spaces change what the code means
  (Python, YAML, Markdown, Sass, Ruby) or where Tidy has no rules yet, the Tidy button
  is greyed and says why.
- The footer names the language of a file that is not HTML or CSS, and its tab shows
  letters such as PY, JS or JSON.
- The "You are inside" row works for JavaScript and TypeScript (class, function and
  method names), Python (class and def names) and JSON (the path of keys).
- Hide and show the My page side, with the new button at the right end of the left
  toolbar, View > My Page Side, or Cmd+Shift+Y (Ctrl+Shift+Y on Windows and Linux).
  The side hides by itself for files that are not web pages and comes back for HTML
  and CSS. A click of your own wins. While it is hidden the page waits, and it catches
  up when the side comes back.
- The side shown on a file that is not a page shows a page that uses the file, or a
  page from the same folder, or says "This file has no page to show."
- Make a new file from the **+** after the last tab, or File > New File... (Cmd+Shift+N).
  Pick Web page, Style, Script, Text or Other, and the file gets the right ending.
  Other takes any name, such as `notes.md`.
- Change a file's name: click the name of the active tab, or use File > Change Name....
  A dialog lists every place in the project that uses the old name, and changes those
  places too (ticked by default). Unticking shows an "Are you sure?" warning. A rename
  never writes over another file.
- Undo a name change from the button in the message that follows, or File > Undo Change
  Name, for 15 seconds or until you edit one of the changed files.
- Mistake hints for JSON, JavaScript and TypeScript: a missing comma between JSON items,
  a bracket that never closes, a quote that never closes.
- HTML Lab is in the Open With list for `.js`, `.json`, `.md` and `.txt` files on Mac,
  Windows and Linux. It never becomes the default app for them.

### Changed

- The toolbar's New is now **New project**, and the File menu says New Project....
  Add a New File... is now New File..., and opens the new "Make a new file" dialog.
- The Open panel lets you pick any file. On Windows and Linux "All files" comes first.
- Other files in a folder no longer stop it from being a project. Only HTML and CSS
  files count, so a page with its style file and a `notes.txt` opens as a two-file
  project.
- A folder with no web pages opens its first text files, a README first.
- A folder with tens of thousands of files no longer slows HTML Lab down: it reads at
  most 2,000 entries of it.
- The teaching help (explanations, Point at the Page, Show the Boxes, page lighting,
  Help on This Word, autocomplete and closing tags) stays for HTML and CSS only. Other
  languages get folding, bracket matching, Find, closing brackets and Tidy.
- Tidy only changes indents, with the file's own indent. With a selection, it tidies
  only the selected lines.
- Each file keeps its own indent: a file with tabs gets tabs, a file with 4 spaces gets
  4 spaces.
- A message about many files names at most 3 of them, then "and 2 more".
- Help's keyboard list has Cmd+Shift+N "Make a new file" and Cmd+Shift+Y "Hide or show
  the My page side".
- The editor loads in parts: the start part stays under 600 KB, and the language parts
  load when needed.

### Fixed

- A file with Windows line endings (CRLF) or a BOM lost them when it was saved. It keeps
  them now.
- A UTF-16 file from Windows (for example a PowerShell script) was refused as "not text".
  It opens now.
- Found before release and fixed: Tidy left lines inside multi-line strings alone only
  in some languages, and changed `<pre>` in a PHP file; a name change with an open file
  of mixed line endings said the file had changed; changing `.ts` to `.tsx` kept the old
  colours; hiding the My page side lost the keyboard focus; Undo of a name change could
  stop half way without saying so.
- Found in the Windows run and fixed: the Open in your browser button was hidden on a
  narrow My page side, and on Windows a save could fail once while another program
  looked at the file.

## [0.2.1] - unreleased

Not released on its own; part of 0.3.0.

### Changed

- A page with a script now says "Scripts do not run here. Open in Safari to see them
  work." On Windows and Linux it says "Open in your browser". Those words are a button
  that opens the page in the browser, where its scripts run.
- The self-test's wait for the page names what was stuck when the wait ran out, not
  what it saw when the wait began.
- Test names say "the typing" and "the page", not "his".
- The self-test and the smoke test now expect all 42 templates in the gallery, not 6.
- `speed-run.py` keeps a second run for the same build as a new file ending in `-2`,
  instead of writing over the first.
- `app/docs/CONTRACTS.md` matches the code again, with the commands that check it.
- The README says how to look inside a page someone else made.

### Fixed

- Show the Boxes: a label no longer covers the first letter of the box above it. Each
  label goes where it covers no text.
- Show the Boxes turns off when the last tab closes, so the next page starts without
  boxes.

## [0.2.0] - 2026-11-08

Three planned steps (0.1.8, 0.1.9 and 0.2.0) released as one version.

### Added

- Fold arrows next to the line numbers. A part such as `<body>` to `</body>` folds into
  one line with a pill, "12 lines folded". A click on the pill unfolds it. The pill
  turns into an Oops pill when a mistake hides inside.
- Edit menu: Fold This Part (Cmd+Alt+[), Unfold This Part (Cmd+Alt+]) and Unfold
  Everything. On Windows and Linux the keys are Ctrl+Shift+[ and Ctrl+Shift+].
- Both tag names of an element light up together while the cursor is on one of them.
- A soft band shows a whole element or CSS rule while the cursor is on its name or the
  mouse is on its fold arrow.
- A "You are inside" row under the code: "html › body › main › p", or the CSS rule and
  its `@media`. A click on a name selects that part of the code.
- The mouse on the page lights up that element's code while the page's tab is active.
  When that code is off screen, a chip such as "Line 40" takes you to it.
- Point at the Page (View menu and a header button): click something on the page to
  select its code.
- Moving the cursor into another element outlines it on the page for 2 seconds. The cursor in a CSS
  rule outlines what the rule styles, and the header says how many things it styles.
- Explanations: rest the mouse on a tag name, a CSS word or a color name to see what it
  means, with "More in Help". Resting on a picture's file name shows the picture.
- Show the Boxes (View menu and a header button) outlines every box on the page, in four
  colors by depth.

### Fixed

- On Windows and Linux the page kept its built-in fonts only until the first change.
  It keeps them now, and a page without style no longer says "The style is inside this
  page".
- A page shown right after another one no longer waits 3 seconds when the first one
  finishes loading late. Seen on Windows and Linux.

## [0.1.7] - 2026-11-08

### Added

- HTML Lab is in the Open With list for HTML and CSS files on Mac, Windows and Linux.
  The browser stays the default for web pages. On a Mac, HTML Lab opens CSS files on
  double-click when no other app has claimed them.
- A folder dropped on the HTML Lab icon opens as a project, with its home page shown.
- A file opened while HTML Lab is running goes into the open window, and waits if a
  message is showing.

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
