# Sneak peeks for the SLO sales page

Chris pastes this whole file into a Claude chat. Claude designs **thumbnails on the actual sales page** so a buyer sees the pack before they hit checkout.

Do **not** use Anthropic/Claude from Cursor. This file is the paste.

This is **not** a wall of PDFs. Not a live client file. Not PII.

**COMPLIANCE:** sample / blurred pages only. Fake name like “Alex Sample.” Fake scores if you must show a cover (never as “this is what you will get”). No “your score will go up.” No “a bank will give you $X.” No “this item will come off.” Six rounds = what they **get**, not what it achieves.

---

## Where it goes

File: `clickfunnels-fragments/slo/slo-01-sales.html`

**Section 4 — What You Get** (kicker `What You Get`, heading `6 Assets. Your Data. 60 Seconds. Yours Forever.`).

Place the peeks:

1. **After** the six text rows (`.srow` 01–06)
2. **Before** the Value Anchor card and the Guarantee card
3. **Before** the CTA `Get My Funding Blueprint — $297`

There is a hole marked in the HTML:

```
SLOT-SNEAK-PEEKS
```

Checkout itself (`slo-02-order.html`) stays a short list + native form. Peeks live on the **sales** page so they see the product **before** `/order`.

Do **not** restyle the CRM (`public/app/*`). Do **not** mint Commas products. Match the existing SLO look (Inter, JetBrains Mono, paper background, same cards).

---

## How to show a peek (all files)

For each item:

- **Thumbnail** of the real cover (or a faithful sample cover), like a paper stack / tilted PDF, ~160–220px tall on desktop.
- **One line** under it: what the buyer is looking at (sold name + one sentence).
- Optional: **one blurred inner page** (utilization table, lender cards, letter body with names/account numbers unreadable).
- Click can open a lightbox of **that one sample page**, not a 40-page scroll.
- Watermark: `SAMPLE` on every image.
- Never dump the full live pack. Never show a real SSN, real address, real account number, real applicant name from production.

Cover block the four reports actually print (from the printer in `src/underwrite/black-report-node.mjs`):

- Black page, **fundhub.** wordmark
- Kicker on the document: `UNDERWRITE IQ / CLIENT DELIVERABLE` (it is on the PDF; do not sell that kicker as a second product)
- Doctype line (sold-name wording)
- Inner title (large; **do not sell the inner title as a second SKU**)
- Footer row: applicant · date · outcome · median score
- Footer: `FUNDHUB CONFIDENTIAL`

Use a sample applicant (`Alex Sample`). If you show a median score on a sample cover, label it sample. Ads still may not promise that number.

---

## The 11 pack files (from code)

`$297` delivers the UnderwriteIQ / SLO pack (`src/slo/deliver.mjs` builds the same funding pack as the closer deck).

**Four analysis PDFs** (always, `src/underwrite/letter-pack-filter.mjs`):

| # | Sold name (use this on the page) | File in code | Inner title (on the cover, not a second product) | One line the buyer reads | Peek |
|---|---|---|---|---|---|
| 1 | **Credit Analysis Report** | `Credit-Analysis-Report.pdf` | Financial Profile Assessment | Your three-bureau file: scores, cards, negatives, inquiries, identity mismatches. | Cover + maybe a blurred bureau/score page. |
| 2 | **Credit Optimization Roadmap** | `Credit-Optimization-Roadmap.pdf` | `{First}'s 6-Month Business Readiness Roadmap` | Month-by-month on **this** file: paydowns, which letters, when to form an LLC. Product name only. Never “optimize” as a verb. | Cover + blurred month strip. |
| 3 | **Funding Snapshot** | `Funding-Snapshot.pdf` | Capital Readiness Snapshot | What the file supports today, after the paydown work, and the gap. Estimates, not a bank check. | Cover + blurred today / after table. |
| 4 | **Bank & Lender Match List** | `Bank-Lender-Match-List.pdf` | Capital Partner Shortlist | Named lenders. Some fit now. Some need a business entity first. Order to apply. | Cover + blurred “available now” cards. **No fake bank logos you don’t have rights to.** Use generic cards or real names only if the sample file already printed them. |

**Seven letter-pack pieces** (from `src/metro2/diy/package.mjs` + `docs/ads/slo-297-prompt-2026-09-18.md`). Sold together as **Dispute Letter Pack**. Show as a **folder stack**, not 20 letter PDFs:

