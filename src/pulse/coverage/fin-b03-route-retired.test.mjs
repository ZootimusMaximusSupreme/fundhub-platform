// Batch 03 (finish the 853): closer-deck send_ebook is a route row for an action the owner switched off.
//
// Two halves, and the first is a practice test, not a live check:
//   1. PRACTICE TEST (fake data): the real api/closer-deck.mjs refuses send_ebook for every role that may use
//      the deck, and mints, queues and saves nothing.
//   2. LIVE CHECK (what the pulse runs): the lane reads the saved client files and says "na" while no e-book
//      send was saved since the first live ship without it, and FAIL on the first one. Here the read runs on a
//      stand-in table. The stand-in keeps a row only while the SQL TEXT carries that row's condition, so taking
//      a condition out of the SQL turns a test red (src/pulse/catalog/proofs/s1-proof-kit.mjs has the same idea).
//
// No database, no network. Every statement the lane sends must be a SELECT.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import handler from "../../../api/closer-deck.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";
import {
  ORG_ID, OTHER_ORG_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../testing/handler-harness.mjs";
import { naProblem, verifyNa } from "../na-conditions.mjs";
import { makeLaneNaVerify } from "../self-audit.mjs";
import { ROUTE_GAP_ROWS, gapChecks, naVerify } from "./gap-door-batch-routes.mjs";
import {
  RETIRED_ROUTE_ACTIONS,
  RETIRED_ROUTE_CODE,
  judgeRetiredRoute,
  retiredRouteEntry,
} from "./fin-b03-route-retired.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const ROW = ROUTE_GAP_ROWS.find((candidate) => retiredRouteEntry(candidate));
const ENTRY = retiredRouteEntry(ROW);
const CODE_ARGS = { sourceFile: ENTRY.sourceFile, surface: ENTRY.surface, control: ENTRY.control, action: ENTRY.action };

const LONG_AGO = "2026-09-01T18:00:00.000Z";
const JUST_BEFORE = "2026-10-12T16:35:59.999Z";
const AT_CUTOFF = "2026-10-12T16:36:00.000Z";
const AFTER = "2026-10-13T20:10:00.000Z";

/* A stand-in for `clients`. It answers like the SQL it is asked: a row stays only while the SQL text still
   carries that row's condition, and the "wrong" count follows the conditions the text still carries. */
function clientsTable(rows) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    let kept = rows;
    if (/\(\$1::uuid IS NULL OR c\.org_id = \$1::uuid\)/.test(sql)) {
      kept = kept.filter((row) => params[0] == null || row.org_id === params[0]);
    }
    if (/c\.custom_fields->>'closer_deck_ebook_sent_at' IS NOT NULL/.test(sql)) {
      kept = kept.filter((row) => row.custom_fields?.closer_deck_ebook_sent_at != null);
    }
    const carriesCutoff = /\(c\.custom_fields->>'closer_deck_ebook_sent_at'\) COLLATE "C" >= \$2::text/.test(sql);
    const carriesUndated = /NOT \(c\.custom_fields->>'closer_deck_ebook_sent_at' ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T'\)/.test(sql);
    const bad = kept.filter((row) => {
      const value = String(row.custom_fields?.closer_deck_ebook_sent_at);
      const dated = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(value);
      return (carriesUndated && !dated) || (carriesCutoff && value >= params[1]);
    });
    return { rows: [{ sample_count: kept.length, bad_count: bad.length }] };
  };
  return { calls, query };
}

const client = (sentAt, org = ORG_ID) => ({ org_id: org, custom_fields: { closer_deck_ebook_sent_at: sentAt } });
const plainClient = (org = ORG_ID) => ({ org_id: org, custom_fields: { closer_deck_soft_pull_sent_at: AFTER } });

