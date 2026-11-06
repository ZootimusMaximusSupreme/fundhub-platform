// Portal pre-call chat widget — auto-open greeting, persist via portal-message.
//
// Lives under src/ because package.json's test glob does not walk public/.
// The widget is an IIFE; we execute it in a stub browser like
// src/http/app-client-carry.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const WIDGET_SRC = fs.readFileSync(path.join(APP, "chat-widget.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const ASK_SRC = fs.readFileSync(path.resolve(HERE, "../../api/chat/ask.mjs"), "utf8");

const GREETING =
  "Your call is coming up. Any questions you want us to know before we talk? Type them here and your advisor will see them.";

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    _id: "",
    className: "",
    type: "",
    textContent: "",
    _html: "",
    children: [],
    style: {},
    dataset: {},
    onclick: null,
    onkeydown: null,
    onchange: null,
    value: "",
    scrollTop: 0,
    scrollHeight: 0,
    focus() {},
    _attrs: {},
    classList: {
      _on: new Set(),
      add(c) {
        this._on.add(c);
        node.className = [...this._on].join(" ");
      },
      remove(c) {
        this._on.delete(c);
        node.className = [...this._on].join(" ");
      },
      contains(c) {
        return this._on.has(c);
      },
      toggle(c) {
        if (this._on.has(c)) this.remove(c);
        else this.add(c);
      }
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] || null; },
    querySelectorAll() { return []; },
    appendChild(child) {
      this.children.push(child);
      return child;
    }
  };
  Object.defineProperty(node, "id", {
    get() { return this._id; },
    set(v) {
      this._id = String(v || "");
      if (this._id && node._register) node._register(this._id, node);
    }
  });
  Object.defineProperty(node, "innerHTML", {
    get() { return this._html; },
    set(v) {
      this._html = String(v);
      this.children = [];
      const re = /<(\w+)([^>]*)>/g;
      let m;
      while ((m = re.exec(this._html))) {
        const child = makeNode(m[1]);
        child._register = node._register;
        const idM = /id="([^"]+)"/.exec(m[2] || "");
        if (idM) child.id = idM[1];
        const typeM = /type="([^"]+)"/.exec(m[2] || "");
        if (typeM) child.type = typeM[1];
        this.children.push(child);
      }
    }
  });
  return node;
}

