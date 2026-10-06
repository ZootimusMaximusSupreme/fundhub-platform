/* The walker.
 *
 * Acceptance criteria held here:
 *   * a journey with N conditions produces 2^N walked paths, each with its own
 *     synthetic client
 *   * the workflow coverage list accounts for every entry in
 *     src/workflows/index.mjs — every one either fired or explicitly listed as
 *     unreached
 *   * NOTHING THIS HARNESS FIRES LEAVES THE MACHINE (see the skipInngest test
 *     at the bottom — it is the most important assertion in this file)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { enumeratePaths, run, START_EVENT } from "./index.mjs";
import { load as loadRegistry, neverFired } from "./registry.mjs";
import { SEED_JOURNEYS } from "../seed-journeys.mjs";
import { functions } from "../../workflows/index.mjs";
import { inngest } from "../../workflows/client.mjs";
import { isSyntheticRow } from "./synthetic.mjs";

/* THE COUNT STAYS PINNED, AND IT MOVED FROM 63 TO 64.
   AF-01 affiliate welcome drip was registered 2026-08-26. The pin exists so
   that registering a workflow is a visible decision rather than a silent one,
   so it is updated here rather than read from the module. */
/* Bumped 64 -> 65 on 2026-08-27. src/workflows/meet-transcript-sweeper.mjs was
   registered on 2026-08-26 and this number was not moved with it, so these three
   tests sat red — the registry was right and the count describing it was stale.

   The sweeper landed with no test file of its own and no seeded journey walks
   it, so it shows up in neverFired. That is this test doing its job: an untested
   workflow is now VISIBLE rather than silent. Do not "fix" that by pretending it
   fired — add a journey that walks it, or leave it named and known.

   If you register a workflow, move this number in the same commit. */
/* Bumped 65 -> 66 on 2026-08-28. src/workflows/blake-lead-watch.mjs (Blake
   referral mail → staff text) was registered; this pin moves with it. */
/* Bumped 66 -> 67 on 2026-08-31. src/workflows/subscription-billing-sweeper.mjs
   (the recurring billing rail) was registered; this pin moves with it.

   It is a cron with no event trigger, so no journey can ever reach it and it
   will always appear in neverFired. That is the correct outcome for a scheduled
   job — the same note meet-transcript-sweeper carries above — not a coverage
   hole to paper over. It is exercised directly by
   src/workflows/subscription-billing-sweeper.test.mjs and, against a real
   Postgres, by src/subscriptions/billing-replay.pg.test.mjs. */
/* Bumped 68 -> 69 on 2026-09-05. src/workflows/hiring-bench-sweeper.mjs was
   registered — the first thing in this repo that asks "should we be recruiting"
   without a human asking it first. src/hiring/bench.mjs had made the always-on
   argument since 051 and nothing ran it. It writes TASKS ONLY, routed through
   src/hiring/owner.mjs; it contacts, advances, ranks and rejects nobody, and it
   posts no job.

   Like the two sweepers and the floor review below it, it is a cron with no
   event trigger, so no journey can ever reach it and it will always appear in
   neverFired. It is exercised directly by
   src/workflows/hiring-bench-sweeper.test.mjs and, against a real Postgres, by
   src/workflows/hiring-bench-sweeper.pg.test.mjs. */
/* Bumped 67 -> 68 on 2026-08-31. src/workflows/partner-production-floor.mjs (the
   only filter on the partner base — ten funding clients a month, W0-decisions.md
   and W1-money-model.md §6) was registered; this pin moves with it.

   It is a cron with no event trigger, so no journey can ever reach it and it will
   always appear in neverFired — the same note the two sweepers above carry, and
   the correct outcome for a scheduled job rather than a coverage hole. It is
   exercised directly by src/workflows/partner-production-floor.test.mjs and,
   against a real Postgres, by src/partners/floors.pg.test.mjs. */
/* 72 since the paid checkout expiry sweeper (2026-09-06) was registered — the
   clock that ends a hosted checkout invitation nobody accepted. It is a cron
   with no event trigger, so like every sweeper here it will always appear in
   neverFired, which is the correct outcome for a scheduled job.

   Was 71 since the hiring outreach cadence (2026-09-05) was registered — candidate
   follow-up on a 30-minute clock, the first thing here that ever contacts a
   candidate.

   It is a cron with no event trigger, so no journey can ever reach it and it
   will always appear in neverFired — the same note the sweepers above carry,
   and the correct outcome for a scheduled job rather than a coverage hole. */
