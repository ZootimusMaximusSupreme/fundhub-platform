import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { db } from "../../../db.mjs";
import { makeRecipe } from "../door-recipes.mjs";
import { routeKeyForDoor } from "./door-batch-route-result.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const ROUTE_FILES = ["routes-0.json", "routes-1.json", "routes-2.json", "routes-3.json"];

const AUTH_FIRST = new Set([
  "journeys/run", "journeys", "tasks", "inquiry", "dashboard/client", "partner-brand",
  "org-brand", "read/documents", "staff/telemetry", "staff/monitoring-consent",
  "staff/avatar", "read/agent-context", "read/agent-shadow-log", "read/tradelines",
  "company-brain/reviews", "company-brain/sync", "company-brain/threads", "inquiries",
  "repair/exceptions", "pii", "shifts", "bookings", "social/posts", "social/settings",
  "chat/messages", "chat/portal-message", "demo/simulate", "demo/mode", "partner-pages",
  "partner-marketing/enable", "partner-marketing/copy-history", "finance/soft-pull",
  "finance/crs-pull", "banking/revoke", "privacy/erasure", "finance/subscriptions",
  "partner-addons", "finance/cards", "finance/liabilities", "finance/bank-accounts",
  "finance/containers", "finance/entities", "finance/bills", "finance/cashflow",
  "finance/alerts", "finance/model", "consent/capture", "payment-links",
]);

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    finished: false,
    status(code) { this.statusCode = Number(code); return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    json(body) { this.body = body; this.finished = true; return this; },
    send(body) { this.body = body; this.finished = true; return this; },
    end(body) { this.body = body; this.finished = true; return this; },
    redirect(first, second) {
      this.statusCode = typeof first === "number" ? first : 302;
      this.body = typeof first === "number" ? second : first;
      this.finished = true;
      return this;
    },
  };
}

function expectedStatus(key) {
  if (key === "soft-pull-approve") return 400;
  return AUTH_FIRST.has(key) ? 401 : 405;
}

test("Batch 4 refusal context never claims the remaining route business results work", async () => {
  const rows = ROUTE_FILES.flatMap((file) => {
    const mapped = JSON.parse(fs.readFileSync(path.join(MAP, file), "utf8"));
    return mapped
      .filter((row) => makeRecipe(file, row).proof?.evidence.includes("door-batch-route-result.test.mjs"))
      .map((row) => ({ file, row, key: routeKeyForDoor(row) }));
  });

  assert.equal(rows.length, 96);
  for (const { row, file } of rows) {
    const proof = makeRecipe(file, row).proof;
    assert.equal(proof.depth, "e2e");
    assert.equal(proof.verdict, "red");
    assert.match(proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
    assert.match(proof.asserts, /monitor stays red until an intended-method fake-data test judges this named result$/);
    assert.doesNotMatch(proof.asserts, /(?:the API|the route) works|business result is proved/i);
  }
  const targets = [...new Map(rows.map((item) => [item.key, item])).values()];
  assert.equal(targets.length, 81);

  const originalFetch = globalThis.fetch;
  const originalQuery = db.query;
  let fetchCalls = 0;
  let queryCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("route proof blocked outbound network"); };
  db.query = async () => { queryCalls += 1; throw new Error("route proof blocked database access"); };

  try {
    for (const { key } of targets) {
      const handler = ROUTES[key];
      assert.equal(typeof handler, "function", `${key} has no real route handler`);
      const response = responseRecorder();
      await handler({
        method: "TRACE",
        url: `/api/${key}`,
        headers: {},
        query: {},
        body: {},
        rawBody: "",
        socket: { remoteAddress: "127.0.0.1" },
      }, response, {});
      assert.equal(response.finished, true, `${key} returned no result`);
      assert.equal(response.statusCode, expectedStatus(key), `${key} safe refusal changed`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    db.query = originalQuery;
  }

  assert.equal(fetchCalls, 0, "a route tried outbound network during the safe proof");
  assert.equal(queryCalls, 0, "a route tried the database during the safe proof");
});
