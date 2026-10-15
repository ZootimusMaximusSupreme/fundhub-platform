// finish-853 batch 26: POST /api/training-progress. The real handler runs the real training library
// (src/training/progress.mjs, gates.mjs, entitlement.mjs) over stand-in tables that answer by the
// conditions each statement names. Practice test, fake data, no network, no database.
// The row's words: record a partner's training, one module attended or complete, or one compliance
// gate passed, failed or revoked. There is no partner write path.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/training-progress.mjs";
import { MODULES, GATES } from "../training/curriculum.mjs";
import {
  run, req, asRole, asPartner, asClient, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";
import {
  cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep, runInsert,
} from "../testing/fin-b26-sql.mjs";

const SECOND_STAFF = "5b000000-0000-4000-8000-000000000009";

const SIGNED = "2026-08-20T00:00:00.000Z";
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 14, 12, 0, 0, tick++)).toISOString();

function world({ partners, modules, progress = [], decisions = [], seeded = true } = {}) {
  const t = {
    partners: partners || [
      { id: PARTNER, org_id: ORG_ID, status: "active", agreement_signed_at: SIGNED },
      { id: "a3000000-0000-4000-8000-000000000003", org_id: ORG_ID, status: "paused", agreement_signed_at: SIGNED },
      { id: "a4000000-0000-4000-8000-000000000004", org_id: ORG_ID, status: "active", agreement_signed_at: null },
      { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID, status: "active", agreement_signed_at: SIGNED },
    ],
    training_modules: modules || (seeded ? MODULES.map((m) => ({
      id: `mod-${m.code}`, org_id: ORG_ID, code: m.code, position: m.position, title: m.title,
      week_no: m.weekNo, gate_code: m.gateCode, certified: m.certified,
    })) : []),
    training_gates: [
      ...GATES.map((g) => ({ org_id: ORG_ID, code: g.code, position: g.position, title: g.title, week_due: g.weekDue, blocks: `blocks ${g.code}` })),
      // Another company's catalogue: other titles and other words for what each gate blocks.
      ...GATES.map((g) => ({ org_id: OTHER_ORG_ID, code: g.code, position: g.position, title: `Foreign ${g.code}`, week_due: 9, blocks: `foreign blocks ${g.code}` })),
    ],
    partner_training_progress: progress,
    partner_training_gates: decisions,
  };
  return t;
}

/**
 * The statements, answered by reading them: every WHERE as written, every join condition, every ORDER BY
 * and DISTINCT ON, the named columns of every SELECT, and the two INSERTs by their own column lists.
 * The progress upsert is the real ON CONFLICT ... DO UPDATE SET list with its CASE expressions, worked out
 * from the existing row, so what "attended never undoes complete", "the first completion date stands" and
 * "a later write with no note keeps the note" mean is what the statement says, not what a stand-in assumes.
 */
