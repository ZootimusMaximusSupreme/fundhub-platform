import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { compileCatalog } from "../compiler.mjs";
import * as displayRecipes from "../display-recipes.mjs";
import {
  PUBLIC_PAGE_LINK_OUTCOME_CASES,
  PUBLIC_PAGE_LINK_OUTCOME_IDS,
  PUBLIC_PAGE_LINK_OUTCOME_TEST,
} from "./public-page-link-outcomes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const PUBLIC_MAP = JSON.parse(fs.readFileSync(
  path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/public-pages.json"),
  "utf8",
));
const SAVED_CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactLabel(value) {
  return compact(value).replace(/\s+/g, "");
}

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean
    ? [path.join(PUBLIC, "index.html")]
    : clean.endsWith("/")
      ? [path.join(PUBLIC, clean, "index.html")]
      : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => (
    (candidate === PUBLIC || candidate.startsWith(`${PUBLIC}${path.sep}`))
    && fs.existsSync(candidate)
  ));
}

function answerJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/auth/session") return answerJson(res, 401, { ok: false });
    if (url.pathname === "/api/health") return answerJson(res, 200, { ok: true, db: "up" });
    if (url.pathname === "/api/public/slo-checkout" && req.method === "GET") {
      return answerJson(res, 200, { ok: true, priceDisplay: "$297", checkout: { ready: true }, notices: {} });
    }
    if (url.pathname.startsWith("/api/")) return answerJson(res, 404, { ok: false, error: "not_stubbed" });

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
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function visibleAnchorByLabel(page, label) {
  const wanted = compactLabel(label);
  const anchors = page.locator("a");
  for (let index = 0; index < await anchors.count(); index += 1) {
    const anchor = anchors.nth(index);
    if (!await anchor.isVisible()) continue;
    if (compactLabel(await anchor.textContent()).includes(wanted)) return anchor;
  }
  assert.fail(`No visible link says ${label}`);
}

async function prepareSource(page, origin, proof) {
  let resetBody = null;
  if (proof.prepare === "reset-success") {
    await page.route("**/api/auth/reset", async (route) => {
      resetBody = route.request().postDataJSON();
      await fulfillJson(route, { ok: true });
    });
  }
  if (proof.prepare === "build-plan") {
    await page.route("**/api/public/optimize?view=roadmap", async (route) => fulfillJson(route, {
      ok: true,
      source: "sample",
      score: null,
      preapprovalKnown: false,
      accounts: [],
      findings: [],
      rounds: [],
    }));
  }

  await page.goto(`${origin}${proof.sourcePath}`, { waitUntil: "domcontentloaded" });

  if (proof.prepare === "reset-success") {
    await page.locator("#pw1").fill("twelve-chars-plus");
    await page.locator("#pw2").fill("twelve-chars-plus");
    await page.locator("#f").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#okMsg")).display !== "none");
    assert.deepEqual(resetBody, { action: "confirm", token: "one-shot-proof", password: "twelve-chars-plus" });
  }

  if (proof.prepare === "build-plan") {
    await page.locator("#first").fill("Alex");
    await page.locator("#last").fill("Roadmap");
    await page.locator("#email").fill("alex@example.test");
    await page.locator("#goal").selectOption({ index: 1 });
    await page.locator("#intake").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector("#planhead").hidden);
  }
}

async function assertPageDestination(page, proof) {
  const expected = proof.destination;
  const expectedHeading = expected.path === "/login.html" ? "Welcome back." : expected.heading;
  const actual = new URL(page.url());
  assert.equal(actual.pathname, expected.path, `${proof.surface}: destination path`);
  assert.equal(actual.search, expected.search || "", `${proof.surface}: destination query`);
  assert.equal(await page.title(), expected.title, `${proof.surface}: destination title`);
  if (expectedHeading) {
    const headings = (await page.locator("h1:visible").allTextContents()).map(compact);
    assert.equal(headings.includes(expectedHeading), true, `${proof.surface}: destination heading`);
  }
  if (expected.selector) {
    assert.equal(await page.locator(`${expected.selector}:visible`).count(), 1, `${proof.surface}: destination control`);
  }
  if (expected.selectValue) {
    assert.equal(await page.locator("#program").inputValue(), expected.selectValue, `${proof.surface}: selected program`);
  }
}

