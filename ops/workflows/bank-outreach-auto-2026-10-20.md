# Bank outreach — the automatic half, no Apollo, no Salesforge (2026-10-20)

Owner (Chris, 2026-10-20): "make this as automated as possible without paying for those two services... I don't want to pay for them right now."

Session: `outreach-auto` (Claude, Opus). Branch: `claude/funny-sinoussi-765e2b`. Coordinator ships. Back end only. Screens are Codex's.

## Split

| ID | Owner | What | Status |
|---|---|---|---|
| A | `outreach-auto` (this session) | Database, store, banker finder, email steps, reply reader, jobs, tests, heartbeat rows | done — PR #96, coordinator ships |
| B | `outreach-auto` helper (Chris in session: "make screens as well") | Cards 1–7 built | draft PR #111, stacked on #96 — coordinator relays the 10-20 rule that Codex owns dashboard design, so #111 waits for Chris/Codex to decide |

No other piece is separate. Finder, email steps and reply reader share one new migration and one store file. Two writers there would collide.

Prompt for B (Codex, copy-paste): Read AGENTS.md and this board in `ZootimusMaximusSupreme/fundhub-platform` after A's PR merges. Build the "Leftovers for Codex" cards below on `public/app/bank-outreach.html` / `bank-outreach.js` using the API fields listed in the A manifest. Do not change the back end. Keep the four display states and the phone sizes from `docs/journeys/bank-outreach-intended.md`.

## The plan, in plain words

### 1. Find bankers (search, not scraping)

We ask a search engine the owner's search: bank + state + job title, LinkedIn profiles only. We read only the search engine's own result list (name, title, link, short text). We never open LinkedIn or a bank's website.

Free search tools, checked on each vendor's own page (2026-10-20):

| Tool | Free | Card to sign up | Paid | Can we save results? |
|---|---|---|---|---|
| **Serper.dev** (Google results) | 2,500 searches, one time | No | $1 per 1,000 ($50 buys 50,000, good 6 months) | Yes — its terms have no rule against it |
| Brave Search | about 1,000 a month ($5 credit) | Yes | $5 per 1,000 | **No** — terms 3(b)(i) ban "store, cache, or create a database of Search Results" |
| Google's own search API | — | — | — | Closed to new customers; ends Jan 1, 2027 |
| Bing search API | — | — | — | Retired Aug 11, 2025 |
| Tavily | 1,000 a month | No | $8 per 1,000 | No `site:` support listed |
| SerpApi | 250 a month | not verified | $25 per 1,000 | not verified |

**Pick: Serper.dev.** Free start, no card, Google results, and we may keep what we find. The 2025 plan picked Brave, but Brave's terms ban keeping results in a database, and keeping them is the whole job.

- One national pass is 11,568 searches. The free 2,500 covers about one in five rows. A full pass on paid costs about $12.
- The job runs every 15 minutes and stops at a daily cap (`BANK_OUTREACH_SEARCHES_PER_DAY`, default 80), so the free searches last about a month. Raise the cap only if Chris buys more.
- Order: rows a rep owns first, then AZ, SC, FL, CA, then everyone else. Each row is searched again after 30 days for new hires.
- Rules (not AI) read each result. A result is kept only when it is a real `linkedin.com/in/...` profile and the result names this bank. Wrong bank = dropped. No AI cost here.
- Found bankers land as **suggested** on the bank row. The rep clicks Accept (it becomes a saved banker) or Dismiss. Connecting on LinkedIn stays a rep click: LinkedIn has no messaging API.
- Sign-up: https://serper.dev — env name `SERPER_API_KEY`. With no key the job does nothing and says so.
- Serper's exact API address is only shown after sign-in. Used: `POST https://google.serper.dev/search`, header `X-API-KEY`. The first live call confirms it.

### 2. Automatic emails

- Any saved banker with an email gets 3 emails: day 0, day 4, day 9. Then it stops.
- It stops early when the banker replies, opts out, bounces, complains, the bank is paused/closed/verified, or a manager stops it.
- It uses Fundhub's own send road: it writes a `messages` row and the shared dispatcher sends it through Resend (`src/messaging/providers/*` only, CLAUDE.md §12). The company pause switch, daily cap, and wording checks all still apply.
- Every email has Fundhub's mailing address and two ways out: reply STOP, or the same unsubscribe page clients use (new banker link, signed).
- Replies come back to `reply+bk-<banker id>@` on the reply domain, so each reply names one banker.
- Emails do not go to a guessed address. Only addresses a rep or the banker gave us.

