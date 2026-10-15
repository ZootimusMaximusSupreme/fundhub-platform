// Finish-853 batch 10: the live check for display rows whose control is a link that the app's own link gate
// can hide. It is used by the display lane (gap-catalog-display.mjs) for contracts with mode "link-gate".
//
// THE RESULT BEING JUDGED. A link on a screen is useless if public/app/shell.js hides it from the people it
// is for, or if the page no longer carries it, or if it points somewhere else. The gate that decides is the
// shell people load, so this check does not re-do the shell's arithmetic: it RUNS the deployed shell.
//
//   1. GET /app/shell.js and GET /app/client-control-panel.html from the live site (two plain GETs).
//   2. Lift every link out of the deployed page (id, address, and the boxes it sits in).
//   3. For each staff role, run the deployed shell.js inside an isolated vm context with a small stand-in
//      page: the role's session answers, the page's own links are the links on the page, and the shell's
//      "DOMContentLoaded" callbacks run. The real gateLinks() then hides or keeps each link, and the real
//      click guard decides whether a press on it is allowed. Both outcomes are read back.
//   4. Judge the contract: each named link must be on the page, point at its screen, and be shown and
//      pressable for every role the contract names.
//
// Because the real code runs, a gate that hides a link in code (not only in a list) is seen, and so is a
// list the check was never told about. It is red the day a link is hidden from a role that must see it, and
// green by itself the day the gate lets it through.
//
// HONEST STATUS. A GET that fails, a non-200 answer, a page that is not the control panel, a shell that
// throws, or a shell that does not finish gating the links is "skip" with the reason. Never PASS, and never a
// made-up FAIL. The run is also checked for completion: every link of the stand-in page must carry the
// shell's own "seen" mark, the session branch must have run, and the shell's gate style must be gone.
//
// ISOLATION. The deployed file is the company's own shell, fetched over HTTPS from the company's own site.
// It still runs with two walls round it. Inside, a fresh vm context with a null-prototype global: every
// stand-in (document, location, storage, fetch, timers) is created INSIDE the context from a script, nothing
// but strings crosses the boundary, each script has a time limit, timers are no-ops, and fetch answers only
// the session door from a canned string. Outside, the whole run lives in a worker thread with a memory cap
// and a hard stop (the caller waits for the thread to be gone), so a shell that hangs, spins, or rejects a
// promise nobody catches ends inside that thread and cannot take the pulse down with it.
//
// READ ONLY. Two GETs, no cookies, no body, no write, no send. This file reads no repo file at run time.

import { Worker } from "node:worker_threads";

/** The staff roles the app has. A contract names the ones that must see a link. */
export const STAFF_ROLES = Object.freeze([
  "owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist",
]);

export const SHELL_PATH = "/app/shell.js";
export const PANEL_PATH = "/app/client-control-panel.html";
/** Only its shape matters (the shell carries a client when the address names a real-looking uuid). */
const STAND_IN_CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";

/** The screen file an address points at (query, hash and leading path stripped), or "". */
export function screenOfHref(href) {
  let h = String(href == null ? "" : href).replace(/^\.\//, "");
  h = h.split("#")[0].split("?")[0];
  if (h.charAt(0) === "/" && h.lastIndexOf("/app/", 0) !== 0) return "";
  h = h.slice(h.lastIndexOf("/") + 1);
  return /^[a-z0-9-]+\.html$/i.test(h) ? h : "";
}

const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);

/**
 * Every <a href> of an HTML page: its attributes and the tags it sits inside (name and class, outermost
 * first). Comments, <script> and <style> bodies are skipped, so a link inside prose or a template string is
 * not a link of the page.
 */
export function parsePageAnchors(html) {
  const text = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  while ((m = tag.exec(text))) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!closing && (name === "script" || name === "style")) {
      const end = text.toLowerCase().indexOf(`</${name}`, tag.lastIndex);
      tag.lastIndex = end < 0 ? text.length : end;
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    const cls = String(attrs.class || "");
    if (name === "a" && Object.hasOwn(attrs, "href")) {
      out.push({ id: attrs.id || "", href: attrs.href, cls, hidden: Object.hasOwn(attrs, "hidden"),
        ancestors: stack.map((s) => ({ name: s.name, cls: s.cls })) });
    }
    if (!(m[0].endsWith("/>") || VOID.has(name))) stack.push({ name, cls });
  }
  return out;
}

