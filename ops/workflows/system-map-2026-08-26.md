# FundHub system map — 2026-08-26

**What this is:** How FundHub actually works, so a later end-to-end run cannot fake “done.”  
**What this is not:** A fix list. No product code changed. Do not merge `vc/save-2026-08-25`.

**The one testing rule (would have stopped tonight’s fake-done):**  
A journey **PASS** is the **full event list, in order**, plus a **real talk** for any live voice agent. Opening a desk, writing one field, or a **0.13-second** phone hang-up is **FAIL**. If the intended file has **no talk order**, the talk score is **UNVERIFIED** — never PASS.

---

## How to read this file

There are **three** “journey” books. They do not say the same thing.

| Book | Where | What it actually is |
|---|---|---|
| Intended / actual pages | `docs/journeys/*-intended.md` and `*-actual.md` | Almost all are **who can open which door**. Not “what happens next.” Written after the fact from the same route list (`docs/journeys/README.md`). A match only proves they were copied. |
| Editor trees | `src/journeys/seed-journeys.mjs` (same trees in `public/app/journeys.html`) | The **story** Sales sees: text, wait, book, $32, UnderwriteIQ. Six keys: client, setter, closer, advisor, affiliate, partner. **No tree** for owner or Specialist. |
| Live fire | `src/workflows/index.mjs` + each `src/workflows/*.mjs` | What **actually** runs when an event fires. This is the bar for “e2e done.” |

Cite intended files below. Then use **live fire** as the order you must walk. If intended has no event list, write **UNVERIFIED**. Do not invent steps to get a green score.

---

## 1. Live customer journeys and event order

### Client (the person who needs money)

**Cite:** `docs/journeys/client-intended.md` — sign-in doors only. **No talk order. No SMS order.**  
**Editor tree** (`seed-journeys.mjs` key `client`): form fill → text survey → assign setter → wait 2 days → survey done? → book link or nudge → Booked → day-before text → hand to closer → $32 → UnderwriteIQ → email results.  
**Live fire (walk this):**

1. Person lands (homepage / apply / start). File is born. Event: `entry.captured`.
2. **S-00 Welcome** — email + text (`EMAIL-S00-WELCOME`, `SMS-S00-WELCOME`).
3. **S-01 Intake** — Sales card on **New Lead**.
4. **S-02** — if they stop mid-survey, one nudge after a short wait.
5. They finish the survey / book a call. Event: `booking.created`.
6. **S-04** booked texts. **S-04b** day-before / two-hour reminders. **S-04c** staff alert.
7. **Josh (AG-04)** is supposed to call to confirm the slot (`ai-set-01-josh-setter`). See §2 — live script is a stub.
8. If they do not book: **S-nobook** chase. If they no-show: **S-05a**.
9. Closer call. Soft-pull **consent first**, then pay the diagnostic ($32 + $10 per extra business). Event path: Present send → approve form → pay (e2e **mints**, does not charge unless Chris named a charge).
10. Soft-pull / UnderwriteIQ only after consent + pay (live CRS only if the e2e gate said **live**).
11. Close: deposit / downsell / callback / no-show / not a fit. Disposition writes `call_outcomes`.
12. If they buy funding: `deposit.paid` → **S-06** + **S-doc-collection** (ask for docs, hold funding until Document Check accepts).
13. Docs upload → `docs.received` → **GHL-DOC** accept / request more / hold.
14. Advisor takes the file (`round.started` → **F-01** and the funding rail). See Funding below.
15. Portal magic link, contracts, invoices, AR as those events fire.

**ClickFunnels apply:** owner-ok. Do not score, nag, or touch. Same contact cannot run the funnel twice (new plus-tag each attempt).

### Setter (first voice)

