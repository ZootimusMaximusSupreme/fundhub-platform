// finish-853 batch 26: GET /api/read/my-numbers. The real handler and the real metrics library
// (src/sales/metrics.mjs closerMyNumbers) run over a stand-in call_outcomes table that answers by the
// conditions each statement names (company, closer, month, demo flag). Practice test, fake data,
// no network, no database.
// The row's words: a closer's own performance (calls, show rate, close rate, cash); finance roles may
// view another closer.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/my-numbers.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";
import { cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep, splitTop } from "../testing/fin-b26-sql.mjs";

const OTHER_CLOSER = "5b000000-0000-4000-8000-000000000002";
const NOW = new Date();
const monthStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
const inMonth = (hours) => new Date(monthStart.getTime() + hours * 3600e3).toISOString();
const lastMonth = (hours) => new Date(monthStart.getTime() - hours * 3600e3).toISOString();
// 32 days after the first of this month is always inside NEXT month, whatever this month's length.
const nextMonth = (hours) => new Date(monthStart.getTime() + 32 * 86400e3 + hours * 3600e3).toISOString();

const call = (staff, outcome, cash, loggedAt, over = {}) => ({
  org_id: ORG_ID, staff_id: staff, outcome, cash_collected_cents: cash, logged_at: loggedAt, is_demo: false, ...over,
});

function world({ withDemo = false } = {}) {
  return {
    staff: [
      { id: STAFF_ID, org_id: ORG_ID, name: "Casey Closer", role: "closer", email: "casey@example.test" },
      { id: OTHER_CLOSER, org_id: ORG_ID, name: "Other Closer", role: "closer", email: "other@example.test" },
    ],
    call_outcomes: [
      // This closer, this month: 2 deposits, a downsell and a no-sale held; two no-shows.
      call(STAFF_ID, "deposit", 150000, inMonth(1)),
      call(STAFF_ID, "deposit", 50000, inMonth(2)),
      call(STAFF_ID, "downsell", 20000, inMonth(3)),
      call(STAFF_ID, "no_sale", 0, inMonth(4)),
      call(STAFF_ID, "no_show", 0, inMonth(5)),
      call(STAFF_ID, "no_show", 0, inMonth(6)),
      // Not counted: another company's row for the same closer, last month's rows, next month's row.
      call(STAFF_ID, "deposit", 888800, inMonth(7), { org_id: OTHER_ORG_ID }),
      call(STAFF_ID, "deposit", 70000, lastMonth(24)),
      call(STAFF_ID, "no_sale", 0, lastMonth(48)),
      call(STAFF_ID, "deposit", 55500, nextMonth(1)),
      // A demo row: left out of this closer's own numbers.
      ...(withDemo ? [call(STAFF_ID, "deposit", 999900, inMonth(8), { is_demo: true })] : []),
      // Another closer in this company.
      call(OTHER_CLOSER, "deposit", 300000, inMonth(1)),
      call(OTHER_CLOSER, "deposit", 100000, inMonth(2)),
      call(OTHER_CLOSER, "no_show", 0, inMonth(3)),
    ],
  };
}

/**
 * The statements, answered by reading them: the WHERE as written (company, closer, window, demo flag),
 * and every aggregate column the SELECT names (count FILTER, SUM) worked out from the rows that
 * WHERE keeps. The team table is read the same way: its join, its roster condition, its GROUP BY, its
 * aggregates and its ORDER BY.
 */
function rulesFor(t) {
  return [
    [/FROM call_outcomes\s+WHERE org_id = \$1 AND staff_id = \$2/i, (sql, p) => {
      const items = selectList(sql, 0);
      const kept = keep(t.call_outcomes, whereOf(sql), p, { alias: "call_outcomes" });
      const group = kept.map((r) => ({ params: p, row: r, rows: { call_outcomes: r } }));
      return [projectRow(items, { params: p, group, rows: {} })];
    }],
    [/FROM call_outcomes o\s+JOIN clients c ON c\.id = o\.client_id AND c\.org_id = o\.org_id\s+WHERE o\.org_id = \$1\s+AND o\.outcome = 'deposit'/i, (sql, p) => {
      // Deposit-to-funded: not the subject of this row; the staff condition is the only part read here.
      const rows = t.call_outcomes.filter((r) => r.org_id === p[0] && r.outcome === "deposit" && r.logged_at >= p[1] && r.logged_at < p[2]
        && (p[3] === undefined || r.staff_id === p[3]));
      return [{ deposits: rows.length, funded: 0 }];
    }],
    [/FROM call_outcomes o\s+JOIN staff s ON s\.id = o\.staff_id/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /JOIN staff s ON ([\s\S]*?) WHERE/i.exec(text)[1];
      const groupText = /GROUP BY ([\s\S]*?) ORDER BY/i.exec(text)[1];
      const where = whereOf(sql);
      const kept = [];
      for (const o of t.call_outcomes) {
        for (const s of t.staff) {
          const env = { params: p, rows: { o, s } };
          if (evalSql(joinText, env) === true && evalSql(where, env) === true) kept.push(env);
        }
      }
      const groups = new Map();
      for (const env of kept) {
        const key = splitTop(groupText).map((e) => String(evalSql(e, env))).join("|");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(env);
      }
      const out = [...groups.values()].map((g) => projectRow(items, { ...g[0], group: g }));
      return orderRows(out, orderOf(sql), (row) => ({ row }));
    }],
  ];
}

