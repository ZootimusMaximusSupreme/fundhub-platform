/* What you have — the tradeline inventory card (Finance OS wave 4, unit TL).
 *
 * Every account the client holds, Personal and per business: from the credit
 * reports, from Plaid, and the ones they add. Each row says where it came from
 * (Report, Plaid, Added by you). "Banks you use" lists the banks on Fundhub's
 * bank list where they already have an open account: an existing relationship.
 *
 * ONE ADD FORM (unit TL patch 6). An account they have that we cannot see is
 * added in the Accounts section's own "Add an account" form (money-accounts.js),
 * by its "Just record it" choice, which posts POST /api/money/accounts
 * { action: "add_tradeline" }. This card hands that form its read's choices
 * (FHTradelines.addOptions and the "fh:tradelines-ready" event) and reloads on
 * "fh:accounts-changed".
 *
 * Reads GET /api/money/accounts?view=tradelines. The rules live in
 * src/finance/tradeline-inventory.mjs. Nothing here invents a number: a null is
 * "not on file" and is simply not shown.
 *
 * Mounts as window.FinanceOS.extras.accounts, so /app/financeos.html paints it
 * in its own box under the Accounts section and neither can wipe the other
 * (public/app/financeos.js mountTab). Logos come from bank-logo.js in its
 * order: Plaid's, then the bank book's, else the name only.
 *
 * Render functions return HTML strings and touch no DOM, so
 * src/ui/money-tradelines.test.mjs runs them in Node. mount() needs a browser.
 */
