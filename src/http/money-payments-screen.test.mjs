// /app/money-payments.html — runs money-payments.js's own render functions
// against the sample fixture (a $1,500 Clarity Payment in 3 payments — one
// paid, one 4 days late, one coming — and a $600 BNPL plan).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { sampleWhopPayload } from "./fixtures/whop-plans.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-payments.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-payments.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-payments.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoneyPayments;
}
const P = load();
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the page loads its script, reads /api/money/payments, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-payments\.js"><\/script>/);
  assert.match(HTML, /id="payments-root"/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(JS, /"\/api\/money\/payments"/);
});

test("the shared money nav, in the board's order, with Payments marked as the current page", () => {
  const hrefs = [...HTML.matchAll(/<nav class="mnav"[\s\S]*?<\/nav>/g)][0][0].match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"]);
  assert.match(HTML, /href="\/app\/financeos\.html#payments" aria-current="page"/);
});

test("full: what is owed, late said in words, the schedule, payments due, the helper's log, and a person", () => {
  const t = text(P.render(fixture()));
  assert.match(t, /You owe Fundhub \$1,450\.00/);
  assert.match(t, /Late now \$500\.00 Late 4 days 1 plan/);
  assert.match(t, /Fundhub payment plan/);
  assert.match(t, /Buy now, pay later plan with Fundhub LLC/);
  assert.match(t, /Paid so far \$500\.00 of \$1,500\.00/);
  assert.match(t, /Paid so far \$150\.00 of \$600\.00/);
  assert.match(t, /Oct 2, 2026 \$500\.00 \$0\.00 Late 4 days/);
  assert.match(t, /Payments due/);
  assert.match(t, /Business Amex Card payment \$135\.00 Oct 21/);
  assert.match(t, /Checked in again about Fundhub payment plan — payment 2\./);
  assert.match(t, /It never moves money\./);
  assert.match(t, /Talk to a person/);
});

test("a client never sees plan controls; staff do", () => {
  const client = P.render(fixture());
  assert.doesNotMatch(client, /data-form="record"|data-form="add"|data-act="settle"/);
  const staff = P.render(fixture(), { staff: true });
  assert.match(staff, /data-form="record"/);
  assert.match(staff, /data-form="add"/);
  assert.match(staff, /data-act="settle"/);
});

test("a payment Commas marked paid says 'Paid via Commas'; a staff-recorded one does not", () => {
  assert.equal(P.logSentence({ action: "payment_recorded", amount_cents: 50000, via: "commas" }), "Paid via Commas: recorded your payment of $500.00. Thank you.");
  assert.equal(P.logSentence({ action: "payment_recorded", amount_cents: 50000, via: null }), "Recorded your payment of $500.00. Thank you.");
});

test("unmatched Commas payments: a staff-only list, in words, and never on the client's page", () => {
  const d = fixture();
  d.unmatched_payments = [{ id: "u1", decided_on: "2026-10-06", reason: "amount_does_not_match", amount_cents: 20000 }];
  const staff = text(P.render(d, { staff: true }));
  assert.match(staff, /Commas payments not matched to a plan/);
  assert.match(staff, /The amount is not the next payment or the full balance\. Nothing was applied\./);
  assert.match(staff, /\$200\.00 Oct 6/);
  assert.doesNotMatch(text(P.render(d)), /not matched to a plan/);
  d.unmatched_payments = [];
  assert.doesNotMatch(text(P.render(d, { staff: true })), /not matched to a plan/);
});

test("one primary button on the page", () => {
  const html = P.render(fixture(), { staff: true });
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
});

test("empty: says nothing is owed and still offers a person", () => {
  const d = fixture();
  d.plans = []; d.owed = { open_count: 0, left_cents: 0, late_cents: 0, late_count: 0 }; d.agent_log = [];
  const t = text(P.render(d));
  assert.match(t, /You do not owe Fundhub anything right now/);
  assert.match(t, /Talk to a person/);
  assert.doesNotMatch(t, /\$NaN|undefined/);
});

test("loading is a skeleton in the real layout; errors say what failed in words", () => {
  assert.match(P.renderLoading(), /aria-busy="true"/);
  assert.match(text(P.renderError("offline")), /could not reach the server/);
  assert.match(P.renderError("nodb"), /data-act="retry"/);
});

