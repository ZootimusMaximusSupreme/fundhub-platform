/* FinanceOS Trends — line graphs over time (wave 4, unit H6, 2026-10-06).
 *
 * Owner: "the whole Finance OS with line graphs … Finance OS tracking."
 *
 * Reads ONE endpoint, GET /api/money/trends?range=30d|90d|12m, and draws plain
 * inline SVG lines. No chart library. Nothing here invents a number: every
 * point is a field from that read.
 *
 * THE HONESTY RULES (docs/finance/client-finance-os-build-spec-2026-09-19.md §4):
 *   - A null is a GAP. The line breaks there. It is never drawn as 0.
 *   - Cash is NEVER added across personal / business. They are two lines, and
 *     no line on this page is their sum.
 *   - An estimated point (rebuilt from bank activity) is drawn dashed, and the
 *     page says what dashed means in words.
 *   - Every chart has a title, a description, a legend in words and a table of
 *     the same numbers behind "Show the numbers".
 *
 * WHO USES IT:
 *   window.FinanceOS.trends.mount(el, ctx)      the Trends area on Overview
 *                                               (money.js calls it)
 *   window.FinanceOS.extras.connections         the sales line under the
 *                                               Connections tab (financeos.js
 *                                               mounts it next to that section)
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-trends-screen.test.mjs runs them in Node against a fixture.
 *
 * WHY HTML LABELS AND A STRETCHED SVG. The plot is an SVG with
 * preserveAspectRatio="none" and non-scaling strokes, so it fills any width
 * from 375px up without the text inside shrinking. Axis labels are HTML
 * captions beside it, so they stay a readable size on a phone.
 *
 * ONE ACCOUNT AND ANY DATES (Finance OS CFO build, unit A, 2026-11-07):
 *   - An Account picker lists the file's open accounts from the read's own
 *     `accounts` list. "All accounts" keeps the charts above. One account shows
 *     that account's balance line; a card also shows its limit and a second
 *     chart of how much of the limit is used (null days are breaks).
 *   - From and To date fields sit beside the 30 / 90 / 12 buttons. The dates
 *     are checked here with the server's own rules (real days, From not after
 *     To, 24 months at most) before anything is asked for.
 *   - The 30 / 90 / 12 choice is kept in fos_trends_range as before; chosen
 *     dates in fos_trends_dates until a button is pressed again. The account
 *     is not kept: a stale id from another file must never be asked for.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/trends";
  var BANKS_PATH = "/api/money/banks";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var RANGES = [["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];
  var W = 600, H = 160, PAD = 10;
  var MAX_SPAN_MONTHS = 24;
  var KIND_ORDER = ["personal", "business", "unknown"];
  var KIND_WORDS = { personal: "Personal", business: "Business", unknown: "Not sure yet" };
  var TYPE_WORDS = { checking: "Checking", savings: "Savings", card: "Card", loan: "Loan" };
  /* Personal is always blue and round, business always orange and square. */
  var KIND_SERIES = { personal: ["s1", "round"], business: ["s2", "square"], unknown: ["s0", "round"] };
  var uid = 0;

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  /* cents → "$1,234.56"; null → "—". */
  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }
  /* Axis money: whole dollars, short. */
  function moneyShort(cents) {
    if (!isNum(cents)) return "—";
    var d = cents / 100, a = Math.abs(d), s;
    if (a >= 1e6) s = (Math.round(a / 1e5) / 10) + "M";
    else if (a >= 1e4) s = Math.round(a / 1e3) + "k";
    else if (a >= 1e3) s = (Math.round(a / 100) / 10) + "k";
    else s = String(Math.round(a));
    return (d < 0 ? "−$" : "$") + s;
  }
  function pct(v) {
    if (!isNum(v)) return "—";
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
  }
  function dayLabel(iso, withYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (withYear ? ", " + m[1] : "");
  }
  function monthLabel(ym, withYear) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + (withYear ? " " + m[1] : "");
  }

  /* The three axis words under a daily chart. A long window that crosses a
     year says month and year ("Nov 2025"), so 24 months never reads as one
     year; a short one says the day ("Oct 7"), as before. */
  function dayAxis(days) {
    var n = days.length;
    if (!n) return [];
    var pick = [days[0], days[Math.floor((n - 1) / 2)], days[n - 1]];
    var long = n > 120 && days[0].slice(0, 4) !== days[n - 1].slice(0, 4);
    return pick.map(function (x) { return long ? monthLabel(x, true) : dayLabel(x); });
  }
  function monthAxis(months) {
    var n = months.length;
    if (!n) return [];
    var pick = [months[0], months[Math.floor((n - 1) / 2)], months[n - 1]];
    var long = n > 4 && months[0].slice(0, 4) !== months[n - 1].slice(0, 4);
    return pick.map(function (x) { return monthLabel(x, long); });
  }

  /* ── dates: the server's own rules, so a bad pick is caught before asking ── */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  /* A real calendar day written YYYY-MM-DD, or "". 2026-02-30 is not a day. */
  function realDay(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    var t = Date.parse(s + "T00:00:00Z");
    if (!isFinite(t)) return "";
    return new Date(t).toISOString().slice(0, 10) === s ? s : "";
  }
  /* Same day n months away, pulled back to a shorter month's last day. */
  function addMonths(day, n) {
    var p = day.split("-").map(Number);
    var idx = p[0] * 12 + (p[1] - 1) + n;
    var y = Math.floor(idx / 12), m = (idx % 12) + 1;
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + "-" + pad2(m) + "-" + pad2(Math.min(p[2], last));
  }
  /* "" when the pair is fine, else what to fix, in words. */
  function checkDates(from, to) {
    if (!from || !to) return "Pick both a From date and a To date.";
    var f = realDay(from), t = realDay(to);
    if (!f || !t) return "Those are not real dates. Pick them again.";
    if (f > t) return "From has to be on or before To.";
    if (f < addMonths(t, -MAX_SPAN_MONTHS)) return "Pick 24 months or less between From and To.";
    return "";
  }
  function localToday() {
    var n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
  }

  /* ── the line chart ────────────────────────────────────────────────────── */

  /* The runs of a series: consecutive non-null points. A null ends a run, so a
     gap is never bridged and never drawn at 0. Each pair of neighbours is one
     segment, dashed when either end is estimated. */
  function segments(values, estimated) {
    var out = [];
    for (var i = 1; i < values.length; i++) {
      if (!isNum(values[i - 1]) || !isNum(values[i])) continue;
      var est = !!(estimated && (estimated[i - 1] === true || estimated[i] === true));
      var last = out[out.length - 1];
      if (last && last.end === i - 1 && last.est === est) { last.idx.push(i); last.end = i; }
      else out.push({ idx: [i - 1, i], end: i, est: est });
    }
    return out;
  }

  /* A point that has no neighbour on either side — drawn as a dot so a single
     day of history still shows. */
  function isolated(values, i) {
    return isNum(values[i]) && !isNum(values[i - 1]) && !isNum(values[i + 1]);
  }

  /* The value range across every series. floorZero keeps 0 on the axis for
     amounts that start from nothing (debt, percent, in/out). A flat line gets a
     little room above and below so it is not drawn on the frame. */
  function domain(series, opts) {
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) {
      list(s.values).forEach(function (v) { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    });
    if (lo === Infinity) return null;
    var nonNeg = lo >= 0;
    if (opts.floorZero && lo > 0) lo = 0;
    if (hi === lo) {
      var p = Math.abs(hi) * 0.1 || 100;
      hi += p;
      lo = nonNeg && opts.floorZero ? Math.max(0, lo - p) : lo - p;
      if (hi === lo) hi = lo + 1;
    }
    return { lo: lo, hi: hi };
  }

  /**
   * lineChart(opts) → a <figure>. opts:
   *   title, desc, labels (x, one per point), axisLabels ([first, mid, last]),
   *   series: [{ name, cls ('s1'|'s2'|'s3'|'s0'), shape ('round'|'square'),
   *              values: [number|null], estimated: [bool|null] }],
   *   fmt (value → words), axisFmt (value → short), floorZero, empty (words)
   *   Plan waypoints (Cash chart only):
   *   xCount   slots on the x axis, when the axis runs past the last label
   *            (the plan's future days). The lines still end at the last value.
   *   guides   slot numbers that get a thin dashed guide line
   *   todayIdx the slot of today, drawn as a thin line when the axis runs past it
   *   plotExtra HTML added inside the plot (the Plan strip); notes HTML under it
   */
  function lineChart(opts) {
    var series = list(opts.series);
    var n = list(opts.labels).length;
    var has = series.some(function (s) { return list(s.values).some(isNum); });
    var head = '<figcaption class="eyebrow">' + esc(opts.title) + '</figcaption>';
    if (!has || !n) {
      return '<figure class="card tchart" data-chart="' + esc(opts.key) + '">' + head +
        '<p class="caption tnone">' + esc(opts.empty || "No history yet.") + '</p>' + (opts.notes || "") + '</figure>';
    }
    var dom = domain(series, opts);
    var fmt = opts.fmt || money;
    var axisFmt = opts.axisFmt || moneyShort;
    var xn = Math.max(n, isNum(opts.xCount) ? opts.xCount : n);
    function x(i) { return xn === 1 ? W / 2 : (i * W) / (xn - 1); }
    function y(v) { return PAD + ((dom.hi - v) * (H - 2 * PAD)) / (dom.hi - dom.lo); }
    var id = "tc" + (++uid);
    var svg = '<svg class="tsvg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" ' +
      'aria-labelledby="' + id + 't ' + id + 'd" focusable="false">' +
      '<title id="' + id + 't">' + esc(opts.title) + '</title><desc id="' + id + 'd">' + esc(opts.desc || "") + '</desc>';
    [dom.hi, (dom.hi + dom.lo) / 2, dom.lo].forEach(function (v) {
      svg += '<line class="tgrid" x1="0" x2="' + W + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" vector-effect="non-scaling-stroke"></line>';
    });
    if (dom.lo < 0 && dom.hi > 0) {
      svg += '<line class="tzero" x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" vector-effect="non-scaling-stroke"></line>';
    }
    if (xn > n && isNum(opts.todayIdx)) {
      svg += '<line class="ttoday" x1="' + x(opts.todayIdx).toFixed(1) + '" x2="' + x(opts.todayIdx).toFixed(1) +
        '" y1="0" y2="' + H + '" vector-effect="non-scaling-stroke"></line>';
    }
    list(opts.guides).forEach(function (g) {
      if (!isNum(g)) return;
      svg += '<line class="tguide" x1="' + x(g).toFixed(1) + '" x2="' + x(g).toFixed(1) +
        '" y1="0" y2="' + H + '" vector-effect="non-scaling-stroke"></line>';
    });
    var dots = n <= 31;
    series.forEach(function (s) {
      var vals = list(s.values), est = list(s.estimated);
      segments(vals, est).forEach(function (seg) {
        svg += '<polyline class="tline ' + esc(s.cls) + (seg.est ? ' test' : '') + '" points="' +
          seg.idx.map(function (i) { return x(i).toFixed(1) + "," + y(vals[i]).toFixed(1); }).join(" ") +
          '" vector-effect="non-scaling-stroke"></polyline>';
      });
      var lastI = -1;
      for (var k = vals.length - 1; k >= 0; k--) if (isNum(vals[k])) { lastI = k; break; }
      vals.forEach(function (v, i) {
        if (!isNum(v)) return;
        var px = x(i).toFixed(1), py = y(v).toFixed(1);
        var words = s.name + " · " + opts.labels[i] + ": " + fmt(v) + (est[i] === true ? " (estimated)" : "");
        /* A zero-length path with a round or square cap is a dot that stays a
           dot when the SVG stretches. */
        if (dots || i === lastI || isolated(vals, i)) {
          svg += '<path class="tdot ' + esc(s.cls) + ' ' + (s.shape === "square" ? "sq" : "rd") +
            '" d="M' + px + ' ' + py + 'h0" vector-effect="non-scaling-stroke"></path>';
        }
        svg += '<path class="thit" d="M' + px + ' ' + py + 'h0" vector-effect="non-scaling-stroke"><title>' +
          esc(words) + '</title></path>';
      });
    });
    svg += '</svg>';

    var legend = '<p class="legend caption tlegend">' + series.map(function (s) {
      var vals = list(s.values), latest = null;
      for (var k = vals.length - 1; k >= 0; k--) if (isNum(vals[k])) { latest = vals[k]; break; }
      return '<span class="tkey-item"><span class="tkey ' + esc(s.cls) + ' ' + (s.shape === "square" ? "sq" : "rd") +
        '" aria-hidden="true"></span>' + esc(s.name) + ' <span class="num">' + esc(fmt(latest)) + '</span></span>';
    }).join("") + '</p>';

    var ax = opts.axisLabels || [opts.labels[0], opts.labels[Math.floor((n - 1) / 2)], opts.labels[n - 1]];
    var plot = '<div class="tplot">' +
      '<div class="ty caption" aria-hidden="true"><span>' + esc(axisFmt(dom.hi)) + '</span><span>' +
      esc(axisFmt((dom.hi + dom.lo) / 2)) + '</span><span>' + esc(axisFmt(dom.lo)) + '</span></div>' +
      svg +
      '<div class="tx caption" aria-hidden="true">' + ax.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join("") + '</div>' +
      (opts.plotExtra || "") + '</div>' + (opts.notes || "");

    var anyEst = series.some(function (s) { return list(s.estimated).some(function (e, i) { return e === true && isNum(list(s.values)[i]); }); });
    var rows = opts.labels.map(function (l, i) {
      var cells = series.map(function (s) {
        var v = list(s.values)[i];
        return '<td class="r num">' + esc(fmt(v)) + (list(s.estimated)[i] === true && isNum(v) ? " *" : "") + '</td>';
      }).join("");
      return '<tr><td>' + esc(l) + '</td>' + cells + '</tr>';
    }).reverse().join("");
    var table = '<details class="tdata"><summary>Show the numbers</summary><div class="scroll-x"><table>' +
      '<thead><tr><th>' + esc(opts.rowHead || "Day") + '</th>' +
      series.map(function (s) { return '<th class="r">' + esc(s.name) + '</th>'; }).join("") + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      (anyEst ? '<p class="caption">* estimated from your bank activity</p>' : "") + '</details>';

    return '<figure class="card tchart" data-chart="' + esc(opts.key) + '">' + head + legend + plot + table + '</figure>';
  }

  /* ── the Trends area (Overview) ────────────────────────────────────────── */

  function rangeButtons(range) {
    return '<div class="trange" role="group" aria-label="Time range">' + RANGES.map(function (r) {
      return '<button type="button" class="trange-btn" data-range="' + r[0] + '" aria-pressed="' +
        (r[0] === range ? "true" : "false") + '">' + esc(r[1]) + '</button>';
    }).join("") + '</div>';
  }

  /* What the controls show: the screen's own choices first, then the read's. */
  function viewOf(d, view) {
    d = d || {};
    view = view || {};
    var asOf = typeof d.as_of === "string" ? d.as_of.slice(0, 10) : "";
    return {
      accounts: list(view.accounts && view.accounts.length ? view.accounts : d.accounts),
      account: view.account != null ? String(view.account) : (d.account && d.account.id ? String(d.account.id) : ""),
      from: view.from || d.from || "",
      to: view.to || d.to || "",
      today: view.today || asOf,
      msg: view.msg || "",
      plan: Array.isArray(view.plan) ? view.plan : null
    };
  }

  function typeWord(a) {
    if (TYPE_WORDS[a.type]) return TYPE_WORDS[a.type];
    var s = String(a.subtype || "").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Account";
  }

  /* The Account picker: "All accounts", then the open accounts by kind. Not
     drawn when the read named no accounts (nothing to pick). */
  function accountPicker(v) {
    var accts = v.accounts.filter(function (a) { return a && a.id; });
    if (!accts.length) return "";
    var groups = KIND_ORDER.map(function (k) {
      var mine = accts.filter(function (a) { return (KIND_WORDS[a.kind] ? a.kind : "unknown") === k; });
      if (!mine.length) return "";
      return '<optgroup label="' + esc(KIND_WORDS[k]) + '">' + mine.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (String(a.id) === v.account ? " selected" : "") + '>' +
          esc((a.label || a.name || "Account") + " · " + typeWord(a)) + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
    return '<label class="tfield tacct"><span class="tlabel">Account</span>' +
      '<select data-trends-account><option value=""' + (v.account ? "" : " selected") + '>All accounts</option>' +
      groups + '</select></label>';
  }

  function dateField(word, name, value, max) {
    return '<label class="tfield"><span class="tlabel">' + esc(word) + '</span>' +
      '<input type="date" name="' + name + '" data-trends-' + name + ' value="' + esc(realDay(value)) + '"' +
      (realDay(max) ? ' max="' + esc(max) + '"' : "") + ' required></label>';
  }

  /* From / To and the button that shows them. The browser's own date check is
     off (novalidate) so the words below are the ones the person reads. */
  function dateForm(v) {
    return '<form class="tdates" data-trends-dates novalidate aria-label="Pick any dates">' +
      dateField("From", "from", v.from, v.today) + dateField("To", "to", v.to, v.today) +
      '<button type="submit" class="btn-secondary tshow" data-trends-show>Show these dates</button></form>';
  }

  function head(range, view) {
    var v = view || viewOf(null, null);
    return '<div class="thead"><h2 id="h-trends">Trends</h2>' + rangeButtons(range) + '</div>' +
      '<div class="ttools">' + accountPicker(v) + dateForm(v) + '</div>' +
      '<p class="caption tmsg" data-trends-msg role="status" aria-live="polite">' + esc(v.msg) + '</p>';
  }

  /* ── bank waypoints: the plan's open-and-fund dates on the Cash chart ──────
     Chris (2026-11-07): "we put a little waypoint with the bank logo ... you
     highlight over the bank logo. It says, 'Oh, deposit money here at this
     time.'" The plan comes from GET /api/money/banks (deposit_plan). Nothing
     here invents a date, an amount or a reason: a row with no date is listed
     under the chart as "Date not set", never drawn; a bank with no logo shows
     its name in a chip, never a drawn logo. Future dates stretch the axis up to
     about six months; the money lines still end at today (no forecast). */

  var PLAN_AHEAD_DAYS = 183;
  var PLAN_STATUS = { planned: "Planned", opened: "Opened", deposited: "Deposited", seasoned: "Seasoned" };

  function addDaysUtc(day, n) {
    return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function dayList(a, b) {
    var out = [];
    for (var d = a, g = 0; d <= b && g < 800; g++, d = addDaysUtc(d, 1)) out.push(d);
    return out;
  }
  /* A logo address the page will load: https, our own path, or Plaid's PNG
     (a data:image/png URI). The plan's logo is a string or E's { src, alt }
     (src/finance/bank-strategy.mjs pickBankLogo); either works. Anything else
     → the name chip. */
  function safeLogo(u) {
    var v = u && typeof u === "object" ? u.src : u;
    var s = String(v == null ? "" : v).trim();
    return /^(https:\/\/|\/(?!\/)|data:image\/png;base64,[A-Za-z0-9+\/]+={0,2}$)/i.test(s) ? s : "";
  }
  /* One deposit_plan row as the chart reads it, or null when it has no name. */
  function planItem(p, i) {
    if (!p || typeof p !== "object") return null;
    var name = String(p.name == null ? "" : p.name).trim();
    if (!name) return null;
    return {
      key: String(p.lender_id == null || p.lender_id === "" ? "plan-" + i : p.lender_id),
      name: name,
      logo: safeLogo(p.logo),
      open_by: realDay(p.open_by),
      deposit_cents: isNum(p.deposit_cents) ? Math.round(p.deposit_cents) : null,
      reason: String(p.reason == null ? "" : p.reason).trim(),
      status: PLAN_STATUS[p.status] ? p.status : "planned"
    };
  }
  /* "Open <bank> and deposit <amount> by <date>." — the owner's sentence. */
  function planSentence(it) {
    return "Open " + it.name + (isNum(it.deposit_cents) ? " and deposit " + money(it.deposit_cents) : "") +
      (it.open_by ? " by " + dayLabel(it.open_by, true) : "") + ".";
  }
  function planWords(it) {
    var why = it.reason ? " " + it.reason + (/[.!?]$/.test(it.reason) ? "" : ".") : "";
    return planSentence(it) + why + " Status: " + PLAN_STATUS[it.status] + ".";
  }

  /**
   * planLayout(plan, days, today) — where each plan row goes.
   *   drawn   [{ item, idx, x (percent), lane, edge }] rows with a date on the axis
   *   notSet  rows with no date ("Date not set")
   *   outside rows with a date off these dates (before them, or more than six
   *           months ahead, or after a window that ends before today)
   *   extra   the future days added to the axis; allDays = days + extra
   */
  function planLayout(plan, days, today) {
    var out = { drawn: [], notSet: [], outside: [], extra: [], allDays: days.slice(), xCount: days.length, todayIdx: null };
    var items = list(plan).map(planItem).filter(Boolean);
    if (!items.length) return out;
    if (!days.length) {
      items.forEach(function (it) { (it.open_by ? out.outside : out.notSet).push(it); });
      return out;
    }
    var from = days[0], to = days[days.length - 1];
    var reachesToday = !!today && to >= today;
    var cap = today ? addDaysUtc(today, PLAN_AHEAD_DAYS) : to;
    var last = null;
    var onAxis = [];
    items.forEach(function (it) {
      if (!it.open_by) { out.notSet.push(it); return; }
      if (it.open_by >= from && it.open_by <= to) { onAxis.push(it); return; }
      if (reachesToday && it.open_by > to && it.open_by <= cap) {
        onAxis.push(it);
        if (!last || it.open_by > last) last = it.open_by;
        return;
      }
      out.outside.push(it);
    });
    if (last) {
      /* A little room after the last waypoint, so it never sits on the edge. */
      var pad = Math.max(7, Math.round(daysBetween(from, last) * 0.08));
      out.extra = dayList(addDaysUtc(to, 1), addDaysUtc(last, pad));
      out.allDays = days.concat(out.extra);
    }
    out.xCount = out.allDays.length;
    var ti = today ? out.allDays.indexOf(today) : -1;
    out.todayIdx = ti >= 0 ? ti : null;
    var xn = out.xCount;
    var lanes = [];
    out.drawn = onAxis.map(function (it) {
      var idx = out.allDays.indexOf(it.open_by);
      return { item: it, idx: idx, x: xn > 1 ? (idx * 100) / (xn - 1) : 50 };
    }).sort(function (a, b) { return a.x - b.x || (a.item.name < b.item.name ? -1 : 1); }).map(function (m) {
      /* A first guess at rows so close dates do not sit on top of each other;
         the page measures the real buttons and settles it (layoutPlans). */
      var lane = 0;
      while (lane < 3 && lanes[lane] !== undefined && m.x - lanes[lane] < 12) lane++;
      lanes[lane] = m.x;
      m.lane = lane;
      m.edge = m.x < 8 ? "edge-l" : m.x > 92 ? "edge-r" : "";
      return m;
    });
    return out;
  }

  function planMark(it) {
    return it.logo
      ? '<img class="twp-logo" src="' + esc(it.logo) + '" alt="" width="32" height="32" decoding="async" loading="lazy">'
      : '<span class="twp-chip">' + esc(it.name) + '</span>';
  }

  /* The Plan strip under the Cash chart: one button per drawn waypoint, each
     followed by its tip (shown on hover, keyboard focus, or a tap). */
  function planStrip(layout) {
    if (!layout.drawn.length) return "";
    var lanes = 1;
    layout.drawn.forEach(function (m) { lanes = Math.max(lanes, m.lane + 1); });
    return '<span class="tplan-label caption" aria-hidden="true">Plan</span>' +
      '<div class="tplan" data-lanes="' + lanes + '" role="group" aria-label="Your bank plan: when to open or fund each bank">' +
      layout.drawn.map(function (m) {
        var it = m.item, pos = m.x.toFixed(2);
        return '<button type="button" class="twp st-' + it.status + (m.edge ? " " + m.edge : "") +
          '" data-waypoint="' + esc(it.key) + '" data-name="' + esc(it.name) + '" data-lane="' + m.lane + '" data-x="' + pos + '" style="--x:' + pos + '%"' +
          ' aria-label="' + esc(planWords(it)) + '">' + planMark(it) + '</button>' +
          '<span class="twp-tip" aria-hidden="true" style="--x:' + pos + '%"><strong>' + esc(planSentence(it)) + '</strong>' +
          (it.reason ? '<span class="twp-why">' + esc(it.reason) + '</span>' : "") +
          '<span class="twp-status">Status: ' + esc(PLAN_STATUS[it.status]) + '</span></span>';
      }).join("") + '</div>';
  }

  function planList(title, items) {
    return '<p class="tplan-head">' + esc(title) + '</p><ul class="tplan-list">' + items.map(function (it) {
      return '<li>' + esc(planSentence(it)) + (it.reason ? ' <span class="twp-why">' + esc(it.reason) + '</span>' : "") + '</li>';
    }).join("") + '</ul>';
  }

  /* Words under the Cash chart: what the dates after today are, and the plan
     rows the strip cannot draw. withDrawn lists the drawn ones too (no history yet). */
  function planNotes(layout, withDrawn) {
    var parts = [];
    if (layout.extra.length && !withDrawn) {
      parts.push('<p class="caption">The money lines stop at today.</p>');
    }
    if (withDrawn && layout.drawn.length) parts.push(planList("Your bank plan", layout.drawn.map(function (m) { return m.item; })));
    if (layout.notSet.length) parts.push(planList("Date not set", layout.notSet));
    if (layout.outside.length) parts.push(planList("Not on these dates", layout.outside));
    return parts.length ? '<div class="tplan-notes">' + parts.join("") + '</div>' : "";
  }

  function dailyCharts(d, plan) {
    var daily = d.daily || {};
    var days = list(daily.days);
    var est = list(daily.estimated);
    var labels = days.map(function (x) { return dayLabel(x, true); });
    var axis = dayAxis(days);
    var cash = daily.cash || {};
    var debt = daily.debt || {};
    var noHist = "No history yet. FinanceOS saves your balances once a day; the line starts after the first save.";
    var cashSeries = [
      { name: "Personal", cls: "s1", shape: "round", values: list(cash.personal && cash.personal.cents), estimated: est },
      { name: "Business", cls: "s2", shape: "square", values: list(cash.business && cash.business.cents), estimated: est }
    ];
    var cashHas = days.length > 0 && cashSeries.some(function (s) { return s.values.some(isNum); });
    var today = typeof d.as_of === "string" ? d.as_of.slice(0, 10) : "";
    var layout = planLayout(plan, days, today);
    return lineChart({
      key: "cash", title: "Cash over time",
      desc: "Personal cash and business cash by day, as two separate lines. They are never added together." +
        (layout.drawn.length ? " Markers under the chart show when your plan says to open or fund each bank." : ""),
      labels: labels, axisLabels: layout.extra.length ? dayAxis(layout.allDays) : axis, empty: noHist,
      xCount: layout.xCount, todayIdx: layout.todayIdx,
      guides: layout.drawn.map(function (m) { return m.idx; }),
      plotExtra: planStrip(layout), notes: planNotes(layout, !cashHas),
      series: cashSeries
    }) + lineChart({
      key: "debt", title: "Debt over time",
      desc: "Everything owed on cards and loans by day, with the personal and business parts.",
      labels: labels, axisLabels: axis, empty: noHist, floorZero: true,
      series: [
        { name: "All debt", cls: "s0", shape: "round", values: list(debt.total && debt.total.cents), estimated: est },
        { name: "Personal", cls: "s1", shape: "round", values: list(debt.personal && debt.personal.cents), estimated: est },
        { name: "Business", cls: "s2", shape: "square", values: list(debt.business && debt.business.cents), estimated: est }
      ]
    }) + lineChart({
      key: "used", title: "Cards used",
      desc: "How much of your card limits you are using, by day, in percent.",
      labels: labels, axisLabels: axis, empty: noHist, floorZero: true, fmt: pct, axisFmt: pct,
      series: [{ name: "Cards used", cls: "s0", shape: "round", values: list(daily.cards_used_pct), estimated: est }]
    });
  }

  function flowChart(d, kind, word) {
    var m = d.monthly || {};
    var months = list(m.months);
    var k = m[kind] || {};
    return lineChart({
      key: "flow-" + kind, title: word + " money in vs out",
      desc: word + " money in and money out by month, from checking and savings. " +
        (kind === "personal" ? "Business is its own chart." : "Personal is its own chart."),
      labels: months.map(function (x) { return monthLabel(x, true); }),
      axisLabels: monthAxis(months),
      rowHead: "Month", floorZero: true,
      empty: "No " + word.toLowerCase() + " bank activity in this range yet.",
      series: [
        { name: "Money in", cls: "s3", shape: "round", values: list(k.in_cents) },
        { name: "Money out", cls: "s0", shape: "square", values: list(k.out_cents) }
      ]
    });
  }

  /* ── one account ───────────────────────────────────────────────────────── */

  /* One account's charts. Cards: what is owed with the limit beside it, and how
     much of the limit is used. Loans: what is owed. Bank accounts: the balance.
     Every point is a field of d.account; a null is a break, never 0. */
  function accountCharts(d, a) {
    var days = list(d.daily && d.daily.days);
    var labels = days.map(function (x) { return dayLabel(x, true); });
    var axis = dayAxis(days);
    var ks = KIND_SERIES[a.kind] || KIND_SERIES.unknown;
    var card = a.type === "card";
    var owes = card || a.type === "loan";
    var est = list(a.estimated);
    var noHist = "No history for this account yet.";
    var series = [{ name: owes ? "Owed" : "Balance", cls: ks[0], shape: ks[1], values: list(a.balance_cents), estimated: est }];
    if (card) series.push({ name: "Limit", cls: "s3", shape: "square", values: list(a.limit_cents), estimated: est });
    var balance = lineChart({
      key: "acct-balance",
      title: card ? "Owed and limit" : owes ? "Owed on this loan" : "Balance over time",
      desc: card ? "What is owed on this card each day, with the card's limit as a second line."
        : owes ? "What is owed on this loan each day." : "This account's balance each day.",
      labels: labels, axisLabels: axis, empty: noHist, floorZero: owes, series: series
    });
    if (!card) return '<div class="grid one">' + balance + '</div>';
    var used = lineChart({
      key: "acct-used", title: "Limit used",
      desc: "How much of this card's limit is used each day: what is owed divided by the limit.",
      labels: labels, axisLabels: axis, floorZero: true, fmt: pct, axisFmt: pct,
      empty: a.has_history ? "We do not have this card's limit for these days, so limit used cannot be shown." : noHist,
      series: [{ name: "Limit used", cls: "s0", shape: "round", values: list(a.used_pct), estimated: est }]
    });
    return '<div class="grid two">' + balance + used + '</div>';
  }

  function accountLine(a) {
    var facts = [KIND_WORDS[a.kind] || KIND_WORDS.unknown, typeWord(a), a.institution].filter(Boolean).join(" · ");
    return '<p class="tacct-line"><span class="tacct-name">' + esc(a.label || a.name || "Account") + '</span>' +
      '<span class="caption">' + esc(facts) + '</span></p>';
  }

  /* renderTrends(d, range, view) — range is the pressed button (none for any
     dates); view is the screen's current choices (see viewOf). */
  function renderTrends(d, range, view) {
    d = d || {};
    range = d.custom === true ? null : (range || d.range || "90d");
    var v = viewOf(d, view);
    var top = '<section class="block trends" aria-labelledby="h-trends">' + head(range, v);
    var a = d.account && d.account.id ? d.account : null;
    if (a) {
      return top + '<p class="caption">This is one account on its own. A dashed line is an estimate.</p>' +
        accountLine(a) + accountCharts(d, a) + '</section>';
    }
    top += '<p class="caption">A dashed line is estimated from your bank activity.</p>';
    return top + '<div class="grid tgrid3">' + dailyCharts(d, v.plan) + '</div>' +
      '<div class="grid two">' + flowChart(d, "personal", "Personal") + flowChart(d, "business", "Business") +
      '</div></section>';
  }

  function renderLoading(range, view) {
    var sk = '<div class="card skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<section class="block trends" aria-labelledby="h-trends" aria-busy="true">' + head(range, viewOf(null, view)) +
      '<div class="grid tgrid3">' + sk + sk + sk + '</div></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    forbidden: "This account is not allowed to see these trends.",
    baddates: "Those choices did not work. Pick your dates again, no more than 24 months apart.",
    server: "Something went wrong on our side while loading your trends. Try again in a few minutes."
  };

  function renderError(kind, range, view) {
    return '<section class="block trends" aria-labelledby="h-trends">' + head(range, viewOf(null, view)) +
      '<div class="card error" role="alert"><p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-trends-retry>Try again</button></div></section>';
  }

  /* ── the sales line (Connections) ──────────────────────────────────────── */

  function renderSales(d) {
    var s = d && d.sales;
    if (!s || !list(s.months).length) return "";
    var months = list(s.months);
    return '<section class="block trends tsales" aria-labelledby="h-sales"><h2 id="h-sales">Sales trend</h2>' +
      '<p class="caption">Net sales each month from your connected processors: sales minus refunds and fees. ' +
      'A month before your first connection is a break, not $0.</p>' +
      '<div class="grid one">' + lineChart({
        key: "sales", title: "Net sales by month",
        desc: "Net merchant sales per month, from every connected processor.",
        labels: months.map(function (x) { return monthLabel(x, true); }),
        axisLabels: [monthLabel(months[0]), monthLabel(months[Math.floor((months.length - 1) / 2)]), monthLabel(months[months.length - 1])],
        rowHead: "Month", floorZero: true, empty: "No sales in this range yet.",
        series: [{ name: "Net sales", cls: "s0", shape: "round", values: list(s.net_cents) }]
      }) + '</div></section>';
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }
  function call(path) {
    var headers = { accept: "application/json" };
    var t = token();
    if (t) headers.authorization = "Bearer " + t;
    var started;
    try { started = root.fetch(path, { method: "GET", headers: headers, credentials: "same-origin" }); }
    catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }
  function classify(res) {
    var s = res && res.status, b = res && res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0) return "offline";
    if (s === 400) return "baddates";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true) return "server";
    return "ok";
  }
  /* pathFor("12m", cid), or pathFor({ range, from, to, account }, cid). Dates
     win over the range; the account rides along with either. */
  function pathFor(want, cid) {
    var w = typeof want === "string" ? { range: want } : (want || {});
    var q = w.from && w.to
      ? "from=" + encodeURIComponent(w.from) + "&to=" + encodeURIComponent(w.to)
      : "range=" + encodeURIComponent(w.range || "90d");
    if (w.account) q += "&account=" + encodeURIComponent(w.account);
    return READ_PATH + "?" + q + (cid ? "&client_id=" + encodeURIComponent(cid) : "");
  }

  /* The bank plan read. Staff name the file the same way as the trends read. */
  function banksPath(cid) { return BANKS_PATH + (cid ? "?client_id=" + encodeURIComponent(cid) : ""); }

  /* The page measures the drawn waypoints: one that would hang off either end
     is pinned to that end, and two that would touch move to the next row. */
  function layoutPlans(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    var strips = scope.querySelectorAll(".tplan");
    for (var s = 0; s < strips.length; s++) {
      var strip = strips[s], box = strip.getBoundingClientRect();
      if (!box || !box.width) continue;
      var btns = Array.prototype.slice.call(strip.querySelectorAll(".twp"));
      btns.forEach(function (b) { b.classList.remove("edge-l", "edge-r"); b.setAttribute("data-lane", "0"); });
      btns.forEach(function (b) {
        var r = b.getBoundingClientRect();
        if (r.left < box.left) b.classList.add("edge-l");
        else if (r.right > box.right) b.classList.add("edge-r");
      });
      btns.sort(function (a, b) { return Number(a.getAttribute("data-x")) - Number(b.getAttribute("data-x")); });
      var placed = [], top = 0;
      btns.forEach(function (b) {
        var r = b.getBoundingClientRect(), lane = 0;
        var hits = function (p) { return r.left < p[1] + 4 && r.right > p[0] - 4; };
        while (lane < 3 && (placed[lane] || []).some(hits)) lane++;
        (placed[lane] = placed[lane] || []).push([r.left, r.right]);
        b.setAttribute("data-lane", String(lane));
        top = Math.max(top, lane);
      });
      strip.setAttribute("data-lanes", String(top + 1));
    }
  }

  /* mount(el, ctx) — the Trends area. ctx = { clientId, apiGet(path) }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : call;
    var cid = ctx.clientId || param("client_id") || "";
    var today = localToday();
    var st = { range: "90d", from: "", to: "", account: "", msg: "", accounts: [], lastOk: null };
    /* The bank plan: null until /api/money/banks answers with one. A read that
       fails, or never answers, leaves it null and the charts draw without it. */
    var plan = null;
    try { st.range = root.sessionStorage.getItem("fos_trends_range") || "90d"; } catch (e) { /* no storage */ }
    if (!/^(30d|90d|12m)$/.test(st.range)) st.range = "90d";
    try {
      var kept = String(root.sessionStorage.getItem("fos_trends_dates") || "").split("|");
      if (kept.length === 2 && !checkDates(kept[0], kept[1])) { st.from = kept[0]; st.to = kept[1]; }
    } catch (e) { /* no storage */ }

    function shownRange() { return st.from && st.to ? null : st.range; }
    function view() {
      return { accounts: st.accounts, account: st.account, from: st.from, to: st.to, today: today, msg: st.msg, plan: plan };
    }
    /* A redraw replaces the controls; give focus back to the one just used. */
    function refocus(sel) {
      if (!sel || !el.querySelector) return;
      var f = el.querySelector(sel);
      if (f && typeof f.focus === "function") { try { f.focus(); } catch (e) { /* not focusable */ } }
    }
    function load(focusSel) {
      el.innerHTML = renderLoading(shownRange(), view());
      refocus(focusSel);
      return Promise.resolve(get(pathFor(st, cid))).then(function (res) {
        /* The picked account is not one of this file's open accounts any more:
           say so once and show all accounts. */
        if (res && res.status === 404 && st.account) {
          st.account = "";
          st.msg = "That account is not on this file, so all accounts are shown.";
          return load("[data-trends-account]");
        }
        var kind = classify(res);
        if (kind === "signin") { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); return; }
        if (kind === "ok") st.accounts = list(res.body.accounts);
        st.lastOk = kind === "ok" ? res.body : null;
        el.innerHTML = kind === "ok" ? renderTrends(res.body, shownRange(), view()) : renderError(kind, shownRange(), view());
        st.msg = "";
        layoutPlans(el);
        refocus(focusSel);
      });
    }
    /* Which of our controls has focus, so a redraw can give it back. */
    function activeKey() {
      var a = root.document && root.document.activeElement;
      if (!a || !el.contains || !el.contains(a) || typeof a.getAttribute !== "function") return null;
      if (a.hasAttribute("data-range")) return '[data-range="' + a.getAttribute("data-range") + '"]';
      if (a.hasAttribute("data-waypoint")) {
        var all = el.querySelectorAll("[data-waypoint]");
        for (var i = 0; i < all.length; i++) if (all[i] === a) return i;
      }
      return a.hasAttribute("data-trends-show") ? "[data-trends-show]" : null;
    }
    /* The plan arrived after the charts: draw it in. Not while someone is
       typing a date or choosing an account — the next draw picks it up. */
    function loadPlan() {
      Promise.resolve().then(function () { return get(banksPath(cid)); }).then(function (res) {
        var b = res && res.body;
        if (!res || res.status !== 200 || !b || b.ok === false || !Array.isArray(b.deposit_plan)) return;
        plan = b.deposit_plan;
        var a = root.document && root.document.activeElement;
        var typing = a && el.contains && el.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName || "");
        if (!st.lastOk || st.account || typing) return;
        var key = activeKey();
        el.innerHTML = renderTrends(st.lastOk, shownRange(), view());
        layoutPlans(el);
        if (typeof key === "number") { var w = el.querySelectorAll("[data-waypoint]")[key]; if (w) w.focus(); }
        else refocus(key);
      }, function () { /* no plan: the charts stay as they are */ });
    }
    function closeTips(except) {
      var open = el.querySelectorAll ? el.querySelectorAll('.twp[data-open="true"]') : [];
      for (var i = 0; i < open.length; i++) if (open[i] !== except) open[i].removeAttribute("data-open");
    }
    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-range],[data-trends-retry],[data-waypoint]") : null;
      if (!t || !t.hasAttribute("data-waypoint")) closeTips(null);
      if (!t) return;
      if (t.hasAttribute("data-waypoint")) {
        /* A tap (or Enter, or Space) opens this waypoint's words; again closes them. */
        closeTips(t);
        if (t.getAttribute("data-open") === "true") t.removeAttribute("data-open");
        else t.setAttribute("data-open", "true");
        return;
      }
      if (t.hasAttribute("data-range")) {
        st.range = t.getAttribute("data-range");
        st.from = "";
        st.to = "";
        try { root.sessionStorage.setItem("fos_trends_range", st.range); } catch (e2) { /* no storage */ }
        try { root.sessionStorage.removeItem("fos_trends_dates"); } catch (e2) { /* no storage */ }
        return load('[data-range="' + st.range + '"]');
      }
      load();
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || typeof t.matches !== "function" || !t.matches("[data-trends-account]")) return;
      st.account = String(t.value || "");
      load("[data-trends-account]");
    });
    el.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || typeof f.matches !== "function" || !f.matches("[data-trends-dates]")) return;
      if (e.preventDefault) e.preventDefault();
      var fromEl = f.querySelector("[data-trends-from]"), toEl = f.querySelector("[data-trends-to]");
      var from = fromEl ? String(fromEl.value || "") : "", to = toEl ? String(toEl.value || "") : "";
      var problem = checkDates(from, to);
      if (problem) {
        var msg = el.querySelector("[data-trends-msg]");
        if (msg) msg.textContent = problem;
        if (fromEl && typeof fromEl.focus === "function") fromEl.focus();
        return;
      }
      st.from = from;
      st.to = to;
      try { root.sessionStorage.setItem("fos_trends_dates", from + "|" + to); } catch (e2) { /* no storage */ }
      load("[data-trends-show]");
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") closeTips(null);
    });
    /* A logo that will not load becomes the bank's name in a chip. */
    el.addEventListener("error", function (e) {
      var img = e.target;
      if (!img || img.tagName !== "IMG" || !img.classList || !img.classList.contains("twp-logo")) return;
      var btn = img.closest ? img.closest("[data-waypoint]") : null;
      var chip = root.document.createElement("span");
      chip.className = "twp-chip";
      chip.textContent = btn ? String(btn.getAttribute("data-name") || "") : "";
      img.replaceWith(chip);
      layoutPlans(el);
    }, true);
    if (root.document && typeof root.document.addEventListener === "function") {
      root.document.addEventListener("click", function (e) {
        if (el.contains && !el.contains(e.target)) closeTips(null);
      });
    }
    var queued = false;
    if (typeof root.addEventListener === "function") {
      root.addEventListener("resize", function () {
        if (queued) return;
        queued = true;
        (root.requestAnimationFrame || setTimeout)(function () { queued = false; layoutPlans(el); });
      });
    }
    load();
    loadPlan();
    return { reload: load };
  }

  /* mountSales(el, ctx) — the sales line under Connections. 12 months. Paints
     nothing when there is no processor connected (the section says so). */
  function mountSales(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : call;
    var cid = ctx.clientId || param("client_id") || "";
    function load() {
      return Promise.resolve(get(pathFor("12m", cid))).then(function (res) {
        el.innerHTML = classify(res) === "ok" ? renderSales(res.body) : "";
      });
    }
    load();
    return { reload: load };
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.trends = { mount: mount, mountSales: mountSales };
  root.FinanceOS.extras = root.FinanceOS.extras || {};
  root.FinanceOS.extras.connections = { mount: mountSales };

  root.FHTrends = {
    lineChart: lineChart, segments: segments, renderTrends: renderTrends, renderSales: renderSales,
    renderLoading: renderLoading, renderError: renderError, money: money, pct: pct, classify: classify,
    pathFor: pathFor, checkDates: checkDates, dayAxis: dayAxis, planLayout: planLayout, banksPath: banksPath,
    mount: mount, mountSales: mountSales
  };
})(typeof window !== "undefined" ? window : globalThis);
