// /app/money-transfers.html — runs money-transfers.js's own render functions
// in Node against one sample file (src/http/fixtures/money-transfers.sample.json:
// the FinanceOS test client's sandbox accounts, one waiting deposit, one card
// payment FinanceOS cannot send, and the settled $20.00 sandbox role-play).
// Tests that need another state change a copy and say so.
//
// What this pins (UI-STANDARDS + the hard rule): the client says yes with a
// second press on the exact sentence; staff never get an approve control; no
// approve control renders when money moves are off or for a card payment; the
// sandbox says so; status is words, not colour; four states; phone layout.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-transfers.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-transfers.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-transfers.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-transfers.sample.json"), "utf8"));
const NOW = Date.parse("2026-10-07T15:00:00Z");

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const T = W.FHMoneyTransfers;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const count = (html, re) => (html.match(re) || []).length;

test("the page loads its script and styles, reads /api/money/transfers, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-transfers\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-transfers\.css">/);
  assert.match(HTML, /id="transfers-root"/);
  assert.match(HTML, /<div class="app">/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(JS, /"\/api\/money\/transfers"/);
  assert.match(HTML, /href="\/app\/financeos\.html#transfers" aria-current="page">Transfers</);
});

test("the section registers on window.FinanceOS.sections.transfers", () => {
  assert.equal(W.FinanceOS.sections.transfers.title, "Transfers");
  assert.equal(typeof W.FinanceOS.sections.transfers.mount, "function");
});

