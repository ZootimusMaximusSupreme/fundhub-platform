// Batch 13 practice tests: the Specialist desk (public/app/inquiry-remover.html) and the app front door
// (public/app/index.html).
//
// A real Chromium opens the real page from public/ with a fake API (nothing leaves this machine). Each
// test presses the control and judges exactly what the page then shows and what it sends. These are
// practice tests with fake data, not live checks. The people and cases are made up for the test.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { fulfillJson, newStaffPage, openLab } from "./s5-browser-kit.mjs";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT_A = U(101);
const CLIENT_B = U(102);
const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

/* ── the work queue (inquiry_log rows) ── */
const inquiryRow = (n, bureau, status, attempts, over = {}) => ({
  id: U(n), client_id: CLIENT_A, case_id: null, bureau, inquiry: "CAPITAL ONE BANK USA", inquiry_name: "CAPITAL ONE BANK USA",
  expected_name: "Capital One", status, call_state: null, is_open: true, call_attempts: attempts, outcome: null,
  cleared_at: null, confirmed_at: null, client_name: "Dana Whitfield", ...over
});
const INQUIRIES = [
  inquiryRow(1, "EQ", "Filed", 1),
  inquiryRow(2, "EQ", "New", 0),
  inquiryRow(3, "TU", "No answer", 2),
  inquiryRow(4, "EX", "Pending", 0),
  inquiryRow(5, "EX", "Removed", 3, { confirmed_at: "2026-10-01T12:00:00Z", is_open: false }),
  inquiryRow(6, "TU", "Confirmed", 0, { confirmed_at: "2026-10-02T12:00:00Z", is_open: false })
];

/* ── the case queue (inquiry_removal_cases rows) ── */
const caseRow = (n, over = {}) => ({
  id: U(200 + n), case_id: `IRC-${n}`, client_id: CLIENT_A, client_name: `Client ${String(n).padStart(2, "0")}`,
  selected_bureaus_raw: "EQ", open_inquiry_count: 2, case_status: "Queued",
  requested_at: daysAgo(40 - n), docs_complete: true, docs_missing: [], letter_draft_html: "<p>Dear bureau</p>",
  funding_round_id: null, call_due_at: null, call_fired_at: null, first_delivery_at: null, letter_provider_id: null,
  portal_confirmation: null, ...over
});

/* ── the repair desk ── */
const repairFile = (client, name, over = {}) => ({
  client_id: client, name, program: "trial", round: "R1", rounds_cap: 3, stage_key: "ready_to_send", stage_label: "Ready",
  letters_ready: 0, letters_sent: 0, can_send: false, authorization_ok: true, response_due_at: null, ...over
});
const FILES = [
  repairFile(CLIENT_A, "Dana Whitfield", { letters_ready: 1, can_send: true }),                       // need + ready
  repairFile(U(103), "Sam Rivera", { stage_key: "awaiting_response", letters_sent: 2 }),            // wait
  repairFile(U(104), "Lee Park", { stage_key: "stalled", letters_sent: 1 }),                         // stuck
  repairFile(U(105), "Kim Ward", { stage_key: "response_received", letters_sent: 3, upsell_pending: true }), // trial
  repairFile(U(106), "Mo Day", { authorization_ok: false, stage_key: "new_enrollment" })                // need
];
const REPAIR_LIST = { ok: true, need_me: 2, ready: 1, waiting: 1, stalled: 1, trial_ending: 1, total: 5, files: FILES };
const REPAIR_FILE = {
  ok: true, file: { client_id: CLIENT_A, name: "Dana Whitfield" },
  letters: [{
    id: U(900), bureau: "EX", round: "R1", status: "ready", target: "bureau", can_send: true,
    html: "<p>Round 1 letter body</p>", rule_ids: ["r-1", "r-2"]
  }],
  items: [], timeline: [], rounds: [], signer_name: "Dana Whitfield", signed_at: "2026-09-01T12:00:00Z"
};

