// Batch 06, repair cycle 2: practice tests of the page for the controls whose saved result cannot show what the
// page sent or said. A real Chromium opens the real page from public/ with a fake API (nothing leaves this
// machine) and judges exactly what each control posts and what the page says back.
// These are practice tests with fake data, not live checks. Each one sits next to a live check on the same row
// (fin-b06-display-contracts.mjs) that judges what was saved; this is the half a saved row cannot show.

import assert from "node:assert/strict";
import test from "node:test";

import { openLab, newStaffPage } from "./s5-browser-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-0000000000c1";
const post = (request) => JSON.parse(request.postData() || "{}");

// ── Client control panel: the identity line, the approval link box, the three sentences, the expiry line ────
// GET /api/consent/capture hands back { status, identity: { on_file } | null, approval_link } and the page works
// out two things from it: whether the box is offered, and which of three sentences says why. The earlier tests
// (fin-b06-display-browser.test.mjs) drive identity missing with a valid consent, a revoked consent and no link.
// These drive the rest: consent missing, both missing, identity unknown (the read failed, which is "not asked"),
// the expiry line and the clipboard being refused.

const APPROVAL_URL = "http://127.0.0.1/app/soft-pull-approve.html?org=o1&client=c1&exp=1&sig=fake";
const WHY = {
  consent: "Send this link to the client. They read the authorization and agree to it themselves.",
  identity: "Send this link to the client. They enter their own details on it, including the Social Security number, which never reaches this screen.",
  both: "Send this link to the client. They agree to the pull and enter their own details on it."
};