/* 78 since the affiliate payout run (2026-09-21) was registered — the first
   thing here that ever turned an affiliate's accrued commission into a payout
   object. It is a monthly cron with no event trigger, so it too will always
   sit in neverFired, for the same reason and not because anything is missing.

   Was 75 since the Commas payment inbox drain (2026-09-17) was registered — a
   SECOND clock under the payment queue, because the Netlify cron that had been
   the only one under it stopped firing and nobody was told. It is a cron with
   no event trigger, so like every sweeper here it can never be reached by a
   journey and will always appear in neverFired. That is the correct outcome
   for a scheduled job, not a coverage hole to paper over: do not invent a
   trigger for it to make this list shorter. It is exercised directly by
   src/workflows/commas-inbox-drain.test.mjs.

   Was 74 since the Meta campaign sync sweeper (2026-09-09) was registered — the
   clock behind the ad-numbers pull. Nothing ever ran api/campaigns/sync.mjs on
   a schedule, and the pull only reached back seven days, so a week nobody
   pressed Sync in was lost for good and drew on screen as zero spend. It is a
   cron with no event trigger, so like every sweeper here it will always appear
   in neverFired, which is the correct outcome for a scheduled job rather than a
   coverage hole.

   Was 73 since the Finance OS monthly pull sweeper (2026-09-09) was registered —
   the clock behind the one soft pull a finance-os subscriber's monthly fee
   includes. It is a cron with no event trigger, so like every sweeper here it
   will always appear in neverFired, which is the correct outcome for a
   scheduled job rather than a coverage hole.

   Was 75 until the doc-check retry sweeper (2026-09-17) was registered — the
   clock that re-reads an identity document the AI reader could not read because
   the account had no credit. Before it existed a 429 was written down as a
   finished job and nothing ever came back, so funding the account fixed nothing
   and the client had to be asked for the file again. It is a cron with no event
   trigger, so like every sweeper here it will always appear in neverFired, which
   is the correct outcome for a scheduled job rather than a coverage hole.

   Moved 76 -> 77 on 2026-09-18 with the next-step catch-up (hole 12), a cron
   with no event trigger like every sweeper here. The pin was ALREADY one
   behind before this move (src/workflows/index.mjs served 77 against a pin of
   76), so this still reads one short; that older gap is not this change's.

   Moved 78 -> 79 on 2026-09-22 with the ad video sweeper — the clock that looks
   in the Raw Drive folder for a take Chris just filmed and walks it through
   Submagic to his phone for approval. It is a cron with no event trigger, so
   like every sweeper here it will always appear in neverFired, which is the
   correct outcome for a scheduled job rather than a coverage hole. It is
   exercised directly by src/workflows/ad-video-sweeper.test.mjs.

   Moved 79 -> 90 on 2026-10-05 (CI fix, marketing machine M0 step 6). The pin
   had not moved since 2026-09-22 while these were registered on purpose:
   blueprint-finance-os-alerts, blueprint-next-funding-sequence-sweeper,
   blueprint-closer-ready-sweeper, watch-curve-diagnosis-sweeper,
   slo-genuine-followup, slo-genuine-reply, slo-genuine-checkout-sms,
   slo-infinite-drip, slo-no-reply-197 and slo-paid-form-nudge; and
   ad-video-sweeper left Inngest for a Netlify scheduled function. The pin was
   also already two behind src/workflows/index.mjs on 2026-09-22. Every id is
   named in EXPECTED_WORKFLOW_IDS in src/workflows/index.test.mjs.

   Moved 90 -> 91 on 2026-10-05 (marketing machine M0 step 5) with
   meta-campaign-sync-hourly, the hourly 3-day Meta pull. A cron with no event
   trigger, so it sits in neverFired like every sweeper here; it shares its
   module with meta-campaign-sync-sweeper and is told apart by `handles`.

   Moved 91 -> 92 on 2026-10-06 (Finance OS unit C) with
   finance-os-card-due-reminders, the daily card due text. A cron with no
   event trigger, so it sits in neverFired like every sweeper here.

   Moved 92 -> 93 the same day (Finance OS build, unit A) with
   plaid-transactions-sweeper, the daily Plaid charges + deposits pull. A cron
   with no event trigger, so it sits in neverFired like every sweeper here. */