test("money is cents; null is a dash; typed dollars become cents without float maths", () => {
  assert.equal(P.money(150000), "$1,500.00");
  assert.equal(P.money(null), "—");
  assert.equal(P.toCents("1,500.05"), 150005);
  assert.equal(P.toCents("19.9"), 1990);
  assert.equal(P.toCents("abc"), null);
  assert.deepEqual(JSON.parse(JSON.stringify(P.parseSchedule("2026-11-01, 500\n2026-12-01 500.00"))),
    { installments: [{ due_on: "2026-11-01", amount_cents: 50000 }, { due_on: "2026-12-01", amount_cents: 50000 }] });
  assert.match(P.parseSchedule("nope").error, /Line 1/);
});

test("FinanceOS section: mount(el, ctx) paints into el through ctx.apiGet, with no page chrome", async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  const section = sandbox.window.FinanceOS.sections.payments;
  assert.equal(typeof section.mount, "function");
  const el = { innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, contains: () => true };
  const asked = [];
  const handle = section.mount(el, { clientId: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e", apiGet: async (p) => { asked.push(p); return fixture(); }, apiPost: async () => ({ ok: true }) });
  await handle.reload();
  assert.equal(asked[0], "/api/money/payments?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e");
  assert.match(el.innerHTML, /^<div class="fh-payments">/);
  assert.match(text(el.innerHTML), /You owe Fundhub \$1,450\.00/);
  assert.match(el.innerHTML, /data-form="record"/, "a clientId (staff desk) shows plan controls");
  assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
  assert.equal(typeof el.listeners.click, "function");
  handle.unmount();
  assert.equal(el.innerHTML, "");
});

test("the section's styles all live under .fh-payments", () => {
  const css = fs.readFileSync(path.join(APP, "money-payments.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-payments /, part);
  assert.match(HTML, /<link rel="stylesheet" href="money-payments\.css">/);
});

test("the log never claims a text went out when it did not", () => {
  assert.match(P.logSentence({ action: "late_check_in", item_label: "X", message_status: "opted_out" }), /the text was not sent/);
  assert.match(P.logSentence({ action: "held", item_label: "X", reason: "opted_out" }), /asked us not to text you/);
});

/* ── phone alerts on each plan (unit D2, owner-set 2026-11-07) ── */
const PLAN_ID = FIXTURE.plans[0].id;
const planHtml = (html, id = PLAN_ID) => {
  const start = html.indexOf(`data-plan="${id}"`);
  return html.slice(start, html.indexOf("</article>", start));
};
const withPhone = (over = {}, plan = {}) => {
  const d = fixture();
  d.phone = { ...d.phone, ...over, plans: { [PLAN_ID]: { ...d.phone.plans[PLAN_ID], ...plan } } };
  return d;
};

test("phone line: the day the alert goes, 3 days before; today inside the window; sent once it went; the label is said once", () => {
  const before = text(planHtml(P.render(withPhone({}, { reason: null, due_on: "2026-11-02", alert_on: "2026-10-30" }))));
  assert.match(before, /Phone alert Goes Oct 30, 3 days before it is due\./);
  // Inside the window it goes today, whatever the days left (here 2), so it does not say "3 days before".
  const today = text(planHtml(P.render(withPhone({}, { reason: null, due_on: "2026-10-08", alert_on: "2026-10-06" }))));
  assert.match(today, /Phone alert Goes today\./);
  assert.doesNotMatch(today, /days before it is due/);
  const sent = text(planHtml(P.render(withPhone({}, { reason: null, due_on: "2026-10-08", alert_on: "2026-10-06", sent: "sent" }))));
  assert.match(sent, /Phone alert Sent for Oct 8\./);
  for (const t of [before, today, sent]) assert.doesNotMatch(t, /Phone alert Phone alert/);
});

test("phone line: honest when it cannot go — late, STOP, switched off, no phone; staff get no button", () => {
  assert.match(text(planHtml(P.render(fixture()))), /This payment is past due, so no .due soon. phone alert goes\./);
  assert.match(text(planHtml(P.render(withPhone({ opted_out: true })))), /You replied STOP, so no phone alert goes\./);
  const off = planHtml(P.render(withPhone({ enabled: false })));
  assert.match(text(off), /Phone alert Off\. Turn them on/);
  assert.doesNotMatch(text(off), /Phone alert Phone alert/);
  assert.match(off, /href="\/app\/financeos\.html#alerts"/);
  const noPhone = planHtml(P.render(withPhone({ has_phone: false }, { reason: null, alert_on: "2026-10-30" })));
  assert.match(noPhone, /href="\/app\/client-portal\.html#push-card"/);
  const staff = planHtml(P.render(withPhone({ has_phone: false }, { reason: null, alert_on: "2026-10-30" }), { staff: true }));
  assert.match(text(staff), /This client has not set up a phone for alerts yet\./);
  assert.doesNotMatch(staff, /Set up my phone|Turn them on/);
});

test("phone line: no phone block (an older server or a failed read) claims nothing; a settled plan says nothing", () => {
  const d = fixture();
  delete d.phone;
  assert.doesNotMatch(P.render(d), /phone-line/);
  const settled = withPhone({}, { reason: null, alert_on: "2026-10-30" });
  settled.plans[0].status = "settled";
  assert.doesNotMatch(planHtml(P.render(settled)), /phone-line/);
});

/* Whop plans and the provider logos (unit W): money-whop-plans.js loaded beside this file, the way
   /app/financeos.html and /app/money-payments.html load both. */
function loadWithWhop() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, "money-whop-plans.js"), "utf8"), sandbox);
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoneyPayments;
}
const cardOf = (html, attr) => {
  const at = html.indexOf(attr);
  assert.ok(at >= 0, attr);
  return html.slice(at, html.indexOf("</article>", at));
};

