import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sweep, dueClients, SCHEDULED_PULL_REASON, MONTHLY_PULL_DAYS, monthlyPullKey } from "./finance-os-pull-sweeper.mjs";
import { SoftPullError } from "../finance/soft-pulls.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT_A = "22222222-2222-2222-2222-222222222222";
const CLIENT_B = "33333333-3333-3333-3333-333333333333";
const SUB_A = "44444444-4444-4444-4444-444444444444";

/** A queue-driven fake db. Each entry is either an array of rows, or a
    function(text, params) so a test can branch on which query is running —
    the sweeper issues the due-clients SELECT once, then requestSoftPull's own
    sequence (consent, open-request check, insert) once per due client. */
function fakeDb(queue) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      if (/WHERE org_id = \$1 AND idempotency_key = \$2/.test(text)) return { rows: [] };
      const next = queue[i++];
      if (typeof next === "function") return next(text, params);
      return { rows: (next || []).map((row) => row.subscription_id
        ? { current_period_start: "2026-09-09T00:00:00Z", ...row } : row) };
    }
  };
}

const consentRow = () => ({
  id: "cc", org_id: ORG, kind: "soft_pull_consent",
  granted_at: new Date(Date.now() - 60_000), expires_at: null,
  revoked_at: null, is_valid: true
});

describe("dueClients", () => {
  test("requires active paid access and a 30-day cooldown rather than one pull per annual period", async () => {
    const db = fakeDb([[]]);
    await dueClients(db, new Date("2026-09-09"));
    const [{ text, params }] = db.calls;
    assert.match(text, /tier\s*=\s*\$1/);
    assert.match(text, /status\s*=\s*'active'/);
    assert.match(text, /current_period_start IS NOT NULL/);
    assert.match(text, /requested_by_kind\s*=\s*'system'/);
    assert.match(text, /r\.org_id = s\.org_id/);
    assert.match(text, /s\.current_period_start <= \$2/);
    assert.match(text, /s\.current_period_end > \$2/);
    assert.match(text, /r\.requested_at > \$2::timestamptz - \(\$3::int \* interval '1 day'\)/);
    assert.doesNotMatch(text, /requested_at >= s\.current_period_start/);
    assert.equal(params[0], "finance-os");
    assert.equal(params[2], 30);
  });
});

describe("sweep", () => {
  test("an empty due list writes nothing and errors nothing", async () => {
    const db = fakeDb([[]]);
    const tally = await sweep(db, {
      now: new Date("2026-09-09"),
      fulfil: async () => ({ checked: 0, fulfilled: 0 })
    });
    assert.equal(tally.checked, 0);
    assert.equal(tally.requested, 0);
    assert.deepEqual(tally.skipped, []);
    assert.deepEqual(tally.errored, []);
    assert.ok(tally.fulfil);
    assert.equal(tally.ok, true);
  });

  test("a due client with valid consent and nothing open gets a system-requested row", async () => {
    const db = fakeDb([
      [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }], // dueClients
      [consentRow()],                                                 // consent gate
      [],                                                              // open-request check
      [{ id: "rr", requested_by_kind: "system", status: "queued" }]    // INSERT RETURNING
    ]);
    const tally = await sweep(db, { now: new Date("2026-09-09") });
    assert.equal(tally.checked, 1);
    assert.equal(tally.requested, 1);
    assert.deepEqual(tally.skipped, []);
    assert.deepEqual(tally.errored, []);

    const insert = db.calls.find((c) => /INSERT INTO soft_pull_requests/.test(c.text));
    assert.ok(insert);
    assert.equal(insert.params[2], "system");
    assert.equal(insert.params[5], SCHEDULED_PULL_REASON);
    assert.equal(insert.params[7], SUB_A, "subscription_id is threaded onto the row");
    assert.equal(insert.params[8], `finance-os-monthly:${SUB_A}:0`);
  });

  test("a client with no valid consent is skipped, not errored", async () => {
    const db = fakeDb([
      [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }],
      [] // consent gate: nothing on file
    ]);
    const tally = await sweep(db, { now: new Date("2026-09-09") });
    assert.equal(tally.requested, 0);
    assert.deepEqual(tally.skipped, [{ clientId: CLIENT_A, reason: "consent_required" }]);
    assert.deepEqual(tally.errored, [], "a refused consent gate is not a fault");
  });

  test("a client with an already-open pull is skipped, not double-requested", async () => {
    const db = fakeDb([
      [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }],
      [consentRow()],
      [{ id: "existing", status: "queued" }] // openRequestFor finds one
    ]);
    const tally = await sweep(db, { now: new Date("2026-09-09") });
    assert.equal(tally.requested, 0);
    assert.equal(tally.skipped.length, 1);
    assert.equal(tally.skipped[0].clientId, CLIENT_A);
  });

  test("one client's fault does not stop the pass for the next one", async () => {
    const db = fakeDb([
      [
        { subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A },
        { subscription_id: "55555555-5555-5555-5555-555555555555", org_id: ORG, client_id: CLIENT_B }
      ],
      () => { throw new Error("the database fell over"); }, // CLIENT_A's consent read throws
      [consentRow()], // CLIENT_B's consent read
      [],
      [{ id: "rr", requested_by_kind: "system", status: "queued" }]
    ]);
    const tally = await sweep(db, { now: new Date("2026-09-09") });
    assert.equal(tally.checked, 2);
    assert.equal(tally.requested, 1, "the second client still gets its row");
    assert.equal(tally.errored.length, 1);
    assert.equal(tally.errored[0].clientId, CLIENT_A);
    assert.match(tally.errored[0].error, /fell over/);
    assert.equal(tally.ok, false);
  });

  test("never throws for the whole pass, whatever a single client does", async () => {
    const db = fakeDb([
      [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }],
      () => { throw new SoftPullError("nope", { status: 500 }); }
    ]);
    await assert.doesNotReject(() => sweep(db, { now: new Date("2026-09-09") }));
  });
});

