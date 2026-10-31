// src/ads/survey-tracking-hooks.test.mjs — the survey and sorting-hat tracking hooks.
//
// Contract: docs/tracking/tracking-spec.md. The hooks under test:
//   marketing/landing-pages/apply-survey.html  /apply survey     survey_answer, field_focus,
//                                                                field_complete, validation_error
//   public/js/homepage-survey.js               fundhub.ai survey same four
//   public/funnel/thankyou-sort.js             /thank-you       survey_route
// Each hook calls window.fhTrack, or queues on window.fhq before the shared tracker
// (public/funnel/fh-events.js) has loaded. These tests run the REAL page scripts in
// a vm with a very small DOM (below) and read what they queued. The shared tracker
// itself is tested in src/ads/fh-events*.test.mjs; it is not loaded here.
//
// WHAT THIS CANNOT TEST: a real browser. The browser walk is on the board.
//
// npm test's glob is src/** and scripts/** only (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const APPLY_HTML = read("marketing/landing-pages/apply-survey.html");
const HOME_JS = read("public/js/homepage-survey.js");
const HOME_HTML = read("public/index.html");
const THANKS_JS = read("public/funnel/thankyou-sort.js");
const APP_CARD_JS = read("public/funnel/fundhub-prompter-download.js");

/* The props each event may carry (spec, "Events"). */
const ALLOWED = {
  /* last: true on the final question only (docs/tracking/meta-events.md, Phase 4 map:
     the shared tracker turns it into Meta Lead). */
  survey_answer: ["survey", "step_num", "question_id", "last", "credit_tier"],
  survey_route: ["survey", "offer"],
  field_focus: ["form", "field"],
  field_complete: ["form", "field"],
  validation_error: ["form", "field", "code"],
};

// ── a very small DOM ─────────────────────────────────────────────────────────
// Elements with attributes, text, children; innerHTML parsed into a tree; simple
// selectors (tag, #id, .class, [attr], [attr="v"], comma lists, descendants);
// focus and blur in browser order. No bubbling: none of these scripts need it.

