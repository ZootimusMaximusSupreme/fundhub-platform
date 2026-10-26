---
description: Fundhub ad and VSL animation overlays — order, matte, timing, frequency, see-through only
alwaysApply: true
---

# Animation rules

**Owner law (2026-10-25):** See-through overlays only. Overlays go on last, after the cut and after Submagic captions. Where a clip sits is section 2. Full book: `marketing/ads/ANIMATION-RULES.md`. Where this law and `docs/specs/marketing-machine-2026-10-04.md` §9.4 disagree on full-frame mode, animation count, or placement, **this law wins**.

**Code (owner-set 2026-10-25):** This rule is law now. Writer, validators, and pipeline code may lag until the marketing system is 100% wired — no rush. Hand-built animation work follows this rule today. Code catches up in the same change when that path goes live.

Placing clips on a finished export also follows `animation-overlay-on-spoken-words`, `animation-no-echo`, `animation-logo-only-on-fundhub`, and `animation-builders-opus-placers-sonnet` unless this rule says otherwise.

## 1. Order (2026-10-04)

Animation overlays always go on last: after the cut and after captions.

Pipeline: film → cut → Submagic captions → Chris downloads → animation overlays → finalize.

The master Submagic sees never has animations in it.

**Replacement source lock (owner-set 2026-10-26):** Start every revision from the exact clean post-Submagic/pre-animation export, never an older animated export. A reviewer must first register the source in `clean-source.json` with `node scripts/animation-clean-source.mjs register --plan <plan-dir> --source <clean.mp4> --verified-clean`. The protected build hash-checks it, records each animated output, and rejects any recorded output as a future source. Build a new overlay once from that clean source, then replace the old animated deliverable; never overwrite the clean source or stack overlays.

Captions: Submagic template "Hormozi 2" ("Hormozi 1" is the backup). Submagic AI B-roll stays off.

## 2. Where the overlay sits (owner law 2026-10-25)

The space goes left, right, or top.

A big long visual that is a multi-step explanation must go in the top one-third. That is the rule. If it is long, put it in the top one-third.

Shorter visuals go left, right, or top, or wherever his head is not.

You can go slightly behind his head for authenticity, but only slightly. The words stay readable. Do not park the point in his hair.

Large diagrams stay in the top one-third only. They do not spill into the middle or lower two-thirds.

If his head is not that big, the sizes change. It is not black and white. Read the frame. Head size and position vary. Discern.

Also still true: the face stays clear except that slight overlap. Captions stay clear. The shirt is a bad spot when captions are there. An animation is never unreadable.

**On the screen (owner law 2026-10-25):** Every animation overlay must sit fully inside the video frame. Ads are 1080×1920. The readable part cannot be clipped off the left, right, top, or bottom. A bad x, y, or scale that leaves a black void or shoves the graphic off the screen fails the check. Do not ship it.

There is no full-frame mode that covers him. Every animation is a see-through overlay.

**Frame layout scan (owner law 2026-10-25):** Read every frame of the Submagic export. Head size and head position change from frame to frame. On every frame the overlay system knows:

- **Chris:** head, hair, shoulders, and chest (per-frame matte / person outline)
- **Caption band:** burned-in letters from Submagic (e.g. Hormozi lines, UnderwriteIQ-style lower-thirds), including where each line sits and how it moves frame to frame
- **On-screen layout:** anything else that claims pixels (safe bands, side panels, prior overlays, decoration)

Use that read to place the clip:

- **Top:** the top one-third. A long multi-step explanation goes here. The overlay may be full width inside that band.
- **Left or right:** a shorter visual, in the open side, or wherever his head is not.
- **Large diagram:** the top one-third only. It may be full width in that band, but its key content never spills below it.
- **Slight overlap:** decorative pixels may sit behind the head. Every key thing the viewer must understand—headline, amount, card, chart, proof, or step—must stay at least 85% visible in the worst sampled frames. If the head moves into a key item, move the graphic.

Re-check every frame while the clip runs. He can lean. Captions can shift. A spot that works on one frame can fail on the next.

When a graphic sits slightly behind the head, his cut-out stays on top and the captions stay last. Do not cover the caption band. Do not put the visual on the shirt when the captions are there. Do not shrink a long visual into a tiny chip.

**Face:** clear on every frame, except that slight overlap behind the head.

## 3. What gets an animation (2026-10-25)

An anchor is a visual of an emotion, a contrast, or a list. Money gets less emphasis; the payoff is always shown on screen.

**Products:** show the product working on screen when the script explains it (e.g. Capital Blueprint dashboard). Law: ad-know-the-offer (.ai/rules/ad-know-the-offer.md) - read the offer first. The pictures show the product steps, not only the last sentence. A long Capital Blueprint explanation may fill the background behind Chris's head-and-shoulders cut-out. Keep the dashboard's real look, redact irrelevant rows and dates, and show only the actions he is saying in that ad's order. Never add a “Sample File” badge.

