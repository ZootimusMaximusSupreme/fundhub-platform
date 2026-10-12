import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

function functionSource(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} is missing`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}" && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

function fakeElement() {
  return {
    innerHTML: "", textContent: "", hidden: false, disabled: false, value: "",
    style: {}, className: "", children: [], listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(kind, fn) { this.listeners[kind] = fn; },
    removeEventListener(kind) { delete this.listeners[kind]; },
    appendChild(el) { this.children.push(el); return el; },
    cloneNode() { return fakeElement(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute(name) { return this[name] ?? null; },
    setAttribute(name, value) { this[name] = value; },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("read proof: agent staff choices and promotion gate use the returned values", () => {
  const source = read("public/app/agent-editor.html");
  const owner = fakeElement();
  const escalate = fakeElement();
  const context = {
    document: { getElementById: (id) => ({ a_owner: owner, a_esc: escalate }[id] || null) },
    ROLE_LABEL: { owner: "Owner", closer: "Closer" },
    cur: { owner: "Ada Owner", esc: "Cal Closer", prompt: "p".repeat(60), guard: "g".repeat(20), runsTracked: false },
    setSelectOrFirst: (_id, value) => value,
    effTriggers: () => ["booking.created"],
    esc: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(source, "roleLabel"),
    functionSource(source, "fillPeople"),
    functionSource(source, "gateChecks"),
  ].join("\n"), context);

  context.fillPeople([
    { name: "Ada Owner", role: "owner" },
    { name: "Cal Closer", role: "closer" },
  ]);
  assert.match(owner.innerHTML, /Ada Owner/);
  assert.match(owner.innerHTML, /Cal Closer/);
  assert.match(escalate.innerHTML, /Ada Owner · Owner/);
  assert.match(escalate.innerHTML, /Cal Closer · Closer/);

  const checks = context.gateChecks();
  assert.deepEqual(Array.from(checks.slice(0, 4), (item) => item.ok), [true, true, true, true]);
  context.cur.prompt = "short";
  assert.equal(context.gateChecks()[1].ok, false);
});

test("read proof: the portal agreements painter uses returned contract values", () => {
  const source = read("public/app/client-portal.html");
  const els = {
    "agreements-card": fakeElement(),
    "tp-agree": fakeElement(),
    "agreements-list": fakeElement(),
  };
  const context = {
    document: { getElementById: (id) => els[id] || null },
    esc: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"),
    fmtWhen: (v) => `WHEN:${v}`,
  };
  vm.createContext(context);
  vm.runInContext(functionSource(source, "paintAgreements"), context);
  context.paintAgreements([
    { title: "Funding <Agreement>", sent_at: "2026-10-12", needs_signature: true, sign_url: "/contract?id=one", status: "sent" },
    { title: "Repair Agreement", sent_at: "2026-10-11", needs_signature: false, status: "signed" },
  ]);
  assert.equal(els["agreements-card"].hidden, false);
  assert.match(els["agreements-list"].innerHTML, /Funding &lt;Agreement&gt;/);
  assert.match(els["agreements-list"].innerHTML, /WHEN:2026-10-12 · Needs signature/);
  assert.match(els["agreements-list"].innerHTML, /href="\/contract\?id=one"/);
  assert.match(els["tp-agree"].innerHTML, /Repair Agreement/);
  assert.match(els["tp-agree"].innerHTML, /Signed/);
});

test("read proof: Money Helper stops after 100 three-second reads and Check again restarts it", async () => {
  const timers = [];
  const document = { readyState: "complete", activeElement: null, getElementById: () => null };
  const context = {
    window: null, document, console, URLSearchParams, Date, Promise,
    location: { search: "", pathname: "/app/money-helper.html", href: "" },
    localStorage: { getItem: () => "" },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    fetch: async () => { throw new Error("network is forbidden in this proof"); },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("public/app/money-helper.js"), context);
  assert.equal(context.FHMoneyHelper.POLL_MS, 3000);
  assert.equal(context.FHMoneyHelper.MAX_POLLS, 100);

  let reads = 0;
  const listeners = {};
  const el = fakeElement();
  el.addEventListener = (kind, fn) => { listeners[kind] = fn; };
  el.removeEventListener = (kind) => { delete listeners[kind]; };
  el.contains = () => true;
  el.querySelector = () => null;
  context.FHMoneyHelper.mount(el, {
    apiGet: async () => {
      reads += 1;
      return { status: 200, body: { ok: true, pending: 1, helper: { on: true, brain: "mac", bridge_on: true }, turns: [
        { id: "turn-1", actor: "client", kind: "message", input: "Help", status: "queued", created_at: "2026-10-12T10:00:00Z" },
      ] } };
    },
  });
  await settle();
  for (let i = 0; i < 100; i += 1) {
    const timer = timers.shift();
    assert.ok(timer, `poll ${i + 1} was not scheduled`);
    assert.equal(timer.ms, 3000);
    timer.fn();
    await settle();
  }
  assert.equal(reads, 101);
  assert.equal(timers.length, 0);
  assert.match(el.innerHTML, /Still thinking/);
  assert.match(el.innerHTML, /Check again/);

  listeners.click({ target: { closest: () => ({ getAttribute: () => "refresh" }) } });
  await settle();
  assert.equal(reads, 102);
  assert.doesNotMatch(el.innerHTML, /Still thinking/);
  assert.equal(timers[0].ms, 3000);
});

test("read proof: My Numbers paints exact offer, money, empty, and role-safe values", async () => {
  const stackBody = fakeElement();
  const stackPeriod = fakeElement();
  const stackScope = fakeElement();
  const days = fakeElement();
  const streakNote = fakeElement();
  streakNote.textContent = "Daily close streak is not stored yet.";
  const moneyCards = Array.from({ length: 3 }, () => {
    const parts = { ".lb": fakeElement(), ".vl": fakeElement(), ".sb": fakeElement() };
    return { querySelector: (sel) => parts[sel] || null, parts };
  });
  const data = {
    staff_id: "staff-1",
    offer_stack_scope: { note: "Cal Closer only" },
    offer_stack: {
      period: { label: "October 2026" }, available: true,
      items: [
        { code: "FUNDING_DFY", name: "Funding DFY", active: true, units: 2, sold_cents: 600000, sold_display: "$6,000", collected_cents: 350000, collected_display: "$3,500", refunded_cents: 0 },
        { code: "OLD", name: "Old Offer", active: false, units: null, units_reason: "No unit count", sold_cents: null, sold_reason: "No sale total", collected_cents: 0, collected_display: "$0" },
      ],
      totals: { units: 2, sold_cents: 600000, sold_display: "$6,000", collected_cents: 350000, collected_display: "$3,500" },
    },
    money: { paid_cents: 123400, paid_display: "$1,234", pending_cents: 567800, pending_display: "$5,678", at_risk_reason: "Not computed from a stored rule" },
    streak: { reason: "Daily close streak is not stored yet." },
    month: {}, pace: {}, team: [], owed: [],
  };
  const document = {
    readyState: "complete", body: fakeElement(),
    getElementById: (id) => ({ stackBody, stackPeriod, stackScope }[id] || null),
    querySelector: (sel) => sel === ".days" ? days : null,
    querySelectorAll: (sel) => {
      if (sel === ".money .mo") return moneyCards;
      if (sel === ".sec .note") return [streakNote];
      return [];
    },
    createElement: () => fakeElement(),
    addEventListener() {},
  };
  const context = {
    window: null, document, console, localStorage: { getItem: () => "" },
    fetch: async () => ({ json: async () => ({ staff: { name: "Cal Closer" } }) }),
    encodeURIComponent, setTimeout, clearTimeout,
  };
  context.window = context;
  context.FHData = { read: async () => ({ ok: true, data }) };
  vm.createContext(context);
  vm.runInContext(read("public/app/my-numbers.js"), context);
  await settle();

  assert.match(stackBody.innerHTML, /Funding DFY/);
  assert.match(stackBody.innerHTML, /2/);
  assert.match(stackBody.innerHTML, /\$6,000/);
  assert.match(stackBody.innerHTML, /\$3,500/);
  assert.match(stackBody.innerHTML, /retired product/);
  assert.match(stackBody.innerHTML, /No unit count/);
  assert.equal(stackScope.textContent, "Cal Closer only");
  assert.equal(moneyCards[0].parts[".vl"].textContent, "$1,234");
  assert.equal(moneyCards[1].parts[".vl"].textContent, "$5,678");
  assert.equal(moneyCards[2].parts[".vl"].textContent, "—");
  assert.equal(moneyCards[2].parts[".sb"].textContent, "Not computed from a stored rule");
  assert.equal(streakNote.textContent, "Daily close streak is not stored yet.");
  assert.match(days.innerHTML, /Daily close streak is not stored yet/);
});

test("read proof: Ops panels paint exact read values and never invent missing money", () => {
  const source = read("public/app/ops-admin.html");
  const els = {
    "ar-table": fakeElement(), "ar-total": fakeElement(),
    "compliance-blocked-table": fakeElement(),
    "staffHiddenLine": fakeElement(), "staff-comp-body": fakeElement(), "staff-consent-body": fakeElement(),
  };
  const context = {
    document: { getElementById: (id) => els[id] || null },
    FHData: { banner() {} }, Date, isFinite,
    esc: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    relTime: () => "5m ago",
    ROLE_LABEL: { owner: "Owner", closer: "Closer" },
    AR_HEAD: "<tr><th>Client</th><th>Invoice</th><th>Amount owed</th><th>Overdue</th><th>Status</th></tr>",
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(source, "invoiceRef"), functionSource(source, "usd"),
    functionSource(source, "overdueWords"), functionSource(source, "statusWords"),
    functionSource(source, "arRow"), functionSource(source, "paintAr"),
    functionSource(source, "paintCompliance"), functionSource(source, "roleLabel"),
    functionSource(source, "initials"), functionSource(source, "hiddenText"),
    functionSource(source, "paintStaff"),
  ].join("\n"), context);

  context.paintAr({ items: [
    { id: "12345678-aaaa", client_name: "Ava Client", open_balance: "1250.50", days_overdue: 3, status: "sent" },
    { id: "87654321-bbbb", client_name: "Bo Client", open_balance: null, days_overdue: null, status: "past_due" },
  ] });
  assert.match(els["ar-table"].innerHTML, /Ava Client/);
  assert.match(els["ar-table"].innerHTML, /INV-12345678/);
  assert.match(els["ar-table"].innerHTML, /\$1,250\.50/);
  assert.match(els["ar-table"].innerHTML, /3 days/);
  assert.match(els["ar-table"].innerHTML, /Amount not recorded/);
  assert.match(els["ar-table"].innerHTML, /No due date set/);
  assert.match(els["ar-total"].textContent, /2 invoices · 1 with no amount recorded/);

  context.paintCompliance({ ok: true, data: { items: [
    { client_name: "Ava Client", channel: "sms", blocked_reason: "quiet hours", created_at: "2026-10-12T09:00:00Z" },
  ] } });
  assert.match(els["compliance-blocked-table"].innerHTML, /Ava Client/);
  assert.match(els["compliance-blocked-table"].innerHTML, /quiet hours/);
  assert.match(els["compliance-blocked-table"].innerHTML, /5m ago/);

  context.paintStaff([
    { name: "Ada Owner", role: "owner", monitoring_consent_at: "2026-10-01" },
    { name: "Cal Closer", role: "closer", monitoring_consent_at: null },
  ], 1);
  assert.match(els["staff-consent-body"].innerHTML, /Ada Owner/);
  assert.match(els["staff-consent-body"].innerHTML, /Signed/);
  assert.match(els["staff-consent-body"].innerHTML, /Cal Closer/);
  assert.match(els["staff-consent-body"].innerHTML, /Not yet signed/);
  assert.match(els.staffHiddenLine.textContent, /1 person is hidden/);
});

test("read proof: failed-event tile uses the returned pending-event count", () => {
  const source = read("public/app/ops-admin.html");
  const start = source.indexOf("FHData.wire(FHData.failedEvents");
  const fnAt = source.indexOf("function (data)", start);
  assert.ok(start > 0 && fnAt > start);
  const named = source.slice(fnAt).replace(/^function\s*\(data\)/, "function failedTile(data)");
  const callback = functionSource(named, "failedTile");
  const big = fakeElement();
  const cap = fakeElement();
  const template = fakeElement();
  template.cloneNode = () => ({ ...fakeElement(), querySelector: (sel) => sel.includes(".sv") ? big : cap });
  const grid = fakeElement();
  grid.querySelector = () => template;
  grid.firstElementChild = template;
  const ids = { "kpi-grid": grid };
  const context = {
    document: { getElementById: (id) => ids[id] || null },
    esc: (v) => String(v ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(callback, context);
  const note = context.failedTile({ items: [
    { event_name: "deposit.paid", handler_name: "doc-collection" },
    { event_name: "booking.created", handler_name: "setter" },
  ] });
  assert.equal(big.textContent, 2);
  assert.equal(cap.textContent, "failed events awaiting retry");
  assert.match(note, /2 pending failure/);
  assert.match(note, /deposit\.paid\/doc-collection/);
});

function paymentRun(replies, search = "?client_id=11111111-1111-4111-8111-111111111111") {
  const html = read("public/app/payment-success.html");
  const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((s) => s.includes("var MAX_TRIES = 6"));
  assert.ok(script);
  const state = fakeElement();
  const refline = fakeElement();
  const back = fakeElement();
  const timers = [];
  let calls = 0;
  const context = {
    document: { getElementById: (id) => ({ state, refline, back }[id] || null) },
    location: { search }, localStorage: { getItem: () => "" }, URLSearchParams,
    encodeURIComponent, Promise, Object,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    fetch: async () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      if (reply.throw) throw new Error("offline");
      return { status: reply.status, json: async () => reply.body };
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { state, timers, calls: () => calls };
}

async function drainPayment(run, cap = 10) {
  await settle();
  for (let i = 0; i < cap && run.timers.length; i += 1) {
    const timer = run.timers.shift();
    assert.equal(timer.ms, 3000);
    timer.fn();
    await settle();
  }
}

test("read proof: payment success opens only fresh entitlements and stops after six reads", async () => {
  const a = { active: true, client_id: "11111111-1111-4111-8111-111111111111", entitlement_code: "A", entitlement_name: "Roadmap" };
  const b = { active: true, client_id: a.client_id, entitlement_code: "B", entitlement_name: "Finance OS" };
  const opened = paymentRun([
    { status: 200, body: { ok: true, items: [a] } },
    { status: 200, body: { ok: true, items: [a, b] } },
  ]);
  await drainPayment(opened);
  assert.equal(opened.calls(), 2);
  assert.match(opened.state.innerHTML, /Just opened on your account/);
  assert.match(opened.state.innerHTML, /Finance OS/);
  assert.doesNotMatch(opened.state.innerHTML, />Roadmap</);

  const held = paymentRun(Array.from({ length: 6 }, () => ({ status: 200, body: { ok: true, items: [a] } })));
  await drainPayment(held);
  assert.equal(held.calls(), 6);
  assert.match(held.state.innerHTML, /Nothing new has opened yet/);
  assert.match(held.state.innerHTML, /Roadmap/);
  assert.match(held.state.innerHTML, /Do not pay again/);

  const empty = paymentRun(Array.from({ length: 6 }, () => ({ status: 200, body: { ok: true, items: [] } })));
  await drainPayment(empty);
  assert.equal(empty.calls(), 6);
  assert.match(empty.state.innerHTML, /Nothing is open on your account yet/);
});

test("read proof: payment success names signed-out, mixed-account, and unreachable reads", async () => {
  const signedOut = paymentRun([{ status: 401, body: { error: "unauthorized" } }]);
  await drainPayment(signedOut);
  assert.match(signedOut.state.innerHTML, /cannot check your account from here/i);

  const mixed = paymentRun([{ status: 200, body: { ok: true, items: [
    { active: true, client_id: "a", entitlement_code: "A" },
    { active: true, client_id: "b", entitlement_code: "B" },
  ] } }], "");
  await drainPayment(mixed);
  assert.match(mixed.state.innerHTML, /cannot tell which account this is/i);

  const offline = paymentRun(Array.from({ length: 6 }, () => ({ throw: true })));
  await drainPayment(offline);
  assert.equal(offline.calls(), 6);
  assert.match(offline.state.innerHTML, /could not reach your account/i);
});

test("read proof: Present locks every send, records the time, counts repeats, and unlocks failures", () => {
  const source = read("public/app/present.js");
  const timers = [];
  const context = {
    state: { sends: {} }, SEND_COOLDOWN_MS: 4000,
    render() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    Date,
    esc: (v) => String(v ?? ""),
    ckBtn: (text, action, primary, disabled) => `${text}|${action}|${primary}|${disabled}`,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(source, "sendMark"), functionSource(source, "sendLocked"),
    functionSource(source, "clockTime"), functionSource(source, "markSending"),
    functionSource(source, "markSent"), functionSource(source, "sendBtn"),
  ].join("\n"), context);

  context.markSending("pay");
  assert.equal(context.sendLocked("pay"), true);
  assert.match(context.sendBtn("Send pay link", "pay", true, false), /Sending…/);
  context.markSent("pay", true);
  assert.equal(context.sendLocked("pay"), true);
  assert.equal(context.state.sends.pay.count, 1);
  assert.match(context.sendBtn("Send pay link", "pay", true, false), /Sent — hold on/);
  assert.match(context.sendBtn("Send pay link", "pay", true, false), /Sent at/);
  assert.equal(timers[0].ms, 4000);
  timers.shift().fn();
  assert.equal(context.sendLocked("pay"), false);

  context.markSending("pay");
  context.markSent("pay", true);
  assert.equal(context.state.sends.pay.count, 2);
  assert.match(context.sendBtn("Send pay link", "pay", true, false), /sent 2 times/);
  context.markSent("contract", false);
  assert.equal(context.sendLocked("contract"), false);
  assert.equal(context.state.sends.contract.count, 0);
});

test("read proof: teleprompter paused poll flushes edits every five seconds", async () => {
  const source = read("public/app/teleprompter.js");
  const timers = [];
  let flushed = 0;
  let loaded = 0;
  const context = {
    clearTimeout() {}, setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    pollTimer: null, doc: { visibilityState: "visible" }, playing: false, countTimer: null,
    holding: -1, editing: false, textEdit: false, cam: { pending: [] }, signedOut: false,
    flush: () => { flushed += 1; }, load: async () => { loaded += 1; },
  };
  vm.createContext(context);
  vm.runInContext(functionSource(source, "poll"), context);
  context.poll();
  assert.equal(timers[0].ms, 5000);
  timers.shift().fn();
  await settle();
  assert.equal(flushed, 1);
  assert.equal(loaded, 1);
  assert.equal(timers[0].ms, 5000);

  context.playing = true;
  timers.shift().fn();
  await settle();
  assert.equal(flushed, 1);
  assert.equal(loaded, 1);
  assert.equal(timers[0].ms, 5000);
});

test("read proof: teleprompter asks for full screen on open and first tap", async () => {
  const html = read("public/app/teleprompter.html");
  const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((s) => s.includes("function enter()") && s.includes("requestFullscreen"));
  assert.ok(script);
  const listeners = {};
  let asks = 0;
  const document = {
    readyState: "complete", fullscreenElement: null, webkitFullscreenElement: null,
    documentElement: { requestFullscreen: async (opts) => { asks += 1; assert.equal(opts.navigationUI, "hide"); } },
    addEventListener(kind, fn) { listeners[kind] = fn; },
    removeEventListener(kind) { delete listeners[kind]; },
  };
  vm.runInNewContext(script, { document, Promise });
  await settle();
  assert.equal(asks, 1);
  listeners.pointerdown();
  await settle();
  assert.equal(asks, 2);
  assert.equal(listeners.pointerdown, undefined);
  assert.equal(listeners.touchstart, undefined);
});
