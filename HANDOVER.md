---
class:   state
updated: 2026-11-09
status:  current
---

# HTML Lab: handover

This file plus the documents it links are the only things a new session needs to read before it can work.

Everything stated as fact was measured on this machine. Where something is a hypothesis it says so.

## NEXT SESSION START PROTOCOL - read this before doing ANYTHING

1. **Verify the checkpoint below.** Run the Verify command on the version and test build rows. If it no longer matches, this file is stale: re-derive every row from its own command.
2. Read [docs/INVARIANTS.md](docs/INVARIANTS.md) before touching anything it names, then [docs/BACKLOG.md](docs/BACKLOG.md).
3. **A push or a publish happens on the owner's explicit word alone.** Local commits in this private repository are the normal state; the public repository gets an export at release.
4. **Do not start the backlog on your own initiative.** Agree the item with the owner first.
5. **A pasted audit or bug list is a set of leads**, to be reproduced against this tree before it is believed.

## Checkpoint

The project folder is tracked inside a larger private repository, so repository HEAD moves with unrelated work. The anchors are the revision stamped in a build and the test reports named after it. A test build's revision is the repository HEAD it was built at, which may be a commit of other work that holds the same app code.

| Fact | Value | Verify |
|---|---|---|
| version in the code | 0.3.0, released 2026-11-09 | `grep '"version"' app/package.json` |
| newest code commit for 0.3.0 | 9b9dac03 (fixes from the Windows run); 31ef89f8 is a later repository HEAD with the same app code | `git log --oneline -1 -- app/core app/src-tauri app/ui app/ui-src` |
| released version | 0.3.0, published 2026-11-09 | `gh release view v0.3.0 -R MikaelDenut/html-lab --json tagName,publishedAt` |
| installed on this Mac | 0.3.0 at 31ef89f827ae | `/usr/libexec/PlistBuddy -c 'Print :HTMLLabRevision' '/Applications/HTML Lab.app/Contents/Info.plist'` |
| 0.3.0 release build | 31ef89f827ae, universal, signed and notarized; the Mac mini ran the release zip | `cat app/src-tauri/target/hand-over/build.json` |
| 0.2.1 test build | 428fcaa2ab7a, signed and notarized, not published; self-test 141 of 141, smoke 39 of 39 | `ls -d app/test-history/0.2.1-*` |
| branch | main | `git rev-parse --abbrev-ref HEAD` |
| public repository | https://github.com/MikaelDenut/html-lab, its own history, made by the export | `gh repo view MikaelDenut/html-lab --json url` |
| release files | `release/<version>/` (0.1.5, 0.1.6, 0.1.7, 0.2.0, 0.3.0) and `release/tools/`, not in git | `ls release` |
| core tests | 318 on the Mac; 280 on Windows (one Windows-only test, and some tests are cfg-gated); Linux 310 pass, 7 permission tests fail as root | `awk '/#\[test\]/{n++} END{print n}' app/core/src/*.rs` |
| app tests | 24 unit tests and 3 in `tests/open_with.rs` (all passed at WP7) | `awk '/#\[test\]/{n++} END{print n}' app/src-tauri/src/*.rs; grep -c '#\[test\]' app/src-tauri/tests/open_with.rs` |
| self-test on the 0.3.0 release | 202 of 202 on the Mac mini, Linux (Xvfb) and Windows (installed build 201, the one swatch timeout passed on the rerun from the zip) | `python3 -c "import json;d=json.load(open('app/test-history/0.3.0-31ef89f827ae/mini-selftest.json'));print(d['passed'],d['total'])"` |
| smoke test on the 0.3.0 release | 49 of 49 on the Mac mini, Linux and Windows | `python3 -c "import json;d=json.load(open('app/test-history/0.3.0-31ef89f827ae/mini-smoke.json'));print(d['passed'],d['total'])"` |
| Linux and Windows at 9b9dac03 | Linux .deb and AppImage, SHA256SUMS signed with the Cyborvent release key; Windows installer and zip signed by Cyborvent Oy, Open With checked, uninstall clean; no reports in git | `ls release/0.3.0/*` |
| editor bundle | entry 93,269 bytes; 31 chunk files in `app/ui/editor/` | `wc -c app/ui/editor.bundle.js; python3 -c "import os;print(len(os.listdir('app/ui/editor')))"` |
| notary keychain profile | The notary profile named by `profile` in `scripts/local.json` is present; it lives in the data-protection keychain and can only be read while the Mac is unlocked, so night builds with the screen off fail to notarize ("No Keychain password item found") and it works again once unlocked. `sign-notarize.sh` checks it first | `xcrun notarytool history --keychain-profile <profile>` |
| not run for 0.3.0 | Intel Mac, speed | BACKLOG T6 |
| speed on the Intel Mac | last measured on 0.1.4: 20 pass, 8 fail of 28 rows | `app/speed-history/0.1.4-247e22328486.txt` |
| templates | 42 written, checked, reviewed, packed; tested 0, since no build after 0.1.4 has Intel runs | `python3 app/scripts/template-status.py` |

## Where things stand

HTML Lab 0.3.0 is released on Mac, Windows and Linux (2026-11-09), with 0.2.1 inside it. [docs/HANDBACK-0.3.0.md](docs/HANDBACK-0.3.0.md) says what was done, how it was tested, the fixes after review and after the Windows run, and what only a human can check. cyborvent.com links the 0.3.0 downloads. In INVARIANTS, C1 to C42 are still unconfirmed candidates; C43 to C48 and the rewritten C9, C10, C37 and C38 were confirmed through NEXT-0.3.0.md and have guard tests that failed with the defect put back. None is in the Enforced list yet.

## What the next session must not get wrong

- The public repository is made by the export, which leaves out `PLAN.md`, `docs/NEXT-*.md`, `docs/HANDBACK-*.md`, `docs/research/`, `docs/mockups-*` (from 0.3.0, as NEXT-0.3.0.md says), test and speed history and `app/scripts/local.json`. Never push this private history.
- After moving the folder, a cached test binary keeps the old path: `cargo clean` in `app/core`.
- `sign-notarize.sh` refuses uncommitted code, and running a test writes reports inside `app/`, so commit them before the next build. `HTMLLAB_TEST_BUILD=1` still signs and notarizes, so it fails while the Mac is locked (the notary profile cannot be read then); then use the fallback in NEXT-0.3.0.md "Gates" (`--no-sign` arm64 build, PlistBuddy `HTMLLabRevision`, `codesign --force --deep -s -`) and say so.
- The editor is an entry bundle plus chunks in `app/ui/editor/`: rebuild with the RUNBOOK esbuild command, which deletes `ui/editor` first, and commit both. The start-up budget (entry plus static chunks, 600 KB) has about 2 KB left.
- `speed-run.py` keeps a second run for the same build as `-2`; pass `--out` to keep its working files apart.

## Companion documents

| Read | When |
|---|---|
| [docs/HANDBACK-0.3.0.md](docs/HANDBACK-0.3.0.md) | you release 0.3.0, or need why a 0.3.0 choice was made |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | you need to build, test, install or diagnose |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | you need to find where something lives |
| [docs/INVARIANTS.md](docs/INVARIANTS.md) | you are changing behaviour it names |
| [docs/BACKLOG.md](docs/BACKLOG.md) | you are choosing work |
| [CONTRIBUTING.md](CONTRIBUTING.md) | you are about to call a change finished |
| [docs/INDEX.md](docs/INDEX.md) | you do not know which document answers your question |
