import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import rb2bWebhook from "../../../../api/public/rb2b-webhook.mjs";
import { makeRecipe } from "../door-recipes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

test("the exact route batch owns only the result path it fully proves", () => {
  const cases = [
    ["routes-1.json", "route:public/rb2b-webhook"],
  ];
  for (const [sourceFile, surface] of cases) {
    const rows = JSON.parse(fs.readFileSync(path.join(MAP, sourceFile), "utf8"));
    const row = rows.find((item) => item.surface === surface && makeRecipe(sourceFile, item).proof?.evidence.includes("door-batch-route-exact.test.mjs"));
    assert.ok(row, surface);
    const proof = makeRecipe(sourceFile, row).proof;
    assert.equal(proof.verdict, undefined);
    assert.equal(proof.asserts, row.control);
  }
});

test("the RB2B route stores one fake visitor event and sends nothing", async () => {
  const captured = [];
  const db = {
    async query(sql, params) {
      assert.match(String(sql), /FROM events/);
      assert.equal(params[1], "rb2b:door.proof@example.test");
      return { rows: [] };
    },
  };
  const response = responseRecorder();
  await rb2bWebhook({
    method: "POST",
    query: { secret: "fake-rb2b-secret" },
    body: {
      "Business Email": "door.proof@example.test",
      "First Name": "Door",
      "Last Name": "Proof",
      "Captured URL": "https://fundhub.ai/start",
    },
  }, response, {
    db,
    secret: "fake-rb2b-secret",
    orgId: "00000000-0000-4000-8000-000000000201",
    emit: async (_db, eventName, payload, options) => {
      captured.push({ eventName, payload, options });
      return { id: "event-1" };
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, saved: true, updated: false });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].eventName, "rb2b.visitor_identified");
  assert.equal(captured[0].payload.email, "door.proof@example.test");
  assert.equal(captured[0].options.idempotencyKey, "rb2b:door.proof@example.test");
});
