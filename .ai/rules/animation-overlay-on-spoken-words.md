---
description: See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear
alwaysApply: true
---

# Animations land on the spoken words

**Owner law (2026-10-23):** Chris: "Get the transcript to find those anchor words, then readjust." Animations go on a finished video last, and each one appears when the words it shows are spoken. Skill: `.agents/skills/fundhub-video-animation-overlay/SKILL.md`. Master law and book: `.ai/rules/animation-rules.md`, `marketing/ads/ANIMATION-RULES.md` (owner-set 2026-10-25 wins on frequency, no full-frame, placement, frame layout scan, and anchor types).

## Always

- Find the real word times first (transcript, or the burned-in captions). Never use the plan's even-pace starts as if they were real.
- Start each clip so its payoff lands on its words. Stretch a clip when the speech runs longer, including a clip that rides the whole idea (owner law 2026-10-23).
- See-through clips run in overlay mode: no overlaps, and nothing else. (In `src/ad-videos/animations.mjs` these limits belong to `fullframe` mode only.) The 4 s gap, 3 s cap and 35% share are full-frame rules.
- Law: animation-rules (.ai/rules/animation-rules.md) section 2, owner law 2026-10-25. The space goes left, right, or top. A big long visual that is a multi-step explanation must go in the top one-third. If it is long, put it in the top one-third. Shorter visuals go left, right, or top, or wherever his head is not. You can go slightly behind his head for authenticity, but only slightly. The words stay readable. Do not park the point in his hair. If there is space, the visual can blast into the bottom two-thirds, or into the top one-third plus the second third where his shoulders are, so it becomes a huge screen. If his head is not that big, the sizes change. It is not black and white. Read the frame. Head size and position vary. Discern. The face stays clear except that slight overlap. Captions stay clear. The shirt is a bad spot when captions are there. An animation is never unreadable.
- Cut him out (`--behind`) only when a graphic needs that slight overlap. His cut-out stays on top. Never in front of his face (owner-set 2026-10-24; Chris: "It should never go over my face."). Never hide the start or end of a line. A card sitting in his hair is not a normal spot.
- Use the script's facts, never his sentence copied (see animation-no-echo, owner-set 2026-10-24). Law: ad-know-the-offer (.ai/rules/ad-know-the-offer.md) - read the offer first. The pictures show the product steps, not only the last sentence. Label sample-client numbers as a sample. Never invent a number, bank, name or claim.
- Test copy first. The original video is never changed. Video files go in a scratch folder. Small files (the schedule, the plan, the notes) go in the repo.

## Never

- Drop animations for a limit without checking which mode it belongs to.
- Ask Chris to approve a choice this rule settles.

## Example

```text
He says "you pay $32, and there's no impact on your score" at 12.9 to 15.4 s.

❌ Start the clip at the anchor's first word (10.8 s) and show "No impact" at 12.5 s.
✅ The strip shows "No impact" 1.7 s into the clip, so start at 12.7 s.
```

## Style Chris asked for (owner law 2026-10-23, Direct Book Ad 11)

- Big: a shorter visual's words box is 70 to 90 percent of the open band. 42 percent was "so small." A long multi-step visual goes in the top one-third and may be full width there (section 2 of `animation-rules`).
- One animation inside the first 10 seconds, on the hook.
- Each card pops in on the exact word he says it. No fixed stagger.
- The closing ask can carry a CTA animation, but not every ad needs one, and it is never big by default (owner-set 2026-10-24: "we don't need a massive CTA all the time"). A closing diagram can hold to the end instead.
- Animations can be long and ride the whole idea.
- Never over the captions.
- Chris picks the trigger words (owner-set 2026-10-24): send him the numbered trigger list first, he changes it, then Sonnet places.
- Diagrams only, on all of them. Start from the video's entry in `marketing/ads/animation-plans/2026-10-22.json` (skill step 1).
- Never: numbered word lists ('01 02 03' card lists such as PathCards or StepPath) or text-only plates; they were rejected on Ads 11 and 14. Never CompanyLine (text over art) at small size; it was unreadable.
- 'Run the skills' on a downloaded Submagic ad means add animations only: no cuts and no pre-Submagic-style clean-up. Law: ad-sound-level (.ai/rules/ad-sound-level.md) - after Submagic and again after overlay finalize, recheck audio, smooth voice level and tone, then -14 LUFS.
