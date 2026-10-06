import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Workflows that exist on disk and are deliberately NOT served.
 *
 * THE POINT OF THIS LIST IS THAT IT IS A LIST. The previous way to switch a
 * workflow off was to leave it out of index.mjs's import block, which is
 * invisible: nothing counted the files, the Automations screen showed the
 * registered set as if it were the whole set, and "53 written / 51 served" was
 * only discoverable by hand. Two jobs sat unserved that way for months — the
 * incomplete-survey nudge, while 400 stalled applications went unchased, and
 * the inquiry call sweeper. Both were switched on by the owner on 2026-08-19.
 *
 * An entry here needs a reason and an owner. An empty list is the healthy state. */
const DELIBERATELY_UNSERVED = {
  /* Moved out of Inngest on 2026-09-23 and it must not go back.

     A pass downloads a whole filmed take out of Drive and pushes it to
     Submagic. An Inngest pass runs inside the synchronous /api/inngest request,
     which Netlify kills at 26 seconds; the first real take was 120 MB and was
     killed mid-upload on production, leaving a spend claim with no project
     behind it and the take stopped dead.

     It now runs as a Netlify scheduled function —
     netlify/functions/ad-video-sweeper.mjs, 15 minutes instead of 26 seconds —
     which calls the very same sweep() out of this directory. Registering it
     here again would put two crons on the same take. */
  "ad-video-sweeper": "runs as a Netlify scheduled function; an Inngest pass is killed at 26s mid-upload"
};

/* EVERY WORKFLOW THIS REPO SERVES, BY NAME.
 *
 * This list replaced a bare `functions.length === 75` on 2026-09-17. The number
 * was doing a real job — registering a workflow is how a job starts running in
 * production, so it should cost somebody a deliberate line in a test rather
 * than slipping in unnoticed — but it could only ever say "expected 75, got
 * 76". It never said WHICH one arrived or WHICH one went away, and the next
 * person to register anything had to work that out by hand.
 *
 * The names do the same job and say it out loud. Add a workflow to
 * src/workflows/index.mjs and this test fails until you add its id here too;
 * remove one and it fails until you take the id out. The failure message names
 * the id in both directions.
 *
 * Sorted, so a new entry lands in an obvious place and two people adding one at
 * the same time do not collide on the same line.
 *
 * DO NOT replace this with a read of `functions` — a list that regenerates
 * itself from the thing it is checking proves nothing. */
