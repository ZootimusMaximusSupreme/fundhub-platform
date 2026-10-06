/* Tests for public/app/pipeline.html's board-summary bar.
 *
 * It used to print hardcoded Sales sample numbers (82 cards / $544,200 /
 * 4 held) no matter which rail was selected, because nothing ever recomputed
 * it. The fix sums the same count/amount fields buildColumn() already puts on
 * each rendered column, via a small pure function (FH-SUMMARY-BEGIN/END in
 * the page) — tested here in isolation, the way public/app/data.js and
 * closer-dashboard.html's inlined view model are tested elsewhere in this
 * directory.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/pipeline.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

/* The screen with every comment stripped — markup comments and CSS/JS block
   comments alike. Some assertions below are about what the page SAYS or what
   it PAINTS, and a note explaining why an old shape was removed must not be
   able to fail the test that proves it was removed. */
const SHIPPED = HTML
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const BEGIN = "/* FH-SUMMARY-BEGIN */";
const END = "/* FH-SUMMARY-END */";

function loadBlock() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-SUMMARY markers are gone from pipeline.html");
  const sandbox = { window: {}, Date, Infinity, isNaN, String, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-SUMMARY" });
  return sandbox.window;
}

function loadSummaryFn() {
  return loadBlock().FHPipelineSummary;
}

const stage = (count, amount) => ({ count, amount, cards: [] });

