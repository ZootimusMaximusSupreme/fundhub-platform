// /app/money-next.html — runs money-next.js's own render functions against the
// fixture: the read-only build for the test client (its late Fundhub payment
// and its Business Amex minimum), plus single steps for the rows that file does
// not have (a person step, a step only the client can do).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-next.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-next.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-next.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-next.sample.json"), "utf8"));
const PAY_JS = fs.readFileSync(path.join(APP, "money-payments.js"), "utf8");

function load(src = JS, key = "FHMoneyNext") {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window[key];
}
const N = load();
const fx = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const CID = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";

const PERSON = {
  id: "waypoint:7a1c0000-0000-4000-8000-000000000002", title: "Talk to your advisor about a personal loan",
  why: "Raise it early, before any of the optimization work changes your accounts.", due_on: "2026-10-20", kind: "checkpoint",
  can_do: "person", late_days: null, amount_cents: null, moves_money: false, transfer: null, source: "waypoints",
  from: "your checklist", link: "/progress.html", assignment: null
};
const SELF = { ...PERSON, id: "waypoint:7a1c0000-0000-4000-8000-000000000003", title: "File your LLC", why: "File online with the Secretary of State.", can_do: "self" };

test("the page loads its own script and style, reads both endpoints, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-next\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-next\.css">/);
  assert.match(HTML, /id="next-root"/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(JS, /"\/api\/money\/tasks"/);
  assert.match(JS, /"\/api\/money\/ready-to-fund"/);
  assert.match(HTML, /<div class="app">/);
});

test("full: the test client's two steps, late said in words, who can do each, and the Do task buttons", () => {
  const d = fx();
  const html = N.render(d.tasks, d.ready, {});
  const t = text(html);
  assert.match(t, /What to do next/);
  assert.match(t, /Pay \$500\.00 to Fundhub LLC/);
  assert.match(t, /Late 4 days Was due Oct 3/);
  assert.match(t, /Payment 2 of 3 on your Fundhub payment plan\./);
  assert.match(t, /Pay \$135\.00 to Business Amex/);
  assert.match(t, /Due Oct 15 · From your card statement/);
  assert.match(t, /Your money helper can set this up/);
  assert.equal((html.match(/data-act="do"/g) || []).length, 2);
  assert.match(t, /never moves money on its own/);
});