**Cite:** `docs/journeys/role-sales-manager-intended.md` is **doors**, not Josh’s talk. Editor tree key `setter`.  
**Live fire:** `booking.created` → Josh call (quiet hours 11pm–11am Eastern, same as texts) → confirm / voicemail / no-answer cadence (**AI-SET-03**) → closer handoff.  
**Talk order does not live in any `*-intended.md`.** Roleplay uses `.cursor/skills/fundhub-agent-tester/SKILL.md`. Vendor talk order (unused tonight) is in `vendor/inquiry-remover/src/agents/setter-prompt.js`: open/confirm → frame (credit pulled **on** the Advisor call) → light set from survey only → show-up close (computer, quiet spot).

### Closer (the sale call)

**Cite:** `docs/journeys/role-closer-intended.md` — doors only. Editor tree key `closer`: pre-call panel → $32 → UnderwriteIQ → funding vs not-yet → deposit + advisor **or** downsell + DIY letters.  
**Live fire (desk motion, not a page load):**

1. Pipeline find the file. Open **Closer Dashboard** / **Present**.
2. Pre-call: survey, past talks, `fetchContext` pack (`src/agents/context.mjs`). Spoken words must be in `recent_calls.transcript` → prompt line `said:`.
3. Beliefs + “Before you close” (incorporation date when multi-biz / age matters).
4. Send soft-pull (consent + pay link). Do not pull until paid + consented.
5. Offer ladder (mint only unless Chris named a charge):  
   Soft-pull $32 · E-book $49 · Funding DFY $3,000 · Repair trial $200 · Repair DFY $1,000 · UnderwriteIQ pack $1,000 (asks upsell/downsell) · Funding Mastery $5,000.
6. Send the matching contract. Client sign page. Do not sign as a real legal click on a sim unless the run named it.
7. Log disposition. That row must show up in `/api/read/agent-context`.
8. Hand funding files to the advisor. Repair / combo follow repair enroll.

**Present is core.** Do not skip it and call closer “done.”

### Funding advisor (get the money)

**Cite:** `docs/journeys/role-funding-advisor-intended.md` — **doors only.** Night-ship said so. The four-builds V1 desk path is **not** in that file: open Apply list → type play name → Bank yes/no → see stamp → dollar guess unchanged.  
**Editor tree** key `advisor`: open round → submit → “it went out” text → wait on banks → mark **Funded**.  
**Live fire (dictator: finish the job):**

1. Sign in as advisor. Queue: Pipeline + Fulfillment list. File name/phone/email match the row.
2. Next action must say the real next job (Apply for Funding when that is the job). A line that says “No step applies” while a bill or hold sits under it is a **lie**.
3. MOVE the card onto the funding rail (**Apply Now**). Opening MOVE and leaving the card on Sales is FAIL.
4. Docs: staff upload + Documents list must show the same files.
5. Generate Apps → Apply on a lender. Apply must read **company city/state** if the person row is empty.
6. Mint invoice / pay link. **Do not pay.**
7. Bank Inbox is a read. Live inbound mail needs DNS (not proven 2026-08-26).
8. When a round is really funded, status lives on `funding_rounds`. Owner KPI that counts `clients.funded` can show **0** while two rounds are funded. That is a lie, not a journey PASS.

### Specialist — inquiry + repair (one desk)

**Cite:** `docs/journeys/role-inquiry-remover-intended.md` — this one **does** have a desk path: sign in → **Specialist** → toggle **Inquiries** / **Repair** → queue → open a person → Send only when a letter is ready. **Phone inquiry stays on hold.**  
**Live fire — inquiry:**

1. Case exists (`inquiry` / Issue Inquiry Removal). Extra texts from that click are a finding, not “free.”
2. Docs complete (FTC / inquiry pack). Portal inquiry door only unlocks with a credit-analysis report or funding snapshot.
3. Generate letters needs a credit file + agreement + address. Empty CRS = 0 letters.
4. Send letters = paper mail (PostGrid). Forbidden unless Chris named live postage.
5. **Call bureau** = a real bureau phone. Forbidden unless named. AG-09 to the **agent phone** is not a bureau call.