const VOID = new Set(["input", "img", "br", "meta", "link", "hr", "source", "wbr"]);
const ENT = { "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'" };
const decode = (s) => String(s).replace(/&(quot|amp|lt|gt|#39);/g, (m) => ENT[m]);

function parseAttrs(src) {
  const out = {};
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

function parseCompound(raw) {
  const not = [];
  const rest = raw.replace(/:not\(([^)]*)\)/g, (_, inner) => { not.push(parseCompound(inner)); return ""; });
  const m = /^([a-z][a-z0-9]*)?(.*)$/i.exec(rest);
  const p = { tag: m[1] ? m[1].toUpperCase() : null, ids: [], classes: [], attrs: [], not };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let x;
  while ((x = re.exec(m[2]))) {
    if (x[1]) p.ids.push(x[1]);
    else if (x[2]) p.classes.push(x[2]);
    else p.attrs.push([x[3], x[4]]);
  }
  return p;
}

function matchOne(el, p) {
  if (p.not.some((n) => matchOne(el, n))) return false;
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.ids.some((id) => el.id !== id)) return false;
  if (p.classes.some((c) => !el.classList.contains(c))) return false;
  return p.attrs.every(([n, v]) => el.hasAttribute(n) && (v === undefined || el.getAttribute(n) === v));
}

function matchChain(el, chain) {
  if (!matchOne(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let n = el.parentNode; n && i >= 0; n = n.parentNode) if (n instanceof El && matchOne(n, chain[i])) i--;
  return i < 0;
}

class Txt {
  constructor(data) { this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
}

class El {
  constructor(doc, tag, attrs = {}) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = { setProperty() {} };
    this.value = attrs.value ?? "";
    this.hidden = "hidden" in attrs;
    this.checked = "checked" in attrs;
    this.disabled = false;
  }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = String(v); }
  get name() { return this.attrs.name || ""; }
  set name(v) { this.attrs.name = String(v); }
  get alt() { return this.attrs.alt || ""; }
  set alt(v) { this.attrs.alt = String(v); }
  get className() { return this.attrs.class || ""; }
  set className(v) { this.attrs.class = String(v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { if (!list().includes(c)) el.className = [...list(), c].join(" "); },
      remove: (c) => { el.className = list().filter((x) => x !== c).join(" "); },
    };
  }
  get dataset() {
    const d = {};
    for (const [k, v] of Object.entries(this.attrs)) {
      if (k.startsWith("data-")) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return d;
  }
  getAttribute(n) { return Object.hasOwn(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  hasAttribute(n) { return Object.hasOwn(this.attrs, n); }
  removeAttribute(n) { delete this.attrs[n]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type) {
    const ev = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const fn of [...(this.listeners[type] || [])]) fn.call(this, ev);
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(n);
    n.parentNode = this;
    this.children.splice(i, 0, n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    const sib = this.parentNode.children;
    sib.splice(sib.indexOf(this), 1);
    this.parentNode = null;
  }
  after(n) {
    const sib = this.parentNode.children;
    n.parentNode = this.parentNode;
    sib.splice(sib.indexOf(this) + 1, 0, n);
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.children;
    return sib[sib.indexOf(this) + 1] || null;
  }
  get firstElementChild() { return this.children.find((c) => c instanceof El) || null; }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.children = []; this.appendChild(new Txt(String(v))); }
  set innerHTML(html) { this.children = []; parseInto(this, String(html)); }
  get innerHTML() { return ""; }
  querySelectorAll(sel) {
    const chains = sel.split(",").map((s) => s.trim().split(/\s+/).map(parseCompound));
    const out = [];
    const visit = (n) => {
      for (const c of n.children) {
        if (!(c instanceof El)) continue;
        if (chains.some((ch) => matchChain(c, ch))) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    const chains = sel.split(",").map((s) => s.trim().split(/\s+/).map(parseCompound));
    for (let n = this; n instanceof El; n = n.parentNode) if (chains.some((ch) => matchChain(n, ch))) return n;
    return null;
  }
  focus() { this.ownerDocument.setActive(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.setActive(this.ownerDocument.body); }
  get selectionStart() { return String(this.value).length; }
  setSelectionRange() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  scrollIntoView() {}
  get contentWindow() { return (this._cw ||= {}); }
}

function parseInto(parent, html) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)([^>]*?)(\/?)>|[^<]+|</g;
  const stack = [parent];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const name = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === name) { stack.length = i; break; }
    } else if (m[2]) {
      const el = new El(parent.ownerDocument, m[2], parseAttrs(m[3]));
      top.appendChild(el);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
    } else {
      top.appendChild(new Txt(decode(m[0])));
    }
  }
}

function makeDocument(bodyHtml, { referrer = "" } = {}) {
  const doc = { readyState: "complete", referrer, activeElement: null };
  doc.documentElement = new El(doc, "html");
  doc.head = doc.documentElement.appendChild(new El(doc, "head"));
  doc.body = doc.documentElement.appendChild(new El(doc, "body"));
  parseInto(doc.body, bodyHtml);
  doc.createElement = (t) => new El(doc, t);
  doc.getElementById = (id) => doc.documentElement.querySelector("#" + id);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  // Browser order: the old field blurs, then the new one gets focus.
  doc.setActive = (el) => {
    const prev = doc.activeElement;
    if (prev === el) return;
    doc.activeElement = el;
    if (prev) prev.dispatch("blur");
    el.dispatch("focus");
  };
  return doc;
}

function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Runs one page script against `doc`. Timers are fake: flush() runs every pending one. */
function makePage(doc, { hostname, pathname, local = {}, fhTrack, fetchImpl } = {}) {
  let now = 0;
  let seq = 0;
  let queue = [];
  const win = {
    document: doc,
    location: {
      protocol: "https:", hostname, pathname, href: `https://${hostname}${pathname}`,
      assign(u) { win.__assigned = u; },
    },
    navigator: {},
    sessionStorage: storage(),
    localStorage: storage(local),
    setTimeout(fn, ms) { queue.push({ at: now + (ms || 0), fn, id: ++seq }); return seq; },
    clearTimeout(id) { queue = queue.filter((t) => t.id !== id); },
    setInterval: () => 0,
    clearInterval() {},
    innerWidth: 1024,
    innerHeight: 800,
    pageYOffset: 0,
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {},
    fetch: fetchImpl || (() => new Promise(() => {})),
    console,
  };
  win.window = win;
  win.self = win;
  win.top = win;
  if (fhTrack) win.fhTrack = fhTrack;
  vm.createContext(win);
  return {
    win,
    doc,
    run(code) { vm.runInContext(code, win); return this; },
    flush() {
      for (let guard = 0; queue.length && guard < 500; guard++) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = queue.shift();
        now = t.at;
        t.fn();
      }
    },
    /** What the hooks queued: [[event, props], ...] (plain objects, out of the vm). */
    events() { return JSON.parse(JSON.stringify(win.fhq || [])); },
    click(el) { assert.ok(el, "nothing to click"); doc.setActive(el); el.dispatch("click"); this.flush(); },
    type(el, text) { assert.ok(el, "no field"); doc.setActive(el); el.value = text; el.dispatch("input"); },
  };
}

const ev = (event, props) => [event, props];
const names = (events) => events.map((e) => e[0]);

