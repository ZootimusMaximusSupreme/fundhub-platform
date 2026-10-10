# Teleprompter speed — 130 to 220

**Owner law (2026-10-10):** Chris reads at one steady speed. He tested it and locked it. These numbers are hard limits.

## Law

- **Slowest: 130 words a minute. Fastest: 220.** Nothing goes under or over. Not the − and + taps, not the Settings slider, not a saved number, not the volume buttons, not a remote.
- **One fixed scroll speed.** Speed = script height in pixels ÷ (words ÷ words a minute × 60). Blank gaps, paragraph breaks and long lines never change it.
- **Steps are 5 words a minute.**
- **The volume buttons walk one ladder**, with no finger on the glass:
  back 220 … back 130 · paused · forward 130 … forward 220.
  Down while rolling slows it. At 130 one more press pauses. Down again rolls back at 130. Down again rolls back faster, up to 220, and stays. Up walks the other way.
- **Sideways words are 0.6 of the set size**, so fewer words sit on a line and the page does not look slow.

The numbers live in `public/app/teleprompter.js`: `MIN_WPM`, `MAX_WPM`, `steadyPace`, `volumeLadder`, `SIDEWAYS_FONT`. The iPhone app follows the same law (`docs/specs/teleprompter-ios-app-build-2026-10-10.md`).

## Never

- Raise 220 or lower 130 without Chris saying a new number
- Tie the scroll speed to how dense the text is
- Add a speed control that can leave the range
- Weaken the tests that hold these numbers (`src/ui/teleprompter.test.mjs`, `e2e/teleprompter-touch.spec.mjs`)

## Example

```text
Ask: "Add a turbo button for fast reads."

❌ A button that jumps to 260.
✅ Say the top is 220 by owner law. Ask Chris for a new number first.
```
