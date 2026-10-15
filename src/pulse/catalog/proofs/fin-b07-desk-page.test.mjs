// Practice test for four rows of the Specialist desk, run on the REAL page in a real browser with
// fake answers and no database:
//
//   * Case queue table: one row per inquiry removal case, oldest first (nine columns)
//   * Work row: click or Enter expands the work strip; loads attempt history and the masked identity line
//   * Repair queue table: Client, Program, Round, Stage, Needs chip, Due (need-me first, most overdue first)
//   * Repair row: click or Enter expands the file (items, letters this round, what is next, timeline)
// (The drawer's upload button and the expanded row's Clean personal info button are in
// fin-b07-desk-buttons.test.mjs; the fake answers both files use are in fin-b07-desk-page-kit.mjs.)
//
// Every case builds rows whose cells are all DIFFERENT, so a cell wired to the wrong field, a column
// dropped, or an order changed turns the test red. The expected words for the repair table come from
// src/repair/lens.mjs (the module the page's own copy of the lens is meant to equal), not from the page.
//
// The Work queue table row (Client .. Status) is NOT attached to this test. Its Hold column compares
// call_state to "holding" while the database enum spells it "on_hold" (see the manifest, product
// finding), so the row's claim is false of real data and is left unproved.

import assert from "node:assert/strict";
import test from "node:test";

import { deriveChip, dueWords, roundLabel } from "../../../repair/lens.mjs";
import { startScreens } from "./s4-screen-harness.mjs";
import { CASES, DETAIL, FILES, INQUIRIES, NOTHING, SPECIALIST, cellsOf, repairHandlers, uuid, workHandlers } from "./fin-b07-desk-page-kit.mjs";

test("the case queue paints nine columns from each case, and lists the case that is ready first, then the oldest first", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", {
    session: SPECIALIST,
    handlers: { ...NOTHING, "/api/read/inquiry-cases": { ok: true, cases: CASES, total: 3 } },
  });
  await page.waitForSelector("#caseQueueBody tr.case-main");
  const rows = await cellsOf(page, "#caseQueueBody tr.case-main");
  assert.equal(rows.length, 3);

  // Ready for review goes first, then the older of the others (Ada, 10 days) before Sam (2 days).
  assert.deepEqual(rows.map((r) => r[0].replace(/^▶\s*/, "")), ["Dana Whitfield", "Ada Lee", "Sam Rivera"]);

  const [dana, ada, sam] = rows;
  // Client | Waiting | Bureau | Items | Status | Docs | Delivery | Call | Round
  assert.equal(dana.length, 9);
  assert.match(dana[1], /^5 days/);
  assert.equal(dana[2], "Experian");
  assert.equal(dana[3], "3");
  assert.equal(dana[4], "Ready for Review");
  assert.equal(dana[5], "complete");
  assert.match(dana[6], /^Letter\s*Portal$/, "no letter and no portal reference yet: two empty chips");
  assert.equal(dana[7], "not due");
  assert.equal(dana[8], "abcdef12");

  assert.match(ada[1], /^10 days/);
  assert.equal(ada[2], "TransUnion");
  assert.equal(ada[3], "0");
  assert.equal(ada[4], "Blocked (docs)");
  assert.equal(ada[5], "chasing — not yet itemised");
  assert.equal(ada[8], "—", "no round on the case");

  assert.match(sam[1], /^2 days/);
  assert.equal(sam[2], "Equifax");
  assert.equal(sam[3], "1");
  assert.equal(sam[4], "Sent");
  assert.equal(sam[5], "chasing — photo ID");
  assert.equal(sam[6], "Letter · delivered", "a provider id and a delivery channel read as a delivered letter; no portal chip off Experian");
  assert.equal(sam[7], "due", "the call was due yesterday and has not fired");
  await page.close();
});

test("the work queue paints each line's client, bureau, name, expected name, call state, attempts and status", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", { session: SPECIALIST, handlers: workHandlers() });
  await page.waitForSelector("#workQueueTable tr[data-row]");
  const rows = await cellsOf(page, "#workQueueTable tr[data-row]");
  assert.equal(rows.length, 2);
  // Client | Bureau | Actual | Expected | Call State | Hold | Attempts | Status
  assert.equal(rows[0].length, 8);
  assert.equal(rows[0][0].replace(/^▸\s*/, ""), "Dana Whitfield");
  assert.equal(rows[0][1], "Experian");
  assert.equal(rows[0][2], "CAPITAL ONE BANK USA");
  assert.equal(rows[0][3], "Capital One");
  assert.equal(rows[0][4], "on hold");
  assert.equal(rows[0][6], "2");
  assert.equal(rows[0][7], "Filed");
  assert.equal(rows[1][0].replace(/^▸\s*/, ""), "Sam Rivera");
  assert.equal(rows[1][1], "Equifax");
  assert.equal(rows[1][2], "CHASE CARD SERVICES");
  assert.equal(rows[1][3], "—");
  assert.equal(rows[1][4], "not started");
  assert.equal(rows[1][6], "0");
  assert.equal(rows[1][7], "Pending Removal");
  await page.close();
});

