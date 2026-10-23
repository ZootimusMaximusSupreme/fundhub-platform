# Animation plans — filmed videos (2026-10-22)

The plans are in `2026-10-22.json`. There is one entry per filmed video (14). They were made with the writer's rule (`src/marketing/writer-prompt.mjs`): one animation per number, step or comparison, plus one.

Each entry has:
- `body`: the script words the plan is anchored to,
- `source`: where those words came from,
- `key_points`: every number, step, comparison and strong claim, with the template that shows it or the new animation it needs,
- `plan`: the animations that fit the timing limits,
- `check`: the result from `src/marketing/animation-plan.mjs`.

**All 14 plans pass the checker.** Across the 14 scripts:
- 94 key points were found,
- 46 animations are in the plans,
- 46 key points need a new animation. They are listed in `new-animations-needed.md`, and several repeat across videos.

## Known weak spots

- **ProofWall always shows its fixed lines:** "A decade", "Hundreds of files", "Thousands of data points" and "A little over a million dollars funded for myself". In Ad 16, Ad 12 and Ad 5, some of those lines are not said in the script.
- **ToolMatch is a stretch in Ad 9 and Ad 11.** Ad 9 uses it for the two-people comparison and the highest limit card. Ad 11 uses it for own cash vs. other people's money. Nothing closer exists yet.
- **QualifyToday shows its own sample amounts** (199,350 today, 221,500 once fixed). It never shows the script's numbers.

## Script sources

- **Ad 5 — Paying for speed:** `marketing/ads/scripts/book-a-call-final-2026-10-03.md` section 5. The database row (ad_scripts 96) holds the thank-you text instead.
- **Ad 12 — Industry slam:** a looser read of ad_scripts 94 (It's a skill). The plan uses the words said on the take.
- **Ad 16 — Advanced funding algorithm:** no written script exists. The plan uses the words said on the take.

These plans are not saved to the database. The overlay step (`src/ad-videos/animations.mjs`) is not wired in.