function rulesFor(t) {
  const q = (re, fn) => [re, fn];
  const proj = (table, sql, p, rows) => {
    const items = selectList(sql, 0);
    return rows.map((r) => projectRow(items, { params: p, row: r, rows: { [table]: r } }));
  };
  const pickOf = (table, rows, { orderBy = false, limit = null } = {}) => (sql, p) => {
    let kept = keep(rows, whereOf(sql), p, { alias: table });
    if (orderBy && orderOf(sql)) kept = orderRows(kept, orderOf(sql), (r) => ({ params: p, rows: { [table]: r }, row: r }));
    if (limit) kept = kept.slice(0, limit);
    return proj(table, sql, p, kept);
  };
  return [
    q(/FROM partners\s+WHERE id = \$1 AND org_id = \$2/i, pickOf("partners", t.partners)),
    q(/SELECT id FROM training_modules WHERE org_id = \$1 AND code = \$2/i, pickOf("training_modules", t.training_modules, { limit: 1 })),
    q(/^\s*INSERT INTO partner_training_progress/i, (sql, p) => runInsert(sql, p, t.partner_training_progress, {
      now: stamp(),
      fill: (row) => ({ id: `p-${t.partner_training_progress.length + 1}`, ...row }),
    }).rows),
    // Both module reads: the curriculum with a partner's progress, and "which of these gate modules are not complete".
    q(/FROM training_modules m\s+LEFT JOIN partner_training_progress p/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /LEFT JOIN partner_training_progress p ON ([\s\S]*?) WHERE/i.exec(text)[1];
      const out = [];
      for (const m of t.training_modules) {
        const matches = t.partner_training_progress.filter((pr) => evalSql(joinText, { params: p, rows: { m, p: pr } }) === true);
        for (const pr of (matches.length ? matches : [null])) {
          const env = { params: p, rows: { m, p: pr } };
          if (evalSql(whereOf(sql), env) === true) out.push(env);
        }
      }
      const order = orderOf(sql);
      return (order ? orderRows(out, order, (env) => env) : out).map((env) => projectRow(items, env));
    }),
    q(/FROM training_gates\s+WHERE org_id = \$1/i, pickOf("training_gates", t.training_gates, { orderBy: true })),
    q(/SELECT DISTINCT ON \(g\.gate_code\)/i, (sql, p) => {
      const items = selectList(sql, 0);
      const kept = keep(t.partner_training_gates, whereOf(sql), p, { alias: "g" });
      const ordered = orderRows(kept, orderOf(sql), (r) => ({ params: p, rows: { g: r } }));
      const seen = new Set();
      const out = [];
      for (const r of ordered) {
        if (seen.has(r.gate_code)) continue; // DISTINCT ON (g.gate_code): the first row of each gate, in the order written
        seen.add(r.gate_code);
        out.push(projectRow(items, { params: p, rows: { g: r } }));
      }
      return out;
    }),
    q(/SELECT outcome\s+FROM partner_training_gates\s+WHERE org_id = \$1 AND partner_id = \$2 AND gate_code = \$3/i, (sql, p) => {
      const kept = keep(t.partner_training_gates, whereOf(sql), p, { alias: "partner_training_gates" });
      const ordered = orderOf(sql) ? orderRows(kept, orderOf(sql), (r) => ({ row: r })) : kept;
      return proj("partner_training_gates", sql, p, ordered.slice(0, 1));
    }),
    q(/^\s*INSERT INTO partner_training_gates/i, (sql, p) => runInsert(sql, p, t.partner_training_gates, {
      fill: (row) => ({ id: `g-${t.partner_training_gates.length + 1}`, decided_at: stamp(), ...row }),
    }).rows),
  ];
}

const post = (body, who = asRole("owner"), t = world()) =>
  run(handler, req("POST", { body }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));

const mod = (partner, code, status = "attended") => ({ partner_id: partner, action: "module", module: code, status });
const gate = (partner, code, outcome) => ({ partner_id: partner, action: "gate", gate: code, outcome });

