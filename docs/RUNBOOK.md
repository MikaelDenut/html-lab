---
class:   truth
updated: 2026-11-08
status:  current
---

# Runbook: HTML Lab

What to type, and what to do when something goes wrong. Commands run inside
`app/` unless a line says otherwise.

Signing values and machine names are not in git. They live in `scripts/local.json`, which you create from `scripts/local.example.json`:

| Value | Key |
|---|---|
| Developer ID signing identity | `identity` |
| Notary keychain profile name | `profile` |
| Test Macs (SSH) | `intel`, `mini` |

Two test Macs are used, both reached over SSH: an Intel Mac on macOS 12 (`--host
intel`), which carries the oldest supported WebKit, and a current Mac (`--host
mini`). SSH must work with keys alone: the scripts use `BatchMode=yes`.

---

## Commands at a glance

| Job | Command |
|---|---|
| Rust core tests | `cd core && cargo test` |
| Rust app tests | `cd src-tauri && cargo test` |
| Build the editor bundle | `npx esbuild ui-src/editor.js --bundle --minify --format=esm --target=safari15 --outfile=ui/editor.bundle.js` |
| Build the preview helper | `npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js` |
| Build for one architecture | `npx @tauri-apps/cli@2 build --target x86_64-apple-darwin --bundles app --no-sign` (or `aarch64-apple-darwin`) |
| Self-test | `python3 scripts/selftest-run.py "<path to HTML Lab.app>" --host intel` |
| One part of the self-test | add `--only "<words in the test name>"` |
| Smoke test | add `--smoke` |
| Speed check | `python3 scripts/speed-run.py "<path to HTML Lab.app>"` |
| Check one template | `python3 scripts/check-template.py core/content/templates/<id>` |
| Pack the templates | `python3 scripts/build-templates.py` (needs `cwebp`) |
| Where each template stands | `python3 scripts/template-status.py` |
| Signed, notarized release | `zsh scripts/sign-notarize.sh` |

`cargo test` in `core` runs 194 tests (last run 2026-11-08, all passed). The 14
tests in `src-tauri` are a separate run. `cargo test` from `src-tauri` does not
run the core tests.

Run `cargo test` in debug only, never with `--release`. A release build reads
the gallery only from the folder the app gives it (`core/src/content.rs:59`), and
the tests give none.

Built app paths:

- `app/src-tauri/target/<target>/release/bundle/macos/HTML Lab.app`
- `<target>` is `x86_64-apple-darwin`, `aarch64-apple-darwin` or `universal-apple-darwin`.

---

## First setup

Needs: Rust with the `x86_64-apple-darwin` and `aarch64-apple-darwin` targets,
Node, Xcode command line tools. The toolchain last used was rustc 1.99.0 and
Node 24.22.1. There is no `rust-toolchain` file.

**Verify first.** npm walks upward to find a project, so a parent folder with
its own `node_modules` can be pruned by mistake.

```bash
npm prefix
```

It must print this `app` folder. If it prints anything else, stop.

**Then act.**

```bash
npm ci
```

---

## Running a development build

`src-tauri/tauri.conf.json` has no `devUrl`: the UI is the plain files in `ui/`.
The usual loop rebuilds and runs on the Intel Mac:

```bash
zsh scripts/intel-run.sh --self-test
```

Any app flag can replace `--self-test`. `--no-build` as the second argument skips
the build. `--self-test=perf`, `--self-test=huge`, `--self-test=drag` and
`--self-test=lost` run timing or diagnostic probes instead of the tests.

Limit, from reading the script, not from a run: the `.app` that `intel-run.sh`
makes holds only the binary and the icon, with no `Resources/gallery`. Expect the
gallery tests to need a real build through `selftest-run.py`.

`npx @tauri-apps/cli@2 dev` was not tried while writing this file.

---

## Test runs and what they change

Each run copies the app to `/tmp` on the test Mac, runs it and removes it.
Nothing is installed. Each one does touch that Mac's preferences for HTML Lab:

| Run | Effect on the test Mac's preferences |
|---|---|
| Self-test | Clears `tried` and `session` at the end, not restored |
| Smoke test | Sets prefs.json aside and puts it back |
| Speed check | **Deletes the preferences folder before each measured run, not restored** (`scripts/speed-run.py:163`) |

Use a test Mac where nobody relies on the app's preferences.

Reports:

- Self-test and smoke: `test-history/<version>-<revision>/<host>-<kind>.json`, with the runner's verdict inside.
- Smoke pictures: `app/src-tauri/target/smoke/<host>/`.
- Speed: `app/src-tauri/target/speed/<version>-<revision>/`, and `speed-history/<version>-<revision>.json` and `.txt` for a committed build.

A pass prints `ALL PASS` and exits 0. A speed run prints `ALL PASS` or `NOT
PASSED`, and also exits non-zero for one failed row. 0.1.4 at 247e22328486 has 9
of 28 rows failing, so a speed run is expected to exit non-zero today.

---

## Symptom: a release is needed

**Verify first.** The script stops on uncommitted code, so check before starting.

```bash
git status --porcelain -- .
npx esbuild ui-src/editor.js --bundle --minify --format=esm --target=safari15 --outfile=ui/editor.bundle.js --log-level=warning
npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js --log-level=warning
git status --porcelain -- .
```

Both bundles are in git. If the second status lists a bundle, commit it. Empty
output means go. Also make sure `src-tauri/tauri.conf.json`, `package.json` and
`src-tauri/Cargo.toml` hold the same version, or the script stops.

