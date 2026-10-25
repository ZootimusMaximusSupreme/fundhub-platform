# COMPLIANCE REVIEW REQUIRED

This brief is for the **SLO $297 checkout** (ClickFunnels native two-step order form). It touches **credit-repair messaging**, **fee timing**, **consent**, and **credit-pull type**.

Chris pastes this whole file into a Claude chat. Claude designs the checkout look. Claude does **not** invent new product claims.

Do **not** use Anthropic/Claude from Cursor. This file is the paste.

---

## What you are building

A **100% trust** checkout for FundHub’s **$297** product (not a service, not a booked call).

The live fragment already exists:

- Order page: `clickfunnels-fragments/slo/slo-02-order.html`
- Split at the `SPLIT-LINE` marker: Custom HTML **above**, **ClickFunnels native Two-Step Order Form** in the middle, Custom HTML **below**.
- Sales page that sends people here: `clickfunnels-fragments/slo/slo-01-sales.html` (CTA href `/order`).
- After pay: pack is built from their file. Owner rule in code: **pay, then pull, then pack** (`src/slo/offer.mjs`). Soft pull happens **after** the card. **Do not collect SSN on checkout.**

Chris’s mock (the empty white card):

```
[ CLICKFUNNELS NATIVE TWO-STEP ORDER FORM GOES HERE ]
STEP 1 · NAME · EMAIL · PHONE
STEP 2 · SOCIAL · CARD · $297
ORDER BUMP · FUNDHUB MAILS YOUR LETTERS FOR YOU
```

The current repo placeholder still says one line: `Name · Email · Phone · Card · $297`. **Chris’s mock wins.** Use the two-step split above.

Design system: match the existing SLO fragments (`fh-a` / `fh-b`, Inter + JetBrains Mono, paper `#FCFCFC`, ink `#0A0A0A`, blue CTA `#188bf6`, 44px grid). Do **not** restyle the CRM (`public/app/*`). Do **not** mint a new Commas catalog product. Reuse **Consulting Services Assessment** if a vendor title is required.

Price is **$297**. Integer cents in code: `29700` (`src/slo/offer.mjs`).

---

## SOCIAL is not Social Security

The mock says **SOCIAL** on step 2.

**That is not an SSN field. Do not collect Social Security Number, last four, date of birth, or full address on checkout.**

- Step 2 = **card + $297** (+ optional bump).
- SOCIAL in the mock = **trust next to the card** (social proof slots, guarantee, “what you get”). Not identity for a bureau pull.
- If ClickFunnels’s native two-step widget offers an SSN / “Social” / last-4 field, **leave it off**. Pay first. The credit pull is a later page.

---

## Exact fields

### Step 1 (contact only)

Collect only:

1. **Name** (first + last, or CF’s single name field)
2. **Email**
3. **Phone**

Nothing else on step 1. No SSN. No DOB. No “what is your score.” No upload.

### Step 2 (pay)

Collect only:

1. **Card** (number, expiry, CVC, billing ZIP as CF native requires)
2. Charge **$297** for the diagnostic pack
3. **Optional order bump** (see below)
4. **Hidden UTM fields** (see UTM)

Button copy shape: buy the pack. Not “book a free strategy call.” Not “apply first.”

### After they pay (not this form)

Soft pull runs later. Code path: pay → pull form (`/slo/pull.html`) → pack. Checkout copy may say: **soft pull after checkout, no hard inquiry, does not touch the score.** That promise stays attached to the **soft pull**, not to “working with us will not affect your credit at all.”

---

## Order bump

Copy on the mock: **FundHub mails your letters for you.**

Rules:

- **Optional.** Not included in $297.
- They can still print and mail the letters themselves. The pack already writes the letters.
- It is **not** the point of the page. Do not make the bump louder than the $297 pack.
- **Bump dollar amount is not in `clickfunnels-fragments/slo/README.md`.** Do not invent a postage price. Put a clear slot: `[CHRIS FILLS BUMP PRICE]`.
- Do **not** use the paid-round SKU prices ($100 / $110 / $120 / $130). That SKU is a later re-pull + new dispute. It is **not** “mail the letters we already wrote.”

---

## UTM (required)

Paste `clickfunnels-fragments/06-utm-hidden-fields.html` onto the **order / checkout page** (the page with the form). One Custom HTML/JS element. No visible output.

It stamps hidden inputs on every form:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- plus `landing_path`, `referrer_domain`

In ClickFunnels, create contact custom attributes with **those exact names**. First touch wins. Never keep `fbclid`.

Wire format (owner-set):

- `utm_source` = `fb`
- `utm_medium` = `paid`
- `utm_campaign` = lane (`funding600` | `premium` | `sorting` | `uwiq` | `wl`)
- `utm_content` = ad id (number, optional `-slug`)
- `utm_term` = variant (`sun` | `nosun` | `sedona`)

---

## What $297 gets (order summary)

Use these **sold names**. Do not sell inner PDF titles as extra products. Do not add catalogue prices other than $297.

Included:

1. **Credit Analysis Report** — their file, three bureaus, the way a lender reads it
2. **Dispute Letter Pack** — letters written for them; they send them (unless they buy the mail bump)
3. **Credit Optimization Roadmap** — product name only; never use “optimize” as a verb
4. **Funding Snapshot** — what the file supports today vs after they work the roadmap (estimates, not a bank promise)
5. **Bank & Lender Match List** — named lenders; some open now, some need a business entity first
6. **How To Use This mini course** — five video shelves in the portal (videos may still be empty slots)