// The stand-in browser. It runs INSIDE the context, so every function the shell can reach was made there.
const BOOT = `
(function (G) {
  var H = { anchors: [], docL: {}, winL: {}, head: null, replaced: null, session: null };
  G.__fh = H;
  function listen(map) { return function (type, fn) { (map[type] = map[type] || []).push(fn); }; }
  function El(tag) {
    var self = this;
    this.tagName = String(tag || "div").toUpperCase();
    this.attrs = {};
    this.style = { cssText: "", display: "" };
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.id = "";
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.classList = {
      contains: function (c) { return (" " + self.className + " ").indexOf(" " + c + " ") !== -1; },
      add: function (c) { if (!self.classList.contains(c)) self.className = (self.className + " " + c).trim(); },
      remove: function (c) { self.className = (" " + self.className + " ").split(" " + c + " ").join(" ").trim(); },
      toggle: function () {}
    };
  }
  El.prototype.setAttribute = function (k, v) {
    this.attrs[k] = String(v);
    if (k === "id") this.id = String(v);
    if (k === "class") this.className = String(v);
  };
  El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
  El.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); };
  El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
  El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
  El.prototype.insertBefore = function (c) { c.parentNode = this; this.children.push(c); return c; };
  El.prototype.removeChild = function (c) { c.parentNode = null; return c; };
  El.prototype.remove = function () { this.parentNode = null; };
  El.prototype.addEventListener = function () {};
  El.prototype.removeEventListener = function () {};
  El.prototype.querySelector = function () { return null; };
  El.prototype.querySelectorAll = function () { return []; };
  El.prototype.matches = function (sel) {
    if (sel === "li") return this.tagName === "LI";
    if (sel === ".card") return this.classList.contains("card");
    if (sel === "a[href]") return this.tagName === "A" && this.hasAttribute("href");
    return false;
  };
  El.prototype.closest = function (sel) {
    for (var n = this; n; n = n.parentNode) if (n.matches && n.matches(sel)) return n;
    return null;
  };
  H.El = El;

  var head = new El("head");
  H.head = head;
  G.document = {
    readyState: "loading",
    head: head,
    documentElement: new El("html"),
    body: new El("body"),
    cookie: "",
    addEventListener: listen(H.docL),
    removeEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) { return sel === "a[href]" ? H.anchors.slice() : []; },
    createElement: function (t) { return new El(t); },
    createTextNode: function (t) { var e = new El("#text"); e.textContent = String(t); return e; }
  };
  G.window = G;
  G.self = G;
  G.addEventListener = listen(H.winL);
  G.removeEventListener = function () {};
  G.dispatchEvent = function () { return true; };
  G.getComputedStyle = function () { return { display: "block", flexDirection: "row" }; };
  G.requestAnimationFrame = function () { return 0; };
  G.cancelAnimationFrame = function () {};
  G.setTimeout = function () { return 0; };
  G.clearTimeout = function () {};
  G.setInterval = function () { return 0; };
  G.clearInterval = function () {};
  var store = {};
  G.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  G.sessionStorage = G.localStorage;
  G.navigator = { userAgent: "fundhub-link-gate-check", onLine: true, clipboard: null };
  G.history = { replaceState: function () {}, pushState: function () {} };
  G.matchMedia = function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; };
  G.Event = function (type) { this.type = type; };
  G.CustomEvent = G.Event;
  G.MutationObserver = undefined;
  G.IntersectionObserver = undefined;
  G.console = { log: function () {}, warn: function () {}, error: function () {}, info: function () {}, debug: function () {} };
  // Only the session door is answered, from a canned string. Every other door answers "not ok".
  G.fetch = function (url) {
    var asked = String(url);
    var body = asked.indexOf("/api/auth/session") !== -1 ? JSON.parse(H.session) : { ok: false };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  };
})(this);
`;

