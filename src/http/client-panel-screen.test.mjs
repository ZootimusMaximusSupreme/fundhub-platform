/* Tests for public/app/client-control-panel.html's two load-bearing decisions,
 * plus the one rule it has to share with public/app/pipeline.html.
 *
 * COMPLIANCE REVIEW REQUIRED — the first describe below is compliance GATE A
 * as it reaches the screen. Gate A says a client with no recorded consent is
 * NEVER shown "Pull CRS". src/fulfillment/next-action.mjs enforces that in the
 * derivation, but the screen used to undo it: when the derivation came back
 * degraded (which is exactly what a consent read failing produces), the page
 * painted custom_fields.employee_next_action into the big Next Action slot,
 * and that stored string is written without any consent check by
 * src/workflows/s-06-post-call-funding-purchased.mjs:42 and
 * src/workflows/c-05-pre-funding-review.mjs:44 — both of them the literal
 * "Pull CRS". These tests fail if that comes back.
 *
 * WHY IT LIVES HERE. package.json's test glob is "src/**" and "scripts/**", so
 * a test under api/ or public/ is silently never collected (CLAUDE.md §12).
 * The decisions are pulled out of the page between the FH-CCP-BEGIN/END
 * markers and run with no DOM, the same technique
 * src/http/pipeline-screen.test.mjs uses on that page's FH-LENS block.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { sanitizeBlockerLabels } from "../fulfillment/next-action.mjs";
/* The server's own definition of "a bank yes that is not worth anything yet",
   read here so the screen's copy of it can be proved against the real thing
   rather than against a second copy typed into this file. */
import { unpricedApprovalConditions, confirmedApprovalConditions } from "../funding/success-fee.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, "../../public/app/client-control-panel.html");
const PIPELINE = path.resolve(HERE, "../../public/app/pipeline.html");
const PANEL_HTML = fs.readFileSync(PANEL, "utf8");
const PIPELINE_HTML = fs.readFileSync(PIPELINE, "utf8");

function runBlock(html, file, begin, end, pick) {
  const a = html.indexOf(begin);
  const b = html.indexOf(end);
  assert.ok(a !== -1 && b > a, "the " + begin.trim() + " markers are gone from " + file);
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // From `a`, not past it: FH-CCP-BEGIN opens a block comment that closes
  // further down, so cutting the marker off would leave dangling text.
  vm.runInContext(html.slice(a, b), sandbox, { filename: file + "#" + begin.trim() });
  const out = pick(sandbox.window);
  assert.ok(out, file + " stopped exposing its tested block");
  return out;
}

const loadPanel = () =>
  runBlock(PANEL_HTML, PANEL, "/* FH-CCP-BEGIN", "/* FH-CCP-END */", (w) => w.FHClientPanel);

const loadLens = () =>
  runBlock(PIPELINE_HTML, PIPELINE, "/* FH-LENS-BEGIN */", "/* FH-LENS-END */", (w) => w.FHFulfillmentLens);

/* The shape GET /api/dashboard/client sends when the derivation could not be
   worked out. deriveNextAction() never returns a label beside degraded:true —
   see the guards at src/fulfillment/next-action.mjs:598-608. */
const DEGRADED = { next_action: null, active_blockers: [], funding_round: null, degraded: true };
const STORED_PULL = { employee_next_action: "Pull CRS" };

