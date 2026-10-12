import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  PUBLIC_BUTTON_ACTIONS,
  PUBLIC_LINK_ACTIONS,
  PUBLIC_UI_PROOF_CASES,
} from "./display-batch-public-ui.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function boardPayload(view) {
  const notes = {
    rankBasis: "Ranks use duration and advertiser activity.",
    spend: "No competitor spend figures appear here.",
  };
  if (view === "weeks") return { ok: true, items: [] };
  if (view === "saturation") {
    return {
      ok: true,
      view,
      items: [],
      notes,
      meta: {
        angles: [],
        totals: { occupiedCells: 0, totalCells: 480, advertisers: 0, creatives: 0 },
      },
    };
  }
  return { ok: true, view: view || "movers", items: [], notes, meta: {} };
}

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/adintel/board") {
      const body = JSON.stringify(boardPayload(url.searchParams.get("view") || "movers"));
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(body);
      return;
    }
    const file = staticFile(url.pathname);
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
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function publicUrl(origin, file) {
  return `${origin}/${file.replace(/^public\//, "")}`;
}

async function visibleAnchor(page, href, label) {
  const anchors = page.locator("a");
  const indexes = await anchors.evaluateAll((nodes, wanted) => nodes
    .map((node, index) => node.getAttribute("href") === wanted ? index : -1)
    .filter((index) => index >= 0), href);
  assert.ok(indexes.length > 0, `${label}: no anchor has href ${href}`);
  for (const index of indexes) {
    const locator = anchors.nth(index);
    if (await locator.isVisible()) return locator;
  }
  assert.fail(`${label}: href ${href} has no visible control`);
}

test("public display contracts click every mapped control and check its result", async (t) => {
  assert.equal(PUBLIC_UI_PROOF_CASES.length, PUBLIC_LINK_ACTIONS.length + PUBLIC_BUTTON_ACTIONS.length);
  assert.ok(PUBLIC_LINK_ACTIONS.length >= 100, "the shared link contract unexpectedly shrank");

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const linksByPage = Map.groupBy(PUBLIC_LINK_ACTIONS, (entry) => entry.page);
  for (const [file, actions] of linksByPage) {
    const response = await page.goto(publicUrl(origin, file), { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${file}: source page did not load`);
    for (const action of actions) {
      const anchor = await visibleAnchor(page, action.href, action.surface);
      await anchor.evaluate((element) => {
        window.__fundhubDisplayClick = null;
        element.addEventListener("click", (event) => {
          window.__fundhubDisplayClick = { href: element.href, trusted: event.isTrusted };
          event.preventDefault();
          event.stopImmediatePropagation();
        }, { capture: true, once: true });
      });
      await anchor.click();
      const clicked = await page.evaluate(() => window.__fundhubDisplayClick);
      assert.equal(clicked?.trusted, true, `${action.surface}: browser did not perform a real click`);
      assert.equal(clicked?.href, new URL(action.href, page.url()).href, `${action.surface}: wrong destination`);
    }
  }

  for (const action of PUBLIC_BUTTON_ACTIONS.filter((entry) => entry.action === "rerun")) {
    const response = await page.goto(publicUrl(origin, action.page), { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${action.page}: source page did not load`);
    await page.evaluate(() => {
      document.querySelectorAll("#term .tl").forEach((line) => line.classList.remove("on"));
      document.getElementById("cmdtxt").textContent = "";
    });
    await page.locator("#rerun").focus();
    await page.keyboard.press("Enter");
    const result = await page.evaluate(() => ({
      command: document.getElementById("cmdtxt").textContent,
      lines: document.querySelectorAll("#term .tl").length,
      shown: document.querySelectorAll("#term .tl.on").length,
    }));
    assert.equal(result.command, action.expectedCommand, `${action.surface}: command was not replayed`);
    assert.equal(result.shown, result.lines, `${action.surface}: replay did not reveal every line`);
  }

  const boardPage = PUBLIC_BUTTON_ACTIONS.find((entry) => entry.action === "board-tab")?.page;
  const boardResponse = await page.goto(publicUrl(origin, boardPage), { waitUntil: "domcontentloaded" });
  assert.equal(boardResponse?.status(), 200, `${boardPage}: source page did not load`);
  for (const action of PUBLIC_BUTTON_ACTIONS.filter((entry) => entry.action === "board-tab")) {
    const selector = `.tab[data-view="${action.view}"]`;
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      const view = url.searchParams.get("view") || "movers";
      return url.pathname === "/api/adintel/board" && view === action.view;
    });
    await page.locator(selector).click();
    assert.equal((await responsePromise).status(), 200, `${action.surface}: board read failed`);
    await page.waitForFunction((text) => document.body.textContent.includes(text), action.expectedResult);
    assert.equal(await page.locator(selector).getAttribute("aria-selected"), "true", `${action.surface}: tab did not stay selected`);
  }
});
