# Teleprompter — owner requirements (Chris, 2026-10-06)

Built so far (ship 2): `public/app/teleprompter.html` + `teleprompter.js` — mirror mode, speed, pause, keyboard / Bluetooth remote keys, reads approved scripts in film order from the Shoot plan.

## Required

### Script editing
- Edit the script on the fly, right in the teleprompter (Chris changes lines often). Saves back to the script.

### Playback
- Single tap: pause.
- Tap again: resume.
- Double tap: scroll mode.
- Scroll gesture in scroll mode: move the script up or down.
- Or: tap, then scroll the script by hand.

### Camera (iPhone 17 Pro Max)
- Front camera, highest quality.
- Record mirrored and reversed.
- Small camera preview only to line up, then it fades to dark glass.
- Low-detail preview is fine; dark background so the words pop.

### Completed recordings (owner, 2026-10-13)
- Front/back switching must keep one continuous take, including 4K; choosing a fixed lens before each take was rejected.
- After Stop, watch the original completed file on the phone immediately.
- Accepting the take saves it to the phone's durable queue before Drive upload starts; uploads run separately from filming.
- A user-triggered Save to phone action opens iOS sharing/downloading for the same original video. Do not claim the browser automatically writes to Photos.
- Watch last take reopens the last accepted video in this session; after reopening the app, queued device files remain available while awaiting upload. No extra permanent retention of already-uploaded files is required by this change.

## Later
- Pronunciation guides.
- Bullet-point scripts.

## Notes
- 4K law: non-ad videos (VSLs, testimonials) must be 4K. A web page camera may cap below 4K on iPhone; the native app (spec §8.5) records at full quality.
- Testing without the paid Apple Developer account: the web teleprompter runs in iPhone Safari today. A native app can go on Chris's own iPhone with a free Apple ID through Xcode (it must be re-installed every 7 days). The paid $99 account is only needed for TestFlight / the App Store.
