/* Credit — the client's credit page (/app/money-credit.html), like Credit Karma.
 *
 * Reads ONE endpoint, GET /api/money/credit, and paints it. Nothing on this page
 * invents a number: every figure is a field from that read.
 *
 * THE HONESTY RULES (same as money.js):
 *   - A null is "we do not have this number" and paints "—", never 0.
 *   - A score off a sample report says so, in words, at the top.
 *   - UnderwriteIQ's sentences are printed exactly as the server sent them.
 *   - No chart line is drawn from fewer than two pulls.
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

  function shortDay(iso) { return day(iso).replace(/, \d{4}$/, ""); }

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
    return '<div class="grid tiles">' +
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

    return '<div class="grid tiles">' + useTile + acctTile + inqTile + negTile + '</div>';
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

  /* Score over time. Only drawn from two or more pulls. Lines differ by dash,
     not by colour, and the legend says which is which in words. */
  function renderHistory(d) {
    var h = list(d.history);
    var head = '<section class="card" aria-labelledby="c-hist"><h2 class="eyebrow" id="c-hist">Your scores over time</h2>';
    if (h.length < 2) {
      return head + '<p class="caption">' + (d.has_pull
        ? "One pull so far. The chart starts with your next pull."
        : "No pulls yet.") + '</p></section>';
    }
    var W = 600, H = 200, L = 40, R = 16, T = 16, B = 32;
    var vals = [];
    h.forEach(function (p) { BUREAUS.forEach(function (b) { if (isNum(p[b.key])) vals.push(p[b.key]); }); });
    var lo = Math.max(FICO_MIN, Math.floor((Math.min.apply(null, vals) - 20) / 10) * 10);
    var hi = Math.min(FICO_MAX, Math.ceil((Math.max.apply(null, vals) + 20) / 10) * 10);
    if (hi <= lo) hi = lo + 10;
    function x(i) { return L + (i * (W - L - R)) / (h.length - 1); }
    function y(v) { return T + ((hi - v) * (H - T - B)) / (hi - lo); }
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scores at each pull">' +
      '<line class="chart-base" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"></line>' +
      '<text class="chart-label" x="0" y="' + (y(hi) + 4) + '">' + hi + '</text>' +
      '<text class="chart-label" x="0" y="' + (y(lo) + 4) + '">' + lo + '</text>';
    BUREAUS.forEach(function (b) {
      var pts = [];
      h.forEach(function (p, i) { if (isNum(p[b.key])) pts.push([x(i), y(p[b.key]), p[b.key], p.pulled_at]); });
      if (pts.length >= 2) {
        svg += '<polyline class="line line-' + b.short.toLowerCase() + '" points="' +
          pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ") + '"></polyline>';
      }
      pts.forEach(function (q) {
        svg += '<circle class="dot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3"><title>' +
          esc(b.label + " " + q[2] + " on " + day(q[3])) + '</title></circle>';
      });
    });
    h.forEach(function (p, i) {
      var anchor = i === 0 ? "start" : i === h.length - 1 ? "end" : "middle";
      svg += '<text class="chart-label" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' +
        esc(shortDay(p.pulled_at)) + '</text>';
    });
    svg += '</svg>';
    var legend = '<p class="legend caption"><span><span class="key"></span>Experian</span>' +
      '<span><span class="key key-eq"></span>Equifax</span><span><span class="key key-tu"></span>TransUnion</span></p>';
    return head + svg + legend + '</section>';
  }

  function renderAccounts(d) {
    var rows = list(d.accounts && d.accounts.list);
    var head = '<section class="card block" aria-labelledby="c-acct"><h2 class="eyebrow" id="c-acct">Accounts on your credit report</h2>';
    if (!rows.length) {
      return head + '<p class="caption">No accounts on file yet.</p></section>';
    }
    var body = rows.map(function (a) {
      var used = (isNum(a.balance_cents) && isNum(a.limit_cents) && a.limit_cents > 0 && a.kind !== "installment")
        ? (a.balance_cents / a.limit_cents) * 100 : null;
      return '<tr><td>' + esc(a.lender || "—") + (a.last4 ? ' <span class="caption">••' + esc(a.last4) + '</span>' : "") + '</td>' +
        '<td>' + esc(KIND_WORDS[a.kind] || "—") + '</td>' +
        '<td class="r num">' + esc(money(a.balance_cents)) + '</td>' +
        '<td class="r num">' + esc(money(a.limit_cents)) + '</td>' +
        '<td class="r">' + (isNum(used) ? '<span class="num">' + esc(pct(used)) + '</span>' + usedBar(used) : '<span class="caption">—</span>') + '</td>' +
        '<td>' + esc(day(a.opened_on)) + '</td>' +
        '<td>' + (a.open ? "Open" : "Closed") + '</td></tr>';
    }).join("");
    return head + '<div class="scroll-x"><table><thead><tr><th>Lender</th><th>Type</th>' +
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

  function renderFull(d) {
    return renderSample(d) + renderHead(d) + renderScores(d) + renderFacts(d) +
      '<div class="grid two">' + renderSays(d) + renderHistory(d) + '</div>' +
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

  function render(d, setupHref) { return isEmpty(d) ? renderEmpty(d, setupHref) : renderFull(d); }

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

    function paint(html) { el.innerHTML = html; }

    function load() {
      paint(renderLoading());
      return Promise.resolve(get(READ_PATH + (cid ? "?client_id=" + encodeURIComponent(cid) : ""))).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        paint(render(res.body, withClient(SETUP_PATH, cid)));
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (t && (!el.contains || el.contains(t)) && t.getAttribute("data-act") === "retry") load();
    });

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
    render: render, renderFull: renderFull, renderEmpty: renderEmpty, renderError: renderError,
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
