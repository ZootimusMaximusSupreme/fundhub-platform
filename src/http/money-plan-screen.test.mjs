// /app/money-plan.html — runs money-plan.js's own render functions against the
// real read of the FinanceOS test client for October 2026 (read only,
// 2026-10-07): an SBA loan due the 1st, a Fundhub payment 4 days late on the
// 3rd, Business Amex due the 15th, a BNPL payment paid early for the 16th, and
// Personal Visa due the 25th. Today is the 7th.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-plan.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-plan.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-plan.css"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-plan.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const P = W.FHMoneyPlan;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/* The <td> for one day of the month, by its day number. */
const cell = (html, day) => {
  const m = html.match(new RegExp('<td class="cal-day[^"]*"[^>]*><div class="cal-top"><span class="dnum">' + day + '</span>[\\s\\S]*?</td>'));
  assert.ok(m, `no cell for day ${day}`);
  return m[0];
};

describe("the page and the section", () => {
  test("the page loads its script and styles, reads /api/money/plan, and keeps out of the staff shell", () => {
    assert.match(HTML, /<script defer src="money-plan\.js"><\/script>/);
    assert.match(HTML, /<link rel="stylesheet" href="money-plan\.css">/);
    assert.match(HTML, /id="plan-root"/);
    assert.match(HTML, /<div class="app">/);
    assert.doesNotMatch(HTML, /src="shell\.js"/);
    assert.match(JS, /"\/api\/money\/plan"/);
  });

  test("the money nav, with Plan marked as the current page", () => {
    const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
    const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#plan", "/app/financeos.html#accounts",
      "/app/financeos.html#credit", "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"]);
    assert.match(nav, /href="\/app\/financeos\.html#plan" aria-current="page"/);
  });

  test("FinanceOS.sections.plan = { title, mount }", () => {
    const s = W.FinanceOS.sections.plan;
    assert.equal(s.title, "Plan");
    assert.equal(typeof s.mount, "function");
  });

  test("shell.js lets the client and the FINANCE staff follow a link to the page, like the other money pages", () => {
    assert.match(SHELL, /var STAFF_MONEY = \[[^\]]*"money-plan\.html"/);
    assert.match(SHELL, /client: \["client-portal\.html"[^\]]*"money-plan\.html"/);
  });
});

