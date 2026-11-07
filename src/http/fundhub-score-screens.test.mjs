// The two Fundhub score screens, run in Node against the REAL look-ahead
// contract (src/finance/fundhub-lookahead.mjs builds it from rows):
//   - the staff card "If they follow the plan" (public/app/fundhub-plan-card.js)
//   - the client card "Your Fundhub score" (public/app/money-fundability.js)
// Both ways: what each shows, and what neither may show (the formula, a
// probability word, a sum of businesses). Plus the CSS rules: 44px controls,
// brand-token type, no fixed width that forces a phone page wider.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { buildLookahead } from "../finance/fundhub-lookahead.mjs";
import { addMonths } from "../finance/fundability.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const CARD_JS = fs.readFileSync(path.join(APP, "fundhub-plan-card.js"), "utf8");
const CARD_CSS = fs.readFileSync(path.join(APP, "fundhub-plan-card.css"), "utf8");
const MONEY_JS = fs.readFileSync(path.join(APP, "money-fundability.js"), "utf8");
const MONEY_CSS = fs.readFileSync(path.join(APP, "money-fundability.css"), "utf8");
const COCKPIT = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
const CCP = fs.readFileSync(path.join(APP, "client-control-panel.html"), "utf8");

function load(js) {
  const sandbox = { window: {} };
  vm.runInNewContext(js, sandbox);
  return sandbox.window;
}
const PLAN = load(CARD_JS).FHPlanCard;
const MONEY = load(MONEY_JS).FHMoneyFundability;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/* One messed-up sample file (test rows only): a card at 90% use, two negative
   items with a dispute plan, a paydown waypoint, one young business. */
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
const LINE = (id, lender, limit, balance, opened) => ({
  id, lender, kind: "revolving", credit_limit_cents: limit, balance_cents: balance, opened_on: opened, closed_at: null,
  last4: null, apr: null, raw: { accountStatusType: "Open" }
});
function messy(view = "plan", months = 9) {
  return buildLookahead({
    client: { id: "c1", first_name: "Sample", last_name: "Client",
      custom_fields: { crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 0, crs_negative_items_count: 2, crs_late_payments_count: 0 } },
    asOf: new Date(),
    crsRows: [{ id: "p1", created_at: "2026-09-30T04:30:03.759Z", result: { scores: { ex: 712, eq: 705, tu: 700 }, environment: "simulated", simulated: true } }],
    tradelineRows: [LINE("a1", "CHASE", "1000000", "900000", ago(40)), LINE("a2", "AMEX", "800000", "100000", ago(40)), LINE("a3", "CAPITAL ONE", "600000", "50000", ago(40))],
    liabilities: ["a1", "a2", "a3"].map((id) => ({ tradeline_id: id, payment_status: "current", as_of: "2026-09-30" })),
    waypoints: [{ key: "pd", state: "not_started", due_at: addMonths(TODAY, 2), verify_kind: "paydown", params: { creditor: "CHASE", creditor_key: "chase", target_cents: 100000 } }],
    disputeItems: [
      { id: "d1", rule_id: "DEROG-COLLECTION", status: "open", creditor: "Midland Credit", account_last4: "1111" },
      { id: "d2", rule_id: "DEROG-CHARGEOFF", status: "sent", creditor: "Portfolio Recovery", account_last4: "2222" }
    ],
    businessRows: [{ id: "b1", name: "Sample Freight LLC", age_months: 8, entity_data: {}, created_at: "2026-03-01T00:00:00Z" }],
    relationships: [], months, view
  });
}

describe("the staff card — If they follow the plan", () => {
  test("a business amount shows only with business evidence behind it", () => {
    const d = messy();
    const bare = text(PLAN.render(d));
    assert.match(bare, /Sample Freight LLC Business report needed/);
    const backed = JSON.parse(JSON.stringify(d));
    for (const b of backed.roadmap.businesses) b.supported = true;
    const t = text(PLAN.render(backed));
    assert.match(t, /Each business at month 9 Sample Freight LLC about \$55,000 17 months old/);
    assert.doesNotMatch(t, /Business report needed/);
  });

  test("leads with the closing line, then today against month 9, the path, each business and the reasons", () => {
    const d = messy();
    const html = PLAN.render(d);
    const t = text(html);
    assert.match(t, /^If they follow the plan UnderwriteIQ estimate · staff only/);
    assert.match(html, /data-fpc-closing>Not fundable today\. If you follow this plan, the disputed items come off and nothing new hits your file, in 9 months UnderwriteIQ estimates Fundable, about \$55,000 personal\.</);
    assert.match(html, /data-fpc-month="9" aria-pressed="true"/);
    assert.match(html, /data-fpc-month="3" aria-pressed="false"/);
    assert.equal((html.match(/<option /g) || []).length, 24, "any month, 1 to 24");
    assert.match(t, /Today .* Fundhub score .* In 9 months .* In 9 months, if removed/);
    assert.match(t, /The path .*Repair rounds end about .*if all negative items are removed by then/);
    assert.match(t, /Pay CHASE down to \$1,000\./);
    assert.match(t, /Sample Freight LLC turns 12 months/);
    // No saved business report and no reviewed papers: no business amount (Codex, binding).
    assert.match(t, /Each business at month 9 Sample Freight LLC Business report needed 17 months old · 1× the card figure/);
    assert.doesNotMatch(t, /Sample Freight LLC about \$/);
    assert.match(t, /What moves the score most/);
    assert.match(t, /What this assumes/);
  });

  test("any month: month 18 shows its own column and closing line", () => {
    const t = text(PLAN.render(messy("plan", 18)));
    assert.match(t, /in 18 months UnderwriteIQ estimates Fundable/);
    assert.match(t, /In 18 months/);
  });

  test("never shows the formula, a probability word, a business total or a heavy disclaimer", () => {
    const html = PLAN.render(messy());
    assert.doesNotMatch(html, /weight|zero_at|full_at/);
    assert.doesNotMatch(html, /probab|100%|guarantee|likely|chance|not promised|not an approval/i);
    assert.doesNotMatch(text(html), /total/i);
  });

  test("no pull, loading and error each say what is happening, in words", () => {
    assert.match(text(PLAN.renderEmpty({ months: 9 })), /No credit report on file yet\. Run the soft pull/);
    assert.match(PLAN.renderLoading(9), /aria-busy="true"/);
    const err = PLAN.renderError(9);
    assert.match(err, /role="alert"/);
    assert.match(err, /data-fpc-act="retry"/);
    assert.match(PLAN.render({ has_pull: false, months: 9 }), /No credit report on file yet/);
  });
});

