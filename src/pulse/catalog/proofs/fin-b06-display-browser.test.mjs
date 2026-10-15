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
// TWO rows on purpose. With one row every button sends the same id, so a button that sent the wrong row's id
// (the first row, the last row, a stale closure) could not be told apart from a right one.

const TODO_B = "d2000000-0000-4000-8000-000000000002";

test("bank list state buttons send THEIR OWN row's todo id and state, then show what the server holds", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  let todos = [
    { id: TODO, bank_key: "us bank", account_kind: "personal", state: "open", notes: null },
    { id: TODO_B, bank_key: "chase", account_kind: "business", state: "open", notes: null }
  ];
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
  await list.getByText("chase").waitFor({ timeout: 30_000 });
  const updates = () => sent.filter((body) => body.action === "update_bank_todo_state");
  const acts = (index) => page.locator("#bp-todos .bp-todo-acts").nth(index);
  const saysFor = (bank, word) => new RegExp(`${bank} · \\w+\\s*${word}`, "i");

  // Each open row offers Done and Skipped.
  assert.deepEqual(await acts(0).locator("button").allInnerTexts(), ["Done", "Skipped"]);
  assert.deepEqual(await acts(1).locator("button").allInnerTexts(), ["Done", "Skipped"]);

  // The SECOND row's Done sends the second row's id, and the first row is left alone.
  await acts(1).getByRole("button", { name: "Done" }).click();
  await acts(1).getByRole("button", { name: "Put back on the list" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO_B, state: "done" });
  assert.match(await list.innerText(), saysFor("chase", "done"));
  assert.match(await list.innerText(), saysFor("us bank", "open"));
  assert.deepEqual(await acts(0).locator("button").allInnerTexts(), ["Done", "Skipped"]);

  // The FIRST row's Skipped sends the first row's id.
  await acts(0).getByRole("button", { name: "Skipped" }).click();
  await acts(0).getByRole("button", { name: "Put back on the list" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO, state: "skipped" });
  assert.match(await list.innerText(), saysFor("us bank", "skipped"));
  assert.match(await list.innerText(), saysFor("chase", "done"));

  // A closed row offers the way back, and it is that row's way back.
  await acts(1).getByRole("button", { name: "Put back on the list" }).click();
  await acts(1).getByRole("button", { name: "Skipped" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO_B, state: "open" });
  assert.match(await list.innerText(), saysFor("us bank", "skipped"));
  assert.equal(updates().length, 3);

  // A refused change leaves the buttons usable and the old state on screen.
  refuse = true;
  await acts(0).getByRole("button", { name: "Put back on the list" }).click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("#bp-todos button")];
    return buttons.length > 0 && buttons.every((button) => !button.disabled);
  }, null, { timeout: 10_000 });
  assert.match(await list.innerText(), saysFor("us bank", "skipped"));
  assert.deepEqual(updates().at(-1), { action: "update_bank_todo_state", client_id: CLIENT, todo_id: TODO, state: "open" });
  assert.equal(updates().length, 4);
});

// ── Client control panel: identity-on-file line, approval link box, Copy link ──────────────────────
// Display only: GET /api/consent/capture hands back { status, identity: { on_file }, approval_link } and the page
// paints from it. Nothing is saved by this control, so the page itself is what is judged, with a fake API.

const APPROVAL_URL = "http://127.0.0.1/app/soft-pull-approve.html?org=o1&client=c1&exp=1&sig=fake";

