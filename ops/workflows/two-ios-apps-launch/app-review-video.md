# Fundhub Portal — App Review device recording

## Apple's current request

App Review rejected iOS 1.0 build 2 under Guideline 2.1, Information Needed. The rejection asks for a screen recording **captured on a physical device running the latest OS**, starting with launching the app and showing a typical user flow. Include registration, login, account deletion, user-content report/block, and paid access **where those features exist**. Apple also asks that the submitted build be tested on supported physical devices. The iOS version page has a file attachment field. Source: the live rejection text relayed by the release session on 2026-10-17; no video has been attached by this workflow.

## Evidence found

- `docs/journeys/fundhub-ios-intended.md` defines the client flow: email-link sign-in, native Home and file status, **Open full portal**, then documents/payments/messages and sign-out. The submitted reviewer notes offer the faster test-client password path: first screen → **Fundhub team? Use your password** → test-client sign-in → native Home → **Open full portal**.
- Native source `tools/fundhub-ios/Fundhub/App/FundhubApp.swift` has that password toggle and **Open full portal**. The web client portal at `public/app/client-portal.html` has Payments, Documents, and Messages tabs, and conditionally shows paid entitlements. No in-app account-registration, account-deletion, or user-report/block control was found in these native/client-portal entry points; do not stage or claim those flows. A broader product policy decision is outside this recording task.
- Repository video-file search found only funnel/marketing/welcome videos, not a Fundhub app walkthrough. `ops/workflows/build-evidence/fundhub-ios/sign-in-iphone17.png` is a screenshot, not physical-device video.
- The only local `/private/tmp` Fundhub `.ipa` found is `/private/tmp/fundhub-ios-b3.kvit8w/Export/Fundhub.ipa` (build 3 work area). It is **not proof of submitted build 2**. No build-2 `.ipa` or app-review recording was found in the searched repo and `/private/tmp` paths.
- The release session's physical-device checks found no iPhone on USB; `devicectl` timed out while CoreDeviceService initialized. This workflow did not claim device access, OS version, installation of build 2, or a recorded/tested flow.

## Fastest valid path once the iPhone is available

1. Confirm the physical iPhone's iOS version is current and **Fundhub Portal build 1.0 (2)** is installed. If the phone only has build 3/development build, do not label its video as build-2 proof. Use the exact review build via an available Apple test/install path, or submit a replacement build and record that same build.
2. Use iPhone **Control Center → Screen Recording** (or connect to Mac and use **QuickTime Player → File → New Movie Recording → Camera: iPhone**). Start on the Home Screen, tap the Fundhub icon, and keep one continuous take. Apple's recording instructions: [iPhone screen recording](https://support.apple.com/guide/iphone/take-a-screen-recording-iph52f6e1987/ios), [QuickTime connected-device capture](https://support.apple.com/en-mide/guide/quicktime-player/qtp356b55534/mac).
3. Use only the Fundhub test client account. Show first launch, password-path login, real native Home/file status, **Open full portal**, one normal client action in Payments/Documents/Messages, any test-account paid entitlement that actually exists, and sign-out. Keep real customer names, files, balances, and notifications off-screen. Do not display or narrate the test password.
4. Review the saved video end to end, copy it to the Mac if needed, attach it to the rejected iOS version's App Review response, and state device model, iOS version, build number, reviewer login route, and which conditional flows the app does **not** offer. Do not resubmit until the attachment is visibly saved. This workflow has not done those steps.

## 2026-10-18 capture

- Verified physical iPhone 17 Pro Max, iOS 27.0.1, with submitted `ai.fundhub.app` version 1.0 (2) installed.
- Recorded an 83-second continuous Mac capture of its live Device Hub mirror from Home Screen launch through test-client login, native Home, full client portal, and sign-out. The exact review copy is `credentials/apple-review/fundhub-app-review-iphone17promax-ios27-build2-review.mp4` (H.264, 690 × 1388, no audio). This is a physical-device mirror recording, not a simulator or a native iPhone screen-recording file.
- A temporary chat sign-in link appeared during the portal segment. The review copy blacks out that region from 33–54 seconds. Contact-sheet inspection showed the link is covered. The unredacted source must not be attached to Apple.
- The test account showed no documents, balance due, or paid entitlement, so the recording cannot prove a populated payments/documents or paid-content flow. Do not claim those were demonstrated.

## Gate

**ATTACHED AND RESUBMITTED:** Apple's review attachment `72840569-6961-47b5-8ed8-f7c3b065dfde` reached `COMPLETE`. The version's App Review Notes contain `app-review-final-notes.txt` and were read back unchanged. Submission `042bc18d-51c5-48b6-933a-c7223f7f0721` and iOS 1.0 are both `WAITING_FOR_REVIEW` after API resubmission. The separate App Review message thread was not sent because browser sign-in did not complete. Do not claim Apple approval or public release.