/** Every queued event is on the spec's allow-list and carries only its own props. */
function assertShape(events) {
  for (const [event, props] of events) {
    assert.ok(Object.hasOwn(ALLOWED, event), `unexpected event ${event}`);
    for (const k of Object.keys(props)) assert.ok(ALLOWED[event].includes(k), `${event} carries ${k}`);
  }
}

/** None of the visitor's answers or typed words appear anywhere in what was queued.
    A short answer ("No") is checked as a whole value: it is inside "money_change_now". */
function assertNoValues(events, values) {
  const blob = JSON.stringify(events).toLowerCase();
  const props = events.flatMap(([, p]) => Object.values(p).map((v) => String(v).toLowerCase()));
  for (const raw of values) {
    const v = String(raw).toLowerCase();
    if (v.length >= 4) assert.equal(blob.includes(v), false, `leaked: ${raw}`);
    else assert.equal(props.includes(v), false, `leaked: ${raw}`);
  }
}

// ── /apply ───────────────────────────────────────────────────────────────────

function openApply(opts = {}) {
  const body = APPLY_HTML.slice(APPLY_HTML.indexOf("<body>") + 6, APPLY_HTML.indexOf("<script>"));
  const script = APPLY_HTML.slice(APPLY_HTML.indexOf("<script>") + 8, APPLY_HTML.lastIndexOf("</script>"));
  const doc = makeDocument(body);
  const page = makePage(doc, { hostname: "apply.fundhub.ai", pathname: "/apply", ...opts }).run(script);
  page.flush();
  const byId = (id) => doc.getElementById(id);
  const option = (label) => doc.getElementById("body").querySelectorAll(".opt").find((b) => b.textContent === label);
  return { page, doc, byId, pick: (label) => page.click(option(label)) };
}

const APPLY_CONTACT = { first: "Testfirst", last: "Testlast", email: "tester.qa@example.com", phone: "4155550123" };

function fillApplyContact(a, c = APPLY_CONTACT) {
  a.page.type(a.byId("f-first"), c.first);
  a.page.type(a.byId("f-last"), c.last);
  a.page.type(a.byId("f-email"), c.email);
  a.page.type(a.byId("f-phone"), c.phone);
  a.page.click(a.byId("next"));
}

const APPLY_COMMON = [
  ["cf_svy_funding_target_amount", "$100k - $200k"],
  ["cf_svy_planned_use", "Equipment or buildout"],
  ["cf_svy_money_change_now", "Stability (cover bills / buffer slow weeks)"],
  ["cf_svy_self_reported_fico", "700-749"],
];
const APPLY_BIZ = [
  ["cf_svy_has_business", "Yes, 2-5 years"],
  ["cf_svy_business_revenue", "$250k - $499k"],
  ["cf_svy_revenue_verifiable", "Yes, tax returns"],
  ["cf_svy_available_capital", "$5k - $25k"],
];
const APPLY_PERSONAL = [
  ["cf_svy_has_business", "No, personal funding only"],
  ["cf_svy_annual_income_range", "$100k-$199k"],
  ["cf_svy_income_verifiable", "Yes, W-2 or tax returns"],
  ["cf_svy_available_capital", "$25k - $100k"],
];

function walkApply(rest) {
  const a = openApply();
  fillApplyContact(a);
  for (const [, label] of [...APPLY_COMMON, ...rest]) a.pick(label);
  return a;
}

const APPLY_CONTACT_EVENTS = [
  ev("field_focus", { form: "apply", field: "first_name" }),
  ev("field_complete", { form: "apply", field: "first_name" }),
  ev("field_focus", { form: "apply", field: "last_name" }),
  ev("field_complete", { form: "apply", field: "last_name" }),
  ev("field_focus", { form: "apply", field: "email" }),
  ev("field_complete", { form: "apply", field: "email" }),
  ev("field_focus", { form: "apply", field: "phone" }),
  ev("field_complete", { form: "apply", field: "phone" }),
  ev("survey_answer", { survey: "apply", step_num: 1, question_id: "contact" }),
];

/* The final question (cf_svy_available_capital) carries last: true; no other screen does.
   It also carries the owner's credit bucket (2026-10-29); APPLY_COMMON answers 700-749. */
const answersOf = (path, tier = "qualified") =>
  path.map(([key], i) => ev("survey_answer", {
    survey: "apply", step_num: i + 2, question_id: key, ...(i === path.length - 1 ? { last: true, credit_tier: tier } : {}),
  }));