async function proveLink(page, origin, proof) {
  await prepareSource(page, origin, proof);
  const anchor = await visibleAnchorByLabel(page, proof.label);
  assert.equal(await anchor.getAttribute("href"), proof.href, `${proof.surface}: exact href`);

  if (proof.destination.kind === "external-request") {
    const requests = [];
    await page.route((url) => url.href === proof.href, async (route) => {
      requests.push({ method: route.request().method(), url: route.request().url() });
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<main data-proof-destination="${proof.id}">${proof.href}</main>`,
      });
    }, { times: 1 });

    if (proof.prepare === "smartcredit-consent") {
      await anchor.click();
      await page.waitForTimeout(50);
      assert.equal(requests.length, 0, `${proof.surface}: left before consent`);
      assert.equal(await page.locator("#sc-err").isVisible(), true, `${proof.surface}: missing consent message`);
      await page.locator("#sc-agree").check();
    }

    await Promise.all([
      page.waitForURL((url) => url.href === proof.href),
      anchor.click(),
    ]);
    assert.deepEqual(requests, [{ method: "GET", url: proof.href }], `${proof.surface}: exact external request`);
    assert.equal(await page.locator(`[data-proof-destination="${proof.id}"]`).isVisible(), true, `${proof.surface}: navigation completed`);
    return;
  }

  await Promise.all([
    page.waitForURL((url) => (
      url.pathname === proof.destination.path
      && url.search === (proof.destination.search || "")
    )),
    anchor.click(),
  ]);
  await assertPageDestination(page, proof);
}

async function proveUnsubscribe(page, origin, proof) {
  const calls = [];
  await page.route("**/api/public/unsubscribe**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      body: request.method() === "POST" ? request.postDataJSON() : null,
    });
    await fulfillJson(route, request.method() === "GET"
      ? { ok: true, already_unsubscribed: false }
      : { ok: true });
  });

  await page.goto(`${origin}${proof.sourcePath}`, { waitUntil: "domcontentloaded" });
  await page.locator("#ask").waitFor({ state: "visible" });
  assert.equal(compact(await page.locator("#go").textContent()), "Unsubscribe me");
  await page.locator("#go").click();
  await page.locator("#done-box").waitFor({ state: "visible" });

  const token = { org: "org-proof", client: "client-proof", channel: "email", exp: "1790000000", sig: "signed-proof" };
  assert.deepEqual(calls, [
    { method: "GET", query: token, body: null },
    { method: "POST", query: {}, body: token },
  ]);
  assert.equal(compact(await page.locator("#done-box").textContent()), "Done. You will not get any more of these emails.");
}

function codeFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? codeFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

const INDEXED_MJS = ["src", "api", "netlify", "scripts", "e2e"]
  .flatMap((dir) => codeFiles(path.join(ROOT, dir), dir))
  .filter((file) => file.endsWith(".mjs"));
const MJS_BY_BASE = new Map();
for (const file of INDEXED_MJS) {
  const base = path.basename(file);
  if (!MJS_BY_BASE.has(base)) MJS_BY_BASE.set(base, []);
  MJS_BY_BASE.get(base).push(file);
}

function resolveProof(reference) {
  if (reference.includes("/")) return fs.existsSync(path.join(ROOT, reference)) ? [reference] : [];
  return MJS_BY_BASE.get(reference) || [];
}

const OWNED_ROWS = PUBLIC_PAGE_LINK_OUTCOME_CASES.map((proof) => {
  const matches = PUBLIC_MAP.filter((row) => row.surface === proof.surface && row.control === proof.control);
  assert.equal(matches.length, 1, `${proof.surface}: one exact public map row`);
  return matches[0];
});

function compileOwned(recipeModule = displayRecipes) {
  return compileCatalog(
    [{ sourceFile: "public-pages.json", rows: OWNED_ROWS }],
    [recipeModule],
    { resolve: resolveProof },
  );
}

test("the exact 19 public-page outcomes are saved and compile as deep executable proof", () => {
  assert.equal(PUBLIC_PAGE_LINK_OUTCOME_CASES.length, 19);
  assert.equal(new Set(PUBLIC_PAGE_LINK_OUTCOME_IDS).size, 19);
  assert.equal(new Set(PUBLIC_PAGE_LINK_OUTCOME_CASES.map((proof) => proof.key)).size, 19);
  assert.ok(PUBLIC_PAGE_LINK_OUTCOME_CASES.every((proof) => proof.depth === "deep"));
  assert.ok(PUBLIC_PAGE_LINK_OUTCOME_CASES.every((proof) => proof.evidence.includes(PUBLIC_PAGE_LINK_OUTCOME_TEST)));
  assert.ok(PUBLIC_PAGE_LINK_OUTCOME_CASES.every((proof) => proof.tests.length === 2));

  const ownedIds = new Set(PUBLIC_PAGE_LINK_OUTCOME_IDS);
  const saved = SAVED_CATALOG.items.filter((item) => item.sourceFile === "public-pages.json" && ownedIds.has(item.id));
  assert.equal(saved.length, 19);
  assert.deepEqual(saved.map((item) => item.id).sort(), [...PUBLIC_PAGE_LINK_OUTCOME_IDS].sort());
  for (const item of saved) {
    assert.equal(item.state, "wired", `${item.surface}: saved state`);
    assert.equal(item.proofDepth, "deep", `${item.surface}: saved depth`);
    assert.equal(item.proof.tests.includes(PUBLIC_PAGE_LINK_OUTCOME_TEST), true, `${item.surface}: saved executable test`);
  }

  const compiled = compileOwned();
  assert.equal(compiled.items.length, 19);
  assert.equal(compiled.items.filter((item) => item.state === "red").length, 0);
  assert.deepEqual(compiled.items.map((item) => item.id).sort(), [...PUBLIC_PAGE_LINK_OUTCOME_IDS].sort());
  for (const item of compiled.items) {
    assert.equal(item.proofDepth, "deep", `${item.surface}: depth`);
    assert.equal(item.state, "wired", `${item.surface}: state`);
    assert.equal(item.proof.tests.includes(PUBLIC_PAGE_LINK_OUTCOME_TEST), true, `${item.surface}: executable test`);
    assert.match(item.reason, /Mapped to .* executable proof target/);
  }

  const unsubscribe = compiled.items.find((item) => item.id === "f111bbe076624d4b7dcd");
  assert.equal(unsubscribe.proof.tests.includes("src/http/unsubscribe-public.pg.test.mjs"), true);
  assert.equal(unsubscribe.proof.tests.includes("src/messaging/unsubscribe.test.mjs"), true);
  assert.equal(unsubscribe.proof.lanes.includes("src/pulse/coverage/gap-opt-out.mjs"), true);
});

test("lowering one owned proof back to L2 makes that exact catalog row red", () => {
  const victim = "link:education/index.html -> /education/enroll/?program=credit-mastery";
  const mutatedRecipes = {
    supports: displayRecipes.supports,
    makeRecipe(sourceFile, row) {
      const recipe = displayRecipes.makeRecipe(sourceFile, row);
      if (row.surface !== victim) return recipe;
      return { ...recipe, proof: { ...recipe.proof, depth: "e2e" } };
    },
  };
  const compiled = compileOwned(mutatedRecipes);
  const changed = compiled.items.find((item) => item.surface === victim);
  assert.equal(changed.proofDepth, "e2e");
  assert.equal(changed.state, "red");
  assert.match(changed.reason, /L2, below required level L3/);
  assert.equal(compiled.items.filter((item) => item.state === "wired").length, 18);
});

test("the browser opens every exact link outcome and performs the opt-out button result", { timeout: 120_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const exercised = new Set();
  for (const proof of PUBLIC_PAGE_LINK_OUTCOME_CASES) {
    await t.test(proof.surface, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        if (proof.action === "unsubscribe") await proveUnsubscribe(page, origin, proof);
        else await proveLink(page, origin, proof);
        exercised.add(proof.key);
      } finally {
        await page.close();
      }
    });
  }

  await t.test("mutation: the link proof rejects the right address with the wrong destination page", async () => {
    const proof = PUBLIC_PAGE_LINK_OUTCOME_CASES.find((entry) => entry.id === "a03437e62a8c7683ee39");
    const page = await browser.newPage();
    await page.route(
      (url) => url.href === `${origin}/education/enroll/?program=credit-mastery`,
      (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Wrong page</title><h1>Wrong destination</h1>" }),
      { times: 1 },
    );
    try {
      await assert.rejects(
        proveLink(page, origin, proof),
        /destination title/,
      );
    } finally {
      await page.close();
    }
  });

  assert.equal(exercised.size, 19);
});
