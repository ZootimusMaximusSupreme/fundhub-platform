/* Money setup — the client's Finance OS setup steps (/app/money-setup.html).
 *
 * Reads GET /api/money/setup and paints four steps:
 *   1 Pay setup fee → 2 Run your soft pull → 3 Add your businesses and
 *   accounts → 4 You're live.
 * Acts through POST /api/money/setup { action: "start_checkout" |
 * "request_soft_pull" }. Both answer with a URL; this page only goes there.
 * Nothing on this page charges a card or pulls credit by itself.
 *
 * HONESTY RULES (same as money.js):
 *   - Money arrives as integer cents. A price the owner has not set is null
 *     and paints "$X", never $0.00.
 *   - A step is "Done" only when the read says so.
 *   - A step that cannot be acted on today shows no button (UI-STANDARDS §5).
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-setup-screen.test.mjs runs them in Node against fixtures.
 *
 * ONE PAGE (owner change 2026-10-06): this file is the Setup section of
 * /app/financeos.html — window.FinanceOS.sections.setup.mount(el, ctx).
 * money-setup.html is a thin shell that mounts the same section.
 */
(function (root) {
  "use strict";

  var PATH = "/api/money/setup";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* cents → "$1,234.56"; a price not set yet → "$X". */
  function price(cents) {
    if (!isNum(cents)) return "$X";
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (cents < 0 ? "−$" : "$") + dollars + "." + c;
  }

  function day(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function list(v) { return Array.isArray(v) ? v : []; }

  function stepOf(d, key) {
    var s = list(d && d.steps);
    for (var i = 0; i < s.length; i++) if (s[i].key === key) return s[i];
    return { key: key, done: false };
  }

  /* Which step gets the ONE filled button: the first step not done that can
     actually be acted on today. Pay needs a price; soft pull needs nothing in
     flight. Steps 3 and 4 are links, never the filled button. */
  function primaryKey(d) {
    var pay = stepOf(d, "pay");
    var sp = d.soft_pull || {};
    if (!pay.done && (isNum(d.setup_fee_cents) || d.open_checkout)) return "pay";
    if (!stepOf(d, "soft_pull").done && !sp.requested) return "soft_pull";
    return null;
  }

  /* ── one step each ─────────────────────────────────────────────────────── */

  function stepRow(n, key, d, title, stateWords, bodyHtml) {
    var s = stepOf(d, key);
    var cls = s.done ? "done" : (d.current_step === key ? "now" : "later");
    return '<li class="step ' + cls + '" data-step="' + esc(key) + '">' +
      '<div class="mark" aria-hidden="true">' + (s.done ? "✓" : n) + '</div>' +
      '<div class="step-body"><div class="step-title">' + esc(title) + '</div>' +
      '<div class="state">' + esc(stateWords) + '</div>' + bodyHtml + '</div></li>';
  }

  function msg() { return '<p class="act-msg caption" aria-live="polite"></p>'; }

  function payStep(d, primary) {
    var s = stepOf(d, "pay");
    var fee = d.setup_fee_cents;
    var title = "Pay setup fee (" + price(fee) + ")";
    if (s.done) {
      return stepRow(1, "pay", d, title, "Done" + (d.paid_at ? " · paid " + day(d.paid_at) : ""),
        '<p class="caption">Your one-time setup is paid.</p>');
    }
    var cls = primary ? "btn-primary" : "btn-line";
    if (d.open_checkout && d.open_checkout.url) {
      return stepRow(1, "pay", d, title, "Not paid yet",
        '<p class="caption">You started a checkout for ' + esc(price(d.open_checkout.amount_cents)) + '. Finish it to pay.</p>' +
        '<div class="step-act"><a class="' + cls + '" href="' + esc(d.open_checkout.url) + '" rel="noopener">Finish paying</a></div>');
    }
    if (!isNum(fee)) {
      return stepRow(1, "pay", d, title, "Price not set yet",
        '<p class="caption">The setup price is not set yet. It shows here once it is, and then you can pay.</p>');
    }
    return stepRow(1, "pay", d, title, "Not paid yet",
      '<p class="caption">One payment, one time. You go to a secure checkout page to pay.</p>' +
      '<div class="step-act"><button class="' + cls + '" type="button" data-act="checkout">Pay ' + esc(price(fee)) + ' setup</button>' +
      msg() + '</div>');
  }

  function softPullStep(d, primary) {
    var s = stepOf(d, "soft_pull");
    var sp = d.soft_pull || {};
    var title = "Run your soft pull (no hard inquiry)";
    if (s.done) {
      return stepRow(2, "soft_pull", d, title, "Done" + (sp.last_pulled_at ? " · last pulled " + day(sp.last_pulled_at) : ""),
        '<p class="caption">Your business credit is on file. See it on the Credit page.</p>' +
        '<div class="step-act"><a class="btn-line" href="money-credit.html">See my credit</a></div>');
    }
    if (sp.requested) {
      return stepRow(2, "soft_pull", d, title, "Waiting on results",
        '<p class="caption">Your soft pull is in. Results show here when they come back.</p>');
    }
    var p = sp.price || {};
    var cost = isNum(p.base_cents)
      ? " The form costs " + price(p.base_cents) + (isNum(p.business_addon_cents) ? ", plus " + price(p.business_addon_cents) + " for each business you add." : ".")
      : "";
    return stepRow(2, "soft_pull", d, title, "Not done yet",
      '<p class="caption">A soft pull is not a hard inquiry. It does not hurt your score.' + esc(cost) + '</p>' +
      '<div class="step-act"><button class="' + (primary ? "btn-primary" : "btn-line") + '" type="button" data-act="soft-pull">Run soft pull</button>' +
      msg() + '</div>');
  }

  function accountsStep(d) {
    var s = stepOf(d, "accounts");
    var n = isNum(d.containers) ? d.containers : 0;
    return stepRow(3, "accounts", d, "Add your businesses and accounts",
      s.done ? "Done · " + plural(n, "container", "containers") : "Not done yet",
      '<p class="caption">Add each business, then its bank accounts and cards.</p>' +
      '<div class="step-act"><a class="btn-line" href="money-accounts.html">' + (s.done ? "Add more" : "Add businesses and accounts") + '</a></div>');
  }

  function liveStep(d) {
    var s = stepOf(d, "live");
    if (s.done) {
      return stepRow(4, "live", d, "You're live", "Done",
        '<p class="caption">Your Money pages are on.</p>' +
        '<div class="step-act"><a class="btn-line" href="money.html">Open Money</a></div>');
    }
    return stepRow(4, "live", d, "You're live", "Not yet",
      '<p class="caption">Your Money pages turn on when your plan is active.</p>');
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderPrice(d) {
    var n = isNum(d.containers) ? d.containers : 0;
    var line = "Setup " + price(d.setup_fee_cents) + " one time · " + price(d.price_per_container_cents) +
      " per container per month · you have " + plural(n, "container", "containers");
    return '<section class="card price-card" aria-labelledby="h-price"><h2 class="eyebrow" id="h-price">Your price</h2>' +
      '<ul class="price-list">' +
      '<li><span>Setup, one time</span><span class="num">' + esc(price(d.setup_fee_cents)) + '</span></li>' +
      '<li><span>Per container, per month</span><span class="num">' + esc(price(d.price_per_container_cents)) + '</span></li>' +
      '<li><span>Your containers</span><span class="num">' + esc(String(n)) + '</span></li>' +
      '</ul><p class="caption price-line">' + esc(line) + '</p>' +
      '<p class="caption">Each business is one container. So is each person.</p></section>';
  }

  function doneCount(d) {
    return list(d.steps).filter(function (s) { return s.done; }).length;
  }

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name + " · " : "";
    var sub = d ? who + doneCount(d) + " of 4 steps done" : "Four quick steps";
    return '<div class="head"><div><h1>Set up Money</h1><p class="caption">' + esc(sub) + '</p></div></div>';
  }

  function render(d) {
    var pk = primaryKey(d);
    return renderHead(d) +
      '<div class="grid">' +
      '<section class="card steps-card" aria-labelledby="h-steps"><h2 class="eyebrow" id="h-steps">Your steps</h2>' +
      '<ol class="steps">' + payStep(d, pk === "pay") + softPullStep(d, pk === "soft_pull") +
      accountsStep(d) + liveStep(d) + '</ol></section>' +
      renderPrice(d) + '</div>';
  }

  function renderLoading() {
    var row = '<div class="skel"><span class="sk sk-m"></span><span class="sk sk-s"></span></div>';
    return '<div class="head"><div><h1>Set up Money</h1><p class="caption">Loading your setup…</p></div></div>' +
      '<div class="grid" aria-busy="true"><div class="card steps-card skel">' + row + row + row + row + '</div>' +
      '<div class="card price-card skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div></div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your setup. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose setup to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Set up Money</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your setup</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  /* What a button press answered, in words. */
  function actWords(res, act) {
    var b = res.body || {};
    if (res.status === 409 && b.error === "price_not_set") return "The setup price is not set yet. Nothing was charged.";
    if (res.status === 503) return b.message || "This is not set up yet. Nothing was charged.";
    if (res.status === 502) return b.message || "The checkout page could not be made. Nothing was charged.";
    if (res.status === 401) return "You are signed out. Sign in and try again.";
    if (res.status === 403) return "This account is not allowed to do that.";
    if (res.status === 0) return "We could not reach the server. Check your connection and try again.";
    return act === "checkout"
      ? "The checkout page could not be opened. Nothing was charged. Try again in a few minutes."
      : "The soft-pull form could not be opened. Try again in a few minutes.";
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

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
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
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

  /* ── the section ───────────────────────────────────────────────────────────
     window.FinanceOS.sections.setup.mount(el, ctx) — the one-page FinanceOS
     (/app/financeos.html) mounts this into its Setup tab. No header, no nav:
     only the section. ctx = { clientId, apiGet(path), apiPost(path, body) };
     apiGet/apiPost resolve to { status, body }. Any of them may be left out,
     and the section then uses its own fetch and ?client_id= from the URL.
     Returns { reload } so the host can refresh it. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : function (p) { return call("GET", p); };
    var post = typeof ctx.apiPost === "function" ? ctx.apiPost : function (p, b) { return call("POST", p, b); };
    var cid = ctx.clientId || param("client_id") || "";
    var qs = cid ? "?client_id=" + encodeURIComponent(cid) : "";

    function paint(html) { el.innerHTML = html; }

    function load() {
      paint(renderLoading());
      return Promise.resolve(get(PATH + qs)).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        paint(render(res.body));
      });
    }

    function act(btn, action, busyLabel) {
      var box = btn.parentNode;
      var m = box && box.querySelector(".act-msg");
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = busyLabel;
      if (m) m.textContent = "";
      var body = { action: action };
      if (cid) body.client_id = cid;
      Promise.resolve(post(PATH + qs, body)).then(function (res) {
        var url = res.body && (res.body.checkout_url || res.body.approve_url);
        if (res.status === 200 && res.body && res.body.ok === true && res.body.already_paid) { load(); return; }
        if (res.status === 200 && url) { root.location.href = url; return; }
        btn.disabled = false;
        btn.textContent = label;
        if (m) m.textContent = actWords(res, action === "start_checkout" ? "checkout" : "soft-pull");
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      var a = t.getAttribute("data-act");
      if (a === "retry") load();
      if (a === "checkout") act(t, "start_checkout", "Opening checkout…");
      if (a === "soft-pull") act(t, "request_soft_pull", "Opening the form…");
    });

    load();
    return { reload: load };
  }

  /* ── the standalone page (/app/money-setup.html) — a thin shell ────────── */
  function init() {
    var el = root.document.getElementById("setup-root");
    if (!el) return;
    /* Staff carry ?client_id= on the money nav, and go back to Finance OS.
       The query goes before any #tab, so /app/financeos.html#setup keeps it. */
    var cid = param("client_id");
    if (cid) {
      var navLinks = root.document.querySelectorAll(".mnav a[href]");
      for (var i = 0; i < navLinks.length; i++) {
        var parts = navLinks[i].getAttribute("href").split("#");
        var href = parts[0].split("?")[0] + "?client_id=" + encodeURIComponent(cid);
        navLinks[i].setAttribute("href", parts.length > 1 ? href + "#" + parts.slice(1).join("#") : href);
      }
      var back = root.document.getElementById("money-back");
      if (back) {
        back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
        back.textContent = "Back to Finance OS";
      }
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.setup = { title: "Setup", mount: mount };

  root.FHMoneySetup = {
    price: price, render: render, renderLoading: renderLoading, renderError: renderError,
    primaryKey: primaryKey, classify: classify, actWords: actWords, mount: mount
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