async function openHandoff(lab, answer, { clipboard = null } = {}) {
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/consent/capture" && request.method() === "GET") return answer;
      return undefined;
    }
  });
  if (clipboard) await page.addInitScript(clipboard);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: lab.origin });
  await page.goto(`${lab.origin}/app/client-control-panel.html?client_id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator("#ccp-consent-state", { hasText: /Consent is on file|No consent|took their permission|run out|later date/ }).waitFor({ timeout: 30_000 });
  return page;
}

const consentAnswer = (status, identity, link = { url: APPROVAL_URL, expires_at: "2099-01-01T22:42:00Z" }) => ({
  ok: true, kind: "soft_pull_consent", status, history: [], identity, approval_link: link
});

test("with consent missing and identity on file the box is offered, with the consent sentence and the link", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openHandoff(lab, consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: true }));
  await page.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await page.locator("#ccp-approve-what").innerText()).trim(), WHY.consent);
  assert.equal(await page.locator("#ccp-approve-url").inputValue(), APPROVAL_URL);
  assert.equal(await page.locator("#ccp-approve-row").isVisible(), true);
  // The identity line is true too: identity IS on file, and the page says so beside the missing consent.
  assert.equal((await page.locator("#ccp-identity-state").innerText()).trim(), "Identity is on file for this client.");
});

test("with consent AND identity missing the box is offered with the sentence for both", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openHandoff(lab, consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: false }));
  await page.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await page.locator("#ccp-approve-what").innerText()).trim(), WHY.both);
  assert.match(await page.locator("#ccp-identity-state").innerText(), /^No identity on file\./);
});

test("with identity missing and consent valid the box says the identity sentence, not the consent one", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openHandoff(lab, consentAnswer({ valid: true }, { on_file: false }));
  await page.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await page.locator("#ccp-approve-what").innerText()).trim(), WHY.identity);
});

test("an identity the server did not answer is 'not asked': no line, and no link is offered for it", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  // Consent valid and identity unknown: nothing is missing as far as anybody knows, so no link is offered.
  const valid = await openHandoff(lab, consentAnswer({ valid: true }, null));
  assert.equal(await valid.locator("#ccp-identity-state").isHidden(), true, "an unknown identity paints no line");
  assert.equal(await valid.locator("#ccp-approve").isHidden(), true, "an unknown identity is not a missing one");
  await valid.close();
  // Consent missing and identity unknown: the link is offered for the consent only, with the consent sentence.
  const missing = await openHandoff(lab, consentAnswer({ valid: false, reason: "none_on_file" }, null));
  await missing.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await missing.locator("#ccp-approve-what").innerText()).trim(), WHY.consent);
  assert.equal(await missing.locator("#ccp-identity-state").isHidden(), true);
});

test("the expiry line names the clock time the link stops, and is empty when there is no expiry", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  // 22:42 UTC is 3:42 PM in Phoenix, the clock the closer reads.
  const withExpiry = await openHandoff(lab, consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: false }));
  await withExpiry.locator("#ccp-approve-exp").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await withExpiry.locator("#ccp-approve-exp").innerText()).trim(),
    "This link stops working at 3:42 PM. Reload this screen for a fresh one.");
  await withExpiry.close();
  const noExpiry = await openHandoff(lab, consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: false },
    { url: APPROVAL_URL, expires_at: null }));
  await noExpiry.locator("#ccp-approve").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await noExpiry.locator("#ccp-approve-exp").isHidden(), true);
});

test("when the browser refuses the clipboard, Copy link selects the box and says to press Ctrl+C", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openHandoff(
    lab,
    consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: false }),
    { clipboard: () => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("refused")) }, configurable: true }); } }
  );
  await page.locator("#ccp-approve-copy").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#ccp-approve-copy").click();
  await page.locator("#ccp-approve-copy", { hasText: "Press Ctrl+C" }).waitFor({ timeout: 10_000 });
  // The box is selected, so the closer can copy the link by hand.
  const selected = await page.evaluate(() => {
    const box = document.getElementById("ccp-approve-url");
    return { focused: document.activeElement === box, text: box.value.slice(box.selectionStart, box.selectionEnd) };
  });
  assert.equal(selected.focused, true);
  assert.equal(selected.text, APPROVAL_URL);
  // And it goes back to "Copy link" by itself.
  await page.locator("#ccp-approve-copy", { hasText: "Copy link" }).waitFor({ timeout: 10_000 });
});

test("a browser with no clipboard at all gets the same fallback", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openHandoff(
    lab,
    consentAnswer({ valid: false, reason: "none_on_file" }, { on_file: false }),
    { clipboard: () => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); } }
  );
  await page.locator("#ccp-approve-copy").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#ccp-approve-copy").click();
  await page.locator("#ccp-approve-copy", { hasText: "Press Ctrl+C" }).waitFor({ timeout: 10_000 });
});

// ── Capital Blueprint buttons: Save ready date, Offer bank tracker, Take the offer back, Add bank ────────
// Each saves through POST /api/blueprint/staff-actions. The saved flag or row cannot show WHICH button wrote it,
// nor what the page read out of its boxes, so the page is what is judged: the action each button posts, the value
// it takes from its box, and the sentence it says back. The data half (a paying buyer, a real day, the sweep task,
// the offer gate) is the live check on each row.

async function openBlueprint(lab, { custom = {}, respond = null } = {}) {
  const sent = [];
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/dashboard/client") {
        return { ok: true, client: { id: CLIENT, first_name: "Pat", last_name: "Lee", email: "pat@example.test", custom_fields: custom }, transactions: [], tasks: [], messages: [], crs_results: [] };
      }
      if (url.pathname === "/api/blueprint/staff-actions" && request.method() === "POST") {
        const body = post(request);
        sent.push(body);
        if (body.action === "list_bank_todos") return { ok: true, todos: [] };
        if (respond) {
          const answer = respond(body);
          if (answer !== undefined) return answer;
        }
        return { ok: true };
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-control-panel.html?client_id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator("#bp-group .group-title").click();
  await page.locator("#bp-body").waitFor({ state: "visible", timeout: 30_000 });
  return { page, sent, actions: (name) => sent.filter((body) => body.action === name) };
}

test("Save ready date posts the day typed in the box, says what was saved, and refuses an empty box", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, sent, actions } = await openBlueprint(lab, {
    respond: (body) => (body.action === "set_next_sequence_date" ? { ok: true, readyDate: body.ready_date } : undefined)
  });
  // An empty box: refused on the page, nothing is posted.
  await page.locator("#bp-date-save").click();
  assert.match(await page.locator("#bp-date-status").innerText(), /Pick a date first\./);
  assert.equal(actions("set_next_sequence_date").length, 0);

  await page.locator("#bp-date").fill("2026-11-02");
  await page.locator("#bp-date-save").click();
  await page.locator("#bp-date-status", { hasText: /Saved\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("set_next_sequence_date"), [{ action: "set_next_sequence_date", client_id: CLIENT, ready_date: "2026-11-02" }]);
  assert.match(await page.locator("#bp-date-status").innerText(), /Saved\. The closer gets a task on that day\./);
  assert.match(await page.locator("#bp-date-now").innerText(), /Ready on Nov 2, 2026\./);
  assert.equal(sent.some((body) => body.action === "set_next_sequence_date" && body.ready_date !== "2026-11-02"), false);

  // A second, different day goes out as that day (a fixed or remembered day would not).
  await page.locator("#bp-date").fill("2027-01-15");
  await page.locator("#bp-date-save").click();
  await page.locator("#bp-date-now", { hasText: /Jan 15, 2027/ }).waitFor({ timeout: 10_000 });
  assert.equal(actions("set_next_sequence_date").at(-1).ready_date, "2027-01-15");
});

test("a refused ready date says so in words and keeps the old day on screen", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    custom: { blueprint_next_sequence_ready_date: "2026-10-01" },
    respond: (body) => (body.action === "set_next_sequence_date"
      ? { status: 403, body: { ok: false, error: "not_blueprint_buyer" } } : undefined)
  });
  await page.locator("#bp-date-now", { hasText: /Ready on Oct 1, 2026\./ }).waitFor({ timeout: 10_000 });
  await page.locator("#bp-date").fill("2026-12-01");
  await page.locator("#bp-date-save").click();
  await page.locator("#bp-date-status", { hasText: /has not paid for the Capital Blueprint/ }).waitFor({ timeout: 10_000 });
  assert.equal(actions("set_next_sequence_date").length, 1);
  assert.match(await page.locator("#bp-date-now").innerText(), /Ready on Oct 1, 2026\./);
  assert.equal(await page.locator("#bp-date-save").isDisabled(), false, "the button is usable again");
});

test("Offer bank tracker posts offered true, and Take the offer back posts offered false", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    respond: (body) => (body.action === "offer_bank_tracker" ? { ok: true, offered: body.offered === true } : undefined)
  });
  // Not offered yet: the Offer button is the one on screen, and the take-back button is not.
  assert.equal(await page.locator("#bp-offer").isVisible(), true);
  assert.equal(await page.locator("#bp-unoffer").isHidden(), true);
  assert.equal(await page.locator("#bp-todo-form").isHidden(), true);

  await page.locator("#bp-offer").click();
  await page.locator("#bp-offer-status", { hasText: /The bank tracker is offered\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("offer_bank_tracker"), [{ action: "offer_bank_tracker", client_id: CLIENT, offered: true }]);
  assert.match(await page.locator("#bp-offer-now").innerText(), /^Offered to this client\./);
  assert.equal(await page.locator("#bp-unoffer").isVisible(), true);
  assert.equal(await page.locator("#bp-offer").isHidden(), true);
  assert.equal(await page.locator("#bp-todo-form").isVisible(), true);

  await page.locator("#bp-unoffer").click();
  await page.locator("#bp-offer-status", { hasText: /The offer is taken back\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("offer_bank_tracker").map((body) => body.offered), [true, false]);
  assert.match(await page.locator("#bp-offer-now").innerText(), /^Not offered to this client yet\./);
  assert.equal(await page.locator("#bp-offer").isVisible(), true);
  assert.equal(await page.locator("#bp-unoffer").isHidden(), true);
  assert.equal(await page.locator("#bp-todo-form").isHidden(), true);
});

test("a refused offer says the client has not paid and does not flip the screen", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    respond: (body) => (body.action === "offer_bank_tracker"
      ? { status: 403, body: { ok: false, error: "not_blueprint_buyer" } } : undefined)
  });
  await page.locator("#bp-offer").click();
  await page.locator("#bp-offer-status", { hasText: /has not paid for the Capital Blueprint/ }).waitFor({ timeout: 10_000 });
  assert.equal(actions("offer_bank_tracker").length, 1);
  assert.equal(await page.locator("#bp-offer").isVisible(), true, "the offer was refused, so the Offer button stays");
  assert.equal(await page.locator("#bp-unoffer").isHidden(), true);
});

test("a client already offered shows Take the offer back and the bank form, and Take back posts offered false", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    custom: { blueprint_bank_tracker_offered: "true" },
    respond: (body) => (body.action === "offer_bank_tracker" ? { ok: true, offered: body.offered === true } : undefined)
  });
  await page.locator("#bp-unoffer").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await page.locator("#bp-offer").isHidden(), true);
  assert.equal(await page.locator("#bp-todo-form").isVisible(), true);
  await page.locator("#bp-unoffer").click();
  await page.locator("#bp-offer-status", { hasText: /The offer is taken back\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("offer_bank_tracker"), [{ action: "offer_bank_tracker", client_id: CLIENT, offered: false }]);
});

test("Add bank posts the Bank box as the bank, the Account choice, and the note, each trimmed, and clears the boxes", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    custom: { blueprint_bank_tracker_offered: "true" },
    respond: (body) => (body.action === "add_bank_todo"
      ? { ok: true, todo: { id: "d1", bank_key: String(body.bank_key).toLowerCase(), account_kind: body.account_kind, state: "open" } } : undefined)
  });
  await page.locator("#bp-todo-form").waitFor({ state: "visible", timeout: 10_000 });

  // An empty Bank box: refused on the page and nothing is posted, even with a note typed.
  await page.locator("#bp-notes").fill("Call Monday.");
  await page.locator("#bp-todo-add").click();
  assert.match(await page.locator("#bp-todo-status").innerText(), /Type the bank's name\./);
  assert.equal(actions("add_bank_todo").length, 0);

  // Business account, padded bank and padded note: each is trimmed, and each goes to its own field.
  await page.locator("#bp-bank").fill("  US Bank ");
  await page.locator("#bp-kind").selectOption("business");
  await page.locator("#bp-notes").fill("  Call Monday.  ");
  await page.locator("#bp-todo-add").click();
  await page.locator("#bp-todo-status", { hasText: /Added to the list\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("add_bank_todo"), [{ action: "add_bank_todo", client_id: CLIENT, bank_key: "US Bank", account_kind: "business", notes: "Call Monday." }]);
  assert.equal(await page.locator("#bp-bank").inputValue(), "");
  assert.equal(await page.locator("#bp-notes").inputValue(), "");

  // No note typed: the note goes as null (not an empty string), and a personal account goes as personal.
  await page.locator("#bp-bank").fill("Chase");
  await page.locator("#bp-kind").selectOption("personal");
  await page.locator("#bp-todo-add").click();
  await page.locator("#bp-todo-status", { hasText: /Added to the list\./ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(actions("add_bank_todo").at(-1), { action: "add_bank_todo", client_id: CLIENT, bank_key: "Chase", account_kind: "personal", notes: null });
});

test("Add bank refused because the tracker was never offered puts the Offer button back and takes the form away", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, actions } = await openBlueprint(lab, {
    custom: { blueprint_bank_tracker_offered: "true" },
    respond: (body) => (body.action === "add_bank_todo"
      ? { status: 409, body: { ok: false, error: "bank_tracker_not_offered" } } : undefined)
  });
  await page.locator("#bp-todo-form").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#bp-bank").fill("US Bank");
  await page.locator("#bp-todo-add").click();
  await page.locator("#bp-offer").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(actions("add_bank_todo").length, 1);
  assert.equal(await page.locator("#bp-todo-form").isHidden(), true);
  assert.equal(await page.locator("#bp-unoffer").isHidden(), true);
  // The sentence is set, in the paragraph that lives INSIDE the form the page has just hidden. So what the person
  // sees is the form vanishing and the Offer button coming back; the words are written and not shown.
  assert.match(await page.locator("#bp-todo-status").textContent(), /Offer the bank tracker to this client first\./);
});

// ── Client portal: What You Own, each Download link opens its own file ───────────────────────────────
// The saved-result check judges that every deliverable can be handed over (a version, an object, a checksum). It
// cannot see which file a link on the page opens. portal-summary hands the page documents newest first, each with
// its own signed link; the page must put each document's own link on its own row, and match an owned item to its
// document by the document's type and not by position.

const OWN_DOCS = [
  // Newest first, and deliberately NOT in the order the owned items are listed in.
  { id: "doc-complaint", kind: "deliverable", subtype: "cfpb_complaint", title: "CFPB complaint letter", download: { url: "/api/documents/doc-complaint?v=v1&exp=1&sig=aa" } },
  { id: "doc-snapshot", kind: "deliverable", subtype: "funding_snapshot", title: "Funding Snapshot", download: { url: "/api/documents/doc-snapshot?v=v2&exp=1&sig=bb" } },
  { id: "doc-analysis", kind: "deliverable", subtype: "credit_analysis_report", title: "Credit Analysis Report", download: { url: "/api/documents/doc-analysis?v=v3&exp=1&sig=cc" } },
  // Owned and on file, but its link was withheld (expired): the row says so and offers no link.
  { id: "doc-roadmap", kind: "deliverable", subtype: "credit_optimization_roadmap", title: "Credit Optimization Roadmap", download: null },
  // Not a deliverable: her own upload, never a row here.
  { id: "doc-upload", kind: "client_upload", subtype: "id_document", title: "Photo ID", download: { url: "/api/documents/doc-upload?v=v5&exp=1&sig=ee" } }
];

async function openOwnList(lab, documents) {
  const page = await newStaffPage(lab, {
    role: "client",
    staff: { id: CLIENT, client_id: CLIENT },
    api: async (request, url) => {
      if (url.pathname === "/api/read/portal-summary") {
        return {
          ok: true, prequal_amount: null, scores: {}, documents, inquiry_open: false, soft_pull_complete: true,
          repair_path: false, dispute_consent: false, advisor: null,
          stage: { key: "agreement_signed", before_call: false, soft_pull_complete: true, call_held: true, agreement_signed: true, payment_posted: false }
        };
      }
      if (url.pathname.includes("entitlement")) {
        return {
          ok: true, items: [
            { entitlement_code: "funding-snapshot", active: true },
            { entitlement_code: "credit-analysis-report", active: true },
            { entitlement_code: "credit-optimization-roadmap", active: true },
            { entitlement_code: "bank-lender-match-list", active: true }
          ]
        };
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-portal.html?id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator("#own-list .own-real").first().waitFor({ state: "attached", timeout: 30_000 });
  // Both reads (entitlements and portal-summary) must have landed: wait for the funding snapshot to have its link.
  await page.waitForFunction(() => !!document.querySelector('#own-list a[href*="doc-snapshot"]'), null, { timeout: 30_000 });
  return page;
}

test("each owned item's Download link opens that item's own document, by type and not by position", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openOwnList(lab, OWN_DOCS);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#own-list .own-real")].map((row) => ({
    name: (row.querySelector(".on-t") || {}).textContent || "",
    note: (row.querySelector(".on-d") || {}).textContent || "",
    link: ((row.querySelector(".own-actions a") || {}).getAttribute ? (row.querySelector(".own-actions a") || { getAttribute: () => null }).getAttribute("href") : null),
    badge: (row.querySelector(".own-actions .dr-s") || {}).textContent || ""
  })));
  const byName = new Map(rows.map((row) => [row.name, row]));
  // The owned items, each on its own document's link.
  assert.match(byName.get("Funding Snapshot").link, /doc-snapshot\?v=v2/, "Funding Snapshot opens the snapshot, not the newest file");
  assert.match(byName.get("Credit Analysis Report").link, /doc-analysis\?v=v3/, "Credit Analysis Report opens the analysis, not another file");
  // A deliverable the entitlements did not name still gets its own row and its own link.
  assert.match(byName.get("CFPB complaint letter").link, /doc-complaint\?v=v1/);
  // On file with its link withheld: said plainly, and no link is invented from another row.
  const roadmap = byName.get("Credit Optimization Roadmap");
  assert.equal(roadmap.link, null, "an expired file offers no link");
  assert.match(roadmap.note, /On your file\. This copy cannot be downloaded/);
  // Owned and not built yet: no link either.
  const matchList = byName.get("Bank and Lender Match List");
  assert.equal(matchList.link, null);
  assert.match(matchList.note, /not built yet/);
  // Her own upload is not a deliverable and is never listed as one.
  assert.equal(rows.some((row) => /Photo ID/.test(row.name)), false);
  // No two rows share one link.
  const links = rows.map((row) => row.link).filter(Boolean);
  assert.equal(new Set(links).size, links.length, "every link is its own document's");
});

// ── Client portal: an upload the server refuses says "Try again", and keeps the picked file ──────────

test("an invalid upload asks for a different file, while a server failure keeps the picked file for Try again", { timeout: 180_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  let answer = { status: 400, body: { ok: false, error: "invalid_file_type", message: "only jpg, png and pdf are accepted" } };
  const sent = [];
  const page = await newStaffPage(lab, {
    role: "client",
    staff: { id: CLIENT, client_id: CLIENT },
    api: async (request, url) => {
      if (url.pathname === "/api/documents-upload") {
        sent.push((request.postData() || "").length);
        return answer;
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/client-portal.html?id=${CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.locator(".upload-door.door-funding").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.body.classList.remove("no-docs", "no-upload-doors", "no-funding-door", "no-inquiry-door", "no-bureau-door");
  });
  for (const doorClass of ["door-funding", "door-inquiry", "door-bureau"]) {
    sent.length = 0;
    answer = { status: 400, body: { ok: false, error: "invalid_file_type", message: "only jpg, png and pdf are accepted" } };
    const door = page.locator(`.upload-door.${doorClass}`);
    const idleLabel = (await door.locator("[data-upload-btn]").innerText()).trim();
    await door.locator("[data-file-input]").setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 practice") });
    await door.locator("[data-upload-btn]", { hasText: /Send 1 file/ }).waitFor({ timeout: 10_000 });
    await door.locator("[data-upload-btn]").click();
    // A file-specific refusal clears that file and asks for a different one; retrying it cannot help.
    await door.locator("[data-upload-btn]", { hasText: new RegExp(`^${idleLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).waitFor({ timeout: 10_000 });
    assert.match(await door.locator("[data-door-msg]").innerText(), /only jpg, png and pdf are accepted Pick a different file\./);
    assert.equal(sent.length, 1, `${doorClass}: one attempt was posted`);
    // A server failure can recover, so the picked replacement stays ready for Try again.
    answer = { status: 500, body: { ok: false, error: "boom" } };
    await door.locator("[data-file-input]").setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 practice") });
    await door.locator("[data-upload-btn]", { hasText: /Send 1 file/ }).waitFor({ timeout: 10_000 });
    await door.locator("[data-upload-btn]").click();
    await door.locator("[data-upload-btn]", { hasText: /^Try again$/ }).waitFor({ timeout: 10_000 });
    assert.equal(sent.length, 2, `${doorClass}: the replacement reached the server`);
    // The file is still there for a real answer: the retry is accepted and the button says Sent.
    answer = { status: 200, body: { ok: true, documents: [], docs_missing: null } };
    await door.locator("[data-upload-btn]").click();
    await door.locator("[data-upload-btn]", { hasText: /^Sent$/ }).waitFor({ timeout: 10_000 });
    assert.equal(sent.length, 3, `${doorClass}: Try again reused the picked file and went through`);
  }
});

