import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { CONTRACT } from "../../../marketing/api-contract.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS } from "./display-contracts-ef-public.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS } from "./display-contracts-ef-public-2.mjs";
import {
  DISPLAY_CONTRACTS_EF_PUBLIC_3_METADATA,
  DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES,
  DISPLAY_CONTRACTS_EF_PUBLIC_3_ROW_KEYS,
} from "./display-contracts-ef-public-3.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"]]);
const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean
    ? [path.join(PUBLIC, "index.html")]
    : clean.endsWith("/")
      ? [path.join(PUBLIC, clean, "index.html")]
      : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": `${TYPES.get(path.extname(file)) || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("Display EF/Public wave 3 proves the exported row through rendered mirror and turn actions", { timeout: 60_000 }, async (t) => {
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_3_METADATA.provedCount, 1);
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_3_ROW_KEYS.length, 1);
  assert.equal(new Set(DISPLAY_CONTRACTS_EF_PUBLIC_3_ROW_KEYS).size, 1);
  const previous = new Set([...DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS, ...DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS]);
  for (const proof of DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES) {
    assert.equal(previous.has(proof.key), false, `an earlier shard already exports ${proof.key}`);
  }

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const base = clone(CONTRACT["GET marketing/shoot"].example.response);
  const scripts = base.shoot.scripts.map((script) => ({ ...clone(script), got_it: true }));
  scripts[0] = { ...scripts[0], got_it: false, title: "Proof Script", angle_name: "Proof Script", take_file_name: "Proof Script Take 1.mp4" };
  const shoot = { ...base, shoot: { ...base.shoot, scripts, root_script_ids: scripts.map((script) => script.root_script_id) } };
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "proof-token");
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: true }));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/marketing/shoot") return json(route, shoot);
    if (request.method() === "GET" && pathname === "/api/marketing/health") return json(route, { ok: true, outbox: { held_reason: null, token_present: true } });
    return json(route, { ok: false, error: "unexpected proof request" });
  });

  await page.goto(`${origin}/app/teleprompter.html?k=film-key-proof`);
  await page.waitForFunction(() => document.querySelector("#s-title")?.textContent.includes("Proof Script"));
  const mirror = page.locator("#b-mirror");
  assert.equal(await mirror.isVisible(), true);
  assert.equal(await mirror.innerText(), "Mirror off");
  await mirror.click();
  assert.equal(await mirror.innerText(), "Mirror on");
  assert.equal(await mirror.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#flip").evaluate((element) => getComputedStyle(element).transform), "matrix(-1, 0, 0, 1, 0, 0)");
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.settings"))).mirror, true);

  const turn = page.locator("#b-turn");
  assert.equal(await turn.isVisible(), true);
  for (const angle of [90, 180, 270, 0]) {
    await turn.click();
    assert.equal(compact(await turn.innerText()), `Turn ${angle}`);
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.settings")));
    assert.equal(saved.rot, angle);
    if (angle) assert.match(await page.locator("#flip").evaluate((element) => element.style.transform), new RegExp(`rotate\\(${angle}deg\\)`));
    else assert.equal(await page.locator("#flip").evaluate((element) => element.style.transform), "");
  }

  await page.close();
});
