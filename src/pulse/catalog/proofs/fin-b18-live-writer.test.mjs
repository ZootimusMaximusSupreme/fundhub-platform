// Batch 18 live checks: the shape of the registry entries, and the real C-suite task writer run through the
// check (so a change to what the writer saves is seen by the check, not only by a hand-made row).

import { test } from "node:test";
import assert from "node:assert/strict";

import { FIN_B18_CHECKS, FIN_B18_RESULT_CONTRACTS, csuiteSql } from "./fin-b18-display-contracts.mjs";
import { NOW, makeStandIn } from "./fin-b18-sql-kit.mjs";
import { createCsuiteTask } from "../../../ops/csuite-tasks.mjs";

const ORG = "11111111-0000-4000-8000-000000000001";

// ───────────────────────── the registry shape ─────────────────────────

test("every live check is a query contract that is quiet until the first wrong result", () => {
  assert.equal(FIN_B18_RESULT_CONTRACTS.length, 6);
  assert.equal(new Set(FIN_B18_RESULT_CONTRACTS.map((c) => c.control)).size, 6, "one contract per control");
  for (const contract of FIN_B18_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.ok(contract.requirement.length > 40);
    assert.match(contract.sql, /sample_count/);
    assert.match(contract.sql, /bad_count/);
    assert.match(contract.sql, /\$1::uuid/);
    assert.ok(Object.isFrozen(contract));
  }
  // the two Ops & Admin controls judge the same saved tasks, so they share one text
  const ops = FIN_B18_CHECKS.filter((check) => check.surface === "public/app/ops-admin.html");
  assert.equal(ops.length, 2);
  assert.equal(ops[0].sql(), ops[1].sql());
});

test("the stand-in refuses a column the product does not have", () => {
  const db = makeStandIn(["blueprint_decline_steps"]);
  assert.throws(() => db.insert("blueprint_decline_steps", { id: "x", no_such_column: 1 }), /no column no_such_column/);
  assert.throws(() => makeStandIn(["no_such_table"]), /no such table/);
  db.close();
});

// ───────────────────────── the real writer, through the check ─────────────────────────

/**
 * A database stub that runs the real task writer's two statements over the stand-in: the dedupe lookup
 * and the INSERT (columns and $n values read from the statement itself, so a column the writer starts or
 * stops writing is seen).
 */
function writerOver(standIn) {
  let n = 0;
  return {
    async query(sql, params = []) {
      if (/^\s*SELECT id FROM tasks/i.test(sql)) {
        const rows = standIn.db.prepare("SELECT id FROM tasks WHERE source_workflow = ? AND body = ?").all(params[1], params[2]);
        return { rows };
      }
      const insert = /INSERT INTO tasks\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
      if (!insert) throw new Error(`the writer sent a statement this stub does not know: ${sql.slice(0, 60)}`);
      const columns = insert[1].split(",").map((c) => c.trim());
      const values = insert[2].split(",").map((v) => v.trim());
      const row = { id: `written-${(n += 1)}`, created_at: NOW.toISOString() };
      columns.forEach((column, i) => {
        const token = values[i];
        row[column] = /^\$\d+$/.test(token) ? params[Number(token.slice(1)) - 1] : null;
      });
      standIn.insert("tasks", row);
      return { rows: [{ id: row.id }] };
    },
  };
}

test("C-suite tasks: what the real writer saves passes the check, a replay adds nothing, and moving a task off its desk turns it red", async () => {
  const db = makeStandIn(["tasks", "hiring_job_postings"]);
  try {
    const writer = writerOver(db);
    const made = [];
    for (const kind of ["hire", "diagnose", "ads_review"]) {
      made.push(await createCsuiteTask(writer, { kind, orgId: ORG, now: NOW }));
    }
    assert.deepEqual(made.map((m) => m.created), [true, true, true]);
    assert.deepEqual(db.run(csuiteSql(), ORG), { sample_count: 3, bad_count: 0 }, "the three tasks the brain writes are all well formed");

    // the same day again: the writer says duplicate and saves nothing, so the check still sees three
    const again = await createCsuiteTask(writer, { kind: "hire", orgId: ORG, now: NOW });
    assert.equal(again.created, false);
    assert.deepEqual(db.run(csuiteSql(), ORG), { sample_count: 3, bad_count: 0 });

    // someone (or a bad change) puts the hire task on a different desk: the check goes red
    db.db.prepare("UPDATE tasks SET assignee_role = 'owner' WHERE body LIKE 'hire-closer:packed:%'").run();
    assert.deepEqual(db.run(csuiteSql(), ORG), { sample_count: 3, bad_count: 1 });
  } finally {
    db.close();
  }
});
