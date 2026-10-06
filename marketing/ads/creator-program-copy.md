# Creator program — copy and payout

Owner: Chris. Written 2026-09-13. Branch `claude/creator-incentive-program-6s4371`.

The deal in one line: you get every FundHub offer free, you post about it, you get paid on every
funded deal your content brings in.

Tracking already exists: each creator gets an ad id and `utm_content=<id>`. Attribution is
`fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql`. No new code needed to pay them.

---

## Payout (starting numbers — Chris changes these)

Benchmark: Josh Snow's creator playbook (free product seeded to creators, then paid on
attributed sales, no upfront fee). UGC / affiliate contracts on high-ticket services run 10–20% of
collected revenue, tiered up for volume. Public sources do not publish his exact rate, so the
numbers below are the industry band, not a quote.

| Tier | Funded deals in a month (their id) | Cut of what FundHub collects |
|---|---|---|
| Starter | 1–2 | 15% |
| Core | 3–5 | 20% |
| Top | 6+ | 25% |

Rules:
- Paid only on **collected** revenue, integer cents, after refunds clear. Never on gross.
- Attribution window: 60 days from first click to funded deal.
- Paid monthly on the 15th for the prior month.
- Their free access is the retainer. No cash upfront.
- Content minimum to stay in: 4 posts a month tagged with their link.

Example: their content brings in 3 funded deals, FundHub collects $18,000 → 20% → $3,600.

---

## Story copy (the post in the screenshot, tightened)

**Slide 1**
Looking for entrepreneurs who want to be part of a select group where I give away all my offers
for free.

**Slide 2**
Here's the deal. You get everything I sell. Free. You post about what it does for you. Every
funded deal that comes from your post, you get a cut.

**Slide 3**
No fee. No course. No "buy in." You make content, I pay you when it closes.

**Slide 4 (CTA)**
Reply "IN" and I'll send the terms.

---

## DM reply (when they say "IN")

Hey — here's how it works.

You get free access to every FundHub offer. You post about it, your way, at least 4 times a month.
You get your own link. Every funded deal that comes through your link, you get 15% of what we
collect. Hit 3 deals in a month and it goes to 20%. Six and it's 25%.

Paid on the 15th for the month before. No upfront money either direction.

Want your link?

---

## Short caption (feed post)

I'm giving all my offers away free to a small group of entrepreneurs.

The catch: you post about it, and when your post brings in a deal, you get paid.

No fee. No pitch. Reply "IN."

---

## What not to say (from `marketing/ads/RULES.md`)
- No credit-outcome promises. Never "fix your credit," "guaranteed approval."
- No income claims for the creator beyond the table above.
- No "passive income."
