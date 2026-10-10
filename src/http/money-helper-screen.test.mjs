// /app/money-helper.html — runs money-helper.js's own render functions against
// a thread from the 2026-10-07 role-play on the FinanceOS test client
// (fixtures/money-helper.sample.json): real Claude Code answers through the
// shared model client — a missed Fundhub payment with a reminder and a CSM task,
// "I can't pay until next Friday", and "move $20,000" answered with a $4,944.27
// transfer PROPOSAL that needs the client's approval.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-helper.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-helper.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-helper.css"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-helper.sample.json"), "utf8"));
const NOW = Date.parse("2026-10-07T16:56:00.000Z");

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const H = W.FHMoneyHelper;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("the page and the section", () => {
  test("the page loads its script and styles, reads /api/money/helper, and keeps out of the staff shell", () => {
    assert.match(HTML, /<script defer src="money-helper\.js"><\/script>/);
    assert.match(HTML, /<link rel="stylesheet" href="money-helper\.css">/);
    assert.match(HTML, /id="helper-root"/);
    assert.match(HTML, /<div class="app">/);
    assert.doesNotMatch(HTML, /src="shell\.js"/);
    assert.match(JS, /"\/api\/money\/helper"/);
  });

  test("the money nav, with Helper marked as the current page", () => {
    const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /href="\/app\/financeos\.html#helper" aria-current="page">Helper</);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  });

  test("FinanceOS.sections.helper = { title, mount }", () => {
    assert.equal(W.FinanceOS.sections.helper.title, "Helper");
    assert.equal(typeof W.FinanceOS.sections.helper.mount, "function");
  });

  test("shell.js lets the client and the FINANCE staff follow a link to the page", () => {
    assert.match(SHELL, /var STAFF_MONEY = \[[^\]]*"money-helper\.html"/);
    assert.match(SHELL, /client: \["client-portal\.html"[^\]]*"money-helper\.html"/);
  });
});

