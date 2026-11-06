import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const clientSource = fs.readFileSync(new URL("../../public/app/client-ios.js", import.meta.url), "utf8");
const shellSource = fs.readFileSync(new URL("../../public/app/shell.js", import.meta.url), "utf8");
const sensitiveQuery = "?client_id=00000000-0000-4000-8000-000000000002&email=e2e%40example.com&t=private-link#private-file";

// A small DOM fixture executes the actual account builders and session gates.
// Browser/layout proof is separate; these tests check behavior, not source text.
function browser({ client = true, publicEntry = false, role = "client", ua = "", token = "private-session" } = {}) {
  const listeners = new Map();
  const navigations = [];
  const requests = [];
  const storage = new Map([["fh_token", token], ["fh_role", role], ["fh_client", "00000000-0000-4000-8000-000000000002"]]);
  const current = new URL("https://fundhub.ai/app/" + (client ? "client-portal.html" : "pipeline.html") + sensitiveQuery);
  let resolveSession;
  const sessionReply = new Promise(resolve => { resolveSession = resolve; });
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.children = []; this.attrs = new Map();
      this.style = { setProperty() {} }; this.events = new Map(); this.parentNode = null; this._text = "";
      this.classList = {
        contains: value => this.className.split(/\s+/).includes(value),
        add: (...values) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(values))].join(" "); },
        remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(" "); }
      };
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get href() { return new URL(this.getAttribute("href") || "", current).href; }
    set href(value) { this.setAttribute("href", value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get firstChild() { return this.children[0] || null; }
    get parentElement() { return this.parentNode; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    appendChild(node) { node.parentNode?.removeChild(node); this.children.push(node); node.parentNode = this; return node; }
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; }
    insertBefore(node, before) {
      if (!before) return this.appendChild(node);
      node.parentNode?.removeChild(node); this.children.splice(this.children.indexOf(before), 0, node); node.parentNode = this;
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      const simple = selector.trim().split(/[ >]+/).pop();
      const tag = simple.match(/^[a-z][\w-]*/i)?.[0];
      const id = simple.match(/#([\w-]+)/)?.[1];
      const classes = [...simple.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
      const attr = simple.match(/\[([\w-]+)(?:([*$]?=)["']?([^"'\]]*)["']?)?\]/);
      return (!tag || this.tagName === tag.toUpperCase()) && (!id || this.id === id) &&
        classes.every(value => this.classList.contains(value)) &&
        (!attr || (this.hasAttribute(attr[1]) && (!attr[2] || (attr[2] === "$=" ? this.getAttribute(attr[1]).endsWith(attr[3]) : this.getAttribute(attr[1]) === attr[3]))));
    }
    querySelectorAll(selector) {
      const found = [];
      for (const child of this.children) {
        if (selector.split(",").some(part => child.matches(part))) found.push(child);
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    addEventListener(type, handler) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(handler); }
    focus() { document.activeElement = this; }
    click() {
      const event = { target: this, currentTarget: this, button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      for (const handler of this.events.get("click") || []) handler(event);
      for (const handler of listeners.get("click") || []) handler(event);
      if (this.tagName === "A" && !event.defaultPrevented) navigations.push(this.href);
      return event;
    }
    set innerHTML(html) {
      this.children = []; this._text = "";
      const stack = [this];
      for (const match of String(html).matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>|([^<]+)/gi)) {
        if (match[4]) { stack.at(-1)._text += match[4]; continue; }
        if (match[1]) { if (stack.length > 1) stack.pop(); continue; }
        const node = new Element(match[2]);
        for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)) node.setAttribute(attr[1], attr[2] ?? attr[3] ?? "");
        stack.at(-1).appendChild(node);
        if (!/\/$/.test(match[3]) && !/^(input|img|br|link|meta)$/i.test(match[2])) stack.push(node);
      }
    }
  }
  document = {
    readyState: "complete", hidden: false,
    createElement: tag => new Element(tag),
    getElementById: id => document.documentElement.querySelector("#" + id),
    querySelector: selector => document.documentElement.querySelector(selector),
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); }
  };
  document.documentElement = new Element("html");
  document.head = new Element("head"); document.body = new Element("body");
  document.documentElement.append(document.head, document.body);
  if (client) document.body.setAttribute("data-client-page", "portal");
  if (publicEntry) document.body.setAttribute("data-client-public", "");
  const header = new Element("header"); header.className = "topbar";
  if (!client) {
    header.id = "fh-workspace-header";
    const tools = new Element("div"); tools.className = "fh-workspace-tools"; header.appendChild(tools);
  }
  document.body.appendChild(header);
  const location = { pathname: current.pathname, search: current.search,
    get href() { return current.href; }, set href(value) { navigations.push(value); },
    replace(value) { navigations.push(value); } };
  const sandbox = {
    document, location, navigator: { userAgent: ua }, URL, URLSearchParams,
    console, setTimeout: () => 0, setInterval: () => 0,
    MutationObserver: class { observe() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "/api/auth/session") return sessionReply;
      if (url === "/api/read/affiliate-portal") return { ok: true, json: async () => ({ ok: true, enrolled: false }) };
      if (url === "/api/auth/logout") return { ok: true };
      throw new Error("Unexpected request: " + url);
    },
    addEventListener() {}, FHChat: {},
    matchMedia: () => ({ matches: false })
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  return { document, header, sandbox, storage, requests, navigations, resolveSession,
    links: () => document.querySelectorAll("[data-fh-device-entry]"),
    async settle(session, ok = true) {
      resolveSession({ ok, json: async () => session });
      for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
    },
    runClient() { vm.runInNewContext(clientSource, sandbox, { filename: "client-ios.js" }); },
    runShell() {
      // Keep real getSession(), pass1/pass2, mountChip(), account builder and
      // click gates; isolate unrelated sidebar/search/brand/provider widgets.
      const chromeFixtures = `
        mountSidebar = watchWideTables = mountSearch = mountSopShortcut = mountBetaBanner = layoutShellChrome = applyBrand = mountChatWidget = wireAvatarUpload = wireStaffPayoutBank = function () {};
        mountWorkspaceHeader = function () { return document.getElementById('fh-workspace-header'); };
        placeInHeader = function (el) { document.querySelector('.fh-workspace-tools').appendChild(el); };
        backendState = function () { return Promise.resolve({code:'live',label:'LIVE',hint:'Fixture'}); };
      `;
      vm.runInNewContext(shellSource.replace("(function () {", "(function () {" + chromeFixtures), sandbox, { filename: "shell.js" });
    }
  };
}

