---
class:   truth
updated: 2026-11-08
status:  current
---

# Contributing to HTML Lab

This file is the authority on **how work is done here**. [HANDOVER.md](HANDOVER.md) says what the state is; this says what the practice is. When the two disagree about practice, this one wins.

---

## Definition of done

An item is done when all of these hold. Not most of them.

1. The change is implemented.
2. A test covers it, and **the teeth ritual has been run** (below).
3. Every gate that applies is run, and its result is read (below).
4. The documents that became untrue are updated in the same commit.
5. The maintainer has seen the result, where the result is visible.

## The gates

Run them inside `app/`. `APP` is the path to a built `HTML Lab.app`.

| Gate | Command | What it proves |
|---|---|---|
| Rust core | `cd core && cargo test` | Debug only, never `--release`. Names, folder scan, saving, preferences, content |
| Self-test | `python3 scripts/selftest-run.py "$APP" --host intel` | The app's own tests in its real WebKit. Fewer than `MIN_TESTS` in `ui/self-test.js` is a failure |
| Smoke test | `python3 scripts/selftest-run.py "$APP" --host intel --smoke` | Real clicks and typing through every screen. Fewer than `MIN_STEPS` in `ui/smoke-test.js` is a failure |
| Speed | `python3 scripts/speed-run.py "$APP"` | Each budget in `scripts/speed-budgets.json`, measured on the Intel test Mac and compared with the previous build |
| One template | `python3 scripts/check-template.py core/content/templates/<id>` | Mechanical template rules: the older engine, no script, Mac system fonts, local pictures |
| All templates | `python3 scripts/template-status.py` | Each template's stage, from evidence: written, checked, reviewed, packed, tested, installed |
| Release | `zsh scripts/sign-notarize.sh` | Universal build, signature, notarization, Gatekeeper. Refuses uncommitted code and differing versions |

Notes:

- `selftest-run.py` runs on one test Mac at a time, chosen with `--host intel` or `--host mini`. Before a release run the self-test and the smoke test on both: an Intel Mac on macOS 12, the oldest engine, and a Mac on the newest macOS. The host addresses are constants at the top of `selftest-run.py`, `speed-run.py`, `template-status.py` and `intel-run.sh`; set your own.
- A test Mac nobody is looking at must have its display awake (`caffeinate -u`), or WebKit pauses animation frames and the self-test waits forever.
- Test results are kept per version and commit in `test-history/` and `speed-history/`. They only count for the build they name.
- Not every speed row passes today. The failing rows are tracked in [docs/BACKLOG.md](docs/BACKLOG.md). A change must not add a failing row, and a rise in the comparison against the previous build needs a reason.
- The smoke test exists because of a real failure: a build passed its self-test while a stray layer covered the buttons, since the self-test calls functions instead of clicking. A check has to go through the same door the child uses.

## The teeth ritual

This is the one non-negotiable in this file. For every new test:

1. Back up the file you are about to break.
2. **Break the thing on purpose.** Restore the exact defect the test claims to catch.
3. **Run the test and watch it FAIL.** If it passes, the test is wrong, not the code.
4. Put the fix back and watch it pass.
5. Record what you broke, in the test's own comment or in the [docs/INVARIANTS.md](docs/INVARIANTS.md) entry.

A test that has not bitten has not been shown to bite. **A test that would pass either way is worse than no test, because it certifies the defect.**

### The two named enemies

**The VACUOUS test.** It reads an assumed local value instead of the real thing, so reversing the real thing leaves it green. The classic shape: the test asserts a constant equals the constant it was copied from, while the code that consumes the constant does something else. Detection: change the real thing, not the constant, and see whether the test notices.

**The TAUTOLOGICAL test.** It compares output against the very function under test, so it agrees with itself by construction. The classic shape: the expected value is computed by calling the same helper the implementation calls. Detection: derive the expectation independently, from first principles or a hand-written table, never from the code path being tested.

Both survive the teeth ritual only if step 3 is not actually watched.

## Documentation claims are executable or cited

A fact in both a document and the code is a fact that will drift. Only two treatments are permitted:

- **Cited**: the document points at the code as the authority and does not repeat the value.
- **Executed**: a test parses the document and asserts the claim against the code.

Do not hand-copy a value from the code into a document.

## Working rules

- **Version.** Every build that leaves the build folder goes up by one: 0.1.9 is followed by 0.2.0. Keep `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` the same; the release script refuses a mismatch.
- **Committed bundles.** `ui/editor.bundle.js` and `src-tauri/helper.min.js` are in git. Rebuild them after changing `ui-src/`; the commands are in [README.md](README.md). The release script rebuilds them first, so a stale bundle shows up as a change and is refused.
- **Templates.** The rules are in `core/content/templates/RULES.md`. After changing one, run `python3 scripts/build-templates.py` to pack the gallery.
- **Pictures.** Public domain or CC0 only, each with a row in the `SOURCES.md` files.
- **npm.** Run it only when `npm prefix` prints the `app` folder.
- **Logic goes in Rust** when it does not touch the screen. `core/` has no Tauri in it, and JavaScript stays a thin view layer.
- **The child's work comes first.** Save through `atomic_write` in `core/src/files.rs`, and never merge into or overwrite a folder.
- **Words in the app** are English, in short sentences and common words a child aged 8 to 10 can read.

## Commits

- One bounded change per commit. If the message needs "and", it is two commits.
- The subject says what changed and why in one line, imperative mood.
- The body carries the measurement, when there is one: before and after.
- Reference the backlog id when the commit closes or advances one.

## Releasing is never automatic

**Releasing happens on the maintainer's explicit word alone.** Not because the gates are green, and not because it is the obvious last step. A release comes only from committed code; `HTMLLAB_TEST_BUILD=1` allows a test build from uncommitted code and marks its revision `-dirty`.

Signing needs a Developer ID and a notary profile you supply. Mechanism and rollback: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Style

- No em or en dashes. Hyphen only, including commit messages.
- Comments explain WHY. A comment that restates the line above it is noise.

## Comments

Code carries almost no comments. Explanations belong in the docs. The CSS comments inside `app/core/content/templates/` are lesson content for the reader and stay.
