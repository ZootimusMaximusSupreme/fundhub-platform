// The closer's clickable visuals for the sales slides: E "Your path", A "Money
// levers" and B "More companies, more funding" (sales-slides build, unit W3,
// 2026-10-29). Board: ops/workflows/weekend-2026-10-24.md sections 10.3 to 10.8.
//
// WHAT THIS IS. A plain browser script. It adds three functions to
// window.FHDeckVisuals — yourPath(ctx), moneyLevers(ctx), lenderWall(ctx) and companies(ctx) —
// and each one returns the HTML for a slide body. present.js calls them where
// the script places each visual (10.0) and falls back to today's content when
// this file or engine.visual is missing.
//
// THE NUMBERS ARE NEVER OURS. Every dollar is ctx.visual (engine.visual, built
// by src/sales/deck-visual-data.mjs from the engine's own run) and is printed
// with ctx.money. A null value prints no amount; the step still shows. Nothing
// here promises an approval, an amount, a score or a removal. Projections say
// "projects to". The added companies on visual B are a picture of what's
// possible and never join today's total (Chris, 2026-10-29).
//
// STATE. The deck re-renders often, so each visual keeps its own state per
// client in a module map and restores it when it is called again. Taps are one
// delegated click listener on document, scoped to [data-fhv="<name>"]; a tap
// re-draws that visual in place from its state and never calls the deck's
// render. Tapping saves nothing, sends nothing and charges nothing.
//
// LOOK. The deck's own tokens from fundhub-brand.css (ink, paper, soft, line,
// the pastel status stops) and fonts (var(--sans), var(--mono)). The spectrum
// is a background only. No gradients or 3D on the charts. Body text 16px,
// captions 13px, every tap target a real <button> of at least 44px. Numbers
// count up when they change; with prefers-reduced-motion they just appear.
//
// SIZES IN THE MARKUP ARE UNITLESS. Bars, the goal line and the company layers
// are sized through custom properties (--h, --b, --l, --g) that the stylesheet
// turns into lengths, so the HTML never carries a "%" and a copy checker never
// mistakes a bar height for a rate.
(function (root) {
  "use strict";
  const doc = root.document;
  const V = root.FHDeckVisuals = root.FHDeckVisuals || {};

  /* ── state: per visual, per client ─────────────────────────────────────── */
  const state = { path: {}, levers: {}, findings: {}, wall: {}, companies: {} };
  const lastCtx = { path: {}, levers: {}, findings: {}, wall: {}, companies: {} };
  /* The amounts last drawn, so a number counts from what the screen showed. */
  const shown = {};

  const FALLBACK_LINE = "This picture can't draw this file right now. The rest of the slide still works.";

  /* ── small helpers ─────────────────────────────────────────────────────── */
  function ownEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function ownMoney(n) { return "$" + Number(n).toLocaleString("en-US"); }
  function isNum(n) { return typeof n === "number" && Number.isFinite(n); }
  function num(v) {
    if (v == null || v === "" || typeof v === "boolean") return null;
    if (typeof v === "object") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function text(v) {
    if (v == null || typeof v === "object" || typeof v === "boolean") return "";
    const s = String(v).trim();
    /* A bare ClickFunnels option id is not an answer (present.js isOptionId). */
    if (/^\d{5,}$/.test(s)) return "";
    return s;
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function clientOf(ctx) { return text(ctx && ctx.clientId) || "anon"; }
  function escOf(ctx) { return ctx && typeof ctx.esc === "function" ? ctx.esc : ownEsc; }
  /** Prints an amount, or nothing when the value is not a finite number. */
  function amtOf(ctx) {
    const money = ctx && typeof ctx.money === "function" ? ctx.money : ownMoney;
    return function (n) { return isNum(n) ? String(money(n)) : ""; };
  }
  function pct(part, whole) {
    if (!isNum(part) || !isNum(whole) || whole <= 0) return 0;
    return Math.max(0, Math.min(100, (part / whole) * 100));
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  const TIER_WORDS = {
    FULL_FUNDING: "Full funding",
    PREMIUM_STACK: "Full funding",
    FUNDING_PLUS_REPAIR: "Funding plus repair",
    REPAIR_ONLY: "Repair only"
  };
  function tierWords(t) {
    const s = text(t);
    if (!s) return "";
    if (TIER_WORDS[s]) return TIER_WORDS[s];
    const plain = s.replace(/_/g, " ").toLowerCase();
    return plain.charAt(0).toUpperCase() + plain.slice(1);
  }

  /** "$100k - $200k" → { low, high, label }. One amount → low === high. */
  function parseGoal(raw) {
    const label = text(raw);
    if (!label) return null;
    const found = [];
    const re = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?(?![\d,])/g;
    let m;
    while ((m = re.exec(label))) {
      let n = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      if (m[2] && /k/i.test(m[2])) n *= 1000;
      if (m[2] && /m/i.test(m[2])) n *= 1000000;
      found.push(n);
    }
    if (!found.length) return null;
    const low = Math.min.apply(null, found);
    const high = Math.max.apply(null, found);
    if (!(low > 0)) return null;
    return { low, high, label };
  }

  /* ── motion ────────────────────────────────────────────────────────────── */
  function reducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }
  const raf = typeof root.requestAnimationFrame === "function"
    ? function (fn) { root.requestAnimationFrame(fn); } : null;
  const later = typeof root.setTimeout === "function"
    ? function (fn) { root.setTimeout(fn, 0); } : null;

  /** The amount the screen last showed for this key, and remember the new one. */
  function fromTo(client, key, to) {
    const bag = shown[client] || (shown[client] = {});
    const from = isNum(bag[key]) ? bag[key] : 0;
    bag[key] = isNum(to) ? to : null;
    return from;
  }

  /** Counts every [data-fhv-count] up (or down) and lets every [data-fhv-grow]
   *  size move from where it was. Nothing moves with reduced motion or in a
   *  document that cannot animate (the node test's fake document). */
  function animateIn(host, ctx) {
    if (!host || typeof host.querySelectorAll !== "function") return;
    const calm = reducedMotion() || !raf;
    if (calm) return;
    const amt = amtOf(ctx);
    const counters = host.querySelectorAll("[data-fhv-count]");
    for (let i = 0; i < counters.length; i++) {
      const el = counters[i];
      const to = num(el.getAttribute("data-fhv-count"));
      const from = num(el.getAttribute("data-fhv-from"));
      if (!isNum(to) || !isNum(from) || from === to) continue;
      const prefix = el.getAttribute("data-fhv-prefix") || "";
      countUp(el, from, to, function (v) { return prefix + amt(v); });
    }
    const grows = host.querySelectorAll("[data-fhv-grow]");
    for (let j = 0; j < grows.length; j++) {
      const el = grows[j];
      const prop = el.getAttribute("data-fhv-grow");
      const from = el.getAttribute("data-fhv-grow-from");
      const to = el.getAttribute("data-fhv-grow-to");
      if (!prop || from == null || to == null || from === to || !el.style || typeof el.style.setProperty !== "function") continue;
      el.style.setProperty(prop, from);
      // A layout read, so the transition starts from `from` and not from `to`.
      if (typeof el.getBoundingClientRect === "function") el.getBoundingClientRect();
      raf(function () { el.style.setProperty(prop, to); });
    }
  }

  function countUp(el, from, to, fmt) {
    const start = Date.now();
    const ms = 700;
    const step = function () {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(Math.round(from + (to - from) * eased));
      if (t < 1) raf(step);
      else el.textContent = fmt(to);
    };
    raf(step);
  }

  /** After the deck inserts the HTML, find the host and run the animations. */
  function scheduleAnimate(name, client, ctx) {
    if (!later || !doc || typeof doc.querySelector !== "function") return;
    later(function () {
      try {
        const host = doc.querySelector('[data-fhv="' + name + '"][data-fhv-client="' + cssEsc(client) + '"]');
        if (host) animateIn(host, ctx);
        if (host && name === "companies") fitToSlide(host);
      } catch (e) { /* the slide moved on */ }
    });
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* C-01 is the tallest slide. On a laptop screen "Funding partners for life"
     and the proof used to sit below the edge (2026-10-30). The layout is
     tighter on a short screen; when it is still taller than the slide, it
     shrinks to fit, never below 80 percent. Outside the deck's slide (a test
     page) and on a phone nothing changes. */
  const FIT_MIN = 0.8;
  function fitToSlide(host) {
    if (!host || !host.style || typeof host.getBoundingClientRect !== "function") return;
    const box = closest(host, ".slide-body");
    if (!box || typeof box.clientHeight !== "number") return;
    host.style.zoom = "";
    // A narrow slide (a phone) stacks and scrolls on purpose; it never shrinks.
    if (host.getBoundingClientRect().width <= 680) return;
    let zoom = 1;
    // Twice: a shrunk slide also gets wider, so its text wraps less.
    for (let pass = 0; pass < 2; pass++) {
      const over = box.scrollHeight - box.clientHeight;
      if (over <= 1) break;
      const tall = host.getBoundingClientRect().height;
      if (!(tall > 0)) break;
      zoom = Math.max(FIT_MIN, zoom * (tall - over) / tall);
      host.style.zoom = String(Math.floor(zoom * 1000) / 1000);
      if (zoom <= FIT_MIN) break;
    }
  }
  if (root && typeof root.addEventListener === "function" && !V.__visualsFitBound) {
    let pending = false;
    root.addEventListener("resize", function () {
      if (pending || !raf || !doc || typeof doc.querySelectorAll !== "function") return;
      pending = true;
      raf(function () {
        pending = false;
        const hosts = doc.querySelectorAll('[data-fhv="companies"]');
        for (let i = 0; i < hosts.length; i++) fitToSlide(hosts[i]);
      });
    });
    V.__visualsFitBound = true;
  }

  /* ── shared markup ─────────────────────────────────────────────────────── */
  function sampleTag(ctx) {
    return ctx && ctx.sample === true ? '<span class="fhv-ui-tag">Sample</span>' : "";
  }
  /* The visual's title row: a section eyebrow (with the brand's dash) and the
     Sample tag on the right. */
  function head(ctx, eyebrow) {
    return '<div class="fhv-ui-head"><span class="fhv-ui-eyebrow is-section">' + ownEsc(eyebrow) + "</span>" + sampleTag(ctx) + "</div>";
  }
  function note(eyebrow, line) {
    return '<div class="fhv-ui-note"><span class="fhv-ui-eyebrow">' + ownEsc(eyebrow) + '</span><p class="fhv-ui-text">' + ownEsc(line) + "</p></div>";
  }
  function wrap(name, client, inner) {
    return '<div class="fhv-ui-root fhv-' + name + '" data-fhv="' + name + '" data-fhv-client="' + ownEsc(client) + '">' + inner + "</div>";
  }
  function fallback(name) {
    return '<div class="fhv-ui-root fhv-' + name + '" data-fhv="' + name + '">' + note("Not on this file yet", FALLBACK_LINE) + "</div>";
  }
  /** A hero amount that counts from what the screen last showed. */
  function bigNum(client, key, value, amt, prefix) {
    if (!isNum(value)) return "";
    const from = fromTo(client, key, value);
    return '<div class="fhv-ui-num' + (prefix ? " is-plus" : "") + '" data-fhv-count="' + value + '" data-fhv-from="' + from + '"' +
      (prefix ? ' data-fhv-prefix="' + ownEsc(prefix) + '"' : "") + ">" + ownEsc((prefix || "") + amt(value)) + "</div>";
  }
  /** A unitless size the stylesheet turns into a length, animated from the last
   *  one. `more` adds other unitless custom properties to the same style. */
  function grow(client, key, prop, value, more) {
    const v = round1(value);
    const bag = shown[client] || (shown[client] = {});
    const from = isNum(bag[key]) ? bag[key] : 0;
    bag[key] = v;
    return ' data-fhv-grow="' + prop + '" data-fhv-grow-from="' + from + '" data-fhv-grow-to="' + v + '" style="' + prop + ":" + v + (more || "") + '"';
  }

  /* ════════════════════════════════════════════════════════════════════════
     E. YOUR PATH — five stations, the door lit from ctx.door.
     Words come from the offers document (marketing/offers/fundhub-offers-2026-10-10.pdf)
     and the closer script. No prices here: the script names the door first.
     ════════════════════════════════════════════════════════════════════════ */
  const STATIONS = [
    { key: "today", name: "Your file today", sub: "Where you are",
      lines: [
        "What is on your report decides which door fits right now.",
        "If something on it hurts you, that gets fixed first. A file in good shape moves straight to funding."
      ] },
    { key: "clean", name: "Clean up", sub: "Credit optimization",
      lines: [
        "Up to six rounds of dispute letters, mailed for you. The bureaus answer each round in 30 to 45 days.",
        "Negative items, inquiries and old addresses, one round at a time. Every letter and every answer shows in your portal."
      ] },
    { key: "plan", name: "Your plan", sub: "Capital Blueprint",
      lines: [
        "A written plan built from your own report: each step, in order, as a checklist with due dates.",
        "The Fundhub team follows up until the tasks are done. When the file is ready, it hands you to funding."
      ] },
    { key: "fund", name: "Funded", sub: "Funding, done for you",
      lines: [
        "Fundhub picks the bank for every application and sends them in planned rounds. One funding sequence is about six rounds.",
        "Between rounds, a specialist works on the new inquiries. Funding in your name, your business's name, or both."
      ] },
    { key: "goal", name: "Your goal", sub: "Where this ends",
      lines: [
        "Each company you add brings its own business credit. Fundhub can run the next funding sequence when the file supports it."
      ] }
  ];
  const SIDE_DOOR = { key: "revenue", name: "Revenue funding", sub: "Off Funded, run by hand",
    lines: [
      "For a business with steady deposits. You upload your bank statements in the portal, and the team sends your file to the lender.",
      "It runs by hand for now, on the same funding agreement."
    ] };
  const DOOR_LIGHTS = {
    optimize: ["clean"],
    blueprint: ["plan"],
    fund: ["fund"],
    fund_plus_optimize: ["clean", "fund"],
    revenue: ["revenue"]
  };

  function pathState(client) { return state.path[client] || (state.path[client] = { open: null, touched: false }); }

  function renderPathInner(ctx, st) {
    const esc = escOf(ctx);
    const door = text(ctx.door);
    const lit = DOOR_LIGHTS[door] || [];
    const survey = obj(ctx.survey) || {};
    const handoff = obj(ctx.handoff) || {};
    const target = text(survey.target);
    const use = text(survey.use);
    const problem = text(handoff.problem);
    const sideDoor = lit.indexOf("revenue") >= 0;
    const all = sideDoor ? STATIONS.concat([SIDE_DOOR]) : STATIONS;
    /* The first station opens first, like every visual starts at its first
       step (owner-set 2026-10-29); a tap moves it. The door stays lit. */
    const open = st.touched && st.open ? st.open : STATIONS[0].key;
    const current = all.filter(function (s) { return s.key === open; })[0] || null;

    const cols = STATIONS.map(function (s, i) {
      const isLit = lit.indexOf(s.key) >= 0;
      const isOpen = open === s.key;
      const chips = [];
      if (i === 0) chips.push('<span class="fhv-path-chip">You are here</span>');
      if (isLit) chips.push('<span class="fhv-path-chip is-door">Your door</span>');
      let extra = "";
      if (s.key === "today" && problem) {
        extra = '<div class="fhv-path-said"><span class="fhv-ui-eyebrow">You said</span><p class="fhv-ui-text">' + esc(problem) + "</p></div>";
      }
      if (s.key === "goal" && (target || use)) {
        extra = '<div class="fhv-path-goal">' + (target ? '<div class="fhv-path-goalamt">' + esc(target) + "</div>" : "") +
          (use ? '<div class="fhv-ui-cap">' + esc(use) + "</div>" : "") + "</div>";
      }
      const sub = s.key === "goal" && use ? "" : '<span class="fhv-path-sub">' + ownEsc(s.sub) + "</span>";
      let branch = "";
      if (s.key === "fund" && sideDoor) {
        const sOpen = open === SIDE_DOOR.key;
        branch = '<div class="fhv-path-branch"><span class="fhv-path-branchline"></span>' +
          '<button type="button" class="fhv-path-side' + (sOpen ? " is-open" : "") + '" data-fhv-act="path:open:revenue" aria-pressed="' + (sOpen ? "true" : "false") + '">' +
          '<span class="fhv-path-dotmark is-lit"><span class="fhv-path-idx">+</span></span><span class="fhv-path-sidename">' + ownEsc(SIDE_DOOR.name) + '</span><span class="fhv-path-chip is-door">Your door</span></button></div>';
      }
      return '<div class="fhv-path-station' + (isLit ? " is-lit" : "") + (isOpen ? " is-open" : "") + '">' +
        '<div class="fhv-path-chips">' + chips.join("") + "</div>" +
        '<button type="button" class="fhv-path-stop" data-fhv-act="path:open:' + s.key + '" aria-pressed="' + (isOpen ? "true" : "false") + '">' +
        '<span class="fhv-path-dotmark' + (isLit ? " is-lit" : "") + '"><span class="fhv-path-idx">' + (i + 1) + "</span></span>" +
        '<span class="fhv-path-words"><span class="fhv-path-name">' + ownEsc(s.name) + "</span>" + sub + "</span></button>" +
        extra + branch + "</div>";
    }).join("");

    const detail = current
      ? '<div class="fhv-path-detail" aria-live="polite"><span class="fhv-ui-eyebrow">' + ownEsc(current.name) +
        (lit.indexOf(current.key) >= 0 ? " · your door" : "") + "</span>" +
        (current.key === "goal" && target
          ? '<p class="fhv-ui-text is-strong">You said ' + esc(target) + (use ? " for " + esc(use.charAt(0).toLowerCase() + use.slice(1)) : "") + ".</p>" : "") +
        current.lines.map(function (l) { return '<p class="fhv-ui-text">' + ownEsc(l) + "</p>"; }).join("") + "</div>"
      : '<div class="fhv-path-detail is-empty"><p class="fhv-ui-cap">Tap a station to see what it does for this file.</p></div>';

    return head(ctx, "Your path") +
      '<div class="fhv-path-rail' + (sideDoor ? " has-side" : "") + '"><span class="fhv-path-line"></span>' + cols + "</div>" + detail;
  }

  V.yourPath = function (ctx) {
    try {
      ctx = obj(ctx) || {};
      ensureStyle();
      const client = clientOf(ctx);
      lastCtx.path[client] = ctx;
      return wrap("path", client, renderPathInner(ctx, pathState(client)));
    } catch (err) {
      warn("yourPath", err);
      return fallback("path");
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     A. MONEY LEVERS — today and fully optimized, the levers that get there.
     ════════════════════════════════════════════════════════════════════════ */
  const LEVER_SUB = {
    paydown: "Cards down to their targets",
    clean: "File cleaned, tier re-checked",
    accounts: "Thin file gets more accounts"
  };
  const BUREAUS = [["EX", "Experian"], ["TU", "TransUnion"], ["EQ", "Equifax"]];
  const FIELD_WORDS = { name: "Name", address: "Address", employer: "Employer" };
  const LEVERS_EYEBROW = "Once your file is optimized";

  function leversState(client) { return state.levers[client] || (state.levers[client] = { step: null }); }

  /** The levers that apply, in contract order, each with its running amount. */
  function shownLevers(visual) {
    const order = ["paydown", "clean", "accounts"];
    const byKey = {};
    arr(visual.levers).forEach(function (l) { if (obj(l)) byKey[text(l.key)] = l; });
    const out = [];
    let prev = num(visual.todayTotal);
    order.forEach(function (key) {
      const l = byKey[key];
      if (!l || l.applies !== true) return;
      const after = num(l.totalAfter);
      out.push({
        key,
        label: text(l.label) || key,
        sub: LEVER_SUB[key] || "",
        totalAfter: after,
        delta: isNum(after) && isNum(prev) ? after - prev : null
      });
      if (isNum(after)) prev = after;
    });
    return out;
  }

  function renderLeversInner(ctx, st) {
    const esc = escOf(ctx);
    const amt = amtOf(ctx);
    const client = clientOf(ctx);
    const visual = obj(ctx.visual);
    if (!visual) {
      return head(ctx, LEVERS_EYEBROW) + note("No credit pull on this file yet", "The money levers show after the pull.");
    }
    const today = num(visual.todayTotal);
    const optimized = num(visual.optimizedTotal);
    const levers = shownLevers(visual);
    const survey = obj(ctx.survey) || {};
    const goal = parseGoal(survey.target);
    if (!isNum(today) && !isNum(optimized)) {
      return head(ctx, LEVERS_EYEBROW) +
        note("Not on this file yet", "The amounts are not on this file yet. The rest of the slide still works.");
    }

    /* Which lever is on: none until the closer taps one. The slide starts at
       today and the closer builds the climb live, one lever at a time
       (owner-set 2026-10-29). */
    const maxStep = levers.length;
    const step = st.step == null ? 0 : Math.max(0, Math.min(maxStep, st.step));
    const stepAmount = step === 0 ? today
      : (levers[step - 1] && isNum(levers[step - 1].totalAfter) ? levers[step - 1].totalAfter : optimized);
    const projected = step === maxStep && isNum(optimized) ? optimized : stepAmount;
    /* Left on the table is the whole gap, today to fully optimized, at every
       step. A lever's own gain is printed on its row, never here. */
    const gap = isNum(optimized) && isNum(today) ? optimized - today : null;

    /* The scale: the taller bar, or the goal when it sits above both (capped so
       the bars never shrink to slivers). */
    const tallest = Math.max(isNum(today) ? today : 0, isNum(optimized) ? optimized : 0, isNum(projected) ? projected : 0);
    let scaleMax = tallest;
    let goalAbove = false;
    if (goal && tallest > 0) {
      scaleMax = Math.max(scaleMax, Math.min(goal.high, tallest * 2.5));
      goalAbove = goal.low > scaleMax;
    } else if (goal) {
      scaleMax = goal.high;
    }

    /* heads */
    const waiting = step === 0 && maxStep > 0;
    const rightCap = !isNum(optimized)
      ? "The optimized amount is not on this file yet."
      : maxStep === 0 ? "Fully optimized."
        : step === 0 ? (maxStep === 1 ? "Nothing applied yet. Tap the lever to build the climb." : "Nothing applied yet. Tap each lever to build the climb.")
          : step === maxStep ? "Fully optimized, with " + (maxStep === 1 ? "the one lever" : maxStep === 2 ? "both levers" : "all three levers") + " on."
            : "After lever " + step + " of " + maxStep + ".";
    const heads = '<div class="fhv-levers-heads">' +
      '<div class="fhv-levers-headcell"><span class="fhv-ui-eyebrow">Today</span>' + bigNum(client, "levers:today", today, amt) +
      '<p class="fhv-ui-cap">' + (isNum(today) ? "How much you qualify for today." : "Not on this file yet.") + "</p></div>" +
      '<div class="fhv-levers-headcell is-opt' + (waiting ? " is-waiting" : "") + '"><span class="fhv-ui-eyebrow">Projects to</span>' +
      (isNum(projected) && isNum(optimized) ? bigNum(client, "levers:opt", projected, amt) : "") +
      '<p class="fhv-ui-cap">' + ownEsc(rightCap) + "</p></div></div>";

    const gapLine = isNum(gap)
      ? (gap > 0
        ? '<div class="fhv-levers-gap"><span class="fhv-levers-gapamt" data-fhv-count="' + gap + '" data-fhv-from="' + fromTo(client, "levers:gap", gap) + '">' + ownEsc(amt(gap)) + "</span> left on the table</div>"
        : '<div class="fhv-levers-gap is-zero">Nothing left on the table today.</div>')
      : "";

    /* bars (sizes are unitless custom properties, see the file header) */
    let goalMark = "";
    if (goal) {
      if (goalAbove) {
        goalMark = '<div class="fhv-levers-goal is-above" style="--b:100"><span class="fhv-levers-goallabel">Your goal · ' + esc(goal.label) + " · above this chart</span></div>";
      } else {
        const lowPct = round1(pct(goal.low, scaleMax));
        const highPct = round1(pct(Math.min(goal.high, scaleMax), scaleMax));
        const band = highPct > lowPct + 0.5;
        goalMark = '<div class="fhv-levers-goal' + (band ? " is-band" : "") + '" style="--b:' + lowPct + ";--h:" + (band ? round1(highPct - lowPct) : 0) + '"><span class="fhv-levers-goallabel">Your goal · ' + esc(goal.label) + "</span></div>";
      }
    }
    const todayPct = pct(today, scaleMax);
    const stepBars = (isNum(optimized) ? levers : []).map(function (lever, i) {
      const before = i === 0 ? today : levers[i - 1].totalAfter;
      const afterAmount = lever.totalAfter;
      const known = isNum(before) && isNum(afterAmount);
      const lower = known ? Math.min(before, afterAmount) : 0;
      const rise = known ? Math.abs(afterAmount - before) : 0;
      const delta = known ? (afterAmount >= before ? "+" : "−") + amt(rise) : "";
      const short = lever.key === "paydown" ? "Cards down" : lever.key === "clean" ? "File cleaned" : "Accounts added";
      return '<div class="fhv-levers-col is-waterstep' + (i < step ? " is-on" : " is-waiting") + '">' +
        (known ? '<div class="fhv-levers-rise' + (afterAmount < before ? " is-loss" : "") + '" style="--b:' + round1(pct(lower, scaleMax)) + ";--h:" + round1(pct(rise, scaleMax)) + '"><span class="fhv-levers-riselabel">' + ownEsc(delta) + "</span></div>" : "") +
        '<span class="fhv-levers-barlabel">' + ownEsc(short) + "</span></div>";
    }).join("");
    const bars = '<div class="fhv-levers-bars" style="--cols:' + (isNum(optimized) ? levers.length + 2 : 2) + '" role="img" aria-label="Today ' + ownEsc(amt(today)) + (isNum(projected) && isNum(optimized) ? ", projects to " + ownEsc(amt(projected)) : "") + '">' +
      '<div class="fhv-levers-col"><div class="fhv-levers-bar is-today"' + grow(client, "levers:todayPct", "--h", todayPct) + '></div><span class="fhv-levers-barlabel">Today</span></div>' +
      stepBars + '<div class="fhv-levers-col">' +
      (isNum(optimized)
        ? '<div class="fhv-levers-outline" style="--h:' + round1(pct(optimized, scaleMax)) + '"><span class="fhv-levers-outlinelabel">' + ownEsc(amt(optimized)) + "</span></div>" +
          '<div class="fhv-levers-bar is-opt"' + grow(client, "levers:fillPct", "--h", pct(projected, scaleMax)) + "></div>"
        : '<div class="fhv-levers-outline is-unknown"></div>') +
      '<span class="fhv-levers-barlabel">Optimized</span></div>' +
      goalMark + "</div>";

    /* tier */
    const tNow = tierWords(visual.tierNow);
    const tAfter = tierWords(visual.tierAfter);
    let tier = "";
    if (tNow || tAfter) {
      const moves = tNow && tAfter && tAfter !== tNow;
      tier = '<div class="fhv-levers-tier"><span class="fhv-ui-eyebrow">Your tier</span>' +
        (tNow ? '<span class="fhv-levers-chip">' + ownEsc(tNow) + "</span>" : "") +
        (moves ? '<span class="fhv-levers-to">projects to</span>' : "") +
        (tAfter && tAfter !== tNow ? '<span class="fhv-levers-chip is-after">' + ownEsc(tAfter) + "</span>" : "") + "</div>";
    }

    /* the levers, and under them the tier: the climb, then where it lands */
    let stepsInner;
    if (!isNum(optimized)) {
      stepsInner = note("The levers", "They show once the optimized amount is on this file.");
    } else if (!levers.length) {
      stepsInner = note("The levers", "Nothing to optimize today. This file is already at its optimized amount.");
    } else {
      const count = levers.length === 1 ? "One lever" : levers.length === 2 ? "Two levers" : "Three levers";
      stepsInner = '<span class="fhv-ui-eyebrow">' + count + (levers.length === 1 ? " · tap it" : " · tap each one") + "</span>" +
        '<div class="fhv-levers-list">' + levers.map(function (l, i) {
          const n = i + 1;
          const on = n <= step;
          const toLine = isNum(l.totalAfter) ? "projects to " + amt(l.totalAfter) : "";
          const delta = isNum(l.delta) ? (l.delta >= 0 ? "+" : "−") + amt(Math.abs(l.delta)) : "";
          return '<button type="button" class="fhv-levers-step' + (on ? " is-on" : "") + '" data-fhv-act="levers:step:' + n + '" aria-pressed="' + (on ? "true" : "false") + '">' +
            '<span class="fhv-levers-stepidx">' + n + "</span>" +
            '<span class="fhv-levers-stepwords"><span class="fhv-levers-steplabel">' + esc(l.label) + "</span>" +
            (l.sub ? '<span class="fhv-ui-cap">' + ownEsc(l.sub) + "</span>" : "") + "</span>" +
            '<span class="fhv-levers-stepamt">' + (delta ? '<span class="fhv-levers-delta">' + ownEsc(delta) + "</span>" : "") +
            (toLine ? '<span class="fhv-ui-cap">' + ownEsc(toLine) + "</span>" : "") + "</span></button>";
        }).join("") + "</div>" +
        /* The one clear way back to the start. Off until a lever is on. */
        '<button type="button" class="fhv-ui-ghost" data-fhv-act="levers:step:0"' + (step === 0 ? " disabled" : "") + ">Reset to today</button>";
    }
    const steps = '<div class="fhv-levers-steps">' + stepsInner + tier + "</div>";

    return head(ctx, LEVERS_EYEBROW) +
      '<div class="fhv-levers-grid"><div class="fhv-levers-chart">' + heads + gapLine + bars + "</div>" + steps + "</div>" +
      (text(visual.pulledOn) ? '<p class="fhv-ui-cap">From your soft pull on ' + ownEsc(text(visual.pulledOn)) + ".</p>" : "");
  }

  /** Three reports side by side; a cell that differs from the others is marked
   *  with a word, never colour alone. No dollar amount: the engine prints none. */
  function renderMismatches(mismatches, esc) {
    if (!mismatches.length) return "";
    const rows = mismatches.map(function (m) {
      const field = text(m.field);
      const values = BUREAUS.map(function (b) { return text(m.values[b[0]]); });
      const counts = {};
      values.forEach(function (v) { if (v) counts[v] = (counts[v] || 0) + 1; });
      let common = null, best = 0;
      Object.keys(counts).forEach(function (v) { if (counts[v] > best) { best = counts[v]; common = v; } });
      return {
        field: FIELD_WORDS[field] || (field ? field.charAt(0).toUpperCase() + field.slice(1) : "Info"),
        values, common, allDiffer: best <= 1
      };
    });
    const cols = BUREAUS.map(function (b, i) {
      return '<div class="fhv-levers-report"><span class="fhv-levers-bureau">' + b[1] + "</span>" +
        rows.map(function (r) {
          const v = r.values[i];
          const differs = v ? (r.allDiffer || v !== r.common) : false;
          return '<div class="fhv-levers-cell' + (differs ? " is-diff" : "") + (!v ? " is-missing" : "") + '">' +
            '<span class="fhv-ui-eyebrow">' + ownEsc(r.field) + (differs ? " · differs" : "") + "</span>" +
            '<span class="fhv-ui-text">' + (v ? esc(v) : "Not on this report") + "</span></div>";
        }).join("") + "</div>";
    }).join("");
    return '<div class="fhv-levers-match"><span class="fhv-ui-eyebrow">Your info on the three reports</span>' +
      '<div class="fhv-levers-reports">' + cols + "</div>" +
      '<p class="fhv-ui-text is-strong">Banks approve you for less when your info doesn\'t match on every report.</p></div>';
  }

  V.moneyLevers = function (ctx) {
    try {
      ctx = obj(ctx) || {};
      ensureStyle();
      const client = clientOf(ctx);
      lastCtx.levers[client] = ctx;
      const html = wrap("levers", client, renderLeversInner(ctx, leversState(client)));
      scheduleAnimate("levers", client, ctx);
      return html;
    } catch (err) {
      warn("moneyLevers", err);
      return fallback("levers");
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     B. MORE COMPANIES, MORE FUNDING — one layer per file, plus what one more
     company adds as it ages. The added companies never touch today's total.
     ════════════════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════════════════
     F-01. FILE FINDINGS — only causes the engine actually found on this file.
     ════════════════════════════════════════════════════════════════════════ */
  const ITEM_WORDS = { late: "Late payment", collection: "Collection", charge_off: "Charge-off" };
  function findingsState(client) { return state.findings[client] || (state.findings[client] = { open: null }); }

  function findingRows(visual, amt) {
    const rows = [];
    arr(visual.cards).forEach(function (card) {
      if (!obj(card)) return;
      const limit = num(card.limit), balance = num(card.balance), target = num(card.target);
      if (!isNum(limit) || limit <= 0 || !isNum(balance) || !isNum(target) || balance <= target) return;
      const creditor = text(card.creditor) || "Card on this file";
      const pay = balance - target;
      rows.push({ kind: "card", label: creditor, sub: "Pay " + amt(pay) + " to the target", detail: "Pay " + amt(pay) + " on this card to reach " + amt(target) + ".", card: { limit, balance, target } });
    });
    arr(visual.items).forEach(function (item) {
      if (!obj(item)) return;
      const creditor = text(item.creditor);
      if (!creditor) return;
      const kind = ITEM_WORDS[text(item.kind)] || text(item.kind) || "Report item";
      const bureaus = arr(item.bureaus).map(text).filter(Boolean).join(" · ");
      rows.push({ kind: "item", label: creditor, sub: kind + (bureaus ? " · " + bureaus : ""), detail: "Review this " + kind.toLowerCase() + " and dispute it with the bureaus that report it." });
    });
    arr(visual.mismatches).forEach(function (mismatch) {
      if (!obj(mismatch) || !obj(mismatch.values)) return;
      const field = text(mismatch.field);
      if (!field) return;
      rows.push({ kind: "mismatch", label: (FIELD_WORDS[field] || field) + " differs", sub: "Three-report check", detail: "Confirm which report value is right, then correct the others.", mismatch });
    });
    return rows;
  }

  function renderFindingsInner(ctx, st) {
    const visual = obj(ctx && ctx.visual);
    if (!visual) return head(ctx, "Your file") + note("No credit pull on this file yet", "Your file findings show after the pull.");
    const amt = amtOf(ctx);
    const esc = escOf(ctx);
    const rows = findingRows(visual, amt);
    if (!rows.length) return head(ctx, "Your file") + note("No file findings here", "This pull has no cards above their target, negative items or report mismatches to show.");
    const open = Number.isInteger(st.open) && st.open >= 0 && st.open < rows.length ? st.open : null;
    const list = rows.map(function (row, i) {
      const card = row.card;
      const bar = card ? '<div class="fhv-findings-bar" role="img" aria-label="Balance ' + ownEsc(amt(card.balance)) + ', limit ' + ownEsc(amt(card.limit)) + ', target ' + ownEsc(amt(card.target)) + '" style="--balance:' + round1(pct(card.balance, card.limit)) + '"><span class="fhv-findings-fill"></span><span class="fhv-findings-target"></span></div>' +
        '<div class="fhv-findings-barlabels"><span>Balance ' + ownEsc(amt(card.balance)) + '</span><span>10% line · ' + ownEsc(amt(card.target)) + " target</span></div>" : "";
      return '<button type="button" class="fhv-findings-row' + (open === i ? " is-open" : "") + '" data-fhv-act="findings:open:' + i + '" aria-expanded="' + (open === i ? "true" : "false") + '">' +
        '<span class="fhv-findings-rowtop"><span class="fhv-findings-kind">' + ownEsc(row.kind === "card" ? "Card" : row.kind === "item" ? "Item" : "Mismatch") + '</span><strong>' + esc(row.label) + '</strong><span class="fhv-findings-sub">' + ownEsc(row.sub) + '</span></span>' + bar +
        (open === i ? '<span class="fhv-findings-step">Next step · ' + ownEsc(row.detail) + "</span>" : "") + '</button>';
    }).join("");
    const selected = open == null ? null : rows[open];
    const grid = selected && selected.mismatch ? renderMismatches([selected.mismatch], esc) : "";
    const basis = text(visual.pulledOn);
    return head(ctx, "Your file") + '<p class="fhv-ui-cap">' + plural(rows.length, "finding", "findings") + ' on this file · Tap one to see its next step.</p>' +
      '<div class="fhv-findings-list">' + list + '</div>' + grid +
      (basis ? '<p class="fhv-ui-cap">From your soft pull on ' + ownEsc(basis) + ".</p>" : "");
  }

  V.fileFindings = function (ctx) {
    try {
      ensureStyle();
      const client = clientOf(ctx);
      lastCtx.findings[client] = ctx;
      return wrap("findings", client, renderFindingsInner(ctx, findingsState(client)));
    } catch (err) {
      warn("fileFindings", err);
      return fallback("findings");
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     F-02. LENDER WALL — the engine's current matches and its additional
     after-optimization matches. No lender identity is in this data contract.
     ════════════════════════════════════════════════════════════════════════ */
  function wallState(client) { return state.wall[client] || (state.wall[client] = { step: 0 }); }

  function renderWallInner(ctx, st) {
    const visual = obj(ctx && ctx.visual);
    const reach = visual && obj(visual.lenderReach);
    const now = reach ? num(reach.now) : null;
    const after = reach ? num(reach.after) : null;
    if (!visual) return head(ctx, "Lender reach") + note("No credit pull on this file yet", "Lender matches show after the pull.");
    if (!Number.isInteger(now) || now < 0 || !Number.isInteger(after) || after < 0) {
      return head(ctx, "Lender reach") + note("Not on this file yet", "The lender match count is not on this file yet.");
    }

    const maxStep = Math.min(3, after);
    const step = Math.max(0, Math.min(maxStep, num(st.step) || 0));
    const litAfter = maxStep ? Math.floor(after * step / maxStep) : 0;
    const tiles = [];
    for (let i = 0; i < now + after; i++) {
      const current = i < now;
      const lit = current || i - now < litAfter;
      const status = current ? "Today" : "After";
      const fullStatus = current ? "Today" : "More after optimization";
      tiles.push('<div class="fhv-wall-tile' + (current ? " is-today" : lit ? " is-lit" : " is-waiting") +
        '" role="listitem" aria-label="Lender ' + (i + 1) + ", " + fullStatus + (lit && !current ? ", shown" : "") + '">' +
        '<span class="fhv-wall-index">' + (i + 1) + '</span><span class="fhv-wall-label">Lender</span>' +
        '<span class="fhv-wall-status">' + status + '</span></div>');
    }
    const basis = text(visual.pulledOn);
    const counts = '<div class="fhv-wall-counts"><div class="fhv-wall-count"><span class="fhv-ui-eyebrow">Matches today</span><strong class="fhv-ui-num">' + now +
      '</strong></div><div class="fhv-wall-count is-after"><span class="fhv-ui-eyebrow">More after optimization</span><strong class="fhv-ui-num">' + after + '</strong></div></div>';
    const controls = after ? '<div class="fhv-wall-controls"><button type="button" class="fhv-ui-ghost" data-fhv-act="wall:next"' +
      (step === maxStep ? " disabled" : "") + '>' + (step === maxStep ? "All additional matches shown" : "Show more matches") + '</button>' +
      '<button type="button" class="fhv-ui-ghost" data-fhv-act="wall:reset"' + (step === 0 ? " disabled" : "") +
      '>Back to today</button><span class="fhv-ui-cap">' + litAfter + ' of ' + after + ' more shown</span></div>' : "";
    return head(ctx, "Lender reach") + counts +
      (tiles.length ? '<div class="fhv-wall-grid" role="list" aria-label="Lender matches">' + tiles.join("") + "</div>"
        : note("No matches on this file", "The engine found no lender matches today or after optimization.")) +
      controls + (basis ? '<p class="fhv-ui-cap">From your soft pull on ' + ownEsc(basis) + ".</p>" : "");
  }

  V.lenderWall = function (ctx) {
    try {
      ensureStyle();
      const client = clientOf(ctx);
      lastCtx.wall[client] = ctx;
      return wrap("wall", client, renderWallInner(ctx, wallState(client)));
    } catch (err) {
      warn("lenderWall", err);
      return fallback("wall");
    }
  };

  const MAX_ADDED = 4;
  const YEARS = [["year1", "Year 1"], ["year2", "Year 2"], ["after2", "After 2 years"]];
  const COMPANIES_EYEBROW = "More companies, more funding";

  function companiesState(client) {
    return state.companies[client] || (state.companies[client] = { tab: "personal", added: 0, years: 0 });
  }

  /** The companies to show: the engine's rows, or the deck's businesses. */
  function companyRows(ctx, visual) {
    const fromVisual = visual ? arr(visual.companies).filter(obj) : [];
    if (fromVisual.length) {
      return fromVisual.map(function (c) {
        return { name: text(c.name), incorporated: text(c.incorporatedDate), ageMonths: num(c.ageMonths), amount: num(c.amount) };
      });
    }
    return arr(ctx.businesses).filter(obj).map(function (b) {
      return {
        name: text(b.name),
        incorporated: text(b.incorporated_date != null ? b.incorporated_date : b.incorporatedDate),
        ageMonths: num(b.age_months != null ? b.age_months : b.ageMonths),
        amount: null
      };
    });
  }

  function monthYear(raw) {
    const m = /^(\d{4})-(\d{2})/.exec(text(raw));
    if (!m) return text(raw);
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return (names[Number(m[2]) - 1] || m[2]) + " " + m[1];
  }
  function ageWords(months) {
    if (!isNum(months)) return "";
    if (months < 12) return plural(months, "month", "months") + " old";
    const y = Math.floor(months / 12), mo = months % 12;
    return plural(y, "year", "years") + (mo ? ", " + plural(mo, "month", "months") : "") + " old";
  }

  function renderCompaniesInner(ctx, st) {
    const esc = escOf(ctx);
    const amt = amtOf(ctx);
    const client = clientOf(ctx);
    const visual = obj(ctx.visual);
    const companies = companyRows(ctx, visual);
    if (!visual) {
      return head(ctx, COMPANIES_EYEBROW) +
        note("No credit pull on this file yet", "The companies picture shows after the pull.") +
        (companies.length ? '<div class="fhv-companies-legend">' + companies.map(function (c, i) {
          return '<span class="fhv-companies-key ' + bizCls(i) + '"><b>Business ' + (i + 1) + "</b>" + (c.name ? " · " + esc(c.name) : "") + "</span>";
        }).join("") + "</div>" : "") + proofCard();
    }
    const today = num(visual.todayTotal);
    /* What ONE more company adds as it ages. null when the engine has no
       seasoned card to price it on: the step still shows, without an amount. */
    const newCo = obj(visual.newCompany);
    const yearIdx = Math.max(0, Math.min(2, num(st.years) || 0));
    const perAdded = newCo ? num(newCo[YEARS[yearIdx][0]]) : null;
    const priced = isNum(perAdded) && perAdded > 0;
    const added = Math.max(0, Math.min(MAX_ADDED, num(st.added) || 0));

    const knownBiz = companies.reduce(function (s, c) { return s + (isNum(c.amount) ? c.amount : 0); }, 0);
    let personal = isNum(today) ? today - knownBiz : null;
    if (isNum(personal) && personal < 0) personal = null;
    const addedSum = priced ? added * perAdded : null;
    const scale = (isNum(today) ? today : knownBiz) + (priced ? addedSum : 0);

    /* the layers */
    const segs = [];
    if (isNum(personal) && personal > 0) segs.push({ cls: "is-personal", label: "Personal", short: "P", amount: personal, key: "p" });
    companies.forEach(function (c, i) {
      if (isNum(c.amount) && c.amount > 0) segs.push({ cls: bizCls(i), label: "Business " + (i + 1), short: "B" + (i + 1), amount: c.amount, key: "b" + i });
    });
    if (priced) for (let k = 0; k < added; k++) segs.push({ cls: "is-added", label: "If you add a company", short: "+1", amount: perAdded, key: "a" + k });
    const todayShare = pct(today, scale);
    const bar = segs.length
      ? '<div class="fhv-companies-bar" role="img" aria-label="Today ' + ownEsc(amt(today)) + (added ? ", plus " + plural(added, "added company", "added companies") + (priced ? " at " + ownEsc(amt(addedSum)) : "") : "") + '">' +
        segs.map(function (s) {
          const share = scale > 0 ? (s.amount / scale) * 100 : 0;
          /* A thin layer keeps a short name and drops its amount; the legend
             below carries the full words. The share picks a floor here, and the
             stylesheet's container queries refine it by the layer's real width. */
          const size = share < 9 ? " is-tiny" : share < 18 ? " is-narrow" : "";
          return '<div class="fhv-companies-seg ' + s.cls + size + '" title="' + ownEsc(s.label + (isNum(s.amount) ? " · " + amt(s.amount) : "")) + '"' + grow(client, "companies:seg:" + s.key, "--g", share) +
            '><span class="fhv-companies-segname">' + ownEsc(s.label) + '</span><span class="fhv-companies-segshort">' + ownEsc(s.short) + "</span>" +
            '<span class="fhv-companies-segamt">' + ownEsc(amt(s.amount)) + "</span></div>";
        }).join("") + "</div>" +
        /* The Today marker sits where today's layers end. The bar has a 3px gap
           between layers, so the stylesheet is told how many gaps the bar has
           (--gaps) and how many sit before the marker (--k). */
        (isNum(today) && scale > 0
          ? '<div class="fhv-companies-markrow"><div class="fhv-companies-marker' + (todayShare < 30 ? " is-left" : "") + '"' +
            grow(client, "companies:marker", "--l", todayShare, ";--gaps:" + Math.max(0, segs.length - 1) + ";--k:" + Math.max(0, segs.filter(function (s) { return s.cls !== "is-added"; }).length - 1)) +
            '><span class="fhv-companies-markline"></span><span class="fhv-companies-marklabel">Today ' + ownEsc(amt(today)) + "</span></div></div>"
          : "")
      : (isNum(today) && today === 0
        /* The engine's own answer for a repair-only file: $0 today, so no layer. */
        ? note("Nothing to stack today", "This file qualifies for $0 today, so there is no layer to stack yet.")
        : note("Not on this file yet", "The amounts are not on this file yet."));

    /* heads */
    const heads = '<div class="fhv-companies-heads">' +
      '<div class="fhv-companies-headcell"><span class="fhv-ui-eyebrow">Today, all your files</span>' + bigNum(client, "companies:today", today, amt) +
      '<p class="fhv-ui-cap">' + (isNum(today) ? "How much you qualify for today." : "Not on this file yet.") + "</p></div>" +
      (added
        ? '<div class="fhv-companies-headcell is-added"><span class="fhv-ui-eyebrow">If you add ' + plural(added, "company", "companies") + "</span>" +
          (priced ? bigNum(client, "companies:added", addedSum, amt, "+") : "") +
          '<p class="fhv-ui-cap">' + (priced ? "A picture of what's possible. Never added to today." : "No amount for a new company on this file yet. Each one still applies for its own business credit.") + "</p></div>"
        : "") + "</div>";

    /* tabs */
    const tabOn = function (key) { return st.tab === key; };
    const tabs = ['<button type="button" class="fhv-companies-tab' + (tabOn("personal") ? " is-on" : "") + '" data-fhv-act="companies:tab:personal" aria-pressed="' + (tabOn("personal") ? "true" : "false") + '">' +
      '<span class="fhv-companies-tabname">Personal</span>' + (isNum(personal) ? '<span class="fhv-companies-tabamt">' + ownEsc(amt(personal)) + "</span>" : "") + "</button>"];
    if (companies.length) {
      companies.forEach(function (c, i) {
        const on = tabOn(String(i));
        tabs.push('<button type="button" class="fhv-companies-tab' + (on ? " is-on" : "") + '" data-fhv-act="companies:tab:' + i + '" aria-pressed="' + (on ? "true" : "false") + '">' +
          '<span class="fhv-companies-tabname">Business ' + (i + 1) + "</span>" +
          (isNum(c.amount) ? '<span class="fhv-companies-tabamt">' + ownEsc(amt(c.amount)) + "</span>" : '<span class="fhv-ui-cap">needs the report</span>') + "</button>");
      });
    } else {
      const on = tabOn("0");
      tabs.push('<button type="button" class="fhv-companies-tab' + (on ? " is-on" : "") + '" data-fhv-act="companies:tab:0" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="fhv-companies-tabname">Business 1</span><span class="fhv-ui-cap">we can set it up for you</span></button>');
    }
    const full = added >= MAX_ADDED;
    tabs.push('<button type="button" class="fhv-companies-tab is-add" data-fhv-act="companies:add"' + (full ? ' aria-disabled="true"' : "") + '>' +
      '<span class="fhv-companies-tabname">+ Add a company</span><span class="fhv-ui-cap">' + (full ? "Four is the most on this picture" : "if you add a company") + "</span></button>");
    if (added) tabs.push('<button type="button" class="fhv-ui-ghost" data-fhv-act="companies:reset">Reset to today</button>');

    /* the years switch, only once a priced company is on the picture */
    let years = "";
    if (priced && added) {
      years = '<div class="fhv-companies-years"><span class="fhv-ui-eyebrow">The added companies, as they age</span><div class="fhv-companies-switch" role="group" aria-label="Years after adding">' +
        YEARS.map(function (y, i) {
          const on = yearIdx === i;
          const each = num(newCo[y[0]]);
          return '<button type="button" class="fhv-companies-year' + (on ? " is-on" : "") + '" data-fhv-act="companies:years:' + i + '" aria-pressed="' + (on ? "true" : "false") + '">' + y[1] +
            (isNum(each) ? '<span class="fhv-ui-cap">' + ownEsc(amt(each)) + " each</span>" : "") + "</button>";
        }).join("") + "</div>" +
        '<p class="fhv-ui-cap">Each company you add grows as it ages: half in year 1, the full amount in year 2, double after 2 years. Time and companies together.</p></div>';
    }

    /* the active tab's card */
    let detail = "";
    if (tabOn("personal")) {
      detail = '<div class="fhv-companies-detail"><span class="fhv-ui-eyebrow">Personal</span>' +
        '<p class="fhv-ui-text is-strong">Your personal file' + (isNum(personal) ? ": " + esc(amt(personal)) + " today." : ".") + "</p>" +
        '<p class="fhv-ui-text">Your personal file goes first in every funding sequence. Each company is judged on its own after it.</p></div>';
    } else {
      const i = Number(st.tab);
      const c = companies[i];
      if (c) {
        const young = isNum(c.ageMonths) && c.ageMonths < 12;
        detail = '<div class="fhv-companies-detail"><span class="fhv-ui-eyebrow">Business ' + (i + 1) + "</span>" +
          '<p class="fhv-ui-text is-strong">' + (c.name ? esc(c.name) : "Business " + (i + 1)) + (isNum(c.amount) ? ": " + esc(amt(c.amount)) + " today." : "") + "</p>" +
          (c.incorporated || isNum(c.ageMonths)
            ? '<p class="fhv-ui-cap">' + (c.incorporated ? "Incorporated " + esc(monthYear(c.incorporated)) : "") + (c.incorporated && isNum(c.ageMonths) ? " · " : "") + (isNum(c.ageMonths) ? esc(ageWords(c.ageMonths)) : "") + "</p>"
            : "") +
          (!isNum(c.amount) ? '<p class="fhv-ui-text">Needs the company report before an amount shows.</p>' : "") +
          (young ? '<p class="fhv-ui-text">First year: a company under 12 months old gets the first-year amount. It grows as the company ages.</p>' : "") + "</div>";
      } else if (!companies.length && tabOn("0")) {
        detail = '<div class="fhv-companies-detail"><span class="fhv-ui-eyebrow">Business 1</span>' +
          '<p class="fhv-ui-text is-strong">No business on file yet. We can set it up for you.</p>' +
          '<p class="fhv-ui-text">If you need a business, Fundhub opens one for you. Each company applies for its own business credit.</p></div>';
      }
    }

    /* legend */
    const keys = [];
    if (isNum(personal) && personal > 0) keys.push('<span class="fhv-companies-key is-personal"><b>Personal</b> · ' + esc(amt(personal)) + "</span>");
    companies.forEach(function (c, i) {
      keys.push('<span class="fhv-companies-key ' + bizCls(i) + '"><b>Business ' + (i + 1) + "</b>" + (c.name ? " · " + esc(c.name) : "") +
        (isNum(c.amount) ? " · " + esc(amt(c.amount)) : " · needs the company report") + "</span>");
    });
    if (added) keys.push('<span class="fhv-companies-key is-added"><b>+' + added + "</b> if you add a company" + (priced ? " · " + esc(amt(perAdded)) + " each" : "") + "</span>");
    const legend = keys.length ? '<div class="fhv-companies-legend">' + keys.join("") + "</div>" : "";

    /* the funding sequences */
    const fileChips = function (withAdded) {
      const chips = ['<span class="fhv-companies-chip is-personal">Personal</span>'];
      companies.forEach(function (c, i) {
        chips.push('<span class="fhv-companies-chip ' + (isNum(c.amount) ? bizCls(i) : "is-dim") + '">Business ' + (i + 1) + (isNum(c.amount) ? "" : " · needs the report") + "</span>");
      });
      for (let k = 0; k < withAdded; k++) chips.push('<span class="fhv-companies-chip is-added">+1 company</span>');
      return chips.join("");
    };
    const seq = '<div class="fhv-companies-timeline"><span class="fhv-ui-eyebrow">Funding partners for life</span><div class="fhv-companies-seqs">' +
      '<div class="fhv-companies-seq is-now"><span class="fhv-companies-seqname">This funding sequence</span><span class="fhv-ui-cap">Now · about six rounds</span><div class="fhv-companies-chips">' + fileChips(0) + "</div></div>" +
      '<div class="fhv-companies-seq"><span class="fhv-companies-seqname">The next one</span><span class="fhv-ui-cap">About 3 months later</span><div class="fhv-companies-chips">' + fileChips(Math.min(added, 2)) + "</div></div>" +
      '<div class="fhv-companies-seq"><span class="fhv-companies-seqname">The one after</span><span class="fhv-ui-cap">About 3 months more</span><div class="fhv-companies-chips">' + fileChips(added) + "</div></div>" +
      '</div><p class="fhv-ui-cap">The next funding sequence depends on what the file supports then. Each company applies for its own business credit.</p></div>';

    /* The tab's card and the proof sit side by side on a wide slide, so the
       whole slide fits a laptop screen (2026-10-30). */
    return head(ctx, COMPANIES_EYEBROW) +
      '<div class="fhv-companies-tabs" role="group" aria-label="Your files">' + tabs.join("") + "</div>" +
      '<div class="fhv-companies-chart">' + heads + bar + legend + "</div>" + years +
      '<div class="fhv-companies-pair">' + detail + proofCard() + "</div>" + seq;
  }

  /* Every place a business shows its color (layer, key, chip) uses this, so
     Business 2 is the same color everywhere on the slide. */
  function bizCls(i) { return "is-biz" + (i % 2 ? " is-alt" : ""); }

  function proofCard() {
    return '<div class="fhv-companies-proof"><span class="fhv-ui-eyebrow">Chris\'s own result. Not a promise.</span>' +
      '<p class="fhv-ui-text is-strong">Chris got $100,000 credit lines for four companies off one personal credit file.</p></div>';
  }

  V.companies = function (ctx) {
    try {
      ctx = obj(ctx) || {};
      ensureStyle();
      const client = clientOf(ctx);
      lastCtx.companies[client] = ctx;
      const html = wrap("companies", client, renderCompaniesInner(ctx, companiesState(client)));
      scheduleAnimate("companies", client, ctx);
      return html;
    } catch (err) {
      warn("companies", err);
      return fallback("companies");
    }
  };

  /* ── taps: one listener, scoped by [data-fhv] ──────────────────────────── */
  const inner = { path: renderPathInner, levers: renderLeversInner, findings: renderFindingsInner, wall: renderWallInner, companies: renderCompaniesInner };
  const stateFor = { path: pathState, levers: leversState, findings: findingsState, wall: wallState, companies: companiesState };
  /* Each reducer returns true when the tap changed something worth redrawing. */
  const reducers = {
    path(st, parts) {
      if (parts[1] !== "open" || !parts[2]) return false;
      st.open = parts[2];
      st.touched = true;
      return true;
    },
    levers(st, parts) {
      if (parts[1] !== "step") return false;
      const n = Number(parts[2]);
      if (!Number.isFinite(n)) return false;
      st.step = n;
      return true;
    },
    findings(st, parts, ctx) {
      if (parts[1] !== "open") return false;
      const n = Number(parts[2]);
      const rows = findingRows(obj(ctx.visual) || {}, amtOf(ctx));
      if (!Number.isInteger(n) || n < 0 || n >= rows.length) return false;
      st.open = st.open === n ? null : n;
      return true;
    },
    wall(st, parts, ctx) {
      const reach = obj(obj(ctx.visual)?.lenderReach);
      const after = num(reach?.after);
      if (!Number.isInteger(after) || after <= 0) return false;
      const maxStep = Math.min(3, after);
      if (parts[1] === "next" && st.step < maxStep) { st.step += 1; return true; }
      if (parts[1] === "reset" && st.step > 0) { st.step = 0; return true; }
      return false;
    },
    companies(st, parts) {
      if (parts[1] === "tab") { st.tab = parts[2] || "personal"; return true; }
      if (parts[1] === "add") { st.added = Math.min(MAX_ADDED, (num(st.added) || 0) + 1); return true; }
      if (parts[1] === "reset") { st.added = 0; return true; }
      if (parts[1] === "years") {
        const n = Number(parts[2]);
        if (!Number.isFinite(n)) return false;
        st.years = Math.max(0, Math.min(2, n));
        return true;
      }
      return false;
    }
  };

  function closest(el, selector) {
    if (!el) return null;
    if (typeof el.closest === "function") return el.closest(selector);
    let node = el;
    while (node) {
      if (typeof node.matches === "function" && node.matches(selector)) return node;
      node = node.parentNode || null;
    }
    return null;
  }
  function attr(el, name) { return el && typeof el.getAttribute === "function" ? el.getAttribute(name) : null; }

  function onTap(e) {
    try {
      const target = e && e.target;
      if (!target) return;
      const btn = closest(target, "[data-fhv-act]");
      if (!btn) return;
      const host = closest(btn, "[data-fhv]");
      if (!host) return;
      const name = attr(host, "data-fhv");
      const client = attr(host, "data-fhv-client") || "anon";
      const parts = String(attr(btn, "data-fhv-act") || "").split(":");
      if (parts[0] !== name || !inner[name]) return;
      const ctx = lastCtx[name][client];
      if (!ctx) return;
      if (attr(btn, "aria-disabled") === "true") return;
      const st = stateFor[name](client);
      if (!reducers[name](st, parts, ctx)) return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      host.innerHTML = inner[name](ctx, st);
      animateIn(host, ctx);
      if (name === "companies") fitToSlide(host);
    } catch (err) {
      warn("tap", err);
    }
  }
  if (doc && typeof doc.addEventListener === "function" && !V.__visualsTapsBound) {
    doc.addEventListener("click", onTap);
    V.__visualsTapsBound = true;
  }

  function warn(where, err) {
    try { if (root.console && root.console.warn) root.console.warn("present-visuals " + where + ": " + (err && err.message ? err.message : err)); } catch (e) { /* quiet */ }
  }

  /* ── the one style element ─────────────────────────────────────────────── */
  /* SHARED LOOK (design pass, 2026-10-29). present-visuals.js,
     present-blueprint-demo.js and present-journey.js draw one system. Each file
     keeps its own copy because each is a standalone script; keep these values
     equal across the three:
       eyebrow     mono 13px, .14em, uppercase, gray; the brand's 16x2 spectrum
                   dash only on a section eyebrow (the visual's title row)
       tag / badge mono 13px, .1em, uppercase, pill (radius 999, 4px 10px);
                   the Sample tag carries a 6px warn dot
       hero amount var(--sans) 700, -.03em, tabular, clamp(28px,4.4cqi,46px)
       item title  17px 650 -.015em; body 16px; caption 13px gray
       card        radius 10, padding 16, 1px line; notes on --soft
       control     radius 8, 44px tall (a primary 48px); pills for chips
       meaning     today = solid ink; a projection = dashed gray2 outline;
                   the climb = sage; pastel stops for status, never alone
       rhythm      8 / 16 / 24 / 32 between things
       motion      count-ups and bars 700ms cubic-bezier(.2,.7,.3,1)
       focus       2px solid ink, offset 3px */
  const NARROW = [
    ".fhv-path-rail{grid-template-columns:1fr;gap:16px;padding-top:0}",
    ".fhv-path-line{left:21px;right:auto;top:8px;bottom:8px;width:2px;height:auto}",
    ".fhv-path-station{flex-direction:row;align-items:flex-start;text-align:left;flex-wrap:wrap;gap:8px 14px}",
    ".fhv-path-chips{position:static;order:-1;width:100%;justify-content:flex-start;padding-left:58px;min-height:0}",
    ".fhv-path-stop{flex-direction:row;align-items:center;width:100%;padding:0;gap:14px;text-align:left}",
    ".fhv-path-words{align-items:flex-start}",
    ".fhv-path-said,.fhv-path-goal{margin-left:58px;align-items:flex-start;width:auto}",
    ".fhv-path-branch{margin-left:58px;align-items:flex-start;width:auto}",
    ".fhv-path-branchline{width:18px;height:2px}",
    ".fhv-path-side{flex-direction:row;width:auto}",
    ".fhv-levers-grid,.fhv-levers-heads,.fhv-levers-reports,.fhv-findings-list,.fhv-companies-seqs,.fhv-companies-heads,.fhv-companies-pair{grid-template-columns:1fr}",
    ".fhv-levers-bars{height:220px}",
    ".fhv-companies-bar{height:56px}",
    ".fhv-companies-switch{display:flex;flex-wrap:wrap}",
    ".fhv-companies-year{flex:1 1 33%;border-right:0;border-bottom:1px solid var(--line)}"
  ].join("");
  /* A short screen (a laptop, 2026-10-30): the companies slide packs tighter
     so it fits without a scroll. Touch targets stay 48px. */
  const SHORT = [
    ".fhv-ui-root[data-fhv=\"companies\"]{gap:8px}",
    ".fhv-companies-tab{min-height:48px;padding:7px 12px}",
    ".fhv-companies-chart{gap:12px}",
    ".fhv-companies-bar{height:56px}",
    ".fhv-companies-year{min-height:48px;padding:6px 14px}",
    ".fhv-companies-pair{gap:12px}",
    ".fhv-companies-detail,.fhv-companies-proof{padding:12px 14px;gap:6px}",
    ".fhv-companies-timeline{gap:8px;padding-top:12px}",
    ".fhv-companies-seqs{gap:10px}",
    ".fhv-companies-seq{padding:10px 12px}",
    ".fhv-companies-seqname{font-size:16px}",
    ".fhv-companies-chips{margin-top:4px}",
    ".fhv-companies-chip{font-size:12px;padding:3px 8px}"
  ].join("");
  /* On a wide slide the years switch and its line share one row. */
  const SHORT_WIDE = [
    ".fhv-companies-years{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px 16px}",
    ".fhv-companies-years>.fhv-ui-eyebrow{grid-column:1/-1}"
  ].join("");

  const CSS = [
    /* shared */
    ".fhv-ui-root{position:relative;display:flex;flex-direction:column;gap:16px;min-width:0;flex:1 1 auto;container-type:inline-size;font-family:var(--sans);color:var(--ink);font-size:16px;line-height:1.45}",
    "[data-fhv=companies]{gap:12px}",
    ".fhv-ui-root *{box-sizing:border-box;min-width:0}",
    ".fhv-ui-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}",
    ".fhv-ui-eyebrow{display:block;font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gray);line-height:1.4}",
    ".fhv-ui-eyebrow.is-section{display:inline-flex;align-items:center;gap:9px}",
    ".fhv-ui-eyebrow.is-section::before{content:\"\";display:inline-block;width:16px;height:2px;border-radius:1px;background:var(--spectrum);flex:0 0 auto}",
    ".fhv-ui-cap{font-size:13px;line-height:1.45;color:var(--gray);margin:0}",
    ".fhv-ui-text{font-size:16px;line-height:1.45;color:var(--ink);margin:0}",
    ".fhv-ui-text.is-strong{font-weight:650}",
    ".fhv-ui-text+.fhv-ui-text{margin-top:8px}",
    ".fhv-ui-tag{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--gray);padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:transparent;white-space:nowrap;line-height:1.2;flex:0 0 auto}",
    ".fhv-ui-tag::before{content:\"\";width:6px;height:6px;border-radius:50%;background:var(--warn)}",
    ".fhv-ui-note{border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;max-width:620px}",
    ".fhv-ui-num{font-family:var(--sans);font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.05;color:var(--ink);font-size:clamp(28px,4.4cqi,46px)}",
    ".fhv-ui-num.is-plus{color:var(--ink2)}",
    ".fhv-ui-ghost{align-self:flex-start;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 16px;background:#fff;border:1px solid var(--line);border-radius:8px;color:var(--ink);font-size:16px;font-weight:600;line-height:1.2;cursor:pointer}",
    ".fhv-ui-ghost:hover{border-color:var(--gray2)}",
    ".fhv-ui-ghost[disabled]{color:var(--gray2);cursor:default;border-color:var(--line)}",
    ".fhv-ui-root button{font-family:inherit}",
    ".fhv-ui-root button:focus-visible{outline:2px solid var(--ink);outline-offset:3px}",
    /* E. your path */
    ".fhv-path-rail{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding-top:32px}",
    ".fhv-path-line{position:absolute;left:10%;right:10%;top:53px;height:2px;background:var(--spectrum);border-radius:2px;opacity:.9}",
    ".fhv-path-station{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;position:relative}",
    ".fhv-path-chips{position:absolute;top:-32px;left:0;right:0;display:flex;justify-content:center;gap:6px;min-height:24px}",
    ".fhv-path-chip{display:inline-flex;align-items:center;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--gray);padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--paper);white-space:nowrap;line-height:1.2}",
    ".fhv-path-chip.is-door{color:var(--paper);background:var(--ink);border-color:var(--ink)}",
    ".fhv-path-stop{display:flex;flex-direction:column;align-items:center;gap:10px;min-height:44px;min-width:44px;width:100%;padding:0 4px 8px;background:transparent;border:0;border-radius:10px;cursor:pointer;color:var(--ink);text-align:center}",
    ".fhv-path-stop:hover .fhv-path-name{text-decoration:underline;text-underline-offset:3px}",
    ".fhv-path-dotmark{position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:#fff;border:2px solid var(--gray2);color:var(--ink);transition:transform .25s;flex:0 0 auto}",
    ".fhv-path-dotmark.is-lit{background:var(--ink);border-color:var(--ink);color:var(--paper)}",
    ".fhv-path-station.is-open .fhv-path-stop .fhv-path-dotmark{box-shadow:0 0 0 4px var(--paper),0 0 0 6px var(--ink);transform:scale(1.04)}",
    ".fhv-path-idx{font-family:var(--mono);font-size:15px;font-weight:600;letter-spacing:.02em}",
    ".fhv-path-words{display:flex;flex-direction:column;gap:3px;align-items:center}",
    ".fhv-path-name{font-size:17px;font-weight:650;letter-spacing:-.015em;line-height:1.2}",
    ".fhv-path-station.is-lit .fhv-path-name{font-weight:750}",
    ".fhv-path-sub{font-size:13px;color:var(--gray);line-height:1.35}",
    ".fhv-path-said{border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:12px 14px;text-align:left;width:100%;display:flex;flex-direction:column;gap:4px}",
    ".fhv-path-said .fhv-ui-text{font-size:16px;font-style:italic}",
    ".fhv-path-goal{display:flex;flex-direction:column;gap:3px;align-items:center}",
    ".fhv-path-goalamt{font-size:24px;font-weight:700;letter-spacing:-.025em;font-variant-numeric:tabular-nums;line-height:1.1}",
    ".fhv-path-branch{display:flex;flex-direction:column;align-items:center;width:100%}",
    ".fhv-path-branchline{width:2px;height:18px;background:var(--gray2);border-radius:1px}",
    ".fhv-path-side{display:flex;flex-direction:column;align-items:center;gap:6px;min-height:44px;min-width:44px;width:100%;padding:8px 6px;background:var(--soft);border:1px solid var(--line);border-radius:10px;cursor:pointer;color:var(--ink)}",
    ".fhv-path-side .fhv-path-dotmark{width:28px;height:28px}",
    ".fhv-path-side .fhv-path-idx{font-size:14px}",
    ".fhv-path-side.is-open{box-shadow:0 0 0 2px var(--ink)}",
    ".fhv-path-sidename{font-size:16px;font-weight:650;letter-spacing:-.01em}",
    ".fhv-path-detail{border:1px solid var(--line);background:#fff;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;min-height:88px}",
    ".fhv-path-detail.is-empty{background:var(--soft);justify-content:center}",
    ".fhv-path-detail .fhv-ui-text{font-size:17px;max-width:760px}",
    /* A. money levers */
    ".fhv-levers-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:start}",
    ".fhv-levers-chart{display:flex;flex-direction:column;gap:16px;min-width:0}",
    ".fhv-levers-heads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}",
    ".fhv-levers-headcell{display:flex;flex-direction:column;gap:6px}",
    ".fhv-levers-headcell.is-waiting .fhv-ui-num{color:var(--gray2)}",
    ".fhv-levers-gap{display:inline-flex;align-items:baseline;gap:6px;align-self:flex-start;font-size:16px;font-weight:600;color:var(--ink);padding:8px 14px;border-radius:999px;background:var(--warn)}",
    ".fhv-levers-gap.is-zero{background:var(--soft);border:1px solid var(--line);font-weight:500;color:var(--gray)}",
    ".fhv-levers-gapamt{font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;font-size:18px}",
    ".fhv-levers-bars{position:relative;display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:12px;height:240px;margin:24px 0 42px;padding:0 12px;border-bottom:1px solid var(--line)}",
    ".fhv-levers-col{position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch}",
    ".fhv-levers-rise{position:absolute;left:0;right:0;bottom:calc(var(--b,0) * 1%);height:calc(var(--h,0) * 1%);min-height:3px;background:var(--ok);border:1px solid var(--ok);border-radius:4px 4px 0 0;transition:background .3s,border-color .3s}",
    ".fhv-levers-col.is-waiting .fhv-levers-rise{background:transparent;border:1px dashed var(--gray2)}",
    ".fhv-levers-rise.is-loss{background:var(--alert);border-color:var(--alert)}",
    ".fhv-levers-riselabel{position:absolute;left:0;right:0;top:-24px;text-align:center;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink)}",
    ".fhv-levers-bar{width:100%;height:calc(var(--h,0) * 1%);border-radius:8px 8px 0 0;min-height:3px;transition:height .7s cubic-bezier(.2,.7,.3,1)}",
    ".fhv-levers-bar.is-today{background:var(--ink)}",
    ".fhv-levers-bar.is-opt{background:var(--ok)}",
    ".fhv-levers-outline{position:absolute;left:0;right:0;bottom:0;height:calc(var(--h,0) * 1%);border:2px dashed var(--gray2);border-bottom:0;border-radius:8px 8px 0 0;pointer-events:none}",
    ".fhv-levers-outlinelabel{position:absolute;left:10px;top:8px;font-family:var(--mono);font-size:13px;letter-spacing:.06em;line-height:1.2;color:var(--ink2);font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".fhv-levers-outline.is-unknown{height:40%;border-color:var(--line)}",
    ".fhv-levers-barlabel{position:absolute;left:0;right:0;bottom:-36px;text-align:center;font-family:var(--sans);font-size:13px;font-weight:650;line-height:1.1;color:var(--gray)}",
    ".fhv-levers-goal{position:absolute;left:0;right:0;bottom:calc(var(--b,0) * 1%);height:calc(var(--h,0) * 1%);border-top:1px dashed var(--ink2);pointer-events:none}",
    ".fhv-levers-goal.is-band{background:rgba(13,17,19,.04);border-bottom:1px dashed var(--ink2)}",
    ".fhv-levers-goallabel{position:absolute;right:0;top:-24px;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);background:var(--paper);padding:0 6px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
    ".fhv-levers-goal.is-above{border-top:0}",
    ".fhv-levers-goal.is-above .fhv-levers-goallabel{top:-4px}",
    ".fhv-levers-tier{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;padding-top:16px;border-top:1px solid var(--line)}",
    ".fhv-levers-tier .fhv-ui-eyebrow{width:100%}",
    ".fhv-levers-chip{font-size:16px;font-weight:650;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--soft);color:var(--ink)}",
    ".fhv-levers-chip.is-after{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".fhv-levers-to{font-size:13px;color:var(--gray)}",
    ".fhv-levers-steps{display:flex;flex-direction:column;gap:16px;min-width:0}",
    ".fhv-levers-list{display:flex;flex-direction:column;gap:8px;margin-top:-6px}",
    ".fhv-levers-step{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:64px;padding:12px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);text-align:left;cursor:pointer;transition:background .2s,border-color .2s}",
    ".fhv-levers-step:hover{border-color:var(--gray2)}",
    ".fhv-levers-step.is-on{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".fhv-levers-step.is-on .fhv-ui-cap{color:var(--line)}",
    ".fhv-levers-stepidx{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:2px solid var(--ink);font-family:var(--mono);font-size:15px;font-weight:600}",
    ".fhv-levers-step.is-on .fhv-levers-stepidx{background:var(--ok);border-color:var(--ok);color:var(--ink)}",
    ".fhv-levers-stepwords{display:flex;flex-direction:column;gap:2px}",
    ".fhv-levers-steplabel{font-size:17px;font-weight:650;letter-spacing:-.015em;line-height:1.2}",
    ".fhv-levers-stepamt{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right;white-space:nowrap}",
    ".fhv-levers-delta{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.1}",
    ".fhv-levers-match{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--line);padding-top:16px}",
    ".fhv-levers-reports{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
    ".fhv-levers-report{border:1px solid var(--line);border-radius:10px;background:#fff;padding:16px;display:flex;flex-direction:column;gap:8px}",
    ".fhv-levers-bureau{font-size:17px;font-weight:650;letter-spacing:-.015em}",
    ".fhv-levers-cell{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--soft);overflow-wrap:anywhere}",
    ".fhv-levers-cell.is-diff{border:2px solid var(--alert);background:#fff}",
    ".fhv-levers-cell.is-missing .fhv-ui-text{color:var(--gray)}",
    /* F-01 file findings */
    ".fhv-findings-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
    ".fhv-findings-row{display:flex;flex-direction:column;gap:6px;min-height:64px;padding:12px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);text-align:left;cursor:pointer}",
    ".fhv-findings-row.is-open{border-color:var(--ink);background:color-mix(in srgb,var(--info) 10%,white)}",
    ".fhv-findings-rowtop{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px}",
    ".fhv-findings-rowtop strong{font-size:16px;font-weight:700;overflow-wrap:anywhere}",
    ".fhv-findings-kind,.fhv-findings-sub,.fhv-findings-barlabels{font-size:13px;color:var(--gray);line-height:1.2}",
    ".fhv-findings-kind{padding:3px 6px;border:1px solid var(--line);border-radius:4px;background:var(--soft);font-weight:650}",
    ".fhv-findings-bar{position:relative;height:10px;border:1px solid var(--line);border-radius:4px;background:var(--soft);overflow:visible}",
    ".fhv-findings-fill{display:block;width:calc(var(--balance,0) * 1%);height:100%;background:var(--ink);border-radius:3px}",
    ".fhv-findings-target{position:absolute;left:10%;top:-4px;bottom:-4px;width:2px;background:var(--warn)}",
    ".fhv-findings-barlabels{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}",
    ".fhv-findings-step{display:block;border-top:1px solid var(--line);padding-top:8px;font-size:16px;line-height:1.35}",
    /* F-02 lender wall */
    ".fhv-wall-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}",
    ".fhv-wall-count{display:flex;flex-direction:column;gap:4px;padding:16px 24px}",
    ".fhv-wall-count+.fhv-wall-count{border-left:1px solid var(--line)}",
    ".fhv-wall-count.is-after{background:color-mix(in srgb,var(--ok) 10%,white)}",
    ".fhv-wall-count .fhv-ui-num{font-size:32px;font-weight:750}",
    ".fhv-wall-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:8px;min-width:0}",
    ".fhv-wall-tile{display:flex;flex-direction:column;gap:2px;align-items:center;justify-content:center;min-height:68px;padding:8px 4px;text-align:center;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--gray)}",
    ".fhv-wall-tile.is-today{background:var(--ink);border-color:var(--ink);color:var(--paper)}",
    ".fhv-wall-tile.is-lit{background:color-mix(in srgb,var(--ok) 10%,white);border-color:var(--ok);color:var(--ink)}",
    ".fhv-wall-tile.is-waiting{border-style:dashed}",
    ".fhv-wall-index{font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1}",
    ".fhv-wall-label,.fhv-wall-status{font-size:13px;font-weight:650;line-height:1.1}",
    ".fhv-wall-status{font-weight:400}",
    ".fhv-wall-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px}",
    /* B. companies */
    ".fhv-companies-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}",
    ".fhv-companies-tab{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;min-height:56px;min-width:44px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);text-align:left;cursor:pointer;transition:background .2s,border-color .2s}",
    ".fhv-companies-tab:hover{border-color:var(--gray2)}",
    ".fhv-companies-tab.is-on{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".fhv-companies-tab.is-on .fhv-ui-cap,.fhv-companies-tab.is-on .fhv-companies-tabamt{color:var(--line)}",
    ".fhv-companies-tab.is-add{border-style:dashed;border-color:var(--gray2);background:var(--soft)}",
    ".fhv-companies-tab.is-add[aria-disabled=\"true\"]{opacity:.65;cursor:default}",
    ".fhv-companies-tabs .fhv-ui-ghost{align-self:center}",
    ".fhv-companies-tabname{font-size:16px;font-weight:650;letter-spacing:-.01em;line-height:1.2}",
    ".fhv-companies-tabamt{font-size:13px;color:var(--gray);font-variant-numeric:tabular-nums}",
    ".fhv-companies-chart{display:flex;flex-direction:column;gap:12px}",
    ".fhv-companies-heads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}",
    ".fhv-companies-headcell{display:flex;flex-direction:column;gap:6px}",
    ".fhv-companies-bar{display:flex;gap:3px;height:64px;width:100%}",
    /* No padding on the layer itself: with flex-basis 0 any padding would add to
       its width and the Today marker would no longer sit where today's layers end.
       The words inside carry the padding instead. */
    ".fhv-companies-seg{flex:var(--g,0) 1 0px;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:0;border-radius:8px;overflow:hidden;white-space:nowrap;container-type:inline-size;container-name:fhvseg;transition:flex-grow .7s cubic-bezier(.2,.7,.3,1)}",
    ".fhv-companies-segname,.fhv-companies-segamt{padding:0 10px}",
    ".fhv-companies-seg.is-personal{background:var(--ink);color:var(--paper)}",
    ".fhv-companies-seg.is-biz{background:var(--info);color:var(--ink)}",
    ".fhv-companies-seg.is-biz.is-alt{background:var(--ok)}",
    ".fhv-companies-seg.is-added{background:#fff;border:2px dashed var(--gray2);color:var(--ink2)}",
    ".fhv-companies-segname{font-size:13px;font-weight:650;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis}",
    ".fhv-companies-segshort{display:none;font-size:13px;font-weight:700;text-align:center;padding:0 2px}",
    ".fhv-companies-segamt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis}",
    /* Thin layers by share (the floor), then by the layer's real width. */
    ".fhv-companies-seg.is-narrow .fhv-companies-segamt{display:none}",
    ".fhv-companies-seg.is-tiny .fhv-companies-segamt,.fhv-companies-seg.is-tiny .fhv-companies-segname{display:none}",
    ".fhv-companies-seg.is-tiny .fhv-companies-segshort{display:block}",
    "@container fhvseg (max-width:118px){.fhv-companies-segamt{display:none}}",
    "@container fhvseg (max-width:92px){.fhv-companies-segname{display:none}.fhv-companies-segshort{display:block}}",
    ".fhv-companies-markrow{position:relative;height:30px;margin-top:-4px;pointer-events:none}",
    ".fhv-companies-marker{position:absolute;top:0;width:0;height:30px;left:calc((100% - var(--gaps,0) * 3px) * var(--l,0) / 100 + var(--k,0) * 3px);transition:left .7s cubic-bezier(.2,.7,.3,1)}",
    ".fhv-companies-markline{position:absolute;left:-1px;top:-8px;width:2px;height:16px;background:var(--ink)}",
    ".fhv-companies-marklabel{position:absolute;left:0;top:10px;transform:translateX(-100%);padding-right:6px;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);white-space:nowrap}",
    ".fhv-companies-marker.is-left .fhv-companies-marklabel{transform:none;padding-right:0;padding-left:6px}",
    ".fhv-companies-legend{display:flex;flex-wrap:wrap;gap:8px 16px}",
    ".fhv-companies-key{display:inline-flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--gray);line-height:1.3}",
    ".fhv-companies-key b{color:var(--ink);font-weight:650;white-space:nowrap}",
    ".fhv-companies-key::before{content:\"\";width:12px;height:12px;border-radius:3px;flex:0 0 auto;margin-top:2px;background:var(--soft);border:1px solid var(--line)}",
    ".fhv-companies-key.is-personal::before{background:var(--ink);border-color:var(--ink)}",
    ".fhv-companies-key.is-biz::before{background:var(--info);border-color:var(--info)}",
    ".fhv-companies-key.is-biz.is-alt::before{background:var(--ok);border-color:var(--ok)}",
    ".fhv-companies-key.is-added::before{background:#fff;border:2px dashed var(--gray2)}",
    ".fhv-companies-years{display:flex;flex-direction:column;gap:8px}",
    ".fhv-companies-switch{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;align-self:flex-start;max-width:100%}",
    ".fhv-companies-year{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:56px;min-width:44px;padding:8px 16px;border:0;border-right:1px solid var(--line);background:#fff;color:var(--ink);font-size:16px;font-weight:650;cursor:pointer}",
    ".fhv-companies-year:last-child{border-right:0}",
    ".fhv-companies-year.is-on{background:var(--ink);color:var(--paper)}",
    ".fhv-companies-year.is-on .fhv-ui-cap{color:var(--line)}",
    ".fhv-companies-detail{border:1px solid var(--line);background:#fff;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px}",
    ".fhv-companies-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}",
    ".fhv-companies-pair>:only-child{grid-column:1/-1}",
    ".fhv-companies-pair .fhv-companies-proof{max-width:none}",
    ".fhv-companies-timeline{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--line);padding-top:12px}",
    ".fhv-companies-seqs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
    ".fhv-companies-seq{border:1px solid var(--line);border-radius:10px;background:var(--soft);padding:16px;display:flex;flex-direction:column;gap:4px}",
    ".fhv-companies-seq.is-now{background:#fff;border-color:var(--ink)}",
    ".fhv-companies-seqname{font-size:17px;font-weight:650;letter-spacing:-.015em}",
    ".fhv-companies-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
    ".fhv-companies-chip{display:inline-flex;align-items:center;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--gray);white-space:nowrap;line-height:1.2}",
    ".fhv-companies-chip.is-personal{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".fhv-companies-chip.is-biz{background:var(--info);border-color:var(--info);color:var(--ink)}",
    ".fhv-companies-chip.is-biz.is-alt{background:var(--ok);border-color:var(--ok)}",
    ".fhv-companies-chip.is-dim{color:var(--gray)}",
    ".fhv-companies-chip.is-added{border:1px dashed var(--gray2);color:var(--ink2)}",
    ".fhv-companies-proof{border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:10px;background:#fff;padding:16px;display:flex;flex-direction:column;gap:8px;max-width:760px}",
    /* narrow: one column, nothing sideways. Container query first, viewport fallback second. */
    "@container (max-width:680px){" + NARROW + "}",
    "@media (max-width:680px){" + NARROW + "}",
    "@media (max-height:1000px){" + SHORT + "@container (min-width:681px){" + SHORT_WIDE + "}}",
    "@media (prefers-reduced-motion:reduce){.fhv-ui-root *{transition:none!important}}"
  ].join("\n");

  function ensureStyle() {
    if (!doc || typeof doc.createElement !== "function" || !doc.head) return;
    if (typeof doc.getElementById === "function" && doc.getElementById("fhv-style")) return;
    const el = doc.createElement("style");
    el.id = "fhv-style";
    el.textContent = CSS;
    doc.head.appendChild(el);
  }

  /* Exposed for tests only: the fixed words the visuals can print, so a copy
     check can scan them without rendering every state. */
  V.__visualsWords = { STATIONS, SIDE_DOOR, LEVER_SUB, TIER_WORDS };
})(typeof window !== "undefined" ? window : globalThis);