describe("/apply survey hooks (apply-survey.html)", () => {
  test("business path: contact fields, then one survey_answer per screen in the order seen", () => {
    const a = walkApply(APPLY_BIZ);
    const got = a.page.events();
    assert.deepEqual(got, [...APPLY_CONTACT_EVENTS, ...answersOf([...APPLY_COMMON, ...APPLY_BIZ])]);
    assert.ok(a.doc.body.textContent.includes("You're qualified. Pick a time below."), "the survey still finishes");
    assertShape(got);
  });

  test("personal path: screens 7 and 8 are the income questions", () => {
    const a = walkApply(APPLY_PERSONAL);
    const got = a.page.events();
    assert.deepEqual(got, [...APPLY_CONTACT_EVENTS, ...answersOf([...APPLY_COMMON, ...APPLY_PERSONAL])]);
    assert.deepEqual(got.at(-3)[1], { survey: "apply", step_num: 7, question_id: "cf_svy_annual_income_range" });
    assertShape(got);
  });

  test("the two calendars: qualified credit frames /funding-book-call; every other score answer frames the copy", () => {
    const want = { "700-749": "https://apply.fundhub.ai/funding-book-call", "750+": "https://apply.fundhub.ai/funding-book-call",
      "650-699": "https://apply.fundhub.ai/funding-book-call--02424", "Not sure": "https://apply.fundhub.ai/funding-book-call--02424" };
    for (const [score, src] of Object.entries(want)) {
      const a = openApply();
      fillApplyContact(a);
      for (const [key, label] of [...APPLY_COMMON, ...APPLY_BIZ]) a.pick(key === "cf_svy_self_reported_fico" ? score : label);
      a.page.flush();
      assert.equal(a.byId("fh-book-frame").src, src, score);
      assert.ok(a.doc.body.textContent.includes("You're qualified. Pick a time below."), `${score}: the page words do not change`);
    }
  });

  test("the credit bucket: 700-749 and 750+ are qualified; every other score answer, Not sure too, is unqualified", () => {
    const tiers = { "500-579": "unqualified", "580-649": "unqualified", "650-699": "unqualified",
      "700-749": "qualified", "750+": "qualified", "Not sure": "unqualified" };
    for (const [score, tier] of Object.entries(tiers)) {
      const a = openApply();
      fillApplyContact(a);
      for (const [key, label] of [...APPLY_COMMON, ...APPLY_BIZ]) a.pick(key === "cf_svy_self_reported_fico" ? score : label);
      const got = a.page.events().filter((e) => e[1].credit_tier !== undefined);
      assert.deepEqual(got, [ev("survey_answer", { survey: "apply", step_num: 9, question_id: "cf_svy_available_capital", last: true, credit_tier: tier })], score);
      assert.ok(a.doc.body.textContent.includes("You're qualified. Pick a time below."), `${score}: the page words do not change`);
      assert.ok(!JSON.stringify(a.page.events()).includes(score), `${score}: the score itself is never queued`);
    }
  });

  test("only the final question (available capital, step 9) carries last: true, on both paths", () => {
    for (const rest of [APPLY_BIZ, APPLY_PERSONAL]) {
      const lasts = walkApply(rest).page.events().filter((e) => e[1].last !== undefined);
      assert.deepEqual(lasts, [ev("survey_answer", { survey: "apply", step_num: 9, question_id: "cf_svy_available_capital", last: true, credit_tier: "qualified" })]);
    }
  });

  test("no answer and no typed value is ever queued", () => {
    for (const rest of [APPLY_BIZ, APPLY_PERSONAL]) {
      const got = walkApply(rest).page.events();
      assertNoValues(got, [
        ...[...APPLY_COMMON, ...rest].map(([, label]) => label),
        APPLY_CONTACT.first, APPLY_CONTACT.last, APPLY_CONTACT.email, "555-0123", APPLY_CONTACT.phone,
      ]);
    }
  });

  test("the page's own focus on First Name is not a field_focus; typing is", () => {
    const a = openApply();
    assert.equal(a.doc.activeElement, a.byId("f-first"), "the page focuses First Name");
    assert.deepEqual(a.page.events(), []);
    a.page.type(a.byId("f-first"), "Testfirst");
    assert.deepEqual(a.page.events(), [ev("field_focus", { form: "apply", field: "first_name" })]);
  });

  test("validation_error names the field and a short code, once per error shown", () => {
    const a = openApply();
    const next = () => a.page.click(a.byId("next"));
    const errText = () => a.byId("err").textContent;
    next();
    assert.equal(errText(), "Enter your first and last name.");
    a.page.type(a.byId("f-first"), "Testfirst");
    next();
    a.page.type(a.byId("f-last"), "Testlast");
    next();
    a.page.type(a.byId("f-email"), "bad@");
    next();
    assert.equal(errText(), "Enter a valid email so we can send your confirmation.");
    a.page.type(a.byId("f-email"), "tester.qa@example.com");
    a.page.type(a.byId("f-phone"), "123");
    next();
    assert.equal(errText(), "Enter a valid 10-digit US phone number.");
    const errors = a.page.events().filter((e) => e[0] === "validation_error");
    assert.deepEqual(errors, [
      ev("validation_error", { form: "apply", field: "first_name", code: "required" }),
      ev("validation_error", { form: "apply", field: "last_name", code: "required" }),
      ev("validation_error", { form: "apply", field: "email", code: "required" }),
      ev("validation_error", { form: "apply", field: "email", code: "invalid" }),
      ev("validation_error", { form: "apply", field: "phone", code: "invalid" }),
    ]);
    assertNoValues(a.page.events(), ["Testfirst", "Testlast", "tester.qa", "bad@", "(123"]);
    // A field left with a value that fails its check is not complete.
    assert.equal(a.page.events().some((e) => e[0] === "field_complete" && e[1].field === "phone"), false);
  });

  test("field_focus and field_complete fire once per field per page load, Back and forth", () => {
    const a = openApply();
    fillApplyContact(a);
    a.page.click(a.byId("back"));
    a.page.type(a.byId("f-first"), "Other");
    a.page.click(a.byId("next"));
    const fields = a.page.events().filter((e) => e[0].startsWith("field_"));
    assert.equal(fields.length, 8, "4 fields x focus + complete");
    const answers = a.page.events().filter((e) => e[0] === "survey_answer");
    assert.deepEqual(answers.map((e) => e[1].question_id), ["contact", "contact"], "each answer counts");
  });

  test("autofill with no blur: Next still marks every field complete", () => {
    const a = openApply();
    for (const [id, v] of [["f-first", "Testfirst"], ["f-last", "Testlast"], ["f-email", "tester.qa@example.com"], ["f-phone", "(415) 555-0123"]]) {
      a.byId(id).value = v;
    }
    a.page.click(a.byId("next"));
    assert.deepEqual(a.page.events(), [
      ev("field_complete", { form: "apply", field: "first_name" }),
      ev("field_complete", { form: "apply", field: "last_name" }),
      ev("field_complete", { form: "apply", field: "email" }),
      ev("field_complete", { form: "apply", field: "phone" }),
      ev("survey_answer", { survey: "apply", step_num: 1, question_id: "contact" }),
    ]);
  });

  test("with the tracker loaded the hooks call window.fhTrack and queue nothing", () => {
    const calls = [];
    const a = openApply({ fhTrack: (e, p) => calls.push([e, JSON.parse(JSON.stringify(p))]) });
    fillApplyContact(a);
    a.pick("$100k - $200k");
    assert.deepEqual(names(calls), [...names(APPLY_CONTACT_EVENTS), "survey_answer"]);
    assert.equal(a.page.win.fhq, undefined);
  });

  test("click labels never carry the answer or the email: option and suggestion buttons are named", () => {
    const a = openApply();
    a.page.type(a.byId("f-email"), "tester.qa@gmial.com");
    a.page.type(a.byId("f-first"), "Testfirst");   // leaves the email field: the typo check runs
    const sug = a.byId("sugbtn");
    assert.ok(sug, "the email suggestion shows");
    assert.equal(sug.getAttribute("data-fh-track"), "apply-email-suggestion");
    fillApplyContact(a);
    for (let i = 0; i < 4; i++) {
      const opts = a.byId("body").querySelectorAll(".opt");
      assert.ok(opts.length > 0);
      for (const b of opts) assert.equal(b.getAttribute("data-fh-track"), "apply-option");
      a.page.click(opts[0]);
    }
  });

  test("main blocks carry data-fh-section; the calendar events are left to the shared tracker", () => {
    for (const [sel, name] of [[".hero", "hero"], ["#sv", "survey"], ["#body", "survey"], [".wins", "approvals"], ["#cal", "calendar"]]) {
      const a = openApply();
      assert.equal(a.doc.querySelector(sel).getAttribute("data-fh-section"), name, sel);
    }
    for (const e of ["calendar_view", "time_selected", "booking_confirmed"]) assert.equal(APPLY_HTML.includes(e), false, e);
  });
});

