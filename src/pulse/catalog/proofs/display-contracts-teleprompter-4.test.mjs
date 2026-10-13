import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { CONTRACT } from "../../../marketing/api-contract.mjs";
import {
  DISPLAY_CONTRACTS_TELEPROMPTER_4,
  DISPLAY_CONTRACTS_TELEPROMPTER_4_KEYS,
  DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA,
} from "./display-contracts-teleprompter-4.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-f.json");
const SURFACE = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";
const TYPES = new Map([[".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml"]]);
const clone = (value) => JSON.parse(JSON.stringify(value));

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean)];
  return candidates.find((candidate) => candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
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

async function waitFor(check, message, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return;
    await delay(20);
  }
  assert.fail(message);
}

function mappedRows() {
  return JSON.parse(fs.readFileSync(MAP, "utf8"));
}

test("Teleprompter 4 exports only its exact mapped deep red rows", () => {
  assert.equal(DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA.provedCount, 2);
  assert.deepEqual(DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA.sourceFiles, ["desks-f.json"]);
  assert.equal(DISPLAY_CONTRACTS_TELEPROMPTER_4_KEYS.length, 2);
  assert.equal(new Set(DISPLAY_CONTRACTS_TELEPROMPTER_4_KEYS).size, 2);
  const rows = mappedRows();
  for (const proof of DISPLAY_CONTRACTS_TELEPROMPTER_4) {
    const matches = rows.filter((row) => row.surface === SURFACE && row.control === proof.control);
    assert.equal(matches.length, 1, `expected one exact desks-f row for ${proof.control}`);
    assert.equal(proof.depth, "deep");
    assert.equal(proof.evidence, DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA.testFile);
    assert.deepEqual(proof.tests, [DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA.testFile]);
    assert.ok(proof.proof.assertion.length > 40);
  }
});

test("Teleprompter 4 observes the paused poll retries its saved mark and edit in rendered Chromium", { timeout: 60_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const shoot = clone(CONTRACT["GET marketing/shoot"].example.response);
  const [script] = shoot.shoot.scripts;
  shoot.shoot.scripts = [{ ...script, got_it: false }];
  shoot.shoot.root_script_ids = [script.root_script_id];
  const mark = {
    request_id: "teleprompter-4-mark-request",
    shoot_id: shoot.shoot.id,
    root_script_id: script.root_script_id,
    mark: "got_it",
  };
  const queuedMark = { path: "marketing/shoot/mark", body: mark };
  const edit = {
    request_id: "teleprompter-4-edit-request",
    id: script.id,
    version: script.version,
    body: "The queued words are saved.",
  };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.install();
  await page.addInitScript(({ markItem, scriptItem, savedEdit }) => {
    localStorage.setItem("fh_token", "teleprompter-4-proof-token");
    localStorage.setItem("fhtp.queue", JSON.stringify([markItem]));
    localStorage.setItem("fhtp.edits", JSON.stringify({
      items: {
        [scriptItem.root_script_id]: {
          root: scriptItem.root_script_id,
          base_id: scriptItem.id,
          base_version: scriptItem.version,
          body: savedEdit.body,
          parts: null,
          edits: 1,
          dirty: false,
          sent: { ...savedEdit, edits: 1 },
          conflict: null,
          failed: null,
          savedBody: scriptItem.body,
          savedParts: scriptItem.parts ?? null,
        },
      },
      savedAt: null,
    }));
  }, { markItem: queuedMark, scriptItem: script, savedEdit: edit });

  const shootGets = [];
  const markPosts = [];
  const editPosts = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/marketing/shoot") {
      shootGets.push({ url: url.pathname + url.search, filmKey: request.headers()["x-shoot-film"] || "" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shoot) });
    }
    if (request.method() === "GET" && url.pathname === "/api/marketing/health") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, outbox: { held_reason: null, token_present: true } }) });
    }
    if (request.method() === "POST" && url.pathname === "/api/marketing/shoot/mark") {
      markPosts.push(JSON.parse(request.postData() || "{}"));
      if (markPosts.length === 1) return route.abort("internetdisconnected");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marks: {} }) });
    }
    if (request.method() === "POST" && url.pathname === "/api/marketing/scripts/edit") {
      editPosts.push(JSON.parse(request.postData() || "{}"));
      if (editPosts.length === 1) return route.abort("internetdisconnected");
      const updated = { ...script, id: "00000000-0000-4000-8000-000000000499", version: Number(script.version) + 1, body: edit.body };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ script: updated, warnings: [] }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected proof request" }) });
  });

  await page.goto(`${origin}/app/teleprompter.html?k=film-key-proof`);
  await page.locator("#content .w").first().waitFor({ state: "visible" });
  await waitFor(
    () => shootGets.length === 1 && markPosts.length === 1 && editPosts.length === 1,
    `initial read and failed queued requests did not finish (shoot ${shootGets.length}, mark ${markPosts.length}, edit ${editPosts.length})`,
  );
  assert.equal(await page.locator("#play").innerText(), "Play", "the reader remains paused before the poll");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.queue"))), [queuedMark]);
  assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.edits"))).items[script.root_script_id]);

  await page.clock.fastForward(5000);
  await page.waitForFunction(() => {
    const marks = JSON.parse(localStorage.getItem("fhtp.queue") || "[]");
    const edits = JSON.parse(localStorage.getItem("fhtp.edits") || "{}");
    return marks.length === 0 && Object.keys(edits.items || {}).length === 0;
  });
  await waitFor(() => shootGets.length === 2 && markPosts.length === 2 && editPosts.length === 2, "the five-second poll did not read and flush both saved items");
  assert.deepEqual(shootGets, [
    { url: "/api/marketing/shoot?wpm=150", filmKey: "film-key-proof" },
    { url: "/api/marketing/shoot?wpm=150", filmKey: "film-key-proof" },
  ]);
  assert.deepEqual(markPosts, [mark, mark], "the same saved mark is retried once");
  assert.deepEqual(editPosts, [edit, edit], "the same saved edit is retried once");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.queue"))), []);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.edits"))).items, {});
  assert.equal(await page.locator("#play").innerText(), "Play", "the poll leaves the teleprompter paused");
  await page.close();
});

test("Teleprompter 4 retries full screen after a real first pointer action", { timeout: 60_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const shoot = clone(CONTRACT["GET marketing/shoot"].example.response);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "teleprompter-4-proof-token");
    window.__fullscreenCalls = [];
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: function (options) {
      window.__fullscreenCalls.push({ element: this === document.documentElement, options: options || null });
      if (window.__fullscreenCalls.length === 1) return Promise.reject(new Error("not allowed before a user action"));
      return Promise.resolve();
    } });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/api/marketing/shoot") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shoot) });
    }
    if (route.request().method() === "GET" && url.pathname === "/api/marketing/health") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, outbox: { held_reason: null, token_present: true } }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${origin}/app/teleprompter.html`);
  await page.locator("#wpm-up").waitFor({ state: "visible" });
  await waitFor(() => page.evaluate(() => window.__fullscreenCalls.length === 1), "the page-load full-screen attempt was not observed");
  assert.deepEqual(await page.evaluate(() => window.__fullscreenCalls), [
    { element: true, options: { navigationUI: "hide" } },
  ]);
  await page.locator("#wpm-up").click();
  assert.match(await page.locator("#s-time").innerText(), /155 wpm/, "the real speed control also changes the displayed pace");
  assert.deepEqual(await page.evaluate(() => window.__fullscreenCalls), [
    { element: true, options: { navigationUI: "hide" } },
    { element: true, options: { navigationUI: "hide" } },
  ]);
  await page.close();
});