describe("full — the thread", () => {
  const html = H.render(fixture(), { now: NOW });

  test("each message, then the helper's own words under it", () => {
    const t = text(html);
    assert.match(t, /I missed my Fundhub payment\. What happens now\? You · 16 min ago/);
    assert.match(t, /Your Fundhub payment plan payment 2 of 3 for \$500\.00 was due on 2026-10-03 and is now 4 days late\./);
    assert.match(t, /Move \$20,000 from my business checking to my Amex right now\./);
    assert.equal((html.match(/class="msg from-client"/g) || []).length, 4);
    assert.equal((html.match(/class="msg from-helper"/g) || []).length, 4);
  });

  test("which brain answered, in words, under every answer", () => {
    assert.equal((html.match(/class="brain brain-ai">AI</g) || []).length, 4);
    const rules = fixture();
    rules.turns[0] = { ...rules.turns[0], brain: "rules", reason_words: "Answered by the rules helper: the AI helper's computer is off right now." };
    assert.match(text(H.render(rules, { now: NOW })), /Money helper · Rules · Answered by the rules helper: the AI helper's computer is off right now\./);
  });

  test("what the helper did is a card each, labelled by the server — a transfer always needs the client's approval", () => {
    const t = text(html);
    assert.match(t, /Reminder set Reminder for Oct 7: Pay late Fundhub payment 2 of 3 · \$500\.00/);
    assert.match(t, /A person will reach out Your client success manager has a task to reach out/);
    assert.match(t, /Transfer proposal \$4,944\.27 from Business Checking to Business Amex\. Nothing moves until you approve it\. Needs your approval/);
    assert.match(html, /class="pill pill-approve">Needs your approval</);
  });

  test("the helper's status in words: texts off, AI on", () => {
    assert.match(text(html), /Texts off: answers show here only AI on/);
    const off = fixture();
    off.helper.bridge_on = false;
    assert.match(text(H.render(off, { now: NOW })), /AI off right now: the rules helper answers/);
  });

  test("one primary button on the screen: Send", () => {
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
    assert.match(html, /<button type="submit" class="btn-primary">Send<\/button>/);
    assert.match(html, /<label class="sr-only" for="mh-input">/);
  });
});

describe("the other states", () => {
  test("thinking: a queued turn shows the dots and the words, and nothing else pretends to be an answer", () => {
    const d = fixture();
    d.turns.push({ id: "t5", kind: "message", actor: "client", input: "Which card should I pay first?", status: "queued", reply: null, actions: [], brain: null, created_at: "2026-10-07T16:55:30.000Z" });
    d.pending = 1;
    const html = H.render(d, { now: NOW });
    assert.match(html, /class="msg from-helper is-thinking" aria-busy="true"/);
    assert.match(text(html), /Thinking… Money helper · waiting for the AI/);
  });

  test("empty: says what will appear, with three ways to start", () => {
    const d = fixture();
    d.turns = [];
    const html = H.render(d, { now: NOW });
    assert.match(text(html), /Ask your money helper anything about your money/);
    assert.equal((html.match(/data-act="suggest"/g) || []).length, 3);
    assert.match(html, /class="composer"/);
  });

  test("stopped: a banner in words, and no box to type in", () => {
    const d = fixture();
    d.helper.halted = true;
    d.helper.halt_reason = "stop";
    const html = H.render(d, { now: NOW });
    assert.match(text(html), /The money helper stopped here\. You asked it to stop, so it will not text you\. A person from Fundhub will follow up\./);
    assert.doesNotMatch(html, /class="composer"/);
    const off = fixture();
    off.helper.on = false;
    assert.match(text(H.render(off, { now: NOW })), /The money helper is not switched on\./);
  });

  test("loading is a skeleton in the real layout; error says what failed and offers Try again", () => {
    assert.match(H.renderLoading(), /aria-busy="true"/);
    assert.match(H.renderLoading(), /class="msg from-helper"><div class="bubble skel">/);
    assert.match(text(H.renderError("offline")), /We could not load your money helper We could not reach the server/);
    assert.match(H.renderError("server"), /data-act="retry"/);
    assert.equal(H.classify({ status: 503, body: { db: "down" } }), "nodb");
    assert.equal(H.classify({ status: 401, body: null }), "signin");
    assert.equal(H.classify({ status: 200, body: { ok: true } }), "ok");
  });

  test("a failed action and a dry practice action say so in words", () => {
    assert.match(H.renderAction({ type: "create_reminder", label: "Reminder", status: "failed" }), /Not done/);
    assert.match(H.renderAction({ type: "create_reminder", label: "Reminder", status: "would_do" }), /Practice run/);
    assert.equal(H.renderAction({ type: "no_action" }), "");
  });

  test("time: relative under a day, a date after", () => {
    assert.equal(H.relTime("2026-10-07T16:55:40.000Z", NOW), "just now");
    assert.equal(H.relTime("2026-10-07T16:40:00.000Z", NOW), "16 min ago");
    assert.equal(H.relTime("2026-10-07T13:00:00.000Z", NOW), "3 h ago");
    assert.match(H.relTime("2026-10-05T13:00:00.000Z", NOW), /^Oct 5, /);
  });
});

describe("mount — the section in a page", () => {
  const stubEl = () => ({
    innerHTML: "", listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; },
    removeEventListener(t) { delete this.listeners[t]; },
    contains: () => true,
    querySelector: () => null
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("paints through ctx.apiGet with the client id, no page chrome; sends with ctx.apiPost", async () => {
    const W2 = load();
    const el = stubEl();
    const asked = [];
    const posted = [];
    const handle = W2.FinanceOS.sections.helper.mount(el, {
      clientId: "c1",
      apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; },
      apiPost: async (p, b) => { posted.push([p, b]); return { status: 200, body: { ok: true, action: "send", queued: false, turn: null } }; }
    });
    await settle();
    assert.equal(asked[0], "/api/money/helper?client_id=c1");
    assert.match(el.innerHTML, /^<div class="fh-helper">/);
    assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
    await handle.send("What is due this week?");
    /* JSON round trip: the body was built inside the vm, a different realm. */
    assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), ["/api/money/helper", { action: "send", message: "What is due this week?", client_id: "c1" }]);
    assert.equal(asked.length, 2, "the thread is read again after a send");
    handle.unmount();
    assert.equal(el.innerHTML, "");
  });

  test("a refused send keeps the words and says why", async () => {
    const W2 = load();
    const el = stubEl();
    const handle = W2.FinanceOS.sections.helper.mount(el, {
      apiGet: async () => ({ status: 200, body: fixture() }),
      apiPost: async () => ({ status: 429, body: { ok: false, error: "too_many" } })
    });
    await settle();
    await handle.send("one more");
    assert.match(el.innerHTML, /That is a lot of messages for one day/);
    assert.match(el.innerHTML, />one more<\/textarea>/);
  });
});

describe("styles", () => {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  test("every rule lives under .fh-helper", () => {
    const noKeyframes = clean.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const selectors = noKeyframes.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    assert.ok(selectors.length > 40);
    for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-helper(\s|$|:|\[)/, part);
  });

  test("no px font sizes — the brand file sizes the type (UI-STANDARDS §12.7)", () => {
    assert.doesNotMatch(clean, /font-size\s*:/);
    assert.doesNotMatch(clean, /(?:^|[;{\s])font\s*:\s*[^;}]*\d+px/);
    assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, ""), /font-size\s*:\s*\d+px/);
  });

  test("spacing stays on the 8px scale", () => {
    const off = [...clean.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}]+)/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((v) => /^\d+px$/.test(v) && ![0, 8, 16, 24, 32, 48, 64].includes(parseInt(v, 10)));
    assert.deepEqual(off, []);
  });

  test("a phone: one column, nothing wider than the screen; status is never colour alone", () => {
    assert.match(clean, /@media \(max-width:760px\)\{[\s\S]*\.fh-helper \.msg\{max-width:88%\}/);
    assert.doesNotMatch(clean, /box-shadow:[^;}]*--spectrum/);
    assert.match(JS, /Needs your approval/);
  });
});
