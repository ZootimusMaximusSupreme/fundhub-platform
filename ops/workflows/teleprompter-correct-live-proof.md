# Correct teleprompter: live and iPhone video proof

## Current evidence (2026-10-18)

- `https://fundhub.ai/app/teleprompter.html` responds HTTP 200 and serves `teleprompter.js?v=20261013-steady-camera`. The live JS SHA-256 is `c629afd8c0e0019a9acf205e5d05251335f7a68ff9698a9e91f8db244a23bd78`, identical to `public/app/teleprompter.js` in this checkout. This proves the web asset is served, not that the installed Apple app opens it or that filming works on an iPhone.
- The real web flow is `docs/journeys/shoot-flow.md` §5: the signed-in Shoot tab creates `/app/teleprompter.html?k=<film token>`. The page uses that key for scripts, marks, and take upload; the filming page itself requires no staff login. Ground truth: `docs/specs/teleprompter-requirements-2026-10-06.md` and `docs/rules/TELEPROMPTER-VIDEO.md`. There is no teleprompter-specific `*-intended.md` journey; do not claim a complete journey PASS from the actual-flow document.
- Existing `e2e/teleprompter-take-flow.spec.mjs` uses simulated camera streams and a replacement MediaRecorder. The earlier desktop WebKit encoder evidence (`docs/workflows/teleprompter-video-2026-10-12-evidence/webkit-guard-encoder-check-2026-10-13.json`) also says it is not physical-iPhone proof.
- The prior real take evidence (`docs/workflows/teleprompter-video-2026-10-12-evidence/postpublish-lens-flip-failure-2026-10-13.json`) found a saved take that turned into repeated black frames after a lens switch. It is a prior failure, not evidence about today's installed build. A fresh accepted take is required.

## Exact physical-iPhone proof after the corrected app is installed

1. Open the Apple app on Chris's unlocked iPhone. Confirm it displays the same live web teleprompter controls and the current Shoot plan's script and take name through the film link. Capture the app version, URL/route, time, phone orientation, and camera permission outcome. A page response alone does not count.
2. In portrait, open the front preview before Record. Check that the full upright camera frame is usable, slightly soft, and not cropped, stretched, black, or a thin strip. Record the badge's *granted* width, height, and frame rate; repeat at Record start and end. Note mic name and live level where available.
3. Film one short Ad with a moving subject so distinct frames can be counted. Use Record to start and manually stop. Watch the original file on the phone, listen for sound, choose **Yes** to save to the device queue, and confirm upload proceeds separately. Keep the original raw file and its bounded recording diagnostics.
4. Film one short front/back/front take while recording. Confirm the clock continues and only one original file is produced. Inspect local playback for black or frozen spans. Accept and upload it; do not infer success from track settings alone.
5. Film one short 4K VSL/thank-you/testimonial take if that mode is in scope for release. Repeat preview, local playback, sound, device-first save, and upload checks.
6. Download each *original* from its correct offer's Drive folder (not the Drive preview or a transcoded copy). Match the Drive size to downloaded bytes. Decode video and audio; measure width/height, rotation, duration, video frame presentation times, distinct image frames per second, longest gaps, repeated/black frames, and audio continuity. Compare with the take's granted camera settings, presented/copied/missed frame counts, and canvas size. Ads target full-frame 1080×1920 at 60 distinct fps; the video rule sets full-frame 4K at 60 distinct fps for VSL/thank-you/testimonials. Report any lower granted or saved rate as failed quality proof.
7. Save the measured result and marked issue screenshots under an evidence folder. Keep private raw video outside Git. Only call the Apple app ready to film after the installed app, preview, local original, and uploaded original all pass.

## Open gap

No fresh physical-iPhone preview or saved-file evidence exists for the corrected Apple app. Live web HTML/JS reachability is confirmed; Apple app wiring and recording quality remain unverified.
