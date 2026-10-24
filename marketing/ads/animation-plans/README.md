# Animation plans — filmed videos (2026-10-22)

The plans are in `2026-10-22.json`. There is one entry per filmed video (14). They were made with the writer's rule (`src/marketing/writer-prompt.mjs`): one animation per number, step or comparison, plus one.

**Read with the newer rules (owner-set 2026-10-23/24).** These plans came first. When placing: diagrams only (swap PathCards / StepPath picks for a diagram), big, one in the first 10 s, a CTA at the end, and never copy his sentence onto a plate (`.cursor/rules/animation-no-echo.mdc`). Skill: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`.

Each entry has:
- `body`: the script words the plan is anchored to,
- `source`: where those words came from,
- `key_points`: every number, step, comparison and strong claim, with the template that shows it or the new animation it needs,
- `plan`: the animations that fit the timing limits,
- `check`: the result from `src/marketing/animation-plan.mjs`.

**All 14 plans pass the checker: 112 animations in total, including the Fundhub logo 6 times** (redone 2026-10-23 with the 14 new animations from `ops/workflows/animation-builds-2026-10-22.md`). The VSL has 26 and the thank-you video has 8; both use only the sideways (`*Wide`) versions with a `side` prop, so they stay off the face and the captions. The 12 ads use the upright versions.

Each entry also has `timing`: the start second of every animation, its length and the gap to the next one. These come from an even speaking pace, so the real cut moves each start by a second or two. `src/ad-videos/animations.mjs` re-checks the real timing when the overlay step runs and drops any clip that lands too close to another.

27 key points still have no animation. Almost all are blocked by the timing rules (the first sentence, the call-to-action line, or 4 seconds of face between two animations), not by a missing animation. They are listed in `new-animations-needed.md`.

## The Fundhub logo (owner rule, 2026-10-23)

The logo animation (`FundhubLogo` upright, `FundhubLogoWide` sideways) plays only where the script says "Fundhub", for 2 seconds. `src/marketing/animation-plan.mjs` refuses a logo anchored anywhere else (`logo_not_on_fundhub`). No other see-through animation shows the logo.

It is placed 6 times: the VSL ("I run Fundhub", "Fundhub has a solution for that phase"), Ad 13, Ad 14, Ad 16 and Ad 9. The other 8 videos never say Fundhub. Where an animation sat too close to the logo, the logo won: the VSL lost a ProofWall and a PathCards, Ad 16 lost the 400-to-850 ScoreBadge, and Ad 9 lost the FundabilityMeter. In Ad 14 the logo starts about 3.3 seconds in, just past the 3-second limit, so a faster real cut can push it out.

## Known weak spots

- **ProofWall always shows its fixed lines** ("A decade", "Hundreds of files", "Thousands of data points", "A little over a million dollars funded for myself"). Ads 12 and 13 and the thank-you video never say some of them.
- **QualifyToday shows its own sample client's amounts** (199,350 today, 221,500 once fixed), never the script's numbers.
- **Words not in the script:** a "$0" stamp for "you owe us nothing" (Ads 13 and 14); "Report 1/2/3" labels on BureauMatch in the ads; the three bureau names on the VSL and thank-you clips come from the template.
- **The call-to-action line is a guess.** The plans treat the closing "click below" paragraph as the call to action. Ads 13 and 14 treat their closing guarantee paragraph as a normal line; if it is part of the call to action, the overlay step skips the clocks there.
- **LenderMatchScrollWide runs 3.5 seconds**, past the 3-second cap. It is used once in the VSL and once in the thank-you video.

## Script sources

- **Ad 5 — Paying for speed:** `marketing/ads/scripts/book-a-call-final-2026-10-03.md` section 5. The database row (ad_scripts 96) holds the thank-you text instead.
- **Ad 12 — Industry slam:** a looser read of ad_scripts 94 (It's a skill). The plan uses the words said on the take.
- **Ad 16 — Advanced funding algorithm:** no written script exists. The plan uses the words said on the take.

These plans are not saved to the database. The overlay step (`src/ad-videos/animations.mjs`) is not wired in.
