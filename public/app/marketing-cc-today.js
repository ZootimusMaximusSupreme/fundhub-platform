/* marketing-cc-today.js — the Today tab of the Marketing Command Center.

   WHERE IT LIVES. public/app/marketing-command-center.js is the frame (the tab
   strip, the gear, hash routing, the shared helpers). This file is one tab
   module: it registers itself as "today" with window.FHMarketingCCTabs and the
   frame calls render(panel, ctx) the first time Today is shown. The tab-module
   contract is docs/specs/command-center-tabs.md. The code below moved here from
   marketing-command-center.js unchanged (plan unit U34); its markup moved from
   the page into TODAY_HTML at the bottom, word for word.

   WHAT THIS SCREEN IS. Chris's marketing dashboard: docs/specs/
   marketing-machine-2026-10-04.md §8.3 (the Today tab), built as the
   "smallest first slice" in docs/specs/marketing-dashboard-plan-2026-10-05.md,
   then made honest by slice 0 of docs/specs/command-center-design-2026-10-05.md
   ("Today tells the truth"): every cost line from a measured run or "unknown",
   whole-day spend windows, the as-of words, the per-stage word table, Read it,
   the videos waiting on Chris, no inner scroll boxes, a real footer clock.

   WHAT IT READS AND CALLS.
     GET  /api/marketing/today           everything on the page (owner/admin)
     GET  /api/ad-videos?status=awaiting_approval
                                         finished videos waiting on Chris
                                         (one row in Waiting on you)
     POST /api/creative/generate         saves one ad copy job for the house partner
     POST /api/creative/run              runs it now (max_jobs: 1, so one press
                                         runs and pays for at most one job)
     GET  /api/marketing/offer/generate  the newest offer, or one run by ?id=
     POST /api/marketing/offer/generate  starts an offer run (it takes minutes,
                                         so the page asks again every few seconds)
   GET marketing/today is read again when the tab comes back into view and
   every 5 minutes.

   THE TWO "WAITING" LISTS ARE DIFFERENT THINGS. marketing/today's `waiting`
   names PARTS of the machine that are not live yet (a table not shipped, no
   Meta numbers). Those feed the "What is turned on" card. "Waiting on you" is
   what only Chris can do — read and approve a flywheel step, redo one, or
   decide the finished videos — and is read off the flywheel rows and the
   ad-videos list.

   NEVER FAKE A NUMBER. A missing or null value shows as "unknown", never as 0
   (CLAUDE.md §12: NULL means unknown and must survive). A cost line is a
   measured run or "unknown, not measured yet" — never a constant. An empty list
   says "nothing yet". There is no sample data anywhere in this file.

   TESTABLE WITHOUT A BROWSER. Every rule that turns data into words is a plain
   function on window.FHMarketingCC, and src/ui/marketing-command-center.test.mjs
   runs this file in node:vm (the pattern src/training/ramp-quizzes.test.mjs
   uses). The DOM wiring at the bottom only runs when the frame shows the tab. */