### 3. AI reads replies

- Same pattern as the Blueprint coach: the AI returns a small JSON answer only. The server writes every word from approved copy. The AI never writes free text to a banker.
- The AI sorts the reply (interested, sent data, wants a call, not now, wrong person, stop, auto-reply) and pulls out the bank data points (min score, time in business, revenue, bureaus, inquiries, stated income, states, application link).
- Pulled data is saved as a **suggestion** on the reply. A rep applies it with one click; a manager still verifies into Lenders. Nothing reaches Lenders by AI alone.
- The reply email asks only for the data points still missing.
- "Wants a call" or anything unclear → the rep gets a "due now" next action.
- AI agent `BANK-OUTREACH-REPLY` is an `ops` agent, so the client reply robot can never pick it. It ships as `draft`: rules only (STOP, auto-reply), no model call. `shadow` = AI reads and suggests, sends nothing. `live` = AI picks the reply email.

## What has to happen before the first real email to a bank (not done — coordinator asks Chris)

1. Chris says sending is on (outward-facing; this session sends nothing).
2. Approve the 7 new bank templates (seeded `compliance_passed=false`, same as the Blueprint templates).
3. `BANK_OUTREACH_FROM` — the From address. Must be on a domain Resend already sends for. The 2026-10-14 tools note says cold email should not come from fundhub.ai; a second domain costs money, so that is Chris's call.
4. `BANK_OUTREACH_POSTAL_ADDRESS` — Fundhub's mailing address for the footer. It is not in the repo (the Phoenix address on the sales pages belongs to a sample client). Nothing queues without it.
5. For AI replies: set agent `BANK-OUTREACH-REPLY` to `shadow` or `live`.

## Leftovers for Codex (screens) — built in draft PR #111; Codex may take them over instead

All on `public/app/bank-outreach.html` / `bank-outreach.js`. API is ready; fields below.

1. **Found bankers card** on the bank detail. `GET /api/read/bank-outreach?id=<account>` now returns `leads[]`: `id, name, title, employer, linkedin_url, snippet, confidence ('high'|'medium'), status ('suggested'|'accepted'|'dismissed'), contact_id, created_at`. Buttons: **Accept** → `POST /api/bank-outreach {action:'accept_lead', account_id, lead_id}` (returns `contact`), **Dismiss** → `{action:'dismiss_lead', account_id, lead_id}`. Open-on-LinkedIn link uses `linkedin_url` (a rep click; never automated). 409 = already reviewed.
2. **Automatic emails per banker** on the contact row. `sequences[]`: `contact_id, status ('active'|'stopped'), step (0-3), next_due_at, last_sent_at, stop_reason ('replied'|'opted_out'|'bounced'|'completed'|'manual'|'account_closed'|'no_email')`. Button **Stop emails** → `{action:'stop_emails', account_id, contact_id}`. Contacts now carry `email_opt_out_at` (show "Opted out").
3. **Banker replies card.** `replies[]`: `id, contact_id, from_address, subject, body, received_at, status ('new'|'handled'|'needs_human'), kind, ai_mode ('rules'|'shadow'|'live'), summary, suggested {product_name, lender_table, facts, evidence_quote, referral}, suggestion_status ('none'|'pending'|'applied'|'dismissed'), draft_reply {template_key, subject, body, approved, queued_message_id, reason}, reply_message_id, error`. Buttons: **Apply facts** → `{action:'apply_reply_suggestion', account_id, reply_id, product_name?, lender_table?, product_id?}` (creates or amends a product draft; manager still verifies), **Set aside** → `{action:'dismiss_reply_suggestion', ...}`, **Done** → `{action:'mark_reply_handled', ...}`. Show `draft_reply` as "What the AI would send" when not queued.
4. **Queue list counts.** Each list item now has `leads_waiting` and `replies_waiting`; `summary` has both totals. A "replies waiting" chip on the row.
5. **Machine history.** `activities[]` rows have `actor` ('staff'|'automation'); automation rows have no `staff_name`. Label them "Fundhub automation".
6. **Automation panel (managers).** `GET /api/read/bank-outreach?view=automation` → `automation.search {configured, signup_url, per_day_cap, used_today, never_searched, accounts}`, `automation.email {configured, missing[], in_send_window, per_day_cap, sent_today, templates_approved, templates_total, active_sequences, sequences}`, `automation.replies {agent_status, waiting, needs_human}`. Reps get 403.
7. Carried from C's board: the State filter and import note still say 4 states; the program covers all 56 codes.

## A — manifest

