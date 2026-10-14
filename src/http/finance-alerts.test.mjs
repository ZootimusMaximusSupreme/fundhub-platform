/* /api/finance/alerts, driven end to end against a stubbed database.
 *
 * WHY IT LIVES HERE AND NOT NEXT TO THE HANDLER. package.json's test glob walks
 * src/ and scripts/ ONLY (CLAUDE.md, traps). A test placed under api/ is never
 * run by anything and reports nothing, forever. So the test sits in src/http/
 * and imports the api/ handler, which is the convention the rest of this
 * directory follows.
 *
 * WHY IT RUNS WITHOUT POSTGRES. src/db.mjs exports `db` as a plain object with
 * one `query` method, so the session lookup and every read this endpoint issues
 * can be stubbed and the handler runs exactly as it does in production. Same
 * approach as src/http/finance-liabilities.test.mjs, and for the same reason:
 * THE TENANCY BUG THIS GUARDS IS INVISIBLE ON A ONE-ORG DATABASE, and every
 * database this repo has is a one-org database.
 *
 * THE FIVE THINGS THIS FILE EXISTS TO STOP:
 *
 *   1. A RULE FIRING ON A NUMBER NOBODY CHOSE. 079 ships every rule off with an
 *      empty threshold on purpose. A save that omits `enabled` must leave it
 *      off, and an empty threshold box must reach the column as NULL and never
 *      as 0 — a 0% threshold fires on every client who has any balance at all.
 *
 *   2. A DRY RUN THAT WRITES. The preview runs the real evaluator inside a
 *      transaction it throws away. If it cannot pin a connection it must REFUSE,
 *      because the alternative — running unpinned on the shared `{ query }`
 *      handle, which is audit M7's trap in four other files — writes alerts
 *      about real people while the button says nothing will be written.
 *
 *   3. A SILENT RULE. A rule that is off appears in neither `raised` nor
 *      `skipped`, so a screen fed only the store's answer shows nothing where a
 *      rule should be, and nothing reads as "you are fine". Every rule must come
 *      back with an outcome, including "we did not look".
 *
 *   4. AN UNKNOWN RENDERED AS A NUMBER. A figure the evaluator could not work
 *      out crosses the wire as display:null so the screen can draw an em dash.
 *      Never 0, never "0.00", never 0%.
 *
 *   5. A CROSS-TENANT READ OR WRITE. Every id is bound alongside the SESSION's
 *      org, never the query string's, and the tests assert on the PARAMETERS
 *      actually bound rather than on the response.
 */
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/finance/alerts.mjs";
import { ROLE_SETS } from "./read-api.mjs";
import { TRIGGER_RULES } from "../alerts/store.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A; ORG_B's ids are what a
   mistaken or malicious caller pastes in. On a single-org database these are the
   same value and the bug is unobservable, which is exactly why it survives. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CLIENT = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const ALERT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "5ta44444-4444-4444-4444-444444444444".replace(/[^0-9a-f-]/g, "4");

const TRADELINE = (over = {}) => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  org_id: ORG_A, client_id: CLIENT, lender: "Chase Ink", kind: "revolving",
  credit_limit_cents: "1000000", balance_cents: "800000", apr: "0.24990",
  closed_at: null, as_of: "2026-07-01T00:00:00.000Z", source: "manual", ...over
});

const TRIGGER = (over = {}) => ({
  id: "ttttttt1-tttt-4ttt-8ttt-tttttttttttt".replace(/t/g, "1"),
  org_id: ORG_A, rule: "utilization_over_threshold", enabled: true,
  threshold_bps: 3000, threshold_score: null, severity: "warning",
  notes: null, signed_off_at: null, signed_off_by: null,
  created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", ...over
});

const ALERT_ROW = (over = {}) => ({
  id: ALERT, org_id: ORG_A, client_id: CLIENT, tradeline_id: null, assigned_to: null,
  kind: "utilization_threshold", severity: "warning", state: "open",
  title: "Total utilization is 80%, over the configured 30% threshold.",
  detail: {
    known: true, threshold: 0.3, utilization: 0.8, utilizationPct: 80,
    balanceCents: 800000, limitCents: 1000000, partial: false,
    lines: { total: 1, counted: 1, known: 1, unknown: 0, excludedClosed: 0, excludedInstallment: 0 }
  },
  dedupe_key: "utilization_threshold:" + CLIENT + "::3000",
  as_of: "2026-07-01T00:00:00.000Z", raised_at: "2026-07-20T09:00:00.000Z",
  acknowledged_at: null, acknowledged_by: null, resolved_at: null, resolved_by: null,
  dismissed_reason: null, trigger_id: null,
  created_at: "2026-07-20T09:00:00.000Z", updated_at: "2026-07-20T09:00:00.000Z", ...over
});