describe("full — the month", () => {
  const html = P.render(fixture(), {});

  test("a Mon–Sun calendar: October 1 2026 is a Thursday, after three blank cells", () => {
    const heads = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(heads, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const firstRow = html.match(/<tbody><tr>([\s\S]*?)<\/tr>/)[1];
    assert.equal((firstRow.match(/<td class="cal-out"><\/td>/g) || []).length, 3);
    assert.match(firstRow, /<span class="dnum">1<\/span>[\s\S]*<span class="dnum">4<\/span>/);
    assert.match(html, /<caption class="sr-only">October 2026, Monday to Sunday<\/caption>/);
  });

  test("each pin sits on its own day, with its amount", () => {
    assert.match(text(cell(html, 1)), /Pay SBA Loan \$1,050\.00/);
    assert.match(text(cell(html, 3)), /Fundhub payment plan: payment 2 of 3 \$500\.00/);
    assert.match(text(cell(html, 15)), /Pay Business Amex \$135\.00/);
    assert.match(text(cell(html, 16)), /Buy now, pay later plan with Fundhub LLC: payment 2 of 4 \$150\.00/);
    assert.match(text(cell(html, 25)), /Pay Personal Visa \$40\.00/);
    assert.doesNotMatch(cell(html, 8), /class="pin/);
  });

  test("a pin shows its kind icon, its amount and its bank; the tooltip carries the whole line", () => {
    const amex = cell(html, 15);
    assert.match(amex, /<rect x="2" y="3" width="12" height="11" rx="2"\/>/, "a due date carries the calendar icon");
    assert.match(text(amex), /Pay Business Amex \$135\.00 · First Platypus Bank \(Plaid sandbox — test data\)/);
    assert.match(amex, /title="Pay Business Amex · \$135\.00 · First Platypus Bank \(Plaid sandbox — test data\) · Planned"/);
  });

  test("today is a ring and the word, on the 7th only", () => {
    const today = cell(html, 7);
    assert.match(today, /class="cal-day is-today"/);
    assert.match(today, /aria-current="date"/);
    assert.match(today, />Today</);
    assert.equal((html.match(/aria-current="date"/g) || []).length, 1);
    assert.match(cell(html, 6), /is-past/);
    assert.doesNotMatch(cell(html, 8), /is-past|is-today/);
  });

  test("status is a shape as well as a colour in a cell, and a word everywhere else", () => {
    const done = cell(html, 16);
    const missed = cell(html, 3);
    assert.match(done, /class="pin caption st-done"/);
    assert.match(done, /<path d="M3 8\.5l3 3 7-7"\/>/, "done carries a check");
    assert.match(done, /<span class="sr-only">, Done<\/span>/);
    assert.match(missed, /class="pin caption st-missed"/);
    assert.match(missed, /<path d="M8 4\.5v4\.5M8 11\.2v\.3"\/>/, "missed carries an !");
    assert.match(cell(html, 1), /st-past[\s\S]*, Not recorded/, "a passed date with no record says so — no guess");
    const list = text(html.match(/<section class="card plan-list"[\s\S]*<\/section>/)[0]);
    assert.match(list, /Pay SBA Loan Payment due · Fundhub LLC \$1,050\.00 Not recorded/);
    assert.match(list, /Fundhub payment plan: payment 2 of 3 Payment due \$500\.00 Missed/);
    assert.match(list, /payment 2 of 4 Payment due \$150\.00 Done/);
    assert.match(list, /Pay Personal Visa Payment due · Chris \(personal\) · First Platypus Bank \(Plaid sandbox — test data\) \$40\.00 Planned/);
  });

  test("the list holds every pin in date order, and a line for today even with nothing on it", () => {
    const list = html.match(/<ol class="days">[\s\S]*<\/ol>/)[0];
    const days = [...list.matchAll(/data-day-row="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(days, ["2026-10-01", "2026-10-03", "2026-10-07", "2026-10-15", "2026-10-16", "2026-10-25"]);
    assert.equal((list.match(/class="row /g) || []).length, 5);
    assert.match(text(list), /Wed, Oct 7 Today Nothing on your plan today\./);
  });

  test("the tiles: what is next, the month in numbers, and what was missed", () => {
    const t = text(html.match(/<div class="grid tiles">[\s\S]*?<\/section><\/div>/)[0]);
    assert.match(t, /Next up Oct 15 Pay Business Amex · \$135\.00/);
    assert.match(t, /This month 5 5 dates · 1 done · 1 missed · 2 coming up · 1 not recorded/);
    assert.match(t, /Missed 1 Fundhub payment plan: payment 2 of 3 · Oct 3/);
  });

  test("the month bar moves a month either way", () => {
    assert.match(html, /<h2 id="pl-month">October 2026<\/h2>/);
    assert.match(html, /data-act="month" data-month="2026-09" aria-label="Previous month, September 2026"/);
    assert.match(html, /data-act="month" data-month="2026-11" aria-label="Next month, November 2026"/);
    assert.doesNotMatch(html, />Today<\/button>/, "no Today button on today's own month");
    const nov = fixture();
    nov.month = "2026-11";
    assert.match(P.render(nov, {}), /data-month="2026-10">Today<\/button>/);
  });

  test("a client sees no staff control and no primary button in the month view", () => {
    assert.doesNotMatch(html, /data-act="mark"|Staff only/);
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 0);
  });
});

describe("the panel for one pin", () => {
  const d = fixture();
  const late = d.pins.find((p) => p.status === "missed");

  test("what, when, how much, the status in words, why, and where it came from", () => {
    const html = P.renderDetail(late, d, {});
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="pl-d-title"/);
    const t = text(html);
    assert.match(t, /Payment due Close Fundhub payment plan: payment 2 of 3 Saturday, October 3, 2026/);
    assert.match(t, /Amount \$500\.00 Status Missed/);
    assert.match(t, /Why Owed to Fundhub LLC\. 4 days late\./);
    assert.match(t, /From: Payments to Fundhub · See it on Payments/);
    assert.match(html, /href="money-payments\.html"/);
    assert.doesNotMatch(html, /data-act="mark"/, "a client pin with no can_mark has no control");
  });

  test("a staff desk carries the client on the Payments link", () => {
    assert.match(P.renderDetail(late, d, { clientId: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e" }),
      /href="money-payments\.html\?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e"/);
  });

  test("an unknown amount says so — never $0.00", () => {
    const pin = { ...d.pins[2], amount_cents: null };
    assert.match(text(P.renderDetail(pin, d, {})), /Amount Not known yet/);
    const nd = fixture();
    nd.pins[2].amount_cents = null;
    const html = P.render(nd, {});
    assert.match(text(html), /Pay Business Amex Payment due · Fundhub LLC · First Platypus Bank \(Plaid sandbox — test data\) Amount not known yet Planned/);
    assert.doesNotMatch(html, /\$0\.00|NaN|undefined/);
  });

  test("a passed date with nothing recorded explains itself", () => {
    const sba = d.pins.find((p) => p.title === "Pay SBA Loan");
    assert.match(text(P.renderDetail(sba, d, {})), /Status Not recorded For Fundhub LLC This date has passed\. Nothing on file says whether it was done\./);
  });

  test("staff see one primary button, Mark done, only when the pin allows it", () => {
    const step = { id: "waypoint:1", date: "2026-10-30", kind: "checkpoint", title: "File your LLC", detail: null, amount_cents: null,
      bank: null, container_id: null, status: "planned", source: "waypoints", can_mark: ["done"] };
    const html = P.renderDetail(step, { ...d, pins: [step] }, { clientId: "c1" });
    assert.match(html, /<button type="button" class="btn-primary" data-act="mark" data-status="done">Mark done<\/button>/);
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
    assert.match(text(html), /From: Your checklist/);
    const busy = P.renderDetail(step, { ...d, pins: [step] }, { clientId: "c1", busy: true });
    assert.match(busy, /data-status="done" disabled>Saving…/);
  });
});

describe("the four states", () => {
  test("loading is a skeleton in the real layout, never a blank screen", () => {
    const html = P.renderLoading("2026-10", "2026-10-07");
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /class="cal-grid"/);
    assert.match(html, /<h2 id="pl-month">October 2026<\/h2>/);
    assert.match(P.renderLoading(null, null), /class="sk sk-m"/);
  });

  test("empty: says what will appear and gives one action that makes it appear", () => {
    const d = fixture();
    d.pins = [];
    const html = P.render(d, {});
    assert.match(text(html), /Nothing on your plan for October 2026/);
    assert.match(text(html), /When a card or loan payment is due, a payment to Fundhub is due, or a step on your checklist has a date, it shows here on its day\./);
    assert.match(html, /<a class="btn-primary" href="money-accounts\.html">Add an account<\/a>/);
    assert.match(html, /data-month="2026-11"/, "the month bar stays so other months can be opened");
    assert.match(P.render(d, { clientId: "c1" }), /href="money-accounts\.html\?client_id=c1"/);
  });

  test("error: says what failed in words, and offers Try again", () => {
    assert.match(text(P.renderError("offline")), /We could not load your plan We could not reach the server/);
    assert.match(text(P.renderError("nodb")), /Our database is not answering right now/);
    assert.match(P.renderError("server"), /data-act="retry"/);
    assert.equal(P.classify({ status: 503, body: { db: "down" } }), "nodb");
    assert.equal(P.classify({ status: 0, body: null }), "offline");
    assert.equal(P.classify({ status: 401, body: null }), "signin");
    assert.equal(P.classify({ status: 400, body: { error: "client_id is required and must be a uuid" } }), "needclient");
    assert.equal(P.classify({ status: 200, body: { ok: true } }), "ok");
  });

  test("a part that did not load is named in words — never painted as a part with nothing in it", () => {
    const d = fixture();
    d.sources = [{ name: "waypoints", ok: true, count: 0 }, { name: "dues", ok: false, error: "load_failed" }, { name: "clarity", ok: true, count: 2 }];
    const t = text(P.render(d, {}));
    assert.match(t, /Part of your plan did not load: Card and loan due dates\. Everything else is below\. Try again/);
  });
});

describe("mount — the section in a page", () => {
  const CID = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
  const stubEl = () => ({
    innerHTML: "", listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; },
    removeEventListener(t) { delete this.listeners[t]; },
    contains: () => true
  });
  /* A click on an element carrying `attrs`. closest() answers like a browser's:
     a button is not an a[href]. */
  const click = (el, attrs) => el.listeners.click({
    target: {
      closest: (sel) => (/a\[href\]/.test(sel) && !("href" in attrs) ? null
        : { getAttribute: (k) => (k in attrs ? attrs[k] : null), classList: { contains: () => false } })
    }
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("paints into el through ctx.apiGet, with no page chrome, and moves months", async () => {
    const W2 = load();
    const el = stubEl();
    const asked = [];
    const handle = W2.FinanceOS.sections.plan.mount(el, {
      clientId: CID,
      apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; },
      apiPost: async () => ({ status: 200, body: { ok: true } })
    });
    await settle();
    assert.equal(asked[0], `/api/money/plan?client_id=${CID}`);
    assert.match(el.innerHTML, /^<div class="fh-plan"><div class="pl-body">/);
    assert.match(text(el.innerHTML), /October 2026/);
    assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
    assert.equal(typeof el.listeners.click, "function");
    click(el, { "data-act": "month", "data-month": "2026-11" });
    await settle();
    assert.equal(asked[1], `/api/money/plan?month=2026-11&client_id=${CID}`);
    await handle.reload();
    assert.match(asked[2], /^\/api\/money\/plan\?month=2026-10&client_id=/, "reload keeps the month the answer named");
    handle.unmount();
    assert.equal(el.innerHTML, "");
  });

  test("every source failing is an error, not an empty month", async () => {
    const W2 = load();
    const el = stubEl();
    const d = fixture();
    d.sources = d.sources.map((s) => ({ name: s.name, ok: false, error: "load_failed" }));
    d.pins = [];
    W2.FinanceOS.sections.plan.mount(el, { apiGet: async () => ({ status: 200, body: d }) });
    await settle();
    assert.match(text(el.innerHTML), /We could not load your plan/);
    assert.doesNotMatch(text(el.innerHTML), /Nothing on your plan/);
  });

  test("a pin opens its panel; staff Mark done posts the pin to its own source", async () => {
    const W2 = load();
    const el = stubEl();
    const step = { id: "waypoint:1", date: "2026-10-30", kind: "checkpoint", title: "File your LLC", detail: null, amount_cents: null,
      bank: null, container_id: null, status: "planned", source: "waypoints", can_mark: ["done"] };
    const d = { ...fixture(), viewer: "staff", pins: [step] };
    const posted = [];
    W2.FinanceOS.sections.plan.mount(el, {
      clientId: "c1",
      apiGet: async () => ({ status: 200, body: d }),
      apiPost: async (p, b) => { posted.push([p, b]); return { status: 200, body: { ok: true, changed: true, pin: { ...step, status: "done", can_mark: [] } } }; }
    });
    await settle();
    click(el, { "data-pin": "waypoint:1" });
    assert.match(el.innerHTML, /class="pl-drawer"/);
    assert.match(el.innerHTML, /Mark done/);
    click(el, { "data-act": "mark", "data-status": "done" });
    await settle();
    /* JSON round trip: the body was built inside the vm, a different realm. */
    assert.deepEqual(JSON.parse(JSON.stringify(posted[0])),
      ["/api/money/plan", { action: "mark", source: "waypoints", pin_id: "waypoint:1", status: "done", client_id: "c1" }]);
    assert.match(text(el.innerHTML), /Marked done\./);
    assert.doesNotMatch(el.innerHTML, /data-act="mark"/, "a done step has nothing left to mark");
    click(el, { "data-act": "close" });
    assert.doesNotMatch(el.innerHTML, /class="pl-drawer"/);
  });
});

describe("styles", () => {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  test("every rule lives under .fh-plan", () => {
    const noKeyframes = clean.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const selectors = noKeyframes.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    assert.ok(selectors.length > 40);
    for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-plan(\s|$|:|\[)/, part);
  });

  test("no px font sizes — the brand file sizes the type (UI-STANDARDS §12.7)", () => {
    assert.doesNotMatch(clean, /font-size\s*:/);
    assert.doesNotMatch(clean, /(?:^|[;{\s])font\s*:\s*[^;}]*\d+px/);
    assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, ""), /font-size\s*:\s*\d+px/);
  });

  test("on a phone the calendar collapses to the list; the ring is a colour token, not --spectrum", () => {
    assert.match(clean, /@media \(max-width:760px\)\{[\s\S]*\.fh-plan \.cal\{display:none\}/);
    assert.doesNotMatch(clean, /box-shadow:[^;}]*--spectrum/);
  });

  test("spacing stays on the 8px scale", () => {
    const off = [...clean.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}]+)/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((v) => /^\d+px$/.test(v) && ![0, 8, 16, 24, 32, 48, 64].includes(parseInt(v, 10)));
    assert.deepEqual(off, []);
  });
});
