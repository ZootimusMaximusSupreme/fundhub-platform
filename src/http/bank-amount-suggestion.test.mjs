/* THE BANK'S OWN FIGURE, OFFERED TO THE ADVISOR — the read side and the screen.
 *
 * src/adapters/mailgun-amounts.test.mjs pins the capture. This file pins the
 * two things between the capture and a person's eyes:
 *
 *   * GET /api/read/bank-inbox hands the screen the candidate figures and
 *     nothing else out of `raw` — that column holds the whole inbound payload
 *     and is a staff-gated table, so it never leaves the process.
 *   * public/app/client-control-panel.html offers them beside the Approved $
 *     box, one click to accept, and NEVER saves an amount by itself.
 *
 * WHY IT LIVES HERE. package.json's test glob is "src/**" and "scripts/**", so
 * a test under api/ or public/ is silently never collected (CLAUDE.md §12).
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listBankInbox } from "../../api/read/bank-inbox.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = fs.readFileSync(path.resolve(HERE, "../../public/app/client-control-panel.html"), "utf8");

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

function capture() {
  const calls = [];
  const query = (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  return { calls, query };
}

test("bank-inbox read hands the screen the candidate figures", () => {
  const c = capture();
  listBankInbox(c.query, { orgId: "org-1", clientId: "cl-1", limit: 50, offset: 0 });
  const sql = c.calls[0].sql;
  assert.ok(/raw->'amountCandidates'\s+AS amount_candidates/.test(sql),
    "the figures the bank stated are selected");
  assert.ok(/raw->'amountCandidatesFound'\s+AS amount_candidates_found/.test(sql),
    "and how many there really were, so the screen can say it cannot tell which");
});

test("bank-inbox read never returns the raw payload itself", () => {
  const c = capture();
  listBankInbox(c.query, { orgId: "org-1", clientId: "cl-1", limit: 50, offset: 0 });
  const sql = c.calls[0].sql;
  // `raw->'…'` is fine — that is two named keys. A bare `raw` in the select
  // list would ship the client's whole bank email to the browser.
  assert.equal(/(^|[\s,(])raw(\s*,|\s+AS\b|\s*$)/im.test(sql.split("FROM")[0]), false,
    "the raw column is not selected");
});

test("bank-inbox read stays scoped to one org and one client", () => {
  const c = capture();
  listBankInbox(c.query, { orgId: "org-1", clientId: "cl-1", limit: 50, offset: 0 });
  assert.equal(c.calls[0].params[0], "org-1");
  assert.equal(c.calls[0].params[1], "cl-1");
  assert.ok(/org_id = \$1/.test(c.calls[0].sql) && /client_id = \$2/.test(c.calls[0].sql));
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

test("the panel has a place for the suggestion beside every Approved $ box", () => {
  assert.ok(PANEL.indexOf('data-amount-suggest-lender-id') !== -1,
    "each lender row carries its own suggestion slot");
  assert.ok(PANEL.indexOf('id="fh-bank-amount-hint"') !== -1,
    "and one sentence explains where the figure came from");
});

test("the suggestion fills the box and saves NOTHING", () => {
  // The click handler's whole body. If a fetch, a POST or an approved_amount
  // ever appears inside it, the suggestion has become an automatic write.
  //
  // Anchored inside fillSlot(), the function that builds the suggestion
  // buttons. A bare search for the first `b.addEventListener("click", …)` in
  // the file started landing on the bank to-do Done/Skipped handler added
  // above it on 2026-09-29 (a5cac05fe), which is a different button.
  const slotFn = PANEL.indexOf("function fillSlot(slot, box) {");
  assert.notEqual(slotFn, -1, "the suggestion buttons are still built by fillSlot()");
  const at = PANEL.indexOf('b.addEventListener("click", function () {', slotFn);
  assert.notEqual(at, -1, "the suggestion button's click handler is still here");
  const handler = PANEL.slice(at, at + 220);
  assert.ok(/box\.value = dollars;/.test(handler), "it puts the figure in the box");
  assert.equal(/fetch\(/.test(handler), false, "and sends nothing");
  assert.equal(/approved_amount/.test(handler), false, "and writes no amount");
});

test("an amount is still only saved through the typed-box parser", () => {
  // Unchanged behaviour, asserted because the suggestion sits right next to it:
  // approved_amount reaches the server from ONE place, and only after
  // FHMoneyInput.parseAmount has accepted what is in the box.
  assert.ok(/payload\.approved_amount = parsed\.dollars;/.test(PANEL));
  assert.equal((PANEL.match(/payload\.approved_amount\s*=[^=]/g) || []).length, 1,
    "exactly one line sets it, and it is the one that ran parseAmount first");
});

test("the screen says plainly when it cannot tell which figure is the approval", () => {
  assert.ok(PANEL.indexOf("we cannot tell which one is the approval") !== -1,
    "more than one figure is never presented as a single answer");
});

test("the suggestion button targets its OWN row's box", () => {
  // This screen is written in `var`. A handler closing over a `var box` from
  // the surrounding loop holds whichever row the loop finished on, so every
  // button on every row would fill the LAST lender's box. The box is passed in.
  assert.ok(/function fillSlot\(slot, box\)/.test(PANEL),
    "the box a button fills is a parameter, not a loop variable");
});