let savedQuery = null;
beforeEach(() => { savedQuery = db.query; });
afterEach(() => { db.query = savedQuery; });

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/**
 * call(opts) — run the real handler against a stubbed database.
 *
 * Every query is recorded with its SQL and its bound parameters, because "which
 * rows was this allowed to reach" is a question only the parameters can answer.
 * The session lookup is the fallback branch, exactly as in
 * finance-liabilities.test.mjs.
 */
async function call({
  role = "owner",
  orgId = ORG_A,
  method = "GET",
  query = {},
  body = undefined,
  authenticated = true,
  owns = true,
  clients = null,             // two companies' client rows; answers the ownership check the way its SQL says
  snapshots = null,           // two companies' score rows; answers the score read the way its SQL says
  alerts = [ALERT_ROW()],
  triggers = [],
  tradelines = [TRADELINE()],
  snapshot = { score: 640, bureau: "Equifax", source: "crs", is_primary: true, created_at: "2026-07-02T00:00:00.000Z" },
  clientRows = [{ id: CLIENT, first_name: "Dana", last_name: "Reyes" }],
  updated = undefined,        // what an UPDATE alerts returns; [] means "no row moved"
  found = undefined,          // what the follow-up SELECT finds after a no-op UPDATE
  inserted = undefined,       // what an INSERT INTO alerts returns
  savedTrigger = undefined
} = {}) {
  const reads = [];
  db.query = async (sql, params) => {
    const s = String(sql);
    const record = (kind) => { reads.push({ kind, sql: s, params }); };

    if (/FROM\s+clients\s+WHERE\s+org_id/i.test(s)) {
      record("clientNames");
      return { rows: clientRows };
    }
    if (/FROM\s+clients\s+WHERE\s+id/i.test(s)) {
      record("ownsClient");
      if (clients) {
        const scoped = /AND\s+org_id\s*=\s*\$2/i.test(s);
        return { rows: clients.filter((c) => c.id === params[0] && (!scoped || c.org_id === params[1])) };
      }
      return { rows: owns ? [{ "?column?": 1 }] : [] };
    }
    if (/INSERT\s+INTO\s+upsell_triggers/i.test(s)) {
      record("setTrigger");
      return { rows: [savedTrigger || TRIGGER({ enabled: false, threshold_bps: null })] };
    }
    if (/FROM\s+upsell_triggers/i.test(s)) {
      record(/AND\s+enabled/i.test(s) ? "enabledTriggers" : "listTriggers");
      return { rows: /AND\s+enabled/i.test(s) ? triggers.filter((t) => t.enabled) : triggers };
    }
    if (/INSERT\s+INTO\s+alerts/i.test(s)) {
      record("insertAlert");
      return { rows: inserted === undefined ? [ALERT_ROW()] : inserted };
    }
    if (/UPDATE\s+alerts/i.test(s)) {
      record("updateAlert");
      return { rows: updated === undefined ? [ALERT_ROW({ state: "acknowledged" })] : updated };
    }
    if (/FROM\s+alerts/i.test(s)) {
      record("readAlerts");
      return { rows: found === undefined ? alerts : found };
    }
    if (/FROM\s+tradelines/i.test(s)) {
      record("tradelines");
      return { rows: tradelines };
    }
    if (/FROM\s+snapshots/i.test(s)) {
      record("score");
      if (snapshots) {
        const scoped = /WHERE\s+org_id\s*=\s*\$1/i.test(s);
        return { rows: snapshots.filter((x) => x.client_id === params[1] && (!scoped || x.org_id === params[0])) };
      }
      return { rows: snapshot ? [snapshot] : [] };
    }
    // verifySession's CTE. One live session for a staff member with this role.
    if (!authenticated) return { rows: [] };
    return {
      rows: [{
        session_id: "sess-1",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        staff_id: STAFF,
        org_id: orgId,
        role,
        email: `${role}@fundhub.ai`,
        name: role,
        status: "active",
        active_flag: "true"
      }]
    };
  };

  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query, body };
  const thrown = await handler(req, res).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, reads, thrown };
}