function mountInVm(opts, { token = "real-token", fetchImpl } = {}) {
  const byId = new Map();
  const fetches = [];
  const timers = [];
  const register = (id, el) => { byId.set(id, el); };
  const body = makeNode("body");
  body._register = register;
  const head = makeNode("head");
  head._register = register;

  const sandbox = {
    window: null,
    document: {
      head,
      documentElement: head,
      body,
      createElement(tag) {
        const el = makeNode(tag);
        el._register = register;
        return el;
      },
      getElementById(id) { return byId.get(id) || null; }
    },
    localStorage: {
      getItem(k) { return k === "fh_token" ? token : ""; }
    },
    location: { href: "https://fundhub.ai/app/client-portal.html" },
    setTimeout(fn, ms) {
      timers.push({ fn, ms: Number(ms) || 0 });
      return timers.length;
    },
    setInterval(fn, ms) {
      timers.push({ fn, ms: Number(ms) || 0, interval: true });
      return timers.length;
    },
    clearInterval() {},
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (fetchImpl) return fetchImpl(url, init);
      return Promise.resolve({ json: async () => ({ ok: true, conversation_id: "c1", messages: [] }) });
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(WIDGET_SRC, sandbox, { filename: "chat-widget.js" });
  sandbox.FHChat.mount(opts);
  return {
    sandbox,
    byId,
    fetches,
    timers,
    flushTimers() {
      const queued = timers.splice(0, timers.length);
      for (const t of queued) t.fn();
    },
    panel: byId.get("fh-chat-panel"),
    bodyEl: byId.get("fh-chat-body"),
    send() {
      const input = byId.get("fh-chat-input");
      const btn = byId.get("fh-chat-send");
      input.value = "Can we start 10 minutes late";
      btn.onclick();
    }
  };
}

describe("pre-call chat widget", () => {
  test("greeting is plain, no bang, no credit promise", () => {
    assert.equal(WIDGET_SRC.includes(GREETING), true);
    assert.equal(GREETING.includes("!"), false);
    assert.doesNotMatch(GREETING, /credit|score|guarantee|improve|approved/i);
  });

  test("portal still posts replies to /api/chat/portal-message", () => {
    assert.match(WIDGET_SRC, /\/api\/chat\/portal-message/);
  });

  test("portal modes do not include Company Brain ask", () => {
    const portalModes = WIDGET_SRC.match(/var modes = isPortal\s*\?\s*(\[[\s\S]*?\])\s*:/);
    assert.ok(portalModes, "portal modes list missing");
    assert.match(portalModes[1], /Message staff/);
    assert.doesNotMatch(portalModes[1], /knowledge|Ask system|Company Brain/i);
  });

  test("/api/chat/ask stays staff-gated", () => {
    assert.match(ASK_SRC, /requireRole\(res, staff, ROLE_SETS\.STAFF\)/);
  });

  test("shell passes hadCall from the session onto FHChat.mount", () => {
    assert.match(SHELL_SRC, /staff && staff\.had_call/);
    assert.match(SHELL_SRC, /hadCall:\s*hadCall/);
    assert.match(SHELL_SRC, /autoOpenPrecall:\s*isPortal && !hadCall/);
  });

  test("shell portal mode is role=client only — not every visit to client-portal.html", () => {
    assert.match(SHELL_SRC, /var isPortal = role === "client"/);
    assert.doesNotMatch(
      SHELL_SRC,
      /isPortal = role === "client" \|\| PAGE === "client-portal\.html"/,
      "staff on client-portal must not get portal chat (403 on portal-message)"
    );
  });

  test("stays closed on first paint, then pops open after login", async () => {
    const ui = mountInVm({
      portal: true, hadCall: false, autoOpenPrecall: true, popAfterMs: 1400
    });
    assert.equal(ui.panel.classList.contains("open"), false, "not already open on login");
    assert.equal(ui.timers.some((t) => t.ms === 1400), true);
    ui.flushTimers();
    assert.equal(ui.panel.classList.contains("open"), true);
    await Promise.resolve();
    assert.equal(
      ui.fetches.some((f) => f.url === "/api/chat/portal-message" && !(f.init && f.init.method)),
      true,
      "portal opens by GETting the thread"
    );
    assert.ok(!ui.fetches.some((f) => f.init && f.init.method === "POST"), "greeting is local — do not POST it");
  });

  test("does not auto-open after they have been on a call", () => {
    const ui = mountInVm({ portal: true, hadCall: true, autoOpenPrecall: false });
    assert.equal(ui.panel.classList.contains("open"), false);
    assert.equal(ui.timers.length, 0);
    const texts = ui.bodyEl.children.map((c) => c.innerHTML).join(" ");
    assert.equal(texts.includes(GREETING), false);
    assert.match(texts, /Message your Fundhub team/);
  });

  test("unknown hadCall on a portal mount still pops open after a beat", () => {
    const ui = mountInVm({ portal: true, demo: true });
    assert.equal(ui.panel.classList.contains("open"), false);
    ui.flushTimers();
    assert.equal(ui.panel.classList.contains("open"), true);
    const texts = ui.bodyEl.children.map((c) => c.innerHTML).join(" ");
    assert.equal(texts.includes(GREETING), true);
  });

  test("a signed-in portal reply POSTs /api/chat/portal-message", () => {
    const ui = mountInVm({ portal: true, hadCall: false, demo: false });
    ui.send();
    const post = ui.fetches.find((f) => f.init && f.init.method === "POST");
    assert.ok(post, "portal send POSTs");
    assert.equal(post.url, "/api/chat/portal-message");
    const body = JSON.parse(post.init.body);
    assert.equal(body.body, "Can we start 10 minutes late");
    assert.ok(!ui.fetches.some((f) => String(f.url).includes("/api/chat/ask")));
  });

  test("staff Message loads the thread via existing GET", () => {
    assert.match(WIDGET_SRC, /\/api\/chat\/messages\?conversation_id=/);
    assert.match(WIDGET_SRC, /\/api\/chat\/messages\?kind=internal/);
    assert.match(WIDGET_SRC, /loadInternalThread/);
  });

  test("portal Message loads the thread via GET /api/chat/portal-message", () => {
    assert.match(WIDGET_SRC, /function loadPortalThread/);
    assert.match(WIDGET_SRC, /api\("\/api\/chat\/portal-message"\)/);
  });

  test("portal open GETs the thread before any send", async () => {
    const ui = mountInVm({ portal: true, hadCall: true, autoOpenPrecall: false, demo: false });
    ui.byId.get("fh-chat-fab").onclick();
    await Promise.resolve();
    assert.equal(ui.fetches[0].url, "/api/chat/portal-message");
    assert.ok(!(ui.fetches[0].init && ui.fetches[0].init.method === "POST"));
  });

  test("demo portal does not fetch on send", () => {
    const ui = mountInVm({ portal: true, demo: true, hadCall: false }, { token: "demo" });
    ui.send();
    assert.equal(ui.fetches.length, 0);
  });
});
