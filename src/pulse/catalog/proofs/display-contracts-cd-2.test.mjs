import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACTS_CD_2_METADATA,
  DISPLAY_CONTRACTS_CD_2_PROOF_KEYS,
  DISPLAY_CONTRACTS_CD_2_PROOFS,
} from "./display-contracts-cd-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const GENERATED = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const ROWS = Object.freeze({
  connect: "9990cab269a68a9e346f",
});

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES.get(path.extname(file)) || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function contextFor(browser, api) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("fh_role", "owner");
    localStorage.setItem("fh_token", "cd2-fake-token");
  });
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  await context.route("**/api/**", api);
  return context;
}

test("Display CD2 exports one exact catalog row and import-ready metadata", () => {
  assert.equal(DISPLAY_CONTRACTS_CD_2_PROOFS.length, 1);
  assert.equal(DISPLAY_CONTRACTS_CD_2_PROOF_KEYS.length, 1);
  assert.equal(new Set(DISPLAY_CONTRACTS_CD_2_PROOF_KEYS).size, 1);
  assert.equal(DISPLAY_CONTRACTS_CD_2_METADATA.provedCount, 1);
  assert.equal(DISPLAY_CONTRACTS_CD_2_METADATA.baselineRedCount, 382);
  assert.equal(DISPLAY_CONTRACTS_CD_2_METADATA.honestLeftoverCount, 381);

  for (const proof of DISPLAY_CONTRACTS_CD_2_PROOFS) {
    assert.equal(["desks-c.json", "desks-d.json"].includes(proof.sourceFile), true);
    assert.equal(proof.key, `${proof.sourceFile}\0${proof.surface}\0${proof.control}`);
    assert.deepEqual(proof.tests, [DISPLAY_CONTRACTS_CD_2_METADATA.test]);
    assert.equal(proof.evidence, DISPLAY_CONTRACTS_CD_2_METADATA.test);
    assert.equal(proof.proof.runner, "local Chromium with controlled fake API routes");
    const matches = GENERATED.items.filter((row) => row.id === proof.rowId);
    assert.equal(matches.length, 1, `${proof.rowId}: catalog row must be unique`);
    const [row] = matches;
    assert.equal(row.state, "wired", `${proof.rowId}: integrated proof must be wired`);
    assert.equal(row.proofDepth, "deep");
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.proofAsserts, proof.control);
  }
});

test("rendered provider actions show their exact fake results", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  const prove = (id) => {
    assert.equal(exercised.has(id), false, `${id}: duplicate proof`);
    exercised.add(id);
  };
  t.after(async () => {
    await browser.close();
    await stopServer(server);
  });

  let connections = [];
  const posts = [];
  const connectionContext = await contextFor(browser, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/money/connections") return json(route, { ok: true });
    if (request.method() === "GET") {
      return json(route, {
        ok: true,
        containers: [{ id: "fake-business", name: "Test Business LLC", kind: "business" }],
        connections,
        summary: { totals: [], containers: [] },
        open_api_url: "https://fake.example.test/merchant/events",
      });
    }
    const body = request.postDataJSON();
    posts.push(body);
    const connection = {
      id: `fake-${body.provider}`,
      provider: body.provider,
      provider_label: body.provider === "api" ? "Open API" : body.provider === "commas" ? "Commas" : "Whop",
      entity_name: "Test Business LLC",
      status: "active",
      mode: body.mode || "push",
      has_api_key: false,
      has_secret: false,
      event_count: 0,
    };
    connections = [...connections, connection];
    return json(route, {
      ok: true,
      connection,
      ...(body.provider === "api" ? { api_key: "fake-once-only-key" } : {}),
    }, 201);
  });
  const page = await connectionContext.newPage();
  await page.goto(`${origin}/app/money-connections.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-provider="commas"] [data-act="create"]').waitFor({ state: "visible" });

  for (const provider of ["commas", "whop", "api"]) {
    const card = page.locator(`[data-provider="${provider}"]`);
    if (provider !== "api") await card.locator(`[data-mode="${provider}"]`).selectOption("push");
    await card.locator('[data-act="create"]').click();
    await page.locator(`.conn[data-conn="fake-${provider}"]`).waitFor({ state: "visible" });
    assert.equal(await card.locator(".prov-head .state").innerText(), "Connected");
  }
  assert.deepEqual(posts, [
    { action: "create", provider: "commas", entity_id: "fake-business", mode: "push" },
    { action: "create", provider: "whop", entity_id: "fake-business", mode: "push" },
    { action: "create", provider: "api", entity_id: "fake-business" },
  ]);
  assert.equal(await page.getByText("Your key — shown this one time", { exact: true }).count(), 1);
  assert.equal(await page.getByText("fake-once-only-key", { exact: true }).count(), 1);
  prove(ROWS.connect);

  assert.deepEqual([...exercised], [ROWS.connect]);
  await connectionContext.close();
});