// Build the stand-in page and the signed-in session for one role. The role is NOT cached as a hint, so the
// shell's authoritative session branch is the one that gates (the first load of a real visit).
const SETUP = `
(function () {
  var H = __fh;
  var input = JSON.parse(__in);
  H.session = JSON.stringify({ ok: true, staff: { id: "stand-in", name: "Stand In", email: "stand-in@example.test",
    role: input.role, org_id: "stand-in-org", status: "active" } });
  input.anchors.forEach(function (row) {
    var a = new H.El("a");
    a.setAttribute("href", row.href);
    if (row.id) a.setAttribute("id", row.id);
    if (row.cls) a.setAttribute("class", row.cls);
    if (row.hidden) { a.setAttribute("hidden", ""); a.hidden = true; }
    var parent = null;
    row.ancestors.forEach(function (p) {
      var e = new H.El(p.name);
      e.className = p.cls;
      e.parentNode = parent;
      parent = e;
    });
    a.parentNode = parent;
    H.anchors.push(a);
  });
  var path = input.path;
  var search = "?id=" + input.clientId;
  globalThis.location = {
    pathname: path, search: search, hash: "", origin: "https://stand-in.example.test",
    href: "https://stand-in.example.test" + path + search,
    replace: function (u) { H.replaced = String(u); },
    assign: function (u) { H.replaced = String(u); },
    reload: function () {}
  };
  localStorage.setItem("fh_token", "stand-in-token");
})();
`;

// After the shell has run (and its promises have settled): fire the callbacks it queued for "DOMContentLoaded"
// the way a page does, press every link of the page once through the shell's click guard, and read it all out.
const FIRE = `
(function () {
  var H = __fh;
  var errors = [];
  (H.docL.DOMContentLoaded || []).forEach(function (fn) {
    try { fn(); } catch (e) { errors.push(String((e && e.message) || e)); }
  });
  var clicks = H.docL.click || [];
  function press(a) {
    var blocked = false;
    var ev = { type: "click", button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, target: a, preventDefault: function () { this.defaultPrevented = true; blocked = true; } };
    clicks.forEach(function (fn) { try { fn(ev); } catch (e) { errors.push(String((e && e.message) || e)); } });
    return blocked;
  }
  var links = [];
  var visited = 0;
  H.anchors.forEach(function (a) {
    if (a.hasAttribute("data-fh-href")) visited += 1;
    if (!a.id) return;
    var box = a.closest("li") || a.closest(".card") || a;
    var shown = box.style.display !== "none" && box.hidden !== true && !box.hasAttribute("data-fh-gated") && a.hidden !== true;
    links.push({ id: a.id, href: a.getAttribute("href"), shown: shown, blocked: press(a) });
  });
  var gateStyleLeft = H.head.children.some(function (c) { return c.id === "fh-gate-style" && c.parentNode !== null; });
  globalThis.__out = JSON.stringify({
    links: links, errors: errors, replaced: H.replaced,
    visited: visited, total: H.anchors.length, gateStyleLeft: gateStyleLeft,
    sessionRan: localStorage.getItem("fh_role") === __role,
    // signOut() is what the shell does with a role that has no screens at all: it drops the token.
    signedOut: localStorage.getItem("fh_token") === null,
    listeners: (H.docL.DOMContentLoaded || []).length
  });
})();
`;

// The worker's program (CommonJS, run with `eval: true`). It runs each role in its own fresh context and
// posts one plain object back: { [role]: { ok: true, value } | { ok: false, error } }.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

function runOne(role) {
  // A null-prototype sandbox object, on purpose: a plain {} is a host object, and from inside the context
  // this.constructor.constructor("return process")() would walk up to the host's Function. With no
  // prototype the lookup falls through to the context's own Object, so every constructor it can reach is the
  // context's, and the context has no process and no require.
  const context = vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate" });
  context.__in = JSON.stringify({ anchors: workerData.anchors, role, path: workerData.path, clientId: workerData.clientId });
  context.__role = String(role);
  let out;
  try {
    vm.runInContext(workerData.boot, context, { timeout: 1000 });
    vm.runInContext(workerData.setup, context, { timeout: 1000 });
    vm.runInContext(String(workerData.shell), context, { timeout: 3000 });
    vm.runInContext(workerData.fire, context, { timeout: 3000 });
    out = JSON.parse(context.__out);
  } catch (error) {
    throw new Error("the deployed shell could not be run for " + role + ": " + String((error && error.message) || error).replace(/\s+/g, " ").slice(0, 140));
  }
  if (out.replaced) return { links: [], replaced: "away" };
  if (out.signedOut) return { links: [], replaced: "signed-out" };
  if (!out.sessionRan) throw new Error("the deployed shell did not take the session branch for " + role);
  if (out.total > 0 && out.visited !== out.total) {
    throw new Error("the deployed shell gated only " + out.visited + " of " + out.total + " links of the page for " + role);
  }
  if (out.gateStyleLeft) throw new Error("the deployed shell did not finish gating for " + role);
  return { links: out.links, replaced: null };
}

