# Creative and campaign block reasons

**Date:** 2026-08-17
**Built from:** the code at commit `7be91a0`, read directly. Nothing here was
copied from a screen, from a spec, or from memory.
**Sources:** `db/migrations/047_compliance_rules.sql`, `src/compliance/screen.mjs`,
`src/compliance/targeting.mjs`

---

## What this page is

This is the full list of reasons the system can refuse to let an ad, an image, a
piece of copy, or a campaign go out.

It used to sit on the Creative Factory screen. That screen is for people building
ads, so the legal detail was moved here instead. The screen now says the same
thing in plain words and links to this page.

Every row below was read out of the code. Where the code does not carry a legal
citation or a seriousness level, this page says **none in code**. No citation and
no severity has been added from anywhere else.

---

## What happens when a rule fires

The checker gives one of three answers.

| Answer | What it means |
|---|---|
| `passed` | Nothing matched. The work can go out. |
| `blocked` | Something matched. The work stops. |
| `needs_approval` | Nothing bad matched, but a person has to say yes first. |

Two things are worth knowing.

**`needs_approval` is not a pass.** Nothing reaches Facebook, TikTok or Google in
that state. It is a separate answer from `blocked` only so the dashboard can tell
"a person needs to look at this" apart from "this can never run."

**There is no soft warning today.** The rule table has a `warn` setting that would
record a problem without stopping anything. Not one of the twelve saved rules uses
it. Every rule in the system right now either stops the work or holds it for a
person.

**A missing seriousness level counts as a stop.** The code decides a block by
counting every reason whose severity is *not* the word `warn`
(`src/compliance/screen.mjs:200`). The engine and Meta targeting reasons carry no
severity at all, so they count as stops. This is deliberate — the checker is built
to fail safe.

**If the checker itself breaks, the answer is `blocked`.** A database that is
down, a broken pattern, an unreadable request — all of them come back as a stop,
never a pass.

### What a stop actually does, by kind of work

| The work | Where the code lives | What a stop does |
|---|---|---|
| A generated creative | `src/creative/generate.mjs:217` | The asset is saved with the state `blocked` and its reasons attached. It goes to the review queue rather than being thrown away. A `needs_approval` answer does **not** change the asset — approval is tracked on the campaign instead. |
| A social post | `src/social/scheduler.mjs:53` | The post is saved with the status `blocked` and its reasons attached. A database rule also refuses to let any post be queued unless a screening record exists for it. |
| Website / brand copy | `src/brand/copy-generate.mjs:130` | The section comes back marked blocked with its reasons, and is not written. |
| Queued marketing copy | `api/social/generate.mjs:95` | The queued item is saved with the status `blocked` and its reasons attached. |
| A campaign change sent to a platform | `src/adplatforms/index.mjs:70` | Any answer other than `passed` returns a refusal and nothing is sent to the platform. **See the gaps section — nothing calls this today.** |

---

## Which rules apply to creatives, campaigns, or both

The checker does **not** change its rules based on whether it is looking at a
creative or a campaign. It is handed a `kind` value, but that value is only used
to label the audit record. It never picks which rules run.

What actually decides the rules is what the caller hands over:

- **Copy rules** (the twelve saved rules) run on anything with words in it —
  creatives, campaigns, social posts, website copy. These are the "both" rules.
- **Meta targeting rules** (the nine below) only run when a targeting plan is
  supplied. A creative is checked with no targeting plan at all, so these can
  never appear on a single creative. They are campaign-only.
- **The Facebook category rule** only runs when the platform is Facebook.
- **The TikTok rule** only runs when the platform is TikTok.
- **The disclosure rule** is satisfied either by the words being in the copy or by
  a disclosure document being attached to the campaign.

---

## The two things the screen says, checked against the code

The Creative Factory screen carries this one-line summary:

> Each reason stops the work. Credit-repair creative always needs a person, and
> credit-repair ads cannot run on TikTok.

| Claim | Verdict | The rule that produces it |
|---|---|---|
| "Credit-repair creative always needs a person" | **Confirmed.** The code checks this without ever reading the partner's own setting, and there is no way to switch it off. | `human_approval_required_credit_repair` — `src/compliance/screen.mjs:207-213` |
| "Credit-repair ads cannot run on TikTok" | **Confirmed, and it is enforced in three separate places.** In code before any rule is read, as a saved rule row that supplies the readable wording, and as a database rule so no route can write around it. | `tiktok_credit_repair_prohibited` — `src/compliance/screen.mjs:132-135`; the saved rule `tiktok-credit-repair-prohibited` — `047_compliance_rules.sql`; the database check `campaigns_tiktok_credit_repair_ck` — `db/migrations/046_ad_platforms.sql:220` |
| "Each reason stops the work" | **Needs correcting.** True for 27 of the 29 reasons. The two approval reasons do not stop the work — they hold it for a person. The code adds them *after* the stop decision has already been made, so they can never cause a stop. | `human_approval_required_credit_repair` and `human_approval_required_setting` — added at `src/compliance/screen.mjs:210` and `:218`, after the stop check at `:200` |