const REGISTERED = 93;

const N = (id, type, cfg = {}, branches) => ({ id, type, title: id, cfg, touches: [], branches });
const cond = (id, lanes) => N(id, "condition", { field: "f", op: "is true" }, lanes);
const lane = (label, nodes) => ({ label, nodes });

// ── path enumeration ──────────────────────────────────────────────────────

test("a straight line is exactly one path", () => {
  const paths = enumeratePaths([N("a", "sms"), N("b", "stage")]);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].map((s) => s.node.id), ["a", "b"]);
});

test("ACCEPTANCE: N conditions produce 2^N paths", () => {
  // Built rather than taken from the seed, because the authored journeys top
  // out at one condition each and 2^1 would not distinguish a correct walker
  // from one that forks only at the first fork it meets.
  const build = (n) => {
    let nodes = [N("tail", "stage")];
    for (let i = n; i >= 1; i--) {
      nodes = [cond(`c${i}`, [lane("Yes", [N(`y${i}`, "sms")]), lane("No", [N(`n${i}`, "sms")])]), ...nodes];
    }
    return nodes;
  };

  for (let n = 0; n <= 4; n++) {
    assert.equal(enumeratePaths(build(n)).length, 2 ** n, `${n} conditions must yield ${2 ** n} paths`);
  }

  // Four conditions is sixteen paths, and every one is distinct.
  const paths = enumeratePaths(build(4));
  const shapes = new Set(paths.map((p) => p.map((s) => s.node.id).join(">")));
  assert.equal(shapes.size, 16, "all sixteen paths must be distinct");
});

test("both lanes of a condition are walked, and the tail is shared", () => {
  const paths = enumeratePaths([
    cond("c1", [lane("Qualified", [N("q", "stage")]), lane("Not yet", [N("d", "stage")])]),
    N("tail", "email")
  ]);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map((p) => p.map((s) => s.node.id)), [["c1", "q", "tail"], ["c1", "d", "tail"]]);
  assert.deepEqual(paths.map((p) => p[0].lane), ["Qualified", "Not yet"]);
});

test("nested conditions multiply", () => {
  const paths = enumeratePaths([
    cond("outer", [
      lane("Yes", [cond("inner", [lane("Yes", [N("a", "sms")]), lane("No", [N("b", "sms")])])]),
      lane("No", [N("c", "sms")])
    ])
  ]);
  // Yes>Yes, Yes>No, No — three, not four: the No lane has no inner fork.
  assert.equal(paths.length, 3);
});

test("the six seeded journeys walk to nine paths", () => {
  const counts = Object.fromEntries(
    Object.entries(SEED_JOURNEYS).map(([k, j]) => [k, enumeratePaths(j.nodes).length])
  );
  assert.deepEqual(counts, { client: 2, setter: 2, closer: 2, advisor: 1, affiliate: 1, partner: 1 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 9);
});

// ── the registry ──────────────────────────────────────────────────────────

/* contract-chaser and message-dispatch-sweeper are CRONs with no event
   trigger, so no journey will ever reach them and they will always sit in
   neverFired — which is the correct outcome, not a coverage hole. The counts
   here are pinned (see REGISTERED at the top) so that registering a workflow
   stays a visible decision; see the note in src/workflows/index.test.mjs. */
test("ACCEPTANCE: the registry accounts for every registered workflow", async () => {
  const reg = await loadRegistry();
  assert.equal(reg.registered, REGISTERED, `src/workflows/index.mjs registers ${REGISTERED} functions`);
  assert.equal(
    reg.workflows.length + reg.unrunnable.length,
    REGISTERED,
    "every registered workflow is either runnable or explicitly listed as unrunnable"
  );
  assert.deepEqual(reg.unrunnable, [], "no registered workflow should be unreachable by the runner");
});

test("every workflow is either fired or named in neverFired — none silently missing", async () => {
  const reg = await loadRegistry();
  /* n-06 is event-triggered but no seeded journey walks it yet — pretend it
     fired so the accounting still covers every registered id. s-02 was removed
     from the registry; do not re-list a ghost id here. */
  const pretendFired = ["n-06-renewal-second-wave"];
  const never = neverFired(reg, pretendFired);
  assert.equal(never.length + pretendFired.length, REGISTERED);
  const all = new Set([...never.map((w) => w.id), ...pretendFired]);
  assert.equal(all.size, REGISTERED);
  for (const fn of functions) assert.ok(all.has(fn.id()), `${fn.id()} is unaccounted for`);
});

// ── a full walk ───────────────────────────────────────────────────────────

/* A Postgres stand-in wide enough to let the real bus and the real workflow
   bodies run. Reads answer empty, which is the honest shape of a fresh
   database: no templates, no funding rounds, no prior state. Writes are
   recorded so the walk can be inspected. */
function fakeDb() {
  const clients = [];
  const events = [];
  const inserted = [];
  let seq = 0;
  return {
    clients,
    events,
    inserted,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      inserted.push(s.slice(0, 60));

      if (/^INSERT INTO clients/i.test(s)) {
        const row = {
          id: `cl-${++seq}`,
          org_id: params[0],
          first_name: params[1],
          last_name: params[2],
          email: params[3],
          phone: params[4],
          custom_fields: JSON.parse(params[5])
        };
        clients.push(row);
        return { rows: [row] };
      }
      if (/^INSERT INTO events/i.test(s)) {
        const row = { id: `ev-${++seq}` };
        events.push({ name: params[1] ?? null });
        return { rows: [row], rowCount: 1 };
      }
      // Everything else: no rows. No templates means sendTemplated returns
      // template_pending, which is exactly what a fresh database does.
      return { rows: [], rowCount: 0 };
    }
  };
}

