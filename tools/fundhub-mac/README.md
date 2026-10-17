# Fundhub for Mac

Native macOS window for the existing Fundhub website. Team and client sign-in use the live pages, not a second auth system. WebKit keeps the site's normal session in its persistent website data store; this app does not store a password.

Build on an Apple Silicon Mac with Xcode:

```sh
bash tools/fundhub-mac/build.sh
```

The bundle appears at `tools/fundhub-mac/.build/Fundhub.app`. Copy that bundle into Applications, then open it. The app icon is generated from the iOS company icon during build. This local bundle uses an ad-hoc signature; it is not a notarized public Mac release.

## Intended journey

1. Launch Fundhub and choose Team sign-in or Client sign-in.
2. The matching live `fundhub.ai` page opens in the app. The site handles sign-in and role-based routing.
3. Fundhub links stay in the window. Other sites and email links open in the default Mac app.
4. Reload, Back, and Home are always available. A failed page load shows Try again.
5. Quit and reopen: normal WebKit website data persists unless the site expires or revokes the session.

No Apple App Store or signed-in account proof follows from this local build.