test("both pages load the Whop plans file before the Payments script", () => {
  assert.match(HTML, /<link rel="stylesheet" href="money-whop-plans\.css">/);
  assert.match(HTML, /<script defer src="money-whop-plans\.js"><\/script>\s*<script defer src="money-payments\.js"><\/script>/);
  const fos = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");
  assert.match(fos, /<link rel="stylesheet" href="money-whop-plans\.css">/);
  assert.match(fos, /<script defer src="money-whop-plans\.js"><\/script>\s*<script defer src="money-payments\.js"><\/script>/);
});

test("Whop plans sit under the Clarity plans; only a plan owed to ClarityPay wears its logo; the tile adds the Whop estimate", () => {
  const PW = loadWithWhop();
  const d = fixture();
  d.whop = sampleWhopPayload("2026-10-06").whop;
  d.upcoming = [...d.upcoming, { type: "whop", name: "Sample Monthly Program", on: "2026-10-08", amount_cents: 50000 }];
  const html = PW.render(d);
  const clarity = d.plans.find((p) => p.kind === "clarity");
  const bnpl = d.plans.find((p) => p.kind === "bnpl");
  // The sample's Clarity plan is owed to Fundhub LLC: kind "clarity" alone does not prove ClarityPay (Codex CX21).
  assert.equal(clarity.owed_to, "Fundhub LLC");
  assert.doesNotMatch(cardOf(html, `data-plan="${clarity.id}"`), /fh-provider-logo|claritypay/);
  assert.doesNotMatch(cardOf(html, `data-plan="${bnpl.id}"`), /fh-provider-logo/);
  // A plan that records ClarityPay as who it is paid to wears ClarityPay's own logo.
  const paidToClarityPay = { ...clarity, id: "c1a71e00-0000-4000-8000-0000000000cc", owed_to: "ClarityPay" };
  const withProvider = PW.render({ ...d, plans: [...d.plans, paidToClarityPay] });
  assert.match(cardOf(withProvider, `data-plan="${paidToClarityPay.id}"`), /<img class="fh-provider-logo" src="\/assets\/lenders\/claritypay\.svg" alt="ClarityPay"/);
  assert.equal((withProvider.match(/alt="ClarityPay"/g) || []).length, 1, "the logo is on that one plan only");
  const owed = html.slice(html.indexOf('id="b-owe"'));
  assert.ok(owed.indexOf('class="whop-plans"') > owed.indexOf('data-plan="'), "the Whop plans come after the Clarity plans");
  assert.equal((owed.match(/data-whop-plan=/g) || []).length, 5);
  assert.match(text(html), /You owe Fundhub \$1,450\.00 2 open plans · \+\$1,000\.00 on Whop/);
  assert.match(text(html), /Sample Monthly Program Whop payment \$500\.00 Oct 8/);
});

test("only Whop plans, or a Whop read that failed: never the 'nothing owed' card; without the Whop file, nothing changes", () => {
  const PW = loadWithWhop();
  const only = { ...fixture(), plans: [], whop: sampleWhopPayload("2026-10-06").whop };
  assert.doesNotMatch(PW.render(only), /You do not owe Fundhub anything right now/);
  assert.match(PW.render(only), /class="whop-plans"/);
  const failed = PW.render({ ...fixture(), plans: [], whop: null });
  assert.doesNotMatch(failed, /You do not owe Fundhub anything right now/);
  assert.match(text(failed), /Whop plans could not load\. Try again later\./);
  assert.match(PW.render({ ...fixture(), plans: [] }), /You do not owe Fundhub anything right now/);
  const alone = P.render({ ...fixture(), whop: sampleWhopPayload("2026-10-06").whop });
  assert.doesNotMatch(alone, /claritypay|whop-plans|on Whop/);
});