describe("POST /api/training-progress", () => {
  test("an owner records one module as attended, then as complete, with a dated record and who wrote it", async () => {
    const t = world();
    const first = await post({ ...mod(PARTNER, "m1"), notes: "  turned up  " }, asRole("owner"), t);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.body.recorded.status, "attended");
    assert.equal(first.res.body.recorded.completed_at, null);
    assert.equal(first.res.body.recorded.recorded_by_staff_id, STAFF_ID);
    assert.equal(first.res.body.recorded.notes, "turned up");
    const m1 = first.res.body.modules.find((m) => m.code === "m1");
    assert.equal(m1.status, "attended");
    assert.equal(first.res.body.modules_complete, 0);
    assert.equal(first.res.body.modules_total, 13);

    const done = await post({ ...mod(PARTNER, "m1", "complete") }, asRole("admin", { staff_id: SECOND_STAFF }), t);
    assert.equal(done.res.statusCode, 200);
    assert.equal(done.res.body.recorded.status, "complete");
    assert.equal(done.res.body.recorded.recorded_by_staff_id, SECOND_STAFF, "the person who wrote last is the one on the record");
    assert.equal(done.res.body.modules.find((m) => m.code === "m1").recorded_by_staff_id, SECOND_STAFF);
    assert.ok(done.res.body.recorded.completed_at, "a completion carries a date");
    assert.ok(done.res.body.recorded.attended_at, "and an attendance date");
    assert.equal(done.res.body.recorded.attended_at, first.res.body.recorded.attended_at, "the first attendance date stands");
    assert.equal(done.res.body.modules_complete, 1);
    assert.equal(t.partner_training_progress.length, 1, "one row per partner and module, updated in place");

    const insert = sqlOf(done.fake, /INSERT INTO partner_training_progress/)[0];
    assert.deepEqual([insert.params[0], insert.params[1], insert.params[2]], [ORG_ID, PARTNER, "mod-m1"]);
    pinned(insert.sql, "one row per partner and module", "ON CONFLICT (org_id, partner_id, module_id) DO UPDATE");
  });

  test("attended never undoes complete, and the first completion date stands", async () => {
    const t = world();
    const complete = await post(mod(PARTNER, "m7", "complete"), asRole("owner"), t);
    const stamped = complete.res.body.recorded.completed_at;
    assert.ok(stamped, "a first-time completion carries its date");
    assert.ok(complete.res.body.recorded.attended_at, "and an attendance date");
    assert.equal(complete.res.body.modules.find((m) => m.code === "m7").completed_at, stamped, "the same date on the screen's module list");
    const twice = await post(mod(PARTNER, "m7", "complete"), asRole("owner"), t);
    assert.equal(twice.res.body.recorded.completed_at, stamped, "ticking complete again does not restamp the date");
    const again = await post({ ...mod(PARTNER, "m7", "attended"), notes: "roll call twice" }, asRole("owner"), t);
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.recorded.status, "complete", "roll being called twice must not un-certify");
    assert.equal(again.res.body.recorded.completed_at, stamped);
    assert.equal(again.res.body.recorded.notes, "roll call twice");
    const noNote = await post(mod(PARTNER, "m7", "attended"), asRole("owner"), t);
    assert.equal(noNote.res.body.recorded.notes, "roll call twice", "a later write with no note keeps the note");
  });

  test("a gate cannot pass until its modules are complete and the gate before it is passed; a failure is always recorded", async () => {
    const t = world();
    const early = await post(gate(PARTNER, "G1", "passed"), asRole("owner"), t);
    assert.equal(early.res.statusCode, 409);
    assert.equal(early.res.body.error, "modules_incomplete");
    assert.equal(t.partner_training_gates.length, 0);

    await post(mod(PARTNER, "m1", "complete"), asRole("owner"), t);
    const half = await post(gate(PARTNER, "G1", "passed"), asRole("owner"), t);
    assert.equal(half.res.body.error, "modules_incomplete", "m2 is still open");
    // A completion filed under ANOTHER company for the same partner and module (a data mismatch) does not count.
    t.partner_training_progress.push({ id: "mismatch", org_id: OTHER_ORG_ID, partner_id: PARTNER, module_id: "mod-m2", status: "complete",
      attended_at: "2026-09-01T00:00:00.000Z", completed_at: "2026-09-01T00:00:00.000Z", recorded_by_staff_id: null, notes: null });
    const foreignDone = await post(gate(PARTNER, "G1", "passed"), asRole("owner"), t);
    assert.equal(foreignDone.res.statusCode, 409);
    assert.equal(foreignDone.res.body.error, "modules_incomplete", "another company's completion is not this company's");
    t.partner_training_progress.pop();
    // A module that was only ATTENDED is not complete: the gate stays shut.
    await post(mod(PARTNER, "m2", "attended"), asRole("owner"), t);
    const attendedOnly = await post(gate(PARTNER, "G1", "passed"), asRole("owner"), t);
    assert.equal(attendedOnly.res.statusCode, 409);
    assert.equal(attendedOnly.res.body.error, "modules_incomplete", "attended is not complete");
    assert.equal(t.partner_training_gates.length, 0);
    await post(mod(PARTNER, "m2", "complete"), asRole("owner"), t);

    const g1 = await post({ ...gate(PARTNER, "G1", "passed"), notes: "cleared" }, asRole("owner"), t);
    assert.equal(g1.res.statusCode, 200);
    assert.equal(g1.res.body.recorded.outcome, "passed");
    assert.equal(g1.res.body.recorded.decided_by_staff_id, STAFF_ID);
    assert.equal(g1.res.body.gates.find((g) => g.code === "G1").passed, true);
    assert.equal(g1.res.body.may_sell_supervised, false, "G2 and G3 are still open");
    assert.deepEqual(g1.res.body.gates_outstanding, ["G2", "G3", "G4"]);

    // G3 cannot be passed before G2, even with its modules complete.
    for (const code of ["m6", "m9", "m10", "m11"]) await post(mod(PARTNER, code, "complete"), asRole("owner"), t);
    const skip = await post(gate(PARTNER, "G3", "passed"), asRole("owner"), t);
    assert.equal(skip.res.statusCode, 409);
    assert.equal(skip.res.body.error, "out_of_order");

    // A failure is recorded whatever the order or attendance: the attempt is the record.
    const failed = await post(gate(PARTNER, "G4", "failed"), asRole("owner"), t);
    assert.equal(failed.res.statusCode, 200);
    assert.equal(failed.res.body.gates.find((g) => g.code === "G4").outcome, "failed");
    assert.equal(failed.res.body.gates.find((g) => g.code === "G4").passed, false);
  });

  test("a revocation only takes back a pass that stands; the newest decision wins", async () => {
    const t = world();
    const none = await post(gate(PARTNER, "G1", "revoked"), asRole("owner"), t);
    assert.equal(none.res.statusCode, 409);
    assert.equal(none.res.body.error, "not_passed");
    for (const code of ["m1", "m2"]) await post(mod(PARTNER, code, "complete"), asRole("owner"), t);
    await post(gate(PARTNER, "G1", "passed"), asRole("owner"), t);
    const revoked = await post(gate(PARTNER, "G1", "revoked"), asRole("admin"), t);
    assert.equal(revoked.res.statusCode, 200);
    const g1 = revoked.res.body.gates.find((g) => g.code === "G1");
    assert.equal(g1.outcome, "revoked");
    assert.equal(g1.passed, false);
    assert.equal(t.partner_training_gates.length, 2, "decisions are appended, never edited");
    const again = await post(gate(PARTNER, "G1", "revoked"), asRole("owner"), t);
    assert.equal(again.res.statusCode, 409, "a pass already taken back cannot be taken back twice");
    assert.equal(again.res.body.error, "not_passed");
    for (const code of ["m7", "m8"]) await post(mod(PARTNER, code, "complete"), asRole("owner"), t);
    const next = await post(gate(PARTNER, "G2", "passed"), asRole("owner"), t);
    assert.equal(next.res.statusCode, 409, "G2 waits on a G1 that stands today");
    assert.equal(next.res.body.error, "out_of_order");
  });

  test("standings read this company's and this partner's decisions only; another company's titles are not shown", async () => {
    const t = world({
      decisions: [
        // Another company passed G2 for the same partner id; another partner of this company passed G2 too.
        { id: "x1", org_id: OTHER_ORG_ID, partner_id: PARTNER, gate_code: "G2", outcome: "passed", decided_by_staff_id: STAFF_ID, notes: null, decided_at: "2026-10-01T00:00:00.000Z" },
        { id: "x2", org_id: ORG_ID, partner_id: OTHER_PARTNER, gate_code: "G2", outcome: "passed", decided_by_staff_id: STAFF_ID, notes: null, decided_at: "2026-10-01T00:00:00.000Z" },
        { id: "x3", org_id: ORG_ID, partner_id: OTHER_PARTNER, gate_code: "G1", outcome: "passed", decided_by_staff_id: STAFF_ID, notes: null, decided_at: "2026-10-01T00:00:00.000Z" },
      ],
    });
    // The page the owner gets back after recording one module for PARTNER.
    const { res, fake } = await post(mod(PARTNER, "m1"), asRole("owner"), t);
    assert.equal(res.statusCode, 200);
    const g = Object.fromEntries(res.body.gates.map((x) => [x.code, x]));
    assert.deepEqual([g.G1.outcome, g.G2.outcome, g.G1.passed, g.G2.passed], [null, null, false, false], "no decision of this partner's is on file");
    assert.deepEqual(res.body.gates_outstanding, ["G1", "G2", "G3", "G4"]);
    assert.deepEqual([g.G1.title, g.G1.blocks, g.G1.week_due], ["Capital and Plan Gate", "blocks G1", 1], "this company's own catalogue words");
    const latest = sqlOf(fake, /DISTINCT ON/)[0];
    assert.deepEqual(latest.params, [ORG_ID, PARTNER]);
    const catalogue = sqlOf(fake, /FROM training_gates/)[0];
    assert.deepEqual(catalogue.params, [ORG_ID]);
    // And a real decision of this partner's, newest first per gate, is what shows.
    const mine = world({
      decisions: [
        { id: "y1", org_id: ORG_ID, partner_id: PARTNER, gate_code: "G1", outcome: "passed", decided_by_staff_id: STAFF_ID, notes: "old", decided_at: "2026-10-01T00:00:00.000Z" },
        { id: "y2", org_id: ORG_ID, partner_id: PARTNER, gate_code: "G1", outcome: "revoked", decided_by_staff_id: SECOND_STAFF, notes: "new", decided_at: "2026-10-02T00:00:00.000Z" },
      ],
    });
    const after = await post(mod(PARTNER, "m1"), asRole("owner"), mine);
    const g1 = after.res.body.gates.find((x) => x.code === "G1");
    assert.deepEqual([g1.outcome, g1.notes, g1.decided_by_staff_id, g1.decided_at], ["revoked", "new", SECOND_STAFF, "2026-10-02T00:00:00.000Z"], "the newest decision wins and carries its own fields");
  });

  test("the selling release follows the gates: supervised needs G1, G2 and G3; unsupervised needs all four", async () => {
    const t = world();
    const owner = asRole("owner");
    const doMods = async (codes) => { for (const code of codes) await post(mod(PARTNER, code, "complete"), owner, t); };
    const passGate = async (code) => {
      const out = await post(gate(PARTNER, code, "passed"), owner, t);
      assert.equal(out.res.statusCode, 200, `${code}: ${JSON.stringify(out.res.body)}`);
      return out.res.body;
    };
    await doMods(["m1", "m2"]);
    let view = await passGate("G1");
    assert.deepEqual([view.may_sell_supervised, view.may_sell_unsupervised, view.gates_outstanding], [false, false, ["G2", "G3", "G4"]]);
    await doMods(["m7", "m8"]);
    view = await passGate("G2");
    assert.deepEqual([view.may_sell_supervised, view.may_sell_unsupervised, view.gates_outstanding], [false, false, ["G3", "G4"]], "two gates are not enough to sell");
    await doMods(["m6", "m9", "m10", "m11"]);
    view = await passGate("G3");
    assert.deepEqual([view.may_sell_supervised, view.may_sell_unsupervised, view.gates_outstanding], [true, false, ["G4"]], "three gates release supervised selling only");
    await doMods(["m13"]);
    view = await passGate("G4");
    assert.deepEqual([view.may_sell_supervised, view.may_sell_unsupervised, view.gates_outstanding], [true, true, []]);
    assert.equal(view.next_gate, null);
    // Taking G2 back closes both releases again.
    const revoked = await post(gate(PARTNER, "G2", "revoked"), owner, t);
    assert.equal(revoked.res.statusCode, 200);
    assert.deepEqual([revoked.res.body.may_sell_supervised, revoked.res.body.may_sell_unsupervised, revoked.res.body.gates_outstanding], [false, false, ["G2"]]);
  });

  test("a partner who is not an active, signed partner of this company cannot be recorded against", async () => {
    const PAUSED = "a3000000-0000-4000-8000-000000000003";
    const UNSIGNED = "a4000000-0000-4000-8000-000000000004";
    for (const [partner, reason] of [[PAUSED, "partner_not_active"], [UNSIGNED, "agreement_unsigned"], [FOREIGN_PARTNER, "no_partner"]]) {
      for (const body of [mod(partner, "m1"), gate(partner, "G1", "failed")]) {
        const t = world();
        const { res } = await post(body, asRole("owner"), t);
        assert.equal(res.statusCode, 403, `${reason} ${body.action}`);
        assert.equal(res.body.error, "not_entitled");
        assert.equal(res.body.reason, reason);
        assert.equal(t.partner_training_progress.length + t.partner_training_gates.length, 0);
      }
    }
    const lookup = sqlOf((await post(mod(FOREIGN_PARTNER, "m1"))).fake, /FROM partners/)[0];
    assert.deepEqual(lookup.params, [FOREIGN_PARTNER, ORG_ID], "the partner is looked up inside the signed-in company");
    pinned(lookup.sql, "the partner lookup names the company", "WHERE id = $1 AND org_id = $2");
  });

  test("only an owner or an admin may write; every other staff role and every non-staff login is refused before anything is read", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const t = world();
      const { res, fake } = await post(mod(PARTNER, "m1"), asRole(role), t);
      const allowed = role === "owner" || role === "admin";
      assert.equal(res.statusCode, allowed ? 200 : 403, role);
      if (!allowed) {
        assert.equal(res.body.error, "forbidden");
        assert.equal(sqlOf(fake, /partners|training_modules|partner_training/).length, 0, role);
        assert.equal(t.partner_training_progress.length, 0, role);
      }
    }
    for (const [name, who] of [["a partner", asPartner(PARTNER)], ["a client", asClient()]]) {
      const t = world();
      const { res, fake } = await post(mod(PARTNER, "m1", "complete"), who, t);
      assert.ok([401, 403].includes(res.statusCode), `${name} got ${res.statusCode}`);
      assert.equal(wrote(fake), false, name);
      assert.equal(t.partner_training_progress.length, 0, `${name} cannot tick their own module`);
    }
    const nobody = await post(mod(PARTNER, "m1"), [], world());
    assert.equal(nobody.res.statusCode, 401);
  });

  test("the company comes from the session: a body that names one is refused, and a session with none writes nothing", async () => {
    for (const key of ["org_id", "orgId", "staff_id", "staffId"]) {
      const t = world();
      const { res, fake } = await post({ ...mod(PARTNER, "m1"), [key]: OTHER_ORG_ID }, asRole("owner"), t);
      assert.equal(res.statusCode, 400, key);
      assert.equal(res.body.error, "session_owned_field", key);
      assert.equal(wrote(fake), false, key);
    }
    const noOrg = await post(mod(PARTNER, "m1"), asRole("owner", { org_id: null }), world());
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(noOrg.res.body.error, "org_required");
    assert.equal(noOrg.fake.calls.filter((c) => /partner|module/.test(c.sql)).length, 0);
  });

  test("bad input is the caller's error: a name that is not a module, status, gate, outcome or partner id", async () => {
    const cases = [
      [{ ...mod(PARTNER, "m99") }, 400, "unknown_module"],
      [{ ...mod(PARTNER, "m1", "done") }, 400, "unknown_status"],
      [{ ...gate(PARTNER, "G9", "passed") }, 400, "unknown_gate"],
      [{ ...gate(PARTNER, "G1", "maybe") }, 400, "unknown_outcome"],
      [{ partner_id: PARTNER, action: "erase" }, 400, "unknown_action"],
      [{ ...mod("not-a-uuid", "m1") }, 400, "partner_id must be a uuid"],
    ];
    for (const [body, status, error] of cases) {
      const t = world();
      const { res, fake } = await post(body, asRole("owner"), t);
      assert.equal(res.statusCode, status, JSON.stringify(body));
      assert.equal(res.body.error, error, JSON.stringify(body));
      assert.equal(wrote(fake), false, JSON.stringify(body));
    }
    const unseeded = await post(mod(PARTNER, "m1"), asRole("owner"), world({ seeded: false }));
    assert.equal(unseeded.res.statusCode, 409);
    assert.equal(unseeded.res.body.error, "module_not_seeded");
  });

  test("notes are trimmed and capped at 2,000 characters; only POST answers", async () => {
    const t = world();
    const long = await post({ ...mod(PARTNER, "m3"), notes: `  ${"x".repeat(2500)}  ` }, asRole("owner"), t);
    assert.equal(long.res.body.recorded.notes.length, 2000);
    const blank = await post({ ...mod(PARTNER, "m4"), notes: "   " }, asRole("owner"), t);
    assert.equal(blank.res.body.recorded.notes, null);
    const get = await run(handler, req("GET"), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(get.res.statusCode, 405);
    assert.equal(get.res.headers.allow, "POST");
    assert.equal(writes(get.fake).length, 0);
  });
});