const post = (body, opts = {}) => call({ method: "POST", body, ...opts });
const ruleNamed = (rules, name) => rules.find((r) => r.rule === name);

/* ── the gate ──────────────────────────────────────────────────────────────── */

describe("who may reach this endpoint at all", () => {

  test("no session is a 401 and reads nothing", async () => {
    const r = await call({ authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(r.reads, []);
  });

  for (const role of [...ROLE_SETS.STAFF]) {
    test(`a ${role} may read the queue`, async () => {
      const r = await call({ role });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.STAFF and was refused`);
    });
  }

  for (const role of ["partner", "client", "", null]) {
    test(`a session whose role is ${JSON.stringify(role)} is refused and reads nothing`, async () => {
      const r = await call({ role });
      assert.equal(r.status, 403, "the gate is deny-by-default");
      assert.deepEqual(r.reads, []);
    });
  }

  test("a session with NO org binds nothing and matches nothing — it fails CLOSED", async () => {
    const r = await call({ orgId: null });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(r.reads, [], "an org-less session reached the database");
  });

  test("a DELETE is a 405 with an allow header, before any database work", async () => {
    const r = await call({ method: "DELETE" });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "GET, POST");
    assert.deepEqual(r.reads, []);
  });

  test("an unknown action is refused and writes nothing", async () => {
    const r = await post({ action: "delete_everything" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_action");
    assert.deepEqual(r.reads, []);
  });
});

/* ── configuration is a narrower gate than the queue ───────────────────────── */

describe("changing a rule is not queue work", () => {

  const staffOnly = [...ROLE_SETS.STAFF].filter((r) => !ROLE_SETS.FINANCE.has(r));

  for (const role of staffOnly) {
    test(`a ${role} may read the rules but may not change one`, async () => {
      const read = await call({ role, query: { view: "triggers" } });
      assert.equal(read.status, 200);

      const write = await post(
        { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30 },
        { role }
      );
      assert.equal(write.status, 403);
      assert.ok(!write.reads.some((x) => x.kind === "setTrigger"),
        `a ${role} wrote a threshold that decides who gets flagged across the whole book`);
    });
  }

  for (const role of [...ROLE_SETS.FINANCE]) {
    test(`a ${role} may change a rule`, async () => {
      const r = await post(
        { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30 },
        { role }
      );
      assert.equal(r.status, 200);
    });
  }

  test("a rule name that is not one of ours is refused before any write", async () => {
    const r = await post({ action: "set_trigger", rule: "fire_on_everyone", enabled: true });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /rule must be one of/);
    assert.deepEqual(r.reads, []);
  });

  test("a severity that is not one of ours is refused before any write", async () => {
    const r = await post({
      action: "set_trigger", rule: "utilization_over_threshold", severity: "screaming"
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /severity must be one of/);
    assert.deepEqual(r.reads, []);
  });
});

/* ── org scoping: an id is not an authorisation ────────────────────────────── */

describe("org scoping", () => {

  test("the queue read binds the SESSION's org", async () => {
    const r = await call({});
    const read = r.reads.find((x) => x.kind === "readAlerts");
    assert.ok(read.params.includes(ORG_A));
  });

  test("the client check binds the SESSION's org, never the query string's", async () => {
    const r = await call({ query: { client_id: CLIENT, org_id: ORG_B } });
    assert.equal(r.status, 200);
    const check = r.reads.find((x) => x.kind === "ownsClient");
    assert.ok(check.params.includes(ORG_A), "the ownership check did not carry the session's org");
    assert.ok(!check.params.includes(ORG_B), "an org id from the query string reached the database");
  });

  test("a client in another org is a 403 and no alert is read", async () => {
    const r = await call({ query: { client_id: OTHER_CLIENT }, owns: false });
    assert.equal(r.status, 403);
    assert.ok(!r.reads.some((x) => x.kind === "readAlerts"));
  });

  test("a body org_id is refused outright rather than ignored", async () => {
    const r = await post({ action: "evaluate", client_id: CLIENT, org_id: ORG_B });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.deepEqual(r.reads, []);
  });

  test("the name lookup behind the queue is org-scoped too", async () => {
    const r = await call({});
    const names = r.reads.find((x) => x.kind === "clientNames");
    assert.ok(names.params.includes(ORG_A));
  });

  test("a client_id that is not a uuid is a 400, not a 500", async () => {
    const r = await call({ query: { client_id: "zzz" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, []);
  });

  test("a client or a score of another company is not read: the SQL itself carries the company condition", async () => {
    const clients = [{ id: OTHER_CLIENT, org_id: ORG_B }, { id: CLIENT, org_id: ORG_A }];
    const elsewhere = await post({ action: "evaluate", client_id: OTHER_CLIENT }, { clients });
    assert.equal(elsewhere.status, 403, "another company's client is refused");
    assert.ok(!elsewhere.reads.some((x) => x.kind === "tradelines" || x.kind === "score"), "nothing of it is read");

    const snapshots = [
      { org_id: ORG_B, client_id: CLIENT, score: 301, bureau: "Other", source: "crs", is_primary: true, created_at: "2026-07-03T00:00:00.000Z" },
      { org_id: ORG_A, client_id: CLIENT, score: 640, bureau: "Equifax", source: "crs", is_primary: true, created_at: "2026-07-02T00:00:00.000Z" }
    ];
    const own = await post({ action: "evaluate", client_id: CLIENT }, { clients, snapshots });
    assert.equal(own.status, 200);
    assert.equal(own.body.inputs.score.score, 640, "this company's score, not the other company's");
    assert.match(own.reads.find((x) => x.kind === "ownsClient").sql, /WHERE\s+id = \$1 AND org_id = \$2/);
    assert.match(own.reads.find((x) => x.kind === "score").sql, /WHERE\s+org_id = \$1 AND client_id = \$2 AND score IS NOT NULL/);
  });

  test("evaluating reads only this org's cards and this org's score", async () => {
    const r = await post({ action: "evaluate", client_id: CLIENT });
    assert.equal(r.status, 200);
    for (const kind of ["tradelines", "score"]) {
      const read = r.reads.find((x) => x.kind === kind);
      assert.ok(read, `the ${kind} read did not happen`);
      assert.ok(read.params.includes(ORG_A), `the ${kind} read did not bind the session's org`);
    }
  });
});

/* ── the rules configuration ───────────────────────────────────────────────── */

describe("GET ?view=triggers", () => {

  test("a company that has configured nothing still sees every rule", async () => {
    const r = await call({ query: { view: "triggers" }, triggers: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.triggers.map((t) => t.rule), [...TRIGGER_RULES],
      "a rule nobody has configured is missing from the screen, so nobody can switch it on");
    for (const t of r.body.triggers) {
      assert.equal(t.configured, false);
      assert.equal(t.enabled, false, "a rule arrived switched on");
    }
  });

  test("an unset threshold is null everywhere and is NEVER a zero", async () => {
    const r = await call({ query: { view: "triggers" }, triggers: [] });
    for (const t of r.body.triggers) {
      assert.equal(t.threshold_bps, null);
      assert.equal(t.threshold_pct, null);
      assert.equal(t.threshold_score, null);
      assert.equal(t.threshold_display, null,
        "an unset threshold arrived as a printable value, which the screen would show as a number");
    }
  });

  test("a threshold of zero is a REAL setting and is not reported as unset", async () => {
    const r = await call({
      query: { view: "triggers" },
      triggers: [TRIGGER({ threshold_bps: 0, enabled: false })]
    });
    const t = ruleNamed(r.body.triggers, "utilization_over_threshold");
    assert.equal(t.threshold_bps, 0);
    assert.equal(t.threshold_pct, 0);
    assert.equal(t.threshold_display, "0%",
      "a 0% threshold — which fires on everybody — was reported as 'not set'");
  });

  test("configured-and-off is distinguishable from never-configured", async () => {
    const r = await call({
      query: { view: "triggers" },
      triggers: [TRIGGER({ enabled: false, threshold_bps: 3000 })]
    });
    const configured = ruleNamed(r.body.triggers, "utilization_over_threshold");
    const never = ruleNamed(r.body.triggers, "score_below_threshold");
    assert.deepEqual(
      [configured.configured, configured.enabled],
      [true, false]
    );
    assert.deepEqual([never.configured, never.enabled], [false, false]);
  });

  test("every rule says what it measures, in one sentence, with no adjective about credit", async () => {
    const r = await call({ query: { view: "triggers" }, triggers: [] });
    for (const t of r.body.triggers) {
      assert.ok(t.measures && t.measures.length > 40, `${t.rule} has no description`);
      assert.ok(!/\b(good|bad|excellent|poor|fair credit|bad credit)\b/i.test(t.measures),
        `${t.rule}'s description judges somebody's credit: ${t.measures}`);
    }
  });

  test("the read says whether THIS reader may change any of it", async () => {
    const owner = await call({ role: "owner", query: { view: "triggers" } });
    assert.equal(owner.body.can_configure, true);

    const closer = await call({ role: "closer", query: { view: "triggers" } });
    assert.equal(closer.body.can_configure, false,
      "a closer is told they may configure rules, so the screen offers a button that 403s");
  });

  test("a threshold in basis points is reported in the unit a person reads", async () => {
    const r = await call({
      query: { view: "triggers" },
      triggers: [TRIGGER({ threshold_bps: 3050 })]
    });
    const t = ruleNamed(r.body.triggers, "utilization_over_threshold");
    assert.equal(t.threshold_pct, 30.5);
    assert.equal(t.threshold_display, "30.5%");
  });
});

/* ── saving a rule ─────────────────────────────────────────────────────────── */

describe("POST set_trigger — the number that decides who gets flagged", () => {

  test("a save that does not say `enabled` leaves the rule OFF", async () => {
    const r = await post({ action: "set_trigger", rule: "utilization_over_threshold", threshold_pct: 30 });
    assert.equal(r.status, 200);
    const write = r.reads.find((x) => x.kind === "setTrigger");
    assert.equal(write.params[2], false, "a rule came on by omission");
  });

  test("an empty threshold box is written as NULL, not as zero", async () => {
    const r = await post({
      action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: ""
    });
    assert.equal(r.status, 200);
    const write = r.reads.find((x) => x.kind === "setTrigger");
    assert.strictEqual(write.params[3], null,
      "an empty threshold reached the column as a number — 0% fires on every client with a balance");
  });

  test("a percentage typed by a person becomes basis points exactly once", async () => {
    const r = await post({
      action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30
    });
    const write = r.reads.find((x) => x.kind === "setTrigger");
    assert.equal(write.params[3], 3000);
  });

  test("a fractional percentage does not pick up floating-point dust", async () => {
    const r = await post({
      action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30.5
    });
    const write = r.reads.find((x) => x.kind === "setTrigger");
    assert.strictEqual(write.params[3], 3050);
  });

  test("basis points may be sent directly, and sending both spellings is refused", async () => {
    const direct = await post({
      action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_bps: 4500
    });
    assert.equal(direct.reads.find((x) => x.kind === "setTrigger").params[3], 4500);

    const both = await post({
      action: "set_trigger", rule: "utilization_over_threshold", threshold_bps: 5000, threshold_pct: 30
    });
    assert.equal(both.status, 400);
    assert.match(both.body.error, /not both/);
    assert.ok(!both.reads.some((x) => x.kind === "setTrigger"));
  });

  test("a score threshold outside the published scale is refused by the store, as a 400", async () => {
    const r = await post({
      action: "set_trigger", rule: "score_below_threshold", enabled: true, threshold_score: 1200
    });
    assert.equal(r.status, 400);
    // The store's own sentence reaches the caller, naming the field and the
    // range rather than a constraint name a person cannot act on.
    assert.match(r.body.error, /thresholdScore must be a whole number between 300 and 850/);
  });

  test("a note nobody edited survives a save that changed something else", async () => {
    const r = await post(
      { action: "set_trigger", rule: "utilization_over_threshold", enabled: true, threshold_pct: 30 },
      { triggers: [TRIGGER({ notes: "chosen by Chris, 12 June", signed_off_at: "2026-06-12T00:00:00.000Z" })] }
    );
    const write = r.reads.find((x) => x.kind === "setTrigger");
    assert.equal(write.params[6], "chosen by Chris, 12 June",
      "the upsert assigns every column from EXCLUDED, so an unsent note is ERASED");
    assert.equal(write.params[7], "2026-06-12T00:00:00.000Z",
      "a sign-off was wiped by an edit to a different field");
  });

  test("an emptied note box clears the note, because that was asked for", async () => {
    const r = await post(
      { action: "set_trigger", rule: "utilization_over_threshold", notes: "  " },
      { triggers: [TRIGGER({ notes: "old reason" })] }
    );
    assert.strictEqual(r.reads.find((x) => x.kind === "setTrigger").params[6], null);
  });
});

/* ── the queue read ────────────────────────────────────────────────────────── */

describe("GET — the raised alerts", () => {

  test("the book read asks for the OPEN queue and says so", async () => {
    const r = await call({});
    assert.equal(r.body.scope, "book");
    assert.equal(r.body.state, "open");
    assert.equal(r.body.alerts.length, 1);
  });

  test("a client read carries every state, because a dismissed alert still happened", async () => {
    const r = await call({
      query: { client_id: CLIENT },
      alerts: [ALERT_ROW({ state: "dismissed", dismissed_reason: "card was paid off that day" })]
    });
    assert.equal(r.body.scope, "client");
    assert.equal(r.body.alerts[0].state, "dismissed");
  });

  test("the numbers behind an alert arrive formatted, with unknown preserved", async () => {
    const r = await call({});
    const figures = r.body.alerts[0].figures;
    const byLabel = Object.fromEntries(figures.map((f) => [f.label, f]));
    assert.equal(byLabel["Card use"].display, "80%");
    assert.equal(byLabel["Your threshold"].display, "30%");
    assert.equal(byLabel["Total balance"].display, "8000.00",
      "money was not formatted by money.fromCents on the server");
    assert.equal(byLabel["Total credit limit"].display, "10000.00");
  });

  test("a figure the evaluator could not work out is null, NEVER a zero", async () => {
    const r = await call({
      alerts: [ALERT_ROW({
        detail: {
          known: true, threshold: 0.3, utilization: null, utilizationPct: null,
          balanceCents: 800000, limitCents: null, partial: true,
          lines: { total: 2, counted: 2, known: 1, unknown: 1, excludedClosed: 0, excludedInstallment: 0 }
        }
      })]
    });
    const byLabel = Object.fromEntries(r.body.alerts[0].figures.map((f) => [f.label, f]));
    assert.strictEqual(byLabel["Card use"].display, null,
      "an unknown utilization crossed the wire as a number the screen would print");
    assert.strictEqual(byLabel["Total credit limit"].display, null);
    assert.equal(byLabel["Total balance"].partial, true,
      "a total worked out over a set with holes in it did not carry the floor marker");
  });

  test("a client with no name on file stays null rather than becoming one", async () => {
    const r = await call({ clientRows: [] });
    assert.strictEqual(r.body.alerts[0].client_name, null);
  });

  test("a score alert reports the band and the gate and no adjective", async () => {
    const r = await call({
      alerts: [ALERT_ROW({
        kind: "score_band",
        title: "Credit score on file is 640 (band 600-649), below the configured threshold of 680.",
        detail: { known: true, score: 640, band: "600-649", bandIndex: 2, belowLowestNamedBand: false, meetsFundingCallGate: false }
      })]
    });
    const byLabel = Object.fromEntries(r.body.alerts[0].figures.map((f) => [f.label, f]));
    assert.equal(byLabel["Score on file"].display, "640");
    assert.equal(byLabel["Band"].display, "600-649");
    assert.equal(byLabel["Clears the funding-call gate"].display, "no");
    for (const f of r.body.alerts[0].figures) {
      assert.ok(!/\b(good|bad|excellent|poor)\b/i.test(String(f.display ?? "")),
        "a judgement about somebody's credit reached the wire");
    }
  });

  test("the saving figure on an upsell alert is labelled as arithmetic, not as a promise", async () => {
    const r = await call({
      alerts: [ALERT_ROW({
        kind: "upsell_opportunity",
        detail: {
          suggest: true,
          reasons: [{ code: "HIGH_APR_BALANCE", evidence: {} }],
          estimatedAnnualSavingCents: 96000,
          utilization: { utilizationPct: 41.2, partial: false }
        }
      })]
    });
    const byLabel = Object.fromEntries(r.body.alerts[0].figures.map((f) => [f.label, f]));
    const saving = Object.keys(byLabel).find((k) => /rate difference/i.test(k));
    assert.ok(saving, "the saving figure lost the label that says what it assumes");
    assert.equal(byLabel[saving].display, "960.00");
    assert.equal(byLabel["Cases found"].display, "HIGH_APR_BALANCE");
  });

  test("a silly ?limit= cannot reach Postgres as a negative LIMIT", async () => {
    const r = await call({ query: { limit: "-1" } });
    assert.equal(r.status, 200);
    const read = r.reads.find((x) => x.kind === "readAlerts");
    assert.ok(read.params.every((p) => typeof p !== "number" || p > 0));
  });
});

/* ── running the rules ─────────────────────────────────────────────────────── */

describe("POST evaluate", () => {

  test("every rule comes back with an outcome, including the ones that are off", async () => {
    const r = await post({ action: "evaluate", client_id: CLIENT }, { triggers: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.rules.map((x) => x.rule), [...TRIGGER_RULES]);
    for (const rule of r.body.rules) {
      assert.equal(rule.outcome, "not_run");
      assert.equal(rule.reason, "rule_not_configured");
      assert.ok(rule.reason_text.length > 10, "a rule that did not run gave no reason a person can read");
    }
  });

  test("a configured-but-switched-off rule says it is off, not that the client is fine", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      { triggers: [TRIGGER({ enabled: false })] }
    );
    const rule = ruleNamed(r.body.rules, "utilization_over_threshold");
    assert.equal(rule.outcome, "not_run");
    assert.equal(rule.reason, "rule_disabled");
  });

  test("an enabled rule with no threshold refuses to fire and says why", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      { triggers: [TRIGGER({ enabled: true, threshold_bps: null })] }
    );
    const rule = ruleNamed(r.body.rules, "utilization_over_threshold");
    assert.equal(rule.outcome, "not_run");
    assert.equal(rule.reason, "threshold_unset");
    assert.ok(!r.reads.some((x) => x.kind === "insertAlert"), "an unset threshold wrote an alert");
  });

  test("a condition that is TRUE writes an alert and reports the title and the figures", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      { triggers: [TRIGGER({ enabled: true, threshold_bps: 3000 })] }
    );
    assert.equal(r.body.wrote, true);
    assert.equal(r.body.dry_run, false);
    const rule = ruleNamed(r.body.rules, "utilization_over_threshold");
    assert.equal(rule.outcome, "raised");
    assert.equal(rule.alert.id, ALERT);
    assert.ok(rule.alert.figures.length > 0);
    assert.ok(r.reads.some((x) => x.kind === "insertAlert"));
  });

  test("a condition that is FALSE is reported as 'no', which is not the same as 'not run'", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      {
        triggers: [TRIGGER({ enabled: true, threshold_bps: 9000 })],
        tradelines: [TRADELINE({ balance_cents: "100000" })]
      }
    );
    const rule = ruleNamed(r.body.rules, "utilization_over_threshold");
    assert.equal(rule.outcome, "no");
    assert.equal(rule.reason, "condition_false");
  });

  test("an unreadable card makes the answer UNKNOWN, and unknown never fires", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      {
        triggers: [TRIGGER({ enabled: true, threshold_bps: 3000 })],
        tradelines: [TRADELINE(), TRADELINE({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", credit_limit_cents: null })]
      }
    );
    const rule = ruleNamed(r.body.rules, "utilization_over_threshold");
    assert.equal(rule.outcome, "cannot_tell");
    assert.equal(rule.reason, "utilization_unknown");
    assert.ok(!r.reads.some((x) => x.kind === "insertAlert"), "an unknown raised an alert");
  });

  test("no score on file is 'we do not know', not 'below the line'", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      { triggers: [TRIGGER({ rule: "score_below_threshold", enabled: true, threshold_bps: null, threshold_score: 700 })], snapshot: null }
    );
    const rule = ruleNamed(r.body.rules, "score_below_threshold");
    assert.equal(rule.outcome, "cannot_tell");
    assert.equal(rule.reason, "score_unknown");
    assert.equal(r.body.inputs.score.known, false);
    assert.strictEqual(r.body.inputs.score.score, null);
  });

  test("the score that is used is reported, so nobody has to guess which one it was", async () => {
    const r = await post({ action: "evaluate", client_id: CLIENT });
    assert.equal(r.body.inputs.score.known, true);
    assert.equal(r.body.inputs.score.score, 640);
    assert.equal(r.body.inputs.score.bureau, "Equifax");
  });

  test("the as-of date is the OLDEST card's, because a picture is as stale as its stalest part", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      {
        tradelines: [
          TRADELINE({ as_of: "2026-07-01T00:00:00.000Z" }),
          TRADELINE({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", as_of: "2026-06-15T00:00:00.000Z" })
        ]
      }
    );
    assert.equal(r.body.as_of, "2026-06-15T00:00:00.000Z");
  });

  test("one undated card makes the whole picture undated rather than dating it now", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT },
      { tradelines: [TRADELINE(), TRADELINE({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", as_of: null })] }
    );
    assert.strictEqual(r.body.as_of, null);
    assert.equal(r.body.inputs.tradelines, 2);
    assert.equal(r.body.inputs.tradelines_dated, 1);
  });

  test("closed cards are still read, so the count of what was excluded is honest", async () => {
    const r = await post({ action: "evaluate", client_id: CLIENT });
    const read = r.reads.find((x) => x.kind === "tradelines");
    assert.ok(read.params.includes(true), "closed lines were filtered out in SQL, hiding the basis");
  });
});

