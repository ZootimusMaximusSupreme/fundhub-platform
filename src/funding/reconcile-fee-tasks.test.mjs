import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_FEE_TASK_SOURCE, legacyFeeTaskKey, listLegacyFundedFeeGaps,
  reconcileLegacyFundedFeeTasks
} from "./reconcile-fee-tasks.mjs";
import { run } from "../../scripts/reconcile-funding-fee-tasks.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ROUND_A = "33333333-3333-4333-8333-333333333333";
const ROUND_B = "44444444-4444-4444-8444-444444444444";

function fakeDb() {
  const calls = [];
  const tasks = [];
  const rounds = [
    { id: ROUND_A, org_id: ORG, client_id: CLIENT, round_number: 1 },
    { id: ROUND_B, org_id: ORG, client_id: CLIENT, round_number: 2 }
  ];
  return {
    calls, tasks, rounds,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM funding_rounds fr/.test(sql)) {
        const selected = params[0] ? rounds.filter((row) => params[0].includes(row.id)) : rounds;
        return { rows: selected.map((row) => ({ ...row })) };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const hit = tasks.find((task) => task.client_id === params[0]
          && task.source_workflow === params[1] && task.body === params[2]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [org_id, client_id, title, body, , source_workflow, assignee_role, , , detail] = params;
        if (tasks.some((task) => task.client_id === client_id
          && task.source_workflow === source_workflow && task.body === body)) return { rows: [] };
        const row = { id: `task-${tasks.length + 1}`, org_id, client_id, title, body, source_workflow, assignee_role, detail };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test("legacy fee query uses the confirmed-approval rule and excludes already billed rounds", async () => {
  const db = fakeDb();
  const rows = await listLegacyFundedFeeGaps(db);
  assert.equal(rows.length, 2);
  const sql = db.calls[0].sql;
  assert.match(sql, /fr\.status = 'funded'/);
  assert.match(sql, /fr\.product = 'card_stacking'/);
  assert.match(sql, /a\.status = 'Approved'/);
  assert.match(sql, /a\.approval_excluded_at IS NULL/);
  assert.match(sql, /a\.approved_amount > 0/);
  assert.match(sql, /NOT EXISTS \([\s\S]*FROM invoices i/);
  assert.doesNotMatch(sql, /fr\.funded_amount\s*[><=]/);
});

test("dry-run lists legacy gaps but does not create work or money rows", async () => {
  const db = fakeDb();
  const out = await run(db);
  assert.equal(out.applied, false);
  assert.equal(out.candidateCount, 2);
  assert.equal(out.created, 0);
  assert.equal(db.tasks.length, 0);
  assert.deepEqual(out.rounds.map((row) => row.suffix), [ROUND_A.slice(-8), ROUND_B.slice(-8)]);
  assert.ok(db.calls.every((call) => /^SELECT/.test(call.sql.trim())));
});

test("apply requires an exact reviewed round list before any write", async () => {
  const db = fakeDb();
  await assert.rejects(reconcileLegacyFundedFeeTasks(db, { apply: true }), /explicit funding round IDs/);
  await assert.rejects(run(db, [ROUND_A]), /Round IDs require --apply/);
  await assert.rejects(reconcileLegacyFundedFeeTasks(db, {
    apply: true, roundIds: [ROUND_A, "55555555-5555-4555-8555-555555555555"]
  }), /Candidate mismatch/);
  assert.equal(db.tasks.length, 0);
});

test("two legacy rounds produce separate, idempotent advisor tasks and no invoice", async () => {
  const db = fakeDb();
  const options = { apply: true, roundIds: [ROUND_A, ROUND_B] };
  const first = await reconcileLegacyFundedFeeTasks(db, options);
  const replay = await reconcileLegacyFundedFeeTasks(db, options);
  assert.equal(first.created, 2);
  assert.equal(replay.created, 0);
  assert.equal(db.tasks.length, 2);
  assert.deepEqual(db.tasks.map((task) => task.body), [legacyFeeTaskKey(ROUND_A), legacyFeeTaskKey(ROUND_B)]);
  for (const task of db.tasks) {
    assert.equal(task.source_workflow, LEGACY_FEE_TASK_SOURCE);
    assert.equal(task.assignee_role, "funding_advisor");
    assert.match(task.detail, /Record the real bank approval/);
  }
  assert.ok(db.calls.every((call) => !/INSERT INTO (invoices|messages|events)/.test(call.sql)));
});

test("a round that gains approval after preview gets no stale task", async () => {
  const db = fakeDb();
  let reads = 0;
  const query = db.query.bind(db);
  db.query = (sql, params) => {
    if (/FROM funding_rounds fr/.test(sql) && ++reads === 2) {
      db.rounds.splice(0, 1);
    }
    return query(sql, params);
  };
  const out = await reconcileLegacyFundedFeeTasks(db, { apply: true, roundIds: [ROUND_A] });
  assert.equal(out.created, 0);
  assert.equal(out.outcomes[0].reason, "changed_since_preview");
  assert.equal(db.tasks.length, 0);
});
