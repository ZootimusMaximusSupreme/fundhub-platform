/* Strategy — how to pay the cards and loans down (/app/money-strategy.html).
 *
 * FinanceOS wave 5, unit W4. Owner, 2026-10-06: "real-time feedback on payment
 * strategies; calculations showing how to reduce payments and timelines to
 * achieve goals."
 *
 * ONE READ, THEN THE MATH RUNS HERE. GET /api/money/strategy hands over the
 * inputs (every card and loan, each kind's safe amount this month). Every move
 * of the slider, the method switch or the goal date reruns the plan in the
 * browser with public/app/money-strategy-math.js — the SAME file the server
 * runs — so the numbers change as you drag and never disagree with the server.
 * "Save this plan" sends only the choices; the server works the plan out again
 * from fresh reads before it keeps anything.
 *
 * THE HONESTY RULES (same as the other money pages):
 *   - Money arrives as integer cents. A null paints "—" or words, never $0.00.
 *   - A missing APR, minimum or limit is said in words, with what it changes.
 *   - Status is a word and a shape, never colour alone (UI-STANDARDS §12.6).
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-strategy-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/strategy";
  var MATH_PATH = "/app/money-strategy-math.js";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KIND_LABEL = { personal: "Personal", business: "Business", unknown: "Not sorted yet" };
  var KIND_WORD = { personal: "personal", business: "business", unknown: "not-sorted-yet" };
  var METHOD_ORDER = ["avalanche", "utilization", "snowball"];
  var METHOD_FALLBACK = {
    avalanche: { label: "Highest rate first", detail: "Extra money goes to the debt with the highest APR. Saves the most interest." },
    utilization: { label: "Card use first", detail: "Each card goes down to 10% of its limit, highest card use first. Then highest APR first." },
    snowball: { label: "Smallest balance first", detail: "Extra money goes to the smallest balance. Closes debts sooner." }
  };
  var GOAL_LABEL = { debt_free: "Debt-free by", util30: "Card use under 30% by", util10: "Card use under 10% by" };
  var TARGET_WORD = { 30: "UnderwriteIQ's fundable line", 10: "UnderwriteIQ's target" };
  var PAGE = 24;
  var DASHES = ["8 5", "2 4", "12 4 2 4", "1 3"];

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* cents → "$1,234.56". Null → "—". */
  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  /* cents → "1,234.56" for the amount box. */
  function amountText(cents) {
    return isNum(cents) ? money(cents).replace(/^\$/, "") : "";
  }

  /* "500" / "1,500.5" / "$1,500.00" → cents, no float maths. null when not money. */
  function toCents(text) {
    var s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || "") + "00";
    var cents = Number(m[1]) * 100 + Number(frac.slice(0, 2));
    return isFinite(cents) && cents <= 100000000 ? cents : null;
  }

  /* "2026-10-21" → "Oct 21, 2026", read as a calendar date. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }
  /* "2027-01-06" → "Jan '27" for chart ticks. */
  function tick(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " ’" + m[1].slice(2) : "";
  }
  function pct(v) { return isNum(v) ? (Math.round(v * 10) / 10) + "%" : "—"; }
  /* An APR as stored, to the hundredth: 24.99%, never rounded to 25%. */
  function apr(v) { return isNum(v) ? (Math.round(v * 100) / 100) + "%" : "—"; }

  function names(arr) {
    var a = list(arr).filter(Boolean);
    if (a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  }

  function debtById(plan) {
    var map = {};
    list(plan && plan.debts).forEach(function (d) { map[d.id] = d; });
    return map;
  }
  function nameOf(plan, id) {
    var d = debtById(plan)[id];
    return d ? d.name : "";
  }
  function methodWords(data, key) {
    var m = data && data.methods && data.methods[key];
    return { label: (m && m.label) || METHOD_FALLBACK[key].label, detail: (m && m.detail) || METHOD_FALLBACK[key].detail };
  }

  /* ── head, loading, error, empty ───────────────────────────────────────── */

  function renderHead(data) {
    var who = data && data.client && data.client.name ? data.client.name + " · " : "";
    return '<div class="head"><div><h1>Payment strategy</h1><p class="caption">' +
      esc(who + "Pick how much goes to debt each month and how. See when you are done, what it saves, and when your card use hits UnderwriteIQ's targets.") +
      '</p></div></div>';
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h1>Payment strategy</h1><p class="caption">Loading your cards and loans…</p></div></div>' +
      '<div class="card skel controls" aria-busy="true"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + tile + '</div>' +
      '<div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div>' +
      '<div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your plan. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose plan to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed.",
    math: "The part of the page that does the math did not load. Try again."
  };

  function renderError(kind) {
    return '<div class="head"><div><h1>Payment strategy</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your plan</h2>' +
      '<p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function renderEmpty(data) {
    var excluded = list(data && data.inputs && data.inputs.debts).filter(function (d) { return !isNum(d.balance_cents); });
    var note = excluded.length
      ? '<p class="caption">' + esc(names(excluded.map(function (d) { return d.name; }))) + ' ' +
        (excluded.length === 1 ? "has" : "have") + ' no balance on file yet, so ' + (excluded.length === 1 ? "it is" : "they are") + ' left out.</p>'
      : "";
    return renderHead(data) +
      '<section class="card empty"><h2>No cards or loans with a balance yet</h2>' +
      '<p>When a card or loan with money owed is on file, this page shows how to pay it down, month by month.</p>' + note +
      '<a class="btn-primary" href="/app/financeos.html#accounts">Add an account</a></section>';
  }

  /* ── the controls (the form) ───────────────────────────────────────────── */

  function sliderMax(plan, settings) {
    var min = Math.ceil((plan.minimums_cents || 0) / 100) * 100;
    var want = Math.max(min * 4, settings.monthly_cents || 0, 100000);
    var all = plan.payoff_all_cents || want;
    return Math.max(min + 100, Math.ceil(Math.min(want, all) / 100) * 100, Math.ceil((settings.monthly_cents || 0) / 100) * 100);
  }

  function renderAmountNote(plan) {
    var bits = ["Minimum payments: " + money(plan.minimums_cents) + " a month."];
    var max = plan.cash && plan.cash.max_safe;
    if (max && max.unlimited) bits.push("This month's cash can cover paying everything off.");
    else if (max && isNum(max.monthly_cents)) bits.push("This month's cash can cover up to " + money(max.monthly_cents) + ".");
    return bits.join(" ");
  }

  function renderGoalNote(data, plan, settings) {
    var g = settings.goal;
    if (!g || !g.kind) return "";
    if (!g.by) return '<p class="caption">Pick a date for this goal.</p>';
    var r = plan.goal;
    if (!r) return "";
    if (!r.ok) {
      var why = {
        goal_too_soon: "Pick a date at least one month from today.",
        goal_date_invalid: "That date could not be read. Pick it again.",
        no_limits: "No card has a credit limit on file, so card use cannot be measured.",
        goal_unreachable: "That goal cannot be reached by that date."
      };
      return '<p class="goal-out">' + esc(why[r.reason && r.reason.code] || "That goal cannot be worked out.") + '</p>';
    }
    if (r.already_met) {
      return '<p class="goal-out">' + esc(r.kind === "util30"
        ? "Card use is already under 30% — UnderwriteIQ's fundable line. Paying your minimums keeps it there."
        : r.kind === "util10" ? "Card use is already under 10% — UnderwriteIQ's target." : "Nothing is owed.") + '</p>';
    }
    var how = methodWords(data, plan.method).label.toLowerCase();
    var line = "To get there by " + day(g.by) + " you need " + money(r.monthly_cents) + " a month (" + how + ").";
    var cash = r.fits_cash === false
      ? ' <span class="warn-word">More than this month\'s cash can cover.</span>'
      : "";
    var same = plan.monthly_cents === r.monthly_cents;
    return '<p class="goal-out">' + esc(line) + cash + '</p>' +
      (same ? '<p class="caption">Your amount is set to this.</p>'
        : '<button class="btn-line" type="button" data-act="use-amount" data-cents="' + esc(r.monthly_cents) + '">Use ' + esc(money(r.monthly_cents)) + '</button>');
  }

  function sameAsSaved(saved, settings) {
    if (!saved) return false;
    var sg = saved.goal || null;
    var g = settings.goal && settings.goal.kind && settings.goal.by ? settings.goal : null;
    return saved.method === settings.method && saved.monthly_cents === settings.monthly_cents &&
      (sg ? !!g && sg.kind === g.kind && sg.by === g.by : !g);
  }

  function renderSaveNote(data, settings) {
    var s = data && data.saved;
    if (!s) return "Not saved yet. Saving puts each step on your FinanceOS timeline.";
    var line = "Saved plan: " + money(s.monthly_cents) + " a month, " + methodWords(data, s.method).label.toLowerCase() +
      ", saved " + day(String(s.saved_at || "").slice(0, 10)) + ".";
    return sameAsSaved(s, settings) ? line : line + " You changed it — save to keep the new one.";
  }

  function renderControls(data, plan, settings) {
    var min = Math.ceil((plan.minimums_cents || 0) / 100) * 100;
    var max = sliderMax(plan, settings);
    var value = isNum(settings.monthly_cents) ? settings.monthly_cents : min;
    var seg = METHOD_ORDER.map(function (k) {
      var on = settings.method === k;
      return '<button type="button" class="seg-btn" data-method="' + k + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        esc(methodWords(data, k).label) + '</button>';
    }).join("");
    var g = settings.goal || {};
    var goalOpts = '<option value="">No goal</option>' + ["debt_free", "util30", "util10"].map(function (k) {
      return '<option value="' + k + '"' + (g.kind === k ? " selected" : "") + '>' + esc(GOAL_LABEL[k]) + '</option>';
    }).join("");
    return '<section class="card controls" aria-labelledby="s-plan"><h2 class="eyebrow" id="s-plan">Your plan</h2>' +
      '<div class="ctrl-grid">' +
      '<div class="field f-amt"><label for="s-amount">Money toward debt each month</label>' +
      '<div class="amt-row"><input id="s-range" type="range" aria-label="Money toward debt each month" min="' + esc(min) + '" max="' + esc(max) +
      '" step="2500" value="' + esc(Math.min(Math.max(value, min), max)) + '">' +
      '<span class="amt-box"><span class="amt-sign">$</span><input id="s-amount" type="text" inputmode="decimal" autocomplete="off" value="' + esc(amountText(value)) + '"></span></div>' +
      '<p class="caption" data-slot="amount-note">' + esc(renderAmountNote(plan)) + '</p></div>' +
      '<div class="field f-method"><span class="label-like caption" id="s-method-l">How extra money is used</span>' +
      '<div class="seg" role="group" aria-labelledby="s-method-l">' + seg + '</div>' +
      '<p class="caption" data-slot="method-note">' + esc(methodWords(data, settings.method).detail) + '</p></div>' +
      '<div class="field f-goal"><label for="s-goal">Goal</label>' +
      '<div class="goal-row"><select id="s-goal">' + goalOpts + '</select>' +
      '<input id="s-goal-by" type="date" aria-label="Goal date"' + (g.kind ? "" : " hidden") + ' value="' + esc(g.by || "") + '"></div>' +
      '<div data-slot="goal-note">' + renderGoalNote(data, plan, settings) + '</div></div>' +
      '</div>' +
      '<div class="save-row"><p class="caption" data-slot="save-note">' + esc(renderSaveNote(data, settings)) + '</p>' +
      '<button class="btn-primary" type="button" data-act="save">Save this plan</button></div>' +
      '<div class="save-msg" data-slot="save-msg" aria-live="polite"></div></section>';
  }

  /* ── the results ───────────────────────────────────────────────────────── */

  function tileDebtFree(plan) {
    var body;
    if (plan.debt_free) {
      var cap = plan.debt_free.earliest
        ? "At the earliest. A rate (APR) is missing, so it could take longer."
        : plan.baseline && plan.baseline.debt_free_on
          ? "Paying only minimums: " + day(plan.baseline.debt_free_on) + "."
          : plan.baseline && list(plan.baseline.never_ids).length
            ? "Paying only minimums, " + names(plan.baseline.never_ids.map(function (id) { return nameOf(plan, id); })) + " is never paid off."
            : "In " + plural(plan.debt_free.month, "month", "months") + ".";
      body = '<span class="big">' + esc(day(plan.debt_free.on)) + '</span><p class="caption">' + esc(cap) + '</p>';
    } else {
      body = '<span class="big">Not in 50 years</span><p class="caption">At this amount the interest grows faster than the payments. Raise the amount.</p>';
    }
    return '<section class="card tile" aria-labelledby="t-free"><h2 class="eyebrow" id="t-free">Debt-free by</h2>' + body + '</section>';
  }

  function tileInterest(plan) {
    var body;
    if (isNum(plan.interest_saved_cents)) {
      var bits = ["Interest on this plan: " + money(plan.interest_cents) + "."];
      if (isNum(plan.months_saved) && plan.months_saved > 0) bits.push("Done " + plural(plan.months_saved, "month", "months") + " sooner than paying only minimums.");
      body = '<span class="big">' + esc(money(plan.interest_saved_cents)) + '</span><p class="caption">' + esc(bits.join(" ")) + '</p>';
    } else {
      var r = plan.interest_saved_reason || {};
      var who = names(list(r.ids).map(function (id) { return nameOf(plan, id); }));
      var why = {
        apr_unknown: "No rate (APR) on file for " + who + ". Add it to see the interest saved.",
        minimum_unknown: "No minimum payment on file for " + who + ". Add it to compare with paying only minimums.",
        minimum_zero: "The minimum on " + who + " is $0 today, so there is nothing to compare.",
        never_pays_off_at_minimums: "Paying only minimums, " + who + " is never paid off.",
        plan_never_pays_off: "This plan does not pay everything off."
      };
      body = '<span class="big">—</span><p class="caption">' + esc(why[r.code] || "Not enough on file to compare.") + '</p>';
    }
    return '<section class="card tile" aria-labelledby="t-int"><h2 class="eyebrow" id="t-int">Interest saved vs. minimums</h2>' + body + '</section>';
  }

  function tileCardUse(plan) {
    var body;
    if (!isNum(plan.util_start_pct)) {
      body = '<span class="big">—</span><p class="caption">No card has a credit limit on file, so card use cannot be measured.</p>';
    } else {
      var lines = list(plan.crossings).map(function (c) {
        if (c.already) return "Under " + c.pct + "% now (" + TARGET_WORD[c.pct] + ").";
        if (!c.on) return "Not under " + c.pct + "% in this plan.";
        return "Under " + c.pct + "% by " + day(c.on) + (c.earliest ? " at the earliest" : "") + ".";
      });
      body = '<span class="big">' + esc(pct(plan.util_start_pct)) + '</span><p class="caption">' + esc("Now. " + lines.join(" ")) + '</p>';
    }
    return '<section class="card tile" aria-labelledby="t-use"><h2 class="eyebrow" id="t-use">Card use</h2>' + body + '</section>';
  }

  function tileCash(plan) {
    var c = plan.cash;
    var word;
    var cap;
    var act = "";
    if (!c || !c.by_kind.length) {
      word = "Not checked";
      cap = "No cash on file to check against.";
    } else if (c.status === "over") {
      word = "Too much";
      var over = c.by_kind.filter(function (r) { return r.status === "over"; })[0];
      cap = "This plan sends " + money(over.planned_cents) + " to " + KIND_WORD[over.kind] + " debts this month. " +
        KIND_LABEL[over.kind] + " cash can cover " + money(over.safe_cents) + ".";
      if (c.max_safe && isNum(c.max_safe.monthly_cents) && !c.max_safe.unlimited) {
        act = '<button class="btn-line" type="button" data-act="use-amount" data-cents="' + esc(c.max_safe.monthly_cents) + '">Use ' + esc(money(c.max_safe.monthly_cents)) + '</button>';
      } else if (c.max_safe && c.max_safe.reason && c.max_safe.reason.code === "minimums_not_safe") {
        cap += " Even the minimum payments are more than that.";
      }
    } else {
      word = c.status === "safe" ? "Safe" : c.status === "partial" ? "Partly checked" : "Not checked";
      cap = c.by_kind.map(function (r) {
        if (r.status === "unknown") return KIND_LABEL[r.kind] + ": not checked — " + (r.reason && r.reason.message ? r.reason.message : "no cash on file") ;
        return KIND_LABEL[r.kind] + ": " + money(r.planned_cents) + " of the " + money(r.safe_cents) + " its cash can cover.";
      }).join(" ");
    }
    return '<section class="card tile" aria-labelledby="t-cash"><h2 class="eyebrow" id="t-cash">Cash this month</h2>' +
      '<span class="big status-' + esc(c ? c.status : "unknown") + '">' + esc(word) + '</span><p class="caption">' + esc(cap) + '</p>' + act + '</section>';
  }

  /* The card-use chart: all cards (thick line) and up to four cards (dashed
     patterns, named in the legend) against UnderwriteIQ's 30% and 10% lines.
     `width` is the box's real width so the 11px labels stay 11px. */
  function chartSvg(plan, width) {
    var cards = list(plan.debts).filter(function (d) { return d.limit_state === "known"; });
    if (!cards.length || !isNum(plan.util_start_pct)) return "";
    var months = list(plan.months);
    var end = months.length;
    for (var i = 0; i < months.length; i++) if (months[i].util_pct === 0) { end = i + 1; break; }
    end = Math.min(Math.max(end, Math.min(6, months.length)), 120);
    var starts = {};
    list(plan.per_debt).forEach(function (p) { starts[p.id] = p.start_util_pct; });
    var pts = [{ n: 0, on: plan.as_of, util: plan.util_start_pct, cards: starts }].concat(months.slice(0, end).map(function (m) {
      return { n: m.n, on: m.end_on, util: m.util_pct, cards: m.card_util || {} };
    }));
    var top = cards.filter(function (d) { return isNum(starts[d.id]); })
      .sort(function (a, b) { return starts[b.id] - starts[a.id]; }).slice(0, DASHES.length);
    var peak = 0;
    pts.forEach(function (p) {
      if (isNum(p.util)) peak = Math.max(peak, p.util);
      top.forEach(function (d) { if (isNum(p.cards[d.id])) peak = Math.max(peak, p.cards[d.id]); });
    });
    var maxU = Math.min(100, Math.max(35, Math.ceil(peak / 10) * 10));
    var W = Math.max(280, Math.round(width || 640));
    /* Taller on a wide box so a full-width chart is not a thin strip. */
    var H = Math.round(Math.min(300, Math.max(220, W * 0.22))), L = 8, R = 8, T = 12, B = 28;
    var lastN = pts[pts.length - 1].n || 1;
    function x(n) { return L + (n / lastN) * (W - L - R); }
    function y(u) { return T + (1 - u / maxU) * (H - T - B); }
    function line(getter) {
      return pts.filter(function (p) { return isNum(getter(p)); })
        .map(function (p) { return x(p.n).toFixed(1) + "," + y(getter(p)).toFixed(1); }).join(" ");
    }
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
      esc("Card use by month: " + pct(plan.util_start_pct) + " now" + list(plan.crossings).filter(function (c) { return c.on && !c.already; })
        .map(function (c) { return ", under " + c.pct + "% by " + day(c.on); }).join("")) + '">';
    svg += '<line class="axis" x1="' + L + '" y1="' + y(0) + '" x2="' + (W - R) + '" y2="' + y(0) + '"></line>';
    [30, 10].forEach(function (t) {
      if (t > maxU) return;
      svg += '<line class="target" x1="' + L + '" y1="' + y(t).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(t).toFixed(1) + '"></line>' +
        '<text class="target-label" x="' + (L + 4) + '" y="' + (y(t) - 4).toFixed(1) + '">' + esc(t + "% · " + (t === 30 ? "fundable line" : "target")) + '</text>';
    });
    top.forEach(function (d, k) {
      svg += '<polyline class="card-line" stroke-dasharray="' + DASHES[k] + '" points="' + line(function (p) { return p.cards[d.id]; }) + '">' +
        '<title>' + esc(d.name) + '</title></polyline>';
    });
    svg += '<polyline class="all-line" points="' + line(function (p) { return p.util; }) + '"><title>All cards</title></polyline>';
    /* The marker sits ON the line, at the first month card use is under the
       target — not at the target's height, which floats when card use drops
       past it within one month. */
    list(plan.crossings).forEach(function (c) {
      if (!c.month || c.already || c.month > lastN) return;
      var hit = pts.filter(function (p) { return p.n === c.month && isNum(p.util); })[0];
      if (!hit) return;
      svg += '<circle class="cross" cx="' + x(hit.n).toFixed(1) + '" cy="' + y(hit.util).toFixed(1) + '" r="4"><title>' +
        esc("Under " + c.pct + "% by " + day(c.on)) + '</title></circle>';
    });
    var ticks = Math.max(2, Math.min(6, Math.floor(W / 90)));
    var used = {};
    for (var t2 = 0; t2 < ticks; t2++) {
      var idx = Math.round((t2 / (ticks - 1)) * (pts.length - 1));
      if (used[idx]) continue;
      used[idx] = true;
      var p = pts[idx];
      var anchor = t2 === 0 ? "start" : t2 === ticks - 1 ? "end" : "middle";
      svg += '<text class="tick" x="' + x(p.n).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(idx === 0 ? "Now" : tick(p.on)) + '</text>';
    }
    svg += '</svg>';
    var legend = '<ul class="legend caption"><li><svg class="key" viewBox="0 0 24 8" aria-hidden="true"><line class="all-line" x1="0" y1="4" x2="24" y2="4"></line></svg>All cards</li>' +
      top.map(function (d, k) {
        return '<li><svg class="key" viewBox="0 0 24 8" aria-hidden="true"><line class="card-line" stroke-dasharray="' + DASHES[k] + '" x1="0" y1="4" x2="24" y2="4"></line></svg>' + esc(d.name) + '</li>';
      }).join("") +
      '<li><svg class="key" viewBox="0 0 24 8" aria-hidden="true"><line class="target" x1="0" y1="4" x2="24" y2="4"></line></svg>UnderwriteIQ targets</li></ul>';
    var more = cards.length > top.length ? '<p class="caption">Showing the ' + top.length + ' cards with the highest card use.</p>' : "";
    return svg + legend + more;
  }

  function renderChartCard(plan, width) {
    var svg = chartSvg(plan, width);
    var body = svg || '<p class="caption">No card has a credit limit on file, so there is no card use to draw.</p>';
    return '<section class="card chart-card" aria-labelledby="s-chart"><h2 class="eyebrow" id="s-chart">Card use, month by month</h2>' +
      '<div data-slot="chart">' + body + '</div>' +
      '<p class="caption">30% is the line UnderwriteIQ needs to count a file fundable. 10% is its target for every card.</p></section>';
  }

  function renderDebtsCard(data, plan) {
    var per = {};
    list(plan.per_debt).forEach(function (p) { per[p.id] = p; });
    var pos = {};
    list(plan.order).forEach(function (b, i) { if (!(b.id in pos)) pos[b.id] = i; });
    var rows = list(plan.debts).filter(function (d) { return d.balance_cents > 0; })
      .sort(function (a, b) { return (pos[a.id] === undefined ? 999 : pos[a.id]) - (pos[b.id] === undefined ? 999 : pos[b.id]); })
      .map(function (d, i) {
        var p = per[d.id] || {};
        var paid = isNum(p.payoff_month) ? day(p.payoff_on) + (p.earliest ? " · at the earliest" : "") : "Not in 50 years";
        return '<tr><td class="r num">' + (i + 1) + '</td><td><span class="debt-name">' + esc(d.name) + '</span> <span class="tag">' + esc(KIND_LABEL[d.kind] || "") + '</span></td>' +
          '<td class="r num">' + esc(money(d.balance_cents)) + '</td>' +
          '<td class="r">' + (isNum(d.apr_pct) ? '<span class="num">' + esc(apr(d.apr_pct)) + '</span>' : '<span class="caption">Not on file</span>') + '</td>' +
          '<td class="r">' + (isNum(d.min_cents) ? '<span class="num">' + esc(money(d.min_cents)) + '</span>' : '<span class="caption">Not on file</span>') + '</td>' +
          '<td>' + esc(paid) + '</td>' +
          '<td class="r num">' + esc(isNum(p.interest_cents) ? money(p.interest_cents) : "—") + '</td></tr>';
      }).join("");
    return '<section class="card debts-card" aria-labelledby="s-debts"><h2 class="eyebrow" id="s-debts">Each card and loan, in the order this plan pays them</h2>' +
      '<div class="scroll-x"><table><thead><tr><th class="r">#</th><th>Debt</th><th class="r">Owe now</th><th class="r">Rate (APR)</th><th class="r">Minimum</th><th>Paid off by</th><th class="r">Interest</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' + renderWarnings(plan) + '</section>';
  }

  function renderWarnings(plan) {
    var items = list(plan.warnings).map(function (w) {
      var who = names(w.names);
      if (w.code === "apr_unknown") return "No rate (APR) on file for " + who + ". The math charges no interest there, so those dates are the earliest they could be. Add the rate in Accounts.";
      if (w.code === "minimum_unknown") return "No minimum payment on file for " + who + ". The plan sets nothing aside for it. Add it in Accounts.";
      if (w.code === "limit_unknown") return "No credit limit on file for " + who + ". It is left out of card use and gets no card-use target.";
      return "";
    }).filter(Boolean);
    list(plan.excluded).forEach(function (e) { items.push("Left out: " + e.name + " — its balance is not on file."); });
    if (!items.length) return "";
    return '<ul class="warnings">' + items.map(function (t) { return '<li><span class="warn-word">Missing</span> ' + esc(t) + '</li>'; }).join("") + '</ul>';
  }

  function renderMonths(plan, shown) {
    var months = list(plan.months);
    var n = Math.min(shown || PAGE, months.length);
    var aprMissing = list(plan.apr_unknown_ids).length > 0;
    var rows = months.slice(0, n).map(function (m) {
      return '<tr><td>' + esc(day(m.end_on)) + '</td><td class="r num">' + esc(money(m.paid_cents)) + '</td>' +
        '<td class="r num">' + esc(money(m.interest_cents)) + '</td><td class="r num">' + esc(money(m.owed_cents)) + '</td>' +
        '<td class="r num">' + esc(pct(m.util_pct)) + '</td><td>' + esc(m.focus_id ? nameOf(plan, m.focus_id) : "—") + '</td></tr>';
    }).join("");
    var more = n < months.length
      ? '<button class="btn-line" type="button" data-act="more-months">Show ' + Math.min(PAGE, months.length - n) + ' more months</button>'
      : "";
    return '<details class="card months-card" data-slot="months-wrap"><summary><span class="eyebrow">Month by month</span> ' +
      '<span class="caption">' + esc(plural(months.length, "month", "months")) + ' — what you pay, the interest, and what is left</span></summary>' +
      '<div class="scroll-x"><table><thead><tr><th>By</th><th class="r">You pay</th><th class="r">' + (aprMissing ? "Interest (known rates)" : "Interest") +
      '</th><th class="r">Left to pay</th><th class="r">Card use</th><th>Extra goes to</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + more + '</details>';
  }

  function renderCashDetail(data, plan) {
    var cash = data && data.inputs && data.inputs.cash;
    if (!cash || !cash.by_kind) return "";
    var planned = {};
    list(plan.cash && plan.cash.by_kind).forEach(function (r) { planned[r.kind] = r.planned_cents; });
    var rows = Object.keys(cash.by_kind).map(function (k) {
      var c = cash.by_kind[k];
      if (!c.ok) return '<li><strong>' + esc(KIND_LABEL[k]) + ' cash:</strong> not checked. ' + esc(c.message || "") + '</li>';
      var bills = list(c.bills).map(function (b) { return b.name + " " + money(b.amount_cents) + " on " + day(b.on); });
      return '<li><strong>' + esc(KIND_LABEL[k]) + ' cash:</strong> ' +
        esc(money(c.opening_cents) + " in " + names(list(c.accounts).map(function (a) { return a.name; })) + ". ") +
        esc(bills.length ? "Bills by " + day(cash.window && cash.window.to) + ": " + money(c.bills_cents) + " (" + bills.join("; ") + "). " : "No bills found before " + day(cash.window && cash.window.to) + ". ") +
        esc("It can send up to " + money(c.safe_cents) + " to " + KIND_WORD[k] + " debts this month") +
        (isNum(planned[k]) ? esc("; this plan sends " + money(planned[k]) + ".") : ".") +
        (c.short_cents > 0 ? ' <span class="warn-word">Short</span> ' + esc("Bills alone take it " + money(c.short_cents) + " below zero.") : "") +
        (c.floor_cents > 0 ? esc(" It keeps at least " + money(c.floor_cents) + " in the account.") : "") + '</li>';
    }).join("");
    return '<details class="card"><summary><span class="eyebrow">How the cash check works</span></summary>' +
      '<ul class="facts-list">' + rows + '</ul>' +
      '<p class="caption">Only this month is checked. Money coming in is not counted yet, so later months are not checked. Personal cash and business cash are never added together.</p></details>';
  }

  function renderHow(data, staff) {
    var items = [
      "Interest each month is the balance times the rate (APR), divided by 12.",
      "Each minimum payment stays at today's amount.",
      "No new charges on the cards.",
      "Each month of the plan ends on the same day of the month as today.",
      "Card-use targets come from UnderwriteIQ, Fundhub's credit engine: 30% is the line it needs to count a file fundable, and 10% is its target for every card."
    ];
    var src = "";
    if (staff && data && data.sources) {
      var s = data.sources;
      src = '<p class="caption">Staff only · sources: ' + esc([s.debts, s.cash].concat(list(s.targets)).concat(Object.keys(s.methods || {}).map(function (k) { return k + ": " + s.methods[k]; })).join(" · ")) + '</p>';
    }
    return '<details class="card"><summary><span class="eyebrow">How this is worked out</span></summary><ul class="facts-list">' +
      items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>' + src + '</details>';
  }

  function renderNotOk(data, plan) {
    var r = plan.reason || {};
    var words = r.code === "below_minimums"
      ? "That is less than the minimum payments (" + money(r.minimums_cents) + " a month). Pick at least that much."
      : r.code === "no_amount" ? "Pick how much you can put toward debt each month." : "The plan could not be worked out.";
    return '<section class="card notice" role="status"><h2 class="eyebrow">Plan</h2><p>' + esc(words) + '</p>' +
      (r.code === "below_minimums"
        ? '<button class="btn-line" type="button" data-act="use-amount" data-cents="' + esc(Math.ceil(r.minimums_cents / 100) * 100) + '">Use ' + esc(money(Math.ceil(r.minimums_cents / 100) * 100)) + '</button>'
        : "") + '</section>';
  }

  function renderResults(data, plan, opts) {
    opts = opts || {};
    if (!plan.ok) return renderNotOk(data, plan);
    /* The debts table needs seven columns, so it and the chart each take the
       full width (a half-width card cut the last two columns off at 1440). */
    return '<div class="grid tiles">' + tileDebtFree(plan) + tileInterest(plan) + tileCardUse(plan) + tileCash(plan) + '</div>' +
      renderDebtsCard(data, plan) + renderChartCard(plan, opts.chartWidth) +
      renderMonths(plan, opts.shown) + renderCashDetail(data, plan) + renderHow(data, !!opts.staff) +
      (data && data.tip ? '<p class="tip"><span class="eyebrow">UnderwriteIQ</span>' + esc(data.tip) + '</p>' : "");
  }

  function hasDebts(data) {
    return list(data && data.inputs && data.inputs.debts).some(function (d) { return isNum(d.balance_cents) && d.balance_cents > 0; });
  }

  /** The whole section for one state: data (the GET), plan (math.buildPlan), settings. */
  function render(data, plan, settings, opts) {
    if (!hasDebts(data)) return renderEmpty(data);
    return renderHead(data) + renderControls(data, plan, settings) +
      '<div data-slot="results" aria-live="polite">' + renderResults(data, plan, opts) + '</div>';
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

  /* The math module: one passed in (tests), one a page put on window, or the
     shared file itself. */
  function loadMath(ctx) {
    if (ctx && ctx.math && typeof ctx.math.buildPlan === "function") return Promise.resolve(ctx.math);
    if (root.FHStrategyMath && typeof root.FHStrategyMath.buildPlan === "function") return Promise.resolve(root.FHStrategyMath);
    try {
      return Promise.resolve(import(MATH_PATH)).then(function (m) {
        root.FHStrategyMath = m;
        return m;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /* ── the section: window.FinanceOS.sections.strategy ─────────────────────
     mount(el, ctx) paints this section into `el` and wires its controls. No
     page chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only; a client session leaves it empty (the server pins
                 a client to their own file)
       apiGet(path) / apiPost(path, body) → Promise of { status, body }
     Missing api functions fall back to this file's own fetch. Section styles:
     money-strategy.css, every rule under .fh-strategy. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var staff = !!clientId;
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { data: null, math: null, settings: null, plan: null, shown: PAGE, chartWidth: 0 };
    var frame = null;

    function wrap(html) { el.innerHTML = '<div class="fh-strategy">' + html + '</div>'; }
    function slot(name) { return el.querySelector ? el.querySelector('[data-slot="' + name + '"]') : null; }

    function measure() {
      var box = slot("chart");
      return box && box.clientWidth ? box.clientWidth : 0;
    }

    function paintResults() {
      var r = slot("results");
      if (!r) return;
      var openMonths = slot("months-wrap");
      var wasOpen = !!(openMonths && openMonths.open);
      r.innerHTML = renderResults(state.data, state.plan, { shown: state.shown, staff: staff, chartWidth: state.chartWidth });
      var m = slot("months-wrap");
      if (m && wasOpen) m.open = true;
      var notes = {
        "amount-note": renderAmountNote(state.plan),
        "method-note": methodWords(state.data, state.settings.method).detail,
        "save-note": renderSaveNote(state.data, state.settings)
      };
      Object.keys(notes).forEach(function (k) { var s = slot(k); if (s) s.textContent = notes[k]; });
      var g = slot("goal-note");
      if (g) g.innerHTML = renderGoalNote(state.data, state.plan, state.settings);
      var w = measure();
      if (w && Math.abs(w - state.chartWidth) > 16) {
        state.chartWidth = w;
        var c = slot("chart");
        if (c && state.plan.ok) c.innerHTML = chartSvg(state.plan, w) || c.innerHTML;
      }
    }

    function recompute() {
      frame = null;
      state.plan = state.math.buildPlan(state.data.inputs, state.settings);
      paintResults();
    }
    function schedule() {
      if (frame) return;
      if (root.requestAnimationFrame) frame = root.requestAnimationFrame(recompute);
      else { frame = true; recompute(); }
    }

    function paintAll() {
      state.plan = state.math.buildPlan(state.data.inputs, state.settings);
      wrap(render(state.data, state.plan, state.settings, { shown: state.shown, staff: staff, chartWidth: state.chartWidth }));
      var w = measure();
      if (w) { state.chartWidth = w; var c = slot("chart"); if (c && state.plan.ok) c.innerHTML = chartSvg(state.plan, w) || c.innerHTML; }
    }

    function load() {
      wrap(renderLoading());
      var mathP = loadMath(ctx).then(function (m) { return m; }, function () { return null; });
      return Promise.all([get(READ_PATH + (clientId ? "?client_id=" + encodeURIComponent(clientId) : "")), mathP]).then(function (out) {
        var res = out[0];
        var kind = classify(res);
        if (kind === "signin") {
          if (ctx.onSignIn) ctx.onSignIn();
          else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind !== "ok") { wrap(renderError(kind)); return; }
        if (!out[1]) { wrap(renderError("math")); return; }
        state.data = res.body;
        state.math = out[1];
        var d = res.body.defaults || {};
        state.settings = { method: d.method || "avalanche", monthly_cents: d.monthly_cents, goal: d.goal ? { kind: d.goal.kind, by: d.goal.by } : null };
        if (ctx.onData) ctx.onData(res.body);
        paintAll();
      });
    }

    function setAmount(cents, from) {
      if (!isNum(cents) || cents <= 0) return;
      state.settings.monthly_cents = cents;
      var range = el.querySelector("#s-range");
      var box = el.querySelector("#s-amount");
      if (range && from !== "range") {
        if (cents > Number(range.max)) range.max = String(Math.ceil(cents / 100) * 100);
        range.value = String(cents);
      }
      if (box && from !== "box") box.value = amountText(cents);
      schedule();
    }

    function onInput(e) {
      var t = e.target;
      if (!t || !state.math) return;
      if (t.id === "s-range") setAmount(Number(t.value), "range");
      if (t.id === "s-amount") {
        var c = toCents(t.value);
        if (c && c > 0) setAmount(c, "box");
      }
      if (t.id === "s-goal-by") {
        if (state.settings.goal) state.settings.goal.by = t.value || null;
        schedule();
      }
    }

    function onChange(e) {
      var t = e.target;
      if (!t || !state.math) return;
      if (t.id === "s-goal") {
        var date = el.querySelector("#s-goal-by");
        if (!t.value) {
          state.settings.goal = null;
          if (date) date.hidden = true;
        } else {
          state.settings.goal = { kind: t.value, by: date && date.value ? date.value : null };
          if (date) date.hidden = false;
        }
        schedule();
      }
      if (t.id === "s-amount") {
        var c = toCents(t.value);
        if (!c) { t.value = amountText(state.settings.monthly_cents); }
      }
    }

    function save(btn) {
      var msg = slot("save-msg");
      function say(html) { if (msg) msg.innerHTML = html; }
      var plan = state.plan;
      if (plan && plan.ok && plan.cash && plan.cash.status === "over") {
        var max = plan.cash.max_safe && plan.cash.max_safe.monthly_cents;
        say('<p class="caption">This month\'s cash cannot cover that amount, so it cannot be saved as a plan.' +
          (isNum(max) && !plan.cash.max_safe.unlimited ? " The most for now is " + esc(money(max)) + " a month." : "") + '</p>');
        return;
      }
      var body = { action: "save_plan", method: state.settings.method, monthly_cents: state.settings.monthly_cents };
      var g = state.settings.goal;
      if (g && g.kind && g.by) body.goal = { kind: g.kind, by: g.by };
      if (clientId) body.client_id = clientId;
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";
      say("");
      send(READ_PATH, body).then(function (res) {
        btn.disabled = false;
        btn.textContent = label;
        var kind = classify(res);
        if (kind === "ok") {
          state.data.saved = res.body.saved;
          var steps = res.body.saved && isNum(res.body.saved.steps) ? res.body.saved.steps : null;
          say('<p class="ok-word">Saved.</p><p class="caption">' + esc(steps ? "Its " + plural(steps, "step", "steps") + " are on your FinanceOS timeline." : "It is on your FinanceOS timeline.") + '</p>');
          var note = slot("save-note");
          if (note) note.textContent = renderSaveNote(state.data, state.settings);
          return;
        }
        if (kind === "signin" && root.location) { root.location.href = signInUrl(); return; }
        var b = res.body || {};
        var use = isNum(b.max_safe_monthly_cents)
          ? ' <button class="btn-line" type="button" data-act="use-amount" data-cents="' + esc(b.max_safe_monthly_cents) + '">Use ' + esc(money(b.max_safe_monthly_cents)) + '</button>'
          : "";
        say('<p class="caption" role="alert">' + esc(b.message || ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' + use);
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act],[data-method]") : null;
      if (!t || !el.contains(t)) return;
      if (t.getAttribute("data-method") && state.math) {
        state.settings.method = t.getAttribute("data-method");
        Array.prototype.forEach.call(el.querySelectorAll("[data-method]"), function (b) {
          b.setAttribute("aria-pressed", b === t ? "true" : "false");
        });
        schedule();
        return;
      }
      var act = t.getAttribute("data-act");
      if (act === "retry") load();
      if (act === "use-amount") setAmount(Number(t.getAttribute("data-cents")));
      if (act === "save") save(t);
      if (act === "more-months") { state.shown += PAGE; paintResults(); }
    }

    var resizeTimer = null;
    function onResize() {
      if (resizeTimer) root.clearTimeout(resizeTimer);
      resizeTimer = root.setTimeout(function () {
        if (!state.plan || !state.plan.ok) return;
        var w = measure();
        if (w && Math.abs(w - state.chartWidth) > 16) {
          state.chartWidth = w;
          var c = slot("chart");
          if (c) c.innerHTML = chartSvg(state.plan, w) || c.innerHTML;
        }
      }, 150);
    }

    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("click", onClick);
    if (root.addEventListener) root.addEventListener("resize", onResize);
    var first = load();
    return {
      ready: first,
      reload: load,
      unmount: function () {
        el.removeEventListener("input", onInput);
        el.removeEventListener("change", onChange);
        el.removeEventListener("click", onClick);
        if (root.removeEventListener) root.removeEventListener("resize", onResize);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var doc = root.document;
    var el = doc.getElementById("strategy-root");
    if (!el) return;
    var cid = param("client_id");
    var back = doc.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    var nav = doc.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        var parts = a.getAttribute("href").split("#");
        var href = parts[0] + "?client_id=" + encodeURIComponent(cid);
        a.setAttribute("href", parts.length > 1 ? href + "#" + parts.slice(1).join("#") : href);
      });
    }
    mount(el, {
      clientId: cid,
      onData: function (d) {
        var banner = doc.getElementById("money-sandbox");
        if (banner && d && d.sandbox === true) banner.hidden = false;
      }
    });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.strategy = { title: "Strategy", mount: mount, render: render };

  root.FHMoneyStrategy = {
    money: money, day: day, pct: pct, apr: apr, toCents: toCents, classify: classify, sliderMax: sliderMax,
    render: render, renderControls: renderControls, renderResults: renderResults, renderLoading: renderLoading,
    renderError: renderError, renderEmpty: renderEmpty, renderGoalNote: renderGoalNote, renderSaveNote: renderSaveNote,
    chartSvg: chartSvg, mount: mount
  };

  /* Auto-start only finds #strategy-root on the standalone page. A combined
     FinanceOS page calls FinanceOS.sections.strategy.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
