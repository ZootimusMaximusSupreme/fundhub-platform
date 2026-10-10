// /app/money-payments.html — runs money-payments.js's own render functions
// against the sample fixture (a $1,500 Clarity Payment in 3 payments — one
// paid, one 4 days late, one coming — and a $600 BNPL plan).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

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

test("full: what is owed, late said in words, the schedule, coming up, the helper's log, and a person", () => {
  const t = text(P.render(fixture()));
  assert.match(t, /You owe Fundhub \$1,450\.00/);
  assert.match(t, /Late now \$500\.00 Late 4 days 1 plan/);
  assert.match(t, /Fundhub payment plan/);
  assert.match(t, /Buy now, pay later plan with Fundhub LLC/);
  assert.match(t, /Paid so far \$500\.00 of \$1,500\.00/);
  assert.match(t, /Paid so far \$150\.00 of \$600\.00/);
  assert.match(t, /Oct 2, 2026 \$500\.00 \$0\.00 Late 4 days/);
  assert.match(t, /Coming up/);
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
