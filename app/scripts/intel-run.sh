#!/bin/zsh
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$APP_DIR/scripts/local.json" intel)"
SSH=(ssh -4 -o BatchMode=yes -o ConnectTimeout=8 -o LogLevel=ERROR "$HOST")
FLAG="${1:---self-test}"
TARGET="$APP_DIR/src-tauri/target/x86_64-apple-darwin/quick"
BUNDLE="$TARGET/HTML Lab Test.app"

if [[ "$2" != "--no-build" ]]; then
  (cd "$APP_DIR" && npx esbuild ui-src/editor.js --bundle --minify --format=esm --target=safari15 --outfile=ui/editor.bundle.js --log-level=warning)
  (cd "$APP_DIR" && npx esbuild ui-src/helper.js --bundle --minify --format=iife --target=safari15 --outfile=src-tauri/helper.min.js --log-level=warning)
  (cd "$APP_DIR/src-tauri" && cargo build --profile quick --target x86_64-apple-darwin --features tauri/custom-protocol 2>&1 | grep -E '^error|^warning: unused|could not compile|Finished' | cut -c1-160)
fi

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$TARGET/html-lab" "$BUNDLE/Contents/MacOS/html-lab"
cp "$APP_DIR/src-tauri/icons/icon.icns" "$BUNDLE/Contents/Resources/icon.icns"
cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>html-lab</string>
<key>CFBundleIdentifier</key><string>fi.cyborvent.htmllab</string>
<key>CFBundleName</key><string>HTML Lab</string>
<key>CFBundleIconFile</key><string>icon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force -s - "$BUNDLE" 2>/dev/null

"${SSH[@]}" 'rm -rf "/tmp/HTML Lab Test.app"; rm -f ~/Library/Logs/fi.cyborvent.htmllab/selftest-latest.json ~/Library/Logs/fi.cyborvent.htmllab/speed-latest.json'
tar -C "$TARGET" -cf - "HTML Lab Test.app" | "${SSH[@]}" 'tar -C /tmp -xf -'
"${SSH[@]}" "xattr -cr '/tmp/HTML Lab Test.app'; open -n '/tmp/HTML Lab Test.app' --args $FLAG"
echo "started on the Intel Mac with $FLAG"