/* ────────────────────────────────────────────────────────────────────────────
   GATE A ON SCREEN
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the big Next Action slot never carries stored text", () => {

  test("it loads and exposes the two decisions", () => {
    const P = loadPanel();
    assert.equal(typeof P.money, "function");
    assert.equal(typeof P.nextAction, "function");
    assert.equal(typeof P.displayStatus, "function");
    assert.equal(typeof P.displayHold, "function");
  });

  test("New Lead becomes Apply Now when that is the worked-out job", () => {
    const P = loadPanel();
    const fx = { next_action: { key: "apply_for_funding", label: "Apply for Funding" }, degraded: false };
    assert.equal(P.displayStatus("New Lead", fx), "Apply Now");
    assert.equal(P.displayStatus("Funding Client", fx), "Funding Client");
    assert.equal(P.displayStatus("New Lead", { next_action: { key: "get_consent" } }), "New Lead");
  });

  test("Awaiting CRS hold is dropped when scores sit on the page", () => {
    const P = loadPanel();
    assert.equal(P.displayHold("Awaiting CRS", { scores_on_file: true }), "");
    assert.equal(P.displayHold("Awaiting CRS", { scores_on_file: false }), "Awaiting CRS");
    assert.equal(P.displayHold("Missing Documents", { scores_on_file: true }), "Missing Documents");
  });

  test("saved Pull CRS is hidden when scores sit on the page", () => {
    const P = loadPanel();
    const fx = {
      next_action: { key: "apply_for_funding", label: "Apply for Funding" },
      degraded: false,
      scores_on_file: true
    };
    const out = P.nextAction(fx, STORED_PULL);
    assert.equal(out.main, "Apply for Funding");
    assert.equal(out.saved, "");
  });

  test("GATE A: a degraded answer carrying a stored 'Pull CRS' must not put it in the big slot", () => {
    const P = loadPanel();
    const out = P.nextAction(DEGRADED, STORED_PULL);
    assert.notEqual(out.main, "Pull CRS",
      "the compliance leak is back: a client whose consent could not be established " +
      "is being told to pull their credit");
    assert.ok(!/pull crs/i.test(out.main),
      "the big slot must not contain the stored instruction in any form: " + out.main);
  });

  test("GATE A: no derivation sent at all is the same refusal", () => {
    const P = loadPanel();
    for (const fx of [null, undefined]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.ok(!/pull crs/i.test(out.main),
        "with nothing worked out the big slot fell back to the stored instruction");
    }
  });

  test("GATE A: a broken payload cannot smuggle the stored text through either", () => {
    const P = loadPanel();
    for (const fx of [{}, { degraded: true }, { degraded: "yes" }, "degraded", 7, []]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.ok(!/pull crs/i.test(out.main),
        "a payload of " + JSON.stringify(fx) + " leaked the stored instruction into the big slot");
    }
  });

  test("nothing worked out says so in plain words — never blank, never a bare dash", () => {
    const P = loadPanel();
    for (const fx of [null, undefined, DEGRADED]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.equal(out.main, P.NOT_WORKED_OUT);
      assert.ok(out.main.trim().length > 0, "the big slot went blank");
      assert.notEqual(out.main.trim(), "—", "a bare dash with no explanation is not an answer");
    }
  });

  test("the stored value is kept, below, labelled as saved rather than as the instruction", () => {
    const P = loadPanel();
    const out = P.nextAction(DEGRADED, STORED_PULL);
    assert.ok(out.saved.indexOf("Pull CRS") !== -1,
      "staff lost the information that used to be on screen");
    assert.ok(/saved on the record/i.test(out.saved),
      "the saved line must say what it is, or it reads as an instruction again: " + out.saved);
    assert.notEqual(out.saved, out.main);
  });

  test("a worked-out step is what the big slot shows", () => {
    const P = loadPanel();
    const out = P.nextAction(
      { next_action: { key: "get_consent", label: "Get Consent", why: "no consent on file" },
        active_blockers: [], funding_round: null, degraded: false },
      STORED_PULL
    );
    assert.equal(out.main, "Get Consent");
    assert.ok(out.saved.indexOf("Pull CRS") !== -1, "the saved value still has to be visible somewhere");
  });

  /* This slot used to go blank here, and the page painted the blank as an em
     dash. Beside a "Saved on the record: Pull CRS" line that read as a heading,
     a dash, and then the forbidden words — the worst of the three renderings.
     Chris asked for derived truth "or plainly says none applies", so it says
     so in words. */
  const WORKED_NO_STEP =
    { next_action: null, active_blockers: [], funding_round: null, degraded: false };

  test("a worked-out answer with no step says none applies, in words — never blank, never a bare dash", () => {
    const P = loadPanel();
    const out = P.nextAction(WORKED_NO_STEP, {});
    assert.equal(out.main, P.NONE_APPLIES);
    assert.notEqual(out.main, "", "the big slot went blank and the page painted a bare dash");
    assert.ok(out.main.trim().length > 0, "the big slot went blank");
    assert.notEqual(out.main.trim(), "—", "a bare dash with no explanation is not an answer");
    assert.equal(out.saved, "");
  });

  test("none applies is still not an invitation to do the saved value", () => {
    const P = loadPanel();
    const out = P.nextAction(WORKED_NO_STEP, STORED_PULL);
    assert.equal(out.main, P.NONE_APPLIES);
    assert.ok(!/pull crs/i.test(out.main), "the big slot leaked the stored instruction: " + out.main);
    assert.ok(/saved on the record/i.test(out.saved),
      "the stored value must stay, labelled as what is on the record: " + out.saved);
  });

  /* The three answers have to be three different sentences. Two of them
     reading the same is how "we could not work it out" gets mistaken for
     "there is nothing to do", which are opposite instructions to staff. */
  test("the three cases are three different sentences, each of them plain words", () => {
    const P = loadPanel();
    const step = P.nextAction(
      { next_action: { key: "get_consent", label: "Get Consent" },
        active_blockers: [], funding_round: null, degraded: false }, {}).main;
    const none = P.nextAction(WORKED_NO_STEP, {}).main;
    const notYet = P.nextAction(DEGRADED, {}).main;
    assert.equal(step, "Get Consent");
    assert.equal(none, P.NONE_APPLIES);
    assert.equal(notYet, P.NOT_WORKED_OUT);
    assert.equal(new Set([step, none, notYet]).size, 3,
      "two of the three answers read the same: " + JSON.stringify([step, none, notYet]));
    for (const words of [none, notYet]) {
      assert.ok(/^[A-Z]/.test(words) && /[a-z]{3}/.test(words) && words.trim() !== "—",
        "this has to read as a sentence a non-coder understands, not a symbol: " + JSON.stringify(words));
    }
  });

  test("no saved line when there is nothing saved, or when it matches the worked-out step", () => {
    const P = loadPanel();
    const worked = { next_action: { key: "get_consent", label: "Get Consent" },
      active_blockers: [], funding_round: null, degraded: false };
    assert.equal(P.nextAction(worked, {}).saved, "");
    assert.equal(P.nextAction(worked, null).saved, "");
    assert.equal(P.nextAction(worked, { employee_next_action: "   " }).saved, "");
    assert.equal(P.nextAction(worked, { employee_next_action: "Get Consent" }).saved, "",
      "the same words twice is noise, not information");
  });

  test("it never throws, whatever it is handed", () => {
    const P = loadPanel();
    const nasty = { get employee_next_action() { throw new Error("boom"); } };
    for (const args of [[undefined, undefined], [DEGRADED, nasty], [nasty, nasty], [0, ""], [[], []]]) {
      const out = P.nextAction(args[0], args[1]);
      assert.equal(typeof out.main, "string");
      assert.equal(typeof out.saved, "string");
      assert.ok(!/pull crs/i.test(out.main));
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE SAME PAGE, THE SAME SOURCE — the leak has to stay shut in the page
   itself, not only in the block pulled out of it.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the page wires both slots to the guarded rule", () => {

  test("both big slots are painted by paintNextAction and nothing else", () => {
    for (const id of ["ccp-next-action", "ccp-cp-action"]) {
      const painted = new RegExp('paintNextAction\\("' + id + '"');
      assert.match(PANEL_HTML, painted, id + " is no longer painted through the guarded rule");
      const direct = new RegExp('setText\\("' + id + '"');
      assert.ok(!direct.test(PANEL_HTML),
        id + " is being set directly again, which is how the stored text got in");
    }
  });

  /* A typo in one of these ids would fail silently in the browser: the saved
     line would simply never appear and nobody would know the value was lost. */
  test("each big slot has a saved line under it, and the class it needs", () => {
    for (const pair of [["ccp-next-action", "ccp-saved"], ["ccp-cp-action", "ccp-cp-saved"]]) {
      assert.match(PANEL_HTML, new RegExp('id="' + pair[0] + '"'), pair[0] + " is gone from the page");
      assert.match(PANEL_HTML, new RegExp('class="na-saved" id="' + pair[1] + '" hidden'),
        pair[1] + " is missing, so the saved value would vanish instead of moving below");
      assert.match(PANEL_HTML, new RegExp('paintNextAction\\("' + pair[0] + '", "' + pair[1] + '"'),
        pair[0] + " and " + pair[1] + " are no longer painted together");
    }
    assert.match(PANEL_HTML, /\.na-saved\{/, "the saved line lost its styling and would read as body text");
  });

  test("employee_next_action is read in exactly one place — the saved line", () => {
    // Block comments are stripped first: this file explains the rule in prose
    // several times, and prose is not a read.
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = code.split("\n").filter((line) => /\.employee_next_action\b/.test(line));
    assert.equal(hits.length, 1,
      "the stored next action is read in " + hits.length + " places; it must only feed the " +
      "labelled saved line. Found: " + JSON.stringify(hits));
    assert.match(hits[0], /stored =/,
      "employee_next_action is being used for something other than the saved line");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GATE A IN THE PRE-EXISTING BLOCKERS PANEL — the one that was still leaking

   THE DEFECT THIS CLOSES. Gate A was enforced inside the derivation, so the
   new control block below was safe. The Blockers panel at the TOP of this page
   is older and is painted straight from the endpoint's raw `open_blockers`
   array — paintBlockers(d.open_blockers, hold) — and so is the new block's
   fallback when no derivation arrives. Both printed the task title verbatim.
   On a real client with no recorded permission the top panel read "Funding
   intake — pull CRS" while the block below it read "waiting on written
   permission": two panels, one screen, contradicting each other.

   Patching each panel is what failed three times. The fix is that the API
   never emits the raw words — api/dashboard/client.mjs runs
   sanitizeBlockerLabels() on the array it sends. These tests paint the REAL
   pre-existing panel function, lifted out of the page, with the REAL sanitizer
   output, so the panel is proved safe without the page being touched at all.
   That the endpoint actually runs the sanitizer is proved in
   src/http/dashboard-next-action.test.mjs.
   ──────────────────────────────────────────────────────────────────────────── */

/* The page's own paintBlockers(), lifted out by source. Its two helpers ($ and
   dash) and `document` are supplied below, so this paints the page's code and
   not a copy of it — reword the function in the page and this test paints the
   new wording. */
function paintBlockersSource() {
  const start = PANEL_HTML.indexOf("  function paintBlockers(");
  assert.ok(start !== -1, "paintBlockers is gone from client-control-panel.html");
  const end = PANEL_HTML.indexOf("\n  }\n", start);
  assert.ok(end > start, "could not find the end of paintBlockers");
  return PANEL_HTML.slice(start, end + 4);
}

/* The smallest DOM paintBlockers touches: textContent, className, hidden and
   appendChild. Setting textContent to "" empties a node, which is how the
   panel clears itself between paints. */
function fakeNode() {
  const node = {
    className: "", hidden: false, children: [], _text: "",
    appendChild(child) { node.children.push(child); return child; },
    get textContent() { return node._text; },
    set textContent(v) {
      node._text = String(v);
      if (node._text === "") node.children.length = 0;
    }
  };
  return node;
}

const allText = (node) =>
  [node.textContent].concat(node.children.map(allText)).filter(Boolean).join(" | ");

/** Runs the page's paintBlockers over `blockers` and reports what a human
 *  would read. The rows are stringified into the script the same way they
 *  reach the browser — as JSON off the endpoint. */
function paintPanel(blockers, holdReason = "") {
  const list = fakeNode();
  const why = fakeNode();
  const sandbox = {
    document: { createElement: () => fakeNode() },
    $: (id) => (id === "ccp-blocker-list" ? list : id === "ccp-why-label" ? why : null),
    // The page's own dash(), which paintBlockers calls on every label.
    dash: (v) => {
      if (v == null || v === "") return "—";
      const s = String(v).trim();
      return s || "—";
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    paintBlockersSource() +
    "\npaintBlockers(" + JSON.stringify(blockers) + ", " + JSON.stringify(holdReason) + ");",
    sandbox,
    { filename: PANEL + "#paintBlockers" }
  );
  return {
    cards: list.children.map((card) => ({
      label: card.children[0] ? card.children[0].textContent : "",
      detail: card.children[1] ? card.children[1].textContent : ""
    })),
    text: allText(list)
  };
}

describe("client-control-panel.html — the pre-existing Blockers panel", () => {

  // Exactly the row openBlockers() builds from the one workflow that raises a
  // pull-credit task (src/workflows/s-06-post-call-funding-purchased.mjs:25).
  const pullTask = () => ({
    kind: "task", severity: "normal",
    label: "Funding intake — pull CRS",
    detail: "owned by closer",
    source: "s-06-post-call-funding-purchased",
    id: "t9"
  });

  test("it paints whatever it is handed — which is why the words must be right before they arrive", () => {
    // Not a complaint about the panel. This is the reason the fix belongs in
    // the API: the panel has no consent verdict and cannot make this call.
    const out = paintPanel([pullTask()]);
    assert.equal(out.cards[0].label, "Funding intake — pull CRS");
  });

  test("GATE A: a no-consent client's blocker reads as waiting on permission, never as pull credit", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: false }));
    assert.equal(out.cards.length, 1, "the blocker was dropped — hiding it is a lie by omission");
    assert.equal(out.cards[0].label, "Funding intake — waiting on written permission");
    assert.ok(!/pull/i.test(out.text),
      "the pre-existing panel still shows a client with no written permission the words " +
      "'pull CRS': " + out.text);
    assert.equal(out.cards[0].detail, "owned by closer", "the blocker lost the detail staff act on");
  });

  test("GATE A: a consent read that failed says we could not check", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: null }));
    assert.equal(out.cards[0].label, "Funding intake — we could not check written permission");
    assert.ok(!/pull/i.test(out.text));
    assert.ok(!/waiting on/i.test(out.text),
      "we told staff they are waiting on permission, and we never managed to look: " + out.text);
  });

  test("live permission: the real task title is painted byte for byte", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: true }));
    assert.equal(out.cards[0].label, "Funding intake — pull CRS",
      "with written permission on file there is nothing to keep from anyone");
  });

  test("nothing else is touched — an ordinary blocker paints as written", () => {
    const ordinary = { kind: "task", severity: "normal", label: "Chase docs",
                       detail: "owned by funding_advisor", source: "f-02-doc-chase", id: "t1" };
    const out = paintPanel(sanitizeBlockerLabels([ordinary], { consentValid: false }));
    assert.equal(out.cards[0].label, "Chase docs");
    assert.equal(out.cards[0].detail, "owned by funding_advisor");
  });

  /* The wiring is the load-bearing half. If either route is ever pointed at a
     different array, the sanitizer at the endpoint stops covering it. */
  test("both blocker routes read open_blockers, which is the array the API sanitizes", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /paintBlockers\(d\.open_blockers, hold\)/,
      "the pre-existing Blockers panel is being fed something other than the sanitized array");
    assert.match(code, /rows = d\.open_blockers\.slice\(\)/,
      "the control block's fallback is being fed something other than the sanitized array");
    const reads = code.split("\n").filter((line) => /\.open_blockers\b/.test(line));
    assert.equal(reads.length, 2,
      "open_blockers is read in " + reads.length + " places on this page; every one of them " +
      "has to be the array api/dashboard/client.mjs sanitizes. Found: " + JSON.stringify(reads));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   MONEY — ONE RULE, BOTH SCREENS
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — money is whole dollars", () => {

  test("a numeric string from a numeric(14,2) column is dollars", () => {
    const P = loadPanel();
    assert.equal(P.money("50000.00"), "$50,000");
    assert.equal(P.money("47500.00"), "$47,500");
  });

  test("a number out of custom_fields is dollars too, not cents", () => {
    const P = loadPanel();
    assert.equal(P.money(50000), "$50,000");
    assert.equal(P.money(80000), "$80,000");
  });

  test("unknown is an em dash — never 0, never a guess", () => {
    const P = loadPanel();
    for (const v of [null, undefined, "", "   ", "unknown", {}, [], NaN, true, false, "1,000", "$5"]) {
      assert.equal(P.money(v), "—", "unknown money must not become a number: " + JSON.stringify(v));
    }
  });

  test("a recorded zero is a fact and prints as $0", () => {
    const P = loadPanel();
    assert.equal(P.money(0), "$0");
    assert.equal(P.money("0.00"), "$0");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE TILES THAT WERE ALREADY HERE KEEP THE RULE THEY ALREADY HAD

   Prequal and the two income-per-year lines are not part of the fulfillment
   work. The shared money() rule above was briefly wired to them, which changed
   what they printed: a recorded zero became "$0" where it had been a dash, and
   a negative became "$-500". tileMoney() is the rule those displays shipped
   with on main, restored byte for byte.

   Whether a recorded zero on those tiles ought to read "$0" or a dash is
   Chris's call. Until he makes it they read exactly as they read on main.

   ── ONE OF THEM IS NO LONGER FROZEN, AND THIS IS WHY ────────────────────────
   The tile labelled "Total Approved" was in this list, and the assertion below
   pinned `var approved = money(c.funded_amount)` byte for byte. That froze a
   defect: the tile showed the FUNDED amount, and when that was missing it fell
   back to `money(prequal)` — the analyzer's PRE-APPROVAL GUESS, the number in
   the tile immediately to its left — under a label that said Approved. It never
   once showed an approved amount.

   The note above said these were frozen "until Chris makes the call". He has
   made two that settle it:

     * 2026-08-30, fee basis: the success fee is a percent of CONFIRMED
       APPROVALS — approved applications carrying a recorded amount, minus any
       recorded as not counting (src/funding/success-fee.mjs,
       docs/finance/CLOSEOUT-FEE-BASIS.md). A tile labelled Approved that shows the
       funded amount now contradicts the invoice.
     * 2026-08-30, this screen: "never leave a label that does not match its
       number."

   So the tile is re-pointed, not un-pinned. It is now labelled
   "Approved · confirmed", it is painted from the application rows by the
   funding block, and what is asserted below is that the two things that made it
   a lie are gone: it must not read funded_amount, and it must not fall back to
   the prequal guess. The other tiles are still frozen exactly as they were.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the tiles that were already here are unchanged", () => {

  /* main's rule, copied from `git show main:public/app/client-control-panel.html`
     (the money() at line 724 there). If tileMoney ever stops agreeing with
     this, a tile nobody asked to change has changed. */
  const mainRule = (n) => {
    if (n == null || n === "") return "—";
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return "—";
    return "$" + Math.round(v).toLocaleString("en-US");
  };

  test("tileMoney matches main's rule on every value, including the awkward ones", () => {
    const P = loadPanel();
    const vals = [null, undefined, "", "   ", 0, "0", "0.00", -1, -500, "-500", "-500.00", 1,
      0.4, 0.6, 50000, "50000.00", "47500.00", 80000, NaN, Infinity, -Infinity, true, false,
      [], [5], {}, "abc", "1e3", " 42 ", "42px"];
    for (const v of vals) {
      assert.equal(P.tileMoney(v), mainRule(v),
        "a tile nobody asked to change has changed for " + JSON.stringify(String(v)));
    }
  });

  test("the two regressions are gone: no $0 and no $-500 on these tiles", () => {
    const P = loadPanel();
    assert.equal(P.tileMoney(0), "—", "a recorded zero used to be a dash on these tiles");
    assert.equal(P.tileMoney("0.00"), "—");
    assert.equal(P.tileMoney(-500), "—", "$-500 is not something to put in front of staff");
    assert.equal(P.tileMoney("-500.00"), "—");
    assert.equal(P.tileMoney("50000.00"), "$50,000", "the tiles still show real money");
  });

  /* The wiring is the load-bearing half: the right rule has to reach the right
     display. Comments are stripped first — this file explains both rules in
     prose and prose is not a call. */
  test("the old tiles use the old rule and the new funding-round amount uses the shared one", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /var money = FHCP\.tileMoney;/,
      "the tiles that were already here are no longer on main's rule");
    assert.match(code, /var roundMoney = FHCP\.money;/,
      "the shared whole-dollars rule is no longer wired to the new funding-round amount");
    assert.match(code, /setText\("ccp-prequal", money\(prequal\)\)/, "the Prequal tile is wired somewhere new");
    assert.match(code, /setText\("ccp-cp-round-amount", roundMoney\(amount\)\)/,
      "the funding-round amount is no longer on the shared rule");
    assert.ok(!/setText\("ccp-cp-round-amount", money\(/.test(code),
      "the funding-round amount fell back onto the old tile rule");
  });

  /* THE TILE THAT LIED. Both halves of the lie are asserted gone, and the honest
     source is asserted present, because either half coming back on its own is
     enough to put a wrong number under a label people trust. */
  test("the Approved tile never shows the funded amount and never falls back to the guess", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/setText\("ccp-approved"/.test(code),
      "the Approved tile is being set from the client record again; it is painted " +
      "from the application rows, which is the only place an approved amount lives");
    assert.ok(!/ccp-approved[\s\S]{0,400}?funded_amount/.test(code),
      "the Approved tile is reading the funded amount again — that is what made it a lie");
    assert.ok(!/ccp-approved[\s\S]{0,400}?prequal/.test(code),
      "the Approved tile fell back to the analyzer's pre-approval guess again");
    assert.match(code, /approvedTile\.textContent = !known \? "could not check"/,
      "a failed read must say so on the tile, not leave a stale number or a zero");
    assert.match(code, /summary\.confirmed > 0 \? CP\.money\(summary\.confirmed_dollars\)/,
      "the tile must be the confirmed approvals total — the number the invoice uses");
  });

  test("the label on the Approved tile says what the number is", () => {
    assert.match(PANEL_HTML, /<div class="rf-label">Approved · confirmed<\/div>/,
      "the tile label and its number must match; 'Total Approved' over a funded amount is the defect");
    assert.ok(!/<div class="rf-label">Total Approved<\/div>/.test(PANEL_HTML),
      "the old label is back over a number that is not the funded amount");
  });

  /* The funded amount was the only real fact that tile carried. Removing it from
     there must not delete it from the screen. */
  test("the funded amount is still on the screen, under the word Funded", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /setText\("ccp-facts-funded"/, "the Funded line is gone");
    assert.match(code, /var fundedMoney = c\.funded === true \? money\(c\.funded_amount\) : "—";/,
      "the funded amount left the Approved tile and did not land anywhere else");
  });
});

