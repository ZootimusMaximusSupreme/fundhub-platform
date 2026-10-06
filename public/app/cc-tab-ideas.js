/* ══ COMMAND CENTER — the Ideas tab (build unit X8) ══════════════════════════
   What should we make next, and what do we know? docs/specs/
   command-center-design-2026-10-05.md §3.2 is the design, §5 the safety rules,
   docs/specs/command-center-tabs.md the plug-in contract, docs/rules/
   UI-STANDARDS.md the law. Phone first (390px), plain words.

   Cards, top to bottom:
     meter        GET marketing/costs (month used of cap)
     ideas        GET/POST marketing/ideas, GET marketing/batches,
                  POST marketing/batches/write-now (Write now from one idea)
     suggestions  GET marketing/batches/next (the planner's 3), Accept
     angles       GET marketing/angles, Make more of this
     research     GET/POST marketing/research (+ ?id=, approve, tweak, brain),
                  POST marketing/jobs/retry
     flywheel     GET marketing/flywheel, POST marketing/flywheel/run|approve|
                  tweak|spend-read|campaign (step 3's run goes through
                  flywheel/run, which hands it to the Write offer path)
     funnels      GET marketing/funnels, GET marketing/funnel?id=,
                  POST marketing/funnels/create|rename|build|push-live
     quick copy   GET marketing/today (house account + last pieces),
                  POST creative/generate + POST creative/run {max_jobs:1}
     proof        one honest sentence until slice 11 ships

   RULES THIS FILE KEEPS (design §5):
     3  every paid button prints its cost under it BEFORE the tap, read from
        GET marketing/costs; no ledger row = "Cost: unknown, not measured yet."
     5  Push live takes two taps and the second names the address.
     9  a part whose back end is not deployed shows one honest sentence, never
        a dead button. Nothing here sends Chris to a chat (design §3.9).
     8  null is "unknown", never $0.
   Sizes come only from the brand whitelist (h2, .caption, .eyebrow, .chip,
   .vl), so this file and cc-tab-ideas.css write no font sizes.

   Every rule that turns data into words is on window.FundhubIdeasTab so
   src/ui/cc-tab-ideas.test.mjs can run it in node:vm. */
