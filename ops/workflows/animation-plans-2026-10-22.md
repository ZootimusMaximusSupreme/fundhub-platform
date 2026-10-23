# Animation plans for the 14 filmed videos — 2026-10-22

Goal: run the writer's animation rule (`src/marketing/writer-prompt.mjs`: one animation per number, step or comparison, plus one) on every filmed script. Every key point either gets an animation from the kit or lands on the new-animation list.

Inputs: script words per video in `marketing/ads/animation-plans/2026-10-22.json` (index 0–13).

| Unit | Videos (index) | Owner | Status |
|---|---|---|---|
| A | 0 VSL, 1 Thank You, 2 Ad 13, 3 Ad 14, 4 Blueprint Ad 3 | Sonnet agent | done |
| B | 5 Ad 16, 6 Ad 12, 7 Ad 4, 8 Ad 5, 9 Ad 9 | Sonnet agent | done |
| C | 10 Ad 10, 11 Ad 11, 12 Blueprint Ad 1, 13 Blueprint Ad 2 | Sonnet agent | done |
| Merge, re-check, commit | all | Claude (this session) | done |

No dependencies between A, B and C. Merge waits on all three.
Nothing is saved to the database until Chris says so.

## Result

All 14 plans pass the checker. 94 key points found, 46 animations in the plans, 46 key points need a new animation (`marketing/ads/animation-plans/new-animations-needed.md`). Not saved to the database.