const EXPECTED_WORKFLOW_IDS = [
  "af-01-affiliate-drip",
  "af-02-referral-ownership-capture",
  "affiliate-payout-run",
  "ai-set-01-josh-setter",
  "ai-set-03-no-answer-cadence",
  "ai-set-04-3way-handoff",
  "ar-collections",
  "at-01-first-touch-capture",
  "bc-01-customer-responsiveness",
  "bc-02-customer-friction",
  "blake-lead-watch",
  "bs-01-precall-launcher",
  "c-00-crs-soft-pull-request",
  "c-02-inquiry-created",
  "c-02b-inquiry-removal-requested",
  "c-03-inquiry-removed-resume-or-hold",
  "c-05-pre-funding-review",
  "c-06-crs-results-router",
  "commas-inbox-drain",
  "contract-chaser",
  "daily-pulse",
  "doc-check",
  "doc-check-retry-sweeper",
  "dpc-01-analyzer-lock",
  "dpc-02-call-outcome-enforcement",
  "dpc-03-inbound-reply-router",
  "dpc-05-no-progress-escalation",
  "ds-01-repair-referral",
  "ds-02-diy-letters",
  "f-01-funding-intake",
  "f-02-portal-id-missing",
  "f-03-round-submitted",
  "f-04-round-approvals",
  "f-05-inquiry-cleanup-gate",
  "f-06-funding-conditions-missing-docs",
  "f-07-funding-locked",
  "f-08-post-funding-monitoring",
  "f-09-funding-declined-no-path",
  "f-10-client-funding-inbox-provisioner",
  "f-11-bank-email-event-router",
  "finance-os-pull-sweeper",
  "blueprint-finance-os-alerts",
  "blueprint-next-funding-sequence-sweeper",
  "hiring-bench-sweeper",
  "hiring-outreach-cadence",
  "inquiry-call-sweeper",
  "meet-transcript-sweeper",
  "message-dispatch-sweeper",
  "meta-campaign-sync-sweeper",
  "clickfunnels-analytics-sweeper",
  "watch-curve-diagnosis-sweeper",
  "n-01-cold-nurture",
  "n-02-warm-nurture",
  "n-03-hot-nurture",
  "n-04-post-funding-nurture",
  "n-06-renewal-second-wave",
  "next-action-catch-up",
  "paid-checkout-expiry-sweeper",
  "partner-production-floor",
  "repair-bureau-response-reader",
  "round-started-client-notify",
  "s-00-welcome",
  "s-01-new-lead-intake",
  "s-02-incomplete-survey-nudge",
  "s-04-call-booked",
  "s-04b-booking-reminders",
  "s-04c-staff-booked-alert",
  "s-05a-no-show-recovery",
  "s-06-post-call-funding-purchased",
  "s-08-post-call-funding-declined",
  "s-doc-collection",
  "s-nobook-chase",
  "s-offer-bucket",
  "s-portal-invite",
  "slo-genuine-followup",
  "slo-genuine-reply",
  "slo-genuine-checkout-sms",
  "slo-infinite-drip",
  "slo-no-reply-197",
  "slo-pack-delivery",
  "slo-paid-form-nudge",
  "subscription-billing-sweeper",
  "sys-01-client-value-calculator",
  "sys-01-ltv-calculator",
  "u-02-analyzer-complete-delivery",
  "u-03-crs-snapshot-sync",
  "u-04-promote-crs-primary",
  "u-05-data-health-monitor",
  "waypoint-nudge-sweeper",
  "blueprint-closer-ready-sweeper",
];

/* Every id passed to inngest.createFunction in this directory, read from the
   source rather than by importing — importing every module to count them would
   run each one's module-scope side effects just to answer "does it exist". */
function idsOnDisk() {
  const found = new Map();
  for (const file of fs.readdirSync(HERE)) {
    if (!file.endsWith(".mjs") || file.endsWith(".test.mjs")) continue;
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    // Strip comments so a createFunction described in prose is not counted.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const re = /inngest\.createFunction\(\s*\{[^}]*?\bid:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(code))) found.set(m[1], file);
  }
  return found;
}

test("every workflow written on disk is either served or explicitly unserved", async () => {
  const { functions } = await import("./index.mjs");
  const registered = new Set(functions.map((fn) => fn.id()));
  const disk = idsOnDisk();

  const missing = [...disk.keys()]
    .filter((id) => !registered.has(id) && !(id in DELIBERATELY_UNSERVED))
    .map((id) => `${id} (${disk.get(id)})`);

  assert.deepEqual(missing, [],
    "these workflows are written but nothing serves them, so they can never run. " +
    "Either add them to index.mjs's `functions` array, or add them to " +
    "DELIBERATELY_UNSERVED in this file with a reason:\n  " + missing.join("\n  "));
});

test("nothing is listed as unserved that is actually served, or that no longer exists", () => {
  const disk = idsOnDisk();
  for (const [id, reason] of Object.entries(DELIBERATELY_UNSERVED)) {
    assert.ok(disk.has(id), `DELIBERATELY_UNSERVED names "${id}", which is not on disk any more — drop the line`);
    assert.ok(typeof reason === "string" && reason.trim().length > 0, `"${id}" needs a reason`);
  }
});