test("a work row expands on click and on Enter, loads its real attempt history and the masked identity line, and folds back", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", { session: SPECIALIST, handlers: workHandlers() });
  await page.waitForSelector("#workQueueTable tr[data-row]");
  const first = page.locator("#workQueueTable tr[data-row]").nth(0);
  const second = page.locator("#workQueueTable tr[data-row]").nth(1);

  // click expands, and the strip holds the history and the masked line
  await first.click();
  const strip = page.locator("#workQueueTable tr.workrow").first();
  await strip.waitFor();
  assert.equal(await first.getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() => /SSN \*\*\*-\*\*-6789/.test(document.querySelector("#workQueueTable tr.workrow .pii-ssn")?.textContent || ""));
  const log = await strip.locator(".worklog").innerText();
  assert.match(log, /call · no_answer · Robin Ellis/, "the first attempt on the history");
  assert.match(log, /letter · sent · Sam Closer/, "the second attempt on the history");
  assert.ok(log.indexOf("letter · sent") < log.indexOf("call · no_answer"), "newest attempt on top");
  assert.equal(await strip.locator("button", { hasText: "Reveal SSN" }).isDisabled(), true, "no reason typed, nothing to reveal");
  await strip.locator("input[aria-label^='reason for revealing']").fill("bureau dispute call");
  assert.equal(await strip.locator("button", { hasText: "Reveal SSN" }).isDisabled(), false);

  // a second click folds it back
  await first.click();
  assert.equal(await first.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#workQueueTable tr.workrow").count(), 0);

  // Enter expands a row from the keyboard
  await second.focus();
  await page.keyboard.press("Enter");
  await page.locator("#workQueueTable tr.workrow").waitFor();
  assert.equal(await second.getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() => /no attempts logged yet/.test(document.querySelector("#workQueueTable tr.workrow .worklog")?.textContent || ""));
  await page.waitForFunction(() => /no identity record on file/.test(document.querySelector("#workQueueTable tr.workrow .pii-ssn")?.textContent || ""));
  await page.keyboard.press("Enter");
  assert.equal(await second.getAttribute("aria-expanded"), "false");
  await page.close();
});

// ── Repair queue ─────────────────────────────────────────────────────────────────────────────

test("the repair queue paints each file's program, round, stage, needs chip and due, need-me files first and the most overdue on top", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", { session: SPECIALIST, handlers: repairHandlers() });
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.waitForSelector("#repairBody tr.repair-row");
  const rows = await cellsOf(page, "#repairBody tr.repair-row");
  assert.equal(rows.length, 4);

  // Need-me files first, the most overdue (earliest due) on top, a file with no due date last in its group.
  assert.deepEqual(rows.map((r) => r[0]), ["Needs Late", "Needs Later", "Needs Ready", "Quiet Waiting"]);

  const byName = Object.fromEntries(FILES.map((f) => [f.name, f]));
  const PILL = { ready_to_send: "Ready", response_received: "Answer in", stalled: "Stuck", awaiting_response: "Waiting" };
  for (const row of rows) {
    const f = byName[row[0]];
    // Client | Program | Round | Stage | Needs | Due
    assert.equal(row.length, 6);
    assert.equal(row[1], f.program, `${f.name}: program`);
    assert.equal(row[2], roundLabel(f), `${f.name}: round`);
    assert.equal(row[3], PILL[f.stage_key], `${f.name}: stage`);
    assert.ok(row[4].startsWith(deriveChip(f).label), `${f.name}: needs chip "${row[4]}" should start with "${deriveChip(f).label}"`);
    assert.equal(row[5], dueWords(f.response_due_at).text, `${f.name}: due`);
  }
  // The chip words are not all one word: the test would pass an all-same column.
  assert.ok(new Set(rows.map((r) => r[4])).size >= 3, "the needs chips differ file to file");
  assert.ok(new Set(rows.map((r) => r[5])).size >= 3, "the due words differ file to file");
  await page.close();
});

test("a repair row expands on click and on Enter and shows the file's items, letters this round, what is next and its timeline", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", { session: SPECIALIST, handlers: repairHandlers() });
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.waitForSelector("#repairBody tr.repair-row");

  const row = page.locator(`[data-repair-row="${uuid(32)}"]`);
  await row.click();
  const open1 = page.locator("tr.repair-expand");
  await open1.waitFor();
  await page.waitForFunction(() => document.querySelector("tr.repair-expand h3")?.textContent === "Items");
  const card = async (title) => open1.locator(".repair-xcard", { has: page.locator("h3", { hasText: new RegExp(`^${title}$`) }) }).innerText();
  const items = await card("Items");
  assert.match(items, /EX · ACME COLLECTIONS/);
  assert.match(items, /····4412/);
  assert.match(items, /deletion/);
  assert.match(items, /EQ · FIRST CARD BANK/);
  assert.match(items, /moderate/);
  const letters = await card("Letters this round");
  assert.match(letters, /Experian · R1\s+generated/);
  assert.match(letters, /Equifax · R1\s+ready\s+furnisher/);
  const next = await card("What is next");
  assert.match(next, /R1 · Next to write/);
  assert.match(next, /Round 1: first challenge — this week/);
  assert.match(next, /ACME COLLECTIONS; FIRST CARD BANK/);
  assert.match(next, /R2 · Later/);
  const timeline = await card("Timeline");
  assert.match(timeline, /Letters made for round 1 on October 12/);
  assert.match(timeline, /Analysis finished on October 11/);
  assert.equal(await row.getAttribute("aria-expanded"), "true");

  await row.click();
  assert.equal(await row.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("tr.repair-expand").count(), 0);

  // Enter expands a row from the keyboard
  const other = page.locator(`[data-repair-row="${uuid(33)}"]`);
  await other.focus();
  await page.keyboard.press("Enter");
  await page.locator("tr.repair-expand").waitFor();
  assert.equal(await other.getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() => document.querySelector("tr.repair-expand h3")?.textContent === "Items");
  await page.close();
});