describe("the two screens agree about money", () => {

  /* THE DEFECT THIS CLOSES. pipeline.html divided a number by 100 and
     client-control-panel.html did not, so funding_rounds.approved_amount and
     the total_prequal rollup could render as two different numbers on two
     screens. Both are dollars — traced in the comment above each formatter.
     pipeline.html returns null where the panel returns the dash, so null is
     mapped to the dash before comparing. */
  const SAME = [
    "50000.00", "47500.00", "82000.00", "0.00", "1.00", "12.49", "5000000",
    50000, 80000, 0, 12.5, 5000000, 1,
    null, undefined, "", "   ", "unknown", {}, [], NaN, true, false, "1,000", "$5"
  ];

  test("every value formats identically on both screens", () => {
    const P = loadPanel();
    const L = loadLens();
    for (const v of SAME) {
      const panel = P.money(v);
      const lens = L.moneyText(v);
      const pipeline = lens === null ? P.UNKNOWN : lens;
      assert.equal(panel, pipeline,
        "the two screens disagree about " + JSON.stringify(v) +
        ": the client panel says " + panel + " and the pipeline says " + pipeline);
    }
  });

  test("the one value that started this reads $50,000 on both, not $500 on one", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.equal(P.money(50000), "$50,000");
    assert.equal(L.moneyText(50000), "$50,000");
  });

  test("unknown is a dash on both, and 0 is only ever a recorded 0", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.equal(P.money(null), "—");
    assert.equal(L.moneyText(null), null, "the pipeline caller prints the dash from null");
    assert.equal(P.money(0), "$0");
    assert.equal(L.moneyText(0), "$0");
  });
});