/* ── the dry run ───────────────────────────────────────────────────────────── */

describe("POST evaluate with dry_run — the preview must not write", () => {

  /* THE POINT OF THIS SUITE IS THE HANDLE THE PREVIEW CANNOT PIN.
     The stub replaces `db.query`, but a preview does not go through `db.query` —
     it asks src/db.mjs for a real pooled connection so it can BEGIN and then
     throw the work away. DATABASE_URL is removed for these two tests so that
     request FAILS, which is the case that matters: the handler must refuse
     rather than fall back to running the evaluator on the shared `{ query }`
     handle with autocommit, which is audit M7's trap and would write real
     alerts under a button that says nothing will be written.

     The other half — that the rollback actually happens when a connection IS
     available — is proved against live Postgres in finance-alerts.pg.test.mjs,
     because whether a transaction rolls back is a property of the database and
     not of anything this file can fake. */
  let savedUrl;
  before(() => { savedUrl = process.env.DATABASE_URL; delete process.env.DATABASE_URL; });
  after(() => { if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl; });

  test("with no transaction available it REFUSES, and writes nothing", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT, dry_run: true },
      { triggers: [TRIGGER({ enabled: true, threshold_bps: 3000 })] }
    );
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "dry_run_unavailable");
    assert.ok(!r.reads.some((x) => x.kind === "insertAlert"),
      "the preview fell back to running unpinned and WROTE ALERTS — audit M7's trap");
    assert.match(r.body.message, /transaction/);
  });

  test("only a literal true is a dry run, so a typo cannot silently skip a real run", async () => {
    const r = await post(
      { action: "evaluate", client_id: CLIENT, dry_run: "yes" },
      { triggers: [TRIGGER({ enabled: true, threshold_bps: 3000 })] }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.dry_run, false);
    assert.equal(r.body.wrote, true);
  });
});

