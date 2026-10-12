# Teleprompter recording and camera repair — 2026-10-12

## Workflows

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| 1 | Parallel agent | blocked | Code index could not start because its Node path was missing. No files changed. |
| 2 | Parallel agent | blocked | Code index could not start because its Node path was missing. No files changed. |
| 3 | This session | claimed | Integrate the smallest fix, test, ship, and sync local/GitHub main. |

## Shared context

- Live page: `https://fundhub.ai/app/teleprompter.html`
- Play scrolls smoothly, but pressing Record makes it jump or break.
- Front preview works. Rear preview is blank.
- Switching cameras asks for camera access again.
- Smooth scrolling is a hard rule throughout the app.
- Do not touch pulse, the client page, or the league call list.

## Manifests

### Workflow 3

- `public/app/teleprompter.js`: camera-file drawing follows camera frames at no more than 30 fps; camera flip tries the existing track first; fallback preview replaces the old stream only after `video.play()` succeeds.
- `e2e/teleprompter-take-flow.spec.mjs`: proves one camera request for the normal flip path, front/rear/front during one take, the Safari fallback, and smooth scroll while recording.
- `docs/journeys/shoot-flow.md`: records the real switch and recording flow.
- `docs/journeys/CHANGELOG.md`: records why the shoot journey changed.

Proof so far: 50 teleprompter unit tests and 15 teleprompter browser tests pass. Ship and repository sync pending.
