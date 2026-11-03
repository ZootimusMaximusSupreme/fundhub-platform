# Capital Blueprint — intended

Owner instructions: Chris's 2026-10-20 package requirements and 2026-11-02 real-buyer build request. The November 2 coverage ledger is `ops/workflows/blueprint-client-simulation-2026-11-02.txt`, R01–R30. This records authorized behavior; implementation and release evidence belong in `capital-blueprint-actual.md`. The earlier private fictional preview does not satisfy these requirements.

## Offer and roles

- The closer selects one exact whole-dollar price from $5,000 through $10,000, default $5,000. Product remains `consulting-package`, offer `UWIQ_DELIVERABLES`, provider title `Consulting Services Package`.
- Owner confirmed 2026-10-20: every allowed price buys the same 12-month package; the closer chooses the price. Higher prices do not create extra service tiers.
- The offer includes 12 months. Owner confirmed 2026-10-20: service ends unless the client separately agrees to renew; no automatic renewal or charge.
- The AI accountability coach reads and maintains the client's progress and conversation context. There is no named human advisor (owner-set 2026-10-20). The CSM role is touch-base: the AI coaches check in on the current step, and the Fundhub team works a CSM queue for anything a person must handle. Client-facing language is "the Fundhub team", never "your advisor". An AI identity must never be presented as a person.
- Routine check-ins can use SMS and Bland calls. Existing opt-outs, quiet hours, contact caps, approved prompts and outbound settings still apply. A queued send is not a delivered message or completed call.
- Owner confirmed 2026-10-20: communication is agentic. The coach uses saved client context and current replies to choose its next question or permitted action, rather than blindly sending a fixed campaign. After two actually sent Blueprint text reminders remain unanswered on the same open step, the next eligible run can start one contextual Bland call. A reply, changed/completed step, ended access or contact hold cancels the old escalation; queued/failed texts do not count. Existing quiet hours and contact caps decide the next eligible run, with no new delay invented.
- The offer guides the client toward being fundable. It does not promise a funding amount or a funding approval.

## Required sequence and observable result

| Step | Requested behavior | Observable result |
|---|---|---|
| CB-01 | Closer chooses the exact price and Commas pay-in-full or Whop financing. | Server accepts only allowed Blueprint amount/provider; other offers retain their current rules. |
| CB-02 | Create the Blueprint contract using that price. | Draft and sent document retain the same validated price. A template that still says fixed $5,000 cannot send a custom-price agreement. Existing signed agreements remain unchanged. |
| CB-03 | Create the chosen provider's checkout for the same client, company, product and price. | Saved local payment link matches provider checkout identity and exact USD amount; caller cannot substitute a provider title. |
| CB-04 | A confirmed payment opens Blueprint access. | Verified exact-match receipt produces one canonical payment, transaction and entitlement. Failed/unmatched receipts grant nothing; retries cannot duplicate a purchase. |
| CB-05 | Keep one durable client record across AI and staff work. | Checklist/proof state, messages, calls, transcripts, notes, tasks, contracts and payment status retain company/client identity and are available to the shared context reader. |
| CB-06 | Coach follows the real current step across agentic texts, replies and calls. | SMS/call context includes the saved open step and prior conversation. The AI selects a grounded question or permitted action, and reports only saved action outcomes. Two sent unanswered Blueprint texts on the same step can lead to one eligible contextual Bland call; failed/queued texts never trigger it and a reply or step change cancels the stale escalation. Reminders can refer to calls, deposits and letter tasks only when those tasks exist; proof-required steps do not close on a promise. |
| CB-07 | The Fundhub team handles exceptions; no named advisor is assigned. | No staff person is auto-assigned on purchase, and no assignment is the normal state. STOP/exception/closing-prep work and client help requests reach the Fundhub team CSM queue under existing rules. A saved staff link that is demo, disabled or another company's is shown honestly as broken. |
| CB-08 | Closer dashboard and Present show the same file context. | Both surfaces read the canonical client record, including Blueprint price/access, contract status, current step, recent conversation/call notes and Fundhub team follow-up. No separate browser-only history is the source of truth. |
| CB-09 | Provide the offer's monthly credit refresh during the included year. | Separate eligible monthly requests and genuine saved provider results update the plan/letters, with consent, access and provider gates preserved. A queued request is not a completed pull. This buyer-workspace build does not activate FinanceOS or authorize a new live pull merely to open the plan. |
| CB-10 | Detect missing purchase/delivery work. | Payment inbox and paid-without-access checks go red on failed or overdue saved results; health or page-load success alone is insufficient. |

