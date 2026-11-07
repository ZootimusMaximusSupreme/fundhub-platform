// /api/blueprint/declines — the applications tracker on the same door (Finance
// OS wave 3, unit O). Stubbed principal, db and store; no network, no Postgres.
// The tracker's own rules are tested in src/finance/applications-tracker.test.mjs.
// What this proves: the GET carries view.tracker for the right file, a tracker
// failure never takes the page down, the three track_* actions are pinned to the
// session's own file for a client and to an in-org client for staff, a bad form
// is answered in words, and no new route was added.
import { test } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/blueprint/declines.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const APP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG = "0f0f0f0f-0000-4000-8000-000000000001";

const clientPrincipal = () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: MINE });
const staffPrincipal = (role = "csm") => ({ kind: "staff", role, orgId: ORG, staffId: "s1", name: "Dana", staff: { id: "s1", role, org_id: ORG, name: "Dana" } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

const TRACKER = { rows: [{ id: APP, source: "self", bank: "Chase", status: "approved", approved_cents: 1000000 }], counts: { total: 1, approved: 1 }, can_add: true };

function stubs(over = {}) {
  const calls = { read: [], trackerRead: [], add: [], update: [], addAccount: [], record: [] };
  const deps = {
    readDeclines: async (_db, args) => { calls.read.push(args); return { view: { eligible: false, can_paste: false, applications: [], declines: [] } }; },
    recordDecline: async (_db, args) => { calls.record.push(args); return { ok: false, error: "not_blueprint_buyer" }; },
    readApplicationsTracker: async (_db, args) => { calls.trackerRead.push(args); if (over.readThrows) throw over.readThrows; return TRACKER; },
    addTrackedApplication: async (_db, args) => { calls.add.push(args); return over.add || { ok: true, id: APP, account: { status: "added", account_id: "acct-1" } }; },
    updateTrackedApplication: async (_db, args) => { calls.update.push(args); return over.update || { ok: true, id: APP, account: { status: "not_needed" } }; },
    addAccountForApplication: async (_db, args) => { calls.addAccount.push(args); return over.addAccount || { ok: true, id: APP, account: { status: "added" } }; }
  };
  return { deps, calls };
}

const run = async ({ method = "GET", query = {}, body, principal, inOrg, over } = {}) => {
  const { deps, calls } = stubs(over);
  const res = makeRes();
  await handler({ method, query, body }, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: () => new Date("2026-11-07T18:00:00Z"), ...deps });
  return { res, calls };
};

const ADD = { action: "track_add", bank: "Chase", product: "Ink Business Cash", kind: "card", applied_on: "2026-10-01", status: "approved", approved_amount: "10000" };

test("GET: the tracker rides on the client's own view, read from the session's file, never the URL's", async () => {
  const { res, calls } = await run({ principal: clientPrincipal(), query: { client_id: OTHER }, inOrg: [MINE, OTHER] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.trackerRead[0], { orgId: ORG, clientId: MINE });
  assert.deepEqual(res.body.view.tracker, { ok: true, ...TRACKER });
  assert.equal(res.body.view.eligible, false, "the decline view is unchanged");
});

test("GET: when only the tracker fails, the page still loads and the card says it could not", async () => {
  const { res } = await run({ principal: clientPrincipal(), over: { readThrows: new Error("relation finance_applications does not exist") } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.view.tracker, { ok: false, error: "tracker_unavailable" });
});

test("track_add from a client: their own file, entered by the client, no Capital Blueprint needed", async () => {
  const { res, calls } = await run({ method: "POST", principal: clientPrincipal(), body: { ...ADD, client_id: OTHER }, inOrg: [MINE, OTHER] });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.add[0].clientId, MINE, "a client_id in the body is never read for a client");
  assert.deepEqual(calls.add[0].by, { kind: "client", id: null });
  assert.equal(calls.add[0].input.approved_cents, 1000000, "dollars become integer cents at the edge");
  assert.equal(calls.record.length, 0, "it never touches the decline store");
  assert.equal(res.body.account.status, "added");
  assert.deepEqual(res.body.tracker, { ok: true, ...TRACKER }, "answers with the fresh list so the card repaints from one shape");
});

test("track_add from staff: needs a client in their org, and records who entered it", async () => {
  const ok = await run({ method: "POST", principal: staffPrincipal(), body: { ...ADD, client_id: MINE } });
  assert.equal(ok.res.statusCode, 201);
  assert.deepEqual(ok.calls.add[0].by, { kind: "staff", id: "s1" });
  const missing = await run({ method: "POST", principal: staffPrincipal(), body: ADD });
  assert.equal(missing.res.statusCode, 400);
  const elsewhere = await run({ method: "POST", principal: staffPrincipal(), body: { ...ADD, client_id: OTHER }, inOrg: [MINE] });
  assert.notEqual(elsewhere.res.statusCode, 201);
  assert.equal(elsewhere.calls.add.length, 0);
});

test("a bad form is answered in words and nothing is saved", async () => {
  const { res, calls } = await run({ method: "POST", principal: clientPrincipal(), body: { ...ADD, status: "applied" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "amount_only_on_approval");
  assert.match(res.body.message, /only goes with an approval/);
  assert.equal(calls.add.length, 0);
  const future = await run({ method: "POST", principal: clientPrincipal(), body: { ...ADD, applied_on: "2026-12-01" } });
  assert.equal(future.res.body.error, "invalid_applied_on");
});

test("track_update and track_add_account: pinned to the client's own file; not found is 404, not a card is 409", async () => {
  const upd = await run({ method: "POST", principal: clientPrincipal(), body: { action: "track_update", id: APP, status: "denied" } });
  assert.equal(upd.res.statusCode, 200);
  assert.deepEqual([upd.calls.update[0].clientId, upd.calls.update[0].id], [MINE, APP]);
  const gone = await run({ method: "POST", principal: clientPrincipal(), body: { action: "track_update", id: APP, status: "denied" }, over: { update: { ok: false, error: "not_found" } } });
  assert.equal(gone.res.statusCode, 404);
  const add = await run({ method: "POST", principal: clientPrincipal(), body: { action: "track_add_account", source: "fundhub", id: APP } });
  assert.equal(add.res.statusCode, 200);
  assert.deepEqual([add.calls.addAccount[0].source, add.calls.addAccount[0].clientId], ["fundhub", MINE]);
  const loan = await run({ method: "POST", principal: clientPrincipal(), body: { action: "track_add_account", source: "self", id: APP }, over: { addAccount: { ok: false, error: "not_an_approved_card" } } });
  assert.equal(loan.res.statusCode, 409);
});

test("no new route: the tracker lives on the existing /api/blueprint/declines door", () => {
  assert.ok(ROUTES["blueprint/declines"] || Object.keys(ROUTES).some((k) => /blueprint\/declines/.test(k)));
  assert.ok(!Object.keys(ROUTES).some((k) => /applications-tracker|finance\/applications/.test(k)));
});