| # | Folder / file in code | One line the buyer reads | Peek |
|---|---|---|---|
| 5 | `01-START-HERE-instructions` | How to mail: certified, one envelope per bureau, sign in ink, wait the clock. | Cover sheet thumbnail. No live address. |
| 6 | `02-decision-tree` | If they deleted everything, stop. If they verified, send the next round. | The tree as a simple graphic, sample wording. |
| 7 | `03-round-1` (dated) | Round 1 letters, already written, ready to mail. | One blurred bureau letter (header + first paragraph only). Names/accounts unreadable. |
| 8 | `04-round-2-CONDITIONAL` | Round 2: they send **only if** Round 1 came back verified / no method. Asks **how** the bureau checked. | Cover sheet that says SEND ONLY IF. Not a full letter. |
| 9 | `05-round-3-CONDITIONAL` | Round 3: later notice. Still conditional. | Same: cover, not the whole PDF. |
| 10 | `06-complaints-CONDITIONAL` | CFPB + state attorney general forms. Cover says **do not file with Round 1**. They sign the declaration. | The warning cover (`DO NOT FILE WITH ROUND 1`). Not the sworn pages filled in. |
| 11 | `08-round-tracker` | Blank tracker: round, bureau, date mailed, certified #, outcome. | Empty table thumbnail. |

That is **11 files**. The letter pack is one sold product; the seven folders are how you **show** it.

Rounds in the offer copy go through **R6** (R4 CFPB, R5 state AG, R6 last bureau letter). Peeks 10–11 plus the round covers already show that ladder. Do not add a 12th fake “R6 PDF” with a made-up filename.

---

## Also included at $297 — not a 12th PDF

Show as small tiles or one line each. **No fake screenshots of a finished video.**

| Sold name | What it actually is in code | Peek |
|---|---|---|
| **How To Use This mini course** | Portal tile. Five shelves: (1) Credit Analysis Report (2) dispute letter pack (3) Credit Optimization Roadmap (4) Funding Snapshot (5) Bank and Lender Match List. Placeholder in code: “Video will show here when it is ready.” | Mock of five named shelves. Empty video rectangle is honest. Do **not** invent lesson scripts. |
| **Advisors** | Support with the purchase. No advisor PDF. No named hours in code. | One line: they can reach an advisor along the way. No fake headshots. |
| **Community** | Portal card: Join the Fundhub wins group. Facebook. | One line. No fake member count. |

**Paid bump (not included):** FundHub mails the letters for a fee. Optional. Price **not** in the SLO README. Do not put a dollar on the sneak-peek grid. Checkout handles the bump (`CHECKOUT-FOR-CLAUDE.md`).

---

## Do not sell these as extra products

They can appear inside a real pack. They are **not** extra SKUs on the sales grid:

- Inner titles (Financial Profile Assessment, Capital Readiness Snapshot, etc.)
- `Capital-Readiness-Summary.pdf` / funding_summary
- `Business-Readiness-Guide.pdf` (only some thin files)
- Furnisher / collector validation letter (extra, not one of the six rounds)
- Booking QR on the last page of the four reports — this funnel’s CTA is **buy $297**, not “scan to book”

---

## Layout notes for Claude

- One row of the **four report covers**.
- One **letter-pack** cluster (folders 5–11 as a stack or 7 small tabs). Do not list every Experian/Equifax/TransUnion PDF.
- One slim row for mini course + advisors + community.
- Then the existing Value Anchor / Guarantee / CTA.

Headline for the peek block (keep it plain): they are buying **finished files**, not a course. Honesty rail already in the ads: this does not skip the work. It skips the learning.

Existing Section 4 copy still says “6 Assets.” The 11 peeks are **inside** those six assets (four reports + letter pack folders + course). Do not retitle the section to “11 products” in a way that looks like 11 separate prices.

---

## Sample / PII rules (hard)

- Sample person only.
- Blur account numbers, SSN last four, street address, DOB.
- Do not screenshot a live portal client.
- Mark every image `SAMPLE`.
- Do not use sim-mode fake **funded** result cards as if they were document peeks (those sit in Section 5 Proof and must stay labeled sample until Chris replaces them).

---

## Files Claude may touch

- `clickfunnels-fragments/slo/slo-01-sales.html` — fill `SLOT-SNEAK-PEEKS` only (plus images you add next to the fragment).
- Image assets: keep them with the funnel (e.g. `clickfunnels-fragments/slo/peeks/` or `fundhub.ai/funnel/slo-peek-*.jpg`). No CRM screens.

Do not redesign the whole sales page. Fill the hole.
