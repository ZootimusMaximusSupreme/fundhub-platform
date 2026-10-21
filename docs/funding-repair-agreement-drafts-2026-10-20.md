# Funding and credit-repair agreement drafts — 2026-10-20

> Recovered 2026-10-20 by Set A lane L5 from the Codex session log (rollout-2026-10-20T02-46-55, its apply_patch calls replayed in order). Codex wrote this file and the funding template in a temporary worktree that was later pruned, so neither ever reached git. Wording unchanged except: owner decision 2026-10-20 (the signed contract is the consent) added section 8, CALLS, AI AND YOUR STORY, to the ready-to-send funding template, using the exact words in `src/contracts/consent-clauses.mjs`. The repair draft below must carry the same section before it is activated.
>
> Activated 2026-10-20 (owner direction to finish both agreements): `db/migrations/493_funding_and_repair_agreement_text.sql` makes the ready-to-send funding text the live Funding Agreement, and replaces the Credit Repair Agreement's placeholder block with finished terms built from this draft plus repo facts (round one the day you sign and 30 to 45 days per round from `public/app/present.js`; up to six rounds from `docs/finance/fundhub-offers-review-2026-10-11.md`; right to cancel from Chris's executed agreements in `db/migrations/288_real_contract_text.sql`). The migration header lists the source of every fact. This file is kept as the drafting record.

Internal drafting record only. The completed funding template is [FUNDING-AGREEMENT-ready-to-send.txt](agreements/FUNDING-AGREEMENT-ready-to-send.txt); it has not replaced the live `contract_templates` placeholder or been sent. The repair version below remains non-sendable.

