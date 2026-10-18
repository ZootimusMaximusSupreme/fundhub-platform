# Correct teleprompter in the Apple app

Owner: Chris. Session: Apple app wiring. Parallel proof: `ops/workflows/teleprompter-correct-live-proof.md`.

## Build gate

1. Job: Open the exact live Shoot Day teleprompter inside Fundhub Prompter on iPhone, without a staff login.
2. First question: Which saved Shoot is this phone filming? Answer: the signed Shoot Day film link.
3. Reuse: `public/app/teleprompter.html` and `.js`; no second teleprompter UI or new server route.
4. Data: the existing single-shoot `film.path` only; keep its key in device Keychain.
5. Files: the iOS entry view, thin WebKit shell, link validator tests, iOS README, and actual-journey note.
6. Risk: WebKit camera and video file behavior may differ from Safari; old installed app can remain if the phone is offline.
7. Proof: Swift build and simulator tests, live asset hash, then install on the real phone and inspect preview plus local and uploaded original video. No quality-ready claim before the last check.

## Status, 2026-10-18

- Live website responds 200; its teleprompter JS matches this checkout exactly.
- Apple app now launches that website from the Shoot Day film link instead of the separate practice screen. No staff login appears in the native flow.
- iPhone build passed. iPhone 17 Pro Max simulator tests passed: 56/56.
- Repository lint passed (3,968 files/scripts), teleprompter web unit tests passed (91/91), and the iPhone simulator launch visibly showed the link entry with no login. Signed iPhone archive build 3 exists at `/private/tmp/fundhub-prompter-live.xcarchive`.
- The physical iPhone 17 Pro Max (`00008150-0015185C0212401C`) accepted signed build 3. `devicectl` lists Fundhub Prompter version 1.0, build 3. While the phone was unlocked, a foreground launch and immediate screen capture showed the new **Fundhub Prompter** Shoot Day film-link entry, **Paste link**, and **Open teleprompter**; no login or bundled practice shoot appeared. No signed Shoot link was present in that view. The live filming page, camera preview, and saved-file quality remain unverified. See the proof board for exact acceptance steps.
