// src/ads/fh-events-harness.mjs — a tiny fake page for public/funnel/fh-events.js.
//
// Used by src/ads/fh-events.test.mjs and src/ads/fh-events-track.test.mjs. It runs
// the real script in a vm context with just enough DOM: elements with
// attributes, classes, text, sizes and positions; simple selectors (tag, #id,
// .class, [attr], [attr="v"], comma lists — no descendant combinators, which
// the script does not use); capture listeners; a fake clock and timers; a
// fake IntersectionObserver the test drives by hand; and, for the Meta side
// (src/ads/fh-events-meta.test.mjs), document.cookie, location.search /
// origin, window.__fhPv and a recording fbq (page.fbqCalls).
//
// For the /thank-you app-download card (src/ads/fh-events-cortana.test.mjs) it can
// also run a second real script in the same page (page.runScript), answer that
// script's setting fetch (the fetchJson option, page.fetchCalls) and take the
// small piece of markup the card writes into the page (innerHTML, appendChild,
// insertBefore, page.addHtml: tags, double-quoted attributes and text only).
//
// It is not a browser. The real-browser proof is the Playwright walk.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SRC = fs.readFileSync(path.join(ROOT, "public/funnel/fh-events.js"), "utf8");

function parseCompound(raw) {
  const s = raw.trim();
  const m = /^([a-z][a-z0-9]*)?(.*)$/i.exec(s);
  const parts = { tag: m[1] ? m[1].toUpperCase() : null, ids: [], classes: [], attrs: [] };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let x;
  while ((x = re.exec(m[2]))) {
    if (x[1]) parts.ids.push(x[1]);
    else if (x[2]) parts.classes.push(x[2]);
    else parts.attrs.push([x[3], x[4]]);
  }
  return parts;
}

function matchesOne(node, p) {
  if (p.tag && node.tagName !== p.tag) return false;
  if (p.ids.some((id) => node.id !== id)) return false;
  if (p.classes.some((c) => !node.classList.contains(c))) return false;
  return p.attrs.every(([n, v]) => node.hasAttribute(n) && (v === undefined || node.getAttribute(n) === v));
}

function matches(node, sel) {
  return sel.split(",").some((raw) => matchesOne(node, parseCompound(raw)));
}