Source of business terms: owner answers recorded in `ops/workflows/heartbeat-finish-2026-10-18.md`. Before the funding wording can replace its placeholder, the public G-03 copy must say clearly that no funding means no *back-end* success fee, while the deposit is returned only if an action guarantee is missed. Before the repair wording can replace its placeholder, the $1,000 collection timing, cancellation notice, and exact signed round schedule must be settled. See [FTC CROA summary](https://www.ftc.gov/legal-library/browse/statutes/credit-repair-organizations-act) and [15 U.S.C. §§ 1679b, 1679d, 1679e](https://uscode.house.gov/view.xhtml?edition=prelim&req=granuleid%3AUSC-prelim-title15-chapter41-subchapterII-A).

## Funding Agreement — draft

**Date:** [date signed]  
**Parties:** Fundhub LLC, a Florida limited liability company operating in Arizona, 218 Bostick Rd 64, Bowling Green, FL 33834 ("Fundhub," "we"), and [client legal name], [client email] ("Client," "you"). If the application concerns a business, its legal name and the signing representative's authority must be recorded here: [business and signer capacity].

### 1. One-time service

Fundhub will review the information you provide, analyze your personal and business funding profile, identify suitable financing sources, prepare and submit authorized applications, and coordinate responses. Covered products are personal and business credit cards, personal and business lines of credit, other business credit, merchant cash advances, and SBA products. A future funding engagement requires a new agreement and may have different terms.

### 2. Deal terms and payment

Your signed deal schedule must state the agreed deposit **[amount]** and success-fee rate **[percentage]** before this agreement can be sent. The standard examples are $3,000 and 10%; Chris or Justice may agree to different figures on the sales call. No blank or default may override the figures actually agreed with you.

The deposit is a one-time payment toward Fundhub's work and is credited dollar-for-dollar against the success fee for this engagement; it is not an additional success fee. The success-fee base is the total of confirmed approved limits or amounts, not the amount drawn on a credit line. A confirmed approval is a lender's approval with a recorded positive dollar amount. The fee is calculated once for each funded round at the rate written in your signed deal schedule, including approved credit cards, lines, business credit products, MCAs, and SBA products. The balance after the deposit credit becomes due as the approved funds are received. Fundhub will provide the approval and payment record used to calculate the amount due. No back-end success fee is charged if no funding is secured.

If an amount properly due remains unpaid after notice, Fundhub may use lawful collection methods and seek a court judgment. Any collection against assets requires applicable process and is limited to assets that may lawfully be reached. Nothing here gives Fundhub a present ownership or security interest in your assets.

### 3. Action guarantees and deposit return

The two action guarantees start when you sign this agreement. Within **24 business hours**, a Fundhub funding advisor will begin working your file. Within **72 business hours**, Fundhub will submit your first authorized applications. Your own delay or error does not pause those two clocks. If Fundhub misses either deadline, you may request return of the deposit. If Fundhub meets both deadlines, lack of approval or funding alone does not return the deposit, and outside changes to your credit reports do not create a deposit-return obligation. No back-end success fee is due without funding. These rules do not limit any non-waivable cancellation, refund, or dispute right.

Fundhub does not promise an approval, funding amount, lender rate, or particular financial result. Lenders make their own decisions. Fundhub is not responsible for your use of proceeds, a lender's application decision, or a credit-report change Fundhub did not cause. This does not excuse Fundhub's express action guarantees or liability that law does not permit it to exclude.

### 4. Limited authority and information

You authorize Fundhub, during this engagement, to prepare and submit financing applications on your behalf using accurate information you supply and to communicate with financing sources about those applications. You also authorize review of your business profile, business records held in Fundhub's system, LexisNexis information where available, soft credit inquiries, analytics, fraud checks, and compliance checks needed for this service. A hard inquiry or any action that requires a separate consent remains subject to that consent; this agreement does not bypass the existing credit-pull gate. Fundhub will use and protect your information for the service and associated security checks, not sell it.

This limited authority does not allow Fundhub to sign a loan agreement, accept funds, change an account, or make a false statement for you. New applications stop when the engagement ends or you withdraw this authority in writing. For up to **60 days after the agreement ends**, Fundhub may verify the status and legitimacy of applications made during the engagement and investigate delayed account reporting; that follow-up period is not authority to submit a new application. Withdrawal does not undo an application already submitted.

### 5. Your cooperation and confidential methods

You will provide complete, accurate, current information, promptly correct any error, and tell Fundhub when approved funds arrive. Fundhub may ask for reasonable records needed to reconcile approvals and fees. Knowingly false information or misuse of the service is a material breach; Fundhub may stop work and retain payment for work already performed, subject to the guarantees above and non-waivable rights.

Fundhub's non-public methods, pricing, lender introductions, materials, and business information are confidential. During this engagement you will not disclose, copy, or use them to bypass Fundhub or compete with Fundhub in any of the covered funding or credit-repair product lines. This restriction ends when this one-time engagement ends; ordinary knowledge, information already public, and lawful communication with a lender, card issuer, bureau, regulator, or adviser are not restricted. Any client-facing operating rule is binding only if provided to you in writing as part of this agreement; private or later-changed repository files are not silently incorporated.

### 6. Ask Fundhub first

**We ask you to contact Fundhub first about a payment concern, a chargeback concern, an application problem, or a financing-company issue so we can try to resolve it with you. By signing, you agree to ask Fundhub for help first when practical, and to share related notices promptly so we can coordinate. This is a request, not a waiver: you may contact your lender or financing company, card issuer, credit bureau, regulator, or other lawful channel directly, and you need not wait for Fundhub if doing so could miss a deadline or protect a right.**

Fundhub may help prepare disputes about inaccurate negative items or personal information on your credit report when you separately authorize that work. Fundhub will not submit an inaccurate claim or prevent you from making your own dispute.

### 7. General terms

The laws of Arizona govern this agreement to the extent permitted by law. An action concerning it may be brought in a court of competent jurisdiction in Arizona, unless applicable law requires another forum. This agreement and its signed deal schedule are the entire agreement for this one-time engagement. A change to price, scope, or guarantees must be recorded in writing and accepted by both parties. If one provision cannot be enforced, the rest remains in effect to the extent lawful.

**Fundhub LLC:** [authorized signer, title, date]  
**Client / business representative:** [signature, printed name, capacity, date]

## Credit Repair Agreement — non-sendable working draft

**Date:** [date signed]  
**Parties:** Fundhub LLC, 218 Bostick Rd 64, Bowling Green, FL 33834, and [client legal name and email].  
**Status:** This is not a complete contract or payment authorization. Keep the current placeholder/send block until the payment and cancellation terms below are resolved.

### 1. One-time repair service

Fundhub will review the client's credit files; identify potentially inaccurate, incomplete, or unverifiable negative items and personal information; prepare appropriate dispute materials; and carry out the dispute rounds listed in the signed round schedule **[attach exact dates, recipients, and work for each round]**. The first round begins on **[agreed start date, after any required cancellation period]**. Subsequent rounds occur on the agreed schedule. Fundhub will provide the client copies or portal access to the work and responses. Accurate, current information may remain; no score change, deletion, or particular result is promised.

### 2. Price, collection, and refund trigger

The one-time price discussed is **$1,000**, or another amount stated in the signed deal schedule. The fee is not charged or received until all services specified in this agreement have been fully performed. No upfront charge is authorized by this draft. If Fundhub fails to start the first round on the agreed date or fails to carry out an agreed round on its signed schedule, the client may request return of any fee paid. A bureau's response or failure to remove an item is not itself a breach of that service guarantee.

### 3. Limited dispute authority and client rights

The client may authorize Fundhub to prepare disputes about inaccurate negative items and personal information. Any submission on the client's behalf remains subject to required identity verification, the client's separate dispute authorization, truthful supporting facts, and any required client signature. The client may withdraw that authority. The client keeps the right to dispute directly with a bureau or furnisher and to contact a card issuer, lender, regulator, or other lawful channel.

**We ask the client to contact Fundhub first about a payment or service concern so we can try to resolve it. By signing, the client agrees to ask Fundhub for help first when practical. This request does not delay or waive any direct dispute, cancellation, billing-error, or complaint right.**

### 4. Remaining completion fields

Before activation, supply the exact signed round schedule and completion estimate; attach the required credit-file-rights disclosure and cancellation notice; put the required cancellation statement next to the signature; and verify the signing flow gives the client the required copy. The client's deadline and address for cancellation must be stated in the final copy. The repo's six-round plan describes possible work but does not establish the client's promised dates or completion estimate. These are deliberate unsatisfied fields, not defaults to be guessed.
