/* marketing-command-center.js — the Marketing Command Center frame.

   WHAT THIS FILE IS. The frame every Command Center tab sits in (plan unit U34;
   docs/specs/command-center-design-2026-10-05.md §3.0 and §6 slices 0 to 2):
     - the tab strip, in work order (Today · Ideas · Scripts · Shoot · Videos ·
       Launch · Numbers), and Settings behind the gear, top-right, off the strip
       (UI-STANDARDS §8);
     - hash routing: #today, #settings, #numbers/ads (a tab and an optional
       view inside it). A buzz deep-links straight to a tab;
     - the tab registry, window.FHMarketingCCTabs. A tab shows ONLY when its
       script is on the page and registered. A tab with no module does not
       render, so the strip never carries an empty or "coming soon" tab
       (UI-STANDARDS §5);
     - the shared helpers every tab gets as `ctx`: api reads and writes (a write
       carries a fresh request_id), the cost line from GET marketing/costs,
       a toast, plain error sentences, the Arizona clock.
   Each tab lives in its own file and owns its own markup:
     marketing-cc-today.js     Today      (U37 owns it after U34)
     marketing-cc-settings.js  Settings   (the gear)
   The contract a tab file follows is docs/specs/command-center-tabs.md.

   WHAT THE FRAME NEVER DOES. It reads nothing at start. It never adds up a
   count (design §3.0: counts come from one server view). It never spends,
   never turns an ad on, never sends anything to anyone.

   TESTABLE WITHOUT A BROWSER. The registry and every rule below are plain
   functions; src/ui/marketing-command-center.test.mjs runs this file in
   node:vm. The page wiring at the bottom only runs when #mcc-root exists. */
