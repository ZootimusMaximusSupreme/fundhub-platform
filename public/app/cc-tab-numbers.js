/* cc-tab-numbers.js — the Command Center's Numbers tab: Ads · Angles · Funnels.

   WHAT THIS IS. Plan unit U38 (ops/workflows/marketing-machine-2026-10-plan.json),
   spec docs/specs/marketing-machine-2026-10-04.md §11.3, design
   docs/specs/command-center-design-2026-10-05.md §3.7. One tab file, plugged
   into the frame by the contract in docs/specs/command-center-tabs.md
   (window.FundhubCC.registerTab). The frame owns the page; this file owns only
   what it draws inside the root element it is handed.

   WHAT IT READS AND SENDS. Nothing here changes an ad, a budget or a page.
     GET  marketing/ads?from&to&funnel&format&angle   the Ads table (U31)
     GET  marketing/ad?n=                              one ad's drawer (U31)
     GET  marketing/angles                             the Angles view (U32)
     GET  marketing/funnels/stats                      the Funnels view (U32)
     GET  marketing/funnels                            funnel names for the filter (U03)
     POST marketing/ideas {request_id, raw_points, angle_key, source:'chris'}
                                                       "Make more of this" (U26, free)
   The unmapped-spend Link button opens Settings at the funnel mapping (U34).

   NEVER FAKE A NUMBER. null prints "unknown", never $0 or 0% (CLAUDE.md §12).
   Counts and money come from the server as they are; the page adds nothing up.
   The only arithmetic here is two step rates the funnel answer does not carry
   (lead to call = booked ÷ leads, call to sale = sales ÷ showed). They use the
   same rule as src/marketing/metrics.mjs (rounded to 4 places, null when either
   side is unknown or the bottom is 0) and src/ui/cc-tab-numbers.test.mjs holds
   the two copies equal.

   WORDS. The metric names are docs/marketing/metrics.md's (CTR, Hook rate,
   25% hold, Thruplay rate, ...). "25% hold" is plays that reached a quarter of
   the video (Meta's own definition, marketing/ads/watch-curve.md); it is not
   ad-spine's hold rate. There is no 3-second number anywhere: Meta has none.

   TYPE. fundhub-brand.css forces every element inside the shell to inherit its
   parent's size (UI-STANDARDS §12.7), so this file sets no font sizes at all.
   Small text uses the whitelist classes (.caption, .eyebrow, .chip, th, label,
   .mono); the big numbers use .big. The watch curve draws no SVG text: its
   labels are HTML, so they never shrink below 13px on a phone.

   TESTABLE WITHOUT A BROWSER. Every rule that turns data into words is a plain
   function on window.FundhubCCNumbers; src/ui/cc-tab-numbers.test.mjs runs this
   file in node:vm. The drawing code only runs when the frame calls render(). */
