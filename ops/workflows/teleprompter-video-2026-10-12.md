# Teleprompter video investigation — 2026-10-12

## Scope

Find the fault shown by the new Drive recording and fix that recording path. Keep other work out of this batch.

## Workflows

| Owner | Work | Status |
| --- | --- | --- |
| `/root/drive_video` | Locate and watch the new Drive recording; report timed evidence and folder | Done |
| `/root` | Inspect teleprompter code and specs, make the smallest supported fix, integrate and ship | Running |
| `/root/proof_tests` | Baseline and focused automated proof in test files | Done |

## Drive video findings

- **Earlier cropped file:** [Direct Book Ad 5 — Paying for speed Take 1.mp4](https://drive.google.com/file/d/1YIFl15ZZxHrQz_ZNxPnX102-RN094kvv/view), ID `1YIFl15ZZxHrQz_ZNxPnX102-RN094kvv`. Uploaded October 12 at 5:17:39 p.m. Phoenix time; 48,051,593 bytes. Its parent is the correct [Direct Book Ads folder](https://drive.google.com/drive/folders/1lu1Jzn302TMBdfPS6r2XuOvNdMaWA9Ry), not SLO Ads. The name matches `marketing/ads/NAMING.md`.
- **Observed picture:** I downloaded the original Drive MP4 and decoded its full 23.48 seconds. At 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, and 22 seconds, the face stays upright in portrait, but the field of view is very tight. At 0 and 2 seconds the left side of the face is cut off; at 12, 16, 18, and 20 seconds large parts of the face or forehead fall outside the frame. The face fills nearly the entire 1214×2160 frame. The picture looks soft. Contact sheet: `/tmp/fundhub-ad5-sheet.jpg`; original resolution frame at 5 seconds: `/tmp/fundhub-ad5-5s-full.jpg`.
- **Cadence:** H.264 video plus AAC mono audio decodes. The file has 451 video frames in 23.48 seconds, averaging 19.28 fps. Each complete second has 18–20 frames. Two frame gaps exceed 0.1 second (largest 0.108 second); no long freeze appears in frame timestamps. This is below a 30 fps camera target but is steadier than the two short prior uploads.
- **Before/after comparison:** Two earlier same-name uploads at 4:25 p.m. Phoenix time, [ID `1vM9KGrD9Rj6xIeG3yirJwU3AzghjmtjJ`](https://drive.google.com/file/d/1vM9KGrD9Rj6xIeG3yirJwU3AzghjmtjJ/view) and [ID `1CQLFmDGBVxKOdSm4IFzvB9b-2o4Mjtn3`](https://drive.google.com/file/d/1CQLFmDGBVxKOdSm4IFzvB9b-2o4Mjtn3/view), are 2160×3840 and show a much wider head, shoulders, wall, and ceiling, but the picture is sideways in the saved file. Those are only 3.07 and 1.71 seconds and average 13.39 and 14.18 fps. Older comparison frame: `/tmp/fundhub-ad5-olderB.jpg`.
- **Implication for the earlier crop:** That original saved file itself has the tight crop and 1214×2160 image. Changing only its Drive destination or saving the same bytes on the phone would preserve that framing. This Drive evidence proves upright portrait for that take; it does not prove landscape behavior.
- **Post-full-frame take:** [Direct Book Ad 5 — Paying for speed Take 1.mp4](https://drive.google.com/file/d/1kY-7JPrYHXyVEAFdP2_GEy0VIDYEwady/view), ID `1kY-7JPrYHXyVEAFdP2_GEy0VIDYEwady`, uploaded at 5:58:08 p.m. Phoenix time, 246,451,394 bytes in Direct Book Ads. The original MP4 is 2160×3840 upright portrait, 35.41 seconds, H.264 at about 55.6 Mb/s with AAC mono audio. Frames at 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, and 33 seconds show full head, shoulders, and room; the tight face crop is gone. Contact sheet: `/tmp/fundhub-post-sheet.jpg`; raw file: `/tmp/fundhub-drive-post-fullframe.mp4`. Landscape remains untested.
- **Post-full-frame cadence:** Decoded every frame. There are 503 frames total, but 47 are exact repeated full-resolution images packed between 32.96167 and 33.04 seconds. Distinct frames: 456 across 35.37 seconds, about 12.9 distinct fps. Outside that brief repeated-frame burst, most seconds contain 12–14 frames. Median presentation gap is 85 ms; 33 gaps exceed 100 ms and 11 exceed 150 ms (maximum 170 ms). This supports the owner's report of visible choppiness. The final MP4 alone cannot separate slow camera delivery from missed canvas draws or recorder encoding. Two earlier 4K clips were also 13–14 fps, while the cropped 1214×2160 clip was 19.28 fps, so the 4K path is the stronger lead.
- **Upload path:** The page sends original `File.slice` bytes. The API reads raw binary bytes and forwards the same Buffer through `continueTake` to Drive's resumable upload. This path has no video conversion or frame-rate change. The Drive MP4 itself is choppy, so Drive preview alone is not the cause. No separate on-device hash was available to compare with the Drive file.
- **Next-take diagnosis:** After Stop, the page reports camera frames per second, copied canvas frames per second, and the longest camera gap. Compare those with the decoded Drive MP4. A slow camera count locates the loss before canvas; a high camera count and low copied count locates it in canvas; high counts for both and a slow MP4 locates it in encoding. The 5:58 p.m. take cannot answer this because its page did not collect these counts.

## Code investigation and fix

- The current `recordFrameBox(3840, 2160, portrait, 4K)` calculation cuts a wide camera frame down to **1214×2160**. That exactly matches the new Drive file's dimensions. It removes both outer sides before the file is encoded. Saving or uploading the same MP4 elsewhere cannot restore them.
- The same change that introduced the saved crop also began asking for tall iPhone camera dimensions, then applied tall constraints again after opening. The Drive file still came out from a wide frame. The page now requests the full wide camera frame and leaves the granted track dimensions alone. The proven crop was in our canvas calculation, not in Drive or the iPhone save step.
- The saved canvas now fits the entire source frame inside a vertical or horizontal output chosen from the physical phone angle. It never center-crops or stretches a wide frame. If Safari still supplies a wide frame on an upright phone, black space is left above and below the full image; the app reports that full portrait detail is unavailable. A true upright camera frame fills the output.
- The iPhone canvas targets at most 30 fps instead of trying 60 draws and delivering about 19 in the last Drive file. This is a performance choice, not a measured result yet. The existing single-file lens-switch recorder remains in place.
- Changed: `public/app/teleprompter.js`, `public/app/teleprompter.html` (fresh asset version), `docs/journeys/shoot-flow.md`, `docs/journeys/CHANGELOG.md`. Tests are owned by `/root/proof_tests`.

## Test and live proof

### Follow-up: choppy words during recording (`/root/proof_tests`)

- The old scrolling browser check used distance divided by elapsed time. It could pass after a visible pause because the script catches up on the next animation frame. The recording path separately drew the full camera image on a fixed 30 fps timer, even when the video had not produced a new frame.
- Added `recording does not redraw a stale camera frame while the words roll` in `e2e/teleprompter-take-flow.spec.mjs`. The test freezes video-frame notifications after the first frame, starts words and recording, then checks that the words move and the recording canvas does not keep drawing the same image.
- Baseline on current code: **red as expected**. Words moved, but the recorder drew the stale frame **13 extra times in 450 ms** (allowed: 1). Command: `E2E_PORT=43132 npx playwright test e2e/teleprompter-take-flow.spec.mjs -g 'does not redraw a stale camera frame' --reporter=line`.
- After the callback pump change, the new test passes. First full take-flow run is **25/27**: the two saved-pixel tests saw a black canvas because the fake camera had already produced its one frame before recording began. The recorder waits for a new callback. A single paint of the ready preview frame at recording start is being checked; the stale-frame test must stay green.
- The recorder now paints that ready frame once at startup. The saved-pixel tests and stale-frame test both pass. Added a fallback check for browsers without video-frame callbacks: the timer still paints while the words move. Final local take-flow browser run: `E2E_PORT=43137 npx playwright test e2e/teleprompter-take-flow.spec.mjs --reporter=line` — **28 passed, 0 failed**.
- This isolates wasted canvas work. It does not by itself measure real iPhone scroll smoothness; that still needs a fresh phone pass.

### Follow-up: ad and VSL capture quality (`/root/proof_tests`)

- New rule from Chris: an ad asks for 1080p and records at 60 fps or higher when the device grants it; a VSL asks for 4K and records at 30–60 fps. Script type decides this even when a saved camera choice says otherwise.
- Added a portrait iPhone unit assertion for a first 1080×1920 request, with a 1920×1080 fallback and no 1080-height cap on the portrait request. Baseline is **red**: current first 1080p request is 1920×1080.
- Added browser checks for an ad with saved 4K preference and a VSL with saved 1080p preference. The ad test is **red**: current first camera request is 3840×2160, so it never reaches its 60 fps canvas assertion. The VSL guard is **green**: first request is 4K and the saved canvas asks for 30 fps.
- Baseline commands: `node --test --test-name-pattern='portrait iPhone first asks' src/ui/teleprompter.test.mjs`; `E2E_PORT=43138 npx playwright test e2e/teleprompter-take-flow.spec.mjs -g 'iPhone ad requests|iPhone VSL requests' --reporter=line`.
- After the script-based mode change, the portrait iPhone 1080p first request and wide fallback pass. The ad test passes with a saved 4K choice: first request is portrait 1080p, the granted 60 fps camera leads to a 60 fps canvas request, and a lens flip asks for portrait 1080p while keeping one take. The VSL test passes with a saved 1080p choice: first request is 4K and the iPhone canvas asks for 30 fps.
- A late exact-device camera request had still hard-coded a wide frame. It now preserves the Ad's portrait 1080p request. A browser test checks that Stop displays the camera and copied-frame counters. These counts measure the preview and canvas, while the Drive file measures the encoded result.
- Full teleprompter unit file: **61 passed, 0 failed**. Full local take-flow browser file: `E2E_PORT=43142 npx playwright test e2e/teleprompter-take-flow.spec.mjs --reporter=line` — **29 passed, 0 failed**. These are browser requests and mock-camera canvas checks; the real iPhone and downloaded new Drive file still determine actual resolution, frame cadence, and smoothness.

### Baseline before this repair (`/root/proof_tests`)

- `node --test src/ui/teleprompter.test.mjs`: 61 passed, 0 failed.
- `npx playwright test e2e/teleprompter-take-flow.spec.mjs -g 'live camera stays unrotated|sideways phone keeps Safari preview unrotated|iPhone records one stable canvas stream' --reporter=line`: 3 passed, 0 failed, in local Chromium with a mocked camera.
- The green unit test currently **expects** an upright phone to crop a 1920×1080 camera frame to 606×1080. It also expects a 3840×2160 frame to crop to 1214×2160. Those assertions preserve the close framing Chris reported; they need to change with the camera fix.
- The browser tests check saved canvas shape, top/bottom test colors, and camera flips. They do not inspect the left/right edge of a wide camera frame or prove real iPhone image quality or frame rate. The fake recorder returns a text blob, so these tests do not prove playable MP4 quality.
- Added `portrait take keeps both edges of a wide camera image without a close crop` in `e2e/teleprompter-take-flow.spec.mjs`. It paints visible lime/yellow strips at the source's left/right edges and checks the recorded portrait canvas. Baseline run: **failed as expected** (`portrait: true`, `lime: false`, `yellow: false`), which proved the old center crop removed both edges.
- After the camera fix, the no-crop browser test passes. The existing red-over-blue orientation check now reads inside the fitted image, so black space around a wide frame does not hide a real rotation fault. Four focused browser tests (portrait and landscape shape, no crop, lens switching) pass on local Chromium.
- The 60 fps camera test now checks that the live lens can provide 60 fps while the iPhone saved canvas requests 30 fps; it still checks that switching lenses keeps one take. It passes in local Chromium. This proves the requested canvas rate only, not the actual MP4 frame cadence on an iPhone.
- Updated unit checks for native wide iPhone camera requests, no tall constraint after opening, full-source framing without stretch, and 30 fps iPhone canvas cap. `node --test src/ui/teleprompter.test.mjs`: **61 passed, 0 failed** after the fix.
- Complete local take-flow browser file: `E2E_PORT=43131 npx playwright test e2e/teleprompter-take-flow.spec.mjs --reporter=line`: **26 passed, 0 failed**. The separate port avoids a shared local test server race with another workflow.
- Real iPhone proof and downloaded Drive playback remain open.

### After the repair

- `node --test src/ui/teleprompter.test.mjs`: **61 passed, 0 failed**.
- Complete `e2e/teleprompter-take-flow.spec.mjs` in local Chromium with a mocked camera: **26 passed, 0 failed**. This includes both source edges surviving the saved portrait canvas, upright color order, sideways output, one recording through a lens flip, and a 30 fps saved-canvas request from a 60 fps camera input.
- `npm run lint`: **passed**, 3,403 files and inline scripts parse clean.
- `npx tsc --noEmit`: **failed** at `src/marketing/filmed-receive.mjs:159`, a file untouched by this change. No teleprompter type error was reported. This is recorded as an existing unrelated check failure; it has not been changed to hide red proof.
- Full `npm test` suite: failed in the unrelated display-contracts proof; database checks skipped without `DATABASE_URL`. Real iPhone and new Drive take: pending.

## Release

The 6:33 p.m. release at `2314782f` passed GitHub ship run `38331857922` and served the new 1080p Ad script. Chris's 6:35 p.m. iPhone screenshot showed a wide camera feed letterboxed into a thin middle strip on the upright screen. This is a preview regression from accepting a wide result of the new 1080p request. The next repair rejects wide results on an upright phone, tries all 1080p modes, then uses the previously proven portrait 4K front-camera source while saving the Ad at 1080p. `docs/rules/TELEPROMPTER-VIDEO.md` now requires measured stage-by-stage evidence and a real phone preview before calling a camera change ready.

The full-frame repair shipped at 5:44 p.m. Phoenix in commit `c5026292`; GitHub run `38328006180` passed. The smooth-scroll recording follow-up and Codex instruction migration shipped in commits `c54f8d5f` and `00f20473`; GitHub run `38330313337` passed and the live HTML loaded `teleprompter.js?v=20261012-smooth1`. The Ad quality correction and frame counters still need release and a fresh iPhone take before the recording can be called smooth.
