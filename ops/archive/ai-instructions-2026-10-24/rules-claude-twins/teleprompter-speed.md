# Teleprompter speed — 130 to 320

**Owner law (2026-10-10):** Chris reads at one steady speed. He tested it and locked it. These numbers are hard limits. The top was 220, then 260, and Chris raised it to 320 the same day: it was too slow with the phone sideways.

## Law

- **Slowest: 130 words a minute. Fastest: 320.** Nothing goes under or over. Not the − and + taps, not the Settings slider, not a saved number, not the volume buttons, not a remote.
- **One fixed scroll speed.** Speed = script height in pixels ÷ (words ÷ words a minute × 60). Blank gaps, paragraph breaks and long lines never change it.
- **Steps are 5 words a minute.**
- **The volume buttons walk one ladder**, with no finger on the glass:
  back 320 … back 130 · paused · forward 130 … forward 320.
  Down while rolling slows it. At 130 one more press pauses. Down again rolls back at 130. Down again rolls back faster, up to 320, and stays. Up walks the other way.
- **Sideways words are 0.6 of the set size**, so fewer words sit on a line and the page does not look slow.

The numbers live in `public/app/teleprompter.js`: `MIN_WPM`, `MAX_WPM`, `steadyPace`, `volumeLadder`, `SIDEWAYS_FONT`. The iPhone app follows the same law (`docs/specs/teleprompter-ios-app-build-2026-10-10.md`).

## Never

- Raise 320 or lower 130 without Chris saying a new number
- Tie the scroll speed to how dense the text is
- Add a speed control that can leave the range
- Weaken the tests that hold these numbers (`src/ui/teleprompter.test.mjs`, `e2e/teleprompter-touch.spec.mjs`)

## Example

```text
Ask: "Add a turbo button for fast reads."

❌ A button that jumps to 320.
✅ Say the top is 320 by owner law. Ask Chris for a new number first.
```