(function (W) {
  "use strict";

  /* ── words and lists ─────────────────────────────────────────────────── */

  const VIEWS = Object.freeze([
    ["ads", "Ads"],
    ["angles", "Angles"],
    ["funnels", "Funnels"]
  ]);

  /* src/marketing/settings-store.mjs FORMATS, in the same order. */
  const FORMATS = Object.freeze([
    ["standard", "Standard"],
    ["sorting", "Sorting"],
    ["long", "Long"],
    ["notes", "Notes"],
    ["greenscreen", "Green screen"],
    ["vsl", "Sales video (VSL)"]
  ]);

  const WINDOWS = Object.freeze([
    ["7", "Last 7 days"],
    ["14", "Last 14 days"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
    ["pick", "Pick days"]
  ]);

  /* Meta's video_play_curve_actions buckets (marketing/ads/watch-curve.md):
     entries 0-14 are seconds 0-14, 15-17 are [15,20) [20,25) [25,30),
     18-20 are [30,40) [40,50) [50,60), and 21 is over 60 seconds. */
  const CURVE_BUCKETS = Object.freeze([
    "0 s", "1 s", "2 s", "3 s", "4 s", "5 s", "6 s", "7 s", "8 s", "9 s",
    "10 s", "11 s", "12 s", "13 s", "14 s", "15 to 20 s", "20 to 25 s",
    "25 to 30 s", "30 to 40 s", "40 to 50 s", "50 to 60 s", "over 60 s"
  ]);
  /* Where the x-axis labels sit (bucket index -> label). */
  const CURVE_TICKS = Object.freeze([[0, "0s"], [5, "5s"], [10, "10s"], [15, "15s"], [18, "30s"], [21, "60s+"]]);

  /* The Ads table. key = the row key, kind = how it prints, tip = plain words
     for the hover. The ad column is drawn on its own. */
  const AD_COLUMNS = Object.freeze([
    { key: "spend_cents", label: "Spend", kind: "money", tip: "Ad spend in these days (Meta's own day, Arizona time)." },
    { key: "leads", label: "Leads", kind: "count", tip: "People tagged with this ad number, by the day they came in." },
    { key: "booked", label: "Booked calls", kind: "count", tip: "Those leads who booked a call in their first 14 days." },
    { key: "sales", label: "Sales", kind: "count", tip: "Those leads who bought in their first 14 days." },
    { key: "cash_cents", label: "Cash", kind: "money", tip: "Payments that went through from those leads." },
    { key: "roas", label: "ROAS", kind: "roas", tip: "Cash back for each $1 of ad spend (cash ÷ spend)." },
    { key: "cpl_cents", label: "Cost per lead", kind: "money", tip: "Spend ÷ leads." },
    { key: "cost_per_booked_cents", label: "Cost per booked call", kind: "money", tip: "Spend ÷ booked calls." },
    { key: "ctr", label: "CTR", kind: "pct", tip: "Taps on the link ÷ times the ad was shown." },
    { key: "hook_rate", label: "Hook rate", kind: "pct", tip: "People who watched 2 seconds ÷ times the ad was shown." },
    { key: "hold_25", label: "25% hold", kind: "pct", tip: "Plays that reached a quarter of the video ÷ plays." },
    { key: "thruplay_rate", label: "Thruplay rate", kind: "pct", tip: "Plays watched 15 seconds or to the end ÷ plays." },
    { key: "impressions", label: "Impressions", kind: "count", tip: "Times Meta showed the ad." },
    { key: "showed", label: "Showed", kind: "count", tip: "Leads who showed up to their call." },
    { key: "close_rate", label: "Close rate", kind: "pct", tip: "Sales ÷ people who showed." },
    { key: "roadmaps", label: "$147 roadmaps", kind: "count", tip: "Leads who bought the $147 roadmap." },
    { key: "reported_cash_cents", label: "Reported cash", kind: "money", tip: "Cash the closers typed in after calls." }
  ]);

  const SORTABLE = new Set(["ad_number"].concat(AD_COLUMNS.map((c) => c.key)));

  /* ── numbers into words ──────────────────────────────────────────────── */

  /* A count or an amount the server sent, or null when it is unknown. The same
     reading as src/marketing/metrics.mjs known(): anything that is not a finite
     number of 0 or more is unknown. */
  function known(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /* top ÷ bottom, rounded to 4 places; null when a side is unknown or the
     bottom is 0. Kept equal to metrics.mjs fraction() by the unit test. */
  function rate(top, bottom) {
    const t = known(top);
    const b = known(bottom);
    if (t === null || b === null || b === 0) return null;
    return Math.round((t / b) * 10000) / 10000;
  }

  /* Whole cents per unit, rounded half up; null when a side is unknown or the
     bottom is 0 ("no leads" has no cost per lead, it is not $0). Kept equal to
     metrics.mjs centsPer() by the unit test. */
  function centsPer(cents, n) {
    const c = known(cents);
    const k = known(n);
    if (c === null || k === null || k === 0) return null;
    return Math.round(c / k);
  }

  const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  /* "$1,563.13", or "unknown" for null. Never $0 for null. */
  function money(cents) {
    const c = known(cents);
    return c === null ? "unknown" : USD.format(Math.round(c) / 100);
  }

  function count(n) {
    const v = known(n);
    return v === null ? "unknown" : INT.format(v);
  }

  /* A 0..1 rate as a percent: 0.1843 -> "18.4%". null -> "unknown". */
  function pct(r) {
    const v = known(r);
    if (v === null) return "unknown";
    let s = (Math.round(v * 1000) / 10).toFixed(1);
    if (s.endsWith(".0")) s = s.slice(0, -2);
    return s + "%";
  }

  /* ROAS as "1.43x". null -> "unknown". */
  function roas(r) {
    const v = known(r);
    return v === null ? "unknown" : (Math.round(v * 100) / 100).toFixed(2) + "x";
  }

  function cell(kind, v) {
    if (kind === "money") return money(v);
    if (kind === "pct") return pct(v);
    if (kind === "roas") return roas(v);
    return count(v);
  }

  /* ── Arizona days ────────────────────────────────────────────────────── */

  /* The ad account's day is America/Phoenix: UTC-7 all year, no daylight
     saving (src/lib/ad-account-day.mjs). The unit test holds this equal to
     adAccountDay() across the year. */
  const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;

  function azToday(nowMs) {
    return new Date(nowMs - AZ_OFFSET_MS).toISOString().slice(0, 10);
  }

  function addDays(ymd, n) {
    const d = new Date(ymd + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* "2026-10-04" -> "Oct 4". */
  function dayLabel(ymd) {
    if (!YMD.test(String(ymd || ""))) return "unknown day";
    const [, m, d] = ymd.split("-").map(Number);
    return MONTHS[m - 1] + " " + d;
  }

  /* The window the filters ask for, as Arizona days (both ends included).
     A preset of N days ends today. "pick" uses the two dates; a half-picked or
     backwards range falls back to the last 30 days and says why. */
  function windowFor(filters, nowMs) {
    const today = azToday(nowMs);
    const f = filters || {};
    if (f.win === "pick") {
      const from = YMD.test(f.from || "") ? f.from : null;
      const to = YMD.test(f.to || "") ? f.to : null;
      if (from && to && from <= to) return { from, to, note: null };
      if (from && !to && from <= today) return { from, to: today, note: null };
      return {
        from: addDays(today, -29), to: today,
        note: from && to ? "The first day is after the last day, so this shows the last 30 days."
          : "Pick both days. Until then this shows the last 30 days."
      };
    }
    const days = Math.max(1, Number(f.win) || 30);
    return { from: addDays(today, -(days - 1)), to: today, note: null };
  }

  /* The GET marketing/ads path for these filters. */
  function adsPath(filters, nowMs) {
    const w = windowFor(filters, nowMs);
    const q = ["from=" + encodeURIComponent(w.from), "to=" + encodeURIComponent(w.to)];
    const f = filters || {};
    if (f.funnel) q.push("funnel=" + encodeURIComponent(f.funnel));
    if (f.format) q.push("format=" + encodeURIComponent(f.format));
    if (f.angle) q.push("angle=" + encodeURIComponent(f.angle));
    return "marketing/ads?" + q.join("&");
  }

  function filtersOn(filters) {
    const f = filters || {};
    return Boolean(f.funnel || f.format || f.angle || (f.win && f.win !== "30"));
  }

  /* ── sorting ─────────────────────────────────────────────────────────── */

  /* Sort a copy. Unknown (null) always sorts last, whichever way the column
     points, so "unknown" never pretends to be the smallest number. Ties go by
     ad number, smallest first. */
  function sortRows(rows, key, dir) {
    const k = SORTABLE.has(key) ? key : "spend_cents";
    const sign = dir === "asc" ? 1 : -1;
    const num = (r) => (k === "ad_number" ? Number(r.ad_number) : known(r[k]));
    return (rows || []).slice().sort((a, b) => {
      const va = num(a);
      const vb = num(b);
      const na = va === null || Number.isNaN(va);
      const nb = vb === null || Number.isNaN(vb);
      if (na !== nb) return na ? 1 : -1;
      if (!na && va !== vb) return (va - vb) * sign;
      return Number(a.ad_number) - Number(b.ad_number);
    });
  }

  /* The next sort when a header is tapped: the same column flips; a new column
     starts with the biggest first (smallest first for the ad number). */
  function nextSort(current, key) {
    if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
    return { key, dir: key === "ad_number" ? "asc" : "desc" };
  }

  /* ── the watch curve ─────────────────────────────────────────────────── */

  function curveList(v) {
    let c = v;
    if (typeof c === "string") {
      try { c = JSON.parse(c); } catch (e) { c = null; }
    }
    if (!Array.isArray(c) || c.length < 2) return null;
    const out = c.map((x) => known(x));
    return out.every((x) => x === null) ? null : out;
  }

  /* The days the drawer can show, newest first: one choice per Meta ad per
     saved ad-day. Two Meta ads with one number keep two curves (never
     averaged), so the label names which ad when there is more than one. */
  function curveChoices(ad) {
    const curve = (ad && Array.isArray(ad.curve)) ? ad.curve : [];
    const metaAds = (ad && Array.isArray(ad.meta_ads)) ? ad.meta_ads : [];
    const ids = [];
    curve.forEach((c) => { if (c && c.ad_id && ids.indexOf(c.ad_id) < 0) ids.push(c.ad_id); });
    const many = ids.length > 1;
    const nameOf = (id) => {
      const i = metaAds.findIndex((m) => m.id === id);
      return i >= 0 ? "Meta ad " + (i + 1) : "Meta ad " + (ids.indexOf(id) + 1);
    };
    return curve
      .map((c, i) => ({
        key: String(i),
        date: c.date,
        ad_id: c.ad_id || null,
        points: curveList(c.video_play_curve),
        label: dayLabel(c.date) + (many ? " · " + nameOf(c.ad_id) : "")
      }))
      .sort((a, b) => (a.date === b.date ? Number(a.key) - Number(b.key) : (a.date < b.date ? 1 : -1)));
  }

  /* The choice the drawer opens on: the newest day Meta sent a curve for. */
  function defaultChoice(choices) {
    const withCurve = (choices || []).find((c) => c.points);
    return withCurve ? withCurve.key : ((choices || [])[0] || {}).key || null;
  }

  /* What the hand-drawn chart needs: the polyline and area in a 0..100 box
     (x = bucket position, y = 100 - percent still watching), the tick
     positions, and plain-words notes. Values over 100 (Meta restates) are
     drawn at the top and printed as sent. */
  function curveModel(points) {
    const pts = curveList(points);
    if (!pts) return null;
    const last = pts.length - 1;
    const xy = [];
    pts.forEach((v, i) => {
      if (v === null) return;
      const x = (i / last) * 100;
      const y = 100 - Math.min(100, v);
      xy.push(x.toFixed(2) + "," + y.toFixed(2));
    });
    const firstX = (pts.findIndex((v) => v !== null) / last) * 100;
    let lastI = last;
    while (lastI > 0 && pts[lastI] === null) lastI--;
    const area = firstX.toFixed(2) + ",100 " + xy.join(" ") + " " + ((lastI / last) * 100).toFixed(2) + ",100";
    const ticks = CURVE_TICKS.filter(([i]) => i <= last).map(([i, label]) => ({ left: (i / last) * 100, label }));
    const at2 = pts.length > 2 ? pts[2] : null;
    const rows = pts.map((v, i) => ({ bucket: CURVE_BUCKETS[i] || ("bucket " + (i + 1)), value: v }));
    return { line: xy.join(" "), area, ticks, at2, rows };
  }

  /* "At 2 seconds, 47% were still watching (from the curve)." */
  function twoSecondNote(model) {
    if (!model || model.at2 === null) return "Meta sent no 2-second point on this curve.";
    return "At 2 seconds, " + Math.round(model.at2) + "% of plays were still watching (from the curve).";
  }

  /* ── the watch diagnosis, in words ───────────────────────────────────── */

  const DIAGNOSIS_WORDS = Object.freeze({
    opening: "The opening loses them.",
    middle: "The middle loses them.",
    ask: "The ask loses them."
  });
  const FIX_WORDS = Object.freeze({
    visual: "Change what they see.",
    words: "Change the words.",
    both: "Change what they see and the words."
  });

  function diagnosisWords(d) {
    if (!d) return null;
    let next = "Next take: not scored yet.";
    if (d.next_take_improved === true) next = "Next take: it did better.";
    if (d.next_take_improved === false) next = "Next take: it did not do better.";
    return {
      day: dayLabel(d.date),
      what: DIAGNOSIS_WORDS[d.diagnosis] || "The curve broke somewhere.",
      fix: FIX_WORDS[d.fix_type] || "",
      note: String(d.film_note || "").trim(),
      next
    };
  }

  function alertWords(a) {
    if (!a || !a.dies_before_25_alerted_on) return null;
    return "Buzz sent " + dayLabel(a.dies_before_25_alerted_on) +
      ": most plays stopped before a quarter of the video, and people were not tapping through.";
  }

  function statusWord(s) {
    const v = String(s || "").toUpperCase();
    if (v === "ACTIVE") return "Running";
    if (v === "PAUSED") return "Paused";
    if (!v) return "Status unknown";
    return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
  }

  /* ── funnels ─────────────────────────────────────────────────────────── */

  /* The steps one funnel card draws: ad -> page -> lead -> call -> sale. The
     first two rates come from the server; lead to call and call to sale are
     divided here with metrics.mjs's rule (see the header). */
  function funnelSteps(row) {
    const r = row || {};
    return [
      { key: "page_views", label: "Page views", value: count(r.page_views),
        rateLabel: "Click to page", rate: known(r.click_to_page), rateTip: "Page views ÷ taps on the ad's link." },
      { key: "leads", label: "Leads", value: count(r.leads),
        rateLabel: "Page to lead", rate: known(r.page_to_lead), rateTip: "Leads ÷ page views." },
      { key: "booked", label: "Booked calls", value: count(r.booked),
        rateLabel: "Lead to call", rate: rate(r.booked, r.leads), rateTip: "Booked calls ÷ leads." },
      { key: "showed", label: "Showed", value: count(r.showed),
        rateLabel: null, rate: null, rateTip: null },
      { key: "sales", label: "Sales", value: count(r.sales),
        rateLabel: "Call to sale", rate: rate(r.sales, r.showed), rateTip: "Sales ÷ people who showed (close rate)." }
    ];
  }

  /* ── angles ──────────────────────────────────────────────────────────── */

  function angleName(row) {
    const r = row || {};
    return String(r.name || r.angle_key || "This angle");
  }

  /* The text a "Make more of this" idea starts with. Chris can change it. */
  function ideaText(row) {
    return "Make more ads on the angle \"" + angleName(row) + "\". Same idea, new hooks.";
  }

  /* The keys POST marketing/ideas takes for angle_key (src/marketing/
     ideas-store.mjs KEY_RE). A key in another shape stays in the words only,
     so the save never fails on it. */
  const IDEA_KEY_RE = /^[a-z][a-z0-9_]{1,48}$/;

  /* The POST marketing/ideas body (U26 shape 4). */
  function ideaBody(row, text, requestId) {
    const key = row && typeof row.angle_key === "string" && IDEA_KEY_RE.test(row.angle_key) ? row.angle_key : undefined;
    return {
      request_id: requestId,
      raw_points: String(text || "").trim(),
      angle_key: key,
      source: "chris"
    };
  }

  function bySpend(rows) {
    return (rows || []).slice().sort((a, b) => {
      const va = known(a.spend_cents);
      const vb = known(b.spend_cents);
      if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
      if (va !== vb) return vb - va;
      return 0;
    });
  }

  /* ── answers back ────────────────────────────────────────────────────── */

  /* One plain sentence for a failed read of `what` ("The ad numbers"). Never a
     status code (UI-STANDARDS §6.3). */
  function errorSentence(what, res) {
    const r = res || {};
    const st = Number(r.status) || 0;
    if (st === 0) return what + " did not load: no connection. Check the internet, then try again.";
    if (st === 401) return "Your sign-in ran out. Sign in again to see these numbers.";
    if (st === 403) return "Only the owner and admins can see these numbers.";
    if (st === 404) return what + " are not on the server yet. They arrive with the next update.";
    if (st === 503) return "The database is not answering right now. Try again in a minute.";
    const msg = r.data && typeof r.data.message === "string" ? r.data.message.trim() : "";
    if (st === 400 && msg) return msg;
    return what + " did not load. The rest of this page is current. Try again.";
  }

  function saveErrorSentence(res) {
    const r = res || {};
    const st = Number(r.status) || 0;
    if (st === 0) return "Not saved: no connection. Your words are still here. Try again.";
    if (st === 401) return "Not saved: your sign-in ran out. Sign in again, then save.";
    if (st === 403) return "Not saved: only the owner and admins can add ideas.";
    const msg = r.data && typeof r.data.message === "string" ? r.data.message.trim() : "";
    if (st === 400 && msg) return "Not saved: " + msg;
    return "Not saved. Something went wrong on our side. Your words are still here. Try again.";
  }

  function asOfLine(asOf, fmtAz) {
    if (!asOf) return "Meta numbers: never pulled yet.";
    return "Meta numbers pulled " + fmtAz(asOf) + " Arizona time.";
  }

  /* ── tiny HTML helpers ───────────────────────────────────────────────── */

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function uuid() {
    try {
      if (W.crypto && typeof W.crypto.randomUUID === "function") return W.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }

  function fallbackAz(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "unknown time";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      }).format(d);
    } catch (e) {
      return d.toISOString();
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     THE TAB. Everything below needs a DOM and only runs from render().
     ════════════════════════════════════════════════════════════════════ */

  const STORE_KEY = "fh.cc.numbers.view";

  const state = {
    root: null,
    ctx: null,
    view: "ads",
    filters: { win: "30", from: "", to: "", funnel: "", format: "", angle: "" },
    sort: { key: "spend_cents", dir: "desc" },
    parts: {},
    drawer: null,
    sheet: null,
    saved: {},
    seq: 0,
    wired: false
  };

  function now() {
    return Date.now();
  }

  function fmtAz(ts) {
    const f = state.ctx && state.ctx.fmt && state.ctx.fmt.az;
    if (typeof f === "function") {
      try {
        const out = f(ts);
        if (out) return out;
      } catch (e) { /* fall back */ }
    }
    return fallbackAz(ts);
  }

  async function call(method, path, body, opts) {
    const ctx = state.ctx;
    if (!ctx || typeof ctx.api !== "function") return { ok: false, status: 0, data: null };
    try {
      const res = await ctx.api(method, path, body, opts || {});
      return res || { ok: false, status: 0, data: null };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  }

  function part(name) {
    if (!state.parts[name]) state.parts[name] = { status: "idle", data: null, res: null, key: null, token: 0 };
    return state.parts[name];
  }

  /* Read one part. A newer read of the same part wins; an older answer that
     arrives late is dropped. */
  async function load(name, path, force) {
    const p = part(name);
    if (!force && p.key === path && (p.status === "ok" || p.status === "loading")) return;
    const token = ++state.seq;
    p.token = token;
    p.key = path;
    p.status = "loading";
    paint();
    const res = await call("GET", path);
    if (p.token !== token) return;
    p.res = res;
    if (res.ok && res.data) {
      p.status = "ok";
      p.data = res.data;
    } else {
      p.status = "error";
    }
    paint();
  }

  function loadView(force) {
    if (state.view === "ads") {
      load("ads", adsPath(state.filters, now()), force);
      load("funnelList", "marketing/funnels", force);
      load("angles", "marketing/angles", force);
    } else if (state.view === "angles") {
      load("angles", "marketing/angles", force);
    } else {
      load("funnels", "marketing/funnels/stats", force);
    }
  }

  async function openDrawer(n, force) {
    const key = String(n || "");
    if (!/^[0-9]{1,9}$/.test(key)) return;
    const token = ++state.seq;
    state.drawer = { n: key, status: "loading", data: null, res: null, pick: null, token };
    setHash();
    paint();
    const res = await call("GET", "marketing/ad?n=" + encodeURIComponent(key));
    if (!state.drawer || state.drawer.token !== token) return;
    state.drawer.res = res;
    if (res.ok && res.data && res.data.ad) {
      state.drawer.status = "ok";
      state.drawer.data = res.data;
      state.drawer.pick = defaultChoice(curveChoices(res.data.ad));
    } else {
      state.drawer.status = "error";
    }
    paint();
    if (!force) focusSoon("[data-fid='drawer-close']");
  }

  function closeDrawer() {
    const n = state.drawer && state.drawer.n;
    state.drawer = null;
    setHash();
    paint();
    if (n) focusSoon("[data-action='open'][data-n='" + n + "'] button, button[data-action='open'][data-n='" + n + "']");
  }

  function setHash() {
    try {
      let h = "#numbers/" + state.view;
      if (state.view === "ads" && state.drawer) h += "/" + state.drawer.n;
      if (W.location && W.history && typeof W.history.replaceState === "function" && W.location.hash !== h) {
        W.history.replaceState(W.history.state, "", h);
      }
    } catch (e) { /* the URL is a convenience */ }
  }

  function remember(view) {
    try { W.localStorage.setItem(STORE_KEY, view); } catch (e) { /* private window */ }
  }

  function recalled() {
    try { return W.localStorage.getItem(STORE_KEY) || ""; } catch (e) { return ""; }
  }

  function focusSoon(selector) {
    setTimeout(() => {
      try {
        const el = state.root && state.root.querySelector(selector);
        if (el && typeof el.focus === "function") el.focus();
      } catch (e) { /* nothing to focus */ }
    }, 0);
  }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function names() {
    const funnels = {};
    const angles = {};
    const fl = part("funnelList");
    if (fl.status === "ok" && Array.isArray(fl.data.funnels)) {
      fl.data.funnels.forEach((f) => { if (f && f.key) funnels[f.key] = f.name || f.key; });
    }
    const fs = part("funnels");
    if (fs.status === "ok" && Array.isArray(fs.data.rows)) {
      fs.data.rows.forEach((f) => { if (f && f.funnel_key && !funnels[f.funnel_key]) funnels[f.funnel_key] = f.name || f.funnel_key; });
    }
    const an = part("angles");
    if (an.status === "ok" && Array.isArray(an.data.rows)) {
      an.data.rows.forEach((a) => { if (a && a.angle_key) angles[a.angle_key] = a.name || a.angle_key; });
    }
    return { funnels, angles };
  }

  function formatWord(key) {
    const hit = FORMATS.find((f) => f[0] === key);
    return hit ? hit[1] : (key || "");
  }

  function skeletonTable(rows) {
    let out = '<div class="ccn-skel-table" aria-busy="true" aria-label="Loading">';
    for (let i = 0; i < rows; i++) out += '<span class="ccn-skel"></span>';
    return out + "</div>";
  }

  function skeletonCards(n) {
    let out = '<div class="ccn-grid" aria-busy="true" aria-label="Loading">';
    for (let i = 0; i < n; i++) {
      out += '<div class="card ccn-card ccn-span"><span class="ccn-skel short"></span><span class="ccn-skel"></span><span class="ccn-skel"></span><span class="ccn-skel"></span></div>';
    }
    return out + "</div>";
  }

  function errorBox(what, res, retry) {
    return '<div class="ccn-say err" role="alert"><span>' + esc(errorSentence(what, res)) + '</span>' +
      '<button type="button" class="ccn-btn" data-action="retry" data-part="' + esc(retry) + '">Try again</button></div>';
  }

  function viewSwitch() {
    let out = '<div class="ccn-views" role="tablist" aria-label="Numbers views">';
    VIEWS.forEach(([key, label]) => {
      const on = state.view === key;
      out += '<button type="button" role="tab" class="ccn-view' + (on ? " on" : "") + '" aria-selected="' + on +
        '" data-action="view" data-view="' + key + '" data-fid="view-' + key + '">' + esc(label) + "</button>";
    });
    return out + "</div>";
  }

  function currentAsOf() {
    const name = state.view === "ads" ? "ads" : state.view;
    const p = part(name);
    if (p.status !== "ok") return null;
    return { value: p.data.as_of === undefined ? null : p.data.as_of };
  }

  function topBar() {
    const a = currentAsOf();
    const line = a ? asOfLine(a.value, fmtAz) : "Loading the latest Meta numbers…";
    return '<div class="ccn-top">' + viewSwitch() +
      '<p class="caption ccn-asof" data-test="as-of">' + esc(line) + "</p></div>";
  }

  /* ── Ads view ── */

  function selectHtml(id, key, label, options, value) {
    let out = '<div class="ccn-f"><label for="' + id + '">' + esc(label) + "</label>" +
      '<select id="' + id + '" data-action="filter" data-key="' + key + '" data-fid="' + id + '">';
    options.forEach(([v, text]) => {
      out += '<option value="' + esc(v) + '"' + (String(value) === String(v) ? " selected" : "") + ">" + esc(text) + "</option>";
    });
    return out + "</select></div>";
  }

  function adsFilters() {
    const f = state.filters;
    const n = names();
    const funnelKeys = Object.keys(n.funnels);
    const angleKeys = Object.keys(n.angles);
    const adsP = part("ads");
    if (adsP.status === "ok" && Array.isArray(adsP.data.rows)) {
      adsP.data.rows.forEach((r) => {
        if (r.funnel_key && funnelKeys.indexOf(r.funnel_key) < 0) funnelKeys.push(r.funnel_key);
        if (r.angle_key && angleKeys.indexOf(r.angle_key) < 0) angleKeys.push(r.angle_key);
      });
    }
    if (f.funnel && funnelKeys.indexOf(f.funnel) < 0) funnelKeys.push(f.funnel);
    if (f.angle && angleKeys.indexOf(f.angle) < 0) angleKeys.push(f.angle);
    const today = azToday(now());
    let out = '<div class="ccn-filters">';
    out += selectHtml("ccn-win", "win", "Days", WINDOWS.map((w) => [w[0], w[1]]), f.win);
    if (f.win === "pick") {
      out += '<div class="ccn-f"><label for="ccn-from">First day</label><input type="date" id="ccn-from" data-action="filter" data-key="from" data-fid="ccn-from" max="' + today + '" value="' + esc(f.from) + '"></div>';
      out += '<div class="ccn-f"><label for="ccn-to">Last day</label><input type="date" id="ccn-to" data-action="filter" data-key="to" data-fid="ccn-to" max="' + today + '" value="' + esc(f.to) + '"></div>';
    }
    out += selectHtml("ccn-funnel", "funnel", "Funnel",
      [["", "All funnels"]].concat(funnelKeys.map((k) => [k, n.funnels[k] || k])), f.funnel);
    out += selectHtml("ccn-format", "format", "Format", [["", "All formats"]].concat(FORMATS.map((x) => [x[0], x[1]])), f.format);
    out += selectHtml("ccn-angle", "angle", "Angle",
      [["", "All angles"]].concat(angleKeys.map((k) => [k, n.angles[k] || k])), f.angle);
    if (filtersOn(f)) {
      out += '<div class="ccn-f ccn-f-clear"><button type="button" class="ccn-btn ccn-text" data-action="clear" data-fid="clear">Clear filters</button></div>';
    }
    return out + "</div>";
  }

  function adLabels(r, n) {
    const bits = [];
    if (r.angle_key) bits.push(n.angles[r.angle_key] || r.angle_key);
    if (r.funnel_key) bits.push(n.funnels[r.funnel_key] || r.funnel_key);
    if (r.script_format) bits.push(formatWord(r.script_format));
    return bits.length ? bits.join(" · ") : "No script on file for this number";
  }

  function adsTable(rows) {
    const n = names();
    const s = state.sort;
    const head = (key, label, tip, num) => {
      const on = s.key === key;
      const sortWord = on ? (s.dir === "asc" ? "ascending" : "descending") : "none";
      const arrow = on ? (s.dir === "asc" ? " ↑" : " ↓") : "";
      return '<th scope="col" class="' + (num ? "num" : "") + '" aria-sort="' + sortWord + '">' +
        '<button type="button" class="ccn-sort" data-action="sort" data-key="' + key + '" data-fid="sort-' + key + '" title="' + esc(tip) + '">' +
        esc(label) + arrow + "</button></th>";
    };
    let out = '<div class="card ccn-tablebox"><table class="ccn-table"><thead><tr>';
    out += head("ad_number", "Ad", "Our ad number. Tap a row to see its watch curve.", false);
    AD_COLUMNS.forEach((c) => { out += head(c.key, c.label, c.tip, true); });
    out += "</tr></thead><tbody>";
    sortRows(rows, s.key, s.dir).forEach((r) => {
      const num = esc(r.ad_number);
      out += '<tr data-action="open" data-n="' + num + '">';
      out += '<td class="ccn-adcell"><button type="button" class="ccn-adbtn" data-action="open" data-n="' + num + '" data-fid="ad-' + num + '">Ad ' + num + "</button>";
      out += '<span class="ccn-adtitle" title="' + esc(r.title || "") + '">' + esc(r.title || "No title yet") + "</span>";
      out += '<span class="caption ccn-adlabels">' + esc(adLabels(r, n)) + "</span>";
      if (r.maturing) {
        out += '<span class="chip wip ccn-mat" title="Some leads are under 14 days old. Their calls and sales can still come in."><span class="cd"></span>still maturing</span>';
      }
      out += "</td>";
      AD_COLUMNS.forEach((c) => {
        const v = cell(c.kind, r[c.key]);
        out += '<td class="num' + (v === "unknown" ? " unk" : "") + '">' + esc(v) + "</td>";
      });
      out += "</tr>";
    });
    return out + "</tbody></table></div>";
  }

  function unmappedCard(list) {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return "";
    let out = '<div class="card ccn-card ccn-unmapped" data-test="unmapped"><h3 class="eyebrow">Spend with no ad number</h3>' +
      '<p class="caption">These Meta campaigns ran ads that carry no Fundhub ad number, so their spend is in no row above. ' +
      'Link a campaign to a funnel so its spend counts on the Funnels view.</p><ul class="ccn-list">';
    items.forEach((u, i) => {
      out += '<li><span class="ccn-li-main">' + esc(u.name || ("Campaign " + (u.campaign_external_id || ""))) +
        '<span class="caption mono">' + esc(u.campaign_external_id || "") + "</span></span>" +
        '<span class="ccn-li-num">' + esc(money(u.spend_cents)) + "</span>" +
        '<button type="button" class="ccn-btn" data-action="link" data-fid="link-' + i + '">Link to a funnel</button></li>';
    });
    return out + "</ul></div>";
  }

  function adsView() {
    const p = part("ads");
    const w = windowFor(state.filters, now());
    let out = adsFilters();
    const range = dayLabel(w.from) + " to " + dayLabel(w.to);
    if (w.note) out += '<p class="ccn-say wait">' + esc(w.note) + "</p>";
    if (p.status === "loading" || p.status === "idle") return out + '<p class="caption">' + esc(range) + "</p>" + skeletonTable(8);
    if (p.status === "error") return out + errorBox("The ad numbers", p.res, "ads");
    const rows = Array.isArray(p.data.rows) ? p.data.rows : [];
    if (!rows.length) {
      out += '<div class="card ccn-card ccn-empty" data-test="ads-empty"><p>No ad numbers saved for ' + esc(range) + ".</p>";
      out += '<p class="caption">' + (filtersOn(state.filters)
        ? "No ad matches these filters. Clear them to see every ad."
        : "Ads show here once Meta has spend for an ad with a Fundhub number, or a lead comes in tagged with one.") + "</p>";
      if (filtersOn(state.filters)) out += '<button type="button" class="ccn-btn" data-action="clear">Clear filters</button>';
      out += "</div>";
    } else {
      const maturing = rows.filter((r) => r.maturing).length;
      out += '<p class="caption ccn-rangeline">' + esc(range) + " · " + rows.length + (rows.length === 1 ? " ad" : " ads") +
        " · tap an ad to see its watch curve" +
        (maturing ? " · " + maturing + " still maturing (leads under 14 days old)" : "") + "</p>";
      out += adsTable(rows);
    }
    out += unmappedCard(p.data.unmapped);
    return out;
  }

  /* ── the drawer ── */

  function kv(label, value, tip) {
    return '<div class="ccn-kv-i"' + (tip ? ' title="' + esc(tip) + '"' : "") + '><dt class="caption">' + esc(label) +
      '</dt><dd class="' + (value === "unknown" ? "unk" : "") + '">' + esc(value) + "</dd></div>";
  }

  function curveSvg(model) {
    let grid = "";
    [25, 50, 75].forEach((g) => {
      grid += '<line x1="0" x2="100" y1="' + (100 - g) + '" y2="' + (100 - g) + '" class="ccn-grid-line" vector-effect="non-scaling-stroke"></line>';
    });
    return '<svg class="ccn-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      grid +
      '<polygon class="ccn-area" points="' + model.area + '"></polygon>' +
      '<polyline class="ccn-line" points="' + model.line + '" vector-effect="non-scaling-stroke"></polyline>' +
      "</svg>";
  }

  function curveBlock(ad) {
    const choices = curveChoices(ad);
    let out = '<section class="ccn-sec" data-test="curve"><h3 class="eyebrow">Watch curve</h3>';
    if (!choices.length) {
      return out + '<p class="caption">Meta sent no watch curve for this ad in the last 30 days.</p></section>';
    }
    const pick = (state.drawer && state.drawer.pick) || defaultChoice(choices);
    const chosen = choices.find((c) => c.key === pick) || choices[0];
    out += '<div class="ccn-f ccn-dayf"><label for="ccn-day">Day</label><select id="ccn-day" data-action="day" data-fid="ccn-day">';
    choices.forEach((c) => {
      out += '<option value="' + esc(c.key) + '"' + (c.key === chosen.key ? " selected" : "") + ">" +
        esc(c.label) + (c.points ? "" : " (no curve)") + "</option>";
    });
    out += "</select></div>";
    const model = curveModel(chosen.points);
    if (!model) {
      return out + '<p class="caption" data-test="no-curve">Meta sent no curve for ' + esc(dayLabel(chosen.date)) + ".</p></section>";
    }
    out += '<p class="ccn-note">' + esc(twoSecondNote(model)) + "</p>";
    out += '<div class="ccn-chart" role="img" aria-label="' + esc("Share of plays still watching, second by second, on " + dayLabel(chosen.date)) + '">';
    out += '<div class="ccn-yaxis caption" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>';
    out += '<div class="ccn-plot">' + curveSvg(model) + "</div>";
    out += '<div class="ccn-xaxis caption" aria-hidden="true">';
    model.ticks.forEach((t) => {
      out += '<span style="left:' + t.left.toFixed(2) + '%">' + esc(t.label) + "</span>";
    });
    out += "</div></div>";
    out += '<p class="caption">Each point is the share of plays still watching at that second. After 15 seconds each point covers 5 or 10 seconds.</p>';
    out += '<details class="ccn-details"><summary class="caption">See every point</summary><ul class="ccn-pts">';
    model.rows.forEach((r) => {
      out += "<li><span>" + esc(r.bucket) + '</span><span class="num">' + (r.value === null ? "unknown" : esc(Math.round(r.value) + "%")) + "</span></li>";
    });
    return out + "</ul></details></section>";
  }

  function watchBlock(ad) {
    const watch = (ad && ad.watch) || {};
    const alerts = Array.isArray(watch.alerts) ? watch.alerts : [];
    const diags = Array.isArray(watch.diagnoses) ? watch.diagnoses : [];
    let out = '<section class="ccn-sec" data-test="diagnosis"><h3 class="eyebrow">What to film next</h3>';
    const alertLine = alerts.map(alertWords).filter(Boolean)[0];
    if (alertLine) out += '<p class="ccn-say wait">' + esc(alertLine) + "</p>";
    if (!diags.length) {
      return out + '<p class="caption">No watch-curve note yet. A note is written after each Meta pull once the ad has enough plays.</p></section>';
    }
    const first = diagnosisWords(diags[0]);
    out += '<div class="ccn-diag"><p><b>' + esc(first.what) + "</b> " + esc(first.fix) + "</p>";
    if (first.note) out += "<p>" + esc(first.note) + "</p>";
    out += '<p class="caption">' + esc(first.day + " · " + first.next) + "</p></div>";
    if (diags.length > 1) {
      out += '<details class="ccn-details"><summary class="caption">Older notes (' + (diags.length - 1) + ")</summary>";
      diags.slice(1).forEach((d) => {
        const w = diagnosisWords(d);
        out += '<div class="ccn-diag old"><p><b>' + esc(w.what) + "</b> " + esc(w.fix) + "</p>" +
          (w.note ? "<p>" + esc(w.note) + "</p>" : "") + '<p class="caption">' + esc(w.day + " · " + w.next) + "</p></div>";
      });
      out += "</details>";
    }
    return out + "</section>";
  }

  function drawerHtml() {
    const d = state.drawer;
    if (!d) return "";
    let body = "";
    let title = "Ad " + d.n;
    let sub = "";
    if (d.status === "loading") {
      body = '<span class="ccn-skel short"></span><span class="ccn-skel"></span><span class="ccn-skel tall"></span><span class="ccn-skel"></span>';
    } else if (d.status === "error") {
      body = '<div class="ccn-say err" role="alert"><span>' + esc(errorSentence("This ad's numbers", d.res)) + "</span>" +
        '<button type="button" class="ccn-btn" data-action="retry-drawer">Try again</button></div>';
    } else {
      const ad = d.data.ad;
      const n = names();
      if (ad.title) title += " · " + ad.title;
      sub = adLabels(ad, n);
      body += '<p class="caption">' + esc("Last 30 days. " + asOfLine(d.data.as_of, fmtAz)) + "</p>";
      if (ad.maturing) {
        const ml = known(ad.maturing_leads);
        body += '<p class="ccn-say wait"><span class="chip wip"><span class="cd"></span>still maturing</span> ' +
          esc((ml ? ml + (ml === 1 ? " lead is" : " leads are") : "Some leads are") +
            " under 14 days old. Their calls and sales can still come in.") + "</p>";
      }
      body += '<dl class="ccn-kv">';
      AD_COLUMNS.forEach((c) => { body += kv(c.label, cell(c.kind, ad[c.key]), c.tip); });
      body += "</dl>";
      body += curveBlock(ad);
      body += watchBlock(ad);
      const metaAds = Array.isArray(ad.meta_ads) ? ad.meta_ads : [];
      body += '<section class="ccn-sec"><h3 class="eyebrow">Meta ads with this number</h3>';
      if (!metaAds.length) {
        body += '<p class="caption">No Meta ad carries this number yet.</p>';
      } else {
        body += '<ul class="ccn-list">';
        metaAds.forEach((m, i) => {
          body += '<li><span class="ccn-li-main">' + esc((metaAds.length > 1 ? "Meta ad " + (i + 1) + ": " : "") + (m.name || "No name")) +
            '<span class="caption mono">' + esc(m.external_id || "") + "</span></span>" +
            '<span class="chip' + (String(m.status).toUpperCase() === "ACTIVE" ? " on" : "") + '"><span class="cd"></span>' + esc(statusWord(m.status)) + "</span></li>";
        });
        body += "</ul>";
      }
      body += "</section>";
    }
    return '<div class="ccn-scrim" data-action="close-drawer"></div>' +
      '<aside class="ccn-drawer" role="dialog" aria-modal="true" aria-labelledby="ccn-drawer-title" data-test="drawer">' +
      '<div class="ccn-drawer-hd"><div class="ccn-drawer-t"><h2 id="ccn-drawer-title">' + esc(title) + "</h2>" +
      (sub ? '<p class="caption">' + esc(sub) + "</p>" : "") + "</div>" +
      '<button type="button" class="ccn-btn" data-action="close-drawer" data-fid="drawer-close">Close</button></div>' +
      '<div class="ccn-drawer-body">' + body + "</div></aside>";
  }

  /* ── Angles view ── */

  function sheetHtml(row) {
    const s = state.sheet;
    const id = "ccn-idea-" + String(row.angle_key || "x").replace(/[^a-z0-9_-]/gi, "_");
    let out = '<form class="ccn-sheet" data-action="save-idea" data-angle="' + esc(row.angle_key) + '">' +
      '<label for="' + id + '">What should the new ads say? Change the words if you like.</label>' +
      '<textarea id="' + id + '" rows="3" data-action="idea-text" data-fid="idea-text">' + esc(s.text) + "</textarea>" +
      '<p class="caption">Saving is free. It goes to your ideas, and the next batch of scripts starts with your ideas.</p>';
    if (s.error) out += '<p class="ccn-say err" role="alert">' + esc(s.error) + "</p>";
    out += '<div class="ccn-actions"><button type="button" class="ccn-btn ccn-text" data-action="cancel-idea">Cancel</button>' +
      '<button type="submit" class="ccn-btn primary' + (s.busy ? " busy" : "") + '"' + (s.busy ? " disabled" : "") +
      ' data-fid="save-idea"><span class="ccn-spin" aria-hidden="true"></span>' + (s.busy ? "Saving…" : "Save idea") + "</button></div></form>";
    return out;
  }

  function anglesView() {
    const p = part("angles");
    let out = '<p class="caption ccn-rangeline">Last 30 days, every angle that had spend or leads.</p>';
    if (p.status === "loading" || p.status === "idle") return out + skeletonCards(3);
    if (p.status === "error") return out + errorBox("The angle numbers", p.res, "angles");
    const rows = bySpend(Array.isArray(p.data.rows) ? p.data.rows : []);
    if (!rows.length) {
      return out + '<div class="card ccn-card ccn-empty" data-test="angles-empty"><p>No angle had spend or leads in the last 30 days.</p>' +
        '<p class="caption">An ad gets its angle from its script. Angles show here once a numbered ad with a script spends.</p></div>';
    }
    out += '<div class="ccn-grid">';
    rows.forEach((r) => {
      const key = String(r.angle_key || "");
      const open = state.sheet && state.sheet.angle_key === key;
      out += '<article class="card ccn-card ccn-span" data-test="angle" data-angle="' + esc(key) + '">';
      out += '<div class="ccn-card-hd"><b>' + esc(angleName(r)) + "</b>" +
        (r.name && r.angle_key ? '<span class="caption mono">' + esc(r.angle_key) + "</span>" : "") + "</div>";
      out += '<dl class="ccn-kv">' +
        kv("Spend", money(r.spend_cents)) +
        kv("Ads", count(r.ads), "Ad numbers on this angle that spent or got leads.") +
        kv("Leads", count(r.leads)) +
        kv("Cost per lead", money(centsPer(r.spend_cents, r.leads)), "Spend ÷ leads.") +
        kv("Booked calls", count(r.booked)) +
        kv("Sales", count(r.sales)) +
        kv("Cash", money(r.cash_cents)) +
        kv("ROAS", roas(r.roas), "Cash back for each $1 of ad spend.") +
        "</dl>";
      if (state.saved[key]) out += '<p class="ccn-say ok" role="status">' + esc(state.saved[key]) + "</p>";
      if (open) {
        out += sheetHtml(r);
      } else {
        out += '<div class="ccn-actions"><button type="button" class="ccn-btn" data-action="more" data-angle="' + esc(key) +
          '" data-fid="more-' + esc(key) + '">Make more of this</button></div>';
      }
      out += "</article>";
    });
    return out + "</div>";
  }

  /* ── Funnels view ── */

  function funnelCard(r) {
    let out = '<article class="card ccn-card ccn-spanall" data-test="funnel" data-funnel="' + esc(r.funnel_key) + '">';
    out += '<div class="ccn-card-hd"><b>' + esc(r.name || r.funnel_key) + "</b>" +
      '<span class="caption">' + esc("Spend " + money(r.spend_cents) + " · Cash " + money(r.cash_cents) + " · ROAS " + roas(r.roas)) + "</span></div>";
    out += '<ol class="ccn-flow">';
    funnelSteps(r).forEach((s) => {
      out += '<li class="ccn-step" data-step="' + s.key + '">';
      if (s.rateLabel) {
        out += '<span class="ccn-rate caption" title="' + esc(s.rateTip) + '">' +
          esc(s.rateLabel) + ': <b class="' + (s.rate === null ? "unk" : "") + '">' + esc(pct(s.rate)) + "</b></span>";
      } else {
        out += '<span class="ccn-rate none caption" aria-hidden="true">&nbsp;</span>';
      }
      out += '<span class="big ccn-stepn' + (s.value === "unknown" ? " unk" : "") + '">' + esc(s.value) + "</span>" +
        '<span class="caption ccn-steplabel">' + esc(s.label) + "</span></li>";
    });
    return out + "</ol></article>";
  }

  function funnelsView() {
    const p = part("funnels");
    let out = '<p class="caption ccn-rangeline">Last 30 days: ad → page → lead → call → sale.</p>';
    if (p.status === "loading" || p.status === "idle") return out + skeletonCards(2);
    if (p.status === "error") return out + errorBox("The funnel numbers", p.res, "funnels");
    const rows = Array.isArray(p.data.rows) ? p.data.rows : [];
    if (!rows.length) {
      out += '<div class="card ccn-card ccn-empty" data-test="funnels-empty"><p>No funnel is set up yet.</p>' +
        '<p class="caption">Add a funnel in Settings, then its numbers show here.</p>' +
        '<button type="button" class="ccn-btn" data-action="link">Open Settings</button></div>';
    } else {
      out += '<div class="ccn-grid">';
      rows.forEach((r) => { out += funnelCard(r); });
      out += "</div>";
    }
    const um = p.data.unmapped_spend_cents;
    const umKnown = known(um);
    if (umKnown === null || umKnown > 0) {
      out += '<div class="card ccn-card ccn-unmapped" data-test="funnel-unmapped"><h3 class="eyebrow">Spend not tied to a funnel</h3>' +
        '<div class="ccn-li"><span class="ccn-li-main"><span class="big' + (umKnown === null ? " unk" : "") + '">' + esc(money(um)) + "</span>" +
        '<span class="caption">Spend from campaigns that no funnel claims. Link each campaign to its funnel in Settings.</span></span>' +
        '<button type="button" class="ccn-btn" data-action="link" data-fid="link-funnels">Link to a funnel</button></div></div>';
    }
    return out;
  }

  /* ── paint ── */

  function paint() {
    const root = state.root;
    if (!root) return;
    const active = root.ownerDocument && root.ownerDocument.activeElement;
    const fid = active && root.contains(active) && active.getAttribute ? active.getAttribute("data-fid") : null;
    let body = "";
    if (state.view === "ads") body = adsView();
    else if (state.view === "angles") body = anglesView();
    else body = funnelsView();
    root.innerHTML = '<section class="ccn" aria-label="Numbers">' + topBar() +
      '<div class="ccn-body" data-view="' + state.view + '">' + body + "</div>" + drawerHtml() + "</section>";
    const doc = root.ownerDocument;
    if (doc && doc.documentElement) doc.documentElement.classList.toggle("ccn-lock", Boolean(state.drawer));
    if (fid) {
      const again = root.querySelector('[data-fid="' + fid + '"]');
      if (again && typeof again.focus === "function") {
        try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); }
      }
    }
  }

  /* ── events ── */

  function setView(view) {
    if (!VIEWS.some((v) => v[0] === view)) return;
    state.view = view;
    state.sheet = null;
    if (view !== "ads") state.drawer = null;
    remember(view);
    setHash();
    paint();
    loadView(false);
  }

  function onClick(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
    if (!t || !state.root.contains(t)) return;
    const action = t.getAttribute("data-action");
    if (action === "view") return setView(t.getAttribute("data-view"));
    if (action === "sort") {
      state.sort = nextSort(state.sort, t.getAttribute("data-key"));
      return paint();
    }
    if (action === "open") {
      ev.preventDefault();
      return openDrawer(t.getAttribute("data-n"));
    }
    if (action === "close-drawer") return closeDrawer();
    if (action === "retry-drawer") return state.drawer && openDrawer(state.drawer.n, true);
    if (action === "retry") {
      const name = t.getAttribute("data-part");
      if (name === "ads") return load("ads", adsPath(state.filters, now()), true);
      if (name === "angles") return load("angles", "marketing/angles", true);
      if (name === "funnels") return load("funnels", "marketing/funnels/stats", true);
      return undefined;
    }
    if (action === "clear") {
      state.filters = { win: "30", from: "", to: "", funnel: "", format: "", angle: "" };
      paint();
      return load("ads", adsPath(state.filters, now()), false);
    }
    if (action === "link") {
      if (state.ctx && typeof state.ctx.go === "function") state.ctx.go("settings", "funnels");
      return undefined;
    }
    if (action === "more") {
      const key = t.getAttribute("data-angle");
      const rows = (part("angles").data || {}).rows || [];
      const row = rows.find((r) => String(r.angle_key || "") === key) || { angle_key: key };
      delete state.saved[key];
      state.sheet = { angle_key: key, text: ideaText(row), request_id: uuid(), busy: false, error: null };
      paint();
      return focusSoon("[data-fid='idea-text']");
    }
    if (action === "cancel-idea") {
      const key = state.sheet && state.sheet.angle_key;
      state.sheet = null;
      paint();
      return key ? focusSoon("[data-fid='more-" + key + "']") : undefined;
    }
    return undefined;
  }

  function onChange(ev) {
    const t = ev.target;
    if (t && t.getAttribute("data-action") === "day") {
      if (state.drawer) state.drawer.pick = t.value;
      return paint();
    }
    if (!t || t.getAttribute("data-action") !== "filter") return undefined;
    const key = t.getAttribute("data-key");
    state.filters = Object.assign({}, state.filters, { [key]: t.value });
    if (key === "win" && t.value === "pick" && !state.filters.from) {
      const w = windowFor({ win: "30" }, now());
      state.filters.from = w.from;
      state.filters.to = w.to;
    }
    paint();
    return load("ads", adsPath(state.filters, now()), false);
  }

  function onInput(ev) {
    const t = ev.target;
    if (t && t.getAttribute("data-action") === "idea-text" && state.sheet) state.sheet.text = t.value;
  }

  async function onSubmit(ev) {
    const form = ev.target;
    if (!form || form.getAttribute("data-action") !== "save-idea") return;
    ev.preventDefault();
    const s = state.sheet;
    if (!s || s.busy) return;
    const text = String(s.text || "").trim();
    if (!text) {
      s.error = "Write a few words first, then save.";
      return paint();
    }
    const rows = (part("angles").data || {}).rows || [];
    const row = rows.find((r) => String(r.angle_key || "") === s.angle_key) || { angle_key: s.angle_key };
    s.busy = true;
    s.error = null;
    paint();
    const res = await call("POST", "marketing/ideas", ideaBody(row, text, s.request_id), { requestId: s.request_id });
    if (state.sheet !== s) return;
    s.busy = false;
    if (res.ok) {
      state.sheet = null;
      state.saved[s.angle_key] = "Saved to your ideas. The next batch of scripts starts with your ideas.";
      paint();
      if (state.ctx && typeof state.ctx.toast === "function") state.ctx.toast("Idea saved for " + angleName(row) + ".");
      return focusSoon("[data-fid='more-" + s.angle_key + "']");
    }
    s.error = saveErrorSentence(res);
    return paint();
  }

  function onKey(ev) {
    if (ev.key === "Escape" && state.drawer) {
      ev.preventDefault();
      return closeDrawer();
    }
    return undefined;
  }

  function wire(root) {
    if (state.wired === root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("keydown", onKey);
    state.wired = root;
  }

  /* The view (and drawer) the URL asks for: "#numbers/ads/91" -> ads + 91. */
  function parseParam(param) {
    const bits = String(param || "").split("/").filter(Boolean);
    const view = VIEWS.some((v) => v[0] === bits[0]) ? bits[0] : null;
    const n = view === "ads" && /^[0-9]{1,9}$/.test(bits[1] || "") ? bits[1] : null;
    return { view, n };
  }

  function paramFrom(ctx) {
    if (ctx && typeof ctx.param === "string" && ctx.param) return ctx.param;
    try {
      const h = String((W.location && W.location.hash) || "");
      if (h.indexOf("#numbers/") === 0) return h.slice("#numbers/".length);
    } catch (e) { /* no URL */ }
    return "";
  }

  function ensureStyles() {
    try {
      const doc = W.document;
      if (!doc || doc.getElementById("ccn-styles")) return;
      const link = doc.createElement("link");
      link.id = "ccn-styles";
      link.rel = "stylesheet";
      link.href = STYLE_HREF;
      doc.head.appendChild(link);
    } catch (e) { /* the tab still works unstyled */ }
  }

  /* The stylesheet sits beside this file. Worked out from this script's own
     address so the page and the tab can live at any path. */
  const STYLE_HREF = (function () {
    try {
      const cs = W.document && W.document.currentScript;
      if (cs && cs.src) return cs.src.replace(/cc-tab-numbers\.js(\?.*)?$/, "cc-tab-numbers.css");
    } catch (e) { /* not in a browser */ }
    return "cc-tab-numbers.css";
  })();

  function render(root, ctx) {
    state.root = root;
    state.ctx = ctx || {};
    ensureStyles();
    wire(root);
    const p = parseParam(paramFrom(ctx));
    const back = recalled();
    state.view = p.view || (VIEWS.some((v) => v[0] === back) ? back : state.view);
    paint();
    loadView(false);
    if (p.n && (!state.drawer || state.drawer.n !== p.n)) openDrawer(p.n);
  }

  function refresh(ctx) {
    if (ctx) state.ctx = ctx;
    if (!state.root) return;
    loadView(true);
    if (state.drawer && state.drawer.status === "ok") openDrawer(state.drawer.n, true);
  }

  function hide() {
    state.sheet = null;
    if (state.drawer) {
      state.drawer = null;
      try {
        const doc = state.root && state.root.ownerDocument;
        if (doc && doc.documentElement) doc.documentElement.classList.remove("ccn-lock");
      } catch (e) { /* nothing */ }
    }
  }

  /* ── what the tests read ─────────────────────────────────────────────── */

  W.FundhubCCNumbers = Object.freeze({
    VIEWS, FORMATS, WINDOWS, CURVE_BUCKETS, AD_COLUMNS,
    known, rate, centsPer, money, count, pct, roas, cell,
    azToday, addDays, dayLabel, windowFor, adsPath, filtersOn,
    sortRows, nextSort,
    curveList, curveChoices, defaultChoice, curveModel, twoSecondNote,
    diagnosisWords, alertWords, statusWord,
    funnelSteps, angleName, ideaText, ideaBody, bySpend,
    errorSentence, saveErrorSentence, asOfLine, parseParam, esc
  });

  /* ── plug into the frame (docs/specs/command-center-tabs.md) ─────────── */

  (W.FundhubCC = W.FundhubCC || { _q: [], registerTab(t) { this._q.push(t); } })
    .registerTab({ id: "numbers", label: "Numbers", order: 7, render, refresh, hide });
})(typeof window !== "undefined" ? window : globalThis);
