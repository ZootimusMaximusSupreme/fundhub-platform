/* Fundability — the client's fundability now, later, and per business
 * (/app/money-fundability.html, FinanceOS wave 5 unit W3).
 *
 * Reads ONE endpoint, GET /api/money/fundability, and paints it. Every number is
 * a field from that read; nothing here invents one. How the score is counted is
 * written at the top of src/finance/fundability.mjs: it is how many of
 * UnderwriteIQ's own checks pass, out of six.
 *
 * THE HONESTY RULES (same as money.js and money-credit.js):
 *   - A null is "we do not have this number" and paints "—", never 0.
 *   - UnderwriteIQ's sentences are printed exactly as the server sent them.
 *   - A pass, a miss and an unknown are said in WORDS, with a shape beside them
 *     — never by colour alone (UI-STANDARDS §12.6).
 *   - The two lines differ by dash and by dot shape, and the legend says which
 *     is which in words. The "if removed" line always says it is not promised.
 *   - Businesses are listed one by one. Nothing adds them up.
 *
 * The chart is plain inline SVG for the lines only. Every word on it (axis
 * labels, the point details) is HTML, so the type stays on the four brand sizes
 * with no px escape hatch (UI-STANDARDS §12.7) and stays readable at 375px.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-fundability-screen.test.mjs can run them in Node against the
 * real read of the sample client. mount() and initPage() are the only parts
 * that need a browser. This file is the Fundability section of the one-page
 * /app/financeos.html (window.FinanceOS.sections.fundability);
 * money-fundability.html is a thin shell. Styles: money-fundability.css, every
 * rule under .fh-fundability.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/fundability";
  var SETUP_PATH = "/app/financeos.html#setup";
  var ACCOUNTS_PATH = "/app/financeos.html#accounts";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var TIER_WORDS = { fundable: "Fundable", not_fundable: "Not fundable yet" };
  var LINE_WORDS = { plan: "Your plan", if_removed: "If removed" };
  var MISSING_WORDS = {
    credit_pull: "a credit pull",
    experian_score: "an Experian score",
    equifax_score: "an Equifax score",
    transunion_score: "a TransUnion score",
    inquiries: "hard inquiry counts",
    utilization: "card use",
    negative_items: "the negative item count",
    late_payments: "the late payment count",
    accounts: "your accounts",
    opened_dates: "some account open dates",
    business_age: "the business start date"
  };
  /* Which check an engine sentence moves (the server sends the key). */
  var CHECK_WORDS = {
    score_700: "Credit score 700 or higher",
    utilization_30: "Cards used 30% or less",
    no_negatives: "No negative items",
    anchor_card: "A card 2+ years old with a $5,000+ limit",
    no_inquiries: "No hard inquiries",
    file_depth: "3 or more accounts in good standing"
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

  /* cents → "$212,000". Whole dollars: a first-look estimate reads that way. */
  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var dollars = String(Math.round(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "−$" : "$") + dollars;
  }

  /* "2027-01-07" → "Jan 7, 2027", read off the calendar date. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }
  /* "2027-01-07" → "Jan 2027". */
  function monthYear(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "—";
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

  function scoreText(p) {
    if (!p || !isNum(p.score)) return "—";
    return p.score + " of " + (isNum(p.score_max) ? p.score_max : 6);
  }
  function tierWord(t) { return TIER_WORDS[t] || "Can't tell yet"; }

  /* A check's status, in words and a shape. Never colour alone. */
  function statusOf(passed) {
    if (passed === true) return { word: "Pass", mark: "✓", cls: "is-pass" };
    if (passed === false) return { word: "Not yet", mark: "✗", cls: "is-miss" };
    return { word: "Not on file", mark: "?", cls: "is-unknown" };
  }

  function valueText(f) {
    var v = f && f.value;
    if (v === null || v === undefined || v === "") return "not on file";
    switch (f.unit) {
      case "percent": return (Math.round(v * 10) / 10) + "%";
      case "cents": return money(v);
      case "months": return plural(v, "month", "months");
      case "tier": return tierWord(v);
      default: return String(v);
    }
  }

  function missingText(keys) {
    var words = list(keys).map(function (k) { return MISSING_WORDS[k] || k; });
    if (!words.length) return "";
    if (words.length === 1) return words[0];
    return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
  }

  function planPoints(d, kind) {
    return list(d && d.projections).filter(function (p) { return p && p.scenario === kind; })
      .sort(function (a, b) { return a.months - b.months; });
  }
  function lastOf(arr) { return arr.length ? arr[arr.length - 1] : null; }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderSample(d) {
    if (!d || d.sample !== true) return "";
    return '<div class="fd-sample" role="note"><strong>Sample report</strong>' +
      '<span>These numbers come from a sample credit report, not a real bureau pull.</span></div>';
  }

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    var asOf = d ? stamp(d.as_of) : "";
    return '<div class="fd-head"><div><h1>Fundability</h1><p class="caption">' +
      esc([who, asOf ? "as of " + asOf : ""].filter(Boolean).join(" · ") ||
        "How ready your file is for funding, now and later") + '</p></div></div>';
  }

  function renderNowTile(d) {
    var n = d.now || {};
    var later = lastOf(planPoints(d, "plan"));
    var fails = list(n.factors).filter(function (f) { return f.passed === false; }).length;
    var parts = ["UnderwriteIQ checks passed"];
    if (fails) parts.push(plural(fails, "not yet", "not yet"));
    if (n.unknown) parts.push(n.unknown + " not on file");
    return '<section class="card fd-tile" aria-labelledby="fd-t-now">' +
      '<h2 class="eyebrow" id="fd-t-now">Fundability now</h2>' +
      '<span class="big">' + esc(scoreText(n)) + '</span>' +
      '<p class="fd-tier">' + esc(tierWord(n.tier)) + '</p>' +
      '<p class="caption">' + esc(parts.join(" · ")) + '</p>' +
      (later ? '<p class="caption">In ' + esc(later.months) + ' months on your plan: ' + esc(scoreText(later)) + '</p>' : "") +
      '</section>';
  }

  function renderFundingTile(d) {
    var n = d.now || {};
    var later = lastOf(planPoints(d, "plan"));
    var why;
    if (isNum(n.funding_estimate_cents)) {
      why = "UnderwriteIQ's first look, not a bank's yes. It comes from your best card and your best loan.";
    } else if (n.tier === "not_fundable") {
      why = "Shows up once your file is fundable. Your personal file comes first.";
    } else {
      var miss = missingText(n.missing);
      why = miss ? "Not on file yet: " + miss + "." : "UnderwriteIQ cannot work this out yet.";
    }
    return '<section class="card fd-tile" aria-labelledby="fd-t-money">' +
      '<h2 class="eyebrow" id="fd-t-money">Funding estimate</h2>' +
      '<span class="big">' + esc(money(n.funding_estimate_cents)) + '</span>' +
      '<p class="caption">' + esc(why) + '</p>' +
      (later ? '<p class="caption">In ' + esc(later.months) + ' months on your plan: ' + esc(money(later.funding_estimate_cents)) + '</p>' : "") +
      '</section>';
  }

  function renderLaterTile(d) {
    var later = lastOf(planPoints(d, "plan"));
    var removed = lastOf(planPoints(d, "if_removed"));
    if (!later) {
      return '<section class="card fd-tile" aria-labelledby="fd-t-later">' +
        '<h2 class="eyebrow" id="fd-t-later">Later</h2><span class="big">—</span>' +
        '<p class="caption">Nothing to look ahead on yet.</p></section>';
    }
    return '<section class="card fd-tile" aria-labelledby="fd-t-later">' +
      '<h2 class="eyebrow" id="fd-t-later">In ' + esc(later.months) + ' months</h2>' +
      '<span class="big">' + esc(scoreText(later)) + '</span>' +
      '<p class="fd-tier">' + esc(tierWord(later.tier)) + '</p>' +
      '<p class="caption">On your plan, by ' + esc(day(later.date)) + '</p>' +
      (removed ? '<p class="caption">If removed: ' + esc(scoreText(removed)) + ' · ' + esc(tierWord(removed.tier)) + '</p>' : "") +
      '</section>';
  }

  function factorRow(f) {
    var s = statusOf(f.passed);
    var bits = ["Now " + valueText(f), "needs " + (f.target || "—")];
    return '<li class="fd-factor ' + s.cls + '">' +
      '<span class="fd-mark" aria-hidden="true">' + s.mark + '</span>' +
      '<span class="fd-factor-main"><span class="fd-factor-label">' + esc(f.label) + '</span>' +
      '<span class="caption">' + esc(bits.join(" · ")) + '</span>' +
      (f.note ? '<span class="caption">' + esc(f.note) + '</span>' : "") + '</span>' +
      '<span class="fd-status">' + esc(s.word) + '</span></li>';
  }

  function renderDrivers(d) {
    var rows = list(d.now && d.now.factors).map(factorRow).join("");
    return '<section class="card" aria-labelledby="fd-drive"><h2 class="eyebrow" id="fd-drive">What drives it</h2>' +
      '<ul class="fd-factors">' + rows + '</ul>' +
      '<p class="caption">Each check counts the same. The score is how many pass.</p></section>';
  }

  /* ── the chart ─────────────────────────────────────────────────────────── */

  /* Columns: today, then each projected date. Each column holds the plan point
     and, when there is one, the "if removed" point. Today is shared. */
  function chartModel(d) {
    var n = d.now || {};
    var today = {
      date: String(d.as_of || "").slice(0, 10), months: 0, scenario: "now",
      score: n.score, score_max: n.score_max, unknown: n.unknown, tier: n.tier,
      funding_estimate_cents: n.funding_estimate_cents, assumptions: []
    };
    var plan = planPoints(d, "plan");
    var removed = planPoints(d, "if_removed");
    var cols = [{ months: 0, date: today.date, plan: today, ifr: removed.length ? today : null }];
    plan.forEach(function (p) {
      var r = null;
      removed.forEach(function (q) { if (q.months === p.months) r = q; });
      cols.push({ months: p.months, date: p.date, plan: p, ifr: r });
    });
    var span = cols.length > 1 ? cols[cols.length - 1].months : 1;
    var max = isNum(n.score_max) && n.score_max > 0 ? n.score_max : 6;
    return { cols: cols, span: span || 1, max: max, hasIfr: removed.length > 0 };
  }

  function xPct(m, col) { return Math.round((col.months / m.span) * 1000) / 10; }
  function yPct(m, p) { return p && isNum(p.score) ? Math.round(((m.max - p.score) / m.max) * 1000) / 10 : null; }

  function polyline(m, key, cls) {
    var pts = [];
    m.cols.forEach(function (c) {
      var y = yPct(m, c[key]);
      if (y !== null && c[key]) pts.push(xPct(m, c) + "," + y);
    });
    if (pts.length < 2) return "";
    return '<polyline class="' + cls + '" points="' + pts.join(" ") + '" vector-effect="non-scaling-stroke"></polyline>';
  }

  function dots(m, key, cls) {
    return m.cols.map(function (c) {
      var y = yPct(m, c[key]);
      if (y === null || !c[key]) return "";
      return '<span class="fd-dot ' + cls + '" style="left:' + xPct(m, c) + '%;top:' + y + '%" aria-hidden="true"></span>';
    }).join("");
  }

  function colLabel(c, i) {
    return i === 0 ? "Today" : monthYear(c.date);
  }
  /* The phone label: "+3 mo" fits where "Jan 2027" would run into "Today". */
  function shortLabel(c, i) {
    return i === 0 ? "Today" : "+" + c.months + " mo";
  }

  function colAria(m, c, i) {
    var bits = [i === 0 ? "Today" : day(c.date) + ", in " + c.months + " months"];
    bits.push("your plan " + scoreText(c.plan) + ", " + tierWord(c.plan && c.plan.tier));
    if (c.ifr && i > 0) bits.push("if removed " + scoreText(c.ifr));
    return bits.join(" — ");
  }

  function seriesRow(label, keyCls, p, isToday) {
    var assume = isToday
      ? '<p class="caption">Your file as it is today. No guesses.</p>'
      : '<ul class="fd-assume">' + list(p.assumptions).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join("") + '</ul>';
    return '<div class="fd-series">' +
      '<p class="fd-series-head"><span class="fd-key ' + keyCls + '" aria-hidden="true"></span>' + esc(label) + '</p>' +
      '<p><span class="num">' + esc(scoreText(p)) + '</span> · ' + esc(tierWord(p.tier)) +
      ' · Estimate <span class="num">' + esc(money(p.funding_estimate_cents)) + '</span></p>' +
      assume + '</div>';
  }

  /* The details under the chart for one column — what a hover or a tap shows. */
  function renderDetail(d, i) {
    var m = chartModel(d);
    var c = m.cols[i];
    if (!c) return "";
    var head = i === 0 ? "Today" : day(c.date) + " · in " + c.months + " months";
    return '<p class="fd-detail-head">' + esc(head) + '</p>' +
      seriesRow(LINE_WORDS.plan, "fd-key-plan", c.plan, i === 0) +
      (c.ifr && i > 0 ? seriesRow(LINE_WORDS.if_removed, "fd-key-ifr", c.ifr, false) : "");
  }

  function planSummary(d) {
    var plan = (d && d.plan) || {};
    var pays = list(plan.paydowns).length;
    var bits = [];
    if (pays) bits.push(plural(pays, "card paydown", "card paydowns"));
    if (plan.dispute_accounts) bits.push("disputes on " + plural(plan.dispute_accounts, "negative account", "negative accounts"));
    if (!bits.length) return "No card paydowns or disputes on file yet, so this line only shows time going by.";
    return "Your plan on file: " + bits.join(" · ") + ".";
  }

  function renderChart(d, selected) {
    var m = chartModel(d);
    var sel = isNum(selected) && selected >= 0 && selected < m.cols.length ? selected : m.cols.length - 1;
    var head = '<section class="card fd-chart-card" aria-labelledby="fd-chart"><h2 class="eyebrow" id="fd-chart">Now and later</h2>';
    if (m.cols.length < 2) {
      return head + '<p class="caption">Nothing to look ahead on yet.</p></section>';
    }
    var mid = Math.round(m.max / 2);
    var yLabels = [m.max, mid, 0].map(function (v) {
      return '<span class="fd-ylabel caption" style="top:' + (Math.round(((m.max - v) / m.max) * 1000) / 10) + '%">' + v + '</span>';
    }).join("");
    var svg = '<svg class="fd-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<line class="fd-grid-line" x1="0" y1="0" x2="100" y2="0" vector-effect="non-scaling-stroke"></line>' +
      '<line class="fd-base" x1="0" y1="100" x2="100" y2="100" vector-effect="non-scaling-stroke"></line>' +
      polyline(m, "plan", "fd-line fd-line-plan") +
      (m.hasIfr ? polyline(m, "ifr", "fd-line fd-line-ifr") : "") +
      '</svg>';
    var cols = m.cols.map(function (c, i) {
      return '<button type="button" class="fd-col" data-col="' + i + '" style="left:' + xPct(m, c) + '%"' +
        ' aria-pressed="' + (i === sel ? "true" : "false") + '" aria-label="' + esc(colAria(m, c, i)) + '"></button>';
    }).join("");
    var xLabels = m.cols.map(function (c, i) {
      var cls = i === 0 ? " is-first" : (i === m.cols.length - 1 ? " is-last" : "");
      return '<span class="fd-xlabel caption' + cls + '" style="left:' + xPct(m, c) + '%">' +
        '<span class="fd-xl-long">' + esc(colLabel(c, i)) + '</span>' +
        '<span class="fd-xl-short">' + esc(shortLabel(c, i)) + '</span></span>';
    }).join("");
    var legend = '<p class="fd-legend caption"><span><span class="fd-key fd-key-plan" aria-hidden="true"></span>Your plan — solid line, filled dots</span>' +
      (m.hasIfr ? '<span><span class="fd-key fd-key-ifr" aria-hidden="true"></span>If removed — dashed line, open dots. Not promised.</span>' : "") +
      '</p>';
    return head + legend +
      '<div class="fd-plot-wrap"><div class="fd-plot">' + yLabels + svg +
      dots(m, "plan", "fd-dot-plan") + (m.hasIfr ? dots(m, "ifr", "fd-dot-ifr") : "") + cols +
      '</div><div class="fd-xaxis">' + xLabels + '</div></div>' +
      '<p class="caption">Score out of ' + esc(m.max) + ' checks. Tap or point at a date to see what it assumes.</p>' +
      '<div class="fd-detail" aria-live="polite">' + renderDetail(d, sel) + '</div>' +
      '<p class="caption">' + esc(planSummary(d)) + '</p></section>';
  }

  /* ── what moves it, what it cannot say ─────────────────────────────────── */

  function renderMoves(d) {
    var rows = list(d.now && d.now.sentences).filter(function (s) { return s && typeof s.text === "string" && s.text; })
      .map(function (s) {
        return '<li><p>' + esc(s.text) + '</p>' +
          (s.check && CHECK_WORDS[s.check] ? '<p class="caption">Moves: ' + esc(CHECK_WORDS[s.check]) + '</p>' : "") + '</li>';
      }).join("");
    return '<section class="card" aria-labelledby="fd-moves"><h2 class="eyebrow" id="fd-moves">What moves it most</h2>' +
      (rows ? '<ol class="fd-moves">' + rows + '</ol><p class="caption">UnderwriteIQ\'s own words, in its own order.</p>'
        : '<p class="caption">UnderwriteIQ has no tips for this file right now.</p>') +
      '</section>';
  }

  function renderCannot(d) {
    var rows = list(d.cannot_project).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("");
    if (!rows) return "";
    return '<section class="card" aria-labelledby="fd-cannot"><h2 class="eyebrow" id="fd-cannot">What this cannot look ahead on</h2>' +
      '<ul class="fd-cannot">' + rows + '</ul></section>';
  }

  /* ── businesses — one card each, never added up ────────────────────────── */

  function bandWord(mult) {
    if (!isNum(mult)) return "—";
    return mult + "× band";
  }

  function bizCard(b, accountsHref) {
    var name = b.name || "Unnamed business";
    var head = '<p class="fd-biz-name" title="' + esc(name) + '">' + esc(name) + '</p>';
    if (!b.has_info || !b.now) {
      return '<section class="card fd-biz" aria-label="' + esc(name) + '">' +
        '<h3 class="eyebrow">Business</h3>' + head +
        '<p>Add this business\'s details to see it here.</p>' +
        '<a class="fd-link" href="' + esc(accountsHref) + '">Add business details</a></section>';
    }
    var n = b.now;
    var why = isNum(n.funding_estimate_cents) ? "UnderwriteIQ's first look for this business."
      : (n.tier === "not_fundable" ? "Shows up once this business can be funded."
        : (missingText(n.missing) ? "Not on file yet: " + missingText(n.missing) + "." : "UnderwriteIQ cannot work this out yet."));
    var factors = list(n.factors).map(factorRow).join("");
    var rows = [{ label: "Today", p: n }].concat(list(b.projections).filter(function (p) { return p.scenario === "plan"; })
      .sort(function (x, y) { return x.months - y.months; })
      .map(function (p) { return { label: monthYear(p.date), p: p }; }))
      .map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td class="r num">' + esc(scoreText(r.p)) + '</td>' +
          '<td class="r">' + esc(bandWord(r.p.multiplier)) + '</td><td class="r num">' + esc(money(r.p.funding_estimate_cents)) + '</td></tr>';
      }).join("");
    var credit = b.credit && isNum(b.credit.intelliscore)
      ? '<p class="caption">Experian business score ' + esc(b.credit.intelliscore) + ' of 100' +
        (b.credit.sample ? " (sample report)" : "") + '. UnderwriteIQ does not use it for this number.</p>'
      : "";
    var says = list(n.sentences).map(function (s) { return '<p class="caption">' + esc(s.text) + '</p>'; }).join("");
    return '<section class="card fd-biz" aria-label="' + esc(name) + '">' +
      '<h3 class="eyebrow">Business</h3>' + head +
      '<span class="big">' + esc(scoreText(n)) + '</span>' +
      '<p class="fd-tier">' + esc(tierWord(n.tier)) + '</p>' +
      '<p class="caption">Estimate ' + esc(money(n.funding_estimate_cents)) + ' · ' + esc(why) + '</p>' +
      '<ul class="fd-factors">' + factors + '</ul>' +
      '<div class="fd-scroll"><table class="fd-mini"><thead><tr><th>When</th><th class="r">Score</th><th class="r">Band</th><th class="r">Estimate</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' + says + credit + '</section>';
  }

  function renderBusinesses(d, accountsHref) {
    var biz = list(d.businesses);
    var head = '<section class="fd-block" aria-labelledby="fd-biz"><h2 id="fd-biz">Your businesses</h2>' +
      '<p class="caption">Each business is read on its own. They are never added together.</p>';
    if (!biz.length) {
      return head + '<div class="card fd-biz-empty"><p>No business on file yet. Add one to see its fundability here.</p>' +
        '<a class="fd-link" href="' + esc(accountsHref || ACCOUNTS_PATH) + '">Add a business</a></div></section>';
    }
    return head + '<div class="fd-grid fd-thirds">' +
      biz.map(function (b) { return bizCard(b, accountsHref || ACCOUNTS_PATH); }).join("") + '</div></section>';
  }

  /* ── whole states ──────────────────────────────────────────────────────── */

  function isEmpty(d) { return !d || d.has_pull !== true; }

  function renderFull(d, links) {
    links = links || {};
    return renderSample(d) + renderHead(d) +
      '<div class="fd-grid fd-thirds">' + renderNowTile(d) + renderFundingTile(d) + renderLaterTile(d) + '</div>' +
      '<div class="fd-grid fd-halves">' + renderChart(d) + renderDrivers(d) + '</div>' +
      '<div class="fd-grid fd-halves">' + renderMoves(d) + renderCannot(d) + '</div>' +
      renderBusinesses(d, links.accounts);
  }

  function renderEmpty(d, links) {
    links = links || {};
    return renderHead(d) +
      '<section class="card fd-empty"><h2>No credit file yet — run your soft pull</h2>' +
      '<p>Your fundability shows up here after a soft pull. A soft pull does not hurt your credit. ' +
      'Fundhub only reads your file. It never moves money.</p>' +
      '<a class="fd-btn-primary" href="' + esc(links.setup || SETUP_PATH) + '">Run your soft pull</a></section>';
  }

  function renderLoading() {
    var tile = '<div class="card fd-tile fd-skel"><span class="fd-sk fd-sk-s"></span><span class="fd-sk fd-sk-l"></span><span class="fd-sk fd-sk-m"></span></div>';
    var block = '<div class="card fd-skel"><span class="fd-sk fd-sk-s"></span><span class="fd-sk fd-sk-chart"></span></div>';
    return '<div class="fd-head"><div><h1>Fundability</h1><p class="caption">Loading your fundability…</p></div></div>' +
      '<div class="fd-grid fd-thirds" aria-busy="true">' + tile + tile + tile + '</div>' +
      '<div class="fd-grid fd-halves">' + block + block + '</div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your fundability. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose fundability to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="fd-head"><div><h1>Fundability</h1></div></div>' +
      '<section class="card fd-error" role="alert"><h2>We could not load your fundability</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="fd-btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function render(d, links) { return isEmpty(d) ? renderEmpty(d, links) : renderFull(d, links); }

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

  /* Same split money-credit.js makes. */
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

  /* Staff carry ?client_id= across the money pages; it goes before any #tab. */
  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.fundability ──────────────────
     mount(el, ctx) paints this section into `el` and wires the chart. No page
     chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }: apiGet
     resolves to { status, body } (or the parsed body alone). Missing api
     functions fall back to this file's own fetch. Returns { reload, unmount }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : call;
    var data = null;
    var links = { setup: withClient(SETUP_PATH, cid), accounts: withClient(ACCOUNTS_PATH, cid) };

    function paint(html) { el.innerHTML = '<div class="fh-fundability">' + html + '</div>'; }

    function select(i) {
      if (!data || !el.querySelector) return;
      var cols = el.querySelectorAll(".fd-col");
      for (var k = 0; k < cols.length; k++) cols[k].setAttribute("aria-pressed", String(k) === String(i) ? "true" : "false");
      var box = el.querySelector(".fd-detail");
      if (box) box.innerHTML = renderDetail(data, Number(i));
    }

    function load() {
      paint(renderLoading());
      return get(READ_PATH + (cid ? "?client_id=" + encodeURIComponent(cid) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") {
          if (typeof ctx.onSignIn === "function") ctx.onSignIn();
          else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind !== "ok") { data = null; paint(renderError(kind)); return; }
        data = res.body;
        paint(render(data, links));
      });
    }

    function colOf(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-col]") : null;
      return t && (!el.contains || el.contains(t)) ? t.getAttribute("data-col") : null;
    }
    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (t && (!el.contains || el.contains(t)) && t.getAttribute("data-act") === "retry") { load(); return; }
      var c = colOf(e);
      if (c !== null) select(c);
    }
    function onPoint(e) {
      var c = colOf(e);
      if (c !== null) select(c);
    }

    el.addEventListener("click", onClick);
    el.addEventListener("mouseover", onPoint);
    el.addEventListener("focusin", onPoint);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("mouseover", onPoint);
        el.removeEventListener("focusin", onPoint);
        el.innerHTML = "";
      }
    };
  }

  /* ── the standalone page (/app/money-fundability.html) — a thin shell ──── */
  function initPage() {
    var el = root.document.getElementById("fundability-root");
    if (!el) return;
    var cid = param("client_id");
    var links = root.document.querySelectorAll(".mnav a");
    for (var i = 0; i < links.length; i++) links[i].setAttribute("href", withClient(links[i].getAttribute("href"), cid));
    /* On a phone the nav scrolls inside itself; start it at this page's tab so
       "where am I" is on screen, not cut off at the right edge. */
    var nav = root.document.querySelector(".mnav");
    var cur = nav && nav.querySelector('[aria-current="page"]');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - nav.offsetLeft - 16);
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.fundability = { title: "Fundability", mount: mount };

  root.FHMoneyFundability = {
    money: money, day: day, scoreText: scoreText, tierWord: tierWord, statusOf: statusOf,
    chartModel: chartModel, renderChart: renderChart, renderDetail: renderDetail,
    isEmpty: isEmpty, render: render, renderFull: renderFull, renderEmpty: renderEmpty,
    renderError: renderError, renderLoading: renderLoading, classify: classify,
    withClient: withClient, mount: mount
  };

  /* Auto-start only finds #fundability-root on the standalone page. The
     combined FinanceOS page calls FinanceOS.sections.fundability.mount(). */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