const get = (who, query = {}, t = world()) => run(handler, req("GET", { query }), [...who, ...rulesFor(t)]);

describe("GET /api/read/my-numbers", () => {
  test("a closer sees their own month: calls held, no-shows, show rate, close rate, cash; and last month's close rate", async () => {
    const { res, fake } = await get(asRole("closer"));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.staff_id, STAFF_ID);
    assert.equal(res.body.month.calls_held, 4);
    assert.equal(res.body.month.no_shows, 2, "two calls nobody showed up for");
    assert.equal(res.body.month.deposits_closed, 2);
    assert.equal(res.body.month.downsells, 1, "one downsell, not the deposits and not the no-shows");
    assert.equal(res.body.month.show_rate, 4 / 6, "held over held plus no-shows");
    assert.equal(res.body.month.close_rate, 2 / 4, "deposits over calls held");
    assert.equal(res.body.pace.deposits, 2);
    assert.equal(res.body.pace.cash_cents, 220000, "last month, next month and another company are not cash");
    assert.equal(res.body.pace.cash_display, "$2,200");
    assert.deepEqual(res.body.month.prior, { deposits: 1, close_rate: 1 / 2 }, "last month: one deposit in two calls held");
    assert.equal(res.body.period.label, "this month");
    assert.equal(new Date(res.body.period.start).getTime(), monthStart.getTime());
    // The team table: best cash first, each closer's own deposits and close rate (deposits over calls
    // held, a no-show is not a call held), and this closer's rank in it.
    // (Its cash counts demo rows that this closer's own cash line leaves out: a product finding written
    // in the manifest. This world has no demo row, so that difference is not judged here.)
    assert.equal(res.body.pace.team_size, 2);
    assert.deepEqual(res.body.team.map((m) => [m.rank, m.staff_id, m.name, m.cash_cents, m.deposits, m.close_rate]), [
      [1, OTHER_CLOSER, "Other Closer", 400000, 2, 1],
      [2, STAFF_ID, "Casey Closer", 220000, 2, 0.5],
    ], "the team, ranked by cash");
    assert.equal(res.body.pace.rank, 2, "this closer is second");
    // The words of the count, as the statement must spell them.
    const q = sqlOf(fake, /FROM call_outcomes\s+WHERE org_id = \$1 AND staff_id = \$2/);
    assert.equal(q.length, 2, "this month and last month");
    assert.deepEqual(q[0].params.slice(0, 2), [ORG_ID, STAFF_ID], "this company and this closer, from the session");
    pinned(q[0].sql, "this closer, this company, inside the month, no demo rows",
      "WHERE org_id = $1 AND staff_id = $2 AND logged_at >= $3 AND logged_at < $4 AND COALESCE(is_demo, false) = false");
    pinned(q[0].sql, "calls held are every call that is not a no-show", "count(*) FILTER (WHERE outcome <> 'no_show')::int AS held");
    pinned(q[0].sql, "deposits", "count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits");
    pinned(q[0].sql, "cash", "COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents");
    assert.equal(wrote(fake), false);
  });

  test("a demo row is left out of the closer's own numbers", async () => {
    const { res } = await get(asRole("closer"), {}, world({ withDemo: true }));
    assert.equal(res.body.pace.cash_cents, 220000, "the 9,999 demo deposit is not cash");
    assert.equal(res.body.pace.deposits, 2);
    assert.equal(res.body.month.deposits_closed, 2);
    assert.equal(res.body.month.calls_held, 4);
  });

  test("the company is the session's: another company's id in the address changes nothing", async () => {
    const { res, fake } = await get(asRole("closer"), { org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pace.cash_cents, 220000);
    assert.equal(res.body.month.calls_held, 4);
    for (const call of sqlOf(fake, /FROM call_outcomes/)) assert.equal(call.params[0], ORG_ID, "every read is bound to the signed-in company");
    const finance = await get(asRole("owner"), { staff_id: OTHER_CLOSER, org_id: OTHER_ORG_ID });
    assert.equal(finance.res.body.pace.cash_cents, 400000);
  });

  test("a closer cannot ask for another closer; the address changes nothing and nothing is read", async () => {
    const { res, fake } = await get(asRole("closer"), { staff_id: OTHER_CLOSER });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /only see their own numbers/);
    assert.equal(sqlOf(fake, /FROM call_outcomes/).length, 0);
  });

  test("owner, admin and sales manager may view another closer, and the numbers are that closer's", async () => {
    for (const role of ["owner", "admin", "sales_manager"]) {
      const { res, fake } = await get(asRole(role), { staff_id: OTHER_CLOSER });
      assert.equal(res.statusCode, 200, role);
      assert.equal(res.body.staff_id, OTHER_CLOSER);
      assert.equal(res.body.month.deposits_closed, 2, role);
      assert.equal(res.body.pace.cash_cents, 400000, role);
      assert.equal(res.body.month.calls_held, 2);
      assert.equal(res.body.month.close_rate, 1);
      assert.equal(res.body.month.show_rate, 2 / 3);
      assert.equal(res.body.month.no_shows, 1);
      assert.equal(res.body.pace.rank, 1, `${role}: the other closer leads the team`);
      assert.deepEqual(sqlOf(fake, /FROM call_outcomes\s+WHERE org_id = \$1 AND staff_id = \$2/)[0].params.slice(0, 2), [ORG_ID, OTHER_CLOSER]);
    }
    const bad = await get(asRole("owner"), { staff_id: "not-a-uuid" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(sqlOf(bad.fake, /FROM call_outcomes/).length, 0);
  });

  test("the company is the session's: another company's finance role reads only that company's rows for the same staff id", async () => {
    const { res, fake } = await get(asRole("owner", { org_id: OTHER_ORG_ID }), { staff_id: STAFF_ID });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.month.calls_held, 1, "only company B's one row");
    assert.equal(res.body.pace.cash_cents, 888800, "company A's 220,000 is not in it");
    const empty = await get(asRole("owner", { org_id: OTHER_ORG_ID }), { staff_id: OTHER_CLOSER });
    assert.equal(empty.res.body.month.calls_held, 0);
    assert.equal(empty.res.body.month.close_rate, null, "no calls means no rate, never 0");
    assert.equal(empty.res.body.month.show_rate, null);
    assert.equal(sqlOf(fake, /FROM call_outcomes\s+WHERE org_id = \$1 AND staff_id = \$2/)[0].params[0], OTHER_ORG_ID);
  });

  test("a finance role with no staff_id reads their own (empty) numbers; every other staff role is told this page is for closers", async () => {
    const own = await get(asRole("owner"));
    assert.equal(own.res.statusCode, 200);
    assert.equal(own.res.body.staff_id, STAFF_ID);
    for (const role of ALL_STAFF_ROLES.filter((r) => !["closer", "owner", "admin", "sales_manager"].includes(r))) {
      const { res, fake } = await get(asRole(role));
      assert.equal(res.statusCode, 403, role);
      assert.match(res.body.message, /for closers/);
      assert.equal(sqlOf(fake, /FROM call_outcomes/).length, 0, role);
      const withId = await get(asRole(role), { staff_id: OTHER_CLOSER });
      assert.equal(withId.res.statusCode, 403, `${role} naming a closer`);
      assert.equal(sqlOf(withId.fake, /FROM call_outcomes/).length, 0);
    }
  });

  test("a role off the floor, a partner, a client, an affiliate, nobody and a session with no company read nothing; only GET answers", async () => {
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res, fake } = await get(asRole(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(sqlOf(fake, /FROM call_outcomes/).length, 0);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res, fake } = await get(who);
      assert.ok([401, 403].includes(res.statusCode));
      assert.equal(sqlOf(fake, /FROM call_outcomes/).length, 0);
    }
    const noOrg = await get(asRole("closer", { org_id: null }));
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(sqlOf(noOrg.fake, /FROM call_outcomes/).length, 0);
    // A company id typed into the address does not give a company-less session a company.
    const typedOrg = await get(asRole("closer", { org_id: null }), { org_id: ORG_ID });
    assert.equal(typedOrg.res.statusCode, 403);
    assert.equal(sqlOf(typedOrg.fake, /FROM call_outcomes/).length, 0);
    const nobody = await run(handler, req("GET"), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
    const post = await run(handler, req("POST", { body: {} }), [...asRole("closer"), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
    assert.equal(post.res.headers.allow, "GET");
  });
});