test("index serves exactly the workflows on disk, and the count is pinned", async () => {
  const { functions } = await import("./index.mjs");
  const disk = idsOnDisk();
  const expected = disk.size - Object.keys(DELIBERATELY_UNSERVED).length;

  /* THE HISTORY OF THIS LIST. Each entry below records why a workflow was
     added, in the words of the person who added it. The counts named in it are
     the historical record of what the pin said at the time; the pin itself is
     EXPECTED_WORKFLOW_IDS at the top of this file now, not a number.

     Added the affiliate payout run (2026-09-21) — the first thing in this
     repository that ever turned an affiliate's accrued commission into a payout
     object. Commission had been accruing correctly onto
     affiliate_referrals.commission_due since 2026-08-31 and nothing batched a
     penny of it: measured 2026-09-20, EVERY insert into affiliate_payouts or
     affiliate_payout_lines anywhere in this repo was a test fixture or demo
     seed. So the balance grew for ever and there was no object that could be
     paid.
     Registering it MOVES NO MONEY. It writes 'pending' and 'held' rows and
     stops. 'processing' and 'paid' are a human action against a payment rail
     this repo does not contain, and affiliate_payouts_guard() in
     033_affiliates.sql refuses that move outright for an affiliate with no
     signed partner license. Paying the same referral twice is prevented by
     affiliate_payout_lines_commission_once — a unique index — and not by the
     new code being careful.

     Added the next-step catch-up (2026-09-18, hole 12) — every five minutes
     it puts the saved next step (custom_fields.employee_next_action) back in
     line with the step the Client Control Panel shows. Measured live: all six
     saved steps disagreed with the panel. It writes that one key on files that
     already hold one, and sends, queues and emits nothing.

     Added the document-reader retry sweeper (2026-09-17) — the clock that comes
     back for a document the reader could not read. Measured on the live walk
     2026-09-16: eight uploads, eight `openai 429 … no credits remaining`, and
     nothing holding a note to look again, so funding the account would not have
     unstuck a single one of them. Registering it reads documents that were
     already uploaded and nothing else: it claims only failed_events rows whose
     handler is 'doc-check', and a document it still cannot read leaves the
     client's verified identity untouched.

     Added the Commas inbox drain (2026-09-17) — a SECOND clock under the
     payment queue. netlify/functions/commas-inbox-sweeper.mjs already runs this
     exact pass on Netlify's cron and is unchanged; it had silently stopped
     firing. Measured on live: six commas_inbox rows pending with attempts=0,
     two of them two days old, while the Inngest clock fired on schedule in the
     same hours. netlify.toml:104-117 records the same silent failure once
     before. A client who paid was still being chased.
     Registering it SENDS NOTHING AND CHARGES NOTHING: it reads bytes Commas
     already delivered and hands them to the same processor the Netlify function
     uses. Running both is safe — claim() takes rows FOR UPDATE SKIP LOCKED so
     overlapping passes work different rows, and the inbox dedupes on the
     payment id, so a double pass cannot count a payment twice.
     Was 74 since the Meta campaign sync sweeper (2026-09-09) — the clock behind the
     ad-numbers pull. Nothing ever ran api/campaigns/sync.mjs on a schedule: the
     route map, src/pulse/registry.mjs and its own tests were the only places
     `campaigns/sync` appeared, so a person pressing Sync was the whole
     mechanism. Paired with a seven-day window that was permanent loss rather
     than delay — eight days without a press and day eight could never be asked
     for again, and the screens draw a missing row as zero spend. The window is
     28 days now and this is what runs it unasked.
     Registering it SENDS NOTHING AND SPENDS NOTHING: it reads from Meta and
     writes our own campaigns / ad_sets / ads / ad_metrics_daily rows. No
     campaign is created, started, paused or re-budgeted. Re-pulling a day it
     already has overwrites that day through ON CONFLICT (ad_id, date), so
     nothing double-counts, and one partner's broken connection is caught on its
     own rather than ending the pass.
     Was 73 since the Finance OS monthly pull sweeper (2026-09-09) — the clock
     behind the one soft pull a finance-os subscriber's monthly fee includes.
     Registering it queues a soft_pull_requests row and nothing more: the
     provider seam 077 describes (a real bureau call, on an answer calling
     fulfilSoftPull()) is called from nowhere in application code, for any
     requester kind, so this writes the honest record "a pull was requested"
     and stops — it does not make a bureau call and does not make a fresh
     credit file appear. The consent gate in requestSoftPull() still runs for
     every row this writes, requester kind included, so a client with no valid
     soft_pull_consent is skipped, not pulled. 380_finance_os_monthly_pull.sql
     is the migration that made 'system' an allowed requester kind for exactly
     this row.

     Was 72 since the paid checkout expiry sweeper (2026-09-06) — the clock that
     ends a hosted checkout invitation nobody accepted. Nothing in this
     repository ever moved a paid_service_requests row off 'awaiting_payment' on
     its own: the payment webhook could, and docs/journeys/paid-round-actual.md
     records that the payment handler is not on the live bus. So the row was
     permanent — and the waypoint nudge sweeper above was suspending a client's
     entire overdue-checklist chase behind it, on the stated ground that a
     checkout link expires. It did not. Measured: 200 such clients starved one
     live client to zero messages, that day and a year later.
     Registering it MOVES NO MONEY. A row at awaiting_payment has never been
     charged — a hosted link is an invitation, not a payment — so closing one
     takes nothing from anybody and creates no refund. It writes a status, a
     reason and a resolution time, and nothing else.
     Was 71 since the hiring outreach cadence (2026-09-05) — the first thing in this
     platform that ever contacts a CANDIDATE. Until the same day's public apply
     door, nothing did: candidate_notified_at was read by two endpoints and
     written by none, and a rejection only ever queued a to-do for a person to
     write the email themselves. An applicant who hears nothing is how a bench
     goes cold, so the follow-up runs on a clock rather than on somebody
     remembering.
     Registering it sends nothing by itself. sendTemplated writes a 'queued' row
     and stops; src/messaging/dispatch.mjs hands those to a provider under
     messaging_settings.outbound_enabled per company and the MESSAGING_DRY_RUN
     fence, neither of which this touches. The cadence exits on a reply, a
     booking and an opt-out — a sequence with no exit is a complaint generator.
     Was 69 since the hiring bench sweeper (2026-09-05) — the first thing in this
     repo that asks "should we be recruiting" without a human asking it first.
     src/hiring/bench.mjs has made the always-on argument since 051 and nothing
     ran it: its only door was GET /api/hiring/bench, a read-only screen
     docs/WIRING-AUDIT.md records as never called by any front end. Registering
     it writes TASKS ONLY — no candidate is contacted, advanced, ranked or
     rejected, no job is posted, nothing is mailed — and each alert routes
     through src/hiring/owner.mjs assigneeFor rather than into one shared queue.
     The date is in the task dedupe key, so one task per role per day is the
     ceiling whatever the cron says. src/ops/hire-closer.mjs actOnPacked is
     deliberately NOT scheduled alongside it: closer-only, past the resolver, and
     it posts to a LinkedIn integration with no partner access. It stays behind
     the button.
     Was 68 since the partner production floor review (2026-08-31) — the only filter
     on the partner base. The $10,000 entry fee is financeable down to a 405 FICO
     (docs/specs/W0-decisions.md), so entry screens nobody and production is the
     whole quality control: ten funding clients a month, on the ladder in
     W1-money-model.md §6, checked on the 1st. Registering it CAN lower a
     partner's revenue_share_pct from 50 to 20 — and cannot restate one cent
     already earned, because partner_revenue.share_pct_applied is frozen on every
     row (042). It also reaches nobody until a partner has an activated_at, which
     db/migrations/282_partner_production_floor.sql deliberately leaves NULL for
     every partner activated before it existed rather than guessing a date.
     Was 70 since the waypoint nudge sweeper (2026-09-06) — the hourly chase on
     an overdue checklist row the CLIENT owns. Registering it queues a message
     and nothing more: what stops it running away is in the database, not in the
     scheduler — db/migrations/371_waypoint_nudges.sql caps it at four messages
     per waypoint ever and one client-facing message per client per day, both as
     unique constraints written before anything is queued.
     Was 67 since the subscription billing sweeper (2026-08-31) — the recurring
     billing rail. Registering it charges nobody: the charge-function registry
     in src/subscriptions/charger.mjs is empty because Commas exposes no
     confirmed merchant-initiated charge endpoint, and SUBSCRIPTION_BILLING_ENABLED
     is a second lock in front of the day one exists. It is registered anyway so
     that the schedule is visible on the Automations screen rather than switched
     off by absence — which is the exact drift this test was written to catch.
     Was 66 since Blake referral watch (2026-08-28) texts Chris name + phone when
     Blake mails. Was 65 since the 2026-08-27 merge brought in two that were each
     added on their own branch and never counted here: daily-pulse (a 7:00 a.m.
     Denver audit-only sweep, acfa8bc9) and af-01-affiliate-drip (the existing
     AF1 affiliate welcome, bc05c169). Both are real registrations, so the pin
     moves rather than the code. Was 63 since Meet transcript sweeper
     (2026-08-24). Was 62 since S-04C staff booked-call text (2026-08-23). Was 61
     since section 4 (welcome, portal-invite, offer-bucket, doc-collection,
     ar-collections). Was 56 since ghl-doc-document-check (section 2.2). Was 55
     after repair-bureau-response-reader (WS-C). Was 54 after AI-SET-01 Josh
     setter was registered (2026-08-21). Was 53 after the incomplete-survey
     nudge and the inquiry call sweeper were switched on (2026-08-19).

     The served set stays pinned as well as derived: registering a function is
     how a job starts running, and Inngest executes functions in production
     today, so it should cost somebody a deliberate line in a test. The pin is
     EXPECTED_WORKFLOW_IDS at the top of this file — the names, not a count, so
     the failure says which workflow moved. */
  const ids = functions.map((fn) => fn.id());
  assert.equal(new Set(ids).size, ids.length, "a workflow is registered twice");

  const named = new Set(EXPECTED_WORKFLOW_IDS);
  const serving = new Set(ids);
  assert.deepEqual(
    ids.filter((id) => !named.has(id)).sort(), [],
    "these workflows are registered in index.mjs but are not named in " +
    "EXPECTED_WORKFLOW_IDS at the top of this file. Registering a job is how it " +
    "starts running in production — add the id there in the same commit, so the " +
    "decision is written down."
  );
  assert.deepEqual(
    EXPECTED_WORKFLOW_IDS.filter((id) => !serving.has(id)), [],
    "EXPECTED_WORKFLOW_IDS names these, but index.mjs no longer registers them, " +
    "so they cannot run. Either register them again or take the id out of the list."
  );
  assert.equal(functions.length, EXPECTED_WORKFLOW_IDS.length,
    `${EXPECTED_WORKFLOW_IDS.length} workflows are named, but ${functions.length} are registered — ` +
    `check EXPECTED_WORKFLOW_IDS for a duplicate line`);

  assert.equal(functions.length, expected,
    `${disk.size} workflows on disk, ${Object.keys(DELIBERATELY_UNSERVED).length} deliberately unserved, ` +
    `so ${expected} should be served — but ${functions.length} are`);
  for (const id of ids) {
    assert.ok(disk.has(id), `"${id}" is served but no file in this directory defines it`);
  }
  for (const fn of functions) {
    assert.ok(fn && typeof fn === "object", "each entry should be an Inngest function object");
  }
});