test("one primary button: I'm ready to get funded", () => {
  const d = fx();
  const html = N.render(d.tasks, d.ready, {});
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
  assert.match(html, /class="btn-primary" type="button" data-act="ready">I'm ready to get funded</);
});

test("a payment the helper set up says nothing moves until the client says yes — and never that money moved", () => {
  const d = fx();
  d.tasks.tasks[1].assignment = { id: "m1", assignee: "agent", status: "needs_approval", open: true, moves_money: true, amount_cents: 13500, to_kind: "card" };
  const html = N.render(d.tasks, d.ready, {});
  const row = html.slice(html.indexOf('data-task-row="due:'));
  assert.match(text(row), /Your money helper set this up: \$135\.00\. Nothing moves until you say yes to this exact amount\./);
  assert.equal((html.match(/data-act="do"/g) || []).length, 1, "the handed-over step loses its button");
  assert.doesNotMatch(text(html), /(sent|paid|moved) \$135/i);
});

test("a person step has Do task; a step only the client can do has no button and links to the checklist", () => {
  const p = N.renderTask(PERSON, {});
  assert.match(p, /data-act="do"/);
  assert.match(text(p), /A person on our team can do this/);
  const s = N.renderTask(SELF, { clientId: CID });
  assert.doesNotMatch(s, /data-act="do"/);
  assert.match(text(s), /Only you can do this/);
  assert.match(s, new RegExp(`href="/progress\\.html\\?client_id=${CID}"`), "staff keep the client on the link");
  assert.equal(N.canPress(SELF), false);
  assert.equal(N.canPress(PERSON), true);
});

test("statuses after Do task, in words", () => {
  const w = (a) => N.statusWords({ assignment: a });
  assert.equal(w({ assignee: "person", status: "queued" }), "A person on our team has this. They will reach out.");
  assert.equal(w({ assignee: "person", status: "done", done_at: "2026-10-09T15:00:00Z" }), "Our team finished this on Oct 9.");
  assert.equal(w({ assignee: "agent", status: "approved" }), "You said yes. Your money helper will send it.");
  assert.equal(w({ assignee: "agent", status: "failed", message: "Your bank said no." }), "Your money helper could not do this. Your bank said no.");
  assert.equal(w(null), "");
});

test("Ready to get funded: none → button; requested / CSM has it → no button, in words; done → ask again", () => {
  const r = fx().ready;
  assert.match(N.renderReady(r), /data-act="ready"/);
  assert.match(text(N.renderReady(r)), /same closing prep call our Capital Blueprint clients get/);
  const asked = N.renderReady({ ...r, status: "requested", requested_at: "2026-10-07T12:00:00Z" });
  assert.doesNotMatch(asked, /data-act="ready"/);
  assert.match(text(asked), /Sent to our team You asked on Oct 7, 2026\. Your request is with our team/);
  const held = N.renderReady({ ...r, status: "csm_assigned", requested_at: "2026-10-07T12:00:00Z" });
  assert.match(text(held), /A person has it .* A person on our team has your request/);
  const done = N.renderReady({ ...r, status: "done", round: 1, done_at: "2026-10-09T15:00:00Z" });
  assert.match(done, /data-act="ready"/);
  assert.match(text(done), /Your funding prep call is done \(Oct 9, 2026\)/);
  assert.match(text(N.renderReady(null)), /could not check your funding request/);
});

test("the Capital Blueprint card shows only to a client without it, and links to the call booking", () => {
  const r = fx().ready;
  const card = N.renderBlueprint(r);
  assert.match(text(card), /Want us to do it with you\?/);
  assert.match(text(card), /Pricing is set on your call\./);
  assert.match(card, /href="https:\/\/apply\.fundhub\.ai\/schedule\/phonecall" target="_blank" rel="noopener">Book a call</);
  const owned = JSON.parse(JSON.stringify(r));
  owned.offers.blueprint = { owned: true, name: "Capital Blueprint", sell: null };
  assert.equal(N.renderBlueprint(owned), "");
  assert.equal(N.renderBlueprint(null), "");
});

test("empty: says what will appear and gives one action; the side still shows", () => {
  const d = fx();
  d.tasks.tasks = [];
  const html = N.render(d.tasks, d.ready, { clientId: CID });
  const t = text(html);
  assert.match(t, /Nothing to do right now\./);
  assert.match(t, /When a payment comes due in the next 14 days, or your checklist has a step, it shows up here\./);
  assert.match(html, new RegExp(`href="/app/financeos\\.html\\?client_id=${CID}#accounts">Check your accounts<`));
  assert.match(t, /Ready to get funded\?/);
  assert.doesNotMatch(t, /\$NaN|undefined/);
});

test("a step source that failed to load is said, not hidden", () => {
  const d = fx();
  d.tasks.sources = [{ name: "clarity", ok: false, error: "load_failed" }, { name: "dues", ok: true }];
  assert.match(text(N.renderTasks(d.tasks, {})), /Some steps could not load just now \(payments to Fundhub\)/);
});

test("loading is a skeleton in the real layout; errors say what failed in words and keep the side", () => {
  assert.match(N.renderLoading(), /aria-busy="true"/);
  assert.match(N.renderLoading(), /class="nx-grid"/);
  const e = N.renderError("offline", fx().ready);
  assert.match(text(e), /We could not load your next steps We could not reach the server/);
  assert.match(e, /data-act="retry"/);
  assert.match(e, /data-act="ready"/, "the funding button still works when only the steps failed");
  assert.match(text(N.renderError("nodb", null)), /database is not answering/);
});

test("money is cents; null is a dash; dates are calendar dates", () => {
  assert.equal(N.money(13500), "$135.00");
  assert.equal(N.money(null), "—");
  assert.equal(N.day("2026-10-03"), "Oct 3, 2026");
  assert.equal(N.day("2026-10-07T03:16:09.161Z", true), "Oct 7");
  assert.equal(N.withClient("/app/financeos.html#setup", CID), `/app/financeos.html?client_id=${CID}#setup`);
});

test("FinanceOS section: mount(el, ctx) reads both endpoints through ctx.apiGet, no page chrome", async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  const section = sandbox.window.FinanceOS.sections.next;
  assert.equal(typeof section.mount, "function");
  assert.equal(section.title, "Next steps");
  const el = { innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, contains: () => true, querySelector: () => null };
  const asked = [];
  const d = fx();
  const handle = section.mount(el, {
    clientId: CID,
    apiGet: async (p) => { asked.push(p); return p.startsWith("/api/money/tasks") ? d.tasks : d.ready; },
    apiPost: async () => ({ ok: true })
  });
  await handle.reload();
  assert.deepEqual(asked.slice(0, 2), [`/api/money/tasks?client_id=${CID}`, `/api/money/ready-to-fund?client_id=${CID}`]);
  assert.match(el.innerHTML, /^<div class="fh-next">/);
  assert.match(text(el.innerHTML), /Pay \$500\.00 to Fundhub LLC/);
  assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
  assert.equal(typeof el.listeners.click, "function");
  handle.unmount();
  assert.equal(el.innerHTML, "");
});

