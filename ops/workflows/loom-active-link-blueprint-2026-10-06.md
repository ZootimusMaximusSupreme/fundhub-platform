# Loom blueprint — affiliate link vs $297 roadmap (2026-10-06)

**Loom:** https://www.loom.com/share/3a39e89b0f7743ddb21bd0fbc82a16b6  
**Title:** Choosing the Correct Active Link  
**Speaker:** David Ramirez  
**Status:** Chris pasted the Claude prompt 2026-10-06; implementation waits on **A / B / C** below.

## Transcript

> Okay, so, this link here, if I go like that, just so you can see, it goes here, and then this is what it displays, right?  
> That's what this shows here, but then the text message you sent me, the 297, opens up to this, right? So, I don't know what link to use, or which one's active.  
> Uhm, yeah.

## Problem

| Source | URL | Lands on |
|--------|-----|----------|
| Affiliate desk | `fundhub.ai/start.html?ref=…` | `apply.fundhub.ai/watch` (VSL / sorting) |
| Chris “297” text / Loom CTA | `apply.fundhub.ai/roadmap?a1=…` | `apply.fundhub.ai/roadmap` |

Dashboard and SMS disagree. David does not know which link to share.

## Chris picks one before code

- **A** — One share link → roadmap with `a1` + `ref`
- **B** — Two links on affiliate desk (watch + roadmap)
- **C** — Change 297 SMS to match watch-only dashboard link

## Claude Code paste block

```text
Loom: https://www.loom.com/share/3a39e89b0f7743ddb21bd0fbc82a16b6
Problem: Affiliate desk link (fundhub.ai/start.html?ref=…) sends buyers to apply.fundhub.ai/watch; Chris’s “297” text sends to apply.fundhub.ai/roadmap. David Ramirez does not know which link is active.

Wait for Chris: A = one share link → roadmap with a1+ref, B = two links on affiliate.html (watch + roadmap), C = change 297 SMS to match watch-only.

Read: src/affiliates/share-link.mjs, public/start.html, public/app/affiliate.html, api/read/affiliate-portal.mjs, src/affiliates/drip.mjs, src/http/start-html.test.mjs, src/http/affiliate-referral.pg.test.mjs.

Implement chosen option. Smallest diff. Prove both URLs after fix. npm test. Ship if on main.
```

## Key repo files

- `src/affiliates/share-link.mjs` — `shareUrlFor` → `/start.html?ref=`
- `public/start.html` — bounce to `/watch` with `a1` + `ref`
- `src/affiliates/drip.mjs` — email uses `/start?ref=` (third variant)
- `src/affiliates/economics.mjs` — roadmap commission = paid `slo_*` link
