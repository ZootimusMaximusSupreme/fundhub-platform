---
description: Copybot and Visual Thinking are the foundation of all Fundhub marketing. Copybot builds the words, Visual Thinking picks the picture, Fundhub rules own the facts.
alwaysApply: true
---

# Copy skills are the foundation

**Owner law (2026-10-31):** Chris: "Moving forward, we want to use these skills as the foundation of our marketing." Two skills a friend shared with him are now how Fundhub makes marketing: **Copybot** builds the words and **Visual Thinking** picks the picture. They cover ads, VSLs, emails, texts, push lines, slideshows and pages.

## Always

- Load Copybot for any marketing words. Load Visual Thinking for any slideshow, diagram, slide or sales picture. Both live in `marketing/copy-skills/` (`copybot/SKILL.md`, `visual-thinking/SKILL.md`) until they move into `.agents/skills/`.
- Copybot writes in Chris's voice: it reads `marketing/copy-skills/copybot/references/owner-voice.md` first. Never the friend's voice.
- Fundhub's rules still own the facts, the banned words and certainty. The list is in `marketing/copy-skills/copybot/references/voice-and-quality.md`. Law: ad-know-the-offer (.ai/rules/ad-know-the-offer.md) - read the offer first.
- Ad scripts still go through the `fundhub-ad-writer` checker before Chris sees them. The ad writer writes the Copybot way.
- One idea per piece. Every big claim has its support right next to it, or it gets smaller, or it goes.
- Law: show-real-proof (.ai/rules/show-real-proof.md) - show the real thing whenever we have it, or merge it with a little diagram; the picture and the words prove each other (owner-set 2026-10-31).
- Double-check every piece before Chris sees it or it ships (owner-set 2026-10-31). A separate agent that did not write the copy runs `marketing/copy-skills/copy-reviewer/SKILL.md`: the parrot check (`node scripts/copy/recycled-lines.mjs`, no line copied from Chris's ads, VSLs, call scripts or another piece), the persuasion read (every slide explains the process, why it matters to the viewer, and how it changes their life), and Chris's never list. Chris: "so it's not sounding like a parrot to my marketing angles."

## Never

- Invent a number, a client, a result, a quote, a price or a guarantee to fill a Copybot or Visual Thinking slot.
- Say a draft will sell better. Say it is clearer or better supported until a test shows more.
- Soften or delete an owner law to fit a skill. Where a skill and an owner law disagree, the owner law wins.

## Example

```text
Ask: "Write the pre-underwriting slideshow."

❌ Pick a template, add "DOUBLE your approvals", ship it.
✅ Visual Thinking picks a "how" picture (the bank's reasons, then we read them first, then the right banks).
   Copybot writes one idea per slide in Chris's voice from owner-voice.md. Every fact traces to the offer or his saved words.
```