// ── Consent screen: the expiry lines, and no wording means no recording ───────────────────────────────

async function openConsentWith(lab, { status, disclosure, failRead = false, posts = [] }) {
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname !== "/api/consent/capture") return undefined;
      if (request.method() === "POST") {
        posts.push(post(request));
        return { ok: true, consent: { id: "k1" } };
      }
      if (failRead) return { status: 500, body: { ok: false, error: "boom" } };
      return { ok: true, kind: "soft_pull_consent", ...(disclosure === undefined ? {} : { disclosure }), status, history: [] };
    }
  });
  await page.goto(`${lab.origin}/app/consent-capture.html?client_id=${CLIENT}&kind=soft_pull_consent`, { waitUntil: "domcontentloaded" });
  return page;
}
const WORDS = { version: "soft-pull-v2", title: "Soft Pull and Text Message Authorization", text: "The words from the server." };

test("an expired consent says when it expired, and a valid one says when it expires", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const expired = await openConsentWith(lab, {
    disclosure: WORDS,
    status: { valid: false, reason: "expired", consent: { expires_at: "2026-08-01T12:00:00Z" } }
  });
  await expired.locator("#ccStatusLede", { hasText: "Consent has expired" }).waitFor({ timeout: 30_000 });
  assert.match(await expired.locator("#ccStatusDetail").textContent(), /It expired on Aug 1, 2026\./);
  await expired.close();

  const valid = await openConsentWith(lab, {
    disclosure: WORDS,
    status: { valid: true, reason: "valid", consent: { expires_at: "2027-03-05T12:00:00Z" } }
  });
  await valid.locator("#ccStatusLede", { hasText: "Consent is on file" }).waitFor({ timeout: 30_000 });
  assert.match(await valid.locator("#ccStatusDetail").textContent(), /It expires on Mar 5, 2027\./);
  await valid.close();

  // No expiry on file: neither line is written.
  const open = await openConsentWith(lab, {
    disclosure: WORDS, status: { valid: true, reason: "valid", consent: { expires_at: null } }
  });
  await open.locator("#ccStatusLede", { hasText: "Consent is on file" }).waitFor({ timeout: 30_000 });
  assert.doesNotMatch(await open.locator("#ccStatusDetail").textContent(), /It expire/);
});

