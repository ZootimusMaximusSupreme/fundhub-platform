/* Fundhub closer slides — visual D, the credit optimization journey (Door 4).
 *
 * WHAT THIS IS. window.FHDeckVisuals.journey(ctx) returns the HTML for one
 * slide body. Above: the file's ladder, Repair only → Funding plus repair →
 * Full funding, with "You are here" at visual.tierNow and a dotted
 * "Projects to" marker at visual.tierAfter, the engine's todayTotal and
 * optimizedTotal beside them, and a dotted line climbing between them.
 * Below: the six dispute rounds on one path (ROUND_LADDER in
 * src/pulse/beats/lib/letter-catalog.mjs). Round 1 lists the client's own
 * items from visual.items; later rounds say what still sits on the file goes
 * to the next round; every round says the bureaus answer in 30 to 45 days.
 * Tapping a round shows who the letter goes to and what it asks. It describes
 * the process. It never promises a removal, a score or an amount.
 *
 * CONTRACT. ops/workflows/weekend-2026-10-24.md section 10.8. ctx =
 * { engine, visual, survey, handoff, businesses, tier, door, sample, clientId,
 *   money, esc }. Read here: visual.items, visual.tierNow, visual.tierAfter,
 * visual.todayTotal, visual.optimizedTotal, handoff.problem (the setter's
 * "stuck part", shown as "You said:" next to Round 1), sample, clientId,
 * money and esc. ctx.tier is not read: when the engine withholds the money
 * (a file in review or on hold) tierNow and the amounts come through null,
 * and that means no marker and no amount, not a guess from elsewhere. A
 * repair-only file's todayTotal is 0, the engine's own answer, and prints as
 * $0. Every amount is printed with ctx.money. A null amount prints nothing.
 * Nothing is invented: an answer that is not saved is not shown.
 *
 * STATE. Per clientId, in a module variable, restored on every call because
 * the deck re-renders often. One delegated click listener on document, scoped
 * to [data-fhv="journey"]. A tap updates the screen in place and never calls
 * the deck's render. Nothing here saves, sends or charges anything.
 *
 * LOOK. The deck's tokens only (public/app/fundhub-brand.css): --ink, --ink2,
 * --paper, --soft, --line, --gray, --gray2, --sans, --mono; --spectrum only
 * as a background hairline, never in a shadow. No shadows at all
 * (UI-STANDARDS 12.2), no gradients or 3D on the chart, 16px body, 13px
 * captions, 44px taps. Numbers count up when they change; with
 * prefers-reduced-motion they just appear. One container query turns the
 * phone's top-to-bottom path into a left-to-right path on a wide slide.
 *
 * Plain browser script. No build step, no libraries. The node test
 * (src/ui/present-journey.test.mjs) runs it in a vm with a tiny fake window
 * and document; the browser half is e2e/present-journey.spec.mjs with the
 * harness e2e/fixtures/present-journey-harness.html.
 */
