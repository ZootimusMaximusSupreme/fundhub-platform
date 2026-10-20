# Correct teleprompter in the Apple app

Owner: Chris. Session: Apple app wiring. Parallel proof: `ops/workflows/teleprompter-correct-live-proof.md`.

## Build gate

1. Job: Open the exact live Shoot Day teleprompter inside the separate Fundhub Prompter iPhone app, without a staff login or link paste.
2. First question: What is the current real shoot? The existing default-company open `GET marketing/shoot` answers it.
3. Reuse: `public/app/teleprompter.html` and `.js`; no second teleprompter UI or new server route.
4. Data: direct live page, whose existing open shoot read, mark, and take-upload routes serve the default company. Script edits still need staff or signed-film access and are not claimed to work anonymously.
5. Files: the iOS entry view, focused app-entry tests, iOS README, and actual-journey note.
6. Risk: Open access is limited to the default company; WebKit camera/file behavior may differ from Safari. Do not weaken script-edit authorization.
7. Proof: Swift build and simulator tests, live route check, then install on the real phone and inspect preview plus local and uploaded original video. No quality-ready claim before the last check.

## Status, 2026-10-18

- Live website responds 200; its teleprompter JS matches this checkout exactly.
- Apple app now launches that website from the Shoot Day film link instead of the separate practice screen. No staff login appears in the native flow.
- iPhone build passed. iPhone 17 Pro Max simulator tests passed: 56/56.
- Repository lint passed (3,968 files/scripts), teleprompter web unit tests passed (91/91), and the iPhone simulator launch visibly showed the link entry with no login. Signed iPhone archive build 3 exists at `/private/tmp/fundhub-prompter-live.xcarchive`.
- The physical iPhone 17 Pro Max (`00008150-0015185C0212401C`) accepted signed build 3. `devicectl` lists Fundhub Prompter version 1.0, build 3. While the phone was unlocked, a foreground launch and immediate screen capture showed the new **Fundhub Prompter** Shoot Day film-link entry, **Paste link**, and **Open teleprompter**; no login or bundled practice shoot appeared. No signed Shoot link was present in that view. The live filming page, camera preview, and saved-file quality remain unverified. See the proof board for exact acceptance steps.

## Correction, 2026-10-19

- Removed the link-entry screen from the separate Apple app. The app now opens the exact live page at `https://fundhub.ai/app/teleprompter.html` on launch.
- Live no-login `GET /api/marketing/shoot` returned a real current shoot with 13 scripts and 9 plan candidates; the page returned HTTP 200. Focused route/UI/upload tests passed (96/96).
- Simulator app tests passed. A simulator launch visibly loaded a real Direct Book script and the Record/Play controls without login or pasted link. Its simulated camera reported 1080×1440 at 10 fps; that is not video-quality proof.
- Physical iPhone 17 Pro Max briefly reconnected and accepted build 4. `devicectl device info apps` confirms Fundhub Prompter 1.0, bundle version 4. A foreground launch then failed because iOS reported the phone locked, so its real app screen and camera are not yet verified. Script editing remains gated by staff or film-key access; no server authorization was weakened.
- Repo lint passed (3,968 files/scripts). iPhone simulator tests passed; focused browser take-flow tests passed (60/60). Release archive build 4 succeeded at `/private/tmp/fundhub-prompter-direct-build4.xcarchive`. Local `codesign --verify --deep --strict` returned `CSSMERR_TP_NOT_TRUSTED`, but the physical device did accept the install; its runtime/recording proof remains open.
