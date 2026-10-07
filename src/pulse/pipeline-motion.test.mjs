import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPipelineMotion, readPipelineMotionCounts } from "./pipeline-motion.mjs";

test("pipeline motion: all clear → three PASS rows", async () => {
  const db = {
    query: async (sql) => {
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) return { rows: [] };
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
