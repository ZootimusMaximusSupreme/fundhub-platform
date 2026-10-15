// Batch 06 practice tests: four screen controls whose saved result cannot be judged by a read, because
// the click leaves no receipt that could be wrong. A real Chromium opens the real page from public/ with a
// fake API (nothing leaves this machine) and judges exactly what the control sends and what the page says.
// These are practice tests with fake data, not live checks.

import assert from "node:assert/strict";
import test from "node:test";

import { openLab, newStaffPage } from "./s5-browser-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-0000000000c1";
const TODO = "d1000000-0000-4000-8000-000000000001";

const post = (request) => JSON.parse(request.postData() || "{}");

// ── Capital Blueprint bank list: Done / Skipped / Put back on the list ─────────────────────────────

test("bank list state buttons send the exact todo id and state, then show what the server holds", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  let todos = [{ id: TODO, bank_key: "us bank", account_kind: "personal", state: "open", notes: null }];
  const sent = [];
  let refuse = false;
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/blueprint/staff-actions") {
        const body = post(request);
        sent.push(body);
        if (body.action === "list_bank_todos") return { ok: true, todos };
        if (body.action === "update_bank_todo_state") {
          if (refuse) return { status: 400, body: { ok: false, error: "invalid_args" } };
          todos = todos.map((row) => (row.id === body.todo_id ? { ...row, state: body.state } : row));
          return { ok: true, todo: { id: body.todo_id, state: body.state } };
        }
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-control-panel.html?client_id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  // The Capital Blueprint group is folded shut by default.
  await page.locator("#bp-group .group-title").click();
  const list = page.locator("#bp-todos");
  await list.getByText("us bank").waitFor({ timeout: 30_000 });
  const updates = () => sent.filter((body) => body.action === "update_bank_todo_state");

  // Open row offers Done and Skipped. Done.
  assert.deepEqual(await list.locator("button").allInnerTexts(), ["Done", "Skipped"]);
  await list.getByRole("button", { name: "Done" }).click();
  await list.getByText("Put back on the list").waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO, state: "done" });
  assert.match(await list.innerText(), /us bank · personal\s*done/i);

  // A closed row offers the way back. Put back, then Skipped.
  await list.getByRole("button", { name: "Put back on the list" }).click();
  await list.getByRole("button", { name: "Skipped" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO, state: "open" });
  await list.getByRole("button", { name: "Skipped" }).click();
  await list.getByText("Put back on the list").waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO, state: "skipped" });
  assert.match(await list.innerText(), /us bank · personal\s*skipped/i);
  assert.equal(updates().length, 3);

  // A refused change leaves the buttons usable and the old state on screen.
  refuse = true;
  await list.getByRole("button", { name: "Put back on the list" }).click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("#bp-todos button")];
    return buttons.length > 0 && buttons.every((button) => !button.disabled);
  }, null, { timeout: 10_000 });
  assert.match(await list.innerText(), /us bank · personal\s*skipped/i);
  assert.equal(updates().length, 4);
});

// ── Client portal: sign to authorize dispute letters ──────────────────────────────────────────────

const WORDS = { version: "dispute-auth-v1", text: "I authorize Fundhub to prepare dispute letters for me." };

