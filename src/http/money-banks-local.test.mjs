// GET /api/money/banks — local banks (Finance OS wave 4, unit LOC). The same
// gate as every bank read; the read gains `local_banks` and the merged
// `deposit_plan`, and ?view=local_banks sends only those two. Stubbed principal
// and store; the local-bank step runs for real on a stub database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/banks.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "a0000000-0000-4000-8000-000000000001";
const CHASE_ID = "a0000000-0000-4000-8000-0000000000a1";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "5aff0000-0000-4000-8000-000000000001", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

/* A database with one Phoenix client: a home ZIP on the identity row and one business. */
function phoenixDb({ fail = false } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (fail && /pii_identity|FROM businesses/.test(sql)) throw new Error("db down");
      if (/FROM clients/.test(sql) && /SELECT 1|\?column\?/.test(sql)) return { rows: [{ "?column?": 1 }] };
      if (/pii_identity/.test(sql)) return { rows: params[1] === MINE ? [{ zip: "85004", city: "Phoenix", state: "AZ" }] : [] };
      if (/FROM businesses/.test(sql)) return { rows: params[1] === MINE ? [{ id: "b1", name: "Cedar Grove LLC", zip: "85281", city: "Tempe", state: "AZ" }] : [] };
      if (/FROM plaid_institutions/.test(sql)) return { rows: [] };
      if (/FROM lenders/.test(sql)) return { rows: [{ id: CHASE_ID, name_key: "chase", logo_path: "/assets/lenders/chase.png" }] };
      return { rows: [] };
    }
  };
}

const chase = {
  lender_id: CHASE_ID, name: "Chase", kind: "bank", products: ["Business credit card (apply in a branch)"], lender_table: "InBranchBizCC",
  minimum_deposit_cents: 500000, seasoning_days: 30, logo: { src: "/assets/lenders/chase.png", alt: "Chase logo" }, why: [], relationship_steps: [],
  source: { label: "Bank book · Chase", ref: "lenders.external_row_id · row" }
};
const read = (calls) => async (_db, args) => {
  calls.push(args);
  return {
    ok: true, client: { id: args.clientId, name: "Alex Sample" }, as_of: "2026-11-07T12:00:00.000Z",
    recommended_banks: [chase], banks_left_out: [], card_stacking: { items: [] }, relationships: [],
    deposit_plan: [{ lender_id: CHASE_ID, name: "Chase", status: "planned" }], next_sequence: { suggestion: null }
  };
};
const NOW = () => new Date("2026-11-07T12:00:00Z");

async function call(req, principal, { db = phoenixDb(), over = {} } = {}) {
  const res = makeRes();
  const calls = [];
  await handler(req, res, { db, requirePrincipal: gateAs(principal), now: NOW, bankStrategy: read(calls), ...over });
  return { res, calls, db };
}

describe("GET /api/money/banks — local banks", () => {
  test("?view=local_banks sends only the local banks and the merged plan, for the client's own file", async () => {
    const { res, calls, db } = await call({ method: "GET", query: { view: "local_banks", client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].clientId, MINE, "a client is pinned to their own file");
    assert.deepEqual(Object.keys(res.body).sort(), ["as_of", "client", "deposit_plan", "local_banks", "ok"]);
    assert.equal(res.body.local_banks.status, "ready");
    assert.deepEqual(res.body.local_banks.places.map((p) => p.label), ["Home", "Cedar Grove LLC"]);
    assert.equal(res.body.deposit_plan[0].name, "Chase");
    assert.equal(res.body.deposit_plan[0].on_list, true);
    assert.ok(res.body.deposit_plan.length > 1 && res.body.deposit_plan.length <= 5);
    assert.ok(res.body.deposit_plan.slice(1).every((r) => r.local), "the open places go to local finds near Phoenix");
    for (const q of db.seen.filter((x) => /pii_identity|FROM businesses/.test(x.sql))) {
      assert.deepEqual(q.params, [ORG, MINE], "org and client on every address read");
      assert.doesNotMatch(q.sql, /ssn|address_line1|addressLine1/i);
    }
  });

  test("the full read carries local_banks too; the logo step runs first and the merged plan keeps its own logos", async () => {
    let logoCall = null;
    const { res } = await call({ method: "GET", query: { client_id: MINE } }, staffP("admin"), {
      over: { attachBankLogos: async (_db, args) => {
        logoCall = args;
        return { ...args.payload, logos_done: true,
          deposit_plan: args.payload.deposit_plan.map((p) => ({ ...p, logo: "/assets/lenders/wrong.png" })) };
      } }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.logos_done, true);
    assert.equal(logoCall.payload.local_banks, undefined, "the logo step sees the bank read alone");
    assert.equal(res.body.local_banks.status, "ready");
    assert.ok(Array.isArray(res.body.recommended_banks), "the rest of the read is unchanged");
    assert.equal(res.body.deposit_plan[0].name, "Chase");
    assert.equal(res.body.deposit_plan[0].logo, "/assets/lenders/chase.png", "the plan's own lookup: by lender id in the bank book");
    assert.ok(!res.body.deposit_plan.some((r) => r.logo === "/assets/lenders/wrong.png"));
  });

  test("an unknown view is refused before anything is read", async () => {
    const { res, calls } = await call({ method: "GET", query: { view: "everything" } }, clientP());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_view");
    assert.equal(calls.length, 0);
  });

  test("when the address reads fail, the page still loads with the read's own plan", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const { res } = await call({ method: "GET", query: { view: "local_banks" } }, clientP(), { db: phoenixDb({ fail: true }) });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.local_banks.status, "unavailable");
      assert.deepEqual(res.body.deposit_plan.map((r) => [r.lender_id, r.name, r.status]), [[CHASE_ID, "Chase", "planned"]],
        "the bank read's own plan, as the logo step left it");
    } finally {
      console.error = quiet;
    }
  });

  test("a client with no address on file is asked for one; the plan stays the bank read's own", async () => {
    const { res } = await call({ method: "GET", query: { view: "local_banks" } }, clientP(OTHER));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.local_banks.status, "needs_address");
    assert.deepEqual(res.body.deposit_plan.map((r) => [r.lender_id, r.name, r.status]), [[CHASE_ID, "Chase", "planned"]]);
    assert.equal(res.body.deposit_plan[0].logo, "/assets/lenders/chase.png", "the logo step still dressed it");
  });

  test("a client still cannot POST", async () => {
    const { res } = await call({ method: "POST", body: JSON.stringify({ action: "plan_bank", bank: "Desert Financial" }) }, clientP());
    assert.equal(res.statusCode, 403);
  });
});