describe("the client card — Your Fundhub score", () => {
  test("today, and in 9 months if you follow your plan, with the UnderwriteIQ estimate and three reasons", () => {
    const html = MONEY.renderScoreCard(messy("lookahead"), 9);
    const t = text(html);
    assert.match(t, /^Your Fundhub score Today \d+ out of 100 (Building|Close|Fundable)/);
    assert.match(t, /In 9 months if you follow your plan \d+ out of 100 (Building|Close) UnderwriteIQ estimate: Not fundable yet/);
    assert.match(t, /If your disputed items come off: \d+ · Fundable/);
    assert.match(html, /data-fh-month="9" aria-pressed="true"/);
    assert.equal((html.match(/<option /g) || []).length, 24);
    assert.ok((html.match(/<li>/g) || []).length <= 3);
    assert.doesNotMatch(html, /weight|probab|not promised|not an approval/i);
  });

  test("a body that is not the look-ahead, or a file with no pull, paints nothing", () => {
    assert.equal(MONEY.renderScoreCard({ ok: true, has_pull: true }, 9), "");
    assert.equal(MONEY.renderScoreCard({ ...messy("lookahead"), has_pull: false }, 9), "");
  });

  test("the section leaves a slot for the card in both of its layouts", () => {
    const legacy = MONEY.renderFull({ ok: true, has_pull: true, now: {}, projections: [], businesses: [], plan: {}, cannot_project: [] });
    assert.match(legacy, /data-fh-score-slot/);
    const current = MONEY.renderFull({ ok: true, has_pull: true, now: {}, projections: [], businesses: [], plan: {}, cannot_project: [],
      opportunity: { basis: "current_crs_engine", personal: { status: "modeled", currentCents: 100, projectedCents: 200, blockers: [] }, businesses: [], combined: {}, steps: [], limitations: [] } });
    assert.match(current, /data-fh-score-slot/);
  });
});

describe("where the staff card sits, and its styles", () => {
  test("the cockpit mounts it right after the credit facts; the client file mounts it on the Funding tab", () => {
    const funding = COCKPIT.indexOf('class="sec funding-estimate"');
    const facts = COCKPIT.indexOf('class="sec two client-facts"');
    const card = COCKPIT.indexOf("data-fh-plan-card");
    const precall = COCKPIT.indexOf('class="sec precall-context"');
    assert.ok(funding > 0 && facts > funding && card > facts && card < precall,
      "funding, then the credit facts (inside the first phone screen), then this card");
    assert.match(COCKPIT, /<script defer src="\/app\/fundhub-plan-card\.js"><\/script>/);
    assert.match(COCKPIT, /href="\/app\/fundhub-plan-card\.css"/);
    const tab = CCP.indexOf('id="ccp-view-funding"');
    const ccpCard = CCP.indexOf("data-fh-plan-card");
    assert.ok(tab > 0 && ccpCard > tab && ccpCard < CCP.indexOf('id="ccp-view-credit"'));
    assert.match(CCP, /<script defer src="\/app\/fundhub-plan-card\.js"><\/script>/);
    // The Present button and its wiring are untouched by this card.
    assert.doesNotMatch(CARD_JS, /fh-present|present\.js/);
  });

  test("controls are 44px, type comes from the brand tokens, and nothing fixed forces a phone page wider", () => {
    for (const css of [CARD_CSS, MONEY_CSS]) {
      assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /font-size:\s*\d+px/);
    }
    assert.match(CARD_CSS, /\.fpc-pick\{min-height:44px/);
    assert.match(CARD_CSS, /\.fpc-any select\{min-height:44px/);
    assert.match(CARD_CSS, /\.fpc-btn\{min-height:44px/);
    assert.match(CARD_CSS, /\.fpc-assume summary\{display:flex;align-items:center;min-height:44px/);
    assert.match(MONEY_CSS, /\.fd-fh-pick\{min-height:44px/);
    assert.match(MONEY_CSS, /\.fd-fh-any select\{min-height:44px/);
    for (const m of CARD_CSS.matchAll(/(?:^|[;{])\s*width\s*:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 120, m[0]);
    assert.match(CARD_CSS, /@media \(max-width:720px\)\{[\s\S]*\.closer-workspace \.fh-plan-card\{order:2\}/, "on a phone it follows the credit facts");
  });
});