test("api/inngest serve endpoint imports without throwing", async () => {
  // Dynamic import of the serve handler — if the module graph is broken this throws.
  const mod = await import("../../api/inngest.mjs");
  assert.ok(mod.default, "serve handler should be the default export");
  assert.equal(typeof mod.default, "function", "serve handler should be a function");
});

/* ── EMITTER MANIFEST STALENESS ────────────────────────────────────────────
 *
 * api/read/workflows.mjs carries a hand-written map of "what actually causes
 * this event to be emitted". It is hand-written on purpose: nearly every real
 * emitter calls emit(db, c.name, ...) with the name resolved from a lookup
 * table a hundred lines earlier, so a grep for the event-name literal finds
 * nothing and a grep-based guard would report working funding events as
 * having no emitter at all.
 *
 * A hand-written map goes stale silently. These tests are what stops it: add a
 * workflow that listens to a new event and the first one fails until somebody
 * writes down how that event gets emitted and what gates it.
 *
 * The manifest is imported from an exported const, so none of this needs a
 * database or an HTTP request. */

test("every event a registered workflow listens for is in the emitter manifest", async () => {
  const { functions } = await import("./index.mjs");
  const { EVENT_EMITTERS } = await import("../../api/read/workflows.mjs");

  const listened = new Set();
  for (const fn of functions) {
    for (const t of (fn.opts && fn.opts.triggers) || []) {
      if (t.event) listened.add(t.event);
    }
  }

  const undocumented = [...listened].filter((ev) => !(ev in EVENT_EMITTERS)).sort();
  assert.deepEqual(undocumented, [],
    "these events start a workflow but nothing says how they are emitted. Add each one to " +
    "EVENT_EMITTERS in api/read/workflows.mjs, naming the code path and the environment " +
    "variable that gates it (or null when nothing gates it):\n  " + undocumented.join("\n  "));
});