## Real buyer workspace — owner-set November 2, 2026

The buyer is a newly paid high-ticket Capital Blueprint client. The job is to answer "What should I do first now that I paid?" with usable instructions and saved progress in the actual authenticated portal. Personal credit, business preparation and banking can proceed together. Ask one relevant setup question at a time and reuse the client's existing file instead of choosing a fictional profile or requiring a new report purchase.

| Requirement | Authorized behavior and observable result |
|---|---|
| R01 | Open the real paid-buyer start screen with one clear action. Setup and each saved action survive refresh; loading, empty and failed-save states remain usable. |
| R02 | Turn actual UnderwriteIQ findings and the current checklist into short lessons: why, exact actions, current official destinations, needed funds, proof, next review and help. Missing report data remains unknown. |
| R03 | Use the business's actual formation/operating states. Link current official state filing instructions and identify any official-office lookup fallback; do not invent a state fee or processing time. |
| R04 | Recommend a single-member ("sole member") LLC and basic name for a new plan. One member means one owner. Later C/S corporation tax elections remain a later decision; existing ownership stays accurate. |
| R05 | Support three or four separate businesses prepared over roughly 12 months. These are separate business records, not several members in one LLC, and the target is not an instruction to file all at once. |
| R06 | Keep each business's name, actual activity, ownership, formation/operating state, formation date, ownership history, operating history, EIN/formation documents, website and banking milestones separate. |
| R07 | Distinguish a planned entity, reported formation, reviewed evidence, actual operations and readiness. Time and entity age never establish operating history, eligibility or funding approval. |
| R08 | Review existing businesses before adding plans. A preparation record does not overwrite a canonical business or silently count as another operating company. |
| R09 | Explain name/profile/industry flags using saved facts. A basic name or reference-list NAICS code is not a reason to misdescribe real business activity or claim lender approval. |
| R10 | Provide a usable website lesson and copyable prompt using that business's actual details. Ask for missing facts; do not invent revenue, reviews, credentials or history. |
| R11 | Teach consistent public details, relevant Google Business Profile eligibility, Yellow Pages and other appropriate listings. Help clients improve discoverability without promising first-page placement. |
| R12 | Keep business-credit/fuel/fleet tools optional and tied to a real operating need. Provide reviewed official research destinations and current-terms checks. David's specific gas-card walkthrough remains a named missing input until supplied; older training does not prove today's reporting, discounts, guarantees or approval. |
| R13 | Use the saved location to show up to five distinct actual local credit-union candidates with directory date, real branch location and honest location/distance method. Membership, exact account and cash fit need source-backed review; do not pad a list with distant statewide names or call unknown eligibility approved. |
| R14 | Explain ChexSystems/checking reports, requesting the actual report and disputing specific errors; guide a client with an opening issue to the right review. Do not promise removal of accurate records or open an account automatically. |
| R15 | Guide early one-to-three account relationships at a pace supported by existing accounts, cash, income and confirmed account fit. Saving a plan does not open, fund or verify an account. |
| R16 | Offer secured-credit education when actual thin-file/account facts make review relevant. Do not turn a missing report into an instruction to apply for a new card. |
| R17 | Use one practical cash plan for bills, buffer, paydowns, entity costs and deposits. Preserve unknown amounts, identify overcommitted funds and save actual opening/deposit dates and amounts separately from planned dates and reviewed seasoning requirements. |
| R18 | Show the current credit action and useful business/banking work that can happen alongside it, with dependencies and waiting states. An optional revenue task must not block required credit work. |
| R19 | Save per-step/per-business review dates. Offer usable Google Calendar event creation and calendar export, explaining that the client must save/import the event and set reminders; a link/export is not a connected two-way calendar service. Explain relevant review triggers when dates or circumstances change. |
| R20 | Offer optional merchant-processing/customer-financing education and a Fundhub handoff for the appropriate Whop, Commas or Clarity route. The provider makes the approval decision; customer financing and payment processing are separate from buying Blueprint. |
| R21 | Use actual available partner/referral destinations and terms. Fundhub's own checkout or an existing-account data connector does not establish a client merchant partnership. Missing Whop/Commas/Clarity referral URLs and account-specific setup stay explicitly pending. |
| R22 | Teach authorized-user review from the actual account/finding. Consider whether an account helps or hurts; do not blanket-remove useful accounts or treat removal as verified from a promise. |
| R23 | Explain supported employment/business-owner setup and income documentation for the client's actual circumstances, including genuine payroll/tax treatment when applicable. Never invent employment, revenue or an ownership percentage. |
| R24 | **FinanceOS is NOT LIVE** (owner correction, November 2). Current work uses saved client updates, real uploads, existing available credit-file results and actual review. Preserve existing soft-pull capability without claiming automatic bank verification or activating future FinanceOS. |
| R25 | Upload real documents and attach them to the correct scoped business. Keep client-reported progress, evidence received, staff review and credit-report verification distinct; retries and refresh must not fabricate completion or duplicate proof. |
| R26 | Derive company/client identity from the authenticated buyer session and enforce active paid-year access on reads and writes. Refuse foreign businesses/documents and client-supplied verification status. Save blocked-step help in the existing client conversation. |
| R27 | Use Alec Dupesh's actual repo material as the preparation foundation and verify current official filing/bank facts. Reuse the sequence, not historical canned KYC/revenue/industry answers or unsupported product claims. |
| R28 | Keep owner time-warp/rehearsal controls in the fictional preview only. They cannot change real customer dates, evidence, funding readiness or external accounts. |
| R29 | Preserve offer-review gaps as explicit work, including David's walkthrough and actual merchant referral destinations. A pending external input is not a completed service or an omitted feature. |
| R30 | Complete required source checks, focused database/browser proof, GitHub delivery, protected release and authenticated deployed buyer-path proof. Record exact evidence and any unproved prerequisite; a private demo, commit or passing fixture is not a live customer result. |