test("provider and fulfil-hook failures remain a failed pass", async () => {
  for (const fulfil of [
    async () => ({ failed: 1 }),
    async () => ({ errored: [{ error: "aftercare failed" }] }),
    async () => { throw new Error("provider unavailable"); }
  ]) {
    const tally = await sweep(fakeDb([[]]), { now: new Date("2026-09-09"), fulfil });
    assert.equal(tally.ok, false);
  }
});

test("monthly idempotency keys repeat within a 30-day window and advance during an included year", () => {
  const row = { subscription_id: SUB_A, current_period_start: "2026-01-01T00:00:00Z" };
  assert.equal(MONTHLY_PULL_DAYS, 30);
  assert.equal(monthlyPullKey(row, new Date("2026-01-01")), `finance-os-monthly:${SUB_A}:0`);
  assert.equal(monthlyPullKey(row, new Date("2026-01-30T23:59:59.999Z")), `finance-os-monthly:${SUB_A}:0`);
  assert.equal(monthlyPullKey(row, new Date("2026-01-31")), `finance-os-monthly:${SUB_A}:1`);
  assert.equal(monthlyPullKey(row, new Date("2026-03-02")), `finance-os-monthly:${SUB_A}:2`);
  assert.throws(() => monthlyPullKey(row, new Date("2025-12-31")), /valid open access period/);
});

test("a concurrent pass with the same saved monthly key cannot make another request", async () => {
  const base = fakeDb([
    [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }],
    [consentRow()]
  ]);
  const db = { calls: base.calls, async query(text, params) {
    if (/WHERE org_id = \$1 AND idempotency_key = \$2/.test(text)) {
      base.calls.push({ text, params });
      return { rows: [{ id: "already-fulfilled", client_id: CLIENT_A, status: "fulfilled" }] };
    }
    return base.query(text, params);
  } };
  const tally = await sweep(db, { now: new Date("2026-09-09"), fulfil: null });
  assert.equal(tally.requested, 0);
  assert.equal(tally.skipped[0].reason, "replay");
  assert.equal(db.calls.some(({ text }) => /INSERT INTO soft_pull_requests/.test(text)), false);
});

test("Blueprint real mode can recover from a completed simulation without replaying its request key", async () => {
  const now = new Date("2026-09-09T00:00:00Z");
  const db = fakeDb([[]]);
  await dueClients(db, now, { realPull: true });
  assert.equal(db.calls[0].params[3], true);
  assert.match(db.calls[0].text, /cr\.provider = 'crs_softview_simulated'/);
  assert.match(db.calls[0].text, /cr\.org_id = r\.org_id AND cr\.client_id = r\.client_id/);
  assert.match(db.calls[0].text, /r\.status <> 'fulfilled'/);
  const row = { subscription_id: SUB_A, current_period_start: now };
  const rehearsal = monthlyPullKey(row, now);
  const live = monthlyPullKey(row, now, { realPull: true });
  assert.equal(rehearsal, `finance-os-monthly:${SUB_A}:0`);
  assert.equal(live, `finance-os-monthly:${SUB_A}:0:real`);
  assert.notEqual(live, rehearsal, "simulated request cannot steal the live replay key");
});

test("live flags affect both the due check and the new real request key", async () => {
  const db = fakeDb([
    [{ subscription_id: SUB_A, org_id: ORG, client_id: CLIENT_A }],
    [consentRow()], [], [{ id: "new-live-request", requested_by_kind: "system", status: "queued" }]
  ]);
  const now = new Date("2026-09-09T00:00:00Z");
  const tally = await sweep(db, { now, env: { FINANCE_OS_SYSTEM_PULL_LIVE: "1", CRS_ALLOW_LIVE: "1" },
    fulfil: async () => ({ checked: 0, fulfilled: 0 }) });
  assert.equal(tally.requested, 1);
  assert.equal(db.calls[0].params[3], true);
  const inserted = db.calls.find(c => /INSERT INTO soft_pull_requests/.test(c.text));
  assert.equal(inserted.params[8], `finance-os-monthly:${SUB_A}:0:real`);
});
