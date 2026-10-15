// Batch 12, repair cycle 1: the numbers the Hiring bench table PAINTS are worked out by api/hiring/bench.mjs.
// The live check for the bench reads the bench VIEW. It never saw awaiting_screen, awaiting_group_interview,
// short or unrouted, which the handler works out itself from the applications. This test runs the handler's own
// query text (the exact string fetchRows sends) over stand-in rows and judges every figure it returns against
// a count made here. Practice test means stand-in rows, not saved data. Nothing here reads live data.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchRows } from "../../../../api/hiring/bench.mjs";
import { makeStandIn, portableSql } from "./fin-b12-sql-kit.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

let n = 0;
const id = (p) => `${p}-${String(++n).padStart(3, "0")}`;

function world() {
  const s = makeStandIn(["orgs", "staff", "candidate_applications", "pipeline_stages"]);
  // v_hiring_bench is a view (migration 051), so the stand-in holds it as a plain table with its columns.
  s.db.exec(`CREATE TABLE v_hiring_bench ("org_id", "role_id", "role_key", "role_name", "bench_target",
    "hiring_manager_staff_id", "open_applications", "bench_count", "bench_shortfall")`);
  s.insert("orgs", { id: ORG, slug: "fundhub", name: "Fundhub", is_default: true, demo_mode_enabled: false });
  s.insert("orgs", { id: OTHER, slug: "other", name: "Other", is_default: false, demo_mode_enabled: false });
  for (const key of ["applied", "screening", "group_interview", "one_on_one", "offer"]) {
    s.insert("pipeline_stages", { id: `stage-${key}`, org_id: ORG, key, name: key });
  }
  return s;
}

function view(s, role, row) {
  s.db.prepare(`INSERT INTO v_hiring_bench VALUES (?,?,?,?,?,?,?,?,?)`).run(
    row.org_id ?? ORG, role.id, role.key, role.name, row.bench_target, row.manager ?? null,
    row.open_applications, row.bench_count, row.bench_shortfall);
}

function app(s, role, stage, status = "open") {
  s.insert("candidate_applications", { id: id("app"), org_id: ORG, candidate_id: id("cand"), role_id: role.id,
    stage_id: `stage-${stage}`, status, applied_at: "2026-10-01T09:00:00.000Z", entered_stage_at: "2026-10-02T09:00:00.000Z" });
}

const db = (s) => ({
  query: async (sql, params) => ({ rows: s.db.prepare(portableSql(sql)).all(...params) }),
});

test("the bench read works out awaiting screen, awaiting group interview, short, unrouted and the manager from the applications", { timeout: 60_000 }, async () => {
  await proof.check(/^Bench table: one row per role/, async () => {
    const s = world();
    const closer = { id: "role-closer", key: "closer", name: "Closer" };
    const setter = { id: "role-setter", key: "setter", name: "Setter" };
    const coord = { id: "role-coord", key: "sales_coordinator", name: "Sales Coordinator" };
    s.insert("staff", { id: "staff-casey", org_id: ORG, name: "Casey Reed", role: "closer", status: "active", is_demo: false });

    // Closer: 3 waiting on a screen, 1 at the group interview, 2 on the bench (one 1:1 and one offer); one
    // closed application at Applied is not counted.
    app(s, closer, "applied"); app(s, closer, "applied"); app(s, closer, "applied");
    app(s, closer, "applied", "rejected");
    app(s, closer, "group_interview");
    app(s, closer, "one_on_one"); app(s, closer, "offer");
    view(s, closer, { bench_target: 4, open_applications: 7, bench_count: 2, bench_shortfall: 2 });
    // Setter: managed by Casey, one waiting on a screen, nobody at group, bench full.
    app(s, setter, "applied");
    app(s, setter, "one_on_one"); app(s, setter, "one_on_one"); app(s, setter, "offer"); app(s, setter, "offer");
    view(s, setter, { bench_target: 4, manager: "staff-casey", open_applications: 5, bench_count: 4, bench_shortfall: 0 });
    // Sales coordinator: nobody at all, no manager, the biggest shortfall.
    view(s, coord, { bench_target: 5, open_applications: 0, bench_count: 0, bench_shortfall: 5 });
    // A bench row of another company is never read.
    view(s, { id: "role-far", key: "closer", name: "Closer" }, { org_id: OTHER, bench_target: 9, open_applications: 0, bench_count: 0, bench_shortfall: 9 });

    const rows = await fetchRows(db(s), { limit: 200, offset: 0 });
    s.close();
    const slim = rows.map((r) => ({
      role_key: r.role_key, awaiting_screen: r.awaiting_screen, awaiting_group_interview: r.awaiting_group_interview,
      short: !!r.short, unrouted: !!r.unrouted, hiring_manager: r.hiring_manager,
      bench_count: r.bench_count, bench_shortfall: r.bench_shortfall, open_applications: r.open_applications,
    }));
    // Largest shortfall first, then by role key.
    assert.deepEqual(slim, [
      { role_key: "sales_coordinator", awaiting_screen: 0, awaiting_group_interview: 0, short: true, unrouted: true, hiring_manager: null,
        bench_count: 0, bench_shortfall: 5, open_applications: 0 },
      { role_key: "closer", awaiting_screen: 3, awaiting_group_interview: 1, short: true, unrouted: true, hiring_manager: null,
        bench_count: 2, bench_shortfall: 2, open_applications: 7 },
      { role_key: "setter", awaiting_screen: 1, awaiting_group_interview: 0, short: false, unrouted: false, hiring_manager: "Casey Reed",
        bench_count: 4, bench_shortfall: 0, open_applications: 5 },
    ]);
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
