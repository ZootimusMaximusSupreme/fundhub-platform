// GET /api/read/partner-home-tiles — the payload, not the plumbing.
//
// The gate (requirePrincipal, withPartnerScope, staff must name a ?partner_id=)
// is partnerReadHandler's and is tested with the rest of the partner read APIs.
// What is tested here is what this endpoint decides for itself: the day window,
// and the one rule the task depends on getting right — a tile may show a real
// zero, but it may never show a zero, or divide by one, in place of "not known".
//
// It lives under src/ because npm test's glob is src/** and scripts/** only — a
// test under api/ silently never runs (CLAUDE.md §12). No database: fetchRows
// is exercised against a stubbed tx, the same technique
// src/http/partner-production-read.test.mjs uses for its sibling endpoint. The
// real SQL — column names, the v_partner_spend_vs_ceiling join, the RLS scope —
// is proved separately in partner-home-tiles.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  fetchRows, utcDayWindow, costPerFundedClientCents
} from "../../api/read/partner-home-tiles.mjs";
import handler from "../../api/read/partner-home-tiles.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { FUNDING_DEPOSIT_PRODUCT_CODE } from "../partners/floors.mjs";
import {
  accountSession, fakeDb, makeRes, req, runWithSharedDb
} from "../testing/handler-harness.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const PRINCIPAL = { kind: "partner", partnerId: PARTNER, orgId: ORG };

function stubTx(script) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) return typeof reply === "function" ? reply(params) : reply;
      }
      throw new Error(`stubTx: no scripted reply for: ${sql.slice(0, 90)}`);
    }
  };
}

const partnerRow = { rows: [{ id: PARTNER, org_id: ORG }] };

async function callHandler(rules) {
  const database = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(database, () => handler(req("GET"), res));
  return { database, res };
}

describe("the route exists", () => {
  test("a handler file is not a route — this one is in the ROUTES map", () => {
    assert.equal(typeof ROUTES["read/partner-home-tiles"], "function");
  });
});

describe("the real GET handler", () => {
  test("returns the exact three sourced money results for the signed-in partner", async () => {
    const { res } = await callHandler([
      ...accountSession({ kind: "partner", partnerId: PARTNER, orgId: ORG }),
      [/FROM partners WHERE id = \$1/, partnerRow],
      [/FROM partner_revenue/, { rows: [{ cash_today: "5250.00", cash_yesterday: "1000.00" }] }],
      [/FROM v_partner_spend_vs_ceiling/, { rows: [{ spend_today_cents: "4321" }] }],
      [/WITH surviving/, { rows: [{ funding_clients: 2 }] }],
    ]);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.partner_id, PARTNER);
    assert.equal(res.body.cash_collected_today_cents, 525000);
    assert.equal(res.body.cash_collected_yesterday_cents, 100000);
    assert.equal(res.body.funded_today, 2);
    assert.equal(res.body.funded_yesterday, 2);
    assert.equal(res.body.ad_spend_today_cents, 4321);
    assert.equal(res.body.cost_per_funded_client_cents, 2161);
  });

  test("returns not found instead of money tiles when the partner is outside the signed-in company", async () => {
    const { database, res } = await callHandler([
      ...accountSession({ kind: "partner", partnerId: PARTNER, orgId: ORG }),
      [/FROM partners WHERE id = \$1/, { rows: [] }],
    ]);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { ok: false, error: "not_found" });
    assert.equal(database.find(/FROM partner_revenue/).length, 0);
  });
});

