# Fundhub Mac install — 2026-10-17

## Builder gate (owner's launch GO already given)

1. **Role:** Staff first, with an explicit client entry for the same company app.
2. **One job:** Open the real Fundhub workspace on this Mac.
3. **First question:** “Where do I sign in?” Team sign-in is primary; Client sign-in is secondary.
4. **Reuse:** Live `https://fundhub.ai/login.html` and `https://fundhub.ai/portal-login.html`; existing iOS Fundhub icon; macOS WebKit and SwiftUI.
5. **Data:** No new data or API route. The live site owns sign-in and all account data.
6. **Files:** New files only under `tools/fundhub-mac/` plus this report.
7. **Risk / proof:** A web shell might show a blank or stale page. Compile a native Mac bundle, launch it, open both live paths, and verify an app window; do not claim a signed-in account flow without an account check.

## Starting facts

- This Mac is Apple Silicon (`arm64`), macOS 26.6.2, Xcode 27.1.
- No `/Applications/Fundhub.app` or `~/Applications/Fundhub.app` existed before this work.
- Both live sign-in URLs returned HTTP 200 on 2026-10-17.
- This lane does not submit to the App Store or change production.

## Installed result

- Built a native Apple Silicon macOS app with SwiftUI and WebKit, using the existing company icon. Bundle ID: `ai.fundhub.mac`.
- Installed at `/Applications/Fundhub.app` and opened it on this Mac.
- The welcome window shows one primary **Team sign-in** button and a secondary **Client sign-in** button.
- Team opened the live `https://fundhub.ai/login.html` page in the app with email and password fields.
- Client opened the live `https://fundhub.ai/portal-login.html` page in the app with the email-link request field.
- Home returned to the welcome view; Reload and Back were clicked and the page remained usable.
- Proof images, with no account or customer data: `tools/fundhub-mac/evidence/welcome.png`, `team-login.png`, `client-login.png`.

## Checks and limits

- `bash tools/fundhub-mac/build.sh` passed.
- `codesign --verify --deep --strict /Applications/Fundhub.app` passed.
- `npx tsc --noEmit` passed; no TypeScript file changed in this lane.
- No sign-in was submitted, so an authenticated staff/client workspace, session persistence after restart, and the load-error state remain unverified.
- This is a local ad-hoc-signed Mac install, not a notarized public Mac release.
