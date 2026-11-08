#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
local_value() { /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' scripts/local.json "$1"; }
IDENTITY="$(local_value identity)"
PROFILE="$(local_value profile)"
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/HTML Lab.app"
OUT="src-tauri/target/hand-over"

security find-identity -v -p codesigning | grep -q "$IDENTITY" || { echo "signing identity missing"; exit 1; }

npx esbuild ui-src/editor.js --bundle --minify --format=esm --target=safari15 --outfile=ui/editor.bundle.js --log-level=warning
npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js --log-level=warning

REV="$(git rev-parse --short=12 HEAD)"
CHANGED="$(git status --porcelain -- .)"
if [[ -n "$CHANGED" ]]; then
  if [[ "${HTMLLAB_TEST_BUILD:-}" != "1" ]]; then
    echo "release build refused: the app folder has uncommitted changes:"
    echo "$CHANGED" | head -20
    echo "commit them first, or set HTMLLAB_TEST_BUILD=1 for a test build"
    exit 1
  fi
  REV="$REV-dirty"
fi
VERSION="$(/usr/bin/python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')"
NPM_VERSION="$(/usr/bin/python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
CARGO_VERSION="$(sed -n 's/^version *= *"\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
if [[ "$VERSION" != "$NPM_VERSION" || "$VERSION" != "$CARGO_VERSION" ]]; then
  echo "versions differ: tauri.conf.json $VERSION, package.json $NPM_VERSION, src-tauri/Cargo.toml $CARGO_VERSION"
  exit 1
fi
echo "building $VERSION at $REV"

npx @tauri-apps/cli@2 build --target universal-apple-darwin --bundles app --no-sign

/usr/libexec/PlistBuddy -c "Add :HTMLLabRevision string $REV" "$APP/Contents/Info.plist"

codesign --force --sign "$IDENTITY" --timestamp --options runtime "$APP"
codesign --verify --strict --verbose=2 "$APP"

rm -rf "$OUT"
mkdir -p "$OUT"
ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
xcrun notarytool submit "$OUT/notarize.zip" --keychain-profile "$PROFILE" --wait --output-format json > "$OUT/notarization.json"
grep -q '"status" *: *"Accepted"' "$OUT/notarization.json" || { echo "notarization not accepted, see $OUT/notarization.json"; exit 1; }
rm "$OUT/notarize.zip"

xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute -vv "$APP"

ditto -c -k --keepParent "$APP" "$OUT/HTML Lab.zip"
/usr/bin/python3 -c 'import json, sys; json.dump({"version": sys.argv[1], "revision": sys.argv[2], "zipSha256": sys.argv[3]}, open(sys.argv[4], "w"), indent=2)' \
  "$VERSION" "$REV" "$(shasum -a 256 "$OUT/HTML Lab.zip" | cut -d' ' -f1)" "$OUT/build.json"
echo "ready: $OUT/HTML Lab.zip ($VERSION at $REV)"
