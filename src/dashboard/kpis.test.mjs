import { test } from "node:test";
import assert from "node:assert";
import { computeKpis, daysForPeriod, formatCents, formatRate } from "./kpis.mjs";

test("daysForPeriod: known windows", () => {
  assert.equal(daysForPeriod("today"), 1);
  assert.equal(daysForPeriod("7d"), 7);
  assert.equal(daysForPeriod("30d"), 30);
  assert.ok(daysForPeriod("qtd") >= 1);
  assert.equal(daysForPeriod("unknown"), 7);
});

test("formatCents: null is em dash, not zero", () => {
  assert.equal(formatCents(null), "—");
  assert.equal(formatCents(0), "$0");
  assert.equal(formatCents(3200), "$32");
  assert.equal(formatCents(19840000), "$198k");
});

test("formatCents: cents are always two digits", () => {
  assert.equal(formatCents(60650), "$606.50");
  assert.equal(formatCents(60653), "$606.53");
  assert.equal(formatCents(60600), "$606");
});

test("computeKpis new clients leaves out demo rows and test addresses", async () => {
  const sqls = [];
  const db = { query: async (sql) => { sqls.push(String(sql)); return { rows: [{ cents: 0, n: 0 }] }; } };
  await computeKpis(db, { orgId: "00000000-0000-4000-8000-000000000001", period: "7d" });
  const clientsSql = sqls.find((s) => /FROM clients c/.test(s));
  assert.ok(clientsSql, "the new-clients query was not sent");
  assert.match(clientsSql, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(clientsSql, /'fundhub\.ai', 'example\.com', 'example\.net', 'example\.org'/);
  assert.match(clientsSql, /\(e2e\|sim\|test\)/);
});

test("formatRate: null is em dash", () => {
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(0.5), "50%");
  assert.equal(formatRate(0), "0%");
});

test("computeKpis counts funded rounds, not clients.funded", async () => {
  const sqls = [];
  const db = {
    query: async (sql) => {
      sqls.push(String(sql));
      return { rows: [{ cents: 0, n: 0 }] };
    }
  };
  const out = await computeKpis(db, { orgId: "00000000-0000-4000-8000-000000000001", period: "7d" });
  const fundedSql = sqls.find((s) => /status = 'funded'/.test(s) || /funded IS TRUE/.test(s));
  assert.match(fundedSql, /FROM funding_rounds/);
  assert.doesNotMatch(fundedSql, /FROM clients/);
  assert.match(fundedSql, /SUM\(funded_amount\)/);
  assert.doesNotMatch(fundedSql, /::bigint AS cents/);
  assert.equal(out.funded_count, 0);
});

test("computeKpis treats funding_rounds.funded_amount as dollars", async () => {
  const db = {
    query: async (sql) => {
      if (/SUM\(funded_amount\)/.test(String(sql))) {
        return { rows: [{ n: 2, dollars: 50000 }] };
      }
      return { rows: [{ cents: 0, n: 0 }] };
    }
  };
  const out = await computeKpis(db, { orgId: "00000000-0000-4000-8000-000000000001", period: "7d" });
  assert.equal(out.funded_count, 2);
  assert.equal(out.funded_amount_cents, 5_000_000);
  assert.equal(formatCents(out.funded_amount_cents), "$50k");
});

test("computeKpis treats transactions.amount_paid as dollars", async () => {
  const sqls = [];
  const db = {
    query: async (sql) => {
      sqls.push(String(sql));
      // node-postgres returns numeric columns as strings — test that shape.
      if (/SUM\(amount_paid\)/.test(String(sql))) return { rows: [{ dollars: "3000.55" }] };
      return { rows: [{ cents: 0, n: 0 }] };
    }
  };
  const out = await computeKpis(db, { orgId: "00000000-0000-4000-8000-000000000001", period: "7d" });
  const cashSql = sqls.find((s) => /SUM\(amount_paid\)/.test(s));
  assert.match(cashSql, /FROM transactions/);
  assert.doesNotMatch(cashSql, /::bigint AS cents/);
  assert.equal(out.cash_collected_cents, 300055);
});

test("computeKpis keeps ad spend in cents — spend_cents is a real cents column", async () => {
  const db = {
    query: async (sql) => {
      if (/SUM\(spend_cents\)/.test(String(sql))) return { rows: [{ cents: "250000" }] };
      return { rows: [{ cents: 0, n: 0, dollars: 0 }] };
    }
  };
  const out = await computeKpis(db, { orgId: "00000000-0000-4000-8000-000000000001", period: "7d" });
  // No funded clients in the window, so cost-per-funded stays null with a reason.
  assert.equal(out.cost_per_funded_cents, null);
  assert.equal(out.cost_per_funded_reason, "no_funded_clients_in_window");
});