---

## Every block reason

Twenty-nine in total: **12** saved rules, **8** built-in engine reasons, **9**
Facebook targeting reasons.

### 1. Saved rules — 12

These live as rows in the database and can be edited without a code release. A
change takes effect within about a minute. All twelve ship set to `block`.

| Code | What it catches | Severity | Verdict | Applies to | Citation (exactly as the code has it) |
|---|---|---|---|---|---|
| `guaranteed-score-increase` | Promising a set or guaranteed rise in a credit score. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(a)(3)` |
| `promise-to-remove-accurate-info` | Claiming to remove negative information that is accurate or can be verified. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(a)(3)` |
| `remove-late-payments-collections` | Claiming to remove late payments, collections, charge-offs, bankruptcies, repossessions, foreclosures, judgments or tax liens. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(a)(3)` |
| `advance-fee` | Charging or advertising a fee before the credit-repair work is finished. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(b)` |
| `file-segregation-cpn` | Offering a CPN, a new credit file or identity, a second social security number, or an EIN used in place of an SSN. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(a)(1)-(2)` |
| `guaranteed-timeline` | Guaranteeing how long credit-repair results will take. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679b(a)(3)` |
| `guaranteed-approval` | Promising approval, or saying everyone is approved. | `block` | blocked | all offers · all platforms | `FTC Act 15 U.S.C. 45` |
| `guaranteed-funding-amount` | Guaranteeing a specific dollar amount of funding or credit. | `block` | blocked | all offers · all platforms | `FTC Act 15 U.S.C. 45` |
| `fabricated-testimonial` | Fake testimonials, paid-to-say wording, or the claim that results are typical. | `block` | blocked | all offers · all platforms | `FTC Endorsement Guides 16 CFR 255` |
| `income-wealth-targeting-cue` | Copy that targets or hints at the reader's income or money trouble. | `block` | blocked | all offers · all platforms | `Meta special ad category / ECOA` |
| `croa-consumer-rights` | **A presence rule, not a ban.** Fires when the "Consumer Credit File Rights Under State and Federal Law" disclosure is *missing* — both from the copy and as an attached document. | `block` | blocked | credit repair · all platforms | `CROA 15 U.S.C. 1679c(a)` |
| `tiktok-credit-repair-prohibited` | Matches everything. It exists only to supply readable wording; the real stop happens in code first. | `block` | blocked | credit repair · TikTok | `TikTok Advertising Policies — Prohibited Industries` |

Two of these twelve citations are not statutes. `income-wealth-targeting-cue`
cites a platform category and a law by initials only — the code never spells out
what ECOA stands for and names no section. `tiktok-credit-repair-prohibited`
cites TikTok's own advertising policy. Both are recorded here exactly as the code
has them.

### 2. Built-in engine reasons — 8

These are written into the checker itself. They cannot be edited, switched off or
reworded without a code release. None of them carries a severity or a citation.

| Code | What it catches | Severity | Verdict | Applies to | Citation |
|---|---|---|---|---|---|
| `screen_error` | The checker could not finish — database down, broken pattern, unreadable request. | none in code | blocked | everything | none in code |
| `offer_type_missing` | The request did not say what is being sold. Must be funding, credit cards or credit repair. | none in code | blocked | everything | none in code |
| `platform_unknown` | The request named a platform that is not Facebook, TikTok or Google. | none in code | blocked | everything | none in code |
| `tiktok_credit_repair_prohibited` | Credit repair on TikTok. Checked first, before any saved rule is read, so turning the saved rule off does not open this door. | none in code | blocked | credit repair · TikTok | none in code |
| `special_ad_category_unset` | Facebook requires a special ad category and none has been set up for this offer type. | none in code | blocked | all offers · Facebook | none in code |
| `synthetic_without_ai_flag` | An asset shows a computer-made person but is not marked as AI-generated. | none in code | blocked | everything | none in code |
| `human_approval_required_credit_repair` | Always fires for credit repair. The partner's own setting is not even read. | none in code | **needs approval** | credit repair · all platforms | none in code |
| `human_approval_required_setting` | Fires when the partner has "approve before launch" turned on. Defaults to on when the partner has no settings saved. | none in code | **needs approval** | all offers · all platforms | none in code |

### 3. Facebook targeting reasons — 9

These are Facebook's special-ad-category terms, written as code. They are not
fundhub preferences and cannot be relaxed for a customer. Every one is a refusal,
never a quiet correction — the system will not widen a radius or edit a targeting
plan on the partner's behalf and spend their money differently than they asked.

None of them carries a severity or a citation. All nine apply to Facebook only,
and only to a campaign — never to a single creative.

