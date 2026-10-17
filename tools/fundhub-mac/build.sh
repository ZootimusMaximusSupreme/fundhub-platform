#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$HERE/.build"
APP="$OUTPUT/Fundhub.app"
ICON_SOURCE="$HERE/../fundhub-ios/Fundhub/Assets.xcassets/AppIcon.appiconset/icon-1024.png"

if [[ -e "$APP" ]]; then
  echo "Build already exists at $APP. Move it aside before building again." >&2
  exit 2
fi

mkdir -p "$OUTPUT"
STAGING="$(mktemp -d "$OUTPUT/staging.XXXXXX")"
CONTENTS="$STAGING/Fundhub.app/Contents"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp "$HERE/Info.plist" "$CONTENTS/Info.plist"

ICONSET="$STAGING/Fundhub.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 64 128 256 512 1024; do
  sips -s format png -z "$SIZE" "$SIZE" "$ICON_SOURCE" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
done
cp "$ICONSET/icon_32x32.png" "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_64x64.png" "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/Fundhub.icns"

xcrun swiftc -swift-version 5 -O -parse-as-library \
  -target arm64-apple-macosx13.0 \
  -framework AppKit -framework WebKit \
  -o "$CONTENTS/MacOS/Fundhub" "$HERE/FundhubMac.swift"
plutil -lint "$CONTENTS/Info.plist"
codesign --sign - --force --deep "$STAGING/Fundhub.app"
mv "$STAGING/Fundhub.app" "$APP"
echo "$APP"
