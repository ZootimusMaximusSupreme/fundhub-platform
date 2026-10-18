# Fundhub Prompter App Store track — local evidence, 2026-10-16

Scope: `tools/teleprompter-ios/`, `docs/journeys/fundhub-prompter-appstore-intended.md`, and this folder. No App Store Connect access or submission occurred. The existing TestFlight build 1 was not changed or replaced.

## What was found and fixed for build 2

| Finding | Evidence | Result |
| --- | --- | --- |
| Opening a script in the old simulator build ended the app with `Fatal error: Range requires lowerBound <= upperBound`. | `ScrollTrack.readingPace` formed `1..<keys.count` while the view's first track had no keys. The crash appeared on iPhone and iPad when the sample script opened. | Guarded zero/one-key tracks, added `testEmptyScrollTrackDoesNotCrashBeforeWordsAreLaidOut`, and opened the sample prompter on both simulators after rebuilding. Build 1 still contains the old code; it must not be selected for public review. |
| Settings offered 4K while `CameraController` requested 1080p. | `CameraController.swift` and `SettingsView.swift`. | Removed the misleading picker and corrected the native README. No 4K claim is made in the listing draft. |
| No privacy link was present in the app. | Sign-in and Settings views. | Added the live `https://fundhub.ai/privacy/` link to both views. The sign-in capture shows the link; the website opened in a separate read-only check. |

## Checks run

- Xcode 27.1; `xcodebuild ... test` on iPhone 18 Pro Max simulator, iOS 27.0: **56 passed, 0 failed, 0 skipped** after the final code edits. The earlier baseline had 55 passing unit tests while the UI still crashed on opening a script.
- Unsigned Release build for generic iOS: **passed**. Built Info.plist reports `ai.fundhub.prompter`, version `1.0`, build `2`, and Camera/Microphone/Photos add purpose strings.
- The existing 1024×1024 app icon was checked and has no alpha channel.
- Sample prompter opened and stayed visible on iPhone 17 and iPad Pro 13-inch simulators. Screenshots below were visually checked. Simulators cannot prove filming, microphone sound, Photos saving, or actual saved frame rate.
- The physical iPhone 17 Pro Max was `unavailable` in `xcrun devicectl list devices`. No phone install or recording test ran. No signed build or upload was made.
- No JavaScript or TypeScript files changed; repository lint, TypeScript, and Playwright checks do not exercise this native app.

## Screenshot assets

Real, unmodified screens from the build 2 simulator app, using the repository's synthetic sample shoot. The iPhone files are 1206×2622; the 13-inch iPad files are 2064×2752. JPEG removes the simulator PNG alpha channel. Each file was checked for `hasAlpha: no`. Apple accepts these dimensions and requires at least one iPhone and one 13-inch iPad screenshot for this target.

Recommended upload order for each device: [prompter](screenshots/iphone-02-prompter.jpg), [settings](screenshots/iphone-03-settings.jpg), [sign-in](screenshots/iphone-01-sign-in.jpg); for iPad: [prompter](screenshots/ipad-02-prompter.jpg), [settings](screenshots/ipad-03-settings.jpg), [sign-in](screenshots/ipad-01-sign-in.jpg). These are **draft listing assets**: the simulator cannot show a real camera or Record control, so a real-device capture would better represent filming before public submission. Do not label these as camera proof.

## Remaining App Store readiness gaps

1. The app is staff-only after download. Public users without a Fundhub staff account cannot use the prompter. The listing draft says this plainly. If the intended public app is for any customer to use, that requires a separate product build before submission.
2. Create and test a dedicated, non-expiring App Review staff login with approved sample scripts. The existing `-FundhubDemo` mode is a local launch argument and is not available to App Review in the uploaded build. Put review credentials only in App Store Connect.
3. Confirm the public privacy policy covers this app's staff identity, script edits, local recordings, retention, and deletion. The current URL is live, but its text is a general Fundhub site/services policy. Complete App Privacy answers from the app plus server data handling.
4. Run build 2 on a real iPhone: sign in, open script, check camera/mic, record, stop, verify Photos original and its actual size/frame rate, test a script edit/sync. Simulator/unit results cannot close this proof.
5. App Store Connect state is unknown under the saved access restriction. A human must upload a signed build **1.0 (2)**, select that build, enter the [listing draft](../../../../tools/teleprompter-ios/AppStore/listing-en-US.md), upload the correct screenshots, fill review contact/login, privacy, age rating, encryption/export answers, price, public distribution, regions, and release choice, then submit for App Review. Do not select build 1. Verify approval and the public listing before sharing a store link.

Apple references: [required screenshots and dimensions](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [version and review fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy), [public distribution](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/set-distribution-methods/).
