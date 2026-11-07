/* "If they follow the plan" — the staff card for closers and CSMs.
 *
 * Owner, Chris 2026-11-07: "on sales calls, take someone with a messed-up file:
 * follow these steps, and we can see you will be eligible for money in nine
 * months for this amount."
 *
 * Reads ONE door, GET /api/money/fundability?view=plan&months=N&client_id=…
 * (src/finance/fundhub-lookahead.mjs). Every number is a field from that read;
 * this file adds none. The Fundhub score arrives as a number, a band and three
 * reasons — the formula stays on the server.
 *
 * Mounts on every [data-fh-plan-card] element: the closer cockpit
 * (closer-dashboard.html, right after the funding estimate) and the staff
 * client file (client-control-panel.html, the Funding tab). It never touches
 * the Present flow. The card stays hidden until it knows the client, and hides
 * itself for a role the door refuses.
 *
 * Render functions return HTML strings and touch no DOM, so Node tests can run
 * them (window.FHPlanCard). Plain words, every control 44px, no sideways
 * scroll. Styles: fundhub-plan-card.css, every rule under .fh-plan-card.
 */
(function (root) {
  "use strict";

  var PATH = "/api/money/fundability";
  var QUICK = [3, 6, 9, 12];
  var MAX = 24;
  var DEFAULT_MONTH = 9;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var TIER = { fundable: "Fundable", not_fundable: "Not fundable yet" };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function money(c) {
    if (!isNum(c)) return null;
    return "$" + String(Math.round(Math.abs(c) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1] : null;
  }
  function tierWord(t) { return TIER[t] || "Can't tell yet"; }
  function monthsWord(n) { return n + (n === 1 ? " month" : " months"); }
  function point(d, months, scenario) {
    var out = null;
    list(d && d.points).forEach(function (p) { if (p && p.months === months && p.scenario === scenario) out = p; });
    return out;
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function head() {
    return '<div class="fpc-head"><h2 id="fh-plan-title">If they follow the plan</h2>' +
      '<p class="fpc-cap">UnderwriteIQ estimate · staff only</p></div>';
  }

  function picks(sel) {
    var quick = QUICK.map(function (m) {
      return '<button type="button" class="fpc-pick" data-fpc-month="' + m + '" aria-pressed="' + (m === sel ? "true" : "false") + '">' +
        m + ' mo</button>';
    }).join("");
    var opts = "";
    for (var m = 1; m <= MAX; m++) {
      opts += '<option value="' + m + '"' + (m === sel ? " selected" : "") + '>' + esc(monthsWord(m)) + '</option>';
    }
    return '<div class="fpc-picks" role="group" aria-label="Look ahead">' + quick +
      '<label class="fpc-any"><span>Any month</span><select data-fpc-any aria-label="Any month from 1 to 24">' + opts + '</select></label></div>';
  }

  function col(label, p, opts) {
    opts = opts || {};
    var fh = (p && p.fundhub_score) || {};
    var est = money(p && p.funding_estimate_cents);
    return '<div class="fpc-col' + (opts.dashed ? " is-dashed" : "") + '">' +
      '<p class="fpc-col-head">' + esc(label) + '</p>' +
      '<p class="fpc-score"><span class="fpc-num">' + esc(isNum(fh.score) ? fh.score : "—") + '</span>' +
      '<span class="fpc-of">Fundhub score</span></p>' +
      '<p class="fpc-band">' + esc(fh.band_label || "No score yet") + '</p>' +
      '<p class="fpc-line"><span class="fpc-k">Tier</span><span>' + esc(tierWord(p && p.tier)) + '</span></p>' +
      '<p class="fpc-line"><span class="fpc-k">Personal</span><span>' + esc(est ? "about " + est : "No figure yet") + '</span></p>' +
      '</div>';
  }

  function compare(d) {
    var sel = d.months;
    var plan = point(d, sel, "plan");
    var ifr = point(d, sel, "if_removed");
    return '<div class="fpc-cols">' +
      col("Today", d.now) +
      col("In " + monthsWord(sel), plan) +
      (ifr ? col("In " + monthsWord(sel) + ", if removed", ifr, { dashed: true }) : "") +
      '</div>';
  }

  function steps(d) {
    var r = d.roadmap || {};
    var rows = list(r.steps).map(function (s) {
      var later = s.date && r.date && s.date > r.date;
      return '<li class="fpc-step' + (s.done ? " is-done" : "") + (later ? " is-later" : "") + '">' +
        '<span class="fpc-date">' + esc(day(s.date) || "No date yet") + '</span>' +
        '<span class="fpc-step-text">' + esc(s.text) +
        (s.done ? ' <span class="fpc-tag">Done</span>' : "") +
        (later ? ' <span class="fpc-tag">After month ' + esc(r.months) + '</span>' : "") + '</span></li>';
    }).join("");
    var note = r.bank_steps_read === false ? '<p class="fpc-cap">Bank account steps could not be read right now.</p>' : "";
    return '<section class="fpc-block" aria-labelledby="fpc-path"><h3 id="fpc-path">The path</h3>' +
      (rows ? '<ol class="fpc-steps">' + rows + '</ol>' : '<p class="fpc-cap">No dated steps on the plan yet.</p>') + note + '</section>';
  }

  function businesses(d) {
    var biz = list(d.roadmap && d.roadmap.businesses);
    var sel = d.months;
    var rows = biz.map(function (b) {
      /* An amount only with business evidence (a matched business report, or
         reviewed formation and EIN papers). Otherwise the report is needed. */
      var est = b.supported === true ? money(b.funding_estimate_cents) : null;
      var bits = [];
      if (isNum(b.age_months)) bits.push(monthsWord(b.age_months) + " old");
      if (isNum(b.multiplier)) bits.push(b.multiplier + "× the card figure");
      return '<li class="fpc-biz"><span class="fpc-biz-name">' + esc(b.name || "Unnamed business") + '</span>' +
        '<span>' + esc(est ? "about " + est : (b.supported === true ? tierWord(b.tier) : "Business report needed")) + '</span>' +
        (bits.length ? '<span class="fpc-cap">' + esc(bits.join(" · ")) + '</span>' : "") + '</li>';
    }).join("");
    return '<section class="fpc-block" aria-labelledby="fpc-biz"><h3 id="fpc-biz">Each business at month ' + esc(sel) + '</h3>' +
      (rows ? '<ul class="fpc-bizlist">' + rows + '</ul><p class="fpc-cap">Each business is its own UnderwriteIQ estimate.</p>'
        : '<p class="fpc-cap">No business on file yet.</p>') + '</section>';
  }

  function reasons(d) {
    var rs = list(d.now && d.now.fundhub_score && d.now.fundhub_score.reasons);
    if (!rs.length) return "";
    return '<section class="fpc-block" aria-labelledby="fpc-why"><h3 id="fpc-why">What moves the score most</h3><ol class="fpc-reasons">' +
      rs.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join("") + '</ol></section>';
  }

  function assumes(d) {
    var p = point(d, d.months, (d.roadmap && d.roadmap.scenario) || "plan");
    var rows = list(p && p.assumptions).concat(list(d.assumes));
    if (!rows.length) return "";
    return '<details class="fpc-assume"><summary>What this assumes</summary><ul>' +
      rows.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul></details>';
  }

  /* ── whole states ──────────────────────────────────────────────────────── */

  function render(d) {
    if (!d || d.has_pull !== true) return renderEmpty(d);
    var r = d.roadmap || {};
    return head() +
      (d.sample ? '<p class="fpc-sample">Sample report. These numbers come from a sample credit report.</p>' : "") +
      '<p class="fpc-close" data-fpc-closing>' + esc(r.closing_line || "") + '</p>' +
      picks(d.months) + compare(d) + steps(d) + businesses(d) + reasons(d) + assumes(d);
  }

  function renderEmpty(d) {
    var sel = d && isNum(d.months) ? d.months : DEFAULT_MONTH;
    return head() + '<p class="fpc-close">No credit report on file yet. Run the soft pull, then this card shows the plan.</p>' +
      '<p class="fpc-cap">Month ' + esc(sel) + ' shows up after the pull.</p>';
  }

  function renderLoading(months) {
    return head() + picks(months) +
      '<div class="fpc-cols" aria-busy="true"><div class="fpc-col fpc-skel"></div><div class="fpc-col fpc-skel"></div></div>' +
      '<p class="fpc-cap">Loading month ' + esc(months) + '…</p>';
  }

  function renderError(months) {
    return head() + picks(months) +
      '<div class="fpc-error" role="alert"><p>We could not load the plan right now.</p>' +
      '<button type="button" class="fpc-btn" data-fpc-act="retry">Try again</button></div>';
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }
  function get(path) {
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

  function mount(el) {
    if (!el || el.__fhPlanCard) return el && el.__fhPlanCard;
    var state = { cid: "", months: DEFAULT_MONTH, cache: {}, seq: 0, off: false };

    function clientId() {
      var v = el.getAttribute("data-client-id") || root.__FH_CLIENT_ID || param("client_id") || param("id") || "";
      return UUID.test(String(v).trim()) ? String(v).trim() : "";
    }
    /* Waits while it sits inside a hidden tab, so a closed tab costs no read. */
    function visible() {
      var up = el.parentElement;
      return !(up && up.closest && up.closest("[hidden]"));
    }
    function paint(html) {
      var a = root.document.activeElement;
      var keep = a && el.contains(a) ? (a.getAttribute("data-fpc-month") ? '[data-fpc-month="' + a.getAttribute("data-fpc-month") + '"]'
        : (a.hasAttribute("data-fpc-any") ? "[data-fpc-any]" : null)) : null;
      el.innerHTML = html;
      if (keep) { var b = el.querySelector(keep); if (b) b.focus(); }
    }
    function load(months) {
      state.months = months;
      var key = state.cid + ":" + months;
      if (state.cache[key]) { paint(render(state.cache[key])); return Promise.resolve(); }
      var seq = ++state.seq;
      paint(renderLoading(months));
      return get(PATH + "?view=plan&months=" + months + "&client_id=" + encodeURIComponent(state.cid)).then(function (res) {
        if (seq !== state.seq) return;
        if (res.status === 401 || res.status === 403) { state.off = true; el.hidden = true; return; }
        if (res.status === 200 && res.body && res.body.view === "plan") {
          state.cache[key] = res.body;
          paint(render(res.body));
          return;
        }
        paint(renderError(months));
      });
    }
    function check() {
      if (state.off) return;
      var cid = clientId();
      if (!cid) { el.hidden = true; return; }
      if (cid === state.cid || !visible()) return;
      state.cid = cid;
      state.cache = {};
      el.hidden = false;
      load(state.months);
    }
    function pick(n) {
      n = Number(n);
      if (!(n >= 1 && n <= MAX) || Math.floor(n) !== n) return;
      load(n);
    }
    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-fpc-month],[data-fpc-act]") : null;
      if (!t || !el.contains(t)) return;
      if (t.getAttribute("data-fpc-act") === "retry") { load(state.months); return; }
      pick(t.getAttribute("data-fpc-month"));
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-fpc-any")) pick(t.value);
    });
    check();
    var timer = root.setInterval(check, 1000);
    var api = { reload: function () { state.cache = {}; return load(state.months); }, stop: function () { root.clearInterval(timer); } };
    el.__fhPlanCard = api;
    return api;
  }

  function start() {
    var els = root.document.querySelectorAll("[data-fh-plan-card]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  root.FHPlanCard = { render: render, renderEmpty: renderEmpty, renderLoading: renderLoading, renderError: renderError, mount: mount, money: money };

  if (root.document && root.document.querySelectorAll) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(typeof window !== "undefined" ? window : globalThis);