test("the emitter manifest names no event that nothing listens for", async () => {
  const { functions } = await import("./index.mjs");
  const { EVENT_EMITTERS } = await import("../../api/read/workflows.mjs");

  const listened = new Set();
  for (const fn of functions) {
    for (const t of (fn.opts && fn.opts.triggers) || []) {
      if (t.event) listened.add(t.event);
    }
  }

  const orphaned = Object.keys(EVENT_EMITTERS).filter((ev) => !listened.has(ev)).sort();
  assert.deepEqual(orphaned, [],
    "the manifest documents these events, but no registered workflow triggers on them any " +
    "more. Either a workflow was unregistered without anyone noticing, or the lines are dead " +
    "and should go:\n  " + orphaned.join("\n  "));
});

test("every manifest entry is filled in, not stubbed", async () => {
  const { EVENT_EMITTERS, EMITTER_MANIFEST_VERIFIED_ON } =
    await import("../../api/read/workflows.mjs");

  assert.match(EMITTER_MANIFEST_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/,
    "the manifest needs a date recording when a human last checked it");

  for (const [event, entry] of Object.entries(EVENT_EMITTERS)) {
    assert.ok(entry && Array.isArray(entry.emitters),
      `"${event}" needs an emitters array — an EMPTY array is a legitimate answer and means ` +
      `nothing can emit it, but the key has to be there`);
    for (const em of entry.emitters) {
      assert.ok(typeof em.how === "string" && em.how.trim().length > 10,
        `"${event}" has an emitter with no plain-language description of how it fires`);
      assert.ok(em.gate === null || (typeof em.gate === "string" && em.gate.length > 0),
        `"${event}" has an emitter whose gate is neither an env-var name nor an explicit null. ` +
        `null means "nothing gates this"; leaving it undefined means "nobody checked"`);
    }
    assert.ok(entry.note === null || typeof entry.note === "string",
      `"${event}" note should be a string or an explicit null`);
  }
});