test("with no wording from the server, or a failed read, the screen refuses to record a consent", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  // The server answered, with no wording.
  const posts = [];
  const none = await openConsentWith(lab, { disclosure: null, status: { valid: false, reason: "none_on_file" }, posts });
  await none.locator("#ccDisclosure", { hasText: /wording is unavailable — do not record a consent/ }).waitFor({ timeout: 30_000 });
  assert.equal(await none.locator("#ccSubmit").isDisabled(), true, "Record consent is off when there are no words to record");
  await none.locator("#ccName").fill("Pat Lee");
  await none.locator("#ccSubmit").click({ force: true, timeout: 2_000 }).catch(() => {});
  await none.waitForTimeout(300);
  assert.equal(posts.length, 0, "nothing is posted without the words");
  await none.close();

  // The read itself failed.
  const failedPosts = [];
  const failed = await openConsentWith(lab, { failRead: true, status: null, posts: failedPosts });
  await failed.locator("#ccStatusLede", { hasText: "Cannot check consent" }).waitFor({ timeout: 30_000 });
  assert.equal(await failed.locator("#ccSubmit").isDisabled(), true, "Record consent is off when the read failed");
  await failed.locator("#ccName").fill("Pat Lee");
  await failed.locator("#ccSubmit").click({ force: true, timeout: 2_000 }).catch(() => {});
  await failed.waitForTimeout(300);
  assert.equal(failedPosts.length, 0);
});