describe("the two screens agree about the answer that is not a step", () => {

  /* THE DEFECT THIS CLOSES. The client file said "No step applies right now."
     while the pipeline list said "Not enough information" about the same
     client at the same moment — the list never read the degraded flag, so it
     gave one chip to both answers. Six real clients read that way, Chris's
     repair-only one among them, which made behaviour he signed off look like
     a fault. One client, one answer, whichever screen it is read on. */
  const WORKED_NO_STEP = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: false };
  const NOT_WORKED = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: true };
  const PANEL_WORKED_NO_STEP = { next_action: null, active_blockers: [], funding_round: null, degraded: false };

  test("worked out and no step applies: both screens say the same words", () => {
    const P = loadPanel();
    const L = loadLens();
    const panel = P.nextAction(PANEL_WORKED_NO_STEP, {}).main;
    const lens = L.chipOf(WORKED_NO_STEP).label;
    assert.equal(panel, P.NONE_APPLIES);
    assert.equal(lens, panel,
      "the client file says " + JSON.stringify(panel) + " and the list says " + JSON.stringify(lens));
  });

  test("not worked out at all: both screens say the same words", () => {
    const P = loadPanel();
    const L = loadLens();
    const panel = P.nextAction(DEGRADED, {}).main;
    const lens = L.chipOf(NOT_WORKED).label;
    assert.equal(panel, P.NOT_WORKED_OUT);
    assert.equal(lens, panel,
      "the client file says " + JSON.stringify(panel) + " and the list says " + JSON.stringify(lens));
  });

  test("neither screen collapses the two answers into one", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.notEqual(P.NONE_APPLIES, P.NOT_WORKED_OUT);
    assert.notEqual(L.chipOf(WORKED_NO_STEP).key, L.chipOf(NOT_WORKED).key);
    assert.equal(new Set([
      P.nextAction(PANEL_WORKED_NO_STEP, {}).main,
      P.nextAction(DEGRADED, {}).main,
      L.chipOf(WORKED_NO_STEP).label,
      L.chipOf(NOT_WORKED).label
    ]).size, 2, "the four readings should be two answers, each said the same way on both screens");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GATE B ON SCREEN — no funding money on a client who did not buy funding

   The funding round in the control panel carries an approved amount, and an
   approved amount is funding-shaped money. src/fulfillment/next-action.mjs
   refuses to hand a round back on any tier outside the three funding tiers —
   the same whitelist, the same helper, that refuses a funding chip. These
   tests keep BOTH screens reading only that gated answer. A raw
   funding_rounds row read here or on pipeline.html would walk around it.
   ──────────────────────────────────────────────────────────────────────────── */

describe("both screens paint only the gated funding round", () => {

  test("the control panel's round block reads the derived round and nothing else", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const start = code.indexOf('setText("ccp-cp-round-number"');
    const end = code.indexOf('setText("ccp-cp-round-final"');
    assert.ok(start !== -1 && end > start, "the control panel's funding round block is gone");
    // Walk back to where the block gathers its values.
    const from = code.lastIndexOf("var round =", start);
    assert.ok(from !== -1 && from < start, "the round block no longer starts from a single round value");
    const block = code.slice(from, end);
    assert.match(block, /var round = fx \? fx\.funding_round : null;/,
      "the round block is reading something other than the gated answer");
    for (const raw of ["round_number", "funding_rounds", "latestRound"]) {
      assert.ok(!new RegExp("\\b" + raw + "\\b").test(block),
        "the round block reads the raw " + raw + ", which walks around the tier gate: " + block);
    }
  });

  test("the pipeline lens row builds its round line from the gated answer only", () => {
    const code = PIPELINE_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = code.split("\n").filter((line) => /L\.roundText\(/.test(line));
    assert.equal(calls.length, 1, "roundText is called in " + calls.length + " places: " + JSON.stringify(calls));
    assert.match(calls[0], /L\.roundText\(client && client\.funding_round\)/,
      "the lens row is feeding roundText something other than the gated answer: " + calls[0]);
    assert.ok(!/roundText\([^)]*funding_rounds/.test(code),
      "the lens row reads a raw funding_rounds row, which walks around the tier gate");
  });

  test("no round means no line and no money on either screen", () => {
    const L = loadLens();
    assert.equal(L.roundText(null), null, "a gated-off round must paint nothing at all");
    assert.equal(L.roundText(undefined), null);
  });
});

test("client-control-panel can save a company birth month/year", () => {
  assert.match(PANEL_HTML, /stamp_incorporated/);
  assert.match(PANEL_HTML, /type = "month"/);
  assert.match(PANEL_HTML, /Age \(months\)/);
});

/* ────────────────────────────────────────────────────────────────────────────
   THE HEADLINE NUMBER, AND THE ONE DEFINITION UNDER IT

   The top-left of this screen is now a count: how many bank answers on this
   file say yes and still carry no dollar amount. A number that leads a screen
   has to be provable, so these tests do two things.

   FIRST, they prove the screen answers the same question the server does. Three
   places used to define "a bank yes that is not worth anything yet" and they
   already disagreed:

     src/funding/success-fee.mjs   the biller   NULL or <= 0, not excluded
     api/dashboard/pipeline.mjs    the board    NULL only, exclusion ignored
     client-control-panel.html     the screen   NULL or blank, not excluded

   The two SQL callers now share one string. A screen cannot import a module, so
   its copy is still a copy — and this is what stops it drifting: the SQL string
   is read here and the screen's function is run against the same rows.

   SECOND, they prove the four states are all written in words. This slot is the
   first thing anybody reads, so "we could not check" must never render as an
   all-clear and a real zero must never render as a bare 0 in a box.
   ──────────────────────────────────────────────────────────────────────────── */

describe("the headline count is one definition, shared with the server", () => {

  /* Rows exactly as GET /api/applications sends them: approved_amount arrives
     from a numeric(14,2) column, so it is a STRING or null, never a number. */
  const app = (over) => Object.assign({
    id: "a1", lender_id: null, status: "Approved", approved_amount: null,
    approval_excluded_at: null
  }, over);

  test("the biller's SQL still carries all three clauses the screen copies", () => {
    const sql = unpricedApprovalConditions("a");
    assert.match(sql, /a\.status = 'Approved'/, "the status clause is gone");
    assert.match(sql, /a\.approval_excluded_at IS NULL/,
      "the exclusion clause is gone — an approval somebody recorded as not counting " +
      "would be chased forever");
    assert.match(sql, /\(a\.approved_amount IS NULL OR a\.approved_amount <= 0\)/,
      "the amount clause narrowed; a zero cannot be invoiced and must still count as waiting");
  });

  test("the board asks the biller rather than writing its own copy", () => {
    const board = fs.readFileSync(path.resolve(HERE, "../../api/dashboard/pipeline.mjs"), "utf8");
    assert.match(board, /unpricedApprovalConditions/,
      "api/dashboard/pipeline.mjs is writing its own approval condition again");
    assert.ok(!/a\.approved_amount IS NULL\s*\n\s*\) AS approval_amount_missing/.test(board),
      "the board is back on NULL-only, so a recorded zero is clean on the board and " +
      "refused at the Funded move");
  });

  test("the screen's rule answers the same as the SQL, row for row", () => {
    const P = loadPanel();
    /* Each case is one row and what the SQL would say about it. If the screen
       and the server ever disagree here, the count top-left is not the count the
       invoice is built from. */
    const cases = [
      [app({}), true, "approved, nobody has said how much"],
      [app({ approved_amount: "" }), true, "approved, a blank amount"],
      [app({ approved_amount: "0.00" }), true, "a recorded zero cannot be invoiced"],
      [app({ approved_amount: "-500.00" }), true, "a negative left by an old import"],
      [app({ approved_amount: "not a number" }), true, "an amount nobody can read is not a price"],
      [app({ approved_amount: "45000.00" }), false, "priced"],
      [app({ approved_amount: "0.01" }), false, "a cent is still a recorded amount"],
      [app({ approval_excluded_at: "2026-08-30T00:00:00Z" }), false, "recorded as not counting"],
      [app({ approved_amount: "0.00", approval_excluded_at: "2026-08-30T00:00:00Z" }), false,
        "excluded beats unpriced"],
      [app({ status: "Denied" }), false, "a denial has no approved amount to chase"],
      [app({ status: "Applied" }), false, "not an answer yet"],
      [null, false, "nothing at all"]
    ];
    for (const [row, waiting, why] of cases) {
      assert.equal(P.isWaitingOnAmount(row), waiting,
        "the screen and the biller disagree about " + why + ": " + JSON.stringify(row));
    }
  });

  test("confirmed is the exact mirror, and it is what the fee is a percent of", () => {
    const P = loadPanel();
    const sql = confirmedApprovalConditions();
    assert.match(sql, /approved_amount IS NOT NULL/);
    assert.match(sql, /approved_amount > 0/);
    assert.match(sql, /approval_excluded_at IS NULL/);

    assert.equal(P.isConfirmedApproval(app({ approved_amount: "45000.00" })), true);
    assert.equal(P.isConfirmedApproval(app({ approved_amount: "0.00" })), false, "a zero is not confirmed");
    assert.equal(P.isConfirmedApproval(app({ approved_amount: null })), false, "unknown is not confirmed");
    assert.equal(P.isConfirmedApproval(app({ approved_amount: "45000.00", approval_excluded_at: "x" })), false,
      "an approval we are not billing for is not billed at any size");
    assert.equal(P.isConfirmedApproval(app({ status: "Denied", approved_amount: "45000.00" })), false);

    // Every row is exactly one of the three: waiting, confirmed, or neither.
    for (const row of [app({}), app({ approved_amount: "1.00" }), app({ status: "Denied" }),
                       app({ approval_excluded_at: "x" })]) {
      assert.ok(!(P.isWaitingOnAmount(row) && P.isConfirmedApproval(row)),
        "a row cannot be both waiting and confirmed: " + JSON.stringify(row));
    }
  });

  test("the count is per lender, newest first, and rows with no lender still count", () => {
    const P = loadPanel();
    /* listClientApplications orders updated_at DESC, so the FIRST row for a
       lender is the current one — an older blank row behind a priced one must
       not be chased. A row with no lender id is an imported approval with only
       a bank name: it has no row on screen to chip, which is exactly why it has
       to be in the number. */
    const out = P.summariseApprovals([
      app({ id: "1", lender_id: "L1", approved_amount: "45000.00" }),
      app({ id: "2", lender_id: "L1", approved_amount: null }),
      app({ id: "3", lender_id: "L2", approved_amount: null }),
      app({ id: "4", lender_id: "L3", approved_amount: "2500.50" }),
      app({ id: "5", lender_id: "L4", approved_amount: "1000.00", approval_excluded_at: "x" }),
      app({ id: "6", approved_amount: null })
    ]);
    assert.equal(out.waiting, 2, "L2 and the lender-less row are waiting; the stale L1 row is not");
    assert.equal(out.confirmed, 2, "L1 and L3");
    assert.equal(out.confirmed_dollars, "47500.50", "the excluded $1,000 is not in the total");
  });

  test("the total is added in cents, so 450.10 never becomes 450.09", () => {
    const P = loadPanel();
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(app({ id: "x" + i, lender_id: "L" + i, approved_amount: "450.10" }));
    assert.equal(P.summariseApprovals(rows).confirmed_dollars, "1350.30",
      "the total was added as floating point, which is how a payout report drifts");
  });

  test("nothing confirmed is null, never a zero total", () => {
    const P = loadPanel();
    const out = P.summariseApprovals([app({}), app({ status: "Denied" })]);
    assert.equal(out.confirmed, 0);
    assert.equal(out.confirmed_dollars, null,
      "'$0 confirmed' reads as a fact about this file; it is the absence of one");
  });

  test("the summary never throws, whatever it is handed", () => {
    const P = loadPanel();
    for (const bad of [null, undefined, "rows", 7, {}, [null], [undefined], [7], [[]],
                       [{ get status() { throw new Error("boom"); } }]]) {
      const out = P.summariseApprovals(bad);
      assert.equal(typeof out.waiting, "number");
      assert.equal(typeof out.confirmed, "number");
    }
  });
});