// ── fundhub.ai homepage survey ───────────────────────────────────────────────

function openHome(opts = {}) {
  const doc = makeDocument('<form class="appform" id="appform" novalidate data-survey="homepage"></form>');
  const page = makePage(doc, { hostname: "fundhub.ai", pathname: "/", ...opts }).run(HOME_JS);
  const root = doc.getElementById("appform");
  const act = (name) => root.querySelector(`[data-act="${name}"]`);
  const choose = (label) => page.click(root.querySelectorAll(".sv-opt").find((b) => b.getAttribute("data-opt") === label));
  return {
    page, doc, root, act,
    answer(label) { if (label !== null) choose(label); page.click(act("next")); },
    choose,
  };
}

const HOME_COMMON = [
  ["funding_target_amount", "$50k - $100k"],
  ["planned_use", "Debt consolidation"],
  ["money_change_now", "Peace of mind (stop stressing about cash)"],
  ["current_score", "650-699"],
  ["has_negatives", "No"],
];
const HOME_BIZ = [
  ["has_business", "Yes, 1-2 years"],
  ["annual_business_revenue", "$100k - $249k"],
  ["verify_revenue", "Yes, both"],
  ["available_capital", "$1k - $5k"],
];
const HOME_PERSONAL = [
  ["has_business", "No, personal funding only"],
  ["annual_personal_income", "$200k-$499k"],
  ["verify_income", "Yes, pay stubs"],
  ["available_capital", "$100k+"],
];
const HOME_CONTACT = { name: "Homefirst Homelast", business: "Acme Test Co", email: "home.qa@example.com", phone: "(415) 555-0199" };