(function (root) {
  "use strict";

  var doc = root.document;

  /* ── tiny helpers ──────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? "" : String(v); }
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function camel(k) { return k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
  /* pick — the first key that is present, in snake_case or camelCase. */
  function pick(o, names) {
    o = obj(o);
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (o[k] !== undefined) return o[k];
      var c = camel(k);
      if (o[c] !== undefined) return o[c];
    }
    return undefined;
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  /* ── constants ─────────────────────────────────────────────────────────── */

  /* Anthropic bills web search at $10 per 1,000 searches. */
  var USD_PER_SEARCH = 0.01;
  /* The design's search limits (§2 J1, J2, J20). The last fallback only: the
     page reads the server's own limits first (searchCeiling below). */
  var SEARCH_LIMITS = Object.freeze({
    avatar: 184,
    ad_research: 106,
    ad_research_retries: 138,
    research_quick: 62,
    research_deep: 542
  });

  var FORMATS = Object.freeze([
    ["", "Any format"],
    ["standard", "Standard"],
    ["sorting", "Short (sorting hat)"],
    ["long", "Long"],
    ["notes", "Notes"],
    ["vsl", "VSL"]
  ]);

  /* The offers a funnel can be built for (src/marketing/funnel-paths.mjs
     FUNNEL_OFFERS: both are sold on a call). */
  var FUNNEL_OFFERS = Object.freeze([
    ["capital_blueprint", "Capital Blueprint (book a call)"],
    ["funding_dfy", "Funding, done for you (book a call)"]
  ]);

  /* Every offer key in src/config/offers.mjs, for Start a flywheel when the
     server does not send its own list. src/ui/cc-tab-ideas.test.mjs fails if
     this list and OFFER_KEYS drift apart. */
  var FLYWHEEL_OFFERS = Object.freeze([
    ["UWIQ_DELIVERABLES", "Capital Blueprint"],
    ["FUNDING_DFY", "Funding, done-for-you"],
    ["FUNDING_MASTERY", "Capital Academy"],
    ["REPAIR_DFY", "Credit repair, done-for-you"],
    ["REPAIR_TRIAL", "Repair test run (first round, done for you)"],
    ["SOFT_PULL", "UnderwriteIQ soft-pull assessment"],
    ["DECLINE_AUTOPSY", "Decline Autopsy"],
    ["WINNERS_BOARD", "Winner's Board"],
    ["LIVE_TRIAL", "Live Trial — seven days under your brand"],
    ["PARTNER_ENTRY", "White-label partner program"]
  ]);

  var QUICK_OFFERS = Object.freeze([
    ["funding", "Funding"],
    ["credit_cards", "Credit cards"],
    ["credit_repair", "Credit repair"]
  ]);

  /* The six flywheel steps, in the design's plain names (§3.2 item 6). */
  var STAGES = Object.freeze([
    { n: 1, key: "avatar", name: "Who we sell to", run: "Build the avatar", kind: "avatar", jobKind: "avatar", needs: [] },
    { n: 2, key: "ad-research", name: "What the market sells", run: "Research the market", kind: "ad_research", jobKind: "ad_research", needs: [] },
    { n: 3, key: "offer", name: "The offer", run: "Write the offer", kind: "offer", jobKind: "offer", needs: [] },
    { n: 4, key: "copy", name: "Ad copy", run: "Write the copy", kind: "copy", jobKind: "copy", needs: [3] },
    { n: 5, key: "ad-strategy", name: "Which ad strategy", run: "Pick the strategy", kind: "ad_strategy", jobKind: "ad_strategy", needs: [3, 4] },
    { n: 6, key: "spend", name: "Read the spend", run: "Read the spend", kind: null, jobKind: null, needs: [], free: true }
  ]);

  /* Which slice ships each part (design §6), for the honest sentence. */
  var SHIPS_IN = Object.freeze({
    flywheel: "slice 5",
    research: "slice 10",
    suggestions: "slice 3",
    angles: "slice 4",
    funnels: "the funnel builder update",
    ideas: "slice 3",
    proof: "slice 11",
    quick: "slice 0"
  });

  /* ── words: shared ─────────────────────────────────────────────────────── */

  function notBuiltSentence(part) {
    return "Not on this page yet: it ships in " + (SHIPS_IN[part] || "a later slice") + ".";
  }

  /* dollars — model bills are dollars with decimals (_usd keys). */
  function dollars(usd) {
    var n = num(usd);
    if (n === null) return "unknown";
    if (n > 0 && n < 0.01) return "under 1 cent";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* money — client money is integer cents. null stays "unknown"; 0 is $0.00. */
  function money(cents) {
    var n = num(cents);
    if (n === null) return "unknown";
    var neg = n < 0;
    var s = (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? "-$" : "$") + s;
  }

  function count(v) {
    var n = num(v);
    return n === null ? "unknown" : n.toLocaleString("en-US");
  }

  /* shortDate — "Oct 7" in Arizona time, or "" when there is no date. */
  function shortDate(iso) {
    var t = Date.parse(str(iso));
    if (!Number.isFinite(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" }).format(new Date(t));
    } catch (e) {
      return new Date(t).toISOString().slice(0, 10);
    }
  }

  function clockTime(iso) {
    var t = Date.parse(str(iso));
    if (!Number.isFinite(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }).format(new Date(t));
    } catch (e) {
      return new Date(t).toISOString().slice(11, 16);
    }
  }

  /* plannerWhen — 3 hours before the next drop, as "Monday 4:00 am" in
     Arizona time, or "" when the drop time is unknown. */
  function plannerWhen(releaseAt) {
    var t = Date.parse(str(releaseAt));
    if (!Number.isFinite(t)) return "";
    try {
      var d = new Date(t - 3 * 3600 * 1000);
      var day = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Phoenix" }).format(d);
      var time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }).format(d);
      return day + " " + time.replace(/\s?AM$/, " am").replace(/\s?PM$/, " pm");
    } catch (e) {
      return "";
    }
  }

  /* campaignWords — a flywheel folder name in plain words. */
  function campaignWords(key) {
    var k = str(key).trim();
    if (!k) return "";
    if (k === "partner") return "Partner offer";
    var w = k.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /* ── the API answer, normalized ───────────────────────────────────────── */

  /* answer — ctx.api's {ok, status, data, error, conflict, current} with two
     extra facts: notBuilt (the router has no such route yet: its 404 names the
     path) and words (what to print when it failed). */
  function answer(res) {
    res = obj(res);
    var data = res.data !== undefined ? res.data : res.body;
    var d = obj(data);
    var status = num(res.status) || 0;
    var ok = res.ok === true || (res.ok === undefined && status >= 200 && status < 300 && d.ok !== false);
    var notBuilt = status === 404 && Object.prototype.hasOwnProperty.call(d, "path");
    return {
      ok: ok,
      status: status,
      data: data,
      error: str(d.error || res.error),
      notBuilt: notBuilt,
      conflict: res.conflict === true || status === 409,
      current: res.current || d.current || null,
      words: ok ? "" : plainError({ status: status, data: d, error: res.error, notBuilt: notBuilt })
    };
  }

  /* plainError — what failed, in Chris's words. Never a status code. */
  function plainError(r) {
    r = obj(r);
    var d = obj(r.data);
    var err = str(d.error || r.error);
    var msg = str(d.message).trim();
    var status = num(r.status) || 0;
    if (!status) return "Could not reach the server. Check your connection and try again.";
    if (r.notBuilt) return "This is not on the site yet. It turns on at the next ship.";
    if (status === 401 || err === "unauthorized") return "You are signed out. Sign in and open this page again.";
    if (status === 403) return "Only the owner and admins can do this.";
    if (err === "no_model") return "No Anthropic key is set on the site. An agent must set it.";
    if (err === "not_ready") return msg || "This button is not live yet. It turns on at the next ship.";
    if (err === "no_worker") return msg || "The background worker is not live yet, so nothing was started.";
    if (err === "cap_hit" || err === "cap_reached") return msg || "Stopped at the month cap. Raise it in Settings or wait for next month.";
    if (err === "brain_unavailable") return msg || "The brain cannot save new pages right now.";
    if (err === "clickfunnels_unreadable") return msg || "ClickFunnels did not answer, so nothing was made. Try again in a minute.";
    if (status === 409) return msg || "Someone changed this while you were looking. The page now shows the newest copy.";
    if (msg) return msg;
    if (err === "invalid") return "Something on the form is not right, so nothing was saved.";
    if (status === 404) return "That is not on file any more. Reload the page.";
    if (status === 502 || status === 504) return "The server took too long to answer. It may still be working. Check back in a minute.";
    if (status === 503) return "The database is not answering right now. Try again in a moment.";
    return "That did not work, and nothing changed. Try again in a moment.";
  }

  /* ── cost lines (design §5 rule 3) ────────────────────────────────────── */

  /* normalizeCosts — GET marketing/costs: {kinds{<kind>:{last_cost_usd,
     last_minutes, measured_at, ...}|null}, month{used_usd, cap_usd}, run_caps,
     limits{avatar:{max_searches, max_search_usd}}}. */
  function normalizeCosts(a) {
    a = obj(a);
    if (!a.ok) return { loaded: false, notBuilt: a.notBuilt === true, kinds: {}, month: { used: null, cap: null }, runCaps: {}, limits: {} };
    var d = obj(a.data);
    var m = obj(pick(d, ["month"]));
    return {
      loaded: true,
      notBuilt: false,
      kinds: obj(pick(d, ["kinds"])),
      month: { used: num(pick(m, ["used_usd"])), cap: num(pick(m, ["cap_usd"])) },
      runCaps: obj(pick(d, ["run_caps"])),
      limits: obj(pick(d, ["limits"]))
    };
  }

  /* kindCost — the last measured run of one kind, or null (unknown). */
  function kindCost(costs, kind) {
    var k = obj(costs).kinds ? obj(costs).kinds[kind] : null;
    if (!k || typeof k !== "object") return null;
    var usd = num(pick(k, ["last_cost_usd"]));
    if (usd === null) return null;
    return {
      usd: usd,
      minutes: num(pick(k, ["last_minutes"])),
      at: pick(k, ["measured_at"]) || null,
      raw: k
    };
  }

  /* limitFrom — one limits object as a server sends it: X1's {max_searches,
     max_search_usd}, X2's {searches, search_usd} and the market research pair
     {searches_with_retries, search_usd_with_retries}. null when not sent. */
  function limitFrom(o, retries) {
    o = obj(o);
    var n = num(pick(o, retries ? ["max_searches_with_retries", "searches_with_retries"] : ["max_searches", "searches"]));
    if (n === null) return null;
    var usd = num(pick(o, retries ? ["max_search_usd_with_retries", "search_usd_with_retries"] : ["max_search_usd", "search_usd"]));
    return { n: n, usd: usd !== null ? usd : n * USD_PER_SEARCH, from: "server" };
  }

  /* searchCeiling — the most web searches one run makes, and what they cost,
     from the server's own limits (design §3.2, §5 rule 3), in this order:
       1. a research run: GET marketing/research limits.{quick, deep} (opts.researchLimits)
       2. GET marketing/costs limits.<kind> (X1 sends limits.avatar)
       3. GET marketing/costs kinds.<kind>.max_searches
       4. last: the design's numbers in SEARCH_LIMITS (from: "design").
     kind: avatar, ad_research, ad_research_retries, research_quick, research_deep. */
  function searchCeiling(costs, kind, opts) {
    opts = obj(opts);
    var c = obj(costs);
    var retries = kind === "ad_research_retries";
    var key = retries ? "ad_research" : kind;
    var found = null;
    if (kind === "research_quick" || kind === "research_deep") {
      found = limitFrom(obj(opts.researchLimits)[kind === "research_deep" ? "deep" : "quick"], false);
    }
    if (!found) found = limitFrom(obj(c.limits)[key], retries);
    if (!found) found = limitFrom(obj(obj(c.kinds)[kind]), false);
    if (found) return found;
    var n = SEARCH_LIMITS[kind];
    return { n: n, usd: n * USD_PER_SEARCH, from: "design" };
  }

  function runCap(costs, kind) {
    var c = obj(costs);
    var n = num(obj(c.runCaps)[kind]);
    if (n !== null) return n;
    return num(pick(obj(obj(c.kinds)[kind]), ["run_cap_usd"]));
  }

  function minutesWords(m) {
    var n = num(m);
    if (n === null) return "";
    if (n < 1) return "under a minute";
    return plural(Math.round(n), "minute");
  }

  /* lastRunLine — "About $0.67 and 5 minutes (last run, Oct 7)." */
  function lastRunLine(kc) {
    if (!kc) return "Cost: unknown, not measured yet.";
    var mins = minutesWords(kc.minutes);
    var when = shortDate(kc.at);
    return "About " + dollars(kc.usd) + (mins ? " and " + mins : "") + " (last run" + (when ? ", " + when : "") + ").";
  }

  function monthLine(costs) {
    var m = obj(obj(costs).month);
    if (m.used === null || m.used === undefined) return "Model spend this month: unknown, not measured yet.";
    return dollars(m.used) + " of " + (m.cap === null || m.cap === undefined ? "an unknown cap" : dollars(m.cap)) + " model spend used this month.";
  }

  /* costLines — every sentence printed under a paid button, and again on the
     sheet before the tap. Never a guess: an unmeasured kind says so. */
  function costLines(kind, costs, opts) {
    opts = obj(opts);
    var kc = kindCost(costs, kind);
    var out = [];
    if (kind === "avatar") {
      out.push(lastRunLine(kc));
      var cap = runCap(costs, "avatar");
      out.push(cap === null ? "It stops by itself at the run cap in Settings." : "It stops by itself at " + dollars(cap) + ".");
      var s = searchCeiling(costs, "avatar");
      out.push("At most " + count(s.n) + " web searches (" + dollars(s.usd) + " of it is search; Anthropic bills $10 per 1,000).");
      if (!kc) out.push("Time: unknown, not measured yet. Worst case about 3 hours.");
    } else if (kind === "ad_research") {
      out.push(lastRunLine(kc));
      var capR = runCap(costs, "ad_research");
      out.push("It cannot go past " + (capR === null ? "the batch cap in Settings" : dollars(capR)) + " a run.");
      var s2 = searchCeiling(costs, "ad_research");
      var s3 = searchCeiling(costs, "ad_research_retries");
      out.push("At most " + count(s2.n) + " web searches (" + dollars(s2.usd) + "), " + count(s3.n) + " if a slow part is tried again (" + dollars(s3.usd) + ").");
      if (!kc) out.push("Time: unknown until the first run. It saves each step, so a stop never loses work.");
    } else if (kind === "research") {
      var deep = opts.depth === "deep";
      var n = searchCeiling(costs, deep ? "research_deep" : "research_quick", opts);
      out.push("About " + count(n.n) + " web searches. Anthropic bills $10 per 1,000, so about " + dollars(n.usd) + " in search fees. A search that fails is not billed.");
      out.push(kc ? "Tokens: last run " + dollars(kc.usd) + (kc.minutes !== null ? " in " + minutesWords(kc.minutes) : "") + "." : "Tokens: unknown, not measured yet. Time: unknown, not measured yet.");
      var stop = num(opts.cap);
      out.push(stop === null ? "Type a stop amount first." : "It stops at your cap: " + dollars(stop) + " for this run.");
    } else if (kind === "offer") {
      out.push(kc ? lastRunLine(kc) : "Cost: unknown, not measured yet.");
      out.push("One run at a time.");
    } else if (kind === "copy") {
      out.push("Writes 15 to 20 whole ads in three lengths plus email subjects. Dozens of model calls. A few minutes.");
      out.push(kc ? lastRunLine(kc) : "Cost: unknown until the first server run.");
    } else if (kind === "ad_strategy") {
      out.push("About 9 model calls. A few minutes.");
      out.push(kc ? lastRunLine(kc) : "Cost: unknown until measured.");
    } else if (kind === "script") {
      out.push(kc ? "One script. About " + dollars(kc.usd) + " (last script" + (kc.at ? ", " + shortDate(kc.at) : "") + ")." : "One script. Cost: unknown, not measured yet.");
      out.push("Under 10 minutes.");
    } else if (kind === "quick_copy") {
      out.push(kc ? lastRunLine(kc) : "Cost: unknown, not measured yet.");
      out.push("Writes one piece. About a minute.");
    } else if (kind === "funnel") {
      out.push("Writes 3 pages with one model call.");
      out.push(kc ? lastRunLine(kc) : "Cost: unknown, not measured yet.");
    } else {
      out.push(lastRunLine(kc));
    }
    out.push(monthLine(costs));
    out.push("Spends no ad money.");
    return out;
  }

  /* costHtml — the line under a paid button. The meter at the top already
     says nothing here spends ad money, so that sentence rides only on the
     sheet; every cost, cap and month line stays. */
  function costHtml(lines, id) {
    var shown = arr(lines).filter(function (l) { return l !== "Spends no ad money."; });
    return '<p class="caption cci-cost"' + (id ? ' id="' + esc(id) + '"' : "") + ">" + shown.map(esc).join(" ") + "</p>";
  }

  /* meterLine — the line at the top of the tab. */
  function meterLine(costs) {
    var m = obj(obj(costs).month);
    var spend = m.used === null || m.used === undefined
      ? "Model spend this month: unknown, not measured yet."
      : "Model spend this month: " + dollars(m.used) + " of " + (m.cap === null || m.cap === undefined ? "an unknown cap" : dollars(m.cap)) + ".";
    return spend + " Nothing on this tab spends ad money.";
  }

  /* ── ideas, suggestions, angles ────────────────────────────────────────── */

  var IDEA_WORDS = Object.freeze({
    "new": "New",
    writing: "Being written",
    written: "Written",
    failed: "Did not get written",
    dropped: "Dropped"
  });

  function ideaView(i) {
    i = obj(i);
    var status = str(pick(i, ["status"])).toLowerCase() || "new";
    return {
      id: str(pick(i, ["id"])),
      text: str(pick(i, ["raw_points"])),
      topic: str(pick(i, ["topic"])),
      status: status,
      word: IDEA_WORDS[status] || status,
      tone: status === "written" ? "on" : (status === "writing" ? "wip" : (status === "failed" ? "bad" : "")),
      format: str(pick(i, ["script_format"])),
      funnel: str(pick(i, ["funnel_key"])),
      angle: str(pick(i, ["angle_key"])),
      scriptId: str(pick(i, ["script_id"])),
      source: str(pick(i, ["source"])),
      createdAt: pick(i, ["created_at"]) || null,
      reason: str(pick(i, ["reason", "dropped_reason"]))
    };
  }

  /* suggestionNumbers — the planner's flat number object in words. */
  function suggestionNumbers(n) {
    n = obj(n);
    var parts = [];
    if (Object.prototype.hasOwnProperty.call(n, "spend_7d_cents")) parts.push(money(n.spend_7d_cents) + " spend");
    if (Object.prototype.hasOwnProperty.call(n, "leads")) parts.push(n.leads === null ? "leads unknown" : plural(num(n.leads), "lead"));
    if (Object.prototype.hasOwnProperty.call(n, "cpl_cents")) parts.push(n.cpl_cents === null ? "cost per lead unknown" : money(n.cpl_cents) + " a lead");
    if (n.last_ran_on || n.last_run) parts.push("last ran " + shortDate(n.last_ran_on || n.last_run));
    return parts.join(", ");
  }

  function angleView(a) {
    a = obj(a);
    return {
      key: str(pick(a, ["angle_key"])),
      name: str(pick(a, ["name"])) || str(pick(a, ["angle_key"])),
      spend: num(pick(a, ["spend_cents"])),
      ads: num(pick(a, ["ads"])),
      leads: num(pick(a, ["leads"])),
      lastRun: pick(a, ["last_run_on", "last_ran_on"]) || null
    };
  }

  function angleLine(v) {
    var bits = [money(v.spend) + " spend", v.leads === null ? "leads unknown" : plural(v.leads, "lead"), v.ads === null ? "ads unknown" : plural(v.ads, "ad")];
    if (v.lastRun) bits.push("last ran " + shortDate(v.lastRun));
    return bits.join(" · ") + " (last 30 days)";
  }

  /* ── deep research rows ────────────────────────────────────────────────── */

  function researchView(r) {
    r = obj(r);
    var job = obj(pick(r, ["job"]));
    var src = Object.keys(job).length ? Object.assign({}, r, job) : r;
    var report = pick(r, ["report"]);
    var p = obj(pick(src, ["progress"]));
    return {
      id: str(pick(src, ["id", "job_id"])),
      question: str(pick(src, ["question"]) || pick(obj(pick(src, ["payload"])), ["question"])),
      depth: str(pick(src, ["depth"]) || pick(obj(pick(src, ["payload"])), ["depth"])) || "quick",
      status: str(pick(src, ["status"])).toLowerCase(),
      stepWord: str(pick(src, ["step_word"])),
      round: num(pick(p, ["round"])),
      findings: num(pick(p, ["findings"])),
      spent: num(pick(p, ["cost_usd_so_far"])),
      error: str(pick(src, ["error"])),
      report: report && typeof report === "object" ? report : null,
      approved: !!(pick(obj(report), ["approved_at"]) || pick(src, ["approved_at"])),
      repoPath: str(pick(obj(report), ["repo_path"]) || pick(src, ["repo_path"])),
      createdAt: pick(src, ["created_at", "started_at"]) || null,
      raw: src
    };
  }

  /* researchWords — the row's one sentence (design §3.2 item 5). */
  function researchWords(v) {
    var r = obj(v.report);
    if (v.status === "queued") return "Waiting to start.";
    if (v.status === "running") {
      var bits = ["Running" + (v.stepWord ? ": " + v.stepWord : "")];
      if (v.round !== null) bits[0] += (v.stepWord ? ", " : ": ") + "round " + v.round;
      if (v.findings !== null) bits.push(plural(v.findings, "finding"));
      if (v.spent !== null) bits.push(dollars(v.spent) + " so far");
      return bits.join(" · ");
    }
    if (v.status === "done") {
      if (pick(r, ["stopped_at_cap"])) {
        return "Done, stopped at the cap: " + dollars(pick(r, ["cost_usd"])) + (num(pick(r, ["rounds"])) !== null ? " after round " + num(pick(r, ["rounds"])) : "") + ".";
      }
      if (pick(r, ["fallback_report"])) return "Done, write-up failed, findings below.";
      var kept = num(pick(r, ["key_verified"]));
      var killed = num(pick(r, ["key_killed"]));
      if (kept !== null) return "Done, " + kept + " of " + (kept + (killed || 0)) + " key claims held up.";
      return "Done.";
    }
    if (v.status === "failed") return "Could not finish: " + (v.error || "no reason was saved") + ".";
    return v.status ? v.status : "Not started.";
  }

  /* ── flywheel rows ─────────────────────────────────────────────────────── */

  function defFor(n, key) {
    for (var i = 0; i < STAGES.length; i++) {
      if ((n && STAGES[i].n === n) || (key && STAGES[i].key === key)) return STAGES[i];
    }
    return null;
  }

  function runView(run) {
    if (!run || typeof run !== "object") return null;
    var c = obj(pick(run, ["counts_so_far"]));
    return {
      jobId: str(pick(run, ["job_id", "id"])),
      status: str(pick(run, ["status"])).toLowerCase(),
      stepN: num(pick(run, ["step_n"])),
      steps: num(pick(run, ["steps_total"])),
      stepWord: str(pick(run, ["step_word"])),
      round: num(pick(run, ["round"])),
      quotes: num(pick(c, ["added", "quotes"])),
      kept: num(pick(c, ["kept"])),
      findings: num(pick(c, ["findings"])),
      searches: num(pick(run, ["searches_so_far"])),
      spent: num(pick(run, ["cost_so_far_usd"])),
      shrunk: arr(pick(run, ["shrunk"])).map(str).filter(Boolean),
      resumable: pick(run, ["resumable"]) === true,
      stoppedAtCap: !!pick(run, ["stopped_at_cap"]),
      error: str(pick(run, ["error"])),
      startedAt: pick(run, ["started_at"]) || null,
      finishedAt: pick(run, ["finished_at"]) || null
    };
  }

  /* runningWords — "Running: step 3 of 10, searching the web for buyer quotes,
     round 2. 58 new quotes so far (455 kept from last time). $1.90 spent so
     far, 23 searches." */
  function runningWords(run) {
    if (!run) return "";
    var head = "Running";
    if (run.stepN !== null) head += ": step " + run.stepN + (run.steps !== null ? " of " + run.steps : "");
    if (run.stepWord) head += (run.stepN !== null ? ", " : ": ") + run.stepWord;
    if (run.round !== null) head += ", round " + run.round;
    var out = [head + "."];
    if (run.quotes !== null) out.push(run.quotes + " new quotes so far" + (run.kept !== null ? " (" + run.kept + " kept from last time)" : "") + ".");
    else if (run.findings !== null) out.push(plural(run.findings, "finding") + " so far.");
    if (run.spent !== null) out.push(dollars(run.spent) + " spent so far" + (run.searches !== null ? ", " + plural(run.searches, "search", "searches") : "") + ".");
    run.shrunk.forEach(function (s) { out.push(s); });
    return out.join(" ");
  }

  var STATE_WORDS = Object.freeze({
    READY: "Done",
    APPROVED: "Done, approved",
    FAILED: "Needs a redo",
    STALE: "Out of date",
    BLOCKED: "Waiting on an earlier step",
    MISSING: "Not run yet",
    THIN: "Thin"
  });

  function toneFor(word) {
    var w = str(word).toLowerCase();
    if (/^done/.test(w)) return "on";
    if (/^running|^waiting to start/.test(w)) return "wip";
    if (/redo|out of date|stopped|thin|failed|could not/.test(w)) return "bad";
    return "";
  }

  /* stageView — one row of GET marketing/flywheel stages[], in the shape the
     card draws. Missing words are made from the state, never invented. */
  function stageView(raw, campaign) {
    raw = obj(raw);
    var n = num(pick(raw, ["n"]));
    var key = str(pick(raw, ["key"]));
    var def = defFor(n, key) || { n: n, key: key, name: key, run: "Run", kind: null, needs: [] };
    var state = str(pick(raw, ["state"])).toUpperCase() || "MISSING";
    var approved = pick(raw, ["approved"]) === true;
    var run = runView(pick(raw, ["run"]));
    var running = !!(run && (run.status === "running" || run.status === "queued"));
    var failed = !!(run && run.status === "failed");
    var word = str(pick(raw, ["state_word"]));
    if (!word) {
      if (running) word = "Running";
      else if (failed && run.stoppedAtCap) word = "Stopped at the cap";
      else if (state === "READY" && approved) word = STATE_WORDS.APPROVED;
      else word = STATE_WORDS[state] || "Not run yet";
    }
    var name = str(pick(raw, ["label_words"])) || def.name;
    if (def.n === 4 && !str(pick(raw, ["label_words"]))) name = "Ad copy for the " + (campaignWords(campaign) || "offer").replace(/^(\w)/, function (c) { return c.toLowerCase(); });
    var gate = obj(pick(raw, ["gate"]));
    var sentence = str(pick(raw, ["sentence"]));
    /* can_run (unit X3): the server's own yes/no with its reason. A step whose
       runner is not on the site yet says "Not on this page yet…": that row
       shows the sentence and no Run button at all (design §5 rule 9). */
    var canRunRaw = pick(raw, ["can_run"]);
    var canRun = canRunRaw && typeof canRunRaw === "object" ? { ok: canRunRaw.ok !== false, reason: str(canRunRaw.reason) } : null;
    var notBuilt = /^not on this page yet/i.test(word) || (!!canRun && !canRun.ok && /^not on this page yet/i.test(canRun.reason));
    var canApprove = pick(raw, ["can_approve"]);
    return {
      n: def.n,
      key: def.key,
      def: def,
      name: name,
      state: state,
      word: word,
      tone: toneFor(word),
      sentence: sentence,
      approved: approved,
      canRun: canRun,
      notBuilt: notBuilt,
      canApprove: canApprove === undefined ? state === "READY" : canApprove === true,
      /* offer_waiting (unit GL): step 3's newest offer is written and waits for
         Approve, which saves it as the step's file (even over an older one). */
      offerWaiting: !!pick(raw, ["offer_waiting"]),
      run: run,
      running: running,
      failed: failed,
      hasFile: ["READY", "FAILED", "STALE", "THIN", "APPROVED"].indexOf(state) !== -1 || arr(pick(raw, ["files"])).length > 0,
      /* The gate line is printed only where it adds something: a done or thin
         step that does not clear the bar for the next one. On a failed or
         out-of-date row it repeats the row's own sentence. */
      gateSentence: gate.clears === false && (state === "READY" || state === "THIN") ? str(pick(gate, ["sentence"])) : "",
      source: str(pick(raw, ["source"])),
      review: str(pick(raw, ["review_card_md"])),
      document: str(pick(raw, ["document_md"])),
      files: arr(pick(raw, ["files"])).map(function (f) {
        f = obj(f);
        return { path: str(pick(f, ["path"])), url: str(pick(f, ["github_url"])) };
      }).filter(function (f) { return f.path; })
    };
  }

  /* blockedReason — why a run button is disabled, or "" when it can run. */
  function blockedReason(view, all) {
    if (view.running) return "";
    if (view.canRun && !view.canRun.ok && !view.notBuilt) return view.canRun.reason || "This step cannot run yet.";
    if (view.canRun && view.canRun.ok) return "";
    var need = view.def.needs || [];
    var missing = need.filter(function (n) {
      var s = null;
      for (var i = 0; i < all.length; i++) if (all[i].n === n) s = all[i];
      return !s || !s.approved;
    });
    if (!missing.length) return "";
    return missing.length === 1 ? "Approve step " + missing[0] + " first." : "Approve steps " + missing.join(" and ") + " first.";
  }

  /* runBody — the body for POST marketing/flywheel/run. Both the design's
     `stage` and the X1 brief's `kind` ride along, so either back end reads it. */
  function runBody(campaign, view, extra) {
    var b = { campaign: campaign, stage: view.n, kind: view.def.jobKind };
    extra = obj(extra);
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== "") b[k] = extra[k];
    });
    return b;
  }

  function normalizeCampaigns(list, current) {
    var seen = {};
    var out = [];
    arr(list).forEach(function (c) {
      var key = typeof c === "string" ? c : str(pick(c, ["campaign", "key", "name"]));
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push({ key: key, words: str(pick(obj(c), ["label_words", "words"])) || campaignWords(key), pending: obj(c).source === "outbox-pending" || obj(c).pending === true });
    });
    if (current && !seen[current]) out.unshift({ key: current, words: campaignWords(current), pending: false });
    return out;
  }

  /* ── funnels ───────────────────────────────────────────────────────────── */

  var PAGE_ROLE_WORDS = Object.freeze({ landing: "Landing page", booking: "Booking page", thank_you: "Thank-you page" });
  var PAGE_STATUS_WORDS = Object.freeze({
    empty: "Not written yet",
    built: "Written, not live",
    pushed: "Made on ClickFunnels, being checked",
    live: "Live"
  });

  function funnelView(f) {
    f = obj(f);
    var pages = arr(pick(f, ["pages"])).map(function (p) {
      p = obj(p);
      var status = str(pick(p, ["status"])).toLowerCase() || "empty";
      return {
        id: str(pick(p, ["id"])),
        position: num(pick(p, ["position"])),
        role: str(pick(p, ["role"])),
        roleWord: PAGE_ROLE_WORDS[str(pick(p, ["role"]))] || str(pick(p, ["role"])),
        path: str(pick(p, ["path"])),
        url: str(pick(p, ["url"])),
        status: status,
        word: PAGE_STATUS_WORDS[status] || status,
        events: pick(p, ["events_seen"]) === undefined ? null : num(pick(p, ["events_seen"])),
        lastEventAt: pick(p, ["last_event_at"]) || null,
        html: str(pick(p, ["html"]))
      };
    }).sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    return {
      id: str(pick(f, ["id"])),
      key: str(pick(f, ["key"])),
      name: str(pick(f, ["name"])),
      kind: str(pick(f, ["kind"])),
      url: str(pick(f, ["url", "landing_url"])),
      path: str(pick(f, ["path"])),
      tag: str(pick(f, ["tag"])),
      utmCampaign: str(pick(f, ["utm_campaign"])),
      utmTemplate: str(pick(f, ["utm_template"])),
      offerKey: str(pick(f, ["offer_key"])),
      status: str(pick(f, ["status"])).toLowerCase() || "draft",
      liveAt: pick(f, ["live_at"]) || null,
      events: pick(f, ["events_seen"]) === undefined ? null : num(pick(f, ["events_seen"])),
      pages: pages,
      built: pages.length > 0 && pages.every(function (p) { return p.status !== "empty"; }),
      onClickFunnels: pages.some(function (p) { return p.status === "pushed" || p.status === "live"; })
    };
  }

  function isBuilderFunnel(v) { return !!v.kind; }

  function hostless(url) { return str(url).replace(/^https?:\/\//, ""); }

  /* funnelJobState — the newest job on a funnel, in words. */
  function funnelJobState(jobs) {
    var list = arr(jobs).map(function (j) {
      j = obj(j);
      return { id: str(pick(j, ["id"])), kind: str(pick(j, ["kind"])), status: str(pick(j, ["status"])).toLowerCase(), error: str(pick(j, ["error"])), at: pick(j, ["created_at"]) || "" };
    }).sort(function (a, b) { return str(b.at).localeCompare(str(a.at)); });
    var j = list[0];
    if (!j) return null;
    var what = j.kind === "funnel_push" ? "push" : "write";
    var running = j.status === "queued" || j.status === "running";
    var words = "";
    if (running) words = what === "push" ? "Pushing live: making the pages and checking them." : "Writing the 3 pages.";
    else if (j.status === "failed") words = (what === "push" ? "The push stopped: " : "The pages did not get written: ") + (j.error || "no reason was saved") + ".";
    return { id: j.id, kind: j.kind, what: what, status: j.status, running: running, words: words };
  }

  /* funnelBlock — why rename, write or push is off right now ("" = allowed). */
  function funnelBlock(action, v, job) {
    if (job && job.running) return job.what === "push" ? "A push is running." : "The pages are being written.";
    if (v.status === "live") return action === "push" ? "It is live." : "A live address never changes.";
    if (v.onClickFunnels) return "A page is already on ClickFunnels, so the address is fixed.";
    if (action === "push" && !v.built) return "Write the pages first.";
    return "";
  }

  function tagLine(v) {
    if (!v.tag) return "Built by hand: no tag on file.";
    return v.built
      ? "Tag " + v.tag + " and the full tracking are on every page."
      : "Tag " + v.tag + " is saved. Each page gets it with the tracking when it is written.";
  }

  function eventsLine(n) {
    if (n === null || n === undefined) return "Visits tracked: unknown.";
    if (n === 0) return "No visits tracked yet.";
    return plural(n, "event") + " tracked.";
  }

  /* pushConfirm — the second tap names the address (design §5 rules 5, 16). */
  function pushConfirm(v) {
    var paths = v.pages.map(function (p) { return p.path; }).filter(Boolean);
    return {
      title: "Push " + (v.name || "this funnel") + " live?",
      consequence: "This makes " + plural(v.pages.length || 3, "new page") + " on ClickFunnels at " + hostless(v.url) +
        (paths.length > 1 ? " (" + paths.join(", ") + ")" : "") +
        ". It never changes a page we did not make. Costs $0. No ad is made or changed.",
      button: "Push live to " + hostless(v.url)
    };
  }

  /* ── quick copy ────────────────────────────────────────────────────────── */

  function quickView(todayAnswer) {
    var a = obj(todayAnswer);
    var d = obj(a.data);
    var copy = obj(pick(d, ["copy"]));
    var ready = obj(pick(d, ["copy_ready"]));
    var missing = arr(pick(ready, ["missing"])).map(function (m) { return typeof m === "string" ? m : str(pick(obj(m), ["label", "key"])); }).filter(Boolean);
    return {
      loaded: a.ok === true,
      partnerId: str(pick(ready, ["partner_id"]) || pick(copy, ["partner_id"])),
      ready: pick(ready, ["ready"]),
      missing: missing,
      pieces: arr(pick(copy, ["pieces"])).slice(0, 10).map(function (p) {
        p = obj(p);
        var state = str(pick(p, ["compliance_state"])).toLowerCase() || "pending";
        var reasons = arr(pick(p, ["blocked_reasons", "reasons"])).map(function (r) { return typeof r === "string" ? r : str(obj(r).message || obj(r).code); }).filter(Boolean);
        return {
          text: str(pick(p, ["copy_text", "text"])),
          state: state,
          verdict: state === "blocked" ? "The ad rules check stopped it" : (state === "pending" ? "Not checked yet" : "Passed the ad rules check"),
          reasons: reasons,
          model: str(pick(p, ["model"])),
          at: pick(p, ["created_at"]) || null
        };
      })
    };
  }

  function quickRequest(partnerId, angle, offerType, key) {
    var prompt = str(angle).trim();
    return {
      partner_id: partnerId,
      asset_kind: "copy",
      idempotency_key: key,
      prompt: prompt,
      spec: { prompt: prompt, formats: ["1x1"], variants: 1, assetKind: "copy", offerType: offerType }
    };
  }

  /* ── markdown, safely ─────────────────────────────────────────────────── */

  function inline(s) {
    var t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    return t;
  }

  /* md — the reports and review cards as plain HTML: headings, bullets,
     bold and links. Everything is escaped first; only http(s) links pass. */
  function md(text) {
    var lines = str(text).replace(/\r/g, "").split("\n");
    var out = [];
    var list = null;
    var para = [];
    function flushPara() { if (para.length) { out.push("<p>" + para.map(inline).join(" ") + "</p>"); para = []; } }
    function flushList() { if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; } }
    lines.forEach(function (line) {
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      var li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); out.push('<p class="cci-mdh"><b>' + inline(h[2]) + "</b></p>"); }
      else if (li) { flushPara(); (list = list || []).push("<li>" + inline(li[1]) + "</li>"); }
      else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line.trim()); }
    });
    flushPara();
    flushList();
    return out.join("");
  }

  function newRequestId() {
    try { if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID(); } catch (e) { /* fall through */ }
    var h = "";
    for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
  }

  /* ── markup (pure: data in, HTML string out) ──────────────────────────── */

  function chip(word, tone) {
    return '<span class="chip' + (tone ? " " + tone : "") + '"><span class="cd"></span>' + esc(word) + "</span>";
  }

  function btn(label, act, opts) {
    opts = obj(opts);
    var attrs = ' type="button" data-act="' + esc(act) + '"';
    Object.keys(obj(opts.data)).forEach(function (k) { attrs += " data-" + k + '="' + esc(opts.data[k]) + '"'; });
    if (opts.disabled) attrs += " disabled";
    if (opts.id) attrs += ' id="' + esc(opts.id) + '"';
    return '<button class="btn' + (opts.primary ? " primary" : "") + (opts.cls ? " " + opts.cls : "") + '"' + attrs + '><span class="spin" aria-hidden="true"></span><span class="lbl">' + esc(label) + "</span></button>";
  }

  function skeleton(n) {
    var s = "";
    for (var i = 0; i < (n || 3); i++) s += '<span class="skel"></span>';
    return '<div class="cci-skel" aria-hidden="true">' + s + "</div>";
  }

  function partError(text, act) {
    return '<div class="cci-err" role="alert"><p>' + esc(text) + "</p>" + (act ? '<div class="actions">' + btn("Try again", act) + "</div>" : "") + "</div>";
  }

  function honest(part) {
    return '<p class="cci-honest">' + esc(notBuiltSentence(part)) + "</p>";
  }

  function renderIdeaList(a, ideas, batches, costs) {
    if (!a) return skeleton(3);
    if (a.notBuilt) return honest("ideas");
    if (!a.ok) return partError("Your ideas did not load. The rest of this page is current.", "reload-ideas");
    var list = arr(ideas);
    if (!list.length) return '<p class="cci-empty">No ideas yet. Type or say one above. It goes in the next batch.</p>';
    var writeReady = obj(batches).writeNowReady === true;
    var out = '<ol class="cci-rows">';
    list.slice(0, 25).forEach(function (v) {
      out += '<li class="cci-row" data-idea="' + esc(v.id) + '"><div class="cci-row-hd"><p class="cci-row-text">' + esc(v.topic || v.text) + "</p>" + chip(v.word, v.tone) + "</div>";
      var meta = [];
      if (v.format) meta.push(v.format);
      if (v.funnel) meta.push(v.funnel);
      if (v.source === "suggestion") meta.push("from a suggestion");
      if (v.createdAt) meta.push("saved " + shortDate(v.createdAt));
      if (meta.length) out += '<p class="caption cci-muted">' + esc(meta.join(" · ")) + "</p>";
      if (v.status === "dropped" && v.reason) out += '<p class="caption cci-muted">Why: ' + esc(v.reason) + "</p>";
      if (v.status === "written" && v.scriptId) out += '<div class="actions">' + btn("Open the script", "open-script", { data: { id: v.scriptId } }) + "</div>";
      if (v.status === "new" && writeReady) {
        out += '<div class="actions">' + btn("Write now from this idea", "write-now", { data: { id: v.id } }) + "</div>" + costHtml(costLines("script", costs));
      }
      out += "</li>";
    });
    out += "</ol>";
    if (!writeReady) out += '<p class="caption cci-muted">Write now turns on when the script writer is live. Until then each idea waits for the next batch.</p>';
    return out;
  }

  function renderSuggestions(a, accepted) {
    if (!a) return skeleton(3);
    if (a.notBuilt) return honest("suggestions");
    if (!a.ok) return partError("The planner's suggestions did not load. The rest of this page is current.", "reload-suggest");
    var next = obj(pick(obj(a.data), ["next"]));
    var list = arr(pick(next, ["suggestions"]));
    if (!list.length) {
      var when = plannerWhen(pick(next, ["release_at"]));
      return '<p class="cci-empty">The planner has not run yet. It runs 3 hours before the next drop' + (when ? " (" + esc(when) + ")" : "") + ".</p>";
    }
    var out = '<ol class="cci-rows">';
    list.slice(0, 3).forEach(function (s) {
      s = obj(s);
      var key = str(pick(s, ["angle_key"]));
      var done = obj(accepted)[key];
      out += '<li class="cci-row"><div class="cci-row-hd"><p class="cci-row-text"><b>' + esc(pick(s, ["name"]) || key) + "</b></p>" + (done ? chip("In the next batch", "on") : "") + "</div>";
      var why = str(pick(s, ["why"]));
      var nums = suggestionNumbers(pick(s, ["numbers"]));
      out += '<p class="caption cci-muted">' + esc([why, nums].filter(Boolean).join(" ")) + "</p>";
      if (!done) out += '<div class="actions">' + btn("Accept", "accept", { data: { key: key, name: str(pick(s, ["name"]) || key), why: why } }) + '<span class="caption cci-muted">Free.</span></div>';
      out += "</li>";
    });
    return out + "</ol>";
  }

  function renderAngles(a, accepted) {
    if (!a) return skeleton(3);
    if (a.notBuilt) return honest("angles");
    if (!a.ok) return partError("The angle list did not load. The rest of this page is current.", "reload-angles");
    var rows = arr(pick(obj(a.data), ["rows"])).map(angleView);
    if (!rows.length) return '<p class="cci-empty">No angles have spend yet. They show here after the first ads run.</p>';
    var asOf = pick(obj(a.data), ["as_of"]);
    var out = '<ol class="cci-rows">';
    rows.forEach(function (v) {
      var done = obj(accepted)["angle:" + v.key];
      out += '<li class="cci-row"><div class="cci-row-hd"><p class="cci-row-text"><b>' + esc(v.name) + "</b></p>" + (done ? chip("In the next batch", "on") : "") + "</div>";
      out += '<p class="caption cci-muted">' + esc(angleLine(v)) + "</p>";
      if (!done) out += '<div class="actions">' + btn("Make more of this", "more-angle", { data: { key: v.key, name: v.name } }) + '<span class="caption cci-muted">Free.</span></div>';
      out += "</li>";
    });
    out += "</ol>";
    if (asOf) out += '<p class="caption cci-muted">Numbers as of ' + esc(shortDate(asOf) + " " + clockTime(asOf)) + " Arizona.</p>";
    return out;
  }

  function renderResearchRows(a, runs, open, drafts) {
    if (!a) return skeleton(2);
    if (a.notBuilt) return "";
    if (!a.ok) return partError("Your research did not load. The rest of this page is current.", "reload-research");
    var list = arr(runs);
    if (!list.length) return '<p class="cci-empty">No research yet. Type a question above.</p>';
    var out = '<ol class="cci-rows">';
    list.forEach(function (v) {
      var word = researchWords(v);
      out += '<li class="cci-row" data-run="' + esc(v.id) + '"><div class="cci-row-hd"><p class="cci-row-text"><b>' + esc(v.question || "Research") + "</b></p>" + chip(v.status === "done" ? (v.approved ? "Done, approved" : "Done") : (v.status === "failed" ? "Could not finish" : (v.status === "running" ? "Running" : "Waiting")), toneFor(v.status === "failed" ? "could not" : (v.status === "done" ? "done" : "running"))) + "</div>";
      out += '<p class="cci-sentence">' + esc(word) + "</p>";
      if (v.status === "done") {
        if (!v.repoPath) out += '<p class="caption cci-muted">Not in the repo yet.</p>';
        out += '<div class="actions">' + btn(open[v.id] ? "Hide it" : "Read it", "research-read", { data: { id: v.id } }) +
          (v.approved ? "" : btn("Approve", "research-approve", { data: { id: v.id } })) +
          btn("Tweak", "research-tweak-open", { data: { id: v.id } }) +
          btn("Redo", "research-redo", { data: { id: v.id } }) +
          btn("Save to the brain", "research-brain", { data: { id: v.id } }) + "</div>";
        if (open["tweak:" + v.id]) {
          out += '<div class="field cci-inline"><label for="cci-rt-' + esc(v.id) + '">One line: what should it look at again?</label>' +
            '<input id="cci-rt-' + esc(v.id) + '" type="text" data-draft="rtweak:' + esc(v.id) + '" value="' + esc(obj(drafts)["rtweak:" + v.id]) + '" placeholder="For example: go deeper on bank overlays">' +
            '<div class="actions">' + btn("Run the tweak", "research-tweak", { data: { id: v.id } }) + "</div></div>";
        }
      }
      if (v.status === "failed") out += '<div class="actions">' + btn("Retry", "research-retry", { data: { id: v.id } }) + '<span class="caption cci-muted">Free. It picks up from the saved steps.</span></div>';
      out += '<div class="cci-open" id="cci-rr-' + esc(v.id) + '">' + (open[v.id] ? str(open[v.id]) : "") + "</div>";
      out += '<p class="say" data-say="run:' + esc(v.id) + '" role="status" aria-live="polite"></p>';
      out += "</li>";
    });
    return out + "</ol>";
  }

  function renderReport(a) {
    if (!a || !a.ok) return '<p class="cci-err">' + esc((a && a.words) || "The report did not load.") + "</p>";
    var d = obj(a.data);
    var report = obj(pick(d, ["report"]));
    var body = str(pick(report, ["markdown"]));
    if (!body) return '<p class="cci-empty">There is no report text on this run yet.</p>';
    var out = '<div class="cci-md">' + md(body) + "</div>";
    var unreachable = arr(pick(report, ["unreachable"])).map(function (u) { return typeof u === "string" ? u : str(pick(obj(u), ["url", "reason"])); }).filter(Boolean);
    if (unreachable.length) out += '<p class="eyebrow">What we could not reach</p><ul class="cci-list">' + unreachable.map(function (u) { return "<li>" + esc(u) + "</li>"; }).join("") + "</ul>";
    return out;
  }

  function stageActions(v, all, costs, campaign, open, drafts) {
    var out = "";
    var def = v.def;
    var reason = blockedReason(v, all);
    var primary = def.n === 1 && !v.running && (v.state === "MISSING" || v.state === "FAILED" || v.state === "STALE");
    var acts = [];
    if (v.review || v.document || v.files.length) acts.push(btn(open["stage:" + v.n] ? "Hide it" : "Read it", "stage-read", { data: { n: v.n } }));
    var canRunHere = !v.notBuilt;
    var capStop = v.failed && v.run && v.run.stoppedAtCap;
    if (v.canApprove && !v.running && (v.offerWaiting || (v.hasFile && !v.approved))) acts.push(btn("Approve", "stage-approve", { data: { n: v.n } }));
    if (v.hasFile && !v.running && !def.free && canRunHere) acts.push(btn("Tweak", "stage-tweak-open", { data: { n: v.n } }));
    if (canRunHere && capStop && v.run.jobId) {
      acts.push(btn("Resume", "stage-retry", { data: { n: v.n, job: v.run.jobId } }));
      acts.push(btn("Start over", "stage-run", { data: { n: v.n } }));
    } else if (canRunHere && v.failed && v.run && v.run.jobId) {
      acts.push(btn("Retry", "stage-retry", { data: { n: v.n, job: v.run.jobId } }));
    }
    if (canRunHere && !v.running && !capStop) {
      acts.push(btn(v.hasFile && !def.free ? "Redo" : def.run, "stage-run", { data: { n: v.n }, disabled: !!reason, primary: primary && !reason, id: "cci-run-" + v.n }));
    }
    if (acts.length) out += '<div class="actions">' + acts.join("") + "</div>";
    if (reason && canRunHere) out += '<p class="caption cci-reason">' + esc(reason) + "</p>";
    if (canRunHere && v.failed && v.run && v.run.jobId) out += '<p class="caption cci-muted">' + (capStop ? "Resume picks up from the saved steps. Start over makes a fresh run." : "Retry is free. Finished steps are kept and never paid for twice.") + "</p>";
    if (!canRunHere) return out;
    if (!v.running && !def.free) out += costHtml(costLines(def.kind, costs), "cci-cost-" + v.n);
    if (def.free && !v.running) out += '<p class="caption cci-cost">Free. Reads saved numbers. A few seconds.</p>';
    /* Rows 1 and 2 take what they read before the tap. */
    if (def.n === 1 && !v.running) {
      out += '<div class="field cci-inline"><label for="cci-sell">What we sell (it reads this)</label><textarea id="cci-sell" rows="2" data-draft="sell:' + esc(campaign) + '">' + esc(obj(drafts)["sell:" + campaign]) + "</textarea></div>";
    }
    if (def.n === 2 && !v.running) {
      out += '<div class="field cci-inline"><label for="cci-market">The market, in one line</label><input id="cci-market" type="text" data-draft="market:' + esc(campaign) + '" value="' + esc(obj(drafts)["market:" + campaign]) + '"></div>' +
        '<div class="field cci-inline"><label for="cci-comp">Competitors we know (optional, comma between)</label><input id="cci-comp" type="text" data-draft="comp:' + esc(campaign) + '" value="' + esc(obj(drafts)["comp:" + campaign]) + '"></div>';
    }
    if (open["tweak:" + v.n]) {
      out += '<div class="field cci-inline"><label for="cci-tw-' + v.n + '">One line for your notes</label><input id="cci-tw-' + v.n + '" type="text" data-draft="tweak:' + esc(campaign) + ":" + v.n + '" value="' + esc(obj(drafts)["tweak:" + campaign + ":" + v.n]) + '" placeholder="For example: lean on the business file, not the personal one">' +
        '<div class="actions">' + btn("Save and re-run step " + v.n, "stage-tweak", { data: { n: v.n } }) + "</div>" +
        costHtml(["This adds one line to your notes, re-runs step " + v.n + " and makes steps " + (v.n + 1) + " to 6 out of date."].concat(costLines(def.kind, costs))) + "</div>";
    }
    return out;
  }

  function renderStageOpen(v) {
    var out = "";
    if (v.review) out += '<div class="cci-md">' + md(v.review) + "</div>";
    if (v.document) out += '<details class="cci-more"><summary>Show more</summary><div class="cci-md">' + md(v.document) + "</div></details>";
    if (v.files.length) {
      out += '<p class="eyebrow">Files</p><ul class="cci-list">' + v.files.map(function (f) {
        return "<li>" + (f.url ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.path) + "</a>" : esc(f.path) + " (reaching the repo…)") + "</li>";
      }).join("") + "</ul>";
    }
    if (v.source === "bundle-fallback") out += '<p class="caption cci-muted">Last known (read from the copy built into the site).</p>';
    return out || '<p class="cci-empty">Nothing to read on this step yet.</p>';
  }

  function renderSpendRead(r) {
    r = obj(r);
    var rows = arr(pick(r, ["rows"]));
    var out = "";
    if (rows.length) {
      out += '<div class="cci-table-wrap"><table class="cci-table"><thead><tr><th>Ad</th><th class="n">Spend</th><th class="n">Taps</th><th class="n">Cost per lead</th><th class="n">Purchases</th></tr></thead><tbody>';
      rows.forEach(function (x) {
        x = obj(x);
        out += "<tr><td>" + esc(pick(x, ["ad_number", "ad", "name"]) || "unknown") + '</td><td class="n">' + esc(money(pick(x, ["spend_cents"]))) + '</td><td class="n">' + esc(count(pick(x, ["taps", "clicks", "link_clicks"]))) + '</td><td class="n">' + esc(money(pick(x, ["cpl_cents", "cost_per_lead_cents"]))) + '</td><td class="n">' + esc(count(pick(x, ["purchases", "sales"]))) + "</td></tr>";
      });
      out += "</tbody></table></div>";
    } else {
      out += '<p class="cci-empty">No ad spend is saved for this offer yet.</p>';
    }
    var un = arr(pick(r, ["unmatched"]));
    if (un.length) out += '<p class="caption cci-muted">' + esc(plural(un.length, "ad") + " had spend but no ad number match. They are not in the table.") + "</p>";
    var c = obj(pick(r, ["conclusion"]));
    if (str(pick(c, ["text"]))) {
      out += '<p class="cci-sentence"><b>' + esc(pick(c, ["text"])) + "</b></p>";
      var to = num(pick(c, ["points_to_stage"]));
      if (to) out += '<div class="actions">' + btn("Go to step " + to, "stage-jump", { data: { n: to } }) + "</div>";
    }
    return out;
  }

  function renderFlywheel(a, st) {
    if (!a) return skeleton(6);
    if (a.notBuilt) return honest("flywheel");
    if (!a.ok) return partError("The offer and market steps did not load. " + a.words, "reload-flywheel");
    var d = obj(a.data);
    var campaign = st.campaign || str(pick(d, ["campaign"]));
    var all = arr(pick(d, ["stages"])).map(function (s) { return stageView(s, campaign); }).sort(function (x, y) { return x.n - y.n; });
    if (!all.length) return '<p class="cci-empty">No steps on file for ' + esc(campaignWords(campaign) || "this offer") + ". Start a flywheel above.</p>";
    var out = "";
    var advice = str(pick(d, ["advice"]));
    if (advice) out += '<p class="cci-sentence">' + esc(advice) + "</p>";
    out += '<ol class="cci-rows cci-stages">';
    all.forEach(function (v) {
      out += '<li class="cci-row cci-stage" id="cci-stage-' + v.n + '" data-stage="' + v.n + '">';
      out += '<div class="cci-row-hd"><p class="cci-row-text"><b>' + esc(v.name) + '</b> <span class="caption cci-muted cci-step">step ' + v.n + " of 6</span></p>" + chip(v.word, v.tone) + "</div>";
      var live = v.running && v.run && (v.run.stepN !== null || v.run.spent !== null) ? runningWords(v.run) : "";
      if (live) out += '<p class="cci-sentence">' + esc(live) + "</p>";
      else if (v.sentence) out += '<p class="cci-sentence">' + esc(v.sentence) + "</p>";
      else if (v.running) out += '<p class="cci-sentence">Running.</p>';
      if (v.failed && v.run && v.run.error && v.sentence.indexOf(v.run.error) === -1) out += '<p class="cci-sentence cci-bad">' + esc(v.run.error) + "</p>";
      if (v.gateSentence) out += '<p class="caption cci-muted">' + esc(v.gateSentence) + "</p>";
      out += stageActions(v, all, st.costs, campaign, st.open, st.drafts);
      if (v.n === 6 && st.spendRead) out += '<div class="cci-open">' + renderSpendRead(st.spendRead) + "</div>";
      out += '<div class="cci-open" data-open="stage:' + v.n + '">' + (st.open["stage:" + v.n] ? renderStageOpen(v) : "") + "</div>";
      out += '<p class="say" data-say="stage:' + v.n + '" role="status" aria-live="polite"></p>';
      out += "</li>";
    });
    return out + "</ol>";
  }

  function renderCampaignPicker(a, st) {
    if (!a || !a.ok) return "";
    var d = obj(a.data);
    var current = st.campaign || str(pick(d, ["campaign"]));
    var list = normalizeCampaigns(pick(d, ["campaigns"]), current);
    var offers = arr(pick(d, ["offers"])).map(function (o) { o = obj(o); return [str(pick(o, ["key"])), str(pick(o, ["name"])) || str(pick(o, ["key"]))]; }).filter(function (o) { return o[0]; });
    if (!offers.length) offers = FLYWHEEL_OFFERS.slice();
    var out = '<div class="cci-pickers">';
    if (list.length) {
      out += '<div class="field"><label for="cci-campaign">Which offer</label><select id="cci-campaign" data-act-change="campaign">' +
        list.map(function (c) { return '<option value="' + esc(c.key) + '"' + (c.key === current ? " selected" : "") + ">" + esc(c.words + (c.pending ? " (reaching the repo…)" : "")) + "</option>"; }).join("") + "</select></div>";
    }
    out += '<div class="field"><label for="cci-new-offer">Start a flywheel for</label><select id="cci-new-offer">' +
      offers.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<div class="actions">' + btn("Start a flywheel", "start-flywheel") + '<span class="caption cci-muted">Free. Makes the folder and your notes file.</span></div></div>';
    return out + "</div>";
  }

  function renderFunnelDetail(a, which) {
    if (!a) return skeleton(2);
    if (!a.ok) return '<p class="cci-err">' + esc(a.words || "The pages did not load.") + "</p>";
    var d = obj(a.data);
    var pages = arr(pick(d, ["pages"]));
    if (!pages.length) return '<p class="cci-empty">This funnel has no pages written here.</p>';
    var view = funnelView({ pages: pages });
    var pick1 = view.pages.filter(function (p) { return p.role === which; })[0] || view.pages[0];
    var out = '<div class="cci-seg" role="tablist" aria-label="Which page">';
    view.pages.forEach(function (p) {
      out += '<button type="button" role="tab" class="btn cci-segbtn" aria-selected="' + (p === pick1 ? "true" : "false") + '" data-act="preview-page" data-role="' + esc(p.role) + '"><span class="lbl">' + esc(p.roleWord) + "</span></button>";
    });
    out += "</div>";
    if (!pick1.html) return out + '<p class="cci-empty">' + esc(pick1.roleWord) + " is not written yet.</p>";
    /* sandbox with no allow-scripts: the preview never runs the page's
       tracking, so looking at a page never counts as a visit. */
    out += '<iframe class="cci-frame" title="' + esc(pick1.roleWord + " preview") + '" sandbox="" referrerpolicy="no-referrer" srcdoc="' + esc(pick1.html) + '"></iframe>';
    out += '<p class="caption cci-muted">Preview only. Scripts are off here, so it counts no visits.</p>';
    return out;
  }

  function renderFunnels(a, st) {
    if (!a) return skeleton(3);
    if (a.notBuilt) return honest("funnels");
    if (!a.ok) return partError("The funnels did not load. The rest of this page is current.", "reload-funnels");
    var all = arr(pick(obj(a.data), ["funnels"])).map(funnelView);
    var built = all.filter(isBuilderFunnel);
    var byHand = all.length - built.length;
    var out = "";
    if (!built.length) out += '<p class="cci-empty">No funnels made here yet. Pick an offer above and tap Make the funnel.</p>';
    else out += '<ol class="cci-rows">';
    built.forEach(function (v) {
      var job = st.funnelJobs[v.id] || null;
      out += '<li class="cci-row cci-funnel" data-funnel="' + esc(v.id) + '">';
      out += '<div class="cci-row-hd"><p class="cci-row-text"><b>' + esc(v.name || v.key) + "</b></p>" + chip(job && job.running ? (job.what === "push" ? "Pushing" : "Writing") : (v.status === "live" ? "Live" : "Draft"), job && job.running ? "wip" : (v.status === "live" ? "on" : "")) + "</div>";
      out += '<p class="cci-url"><a href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">' + esc(hostless(v.url)) + "</a>" + (v.status === "live" ? "" : ' <span class="caption cci-muted">(not live yet)</span>') + "</p>";
      out += '<p class="caption cci-muted">' + esc(tagLine(v)) + " " + esc(v.utmCampaign ? "Its ads are tagged " + v.utmCampaign + " plus the ad number." : "") + "</p>";
      if (job && job.words) out += '<p class="cci-sentence' + (job.status === "failed" ? " cci-bad" : "") + '">' + esc(job.words) + "</p>";
      out += '<ul class="cci-pages">' + v.pages.map(function (p) {
        return '<li><span class="cci-page-name">' + esc(p.roleWord) + '</span> <span class="caption cci-muted">' + esc(p.path) + "</span> " + chip(p.word, p.status === "live" ? "on" : (p.status === "empty" ? "" : "wip")) + ' <span class="caption cci-muted">' + esc(eventsLine(p.events)) + "</span></li>";
      }).join("") + "</ul>";
      var renameBlock = funnelBlock("rename", v, job);
      var buildBlock = funnelBlock("build", v, job);
      var pushBlock = funnelBlock("push", v, job);
      var noPages = !v.pages.some(function (p) { return p.status !== "empty"; });
      out += '<div class="actions">' +
        btn(st.open["preview:" + v.id] ? "Hide the pages" : "See the pages", "funnel-preview", { data: { id: v.id }, disabled: noPages }) +
        btn("Change the address", "funnel-rename-open", { data: { id: v.id }, disabled: !!renameBlock }) +
        btn(v.built ? "Write the pages again" : "Write the pages", "funnel-build", { data: { id: v.id }, disabled: !!buildBlock }) +
        "</div>";
      /* Blocked taps print why (design §3.0). */
      if (noPages) out += '<p class="caption cci-reason" data-why="see-pages">' + esc(job && job.running && job.what !== "push" ? "See the pages: they are being written now." : "See the pages: write the pages first.") + "</p>";
      if (renameBlock) out += '<p class="caption cci-reason">' + esc(renameBlock) + "</p>";
      if (!buildBlock) out += costHtml(costLines("funnel", st.costs));
      if (st.open["rename:" + v.id]) {
        out += '<div class="field cci-inline"><label for="cci-rn-' + esc(v.id) + '">New address (after apply.fundhub.ai/)</label><input id="cci-rn-' + esc(v.id) + '" type="text" autocapitalize="off" autocomplete="off" data-draft="rename:' + esc(v.id) + '" value="' + esc(obj(st.drafts)["rename:" + v.id]) + '" placeholder="' + esc(v.path.replace(/^\//, "")) + '">' +
          '<div class="actions">' + btn("Save the address", "funnel-rename", { data: { id: v.id } }) + '<span class="caption cci-muted">Free. Refused if the address is taken or live.</span></div></div>';
      }
      out += '<div class="cci-push">' + btn("Push live", "funnel-push", { data: { id: v.id }, disabled: !!pushBlock, cls: "cci-push-btn" }) +
        '<p class="caption cci-muted">' + esc(pushBlock ? pushBlock : "Two taps. The second one names the address. Costs $0. No ad is made or changed.") + "</p></div>";
      out += '<div class="cci-open" data-open="preview:' + esc(v.id) + '">' + (st.open["preview:" + v.id] ? renderFunnelDetail(st.funnelDetail[v.id], st.previewRole[v.id]) : "") + "</div>";
      out += '<p class="say" data-say="funnel:' + esc(v.id) + '" role="status" aria-live="polite"></p>';
      out += "</li>";
    });
    if (built.length) out += "</ol>";
    if (byHand) out += '<p class="caption cci-muted">' + esc(plural(byHand, "funnel") + " mapped by hand " + (byHand === 1 ? "lives" : "live") + " in Settings.") + "</p>";
    return out;
  }

  function renderQuick(a, costs) {
    if (!a) return skeleton(2);
    if (!a.ok) return partError("The house account did not load, so Quick copy cannot write yet.", "reload-quick");
    var v = quickView(a);
    var out = "";
    if (v.missing.length) out += '<p class="caption cci-reason">This cannot write yet: ' + esc(v.missing.join(", ")) + ".</p>";
    else if (!v.partnerId) out += '<p class="caption cci-reason">The page could not find the Fundhub house account, so it cannot write yet.</p>';
    if (v.pieces.length) {
      out += '<p class="eyebrow">Last pieces</p><ol class="cci-rows">' + v.pieces.map(function (p) {
        return '<li class="cci-row"><p class="cci-words">' + esc(p.text) + '</p><p class="caption cci-muted">' + esc(p.verdict + (p.model ? " · " + p.model : "") + (p.at ? " · " + shortDate(p.at) : "")) + "</p>" +
          (p.reasons.length ? '<ul class="cci-list cci-bad">' + p.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" : "") + "</li>";
      }).join("") + "</ol>";
    } else {
      out += '<p class="cci-empty">No quick copy yet.</p>';
    }
    return out;
  }

  /* shellHtml — the tab's frame. Forms live here and are never repainted, so
     typed words survive every reload of the lists under them. */
  function shellHtml() {
    var fmt = FORMATS.map(function (f) { return '<option value="' + esc(f[0]) + '">' + esc(f[1]) + "</option>"; }).join("");
    var fo = FUNNEL_OFFERS.map(function (f) { return '<option value="' + esc(f[0]) + '">' + esc(f[1]) + "</option>"; }).join("");
    var qo = QUICK_OFFERS.map(function (f) { return '<option value="' + esc(f[0]) + '">' + esc(f[1]) + "</option>"; }).join("");
    return '<div class="cci">' +
      '<div class="cci-meter" id="cci-meter">' + skeleton(1) + "</div>" +

      '<div class="cci-grid">' +
      '<section class="card s6" id="cci-ideas" aria-labelledby="cci-ideas-h"><div class="card-hd"><h2 id="cci-ideas-h">Drop an idea</h2></div>' +
      '<form id="cci-idea-form" novalidate><div class="field"><label for="cci-idea-text">Your idea (the keyboard mic works)</label>' +
      '<textarea id="cci-idea-text" rows="4" placeholder="For example: lenders check the business file too. Show a clean one next to a messy one."></textarea></div>' +
      '<div class="cci-two"><div class="field"><label for="cci-idea-format">Format (optional)</label><select id="cci-idea-format">' + fmt + "</select></div>" +
      '<div class="field"><label for="cci-idea-funnel">Funnel (optional)</label><select id="cci-idea-funnel"><option value="">Any funnel</option></select></div></div>' +
      '<div class="actions">' + btn("Save idea", "save-idea", { id: "cci-save-idea" }) + '<span class="caption cci-muted">Free. It goes in the next batch.</span></div></form>' +
      '<p class="say" data-say="ideas" role="status" aria-live="polite"></p>' +
      '<p class="eyebrow cci-sub">Your ideas</p><div id="cci-idea-list">' + skeleton(3) + "</div></section>" +

      '<section class="card s6" id="cci-suggest" aria-labelledby="cci-suggest-h"><div class="card-hd"><h2 id="cci-suggest-h">The machine suggests</h2></div>' +
      '<div id="cci-suggest-list">' + skeleton(3) + '</div><p class="say" data-say="suggest" role="status" aria-live="polite"></p></section>' +

      '<section class="card s12" id="cci-angles" aria-labelledby="cci-angles-h"><div class="card-hd"><h2 id="cci-angles-h">Angles</h2></div>' +
      '<div id="cci-angle-list">' + skeleton(3) + '</div><p class="say" data-say="angles" role="status" aria-live="polite"></p></section>' +

      '<section class="card s12" id="cci-research" aria-labelledby="cci-research-h"><div class="card-hd"><h2 id="cci-research-h">Deep research</h2></div>' +
      '<div id="cci-research-form-wrap"><form id="cci-research-form" novalidate>' +
      '<div class="field"><label for="cci-q">Your question (the keyboard mic works)</label><textarea id="cci-q" rows="3" placeholder="For example: what do banks check before a business credit line?"></textarea></div>' +
      '<p class="eyebrow">How deep</p><div class="cci-seg" role="radiogroup" aria-label="How deep">' +
      '<button type="button" class="btn cci-segbtn" role="radio" aria-checked="true" data-act="depth" data-depth="quick"><span class="lbl">Quick look</span></button>' +
      '<button type="button" class="btn cci-segbtn" role="radio" aria-checked="false" data-act="depth" data-depth="deep" id="cci-depth-deep"><span class="lbl">Leave nothing unturned</span></button></div>' +
      '<p class="caption cci-muted" id="cci-depth-why"></p>' +
      '<p class="eyebrow">Where to look</p><div class="cci-checks">' +
      '<label class="cci-check"><input type="checkbox" id="cci-src-web" checked> Live web pages</label>' +
      '<label class="cci-check"><input type="checkbox" id="cci-src-vault" checked> The Hormozi vault</label>' +
      '<label class="cci-check"><input type="checkbox" id="cci-src-own"> Our own files</label></div>' +
      '<div class="field"><label for="cci-belief">What I already think the answer is (optional)</label><input id="cci-belief" type="text"></div>' +
      '<div class="field cci-stop"><label for="cci-cap">Stop at $ for this run</label><input id="cci-cap" type="number" inputmode="decimal" min="0.5" step="0.5" placeholder="Type a stop amount"></div>' +
      '<div class="actions">' + btn("Research it", "research-start", { id: "cci-research-go", disabled: true }) + "</div>" +
      '<p class="caption cci-cost" id="cci-research-cost"></p></form>' +
      '<p class="say" data-say="research" role="status" aria-live="polite"></p></div>' +
      '<p class="eyebrow cci-sub" id="cci-research-sub">Your research</p><div id="cci-research-list">' + skeleton(2) + "</div></section>" +

      '<section class="card s12" id="cci-flywheel" aria-labelledby="cci-flywheel-h"><div class="card-hd"><h2 id="cci-flywheel-h">Offer and market</h2></div>' +
      '<div id="cci-campaigns"></div><p class="say" data-say="flywheel" role="status" aria-live="polite"></p>' +
      '<div id="cci-stage-list">' + skeleton(6) + "</div></section>" +

      '<section class="card s12" id="cci-funnels" aria-labelledby="cci-funnels-h"><div class="card-hd"><h2 id="cci-funnels-h">Funnels</h2></div>' +
      '<form id="cci-funnel-form" novalidate><div class="cci-two"><div class="field"><label for="cci-funnel-offer">What it sells</label><select id="cci-funnel-offer">' + fo + "</select></div>" +
      '<div class="field"><label for="cci-funnel-path">Your own address (optional)</label><input id="cci-funnel-path" type="text" autocapitalize="off" autocomplete="off" placeholder="Leave blank and we pick one"></div></div>' +
      '<div class="actions">' + btn("Make the funnel", "funnel-create", { id: "cci-funnel-go" }) + "</div>" +
      '<p class="caption cci-muted">It picks a free address for you (like apply.fundhub.ai/blueprint), tags every page, adds the full tracking, and writes the 3 pages.</p>' +
      '<div id="cci-funnel-cost"></div></form>' +
      '<p class="say" data-say="funnels" role="status" aria-live="polite"></p>' +
      '<p class="eyebrow cci-sub">Your funnels</p><div id="cci-funnel-list">' + skeleton(3) + "</div></section>" +

      '<section class="card s6" id="cci-quick" aria-labelledby="cci-quick-h"><div class="card-hd"><h2 id="cci-quick-h">Quick copy</h2></div>' +
      '<p class="caption cci-muted">Short copy from a prompt. Not a checked ad script.</p>' +
      '<form id="cci-quick-form" novalidate><div class="field"><label for="cci-quick-angle">What is it about?</label><textarea id="cci-quick-angle" rows="2"></textarea></div>' +
      '<div class="field"><label for="cci-quick-offer">What are we selling?</label><select id="cci-quick-offer">' + qo + "</select></div>" +
      '<div class="actions">' + btn("Write one piece", "quick-go", { id: "cci-quick-go" }) + '</div><div id="cci-quick-cost"></div></form>' +
      '<p class="say" data-say="quick" role="status" aria-live="polite"></p><div id="cci-quick-list">' + skeleton(2) + "</div></section>" +

      '<section class="card s6" id="cci-proof" aria-labelledby="cci-proof-h"><div class="card-hd"><h2 id="cci-proof-h">Proof: client wins and testimonials</h2></div>' +
      '<p class="cci-honest">' + esc(notBuiltSentence("proof")) + "</p>" +
      '<p class="caption cci-muted">Win cards and testimonial cards are made from the real screenshot or video only.</p></section>' +
      "</div></div>";
  }

  /* ── the live tab ─────────────────────────────────────────────────────── */

  var POLL_MS = 10000;

  function ensureCss() {
    if (!doc || doc.getElementById("cc-tab-ideas-css")) return;
    var link = doc.createElement("link");
    link.id = "cc-tab-ideas-css";
    link.rel = "stylesheet";
    link.href = "cc-tab-ideas.css";
    (doc.head || doc.documentElement).appendChild(link);
  }

  function makeTab() {
    var st = null;

    function $(sel) { return st && st.root ? st.root.querySelector(sel) : null; }
    function set(sel, html) { var el = $(sel); if (el) el.innerHTML = html; }

    function call(method, path, body) {
      var opts = {};
      if (method !== "GET") {
        body = Object.assign({ request_id: newRequestId() }, body || {});
        opts.requestId = body.request_id;
      }
      var p;
      try { p = st.ctx.api(method, path, method === "GET" ? undefined : body, opts); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(answer, function () { return answer({ status: 0 }); });
    }

    function say(key, tone, text) {
      var el = $('[data-say="' + key + '"]');
      if (!el) { if (text && st.ctx.toast) st.ctx.toast(text); return; }
      el.className = "say show " + tone;
      el.textContent = text;
    }

    function busy(b, on) {
      if (!b) return;
      b.classList.toggle("busy", on);
      b.disabled = on;
      b.setAttribute("aria-busy", on ? "true" : "false");
    }

    /* askHost — the frame's sheet, whichever way it says yes: it calls
       onConfirm, or it returns a promise that resolves true, or it returns
       true. Only an explicit yes runs the work, and the fired flag runs it
       once even when a frame does two of these. A sheet that throws sends
       nothing. */
    function askHost(fn, opts, run) {
      var fired = false;
      function go() { if (!fired) { fired = true; run(); } }
      var o = {};
      Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
      o.onConfirm = go;
      var out;
      try { out = fn(o); } catch (e) { return; }
      if (out && typeof out.then === "function") out.then(function (yes) { if (yes === true) go(); }, function () {});
      else if (out === true) go();
    }

    /* paidTap — the cost sheet first, then the work (design §5 rule 3). */
    function paidTap(kind, title, lines, button, run) {
      if (typeof st.ctx.costSheet === "function") {
        askHost(st.ctx.costSheet, { kind: kind, title: title, lines: lines, button: button }, run);
      } else {
        localSheet({ title: title, lines: lines, button: button, onConfirm: run });
      }
    }

    /* twoTap — the confirm that names the consequence (design §5 rule 5). */
    function twoTap(opts) {
      if (typeof st.ctx.confirm === "function") {
        askHost(st.ctx.confirm, { title: opts.title, consequence: opts.consequence, button: opts.button }, opts.onConfirm);
      } else {
        localSheet({ title: opts.title, lines: [opts.consequence], button: opts.button, onConfirm: opts.onConfirm });
      }
    }

    /* localSheet — only when a host gives no sheet of its own. */
    function localSheet(o) {
      var wrap = doc.createElement("div");
      wrap.className = "cci-sheet";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.innerHTML = '<div class="cci-sheet-box"><h2>' + esc(o.title) + "</h2>" + arr(o.lines).map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
        '<div class="actions"><button type="button" class="btn primary" data-sheet="yes">' + esc(o.button || "Start") + '</button><button type="button" class="btn" data-sheet="no">Cancel</button></div></div>';
      wrap.addEventListener("click", function (e) {
        var t = e.target.closest("[data-sheet]");
        if (!t) return;
        wrap.remove();
        if (t.getAttribute("data-sheet") === "yes" && o.onConfirm) o.onConfirm();
      });
      st.root.appendChild(wrap);
    }

    /* ── loads ── */

    function loadCosts() {
      return call("GET", "marketing/costs").then(function (a) {
        st.costsAnswer = a;
        st.costs = normalizeCosts(a);
        set("#cci-meter", esc(meterLine(st.costs)));
        paintCostLines();
      });
    }

    function paintCostLines() {
      set("#cci-funnel-cost", costHtml(costLines("funnel", st.costs)));
      set("#cci-quick-cost", costHtml(costLines("quick_copy", st.costs)));
      paintResearchForm();
    }

    function loadIdeas() {
      return Promise.all([call("GET", "marketing/ideas"), call("GET", "marketing/batches")]).then(function (r) {
        st.ideasAnswer = r[0];
        st.ideas = r[0].ok ? arr(pick(obj(r[0].data), ["ideas"])).map(ideaView) : [];
        st.batches = { writeNowReady: r[1].ok && pick(obj(r[1].data), ["write_now_ready"]) === true };
        paintIdeas();
      });
    }
    function paintIdeas() { set("#cci-idea-list", renderIdeaList(st.ideasAnswer, st.ideas, st.batches, st.costs)); }

    function loadSuggest() {
      return call("GET", "marketing/batches/next").then(function (a) { st.suggestAnswer = a; paintSuggest(); });
    }
    function paintSuggest() { set("#cci-suggest-list", renderSuggestions(st.suggestAnswer, st.accepted)); }

    function loadAngles() {
      return call("GET", "marketing/angles").then(function (a) { st.anglesAnswer = a; paintAngles(); });
    }
    function paintAngles() { set("#cci-angle-list", renderAngles(st.anglesAnswer, st.accepted)); }

    function loadResearch() {
      return call("GET", "marketing/research").then(function (a) {
        st.researchAnswer = a;
        var d = obj(a.data);
        st.research = a.ok ? arr(pick(d, ["runs"])).map(researchView) : [];
        st.researchSettings = obj(pick(d, ["settings"]));
        st.researchLimits = obj(pick(d, ["limits"]));
        var wrap = $("#cci-research-form-wrap");
        if (wrap && a.notBuilt) wrap.innerHTML = honest("research");
        var sub = $("#cci-research-sub");
        if (sub) sub.hidden = !!a.notBuilt;
        var cap = $("#cci-cap");
        var preset = num(pick(st.researchSettings, ["max_research_cost_usd"]));
        if (cap && !cap.value && preset !== null) cap.value = String(preset);
        paintResearch();
        paintResearchForm();
      });
    }
    function paintResearch() { set("#cci-research-list", renderResearchRows(st.researchAnswer, st.research, st.open, st.drafts)); }

    function researchMeasured() {
      if (pick(st.researchSettings, ["measured"]) === true) return true;
      return !!kindCost(st.costs, "research");
    }

    function paintResearchForm() {
      var go = $("#cci-research-go");
      if (!go) return;
      var cap = $("#cci-cap");
      var capVal = cap ? num(cap.value) : null;
      var deepBtn = $("#cci-depth-deep");
      var measured = researchMeasured();
      if (deepBtn) {
        deepBtn.disabled = !measured;
        if (!measured && st.depth === "deep") st.depth = "quick";
      }
      var why = $("#cci-depth-why");
      if (why) why.textContent = measured ? "" : "Run a Quick look first so the cost of a full run gets measured.";
      Array.prototype.forEach.call(st.root.querySelectorAll('[data-act="depth"]'), function (b) {
        b.setAttribute("aria-checked", b.getAttribute("data-depth") === st.depth ? "true" : "false");
      });
      var blocked = capVal === null || capVal <= 0;
      var failed = !!(st.researchAnswer && !st.researchAnswer.ok && !st.researchAnswer.notBuilt);
      go.disabled = blocked || !(st.researchAnswer && st.researchAnswer.ok);
      var lines = failed ? ["Your research did not load, so nothing can start. Tap Try again below."]
        : (blocked ? ["Type a stop amount first."] : costLines("research", st.costs, { depth: st.depth, cap: capVal, researchLimits: st.researchLimits }));
      set("#cci-research-cost", arr(lines).map(esc).join(" "));
      var rc = $("#cci-research-cost");
      if (rc) rc.classList.toggle("cci-reason", failed);
    }

    function loadFlywheel() {
      var path = "marketing/flywheel" + (st.campaign ? "?campaign=" + encodeURIComponent(st.campaign) : "");
      return call("GET", path).then(function (a) {
        st.flywheelAnswer = a;
        if (a.ok && !st.campaign) st.campaign = str(pick(obj(a.data), ["campaign"])) || null;
        paintFlywheel();
      });
    }
    function paintFlywheel() {
      set("#cci-campaigns", renderCampaignPicker(st.flywheelAnswer, st));
      set("#cci-stage-list", renderFlywheel(st.flywheelAnswer, st));
    }
    function stagesNow() {
      var a = st.flywheelAnswer;
      if (!a || !a.ok) return [];
      return arr(pick(obj(a.data), ["stages"])).map(function (s) { return stageView(s, st.campaign); });
    }
    function stageByN(n) {
      var all = stagesNow();
      for (var i = 0; i < all.length; i++) if (all[i].n === n) return all[i];
      return null;
    }

    function loadFunnels() {
      return call("GET", "marketing/funnels").then(function (a) {
        st.funnelsAnswer = a;
        if (a.ok) fillFunnelPicker(arr(pick(obj(a.data), ["funnels"])));
        paintFunnels();
      });
    }
    function paintFunnels() { set("#cci-funnel-list", renderFunnels(st.funnelsAnswer, st)); }
    function funnelById(id) {
      var a = st.funnelsAnswer;
      if (!a || !a.ok) return null;
      var list = arr(pick(obj(a.data), ["funnels"])).map(funnelView);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    function fillFunnelPicker(list) {
      var sel = $("#cci-idea-funnel");
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = '<option value="">Any funnel</option>' + list.map(function (f) {
        f = obj(f);
        return '<option value="' + esc(pick(f, ["key"])) + '">' + esc(pick(f, ["name"]) || pick(f, ["key"])) + "</option>";
      }).join("");
      sel.value = keep;
    }

    function loadFunnelDetail(id) {
      return call("GET", "marketing/funnel?id=" + encodeURIComponent(id)).then(function (a) {
        st.funnelDetail[id] = a;
        if (a.ok) {
          var job = funnelJobState(pick(obj(a.data), ["jobs"]));
          if (job) st.funnelJobs[id] = job;
          var f = pick(obj(a.data), ["funnel"]);
          if (f) replaceFunnel(f);
        }
        paintFunnels();
        return a;
      });
    }
    function replaceFunnel(f) {
      var a = st.funnelsAnswer;
      if (!a || !a.ok) return;
      var d = obj(a.data);
      var list = arr(pick(d, ["funnels"]));
      var id = str(pick(obj(f), ["id"]));
      var found = false;
      list = list.map(function (x) { if (str(pick(obj(x), ["id"])) === id) { found = true; return f; } return x; });
      if (!found) list.unshift(f);
      d.funnels = list;
    }

    function loadQuick() {
      return call("GET", "marketing/today").then(function (a) {
        st.todayAnswer = a;
        set("#cci-quick-list", renderQuick(a, st.costs));
        var go = $("#cci-quick-go");
        if (go) {
          var v = quickView(a);
          go.disabled = !a.ok || !v.partnerId || v.missing.length > 0;
        }
      });
    }

    /* guard — a part that throws paints its own error; the rest stays. */
    function guard(p, sel, text) {
      return Promise.resolve(p).catch(function () { set(sel, partError(text, null)); });
    }

    function loadAll() {
      return Promise.all([
        guard(loadCosts(), "#cci-meter", "The cost numbers did not load. Every cost line says unknown until they do."),
        guard(loadIdeas(), "#cci-idea-list", "Your ideas did not load. The rest of this page is current."),
        guard(loadSuggest(), "#cci-suggest-list", "The planner's suggestions did not load. The rest of this page is current."),
        guard(loadAngles(), "#cci-angle-list", "The angle list did not load. The rest of this page is current."),
        guard(loadResearch(), "#cci-research-list", "Your research did not load. The rest of this page is current."),
        guard(loadFlywheel(), "#cci-stage-list", "The offer and market steps did not load. The rest of this page is current."),
        guard(loadFunnels(), "#cci-funnel-list", "The funnels did not load. The rest of this page is current."),
        guard(loadQuick(), "#cci-quick-list", "Quick copy did not load. The rest of this page is current.")
      ]).then(function () {
        try { paintIdeas(); paintFlywheel(); paintFunnels(); } catch (e) { /* each part already painted its own state */ }
        schedulePoll();
      });
    }

    /* ── polling while something runs (and only while the tab is shown) ── */

    function anythingRunning() {
      if (stagesNow().some(function (s) { return s.running; })) return true;
      if (arr(st.research).some(function (r) { return r.status === "running" || r.status === "queued"; })) return true;
      return Object.keys(st.funnelJobs).some(function (k) { return st.funnelJobs[k] && st.funnelJobs[k].running; });
    }

    function schedulePoll() {
      if (!st || st.hidden) return;
      if (st.timer) root.clearTimeout(st.timer);
      st.timer = null;
      if (!anythingRunning()) return;
      st.timer = root.setTimeout(function () {
        st.timer = null;
        if (!st || st.hidden) return;
        var jobs = [];
        if (stagesNow().some(function (s) { return s.running; })) jobs.push(loadFlywheel());
        if (arr(st.research).some(function (r) { return r.status === "running" || r.status === "queued"; })) jobs.push(loadResearch());
        Object.keys(st.funnelJobs).forEach(function (id) { if (st.funnelJobs[id] && st.funnelJobs[id].running) jobs.push(loadFunnelDetail(id)); });
        Promise.all(jobs).then(schedulePoll, schedulePoll);
      }, POLL_MS);
    }

    /* ── actions ── */

    function saveIdea(b) {
      var text = str(($("#cci-idea-text") || {}).value).trim();
      if (!text) { say("ideas", "err", "Type or say an idea first."); return; }
      var body = { raw_points: text };
      var f = str(($("#cci-idea-format") || {}).value);
      var fk = str(($("#cci-idea-funnel") || {}).value);
      if (f) body.script_format = f;
      if (fk) body.funnel_key = fk;
      busy(b, true);
      call("POST", "marketing/ideas", body).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("ideas", "err", a.words); return; }
        $("#cci-idea-text").value = "";
        say("ideas", "ok", "Saved. It goes in the next batch.");
        var idea = pick(obj(a.data), ["idea"]);
        if (idea) { st.ideas.unshift(ideaView(idea)); paintIdeas(); }
        else loadIdeas();
      });
    }

    function writeNow(b) {
      var id = b.getAttribute("data-id");
      var idea = st.ideas.filter(function (i) { return i.id === id; })[0];
      paidTap("script", "Write one script from this idea?", costLines("script", st.costs), "Write it now", function () {
        busy(b, true);
        call("POST", "marketing/batches/write-now", { count: 1, idea_ids: [id] }).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("ideas", "err", a.words); return; }
          say("ideas", "wait", "Writing it now. It shows in Scripts when it is ready (under 10 minutes).");
          if (idea) { idea.status = "writing"; idea.word = IDEA_WORDS.writing; idea.tone = "wip"; }
          paintIdeas();
        });
      });
    }

    function acceptSuggestion(b) {
      var key = b.getAttribute("data-key");
      var name = b.getAttribute("data-name");
      var why = b.getAttribute("data-why");
      busy(b, true);
      call("POST", "marketing/ideas", { raw_points: [name, why].filter(Boolean).join(". "), source: "suggestion", angle_key: key || undefined }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("suggest", "err", a.words); return; }
        st.accepted[key] = true;
        say("suggest", "ok", "Saved. It goes in the next batch.");
        paintSuggest();
        loadIdeas();
      });
    }

    function moreAngle(b) {
      var key = b.getAttribute("data-key");
      var name = b.getAttribute("data-name");
      busy(b, true);
      call("POST", "marketing/ideas", { raw_points: "Make more of this angle: " + name + ".", angle_key: key || undefined }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("angles", "err", a.words); return; }
        st.accepted["angle:" + key] = true;
        say("angles", "ok", "Saved as an idea. It goes in the next batch.");
        paintAngles();
        loadIdeas();
      });
    }

    function researchBody(source) {
      if (source) {
        var raw = obj(source.raw);
        var payload = obj(pick(raw, ["payload"]));
        return {
          question: source.question,
          depth: source.depth || "quick",
          sources: pick(raw, ["sources"]) || pick(payload, ["sources"]) || { web: true, vault: true, own_files: false },
          belief: pick(raw, ["belief"]) || pick(payload, ["belief"]) || undefined,
          max_cost_usd: num(pick(raw, ["max_cost_usd"]) || pick(payload, ["max_cost_usd"])) || num(($("#cci-cap") || {}).value)
        };
      }
      return {
        question: str(($("#cci-q") || {}).value).trim(),
        depth: st.depth,
        sources: { web: !!($("#cci-src-web") || {}).checked, vault: !!($("#cci-src-vault") || {}).checked, own_files: !!($("#cci-src-own") || {}).checked },
        belief: str(($("#cci-belief") || {}).value).trim() || undefined,
        max_cost_usd: num(($("#cci-cap") || {}).value)
      };
    }

    function startResearch(b, source) {
      var body = researchBody(source);
      if (!body.question) { say("research", "err", "Type your question first."); return; }
      if (body.max_cost_usd === null || body.max_cost_usd <= 0) { say("research", "err", "Type a stop amount first."); return; }
      if (!body.sources.web && !body.sources.vault && !body.sources.own_files) { say("research", "err", "Pick at least one place to look."); return; }
      var lines = ["Deep research on: " + body.question].concat(costLines("research", st.costs, { depth: body.depth, cap: body.max_cost_usd, researchLimits: st.researchLimits }))
        .concat(["It runs in the background. This card shows the step it is on. You get a buzz when the report is ready."]);
      paidTap("research", source ? "Run this research again?" : "Start the research?", lines, "Start the research", function () {
        busy(b, true);
        call("POST", "marketing/research", body).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("research", "err", a.words); return; }
          var d = obj(a.data);
          say("research", "wait", d.already_running ? "Research is already running. This is that run." : "Started. This card shows the step it is on.");
          if (!source) { $("#cci-q").value = ""; }
          loadResearch().then(schedulePoll);
        });
      });
    }

    function researchRead(b) {
      var id = b.getAttribute("data-id");
      if (st.open[id]) { st.open[id] = null; paintResearch(); return; }
      busy(b, true);
      call("GET", "marketing/research?id=" + encodeURIComponent(id)).then(function (a) {
        busy(b, false);
        st.open[id] = renderReport(a);
        paintResearch();
      });
    }

    function researchSimple(b, path, okText, extra) {
      var id = b.getAttribute("data-id");
      busy(b, true);
      call("POST", path, Object.assign({ id: id }, extra || {})).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("run:" + id, "err", a.words); return; }
        say("run:" + id, "ok", okText);
        loadResearch().then(schedulePoll);
      });
    }

    function researchTweak(b) {
      var id = b.getAttribute("data-id");
      var note = str(st.drafts["rtweak:" + id]).trim();
      if (!note) { say("run:" + id, "err", "Type one line first."); return; }
      paidTap("research", "Run a short tweak of this research?", ["Tweak: " + note].concat(costLines("research", st.costs, { depth: "quick", cap: num(($("#cci-cap") || {}).value), researchLimits: st.researchLimits })), "Run the tweak", function () {
        researchSimple(b, "marketing/research/tweak", "Running the tweak. This card shows the step it is on.", { note: note });
        st.open["tweak:" + id] = false;
        st.drafts["rtweak:" + id] = "";
      });
    }

    function researchRetry(b) {
      var id = b.getAttribute("data-id");
      busy(b, true);
      call("POST", "marketing/jobs/retry", { job_id: id }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("run:" + id, "err", a.words); return; }
        say("run:" + id, "wait", "Running again. Started " + clockTime(new Date().toISOString()) + ".");
        loadResearch().then(schedulePoll);
      });
    }

    function startFlywheel(b) {
      var key = str(($("#cci-new-offer") || {}).value);
      if (!key) return;
      busy(b, true);
      call("POST", "marketing/flywheel/campaign", { key: key }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("flywheel", "err", a.words); return; }
        var c = pick(obj(a.data), ["campaign"]);
        var ck = typeof c === "string" ? c : str(pick(obj(c), ["campaign", "key", "name"]));
        say("flywheel", "ok", "Started. Saved. Reaching the repo…");
        if (ck) st.campaign = ck;
        loadFlywheel();
      });
    }

    function stageRun(b) {
      var n = num(b.getAttribute("data-n"));
      var v = stageByN(n);
      if (!v) return;
      var campaign = st.campaign;
      if (v.def.free) {
        busy(b, true);
        call("POST", "marketing/flywheel/spend-read", { campaign: campaign }).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("stage:6", "err", a.words); return; }
          st.spendRead = obj(a.data);
          say("stage:6", "ok", "Done. Here is the spend.");
          paintFlywheel();
        });
        return;
      }
      var reason = blockedReason(v, stagesNow());
      if (reason) { say("stage:" + n, "err", reason); return; }
      var extra = {};
      if (n === 1) extra.service_description = str(st.drafts["sell:" + campaign]).trim() || undefined;
      if (n === 2) {
        extra.market = str(st.drafts["market:" + campaign]).trim() || undefined;
        var comp = str(st.drafts["comp:" + campaign]).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        if (comp.length) extra.competitors = comp;
      }
      var lines = costLines(v.def.kind, st.costs);
      if (v.hasFile) lines = ["This re-runs step " + n + " and makes steps " + (n + 1) + " to 6 out of date."].concat(lines);
      var title = (v.hasFile ? "Redo: " : "") + v.def.run + " for " + (campaignWords(campaign) || "this offer") + "?";
      paidTap(v.def.kind, title, lines, v.def.run, function () {
        busy(b, true);
        /* Step 3 goes through the same route: unit X3 hands it to the Write
           offer path with this campaign's files as the page sees them. */
        call("POST", "marketing/flywheel/run", runBody(campaign, v, extra)).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("stage:" + n, "err", a.words); return; }
          var d = obj(a.data);
          var words = n === 1 ? "The avatar is" : (n === 2 ? "The market research is" : (n === 3 ? "An offer is" : "This step is"));
          say("stage:" + n, "wait", d.already_running ? words + " already being built. This is that run." : (str(d.message) || "Started. This row shows the step it is on."));
          loadFlywheel().then(schedulePoll);
        });
      });
    }

    function stageRetry(b) {
      var n = num(b.getAttribute("data-n"));
      var job = b.getAttribute("data-job");
      var v = stageByN(n);
      busy(b, true);
      call("POST", "marketing/jobs/retry", { job_id: job }).then(function (a) {
        if (a.ok || !v || a.status !== 404) return a;
        /* A kind the shared retry route does not know: the row's own run
           route takes the job back instead (design slice 5a). */
        return call("POST", "marketing/flywheel/run", runBody(st.campaign, v, { retry_job_id: job }));
      }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("stage:" + n, "err", a.words); return; }
        say("stage:" + n, "wait", "Running again. Started " + clockTime(new Date().toISOString()) + ".");
        loadFlywheel().then(schedulePoll);
      });
    }

    function stageApprove(b) {
      var n = num(b.getAttribute("data-n"));
      busy(b, true);
      call("POST", "marketing/flywheel/approve", { campaign: st.campaign, stage: n }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("stage:" + n, "err", a.words); return; }
        say("stage:" + n, "ok", "Approved. Saved. Reaching the repo…");
        loadFlywheel();
      });
    }

    function stageTweak(b) {
      var n = num(b.getAttribute("data-n"));
      var v = stageByN(n);
      var note = str(st.drafts["tweak:" + st.campaign + ":" + n]).trim();
      if (!note) { say("stage:" + n, "err", "Type one line first."); return; }
      var lines = ["This adds one line to your notes, re-runs step " + n + " and makes steps " + (n + 1) + " to 6 out of date."].concat(costLines(v ? v.def.kind : null, st.costs));
      paidTap(v ? v.def.kind : "flywheel", "Tweak step " + n + "?", lines, "Save and re-run", function () {
        busy(b, true);
        call("POST", "marketing/flywheel/tweak", { campaign: st.campaign, stage: n, note: note }).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("stage:" + n, "err", a.words); return; }
          st.open["tweak:" + n] = false;
          st.drafts["tweak:" + st.campaign + ":" + n] = "";
          say("stage:" + n, "wait", "Saved to your notes. Step " + n + " is running again.");
          loadFlywheel().then(schedulePoll);
        });
      });
    }

    function funnelCreate(b) {
      var offer = str(($("#cci-funnel-offer") || {}).value);
      var path = str(($("#cci-funnel-path") || {}).value).trim();
      var lines = ["It picks a free address, tags every page and adds the full tracking."].concat(costLines("funnel", st.costs));
      paidTap("funnel", "Make a new funnel?", lines, "Make the funnel", function () {
        busy(b, true);
        var body = { offer_key: offer };
        if (path) body.path = path;
        call("POST", "marketing/funnels/create", body).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("funnels", "err", a.words); return; }
          var d = obj(a.data);
          var f = pick(d, ["funnel"]);
          var v = funnelView(f);
          var job = obj(pick(d, ["job"]));
          var worker = obj(pick(d, ["worker"]));
          if (f) replaceFunnel(f);
          if (job.id) st.funnelJobs[v.id] = { id: str(job.id), kind: "funnel", what: "write", status: str(job.status) || "queued", running: true, words: "Writing the 3 pages." };
          if (worker.started === false) st.funnelJobs[v.id] = { id: str(job.id), kind: "funnel", what: "write", status: "failed", running: false, words: "The pages did not start: " + (str(worker.reason) || "the worker did not wake") + ". Tap Write the pages." };
          ($("#cci-funnel-path") || {}).value = "";
          say("funnels", "ok", "Made. Its address is " + v.url + ". Tag " + v.tag + ".");
          paintFunnels();
          schedulePoll();
        });
      });
    }

    function funnelBuild(b) {
      var id = b.getAttribute("data-id");
      var v = funnelById(id);
      paidTap("funnel", (v && v.built ? "Write the pages again" : "Write the pages") + " for " + hostless(v ? v.url : "") + "?", costLines("funnel", st.costs), "Write the pages", function () {
        busy(b, true);
        call("POST", "marketing/funnels/build", { id: id }).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("funnel:" + id, "err", a.words); return; }
          var job = obj(pick(obj(a.data), ["job"]));
          st.funnelJobs[id] = { id: str(job.id), kind: "funnel", what: "write", status: "queued", running: true, words: "Writing the 3 pages." };
          say("funnel:" + id, "wait", "Writing the 3 pages. This row updates by itself.");
          paintFunnels();
          schedulePoll();
        });
      });
    }

    function funnelRename(b) {
      var id = b.getAttribute("data-id");
      var path = str(st.drafts["rename:" + id]).trim();
      if (!path) { say("funnel:" + id, "err", "Type the new address first."); return; }
      busy(b, true);
      call("POST", "marketing/funnels/rename", { id: id, path: path }).then(function (a) {
        busy(b, false);
        if (!a.ok) { say("funnel:" + id, "err", a.words); return; }
        var f = pick(obj(a.data), ["funnel"]);
        if (f) replaceFunnel(f);
        st.open["rename:" + id] = false;
        st.drafts["rename:" + id] = "";
        st.funnelDetail[id] = null;
        paintFunnels();
        say("funnel:" + id, "ok", "Saved. The new address is " + funnelView(f).url + ".");
        if (st.open["preview:" + id]) loadFunnelDetail(id);
      });
    }

    function funnelPush(b) {
      var id = b.getAttribute("data-id");
      var v = funnelById(id);
      if (!v) return;
      var block = funnelBlock("push", v, st.funnelJobs[id]);
      if (block) { say("funnel:" + id, "err", block); return; }
      var c = pushConfirm(v);
      twoTap({
        title: c.title,
        consequence: c.consequence,
        button: c.button,
        onConfirm: function () {
          /* Online only, never queued (design §5 rule 16). */
          if (root.navigator && root.navigator.onLine === false) {
            say("funnel:" + id, "err", "No connection. Push live needs a connection, so nothing was sent.");
            return;
          }
          busy(b, true);
          call("POST", "marketing/funnels/push-live", { id: id, confirm_url: v.url }).then(function (a) {
            busy(b, false);
            if (!a.ok) { say("funnel:" + id, "err", a.words); return; }
            var job = obj(pick(obj(a.data), ["job"]));
            st.funnelJobs[id] = { id: str(job.id), kind: "funnel_push", what: "push", status: "queued", running: true, words: "Pushing live: making the pages and checking them." };
            say("funnel:" + id, "wait", "Pushing to " + hostless(v.url) + ". It says Live only after each page is checked.");
            paintFunnels();
            schedulePoll();
          });
        }
      });
    }

    function funnelPreview(b) {
      var id = b.getAttribute("data-id");
      st.open["preview:" + id] = !st.open["preview:" + id];
      paintFunnels();
      if (st.open["preview:" + id] && !(st.funnelDetail[id] && st.funnelDetail[id].ok)) loadFunnelDetail(id);
    }

    function quickGo(b) {
      var v = quickView(st.todayAnswer);
      var angle = str(($("#cci-quick-angle") || {}).value).trim();
      var offer = str(($("#cci-quick-offer") || {}).value);
      if (!angle) { say("quick", "err", "Write a few words about what this is about first."); return; }
      if (!v.partnerId) { say("quick", "err", "The page could not find the Fundhub house account, so nothing was sent."); return; }
      paidTap("quick_copy", "Write one piece of quick copy?", costLines("quick_copy", st.costs), "Write it", function () {
        busy(b, true);
        var key = "cci-quick-" + newRequestId();
        call("POST", "creative/generate", quickRequest(v.partnerId, angle, offer, key)).then(function (g) {
          if (!g.ok) return g;
          if (pick(obj(g.data), ["provider_ready"]) === false) return { ok: false, words: "It was saved, but no copy writer is switched on for this account, so it cannot be written yet." };
          return call("POST", "creative/run", { partner_id: v.partnerId, max_jobs: 1 });
        }).then(function (a) {
          busy(b, false);
          if (!a.ok) { say("quick", "err", a.words); return; }
          say("quick", "ok", "Done. The new piece is at the top of the list with the ad rules check.");
          $("#cci-quick-angle").value = "";
          loadQuick();
        });
      });
    }

    var ACTIONS = {
      "save-idea": saveIdea,
      "write-now": writeNow,
      "open-script": function (b) { if (st.ctx.go) st.ctx.go("scripts", b.getAttribute("data-id")); },
      accept: acceptSuggestion,
      "more-angle": moreAngle,
      depth: function (b) { if (b.disabled) return; st.depth = b.getAttribute("data-depth"); paintResearchForm(); },
      "research-start": function (b) { startResearch(b, null); },
      "research-read": researchRead,
      "research-approve": function (b) { researchSimple(b, "marketing/research/approve", "Approved."); },
      "research-brain": function (b) { researchSimple(b, "marketing/research/brain", "Saved to the brain."); },
      "research-tweak-open": function (b) { var id = b.getAttribute("data-id"); st.open["tweak:" + id] = !st.open["tweak:" + id]; paintResearch(); },
      "research-tweak": researchTweak,
      "research-redo": function (b) { var id = b.getAttribute("data-id"); startResearch(b, st.research.filter(function (r) { return r.id === id; })[0]); },
      "research-retry": researchRetry,
      "start-flywheel": startFlywheel,
      "stage-run": stageRun,
      "stage-retry": stageRetry,
      "stage-approve": stageApprove,
      "stage-tweak-open": function (b) { var n = b.getAttribute("data-n"); st.open["tweak:" + n] = !st.open["tweak:" + n]; paintFlywheel(); },
      "stage-tweak": stageTweak,
      "stage-read": function (b) { var n = b.getAttribute("data-n"); st.open["stage:" + n] = !st.open["stage:" + n]; paintFlywheel(); },
      "stage-jump": function (b) {
        var n = b.getAttribute("data-n");
        var el = $("#cci-stage-" + n);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        var run = $("#cci-run-" + n);
        if (run && run.focus) run.focus();
      },
      "funnel-create": funnelCreate,
      "funnel-build": funnelBuild,
      "funnel-rename-open": function (b) { var id = b.getAttribute("data-id"); st.open["rename:" + id] = !st.open["rename:" + id]; paintFunnels(); },
      "funnel-rename": funnelRename,
      "funnel-push": funnelPush,
      "funnel-preview": funnelPreview,
      "preview-page": function (b) {
        var li = b.closest("[data-funnel]");
        if (!li) return;
        st.previewRole[li.getAttribute("data-funnel")] = b.getAttribute("data-role");
        paintFunnels();
      },
      "quick-go": quickGo,
      "reload-ideas": function () { loadIdeas(); },
      "reload-suggest": function () { loadSuggest(); },
      "reload-angles": function () { loadAngles(); },
      "reload-research": function () { loadResearch(); },
      "reload-flywheel": function () { loadFlywheel(); },
      "reload-funnels": function () { loadFunnels(); },
      "reload-quick": function () { loadQuick(); }
    };

    function bind(rootEl) {
      rootEl.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-act]") : null;
        if (!b || !rootEl.contains(b) || b.disabled || b.classList.contains("busy")) return;
        var fn = ACTIONS[b.getAttribute("data-act")];
        if (!fn) return;
        e.preventDefault();
        fn(b);
      });
      rootEl.addEventListener("input", function (e) {
        var t = e.target;
        var k = t && t.getAttribute ? t.getAttribute("data-draft") : null;
        if (k) st.drafts[k] = t.value;
        if (t && (t.id === "cci-cap")) paintResearchForm();
      });
      rootEl.addEventListener("change", function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute("data-act-change") === "campaign") {
          st.campaign = t.value;
          st.spendRead = null;
          st.flywheelAnswer = null;
          set("#cci-stage-list", skeleton(6));
          loadFlywheel().then(schedulePoll);
        }
      });
      rootEl.addEventListener("submit", function (e) { e.preventDefault(); });
    }

    return {
      id: "ideas",
      label: "Ideas",
      order: 2,
      render: function (rootEl, ctx) {
        ensureCss();
        if (st && st.timer) root.clearTimeout(st.timer);
        st = {
          root: rootEl, ctx: ctx || {}, costs: normalizeCosts(null), depth: "quick",
          ideas: [], research: [], researchSettings: {}, researchLimits: {}, batches: { writeNowReady: false },
          accepted: {}, open: {}, drafts: {}, funnelJobs: {}, funnelDetail: {}, previewRole: {},
          campaign: null, spendRead: null, timer: null, hidden: false
        };
        rootEl.innerHTML = shellHtml();
        bind(rootEl);
        var go = loadAll();
        var param = str(st.ctx.param);
        if (param) {
          var target = rootEl.querySelector("#cci-" + param.replace(/[^a-z0-9-]/gi, ""));
          if (target && target.scrollIntoView) target.scrollIntoView({ block: "start" });
        }
        return go;
      },
      refresh: function (ctx) {
        if (!st) return null;
        if (ctx) st.ctx = ctx;
        st.hidden = false;
        return loadAll();
      },
      hide: function () {
        if (!st) return;
        st.hidden = true;
        if (st.timer) root.clearTimeout(st.timer);
        st.timer = null;
      }
    };
  }

  /* The pure rules, for src/ui/cc-tab-ideas.test.mjs. */
  root.FundhubIdeasTab = {
    esc: esc, money: money, dollars: dollars, count: count, shortDate: shortDate,
    campaignWords: campaignWords, plannerWhen: plannerWhen, answer: answer, plainError: plainError,
    normalizeCosts: normalizeCosts, kindCost: kindCost, searchCeiling: searchCeiling, costLines: costLines, meterLine: meterLine,
    ideaView: ideaView, suggestionNumbers: suggestionNumbers, angleView: angleView, angleLine: angleLine,
    researchView: researchView, researchWords: researchWords,
    stageView: stageView, runningWords: runningWords, blockedReason: blockedReason, runBody: runBody,
    normalizeCampaigns: normalizeCampaigns,
    funnelView: funnelView, funnelJobState: funnelJobState, funnelBlock: funnelBlock, tagLine: tagLine,
    eventsLine: eventsLine, pushConfirm: pushConfirm,
    quickView: quickView, quickRequest: quickRequest, md: md, notBuiltSentence: notBuiltSentence,
    renderIdeaList: renderIdeaList, renderSuggestions: renderSuggestions, renderAngles: renderAngles,
    renderResearchRows: renderResearchRows, renderFlywheel: renderFlywheel, renderFunnels: renderFunnels,
    renderQuick: renderQuick, renderFunnelDetail: renderFunnelDetail, renderSpendRead: renderSpendRead,
    shellHtml: shellHtml, makeTab: makeTab,
    STAGES: STAGES, FLYWHEEL_OFFERS: FLYWHEEL_OFFERS, FUNNEL_OFFERS: FUNNEL_OFFERS, SEARCH_LIMITS: SEARCH_LIMITS
  };

  /* Register with the Command Center frame (docs/specs/command-center-tabs.md):
     works whether the frame loaded first or not. */
  if (doc) {
    (root.FundhubCC = root.FundhubCC || { _q: [], registerTab: function (t) { this._q.push(t); } })
      .registerTab(makeTab());
  }
})(typeof window !== "undefined" ? window : globalThis);
