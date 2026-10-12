# Teleprompter recording and camera repair — 2026-10-12

## Workflows

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| 1 | Parallel agent | blocked | Code index could not start because its Node path was missing. No files changed. |
| 2 | Parallel agent | blocked | Code index could not start because its Node path was missing. No files changed. |
| 3 | This session | done | Integrated, tested, shipped, and synced local/GitHub main. |

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

Proof: 50 teleprompter unit tests and 15 teleprompter browser tests pass. Lint passed across 3,380 files and inline scripts. The existing unrelated TypeScript error remains in `src/marketing/filmed-receive.mjs:159`. Netlify deploy `6acd32cee6660aed5b24f744` is ready with 16 functions and 9 schedules. The live teleprompter JavaScript SHA-256 equals the tested local file: `0d9ccca20d80ec7acd1e2190634b8e6d06ee703db4247b23c135284751fcc3bc`. The page returns HTTP 200. Local and GitHub main matched at `ccfc5e80cb6f8b8eb948e186f1575c2fdf1290e9` before this final board-only commit.
