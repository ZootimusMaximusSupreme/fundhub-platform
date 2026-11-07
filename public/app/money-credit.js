/* Credit — the client's credit page (/app/money-credit.html), like Credit Karma.
 *
 * Reads ONE endpoint, GET /api/money/credit, and paints it. Nothing on this page
 * invents a number: every figure is a field from that read.
 *
 * THE HONESTY RULES (same as money.js):
 *   - A null is "we do not have this number" and paints "—", never 0.
 *   - A score off a sample report says so, in words, at the top.
 *   - UnderwriteIQ's sentences are printed exactly as the server sent them.
 *   - No chart line is drawn from fewer than two pulls, and a line breaks
 *     where a month had no pull or a pull did not carry that score.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-credit-screen.test.mjs can run them in Node against a fixture.
 * mount() and init() are the only parts that need a browser. This file is the
 * Credit section of the one-page /app/financeos.html
 * (window.FinanceOS.sections.credit); money-credit.html is a thin shell.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/credit";
  var SETUP_PATH = "/app/money-setup.html";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var BUREAUS = [
    { key: "experian", label: "Experian", short: "EX" },
    { key: "equifax", label: "Equifax", short: "EQ" },
    { key: "transunion", label: "TransUnion", short: "TU" }
  ];
  var FICO_MIN = 300, FICO_MAX = 850;

  /* FICO's own published ranges. A presentation grouping over the score the
     bureau sent, not a scoring model of ours. */
  var FICO_BANDS = [
    { max: 579, word: "Poor", range: "300–579" },
    { max: 669, word: "Fair", range: "580–669" },
    { max: 739, word: "Good", range: "670–739" },
    { max: 799, word: "Very good", range: "740–799" },
    { max: 850, word: "Exceptional", range: "800–850" }
  ];
  /* Experian's published Intelliscore risk classes (1–100, higher is safer). */
  var BIZ_BANDS = [
    { max: 10, word: "High risk", range: "1–10" },
    { max: 25, word: "Medium-high risk", range: "11–25" },
    { max: 50, word: "Medium risk", range: "26–50" },
    { max: 75, word: "Low-medium risk", range: "51–75" },
    { max: 100, word: "Low risk", range: "76–100" }
  ];
  /* The server's utilisation bands (src/http/client-detail.mjs UTILISATION_BANDS). */
  var USE_WORDS = {
    excellent: "Excellent — 10% or less",
    good: "Good — 30% or less",
    high: "High — over 30%",
    severe: "Very high — over 50%"
  };
  var KIND_WORDS = { revolving: "Card", loc: "Line of credit", installment: "Loan" };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function list(v) { return Array.isArray(v) ? v : []; }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* cents → "$1,234". Whole dollars: credit limits and balances read that way. */
  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var dollars = String(Math.round(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "−$" : "$") + dollars;
  }

  function count(n) { return isNum(n) ? String(n) : "—"; }

  function pct(v) {
    if (!isNum(v)) return "—";
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
  }

  /* An ISO moment or date → "Sep 30, 2026", read off the calendar date so no
     time zone can move it a day. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  function stamp(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    try {
      return new Date(t).toLocaleString("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function bandOf(bands, v) {
    if (!isNum(v)) return null;
    for (var i = 0; i < bands.length; i++) if (v <= bands[i].max) return bands[i];
    return bands[bands.length - 1];
  }

  function ficoBand(v) { return bandOf(FICO_BANDS, v); }
  function bizBand(v) { return bandOf(BIZ_BANDS, v); }

  /* A half-ring gauge. pathLength=100 makes the dash the percent. */
  function gauge(v, min, max, label) {
    var p = isNum(v) ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
    var arc = "M10 60 A50 50 0 0 1 110 60";
    return '<svg class="gauge" viewBox="0 0 120 66" role="img" aria-label="' + esc(label) + '">' +
      '<path class="gauge-track" d="' + arc + '" pathLength="100"></path>' +
      (isNum(v) ? '<path class="gauge-fill" d="' + arc + '" pathLength="100" stroke-dasharray="' +
        (Math.round(p * 10) / 10) + ' 100"></path>' : "") +
      '</svg>';
  }

  function usedBar(p) {
    if (!isNum(p)) return "";
    var w = Math.max(0, Math.min(100, p));
    return '<svg class="used-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' +
      esc(pct(p)) + ' used"><rect class="used-track" x="0" y="0" width="100" height="8" rx="4"></rect>' +
      '<rect class="used-fill" x="0" y="0" width="' + w + '" height="8" rx="4"></rect></svg>';
  }

  /* The change since the pull before, for one bureau, or null. */
  function changeFor(d, key) {
    var h = list(d.history).filter(function (p) { return isNum(p[key]); });
    if (h.length < 2) return null;
    var last = h[h.length - 1], prev = h[h.length - 2];
    return { delta: last[key] - prev[key], since: prev.pulled_at };
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderSample(d) {
    if (!d || d.sample !== true) return "";
    return '<div class="sample" role="note"><strong>Sample report</strong>' +
      '<span>These scores came from a sample credit report, not a real bureau pull.</span></div>';
  }

  function scoreTile(d, b) {
    var s = (d.personal && d.personal[b.key]) || {};
    var band = ficoBand(s.score);
    var id = "s-" + b.key;
    if (!isNum(s.score)) {
      return '<section class="card tile" aria-labelledby="' + id + '">' +
        '<h2 class="eyebrow" id="' + id + '">' + esc(b.label) + '</h2>' +
        '<span class="big">—</span>' + gauge(null, FICO_MIN, FICO_MAX, "No " + b.label + " score") +
        '<p class="caption">No ' + esc(b.label) + ' score on file yet</p></section>';
    }
    var ch = changeFor(d, b.key);
    var compare = ch
      ? (ch.delta > 0 ? "+" : ch.delta < 0 ? "−" : "") + Math.abs(ch.delta) + " since " + day(ch.since)
      : band.word + " is " + band.range;
    return '<section class="card tile" aria-labelledby="' + id + '">' +
      '<h2 class="eyebrow" id="' + id + '">' + esc(b.label) + '</h2>' +
      '<span class="big">' + esc(s.score) + '</span>' +
      gauge(s.score, FICO_MIN, FICO_MAX, b.label + " " + s.score + " of 850") +
      '<p class="band-word">' + esc(band.word) + '</p>' +
      '<p class="caption">' + esc(compare) + '</p>' +
      '<p class="caption">Pulled ' + esc(day(s.pulled_at)) + '</p></section>';
  }

  function businessTile(d) {
    var biz = d.business || {};
    var v = biz.intelliscore;
    var band = bizBand(v);
    var head = '<section class="card tile" aria-labelledby="s-biz">' +
      '<h2 class="eyebrow" id="s-biz">Business · Experian</h2>';
    if (!isNum(v)) {
      return head + '<span class="big">—</span>' + gauge(null, 0, 100, "No business score") +
        '<p class="caption">No business score on file yet' +
        (biz.name ? " for " + esc(biz.name) : "") + '</p></section>';
    }
    return head + '<span class="big">' + esc(v) + '</span>' +
      gauge(v, 0, 100, "Business score " + v + " of 100") +
      '<p class="band-word">' + esc(band.word) + '</p>' +
      '<p class="caption">Intelliscore, 1–100' + (biz.name ? " · " + esc(biz.name) : "") + '</p>' +
      (isNum(biz.fsr) ? '<p class="caption">Financial stability ' + esc(biz.fsr) + ' of 100</p>' : "") +
      '</section>';
  }

  function renderScores(d) {
    return '<div class="grid tiles credit-scores">' +
      BUREAUS.map(function (b) { return scoreTile(d, b); }).join("") +
      businessTile(d) + '</div>';
  }

  function renderFacts(d) {
    var u = d.utilization || {};
    var a = d.accounts || {};
    var inq = d.inquiries || {};
    var by = inq.by_bureau || {};
    var neg = (d.negative_items || {}).count;
    var late = (d.late_payments || {}).count;

    var useTile = '<section class="card tile" aria-labelledby="f-use">' +
      '<h2 class="eyebrow" id="f-use">Cards used</h2>' +
      '<span class="big">' + esc(pct(u.percent)) + '</span>' + usedBar(u.percent) +
      '<p class="caption">' + esc(isNum(u.percent)
        ? (USE_WORDS[u.band] || "") + (u.partial ? " · some cards have no limit on file" : "")
        : "Not on file yet") + '</p></section>';

    var acctNote = isNum(a.open)
      ? plural(isNum(a.revolving) ? a.revolving : 0, "card or line", "cards or lines") + " · " +
        plural(isNum(a.installment) ? a.installment : 0, "loan", "loans")
      : "Not on file yet";
    var acctTile = '<section class="card tile" aria-labelledby="f-acct">' +
      '<h2 class="eyebrow" id="f-acct">Open accounts</h2>' +
      '<span class="big">' + esc(count(a.open)) + '</span>' +
      '<p class="caption">' + esc(acctNote) + '</p></section>';

    var inqNote = BUREAUS.map(function (b) { return b.short + " " + count(by[b.key]); }).join(" · ");
    var inqTile = '<section class="card tile" aria-labelledby="f-inq">' +
      '<h2 class="eyebrow" id="f-inq">Hard inquiries</h2>' +
      '<span class="big">' + esc(count(inq.total)) + '</span>' +
      '<p class="caption">' + esc(isNum(inq.total) || BUREAUS.some(function (b) { return isNum(by[b.key]); })
        ? inqNote : "Not on file yet") + '</p></section>';

    var negTile = '<section class="card tile" aria-labelledby="f-neg">' +
      '<h2 class="eyebrow" id="f-neg">Negative items</h2>' +
      '<span class="big">' + esc(count(neg)) + '</span>' +
      '<p class="caption">' + esc(isNum(neg)
        ? "Late payments: " + count(late)
        : "Not on file yet") + '</p></section>';

    return '<div class="grid tiles credit-facts">' + useTile + acctTile + inqTile + negTile + '</div>';
  }

  /* UnderwriteIQ's own sentences, verbatim. */
  function renderSays(d) {
    var rows = list(d.suggestions).filter(function (s) { return s && typeof s.text === "string" && s.text; })
      .map(function (s) { return '<li>' + esc(s.text) + '</li>'; }).join("");
    return '<section class="card" aria-labelledby="c-says"><h2 class="eyebrow" id="c-says">What to work on</h2>' +
      (rows ? '<ul class="says">' + rows + '</ul><p class="caption">From UnderwriteIQ, based on your credit file.</p>'
        : '<p class="caption">No tips yet. They show up once your credit file is on record.</p>') +
      '</section>';
  }

  /* ── credit over time ───────────────────────────────────────────────────
     Spec item 4 (2026-11-06): one line per bureau from every saved pull, and
     a picker that shows each saved business's own lines. Reads
     credit_history off /api/money/credit (src/finance/credit-history.mjs).
     Every point is a real pull. The server marks gap_before where a calendar
     month passed with no pull, or a pull did not carry that score, and the
     line breaks there. No chart line is drawn from fewer than two pulls.

     A pure render draws at PLOT_W. mount() measures the card and redraws at
     its real width, so one unit in the drawing is one pixel on the screen and
     the labels stay readable on a phone. */

  var PLOT_W = 600;
  /* Solid, dashed, dotted: the three line hooks both credit stylesheets
     already carry (money-credit.html and financeos.html). Lines differ by
     dash, not by colour, and the legend says which is which in words. */
  var LINE_CLS = ["line-ex", "line-eq", "line-tu"];
  var KEY_CLS = ["key", "key key-eq", "key key-tu"];
  /* A business report's own field names, in words. Any other field the
     report carries is shown under its own name. */
  var FIELD_WORDS = { commercialScore: "Intelliscore", fsrScore: "Financial stability (FSR)" };

  /* An older read sent only `history` (two or more scored pulls). Same shape
     as credit_history.personal; a missing score still breaks the line. */
  function legacyPersonal(history) {
    var h = list(history);
    return {
      pulls: h.map(function (p) { return { pulled_at: p.pulled_at, sample: p.sample === true }; }),
      series: BUREAUS.map(function (b) {
        var pts = [], prev = -1;
        h.forEach(function (p, i) {
          if (!isNum(p[b.key])) return;
          pts.push({ pulled_at: p.pulled_at, score: p[b.key], sample: p.sample === true, gap_before: prev >= 0 && i - prev > 1 });
          prev = i;
        });
        return { bureau: b.key, points: pts };
      }),
      usage: []
    };
  }

  function historyOf(d) {
    var ch = d && d.credit_history;
    var personal = ch && ch.personal && Array.isArray(ch.personal.series) ? ch.personal : legacyPersonal(d && d.history);
    return { personal: personal, businesses: list(ch && ch.businesses) };
  }

  function bizLabel(biz, all) {
    var name = biz && biz.name ? biz.name : "Unnamed business";
    var twin = all.filter(function (o) { return o && o.name === biz.name; }).length > 1;
    return twin && biz.state ? name + " (" + biz.state + ")" : name;
  }

  function fieldLabel(field) { return FIELD_WORDS[field] || String(field); }

  /* "Sep 30", or "Sep '25" when the pulls cross a year. */
  function axisDay(iso, multiYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    return MONTHS[Number(m[2]) - 1] + (multiYear ? " '" + m[1].slice(2) : " " + Number(m[3]));
  }

  /* Which pull dates get a label: the newest always, the rest when there is
     room. Every pull still gets a tick and a dot. */
  function labelled(xs, gap) {
    var keep = [], last = -Infinity, n = xs.length;
    for (var i = 0; i < n; i++) if (xs[i] - last >= gap) { keep.push(i); last = xs[i]; }
    if (n && keep[keep.length - 1] !== n - 1) {
      while (keep.length && xs[n - 1] - xs[keep[keep.length - 1]] < gap) keep.pop();
      keep.push(n - 1);
    }
    return keep;
  }

  /* One chart. dates: every pull in this view, oldest first. series:
     [{ label, cls, points: [{ pulled_at, value, gap_before }] }]. */
  function lineChart(o) {
    var W = Math.max(240, Math.round(o.width || PLOT_W)), H = o.height, L = 44, R = 16, T = 12, B = o.axis ? 30 : 12;
    var dates = o.dates, n = dates.length;
    var ts = dates.map(function (iso) { return Date.parse(iso || ""); });
    var timed = n > 1 && ts.every(isFinite) && Math.max.apply(null, ts) > Math.min.apply(null, ts);
    var t0 = timed ? Math.min.apply(null, ts) : 0, t1 = timed ? Math.max.apply(null, ts) : 0;
    function xAt(i) {
      if (n < 2) return L + (W - L - R) / 2;
      return timed ? L + ((ts[i] - t0) * (W - L - R)) / (t1 - t0) : L + (i * (W - L - R)) / (n - 1);
    }
    var index = {};
    dates.forEach(function (iso, i) { if (!(iso in index)) index[iso] = i; });
    function y(v) { return T + ((o.hi - v) * (H - T - B)) / (o.hi - o.lo); }
    /* Both credit stylesheets pin `.chart text` to 11px. That hatch was for
       the old chart, whose drawing was scaled to the card. This one is drawn
       at the card's real width, so a label takes the 13px caption floor
       (UI-STANDARDS §3) on its tspan, the same on both pages. */
    function label(x, yy, words, anchor) {
      return '<text class="chart-label" x="' + x + '" y="' + yy + '"' + (anchor ? ' text-anchor="' + anchor + '"' : "") +
        '><tspan font-size="13">' + esc(words) + '</tspan></text>';
    }

    var svg = '<svg class="chart' + (o.cls ? " " + o.cls : "") + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W +
      '" height="' + H + '" role="img" aria-label="' + esc(o.aria) + '">';
    o.ticks.forEach(function (v) {
      svg += '<line class="chart-base" x1="' + L + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(v).toFixed(1) + '"></line>' +
        label(0, (y(v) + 4).toFixed(1), o.fmt(v));
    });
    var xs = dates.map(function (_, i) { return xAt(i); });
    if (o.axis) {
      var years = {};
      dates.forEach(function (iso) { years[String(iso || "").slice(0, 4)] = true; });
      var multiYear = Object.keys(years).length > 1;
      xs.forEach(function (x) {
        svg += '<line class="chart-base" x1="' + x.toFixed(1) + '" y1="' + (H - B) + '" x2="' + x.toFixed(1) + '" y2="' + (H - B + 4) + '"></line>';
      });
      labelled(xs, 56).forEach(function (i) {
        var anchor = xs[i] - L < 24 ? "start" : W - R - xs[i] < 24 ? "end" : "middle";
        svg += label(xs[i].toFixed(1), H - 8, axisDay(dates[i], multiYear), anchor);
      });
    }
    o.series.forEach(function (s) {
      var runs = [], run = [];
      list(s.points).forEach(function (p) {
        if (!isNum(p.value) || !(p.pulled_at in index)) return;
        var q = [xs[index[p.pulled_at]], y(Math.max(o.lo, Math.min(o.hi, p.value))), p];
        if (p.gap_before && run.length) { runs.push(run); run = []; }
        run.push(q);
      });
      if (run.length) runs.push(run);
      runs.forEach(function (r) {
        if (r.length < 2) return;
        svg += '<polyline class="line ' + s.cls + '" points="' +
          r.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ") + '"></polyline>';
      });
      runs.forEach(function (r) {
        r.forEach(function (q) {
          svg += '<circle class="dot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.5"><title>' +
            esc(s.label + " " + o.fmt(q[2].value) + " on " + day(q[2].pulled_at)) + '</title></circle>';
        });
      });
    });
    return svg + '</svg>';
  }

  function legendOf(series) {
    return '<p class="legend caption">' + series.map(function (s, i) {
      return '<span><span class="' + KEY_CLS[i % KEY_CLS.length] + '"></span>' + esc(s.label) + '</span>';
    }).join("") + '</p>';
  }

  function anyGap(series) {
    return series.some(function (s) { return list(s.points).some(function (p) { return p.gap_before === true; }); });
  }

  function anySample(series) {
    return series.some(function (s) { return list(s.points).some(function (p) { return p.sample === true; }); });
  }

  function spanCaption(dates, one, many) {
    return dates.length + " " + (dates.length === 1 ? one : many) + " · " + day(dates[0]) + " to " + day(dates[dates.length - 1]);
  }

  /* The sample note is left off when the page's own Sample banner is up:
     that banner already says the file is a sample. */
  function notes(series, d) {
    return (anyGap(series)
      ? '<p class="caption">A break in a line means a month with no pull, or a pull that did not have that score.</p>' : "") +
      (anySample(series) && !(d && d.sample === true)
        ? '<p class="caption">Some points came from a sample report, not a real bureau pull.</p>' : "");
  }

  function personalBody(d, p, width) {
    var dates = list(p.pulls).map(function (x) { return x.pulled_at; });
    if (dates.length < 2) {
      if (dates.length === 1) {
        return '<p class="caption">One pull so far, on ' + esc(day(dates[0])) + '. The lines start with your next pull.</p>';
      }
      return '<p class="caption">' + (d && d.has_pull
        ? "One pull so far. The lines start with your next pull."
        : "No credit pulls are saved yet. Your score lines show up here after your first pull.") + '</p>';
    }
    var series = BUREAUS.map(function (b, i) {
      var s = list(p.series).filter(function (x) { return x && x.bureau === b.key; })[0] || {};
      return {
        label: b.label, cls: LINE_CLS[i],
        points: list(s.points).map(function (q) { return { pulled_at: q.pulled_at, value: q.score, gap_before: q.gap_before, sample: q.sample }; })
      };
    });
    var vals = [];
    series.forEach(function (s) { s.points.forEach(function (q) { if (isNum(q.value)) vals.push(q.value); }); });
    if (!vals.length) return '<p class="caption">No scores on these pulls.</p>';
    var lo = Math.max(FICO_MIN, Math.floor((Math.min.apply(null, vals) - 20) / 10) * 10);
    var hi = Math.min(FICO_MAX, Math.ceil((Math.max.apply(null, vals) + 20) / 10) * 10);
    if (hi <= lo) hi = lo + 10;
    var mid = Math.round((lo + hi) / 20) * 10;
    var html = lineChart({
      dates: dates, series: series, lo: lo, hi: hi, ticks: mid > lo && mid < hi ? [hi, mid, lo] : [hi, lo],
      fmt: function (v) { return String(v); }, width: width, height: 220, axis: true, aria: "Scores at each pull"
    }) + legendOf(series) + '<p class="caption">' + esc(spanCaption(dates, "pull", "pulls")) + '</p>';

    /* Cards used at each pull, on the same dates, when the pulls carry it.
       The 30% gridline is where the server's "good" band ends
       (UTILISATION_BANDS, src/http/client-detail.mjs; USE_WORDS above). */
    var use = list(p.usage).map(function (q) {
      return { pulled_at: q.pulled_at, value: q.percent, gap_before: q.gap_before, sample: q.sample, partial: q.partial };
    }).filter(function (q) { return isNum(q.value); });
    if (use.length) {
      var top = Math.max(100, Math.ceil(Math.max.apply(null, use.map(function (q) { return q.value; })) / 10) * 10);
      html += '<h3 class="use-title caption">Cards used at each pull</h3>' + lineChart({
        dates: dates, series: [{ label: "Cards used", cls: LINE_CLS[0], points: use }], lo: 0, hi: top,
        ticks: [top, 30, 0], fmt: pct, width: width, height: 132, axis: true, cls: "chart-use",
        aria: "Share of card limits used at each pull"
      }) + (use.some(function (q) { return q.partial === true; })
        ? '<p class="caption">Some cards on those pulls had no limit on file.</p>' : "");
    }
    return html + notes(series, d);
  }

  function businessBody(d, biz, label, width) {
    var dates = list(biz.reports).map(function (r) { return r.pulled_at; });
    var series = list(biz.series).map(function (s, i) {
      return {
        label: fieldLabel(s.field), cls: LINE_CLS[i % LINE_CLS.length],
        points: list(s.points).map(function (q) { return { pulled_at: q.pulled_at, value: q.score, gap_before: q.gap_before, sample: q.sample }; })
      };
    });
    if (biz.has_report !== true || !dates.length) {
      return '<p class="caption">No business credit report is saved for ' + esc(label) + ' yet.</p>';
    }
    if (dates.length === 1) {
      var said = series.map(function (s) {
        var q = s.points[0];
        return q && isNum(q.value) ? s.label + " " + q.value : null;
      }).filter(Boolean);
      return '<p class="caption">One report so far, on ' + esc(day(dates[0])) +
        (said.length ? ": " + esc(said.join(", ")) : "") + '. The lines start with the next report.</p>';
    }
    if (!series.length) {
      return '<p class="caption">The saved reports for ' + esc(label) + ' have no business score on them.</p>';
    }
    return lineChart({
      dates: dates, series: series, lo: 0, hi: 100, ticks: [100, 50, 0],
      fmt: function (v) { return String(v); }, width: width, height: 220, axis: true,
      aria: "Business scores for " + label + " at each report"
    }) + legendOf(series) + '<p class="caption">' + esc(spanCaption(dates, "report", "reports")) +
      ' · Experian business scores run 1 to 100.</p>' + notes(series, d);
  }

  /* opts: { view: "personal" | "biz:<n>", width } */
  function renderHistory(d, opts) {
    opts = opts || {};
    var hist = historyOf(d);
    var bizs = hist.businesses;
    var view = String(opts.view || "personal");
    var n = /^biz:(\d+)$/.exec(view) ? Number(view.slice(4)) : -1;
    if (!(n >= 0 && n < bizs.length)) { view = "personal"; n = -1; }

    /* The business picker is a native select: the Astra client sheet gives
       every client select a 48px height on both pages, and a select never
       scrolls sideways on a 390px phone, however long a business name is. */
    var pick = "";
    if (bizs.length) {
      var all = [{ view: "personal", label: "Personal" }].concat(bizs.map(function (b, i) {
        return { view: "biz:" + i, label: bizLabel(b, bizs) };
      }));
      pick = '<label class="hist-pick"><span class="caption">Show credit for</span> <select data-hist-pick aria-controls="hist-panel">' +
        all.map(function (t) {
          return '<option value="' + esc(t.view) + '"' + (t.view === view ? " selected" : "") + '>' + esc(t.label) + '</option>';
        }).join("") + '</select></label>';
    }

    var body = n >= 0
      ? businessBody(d, bizs[n], bizLabel(bizs[n], bizs), opts.width)
      : personalBody(d, hist.personal, opts.width);
    var sub = n >= 0
      ? "Each score on the saved Experian business reports for " + bizLabel(bizs[n], bizs) + "."
      : "One line for each bureau, one point for each saved credit pull.";
    return '<section class="card hist" aria-labelledby="c-hist" data-hist><h2 class="eyebrow" id="c-hist">Credit over time</h2>' +
      pick + '<div class="hist-body" id="hist-panel" data-hist-plot><p class="caption hist-sub">' + esc(sub) + '</p>' +
      body + '</div></section>';
  }

  /* The lender's own logo (bank-logo.js), matched by its bank name only, else
     nothing (owner rule 2026-11-07). */
  function lenderLogo(a) {
    var L = root.FHBankLogo;
    return L && a ? L.html(a.logo, a.lender) : "";
  }

  function renderAccounts(d) {
    var rows = list(d.accounts && d.accounts.list);
    var head = '<section class="card block acct-card" aria-labelledby="c-acct"><h2 class="eyebrow" id="c-acct">Accounts on your credit report</h2>';
    if (!rows.length) {
      return head + '<p class="caption">No accounts on file yet.</p></section>';
    }
    /* data-label names each value, so a card too narrow for seven columns can stack each
       account (money-credit-ios.css, QA24): the lender, then its type and balance, then the rest. */
    var body = rows.map(function (a) {
      var used = (isNum(a.balance_cents) && isNum(a.limit_cents) && a.limit_cents > 0 && a.kind !== "installment")
        ? (a.balance_cents / a.limit_cents) * 100 : null;
      return '<tr><td class="acct-lender">' + lenderLogo(a) + esc(a.lender || "—") + (a.last4 ? ' <span class="caption">••' + esc(a.last4) + '</span>' : "") + '</td>' +
        '<td data-label="Type">' + esc(KIND_WORDS[a.kind] || "—") + '</td>' +
        '<td class="r num" data-label="Balance">' + esc(money(a.balance_cents)) + '</td>' +
        '<td class="r num" data-label="Limit or loan">' + esc(money(a.limit_cents)) + '</td>' +
        '<td class="r" data-label="Used">' + (isNum(used) ? '<span class="num">' + esc(pct(used)) + '</span>' + usedBar(used) : '<span class="caption">—</span>') + '</td>' +
        '<td data-label="Opened">' + esc(day(a.opened_on)) + '</td>' +
        '<td data-label="Status">' + (a.open ? "Open" : "Closed") + '</td></tr>';
    }).join("");
    return head + '<div class="scroll-x"><table class="acct-table"><thead><tr><th>Lender</th><th>Type</th>' +
      '<th class="r">Balance</th><th class="r">Limit or loan</th><th class="r">Used</th><th>Opened</th><th>Status</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  /* ── whole states ──────────────────────────────────────────────────────── */

  function isEmpty(d) {
    return !d || (d.has_pull !== true && !isNum(d.business && d.business.intelliscore));
  }

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    var asOf = d ? stamp(d.as_of) : "";
    return '<div class="head"><div><h1>Credit</h1><p class="caption">' +
      esc([who, asOf ? "as of " + asOf : ""].filter(Boolean).join(" · ") || "Your scores and what moves them") +
      '</p></div></div>';
  }

  function renderFull(d, opts) {
    return renderSample(d) + renderHead(d) + renderScores(d) + renderFacts(d) +
      '<div class="grid two">' + renderSays(d) + renderHistory(d, opts) + '</div>' +
      renderAccounts(d);
  }

  function renderEmpty(d, setupHref) {
    return renderHead(d) +
      '<section class="card empty"><h2>No credit pull yet</h2>' +
      '<p>Your scores show up here after a soft pull. A soft pull does not hurt your credit. ' +
      'Fundhub only reads your file. It never moves money.</p>' +
      '<a class="btn-primary" href="' + esc(setupHref || SETUP_PATH) + '">Set up a soft pull</a></section>';
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h1>Credit</h1><p class="caption">Loading your credit…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + tile + '</div>' +
      '<div class="grid tiles">' + tile + tile + tile + tile + '</div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your credit. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this credit page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose credit to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Credit</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your credit page</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function render(d, setupHref, opts) { return isEmpty(d) ? renderEmpty(d, setupHref) : renderFull(d, opts); }

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

  /* Same split money.js makes. */
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

  /* Staff open this page with ?client_id=; every money link keeps it. The
     query goes before any #tab, so /app/financeos.html#setup keeps its tab. */
  function withClient(href, cidIn) {
    var cid = cidIn === undefined ? param("client_id") : cidIn;
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  /* ── the section ───────────────────────────────────────────────────────────
     window.FinanceOS.sections.credit.mount(el, ctx) — the one-page FinanceOS
     (/app/financeos.html) mounts this into its Credit tab. No header, no nav:
     only the section. ctx = { clientId, apiGet(path), apiPost(path, body) };
     apiGet resolves to { status, body }. Any of them may be left out, and the
     section then uses its own fetch and ?client_id= from the URL.
     Returns { reload } so the host can refresh it. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : function (p) { return call(p); };
    var cid = ctx.clientId || param("client_id") || "";

    /* The Credit over time card: whose credit it shows, and the width it was
       last drawn at. Only that card is redrawn when either changes. */
    var data = null, view = "personal", plotW = 0;

    function paint(html) { el.innerHTML = html; }

    function opts() { return { view: view, width: plotW || PLOT_W }; }

    /* Redraw the card. A picker that had focus keeps it, so a keyboard or
       screen-reader user is never dropped back to the top of the page. */
    function paintHistory() {
      var card = el.querySelector ? el.querySelector("[data-hist]") : null;
      if (!card || !data) return;
      var doc = root.document;
      var had = !!(doc && doc.activeElement && doc.activeElement.hasAttribute &&
        doc.activeElement.hasAttribute("data-hist-pick") && card.contains(doc.activeElement));
      card.outerHTML = renderHistory(data, opts());
      if (had) {
        var pick = el.querySelector("[data-hist-pick]");
        if (pick && pick.focus) pick.focus();
      }
    }

    /* Draw at the card's real width, so one unit is one pixel. */
    function fit() {
      var box = el.querySelector ? el.querySelector("[data-hist-plot]") : null;
      var w = box ? Math.round(box.clientWidth || 0) : 0;
      if (w > 0 && Math.abs(w - plotW) >= 2) { plotW = w; paintHistory(); }
    }

    var queued = false;
    function refit() {
      if (queued) return;
      queued = true;
      var later = root.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      later(function () { queued = false; fit(); });
    }

    function load() {
      paint(renderLoading());
      return Promise.resolve(get(READ_PATH + (cid ? "?client_id=" + encodeURIComponent(cid) : ""))).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { data = null; paint(renderError(kind)); return; }
        data = res.body;
        paint(render(res.body, withClient(SETUP_PATH, cid), opts()));
        fit();
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (t && (!el.contains || el.contains(t)) && t.getAttribute("data-act") === "retry") load();
    });

    /* The business picker. Reading another view sends nothing. */
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.hasAttribute || !t.hasAttribute("data-hist-pick")) return;
      view = t.value || "personal";
      paintHistory();
      fit();
    });

    /* A FinanceOS tab can open, or a phone can turn, after the first draw.
       The redraw waits a frame so it never runs inside the resize callback. */
    if (typeof root.ResizeObserver === "function") {
      try { new root.ResizeObserver(refit).observe(el); } catch (e) { /* the window listener below still works */ }
    }
    if (root.addEventListener) root.addEventListener("resize", refit);

    load();
    return { reload: load };
  }

  /* ── the standalone page (/app/money-credit.html) — a thin shell ───────── */
  function init() {
    var el = root.document.getElementById("credit-root");
    if (!el) return;
    var links = root.document.querySelectorAll(".mnav a");
    for (var i = 0; i < links.length; i++) links[i].setAttribute("href", withClient(links[i].getAttribute("href")));
    var back = root.document.getElementById("money-back");
    if (back && param("client_id")) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(param("client_id")));
      back.textContent = "Back to Finance OS";
    }
    mount(el, { clientId: param("client_id") });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.credit = { title: "Credit", mount: mount };

  root.FHMoneyCredit = {
    money: money, day: day, pct: pct, ficoBand: ficoBand, bizBand: bizBand, isEmpty: isEmpty,
    render: render, renderFull: renderFull, renderHistory: renderHistory, renderEmpty: renderEmpty, renderError: renderError,
    renderLoading: renderLoading, classify: classify, mount: mount
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
