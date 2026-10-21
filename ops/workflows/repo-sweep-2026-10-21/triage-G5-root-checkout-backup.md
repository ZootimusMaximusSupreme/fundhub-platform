# G5 — origin/backup/root-2026-10-21 (c3c85853482db59c6b77312d6ffb95425fe8fc43)

Read-only triage. Main pinned at 97860f77064855826d5d7cc41585d7d7145deda3.
Backup = snapshot of the root checkout's uncommitted work on top of 65314e2cf
(tip of origin/codex/two-ios-apps-launch, open PR #68). 179 files vs its parent:
97 added, 82 changed, +11,497 / -295 lines. No PR exists for the backup branch.

## Overall verdict (one line)

MIXED, mostly LANDED. 114 of 179 files are already on main (59 byte-identical, 55 where main has a NEWER version of the same work).
65 files are NOT landed on main (the 56th "main differs" file, db/expected-migrations.mjs, belongs to the stranded invite group). Only 16 of them exist on another branch (two other backup branches). Of those, only
3 small groups are real code at risk: **permanent client portal invites (auth + a migration)**, **LNR business report desk**,
**Prompter thank-you card switch from TestFlight to App Store**. The rest is boards, old evidence, and tool config.

How the check was done: for every file, backup blob vs main blob; for changed files, every line the backup added
(vs its parent) searched in main's file; then every one of the 254 local+remote refs scanned for the same blob
(and for the unique strings `PERMANENT_PORTAL_INVITE`, `api/finance/lnr-business-report.mjs`, `apps.apple.com` in the prompter JS).
No secret values were found in the added lines (pattern scan for key/token shapes: none). No credential files in the diff.

File tally against main: SAME 59 | MAIN_DIFFERS 56 (55 main newer + db/expected-migrations.mjs) | NOT ON MAIN, new files 49 | NOT ON MAIN, edits on top of the parent 15.

## Table — one row per cluster

| cluster (files) | class | evidence | what it does, plain words | action |
|---|---|---|---|---|
| A. Capital Blueprint checkout, price, advisor/voice context (40 files: src/payments/whop-blueprint*, src/messaging/providers/whop-payments.mjs, src/contracts/blueprint-price*, src/config/offers*, db 482/483/485, src/sales/closer-deck*, src/agents/context*, voice-context*, present.js, closer-call.js, e2e/blueprint-price-context.spec, capital-blueprint journeys) | 1 ALREADY ON MAIN | 24 files byte-identical. 16 are older than main. Landed in PR #83 (commits 8cfbe91aa, 45db38d41), merged 2026-10-20. Main is newer: Whop calls go through the outbound fence (`transmit`), voice-context has the Blueprint coach branch, labels say "Fundhub team" (not "human advisor"), money-banks/present fixes later. | Sells the $5k-$10k Blueprint through Whop, and gives the AI/phone agents the saved client file. | mark done (on main via PR #83). Do NOT take the backup copies of the 16 older files. |
| D. Whop billing inbox + sweeper (14 files: src/payments/whop-billing-*, src/workflows/whop-billing-inbox-drain*, netlify/functions/whop-billing-inbox-sweeper.mjs, gap-whop-billing*, netlify.toml, src/pulse/heartbeats/tripwires/modules, src/workflows/index.mjs, register-all) | 1 ALREADY ON MAIN (backup copies are OLDER) | 6 identical (PR #83). 8 differ and main is newer: PR #113 (3a6e48336, "Stop burning Inngest", merged 2026-10-21) moved every cron to one Netlify clock, sweeper now `*/5`. Backup `src/workflows/index.mjs` re-adds 25+ Inngest crons main removed; backup `netlify.toml` lacks 37 lines of Netlify schedules; backup sweeper is `* * * * *`. | Picks up Whop payments that webhooks missed, every few minutes. | mark done (on main via PR #83 + PR #113). Taking backup copies would REGRESS the Inngest fix. |
| E. Invoice checkout retirement + per-round consulting invoices + AR copy (31 files: src/payment-links/*, src/handlers/invoice-checkout-retirement*, src/workflows/invoice-checkout-retirement-sweeper*, ar-collections*, src/invoices/*, db 484/486/487, beat+gap for retirement, portal-summary) | 1 ALREADY ON MAIN (backup copies are OLDER) | 20 identical. 11 older: main = PR #85 (980855c15, merged 2026-10-20) and later. Main is stricter: outbound fence on Commas GET/DELETE, invoice-row lock + one-open-link index, tests the backup lacks. Backup `db/migrations/484_basic_business_consulting_invoice_copy.sql` is the OLD unguarded version (updates every org, no insert of missing templates); main's guarded version is the one that is applied. Backup 486 differs only in a comment. | Sends one invoice per funded round, closes the old Commas checkout link when an invoice is closed, and keeps the reminder texts/emails in plain "consulting fee" words. | mark done (on main via PR #85). Never take backup 484/486 or backup src/payment-links/*. |
| F. Funding-fee-task reconcile (5 files: src/funding/reconcile-fee-tasks*, scripts/reconcile-funding-fee-tasks.mjs, billed-fee-check*) | 1 ALREADY ON MAIN | 4 identical; billed-fee-check.test: every added line is in main. PR #85 (980855c15). | Finds funded rounds that should have a fee task and fixes the list. | mark done (on main via PR #85). |
| G. Cortana funnel tracking (4 files: public/funnel/fh-events.js, src/ads/fh-events-*, docs/tracking/tracking-spec.md) | 1 ALREADY ON MAIN (backup is an early draft) | Main fh-events.js has a larger Cortana block (pending queue, session storage, hub loader, accepted-event map). PR #85 (980855c15). | Sends first-time book-a-call steps (watch, apply, calendar, booked) to Cortana. | mark done (on main via PR #85). |
| H1. Agent rules (finish-the-requested-job, split-and-proceed, settings.json; CLAUDE.md, AGENTS.md, .env.example) | 1 ALREADY ON MAIN | 4 identical (6d2103c89, a59f2c394 via codex/bank-relationship-outreach); CLAUDE.md/AGENTS.md "split, then do" + "finish the outcome" text is in main; .env.example every added line in main. | The standing owner rules. | mark done. |
| H2. .agents/skills (15 files) + .codex/hooks.json | 4 OBSOLETE / DUPLICATE | Not on main. Also on origin/backup/exciting-ramanujan-2026-10-21 and origin/backup/nervous-swanson-2026-10-21 (blobs identical). 10 of the 15 skills are byte-identical to main's `.cursor/skills/<same name>/SKILL.md`; 3 differ by one line or a shorter push skill; `clickfunnels-developers-docs` already lives on main under `.claude/skills`; only `source-command-flywheel` (127 lines) is on no main path. hooks.json is Codex hook config. | Codex-side copies of the Cursor skills and a session hook. | mark obsolete (already kept on two other backup branches; copy from .cursor/skills if Codex needs them). |
| H3. ops/workflows/AGENTS-local-backup-2026-10-12.md (49 KB) | 4 OBSOLETE | A copy of an old AGENTS.md. Not on main. | Old rules snapshot. | mark obsolete. |
| I. Teleprompter live evidence for commit 0b42d2de (8 files, 4 JSON + 3 PNG + 1 JSON, ~1,077 lines + 3 images) | 4 OBSOLETE | Not on main, no other branch. Main's same folder already holds 26 evidence files for earlier commits (e.g. 555307ba). These are 2026-10-13 bot results, not a fresh run. | Old pass/fail proof of the teleprompter pages. | mark obsolete (keep on backup branch only). |
| J. Ops boards (14 not on main + 5 where main has a newer copy) | 4 OBSOLETE (docs only) | Not on main: pulse-2026-10-18.md (388 KB generated morning report), 10-17 iOS docs (apple-2.1-reply-draft, ios-release, live-platform, release-proof: main has the FINAL answer in `two-ios-apps-launch/app-review-final-notes.txt` and `app-review-response.md`; live-platform's red items (missing templates) were fixed by migration 497), 10-10..10-13 small boards (one-main-branch, heartbeat-code-status, leads-referrer-sorting, cortana-funnel-setup, art-finance-survey-funnel, justice-email-setup), codex-finish + launch-100 (+20 lines of notes on PR #104/#112/Cortana feed). Main newer copies: heartbeat-finish-2026-10-18, dashboard-overhaul, 5k-10k-offer-readiness, funding-fee-invoices-cortana. File `heartbeat-tripwire-repair-2026-10-13.md` is really an affiliate-email draft (names a third party's email). `justice-email-setup` names a staff member's personal email. No secrets. | Working notes and old proof. No code. | mark obsolete. If Chris wants the history kept, leave the backup branch in place; do not merge. |
| N. Banks page "staff or client" fix + desk fixes (11 files: api/money/banks.mjs, public/app/money-banks.js, money-banks tests, inquiry-remover.html, pulse proof tests fin-b07/fin-b13, fundhub-brand.css) | 1 ALREADY ON MAIN (different way) | Same bug fixed on main in 4e613e037 (PR #70, merged 2026-10-20): main's page asks `/api/auth/session` for the role instead of the backup's server flag `viewer_kind`; main's inquiry-remover has the `on_hold`, Enter-key, 25-at-a-time, "worked" count fixes; main has the "Banks page trusts the signed-in role" test. | Makes the Banks page show staff controls to staff only, and fixes the specialist desk queue. | mark done (on main via PR #70). Leftover (tiny, optional): `src/pulse/catalog/proofs/fin-b07-desk-page.test.mjs` +2 assertions about the Hold column (not on main). |
| **K. Permanent client portal invites (10 files)** | **2 STILL NEEDED, NOT DESIGN** (has a migration) | **NOT on main; no other branch** (scanned all 254 refs). Main's `src/auth/magic-link.mjs` equals the parent's, still 15-minute links. See "Stranded work" below. | Staff-sent client portal invite links never expire; they work once. Self-service sign-in stays 15 minutes. Adds a new email template. | bring up to date + PR (fresh branch off main), after Chris re-confirms; exact files below. |
| **L. LNR business report desk (6 files)** | **2/3 MIXED** (API+tests = 2, incomplete; HTML page = 3) | **NOT on main; no other branch.** Main's own boards (fundhub-push-setup.md, two-ios-apps-launch.md, funding-fee-invoices-cortana-2026-10-20.md) say the file is untracked and not routed and that its page/route lack registry rows. `src/finance/crs-client.mjs` on main already has `searchTopBusiness` and `pullTopBusinessReport` (16ff30d04). | Staff-only (owner/admin) form: search a business at LNR/CRS, pick the match, pull the Comprehensive Business Report. | list for Chris/Codex. API part is not shippable as is: no route in `netlify/functions/api.mjs`, no page row in `src/pulse/registry.mjs`, no tripwire decision; adding the file alone fails `src/http/routes.test.mjs`. |
| **M. Prompter thank-you card: TestFlight to App Store (7 files)** | **3 DESIGN / CODEX-OWNED** | **NOT on main; no other branch** (JS scan: `apps.apple.com` appears in no other ref). Main still has the TestFlight regex and button words. | Changes the visible words and link rule of the Prompter download card on the thank-you page: "Get it on the App Store", must match `apps.apple.com/.../id6823825669`. JSON setting stays empty, so nothing shows until a URL is saved. | list for Chris/Codex. Depends on the app really being public on the App Store. |
| M2. cf-push-snapshots head/footer html (2 files) + fundhub-live-marketing-push-preference.png | 4 OBSOLETE | Records of what was pushed to ClickFunnels page 25063539. The sources are on main: `marketing/landing-pages/05b-thank-you-fit.html`, `tracking-manifest.mjs` key `apply-thank-you-fit`, `public/funnel/funding-paths.js`. | Copies of live page code. | mark obsolete (sources on main). |
| O. research_notes/Licensed finance software access/vendor_routes.md (15 KB) | 4 / keep-as-note | Not on main. Research (2026-10-20) on how to license CRS/LexisNexis business reports, Plaid, etc. No secrets. | Notes only. | list for Chris (keep with the LNR work if that is revived). |

## STRANDED WORK (not on main, not on any other branch)

### S1. Permanent client portal invites — touches auth AND a database migration

| path | size (added/removed lines) | note |
|---|---|---|
| db/migrations/480_permanent_client_portal_invites.sql | +30 | Drops and re-adds CHECK `account_magic_links_issued_ck` so an `issued` link may have NO expiry; inserts template `EMAIL-PORTAL-PERMANENT-INVITE` for every org (ON CONFLICT DO NOTHING). |
| db/seed/035_portal_permanent_invite_template.sql | +20 | Same template insert again (redundant with the 480 insert). |
| db/expected-migrations.mjs | +2 | Adds the two names above. |
| src/auth/magic-link.mjs | +11 / -6 | New `permanent` flag + `templateKey`; `issuePortalLinkForClient` now ALWAYS mints a no-expiry, one-use link with the new template; verify accepts `expires_at IS NULL`. |
| src/auth/magic-link.test.mjs, src/auth/magic-link.pg.test.mjs, src/http/s2-message-routes-auth.test.mjs | +4/-2, +32/-1, +6/-4 | Tests (the pg test needs a scratch DATABASE_URL). |
| api/auth/send-portal-link.mjs | +2 / -1 | Comment only. |
| src/messaging/merge-tags-registry.mjs | +1 / -1 | Allows `magic_link.` tag in the new template. |
| ops/workflows/permanent-client-portal-invites.md | +17 | Board: owner decision "invites are single-use and do not expire". |

Flags:
- **Migration: yes.** It would apply to production on the next production deploy. Do not merge blindly.
- Number status: **480 is a free slot on main** (main has 479 then 481; 500 and 501 are also free). Main's migrations 482-499 and 502 exist. The runner applies by file name, so an out-of-order 480 would run as "pending". Seed `035` is a CLASH of number only: main already has `db/seed/035_client_agreement_consent_clauses.sql` (also 036, 037); different file name = different key, but `db/expected-migrations.mjs` would conflict (main added 482-502 and seed 035-037 lines). Rename the seed to a free number or drop it (480 already inserts the same template).
- **Never take the backup's `db/expected-migrations.mjs` whole**: it deletes the 482-502 and seed 035-037 entries and would make the health check report missing migrations.
- Security: reverses the 117 migration's own rule ("a token with no expiry never dies"). `issuePortalLinkForClient` is also called by `api/soft-pull-approve.mjs` and `src/slo/buyer.mjs`, so those links would become permanent too, not only the staff invite. Pulse beat `auth-truth.mjs` looks only at links that expire in 20 minutes and at template `EMAIL-PORTAL-MAGIC-LINK`, so permanent invites fall outside it (no heartbeat/tripwire for the new template).
- Money: no. Merge conflicts: only `db/expected-migrations.mjs`; the other files equal the parent version on main, so they apply clean.

### S2. LNR business report desk (not routed, incomplete)

| path | size | note |
|---|---|---|
| api/finance/lnr-business-report.mjs | 83 lines | POST handler, staff owner/admin only, search then report, no SSN accepted. Calls CRS. |
| src/http/lnr-business-report.test.mjs | 47 lines | Unit test of the handler. |
| e2e/lnr-business-report.spec.mjs | 31 lines | Browser test (did not run in the original sandbox). |
| public/app/lnr-business-report.html | 91 lines | The staff form (HTML = Codex-owned design). |
| ops/workflows/lnr-business-report-2026-10-13.md | 29 lines | Board; says sandbox proof is RED (network blocked) and browser proof RED. |
| research_notes/Licensed finance software access/vendor_routes.md | 85 lines | Research note. |

Flags: migration no; money: each live report is a paid CRS pull (no live call was ever made per the board); has no route/registry/tripwire rows, so adding it alone breaks the route guard test.

### S3. Prompter thank-you card (visible words)

public/funnel/fundhub-prompter-download.js (+5/-5), public/funnel/fundhub-prompter-download.json (+1/-1, `testflight_url` becomes `app_store_url`, still empty), docs/journeys/fundhub-prompter-funnel-download-intended.md (+6/-6, a human-authored intended file: do not edit without Chris), ops/workflows/fundhub-prompter-funnel-download-2026-10-16.md (+3/-1). Migration no. Money no. Main versions equal the parent's, so a merge is clean.

### S4. Tiny: src/pulse/catalog/proofs/fin-b07-desk-page.test.mjs (+2 assertions). Optional, untested against main.

### S5. Docs and old evidence only (no code): 14 ops boards, 8 teleprompter evidence files, 3 cf-push/marketing-push files, 1 old AGENTS copy. See rows I, J, M2, H3.

### Only on other backup branches (not on main): the 15 `.agents/skills/*/SKILL.md` and `.codex/hooks.json` (origin/backup/exciting-ramanujan-2026-10-21, origin/backup/nervous-swanson-2026-10-21).

## Things that would go WRONG if someone merged the whole backup branch

1. `src/workflows/index.mjs`, `src/pulse/heartbeats.mjs`, `src/pulse/tripwires.mjs`, `src/pulse/coverage/modules.mjs`, `netlify.toml`, `netlify/functions/whop-billing-inbox-sweeper.mjs`: put the Inngest crons and the 1-minute sweeper back (undoes PR #113).
2. `db/expected-migrations.mjs`: drops 482-502 and seeds 035-037.
3. `db/migrations/484_*`: old unguarded template update (main's guarded version is the applied one).
4. `src/payment-links/*`, `src/messaging/providers/whop-payments.mjs`, `src/payments/whop-*`: remove the outbound fence and the invoice-row lock; delete tests main has.
5. `public/app/present.js`, `closer-call.js`, `inquiry-remover.html`, `fundhub-brand.css`, `money-banks.js`: older design/labels than main (design is Codex's).
6. The parent 65314e2cf (origin/codex/two-ios-apps-launch, PR #68 open) is itself 40 commits ahead / 535 behind main, 39 patches not in main. That branch is judged elsewhere; this backup stacks on top of it.

## Recommendation (conservative)

- KEEP origin/backup/root-2026-10-21 as the safety copy. Do NOT merge it.
- Nothing needs rescuing urgently except K and (if wanted) L and M. Everything else is landed, newer on main, or old notes.
- If Chris wants K: open a PR from a fresh branch off main with ONLY these files: db/migrations/480_permanent_client_portal_invites.sql, src/auth/magic-link.mjs, src/auth/magic-link.test.mjs, src/auth/magic-link.pg.test.mjs, src/http/s2-message-routes-auth.test.mjs, api/auth/send-portal-link.mjs (comment), src/messaging/merge-tags-registry.mjs, ops/workflows/permanent-client-portal-invites.md; add the 480 line by hand to main's `db/expected-migrations.mjs`; leave out seed 035 (redundant). Run the pg test on a scratch database. Chris should first decide if ALL `issuePortalLinkForClient` callers (soft-pull-approve, slo/buyer) should get never-expiring links.
- L and M: list for Chris/Codex. Do not merge (HTML/visible words; L also needs route + registry + tripwire rows).
- Everything else: mark obsolete / done as in the table.