test("Do task posts only the task id (and client_id for staff), then repaints the row from the server's copy", async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  const section = sandbox.window.FinanceOS.sections.next;
  const d = fx();
  const posts = [];
  const el = { innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {}, contains: () => true, querySelector: () => null };
  const handle = section.mount(el, {
    clientId: CID,
    apiGet: async (p) => (p.startsWith("/api/money/tasks") ? JSON.parse(JSON.stringify(d.tasks)) : d.ready),
    apiPost: async (p, b) => {
      posts.push([p, b]);
      const t = JSON.parse(JSON.stringify(d.tasks.tasks[1]));
      t.assignment = { id: "m1", assignee: "agent", status: "needs_approval", open: true, moves_money: true, amount_cents: 13500 };
      return { ok: true, created: true, task: t };
    }
  });
  await handle.reload();
  const btn = {
    disabled: false, textContent: "Do task",
    getAttribute: (k) => (k === "data-act" ? "do" : k === "data-task" ? d.tasks.tasks[1].id : null),
    closest: (sel) => (sel === "[data-act]" ? btn : null)
  };
  el.listeners.click({ target: btn });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posts[0], ["/api/money/tasks", { action: "do_task", task_id: d.tasks.tasks[1].id, client_id: CID }]);
  assert.match(text(el.innerHTML), /Your money helper set this up: \$135\.00\./);
});

test("the section's styles all live under .fh-next, with no px font sizes, and fold to one column on a phone", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-next /, part);
  assert.doesNotMatch(css, /font-size\s*:|font\s*:/, "type comes from the brand tokens (UI-STANDARDS §12.7)");
  assert.match(css, /@media \(max-width:1000px\)\{\s*\.fh-next \.nx-main,\.fh-next \.nx-side\{grid-column:span 12\}/);
  assert.match(css, /@media \(max-width:600px\)\{[\s\S]*\.fh-next \.task\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, ""), /font-size\s*:\s*\d+px/);
});

test("the Payments log reads the new rows in words: a set-up payment says nothing moves", () => {
  const P = load(PAY_JS, "FHMoneyPayments");
  assert.equal(P.logSentence({ action: "task_assigned", item_label: "Pay $135.00 to Business Amex", amount_cents: 13500 }),
    "Set up for your OK: Pay $135.00 to Business Amex. Nothing moves until you say yes.");
  assert.equal(P.logSentence({ action: "task_assigned", item_label: "Talk to your advisor about a personal loan", amount_cents: null }),
    "Handed over: Talk to your advisor about a personal loan.");
  assert.equal(P.logSentence({ action: "ready_to_fund" }), "You said you are ready to get funded. A person on our team will reach out.");
});

