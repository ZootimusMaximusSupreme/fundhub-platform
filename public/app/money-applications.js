/* Your bank applications — the application and approval tracker card.
 * Finance OS wave 3, unit O (ops/workflows/finance-os-wave3-brief.txt).
 *
 * Owner, 2026-11-07: track every account the client applies for and whether it
 * is approved; an approved account joins the client's Finance OS accounts.
 *
 * One self-contained card, used in two places:
 *   - Finance OS → Applications (money-declines.js renders it from the same GET
 *     and calls attach(); no second request);
 *   - the Blueprint funding area, which mounts it on its own:
 *       window.FHApplications.mount(el, { clientId, apiGet, apiPost })
 *
 * Reads GET /api/blueprint/declines (view.tracker) and sends POST
 * /api/blueprint/declines { action: track_add | track_update | track_add_account }.
 * Every bank name, amount, date and logo is a field from the server. A logo is
 * Plaid's or the bank book's, from the server's identity check, never drawn: no
 * logo, name only.
 * Status is a mark and a word, never colour alone (UI-STANDARDS §12.6).
 * Approved limits are never added together: personal and business stay apart.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-applications-screen.test.mjs can run them in Node.
 * Styles: money-applications.css, every rule under .fh-apps.
 */
(function (root) {
  "use strict";

  var API = "/api/blueprint/declines";
  var PAGE = 25;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }

  /* "2026-10-01" → "Oct 1, 2026", read off the calendar date. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  /* Integer cents → "$10,000" or "$2,500.50". Not a whole number of cents → "". */
  function money(cents) {
    if (typeof cents !== "number" || !isFinite(cents) || Math.round(cents) !== cents) return "";
    var neg = cents < 0;
    var abs = Math.abs(cents);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var part = abs % 100;
    return (neg ? "-" : "") + "$" + whole + (part ? "." + (part < 10 ? "0" : "") + part : "");
  }

  /* Today in Arizona, for the date pickers' upper limit. */
  function today() {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" });
    } catch (e) { return ""; }
  }

  /* Only the bank book's own files, or a Plaid image. Anything else is no logo. */
  function safeLogo(url) {
    var s = String(url || "");
    if (/^\/assets\/[A-Za-z0-9._\/-]+\.(png|svg|jpg|jpeg|webp)$/.test(s) && s.indexOf("..") < 0) return s;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)) return s;
    return "";
  }

  var MARKS = { planned: "○", applied: "•", pending: "…", approved: "✓", denied: "✗" };
  function chip(row) {
    var st = MARKS[row.status] ? row.status : "applied";
    return '<span class="fa-chip is-' + st + '"><span class="fa-mark" aria-hidden="true">' + MARKS[st] + '</span>' +
      esc(row.status_words || "") + '</span>';
  }

  var OWNER_WORDS = { personal: "Personal", business: "Business" };

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function counts(t) {
    var c = (t && t.counts) || {};
    var total = Number(c.total) || 0;
    if (!total) return "";
    var bits = [String(c.approved || 0) + " of " + total + " approved"];
    if (c.pending) bits.push(c.pending + " pending");
    if (c.applied) bits.push(c.applied + " waiting on the bank");
    if (c.denied) bits.push(c.denied + " denied");
    return bits.join(". ") + ".";
  }

  function amountLine(row) {
    if (row.status === "approved") {
      if (typeof row.approved_cents === "number") {
        return '<span class="fa-money"><span class="fa-amt">' + esc(money(row.approved_cents)) + '</span> <span class="fa-cap">' +
          (row.kind === "loan" ? "approved" : "approved limit") + '</span></span>';
      }
      return '<span class="fa-cap">Amount not told yet</span>';
    }
    return "";
  }

  function facts(row) {
    var bits = [];
    if (row.applied_on) bits.push("Applied " + day(row.applied_on));
    if (typeof row.requested_cents === "number") bits.push("Asked " + money(row.requested_cents));
    if (row.decided_on) bits.push((row.status === "denied" ? "Denied " : "Approved ") + day(row.decided_on));
    bits.push(row.source === "fundhub" ? "Fundhub is tracking this one" : "You added this");
    return bits.join(" · ");
  }

  function field(id, label, control, hint) {
    return '<div class="fa-field"><label for="' + id + '">' + esc(label) + '</label>' + control +
      (hint ? '<span class="fa-cap">' + esc(hint) + '</span>' : "") + '</div>';
  }

  function statusSelect(id, value) {
    var opts = [["applied", "Applied, waiting on the bank"], ["pending", "Pending, the bank asked for more"], ["approved", "Approved"], ["denied", "Denied"]];
    return '<select id="' + id + '" class="fa-input" data-fa-field="status">' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === value ? " selected" : "") + '>' + esc(o[1]) + '</option>';
    }).join("") + '</select>';
  }

  /* The approved limit, last 4 and answer day only show when they apply. */
  function answerFields(prefix, status, row) {
    var max = today();
    var approved = status === "approved";
    var answered = approved || status === "denied";
    return '<div class="fa-when" data-fa-when="approved"' + (approved ? "" : " hidden") + '>' +
      field(prefix + "-limit", "Approved limit or amount", '<input id="' + prefix + '-limit" class="fa-input" type="text" inputmode="decimal" autocomplete="off" maxlength="16" data-fa-field="approved_amount" value="' +
        (row && typeof row.approved_cents === "number" ? esc(String(row.approved_cents / 100)) : "") + '">', "Leave it blank if the bank has not said.") +
      field(prefix + "-last4", "Last 4 digits of the card", '<input id="' + prefix + '-last4" class="fa-input" type="text" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{2,4}" data-fa-field="last4" value="' +
        (row && row.last4 ? esc(row.last4) : "") + '">', "Only the last 4. We never store a full card number.") +
      '</div>' +
      '<div class="fa-when" data-fa-when="answered"' + (answered ? "" : " hidden") + '>' +
      field(prefix + "-decided", "Day the bank answered", '<input id="' + prefix + '-decided" class="fa-input" type="date"' + (max ? ' max="' + max + '"' : "") +
        ' data-fa-field="decided_on" value="' + (row && row.decided_on ? esc(row.decided_on) : "") + '">') +
      '</div>';
  }

  function renderAddForm() {
    var max = today();
    return '<form class="fa-form" id="fa-add" data-fa-form="add" hidden novalidate>' +
      '<h3>Add an account you applied for</h3>' +
      '<div class="fa-grid">' +
      field("fa-add-bank", "Bank", '<input id="fa-add-bank" class="fa-input" type="text" maxlength="120" autocomplete="off" required data-fa-field="bank">') +
      field("fa-add-product", "Card or loan name", '<input id="fa-add-product" class="fa-input" type="text" maxlength="160" autocomplete="off" data-fa-field="product">', "Like Ink Business Cash. You can leave it blank.") +
      field("fa-add-kind", "What you applied for", '<select id="fa-add-kind" class="fa-input" data-fa-field="kind">' +
        '<option value="card">Credit card</option><option value="line">Line of credit</option><option value="loan">Loan</option></select>') +
      field("fa-add-owner", "Who it is for", '<select id="fa-add-owner" class="fa-input" data-fa-field="owner_kind">' +
        '<option value="">Not sure</option><option value="personal">Me</option><option value="business">My business</option></select>') +
      field("fa-add-applied", "Day you applied", '<input id="fa-add-applied" class="fa-input" type="date" required' + (max ? ' max="' + max + '" value="' + max + '"' : "") + ' data-fa-field="applied_on">') +
      field("fa-add-asked", "Amount you asked for", '<input id="fa-add-asked" class="fa-input" type="text" inputmode="decimal" autocomplete="off" maxlength="16" data-fa-field="requested_amount">', "Leave it blank if you did not ask for an amount.") +
      field("fa-add-status", "Where it stands", statusSelect("fa-add-status", "applied")) +
      '</div>' +
      answerFields("fa-add", "applied", null) +
      '<p class="fa-problem" data-fa-slot="problem" role="alert"></p>' +
      '<div class="fa-form-actions"><button class="fa-btn fa-btn-dark" type="submit">Save application</button>' +
      '<button class="fa-btn fa-btn-quiet" type="button" data-fa-act="cancel">Cancel</button></div>' +
      '</form>';
  }

  function renderEditForm(row) {
    var p = "fa-e-" + row.id;
    return '<form class="fa-form" id="' + esc(p) + '" data-fa-form="edit" data-fa-id="' + esc(row.id) + '" hidden novalidate>' +
      '<div class="fa-grid">' + field(p + "-status", "Where it stands", statusSelect(p + "-status", row.status)) + '</div>' +
      answerFields(p, row.status, row) +
      '<p class="fa-problem" data-fa-slot="problem" role="alert"></p>' +
      '<div class="fa-form-actions"><button class="fa-btn fa-btn-dark" type="submit">Save</button>' +
      '<button class="fa-btn fa-btn-quiet" type="button" data-fa-act="cancel">Cancel</button></div>' +
      '</form>';
  }

  function renderRow(row) {
    var logo = safeLogo(row.logo_url);
    var sub = [row.product, row.kind_words, OWNER_WORDS[row.owner_kind]].filter(function (x) { return x; }).join(" · ");
    var actions = "";
    if (row.can_add_account) actions += '<button class="fa-btn" type="button" data-fa-act="add-account">Add to my accounts</button>';
    if (row.can_edit) {
      actions += '<button class="fa-btn fa-btn-quiet" type="button" data-fa-act="edit" aria-expanded="false" aria-controls="fa-e-' + esc(row.id) + '">Change status</button>';
    }
    return '<li class="fa-row" data-fa-id="' + esc(row.id) + '" data-fa-source="' + esc(row.source) + '">' +
      '<div class="fa-top">' +
      '<div class="fa-bank">' + (logo ? '<span class="fa-logo"><img src="' + esc(logo) + '" alt="" loading="lazy" decoding="async"></span>' : "") +
      '<div class="fa-bank-text"><span class="fa-name">' + esc(row.bank || "A bank") + '</span>' +
      (sub ? '<span class="fa-cap">' + esc(sub) + '</span>' : "") + '</div></div>' +
      '<div class="fa-status">' + chip(row) + amountLine(row) + '</div>' +
      '</div>' +
      '<p class="fa-cap fa-facts">' + esc(facts(row)) + '</p>' +
      (row.account_words ? '<p class="fa-acct is-' + esc(row.account_state || "") + '">' + esc(row.account_words) + '</p>' : "") +
      (actions ? '<div class="fa-actions">' + actions + '</div>' : "") +
      (row.can_edit ? renderEditForm(row) : "") +
      '</li>';
  }

  function head(t, flash) {
    var cap = counts(t);
    return '<div class="fa-head"><div class="fa-head-text"><h2 id="fa-title">Your bank applications</h2>' +
      '<p class="fa-cap">' + esc(cap || "Every account you apply for, and what the bank said.") + '</p></div>' +
      (t && t.can_add ? '<button class="fa-btn" type="button" data-fa-act="open-add" aria-expanded="false" aria-controls="fa-add">Add an application</button>' : "") +
      '</div>' +
      '<p class="fa-flash" data-fa-slot="flash" role="status"' + (flash ? "" : " hidden") + '>' + esc(flash || "") + '</p>';
  }

  /* ── the four states ───────────────────────────────────────────────────── */

  function renderFull(t, opts) {
    opts = opts || {};
    var rows = list(t.rows);
    var shown = opts.all ? rows : rows.slice(0, PAGE);
    return '<section class="fh-apps card" aria-labelledby="fa-title">' + head(t, opts.flash) +
      (t.can_add ? renderAddForm() : "") +
      '<ul class="fa-list">' + shown.map(renderRow).join("") + '</ul>' +
      (rows.length > shown.length ? '<button class="fa-btn fa-more" type="button" data-fa-act="more">Show all ' + rows.length + ' applications</button>' : "") +
      '</section>';
  }

  function renderEmpty(t, opts) {
    opts = opts || {};
    t = t || { can_add: true };
    return '<section class="fh-apps card" aria-labelledby="fa-title">' + head(t, opts.flash) +
      (t.can_add ? renderAddForm() : "") +
      '<p class="fa-empty">No bank applications yet.</p>' +
      '</section>';
  }

  function renderLoading() {
    var row = '<li class="fa-row fa-skel"><span class="fa-sk fa-sk-l"></span><span class="fa-sk fa-sk-s"></span></li>';
    return '<section class="fh-apps card" aria-labelledby="fa-title" aria-busy="true"><div class="fa-head"><div class="fa-head-text">' +
      '<h2 id="fa-title">Your bank applications</h2><p class="fa-cap">Loading your applications…</p></div></div>' +
      '<ul class="fa-list">' + row + row + row + '</ul></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your applications. Try again in a few minutes.",
    forbidden: "This account is not allowed to see these applications. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This needs to know whose applications to show. Open it from a client's file."
  };

  function renderError(kind) {
    return '<section class="fh-apps card fa-error" aria-labelledby="fa-title" role="alert">' +
      '<div class="fa-head"><div class="fa-head-text"><h2 id="fa-title">Your bank applications</h2>' +
      '<p>We could not load your applications. ' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p></div></div>' +
      '<button class="fa-btn" type="button" data-fa-act="retry">Try again</button></section>';
  }

  /** The card for a tracker from the server: full, empty, or the error card. */
  function renderCard(t, opts) {
    if (!t || t.ok === false) return renderError("server");
    return list(t.rows).length ? renderFull(t, opts) : renderEmpty(t, opts);
  }

  /* ── what the server says back, in words ───────────────────────────────── */

  var SAVE_WORDS = {
    bank_required: "Tell us which bank you applied to.",
    applied_on_required: "Tell us the day you applied.",
    not_found: "We could not find that application. Reload the page and try again.",
    not_an_approved_card: "Only an approved card or line of credit goes on your accounts."
  };
  function problem(res) {
    var b = res && res.body ? res.body : {};
    if (!res || res.status === 0) return ERROR_WORDS.offline;
    if (res.status === 503 || b.db === "down") return ERROR_WORDS.nodb;
    return SAVE_WORDS[b.error] || b.message || "That did not save. Try again in a moment.";
  }

  var ACCOUNT_FLASH = {
    added: "It is on your accounts now. The balance shows once your bank connection sees it.",
    linked: "It is on your accounts now. Your bank connection already shows it.",
    exists: "It is already on your accounts.",
    ambiguous: "Your bank connection shows more than one card at this bank. Add the last 4 digits so we match the right one."
  };
  function savedFlash(res) {
    var a = res && res.body && res.body.account;
    var words = a && ACCOUNT_FLASH[a.status];
    return words ? "Saved. " + words : "Saved.";
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

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
      return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }
  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }
  function classify(res) {
    var s = res.status, b = res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0) return "offline";
    if (s === 404) return "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "server";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true || !b.view) return "server";
    return "ok";
  }

  function values(form) {
    var out = {};
    var els = form.querySelectorAll("[data-fa-field]");
    for (var i = 0; i < els.length; i++) {
      var box = els[i].closest ? els[i].closest("[data-fa-when]") : null;
      if (box && box.hidden) continue;
      out[els[i].getAttribute("data-fa-field")] = String(els[i].value || "").trim();
    }
    return out;
  }

  function showWhen(form) {
    var status = form.querySelector('[data-fa-field="status"]');
    var v = status ? status.value : "";
    var boxes = form.querySelectorAll("[data-fa-when]");
    for (var i = 0; i < boxes.length; i++) {
      var w = boxes[i].getAttribute("data-fa-when");
      boxes[i].hidden = w === "approved" ? v !== "approved" : !(v === "approved" || v === "denied");
    }
  }

  /**
   * attach(el, ctx, tracker, onChange) — wire the card already painted inside
   * `el`. Saves go to the server; the answer's fresh tracker repaints the card.
   * ctx = { clientId, apiPost, onSignIn }. onChange(tracker) lets a host keep
   * its own copy. Returns { paint, detach }.
   */
  function attach(el, ctx, tracker, onChange) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var send = typeof ctx.apiPost === "function" ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { tracker: tracker, all: false };
    function q(sel) { return el.querySelector ? el.querySelector(sel) : null; }
    function card() { return q(".fh-apps"); }

    function paint(t, flash) {
      state.tracker = t;
      var host = card();
      var html = renderCard(t, { flash: flash, all: state.all });
      if (host && host.outerHTML !== undefined) host.outerHTML = html; else el.innerHTML = html;
      if (typeof onChange === "function") onChange(t);
    }

    function save(form) {
      var kind = form.getAttribute("data-fa-form");
      var body = values(form);
      var say = function (text) { var p = form.querySelector('[data-fa-slot="problem"]'); if (p) p.textContent = text || ""; };
      if (kind === "add") {
        if (!body.bank) { say(SAVE_WORDS.bank_required); var b = form.querySelector('[data-fa-field="bank"]'); if (b && b.focus) b.focus(); return; }
        if (!body.applied_on) { say(SAVE_WORDS.applied_on_required); return; }
        body.action = "track_add";
      } else {
        body.action = "track_update";
        body.id = form.getAttribute("data-fa-id");
      }
      if (cid) body.client_id = cid;
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      say("");
      send(API, body).then(function (res) {
        if (res.status === 401) { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); return; }
        if (res.body && res.body.ok === true && res.body.tracker) { paint(res.body.tracker, savedFlash(res)); return; }
        if (btn) { btn.disabled = false; btn.textContent = kind === "add" ? "Save application" : "Save"; }
        say(problem(res));
      });
    }

    function addAccount(btn) {
      var li = btn.closest ? btn.closest("[data-fa-id]") : null;
      if (!li) return;
      var body = { action: "track_add_account", source: li.getAttribute("data-fa-source"), id: li.getAttribute("data-fa-id") };
      if (cid) body.client_id = cid;
      btn.disabled = true;
      btn.textContent = "Adding…";
      send(API, body).then(function (res) {
        if (res.status === 401) { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); return; }
        if (res.body && res.body.ok === true && res.body.tracker) { paint(res.body.tracker, savedFlash(res)); return; }
        btn.disabled = false;
        btn.textContent = "Add to my accounts";
        var flash = q('[data-fa-slot="flash"]');
        if (flash) { flash.hidden = false; flash.textContent = problem(res); }
      });
    }

    function toggle(btn, form) {
      if (!form) return;
      form.hidden = !form.hidden;
      btn.setAttribute("aria-expanded", form.hidden ? "false" : "true");
      if (!form.hidden) {
        var first = form.querySelector("input,select");
        if (first && first.focus) first.focus();
      }
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-fa-act]") : null;
      if (!t || (el.contains && !el.contains(t)) || t.disabled) return;
      var act = t.getAttribute("data-fa-act");
      if (act === "open-add") toggle(t, q("#fa-add"));
      else if (act === "edit") toggle(t, q("#" + String(t.getAttribute("aria-controls") || "").replace(/[^A-Za-z0-9_-]/g, "")));
      else if (act === "cancel") {
        var form = t.closest("form");
        if (form) {
          form.hidden = true;
          var opener = q('[aria-controls="' + form.id + '"]');
          if (opener) { opener.setAttribute("aria-expanded", "false"); if (opener.focus) opener.focus(); }
        }
      } else if (act === "add-account") addAccount(t);
      else if (act === "more") { state.all = true; paint(state.tracker); }
      else if (act === "retry" && typeof ctx.reload === "function") ctx.reload();
    }
    function onSubmit(e) {
      var form = e.target;
      if (!form || !form.getAttribute || !form.getAttribute("data-fa-form")) return;
      e.preventDefault();
      save(form);
    }
    function onChangeField(e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-fa-field") === "status" && t.form) showWhen(t.form);
    }

    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    el.addEventListener("change", onChangeField);
    return {
      paint: paint,
      detach: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("submit", onSubmit);
        el.removeEventListener("change", onChangeField);
      }
    };
  }

  /**
   * mount(el, ctx) — the card on its own (the Blueprint funding area). Loads
   * GET /api/blueprint/declines and shows view.tracker. ctx = { clientId,
   * apiGet, apiPost, onSignIn }; a client session leaves clientId empty (the
   * server pins a client to their own file). Returns { reload, unmount }.
   */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var wired = null;
    function load() {
      el.innerHTML = renderLoading();
      return get(API + (cid ? "?client_id=" + encodeURIComponent(cid) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); else if (root.location) root.location.href = "/portal-login.html"; return; }
        if (kind !== "ok") { el.innerHTML = renderError(kind); return; }
        // A read with no tracker (the sample demo's) has nothing for this card: no card, not an error.
        if (!res.body.view.tracker) { el.innerHTML = ""; return; }
        wired.paint(res.body.view.tracker);
      });
    }
    wired = attach(el, { clientId: cid, apiPost: ctx.apiPost, onSignIn: ctx.onSignIn, reload: load }, null);
    load();
    return {
      reload: load,
      unmount: function () { if (wired) wired.detach(); el.innerHTML = ""; }
    };
  }

  root.FHApplications = {
    day: day, money: money, safeLogo: safeLogo, counts: counts, facts: facts,
    renderCard: renderCard, renderFull: renderFull, renderEmpty: renderEmpty, renderLoading: renderLoading,
    renderError: renderError, renderRow: renderRow, problem: problem, savedFlash: savedFlash, classify: classify,
    attach: attach, mount: mount
  };
  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.applicationsCard = root.FHApplications;
})(typeof window !== "undefined" ? window : globalThis);
