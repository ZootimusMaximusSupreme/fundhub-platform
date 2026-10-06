/* Connections — a client's OWN merchant processors (/app/money-connections.html).
 *
 * Reads GET /api/money/connections and writes POST /api/money/connections
 * (create / secret / disable). Shape: the header of api/money/connections.mjs
 * and merchantSummary() in src/merchant/store.mjs.
 *
 * HONESTY RULES, same as money.js:
 *   - Money is integer cents. A null is a dash, never $0.00.
 *   - No connection means no numbers. The tiles say so instead of showing $0.
 *   - The open-API key is shown ONCE, right after it is made. It is never
 *     stored in this page, in the browser, or anywhere it can be read back.
 *
 * Render functions return HTML strings and touch no DOM, so
 * src/http/money-connections-screen.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var PATH = "/api/money/connections";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var PROVIDERS = [
    { id: "commas", name: "Commas", blurb: "Your Commas sales and refunds come in by webhook." },
    { id: "whop", name: "Whop", blurb: "Your Whop sales, refunds, fees and payouts come in by webhook." },
    { id: "api", name: "Open API", blurb: "Any other processor, or your own system, sends sales and payouts to one address with a key." }
  ];
  var STATE_WORD = { active: "Connected", waiting: "Waiting for secret", disabled: "Turned off" };

  /* ── helpers ───────────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  function monthName(ym) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "—";
  }

  /* Relative under 24h, absolute after (UI-STANDARDS §7). */
  function when(iso, nowMs) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "never";
    var now = isNum(nowMs) ? nowMs : Date.now();
    var mins = Math.round((now - t) / 60000);
    if (mins >= 0 && mins < 60) return mins <= 1 ? "just now" : mins + " min ago";
    if (mins >= 60 && mins < 1440) return Math.round(mins / 60) + "h ago";
    try {
      return new Date(t).toLocaleString("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return new Date(t).toISOString().slice(0, 16).replace("T", " "); }
  }

  function exactTime(iso) {
    var t = Date.parse(iso || "");
    return isFinite(t) ? new Date(t).toISOString() : "";
  }

  /* "vs last month" — a number alone means nothing (UI-STANDARDS §7). */
  function versus(cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return "no month before to compare";
    var d = cur - prev;
    if (d === 0) return "same as last month";
    return (d > 0 ? "up " : "down ") + money(Math.abs(d)) + " vs last month";
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function hasConnections(d) { return list(d && d.connections).length > 0; }

  function renderTiles(d) {
    var totals = list(d.summary && d.summary.totals);
    var cur = totals[totals.length - 1] || null;
    var prev = totals[totals.length - 2] || null;
    function tile(label, key, sub) {
      var v = cur && hasConnections(d) ? cur[key] : null;
      var p = prev && hasConnections(d) ? prev[key] : null;
      return '<div class="card tile" data-tile="' + esc(key) + '"><span class="caption">' + esc(label) + '</span>' +
        '<span class="big">' + esc(money(v)) + '</span>' +
        '<span class="caption">' + esc(hasConnections(d) ? (sub || versus(v, p)) : "connect a processor to see this") + '</span></div>';
    }
    var count = cur && hasConnections(d) ? cur.sale_count : null;
    return '<div class="grid tiles">' +
      tile("Sales this month", "sales_cents", isNum(count) ? count + (count === 1 ? " sale · " : " sales · ") + versus(cur.sales_cents, prev ? prev.sales_cents : null) : null) +
      tile("Refunds this month", "refunds_cents") +
      tile("Fees this month", "fees_cents") +
      tile("Paid out to your bank", "payouts_cents") +
      '</div>';
  }

  function containerSelect(d, provider) {
    var opts = list(d.containers).map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.kind === "personal" ? " (personal)" : "") + '</option>';
    }).join("");
    return '<div class="field"><label for="ent-' + esc(provider) + '">Which business is this for?</label>' +
      '<select id="ent-' + esc(provider) + '" data-ent="' + esc(provider) + '">' + opts + '</select></div>';
  }

  function copyRow(value, label) {
    return '<div class="copyrow"><code>' + esc(value) + '</code>' +
      '<button class="btn" type="button" data-act="copy" data-copy="' + esc(value) + '">' + esc(label || "Copy") + '</button></div>';
  }

  function connectionBlock(d, c, reveal) {
    var stateCls = c.status === "active" ? "state-active" : (c.status === "waiting" ? "state-waiting" : "");
    var html = '<div class="conn" data-conn="' + esc(c.id) + '">' +
      '<div class="conn-top"><span class="conn-name">' + esc(c.entity_name || "Business") + '</span>' +
      '<span class="state ' + stateCls + '">' + esc(STATE_WORD[c.status] || c.status) + '</span></div>' +
      '<span class="caption" title="' + esc(exactTime(c.last_event_at)) + '">Last sale or payout: ' + esc(when(c.last_event_at, d.__now)) +
      ' · ' + esc(String(c.event_count || 0)) + (c.event_count === 1 ? " event" : " events") + '</span>';

    if (reveal && reveal.id === c.id && reveal.api_key) {
      html += '<div class="once" role="status"><strong>Your key — shown this one time</strong>' +
        '<span class="caption">Copy it now and put it in your processor or system. Fundhub keeps only a scrambled copy and cannot show it again.</span>' +
        copyRow(reveal.api_key, "Copy key") +
        '<span class="caption">Send events to</span>' + copyRow(d.open_api_url || "/api/merchant/events", "Copy address") + '</div>';
    } else if (c.provider === "api" && c.status !== "disabled") {
      html += '<span class="caption">Key ending in <span class="mono">' + esc(c.api_key_hint || "····") + '</span> · send events to</span>' +
        copyRow(d.open_api_url || "/api/merchant/events", "Copy address");
    }

    if (c.provider !== "api" && c.status !== "disabled") {
      html += '<span class="caption">Webhook address — paste this into ' + esc(c.provider_label) + '</span>' + copyRow(c.webhook_url, "Copy address");
      html += '<div class="field"><label for="sec-' + esc(c.id) + '">' +
        (c.has_secret ? "Signing secret saved. Paste a new one to replace it." : "Paste the signing secret " + esc(c.provider_label) + " shows you") +
        '</label><input id="sec-' + esc(c.id) + '" type="password" autocomplete="off" spellcheck="false" data-secret="' + esc(c.id) + '">' +
        '<button class="btn" type="button" data-act="secret" data-id="' + esc(c.id) + '">Save secret</button></div>';
    }
    if (c.status !== "disabled") {
      html += '<div class="off-row"><button class="btn-text" type="button" data-act="disable" data-id="' + esc(c.id) + '" data-name="' +
        esc(c.provider_label + " for " + (c.entity_name || "this business")) + '">Turn off</button></div>';
    }
    html += '<p class="act-msg caption" aria-live="polite"></p></div>';
    return html;
  }

  function renderProviders(d, reveal) {
    var conns = list(d.connections);
    var noContainers = list(d.containers).length === 0;
    var cards = PROVIDERS.map(function (p) {
      var mine = conns.filter(function (c) { return c.provider === p.id; });
      var live = mine.filter(function (c) { return c.status === "active"; }).length;
      var word = live ? "Connected" : (mine.some(function (c) { return c.status === "waiting"; }) ? "Waiting for secret" : "Not connected");
      var stateCls = live ? "state-active" : (word === "Waiting for secret" ? "state-waiting" : "");
      var body = noContainers
        ? '<p class="caption">Add a business first, then connect it here.</p>'
        : containerSelect(d, p.id) +
          '<button class="btn" type="button" data-act="create" data-provider="' + esc(p.id) + '">Connect ' + esc(p.name) + '</button>' +
          '<p class="act-msg caption" aria-live="polite"></p>';
      return '<section class="card prov" data-provider="' + esc(p.id) + '">' +
        '<div class="prov-head"><div><h2 class="prov-name">' + esc(p.name) + '</h2><p class="caption">' + esc(p.blurb) + '</p></div>' +
        '<span class="state ' + stateCls + '">' + esc(word) + '</span></div>' +
        body + mine.map(function (c) { return connectionBlock(d, c, reveal); }).join("") + '</section>';
    }).join("");
    return '<div class="grid thirds">' + cards + '</div>';
  }

  function monthRows(months, label) {
    return list(months).slice().reverse().map(function (m) {
      return '<tr><td>' + esc(label ? label : monthName(m.month)) + '</td>' +
        '<td class="r">' + esc(money(m.sales_cents)) + '</td>' +
        '<td class="r">' + esc(money(m.refunds_cents)) + '</td>' +
        '<td class="r">' + esc(money(m.fees_cents)) + '</td>' +
        '<td class="r">' + esc(money(m.net_cents)) + '</td>' +
        '<td class="r">' + esc(money(m.payouts_cents)) + '</td></tr>';
    }).join("");
  }

  function renderMonths(d) {
    if (!hasConnections(d)) return "";
    var s = d.summary || {};
    var head = '<tr><th>Month</th><th class="r">Sales</th><th class="r">Refunds</th><th class="r">Fees</th><th class="r">Net</th><th class="r">Paid out</th></tr>';
    var parts = list(s.containers).map(function (c) {
      return '<section class="card block-card"><h3 class="eyebrow">' + esc(c.name || "Business") + '</h3>' +
        '<div class="scroll-x"><table><thead>' + head + '</thead><tbody>' + monthRows(c.months) + '</tbody></table></div></section>';
    });
    if (list(s.containers).length > 1) {
      parts.push('<section class="card block-card"><h3 class="eyebrow">All businesses</h3>' +
        '<div class="scroll-x"><table><thead>' + head + '</thead><tbody>' + monthRows(s.totals) + '</tbody></table></div></section>');
    }
    var other = isNum(s.other_currency_events) && s.other_currency_events > 0
      ? '<p class="caption">' + esc(s.other_currency_events) + ' events in another currency are not added in.</p>' : "";
    return '<section class="block"><h2>Month over month</h2>' +
      '<p class="caption">Net is sales minus refunds and fees. Paid out is money the processor sent to your bank.</p>' +
      other + '<div class="grid one-col">' + parts.join("") + '</div></section>';
  }

  function renderHead() {
    return '<div class="head"><div><h1>Connections</h1><p class="caption">' +
      'Your sales and payouts from Commas, Whop, or any other processor. Fundhub only reads them. It never moves money.' +
      '</p></div></div>';
  }

  function renderEmptyNote(d) {
    if (hasConnections(d)) return "";
    if (list(d.containers).length === 0) {
      return '<section class="card empty"><h2>No business set up yet</h2>' +
        '<p>Sales come in per business. Add your business first, then come back and connect its processor.</p>' +
        '<a class="btn-primary" href="/app/money-accounts.html">Add a business</a></section>';
    }
    return '<section class="card empty"><h2>No processor connected yet</h2>' +
      '<p>Connect Commas, Whop, or any other processor below. Your sales, refunds and payouts will show here month by month.</p></section>';
  }

  function render(d, reveal) {
    return renderHead(d) + renderEmptyNote(d) + renderTiles(d) + renderProviders(d, reveal) + renderMonths(d);
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    var card = '<div class="card skel"><span class="sk sk-m"></span><span class="sk sk-s"></span><span class="sk sk-l"></span></div>';
    return '<div class="head"><div><h1>Connections</h1><p class="caption">Loading your connections…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + tile + '</div>' +
      '<div class="grid thirds">' + card + card + card + '</div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your connections. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose file to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Connections</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your connections</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }


  /* ── browser only ──────────────────────────────────────────────────────── *
   *
   * MOUNTABLE SECTION (owner change 2026-10-06: one FinanceOS page with tabs).
   *
   *   window.FinanceOS.sections.connections.mount(el, ctx)
   *     el  — the container element. The section paints inside it and nothing
   *           else: no header, no nav, no page chrome.
   *     ctx — { clientId, apiGet(path), apiPost(path, body), onSignIn? }
   *           apiGet / apiPost return Promise<{ status, body }> (the same shape
   *           call() below returns). clientId is "" for a client session (the
   *           server pins it) or the uuid staff opened the file for.
   *           onSignIn() is called on a 401; without it the section sends the
   *           person to the right sign-in page itself.
   *   returns { reload(), unmount() }
   *
   * /app/money-connections.html is a thin shell that builds ctx from fetch()
   * and mounts this section, so the section works on its own too. */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function call(method, path, body) {
    var headers = { accept: "application/json" };
    var t = token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    var started;
    try { started = root.fetch(path, init); } catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }

  function classify(res) {
    var s = res.status, b = res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0) return "offline";
    if (s === 404) return (b && b.error === "not_found" && typeof b.path === "string") ? "offline" : "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "badrequest";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true) return "server";
    return "ok";
  }

  function signInUrl() {
    var role = "";
    try { role = root.localStorage.getItem("fh_role") || ""; } catch (e) {}
    var staffish = (role && role !== "client") || !!param("client_id");
    return staffish
      ? "/login.html?next=" + encodeURIComponent(root.location.pathname + root.location.search)
      : "/portal-login.html";
  }

  var ACTION_WORDS = {
    signin: "You are signed out. Sign in and try again.",
    forbidden: "This account is not allowed to change connections here.",
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "That did not save. Try again in a few minutes.",
    server: "That did not save. Try again in a few minutes.",
    notfound: "That business or connection is not on this file.",
    badrequest: "That was not accepted."
  };
  function actionWords(res) {
    if (res.body && res.body.error === "not_configured") return "Webhook secrets cannot be saved yet. We are fixing it.";
    if (res.body && res.body.message && res.status === 400) return res.body.message;
    return ACTION_WORDS[classify(res)] || ACTION_WORDS.server;
  }

  function msgNear(btn) {
    var box = btn.closest(".conn") || btn.closest(".prov");
    return box ? box.querySelector(".act-msg") : null;
  }
  function busy(btn, label) { btn.disabled = true; btn.setAttribute("data-label", btn.textContent); btn.textContent = label; }
  function idle(btn) { btn.disabled = false; btn.textContent = btn.getAttribute("data-label") || btn.textContent; }

  function mount(el, ctx) {
    var c = ctx || {};
    var clientId = c.clientId || "";
    var get = c.apiGet || function (p) { return call("GET", p); };
    var post = c.apiPost || function (p, b) { return call("POST", p, b); };
    var state = { data: null, reveal: null, alive: true };

    function paint(html) { if (state.alive) el.innerHTML = html; }
    function show() {
      if (!state.data) return;
      state.data.__now = Date.now();
      paint(render(state.data, state.reveal));
    }
    function signIn() {
      if (typeof c.onSignIn === "function") c.onSignIn();
      else root.location.href = signInUrl();
    }
    function load(keepReveal) {
      if (!state.data) paint(renderLoading());
      return Promise.resolve(get(PATH + (clientId ? "?client_id=" + encodeURIComponent(clientId) : ""))).then(function (res) {
        var kind = classify(res || { status: 0 });
        if (kind === "signin") { signIn(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        state.data = res.body;
        if (!keepReveal) state.reveal = null;
        show();
      });
    }
    function send(body) {
      if (clientId) body.client_id = clientId;
      return Promise.resolve(post(PATH, body)).then(function (r) { return r || { status: 0, body: null }; });
    }

    function create(btn) {
      var provider = btn.getAttribute("data-provider");
      var sel = el.querySelector('[data-ent="' + provider + '"]');
      var msg = msgNear(btn);
      if (!sel || !sel.value) { if (msg) msg.textContent = "Pick a business first."; return; }
      busy(btn, "Connecting…");
      send({ action: "create", provider: provider, entity_id: sel.value }).then(function (res) {
        if (res.status !== 201 || !res.body || res.body.ok !== true) {
          if (res.status === 401) { signIn(); return; }
          idle(btn); if (msg) msg.textContent = actionWords(res); return;
        }
        state.reveal = res.body.api_key ? { id: res.body.connection.id, api_key: res.body.api_key } : null;
        return load(true);
      });
    }

    function saveSecret(btn) {
      var id = btn.getAttribute("data-id");
      var input = el.querySelector('[data-secret="' + id + '"]');
      var msg = msgNear(btn);
      var secret = input ? input.value.trim() : "";
      if (!secret) { if (msg) msg.textContent = "Paste the signing secret first."; return; }
      busy(btn, "Saving…");
      send({ action: "secret", connection_id: id, secret: secret }).then(function (res) {
        if (input) input.value = "";
        if (classify(res) === "signin") { signIn(); return; }
        if (classify(res) !== "ok") { idle(btn); if (msg) msg.textContent = actionWords(res); return; }
        return load(false);
      });
    }

    function disable(btn) {
      var name = btn.getAttribute("data-name") || "this connection";
      var ok = root.confirm("Turn off " + name + "? New sales and payouts from it will stop coming in. What is already here stays.");
      if (!ok) return;
      var msg = msgNear(btn);
      busy(btn, "Turning off…");
      send({ action: "disable", connection_id: btn.getAttribute("data-id") }).then(function (res) {
        if (classify(res) === "signin") { signIn(); return; }
        if (classify(res) !== "ok") { idle(btn); if (msg) msg.textContent = actionWords(res); return; }
        return load(false);
      });
    }

    function copy(btn) {
      var v = btn.getAttribute("data-copy") || "";
      var label = btn.textContent;
      var done = function () { btn.textContent = "Copied"; root.setTimeout(function () { btn.textContent = label; }, 1500); };
      try {
        root.navigator.clipboard.writeText(v).then(done, function () { btn.textContent = "Select and copy"; });
      } catch (e) { btn.textContent = "Select and copy"; }
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      var a = t.getAttribute("data-act");
      if (a === "create") create(t);
      else if (a === "secret") saveSecret(t);
      else if (a === "disable") disable(t);
      else if (a === "copy") copy(t);
      else if (a === "retry") load(false);
    }

    if (el.classList) el.classList.add("fos-connections"); // scopes money-connections.css
    el.addEventListener("click", onClick);
    load(false);
    return {
      reload: function () { return load(false); },
      unmount: function () { state.alive = false; el.removeEventListener("click", onClick); el.innerHTML = ""; }
    };
  }

  var section = { mount: mount };
  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.connections = section;

  root.FHMoneyConnections = {
    money: money, when: when, versus: versus, render: render, renderLoading: renderLoading,
    renderError: renderError, classify: classify, mount: mount
  };

  /* Standalone shell: /app/money-connections.html carries #conn-root. On the
     combined FinanceOS page there is no #conn-root, so nothing auto-mounts. */
  function standalone() {
    var el = root.document.getElementById("conn-root");
    if (!el) return;
    var cid = param("client_id");
    if (cid) {
      var links = root.document.querySelectorAll(".mnav a");
      for (var i = 0; i < links.length; i++) {
        links[i].setAttribute("href", links[i].getAttribute("href") + "?client_id=" + encodeURIComponent(cid));
      }
      var back = root.document.getElementById("money-back");
      if (back) {
        back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
        back.textContent = "Back to Finance OS";
      }
    }
    mount(el, { clientId: cid });
  }

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", standalone);
    else standalone();
  }
})(typeof window !== "undefined" ? window : globalThis);