**Live fire — repair:** see §4.

### Affiliate

**Cite:** `docs/journeys/affiliate-intended.md` — doors. Editor tree: approve → send link → stamp referral → setter.  
**Live tonight (launch-readiness):** desk + code + copy link **PASS**. Reset mail **FAIL** (looks at `staff`, not `accounts`). `/start?ref=` page does **not** write the click. AF email drips: templates exist, **zero** sends, **not-live**. Social / calendar **not-live**.

### White-label (partner)

**Cite:** `docs/journeys/white-label-intended.md` — doors + marketing-suite notes. Editor tree: create company → Brand Studio → invite team.  
**Live tonight:** Partner Home + Brand Studio + `/sites/{id}/apply` **PASS**. Custom domain **not-live**. Partner drips **not-live**. Social Connect is staff-only; partner calendar empty.

### Owner

**Cite:** `docs/journeys/role-owner-intended.md` — almost every door. **No event tree** in `seed-journeys.mjs`.  
Owner work is not a customer journey. KPI strip must match stored money and **funded rounds**, not a page load.

---

## 2. Live AI agents and what the prompt says they must do

Live list comes from Agent Editor / `agents` rows, not from a guess. Inventory on 2026-08-25: **25** agents, **3 live**, 14 draft, 8 retired, **0** live SMS/email talk agents.

### AG-04 — Setter Josh (live, voice, Bland)

**What production uses:** the Agent Editor row. **169 letters.** Word for word:

> You are a Fundhub voice agent. Keep it short. If voicemail, leave a brief polite message confirming we called, then end. Never mention credit scores or approval amounts.

That is **not** the Josh job. It does not say “you are Josh.” It does not say confirm the booking, frame the live pull, or get them to a computer.

**What sits unused on disk:** `vendor/inquiry-remover/src/agents/setter-prompt.js` — **3,750 letters.** Says: you are **Josh**. Confirm the Strategy Session. No UnderwriteIQ, no pre-approval dollars, no pulled credit. Call flow: open/confirm → credit pulled **on** the Advisor call → light set from survey only → show-up close. Workflow `ai-set-01-josh-setter.mjs` **would** use this file only if the live row were missing or not ready. A 169-letter row **counts as ready** (`agentReadiness` only checks “is there any prompt?”). So Bland gets the stub.

**First agent-tester roleplay (2026-08-26):** **FAIL.** Skill: `.cursor/skills/fundhub-agent-tester/SKILL.md`. Two AIs talked on the **live 169-letter** script. The agent called itself **Sarah**, then said “Have a great day, Josh.” It did not confirm the sim name, did not say credit is pulled on the Advisor call, did not confirm survey dollars/use, did not ask for a computer. Guardrail held: no score, no approval dollar.  
`client-intended.md` has **no talk order** → sequence **UNVERIFIED** → overall cannot be PASS.

An 8-second or **0.13-second** Bland ring is also **FAIL** for “call sequence” (same skill).

### AG-09 — Inquiry Removal AI (live, voice, Bland)

Same night’s inventory: also **169 letters** (short row). Used to call the **agent phone** `+16616054248`, **not** Experian / Equifax / TransUnion. Phone inquiry launch stays on hold. Do not score a bureau call unless Chris named it. Roleplay this agent with the same tester skill and `role-inquiry-remover-intended.md` (desk path only — still **no talk script** in intended).

### OP-06 — Closer drill (live, internal)

Staff practice box on Agent Editor. Does **not** text a buyer. Long coach prompt. Live **Run** has died with missing `pg` on some deploys. A desk glance is not a drill PASS.

### Not live (still fire or confuse testers)

