// Batch 18 live checks: the shape of the registry entries, and the real C-suite task writer and the real
// closer job post writer run through the check (so a change to what the writers save is seen by the check,
// not only by a hand-made row).

import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

import { FIN_B18_CHECKS, FIN_B18_RESULT_CONTRACTS, csuiteSql } from "./fin-b18-display-contracts.mjs";
import { NOW, makeStandIn, portableSql } from "./fin-b18-sql-kit.mjs";
import { createCsuiteTask } from "../../../ops/csuite-tasks.mjs";
import { actOnPacked } from "../../../ops/hire-closer.mjs";
import { encryptToken } from "../../../adplatforms/tokens.mjs";

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

// ───────────────────────── the real closer job post writer, through the check ─────────────────────────

/**
 * A database stub for the whole hire-closer pass (the calendar read, the task writer, the posting writer
 * and the LinkedIn status write). INSERTs are parsed from the statement itself, so a column the writer
 * starts or stops writing is seen; every other statement is the real text run over the stand-in.
 */
function hireOver(standIn) {
  let n = 0;
  return {
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, " ").trim();
      const insert = /^INSERT INTO (tasks|hiring_job_postings)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(flat);
      if (insert) {
        const [, table, cols, vals] = insert;
        const columns = cols.split(",").map((c) => c.trim());
        const tokens = vals.split(",").map((v) => v.trim());
        const row = { id: `${table}-${(n += 1)}`, created_at: NOW.toISOString() };
        columns.forEach((column, i) => {
          const token = tokens[i];
          if (/^\$\d+$/.test(token)) row[column] = params[Number(token.slice(1)) - 1];
          else if (/^'.*'$/.test(token)) row[column] = token.slice(1, -1);
          else row[column] = null;
        });
        standIn.insert(table, row);
        return { rows: [{ id: row.id, status: row.status ?? null, last_error: row.last_error ?? null }] };
      }
      const text = portableSql(flat.replace(/IS NOT DISTINCT FROM/gi, "IS"));
      return { rows: standIn.db.prepare(text).all(...params) };
    },
  };
}

/** A LinkedIn that answers the one posting call the way the test says. */
const linkedinAnswering = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

async function hirePass({ answer, packed = true }) {
  const keep = process.env.AD_TOKEN_ENC_KEY;
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
  const db = makeStandIn(["tasks", "hiring_job_postings", "hiring_roles", "hiring_channel_connections", "staff"]);
  try {
    db.insert("hiring_roles", { id: "role-closer", org_id: ORG, key: "closer", name: "Closer" });
    db.insert("hiring_channel_connections", {
      id: "conn-1", org_id: ORG, channel: "linkedin", external_account_id: "org-1", connection_state: "active",
      encrypted_access_token: encryptToken(crypto.randomBytes(12).toString("hex"), { partnerId: ORG }),
    });
    // a closer task due on a weekday inside the window, and no closer on staff: the calendar is packed
    if (packed) {
      db.insert("tasks", { id: "closer-1", org_id: ORG, client_id: "c1", assignee_role: "closer", done: false, due_at: "2026-10-15T16:00:00.000Z", source_workflow: "booking", body: "call", created_at: NOW.toISOString() });
    }
    const out = await actOnPacked(hireOver(db), { orgId: ORG, now: NOW, ctx: { fetch: answer } });
    return { out, db, run: () => db.run(csuiteSql(), ORG), rows: (table) => db.db.prepare(`SELECT * FROM ${table}`).all() };
  } catch (error) {
    db.close();
    throw error;
  } finally {
    if (keep === undefined) delete process.env.AD_TOKEN_ENC_KEY; else process.env.AD_TOKEN_ENC_KEY = keep;
  }
}

test("closer job post: the real hire pass writes a task and a posted job that the check finds and passes", async () => {
  const pass = await hirePass({ answer: linkedinAnswering(200, { elements: [{ jobPosting: "urn:li:jobPosting:777" }] }) });
  try {
    assert.equal(pass.out.acted, true);
    assert.equal(pass.out.task.created, true);
    assert.equal(pass.out.linkedin.status, "posted");
    const posts = pass.rows("hiring_job_postings");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].channel, "linkedin", "the writer files the post on the channel the check reads");
    assert.match(posts[0].description, /hire-closer:packed:2026-10/, "the writer carries the marker the check finds the post by");
    assert.equal(posts[0].external_id, "urn:li:jobPosting:777");
    assert.ok(posts[0].posted_at);
    // the task AND the post are both seen, and both are well formed
    assert.deepEqual(pass.run(), { sample_count: 2, bad_count: 0 });
  } finally {
    pass.db.close();
  }
});

test("closer job post: LinkedIn refusing the post is a failed post the check reports", async () => {
  const pass = await hirePass({ answer: linkedinAnswering(500, "service down") });
  try {
    assert.equal(pass.out.linkedin.status, "failed");
    const posts = pass.rows("hiring_job_postings");
    assert.equal(posts[0].status, "failed");
    assert.deepEqual(pass.run(), { sample_count: 2, bad_count: 1 });
  } finally {
    pass.db.close();
  }
});

test("closer job post: LinkedIn saying yes with no posting id leaves a posted job with no outside id, and the check reports it", async () => {
  // postJob stamps 'posted' and COALESCEs the id, so an answer with no id is a posted row with external_id NULL
  const pass = await hirePass({ answer: linkedinAnswering(200, {}) });
  try {
    assert.equal(pass.out.linkedin.status, "posted");
    const posts = pass.rows("hiring_job_postings");
    assert.equal(posts[0].status, "posted");
    assert.equal(posts[0].external_id, null);
    assert.deepEqual(pass.run(), { sample_count: 2, bad_count: 1 });
  } finally {
    pass.db.close();
  }
});

test("closer job post: a calendar that is not packed writes nothing, and the check has nothing to judge", async () => {
  const pass = await hirePass({ answer: linkedinAnswering(200, {}), packed: false });
  try {
    assert.equal(pass.out.acted, false);
    assert.equal(pass.rows("hiring_job_postings").length, 0);
    assert.deepEqual(pass.run(), { sample_count: 0, bad_count: 0 });
  } finally {
    pass.db.close();
  }
});