## Knowledge foundation and boundaries

`docs/legacy-strong/README.md` maps Alec's full gitignored source tree at `credentials/notion-scrape/output/`. The formation/EIN/banking foundation is `opening-llc--59d3968e/page.md`, `get-ein--fda2d58f/page.md`, `details-aged-corp--1b8c3aa7/page.md` and `aged-corps-open-biz-checking--20dc3aa7/page.md`. The latter aged-corporation material concerns purchased or two-plus-year entities; the current owner request is to prepare several businesses now for a future roughly twelve-month review. Those facts must not be substituted for one another.

Reusable historical fleet-card training was found in connected Drive: [15. Tier 2 Accounts](https://docs.google.com/document/d/1NM2mo9VXGPjXoikuymsO1jpmxt4wd1C7/edit) and [16. Tier 3 Accounts](https://docs.google.com/document/d/1ZMNfH63mVHlvl-T2ouydbVNAJZFsjYiC/edit), prepared by Eloisa Cabesas in September 2025. These are not identified as David's promised walkthrough. Provider details require current official confirmation before a specific recommendation.

## Publication and external proof

The owner requested the real build and its delivery. Continue through the repository's existing review/release gates and record the deployed authenticated result. This scope does not itself form an entity, submit a credit application, move money, make a new live charge/pull/call or activate FinanceOS. Tests and source existence do not establish any such external result.
