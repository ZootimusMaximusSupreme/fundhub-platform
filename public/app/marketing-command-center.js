/* marketing-command-center.js — the Marketing Command Center, Today view.

   WHAT THIS SCREEN IS. Chris's marketing dashboard: docs/specs/
   marketing-machine-2026-10-04.md §8.3 (the Today tab), built as the
   "smallest first slice" in docs/specs/marketing-dashboard-plan-2026-10-05.md.
   One page where the owner sees whether marketing is healthy, what waits on
   him, and presses ONE button — "Write ad copy".

   WHAT IT READS AND CALLS.
     GET  /api/marketing/today          everything on the page (owner/admin)
     POST /api/creative/generate        saves one ad copy job for the house partner
     POST /api/creative/run             runs it now instead of waiting for the clock
     POST /api/marketing/offer/generate writes an offer (the Offer card)
   The first and last are new endpoints. Until they ship, the page says so in
   plain words ("not ready yet") and invents nothing.

   NEVER FAKE A NUMBER. A missing or null value shows as "unknown", never as 0
   (CLAUDE.md §12: NULL means unknown and must survive). An empty list says
   "nothing yet". There is no sample data anywhere in this file.

   TESTABLE WITHOUT A BROWSER. Every rule that turns data into words is a plain
   function on window.FHMarketingCC, and src/ui/marketing-command-center.test.mjs
   runs this file in node:vm (the pattern src/training/ramp-quizzes.test.mjs
   uses). The DOM wiring at the bottom only runs when the page's own root
   element exists. */