async function laneRow(db, ctx = {}) {
  const rows = await gapChecks({ db, orgId: ORG_ID, ...ctx });
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

test("the cutoff is the first live ship that carried the retirement, as the ship log says", () => {
  const log = fs.readFileSync(new URL("../../../ops/ship-log.md", import.meta.url), "utf8");
  const line = log.split("\n").find((text) => text.includes("| bfd16774 |"));
  assert.ok(line, "the ship log has no bfd16774 line");
  const [, day, hour, minute] = /\| (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) \|/.exec(line);
  // Arizona has no daylight saving: UTC is seven hours ahead.
  const utc = new Date(`${day}T${hour}:${minute}:00Z`);
  utc.setUTCHours(utc.getUTCHours() + 7);
  assert.equal(utc.toISOString().slice(0, 19), ENTRY.liveSince);
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

/* ---- 2. the live check ---- */

test("no e-book send on any client file: nothing to judge, with the closed reason and exact arguments", async () => {
  const table = clientsTable([plainClient(), plainClient(OTHER_ORG_ID)]);
  const row = await laneRow(table);
  assert.equal(row.status, "na");
  assert.deepEqual(row.na, { code: RETIRED_ROUTE_CODE, args: CODE_ARGS });
  assert.equal(naProblem(row.na), null);
  assert.match(row.detail, /No send was ever saved/);
  assert.ok(row.detail.includes(ROW.surface) && row.detail.includes(ROW.control));
  assert.equal(row.suggestedFix, null);
});

test("sends saved before the cutoff are history: still nothing to judge, and the count is said", async () => {
  const row = await laneRow(clientsTable([client(LONG_AGO), client(JUST_BEFORE), plainClient()]));
  assert.equal(row.status, "na");
  assert.match(row.detail, /2 sends saved before it went off/);
});

test("a send saved at the cutoff, or after it, is a named FAIL with the count", async () => {
  for (const sentAt of [AT_CUTOFF, AFTER]) {
    const row = await laneRow(clientsTable([client(LONG_AGO), client(sentAt)]));
    assert.equal(row.status, "FAIL", sentAt);
    assert.equal(row.id, ROW.id);
    assert.match(row.detail, /1 client file show/);
    assert.match(row.detail, /closer deck sent an offer that was retired/);
    assert.match(row.suggestedFix, /closer_deck_ebook_sent_at/);
    assert.match(row.suggestedFix, /Chris fixes reds/);
    assert.equal(row.na, undefined);
  }
  const two = await laneRow(clientsTable([client(AFTER), client(AT_CUTOFF), client(LONG_AGO)]));
  assert.match(two.detail, /2 client files show/);
});

test("a send marker with no readable time cannot be shown to be old, so it is red", async () => {
  for (const unreadable of ["", "yesterday", "10/13/2026", 17]) {
    const row = await laneRow(clientsTable([client(unreadable)]));
    assert.equal(row.status, "FAIL", JSON.stringify(unreadable));
  }
});

test("another company's late send is not this company's, and every company is read when none is named", async () => {
  const table = clientsTable([client(AFTER, OTHER_ORG_ID), client(LONG_AGO)]);
  assert.equal((await laneRow(table, { orgId: ORG_ID })).status, "na");
  assert.equal((await laneRow(table, { orgId: OTHER_ORG_ID })).status, "FAIL");
  assert.equal((await laneRow(table, { orgId: null })).status, "FAIL");
});

test("the read is one SELECT with the company and the cutoff as parameters, and writes nothing", async () => {
  const table = clientsTable([client(AFTER)]);
  await laneRow(table);
  assert.equal(table.calls.length, 1);
  assert.match(table.calls[0].sql.trim(), /^SELECT /);
  assert.doesNotMatch(table.calls[0].sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|SET)\b/i);
  assert.deepEqual(table.calls[0].params, [ORG_ID, ENTRY.liveSince]);
});

test("a failed read is skip with the reason, and no database is skip; neither is green", async () => {
  const broken = await laneRow({ query: async () => { throw new Error("connection refused"); } });
  assert.equal(broken.status, "skip");
  assert.match(broken.detail, /connection refused/);
  const none = (await gapChecks({})).find((row) => row.id === ROW.id);
  assert.equal(none.status, "skip");
  assert.match(none.detail, /no database in this run/);
});

test("the staff scope is used when the run has one, and the lane never says PASS", async () => {
  const table = clientsTable([client(AFTER)]);
  let scoped = 0;
  const scope = async (fn) => { scoped += 1; return fn(table); };
  const row = await laneRow(null, { scope });
  assert.equal(scoped, 1);
  assert.equal(row.status, "FAIL");
  for (const rows of [[], [client(LONG_AGO)], [client(AFTER)]]) {
    const judged = await judgeRetiredRoute(ROW, ENTRY, { db: clientsTable(rows), orgId: ORG_ID });
    assert.ok(["na", "FAIL"].includes(judged.status), judged.status);
  }
});

test("every other route row is still not proved", async () => {
  const rows = await gapChecks({ db: clientsTable([]), orgId: ORG_ID });
  assert.equal(rows.length, ROUTE_GAP_ROWS.length);
  const others = rows.filter((row) => row.id !== ROW.id);
  assert.equal(others.length, ROUTE_GAP_ROWS.length - 1);
  assert.ok(others.every((row) => row.status === "NOT_PROVED"));
});

/* ---- the "nothing to judge" proof is checked again by the lane ---- */

test("the lane's naVerify holds only while no send was saved after the cutoff", async () => {
  const verify = naVerify[RETIRED_ROUTE_CODE];
  assert.equal(await verify(CODE_ARGS, { db: clientsTable([client(LONG_AGO)]), orgId: ORG_ID }), true);
  assert.equal(await verify(CODE_ARGS, { db: clientsTable([client(AFTER)]), orgId: ORG_ID }), false);
  assert.equal(await verify(CODE_ARGS, { db: clientsTable([client("yesterday")]), orgId: ORG_ID }), false);
  assert.equal(await verify(CODE_ARGS, {}), false, "no database: cannot tell, so not true");
  assert.equal(await verify(CODE_ARGS, { db: { query: async () => { throw new Error("down"); } } }), false);
});

test("the proof cannot name another action, control, map or route", async () => {
  const verify = naVerify[RETIRED_ROUTE_CODE];
  const ctx = { db: clientsTable([]), orgId: ORG_ID };
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
  const clean = makeLaneNaVerify({ db: clientsTable([client(LONG_AGO)]) });
  const held = await verifyNa(pulseRow(ROW.id), { laneNaVerify: clean });
  assert.equal(held.ok, true, held.reason);
  assert.match(held.reason, /No send_ebook send was saved since it went off\./);

  const dirty = makeLaneNaVerify({ db: clientsTable([client(AFTER)]) });
  const broken = await verifyNa(pulseRow(ROW.id), { laneNaVerify: dirty });
  assert.equal(broken.ok, false);
});