(function (root) {
  "use strict";

  /* ── words and lists ─────────────────────────────────────────────────── */

  /* The three bodies of law an ad is screened under (src/compliance/screen.mjs
     OFFER_TYPES). The endpoint refuses anything else, so this list is exact. */
  var OFFER_TYPES = ["funding", "credit_cards", "credit_repair"];

  /* The six flywheel steps, in order (scripts/flywheel/status.mjs STAGES).
     Step 6 reads the spend; the page says "step 3 of 6", never "Flywheel
     step 3" (design §3.0, the word table). */
  var STAGE_KEYS = ["avatar", "ad-research", "offer", "copy", "ad-strategy", "spend"];
  var STAGE_NAMES = {
    "avatar": "Who we sell to",
    "ad-research": "What the market sells",
    "offer": "The offer",
    "copy": "Ad copy",
    "ad-strategy": "Which ad strategy",
    "spend": "Read the spend"
  };
  /* The checker's count names (scripts/flywheel/status.mjs gates and each
     file's `counts:`), in plain words. A name not here is split into words. */
  var COUNT_WORDS = {
    "distinctReasons": "different reasons",
    "valueEquationScores": "value scores",
    "strategyNamed": "strategy",
    "priceSet": "price",
    "rowsFound": "findings",
    "rowsVerified": "checked findings",
    "rowsWithFirstSeen": "dated findings",
    "competitorsFound": "competitors",
    "languageEntries": "language entries"
  };
  /* Owner law, 2026-10-05: nothing on this page sends Chris to chat or to
     Claude Code (design §3.9). A step with no button yet says so in one honest
     sentence and names the slice that adds the button (design safety rule 9),
     never a dead button and never a chat command to copy.
     RUN_SLICE: where running the step lands (§6: Build the avatar is slice 5a,
     Research the market is slice 10, stages 4 to 6 are slice 5).
     APPROVE_SLICE: where Approve and Tweak land (slice 5a for the avatar row,
     slice 5 for every other row). OFFER_FILE_SLICE: where Write offer starts
     saving 03-offer.md (slice 1). Only the offer has a button on this page. */
  var RUN_SLICE = { "avatar": "5a", "ad-research": "10", "copy": "5", "ad-strategy": "5", "spend": "5" };
  var APPROVE_SLICE = { "avatar": "5a" };
  var OFFER_FILE_SLICE = "1";
  function notYet(slice) { return "Not on this page yet: it ships in slice " + slice + "."; }
  function approveSlice(key) { return APPROVE_SLICE[key] || "5"; }
  var STAGE_RUNS = {
    "avatar": notYet(RUN_SLICE["avatar"]) + " Cost not measured.",
    "ad-research": notYet(RUN_SLICE["ad-research"]) + " Cost not measured.",
    "offer": "Write offer, on the Offer card, writes a new offer on this page.",
    "copy": notYet(RUN_SLICE["copy"]),
    "ad-strategy": notYet(RUN_SLICE["ad-strategy"]),
    "spend": notYet(RUN_SLICE["spend"])
  };

  var DAY_MS = 86400000;
  /* The Meta pull runs once a day: meta-campaign-sync-sweeper, SWEEP_CRON
     "0 7 * * *" (07:00 UTC is midnight in Arizona). Older than two days means
     at least one daily pull was missed. src/ui/marketing-command-center.test.mjs
     holds the cron and this sentence together. */
  var META_FRESH_MS = 2 * DAY_MS;
  var META_PULL_WORDS = "The Meta pull runs at midnight, Arizona time.";
  /* An offer run takes a few minutes in a 15-minute background function
     (M12, netlify/functions/marketing-offer-background.mjs). Ask every 10
     seconds; give up after 16 minutes and say where to look. */
  var OFFER_POLL_MS = 10000;
  var OFFER_POLL_TRIES = 96;
  /* GET marketing/today again every 5 minutes, and when the tab comes back
     into view (design §3.1, the footer) — but not twice in 30 seconds. */
  var RELOAD_MS = 5 * 60 * 1000;
  var FOCUS_GAP_MS = 30 * 1000;
  /* A read (GET) that has not answered in 20 seconds is given up on, so one
     hung request (a phone that slept mid-load) cannot stop every later reload:
     the page says the server took too long, keeps the last numbers, and the
     next 5-minute tick tries again. Writes (POST) are never cut off here: a
     copy run can take half a minute and its own answer says what happened. */
  var FETCH_TIMEOUT_MS = 20 * 1000;
  /* Ad copy longer than this folds behind Show more (no inner scroll box). */
  var FOLD_LINES = 6;
  var FOLD_CHARS = 360;

  /* Every time on a staff screen prints in Arizona (America/Phoenix), the
     office clock and the ad account's day — never the viewer's laptop zone
     (ops/workflows/arizona-time-2026-08-28.md; src/http/crm-html.test.mjs).
     fmt() applies it to every date and clock this page draws. */
  var display = { tz: "America/Phoenix" };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── reading the endpoints' answers ──────────────────────────────────── */

  /* Each key is read in either spelling — last7Days or last_7_days — so a
     naming change on the server cannot blank the page. */
  function snakeOf(name) {
    /* last7Days → last7_days → last_7_days */
    return name.replace(/[A-Z]/g, function (c) { return "_" + c.toLowerCase(); })
      .replace(/([a-z])([0-9])/g, "$1_$2");
  }
  function first(o, names) {
    if (o == null || typeof o !== "object") return undefined;
    for (var i = 0; i < names.length; i++) {
      var tries = [names[i], snakeOf(names[i])];
      for (var j = 0; j < tries.length; j++) {
        if (Object.prototype.hasOwnProperty.call(o, tries[j]) && o[tries[j]] !== undefined) return o[tries[j]];
      }
    }
    return undefined;
  }
  function has(o, name) {
    return o != null && typeof o === "object" &&
      (Object.prototype.hasOwnProperty.call(o, name) || Object.prototype.hasOwnProperty.call(o, snakeOf(name)));
  }
  function num(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function bool(v) { return v === true ? true : (v === false ? false : null); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function str(v) { return v == null ? "" : String(v); }
  function strs(v) { return arr(v).map(str).filter(Boolean); }

  function normalizePiece(p) {
    p = obj(p);
    var reasons = arr(first(p, ["blockedReasons", "reasons"]));
    if (!reasons.length) reasons = arr(obj(first(p, ["screen"])).reasons);
    return {
      id: first(p, ["id"]) || null,
      text: str(first(p, ["copyText", "text"])),
      state: str(first(p, ["complianceState"]) || "pending").toLowerCase(),
      reasons: reasons.map(function (r) {
        return typeof r === "string" ? r : str(obj(r).message || obj(r).code);
      }).filter(Boolean),
      createdAt: first(p, ["createdAt"]) || null
    };
  }

  function normalizeJob(j) {
    j = obj(j);
    return {
      id: first(j, ["id", "jobId"]) || null,
      status: str(first(j, ["status"])).toLowerCase(),
      error: first(j, ["error"]) || null,
      createdAt: first(j, ["createdAt"]) || null,
      startedAt: first(j, ["startedAt"]) || null,
      finishedAt: first(j, ["finishedAt"]) || null
    };
  }

  /* One row of scripts/flywheel/status.mjs evaluate(), as M10's
     src/marketing/flywheel-status.mjs hands it over. */
  function normalizeStage(r) {
    r = obj(r);
    var meta = obj(first(r, ["meta"]));
    var key = str(first(r, ["key"]));
    var counts = obj(first(r, ["counts"]));
    var card = first(r, ["reviewCard"]);
    return {
      n: num(first(r, ["n"])),
      key: key,
      label: str(first(r, ["label"]) || key),
      file: str(first(r, ["file"])),
      state: str(first(r, ["state"])).toUpperCase() || null,
      why: str(first(r, ["why"])),
      reasons: strs(first(r, ["reasons"])),
      approved: first(r, ["approved"]) === true || str(first(meta, ["status"])).toLowerCase() === "approved",
      counts: counts,
      reviewCard: typeof card === "string" && card.trim() ? card : null
    };
  }

  function sixStages(list) {
    return arr(list).map(normalizeStage)
      .filter(function (s) { return STAGE_KEYS.indexOf(s.key) !== -1; })
      .sort(function (a, c) { return (a.n || 0) - (c.n || 0); });
  }

  function normalizeOfferCost(o) {
    if (!o || typeof o !== "object") return null;
    return {
      measured: first(o, ["measured"]) === true,
      seconds: num(first(o, ["seconds"])),
      costCents: num(first(o, ["costCents"])),
      underOneCent: first(o, ["underOneCent"]) === true,
      models: strs(first(o, ["models"])),
      unpriced: strs(first(o, ["unpricedModels"])),
      finishedAt: first(o, ["finishedAt"]) || null
    };
  }

  function normalizeCopyCost(c) {
    if (!c || typeof c !== "object") return null;
    return {
      runs: num(first(c, ["runs"])) || 0,
      avgCostCents: num(first(c, ["avgCostCents"])),
      underOneCent: first(c, ["underOneCent"]) === true,
      models: strs(first(c, ["models"])),
      unpriced: strs(first(c, ["unpricedModels"])),
      lastAt: first(c, ["lastAt"]) || null
    };
  }

  /* normalizeWindow — one window of U32's M5 numbers (numbers.today, .d7,
     .d30). Every null stays null: unknown, never 0. */
  function normalizeWindow(w) {
    var o = obj(w);
    return {
      spend: num(first(o, ["spend_cents"])),
      leads: num(first(o, ["leads"])),
      booked: num(first(o, ["booked"])),
      showed: num(first(o, ["showed"])),
      sales: num(first(o, ["sales"])),
      roadmaps: num(first(o, ["roadmaps"])),
      cash: num(first(o, ["cash_cents"])),
      reportedCash: num(first(o, ["reported_cash_cents"])),
      roas: num(first(o, ["roas"]))
    };
  }

  /* normalizeM5 — the keys U32 added to GET marketing/today (contract shape
     7): numbers, daily, spend_by_funnel, flow, scripts_waiting, stuck_jobs.
     A key that is missing or null is "not read", never an empty zero. */
  function normalizeM5(b) {
    var numbersRaw = first(b, ["numbers"]);
    var numbers = obj(numbersRaw);
    var flowRaw = first(b, ["flow"]);
    var flow = obj(flowRaw);
    var byFunnelRaw = first(b, ["spend_by_funnel"]);
    var swRaw = first(b, ["scripts_waiting"]);
    var stuckRaw = first(b, ["stuck_jobs"]);
    var sw = obj(swRaw);
    return {
      m5Read: numbersRaw != null && typeof numbersRaw === "object",
      numbers: {
        today: normalizeWindow(first(numbers, ["today"])),
        d7: normalizeWindow(first(numbers, ["d7"])),
        d30: normalizeWindow(first(numbers, ["d30"]))
      },
      daily: arr(first(b, ["daily"])).map(function (d) {
        d = obj(d);
        return { date: str(first(d, ["date"])), spend: num(first(d, ["spend_cents"])), leads: num(first(d, ["leads"])) };
      }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.date); }),
      byFunnelRead: Array.isArray(byFunnelRaw),
      byFunnel: arr(byFunnelRaw).map(function (f) {
        f = obj(f);
        var key = first(f, ["funnel_key"]);
        return { key: key == null || key === "" ? null : str(key), name: str(first(f, ["name"])), spend: num(first(f, ["spend_cents"])) };
      }),
      flowRead: flowRaw != null && typeof flowRaw === "object",
      flow: {
        clicks: num(first(flow, ["clicks"])),
        pageViews: num(first(flow, ["page_views"])),
        leads: num(first(flow, ["leads"])),
        booked: num(first(flow, ["booked"])),
        showed: num(first(flow, ["showed"])),
        sales: num(first(flow, ["sales"]))
      },
      scriptsWaiting: swRaw != null && typeof swRaw === "object"
        ? { ready: num(first(sw, ["ready"])), flagged: num(first(sw, ["flagged"])) }
        : null,
      stuckRead: Array.isArray(stuckRaw),
      stuckJobs: arr(stuckRaw).map(function (j) {
        j = obj(j);
        return { id: str(first(j, ["id"])), kind: str(first(j, ["kind"])), error: str(first(j, ["error"])), since: first(j, ["since"]) || null };
      }).filter(function (j) { return j.id; })
    };
  }

  /* normalizeToday — GET marketing/today (M10, api/marketing/today.mjs) in the
     one shape this page draws from. Called with null when the read failed:
     every number comes back unknown and `loaded` is false. */
  function normalizeToday(body) {
    var b = obj(body);
    var spendRaw = obj(first(b, ["spend"]));
    var windows = obj(first(spendRaw, ["windows"]));
    var w7 = obj(first(windows, ["last7Days"]));
    var wPrev7 = obj(first(windows, ["prior7Days"]));
    var w30 = obj(first(windows, ["last30Days"]));
    var wPrev30 = obj(first(windows, ["prior30Days"]));
    var wToday = obj(first(windows, ["today"]));
    var syncRaw = first(b, ["lastSync"]);
    var sync = obj(syncRaw);
    var copy = obj(first(b, ["copy"]));
    var ready = obj(first(b, ["copyReady"]));
    var checks = arr(first(ready, ["checks"])).map(function (c) {
      c = obj(c);
      return {
        key: str(first(c, ["key"])),
        ok: bool(first(c, ["ok"])),
        label: str(first(c, ["label"])),
        used: num(first(c, ["used"])),
        cap: num(first(c, ["cap"]))
      };
    });
    function check(key) {
      for (var i = 0; i < checks.length; i++) if (checks[i].key === key) return checks[i];
      return null;
    }
    function checkOk(key) { var c = check(key); return c ? c.ok : null; }
    var budget = check("writing_budget");
    var flyRaw = first(b, ["flywheel"]);
    var campaigns = arr(first(obj(flyRaw), ["campaigns"])).map(function (c) {
      c = obj(c);
      return { campaign: str(first(c, ["campaign"])), stages: sixStages(first(c, ["stages"])), advice: str(first(c, ["advice"])) };
    });
    var main = null;
    for (var i = 0; i < campaigns.length; i++) if (campaigns[i].campaign === "partner") main = campaigns[i];
    if (!main) main = campaigns[0] || null;
    var costsRaw = first(b, ["costs"]);
    var costs = obj(costsRaw);
    var metaAt = first(sync, ["metaSyncedAt"]) || null;
    var metricsAt = first(sync, ["metricsSyncedAt"]) || null;
    var m5 = normalizeM5(b);

    return {
      /* U32's M5 keys (U37 reads them): see normalizeM5. */
      m5Read: m5.m5Read,
      numbers: m5.numbers,
      daily: m5.daily,
      byFunnelRead: m5.byFunnelRead,
      byFunnel: m5.byFunnel,
      flowRead: m5.flowRead,
      flow: m5.flow,
      scriptsWaiting: m5.scriptsWaiting,
      stuckRead: m5.stuckRead,
      stuckJobs: m5.stuckJobs,
      /* true when the server answered at all. A 200 with none of these keys
         is still loaded: every number in it is honestly unknown. */
      loaded: body != null && typeof body === "object",
      today: str(first(b, ["today"])) || null,
      /* When the newest ad-day row was saved (the "saved" time). */
      asOf: metricsAt || metaAt,
      /* When Meta last pulled at all — the freshness test. A pull on a day no
         ad ran saves no row, so the row time alone would call it stale. */
      pulledAt: metaAt || metricsAt,
      latestMetricsDate: first(sync, ["latestMetricsDate"]) || null,
      syncRead: syncRaw != null && typeof syncRaw === "object",
      cfRead: has(sync, "clickfunnelsSyncedAt"),
      cfSyncedAt: first(sync, ["clickfunnelsSyncedAt"]) || null,
      partnerId: first(ready, ["partnerId"]) || first(copy, ["partnerId"]) || null,
      spendThrough: first(spendRaw, ["through"]) || null,
      spendToday: num(first(wToday, ["spendCents"])),
      spend7: num(first(w7, ["spendCents"])),
      days7: num(first(w7, ["daysWithData"])),
      from7: first(w7, ["from"]) || null,
      to7: first(w7, ["to"]) || null,
      spendPrev7: num(first(wPrev7, ["spendCents"])),
      spend30: num(first(w30, ["spendCents"])),
      days30: num(first(w30, ["daysWithData"])),
      from30: first(w30, ["from"]) || null,
      to30: first(w30, ["to"]) || null,
      spendPrev30: num(first(wPrev30, ["spendCents"])),
      copyReady: {
        ready: bool(first(ready, ["ready"])),
        house: checkOk("house_partner"),
        switchOn: checkOk("marketing_switch"),
        provider: checkOk("copy_provider"),
        anthropicKey: checkOk("anthropic_key"),
        budget: checkOk("writing_budget"),
        budgetUsed: budget ? budget.used : null,
        budgetCap: budget ? budget.cap : null,
        checks: checks
      },
      costsRead: costsRaw != null && typeof costsRaw === "object",
      offerCost: normalizeOfferCost(first(costs, ["offer"])),
      copyCost: normalizeCopyCost(first(costs, ["copy"])),
      pieces: arr(first(copy, ["pieces"])).map(normalizePiece),
      jobs: arr(first(copy, ["jobs"])).map(normalizeJob),
      flywheelRead: flyRaw != null && typeof flyRaw === "object",
      campaigns: campaigns,
      campaign: main ? main.campaign : null,
      stages: main ? main.stages : [],
      advice: main ? main.advice : "",
      partsWaiting: arr(first(b, ["waiting"])).map(function (w) {
        w = obj(w);
        return { part: str(first(w, ["part"])), reason: str(first(w, ["reason"])) };
      })
    };
  }

  /* normalizeVideos — GET ad-videos?status=awaiting_approval (api/ad-videos.mjs)
     as the one Waiting on you row needs it. A failed read is `loaded: false`,
     never an empty list: "nothing waiting" and "could not tell" differ. */
  function normalizeVideos(res) {
    if (!res || res.transport || res.status !== 200 || !res.body || res.body.ok === false) {
      return { loaded: false, items: [], more: false };
    }
    var b = obj(res.body);
    return {
      loaded: true,
      more: b.hasMore === true || b.has_more === true,
      items: arr(first(b, ["items"])).map(function (v) {
        v = obj(v);
        return {
          adId: str(first(v, ["adId"])),
          takeNo: num(first(v, ["takeNo"])),
          since: first(v, ["updatedAt"]) || first(v, ["createdAt"]) || null,
          expiresAt: first(v, ["approvalExpiresAt"]) || null
        };
      })
    };
  }

  /* An offer as M12's offerView() hands it over (api/marketing/offer/generate). */
  function normalizeOffer(v) {
    if (!v || typeof v !== "object") return null;
    var o = obj(first(v, ["offer"]));
    var card = obj(first(v, ["reviewCard"]));
    var name = str(first(o, ["name"]));
    var sentence = str(first(o, ["oneSentence"]));
    if (!name && !sentence) return null;
    return {
      jobId: first(v, ["jobId"]) || null,
      campaign: str(first(v, ["campaign"])) || null,
      finishedAt: first(v, ["finishedAt"]) || null,
      name: name,
      price: str(first(o, ["price"])),
      sentence: sentence,
      whatTheyGet: strs(first(o, ["whatTheyGet"])),
      guarantees: arr(first(o, ["guarantees"])).map(function (g) {
        if (typeof g === "string") return g;
        g = obj(g);
        var n = str(g.name);
        var p = str(g.promise);
        return n && p ? n + ": " + p : (n || p);
      }).filter(Boolean),
      bonuses: strs(first(o, ["bonuses"])),
      decided: str(first(card, ["whatThisDecided"])),
      toCheck: strs(first(card, ["threeThingsToCheck"])),
      notSure: strs(first(card, ["notSureAbout"])).filter(function (s) { return !/^nothing\.?$/i.test(s.trim()); })
    };
  }

  function normalizeOfferJob(j) {
    j = obj(j);
    var id = first(j, ["id"]);
    if (!id) return null;
    return {
      id: id,
      status: str(first(j, ["status"])).toLowerCase(),
      createdAt: first(j, ["createdAt"]) || null,
      finishedAt: first(j, ["finishedAt"]) || null,
      error: str(first(j, ["error"]))
    };
  }

  /* ── turning data into words ─────────────────────────────────────────── */

  /* money — integer cents to dollars, to the cent ("$707.27"; a whole amount
     is "$1,300"). null stays "unknown"; a real 0 is "$0". */
  function money(cents) {
    var n = num(cents);
    if (n === null) return "unknown";
    var dollars = Math.abs(n) / 100;
    var whole = Math.round(dollars) === dollars;
    return (n < 0 ? "-$" : "$") + dollars.toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2
    });
  }

  function count(n) {
    var v = num(n);
    return v === null ? "unknown" : Math.round(v).toLocaleString("en-US");
  }

  /* compare — every metric has a comparison (UI-STANDARDS §7), said in words,
     never by colour alone (§12.6), and as plain money, never a percent (design
     §3.1: "Up from $308.93 the 7 days before"). Within half a percent is
     "about the same". */
  function compare(cur, prev, span) {
    var c = num(cur);
    var p = num(prev);
    var before = "the " + span + " before";
    if (p === null) return "No number for " + before + ".";
    if (c === null) return "The " + span + " before: " + money(p) + ".";
    if (p === 0) return c === 0 ? "Same as " + before + " ($0)." : "Up from $0 " + before + ".";
    if (Math.abs(c - p) / Math.abs(p) < 0.005) return "About the same as " + before + " (" + money(p) + ").";
    return (c > p ? "Up from " : "Down from ") + money(p) + " " + before + ".";
  }

  function fmt(d, opts) {
    var o = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    if (display.tz) o.timeZone = display.tz;
    return d.toLocaleString("en-US", o);
  }
  function fullTime(d) {
    return fmt(d, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function clockOf(d) { return fmt(d, { hour: "numeric", minute: "2-digit" }); }
  function dateTimeOf(d) { return fmt(d, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function dateOf(d) { return fmt(d, { month: "short", day: "numeric" }); }
  function asDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  /* tipped — words for a time, wrapped so the exact time is its tooltip
     (UI-STANDARDS §7: "Always tooltip the exact time"). */
  function tipped(text, title) {
    return title ? '<span title="' + esc(title) + '">' + esc(text) + "</span>" : esc(text);
  }
  function dateTip(d) { return tipped(dateOf(d), fullTime(d)); }

  /* when — relative under a day, a date after, the exact time in the tooltip
     (UI-STANDARDS §7). A missing time is "unknown", not "now". */
  function when(iso, nowMs) {
    var d = asDate(iso);
    if (!d) return { text: "unknown", title: "" };
    var t = d.getTime();
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var title = fullTime(d);
    var diff = now - t;
    if (diff >= 0 && diff < DAY_MS) {
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return { text: "just now", title: title };
      if (mins < 60) return { text: mins + (mins === 1 ? " minute ago" : " minutes ago"), title: title };
      var h = Math.floor(mins / 60);
      return { text: h + (h === 1 ? " hour ago" : " hours ago"), title: title };
    }
    return { text: dateTimeOf(d), title: title };
  }

  /* savedWords — earlier today: a clock time with "how long ago" ("12:01 AM
     (7 hours ago)"). Any other day: the date and time ("Oct 4, 3:10 PM"), so
     yesterday afternoon never reads like this afternoon. Design §3.1: any time
     older than a day prints its date in the text. */
  function savedWords(iso, nowMs) {
    var d = asDate(iso);
    if (!d) return { text: "unknown", title: "" };
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var diff = now - d.getTime();
    if (diff >= 0 && diff < DAY_MS && dateOf(d) === dateOf(new Date(now))) {
      return { text: clockOf(d) + " (" + when(iso, now).text + ")", title: fullTime(d) };
    }
    return { text: dateTimeOf(d), title: fullTime(d) };
  }

  /* dayWords("2026-10-04") → "Oct 4". A calendar day, not a moment. */
  function dayWords(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(day));
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function rangeWords(from, to) {
    var a = dayWords(from);
    var b = dayWords(to);
    return a && b ? a + " to " + b : "";
  }

  /* loadedWords — the footer clock: "Loaded 3:02 PM", the exact time in the
     tooltip. */
  function loadedWords(ms) {
    var d = new Date(typeof ms === "number" ? ms : Date.now());
    return { text: "Loaded " + clockOf(d), title: fullTime(d) };
  }

  function minutesWords(seconds) {
    var s = num(seconds);
    if (s === null) return "unknown";
    var m = Math.floor(s / 60);
    var r = Math.round(s - m * 60);
    if (!m) return r + " s";
    return m + " min" + (r ? " " + r + " s" : "");
  }

  /* metaFresh — Meta pulled within two days. Unknown (never pulled, not read)
     is not fresh. */
  function metaFresh(view, nowMs) {
    var d = asDate(view && view.pulledAt);
    if (!d) return false;
    var age = (typeof nowMs === "number" ? nowMs : Date.now()) - d.getTime();
    return age >= 0 ? age <= META_FRESH_MS : true;
  }

  /* pullTime — when Meta last pulled. The "through" day comes from the pull
     (a pull on a day no ad ran saves no row), so the time beside it is the
     pull's too, not the newest row's. */
  function pullTime(v) { return (v && (v.pulledAt || v.asOf)) || null; }

  /* oldLead — "Old numbers: last saved Oct 1." when the pull is more than two
     days old, else "". Design §3.1: the money row leads with it. */
  function oldLead(view, nowMs) {
    var v = view || {};
    if (!v.loaded || !v.pulledAt || metaFresh(v, nowMs)) return "";
    var d = asDate(pullTime(v));
    return "Old numbers: last saved " + (d ? dateOf(d) : "unknown") + ".";
  }

  /* oldLeadHtml — the same words, the date carrying its exact time. */
  function oldLeadHtml(view, nowMs) {
    if (!oldLead(view, nowMs)) return "";
    var d = asDate(pullTime(view));
    return "Old numbers: last saved " + (d ? dateTip(d) : "unknown") + ".";
  }

  /* asOfLine — the one as-of sentence under the spend tiles. `text` is the
     words; `html` is the same words with every time wrapped in its own
     exact-time tooltip, since the sentence names two times (Meta and
     ClickFunnels). */
  function asOfLine(view, nowMs) {
    var v = view || {};
    if (!v.loaded) return { text: "", html: "" };
    var segs = [];
    function say(t) { segs.push({ text: t, title: "" }); }
    function at(w) { segs.push({ text: w.text, title: w.title }); }
    var through = v.spendThrough || v.latestMetricsDate;
    if (!v.syncRead) {
      say("When Meta last sent numbers is not known yet.");
    } else if (!v.pulledAt) {
      say("No ad spend saved yet. " + META_PULL_WORDS);
    } else if (!metaFresh(v, nowMs)) {
      say("Old numbers: last saved ");
      at(savedWords(pullTime(v), nowMs));
      say("." + (through ? " Numbers through " + dayWords(through) + "." : ""));
    } else {
      say(through ? "Numbers through " + dayWords(through) + ", saved " : "Saved ");
      at(savedWords(pullTime(v), nowMs));
      say(".");
    }
    if (v.cfRead) {
      if (v.cfSyncedAt) {
        say(" ClickFunnels last pulled ");
        at(savedWords(v.cfSyncedAt, nowMs));
        say(".");
      } else {
        say(" ClickFunnels has never been pulled.");
      }
    }
    return {
      text: segs.map(function (g) { return g.text; }).join(""),
      html: segs.map(function (g) { return tipped(g.text, g.title); }).join("")
    };
  }

  /* todayWords — the today line. Today's Meta spend is saved in tomorrow's
     midnight pull, so while the pull is fresh it "comes in tomorrow morning";
     only a stale pull makes it "unknown" (design §5 rule 8). */
  function todayWords(view, nowMs) {
    var v = view || {};
    if (v.spendToday !== null && v.spendToday !== undefined) return "Today so far: " + money(v.spendToday) + ".";
    if (!v.loaded || !metaFresh(v, nowMs)) return "Today so far: unknown.";
    return "Today's numbers come in tomorrow morning. " + META_PULL_WORDS;
  }

  /* plainReasons — the flywheel checker's reasons, readable. It writes count
     keys as code names ("did not report distinctReasons"); those become words. */
  function plainReasons(list) {
    var out = arr(list).map(function (r) {
      return str(r).replace(/\b([a-z]+)([A-Z][a-zA-Z]*)\b/g, function (m) {
        return countWord(m);
      }).trim();
    }).filter(Boolean).join("; ");
    if (!out) return "";
    out = out.charAt(0).toUpperCase() + out.slice(1);
    return /[.!?]$/.test(out) ? out : out + ".";
  }

  function codeWords(key) {
    return str(key).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }

  /* countWord — a checker count name in plain words ("distinctReasons" →
     "different reasons"); any other name is split into words. */
  function countWord(key) {
    return Object.prototype.hasOwnProperty.call(COUNT_WORDS, key) ? COUNT_WORDS[key] : codeWords(key);
  }

  /* adviceWords — the checker's closing line in this page's words: "step",
     never "stage", and "a redo", never "re-running" ("2 steps need a redo.
     Do them in order: 3, then 4."). */
  function adviceWords(a) {
    return str(a)
      .replace(/\b(needs?) re-running\b/gi, function (m, need) { return need.toLowerCase() + " a redo"; })
      .replace(/\bstages\b/gi, "steps")
      .replace(/\bstage\b/gi, "step");
  }

  function stageName(s) {
    return STAGE_NAMES[s.key] || (s.label ? s.label.charAt(0).toUpperCase() + s.label.slice(1) : "Step");
  }

  function stepWords(s, total) {
    return s && s.n ? "Step " + s.n + " of " + (total || STAGE_KEYS.length) : "";
  }

  function campaignWords(c) {
    var k = str(c);
    if (!k) return "";
    if (k === "partner") return "Partner offer";
    return k.charAt(0).toUpperCase() + k.slice(1).replace(/[-_]/g, " ") + " offer";
  }

  function listWords(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  /* stepNumbers — the step numbers named in a reason ("waiting on offer and
     copy" → [3, 4]; "03-offer.md is missing" → [3]). */
  var LABEL_N = { "avatar": 1, "ad research": 2, "offer": 3, "copy": 4, "ad strategy": 5, "spend": 6 };
  function stepNumbers(reason, stages) {
    var r = str(reason);
    var out = [];
    var waiting = /^waiting on (.+)$/i.exec(r);
    if (waiting) {
      waiting[1].split(/\s+and\s+|,\s*/).forEach(function (label) {
        var l = label.trim().toLowerCase();
        var n = null;
        arr(stages).forEach(function (s) { if (s.label === l && s.n) n = s.n; });
        if (n === null && LABEL_N[l]) n = LABEL_N[l];
        if (n !== null) out.push(n);
      });
      return out;
    }
    var file = /^0?(\d)-[\w-]+\.md is missing$/i.exec(r);
    if (file) out.push(Number(file[1]));
    var old = /^built on the old (.+)$/i.exec(r);
    if (old && LABEL_N[old[1].trim().toLowerCase()]) out.push(LABEL_N[old[1].trim().toLowerCase()]);
    return out;
  }

  function stepsWords(ns) {
    return ns.length === 1 ? "step " + ns[0] : "steps " + listWords(ns.map(String));
  }

  /* doneSentence — a finished step's own numbers, in words (the word table:
     "Done. 133 customer quotes collected."). Only counts the file wrote. */
  function doneSentence(s) {
    var c = obj(s && s.counts);
    var n = function (k) { return num(c[k]); };
    var said = "";
    if (s.key === "avatar" && n("quotes") !== null) {
      said = count(n("quotes")) + " customer quotes collected.";
    } else if (s.key === "ad-research") {
      var bits = [];
      if (n("rowsFound") !== null) bits.push(count(n("rowsFound")) + " findings");
      if (n("rowsVerified") !== null) bits.push(count(n("rowsVerified")) + " checked");
      if (n("competitorsFound") !== null) bits.push(count(n("competitorsFound")) + " competitors");
      said = bits.length ? bits.join(", ") + "." : "";
    } else if (s.key === "offer" && n("bonuses") !== null) {
      said = (n("priceSet") ? "Price set, " : "") + count(n("bonuses")) + " bonuses.";
    } else if (s.key === "copy" && n("hooks") !== null) {
      said = count(n("hooks")) + " hooks written.";
    } else if (s.key === "ad-strategy" && n("strategyNamed")) {
      said = "Strategy chosen.";
    }
    if (!said && s.why) said = plainReasons([s.why]);
    if (said) said = said.charAt(0).toUpperCase() + said.slice(1);
    return "Done." + (said ? " " + said : "");
  }

  /* failSentence — why a step failed its own check, said plainly. */
  function failSentence(s) {
    var out = arr(s && s.reasons).map(function (r) {
      var m = /^did not report (\w+)$/i.exec(r);
      if (m && m[1] === "priceSet") return "It did not say its price.";
      if (m && m[1] === "strategyNamed") return "It did not name its strategy.";
      if (m) return "It did not count its " + countWord(m[1]) + ".";
      if (/^has no review card$/i.test(r)) return "It has no review card.";
      return plainReasons([r]);
    }).filter(Boolean);
    return out.join(" ");
  }

  /* stageWord — the word table (design §3.0): Done / Done, approved / Needs a
     redo / Waiting on step 3 / Out of date / Not run yet. Each with one
     sentence. */
  function stageWord(s, stages) {
    switch (s && s.state) {
      case "READY":
        return s.approved
          ? { word: "Done, approved", tone: "on", why: doneSentence(s) }
          : { word: "Done", tone: "wip", why: doneSentence(s) + " It waits for you to read it and approve it." };
      case "FAILED":
        return { word: "Needs a redo", tone: "bad", why: (failSentence(s) || "It did not pass its own check.") + " Redo the step." };
      case "STALE": {
        var changed = [];
        arr(s.reasons).forEach(function (r) { changed = changed.concat(stepNumbers(r, stages)); });
        return {
          word: "Out of date", tone: "wip",
          why: changed.length
            ? "Step " + listWords(changed.map(String)) + " changed, so this needs a redo."
            : (plainReasons(s.reasons) || "An earlier step changed, so this needs a redo.")
        };
      }
      case "BLOCKED": {
        var on = [];
        arr(s.reasons).forEach(function (r) { on = on.concat(stepNumbers(r, stages)); });
        on = on.filter(function (n, i) { return on.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
        return on.length
          ? { word: "Waiting on " + stepsWords(on), tone: "wip",
            why: (on.length === 1 ? "Step " + on[0] + " has" : "Steps " + listWords(on.map(String)) + " have") + " to be done first." }
          : { word: "Waiting", tone: "wip", why: plainReasons(s.reasons) || "An earlier step has to be done first." };
      }
      case "MISSING":
        return { word: "Not run yet", tone: "", why: "It has not been run yet." };
      default:
        return { word: "Unknown", tone: "", why: "" };
    }
  }

  /* deriveWaiting — what only Chris can do, read off the flywheel rows:
     approve a finished step, or redo a failed or stale one. Each row says
     honestly where it is done: the button on this page, or "Not on this page
     yet: it ships in slice N" (design §3.1 and safety rule 9). */
  function deriveWaiting(view) {
    var out = [];
    var stages = arr(view && view.stages);
    stages.forEach(function (s) {
      var name = stageName(s) + " (" + stepWords(s).toLowerCase() + ")";
      var w = stageWord(s, stages);
      if (s.state === "READY" && !s.approved) {
        out.push({
          kind: "approve", key: s.key,
          what: "Read and approve: " + name,
          why: doneSentence(s),
          how: "Read it under Offer and market. Approving: " + notYet(approveSlice(s.key))
        });
      } else if (s.state === "FAILED" || s.state === "STALE") {
        out.push({
          kind: "redo", key: s.key,
          what: "Redo " + name.charAt(0).toLowerCase() + name.slice(1),
          why: w.why,
          how: s.key === "offer"
            ? "Write offer, on the Offer card, makes a new offer. This row clears only when the offer file is redone. Saving the offer file: " + notYet(OFFER_FILE_SLICE)
            : notYet(RUN_SLICE[s.key] || "5")
        });
      }
    });
    return out;
  }

  /* videoWait — the finished videos waiting on Chris, as one Waiting row.
     null when none wait. Approving is not on this page yet (the Videos tab is
     slice 2); the row says where it is done, and when the text's links ran
     out, it says that instead of pointing at a dead link. */
  function videoWait(videos, nowMs) {
    if (!videos || !videos.loaded || !videos.items.length) return null;
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var items = videos.items;
    var ads = [];
    items.forEach(function (v) { if (v.adId && ads.indexOf(v.adId) === -1) ads.push(v.adId); });
    ads.sort(function (a, b) { return Number(a) - Number(b); });
    var since = null;
    var latestExpiry = null;
    var anyLive = false;
    items.forEach(function (v) {
      var s = asDate(v.since);
      if (s && (!since || s < since)) since = s;
      var e = asDate(v.expiresAt);
      if (e) {
        if (e.getTime() > now) anyLive = true;
        if (!latestExpiry || e > latestExpiry) latestExpiry = e;
      }
    });
    var n = items.length;
    var howMany = n + (videos.more ? " or more" : "") + (n === 1 && !videos.more ? " video" : " videos");
    var how;
    var howHtml;
    if (anyLive) {
      how = "Approving is not on this page yet. Use the Approve link in the text we sent you.";
      howHtml = esc(how);
    } else if (latestExpiry) {
      var ranOut = "Approving is not on this page yet, and the approve links in your text ran out on ";
      how = ranOut + dateOf(latestExpiry) + ".";
      howHtml = esc(ranOut) + dateTip(latestExpiry) + ".";
    } else {
      how = "Approving is not on this page yet, and no working approve link was sent for them.";
      howHtml = esc(how);
    }
    var adWords = ads.length ? listWords(ads.map(function (a) { return "Ad " + a; })) + ". " : "";
    return {
      kind: "videos",
      what: "Approve or reject " + howMany,
      why: adWords + (since ? "Waiting since " + dateOf(since) + "." : "Waiting since an unknown day."),
      whyHtml: esc(adWords) + (since ? "Waiting since " + dateTip(since) + "." : "Waiting since an unknown day."),
      how: how,
      howHtml: howHtml
    };
  }

  function waitingFor(view, names) {
    return arr(view && view.partsWaiting).filter(function (w) { return names.indexOf(w.part) !== -1; });
  }

  /* deriveParts — the "What is turned on" card. Each part is Ready, Not ready
     or Unknown; unknown is never counted as ready. */
  function deriveParts(view, nowMs) {
    var v = view || {};
    var r = v.copyReady || {};
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var notLive = "This part is not live yet. It turns on with the next update.";
    var parts = [];

    var meta;
    if (!v.loaded) {
      meta = { ready: null, note: "Not known yet." };
    } else if (v.asOf || v.pulledAt) {
      var fresh = metaFresh(v, now);
      var through = v.spendThrough || v.latestMetricsDate;
      meta = {
        ready: fresh,
        note: "Last saved " + when(pullTime(v), now).text + "." +
          (through ? " Numbers run through " + dayWords(through) + "." : "") +
          (v.latestMetricsDate && through && v.latestMetricsDate < through
            ? " The last day with ad spend was " + dayWords(v.latestMetricsDate) + "." : "") +
          (fresh ? "" : " It should save every day.")
      };
      if (v.spend30 === null && waitingFor(v, ["spend"]).length) meta.note += " No ad numbers are saved yet.";
    } else if (v.syncRead) {
      meta = { ready: false, note: "Meta has never sent numbers for this company." };
    } else {
      meta = { ready: false, note: notLive };
    }
    parts.push({ label: "Ad numbers from Meta", ready: meta.ready, note: meta.note });

    function part(label, value, onNote, offNote) {
      var note = value === true ? onNote : (value === false ? offNote : "Not known yet.");
      if (value === null && v.loaded && waitingFor(v, ["copy", "copy_ready"]).length) note = notLive;
      parts.push({ label: label, ready: value, note: note });
    }
    if (r.house === false) {
      parts.push({ label: "Fundhub house account", ready: false, note: "Missing, so there is no account to write ad copy for." });
    }
    part("Marketing switch for the Fundhub house account", r.switchOn, "On.", "Off, so ad copy cannot be written.");
    part("Copy writer set up", r.provider, "Set up.", "Not set up, so ad copy cannot be written.");
    part("AI key for writing", r.anthropicKey, "Saved.", "Missing, so ad copy cannot be written.");
    part("Writing budget this month", r.budget, "Has room.", "Used up for this month.");

    parts.push(!v.loaded
      ? { label: "Offer and market files", ready: null, note: "Not known yet." }
      : (v.flywheelRead
        ? { label: "Offer and market files", ready: true, note: "Found on the server." }
        : { label: "Offer and market files", ready: false, note: "The offer and market files are not on this server yet." }));
    return parts;
  }

  /* setupBlock — the one sentence that says why "Write ad copy" cannot work
     yet, before it is pressed. Only an explicit "no" counts; unknown is not no. */
  function setupBlock(r) {
    r = r || {};
    var missing = [];
    if (r.house === false) missing.push("the Fundhub house account is missing");
    if (r.switchOn === false) missing.push("marketing is switched off for the Fundhub house account");
    if (r.provider === false) missing.push("no copy writer is set up");
    if (r.anthropicKey === false) missing.push("the AI key is missing");
    if (r.budget === false) missing.push("this month's writing budget is used up");
    if (!missing.length) return null;
    var list = missing.length === 1 ? missing[0]
      : missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1];
    return "This cannot write yet: " + list + ".";
  }

  function setupLine(view) {
    if (!view || !view.loaded) {
      return { bad: true, text: "This needs the marketing numbers to load first, so it knows which account to write for." };
    }
    var block = setupBlock(view.copyReady);
    if (block) return { bad: true, text: block };
    if (!view.partnerId) {
      return { bad: true, text: "The page could not find the Fundhub house account, so it cannot write yet." };
    }
    if (view.copyReady.ready === true) {
      return { bad: false, text: "Ready. It writes one ad and checks it against the ad rules." };
    }
    return { bad: false, text: "It writes one ad and checks it against the ad rules." };
  }

  /* centsWords — "about $0.67", or "under 1 cent" for a run that cost a
     fraction of a cent (a measured 0 would be a lie). */
  function centsWords(cents, underOneCent) {
    if (underOneCent) return "under 1 cent";
    return "about " + money(cents);
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* aboutTime — a measured run's length in rough words: "about 45 seconds",
     "about 1 minute", "about 5 minutes" (4 min 29 s rounds up). */
  function aboutTime(seconds) {
    var s = num(seconds);
    if (s === null) return "unknown";
    var r = Math.round(s);
    if (r < 60) {
      r = Math.max(1, r);
      return "about " + r + (r === 1 ? " second" : " seconds");
    }
    var m = Math.ceil(s / 60);
    return "about " + m + (m === 1 ? " minute" : " minutes");
  }

  /* offerCostLine — under Write offer. Only a measured run (costs.offer, the
     newest finished marketing_jobs offer run) or "unknown". Never a constant.
     Design §6 slice 0: "About 5 minutes. About $0.67, last measured run." */
  function offerCostLine(view) {
    var v = view || {};
    if (!v.loaded) return "Time and cost: unknown. The marketing numbers did not load.";
    var o = v.offerCost;
    if (!o) {
      return v.costsRead
        ? "Time and cost: unknown. The run log could not be read yet."
        : "Time and cost: unknown. This page cannot read run costs yet.";
    }
    if (!o.measured) return "Time and cost: unknown, not measured yet. One run at a time.";
    var last = "(last run" + (o.seconds !== null ? ": " + minutesWords(o.seconds) : "") + ")";
    var priced = o.costCents !== null || o.underOneCent;
    var spent = centsWords(o.costCents, o.underOneCent);
    var noPrice = "Cost unknown: no price is on file for " + (o.unpriced.length ? listWords(o.unpriced) : "its model");
    if (o.seconds !== null) {
      var time = cap(aboutTime(o.seconds));
      return (priced ? time + " and " + spent : time + ". " + noPrice) + " " + last + ". One run at a time.";
    }
    return "Time unknown. " + (priced ? cap(spent) : noPrice) + " " + last + ". One run at a time.";
  }

  /* copySeconds — how long the newest finished copy job took, from its own
     start and finish times (generation_jobs started_at → finished_at), or null
     when no copy job has finished. Measured, never a constant. */
  function copySeconds(view) {
    var jobs = arr(view && view.jobs);
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i].status !== "succeeded") continue;
      var a = asDate(jobs[i].startedAt);
      var b = asDate(jobs[i].finishedAt);
      if (a && b && b.getTime() >= a.getTime()) return Math.round((b.getTime() - a.getTime()) / 1000);
    }
    return null;
  }

  /* copyCostLine — under Write ad copy: its time (the last finished copy
     job), its cost (the copy writer's own last runs), and the house account's
     writing budget as the meter counts it (tokens). Design §5 rule 3: cost
     AND time before the tap. */
  function copyCostLine(view) {
    var v = view || {};
    if (!v.loaded) return "Time and cost: unknown. The marketing numbers did not load.";
    var secs = copySeconds(v);
    var time = secs !== null ? "Time: " + aboutTime(secs) + " (last run)." : "Time: unknown, not measured yet.";
    var c = v.copyCost;
    var cost;
    if (!c) cost = "Cost: unknown. The usage log could not be read yet.";
    else if (!c.runs) cost = "Cost: unknown, not measured yet.";
    else if (c.avgCostCents !== null || c.underOneCent) {
      cost = "Cost: " + centsWords(c.avgCostCents, c.underOneCent) + " a run (average of the last " +
        (c.runs === 1 ? "run" : c.runs + " runs") + ").";
    } else {
      cost = "Cost: unknown. The last " + (c.runs === 1 ? "run" : c.runs + " runs") +
        " used a model with no price on file here" + (c.unpriced.length ? " (" + listWords(c.unpriced) + ")" : "") + ".";
    }
    var r = v.copyReady || {};
    var budget = r.budgetUsed !== null && r.budgetUsed !== undefined && r.budgetCap !== null && r.budgetCap !== undefined
      ? " Writing budget this month: " + count(r.budgetUsed) + " of " + count(r.budgetCap) +
        " tokens used. A token is a small piece of a word."
      : " Writing budget this month: unknown.";
    return time + " " + cost + budget;
  }

  /* offerHonest — the Offer card's sentence while the offer writer does not
     write the stage file (until slice 1): design §3.1. */
  function offerHonest(view, offerRead) {
    if (!offerRead || !offerRead.offer) return "";
    return "The flywheel step and the latest offer are checked two different ways right now. " +
      "The step reads the offer file. Write offer saves its offer on this page, not in that file yet.";
  }

  /* plainError — what failed, in the words of the person it happened to.
     Never a raw status code (UI-STANDARDS §6.3). */
  function plainError(res, what) {
    var body = obj(res && res.body);
    var err = str(body.error);
    if (res && res.timedOut) return "The server took too long to answer. Try again in a minute.";
    if (!res || res.transport || res.status === 0) {
      return "Could not reach the server. Check your connection and try again.";
    }
    if (res.status === 401 || err === "unauthorized") return "You are signed out. Sign in and open this page again.";
    if (err === "suite_off") return "Marketing is switched off for the Fundhub house account, so nothing was written.";
    if (res.status === 403) return "Your account is not allowed to do this. Only the owner and admins can.";
    if (res.status === 404) {
      if (what === "offer") return "The offer writer is not ready yet. It turns on with the next update.";
      if (what === "today") return "The marketing numbers are not ready yet. This page fills in after the next update.";
      return "That is not there yet. It turns on with the next update.";
    }
    if (err === "partner_id_required") return "The page could not find the Fundhub house account, so nothing was sent.";
    if (err === "offer_type_required" || err === "offer_type_invalid") return "Pick what we are selling first.";
    if (err === "idempotency_key_required") return "The request was not complete, so nothing was sent. Reload the page and try again.";
    if (res.status === 502 || res.status === 504) {
      return "The server took too long to answer. It may still be working. Check back in a minute.";
    }
    if (res.status === 503) return "The database is not reachable right now. Try again in a moment.";
    if (what === "today") return "The marketing numbers could not load. Try again in a minute.";
    return "That did not work, and nothing changed. Try again in a moment.";
  }

  /* refreshBanner — a reload that failed after a good load keeps the page
     painted and says so (design §3.1: "This page shows the last load from
     3:02 PM."), instead of blanking every number. */
  function refreshBanner(res, lastLoadedMs) {
    var at = clockOf(new Date(lastLoadedMs));
    if (res && res.timedOut) return "The server took too long to answer. This page shows the last load from " + at + ".";
    if (!res || res.transport || res.status === 0) return "No connection. This page shows the last load from " + at + ".";
    if (res.status === 401) return "You are signed out. Sign in and open this page again.";
    return "The marketing numbers did not refresh. This page shows the last load from " + at + ".";
  }

  /* serverWords — the offer writer (M12) answers every refusal with a
     `message` written for this page, in plain words. Use it — except for
     signed-out and not-allowed, which this page words itself. */
  function serverWords(res) {
    if (!res || res.status === 401 || res.status === 403) return "";
    var m = str(obj(res.body).message).trim();
    return m;
  }

  /* jobReason — the reason a copy job recorded, in plain words. Only reasons
     we can say for sure are translated; anything else points to where the
     full reason is kept. */
  function jobReason(error) {
    var t = str(error);
    if (!t) return "";
    if (/no active provider configured/i.test(t)) return "No copy writer is switched on for this account.";
    if (/has no module/i.test(t)) return "The copy writer on file is one this system does not know how to use.";
    if (/ANTHROPIC_API_KEY is not set/i.test(t)) return "The AI key is missing.";
    if (/marketing suite is off/i.test(t)) return "Marketing is switched off for the Fundhub house account.";
    if (/writing budget/i.test(t)) return "This month's writing budget is used up.";
    if (/returned zero assets|returned no text|no usable variants/i.test(t)) return "The writer answered, but sent nothing back.";
    if (/quota|credit|billing/i.test(t)) return "The AI account is out of credit.";
    return "The full reason is saved on the job in Creative Factory.";
  }

  /* ── Write ad copy ───────────────────────────────────────────────────── */

  /* One press runs, and pays for, at most one job (api/creative/run.mjs
     maxJobsFrom honours it exactly). */
  var COPY_MAX_JOBS = 1;

  function newKey(nowMs, rand) {
    var stamp = new Date(typeof nowMs === "number" ? nowMs : Date.now())
      .toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    var tail = String(typeof rand === "number" ? rand : Math.random()).replace(/\D/g, "").slice(-6) || "000000";
    return "mcc-copy-" + stamp + "-" + tail;
  }

  /* checkCopyInput — stop before anything is sent, with one plain question. */
  function checkCopyInput(view, angle, offerType) {
    if (!view || !view.loaded) return "The marketing numbers have not loaded yet, so nothing was sent. Reload the page and try again.";
    var block = setupBlock(view.copyReady);
    if (block) return block;
    if (!view.partnerId) return "The page could not find the Fundhub house account, so nothing was sent.";
    if (!str(angle).trim()) return "Write a few words about what this ad is about first.";
    if (OFFER_TYPES.indexOf(offerType) === -1) return "Pick what we are selling first.";
    return null;
  }

  /* copyRequest — the body POST /api/creative/generate expects
     (api/creative/generate.mjs). offerType and assetKind ride INSIDE spec:
     the endpoint stores spec on the job and the runner and the ad-rules check
     read them from there (creative-factory.html does the same). */
  function copyRequest(partnerId, angle, offerType, key) {
    var prompt = str(angle).trim();
    return {
      partner_id: partnerId,
      asset_kind: "copy",
      idempotency_key: key,
      prompt: prompt,
      spec: { prompt: prompt, formats: ["1x1"], variants: 1, assetKind: "copy", offerType: offerType }
    };
  }

  /* summarizeRun — what POST /api/creative/run did with OUR job. */
  function summarizeRun(runRes, jobId) {
    var still = "It is still writing. Your new copy shows under Latest ad copy in a minute or two.";
    if (!runRes || runRes.transport || runRes.status === 0 || runRes.status === 502 || runRes.status === 504) {
      return { tone: "wait", message: still, pieces: [] };
    }
    var body = obj(runRes.body);
    if (runRes.status !== 200 || body.ok === false) {
      return { tone: "err", message: plainError(runRes, "copy"), pieces: [] };
    }
    var jobs = arr(body.jobs);
    var mine = null;
    for (var i = 0; i < jobs.length; i++) {
      if (jobId != null && str(obj(jobs[i]).job_id || obj(jobs[i]).id) === str(jobId)) { mine = jobs[i]; break; }
    }
    if (!mine) {
      return {
        tone: "wait",
        message: "It is saved and waiting in line. The background writer picks it up within a few minutes. It shows under Latest ad copy when it is done.",
        pieces: []
      };
    }
    var status = str(mine.status).toLowerCase();
    if (status === "succeeded") {
      var pieces = arr(mine.assets).map(normalizePiece);
      var stopped = pieces.filter(function (p) { return p.state === "blocked"; }).length;
      if (!pieces.length) return { tone: "wait", message: still, pieces: [] };
      return {
        tone: stopped ? "wait" : "ok",
        message: stopped
          ? "Done, but the ad rules check stopped it. The reasons are below."
          : "Done. Here is your new ad copy. It passed the ad rules check.",
        pieces: pieces
      };
    }
    var why = jobReason(mine.error);
    if (status === "failed") {
      return { tone: "err", message: "It did not work, and nothing was made." + (why ? " " + why : ""), pieces: [] };
    }
    if (status === "queued") {
      return { tone: "wait", message: "It did not finish this time. It will try again in a few minutes." + (why ? " " + why : ""), pieces: [] };
    }
    return { tone: "wait", message: still, pieces: [] };
  }

  /* writeAdCopy — generate, then run. deps.api(path, init) answers
     { status, body, transport }. Resolves to { tone, message, pieces, sent }. */
  function writeAdCopy(deps, view, angle, offerType) {
    var stop = checkCopyInput(view, angle, offerType);
    if (stop) return Promise.resolve({ tone: "err", message: stop, pieces: [], sent: false });
    var key = newKey(deps.now ? deps.now() : Date.now(), deps.rand ? deps.rand() : Math.random());
    var body = copyRequest(view.partnerId, angle, offerType, key);
    return deps.api("/api/creative/generate", { method: "POST", body: body }).then(function (gen) {
      var g = obj(gen && gen.body);
      if (!gen || gen.status !== 200 || g.ok === false) {
        return { tone: "err", message: plainError(gen, "copy"), pieces: [], sent: true };
      }
      if (g.created === false) {
        return { tone: "wait", message: "That one was already sent, so nothing new was added.", pieces: [], sent: true };
      }
      /* The server checks, with the runner's own lookup, whether a copy writer
         is switched on. When it says no, running the job would only record a
         failure, so stop here and say why. */
      if (g.provider_ready === false) {
        return { tone: "err", message: "It was saved, but no copy writer is switched on for this account, so it cannot be written yet.", pieces: [], sent: true };
      }
      var jobId = obj(g.job).id;
      return deps.api("/api/creative/run", {
        method: "POST",
        body: { partner_id: view.partnerId, max_jobs: COPY_MAX_JOBS }
      }).then(function (run) {
        var out = summarizeRun(run, jobId);
        out.sent = true;
        return out;
      });
    });
  }

  /* ── Write offer (M12: api/marketing/offer/generate) ─────────────────── */

  var OFFER_PATH = "/api/marketing/offer/generate";
  var NOT_READY = "The offer writer is not ready yet. It turns on with the next update.";

  /* summarizeOfferRead — GET: the newest run and offer, or one run by id. */
  function summarizeOfferRead(res) {
    if (!res || res.transport || res.status === 0) return { state: "error", message: plainError(res, "offer"), job: null, offer: null };
    var b = obj(res.body);
    /* The router's own 404 for a route that is not deployed carries `path`
       (netlify/functions/api.mjs). A 404 without it is M12 saying one run id
       is not on file. */
    if (res.status === 404) {
      return Object.prototype.hasOwnProperty.call(b, "path") || !b.error
        ? { state: "notReady", message: NOT_READY, job: null, offer: null }
        : { state: "error", message: "That offer run is not on file any more. Reload the page.", job: null, offer: null };
    }
    if (res.status !== 200 || b.ok === false) {
      return { state: "error", message: serverWords(res) || plainError(res, "offer"), job: null, offer: null };
    }
    if (b.ready === false) return { state: "notReady", message: str(b.message) || NOT_READY, job: null, offer: null };
    return { state: "ok", message: "", job: normalizeOfferJob(first(b, ["job"])), offer: normalizeOffer(first(b, ["offer"])) };
  }

  /* summarizeOfferStart — POST: a run was started (202), joined (already
     running), or refused with a reason. */
  function summarizeOfferStart(res) {
    if (!res || res.transport || res.status === 0) return { tone: "err", message: plainError(res, "offer"), job: null };
    if (res.status === 404) return { tone: "wait", message: NOT_READY, job: null, notReady: true };
    var b = obj(res.body);
    if ((res.status === 200 || res.status === 202) && b.ok !== false) {
      var job = normalizeOfferJob(first(b, ["job"]));
      var msg = str(b.message) || (b.already_running
        ? "An offer is already being written. This page shows it when it is done."
        : "Writing the offer. This takes a few minutes.");
      return { tone: "wait", message: msg, job: job };
    }
    if (res.status === 503 && str(b.error) === "not_ready") {
      return { tone: "wait", message: str(b.message) || NOT_READY, job: null, notReady: true };
    }
    return { tone: "err", message: serverWords(res) || plainError(res, "offer"), job: normalizeOfferJob(first(b, ["job"])) };
  }

  /* offerJobLine — one sentence about the newest run. */
  function offerJobLine(job, nowMs) {
    if (!job) return "";
    if (job.status === "queued") return "An offer is waiting to start (asked " + when(job.createdAt, nowMs).text + ").";
    if (job.status === "running") return "An offer is being written now (started " + when(job.createdAt, nowMs).text + ").";
    if (job.status === "failed") return "The last try did not work." + (job.error ? " " + job.error : "");
    return "";
  }

  function startOffer(deps, view) {
    var body = { campaign: (view && view.campaign) || "partner" };
    return deps.api(OFFER_PATH, { method: "POST", body: body }).then(summarizeOfferStart);
  }

  function readOffer(deps, jobId) {
    var p = jobId ? OFFER_PATH + "?id=" + encodeURIComponent(jobId) : OFFER_PATH;
    return deps.api(p).then(summarizeOfferRead);
  }

  /* offerPollStep — one look at a running offer: keep asking, or stop. */
  function offerPollStep(read) {
    if (read.state === "notReady") return { done: true, tone: "wait", message: read.message };
    if (read.state === "error") return { done: false, tone: "wait", message: "" };
    var job = read.job;
    if (job && job.status === "done") {
      return read.offer
        ? { done: true, tone: "ok", message: "Done. Here is the new offer.", offer: read.offer }
        : { done: true, tone: "err", message: "The offer writer finished but sent no offer back." };
    }
    if (job && job.status === "failed") {
      return { done: true, tone: "err", message: "The offer did not get written." + (job.error ? " " + job.error : "") };
    }
    return { done: false, tone: "wait", message: "" };
  }

  /* ── markup (pure: data in, HTML string out) ─────────────────────────── */

  function chip(word, tone) {
    return '<span class="chip' + (tone ? " " + tone : "") + '"><span class="cd"></span>' + esc(word) + "</span>";
  }

  function timeTag(iso, nowMs) {
    var w = when(iso, nowMs);
    return '<span title="' + esc(w.title) + '">' + esc(w.text) + "</span>";
  }

  /* toggle — a button that shows and hides one block in place. Long text
     folds behind it instead of sitting in an inner scroll box (design §3.0,
     UI-STANDARDS §11). The page wires every [data-toggle] once. `swapId`, when
     given, is a short version shown while the block is closed. */
  function toggle(id, closedLabel, openLabel, swapId) {
    return '<button class="btn quiet" type="button" data-toggle="' + esc(id) + '" aria-controls="' + esc(id) +
      '" aria-expanded="false" data-closed="' + esc(closedLabel) + '" data-open="' + esc(openLabel) + '"' +
      (swapId ? ' data-swap="' + esc(swapId) + '"' : "") + ">" + esc(closedLabel) + "</button>";
  }

  function coverage(days, of) {
    var d = num(days);
    return d !== null && d < of && d > 0 ? " Numbers saved for " + d + " of " + of + " days." : "";
  }

  /* rangeNote — the window's whole days. A window the Meta pull covered
     that holds no saved spend says so in words (ads stopped), never $0. */
  function rangeNote(range, spend) {
    if (!range) return "";
    return esc(num(spend) === null ? "No ad spend saved for " + range + "." : range + ".") + " ";
  }

  function renderSpendTile(view, which, nowMs) {
    var v = view || {};
    /* "Old numbers" leads the row once: on its first tile, top-left. */
    var lead = which === 7 ? oldLeadHtml(v, nowMs) : "";
    var leadHtml = lead ? '<span class="note lead">' + lead + "</span>" : "";
    if (which === 7) {
      var r7 = v.spendThrough ? rangeWords(v.from7, v.to7) : "";
      return leadHtml + '<span class="caption">Ad spend, all accounts, last 7 days</span>' +
        '<span class="vl">' + esc(money(v.spend7)) + "</span>" +
        '<span class="cmp">' + esc(compare(v.spend7, v.spendPrev7, "7 days") + coverage(v.days7, 7)) + "</span>" +
        '<span class="note">' + rangeNote(r7, v.spend7) +
        '<a href="campaign-manager.html">See every ad in Campaigns</a></span>';
    }
    var r30 = v.spendThrough ? rangeWords(v.from30, v.to30) : "";
    return leadHtml + '<span class="caption">Ad spend, all accounts, last 30 days</span>' +
      '<span class="vl">' + esc(money(v.spend30)) + "</span>" +
      '<span class="cmp">' + esc(compare(v.spend30, v.spendPrev30, "30 days") + coverage(v.days30, 30)) + "</span>" +
      '<span class="note">' + rangeNote(r30, v.spend30) + esc(todayWords(v, nowMs)) + "</span>";
  }

  function renderPartsTile(view, nowMs) {
    var parts = deriveParts(view, nowMs);
    var known = parts.filter(function (p) { return p.ready !== null; });
    var ready = parts.filter(function (p) { return p.ready === true; });
    var notReady = parts.filter(function (p) { return p.ready === false; }).map(function (p) { return p.label; });
    var value = known.length ? ready.length + " of " + parts.length : "unknown";
    var cmp;
    if (!known.length) cmp = "Not known yet.";
    else if (notReady.length) cmp = "Not ready: " + notReady.join("; ") + ".";
    else if (known.length < parts.length) cmp = "The rest are not known yet.";
    else cmp = "Every part is ready.";
    return '<span class="caption">What is turned on</span>' +
      '<span class="vl">' + esc(value) + "</span>" +
      '<span class="cmp">' + esc(cmp) + "</span>";
  }

  function notLoaded() {
    return '<p class="muted">Not loaded. The note at the top of the page says why.</p>';
  }

  /* waitRow — one thing only Chris can do. `actHtml` (U37) is its one
     working control (Open Scripts, Retry); `say` is the answer to a tap. */
  function waitRow(w) {
    return '<li class="row" data-wait="' + esc(w.kind) + '"' + (w.job ? ' data-job-row="' + esc(w.job) + '"' : "") + ">" +
      '<div class="row-main"><b>' + esc(w.what) + "</b>" +
      (w.why || w.whyHtml ? '<div class="row-why">' + (w.whyHtml || esc(w.why)) + "</div>" : "") +
      (w.how || w.howHtml ? '<div class="row-why">' + (w.howHtml || esc(w.how)) + "</div>" : "") +
      (w.actHtml ? '<div class="row-act">' + w.actHtml + "</div>" : "") +
      (w.say && w.say.text ? '<div class="say show ' + esc(w.say.tone || "wait") + '" role="status">' + esc(w.say.text) + "</div>" : "") +
      "</div></li>";
  }

  /* waitingList — the rows: scripts to approve first (the weekly job), then
     the videos (they have waited longest), then stuck machine steps with
     Retry (U37), then the flywheel rows. `ui` is the page's memory of Retry
     taps; the vm tests leave it out. */
  function waitingList(view, videos, nowMs, ui) {
    var out = [];
    var s = view && view.loaded ? scriptsWait(view) : null;
    if (s) out.push(s);
    var v = videoWait(videos, nowMs);
    if (v) out.push(v);
    if (view && view.loaded) out = out.concat(stuckWaits(view, ui, nowMs));
    return out.concat(view && view.loaded ? deriveWaiting(view) : []);
  }

  function renderWaiting(view, videos, nowMs, ui) {
    if (!view || !view.loaded) return notLoaded();
    var list = waitingList(view, videos, nowMs, ui);
    var videoErr = videos && videos.loaded === false && videos.tried
      ? '<p class="caption muted gap-top">The video list did not load. The rest of this page is current.</p>'
      : "";
    if (!list.length) return '<p class="muted">Nothing is waiting on you right now.</p>' + videoErr;
    return '<ol class="rows">' + list.map(waitRow).join("") + "</ol>" + videoErr;
  }

  /* reviewCardHtml — the "## Review card" markdown as plain paragraphs.
     Bold labels stay bold. The card's "Say one of:" line is a chat
     instruction, and nothing on this page sends Chris to chat (design §3.9),
     so that line becomes the honest sentence for where Approve and Tweak land
     (`slice`; slice 5 when not given). */
  var SAY_LABEL = "Approve or tweak:";
  function reviewCardHtml(md, slice) {
    var blocks = str(md).replace(/\r/g, "").split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean);
    return blocks.map(function (b) {
      var text = b.replace(/\\([<>\\*_])/g, "$1");
      var label = /^\*\*([^*]+?)\*\*\s*/.exec(text);
      var rest = label ? text.slice(label[0].length) : text;
      var name = label ? label[1] : "";
      if (/^say one of:?$/i.test(name.trim()) || (!label && /^Say one of:\s*/i.test(rest))) {
        name = SAY_LABEL;
        rest = notYet(slice || "5");
      }
      rest = rest.replace(/\*\*/g, "");
      return "<p>" + (name ? "<b>" + esc(name) + "</b> " : "") + esc(rest) + "</p>";
    }).join("");
  }

  function stageRows(stages, campaign) {
    return '<ol class="rows">' + stages.map(function (s) {
      var w = stageWord(s, stages);
      var id = "rc-" + str(campaign || "c").replace(/[^a-z0-9-]/gi, "") + "-" + s.key;
      var read = s.reviewCard
        ? toggle(id, "Read it", "Hide it") + '<div class="review" id="' + esc(id) + '" hidden>' + reviewCardHtml(s.reviewCard, approveSlice(s.key)) + "</div>"
        : '<button class="btn quiet" type="button" disabled>Read it</button>' +
          '<span class="caption muted">Nothing to read yet: ' + (s.state === "MISSING" ? "this step has not been run." : "this step has no review card.") + "</span>";
      return '<li class="row" data-stage="' + esc(s.key) + '">' +
        '<div class="row-main"><b>' + esc(stageName(s)) + '</b> <span class="caption faint step">' + esc(stepWords(s)) + "</span></div>" +
        chip(w.word, w.tone) +
        '<div class="row-body">' +
          (w.why ? '<div class="row-why">' + esc(w.why) + "</div>" : "") +
          (STAGE_RUNS[s.key] ? '<div class="row-why">' + esc(STAGE_RUNS[s.key]) + "</div>" : "") +
          '<div class="row-act">' + read + "</div>" +
        "</div></li>";
    }).join("") + "</ol>";
  }

  function renderFlywheel(view) {
    if (!view || !view.loaded) return notLoaded();
    if (!view.flywheelRead) return '<p class="muted">The offer and market files are not on this server yet, so the steps cannot be shown.</p>';
    var withRows = view.campaigns.filter(function (c) { return c.stages.length; });
    if (!withRows.length) return '<p class="muted">No steps are on file yet.</p>';
    return withRows.map(function (c) {
      return (withRows.length > 1 ? '<p class="caption sub-hd">' + esc(campaignWords(c.campaign)) + "</p>" : "") +
        stageRows(c.stages, c.campaign) +
        (c.advice ? '<p class="caption muted gap-top">' + esc(plainReasons([adviceWords(c.advice)])) + "</p>" : "");
    }).join("");
  }

  function offerStage(view) {
    var stages = arr(view && view.stages);
    for (var i = 0; i < stages.length; i++) if (stages[i].key === "offer") return stages[i];
    return null;
  }

  function renderOfferStatus(view) {
    if (!view || !view.loaded) return notLoaded();
    var s = offerStage(view);
    if (!s) return '<p class="muted">The offer step: unknown. No row for it is on file.</p>';
    var w = stageWord(s, view.stages);
    return '<div class="row solo"><div class="row-main"><b>' + esc(stageName(s)) + '</b> <span class="caption faint step">' +
      esc(stepWords(s)) + "</span></div>" + chip(w.word, w.tone) +
      (w.why ? '<div class="row-body"><div class="row-why">' + esc(w.why) + "</div></div>" : "") + "</div>";
  }

  function list(items) {
    return items.length ? '<ul class="bullets">' + items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "";
  }

  /* renderOffer — the review card first, then the offer's name and price, then
     the whole offer behind Show more (design §3.2; M12's contract,
     docs/specs/marketing-offer-contract.md, "What the Offer card should show
     first"). No inner scroll box. */
  function renderOffer(offer, nowMs) {
    if (!offer) return "";
    var rest = (offer.sentence ? "<p>" + esc(offer.sentence) + "</p>" : "") +
      (offer.whatTheyGet.length ? '<p class="caption sub-hd">What they get</p>' + list(offer.whatTheyGet) : "") +
      (offer.guarantees.length ? '<p class="caption sub-hd">Guarantee</p>' + list(offer.guarantees) : "") +
      (offer.bonuses.length ? '<p class="caption sub-hd">Bonuses</p>' + list(offer.bonuses) : "");
    return '<div class="offer-body">' +
      '<div class="piece-hd"><b>Latest offer</b>' +
      (offer.finishedAt ? '<span class="caption faint">Written ' + timeTag(offer.finishedAt, nowMs) + "</span>" : "") + "</div>" +
      (offer.decided ? '<p class="caption sub-hd">What this decided</p><p>' + esc(offer.decided) + "</p>" : "") +
      (offer.toCheck.length ? '<p class="caption sub-hd">Check these</p>' + list(offer.toCheck) : "") +
      (offer.notSure.length ? '<p class="caption sub-hd">Not sure about</p>' + list(offer.notSure) : "") +
      '<p class="gap-top"><b>' + esc(offer.name || "Unnamed offer") + "</b>" +
      (offer.price ? " · " + esc(offer.price) : "") + "</p>" +
      (rest
        ? '<div class="row-act">' + toggle("offerMore", "Show more", "Show less") + "</div>" +
          '<div class="offer-more" id="offerMore" hidden>' + rest + "</div>"
        : "") +
      "</div>";
  }

  /* renderOfferLatest — what GET marketing/offer/generate said on load. */
  function renderOfferLatest(read, nowMs) {
    if (!read) return '<p class="muted">Checking for a saved offer…</p>';
    if (read.state === "notReady" || read.state === "error") return '<p class="muted">' + esc(read.message) + "</p>";
    var line = offerJobLine(read.job, nowMs);
    var html = line ? '<p class="row-why">' + esc(line) + "</p>" : "";
    if (!read.offer) return html + '<p class="muted">No offer has been written here yet.</p>';
    return html + renderOffer(read.offer, nowMs);
  }

  var SCREEN_WORDS = { passed: "Passed the ad rules", blocked: "Stopped by the ad rules", pending: "Being checked" };

  /* foldText — the head of a long piece, or null when it is short enough to
     show whole. */
  function foldText(text) {
    var t = str(text);
    var lines = t.split("\n");
    if (lines.length <= FOLD_LINES && t.length <= FOLD_CHARS) return null;
    var head = lines.slice(0, FOLD_LINES).join("\n");
    if (head.length > FOLD_CHARS) head = head.slice(0, FOLD_CHARS);
    return head.replace(/\s+$/, "") + "…";
  }

  function renderPieces(pieces, nowMs, prefix) {
    if (!pieces || !pieces.length) return "";
    var pre = str(prefix || "piece").replace(/[^a-z0-9-]/gi, "");
    return '<div class="pieces">' + pieces.map(function (p, i) {
      var tone = p.state === "passed" ? "on" : (p.state === "blocked" ? "bad" : "wip");
      var head = p.text ? foldText(p.text) : null;
      var id = pre + "-" + i;
      var words = !p.text
        ? '<p class="muted">No words were saved with this one.</p>'
        : (head
          ? '<div class="words" id="' + esc(id) + '-short">' + esc(head) + "</div>" +
            '<div class="words" id="' + esc(id) + '" hidden>' + esc(p.text) + "</div>" +
            '<div class="row-act">' + toggle(id, "Show more", "Show less", id + "-short") + "</div>"
          : '<div class="words">' + esc(p.text) + "</div>");
      return '<div class="piece">' +
        '<div class="piece-hd">' + chip(SCREEN_WORDS[p.state] || "Unknown", tone) +
        (p.createdAt ? '<span class="caption faint">' + timeTag(p.createdAt, nowMs) + "</span>" : "") + "</div>" +
        words +
        (p.state === "blocked" && p.reasons.length
          ? '<ul class="reasons">' + p.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>"
          : "") +
        "</div>";
    }).join("") + "</div>";
  }

  var JOB_WORDS = { succeeded: "Worked", failed: "Did not work", queued: "Waiting", running: "Writing now" };

  function renderLatest(view, nowMs) {
    if (!view || !view.loaded) return notLoaded();
    var html = "";
    if (!view.pieces.length) {
      html += '<p class="muted">No ad copy yet. Press Write ad copy to make the first one.</p>';
    } else {
      html += renderPieces(view.pieces.slice(0, 10), nowMs, "latest");
    }
    if (view.jobs.length) {
      html += '<p class="caption sub-hd">Last tries</p><ol class="rows">' + view.jobs.slice(0, 5).map(function (j) {
        var tone = j.status === "succeeded" ? "on" : (j.status === "failed" ? "bad" : "wip");
        var why = j.status === "failed" ? jobReason(j.error) : "";
        return '<li class="row"><div class="row-main">' + timeTag(j.createdAt, nowMs) +
          (why ? '<div class="row-why">' + esc(why) + "</div>" : "") + "</div>" +
          chip(JOB_WORDS[j.status] || "Unknown", tone) + "</li>";
      }).join("") + "</ol>";
    }
    return html;
  }

  function renderParts(view, nowMs) {
    var parts = deriveParts(view, nowMs);
    return '<ol class="rows">' + parts.map(function (p) {
      var word = p.ready === true ? "Ready" : (p.ready === false ? "Not ready" : "Unknown");
      var tone = p.ready === true ? "on" : (p.ready === false ? "bad" : "");
      return '<li class="row"><div class="row-main"><b>' + esc(p.label) + "</b>" +
        (p.note ? '<div class="row-why">' + esc(p.note) + "</div>" : "") + "</div>" + chip(word, tone) + "</li>";
    }).join("") + "</ol>";
  }

  /* ══ U37: the next drop, the machine, the numbers, stuck work ═══════════
     Plan unit U37 (spec §8.3 Today, §11.3, §7.5 step 7; design §3.1).
     Four more reads, each its own part of the page, each failing on its own
     ("The rest of this page is current"):
       GET  marketing/batches/next  the next drop: time, count, split, the
                                    planner's 3 angle suggestions (U23)
       GET  marketing/batches       batch history and write_now_ready (U26)
       GET  marketing/health        clock, worker, repo saves, last sync,
                                    model spend against the caps (U22)
       GET  marketing/today         numbers, daily, spend_by_funnel, flow,
                                    scripts_waiting, stuck_jobs (U32; already
                                    read above)
     Three taps, each answering in plain words where Chris is looking:
       Write now        POST marketing/batches/write-now {request_id, count}
                        after the frame's cost sheet (design §5 rule 3).
                        Drawn ONLY while write_now_ready is true; then it is
                        Today's one filled button and Write ad copy turns
                        into an outline button that still works.
       Use this angle   POST marketing/ideas {request_id, angle_key,
                        raw_points: the suggestion's why, source:'suggestion'}
                        (spec §7.5 step 7: accepting a suggestion makes an
                        idea). Free.
       Retry            POST marketing/jobs/retry {request_id, job_id}, one
                        per stuck job. Free.
     Charts are drawn by hand (spec §4 trap 15): an inline <svg> polyline, a
     bar made of two <span>s. No chart library, no canvas. */

  /* The worker's job kinds (src/marketing/job-kinds.mjs, plus the batch
     kinds U35 adds), in words. A kind not here is "a machine step": the page
     never prints a code name. */
  var KIND_WORDS = {
    write_slot: "writing one script",
    fix_script: "fixing a script",
    start_batch: "starting a batch of scripts",
    finish_batch: "finishing a batch of scripts",
    release_batch: "sending out a batch of scripts",
    expire_drafts: "clearing old drafts",
    voice_export: "saving your voice edits",
    nightly_script_check: "the nightly script check",
    funnel: "building a funnel",
    funnel_push: "putting a funnel live",
    avatar: "building the avatar",
    flywheel_stage: "a flywheel step",
    deep_research: "deep research",
    meta_load: "loading an ad into Meta (paused)",
    meta_video_poll: "waiting on a video at Meta"
  };
  function kindWords(kind) {
    return Object.prototype.hasOwnProperty.call(KIND_WORDS, kind) ? KIND_WORDS[kind] : "a machine step";
  }

  /* The clock ticks every 15 minutes (netlify/functions/marketing-clock.mjs,
     SWEEP_CRON "*\/15 * * * *"). Two missed ticks and it reads "Late". */
  var CLOCK_LATE_MS = 30 * 60 * 1000;
  /* After Write now, GET marketing/batches is read again every 20 seconds
     while that batch is waiting or writing and the page is in view, for at
     most 10 minutes. Then the 5-minute reload carries on. */
  var BATCH_POLL_MS = 20 * 1000;
  var BATCH_POLL_TRIES = 30;
  /* How many scripts Write now may ask for from this page. The server takes
     any whole number of 1 or more; the default is the design's 3. */
  var WRITE_NOW_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  var WRITE_NOW_DEFAULT = 3;
  /* The filled-button class. Today has exactly one filled button at a time
     (UI-STANDARDS §1): Write ad copy (in TODAY_HTML) until write_now_ready,
     then Write now. placePrimary() moves the class when Write now is drawn. */
  var PRIMARY = "primary";

  /* partState — one read's answer: "ok", "missing" (the route or its table
     is not on this server yet) or "error". `key` is the key a real answer
     always carries; a 200 without it is a server that does not have the
     route yet. */
  function partState(res, key) {
    if (!res || res.transport || res.timedOut || res.status === 0) return "error";
    var b = obj(res.body);
    if (res.status === 404) return "missing";
    if (res.status === 503 && b.error === "not_ready") return "missing";
    if (res.status !== 200 || b.ok === false) return "error";
    return Object.prototype.hasOwnProperty.call(b, key) ? "ok" : "missing";
  }

  /* partError — a read that failed, as one sentence. The rest of the page
     stays painted (design §3.1: "one banner per part that failed"). */
  function partError(res, name) {
    if (res && res.status === 401) return "You are signed out. Sign in and open this page again.";
    if (res && res.status === 403) return "Only the owner or an admin can see " + name + ".";
    if (res && res.timedOut) return cap(name) + " took too long to load. The rest of this page is current. It tries again in 5 minutes.";
    if (!res || res.transport || res.status === 0) return "No connection, so " + name + " did not load. The rest of this page is current.";
    return cap(name) + " did not load. The rest of this page is current. It tries again in 5 minutes.";
  }

  function partMissing(name) {
    return cap(name) + " is not on this server yet. It turns on with the next update.";
  }

  /* normalizeHealth — GET marketing/health (U22, contract shape 6). */
  function normalizeHealth(res) {
    var state = partState(res, "clock");
    var out = { state: state, message: state === "error" ? partError(res, "the machine's health") : (state === "missing" ? partMissing("The machine's health") : "") };
    if (state !== "ok") return out;
    var b = obj(res.body);
    var c = obj(first(b, ["clock"]));
    var w = obj(first(b, ["worker"]));
    var o = obj(first(b, ["outbox"]));
    var s = obj(first(b, ["sync"]));
    var m = obj(first(b, ["model"]));
    out.clock = { lastTickAt: first(c, ["last_tick_at"]) || null, enabled: bool(first(c, ["enabled"])) };
    out.worker = {
      lastRunAt: first(w, ["last_run_at"]) || null,
      queued: num(first(w, ["queued"])),
      running: num(first(w, ["running"])),
      failed: arr(first(w, ["failed_24h"])).map(function (f) {
        f = obj(f);
        return { kind: str(first(f, ["kind"])), error: str(first(f, ["error"])), at: first(f, ["at"]) || null };
      })
    };
    out.outbox = {
      waiting: num(first(o, ["waiting"])),
      oldestAt: first(o, ["oldest_waiting_at"]) || null,
      lastSha: str(first(o, ["last_commit_sha"])) || null,
      lastCommitAt: first(o, ["last_commit_at"]) || null,
      lastError: str(first(o, ["last_error"])) || null,
      tokenPresent: bool(first(o, ["token_present"])),
      held: str(first(o, ["held_reason"])) || null
    };
    out.syncAt = first(s, ["last_sync_at"]) || null;
    out.model = {
      monthUsd: num(first(m, ["month_cost_usd"])),
      monthCapUsd: num(first(m, ["max_month_cost_usd"])),
      lastBatchUsd: num(first(m, ["last_batch_cost_usd"])),
      batchCapUsd: num(first(m, ["max_batch_cost_usd"]))
    };
    out.asOf = first(b, ["as_of"]) || null;
    return out;
  }

  /* normalizeNext — GET marketing/batches/next (U23, contract shape 5). */
  function normalizeNext(res) {
    var state = partState(res, "next");
    var out = { state: state, message: state === "error" ? partError(res, "the next drop") : (state === "missing" ? partMissing("The next drop") : ""), next: null, saved: null };
    if (state !== "ok") return out;
    var b = obj(res.body);
    var n = obj(first(b, ["next"]));
    var overrides = first(n, ["overrides"]);
    out.next = {
      releaseAt: first(n, ["release_at"]) || null,
      weekKey: str(first(n, ["week_key"])),
      enabled: bool(first(n, ["enabled"])),
      total: num(first(n, ["total"])),
      sizeRule: str(first(n, ["size_rule"])),
      funnels: arr(first(n, ["funnels"])).map(function (f) {
        f = obj(f);
        return {
          key: str(first(f, ["funnel_key"])), name: str(first(f, ["name"])),
          spend7: num(first(f, ["spend_7d_cents"])), share: num(first(f, ["share"])), slots: num(first(f, ["slots"]))
        };
      }),
      suggestions: arr(first(n, ["suggestions"])).map(function (s) {
        s = obj(s);
        var nums = obj(first(s, ["numbers"]));
        return {
          angleKey: str(first(s, ["angle_key"])), name: str(first(s, ["name"])), why: str(first(s, ["why"])),
          lastRanOn: first(s, ["last_ran_on"]) || null,
          spend7: num(first(nums, ["spend_7d_cents"])), leads: num(first(nums, ["leads"])), cpl: num(first(nums, ["cpl_cents"]))
        };
      }),
      unmapped: num(first(n, ["unmapped_spend_cents"])),
      hasOverrides: overrides != null && typeof overrides === "object" && Object.keys(overrides).length > 0
    };
    var saved = first(b, ["saved"]);
    out.saved = saved && typeof saved === "object" ? { batchId: first(saved, ["batch_id"]) || null, status: str(first(saved, ["status"])) } : null;
    return out;
  }

  /* normalizeBatches — GET marketing/batches (U26, contract shape 4).
     write_now_ready is true only once the start_batch job kind is
     registered (U35). Anything but an explicit true keeps Write now off
     the page: no dead button (UI-STANDARDS §5). */
  function normalizeBatches(res) {
    var state = partState(res, "batches");
    var out = { state: state, ready: false, batches: [] };
    if (state !== "ok") return out;
    var b = obj(res.body);
    out.ready = first(b, ["write_now_ready"]) === true;
    out.batches = arr(first(b, ["batches"])).map(function (x) {
      x = obj(x);
      var c = obj(first(x, ["counts"]));
      return {
        id: str(first(x, ["id"])), kind: str(first(x, ["kind"])), status: str(first(x, ["status"])),
        releaseAt: first(x, ["release_at"]) || null, releasedAt: first(x, ["released_at"]) || null,
        total: num(first(c, ["total"])), ready: num(first(c, ["ready"])), flagged: num(first(c, ["flagged"])), failed: num(first(c, ["failed"])),
        error: str(first(x, ["error"]))
      };
    });
    return out;
  }

  /* writeNowShown — Write now is on the page only when the server said
     write_now_ready: true. While it is, it is Today's one filled button. */
  function writeNowShown(batches) { return Boolean(batches && batches.ready === true); }

  function plural(n, one, many) { return count(n) + " " + (num(n) === 1 ? one : (many || one + "s")); }

  /* prettyKey — a funnel key in words when no name came with it
     ("book_call" → "Book call"). */
  function prettyKey(key) {
    var k = str(key).replace(/[_-]+/g, " ").trim();
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : "A funnel";
  }

  /* funnelNames — key → name, from GET marketing/today's spend_by_funnel
     (names come from marketing_funnels there). */
  function funnelNames(view) {
    var out = {};
    arr(view && view.byFunnel).forEach(function (f) { if (f.key && f.name) out[f.key] = f.name; });
    return out;
  }

  function funnelName(f, names) {
    return f.name || (names && names[f.key]) || prettyKey(f.key);
  }

  /* dropWhen — "Monday, Oct 19 at 7:00 AM Arizona time". */
  function dropWhen(iso) {
    var d = asDate(iso);
    if (!d) return "unknown";
    return fmt(d, { weekday: "long", month: "short", day: "numeric" }) + " at " + clockOf(d) + " Arizona time";
  }

  /* nextDropModel — the Next drop card's sentences (design §3.1 item 4). */
  function nextDropModel(part, names) {
    var n = part && part.next;
    if (!n) return null;
    var split = n.funnels.filter(function (f) { return num(f.slots) !== null && f.slots > 0; })
      .map(function (f) { return funnelName(f, names) + ": " + count(f.slots); });
    return {
      when: dropWhen(n.releaseAt),
      count: n.total === null ? "Number of scripts: unknown" : plural(n.total, "script"),
      split: split.join(" · "),
      splitWhy: split.length ? "Split by each funnel's ad spend over the last 7 days." : "",
      off: n.enabled === false ? "The weekly drop is off, so nothing comes on its own. Turn it on in Settings." : "",
      unmapped: num(n.unmapped) !== null && n.unmapped > 0
        ? money(n.unmapped) + " of last week's ad spend is not tied to a funnel yet." : "",
      saved: part.saved ? "The plan for this drop is saved." : "",
      changed: n.hasOverrides ? "Your changes for this drop are saved." : ""
    };
  }

  /* batchLine — the newest batch in one line ("Write now (Oct 6): writing.
     1 of 3 ready."). */
  function batchLine(b) {
    if (!b) return "";
    var day = asDate(b.releaseAt || b.releasedAt);
    var name = b.kind === "on_command" ? "Write now" + (day ? " (" + dateOf(day) + ")" : "") : (day ? dateOf(day) + " drop" : "Weekly drop");
    var ofTotal = count(b.ready === null ? 0 : b.ready) + " of " + (b.total === null ? "unknown" : count(b.total)) + " ready";
    if (b.status === "failed") return name + " stopped: " + (b.error ? b.error.replace(/[.\s]+$/, "") : "no reason was saved") + ".";
    if (b.status === "planned") return name + ": waiting to start.";
    if (b.status === "writing") return name + ": writing. " + ofTotal + ".";
    var bits = [ofTotal];
    if (num(b.flagged) > 0) bits.push(count(b.flagged) + " need a look");
    if (num(b.failed) > 0) bits.push(count(b.failed) + " did not get written");
    return name + ": " + bits.join(", ") + ".";
  }

  function batchBusy(b) { return Boolean(b && (b.status === "planned" || b.status === "writing")); }

  /* suggestionNumbers — "$412 spent last week · 9 leads · $45.78 a lead.
     Last ran Oct 4." A null is said in words, never as $0. */
  function suggestionNumbers(s) {
    var bits = [];
    if (s.spend7 === null) bits.push("No ads ran on it last week");
    else bits.push(money(s.spend7) + " spent last week");
    if (s.leads !== null) bits.push(plural(s.leads, "lead"));
    if (s.cpl !== null) bits.push(money(s.cpl) + " a lead");
    return bits.join(" · ") + "." + (s.lastRanOn && dayWords(s.lastRanOn) ? " Last ran " + dayWords(s.lastRanOn) + "." : "");
  }

  /* A request_id the marketing routes take: 8 to 200 letters, digits,
     . _ : - (src/marketing/http.mjs REQUEST_ID_RE). One per tap. */
  var REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,200}$/;
  function newRequestId() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "mcc-" + Date.now().toString(36) + "-" + String(Math.random()).replace(/\D/g, "").slice(0, 12);
  }

  /* ideaRequest — "Use this angle" (spec §7.5 step 7; contract §6.3): the
     suggestion's why is the idea's words, and source says Chris accepted a
     planner suggestion. */
  function ideaRequest(s, requestId) {
    var body = { request_id: requestId, raw_points: s.why || s.name, source: "suggestion" };
    if (s.angleKey) body.angle_key = s.angleKey;
    return body;
  }

  function writeNowRequest(n, requestId) {
    return { request_id: requestId, count: n };
  }

  function retryRequest(jobId, requestId) {
    return { request_id: requestId, job_id: jobId };
  }

  /* answerWords — a refused tap in plain words. The marketing routes write
     their own `message` for the page; signed out, not allowed and no
     connection are worded here. */
  function answerWords(res) {
    if (!res || res.transport || res.status === 0 || res.status === 401 || res.status === 403) return plainError(res, "action");
    return serverWords(res) || plainError(res, "action");
  }

  function tapOk(res) { return Boolean(res && (res.status === 200 || res.status === 202) && obj(res.body).ok !== false); }

  /* summarizeIdea — what "Use this angle" did. */
  function summarizeIdea(res, name, nowMs) {
    if (tapOk(res) && obj(res.body).idea) {
      return { ok: true, tone: "ok", text: "Saved “" + (name || "this angle") + "” as an idea at " + clockOf(new Date(nowMs)) + ". Ideas go first in the next batch." };
    }
    return { ok: false, tone: "err", text: "That angle was not saved. " + answerWords(res) };
  }

  /* summarizeWriteNow — what Write now did. */
  function summarizeWriteNow(res, n) {
    var b = obj(res && res.body);
    if (tapOk(res) && (b.queued === true || b.batch_id)) {
      return { ok: true, tone: "wait", text: "Writing " + plural(n, "script") + " now. They show up in Scripts when they are done. You can leave this page." };
    }
    if (res && res.status === 400 && b.error === "cap_reached") {
      return { ok: false, tone: "err", text: (str(b.message) || "A model spend cap is reached.") + " Nothing was started." };
    }
    return { ok: false, tone: "err", text: answerWords(res) };
  }

  /* summarizeRetry — what Retry did ("Running again. Started 3:04 PM."). */
  function summarizeRetry(res, nowMs) {
    if (tapOk(res) && obj(res.body).job) {
      return { ok: true, tone: "ok", text: "Running again. Started " + clockOf(new Date(nowMs)) + "." };
    }
    return { ok: false, tone: "err", text: answerWords(res) };
  }

  /* writeNowSheet — the words on the frame's cost sheet before Write now
     (design §3.1 Actions, §5 rule 3). The frame prints the cost line for
     ONE script (GET marketing/costs kind "script") and the month line. */
  function writeNowSheet(n, health) {
    var m = health && health.state === "ok" ? health.model : null;
    var caps = m && (m.batchCapUsd !== null || m.monthCapUsd !== null)
      ? "It stops by itself at " + [m.batchCapUsd !== null ? usd(m.batchCapUsd) + " a batch" : null,
        m.monthCapUsd !== null ? usd(m.monthCapUsd) + " a month" : null].filter(Boolean).join(" and ") + "."
      : "It stops by itself at the batch and month caps in Settings.";
    return {
      kind: "script",
      title: "Write " + plural(n, "script") + " now?",
      button: "Write " + count(n),
      lines: [
        "The cost line is for one script. You asked for " + count(n) + ".",
        "It writes with the model. The scripts show up in Scripts when they are done.",
        caps,
        "It spends no ad money."
      ]
    };
  }

  /* usd — a model bill in dollars ("$12.48", "$300"). Null is unknown. */
  function usd(v) {
    var n = num(v);
    if (n === null) return "unknown";
    var whole = Math.round(n) === n;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }

  /* ── the machine (the health card) ── */

  /* healthModel — GET marketing/health in rows of words. Every row says
     what the part does, how it is now, and a chip with a WORD (never colour
     alone, UI-STANDARDS §12.6). The first problem leads the health line. */
  function healthModel(h, view, nowMs) {
    if (!h || h.state !== "ok") return null;
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var rows = [];
    var problems = [];

    var tick = asDate(h.clock.lastTickAt);
    var clock = { key: "clock", label: "Clock", what: "Wakes the machine every 15 minutes." };
    if (!tick) {
      clock.word = "Not run yet"; clock.tone = "bad"; clock.text = "The clock has not ticked yet.";
      problems.push("the clock has not ticked yet");
    } else if (now - tick.getTime() > CLOCK_LATE_MS) {
      clock.word = "Late"; clock.tone = "bad"; clock.text = "Last tick " + when(h.clock.lastTickAt, now).text + ". It should tick every 15 minutes.";
      problems.push("the clock is late");
    } else {
      clock.word = "Running"; clock.tone = "on"; clock.text = "Last tick " + when(h.clock.lastTickAt, now).text + ".";
    }
    clock.text += h.clock.enabled === true ? " The weekly drop is on." : (h.clock.enabled === false ? " The weekly drop is off." : "");
    clock.title = tick ? fullTime(tick) : "";
    rows.push(clock);

    var w = h.worker;
    var ran = asDate(w.lastRunAt);
    var failed = w.failed.length;
    var worker = { key: "worker", label: "Worker", what: "Does the jobs: writing, research, saves." };
    worker.text = (ran ? "Last ran " + when(w.lastRunAt, now).text + ". " : "It has not run yet. ") +
      count(w.queued) + " waiting, " + count(w.running) + " running. " +
      (failed
        ? plural(failed, "job") + " failed in the last 24 hours. Stuck ones are under Waiting on you, each with Retry."
        : "Nothing failed in the last 24 hours.");
    worker.title = ran ? fullTime(ran) : "";
    if (failed) { worker.word = "Had trouble"; worker.tone = "bad"; problems.push(plural(failed, "job") + " failed today"); }
    else if (num(w.running) > 0) { worker.word = "Working"; worker.tone = "wip"; }
    else if (ran) { worker.word = "Ready"; worker.tone = "on"; }
    else { worker.word = "Not run yet"; worker.tone = ""; }
    rows.push(worker);

    var o = h.outbox;
    var saves = { key: "outbox", label: "Saves to GitHub", what: "Puts every approve, edit and idea in the repo." };
    var bits = [];
    if (o.held === "no_token" || o.tokenPresent === false) {
      saves.word = "Held"; saves.tone = "bad";
      bits.push("Repo saves are held: the GitHub token is not set.");
      problems.push("repo saves are held: the GitHub token is not set");
    } else if (o.held === "dry_run") {
      saves.word = "Held"; saves.tone = "wip";
      bits.push("Repo saves are held by the dry-run flag, so nothing goes to GitHub yet.");
      problems.push("repo saves are held by the dry-run flag");
    } else if (num(o.waiting) > 0) {
      saves.word = "Saving"; saves.tone = "wip";
    } else if (o.waiting === 0) {
      saves.word = "Up to date"; saves.tone = "on";
    } else {
      saves.word = "Unknown"; saves.tone = "";
    }
    if (num(o.waiting) > 0) {
      var oldest = asDate(o.oldestAt);
      bits.push(plural(o.waiting, "save") + " waiting" + (oldest ? " since " + savedWords(o.oldestAt, now).text : "") + ".");
    } else if (o.waiting === 0) {
      bits.push("Nothing is waiting.");
    }
    bits.push(o.lastSha
      ? "Last save " + o.lastSha.slice(0, 7) + (o.lastCommitAt ? ", " + when(o.lastCommitAt, now).text : "") + "."
      : "No save has reached GitHub yet.");
    if (o.lastError) bits.push("Last error: " + o.lastError.replace(/[.\s]+$/, "") + ".");
    saves.text = bits.join(" ");
    saves.title = o.lastCommitAt && asDate(o.lastCommitAt) ? fullTime(asDate(o.lastCommitAt)) : "";
    rows.push(saves);

    var sync = asDate(h.syncAt);
    var meta = { key: "sync", label: "Meta pull", what: "Brings in last night's ad numbers." };
    if (!sync) {
      meta.word = "Never"; meta.tone = "bad"; meta.text = "Meta has never sent numbers. " + META_PULL_WORDS;
      problems.push("Meta has never sent numbers");
    } else if (now - sync.getTime() > META_FRESH_MS) {
      meta.word = "Old"; meta.tone = "bad"; meta.text = "Last pulled " + savedWords(h.syncAt, now).text + ". It should pull every day.";
      problems.push("the Meta numbers are old");
    } else {
      meta.word = "Fresh"; meta.tone = "on"; meta.text = "Last pulled " + savedWords(h.syncAt, now).text + ".";
    }
    meta.title = sync ? fullTime(sync) : "";
    rows.push(meta);

    var m = h.model;
    var spend = { key: "model", label: "Model spend", what: "What the AI writing cost this month." };
    var share = m.monthUsd !== null && m.monthCapUsd !== null && m.monthCapUsd > 0 ? m.monthUsd / m.monthCapUsd : null;
    if (m.monthUsd === null) { spend.word = "Unknown"; spend.tone = ""; }
    else if (share !== null && share >= 1) { spend.word = "At the cap"; spend.tone = "bad"; problems.push("model spend is at the month cap"); }
    else if (share !== null && share >= 0.8) { spend.word = "Near the cap"; spend.tone = "wip"; }
    else { spend.word = "Under the cap"; spend.tone = "on"; }
    spend.text = "This month: " + usd(m.monthUsd) + (m.monthCapUsd !== null ? " of " + usd(m.monthCapUsd) : "") + "." +
      (m.lastBatchUsd !== null || m.batchCapUsd !== null
        ? " Last batch: " + usd(m.lastBatchUsd) + (m.batchCapUsd !== null ? " of " + usd(m.batchCapUsd) : "") + "." : "");
    spend.meter = share === null ? null : Math.max(0, Math.min(100, Math.round(share * 100)));
    spend.meterLabel = share === null ? "" : usd(m.monthUsd) + " of " + usd(m.monthCapUsd) + " used this month";
    rows.push(spend);

    var healthy = !problems.length;
    return {
      healthy: healthy,
      word: healthy ? "Healthy" : "Needs a look",
      tone: healthy ? "on" : "bad",
      line: healthy ? "The machine is healthy." : "The machine needs a look: " + problems[0] + ".",
      rows: rows
    };
  }

  /* ── the numbers (spec §11.3 on Today) ── */

  /* roasWords — cash ÷ ad spend, as money back per dollar ("$2.58"). */
  function roasWords(roas, spend) {
    if (roas === null) return { value: "unknown", note: spend === 0 ? "No ad spend, so nothing to compare." : "" };
    return { value: "$" + roas.toFixed(2), note: "back for each $1 of ads" };
  }

  /* numberCells — one window's six rows (spend, leads, booked calls, sales,
     cash, return). `which` is "today", "d7" or "d30". */
  function numberCells(view, which, nowMs) {
    var v = view || {};
    var w = (v.numbers && v.numbers[which]) || normalizeWindow(null);
    var spendNote = "";
    var spendValue = money(w.spend);
    if (which === "today" && w.spend === null) {
      spendValue = v.loaded && metaFresh(v, nowMs) ? "Comes in tomorrow" : "unknown";
      spendNote = v.loaded && metaFresh(v, nowMs) ? META_PULL_WORDS : "";
    } else if (which === "d7") {
      spendNote = compare(w.spend, v.spendPrev7, "7 days");
    } else if (which === "d30") {
      spendNote = compare(w.spend, v.spendPrev30, "30 days");
    }
    var r = roasWords(w.roas, w.spend);
    return [
      { key: "spend", label: "Ad spend", value: spendValue, note: spendNote },
      { key: "leads", label: "Leads", value: count(w.leads), note: "" },
      { key: "booked", label: "Calls booked", value: count(w.booked), note: w.showed === null ? "" : count(w.showed) + " showed" },
      { key: "sales", label: "Sales", value: count(w.sales), note: w.roadmaps === null ? "" : plural(w.roadmaps, "roadmap") + " bought" },
      { key: "cash", label: "Cash", value: money(w.cash), note: w.reportedCash === null ? "" : "Closers typed " + money(w.reportedCash) },
      { key: "roas", label: "Cash back per $1 of ads", value: r.value, note: r.note }
    ];
  }

  /* sparkModel — the last 30 days of one number as a hand-drawn line in a
     100 × 32 box. A day with no saved number (null) breaks the line: the
     gap is the truth, never a dip to 0. */
  function sparkModel(daily, key) {
    var days = arr(daily);
    var vals = days.map(function (d) { return num(d[key]); });
    var n = vals.length;
    if (!n) return null;
    var known = vals.filter(function (x) { return x !== null; });
    var max = known.length ? Math.max.apply(null, known) : null;
    var segs = [];
    var cur = [];
    vals.forEach(function (x, i) {
      if (x === null) { if (cur.length) segs.push(cur); cur = []; return; }
      var px = n === 1 ? 50 : (i / (n - 1)) * 100;
      var py = max > 0 ? 30 - (x / max) * 28 : 30;
      cur.push([px, py]);
    });
    if (cur.length) segs.push(cur);
    var hi = max === null ? -1 : vals.indexOf(max);
    return {
      segs: segs, max: max, n: n, unknownDays: n - known.length,
      hiDate: hi >= 0 ? days[hi].date : null,
      from: days[0].date, to: days[n - 1].date
    };
  }

  function sparkSvg(m, label) {
    var lines = m.segs.map(function (seg) {
      var pts = seg.length === 1
        ? [[Math.max(0, seg[0][0] - 0.8), seg[0][1]], [Math.min(100, seg[0][0] + 0.8), seg[0][1]]]
        : seg;
      return '<polyline points="' + pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" ") +
        '" vector-effect="non-scaling-stroke"></polyline>';
    }).join("");
    return '<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="' + esc(label) +
      '" focusable="false"><line class="spark-base" x1="0" x2="100" y1="31" y2="31" vector-effect="non-scaling-stroke"></line>' +
      lines + "</svg>";
  }

  /* sparkWords — the sentence under a sparkline. */
  function sparkWords(m, key) {
    if (!m) return "";
    if (m.max === null) return key === "spend" ? "No ad spend saved on any of these days." : "No leads saved on any of these days.";
    var said;
    if (m.max === 0) said = key === "spend" ? "No ad spend on any day with numbers." : "No leads on any of these days.";
    else if (key === "spend") said = "Highest day: " + money(m.max) + " on " + dayWords(m.hiDate) + ".";
    else said = "Most leads in a day: " + count(m.max) + ", on " + dayWords(m.hiDate) + ".";
    if (m.unknownDays && key === "spend") said += " No spend saved on " + count(m.unknownDays) + " of " + count(m.n) + " days.";
    return said;
  }

  /* funnelBars — spend by funnel as a short bar list (last 7 days). The
     longest bar is the biggest spend; null is "unknown" with no bar. The
     row with no funnel is the spend not tied to one yet. */
  function funnelBars(list) {
    var max = 0;
    arr(list).forEach(function (f) { if (f.spend !== null && f.spend > max) max = f.spend; });
    return arr(list).map(function (f) {
      return {
        name: f.key === null ? "Not tied to a funnel" : (f.name || prettyKey(f.key)),
        unmapped: f.key === null,
        value: money(f.spend),
        pct: f.spend === null || max <= 0 ? null : (f.spend > 0 ? Math.max(2, Math.round((f.spend / max) * 100)) : 0)
      };
    });
  }

  /* flowSteps — ad → page → lead → call → sale, last 7 days. */
  function flowSteps(f) {
    f = f || {};
    var fv = function (k) { return f[k] === undefined ? null : f[k]; };
    return [
      { key: "clicks", label: "Ad taps", value: count(fv("clicks")), note: "" },
      { key: "page", label: "On the page", value: count(fv("pageViews")), note: "" },
      { key: "leads", label: "Leads", value: count(fv("leads")), note: "" },
      { key: "booked", label: "Calls booked", value: count(fv("booked")), note: fv("showed") === null ? "" : count(fv("showed")) + " showed" },
      { key: "sales", label: "Sales", value: count(fv("sales")), note: "" }
    ];
  }

  /* ── stuck work and scripts on Waiting on you ── */

  /* scriptsWait — "Approve or fix 18 scripts" (scripts_waiting, U32). */
  function scriptsWait(view) {
    var sw = view && view.scriptsWaiting;
    if (!sw || !(num(sw.ready) > 0)) return null;
    return {
      kind: "scripts",
      what: "Approve or fix " + plural(sw.ready, "script"),
      why: num(sw.flagged) > 0 ? plural(sw.flagged, "script") + (sw.flagged === 1 ? " needs" : " need") + " a look first." : "They are ready to read.",
      actHtml: '<a class="btn quiet" href="#scripts">Open Scripts</a>'
    };
  }

  /* stuckWaits — one row per stuck job, each with ONE Retry button
     (design §3.1: "Retry (only on a failed machine row): free, one tap").
     `ui` is the page's memory of taps: retrying (busy) and retried (the
     answer). A job that failed again after a retry gets its button back. */
  function stuckWaits(view, ui, nowMs) {
    var u = ui || {};
    var retrying = u.retrying || {};
    var retried = u.retried || {};
    return arr(view && view.stuckJobs).map(function (j) {
      var r = retried[j.id];
      var since = asDate(j.since);
      var failedAgain = Boolean(r && r.ok && since && since.getTime() > r.at);
      var done = Boolean(r && r.ok && !failedAgain);
      var reason = j.error ? j.error.replace(/\s+$/, "") : "No reason was saved.";
      if (!/[.!?]$/.test(reason)) reason += ".";
      var sinceHtml = since ? "Stuck since " + tipped(savedWords(j.since, nowMs).text, fullTime(since)) + "." : "Stuck since an unknown time.";
      var busy = Boolean(retrying[j.id]);
      var say = done ? { tone: "ok", text: r.text } : (r && !r.ok ? { tone: "err", text: r.text } : null);
      return {
        kind: "stuck",
        job: j.id,
        what: "Stuck: " + kindWords(j.kind),
        why: (failedAgain ? "It failed again after the retry. " : "") + reason,
        howHtml: sinceHtml,
        actHtml: done ? "" :
          '<button class="btn quiet' + (busy ? " busy" : "") + '" type="button" data-act="retry" data-job="' + esc(j.id) + '"' +
          (busy ? ' disabled aria-busy="true"' : "") + '><span class="spin" aria-hidden="true"></span><span class="lbl">' +
          (busy ? "Retrying…" : "Retry") + "</span></button>",
        say: say
      };
    });
  }

  /* ── the new cards' markup ── */

  function skeleton(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += '<span class="skel"></span>';
    return out;
  }

  function sayHtml(s, extra) {
    if (!s || !s.text) return "";
    return '<div class="say show ' + esc(s.tone || "wait") + (extra ? " " + extra : "") + '" role="status">' + esc(s.text) + "</div>";
  }

  /* renderNext — the Next drop card: when, how many, the split, Write now
     (only while write_now_ready), the newest batch, and the 3 angles.
     `ui` carries the taps: count, writing, wnSay, saving, accepted, ideaSay. */
  function renderNext(part, batches, view, ui, nowMs) {
    var u = ui || {};
    var bt = batches || { state: "none", ready: false, batches: [] };
    var html = "";
    if (!part) {
      html += skeleton(3);
    } else if (part.state !== "ok") {
      html += '<p class="muted">' + esc(part.message) + "</p>";
    } else {
      var m = nextDropModel(part, funnelNames(view));
      html += '<p class="drop-when" title="' + esc(asDate(part.next.releaseAt) ? fullTime(asDate(part.next.releaseAt)) : "") + '">' + esc(m.when) + "</p>" +
        '<p class="drop-count"><b>' + esc(m.count) + "</b>" + (m.split ? " · " + esc(m.split) : "") + "</p>" +
        (m.splitWhy ? '<p class="caption muted">' + esc(m.splitWhy) + "</p>" : "");
    }
    /* Write now: drawn only when the server says it can run (U26
       write_now_ready, U35 registers start_batch). While drawn it is the one
       filled button on Today; Write ad copy is an outline button then. */
    if (writeNowShown(bt)) {
      var n = WRITE_NOW_COUNTS.indexOf(u.count) === -1 ? WRITE_NOW_DEFAULT : u.count;
      var busy = Boolean(u.writing);
      html += '<div class="wn">' +
        '<div class="field"><label for="writeNowCount">How many scripts?</label><select id="writeNowCount"' + (busy ? " disabled" : "") + ">" +
        WRITE_NOW_COUNTS.map(function (c) { return '<option value="' + c + '"' + (c === n ? " selected" : "") + ">" + c + "</option>"; }).join("") +
        "</select></div>" +
        /* Filled (PRIMARY): while Write now is drawn it is Today's one filled
           button; placePrimary() takes the filled look off Write ad copy. */
        '<button class="btn ' + PRIMARY + (busy ? " busy" : "") + '" type="button" id="writeNowBtn" data-act="write-now"' + (busy ? ' disabled aria-busy="true"' : "") +
        '><span class="spin" aria-hidden="true"></span><span class="lbl">' + (busy ? "Starting…" : "Write now") + "</span></button>" +
        "</div>" +
        '<p class="caption muted">Writes scripts today, outside the weekly drop. You see the cost before it starts.</p>' +
        sayHtml(u.wnSay);
    }
    if (part && part.state === "ok") {
      var mm = nextDropModel(part, funnelNames(view));
      var notes = [mm.off, mm.unmapped, mm.saved, mm.changed].filter(Boolean);
      if (notes.length) {
        html += '<ul class="drop-notes">' + notes.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
        if (mm.off || mm.unmapped) html += '<div class="row-act"><a class="btn quiet" href="#settings">Open Settings</a></div>';
      }
    }
    var latest = bt.batches.length ? batchLine(bt.batches[0]) : "";
    if (latest) html += '<p class="caption batch-line">Newest batch: ' + esc(latest) + "</p>";
    if (part && part.state === "ok") html += renderSuggestions(part, u);
    return html;
  }

  /* renderSuggestions — the planner's 3 angles, each with Use this angle
     (spec §7.5 step 7). An angle Chris already saved this week says so and
     has no button. */
  function renderSuggestions(part, u) {
    var list = part.next.suggestions;
    var head = '<p class="eyebrow sugg-hd">Angles to try next</p>' + sayHtml(u.ideaSay);
    if (!list.length) return head + '<p class="muted">The planner has no angle to suggest right now.</p>';
    var week = part.next.weekKey;
    var saving = u.saving || {};
    var accepted = u.accepted || {};
    return head + '<ol class="rows sugg">' + list.map(function (s) {
      var key = s.angleKey || s.name;
      var isBusy = Boolean(saving[key]);
      var done = Boolean(accepted[week + ":" + key]);
      var act = done
        ? '<span class="caption">Saved as an idea.</span>'
        : '<button class="btn quiet' + (isBusy ? " busy" : "") + '" type="button" data-act="use-angle" data-angle="' + esc(key) + '"' +
          (isBusy ? ' disabled aria-busy="true"' : "") + '><span class="spin" aria-hidden="true"></span><span class="lbl">' +
          (isBusy ? "Saving…" : "Use this angle") + "</span></button>";
      return '<li class="row" data-angle-row="' + esc(key) + '"><div class="row-main"><b>' + esc(s.name || prettyKey(s.angleKey)) + "</b>" +
        (s.why ? '<div class="row-why">' + esc(s.why) + "</div>" : "") +
        '<div class="row-why caption">' + esc(suggestionNumbers(s)) + "</div></div>" +
        '<div class="row-body"><div class="row-act">' + act + "</div></div></li>";
    }).join("") + "</ol>";
  }

  /* renderMachine — the health card (design §3.1 item 7). */
  function renderMachine(h, view, nowMs) {
    if (!h) return skeleton(4);
    if (h.state !== "ok") return '<p class="muted">' + esc(h.message) + "</p>";
    var m = healthModel(h, view, nowMs);
    return '<p class="health-line">' + esc(m.line) + "</p>" +
      '<ol class="rows">' + m.rows.map(function (r) {
        return '<li class="row" data-health="' + esc(r.key) + '"><div class="row-main"><b>' + esc(r.label) + "</b>" +
          '<div class="row-why caption">' + esc(r.what) + "</div></div>" + chip(r.word, r.tone) +
          '<div class="row-body"><div class="row-why"' + (r.title ? ' title="' + esc(r.title) + '"' : "") + ">" + esc(r.text) + "</div>" +
          (r.meter !== null && r.meter !== undefined
            ? '<div class="meter" role="img" aria-label="' + esc(r.meterLabel) + '"><span style="width:' + r.meter + '%"></span></div>' : "") +
          "</div></li>";
      }).join("") + "</ol>" +
      '<p class="caption muted gap-top">It never turns an ad on, pauses one, or changes a budget. You do that in Launch.</p>';
  }

  /* renderNumbers — today / 7 days / 30 days, two hand-drawn sparklines,
     spend by funnel and the flow, with the as-of words (spec §8.3, §11.3). */
  function renderNumbers(view, nowMs) {
    var v = view || {};
    if (!v.loaded) return notLoaded();
    if (!v.m5Read) {
      var why = waitingFor(v, ["numbers"]);
      return '<p class="muted">' + esc(why.length && why[0].reason ? why[0].reason : "The numbers are not on this server yet. They turn on with the next update.") + "</p>";
    }
    var cols = [
      { key: "today", name: "Today", sub: dayWords(v.today) },
      { key: "d7", name: "Last 7 days", sub: rangeWords(v.from7, v.to7) },
      { key: "d30", name: "Last 30 days", sub: rangeWords(v.from30, v.to30) }
    ];
    var html = '<div class="num-cols">' + cols.map(function (c) {
      return '<div class="num-col" data-win="' + c.key + '"><p class="eyebrow">' + esc(c.name) + "</p>" +
        (c.sub ? '<p class="caption muted">' + esc(c.sub) + "</p>" : "") +
        '<dl class="num-list">' + numberCells(v, c.key, nowMs).map(function (r) {
          return '<div class="num-row" data-num="' + r.key + '"><dt class="caption">' + esc(r.label) + "</dt>" +
            '<dd><b class="' + (r.value === "unknown" ? "unk" : "") + '">' + esc(r.value) + "</b></dd>" +
            (r.note ? '<dd class="caption num-note">' + esc(r.note) + "</dd>" : "") + "</div>";
        }).join("") + "</dl></div>";
    }).join("") + "</div>";

    var spend = sparkModel(v.daily, "spend");
    var leads = sparkModel(v.daily, "leads");
    if (spend || leads) {
      html += '<div class="sparks">' + [["spend", "Ad spend, each day", spend], ["leads", "Leads, each day", leads]].map(function (s) {
        var m = s[2];
        if (!m) return "";
        var said = sparkWords(m, s[0]);
        return '<div class="spark-box" data-spark="' + s[0] + '"><p class="caption">' + esc(s[1]) + "</p>" +
          (m.max === null ? "" : sparkSvg(m, s[1] + ", " + rangeWords(m.from, m.to) + ". " + said)) +
          '<div class="spark-ends caption muted"><span>' + esc(dayWords(m.from)) + "</span><span>" + esc(dayWords(m.to)) + "</span></div>" +
          '<p class="caption">' + esc(said) + "</p></div>";
      }).join("") + "</div>";
    }

    var bars = funnelBars(v.byFunnel);
    var flow = flowSteps(v.flow);
    html += '<div class="two">' +
      '<div class="two-box" data-part="by-funnel"><p class="eyebrow">Spend by funnel, last 7 days</p>' +
      (!v.byFunnelRead
        ? '<p class="muted">Spend by funnel is not on this server yet.</p>'
        : (!bars.length
          ? '<p class="muted">No funnels are set up yet.</p>'
          : '<ol class="bars">' + bars.map(function (b) {
            return '<li class="bar-row' + (b.unmapped ? " unmapped" : "") + '"><span>' + esc(b.name) + "</span><b>" + esc(b.value) + "</b>" +
              (b.pct === null ? "" : '<span class="bar" aria-hidden="true"><span style="width:' + b.pct + '%"></span></span>') +
              (b.unmapped ? '<a class="caption" href="#settings">Tie it to a funnel in Settings</a>' : "") + "</li>";
          }).join("") + "</ol>")) +
      "</div>" +
      '<div class="two-box" data-part="flow"><p class="eyebrow">The flow, last 7 days</p>' +
      '<p class="caption muted">Ad → page → lead → call → sale.</p>' +
      (!v.flowRead
        ? '<p class="muted">The flow is not on this server yet.</p>'
        : '<ol class="flow">' + flow.map(function (s) {
          return '<li data-step="' + s.key + '"><span class="caption">' + esc(s.label) + '</span><b class="' + (s.value === "unknown" ? "unk" : "") + '">' +
            esc(s.value) + "</b>" + (s.note ? '<span class="caption num-note">' + esc(s.note) + "</span>" : "") + "</li>";
        }).join("") + "</ol>") +
      "</div></div>";
    var asOf = asOfLine(v, nowMs);
    if (asOf.html) html += '<p class="caption asof gap-top">' + asOf.html + "</p>";
    return html;
  }

  /* Today's own look for the U37 cards, added once through the frame's
     ctx.style and scoped to #tab-today (docs/specs/command-center-tabs.md).
     No px font sizes (UI-STANDARDS §12.7: captions are .caption/.eyebrow,
     values are body), no hand-written shadow (§12.2: group boxes take a tint
     and a hairline, §12.5), 8px spacing only (§2). One column at 390px. */
  var CSS = [
    "#tab-today .drop-when{font-weight:600}",
    "#tab-today .drop-count{margin-top:8px}",
    "#tab-today .drop-count b{font-weight:600}",
    "#tab-today .drop-notes{list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;color:var(--ink2)}",
    "#tab-today .wn{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:16px}",
    "#tab-today .wn .field{margin-bottom:0;min-width:160px}",
    "#tab-today .wn select{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 16px;background:#fff;min-height:48px}",
    "#tab-today .wn + .caption{margin-top:8px}",
    "#tab-today .batch-line{margin-top:16px;color:var(--ink2)}",
    "#tab-today .sugg-hd{margin-top:24px;margin-bottom:8px}",
    "#tab-today .health-line{margin-bottom:8px;font-weight:600}",
    "#tab-today .meter{height:8px;border-radius:4px;background:var(--soft);margin-top:8px;overflow:hidden;max-width:320px}",
    "#tab-today .meter span{display:block;height:100%;background:var(--ink2)}",
    "#tab-today .num-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}",
    "#tab-today .num-col,#tab-today .spark-box,#tab-today .two-box{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:16px;min-width:0}",
    "#tab-today .num-list{margin-top:8px}",
    "#tab-today .num-row{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)}",
    "#tab-today .num-row:first-child{border-top:0}",
    "#tab-today .num-row dt{color:var(--gray)}",
    "#tab-today .num-row dd{text-align:right;font-variant-numeric:tabular-nums;min-width:0}",
    "#tab-today .num-row dd b,#tab-today .flow b,#tab-today .bar-row b{font-weight:600;font-variant-numeric:tabular-nums}",
    "#tab-today .num-note{display:block;color:var(--gray)}",
    "#tab-today .num-row dd.num-note{grid-column:1 / -1;text-align:right}",
    "#tab-today .unk{color:var(--gray);font-weight:400}",
    "#tab-today .sparks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}",
    "#tab-today svg.spark{display:block;width:100%;height:48px;margin-top:8px}",
    "#tab-today svg.spark polyline{fill:none;stroke:var(--ink2);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}",
    "#tab-today svg.spark .spark-base{stroke:var(--line);stroke-width:1}",
    "#tab-today .spark-ends{display:flex;justify-content:space-between;margin:0 0 8px}",
    "#tab-today .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}",
    "#tab-today .bars{list-style:none;display:flex;flex-direction:column;gap:16px;margin-top:8px}",
    "#tab-today .bar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;row-gap:8px;align-items:baseline}",
    "#tab-today .bar{grid-column:1 / -1;display:block;height:8px;border-radius:4px;background:#fff;border:1px solid var(--line);overflow:hidden}",
    "#tab-today .bar span{display:block;height:100%;background:var(--ink2)}",
    "#tab-today .bar-row a{grid-column:1 / -1;text-decoration:underline;min-height:40px;display:inline-flex;align-items:center}",
    "#tab-today .flow{list-style:none;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:8px}",
    "#tab-today .flow li{display:flex;flex-direction:column;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 16px;background:#fff}",
    "#tab-today .flow li > .caption:first-child{color:var(--gray)}",
    "#tab-today a.btn{text-decoration:none}",
    "#tab-today .card-hd a{min-height:40px;display:inline-flex;align-items:center;text-decoration:underline}",
    "@media (max-width:1200px){#tab-today .flow{grid-template-columns:repeat(3,minmax(0,1fr))}}",
    "@media (max-width:960px){#tab-today .num-cols{grid-template-columns:minmax(0,1fr)}}",
    "@media (max-width:720px){#tab-today .sparks,#tab-today .two{grid-template-columns:minmax(0,1fr)}}",
    "@media (max-width:480px){#tab-today .wn{flex-direction:column;align-items:stretch}#tab-today .wn .btn{width:100%}#tab-today .flow{grid-template-columns:minmax(0,1fr)}#tab-today .flow li{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;align-items:baseline}#tab-today .flow li .num-note{grid-column:1 / -1;text-align:right}#tab-today .row-act .btn{min-height:44px}}"
  ].join("\n");

  var API = {
    OFFER_TYPES: OFFER_TYPES,
    STAGE_KEYS: STAGE_KEYS,
    STAGE_NAMES: STAGE_NAMES,
    OFFER_POLL_MS: OFFER_POLL_MS,
    OFFER_POLL_TRIES: OFFER_POLL_TRIES,
    RELOAD_MS: RELOAD_MS,
    FOCUS_GAP_MS: FOCUS_GAP_MS,
    FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
    META_FRESH_MS: META_FRESH_MS,
    META_PULL_WORDS: META_PULL_WORDS,
    COPY_MAX_JOBS: COPY_MAX_JOBS,
    display: display,
    normalizeToday: normalizeToday,
    normalizeVideos: normalizeVideos,
    normalizePiece: normalizePiece,
    normalizeOffer: normalizeOffer,
    money: money,
    compare: compare,
    when: when,
    savedWords: savedWords,
    loadedWords: loadedWords,
    minutesWords: minutesWords,
    dayWords: dayWords,
    rangeWords: rangeWords,
    metaFresh: metaFresh,
    oldLead: oldLead,
    oldLeadHtml: oldLeadHtml,
    aboutTime: aboutTime,
    adviceWords: adviceWords,
    asOfLine: asOfLine,
    todayWords: todayWords,
    plainReasons: plainReasons,
    stageName: stageName,
    stepWords: stepWords,
    campaignWords: campaignWords,
    doneSentence: doneSentence,
    stageWord: stageWord,
    deriveWaiting: deriveWaiting,
    videoWait: videoWait,
    waitingList: waitingList,
    deriveParts: deriveParts,
    setupBlock: setupBlock,
    setupLine: setupLine,
    offerCostLine: offerCostLine,
    copyCostLine: copyCostLine,
    offerHonest: offerHonest,
    plainError: plainError,
    refreshBanner: refreshBanner,
    jobReason: jobReason,
    newKey: newKey,
    checkCopyInput: checkCopyInput,
    copyRequest: copyRequest,
    summarizeRun: summarizeRun,
    writeAdCopy: writeAdCopy,
    summarizeOfferRead: summarizeOfferRead,
    summarizeOfferStart: summarizeOfferStart,
    offerJobLine: offerJobLine,
    offerPollStep: offerPollStep,
    startOffer: startOffer,
    readOffer: readOffer,
    foldText: foldText,
    reviewCardHtml: reviewCardHtml,
    renderSpendTile: renderSpendTile,
    renderPartsTile: renderPartsTile,
    renderWaiting: renderWaiting,
    renderFlywheel: renderFlywheel,
    renderOfferStatus: renderOfferStatus,
    renderOffer: renderOffer,
    renderOfferLatest: renderOfferLatest,
    renderPieces: renderPieces,
    renderLatest: renderLatest,
    renderParts: renderParts,
    /* U37 */
    KIND_WORDS: KIND_WORDS,
    CLOCK_LATE_MS: CLOCK_LATE_MS,
    BATCH_POLL_MS: BATCH_POLL_MS,
    BATCH_POLL_TRIES: BATCH_POLL_TRIES,
    WRITE_NOW_COUNTS: WRITE_NOW_COUNTS,
    WRITE_NOW_DEFAULT: WRITE_NOW_DEFAULT,
    REQUEST_ID_RE: REQUEST_ID_RE,
    CSS: CSS,
    kindWords: kindWords,
    partState: partState,
    partError: partError,
    normalizeWindow: normalizeWindow,
    normalizeHealth: normalizeHealth,
    normalizeNext: normalizeNext,
    normalizeBatches: normalizeBatches,
    writeNowShown: writeNowShown,
    funnelNames: funnelNames,
    dropWhen: dropWhen,
    nextDropModel: nextDropModel,
    batchLine: batchLine,
    batchBusy: batchBusy,
    suggestionNumbers: suggestionNumbers,
    newRequestId: newRequestId,
    ideaRequest: ideaRequest,
    writeNowRequest: writeNowRequest,
    retryRequest: retryRequest,
    summarizeIdea: summarizeIdea,
    summarizeWriteNow: summarizeWriteNow,
    summarizeRetry: summarizeRetry,
    writeNowSheet: writeNowSheet,
    usd: usd,
    healthModel: healthModel,
    roasWords: roasWords,
    numberCells: numberCells,
    sparkModel: sparkModel,
    sparkSvg: sparkSvg,
    sparkWords: sparkWords,
    funnelBars: funnelBars,
    flowSteps: flowSteps,
    scriptsWait: scriptsWait,
    stuckWaits: stuckWaits,
    renderNext: renderNext,
    renderMachine: renderMachine,
    renderNumbers: renderNumbers
  };
  root.FHMarketingCC = API;

  /* ── the markup ──────────────────────────────────────────────────────── */

  /* Today's cards, word for word as they stood in marketing-command-center.html
     before the frame came (U34), plus U37's three cards: Next drop and The
     machine in their own row under the Offer cards, and Money and leads under
     them. (They sit below the Offer cards so every older card keeps its
     place: U34's tests pin those places.) The page's <style> styles the old
     cards; U37's look is CSS above, added through ctx.style.
     ONE filled button on Today (UI-STANDARDS §1): Write ad copy, as written
     here, until GET marketing/batches says write_now_ready. Then Write now is
     drawn filled in the Next drop card, the page takes the filled look off
     Write ad copy (it stays an outline button that works), and Next drop
     and Write ad copy trade places, so the one job sits top-left of the work
     row, above the fold. */
  var TODAY_HTML = [
    '<div class="banner err" id="mccBanner" role="alert"></div>',
    '',
    '<!-- 1. IS THE MACHINE HEALTHY? Top-left, largest (UI-STANDARDS §1, §10). -->',
    '<section class="grid" aria-label="This week at a glance">',
    '  <div class="card tile span-4" id="tileSpend7">',
    '    <span class="caption">Ad spend, all accounts, last 7 days</span>',
    '    <span class="skel big"></span><span class="skel"></span>',
    '  </div>',
    '  <div class="card tile span-4" id="tileSpend30">',
    '    <span class="caption">Ad spend, all accounts, last 30 days</span>',
    '    <span class="skel big"></span><span class="skel"></span>',
    '  </div>',
    '  <div class="card tile span-4" id="tileParts">',
    '    <span class="caption">What is turned on</span>',
    '    <span class="skel big"></span><span class="skel"></span>',
    '  </div>',
    '</section>',
    '<!-- The one as-of sentence: how fresh the numbers above are. -->',
    '<p class="caption asof" id="mccAsOf" hidden></p>',
    '',
    '<!-- 2. THE ONE JOB, and what waits on Chris. While Write now is live, Next drop takes the first slot here (U37). -->',
    '<section class="grid" id="todayWork">',
    '  <div class="card span-6" id="cardCopy">',
    '    <div class="card-hd"><h2>Write ad copy</h2></div>',
    '    <p class="setup caption" id="copySetup">Checking that the copy writer is ready…</p>',
    '    <form id="copyForm" novalidate>',
    '      <div class="field">',
    '        <label for="copyAngle">What is this ad about?</label>',
    '        <textarea id="copyAngle" rows="3" placeholder="For example: business owners who got turned down by their bank"></textarea>',
    '      </div>',
    '      <div class="field">',
    '        <label for="copyOffer">What are we selling?</label>',
    '        <select id="copyOffer">',
    '          <option value="funding" selected>Funding</option>',
    '          <option value="credit_cards">Credit cards</option>',
    '          <option value="credit_repair">Credit repair</option>',
    '        </select>',
    '      </div>',
    '      <div class="actions">',
    '        <button class="btn primary" type="submit" id="copyBtn" disabled><span class="spin" aria-hidden="true"></span><span class="lbl">Write ad copy</span></button>',
    '      </div>',
    '      <!-- What a run costs: the copy writer\'s last measured runs, or "unknown". -->',
    '      <p class="caption cost" id="copyCost">Checking what a run costs…</p>',
    '    </form>',
    '    <div class="say" id="copySay" role="status" aria-live="polite"></div>',
    '    <div id="copyResult"></div>',
    '  </div>',
    '',
    '  <div class="card span-6" id="cardWaiting">',
    '    <div class="card-hd"><h2>Waiting on you</h2><span class="caption faint" id="waitingCount"></span></div>',
    '    <div id="waitingList"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '</section>',
    '',
    '<!-- 3. The offer and the five flywheel steps. -->',
    '<section class="grid">',
    '  <div class="card span-6" id="cardOffer">',
    '    <div class="card-hd"><h2>Offer</h2></div>',
    '    <div id="offerStatus"><span class="skel"></span></div>',
    '    <div class="actions offer-actions">',
    '      <button class="btn" type="button" id="offerBtn"><span class="spin" aria-hidden="true"></span><span class="lbl">Write offer</span></button>',
    '    </div>',
    '    <!-- Time and cost: the last measured offer run, or "unknown". -->',
    '    <p class="caption cost" id="offerCost">Checking what a run costs…</p>',
    '    <p class="honest" id="offerHonest" hidden></p>',
    '    <div class="say" id="offerSay" role="status" aria-live="polite"></div>',
    '    <div id="offerLatest" class="gap-top"><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '',
    '  <div class="card span-6" id="cardFlywheel">',
    '    <div class="card-hd"><h2>Offer and market</h2><span class="caption faint" id="flywheelCampaign"></span></div>',
    '    <div id="flywheelList"><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '</section>',
    '',
    '<!-- 3b. The next drop and the machine (U37). While Write now is live, Write ad copy takes the Next drop slot here. -->',
    '<section class="grid" id="todayMore">',
    '  <div class="card span-6" id="cardNext">',
    '    <div class="card-hd"><h2>Next drop</h2></div>',
    '    <div id="nextBody"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '',
    '  <div class="card span-6" id="cardMachine">',
    '    <div class="card-hd"><h2>The machine</h2></div>',
    '    <div id="machineBody"><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '</section>',
    '',
    '<!-- 3c. The M5 numbers: today, 7 and 30 days, sparklines, spend by funnel, the flow (U37). -->',
    '<section class="grid">',
    '  <div class="card span-12" id="cardNumbers">',
    '    <div class="card-hd"><h2>Money and leads</h2><a class="caption" href="#numbers">Open Numbers</a></div>',
    '    <div id="numbersBody"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '</section>',
    '',
    '<!-- 4. Health detail and the latest copy. -->',
    '<section class="grid">',
    '  <div class="card span-6" id="cardHealth">',
    '    <div class="card-hd"><h2>What is turned on</h2></div>',
    '    <div id="healthList"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '',
    '  <div class="card span-6" id="cardLatest">',
    '    <div class="card-hd"><h2>Latest ad copy</h2><a class="caption" href="creative-factory.html">Open Creative Factory</a></div>',
    '    <div id="latestList"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>',
    '  </div>',
    '</section>'
  ].join("\n");
  API.TODAY_HTML = TODAY_HTML;

  /* ── the tab ─────────────────────────────────────────────────────────── */

  /* register — hand Today to the frame (docs/specs/command-center-tabs.md).
     The frame's script loads first, so the registry is normally there; if it is
     not yet, the queue is what the frame drains when it starts. */
  var TAB = {
    key: "today",
    label: "Today",
    order: 10,
    rules: API,
    render: function (panel, ctx) {
      panel.innerHTML = TODAY_HTML;
      boot(panel, ctx);
    }
  };
  if (root.FHMarketingCCTabs && typeof root.FHMarketingCCTabs.register === "function") {
    root.FHMarketingCCTabs.register(TAB);
  } else {
    (root.FHMarketingCCTabsQueue = root.FHMarketingCCTabsQueue || []).push(TAB);
  }

  /* ── the page ────────────────────────────────────────────────────────── */

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== "function") return;

  /* boot — wire Today inside its panel. Called once, by render, the first time
     the frame shows Today. Ids are unique on the page, so $ still reads them.
     `ctx` is the frame's (docs/specs/command-center-tabs.md): Today uses its
     style() for U37's look, costSheet() before Write now, and requestId(). */
  function boot(panel, ctx) {
    function $(id) { return doc.getElementById(id); }
    var frameCtx = ctx && typeof ctx === "object" ? ctx : {};
    if (typeof frameCtx.style === "function") frameCtx.style("today", CSS);

    /* Same session handling as csm-queue.html: a Bearer header when the screen
       has a token, the same-origin cookie otherwise. */
    function api(path, init) {
      init = init || {};
      var headers = { accept: "application/json" };
      try {
        var t = root.localStorage.getItem("fh_token") || "";
        if (t && t !== "demo" && t !== "demo-token") headers.authorization = "Bearer " + t;
      } catch (e) { /* storage blocked: the cookie still works */ }
      var opts = { method: init.method || "GET", headers: headers, credentials: "same-origin" };
      if (init.body !== undefined) {
        headers["content-type"] = "application/json";
        opts.body = JSON.stringify(init.body);
      }
      /* Reads give up after FETCH_TIMEOUT_MS (see it, at the top). */
      var timer = null;
      var timedOut = false;
      if (opts.method === "GET" && typeof root.AbortController === "function") {
        var ctrl = new root.AbortController();
        opts.signal = ctrl.signal;
        timer = root.setTimeout(function () { timedOut = true; ctrl.abort(); }, FETCH_TIMEOUT_MS);
      }
      function settle(out) {
        if (timer) root.clearTimeout(timer);
        if (timedOut) out.timedOut = true;
        return out;
      }
      return root.fetch(path, opts).then(
        function (r) {
          return r.json().then(
            function (b) { return settle({ status: r.status, body: b }); },
            function () { return settle(timedOut ? { status: 0, body: null, transport: "timeout" } : { status: r.status, body: null }); }
          );
        },
        function (e) { return settle({ status: 0, body: null, transport: timedOut ? "timeout" : ((e && e.message) || "network error") }); }
      );
    }

    var deps = { api: api };
    var state = {
      view: normalizeToday(null),
      videos: { loaded: false, items: [], more: false, tried: false },
      offerRead: null,
      polling: false,
      loadedAt: null,
      loading: false,
      lastTry: 0,
      /* U37: null until the first answer (its card shows skeletons). */
      health: null,
      next: null,
      batches: { state: "none", ready: false, batches: [] },
      batchPoll: null,
      /* What Chris tapped, kept across repaints: the Write now count and
         answer, the angles being saved and saved, the Retry taps. */
      ui: { count: WRITE_NOW_DEFAULT, writing: false, wnSay: null, saving: {}, accepted: {}, ideaSay: null, retrying: {}, retried: {} }
    };

    function requestId() {
      var id = typeof frameCtx.requestId === "function" ? frameCtx.requestId() : "";
      return REQUEST_ID_RE.test(String(id || "")) ? String(id) : newRequestId();
    }

    function say(id, tone, text) {
      var el = $(id);
      if (!el) return;
      el.className = "say show " + tone;
      el.textContent = text;
    }
    function busy(btn, on, label) {
      btn.classList.toggle("busy", on);
      btn.disabled = on;
      btn.setAttribute("aria-busy", on ? "true" : "false");
      var lbl = btn.querySelector(".lbl");
      if (lbl && label) lbl.textContent = label;
    }

    /* A repaint (every 5 minutes, or on focus) must not snap shut a review
       card Chris is reading. Note what is open, repaint, open it again. */
    function openPanels() {
      var out = [];
      var btns = panel.querySelectorAll('button[data-toggle][aria-expanded="true"]');
      for (var i = 0; i < btns.length; i++) out.push(btns[i].getAttribute("data-toggle"));
      return out;
    }
    function reopen(ids) {
      ids.forEach(function (id) {
        var btn = panel.querySelector('button[data-toggle="' + id + '"]');
        if (btn && btn.getAttribute("aria-expanded") !== "true") setOpen(btn, true);
      });
    }
    function setOpen(btn, open) {
      var panel = $(btn.getAttribute("data-toggle"));
      if (!panel) return;
      panel.hidden = !open;
      var swap = btn.getAttribute("data-swap");
      if (swap && $(swap)) $(swap).hidden = open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? btn.getAttribute("data-open") : btn.getAttribute("data-closed");
    }

    function paint() {
      var keep = openPanels();
      repaint();
      reopen(keep);
    }

    function repaint() {
      var v = state.view;
      var now = Date.now();
      $("tileSpend7").innerHTML = renderSpendTile(v, 7, now);
      $("tileSpend30").innerHTML = renderSpendTile(v, 30, now);
      $("tileParts").innerHTML = renderPartsTile(v, now);
      var asOf = asOfLine(v, now);
      var asOfEl = $("mccAsOf");
      /* Each time in the sentence carries its own exact-time tooltip. */
      asOfEl.innerHTML = asOf.html;
      asOfEl.hidden = !asOf.text;
      asOfEl.classList.toggle("stale", Boolean(oldLead(v, now)));
      var waiting = v.loaded ? waitingList(v, state.videos, now, state.ui) : [];
      $("waitingCount").textContent = waiting.length ? waiting.length + " to do" : "";
      $("waitingList").innerHTML = renderWaiting(v, state.videos, now, state.ui);
      $("numbersBody").innerHTML = renderNumbers(v, now);
      paintParts();
      $("flywheelCampaign").textContent = v.loaded && v.campaign ? campaignWords(v.campaign) : "";
      $("flywheelList").innerHTML = renderFlywheel(v);
      $("offerStatus").innerHTML = renderOfferStatus(v);
      $("offerCost").textContent = offerCostLine(v);
      $("healthList").innerHTML = renderParts(v, now);
      $("latestList").innerHTML = renderLatest(v, now);
      $("copyCost").textContent = copyCostLine(v);
      var line = setupLine(v);
      var setup = $("copySetup");
      setup.textContent = line.text;
      setup.className = "setup caption" + (line.bad ? " bad" : "");
      var btn = $("copyBtn");
      if (!btn.classList.contains("busy")) btn.disabled = line.bad;
      var stamp = $("mccStamp");
      if (state.loadedAt) {
        var lw = loadedWords(state.loadedAt);
        stamp.textContent = lw.text;
        stamp.title = lw.title;
      } else {
        stamp.textContent = "Not loaded";
        stamp.title = "";
      }
    }

    function paintOffer() {
      var keep = openPanels();
      $("offerLatest").innerHTML = renderOfferLatest(state.offerRead, Date.now());
      reopen(keep);
      var honest = offerHonest(state.view, state.offerRead);
      var h = $("offerHonest");
      h.textContent = honest;
      h.hidden = !honest;
      /* Until the offer writer ships, the button says so and does nothing
         (the line under it is the reason). Any other answer leaves it on. */
      var btn = $("offerBtn");
      if (!btn.classList.contains("busy") && !state.polling) {
        btn.disabled = Boolean(state.offerRead && state.offerRead.state === "notReady");
      }
    }

    function loadVideos() {
      return api("/api/ad-videos?status=awaiting_approval").then(function (res) {
        var v = normalizeVideos(res);
        v.tried = true;
        state.videos = v;
      });
    }

    /* ── U37: the next drop, the machine, the taps ── */

    /* paintParts — the Next drop and The machine cards, and which button is
       the one filled button. They do not need GET marketing/today, so they
       paint as soon as their own answer lands. */
    function paintParts() {
      var keep = openPanels();
      var now = Date.now();
      $("nextBody").innerHTML = renderNext(state.next, state.batches, state.view, state.ui, now);
      $("machineBody").innerHTML = renderMachine(state.health, state.view, now);
      reopen(keep);
      placePrimary();
    }

    /* placePrimary — ONE filled button (UI-STANDARDS §1). While Write now is
       drawn it is the filled one and Next drop takes the top-left slot of the
       work grid (above the fold); Write ad copy turns outline and still
       works. Otherwise the grid is as it always was and Write ad copy is the
       filled one. */
    function placePrimary() {
      var ready = writeNowShown(state.batches) && Boolean($("writeNowBtn"));
      var work = $("todayWork");
      var more = $("todayMore");
      var copy = $("cardCopy");
      var next = $("cardNext");
      var machine = $("cardMachine");
      $("copyBtn").classList.toggle(PRIMARY, !ready);
      if (ready && next.parentNode !== work) {
        keepFocus(function () {
          work.insertBefore(next, copy);
          more.insertBefore(copy, machine);
        });
      } else if (!ready && copy.parentNode !== work) {
        keepFocus(function () {
          work.insertBefore(copy, next);
          more.insertBefore(next, machine);
        });
      }
    }

    /* keepFocus — moving a card takes focus off whatever is inside it, so
       Chris typing in "What is this ad about?" when the batch answer lands
       would lose his place. Note the focused box and its caret, move the
       cards, then put both back. The words never leave the box. */
    function keepFocus(move) {
      var el = doc.activeElement;
      var held = el && el !== doc.body && panel.contains(el) ? el : null;
      var start = null;
      var end = null;
      if (held) {
        try { start = held.selectionStart; end = held.selectionEnd; } catch (e) { start = null; }
      }
      move();
      if (!held || doc.activeElement === held || !panel.contains(held)) return;
      held.focus();
      if (typeof start === "number" && typeof end === "number" && typeof held.setSelectionRange === "function") {
        try { held.setSelectionRange(start, end); } catch (e) { /* not a text box */ }
      }
    }

    function loadHealth() {
      return api("/api/marketing/health").then(function (res) { state.health = normalizeHealth(res); paintParts(); });
    }
    function loadNext() {
      return api("/api/marketing/batches/next").then(function (res) { state.next = normalizeNext(res); paintParts(); });
    }
    function loadBatches() {
      return api("/api/marketing/batches").then(function (res) {
        var b = normalizeBatches(res);
        /* A failed re-read keeps what the page last knew, so Write now does
           not blink away on one dropped answer. */
        if (b.state === "ok" || state.batches.state !== "ok") state.batches = b;
        paintParts();
      });
    }
    /* loadParts — the three reads, side by side. Each paints on its own
       answer; none waits for another or for GET marketing/today. */
    function loadParts() {
      loadHealth();
      loadNext();
      loadBatches();
    }

    /* watchBatch — after Write now, read the batch list again every 20
       seconds while the newest batch is waiting or writing and the page is
       in view, at most 10 minutes. A second Write now starts the 10 minutes
       over for its own batch: the old watch is stopped, never kept. */
    function watchBatch() {
      if (state.batchPoll) root.clearInterval(state.batchPoll);
      var tries = 0;
      state.batchPoll = root.setInterval(function () {
        tries += 1;
        var newest = state.batches.batches[0];
        if (tries > BATCH_POLL_TRIES || (tries > 1 && !batchBusy(newest))) {
          root.clearInterval(state.batchPoll);
          state.batchPoll = null;
          return;
        }
        if (!doc.hidden) loadBatches();
      }, BATCH_POLL_MS);
    }

    /* Write now: the frame's cost sheet first (design §5 rule 3), then one
       POST with a fresh request_id. No sheet, no spend. */
    function writeNow() {
      if (state.ui.writing || !writeNowShown(state.batches)) return;
      var n = state.ui.count;
      if (typeof frameCtx.costSheet !== "function") {
        state.ui.wnSay = { tone: "err", text: "This page could not show the cost first, so nothing was started. Reload the page and try again." };
        paintParts();
        return;
      }
      var sheet = writeNowSheet(n, state.health);
      Promise.resolve(frameCtx.costSheet(sheet)).then(function (yes) {
        if (yes !== true) return null;
        state.ui.writing = true;
        state.ui.wnSay = { tone: "wait", text: "Starting…" };
        paintParts();
        return api("/api/marketing/batches/write-now", { method: "POST", body: writeNowRequest(n, requestId()) }).then(function (res) {
          var out = summarizeWriteNow(res, n);
          state.ui.writing = false;
          state.ui.wnSay = out;
          paintParts();
          if (out.ok) { loadBatches(); watchBatch(); }
        });
      }).then(null, function () {
        state.ui.writing = false;
        state.ui.wnSay = { tone: "err", text: "Something went wrong on this page. Reload it and try again." };
        paintParts();
      });
    }

    /* Use this angle: saves the planner's suggestion as an idea (spec §7.5
       step 7). Free, so no sheet. The plan is read again after, and the
       planner leaves out an angle a waiting idea already names. */
    function useAngle(key) {
      var part = state.next;
      if (!part || part.state !== "ok" || state.ui.saving[key]) return;
      var s = null;
      part.next.suggestions.forEach(function (x) { if ((x.angleKey || x.name) === key) s = x; });
      if (!s) return;
      var week = part.next.weekKey;
      state.ui.saving[key] = true;
      state.ui.ideaSay = null;
      paintParts();
      api("/api/marketing/ideas", { method: "POST", body: ideaRequest(s, requestId()) }).then(function (res) {
        var out = summarizeIdea(res, s.name || prettyKey(s.angleKey), Date.now());
        delete state.ui.saving[key];
        state.ui.ideaSay = out;
        if (out.ok) state.ui.accepted[week + ":" + key] = Date.now();
        paintParts();
        if (out.ok) loadNext();
      }, function () {
        delete state.ui.saving[key];
        state.ui.ideaSay = { tone: "err", text: "Something went wrong on this page. Reload it and try again." };
        paintParts();
      });
    }

    /* Retry: one stuck job back in the queue (POST marketing/jobs/retry).
       Free. The row says what happened; the health card is read again. */
    function retry(jobId) {
      if (!jobId || state.ui.retrying[jobId]) return;
      state.ui.retrying[jobId] = true;
      delete state.ui.retried[jobId];
      paint();
      api("/api/marketing/jobs/retry", { method: "POST", body: retryRequest(jobId, requestId()) }).then(function (res) {
        var now = Date.now();
        var out = summarizeRetry(res, now);
        delete state.ui.retrying[jobId];
        state.ui.retried[jobId] = { at: now, ok: out.ok, tone: out.tone, text: out.text };
        paint();
        if (out.ok) loadHealth();
      }, function () {
        delete state.ui.retrying[jobId];
        state.ui.retried[jobId] = { at: Date.now(), ok: false, tone: "err", text: "Something went wrong on this page. Reload it and try again." };
        paint();
      });
    }

    panel.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || t.disabled) return;
      var act = t.getAttribute("data-act");
      if (act === "write-now") writeNow();
      else if (act === "use-angle") useAngle(t.getAttribute("data-angle"));
      else if (act === "retry") retry(t.getAttribute("data-job"));
    });
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.id === "writeNowCount") {
        var n = Number(t.value);
        state.ui.count = WRITE_NOW_COUNTS.indexOf(n) === -1 ? WRITE_NOW_DEFAULT : n;
      }
    });

    /* load — GET marketing/today (and the videos waiting). A failed reload
       after a good load keeps the page painted and says how old it is. */
    function load() {
      if (state.loading) return Promise.resolve();
      state.loading = true;
      state.lastTry = Date.now();
      loadParts();
      return Promise.all([api("/api/marketing/today"), loadVideos()]).then(function (all) {
        var res = all[0];
        var banner = $("mccBanner");
        if (res.status === 200 && res.body && res.body.ok !== false) {
          state.view = normalizeToday(res.body);
          state.loadedAt = Date.now();
          banner.className = "banner err";
          banner.textContent = "";
        } else if (state.loadedAt) {
          banner.className = "banner err show";
          banner.textContent = refreshBanner(res, state.loadedAt);
        } else {
          state.view = normalizeToday(null);
          banner.className = "banner err show";
          banner.textContent = plainError(res, "today");
        }
        state.loading = false;
        paint();
        paintOffer();
      }, function () {
        state.loading = false;
      });
    }

    function refresh() {
      if (Date.now() - state.lastTry < FOCUS_GAP_MS) return;
      load();
    }

    function loadOffer() {
      return readOffer(deps).then(function (read) {
        state.offerRead = read;
        paintOffer();
        /* A run that was already going when the page opened is followed too. */
        if (read.job && (read.job.status === "queued" || read.job.status === "running")) pollOffer(read.job.id);
      });
    }

    function pollOffer(jobId) {
      if (state.polling || !jobId) return;
      state.polling = true;
      /* One run at a time: the button rests while this one is followed. */
      $("offerBtn").disabled = true;
      var tries = 0;
      function step() {
        tries += 1;
        readOffer(deps, jobId).then(function (read) {
          var out = offerPollStep(read);
          if (out.done) {
            state.polling = false;
            say("offerSay", out.tone, out.message);
            if (out.offer) state.offerRead = { state: "ok", message: "", job: read.job, offer: out.offer };
            else if (read.state === "ok") state.offerRead = read;
            paintOffer();
            return;
          }
          if (tries >= OFFER_POLL_TRIES) {
            state.polling = false;
            say("offerSay", "wait", "It is taking longer than usual. Reload this page later to see the offer.");
            paintOffer();
            return;
          }
          root.setTimeout(step, OFFER_POLL_MS);
        });
      }
      root.setTimeout(step, OFFER_POLL_MS);
    }

    /* One listener for every Show more / Read it button the renderers
       paint, so a repaint never loses its wiring. */
    panel.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("button[data-toggle]") : null;
      if (!t || t.disabled) return;
      setOpen(t, t.getAttribute("aria-expanded") !== "true");
    });

    $("copyForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("copyBtn");
      if (btn.classList.contains("busy")) return;
      var angle = $("copyAngle").value;
      var offerType = $("copyOffer").value;
      var stop = checkCopyInput(state.view, angle, offerType);
      if (stop) { say("copySay", "err", stop); return; }
      busy(btn, true, "Writing…");
      say("copySay", "wait", "Writing your ad copy. This can take up to half a minute.");
      $("copyResult").innerHTML = "";
      writeAdCopy(deps, state.view, angle, offerType).then(function (out) {
        say("copySay", out.tone, out.message);
        $("copyResult").innerHTML = renderPieces(out.pieces, Date.now(), "result");
        busy(btn, false, "Write ad copy");
        if (out.sent) { state.lastTry = 0; return load(); }
        return null;
      }, function () {
        say("copySay", "err", "Something went wrong on this page. Reload it and try again.");
        busy(btn, false, "Write ad copy");
      }).then(function () {
        btn.disabled = setupLine(state.view).bad;
      });
    });

    $("offerBtn").addEventListener("click", function () {
      var btn = $("offerBtn");
      if (btn.classList.contains("busy") || state.polling) return;
      busy(btn, true, "Starting…");
      startOffer(deps, state.view).then(function (out) {
        say("offerSay", out.tone, out.message);
        busy(btn, false, "Write offer");
        if (out.job && (out.job.status === "queued" || out.job.status === "running")) pollOffer(out.job.id);
      }, function () {
        say("offerSay", "err", "Something went wrong on this page. Reload it and try again.");
        busy(btn, false, "Write offer");
      });
    });

    /* Fresh numbers without a manual reload: when the tab comes back into
       view, and every 5 minutes while the page is open. */
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) refresh(); });
    root.addEventListener("focus", refresh);
    root.setInterval(function () { if (!doc.hidden) load(); }, RELOAD_MS);

    load();
    loadOffer();
  }
})(typeof window !== "undefined" ? window : globalThis);
