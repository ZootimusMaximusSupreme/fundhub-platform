# Animation Rules (owner rules — Chris)

Source: `docs/specs/marketing-machine-2026-10-04.md` item 9 + §9.4 (order and pipeline), `ops/workflows/broll-v2-2026-10-02.md` (brand), `ops/workflows/animation-builds-2026-10-22.md` (kit), owner rules 2026-10-25 (anchors, frequency, matte, no full-frame). Machine rule file: `.ai/rules/animation-rules.md`. Where this file and the spec disagree on full-frame mode or animation count, **this file wins**.

## Code and pipeline (owner-set 2026-10-25)

This book and `animation-rules` are the law **now** for how animations should work.

The writer, validators, and live video pipeline may still match the older marketing-machine spec until the marketing system is **100% wired**. That is OK. **No rush** to change code or turn on overlay/matte jobs ahead of that milestone.

When an agent **plans or edits animations by hand** (Remotion kit, marked proofs, placement notes), follow this book.

When an agent **changes marketing machine code** (writer, `animation-plan.mjs`, `animations.mjs`, pipeline), align that code to this book in the **same change** as the feature that makes that path live — not as a side quest before the system is ready.

## 1. Order (owner rule, 2026-10-04)

Animation overlays always go on last: after the cut and after captions.

Pipeline: film → cut → Submagic captions → Chris downloads → animation overlays → finalize.

The master Submagic sees never has animations in it.

Captions: Submagic template "Hormozi 2" (Chris to double-check; "Hormozi 1" is the backup). Submagic AI B-roll stays off.

## 2. Never cover Chris (owner rule, 2026-10-25)

Animations never cover Chris's face, body or hair, and never cover the captions. There is no full-frame mode. Every animation is a see-through overlay.

Before placing animations, the AI tracks Chris's position in every frame of the Submagic export (a per-frame matte of his outline).

Animation size is at the AI's discretion and can be as large as the point needs, but no pixel of an animation may overlap Chris's matte on any frame. Check every frame, not once per clip.

Two placements:

- **Beside:** a see-through overlay in the open space around Chris (safe zones in section 8).
- **Behind:** the animation becomes the background and Chris is composited in front of it, e.g. Chris in front of a large Capital Blueprint dashboard showing how it works. Stack order: background animation → Chris (matte cutout) → captions.

Use Behind for big explanations (products, dashboards, processes, comparisons); use Beside for quick anchors.

## 3. What gets an animation (owner rule, 2026-10-25)

An anchor is a visual of an emotion, a contrast, or a list. Money gets less emphasis, but the payoff is always shown on screen.

**Products:** when the script explains a product (e.g. Capital Blueprint), show it working on screen (e.g. the dashboard). Showing how it works builds credibility beyond what's said.

**Credibility:** when the line is about credibility, show real proof, not AI-generated visuals. Examples: Chris's posts from 10 years ago, or the approvals spreadsheet with dates and details visible, bureaus and data points and client names blurred, bank names visible. A dollar total ($1M+ funded) does not show credibility; the approvals do.

Animations are the B-roll: diagrams and overlays for the financial and technical points. Chris's own B-roll from `DRIVE_BROLL_FOLDER_ID` is an option, off by default.

## 4. Anchor timing (owner rule, 2026-10-25)

The anchor word is the word that triggers the animation. The animation starts a split second **before** the anchor word begins (about **0.1 s early**), never after the word is said.

Anchor times come from the cut plan; Submagic leaves timing alone. If the Submagic export's **length** differs from the master by more than **0.1 s**, re-map anchors using Submagic's words (that 0.1 s is about export drift, not the lead-in).

If an anchor's line was cut, skip that animation and flag it.

## 5. Frequency (owner rule, 2026-10-25)

Replaces the 2026-10-04 rule "at least one animation, plus one for each number, step or comparison."

At least one animation every 10 seconds: about 6 in a 60-second ad, more or fewer when the content calls for it.

## 6. Length (owner rule, 2026-10-25)

A process, system or comparison stays on screen as long as the explanation takes. No length cap.

## 7. See-through renders (the only mode)

Every template renders see-through: no paper, no grid, no full-frame tint — only solid cards, words and objects with a soft shadow (clean PNG/sticker feel). Wrap each frame in `<SeeThrough>`, on by default.

Render with alpha: ProRes 4444 `.mov` or VP9 `.webm`. 30 fps.

Formats: vertical 1080×1920 (ads) and wide 3840×2160 (VSL and thank-you video, filmed sideways in 4K).

Overlay: ffmpeg lays each clip over the Submagic export at its anchor time, copies the audio, re-encodes video once.

Kit details: `marketing/broll/README.md`, `ops/workflows/animation-builds-2026-10-22.md`.

## 8. Safe zones

**Captions:** set `caption_position_y` so captions sit in a zone animations never draw in.

**Chris:** no animation overlaps his matte (section 2). The fixed zones below are the fallback when no matte exists yet.

**Vertical fallback:** every word inside y 269–1248. Only faint decoration in the top 14% (y < 269) or bottom 35% (y > 1248).

**Wide fallback:** all content in ONE side panel via `side` prop `'left' | 'right'` (default `'left'`). Left x 192–1500, right x 2340–3648, both y 108–1512. Nothing in the middle column (x 1500–2340) or the bottom 30% (y > 1512).

## 9. Brand

Accent #3D86F0, "fundhub." wordmark, spectrum dash, Inter. White page and faint grid apply only to non–see-through previews in the kit; overlays have no paper or grid.

3D means depth: perspective, tilted cards, layered shadows, parallax, rotation. Premium and clean, never busy.

Money visuals (bills, cash stacks, coins, counting dollars) are decoration and may run anywhere outside the face and caption zones.

## 10. Words and data

Only the script words named in the brief. Company name: **Fundhub**.

A dollar figure on screen comes only from the script line it sits on, the live page, the one /roadmap sample client, or a real approval PNG.

Never invent a number, lender name, face, client name or claim.

Certain words only: never "we think", "might", "maybe", "could", "likely".

Templates come from the catalog only; data-tied templates take no data props.
