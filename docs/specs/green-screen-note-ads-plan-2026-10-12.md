# Green-screen note ads — build plan

Status: plan only. No feature code is approved or built.

## Goal

Chris picks a note screenshot from his phone. The note fills the video background. The front camera shows Chris over it in real time. He can see his body and finger against the note while he records.

The saved video must match the live preview.

## Small first version

1. Add a **Note ad** mode beside the normal teleprompter mode.
2. Let Chris pick one screenshot or photo from Photos or Files.
3. Show that image full screen as the background.
4. Show the front camera over it.
5. Remove the physical green backdrop from the camera picture with a simple green-color key.
6. Add three small controls: move Chris left/right, change his size, and adjust how much green is removed.
7. Keep the preview live while he points at the note.
8. Record the mixed picture and microphone into one video file.
9. Use the normal Take 1, Take 2 naming and save flow.

## Important limit

The web page will not record the Notes app while that other app is open. Chris takes a screenshot first, returns to the recording page, and picks the screenshot. That gives the same note background while keeping the camera and recording open.

## Build order

1. Image picker and full-screen note background.
2. Live front-camera layer.
3. Green removal and live position controls.
4. Record the exact mixed preview with microphone sound.
5. Save with the current take naming.
6. Prove it on iPhone Safari and from the saved Home Screen app.

## Proof

- The chosen note is readable in portrait and landscape.
- Chris can see himself before recording.
- Moving a finger changes the live preview at once.
- The saved video matches the preview position and size.
- Sound stays in sync.
- Recording and saving do not change the normal teleprompter flow.

## Time

About 2–3 hours for the small version and real iPhone proof. Build it after the VSL and thank-you video are filmed.
