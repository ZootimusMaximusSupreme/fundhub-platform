/* Hole 9, live 2026-09-18 — the staff view of a client's portal hid the bill.
 *
 * File #8 owed $2,500 (invoice INV-B4B9C768, sent, $0 paid). Ops AR and
 * /api/read/portal-summary both had it. The staff Payments tab on
 * /app/client-portal.html?id=… showed only "Card Stacking DFY 3000.00
 * succeeded": staff painted the pane from /api/dashboard/client, which carries
 * no bill, and the portal-summary bill was painted for clients only.
 *
 * The fix paints the staff pane from both reads. Either can land first, so the
 * tests below run the real painter in both orders and read the pane a person
 * would see. The functions are sliced out of the shipped page and executed
 * against one fake node — the same approach as
 * src/http/client-panel-portal-link.test.mjs. The dollar figures live here, not
 * in the page: crm-html.test.mjs forbids list prices inside the HTML.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "../../public/app/client-portal.html");
const html = fs.readFileSync(PORTAL, "utf8");
const portalRead = fs.readFileSync(path.resolve(HERE, "../../api/read/portal-summary.mjs"), "utf8");

/* One function, from `function <name>(` to its matching brace. */
function sliceFn(name) {
  const a = html.indexOf("function " + name + "(");
  assert.ok(a !== -1, `${name} is gone from client-portal.html`);
  let depth = 0;
  for (let i = html.indexOf("{", a); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(a, i + 1);
  }
  throw new Error(`${name} never closes`);
}

function staffPayBlock() {
  const a = html.indexOf("var staffPay =");
  assert.ok(a !== -1, "the staff Payments pane has no shared state — hole 9 is back");
  const fn = sliceFn("paintStaffPays");
  return html.slice(a, html.indexOf(fn) + fn.length);
}

function makePane() {
  const pane = { innerHTML: "(untouched)" };
  const sandbox = {
    document: { getElementById: (id) => (id === "tp-pay" ? pane : null) },
    window: { location: { origin: "https://fundhub.ai" } },
    URL,
    Date
  };
  vm.createContext(sandbox);
  vm.runInContext(
    [sliceFn("esc"), sliceFn("fmtWhen"), sliceFn("fmtPayAmount"), sliceFn("fmtPayWhen"), sliceFn("payHref"), sliceFn("paintPays"), staffPayBlock()].join("\n"),
    sandbox
  );
  return { pane, paint: (part, value) => sandbox.paintStaffPays(part, value) };
}

const ROWS = [{ product_name: "Card Stacking DFY", amount_paid: "3000.00", status: "succeeded", created_at: "2026-09-17T17:46:48Z" }];
const DUE = {
  count: 1,
  currency: "USD",
  total: 2500,
  total_display: "$2,500.00",
  items: [{
    reference: "INV-B4B9C768",
    kind: "basic business consulting fee",
    amount: 2500,
    amount_display: "$2,500.00",
    status: "sent",
    pay_url: "https://checkout.example/pay/abc"
  }]
};

describe("client portal — staff Payments tab shows the bill (hole 9)", () => {
  test("both staff reads feed the pane", () => {
    assert.match(html, /paintStaffPays\("rows",\s*res\.data\.transactions\)/,
      "the staff paid list must go through paintStaffPays");
    assert.doesNotMatch(html, /paintPays\(res\.data\.transactions\)/,
      "painting the staff pane from transactions alone is what hid the bill");
    assert.match(html, /paintStaffPays\("due",\s*data\.invoice_due\)/,
      "the staff view must take the bill from portal-summary");
  });

  test("the portal offers only active invoice checkout links", () => {
    assert.match(portalRead, /pl\.status IN \('created', 'sent'\)/,
      "expired, void, and paid checkout links must not be offered");
    assert.match(portalRead, /pl\.amount_cents = \(v\.open_balance \* 100\)::bigint/,
      "a stale full-balance checkout must not be offered after partial payment");
    assert.doesNotMatch(portalRead, /pl\.status <> 'paid'/);
    const { pane, paint } = makePane();
    paint("due", DUE);
    assert.match(pane.innerHTML, /basic business consulting fee/);
  });

  test("a fee invoice cannot display a newer other-provider link over its Commas checkout", () => {
    assert.match(portalRead,
      /pl\.provider = 'commas' OR \(\s*v\.source IS DISTINCT FROM 'funding_success_fee'\s+AND i\.invoice_type IS DISTINCT FROM 'success_fee'\s*\)/,
      "fee invoices must use Commas even when another provider has a newer same-balance link");
    assert.match(portalRead, /ORDER BY pl\.created_at DESC/,
      "newest-link selection makes this provider gate necessary");
  });

  test("paid list first, bill second — the $2,500 shows with the payment", () => {
    const { pane, paint } = makePane();
    paint("rows", ROWS);
    assert.ok(!pane.innerHTML.includes("Due now"));
    paint("due", DUE);
    assert.ok(pane.innerHTML.includes("Due now"), "the bill must show");
    assert.ok(pane.innerHTML.includes("$2,500.00"));
    assert.ok(pane.innerHTML.includes("INV-B4B9C768"));
    assert.ok(pane.innerHTML.includes("Card Stacking DFY"), "the payment must stay");
  });

  test("bill first, paid list second — same screen", () => {
    const a = makePane();
    a.paint("rows", ROWS);
    a.paint("due", DUE);
    const b = makePane();
    b.paint("due", DUE);
    assert.ok(b.pane.innerHTML.includes("$2,500.00"), "an owed bill paints as soon as it lands");
    b.paint("rows", ROWS);
    assert.equal(b.pane.innerHTML, a.pane.innerHTML);
  });

  test("nothing owed does not print a false 'No payments yet' before the paid list lands", () => {
    const { pane, paint } = makePane();
    paint("due", { count: 0, currency: "USD", total: 0, total_display: "$0.00", items: [] });
    assert.equal(pane.innerHTML, "(untouched)");
    paint("rows", ROWS);
    assert.ok(pane.innerHTML.includes("Card Stacking DFY"));
    assert.ok(!pane.innerHTML.includes("No payments yet"));
  });

  test("a failed bill read says so once the paid list is in", () => {
    const { pane, paint } = makePane();
    paint("due", null);
    assert.equal(pane.innerHTML, "(untouched)");
    paint("rows", ROWS);
    assert.ok(pane.innerHTML.includes("We could not check what you owe"));
    assert.ok(pane.innerHTML.includes("Card Stacking DFY"));
  });
});

