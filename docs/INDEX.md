---
class:   truth
updated: 2026-11-08
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
| [../CHANGELOG.md](../CHANGELOG.md) | when you need to know what changed between versions |
| [../README.md](../README.md) | when you need what this is and how to run it |
| [../LICENSE](../LICENSE) | before reusing any of this elsewhere |

---

## Where the executable truth lives

Documentation drifts; the code does not. **When a document and the code disagree, the code is right and the document is a bug.** Fix the document, and if the disagreement was expensive, add a test that parses the document so it cannot drift again.

Paths are relative to `app/`.

| Question | Authority |
|---|---|
| What is the shipped version? | `src-tauri/tauri.conf.json`, `version`. `scripts/sign-notarize.sh` refuses a build when `package.json` or `src-tauri/Cargo.toml` differs |
| Which file kinds exist, and what is a page or a stylesheet? | `core/src/kinds.rs`, `KINDS` |
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
| What is refused on read? | `core/src/files.rs`, `read_text` |
| How is a file written? | `core/src/files.rs`, `atomic_write` |
| How are names cleaned? | `core/src/names.rs` |
| What is the shape and default of the preferences? | `core/src/prefs.rs`, `Prefs` |
| What is a valid gallery template? | `scripts/check-template.py`, with the writing brief in `core/content/templates/RULES.md` |
| What does the gallery contain? | `core/content/gallery/templates.json`, written only by `scripts/build-templates.py` |
| What does the bundled editor or helper contain? | `ui-src/`. `ui/editor.bundle.js` and `src-tauri/helper.min.js` are its build output |
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
