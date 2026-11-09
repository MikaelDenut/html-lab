---
class:   truth
updated: 2026-11-09
status:  current
---

# Documentation index: HTML Lab

Start at [../HANDOVER.md](../HANDOVER.md). It is written to be the only thing a new session must read before working.

---

## Continuation set

| Document | Read it when |
|---|---|
| [../HANDOVER.md](../HANDOVER.md) | always first, before anything else |
| [INVARIANTS.md](INVARIANTS.md) | before changing anything it names |
| [BACKLOG.md](BACKLOG.md) | before choosing work, or before calling anything fixed |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | before the first test, or the first commit |
| [RUNBOOK.md](RUNBOOK.md) | when something is broken, or before building a release |
| [../AGENTS.md](../AGENTS.md) | when you are an agent new to this repository |

## Subsystem reference

| Document | Read it when |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | before adding a module or crossing a boundary |
| [../app/docs/CONTRACTS.md](../app/docs/CONTRACTS.md) | before changing a name or shape at a seam between Rust, the screens and the helper |
| [../app/core/content/templates/RULES.md](../app/core/content/templates/RULES.md) | before writing or changing a gallery template |
| [GLOSSARY.md](GLOSSARY.md) | when a term in the code means less than it sounds like |
| [adr/](adr/) | before reversing a decision that already looks wrong |
| [adr/0009-teaching-kinds-and-lazy-language-chunks.md](adr/0009-teaching-kinds-and-lazy-language-chunks.md) | before making a language decide what is a web file, or moving a language into the start-up bundle |
| [adr/0010-rename-and-reference-rules.md](adr/0010-rename-and-reference-rules.md) | before changing how Change Name renames a file or rewrites the places that use it |
| [../CHANGELOG.md](../CHANGELOG.md) | when you need to know what changed between versions |
| [../README.md](../README.md) | when you need what this is and how to run it |
| [../LICENSE](../LICENSE) | before reusing any of this elsewhere |

## Version briefs and handbacks

Private: the public export leaves these out (`docs/NEXT-*.md`, `docs/HANDBACK-*.md`, `docs/research/`, `docs/mockups-*`).

| Document | Read it when |
|---|---|
| [NEXT-0.3.0.md](NEXT-0.3.0.md) | you need what 0.3.0 was asked to do, its rules and its gates |
| [HANDBACK-0.3.0.md](HANDBACK-0.3.0.md) | you need what 0.3.0 did, its decisions, its test results and what only a human can check |
| [research/030-subsystem-map.md](research/030-subsystem-map.md) | you need how tabs and flows, files and core, layout and preview, the editor, and tests and build worked in 0.2.1 (line numbers from 9659b164) |
| [mockups-0.3.0/](mockups-0.3.0/) | you need the agreed look of a 0.3.0 screen (`index.html` lists the eleven) |
| [NEXT-0.2.1.md](NEXT-0.2.1.md) and [HANDBACK-0.2.1.md](HANDBACK-0.2.1.md) | you need the same for 0.2.1 |

---

## Where the executable truth lives

Documentation drifts; the code does not. **When a document and the code disagree, the code is right and the document is a bug.** Fix the document, and if the disagreement was expensive, add a test that parses the document so it cannot drift again.

Paths are relative to `app/`.

| Question | Authority |
|---|---|
| What is the shipped version? | `src-tauri/tauri.conf.json`, `version`. `scripts/sign-notarize.sh` refuses a build when `package.json` or `src-tauri/Cargo.toml` differs |
| Which file kinds exist, and what is a page or a stylesheet? | `core/src/kinds.rs`, `KINDS` (the teaching kinds); every other text file is `CODE_KIND` |
| Which languages get colours, folding and Tidy? | `core/src/kinds.rs`, `LANGUAGES`; the chunk each one loads is `LANGUAGE_CHUNKS` in `ui-src/editor.js` |
| Which file extensions count as pictures? | `core/src/kinds.rs`, `PICTURES` |
| What may a page in the preview run or load? | `core/src/kinds.rs`, `csp_for` and `SCRIPT_POLICY` |
| What may a non-page response in the preview run? | `src-tauri/src/preview.rs`, `NOT_A_PAGE_CSP` |
| What may the app window itself load? | `src-tauri/tauri.conf.json`, `app.security.csp` |
| Which paths does `preview://` serve? | `src-tauri/src/preview.rs`, `respond` |
| Which paths does `gallery://` serve? | `core/src/content.rs`, `gallery_image` |
| Which commands can JavaScript call? | `src-tauri/src/main.rs`, `generate_handler!` |
| What are the preview update timings and states? | `ui/preview.js` |
| Which messages pass between the app and the page? | `ui-src/helper.js` and the `onMessage` switch in `ui/preview.js` |
| What is a project, when a file is opened? | `core/src/project.rs`, `scan_folder` |
| What is refused on read? | `core/src/files.rs`, `read_decoded` and `decode_text` |
| How is a file written? | `core/src/files.rs`, `encode_text` (its own BOM, encoding and line ending) and `atomic_write` |
| How is a file renamed, and which places that use its name change? | `core/src/files.rs`, `rename_file` and `rewrite_references`; `core/src/refs.rs`, `find_references` |
| How many folder entries may one open or one window focus read? | `core/src/project.rs`, `MAX_SCAN_ENTRIES`; `core/src/files.rs`, `MAX_STAMP_STATS` |
| How are names cleaned or checked? | `core/src/names.rs`, `clean_file_name` and `check_rename` |
| What is the shape and default of the preferences? | `core/src/prefs.rs`, `Prefs` |
| What is a valid gallery template? | `scripts/check-template.py`, with the writing brief in `core/content/templates/RULES.md` |
| What does the gallery contain? | `core/content/gallery/templates.json`, written only by `scripts/build-templates.py` |
| What does the bundled editor or helper contain? | `ui-src/`. `ui/editor.bundle.js`, the chunks in `ui/editor/` and `src-tauri/helper.min.js` are its build output |
| Which file types does the app offer to open (Open With)? | `fileAssociations` in `src-tauri/tauri.macos.conf.json` and `src-tauri/tauri.linux.conf.json`, and `src-tauri/windows/file-types.nsh`; checked by `src-tauri/tests/open_with.rs` |
| What does a release build run? | `scripts/sign-notarize.sh` |
| What are the speed limits? | `scripts/speed-budgets.json`, compared by `scripts/speed-gate.py` |
| When does a self-test or smoke run pass? | `problems` in `scripts/selftest-run.py`, with the minimums `MIN_TESTS` in `ui/self-test.js` and `MIN_STEPS` in `ui/smoke-test.js` |
| Where does a template stand? | `scripts/template-status.py`, derived from evidence |
| Which test results belong to which build? | `test-history/<version>-<revision>/` and `speed-history/` |

---

## Conventions

- No em or en dashes anywhere, in code, comments, tests or documents. Hyphen only.
- English only, in the interface, in Help and in these documents.
- Comments explain why, and cite the measurement or the source where one exists.
- A document that records a measurement says when it was measured.
- Front matter on every document: `class`, `updated`, `status`. Nothing else.