function makeApi(state) {
  return async (request, url) => {
    const p = url.pathname;
    const method = request.method();
    const body = () => JSON.parse(request.postData() || "{}");
    if (p === "/api/read/inquiries") return { ok: true, items: state.inquiries, count: state.inquiries.length, hasMore: false };
    if (p === "/api/inquiries" && method === "GET") {
      if (url.searchParams.get("recent") === "letters") return { ok: true, letters: [] };
      return { ok: true, attempts: [] };
    }
    if (p === "/api/inquiries" && method === "POST") {
      const b = body();
      state.writes.push(b);
      return state.writeAnswer ? state.writeAnswer(b) : { ok: true, inquiry: null };
    }
    if (p === "/api/pii") return { ok: true, identity: null };
    if (p === "/api/read/inquiry-cases") return { ok: true, cases: state.cases, total: state.cases.length };
    if (p === "/api/inquiry-cases") {
      state.caseWrites.push(body());
      return { ok: true };
    }
    if (p === "/api/read/repair-cases") {
      state.repairReads.push(url.search);
      if (url.searchParams.get("client_id")) return REPAIR_FILE;
      if (state.repairFailures > 0) {
        state.repairFailures -= 1;
        return { status: 500, body: { ok: false, error: "down" } };
      }
      return REPAIR_LIST;
    }
    if (p === "/api/repair/exceptions") return { ok: true, stalled: [], lowConfidenceParses: [] };
    if (p === "/api/finance/crs-pull") {
      state.pulls.push(body());
      return { ok: true };
    }
    return undefined;
  };
}

const freshState = (over = {}) => ({
  inquiries: INQUIRIES, cases: [], writes: [], caseWrites: [], repairReads: [], pulls: [], repairFailures: 0, ...over
});

async function openDesk(lab, state, { role = "owner", storage = {} } = {}) {
  const page = await newStaffPage(lab, { role, api: makeApi(state) });
  if (Object.keys(storage).length) {
    await page.addInitScript((entries) => {
      try { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); } catch { /* blocked */ }
    }, storage);
  }
  await page.goto(`${lab.origin}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded" });
  // The chat button floats over the bottom right corner of the drawers; it is not what these tests judge.
  await page.addStyleTag({ content: "#fh-chat-fab{display:none !important}" });
  await page.waitForFunction(() => /\w/.test(document.getElementById("whoRole")?.textContent || "") && document.getElementById("whoRole").textContent !== "—", null, { timeout: 30_000 });
  return page;
}

const stat = (page, name) => page.locator(`[data-stat="${name}"]`).textContent();
const chipCount = (page, bureau) => page.locator(`.bureau-chip[data-bureau="${bureau}"] .bc`).textContent();

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab?.close(); });

test("stat tiles and bureau chips count the open work, and a confirm moves them by the server's answer", { timeout: 120_000 }, async () => {
  const state = freshState({
    writeAnswer: (b) => ({
      ok: true,
      inquiry: b.action === "confirm"
        ? { id: b.inquiry_id, status: "Removed", outcome: null, call_attempts: 0, confirmed_at: "2026-10-14T12:00:00Z" }
        : { id: b.inquiry_id, status: "Filed", outcome: null, call_attempts: 2, confirmed_at: null }
    })
  });
  const page = await openDesk(lab, state);
  await page.locator("#workQueueTable tr[data-row]").first().waitFor();
  assert.equal(await page.locator("#workQueueTable tr[data-row]").count(), 6);
  // Still open = 4 (not Removed, not Confirmed). Worked = done or attempts: 1 + 3 + 5 + 6. Calls = 1+0+2+0+3+0.
  assert.deepEqual(
    [await stat(page, "left"), await stat(page, "worked"), await stat(page, "calls"), await stat(page, "confirmed")],
    ["4", "4", "6", "2"]);
  // Chips count only the open rows, under the bureau's own code.
  assert.deepEqual([await chipCount(page, "EQ"), await chipCount(page, "TU"), await chipCount(page, "EX")], ["2", "1", "1"]);
  assert.match(await page.locator('.bureau-chip[data-bureau="EQ"] .bs').textContent(), /2 left/);

  // Confirm an inquiry nobody has worked: Still open -1, Confirmed +1, Worked +1, its chip -1, Calls the same.
  const row = page.locator(`#workQueueTable tr[data-id="${U(2)}"]`);
  await row.click();
  await page.getByRole("button", { name: "Mark confirmed" }).click();
  await page.waitForFunction(() => document.querySelector('[data-stat="confirmed"]').textContent === "3");
  assert.deepEqual(state.writes, [{ inquiry_id: U(2), action: "confirm" }]);
  assert.deepEqual(
    [await stat(page, "left"), await stat(page, "worked"), await stat(page, "calls"), await stat(page, "confirmed")],
    ["3", "5", "6", "3"]);
  assert.equal(await chipCount(page, "EQ"), "1");
  assert.match(await row.locator("td:nth-child(8)").textContent(), /Removed/);

  // Log an attempt on an open row: the Calls tile moves by the difference the server returned (1 to 2).
  const filed = page.locator(`#workQueueTable tr[data-id="${U(1)}"]`);
  await filed.click();
  await filed.locator("xpath=following-sibling::tr[1]").getByRole("button", { name: "Log an attempt" }).click();
  await page.waitForFunction(() => document.querySelector('[data-stat="calls"]').textContent === "7");
  assert.equal(state.writes.at(-1).action, "attempt");
  assert.equal(await stat(page, "left"), "3", "an attempt does not close an inquiry");
  await page.close();
});