/* ── moving an alert along ─────────────────────────────────────────────────── */

describe("POST acknowledge / resolve / dismiss", () => {

  test("acknowledging stamps the moment and the person", async () => {
    const before = Date.now();
    const r = await post({ action: "acknowledge", alert_id: ALERT });
    assert.equal(r.status, 200);
    assert.equal(r.body.changed, true);
    const write = r.reads.find((x) => x.kind === "updateAlert");
    const at = Date.parse(write.params[0]);
    assert.ok(at >= before && at <= Date.now() + 1000, "the acknowledgement was not stamped now");
    assert.equal(write.params[1], STAFF, "the acknowledgement did not record who did it");
    assert.ok(write.params.includes(ORG_A));
  });

  test("a second acknowledgement is a true answer, not a failure", async () => {
    const r = await post(
      { action: "acknowledge", alert_id: ALERT },
      { updated: [], found: [ALERT_ROW({ state: "acknowledged", acknowledged_at: "2026-07-21T08:00:00.000Z" })] }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.changed, false);
    assert.equal(r.body.reason, "already_acknowledged");
  });

  test("an alert that is not in this org is a 404, not a silent no-op", async () => {
    const r = await post(
      { action: "resolve", alert_id: ALERT },
      { updated: [], found: [] }
    );
    assert.equal(r.status, 404);
  });

  test("dismissing without a reason records the absence rather than inventing one", async () => {
    const r = await post(
      { action: "dismiss", alert_id: ALERT },
      { updated: [ALERT_ROW({ state: "dismissed" })] }
    );
    assert.equal(r.status, 200);
    const write = r.reads.find((x) => x.kind === "updateAlert");
    assert.strictEqual(write.params[0], null);
  });

  test("an alert_id that is not a uuid is a 400 before any write", async () => {
    const r = await post({ action: "acknowledge", alert_id: "nope" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, []);
  });
});
