/* Plan — the FinanceOS month of dated pins (/app/money-plan.html,
 * window.FinanceOS.sections.plan).
 *
 * Owner (2026-10-06): "A waypoint timeline: the full month view, strategic pins
 * on dates — when to open accounts and deposit specific amounts." This section
 * paints ONE read, GET /api/money/plan?month=YYYY-MM: a Mon–Sun calendar with
 * each pin on its day, the same pins as a list under it, and a detail panel for
 * one pin. Every figure is a field from that read; nothing here invents a date,
 * an amount or a step. The pins come from src/finance/plan-sources/ (the client's
 * checklist, card and loan due dates, payments owed to Fundhub, and any source
 * registered next to them).
 *
 * THE HONESTY RULES:
 *   - Money arrives as integer cents. A null paints "Not known yet", never $0.00.
 *   - Status is said in words (Done, Missed, Planned, Not recorded) in the list
 *     and the detail; in a calendar cell it is a shape (a check, an "!") as well
 *     as a colour. Today is a ring AND the word "Today" (UI-STANDARDS §12.6).
 *   - A planned date that has passed says "Not recorded": nothing on file says
 *     whether it happened, so the screen does not guess.
 *   - Staff controls draw only from the pin's own can_mark, which the server
 *     fills for staff only. A client never sees one, and the server refuses a
 *     client's mark anyway.
 *
 * At 760px and under the calendar collapses to the list; the page never scrolls
 * sideways (UI-STANDARDS §11). Styles: money-plan.css, every rule under .fh-plan.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-plan-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/plan";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  /* How many pins one calendar cell shows before "+N more". */
  var CELL_PINS = 2;

  var KIND_WORD = {
    open_account: "Open an account", deposit: "Deposit", pay_down: "Pay down", apply: "Apply",
    due: "Payment due", checkpoint: "Checklist step", other: "Step"
  };
  /* Where a pin came from, in words. A source not named here prints its own name. */
  var SOURCE_WORD = {
    waypoints: "Your checklist", dues: "Card and loan due dates", clarity: "Payments to Fundhub",
    "bank-strategy": "Bank plan", "funding-rounds": "Funding rounds", payoff: "Payoff plan"
  };
  /* A page that holds more about a source's pins. A link to an old money page
     switches tabs inside /app/financeos.html (financeos.js tabForHref). */
  var SOURCE_LINK = { clarity: { href: "money-payments.html", label: "See it on Payments" } };

  /* Inline icons, 16×16, drawn in the text colour. Kind icons first, then the
     two status shapes a calendar cell uses. */
  var ICON = {
    due: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/>',
    open_account: '<path d="M2 6.5 8 3l6 3.5M3 13.5h10M4 7.5v5M8 7.5v5M12 7.5v5"/>',
    deposit: '<path d="M8 2v7M5 6l3 3 3-3M2.5 10.5v2.5h11v-2.5"/>',
    pay_down: '<path d="M2 4l4.5 4.5 2.5-2.5L14 11M10 11h4V7"/>',
    apply: '<path d="M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12M6 8h4M6 11h4"/>',
    checkpoint: '<path d="M3.5 14.5v-13M3.5 2.5h8l-1.5 3 1.5 3h-8"/>',
    other: '<circle cx="8" cy="8" r="4.5"/>',
    done: '<path d="M3 8.5l3 3 7-7"/>',
    missed: '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v4.5M8 11.2v.3"/>'
  };

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
    if (!isNum(cents)) return null;
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  function icon(name) {
    var body = ICON[name] || ICON.other;
    return '<span class="ic" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + body + '</svg></span>';
  }

  /* "2026-10-15" → { y, m, d } read as a calendar date, never a local midnight. */
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  }
  /* 1 = Monday … 7 = Sunday. */
  function weekdayOf(iso) {
    var p = parts(iso);
    if (!p) return 1;
    var dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return ((dow + 6) % 7) + 1;
  }
  function dayShort(iso) {
    var p = parts(iso);
    return p ? MON[p.m - 1] + " " + p.d : "—";
  }
  function dayHead(iso) {
    var p = parts(iso);
    return p ? DOW[weekdayOf(iso) - 1] + ", " + MON[p.m - 1] + " " + p.d : "—";
  }
  function dayLong(iso) {
    var p = parts(iso);
    return p ? DOW_LONG[weekdayOf(iso) - 1] + ", " + MONTHS[p.m - 1] + " " + p.d + ", " + p.y : "—";
  }
  function monthTitle(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "This month";
  }
  /* "2026-10" moved by n months → "2026-11". */
  function shiftMonth(ym, n) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
    if (!m) return null;
    var idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
    return Math.floor(idx / 12) + "-" + ("0" + ((idx % 12) + 1)).slice(-2);
  }
  function monthShort(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
    return m ? MON[Number(m[2]) - 1] : "";
  }

  /* ── status — a word for the list and the detail, a class for the shape ── */

  function statusKey(pin, today) {
    if (pin.status === "done") return "done";
    if (pin.status === "missed") return "missed";
    if (today && pin.date < today) return "past";
    return "planned";
  }
  var STATUS_WORD = { done: "Done", missed: "Missed", past: "Not recorded", planned: "Planned" };
  function statusWord(pin, today) { return STATUS_WORD[statusKey(pin, today)]; }

  function sourceWord(name) {
    return SOURCE_WORD[name] || String(name || "Plan").replace(/-/g, " ");
  }

  function containerName(d, id) {
    if (!id) return null;
    var c = list(d && d.containers).filter(function (x) { return x && x.id === id; })[0];
    return c && c.name ? c.name : null;
  }

  function pinsByDate(d) {
    var by = {};
    list(d && d.pins).forEach(function (p) { (by[p.date] = by[p.date] || []).push(p); });
    return by;
  }

  function findPin(d, id) {
    return list(d && d.pins).filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderHead() {
    return '<div class="head"><div><h1>Plan</h1><p class="caption">' +
      'Every date that matters this month: payments due and steps to take.</p></div></div>';
  }

  /* The month bar: the month's name and the way to the months either side. It
     stays on a phone, where the calendar itself collapses to the list. */
  function renderMonthBar(month, today) {
    var prev = shiftMonth(month, -1);
    var next = shiftMonth(month, 1);
    var thisMonth = today ? today.slice(0, 7) : null;
    var todayBtn = thisMonth && thisMonth !== month
      ? '<button type="button" class="btn" data-act="month" data-month="' + esc(thisMonth) + '">Today</button>' : "";
    return '<div class="monthbar"><h2 id="pl-month">' + esc(monthTitle(month)) + '</h2>' +
      '<div class="month-nav">' +
      (prev ? '<button type="button" class="btn" data-act="month" data-month="' + esc(prev) + '" aria-label="Previous month, ' +
        esc(monthTitle(prev)) + '"><span aria-hidden="true">‹</span> ' + esc(monthShort(prev)) + '</button>' : "") +
      todayBtn +
      (next ? '<button type="button" class="btn" data-act="month" data-month="' + esc(next) + '" aria-label="Next month, ' +
        esc(monthTitle(next)) + '">' + esc(monthShort(next)) + ' <span aria-hidden="true">›</span></button>' : "") +
      '</div></div>';
  }

  /* One line when a source failed: which part, and a way to try again. A part
     that did not load is never painted as a part with nothing in it. */
  function renderFailed(d) {
    var bad = list(d && d.sources).filter(function (s) { return s && s.ok === false; });
    if (!bad.length) return "";
    return '<div class="fail" role="status"><strong>Part of your plan did not load:</strong> ' +
      '<span>' + esc(bad.map(function (s) { return sourceWord(s.name); }).join(", ")) + '.</span> ' +
      '<span>Everything else is below.</span> ' +
      '<button type="button" class="btn-text" data-act="retry">Try again</button></div>';
  }

  function renderTiles(d) {
    var today = d.today;
    var pins = list(d.pins);
    var next = pins.filter(function (p) { return p.status === "planned" && (!today || p.date >= today); })[0] || null;
    var counts = { done: 0, missed: 0, past: 0, planned: 0 };
    pins.forEach(function (p) { counts[statusKey(p, today)]++; });
    var missed = pins.filter(function (p) { return p.status === "missed"; });

    var nx = next
      ? '<span class="big">' + esc(dayShort(next.date)) + '</span><p class="caption">' +
        esc(next.title + (money(next.amount_cents) ? " · " + money(next.amount_cents) : "")) + '</p>'
      : '<span class="big">—</span><p class="caption">Nothing coming up in ' + esc(monthTitle(d.month)) + '.</p>';

    var bits = [];
    if (counts.done) bits.push(counts.done + " done");
    if (counts.missed) bits.push(counts.missed + " missed");
    if (counts.planned) bits.push(counts.planned + " coming up");
    if (counts.past) bits.push(counts.past + " not recorded");

    var ms = missed.length
      ? '<p class="caption">' + esc(missed[0].title + " · " + dayShort(missed[0].date)) +
        (missed.length > 1 ? esc(" · and " + plural(missed.length - 1, "more", "more")) : "") + '</p>'
      : '<p class="caption">Nothing missed in ' + esc(monthTitle(d.month)) + '.</p>';

    return '<div class="grid tiles">' +
      '<section class="card tile" aria-labelledby="pl-t-next"><h2 class="eyebrow" id="pl-t-next">Next up</h2>' + nx + '</section>' +
      '<section class="card tile" aria-labelledby="pl-t-month"><h2 class="eyebrow" id="pl-t-month">This month</h2>' +
      '<span class="big">' + esc(pins.length) + '</span><p class="caption">' + esc(plural(pins.length, "date", "dates") +
        (bits.length ? " · " + bits.join(" · ") : "")) + '</p></section>' +
      '<section class="card tile" aria-labelledby="pl-t-missed"><h2 class="eyebrow" id="pl-t-missed">Missed</h2>' +
      '<span class="big">' + esc(missed.length) + '</span>' + ms + '</section>' +
      '</div>';
  }

  /* A pin in a cell: its icon, its title, then the amount and the bank on the
     line under it. The whole line, status included, is in the tooltip. */
  function pinButton(p, today) {
    var key = statusKey(p, today);
    var amt = money(p.amount_cents);
    var bank = p.bank && String(p.title).indexOf(p.bank) === -1 ? p.bank : null;
    var sub = [amt, bank].filter(Boolean).join(" · ");
    var tip = [p.title, amt, p.bank, STATUS_WORD[key]].filter(Boolean).join(" · ");
    var glyph = key === "done" ? icon("done") : key === "missed" ? icon("missed") : icon(p.kind);
    return '<li><button type="button" class="pin caption st-' + key + '" data-pin="' + esc(p.id) + '" title="' + esc(tip) + '">' +
      glyph + '<span class="pin-body"><span class="pin-t">' + esc(p.title) + '</span>' +
      (sub ? '<span class="pin-a">' + esc(sub) + '</span>' : "") + '</span>' +
      '<span class="sr-only">, ' + esc(STATUS_WORD[key]) + '</span></button></li>';
  }

  /* The month as a Mon–Sun table. Days outside the window are blank cells. */
  function renderCalendar(d) {
    var days = list(d.days);
    if (!days.length) return "";
    var by = pinsByDate(d);
    var cells = [];
    var lead = (days[0].weekday || weekdayOf(days[0].date)) - 1;
    var i;
    for (i = 0; i < lead; i++) cells.push(null);
    days.forEach(function (x) { cells.push(x); });
    while (cells.length % 7) cells.push(null);

    var rows = "";
    for (i = 0; i < cells.length; i += 7) {
      rows += "<tr>" + cells.slice(i, i + 7).map(function (day) {
        if (!day) return '<td class="cal-out"></td>';
        var p = parts(day.date);
        var mine = by[day.date] || [];
        var past = d.today && day.date < d.today;
        var cls = "cal-day" + (day.is_today ? " is-today" : "") + (past ? " is-past" : "");
        var extra = mine.length - CELL_PINS;
        return '<td class="' + cls + '"' + (day.is_today ? ' aria-current="date"' : "") + '>' +
          '<div class="cal-top"><span class="dnum">' + esc(p ? p.d : "") + '</span>' +
          (day.is_today ? '<span class="today-tag caption">Today</span>' : "") + '</div>' +
          (mine.length ? '<ul class="cal-pins">' + mine.slice(0, CELL_PINS).map(function (x) { return pinButton(x, d.today); }).join("") + '</ul>' : "") +
          (extra > 0 ? '<button type="button" class="more caption" data-act="day" data-day="' + esc(day.date) + '">+' + esc(extra) + ' more</button>' : "") +
          '</td>';
      }).join("") + "</tr>";
    }
    return '<section class="card cal" aria-labelledby="pl-month">' +
      '<table class="cal-grid"><caption class="sr-only">' + esc(monthTitle(d.month)) + ', Monday to Sunday</caption>' +
      '<thead><tr>' + DOW.map(function (w) { return '<th scope="col">' + w + '</th>'; }).join("") + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  function rowButton(p, d) {
    var key = statusKey(p, d.today);
    var amt = money(p.amount_cents);
    var meta = [KIND_WORD[p.kind] || "Step", containerName(d, p.container_id), p.bank].filter(Boolean).join(" · ");
    return '<li><button type="button" class="row st-' + key + '" data-pin="' + esc(p.id) + '">' +
      icon(p.kind) +
      '<span class="row-main"><span class="row-t">' + esc(p.title) + '</span><span class="caption">' + esc(meta) + '</span></span>' +
      '<span class="row-end">' + (amt ? '<span class="num">' + esc(amt) + '</span>' : '<span class="caption">Amount not known yet</span>') +
      '<span class="st caption is-' + key + '">' + esc(STATUS_WORD[key]) + '</span></span>' +
      '</button></li>';
  }

  /* The same pins as a list, day by day. It is the whole view on a phone, so
     today gets its own line here even when nothing falls on it. */
  function renderList(d) {
    var by = pinsByDate(d);
    var dates = Object.keys(by);
    var todayInside = d.today && d.from && d.to && d.today >= d.from && d.today <= d.to;
    if (todayInside && !by[d.today]) dates.push(d.today);
    dates.sort();
    var body = dates.map(function (date) {
      var isToday = date === d.today;
      var mine = by[date] || [];
      return '<li class="day" data-day-row="' + esc(date) + '"><h3 class="day-h caption" tabindex="-1">' + esc(dayHead(date)) +
        (isToday ? ' <span class="today-tag caption">Today</span>' : "") + '</h3>' +
        (mine.length
          ? '<ul class="rows">' + mine.map(function (p) { return rowButton(p, d); }).join("") + '</ul>'
          : '<p class="caption">Nothing on your plan today.</p>') + '</li>';
    }).join("");
    return '<section class="card plan-list" aria-labelledby="pl-list-h"><h2 class="eyebrow" id="pl-list-h">Every date in ' +
      esc(monthTitle(d.month)) + '</h2><ol class="days">' + body + '</ol></section>';
  }

  function renderEmpty(d, opts) {
    var href = "money-accounts.html" + (opts && opts.clientId ? "?client_id=" + encodeURIComponent(opts.clientId) : "");
    return '<section class="card empty"><h2>Nothing on your plan for ' + esc(monthTitle(d.month)) + '</h2>' +
      '<p>When a card or loan payment is due, a payment to Fundhub is due, or a step on your checklist has a date, it shows here on its day.</p>' +
      '<a class="btn-primary" href="' + esc(href) + '">Add an account</a></section>';
  }

  /* The panel for one pin: what, when, how much, its status in words, why, and
     where it came from. Staff see a mark button only when the pin allows it. */
  function renderDetail(pin, d, opts) {
    if (!pin) return "";
    var key = statusKey(pin, d.today);
    var amt = money(pin.amount_cents);
    var box = containerName(d, pin.container_id);
    var link = SOURCE_LINK[pin.source];
    var cid = opts && opts.clientId;
    var linkHtml = link
      ? ' · <a href="' + esc(link.href + (cid ? "?client_id=" + encodeURIComponent(cid) : "")) + '">' + esc(link.label) + '</a>' : "";
    var marks = list(pin.can_mark);
    var busy = opts && opts.busy;
    var msg = opts && opts.message ? opts.message : "";
    var act = marks.length
      ? '<div class="pl-act"><span class="eyebrow">Staff only</span>' +
        (marks.indexOf("done") !== -1 ? '<button type="button" class="btn-primary" data-act="mark" data-status="done"' + (busy ? " disabled" : "") + '>' + (busy ? "Saving…" : "Mark done") + '</button>' : "") +
        (marks.indexOf("missed") !== -1 ? '<button type="button" class="btn" data-act="mark" data-status="missed"' + (busy ? " disabled" : "") + '>Mark missed</button>' : "") +
        '<p class="act-msg caption" aria-live="polite">' + esc(msg) + '</p></div>'
      : (msg ? '<p class="act-msg caption" aria-live="polite">' + esc(msg) + '</p>' : "");
    var pastNote = key === "past" ? '<p class="caption">This date has passed. Nothing on file says whether it was done.</p>' : "";
    return '<div class="pl-scrim" data-act="close"></div>' +
      '<div class="pl-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-d-title">' +
      '<div class="pl-top"><span class="eyebrow pl-kind">' + icon(pin.kind) + esc(KIND_WORD[pin.kind] || "Step") + '</span>' +
      '<button type="button" class="btn" data-act="close">Close</button></div>' +
      '<h2 id="pl-d-title">' + esc(pin.title) + '</h2>' +
      '<p class="pl-when">' + esc(dayLong(pin.date)) + '</p>' +
      '<dl class="facts">' +
      '<div><dt class="caption">Amount</dt><dd>' + (amt ? '<span class="num">' + esc(amt) + '</span>' : "Not known yet") + '</dd></div>' +
      '<div><dt class="caption">Status</dt><dd><span class="st caption is-' + key + '">' + esc(STATUS_WORD[key]) + '</span></dd></div>' +
      (pin.bank ? '<div><dt class="caption">Bank</dt><dd>' + esc(pin.bank) + '</dd></div>' : "") +
      (box ? '<div><dt class="caption">For</dt><dd>' + esc(box) + '</dd></div>' : "") +
      '</dl>' + pastNote +
      (pin.detail ? '<div class="pl-why"><h3 class="eyebrow">Why</h3><p>' + esc(pin.detail) + '</p></div>' : "") +
      '<p class="caption">From: ' + esc(sourceWord(pin.source)) + linkHtml + '</p>' +
      act + '</div>';
  }

  function isEmpty(d) { return !d || list(d.pins).length === 0; }

  function allFailed(d) {
    var s = list(d && d.sources);
    return s.length > 0 && s.every(function (x) { return x && x.ok === false; });
  }

  /* The whole section for one answer. */
  function render(d, opts) {
    var top = renderHead() + renderFailed(d);
    if (isEmpty(d)) return top + renderMonthBar(d.month, d.today) + renderEmpty(d, opts);
    return top + renderTiles(d) + renderMonthBar(d.month, d.today) + renderCalendar(d) + renderList(d);
  }

  function renderLoading(month, today) {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    var cell = '<td><span class="sk sk-s"></span></td>';
    var row = "<tr>" + new Array(8).join(cell) + "</tr>";
    return renderHead() +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + '</div>' +
      (month ? renderMonthBar(month, today) : '<div class="monthbar"><span class="sk sk-m"></span></div>') +
      '<section class="card cal" aria-busy="true"><table class="cal-grid"><thead><tr>' +
      DOW.map(function (w) { return '<th scope="col">' + w + '</th>'; }).join("") + '</tr></thead><tbody>' +
      new Array(6).join(row) + '</tbody></table></section>' +
      '<section class="card plan-list skel" aria-busy="true"><span class="sk sk-m"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your plan. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose plan to show. Open it from a client's file.",
    badrequest: "That month could not be shown. Go back to this month and try again."
  };

  function renderError(kind) {
    return renderHead() +
      '<section class="card error" role="alert"><h2>We could not load your plan</h2>' +
      '<p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button type="button" class="btn-primary" data-act="retry">Try again</button></section>';
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

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.plan ─────────────────────────
     mount(el, ctx) paints this section into `el` and wires its controls. No
     page chrome. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only (a staff desk passes it; a client session leaves it
                 empty — the server pins a client to their own file)
       apiGet(path) / apiPost(path, body) → Promise of { status, body }
     Missing api functions fall back to this file's own fetch. Returns
     { reload, unmount }. Everything paints from one state object, so the
     open panel survives a repaint. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { data: null, month: null, open: null, message: "", busy: false, loads: 0, returnTo: null };
    var opts = function () { return { clientId: clientId, busy: state.busy, message: state.message }; };

    function paint(html) {
      var layer = state.data && state.open ? renderDetail(findPin(state.data, state.open), state.data, opts()) : "";
      el.innerHTML = '<div class="fh-plan"><div class="pl-body">' + html + '</div>' +
        '<div class="pl-layer"' + (layer ? "" : " hidden") + '>' + layer + '</div></div>';
    }
    function repaint() { if (state.data) paint(render(state.data, opts())); }
    function q(sel) { return el.querySelector ? el.querySelector(sel) : null; }

    function load(month) {
      var ticket = ++state.loads;
      state.open = null;
      state.message = "";
      paint(renderLoading(month || state.month, state.data && state.data.today));
      var qs = [];
      if (month || state.month) qs.push("month=" + encodeURIComponent(month || state.month));
      if (clientId) qs.push("client_id=" + encodeURIComponent(clientId));
      return get(READ_PATH + (qs.length ? "?" + qs.join("&") : "")).then(function (res) {
        if (ticket !== state.loads) return; // a newer month was asked for
        var kind = classify(res);
        if (kind === "signin") {
          if (ctx.onSignIn) ctx.onSignIn(); else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind === "ok" && allFailed(res.body)) kind = "server";
        if (kind !== "ok") { state.data = null; paint(renderError(kind)); return; }
        state.data = res.body;
        state.month = res.body.month || month || state.month;
        repaint();
      });
    }

    function focusClose() {
      var btn = q('.pl-drawer [data-act="close"]');
      if (btn && btn.focus) btn.focus();
    }

    /* Open one pin's panel. `from` is the button pressed, so focus can go back
       to that same button (the calendar's or the list's) when it closes. */
    function open(id, from) {
      if (!state.data || !findPin(state.data, id)) return;
      state.open = id;
      state.message = "";
      state.returnTo = { id: id, cls: from && from.classList && from.classList.contains("row") ? "row" : "pin" };
      repaint();
      focusClose();
    }

    function close() {
      if (!state.open) return;
      state.open = null;
      state.message = "";
      repaint();
      var r = state.returnTo;
      var back = r ? q("." + r.cls + '[data-pin="' + String(r.id).replace(/["\\]/g, "\\$&") + '"]') : null;
      if (back && back.focus) back.focus();
    }

    function mark(status) {
      var pin = state.data && findPin(state.data, state.open);
      if (!pin || state.busy) return;
      var words = status === "done" ? "done" : "missed";
      if (root.confirm && !root.confirm("Mark “" + pin.title + "” " + words + "? The client sees this on their plan.")) return;
      state.busy = true;
      repaint();
      focusClose();
      var body = { action: "mark", source: pin.source, pin_id: pin.id, status: status };
      if (clientId) body.client_id = clientId;
      send(READ_PATH, body).then(function (res) {
        state.busy = false;
        var ok = res && res.status === 200 && res.body && res.body.ok === true;
        if (ok && res.body.pin) {
          state.data.pins = list(state.data.pins).map(function (p) { return p.id === pin.id ? res.body.pin : p; });
          state.message = "Marked " + words + ".";
        } else {
          state.message = (res && res.body && res.body.message) || ERROR_WORDS[classify(res || {})] || ERROR_WORDS.server;
        }
        repaint();
        focusClose();
      });
    }

    function onClick(e) {
      /* A link in the panel (See it on Payments) leaves this tab: let it go,
         then close the panel so it is not still open on the way back. */
      var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (link && state.open && root.setTimeout) { root.setTimeout(close, 0); return; }
      var t = e.target && e.target.closest ? e.target.closest("[data-act],[data-pin]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      var pinId = t.getAttribute("data-pin");
      if (pinId) { open(pinId, t); return; }
      var act = t.getAttribute("data-act");
      if (act === "retry") load(state.month);
      if (act === "month") load(t.getAttribute("data-month"));
      if (act === "close") close();
      if (act === "mark") mark(t.getAttribute("data-status"));
      if (act === "day") {
        var row = q('[data-day-row="' + t.getAttribute("data-day") + '"] .day-h');
        if (row) {
          if (row.scrollIntoView) row.scrollIntoView({ block: "start", behavior: "smooth" });
          if (row.focus) row.focus();
        }
      }
    }

    /* Escape closes the panel; Tab stays inside it while it is open. */
    function onKey(e) {
      if (!state.open) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      var drawer = q(".pl-drawer");
      var nodes = drawer ? drawer.querySelectorAll("button:not([disabled]), a[href]") : [];
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      var at = root.document && root.document.activeElement;
      if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }

    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    load(null);
    return {
      reload: function () { return load(state.month); },
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("keydown", onKey);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var el = root.document.getElementById("plan-root");
    if (!el) return;
    var cid = param("client_id");
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    /* Staff carry the client across the money pages. The query goes before
       the #tab: /app/financeos.html?client_id=…#credit. */
    var nav = root.document.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        var bits = a.getAttribute("href").split("#");
        var href = bits[0] + "?client_id=" + encodeURIComponent(cid);
        a.setAttribute("href", bits.length > 1 ? href + "#" + bits.slice(1).join("#") : href);
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.plan = { title: "Plan", mount: mount, render: render };

  root.FHMoneyPlan = {
    money: money, shiftMonth: shiftMonth, monthTitle: monthTitle, weekdayOf: weekdayOf, dayLong: dayLong,
    statusWord: statusWord, isEmpty: isEmpty, render: render, renderDetail: renderDetail,
    renderLoading: renderLoading, renderError: renderError, classify: classify, mount: mount, CELL_PINS: CELL_PINS
  };

  /* Auto-start only finds #plan-root on the standalone page. The combined
     FinanceOS page calls FinanceOS.sections.plan.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
