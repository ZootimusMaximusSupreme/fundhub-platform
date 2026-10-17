# Fundhub first screen: physical iPhone check

Checked 2026-10-17 on the paired physical iPhone 17 Pro Max, UDID `00008150-0015185C0212401C`.

## What was observed

- `xcrun devicectl list devices` reports this iPhone as `available (paired)`. Its primary display is portrait, 1320 × 2868 pixels at 3× scale.
- `xcrun devicectl device info apps --device 00008150-0015185C0212401C` lists `Fundhub` (`ai.fundhub.app`, version 1.0, build 1) and `Fundhub Prompter` (`ai.fundhub.prompter`, version 1.0, build 1).
- `xcrun devicectl device process launch --device 00008150-0015185C0212401C ai.fundhub.app` returned success. The next device screenshot showed another foreground app while the owner was using the phone. The Fundhub first screen therefore **was not visually verified on this physical device**. That temporary capture was deleted; no private screen content was kept.
- The existing logged-out **simulator** image, `ops/workflows/build-evidence/fundhub-ios/sign-in-iphone17.png`, shows a plain pale-gray form headed “Your Fundhub app,” with a black `f.` icon, team email/password fields first, then a client email-link area. This is useful design reference, but is not real-device proof.

## Repeatable real-device check after the redesign

The project has automatic signing configured for team `8VDXL37RR6` and bundle ID `ai.fundhub.app`. With the phone available, build and install the revised app:

```sh
xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Debug -destination 'platform=iOS,id=00008150-0015185C0212401C' -derivedDataPath /tmp/fundhub-ios-device-build build
xcrun devicectl device install app --device 00008150-0015185C0212401C /tmp/fundhub-ios-device-build/Build/Products/Debug-iphoneos/Fundhub.app
xcrun devicectl device process launch --device 00008150-0015185C0212401C ai.fundhub.app
```

Have the owner bring Fundhub to the foreground and leave it on the signed-out first screen, then capture and inspect the screen:

```sh
xcrun devicectl device capture screenshot --device 00008150-0015185C0212401C --destination /tmp/fundhub-first-page-phone-after.png
```

Confirm the captured image actually shows Fundhub before using it as evidence. Compare layout, readable text, safe areas, keyboard behavior, staff password sign-in, and client email-link entry with the approved design. Do not claim signed-in client/staff or Face ID proof from a signed-out screenshot.