async function openSignCard(lab, posts) {
  const page = await newStaffPage(lab, {
    role: "client",
    staff: { id: CLIENT, client_id: CLIENT },
    api: async (request, url) => {
      if (url.pathname === "/api/read/portal-summary") {
        return {
          ok: true, prequal_amount: null, scores: {}, documents: [], inquiry_open: false, soft_pull_complete: true,
          repair_path: false, dispute_consent: true, advisor: null,
          stage: { key: "agreement_signed", before_call: false, soft_pull_complete: true, call_held: true, agreement_signed: true, payment_posted: false }
        };
      }
      if (url.pathname.includes("entitlement")) return { ok: true, items: [{ entitlement_code: "funding-snapshot", active: true }] };
      if (url.pathname === "/api/consent/capture") {
        if (request.method() === "POST") {
          posts.push(post(request));
          return { ok: true, consent: { id: "k1" } };
        }
        return { ok: true, kind: "dispute_authorization", disclosure: WORDS, status: { valid: false }, history: [] };
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-portal.html?id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator("#cpDisclosure", { hasText: WORDS.text }).waitFor({ timeout: 30_000 });
  return page;
}

async function draw(page) {
  const box = await page.locator("#cpSignPad").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 12; i += 1) await page.mouse.move(box.x + 20 + i * 12, box.y + 40 + (i % 2) * 20);
  await page.mouse.up();
}

test("the legal name box is required, is sent exactly as typed, and is cleared after the signature is saved", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const posts = [];
  const page = await openSignCard(lab, posts);

  // An empty name is refused before anything is sent, even with ink on the pad.
  await draw(page);
  await page.locator("#cpSignSubmit").click();
  assert.match(await page.locator("#cpSignMsg").innerText(), /Type your legal name/);
  assert.equal(posts.length, 0);

  // Spaces around the name are trimmed, the words in between are kept, and nothing else is changed.
  await page.locator("#cpSignName").fill("   Patricia Anne Lee-Smith   ");
  await page.locator("#cpSignSubmit").click();
  await page.locator("#cpSignMsg", { hasText: /Signature recorded/ }).waitFor({ timeout: 10_000 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].granted_name, "Patricia Anne Lee-Smith");
  assert.equal(await page.locator("#cpSignName").inputValue(), "");
});

test("the signature pad must have real ink, and a signed pad sends a signature capture for this client and these words", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const posts = [];
  const page = await openSignCard(lab, posts);

  // Name typed, pad empty: refused, nothing sent.
  await page.locator("#cpSignName").fill("Pat Lee");
  await page.locator("#cpSignSubmit").click();
  assert.match(await page.locator("#cpSignMsg").innerText(), /Draw your signature/);
  assert.equal(posts.length, 0);

  // A single tap is not a signature.
  const box = await page.locator("#cpSignPad").boundingBox();
  await page.mouse.click(box.x + 30, box.y + 30);
  await page.locator("#cpSignSubmit").click();
  assert.match(await page.locator("#cpSignMsg").innerText(), /Draw your signature/);
  assert.equal(posts.length, 0);

  // Clear wipes the ink: draw, clear, and the pad is empty again.
  await draw(page);
  await page.locator("#cpSignClear").click();
  await page.locator("#cpSignSubmit").click();
  assert.match(await page.locator("#cpSignMsg").innerText(), /Draw your signature/);
  assert.equal(posts.length, 0);

  // Ink and a name: one grant, signature method, this client, the version the server sent.
  await draw(page);
  await page.locator("#cpSignSubmit").click();
  await page.locator("#cpSignMsg", { hasText: /Signature recorded/ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(posts, [{
    client_id: CLIENT, kind: "dispute_authorization", action: "grant", capture_method: "signature",
    granted_name: "Pat Lee", consent_version: WORDS.version
  }]);
});

// ── Content screen: the Showing / Hidden switch on a locked tile ───────────────────────────────────

test("the Showing/Hidden switch flips on click, Space and Enter, and Save sends each tile's own on flag", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const saved = [];
  const bundle = {
    ok: true,
    tiles: [
      { id: "funding-snapshot", code: "funding-snapshot", name: "Funding Snapshot", copy: "See what you qualify for.", price_cents: 29700, on: true, sort_order: 1 },
      { id: "credit-analysis-report", code: "credit-analysis-report", name: "Credit Analysis", copy: "", price_cents: null, on: false, sort_order: 2 }
    ],
    videos: [], map: {}, products: []
  };
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname !== "/api/content/tiles") return undefined;
      if (request.method() === "POST") {
        saved.push(post(request));
        return { ...bundle, action: "save" };
      }
      return bundle;
    }
  });
  await page.goto(`${lab.origin}/app/content-admin.html`, { waitUntil: "domcontentloaded" });
  const first = page.locator('[data-ed="funding-snapshot"] [data-toggle]');
  const second = page.locator('[data-ed="credit-analysis-report"] [data-toggle]');
  await first.waitFor({ timeout: 30_000 });
  const badge = (code) => page.locator(`[data-ed="${code}"] [data-state]`);

  assert.equal(await first.getAttribute("aria-checked"), "true");
  assert.equal((await badge("funding-snapshot").innerText()).toLowerCase(), "showing");
  assert.equal(await second.getAttribute("aria-checked"), "false");
  assert.equal((await badge("credit-analysis-report").innerText()).toLowerCase(), "hidden");

  await first.click();
  assert.equal(await first.getAttribute("aria-checked"), "false");
  assert.equal((await badge("funding-snapshot").innerText()).toLowerCase(), "hidden");
  await first.focus();
  await page.keyboard.press("Space");
  assert.equal(await first.getAttribute("aria-checked"), "true");
  await page.keyboard.press("Enter");
  assert.equal(await first.getAttribute("aria-checked"), "false");
  // The other tile was never touched.
  assert.equal(await second.getAttribute("aria-checked"), "false");

  await second.click();
  assert.equal(await second.getAttribute("aria-checked"), "true");
  await page.getByRole("button", { name: /save changes/i }).first().click();
  await page.waitForFunction(() => true);
  const deadline = Date.now() + 10_000;
  while (saved.length === 0 && Date.now() < deadline) await page.waitForTimeout(50);
  assert.equal(saved.length, 1);
  const flags = Object.fromEntries(saved[0].tiles.map((tile) => [tile.code, tile.on]));
  assert.deepEqual(flags, { "funding-snapshot": false, "credit-analysis-report": true });
});
