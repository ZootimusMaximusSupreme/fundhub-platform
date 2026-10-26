# Animation Rules (owner rules — Chris)

Source: `docs/specs/marketing-machine-2026-10-04.md` item 9 + §9.4 (order and pipeline), `ops/workflows/broll-v2-2026-10-02.md` (brand), `ops/workflows/animation-builds-2026-10-22.md` (kit), owner rules 2026-10-25 (anchors, frequency, matte, no full-frame). Machine rule file: `.ai/rules/animation-rules.md`. Where this file and the spec disagree on full-frame mode, animation count, or placement, **this file wins**.

## Code and pipeline (owner-set 2026-10-25)

This book and `animation-rules` are the law **now** for how animations should work.

The writer, validators, and live video pipeline may still match the older marketing-machine spec until the marketing system is **100% wired**. That is OK. **No rush** to change code or turn on overlay/matte jobs ahead of that milestone.

When an agent **plans or edits animations by hand** (Remotion kit, marked proofs, placement notes), follow this book.

When an agent **changes marketing machine code** (writer, `animation-plan.mjs`, `animations.mjs`, pipeline), align that code to this book in the **same change** as the feature that makes that path live — not as a side quest before the system is ready.

## 1. Order (owner rule, 2026-10-04)

Animation overlays always go on last: after the cut and after captions.

Pipeline: film → cut → Submagic captions → Chris downloads → animation overlays → finalize.

The master Submagic sees never has animations in it.

**Replacement source lock (owner-set 2026-10-26):** Every overlay revision starts from the exact clean, captioned, post-Submagic/pre-animation export — never from an earlier animated export. A visual reviewer registers that source in the plan folder's `clean-source.json`; its SHA-256 locks the exact bytes. The protected build checks that hash before lay-on, makes one new animated output, and records that output globally so it can never be registered as a later source. The new output replaces the old animated deliverable; the clean source is never overwritten.

Captions: Submagic template "Hormozi 2" (Chris to double-check; "Hormozi 1" is the backup). Submagic AI B-roll stays off.

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

**Handoff (owner law 2026-10-25):** After overlays and audio finalize, **view frames from the final mux** (clip start/mid/end, anchors, spot intervals) before calling the video acceptable. Law: `.ai/rules/animation-overlay-frame-review.md`. Validators and `schedule.json` are not enough. Judge the frames against this section, including the top one-third for a long visual and readable words.

## 3. What gets an animation (owner rule, 2026-10-25)

An anchor is a visual of an emotion, a contrast, or a list. Money gets less emphasis, but the payoff is always shown on screen.

**Products:** when the script explains a product (e.g. Capital Blueprint), show it working on screen (e.g. the dashboard). Showing how it works builds credibility beyond what's said. Law: ad-know-the-offer (`.ai/rules/ad-know-the-offer.md`) — read the offer first. The pictures show the product steps, not only the last sentence.

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

Overlay: use `node scripts/animation-clean-source.mjs build --plan <plan-dir> --source <clean-post-submagic.mp4> --out <new-animated.mp4> -- python3 tools/build-from-schedule.py ...`. It hash-checks the registered clean source, runs the schedule gate, lays each clip over the Submagic export at its anchor time, copies the audio, re-encodes video once, and records the animated output. Direct `build-from-schedule.py` is blocked.

Kit details: `marketing/broll/README.md`, `ops/workflows/animation-builds-2026-10-22.md`.

## 8. Safe zones

**Captions:** set `caption_position_y` so captions sit in a zone animations never draw in.

**Chris:** section 2 wins. A slight overlap behind the head is allowed only for decoration. The face stays clear except that overlap. Every key item stays at least 85% visible in the worst sampled frames. The shirt is a bad spot when captions are there. The fixed zones below are the fallback for a short visual when you are still reading the frame.

**Vertical fallback for a short visual:** words in the open left, right, or top, inside y 269–1248 when that band is actually open. The top one-third (about y 0–640 on 1080×1920) is the only home for a long visual, including a full-width overlay. It is not a faint-decoration strip. The bottom caption area (y > 1248) stays clear.

**Wide fallback:** a long visual still goes in the top one-third and may be full width there. A shorter visual uses one side panel via `side` prop `'left' | 'right'` (default `'left'`). Left x 192–1500, right x 2340–3648, both y 108–1512, when that panel is actually open. Do not park the point in the middle of his head. The bottom 30% (y > 1512) stays clear of captions.

## 9. Brand

Accent #3D86F0, spectrum dash, Inter. Never add a Fundhub wordmark or logo to an animation card or preview. White cards hug the text and diagram with only readable padding; overlays have no paper or grid.

3D means depth: perspective, tilted cards, layered shadows, parallax, rotation. Premium and clean, never busy.

Money visuals (bills, cash stacks, coins, counting dollars) are decoration. Section 2 still picks the spot. They stay off the captions. Do not park the point in his hair. The shirt is a bad spot when captions are there.

## 10. Words and data

Only the script words named in the brief. Company name: **Fundhub**.

A dollar figure on screen comes only from the script line it sits on, the live page, the one /roadmap sample client, or a real approval PNG.

Never invent a number, lender name, face, client name or claim.

Certain words only: never "we think", "might", "maybe", "could", "likely".

Templates come from the catalog only; data-tied templates take no data props.
