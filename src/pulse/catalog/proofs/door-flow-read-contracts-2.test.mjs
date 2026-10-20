import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import entitiesHandler from "../../../../api/finance/entities.mjs";
import {
  fakeDb,
  makeRes,
  ORG_ID,
  req,
  runWithSharedDb,
  staffSession,
} from "../../../testing/handler-harness.mjs";
import generated from "../generated.json" with { type: "json" };
import routes2 from "../../../../ops/workflows/coverage-every-surface-2026-10-10/routes-2.json" with { type: "json" };
import desksA from "../../../../ops/workflows/coverage-every-surface-2026-10-10/desks-a.json" with { type: "json" };
import { READ_GAPS } from "../../coverage/gap-catalog-reads.mjs";
import {
  DOOR_FLOW_READ_DOOR_CONTRACTS,
  DOOR_FLOW_READ_FLOW_CONTRACTS,
  DOOR_FLOW_READ_READ_CONTRACTS,
  doorFlowReadDoorProof,
  doorFlowReadFlowProof,
  doorFlowReadReadProof,
  doorFlowReadRowKey,
} from "./door-flow-read-contracts-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CLIENT_ID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const ENTITY_ID = "e1000000-0000-4000-8000-000000000001";
const ENTITY_ROWS = [
  { id: ENTITY_ID, kind: "business", name: "Acme LLC", archived_at: null, created_at: "2026-10-12T08:00:00.000Z" },
  { id: "e2000000-0000-4000-8000-000000000002", kind: "personal", name: "Personal", archived_at: "2026-10-12T09:00:00.000Z", created_at: "2026-10-11T08:00:00.000Z" },
];

function entitiesDb() {
  return fakeDb([
    staffSession(),
    [/SELECT 1 FROM clients/, [{ "?column?": 1 }]],
    [/INSERT INTO entities/, [{ id: ENTITY_ID }]],
    [/UPDATE entities SET name/, [{ id: ENTITY_ID, client_id: CLIENT_ID }]],
    [/UPDATE entities SET archived_at/, [{ id: ENTITY_ID, client_id: CLIENT_ID }]],
    [/SELECT id, kind, name, archived_at, created_at[\s\S]*FROM entities/, ENTITY_ROWS],
  ]);
}

async function invokeEntity(request) {
  const db = entitiesDb();
  const response = makeRes();
  await runWithSharedDb(db, () => entitiesHandler(request, response));
  return { db, response };
}

