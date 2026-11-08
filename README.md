# HTML Lab: a free app where children aged 8 to 10 learn HTML and CSS

Type code on the left and see the real page on the right, as you type. HTML Lab is free to use.

**Requirements:** macOS 12 or later (Intel and Apple Silicon), Windows 10 or 11 (64-bit), or Linux with glibc 2.35 or later (Ubuntu 22.04 and newer). No internet connection and no account are needed.

## What it does

A child opens or creates `.html` and `.css` files, edits them in tabs, and watches the page change in the preview next to the code. The words in the app are short and simple, and the look is calm.

- **Help that teaches.** Lessons and "I want to..." recipes, with examples to open and change.
- **Things to start from.** Blank projects, with the style inside the page or in its own file, sample projects, and a gallery of finished multi-page websites to look inside and change.
- **Work is not lost.** Files are saved through a temporary file, a first save never merges into a folder that already exists, and closing unsaved work asks first.
- **Safe to experiment.** Scripts do not run in the preview. The app teaches HTML and CSS only, and links to outside sites open in your web browser.

The app is in English only.

## Downloads

Every download is signed. The Mac app is signed with an Apple Developer ID and notarized by Apple. The Windows program and installer are signed by Cyborvent Oy through Microsoft's Artifact Signing. Linux packages come with `SHA256SUMS`, its GPG signature `SHA256SUMS.asc` and the Cyborvent Oy release signing key. Check a Linux download with:

```bash
gpg --import cyborvent-release-signing-public-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS
```

The templates are written for Mac fonts. On Windows and Linux the preview swaps in free look-alike fonts, listed in `app/core/content/fonts/LICENSES.md`.

## Start here

| I want to... | Read |
|---|---|
| know how work is done here | [CONTRIBUTING.md](CONTRIBUTING.md) |
| pick this project up and continue it | [HANDOVER.md](HANDOVER.md) |
| know the rules that must not be broken | [docs/INVARIANTS.md](docs/INVARIANTS.md) |
| see what is known to be wrong | [docs/BACKLOG.md](docs/BACKLOG.md) |
| build, release or diagnose | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| find any other document | [docs/INDEX.md](docs/INDEX.md) |

## Building it

You need Xcode's command line tools, Rust and Node.js. There is no toolchain pin file; the versions last used were Rust 1.99.0 and Node 24. JavaScript dependencies are pinned in `app/package-lock.json`, Rust ones in `app/src-tauri/Cargo.lock` and `app/core/Cargo.lock`.

Run everything inside `app/`:

```bash
npm ci
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npx esbuild ui-src/editor.js --bundle --minify --format=esm --target=safari15 --outfile=ui/editor.bundle.js
npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js
npx @tauri-apps/cli@2 build --target universal-apple-darwin --bundles app --no-sign
```

The app lands in `app/src-tauri/target/universal-apple-darwin/release/bundle/macos/`. It is unsigned, so it is for your own Mac.

To make a signed and notarized build you supply a Developer ID certificate and a `notarytool` keychain profile. Copy `app/scripts/local.example.json` to `app/scripts/local.json` and fill it in. Then run `zsh scripts/sign-notarize.sh`.

Changing the template gallery also needs `cwebp` and `swiftc`; see `scripts/build-templates.py`.

## Tests

The Rust core is tested inside `app/core`, in debug only:

```bash
cargo test
```

The full set of checks, including the ones that run a built app on test Macs, is in [CONTRIBUTING.md](CONTRIBUTING.md).

## How the pieces fit

```
ui/  ui-src/       screens and the CodeMirror 6 editor, a thin view layer
     |  Tauri 2 bridge
src-tauri/         window, menus, native dialogs, the preview's URL scheme
     |
core/              pure Rust, no Tauri: file kinds, names, folder scan,
                   saving, preferences, Help, samples, templates
```

The preview is drawn by macOS's own WebKit. Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and `app/docs/CONTRACTS.md`.

## Status

Early and in use, in the 0.1 series. The version is in `app/src-tauri/tauri.conf.json`. Some speed targets on a 2016 Intel MacBook Pro are not met yet; [docs/BACKLOG.md](docs/BACKLOG.md) has the list.

## Licence

The code is under the MIT licence, see [LICENSE](LICENSE). The MIT licence covers the code only. These parts keep their own terms:

| Part | Where | Terms |
|---|---|---|
| Photos and paintings | `app/core/content/pictures/`, `app/core/content/gallery/`, `app/core/content/templates/` | Public domain or CC0, each listed with author and source in the `SOURCES.md` files under `app/core/content/` |
| Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono fonts | `app/ui/fonts/` | SIL Open Font License 1.1, see `app/ui/fonts/OFL.txt` |
| Phosphor icons, drawn into `app/ui/icons.js` | from `@phosphor-icons/core` | MIT |
| CodeMirror 6, Lezer, the CodeMirror CSS colour picker, morphdom | bundled into `app/ui/editor.bundle.js` and `app/src-tauri/helper.min.js` | MIT |
| Tauri and its plugins, and other Rust crates | linked into the app | MIT or Apache-2.0 for Tauri and its plugins; each crate's own licence applies |

## Authors

Mikael Denut + Claude AI
