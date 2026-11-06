#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${FUNDHUB_MAC_OUTPUT:-$HERE/.build}"
APP="$OUTPUT/Fundhub.app"
# Reuse a real existing identity/profile. No ad-hoc fallback and no automatic
# certificate creation: associated domains need the legitimate signed team.
: "${FUNDHUB_MAC_PROVISIONING_PROFILE:?Set the existing signed Mac development profile name}"
SIGNING_IDENTITY="${FUNDHUB_MAC_SIGNING_IDENTITY:-Apple Development}"
if [[ -e "$APP" ]]; then
  echo "Build already exists at $APP. Choose a new FUNDHUB_MAC_OUTPUT." >&2
  exit 2
fi
mkdir -p "$OUTPUT"
DERIVED="$OUTPUT/DerivedData"
xcodebuild -project "$HERE/FundhubMac.xcodeproj" -scheme FundhubMac \
  -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DERIVED" CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
  PROVISIONING_PROFILE_SPECIFIER="$FUNDHUB_MAC_PROVISIONING_PROFILE" build
BUILT="$DERIVED/Build/Products/Release/Fundhub.app"
codesign --verify --deep --strict "$BUILT"
python3 - "$BUILT" <<'VERIFY'
import pathlib, plistlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
signature = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)], capture_output=True, text=True)
if 'TeamIdentifier=8VDXL37RR6' not in signature.stderr or 'Signature=adhoc' in signature.stderr:
    raise SystemExit('Fundhub needs its real team signature; this build is not usable for passkeys.')
entitlements = plistlib.loads(subprocess.check_output(['codesign', '-d', '--entitlements', '-', '--xml', str(app)], stderr=subprocess.DEVNULL))
if 'webcredentials:fundhub.ai' not in entitlements.get('com.apple.developer.associated-domains', []):
    raise SystemExit('Signed Fundhub is missing its webcredentials association.')
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
if info.get('CFBundleIdentifier') != 'ai.fundhub.mac':
    raise SystemExit('Unexpected Fundhub Mac bundle identity.')
VERIFY
ditto "$BUILT" "$APP"
echo "$APP"