// ── Inquiry remover: the "Needs a human read" list and its Mark as checked button ────────────────────
// The list prints what GET /api/repair/exceptions answers: a "Stuck in repair" row per stalled card, and a row per
// answer that needs a look with its own Mark as checked button. The button must post THIS row's response id, and
// say Checked only when the server did. A button that confirmed the first row's answer would leave a confirmed
// answer with a confirmer, which the saved-result check cannot tell from the right one.

const PARSE_A = "a1000000-0000-4000-8000-00000000000a";
const PARSE_B = "b2000000-0000-4000-8000-00000000000b";

async function openExceptions(lab, { confirmAnswer }) {
  const posts = [];
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/repair/exceptions") {
        if (request.method() === "POST") {
          posts.push(post(request));
          return confirmAnswer(post(request));
        }
        return {
          ok: true,
          stalled: [{ card_id: "card-1", client_id: CLIENT, email: "stuck.client@example.test", stage_key: "stalled" }],
          lowConfidenceParses: [
            { id: PARSE_A, case_id: "case-1", client_id: CLIENT, confidence: 0.61, confirmed: false },
            { id: PARSE_B, case_id: "case-2", client_id: CLIENT, confidence: 0.4, confirmed: false }
          ]
        };
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded" });
  // The Repair desk loads the first time its tab is opened.
  await page.locator("#tab-repair").click();
  await page.locator("#repairExceptionsList .letter-row").first().waitFor({ state: "attached", timeout: 30_000 });
  return { page, posts };
}

