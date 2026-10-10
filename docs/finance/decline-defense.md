# Decline defense — how it works, and the tool contract

**Company:** Fundhub · **Unit:** Capital Blueprint launch B1 (`ops/workflows/blueprint-launch-2026-10-06.md`, map item 9) · **Migration:** 470

## Owner call

Owner-set offer (`docs/finance/capital-blueprint-next-2026-09-29.md`):

> Decline defense: When a bank declines, the system reads the reason and runs the reconsideration on the ops side.

Owner, 2026-10-06 (relayed by the orchestrator, written down here so the repo holds it):

> If they get declined, they copy the decline into the agent; it works out what the reason could be, then finds the reconsideration steps an agent can take as a process.

Board rule: never invent a bank script, window, or amount — cite the repo source or make it staff-set.

Naming rule (owner): Fundhub runs about six rounds inside one funding sequence. The next one is "the next funding sequence".

## What happens

1. The client pastes the bank's letter or email in FinanceOS (**Your applications**), or staff record the decline on the client control panel (**Capital Blueprint → Declines**). A letter file can go up through `POST /api/documents-upload` (subtype `decline_letter`) and be linked to the decline.
2. `analyzeDecline()` reads it: the likely reasons (closed set, each with the letter's own words), the parts nobody could match ("needs a person"), the reconsideration plan, timing, and what to fix first.
3. The decline and its plan are saved (`blueprint_declines`, `blueprint_decline_steps`). One ops task goes to the funding advisor's queue, once.
4. Ops works the plan, writes the blanks no source covers, sets the call date, and records the outcome: approved on reconsideration, still declined, or re-apply later (with a date).
5. Staff recording a decline on an application sets that application to Denied; an approval on reconsideration sets it to Approved with the amount if typed (blank stays unknown, never 0). Both go through `setApplicationStatus`, so each writes its `application_decisions` row. A client's paste never changes an application.
6. Still declined / re-apply later becomes a note for the next funding sequence (`declineNotesForNextSequence()`). It never sets that date.

Flow diagram: `docs/journeys/decline-defense-flow.md`.

## Where the words come from

| Kind | What it is |
|---|---|
| `repo` | A file in this repository (path given). |
| `notion` | The read-only Notion scrape of the funding playbook (`credentials/notion-scrape/output`, gitignored). Cited by page title only; every line is paraphrased. No brand, no price. |
| `book` | The lender book — the `lenders` table (`db/migrations/138_lenders.sql`), loaded from `docs/legacy-strong/lenders-legacy-strong.csv`. Staff only (`ROLE_SETS.LENDERS`). Never in the client view, the task body, or the money agent tool. |
| `letter` | The bank's own letter, as pasted. |
| `owner` | An owner call written down in the repo. |

A plan line no source covers is a **blank**: no words, no source, a label saying what the ops person must write. The database refuses a worded step without a source, and refuses to close a blank with nothing written (`470_blueprint_decline_defense.sql`).

## The closed set of reasons

| Key | Plain words | Source |
|---|---|---|
| `too_many_inquiries` | Too many recent credit checks | bureau score factor 8 `TOO MANY INQUIRIES LAST 12 MONTHS` (`vendor/underwriteiq-crs/sandbox/exp.json`); `src/autopsy/fields.mjs` `DECLINE_REASONS`; Notion "Expectations" |
| `high_utilization` | Cards used too much | bureau score factor 10 (`exp.json`, `efx.json`); `DECLINE_REASONS` |
| `accounts_with_balances` | Too many cards with a balance | bureau score factor 5 (`exp.json`, `efx.json`) |
| `negative_items` | Late payments or collections | bureau score factor 38 (`exp.json`, `efx.json`); `DECLINE_REASONS` derogatory_marks, recent_delinquency, bankruptcy |
| `short_history` | Credit history too short | bureau score factor 12 (`efx.json`); `DECLINE_REASONS` thin_file |
| `too_many_new_accounts` | Too many new accounts | Notion "Expectations" |
| `credit_score` | Credit score too low | `DECLINE_REASONS` credit_score |
| `business_too_new` | Business too new | `DECLINE_REASONS` time_in_business; `vendor/underwriteiq-crs/lender-matrix.js` minTIB; `lenders.minimum_time_in_business_years` |
| `income_or_revenue` | Income or revenue too low | `DECLINE_REASONS` insufficient_revenue; `lenders.minimum_revenue_threshold` |
| `industry` | Type of business | `DECLINE_REASONS` industry_restricted; Notion "Low Risk Business" |
| `could_not_verify` | The bank could not check your info | `src/adapters/mailgun.mjs` MISSING_DOCS keywords; Notion "Calling PENDING", "Calling DENIED" |
| `frozen_report` | Credit report frozen | Notion "Application Tips" |
| `bank_relationship` | No account with this bank yet | `lenders.relationship_required` / `requires_account_opening`; Notion "Importance Of Banking Relationships" |
| `same_bank_exposure` | Already a lot of credit at this bank | Notion "Applying again at the same bank", "Expectations" |

Anything else in a letter → `unknown_parts` → needs a person.

## The plan

| Step | Who | Source |
|---|---|---|
| Read the letter, list the likely reasons | agent | owner call above; offer |
| Send the bank's letter or email | client | offer |
| Find the bank's reconsideration number (letter or lender book first) | agent | Notion "Calling DENIED — Step 2" |
| Get the file facts ready (identity details stay on the file) | agent | "Calling DENIED — Step 1" |
| Call the reconsideration line; ask about the application and the limit | ops | "Calling DENIED — Step 3"; "Application Tips" (reconsider every denial) |
| Say the reason does not match the file; ask for a manual review; point to true strengths | ops | "Calling DENIED — Step 4" |
| Ask the RM on file to push it (only banks on the RM list) | ops | "Relationship Managers"; `docs/legacy-strong/bankers-rms.md` |
| What to say about each reason | ops | the category's talking point, or a **blank** |
| If they will not reconsider, call again — at least 4 times | ops | "Calling DENIED — Step 5" |
| Write a summary of each call | ops | "Calling DENIED — Steps 4 and 5" |
| Second no → still declined; set a re-apply date if there is one | ops | "Preparing Funding Plan"; B1 brief |
| What to fix first, per reason | client / ops | `SUGGESTION_CATALOGUE` sentences, FinanceOS tools, Notion pages — or a **blank** |
| Lender-book lines for the bank (account required, minimum years, minimum revenue) | ops | lender book row |
| Read the parts nobody could match | ops | B1 brief |

A letter that reads like a request for papers gets the "Calling PENDING — Step 4-B" call instead of the reconsideration push. A letter that reads like an approval goes to a person.

Agent steps sit on the ops task until the money agent takes them.

## The tool contract (for the FinanceOS money agent)

Module: `src/blueprint/decline-analyze.mjs`. Pure — no database, no clock, no network, no side effects.

```js
import { analyzeDecline, TOOL } from "../blueprint/decline-analyze.mjs";

// As a tool: TOOL.name === "analyze_decline"; TOOL.input_schema is JSON Schema;
// TOOL.run(input) returns the analysis with lender-book lines removed.
const out = TOOL.run({ text, bank, product, declined: true });
```

**Input**

| Field | Type | Meaning |
|---|---|---|
| `text` | string, required | The letter or email as pasted. Capped at 20,000 characters. |
| `bank` | string | The bank's name, if known. |
| `product` | string | The product applied for, if known. |
| `declined` | boolean | The client says the bank said no. A letter the reader cannot place is then read as a decline (the plan still asks for a second look). A letter that reads like an approval or a request for papers still says so. |

`analyzeDecline()` also takes `lenders` (lender book rows) on the staff side. `TOOL.run()` never passes them.

**Output**

| Field | Meaning |
|---|---|
| `looks_like` | `decline` · `approval` · `counteroffer` · `needs_info` · `unclear` (+ `looks_like_words`) |
| `reasons[]` | `{ category, label, client_words, evidence_quote, sources[] }` — `evidence_quote` is the letter's own words |
| `unknown_parts[]` | Reason-like lines no category matched |
| `needs_person`, `needs_person_why` | True when anything needs a person; the why in plain words |
| `recon_steps[]` | `{ key, who: agent·ops·client, step, client_step, sources[], blank, blank_label, status, filled }` — `step` is null on a blank |
| `timing` | `{ call, retries, second_no, letter[], reapply[], call_date: null }` — each line with `sources[]`; `call_date` is always null (staff set it) |
| `fix_first[]` | `{ category, who, text, sources[] }` or `{ category, who, blank: true, blank_label }` |
| `letter_phones[]` | The bank's numbers in the letter (a credit bureau's address block is skipped) |
| `bureaus_named[]` | Bureaus the letter names |
| `bank_facts` | `{ rm_on_file }` from the tool; the staff side adds the lender-book facts |
| `masked` | How many of the client's own numbers were hidden (SSN shape, long digit runs, a date of birth) |

