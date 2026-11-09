---
class:   truth
updated: 2026-11-09
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
| Build the editor bundle | `rm -rf ui/editor && npx esbuild ui-src/editor.js --bundle --minify --splitting --format=esm --target=safari15 --outdir=ui --entry-names=editor.bundle '--chunk-names=editor/[name]-[hash]' --log-level=warning` |
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
| Signed test build from any tree | `HTMLLAB_TEST_BUILD=1 zsh scripts/sign-notarize.sh` |

`cargo test` in `core` runs 315 tests (0.3.0, last run 2026-11-09, all passed).
`cargo test` in `src-tauri` is a separate run: 24 unit tests, plus 3 in
`src-tauri/tests/open_with.rs`, which check that the Open With endings agree in the
macOS and Linux configs, the Windows installer hooks and this project's README.
`cargo test` from `src-tauri` does not run the core tests.

The editor bundle is built in parts. `ui/editor.bundle.js` is the entry that
`ui/app.js` imports; the chunks it loads at start and the language chunks it loads
when a file needs them are in `ui/editor/`, named `<name>-<hash>.js`. The
`rm -rf ui/editor` at the start of the command makes a chunk that is no longer built
show up as a deletion; commit the additions and deletions together. The quotes around
`'--chunk-names=editor/[name]-[hash]'` are needed: the scripts run in zsh, where an
unquoted `[ ]` is a pattern.

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
rm -rf ui/editor && npx esbuild ui-src/editor.js --bundle --minify --splitting --format=esm --target=safari15 --outdir=ui --entry-names=editor.bundle '--chunk-names=editor/[name]-[hash]' --log-level=warning
npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js --log-level=warning
git status --porcelain -- .
```

Both bundles, and the chunks in `ui/editor/`, are in git. If the second status lists a bundle or a chunk, commit it. Empty
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

The profile has not vanished, even when `notarytool` says "No Keychain password
item found for profile" (seen at night on 2026-10-30 and 2026-11-09). `notarytool`
keeps it in the data-protection keychain, which can only be read while the Mac is
unlocked; with the screen locked or the display asleep it fails, and once the Mac is
unlocked it works again with nothing done. `sign-notarize.sh` checks it before
building. So unlock the Mac and run again before asking the owner to store it.

**Fallback for test builds only.** When notarization fails, or there is no network,
try once more after 10 minutes. If it still fails, make an ad hoc signed test build
of a clean committed tree, and test that:

```bash
npx @tauri-apps/cli@2 build --target aarch64-apple-darwin --bundles app --no-sign
APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/HTML Lab.app"
/usr/libexec/PlistBuddy -c "Add :HTMLLabRevision string $(git rev-parse --short=12 HEAD)" "$APP/Contents/Info.plist"
codesign --force --deep -s - "$APP"
python3 scripts/selftest-run.py "$APP" --host mini
```

The reports carry the revision as usual. This build is arm64 only and not
notarized: it never leaves the test Macs and is never a release.

---

## Linux and Windows test runs (unsigned)

These run by hand, from the maintainer's Mac. The host address, the VM id and the
helper scripts are not in git: the scripts live on the Linux host and in
`release/tools/` (ignored on purpose). Never run the signing steps for a test run.

**Linux (Ubuntu 22.04 build host).** Use the live scripts in `/root/` on the host,
not the older copies in `release/tools/`. From the html-lab folder:

```bash
COPYFILE_DISABLE=1 tar --no-xattrs -czf <scratch>/hl.tgz --exclude target --exclude node_modules --exclude test-history --exclude speed-history --exclude __pycache__ --exclude .DS_Store --exclude '._*' --exclude local.json app
scp <scratch>/hl.tgz root@<linux-host>:/root/hl.tgz
ssh root@<linux-host> "sed -i 's/HTML Lab_[0-9.]*_amd64.deb/HTML Lab_<version>_amd64.deb/' /root/hl_jammy_test.sh"
perl -e 'alarm 7200; exec @ARGV' ssh root@<linux-host> 'bash /root/hl_jammy_build.sh'
perl -e 'alarm 7200; exec @ARGV' ssh root@<linux-host> 'bash /root/hl_jammy_test.sh'
```

The `sed` puts this version's `.deb` name into the test script. The scripts already
run at `nice -n -10`; add no `nice` of your own. They touch only
`/home/builder/htmllab-worker` and `/root/hl*`. Core tests that check read-only
permissions fail as root (root ignores file permissions): before calling a failure a
regression, run the same scripts on the previous version and compare the failing
names.

**Windows (UTM VM on the maintainer's Mac).** Run `utmctl list` first. If the VM is
already started, someone else is using it: do not start or stop it. If it is
stopped, `utmctl start <vm id>`. If that fails with OSStatus -1712 (seen on
2026-11-09), end the UTM process (the VM is stopped, so nothing is lost), open the
VM bundle with `open -a UTM <vm bundle>`, wait 15 s, then start it through AppleScript:
`osascript -e 'with timeout of 120 seconds' -e 'tell application "UTM" to start virtual machine "<vm name>"' -e 'end timeout'`.
`utmctl list` then shows it started. When it is up, wait
for SSH, then copy `release/tools/win020.sh` to a scratch file, set `S` (a scratch
folder holding copies of `release/tools/w*.ps1`) and `V` (the version), and run only
its build and test part (`w4`, `w5`, `w12`), never the `sign()` lines, under
`perl -e 'alarm 9000; exec @ARGV'`. Run `utmctl stop` only if you started the VM;
never suspend it.

**Reading the result, on both.** Read the `test result:` line of each `cargo test`.
A `FAILED`, `panicked` or `error`, or a passed count that differs from the Mac count
by more than the tests gated by `cfg` (name them), is a failure. Compare the
self-test and smoke totals with `MIN_TESTS` and `MIN_STEPS`. The Windows self-test
can time out under host load (BACKLOG V5): run it again once. A host that does not
answer is skipped and named in the handback.

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
