# Delete fake test data — 2026-10-20

Owner order (Chris, 2026-10-20), answering "Delete the fake test data — every client, lead, booking and funding round except Braum? yes/no": **"delete data yes"**. This is the CLAUDE.md §11 ask-first item, answered.

Board for the launch: `ops/workflows/launch-100-2026-10-20.md`. This job is one session, one transaction. It can't be split.

| Step | Status |
|---|---|
| 1. Read-only map and plan (this file) | done |
| 2. Backup of every row to be deleted or changed | done (inside the delete transaction, same snapshot) |
| 3. One-transaction delete, recount inside, roll back on any mismatch | done, committed |
| 4. Read-back | done, clean |
| 5. Counts to the coordinator | done |

## How it was mapped (read only)

- Live database, as `fundhub_app` on the 6543 pooler, inside `BEGIN READ ONLY` (no bare `SET`). `fundhub.actor=staff` set with `set_config(..., true)` for this transaction only, so tables split by partner are visible.
- Walked all 820 foreign keys down from the fake clients until nothing new turned up. Every table has a primary key. There are 310 tables.
- No client-less bookings exist. There is no separate leads table: a lead is a `clients` row tagged `lead:*`.
- Every row in the plan was checked against the rows tied to the kept, held and locked clients. Overlap: **none**.

## Who goes, who stays

124 clients today.

