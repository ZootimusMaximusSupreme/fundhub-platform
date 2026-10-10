# Service_Business_Foundation.md

**Service:** Capital Blueprint from Fundhub
**Price:** $5,000 (one-time)
**Company:** Fundhub (fundhub.ai), a business-funding company
**Prompt:** 1 of 7, Service Business Foundation

---

## Source Legend (read before using this document downstream)

Every claim below carries one of these tags so later prompts know what is solid and what is provisional:

- **[FACT]** comes directly from the business facts on file (`src/config/offers.mjs` or `marketing/testimonials/testimonials.json`).
- **[INFERENCE]** is a reasoned conclusion drawn from those facts, such as the structure of the product ladder or the internal offer key. It is not confirmed. Chris should verify it.
- **[NOT ON FILE]** means the information does not exist in the facts provided. It must be supplied before it can be used as truth.
- **[PARAPHRASE]** is a restatement of a real quote. It is not the speaker's words.

**Important context:** The repo does not describe what Capital Blueprint actually contains. Its internal offer key is `UWIQ_DELIVERABLES`, and UnderwriteIQ is the name of Fundhub's $32 soft-pull assessment. That strongly suggests Capital Blueprint is the full deliverable set built on the UnderwriteIQ assessment. This is an **[INFERENCE]**, and Sections 7 and 8 depend on it.

---

## PART 1: CORE SERVICE OFFERING

### 1. Primary Service (one sentence)

**[INFERENCE]** Capital Blueprint is Fundhub's $5,000 done-with-you funding plan. It turns an UnderwriteIQ underwriting assessment of a business owner's profile into a specific, sequenced plan for getting approved for business funding.

> ⚠️ This sentence is built from the offer name, the internal key `UWIQ_DELIVERABLES`, and Fundhub's category. Chris must confirm or correct it, because every downstream prompt inherits this definition.

### 2. Service Category

- **[FACT]** Business funding. Fundhub is a business-funding company.
- **[INFERENCE]** Within that category, Capital Blueprint sits in **funding readiness / underwriting strategy**. It is a plan and deliverables product, not the funding itself. Fundhub sells the execution separately as "Funding, done-for-you" ($3,000 + 10% success fee).

### 3. The Core Problem

**Desire-first framing.** The core mass desire is **access to capital**: getting approved for enough business funding to act on what the owner wants to do with the business.

**The problem blocking that desire [INFERENCE from the product ladder]:**
Business owners don't know how lenders will judge them, so they apply blind. Fundhub's own product ladder shows the specific failure points it was built around:

- **[FACT]** A "Decline Autopsy" product exists ($27). This implies a meaningful share of prospects have already been **declined** and don't know why.
- **[FACT]** "Credit repair, done-for-you" ($1,000) and a "Repair test run" ($200) exist. This implies **credit problems** are a common barrier.
- **[FACT]** An "UnderwriteIQ soft-pull assessment" ($32) exists. This implies prospects want to know where they stand **without a hard inquiry**.

**Problem statement [INFERENCE]:** The owner wants funding but can't see their file the way an underwriter does. So they either apply and get declined, which costs time and inquiries and sometimes confidence, or they don't apply at all. Capital Blueprint's job is to replace guessing with a plan.

---

## PART 2: CLIENT PROFILE & TRANSFORMATION

### 4. Ideal Client (specific)

**[NOT ON FILE]** No client research, CRM data, or avatar data exists in the facts provided. The profile below is an **[INFERENCE]** built from the offer ladder and the three testimonials. Validate it before Prompt 2.

**Provisional ideal client:**

- **Who:** An existing **business owner**. Both external testimonials are from business owners. One, Gene, runs three LLCs.
- **Situation:** Wants business funding, roughly in the **$80,000–$420,000** range. That is the range in the testimonials on file. It does not represent typical results.
- **Desire state:** Actively seeking capital now, not just curious.
- **Likely pain markers:** One or more prior declines, credit that needs work, or uncertainty about what they'd qualify for. These are inferred from the existence of the Decline Autopsy, credit repair, and soft-pull products.
- **Financial capacity:** Can commit to $5,000, or to financing it. **[FACT]** Capital Blueprint can be financed.
- **Possibly a multi-entity or repeat borrower** who wants funding over time, not once. This is inferred from Gene: "three LLCs" and "over the last three years."

**Not the ideal client [INFERENCE]:** Someone who only wants a quick look at their profile (the $32 soft pull serves them). Someone who wants Fundhub to do all the applying (Funding DFY serves them). Someone who wants to learn the whole skill themselves (Capital Academy serves them).

