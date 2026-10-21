import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPipelineMotion, readPipelineMotionCounts } from "./pipeline-motion.mjs";

test("pipeline motion: all clear → three PASS rows", async () => {
  const fresh = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      // One real client on the watch who moved two hours ago.
      if (/FROM clients/.test(sql)) return { rows: [{ tags: ["client:funding"], custom_fields: { last_progress_timestamp: fresh } }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const rows = await checkPipelineMotion({ db, orgId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.status === "PASS"));
});

test("pipeline motion: outbound stuck → FAIL on pipeline:outbound", async () => {
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 2 }] };
      if (/FROM clients/.test(sql)) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const rows = await checkPipelineMotion({ db, orgId: "11111111-1111-4111-8111-111111111111" });
  const out = rows.find((r) => r.id === "pipeline:outbound");
  assert.equal(out.status, "FAIL");
  assert.match(out.detail, /2 outbound/);
});

test("readPipelineMotionCounts counts stalled clients via DPC-05 rules", async () => {
  const old = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) {
        return {
          rows: [{
            tags: ["client:funding"],
            custom_fields: { last_progress_timestamp: old }
          }]
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const n = await readPipelineMotionCounts(db, { orgId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(n.client_stalled, 1);
});

/* Owner fact 2026-10-20: every funding client today is test data. A demo client never raises a red,
   and with no real client on the watch the row is "nothing to judge" with a reason the audit re-checks. */
test("pipeline motion: only real clients are read for the 72-hour line", async () => {
  let clientSql = "";
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) { clientSql = sql; return { rows: [] }; }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  await readPipelineMotionCounts(db, { orgId: "11111111-1111-4111-8111-111111111111" });
  assert.match(clientSql, /COALESCE\(is_demo, false\) = false/);
});

test("pipeline motion: no real client on the watch → pipeline:clients is nothing to judge, with a checkable reason", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const rows = await checkPipelineMotion({ db, orgId: org });
  const clients = rows.find((r) => r.id === "pipeline:clients");
  assert.equal(clients.status, "na");
  assert.deepEqual(clients.na, { code: "no-real-client-on-watch", args: { orgId: org } });
  assert.equal(rows.find((r) => r.id === "pipeline:repair").status, "PASS");
  assert.equal(rows.find((r) => r.id === "pipeline:outbound").status, "PASS");
});

test("pipeline motion: a REAL client with no progress in 72+ hours → FAIL on pipeline:clients", async () => {
  const old = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) return { rows: [{ tags: ["client:funding"], custom_fields: { last_progress_timestamp: old } }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const rows = await checkPipelineMotion({ db, orgId: "11111111-1111-4111-8111-111111111111" });
  const clients = rows.find((r) => r.id === "pipeline:clients");
  assert.equal(clients.status, "FAIL");
  assert.match(clients.detail, /1 paying client with no progress in 72\+ hours/);
  assert.equal(clients.na, undefined);
});