describe("public/app/pipeline.html — board-summary totals", () => {

  test("it loads and exposes the summary function", () => {
    const fn = loadSummaryFn();
    assert.equal(typeof fn, "function");
  });

  test("sums count and amount across every stage, not just the visible ones", () => {
    const fn = loadSummaryFn();
    const totals = fn([stage(42, 268400), stage(18, 121300), stage(11, 74800), stage(7, 70700), stage(4, 31600)]);
    assert.equal(totals.count, 82);
    assert.equal(totals.money, 566800);
  });

  test("an empty pipeline is a real zero, not an error", () => {
    const fn = loadSummaryFn();
    assert.deepEqual(fn([]), { count: 0, money: 0 });
  });

  test("no stages at all is still a real zero", () => {
    const fn = loadSummaryFn();
    assert.deepEqual(fn(null), { count: 0, money: 0 });
    assert.deepEqual(fn(undefined), { count: 0, money: 0 });
  });

  test("a stage missing amount or count contributes nothing rather than throwing", () => {
    const fn = loadSummaryFn();
    const totals = fn([{ cards: [] }, stage(5, 1000)]);
    assert.equal(totals.count, 5);
    assert.equal(totals.money, 1000);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   "WHAT IS WAITING ON ME" — the question this board could not answer.

   A funding advisor with forty clients on one rail had no way to see which
   cards needed a person here. The facts were all on the screen already, one
   card at a time, and nothing added them up.

   These tests pin the RULE, not the layout: which bucket a card lands in, that
   it lands in exactly one, and that a number is never invented when the answer
   is unknown. The rule lives in a pure function inside the FH-SUMMARY markers
   with no DOM anywhere near it, which is why it can be tested at all.
   ──────────────────────────────────────────────────────────────────────────── */
describe("public/app/pipeline.html — whose move is it", () => {

  const card = (over) => Object.assign({
    id: "c1", client_id: "cl1", name: "A Person", entered_at: "2026-08-01T00:00:00Z",
    sms_needs_reply: false, email_needs_reply: false, approval_amount_missing: false
  }, over || {});

  test("a client who wrote and got no answer is waiting on us, on any rail", () => {
    const { FHWaitingOn } = loadBlock();
    assert.equal(FHWaitingOn(card({ sms_needs_reply: true }), "new_lead"), "us");
    assert.equal(FHWaitingOn(card({ email_needs_reply: true }), "requested"), "us");
  });

  test("an approval with no dollar amount is waiting on us", () => {
    const { FHWaitingOn } = loadBlock();
    assert.equal(FHWaitingOn(card({ approval_amount_missing: true }), "approved"), "us");
  });

  test("Round Submitted is a bank, Action Required is the client", () => {
    const { FHWaitingOn } = loadBlock();
    assert.equal(FHWaitingOn(card(), "round_submitted"), "bank");
    assert.equal(FHWaitingOn(card(), "action_required"), "client");
  });

  test("every other stage answers 'nothing recorded' rather than guessing a party", () => {
    // The screen says "nothing recorded", never "nothing to do". Inventing a
    // party from a stage name nobody agreed on is exactly the kind of number
    // that looks real and is not.
    const { FHWaitingOn } = loadBlock();
    for (const key of ["new_lead", "booked", "apply_now", "funded", "intake",
                       "awaiting_response", "invoice_sent", "", null, undefined]) {
      assert.equal(FHWaitingOn(card(), key), "none", "stage " + key + " must not be guessed");
    }
  });

  test("only an explicit true counts — a missing key is not evidence of a clean file", () => {
    const { FHWaitingOn } = loadBlock();
    assert.equal(FHWaitingOn({ id: "x" }, "new_lead"), "none");
    assert.equal(FHWaitingOn(card({ sms_needs_reply: "true" }), "new_lead"), "none",
      "a string is not a true; a card must never claim work from a value nobody measured");
    assert.equal(FHWaitingOn(null, "round_submitted"), "none");
  });

  test("a card lands in exactly one bucket, so the counters can never out-count the board", () => {
    // This is the assertion that stops the first row of the screen
    // contradicting itself. A card CAN be sitting in Round Submitted and have
    // a text nobody answered; if both counted, the four figures would add to
    // more than the card count.
    const { FHPipelineWaiting } = loadBlock();
    const t = FHPipelineWaiting([
      { key: "round_submitted", cards: [
        card({ id: "1", sms_needs_reply: true }),   // both true at once
        card({ id: "2" })
      ] },
      { key: "action_required", cards: [card({ id: "3" })] },
      { key: "apply_now", cards: [card({ id: "4", approval_amount_missing: true }), card({ id: "5" })] }
    ]);
    assert.deepEqual(t, { us: 2, bank: 1, client: 1, none: 1, cards: 5 });
    assert.equal(t.us + t.bank + t.client + t.none, t.cards, "the four buckets must equal the card count");
  });

  test("an empty rail is a real zero, and a rail that never answered is not counted at all", () => {
    const { FHPipelineWaiting } = loadBlock();
    assert.deepEqual(FHPipelineWaiting([]), { us: 0, bank: 0, client: 0, none: 0, cards: 0 });
    assert.deepEqual(FHPipelineWaiting(null), { us: 0, bank: 0, client: 0, none: 0, cards: 0 });
  });

  test("'us — an approval amount' narrows what is shown without moving a count", () => {
    const { FHWaitMatches } = loadBlock();
    const c = card({ approval_amount_missing: true });
    assert.equal(FHWaitMatches(c, "apply_now", "us"), true);
    assert.equal(FHWaitMatches(c, "apply_now", "us_amount"), true);
    assert.equal(FHWaitMatches(card({ sms_needs_reply: true }), "apply_now", "us_amount"), false,
      "an unanswered text is waiting on us but is not a missing approval amount");
    assert.equal(FHWaitMatches(c, "apply_now", ""), true, "no choice shows everything");
  });

  test("the next card up is the one waiting on us that has waited longest", () => {
    const { FHNextUp } = loadBlock();
    const next = FHNextUp([
      { key: "apply_now", name: "Apply Now", cards: [
        card({ id: "new", name: "Newer", sms_needs_reply: true, entered_at: "2026-08-20T00:00:00Z" }),
        card({ id: "old", name: "Older", sms_needs_reply: true, entered_at: "2026-08-02T00:00:00Z" })
      ] },
      { key: "round_submitted", name: "Round Submitted", cards: [
        card({ id: "oldest", name: "Oldest", entered_at: "2026-01-01T00:00:00Z" })   // bank, not us
      ] }
    ]);
    assert.equal(next.id, "old", "the oldest card WAITING ON US, not the oldest card");
    assert.equal(next.stage, "Apply Now");
  });

  test("a card with an unreadable date never wins 'longest wait'", () => {
    // Unknown must not be able to win a comparison it was never measured for.
    const { FHNextUp } = loadBlock();
    const next = FHNextUp([{ key: "apply_now", name: "Apply Now", cards: [
      card({ id: "broken", sms_needs_reply: true, entered_at: null }),
      card({ id: "real", sms_needs_reply: true, entered_at: "2026-08-10T00:00:00Z" })
    ] }]);
    assert.equal(next.id, "real");
    assert.equal(FHNextUp([{ key: "apply_now", cards: [card({ sms_needs_reply: true, entered_at: "nonsense" })] }]), null);
  });

  test("nothing waiting on us returns null, so the screen can say it in words", () => {
    const { FHNextUp } = loadBlock();
    assert.equal(FHNextUp([{ key: "round_submitted", cards: [card()] }]), null);
    assert.equal(FHNextUp([]), null);
  });
});

describe("public/app/pipeline.html — the headline row", () => {

  test("the number is top-left, above and before every control", () => {
    // UI-STANDARDS §1. The headline must come before the filter bar in the
    // markup, or the first thing on the page is a control again.
    const headline = HTML.indexOf('<div class="headline"');
    const filterbar = HTML.indexOf('<div class="filterbar"');
    const railbar = HTML.indexOf('<nav class="railbar"');
    assert.ok(headline !== -1, "the headline row is gone");
    assert.ok(headline > railbar && headline < filterbar,
      "the headline must sit between the rail switcher and the filter bar");
  });

  test("the metric uses the brand's own sizes and spends no escape hatch", () => {
    // §12.7: a px font-size written in this screen's <style> is thrown away by
    // fundhub-brand.css. `.big` and `.eyebrow` are handed --fs-metric and
    // --fs-caption for free, which is why this row needed no size of its own.
    assert.match(HTML, /<span class="eyebrow">Waiting on us<\/span>/);
    assert.match(HTML, /<span class="big" id="hlUsN">—<\/span>/);
  });

  test("it says 'us', not 'me' — nothing in this system assigns a card to a person", () => {
    // cards.owner is never written by production code (src/workflows/cards.mjs,
    // api/public/partner-apply.mjs); only demo seeds set it. A per-person
    // number would be invented, so the screen does not offer one.
    assert.match(SHIPPED, /Waiting on us/);
    assert.ok(!/Waiting on me/i.test(SHIPPED), "there is no card assignment to base a per-person number on");
  });

  test("every figure starts as a dash and a failed read puts it back to one", () => {
    // A 0 would claim nothing is waiting. That is the one thing an unanswered
    // read can never prove.
    assert.match(HTML, /function clearHeadline\(note\)/);
    assert.match(HTML, /hlEls\[k\]\.textContent = "—"/);
    assert.match(HTML, /clearHeadline\("The board did not load, so this number is unknown\."\)/);
    assert.match(HTML, /clearHeadline\("Loading " \+ \(label \|\| "the board"\) \+ "…"\)/);
  });

  test("the headline is painted from the same stages the columns are built from", () => {
    // One read, two views. A second fetch could disagree with the cards under it.
    assert.match(HTML, /setSummary\(fhPipelineSummary\(stages\)\);\s*\n\s*setHeadline\(stages\);/);
  });

  test("the counters carry words, never colour alone", () => {
    // §12.6: paintBrand() overwrites --alert/--warn/--ok/--info from the
    // tenant ramp, so a one-hue white-label company paints every state the
    // same colour and a colour-only counter says nothing there.
    for (const word of ["on a bank", "on the client", "nothing recorded"]) {
      assert.ok(HTML.includes(word), "the counter lost its word: " + word);
    }
  });

  test("clicking a counter drives the same filter the select does", () => {
    // One state, two ways in. Two independent filters would drift.
    assert.match(HTML, /fWait\.value = \(fWait\.value===want\) \? '' : want;/);
    assert.match(HTML, /id="fWait"/);
    assert.match(HTML, /\{el:fWait,k:'Waiting on'\}/, "it must join the chip / clear-all machinery");
  });

  test("the lens hides the headline with the rest of the board-only chrome", () => {
    assert.match(HTML, /"#filterChips", "\.headline", "\.board-summary"/);
  });
});

describe("public/app/pipeline.html — the age filter reads the clock, not the words", () => {

  test("cardEl writes the raw timestamp onto the card", () => {
    assert.match(HTML, /card\.dataset\.enteredAt = c\.entered_at/);
  });

  test("ageMins prefers the timestamp and only falls back to the rendered text", () => {
    // age() rounds to the nearest hour or day for the reader. Re-reading that
    // rounded text back off the card meant "over 3 days" was decided by a
    // number that had already been rounded before anything compared it.
    assert.match(HTML, /var iso=card\.dataset && card\.dataset\.enteredAt;/);
    assert.match(HTML, /if\(!isNaN\(t\)\) return Math\.max\(0, Math\.round\(\(Date\.now\(\)-t\)\/60000\)\);/);
  });

  test("a card with no readable date answers 0, so it never satisfies an 'over N' filter", () => {
    assert.match(HTML, /if\(hit&&age && ageMins\(c\)<age\) hit=false;/);
  });
});

describe("public/app/pipeline.html — Amount needed is filterable and sortable", () => {

  test("the flag reaches the DOM as something a filter can read", () => {
    assert.match(HTML, /if \(c\.approval_amount_missing === true\) card\.dataset\.needsAmount = "1";/);
  });

  test("there is a sort that puts approvals with no amount first", () => {
    assert.match(HTML, /<option value="needs">Amount needed first<\/option>/);
    assert.match(HTML, /if\(mode==='needs'\)\{/);
  });

  test("within that sort the longest wait comes first", () => {
    assert.match(HTML, /return nb-na \|\| ageMins\(b\)-ageMins\(a\);/);
  });
});

describe("public/app/pipeline.html — screen wiring", () => {

  test("the sample summary numbers (82 / $544,200 / 4 held) are gone from the markup", () => {
    assert.ok(!/<b>82<\/b>\s*cards/.test(HTML), "hardcoded 82 cards is still in the page");
    assert.ok(!HTML.includes("$544,200"), "hardcoded $544,200 is still in the page");
    assert.ok(!/\b4 held\b/.test(HTML), "hardcoded 4 held is still in the page");
  });

  test("the summary bar has real DOM hooks for card count and est. money", () => {
    assert.match(HTML, /id="sumCount"/);
    assert.match(HTML, /id="sumMoney"/);
  });

  test("New Client lives on this board and posts to the funnel door", () => {
    assert.match(HTML, /id="fhNewClient"/);
    assert.match(HTML, /id="fhNewName"/);
    assert.match(HTML, /id="fhNewEmail"/);
    assert.match(HTML, /id="fhNewPhone"/);
    assert.match(HTML, /id="fhNewProduct"/);
    assert.match(HTML, /\/api\/pipeline-clients/);
    assert.ok(!/pipeline-new-client\.html/.test(HTML), "must not add a new screen");
  });

  /* Was "held stays an honest dash". The rule underneath is unchanged — the
     API has no hold field, so no hold number may be invented — but a dash
     that can never become a number is a control that does nothing, and
     UI-STANDARDS §5 says it does not render (walkthrough-4 defect 24). */
  test("no held figure renders — the API has no hold field for a card to invent", () => {
    assert.ok(!/id="sumHeld"/.test(HTML), "the always-a-dash held figure is back");
    assert.ok(!/>— held</.test(HTML), "a held figure is printed with no source");
    assert.ok(!/\b\d+ held\b/.test(HTML.replace(/<!--[\s\S]*?-->/g, "")), "a hold count is invented");
  });

  test("both the cache-hit path and the fresh-fetch path update the summary from real stages", () => {
    // Both paths go through applyBoard(), which always sets the summary from
    // the stages it was handed — cache hit and fresh fetch alike.
    assert.match(HTML, /function applyBoard\(stages, rail, label, key\)/);
    assert.match(HTML, /setSummary\(fhPipelineSummary\(stages\)\)/);
    assert.match(HTML, /applyBoard\(cache\[key\], rail, label, key\)/);
    assert.match(HTML, /applyBoard\(res\.data\.stages, rail, label, key\)/);
  });

  test("a failed or demo load clears the summary instead of leaving the last rail's numbers on screen", () => {
    assert.match(HTML, /setSummary\(null\)/);
  });

  test("MOVE to Card Stacking Apply Now is wired and opens that board after a save", () => {
    assert.match(HTML, /data-pipeline-key="funding_card_stacking" data-stage-key="apply_now"/);
    assert.match(HTML, /Funding: Card Stacking · Apply Now/);
    assert.match(HTML, /function persistCardMove\(card, pipelineKey, stageKey, onFail, onOk\)/);
    assert.match(HTML, /function showPipeline\(pipelineKey\)/);
    assert.match(HTML, /showPipeline: showPipeline/);
    assert.match(HTML, /FHPipelineBoard\.showPipeline\(pipelineKey\)/);
  });
});

describe("public/app/pipeline.html — phone and email open messaging", () => {

  test("cards link phone to the text thread and email to the email thread", () => {
    assert.match(HTML, /function messagingHref\(clientId, channel\)/);
    assert.match(HTML, /messaging\.html\?client_id=/);
    assert.match(HTML, /msgLine\("sms", c\.phone, c\.client_id, c\.sms_needs_reply\)/);
    assert.match(HTML, /msgLine\("email", c\.email, c\.client_id, c\.email_needs_reply\)/);
    assert.match(HTML, /contactRow\("Email", "email"/);
    assert.match(HTML, /contactRow\("Phone", "sms"/);
  });

  test("a red badge appears only when that channel needs a reply", () => {
    assert.match(HTML, /c-msg-badge/);
    assert.match(HTML, /Needs a reply/);
    assert.match(HTML, /if \(needsReply\)/);
  });

  test("clicking the number or email does not open the drawer or start a drag", () => {
    assert.match(HTML, /closest\("\.c-msg"\)/);
    assert.match(HTML, /e\.target\.closest\('\.c-msg'\)/);
  });
});

describe("public/app/pipeline.html — rail tab count duplicates removed", () => {
  test("rail tabs carry names only; count badges and their writer are gone", () => {
    assert.doesNotMatch(HTML, /rt-count|setRailCount|FH-RAILCOUNT/);
  });

  test("the page no longer makes a count-only request for hidden duplicate badges", () => {
    assert.doesNotMatch(HTML, /pipelineCounts|loadRailCounts/);
  });

  test("R-07 (affiliates_hiring) is retired and gone from the rail bar", () => {
    assert.ok(!/data-rail="R-07"/.test(HTML),
      "R-07 affiliates_hiring is retired; Hiring (R-09) and Affiliates + White Label (R-08) replace it");
    assert.ok(!/"R-0[0-9]":\s*"affiliates_hiring"/.test(HTML),
      "PIPELINE_KEYS must not still map any rail code to affiliates_hiring");
  });

  test("R-03 Alt-Fin (Lendflow) is parked off the desk; Card Stacking Apply stays", () => {
    assert.ok(!/<div class="rail-tab"[^>]*data-rail="R-03"/.test(HTML),
      "R-03 must not be a clickable rail tab");
    assert.ok(!/data-pipeline-key="funding_altfin"/.test(HTML),
      "MOVE must not offer an Alt-Fin (Lendflow) dest");
    assert.match(HTML, /data-pipeline-key="funding_card_stacking"/);
    assert.match(HTML, /Funding: Card Stacking · Apply Now/);
    assert.match(HTML, /"R-03":\s*"funding_altfin"/,
      "keep the pipeline key so the adapter and webhook still have a home");
  });

  test("R-08 and R-09 are real pipelines, not permanently-empty stubs", () => {
    assert.ok(!/rail-tab empty" data-rail="R-08"/.test(HTML),
      "R-08 maps to affiliates_white_label and should not carry empty styling");
    assert.ok(!/rail-tab empty" data-rail="R-09"/.test(HTML),
      "R-09 maps to hiring and should not carry empty styling");
    assert.match(HTML, /"R-08":\s*"affiliates_white_label"/);
    assert.match(HTML, /"R-09":\s*"hiring"/);
  });

  test("both the cache-hit path and the fresh-fetch path still paint the selected board", () => {
    assert.match(HTML, /applyBoard\(cache\[key\], rail, label, key\)/);
    assert.match(HTML, /applyBoard\(res\.data\.stages, rail, label, key\)/);
  });

  test("the board's first read waits for the deferred data.js", () => {
    // data.js carries `defer`, so FHData does not exist yet while the inline
    // script is being parsed. Calling it at parse time threw ReferenceError,
    // which killed the rest of the script, and the board never asked for a
    // single card. That shipped to production on 2026-08-17.
    assert.match(HTML, /<script defer src="data\.js">/,
      "data.js is expected to carry defer — if that changed, this guard needs rewriting");
    const listener = HTML.indexOf('document.addEventListener("DOMContentLoaded"');
    const firstRead = HTML.indexOf('load("R-01", "Sales")');
    assert.ok(listener !== -1, "the first board read must sit inside a DOMContentLoaded handler");
    assert.ok(firstRead > listener,
      'load("R-01", "Sales") must run on DOMContentLoaded, not while the page is parsing');
  });

});

/* ──────────────────────────────────────────────────────────────────────────
   THE FULFILLMENT LENS (option A) — a second way of looking at this same
   page, behind a switch. No new screen, no new tab, no new menu row.

   Same technique as the two blocks above: the decisions are a pure block
   marked FH-LENS-BEGIN/END inside the page, pulled out and run here with no
   DOM. What is proved below is the honest-degrade rule, because that is the
   part that can quietly become a lie: unknown must render an em dash and a
   sentence, never a zero.
   ────────────────────────────────────────────────────────────────────────── */

const LENS_BEGIN = "/* FH-LENS-BEGIN */";
const LENS_END = "/* FH-LENS-END */";

function loadLens() {
  const a = HTML.indexOf(LENS_BEGIN);
  const b = HTML.indexOf(LENS_END);
  assert.ok(a !== -1 && b > a, "the FH-LENS markers are gone from pipeline.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + LENS_BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-LENS" });
  return sandbox.window.FHFulfillmentLens;
}

describe("public/app/pipeline.html — fulfillment lens, the chip on each row", () => {

  test("it loads and exposes the lens helpers", () => {
    const L = loadLens();
    assert.equal(typeof L.chipOf, "function");
    assert.equal(typeof L.rollupText, "function");
    assert.equal(typeof L.roundText, "function");
  });

  test("a client with a next action shows that action, in the read layer's own words", () => {
    const L = loadLens();
    const chip = L.chipOf({
      next_action: { key: "pull_crs", label: "Pull CRS", why: "They paid for it and we have not pulled it." }
    });
    assert.equal(chip.key, "pull_crs");
    assert.equal(chip.label, "Pull CRS");
    assert.equal(chip.why, "They paid for it and we have not pulled it.");
  });

  test("no derivable action is a plain neutral chip that says so — never a blank cell", () => {
    const L = loadLens();
    for (const client of [
      {},                                        // nothing at all
      { next_action: null },                     // degraded, per the contract
      { next_action: { key: "", label: "" } },   // present but empty
      { next_action: "Pull CRS" },               // wrong type
      null,
      undefined
    ]) {
      const chip = L.chipOf(client);
      assert.equal(chip.key, L.UNKNOWN_KEY);
      assert.ok(chip.label.trim().length > 0, "the neutral chip must carry words");
      assert.ok(chip.why.trim().length > 0, "the neutral chip must say why");
    }
  });

  test("a chip is never blank even when the read layer sends a label with no reason", () => {
    const L = loadLens();
    const chip = L.chipOf({ next_action: { key: "get_consent", label: "Get Consent" } });
    assert.equal(chip.label, "Get Consent");
    assert.ok(chip.why.trim().length > 0);
  });

  test("chipCounts groups the list by chip, unknowns included", () => {
    const L = loadLens();
    const counts = L.chipCounts([
      { next_action: { key: "pull_crs", label: "Pull CRS" } },
      { next_action: { key: "pull_crs", label: "Pull CRS" } },
      { next_action: null }
    ]);
    assert.equal(counts.pull_crs, 2);
    assert.equal(counts[L.UNKNOWN_KEY], 1);
  });

  /* ── WORKED OUT AND NO STEP APPLIES IS NOT THE SAME AS NOT WORKED OUT ─────
     api/dashboard/clients.mjs attaches next_action_degraded beside the answer
     on every row. `false` there means the file WAS worked out — a repair-only
     client with no funding step is the everyday case, and calling that
     "we could not work it out" reports correct behaviour as a fault. It read
     that way for six real clients. */
  const WORKED_NO_STEP = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: false };
  const NOT_WORKED_OUT = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: true };

  test("a file that WAS worked out, with no step that applies, says exactly that", () => {
    const L = loadLens();
    const chip = L.chipOf(WORKED_NO_STEP);
    assert.equal(chip.key, L.NONE_APPLIES_KEY);
    assert.equal(chip.label, "No step applies right now.");
    assert.ok(!/not enough|could not/i.test(chip.label + " " + chip.why),
      "a worked-out answer must not read as a failure to read the file: " + chip.why);
  });

  test("a file that could not be read still says so, and not the same thing", () => {
    const L = loadLens();
    const chip = L.chipOf(NOT_WORKED_OUT);
    assert.equal(chip.key, L.UNKNOWN_KEY);
    assert.equal(chip.label, "Not worked out yet.");
  });

  test("the two are two different chips, two different keys and two different labels", () => {
    const L = loadLens();
    const none = L.chipOf(WORKED_NO_STEP);
    const notYet = L.chipOf(NOT_WORKED_OUT);
    assert.notEqual(none.key, notYet.key,
      "one key would file both answers under one label and count them as one pile");
    assert.notEqual(none.label, notYet.label);
    assert.notEqual(none.why, notYet.why);
    const counts = L.chipCounts([WORKED_NO_STEP, WORKED_NO_STEP, NOT_WORKED_OUT]);
    assert.equal(counts[L.NONE_APPLIES_KEY], 2);
    assert.equal(counts[L.UNKNOWN_KEY], 1);
  });

  /* NULL MEANS UNKNOWN AND MUST SURVIVE. Reading a missing or unreadable flag
     as "worked out" would put "No step applies right now." — which reads as an
     all-clear — on a client nobody worked out. */
  test("only an explicit false says the file was worked out", () => {
    const L = loadLens();
    for (const flag of [undefined, null, "false", 0, "", "no", {}, NaN]) {
      const chip = L.chipOf({ next_action: null, next_action_degraded: flag });
      assert.equal(chip.key, L.UNKNOWN_KEY,
        "a degraded flag of " + JSON.stringify(flag) + " was read as a worked-out answer");
    }
  });

  test("a reply we cannot read is never reported as 'no step applies'", () => {
    const L = loadLens();
    for (const na of ["Pull CRS", 7, true, ["Pull CRS"]]) {
      const chip = L.chipOf({ next_action: na, next_action_degraded: false });
      assert.equal(chip.key, L.UNKNOWN_KEY,
        "an unreadable next_action of " + JSON.stringify(na) + " was read as an answer");
    }
  });

  test("both answers that are not a step are marked neutral, and a real step is not", () => {
    const L = loadLens();
    assert.equal(L.chipOf(WORKED_NO_STEP).neutral, true);
    assert.equal(L.chipOf(NOT_WORKED_OUT).neutral, true);
    assert.equal(L.chipOf({ next_action: { key: "get_consent", label: "Get Consent" } }).neutral, false);
  });

  /* The row builder styles and describes the chip from `neutral`, not from one
     hardcoded key, or the second neutral chip would be drawn as a real step. */
  test("the row builder reads the neutral flag rather than one key", () => {
    assert.match(HTML, /btn\.className = "fh-chip" \+ \(chip\.neutral \? " unknown" : ""\);/,
      "the chip's styling stopped following the neutral flag");
    assert.ok(!/chip\.key === L\.UNKNOWN_KEY/.test(HTML),
      "the row builder is back to testing one key, so the other neutral chip is drawn as a step");
  });
});

describe("public/app/pipeline.html — fulfillment lens, money is never invented", () => {

  /* THE UNIT IS WHOLE DOLLARS, for a number and for a numeric string alike.
     This used to read a number as integer cents on the strength of
     CLAUDE.md §12, which made the same value render 100x smaller here than on
     client-control-panel.html. §12 describes src/commissions/money.mjs, and
     that module converts INTO cents at its own door — calculate.mjs:59 calls
     toCents(round.funded_amount), which only makes sense because the column
     holds dollars. Both values this screen shows are dollars:
     funding_rounds.approved_amount is numeric(14,2) and reaches JavaScript as
     a STRING of dollars, and custom_fields.total_funding_estimate is written
     in dollars as a NUMBER by client-lifecycle.mjs:449. */
  test("a number is whole dollars, and so is a numeric string", () => {
    const L = loadLens();
    assert.equal(L.moneyText(50000), "$50,000");
    assert.equal(L.moneyText("50000.00"), "$50,000");
    assert.equal(L.moneyText(5000000), "$5,000,000",
      "a number was read as cents again, so every amount on this screen is 100x too small");
  });

  test("unknown money comes back null so the screen prints a dash, never $0", () => {
    const L = loadLens();
    for (const v of [null, undefined, "", "   ", "unknown", {}, [], NaN, true, false, "1,000", "$5"]) {
      assert.equal(L.moneyText(v), null, "unknown money must not become a number: " + JSON.stringify(v));
    }
  });

  test("dollars and cents round to the nearest dollar rather than going unknown", () => {
    const L = loadLens();
    assert.equal(L.moneyText(12.5), "$13");
    assert.equal(L.moneyText("12.49"), "$12");
  });

  test("a real zero still prints as a real zero", () => {
    const L = loadLens();
    assert.equal(L.moneyText(0), "$0");
    assert.equal(L.moneyText("0.00"), "$0");
  });
});

describe("public/app/pipeline.html — fulfillment lens, the six rollup tiles", () => {

  test("the whole rollups object missing leaves every tile a dash and says why", () => {
    const L = loadLens();
    for (const id of L.TILE_IDS) {
      const out = L.rollupText(undefined, id);
      assert.equal(out.value, "—", id + " must be a dash when nothing came back");
      assert.ok(out.note.trim().length > 0, id + " must say why it is a dash");
    }
  });

  test("Ready has no honest source — it renders a dash and a sentence, never 0", () => {
    const L = loadLens();
    const out = L.rollupText({ ready: null }, "ready");
    assert.equal(out.value, "—");
    assert.notEqual(out.value, "0");
    assert.match(out.note, /false claim/i);
  });

  test("Total Approved with no approval recorded — dash and a sentence, never $0", () => {
    const L = loadLens();
    const out = L.rollupText({ total_approved: null }, "total_approved");
    assert.equal(out.value, "—");
    assert.match(out.note, /false claim/i);
    assert.doesNotMatch(out.note, /no honest source/i,
      "the rounds ARE the honest source now — a dash means nothing is recorded, not that nothing can be");
  });

  /* HOLE 8. Sim Eight-Funding on live, 2026-09-17: two funded $25,000 rounds,
     one $10,000 bank yes on round 2 and none on round 1. The tile read
     "No bank approval has ever been recorded". It must now show the $10,000
     and say why it is below the funded money. */
  test("Total Approved shows the recorded approvals and says why they are below the funded money", () => {
    const L = loadLens();
    const out = L.rollupText({
      total_approved: "10000.00", total_approved_rounds: 1, funded_rounds_no_approval: 1
    }, "total_approved");
    assert.equal(out.value, "$10,000");
    assert.match(out.note, /From 1 round with a bank approval on file\./);
    assert.match(out.note, /1 funded round has no approval recorded\./);
  });

  test("Total Approved says nothing extra when every funded round has an approval", () => {
    const L = loadLens();
    const out = L.rollupText({
      total_approved: "105000.00", total_approved_rounds: 3, funded_rounds_no_approval: 0
    }, "total_approved");
    assert.equal(out.value, "$105,000");
    assert.equal(out.note, "From 3 rounds with a bank approval on file.");
  });

  /* The fixture is the STRING listRollups() really sends — SUM(...)::numeric
     comes out of node-postgres as a string of dollars, which
     src/fulfillment/read-signals.pg.test.mjs:121 pins as "50000". */
  test("Total Prequal shows the contributing client count beside it", () => {
    const L = loadLens();
    const out = L.rollupText({ total_prequal: "50000", total_prequal_clients: 1 }, "total_prequal");
    assert.equal(out.value, "$50,000");
    assert.match(out.note, /From 1 client\b/);
    assert.match(out.note, /not a company total/i);
  });

  test("Total Prequal without a contributing count still refuses to read as a company total", () => {
    const L = loadLens();
    const out = L.rollupText({ total_prequal: "50000" }, "total_prequal");
    assert.equal(out.value, "$50,000");
    assert.match(out.note, /not a company total/i);
  });

  test("Total Prequal reads a number as dollars too, not as cents", () => {
    const L = loadLens();
    const out = L.rollupText({ total_prequal: 50000, total_prequal_clients: 1 }, "total_prequal");
    assert.equal(out.value, "$50,000",
      "the tile went back to reading a number as cents, so it reads 100x too small");
  });

  test("a real count renders, including a real zero", () => {
    const L = loadLens();
    assert.equal(L.rollupText({ total_clients: 37 }, "total_clients").value, "37");
    assert.equal(L.rollupText({ needs_pull: 0 }, "needs_pull").value, "0");
  });

  test("a count that is not a number is a dash, not a guess", () => {
    const L = loadLens();
    assert.equal(L.rollupText({ action_needed: "26" }, "action_needed").value, "—");
    assert.equal(L.rollupText({ action_needed: null }, "action_needed").value, "—");
  });

  /* "Needs Pull" counts only clients whose written permission is live. The ones
     it leaves out have paid and have nothing pulled, so they must be named on
     the tile rather than quietly disappearing from the screen. It is a SENTENCE
     under the existing tile, never a seventh tile — Chris approved six. */
  test("Needs Pull says how many are waiting on written permission", () => {
    const L = loadLens();
    const out = L.rollupText({ needs_pull: 4, needs_consent: 2 }, "needs_pull");
    assert.equal(out.value, "4");
    assert.match(out.note, /2 more are waiting on written permission/i);
  });

  test("one client waiting on permission reads as one, not as '1 are'", () => {
    const L = loadLens();
    assert.match(L.rollupText({ needs_pull: 4, needs_consent: 1 }, "needs_pull").note,
      /1 more is waiting on written permission/i);
  });

  test("nobody waiting, or the count missing, adds no sentence", () => {
    const L = loadLens();
    assert.equal(L.rollupText({ needs_pull: 4, needs_consent: 0 }, "needs_pull").note, "");
    assert.equal(L.rollupText({ needs_pull: 4 }, "needs_pull").note, "",
      "an absent count must say nothing, never zero — we did not measure it");
    assert.equal(L.rollupText({ needs_pull: 4, needs_consent: null }, "needs_pull").note, "");
  });

  test("there are still only six tiles — needs_consent is not one of them", () => {
    const L = loadLens();
    assert.equal(L.TILE_IDS.length, 6);
    assert.ok(!L.TILE_IDS.includes("needs_consent"),
      "a seventh tile appeared on a screen Chris approved with six");
  });

  /* THE TILE COUNTS THE WHOLE BOOK; THE LIST UNDER IT IS ONE PAGE. "Total
     clients 431" printed above a list of 200, with nothing saying so, is the
     screen making a claim it cannot back up. One sentence, and only when the
     two numbers really do disagree. No seventh tile and no paging control. */
  test("Total clients says so when the list below is showing fewer", () => {
    const L = loadLens();
    const out = L.rollupText({ total_clients: 431 }, "total_clients", 200);
    assert.equal(out.value, "431");
    assert.match(out.note, /list below shows 200 of these 431/i);
  });

  test("a list showing everyone adds no sentence", () => {
    const L = loadLens();
    assert.equal(L.rollupText({ total_clients: 47 }, "total_clients", 47).note, "",
      "the list is showing every client, so there is nothing to warn about");
    assert.equal(L.rollupText({ total_clients: 47 }, "total_clients", 0).value, "47");
  });

  test("not knowing how many are on screen says nothing, rather than guessing", () => {
    const L = loadLens();
    for (const shown of [undefined, null, "200", NaN, -1 / 0]) {
      assert.equal(L.rollupText({ total_clients: 431 }, "total_clients", shown).note, "",
        "the tile invented a claim about the list from " + String(shown));
    }
  });

  test("the sentence never appears on a tile that is not Total clients", () => {
    const L = loadLens();
    assert.equal(L.rollupText({ needs_pull: 4 }, "needs_pull", 1).note, "");
    assert.equal(L.rollupText({ action_needed: 9 }, "action_needed", 1).note, "");
  });
});

describe("public/app/pipeline.html — fulfillment lens, blockers and the funding round", () => {

  test("blockers survive with their severity; anything unreadable is dropped, not invented", () => {
    const L = loadLens();
    const out = L.blockersOf({ active_blockers: [
      { key: "fraud_alert", label: "Fraud alert on file", severity: "high" },
      { key: "consent_missing", label: "No written permission", severity: "normal" },
      { key: "no_label" },
      "nonsense"
    ] });
    assert.equal(out.length, 3);
    assert.equal(out[0].severity, "high");
    assert.equal(out[1].severity, "normal");
    assert.equal(out[2].label, "no_label", "a blocker with only a key still shows the key");
  });

  test("no blockers, or a shape that is not a list, is an empty list — never a crash", () => {
    const L = loadLens();
    assert.deepEqual(L.blockersOf({}), []);
    assert.deepEqual(L.blockersOf({ active_blockers: null }), []);
    assert.deepEqual(L.blockersOf(null), []);
  });

  test("an unknown approved amount reads as a dash on the round line, never $0", () => {
    const L = loadLens();
    const line = L.roundText({ number: 2, status: "hold", hold_reason: "Fraud Alert", approved_amount: null });
    assert.match(line, /Round 2/);
    assert.match(line, /held: Fraud Alert/);
    assert.match(line, /approved —/);
    assert.ok(!/\$0\b/.test(line), "a null approved amount must never print as $0");
  });

  test("no funding round at all is no line, not an empty one", () => {
    const L = loadLens();
    assert.equal(L.roundText(null), null);
    assert.equal(L.roundText(undefined), null);
  });
});

describe("public/app/pipeline.html — fulfillment lens, the switch and the board underneath", () => {

  test("the lens is a switch on this page, not a new screen, tab or menu row", () => {
    assert.match(HTML, /id="lensSwitch"/);
    assert.match(HTML, /id="lensBoard"[^>]*class="on"/, "Board is the default view");
    assert.match(HTML, /id="lensFulfillment"/);
    // No new sidebar row and no new rail tab were added for this.
    const navRows = [...HTML.matchAll(/class="navitem[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(!navRows.some((h) => /fulfil/i.test(h)), "the lens must not add a menu row");
    assert.ok(!/data-rail="R-1[0-9]"/.test(HTML), "the lens must not add a rail tab");
  });

  test("the lens starts hidden and the board starts visible", () => {
    assert.match(HTML, /<section class="fh-lens" id="fhLens" hidden/);
    assert.ok(!/<div class="board-row"[^>]*\bhidden\b/.test(HTML),
      "the board must not carry hidden in the markup — the lens is off by default");
  });

  test("all six rollup tiles are on the page and every one starts on a dash", () => {
    for (const id of ["ltTotalClients", "ltNeedsPull", "ltActionNeeded", "ltReady", "ltTotalPrequal", "ltTotalApproved"]) {
      assert.match(HTML, new RegExp('<b id="' + id + '">—</b>'),
        id + " must start on a dash, not an invented number");
    }
    for (const label of ["Total clients", "Needs Pull", "Action Needed", "Ready", "Total Prequal", "Total Approved"]) {
      assert.ok(HTML.includes(">" + label + "</span>"), "missing tile: " + label);
    }
  });

  test("the lens reads and displays only — no write, no new route", () => {
    const a = HTML.indexOf(LENS_BEGIN);
    const b = HTML.indexOf("function tickClock");
    assert.ok(a !== -1 && b > a);
    const lens = HTML.slice(a, b);
    assert.ok(!/FHData\.write\(/.test(lens), "the lens must not write");
    assert.ok(!/method:\s*["']POST["']/.test(lens), "the lens must not POST");
    assert.ok(!/fetch\(/.test(lens), "the lens goes through FHData, it does not fetch on its own");
    assert.match(lens, /FHData\.clients\(/, "the lens reads the existing clients endpoint");
  });

  test("the board's own machinery is still there and still first", () => {
    // The lens must not have displaced anything the board depends on.
    assert.ok(HTML.indexOf("/* FH-SUMMARY-BEGIN */") < HTML.indexOf(LENS_BEGIN));
    assert.match(HTML, /window\.FHPipelineBoard = \{/);
    assert.match(HTML, /board\.addEventListener\('pointerdown'/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE PHONE LAYOUT

   Measured at 390px before this block existed: the filter bar wanted 481px of
   a 390px screen, so the search box collapsed to a bare icon with a 4px input,
   "$50,000 est." was cut at the screen edge and "— held" sat 53px past it; and
   on the lens, 82 coloured labels landed on top of the sentence beside them,
   21 of those running off the card. At 1440 both numbers were already zero,
   which is why every rule here is inside the query and none of them may leave
   it — a rule that escapes changes the desktop screen.
   ──────────────────────────────────────────────────────────────────────────── */

describe("public/app/pipeline.html — the phone layout", () => {

  const QUERY = "@media (max-width: 640px)";

  function phoneBlock() {
    const a = HTML.indexOf(QUERY);
    assert.ok(a !== -1,
      "the phone block is gone, so the toolbar squeezes the money summary off the screen again at 390px");
    const open = HTML.indexOf("{", a);
    let depth = 0, end = -1;
    for (let j = open; j < HTML.length; j++) {
      if (HTML[j] === "{") depth++;
      else if (HTML[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    assert.ok(end > open, "the phone block never closes");
    return HTML.slice(open + 1, end);
  }

  test("the filter bar wraps instead of squeezing, and no control is dropped", () => {
    const css = phoneBlock();
    assert.match(css, /\.filterbar\{[^}]*flex-wrap:wrap/, "the bar must be allowed a second line");
    /* The .filter-spacer rule that used to be asserted here is GONE, because
       the spacer itself is gone (2026-08-30). Its whole job was pushing
       .board-summary to the far right of the filter bar, and the summary no
       longer lives there — it sits in .headline, at the top of the page, next
       to the number the screen is for. The phone-side risk it guarded against
       has not gone away, so it is guarded on the new element instead:
       .hl-ref must stand its margin-left:auto down and take a line of its
       own, or the counters get pushed off the right edge at 390px exactly the
       way the money figures used to be. */
    assert.match(css, /\.hl-ref\{[^}]*margin-left:0/,
      "margin-left:auto is what would push the counters off the right edge on a phone");
    assert.match(css, /\.hl-ref\{flex:1 0 100%/, "the counters need a line of their own");
    assert.match(css, /\.hl-lead\{flex:1 0 100%;\}/,
      "the number and its next action keep the top of the screen");
    assert.match(css, /\.board-summary\{flex:1 0 100%/, "the summary needs a line of its own");
    assert.match(css, /\.filterbar \.search\{[^}]*flex:1 1 auto/,
      "the search must stretch rather than shrink to an icon");
    for (const gone of [".search{display:none", "#filterBtn{display:none", "#fhNewClient{display:none", ".lens-switch{display:none",
                        ".board-summary{display:none", ".filter-btn{display:none"]) {
      assert.ok(!css.includes(gone), "a control was hidden on a phone rather than given room: " + gone);
    }
  });

  test("a money figure can never be cut in half", () => {
    const css = phoneBlock();
    assert.match(css, /\.board-summary > span\{white-space:nowrap;\}/,
      "each figure has to stay whole; wrapping BETWEEN them is what a narrow screen is for");
  });

  test("the lens row stacks, so a label wider than the card has somewhere to go", () => {
    const css = phoneBlock();
    assert.match(css, /\.fh-lens-row\{flex-direction:column/);
    assert.match(css, /\.lr-blocker\{white-space:normal;\}/);
    assert.match(css, /\.fh-chip\{white-space:normal/);
    assert.match(css, /\.lr-side\{[^}]*max-width:100%/,
      "the side column capped at 48% is what pushed the labels over the sentence");
  });

  test("the desktop rules the phone block overrides are still there, unchanged", () => {
    // If these moved or lost their values, the 1440 rendering moved with them.
    assert.match(HTML, /\.lr-side\{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;max-width:48%;\}/);
    assert.match(HTML, /\.lr-blocker\{[^}]*white-space:nowrap;\}/);
    assert.match(HTML, /\.search\{[^}]*width:230px;/);
    assert.match(HTML, /\.hl-ref\{display:flex;[^}]*margin-left:auto;\}/,
      "on a desktop the counters sit to the right of the number; the phone block is what stands that down");
  });

  test("the spacer that pushed the only numbers to the far right is gone for good", () => {
    // UI-STANDARDS §1: top-left is the number, never a filter. `.filter-spacer
    // {flex:1}` existed to do the exact opposite — it shoved .board-summary as
    // far from the top-left as one row allows, which left a filter as the
    // leftmost thing on all three bars of the reference screen. If it comes
    // back, so does the shape.
    assert.ok(!/\.filter-spacer\s*\{/.test(SHIPPED), "the .filter-spacer rule is back");
    assert.ok(!/class="filter-spacer"/.test(SHIPPED), "the spacer element is back in the filter bar");
  });

  test("every phone rule is inside the query — none of them can reach a desktop", () => {
    const a = HTML.indexOf(QUERY);
    const css = phoneBlock();
    const end = a + HTML.slice(a).indexOf(css) + css.length;
    const outside = HTML.slice(0, a) + HTML.slice(end);
    for (const rule of [".board-summary > span{white-space:nowrap",
                        ".fh-lens-row{flex-direction:column",
                        ".lr-blocker{white-space:normal",
                        ".hl-lead{flex:1 0 100%",
                        ".hl-sep{display:none"]) {
      assert.ok(!outside.includes(rule), "a phone-only rule escaped the media query: " + rule);
    }
  });
});

/* ── The jump highlight has to PAINT ────────────────────────────────────────
 *
 * e2e/pipeline-waiting-on.spec.mjs measures the computed ring in a real
 * browser, which is the honest proof. This is the cheap backstop that runs on
 * every `npm test` while Playwright is a separate command: a gradient sitting
 * in a colour slot is invalid whatever the rest of the page does, so it can be
 * caught by reading the file.
 *
 * The rule shipped as `box-shadow:0 0 0 3px var(--spectrum)`. --spectrum is a
 * linear-gradient. box-shadow's colour component must be a <color>, so the
 * declaration was invalid at computed-value time and fell back to `none` —
 * taking the resting card shadow with it and leaving the card the user had
 * just been sent to as the only flat one on the board.
 */
describe("public/app/pipeline.html — the jump highlight paints something", () => {

  /* Every value this screen's own CSS assigns to `prop`. */
  function declarations(prop) {
    const out = [];
    const re = new RegExp("(?:^|[;{])\\s*" + prop + "\\s*:([^;}]+)", "g");
    let m;
    while ((m = re.exec(SHIPPED)) !== null) out.push(m[1].trim());
    return out;
  }

  test("no shadow, outline or border on this screen puts a gradient in a colour slot", () => {
    // --spectrum is the only gradient token the brand file hands out. It is
    // legal on `background` — .drop-line uses it correctly — and on none of
    // these, every one of which takes a <color>.
    for (const prop of ["box-shadow", "outline", "outline-color", "border-color", "text-shadow"]) {
      for (const value of declarations(prop)) {
        assert.ok(!/--spectrum/.test(value),
          prop + " takes a colour, not a gradient: `" + prop + ":" + value +
          "` is invalid at computed-value time and paints nothing at all");
      }
    }
  });

  test("the spot rule keeps the resting card shadow instead of replacing it", () => {
    const m = SHIPPED.match(/\.card\.fh-spot[^{]*\{([^}]*)\}/);
    assert.ok(m, "the .card.fh-spot rule is gone — if the highlight was removed, remove this test with it");
    const body = m[1];
    assert.match(body, /box-shadow:\s*var\(--panel-shadow\)/,
      "without --panel-shadow first, .card.fh-spot (0,2,0) beats the brand file's resting card shadow " +
      "and the card the jump lands on goes FLATTER than its neighbours");
    assert.match(body, /0 0 0 3px var\(--ink\)/,
      "the ring needs the validated ink hex — a ramp stop such as --accent can be washed out to the " +
      "board colour by a one-hue tenant (UI-STANDARDS 12.6)");
  });

  test("the spot rule survives the pointer landing on the card", () => {
    // .card:hover is declared later in the file at the same specificity (0,2,0)
    // and wins the tie, so the spot rule has to name :hover itself. Measured
    // 2026-08-30: stripping `:hover` from that selector in the live CSSOM drops
    // the ring to `rgba(0,0,0,.07) 0 1px 3px` the moment the card is hovered.
    const spot = SHIPPED.indexOf(".card.fh-spot");
    const hover = SHIPPED.indexOf(".card:hover");
    assert.ok(spot !== -1 && hover !== -1, "one of .card.fh-spot / .card:hover has gone");
    if (hover > spot) {
      assert.match(SHIPPED, /\.card\.fh-spot:hover/,
        ".card:hover is declared after .card.fh-spot and outranks it on a tie, so the spot rule must name :hover");
    }
  });
});
