---
description: See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear
alwaysApply: true
---

# Animations land on the spoken words

**Owner law (2026-10-23):** Chris: "Get the transcript to find those anchor words, then readjust." Animations go on a finished video last, and each one appears when the words it shows are spoken. Skill: `.agents/skills/fundhub-video-animation-overlay/SKILL.md`. Master law and book: `.ai/rules/animation-rules.md`, `marketing/ads/ANIMATION-RULES.md` (owner-set 2026-10-25 wins on frequency, no full-frame, matte, and anchor types).

## Always

- Find the real word times first (transcript, or the burned-in captions). Never use the plan's even-pace starts as if they were real.
- Start each clip so its payoff lands on its words. Stretch a clip when the speech runs longer, including a clip that rides the whole idea (owner law 2026-10-23).
- See-through clips run in overlay mode: no overlaps, and nothing else. (In `src/ad-videos/animations.mjs` these limits belong to `fullframe` mode only.) The 4 s gap, 3 s cap and 35% share are full-frame rules.
- Cut him out (`--behind`) so animations can sit behind him. Behind his head is fine, even across the whole screen; his cut-out stays on top. Never in front of his face or head, hair included (owner-set 2026-10-24; Chris: "It should never go over my face."). Beside him, or over his chest above the captions, is fine. Vary side, height and tuck from clip to clip. Words stay clear of the face box and the captions; only decoration goes behind him. Never hide the start or end of a line.
- Use the script's facts, never his sentence copied (see animation-no-echo, owner-set 2026-10-24). Label sample-client numbers as a sample. Never invent a number, bank, name or claim.
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

- Big: the words box is 70 to 90 percent of the frame width. 42 percent was "so small."
- One animation inside the first 10 seconds, on the hook.
- Each card pops in on the exact word he says it. No fixed stagger.
- The closing ask can carry a CTA animation, but not every ad needs one, and it is never big by default (owner-set 2026-10-24: "we don't need a massive CTA all the time"). A closing diagram can hold to the end instead.
- Animations can be long and ride the whole idea.
- Never over the captions.
- Chris picks the trigger words (owner-set 2026-10-24): send him the numbered trigger list first, he changes it, then Sonnet places.
- Diagrams only, on all of them. Start from the video's entry in `marketing/ads/animation-plans/2026-10-22.json` (skill step 1).
- Never: numbered word lists ('01 02 03' card lists such as PathCards or StepPath) or text-only plates; they were rejected on Ads 11 and 14. Never CompanyLine (text over art) at small size; it was unreadable.
- 'Run the skills' on a downloaded Submagic ad means add animations only: no cuts and no sound clean-up, except the -14 level reset (`ad-sound-level`).
