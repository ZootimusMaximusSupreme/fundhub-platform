/* marketing-cc-settings.js — the Settings tab of the Marketing Command Center
   (the gear, top-right).

   WHAT IT IS. The machine's dials (docs/specs/command-center-design-2026-10-05.md
   §3.8; spec docs/specs/marketing-machine-2026-10-04.md §8.3 and §6 step 3;
   plan unit U34). Nothing here spends. Chris changes a box, taps Save, done.
   Top to bottom:
     1. the weekly switch, "Write scripts every week". Off until Chris turns it
        on. Turning it on (or off) takes two taps: the second one names the cost
        caps. Only his tap sets it; no agent and no default ever does;
     2. the schedule: drop day and time (Arizona), scripts a day, days in a
        batch, how to count (in total, or for each running funnel), how each
        kind of script is written, when drafts go away;
     3. quiet hours;
     4. the model spend caps, with what is used this month; a month cap under
        what is already spent warns before it saves;
     5. the winner rule, "Not set yet";
     6. the funnels: name, landing page, lane tag, books a call, the mix of
        script kinds, the button on the ad, weight, running; the Meta campaigns
        linked to each one with its last-7-days spend (null is "unknown",
        never $0); the default ad set.
   The video choices (Submagic template, caption place, zooms, clean audio,
   caption words, animation mode, flip, settle minutes) are NOT shown: nothing
   reads them until the video pipeline (M3) does, and a control that does
   nothing does not render (UI-STANDARDS §5). They keep their saved values.

   WHAT IT READS AND WRITES.
     GET  /api/marketing/settings   the one settings row (made with the
                                    defaults on the first read)
     GET  /api/marketing/funnels    funnels + synced Meta campaigns (with
                                    spend_7d_cents) + synced ad sets + as_of
     GET  /api/marketing/health     model spend this month and the last batch
     POST /api/marketing/settings   {request_id, updated_at, patch}
     POST /api/marketing/funnels    {request_id, funnel:{key, ...changed, updated_at}}
   One Save button saves both: the settings that changed, then each funnel
   that changed. A 409 shows both versions (yours and the saved one).

   TESTABLE WITHOUT A BROWSER. Every rule is a plain function on
   window.FHMarketingCCSettings (and on the registered tab's `rules`);
   src/ui/marketing-cc-settings.test.mjs runs this file in node:vm. */