| Code / name | Status | What it must do if it were live | Trap |
|---|---|---|---|
| **GHL-DOC** / Document Check / AG-06 | Retired / draft | On `docs.received`: accept / request more / hold. Identity docs, not bureau letters. | Retired **GHL-DOC** still queued “need another doc” texts. Extra SMS = FAIL. |
| **VF-LIVE** | Draft | Verify / follow-up talk. | Has a real prompt; not live. |
| **UnderwriteIQ** | Engine, not an Agent Editor talk bot | Soft-pull, score, route. Blank fields stay blank, never $0. | Empty file if no pull (sandbox). |

**Shared memory:** every agent turn is supposed to read `fetchContext` (`src/agents/context.mjs`). Laptop can show `said: …` from `call_outcomes.transcript`. Live `/api/read/agent-context` has lagged (notes + recording, **no spoken words**). Meet tape → saver → this pack is a dictator row. A fake 0.13s call will not fill `said:`.

---

## 3. AR / money sequence

**Catalog** (`src/config/offers.mjs`) — mint, do not charge unless named:

| Offer | Price | Contract |
|---|---|---|
| Soft-pull / diagnostic | $32 + $10 per extra business | Soft-pull consent |
| Funding DFY | $3,000 deposit + 10% success fee | Funding agreement |
| Repair trial | $200 | Repair trial agreement |
| Repair DFY | $1,000 | Credit repair agreement |
| Repair + funding | both | Combined agreement |
| UnderwriteIQ pack | $1,000 (range up to $5,000) | Must pick upsell/downsell |
| Funding Mastery | $5,000 | Course |
| E-book | $49 | Downsell |
| Custom invoice | staff amount | Invoice pay link |

**Order on a funding close:**

1. Consent (soft-pull) → pay diagnostic → pull (if live) → Present numbers match the file.
2. Send agreement + pay link for the offer. Primary offers should not need a fake “upsell” click (first 2026-08-25 pass failed this; later closer-deep pass did not — do not assume).
3. Client pays deposit (`deposit.paid`) or staff mints an invoice (`invoice.sent`).
4. Success fee after a **funded** round: invoice source `funding_success_fee`.
5. **AR** (`src/workflows/ar-collections.mjs`) — **success-fee invoices only**:
   - Now: **AR-01** first notice (email + SMS) + pay link  
   - +7 days: **AR-02** reminder  
   - +7 more: **AR-03** final  
   - Then **AR-04** mark escalated + tag `ar:collections-handoff`  
   - Stops on `invoice.paid`. Re-checks before every send.  
   - A deposit payment does **not** settle a success-fee bill.
6. Dispatch: workflows **queue**. `messageDispatchSweeper` + Outbox **Send** drain the queue. Quiet hours park SMS 11pm–11am Eastern. `+sim-` is supposed to skip quiet hours — a text **already** stamped for morning will still sit. Cap exists. Extra SMS the file’s events did not ask for = FAIL.
7. Owner KPI cash must match `transactions`. Funded tile must match `funding_rounds` status=funded, not `clients.funded`.

Repair invoices ($200 trial / $1,000 full) are **not** this AR success-fee chain unless someone wrongly tagged them. Mint and mail is enough. Do not pay.

---

## 4. Repair escalation (trial vs $1,000, rounds, hold)

**Cite:** Specialist intended desk path + `src/repair/*`.

| | Trial | Full ($1,000) |
|---|---|---|
| Program | `trial` | `full` |
| Rounds cap | **2** | **6** |
| Price (catalog) | $200 | $1,000 |
| After trial | Upsell ~60 days. Chip: **Trial done — sales**. Status `upsell_pending`. Full **resumes** where trial stopped. Balance = full price minus $200. | Runs to program complete |

**Event order (live bus):**

`repair.enrolled` → intake  
→ `repair.docs.needed` → awaiting documents  
→ `repair.docs.complete` → analysis  
→ `repair.analysis.complete` → letters generated  
→ `repair.letters.ready` → ready to send  
→ `repair.letters.sent` → in transit  
→ `repair.letters.delivered` → awaiting response  
→ `repair.response.received` → response received  
→ parse: high confidence auto-advance, low → human  
→ verified item **escalates** and bumps round; deleted/updated **closes**; unaddressed stays  
→ `repair.round.complete` / `repair.round.escalated`  
→ `repair.program.complete` (trial also queues trial-complete upsell email; full skips that)