/* Launch pass R20 / CP-02 — the paid list printed the raw database text, so the
 * Payments tab read "Consulting Services Assessment  1/2/2026, 3:04:05 PM
 * 147.00succeeded": no dollar sign, no gap before the status, seconds in the
 * date. The tests read the pane text a person would read (tags stripped), so a
 * pill that touches the amount again goes red. Product names and the word on
 * the pill are copy and are not under test here. */
describe("client portal — Payments tab money and date read cleanly (R20 / CP-02)", () => {
  const paneText = (innerHTML) => innerHTML.replace(/<[^>]*>/g, "");
  const paintRows = (rows) => {
    const { pane, paint } = makePane();
    paint("rows", rows);
    paint("due", { count: 0, currency: "USD", total: 0, total_display: "$0.00", items: [] });
    return pane.innerHTML;
  };
  const row = (amount_paid, extra = {}) => ({
    product_name: "Capital Blueprint",
    amount_paid,
    status: "succeeded",
    created_at: "2026-10-12T21:04:05Z",
    ...extra
  });

  test("the database text 147.00 prints as $147.00, with a space before the status", () => {
    const inner = paintRows([row("147.00")]);
    assert.match(paneText(inner), /\$147\.00 succeeded/, "dollar sign, cents, then a space, then the status");
    assert.ok(!paneText(inner).includes("147.00succeeded"), "the amount must not touch the status");
    assert.ok(!/(^|[^$\d,.])147\.00/.test(paneText(inner)), "no bare 147.00 without a dollar sign");
  });

  test("thousands get a comma and a whole number gets cents", () => {
    assert.match(paneText(paintRows([row("3000.00")])), /\$3,000\.00 succeeded/);
    assert.match(paneText(paintRows([row(32)])), /\$32\.00 succeeded/);
    assert.match(paneText(paintRows([row("1234567.5")])), /\$1,234,567\.50 succeeded/);
  });

  test("zero is $0.00, not a blank and not a dash", () => {
    assert.match(paneText(paintRows([row("0.00")])), /\$0\.00 succeeded/);
    assert.match(paneText(paintRows([row(0)])), /\$0\.00 succeeded/);
  });

  test("a missing amount stays a dash and never becomes $0.00 (NULL means unknown)", () => {
    const text = paneText(paintRows([row(null)]));
    assert.match(text, /— succeeded/);
    assert.ok(!text.includes("$0.00"));
  });

  test("an amount that already has a dollar sign is not doubled (demo portal sample)", () => {
    const text = paneText(paintRows([row("$297.00", { status: "paid" })]));
    assert.match(text, /\$297\.00 paid/);
    assert.ok(!text.includes("$$"));
  });

  test("text that is not a number prints as it arrived, not as a guess", () => {
    assert.match(paneText(paintRows([row("see invoice")])), /see invoice succeeded/);
  });

  test("a negative amount keeps its sign in front of the dollar sign", () => {
    assert.match(paneText(paintRows([row("-50.00", { status: "refunded" })])), /-\$50\.00 refunded/);
  });

  test("the date has no seconds", () => {
    const text = paneText(paintRows([row("147.00")]));
    assert.ok(!/\d{1,2}:\d{2}:\d{2}/.test(text), "no h:mm:ss anywhere in the row: " + text);
    assert.match(text, /\d{1,2}:\d{2}/, "the hour and minute still show");
  });

  test("a date that cannot be read prints as it arrived", () => {
    assert.match(paneText(paintRows([row("147.00", { created_at: "not a date" })])), /not a date/);
  });

  test("only the Payments tab changed: the other fmtWhen callers still use fmtWhen", () => {
    assert.ok(
      (html.match(/fmtWhen\(/g) || []).length >= 5,
      "fmtWhen is shared by the agreements, documents and messages lists and is not touched by this fix"
    );
  });
});
