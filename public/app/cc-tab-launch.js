/* ══ COMMAND CENTER — the Launch tab ═════════════════════════════════════════
   Puts approved ads into Meta, PAUSED, and turns on the one Chris picks, one ad
   at a time, with the daily budget in front of him first.

   Design: docs/specs/command-center-design-2026-10-05.md §3.6 and §5 (safety
   rules 1, 2, 4, 5). Plug-in contract: docs/specs/command-center-tabs.md.
   Spec: docs/specs/marketing-machine-2026-10-04.md §10.5 and §2 item 6 ("Only
   Chris turns ads on, pauses them or changes budgets"). Build plan unit U39.
   UI law: docs/rules/UI-STANDARDS.md.

   WHAT IT READS
     GET marketing/meta/load-status          every ad that was asked to load or
                                              already holds a Meta id (U28)
     GET ad-videos?status=approved,delivered every approved video, so an ad that
                                              was never asked to load still shows

   WHAT IT SENDS — and nothing else
     POST marketing/meta/load {ad_video_id, request_id}   Load to Meta / Retry load
     POST marketing/meta/load {all: true, request_id}      Load all approved
     POST campaigns/write {action: "resume_ad", ad_id: <our ads.id>, request_id}
                                                           Turn on, ONE ad (U15)
   Turn on never names a campaign, an ad set or a Meta id. The campaign-level
   actions on campaigns/write belong to the Campaigns page and are never sent
   from here (src/ui/cc-tab-launch.test.mjs reads this file to hold that).

   SAFETY
     - Loads are PAUSED. Every load button says so and costs $0.
     - Turn on shows only on a loaded ad, asks twice through ctx.confirm, and its
       question names the ad, the ad set, the daily budget and any pause above it.
     - Turn on is disabled, with the reason printed, while the budget is unknown.
     - NULL prints "unknown", never $0.

   The pure rules (words, counts, request bodies) sit on window.FundhubCCLaunch
   so node:vm tests run them with no browser.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var TAB_ID = "launch";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ONLY_CHRIS = "Only Chris can turn ads on.";
  var NO_BUDGET = "Turn on is off: we cannot see this ad set's daily budget yet.";
  var POLL_MS = 20000;
  var APPROVED_LIMIT = 200;

  /* The loader's step words (src/marketing/meta-load.mjs stepOf) in plain words. */
  var STEPS = {
    "uploading video": { n: 1, words: "uploading the video to Meta" },
    "waiting for Meta": { n: 2, words: "waiting for Meta to take the video" },
    "creating the ad": { n: 3, words: "making the ad" },
    "saving": { n: 4, words: "saving the ad" }
  };

  /* ── small pure helpers ─────────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isUuid(v) { return typeof v === "string" && UUID_RE.test(v.trim()); }

  /* Integer cents -> "$100" or "$100.50". Anything that is not a whole number of
     cents is unknown, never $0. */
  function moneyWord(cents) {
    if (cents === null || cents === undefined || cents === "") return "unknown";
    var n = Number(cents);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return "unknown";
    var neg = n < 0;
    var abs = Math.abs(n);
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var rest = abs % 100;
    return (neg ? "-$" : "$") + dollars + (rest ? "." + (rest < 10 ? "0" : "") + rest : "");
  }

  /* The ad set's daily budget in cents, or null when we cannot see it.
     load-status sends ad_set.daily_budget_cents once the sync keeps it (design
     §3.6). A 0 is read as unknown on purpose: Meta has no $0 daily ad set
     budget, and the sync writes 0 when an ad set has no budget of its own. */
  function budgetOf(load) {
    var set = load && load.ad_set;
    if (!set || typeof set !== "object") return null;
    var b = set.daily_budget_cents;
    if (b === null || b === undefined || b === "") return null;
    var n = Number(b);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /* Meta's status on our row -> "on" | "paused" | "archived" | "other" | null. */
  function statusKind(status) {
    if (status === null || status === undefined || status === "") return null;
    var s = String(status).toUpperCase();
    if (s === "ACTIVE") return "on";
    if (s === "PAUSED" || s === "CAMPAIGN_PAUSED" || s === "ADSET_PAUSED") return "paused";
    if (s === "ARCHIVED" || s === "DELETED") return "archived";
    return "other";
  }

  /* "roadmap_147" -> "Roadmap 147 funnel". */
  function funnelWord(key) {
    if (!key) return null;
    var words = String(key).replace(/[_-]+/g, " ").trim();
    if (!words) return null;
    return words.charAt(0).toUpperCase() + words.slice(1) + " funnel";
  }

  function adNumberSort(a, b) {
    var na = /^\d{1,9}$/.test(a.ad_number || "") ? Number(a.ad_number) : Infinity;
    var nb = /^\d{1,9}$/.test(b.ad_number || "") ? Number(b.ad_number) : Infinity;
    if (na !== nb) return na < nb ? -1 : 1;
    return (a.take_no || 0) - (b.take_no || 0);
  }

  function newRequestId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "ccl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function azTime(ts, ctx) {
    if (ts === null || ts === undefined || ts === "") return null;
    if (ctx && ctx.fmt && typeof ctx.fmt.az === "function") {
      try { var s = ctx.fmt.az(ts); if (s) return String(s); } catch (e) { /* use our own */ }
    }
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      }).format(d) + " Arizona time";
    } catch (e) { return d.toISOString(); }
  }

  /* ── one row per ad ─────────────────────────────────────────────────────── */

  function cleanReasons(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (r) { return String(r == null ? "" : r).trim(); }).filter(Boolean);
  }

  function rowFromLoad(load) {
    var set = load.ad_set && typeof load.ad_set === "object" ? load.ad_set : null;
    var camp = load.campaign && typeof load.campaign === "object" ? load.campaign : null;
    var n = load.ad_number == null || load.ad_number === "" ? null : String(load.ad_number);
    return {
      key: String(load.ad_video_id || ""),
      from: "load",
      ad_video_id: load.ad_video_id ? String(load.ad_video_id) : null,
      ad_number: n,
      take_no: null,
      label: n ? "Ad " + n : "This ad",
      angle: load.angle || null,
      funnel_key: load.funnel_key || null,
      state: ["waiting", "loading", "loaded", "refused", "failed"].indexOf(load.state) >= 0 ? load.state : "waiting",
      step: load.step || null,
      reasons: cleanReasons(load.reasons),
      ad_row_id: load.ad_row_id ? String(load.ad_row_id) : null,
      ad_status: load.ad_status || null,
      ad_set: set ? { external_id: set.external_id || null, name: set.name || null, status: set.status || null } : null,
      campaign: camp ? { external_id: camp.external_id || null, status: camp.status || null } : null,
      budget_cents: budgetOf(load),
      ids: {
        video: load.meta_video_id || null,
        creative: load.meta_creative_id || null,
        ad: load.meta_ad_external_id || null
      },
      loaded_at: load.loaded_at || null
    };
  }

  function rowFromApproved(v) {
    var n = v.ad_id == null || v.ad_id === "" ? null : String(v.ad_id);
    return {
      key: String(v.id || ""),
      from: "approved",
      ad_video_id: v.id ? String(v.id) : null,
      ad_number: n,
      take_no: Number.isInteger(Number(v.take_no)) ? Number(v.take_no) : null,
      label: n ? "Ad " + n : "This ad",
      angle: null,
      funnel_key: null,
      state: "not_loaded",
      step: null,
      reasons: [],
      ad_row_id: null,
      ad_status: null,
      ad_set: null,
      campaign: null,
      budget_cents: null,
      ids: { video: null, creative: null, ad: null },
      loaded_at: null
    };
  }

  /* Adds the words and the buttons a row shows. Pure. */
  function decorate(row) {
    var on = row.state === "loaded" && statusKind(row.ad_status) === "on";
    var word, chip;
    switch (row.state) {
      case "not_loaded": word = "Not loaded yet"; chip = ""; break;
      case "waiting": word = "Waiting to load"; chip = "wip"; break;
      case "loading": word = "Loading"; chip = "wip"; break;
      case "loaded": word = on ? "On" : "Loaded, paused"; chip = on ? "on" : ""; break;
      case "refused": word = "Stopped"; chip = "bad"; break;
      default: word = "Load failed"; chip = "bad";
    }

    var stepLine = null;
    if (row.state === "loading" && row.step && STEPS[row.step]) {
      stepLine = "Step " + STEPS[row.step].n + " of 4: " + STEPS[row.step].words + ".";
    } else if (row.state === "loading") {
      stepLine = "Loading into Meta.";
    } else if (row.state === "waiting") {
      stepLine = "In line to load. It starts by itself in a few minutes.";
    }

    var flags = [];
    var noAdSet = false;
    if (row.from === "load" && row.state !== "loaded" && !row.ad_set) {
      noAdSet = true;
      flags.push("This ad's funnel has no ad set picked yet. Pick one in Settings.");
    }
    var setKind = row.ad_set ? statusKind(row.ad_set.status) : null;
    var campKind = row.campaign ? statusKind(row.campaign.status) : null;
    if (setKind === "paused") flags.push("Ad set is paused: nothing in it spends until the ad set is on.");
    if (setKind === "archived") flags.push("Ad set is archived: Meta will not run ads in it.");
    if (campKind === "paused") flags.push("Campaign is paused: nothing in it spends until the campaign is on.");
    if (campKind === "archived") flags.push("Campaign is archived: Meta will not run ads in it.");

    var adSetLine = null;
    if (row.from === "approved") adSetLine = "Ad set: picked from its funnel when it loads.";
    else if (!row.ad_set) adSetLine = noAdSet ? null : "Ad set: unknown.";
    else {
      adSetLine = "Ad set: " + (row.ad_set.name || ("Meta id " + (row.ad_set.external_id || "unknown"))) +
        " · " + (row.budget_cents == null ? "daily budget unknown" : "up to " + moneyWord(row.budget_cents) + " a day");
    }

    var load = null;
    if (row.state === "not_loaded") load = "Load to Meta";
    else if (row.state === "refused" || row.state === "failed") load = "Retry load";

    var turnOn = { show: false, enabled: false, reason: null };
    if (row.state === "loaded" && !on && isUuid(row.ad_row_id || "")) {
      turnOn.show = true;
      turnOn.enabled = row.budget_cents != null;
      turnOn.reason = turnOn.enabled ? null : NO_BUDGET;
    }

    var idParts = [];
    if (row.ids.video) idParts.push("video " + row.ids.video);
    if (row.ids.creative) idParts.push("creative " + row.ids.creative);
    if (row.ids.ad) idParts.push("ad " + row.ids.ad);

    row.on = on;
    row.state_word = word;
    row.chip = chip;
    row.step_line = stepLine;
    row.flags = flags;
    row.no_ad_set = noAdSet;
    row.ad_set_line = adSetLine;
    row.load_label = load;
    row.turn_on = turnOn;
    row.ids_line = idParts.length ? "Meta ids: " + idParts.join(" · ") : null;
    row.about = [row.angle, funnelWord(row.funnel_key), row.take_no ? "Take " + row.take_no : null]
      .filter(Boolean).join(" · ") || null;
    return row;
  }

  /**
   * buildView({loads, approved, asOf, loadsError, approvedError, approvedMore})
   * -> {rows, counts, ...}. The rows the tab shows: every row of load-status,
   * then every approved video load-status does not list yet. Pure.
   */
  function buildView(input) {
    var inp = input || {};
    var seen = {};
    var rows = [];
    (Array.isArray(inp.loads) ? inp.loads : []).forEach(function (l) {
      if (!l || !l.ad_video_id) return;
      var r = rowFromLoad(l);
      if (seen[r.key]) return;
      seen[r.key] = true;
      rows.push(r);
    });
    (Array.isArray(inp.approved) ? inp.approved : []).forEach(function (v) {
      if (!v || !v.id) return;
      if (v.video_kind && v.video_kind !== "ad") return;
      if (seen[String(v.id)]) return;
      seen[String(v.id)] = true;
      rows.push(rowFromApproved(v));
    });
    rows.sort(adNumberSort);
    rows.forEach(decorate);

    var loaded = rows.filter(function (r) { return r.state === "loaded"; }).length;
    var on = rows.filter(function (r) { return r.on; }).length;
    var toLoad = rows.filter(function (r) { return r.state === "not_loaded" || r.state === "refused" || r.state === "failed"; }).length;
    var inFlight = rows.filter(function (r) { return r.state === "waiting" || r.state === "loading"; }).length;

    var loadAllReason = null;
    if (!rows.length) loadAllReason = "Nothing to load yet. Approve a video on Videos first.";
    else if (!toLoad) loadAllReason = inFlight ? "Every approved ad is loaded or loading." : "Every approved ad is loaded.";

    return {
      rows: rows,
      counts: { approved: rows.length, loaded: loaded, on: on, to_load: toLoad, in_flight: inFlight },
      headline: rows.length + " approved, " + loaded + " loaded",
      on_line: "Loaded ads on now: " + on,
      load_all: { enabled: toLoad > 0, reason: loadAllReason, count: toLoad },
      as_of: inp.asOf || null,
      loads_error: inp.loadsError || null,
      approved_error: inp.approvedError || null,
      approved_more: !!inp.approvedMore,
      empty: !rows.length && !inp.loadsError && !inp.approvedError
    };
  }

  /* ── what gets sent ─────────────────────────────────────────────────────── */

  function loadBody(row, requestId) {
    if (!row || !isUuid(row.ad_video_id || "")) return null;
    return { ad_video_id: String(row.ad_video_id).toLowerCase(), request_id: String(requestId) };
  }

  function loadAllBody(requestId) {
    return { all: true, request_id: String(requestId) };
  }

  /* The ON switch's body. Our ads.id only, never a Meta id; null when the row
     has none, so nothing is sent. */
  function turnOnBody(row, requestId) {
    if (!row || !isUuid(row.ad_row_id || "")) return null;
    return { action: "resume_ad", ad_id: String(row.ad_row_id).trim().toLowerCase(), request_id: String(requestId) };
  }

  function turnOnSheet(row) {
    var setName = row.ad_set && row.ad_set.name ? row.ad_set.name : "its ad set";
    var parts = ["It can spend up to " + moneyWord(row.budget_cents) + " a day in " + setName + "."];
    var setKind = row.ad_set ? statusKind(row.ad_set.status) : null;
    var campKind = row.campaign ? statusKind(row.campaign.status) : null;
    if (setKind === "paused") parts.push("The ad set is paused, so it will not spend until the ad set is on.");
    if (campKind === "paused") parts.push("The campaign is paused, so it will not spend until the campaign is on.");
    parts.push("Only this one ad turns on.");
    return {
      title: "Turn on " + row.label + "?",
      consequence: parts.join(" "),
      button: "Yes, turn on " + row.label
    };
  }

  function loadAllSheet(view) {
    var n = view.load_all.count;
    var ads = n === 1 ? "1 ad loads" : n + " ads load";
    return {
      title: "Load " + (n === 1 ? "1 ad" : n + " ads") + " into Meta?",
      consequence: ads + " PAUSED into their funnel's ad set. Nothing spends until you turn one on. Costs $0.",
      button: "Load them"
    };
  }

  function messageOf(res) {
    var d = res && res.data;
    var m = d && typeof d.message === "string" ? d.message.trim() : "";
    return m || null;
  }

  function turnOnAnswer(res, row) {
    var label = row && row.label ? row.label : "The ad";
    if (res && res.ok && res.data && res.data.ok !== false) return { ok: true, text: label + " is on." };
    var status = res ? Number(res.status) || 0 : 0;
    if (status === 403) return { ok: false, text: ONLY_CHRIS };
    if (!status) return { ok: false, text: "No answer from the server. The ad is still paused. Try again." };
    if (status >= 500 && status !== 502) return { ok: false, text: "Turn on did not work. The ad is still paused. Try again." };
    return { ok: false, text: messageOf(res) || "Turn on did not work. The ad is still paused. Try again." };
  }

  function loadAnswer(res, many) {
    if (res && res.ok) {
      var jobs = res.data && Array.isArray(res.data.jobs) ? res.data.jobs.length : 0;
      if (!many) return { ok: true, text: "Queued. It loads paused. This row updates by itself." };
      if (!jobs) return { ok: true, text: "Nothing new to load. Every approved ad is loaded or loading." };
      return { ok: true, text: (jobs === 1 ? "1 ad" : jobs + " ads") + " queued. They load paused." };
    }
    var status = res ? Number(res.status) || 0 : 0;
    if (status === 403) return { ok: false, text: "Only an owner or admin can load ads." };
    if (!status) return { ok: false, text: "No answer from the server. Nothing was loaded. Try again." };
    if (status >= 500 && status !== 503) return { ok: false, text: "The load did not start. Try again." };
    return { ok: false, text: messageOf(res) || "The load did not start. Try again." };
  }

  /* ── the calls (ctx in, plain words out) ────────────────────────────────── */

  async function callApi(ctx, method, path, body, opts) {
    if (!ctx || typeof ctx.api !== "function") return { ok: false, status: 0, data: null };
    try {
      var r = await ctx.api(method, path, body, opts || {});
      return r || { ok: false, status: 0, data: null };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  }

  /* ctx.confirm, the frame's two-tap sheet. Takes onConfirm / onCancel, or a
     promise / boolean answer; a yes is only ever an explicit yes. */
  function askConfirm(ctx, sheet) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v === true); } }
      if (!ctx || typeof ctx.confirm !== "function") { finish(false); return; }
      var out;
      try {
        out = ctx.confirm({
          title: sheet.title, consequence: sheet.consequence, button: sheet.button,
          onConfirm: function () { finish(true); },
          onCancel: function () { finish(false); }
        });
      } catch (e) { finish(false); return; }
      if (out && typeof out.then === "function") {
        out.then(function (v) { if (v === true || v === false) finish(v); }, function () { finish(false); });
      } else if (out === true || out === false) {
        finish(out);
      }
    });
  }

  async function turnOn(row, ctx, deps) {
    var d = deps || {};
    if (!row || !row.turn_on || !row.turn_on.show) {
      return { ok: false, sent: false, text: "Only a loaded, paused ad can be turned on here." };
    }
    if (!row.turn_on.enabled) return { ok: false, sent: false, text: row.turn_on.reason || NO_BUDGET };
    var body = turnOnBody(row, (d.newId || newRequestId)());
    if (!body) return { ok: false, sent: false, text: "Only a loaded, paused ad can be turned on here." };
    if (!ctx || typeof ctx.confirm !== "function") {
      return { ok: false, sent: false, text: "This page cannot ask you to confirm yet, so nothing was turned on." };
    }
    var yes = await askConfirm(ctx, turnOnSheet(row));
    if (!yes) return { ok: false, sent: false, cancelled: true, text: "" };
    var res = await callApi(ctx, "POST", "campaigns/write", body, { requestId: body.request_id });
    var a = turnOnAnswer(res, row);
    return { ok: a.ok, sent: true, text: a.text };
  }

  async function loadOne(row, ctx, deps) {
    var d = deps || {};
    if (!row || !row.load_label) return { ok: false, sent: false, text: "This ad is loaded or loading already." };
    var body = loadBody(row, (d.newId || newRequestId)());
    if (!body) return { ok: false, sent: false, text: "This video has no id we can send." };
    var res = await callApi(ctx, "POST", "marketing/meta/load", body, { requestId: body.request_id });
    var a = loadAnswer(res, false);
    return { ok: a.ok, sent: true, text: a.text };
  }

  async function loadAll(view, ctx, deps) {
    var d = deps || {};
    if (!view || !view.load_all || !view.load_all.enabled) {
      return { ok: false, sent: false, text: (view && view.load_all && view.load_all.reason) || "Nothing waits to load." };
    }
    if (!ctx || typeof ctx.confirm !== "function") {
      return { ok: false, sent: false, text: "This page cannot ask you to confirm yet, so nothing was loaded." };
    }
    var yes = await askConfirm(ctx, loadAllSheet(view));
    if (!yes) return { ok: false, sent: false, cancelled: true, text: "" };
    var body = loadAllBody((d.newId || newRequestId)());
    var res = await callApi(ctx, "POST", "marketing/meta/load", body, { requestId: body.request_id });
    var a = loadAnswer(res, true);
    return { ok: a.ok, sent: true, text: a.text };
  }

  /* Both reads, side by side. One part failing never blanks the other. */
  async function fetchView(ctx) {
    var both = await Promise.all([
      callApi(ctx, "GET", "marketing/meta/load-status"),
      callApi(ctx, "GET", "ad-videos?status=approved,delivered&limit=" + APPROVED_LIMIT)
    ]);
    var st = both[0];
    var ap = both[1];
    var loadsError = null;
    var approvedError = null;
    if (!st.ok) {
      loadsError = st.status === 503 && messageOf(st)
        ? messageOf(st)
        : "The Meta loads did not load. Try again.";
    }
    if (!ap.ok) approvedError = "The list of approved videos did not load. The rest of this page is current. Try again.";
    return buildView({
      loads: st.ok && st.data && Array.isArray(st.data.loads) ? st.data.loads : [],
      approved: ap.ok && ap.data && Array.isArray(ap.data.items) ? ap.data.items : [],
      asOf: st.ok && st.data ? st.data.as_of || null : null,
      approvedMore: !!(ap.ok && ap.data && ap.data.hasMore),
      loadsError: loadsError,
      approvedError: approvedError
    });
  }

  /* ── drawing ────────────────────────────────────────────────────────────── */

  var CSS = [
    "/* Launch tab. No font sizes (UI-STANDARDS §12.7): text sizes come from the",
    "   brand whitelist (.big, .caption, .chip, .mono). No shadow values (§12.2):",
    "   the card takes .card from the brand shadow list. 8px scale only (§2). */",
    ".ccl{display:flex;flex-direction:column;gap:24px;min-width:0}",
    ".ccl .ccl-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;min-width:0}",
    ".ccl-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}",
    ".ccl-count{display:flex;flex-direction:column;gap:8px;min-width:0}",
    ".ccl-count .big{font-weight:600;letter-spacing:-.02em;line-height:1.1}",
    ".ccl-go{display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
    ".ccl-muted{color:var(--gray)}",
    ".ccl-explain{color:var(--gray);margin-top:16px;max-width:78ch}",
    ".ccl-links{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:8px}",
    ".ccl-link{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;color:var(--ink2);background:none;border:0;padding:0;cursor:pointer;font:inherit}",
    ".ccl-rows{list-style:none;display:flex;flex-direction:column;margin:0;padding:0}",
    ".ccl-row{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;row-gap:8px;align-items:start;padding:16px 0;border-top:1px solid var(--line)}",
    ".ccl-row:first-child{border-top-color:transparent;padding-top:0}",
    ".ccl-main{min-width:0;display:flex;flex-direction:column;gap:4px}",
    ".ccl-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
    ".ccl-top b{font-weight:600}",
    ".ccl-line{color:var(--gray);overflow-wrap:anywhere}",
    ".ccl-flag{color:#6B4A12;overflow-wrap:anywhere}",
    ".ccl-reason{color:#6E2A22;overflow-wrap:anywhere}",
    ".ccl-ids{color:var(--gray2);overflow-wrap:anywhere}",
    ".ccl-act{display:flex;flex-direction:column;align-items:flex-end;gap:8px}",
    ".ccl .chip .cd{background:var(--gray2)}",
    ".ccl .chip.on .cd{background:var(--ok)}",
    ".ccl .chip.wip .cd{background:var(--warn)}",
    ".ccl .chip.bad .cd{background:var(--alert)}",
    ".ccl .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--ink2);border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer;background:#fff;color:var(--ink2);min-height:44px;white-space:nowrap}",
    ".ccl .btn:hover{border-color:var(--ink)}",
    ".ccl .btn.primary{background:var(--ink2);color:var(--paper);min-height:48px;padding:8px 24px;white-space:normal;text-align:center}",
    ".ccl .btn[disabled]{opacity:.45;cursor:not-allowed}",
    ".ccl .btn .spin{display:none;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:cclspin .8s linear infinite}",
    ".ccl .btn.busy .spin{display:inline-block}",
    "@keyframes cclspin{to{transform:rotate(360deg)}}",
    ".ccl-say{padding:8px 16px;border-radius:8px;border:1px solid var(--line);overflow-wrap:anywhere}",
    ".ccl-say.ok{background:color-mix(in srgb,var(--ok) 28%,#fff);color:#2C5138}",
    ".ccl-say.err{background:color-mix(in srgb,var(--alert) 28%,#fff);color:#6E2A22}",
    ".ccl-banner{border:1px solid var(--line);border-radius:8px;padding:16px;background:color-mix(in srgb,var(--alert) 22%,#fff);color:#6E2A22;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}",
    ".ccl-empty{display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
    ".ccl .skel{display:block;height:16px;border-radius:8px;background:var(--soft);animation:cclpulse 1.2s ease-in-out infinite}",
    ".ccl .skel.big{height:32px;width:50%}",
    ".ccl .skel + .skel{margin-top:8px}",
    "@keyframes cclpulse{0%,100%{opacity:.45}50%{opacity:1}}",
    "@media (prefers-reduced-motion: reduce){.ccl .skel,.ccl .btn .spin{animation:none}}",
    "@media (max-width:720px){.ccl .ccl-card{padding:16px}}",
    "@media (max-width:480px){.ccl-go{width:100%}.ccl .btn.primary{width:100%}}"
  ].join("\n");

  function injectCss(doc) {
    if (!doc || !doc.head || doc.getElementById("ccl-css")) return;
    var el = doc.createElement("style");
    el.id = "ccl-css";
    el.textContent = CSS;
    doc.head.appendChild(el);
  }

  function btn(act, key, label, opts) {
    var o = opts || {};
    return '<button type="button" class="btn' + (o.primary ? " primary" : "") + (o.busy ? " busy" : "") + '"' +
      ' data-act="' + esc(act) + '"' + (key ? ' data-key="' + esc(key) + '"' : "") +
      (o.disabled || o.busy ? " disabled" : "") +
      (o.describedBy ? ' aria-describedby="' + esc(o.describedBy) + '"' : "") +
      (o.id ? ' id="' + esc(o.id) + '"' : "") + ">" +
      '<span class="spin" aria-hidden="true"></span><span class="lbl">' + esc(label) + "</span></button>";
  }

  function skeletonHtml() {
    return '<div class="ccl" data-tab="launch" aria-busy="true">' +
      '<section class="card ccl-card"><span class="caption">Ads for Meta</span><span class="skel big"></span><span class="skel"></span></section>' +
      '<section class="card ccl-card"><span class="skel"></span><span class="skel"></span><span class="skel"></span></section>' +
      "</div>";
  }

  function rowHtml(row, st) {
    var busy = st.busy[row.key] || {};
    var say = st.say[row.key];
    var reasonId = "ccl-why-" + row.key;
    var h = '<li class="ccl-row" data-row="' + esc(row.key) + '">';
    h += '<div class="ccl-main">';
    h += '<div class="ccl-top"><b>' + esc(row.label) + "</b>" +
      '<span class="chip ' + esc(row.chip) + '"><span class="cd"></span>' + esc(row.state_word) + "</span></div>";
    if (row.about) h += '<div class="ccl-line">' + esc(row.about) + "</div>";
    if (row.ad_set_line) h += '<div class="ccl-line">' + esc(row.ad_set_line) + "</div>";
    if (row.step_line) h += '<div class="ccl-line">' + esc(row.step_line) + "</div>";
    row.reasons.forEach(function (r) { h += '<div class="ccl-reason">' + esc(r) + "</div>"; });
    row.flags.forEach(function (f) { h += '<div class="ccl-flag">' + esc(f) + "</div>"; });
    if (row.turn_on.show && !row.turn_on.enabled) {
      h += '<div class="ccl-flag" id="' + esc(reasonId) + '">' + esc(row.turn_on.reason) + "</div>";
    }
    if (row.ids_line) h += '<div class="caption mono ccl-ids">' + esc(row.ids_line) + "</div>";
    if (say && say.text) {
      h += '<div class="ccl-say ' + (say.ok ? "ok" : "err") + '" role="status">' + esc(say.text) + "</div>";
    }
    h += "</div>";

    var acts = "";
    if (row.load_label) acts += btn("load", row.key, row.load_label, { busy: busy.load });
    if (row.no_ad_set) acts += '<button type="button" class="ccl-link" data-act="go" data-to="settings">Open Settings</button>';
    if (row.turn_on.show) {
      acts += btn("turn-on", row.key, "Turn on", {
        busy: busy.turnOn,
        disabled: !row.turn_on.enabled,
        describedBy: row.turn_on.enabled ? null : reasonId
      });
    }
    if (acts) h += '<div class="ccl-act">' + acts + "</div>";
    h += "</li>";
    return h;
  }

  function viewHtml(view, st) {
    var ctx = st.ctx;
    var h = '<div class="ccl" data-tab="launch">';

    if (view.loads_error) {
      h += '<div class="ccl-banner" role="alert"><span>' + esc(view.loads_error) + "</span>" +
        btn("retry-read", null, "Try again") + "</div>";
    }

    // 1. The count, top-left and largest, and the one filled button.
    var asOf = azTime(view.as_of, ctx);
    h += '<section class="card ccl-card" aria-label="Ads for Meta">';
    h += '<div class="ccl-head"><div class="ccl-count">' +
      '<span class="caption">Ads for Meta</span>' +
      '<span class="big" id="cclHeadline">' + esc(view.loads_error ? "unknown" : view.headline) + "</span>" +
      '<span class="ccl-muted">' + esc(view.loads_error ? "Loaded ads on now: unknown" : view.on_line) + "</span>" +
      '<span class="caption ccl-muted">' + esc(asOf ? "Ad set and campaign states from the Meta sync at " + asOf + "." : "Meta has not synced yet, so ad set and campaign states are unknown.") + "</span>" +
      "</div>";
    var allBusy = !!st.busyAll;
    var allEnabled = view.load_all.enabled && !view.loads_error;
    h += '<div class="ccl-go">' + btn("load-all", null, "Load all approved into Meta, paused", {
      primary: true, busy: allBusy, disabled: !allEnabled, describedBy: allEnabled ? null : "ccl-all-why", id: "cclLoadAll"
    });
    if (!allEnabled) {
      h += '<span class="caption ccl-muted" id="ccl-all-why">' +
        esc(view.loads_error ? "Loading is off until the Meta loads come back." : view.load_all.reason) + "</span>";
    } else {
      h += '<span class="caption ccl-muted">Costs $0. Nothing spends until you turn one on.</span>';
    }
    h += "</div></div>";
    if (st.sayAll && st.sayAll.text) {
      h += '<div class="ccl-say ' + (st.sayAll.ok ? "ok" : "err") + ' ccl-explain" role="status">' + esc(st.sayAll.text) + "</div>";
    }
    h += '<p class="ccl-explain">Ads load PAUSED with their number, copy, link and tracking tags, and every Meta auto change turned off. ' +
      "Turn on starts one ad at a time and shows its daily budget first.</p>";
    h += '<div class="ccl-links"><a class="ccl-link" href="campaign-manager.html">Open Campaigns to pause a campaign or change its budget</a></div>';
    h += "</section>";

    // 2. One row per ad.
    h += '<section class="card ccl-card" aria-label="Each ad">';
    if (view.approved_error) {
      h += '<div class="ccl-banner" role="alert"><span>' + esc(view.approved_error) + "</span>" +
        btn("retry-read", null, "Try again") + "</div>";
    }
    if (view.empty) {
      h += '<div class="ccl-empty"><p>No approved videos to load. Approve one on Videos first.</p>' +
        '<button type="button" class="ccl-link" data-act="go" data-to="videos">Open Videos</button></div>';
    } else if (view.rows.length) {
      h += '<ul class="ccl-rows">' + view.rows.map(function (r) { return rowHtml(r, st); }).join("") + "</ul>";
      if (view.approved_more) {
        h += '<p class="caption ccl-muted ccl-explain">Showing the newest ' + APPROVED_LIMIT + " approved videos.</p>";
      }
    } else if (!view.loads_error && !view.approved_error) {
      h += '<p class="ccl-muted">No ads yet.</p>';
    }
    h += "</section>";

    h += "</div>";
    return h;
  }

  /* ── the tab's life ─────────────────────────────────────────────────────── */

  var S = { root: null, ctx: null, view: null, busy: {}, say: {}, busyAll: false, sayAll: null, timer: null, live: false, reading: false };

  function paint() {
    if (!S.root) return;
    S.root.innerHTML = S.view ? viewHtml(S.view, S) : skeletonHtml();
  }

  function stopPoll() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  }

  function schedulePoll(ms) {
    stopPoll();
    if (!S.live) return;
    var inFlight = S.view && S.view.counts && S.view.counts.in_flight > 0;
    if (!inFlight && !ms) return;
    S.timer = setTimeout(function () { S.timer = null; read(); }, ms || POLL_MS);
  }

  async function read() {
    if (S.reading) return;
    S.reading = true;
    try {
      S.view = await fetchView(S.ctx);
    } finally {
      S.reading = false;
    }
    paint();
    schedulePoll();
  }

  function rowByKey(key) {
    if (!S.view) return null;
    for (var i = 0; i < S.view.rows.length; i++) if (S.view.rows[i].key === key) return S.view.rows[i];
    return null;
  }

  function toast(text) {
    if (text && S.ctx && typeof S.ctx.toast === "function") {
      try { S.ctx.toast(text); } catch (e) { /* the row already says it */ }
    }
  }

  async function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!t || !S.root || !S.root.contains(t) || t.disabled) return;
    var act = t.getAttribute("data-act");
    var key = t.getAttribute("data-key");

    if (act === "retry-read") { S.view = null; paint(); await read(); return; }
    if (act === "go") {
      var to = t.getAttribute("data-to");
      if (to && S.ctx && typeof S.ctx.go === "function") S.ctx.go(to);
      return;
    }
    if (act === "load-all") {
      if (S.busyAll) return;
      S.busyAll = true; S.sayAll = null; paint();
      var a = await loadAll(S.view, S.ctx);
      S.busyAll = false;
      if (a.sent || !a.cancelled) S.sayAll = a.text ? { ok: a.ok, text: a.text } : null;
      paint();
      if (a.ok) { toast(a.text); schedulePoll(3000); }
      return;
    }
    var row = rowByKey(key);
    if (!row) return;
    S.busy[key] = S.busy[key] || {};
    if (act === "load") {
      if (S.busy[key].load) return;
      S.busy[key].load = true; delete S.say[key]; paint();
      var l = await loadOne(row, S.ctx);
      S.busy[key].load = false;
      S.say[key] = { ok: l.ok, text: l.text };
      paint();
      if (l.ok) schedulePoll(3000);
      return;
    }
    if (act === "turn-on") {
      if (S.busy[key].turnOn) return;
      S.busy[key].turnOn = true; delete S.say[key]; paint();
      var r = await turnOn(row, S.ctx);
      S.busy[key].turnOn = false;
      if (r.cancelled) { paint(); return; }
      S.say[key] = { ok: r.ok, text: r.text };
      if (r.ok) {
        // Answer at once; the next read brings the saved status.
        row.ad_status = "ACTIVE";
        decorate(row);
        S.view.counts.on += 1;
        S.view.on_line = "Loaded ads on now: " + S.view.counts.on;
        toast(r.text);
      }
      paint();
      if (r.ok) schedulePoll(3000);
    }
  }

  async function render(rootEl, ctx) {
    S.root = rootEl;
    S.ctx = ctx;
    S.live = true;
    S.view = null;
    S.say = {};
    S.busy = {};
    S.sayAll = null;
    injectCss(rootEl && rootEl.ownerDocument);
    if (rootEl && !rootEl.__cclClick) {
      rootEl.addEventListener("click", function (ev) { onClick(ev); });
      rootEl.__cclClick = true;
    }
    paint();
    await read();
  }

  async function refresh(ctx) {
    if (ctx) S.ctx = ctx;
    S.live = true;
    await read();
  }

  function hide() {
    S.live = false;
    stopPoll();
  }

  root.FundhubCCLaunch = {
    TAB_ID: TAB_ID,
    ONLY_CHRIS: ONLY_CHRIS,
    NO_BUDGET: NO_BUDGET,
    moneyWord: moneyWord,
    budgetOf: budgetOf,
    statusKind: statusKind,
    funnelWord: funnelWord,
    buildView: buildView,
    loadBody: loadBody,
    loadAllBody: loadAllBody,
    turnOnBody: turnOnBody,
    turnOnSheet: turnOnSheet,
    loadAllSheet: loadAllSheet,
    turnOnAnswer: turnOnAnswer,
    loadAnswer: loadAnswer,
    turnOn: turnOn,
    loadOne: loadOne,
    loadAll: loadAll,
    fetchView: fetchView,
    viewHtml: function (view) { return viewHtml(view, { busy: {}, say: {}, ctx: null }); }
  };

  (root.FundhubCC = root.FundhubCC || { _q: [], registerTab: function (t) { this._q.push(t); } })
    .registerTab({
      id: TAB_ID,
      label: "Launch",
      order: 6,
      render: render,
      refresh: refresh,
      hide: hide
    });
})(typeof window !== "undefined" ? window : globalThis);