**Guarantees:** every reason and every worded step cites a source; every number in a step, fix or timing line comes from its source (`src/blueprint/decline-analyze.test.mjs` checks this); text it cannot map is `needs_person`; no date is picked; no lender-book line leaves through the tool.

## Endpoints

`GET /api/blueprint/declines[?client_id=]` and `POST /api/blueprint/declines` — `api/blueprint/declines.mjs`.

| Caller | May |
|---|---|
| Client session (own file only; `client_id` comes off the session) | read `view`; `paste`; `link_letter` |
| Staff, `ROLE_SETS.STAFF` + client in their org | everything: `paste`, `record`, `link_letter`, `step`, `schedule`, `outcome`; read `view` + `staff` |
| `ROLE_SETS.LENDERS` (owner, admin, funding advisor) | also sees lender-book lines |

Writes need a paid Capital Blueprint (403 `not_blueprint_buyer`). A client's pastes are capped at 5 new declines a day (`CLIENT_PASTES_PER_DAY`, a queue guard). Nothing here calls a bank, sends a text, or moves money.

## Screens

- Client: FinanceOS section `window.FinanceOS.sections.declines` (`public/app/money-declines.js` + `.css`), thin shell `/app/money-declines.html`. Not yet a tab on `/app/financeos.html` — the orchestrator wires tabs.
- Staff: **Declines** block in `public/app/client-control-panel.html` → `#bp-group`, painted by `public/app/ccp-declines.js` (+ `.css`).