(function (root) {
  "use strict";

  var API = "/api/money/accounts";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SOURCE_CLASS = { report: "is-report", plaid: "is-plaid", you: "is-you", fundhub: "is-fundhub" };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* Integer cents → "$10,000" (whole dollars) or "$10,000.50". */
  function money(cents) {
    if (!isNum(cents)) return "";
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = abs % 100;
    return (cents < 0 ? "−$" : "$") + dollars + (c ? "." + (c < 10 ? "0" : "") + c : "");
  }
  /* "2021-03" → "Mar 2021" */
  function monthYear(v) {
    var m = /^(\d{4})-(\d{2})/.exec(String(v || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "";
  }
  function logo(src, name) {
    var L = root.FHBankLogo;
    return L ? L.html(src, name) : "";
  }
  function chip(word, cls) {
    return '<span class="tl-chip' + (cls ? " " + cls : "") + '">' + esc(word) + "</span>";
  }

  /* ── pieces ─────────────────────────────────────────────────────────── */

  function facts(it) {
    var out = [it.type_words || "Account"];
    if (it.bank && it.bank !== it.name) out.push(it.bank);
    if (isNum(it.limit_cents)) out.push("Limit " + money(it.limit_cents));
    if (it.opened) out.push("Opened " + monthYear(it.opened));
    return out;
  }

  function renderItem(it) {
    var chips = list(it.sources).map(function (s, i) {
      return chip(list(it.source_words)[i] || s, SOURCE_CLASS[s] || "");
    }).join("");
    if (it.authorized_user) chips += chip("Authorized user", "is-au");
    return '<li class="tl-row" data-item="' + esc(it.id) + '">' +
      '<div class="tl-main">' + logo(it.logo, it.bank || it.name) +
      '<div class="tl-text"><p class="tl-name">' + esc(it.name || "Account") + "</p>" +
      '<p class="tl-cap">' + esc(facts(it).join(" · ")) + "</p></div></div>" +
      '<div class="tl-chips">' + chips + "</div></li>";
  }

  function renderGroup(g) {
    var items = list(g.items);
    var head = '<div class="tl-group-head"><h3>' + esc(g.name) + "</h3>" +
      (g.kind === "business" ? chip("Business", "is-kind") : "") +
      '<span class="tl-cap">' + esc(plural(items.length, "account", "accounts")) + "</span></div>";
    var body = items.length
      ? '<ul class="tl-list">' + items.map(renderItem).join("") + "</ul>"
      : '<p class="tl-cap tl-none">No accounts yet.</p>';
    var closed = g.closed > 0 ? '<p class="tl-cap tl-closed">' + esc(plural(g.closed, "closed account", "closed accounts")) + " not shown.</p>" : "";
    return '<section class="tl-group" data-group="' + esc(g.key) + '">' + head + body + closed + "</section>";
  }

  function renderBanks(rels) {
    if (!list(rels).length) return "";
    return '<section class="tl-banks" aria-labelledby="tl-banks-h"><h3 id="tl-banks-h">Banks you use</h3>' +
      '<ul class="tl-bank-list">' + list(rels).map(function (r) {
        return '<li class="tl-bank" data-bank="' + esc(r.key) + '">' +
          '<span class="tl-bank-name">' + logo(r.logo, r.bank) + '<span class="tl-name">' + esc(r.bank) + "</span></span>" +
          chip(r.text || "Existing relationship", "is-rel") +
          '<span class="tl-cap">' + esc(plural(r.accounts || 0, "account", "accounts")) + "</span></li>";
      }).join("") + "</ul></section>";
  }

  function renderHead() {
    return '<div class="tl-head"><div class="tl-head-text"><h2>What you have</h2>' +
      '<p class="tl-cap">From your credit reports, Plaid, and you.</p></div></div>';
  }

  function isEmpty(d) {
    return !d || !list(d.groups).some(function (g) { return list(g.items).length || g.closed > 0; });
  }

  function renderFull(d) {
    return '<div class="fh-tl">' + renderHead() + renderBanks(d.relationships) +
      '<div class="tl-groups">' + list(d.groups).map(renderGroup).join("") + "</div></div>";
  }

  function renderEmpty() {
    return '<div class="fh-tl">' + renderHead() +
      '<div class="tl-empty"><p class="tl-name">No accounts yet</p><p class="tl-cap">Add one, or connect a bank.</p></div></div>';
  }

  function render(d) { return isEmpty(d) ? renderEmpty(d) : renderFull(d); }

  function renderLoading() {
    var row = '<li class="tl-row"><span class="tl-sk tl-sk-l"></span><span class="tl-sk tl-sk-s"></span></li>';
    return '<div class="fh-tl" aria-busy="true"><div class="tl-head"><div class="tl-head-text"><h2>What you have</h2>' +
      '<p class="tl-cap">Loading your accounts…</p></div></div><ul class="tl-list">' + row + row + row + "</ul></div>";
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side. Try again in a few minutes.",
    forbidden: "This login cannot see these accounts.",
    notfound: "We could not find that client file.",
    needclient: "Open this from a client's file first.",
    badrequest: "That request was not accepted."
  };

  function renderError(kind) {
    return '<div class="fh-tl tl-error" role="alert"><h2>What you have</h2>' +
      "<p>We could not load your accounts. " + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + "</p>" +
      '<button class="tl-btn tl-btn-dark" type="button" data-act="tl-retry">Try again</button></div>';
  }

  /* ── talking to the server ──────────────────────────────────────────── */

  function classify(res) {
    var s = res && res.status, b = res && res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0 || s === undefined) return "offline";
    if (s === 404) return "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "badrequest";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true) return "server";
    return "ok";
  }

  var WRITE_WORDS = {
    business_not_found: "That business was not found. Reload and try again.",
    container_archived: "That business is archived. Pick another one.",
    not_a_business_container: "Pick Personal or one of your businesses.",
    signin: "You are signed out. Sign in and try again.",
    offline: ERROR_WORDS.offline,
    nodb: ERROR_WORDS.nodb
  };
  /* A refused field comes back as a sentence that names it ("limit must be
     more than $0"). It is shown as is, with a capital first letter. */
  function writeWords(res) {
    var b = (res && res.body) || {};
    if (WRITE_WORDS[b.error]) return WRITE_WORDS[b.error];
    var kind = classify(res);
    if (WRITE_WORDS[kind]) return WRITE_WORDS[kind];
    if (kind === "badrequest" && b.error && /\s/.test(String(b.error))) {
      var t = String(b.error);
      return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
    }
    return "That did not save. Try again.";
  }

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

  /* The Accounts section's add form takes this read's choices for "Just record
     it" (money-accounts.js). null while there is no read of this view. */
  function handOver(add) {
    api.addOptions = add && typeof add === "object" ? add : null;
    var doc = root.document;
    if (doc && typeof doc.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      doc.dispatchEvent(new root.CustomEvent("fh:tradelines-ready", { detail: { add: api.addOptions } }));
    }
  }

  /* ── the card ───────────────────────────────────────────────────────── */

  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : function (p) { return call("GET", p); };
    var st = { data: null, clientId: ctx.clientId || param("client_id") || "" };

    function paint(html) { el.innerHTML = html; }

    function load() {
      if (!st.data) paint(renderLoading());
      var path = API + "?view=tradelines" + (st.clientId ? "&client_id=" + encodeURIComponent(st.clientId) : "");
      return Promise.resolve(get(path)).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); else paint(renderError("server")); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        /* A read that does not know this view answers with something else.
           Show nothing, never a wrong "No accounts yet". */
        if (!res.body || res.body.view !== "tradelines") { st.data = null; paint(""); handOver(null); return; }
        st.data = res.body;
        paint(render(st.data));
        handOver(st.data.add);
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      if (t.getAttribute("data-act") === "tl-retry") load();
    });
    /* An account added or moved in the Accounts section above shows here too. */
    var again = null;
    function onChanged() { if (again) clearTimeout(again); again = setTimeout(load, 300); }
    if (root.document && root.document.addEventListener) root.document.addEventListener("fh:accounts-changed", onChanged);

    load();
    return {
      reload: load,
      unmount: function () { if (root.document && root.document.removeEventListener) root.document.removeEventListener("fh:accounts-changed", onChanged); }
    };
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.extras = root.FinanceOS.extras || {};
  /* If another card already sits under Accounts, both get their own box. */
  var before = root.FinanceOS.extras.accounts;
  root.FinanceOS.extras.accounts = before && typeof before.mount === "function"
    ? { mount: function (el, ctx) { el.innerHTML = "<div></div><div></div>"; before.mount(el.firstChild, ctx); return mount(el.lastChild, ctx); } }
    : { mount: mount };

  var api = root.FHTradelines = {
    money: money, monthYear: monthYear, isEmpty: isEmpty, render: render, renderFull: renderFull, renderEmpty: renderEmpty,
    renderLoading: renderLoading, renderError: renderError, renderItem: renderItem, renderGroup: renderGroup,
    renderBanks: renderBanks, classify: classify, writeWords: writeWords, mount: mount,
    /* The read's "Just record it" choices, for the Accounts add form. */
    addOptions: null
  };
})(typeof window !== "undefined" ? window : globalThis);