test("ACCEPTANCE: every walked path gets its own synthetic client", async () => {
  const db = fakeDb();
  const report = await run(db, {
    journeys: SEED_JOURNEYS,
    orgId: "org-1",
    runId: "t1",
    env: {}
  });

  assert.equal(report.paths.length, 9, "nine paths across the six seeded journeys");

  const ids = report.paths.map((p) => p.clientId);
  assert.equal(new Set(ids).size, 9, "each path forks its own client — no sharing");

  for (const row of db.clients) {
    assert.ok(isSyntheticRow(row), "every minted client carries the synthetic marker");
    assert.match(row.email, /@runner\.fundhub\.invalid$/, "and an unroutable address");
  }
});

test("a walk records branches, steps and virtual time", async () => {
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t2", env: {}, only: "client" });

  assert.equal(report.paths.length, 2);
  const [yes, no] = report.paths;
  assert.deepEqual(yes.branches.map((b) => b.lane), ["Yes"]);
  assert.deepEqual(no.branches.map((b) => b.lane), ["No"]);
  assert.equal(yes.branches[0].field, "survey_complete");

  // The client journey holds a two-day wait, so virtual time must have moved
  // by at least that much.
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  assert.ok(yes.virtualElapsedMs >= twoDays, `expected >= ${twoDays}, got ${yes.virtualElapsedMs}`);
  assert.ok(yes.steps.some((s) => s.type === "wait" && s.waitedMs === twoDays));
  assert.equal(yes.terminal, "complete");
});

test("the coverage report names every unreached workflow explicitly", async () => {
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t3", env: {} });
  const c = report.workflowCoverage;
  assert.equal(c.registered, REGISTERED);
  assert.equal(
    c.fired.length + c.neverFired.length,
    REGISTERED,
    "fired + neverFired must account for every registered workflow — one missing from both is a silent coverage hole"
  );
});

test("a journey with no canonical start event is reported, not invented", async () => {
  assert.equal(START_EVENT.partner, null);
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t4", env: {} });
  assert.deepEqual(report.journeysWithoutStartEvent, ["partner"]);
  const partnerPath = report.paths.find((p) => p.pathId.startsWith("partner#"));
  assert.deepEqual(partnerPath.events, [], "no event may be fabricated for it");
});

// ── nothing leaves the machine ────────────────────────────────────────────

/* THE MOST IMPORTANT TEST IN THIS FILE.
 *
 * src/events/bus.mjs ends emit() by handing the event to the Inngest job cloud
 * over HTTP, unless the caller passes skipInngest. That send is a network call
 * and a network call cannot be rolled back — while the whole promise this
 * harness makes to the owner is "nothing was saved, the run was undone".
 *
 * INNGEST_EVENT_KEY is set in production, so the branch is live there. This
 * test turns it on deliberately and stands a counter in front of inngest.send,
 * because the only honest way to prove nothing goes out is to make it possible
 * for something to go out and then show that nothing did. */
