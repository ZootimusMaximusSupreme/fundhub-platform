/* marketing-command-center.js — the Marketing Command Center frame.

   WHAT THIS FILE IS. The frame every Command Center tab sits in (plan unit U34;
   docs/specs/command-center-design-2026-10-05.md §3.0 and §6 slices 0 to 2):
     - the tab strip, in work order (Today · Ideas · Scripts · Shoot · Videos ·
       Launch · Numbers), and Settings behind the gear, top-right, off the strip
       (UI-STANDARDS §8);
     - hash routing: #today, #settings, #numbers/ads (a tab and an optional
       view inside it). A buzz deep-links straight to a tab;
     - the tab registry. A tab shows ONLY when its script is on the page and
       registered. A tab with no module does not render, so the strip never
       carries an empty or "coming soon" tab (UI-STANDARDS §5). It takes two
       spellings of the same thing: window.FundhubCC.registerTab (main's
       contract; the Ideas, Scripts, Launch and Numbers tabs use it) and the
       frame's own window.FHMarketingCCTabs.register. Both land in one strip;
       a tab that registers in both counts once;
     - the shared helpers every tab gets as `ctx`: api reads and writes in
       either spelling (a write carries a fresh request_id), the cost sheet
       before a paid tap (GET marketing/costs), the two-tap confirm, a toast,
       plain error sentences, money and Arizona time words.
   Each tab lives in its own file and owns its own markup:
     marketing-cc-today.js     Today      (U37 owns it after U34)
     marketing-cc-settings.js  Settings   (the gear)
     cc-tab-<id>.js            any other tab, one <script defer> line each
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
  /* A tab with refresh(ctx) is asked to redraw every 5 minutes while it is
     shown and the page is in view, and when the page comes back into view
     after at least a minute away (main's contract: "5-minute reload, focus"). */
  var REFRESH_MS = 5 * 60 * 1000;
  var REFOCUS_MS = 60 * 1000;
  /* The tabs that show a script's words. When the teleprompter saves an edit
     in this browser (public/app/teleprompter.js: BroadcastChannel
     "fundhub-scripts", and the localStorage key fh.scripts.changed for a
     browser with no channel), the one on screen reads again at once. */
  var WORD_TABS = ["shoot", "scripts"];
  var WORDS_CHANNEL = "fundhub-scripts";
  var WORDS_KEY = "fh.scripts.changed";
  /* The words a main-contract api call starts with. */
  var METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

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
        refresh: typeof d.refresh === "function" ? d.refresh : null,
        hide: typeof d.hide === "function" ? d.hide : null,
        rules: d.rules || null
      }
    };
  }

  /* fromMainTab — main's FundhubCC.registerTab shape
     ({id, label, order 1..7, render(root, ctx), refresh(ctx), hide()}) in the
     frame's shape. `order` is a slot, 1 (Today) to 7 (Numbers); the frame keeps
     it times ten, its own scale (Today 10 ... Numbers 70), so tabs from both
     spellings sort into one strip. Settings goes behind the gear. Anything
     that is not an object goes through unchanged so checkTab can say why. */
  function fromMainTab(def) {
    var d = obj(def);
    if (!d) return def;
    var key = typeof d.id === "string" ? d.id : d.key;
    var o = num(d.order);
    return {
      key: key,
      label: d.label,
      order: o === null ? null : o * 10,
      place: key === "settings" ? "gear" : "strip",
      render: d.render,
      show: d.show,
      refresh: d.refresh,
      hide: d.hide,
      rules: d.rules || null
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

  /* ── main's ctx spelling (docs/specs/command-center-tabs.md) ─────────── */

  /* isMethod — is this the first word of main's ctx.api(method, path, ...)?
     The frame's own spelling starts with a path ("/api/..."), never a verb. */
  function isMethod(v) {
    return typeof v === "string" && METHODS.indexOf(v.toUpperCase()) !== -1;
  }

  /* apiPath — "marketing/today", "/marketing/today" and "/api/marketing/today"
     all call /api/marketing/today. */
  function apiPath(path) {
    var p = String(path == null ? "" : path).replace(/^\/+/, "");
    if (p.indexOf("api/") === 0) p = p.slice(4);
    return "/api/" + p;
  }

  /* writeBody — a write's body as it is sent: request_id always (the body's
     own wins, then opts.requestId, then a fresh one); opts.version goes in as
     `version` when the body carries none (the API's guard for scripts and
     videos; settings and funnels put updated_at in the body themselves). */
  function writeBody(body, opts) {
    var o = obj(opts) || {};
    var out = withRequestId(body, typeof o.requestId === "string" && o.requestId ? o.requestId : null);
    if (o.version !== undefined && o.version !== null && out.version === undefined) out.version = o.version;
    return out;
  }

  /* mainAnswer — the frame's {status, body} as main's
     {ok, status, data, error, conflict, current}. Never throws. ok is any 2xx.
     error is the answer's own error word, or "network" / "timeout" when the
     server never answered. A 409 carries the saved copy as current. */
  function mainAnswer(res) {
    var r = obj(res) || {};
    var status = num(r.status) || 0;
    var data = r.body === undefined ? null : r.body;
    var d = obj(data);
    var error = null;
    if (d && typeof d.error === "string" && d.error) error = d.error;
    else if (!status) error = r.transport === "timeout" ? "timeout" : "network";
    return {
      ok: status >= 200 && status < 300,
      status: status,
      data: data,
      error: error,
      conflict: status === 409,
      current: d && d.current !== undefined ? d.current : null
    };
  }

  /* toMs — a time from the API (ISO text, a number of ms, or a Date) as ms,
     or null when there is none. */
  function toMs(ts) {
    if (ts === null || ts === undefined || ts === "" || typeof ts === "boolean") return null;
    var ms = typeof ts === "number" ? ts
      : (typeof ts === "object" && typeof ts.getTime === "function" ? ts.getTime() : Date.parse(String(ts)));
    return isFinite(ms) ? ms : null;
  }

  /* money — integer cents (the API's _cents numbers) as "$1,234.56".
     NULL is "unknown", never $0 (design safety rule 8). A measured zero is
     "$0.00". */
  function money(cents) {
    var n = num(cents);
    if (n === null) return "unknown";
    var c = Math.round(n);
    return (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* azTime — "Oct 5, 3:05 PM", Arizona. NULL is "unknown". */
  function azTime(ts) {
    var ms = toMs(ts);
    if (ms === null) return "unknown";
    return fmt(new Date(ms), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  /* agoWords — "just now", "5 minutes ago", "2 hours ago", "3 days ago"; a
     time still to come reads "in 5 minutes". NULL is "unknown". */
  function agoWords(ts, nowMs) {
    var ms = toMs(ts);
    if (ms === null) return "unknown";
    var now = num(nowMs);
    var diff = (now === null ? Date.now() : now) - ms;
    var ahead = diff < 0;
    var s = Math.abs(diff) / 1000;
    if (s < 60) return "just now";
    var n;
    var unit;
    if (s < 3600) { n = Math.floor(s / 60); unit = "minute"; }
    else if (s < 86400) { n = Math.floor(s / 3600); unit = "hour"; }
    else { n = Math.floor(s / 86400); unit = "day"; }
    var words = n + " " + unit + (n === 1 ? "" : "s");
    return ahead ? "in " + words : words + " ago";
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
    /* The same tab twice (a file that registers in both spellings, or a
       script line written twice) counts once: the first one wins. */
    if (Object.prototype.hasOwnProperty.call(tabs, t.key)) return false;
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

  /* Main's spelling (docs/specs/command-center-tabs.md): "The frame drains
     FundhubCC._q on load and replaces registerTab with the real one." A tab
     file that runs after this line calls the real one straight away. */
  function registerTab(def) { return register(fromMainTab(def)); }
  var cc = obj(root.FundhubCC) || {};
  var mainQueued = Array.isArray(cc._q) ? cc._q : [];
  cc._q = [];
  cc.registerTab = registerTab;
  root.FundhubCC = cc;
  mainQueued.forEach(registerTab);

  /* ── reads and writes ────────────────────────────────────────────────── */
  /* These need no page, so src/ui/marketing-command-center.test.mjs runs them
     in node:vm with a stand-in fetch. They touch root.fetch and storage only
     when a tab calls them. */

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
    var sent;
    try { sent = root.fetch(path, opts); } catch (e) { sent = Promise.reject(e); }
    return Promise.resolve(sent).then(
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

  /* callApi — ctx.api, in either spelling:
       main's   ctx.api("GET", "marketing/today")
                ctx.api("POST", "marketing/scripts/approve", body, {version, requestId})
                -> {ok, status, data, error, conflict, current}
       frame's  ctx.api("/api/marketing/today", {method, body}) -> {status, body}
     The first word tells them apart: a method is never a path. */
  function callApi(a, b, c, d) {
    if (isMethod(a) && typeof b === "string") {
      var method = a.toUpperCase();
      var init = { method: method };
      if (method !== "GET") init.body = writeBody(c, d);
      return api(apiPath(b), init).then(mainAnswer);
    }
    return api(a, b);
  }

  var costsCache = null;
  function costs(force) {
    var now = Date.now();
    if (!force && costsCache && now - costsCache.at < COSTS_TTL_MS) return costsCache.promise;
    var p = api("/api/marketing/costs").then(normalizeCosts);
    costsCache = { at: now, promise: p };
    return p;
  }

  /* cachedRole — the role the shell last saw in this browser (shell.js keeps
     it in fh_role). A hint for the screen only: the server decides. */
  function cachedRole() {
    try {
      var r = String(root.localStorage.getItem("fh_role") || "").trim().toLowerCase();
      return r || null;
    } catch (e) { return null; }
  }

  /* subOf — the view inside a tab the address names (#numbers/ads -> "ads"). */
  function subOf(key) {
    var r = parseHash(root.location && root.location.hash);
    return r && r.key === key ? r.sub : "";
  }

  /* baseCtx — every helper a tab gets that needs no page. ctxFor adds the
     page parts (toast, style, the sheets, go). Main's names and the frame's
     names sit side by side; docs/specs/command-center-tabs.md lists both. */
  function baseCtx(key) {
    return {
      key: key,
      api: callApi,
      post: post,
      requestId: newRequestId,
      costs: costs,
      costLine: costLine,
      monthLine: monthLine,
      dollars: dollars,
      plainError: plainError,
      esc: esc,
      tz: TZ,
      clock: clockOf,
      fullTime: fullTime,
      fmt: { money: money, az: azTime, ago: function (ts) { return agoWords(ts); } },
      user: { role: cachedRole() },
      param: subOf(key),
      sub: function () { return subOf(key); }
    };
  }

  /* sheetHtml — the inside of a sheet (the cost sheet or the two-tap
     confirm). The cost sheet prints the cost line and the month line, filled
     in when GET marketing/costs answers; until then the yes button waits and
     says why. The confirm prints the consequence. Cancel comes first in the
     page order and takes the first focus; the yes button is the sheet's one
     filled button (the sheet covers the page, so the page's own filled button
     is not on screen with it). */
  function sheetHtml(o) {
    var s = obj(o) || {};
    var lines = Array.isArray(s.lines) ? s.lines : [];
    var body = "";
    if (s.kind === "cost") {
      body += '<p class="cc-sheet-cost" data-sheet-cost>' + esc(s.costText || "Checking the cost…") + "</p>";
      body += '<p class="caption cc-sheet-month" data-sheet-month' + (s.monthText ? "" : " hidden") + ">" + esc(s.monthText || "") + "</p>";
    } else if (s.consequence) {
      body += "<p>" + esc(s.consequence) + "</p>";
    }
    lines.forEach(function (l) {
      if (l !== null && l !== undefined && String(l).trim()) body += "<p>" + esc(l) + "</p>";
    });
    var yes = s.button ? String(s.button) : (s.kind === "cost" ? "Start" : "Yes");
    return '<h2 id="ccSheetTitle">' + esc(s.title || "Are you sure?") + "</h2>" +
      '<div class="cc-sheet-body" id="ccSheetBody">' + body + "</div>" +
      '<div class="cc-sheet-acts">' +
        '<button type="button" class="btn" data-sheet="no">Cancel</button>' +
        '<button type="button" class="btn primary" data-sheet="yes"' + (s.wait ? " disabled" : "") + ">" + esc(yes) + "</button>" +
      "</div>";
  }

  var RULES = {
    TZ: TZ,
    DEFAULT_TAB: DEFAULT_TAB,
    STORE_KEY: STORE_KEY,
    FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
    COSTS_TTL_MS: COSTS_TTL_MS,
    REFRESH_MS: REFRESH_MS,
    REFOCUS_MS: REFOCUS_MS,
    WORD_TABS: WORD_TABS,
    WORDS_CHANNEL: WORDS_CHANNEL,
    WORDS_KEY: WORDS_KEY,
    esc: esc,
    parseHash: parseHash,
    tabFromSearch: tabFromSearch,
    pickTab: pickTab,
    orderTabs: orderTabs,
    checkTab: checkTab,
    fromMainTab: fromMainTab,
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
    withRequestId: withRequestId,
    isMethod: isMethod,
    apiPath: apiPath,
    writeBody: writeBody,
    mainAnswer: mainAnswer,
    money: money,
    azTime: azTime,
    agoWords: agoWords,
    callApi: callApi,
    baseCtx: baseCtx,
    sheetHtml: sheetHtml
  };
  root.FHMarketingCCFrame = RULES;

  /* ── the page ────────────────────────────────────────────────────────── */

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== "function") return;

  function $(id) { return doc.getElementById(id); }

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

  /* ── the sheets: the cost sheet and the two-tap confirm ──────────────── */
  /* Design §5: rule 3 (cost before every run) and rule 5 (the second tap
     names the consequence). One sheet at a time. While it is open the rest of
     the page is inert, so the only taps are its two buttons. Escape, a tap
     outside it, a new sheet or leaving the tab all count as Cancel. The yes
     answer runs onConfirm once; nothing runs on Cancel but onCancel. */
  var sheet = null;

  function sheetHost() { return doc.querySelector(".app") || doc.body; }

  function setInert(host, keep, on) {
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === keep) continue;
      if (on) {
        if (!k.hasAttribute("inert")) { k.setAttribute("inert", ""); k.setAttribute("data-cc-inert", ""); }
      } else if (k.hasAttribute("data-cc-inert")) {
        k.removeAttribute("inert");
        k.removeAttribute("data-cc-inert");
      }
    }
  }

  function closeSheet(yes) {
    var s = sheet;
    if (!s) return;
    sheet = null;
    doc.removeEventListener("keydown", s.onKey, true);
    setInert(s.host, s.el, false);
    if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    try {
      if (s.back && typeof s.back.focus === "function" && doc.body.contains(s.back)) s.back.focus();
    } catch (e) { /* focus is a nicety */ }
    s.resolve(yes === true);
    var fn = yes === true ? s.onConfirm : s.onCancel;
    if (typeof fn === "function") { try { fn(); } catch (e) { report(e); } }
  }

  function openSheet(o) {
    if (sheet) closeSheet(false);
    var s = { kind: o.kind, onConfirm: o.onConfirm, onCancel: o.onCancel, back: doc.activeElement, host: sheetHost() };
    s.promise = new Promise(function (resolve) { s.resolve = resolve; });
    var el = doc.createElement("div");
    el.className = "cc-sheet";
    el.setAttribute("data-kind", o.kind);
    var box = doc.createElement("div");
    box.className = "card cc-sheet-box";
    box.setAttribute("role", o.kind === "confirm" ? "alertdialog" : "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "ccSheetTitle");
    box.setAttribute("aria-describedby", "ccSheetBody");
    box.innerHTML = sheetHtml(o);
    el.appendChild(box);
    s.el = el;
    s.box = box;
    s.onKey = function (e) {
      if (sheet !== s) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSheet(false);
        return;
      }
      if (e.key === "Tab") {
        var all = box.querySelectorAll("button");
        var on = [];
        for (var i = 0; i < all.length; i++) if (!all[i].disabled) on.push(all[i]);
        e.preventDefault();
        if (!on.length) return;
        var at = on.indexOf(doc.activeElement);
        var next = e.shiftKey ? (at <= 0 ? on.length - 1 : at - 1) : (at === on.length - 1 ? 0 : at + 1);
        on[next].focus();
      }
    };
    el.addEventListener("click", function (e) {
      if (sheet !== s) return;
      if (e.target === el) { closeSheet(false); return; }
      var b = e.target && e.target.closest ? e.target.closest("[data-sheet]") : null;
      if (!b || b.disabled) return;
      closeSheet(b.getAttribute("data-sheet") === "yes");
    });
    sheet = s;
    s.host.appendChild(el);
    setInert(s.host, el, true);
    doc.addEventListener("keydown", s.onKey, true);
    var no = box.querySelector('[data-sheet="no"]');
    if (no) no.focus();
    return s;
  }

  /* costSheet — ctx.costSheet({kind, title, lines?, button?, onConfirm,
     onCancel?}) -> a promise of true (yes) or false. */
  function costSheet(o) {
    var d = obj(o) || {};
    var s = openSheet({ kind: "cost", title: d.title, lines: d.lines, button: d.button, wait: true,
      onConfirm: d.onConfirm, onCancel: d.onCancel });
    function fill(c) {
      if (sheet !== s) return;
      var cost = s.box.querySelector("[data-sheet-cost]");
      var month = s.box.querySelector("[data-sheet-month]");
      if (cost) cost.textContent = costLine(c, d.kind);
      if (month) { month.textContent = monthLine(c); month.hidden = false; }
      var yes = s.box.querySelector('[data-sheet="yes"]');
      if (yes) yes.disabled = false;
    }
    costs().then(fill, function () { fill(null); });
    return s.promise;
  }

  /* confirmSheet — ctx.confirm({title, consequence, button, onConfirm?,
     onCancel?}) -> a promise of true (yes) or false. */
  function confirmSheet(o) {
    var d = obj(o) || {};
    return openSheet({ kind: "confirm", title: d.title, consequence: d.consequence, lines: d.lines, button: d.button,
      onConfirm: d.onConfirm, onCancel: d.onCancel }).promise;
  }

  var frame = {
    mounted: false,
    domReady: false,
    active: null,
    rendered: {},
    refreshedAt: {},
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
    var ctx = baseCtx(key);
    ctx.toast = toast;
    ctx.style = style;
    ctx.costSheet = costSheet;
    ctx.confirm = confirmSheet;
    ctx.isActive = function () { return frame.active === key; };
    ctx.go = function (to, sub) { root.location.hash = "#" + to + (sub ? "/" + sub : ""); };
    return ctx;
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

  var FAILED_HTML = '<div class="banner err show" role="alert">This tab did not open. Reload the page and try again.</div>';

  /* draw — run a tab's render (first) or show. A throw, or a promise that
     fails before the tab drew anything, leaves one plain sentence in the
     panel; the other tabs keep working. */
  function draw(fn, panel, first) {
    var out;
    try { out = fn(); } catch (e) {
      report(e);
      if (first) panel.innerHTML = FAILED_HTML;
      return;
    }
    if (out && typeof out.then === "function") {
      out.then(null, function (e) {
        report(e);
        if (first && !panel.children.length) panel.innerHTML = FAILED_HTML;
      });
    }
  }

  /* refreshTab — ask a drawn tab with refresh(ctx) for fresh data. */
  function refreshTab(key) {
    var t = tabs[key];
    if (!t || !t.refresh || !frame.rendered[key]) return;
    frame.refreshedAt[key] = Date.now();
    var ctx = ctxFor(key);
    try {
      var out = t.refresh(ctx);
      if (out && typeof out.then === "function") out.then(null, report);
    } catch (e) { report(e); }
  }

  function show(key) {
    var t = tabs[key];
    if (!t) return;
    var panel = panelFor(key);
    if (frame.active && frame.active !== key && tabs[frame.active]) {
      var old = tabs[frame.active];
      frame.panels[old.key].hidden = true;
      /* A sheet belongs to the tab that opened it: leaving the tab is a no. */
      if (sheet) closeSheet(false);
      if (old.hide) { try { old.hide(frame.panels[old.key], ctxFor(old.key)); } catch (e) { report(e); } }
    }
    frame.active = key;
    panel.hidden = false;
    var ctx = ctxFor(key);
    if (!frame.rendered[key]) {
      frame.rendered[key] = true;
      frame.refreshedAt[key] = Date.now();
      draw(function () { return t.render(panel, ctx); }, panel, true);
    } else if (t.show) {
      draw(function () { return t.show(panel, ctx); }, panel, false);
    } else if (t.refresh) {
      refreshTab(key);
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

  /* The 5-minute reload and the reload on coming back (main's contract), for
     a tab that has refresh(ctx). Never while a sheet is open, never while the
     page is out of view. A tab with no refresh keeps its own timers. */
  function inView() { return doc.visibilityState !== "hidden"; }
  function due(ms) {
    var key = frame.active;
    var t = key ? tabs[key] : null;
    if (!t || !t.refresh || sheet || !inView()) return;
    if (Date.now() - (frame.refreshedAt[key] || 0) < ms) return;
    refreshTab(key);
  }

  /* New words saved from the teleprompter: the Shoot or Scripts tab on screen
     reads again now. With a sheet open it waits for the next 30-second beat
     (its refreshedAt is cleared), so an open sheet is never redrawn under you. */
  function wordsChanged() {
    WORD_TABS.forEach(function (k) { frame.refreshedAt[k] = 0; });
    var key = frame.active;
    if (!key || WORD_TABS.indexOf(key) < 0 || sheet || !inView()) return;
    refreshTab(key);
  }
  function listenForWords() {
    try {
      if (typeof root.BroadcastChannel === "function") {
        var ch = new root.BroadcastChannel(WORDS_CHANNEL);
        ch.onmessage = function (e) { if (e && e.data && e.data.type === "script-saved") wordsChanged(); };
      }
    } catch (e) { /* no channel in this browser: the storage event below still works */ }
    root.addEventListener("storage", function (e) { if (e && e.key === WORDS_KEY) wordsChanged(); });
  }

  function mount() {
    if (frame.mounted || !$("mcc-root") || !$("mccTabs") || !$("mccPanels")) return;
    frame.mounted = true;
    onAdd = later;
    root.addEventListener("hashchange", route);
    root.setInterval(function () { due(REFRESH_MS); }, 30 * 1000);
    doc.addEventListener("visibilitychange", function () { due(REFOCUS_MS); });
    root.addEventListener("focus", function () { due(REFOCUS_MS); });
    listenForWords();
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