(function (root) {
  "use strict";

  /* ── words and lists ─────────────────────────────────────────────────── */

  /* The three bodies of law an ad is screened under (src/compliance/screen.mjs
     OFFER_TYPES). The endpoint refuses anything else, so this list is exact. */
  var OFFER_TYPES = ["funding", "credit_cards", "credit_repair"];

  /* The five flywheel steps (marketing/flywheel/README.md). A sixth row,
     spend, checks results; it is not one of the five and is not shown. */
  var FIVE = ["avatar", "ad-research", "offer", "copy", "ad-strategy"];
  var STAGE_NAMES = {
    "avatar": "Avatar",
    "ad-research": "Ad research",
    "offer": "Offer",
    "copy": "Copy",
    "ad-strategy": "Ad strategy"
  };

  var DAY_MS = 86400000;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── reading the endpoint's answer ───────────────────────────────────── */

  /* The contract for GET marketing/today is written by the back-end workflow
     (M10). This page reads either spelling of a key — spend7dCents or
     spend_7d_cents — so a naming choice on the server cannot blank the page. */
  function snakeOf(name) {
    return name.replace(/([a-z])([0-9])/g, "$1_$2").replace(/[A-Z]/g, function (c) {
      return "_" + c.toLowerCase();
    });
  }
  function first(obj, names) {
    if (obj == null || typeof obj !== "object") return undefined;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var variants = [n, snakeOf(n), n.replace(/[A-Z]/g, function (c) { return "_" + c.toLowerCase(); })];
      for (var j = 0; j < variants.length; j++) {
        if (Object.prototype.hasOwnProperty.call(obj, variants[j]) && obj[variants[j]] !== undefined) {
          return obj[variants[j]];
        }
      }
    }
    return undefined;
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

  function normalizePiece(p) {
    p = obj(p);
    var reasons = arr(first(p, ["blockedReasons", "reasons"]));
    if (!reasons.length) reasons = arr(obj(first(p, ["screen"])).reasons);
    return {
      id: first(p, ["id", "assetId"]) || null,
      text: str(first(p, ["copyText", "text", "words"])),
      state: str(first(p, ["complianceState", "state"]) || "pending").toLowerCase(),
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
      finishedAt: first(j, ["finishedAt"]) || null
    };
  }

  function normalizeStage(r) {
    r = obj(r);
    var meta = obj(first(r, ["meta"]));
    var status = first(meta, ["status"]);
    var key = str(first(r, ["key"]));
    return {
      n: num(first(r, ["n", "stage"])),
      key: key,
      label: str(first(r, ["label", "name"]) || key),
      state: str(first(r, ["state"])).toUpperCase() || null,
      reasons: arr(first(r, ["reasons"])).map(str).filter(Boolean),
      approved: first(r, ["approved"]) === true || str(status).toLowerCase() === "approved"
    };
  }

  function normalizeOffer(o) {
    if (o == null) return null;
    if (typeof o === "string") return o.trim() ? { text: o, title: "", createdAt: null, status: "" } : null;
    o = obj(o);
    var text = str(first(o, ["summary", "text", "markdown", "body", "offer", "content"]));
    var title = str(first(o, ["title", "name", "headline"]));
    if (!text && !title) return null;
    return {
      text: text,
      title: title,
      createdAt: first(o, ["createdAt", "savedAt", "generatedAt"]) || null,
      status: str(first(o, ["status", "state"]))
    };
  }

  function normalizeList(list, mapper) {
    return Array.isArray(list) ? list.map(mapper) : null;
  }

  /* normalizeToday — one shape for the page, whatever spelling the server used.
     Called with null when the read failed: every number comes back unknown. */
  function normalizeToday(body) {
    var b = obj(body);
    var numbers = obj(first(b, ["numbers", "spend"]));
    var house = obj(first(b, ["house"]));
    var ready = obj(first(b, ["copyReady"]));
    var copy = obj(first(b, ["copy"]));
    var flyRaw = first(b, ["flywheel"]);
    var fly = obj(flyRaw);
    var offer = obj(first(b, ["offer"]));
    var stagesRaw = Array.isArray(flyRaw) ? flyRaw : arr(first(fly, ["stages", "rows"]));

    var stages = stagesRaw.map(normalizeStage)
      .filter(function (s) { return FIVE.indexOf(s.key) !== -1; })
      .sort(function (a, c) { return (a.n || 0) - (c.n || 0); });

    return {
      /* true when the server answered at all. A 200 with none of these keys
         is still loaded: every number in it is honestly unknown. */
      loaded: body != null && typeof body === "object",
      asOf: first(b, ["asOf"]) || first(numbers, ["asOf"]) || null,
      partnerId: first(house, ["partnerId", "id"]) || first(b, ["housePartnerId", "partnerId"]) ||
        first(ready, ["partnerId"]) || null,
      spend7: num(first(numbers, ["spend7dCents", "spend7Cents", "last7Cents", "spendLast7Cents"])),
      spendPrev7: num(first(numbers, ["spendPrev7dCents", "spendPrev7Cents", "prev7Cents", "spendPrior7Cents"])),
      spend30: num(first(numbers, ["spend30dCents", "spend30Cents", "last30Cents", "spendLast30Cents"])),
      spendPrev30: num(first(numbers, ["spendPrev30dCents", "spendPrev30Cents", "prev30Cents", "spendPrior30Cents"])),
      copyReady: {
        switchOn: bool(first(ready, ["switchOn", "marketingOn", "suiteEnabled"])),
        provider: bool(first(ready, ["provider", "providerRow"])),
        anthropicKey: bool(first(ready, ["anthropicKey", "key", "modelKey"]))
      },
      pieces: arr(first(copy, ["pieces", "assets"])).map(normalizePiece),
      jobs: arr(first(copy, ["jobs"])).map(normalizeJob),
      campaign: str(first(fly, ["campaign"])) || null,
      stages: stages,
      offerLatest: normalizeOffer(first(offer, ["latest"])),
      waiting: normalizeList(first(b, ["waiting"]), function (w) {
        w = typeof w === "string" ? { what: w } : obj(w);
        return { what: str(first(w, ["what", "title", "label"])), why: str(first(w, ["why", "note", "detail"])) };
      }),
      parts: normalizeList(first(b, ["parts"]), function (p) {
        p = obj(p);
        return {
          label: str(first(p, ["label", "name", "key"])),
          ready: bool(first(p, ["ready", "ok"])),
          note: str(first(p, ["note", "why", "detail"]))
        };
      })
    };
  }

  /* ── turning data into words ─────────────────────────────────────────── */

  /* money — integer cents to dollars. null stays "unknown"; a real 0 is "$0". */
  function money(cents) {
    var n = num(cents);
    if (n === null) return "unknown";
    var dollars = Math.abs(n) / 100;
    var whole = dollars >= 100 || dollars === 0 || Math.round(dollars) === dollars;
    return (n < 0 ? "-$" : "$") + dollars.toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2
    });
  }

  /* compare — every metric has a comparison (UI-STANDARDS §7), said in words,
     never by colour alone (§12.6). */
  function compare(cur, prev, span) {
    var c = num(cur);
    var p = num(prev);
    var before = "the " + span + " before";
    if (p === null) return "No number for " + before + ".";
    if (c === null) return "The " + span + " before: " + money(p) + ".";
    if (p === 0) return c === 0 ? "Same as " + before + " ($0)." : "Up from $0 " + before + ".";
    var pct = Math.round(((c - p) / p) * 100);
    if (pct === 0) return "About the same as " + before + " (" + money(p) + ").";
    return (pct > 0 ? "Up " : "Down ") + Math.abs(pct) + "% from " + money(p) + " " + before + ".";
  }

  /* when — relative under a day, a date after, the exact time in the tooltip
     (UI-STANDARDS §7). A missing time is "unknown", not "now". */
  function when(iso, nowMs) {
    if (!iso) return { text: "unknown", title: "" };
    var d = new Date(iso);
    var t = d.getTime();
    if (isNaN(t)) return { text: "unknown", title: "" };
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var title = d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
    var diff = now - t;
    if (diff >= 0 && diff < DAY_MS) {
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return { text: "just now", title: title };
      if (mins < 60) return { text: mins + (mins === 1 ? " minute ago" : " minutes ago"), title: title };
      var h = Math.floor(mins / 60);
      return { text: h + (h === 1 ? " hour ago" : " hours ago"), title: title };
    }
    return {
      text: d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      title: title
    };
  }

  /* plainReasons — the flywheel checker's reasons, readable. It writes count
     keys as code names ("did not report distinctReasons"); those become words. */
  function plainReasons(list) {
    var out = arr(list).map(function (r) {
      return str(r).replace(/\b([a-z]+)([A-Z][a-zA-Z]*)\b/g, function (m) {
        return m.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      }).trim();
    }).filter(Boolean).join("; ");
    if (!out) return "";
    out = out.charAt(0).toUpperCase() + out.slice(1);
    return /[.!?]$/.test(out) ? out : out + ".";
  }

  function stageName(s) {
    return STAGE_NAMES[s.key] || (s.label ? s.label.charAt(0).toUpperCase() + s.label.slice(1) : "Step");
  }

  /* stageWord — the checker's state names, in words a person uses. */
  function stageWord(s) {
    switch (s && s.state) {
      case "READY":
        return s.approved
          ? { word: "Done", tone: "on", why: "" }
          : { word: "Needs your OK", tone: "wip", why: "It is done. It waits for you to read it and say yes." };
      case "APPROVED":
        return { word: "Done", tone: "on", why: "" };
      case "FAILED":
        return { word: "Needs a redo", tone: "bad", why: plainReasons(s.reasons) };
      case "STALE":
        return { word: "Out of date", tone: "wip", why: plainReasons(s.reasons) || "An earlier step changed." };
      case "BLOCKED":
        return { word: "Waiting on an earlier step", tone: "wip", why: plainReasons(s.reasons) };
      case "MISSING":
        return { word: "Not started", tone: "", why: plainReasons(s.reasons) || "It has not been run yet." };
      default:
        return { word: "Unknown", tone: "", why: "" };
    }
  }

  /* deriveWaiting — what waits on Chris. The server's own list wins when it
     sends one; otherwise it is read off the flywheel rows, and nothing else. */
  function deriveWaiting(view) {
    if (view && view.waiting) return view.waiting;
    var out = [];
    arr(view && view.stages).forEach(function (s) {
      var name = stageName(s).toLowerCase();
      if (s.state === "READY" && !s.approved) {
        out.push({ what: "Read and approve the " + name + " step", why: "It is done and waits for your yes." });
      } else if (s.state === "FAILED") {
        out.push({ what: "Redo the " + name + " step", why: plainReasons(s.reasons) });
      } else if (s.state === "STALE") {
        out.push({ what: "Redo the " + name + " step", why: "An earlier step changed, so this one is out of date." });
      }
    });
    return out;
  }

  /* The Meta pull runs once a day (meta-campaign-sync-sweeper, cron 0 7 * * *).
     Older than two days means at least one daily pull was missed. */
  var META_FRESH_MS = 2 * DAY_MS;

  function deriveParts(view, nowMs) {
    if (view && view.parts) return view.parts;
    var v = view || {};
    var r = v.copyReady || {};
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var asOfMs = v.asOf ? new Date(v.asOf).getTime() : NaN;
    var meta;
    if (!v.loaded) meta = { ready: null, note: "Not known yet." };
    else if (isNaN(asOfMs)) meta = { ready: false, note: "No Meta pull is on file." };
    else meta = {
      ready: now - asOfMs <= META_FRESH_MS,
      note: "Last pulled " + when(v.asOf, now).text + "." +
        (now - asOfMs > META_FRESH_MS ? " It should pull every day." : "")
    };
    function part(label, value, onNote, offNote) {
      return {
        label: label,
        ready: value,
        note: value === true ? onNote : (value === false ? offNote : "Not known yet.")
      };
    }
    return [
      { label: "Ad numbers from Meta", ready: meta.ready, note: meta.note },
      part("Marketing switch for the Fundhub house account", r.switchOn,
        "On.", "Off, so ad copy cannot be written."),
      part("Copy writer set up", r.provider,
        "Set up.", "Not set up, so ad copy cannot be written."),
      part("AI key for writing", r.anthropicKey,
        "Saved.", "Missing, so ad copy cannot be written.")
    ];
  }

  /* setupBlock — the one sentence that says why "Write ad copy" cannot work
     yet, before it is pressed. Only an explicit "no" counts; unknown is not no. */
  function setupBlock(r) {
    r = r || {};
    var missing = [];
    if (r.switchOn === false) missing.push("marketing is switched off for the Fundhub house account");
    if (r.provider === false) missing.push("no copy writer is set up");
    if (r.anthropicKey === false) missing.push("the AI key is missing");
    if (!missing.length) return null;
    var list = missing.length === 1 ? missing[0]
      : missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1];
    return "This cannot write yet: " + list + ".";
  }

  function setupLine(view) {
    if (!view || !view.loaded) {
      return { bad: true, text: "This needs the marketing numbers to load first, so it knows which account to write for." };
    }
    if (!view.partnerId) {
      return { bad: true, text: "The page could not find the Fundhub house account, so it cannot write yet." };
    }
    var block = setupBlock(view.copyReady);
    if (block) return { bad: true, text: block };
    var r = view.copyReady;
    if (r.switchOn === true && r.provider === true && r.anthropicKey === true) {
      return { bad: false, text: "Ready. It writes one ad and checks it against the ad rules." };
    }
    return { bad: false, text: "It writes one ad and checks it against the ad rules." };
  }

  /* plainError — what failed, in the words of the person it happened to.
     Never a raw status code (UI-STANDARDS §6.3). */
  function plainError(res, what) {
    var body = obj(res && res.body);
    var err = str(body.error);
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

  function newKey(nowMs, rand) {
    var stamp = new Date(typeof nowMs === "number" ? nowMs : Date.now())
      .toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    var tail = String(typeof rand === "number" ? rand : Math.random()).replace(/\D/g, "").slice(-6) || "000000";
    return "mcc-copy-" + stamp + "-" + tail;
  }

  /* checkCopyInput — stop before anything is sent, with one plain question. */
  function checkCopyInput(view, angle, offerType) {
    if (!view || !view.loaded) return "The marketing numbers have not loaded yet, so nothing was sent. Reload the page and try again.";
    if (!view.partnerId) return "The page could not find the Fundhub house account, so nothing was sent.";
    var block = setupBlock(view.copyReady);
    if (block) return block;
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
     { status, body, transport }. Resolves to { tone, message, pieces }. */
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
        body: { partner_id: view.partnerId, max_jobs: 3 }
      }).then(function (run) {
        var out = summarizeRun(run, jobId);
        out.sent = true;
        return out;
      });
    });
  }

  /* ── Write offer ─────────────────────────────────────────────────────── */

  function offerRequest(view) {
    var body = { campaign: (view && view.campaign) || "partner" };
    if (view && view.partnerId) body.partner_id = view.partnerId;
    return body;
  }

  function summarizeOffer(res) {
    if (!res || res.transport || res.status === 0) {
      return { tone: "err", message: plainError(res, "offer"), offer: null };
    }
    if (res.status === 404) return { tone: "wait", message: plainError(res, "offer"), offer: null, notReady: true };
    if (res.status === 502 || res.status === 504) {
      return { tone: "wait", message: "It is still writing. Reload this page in a few minutes to see the new offer.", offer: null };
    }
    var body = obj(res.body);
    if (res.status !== 200 || body.ok === false) {
      return { tone: "err", message: plainError(res, "offer"), offer: null };
    }
    var offer = normalizeOffer(first(body, ["offer", "latest", "result"]));
    return {
      tone: "ok",
      message: offer ? "Done. Here is the new offer." : "Done. The offer writer finished.",
      offer: offer
    };
  }

  function writeOffer(deps, view) {
    return deps.api("/api/marketing/offer/generate", { method: "POST", body: offerRequest(view) })
      .then(summarizeOffer);
  }

  /* ── markup (pure: data in, HTML string out) ─────────────────────────── */

  function chip(word, tone) {
    return '<span class="chip' + (tone ? " " + tone : "") + '"><span class="cd"></span>' + esc(word) + "</span>";
  }

  function timeTag(iso, nowMs) {
    var w = when(iso, nowMs);
    return '<span title="' + esc(w.title) + '">' + esc(w.text) + "</span>";
  }

  function renderSpendTile(view, which, nowMs) {
    var v = view || {};
    var seven = which === 7;
    var cur = seven ? v.spend7 : v.spend30;
    var prev = seven ? v.spendPrev7 : v.spendPrev30;
    var html = '<span class="caption">Ad spend, last ' + (seven ? "7" : "30") + " days</span>" +
      '<span class="vl" data-value="' + esc(money(cur)) + '">' + esc(money(cur)) + "</span>" +
      '<span class="cmp">' + esc(compare(cur, prev, seven ? "7 days" : "30 days")) + "</span>";
    if (seven) {
      html += '<span class="note">Meta numbers as of ' + timeTag(v.asOf, nowMs) + ". " +
        '<a href="campaign-manager.html">See every ad in Campaigns</a></span>';
    }
    return html;
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
    return '<span class="caption">Machine parts ready</span>' +
      '<span class="vl">' + esc(value) + "</span>" +
      '<span class="cmp">' + esc(cmp) + "</span>";
  }

  function notLoaded() {
    return '<p class="muted">Not loaded. The note at the top of the page says why.</p>';
  }

  function renderWaiting(view) {
    if (!view || !view.loaded) return notLoaded();
    var list = deriveWaiting(view);
    if (!list.length) return '<p class="muted">Nothing is waiting on you right now.</p>';
    return '<ol class="rows">' + list.map(function (w) {
      return '<li class="row"><div class="row-main"><b>' + esc(w.what) + "</b>" +
        (w.why ? '<div class="row-why">' + esc(w.why) + "</div>" : "") + "</div></li>";
    }).join("") + "</ol>";
  }

  function renderFlywheel(view) {
    if (!view || !view.loaded) return notLoaded();
    if (!view.stages.length) return '<p class="muted">No flywheel steps are on file yet.</p>';
    return '<ol class="rows">' + view.stages.map(function (s) {
      var w = stageWord(s);
      return '<li class="row" data-stage="' + esc(s.key) + '">' +
        '<span class="row-n">' + esc(s.n == null ? "" : s.n) + "</span>" +
        '<div class="row-main"><b>' + esc(stageName(s)) + "</b>" +
        (w.why ? '<div class="row-why">' + esc(w.why) + "</div>" : "") + "</div>" +
        chip(w.word, w.tone) + "</li>";
    }).join("") + "</ol>";
  }

  function offerStage(view) {
    var stages = arr(view && view.stages);
    for (var i = 0; i < stages.length; i++) if (stages[i].key === "offer") return stages[i];
    return null;
  }

  function renderOfferStatus(view) {
    if (!view || !view.loaded) return notLoaded();
    var s = offerStage(view);
    if (!s) return '<p class="muted">Offer step status: unknown. No flywheel row for it is on file.</p>';
    var w = stageWord(s);
    return '<div class="row-main"><div class="piece-hd"><span>Step 3 of the flywheel</span>' + chip(w.word, w.tone) + "</div>" +
      (w.why ? '<div class="row-why">' + esc(w.why) + "</div>" : "") + "</div>";
  }

  function renderOffer(offer, nowMs) {
    if (!offer) return "";
    return '<div class="pieces"><div class="piece">' +
      '<div class="piece-hd"><b>' + esc(offer.title || "Latest offer") + "</b>" +
      (offer.createdAt ? '<span class="caption faint">' + timeTag(offer.createdAt, nowMs) + "</span>" : "") + "</div>" +
      (offer.text ? '<div class="words">' + esc(offer.text) + "</div>" : "") +
      "</div></div>";
  }

  function renderOfferLatest(view, nowMs) {
    if (!view || !view.loaded) return "";
    if (!view.offerLatest) return '<p class="muted gap-top">No offer has been written here yet.</p>';
    return renderOffer(view.offerLatest, nowMs);
  }

  var SCREEN_WORDS = { passed: "Passed the ad rules", blocked: "Stopped by the ad rules", pending: "Being checked" };

  function renderPieces(pieces, nowMs) {
    if (!pieces || !pieces.length) return "";
    return '<div class="pieces">' + pieces.map(function (p) {
      var tone = p.state === "passed" ? "on" : (p.state === "blocked" ? "bad" : "wip");
      return '<div class="piece">' +
        '<div class="piece-hd">' + chip(SCREEN_WORDS[p.state] || "Unknown", tone) +
        (p.createdAt ? '<span class="caption faint">' + timeTag(p.createdAt, nowMs) + "</span>" : "") + "</div>" +
        (p.text ? '<div class="words">' + esc(p.text) + "</div>" : '<p class="muted">No words were saved with this one.</p>') +
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
      html += renderPieces(view.pieces.slice(0, 10), nowMs);
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

  var API = {
    OFFER_TYPES: OFFER_TYPES,
    FIVE: FIVE,
    normalizeToday: normalizeToday,
    normalizePiece: normalizePiece,
    normalizeOffer: normalizeOffer,
    money: money,
    compare: compare,
    when: when,
    plainReasons: plainReasons,
    stageWord: stageWord,
    deriveWaiting: deriveWaiting,
    deriveParts: deriveParts,
    setupBlock: setupBlock,
    setupLine: setupLine,
    plainError: plainError,
    jobReason: jobReason,
    newKey: newKey,
    checkCopyInput: checkCopyInput,
    copyRequest: copyRequest,
    summarizeRun: summarizeRun,
    writeAdCopy: writeAdCopy,
    offerRequest: offerRequest,
    summarizeOffer: summarizeOffer,
    writeOffer: writeOffer,
    renderSpendTile: renderSpendTile,
    renderPartsTile: renderPartsTile,
    renderWaiting: renderWaiting,
    renderFlywheel: renderFlywheel,
    renderOfferStatus: renderOfferStatus,
    renderOfferLatest: renderOfferLatest,
    renderPieces: renderPieces,
    renderLatest: renderLatest,
    renderParts: renderParts
  };
  root.FHMarketingCC = API;

  /* ── the page ────────────────────────────────────────────────────────── */

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== "function") return;

  function boot() {
    if (!doc.getElementById("mcc-root")) return;
    function $(id) { return doc.getElementById(id); }

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
      return root.fetch(path, opts).then(
        function (r) {
          return r.json().then(
            function (b) { return { status: r.status, body: b }; },
            function () { return { status: r.status, body: null }; }
          );
        },
        function (e) { return { status: 0, body: null, transport: (e && e.message) || "network error" }; }
      );
    }

    var state = { view: normalizeToday(null), offer: null };

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

    function paint() {
      var v = state.view;
      var now = Date.now();
      $("tileSpend7").innerHTML = renderSpendTile(v, 7, now);
      $("tileSpend30").innerHTML = renderSpendTile(v, 30, now);
      $("tileParts").innerHTML = renderPartsTile(v, now);
      var waiting = v.loaded ? deriveWaiting(v) : [];
      $("waitingCount").textContent = v.loaded ? (waiting.length ? waiting.length + " to do" : "") : "";
      $("waitingList").innerHTML = renderWaiting(v);
      $("flywheelCampaign").textContent = v.loaded && v.campaign ? "Campaign: " + v.campaign : "";
      $("flywheelList").innerHTML = renderFlywheel(v);
      $("offerStatus").innerHTML = renderOfferStatus(v);
      $("offerLatest").innerHTML = state.offer ? renderOffer(state.offer, now) : renderOfferLatest(v, now);
      $("healthList").innerHTML = renderParts(v, now);
      $("latestList").innerHTML = renderLatest(v, now);
      var line = setupLine(v);
      var setup = $("copySetup");
      setup.textContent = line.text;
      setup.className = "setup caption" + (line.bad ? " bad" : "");
      var btn = $("copyBtn");
      if (!btn.classList.contains("busy")) btn.disabled = line.bad;
      $("mccStamp").textContent = v.loaded ? "Loaded " + when(new Date(now).toISOString(), now).text : "Not loaded";
    }

    function load() {
      return api("/api/marketing/today").then(function (res) {
        var banner = $("mccBanner");
        if (res.status === 200 && res.body && res.body.ok !== false) {
          state.view = normalizeToday(res.body);
          banner.className = "banner err";
          banner.textContent = "";
        } else {
          state.view = normalizeToday(null);
          banner.className = "banner err show";
          banner.textContent = plainError(res, "today");
        }
        paint();
      });
    }

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
      writeAdCopy({ api: api }, state.view, angle, offerType).then(function (out) {
        say("copySay", out.tone, out.message);
        $("copyResult").innerHTML = renderPieces(out.pieces, Date.now());
        busy(btn, false, "Write ad copy");
        if (out.sent) return load();
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
      if (btn.classList.contains("busy")) return;
      busy(btn, true, "Writing…");
      say("offerSay", "wait", "Writing the offer. This can take a few minutes.");
      writeOffer({ api: api }, state.view).then(function (out) {
        say("offerSay", out.tone, out.message);
        if (out.offer) {
          state.offer = out.offer;
          $("offerLatest").innerHTML = renderOffer(out.offer, Date.now());
        }
        busy(btn, false, "Write offer");
      }, function () {
        say("offerSay", "err", "Something went wrong on this page. Reload it and try again.");
        busy(btn, false, "Write offer");
      });
    });

    load();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
