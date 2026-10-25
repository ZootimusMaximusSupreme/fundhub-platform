# Copy, video, and animation rules

Branch `drift-cleanup`. This agent edited only the real files under `.ai/rules/` that it owns. No commit.

## Files changed

- `.ai/rules/ad-second-line.md` — D74. The three repeated sections now point at `marketing/ads/SECOND-LINE.md`. The 2026-09-28 line stays.
- `.ai/rules/ad-watch-curve.md` — D76, D77, D78. Definitions and the dying ping point at `marketing/ads/watch-curve.md`. The "do not pause" sentence stays. The never list keeps only "do not build a new notify vendor."
- `.ai/rules/ad-naming.md` — D70, D71, D72, D73. The four-part bullets and the Never list are gone. The join line is shortened. The ad-id law (owner-set 2026-09-06) is folded in from CLAUDE.md.
- `.ai/rules/page-edits-marked-draft.md` — D153, D154. The 2026-10-19 line is shorter and points at `owner-go-no-repeat-approval`. Step 6 points at `finish-the-answer`.
- `.ai/rules/video-4k-unless-ad.md` — Call 34. Line 16 no longer requires 4K for a testimonial card video on a page. The 2026-10-24 date stays.
- `.ai/rules/ad-video-best-of-clips.md` — D75. The first Submagic sentence points at `chris-never-submagic`. The B-roll sentences stay.
- `.ai/rules/slo-one-filmed-folder.md` — D181. Dropped the repeated last sentence. Direct Book still has its own folder (owner-set 2026-10-24).
- `.ai/rules/teleprompter-camera.md` — D186 and call 34. The size line points at `video-4k-unless-ad`, including the testimonial-card exception. The 30 fps lock was not touched.
- `.ai/rules/animation-overlay-on-spoken-words.md` — D88, D89, D90, calls 37, 38, and 39. The style list from `animation-ad-style` is here. The face line says behind his head is fine. Long clips may ride the whole idea. Video files go in a scratch folder. Small files stay in the repo. The front-matter description matches the merge.

## Files archived

- `.ai/rules/animation-ad-style.md` moved to `ops/archive/ai-instructions-2026-10-24/.ai/rules/animation-ad-style.md` (D87, merge M8). Its two links were removed: `.cursor/rules/animation-ad-style.mdc` and `.claude/rules/animation-ad-style.md`. The old "no sound edit" line stays in that archived copy. The live wording is the last style bullet in `animation-overlay-on-spoken-words` (call 37).

Cut lines from the files that stayed are in `ops/archive/ai-instructions-2026-10-24/removed-lines/`, one file per rule.

## Handoff

Do not edit numbered Part 0 lines except the wording inside a line. Do not edit `marketing/ads/rules-data.mjs` (call 44 leftovers).