test("ACCEPTANCE: a run never hands an event to the live automation service", async () => {
  const realSend = inngest.send;
  const realKey = process.env.INNGEST_EVENT_KEY;
  let sends = 0;
  // A fake value, not a credential. It exists only to make the branch reachable.
  process.env.INNGEST_EVENT_KEY = "not-a-real-key-this-test-only";
  inngest.send = async (...args) => { sends += 1; return args; };
  try {
    const db = fakeDb();
    const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t5", env: {} });
    // The run really did fire events — otherwise a zero below proves nothing.
    const fired = report.paths.reduce((sum, p) => sum + p.events.length, 0);
    assert.ok(fired > 0, `the run must actually fire events for this test to mean anything, fired ${fired}`);
    assert.equal(sends, 0, `the runner sent ${sends} event(s) to Inngest; a rollback cannot recall those`);
  } finally {
    inngest.send = realSend;
    if (realKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = realKey;
  }
});

// ── a key nothing can start is loud ───────────────────────────────────────

test("a journey key the runner has never heard of is named, not silently skipped", async () => {
  /* This is what a Demo Mode row did. It walked, fired nothing, and the report
     said "0 automations reached" with no way to tell that from a genuinely
     disconnected product. */
  const db = fakeDb();
  const report = await run(db, {
    journeys: { "demo-platform-nurture": { name: "DEMO", start: "x", end: "y", nodes: [N("n1", "record")] } },
    orgId: "org-1",
    runId: "t6",
    env: {}
  });

  const path = report.paths[0];
  assert.equal(path.startEventStatus, "unknown-journey");
  assert.deepEqual(path.events, [], "no event may be invented for a key the runner does not know");

  assert.equal(report.startEventFindings.length, 1);
  assert.equal(report.startEventFindings[0].journey, "demo-platform-nurture");
  assert.match(
    report.startEventFindings[0].note,
    /nothing in the code can start the demo-platform-nurture journey/
  );
});

test("the partner journey's missing start event is reported with its own reason", async () => {
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t7", env: {}, only: "partner" });
  assert.equal(report.startEventFindings.length, 1);
  assert.equal(report.startEventFindings[0].status, "no-canonical-event");
  assert.match(report.startEventFindings[0].note, /no canonical opening event/);
});

test("one finding per journey key, not one per path", async () => {
  const db = fakeDb();
  const report = await run(db, {
    journeys: { mystery: { name: "M", start: "x", end: "y", nodes: [cond("c1", [lane("Yes", []), lane("No", [])])] } },
    orgId: "org-1",
    runId: "t8",
    env: {}
  });
  assert.equal(report.paths.length, 2, "two lanes, two paths");
  assert.equal(report.startEventFindings.length, 1, "and one finding between them");
});

// ── the message ledger ────────────────────────────────────────────────────

test("a path reports the message rows that were written, not just the ones that went out", async () => {
  /* The fake database answers the ledger read with two rows: one sent, one
     still queued. The provider recorded nothing, which is exactly the shape
     that used to be reported as "no message row was written". */
  const db = fakeDb();
  const base = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/^\s*SELECT status, channel, template_key, blocked_reason/i.test(sql)) {
      return { rows: [
        { status: "sent", channel: "sms", template_key: "T1", blocked_reason: null },
        { status: "queued", channel: "sms", template_key: "T2", blocked_reason: null }
      ] };
    }
    return base(sql, params);
  };

  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t9", env: {}, only: "advisor" });
  const ledger = report.paths[0].messageLedger;
  assert.equal(ledger.queued, 2);
  assert.equal(ledger.sent, 1);
  assert.equal(ledger.held, 1);
  assert.equal(report.paths[0].messages.length, 0, "the provider recorded nothing — the two numbers are not the same number");
});

test("a messages table that will not read gives null, never zero", async () => {
  const db = fakeDb();
  const base = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/^\s*SELECT status, channel, template_key, blocked_reason/i.test(sql)) {
      throw new Error('relation "messages" does not exist');
    }
    return base(sql, params);
  };

  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t10", env: {}, only: "advisor" });
  assert.equal(report.paths[0].messageLedger, null, "could not look is not the same as nothing was written");
});