const results = {};
for (const role of workerData.roles) {
  try { results[role] = { ok: true, value: runOne(role) }; }
  catch (error) {
    // All or nothing: one role that cannot be judged makes the whole answer unusable, so stop here.
    results[role] = { ok: false, error: String((error && error.message) || error) };
    break;
  }
}
parentPort.postMessage(results);
`;

function inWorker(payload, timeoutMs, onWorker) {
  return new Promise((resolve, reject) => {
    let worker;
    let timer = null;
    let done = false;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      // The answer (or the failure) is handed back only once the thread is gone.
      const gone = worker ? worker.terminate().catch(() => {}) : Promise.resolve();
      gone.then(() => settle(value));
    };
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: payload, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    } catch (error) {
      reject(new Error(`the deployed shell could not be started in a worker: ${String(error?.message || error).slice(0, 120)}`));
      return;
    }
    if (typeof onWorker === "function") onWorker(worker);
    timer = setTimeout(() => finish(reject, new Error("the deployed shell run took too long and was stopped")), timeoutMs);
    worker.once("message", (message) => finish(resolve, message));
    worker.once("error", (error) => finish(reject, new Error(`the deployed shell run failed: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 120)}`)));
    worker.once("exit", (code) => finish(reject, new Error(`the deployed shell run ended early (exit ${code})`)));
  });
}

/**
 * Run a shell.js source against a page's links, once per role, each in a fresh isolated context inside one
 * worker. Resolves { [role]: { links: [{ id, href, shown, blocked }], replaced } } where replaced is null,
 * "away" (the role is sent to another screen) or "signed-out" (the role has no screens at all). Rejects with
 * a plain reason when the shell could not be run, or did not finish gating the stand-in page, for any role.
 * onWorker (a test seam) is handed the Worker the moment it exists.
 */
export async function runDeployedGates({ shell, anchors, roles = STAFF_ROLES, path = PANEL_PATH, clientId = STAND_IN_CLIENT, timeoutMs = 12000, onWorker = null }) {
  const answer = await inWorker({
    shell: String(shell), anchors, roles: [...roles], path, clientId,
    boot: BOOT, setup: SETUP, fire: FIRE,
  }, timeoutMs, onWorker);
  const out = {};
  for (const role of roles) {
    const one = answer?.[role];
    if (!one) throw new Error(`the deployed shell was not run for ${role}`);
    if (!one.ok) throw new Error(one.error);
    out[role] = one.value;
  }
  return out;
}

/**
 * Both deployed files, then the gate for every staff role. Resolves
 * { shellUrl, pageUrl, anchors, roles: { role: { replaced, links: { id: { href, shown, blocked } } } } }
 * or { error }. GET only, redirects not followed. ctx.fetchImpl and ctx.baseUrl are the same two knobs the
 * retired-page check in the display lane uses. Never throws.
 */
export async function linkGateState(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return { error: "this run has no GET client" };
  let origin;
  try { origin = new URL(ctx.baseUrl || "https://fundhub.ai").origin; } catch (error) {
    return { error: `the deployed shell could not be read by GET: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 120)}` };
  }
  const get = async (path, what) => {
    const url = `${origin}${path}`;
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (response.status !== 200) return { error: `the deployed ${what} answered ${response.status}` };
      return { url, text: await response.text() };
    } catch (error) {
      return { error: `the deployed ${what} could not be read by GET: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 120)}` };
    }
  };
  const [shell, page] = await Promise.all([get(SHELL_PATH, "shell"), get(PANEL_PATH, "Client Control Panel")]);
  if (shell.error) return { error: shell.error };
  if (page.error) return { error: page.error };
  if (!/<script\b[^>]*\bsrc=["']shell\.js[\s"'?]/i.test(page.text)) {
    return { error: "the deployed Client Control Panel does not load the link gate (shell.js), so this check cannot judge its links" };
  }
  const anchors = parsePageAnchors(page.text);
  if (!anchors.length) return { error: "the deployed Client Control Panel has no links the check can read" };
  const roles = {};
  try {
    const ran = await runDeployedGates({ shell: shell.text, anchors });
    for (const role of STAFF_ROLES) {
      roles[role] = {
        replaced: ran[role].replaced,
        links: Object.fromEntries(ran[role].links.map((l) => [l.id, { href: l.href, shown: l.shown, blocked: l.blocked }])),
      };
    }
  } catch (error) {
    return { error: String(error?.message || error).replace(/\s+/g, " ").slice(0, 200) };
  }
  return { shellUrl: shell.url, pageUrl: page.url, anchors, roles };
}

function result(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

const and = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Judge one contract { control, requirement, links: [{ id, file, label, roles }] } against the gate state.
 * PASS only when every named link is on the page, points at its screen, and is shown and pressable for every
 * named role. FAIL names each link and who it is hidden from.
 */
export function judgeLinkGate(entry, gate) {
  const rid = entry.id;
  const control = entry.control;
  const links = entry.contract?.links;
  if (!Array.isArray(links) || !links.length) {
    return result(rid, "skip", `${control}: the contract names no link to judge.`);
  }
  if (!gate || gate.error || !gate.roles || !gate.anchors) {
    return result(rid, "skip", `${control} was not read: ${gate?.error || "the deployed shell was not read"}.`);
  }
  const broken = [];
  for (const link of links) {
    const label = `${link.label} (${link.file})`;
    const onPage = gate.anchors.filter((a) => a.id === link.id);
    if (onPage.length !== 1) {
      broken.push(`${label} is ${onPage.length ? "on the page more than once" : "no longer on the deployed page"} (id ${link.id})`);
      continue;
    }
    const target = screenOfHref(onPage[0].href);
    if (target !== link.file) {
      broken.push(`${label} points at ${target || onPage[0].href || "nothing"} on the deployed page, not at ${link.file}`);
      continue;
    }
    const hidden = [];
    const blocked = [];
    const sentAway = [];
    for (const role of link.roles) {
      const seen = gate.roles[role];
      if (!seen) { hidden.push(role); continue; }
      if (seen.replaced) { sentAway.push(role); continue; }
      const one = seen.links[link.id];
      if (!one || !one.shown) hidden.push(role);
      else if (one.blocked) blocked.push(role);
    }
    const opens = STAFF_ROLES.filter((role) => {
      const seen = gate.roles[role];
      const one = seen && !seen.replaced ? seen.links[link.id] : null;
      return one && one.shown && !one.blocked;
    });
    if (hidden.length) {
      broken.push(`${label} is hidden from ${and(hidden)} (it shows for ${opens.length ? and(opens) : "no staff role"})`);
    }
    if (blocked.length) broken.push(`${label} is shown to ${and(blocked)} but a press on it is blocked`);
    for (const role of sentAway) {
      broken.push(gate.roles[role].replaced === "signed-out"
        ? `${label}: ${role} is signed out by the gate (it has no screens at all)`
        : `${label}: ${role} is sent away from the Client Control Panel before the link can be used`);
    }
  }
  const names = links.map((link) => `${link.label} (${link.file})`).join(", ");
  if (!broken.length) {
    const roles = [...new Set(links.flatMap((link) => link.roles))];
    return result(rid, "PASS", `${control}: the deployed link gate shows and opens ${names} for ${and(roles)}. ${entry.contract.requirement}`);
  }
  return result(
    rid,
    "FAIL",
    `${control}: no person can use the link as the deployed page and gate stand today: ${broken.join("; ")}. Required: ${entry.contract.requirement}`,
    "Fix the link or add the screen to the right role list in public/app/shell.js (the gate hides links to a screen it does not list). Do not auto-fix. Chris fixes reds.",
  );
}