describe("client-control-panel.html — the top-left is the number, said four ways", () => {

  test("the count is at metric size and the reference tiles are not", () => {
    /* fundhub-brand.css hands --fs-metric to `.big`, and used to hand it to
       `.rf-value` as well — which is how eight reference facts came to shout at
       32px directly above the one sentence saying what to do next. */
    assert.match(PANEL_HTML, /<span class="big" id="ccp-waiting-count"/,
      "the headline count is no longer on the brand's metric whitelist");
    assert.ok(!/class="rf-value"/.test(PANEL_HTML),
      "a reference tile is back at metric size, competing with the headline");
    const brand = fs.readFileSync(path.resolve(HERE, "../../public/app/fundhub-brand.css"), "utf8");
    assert.ok(/\.big\b/.test(brand) && /--fs-metric/.test(brand),
      "`.big` is no longer a name the brand file paints at --fs-metric");
  });

  test("the four states are all written out, and none of them is a bare dash", () => {
    for (const words of [
      "Could not check what is waiting.",
      "Nothing waiting on this file.",
      "bank answers need a dollar amount",
      "Pick a client to see what is waiting on you."
    ]) {
      assert.ok(PANEL_HTML.includes(words), "the headline lost the state: " + words);
    }
    assert.match(PANEL_HTML, /countEl\.hidden = !known \|\| waiting === 0;/,
      "a zero must be said in words, not painted as a bare 0 in a box");
  });

  test("a failed read says so instead of showing an all-clear", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /FHData\.explain\(res, "the bank answers on this file"\)/,
      "the house error copy is not being used for a failed applications read");
    assert.ok(!/A read that did not arrive is not a file with nothing waiting/.test(PANEL_HTML),
      "the silent all-clear is back: a failed read used to leave the previous sentence alone");
    assert.match(code, /if \(!res \|\| !res\.ok\) \{\s*\n\s*paintHeadline\(null\);/,
      "a failed read must reach paintHeadline(null), which is the 'could not check' state");
  });

  test("the caveat is printed on the screen, not left in a comment", () => {
    /* The count can only ever cover answers we have RECEIVED. Nothing writes an
       application row at the moment somebody applies — src/proxy/launch.mjs
       writes a proxy_sessions row and nothing else — so the days-long gap
       between applying and hearing back is genuinely blank in the database.
       Calling these "applications waiting" would be a claim the data cannot
       support. */
    assert.ok(PANEL_HTML.includes("Applications still out with a bank are not recorded anywhere"),
      "the screen is making a claim about applications that the data cannot support");
    // HTML comments stripped first: the reason is written next to the markup,
    // in the words it is warning against, and a comment is not copy.
    const headline = PANEL_HTML
      .slice(PANEL_HTML.indexOf('id="ccp-waiting"'), PANEL_HTML.indexOf('id="ccp-pick"'))
      .replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/applications? (still )?waiting/i.test(headline),
      "the headline calls them applications, and nothing records an application");
  });

  test("the reference tiles sit below the action, not above it", () => {
    /* §12 rule 3. The tiles used to be in the header, between the headline and
       the one sentence saying what to do next. */
    const action = PANEL_HTML.indexOf('id="ccp-next-action"');
    const tiles = PANEL_HTML.indexOf('id="ccp-facts-group"');
    assert.ok(action !== -1 && tiles !== -1, "the action slot or the tile group is gone");
    assert.ok(tiles > action, "the eight reference tiles are back above the next action");
  });

  test("the chase list is in the main funding workspace", () => {
    /* Roughly nine in ten of this screen's keystrokes land in the lender rows,
       and the rail is the column a narrow window pushes below everything else. */
    const main = PANEL_HTML.indexOf('class="main-col"');
    const funding = PANEL_HTML.indexOf('id="ccp-view-funding"');
    const credit = PANEL_HTML.indexOf('id="ccp-view-credit"');
    const list = PANEL_HTML.indexOf('id="fh-funding-apply"');
    assert.ok(main !== -1 && funding !== -1 && credit !== -1 && list !== -1,
      "the client or funding workspace is missing");
    assert.ok(funding > main && list > funding && list < credit,
      "the lender list must remain in the main Funding section");
  });
});

