import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACT_KEYS_AB_3,
  DISPLAY_CONTRACT_PROOF_AB_3,
  DISPLAY_CONTRACTS_AB_3,
} from "./display-contracts-ab-3.mjs";
import { DISPLAY_CONTRACT_KEYS_AB } from "./display-contracts-ab.mjs";
import { DISPLAY_CONTRACT_KEYS_AB_2 } from "./display-contracts-ab-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) =>
    candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("Display AB 3 exports only disjoint exact red catalog rows", () => {
  assert.equal(DISPLAY_CONTRACT_PROOF_AB_3.strictProvedCount, 1);
  assert.equal(new Set(DISPLAY_CONTRACT_KEYS_AB_3).size, DISPLAY_CONTRACT_KEYS_AB_3.length);
  assert.deepEqual(DISPLAY_CONTRACT_PROOF_AB_3.sourceFiles, ["desks-b.json"]);
  const previous = new Set([...DISPLAY_CONTRACT_KEYS_AB, ...DISPLAY_CONTRACT_KEYS_AB_2]);
  const byId = new Map(CATALOG.items.map((row) => [row.id, row]));
  for (const proof of DISPLAY_CONTRACTS_AB_3) {
    const row = byId.get(proof.rowKey);
    assert.ok(row, `catalog row is missing: ${proof.rowKey}`);
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.family, proof.family);
    assert.equal(row.expected, proof.expected);
    assert.equal(row.state, "wired", `${proof.rowKey} is not wired after integration`);
    assert.equal(row.proofDepth, "deep");
    assert.equal(previous.has(proof.rowKey), false, `${proof.rowKey} is already in an earlier shard`);
    assert.equal(proof.proof.runner, "rendered-chromium-local-fake-routes");
    assert.equal(proof.proof.file, "src/pulse/catalog/proofs/display-contracts-ab-3.test.mjs");
    assert.ok(proof.proof.assertion.length > 30);
  }
});

test("Display AB 3 observes the sidebar collapse action in rendered Chromium", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "display-ab-3-fake-token");
    localStorage.setItem("fh_role", "owner");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true,
        staff: { id: "staff-proof", name: "Casey Proof", email: "casey@example.test", role: "owner", org_id: "org-proof", status: "active" },
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [], tasks: [], count: 0 }) });
  });
  await page.goto(`${origin}/app/consent-capture.html`, { waitUntil: "domcontentloaded" });
  const side = page.locator("#side");
  await side.waitFor({ state: "visible" });
  await t.test(DISPLAY_CONTRACT_KEYS_AB_3[0], async () => {
    await page.locator("#burger").click();
    assert.equal(await side.evaluate((node) => node.classList.contains("mini")), true);
    assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("fh-side-mini")), true);
    await page.locator("#burger").click();
    assert.equal(await side.evaluate((node) => node.classList.contains("mini")), false);
    assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("fh-side-mini")), false);
  });
});