### 5. The "Before" State

**[INFERENCE, no client-voice research on file]**

- Wants capital but doesn't know what they qualify for or how much.
- May have been declined with no clear reason.
- May suspect their credit is holding them back but doesn't know exactly how.
- Worried that applying will hurt their credit, so they hesitate or apply randomly.
- No sequence or strategy. They apply wherever and hope.

> No real client quotes describing the "before" state exist on file. Do not write emotional "before" copy in their voice until real language is collected (see Section 15).

### 6. The "After" State

- **[FACT, from testimonials]** Real funding outcomes on file: about $225,000 (Colin Schmidt) and about $420,000 over three years (Gene). These are **not** confirmed as Capital Blueprint results specifically. The testimonials are not tagged to a product.
- **[INFERENCE]** The direct outcome of Capital Blueprint itself is **clarity and a plan**. The owner knows how underwriting sees them, what to fix, and what to apply for in what order. Funding is the downstream result.

> ⚠️ Compliance note: No results guarantee appears anywhere in the facts. Do not promise funding amounts or approval as the "after" state of a $5,000 plan product.

---

## PART 3: SERVICE DELIVERY & PROCESS

### 7. Service Methodology

**[NOT ON FILE]** The repo does not describe Capital Blueprint's process.

**[INFERENCE] Provisional methodology, to be confirmed by Chris:**

1. **Assess.** Run the UnderwriteIQ soft-pull assessment. **[FACT]** This exists as a product. It is a soft pull, so there is no hard inquiry.
2. **Diagnose.** Read the profile the way an underwriter would and identify what helps and what hurts approval. If the client was previously declined, explain why. The Decline Autopsy shows Fundhub has this capability.
3. **Blueprint.** Deliver a written, sequenced plan covering what to fix, what to apply for, and in what order.
4. **Route.** Point the client to the next step: self-execution, credit repair (REPAIR_DFY / REPAIR_TRIAL), or done-for-you funding (FUNDING_DFY).

### 8. Key Deliverables

**[NOT ON FILE]** No deliverables list exists in the facts. The offer key `UWIQ_DELIVERABLES` confirms the product *is* a deliverables package tied to UnderwriteIQ. The contents are unknown.

**Chris must list:** what the client physically receives (report? plan document? calls? templates? support period?), the format, and the delivery timeline.

Do **not** invent deliverables in copy until this list is supplied.

### 9. Pricing Model

- **[FACT]** $5,000, one-time.
- **[FACT]** Can be financed.
- **[FACT]** The lowest a closer may discount to is **$1,000**.
- **[FACT]** Related prices that shape how buyers perceive this one:
  - UnderwriteIQ soft-pull assessment: $32 (likely front-end / entry point)
  - Decline Autopsy: $27
  - Funding, done-for-you: $3,000 + 10% success fee
  - Capital Academy: $5,000, financeable (same price as Capital Blueprint)
  - Credit repair DFY: $1,000. Repair test run: $200.
- **[NOT ON FILE]** Customer acquisition cost, close rate, daily ad budget.

> ⚠️ **Positioning risk to resolve:** Capital Blueprint ($5,000) costs *more* up front than "Funding, done-for-you" ($3,000 + 10%). It also costs the *same* as Capital Academy. Buyers and closers need a clear answer to "why this one?" (See Sections 11 and 12.) There is also a $4,000 discount band down to $1,000. A wide, visible discount range can undercut the anchor, so Chris may want to define when discounts apply.

---

## PART 4: MARKET LANDSCAPE & DIFFERENTIATION

### 10. Main Competitors (2–3, direct or indirect)

**[NOT ON FILE]** No competitor research exists in the facts. No named competitors are listed here, because naming companies and describing their offers would be unsourced. Instead, these are the **competing alternatives** a prospect is actually weighing:

1. **Applying directly to lenders or the bank on their own** (indirect, DIY). It costs nothing up front, but the owner gets no underwriting insight. This is the risk the Decline Autopsy product exists to clean up after.
2. **Other business-funding brokers / funding consultants** (direct, category level). Specific names, prices, and claims are **[NOT ON FILE]** and must be researched before use.
3. **Credit repair companies** (indirect). These serve owners who believe credit is the only problem.

**Internal competition [FACT, same price list]:** Funding DFY ($3,000 + 10%) and Capital Academy ($5,000) compete with Capital Blueprint for the same buyer's money. This is likely the most real "competition" a closer will face.

