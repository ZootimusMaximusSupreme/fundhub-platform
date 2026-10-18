# Fundhub Prompter iOS — actual flow (2026-10-18)

The native app entry view is `tools/teleprompter-ios/FundhubPrompter/App/FundhubPrompterApp.swift`. It no longer opens `ScriptListView`, the separate bundled practice shoot, or a staff-login screen. It opens `LivePrompterView`.

On a first launch, the user pastes the existing `/app/teleprompter.html?k=...` film link from the saved Command Center Shoot Day plan. The app accepts only HTTPS `fundhub.ai` teleprompter links with a shaped shoot key. It saves the link in this device's Keychain and loads that exact live page in `WKWebView`. On later launches it reopens the saved link. The small link button returns to entry for a different shoot. The web page, not native Swift code, owns script display, camera/recording controls, marks, edits, local take queue, and upload. Camera/microphone capture is granted only to the `https://fundhub.ai` origin; web downloads go to the app's Files-visible `Takes` folder.

This is a code-path description, not a live-device PASS. The physical iPhone was offline during this check. The live web asset and simulator tests passed, but no current iPhone preview or original video file has been inspected. See `ops/workflows/teleprompter-correct-live-proof.md` for the remaining video acceptance proof.
