# UX guidance — the reply is the URL

**Owner law (2026-09-21):** When Chris asks where to go, or asks for a link, the reply is the direct URL. That is the whole answer for that ask.

**Owner law (2026-08-24), corrected same day:** Two modes. Do not mix them.

Applies to Meta Business Suite, Facebook developers, Google Ads, Netlify, fundhub.ai CRM, ClickFunnels, and any other dashboard.

## Default — he did **not** ask for a walkthrough

He needs to know **where to go**. The reply is the direct URL, with known IDs filled in.

1. The reply for that ask is the deep link. Do not add a click path, a menu, or “then go to.”
2. Fill in known IDs (`business_id`, account IDs, Netlify site/team, etc.). Read repo docs, `.env`, or prior context — do not invent IDs.
3. Do **not** only say “Settings → X → Y” with no link.

## Walkthrough — he asked for walkthrough / “3 steps at a time” / click-path coaching

These **are** button-by-button click instructions on the UI. That is correct.

1. A URL may open the **starting** page of the batch.
2. The walkthrough itself is **individual clicks** — do not replace those steps with “just open this URL and you’re done.”
3. Still obey `one-step-adhd`: one next action, then stop.

## Which mode

| Chris said… | Mode |
|---|---|
| “Where do I find X?”, “give me the link”, “open …” | **Default** — the reply is the URL |
| “walk me through”, “3 steps at a time”, click-path coaching | **Walkthrough** — clicks; URL only for start screen |

## Examples

```text
DEFAULT (where to go):
❌ “In Meta Business Suite go to Settings → Business assets → Apps.”
❌ A URL plus “then click Developer Portal.”
✅ https://business.facebook.com/settings/…?business_id=<known>

WALKTHROUGH (he asked for steps):
❌ “Open https://…/settings and you’re done.”
✅ “Open https://…/settings (start).
    Click Apps.”
   (then stop; next click only after he replies)
```
