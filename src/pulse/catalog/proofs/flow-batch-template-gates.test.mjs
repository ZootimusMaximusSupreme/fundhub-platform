import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { clearRuleCache } from "../../../compliance/screen.mjs";
import { dispatchOne, OUTCOME } from "../../../messaging/dispatch.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MESSAGE_MAP = new URL(
  "ops/workflows/coverage-every-surface-2026-10-10/messages.json",
  ROOT,
);
const ORG = "10000000-0000-4000-8000-000000000101";
const MIDDAY = () => new Date("2026-10-11T17:00:00Z");

function templateRows() {
  return JSON.parse(fs.readFileSync(MESSAGE_MAP, "utf8"))
    .filter((row) => row.surface.startsWith("template:"));
}

function blockedDb() {
  const updates = [];
  return {
    updates,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM compliance_rules")) return { rows: [] };
      if (text.includes("UPDATE messages")) {
        updates.push({ sql: text, params });
        return { rows: [] };
      }
      throw new Error(`unexpected template-gate query: ${text.slice(0, 120)}`);
    },
  };
}

test("every catalog template reaches the real gate and records a final blocked outcome", async () => {
  clearRuleCache();
  const rows = templateRows();
  const db = blockedDb();
  let networkCalls = 0;

  assert.equal(rows.length, 332, "the batch must grow when a template is added");

  for (const [index, row] of rows.entries()) {
    const key = row.surface.slice("template:".length);
    const channel = row.control.startsWith("sms template") ? "sms" : "email";
    const message = {
      id: `10000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
      org_id: ORG,
      client_id: null,
      channel,
      rendered_body: `Fake-data proof for ${key}`,
      template_key: key,
      provider_ref: `flow-proof:${index}`,
      attempts: 1,
      to_address: null,
      subject: channel === "email" ? "Fake-data proof" : null,
    };

    const result = await dispatchOne(db, message, {
      env: {},
      now: MIDDAY,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("a blocked template must not reach a provider");
      },
    });

    assert.equal(result.outcome, OUTCOME.BLOCKED, row.surface);
    assert.deepEqual(result.detail, ["recipient_unknown"], row.surface);
  }

  const blocked = db.updates.filter((entry) => (
    entry.sql.includes("status = 'blocked'")
    && entry.params[1] === "recipient_unknown"
  ));
  assert.equal(blocked.length, rows.length);
  assert.equal(networkCalls, 0);
  assert.equal(
    db.updates.some((entry) => entry.sql.includes("provider_message_id")),
    false,
    "no blocked template may record a provider delivery",
  );
});
