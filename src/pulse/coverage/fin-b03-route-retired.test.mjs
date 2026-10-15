// Batch 03 (finish the 853): closer-deck send_ebook is a route row for an action the owner switched off.
//
// This file is the wiring and the practice test. The SQL and the judge are exercised on a real SQL engine in
// fin-b03-route-retired.sql.test.mjs, and on Postgres in fin-b03-route-retired.pg.test.mjs.
//
//   1. PRACTICE TEST (fake data): the real api/closer-deck.mjs refuses send_ebook for every role that may use
//      the deck, and mints, queues and saves nothing.
//   2. WIRING (what the pulse runs): the route lane hands the retired row to the check, the "nothing to judge"
//      claim is the closed code the morning audit re-checks, and every other route row is still not proved.
//
// No network. The database here is the SQL engine from the kit: read only, every statement a SELECT.
import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../api/closer-deck.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../testing/handler-harness.mjs";
import { naProblem, verifyNa } from "../na-conditions.mjs";
import { makeLaneNaVerify } from "../self-audit.mjs";
import { ROUTE_GAP_ROWS, gapChecks, naVerify } from "./gap-door-batch-routes.mjs";
import {
  AFTER, LANE_ORG, LONG_AGO, OTHER_ORG, email, link, marker, plainClient, scratch,
} from "./fin-b03-route-retired-kit.mjs";
import {
  RETIRED_ROUTE_ACTIONS,
  RETIRED_ROUTE_CODE,
  retiredRouteEntry,
} from "./fin-b03-route-retired.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const ROW = ROUTE_GAP_ROWS.find((candidate) => retiredRouteEntry(candidate));
const ENTRY = retiredRouteEntry(ROW);
const CODE_ARGS = { sourceFile: ENTRY.sourceFile, surface: ENTRY.surface, control: ENTRY.control, action: ENTRY.action };

async function laneRow(db, ctx = {}) {
  const rows = await gapChecks({ db, orgId: LANE_ORG, ...ctx });
  return rows.find((row) => row.id === ROW.id);
}

/* ---- the binding ---- */

test("exactly one route row names the retired action, and it is closer-deck send_ebook", () => {
  assert.equal(RETIRED_ROUTE_ACTIONS.length, 1);
  assert.equal(ROUTE_GAP_ROWS.filter((row) => retiredRouteEntry(row)).length, 1);
  assert.equal(ROW.route, "closer-deck");
  assert.equal(ROW.sourceFile, "routes-1.json");
  assert.match(ROW.control, /^POST action=send_ebook /);
  assert.equal(ROW.impact, "money");
  assert.equal(ROUTES["closer-deck"], handler);
});

/* ---- 1. practice test: the real handler ---- */

