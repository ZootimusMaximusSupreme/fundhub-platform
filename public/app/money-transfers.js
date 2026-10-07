/* Transfers — FinanceOS money moves (/app/money-transfers.html, FinanceOS wave 5 W7).
 *
 * Reads ONE endpoint, GET /api/money/transfers, and paints:
 *   the sandbox / off banner · three tiles · Waiting for your OK · History
 *   (+ staff only: Set up a move)
 *
 * THE HARD RULE ON THIS SCREEN. Nothing moves until the client says yes to
 * that exact move. A waiting move shows its amount, where it goes and the
 * date; the client picks the account it comes from; "Review this move" opens
 * the exact sentence and ONE filled button, "Yes, move $X". That second press
 * is the approval. Staff never get an approve button (the server refuses
 * staff anyway); they can set a move up or take it off the list.
 *
 * THE HONESTY RULES (same as money.js):
 *   - Money arrives as integer cents. A null paints "—", never $0.00.
 *   - Status is said in words ("Sent to the bank", "Done — in Business
 *     Checking ••2202"), never by colour alone.
 *   - In the sandbox the screen says so, every time: no real money moves.
 *   - A control renders only when it works: no approve button while money
 *     moves are off, for a card or loan payment, or for staff.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-transfers-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/transfers";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  /* "2026-10-20" → "Oct 20, 2026", read as a calendar date. */
  function day(iso, noYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (noYear ? "" : ", " + m[1]);
  }

  /* A timestamp: "2h ago" under a day, "Oct 6, 3:02 PM" after (UI-STANDARDS §7).
     `now` is passed so tests are steady. */
  function when(iso, now) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var ref = isNum(now) ? now : Date.now();
    var mins = Math.round((ref - t) / 60000);
    if (mins >= 0 && mins < 60) return mins <= 1 ? "just now" : mins + " min ago";
    if (mins >= 60 && mins < 1440) return Math.round(mins / 60) + "h ago";
    var d = new Date(t);
    var h = d.getHours(), ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    var mm = String(d.getMinutes());
    if (mm.length < 2) mm = "0" + mm;
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + mm + " " + ap;
  }
  function stamp(iso, now) {
    var w = when(iso, now);
    return w ? '<time datetime="' + esc(iso) + '" title="' + esc(iso) + '">' + esc(w) + "</time>" : "";
  }

  /* "500" / "1,500.50" → cents, no float maths. null when not money. */
  function toCents(text) {
    var s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || "") + "00";
    return Number(m[1]) * 100 + Number(frac.slice(0, 2));
  }

  /* ── words ─────────────────────────────────────────────────────────────── */

  var OFF_WORDS = {
    limits_not_set: "Fundhub has not set the money move limits yet.",
    production_needs_live_flag: "Real-money moves are not switched on yet.",
    plaid_not_configured: "The bank connection is not set up.",
    plaid_env_not_supported: "The bank connection setting is not one FinanceOS can use."
  };

  var BY_WORDS = {
    agent: "Set up by your money helper (AI)",
    rules: "Set up by your money helper",
    staff: "Set up by your Fundhub advisor",
    client: "Set up by you"
  };

  var BLOCKED_WORDS = {
    card_payment: "FinanceOS can't send money to a card yet. Pay it in your card app.",
    loan_payment: "FinanceOS can't send money to a loan yet. Pay it in your loan app.",
    transfers_off: "Money moves are off right now, so this can't be sent yet.",
    over_transfer_limit: "This is more than one money move can be.",
    destination_not_connected: "The account the money goes to is not connected.",
    no_from_account: "Connect a checking or savings account to send from."
  };

  /* The move as a whole, in words. */
  function statusWords(item) {
    var t = item && item.transfer;
    if (!t) {
      if (item && item.proposal_status === "cancelled") return "Not sent";
      if (item && item.proposal_status === "failed") return "Not sent";
      return "Waiting";
    }
    var to = t.to_label || "the other account";
    var from = t.from_label || "your account";
    switch (t.status) {
      case "approved": return t.date && item.today && t.date > item.today ? "Approved — goes on " + day(t.date, true) : "Approved — sending";
      case "authorized": return "Bank check passed — sending";
      case "submitted":
        if (t.credit_status === "pending" || t.credit_status === "posted") return "On its way to " + to;
        if (t.debit_status === "funds_available") return "Sending to " + to;
        if (t.debit_status === "settled") return "Out of " + from + " — on hold at the bank";
        if (t.debit_status === "posted") return "Leaving " + from;
        return "Sent to the bank";
      case "settled": return item.to_kind === "fundhub" ? "Done — paid to Fundhub" : "Done — in " + to;
      case "failed": return "Did not go through";
      case "declined": return "Bank check said no";
      case "cancelled": return "Stopped";
      default: return "—";
    }
  }

  /* The three steps of a move, each with a word for where it is. */
  function steps(item) {
    var t = item.transfer;
    var fundhub = item.to_kind === "fundhub";
    var to = t ? t.to_label : "";
    var from = t ? t.from_label : "";
    var bad = t && (t.status === "failed" || t.status === "declined" || t.status === "cancelled");
    var d = t ? t.debit_status : null;
    var c = t ? t.credit_status : null;
    var outDone = d === "settled" || d === "funds_available";
    var inDone = fundhub ? (t && t.status === "settled") : (c === "settled" || c === "funds_available");
    function st(done, now) { return done ? "done" : (bad ? "stopped" : (now ? "now" : "next")); }
    var s = [
      { label: t && t.approved_by === "sandbox_role_play" ? "Said yes (practice run)" : "You said yes", state: t ? "done" : "next" },
      { label: "Out of " + (from || "your account"), state: st(outDone, !!(t && t.debit_status && !outDone)) },
      { label: fundhub ? "Paid to Fundhub" : "Into " + (to || "the other account"), state: st(inDone, !!(c && !inDone)) }
    ];
    if (t && t.status === "settled") s[1].state = "done";
    return s;
  }

  var STATE_WORD = { done: "done", now: "now", next: "next", stopped: "stopped" };

  function renderSteps(item) {
    return '<ol class="tx-steps">' + steps(item).map(function (s) {
      return '<li class="st-' + s.state + '"><span class="st-word">' + esc(STATE_WORD[s.state]) + "</span> " + esc(s.label) + "</li>";
    }).join("") + "</ol>";
  }

  var EVENT_WORDS = {
    approved: "Said yes",
    started: "Started today's move",
    authorized: "Bank check passed",
    declined: "Bank check said no",
    submitted: "Asked the bank to take the money out",
    credit_authorized: "Bank check passed for the second account",
    credit_submitted: "Asked the bank to put the money in",
    cancelled: "Stopped",
    date_passed: "The date passed — nothing moved",
    failed: "Did not go through",
    provider_wait: "The bank did not answer — trying again",
    provider_not_enabled: "The bank connection is not switched on",
    needs_bank_login: "The bank login needs fixing",
    account_removed: "An account was disconnected"
  };
  var LEG_EVENT = { pending: "waiting at the bank", posted: "sent", settled: "done", funds_available: "money ready",
    failed: "failed", returned: "sent back", cancelled: "stopped" };

  function eventWords(e, item) {
    var t = item.transfer || {};
    if (/^plaid_/.test(e.type)) {
      var word = e.type.slice(6);
      var where = e.leg === "credit" ? "Into " + (t.to_label || "the other account") : "Out of " + (t.from_label || "your account");
      return where + ": " + (LEG_EVENT[word] || word.replace(/_/g, " "));
    }
    if (e.type === "approved" && t.approved_by === "sandbox_role_play") return "Said yes (practice run, sandbox)";
    return EVENT_WORDS[e.type] || e.type.replace(/_/g, " ");
  }

  /* ── head, banner, tiles ───────────────────────────────────────────────── */

  function renderHead(d, staff) {
    var who = d && d.client && d.client.name ? d.client.name + " · " : "";
    var line = staff ? "Money moves for this client. Only the client can say yes." : "Money moves between your accounts. Nothing moves until you say yes.";
    return '<div class="head"><div><h1>Transfers</h1><p class="caption">' + esc(who + line) + "</p></div></div>";
  }

  function renderBanner(d) {
    var m = (d && d.mode) || {};
    if (m.enabled && m.environment === "sandbox") {
      return '<section class="tx-banner sandbox" role="note"><span class="tag">Practice mode</span> ' +
        "<span>These moves use Plaid's test bank (sandbox). No real money moves.</span></section>";
    }
    if (!m.enabled) {
      return '<section class="tx-banner off" role="note"><span class="tag">Off</span> <span>Money moves are off. ' +
        esc(OFF_WORDS[m.reason] || "They are not switched on.") + "</span></section>";
    }
    return '<section class="tx-banner live" role="note"><span class="tag">Live</span> <span>Real money moves. Each one waits for your yes.</span></section>';
  }

  function moving(item) {
    var t = item.transfer;
    return !!(t && (t.status === "approved" || t.status === "authorized" || t.status === "submitted"));
  }

  function renderTiles(d) {
    var waiting = list(d && d.waiting);
    var history = list(d && d.history);
    var total = waiting.reduce(function (s, w) { return s + (isNum(w.amount_cents) ? w.amount_cents : 0); }, 0);
    var live = history.filter(moving);
    var lim = (d && d.limits) || {};
    var waitTile = '<section class="card tile" aria-labelledby="tx-t-wait"><h2 class="eyebrow" id="tx-t-wait">Waiting for your OK</h2>' +
      '<span class="big">' + esc(String(waiting.length)) + "</span>" +
      '<p class="caption">' + esc(waiting.length ? money(total) + " in all" : "Nothing to answer") + "</p></section>";
    var moveTile = '<section class="card tile" aria-labelledby="tx-t-move"><h2 class="eyebrow" id="tx-t-move">Moving now</h2>' +
      '<span class="big">' + esc(String(live.length)) + "</span>" +
      '<p class="caption">' + esc(live.length ? statusWords(withToday(live[0], d)) : "Nothing on its way") + "</p></section>";
    var left = isNum(lim.left_today_cents) ? money(lim.left_today_cents) : "Not set";
    var capLine = isNum(lim.daily_cents)
      ? "of " + money(lim.daily_cents) + " a day · up to " + money(lim.per_transfer_cents) + " a move"
      : "Fundhub sets the limits";
    var limTile = '<section class="card tile" aria-labelledby="tx-t-lim"><h2 class="eyebrow" id="tx-t-lim">Left to move today</h2>' +
      '<span class="big">' + esc(left) + "</span>" +
      '<p class="caption">' + esc(capLine) + "</p></section>";
    return '<div class="tx-tiles">' + waitTile + moveTile + limTile + "</div>";
  }

  function withToday(item, d) {
    var out = {};
    for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
    out.today = d && d.today;
    return out;
  }

  /* ── waiting for your OK ───────────────────────────────────────────────── */

  function fromChoices(d, w) {
    return list(d && d.accounts).filter(function (a) { return a.id !== (w.to && w.to.id); });
  }

  function accountOption(a) {
    return a.label + (isNum(a.available_balance_cents) ? " · " + money(a.available_balance_cents) + " available" : "");
  }

  function renderFromPicker(d, w) {
    var choices = fromChoices(d, w);
    if (!choices.length) return "";
    var pick = w.suggested_from_account_id || choices[0].id;
    if (choices.length === 1) {
      return '<p class="tx-from"><span class="caption">From</span> <strong>' + esc(accountOption(choices[0])) + "</strong>" +
        '<input type="hidden" name="from_account_id" value="' + esc(choices[0].id) + '"></p>';
    }
    return '<label class="field tx-from"><span class="caption">From</span><select name="from_account_id">' +
      choices.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === pick ? " selected" : "") + ">" + esc(accountOption(a)) + "</option>";
      }).join("") + "</select></label>";
  }

  /* The exact sentence the client says yes to. The same words the server
     keeps in approval_terms. */
  function approvalSentence(w, fromLabel) {
    return "Move " + money(w.amount_cents) + " from " + fromLabel + " to " + ((w.to && w.to.label) || "Fundhub") + " on " + day(w.date) + "?";
  }

  function renderWaiting(d, w, opts) {
    var staff = !!opts.staff;
    var head = '<div class="wt-top"><span class="big">' + esc(money(w.amount_cents)) + "</span>" +
      '<span class="caption">' + esc(BY_WORDS[w.proposed_by] || BY_WORDS.rules) + "</span></div>";
    var body = '<p class="wt-title">' + esc(w.title) + "</p>" +
      (w.why ? '<p class="caption">' + esc(w.why) + "</p>" : "") +
      '<dl class="wt-facts"><div><dt class="caption">To</dt><dd>' + esc((w.to && w.to.label) || "Fundhub") + "</dd></div>" +
      '<div><dt class="caption">On</dt><dd>' + esc(day(w.date)) + "</dd></div></dl>";
    var act;
    if (staff) {
      act = '<div class="wt-act"><p class="caption">Waiting for the client to say yes.</p>' +
        '<button class="btn-text" type="button" data-act="cancel" data-id="' + esc(w.id) + '" data-amount="' + esc(money(w.amount_cents)) + '">Take it off the list</button>' +
        '<p class="act-msg caption" aria-live="polite"></p></div>';
    } else if (!w.can_approve) {
      act = '<div class="wt-act"><p class="wt-blocked">' + esc(BLOCKED_WORDS[w.blocked] || "This can't be sent from here.") + "</p>" +
        '<button class="btn-text" type="button" data-act="cancel" data-id="' + esc(w.id) + '" data-amount="' + esc(money(w.amount_cents)) + '">Not now</button>' +
        '<p class="act-msg caption" aria-live="polite"></p></div>';
    } else {
      act = '<form class="wt-act" data-form="approve" data-id="' + esc(w.id) + '" data-amount="' + esc(String(w.amount_cents)) + '"' +
        ' data-to="' + esc((w.to && w.to.id) || "") + '" data-date="' + esc(w.date) + '">' +
        renderFromPicker(d, w) +
        '<button class="btn-line" type="button" data-act="review">Review this move</button>' +
        '<div class="confirm" hidden><p class="confirm-q" data-role="sentence"></p>' +
        '<p class="caption">Nothing else moves. You can stop it until it reaches the bank.</p>' +
        '<div class="confirm-row"><button class="btn-primary" type="submit">Yes, move ' + esc(money(w.amount_cents)) + "</button>" +
        '<button class="btn-text" type="button" data-act="back">Go back</button></div></div>' +
        '<p class="act-msg caption" aria-live="polite"></p></form>' +
        '<div class="wt-not"><button class="btn-text" type="button" data-act="cancel" data-id="' + esc(w.id) + '" data-amount="' + esc(money(w.amount_cents)) + '">Not now</button></div>';
    }
    return '<article class="card wt" data-id="' + esc(w.id) + '">' + head + body + act + "</article>";
  }

  function renderWaitingList(d, opts) {
    var items = list(d && d.waiting);
    var body = items.length
      ? '<div class="wt-list">' + items.map(function (w) { return renderWaiting(d, w, opts); }).join("") + "</div>"
      : '<section class="card empty"><p class="empty-t">Nothing is waiting for your OK.</p>' +
        "<p>" + esc(opts.staff
          ? "When the money helper or staff set up a move for this client, it waits here for the client's yes."
          : "When your plan or your advisor sets up a money move, it waits here for your yes. Nothing moves until you say so.") + "</p></section>";
    return '<section class="block" aria-labelledby="tx-wait"><h2 id="tx-wait">Waiting for your OK</h2>' + body + "</section>";
  }

  /* ── history ───────────────────────────────────────────────────────────── */

  function approvedWho(t, now) {
    if (!t) return "—";
    var who = t.approved_by === "sandbox_role_play" ? "Practice run" : "You";
    return esc(who) + (t.approved_at ? " · " + stamp(t.approved_at, now) : "");
  }

  function renderHistoryRow(d, item, opts) {
    var x = withToday(item, d);
    var t = item.transfer;
    var moveText = t ? t.from_label + " → " + t.to_label : item.title;
    var words = statusWords(x);
    var detail = item.message ? '<span class="caption">' + esc(item.message) + "</span>" : "";
    var cancel = t && t.can_cancel
      ? '<button class="btn-text" type="button" data-act="cancel" data-id="' + esc(item.id) + '" data-amount="' + esc(money(item.amount_cents)) + '">Stop this move</button>'
      : "";
    var events = t && list(t.events).length
      ? '<details class="tx-events"><summary>What happened</summary><ol>' + list(t.events).map(function (e) {
        return "<li>" + stamp(e.at, opts.now) + " " + esc(eventWords(e, x)) + "</li>";
      }).join("") + "</ol></details>"
      : "";
    return '<tr data-id="' + esc(item.id) + '">' +
      '<td data-label="Date">' + esc(day(t ? t.date : (item.created_at || "").slice(0, 10), false)) + "</td>" +
      '<td data-label="Move"><span class="tx-move">' + esc(moveText) + "</span><br><span class=\"caption\">" + esc(item.title) + "</span></td>" +
      '<td data-label="Amount" class="r num">' + esc(money(item.amount_cents)) + "</td>" +
      '<td data-label="Status"><span class="tx-status">' + esc(words) + "</span>" + (t ? renderSteps(x) : "") + detail + events + "</td>" +
      '<td data-label="Said yes">' + approvedWho(t, opts.now) + (cancel ? '<div class="tx-row-act">' + cancel + '<p class="act-msg caption" aria-live="polite"></p></div>' : "") + "</td>" +
      "</tr>";
  }

  function renderHistory(d, opts) {
    var items = list(d && d.history);
    var body = items.length
      ? '<div class="card"><div class="scroll-x"><table><caption class="caption">Every money move you answered, newest first.</caption>' +
        '<thead><tr><th>Date</th><th>Move</th><th class="r">Amount</th><th>Status</th><th>Said yes</th></tr></thead><tbody>' +
        items.map(function (i) { return renderHistoryRow(d, i, opts); }).join("") + "</tbody></table></div></div>"
      : '<section class="card empty"><p class="empty-t">No money moves yet.</p>' +
        "<p>Moves you say yes to show here, step by step, until the money lands.</p></section>";
    return '<section class="block" aria-labelledby="tx-hist"><h2 id="tx-hist">History</h2>' + body + "</section>";
  }

  /* ── staff only: set up a move ─────────────────────────────────────────── */

  function renderPropose(d) {
    var accts = list(d && d.accounts);
    var m = (d && d.mode) || {};
    if (!m.enabled) return "";
    if (!accts.length) {
      return '<section class="card staff" aria-labelledby="tx-prop"><h2 class="eyebrow" id="tx-prop">Staff only · Set up a move</h2>' +
        "<p>This client has no connected checking or savings account to move money between.</p></section>";
    }
    var opts = accts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(accountOption(a)) + "</option>"; }).join("");
    return '<section class="card staff" aria-labelledby="tx-prop"><h2 class="eyebrow" id="tx-prop">Staff only · Set up a move</h2>' +
      '<p class="caption">It waits for the client\'s yes. Nothing moves until then.</p>' +
      '<form data-form="propose" class="tx-prop-form">' +
      '<label class="field"><span class="caption">To</span><select name="to">' + opts + '<option value="fundhub">Fundhub (a payment)</option></select></label>' +
      '<label class="field"><span class="caption">Suggested from</span><select name="from">' + opts + "</select></label>" +
      '<label class="field"><span class="caption">Amount ($)</span><input name="amount" inputmode="decimal" placeholder="2000.00" required></label>' +
      '<label class="field"><span class="caption">Date</span><input name="due_on" type="date" min="' + esc(d.today || "") + '" value="' + esc(d.today || "") + '" required></label>' +
      '<label class="field wide"><span class="caption">What it is for</span><input name="title" maxlength="200" placeholder="Deposit to build banking history" required></label>' +
      '<button class="btn-primary" type="submit">Set up this move</button>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></section>';
  }

  /* ── the whole section ─────────────────────────────────────────────────── */

  function render(d, opts) {
    opts = opts || {};
    var staff = !!opts.staff;
    var o = { staff: staff, now: opts.now };
    return renderHead(d, staff) + renderBanner(d) + renderTiles(d) + renderWaitingList(d, o) + renderHistory(d, o) +
      (staff ? renderPropose(d) : "");
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    var card = '<div class="card wt skel"><span class="sk sk-l"></span><span class="sk sk-m"></span><span class="sk sk-s"></span></div>';
    return '<div class="head"><div><h1>Transfers</h1><p class="caption">Loading your money moves…</p></div></div>' +
      '<div class="tx-tiles" aria-busy="true">' + tile + tile + tile + "</div>" +
      '<div class="wt-list" aria-busy="true">' + card + card + "</div>";
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your money moves. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose money moves to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Transfers</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your money moves</h2>' +
      "<p>" + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + "</p>" +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
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

  /* ── the section: window.FinanceOS.sections.transfers ─────────────────────
     mount(el, ctx) paints this section into `el` and wires its buttons. No
     page chrome. ctx = { clientId, apiGet, apiPost } — clientId only from a
     staff desk; a client session leaves it empty and the server pins it to
     their own file. Section styles: money-transfers.css, all under .fh-transfers. */

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var staff = !!clientId;
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var data = null;

    function paint(html) { el.innerHTML = '<div class="fh-transfers">' + html + "</div>"; }

    function load() {
      paint(renderLoading());
      return get(READ_PATH + (clientId ? "?client_id=" + encodeURIComponent(clientId) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin" && root.location) { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        data = res.body;
        paint(render(data, { staff: staff, now: Date.now() }));
      });
    }

    function post(body, msgEl, btn, busy) {
      function say(t) { if (msgEl) msgEl.textContent = t; }
      if (clientId) body.client_id = clientId;
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = busy || "Saving…"; }
      say("");
      return send(READ_PATH, body).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (classify(res) !== "ok") {
          say((res.body && res.body.message) || ERROR_WORDS[classify(res)] || ERROR_WORDS.server);
          return null;
        }
        return res.body;
      });
    }

    function sentenceFor(form) {
      var w = null;
      list(data && data.waiting).forEach(function (x) { if (x.id === form.getAttribute("data-id")) w = x; });
      if (!w) return "";
      var sel = form.elements.from_account_id;
      var fromId = sel ? sel.value : "";
      var from = null;
      list(data && data.accounts).forEach(function (a) { if (a.id === fromId) from = a; });
      return approvalSentence(w, from ? from.label : "your account");
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") { load(); return; }
      if (act === "review" || act === "back") {
        var form = t.closest("form");
        var box = form.querySelector(".confirm");
        var review = form.querySelector('[data-act="review"]');
        if (act === "review") {
          form.querySelector('[data-role="sentence"]').textContent = sentenceFor(form);
          box.hidden = false;
          if (review) review.hidden = true;
          var sel = form.elements.from_account_id;
          if (sel && sel.tagName === "SELECT") sel.disabled = true;
        } else {
          box.hidden = true;
          if (review) review.hidden = false;
          var sel2 = form.elements.from_account_id;
          if (sel2 && sel2.tagName === "SELECT") sel2.disabled = false;
        }
        return;
      }
      if (act === "cancel") {
        var amount = t.getAttribute("data-amount") || "this move";
        var q = staff ? "Take the " + amount + " move off this client's list? Nothing will move." :
          "Stop the " + amount + " move? Nothing will move.";
        if (!root.confirm(q)) return;
        var holder = t.closest(".wt") || t.closest(".tx-row-act") || t.parentNode;
        var msg = holder ? holder.querySelector(".act-msg") : null;
        post({ action: "cancel", proposal_id: t.getAttribute("data-id") }, msg, t, "Stopping…")
          .then(function (b) { if (b) load(); });
      }
    }

    function onSubmit(e) {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute("data-form")) return;
      e.preventDefault();
      var kind = f.getAttribute("data-form");
      var btn = f.querySelector('button[type="submit"]');
      if (kind === "approve") {
        var msg = f.querySelector(".act-msg");
        var sel = f.elements.from_account_id;
        var body = {
          action: "approve",
          proposal_id: f.getAttribute("data-id"),
          amount_cents: Number(f.getAttribute("data-amount")),
          from_account_id: sel ? sel.value : "",
          to_account_id: f.getAttribute("data-to") || null,
          scheduled_for: f.getAttribute("data-date")
        };
        post(body, msg, btn, "Sending…").then(function (b) {
          if (!b) return;
          var t = b.transfer || {};
          var note = t.status === "approved" ? "You said yes. It goes on " + day(t.scheduled_for) + "." : "You said yes. The money is on its way.";
          load().then(function () {
            var top = el.querySelector(".head .caption");
            if (top) top.textContent = note;
          });
        });
      }
      if (kind === "propose") {
        var pmsg = f.parentNode.querySelector(".act-msg");
        var els = f.elements;
        var amt = toCents(els.amount.value);
        if (!amt) { pmsg.textContent = "Type the amount like 2000.00"; return; }
        var to = els.to.value;
        var b2 = {
          action: "propose",
          to_kind: to === "fundhub" ? "fundhub" : "bank_account",
          to_account_id: to === "fundhub" ? null : to,
          suggested_from_account_id: els.from.value,
          amount_cents: amt,
          due_on: els.due_on.value,
          title: els.title.value
        };
        post(b2, pmsg, btn, "Saving…").then(function (b) { if (b) load(); });
      }
    }

    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("submit", onSubmit);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var el = root.document.getElementById("transfers-root");
    if (!el) return;
    var cid = param("client_id");
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    var nav = root.document.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        var parts = a.getAttribute("href").split("#");
        var href = parts[0] + "?client_id=" + encodeURIComponent(cid);
        a.setAttribute("href", parts.length > 1 ? href + "#" + parts.slice(1).join("#") : href);
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.transfers = { title: "Transfers", mount: mount, render: render };

  root.FHMoneyTransfers = {
    money: money, day: day, when: when, toCents: toCents, render: render, renderError: renderError,
    renderLoading: renderLoading, classify: classify, statusWords: statusWords, steps: steps,
    approvalSentence: approvalSentence, eventWords: eventWords, mount: mount
  };

  /* Auto-start only finds #transfers-root on the standalone page. The
     combined FinanceOS page calls FinanceOS.sections.transfers.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
