/* Local banks — "Your bank plan" for the next 6 months and the "Branches near
 * you" list (Finance OS wave 4, unit LOC). A self-contained component: Finance OS
 * (Banks) and the Blueprint dashboard mount it where they want it.
 *
 * Reads ONE endpoint, GET /api/money/banks?view=local_banks, and paints it. The
 * rules live in src/finance/local-banks.mjs: banks from the FDIC's BankFind
 * data, credit unions from the NCUA, distance between ZIP areas, Giovanni's
 * list first. Every word on the screen is a field from that read.
 *
 * THE HONESTY RULES (same as money.js):
 *   - An unknown is said in words ("Not set"), never as 0.
 *   - Status is said in words (Planned, Opened, Deposited, Seasoned), never by colour alone.
 *   - Logos: only Plaid's PNG or the bank book's own file. No logo, name only.
 *   - No date is made up. The day to open stays the one your Fundhub team sets.
 *
 * HOW TO MOUNT
 *   <link rel="stylesheet" href="/app/local-banks.css">
 *   <script defer src="/app/local-banks.js"></script>
 *   <div data-fh-local-banks></div>                     (auto-mounts; staff pages
 *                                                        carry ?client_id=)
 *   or, from a section's own mount:
 *   window.FHLocalBanks.mount(el, { clientId, apiGet, addressHref })
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/ui/local-banks.test.mjs runs them in Node. Styles: local-banks.css, every
 * rule under .fh-local-banks.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/banks?view=local_banks";
  var ADDRESS_PATH = "/app/financeos.html#accounts";
  var STATUS_WORD = { planned: "Planned", opened: "Opened", deposited: "Deposited", seasoned: "Seasoned" };
  var STATUS_TONE = { planned: "", opened: "info", deposited: "ok", seasoned: "ok" };
  var SAFE_LOGO = /^(data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+\/]*={0,2}|\/assets\/lenders\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|svg|jpe?g|webp))$/i;

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  /* 500000 → "$5,000". Not a number → null. */
  function money(cents) {
    if (!isNum(cents)) return null;
    var whole = Math.round(cents) % 100 === 0;
    var n = Math.abs(cents) / 100;
    var s = n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    return (cents < 0 ? "-$" : "$") + s;
  }

  /* The shared bank-logo helper when the page loads it; the same rule here when it does not. */
  function logo(src, name) {
    if (root.FHBankLogo && typeof root.FHBankLogo.html === "function") {
      var shared = root.FHBankLogo.html(src, name);
      return shared ? shared.replace('class="fh-bank-logo"', 'class="fh-bank-logo lb-logo"') : "";
    }
    var s = typeof src === "string" ? src : "";
    if (!s || s.indexOf("..") !== -1 || !SAFE_LOGO.test(s)) return "";
    return '<img class="lb-logo" src="' + esc(s) + '" alt="' + esc((name || "Bank") + " logo") +
      '" width="28" height="28" loading="lazy" decoding="async">';
  }

  function chip(word, tone) {
    return '<span class="lb-chip' + (tone ? " lb-" + tone : "") + '">' + esc(word) + "</span>";
  }

  /* "Home · 85004" — where a list was searched. The ZIP only, never a street. */
  function placeWords(places) {
    return list(places).map(function (p) {
      return [p.label, p.zip || [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" ");
    }).join(" · ");
  }

  /* "About 1.2 mi from the Home ZIP" · "Same ZIP as Cedar Grove LLC". The miles
     run between ZIP-area centers, never from a street, so a number says "About". */
  function whereWords(n) {
    var label = n.near && n.near.label ? n.near.label : "";
    if (n.distance_text === "Same ZIP") return "Same ZIP as " + (label || "you");
    if (n.distance_text === "Same city") return "Same city as " + (label || "you");
    if (!n.distance_text) return "";
    return "About " + n.distance_text + " from " + (label ? "the " + label + " ZIP" : "your ZIP");
  }

  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  /* ── the four states ───────────────────────────────────────────────────── */

  function renderLoading() {
    return '<section class="lb-panel" role="status" aria-busy="true">' +
      '<h2 class="lb-h2">Your bank plan</h2><p class="lb-cap">Loading…</p>' +
      '<span class="lb-sk lb-sk-l" aria-hidden="true"></span><span class="lb-sk lb-sk-m" aria-hidden="true"></span>' +
      '<span class="lb-sk lb-sk-m" aria-hidden="true"></span></section>';
  }

  var ERROR_WORDS = {
    forbidden: "Your login cannot see this file.",
    notfound: "We could not find this client file.",
    needclient: "Open this from a client file.",
    offline: "You look offline.",
    nodb: "Our records are busy right now.",
    badrequest: "That link is not right.",
    server: "Something went wrong on our side."
  };

  function renderError(kind, heading) {
    return '<section class="lb-panel" role="alert"><h2 class="lb-h2">' + esc(heading || "Your bank plan") + "</h2>" +
      '<p class="lb-body">This did not load. ' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + "</p>" +
      '<div class="lb-actions"><button type="button" class="lb-btn lb-dark" data-act="retry">Try again</button></div></section>';
  }

  function renderNeedsAddress(links) {
    return '<section class="lb-panel lb-empty"><h2 class="lb-h2">Branches near you</h2>' +
      '<p class="lb-body">Add your home or business ZIP to see banks near you.</p>' +
      '<div class="lb-actions"><a class="lb-btn lb-dark" href="' + esc(links.address) + '">Add an address</a></div></section>';
  }

  /* ── the plan ──────────────────────────────────────────────────────────── */

  function planLine(r) {
    if (r.near && r.near.text) return r.near.text;
    return r.on_list ? "On our bank list." : (r.reason || "");
  }

  function renderPlanRow(r, i) {
    var dep = money(r.deposit_cents);
    var status = STATUS_WORD[r.status] ? r.status : "planned";
    var tags = (r.kind === "credit_union" ? chip("Credit union", "") : "") + (r.join_check ? chip("Check who can join", "warn") : "");
    return '<li class="lb-row lb-plan-row">' +
      '<span class="lb-n" aria-hidden="true">' + (i + 1) + "</span>" +
      '<div class="lb-main"><p class="lb-name">' + logo(r.logo, r.name) + "<b>" + esc(r.name) + "</b></p>" +
      '<p class="lb-cap">' + esc(planLine(r)) + "</p>" + (tags ? '<p class="lb-tags">' + tags + "</p>" : "") + "</div>" +
      '<dl class="lb-side"><div><dt class="lb-cap">Deposit</dt><dd class="lb-num">' + (dep ? esc(dep) : '<span class="lb-unset">Not set</span>') +
      "</dd></div><div><dt class=\"lb-sr\">Status</dt><dd>" + chip(STATUS_WORD[status], STATUS_TONE[status]) + "</dd></div></dl></li>";
  }

  function renderPlan(d) {
    var plan = list(d.deposit_plan);
    var lb = d.local_banks || {};
    var months = lb.window && isNum(lb.window.months) ? lb.window.months : 6;
    var max = isNum(lb.plan_max) ? lb.plan_max : 5;
    var head = '<div class="lb-head"><div class="lb-l"><h2 class="lb-h2" id="lb-h-plan">Your bank plan</h2>' +
      '<p class="lb-cap">Next ' + esc(months) + " months · up to " + esc(max) + " banks</p></div>" +
      (plan.length ? '<p class="lb-count">' + esc(plan.length + (plan.length === 1 ? " bank" : " banks")) + "</p>" : "") + "</div>";
    var body = plan.length
      ? '<ol class="lb-rows">' + plan.map(renderPlanRow).join("") + "</ol>"
      : '<p class="lb-body lb-none">No banks on your plan yet. Your Fundhub team adds them.</p>';
    return '<section class="lb-panel" aria-labelledby="lb-h-plan">' + head + body + "</section>";
  }

  /* ── branches near you ─────────────────────────────────────────────────── */

  function renderNearRow(n) {
    var b = n.branch || {};
    var addr = [b.address, b.city].filter(Boolean).join(", ");
    var tags = (n.on_list ? chip("On our list", "ok") : chip("Local", "info")) +
      (n.kind === "credit_union" ? chip("Credit union", "") : "") +
      (n.join_check ? chip("Check who can join", "warn") : "");
    return '<li class="lb-row lb-near-row"><div class="lb-main">' +
      '<p class="lb-name">' + logo(n.logo, n.name) + "<b>" + esc(n.name) + "</b></p>" +
      '<p class="lb-cap">' + esc(addr) + "</p>" + '<p class="lb-tags">' + tags + "</p></div>" +
      '<p class="lb-dist lb-num">' + esc(whereWords(n)) + "</p></li>";
  }

  function renderNearby(d) {
    var lb = d.local_banks || {};
    var nearby = list(lb.nearby);
    var where = placeWords(lb.places);
    var head = '<div class="lb-head"><div class="lb-l"><h2 class="lb-h2" id="lb-h-near">Branches near you</h2>' +
      (where ? '<p class="lb-cap">' + esc(where) + "</p>" : "") + "</div></div>";
    var body = nearby.length
      ? '<ul class="lb-rows">' + nearby.map(renderNearRow).join("") + "</ul>"
      : '<p class="lb-body lb-none">No banks found near your addresses.</p>';
    return '<section class="lb-panel" aria-labelledby="lb-h-near">' + head + body +
      '<p class="lb-cap lb-foot">From FDIC and NCUA public data.</p></section>';
  }

  function render(d, links) {
    var lb = (d && d.local_banks) || {};
    if (lb.status === "unavailable") return renderPlan(d) + renderError("server", "Branches near you");
    if (lb.status === "needs_address") return renderPlan(d) + renderNeedsAddress(links);
    return renderPlan(d) + renderNearby(d);
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function call(method, path) {
    var localDemo = root.__fhBlueprintFullDemoRoute === true;
    var headers = { accept: "application/json" };
    var t = localDemo ? "" : token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (localDemo && typeof root.FHClientFetch !== "function") return Promise.resolve({ status: 503, body: { ok: false, error: "demo_unavailable" } });
    var started;
    try { started = localDemo ? root.FHClientFetch(path, init) : root.fetch(path, init); }
    catch (e) { return Promise.resolve({ status: 0, body: null }); }
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

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /**
   * mount(el, ctx) paints the bank plan and the branches near you into `el`.
   * ctx = { clientId, apiGet, addressHref, onSignIn }. clientId is for staff; a
   * client session leaves it empty (the server pins a client to their own file).
   * Returns { reload, unmount }.
   */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var links = { address: ctx.addressHref || withClient(ADDRESS_PATH, cid) };
    var data = null;

    function paint(html) { el.innerHTML = '<div class="fh-local-banks">' + html + "</div>"; }

    function load() {
      if (!data) paint(renderLoading());
      return get(READ_PATH + (cid ? "&client_id=" + encodeURIComponent(cid) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") {
          if (typeof ctx.onSignIn === "function") ctx.onSignIn();
          else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind !== "ok") { data = null; paint(renderError(kind)); return; }
        data = res.body;
        paint(render(data, links));
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      if (t.getAttribute("data-act") === "retry") { data = null; load(); }
    }
    /* A logo file that fails to load is removed, so the name stands alone. */
    function onImgError(e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("lb-logo") && t.parentNode) t.parentNode.removeChild(t);
    }

    el.addEventListener("click", onClick);
    el.addEventListener("error", onImgError, true);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("error", onImgError, true);
        el.innerHTML = "";
      }
    };
  }

  /* Auto-mount every <div data-fh-local-banks> once. */
  function autoMount() {
    if (!root.document || !root.document.querySelectorAll) return;
    var els = root.document.querySelectorAll("[data-fh-local-banks]");
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute("data-fh-local-banks-mounted")) continue;
      els[i].setAttribute("data-fh-local-banks-mounted", "true");
      mount(els[i], { clientId: els[i].getAttribute("data-client-id") || param("client_id") });
    }
  }

  root.FHLocalBanks = {
    mount: mount, render: render, renderPlan: renderPlan, renderNearby: renderNearby, renderNeedsAddress: renderNeedsAddress,
    renderError: renderError, renderLoading: renderLoading, classify: classify, money: money, logo: logo,
    placeWords: placeWords, whereWords: whereWords, planLine: planLine, withClient: withClient, autoMount: autoMount
  };

  /* Finance OS: the Banks tab's extra box (public/app/financeos.js mountTab gives
     an extra its own box after the section, so neither repaint wipes the other).
     It takes the page's own ctx (client, fetch, sign-in). Another unit's extra is
     never replaced. */
  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.extras = root.FinanceOS.extras || {};
  if (!root.FinanceOS.extras.banks) {
    root.FinanceOS.extras.banks = {
      mount: function (el, ctx) {
        var c = ctx || {};
        return mount(el, { clientId: c.clientId || "", apiGet: c.apiGet, onSignIn: c.onSignIn });
      }
    };
  }

  if (root.document && root.document.addEventListener) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", autoMount);
    else autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis);
