# Fundhub Prompter iOS — actual flow (2026-10-18)

The native app entry view is `tools/teleprompter-ios/FundhubPrompter/App/FundhubPrompterApp.swift`. It no longer opens `ScriptListView`, the separate bundled practice shoot, or a staff-login screen. It opens `LivePrompterView`.

The app opens `https://fundhub.ai/app/teleprompter.html` directly in `WKWebView`, with no link-entry screen. The page's existing open `GET marketing/shoot` reads the current real shoot for the default company. Its open mark and take routes allow filming without a login. Script edits and version reconciliation still require staff or signed-film access; no anonymous edit privilege was added. The web page, not native Swift code, owns script display, camera/recording controls, marks, local take queue, and upload. Camera/microphone capture is granted only to the `https://fundhub.ai` origin; web downloads go to the app's Files-visible `Takes` folder.

This is a code-path description, not a filming PASS. Build 4 with the direct-open flow is installed on the physical iPhone 17 Pro Max, but the phone locked before a foreground app check. Real-phone preview and original-file checks remain open. See `ops/workflows/teleprompter-correct-live-proof.md` for the remaining video acceptance proof.