export function makePage({
  pathname = "/roadmap",
  hostname = "apply.fundhub.ai",
  framed = false,
  webdriver = false,
  clarity = true,
  storage = {},
  storageThrows = false,
  title = "Fundhub",
  innerHeight = 800,
  innerWidth = 400,
  pageHeight = 4000,
  readyState = "complete",
  visibility = "visible",
  fhq,
  io = true,
  search = "",
  cookie = "",
  /** true: a fake fbq that records each call in page.fbqCalls. */
  fbq = false,
  /** true: a fake Cortana hub that records each custom event. */
  cortana = false,
  /** window.__fhPv, as the head pixel snippet sets it. */
  fhPv,
  /** An object that fetch answers with ({ ok: true, json() }), as a card script reads its
      setting file. Left out, fetch never answers. Every URL asked for is in page.fetchCalls. */
  fetchJson,
} = {}) {
  const sent = [];
  const fbqCalls = [];
  const cortanaCalls = [];
  const docListeners = {};
  const winListeners = {};
  const valueReads = [];
  const clock = { now: 1_000_000 };
  let timers = [];
  let timerId = 0;
  const observed = new Set();
  let ioCallback = null;

  function node(tag, opts = {}) {
    const attrs = { ...(opts.attrs || {}) };
    if (opts.id) attrs.id = opts.id;
    const cls = new Set(opts.cls || []);
    const n = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      parentNode: null,
      children: [],
      text: opts.text || "",
      rect: { top: 0, height: 0, width: 0, ...(opts.rect || {}) },
      css: { position: "static", order: "0", ...(opts.css || {}) },
      _value: opts.value ?? "",
      open: !!opts.open,
      disabled: false,
      classList: {
        contains: (c) => cls.has(c),
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
      },
      get id() { return attrs.id || ""; },
      set id(v) { attrs.id = String(v); },
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); attrs.class = String(v); },
      get href() { return attrs.href ?? ""; },
      set href(v) { attrs.href = String(v); },
      get textContent() { return n.text + n.children.map((c) => c.textContent).join(""); },
      set textContent(v) { n.text = String(v); n.children = []; },
      set innerHTML(markup) { n.text = ""; n.children = []; for (const k of parseMarkup(markup)) n.append(k); },
      get nextSibling() {
        const p = n.parentNode, i = p && p.children ? p.children.indexOf(n) : -1;
        return i >= 0 ? p.children[i + 1] || null : null;
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
      hasAttribute: (k) => k in attrs,
      matches: (sel) => matches(n, sel),
      contains: (other) => { for (let x = other; x; x = x.parentNode) if (x === n) return true; return false; },
      querySelectorAll: (sel) => descendants(n).filter((d) => matches(d, sel)),
      querySelector: (sel) => descendants(n).find((d) => matches(d, sel)) || null,
      getBoundingClientRect: () => ({
        top: n.rect.top - win.pageYOffset, height: n.rect.height, width: n.rect.width, left: 0,
      }),
      append(...kids) { for (const k of kids) { k.parentNode = n; n.children.push(k); } return n; },
      appendChild(kid) { n.append(kid); return kid; },
      insertBefore(kid, ref) {
        kid.parentNode = n;
        const i = ref ? n.children.indexOf(ref) : -1;
        if (i < 0) n.children.push(kid); else n.children.splice(i, 0, kid);
        return kid;
      },
    };
    Object.defineProperty(n, "value", {
      get() { valueReads.push(n); return n._value; },
      set(v) { n._value = v; },
    });
    if (opts.video) Object.assign(n, { muted: false, volume: 1, duration: NaN, currentTime: 0, ended: false, currentSrc: "", src: "" }, opts.video);
    return n;
  }

  function descendants(root) {
    const out = [];
    (function walk(x) { for (const c of x.children) { out.push(c); walk(c); } })(root);
    return out;
  }

  /* Markup in, nodes out: tags, double-quoted attributes, text. Enough for what the card
     scripts write with innerHTML. It is not an HTML parser. Text goes on the open node's own
     text, so a node's textContent reads right but text and children are not interleaved. */
  const VOID = /^(img|br|hr|input|meta|link)$/i;
  function parseMarkup(markup) {
    const top = node("div");
    const open = [top];
    const re = /<(\/?)([a-z][a-z0-9]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(String(markup)))) {
      const parent = open[open.length - 1];
      if (m[5] !== undefined) { parent.text += m[5]; continue; }
      if (m[1]) { if (open.length > 1) open.pop(); continue; }
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
      const kid = node(m[2], { attrs, cls: (attrs.class || "").split(/\s+/).filter(Boolean) });
      parent.append(kid);
      if (!m[4] && !VOID.test(m[2])) open.push(kid);
    }
    const out = [...top.children];
    for (const k of out) k.parentNode = null;
    return out;
  }

  const html = node("html");
  const body = node("body");
  html.append(body);
  Object.defineProperty(html, "scrollHeight", { get: () => pageHeight });
  Object.defineProperty(html, "scrollTop", { get: () => 0 });
  Object.defineProperty(html, "clientHeight", { get: () => innerHeight });
  Object.defineProperty(html, "clientWidth", { get: () => innerWidth });
  Object.defineProperty(body, "scrollHeight", { get: () => 0 });
  Object.defineProperty(body, "scrollTop", { get: () => 0 });

  const document = {
    readyState,
    visibilityState: visibility,
    title,
    cookie,
    documentElement: html,
    body,
    addEventListener: (name, fn) => { (docListeners[name] ||= []).push(fn); },
    getElementById: (id) => [html, ...descendants(html)].find((x) => x.id === id) || null,
    querySelectorAll: (sel) => [html, ...descendants(html)].filter((x) => matches(x, sel)),
    querySelector: (sel) => [html, ...descendants(html)].find((x) => matches(x, sel)) || null,
    createElement: (tag) => node(tag),
  };
  html.parentNode = document;

  const store = { ...storage };
  const sessionStorage = storageThrows
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };

  const calls = [];
  const win = {
    location: { pathname, hostname, search, origin: `https://${hostname}`, href: `https://${hostname}${pathname}${search}`,
      assign(url) { this.href = String(url); } },
    navigator: { webdriver, sendBeacon: (url, blob) => { sent.push({ url, text: blob.text }); return true; } },
    sessionStorage,
    innerHeight,
    innerWidth,
    pageYOffset: 0,
    addEventListener: (name, fn) => { (winListeners[name] ||= []).push(fn); },
    getComputedStyle: (el) => ({ position: el.css.position, order: el.css.order }),
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, at: clock.now + (ms || 0), fn }); return timerId; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
  };
  if (io) {
    win.IntersectionObserver = function (cb) {
      ioCallback = cb;
      this.observe = (el) => observed.add(el);
      this.unobserve = (el) => observed.delete(el);
    };
  }
  if (clarity) win.clarity = (...a) => calls.push(a);
  if (fhq) win.fhq = fhq;
  if (fbq) win.fbq = (...a) => { fbqCalls.push(JSON.parse(JSON.stringify(a))); };
  if (cortana) win.akTracking = { trackEvent: (...a) => { cortanaCalls.push(JSON.parse(JSON.stringify(a))); } };
  if (fhPv !== undefined) win.__fhPv = fhPv;
  win.self = win;
  win.top = framed ? {} : win;
  win.document = document;

  function FakeDate(value) {
    const millis = value == null ? clock.now : value;
    return { getTime: () => millis, toISOString: () => new Date(millis).toISOString() };
  }
  class Blob { constructor(parts) { this.text = parts.join(""); } }

  const fetchCalls = [];
  const fetchFn = (url) => {
    fetchCalls.push(String(url));
    return fetchJson === undefined
      ? { catch() {} }
      : Promise.resolve({ ok: true, json: () => Promise.resolve(fetchJson) });
  };
  win.fetch = fetchFn;

  const context = {
    window: win, document, location: win.location, navigator: win.navigator, sessionStorage,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    Blob, fetch: fetchFn, Date: FakeDate,
    JSON, Math, String, Number, Array, Object, parseInt, isFinite, Error,
  };

  const page = {
    win, document, body, html, store, calls, sent, valueReads, clock, observed, fbqCalls, cortanaCalls, fetchCalls,
    node,
    /** Parse every send. */
    bodies: () => sent.map((s) => JSON.parse(s.text)),
    /** Track sends for one event name. */
    events: (name) => page.bodies().filter((b) => b.event === name),
    /** Add nodes under <body> (or a given parent). */
    add(...nodes) { body.append(...nodes); return page; },
    /** Parse markup (see parseMarkup) and add its nodes under <body> (or a given parent). Returns them. */
    addHtml(markup, parent = body) {
      const kids = parseMarkup(markup);
      parent.append(...kids);
      return kids;
    },
    run() {
      vm.runInNewContext(SRC, context);
      return page;
    },
    /** Run another real script (a card script) in this same page, after run(). */
    runScript(src) {
      vm.runInNewContext(src, context);
      return page;
    },
    fireDoc(name, target, extra = {}) {
      for (const fn of docListeners[name] || []) fn({ type: name, target, ...extra });
    },
    fireWin(name, extra = {}) {
      for (const fn of winListeners[name] || []) fn({ type: name, ...extra });
    },
    click(target) { page.fireDoc("click", target); },
    /** Run every timer due within ms, moving the clock forward. */
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        clock.now = Math.max(clock.now, t.at);
        t.fn();
      }
      clock.now = end;
    },
    flush() { page.advance(0); },
    scrollTo(y) { win.pageYOffset = y; page.fireDoc("scroll", document); page.advance(200); },
    hide() { document.visibilityState = "hidden"; page.fireDoc("visibilitychange", document); },
    show() { document.visibilityState = "visible"; page.fireDoc("visibilitychange", document); },
    /** Tell the fake IntersectionObserver that el is ratio-visible with h px on screen. */
    see(el, { ratio = 1, height = el.rect.height * ratio } = {}) {
      if (!observed.has(el) || !ioCallback) return;
      ioCallback([{ target: el, intersectionRatio: ratio, isIntersecting: ratio > 0, intersectionRect: { height }, boundingClientRect: { height: el.rect.height } }]);
    },
    docListenerNames: () => Object.keys(docListeners),
  };
  return page;
}