(function (root) {
  "use strict";

  /* ── constants ───────────────────────────────────────────────────────── */

  /* Staff screens print Arizona time (ops/workflows/arizona-time-2026-08-28.md). */
  var TZ = "America/Phoenix";
  /* The tab a viewer lands on when the link names none and they have no
     remembered tab. */
  var DEFAULT_TAB = "today";
  /* The last tab per viewer, in this browser only (a convenience; a blocked
     store just means the viewer lands on Today). */
  var STORE_KEY = "fh_mcc_tab";
  /* A tab key: lower-case letters, digits and dashes, starting with a letter. */
  var KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;
  /* Where a tab sits. "strip" is the row of tabs; "gear" is the Settings
     button top-right. Only one tab may sit behind the gear. */
  var PLACES = ["strip", "gear"];
  /* A read (GET) that has not answered in 20 seconds is given up on, so a
     phone that slept mid-load cannot hang a tab. Writes are never cut off. */
  var FETCH_TIMEOUT_MS = 20 * 1000;
  /* GET marketing/costs is read at most once a minute per page. */
  var COSTS_TTL_MS = 60 * 1000;
  var TOAST_MS = 6000;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function num(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* ── routing rules ───────────────────────────────────────────────────── */

  /* parseHash — "#numbers/ads" → {key:"numbers", sub:"ads"}. Anything that is
     not a tab key gives null (the page then picks the default). */
  function parseHash(hash) {
    var h = String(hash == null ? "" : hash).replace(/^#/, "");
    try { h = decodeURIComponent(h); } catch (e) { /* keep it raw */ }
    var parts = h.split("/");
    var key = String(parts[0] || "").trim().toLowerCase();
    if (!KEY_RE.test(key)) return null;
    return { key: key, sub: parts.slice(1).join("/") };
  }

  /* tabFromSearch — ?tab=settings, the plan's older spelling of a deep link.
     Read once, when the page opens with no hash. */
  function tabFromSearch(search) {
    var m = /[?&]tab=([^&#]*)/.exec(String(search == null ? "" : search));
    if (!m) return null;
    var key = "";
    try { key = decodeURIComponent(m[1]).trim().toLowerCase(); } catch (e) { return null; }
    return KEY_RE.test(key) ? key : null;
  }

  /* pickTab — the first wanted key that has a tab. `wanted` is in order of
     strength: the link's hash, ?tab=, the remembered tab, then Today. Falls
     back to the first tab in the strip, then the gear tab. Null when no tab
     is registered yet. */
  function pickTab(wanted, tabs) {
    var keys = {};
    var list = orderTabs(tabs);
    list.forEach(function (t) { keys[t.key] = true; });
    var w = Array.isArray(wanted) ? wanted : [];
    for (var i = 0; i < w.length; i++) {
      if (w[i] && keys[w[i]]) return w[i];
    }
    return list.length ? list[0].key : null;
  }

  /* orderTabs — strip tabs by `order` (then key), then the gear tab last. */
  function orderTabs(tabs) {
    var list = [];
    if (Array.isArray(tabs)) list = tabs.slice();
    else if (tabs && typeof tabs === "object") {
      for (var k in tabs) if (Object.prototype.hasOwnProperty.call(tabs, k)) list.push(tabs[k]);
    }
    return list.sort(function (a, b) {
      var pa = a.place === "gear" ? 1 : 0;
      var pb = b.place === "gear" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (a.order !== b.order) return a.order - b.order;
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
  }

  /* checkTab — a tab definition in, a clean one out, or a plain reason why
     not. `id` is read as `key` so either spelling registers. */
  function checkTab(def) {
    var d = obj(def);
    if (!d) return { error: "A tab must be an object." };
    var key = typeof d.key === "string" ? d.key : (typeof d.id === "string" ? d.id : "");
    if (!KEY_RE.test(key)) return { error: "A tab key must be lower-case letters, digits or dashes: \"" + key + "\"." };
    var label = typeof d.label === "string" ? d.label.trim() : "";
    if (!label) return { error: "The \"" + key + "\" tab needs a label." };
    if (typeof d.render !== "function") return { error: "The \"" + key + "\" tab needs a render(panel, ctx) function." };
    var place = d.place == null ? "strip" : d.place;
    if (PLACES.indexOf(place) === -1) return { error: "The \"" + key + "\" tab's place must be strip or gear." };
    var order = num(d.order);
    return {
      tab: {
        key: key,
        label: label,
        order: order === null ? 1000 : order,
        place: place,
        render: d.render,
        show: typeof d.show === "function" ? d.show : null,
        hide: typeof d.hide === "function" ? d.hide : null,
        rules: d.rules || null
      }
    };
  }

  /* stripHtml — the tab strip. One link per strip tab, in order; the one
     shown carries aria-current="page" and the .on look (a solid ink line
     under the word, so it reads on any brand colour, UI-STANDARDS §12.6). */
  function stripHtml(tabs, activeKey) {
    return orderTabs(tabs).filter(function (t) { return t.place !== "gear"; }).map(function (t) {
      var on = t.key === activeKey;
      return '<a class="tab' + (on ? " on" : "") + '" href="#' + esc(t.key) + '" data-tab="' + esc(t.key) + '"' +
        (on ? ' aria-current="page"' : "") + ">" + esc(t.label) + "</a>";
    }).join("");
  }

  /* gearHtml — the gear, top-right (UI-STANDARDS §8). It says its word too:
     an icon alone is a guess. */
  function gearHtml(tabs, activeKey) {
    var gear = orderTabs(tabs).filter(function (t) { return t.place === "gear"; })[0];
    if (!gear) return "";
    var on = gear.key === activeKey;
    return '<a class="gear' + (on ? " on" : "") + '" href="#' + esc(gear.key) + '" data-tab="' + esc(gear.key) + '"' +
      (on ? ' aria-current="page"' : "") + '><span class="gear-ico" aria-hidden="true">⚙</span>' + esc(gear.label) + "</a>";
  }

  /* ── words ───────────────────────────────────────────────────────────── */

  function fmt(d, opts) {
    var o = { timeZone: TZ };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    return new Intl.DateTimeFormat("en-US", o).format(d);
  }
  /* clockOf — "3:05 PM", Arizona. */
  function clockOf(ms) {
    return fmt(new Date(ms), { hour: "numeric", minute: "2-digit" });
  }
  /* fullTime — "Oct 5, 2026, 3:05 PM", Arizona, for a tooltip. */
  function fullTime(ms) {
    return fmt(new Date(ms), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  /* dollars — model bills in dollars (the API's _usd numbers). Null is
     "unknown", never $0. A real zero prints $0.00. */
  function dollars(usd) {
    var n = num(usd);
    if (n === null) return "unknown";
    if (n > 0 && n < 0.01) return "under 1 cent";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* minutesWords — 4.48 → "about 4 minutes"; under one → "under a minute". */
  function minutesWords(min) {
    var n = num(min);
    if (n === null) return null;
    if (n < 1) return "under a minute";
    var r = Math.round(n);
    return "about " + r + (r === 1 ? " minute" : " minutes");
  }

  /* normalizeCosts — GET marketing/costs (design §3.1, "Endpoints"):
     {kinds:{<kind>:{last_cost_usd, last_minutes, measured_at}|null}, month:{used_usd, cap_usd}}.
     Until that route ships every answer reads "missing", and every cost line
     says "unknown, not measured yet". Never a guess. */
  function normalizeCosts(res) {
    var r = obj(res) || {};
    var body = obj(r.body);
    if (r.status !== 200 || !body || !obj(body.kinds)) {
      return { state: r.status === 200 || r.status === 404 ? "missing" : "error", kinds: {}, month: null };
    }
    var month = obj(body.month);
    return {
      state: "ok",
      kinds: body.kinds,
      month: month ? { usedUsd: num(month.used_usd), capUsd: num(month.cap_usd) } : null
    };
  }

  /* costLine — the words under a button that calls a model (design safety
     rule 3): the last measured run, or "unknown, not measured yet". */
  function costLine(costs, kind) {
    var c = obj(costs) || {};
    var k = c.state === "ok" ? obj(obj(c.kinds) && c.kinds[kind]) : null;
    var usd = k ? num(k.last_cost_usd) : null;
    if (!k || usd === null) return "Cost: unknown, not measured yet.";
    var mins = minutesWords(k.last_minutes);
    return "About " + dollars(usd) + (mins ? " and " + mins : "") + " (last run).";
  }

  /* monthLine — "$12.48 of $300 used this month." or the unknown words. */
  function monthLine(costs) {
    var c = obj(costs) || {};
    var m = obj(c.month);
    if (!m || num(m.usedUsd) === null) return "Model spend this month: unknown.";
    return "Model spend this month: " + dollars(m.usedUsd) + (num(m.capUsd) === null ? "." : " of " + dollars(m.capUsd) + ".");
  }

  /* plainError — any failed answer as one plain sentence (UI-STANDARDS §6.3):
     never a status code, never a server word. `what` names the thing, like
     "The settings". */
  function plainError(res, what) {
    var r = obj(res) || {};
    var thing = what ? String(what) : "This part";
    if (r.status === 0 || r.status == null) {
      return r.transport === "timeout"
        ? "The server took too long to answer. Try again."
        : "No connection. Check the internet and try again.";
    }
    if (r.status === 401) return "You are signed out. Sign in and open this page again.";
    if (r.status === 403) return "Only the owner or an admin can use this.";
    if (r.status === 404) return thing + " is not ready yet. It turns on with the next update.";
    if (r.status === 409) return "Someone saved this after you opened it.";
    if (r.status === 400) return "That was not saved. Something in it is not right.";
    if (r.status === 503) return "The database is not answering. Try again in a minute.";
    return "The server had a problem. Try again in a minute.";
  }

  /* newRequestId — a fresh id for every tap that writes, so a double tap or a
     retry saves once (the server answers a repeated id with the first save). */
  function newRequestId(rand) {
    var c = root.crypto;
    if (!rand && c && typeof c.randomUUID === "function") return c.randomUUID();
    var r = typeof rand === "function" ? rand : Math.random;
    var hex = "";
    for (var i = 0; i < 32; i++) hex += Math.floor(r() * 16).toString(16);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-" +
      ((parseInt(hex.charAt(16), 16) & 3) | 8).toString(16) + hex.slice(17, 20) + "-" + hex.slice(20, 32);
  }

  /* withRequestId — a write body with request_id set (the caller's own wins). */
  function withRequestId(body, id) {
    var out = {};
    var b = obj(body) || {};
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    if (!out.request_id) out.request_id = id || newRequestId();
    return out;
  }

  /* ── the registry ────────────────────────────────────────────────────── */

  var tabs = {};
  var problems = [];
  var onAdd = null;

  function register(def) {
    var c = checkTab(def);
    if (c.error) {
      problems.push(c.error);
      if (root.console && typeof root.console.error === "function") root.console.error("Command Center: " + c.error);
      return false;
    }
    var t = c.tab;
    if (t.place === "gear") {
      for (var k in tabs) {
        if (Object.prototype.hasOwnProperty.call(tabs, k) && k !== t.key && tabs[k].place === "gear") {
          problems.push("Only one tab can sit behind the gear: \"" + t.key + "\" was not added.");
          return false;
        }
      }
    }
    tabs[t.key] = t;
    if (onAdd) onAdd(t.key);
    return true;
  }

  var Registry = {
    register: register,
    has: function (key) { return Object.prototype.hasOwnProperty.call(tabs, key); },
    keys: function () { return orderTabs(tabs).map(function (t) { return t.key; }); },
    list: function () {
      return orderTabs(tabs).map(function (t) { return { key: t.key, label: t.label, order: t.order, place: t.place }; });
    },
    rules: function (key) { return Object.prototype.hasOwnProperty.call(tabs, key) ? tabs[key].rules : null; },
    problems: function () { return problems.slice(); }
  };
  root.FHMarketingCCTabs = Registry;

  /* A tab file that ran before this one left its tab in the queue. */
  var queued = root.FHMarketingCCTabsQueue;
  if (Array.isArray(queued)) {
    root.FHMarketingCCTabsQueue = [];
    queued.forEach(register);
  }

  var RULES = {
    TZ: TZ,
    DEFAULT_TAB: DEFAULT_TAB,
    STORE_KEY: STORE_KEY,
    FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
    COSTS_TTL_MS: COSTS_TTL_MS,
    esc: esc,
    parseHash: parseHash,
    tabFromSearch: tabFromSearch,
    pickTab: pickTab,
    orderTabs: orderTabs,
    checkTab: checkTab,
    stripHtml: stripHtml,
    gearHtml: gearHtml,
    clockOf: clockOf,
    fullTime: fullTime,
    dollars: dollars,
    minutesWords: minutesWords,
    normalizeCosts: normalizeCosts,
    costLine: costLine,
    monthLine: monthLine,
    plainError: plainError,
    newRequestId: newRequestId,
    withRequestId: withRequestId
  };
  root.FHMarketingCCFrame = RULES;

  /* ── the page ────────────────────────────────────────────────────────── */

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== "function") return;

  function $(id) { return doc.getElementById(id); }

  /* api — the shared read and write helper. Same session handling as the
     Today tab: a Bearer header when the screen has a token, the same-origin
     cookie otherwise. Answers {status, body} and never throws: a dropped
     connection is {status:0, transport}. */
  function api(path, init) {
    init = init || {};
    var headers = { accept: "application/json" };
    try {
      var t = root.localStorage.getItem("fh_token") || "";
      if (t && t !== "demo" && t !== "demo-token") headers.authorization = "Bearer " + t;
    } catch (e) { /* storage blocked: the cookie still works */ }
    var opts = { method: init.method || "GET", headers: headers, credentials: "same-origin" };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      opts.body = JSON.stringify(init.body);
    }
    var timer = null;
    var timedOut = false;
    if (opts.method === "GET" && typeof root.AbortController === "function") {
      var ctrl = new root.AbortController();
      opts.signal = ctrl.signal;
      timer = root.setTimeout(function () { timedOut = true; ctrl.abort(); }, FETCH_TIMEOUT_MS);
    }
    function settle(out) {
      if (timer) root.clearTimeout(timer);
      return out;
    }
    return root.fetch(path, opts).then(
      function (r) {
        return r.json().then(
          function (b) { return settle({ status: r.status, body: b }); },
          function () { return settle(timedOut ? { status: 0, body: null, transport: "timeout" } : { status: r.status, body: null }); }
        );
      },
      function (e) { return settle({ status: 0, body: null, transport: timedOut ? "timeout" : ((e && e.message) || "network error") }); }
    );
  }
  /* post — a write. It always carries a request_id (a fresh one unless the
     caller passes its own), plus whatever version guard the caller put in the
     body (updated_at or version). */
  function post(path, body, requestId) {
    return api(path, { method: "POST", body: withRequestId(body, requestId) });
  }

  var costsCache = null;
  function costs(force) {
    var now = Date.now();
    if (!force && costsCache && now - costsCache.at < COSTS_TTL_MS) return costsCache.promise;
    var p = api("/api/marketing/costs").then(normalizeCosts);
    costsCache = { at: now, promise: p };
    return p;
  }

  var toastTimer = null;
  function toast(text, tone) {
    var el = $("mccToast");
    if (!el) return;
    el.className = "cc-toast show" + (tone ? " " + tone : "");
    el.textContent = String(text || "");
    el.hidden = !text;
    if (toastTimer) root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () { el.hidden = true; el.className = "cc-toast"; }, TOAST_MS);
  }

  /* style — a tab's own CSS, added once. A tab keeps its look in its own file
     so two tab units never edit the same <style>. The brand's type law still
     holds: no px font sizes (UI-STANDARDS §12.7). */
  function style(key, css) {
    var id = "cc-style-" + key;
    if ($(id)) return;
    var el = doc.createElement("style");
    el.id = id;
    el.textContent = String(css || "");
    doc.head.appendChild(el);
  }

  var frame = {
    mounted: false,
    domReady: false,
    active: null,
    rendered: {},
    panels: {},
    searchKey: tabFromSearch(root.location && root.location.search),
    title: doc.title
  };

  function remembered() {
    try { return root.localStorage.getItem(STORE_KEY) || null; } catch (e) { return null; }
  }
  function remember(key) {
    try { root.localStorage.setItem(STORE_KEY, key); } catch (e) { /* private window: fine */ }
  }

  function panelFor(key) {
    if (frame.panels[key]) return frame.panels[key];
    var panel = doc.createElement("section");
    panel.className = "cc-panel";
    panel.id = "tab-" + key;
    panel.setAttribute("data-tab", key);
    panel.setAttribute("aria-label", tabs[key].label);
    panel.hidden = true;
    $("mccPanels").appendChild(panel);
    frame.panels[key] = panel;
    return panel;
  }

  function ctxFor(key) {
    return {
      key: key,
      api: api,
      post: post,
      requestId: newRequestId,
      costs: costs,
      costLine: costLine,
      monthLine: monthLine,
      dollars: dollars,
      plainError: plainError,
      toast: toast,
      style: style,
      esc: esc,
      tz: TZ,
      clock: clockOf,
      fullTime: fullTime,
      sub: function () { var r = parseHash(root.location.hash); return r && r.key === key ? r.sub : ""; },
      isActive: function () { return frame.active === key; },
      go: function (to, sub) { root.location.hash = "#" + to + (sub ? "/" + sub : ""); }
    };
  }

  function paintStrip() {
    var strip = $("mccTabs");
    var gear = $("mccGear");
    var html = stripHtml(tabs, frame.active);
    strip.innerHTML = html;
    strip.hidden = !html;
    gear.innerHTML = gearHtml(tabs, frame.active);
  }

  /* Footer bits outside the panels that belong to one tab (Today's "Loaded
     3:02 PM") carry data-cc-tab and show only on that tab. */
  function paintOwned() {
    var owned = doc.querySelectorAll("[data-cc-tab]");
    for (var i = 0; i < owned.length; i++) owned[i].hidden = owned[i].getAttribute("data-cc-tab") !== frame.active;
  }

  function show(key) {
    var t = tabs[key];
    if (!t) return;
    var panel = panelFor(key);
    if (frame.active && frame.active !== key && tabs[frame.active]) {
      var old = tabs[frame.active];
      frame.panels[old.key].hidden = true;
      if (old.hide) { try { old.hide(frame.panels[old.key], ctxFor(old.key)); } catch (e) { report(e); } }
    }
    frame.active = key;
    panel.hidden = false;
    var ctx = ctxFor(key);
    if (!frame.rendered[key]) {
      frame.rendered[key] = true;
      try { t.render(panel, ctx); } catch (e) {
        report(e);
        panel.innerHTML = '<div class="banner err show" role="alert">This tab did not open. Reload the page and try again.</div>';
      }
    } else if (t.show) {
      try { t.show(panel, ctx); } catch (e) { report(e); }
    }
    remember(key);
    paintStrip();
    paintOwned();
    doc.title = frame.title + " · " + t.label;
  }

  function report(e) {
    if (root.console && typeof root.console.error === "function") root.console.error(e);
  }

  /* route — show the tab the address asks for. Before the page has finished
     loading its scripts, a tab that is not registered YET is waited for (its
     file may still be on the way); after that, an unknown tab falls back to
     the remembered tab or Today, and the address is corrected to match. */
  function route() {
    if (!frame.mounted) return;
    var asked = parseHash(root.location.hash);
    var first = asked ? asked.key : (frame.searchKey || remembered() || DEFAULT_TAB);
    var key = pickTab([first, frame.searchKey, remembered(), DEFAULT_TAB], tabs);
    if (!key) return;
    if (key !== first && !frame.domReady) return;
    if ((!asked || asked.key !== key) && root.history && typeof root.history.replaceState === "function") {
      root.history.replaceState(null, "", "#" + key);
    }
    frame.searchKey = null;
    if (frame.active !== key) show(key);
    else { paintStrip(); paintOwned(); }
  }

  /* later — run after the script that is running now has finished. A tab
     file registers before the rest of its file has run, so the frame never
     calls render() from inside register(). */
  var routeQueued = false;
  function later() {
    if (routeQueued) return;
    routeQueued = true;
    Promise.resolve().then(function () { routeQueued = false; route(); });
  }

  function mount() {
    if (frame.mounted || !$("mcc-root") || !$("mccTabs") || !$("mccPanels")) return;
    frame.mounted = true;
    onAdd = later;
    root.addEventListener("hashchange", route);
    route();
  }

  function ready() {
    if (frame.domReady) return;
    frame.domReady = true;
    mount();
    route();
  }

  mount();
  if (doc.readyState === "complete") ready();
  else {
    doc.addEventListener("DOMContentLoaded", ready);
    root.addEventListener("load", ready);
  }
})(typeof window !== "undefined" ? window : globalThis);