**Credibility:** real proof only — not AI-generated visuals. Examples: Chris's posts from 10 years ago; approvals spreadsheet with dates visible, PII blurred, bank names visible. A dollar total ($1M+ funded) does not show credibility; the approvals do.

Diagrams and overlays for financial and technical points. Chris's B-roll from `DRIVE_BROLL_FOLDER_ID` is optional, off by default.

## 4. Anchor timing (2026-10-25)

The animation starts about **0.1 s before** the anchor word begins, never after the word is said.

Anchor times come from the cut plan. If the Submagic export **length** differs from the master by more than **0.1 s**, re-map anchors using Submagic's words (export drift — not the lead-in).

If an anchor's line was cut, skip that animation and flag it.

## 5. Frequency (2026-10-25)

Replaces "at least one animation, plus one per number, step or comparison."

At least one animation every 10 seconds (~6 in a 60-second ad), more or fewer when the content calls for it.

## 6. Length (2026-10-25)

A process, system or comparison stays on screen as long as the explanation takes. No length cap.

## 7. See-through renders (only mode)

No paper, no grid, no full-frame tint — solid cards, words and objects with soft shadow. `<SeeThrough>` on by default. Alpha: ProRes 4444 `.mov` or VP9 `.webm`. 30 fps. Vertical 1080×1920 (ads); wide 3840×2160 (VSL and thank-you, filmed sideways in 4K). ffmpeg overlays on the Submagic export at anchor time; copy audio; one video re-encode.

## 8. Safe zones

Set `caption_position_y` so captions sit where overlays never draw.

Section 2 wins on placement. A long visual belongs in the top one-third, and that band may hold a full-width overlay. A slight overlap behind the head is allowed only for decoration; the key point stays at least 85% visible in the worst sampled frames.

Fallback when the visual is short: vertical words in the open left, right, or top, inside y 269–1248 when that band is actually open. On a wide frame, one side panel (`side` left|right), left x 192–1500, right x 2340–3648, y 108–1512. Do not park the point in the middle of his head. The bottom caption band stays clear.

## 9. Brand and words

Accent #3D86F0, spectrum dash, Inter. Never put a Fundhub logo or wordmark on an animation card or preview; cards hug their text and diagram with only readable padding. 3D depth: premium and clean, never busy. Money decoration follows section 2. **Fundhub** only. Dollar figures only from script, live page, /roadmap sample, or real approval PNG. Never invent numbers, names, or claims. No "we think", "might", "maybe", "could", "likely". Catalog templates only; data-tied templates take no data props.

## Never

- Plan, place, or build animations from memory without reading this rule and `marketing/ads/ANIMATION-RULES.md` in this session
- Full-frame animations or `animation_mode='fullframe'` on shipped ads
- Cover the caption band on any frame
- Cover Chris's face, except the slight overlap behind the head in section 2
- Park the point of an animation in his hair
- Put the visual on the shirt when captions are there
- Shrink a long visual out of the top one-third into an unreadable chip
- Put animations on the master before Submagic captions
- Use an older animated export as a source, bypass `animation-clean-source.mjs`, or overwrite the registered clean source
- Turn on Submagic AI B-roll
- AI-generated credibility visuals when the line asks for proof
- Call an overlaid ad or VSL acceptable without a frame review on the final mux (law: animation-overlay-frame-review (.ai/rules/animation-overlay-frame-review.md))
- Ship an overlay that hangs off the frame, or a clip that is not the full picture and leaves a black empty side

## Always

- Cut → Submagic captions → download → overlays → finalize
- Register the visually checked clean source, then use `animation-clean-source.mjs build` for every lay-on
- Read the frame. A long multi-step visual goes in the top one-third. A shorter visual goes left, right, or top, wherever his head is not. Head size and position vary.
- Keep the whole graphic inside the picture. On an ad the picture is 1080×1920. The schedule check fails if x, y, or scale shoves it off the screen or leaves a black empty side.
- Frame layout scan (head, hair, shoulders, chest, caption band, on-screen layout) on every frame before and during each clip
- After finalize, frame-review the final mux and save evidence before handoff (law: animation-overlay-frame-review (.ai/rules/animation-overlay-frame-review.md))
- Real proof for credibility lines (spreadsheet, posts, approval PNGs with PII blurred)

## Example

```text
Ask: "Place animations on Ad 12 after Submagic."

❌ Park a long dashboard in his hair, or shrink it into a tiny chip beside his head.
✅ A long multi-step dashboard sits in the top one-third, words readable. A short visual goes left, right, or top, where the head is not. A slight overlap behind the head is fine only when every key part stays at least 85% visible. Read the head on that frame.
```