(function (root) {
  "use strict";

  /* ── words and lists ─────────────────────────────────────────────────── */

  var TZ = "America/Phoenix";
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  /* The script kinds, in the order src/marketing/settings-store.mjs FORMATS
     lists them. The test holds the two lists together. */
  var FORMATS = ["standard", "sorting", "long", "notes", "greenscreen", "vsl"];
  var FORMAT_WORDS = {
    standard: "Standard ads",
    sorting: "Sorting-hat shorts",
    long: "Long ads",
    notes: "Notes ads",
    greenscreen: "Green screen ads",
    vsl: "VSLs"
  };
  /* Spec §2 item 15: bullets keep the hook, line 2, the reveal and the ask
     word for word with one short cue per point; the other style writes every
     word out. */
  var STYLE_WORDS = { bullets: "Bullets", words: "Every word" };
  var SIZE_RULES = ["total", "per_funnel"];
  /* The ad_lane values the server takes (settings-store AD_LANES). */
  var LANES = ["funding600", "premium", "sorting", "uwiq", "wl", "slo", "unknown"];
  /* Meta's button names for the most common asks. A saved value that is not
     here still shows, as it is saved. */
  var CTA_WORDS = {
    LEARN_MORE: "Learn more",
    SIGN_UP: "Sign up",
    APPLY_NOW: "Apply now",
    CONTACT_US: "Contact us",
    GET_QUOTE: "Get quote"
  };
  /* The settings this tab edits with the form. `enabled` is NOT here: only
     the switch's own two-tap confirm sends it. */
  var EDIT_KEYS = [
    "batch_weekday", "batch_time", "scripts_per_day", "days_per_batch", "size_rule",
    "format_style", "draft_expiry_days", "quiet_start", "quiet_end",
    "max_batch_cost_usd", "max_month_cost_usd"
  ];
  /* Video choices: saved, never shown, until the video pipeline reads them. */
  var HIDDEN_KEYS = [
    "submagic_template", "caption_position_y", "magic_zooms", "clean_audio",
    "caption_dictionary", "animation_mode", "flip_horizontal", "settle_minutes"
  ];
  var FIELD_WORDS = {
    enabled: "Write scripts every week",
    batch_weekday: "Drop day",
    batch_time: "Drop time",
    scripts_per_day: "Scripts a day",
    days_per_batch: "Days in a batch",
    size_rule: "How to count",
    format_style: "How each kind is written",
    draft_expiry_days: "Drafts go away after",
    quiet_start: "Quiet hours start",
    quiet_end: "Quiet hours end",
    max_batch_cost_usd: "Most one batch can spend",
    max_month_cost_usd: "Most one month can spend"
  };
  var FUNNEL_FIELDS = [
    "name", "landing_url", "lane", "book_call", "format_mix", "cta_type", "weight",
    "active", "meta_campaign_ids", "default_ad_set_external_id"
  ];
  var FUNNEL_WORDS = {
    name: "Name",
    landing_url: "Landing page",
    lane: "Lane tag",
    book_call: "Books a call",
    format_mix: "Mix of script kinds",
    cta_type: "Button on the ad",
    weight: "Weight",
    active: "Running",
    meta_campaign_ids: "Meta campaigns",
    default_ad_set_external_id: "Default ad set"
  };
  var CTA_RE = /^[A-Z][A-Z_]{1,49}$/;
  var HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  var INT_MAX = 2147483647;
  var NEVER = "What the machine never does: turn an ad on, pause one, or change a budget.";

  /* ── small helpers ───────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function str(v) { return v == null ? "" : String(v); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function fmt(ms, opts) {
    var o = { timeZone: TZ };
    for (var k in opts) if (has(opts, k)) o[k] = opts[k];
    return new Intl.DateTimeFormat("en-US", o).format(new Date(ms));
  }
  function clockOf(ms) { return fmt(ms, { hour: "numeric", minute: "2-digit" }); }
  function fullTime(ms) { return fmt(ms, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  function dateTimeOf(ms) { return fmt(ms, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

  /* timeWords — "07:00" → "7:00 AM", "21:00" → "9:00 PM". The clock face
     only; the zone is said in words next to it ("Arizona time"). */
  function timeWords(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(str(hhmm));
    if (!m) return "unknown";
    var h = Number(m[1]);
    var ap = h < 12 ? "AM" : "PM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + m[2] + " " + ap;
  }

  /* usd — whole-dollar caps and model bills. Null is "unknown", never $0. */
  function usd(v) {
    var n = num(v);
    if (n === null) return "unknown";
    if (n > 0 && n < 0.01) return "under 1 cent";
    var whole = Math.round(n * 100) % 100 === 0;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }

  /* centsWords — Meta spend in integer cents → "$412.00". Null → "unknown". */
  function centsWords(cents) {
    var n = num(cents);
    if (n === null) return "unknown";
    return "$" + (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* spendWords — one campaign's last 7 days, for mapping. Never $0 for null. */
  function spendWords(cents) {
    var n = num(cents);
    return n === null ? "Spend in the last 7 days: unknown." : centsWords(n) + " spent in the last 7 days.";
  }

  function statusWord(s) {
    var v = str(s).toLowerCase();
    if (!v) return "";
    if (v === "active") return "on";
    return v;
  }

  /* ── reading the answers ─────────────────────────────────────────────── */

  function body(res) { return obj(obj(res) && res.body); }
  function okRes(res) { return !!res && res.status === 200 && !!body(res); }

  /* normalizeSettings — GET/POST marketing/settings → the settings object. */
  function normalizeSettings(res) {
    var b = body(res);
    var s = b && obj(b.settings);
    return okRes(res) && s ? s : null;
  }

  /* normalizeFunnels — GET marketing/funnels. */
  function normalizeFunnels(res) {
    var b = body(res);
    if (!okRes(res) || !b || !Array.isArray(b.funnels)) return null;
    return {
      funnels: b.funnels.filter(obj),
      campaigns: arr(b.campaigns).filter(obj),
      adSets: arr(b.ad_sets).filter(obj),
      asOf: b.as_of || null
    };
  }

  /* normalizeHealth — the model meter from GET marketing/health. */
  function normalizeHealth(res) {
    var b = body(res);
    var m = okRes(res) && b ? obj(b.model) : null;
    if (!m) return { known: false, monthUsd: null, monthCapUsd: null, lastBatchUsd: null };
    return {
      known: true,
      monthUsd: num(m.month_cost_usd),
      monthCapUsd: num(m.max_month_cost_usd),
      lastBatchUsd: num(m.last_batch_cost_usd)
    };
  }

  /* ── the schedule in words ───────────────────────────────────────────── */

  function sizeRuleWords(rule, perDay) {
    var n = num(perDay);
    var a = n === null ? "Some" : String(n);
    return rule === "per_funnel" ? a + " a day for each running funnel" : a + " a day in total";
  }

  function runningCount(funnels) {
    return arr(funnels).filter(function (f) { return f && f.active === true; }).length;
  }

  /* batchSize — how many scripts one batch makes, from the settings (or the
     form's draft of them). Null when a number is missing. */
  function batchSize(s, funnels) {
    s = obj(s) || {};
    var perDay = num(s.scripts_per_day);
    var days = num(s.days_per_batch);
    if (perDay === null || days === null) return null;
    var n = perDay * days;
    if (s.size_rule === "per_funnel") n *= runningCount(funnels);
    return n;
  }

  /* scheduleLine — "Every Monday at 7:00 AM Arizona time: 21 scripts." */
  function scheduleLine(s, funnels) {
    s = obj(s) || {};
    var day = WEEKDAYS[num(s.batch_weekday)] || null;
    var n = batchSize(s, funnels);
    if (!day || !HHMM_RE.test(str(s.batch_time)) || n === null) return "The schedule is not complete yet.";
    return "Every " + day + " at " + timeWords(s.batch_time) + " Arizona time: " + n + (n === 1 ? " script." : " scripts.");
  }

  /* switchWords — the weekly switch's state and its two-tap confirm. The
     confirm names the money (design §3.8, safety rule 5). */
  function switchWords(s, funnels) {
    s = obj(s) || {};
    var on = s.enabled === true;
    var day = WEEKDAYS[num(s.batch_weekday)] || "the drop day";
    var n = batchSize(s, funnels);
    var count = n === null ? "the scripts" : n + (n === 1 ? " script" : " scripts");
    return {
      on: on,
      word: on ? "On" : "Off",
      line: on
        ? "On. Every " + day + " at " + timeWords(s.batch_time) + " Arizona time the writer makes " + count + "."
        : "Off. No weekly scripts are written until you turn this on.",
      note: "Buttons you tap still work when this is off. It only holds back the weekly batch.",
      button: on ? "Turn off weekly scripts" : "Turn on weekly scripts",
      ask: on
        ? {
          question: "Turn off weekly scripts?",
          detail: "No new weekly batch starts. Nothing already written is lost.",
          yes: "Yes, turn it off",
          no: "Keep it on"
        }
        : {
          question: "Turn on weekly scripts?",
          detail: "Every " + day + " at " + timeWords(s.batch_time) + " Arizona time the writer makes " + count +
            ". It may spend up to " + usd(s.max_batch_cost_usd) + " a batch and " + usd(s.max_month_cost_usd) +
            " a month on the writing model. It never spends ad money.",
          yes: "Yes, turn it on",
          no: "Not now"
        }
    };
  }

  /* switchPatch — the ONLY place `enabled` is ever put in a patch. Called by
     the switch's confirm button, never by Save. */
  function switchPatch(on) { return { enabled: on === true }; }

  /* capWarning — a month cap under what is already spent stops every run at
     once; say so before it saves (design §3.8). */
  function capWarning(capRaw, health) {
    var cap = num(capRaw);
    var used = health && health.known ? num(health.monthUsd) : null;
    if (cap === null || used === null || cap >= used) return null;
    return "This is below what is already spent this month (" + usd(used) + "). Runs stop at once.";
  }

  function spentLine(health) {
    if (!health || !health.known) return "Used this month: unknown. Last batch: unknown.";
    return "Used this month: " + usd(health.monthUsd) + ". Last batch: " +
      (health.lastBatchUsd === null ? "none yet" : usd(health.lastBatchUsd)) + ".";
  }

  /* ── the form: drafts and patches ────────────────────────────────────── */

  /* draftOfSettings — the saved settings as the boxes hold them (text). */
  function draftOfSettings(s) {
    s = obj(s) || {};
    var style = obj(s.format_style) || {};
    var fs = {};
    FORMATS.forEach(function (f) { fs[f] = style[f] === "words" ? "words" : (style[f] === "bullets" ? "bullets" : ""); });
    function t(v) { return v == null ? "" : String(v); }
    return {
      batch_weekday: t(s.batch_weekday),
      batch_time: t(s.batch_time).slice(0, 5),
      scripts_per_day: t(s.scripts_per_day),
      days_per_batch: t(s.days_per_batch),
      size_rule: t(s.size_rule),
      format_style: fs,
      draft_expiry_days: t(s.draft_expiry_days),
      quiet_start: t(s.quiet_start).slice(0, 5),
      quiet_end: t(s.quiet_end).slice(0, 5),
      max_batch_cost_usd: t(s.max_batch_cost_usd),
      max_month_cost_usd: t(s.max_month_cost_usd)
    };
  }

  function wholeNumber(raw) {
    var v = str(raw).trim();
    if (!/^\d+$/.test(v)) return null;
    var n = Number(v);
    return n >= 1 && n <= INT_MAX ? n : null;
  }

  /* diffSettings — what changed between the saved row and the boxes, as a
     POST patch, plus any box that is not right (in plain words). `enabled`
     never appears here. */
  function diffSettings(saved, draft) {
    saved = obj(saved) || {};
    draft = obj(draft) || {};
    var patch = {};
    var errors = [];
    function bad(key, message) { errors.push({ key: key, message: message }); }

    var wd = str(draft.batch_weekday);
    if (wd !== "") {
      var w = Number(wd);
      if (!/^[0-6]$/.test(wd)) bad("batch_weekday", "Pick a drop day.");
      else if (w !== saved.batch_weekday) patch.batch_weekday = w;
    }
    ["batch_time", "quiet_start", "quiet_end"].forEach(function (k) {
      var v = str(draft[k]).slice(0, 5);
      if (!HHMM_RE.test(v)) { bad(k, FIELD_WORDS[k] + " must be a time, like 7:00 AM."); return; }
      if (v !== str(saved[k]).slice(0, 5)) patch[k] = v;
    });
    var ints = {
      scripts_per_day: FIELD_WORDS.scripts_per_day + " must be a whole number, 1 or more.",
      days_per_batch: FIELD_WORDS.days_per_batch + " must be a whole number, 1 or more.",
      draft_expiry_days: "Drafts go away after must be a whole number of days, 1 or more.",
      max_batch_cost_usd: FIELD_WORDS.max_batch_cost_usd + " must be whole dollars, 1 or more.",
      max_month_cost_usd: FIELD_WORDS.max_month_cost_usd + " must be whole dollars, 1 or more."
    };
    Object.keys(ints).forEach(function (k) {
      var n = wholeNumber(draft[k]);
      if (n === null) { bad(k, ints[k]); return; }
      if (n !== saved[k]) patch[k] = n;
    });
    var rule = str(draft.size_rule);
    if (SIZE_RULES.indexOf(rule) === -1) bad("size_rule", "Pick how to count.");
    else if (rule !== saved.size_rule) patch.size_rule = rule;

    var savedStyle = obj(saved.format_style) || {};
    var draftStyle = obj(draft.format_style) || {};
    var styleChange = {};
    FORMATS.forEach(function (f) {
      var v = str(draftStyle[f]);
      if (v === "") return;
      if (!has(STYLE_WORDS, v)) { bad("format_style", "Pick bullets or every word for " + FORMAT_WORDS[f] + "."); return; }
      if (v !== savedStyle[f]) styleChange[f] = v;
    });
    if (Object.keys(styleChange).length) patch.format_style = styleChange;
    return { patch: patch, errors: errors, changed: Object.keys(patch).length > 0 };
  }

  /* draftOfFunnel — one saved funnel as its boxes hold it. */
  function draftOfFunnel(f) {
    f = obj(f) || {};
    var mix = obj(f.format_mix) || {};
    var m = {};
    FORMATS.forEach(function (k) { m[k] = num(mix[k]) === null ? "" : String(num(mix[k])); });
    return {
      name: str(f.name),
      landing_url: str(f.landing_url),
      lane: str(f.lane),
      book_call: f.book_call === true,
      format_mix: m,
      cta_type: str(f.cta_type),
      weight: num(f.weight) === null ? "" : String(num(f.weight)),
      active: f.active === true,
      meta_campaign_ids: arr(f.meta_campaign_ids).map(str),
      default_ad_set_external_id: str(f.default_ad_set_external_id)
    };
  }

  function sameSet(a, b) {
    var x = arr(a).map(str).sort();
    var y = arr(b).map(str).sort();
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /* diffFunnel — POST marketing/funnels's `funnel` for one funnel: its key,
     the fields that changed, and the updated_at it was read at (the server
     refuses a stale one with 409). Null patch when nothing changed. */
  function diffFunnel(saved, draft) {
    saved = obj(saved) || {};
    draft = obj(draft) || {};
    var out = {};
    var errors = [];
    function bad(field, message) { errors.push({ key: field, message: message }); }
    var who = str(saved.name) || "this funnel";

    var name = str(draft.name).trim();
    if (!name || name.length > 120) bad("name", "The funnel needs a name, up to 120 letters.");
    else if (name !== saved.name) out.name = name;

    var url = str(draft.landing_url).trim();
    var okUrl = /^https:\/\/[^\s/]+\.[^\s]+$/.test(url) && url.length <= 2000;
    if (!okUrl) bad("landing_url", "The landing page for " + who + " must be a full web address that starts with https://.");
    else if (url !== saved.landing_url) out.landing_url = url;

    var lane = str(draft.lane);
    if (LANES.indexOf(lane) === -1) bad("lane", "Pick a lane tag for " + who + ".");
    else if (lane !== saved.lane) out.lane = lane;

    if (draft.book_call !== (saved.book_call === true)) out.book_call = draft.book_call === true;
    if (draft.active !== (saved.active === true)) out.active = draft.active === true;

    var savedMix = obj(saved.format_mix) || {};
    var draftMix = obj(draft.format_mix) || {};
    var mix = {};
    var mixChanged = false;
    var mixOk = true;
    var any = false;
    FORMATS.forEach(function (k) {
      var raw = str(draftMix[k]).trim();
      var n = raw === "" ? 0 : Number(raw);
      if (!isFinite(n) || n < 0) { mixOk = false; return; }
      if (n > 0) { mix[k] = n; any = true; }
      if (n !== (num(savedMix[k]) || 0)) mixChanged = true;
    });
    /* The rule bites only on a mix being sent. A funnel saved with no mix yet
       ({}, the table's default; the funnel builder makes them that way) does
       not block a Save of anything else. The server refuses an all-zero mix,
       so a changed mix still needs one number above 0. */
    if (!mixOk || (mixChanged && !any)) bad("format_mix", "The mix for " + who + " needs numbers, 0 or more, with at least one above 0.");
    else if (mixChanged) out.format_mix = mix;

    var cta = str(draft.cta_type);
    if (!CTA_RE.test(cta)) bad("cta_type", "Pick the button on the ad for " + who + ".");
    else if (cta !== saved.cta_type) out.cta_type = cta;

    var wRaw = str(draft.weight).trim();
    var w = wRaw === "" ? NaN : Number(wRaw);
    if (!isFinite(w) || w < 0 || w > 1e6) bad("weight", "The weight for " + who + " must be a number, 0 or more.");
    else if (w !== num(saved.weight)) out.weight = w;

    var ids = arr(draft.meta_campaign_ids).map(str);
    if (!sameSet(ids, saved.meta_campaign_ids)) out.meta_campaign_ids = ids;

    var adSet = str(draft.default_ad_set_external_id);
    var savedSet = str(saved.default_ad_set_external_id);
    if (adSet !== savedSet) out.default_ad_set_external_id = adSet === "" ? null : adSet;

    var changed = Object.keys(out).length > 0;
    if (changed) {
      out.key = saved.key;
      out.updated_at = saved.updated_at;
    }
    return { patch: changed ? out : null, errors: errors, changed: changed };
  }

  /* campaignChoices — every synced campaign as a box for this funnel. One
     already linked to another funnel is disabled WITH the reason (the server
     refuses it: one funnel per campaign, so spend never counts twice). */
  function campaignChoices(funnelKey, chosenIds, campaigns, funnels) {
    var names = {};
    arr(funnels).forEach(function (f) { if (f && f.key) names[f.key] = f.name || f.key; });
    var chosen = arr(chosenIds).map(str);
    return arr(campaigns).map(function (c) {
      var id = str(c.external_id);
      var other = c.funnel_key && c.funnel_key !== funnelKey ? c.funnel_key : null;
      return {
        id: id,
        name: str(c.name) || "A campaign with no name",
        status: statusWord(c.status),
        spend: spendWords(c.spend_7d_cents),
        checked: chosen.indexOf(id) !== -1,
        disabled: !!other && chosen.indexOf(id) === -1,
        reason: other && chosen.indexOf(id) === -1 ? "Linked to " + (names[other] || other) + "." : ""
      };
    });
  }

  /* adSetChoices — the default ad set picker: the synced ad sets of the
     campaigns linked to this funnel. Disabled with the reason when there is
     nothing to pick. */
  function adSetChoices(chosenIds, adSets, current) {
    var ids = arr(chosenIds).map(str);
    var all = arr(adSets);
    var mine = all.filter(function (a) { return ids.indexOf(str(a.campaign_external_id)) !== -1; });
    var cur = str(current);
    var options = mine.map(function (a) {
      return { id: str(a.external_id), name: str(a.name) || "An ad set with no name", status: statusWord(a.status) };
    });
    if (cur && !options.some(function (o) { return o.id === cur; })) {
      var known = all.filter(function (a) { return str(a.external_id) === cur; })[0];
      options.unshift({ id: cur, name: (known ? str(known.name) : "Ad set " + cur) + " (its campaign is not linked here)", status: "" });
    }
    var reason = "";
    if (!all.length) reason = "No ad sets are synced yet. They show up here after the next Meta pull (midnight, Arizona time).";
    else if (!ids.length) reason = "Link a Meta campaign first. Then pick its ad set here.";
    else if (!mine.length) reason = "The linked campaigns have no synced ad sets yet.";
    return { options: options, disabled: !options.length, reason: reason };
  }

  /* noCampaignLine — design §3.8, word for word in meaning. */
  function noCampaignLine(chosenIds) {
    return arr(chosenIds).length ? "" :
      "No Meta campaign is linked to this funnel, so its spend reads unknown and the batch split treats it as $0 spent.";
  }

  function asOfLine(asOf, nowMs) {
    var ms = asOf ? Date.parse(asOf) : NaN;
    if (!isFinite(ms)) return "Meta has not synced yet.";
    return "Meta numbers as of " + (nowMs - ms < 86400000 ? clockOf(ms) : dateTimeOf(ms)) + ".";
  }

  /* ── answers in plain words ──────────────────────────────────────────── */

  function fieldWord(field, kind) {
    var key = str(field).replace(/^(patch|funnel)\./, "").split(".")[0];
    var words = kind === "funnel" ? FUNNEL_WORDS : FIELD_WORDS;
    return has(words, key) ? words[key] : null;
  }

  /* problemWords — why a save did not go through, in one sentence. Never a
     status code, never a server key. */
  function problemWords(res, kind) {
    var r = obj(res) || {};
    var b = body(r) || {};
    if (r.status === 0 || r.status == null) {
      return r.transport === "timeout" ? "The server took too long to answer." : "There is no connection.";
    }
    if (r.status === 401) return "You are signed out. Sign in and open this page again.";
    if (r.status === 403) return "Only the owner or an admin can change this.";
    if (r.status === 400) {
      var w = fieldWord(b.field, kind);
      if (w && b.field === "funnel.meta_campaign_ids") return "A campaign you picked is already linked to another funnel.";
      return w ? w + " is not right." : "Something in it is not right.";
    }
    if (r.status === 404) return "This part is not ready yet. It turns on with the next update.";
    if (r.status === 409) return "Someone saved this after you opened it.";
    if (r.status === 503 && b.error === "not_ready") return "This part is built but not live yet. It turns on with the next update.";
    if (r.status === 503) return "The database is not answering.";
    return "The server had a problem.";
  }

  /* loadProblem — a part of the tab that did not load. */
  function loadProblem(res, what) {
    return "The " + what + " did not load. " + problemWords(res, "settings") + " The rest of this page is current.";
  }

  /* valueWords — one value as Chris reads it, for the both-versions sheet. */
  function valueWords(key, v) {
    if (v == null || v === "") return "not set";
    if (key === "batch_weekday") return WEEKDAYS[num(v)] || String(v);
    if (key === "batch_time" || key === "quiet_start" || key === "quiet_end") return timeWords(v);
    if (key === "max_batch_cost_usd" || key === "max_month_cost_usd") return usd(v);
    if (key === "size_rule") return v === "per_funnel" ? "For each running funnel" : "In total";
    if (key === "enabled" || key === "book_call" || key === "active") return v === true ? "Yes" : "No";
    if (key === "format_style" || key === "format_mix") {
      var o = obj(v) || {};
      return Object.keys(o).map(function (k) {
        return (FORMAT_WORDS[k] || k) + ": " + (key === "format_style" ? (STYLE_WORDS[o[k]] || o[k]) : o[k]);
      }).join(", ") || "not set";
    }
    if (key === "meta_campaign_ids") return arr(v).length ? arr(v).join(", ") : "none";
    if (key === "cta_type") return CTA_WORDS[v] || String(v);
    return String(v);
  }

  /* conflictRows — a 409's two versions, side by side: every field Chris
     changed, with his value and the saved one (design safety rule 10). */
  function conflictRows(patch, current, kind) {
    var p = obj(patch) || {};
    var c = obj(current) || {};
    var words = kind === "funnel" ? FUNNEL_WORDS : FIELD_WORDS;
    return Object.keys(p).filter(function (k) { return k !== "key" && k !== "updated_at"; }).map(function (k) {
      var saved = c[k];
      var mine = p[k];
      if (k === "format_style") {
        var cs = obj(saved) || {};
        var only = {};
        Object.keys(obj(mine) || {}).forEach(function (f) { only[f] = cs[f]; });
        saved = only;
      }
      return { key: k, label: words[k] || k, yours: valueWords(k, mine), saved: valueWords(k, saved) };
    });
  }

  /* saveAnswer — one sentence for one press of Save. parts: [{what, ok,
     conflict, problem}] in the order they were sent. */
  function saveAnswer(parts, nowMs) {
    var list = arr(parts);
    if (!list.length) return { tone: "wait", text: "Nothing changed yet." };
    var good = list.filter(function (p) { return p.ok; });
    var bad = list.filter(function (p) { return !p.ok; });
    var at = clockOf(nowMs);
    if (!bad.length) return { tone: "ok", text: "Saved " + at + "." };
    var first = bad[0];
    var why = first.conflict
      ? "Someone saved " + first.what + " after you opened this page. Pick yours or the saved one above."
      : first.what + " did not save. " + first.problem + " Try again.";
    if (!good.length) return { tone: "err", text: "Did not save. " + why };
    return {
      tone: "err",
      text: good.map(function (p) { return p.what; }).join(" and ") + " saved " + at + ". " + why
    };
  }

  /* ── markup (pure: data in, HTML string out) ─────────────────────────── */

  function chip(word, tone) {
    return '<span class="chip' + (tone ? " " + tone : "") + '"><span class="cd"></span>' + esc(word) + "</span>";
  }
  function skel(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += '<span class="skel"></span>';
    return out;
  }
  function errLine(key, errors) {
    var e = arr(errors).filter(function (x) { return x.key === key; })[0];
    return e ? '<p class="caption fld-err" role="alert">' + esc(e.message) + "</p>" : "";
  }
  function invalid(key, errors) {
    return arr(errors).some(function (x) { return x.key === key; }) ? ' aria-invalid="true"' : "";
  }

  function renderLoading() {
    return '<section class="grid set-grid" aria-label="Settings">' +
      '<div class="card span-12"><div class="card-hd"><h2>Write scripts every week</h2></div>' + skel(2) + "</div>" +
      '<div class="card span-6"><div class="card-hd"><h2>Schedule</h2></div>' + skel(5) + "</div>" +
      '<div class="card span-6"><div class="card-hd"><h2>Model spend caps</h2></div>' + skel(3) + "</div>" +
      '<div class="card span-12"><div class="card-hd"><h2>Funnels</h2></div>' + skel(6) + "</div>" +
      "</section>";
  }

  function renderSwitch(st) {
    var w = switchWords(st.settings, st.funnels);
    var html = '<div class="card span-12" id="setSwitch">' +
      '<div class="card-hd"><h2>Write scripts every week</h2>' + chip(w.word, w.on ? "on" : "") + "</div>" +
      '<p id="setSwitchLine">' + esc(w.line) + "</p>" +
      '<p class="caption muted gap8">' + esc(w.note) + "</p>";
    if (st.settings && st.settings.updated_by == null) {
      html += '<p class="caption muted gap8">These are the starting settings. Weekly scripts stay off until you turn them on.</p>';
    }
    if (st.switchAsk) {
      html += '<div class="ask" id="setSwitchAsk" role="group" aria-label="' + esc(w.ask.question) + '">' +
        "<p><b>" + esc(w.ask.question) + "</b></p><p>" + esc(w.ask.detail) + "</p>" +
        '<div class="ask-act"><button class="btn" type="button" data-act="switch-yes"' + (st.switchBusy ? " disabled" : "") + ">" +
        '<span class="spin" aria-hidden="true"></span><span class="lbl">' + esc(w.ask.yes) + "</span></button>" +
        '<button class="btn quiet link" type="button" data-act="switch-no"' + (st.switchBusy ? " disabled" : "") + ">" + esc(w.ask.no) + "</button></div></div>";
    } else {
      html += '<div class="row-act"><button class="btn" type="button" data-act="switch-ask" id="setSwitchBtn">' + esc(w.button) + "</button></div>";
    }
    if (st.switchSay) html += '<div class="say show ' + esc(st.switchSay.tone) + '" role="status">' + esc(st.switchSay.text) + "</div>";
    return html + "</div>";
  }

  function field(id, label, control, extra) {
    return '<div class="field"><label for="' + esc(id) + '">' + esc(label) + "</label>" + control + (extra || "") + "</div>";
  }

  function numberBox(id, dataKey, value, errors, unit) {
    return '<div class="unit-box">' + (unit === "$" ? '<span class="unit" aria-hidden="true">$</span>' : "") +
      '<input id="' + esc(id) + '" type="number" inputmode="numeric" min="1" step="1" data-s="' + esc(dataKey) + '" value="' + esc(value) + '"' + invalid(dataKey, errors) + ">" +
      (unit && unit !== "$" ? '<span class="unit">' + esc(unit) + "</span>" : "") + "</div>";
  }

  function renderSchedule(st) {
    var d = st.draft;
    var e = st.errors || [];
    var days = WEEKDAYS.map(function (name, i) {
      return '<option value="' + i + '"' + (String(i) === d.batch_weekday ? " selected" : "") + ">" + esc(name) + "</option>";
    }).join("");
    var rules = SIZE_RULES.map(function (r) {
      return '<label class="radio"><input type="radio" name="set-size-rule" value="' + r + '" data-s="size_rule"' +
        (d.size_rule === r ? " checked" : "") + '><span data-live="rule-' + r + '">' + esc(sizeRuleWords(r, d.scripts_per_day)) + "</span></label>";
    }).join("");
    var styles = FORMATS.map(function (f) {
      var opts = Object.keys(STYLE_WORDS).map(function (s) {
        return '<option value="' + s + '"' + (d.format_style[f] === s ? " selected" : "") + ">" + esc(STYLE_WORDS[s]) + "</option>";
      }).join("");
      return field("set-style-" + f, FORMAT_WORDS[f], '<select id="set-style-' + f + '" data-s="format_style" data-format="' + f + '">' + opts + "</select>");
    }).join("");
    return '<div class="card span-6" id="setSchedule"><div class="card-hd"><h2>Schedule</h2></div>' +
      '<p class="caption muted" data-live="schedule">' + esc(scheduleLine(liveSettings(st), st.funnels)) + "</p>" +
      '<div class="fgrid gap16">' +
      field("set-day", FIELD_WORDS.batch_weekday, '<select id="set-day" data-s="batch_weekday"' + invalid("batch_weekday", e) + ">" + days + "</select>", errLine("batch_weekday", e)) +
      field("set-time", FIELD_WORDS.batch_time + " (Arizona time)", '<input id="set-time" type="time" data-s="batch_time" value="' + esc(d.batch_time) + '"' + invalid("batch_time", e) + ">", errLine("batch_time", e)) +
      field("set-per-day", FIELD_WORDS.scripts_per_day, numberBox("set-per-day", "scripts_per_day", d.scripts_per_day, e), errLine("scripts_per_day", e)) +
      field("set-days", FIELD_WORDS.days_per_batch, numberBox("set-days", "days_per_batch", d.days_per_batch, e, "days"), errLine("days_per_batch", e)) +
      "</div>" +
      '<fieldset class="field"><legend>' + esc(FIELD_WORDS.size_rule) + "</legend>" + rules + errLine("size_rule", e) + "</fieldset>" +
      field("set-expiry", FIELD_WORDS.draft_expiry_days, numberBox("set-expiry", "draft_expiry_days", d.draft_expiry_days, e, "days"),
        '<p class="caption muted">A script nobody approves goes away after this many days.</p>' + errLine("draft_expiry_days", e)) +
      '<h3 class="eyebrow sub-hd">How each kind of script is written</h3>' +
      '<p class="caption muted">Bullets keep the hook, line 2, the reveal and the ask word for word, with one short cue for each point. Every word writes the whole script out.</p>' +
      '<div class="fgrid gap16">' + styles + "</div>" + errLine("format_style", e) +
      "</div>";
  }

  function renderQuiet(st) {
    var d = st.draft;
    var e = st.errors || [];
    return '<div class="card" id="setQuiet"><div class="card-hd"><h2>Quiet hours</h2></div>' +
      '<p class="caption muted" data-live="quiet">' + esc(quietLine(d)) + "</p>" +
      '<div class="fgrid gap16">' +
      field("set-quiet-start", FIELD_WORDS.quiet_start, '<input id="set-quiet-start" type="time" data-s="quiet_start" value="' + esc(d.quiet_start) + '"' + invalid("quiet_start", e) + ">", errLine("quiet_start", e)) +
      field("set-quiet-end", FIELD_WORDS.quiet_end, '<input id="set-quiet-end" type="time" data-s="quiet_end" value="' + esc(d.quiet_end) + '"' + invalid("quiet_end", e) + ">", errLine("quiet_end", e)) +
      "</div></div>";
  }

  function quietLine(d) {
    if (!HHMM_RE.test(str(d.quiet_start)) || !HHMM_RE.test(str(d.quiet_end))) return "Pick when quiet hours start and end.";
    return "No buzzes from " + timeWords(d.quiet_start) + " to " + timeWords(d.quiet_end) + ", Arizona time. They wait until " + timeWords(d.quiet_end) + ".";
  }

  function renderCaps(st) {
    var d = st.draft;
    var e = st.errors || [];
    var warn = capWarning(d.max_month_cost_usd, st.health);
    return '<div class="card" id="setCaps"><div class="card-hd"><h2>Model spend caps</h2></div>' +
      '<p class="caption muted">This is money for the writing model only. It is never ad money.</p>' +
      '<div class="fgrid gap16">' +
      field("set-cap-batch", FIELD_WORDS.max_batch_cost_usd, numberBox("set-cap-batch", "max_batch_cost_usd", d.max_batch_cost_usd, e, "$"), errLine("max_batch_cost_usd", e)) +
      field("set-cap-month", FIELD_WORDS.max_month_cost_usd, numberBox("set-cap-month", "max_month_cost_usd", d.max_month_cost_usd, e, "$"), errLine("max_month_cost_usd", e)) +
      "</div>" +
      '<p class="caption" id="setSpent">' + esc(spentLine(st.health)) + "</p>" +
      '<p class="caption warn-line" data-live="cap-warn"' + (warn ? "" : " hidden") + ">" + esc(warn || "") + "</p>" +
      "</div>";
  }

  function renderWinner() {
    return '<div class="card" id="setWinner"><div class="card-hd"><h2>The winner rule</h2>' + chip("Not set yet", "") + "</div>" +
      "<p>Not set yet.</p>" +
      '<p class="caption muted gap8">Until you fill this in, the machine writes more new versions of the angles you spend the most on.</p>' +
      '<p class="caption muted gap8">' + esc(NEVER) + "</p></div>";
  }

  function renderFunnel(st, f) {
    var d = st.funnelDraft[f.key];
    var e = (st.funnelErrors || {})[f.key] || [];
    var k = f.key;
    var id = function (x) { return "fn-" + k + "-" + x; };
    var data = function (fieldName) { return ' data-f="' + esc(k) + '" data-field="' + fieldName + '"'; };
    var lanes = LANES.map(function (l) {
      return '<option value="' + l + '"' + (d.lane === l ? " selected" : "") + ">" + esc(l) + "</option>";
    }).join("");
    var ctas = Object.keys(CTA_WORDS);
    if (d.cta_type && ctas.indexOf(d.cta_type) === -1) ctas.unshift(d.cta_type);
    var ctaOpts = ctas.map(function (c) {
      return '<option value="' + esc(c) + '"' + (d.cta_type === c ? " selected" : "") + ">" + esc(CTA_WORDS[c] || c) + "</option>";
    }).join("");
    var mix = FORMATS.map(function (fm) {
      return field(id("mix-" + fm), FORMAT_WORDS[fm],
        '<input id="' + id("mix-" + fm) + '" type="number" inputmode="decimal" min="0" step="1" placeholder="0"' + data("format_mix") + ' data-format="' + fm + '" value="' + esc(d.format_mix[fm]) + '"' + invalid("format_mix", e) + ">");
    }).join("");
    var camps = campaignChoices(k, d.meta_campaign_ids, st.campaigns, st.funnels);
    var campHtml = camps.length
      ? '<ul class="camps">' + camps.map(function (c) {
        return '<li><label class="check"><input type="checkbox" value="' + esc(c.id) + '"' + data("meta_campaign_ids") +
          (c.checked ? " checked" : "") + (c.disabled ? " disabled" : "") + "><span><b>" + esc(c.name) + "</b>" +
          (c.status && c.status !== "on" ? ' <span class="caption muted">(' + esc(c.status) + ")</span>" : "") + "</span></label>" +
          '<p class="caption muted">' + esc(c.spend) + (c.reason ? " " + esc(c.reason) : "") + "</p></li>";
      }).join("") + "</ul>"
      : '<p class="caption muted">No Meta campaigns are synced yet. They show up here after the next Meta pull (midnight, Arizona time).</p>';
    var none = noCampaignLine(d.meta_campaign_ids);
    return '<fieldset class="funnel" id="' + id("block") + '" data-funnel="' + esc(k) + '">' +
      '<div class="funnel-hd"><h3 class="eyebrow">' + esc(f.name || k) + "</h3>" + chip(d.active ? "Running" : "Not running", d.active ? "on" : "") + "</div>" +
      '<div class="fgrid gap16">' +
      field(id("name"), FUNNEL_WORDS.name, '<input id="' + id("name") + '" type="text" maxlength="120"' + data("name") + ' value="' + esc(d.name) + '"' + invalid("name", e) + ">", errLine("name", e)) +
      field(id("url"), FUNNEL_WORDS.landing_url, '<input id="' + id("url") + '" type="url" inputmode="url"' + data("landing_url") + ' value="' + esc(d.landing_url) + '"' + invalid("landing_url", e) + ">", errLine("landing_url", e)) +
      field(id("lane"), FUNNEL_WORDS.lane, '<select id="' + id("lane") + '"' + data("lane") + invalid("lane", e) + ">" + lanes + "</select>",
        '<p class="caption muted">The tag on every ad link (utm_campaign).</p>' + errLine("lane", e)) +
      field(id("cta"), FUNNEL_WORDS.cta_type, '<select id="' + id("cta") + '"' + data("cta_type") + invalid("cta_type", e) + ">" + ctaOpts + "</select>", errLine("cta_type", e)) +
      field(id("weight"), FUNNEL_WORDS.weight, '<input id="' + id("weight") + '" type="number" inputmode="decimal" min="0" step="0.1"' + data("weight") + ' value="' + esc(d.weight) + '"' + invalid("weight", e) + ">",
        '<p class="caption muted">1 is normal.</p>' + errLine("weight", e)) +
      '<div class="field checks">' +
      '<label class="check"><input type="checkbox"' + data("active") + (d.active ? " checked" : "") + "><span>Running: the writer makes scripts for it</span></label>" +
      '<label class="check"><input type="checkbox"' + data("book_call") + (d.book_call ? " checked" : "") + "><span>This funnel books a call</span></label>" +
      "</div></div>" +
      '<h4 class="eyebrow sub-hd">' + esc(FUNNEL_WORDS.format_mix) + "</h4>" +
      '<p class="caption muted">The batch splits this funnel\'s scripts in this mix. 2 and 1 means two of the first kind for each one of the second.</p>' +
      '<div class="fgrid mix gap16">' + mix + "</div>" + errLine("format_mix", e) +
      '<h4 class="eyebrow sub-hd">Meta campaigns for this funnel</h4>' + campHtml +
      (none ? '<p class="caption warn-line" data-live="none-' + esc(k) + '">' + esc(none) + "</p>" : "") +
      '<div data-live="adset-' + esc(k) + '">' + renderAdSet(st, f) + "</div>" +
      errLine("meta_campaign_ids", e) +
      "</fieldset>";
  }

  function renderAdSet(st, f) {
    var d = st.funnelDraft[f.key];
    var pick = adSetChoices(d.meta_campaign_ids, st.adSets, d.default_ad_set_external_id);
    var sel = "fn-" + f.key + "-adset";
    var opts = '<option value="">None picked</option>' + pick.options.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === d.default_ad_set_external_id ? " selected" : "") + ">" +
        esc(o.name + (o.status && o.status !== "on" ? " (" + o.status + ")" : "")) + "</option>";
    }).join("");
    return field(sel, FUNNEL_WORDS.default_ad_set_external_id,
      '<select id="' + sel + '" data-f="' + esc(f.key) + '" data-field="default_ad_set_external_id"' + (pick.disabled ? " disabled" : "") + ">" + opts + "</select>",
      (pick.reason ? '<p class="caption muted">' + esc(pick.reason) + "</p>" : "") +
      '<p class="caption muted">New ads for this funnel load here, paused.</p>');
  }

  function renderFunnels(st, nowMs) {
    if (st.funnelsProblem) {
      return '<div class="card span-12" id="setFunnels"><div class="card-hd"><h2>Funnels</h2></div>' +
        '<p class="caption bad-line" role="alert">' + esc(st.funnelsProblem) + "</p>" +
        '<div class="row-act"><button class="btn" type="button" data-act="reload">Try again</button></div></div>';
    }
    var list = st.funnels.length
      ? st.funnels.map(function (f) { return renderFunnel(st, f); }).join("")
      : '<p class="caption muted">No funnels yet.</p>';
    return '<div class="card span-12" id="setFunnels"><div class="card-hd"><h2>Funnels</h2>' +
      '<span class="caption faint">' + esc(asOfLine(st.asOf, nowMs)) + "</span></div>" +
      '<p class="caption muted">Where the ads send people. Link each funnel to its Meta campaigns so the batch can split by spend.</p>' +
      list + "</div>";
  }

  function renderConflict(c) {
    if (!c) return "";
    return '<div class="conflict" id="setConflict" role="alert">' +
      "<p><b>Someone saved " + esc(c.what) + " after you opened this page.</b> Here are both versions. Pick one.</p>" +
      '<table class="both"><thead><tr><th scope="col">What</th><th scope="col">Yours</th><th scope="col">Saved now</th></tr></thead><tbody>' +
      c.rows.map(function (r) {
        return "<tr><th scope=\"row\">" + esc(r.label) + "</th><td>" + esc(r.yours) + "</td><td>" + esc(r.saved) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="ask-act"><button class="btn" type="button" data-act="keep-mine">Keep mine</button>' +
      '<button class="btn quiet link" type="button" data-act="use-saved">Use the saved one</button></div></div>';
  }

  function renderSaveBar(st) {
    var dirty = st.dirty;
    var say = st.say;
    var line = say ? say.text : (dirty ? "You have changes that are not saved." : "No changes to save.");
    var tone = say ? say.tone : (dirty ? "wait" : "");
    var label = st.capConfirm ? "Save anyway" : "Save";
    return '<div class="savebar" id="setSaveBar">' +
      renderConflict(st.conflict) +
      '<div class="savebar-row"><p class="caption save-say ' + esc(tone) + '" id="setSay" role="status" aria-live="polite">' + esc(line) + "</p>" +
      '<button class="btn primary" type="button" id="setSave" data-act="save"' + (!dirty || st.saving || st.conflict ? " disabled" : "") + ">" +
      '<span class="spin" aria-hidden="true"></span><span class="lbl">' + esc(st.saving ? "Saving…" : label) + "</span></button></div></div>";
  }

  /* liveSettings — the saved settings with the form's numbers laid over, so
     the schedule line answers as Chris types. */
  function liveSettings(st) {
    var s = {};
    var saved = obj(st.settings) || {};
    for (var k in saved) if (has(saved, k)) s[k] = saved[k];
    var d = st.draft || {};
    if (/^[0-6]$/.test(str(d.batch_weekday))) s.batch_weekday = Number(d.batch_weekday);
    if (HHMM_RE.test(str(d.batch_time))) s.batch_time = d.batch_time;
    s.scripts_per_day = wholeNumber(d.scripts_per_day);
    s.days_per_batch = wholeNumber(d.days_per_batch);
    if (SIZE_RULES.indexOf(str(d.size_rule)) !== -1) s.size_rule = d.size_rule;
    return s;
  }

  /* renderPage — the whole tab from its state. */
  function renderPage(st, nowMs) {
    var top;
    if (st.settingsProblem) {
      top = '<div class="card span-12" id="setProblem"><div class="card-hd"><h2>Settings</h2></div>' +
        '<p class="caption bad-line" role="alert">' + esc(st.settingsProblem) + "</p>" +
        '<div class="row-act"><button class="btn" type="button" data-act="reload">Try again</button></div></div>';
    } else {
      /* Schedule is the long card, so the three short ones stack beside it
         instead of each stretching to its height. */
      top = renderSwitch(st) + renderSchedule(st) +
        '<div class="span-6 set-stack">' + renderCaps(st) + renderQuiet(st) + renderWinner() + "</div>";
    }
    return '<section class="grid set-grid" aria-label="Settings">' + top + renderFunnels(st, nowMs) + "</section>" +
      renderSaveBar(st);
  }

  /* The tab's own look (ctx.style). No px font sizes (UI-STANDARDS §12.7):
     sizes come from the brand's whitelist (.caption, .eyebrow, label, h2,
     legend inherits body). 8px spacing scale only. No shadow is written: the
     cards are .card. The save bar is pinned above data.js's status strip
     (design §3.0). */
  var CSS = [
    "#tab-settings .set-stack{display:flex;flex-direction:column;gap:16px;min-width:0}",
    "#tab-settings .gap8{margin-top:8px}",
    "#tab-settings .gap16{margin-top:16px}",
    "#tab-settings .fgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}",
    "#tab-settings .fgrid.mix{grid-template-columns:repeat(3,minmax(0,1fr))}",
    "#tab-settings .field input,#tab-settings .field select{width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px 16px;background:#fff}",
    "#tab-settings .field input[type=checkbox],#tab-settings .field input[type=radio],#tab-settings .camps input{width:20px;min-height:20px;height:20px;padding:0;flex:0 0 auto}",
    "#tab-settings .field select[disabled]{background:var(--soft,#F4F4F5);cursor:not-allowed}",
    "#tab-settings [aria-invalid=true]{border-color:#B42318}",
    "#tab-settings .fld-err{color:#6E2A22}",
    "#tab-settings fieldset{border:0;min-width:0}",
    "#tab-settings legend{color:var(--ink2);font-weight:600;margin-bottom:8px}",
    "#tab-settings .radio,#tab-settings .check{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}",
    "#tab-settings .unit-box{display:flex;align-items:center;gap:8px}",
    "#tab-settings .unit{color:var(--gray)}",
    "#tab-settings .warn-line{color:#6B4A12;font-weight:600;margin-top:8px}",
    "#tab-settings .bad-line{color:#6E2A22}",
    "#tab-settings .ask{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--soft,#F4F4F5);max-width:78ch}",
    "#tab-settings .ask p + p{margin-top:8px}",
    "#tab-settings .ask-act{display:flex;gap:32px;align-items:center;flex-wrap:wrap;margin-top:16px}",
    "#tab-settings .btn.link{border-color:transparent;text-decoration:underline;background:transparent}",
    "#tab-settings .funnel{border-top:1px solid var(--line);padding-top:24px;margin-top:24px}",
    "#tab-settings .funnel-hd{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}",
    "#tab-settings .checks{justify-content:flex-end}",
    "#tab-settings .camps{list-style:none;display:flex;flex-direction:column;gap:8px;margin-top:8px}",
    "#tab-settings .camps li{border:1px solid var(--line);border-radius:8px;padding:8px 16px}",
    "#tab-settings .camps label.check{min-height:40px}",
    /* padding-right:64px keeps Save clear of the shell's round Chat button,
       which is pinned 18px from the bottom-right corner of every staff page. */
    "#tab-settings .savebar{position:sticky;bottom:calc(var(--fh-statusbar,0px) + env(safe-area-inset-bottom,0px));z-index:10;background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 64px 16px 24px}",
    "#tab-settings .savebar-row{display:flex;align-items:center;justify-content:flex-end;gap:16px;flex-wrap:wrap}",
    "#tab-settings .save-say{flex:1 1 240px;color:var(--gray)}",
    "#tab-settings .save-say.ok{color:#2C5138;font-weight:600}",
    "#tab-settings .save-say.err{color:#6E2A22;font-weight:600}",
    "#tab-settings .save-say.wait{color:#6B4A12}",
    "#tab-settings .conflict{margin-bottom:16px;padding:16px;border:1px solid var(--line);border-radius:8px;background:color-mix(in srgb,var(--warn) 18%,#fff)}",
    "#tab-settings .both{width:100%;border-collapse:collapse;margin-top:8px}",
    "#tab-settings .both th,#tab-settings .both td{text-align:left;padding:8px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}",
    "@media (max-width:720px){#tab-settings .fgrid,#tab-settings .fgrid.mix{grid-template-columns:repeat(2,minmax(0,1fr))}#tab-settings .savebar{padding:16px 64px 16px 16px}}",
    "@media (max-width:480px){#tab-settings .fgrid{grid-template-columns:minmax(0,1fr)}#tab-settings .fgrid.mix{grid-template-columns:repeat(2,minmax(0,1fr))}#tab-settings .ask-act .btn{width:100%}#tab-settings .savebar-row{flex-wrap:nowrap}#tab-settings .save-say{flex:1 1 0;min-width:0}#tab-settings .savebar .btn.primary{width:auto}}"
  ].join("\n");

  var RULES = {
    WEEKDAYS: WEEKDAYS,
    FORMATS: FORMATS,
    FORMAT_WORDS: FORMAT_WORDS,
    STYLE_WORDS: STYLE_WORDS,
    SIZE_RULES: SIZE_RULES,
    LANES: LANES,
    CTA_WORDS: CTA_WORDS,
    EDIT_KEYS: EDIT_KEYS,
    HIDDEN_KEYS: HIDDEN_KEYS,
    FIELD_WORDS: FIELD_WORDS,
    FUNNEL_FIELDS: FUNNEL_FIELDS,
    FUNNEL_WORDS: FUNNEL_WORDS,
    NEVER: NEVER,
    CSS: CSS,
    timeWords: timeWords,
    usd: usd,
    centsWords: centsWords,
    spendWords: spendWords,
    normalizeSettings: normalizeSettings,
    normalizeFunnels: normalizeFunnels,
    normalizeHealth: normalizeHealth,
    sizeRuleWords: sizeRuleWords,
    batchSize: batchSize,
    scheduleLine: scheduleLine,
    switchWords: switchWords,
    switchPatch: switchPatch,
    capWarning: capWarning,
    spentLine: spentLine,
    draftOfSettings: draftOfSettings,
    diffSettings: diffSettings,
    draftOfFunnel: draftOfFunnel,
    diffFunnel: diffFunnel,
    campaignChoices: campaignChoices,
    adSetChoices: adSetChoices,
    noCampaignLine: noCampaignLine,
    asOfLine: asOfLine,
    problemWords: problemWords,
    loadProblem: loadProblem,
    valueWords: valueWords,
    conflictRows: conflictRows,
    saveAnswer: saveAnswer,
    quietLine: quietLine,
    renderLoading: renderLoading,
    renderPage: renderPage,
    newState: newState
  };
  root.FHMarketingCCSettings = RULES;

  /* newState — an empty tab before anything has loaded. */
  function newState() {
    return {
      loaded: false,
      settings: null, settingsProblem: "", draft: draftOfSettings(null), errors: [],
      funnels: [], campaigns: [], adSets: [], asOf: null, funnelsProblem: "",
      funnelDraft: {}, funnelErrors: {},
      health: normalizeHealth(null),
      switchAsk: false, switchBusy: false, switchSay: null,
      conflict: null, capConfirm: false, saving: false, say: null, dirty: false
    };
  }

  /* ── the tab ─────────────────────────────────────────────────────────── */

  var TAB = {
    key: "settings",
    label: "Settings",
    place: "gear",
    order: 900,
    rules: RULES,
    render: function (panel, ctx) { mount(panel, ctx); }
  };
  if (root.FHMarketingCCTabs && typeof root.FHMarketingCCTabs.register === "function") {
    root.FHMarketingCCTabs.register(TAB);
  } else {
    (root.FHMarketingCCTabsQueue = root.FHMarketingCCTabsQueue || []).push(TAB);
  }

  /* ── the page ────────────────────────────────────────────────────────── */

  function mount(panel, ctx) {
    var doc = root.document;
    ctx.style("settings", CSS);
    var st = newState();
    panel.innerHTML = renderLoading();

    function paint() {
      panel.innerHTML = renderPage(st, Date.now());
    }

    /* readForm — the boxes into the drafts. */
    function readForm() {
      var d = draftOfSettings(st.settings);
      var sBoxes = panel.querySelectorAll("[data-s]");
      for (var i = 0; i < sBoxes.length; i++) {
        var el = sBoxes[i];
        var key = el.getAttribute("data-s");
        if (key === "format_style") d.format_style[el.getAttribute("data-format")] = el.value;
        else if (el.type === "radio") { if (el.checked) d[key] = el.value; }
        else d[key] = el.value;
      }
      if (st.settings) st.draft = d;
      st.funnels.forEach(function (f) {
        var fd = draftOfFunnel(f);
        var ids = [];
        var boxes = panel.querySelectorAll('[data-f="' + f.key + '"]');
        var sawAdSet = false;
        for (var j = 0; j < boxes.length; j++) {
          var b = boxes[j];
          var field = b.getAttribute("data-field");
          if (field === "meta_campaign_ids") { if (b.checked) ids.push(b.value); }
          else if (field === "format_mix") fd.format_mix[b.getAttribute("data-format")] = b.value;
          else if (field === "active" || field === "book_call") fd[field] = b.checked;
          else if (field === "default_ad_set_external_id") { sawAdSet = true; fd[field] = b.value; }
          else fd[field] = b.value;
        }
        /* Unticked boxes are not read above; the saved ones that stayed ticked
           are. A disabled box (on another funnel) is never this funnel's. */
        fd.meta_campaign_ids = ids;
        if (!sawAdSet) fd.default_ad_set_external_id = st.funnelDraft[f.key] ? st.funnelDraft[f.key].default_ad_set_external_id : fd.default_ad_set_external_id;
        st.funnelDraft[f.key] = fd;
      });
    }

    function pending() {
      var s = st.settings ? diffSettings(st.settings, st.draft) : { patch: {}, errors: [], changed: false };
      var fs = st.funnels.map(function (f) { return { funnel: f, diff: diffFunnel(f, st.funnelDraft[f.key]) }; });
      return { settings: s, funnels: fs };
    }

    /* dirty — something in the boxes is not what is saved: a change, or a box
       that is not right yet (Save then says which one, instead of resting). */
    function markDirty() {
      var p = pending();
      st.dirty = p.settings.changed || p.settings.errors.length > 0 ||
        p.funnels.some(function (x) { return x.diff.changed || x.diff.errors.length > 0; });
      return p;
    }

    /* live — the words that follow the boxes as Chris types, without a
       repaint (a repaint would take the cursor out of the box). */
    function live() {
      var s = liveSettings(st);
      var line = panel.querySelector('[data-live="schedule"]');
      if (line) line.textContent = scheduleLine(s, st.funnels);
      SIZE_RULES.forEach(function (r) {
        var el = panel.querySelector('[data-live="rule-' + r + '"]');
        if (el) el.textContent = sizeRuleWords(r, st.draft.scripts_per_day);
      });
      var q = panel.querySelector('[data-live="quiet"]');
      if (q) q.textContent = quietLine(st.draft);
      var warn = capWarning(st.draft.max_month_cost_usd, st.health);
      var w = panel.querySelector('[data-live="cap-warn"]');
      if (w) { w.textContent = warn || ""; w.hidden = !warn; }
      if (!warn) st.capConfirm = false;
      st.say = null;
      paintBar();
    }

    /* paintBar — the Save button and its line, changed in place. Never
       rebuilt: a box's change event fires on the same press that taps Save
       (the box loses focus first), and a rebuilt button would lose the tap. */
    function paintBar() {
      var btn = $("setSave");
      var sayEl = $("setSay");
      if (!btn || !sayEl) return;
      var line = st.say ? st.say.text : (st.dirty ? "You have changes that are not saved." : "No changes to save.");
      var tone = st.say ? st.say.tone : (st.dirty ? "wait" : "");
      sayEl.textContent = line;
      sayEl.className = "caption save-say " + tone;
      btn.disabled = !st.dirty || st.saving || !!st.conflict;
      var lbl = btn.querySelector(".lbl");
      if (lbl) lbl.textContent = st.saving ? "Saving…" : (st.capConfirm ? "Save anyway" : "Save");
    }

    function $(id) { return doc.getElementById(id); }

    function load() {
      return Promise.all([
        ctx.api("/api/marketing/settings"),
        ctx.api("/api/marketing/funnels"),
        ctx.api("/api/marketing/health")
      ]).then(function (all) {
        var s = normalizeSettings(all[0]);
        st.settings = s;
        st.settingsProblem = s ? "" : loadProblem(all[0], "settings");
        st.draft = draftOfSettings(s);
        st.errors = [];
        var f = normalizeFunnels(all[1]);
        st.funnelsProblem = f ? "" : loadProblem(all[1], "funnels");
        st.funnels = f ? f.funnels : [];
        st.campaigns = f ? f.campaigns : [];
        st.adSets = f ? f.adSets : [];
        st.asOf = f ? f.asOf : null;
        st.funnelDraft = {};
        st.funnelErrors = {};
        st.funnels.forEach(function (x) { st.funnelDraft[x.key] = draftOfFunnel(x); });
        st.health = normalizeHealth(all[2]);
        st.loaded = true;
        st.conflict = null;
        st.capConfirm = false;
        st.say = null;
        markDirty();
        paint();
      });
    }

    function busy(btn, on) {
      if (!btn) return;
      btn.classList.toggle("busy", on);
      btn.disabled = on;
      btn.setAttribute("aria-busy", on ? "true" : "false");
    }

    /* The switch: two taps. The first opens the sheet that names the money;
       the second saves only {enabled}. */
    function flipSwitch() {
      if (!st.settings || st.switchBusy) return;
      var turnOn = st.settings.enabled !== true;
      st.switchBusy = true;
      busy(panel.querySelector('[data-act="switch-yes"]'), true);
      ctx.post("/api/marketing/settings", { updated_at: st.settings.updated_at, patch: switchPatch(turnOn) }).then(function (res) {
        st.switchBusy = false;
        var saved = normalizeSettings(res);
        var at = ctx.clock(Date.now());
        if (saved) {
          st.settings = saved;
          st.switchAsk = false;
          st.switchSay = { tone: "ok", text: (saved.enabled ? "Weekly scripts are on." : "Weekly scripts are off.") + " Saved " + at + "." };
        } else if (res.status === 409 && res.body && obj(res.body.current)) {
          st.settings = res.body.current;
          st.switchAsk = false;
          st.switchSay = {
            tone: "err",
            text: "Did not save. Someone changed the settings after you opened this page. This page now shows what is saved: weekly scripts are " +
              (st.settings.enabled ? "on" : "off") + ". Tap the button again if you still want to change it."
          };
        } else {
          st.switchSay = { tone: "err", text: "Did not save. " + problemWords(res, "settings") + " Try again." };
        }
        readFormSafe();
        markDirty();
        paint();
      });
    }

    function readFormSafe() { try { readForm(); } catch (e) { /* the form was not painted */ } }

    function postSettings(patch, updatedAt) {
      return ctx.post("/api/marketing/settings", { updated_at: updatedAt, patch: patch });
    }
    function postFunnel(patch) {
      return ctx.post("/api/marketing/funnels", { funnel: patch });
    }

    /* save — one press: the settings that changed, then each funnel that
       changed, one write each. Every write carries a fresh request_id and the
       updated_at it was read at. */
    function save() {
      if (st.saving) return;
      readForm();
      var p = markDirty();
      st.errors = p.settings.errors;
      st.funnelErrors = {};
      p.funnels.forEach(function (x) { if (x.diff.errors.length) st.funnelErrors[x.funnel.key] = x.diff.errors; });
      var firstError = p.settings.errors[0] || p.funnels.map(function (x) { return x.diff.errors[0]; }).filter(Boolean)[0];
      if (firstError) {
        st.say = { tone: "err", text: "Did not save. " + firstError.message };
        paint();
        return;
      }
      if (!st.dirty) {
        st.say = { tone: "wait", text: "Nothing changed yet." };
        paint();
        return;
      }
      if (p.settings.changed && has(p.settings.patch, "max_month_cost_usd") && capWarning(st.draft.max_month_cost_usd, st.health) && !st.capConfirm) {
        st.capConfirm = true;
        st.say = { tone: "wait", text: capWarning(st.draft.max_month_cost_usd, st.health) + " Tap Save anyway to keep it." };
        paint();
        return;
      }
      st.saving = true;
      st.conflict = null;
      st.say = null;
      paint();

      var parts = [];
      var chain = Promise.resolve();
      if (p.settings.changed) {
        chain = chain.then(function () {
          var patch = p.settings.patch;
          return postSettings(patch, st.settings.updated_at).then(function (res) {
            var saved = normalizeSettings(res);
            if (saved) {
              st.settings = saved;
              st.draft = draftOfSettings(saved);
              parts.push({ what: "Settings", ok: true });
            } else if (res.status === 409 && res.body && obj(res.body.current)) {
              st.conflict = { kind: "settings", what: "Settings", patch: patch, current: res.body.current, rows: conflictRows(patch, res.body.current, "settings") };
              parts.push({ what: "Settings", ok: false, conflict: true });
            } else {
              parts.push({ what: "Settings", ok: false, problem: problemWords(res, "settings") });
            }
          });
        });
      }
      p.funnels.forEach(function (x) {
        if (!x.diff.changed) return;
        chain = chain.then(function () {
          if (st.conflict) return null;
          var what = x.funnel.name || x.funnel.key;
          return postFunnel(x.diff.patch).then(function (res) {
            var b = body(res);
            var saved = res.status === 200 && b && obj(b.funnel) ? b.funnel : null;
            if (saved) {
              replaceFunnel(saved);
              parts.push({ what: what, ok: true });
            } else if (res.status === 409 && b && obj(b.current)) {
              st.conflict = { kind: "funnel", key: x.funnel.key, what: what, patch: x.diff.patch, current: b.current, rows: conflictRows(x.diff.patch, b.current, "funnel") };
              parts.push({ what: what, ok: false, conflict: true });
            } else {
              parts.push({ what: what, ok: false, problem: problemWords(res, "funnel") });
            }
          });
        });
      });
      chain.then(function () {
        st.saving = false;
        st.capConfirm = false;
        st.say = saveAnswer(parts, Date.now());
        markDirty();
        paint();
      }, function () {
        st.saving = false;
        st.say = { tone: "err", text: "Did not save. Something went wrong on this page. Reload it and try again." };
        paint();
      });
    }

    function replaceFunnel(saved) {
      st.funnels = st.funnels.map(function (f) { return f.key === saved.key ? saved : f; });
      st.funnelDraft[saved.key] = draftOfFunnel(saved);
      /* The campaign list says which funnel holds each campaign. */
      var ids = arr(saved.meta_campaign_ids).map(str);
      st.campaigns = st.campaigns.map(function (c) {
        var out = {};
        for (var k in c) if (has(c, k)) out[k] = c[k];
        if (ids.indexOf(str(c.external_id)) !== -1) out.funnel_key = saved.key;
        else if (c.funnel_key === saved.key) out.funnel_key = null;
        return out;
      });
    }

    /* Keep mine: send the same change again over the version that is saved
       now. Use the saved one: drop the change and show what is saved. */
    function keepMine() {
      var c = st.conflict;
      if (!c) return;
      if (c.kind === "settings") {
        st.settings = c.current;
        st.conflict = null;
        st.saving = true;
        paint();
        postSettings(c.patch, c.current.updated_at).then(function (res) {
          st.saving = false;
          var saved = normalizeSettings(res);
          if (saved) {
            st.settings = saved;
            st.draft = draftOfSettings(saved);
            st.say = { tone: "ok", text: "Saved " + ctx.clock(Date.now()) + ". Your version is the saved one now." };
          } else if (res.status === 409 && res.body && obj(res.body.current)) {
            st.conflict = { kind: "settings", what: "Settings", patch: c.patch, current: res.body.current, rows: conflictRows(c.patch, res.body.current, "settings") };
            st.say = saveAnswer([{ what: "Settings", ok: false, conflict: true }], Date.now());
          } else {
            st.say = { tone: "err", text: "Did not save. " + problemWords(res, "settings") + " Try again." };
          }
          markDirty();
          paint();
        });
        return;
      }
      var patch = {};
      for (var k in c.patch) if (has(c.patch, k)) patch[k] = c.patch[k];
      patch.updated_at = c.current.updated_at;
      st.conflict = null;
      st.saving = true;
      paint();
      postFunnel(patch).then(function (res) {
        st.saving = false;
        var b = body(res);
        if (res.status === 200 && b && obj(b.funnel)) {
          replaceFunnel(b.funnel);
          st.say = { tone: "ok", text: "Saved " + ctx.clock(Date.now()) + ". Your version is the saved one now." };
        } else if (res.status === 409 && b && obj(b.current)) {
          st.conflict = { kind: "funnel", key: c.key, what: c.what, patch: patch, current: b.current, rows: conflictRows(patch, b.current, "funnel") };
          st.say = saveAnswer([{ what: c.what, ok: false, conflict: true }], Date.now());
        } else {
          st.say = { tone: "err", text: "Did not save. " + problemWords(res, "funnel") + " Try again." };
        }
        markDirty();
        paint();
      });
    }

    function useSaved() {
      var c = st.conflict;
      if (!c) return;
      if (c.kind === "settings") {
        st.settings = c.current;
        st.draft = draftOfSettings(c.current);
        st.errors = [];
      } else {
        replaceFunnel(c.current);
        st.funnelErrors[c.key] = [];
      }
      st.conflict = null;
      st.say = { tone: "ok", text: "This page now shows the saved version. Nothing of yours was saved." };
      markDirty();
      paint();
    }

    panel.addEventListener("input", function (e) {
      if (!st.loaded || !e.target || !e.target.matches("input, select")) return;
      readForm();
      markDirty();
      live();
    });
    panel.addEventListener("change", function (e) {
      if (!st.loaded || !e.target) return;
      var t = e.target;
      readForm();
      if (t.getAttribute("data-field") === "meta_campaign_ids") {
        var key = t.getAttribute("data-f");
        var d = st.funnelDraft[key];
        /* An ad set whose campaign was just unticked is no longer this
           funnel's: the picker goes back to None picked. */
        var allowed = adSetChoices(d.meta_campaign_ids, st.adSets, "").options.map(function (o) { return o.id; });
        if (d.default_ad_set_external_id && allowed.indexOf(d.default_ad_set_external_id) === -1) {
          d.default_ad_set_external_id = "";
        }
        var block = panel.querySelector('[data-live="adset-' + key + '"]');
        var f = st.funnels.filter(function (x) { return x.key === key; })[0];
        if (block && f) block.innerHTML = renderAdSet(st, f);
        var none = panel.querySelector('[data-live="none-' + key + '"]');
        var line = noCampaignLine(d.meta_campaign_ids);
        if (none) { none.textContent = line; none.hidden = !line; }
      }
      if (t.getAttribute("data-field") === "active") {
        var blockHd = t.closest("[data-funnel]");
        var ch = blockHd && blockHd.querySelector(".funnel-hd .chip");
        if (ch) ch.outerHTML = chip(t.checked ? "Running" : "Not running", t.checked ? "on" : "");
      }
      markDirty();
      live();
    });
    panel.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || t.disabled) return;
      var act = t.getAttribute("data-act");
      if (act === "switch-ask") { readFormSafe(); st.switchAsk = true; st.switchSay = null; paint(); var y = panel.querySelector('[data-act="switch-yes"]'); if (y) y.focus(); }
      else if (act === "switch-no") { readFormSafe(); st.switchAsk = false; paint(); }
      else if (act === "switch-yes") flipSwitch();
      else if (act === "save") save();
      else if (act === "keep-mine") keepMine();
      else if (act === "use-saved") useSaved();
      else if (act === "reload") { panel.innerHTML = renderLoading(); load(); }
    });

    load();
  }
})(typeof window !== "undefined" ? window : globalThis);