Branch `claude/funny-sinoussi-765e2b`. Nothing live; no email sent; no real search run (no key).

| Area | Files |
|---|---|
| Database | `db/migrations/495_bank_outreach_automation.sql` (new tables `outreach_search_runs`, `outreach_contact_leads`, `outreach_email_sequences`, `outreach_inbound_emails`; columns `outreach_accounts.banker_search_at`, `outreach_contacts.email_opt_out_at`, `outreach_activities.actor` + nullable `staff_id`; draft agent `BANK-OUTREACH-REPLY`; 7 unapproved templates), `db/expected-migrations.mjs` |
| Banker finder | `src/outreach/finder.mjs`, `src/messaging/providers/serper-search.mjs` |
| Email steps + replies | `src/outreach/automation.mjs`, `src/outreach/replies.mjs`, `src/outreach/queue.mjs`, `src/outreach/mail.mjs` |
| Rep actions + reads | `src/outreach/store.mjs` (`accept_lead`, `dismiss_lead`, `apply_reply_suggestion`, `dismiss_reply_suggestion`, `mark_reply_handled`, `stop_emails`; `view=automation`; `leads`, `sequences`, `replies` on detail) |
| Shared send path | `src/messaging/gate.mjs` (banker branch), `src/messaging/dispatch.mjs` (banker From/reply tag/unsubscribe header; held when settings missing), `src/messaging/providers/resend.mjs` (From domain allow-list, `reply+bk-` tag), `src/adapters/mailgun.mjs` (banker replies saved, no `mail.response`), `api/public/unsubscribe.mjs` (`banker_email` branch) |
| Job | `src/workflows/bank-outreach-automation.mjs` (`*/15 * * * *`, steps `find-bankers`, `queue-emails`, `read-replies`), `src/workflows/index.mjs` |
| Heartbeat | `src/pulse/heartbeats.mjs` (job row), `src/pulse/tripwires.mjs` (`job:bank-outreach-automation` → `bank-outreach:email-safety`, `bank-outreach:reply-waiting`), `src/pulse/coverage/gap-bank-outreach.mjs` (2 new checks), `src/pulse/beats/beat-bank-outreach.mjs` (step `email-safety`) |
| Docs | `docs/journeys/bank-outreach-actual.md`, `docs/journeys/CHANGELOG.md`, `.env.example` |
| Tests | `src/outreach/{finder,mail,replies}.test.mjs`, `src/outreach/automation.pg.test.mjs` (real PostgreSQL, runs in CI), `src/messaging/gate-banker.test.mjs`, `src/messaging/providers/{serper-search,resend-banker}.test.mjs`, `src/workflows/bank-outreach-automation.test.mjs`, extended `gap-bank-outreach.test.mjs`, `beat-bank-outreach.test.mjs` |