Also: `repair.stalled`, `repair.cancelled`, `on_hold` (portal: “Your file is on hold”).

**Hold (honest):**

- **3-day CROA calendar hold:** **removed** from the send path (owner 2026-08-21). Letters may generate after payment. Contract keys still required (`src/repair/croa.mjs`).
- **Needs agreement / no address:** Stage and generate **refuse**. That is a file hole, not “desk loaded.”
- **Funding doc hold:** after deposit, `round_hold_reason` until Document Check accepts.
- **Inquiry hold:** C-02 can hold a funding round when new inquiries appear.
- **Phone inquiry:** on hold. Do not launch.
- Desk shows **program + round only**. No dollars on the Specialist Repair tab.

**Uploads:** Repair portal bureau door needs `metro2-letter-pack`. Inquiry / funding doors need the matching unlock (paid snapshot / credit-analysis). Unpaid horsemen often have **no** extra doors. AI photo retake is email (`repair.response.retake`).

---

## 5. What “e2e done” MUST include

Skip any row = the run is **incomplete**. A glance, a desk load, or a green script is not enough.

### Dictator checklist (owner-set 2026-08-25)

1. **Five horsemen** — Funding, Repair, Combo, Inquiry, Course. Different people. Sample CRS + sample businesses. Full event fire. **No extra SMS.**
2. **Fulfillment** (funding **and** repair): queue → next action → docs → apply. Mint invoices / pay links. **Do not pay.** Then **AI outbound CALL** to `+16616054248`. **AI doc follow-up.** **FTC / portal / inquiry / repair uploads** (sim packs only).
3. **Meet tape → transcriber → `fetchContext`.** Spoken words in the closer pack (`said:`).
4. **Beta after live is hashed:** every button on every beta/ops screen. A page cannot PASS if a main button is broken.
5. On-screen data **matches the file**. Staff **finish** the desk motion.
6. Offers, contracts, UnderwriteIQ, **AR**, workflows, and agents that fire on those files.
7. Incorporation date ask + closer verify when multi-biz / age is needed.
8. Agent does **all** testing. Do not ask Chris to check mail **or click**. After a named fix: live click **twice**.

### Agent roleplay (required for live voice)

Skill: `.cursor/skills/fundhub-agent-tester/SKILL.md`.  
Two AIs talk. One uses the **live** prompt. One is the client. Score prompt **and** intended order.  
**FAIL if:** greeting-only; 8s / 0.13s Bland as “talk”; agent invents credit or dollars the prompt forbids; intended file has no talk order (UNVERIFIED → not PASS); agent asks Chris to listen.

Tonight’s Josh run is the example: live stub + no talk order in `client-intended.md` = **FAIL**.

### Also required

- Live first, then beta. Do not mix.
- Plus-tag sims only. Agent phone `+16616054248` only. Never Chris’s personal prove phone.
- Gmail **anywhere** (not Inbox-only). Twilio **accept** is the SMS bar.
- Hard stops unless named: live CRS, card charge, paper mail, wipe, bureau phone, secret rotation, ClickFunnels apply.

---

## 6. Where we lied this night (2026-08-26)

Sources: `launch-readiness-2026-08-26.md`, `night-ship-2026-08-26.md`, `full-e2e-audit-2026-08-25.md`, `agent-tester-2026-08-26.md`.

