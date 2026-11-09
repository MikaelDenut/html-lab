---
class:   truth
updated: 2026-11-09
status:  current
---

# HTML Lab

A Tauri 2, Rust and CodeMirror 6 Mac app for children aged 8 to 10. Everything runs inside `app/`.

## Commands

```bash
npx @tauri-apps/cli@2 build --target universal-apple-darwin --bundles app --no-sign
cd core && cargo test    # debug only, never --release
```

The other gates are listed in [CONTRIBUTING.md](CONTRIBUTING.md). Run them all before claiming anything is done.

## What not to get wrong

1. **Releasing is never automatic.** `scripts/sign-notarize.sh` runs on the maintainer's word only.
2. **The bundles are committed.** After editing `ui-src/`, rebuild `ui/editor.bundle.js` with its chunks in `ui/editor/`, and `src-tauri/helper.min.js` (commands in [README.md](README.md)). Commit the added and deleted chunks together.
3. **Version is three files.** `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json` must match, and go up one for every build that leaves the build folder.
4. **Scripts stay blocked in the preview.** `SCRIPT_POLICY` in `core/src/kinds.rs`. A runaway script would freeze the editor.
5. **Check on the old engine.** Newer CSS can work here and fail on macOS 12's WebKit. Templates must pass `scripts/check-template.py`.
6. **Run npm only when `npm prefix` prints the `app` folder.**
7. **The app is English only**, in short sentences a child can read.

## Everything else

[CONTRIBUTING.md](CONTRIBUTING.md) for how work is done, [HANDOVER.md](HANDOVER.md) for where it stands, [docs/INVARIANTS.md](docs/INVARIANTS.md) before changing it.
