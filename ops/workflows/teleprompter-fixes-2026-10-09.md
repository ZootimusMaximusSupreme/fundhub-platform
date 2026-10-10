# Teleprompter fixes — 2026-10-09 (owner: Chris)

| Unit | Status | What |
|---|---|---|
| A Save | done | Double-tap shows a Save button (next to the X). Typing is queued at once and the server save follows in 300 ms (was 1500 ms, and typing was not queued until the cursor left). Save sends now and puts the keyboard away. |
| B Speed | done | One fixed scroll speed: script height in px / (words / wpm * 60). Blank gaps, paragraph breaks and the pause setting no longer change it. `steadyPace()` in `public/app/teleprompter.js`. Speed still moves with the wpm buttons. |
| C Landscape font | done | Sideways, words show at half the saved size (`shownFont()`). Portrait unchanged. |
| D Drive push | blocked | Needs Chris to name the Drive folder. |

## Manifest
- `public/app/teleprompter.js`, `public/app/teleprompter.css`
- Tests: `src/ui/teleprompter.test.mjs` (3 new), `e2e/teleprompter-touch.spec.mjs` (3 new)
- Journeys: none changed.

## Leftovers (not fixed, not named)
- 5 older touch e2e tests fail the same way on a clean checkout (they expect the old Stop button and the old edit box). Measured 2026-10-09.
- No unmerged branch of earlier teleprompter fixes was found on GitHub or locally; nothing deleted.
