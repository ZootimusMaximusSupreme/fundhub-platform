/* Pay now / I paid — the controls on each card's due row (FinanceOS unit I6).
 *
 * Plaid cannot pay a credit card (src/finance/card-pay-now.mjs has the Plaid
 * doc lines), so this never moves money:
 *   - "Pay now" opens the card company's OWN website, the address Plaid gave for
 *     that bank. The client signs in and pays there. No address → no link.
 *   - "I paid" saves the day they paid (and the amount, if they type it).
 *   - The row then says what Plaid shows: confirmed, still waiting, or not seen.
 *
 * HOW A HOST USES IT (self-contained; owns no section):
 *   1. Put a slot inside each card due row:  FinanceOS.payNow.slot(item)
 *      item = an `upcoming` row { type: "card_due", account_id, on, ... } from
 *      GET /api/money/overview or /api/money/payments. Any other row → "".
 *   2. After painting:  FinanceOS.payNow.enhance(el, ctx)
 *      ctx = { clientId, apiGet(path), apiPost(path, body) } — the same ctx the
 *      FinanceOS sections get. It reads GET /api/money/payments?part=pay_now once
 *      and fills every slot inside el.
 *
 * HONESTY RULES (same as money.js): money is integer cents; null paints "—";
 * status is said in words, never by colour alone; "confirmed" only when the
 * server says Plaid shows the payment.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/pay-now-screen.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/payments";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MAX_AGE_DAYS = 30; // src/finance/card-pay-now.mjs CLAIM_MAX_AGE_DAYS

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (cents < 0 ? "−$" : "$") + dollars + "." + c;
  }

  /* "2026-11-07" → "Nov 7". Read as a calendar date, so no time zone moves it. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
  }

  function isoDay(v) {
    var m = /^(\d{4}-\d{2}-\d{2})$/.exec(String(v == null ? "" : v));
    return m ? m[1] : null;
  }

  function addDays(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    var t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
    return t.toISOString().slice(0, 10);
  }

  /* "35" / "35.5" / "1,035.00" / "$35" → cents with no float maths; "" → null;
     anything else → NaN (the form says so). */
  function toCents(text) {
    var s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
    if (s === "") return null;
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return NaN;
    var n = Number(m[1]) * 100 + Number(((m[2] || "") + "00").slice(0, 2));
    return n > 0 ? n : NaN;
  }

  /* ── pieces (pure) ─────────────────────────────────────────────────────── */

  /** The empty box a host puts inside a card due row. Any other row → "". */
  function slot(item) {
    if (!item || item.type !== "card_due" || typeof item.account_id !== "string" || !item.account_id) return "";
    return '<div class="pay-now" data-pay-card="' + esc(item.account_id) + '" data-pay-due="' + esc(item.on || "") + '"></div>';
  }

  function findEntry(payNow, accountId) {
    var cards = list(payNow && payNow.cards);
    for (var i = 0; i < cards.length; i++) if (cards[i] && cards[i].account_id === accountId) return cards[i];
    return null;
  }

  /** The one sentence under the buttons: what Plaid shows, or what was said. */
  function statusText(entry, opts) {
    var staff = !!(opts && opts.staff);
    var k = entry && entry.claim;
    if (k) {
      var said = staff
        ? "Marked " + (isNum(k.amount_cents) ? money(k.amount_cents) + " " : "") + "paid on " + day(k.paid_on) + "."
        : "You marked " + (isNum(k.amount_cents) ? money(k.amount_cents) + " " : "this ") + "paid on " + day(k.paid_on) + ".";
      var seenAmt = isNum(k.seen_amount_cents) ? " (" + money(k.seen_amount_cents) + ")" : "";
      if (k.status === "confirmed") {
        return { state: "confirmed", text: (staff ? "The bank shows the payment on " : "Your bank shows your payment on ") + day(k.seen_on) + seenAmt + "." };
      }
      if (k.status === "not_seen") {
        return { state: "not_seen", text: said + (staff ? " The bank has not shown it yet." : " Your bank has not shown it yet. Check your card's app.") };
      }
      if (k.status === "cannot_check") {
        return { state: "cannot_check", text: said + " This card is not linked through Plaid, so we can't check it." };
      }
      return { state: "waiting", text: said + (staff ? " Waiting for the bank to show it." : " We are waiting for your bank to show it.") };
    }
    var s = entry && entry.seen;
    if (s && s.on) {
      return { state: "seen", text: (staff ? "The bank shows a payment on " : "Your bank shows a payment on ") + day(s.on) +
        (isNum(s.amount_cents) ? " (" + money(s.amount_cents) + ")" : "") + "." };
    }
    return null;
  }

  /* The line at the top of the form. Only a card read through Plaid (the read's can_check)
     can be confirmed by the bank later; a card typed in by hand never is, so the form says
     that instead. An older read with no can_check claims neither. */
  function formLine(entry, staff) {
    var first = staff ? "Mark this card paid for the client." : "Tell us you paid.";
    if (entry && entry.can_check === true) return first + (staff ? " The bank confirms it later." : " Your bank confirms it later.");
    if (entry && entry.can_check === false) return first + " This card is not linked through Plaid, so we can't check it.";
    return first;
  }

  function renderForm(entry, dueOn, today, opts) {
    var staff = !!(opts && opts.staff);
    var t = isoDay(today) || "";
    var min = t ? addDays(t, -MAX_AGE_DAYS) : "";
    var id = "pn-" + String(entry.account_id).replace(/[^a-z0-9]/gi, "").slice(0, 12);
    return '<form class="pay-now-form" data-pay-form novalidate>' +
      '<p class="pay-now-q">' + esc(formLine(entry, staff)) + '</p>' +
      '<div class="pay-now-fields">' +
      '<label for="' + id + '-on"><span>Day you paid</span>' +
      '<input id="' + id + '-on" name="paid_on" type="date" required value="' + esc(t) + '"' +
      (t ? ' max="' + esc(t) + '" min="' + esc(min) + '"' : "") + '></label>' +
      '<label for="' + id + '-amt"><span>Amount paid (you can leave this blank)</span>' +
      '<input id="' + id + '-amt" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>' +
      '</div>' +
      '<input type="hidden" name="due_on" value="' + esc(dueOn || entry.due_on || "") + '">' +
      '<div class="pay-now-form-acts">' +
      '<button type="submit" class="pay-now-btn pay-now-save">Mark as paid</button>' +
      '<button type="button" class="pay-now-btn" data-pay-act="cancel">Cancel</button></div>' +
      '<p class="pay-now-err caption" role="alert"></p></form>';
  }

  /**
   * renderControls(entry, dueOn, { staff, open, today, hint }) — the inside of
   * one slot: Pay now (a link to the card company's site, or a line saying to
   * pay in the card's app), I paid, the status sentence, and the form when open.
   */
  function renderControls(entry, dueOn, opts) {
    opts = opts || {};
    var staff = !!opts.staff;
    var name = entry.name || "this card";
    var acts = "";
    var note;
    /* The server already checked it; https only here too, so no other kind of
       link can ever be drawn. */
    if (typeof entry.pay_url === "string" && /^https:\/\/[^\s"'<>]+$/.test(entry.pay_url) && entry.pay_site) {
      acts += '<a class="pay-now-btn pay-now-go" data-pay-act="go" href="' + esc(entry.pay_url) +
        '" target="_blank" rel="noopener noreferrer">Pay now<span class="pay-now-sr"> on ' + esc(entry.pay_site) +
        ' (opens a new tab)</span></a>';
      note = "Opens " + entry.pay_site + ". You sign in and pay there. Fundhub never moves your money.";
    } else {
      note = "Pay it in your card's app or on its website. Fundhub never moves your money.";
    }
    var k = entry.claim;
    if (k && k.id) {
      acts += '<button type="button" class="pay-now-btn" data-pay-act="undo" data-claim="' + esc(k.id) +
        '" aria-label="' + esc("Undo marked paid for " + name) + '">Undo</button>';
    } else if (!opts.open) {
      acts += '<button type="button" class="pay-now-btn" data-pay-act="paid" aria-expanded="false" aria-label="' +
        esc((staff ? "Mark paid: " : "I paid ") + name) + '">' + (staff ? "Mark paid" : "I paid") + '</button>';
    }
    var st = statusText(entry, { staff: staff });
    var hint = opts.hint && !k ? '<p class="pay-now-status caption" data-state="hint" role="status">' + esc(opts.hint) + '</p>' : "";
    return '<div class="pay-now-actions">' + acts + '</div>' +
      '<p class="pay-now-note caption">' + esc(note) + '</p>' +
      (st ? '<p class="pay-now-status caption" data-state="' + esc(st.state) + '" role="status">' + esc(st.text) + '</p>' : hint) +
      (opts.open && !(k && k.id) ? renderForm(entry, dueOn, opts.today, { staff: staff }) : "");
  }

  function renderLoading() {
    return '<p class="pay-now-msg caption" aria-busy="true"><span class="pay-now-sk" aria-hidden="true"></span>Checking ways to pay this card…</p>';
  }

  var ERROR_WORDS = {
    signin: "You are signed out. Sign in and try again.",
    offline: "We could not reach the server. Check your connection and try again.",
    server: "We could not load the ways to pay this card. Try again in a minute."
  };

  function renderError(kind) {
    return '<p class="pay-now-msg caption" role="alert">' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) +
      ' <button type="button" class="pay-now-btn" data-pay-act="retry">Try again</button></p>';
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

  function classify(res) {
    if (!res) return "server";
    if (res.status === 401) return "signin";
    if (res.status === 0) return "offline";
    if (res.status !== 200 || !res.body || res.body.ok !== true) return "server";
    return "ok";
  }

  /**
   * enhance(el, ctx) — fill every [data-pay-card] slot inside el and handle its
   * buttons. Calling it again on the same el (after the host repaints) reloads.
   * Returns { reload }.
   */
  function enhance(el, ctx) {
    if (!el || !el.querySelectorAll) return { reload: function () {} };
    if (el.__fhPayNow) { el.__fhPayNow.setCtx(ctx); el.__fhPayNow.reload(); return el.__fhPayNow; }
    var state = { ctx: ctx || {}, data: null, kind: "loading", open: {}, hint: {}, busy: false };

    function get(p) { return typeof state.ctx.apiGet === "function" ? state.ctx.apiGet(p) : call("GET", p); }
    function post(p, b) { return typeof state.ctx.apiPost === "function" ? state.ctx.apiPost(p, b) : call("POST", p, b); }
    function staff() { return !!state.ctx.clientId; }
    function slots() { return el.querySelectorAll("[data-pay-card]"); }
    function key(s) { return s.getAttribute("data-pay-card") + "|" + s.getAttribute("data-pay-due"); }

    function paintSlot(s) {
      if (state.kind === "loading") { s.innerHTML = renderLoading(); return; }
      if (state.kind !== "ok") { s.innerHTML = renderError(state.kind); return; }
      var entry = findEntry(state.data, s.getAttribute("data-pay-card"));
      if (!entry) { s.innerHTML = ""; return; }
      s.innerHTML = renderControls(entry, s.getAttribute("data-pay-due"), {
        staff: staff(), open: !!state.open[key(s)], hint: state.hint[key(s)], today: state.data.today
      });
    }
    function paint() { var all = slots(); for (var i = 0; i < all.length; i++) paintSlot(all[i]); }

    function load() {
      if (!slots().length) return Promise.resolve();
      state.kind = "loading";
      paint();
      var cid = state.ctx.clientId;
      return Promise.resolve(get(READ_PATH + "?part=pay_now" + (cid ? "&client_id=" + encodeURIComponent(cid) : ""))).then(function (res) {
        var kind = classify(res);
        /* An older server (or the demo) answers without pay_now: say nothing. */
        if (kind === "ok" && !(res.body.pay_now && Array.isArray(res.body.pay_now.cards))) { state.kind = "ok"; state.data = { cards: [] }; }
        else { state.kind = kind; state.data = kind === "ok" ? res.body.pay_now : null; }
        paint();
      });
    }

    function slotOf(node) { return node && node.closest ? node.closest("[data-pay-card]") : null; }

    function send(s, body, onFail) {
      if (state.busy) return;
      state.busy = true;
      if (state.ctx.clientId) body.client_id = state.ctx.clientId;
      return Promise.resolve(post(READ_PATH, body)).then(function (res) {
        state.busy = false;
        if (classify(res) === "ok" && res.body.pay_now) {
          state.data = res.body.pay_now;
          state.kind = "ok";
          state.open[key(s)] = false;
          paint();
          return;
        }
        var msg = (res && res.body && typeof res.body.message === "string" && res.body.message) ||
          (res && res.status === 0 ? ERROR_WORDS.offline : "That did not save. Try again in a minute.");
        onFail(msg);
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-pay-act]") : null;
      var s = slotOf(t);
      if (!t || !s || (el.contains && !el.contains(s))) return;
      var act = t.getAttribute("data-pay-act");
      if (act === "go") { state.hint[key(s)] = "Done paying? Tap I paid."; setTimeout(paint, 0); return; }
      if (act === "retry") { load(); return; }
      if (act === "paid") {
        state.open[key(s)] = true;
        paint();
        var first = s.querySelector('input[name="paid_on"]');
        if (first && first.focus) first.focus();
        return;
      }
      if (act === "cancel") {
        state.open[key(s)] = false;
        paint();
        var back = s.querySelector('[data-pay-act="paid"]');
        if (back && back.focus) back.focus();
        return;
      }
      if (act === "undo") {
        t.disabled = true;
        t.textContent = "Undoing…";
        send(s, { action: "card_paid_undo", claim_id: t.getAttribute("data-claim") }, function (msg) {
          paint();
          var p = s.querySelector(".pay-now-note");
          if (p) p.textContent = msg;
        });
      }
    });

    el.addEventListener("submit", function (e) {
      var f = e.target && e.target.closest ? e.target.closest("form[data-pay-form]") : null;
      var s = slotOf(f);
      if (!f || !s) return;
      e.preventDefault();
      var err = f.querySelector(".pay-now-err");
      function say(m) { if (err) err.textContent = m; }
      var paidOn = isoDay(f.elements.paid_on && f.elements.paid_on.value);
      var today = state.data && isoDay(state.data.today);
      if (!paidOn) { say("Pick the day you paid."); return; }
      if (today && paidOn > today) { say("The day you paid can't be after today."); return; }
      if (today && paidOn < addDays(today, -MAX_AGE_DAYS)) { say("Pick a day in the last " + MAX_AGE_DAYS + " days."); return; }
      var cents = toCents(f.elements.amount && f.elements.amount.value);
      if (cents !== null && !isNum(cents)) { say("Type the amount like 35.00, or leave it blank."); return; }
      var btn = f.querySelector(".pay-now-save");
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      say("");
      var body = { action: "card_paid", account_id: s.getAttribute("data-pay-card"),
        due_on: (f.elements.due_on && f.elements.due_on.value) || s.getAttribute("data-pay-due"), paid_on: paidOn };
      if (cents !== null) body.amount_cents = cents;
      send(s, body, function (msg) {
        if (btn) { btn.disabled = false; btn.textContent = "Mark as paid"; }
        say(msg);
      });
    });

    var api = {
      reload: load,
      setCtx: function (c) { state.ctx = c || {}; }
    };
    el.__fhPayNow = api;
    load();
    return api;
  }

  var pure = {
    slot: slot, findEntry: findEntry, statusText: statusText, renderControls: renderControls,
    renderForm: renderForm, renderLoading: renderLoading, renderError: renderError, toCents: toCents,
    money: money, day: day, classify: classify
  };

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.payNow = { slot: slot, enhance: enhance };
  root.FHPayNow = Object.assign({ enhance: enhance }, pure);
})(typeof window !== "undefined" ? window : globalThis);