| Group | Count | What happens |
|---|---:|---|
| Fake test clients | 100 | **Deleted**, with everything tied to them |
| Braum (FH-000507) | 1 | Kept. Not touched (no-contact, no-change). |
| App Store review login (FH-000844, `client@fundhub.ai`, `FDH-TEST-CLIENT-ROLE-ACCOUNT`) | 1 | Kept. Apple review needs it. |
| FH-000513 ("Test Test", Chris's own Gmail) | 1 | Kept, not changed. A $20 Plaid **sandbox** money transfer points at it. The database locks money transfers so they can never be deleted, and the app login has no delete right on them. The lock was not broken. Its 3 sandbox bank links, 14 sandbox accounts and 1,183 sandbox bank lines stay with it. |
| Real-looking people | 21 | **Held, not deleted.** Real names and real business emails. They came from ClickFunnels survey leads (16, August bookings), SLO ad buyers or leads (3), a website lead, and 1 lead added in the new CRM. One SLO buyer (FH-000530) has a real $32 Commas order. Two (FH-000531, FH-000532) have portal logins. One question went to the coordinator. |

Fake = test email patterns only: `example.com`, `example.test`, `test.fundhub.ai`, `e2e+`, `demo.fundhub.local`, `csmq-*`, Chris's own test addresses (`stanbridgejchris*`, `bakerskater987*`, `stanbridgelargecoc*`, `stanbrdgejchris@gmsial.c.om`, `info@fundhub.ai`), `balls@gmail.com`, `bigboy@littleboy.com`.

Fake client codes (100): csmq-13750, csmq-453, csmq-55225, csmq-98724, FH-000504, 508–512, 514–529, 533, 534, 537–566, 670–672, 677, 689, 691, 694, 702, 705, 709–711, 714, 715, 721, 723, 725, 727, 728, 730, 731, 738, 759, 761, 763, 769, 773, 774, 777–785, 794, 799, 803, 811, 841.

Held codes (21): FH-000530, 531, 532, 567, 713, 719, 724, 732, 786–793, 795–798, 843.

## The plan: 817 rows in 47 tables

| Table | Rows | Table | Rows |
|---|---:|---|---:|
| clients | 100 | events | 192 |
| tasks | 76 | client_waypoints | 45 |
| cards | 44 | entitlements | 37 |
| transactions | 36 | conversations | 27 |
| documents | 24 | messages | 23 |
| invoices | 22 | payment_links | 19 |
| document_versions | 18 | accounts (client logins only) | 14 |
| bookings | 14 | client_ad_attribution | 14 |
| sales | 13 | client_custom_fields | 11 |
| sale_payments | 11 | repair_programs | 7 |
| funding_rounds | 5 | funding_round_sales | 5 |
| client_consents | 4 | crs_results | 4 |
| card_liabilities | 4 | card_liability_history | 4 |
| tradelines | 4 | pii_identity | 3 |
| commission_ledger | 3 | clarity_payments | 3 |
| clarity_payment_installments | 3 | sale_attributions | 3 |
| subscriptions | 3 | waypoint_nudges | 3 |
| money_agent_tasks | 3 | affiliate_referrals | 2 |
| client_authorized_reps | 2 | dispute_items | 2 |
| money_agent_log | 2 | contracts | 1 |
| pii_access_log | 1 | soft_pull_requests | 1 |
| account_sessions | 1 | account_magic_links | 1 |
| dispute_letters | 1 | dispute_cases | 1 |
| blueprint_bank_relationship_todos | 1 | | |

Rows that are changed, not deleted:
- `clients.is_demo = true` on the 100 fake clients first. This is the switch the delete guards already honor for test rows (invoices, documents, contracts, entitlements, commission ledger, affiliate referrals). No guard was turned off.
- `documents.current_version_id` cleared on the 24 fake documents, so each document and its versions can go (they point at each other).
- The database's own "set to blank" links: `agent_runs.client_id` (6 rows) and `account_sessions.active_client_id` (3 rows).
- The 2 fake affiliate referrals belong to a test affiliate ("payoutrun basic", made Oct 12). Deleting them makes the database recount that affiliate's balance. That one affiliate row is the only config row that changes.

Not touched: staff, message templates, lenders, the bank list (`outreach_accounts`), products, offers, agents, settings, pipelines, contract templates, partners, affiliates (other than that one recount). No schema change, no send, no charge, no deploy.

## Guards in the delete transaction

`REPEATABLE READ`, one transaction:
1. Recount the fake, kept and held lists and the whole 817-row map. Any difference from this plan → roll back.
2. Count all 310 tables. Fingerprint the rows of Braum, the App Store login, FH-000513, the 21 held people, staff and every config table.
3. Write the backup (every deleted or changed row, one JSON file per table) and read it back. Short → roll back.
4. Delete children before parents. Each statement must hit exactly its planned count.
5. Run the end-of-transaction checks early. Every table must drop by exactly its planned count; every other table must be unchanged. Every fingerprint must be unchanged, except that one test affiliate. Otherwise → roll back.

Dry run (same script, rolled back): all checks passed, clients 124 → 24.

Backup: `credentials/backups/delete-fake-data-2026-10-20/` (gitignored), one JSON file per table plus `manifest.json`.

## Result — committed 2026-10-20

- One transaction, committed. Every statement hit exactly its planned count. All 310 tables were counted before and after. The 47 planned tables dropped by exactly the plan (817 rows). Every other table stayed the same.
- Inside the transaction: Braum, the App Store login, FH-000513, the 21 held people, staff and 28 config tables had the same fingerprint before and after. The only change was the one test affiliate's balance recount (planned).
- Backup: `credentials/backups/delete-fake-data-2026-10-20/`, 51 files (47 deleted tables, 2 set-blank files, 1 affiliate, `manifest.json`), 827 rows, 1.1 MB.
- Read-back, fresh connection: 0 planned rows left. Clients 124 → 24. Braum unchanged (last changed 2026-10-07). App Store client and its login (`client`, `active`) unchanged. The 75 rows tied to the kept clients, 265 tied to the held people and 736 tied to FH-000513 all match the plan. Staff 35. Funding rounds 0. Invoices 0. Bookings 15 (all held people). Templates 198, lenders 1,106, bank list 11,568, products 11, agents 29.

## Round 2 — fake records with no client attached (committed 2026-10-20)

The lanes found fake rows with no client link, so round 1 could not reach them. In scope here: fake leads, bookings, calls and rounds with no client, plus 2 test payments.

- **Deleted: 793 events and 2 transactions**, in one committed transaction with the same guards. All 310 tables were counted before and after. 76 sets had the same fingerprint before and after: every client's rows, config, and all other events and payments.
  - The events: entry.captured 429, survey.submitted 226, booking.created 56, booking.noshow 15, slo.contact_started 16, call.completed 10, slo.checkout_started 9, round.started 11, round.submitted 5 (the 4 demo seeds included), round.closeout 5, round.approved 4, round.funded 4, booking.cancelled 1 (and the `bk_pg1` fixture), repair.round.escalated 1, rb2b.visitor_identified 1.
  - Rule: no client, and either flagged demo with no email, or every email inside is a test address. The test addresses are example.com, e2e+, Chris's own test addresses, `*+fhtest`, `demo+proof` and `info@fundhub.ai`.
  - The 2 payments: `2b057970…` (gauntlet, bakerskater987+test) and `c3301a1f…` (ORD-SYNTH, test+crs@fundhub.ai). Both were $32, both had no client.
- **Not deleted, on purpose:**
  - 3 fake events that rows in the `failed_events` log point at. That log can never be deleted from, and blanking its link breaks its one-row-per-event rule.
  - 564 client-less events that carry real-looking emails. These include August ClickFunnels bookings and surveys from the held people and from people who are not in `clients` at all. A lane called the August bookings fake. They are not proved fake.
  - About 7,000 anonymous site events (funnel.*, slo.visit, slo.engagement). That is real traffic.
  - FH-000567 and FH-000843 events: those clients are held.
- Backup: `credentials/backups/delete-fake-data-2026-10-20/round2/` (795 rows).
- Read-back: 0 planned rows left. Clients still 24. Braum unchanged. Transactions 6, events 8,899.

## Rounds 3 and 4 — owner said "DELETE YES — I HAVE THOSE LEADS SAVED" (committed 2026-10-20)

Each round ran as one transaction with the same guards: rebuild the plan inside the transaction, back up, delete at exact counts, run the end checks early, count every table (311) and fingerprint everything outside the plan.

**Round 3: the 21 held clients and lead events with real emails.** 829 rows deleted: events 684 (564 client-less lead events with real emails, plus 120 tied to the 21), clients 21, messages 34, cards 20, tasks 19, client_custom_fields 14, bookings 14, conversations 8, client_ad_attribution 4, account_magic_links 3, payment_links 3, transactions 2, accounts 2 (client logins), entitlements 1. 96 sets outside the plan were unchanged. Backup: `.../round3/`.

**Round 4: test data that is not a client.** 1,189 rows deleted:
- events 1,016 (other client-less fake events: message.queued, docs.received, analysis.completed, decision.rendered, payment.*, contract.* and others)
- 26 test ad accounts (4 Meta, 22 TikTok), with campaigns 26, ads 9, ad_sets 4, ad_metrics_daily 7 and spend_ceilings 1
- partner_module_settings 24, social_channels 22, social_posts 10, partner_ai_usage 9, partner_onboarding_tasks 6, cards 6
- 14 test partners, with 3 partner logins (example.com) and 2 of their sessions
- generation_jobs 1, partner_brand 1
- test affiliate AFF-000180 "payoutrun basic"
- the demo marketing_content_queue row

101 sets outside the plan were unchanged. Backup: `.../round4/` (it also holds the 18 partner rows as they were before the demo flag).
- **Kept, locked:** 18 test partners own rows the database never lets go (action_log 11, creative_assets 10, compliance_screenings 9, creative_usage_events 4). Those also pin 4 test ad_scripts and 1 brand kit. These 18 partners are now `is_demo = true`. Their posts, ad accounts, settings and logins are gone.

**Live after all four rounds (fresh read-back):**
- Clients 3: Braum FH-000507 (unchanged since 2026-10-07), App Store login FH-000844 (login active), FH-000513 (kept because of the locked sandbox money transfer).
- Bookings 1, transactions 4, events 7,199, social_posts 0.
- Ad accounts 1 (the real Meta account). Partners 31 (19 demo; real ones are fundhub-house, fundhub-direct, gpn-funding).
- Affiliates 24, staff 35. Neither is touched yet; see below.

**Round 5 (committed):** 2 raw ClickFunnels booking captures in `webhook_captures` (`843d2310…`, `32ae1125…`, Oct 10, provider uids 74249 and 74237). Both were for FH-000567, a client deleted in round 3. With the booking gone, calls:booking-webhook counted them as lost bookings. Checked first: insureboost and the uids are in the payload, there is no booking or client left, and nothing links to them. Only those 2 rows changed. Backup: `.../round5/`. Other raw webhook captures for deleted clients were not swept.

**Round 6 (committed, owner yes relayed by the coordinator):** the 2 test commission rules from the Aug 21 money-chain test are deleted: `bdd28f6e` "MC advisor 0.25% funded" (it was active, had no end date, and was the only funding-advisor rule on Card Stacking DFY) and `f7578579` "MC closer flat deposit" (ended 2026-08-23). Nothing pointed at them (no ledger or other rows), so nothing had to be end-dated. commission_rules went 11 → 9. Every other table and row was unchanged, including the other rules, staff, products and the ledger. Backup: `.../round6/`. The fake staff "Money Chain Closer" (EMP-000042) is still there; fake staff wait on Chris.

## Left over (not done here)

1. **Fake staff and fake affiliates.** Chris asked about these after rounds 3 and 4. They were outside every round so far. They are listed for his yes or no:
   - Staff: 14 Oct-12 test fixtures (example.com), 3 DEMO staff, Mock Closer Sign, and 5 made-up seed people from Jul 31, all suspended and never logged in.
   - Affiliates: about 18 test or sim or demo affiliates.
   - Kept no matter what: Chris, Sarah Blankstein, Justice Nikkel, the TEST role logins that agents use for checks, TEST — Client Role (the App Store login), and the 5 real-looking affiliates.
2. **FH-000513** and the 18 locked test partners stay. Their locks can't be broken without a schema change.
3. 3 fake events still have rows in `failed_events` pointing at them, so they stay.
4. Not touched: raw webhook logs, `workflow_runs`, the `pulse_*` history, anonymous site events, and older Aug test partners (test-role-partner, e2e-wl-*, sim-wl-*, demo-partner).

## Restore

Each file in the backup is a JSON array of full rows. To put a row back, insert parents before children (the reverse of the delete order above). Re-inserting a fake document needs its version first and the `current_version_id` link set after.
