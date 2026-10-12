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

### Phone repair pass

Chris tested the first live repair on iPhone and the same problems remained. Live headers and source proved the phone URL was receiving the new file, so this was code behavior rather than an old deploy. The new pass removes the recording canvas from iPhone entirely, detects a lens switch that resolves without changing lenses, and opens the cached exact rear device first. Five focused browser tests pass, including an iPhone user-agent check that proves MediaRecorder receives the original camera stream.

Final phone build: 50 unit tests and 16 browser tests pass. Netlify deploy `6acd3624cb09d5a28608ceb1` is ready with 16 functions and 9 schedules. The live HTML forces `teleprompter.js?v=20261012-phone2`. The live JavaScript SHA-256 matches local: `3f314e970db237cb6a832c3eb4d39069e0ce5a68fcd53ea3c75ab4a077686b88`. The page returns HTTP 200. Local and GitHub main matched at `e96ce14581e35019bc66db538036c8934ccfa64d` before this final board-only commit.
