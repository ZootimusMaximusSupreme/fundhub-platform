/* Alerts bundle — the pieces under Finance OS Alerts (unit AL, Finance OS CFO
 * build, 2026-11-07; board ops/workflows/finance-os-cfo-build-2026-11-06.txt).
 *
 *   Card over 10%             the switch for the after-funding text
 *   Intro rate countdown      days left on a promo rate, and the monthly payoff at
 *                             that rate (the same amount as the Promo rate ending card)
 *   Business credit           each saved business's newest score against its last
 *   Weekly money text         what the Monday text says, and its switch
 *
 * "PAY BY" AND THE OVER-10% RULE ARE NOT HERE. They are one Smart alert per card
 * on the Alerts board above ("Pay by <date>", with what to pay when a card is over
 * 10%: src/finance/file-alerts/board.mjs, painted by money-alerts.js), so the
 * Alerts screen shows each of them once. This box keeps only the text's switch.
 * Short words (owner rule 2026-11-07): no explanation lines, no disclaimers.
 *
 * ONE READ, ONE WRITE. GET /api/money/alerts?part=bundle answers { ok, bundle }
 * (src/finance/file-alerts/bundle.mjs alertsBundlePayload) — only the bundle, so
 * the Alerts section's own read is not built twice. POST /api/money/alerts
 * { action: "set_bundle_alert", kind, enabled } switches one of the three texts.
 * When the answer has no `bundle` (an older endpoint ignores the parameter and
 * sends the plain alerts read), this paints nothing at all: no dead control, no error.
 *
 * SELF-CONTAINED. Mounted by Finance OS as window.FinanceOS.extras.alerts, in
 * its own box after the Alerts section (public/app/financeos.js mountTab). If
 * another extra is already there, both mount, one after the other. Styles:
 * money-alerts-bundle.css, every rule under .fh-bundle.
 *
 * THE HONESTY RULES (same as the other money pages):
 *   - Money arrives as integer cents. A null paints words, never $0.00.
 *   - Personal and business are told apart. Nothing here adds them.
 *   - Status is a word in a chip, never colour alone.
 *   - The texts themselves hold no amount and no card or bank name; the numbers
 *     are on the screen.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-alerts-bundle-screen.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/alerts";
  var POST_PATH = "/api/money/alerts";
  var ACCOUNTS_HREF = "/app/financeos.html#accounts";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var KINDS = ["card_over_10", "business_credit", "weekly_money"];
  var SWITCH_WORDS = {
    card_over_10: "Text me when a card goes over 10%",
    business_credit: "Text me when a business score changes",
    weekly_money: "Send me the Monday money text"
  };
  var KIND_TAG = { personal: "Personal", business: "Business" };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* cents → "$1,234.56". Null → null (the caller says it in words). */
  function money(cents) {
    if (!isNum(cents)) return null;
    var abs = Math.round(Math.abs(cents));
    var d = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (cents < 0 ? "−$" : "$") + d + "." + c;
  }
  /* cents → "$1,600", rounded UP: "pay about" — a little over is safe. */
  function dollarsUp(cents) {
    if (!isNum(cents)) return null;
    return "$" + String(Math.ceil(Math.max(0, cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    var t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]), wd: new Date(t).getUTCDay() };
  }
  /* "2026-11-13" → "Nov 13". With the year when it is not this year. */
  function day(iso, thisYear) {
    var p = parts(iso);
    if (!p) return null;
    return MONTHS[p.mo] + " " + p.d + (thisYear && p.y !== thisYear ? ", " + p.y : "");
  }
  function weekday(iso) { var p = parts(iso); return p ? DAYS[p.wd] + ", " + MONTHS[p.mo] + " " + p.d : null; }
  function yearOf(iso) { var p = parts(iso); return p ? p.y : null; }
  /* A sent_at timestamp → its UTC day. */
  function sentDay(ts) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(ts || "")); return m ? m[1] : null; }

  function cardName(c) {
    var name = c && c.name ? String(c.name) : "Card";
    return c && c.mask ? name + " ending " + c.mask : name;
  }
  function kindTag(k) { return KIND_TAG[k] ? '<span class="fb-tag">' + KIND_TAG[k] + "</span>" : ""; }
  function chip(word, tone) { return '<span class="fb-chip' + (tone ? " is-" + tone : "") + '">' + esc(word) + "</span>"; }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderSwitch(kind, sw, ui) {
    var on = !sw || sw.enabled !== false;
    var busy = ui && ui.busy === kind;
    return '<button type="button" class="fb-switch" role="switch" data-kind="' + kind + '" aria-checked="' + (on ? "true" : "false") + '"' +
      (busy ? ' aria-busy="true" disabled' : "") + ">" +
      '<span class="fb-sw-label">' + esc(SWITCH_WORDS[kind]) + "</span>" +
      '<span class="fb-track" aria-hidden="true"><span class="fb-thumb"></span></span>' +
      '<span class="fb-sw-word" aria-hidden="true">' + (busy ? "Saving…" : on ? "On" : "Off") + "</span></button>";
  }

  function head(cap, title, sub, right, id) {
    return '<div class="fb-head"><div class="fb-l"><p class="fb-cap">' + esc(cap) + "</p><h2" + (id ? ' id="' + id + '"' : "") + ">" + esc(title) + "</h2>" +
      (sub ? '<p class="fb-cap">' + sub + "</p>" : "") + "</div>" + (right || "") + "</div>";
  }

  /* The after-funding text's switch. Which card is over 10% and what to pay is its
     Smart alert on the board above, so it is not listed here a second time. */
  function renderCardRule(rule, sw, ui) {
    var sub = rule && rule.funded ? "" : "Starts after your first approval.";
    return '<section class="fb-panel" id="fb-card-rule" aria-labelledby="fb-card-rule-h">' +
      head("After funding", "Card over 10%", esc(sub), renderSwitch("card_over_10", sw, ui), "fb-card-rule-h") + "</section>";
  }

  /* The monthly amount includes the promo rate's interest (intro-countdown.mjs). With no
     rate on file it is only the least it can be, so it is never said to clear the balance. */
  function introLine(r, thisYear) {
    var rate = r.zero_rate === true ? chip("0%", "acc") : isNum(r.apr_pct) ? chip(r.apr_pct + "%", "acc") : "";
    var sub;
    if (r.ended) {
      return '<li class="fb-row"><div class="fb-t"><b>' + esc(cardName(r)) + '</b> ' + kindTag(r.kind) +
        '<span class="fb-cap">Promo ended ' + esc(day(r.ends_on, thisYear)) + "</span></div>" + chip("Ended", "") + "</li>";
    }
    /* One payment is said to the cent, more than one in whole dollars rounded up: the
       same as the Promo rate ending card and the promo text. */
    var one = r.payments_left === 1;
    var amount = one ? money(r.monthly_cents) : dollarsUp(r.monthly_cents);
    var when = one ? " before it ends" : " a month for " + r.payments_left + " months";
    if (r.nothing_owed) sub = "Nothing owed.";
    else if (!isNum(r.monthly_cents)) sub = "Balance not on file.";
    else if (r.monthly_is_floor === true || !isNum(r.apr_pct)) sub = "At least " + amount + when + ". Rate not on file.";
    else if (one) sub = "Pay all " + amount + when + ".";
    else sub = "Pay about " + amount + when + " to clear " + money(r.balance_cents) + ".";
    return '<li class="fb-row"><div class="fb-t"><b>' + esc(cardName(r)) + "</b> " + kindTag(r.kind) +
      '<span class="fb-big">' + esc(plural(r.days_left, "day", "days")) + " left</span>" +
      '<span class="fb-cap">Ends ' + esc(day(r.ends_on, thisYear)) + "</span>" +
      '<span class="fb-note">' + esc(sub) + "</span></div>" + rate + "</li>";
  }

  function renderIntro(rows, thisYear) {
    rows = list(rows);
    var body = rows.length
      ? '<ul class="fb-rows">' + rows.map(function (r) { return introLine(r, thisYear); }).join("") + "</ul>"
      : '<p class="fb-empty">No promo rates on file.</p>';
    return '<section class="fb-panel" id="fb-intro" aria-labelledby="fb-intro-h">' +
      head("Intro rate countdown", "Clear it before the rate goes up", "", "", "fb-intro-h") + body + "</section>";
  }

  var CHANGE = { up: ["Went up", "ok"], down: ["Went down", "alert"], mixed: ["Changed", "warn"], same: ["No change", ""] };

  function scoreLine(label, latest, previous, key) {
    var now = latest && isNum(latest[key]) ? latest[key] : null;
    if (now === null) return label + ": no score on the newest report";
    var was = previous && isNum(previous[key]) ? previous[key] : null;
    return label + " " + now + (was !== null ? " (was " + was + ")" : "");
  }

  function bizLine(b, thisYear) {
    var right;
    var lines;
    if (!b.latest) {
      right = chip("No report yet", "");
      lines = "";
    } else {
      var c = b.change && CHANGE[b.change.direction];
      right = !b.previous ? chip("1 report so far", "") : c ? chip(c[0], c[1]) : chip("Not comparable", "");
      lines = '<span class="fb-cap">' + esc(scoreLine("Intelliscore", b.latest, b.previous, "intelliscore")) + " · " +
        esc(scoreLine("FSR", b.latest, b.previous, "fsr")) + "</span>" +
        '<span class="fb-note">Newest report ' + esc(day(b.latest.on, thisYear)) + (b.latest.sample ? " · Sample report" : "") +
        (b.texted ? " · We texted you about it" : "") + "</span>";
    }
    return '<li class="fb-row"><div class="fb-t"><b>' + esc(b.name || "Business") + "</b>" + lines + "</div>" + right + "</li>";
  }

  function renderBusiness(rows, sw, ui, thisYear) {
    rows = list(rows);
    var body = rows.length
      ? '<ul class="fb-rows">' + rows.map(function (b) { return bizLine(b, thisYear); }).join("") + "</ul>"
      : '<p class="fb-empty">No business reports yet.</p>';
    return '<section class="fb-panel" id="fb-business" aria-labelledby="fb-business-h">' +
      head("Business credit", "Each business, on its own", "", renderSwitch("business_credit", sw, ui), "fb-business-h") + body + "</section>";
  }

  var WEEKLY_REASON = {
    nothing_to_say: "Nothing to say yet.",
    unsafe_words: "This week's text was held back.",
    bad_week: "The week could not be read."
  };

  function renderWeekly(w, sw, ui) {
    w = w || {};
    var next = w.next_on ? weekday(w.next_on) : null;
    var sub = "Every Monday at 9 a.m. Arizona time" + (next ? ". Next one: " + next : "") + ".";
    var on = !sw || sw.enabled !== false;
    var preview = w.preview
      ? '<blockquote class="fb-preview" aria-label="What the next text says">' + esc(w.preview) + "</blockquote>"
      : '<p class="fb-empty">' + esc(WEEKLY_REASON[w.preview_reason] || "No text this week.") + "</p>";
    var last = w.last_sent_at ? '<p class="fb-cap">Last sent ' + esc(day(sentDay(w.last_sent_at))) + ".</p>" : "";
    var off = on ? "" : '<p class="fb-note">The Monday text is off.</p>';
    return '<section class="fb-panel" id="fb-weekly" aria-labelledby="fb-weekly-h">' +
      head("Weekly money text", "Your week, in one text", esc(sub), renderSwitch("weekly_money", sw, ui), "fb-weekly-h") + preview + last + off + "</section>";
  }

  /* ── states ────────────────────────────────────────────────────────────── */

  function isEmpty(b) {
    return !list(b.card_rule && b.card_rule.cards).length && !list(b.business_credit).length &&
      !(b.weekly && b.weekly.preview);
  }

  function renderEmpty(b, ui) {
    return '<section class="fb-panel" id="fb-empty"><div class="fb-head"><div class="fb-l"><p class="fb-cap">More alerts</p>' +
      "<h2>Nothing to watch yet</h2></div></div>" +
      '<a class="fb-btn" href="' + ACCOUNTS_HREF + '">Add an account</a></section>' + renderWeekly(b.weekly, b.switches && b.switches.weekly_money, ui);
  }

  function renderLoading() {
    var bar = '<section class="fb-panel fb-skel" aria-hidden="true"><span></span><span></span><span></span></section>';
    return '<div aria-busy="true" aria-label="Loading more alerts">' + bar + bar + "</div>";
  }

  function renderError(kind) {
    var words = kind === "offline" ? "We could not reach the server. Check your connection and try again."
      : kind === "nodb" ? "Our database is not answering right now. Try again in a few minutes."
      : "These alerts did not load. Try again in a minute.";
    return '<section class="fb-panel" role="alert"><div class="fb-head"><div class="fb-l"><p class="fb-cap">More alerts</p><h2>Could not load</h2>' +
      '<p class="fb-cap">' + esc(words) + '</p></div></div><button type="button" class="fb-btn" data-fb-retry>Try again</button></section>';
  }

  /* The whole bundle. `b` is the read's `bundle` object. */
  function render(b, ui) {
    ui = ui || {};
    if (!b) return "";
    var sw = b.switches || {};
    var y = yearOf(b.today);
    if (isEmpty(b)) return renderEmpty(b, ui);
    return renderCardRule(b.card_rule, sw.card_over_10, ui) +
      renderIntro(b.intro, y) +
      renderBusiness(b.business_credit, sw.business_credit, ui, y) +
      renderWeekly(b.weekly, sw.weekly_money, ui);
  }

  /* An answer → "ok" | "offline" | "nodb" | "signin" | "server". */
  function classify(res) {
    var s = res && res.status;
    var body = res && res.body;
    if (!s) return "offline";
    if (s === 401) return "signin";
    if (s === 503 || (body && body.db === "down")) return "nodb";
    if (s >= 200 && s < 300 && body && body.ok === true) return "ok";
    return "server";
  }

  function readPath(clientId) {
    return READ_PATH + "?part=bundle" + (clientId ? "&client_id=" + encodeURIComponent(clientId) : "");
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function token() { try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }
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

  /* mount(el, ctx) — ctx = { clientId, apiGet, apiPost, onSignIn } (Finance OS's).
     Returns { ready, reload }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var post = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { bundle: null, ui: {} };

    function paint(html) {
      el.innerHTML = '<div class="fh-bundle">' + html + '<p class="fb-live" role="status" aria-live="polite"></p></div>';
    }
    function say(text) {
      var live = el.querySelector && el.querySelector(".fb-live");
      if (live) live.textContent = text;
    }
    function repaint() { paint(render(state.bundle, state.ui)); }

    function load() {
      paint(renderLoading());
      return get(readPath(clientId)).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { if (ctx.onSignIn) ctx.onSignIn(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        // An older endpoint answers without the bundle: show nothing, not an error.
        state.bundle = res.body.bundle || null;
        if (!state.bundle) { el.innerHTML = ""; return; }
        repaint();
      });
    }

    function toggle(btn) {
      var kind = btn.getAttribute("data-kind");
      if (KINDS.indexOf(kind) < 0 || !state.bundle || state.ui.busy) return;
      var sw = (state.bundle.switches = state.bundle.switches || {});
      var was = !sw[kind] || sw[kind].enabled !== false;
      var body = { action: "set_bundle_alert", kind: kind, enabled: !was };
      if (clientId) body.client_id = clientId;
      sw[kind] = { enabled: !was, label: sw[kind] && sw[kind].label };
      state.ui.busy = kind;
      repaint();
      post(POST_PATH, body).then(function (res) {
        state.ui.busy = null;
        var ok = res && res.status >= 200 && res.status < 300 && res.body && res.body.ok === true;
        if (!ok) sw[kind].enabled = was;
        repaint();
        say(ok ? SWITCH_WORDS[kind] + (was ? ": off." : ": on.") : "That change was not saved. Try again.");
        var again = el.querySelector && el.querySelector('[data-kind="' + kind + '"]');
        if (again && again.focus) again.focus();
      });
    }

    el.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-kind],[data-fb-retry]") : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute("data-fb-retry")) { load(); return; }
      toggle(t);
    });

    var ready = load();
    return { ready: ready, reload: load };
  }

  root.FHAlertsBundle = {
    money: money, dollarsUp: dollarsUp, day: day, weekday: weekday, cardName: cardName, classify: classify, readPath: readPath,
    render: render, renderCardRule: renderCardRule, renderIntro: renderIntro,
    renderBusiness: renderBusiness, renderWeekly: renderWeekly, renderLoading: renderLoading, renderError: renderError,
    renderEmpty: renderEmpty, isEmpty: isEmpty, mount: mount
  };

  /* The Finance OS hook: an extra after the Alerts section. Another extra that
     got there first keeps its box; this one takes the box after it. */
  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.extras = root.FinanceOS.extras || {};
  var prior = root.FinanceOS.extras.alerts;
  /* A second copy of this file (loaded twice) replaces the first and keeps the
     first's neighbour; it never chains onto itself. */
  if (prior && prior.fhAlertsBundle) prior = prior.other || null;
  if (prior && typeof prior.mount === "function") {
    root.FinanceOS.extras.alerts = {
      fhAlertsBundle: true,
      other: prior,
      mount: function (el, ctx) {
        el.innerHTML = '<div class="fb-prior"></div><div class="fb-mine"></div>';
        var a = null;
        try { a = prior.mount(el.firstChild, ctx); } catch (e) { el.firstChild.innerHTML = ""; }
        var b = mount(el.lastChild, ctx);
        return { reload: function () { if (a && a.reload) a.reload(); return b.reload(); } };
      }
    };
  } else {
    root.FinanceOS.extras.alerts = { fhAlertsBundle: true, mount: mount };
  }
})(typeof window !== "undefined" ? window : globalThis);