async function openIdentityLines(lab, answer) {
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/consent/capture" && request.method() === "GET") return answer;
      return undefined;
    }
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: lab.origin });
  await page.goto(`${lab.origin}/app/client-control-panel.html?client_id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator("#ccp-consent-state", { hasText: /Consent is on file|No consent|took their permission|run out|later date/ }).waitFor({ timeout: 30_000 });
  return page;
}

test("identity on file says so, and offers no approval link", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openIdentityLines(lab, {
    ok: true, kind: "soft_pull_consent", status: { valid: true }, history: [],
    identity: { on_file: true }, approval_link: { url: APPROVAL_URL, expires_at: "2099-01-01T00:00:00Z" }
  });
  const line = page.locator("#ccp-identity-state");
  await line.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await line.innerText()).trim(), "Identity is on file for this client.");
  assert.match(await line.getAttribute("class"), /\bis-ok\b/);
  assert.doesNotMatch(await line.getAttribute("class"), /is-blocked/);
  assert.equal(await page.locator("#ccp-approve").isHidden(), true, "nothing is missing, so no link is offered");
});

test("a missing identity is said plainly, with the client's approval link in the box and Copy link puts it on the clipboard", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openIdentityLines(lab, {
    ok: true, kind: "soft_pull_consent", status: { valid: true }, history: [],
    identity: { on_file: false }, approval_link: { url: APPROVAL_URL, expires_at: "2099-01-01T00:00:00Z" }
  });
  const line = page.locator("#ccp-identity-state");
  await line.waitFor({ state: "visible", timeout: 10_000 });
  assert.match(await line.innerText(), /^No identity on file\./);
  assert.match(await line.getAttribute("class"), /\bis-blocked\b/);
  assert.doesNotMatch(await line.getAttribute("class"), /is-ok/);

  await page.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await page.locator("#ccp-approve-url").inputValue(), APPROVAL_URL);
  assert.equal(await page.locator("#ccp-approve-row").isVisible(), true);
  assert.equal(await page.locator("#ccp-approve-nolink").isHidden(), true);
  assert.match(await page.locator("#ccp-approve-what").innerText(), /enter their own details/);

  await page.locator("#ccp-approve-copy").click();
  await page.locator("#ccp-approve-copy", { hasText: "Copied" }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), APPROVAL_URL);
});

test("when no link could be made the page says why instead of showing an empty box", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openIdentityLines(lab, {
    ok: true, kind: "soft_pull_consent", status: { valid: true }, history: [],
    identity: { on_file: false },
    approval_link: { url: null, expires_at: null, unavailable_reason: "The signing key is not set, so no link can be made." }
  });
  const reason = page.locator("#ccp-approve-nolink");
  await reason.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await reason.innerText()).trim(), "The signing key is not set, so no link can be made.");
  assert.equal(await page.locator("#ccp-approve-row").isHidden(), true, "no box and no Copy link without a link");
});

test("a consent that was taken back hides the identity line and the link", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openIdentityLines(lab, {
    ok: true, kind: "soft_pull_consent", status: { valid: false, reason: "revoked" }, history: [],
    identity: { on_file: false }, approval_link: { url: APPROVAL_URL, expires_at: "2099-01-01T00:00:00Z" }
  });
  assert.equal(await page.locator("#ccp-identity-state").isHidden(), true);
  assert.equal(await page.locator("#ccp-approve").isHidden(), true);
});

// ── Consent screen: the server's words, the version badge, and the status banner ───────────────────
// The wording and the banner are what the server sent, drawn as text, and the page sends back only the version it
// showed, never the words. The saved-result check covers the words and version that were STORED; this covers the
// banner and what the page shows and posts. Fake API, real page.

const SERVER_WORDS = "Words from the server, paragraph one.\n\nWords from the server, paragraph two <b>not markup</b>.";

async function openConsentScreen(lab, { status, posts, kind = "soft_pull_consent" }) {
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname !== "/api/consent/capture") return undefined;
      if (request.method() === "POST") {
        posts.push(post(request));
        return { ok: true, consent: { id: "k1" } };
      }
      return {
        ok: true, kind,
        disclosure: { version: "soft-pull-v2", title: "Soft Pull and Text Message Authorization", text: SERVER_WORDS },
        status, history: []
      };
    }
  });
  await page.goto(`${lab.origin}/app/consent-capture.html?client_id=${CLIENT}&kind=${kind}`, { waitUntil: "domcontentloaded" });
  await page.locator("#ccVersion", { hasText: "soft-pull-v2" }).waitFor({ timeout: 30_000 });
  return page;
}

test("the consent screen shows the server's words as text, names the version, and paints each server status", { timeout: 180_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const states = [
    ["valid", { valid: true, reason: "valid", consent: { expires_at: null } }, "is-valid", "Consent is on file"],
    ["none_on_file", { valid: false, reason: "none_on_file" }, "is-blocked", "No consent on file"],
    ["revoked", { valid: false, reason: "revoked", consent: { revoked_at: "2026-09-01T00:00:00Z", revoked_reason: "Asked to stop" } }, "is-blocked", "Consent was withdrawn"],
    ["expired", { valid: false, reason: "expired", consent: { expires_at: "2026-08-01T00:00:00Z" } }, "is-blocked", "Consent has expired"],
    ["not_yet_effective", { valid: false, reason: "not_yet_effective" }, "is-unknown", "Consent has not started yet"],
    ["something the page does not know", { valid: false, reason: "mystery" }, "is-unknown", "Cannot check"]
  ];
  for (const [label, status, tone, lede] of states) {
    const posts = [];
    const page = await openConsentScreen(lab, { status, posts });
    // The words: exactly what the server sent, drawn as text (the tag in them is not markup).
    assert.equal(await page.locator("#ccDisclosure").textContent(), SERVER_WORDS, label);
    assert.equal(await page.locator("#ccDisclosure b").count(), 0, `${label}: the words are text, never markup`);
    assert.equal((await page.locator("#ccVersion").textContent()).trim(), "soft-pull-v2", label);
    // The banner: the server's reason decides the tone and the words, and the page never works one out itself.
    const banner = page.locator("#ccStatus");
    assert.match(await banner.getAttribute("class"), new RegExp(`\\b${tone}\\b`), label);
    assert.equal((await page.locator("#ccStatusLede").textContent()).trim(), lede, label);
    if (label === "revoked") {
      const detail = await page.locator("#ccStatusDetail").textContent();
      assert.match(detail, /Withdrawn on/);
      assert.match(detail, /Reason given: Asked to stop/);
    }
    await page.close();
  }
});

test("recording a consent posts the version that was shown and never the words", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const posts = [];
  const page = await openConsentScreen(lab, { status: { valid: false, reason: "none_on_file" }, posts });
  await page.locator("#ccName").fill("Pat Lee");
  await page.locator("#ccSubmit").click();
  await page.locator("#ccMsg", { hasText: /Consent recorded/ }).waitFor({ timeout: 10_000 });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], {
    client_id: CLIENT, kind: "soft_pull_consent", action: "grant", capture_method: "typed",
    granted_name: "Pat Lee", consent_version: "soft-pull-v2"
  });
  assert.equal("consent_text" in posts[0], false, "the words are the server's and are never sent back");
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

// ── Client portal: the three upload doors send their own kind and the type that was picked ─────────
// The saved-result checks read what the server stored. They cannot tell a client who picked nothing from a page
// that dropped the choice, nor a bureau-response file that lost its door's kind and fell back to the ID door's.
// This is the half only the page can show: what each door posts. Fake API, real page.

function multipartFields(request) {
  const text = request.postData() || "";
  const out = {};
  for (const hit of text.matchAll(/name="([^"]+)"\r?\n\r?\n([^\r\n]*)\r?\n/g)) out[hit[1]] = hit[2];
  return out;
}

test("each upload door posts its own kind and exactly the type picked, and no type when none was picked", { timeout: 180_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const sent = [];
  const page = await newStaffPage(lab, {
    role: "client",
    staff: { id: CLIENT, client_id: CLIENT },
    api: async (request, url) => {
      if (url.pathname === "/api/documents-upload") {
        sent.push(multipartFields(request));
        return { ok: true, documents: [], docs_missing: null };
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-portal.html?id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator(".upload-door.door-funding").waitFor({ state: "attached", timeout: 30_000 });
  // The lanes decide which doors a client sees (the page sets these on the body). Show all three so each can be
  // driven; the page code that posts is untouched.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.body.classList.remove("no-docs", "no-upload-doors", "no-funding-door", "no-inquiry-door", "no-bureau-door");
  });

  const doors = [
    ["door-funding", "client_upload", "tax_return"],
    ["door-inquiry", "inquiry_doc", "ftc_report"],
    ["door-bureau", "bureau_response", "bureau_letter"]
  ];
  for (const [doorClass, kind, picked] of doors) {
    for (const choice of [picked, ""]) {
      const door = page.locator(`.upload-door.${doorClass}`);
      await door.locator("[data-subtype]").selectOption(choice);
      await door.locator("[data-file-input]").setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 practice") });
      const button = door.locator("[data-upload-btn]");
      await door.locator("[data-upload-btn]", { hasText: /Send 1 file/ }).waitFor({ timeout: 10_000 });
      const before = sent.length;
      await button.click();
      // The button says "Sent" once the reply is back, and the page clears its picked files then, not before.
      await door.locator("[data-upload-btn]", { hasText: /^Sent$/ }).waitFor({ timeout: 10_000 });
      assert.equal(sent.length, before + 1, `${doorClass}: one upload was posted`);
      const fields = sent.at(-1);
      assert.equal(fields.kind, kind, `${doorClass}: the door's own kind`);
      assert.equal(fields.client_id, CLIENT, `${doorClass}: this client`);
      if (choice) assert.equal(fields.subtype, choice, `${doorClass}: the type that was picked`);
      else assert.equal("subtype" in fields, false, `${doorClass}: no type was picked, so none is sent`);
    }
  }
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
