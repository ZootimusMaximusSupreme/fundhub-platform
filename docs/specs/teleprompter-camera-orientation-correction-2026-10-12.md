# Teleprompter camera orientation — correction spec

**Owner request, October 12, 2026:** When the phone is upright, the live camera view and saved video are upright and vertical. When the phone is sideways, both are upright relative to that position and horizontal. The words and controls stay readable in the phone's current position.

## Seen failure

The 4:46:50 p.m. iPhone screenshot shows a portrait page and upright script, but Chris's face in the camera layer is sideways. The 4:46:40 p.m. screenshot also shows the rear-camera scene through the glass with the wrong framing. The earlier desktop browser checks passed, but they did not prove real iPhone Safari camera behavior. Do not call this fixed based on those checks.

## Likely fault to test

`syncPreviewOrientation()` in `public/app/teleprompter.js` treats `video.videoWidth > video.videoHeight` on a portrait phone as proof that the visible pixels need turning. `public/app/teleprompter.css` then rotates `#cam-feed`, with the opposite direction for the front camera. Safari may already display the track upright despite reporting a wide camera buffer. The same width/height assumption also drives `recordFrameBox()` and the saved canvas. This is a diagnosis to verify on a real iPhone, not a confirmed cause.

## Required behavior

1. **Live view:** Front and rear camera images are upright relative to the physical phone. The same dark-glass layer and script remain over the image. Turning the phone does not turn the face or scene sideways, stretch it, or hide it. Fit the image without the unexpected close crop shown in the screenshots.
2. **Saved file:** A take made upright plays as a vertical video with upright people and objects. A take made sideways plays as a horizontal video with upright people and objects. Check the actual pixels during playback as well as the file dimensions and orientation metadata.
3. **Camera flip:** The top-left button switches front ↔ rear in either phone position. It never starts or stops a take. A flip during a take keeps one valid recording and an upright live view. Preserve the existing front-camera mirror choice and rear-camera unmirrored view.
4. **Reading flow:** Words, buttons, smooth scroll, speed, pause/play, and video saving keep working. No new control or permission flow is part of this fix.
5. **Video quality:** The saved take must look sharp and play smoothly. VSL and thank-you takes must meet the existing 4K rule when the iPhone browser grants 4K capture; ads may use 1080p. Do not claim 4K or 60 fps from requested settings alone. The upload must keep the original take bytes and quality; it must not use the dimmed or blurred preview image.

## Build approach

- First measure what a real iPhone gives the page in each camera and phone position: physical orientation, `videoWidth`/`videoHeight`, track settings, and the image Safari actually paints. Use a temporary local diagnostic if needed; do not expose it in the filming UI.
- Correct the preview from observed rendered orientation, not frame width/height alone. Keep any transform inside the camera layer. Do not rotate the whole page, words, or controls.
- Correct canvas drawing separately from preview styling. Select vertical or horizontal output from the physical phone position at Record, then draw upright pixels into that shape. Test front mirror and rear camera after a lens switch. Do not assume a CSS preview transform also fixes recorded pixels.
- Refresh the teleprompter asset version when shipping so a Home Screen Safari copy cannot keep the old camera CSS or JavaScript.

## Proof before shipping

| Phone position | Lens | Live view | Saved take |
| --- | --- | --- | --- |
| Upright | Front | Upright face, full usable frame | Vertical, upright face |
| Upright | Rear | Upright scene, full usable frame | Vertical, upright scene |
| Sideways | Front | Upright face, full usable frame | Horizontal, upright face |
| Sideways | Rear | Upright scene, full usable frame | Horizontal, upright scene |

Run each row on a real iPhone in the Home Screen app or Safari, whichever Chris is filming with. For each row, press Record, film a short take, save it, and play the saved file. Also flip cameras once before recording and once during recording; neither flip may trigger Record. Automated browser tests must cover the drawing and controls, but browser simulation alone does not close this bug. Verify the published page loads the new asset versions. Report any real-device row that remains untested as open.

For one VSL or thank-you take, record at least 30 seconds while the script scrolls and the camera moves. Play the saved file on the phone and inspect its actual dimensions, frame cadence, duration, and visible sharpness. Check for freezes, repeated frames, dropped sections, and audio drift. Download the uploaded take and confirm that its bytes match the saved original. A smooth preview or a bitrate request alone is not proof of a smooth, high-quality file.

**Scope:** Camera orientation, framing, saved-video quality, and the minimum tests and asset-version change needed to prove this correction. Do not change the client page, league call list, script data, or other teleprompter features.
