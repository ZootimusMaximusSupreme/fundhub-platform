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
  run, req, asRole, asPartner, asClient, inSql, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";

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
    training_gates: GATES.map((g) => ({ org_id: ORG_ID, code: g.code, position: g.position, title: g.title, week_due: g.weekDue, blocks: `blocks ${g.code}` })),
    partner_training_progress: progress,
    partner_training_gates: decisions,
  };
  return t;
}

function rulesFor(t) {
  const q = (re, fn) => [re, fn];
  return [
    q(/FROM partners\s+WHERE id = \$1 AND org_id = \$2/i, (sql, p) => inSql(t.partners, sql, p)),
    q(/SELECT id FROM training_modules WHERE org_id = \$1 AND code = \$2/i, (sql, p) => inSql(t.training_modules, sql, p).slice(0, 1)),
    q(/^\s*INSERT INTO partner_training_progress/i, (sql, p) => {
      const [org, partner, moduleId, status, staffId, notes] = p;
      const existing = t.partner_training_progress.find((r) => r.org_id === org && r.partner_id === partner && r.module_id === moduleId);
      // What the statement says decides what the stand-in does: the guard that stops 'attended'
      // from overwriting 'complete' is read from the SQL text itself.
      const keepsComplete = /WHEN partner_training_progress\.status = 'complete'\s+THEN 'complete'/.test(sql);
      const keepsDate = /WHEN partner_training_progress\.status = 'complete'\s+THEN partner_training_progress\.completed_at/.test(sql);
      const now = stamp();
      if (!existing) {
        const row = {
          id: `p-${t.partner_training_progress.length + 1}`, org_id: org, partner_id: partner, module_id: moduleId, status,
          attended_at: now, completed_at: status === "complete" ? now : null, recorded_by_staff_id: staffId, notes,
        };
        t.partner_training_progress.push(row);
        return [{ ...row }];
      }
      const wasComplete = existing.status === "complete";
      existing.status = keepsComplete && wasComplete ? "complete" : status;
      // When they turned up is a fact: the statement keeps the earliest attendance, and the stand-in follows its text.
      existing.attended_at = /attended_at = COALESCE\(partner_training_progress\.attended_at, EXCLUDED\.attended_at\)/.test(sql)
        ? (existing.attended_at || now) : now;
      if (keepsDate && wasComplete) { /* the first completion date stands */ } else if (status === "complete") existing.completed_at = now;
      existing.recorded_by_staff_id = staffId;
      existing.notes = notes === null || notes === undefined ? existing.notes : notes;
      return [{ ...existing }];
    }),
    q(/FROM training_modules m\s+LEFT JOIN partner_training_progress p\s+ON p\.module_id = m\.id\s+AND p\.org_id = m\.org_id\s+AND p\.partner_id = \$2/i, (sql, p) =>
      t.training_modules.filter((m) => m.org_id === p[0]).sort((a, b) => a.position - b.position).map((m) => {
        const prog = t.partner_training_progress.find((r) => r.module_id === m.id && r.org_id === m.org_id && r.partner_id === p[1]) || {};
        return {
          id: m.id, code: m.code, position: m.position, title: m.title, week_no: m.week_no, gate_code: m.gate_code,
          certified: m.certified, status: prog.status || null, attended_at: prog.attended_at || null,
          completed_at: prog.completed_at || null, recorded_by_staff_id: prog.recorded_by_staff_id || null, notes: prog.notes || null,
        };
      })),
    q(/FROM training_gates\s+WHERE org_id = \$1/i, (sql, p) => inSql(t.training_gates, sql, p).sort((a, b) => a.position - b.position)),
    q(/SELECT DISTINCT ON \(g\.gate_code\)/i, (sql, p) => {
      const mine = t.partner_training_gates.filter((r) => r.org_id === p[0] && r.partner_id === p[1]);
      const newest = new Map();
      // The direction of the sort is read from the statement: DISTINCT ON keeps the first row of each gate.
      const newestFirst = /ORDER BY g\.gate_code, g\.decided_at DESC, g\.id DESC/.test(sql);
      const ordered = [...mine].sort((a, b) => (newestFirst ? (b.decided_at > a.decided_at ? 1 : -1) : (a.decided_at > b.decided_at ? 1 : -1)));
      for (const r of ordered) if (!newest.has(r.gate_code)) newest.set(r.gate_code, r);
      return [...newest.values()].sort((a, b) => a.gate_code.localeCompare(b.gate_code));
    }),
    q(/SELECT outcome\s+FROM partner_training_gates\s+WHERE org_id = \$1 AND partner_id = \$2 AND gate_code = \$3/i, (sql, p) =>
      t.partner_training_gates.filter((r) => r.org_id === p[0] && r.partner_id === p[1] && r.gate_code === p[2])
        .sort((a, b) => (/ORDER BY decided_at DESC, id DESC/.test(sql) ? (b.decided_at > a.decided_at ? 1 : -1) : (a.decided_at > b.decided_at ? 1 : -1)))
        .slice(0, 1).map((r) => ({ outcome: r.outcome }))),
    q(/SELECT m\.code\s+FROM training_modules m\s+LEFT JOIN partner_training_progress p/i, (sql, p) =>
      t.training_modules.filter((m) => m.org_id === p[0] && p[2].includes(m.code))
        .filter((m) => !t.partner_training_progress.some((r) => r.module_id === m.id && r.org_id === p[0] && r.partner_id === p[1] && r.status === "complete"))
        .map((m) => ({ code: m.code }))),
    q(/^\s*INSERT INTO partner_training_gates/i, (sql, p) => {
      const row = { id: `g-${t.partner_training_gates.length + 1}`, org_id: p[0], partner_id: p[1], gate_code: p[2], outcome: p[3],
        decided_by_staff_id: p[4], notes: p[5], decided_at: stamp() };
      t.partner_training_gates.push(row);
      return [{ ...row }];
    }),
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

    const done = await post({ ...mod(PARTNER, "m1", "complete") }, asRole("admin"), t);
    assert.equal(done.res.statusCode, 200);
    assert.equal(done.res.body.recorded.status, "complete");
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