### 11. Your Differentiator

**[INFERENCE, to be confirmed]**

- **Underwriting-first, not application-first.** The Blueprint is built on Fundhub's own named assessment, UnderwriteIQ. It starts from how a lender would judge the file instead of from a list of lenders.
- **Soft pull.** **[FACT]** The assessment is a soft pull, so the owner can learn where they stand without a hard inquiry.
- **Full ecosystem behind the plan.** **[FACT]** Fundhub can execute every next step in-house: credit repair, done-for-you funding, education. The plan doesn't hand the client off to strangers.

**Versus internal offers [INFERENCE]:**
- vs. **Funding DFY:** The Blueprint is the plan and the owner keeps control. DFY is execution and carries a 10% success fee on top.
- vs. **Capital Academy:** The Blueprint is specific to *this owner's file*. The Academy presumably teaches the general skill. (The Academy's contents are also **[NOT ON FILE]**.)

### 12. Client Objections

**[INFERENCE] Anticipated objections. None are drawn from real sales-call records, which are not on file.**

1. **"$5,000 for a plan? I wanted funding."** The plan-versus-money gap.
2. **"Why not just pay $3,000 for done-for-you funding?"** Internal price comparison.
3. **"Is funding guaranteed?"** Nothing in the facts supports a guarantee. Do not imply one.
4. **"Will this hurt my credit?"** Answerable by fact: the assessment is a soft pull.
5. **"I can't put $5,000 down right now."** Answerable by fact: it can be financed.
6. **"I've already been declined. Why would this be different?"**

---

## PART 5: CLIENT VOICE & EVIDENCE

### 13. Best Testimonial

**Source:** `marketing/testimonials/testimonials.json` (the only real testimonials on file)

> "I did receive some good business funding at the rate of about $420,000 over the last three years."
> **Gene, Owner, three LLCs**

**Runner-up (same source):**

> "So the total in funding was around $225,000."
> **Colin Schmidt, Business owner**

**Caveats required for downstream use:**
- Neither testimonial is tagged to **Capital Blueprint** specifically. They are Fundhub testimonials. Do not present them as Blueprint results unless Chris confirms these clients bought it.
- **Excluded from client-facing use:** Sarah ("I'm set to be approved for around $80,000") is listed as *"Sales team at Fundhub."* She is an employee, and by her own words she has **not yet** been approved. Using her quote as a client testimonial would be misleading.
- These amounts are individual results, not typical results. Label them that way in any ad or page.

### 14. Common Questions (top 3–5)

**[NOT ON FILE]** No FAQ, support tickets, or sales-call transcripts exist in the facts. These are **[INFERENCE]** hypotheses to validate against real calls:

1. What exactly do I get for $5,000?
2. Does this get me funded, or just tell me how?
3. Will checking my profile hurt my credit?
4. Can I finance it?
5. What's the difference between this, done-for-you funding, and Capital Academy?

### 15. Client Language (words they actually use)

**Real client language on file. These are the only verified words, from `marketing/testimonials/testimonials.json`:**

| Phrase (exact) | Speaker |
|---|---|
| "total in funding" | Colin Schmidt |
| "around $225,000" | Colin Schmidt |
| "good business funding" | Gene |
| "over the last three years" | Gene |

**Observations [INFERENCE]:**
- Clients talk in **outcome dollars** ("around," "about" plus a number), not in process terms like "underwriting" or "blueprint."
- Gene's phrasing frames funding as **ongoing over years**, not a one-time event [PARAPHRASE: he received funding repeatedly over a three-year span].

**No further client language exists on file.** No forum threads, review sites, call transcripts, or survey responses were provided. More client-voice phrases cannot be included without real sources.

---

## GAPS TO CLOSE BEFORE PROMPT 2

These items block accuracy in every later prompt. Ranked by impact:

1. **What Capital Blueprint actually is and contains.** A deliverables list, format, and timeline (Sections 1, 7, 8).
2. **Positioning versus Funding DFY ($3,000 + 10%) and Capital Academy ($5,000).** Why a buyer chooses this one.
3. **Which testimonial clients, if any, bought Capital Blueprint.**
4. **Real client voice.** Sales-call recordings or transcripts, intake forms, and reviews, to replace the inferred before-state, objections, FAQs, and language.
5. **Competitor research.** Named funding brokers and consultants, with sourced prices and claims.
6. **Discount policy.** When a closer may go from $5,000 down toward the $1,000 floor.
7. **Unit economics.** Customer acquisition cost, close rate, and daily ad budget are not on file.
