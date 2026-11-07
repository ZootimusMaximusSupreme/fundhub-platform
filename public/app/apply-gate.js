/* Apply gate — "Can you apply yet?", the seasoning clock and the odds at each
 * bank (Finance OS wave 3, unit L4). A self-contained component: the Blueprint
 * dashboard and Finance OS mount it where they want it.
 *
 * Reads ONE endpoint, GET /api/money/banks?view=apply_gate, and paints it.
 * The rules live in src/finance/apply-gate.mjs; every sentence on the screen is
 * a field from that read. Nothing here invents a number, a day or a bank.
 *
 * THE HONESTY RULES (same as money.js):
 *   - An unknown is said in words ("Not on file"), never as a pass and never as 0.
 *   - Status is said in words (Done / Not yet, Ready / Wait / Not yet), never by
 *     colour alone.
 *   - "Ready" is the gate. Short client words (owner rule 2026-11-07): no
 *     disclaimer lines, one short caption at most.
 *   - Each bank's own logo from the read (`logo`: Plaid first, then the bank
 *     book), drawn by the shared bank-logo.js. No logo, name only.
 *
 * Staff (the server says can_override) also see one control per bank with a
 * stated application limit: "Allow more here" or "Back to the book's limit".
 * A client never sees it, and the server refuses a client's POST anyway.
 *
 * HOW TO MOUNT
 *   <link rel="stylesheet" href="/app/apply-gate.css">
 *   <script defer src="/app/apply-gate.js"></script>
 *   <div data-fh-apply-gate></div>                      (auto-mounts; staff pages
 *                                                         carry ?client_id=)
 *   or, from a section's own mount:
 *   window.FHApplyGate.mount(el, { clientId, apiGet, apiPost, setupHref })
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/ui/apply-gate.test.mjs runs them in Node. Styles: apply-gate.css, every
 * rule under .fh-apply-gate.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/banks?view=apply_gate";
  var WRITE_PATH = "/api/money/banks";
  var SETUP_PATH = "/app/financeos.html#setup";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SHOWN = 6;

  var ODDS_WORD = { ready: "Ready", wait: "Wait", not_yet: "Not yet" };
  var ODDS_TONE = { ready: "ok", wait: "warn", not_yet: "" };
  var KIND_WORD = { personal: "Personal", business: "Business", both: "Personal and business" };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  /* "2027-01-06" → "Jan 6, 2027". Unknown → "—". */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  /* A logo the read can carry, or "": a bank-book file under /assets/lenders/,
     or Plaid's own PNG (the same two the shared bank-logo.js accepts). */
  function logoSrc(p) {
    var s = String(p || "");
    if (/^\/assets\/lenders\/[A-Za-z0-9._-]+\.(png|svg|jpg|jpeg|webp)$/i.test(s)) return s;
    return /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+\/]*={0,2}$/.test(s) ? s : "";
  }

  /* The bank's own logo: `logo` (Plaid first, then the bank book), else the
     book's `logo_path`. The shared helper draws it when the page loads it. */
  function logo(row) {
    var p = row && row.logo ? row.logo : row && row.logo_path;
    if (root.FHBankLogo && typeof root.FHBankLogo.html === "function") return root.FHBankLogo.html(p, row && row.bank);
    var src = logoSrc(p);
    return src ? '<img class="ag-logo" src="' + esc(src) + '" alt="" width="28" height="28" decoding="async">' : "";
  }

  function chip(word, tone) {
    return '<span class="ag-chip' + (tone ? " ag-" + tone : "") + '">' + esc(word) + "</span>";
  }

  /** A check's chip: Done / Not yet / Not on file. */
  function checkChip(passed) {
    if (passed === true) return chip("Done", "ok");
    if (passed === false) return chip("Not yet", "");
    return chip("Not on file", "");
  }

  /** Where the clock bar sits, 0–90 days, as one of 19 steps (5-day steps) so
   *  the width lives in the stylesheet, never in a style= attribute. */
  function barStep(dayN) {
    if (!isNum(dayN) || dayN <= 0) return 0;
    return Math.min(18, Math.round(Math.min(dayN, 90) / 5));
  }

  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  /* ── the four states ───────────────────────────────────────────────────── */

  function renderLoading() {
    return '<section class="ag-panel" role="status" aria-busy="true">' +
      '<span class="ag-cap">Before round 1</span><h2 class="ag-h2">Can you apply yet?</h2>' +
      '<p class="ag-cap">Loading your apply check…</p>' +
      '<span class="ag-sk ag-sk-l" aria-hidden="true"></span><span class="ag-sk ag-sk-m" aria-hidden="true"></span>' +
      '<span class="ag-sk ag-sk-m" aria-hidden="true"></span></section>';
  }

  var ERROR_WORDS = {
    forbidden: "Your login cannot see this file.",
    notfound: "We could not find this client file.",
    needclient: "Open this from a client file so we know whose check to show.",
    offline: "You look offline. Check your connection.",
    nodb: "Our records are busy right now.",
    badrequest: "That link is not right.",
    server: "Something went wrong on our side."
  };

  function renderError(kind) {
    return '<section class="ag-panel" role="alert">' +
      '<span class="ag-cap">Before round 1</span><h2 class="ag-h2">Can you apply yet?</h2>' +
      '<p class="ag-body">We could not load your apply check. ' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + "</p>" +
      '<div class="ag-actions"><button type="button" class="ag-btn ag-dark" data-act="retry">Try again</button></div></section>';
  }

  /** Empty: no credit pull and no bank account on the plan — nothing to check yet. */
  function isEmpty(d) {
    return !!d && d.ok === true && !d.has_pull && list(d.seasoning).length === 0;
  }

  function renderEmpty(d, links) {
    return '<section class="ag-panel ag-empty">' +
      '<span class="ag-cap">Before round 1</span><h2 class="ag-h2">Can you apply yet?</h2>' +
      '<p class="ag-body">Starts after your soft pull.</p>' +
      '<div class="ag-actions"><a class="ag-btn ag-dark" href="' + esc(links.setup) + '">Run your soft pull</a></div></section>';
  }

  /* ── the full screen ───────────────────────────────────────────────────── */

  function renderGate(d) {
    var g = d.gate || {};
    var open = g.status === "open";
    /* A passing check shows no sub-line: its title and "Done" say it all
       (QA16: "No hard inquiries / No hard inquiries on your file."). */
    var rows = list(g.checks).map(function (c) {
      return '<li class="ag-row"><div class="ag-t"><b>' + esc(c.label) + "</b>" +
        (c.passed === true || !c.text ? "" : '<span class="ag-cap">' + esc(c.text) + "</span>") +
        "</div>" + checkChip(c.passed) + "</li>";
    }).join("");
    /* One row per bank: a bank's limits read together. */
    var byBank = [];
    list(g.guidance).forEach(function (x) {
      var last = byBank.length ? byBank[byBank.length - 1] : null;
      if (last && last.bank === x.bank) last.texts.push(x.text);
      else byBank.push({ bank: x.bank, texts: [x.text] });
    });
    var guideHtml = byBank.length
      ? '<div class="ag-guide"><h3 class="ag-h3">Bank book limits</h3><p class="ag-cap">A guide, not a lock.</p><ul class="ag-rows">' +
        byBank.map(function (x) {
          return '<li class="ag-row"><div class="ag-t"><b>' + esc(x.bank) + '</b><span class="ag-cap">' + esc(x.texts.join(" ")) +
            "</span></div>" + chip("Guide", "info") + "</li>";
        }).join("") + "</ul></div>"
      : "";
    return '<section class="ag-panel" aria-labelledby="ag-h-gate">' +
      '<div class="ag-head"><div class="ag-l"><span class="ag-cap">Before round 1</span>' +
      '<h2 class="ag-h2" id="ag-h-gate">Can you apply yet?</h2>' +
      '<p class="ag-cap">Locked until every check is green.</p></div>' +
      chip(open ? "Ready to apply" : "Locked", open ? "ok" : "warn") + "</div>" +
      (d.sample ? '<p class="ag-note">Sample report.</p>' : "") +
      '<ul class="ag-rows">' + rows + "</ul>" + guideHtml + "</section>";
  }

  function renderClock(c) {
    var kind = c.account_kind ? (KIND_WORD[c.account_kind] || c.account_kind) + " account" : "Bank account";
    var known = isNum(c.day);
    var bar = known
      ? '<div class="ag-track" aria-hidden="true"><span class="ag-fill ag-w' + barStep(c.day) + '"></span>' +
        '<i class="ag-mark ag-m30"></i><i class="ag-mark ag-m60"></i><i class="ag-mark ag-m90"></i></div>' +
        '<div class="ag-marks" aria-hidden="true"><span>30 · seasoned</span><span>60 · better</span><span>90 · even better</span></div>'
      : "";
    var dayWord = known ? "Day " + c.day : (c.milestone === "day_unknown" ? "Open day not recorded" : "Not open yet");
    var tone = c.seasoned === true ? "ok" : (known ? "warn" : "");
    var book = isNum(c.book_days) && c.book_days > (c.target_days || 30)
      ? '<p class="ag-cap">The bank book asks for ' + esc(c.book_days) + " days at " + esc(c.bank) + ".</p>"
      : "";
    return '<li class="ag-clock">' +
      '<div class="ag-bank-head"><div class="ag-name">' + logo(c) +
      '<div class="ag-t"><b>' + esc(c.bank) + '</b><span class="ag-cap">' + esc(kind) +
      (c.opened_on ? " · opened " + esc(day(c.opened_on)) : "") + "</span></div></div>" + chip(dayWord, tone) + "</div>" +
      (c.congrats ? '<p class="ag-congrats" role="status">' + esc(c.congrats) + "</p>" : "") +
      bar + '<p class="ag-cap">' + esc(c.text) + "</p>" + book + "</li>";
  }

  function renderSeasoning(d) {
    var clocks = list(d.seasoning);
    var r = d.rules || {};
    var head = '<h3 class="ag-h3" id="ag-h-season">Bank account seasoning</h3>' +
      '<p class="ag-cap">' + esc(r.seasoning_days || 30) + " days is seasoned. " +
      esc(list(r.better_days).join(" and ") || "60 and 90") + " are even better.</p>";
    var body = clocks.length
      ? '<ul class="ag-clocks">' + clocks.map(renderClock).join("") + "</ul>"
      : '<p class="ag-body ag-none">No bank account is on your plan yet. Your Fundhub team adds the banks to open.</p>';
    return '<section class="ag-panel" aria-labelledby="ag-h-season">' + head + body + "</section>";
  }

  function renderBank(o, d, i, showAll) {
    var hidden = !showAll && i >= SHOWN;
    var products = list(o.products);
    var sub = [o.kind ? KIND_WORD[o.kind] || o.kind : "", products.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
    var reasons = list(o.reasons).map(function (r) { return "<li>" + esc(r.text) + "</li>"; }).join("");
    var limits = list(o.limits);
    var allowed = !!(o.override && o.override.allow_more);
    /* A reached limit is already a reason above; otherwise the book's limit shows as a guide. */
    var reached = limits.some(function (l) { return l.reached && !allowed; });
    var limitText = limits.length && !reached
      ? '<p class="ag-cap">' + esc(limits.map(function (l) { return l.text; }).join(" ")) + " A guide, not a lock.</p>"
      : "";
    var when = o.status === "wait" && o.ready_on
      ? '<p class="ag-cap ag-when">Earliest day to apply here: ' + esc(day(o.ready_on)) + ".</p>"
      : "";
    var control = "";
    if (d.can_override && limits.length) {
      var allowing = allowed;
      control = '<div class="ag-actions"><button type="button" class="ag-btn" data-act="override" data-bank="' +
        esc(o.bank) + '" data-allow="' + (allowing ? "false" : "true") + '">' +
        (allowing ? "Back to the book's limit" : "Allow more here") + "</button>" +
        (o.override && o.override.note ? '<span class="ag-cap">Team note: ' + esc(o.override.note) + "</span>" : "") +
        '<span class="ag-msg" data-msg-for="' + esc(o.bank) + '"></span></div>';
    }
    return '<li class="ag-bank"' + (hidden ? " hidden" : "") + ">" +
      '<div class="ag-bank-head"><div class="ag-name">' + logo(o) +
      '<div class="ag-t"><b>' + esc(o.bank) + "</b>" + (sub ? '<span class="ag-cap">' + esc(sub) + "</span>" : "") +
      "</div></div>" + chip(ODDS_WORD[o.status] || "Not yet", ODDS_TONE[o.status] || "") + "</div>" +
      (reasons ? '<ul class="ag-reasons">' + reasons + "</ul>" : "") + when + limitText + control + "</li>";
  }

  function renderOdds(d, showAll) {
    var odds = list(d.odds);
    var c = d.counts || {};
    var head = '<div class="ag-head"><div class="ag-l"><h3 class="ag-h3" id="ag-h-odds">Your odds at each bank</h3>' +
      '<p class="ag-cap">Banks on the Fundhub bank list for your state, in the order your plan uses. ' +
      "Ready means every check is green for that bank.</p></div>" +
      (odds.length ? '<p class="ag-count">' + esc((c.ready || 0) + " ready · " + (c.wait || 0) + " wait · " + (c.not_yet || 0) + " not yet") + "</p>" : "") +
      "</div>";
    if (!odds.length) {
      return '<section class="ag-panel" aria-labelledby="ag-h-odds">' + head +
        '<p class="ag-body ag-none">No bank on the Fundhub list matches your state yet. Your Fundhub team checks your address and adds banks.</p></section>';
    }
    var more = odds.length > SHOWN
      ? '<div class="ag-actions"><button type="button" class="ag-btn" data-act="more" aria-expanded="' + (showAll ? "true" : "false") + '">' +
        (showAll ? "Show fewer banks" : "Show all " + odds.length + " banks") + "</button></div>"
      : "";
    return '<section class="ag-panel" aria-labelledby="ag-h-odds">' + head +
      '<ul class="ag-banks">' + odds.map(function (o, i) { return renderBank(o, d, i, showAll); }).join("") + "</ul>" +
      more + "</section>";
  }

  function renderFull(d, showAll) {
    return renderGate(d) + renderSeasoning(d) + renderOdds(d, !!showAll);
  }

  function render(d, links, showAll) {
    if (isEmpty(d)) return renderEmpty(d, links);
    return renderFull(d, showAll);
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function call(method, path, body) {
    var localDemo = root.__fhBlueprintFullDemoRoute === true;
    var headers = { accept: "application/json" };
    var t = localDemo ? "" : token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
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
   * mount(el, ctx) paints the apply gate into `el`. ctx = { clientId, apiGet,
   * apiPost, setupHref, onSignIn }. clientId is for staff; a client session
   * leaves it empty (the server pins a client to their own file). Returns
   * { reload, unmount }.
   */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = typeof ctx.apiPost === "function" ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var links = { setup: ctx.setupHref || withClient(SETUP_PATH, cid) };
    var data = null;
    var showAll = false;

    function paint(html) { el.innerHTML = '<div class="fh-apply-gate">' + html + "</div>"; }

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
        /* A read that is not the apply gate (the sample demo answers the banks
           read for every view) shows nothing rather than a broken card. */
        if (!res.body || res.body.view !== "apply_gate") { data = null; paint(""); return; }
        data = res.body;
        paint(render(data, links, showAll));
      });
    }

    function override(btn) {
      var bank = btn.getAttribute("data-bank");
      var allow = btn.getAttribute("data-allow") === "true";
      var msg = null;
      var spots = el.querySelectorAll(".ag-msg");
      for (var i = 0; i < spots.length; i++) if (spots[i].getAttribute("data-msg-for") === bank) msg = spots[i];
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "Saving…";
      var body = { action: "set_apply_override", bank: bank, allow_more: allow };
      if (cid) body.client_id = cid;
      return send(WRITE_PATH, body).then(function (res) {
        if (res && res.status >= 200 && res.status < 300 && res.body && res.body.ok === true) return load();
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.textContent = allow ? "Allow more here" : "Back to the book's limit";
        if (msg) {
          msg.setAttribute("role", "alert");
          msg.textContent = (res && res.body && res.body.message) || "That did not save. Try again.";
        }
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") { load(); return; }
      if (act === "more") {
        showAll = !showAll;
        if (data) paint(render(data, links, showAll));
        var again = el.querySelector('[data-act="more"]');
        if (again && again.focus) again.focus();
        return;
      }
      if (act === "override") override(t);
    }
    /* A logo file that fails to load is removed, so the name stands alone. */
    function onImgError(e) {
      var t = e.target;
      if (t && t.classList && (t.classList.contains("ag-logo") || t.classList.contains("fh-bank-logo")) && t.parentNode) t.parentNode.removeChild(t);
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

  /* Auto-mount every <div data-fh-apply-gate> once. */
  function autoMount() {
    if (!root.document || !root.document.querySelectorAll) return;
    var els = root.document.querySelectorAll("[data-fh-apply-gate]");
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute("data-fh-apply-gate-mounted")) continue;
      els[i].setAttribute("data-fh-apply-gate-mounted", "true");
      mount(els[i], { clientId: els[i].getAttribute("data-client-id") || param("client_id") });
    }
  }

  root.FHApplyGate = {
    mount: mount, render: render, renderFull: renderFull, renderGate: renderGate, renderSeasoning: renderSeasoning,
    renderOdds: renderOdds, renderClock: renderClock, renderEmpty: renderEmpty, renderError: renderError,
    renderLoading: renderLoading, isEmpty: isEmpty, classify: classify, barStep: barStep, day: day,
    logoSrc: logoSrc, withClient: withClient, autoMount: autoMount, SHOWN: SHOWN
  };

  if (root.document && root.document.addEventListener) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", autoMount);
    else autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis);