test("a bureau chip filters the work queue to that bureau, says how many rows, and clears on the next press", { timeout: 120_000 }, async () => {
  const page = await openDesk(lab, freshState());
  await page.locator("#workQueueTable tr[data-row]").first().waitFor();
  const eq = page.locator('.bureau-chip[data-bureau="EQ"]');
  const visibleRows = () => page.locator("#workQueueTable tr[data-row]:not([hidden])").count();
  assert.equal(await visibleRows(), 6);

  await eq.click();
  assert.equal(await eq.getAttribute("aria-pressed"), "true");
  assert.equal(await visibleRows(), 2);
  assert.equal(await page.locator("#filter-note").textContent(), "filtered · Equifax · 2 of 6 rows");

  // Another chip replaces the filter.
  await page.locator('.bureau-chip[data-bureau="TU"]').click();
  assert.equal(await eq.getAttribute("aria-pressed"), "false");
  assert.equal(await visibleRows(), 2);
  assert.equal(await page.locator("#filter-note").textContent(), "filtered · TransUnion · 2 of 6 rows");

  // The same chip again clears it.
  await page.locator('.bureau-chip[data-bureau="TU"]').click();
  assert.equal(await visibleRows(), 6);
  assert.equal(await page.locator("#filter-note").textContent(), "");
  await page.close();
});

test("the case queue shows 25 rows and a button, and the button brings in the rest", { timeout: 120_000 }, async () => {
  const cases = Array.from({ length: 30 }, (_, i) => caseRow(i + 1));
  const page = await openDesk(lab, freshState({ cases }));
  await page.locator("#caseQueueBody tr.case-main").first().waitFor();
  assert.equal(await page.locator("#caseQueueBody tr.case-main").count(), 25);
  const more = page.locator("#caseMoreBtn");
  assert.equal(await more.isVisible(), true);
  assert.equal(await more.textContent(), "Show the other 5");
  assert.equal(await page.locator("#caseMore").textContent(), "showing the oldest 25 of 30");
  await more.click();
  assert.equal(await page.locator("#caseQueueBody tr.case-main").count(), 30);
  assert.equal(await more.isHidden(), true);
  await page.close();

  // 25 or fewer: no button at all.
  const few = await openDesk(lab, freshState({ cases: cases.slice(0, 25) }));
  await few.locator("#caseQueueBody tr.case-main").first().waitFor();
  assert.equal(await few.locator("#caseMoreBtn").isHidden(), true);
  await few.close();
});

