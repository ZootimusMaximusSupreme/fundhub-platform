# Fundhub Prompter for iPhone and iPad

The separate Apple app opens the **same live teleprompter** as `public/app/teleprompter.html` and `public/app/teleprompter.js` at `https://fundhub.ai/app/teleprompter.html`. It does not show the old bundled practice scripts, ask for a staff login, or require a copied link.

## Open a Shoot

Open **Fundhub Prompter** on the iPhone. The current saved shoot for Fundhub's default company loads directly. There is no link or login step. The native app adds a thin camera-permission and file-download shell; the teleprompter layout and filming behavior come from the live website.

The existing open-shoot routes allow reading scripts, marking takes, and uploading recordings without a staff session. Script editing and version reconciliation still require staff or signed-film access; this direct app entry does not silently grant those actions.

## Build and test

Open `FundhubPrompter.xcodeproj` in Xcode, select the `FundhubPrompter` scheme, and run it on the iPhone. Camera and microphone permissions are required for filming. If web sharing is unavailable, downloaded takes are stored in the app's **Takes** folder, visible in Files under **On My iPhone → Fundhub Prompter**.

Run the simulator tests:

```bash
xcodebuild -project FundhubPrompter.xcodeproj -scheme FundhubPrompter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' test
```

The simulator cannot prove real camera preview or video quality. Follow `docs/rules/TELEPROMPTER-VIDEO.md` on a physical iPhone and inspect the original saved file before calling the app ready to film.