/* ── THE STATUS VALUES THE AUTOMATIONS SCREEN SHOWS ────────────────────────
 *
 * Guarding the two lies these statuses replaced. status "live" used to mean
 * only "a row exists in the events table", which auditors moved from 44 to 49
 * by firing five test events — nothing ran. And the cron-only jobs were
 * labelled never_triggered forever, because a clock job does not write an
 * event row. That was audit item T6-04. */

test("a cron-only workflow is scheduled, never 'never triggered'", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  assert.equal(
    statusOf({ events: [], crons: ["*/5 * * * *"], emitters: [], lastTriggeredAt: null }),
    "scheduled");
});

test("every cron-only workflow on the registry reports as scheduled", async () => {
  const { functions } = await import("./index.mjs");
  const { statusOf } = await import("../../api/read/workflows.mjs");

  let cronOnly = 0;
  for (const fn of functions) {
    const triggers = (fn.opts && fn.opts.triggers) || [];
    const events = triggers.map((t) => t.event).filter(Boolean);
    const crons = triggers.map((t) => t.cron).filter(Boolean);
    if (events.length || !crons.length) continue;
    cronOnly++;
    assert.equal(statusOf({ events, crons, emitters: [], lastTriggeredAt: null }), "scheduled",
      `"${fn.opts.id}" runs on a clock and must never be shown to the owner as dead`);
  }
  assert.ok(cronOnly >= 1, "expected at least one cron-only workflow in the registry");
});