test("a case row expands its drawer on a click and folds it on the next", { timeout: 120_000 }, async () => {
  const cases = [caseRow(1), caseRow(2, { selected_bureaus_raw: "EX" })];
  const page = await openDesk(lab, freshState({ cases }));
  const row = (n) => page.locator(`#caseQueueBody tr[data-case-row="${U(200 + n)}"]`);
  await row(1).waitFor();
  assert.equal(await row(1).getAttribute("aria-expanded"), "false");
  await row(1).click();
  assert.equal(await row(1).getAttribute("aria-expanded"), "true");
  const drawer = page.locator("#caseQueueBody tr.case-detail-row");
  assert.equal(await drawer.count(), 1);
  const words = await drawer.textContent();
  for (const heading of ["Disputable items", "Generated letter (draft)", "Identity packet", "Send"]) {
    assert.ok(words.includes(heading), `the drawer lost its ${heading} part`);
  }
  assert.match(await drawer.locator("textarea.letter-edit").inputValue(), /Dear bureau/);
  // Opening a second row closes the first: one drawer at a time.
  await row(2).click();
  assert.equal(await row(1).getAttribute("aria-expanded"), "false");
  assert.equal(await row(2).getAttribute("aria-expanded"), "true");
  assert.equal(await drawer.count(), 1);
  await row(2).click();
  assert.equal(await drawer.count(), 0);
  await page.close();
});

test("the case drawer's Open documents link carries this client's id", { timeout: 120_000 }, async () => {
  const cases = [caseRow(1, { client_id: CLIENT_B })];
  const page = await openDesk(lab, freshState({ cases }));
  await page.locator(`#caseQueueBody tr[data-case-row="${U(201)}"]`).click();
  const link = page.locator("#caseQueueBody tr.case-detail-row a", { hasText: "Open documents" });
  assert.equal(await link.getAttribute("href"), `documents.html?client_id=${CLIENT_B}`);
  await page.close();
});

test("send options: mail ticked by default, a service level, the Experian portal block only on an Experian case", { timeout: 120_000 }, async () => {
  const state = freshState({
    cases: [caseRow(1, { selected_bureaus_raw: "EX" }), caseRow(2, { selected_bureaus_raw: "TU" }),
      caseRow(3, { selected_bureaus_raw: "EQ", docs_complete: false, docs_missing: ["id_document"] })]
  });
  const page = await openDesk(lab, state);
  const open = async (n) => {
    await page.locator(`#caseQueueBody tr[data-case-row="${U(200 + n)}"]`).click();
    return page.locator("#caseQueueBody tr.case-detail-row");
  };

  // Experian case: mail is on, the service list is the four the page offers, and the portal block is there.
  let drawer = await open(1);
  assert.equal(await drawer.locator(".want-mail").isChecked(), true);
  assert.deepEqual(await drawer.locator(".mail-service option").evaluateAll((els) => els.map((el) => [el.value, el.textContent])), [
    ["", "Bureau default (first class)"], ["first_class", "First class"], ["priority", "Priority"], ["priority_express", "Priority express"]
  ]);
  assert.equal(await drawer.locator(".want-portal").isChecked(), false);
  const upload = drawer.locator("a", { hasText: "Open Experian upload" });
  assert.equal(await upload.getAttribute("href"), "https://www.experian.com/consumer/upload/");
  assert.equal(await upload.getAttribute("target"), "_blank");

  // A portal upload with no reference is refused on the page and sends nothing.
  await drawer.locator(".want-portal").check();
  await drawer.locator('[data-act="send"]').click();
  assert.equal(await drawer.locator('[data-act="send"]').textContent(), "Experian portal reference number is required");
  assert.deepEqual(state.caseWrites, []);

  // With a reference, a service level and both channels: one request that says exactly that.
  await drawer.locator(".portal-ref").fill("  EXP-7781  ");
  await drawer.locator(".mail-service").selectOption("priority");
  await drawer.locator('[data-act="send"]').click();
  await page.waitForFunction(() => true);
  await page.waitForFunction((count) => count === 1, state.caseWrites.length);
  assert.deepEqual(state.caseWrites, [{
    id: U(201), action: "send", mail: true, portal: true, portal_confirmation: "EXP-7781", mail_service_level: "priority"
  }]);

  // Mail off and no service level: the request carries mail:false... which the page refuses (nothing chosen).
  await page.reload({ waitUntil: "domcontentloaded" });
  drawer = await open(2);
  assert.equal(await drawer.locator(".portal-ref").count(), 0, "no portal reference box off Experian");
  assert.match(await drawer.textContent(), /Portal upload is Experian-only/);
  await drawer.locator(".want-mail").uncheck();
  await drawer.locator('[data-act="send"]').click();
  assert.equal(await drawer.locator('[data-act="send"]').textContent(), "select mail and/or portal");

  // A case still missing paperwork: the options and Send are off, and the page says what is missing.
  drawer = await open(3);
  assert.equal(await drawer.locator(".want-mail").isDisabled(), true);
  assert.equal(await drawer.locator(".mail-service").isDisabled(), true);
  assert.equal(await drawer.locator('[data-act="send"]').isDisabled(), true);
  assert.match(await drawer.textContent(), /Send is off — this client still needs to send us photo ID/);
  await page.close();
});