describe("utcDayWindow", () => {
  test("is a UTC calendar day, half-open, exactly 24h wide", () => {
    const { start, end } = utcDayWindow(new Date("2026-08-31T23:59:59.999Z"));
    assert.equal(start.toISOString(), "2026-08-31T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(end.getTime() - start.getTime(), 86_400_000);
  });

  test("a moment just after midnight UTC stays in the SAME day", () => {
    const { start } = utcDayWindow(new Date("2026-08-31T00:00:00.001Z"));
    assert.equal(start.toISOString(), "2026-08-31T00:00:00.000Z");
  });
});

describe("costPerFundedClientCents — never a zero, never a divide-by-zero", () => {
  test("both sides known and positive -> the real ratio, rounded", () => {
    assert.equal(costPerFundedClientCents(10000, 3), 3333); // 100.00 / 3 clients
  });

  test("ad spend unknown (null) -> null, whatever funded_today is", () => {
    assert.equal(costPerFundedClientCents(null, 5), null);
    assert.equal(costPerFundedClientCents(undefined, 5), null);
  });

  test("zero funded clients -> null, NEVER a divide-by-zero and never $0", () => {
    assert.equal(costPerFundedClientCents(50000, 0), null);
  });

  test("a real zero ad spend with a real funded count -> a real $0, not null", () => {
    // Distinct from the cases above: a ceiling row exists and reports 0 spent —
    // that is a known answer, and the ratio is honestly 0.
    assert.equal(costPerFundedClientCents(0, 4), 0);
  });

  test("negative or non-finite funded_today is treated as unknown, not divided", () => {
    assert.equal(costPerFundedClientCents(10000, -1), null);
    assert.equal(costPerFundedClientCents(10000, NaN), null);
  });
});

describe("fetchRows", () => {
  test("carries the three sourced tiles plus real yesterday comparisons, wired to the shared window", async () => {
    // Two funding-client calls happen — today's window and yesterday's — and
    // both run the identical shared SQL, so they are told apart here by call
    // order rather than by parsing the date params back out.
    const fundingReplies = [{ rows: [{ funding_clients: 3 }] }, { rows: [{ funding_clients: 1 }] }];
    let fundingCallN = 0;
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow],
      ["FROM partner_revenue", { rows: [{ cash_today: "5250.00", cash_yesterday: "1000.00" }] }],
      ["FROM v_partner_spend_vs_ceiling", { rows: [{ spend_today_cents: "4321" }] }],
      ["WITH surviving", () => fundingReplies[fundingCallN++]]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL });
    assert.equal(row.partner_id, PARTNER);
    assert.equal(row.cash_collected_today_cents, 525000);
    assert.equal(row.cash_collected_yesterday_cents, 100000);
    assert.equal(row.funded_today, 3);
    assert.equal(row.funded_yesterday, 1);
    assert.equal(row.ad_spend_today_cents, 4321);
    assert.equal(row.cost_per_funded_client_cents, 1440); // round(4321/3)
    assert.ok(row.window_start < row.window_end);

    // Reuses the SAME funding-client definition the production floor counts
    // with, twice (today, yesterday) — never a second, hand-written copy of
    // the rule.
    const surviving = tx.calls.filter((c) => c.sql.includes("WITH surviving"));
    assert.equal(surviving.length, 2, "expected exactly two funding-client counts: today and yesterday");
    for (const call of surviving) assert.equal(call.params[2], FUNDING_DEPOSIT_PRODUCT_CODE);
    // The two windows are contiguous and non-overlapping: yesterday's end is
    // exactly today's start.
    assert.equal(surviving[1].params[4].getTime(), surviving[0].params[3].getTime());
  });

  test("no accrual rows today is a real zero, not unknown", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow],
      ["FROM partner_revenue", { rows: [{ cash_today: "0" }] }],
      ["FROM v_partner_spend_vs_ceiling", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL });
    assert.equal(row.cash_collected_today_cents, 0);
    assert.equal(row.funded_today, 0);
  });

  test("no partner-scope spend ceiling -> ad spend AND the ratio are null, never $0", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow],
      ["FROM partner_revenue", { rows: [{ cash_today: "0" }] }],
      ["FROM v_partner_spend_vs_ceiling", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 7 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL });
    assert.equal(row.ad_spend_today_cents, null);
    assert.equal(row.cost_per_funded_client_cents, null);
  });

  test("a spend ceiling reporting 0 spent today is known — the ratio is a real $0", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow],
      ["FROM partner_revenue", { rows: [{ cash_today: "0" }] }],
      ["FROM v_partner_spend_vs_ceiling", { rows: [{ spend_today_cents: "0" }] }],
      ["WITH surviving", { rows: [{ funding_clients: 2 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL });
    assert.equal(row.ad_spend_today_cents, 0);
    assert.equal(row.cost_per_funded_client_cents, 0);
  });

  test("the org comes from the session, never the query string", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", (params) => {
        assert.equal(params[1], ORG, "org filter did not come from principal.orgId");
        return partnerRow;
      }],
      ["FROM partner_revenue", { rows: [{ cash_today: "0" }] }],
      ["FROM v_partner_spend_vs_ceiling", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }]
    ]);
    // A different org_id smuggled into query is never read by fetchRows —
    // there is no query.org_id anywhere in the implementation to smuggle it
    // through, and this asserts the partner lookup used principal.orgId.
    await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL, query: { org_id: "not-the-org" } });
  });

  test("a partner id that does not resolve under this org returns no rows", async () => {
    const tx = stubTx([["FROM partners WHERE id = $1", { rows: [] }]]);
    const rows = await fetchRows(tx, { partnerId: PARTNER, principal: PRINCIPAL });
    assert.deepEqual(rows, []);
  });
});