**Then act.**

```bash
zsh scripts/sign-notarize.sh
```

It stops at the first failure. In order: signing identity check, both bundles,
uncommitted check, version check, universal build, revision stamp, signature,
notarization, staple, Gatekeeper check, zip. Success prints `ready:` and leaves
`app/src-tauri/target/hand-over/HTML Lab.zip` and `app/src-tauri/target/hand-over/build.json`.

For a test build from uncommitted code, set `HTMLLAB_TEST_BUILD=1`. The revision
then ends in `-dirty`, and speed history does not keep it.

**Rollback.** `app/src-tauri/target/hand-over/` is wiped by each run, so a previous
zip is not kept there. To go back, check out the earlier commit and rebuild.

---

## Symptom: the app must be installed on a Mac

No install script exists; searched: `ls scripts`.

**Verify first.**

```bash
shasum -a 256 "src-tauri/target/hand-over/HTML Lab.zip"
```

Compare with `zipSha256` in `app/src-tauri/target/hand-over/build.json`. A difference
means the zip is not the one that was built: rebuild.

**Then act.** Close HTML Lab on that Mac, then unpack into Applications.

```bash
rm -rf "/Applications/HTML Lab.app"
ditto -x -k "HTML Lab.zip" /Applications
spctl --assess --type execute -vv "/Applications/HTML Lab.app"
/usr/libexec/PlistBuddy -c "Print :HTMLLabRevision" "/Applications/HTML Lab.app/Contents/Info.plist"
```

`spctl` must say accepted, and the revision must match `app/src-tauri/target/hand-over/build.json`.

---

## Symptom: `sign-notarize.sh` says "release build refused"

**Verify first.**

```bash
git status --porcelain -- .
```

A listed bundle means a commit was made without rebuilding it: the script rebuilt
it and found a difference. Any other listed file is real uncommitted work.

**Then act.** Commit the listed files, then run the script again.

---

## Symptom: `sign-notarize.sh` says "versions differ"

**Verify first.** The message prints all three values.

**Then act.** Make `src-tauri/tauri.conf.json`, `package.json` and
`src-tauri/Cargo.toml` agree, and commit. The version moves up by one with each
change that leaves the build folder, so 0.1.9 is followed by 0.2.0.
`core/Cargo.toml` is not part of the check.

---

## Symptom: `signing identity missing`, or notarization fails

**Verify first.**

```bash
security find-identity -v -p codesigning
```

If the identity named by `identity` in `scripts/local.json` is not listed, the certificate is not on this
Mac. If it is listed and `notarytool` fails on the profile, the keychain profile
named by `profile` is missing. If the status is not `Accepted`, read
`app/src-tauri/target/hand-over/notarization.json`.

**Then act.** Recreating the profile needs the notary password typed by the
account holder:

```bash
xcrun notarytool store-credentials "<profile value>"
```

---

## Symptom: tests fail after the project folder was moved

The core tests look for the gallery through a path compiled into the test binary
(`core/src/content.rs:54`), and a stale binary keeps the old one.

**Verify first.**

```bash
cd core && cargo test 2>&1 | grep -i "gallery\|No such file" | head
```

A path naming the old location means this entry applies. Other failures are real.

**Then act.**

```bash
cd core && cargo clean && cargo test
```

---

## Symptom: the self-test on a headless Mac hangs, or ends with "no report after 7 minutes"

With no display awake, WebKit pauses animation frames and the test waits forever.

**Verify first.** Check whether the app runs there and which report exists.

```bash
ssh <test-mac> 'pgrep -x html-lab; ls -la ~/Library/Logs/<bundle-id>/'
```

The app running with no fresh report means a stall. No app running means it did
not start: read `errors.log` in that folder.

**Then act.** Wake the display, then run again.

```bash
ssh <test-mac> 'nohup caffeinate -u -t 900 >/dev/null 2>&1 &'
```

`<bundle-id>` is `identifier` in `src-tauri/tauri.conf.json`.

---

## Symptom: a test run says NOT PASSED with fewer tests than the minimum

`MIN_TESTS` in `ui/self-test.js` or `MIN_STEPS` in `ui/smoke-test.js` is higher
than what ran, so a test stopped being registered.

**Verify first.**

```bash
grep -c "await t('" ui/self-test.js
grep -c "await step(" ui/smoke-test.js
```

A count that matches the pin means tests did not run, for example because an
early failure stopped the run. Read the first error in the printed report. A lower
count means a test was removed.

**Then act.** Restore the test. Lower a pin only for a deliberate removal.

---

## Symptom: a button does nothing in the finished app

**Verify first.**

```bash
tail -50 ~/Library/Logs/<bundle-id>/errors.log
```

Script errors land there in every mode, up to 256 KB. An empty log means no
script error: try the smoke test, whose real clicks catch a covered button.

**Then act.** Fix the code, rebuild, and run the self-test and smoke test on both
test Macs.

---

## Symptom: a template fails to pack

**Verify first.**

```bash
python3 scripts/check-template.py core/content/templates/<id>
```

`FAIL` lines name the problem. `cwebp is missing` means the Homebrew `webp`
package is absent.

**Then act.** Fix the template and run `python3 scripts/build-templates.py`.
`--draft` packs failing templates and `--only=<id>,<id>` packs some, for trying
things only.

---

## Scheduled jobs and remote deployment

None found; searched: `ls scripts`, and `grep -rn "launchd\|cron\|git push" scripts`.