test("the headline counts cases ready to send, and its next button opens the oldest one", { timeout: 120_000 }, async () => {
  const cases = [
    caseRow(1, { client_name: "Newer Client", requested_at: daysAgo(2), selected_bureaus_raw: "TU" }),
    caseRow(2, { client_name: "Oldest Client", requested_at: daysAgo(9), selected_bureaus_raw: "EQ" }),
    caseRow(3, { client_name: "Middle Client", requested_at: daysAgo(5), selected_bureaus_raw: "EX" }),
    caseRow(4, { client_name: "Blocked Client", case_status: "Blocked", requested_at: daysAgo(20) })
  ];
  const page = await openDesk(lab, freshState({ cases }));
  await page.locator("#caseQueueBody tr.case-main").first().waitFor();
  assert.equal(await page.locator("#deskLabel").textContent(), "Ready to send");
  assert.equal(await page.locator("#deskValue").textContent(), "3");
  assert.match(await page.locator("#deskSub").textContent(), /^oldest waiting 9 days · 1 case needs a person before it can be sent$/);
  const next = page.locator("#deskNext");
  assert.equal(await next.isVisible(), true);
  assert.equal(await next.textContent(), "Send the oldest — Oldest Client, Equifax, waiting 9 days");
  await next.click();
  const oldest = page.locator(`#caseQueueBody tr[data-case-row="${U(202)}"]`);
  assert.equal(await oldest.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#caseQueueBody tr.case-detail-row").count(), 1);
  await page.close();

  // Nothing ready: the number is 0, there is no button, and the quiet line says who needs a person.
  const none = await openDesk(lab, freshState({ cases: [cases[3]] }));
  await none.locator("#caseQueueBody tr.case-main").first().waitFor();
  assert.equal(await none.locator("#deskValue").textContent(), "0");
  assert.equal(await none.locator("#deskNext").isHidden(), true);
  assert.match(await none.locator("#deskNextNone").textContent(), /^Nothing is ready to send — 1 case needs a person before it can be sent\./);
  await none.close();
});

test("desk tabs switch between Inquiries and Repair, swap the headline, and remember the last pane", { timeout: 120_000 }, async () => {
  const page = await openDesk(lab, freshState());
  const inquiriesTab = page.locator('.desk-tab[data-pane="inquiries"]');
  const repairTab = page.locator('.desk-tab[data-pane="repair"]');
  assert.equal(await inquiriesTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#pane-repair").isHidden(), true);
  assert.equal(await page.locator("#inq-stats").isVisible(), true);
  assert.equal(await page.locator("#deskLabel").textContent(), "Ready to send");

  await repairTab.click();
  assert.equal(await repairTab.getAttribute("aria-selected"), "true");
  assert.equal(await inquiriesTab.getAttribute("aria-selected"), "false");
  assert.equal(await page.locator("#pane-inquiries").isHidden(), true);
  assert.equal(await page.locator("#pane-repair").isVisible(), true);
  assert.equal(await page.locator("#repair-stats").isVisible(), true);
  assert.equal(await page.locator("#inq-stats").isHidden(), true);
  await page.waitForFunction(() => document.getElementById("deskLabel").textContent === "Need me" && document.getElementById("deskValue").textContent === "2");
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_specialist_pane")), "repair");

  // A reload opens on the pane she was working.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('.desk-tab[data-pane="repair"]').getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#pane-repair").isVisible(), true);

  await page.locator('.desk-tab[data-pane="inquiries"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_specialist_pane")), "inquiries");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("whoRole").textContent !== "—");
  assert.equal(await page.locator('.desk-tab[data-pane="inquiries"]').getAttribute("aria-selected"), "true");
  await page.close();
});

test("repair tile filters keep only the files in that set, and pressing the tile again clears them", { timeout: 120_000 }, async () => {
  const page = await openDesk(lab, freshState());
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.locator("#repairBody tr.repair-row").first().waitFor();
  assert.equal(await page.locator("#repairBody tr.repair-row").count(), 5);
  const kept = async () => (await page.locator("#repairBody tr.repair-row:not(.filtered-out) td.name").allTextContents()).sort();

  const sets = {
    need: ["Dana Whitfield", "Mo Day"],
    ready: ["Dana Whitfield"],
    wait: ["Sam Rivera"],
    stuck: ["Lee Park"],
    trial: ["Kim Ward"]
  };
  for (const [filter, names] of Object.entries(sets)) {
    const tile = page.locator(`#repair-stats .stat-tile[data-filter="${filter}"]`);
    await tile.click();
    assert.equal(await tile.getAttribute("aria-pressed"), "true", `${filter} tile did not turn on`);
    assert.deepEqual(await kept(), names, `${filter} tile kept the wrong files`);
    await tile.click();
    assert.equal(await tile.getAttribute("aria-pressed"), "false");
    assert.equal((await kept()).length, 5, `${filter} tile did not clear`);
  }
  // Pressing a second tile replaces the first, and the keyboard works the same way.
  await page.locator('#repair-stats .stat-tile[data-filter="need"]').click();
  await page.locator('#repair-stats .stat-tile[data-filter="wait"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('#repair-stats .stat-tile[data-filter="need"]').getAttribute("aria-pressed"), "false");
  assert.deepEqual(await kept(), ["Sam Rivera"]);
  await page.close();
});

test("the repair headline's next button opens the first file that needs her, by name", { timeout: 120_000 }, async () => {
  const page = await openDesk(lab, freshState());
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.locator("#repairBody tr.repair-row").first().waitFor();
  assert.equal(await page.locator("#deskLabel").textContent(), "Need me");
  assert.equal(await page.locator("#deskValue").textContent(), "2");
  assert.equal(await page.locator("#deskSub").textContent(), "of 5 open");
  const next = page.locator("#deskNext");
  assert.equal(await next.textContent(), "Open Dana Whitfield — Send letters");
  await next.click();
  const row = page.locator(`[data-repair-row="${CLIENT_A}"]`);
  assert.equal(await row.getAttribute("aria-expanded"), "true");
  await page.locator("tr.repair-expand [data-act=repair-send]").waitFor();
  await page.close();
});

test("the repair Retry button reads the queue again and paints the rows when the second read works", { timeout: 120_000 }, async () => {
  const state = freshState({ repairFailures: 1 });
  const page = await openDesk(lab, state);
  await page.locator('.desk-tab[data-pane="repair"]').click();
  const retry = page.locator("#repairRetry");
  await retry.waitFor();
  assert.match(await page.locator("#repairStateBlock").textContent(), /Couldn't load/);
  assert.equal(await page.locator("#deskValue").textContent(), "—", "a failed read is a dash, never a zero");
  assert.equal(state.repairReads.length, 1);
  await retry.click();
  await page.locator("#repairBody tr.repair-row").first().waitFor();
  assert.equal(state.repairReads.length, 2, "Retry must read the queue again");
  assert.equal(await page.locator("#repairBody tr.repair-row").count(), 5);
  assert.equal(await page.locator("#repairRetry").count(), 0);
  assert.equal(await page.locator("#deskValue").textContent(), "2");
  await page.close();
});

test("an expanded repair file lists its letters; a letter opens the drawer with its words, rules and signature, and every Close shuts it", { timeout: 120_000 }, async () => {
  const page = await openDesk(lab, freshState());
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.locator(`[data-repair-row="${CLIENT_A}"]`).click();
  const letter = page.locator("tr.repair-expand li[data-letter-idx]").first();
  await letter.waitFor();
  assert.match(await letter.textContent(), /Experian · R1\s*ready/);

  const drawer = page.locator("#repairLetterDrawer");
  const isOpen = () => drawer.evaluate((el) => el.classList.contains("open"));
  await letter.click();
  assert.equal(await isOpen(), true);
  assert.equal(await drawer.getAttribute("aria-hidden"), "false");
  assert.equal(await page.locator("#repairLetterTitle").textContent(), "Experian · R1");
  assert.equal(await page.locator("#repairLetterMeta").textContent(), "target: bureau · rules r-1 · r-2 · status ready");
  const body = await page.locator("#repairLetterBody").textContent();
  assert.match(body, /Round 1 letter body/);
  assert.match(body, /Dana Whitfield/);
  assert.match(body, /Signed electronically · Sep 1, 2026 · from the signed repair agreement/);
  assert.equal(await page.locator("#repairLetterSendOne").isEnabled(), true);

  // Every way to close it: the header Close, the footer Close, the dimmed page, and Escape.
  const closers = page.locator("[data-repair-close-letter]");
  assert.equal(await closers.count(), 3);
  await page.locator(".repair-lhead [data-repair-close-letter]").click();
  assert.equal(await isOpen(), false);
  await letter.click();
  await page.locator(".repair-lfoot [data-repair-close-letter]").click();
  assert.equal(await isOpen(), false);
  await letter.click();
  await page.locator("#repairLetterDrawer .scrim").click({ position: { x: 450, y: 300 } });
  assert.equal(await isOpen(), false);
  await letter.click();
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(), false);
  // The keyboard opens a letter too.
  await letter.focus();
  await page.keyboard.press("Enter");
  assert.equal(await isOpen(), true);
  assert.equal(await drawer.getAttribute("aria-hidden"), "false");
  await page.close();
});

test("the Soft pull button is offered to owner, admin, closer and funding advisor only, and opens the type-PULL box", { timeout: 180_000 }, async () => {
  const offered = [];
  for (const role of ["owner", "admin", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter", "sales_manager"]) {
    const page = await openDesk(lab, freshState(), { role });
    await page.locator('.desk-tab[data-pane="repair"]').click();
    await page.locator(`[data-repair-row="${CLIENT_A}"]`).click();
    await page.locator("tr.repair-expand [data-act=repair-send]").waitFor();
    if (await page.locator("tr.repair-expand [data-act=repair-pull]").count()) offered.push(role);
    await page.close();
  }
  assert.deepEqual(offered, ["owner", "admin", "closer", "funding_advisor"]);

  const state = freshState();
  const page = await openDesk(lab, state, { role: "owner" });
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.locator(`[data-repair-row="${CLIENT_A}"]`).click();
  await page.locator("tr.repair-expand [data-act=repair-pull]").click();
  const modal = page.locator("#repairPullModal");
  const isOpen = () => modal.evaluate((el) => el.classList.contains("open"));
  assert.equal(await isOpen(), true);
  assert.equal(await page.locator("#repairPullGo").isDisabled(), true);
  await page.locator("#repairPullInput").fill("pull");
  assert.equal(await page.locator("#repairPullGo").isDisabled(), true, "only the word PULL, in capitals, turns the button on");
  await page.locator("#repairPullInput").fill("PULL");
  assert.equal(await page.locator("#repairPullGo").isDisabled(), false);

  // Cancel, the dimmed page and Escape all shut the box without pulling.
  await page.locator(".repair-cact [data-repair-close-pull]").click();
  assert.equal(await isOpen(), false);
  await page.locator("tr.repair-expand [data-act=repair-pull]").click();
  assert.equal(await page.locator("#repairPullInput").inputValue(), "", "the box opens empty every time");
  await page.locator("#repairPullModal .cscrim").click({ position: { x: 900, y: 10 } });
  assert.equal(await isOpen(), false);
  await page.locator("tr.repair-expand [data-act=repair-pull]").click();
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(), false);
  assert.deepEqual(state.pulls, []);

  // Typing PULL and pressing Pull orders the three bureaus, one at a time, for this client.
  await page.locator("tr.repair-expand [data-act=repair-pull]").click();
  await page.locator("#repairPullInput").fill("PULL");
  await page.locator("#repairPullGo").click();
  await page.waitForFunction(() => !document.getElementById("repairPullModal").classList.contains("open"));
  assert.deepEqual(state.pulls, [
    { client_id: CLIENT_A, bureau: "EX" }, { client_id: CLIENT_A, bureau: "EQ" }, { client_id: CLIENT_A, bureau: "TU" }
  ]);
  await page.close();
});

test("the app front door sends a person with no session, or with no role, to the sign-in page", { timeout: 120_000 }, async () => {
  // No session: the shell has nobody, so it sends them to sign in and brings them back here afterwards.
  const none = await lab.browser.newPage({ viewport: { width: 1200, height: 800 } });
  await none.route("https://**", (route) => route.abort());
  await none.route("**/api/**", (route) => fulfillJson(route, { ok: false }, 401));
  await none.goto(`${lab.origin}/app/index.html`, { waitUntil: "domcontentloaded" });
  await none.waitForURL((url) => url.pathname === "/login.html", { timeout: 30_000 });
  assert.equal(new URL(none.url()).searchParams.get("next"), "/app/index.html");
  await none.close();

  // A session whose role matches no desk: the shell signs them out and sends them to sign in.
  const odd = await lab.browser.newPage({ viewport: { width: 1200, height: 800 } });
  const calls = [];
  await odd.addInitScript(() => {
    try { if (location.pathname.startsWith("/app/")) localStorage.setItem("fh_token", "browser-proof-fake-token"); } catch { /* blocked */ }
  });
  await odd.route("https://**", (route) => route.abort());
  await odd.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/auth/session") {
      return fulfillJson(route, { ok: true, staff: { id: "s-1", name: "Odd Role", role: "", org_id: "org-proof", status: "active" } });
    }
    return fulfillJson(route, { ok: true });
  });
  await odd.goto(`${lab.origin}/app/index.html`, { waitUntil: "domcontentloaded" });
  await odd.waitForURL((url) => url.pathname === "/login.html", { timeout: 30_000 });
  assert.ok(calls.includes("POST /api/auth/logout"), "the session must be ended on the server before the redirect");
  assert.equal(await odd.evaluate(() => localStorage.getItem("fh_token")), null, "the stored token must be cleared");
  await odd.close();

  // And a person who is signed in properly is not sent to sign in: the front door forwards them to their home.
  const owner = await newStaffPage(lab, { role: "owner", api: async () => undefined });
  await owner.goto(`${lab.origin}/app/index.html`, { waitUntil: "domcontentloaded" });
  await owner.waitForURL((url) => url.pathname.startsWith("/app/") && !url.pathname.endsWith("/index.html"), { timeout: 30_000 });
  assert.notEqual(new URL(owner.url()).pathname, "/login.html");
  await owner.close();
});