No new route, page or dependency. Journey gap: `bank-outreach-intended.md` still says no automated sends (owner's file to update).

### Proof so far (2026-10-20)

- Lint clean (4,108 files). TypeScript clean.
- New unit tests: 25 + 6 banker gate + 9 check/beat, all pass. All 7 bank emails pass the real restricted-word rules.
- Guard tests (registry, heartbeats, tripwires, beats, modules, workflows, fence, providers, gate, dispatch, unsubscribe): 300/300.
- Local full `npm test` (no database): 28,456 tests, 28,376 pass, 55 fail. Fixed from that run: diagrams stale, journey-runner count, heartbeat coverage note. The rest are browser tests that fail only in this worktree: two Playwright copies load (worktree `node_modules` + root). No screen or browser test was changed.
- GitHub real PostgreSQL, first commit: 6 of 7 new automation database tests passed (search, rep review, email steps, STOP/reply stops, AI draft/shadow/live, both deep checks on real rows). Two reds fixed in `b7c5f5ecc`: the actor constraint lookup was schema-wide, and the agent registry pin (25 → 26) for the new agent. Final CI result: see PR #96.
- Not run: `npm run pulse:prove` against live data. Migration 495 is not applied, so the two new check queries would fail on missing tables. `scripts/ship.mjs` runs the bundle proofs after applying migrations and before deploy, so the ship is the proof point.

### Owner GO (Chris in session, 2026-10-20 evening): "GREAT PLEASE GET IT DONE", then "make screens as well"

- Live settings set (Netlify production, deploy-preview, branch-deploy, no `--secret`; also `.env` and `credentials/env.full.snapshot`):
  - `BANK_OUTREACH_FROM` = `Fundhub Bank Partnerships <relationships@fundhub.ai>` (the plan's warm inbox; fundhub.ai is the only Resend sending domain, and a new domain costs money). Said once: cold email from fundhub.ai shares the client domain's reputation; the 40-a-day cap keeps volume small.
  - `BANK_OUTREACH_POSTAL_ADDRESS` = `218 Bostick Rd 64, Bowling Green, FL 33834` (Fundhub LLC's address in `docs/agreements/FUNDING-AGREEMENT-ready-to-send.txt` and `db/seed/021_funding_mastery_agreement.sql`).
  - Both take effect at the next deploy.
- Not set: `SERPER_API_KEY` (Chris is signing up at https://serper.dev; search starts at the first deploy after it is set).
- Not approved: the 7 bank templates. Chris's own rule (2026-08-01, `api/message-templates.mjs`): approval needs the exact words read by an owner or admin. No bank email can send until then.
- After deploy: switch agent `BANK-OUTREACH-REPLY` to `live` (features stay on; it can only send approved copy).
- CI notes on #96, not caused by this branch, each passed here or on other runs: `creative assets cannot be hard-deleted` (run 39523796193), `Send this one to` browser timeout (passes locally 2/2), `pipeline-new-archive` refusal (1 of 1,743), and the `template-restore` collation failure on every PR since #112 (fix rides #108/#107, per coordinator).

## UI audit of the bank outreach screens (PR #111) — fundhub-ui-auditor checklist vs docs/rules/UI-STANDARDS.md

Owner, relayed 2026-10-20: "claude is fine as long as they are perfect. do it for me now." Audited at 1440, 390 and 320 with fictional fixtures, as manager and as rep. Evidence: `ops/workflows/build-evidence/bank-outreach-auto/*-MARKED.png` (15 shots, red numbered boxes, legend under each picture).

| Screen | Role | Standard | Expected | Observed | Evidence | Severity | Result |
|---|---|---|---|---|---|---|---|
| Automation panel | Manager | §6.3 true status | "On" only when email can actually go out | "Automatic emails On" when settings were saved but only 3 of 7 emails approved | `1440-manager-automation-MARKED.png` | HIGH | Fixed: On / Waiting on copy / Off, plus "Only approved emails go out. X of 7 are approved." New test for 7 of 7 = On |
| Banker emails | Rep | §5 destructive confirm | Confirm naming the result | "Stop emails" stopped the cadence on one click; it cannot be restarted | `*-rep-automatic-emails-MARKED.png` | HIGH | Fixed: confirm "Stop automatic emails to <name>? The emails not sent yet will never go out. This cannot be undone." Cancel sends nothing (tested) |
| Found bankers | Rep | §5 buttons say what happens | Verb naming the result | "Accept" / "Dismiss" | `*-rep-found-bankers-MARKED.png` | MEDIUM | Fixed: "Save as banker" / "Not a match"; statuses "Saved as banker" / "Not a match" |
| All new cards | Both | §11 widths | 1440, 390 and 320 | New cards tested at 1440 and 390 only | — | MEDIUM | Fixed: 320 added (5 more tests); no sideways scroll, 16px body, 13px captions, 44px targets measured at all three |
| Found bankers | Rep | §9 progressive disclosure | Reviewed rows stay short | Reviewed rows repeated the full search snippet | `*-rep-found-bankers-MARKED.png` | LOW | Fixed: snippet only on rows still needing review (tested) |
| Automation panel | Manager | §11 phone fit | Caption on one line | "4 started in / all" broke at 320 | `320-manager-automation-MARKED.png` | LOW | Fixed |
| Evidence | — | CLAUDE.md §8 | Marks never hide the content | Yellow arrows and legend drawn over the screen | old shots | LOW | Fixed: numbered boxes, legend in a band under the picture, no arrows |

Checked and passing with no change: §1 no new primary button (the only primary in the diff is the existing Import banks); §2 8/16/24/32 spacing and the 3-column automation grid (equal spans, one column under 1100px); §3 type floors measured and tabular numbers on panel values; §4 Automation tab renders for managers only, reps never see or read it (tested); §6 Automation panel loading / empty (with Import banks) / failed read with retry / full, and empty text for replies; §7 relative time under 24h, absolute after, every panel count beside its cap or total; §8 filters above the queue; §10 rep's first question ("Who do I work next?") still leads; state filter lists every program state (56 live), tested. Open question: none.

Proof on the final screen code: bank outreach Chromium spec 63/63 (41 existing unchanged + 22 new), WebKit proof 27/27, screen-standard / status tokens / rounded font / nav reachability / fluid shell 67/67, lint clean.
