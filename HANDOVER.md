---
class:   state
updated: 2026-11-08
status:  current
---

# HTML Lab: handover

This file plus the documents it links are the only things a new session needs to read before it can work.

Everything stated as fact was measured on this machine. Where something is a hypothesis it says so.

## NEXT SESSION START PROTOCOL - read this before doing ANYTHING

1. **Verify the checkpoint below.** Run the Verify command on the installed-revision row. If it no longer matches, this file is stale: re-derive every row from its own command.
2. Read [docs/INVARIANTS.md](docs/INVARIANTS.md) before touching anything it names, then [docs/BACKLOG.md](docs/BACKLOG.md).
3. **A push or a publish happens on the owner's explicit word alone.** Local commits with no remote are the normal state today.
4. **Do not start the backlog on your own initiative.** Agree the item with the owner first.
5. **A pasted audit or bug list is a set of leads**, to be reproduced against this tree before it is believed.

## Checkpoint

The project folder is tracked inside a larger private repository today, so repository HEAD moves with unrelated work. The anchor is the revision stamped in the installed app.

| Fact | Value | Verify |
|---|---|---|
| version | 0.1.4 | `grep '"version"' app/package.json` |
| installed revision, this Mac and the Intel test Mac | 247e22328486 | `/usr/libexec/PlistBuddy -c 'Print :HTMLLabRevision' '/Applications/HTML Lab.app/Contents/Info.plist'` |
| app code changed since that revision | 33 files changed, 17898 insertions(+) | `git diff --stat 247e22328486 HEAD -- app/core/src app/src-tauri/src app/ui app/ui-src` |
| branch | main | `git rev-parse --abbrev-ref HEAD` |
| remote for this project | none | no public repository exists yet |
| core tests, after the folder move | 194 passed | `cd app/core && cargo test` |
| self-test on 247e22328486 | 85 of 85, Intel and current Mac | `app/test-history/0.1.4-247e22328486/` |
| smoke test on 247e22328486 | 32 of 32, Intel and current Mac | same folder |
| speed on the Intel Mac | 20 pass, 8 fail of 28 measured rows | `app/speed-history/0.1.4-247e22328486.txt` |
| templates | 42 written, checked, reviewed, packed | `python3 app/scripts/template-status.py` |
| not run this session after the move | self-test, smoke, speed, release build | they ran before the move on the same code |

## Where things stand

HTML Lab 0.1.4 is finished, signed, notarized and installed. Canonical docs were created on 2026-11-08 from the design record and checked against the code by their writers. No independent verifier read them. INVARIANTS is entirely unconfirmed candidates.

## What the next session must not get wrong

- Publishing is blocked by the private values listed in [docs/BACKLOG.md](docs/BACKLOG.md). A public repository needs a fresh history, never this one.
- After moving the folder, a cached test binary keeps the old path: `cargo clean` in `app/core`.
- `sign-notarize.sh` refuses uncommitted code, and running a test writes reports inside `app/`, so commit them before the next build.
- Pass `--out` and do not use `--runs 1` on a build whose history is already recorded: `speed-run.py` overwrites that build's record.

## Companion documents

| Read | When |
|---|---|
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | you need to build, test, install or diagnose |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | you need to find where something lives |
| [docs/INVARIANTS.md](docs/INVARIANTS.md) | you are changing behaviour it names |
| [docs/BACKLOG.md](docs/BACKLOG.md) | you are choosing work |
| [CONTRIBUTING.md](CONTRIBUTING.md) | you are about to call a change finished |
| [docs/INDEX.md](docs/INDEX.md) | you do not know which document answers your question |