function checkDeviceLink(env, menu) {
  assert.equal(env.links().length, 1, "one account-menu entry is rendered");
  const link = env.links()[0];
  assert.ok(menu.contains(link), "entry stays inside the existing account menu");
  assert.equal(link.textContent, "Add another device");
  assert.equal(link.getAttribute("href"), "/devices.html");
  assert.equal(link.getAttribute("target"), null, "ordinary same-window navigation works in native WebViews");
  const before = env.requests.length;
  const event = link.click();
  assert.equal(event.defaultPrevented, false, "the existing screen gate permits the public tool");
  assert.equal(env.navigations.at(-1), "https://fundhub.ai/devices.html", "no current query, file ID or session crosses devices");
  assert.equal(env.requests.length, before, "entry causes no API write or account action");
  assert.equal(env.storage.get("fh_token"), "private-session", "opening device setup preserves sign-in");
  return link;
}

for (const ua of ["iPhone Safari", "Macintosh Safari", "Android FBAN/FB4A", "Windows Chrome"]) {
  test(`verified client account offers the public device tool: ${ua}`, async () => {
    const env = browser({ ua }); env.runClient();
    assert.equal(env.links().length, 0, "no menu entry from cached identity before session verification");
    await env.settle({ ok: true, principal: "client", staff: { name: "Fixture client" } });
    checkDeviceLink(env, env.document.querySelector(".client-ios-account-panel"));
    const signout = env.document.querySelector(".client-ios-signout");
    assert.equal(signout.textContent, "Sign out", "existing sign-out remains available");
  });
}

for (const session of [null, { ok: false }, { ok: true, principal: "staff", staff: { role: "owner" } }]) {
  test(`client menu requires an actual client session: ${JSON.stringify(session)}`, async () => {
    const env = browser(); env.runClient(); await env.settle(session);
    assert.equal(env.links().length, 0);
    assert.equal(env.document.querySelector(".client-ios-account"), null);
  });
}

test("public sign-in pages gain no signed-in device account menu", () => {
  const env = browser({ publicEntry: true }); env.runClient();
  assert.equal(env.links().length, 0);
  assert.equal(env.requests.length, 0, "public-entry behavior does not start a session read");
});

for (const role of ["owner", "setter", "closer", "csm"]) {
  test(`verified ${role} account offers the same public device tool`, async () => {
    const env = browser({ client: false, role }); env.runShell();
    assert.equal(env.links().length, 0, "cached staff role alone does not create the control");
    await env.settle({ ok: true, staff: { id: "staff-fixture", name: "Fixture staff", role } });
    checkDeviceLink(env, env.document.querySelector(".fh-account-menu"));
    assert.equal(env.document.getElementById("fh-shell-out").textContent, "Sign out");
  });
}

test("a rejected staff session cannot create an account-menu entry from a cached role", async () => {
  const env = browser({ client: false, role: "owner" }); env.runShell();
  await env.settle({ ok: false }, false);
  assert.equal(env.links().length, 0);
  assert.ok(env.navigations.some(url => url.startsWith("/login.html")), "normal signed-out redirect remains");
});

test("a local demo identity is not mistaken for a verified device-menu session", async () => {
  const env = browser({ client: false, role: "owner" });
  env.storage.set("fh_demo_staff", JSON.stringify({ id: "demo", name: "Sample owner", role: "owner" }));
  env.runShell(); await env.settle({ ok: false }, false);
  assert.equal(env.links().length, 0);
  assert.ok(env.document.querySelector(".fh-account-menu"), "the existing demo account menu still works");
});
