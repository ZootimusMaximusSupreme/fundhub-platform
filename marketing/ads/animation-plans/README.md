# Animation plans — filmed videos (2026-10-22)

The plans are in `2026-10-22.json`. There is one entry per filmed video. Each entry has:
- the script words the plan is anchored to,
- where those words came from,
- the plan (`anchor`, `template`, `props`, `seconds`),
- `gaps`: key lines with no animation in the kit yet,
- `check`: the result from `src/marketing/animation-plan.mjs`.

**11 of 14 pass the checker.** These 3 fail because no animation in the kit fits their key lines:
- Ad 4 — High earners
- Ad 9 — The bank
- Ad 11 — The penthouse

New animations are needed for them. Their `gaps` name the lines.

## Script sources (checked against the words said on each take)

- **Ad 5 — Paying for speed:** the script is in `marketing/ads/scripts/book-a-call-final-2026-10-03.md` section 5. The database row (ad_scripts 96) holds the thank-you text instead.
- **Ad 12 — Industry slam:** a looser read of ad_scripts 94 (It's a skill). The plan uses the words said on the take.
- **Ad 16 — Advanced funding algorithm:** no written script exists in the repo, the database or any chat. The plan uses the words said on the take.

These plans are not saved to the database yet. The overlay step (`src/ad-videos/animations.mjs`) is not wired in yet.