test("the list prints the stuck client, and each Mark as checked posts its own answer's id", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, posts } = await openExceptions(lab, {
    confirmAnswer: (body) => ({ ok: true, status: "advanced", responseId: body.responseId })
  });
  const list = page.locator("#repairExceptionsList");
  assert.match(await list.innerText(), /stuck\.client@example\.test/);
  assert.match(await list.innerText(), /Stuck in repair/);
  const buttons = list.locator("[data-confirm-parse]");
  assert.equal(await buttons.count(), 2);
  assert.deepEqual(await buttons.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-confirm-parse"))), [PARSE_A, PARSE_B]);

  // The SECOND row's button posts the second row's id, and the first row is left alone.
  await buttons.nth(1).click();
  await list.locator(`[data-confirm-parse="${PARSE_B}"]`, { hasText: /^Checked$/ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(posts, [{ action: "confirm_parse", responseId: PARSE_B }]);
  assert.equal((await buttons.nth(0).textContent()).trim(), "Mark as checked");
  await buttons.nth(0).click();
  await list.locator(`[data-confirm-parse="${PARSE_A}"]`, { hasText: /^Checked$/ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(posts.map((body) => body.responseId), [PARSE_B, PARSE_A]);
});

test("a refused Mark as checked does not say Checked", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const { page, posts } = await openExceptions(lab, {
    confirmAnswer: () => ({ status: 400, body: { ok: false, error: "not_found" } })
  });
  const button = page.locator(`[data-confirm-parse="${PARSE_A}"]`);
  await button.click();
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-confirm-parse="${id}"]`);
    return node && node.textContent !== "Mark as checked" && !node.disabled;
  }, PARSE_A, { timeout: 10_000 });
  assert.equal(posts.length, 1);
  assert.notEqual((await button.textContent()).trim(), "Checked");
  assert.equal((await button.textContent()).trim(), "not_found");
});

// ── Inquiry remover: the Call bureau button posts this case's id, and is off once a case is fired ────
// A launch is one real phone call to a bureau with the client's date of birth and SSN, and the server does not
// refuse a second launch on a case (the saved-result check sees a repeat after the fact). The page is what keeps
// the second press from being possible: the button is off for a case that is already fired, and a press posts the
// case that was opened, not another one.

const CASE_FIRED = "a3000000-0000-4000-8000-0000000000a3";
const CASE_A = "b4000000-0000-4000-8000-0000000000b4";
const CASE_B = "c5000000-0000-4000-8000-0000000000c5";

function caseRow(id, caseId, over = {}) {
  return {
    id, case_id: caseId, client_id: CLIENT, client_name: "Pat Lee", case_status: "In Progress",
    selected_bureaus_raw: "EX", open_inquiry_count: 2, created_at: "2026-10-01T00:00:00Z", requested_at: "2026-10-01T00:00:00Z",
    call_fired_at: null, ai_call_status: null, ...over
  };
}

async function openCases(lab, { launchAnswer }) {
  const launches = [];
  const page = await newStaffPage(lab, {
    role: "owner",
    api: async (request, url) => {
      if (url.pathname === "/api/read/inquiry-cases") {
        // Oldest first is the order the page lists them in, so the fired case is the FIRST row, the case that is
        // pressed second is in the MIDDLE and the one pressed last is the LAST: a button that posted the first or
        // the last row's id, or a remembered id, is told apart from one that posts the case it was opened on.
        return {
          ok: true, total: 3,
          cases: [
            caseRow(CASE_FIRED, "IRC-1", { created_at: "2026-09-01T00:00:00Z", call_fired_at: "2026-10-10T10:00:00Z", ai_call_status: "calling" }),
            caseRow(CASE_A, "IRC-2", { created_at: "2026-09-02T00:00:00Z" }),
            caseRow(CASE_B, "IRC-3", { created_at: "2026-09-03T00:00:00Z" })
          ]
        };
      }
      if (url.pathname === "/api/inquiry" && request.method() === "POST") {
        launches.push({ query: Object.fromEntries(url.searchParams), body: post(request) });
        return launchAnswer(post(request));
      }
      return undefined;
    }
  });
  await page.goto(`${lab.origin}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-case-row="${CASE_A}"]`).waitFor({ timeout: 30_000 });
  return { page, launches };
}

test("Call bureau posts the opened case's id, is off for a case already fired, and says a refusal in words", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  let answer = { status: 502, body: { ok: false, placed: false, error: "call_failed", message: "The bureau call could not be placed." } };
  const { page, launches } = await openCases(lab, { launchAnswer: () => answer });
  const drawerButton = page.locator(`.case-detail-row [data-act="call-bureau"]`);

  // The fired case: its drawer's Call bureau is off, and says why.
  await page.locator(`[data-case-row="${CASE_FIRED}"]`).click();
  await drawerButton.waitFor({ timeout: 10_000 });
  assert.equal(await drawerButton.isDisabled(), true);
  assert.equal(await drawerButton.getAttribute("title"), "Call already started");
  await drawerButton.click({ force: true, timeout: 1_000 }).catch(() => {});
  assert.equal(launches.length, 0, "a fired case cannot be launched again from the page");

  // The middle case, refused: the server's words are on the button, and it is usable again.
  await page.locator(`[data-case-row="${CASE_A}"]`).click();
  await drawerButton.waitFor({ timeout: 10_000 });
  assert.equal(await drawerButton.isDisabled(), false);
  await drawerButton.click();
  await page.locator(`.case-detail-row [data-act="call-bureau"]`, { hasText: /could not be placed/ }).waitFor({ timeout: 10_000 });
  assert.deepEqual(launches.map((launch) => launch.body), [{ id: CASE_A }]);
  assert.equal(launches[0].query.action, "launch");
  assert.equal(await page.locator(`.case-detail-row [data-act="call-bureau"]`).isDisabled(), false, "nothing was called, so the button is usable");

  // The last case, accepted: it posts its own id, never the first row's or the one pressed before.
  answer = { ok: true, placed: true, call_id: "call-1", bureau: "EX", case_id: CASE_B };
  await page.locator(`[data-case-row="${CASE_B}"]`).click();
  await drawerButton.waitFor({ timeout: 10_000 });
  await drawerButton.click();
  const deadline = Date.now() + 10_000;
  while (launches.length < 2 && Date.now() < deadline) await page.waitForTimeout(50);
  assert.deepEqual(launches.map((launch) => launch.body), [{ id: CASE_A }, { id: CASE_B }]);
});