test("the real closer-deck handler refuses send_ebook for every role that may use the deck, and does nothing", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error(`a live request was attempted: ${url}`); };
  try {
    for (const role of ["closer", "sales_manager", "owner", "admin"]) {
      const fake = fakeDb([
        staffSession({ role }),
        [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
      ]);
      const res = makeRes();
      const body = { action: "send_ebook", client_id: CLIENT_ID, amount_cents: 2700, description: "Fundhub e-book" };
      await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
      assert.equal(res.statusCode, 400, role);
      assert.equal(res.body.error, "unknown_action", role);
      assert.doesNotMatch(String(res.body.message), /e-?book/i, `${role}: the refusal still lists the retired action`);
      assert.equal(fake.find(/INSERT INTO (payment_links|messages|conversations)/).length, 0, `${role}: a link or message was made`);
      assert.equal(fake.find(/UPDATE (clients|payment_links)/).length, 0, `${role}: a row was changed`);
      assert.equal(fake.find(/closer_deck_ebook/).length, 0, `${role}: the send marker was written`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a served action on the same stand-in is not refused as unknown, so the refusal above is the action's", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error(`a live request was attempted: ${url}`); };
  try {
    const fake = fakeDb([
      staffSession({ role: "closer" }),
      [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
    ]);
    const res = makeRes();
    await runWithSharedDb(fake, () => handler(req("POST", { body: { action: "send_soft_pull", client_id: CLIENT_ID } }), res));
    assert.notEqual(res.body?.error, "unknown_action");
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ---- 2. wiring: the route lane ---- */

test("the lane gives the retired row nothing-to-judge while no send was saved, with the closed reason", async () => {
  const row = await laneRow(scratch({ clients: [plainClient(), plainClient(OTHER_ORG)] }));
  assert.equal(row.status, "na");
  assert.deepEqual(row.na, { code: RETIRED_ROUTE_CODE, args: CODE_ARGS });
  assert.equal(naProblem(row.na), null);
  assert.ok(row.detail.includes(ROW.surface) && row.detail.includes(ROW.control));
});

test("the lane turns the retired row red on the first send saved after the cutoff, from any of the three traces", async () => {
  for (const rows of [{ clients: [marker(AFTER)] }, { links: [link(AFTER)] }, { messages: [email(AFTER)] }]) {
    const row = await laneRow(scratch(rows));
    assert.equal(row.status, "FAIL", JSON.stringify(Object.keys(rows)));
    assert.equal(row.id, ROW.id);
    assert.equal(row.na, undefined);
  }
});

test("the lane says skip, never green, when the run has no database or the read fails", async () => {
  const none = (await gapChecks({})).find((row) => row.id === ROW.id);
  assert.equal(none.status, "skip");
  assert.match(none.detail, /no database in this run/);
  const broken = await laneRow({ query: async () => { throw new Error("connection refused"); } });
  assert.equal(broken.status, "skip");
  assert.match(broken.detail, /connection refused/);
});

test("the lane uses the staff scope when the run has one", async () => {
  const table = scratch({ clients: [marker(AFTER)] });
  let scoped = 0;
  const scope = async (fn) => { scoped += 1; return fn(table); };
  const row = await laneRow(null, { scope });
  assert.equal(scoped, 1);
  assert.equal(row.status, "FAIL");
});

test("every other route row is still not proved", async () => {
  const rows = await gapChecks({ db: scratch(), orgId: LANE_ORG });
  assert.equal(rows.length, ROUTE_GAP_ROWS.length);
  const others = rows.filter((row) => row.id !== ROW.id);
  assert.equal(others.length, ROUTE_GAP_ROWS.length - 1);
  assert.ok(others.every((row) => row.status === "NOT_PROVED"));
});

/* ---- the "nothing to judge" proof is checked again by the lane ---- */

test("the lane's naVerify holds only while no send was saved after the cutoff", async () => {
  const verify = naVerify[RETIRED_ROUTE_CODE];
  assert.equal(await verify(CODE_ARGS, { db: scratch({ clients: [marker(LONG_AGO)] }), orgId: LANE_ORG }), true);
  for (const rows of [{ clients: [marker(AFTER)] }, { links: [link(AFTER)] }, { messages: [email(AFTER)] }, { clients: [marker("yesterday")] }]) {
    assert.equal(await verify(CODE_ARGS, { db: scratch(rows), orgId: LANE_ORG }), false, JSON.stringify(Object.keys(rows)));
  }
  assert.equal(await verify(CODE_ARGS, {}), false, "no database: cannot tell, so not true");
  assert.equal(await verify(CODE_ARGS, { db: { query: async () => { throw new Error("down"); } } }), false);
});

test("the proof cannot name another action, control, map or route", async () => {
  const verify = naVerify[RETIRED_ROUTE_CODE];
  const ctx = { db: scratch(), orgId: LANE_ORG };
  assert.equal(await verify(CODE_ARGS, ctx), true);
  for (const change of [{ action: "send_pay_link" }, { control: "POST action=send_pay_link" }, { sourceFile: "routes-2.json" }, { surface: "route:payment-links" }]) {
    assert.equal(await verify({ ...CODE_ARGS, ...change }, ctx), false, JSON.stringify(change));
  }
  for (const bad of [{}, { ...CODE_ARGS, sourceFile: "public-pages.json" }, { ...CODE_ARGS, surface: "partner/autopsy" }, { ...CODE_ARGS, action: "" }, { ...CODE_ARGS, control: "" }]) {
    assert.notEqual(naProblem({ code: RETIRED_ROUTE_CODE, args: bad }), null, JSON.stringify(bad));
  }
});

test("the morning audit finds the lane by the id the pulse gives the row, and re-checks the claim", async () => {
  const pulseRow = (rowId) => ({ id: `gap-door-batch-routes:${rowId}`, na: { code: RETIRED_ROUTE_CODE, args: CODE_ARGS } });
  const clean = makeLaneNaVerify({ db: scratch({ clients: [marker(LONG_AGO)] }) });
  const held = await verifyNa(pulseRow(ROW.id), { laneNaVerify: clean });
  assert.equal(held.ok, true, held.reason);
  assert.match(held.reason, /No send_ebook send was saved since it went off\./);

  for (const rows of [{ clients: [marker(AFTER)] }, { links: [link(AFTER)] }, { messages: [email(AFTER)] }]) {
    const dirty = makeLaneNaVerify({ db: scratch(rows) });
    const broken = await verifyNa(pulseRow(ROW.id), { laneNaVerify: dirty });
    assert.equal(broken.ok, false);
  }
});