Also in the pack (show as part of the letter pack, not as extra SKUs): six rounds of letters **as documents they receive**, plus later-round escalation letters, plus advisors they can reach, plus the community from day one.

The existing order summary on `slo-02-order.html` lists six assets. Keep that shape. Sneak-peek **pictures** of the files belong on the **sales page** (`slo-01-sales.html` Section 4), not as a wall of PDFs on checkout. See the sample cards on `slo-01-sales.html` (`.ai/rules/sample-clients-consistent.md`).

---

## 100% trust — what to put on the page

Must be visible without hunting:

| Trust item | What to show |
|---|---|
| Price | **$297**. One number. No crossed-out fake “was $3,000” unless Chris already wrote it (the page already contrasts $3K–$5K **other companies**, which is existing copy — do not invent a new strikethrough MSRP). |
| What they get | The six sold names above, short. |
| When the pull happens | After checkout. Soft pull. Zero score impact **of that pull**. |
| Guarantee | Existing line: if the diagnostic does not give more usable information than any funding coach, broker, or credit tool they have ever used — **full refund, keep everything.** |
| Bump | Optional + `[CHRIS FILLS BUMP PRICE]`. |
| Testimonials | **3 video slots** and **3 photo slots**. Empty. Label them. Chris will drop in real clips and photos. **Do not invent names, quotes, funded amounts, or faces.** |
| SSL | Real checkout security from ClickFunnels / the processor is fine. |

**No fake badges.** No made-up Norton / McAfee / “as seen on” / “#1 rated” / star widgets with fake counts. No invented client count.

Allowed proof only (do not add to this list):

- Close to a decade in business funding
- Over $25 million secured for clients
- Koi Poke — one restaurant, turned away once, now a franchise with multiple locations

Existing order-page trust line (keep if you restyle around it): `256-bit SSL secure · Soft pull only · Zero score impact · Credits toward your deposit`.

The $297 **credits toward the deposit if they later buy done-for-you**. That is existing funnel copy. Do not turn it into “you will get funded.”

---

## Never say (checkout copy)

| Never | Why |
|---|---|
| “Your score will go up.” | Banned. |
| “We’ll get you funded.” | FundHub is not the lender. |
| A dollar amount a bank **will** give them | “What the file supports” / “pre-qualified” / “up to” with conditions. Never “you’ll get $X.” |
| A bad item **will** come off | Nobody can promise a deletion. |
| “Overnight letters” / UPS / FedEx to a bureau | Not true. |
| “No denials.” | Guarantee we cannot keep. |
| Six rounds as what it **achieves** | Six rounds is what they **get**. |
| FundHub does the work on the $297 product | They send their own letters unless they pay the mail bump. |
| Collect SSN / last 4 / DOB on this form | Pay, then pull. |
| Name the tech stack | “Our system,” not vendor names. Inner report kicker may appear on a **sample cover thumbnail**; do not sell “Underwrite IQ” as a second product on checkout. |
| New Commas product titles | Keep title: Consulting Services Assessment. |

Do not draft customer-facing claims about credit outcomes.

Banned filler words still apply if you write headlines: no “optimize” as a verb (product name **Credit Optimization Roadmap** is OK), no “leverage / seamless / unlock the power,” no “imagine a world where.”

---

## Layout (Claude designs; this is the job)

1. **Above the native widget** (already in `slo-02-order.html`): logo, short headline, order summary, $297 total.
2. **Native CF two-step** in the existing floating card (`.fh-widget-slot` / `TwoStepOrderForm/V1`). Do not rebuild a fake HTML card form that charges a card. CF owns the insides.
3. **On / beside step 2:** card + $297, optional bump, social-proof **slots** (3 video / 3 photo), guarantee.
4. **Below:** why $297, disclaimer that already exists (not a bank; amounts are not an offer of credit; results vary), privacy + terms links.

Funnel language vs widget language: the sales page already calls this “step 2 of 2” (sales → order). The **widget** is then two small steps (contact → card). Do not write “step 3.” Keep it obvious: first box is name/email/phone, second box is pay.

Mobile: one column. Thumb can hit the pay button. No tiny type on the card fields.

---

## Files Claude may touch

- `clickfunnels-fragments/slo/slo-02-order.html` (checkout look around the native widget)
- Copy/layout notes in this brief
- UTM fragment already written: `clickfunnels-fragments/06-utm-hidden-fields.html` — paste it, do not rewrite the script unless broken

Do **not** edit `public/app/` CRM screens. Do **not** change Commas products. Do **not** collect SSN.

Sneak-peek document thumbnails: the sample cards on `slo-01-sales.html` (`.ai/rules/sample-clients-consistent.md`).

---

## Done when

- Native two-step is the checkout (not a custom card form).
- Step 1 = name, email, phone only.
- Step 2 = card + $297; SOCIAL ≠ SSN.
- Bump = mail the letters, optional, price slot for Chris.
- UTM hidden fields on the form page.
- 3 video + 3 photo testimonial slots, empty.
- No fake badges. No credit-outcome promises. No SSN.
