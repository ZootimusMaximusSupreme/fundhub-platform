---
description: Teleprompter camera and editing are locked (30 fps, front mirrored, never black, copy and paste only, clean screen, Rode on)
alwaysApply: true
---

# Teleprompter camera and editing — locked

**Owner law (2026-10-13):** Chris tested the teleprompter on his iPhone and said it is perfect. He asked for it to be hardened so it does not break while he films. These features are locked. Change one only when Chris says so.

The speed law is separate: `.cursor/rules/teleprompter-speed.mdc`.

## Law

- **30 fps, every take.** Front or back, Ad or VSL, the camera ask is a hard 30 fps (`HARD_FPS` in `public/app/teleprompter.js`). One ask opens the lens. 60 fps waits for the iPhone app. In Safari, extra 60 fps asks take the lens away and black out the screen.
- **Size.** Ads film at 1080p. VSLs, thank-you videos and testimonials film at 4K (`.cursor/rules/video-4k-unless-ad.mdc`).
- **Mirror.** The front camera is saved mirrored, on the 1080p path and the 4K path. The back camera is saved as the world looks.
- **The camera never goes black.** A flip during a take stays one take. The last picture stays on screen while the next lens opens. The camera ask that worked is remembered and tried first. A camera that drops reopens by itself.
- **Editing is copy and paste only.** A double-tap shows Copy script, Paste script and X. No keyboard. Holding a line does nothing. Chris fixes the words in Claude and pastes the whole script back.
- **A clean screen.** No History screen. No "No changes yet". No "Choose words": if the script changed somewhere else, the phone's words are kept. The save line shows only a real problem (a failed save, or offline).
- **The mic says what is plugged in.** "iPhone mic on" for the phone's mic. "Rode on" for a Rode. A Rode plugged in or pulled out during a take waits for Stop. The take keeps its mic.

## The tests that hold it

- `src/ui/teleprompter.test.mjs` — hard 30, the Rode label, Copy script
- `e2e/teleprompter-take-flow.spec.mjs` — one 30 fps ask, the flip in one take, the held picture, the saved mirror on 1080p and 4K
- `e2e/teleprompter-camera-steady.spec.mjs` — the remembered ask, the camera reopening by itself
- `e2e/teleprompter-touch.spec.mjs` — copy and paste only, holding a line does nothing, no History, no Choose words
- `e2e/teleprompter-mic.spec.mjs` — iPhone mic on, Rode on, the switch waits for Stop

## Never

- Ask the camera for 60 fps in Safari, or add a second fps try
- Save the front camera unmirrored, or mirror the back camera
- Bring back History, "No changes yet", "Choose words", hold-to-edit, or typing on the phone
- Switch the mic in the middle of a take
- Delete, skip or weaken a test above to make a change pass

## Example

```text
Ask: "Make the ads 60 fps."

❌ Add a 60 fps ask in Safari.
✅ Say 60 fps waits for the iPhone app by owner law. Ask Chris if he wants to change the law first.
```