test("sandbox: the banner says it, every time", () => {
  const t = text(T.render(fixture(), { now: NOW }));
  assert.match(t, /Practice mode These moves use Plaid's test bank \(sandbox\)\. No real money moves\./);
});

test("tiles: what waits, what moves, and the limits — from the read", () => {
  const t = text(T.render(fixture(), { now: NOW }));
  assert.match(t, /Waiting for your OK 2 \$2,135\.00 in all/);
  assert.match(t, /Moving now 0 Nothing on its way/);
  assert.match(t, /Left to move today \$4,980\.00 of \$5,000\.00 a day · up to \$2,500\.00 a move/);
});

test("a move approved for a later day is 'set for later', not 'moving now'", () => {
  const d = fixture();
  d.history.unshift({ id: "x1", title: "Later", amount_cents: 200000, to_kind: "bank_account", proposed_by: "staff", proposal_status: "claimed",
    transfer: { id: "t1", status: "approved", from_label: "Personal Checking ••1101", to_label: "Business Checking ••2202", date: "2026-10-20",
      approved_by: "client", approved_at: "2026-10-07T14:00:00Z", can_cancel: true, events: [] } });
  const t = text(T.render(d, { now: NOW }));
  assert.match(t, /Moving now 0 1 move set for later · next Oct 20/);
  assert.match(t, /Approved — goes on Oct 20/);
});

test("client: the waiting deposit shows amount, where, when, who set it up, and the account it comes from", () => {
  const html = T.render(fixture(), { now: NOW });
  const card = html.match(/<article class="card wt" data-id="7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a001">[\s\S]*?<\/article>/)[0];
  const t = text(card);
  assert.match(t, /\$2,000\.00 Set up by your Fundhub advisor/);
  assert.match(t, /Deposit to build banking history at your business account/);
  assert.match(t, /To Business Checking ••2202 On Oct 20, 2026/);
  assert.match(t, /From Personal Checking ••1101 · \$4,210\.55 available/, "the only other account is shown, not a one-item picker");
  assert.match(card, /<button class="btn-line" type="button" data-act="review">Review this move<\/button>/);
});

test("client: the yes is a second press on the exact sentence, behind 'Review this move'", () => {
  const html = T.render(fixture(), { now: NOW });
  const form = html.match(/<form class="wt-act" data-form="approve"[\s\S]*?<\/form>/)[0];
  assert.match(form, /data-amount="200000"/);
  assert.match(form, /data-to="c73daf51-36a8-4c25-a365-3b2281ae9fc7"/);
  assert.match(form, /data-date="2026-10-20"/);
  assert.match(form, /<div class="confirm" hidden>/, "the confirm step starts hidden");
  assert.match(form, /<button class="btn-primary" type="submit">Yes, move \$2,000\.00<\/button>/);
  assert.equal(T.approvalSentence(fixture().waiting[0], "Personal Checking ••1101"),
    "Move $2,000.00 from Personal Checking ••1101 to Business Checking ••2202 on Oct 20, 2026?");
});

test("one filled button per approvable move, and it sits in the hidden confirm step", () => {
  const html = T.render(fixture(), { now: NOW });
  const approvable = fixture().waiting.filter((w) => w.can_approve).length;
  assert.equal(count(html, /class="btn-primary"/g), approvable);
  assert.equal(count(html, /<div class="confirm" hidden>[\s\S]*?class="btn-primary"/g), approvable);
});

test("'Not now' is a text button away from the approve button", () => {
  const html = T.render(fixture(), { now: NOW });
  assert.match(html, /<\/form><div class="wt-not"><button class="btn-text" type="button" data-act="cancel" data-id="7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a001"/);
});

test("a card payment cannot be approved here: the words say why and no approve control renders", () => {
  const html = T.render(fixture(), { now: NOW });
  const card = html.match(/<article class="card wt" data-id="7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a002">[\s\S]*?<\/article>/)[0];
  assert.match(text(card), /FinanceOS can't send money to a card yet\. Pay it in your card app\./);
  assert.doesNotMatch(card, /data-form="approve"|Review this move|btn-primary/);
  assert.match(card, /data-act="cancel"[^>]*>Not now</);
});

test("money moves off: the banner says why, and nothing can be approved", () => {
  const d = fixture();
  d.mode = { enabled: false, environment: "sandbox", live: false, reason: "limits_not_set" };
  d.limits = { per_transfer_cents: null, daily_cents: null, used_today_cents: 0, left_today_cents: null };
  d.waiting[0].can_approve = false;
  d.waiting[0].blocked = "transfers_off";
  const html = T.render(d, { now: NOW });
  assert.match(text(html), /Off Money moves are off\. Fundhub has not set the money move limits yet\./);
  assert.match(text(html), /Left to move today Not set Fundhub sets the limits/);
  assert.doesNotMatch(html, /data-form="approve"|btn-primary/);
  assert.match(text(html), /Money moves are off right now, so this can't be sent yet\./);
});

test("staff: no approve control anywhere; they can take a move off the list and set one up", () => {
  const html = T.render(fixture(), { staff: true, now: NOW });
  assert.doesNotMatch(html, /data-form="approve"|Review this move|Yes, move/);
  assert.match(text(html), /Waiting for the client to say yes\./);
  assert.match(html, /data-act="cancel"[^>]*>Take it off the list</);
  assert.match(html, /<form data-form="propose"/);
  assert.match(html, /<button class="btn-primary" type="submit">Set up this move<\/button>/);
  assert.equal(count(html, /class="btn-primary"/g), 1, "the staff view has one filled button");
  assert.match(text(html), /Waiting for the client's OK 2/);
  assert.match(text(html), /Every money move the client answered, newest first\./);
  const form = html.match(/<form data-form="propose"[\s\S]*?<\/form>/)[0];
  assert.match(form, /<select name="to"><option value="3d9afef8[^"]*">[^<]*<\/option><option value="c73daf51[^"]*" selected>/, "To opens on the other account");
  assert.match(form, /<select name="from"><option value="3d9afef8[^"]*" selected>/);
});

test("history: the settled role-play, step by step, in words", () => {
  const html = T.render(fixture(), { now: NOW });
  const t = text(html);
  assert.match(t, /Oct 7, 2026 Personal Checking ••1101 → Business Checking ••2202 Sandbox proof: move \$20\.00 to Business Checking \$20\.00 Done — in Business Checking ••2202/);
  assert.match(t, /done Said yes \(practice run\) done Out of Personal Checking ••1101 done Into Business Checking ••2202/);
  assert.match(t, /Practice run ·/);
  assert.match(t, /What happened/);
  assert.match(t, /Said yes \(practice run, sandbox\)/);
  assert.match(t, /Out of Personal Checking ••1101: money ready/);
  assert.match(t, /Into Business Checking ••2202: done/);
});

test("status words for every state of a move", () => {
  const base = { to_kind: "bank_account", today: "2026-10-07" };
  const tr = (over) => ({ ...base, transfer: { from_label: "A ••1", to_label: "B ••2", date: "2026-10-07", ...over } });
  assert.equal(T.statusWords(tr({ status: "approved", date: "2026-10-20" })), "Approved — goes on Oct 20");
  assert.equal(T.statusWords(tr({ status: "approved" })), "Approved — sending");
  assert.equal(T.statusWords(tr({ status: "authorized" })), "Bank check passed — sending");
  assert.equal(T.statusWords(tr({ status: "submitted", debit_status: "pending" })), "Sent to the bank");
  assert.equal(T.statusWords(tr({ status: "submitted", debit_status: "posted" })), "Leaving A ••1");
  assert.equal(T.statusWords(tr({ status: "submitted", debit_status: "settled" })), "Out of A ••1 — on hold at the bank");
  assert.equal(T.statusWords(tr({ status: "submitted", debit_status: "funds_available" })), "Sending to B ••2");
  assert.equal(T.statusWords(tr({ status: "submitted", debit_status: "funds_available", credit_status: "posted" })), "On its way to B ••2");
  assert.equal(T.statusWords(tr({ status: "settled" })), "Done — in B ••2");
  assert.equal(T.statusWords({ ...tr({ status: "settled" }), to_kind: "fundhub" }), "Done — paid to Fundhub");
  assert.equal(T.statusWords(tr({ status: "failed" })), "Did not go through");
  assert.equal(T.statusWords(tr({ status: "declined" })), "Bank check said no");
  assert.equal(T.statusWords(tr({ status: "cancelled" })), "Stopped");
  assert.equal(T.statusWords({ proposal_status: "cancelled" }), "Not sent");
});

test("a stopped move marks its steps 'stopped' in words, not colour", () => {
  const steps = T.steps({ to_kind: "bank_account", transfer: { status: "failed", from_label: "A", to_label: "B", debit_status: "returned", credit_status: null } });
  assert.deepEqual(steps.map((s) => s.state), ["done", "stopped", "stopped"]);
  const html = T.render(fixture(), { now: NOW });
  assert.match(html, /<li class="st-done"><span class="st-word">done<\/span>/);
});

test("loading: skeletons in the real layout, never a blank screen", () => {
  const html = T.renderLoading();
  assert.match(html, /Loading your money moves…/);
  assert.match(html, /class="tx-tiles" aria-busy="true"/);
  assert.match(html, /class="sk sk-l"/);
});

test("empty: says what appears here, for the client and for staff", () => {
  const d = fixture();
  d.waiting = [];
  d.history = [];
  const client = text(T.render(d, { now: NOW }));
  assert.match(client, /Nothing is waiting for your OK\. When your plan or your advisor sets up a money move, it waits here for your yes\./);
  assert.match(client, /No money moves yet\./);
  const staff = text(T.render(d, { staff: true, now: NOW }));
  assert.match(staff, /it waits here for the client's yes/);
});

test("error: what failed in plain words, and one way to try again", () => {
  const html = T.renderError("nodb");
  assert.match(html, /role="alert"/);
  assert.match(text(html), /We could not load your money moves Our database is not answering right now\. Try again in a few minutes\./);
  assert.match(html, /data-act="retry">Try again</);
  assert.equal(T.classify({ status: 401, body: null }), "signin");
  assert.equal(T.classify({ status: 503, body: { db: "down" } }), "nodb");
  assert.equal(T.classify({ status: 200, body: { ok: true } }), "ok");
});

test("money: integer cents, a null is a dash", () => {
  assert.equal(T.money(200000), "$2,000.00");
  assert.equal(T.money(null), "—");
  assert.equal(T.toCents("2,000.50"), 200050);
  assert.equal(T.toCents("abc"), null);
});

test("times: relative under a day, a date after, the exact time on hover", () => {
  assert.equal(T.when("2026-10-07T14:00:00Z", NOW), "1h ago");
  assert.equal(T.when("2026-10-07T14:59:30Z", NOW), "just now");
  assert.equal(T.when("2026-10-07T14:55:00Z", NOW), "5 min ago");
  assert.match(T.when("2026-10-05T14:00:00Z", NOW), /^Oct 5, \d{1,2}:\d{2} (AM|PM)$/);
});

test("CSS: every rule under .fh-transfers, no px font sizes, a phone layout", () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const selectors = [];
  for (const m of rules.matchAll(/([^{}@]+)\{[^{}]*\}/g)) selectors.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
  assert.ok(selectors.length > 40);
  for (const s of selectors) assert.match(s, /^\.fh-transfers\b/, `unscoped selector: ${s}`);
  assert.doesNotMatch(CSS, /font-size\s*:\s*\d+px/);
  assert.doesNotMatch(CSS, /font\s*:[^;]*\d+px/);
  assert.match(CSS, /@media \(max-width:760px\)\{[\s\S]*td::before\{content:attr\(data-label\)/);
  assert.match(CSS, /\.fh-transfers \.tx-tiles>\*\{grid-column:span 4\}/);
  assert.doesNotMatch(CSS, /[{;]\s*max-width:\s*\d{3,}px/, "no page width cap (UI-STANDARDS §1)");
});

test("the history table labels every cell for the phone card layout", () => {
  const html = T.render(fixture(), { now: NOW });
  for (const label of ["Date", "Move", "Amount", "Status", "Said yes"]) assert.match(html, new RegExp(`data-label="${label}"`));
});