test("an event row is reported as 'trigger seen', which is not a claim the workflow ran", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  const emitters = [{ event: "entry.captured", how: "the public survey form", gate: null, gate_set: null }];
  assert.equal(statusOf({ events: ["entry.captured"], crons: [], emitters, lastTriggeredAt: "2026-08-18T00:00:00Z" }),
    "trigger_seen");
  assert.equal(statusOf({ events: ["entry.captured"], crons: [], emitters, lastTriggeredAt: null }),
    "trigger_never_seen");
});

test("a workflow whose events nothing emits reports no_emitter", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  const emitters = [{ event: "made.up", how: null, gate: null, gate_set: null }];
  assert.equal(statusOf({ events: ["made.up"], crons: [], emitters, lastTriggeredAt: null }), "no_emitter");
  assert.equal(statusOf({ events: [], crons: [], emitters: [], lastTriggeredAt: null }), "no_emitter");
});

test("registryRows honours limit and offset", async () => {
  const { registryRows } = await import("../../api/read/workflows.mjs");

  const all = registryRows();
  assert.ok(all.length > 5, "expected the whole registry when no page is asked for");

  /* Every list endpoint in this repo returns one row more than asked for, so
     page() in src/http/read-api.mjs can set hasMore without a count query. */
  const first = registryRows({ limit: 3, offset: 0 });
  assert.equal(first.length, 4, "should return limit + 1 rows");
  assert.deepEqual(first.slice(0, 3).map((r) => r.id), all.slice(0, 3).map((r) => r.id));

  const second = registryRows({ limit: 3, offset: 3 });
  assert.deepEqual(second.slice(0, 3).map((r) => r.id), all.slice(3, 6).map((r) => r.id));

  const past = registryRows({ limit: 3, offset: all.length + 10 });
  assert.deepEqual(past, [], "an offset past the end returns nothing, not everything");
});

test("cron expressions are turned into words the owner can read", async () => {
  const { cronInPlainWords } = await import("../../api/read/workflows.mjs");
  assert.equal(cronInPlainWords("*/5 * * * *"), "every 5 minutes");
  assert.equal(cronInPlainWords("*/15 * * * *"), "every 15 minutes");
  assert.equal(cronInPlainWords("0 10 * * *"), "once a day at 10:00 UTC");
  // Anything this helper has not been taught falls back to the raw expression.
  // A wrong schedule in confident English is worse than a right one in cron.
  assert.equal(cronInPlainWords("0 0 * * 1"), "0 0 * * 1");
});
