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

- **Latest file:** [Direct Book Ad 5 — Paying for speed Take 1.mp4](https://drive.google.com/file/d/1YIFl15ZZxHrQz_ZNxPnX102-RN094kvv/view), ID `1YIFl15ZZxHrQz_ZNxPnX102-RN094kvv`. Uploaded October 12 at 5:17:39 p.m. Phoenix time; 48,051,593 bytes. Its parent is the correct [Direct Book Ads folder](https://drive.google.com/drive/folders/1lu1Jzn302TMBdfPS6r2XuOvNdMaWA9Ry), not SLO Ads. The name matches `marketing/ads/NAMING.md`.
- **Observed picture:** I downloaded the original Drive MP4 and decoded its full 23.48 seconds. At 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, and 22 seconds, the face stays upright in portrait, but the field of view is very tight. At 0 and 2 seconds the left side of the face is cut off; at 12, 16, 18, and 20 seconds large parts of the face or forehead fall outside the frame. The face fills nearly the entire 1214×2160 frame. The picture looks soft. Contact sheet: `/tmp/fundhub-ad5-sheet.jpg`; original resolution frame at 5 seconds: `/tmp/fundhub-ad5-5s-full.jpg`.
- **Cadence:** H.264 video plus AAC mono audio decodes. The file has 451 video frames in 23.48 seconds, averaging 19.28 fps. Each complete second has 18–20 frames. Two frame gaps exceed 0.1 second (largest 0.108 second); no long freeze appears in frame timestamps. This is below a 30 fps camera target but is steadier than the two short prior uploads.
- **Before/after comparison:** Two earlier same-name uploads at 4:25 p.m. Phoenix time, [ID `1vM9KGrD9Rj6xIeG3yirJwU3AzghjmtjJ`](https://drive.google.com/file/d/1vM9KGrD9Rj6xIeG3yirJwU3AzghjmtjJ/view) and [ID `1CQLFmDGBVxKOdSm4IFzvB9b-2o4Mjtn3`](https://drive.google.com/file/d/1CQLFmDGBVxKOdSm4IFzvB9b-2o4Mjtn3/view), are 2160×3840 and show a much wider head, shoulders, wall, and ceiling, but the picture is sideways in the saved file. Those are only 3.07 and 1.71 seconds and average 13.39 and 14.18 fps. Older comparison frame: `/tmp/fundhub-ad5-olderB.jpg`.
- **Implication for fix:** The latest original saved file itself has the tight crop and 1214×2160 image. Changing only its Drive destination or saving the same bytes on the phone would preserve that framing. A new recording is needed after the camera capture path is corrected. This Drive evidence proves upright portrait for the latest take; it does not prove landscape behavior.

## Code investigation and fix

- The current `recordFrameBox(3840, 2160, portrait, 4K)` calculation cuts a wide camera frame down to **1214×2160**. That exactly matches the new Drive file's dimensions. It removes both outer sides before the file is encoded. Saving or uploading the same MP4 elsewhere cannot restore them.
- The same change that introduced the saved crop also began asking for tall iPhone camera dimensions, then applied tall constraints again after opening. The Drive file still came out from a wide frame. The page now requests the full wide camera frame and leaves the granted track dimensions alone. The proven crop was in our canvas calculation, not in Drive or the iPhone save step.
- The saved canvas now fits the entire source frame inside a vertical or horizontal output chosen from the physical phone angle. It never center-crops or stretches a wide frame. If Safari still supplies a wide frame on an upright phone, black space is left above and below the full image; the app reports that full portrait detail is unavailable. A true upright camera frame fills the output.
- The iPhone canvas targets at most 30 fps instead of trying 60 draws and delivering about 19 in the last Drive file. This is a performance choice, not a measured result yet. The existing single-file lens-switch recorder remains in place.
- Changed: `public/app/teleprompter.js`, `public/app/teleprompter.html` (fresh asset version), `docs/journeys/shoot-flow.md`, `docs/journeys/CHANGELOG.md`. Tests are owned by `/root/proof_tests`.

## Test and live proof

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
- Full `npm test` suite: running. Real iPhone and new Drive take: pending.

## Release

Pending.
