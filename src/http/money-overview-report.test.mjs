// GET /api/money/overview?report=monthly — the monthly report PDF rides the
// overview's own gate (no new route). Stubbed principal, db and report module;
// the report itself is tested in src/finance/monthly-report.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/overview.mjs";
import * as realReport from "../../src/finance/monthly-report.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, bytes: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
    end(b) { this.bytes = b; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "org-1";
const NOW = () => new Date("2026-11-07T15:00:00Z");

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

/* The real month rules and PDF drawing; only the database read is stubbed. */
function reportModule({ built = "sample", throws = null } = {}) {
  const calls = [];
  return {
    calls,
    mod: {
      ...realReport,
      monthlyReport: async (_db, args) => {
        calls.push(args);
        if (throws) throw throws;
        if (built === null) return null;
        return realReport.buildMonthlyReport({ month: args.month, asOf: args.asOf, client: { name: "Alex Sample" } });
      }
    }
  };
}

async function call(query, principal, { inOrg, report = reportModule(), build } = {}) {
  const res = makeRes();
  const built = [];
  await handler({ method: "GET", query }, res, {
    db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {},
    moneyOverview: build || (async (_db, args) => { built.push(args); return { ok: true }; }),
    monthlyReport: report.mod
  });
  return { res, calls: report.calls, built };
}

describe("GET /api/money/overview?report=monthly", () => {
  test("a client gets their own month as a PDF download", async () => {
    const { res, calls, built } = await call({ report: "monthly", month: "2026-10", client_id: OTHER }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.headers["content-disposition"], 'attachment; filename="fundhub-report-2026-10.pdf"');
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.equal(Buffer.from(res.bytes).subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(calls.map((c) => [c.orgId, c.clientId, c.month]), [[ORG, MINE, "2026-10"]], "the session's file, never ?client_id");
    assert.equal(built.length, 0, "the JSON overview is not built for a report");
  });

  test("no month means this month", async () => {
    const { res, calls } = await call({ report: "monthly" }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].month, "2026-11");
  });

  test("staff need a role on the FinanceOS list and a client in their org — the overview's own gate", async () => {
    const ok = await call({ report: "monthly", client_id: OTHER }, staffP("admin"), { inOrg: [OTHER] });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls[0].clientId, OTHER);
    assert.equal((await call({ report: "monthly" }, staffP("admin"))).res.statusCode, 400, "client_id is required for staff");
    assert.equal((await call({ report: "monthly", client_id: OTHER }, staffP("admin"), { inOrg: [MINE] })).res.statusCode, 404);
    const wrongRole = await call({ report: "monthly", client_id: OTHER }, staffP("setter"), { inOrg: [OTHER] });
    assert.equal(wrongRole.res.statusCode, 403);
    assert.equal(wrongRole.calls.length, 0);
    assert.equal((await call({ report: "monthly" }, null)).res.statusCode, 401);
  });

  test("a bad report, a bad month or a future month is a plain 400; nothing is read", async () => {
    for (const q of [{ report: "weekly" }, { report: "monthly", month: "2026-13" }, { report: "monthly", month: "2026-12" }, { report: "monthly", month: "2020-01" }]) {
      const { res, calls } = await call(q, clientP());
      assert.equal(res.statusCode, 400, JSON.stringify(q));
      assert.equal(res.body.error, "invalid_parameter");
      assert.equal(typeof res.body.message, "string");
      assert.equal(calls.length, 0);
    }
  });

  test("a client the read cannot find is 404; a database outage is 503 db:down", async () => {
    assert.equal((await call({ report: "monthly" }, clientP(), { report: reportModule({ built: null }) })).res.statusCode, 404);
    const down = Object.assign(new Error("Connection terminated unexpectedly"), {});
    const { res } = await call({ report: "monthly" }, clientP(), { report: reportModule({ throws: down }) });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.db, "down");
  });

  test("without ?report the overview answers JSON exactly as before", async () => {
    const { res, built, calls } = await call({}, clientP());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(built.length, 1);
    assert.equal(calls.length, 0);
  });
});