describe("client-control-panel.html — the round's three moves", () => {

  test("they post to the endpoint the board already uses, with no new rule", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /FHData\.write\("\/api\/pipeline-cards", body\)/,
      "the round buttons are writing somewhere other than the board's own endpoint");
    for (const stage of ["round_submitted", "funded", "closed"]) {
      assert.ok(code.includes('"' + stage + '"'), "the " + stage + " move is gone");
    }
    assert.match(code, /var CARD_STACKING = "funding_card_stacking";/,
      "the rail these stages belong to is no longer named");
  });

  test("the funded amount is typed in a box on the page, never in a browser prompt", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const wiring = code.slice(code.indexOf("function wireRoundMoves"), code.indexOf("if (!id) paintBusinesses"));
    assert.ok(wiring.length > 200, "the round wiring is gone");
    assert.ok(!/prompt\(/.test(wiring),
      "a prompt cannot show the parser's refusal beside the box and vanishes on focus loss");
    assert.match(wiring, /window\.FHMoneyInput\.parseAmount\(amount\.value\)/,
      "the funded amount is not going through the shared parser");
    assert.ok(!/funded_amount\s*:\s*0\b/.test(wiring), "blank is not zero");
  });

  test("a refusal is shown in the server's own words, and a created card is admitted", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /\(res && res\.error\) \|\| "The move was not saved\."/,
      "the screen is rewriting the server's refusal; only the server knows which banks are blank");
    assert.match(code, /res\.data && res\.data\.created === true/,
      "a move that creates a card on a board this client was not on must say so");
  });

  test("the round card shows how long it has been open", () => {
    assert.match(PANEL_HTML, /id="ccp-cp-round-opened"/, "the round has no date on it again");
    assert.match(PANEL_HTML, /setText\("ccp-cp-round-opened", ageOf\(opened\)\)/,
      "the opened line is not painted from the gated round");
    assert.match(PANEL_HTML, /opened = round\.started_at;/,
      "the date is coming from somewhere other than the gated answer");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   A FILE ON ITS WAY IS LOADING, NOT EMPTY (hole 5, 2026-09-17). With ?id= in
   the address the header said "No client open — pick one below." for four to
   five seconds while the file read was slow. The fix is display only: a class
   set in <head> before the first paint swaps the no-client words for a loading
   line and skeleton bars, and the FHData.client() callback takes it off before
   any branch. e2e/ccp-first-paint.spec.mjs proves it in a real browser; this
   keeps the shape from quietly coming undone.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — opening a file shows loading, never the no-client words", () => {

  test("the id-present branch runs before the first paint, is always ended, and never writes the big slot", () => {
    const head = PANEL_HTML.slice(0, PANEL_HTML.indexOf("</head>"));
    assert.match(head, /document\.documentElement\.classList\.add\("ccp-opening"\)/,
      "the loading class is no longer set in <head>, so the no-client words paint first again");

    // The head and the page script must agree on what "an id in the address" is.
    const keysIn = (src) => (src.match(/\(\s*"(id|client_id|client|contact)"\s*\)/g) || [])
      .map((k) => k.replace(/[^a-z_]/g, ""));
    const opener = head.slice(head.indexOf("FH-CCP-OPENING"));
    const pageId = (PANEL_HTML.match(/var id = FHData\.param\([^;]*;/) || [""])[0];
    assert.ok(pageId, "the page script's id line is gone");
    assert.deepEqual(keysIn(opener), keysIn(pageId),
      "the <head> check and the page script read different address keys");

    // Taken off at the TOP of the file read's answer, before any branch, so a
    // failed read shows its own words and no skeleton outlives the read.
    assert.match(PANEL_HTML,
      /FHData\.client\(id\)\.then\(function \(res\) \{(?:\s*\/\*[\s\S]*?\*\/)?\s*document\.documentElement\.classList\.remove\("ccp-opening"\);\s*if \(res\.ok\)/,
      "the loading class is not removed before the first branch of the file read's answer");

    // Each no-client phrase is the idle half of a pair, with a loading half beside it.
    for (const words of ["No client open — pick one below.", "Pick a client below.",
      "Open a client file to see what is blocking it."]) {
      // ">" + words: the element's own text, not a comment that quotes it.
      const at = PANEL_HTML.indexOf(">" + words) + 1;
      assert.ok(at > 0, "the no-client words are gone from the markup: " + words);
      const tag = PANEL_HTML.slice(PANEL_HTML.lastIndexOf("<", at), at);
      assert.match(tag, /class="[^"]*\bccp-idle\b/, "not hidden while a file loads: " + words);
      assert.match(PANEL_HTML.slice(at, at + 200), /class="ccp-wait\b/, "no loading line beside: " + words);
    }
    assert.match(PANEL_HTML, /\.ccp-wait\{display:none;\}/, "the loading line would show with no file open");
    assert.match(PANEL_HTML, /html\.ccp-opening \.ccp-idle\{display:none;\}/,
      "the no-client words are not hidden while a file loads");

    // GATE A still holds: the skeleton in the big slot is markup and CSS only.
    assert.ok(!/setText\("ccp-next-action"/.test(PANEL_HTML),
      "ccp-next-action is being set directly; only paintNextAction may write it");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   LIVE HOLE 23 (2026-09-18) — A SAMPLE REPORT SAYS IT IS A SAMPLE
   #13 Sim Thirteen-NoBook: no permission row, no pull row, and one crs_results
   row loaded by the walkthrough script, stamped environment "simulated". The
   screen showed its scores and a Last Credit Pull date as if a bureau had been
   asked, right beside a true "No written permission on file". The fixtures
   below are that live row's own stamp, and src/demo/simulate-client.mjs's.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — a sample report says it is a sample (live hole 23)", () => {
  const AT = "2026-09-18T08:54:06.344Z";
  const push = {
    id: "fe92316e", created_at: AT,
    result: {
      source: "crs", environment: "simulated", simulated: true,
      simulatedNotice: "SIMULATED — fulfillment walkthrough. Not a bureau pull.",
      scores: { ex: 771, eq: 778, tu: 766 }
    }
  };
  const demo = { id: "d", created_at: AT, result: { environment: "simulated", scores: { ex: 718 } } };
  const real = { id: "r", created_at: AT, result: { source: "crs", environment: "production", scores: { ex: 700 } } };

  test("the walkthrough's sample report is named as a sample", () => {
    const P = loadPanel();
    assert.equal(P.isSampleReport([push], AT), true);
    assert.equal(P.isSampleReport([demo], AT), true);
    assert.equal(P.isSampleReport([{ ...push, result: JSON.stringify(push.result) }], AT), true,
      "a report stored as a string is still read");
    assert.match(P.SAMPLE_NOTE, /sample/i);
    assert.match(P.SAMPLE_NOTE, /not a real credit pull/i);
  });

  test("a real pull is never called a sample", () => {
    const P = loadPanel();
    assert.equal(P.isSampleReport([real], AT), false);
    // Only the row the scores came from counts: an older sample is not this one.
    const older = { ...push, created_at: "2026-09-01T00:00:00.000Z" };
    assert.equal(P.isSampleReport([real, older], AT), false);
  });

  test("anything unreadable adds no label and never throws", () => {
    const P = loadPanel();
    for (const [rows, asOf] of [
      [[push], null], [[push], ""], [[push], "not a date"], [null, AT], ["rows", AT],
      [[null, 7, "x", { created_at: AT }, { created_at: AT, result: "{broken" }], AT]
    ]) {
      assert.equal(P.isSampleReport(rows, asOf), false);
    }
  });

  test("the screen paints the label on the Scores tile, the facts row and the last-pull line", () => {
    assert.match(PANEL_HTML, /id="ccp-scores"[^>]*>—<\/div>\s*<p class="fact-note" id="ccp-scores-sample" hidden><\/p>/,
      "the sample line is gone from the Scores tile");
    assert.match(PANEL_HTML, /var sampleScores = FHCP\.isSampleReport\(d\.crs_results, tm\.asOf\);/);
    assert.match(PANEL_HTML, /setText\("ccp-facts-scores", sampleScores \?/);
    assert.match(PANEL_HTML, /setText\("ccp-last-pull", sampleScores\s*\?\s*"Sample report loaded "/,
      "a sample report is being printed as the last credit pull again");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   LIVE HOLE N12 (2026-09-18) — EVERY FIGURE OFF A SAMPLE REPORT SAYS SAMPLE
   Hole 23 labelled the scores on #13 Sim Thirteen-NoBook. The same sample
   report still painted "The 4 inquiries on this file", the Inquiries tile "4",
   Card Use "6% · excellent" and the Experian income estimate "$37,000/yr" with
   nothing saying sample. The fixture is that live row's own stamp and its four
   inquiries; the control is a real pull (environment "production").
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the inquiries, Card Use, income, Prequal and Tier off a sample report say sample (live hole N12)", () => {
  const AT = "2026-09-18T08:54:06.344Z";
  const INQ = [
    { creditorName: "CAPITAL ONE", source: "EX" },
    { creditorName: "SYNCB/PAYPAL CREDIT", source: "EX" },
    { creditorName: "NAVY FEDERAL CU", source: "TU" },
    { creditorName: "CITIBANK NA", source: "EQ" }
  ];
  const sampleRow = {
    created_at: AT,
    result: { source: "crs", environment: "simulated", simulated: true, utilization: 6, inquiries: INQ }
  };
  const realRow = {
    created_at: AT,
    result: { source: "crs", environment: "production", utilization: 6, inquiries: INQ }
  };

  /* A tiny DOM: just enough for the three paint functions, which only ever use
     getElementById, createElement, textContent, className, hidden and
     appendChild. Setting textContent clears the children, as the browser does. */
  function fakeNode(id) {
    const n = {
      id, className: "", hidden: false, children: [], own: "",
      appendChild(c) { this.children.push(c); return c; },
      get textContent() { return this.own + this.children.map((c) => c.textContent).join(""); },
      set textContent(v) { this.own = String(v); this.children = []; }
    };
    return n;
  }
  function paintWith(rows) {
    const nodes = {};
    for (const id of ["ccp-inquiries", "ccp-inquiries-sample", "ccp-inquiry-names", "ccp-next-inquiries"]) {
      nodes[id] = fakeNode(id);
      if (id === "ccp-inquiries-sample" || id === "ccp-next-inquiries") nodes[id].hidden = true;
    }
    const a = PANEL_HTML.indexOf("function fileInquiries(");
    const b = PANEL_HTML.indexOf("/* WHY A REMOVAL CASE SAYS BLOCKED");
    assert.ok(a !== -1 && b > a, "fileInquiries / paintInquiries moved; this test cannot find them");
    const sandbox = {
      FHCP: loadPanel(),
      document: { getElementById: (id) => nodes[id] || null, createElement: () => fakeNode(null) }
    };
    sandbox.$ = (id) => sandbox.document.getElementById(id);
    sandbox.setText = (id, v) => { const n = sandbox.$(id); if (n) n.textContent = v == null || v === "" ? "—" : String(v); };
    vm.createContext(sandbox);
    vm.runInContext(PANEL_HTML.slice(a, b) + "\npaintInquiries(ROWS);", Object.assign(sandbox, { ROWS: rows }));
    return nodes;
  }

  test("a sample report's inquiries list and count both say sample", () => {
    const P = loadPanel();
    assert.match(P.SAMPLE_FIGURE_NOTE, /sample/i);
    assert.match(P.SAMPLE_FIGURE_NOTE, /not a real credit pull/i);
    const n = paintWith([sampleRow]);
    assert.equal(n["ccp-inquiries"].textContent, "4");
    assert.equal(n["ccp-inquiries-sample"].hidden, false, "the Inquiries tile does not say sample");
    assert.equal(n["ccp-inquiries-sample"].textContent, P.SAMPLE_FIGURE_NOTE);
    const box = n["ccp-next-inquiries"];
    assert.equal(box.hidden, false);
    assert.match(box.children[0].textContent, /The 4 inquiries on this file/);
    assert.equal(box.children[1].textContent, P.SAMPLE_FIGURE_NOTE,
      "the inquiries list does not say sample straight under its head");
    assert.equal(box.children.filter((c) => c.className === "na-inq-row").length, 4);
  });

  test("a real pull's inquiries never say sample", () => {
    const P = loadPanel();
    const n = paintWith([realRow]);
    assert.equal(n["ccp-inquiries"].textContent, "4");
    assert.equal(n["ccp-inquiries-sample"].hidden, true);
    assert.equal(n["ccp-inquiries-sample"].textContent, "");
    assert.ok(!n["ccp-next-inquiries"].textContent.includes(P.SAMPLE_FIGURE_NOTE));
    // Only the report the list came off counts: an OLDER sample under a newer real pull is not it.
    const older = { ...sampleRow, created_at: "2026-09-01T00:00:00.000Z" };
    const m = paintWith([older, realRow]);
    assert.equal(m["ccp-inquiries-sample"].hidden, true);
    assert.ok(!m["ccp-next-inquiries"].textContent.includes(P.SAMPLE_FIGURE_NOTE));
  });

  test("a sample report with no inquiry list still labels the tile; no report adds nothing", () => {
    const P = loadPanel();
    const n = paintWith([{ created_at: AT, result: { environment: "simulated", simulated: true } }]);
    assert.equal(n["ccp-inquiries"].textContent, "none listed");
    assert.equal(n["ccp-inquiries-sample"].hidden, false);
    assert.equal(n["ccp-inquiries-sample"].textContent, P.SAMPLE_FIGURE_NOTE);
    const none = paintWith([]);
    assert.equal(none["ccp-inquiries"].textContent, "no report yet");
    assert.equal(none["ccp-inquiries-sample"].hidden, true);
  });

  test("Card Use and the income estimates are matched to their own report and say sample", () => {
    assert.match(PANEL_HTML, /id="ccp-inquiries">—<\/div>\s*<p class="fact-note" id="ccp-inquiries-sample" hidden><\/p>/,
      "the sample line is gone from the Inquiries tile");
    assert.match(PANEL_HTML, /id="ccp-card-use">—<\/div>\s*<p class="fact-note" id="ccp-card-use-sample" hidden><\/p>/,
      "the sample line is gone from the Card Use tile");
    assert.match(PANEL_HTML,
      /var sampleCardUse = FHCP\.isSampleReport\(d\.crs_results, d\.utilisation && d\.utilisation\.asOf\);/);
    assert.match(PANEL_HTML, /cardUseNote\.textContent = sampleCardUse \? FHCP\.SAMPLE_FIGURE_NOTE : "";/);
    assert.match(PANEL_HTML, /var sampleIncome = FHCP\.isSampleReport\(d\.crs_results, inc\.asOf\);/);
    assert.match(PANEL_HTML, /setText\("ccp-income-ex", incomeLine\(inc\.experian\)\);/);
    assert.match(PANEL_HTML, /setText\("ccp-income-eq", incomeLine\(inc\.equifax\)\);/);
    // The server's own asOf is that report's created_at — the match key the screen relies on.
    const P = loadPanel();
    assert.equal(P.isSampleReport([sampleRow], AT), true);
    assert.equal(P.isSampleReport([realRow], AT), false);
    assert.equal(P.isSampleReport([sampleRow], null), false,
      "a Card Use figure with no report date (the custom-field fallback) must not be called a sample");
  });

  /* Prequal "$212,000" and Tier "PREMIUM_STACK" on #13 are not read off the
     report — decision.rendered stamped them on the client from it. The sample
     row keeps that decision too (preapprovals.totalCombined, outcome_tier),
     which is what ties the two figures to it. */
  test("a Prequal and a Tier set by a sample report's decision say sample; a real pull's never do", () => {
    const P = loadPanel();
    const sampleDecided = {
      id: "fe92316e-ee62-49ff-9990-88f818abe074", outcome_tier: "PREMIUM_STACK", created_at: AT,
      result: { ...sampleRow.result, preapprovals: { totalCombined: 212000 } }
    };
    assert.deepEqual({ ...P.sampleDecision([sampleDecided]) }, { prequal: 212000, tier: "PREMIUM_STACK" });
    // The row arrives as a JSON string on some paths; same answer.
    assert.deepEqual({ ...P.sampleDecision([{ ...sampleDecided, result: JSON.stringify(sampleDecided.result) }]) },
      { prequal: 212000, tier: "PREMIUM_STACK" });
    // A sample with no pre-approval on it answers a tier only — never a guessed figure.
    assert.deepEqual({ ...P.sampleDecision([{ ...sampleDecided, result: sampleRow.result }]) },
      { prequal: null, tier: "PREMIUM_STACK" });
    // The Colin control: real pulls, no stamp — nothing is a sample.
    const realDecided = { id: "3745a02c", outcome_tier: "FRAUD_HOLD", created_at: "2026-08-24T23:46:48.040Z",
      result: { source: "crs", environment: "production", inquiries: INQ } };
    assert.equal(P.sampleDecision([realDecided]), null);
    // Only the NEWEST report set today's Prequal / Tier: a sample under a newer real pull is not it.
    const older = { ...sampleDecided, created_at: "2026-09-01T00:00:00.000Z" };
    const newerReal = { ...realDecided, created_at: "2026-09-10T00:00:00.000Z" };
    assert.equal(P.sampleDecision([older, newerReal]), null);
    // ...and a sample loaded after a real pull is.
    assert.equal(P.sampleDecision([realDecided, sampleDecided]).tier, "PREMIUM_STACK");
    assert.equal(P.sampleDecision([]), null);
    assert.equal(P.sampleDecision(null), null);
    assert.equal(P.sampleDecision([{ created_at: AT, result: "{not json" }]), null);
  });

  test("the Prequal tile and the Tier line are wired to sampleDecision()", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(PANEL_HTML, /id="ccp-prequal">—<\/div>\s*<p class="fact-note" id="ccp-prequal-sample" hidden><\/p>/,
      "the sample line is gone from the Prequal tile");
    assert.match(code, /var sampleDec = FHCP\.sampleDecision\(d\.crs_results\);/);
    assert.match(code, /String\(c\.outcome_tier\) === sampleDec\.tier;/,
      "the Tier is no longer matched to the sample report's own tier");
    assert.match(code, /setText\("ccp-tier", sampleTier \? c\.outcome_tier \+ " · sample" : c\.outcome_tier\);/);
    assert.match(code, /money\(prequal\) !== "—" && Number\(prequal\) === sampleDec\.prequal;/,
      "the Prequal is no longer matched to the sample report's own pre-approval");
    assert.match(code, /prequalNote\.textContent = samplePrequal \? FHCP\.SAMPLE_FIGURE_NOTE : "";/);
    assert.match(code, /prequalNote\.hidden = !samplePrequal;/);
  });
});

describe("client-control-panel.html — the System Facts header says the state it is in (hole N21)", () => {
  /* Live 2026-09-18: opening System Facts turned the arrow and set
     aria-expanded="true", but the header still read "collapsed" while the list
     sat open under it. This runs the page's own fold script against the page's
     own System Facts button, with a stand-in DOM, and reads the header words
     after each click. */
  function factsHeader() {
    const m = PANEL_HTML.match(/<button class="group-title card-title tog"[^>]*aria-controls="facts-body"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(m, "the System Facts header button is gone");
    const start = m[0].match(/aria-expanded="(true|false)"/);
    assert.ok(start, "the System Facts header lost aria-expanded");
    const attrs = { "aria-controls": "facts-body", "aria-expanded": start[1] };
    const chev = m[1].match(/<span class="chev">([\s\S]*?)<span class="cg">/);
    assert.ok(chev, "the System Facts header lost its state words");
    const s = chev[1].match(/<span class="tog-state"([^>]*)>([^<]*)<\/span>/);
    const state = s && {
      textContent: s[2],
      getAttribute: (k) => ((s[1].match(new RegExp(k + '="([^"]*)"')) || [])[1] ?? null)
    };
    const listeners = [];
    const button = {
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute: (k, v) => { attrs[k] = String(v); },
      addEventListener: (type, fn) => { if (type === "click") listeners.push(fn); },
      querySelector: (sel) => (sel === ".tog-state" ? state : null),
      click: () => listeners.forEach((fn) => fn())
    };
    const words = () => (state ? state.textContent : chev[1].replace(/<[^>]*>/g, "")).trim();
    return { button, attrs, words };
  }

  function runFold(button) {
    const a = PANEL_HTML.indexOf("/* Groups fold. */");
    assert.ok(a !== -1, "the fold script is gone");
    const b = PANEL_HTML.indexOf("</script>", a);
    const body = { hidden: /<div class="group-body" id="facts-body" hidden>/.test(PANEL_HTML) };
    const document = {
      querySelectorAll: (sel) => (sel === ".group-title.tog" ? [button] : []),
      getElementById: (id) => (id === "facts-body" ? body : null)
    };
    vm.runInNewContext(PANEL_HTML.slice(a, b), { document });
    return body;
  }

  test("it says collapsed when shut, open when open, and aria-expanded agrees", () => {
    const { button, attrs, words } = factsHeader();
    const body = runFold(button);

    assert.equal(body.hidden, true, "System Facts no longer starts shut");
    assert.equal(attrs["aria-expanded"], "false");
    assert.equal(words(), "collapsed");

    button.click();
    assert.equal(body.hidden, false, "clicking the header did not open the list");
    assert.equal(attrs["aria-expanded"], "true");
    assert.equal(words(), "open", "the header still says \"" + words() + "\" while the list is open");

    button.click();
    assert.equal(body.hidden, true, "a second click did not shut the list");
    assert.equal(attrs["aria-expanded"], "false");
    assert.equal(words(), "collapsed");
  });
});
