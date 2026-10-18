# Fundhub Prompter for iPhone and iPad

The Apple app runs the **same live teleprompter** as `public/app/teleprompter.html` and `public/app/teleprompter.js` at `https://fundhub.ai/app/teleprompter.html`. It does not show the old bundled practice scripts or ask for a staff login.

## Open a Shoot

1. In Fundhub Command Center, open **Shoot Day** and save the shoot plan.
2. Copy **Open the teleprompter**'s link. It has `/app/teleprompter.html?k=...` in it.
3. In the Apple app, tap **Paste link**. The app remembers this Shoot link on this phone. For a later shoot, tap the small link icon at the top right and paste its new link.

The key belongs to one shoot and authorizes that shoot's scripts, edits, marks, and video upload. The app keeps it in the iPhone Keychain, not in its source code or a staff session. The native app adds a thin camera-permission and file-download shell; the teleprompter layout and filming behavior come from the live website.

## Build and test

Open `FundhubPrompter.xcodeproj` in Xcode, select the `FundhubPrompter` scheme, and run it on the iPhone. Camera and microphone permissions are required for filming. If web sharing is unavailable, downloaded takes are stored in the app's **Takes** folder, visible in Files under **On My iPhone → Fundhub Prompter**.

Run the simulator tests:

```bash
xcodebuild -project FundhubPrompter.xcodeproj -scheme FundhubPrompter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' test
```

The simulator cannot prove real camera preview or video quality. Follow `docs/rules/TELEPROMPTER-VIDEO.md` on a physical iPhone and inspect the original saved file before calling the app ready to film.
