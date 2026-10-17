# Fundhub app onboarding — read-only discovery

Ground truth: [`docs/journeys/fundhub-ios-intended.md`](../../docs/journeys/fundhub-ios-intended.md) (Clients 1–6). This is code-path evidence, not a live-client PASS. No account was used and no sign-in link was sent.

| Step | Current path and evidence |
| --- | --- |
| First launch | With no saved Keychain session, the app shows `SignInView`; a download alone does not identify a client. `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:33-47,163-183`. |
| First client sign-in | Client enters the email on their Fundhub file and requests a one-time link. The native screen says **Email me a sign-in link**; there is no **Sign up** control. `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:276-306,353-365`. |
| Who receives a link | The server looks up an eligible client/authorized-rep account, or an existing client record with that email. An unknown email gets the same public success reply but no usable link. No open self-registration happens here. `src/auth/magic-link.mjs:342-384,147-202`; `api/auth/magic-link.mjs:46-92`. |
| Entering the app | The native app accepts a copied `https://fundhub.ai/portal-login.html?t=...` link, verifies it once, saves the returned session token in Keychain, then checks `/api/auth/session` and loads the client summary. `tools/fundhub-ios/Fundhub/Core/Models.swift:106-115`; `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:70-107`; `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift:35-50`. |
| Later launches | The app asks to unlock the saved token with Face ID/device authentication, verifies it with the server, and does not request another email link unless the saved sign-in is missing/invalid or the person signs out. `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:35-47,219-229,141-159`; `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift:91-157`. |
| Full portal | The signed-in native app passes that session to its in-app web view; it does not run a second portal registration. `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:413-429,466-467`; `tools/fundhub-ios/Fundhub/UI/WorkspaceWebView.swift:13-37`. |

## Decision

The owner is right that a separate **sign-up link** would be redundant: there is no client sign-up step in the native screen now. Keep a **first-time sign-in link** because installing the app alone cannot prove which client file belongs to the person. After the first successful sign-in, lead with **Continue with Face ID** and leave the email-link route as recovery.

## Launch-friction finding

The app currently requires **copy, don't open, then paste**. The emailed URL points at the web portal, whose JavaScript consumes its one-use token on opening; the iOS project has no associated-domains/universal-link configuration. `docs/journeys/fundhub-ios-intended.md:5-9`; `public/portal-login.html:53-68,249-255`; `tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj:72-73`. If one-tap entry is desired, that is a separate universal-link implementation and end-to-end test; do not remove authentication to simulate it.
