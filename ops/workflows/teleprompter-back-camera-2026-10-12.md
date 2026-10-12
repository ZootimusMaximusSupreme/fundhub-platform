# Teleprompter back camera — 2026-10-12

## Workflows

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| 1 | This session | done | Safari can omit or ignore `facingMode`; preserve the requested lens and use the exact rear device. |
| 2 | Parallel agent | done | Confirmed Safari's blank `facingMode` reopened the front lens. |

## Shared context

- Live page: `https://fundhub.ai/app/teleprompter.html`
- Back-camera button is live but Chris reports that it does not switch cameras.
- Do not touch pulse, the client page, or the league call list.
- Keep recording and teleprompter behavior unchanged.

## Manifests

- `public/app/teleprompter.js`: preserve the requested lens when Safari omits `facingMode`.
- `src/ui/teleprompter.test.mjs`: pure fallback proof.
- `e2e/teleprompter-take-flow.spec.mjs`: front/rear switch proof with labeled phone cameras and blank `facingMode`.
- `docs/journeys/shoot-flow.md`, `docs/journeys/CHANGELOG.md`: record the actual Safari behavior.

## Proof

- `npm run lint`: pass.
- Teleprompter unit tests: 50 pass.
- Focused camera browser tests: 3 pass.
- `npx tsc --noEmit`: one existing error in `src/marketing/filmed-receive.mjs:159`; this workflow did not touch that file.
