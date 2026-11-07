/* Finance OS + Blueprint premium pass (unit PREM, 2026-11-07).
 * Board: ops/workflows/finance-os-cfo-build-2026-11-06.txt. Wireframe: the
 * approved demo ops/workflows/finance-os-cfo-demo-2026-11-06.html (chart(),
 * monoPath(), bars(), spark()).
 *
 * WHAT THIS FILE ADDS — nothing here computes a money or credit number:
 *   - Hero "Funding you qualify for" (counts up) with a fundability ring.
 *     Dollars: GET /api/money/fundability `opportunity.personal` — the same
 *     UnderwriteIQ figure the Blueprint path shows. Ring: its `now` N of 6.
 *   - Advisor card: the CSM on the file (GET /api/money/ready-to-fund
 *     `advisor`) with "Book a call" on the owner-set booking page (`book_url`).
 *   - Repair and Funding cards: one status line each from the existing
 *     fulfillment reads (/api/blueprint/repair, /letter-mailing, /funding),
 *     opening the existing views in the client portal. No new route.
 *   - Monthly report: GET /api/money/overview?report=monthly → PDF.
 *   - Smooth charts: monotone curves, soft fill, weekly sparklines, score
 *     bands, money in/out bars — the demo's look on the real charts.
 *   - Calm motion: charts draw in, numbers count up. Nothing moves when the
 *     person asked their device for reduced motion.
 *
 * Where it shows:
 *   /app/financeos.html   window.FinanceOS.premium.mount(slots, ctx) — money.js
 *                         calls it after the Overview paints.
 *   /app/client-portal.html  the Blueprint home: cards added beside the
 *                         journey summary each time it paints; #repair and
 *                         #funding open those views.
 *   /progress.html        [data-fh-premium="work"]: the Repair and Funding cards.
 *
 * The other units' charts (money-trends.js, money-credit.js) are not edited:
 * smoothCharts() adds a curve over each line they drew and hides the straight
 * one, keeping their markup, data and tests as they are.
 *
 * Pure helpers are exported on window.FHPremium so
 * src/http/money-premium-screen.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  /* FinanceOS chart inks — the same literal colours money-trends.js uses, so a
     one-hue tenant brand cannot wash two lines into one. */
  var INK = { s0: "#18181B", s1: "#2563EB", s2: "#C2410C", s3: "#0D9488" };
  /* FICO's own published ranges (money-credit.js FICO_BANDS), drawn behind a
     score line. A presentation band over the bureau's number, never a model. */
  var SCORE_BANDS = [
    { lo: 580, hi: 669, word: "Fair", color: "#F5CE8F" },
    { lo: 670, hi: 739, word: "Good", color: "#A9C6E8" },
    { lo: 740, hi: 799, word: "Very good", color: "#A8D8B0" },
    { lo: 800, hi: 850, word: "Exceptional", color: "#C4B3E5" }
  ];
  var SVGNS = "http://www.w3.org/2000/svg";
  var uid = 0;

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function isCents(v) { return Number.isSafeInteger(v) && v >= 0; }

  /* cents → "$93,600" — the Blueprint's own format (blueprint-journey.js money()). */
  function usd0(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var s = "$" + String(Math.round(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return neg ? "-" + s : s;
  }
  /* cents → "$1,234.56" — money.js money(), same minus sign. */
  function usd2(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + c;
  }
  /* 12.34 → "12.3%" — money.js pct(). */
  function pct1(v) {
    if (!isNum(v)) return "—";
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
  }
  /* cents → "$4.2k" for an axis. */
  function usdShort(cents) {
    if (!isNum(cents)) return "—";
    var d = Math.abs(cents) / 100;
    var s = d >= 1e6 ? (Math.round(d / 1e5) / 10) + "M" : d >= 1000 ? (Math.round(d / 100) / 10) + "k" : String(Math.round(d));
    return (cents < 0 ? "-$" : "$") + s;
  }
  function formatAs(fmt, v) {
    if (fmt === "usd2") return usd2(v);
    if (fmt === "pct1") return pct1(v);
    if (fmt === "int") return String(Math.round(v));
    return usd0(v);
  }
  /* "2026-11-06…" → "Nov 6" */
  function dayShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) : "";
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "FH";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function safeHttps(u) {
    var s = String(u || "");
    return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : null;
  }

  /* ── charts (the demo's own drawing, pure) ─────────────────────────────── */

  function f1(v) { return v.toFixed(1); }

  /* Monotone cubic through every point (Fritsch–Carlson). It passes through
     each real value and never overshoots between two of them, so a smooth line
     never shows a peak or a dip that was not in the data. */
  function monoPath(P) {
    var n = P.length, i;
    if (!n) return "";
    if (n === 1) return "M" + f1(P[0][0]) + " " + f1(P[0][1]);
    if (n === 2) return "M" + f1(P[0][0]) + " " + f1(P[0][1]) + "L" + f1(P[1][0]) + " " + f1(P[1][1]);
    var dx = [], m = [], t = [];
    for (i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var d = "M" + f1(P[0][0]) + " " + f1(P[0][1]);
    for (i = 0; i < n - 1; i++) {
      var h = dx[i] / 3;
      d += "C" + f1(P[i][0] + h) + " " + f1(P[i][1] + t[i] * h) + " " + f1(P[i + 1][0] - h) + " " + f1(P[i + 1][1] - t[i + 1] * h) +
        " " + f1(P[i + 1][0]) + " " + f1(P[i + 1][1]);
    }
    return d;
  }

  /* Daily values → one point a week, the newest day last. Each point is the
     last saved day of its week; a week with no save is a gap (null). */
  function weekly(values) {
    var v = list(values), out = [];
    for (var end = v.length - 1; end >= 0; end -= 7) {
      var pick = null;
      for (var i = end; i > end - 7 && i >= 0; i--) if (isNum(v[i])) { pick = v[i]; break; }
      out.unshift(pick);
    }
    return out;
  }

  /* A weekly sparkline: soft fill under a smooth line. No line from fewer
     than two saved weeks — nothing is drawn rather than a made-up shape. */
  function sparkSvg(values, opts) {
    var o = opts || {};
    var P = weekly(values);
    var nums = P.filter(isNum);
    if (nums.length < 2) return "";
    var W = 120, H = 32, lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
    if (hi === lo) { hi += 1; lo -= 1; }
    var color = INK[o.cls] || INK.s1;
    var id = "fhs" + (++uid);
    var x = function (j) { return P.length === 1 ? W / 2 : (W * j) / (P.length - 1); };
    var y = function (v) { return 4 + (H - 8) * (1 - (v - lo) / (hi - lo)); };
    var segs = [], cur = [];
    P.forEach(function (v, j) { if (!isNum(v)) { if (cur.length) segs.push(cur); cur = []; return; } cur.push([x(j), y(v)]); });
    if (cur.length) segs.push(cur);
    var body = "";
    segs.forEach(function (seg) {
      if (seg.length < 2) return;
      var d = monoPath(seg);
      body += '<path class="fh-spark-area" d="' + d + "L" + f1(seg[seg.length - 1][0]) + " " + H + "L" + f1(seg[0][0]) + " " + H + 'Z" fill="url(#' + id + ')"></path>' +
        '<path class="fh-spark-line" d="' + d + '" stroke="' + color + '" vector-effect="non-scaling-stroke"></path>';
    });
    return '<svg class="fh-spark" data-fh-reveal viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".2"></stop>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"></stop></linearGradient></defs>' + body + "</svg>";
  }

  /* Money in and out by month: bars that grow from the base line. The axis
     words are HTML under and beside the plot, so they stay readable at 320px.
     A month with no number gets no bar (the table says "—"); a real $0 gets
     a hairline, so the two never look the same. */
  function barsHtml(o) {
    var labels = list(o.labels), n = labels.length;
    var series = list(o.series);
    var hi = 0;
    series.forEach(function (s) { list(s.values).forEach(function (v) { if (isNum(v) && v > hi) hi = v; }); });
    if (!n || !hi) return "";
    hi = hi * 1.1;
    var W = 600, H = 140, band = W / n, group = band * 0.62, bw = group / Math.max(1, series.length);
    var svg = '<svg class="fh-bars-svg" data-fh-grow viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(o.aria || "Money in and out by month") + '" focusable="false">';
    [0, 0.5, 1].forEach(function (q) {
      var yy = f1(H * q);
      svg += '<line class="fh-grid" x1="0" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" vector-effect="non-scaling-stroke"></line>';
    });
    labels.forEach(function (lb, i) {
      series.forEach(function (s, si) {
        var v = list(s.values)[i];
        if (!isNum(v)) return;
        var h = v > 0 ? Math.max(1.5, (H * v) / hi) : 0.75;
        var x0 = band * i + (band - group) / 2 + bw * si;
        svg += '<rect class="' + esc(s.cls) + ' fh-bar" x="' + f1(x0 + 1) + '" y="' + f1(H - h) + '" width="' + f1(Math.max(1, bw - 2)) +
          '" height="' + f1(h) + '" rx="2"><title>' + esc(lb + " · " + s.name + ": " + (o.fmt || usd2)(v)) + "</title></rect>";
      });
    });
    svg += "</svg>";
    var legend = '<p class="fh-bars-legend caption">' + series.map(function (s) {
      return '<span><span class="fh-key ' + esc(s.cls) + '" aria-hidden="true"></span>' + esc(s.name) + "</span>";
    }).join("") + "</p>";
    var ys = '<div class="fh-bars-y caption" aria-hidden="true"><span>' + esc(usdShort(hi)) + "</span><span>" + esc(usdShort(hi / 2)) + "</span><span>$0</span></div>";
    var xs = '<div class="fh-bars-x caption" aria-hidden="true">' + list(o.short || labels).map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("") + "</div>";
    return '<div class="fh-bars">' + legend + '<div class="fh-bars-plot">' + ys + svg + xs + "</div></div>";
  }

  /* The fundability ring: N of 6, the engine's own count. */
  function ringSvg(score, max) {
    if (!Number.isSafeInteger(score) || !Number.isSafeInteger(max) || max <= 0) return "";
    var frac = Math.max(0, Math.min(1, score / max));
    var dash = f1(frac * 100);
    return '<span class="fh-ring" role="img" aria-label="Fundability ' + score + " of " + max + '">' +
      '<svg viewBox="0 0 88 88" width="88" height="88" aria-hidden="true" focusable="false">' +
      '<circle class="fh-ring-track" cx="44" cy="44" r="37" pathLength="100"></circle>' +
      '<circle class="fh-ring-fill" cx="44" cy="44" r="37" pathLength="100" stroke-dasharray="' + dash + ' 100" transform="rotate(-90 44 44)"></circle>' +
      '</svg><span class="fh-ring-num" aria-hidden="true"><b>' + score + "</b><small>/" + max + "</small></span></span>";
  }

  /* ── what the existing reads say, in one line ──────────────────────────── */

  function roundWord(r) {
    if (Number.isSafeInteger(r) && r > 0) return "Round " + r;
    var m = /^R(\d+)$/i.exec(String(r || ""));
    return m ? "Round " + Number(m[1]) : null;
  }

  var ORDER_OPEN = { payment_pending: 1, awaiting_payment: 1, mail_pending: 1, mailing: 1, needs_review: 1 };

  /* What one repair letter's own record proves. One answer per letter, so a
     letter is never counted in two places (Codex CX22, CX23, 2026-11-07):
       mailed   there is a mail receipt: the mail house took the letter and its
                id is saved (status sent or delivered with no client
                submission; the staff send and the $97 mailing write "sent" only
                then), or the client mailed it and uploaded the receipt;
       online   the client sent it on the bureau's website (never "mailed");
       sending  the mail house has it, but there is no receipt yet;
       ready    made, not sent.
     Anything else (failed, a submission without its receipt) counts nowhere. */
  function letterKind(l) {
    if (!l) return null;
    var s = l.submission;
    if (s) {
      if (s.channel === "portal") return "online";
      return s.channel === "mail" && s.receiptDocumentId ? "mailed" : null;
    }
    if (l.status === "sent" || l.status === "delivered") return "mailed";
    if (l.status === "sending") return "sending";
    if (l.status === "generated" || l.status === "ready") return "ready";
    return null;
  }

  /* One envelope of a $97 mailing, from the mailing read's own mailStatus
     (src/blueprint/letter-mailing.mjs mailStatus, Codex CX28): "mailed" only once
     PostGrid reports it handed to the post office; "sending" while our call is
     out or PostGrid has it but has not handed it over (accepted, printing); null
     when it is not with the mail house (paid and waiting, held for review, or
     cancelled). Accepted at the mail house is never counted as mailed. */
  function envelopeKind(e) {
    if (!e) return null;
    if (e.mailStatus === "mailed") return "mailed";
    if (e.mailStatus === "sending") return "sending";
    if (e.mailStatus === undefined && e.status === "sending") return "sending";
    return null;
  }

  /**
   * repairStatus({ repair, mailing }) → { line, round, engagement } or null.
   * repair: GET /api/blueprint/repair (full Blueprint); mailing: GET
   * /api/blueprint/letter-mailing (every Blueprint plan). Either may be null.
   * Two sets of letters, each letter counted once: this round's repair
   * letters, from their own records (a repair letter waiting in a paid $97
   * mailing is "Mailing requested"); and the plan's other letters, from the
   * mailing read: its envelopes, its open orders and its letters ready to
   * mail. With the repair read there, a mailing item that names a repair
   * letter (letterId, or kind "repair") is left to that letter's own record.
   */
  function repairStatus(d) {
    var repair = d && d.repair && d.repair.ok !== false ? d.repair : null;
    var mailing = d && d.mailing && d.mailing.ok !== false ? d.mailing : null;
    if (!repair && !mailing) return null;
    var cases = list(repair && repair.cases);
    var rounds = cases.map(function (c) { return c && c.round; }).filter(function (r) { return /^R\d+$/i.test(String(r || "")); });
    var round = (repair && repair.currentRound) || rounds.sort(function (a, b) { return Number(String(b).slice(1)) - Number(String(a).slice(1)); })[0] || null;
    var inRound = round ? cases.filter(function (c) { return c && c.round === round; }) : cases;
    var due = inRound.map(function (c) { return c && c.responseDueAt; }).filter(Boolean).sort()[0] || null;
    var orders = list(mailing && mailing.orders);
    var isOpen = function (o) { return !!(o && (ORDER_OPEN[o.status] || ORDER_OPEN[o.state])); };
    var repairItem = function (x) { return !!(repair && x && (x.letterId || x.kind === "repair")); };
    var n = { mailed: 0, online: 0, sending: 0, ready: 0 };
    var requested = false;
    var waiting = {};
    orders.forEach(function (o) {
      var envs = list(o && o.envelopes);
      var mine = envs.filter(function (e) { return !repairItem(e); });
      mine.forEach(function (e) { var k = envelopeKind(e); if (k) n[k] += 1; });
      if (!isOpen(o)) return;
      envs.forEach(function (e) { if (repairItem(e) && e.letterId && (e.status === "ready" || e.status === "needs_review")) waiting[e.letterId] = 1; });
      if (!envs.length || mine.some(function (e) { return !envelopeKind(e); })) requested = true;
    });
    inRound.forEach(function (c) {
      list(c && c.letters).forEach(function (l) {
        var k = letterKind(l);
        if (k === "ready" && l.id && waiting[l.id]) requested = true;
        else if (k) n[k] += 1;
      });
    });
    n.ready += list(mailing && mailing.letters).filter(function (l) { return l && l.eligibleForMailing && !repairItem(l); }).length;
    var parts = [];
    var r = roundWord(round);
    if (r) parts.push(r);
    if (n.mailed) parts.push(n.mailed + " mailed");
    if (n.online) parts.push(n.online + " sent online");
    if (n.sending) parts.push(n.sending + " sending");
    if (requested) parts.push("Mailing requested");
    var moving = n.mailed + n.online + n.sending > 0 || requested;
    if (n.ready) parts.push(n.ready + (moving ? " ready" : n.ready === 1 ? " letter ready" : " letters ready"));
    if (!moving && !n.ready) {
      if (repair && repair.executionOwner === "fundhub") parts.push("Fundhub is on it");
      else if (repair && repair.actions && repair.actions.canGenerate) parts.push("Letters ready to make");
      else parts.push(cases.length ? "In progress" : "No letters yet");
    }
    if (n.mailed + n.online > 0 && due) parts.push("Reply due " + dayShort(due));
    return { line: parts.join(" · "), parts: parts, round: r, engagement: !!repair };
  }

  var FUNDING_WORDS = {
    needs_file: "Report needed", optimize: "Preparing your file", held: "On hold",
    ready: "Next bank ready", awaiting_response: "Waiting on banks",
    managed: "Fundhub is applying", completed: "Round complete"
  };

  /** fundingStatus(funding) → { line } or null. funding: GET /api/blueprint/funding. */
  function fundingStatus(f) {
    if (!f || f.ok === false || !f.engagement) return null;
    var apps = list(f.applications);
    var applied = apps.filter(function (a) { return a && (a.reportedStatus || (a.status && a.status !== "Apply")); }).length;
    var approved = apps.filter(function (a) { return a && (a.status === "Approved" || a.reportedStatus === "approved"); }).length;
    var parts = [];
    var r = roundWord(f.engagement.roundNumber);
    if (r) parts.push(r);
    if (applied) { parts.push(applied + " applied"); parts.push(approved + " approved"); }
    else parts.push(FUNDING_WORDS[f.state] || "Your round");
    return { line: parts.join(" · "), parts: parts };
  }

  /* A status line that only breaks between its parts ("Reply due Dec 6"
     never splits on a phone). */
  function lineHtml(s) {
    return list(s && s.parts).map(function (p) { return esc(p).replace(/ /g, "&nbsp;"); }).join(" · ");
  }

  /* ── cards (HTML strings, no DOM) ──────────────────────────────────────── */

  var BLOCKER_WORDS = {
    genuine_credit_report_required: "Shows after your credit report.",
    current_engine_does_not_expose_safe_capacity: "Your report needs a review."
  };

  /** The hero: "Funding you qualify for" with the fundability ring. */
  function heroCard(fund) {
    var opp = (fund && fund.opportunity) || {};
    var p = opp.personal || {};
    var now = (fund && fund.now) || {};
    var cents = isCents(p.currentCents) ? p.currentCents : null;
    var plan = isCents(p.projectedCents) && cents !== null && p.projectedCents > cents ? p.projectedCents : null;
    var asOf = opp.source && opp.source.asOf;
    var big = cents !== null
      ? '<span class="fh-hero-num" data-fh-count="' + cents + '" data-fh-fmt="usd0">' + esc(usd0(cents)) + "</span>"
      : '<span class="fh-hero-num fh-hero-none">Not ready yet</span>';
    var sub = cents !== null
      ? (plan !== null ? '<p class="fh-hero-plan">With your plan: <b>' + esc(usd0(plan)) + "</b></p>" : "") +
        '<p class="caption">Estimate · UnderwriteIQ' + (asOf ? " · " + esc(dayShort(asOf)) : "") + "</p>"
      : '<p class="caption">' + esc(BLOCKER_WORDS[list(p.blockers)[0]] || "Shows after your credit report.") + "</p>";
    var score = Number.isSafeInteger(now.score) ? now.score : null;
    var max = Number.isSafeInteger(now.score_max) ? now.score_max : null;
    var tier = now.tier === "fundable" ? "Fundable" : "Not fundable yet";
    var ring = score !== null && max
      ? '<div class="fh-hero-ring">' + ringSvg(score, max) + '<div class="fh-hero-ringtext"><p class="caption">Fundability</p><p class="fh-hero-tier" data-tier="' + (now.tier === "fundable" ? "fundable" : "not-yet") + '">' + esc(tier) + "</p></div></div>"
      : '<div class="fh-hero-ring fh-hero-ring-none"><div class="fh-hero-ringtext"><p class="caption">Fundability</p><p class="fh-hero-tier">Not measured yet</p></div></div>';
    return '<section class="card fh-hero" aria-labelledby="fh-hero-t"><div class="fh-hero-main">' +
      '<h2 class="eyebrow" id="fh-hero-t">Funding you qualify for</h2>' + big + sub + "</div>" + ring + "</section>";
  }

  /** The advisor card: the CSM on the file, and Book a call. */
  function advisorCard(ready, opts) {
    var o = opts || {};
    var a = ready && ready.advisor && typeof ready.advisor.name === "string" && ready.advisor.name.trim() ? ready.advisor : null;
    var name = a ? a.name.trim() : "Fundhub team";
    var book = o.staff ? null : safeHttps(ready && ready.book_url);
    return '<section class="card fh-advisor" aria-labelledby="fh-adv-t"><h2 class="eyebrow" id="fh-adv-t">Your advisor</h2>' +
      '<div class="fh-adv-row"><span class="fh-avatar" aria-hidden="true">' + esc(a ? initials(name) : "FH") + "</span>" +
      '<div class="fh-adv-who"><p class="fh-adv-name">' + esc(name) + '</p><p class="caption">' + (a ? "Success manager" : "Not assigned yet") + "</p></div></div>" +
      (book ? '<a class="fh-btn" href="' + esc(book) + '" target="_blank" rel="noopener noreferrer">Book a call</a>' : "") + "</section>";
  }

  /**
   * workCards({ repair, mailing, funding, link }) → the Repair and Funding
   * cards, or "" when the client has neither. In the portal the buttons open
   * the existing views in place (data-fh-go); elsewhere `link` makes them go
   * to the portal with #repair / #funding / #letters.
   */
  /* The portal, keeping the sample route when the sample workspace is open
     (the same three parameters blueprint-journey.js route() keeps). */
  function portalHref(go) {
    var demo = root.FHBlueprintDemo;
    var q = demo && demo.active ? "?demo=1&blueprint=full" + (/^(preparation|implementation)$/.test(demo.offer || "") ? "&offer=" + demo.offer : "") : "";
    return "/app/client-portal.html" + q + "#" + go;
  }

  function workCards(d) {
    var o = d || {};
    var rs = repairStatus(o);
    var fs = fundingStatus(o.funding);
    if (!rs && !fs) return "";
    function action(go, words) {
      return o.link
        ? '<a class="fh-btn" href="' + esc(portalHref(go)) + '">' + esc(words) + "</a>"
        : '<button type="button" class="fh-btn" data-fh-go="' + go + '">' + esc(words) + "</button>";
    }
    function textLink(go, words) {
      return o.link
        ? '<a class="fh-link" href="' + esc(portalHref(go)) + '">' + esc(words) + "</a>"
        : '<button type="button" class="fh-link" data-fh-go="' + go + '">' + esc(words) + "</button>";
    }
    var cards = "";
    if (rs) {
      var repairGo = rs.engagement ? "repair" : "letters";
      cards += '<article class="card fh-work-card" data-kind="repair"><h3 class="eyebrow">Repair</h3>' +
        '<p class="fh-work-line">' + lineHtml(rs) + '</p><div class="fh-work-act">' + action(repairGo, rs.engagement ? "Open repair" : "Open letters") +
        (rs.engagement ? textLink("letters", "Letters and mailing") : "") + "</div></article>";
    }
    if (fs) {
      cards += '<article class="card fh-work-card" data-kind="funding"><h3 class="eyebrow">Funding</h3>' +
        '<p class="fh-work-line">' + lineHtml(fs) + '</p><div class="fh-work-act">' + action("funding", "Open applications") + "</div></article>";
    }
    return cards;
  }

  /* Cards side by side on one 12-column row: 1 → 12, 2 → 6 + 6, 3 → 4 + 4 + 4. */
  function grid(parts) {
    var html = list(parts).filter(Boolean).join("");
    var n = (html.match(/<(section|article) class="card /g) || []).length;
    return n ? '<div class="fh-more-grid" data-n="' + Math.min(n, 3) + '">' + html + "</div>" : "";
  }

  /** The months a report can be asked for: this month and the 11 before it. */
  function reportMonths(todayIso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(todayIso || ""));
    if (!m) return [];
    var y = Number(m[1]), mo = Number(m[2]) - 1, out = [];
    for (var i = 0; i < 12; i++) {
      var yy = y + Math.floor((mo - i) / 12), mm = ((mo - i) % 12 + 12) % 12;
      out.push({ value: yy + "-" + (mm < 9 ? "0" : "") + (mm + 1), label: MONTHS_LONG[mm] + " " + yy });
    }
    return out;
  }

  /** The monthly report card: pick a month, download the PDF. */
  function reportCard(todayIso) {
    var months = reportMonths(todayIso);
    if (!months.length) return "";
    return '<section class="card fh-report" aria-labelledby="fh-rep-t"><div class="fh-report-text"><h2 class="eyebrow" id="fh-rep-t">Monthly report</h2>' +
      '<p class="fh-report-line">What changed and what’s next.</p></div><div class="fh-report-act">' +
      '<label class="fh-sr" for="fh-rep-month">Report month</label><select id="fh-rep-month" data-fh-report-month>' +
      months.map(function (m, i) { return '<option value="' + m.value + '"' + (i === 0 ? " selected" : "") + ">" + esc(m.label) + "</option>"; }).join("") +
      '</select><button type="button" class="fh-btn" data-fh-act="report">Download PDF</button></div>' +
      '<p class="caption fh-report-msg" role="status" aria-live="polite"></p></section>';
  }

  function skeleton(kind) {
    return kind === "hero"
      ? '<section class="card fh-hero fh-skel" role="status" aria-busy="true"><p class="fh-sr">Loading your funding estimate…</p><span class="fh-sk fh-sk-s"></span><span class="fh-sk fh-sk-l"></span><span class="fh-sk fh-sk-m"></span></section>'
      : '<div class="fh-more-grid" role="status" aria-busy="true"><p class="fh-sr">Loading your advisor and your work…</p><section class="card fh-skel"><span class="fh-sk fh-sk-s"></span><span class="fh-sk fh-sk-m"></span></section><section class="card fh-skel"><span class="fh-sk fh-sk-s"></span><span class="fh-sk fh-sk-m"></span></section></div>';
  }

  function heroError() {
    return '<section class="card fh-hero fh-error" role="alert"><div class="fh-hero-main"><h2 class="eyebrow">Funding you qualify for</h2>' +
      '<p class="fh-work-line">We could not load your estimate.</p><button type="button" class="fh-btn" data-fh-act="retry">Try again</button></div></section>';
  }

  /* ── motion (browser) ──────────────────────────────────────────────────── */

  function reduced() {
    try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function raf(fn) { return (root.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); })(fn); }
  function nowMs() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function tween(ms, step) {
    var t0 = nowMs();
    function frame() {
      var p = Math.min(1, (nowMs() - t0) / ms);
      step(1 - Math.pow(1 - p, 3), p >= 1);
      if (p < 1) raf(frame);
    }
    raf(frame);
  }

  /* fn runs once, the first time `node` is on screen (a chart in a closed
     section draws in when it is opened). No IntersectionObserver: now. */
  function whenSeen(node, fn) {
    if (!root.IntersectionObserver) { fn(); return; }
    var io = new root.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); fn(); return; }
      }
    }, { threshold: 0.1 });
    io.observe(node);
  }
  function onScreenNow(node) {
    if (!node.getBoundingClientRect) return false;
    var r = node.getBoundingClientRect();
    var h = root.innerHeight || 0;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < h;
  }

  /* A number counts up to the value already printed — only when it is on
     screen now, and only when the printed words are exactly what this file
     would print, so it can never land on (or rest on) a different number. */
  function countUp(el) {
    if (!el || el.__fhCounted) return;
    el.__fhCounted = true;
    var target = Number(el.getAttribute("data-fh-count"));
    var fmt = el.getAttribute("data-fh-fmt") || "usd0";
    var final = el.textContent;
    if (!isFinite(target) || formatAs(fmt, target) !== String(final).trim() || reduced() || !onScreenNow(el)) return;
    el.textContent = formatAs(fmt, 0);
    tween(900, function (e, done) { el.textContent = done ? final : formatAs(fmt, target * e); });
  }

  /* An SVG draws in from the left: a clip that opens over 0.9 s, the first
     time the chart is on screen. Reduced motion: drawn at once. */
  function reveal(svg) {
    if (!svg || svg.__fhRevealed || reduced() || !root.document || !svg.viewBox || !svg.viewBox.baseVal) return;
    svg.__fhRevealed = true;
    var vb = svg.viewBox.baseVal;
    var id = "fhc" + (++uid);
    var defs = svg.querySelector("defs") || svg.insertBefore(root.document.createElementNS(SVGNS, "defs"), svg.firstChild);
    var clip = root.document.createElementNS(SVGNS, "clipPath");
    clip.setAttribute("id", id);
    var rect = root.document.createElementNS(SVGNS, "rect");
    rect.setAttribute("x", String(vb.x - 4)); rect.setAttribute("y", String(vb.y - 20));
    rect.setAttribute("height", String(vb.height + 40)); rect.setAttribute("width", "0");
    clip.appendChild(rect);
    defs.appendChild(clip);
    var parts = svg.querySelectorAll(svg.hasAttribute("data-fh-reveal") ? "path" : ".fh-curve,.fh-area");
    for (var i = 0; i < parts.length; i++) parts[i].setAttribute("clip-path", "url(#" + id + ")");
    whenSeen(svg, function () {
      tween(900, function (e, done) {
        rect.setAttribute("width", String((vb.width + 8) * e));
        if (done) for (var j = 0; j < parts.length; j++) parts[j].removeAttribute("clip-path");
      });
    });
  }

  /* Bars grow and the ring fills (CSS) the first time they are on screen. */
  function growIn(node) {
    if (!node || node.__fhGrow) return;
    node.__fhGrow = true;
    if (reduced()) { node.classList.add("fh-in"); return; }
    node.classList.add("fh-wait");
    whenSeen(node, function () { node.classList.remove("fh-wait"); node.classList.add("fh-in"); });
  }

  /* Count up every number and draw in every chart inside `scope`. */
  function animate(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nums = scope.querySelectorAll("[data-fh-count]");
    for (var i = 0; i < nums.length; i++) countUp(nums[i]);
    var svgs = scope.querySelectorAll("svg[data-fh-reveal]");
    for (var j = 0; j < svgs.length; j++) reveal(svgs[j]);
    var grows = scope.querySelectorAll("[data-fh-grow],.fh-ring");
    for (var k = 0; k < grows.length; k++) growIn(grows[k]);
  }

  /* ── the other units' charts, smoothed in place ─────────────────────────── */

  function pointsOf(poly) {
    return String(poly.getAttribute("points") || "").trim().split(/\s+/).map(function (p) {
      var xy = p.split(",");
      return [Number(xy[0]), Number(xy[1])];
    }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
  }
  function seriesOf(el) {
    var m = /\b(s[0-3]|line-ex|line-eq|line-tu|all-line)\b/.exec(el.getAttribute("class") || "");
    return m ? m[1] : (el.getAttribute("class") || "line") + "|" + (el.getAttribute("stroke-dasharray") || "");
  }
  function el(name, attrs) {
    var n = root.document.createElementNS(SVGNS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* FICO bands behind the personal score chart (money-credit.js). Its tick
     labels sit at y(v) + 4 with the value as their words, so two of them give
     the chart's own scale; nothing is drawn when they cannot be read. */
  function scoreBands(svg) {
    var ticks = [];
    var texts = svg.querySelectorAll("text.chart-label");
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var v = Number(String(t.textContent || "").trim());
      if (t.getAttribute("x") === "0" && isFinite(v) && /^\d{3}$/.test(String(t.textContent).trim())) ticks.push({ v: v, y: Number(t.getAttribute("y")) - 4 });
    }
    var base = svg.querySelector("line.chart-base");
    if (ticks.length < 2 || !base) return;
    ticks.sort(function (a, b) { return a.v - b.v; });
    var lo = ticks[0], hi = ticks[ticks.length - 1];
    if (hi.v === lo.v) return;
    var yAt = function (v) { return lo.y + ((v - lo.v) * (hi.y - lo.y)) / (hi.v - lo.v); };
    var x1 = Number(base.getAttribute("x1")), x2 = Number(base.getAttribute("x2"));
    var used = [];
    var g = el("g", { "class": "fh-bands", "aria-hidden": "true" });
    SCORE_BANDS.forEach(function (b) {
      var top = Math.min(b.hi + 1, hi.v), bot = Math.max(b.lo, lo.v);
      if (top <= bot) return;
      var yTop = yAt(top), yBot = yAt(bot);
      g.appendChild(el("rect", { x: String(x1), y: f1(yTop), width: f1(x2 - x1), height: f1(yBot - yTop), fill: b.color, "class": "fh-band" }));
      used.push(b);
    });
    if (!used.length) return;
    svg.insertBefore(g, base);
    var key = root.document.createElement("p");
    key.className = "caption fh-bands-key";
    key.innerHTML = used.map(function (b) {
      return '<span><span class="fh-band-sw" data-band="' + esc(b.word) + '"></span>' + esc(b.word) + " " + b.lo + "–" + b.hi + "</span>";
    }).join("");
    svg.parentNode.insertBefore(key, svg.nextSibling);
  }

  /* The newest value of each line beside its name in the legend, read off the
     chart's own dots ("Experian 712 on Nov 6, 2026"). */
  function legendValues(svg) {
    var legend = svg.nextElementSibling;
    while (legend && legend.classList && legend.classList.contains("fh-bands-key")) legend = legend.nextElementSibling;
    if (!legend || !legend.classList || !legend.classList.contains("legend")) return;
    var newest = {};
    var dots = svg.querySelectorAll("circle.dot");
    for (var i = 0; i < dots.length; i++) {
      var title = dots[i].querySelector("title");
      var m = title && /^(.*) (\S+) on (.+)$/.exec(title.textContent || "");
      if (!m) continue;
      var cx = Number(dots[i].getAttribute("cx"));
      if (!newest[m[1]] || cx >= newest[m[1]].cx) newest[m[1]] = { cx: cx, value: m[2] };
    }
    var spans = legend.children;
    for (var j = 0; j < spans.length; j++) {
      var label = String(spans[j].textContent || "").trim();
      if (newest[label] && !spans[j].querySelector(".fh-legend-val")) {
        var b = root.document.createElement("b");
        b.className = "fh-legend-val";
        b.textContent = newest[label].value;
        spans[j].appendChild(b);
      }
    }
  }

  /* Smooth every straight line chart inside `scope` that is not smooth yet:
     a monotone curve over each line (same classes, so the same colour and
     dashes), soft fill under a lone line, bands and newest values on the
     credit score chart. The straight line stays in the markup, unseen. */
  function smoothCharts(scope) {
    if (!scope || !scope.querySelectorAll || !root.document) return;
    var svgs = scope.querySelectorAll("svg.tsvg:not([data-fh-smooth]), svg.chart:not([data-fh-smooth])");
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      var polys = svg.querySelectorAll("polyline.tline, polyline.line, polyline.card-line, polyline.all-line");
      svg.setAttribute("data-fh-smooth", polys.length ? "1" : "none");
      if (!polys.length) continue;
      var trends = svg.classList.contains("tsvg");
      var kinds = {};
      for (var a = 0; a < polys.length; a++) kinds[seriesOf(polys[a])] = true;
      var single = Object.keys(kinds).length === 1;
      var vb = svg.viewBox && svg.viewBox.baseVal;
      var bottom = vb ? vb.y + vb.height : null;
      var grads = {};
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        var pts = pointsOf(poly);
        if (pts.length < 2) continue;
        var d = monoPath(pts);
        var cls = (poly.getAttribute("class") || "") + " fh-curve";
        var curve = el("path", { d: d, "class": cls });
        ["vector-effect", "stroke-dasharray"].forEach(function (attr) {
          if (poly.getAttribute(attr)) curve.setAttribute(attr, poly.getAttribute(attr));
        });
        var tip = poly.querySelector("title");
        if (tip) curve.appendChild(tip.cloneNode(true));
        poly.parentNode.insertBefore(curve, poly.nextSibling);
        var key = seriesOf(poly);
        if (trends && single && bottom !== null && !/\btest\b/.test(poly.getAttribute("class") || "") && INK[key]) {
          if (!grads[key]) {
            grads[key] = "fhg" + (++uid);
            var defs = svg.querySelector("defs") || svg.insertBefore(el("defs", {}), svg.firstChild);
            var lg = el("linearGradient", { id: grads[key], x1: "0", y1: "0", x2: "0", y2: "1" });
            lg.appendChild(el("stop", { offset: "0", "stop-color": INK[key], "stop-opacity": ".16" }));
            lg.appendChild(el("stop", { offset: "1", "stop-color": INK[key], "stop-opacity": "0" }));
            defs.appendChild(lg);
          }
          var area = el("path", {
            d: d + "L" + f1(pts[pts.length - 1][0]) + " " + f1(bottom) + "L" + f1(pts[0][0]) + " " + f1(bottom) + "Z",
            "class": "fh-area", fill: "url(#" + grads[key] + ")"
          });
          poly.parentNode.insertBefore(area, poly);
        }
      }
      if (!trends && /Scores at each pull/.test(svg.getAttribute("aria-label") || "")) scoreBands(svg);
      if (!trends) legendValues(svg);
      reveal(svg);
    }
  }

  /* Watch a part of the page: whenever a section paints a new chart, smooth
     it. One pass per frame, however many nodes changed. */
  function watchCharts(scope) {
    if (!scope || !root.MutationObserver || scope.__fhWatch) return;
    scope.__fhWatch = true;
    var queued = false;
    var run = function () { queued = false; smoothCharts(scope); };
    new root.MutationObserver(function () { if (!queued) { queued = true; raf(run); } })
      .observe(scope, { childList: true, subtree: true });
    smoothCharts(scope);
  }

  /* ── reading (browser) ─────────────────────────────────────────────────── */

  function token() { try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }

  /* GET for the portal and the progress page: the demo's own adapter when the
     sample is open, else the client's session. */
  function pageGet(path) {
    var demo = root.FHBlueprintDemo;
    var started;
    try {
      if (demo && demo.active && typeof demo.fetchResponse === "function") started = demo.fetchResponse(path);
      else {
        var t = token();
        if (!t || t === "demo") return Promise.resolve({ status: 401, body: null });
        started = root.fetch(path, { headers: { accept: "application/json", authorization: "Bearer " + t }, credentials: "same-origin" });
      }
    } catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }
  function bodyOf(res) { return res && res.status === 200 && res.body && res.body.ok !== false ? res.body : null; }

  /* The Repair and Funding reads. 403/404 mean "not on this plan": no card. */
  function loadWork(get) {
    return Promise.all([get("/api/blueprint/repair"), get("/api/blueprint/letter-mailing"), get("/api/blueprint/funding")])
      .then(function (r) { return { repair: bodyOf(r[0]), mailing: bodyOf(r[1]), funding: bodyOf(r[2]) }; });
  }

  /* ── Finance OS: the Overview's premium slots ──────────────────────────── */

  function withClient(path, cid) {
    return cid ? path + (path.indexOf("?") >= 0 ? "&" : "?") + "client_id=" + encodeURIComponent(cid) : path;
  }

  /* The weekly sparklines in the Overview tiles, from the Trends read. */
  function fillSparks(scope, trends) {
    if (!scope || !trends || !trends.daily) return;
    var d = trends.daily, cash = d.cash || {}, debt = d.debt || {};
    var lines = {
      "cash.personal": [cash.personal && cash.personal.cents, "s1"],
      "cash.business": [cash.business && cash.business.cents, "s2"],
      "debt.total": [debt.total && debt.total.cents, "s0"],
      "cards_used": [d.cards_used_pct, "s0"]
    };
    var slots = scope.querySelectorAll("[data-fh-spark]");
    for (var i = 0; i < slots.length; i++) {
      var l = lines[slots[i].getAttribute("data-fh-spark")];
      var html = l ? sparkSvg(l[0], { cls: l[1] }) : "";
      slots[i].innerHTML = html;
      slots[i].hidden = !html;
      var svg = slots[i].querySelector("svg");
      if (svg) reveal(svg);
    }
  }

  function downloadReport(btn, ctx) {
    var card = btn.closest(".fh-report");
    var sel = card && card.querySelector("[data-fh-report-month]");
    var msg = card && card.querySelector(".fh-report-msg");
    var say = function (t) { if (msg) msg.textContent = t; };
    if (root.__fhBlueprintFullDemoRoute) { say("This sample has no real report to download."); return; }
    var month = sel ? sel.value : "";
    var path = withClient("/api/money/overview?report=monthly&month=" + encodeURIComponent(month), ctx.clientId);
    var t = token();
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Making your PDF…";
    say("");
    root.fetch(path, { headers: t ? { authorization: "Bearer " + t, accept: "application/pdf" } : { accept: "application/pdf" }, credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401 && ctx.onSignIn) { ctx.onSignIn(); throw new Error("signin"); }
        var type = r.headers.get("content-type") || "";
        if (!r.ok || type.indexOf("application/pdf") !== 0) {
          return r.json().catch(function () { return {}; }).then(function (b) { throw new Error((b && b.message) || "We could not make your report. Try again."); });
        }
        return r.blob();
      })
      .then(function (blob) {
        var url = root.URL.createObjectURL(blob);
        var a = root.document.createElement("a");
        a.href = url;
        a.download = "fundhub-report-" + month + ".pdf";
        root.document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
        say("Your report is downloading.");
      })
      .catch(function (e) { if (e && e.message !== "signin") say(e && e.message ? e.message : "We could not make your report. Try again."); })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  /**
   * FinanceOS.premium.mount({ top, more, root }, ctx). money.js calls it after
   * each Overview paint. ctx = { clientId, apiGet(path) → { status, body },
   * onSignIn }. Staff (clientId set) see the same numbers, no Book a call, and
   * no Blueprint work cards (those reads are the client's own).
   */
  function mountOverview(slots, ctx) {
    var s = slots || {};
    var c = ctx || {};
    var get = typeof c.apiGet === "function" ? c.apiGet : function (p) { return pageGet(p); };
    var staff = !!c.clientId;
    if (s.top) s.top.innerHTML = skeleton("hero");
    if (s.more) s.more.innerHTML = skeleton("more");
    var main = root.document && root.document.getElementById("fos-main");
    if (s.root) watchCharts(main && main.contains(s.root) ? main : s.root);

    function load() {
      var fund = get(withClient("/api/money/fundability", c.clientId));
      var ready = get(withClient("/api/money/ready-to-fund", c.clientId));
      var work = staff ? Promise.resolve({}) : loadWork(get);
      Promise.resolve(fund).then(function (res) {
        if (!s.top) return;
        var b = bodyOf(res);
        s.top.innerHTML = b ? heroCard(b) : heroError();
        animate(s.top);
      });
      Promise.all([ready, work]).then(function (r) {
        if (!s.more) return;
        var today = new Date().toISOString().slice(0, 10);
        var readyBody = bodyOf(r[0]);
        /* No answer from the read: no advisor card, rather than "Not assigned yet". */
        s.more.innerHTML = grid([readyBody ? advisorCard(readyBody, { staff: staff }) : "",
          workCards({ repair: r[1].repair, mailing: r[1].mailing, funding: r[1].funding, link: true })]) +
          (root.__fhBlueprintFullDemoRoute ? "" : reportCard(today));
        animate(s.more);
      });
    }
    /* The sparklines ride on the Trends section's own read (money.js hands
       each answer over), so the daily history is read once. */
    if (typeof c.onTrends === "function") c.onTrends(function (res) { fillSparks(s.root, bodyOf(res)); });

    var onClick = function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-fh-act]") : null;
      if (!t) return;
      if (t.getAttribute("data-fh-act") === "retry") load();
      if (t.getAttribute("data-fh-act") === "report") downloadReport(t, c);
    };
    [s.top, s.more].forEach(function (slot) { if (slot) slot.addEventListener("click", onClick); });
    load();
    if (s.root) animate(s.root);
    return { reload: load };
  }

  /* ── the Blueprint home (client portal) ────────────────────────────────── */

  var portal = { data: null, at: 0, pending: null, plan: null };

  /* The plan read the Blueprint already made (blueprint-plan.js announces it
     with fh:blueprint-plan-updated). Its `path` carries the same UnderwriteIQ
     numbers the path panel printed, so nothing is read twice. */
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener("fh:blueprint-plan-updated", function (e) { portal.plan = e && e.detail ? e.detail : portal.plan; });
  }

  function portalData() {
    if (portal.data && Date.now() - portal.at < 60000) return Promise.resolve(portal.data);
    if (portal.pending) return portal.pending;
    portal.pending = Promise.all([pageGet("/api/money/ready-to-fund"), loadWork(pageGet)])
      .then(function (r) {
        portal.data = { ready: bodyOf(r[0]), work: r[1] };
        portal.at = Date.now();
        portal.pending = null;
        return portal.data;
      }, function () { portal.pending = null; return null; });
    return portal.pending;
  }

  /* The ring and the count-up on the Blueprint path's "Funding you qualify
     for" (blueprint-journey.js pathPanel) — only when its printed amount is
     exactly the plan's own UnderwriteIQ figure. */
  function enhancePath(summary) {
    var path = summary.querySelector(".bj-path");
    var pathData = portal.plan && portal.plan.path;
    if (!path || path.__fhDone || !pathData) return;
    path.__fhDone = true;
    var cents = pathData.funding && pathData.funding.todayCents;
    var amount = path.querySelector(".bj-pathfund");
    var first = amount && amount.firstChild;
    if (first && first.nodeType === 3 && isCents(cents) && first.nodeValue.trim() === usd0(cents)) {
      var span = root.document.createElement("span");
      span.setAttribute("data-fh-count", String(cents));
      span.setAttribute("data-fh-fmt", "usd0");
      span.textContent = first.nodeValue.trim();
      amount.replaceChild(span, first);
      amount.insertBefore(root.document.createTextNode(" "), span.nextSibling);
    }
    var fd = pathData.fundability;
    var head = path.querySelector(".bj-heading");
    if (head && fd && Number.isSafeInteger(fd.score) && Number.isSafeInteger(fd.max)) {
      var wrap = root.document.createElement("div");
      wrap.className = "fh-bp-ring";
      wrap.innerHTML = ringSvg(fd.score, fd.max);
      var chip = head.querySelector(".bj-chip");
      head.insertBefore(wrap, chip || null);
    }
    animate(path);
  }

  function enhanceSummary(summary) {
    if (!summary || summary.__fhPremium) return;
    summary.__fhPremium = true;
    enhancePath(summary);
    portalData().then(function (data) {
      if (!data || !summary.isConnected) return;
      var row = root.document.createElement("section");
      row.className = "fh-bp-row";
      row.setAttribute("aria-label", "Your advisor and your work");
      row.innerHTML = grid([data.ready ? advisorCard(data.ready) : "", workCards({ repair: data.work.repair, mailing: data.work.mailing, funding: data.work.funding })]);
      if (!row.innerHTML) return;
      var next = summary.querySelector(".bj-next");
      var after = next && next.nextElementSibling && next.nextElementSibling.classList.contains("bf-tabs") ? next.nextElementSibling : next;
      if (after && after.parentNode === summary) summary.insertBefore(row, after.nextSibling);
      else summary.insertBefore(row, summary.firstChild);
      animate(row);
    });
  }

  /* Open an existing view of the client's workspace in place. */
  function goFulfillment(view) {
    var host = root.document.getElementById("blueprint-fulfillment");
    if (!host || !root.document.body.dataset.blueprintFulfillment) return false;
    var b = root.document.createElement("button");
    b.type = "button";
    b.hidden = true;
    b.setAttribute("data-bf-action", "view");
    b.setAttribute("data-view", view);
    host.appendChild(b);
    b.click();
    b.remove();
    host.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    return true;
  }
  function go(where) {
    if (where === "letters") {
      root.document.dispatchEvent(new root.CustomEvent("fh:blueprint-navigate", { detail: { action: "letters" } }));
      var plan = root.document.getElementById("blueprint-plan");
      if (plan) plan.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      return true;
    }
    if (where === "repair" || where === "funding") return goFulfillment(where);
    return false;
  }

  /* #repair, #funding or #letters on the portal (links from FinanceOS and the
     progress page) open that view once the workspace has loaded. */
  function deepLink() {
    var want = String(root.location.hash || "").replace(/^#/, "");
    if (!/^(repair|funding|letters)$/.test(want)) return;
    var body = root.document.body;
    var tries = 0;
    var ready = function () {
      return want === "letters" ? (body.dataset.blueprintPlan === "active" || body.dataset.blueprintFulfillment === "active")
        : body.dataset.blueprintFulfillment === "active";
    };
    var attempt = function () {
      if (ready()) {
        go(want === "repair" && !body.dataset.blueprintFulfillment ? "letters" : want);
        if (root.history && root.history.replaceState) root.history.replaceState(root.history.state, "", root.location.pathname + root.location.search);
        return;
      }
      if (++tries < 60) setTimeout(attempt, 250);
      else if (want === "repair" && body.dataset.blueprintPlan === "active") go("letters");
    };
    attempt();
  }

  function initPortal() {
    var doc = root.document;
    doc.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-fh-go]") : null;
      if (!t) return;
      e.preventDefault();
      var where = t.getAttribute("data-fh-go");
      if (!go(where) && where === "repair") go("letters");
    });
    var scan = function () {
      var all = doc.querySelectorAll("[data-blueprint-journey]");
      for (var i = 0; i < all.length; i++) enhanceSummary(all[i]);
    };
    var queued = false;
    new root.MutationObserver(function () { if (!queued) { queued = true; raf(function () { queued = false; scan(); }); } })
      .observe(doc.body, { childList: true, subtree: true });
    scan();
    deepLink();
    root.addEventListener("hashchange", deepLink);
  }

  /* ── the progress page: the Repair and Funding cards ───────────────────── */

  function initProgress(slot) {
    loadWork(pageGet).then(function (w) {
      var html = grid([workCards({ repair: w.repair, mailing: w.mailing, funding: w.funding, link: true })]);
      if (!html) return;
      slot.innerHTML = '<h2 class="sec">Repair and funding</h2>' + html;
      slot.hidden = false;
      animate(slot);
    });
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.premium = { mount: mountOverview };

  root.FHPremium = {
    monoPath: monoPath, weekly: weekly, sparkSvg: sparkSvg, barsHtml: barsHtml, ringSvg: ringSvg,
    repairStatus: repairStatus, letterKind: letterKind, envelopeKind: envelopeKind,
    fundingStatus: fundingStatus, heroCard: heroCard, advisorCard: advisorCard,
    workCards: workCards, grid: grid, reportCard: reportCard, reportMonths: reportMonths,
    usd0: usd0, usd2: usd2, pct1: pct1, usdShort: usdShort, formatAs: formatAs, initials: initials,
    animate: animate, smoothCharts: smoothCharts, watchCharts: watchCharts, countUp: countUp, reduced: reduced,
    SCORE_BANDS: SCORE_BANDS
  };

  function boot() {
    var doc = root.document;
    var page = doc.body && doc.body.getAttribute("data-client-page");
    if (page === "client-portal") initPortal();
    /* Every FinanceOS tab: whichever opens first, its charts are smoothed. */
    if (page === "financeos") watchCharts(doc.getElementById("fos-main") || doc.body);
    var work = doc.querySelector('[data-fh-premium="work"]');
    if (work) initProgress(work);
  }
  if (root.document && root.document.addEventListener && root.MutationObserver) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