const okFetch = () => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve({ ok: true, redirect: "https://apply.fundhub.ai/funding-book-call" }),
});

async function walkHome(rest, opts = {}) {
  const h = openHome({ fetchImpl: okFetch, ...opts });
  for (const [, label] of [...HOME_COMMON, ...rest]) h.answer(label);
  const byId = (id) => h.doc.getElementById(id);
  h.page.type(byId("sv-name"), HOME_CONTACT.name);
  h.page.type(byId("sv-business"), HOME_CONTACT.business);
  h.page.type(byId("sv-email"), HOME_CONTACT.email);
  h.page.type(byId("sv-phone"), HOME_CONTACT.phone);
  h.page.click(h.act("submit"));
  await new Promise((r) => setImmediate(r));
  return h;
}

const homeAnswers = (path) =>
  path.map(([id], i) => ev("survey_answer", { survey: "home", step_num: i + 1, question_id: id }));
const HOME_CONTACT_EVENTS = [
  ev("field_focus", { form: "home", field: "name" }),
  ev("field_complete", { form: "home", field: "name" }),
  ev("field_focus", { form: "home", field: "business" }),
  ev("field_complete", { form: "home", field: "business" }),
  ev("field_focus", { form: "home", field: "email" }),
  ev("field_complete", { form: "home", field: "email" }),
  ev("field_focus", { form: "home", field: "phone" }),
  ev("field_complete", { form: "home", field: "phone" }),
  ev("survey_answer", { survey: "home", step_num: 10, question_id: "contact", last: true }),
];