| Code | What it catches | Severity | Verdict | Applies to | Citation |
|---|---|---|---|---|---|
| `targeting_missing` | No targeting plan was supplied at all. An empty plan cannot be certified. | none in code | blocked | campaigns · Facebook | none in code |
| `targeting_malformed` | The targeting plan is not readable. | none in code | blocked | campaigns · Facebook | none in code |
| `zip_targeting` | Targeting by ZIP or postal code. Fires on two different shapes of the same request. | none in code | blocked | campaigns · Facebook | none in code |
| `radius_too_small` | A map radius under 15 miles. Kilometres are converted first, so a 20 km radius does not slip through. | none in code | blocked | campaigns · Facebook | none in code |
| `location_exclusion` | Cutting places out of the audience. Excluding a place is targeting everywhere else. | none in code | blocked | campaigns · Facebook | none in code |
| `age_range` | Any age range other than 18 to 65-and-over. Fires separately for the bottom and the top of the range. | none in code | blocked | campaigns · Facebook | none in code |
| `gender_restriction` | Narrowing the audience by gender. | none in code | blocked | campaigns · Facebook | none in code |
| `lookalike_audience` | Lookalike audiences, including a custom audience that is a lookalike underneath. Fires on two different shapes. | none in code | blocked | campaigns · Facebook | none in code |
| `detailed_targeting_expansion` | Letting Facebook reach past the interests we listed. | none in code | blocked | campaigns · Facebook | none in code |

Three of these nine codes fire from more than one place in the code, with
different wording each time: `zip_targeting`, `age_range` and
`lookalike_audience`. That is twelve trigger points producing nine distinct
codes.

---

## Stops that are not on the list above

The twenty-nine reasons are the ones that come back with a readable message. The
database has its own stops that produce a raw error instead. These are the ones
that touch a creative or a campaign directly:

| Where | What it stops |
|---|---|
| `db/migrations/046_ad_platforms.sql:220` | A campaign cannot exist as credit repair on TikTok. |
| `db/migrations/046_ad_platforms.sql:398` | A campaign cannot go live if the ad account connection is not active, or if the platform has not approved the business verification. |
| `db/migrations/047_compliance_rules.sql:187` | A credit-repair campaign cannot go live without the Consumer Credit File Rights disclosure document attached. |
| `db/migrations/049_social.sql:135` | A social post cannot be queued or posted unless a screening record exists for it. |
| `db/migrations/045_creative_factory.sql:255` | A creative cannot be built from another partner's parent asset or brand kit. |

---

## Gaps found

These are things the code does not do, or does not carry. They are recorded here
rather than filled in.

1. **Campaign checking is not switched on.** The campaign guard at
   `src/adplatforms/index.mjs:70` only runs when it is handed something to check.
   Neither of its two callers hands it anything — `api/campaigns/write.mjs` and
   `src/optimize/run.mjs` both only pause, resume or change a budget, which the
   code says are correctly exempt. So no live path checks a campaign today.

2. **Nothing creates a campaign or an ad set.** `createCampaign`, `createAdSet`
   and `createAd` in `src/adplatforms/meta.mjs` have no caller outside tests, and
   no route reaches them. Because the nine Facebook targeting rules fire from
   inside ad-set creation, **none of the nine can fire today.** They are written,
   tested and correct — they are simply not reachable yet.

3. **The audit helper is unused.** `screenAndRecord` in
   `src/compliance/screen.mjs:231` exists to record every check. Nothing calls it.
   The two paths that do keep records — generated creatives and social posts —
   write their own record directly. Website copy and queued marketing copy are
   checked but leave no screening record at all.

4. **No warnings exist.** All twelve saved rules ship set to `block`. The `warn`
   setting is built and never used, so the Severity column has exactly one value
   in it everywhere.

5. **A typo in a severity would become a stop.** The code counts anything that is
   not exactly the word `warn` as a stop. A rule saved as `warning` would silently
   become a hard stop. This is safe in the sense that it never lets something
   through by accident.

6. **The kind of work is recorded but never used.** The checker accepts a `kind`
   value and only writes it to the audit record. It never picks rules with it. The
   database allows an `ad_set` kind that the checker's own notes do not list.

7. **No invented rules were found.** Every one of the twenty-nine rows shown on
   the Creative Factory screen traces to real code. Nothing on that screen is made
   up, and nothing there is missing from this page.

---

## Code

- `db/migrations/047_compliance_rules.sql` — the twelve saved rules, the rule
  table, and the disclosure gate
- `src/compliance/screen.mjs` — the checker, the eight built-in reasons, and the
  three answers
- `src/compliance/targeting.mjs` — the nine Facebook targeting reasons
- `db/migrations/046_ad_platforms.sql` — the TikTok and launch database stops
- `db/migrations/049_social.sql` — the social post screening stop