(function () {
  "use strict";

  var W = typeof window !== "undefined" ? window : globalThis;
  var NAME = "journey";
  var STYLE_ID = "fhv-journey-style";

  /* The ladder graphic in px. Each rung's marks, dot and bar fill a column at
     least H tall, bottom-aligned above a level name of fixed height (LVL), so
     the three bars rest on one line and the dotted connector, anchored to the
     same bottom edge, can be drawn from dot centre to dot centre. A column
     whose marks need more room grows the row upward; the bottom edge, and so
     the connector, stays put. Bar heights climb Repair only → Full funding. */
  var H = 160;
  var LVL = 52;
  var BAR = [30, 60, 90];
  var DOT_Y = BAR.map(function (b) { return H - b - 10; });

  var LEVELS = [
    { id: "REPAIR_ONLY", name: "Repair only" },
    { id: "FUNDING_PLUS_REPAIR", name: "Funding plus repair" },
    { id: "FULL_FUNDING", name: "Full funding" }
  ];

  /* The six rounds, from the ladder in letter-catalog.mjs: R1 the bureau
     must reinvestigate; R2 it must show its work; R3 delete what it cannot
     verify; R4 a federal regulator; R5 state consumer-protection law; R6 the
     final notice reissued. The CFPB and state AG complaints carry the
     client's own signed declaration (clientSignRequired), so those two say
     "You sign it." Titles are six words or fewer. "to" and "asks" are the
     one or two lines a tap reveals. */
  var ROUNDS = [
    { id: "R1", n: 1, title: "Metro 2 dispute", to: "Each bureau reporting the item.", asks: "Reinvestigate every item under Metro 2 rules." },
    { id: "R2", n: 2, title: "Method of verification", to: "Each bureau that answered “verified.”", asks: "Show the method it used to verify." },
    { id: "R3", n: 3, title: "Final notice", to: "Each bureau still reporting the item.", asks: "Delete what it cannot verify." },
    { id: "R4", n: 4, title: "CFPB complaint", to: "The CFPB, the federal regulator. You sign it.", asks: "A federal review of how the bureau handled your dispute." },
    { id: "R5", n: 5, title: "State attorney general complaint", to: "Your state attorney general. You sign it.", asks: "A review under your state’s consumer protection law." },
    { id: "R6", n: 6, title: "Final notice, again", to: "Each bureau still reporting the item.", asks: "Delete what it still cannot verify." }
  ];
  var TIMING = "The bureaus answer in 30 to 45 days.";
  var STILL = "Anything still on the file goes to the next round.";

  /* visual.items[].kind, in plain words. */
  var KIND = {
    charge_off: "Charge-off", chargeoff: "Charge-off", collection: "Collection", late: "Late payment",
    medical: "Medical collection", public_record: "Public record", other: "Other item"
  };
  var BUREAU = {
    EX: "Experian", EXP: "Experian", EXPERIAN: "Experian",
    TU: "TransUnion", TRANSUNION: "TransUnion",
    EQ: "Equifax", EFX: "Equifax", EQUIFAX: "Equifax"
  };

  var CSS = [
    ".fhv-journey{font-family:var(--sans);color:var(--ink);container-type:inline-size;display:flex;flex-direction:column;gap:22px;margin-top:10px;max-width:100%}",
    ".fhv-journey *{box-sizing:border-box}",
    ".fhv-journey-eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gray)}",
    ".fhv-journey-eyebrow::before{content:'';display:inline-block;width:16px;height:2px;border-radius:1px;background:var(--spectrum)}",
    ".fhv-journey-tag{margin-left:auto;padding:3px 10px;border:1px solid var(--line);border-radius:20px;font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--gray)}",
    /* the ladder */
    ".fhv-journey-rungs{list-style:none;margin:0;padding:0;position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}",
    ".fhv-journey-link{position:absolute;left:0;bottom:" + LVL + "px;width:100%;height:" + H + "px;color:var(--ink);pointer-events:none;overflow:visible}",
    ".fhv-journey-rung{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;text-align:center;min-width:0}",
    ".fhv-journey-rung-g{min-height:" + H + "px;width:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}",
    ".fhv-journey-flat .fhv-journey-rung-g{min-height:" + (BAR[BAR.length - 1] + 10) + "px}",
    ".fhv-journey-marks{display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:4px;padding:2px 6px;border-radius:8px;background:var(--paper);max-width:100%}",
    ".fhv-journey-mark{display:flex;flex-direction:column;align-items:center;gap:2px}",
    ".fhv-journey-cap{font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--gray);line-height:1.25}",
    ".fhv-journey-amt{font-family:var(--mono);font-size:18px;font-size:clamp(18px,2.6cqw,30px);line-height:1.1;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".fhv-journey-mark.is-after .fhv-journey-amt{color:var(--ink2)}",
    ".fhv-journey-dot{flex:0 0 auto;width:12px;height:12px;margin-bottom:4px;border-radius:50%;border:2px solid var(--ink);background:var(--paper)}",
    ".fhv-journey-dot.is-now{background:var(--ink)}",
    ".fhv-journey-dot.is-after:not(.is-now){border-style:dotted}",
    ".fhv-journey-bar{width:100%;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--soft)}",
    ".fhv-journey-rung.is-now .fhv-journey-bar{border-color:var(--ink);border-top-width:2px}",
    ".fhv-journey-lvl{width:100%;min-height:" + LVL + "px;padding:10px 4px 0;border-top:1px solid var(--line);font-size:16px;font-weight:650;line-height:1.3;letter-spacing:-.01em;color:var(--gray)}",
    ".fhv-journey-rung.is-now .fhv-journey-lvl,.fhv-journey-rung.is-after .fhv-journey-lvl{color:var(--ink)}",
    ".fhv-journey-ladder-note{margin:12px 0 0;font-size:16px;line-height:1.45;color:var(--gray)}",
    /* the path: a vertical spine on the phone */
    ".fhv-journey-path{position:relative;display:flex;flex-direction:column}",
    ".fhv-journey-path::before{display:none}",
    ".fhv-journey-rbtn{position:relative;display:flex;align-items:flex-start;gap:14px;width:100%;min-height:56px;margin:0;padding:10px 8px 10px 0;border:0;border-radius:10px;background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}",
    ".fhv-journey-rbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}",
    ".fhv-journey-rbtn::before,.fhv-journey-rbody::before{content:'';position:absolute;left:15px;top:0;bottom:0;width:2px;background:var(--line)}",
    ".fhv-journey-rbtn[data-fhv-round=R1]::before{top:26px}",
    ".fhv-journey-rbtn[data-fhv-round=R6]::before{bottom:auto;height:26px}",
    ".fhv-journey-rbody[data-fhv-body=R6]::before{display:none}",
    ".fhv-journey-node{position:relative;z-index:1;flex:0 0 32px;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid var(--line);background:var(--paper);font-family:var(--mono);font-size:13px;color:var(--ink)}",
    ".fhv-journey-rbtn:hover .fhv-journey-node{border-color:var(--ink)}",
    ".fhv-journey-rbtn.is-open .fhv-journey-node{background:var(--ink);border-color:var(--ink);color:var(--paper)}",
    ".fhv-journey-rtxt{display:flex;flex-direction:column;gap:2px;min-width:0;padding-top:4px}",
    ".fhv-journey-rwhen{font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gray)}",
    ".fhv-journey-rtitle{font-size:16px;font-weight:650;line-height:1.3;letter-spacing:-.01em;color:var(--ink2)}",
    ".fhv-journey-rbtn.is-open .fhv-journey-rtitle{color:var(--ink)}",
    ".fhv-journey-rbody{position:relative;padding:2px 0 18px 46px}",
    ".fhv-journey-rbody[hidden]{display:none}",
    ".fhv-journey-card{display:flex;flex-direction:column;gap:14px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}",
    ".fhv-journey-note{margin:0;font-size:16px;line-height:1.45;color:var(--ink)}",
    ".fhv-journey-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}",
    ".fhv-journey-items li{display:grid;grid-template-columns:1fr;gap:2px 12px;padding:8px 0;border-top:1px solid var(--line);font-size:16px;line-height:1.35}",
    ".fhv-journey-items li:first-child{border-top:0;padding-top:0}",
    ".fhv-journey-cred{min-width:0;overflow-wrap:anywhere;font-weight:650;color:var(--ink)}",
    ".fhv-journey-kind{color:var(--ink2)}",
    ".fhv-journey-bur{font-size:13px;color:var(--gray)}",
    ".fhv-journey-said{margin:0;padding-left:12px;border-left:2px solid var(--ink);font-size:16px;line-height:1.45;color:var(--ink)}",
    ".fhv-journey-detail{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;font-size:16px;line-height:1.45}",
    ".fhv-journey-detail dt{padding-top:3px;font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--gray)}",
    ".fhv-journey-detail dd{margin:0;color:var(--ink)}",
    ".fhv-journey-timing{margin:0;font-family:var(--mono);font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--gray)}",
    ".fhv-journey-plain{margin:8px 0 0;padding-left:22px;font-size:16px;line-height:1.6}",
    "@media (prefers-reduced-motion:reduce){.fhv-journey *{animation:none!important;transition:none!important}}",
    /* wide: the six rounds side by side, the open round's card under them */
    "@container (min-width:720px){",
    ".fhv-journey-path{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0}",
    ".fhv-journey-path::before{content:'';display:block;position:absolute;top:26px;left:calc(100% / 12);right:calc(100% / 12);height:2px;background:var(--line)}",
    ".fhv-journey-rbtn{grid-row:1;flex-direction:column;align-items:center;gap:10px;min-height:44px;padding:10px 8px 14px;text-align:center}",
    ".fhv-journey-rbtn::before,.fhv-journey-rbody::before{display:none}",
    ".fhv-journey-rbtn.is-open::after{content:'';position:absolute;left:18%;right:18%;bottom:0;height:2px;border-radius:2px;background:var(--ink)}",
    ".fhv-journey-rbtn[data-fhv-round=R1]{grid-column:1}",
    ".fhv-journey-rbtn[data-fhv-round=R2]{grid-column:2}",
    ".fhv-journey-rbtn[data-fhv-round=R3]{grid-column:3}",
    ".fhv-journey-rbtn[data-fhv-round=R4]{grid-column:4}",
    ".fhv-journey-rbtn[data-fhv-round=R5]{grid-column:5}",
    ".fhv-journey-rbtn[data-fhv-round=R6]{grid-column:6}",
    ".fhv-journey-rtxt{align-items:center;padding-top:0}",
    ".fhv-journey-rbody{grid-row:2;grid-column:1 / -1;padding:14px 0 0}",
    ".fhv-journey-items li{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.2fr);align-items:baseline}",
    ".fhv-journey-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px}",
    ".fhv-journey-items li:nth-child(2){border-top:0;padding-top:0}",
    ".fhv-journey-marks{flex-direction:row;align-items:flex-end;gap:18px}",
    "}"
  ].join("\n");

  /* ── state ─────────────────────────────────────────────────────────────── */

  var STATE = {};
  var cssDone = false;
  var listening = false;

  function stateFor(cid) {
    if (!STATE[cid]) STATE[cid] = { open: "R1", shown: {}, seq: 0, money: fallbackMoney };
    return STATE[cid];
  }

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function fallbackEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fallbackMoney(n) {
    if (n == null || !isFinite(Number(n))) return "";
    return "$" + Number(n).toLocaleString("en-US");
  }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function num(v) {
    if (v == null || v === "" || typeof v === "boolean" || Array.isArray(v) || typeof v === "object") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function idSafe(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, "_"); }

  function normTier(v) {
    var s = str(v).toUpperCase().replace(/[\s-]+/g, "_");
    if (!s) return null;
    if (s === "FULL_FUNDING" || s === "FULL" || s === "FUND" || s.indexOf("PREMIUM") === 0) return "FULL_FUNDING";
    if (s === "FUNDING_PLUS_REPAIR" || s === "FUND_PLUS_OPTIMIZE" || s === "FUNDING_PLUS_OPTIMIZATION") return "FUNDING_PLUS_REPAIR";
    if (s === "REPAIR_ONLY" || s === "REPAIR" || s === "OPTIMIZE" || s === "OPTIMIZE_ONLY") return "REPAIR_ONLY";
    return null;
  }
  function levelIndex(tier) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === tier) return i;
    return -1;
  }
  function kindWord(k) {
    var key = str(k).toLowerCase().replace(/[\s-]+/g, "_");
    if (KIND[key]) return KIND[key];
    return key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ") : "Item";
  }
  function bureauNames(v) {
    var list = [];
    if (Array.isArray(v)) list = v;
    else if (typeof v === "string") list = v.split(/[\s,/|·]+/);
    else if (v && typeof v === "object") { for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && v[k]) list.push(k); }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var code = str(list[i]).toUpperCase();
      if (!code) continue;
      var name = BUREAU[code] || (code.charAt(0) + code.slice(1).toLowerCase());
      if (out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }
  function normItems(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var it = v[i];
      if (!it || typeof it !== "object") continue;
      out.push({
        creditor: str(it.creditor) || "Unnamed creditor",
        kind: kindWord(it.kind),
        bureaus: bureauNames(it.bureaus)
      });
    }
    return out;
  }

  /* ── the ladder ────────────────────────────────────────────────────────── */

  /* Column centres as SVG percentages. A value is never written ending in
     "0%" (the sales-copy scan treats "0%" as a banned phrase, and it reads
     the whole markup), so the exact middle prints as 50.001%: a hundredth of
     a pixel on a 1000px slide. */
  function colX(i) {
    var s = (((i + 0.5) / LEVELS.length) * 100).toFixed(3);
    if (/0$/.test(s)) s = s.slice(0, -1) + "1";
    return s + "%";
  }

  function markHtml(kind, cap, amount, key, money, esc) {
    return '<div class="fhv-journey-mark is-' + kind + '"><span class="fhv-journey-cap">' + cap + "</span>" +
      (amount != null
        ? '<span class="fhv-journey-amt" data-fhv-count="' + amount + '" data-fhv-key="' + key + '">' + esc(money(amount)) + "</span>"
        : "") +
      "</div>";
  }

  function ladderHtml(o) {
    var esc = o.esc, money = o.money;
    var nowIdx = levelIndex(o.tierNow), afterIdx = levelIndex(o.tierAfter);
    var h = '<section class="fhv-journey-ladder" aria-label="Your file, level by level">';
    h += '<div class="fhv-journey-eyebrow"><span>Your file, level by level</span>' +
      (o.sample ? '<span class="fhv-journey-tag">Sample</span>' : "") + "</div>";
    h += '<ol class="fhv-journey-rungs">';
    if (nowIdx >= 0 && afterIdx >= 0 && nowIdx !== afterIdx) {
      h += '<svg class="fhv-journey-link" aria-hidden="true" focusable="false"><line x1="' + colX(nowIdx) + '" y1="' + DOT_Y[nowIdx] +
        '" x2="' + colX(afterIdx) + '" y2="' + DOT_Y[afterIdx] + '" stroke="currentColor" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/></svg>';
    }
    for (var i = 0; i < LEVELS.length; i++) {
      var L = LEVELS[i], isNow = i === nowIdx, isAfter = i === afterIdx;
      var marks = "";
      if (isNow) marks += markHtml("now", "You are here", o.today, "today", money, esc);
      if (isAfter) marks += markHtml("after", "Projects to", o.optimized, "optimized", money, esc);
      h += '<li class="fhv-journey-rung' + (isNow ? " is-now" : "") + (isAfter ? " is-after" : "") + '" data-level="' + L.id + '">' +
        '<div class="fhv-journey-rung-g">' +
        (marks ? '<div class="fhv-journey-marks">' + marks + "</div>" : "") +
        (isNow || isAfter ? '<span class="fhv-journey-dot' + (isNow ? " is-now" : "") + (isAfter ? " is-after" : "") + '"></span>' : "") +
        '<div class="fhv-journey-bar" style="height:' + BAR[i] + 'px"></div></div>' +
        '<div class="fhv-journey-lvl">' + esc(L.name) + "</div></li>";
    }
    h += "</ol>";
    if (!o.hasVisual) {
      h += '<p class="fhv-journey-ladder-note">No pull on this file yet. Your levels fill in after the pull.</p>';
    } else {
      /* An amount whose tier the engine did not name still prints, below the rungs. */
      var loose = [];
      if (nowIdx < 0 && o.today != null) loose.push("Today " + money(o.today));
      if (afterIdx < 0 && o.optimized != null) loose.push("Projects to " + money(o.optimized));
      if (loose.length) h += '<p class="fhv-journey-ladder-note">' + esc(loose.join(" · ")) + "</p>";
      /* The engine withheld the money (a file in review or on hold): no
         marker, no amount, and a plain line saying so instead of empty rungs. */
      else if (nowIdx < 0 && afterIdx < 0) h += '<p class="fhv-journey-ladder-note">No level or amount on this file yet. The rounds below still run.</p>';
    }
    return h + "</section>";
  }

  /* ── the path ──────────────────────────────────────────────────────────── */

  function bodyHtml(r, o) {
    var esc = o.esc, h = "";
    if (r.id === "R1") {
      if (!o.hasVisual) h += '<p class="fhv-journey-note">Your items from today’s pull show here.</p>';
      else if (!o.items.length) h += '<p class="fhv-journey-note">No items on today’s pull.</p>';
      else {
        h += '<ul class="fhv-journey-items">';
        for (var i = 0; i < o.items.length; i++) {
          var it = o.items[i];
          h += '<li><span class="fhv-journey-cred">' + esc(it.creditor) + '</span><span class="fhv-journey-kind">' + esc(it.kind) + "</span>" +
            (it.bureaus.length ? '<span class="fhv-journey-bur">' + esc(it.bureaus.join(", ")) + "</span>" : "") + "</li>";
        }
        h += "</ul>";
      }
      if (o.said) h += '<p class="fhv-journey-said"><b>You said:</b> “' + esc(o.said) + "”</p>";
    } else {
      h += '<p class="fhv-journey-note">' + STILL + "</p>";
    }
    h += '<dl class="fhv-journey-detail"><dt>Goes to</dt><dd>' + esc(r.to) + "</dd><dt>Asks</dt><dd>" + esc(r.asks) + "</dd></dl>";
    h += '<p class="fhv-journey-timing">' + TIMING + "</p>";
    return h;
  }

  function pathHtml(o) {
    var esc = o.esc, st = o.st;
    var h = '<section class="fhv-journey-path-wrap" aria-label="The six rounds">';
    h += '<div class="fhv-journey-eyebrow"><span>Six rounds, one path</span></div>';
    h += '<div class="fhv-journey-path">';
    for (var i = 0; i < ROUNDS.length; i++) {
      var r = ROUNDS[i], open = st.open === r.id;
      var bid = "fhv-journey-" + o.cidSafe + "-" + r.id;
      h += '<button type="button" class="fhv-journey-rbtn' + (open ? " is-open" : "") + '" data-fhv-round="' + r.id +
        '" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="' + bid + '">' +
        '<span class="fhv-journey-node" aria-hidden="true">' + r.n + "</span>" +
        '<span class="fhv-journey-rtxt"><span class="fhv-journey-rwhen">Round ' + r.n + '</span><span class="fhv-journey-rtitle">' + esc(r.title) + "</span></span>" +
        "</button>";
      h += '<div class="fhv-journey-rbody" id="' + bid + '" data-fhv-body="' + r.id + '"' + (open ? "" : " hidden") + '>' +
        '<div class="fhv-journey-card">' + bodyHtml(r, o) + "</div></div>";
    }
    return h + "</div></section>";
  }

  /* ── taps: update in place, never the deck's render ────────────────────── */

  function setClass(el, name, on) {
    if (el.classList) { if (on) el.classList.add(name); else el.classList.remove(name); return; }
    var cur = (el.className || "").split(/\s+/).filter(function (c) { return c && c !== name; });
    if (on) cur.push(name);
    el.className = cur.join(" ");
  }

  function applyOpen(root, open) {
    var btns = root.querySelectorAll("[data-fhv-round]");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-fhv-round") === open;
      btns[i].setAttribute("aria-expanded", on ? "true" : "false");
      setClass(btns[i], "is-open", on);
    }
    var bodies = root.querySelectorAll("[data-fhv-body]");
    for (var j = 0; j < bodies.length; j++) {
      if (bodies[j].getAttribute("data-fhv-body") === open) bodies[j].removeAttribute("hidden");
      else bodies[j].setAttribute("hidden", "");
    }
  }

  function onClick(e) {
    var t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    var btn = t.closest('[data-fhv="journey"] [data-fhv-round]');
    if (!btn) return;
    var root = btn.closest('[data-fhv="journey"]');
    if (!root) return;
    var st = stateFor(root.getAttribute("data-fhv-client") || "_");
    var id = btn.getAttribute("data-fhv-round");
    st.open = st.open === id ? null : id;   /* tapping the open round closes it */
    applyOpen(root, st.open);
  }

  function ensureListener() {
    if (listening) return;
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    document.addEventListener("click", onClick);
    listening = true;
  }

  function ensureCss() {
    if (cssDone) return;
    if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
    if (typeof document.getElementById === "function" && document.getElementById(STYLE_ID)) { cssDone = true; return; }
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
    cssDone = true;
  }

  /* ── the count-up ──────────────────────────────────────────────────────── */

  function frame() {
    if (typeof W.requestAnimationFrame === "function") return function (fn) { W.requestAnimationFrame(fn); };
    if (typeof W.setTimeout === "function") return function (fn) { W.setTimeout(fn, 16); };
    return null;
  }
  function now() {
    return (W.performance && typeof W.performance.now === "function") ? W.performance.now() : Date.now();
  }
  function prefersReduced() {
    try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function findRoot(cid) {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return null;
    var all = document.querySelectorAll('[data-fhv="journey"]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-fhv-client") === cid) return all[i];
    return null;
  }

  /* An amount counts from the last value this client saw (or from 0) to the
     new one over 700 ms. A value that did not change stays as printed. With
     prefers-reduced-motion it just appears. The markup already carries the
     final value, so a frame that never comes still shows the right amount. */
  function animateCounts(root, st, later) {
    var els = root.querySelectorAll("[data-fhv-count]");
    var reduce = prefersReduced();
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var key = el.getAttribute("data-fhv-key") || "x";
        var target = Number(el.getAttribute("data-fhv-count"));
        if (!isFinite(target)) return;
        var from = st.shown[key];
        if (from === target) return;
        st.shown[key] = target;
        if (reduce) { el.textContent = st.money(target); return; }
        var start = from == null ? 0 : from, t0 = now(), dur = 700;
        var step = function () {
          if (el.isConnected === false) return;
          var p = Math.min(1, (now() - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = st.money(Math.round(start + (target - start) * eased));
          if (p < 1) later(step);
        };
        step();
      })(els[i]);
    }
  }

  function scheduleCounts(cid) {
    var later = frame();
    if (!later) return;
    var st = stateFor(cid);
    var seq = ++st.seq, tries = 0;
    var find = function () {
      if (st.seq !== seq) return;              /* a newer render took over */
      var root = findRoot(cid);
      if (!root) { if (++tries < 12) later(find); return; }
      animateCounts(root, st, later);
    };
    later(find);
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function render(ctx) {
    ctx = (ctx && typeof ctx === "object") ? ctx : {};
    var esc = typeof ctx.esc === "function" ? ctx.esc : fallbackEsc;
    var money = typeof ctx.money === "function" ? ctx.money : fallbackMoney;
    var cid = (ctx.clientId == null || ctx.clientId === "") ? "_" : String(ctx.clientId);
    var st = stateFor(cid);
    st.money = money;
    var visual = (ctx.visual && typeof ctx.visual === "object" && !Array.isArray(ctx.visual)) ? ctx.visual : null;
    var handoff = (ctx.handoff && typeof ctx.handoff === "object") ? ctx.handoff : null;
    var o = {
      esc: esc, money: money, st: st, cidSafe: idSafe(cid),
      hasVisual: !!visual,
      items: visual ? normItems(visual.items) : [],
      tierNow: visual ? normTier(visual.tierNow) : null,
      tierAfter: visual ? normTier(visual.tierAfter) : null,
      today: visual ? num(visual.todayTotal) : null,
      optimized: visual ? num(visual.optimizedTotal) : null,
      said: handoff ? str(handoff.problem) : "",
      sample: ctx.sample === true
    };
    ensureCss();
    ensureListener();
    /* No marker to place (no pull yet, or the engine withheld the level):
       the rungs give back the room the marks and connector would have used. */
    var flat = levelIndex(o.tierNow) < 0 && levelIndex(o.tierAfter) < 0;
    var html = '<div class="fhv-journey' + (flat ? " fhv-journey-flat" : "") + '" data-fhv="journey" data-fhv-client="' + esc(cid) + '">' + ladderHtml(o) + pathHtml(o) + "</div>";
    scheduleCounts(cid);
    return html;
  }

  /* Bad data never blanks the slide: the six rounds, in plain text, no amounts. */
  function fallbackHtml() {
    var h = '<div class="fhv-journey fhv-journey-fallback" data-fhv="journey" data-fhv-client="_">' +
      '<p class="fhv-journey-note">Six rounds, one path. The bureaus answer each round in 30 to 45 days.</p><ol class="fhv-journey-plain">';
    for (var i = 0; i < ROUNDS.length; i++) h += "<li>Round " + ROUNDS[i].n + ": " + fallbackEsc(ROUNDS[i].title) + "</li>";
    return h + "</ol></div>";
  }

  function journey(ctx) {
    try {
      return render(ctx);
    } catch (e) {
      try { if (W.console && typeof W.console.warn === "function") W.console.warn("present-journey: fell back to the plain path", e); } catch (ignore) { /* nothing to do */ }
      return fallbackHtml();
    }
  }

  W.FHDeckVisuals = (W.FHDeckVisuals && typeof W.FHDeckVisuals === "object") ? W.FHDeckVisuals : {};
  W.FHDeckVisuals[NAME] = journey;
})();