describe("fundhub.ai homepage survey hooks (public/js/homepage-survey.js)", () => {
  test("business path: one survey_answer per screen, contact last as step 10", async () => {
    const h = await walkHome(HOME_BIZ);
    const got = h.page.events();
    assert.deepEqual(got, [...homeAnswers([...HOME_COMMON, ...HOME_BIZ]), ...HOME_CONTACT_EVENTS]);
    assert.equal(h.page.win.__assigned, "https://apply.fundhub.ai/funding-book-call", "the survey still submits and moves on");
    assertShape(got);
  });

  test("personal path: screens 7 and 8 are the income questions", async () => {
    const h = await walkHome(HOME_PERSONAL);
    const got = h.page.events();
    assert.deepEqual(got, [...homeAnswers([...HOME_COMMON, ...HOME_PERSONAL]), ...HOME_CONTACT_EVENTS]);
    assert.deepEqual(got[6][1], { survey: "home", step_num: 7, question_id: "annual_personal_income" });
    assertShape(got);
  });

  test("last: true goes on the contact submit once per page load: a second press after a failed send is not a second Lead", async () => {
    const failFetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false }) });
    const h = await walkHome(HOME_BIZ, { fetchImpl: failFetch });
    h.page.click(h.act("submit"));
    await new Promise((r) => setImmediate(r));
    const contact = h.page.events().filter((e) => e[0] === "survey_answer" && e[1].question_id === "contact");
    assert.deepEqual(contact, [
      ev("survey_answer", { survey: "home", step_num: 10, question_id: "contact", last: true }),
      ev("survey_answer", { survey: "home", step_num: 10, question_id: "contact" }),
    ]);
    assert.equal(h.page.events().filter((e) => e[1].last !== undefined).length, 1, "no other screen carries last");
  });

  test("no answer and no typed value is ever queued", async () => {
    for (const rest of [HOME_BIZ, HOME_PERSONAL]) {
      const got = (await walkHome(rest)).page.events();
      assertNoValues(got, [...[...HOME_COMMON, ...rest].map(([, l]) => l), ...Object.values(HOME_CONTACT), "Homefirst", "555-0199"]);
    }
  });

  test("validation_error names the screen or field and a short code", async () => {
    const h = openHome({ fetchImpl: okFetch });
    const err = () => h.root.querySelector(".sv-err").textContent;
    h.answer(null);
    assert.equal(err(), "We need this one to continue.");
    h.answer("$50k - $100k");
    h.choose("Other");
    h.page.type(h.doc.getElementById("sv-other"), "   ");
    h.page.click(h.act("next"));
    h.page.type(h.doc.getElementById("sv-other"), "my secret plan");
    h.page.click(h.act("next"));
    h.answer(null);   // money_change_now: nothing picked
    h.answer("Peace of mind (stop stressing about cash)");
    for (const [, label] of HOME_COMMON.slice(3)) h.answer(label);
    for (const [, label] of HOME_BIZ) h.answer(label);
    h.page.click(h.act("submit"));
    h.page.type(h.doc.getElementById("sv-name"), "Homefirst Homelast");
    h.page.click(h.act("submit"));
    h.page.type(h.doc.getElementById("sv-email"), "home.qa@example");
    h.page.click(h.act("submit"));
    assert.equal(err(), "That address doesn't look complete — check for a typo.");
    const errors = h.page.events().filter((e) => e[0] === "validation_error");
    assert.deepEqual(errors, [
      ev("validation_error", { form: "home", field: "funding_target_amount", code: "required" }),
      ev("validation_error", { form: "home", field: "planned_use", code: "other_required" }),
      ev("validation_error", { form: "home", field: "money_change_now", code: "required" }),
      ev("validation_error", { form: "home", field: "name", code: "required" }),
      ev("validation_error", { form: "home", field: "email", code: "required" }),
      ev("validation_error", { form: "home", field: "email", code: "invalid" }),
    ]);
    assertNoValues(h.page.events(), ["my secret plan", "Homefirst", "home.qa"]);
    assert.equal(h.page.events().some((e) => e[0] === "survey_answer" && e[1].question_id === "contact"), false, "a refused submit is not an answer");
  });

  test("optional fields left empty are not complete; autofill with no blur still counts the rest", async () => {
    const h = openHome({ fetchImpl: okFetch });
    for (const [, label] of [...HOME_COMMON, ...HOME_BIZ]) h.answer(label);
    h.doc.getElementById("sv-name").value = "Homefirst Homelast";
    h.doc.getElementById("sv-email").value = "home.qa@example.com";
    h.page.click(h.act("submit"));
    const tail = h.page.events().slice(9);
    assert.deepEqual(tail, [
      ev("field_complete", { form: "home", field: "name" }),
      ev("field_complete", { form: "home", field: "email" }),
      ev("survey_answer", { survey: "home", step_num: 10, question_id: "contact", last: true }),
    ]);
  });

  test("option buttons are named for the click tracker, never by their words", () => {
    const h = openHome();
    for (const [, label] of HOME_COMMON) {
      const opts = h.root.querySelectorAll(".sv-opt");
      assert.ok(opts.length > 0);
      for (const b of opts) assert.equal(b.getAttribute("data-fh-track"), "home-option");
      h.answer(label);
    }
  });

  test("with the tracker loaded the hooks call window.fhTrack and queue nothing", async () => {
    const calls = [];
    const h = await walkHome(HOME_BIZ, { fhTrack: (e, p) => calls.push([e, JSON.parse(JSON.stringify(p))]) });
    assert.deepEqual(calls, [...homeAnswers([...HOME_COMMON, ...HOME_BIZ]), ...HOME_CONTACT_EVENTS]);
    assert.equal(h.page.win.fhq, undefined);
  });

  test("public/index.html loads the shared tracker and Clarity once each", () => {
    const count = (s) => HOME_HTML.split(s).length - 1;
    assert.equal(count('<script src="/funnel/fh-events.js" defer></script>'), 1);
    assert.equal(count('<script src="/js/clarity.js" defer></script>'), 1);
    assert.equal(count('<script src="/js/homepage-survey.js?v='), 1);
  });
});

// ── /thank-you sorting hat ───────────────────────────────────────────────────

const THANKS_BODY =
  '<div class="fh-root"><section class="hero"><p class="eyebrow">x</p><h1 class="sec">x</h1><p class="lede">x</p></section>' +
  '<div class="prose"><p class="lead">a</p><p>b</p></div>' +
  '<section class="expect"><div class="step"><span class="t">Your exact funding number</span></div></section>' +
  '<section class="faq"></section></div>';

function openThanks({ referrer = "", booking = null, acceptedAt = null, fhTrack, body = THANKS_BODY, times = 1 } = {}) {
  const doc = makeDocument(body, { referrer });
  const local = booking ? { fh_booking_v1: JSON.stringify(booking) } : {};
  const page = makePage(doc, { hostname: "apply.fundhub.ai", pathname: "/thank-you", local, fhTrack });
  if (acceptedAt != null) page.win.sessionStorage.setItem("fh_apply_booking_confirmed_v1", acceptedAt);
  for (let i = 0; i < times; i++) page.run(THANKS_JS);
  return page;
}

