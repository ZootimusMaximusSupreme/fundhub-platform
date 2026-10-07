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
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/trends";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var RANGES = [["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];
  var W = 600, H = 160, PAD = 10;
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
   */
  function lineChart(opts) {
    var series = list(opts.series);
    var n = list(opts.labels).length;
    var has = series.some(function (s) { return list(s.values).some(isNum); });
    var head = '<figcaption class="eyebrow">' + esc(opts.title) + '</figcaption>';
    if (!has || !n) {
      return '<figure class="card tchart" data-chart="' + esc(opts.key) + '">' + head +
        '<p class="caption tnone">' + esc(opts.empty || "No history yet.") + '</p></figure>';
    }
    var dom = domain(series, opts);
    var fmt = opts.fmt || money;
    var axisFmt = opts.axisFmt || moneyShort;
    function x(i) { return n === 1 ? W / 2 : (i * W) / (n - 1); }
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
      '<div class="tx caption" aria-hidden="true">' + ax.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join("") + '</div></div>';

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

  function head(range) {
    return '<div class="thead"><h2 id="h-trends">Trends</h2>' + rangeButtons(range) + '</div>';
  }

  function dailyCharts(d) {
    var daily = d.daily || {};
    var days = list(daily.days);
    var est = list(daily.estimated);
    var labels = days.map(function (x) { return dayLabel(x, true); });
    var axis = days.length ? [dayLabel(days[0]), dayLabel(days[Math.floor((days.length - 1) / 2)]), dayLabel(days[days.length - 1])] : [];
    var cash = daily.cash || {};
    var debt = daily.debt || {};
    var noHist = "No history yet. FinanceOS saves your balances once a day; the line starts after the first save.";
    return lineChart({
      key: "cash", title: "Cash over time",
      desc: "Personal cash and business cash by day, as two separate lines. They are never added together.",
      labels: labels, axisLabels: axis, empty: noHist,
      series: [
        { name: "Personal", cls: "s1", shape: "round", values: list(cash.personal && cash.personal.cents), estimated: est },
        { name: "Business", cls: "s2", shape: "square", values: list(cash.business && cash.business.cents), estimated: est }
      ]
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
      axisLabels: months.length ? [monthLabel(months[0]), monthLabel(months[Math.floor((months.length - 1) / 2)]), monthLabel(months[months.length - 1])] : [],
      rowHead: "Month", floorZero: true,
      empty: "No " + word.toLowerCase() + " bank activity in this range yet.",
      series: [
        { name: "Money in", cls: "s3", shape: "round", values: list(k.in_cents) },
        { name: "Money out", cls: "s0", shape: "square", values: list(k.out_cents) }
      ]
    });
  }

  function renderTrends(d, range) {
    range = range || (d && d.range) || "90d";
    var top = '<section class="block trends" aria-labelledby="h-trends">' + head(range) +
      '<p class="caption">Each line is one kind of money. Personal and business are never added together. ' +
      'A dashed line is estimated from your bank activity. A break in a line is a day we have no number for.</p>';
    return top + '<div class="grid tgrid3">' + dailyCharts(d) + '</div>' +
      '<div class="grid two">' + flowChart(d, "personal", "Personal") + flowChart(d, "business", "Business") +
      '</div></section>';
  }

  function renderLoading(range) {
    var sk = '<div class="card skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<section class="block trends" aria-labelledby="h-trends" aria-busy="true">' + head(range) +
      '<div class="grid tgrid3">' + sk + sk + sk + '</div></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    forbidden: "This account is not allowed to see these trends.",
    server: "Something went wrong on our side while loading your trends. Try again in a few minutes."
  };

  function renderError(kind, range) {
    return '<section class="block trends" aria-labelledby="h-trends">' + head(range) +
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
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true) return "server";
    return "ok";
  }
  function pathFor(range, cid) {
    return READ_PATH + "?range=" + encodeURIComponent(range) + (cid ? "&client_id=" + encodeURIComponent(cid) : "");
  }

  /* mount(el, ctx) — the Trends area. ctx = { clientId, apiGet(path) }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : call;
    var cid = ctx.clientId || param("client_id") || "";
    var range = "90d";
    try { range = root.sessionStorage.getItem("fos_trends_range") || "90d"; } catch (e) { /* no storage */ }
    if (!/^(30d|90d|12m)$/.test(range)) range = "90d";

    function load() {
      el.innerHTML = renderLoading(range);
      return Promise.resolve(get(pathFor(range, cid))).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { if (typeof ctx.onSignIn === "function") ctx.onSignIn(); return; }
        el.innerHTML = kind === "ok" ? renderTrends(res.body, range) : renderError(kind, range);
      });
    }
    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-range],[data-trends-retry]") : null;
      if (!t) return;
      if (t.hasAttribute("data-range")) {
        range = t.getAttribute("data-range");
        try { root.sessionStorage.setItem("fos_trends_range", range); } catch (e2) { /* no storage */ }
      }
      load();
    });
    load();
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
    mount: mount, mountSales: mountSales
  };
})(typeof window !== "undefined" ? window : globalThis);