- `marketing/ads/NAMING.md` D225. Replace the two bullets `.cursor/rules/ad-naming.mdc` and `.claude/rules/ad-naming.md` with `.ai/rules/ad-naming.md`.
- `marketing/ads/NAMING.md` D226. After the example under "## How to write it", add: The offer word is `SLO`, `Direct Book` or `Capital Blueprint`. The live list of filmed names is `marketing/ads/filmed-names-2026-10-22.md`. `Capital Blueprint` is not in that book yet. It is still in CLAUDE.md until Phase 5.
- `marketing/ads/NAMING.md` D227, call 33. Keep "Google Drive file names for these ads." Replace the next sentence with: Law: slo-one-filmed-folder (.ai/rules/slo-one-filmed-folder.md) - filmed SLO files live in the SLO Ads root only; Direct Book has its own folder.
- `marketing/ads/watch-curve.md` D233. Replace `.cursor/rules/ad-watch-curve.mdc / .claude/rules/ad-watch-curve.md` with `.ai/rules/ad-watch-curve.md`.
- `marketing/ads/watch-curve.md` D234. After the no-3-second sentence, add: Meta also lists 3-second video plays in Ads Manager; that UI metric is not on our insights pull, so do not treat a 3-second rate as something we store.
- `marketing/ads/watch-curve.md` D235. Replace the "What to fix" section with: Law: curve-optimization (marketing/ads/curve-optimization.md) - where the curve dies and the fix for each: opening, middle, ask; a tap-through is a hop, not a failure; the purchase is the score.
- `marketing/ads/watch-curve.md` D236, call 41. Append to the Dying ping paragraph: The buzz goes out only inside the texting window (`texting-hours`, 6 a.m. to 10 p.m. Arizona). The text is one or two sentences: which ad, and that people are leaving before the quarter mark, so the opening has to change. If taps (link clicks or landing-page views) are at least as common as the people who reached 25%, that is a hop: do not buzz (`curve-optimization.md`, "A short watch is not always a failure"). `src/ad-videos/notify-fanout.mjs` is already in that paragraph.
- `marketing/ads/README.md` D228. Replace only "Ad id = leading digits of `utm_content`; titles optional." with: Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the leading digits of utm_content; titles are optional.
- `marketing/ads/WRITE-ADS-FROM-HERE.md` D229. Keep the heading. Replace the five `utm_content` bullets with: Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the leading digits of utm_content; titles are optional; only Chris names an ad.
- `marketing/ads/curve-optimization.md` D230. After D234 is in the watch-curve book, replace the definitions block with: Law: watch-curve (marketing/ads/watch-curve.md) - Meta's definitions of play, 2-second continuous play, 25/50/75/100%, ThruPlay and the second-by-second curve.
- `marketing/ads/RULES.md` call 44, wording inside the line only, do not renumber. Line 38 becomes "how much you qualify for based on where you're at right now" (`copy-certainty`, 2026-10-15). Line 42 drops "most likely" (`copy-certainty`). Line 659 becomes "write each ad's close fresh" (`ad-no-recycled-lines`, 2026-10-15).
- `marketing/ads/ASSET-BANK.md` line 321 becomes "write each ad's close fresh" (`ad-no-recycled-lines`, 2026-10-15).
- `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 70: "Funding Snapshot" is banned in sales copy (`outcome-first-copy`).
- `.agents/skills/fundhub-video-animation-overlay/SKILL.md` D62. Keep the loudnorm recipe. Replace the restated -14 sentences with: Law: ad-sound-level (.ai/rules/ad-sound-level.md) - every finished video is -14 LUFS with true peak at or under -1.5 dB; measure with ebur128=peak=true and write both numbers.
- Same skill, D63. Keep the heading. Replace the twelve bullets with three lines. Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - what Chris wants on screen: big, diagrams only, one in the first 10 seconds, on the word, never in front of his face. Law: animation-no-echo (.ai/rules/animation-no-echo.md) - anchors come from the script; labels are about 5 words, said a new way; never repeat his sentence. Law: animation-builders-opus-placers-sonnet (.ai/rules/animation-builders-opus-placers-sonnet.md) - a Sonnet placer never edits marketing/broll/src/; missing templates go in new-animations-needed.md.
- Same skill, D64. Replace the mode bullet with: Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - see-through clips run in overlay mode; only overlaps are forbidden; the 4 s gap, 3 s cap and 35% share are full-frame limits.
- Same skill, D65. Delete the "No overlap" bullet.
- Same skill, D66 and call 38. Keep the schedule fields and the face tool. Replace the face and caption sentences with: Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - words stay clear of the face box and the captions; only decoration goes behind him. Behind his head is fine.
- Same skill, line 49, call 38. The closing ask can carry a CTA only when it fits, and it is never big by default.
- Same skill, D67. Replace the script-facts bullet with: Law: animation-no-echo (.ai/rules/animation-no-echo.md) - props carry facts from the script in short new words; never his sentence copied. Keep the template list. Replace its last bullet with: Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - never invent a number, bank, name or claim; label sample-client numbers as a sample.
- Same skill, D68. Replace the ask-Chris line with: Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - if a rule settles the choice, make it, finish the work and say what you did.
- Same skill, line 28, call 39. Video files go in a scratch folder. Small files (the schedule, the plan, the notes) go in the repo.
- Same skill, line 107, call 40. On the Mac, use the whisper step from `fundhub-ad-editor`.
- `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` D56. Replace only the owner-set sentence with: Law: video-4k-unless-ad (.ai/rules/video-4k-unless-ad.md) - testimonial card videos on pages do not need 4K, so a 608x1080 card is not a defect. Keep "Never upscale. 608 wide is correct; stretching to 720 is not. Never call 1080p 4K."
- `docs/rules/RULES-INDEX.md` D209. Change the `ad-naming` row to: `ad-naming` (both homes): Drive ad file names are Offer, ad number, angle name, then take number; ads are found by id, not by name.
- `docs/rules/RULES-INDEX.md` D210. Change the overlay row to: `animation-overlay-on-spoken-words` (both homes): See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear.
- `docs/rules/RULES-INDEX.md` D211. Delete the `animation-ad-style` row.
- `CLAUDE.md` line 320. Retarget the ad-animation-style paragraph to `animation-overlay-on-spoken-words`. The two old paths do not exist.
- `AGENTS.md` line 61, call 34. Add: Testimonial card videos on pages do not need 4K (owner-set 2026-10-24).
- `docs/rules/TELEPROMPTER-VIDEO.md` D214. Change the path to `.ai/rules/teleprompter-camera.md`.
- `docs/rules/TELEPROMPTER-VIDEO.md` D215, call 34. Replace the size, 60 fps, and mirror sentences with: Law: teleprompter-camera (.ai/rules/teleprompter-camera.md) - every take is a hard 30 fps; ads 1080p, other videos 4K (testimonial card videos on pages excepted); front camera saved mirrored. Keep the saved-file sentence, the failed-quality sentence, and the upright-preview sentence.
- `docs/rules/TELEPROMPTER-VIDEO.md` D216. Fold in the acceptance checklist from AGENTS.md lines 59, 63, 65, and 67 before Phase 5 shortens AGENTS.md. The third bullet uses the locked mic labels "iPhone mic on" and "Rode on" (call 35). The last bullet is: Law: slo-one-filmed-folder (.ai/rules/slo-one-filmed-folder.md) - Direct Book recordings never go in the SLO folder.

## Skipped

- `copy-certainty`, `ad-no-recycled-lines`, and `outcome-first-copy` had no dedupe or stale edit. Call 44 changes the books, not these rules. The rules already say the winning law.
- `proof-cards-from-source`, `no-ssn-before-checkout-step-3`, `funding-sequence-term`, `ad-sound-level`, `teleprompter-speed`, `animation-no-echo`, `animation-logo-only-on-fundhub`, and `animation-builders-opus-placers-sonnet` had no edit in either plan. They stay the owners other files should point at.
- `teleprompter-camera` stale note M28. The hard 30 fps lock stays. Chris says when the iPhone app lifts it.
- Call 42. No change to numbered Part 0 in `marketing/ads/RULES.md`.
- Call 44 code. `marketing/ads/rules-data.mjs` lines 250 and 259 were left alone.
- `marketing/ads/SECOND-LINE.md` needed no new sentence. D74's list is already in that book.
- Stale row A13 archives `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md`. That file is not on this list.

## rules-drift-check

`node scripts/rules-drift-check.mjs` exited 1. The full run reported 17 problems. The only lines that name a file this agent owns are the two below. They are the handoff for CLAUDE.md line 320. The other 15 name files other agents archived or added.

```
  CLAUDE.md:320
    Names ".cursor/rules/animation-ad-style.mdc" but it does not exist.
    Fix: Fix the path to a real file, or remove the line if the rule is gone.
  CLAUDE.md:320
    Names ".claude/rules/animation-ad-style.md" but it does not exist.
    Fix: Fix the path to a real file, or remove the line if the rule is gone.
```