const freshBooking = () => {
  const now = Date.now();
  return {
    start: new Date(now + 86400e3).toISOString(),
    end: new Date(now + 86400e3 + 1800e3).toISOString(),
    name: "Bookfirst Booklast",
    email: "booker.qa@example.com",
    submittedAt: now - 5e3,
  };
};

describe("/thank-you sorting hat hook (public/funnel/thankyou-sort.js)", () => {
  test("the app card stays before the video in either script order", async () => {
    for (const first of ["card", "sort"]) {
      const doc = makeDocument(THANKS_BODY);
      const page = makePage(doc, { hostname: "apply.fundhub.ai", pathname: "/thank-you",
        fetchImpl: async () => ({ ok: true, json: async () => ({ app_store_url: "https://apps.apple.com/us/app/fundhub-portal/id6823985032" }) }) });
      const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
      if (first === "card") { page.run(APP_CARD_JS); await settle(); page.run(THANKS_JS); }
      else { page.run(THANKS_JS); page.run(APP_CARD_JS); await settle(); }
      const hero = doc.querySelector(".hero");
      const card = doc.getElementById("fh-prompter-download");
      const video = doc.getElementById("fh-ty-video");
      assert.ok(card && video, first);
      const siblings = hero.parentNode.children;
      assert.deepEqual([siblings.indexOf(hero), siblings.indexOf(card), siblings.indexOf(video)], [0, 1, 2], first);
    }
  });

  test("no booking: one survey_route to the call", () => {
    assert.deepEqual(openThanks().events(), [ev("survey_route", { survey: "apply", offer: "call" })]);
  });

  test("straight from /funding-book-call with a fresh booking: call-booked, and no booking detail leaks", () => {
    const got = openThanks({ referrer: "https://apply.fundhub.ai/funding-book-call", booking: freshBooking() }).events();
    assert.deepEqual(got, [ev("survey_route", { survey: "apply", offer: "call-booked" })]);
    assertNoValues(got, ["Bookfirst", "booker.qa"]);
  });

  test("a stored booking without the hop from /funding-book-call is not call-booked", () => {
    const got = openThanks({ referrer: "https://apply.fundhub.ai/apply", booking: freshBooking() }).events();
    assert.deepEqual(got, [ev("survey_route", { survey: "apply", offer: "call" })]);
  });

  test("/apply redirect with an accepted booking stamp is call-booked", () => {
    const booking = freshBooking();
    const got = openThanks({ referrer: "https://apply.fundhub.ai/apply", booking,
      acceptedAt: booking.submittedAt }).events();
    assert.deepEqual(got, [ev("survey_route", { survey: "apply", offer: "call-booked" })]);
  });

  test("sent here by the fundhub.ai homepage survey: survey home", () => {
    for (const referrer of ["https://fundhub.ai/", "https://www.fundhub.ai/"]) {
      assert.deepEqual(openThanks({ referrer }).events(), [ev("survey_route", { survey: "home", offer: "call" })], referrer);
    }
  });

  test("once per page load, even when the script is loaded twice", () => {
    assert.equal(openThanks({ times: 2 }).events().length, 1);
  });

  test("with the tracker loaded it calls window.fhTrack and queues nothing", () => {
    const calls = [];
    const page = openThanks({ fhTrack: (e, p) => calls.push([e, JSON.parse(JSON.stringify(p))]) });
    assert.deepEqual(calls, [ev("survey_route", { survey: "apply", offer: "call" })]);
    assert.equal(page.win.fhq, undefined);
  });

  test("not the thank-you page (no .fh-root): no route, no event", () => {
    assert.deepEqual(openThanks({ body: "<div></div>" }).events(), []);
  });

  test("the page still does its job: booked headline, approvals, and no repeat of the call steps", () => {
    const page = openThanks();
    assert.equal(page.doc.querySelector("h1.sec").textContent, "Your call is booked.");
    // "What the call decides" was cut in the owner reorder of 2026-10-23: it repeated step 03 and the three paths.
    assert.equal(page.doc.getElementById("fh-ty-decides"), null);
    assert.ok(page.doc.getElementById("fh-ty-proof"));
  });
});

describe("every hook uses the spec's safe queue form", () => {
  const SAFE = /\(window\.fhTrack \|\| function \(e, p\) \{ \(window\.fhq = window\.fhq \|\| \[\]\)\.push\(\[e, p\]\); \}\)\(e, p\);/;
  for (const [name, src] of [["apply-survey.html", APPLY_HTML], ["homepage-survey.js", HOME_JS], ["thankyou-sort.js", THANKS_JS]]) {
    test(name, () => assert.match(src, SAFE));
  }
});