| Lie | What was scored | What is true |
|---|---|---|
| **Desk load = journey** | Advisor / Specialist / Bank Inbox “page opened” | Intended funding file is **doors**. The Apply-list → play stamp → Bank yes/no path was **not** walked. Inquiry expected-vs-actual was an API save, not the Specialist sequence. |
| **0.13s call = talk** | Bland “completed” after deploy | Hang-up. Voice URL was a Twilio demo. **Not** a Josh / doc-chase roleplay. Agent-tester later: Sarah, not Josh. |
| **KPI 0 vs 2** | Ops Admin funded tile **0**; brief said “no funded clients” | Same window: **2** `funding_rounds` status=funded (Sim Funding + Sim Combo). Live still counts `clients.funded`. Cash $375.96 did match cents. |
| **Code on main = sequence** | B1–B4 + Bland on main | Night-ship: **none** are a journey sequence PASS. AR workflows **not** proven as a chain. |
| **Affiliate / WL “ready”** | Login + desk photos | Reset does not mail accounts. `/start` does not record the click. Drips / social / custom domains **not-live**. |
| **Letters / Present numbers** | Buttons clicked | No CRS → 0 letters; UnderwriteIQ empty. Sandbox rule, not a hidden pass. |
| **Live closer pack** | Meet words stamped in the database | Live agent-context **missing** `said:`. |

**Never merge** `vc/save-2026-08-25`. Isolated PRs only.

---

## 7. Skills and tools Chris can feed a later agent

**Use what already exists. Do not build a second brain.**

| Feed this | Why | Do not |
|---|---|---|
| **This map** `docs/workflows/system-map-2026-08-26.md` | One human index. Event order + lies + e2e bar. | Treat it as a license to edit product code. |
| **`.cursor/skills/fundhub-agent-tester/SKILL.md`** | Only door for “did the agent follow its prompt.” Already forbids 0.13s calls and invented talk order. | Map Josh to `client-intended.md` and call UNVERIFIED a PASS. |
| **`.cursor/skills/fundhub-auditor/SKILL.md`** | Read-only “what’s broken.” No PASS without a screenshot, network row, or database row. | Use it for Full End-To-End Audit (that door **sends**). |
| **`.cursor/rules/full-end-to-end-audit.mdc`** | Dictator checklist. Gate first. | Skip fulfillment / AI call / roleplay and write “e2e done.” |
| **`src/journeys/seed-journeys.mjs` + `src/workflows/index.mjs`** | Editor story vs live fire. | Trust intended route lists as talk scripts. |
| **Company Brain** (`src/company-brain/`, `/app/company-brain.html`) | Already answers from company files. **Approve this map into Brain** if Chris wants it fetchable in the CRM. | Invent a second search product. |
| **Serena memories** | Folder is **empty** (old memories were deleted). If Chris wants a pointer, one memory: path of this map. | Recreate a pile of overlapping memories. |
| **Agent Editor / `src/agents`** | Live prompt is the script. Count letters. If 169 and the disk file is 3,750, **say the stub is what Bland will say.** | Roleplay the vendor file and call production PASS. |

**One small skill added (test / discovery only, no fixer):**  
`.cursor/skills/fundhub-system-map/SKILL.md` — forces a later agent to read this map before claiming a journey or e2e PASS. Does not repair prompts or workflows.

**Do not add:** a new MCP, a new database, or a fixer skill. The gap was “agents did not load the truth,” not “the truth had nowhere to live.”

---

## Pointers (no secrets)

- Live app: `https://fundhub.ai` · Apply: `https://apply.fundhub.ai`
- Agent phone: `+16616054248`
- Workflows register: `src/workflows/index.mjs`
- Dispatch: `src/messaging/dispatch.mjs` (gate → route → send)
- Context pack: `src/agents/context.mjs` `fetchContext`
- Offers: `src/config/offers.mjs`
- AR: `src/workflows/ar-collections.mjs`
- Repair enroll / stages: `src/repair/enroll.mjs`, `src/repair/pipeline.mjs`
- Josh workflow: `src/workflows/ai-set-01-josh-setter.mjs`
- Unused Josh script: `vendor/inquiry-remover/src/agents/setter-prompt.js`
- First roleplay FAIL.