/* ── the client portal's FinanceOS side-sell (client-portal.html) ─────────── */

const PORTAL = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");

function sideSell(offers, { status = 200, asStaff = false } = {}) {
  const start = PORTAL.indexOf("function paintFinanceOsSideSell(");
  const end = PORTAL.indexOf("\n  function nameFromSession", start);
  assert.ok(start > 0 && end > start, "paintFinanceOsSideSell is in client-portal.html");
  const src = PORTAL.slice(start, end);
  const card = {
    attrs: { href: "/app/financeos.html" },
    setAttribute(k, v) { this.attrs[k] = v; },
    parts: { ".fb-d": { textContent: "Your bank accounts, cards, bills, and business credit in one place." }, ".fb-go": { textContent: "Open FinanceOS" } },
    querySelector(sel) { return this.parts[sel] || null; }
  };
  const asked = [];
  const sandbox = {
    document: { getElementById: (id) => (id === "money-link" ? card : null) },
    localStorage: { getItem: () => "tok" },
    encodeURIComponent,
    fetch: (url) => { asked.push(url); return Promise.resolve({ ok: status === 200, json: () => Promise.resolve({ ok: true, offers }) }); }
  };
  vm.runInNewContext(src + `\npaintFinanceOsSideSell(${JSON.stringify(CID)}, ${asStaff});`, sandbox);
  return new Promise((r) => setTimeout(() => r({ card, asked }), 0));
}

test("client portal: a Capital Blueprint client without FinanceOS gets the FinanceOS card pointed at setup", async () => {
  const { card, asked } = await sideSell({ blueprint: { owned: true }, financeos: { entitled: false } });
  assert.deepEqual(asked, ["/api/money/ready-to-fund"], "a client is their session — no client_id");
  assert.equal(card.attrs.href, "/app/financeos.html#setup");
  assert.equal(card.attrs["data-fh-href"], "/app/financeos.html#setup");
  assert.equal(card.parts[".fb-go"].textContent, "Set up FinanceOS");
  assert.match(card.parts[".fb-d"].textContent, /Add FinanceOS to your Capital Blueprint/);
});

test("client portal: staff keep the client on the link; no Blueprint, FinanceOS already on, or a refusal leave the card as it ships", async () => {
  const staff = await sideSell({ blueprint: { owned: true }, financeos: { entitled: false } }, { asStaff: true });
  assert.deepEqual(staff.asked, [`/api/money/ready-to-fund?client_id=${CID}`]);
  assert.equal(staff.card.attrs.href, `/app/financeos.html?client_id=${CID}#setup`);
  for (const [offers, opts] of [
    [{ blueprint: { owned: false }, financeos: { entitled: false } }, {}],
    [{ blueprint: { owned: true }, financeos: { entitled: true } }, {}],
    [{ blueprint: { owned: true }, financeos: { entitled: false } }, { status: 403 }]
  ]) {
    const { card } = await sideSell(offers, opts);
    assert.equal(card.attrs.href, "/app/financeos.html");
    assert.equal(card.parts[".fb-go"].textContent, "Open FinanceOS");
  }
});

test("a payment already finished for its due date shows no Do task; a failed one does", () => {
  const t = fx().tasks.tasks[1];
  assert.equal(N.canPress({ ...t, assignment: { assignee: "agent", status: "done", open: false, moves_money: true } }), false);
  assert.equal(N.canPress({ ...t, assignment: { assignee: "agent", status: "failed", open: false, moves_money: true } }), true);
  assert.equal(N.canPress({ ...PERSON, assignment: { assignee: "person", status: "done", open: false, moves_money: false } }), true);
});