function contentType(file) {
  return ({ ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream";
}

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const candidates = relative.endsWith("/")
      ? [path.join(PUBLIC, relative, "index.html")]
      : [path.join(PUBLIC, relative), path.join(PUBLIC, relative, "index.html")];
    const file = candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
    if (!file) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(file) });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("Door, Flow, and Read contracts are exact and proved only by final fake-data results", async (t) => {
  assert.equal(DOOR_FLOW_READ_DOOR_CONTRACTS.length, 1);
  assert.equal(DOOR_FLOW_READ_FLOW_CONTRACTS.length, 0);
  assert.equal(DOOR_FLOW_READ_READ_CONTRACTS.length, 1);
  assert.equal(new Set([
    ...DOOR_FLOW_READ_DOOR_CONTRACTS,
    ...DOOR_FLOW_READ_FLOW_CONTRACTS,
    ...DOOR_FLOW_READ_READ_CONTRACTS,
  ].map((entry) => entry.key)).size, 2);

  for (const [contracts, proofFor] of [
    [DOOR_FLOW_READ_DOOR_CONTRACTS, doorFlowReadDoorProof],
    [DOOR_FLOW_READ_FLOW_CONTRACTS, doorFlowReadFlowProof],
    [DOOR_FLOW_READ_READ_CONTRACTS, doorFlowReadReadProof],
  ]) {
    for (const entry of contracts) {
      assert.equal(entry.key, doorFlowReadRowKey(entry.sourceFile, entry));
      assert.deepEqual(proofFor(entry.sourceFile, entry), entry.proof);
      assert.equal(entry.proof.evidence, "src/pulse/catalog/proofs/door-flow-read-contracts-2.test.mjs");
      assert.equal(entry.proof.asserts, entry.control);
    }
  }

  const door = DOOR_FLOW_READ_DOOR_CONTRACTS[0];
  const doorRow = routes2.find((row) => row.surface === door.surface && row.control === door.control);
  assert.ok(doorRow, "finance entities row is present in the current route map");
  const generatedDoor = generated.items.find((row) => row.id === door.generatedId);
  assert.ok(generatedDoor, "finance entities row is present in the generated catalog");
  assert.equal(generatedDoor.state, "wired");
  assert.equal(generatedDoor.proofDepth, "deep");
  assert.equal(doorFlowReadDoorProof(door.sourceFile, doorRow), door.proof);

  const read = DOOR_FLOW_READ_READ_CONTRACTS[0];
  const readRow = desksA.find((row) => row.surface === read.surface && row.control === read.control);
  assert.ok(readRow, "campaign fatigue row is present in the current read map");
  // The older proof here only judged the fatigue values, so the label control stayed on the red list.
  // The rendered Label button now has its own test (fin-b23-campaign-fatigue-label.test.mjs) and left it.
  assert.equal(READ_GAPS.some((row) => row.surface === read.surface && row.control === read.control), false);
  assert.equal(doorFlowReadReadProof(read.sourceFile, readRow), read.proof);

  const get = await invokeEntity(req("GET", { query: { client_id: CLIENT_ID } }));
  assert.equal(get.response.statusCode, 200);
  assert.deepEqual(get.response.body, { ok: true, client_id: CLIENT_ID, entities: ENTITY_ROWS });
  assert.deepEqual(get.db.find(/FROM entities/)[0].params, [ORG_ID, CLIENT_ID]);

  for (const operation of [
    { action: "create business", resultAction: "create", body: { action: "create", client_id: CLIENT_ID, kind: "business", name: " Acme LLC " }, status: 201, entityId: ENTITY_ID, kind: "business", name: "Acme LLC" },
    { action: "create personal", resultAction: "create", body: { action: "create", client_id: CLIENT_ID, kind: "personal", name: " Personal Wallet " }, status: 201, entityId: ENTITY_ID, kind: "personal", name: "Personal Wallet" },
    { action: "rename", body: { action: "rename", entity_id: ENTITY_ID, name: "Acme Holdings" }, status: 200, entityId: ENTITY_ID },
    { action: "archive", body: { action: "archive", entity_id: ENTITY_ID }, status: 200, entityId: ENTITY_ID },
  ]) {
    const result = await invokeEntity(req("POST", { body: operation.body }));
    assert.equal(result.response.statusCode, operation.status, operation.action);
    assert.deepEqual(result.response.body, {
      ok: true,
      action: operation.resultAction || operation.action,
      entity_id: operation.entityId,
      client_id: CLIENT_ID,
      entities: ENTITY_ROWS,
    });
    if (operation.kind) {
      assert.deepEqual(result.db.find(/INSERT INTO entities/)[0].params, [
        ORG_ID, CLIENT_ID, operation.kind, operation.name,
      ], operation.action);
    }
  }

  const { server, origin } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "proof-token");
    localStorage.setItem("fh_role", "owner");
    localStorage.removeItem("fh_demo");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = { ok: true, items: [], groups: [], pages: [] };
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      body = { ok: true, staff: { id: "proof-owner", name: "Proof Owner", email: "owner@example.test", role: "owner", org_id: "org-proof", status: "active" } };
    } else if (url.pathname === "/api/read/partners") {
      body = { ok: true, items: [{ id: "partner-proof", name: "Proof Partner", slug: "proof" }] };
    } else if (url.pathname === "/api/campaigns/fatigue") {
      body = { ok: true, items: [{
        ad_name: "Hook Exact", ad_id: "ad-123456789", campaign_name: "Proof Campaign", platform: "meta",
        spend_cents: 12345, impressions: 10000, frequency: 3.25, ctr: 1.5, roas: 2.1,
        last_date: "2026-10-12", rotated_at: null, hours_until_next_rotation: 6, recommendation: "refresh",
      }] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/app/campaign-manager.html?partner_id=partner-proof`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#fatRows")?.innerText.includes("Hook Exact"));
  const fatigueRows = page.locator("#fatRows");
  assert.match(await fatigueRows.innerText(), /Hook Exact[\s\S]*Proof Campaign[\s\S]*123\.45[\s\S]*10,000[\s\S]*3\.25[\s\S]*1\.50%[\s\S]*2\.10[\s\S]*refresh/i);
  // Astra removes the legacy uppercase transform, not the recommendation.
  assert.equal(await fatigueRows.locator(".badge.b-alert").innerText(), "refresh");
});
