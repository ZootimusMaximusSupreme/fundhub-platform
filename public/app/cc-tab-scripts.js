/* cc-tab-scripts.js — the Command Center's Scripts tab (plan unit U36).

   WHAT THIS TAB IS. The Monday job: Chris approves the week's scripts from his
   phone, one card at a time. Design: docs/specs/command-center-design-2026-10-05.md
   §3.0 and §3.3, slice 3 in §6. Spec: docs/specs/marketing-machine-2026-10-04.md
   §8.3 (Scripts), §8.1 (Inbox, Ideas and Rules), §7.8, §4 trap 17 (only a
   person approves or rejects). UI law: docs/rules/UI-STANDARDS.md.

   HOW IT PLUGS IN. docs/specs/command-center-tabs.md: one file per tab,
   registered on window.FundhubCC (works whether the frame loaded first or
   not). The frame owns the page, the tab bar, ctx.api, ctx.costSheet and the
   session. This file never edits the frame or another tab, and it never
   fetches by itself: every call goes through ctx.api.

   WHAT IT READS AND CALLS (docs/specs/marketing-machine-api.md shapes 3 and 4).
     GET  marketing/scripts            every live script the screen may see
     GET  marketing/script?id=         one script and every version, for "Every version"
     POST marketing/scripts/approve    {request_id, id, version}
     POST marketing/scripts/edit       {request_id, id, version, body, parts?}
     POST marketing/scripts/fix        {request_id, id, version, note, make_rule} -> 202
     POST marketing/scripts/reject     {request_id, id, version, reason?}
     POST marketing/scripts/order      {request_id, order:[root_script_id]}
     GET  marketing/batches            history + write_now_ready
     POST marketing/batches/write-now  {request_id} -> 202
     GET/POST marketing/ideas          the idea box
     GET/POST marketing/rules          Part 0, banned phrases, recent changes
     GET  marketing/settings           daily count, cost caps, the weekly drop time
     GET  marketing/funnels            funnel names for captions and the idea box
   Every write sends a fresh request_id (kept for a retry of the same tap) and,
   for a script, the version it was looking at. A 409 shows both texts.

   NO DEAD CONTROLS (UI-STANDARDS §5). Write now is not drawn at all while
   GET marketing/batches answers write_now_ready false (start_batch has no
   handler until plan unit U35). The new-opening card, the next-batch plan and
   "Send to Shoot" are not here: openings are out of this unit's scope, the
   plan preview lives on Today (U37), and the Shoot tab is another unit's.

   TYPE. The shell throws away px font sizes (UI-STANDARDS §12.7), so this file
   writes none. Sizes come from the brand whitelist only: h2 = title,
   .caption/.eyebrow/.chip/label = caption, everything else body.

   TESTABLE WITHOUT A BROWSER. Every rule that turns data into words or HTML
   is a plain function on window.FundhubCCScripts; src/ui/cc-tab-scripts.test.mjs
   runs this file in node:vm with no DOM. */
(function (W) {
  "use strict";

  /* ── words ────────────────────────────────────────────────────────────── */

  const AZ = "America/Phoenix";
  const POLL_MS = 5000;
  /* After this long with no new version, a Fix says it is taking long. */
  const FIX_SLOW_MS = 15 * 60 * 1000;
  /* How long a Write now is watched for its drafts. */
  const WRITE_WATCH_MS = 30 * 60 * 1000;
  const IDEAS_SHOWN = 10;

  /* ad_scripts.script_format values (spec §7.4) and the plain word for each. */
  const FORMATS = ["standard", "sorting", "long", "notes", "greenscreen", "vsl"];
  const FORMAT_WORDS = {
    standard: "standard",
    sorting: "sorting hat short",
    long: "long",
    notes: "notes",
    greenscreen: "green screen",
    vsl: "VSL"
  };
  /* Formats long enough that the card folds the middle under "Read the rest". */
  const LONG_FORMATS = ["long", "vsl"];

  const STATUS_WORDS = {
    draft: "draft",
    locked: "approved",
    filmed: "filmed",
    rejected: "rejected",
    superseded: "replaced",
    expired: "expired"
  };

  const FILTERS = [
    { key: "draft", label: "Drafts" },
    { key: "locked", label: "Approved" },
    { key: "filmed", label: "Filmed" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" }
  ];

  const PART_LABELS = {
    hook: "Hook (first line)",
    line2: "Line 2",
    body: "Body",
    cue: "Cue",
    reveal: "Reveal",
    cta: "Call to action"
  };

  const SOURCE_WORDS = {
    machine: "written by the machine",
    chris: "saved by Chris",
    agent: "written by an agent",
    import: "from before the machine"
  };

  const IDEA_WORDS = {
    new: "In the next batch",
    writing: "Being written",
    written: "Written",
    failed: "Could not be written",
    dropped: "Dropped"
  };

  const BATCH_WORDS = {
    planned: "Waiting to start",
    writing: "Writing",
    ready: "Written, not out yet",
    released: "Out",
    failed: "Stopped"
  };

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ── small helpers ────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : (many || one + "s")}`;
  }

  function isObj(v) { return v != null && typeof v === "object" && !Array.isArray(v); }

  function toMs(iso) {
    if (iso == null) return NaN;
    const t = typeof iso === "number" ? iso : Date.parse(iso);
    return Number.isFinite(t) ? t : NaN;
  }

  let AZ_FMT = null;
  let AZ_DAY_FMT = null;
  function azFmt() {
    if (!AZ_FMT) {
      AZ_FMT = new Intl.DateTimeFormat("en-US", {
        timeZone: AZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    }
    return AZ_FMT;
  }

  /** "Oct 12, 3:07 PM" in Arizona time, or "unknown". */
  function azTime(iso) {
    const t = toMs(iso);
    if (!Number.isFinite(t)) return "unknown";
    return azFmt().format(new Date(t)).replace(" at ", ", ");
  }

  /** "Oct 12" in Arizona time, or "unknown". */
  function azDay(iso) {
    const t = toMs(iso);
    if (!Number.isFinite(t)) return "unknown";
    if (!AZ_DAY_FMT) AZ_DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: AZ, month: "short", day: "numeric" });
    return AZ_DAY_FMT.format(new Date(t));
  }

  /** UI-STANDARDS §7: relative under 24 hours, absolute after (and for the future). */
  function when(iso, nowMs) {
    const t = toMs(iso);
    if (!Number.isFinite(t)) return "unknown";
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const diff = now - t;
    if (diff >= 0 && diff < 60 * 1000) return "just now";
    if (diff >= 0 && diff < 60 * 60 * 1000) return plural(Math.floor(diff / 60000), "minute") + " ago";
    if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return plural(Math.floor(diff / 3600000), "hour") + " ago";
    return azTime(iso);
  }

  /** A time with its exact Arizona time as the tooltip. */
  function timeTag(iso, nowMs) {
    return `<time datetime="${esc(iso || "")}" title="${esc(azTime(iso))} Arizona time">${esc(when(iso, nowMs))}</time>`;
  }

  function formatWord(f) {
    return f == null ? "any format" : (FORMAT_WORDS[f] || String(f));
  }

  /** The funnel's own name from GET marketing/funnels, else its key in words. */
  function funnelName(key, funnels) {
    if (key == null || key === "") return "no funnel";
    const list = Array.isArray(funnels) ? funnels : [];
    const f = list.find((x) => x && x.key === key);
    if (f && f.name) return String(f.name);
    return String(key).replace(/_/g, " ");
  }

  function hhmmWords(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
    if (!m) return null;
    const h = Number(m[1]);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m[2]} ${ampm}`;
  }

  function newRequestId() {
    const c = W.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    let d = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ── the rules that turn data into words ──────────────────────────────── */

  /**
   * The inbox: released drafts, "needs a look" first, then the order they
   * were written in. A draft being rewritten from a Fix note goes to the end.
   * @param {any[]} scripts @param {Record<string, any>} [pendingFix]
   */
  function inboxOrder(scripts, pendingFix) {
    const pend = pendingFix || {};
    return (Array.isArray(scripts) ? scripts : [])
      .filter((s) => s && s.status === "draft")
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const pa = pend[a.s.root_script_id] ? 1 : 0;
        const pb = pend[b.s.root_script_id] ? 1 : 0;
        if (pa !== pb) return pa - pb;
        const fa = a.s.flagged ? 0 : 1;
        const fb = b.s.flagged ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const ta = toMs(a.s.created_at);
        const tb = toMs(b.s.created_at);
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return a.i - b.i;
      })
      .map((x) => x.s);
  }

  /** Approved scripts in film order: film_order first (1 = first), then by ad number. */
  function filmOrder(scripts) {
    const adNum = (s) => (s.ad_id != null && /^\d+$/.test(String(s.ad_id)) ? Number(s.ad_id) : Infinity);
    return (Array.isArray(scripts) ? scripts : [])
      .filter((s) => s && s.status === "locked")
      .slice()
      .sort((a, b) => {
        const oa = a.film_order == null ? Infinity : Number(a.film_order);
        const ob = b.film_order == null ? Infinity : Number(b.film_order);
        if (oa !== ob) return oa - ob;
        const na = adNum(a); const nb = adNum(b);
        if (na !== nb) return na - nb;
        return toMs(a.locked_at) - toMs(b.locked_at);
      });
  }

  /**
   * A new film order: move `id` up one, down one, or to the front.
   * @param {string[]} ids @param {string} id @param {'up'|'down'|'first'} how
   */
  function moveInOrder(ids, id, how) {
    const list = ids.slice();
    const at = list.indexOf(id);
    if (at < 0) return list;
    if (how === "first") { list.splice(at, 1); list.unshift(id); return list; }
    const to = how === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= list.length) return list;
    list[at] = list[to];
    list[to] = id;
    return list;
  }

  /** The script in the list, counted by status, for the filter chips. */
  function countsByFilter(scripts) {
    const c = { draft: 0, locked: 0, filmed: 0, rejected: 0, all: 0 };
    for (const s of Array.isArray(scripts) ? scripts : []) {
      if (!s) continue;
      c.all++;
      if (c[s.status] != null) c[s.status]++;
    }
    return c;
  }

  /** "Draft 3 of 15 · Roadmap $147 · standard". No ad number: Approve gives it. */
  function cardCaption(s, index, total, funnels) {
    const parts = [`Draft ${index + 1} of ${total}`, funnelName(s.funnel_key, funnels), formatWord(s.script_format)];
    if (s.version > 1) parts.push(`version ${s.version}`);
    return parts.join(" · ");
  }

  /** The reasons a draft needs a look, in the writer's own plain sentences. */
  function flagReasons(s) {
    const c = s && s.check_results;
    if (!isObj(c)) return [];
    if (Array.isArray(c.flag_reasons) && c.flag_reasons.length) return c.flag_reasons.map(String);
    const out = [];
    for (const [k, v] of Object.entries(c)) {
      if (isObj(v) && v.passed === false) out.push(`It did not pass ${sectionName(k)}.`);
    }
    return out;
  }

  /** One check line in words (design §3.3 item 2). */
  function checkLine(s) {
    if (!s) return { tone: "none", text: "" };
    if (s.flagged) {
      const why = flagReasons(s);
      const first = why[0] || "It did not pass every check.";
      return { tone: "flag", text: `Needs a look: ${first} Approve anyway if you like it.`, more: why.slice(1) };
    }
    const c = s.check_results;
    if (!isObj(c)) return { tone: "none", text: "Not checked by the machine." };
    const strict = isObj(c.strict) ? c.strict : null;
    const n = strict && Array.isArray(strict.failures) ? strict.failures.length : 0;
    if (strict && strict.passed === false) {
      return { tone: "warn", text: `The rule checker found ${plural(n || 1, "thing")} to look at. It never blocks a person's save.` };
    }
    return { tone: "ok", text: "Passes every rule." };
  }

  function sectionName(k) {
    return ({
      strict: "the rule checker", judge: "the rule judge", compliance: "the compliance screen",
      parts: "the parts check", animation: "the animation plan", meta_copy: "the ad text check",
      offer: "the price rule", labels: "the label check", sameness: "the sameness check"
    })[k] || `the ${String(k).replace(/_/g, " ")} check`;
  }

  /**
   * Every check in a version's check_results, as {name, state, lines}.
   * state: 'passed' | 'failed' | 'not run'.
   */
  function checkWords(check) {
    if (!isObj(check)) return [{ name: "Checks", state: "not run", lines: ["Not checked by the machine."] }];
    const out = [];
    const strict = check.strict;
    if (isObj(strict)) {
      const lines = [];
      for (const f of Array.isArray(strict.failures) ? strict.failures : []) {
        lines.push(`${f.line ? `Line ${f.line}: ` : ""}${f.message || f.rule || "breaks a rule"}`);
      }
      for (const w of Array.isArray(strict.warnings) ? strict.warnings : []) lines.push(`Warning: ${w.message || w.rule}`);
      out.push({ name: "Rule checker", state: strict.passed === false ? "failed" : "passed", lines });
    }
    const judge = check.judge;
    if (isObj(judge)) {
      const lines = [];
      if (judge.ran === false) lines.push(`Did not run: ${judge.error || "no reason given"}`);
      for (const n of Array.isArray(judge.notes) ? judge.notes : []) {
        lines.push(`${n.rule != null ? `Rule ${n.rule}: ` : ""}${n.quote ? `"${n.quote}". ` : ""}${n.fix || ""}`.trim());
      }
      out.push({ name: "Rule judge", state: judge.ran === false ? "not run" : (judge.passed === false || lines.length ? "failed" : "passed"), lines });
    }
    const comp = check.compliance;
    if (isObj(comp)) {
      const lines = (Array.isArray(comp.reasons) ? comp.reasons : []).map((r) => (isObj(r) ? (r.message || r.code) : String(r)));
      const blocked = comp.copy_blocked === true || comp.engine_blocked === true || (comp.state && comp.state !== "passed");
      out.push({ name: "Compliance screen", state: blocked ? "failed" : "passed", lines });
    }
    for (const k of ["parts", "animation", "meta_copy", "offer", "labels"]) {
      const v = check[k];
      if (!isObj(v) || typeof v.passed !== "boolean") continue;
      const list = Array.isArray(v.errors) ? v.errors : (Array.isArray(v.failures) ? v.failures : []);
      out.push({
        name: sectionName(k).replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()),
        state: v.passed ? "passed" : "failed",
        lines: list.map((e) => (isObj(e) ? (e.message || e.code) : String(e)))
      });
    }
    if (Array.isArray(check.flag_reasons) && check.flag_reasons.length) {
      out.unshift({ name: "Needs a look", state: "failed", lines: check.flag_reasons.map(String) });
    }
    if (!out.length) out.push({ name: "Checks", state: "passed", lines: [] });
    return out;
  }

  /** parts grouped for the card: hook, line 2, cues, body lines, reveal, CTA. */
  function partsView(s) {
    const parts = s && Array.isArray(s.parts) ? s.parts : null;
    if (!parts || !parts.length) return null;
    const v = { hook: [], line2: [], cue: [], body: [], reveal: [], cta: [] };
    for (const p of parts) {
      if (!p || typeof p.text !== "string" || !v[p.kind]) continue;
      v[p.kind].push(p.text);
    }
    return v;
  }

  /** Parts joined into a teleprompter body: cues one per line, a blank line between the rest. */
  function joinParts(parts) {
    let out = "";
    let prev = null;
    for (const p of parts) {
      if (!p || !String(p.text || "").trim()) continue;
      if (out) out += prev === "cue" && p.kind === "cue" ? "\n" : "\n\n";
      out += p.text;
      prev = p.kind;
    }
    return out;
  }

  /**
   * The new body after a per-part edit. Each changed part's words are swapped
   * in place inside the old body, so the CAPS, pauses and marks around them
   * survive word for word. If the old parts cannot be found in the old body,
   * the body is rebuilt from the parts.
   * @param {string} oldBody @param {Array<{kind:string,text:string}>} oldParts
   * @param {Array<{kind:string,text:string}>} newParts same length as oldParts
   */
  function bodyFromEdits(oldBody, oldParts, newParts) {
    const body = String(oldBody || "");
    if (!Array.isArray(oldParts) || !Array.isArray(newParts) || oldParts.length !== newParts.length) {
      return joinParts(newParts || []);
    }
    let out = "";
    let at = 0;
    let emptied = false;
    for (let i = 0; i < oldParts.length; i++) {
      const before = String((oldParts[i] && oldParts[i].text) || "");
      const after = String((newParts[i] && newParts[i].text) || "");
      const idx = before ? body.indexOf(before, at) : -1;
      if (idx < 0) return joinParts(newParts);
      if (!after.trim()) emptied = true;
      out += body.slice(at, idx) + after;
      at = idx + before.length;
    }
    out += body.slice(at);
    return emptied ? out.replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "") : out;
  }

  /** The header's main line. */
  function headline(counts, filter) {
    const n = counts[filter] || 0;
    if (filter === "draft") return n ? `${plural(n, "script")} waiting for you` : "No scripts waiting for you";
    if (filter === "locked") return n ? `${plural(n, "approved script")} to film` : "No approved scripts to film";
    if (filter === "filmed") return n ? `${plural(n, "filmed script")}` : "No filmed scripts yet";
    if (filter === "rejected") return n ? `${plural(n, "rejected script")}` : "No rejected scripts";
    return `${plural(n, "script")} in all`;
  }

  /** The newest batch in one line ("Oct 12 batch: 18 of 21 ready, 3 need a look."). */
  function latestBatchLine(batches) {
    const b = Array.isArray(batches) && batches.length ? batches[0] : null;
    if (!b) return null;
    const c = isObj(b.counts) ? b.counts : {};
    const day = azDay(b.release_at || b.released_at);
    const name = b.kind === "on_command" ? `Write now batch (${day})` : `${day} batch`;
    if (b.status === "failed") return `${name} stopped: ${b.error || "no reason was saved"}.`.replace(/\.\.$/, ".");
    if (b.status === "planned") return `${name}: waiting to start.`;
    if (b.status === "writing") return `${name}: writing. ${c.ready ?? 0} of ${c.total ?? "unknown"} ready.`;
    const bits = [`${c.ready ?? 0} of ${c.total ?? "unknown"} ready`];
    if (c.flagged) bits.push(`${c.flagged} need a look`);
    if (c.failed) bits.push(`${c.failed} failed`);
    return `${name}: ${bits.join(", ")}.`;
  }

  /** Write now is drawn only when the back end can make drafts from it. */
  function showWriteNow(batchesAnswer) {
    return !!(batchesAnswer && batchesAnswer.write_now_ready === true);
  }

  function capWords(settings) {
    const b = settings && settings.max_batch_cost_usd;
    const m = settings && settings.max_month_cost_usd;
    const bt = b == null ? "the batch cap (unknown)" : `$${b} a batch`;
    const mt = m == null ? "the month cap (unknown)" : `$${m} a month`;
    return `Stops by itself at ${bt} and ${mt}.`;
  }

  /** The plain cost note under Write now. Every cost is unknown until measured. */
  function writeNowNote(settings) {
    const n = settings && Number.isInteger(settings.scripts_per_day) ? settings.scripts_per_day : null;
    const what = n == null ? "Writes your daily number of scripts" : `Writes ${plural(n, "script")}`;
    return `${what} with the model. Cost and time: unknown, not measured yet. ${capWords(settings)}`;
  }

  /** The schedule line on an empty inbox. */
  function scheduleLine(settings) {
    if (!isObj(settings)) return null;
    if (settings.enabled !== true) return "The weekly drop is off. It turns on in Settings (the gear, top right).";
    const day = WEEKDAYS[settings.batch_weekday];
    const t = hhmmWords(settings.batch_time);
    const tz = settings.timezone === AZ ? "Arizona time" : (settings.timezone || "");
    if (!day || !t) return "The weekly drop is on.";
    return `The weekly drop is on: ${day} at ${t} ${tz}.`.replace(/ \.$/, ".");
  }

  function ruleActionWords(row) {
    if (!row) return "";
    if (row.action === "add") return "Added a rule";
    if (row.action === "edit") return "Changed a rule";
    if (row.action === "ban") return "Banned a phrase";
    return "Changed the rules";
  }

  /** What happened to a rule change on its way to the repo. */
  function ruleStateWords(row) {
    if (!row) return { word: "unknown", tone: "" };
    if (row.state === "committed") {
      return { word: "In the repo", tone: "on", detail: row.committed_sha ? `commit ${String(row.committed_sha).slice(0, 7)}` : null };
    }
    if (row.state === "failed") return { word: "Refused by the repo", tone: "bad", detail: "It tries again by itself. The reason shows on Today's machine card." };
    return { word: "Reaching the repo", tone: "wip", detail: null };
  }

  function ideaStatusWord(status) { return IDEA_WORDS[status] || String(status || "unknown"); }

  function batchStatusWord(status) { return BATCH_WORDS[status] || String(status || "unknown"); }

  /**
   * Any failed answer in plain words. Never a status code (UI-STANDARDS §6.3).
   * @param {any} r normalised ctx.api answer
   */
  function plainError(r) {
    if (!r || !r.status) return "Could not reach Fundhub. Nothing changed. Check the connection and try again.";
    const d = isObj(r.data) ? r.data : {};
    const msg = typeof d.message === "string" && d.message.trim() ? d.message.trim() : null;
    if (r.status === 401) return "You are signed out. Sign in again. Nothing was saved.";
    if (r.status === 403) return "Only the owner or an admin can do this.";
    if (r.status === 409) return "This changed since you opened it. Nothing was saved.";
    if (msg && r.status < 500) return msg;
    if (r.status === 404) return "That was not found. It may have moved. Reload and try again.";
    if (r.status === 503) return msg || "Fundhub's database is not answering right now. Nothing changed. Try again in a minute.";
    if (r.status >= 500) return "Something broke on our side. Nothing changed. Try again.";
    return "That did not work. Nothing changed. Try again.";
  }

  /* ── HTML builders (pure: state in, string out) ───────────────────────── */

  function chip(word, tone) {
    return `<span class="chip${tone ? " " + tone : ""}"><span class="cd"></span>${esc(word)}</span>`;
  }

  function skeleton(lines) {
    let h = "";
    for (let i = 0; i < (lines || 3); i++) h += `<span class="ccs-skel${i === 0 ? " wide" : ""}"></span>`;
    return `<div class="ccs-skels" aria-busy="true" aria-label="Loading">${h}</div>`;
  }

  function sayHtml(say, scope) {
    if (!say || say.scope !== scope) return `<p class="ccs-say" role="status" aria-live="polite"></p>`;
    const more = Array.isArray(say.more) && say.more.length
      ? `<ul class="ccs-say-more">${say.more.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : "";
    return `<div class="ccs-say show ${esc(say.tone || "ok")}" role="status" aria-live="polite"><p>${esc(say.text)}</p>${more}</div>`;
  }

  function partErr(text, act) {
    return `<div class="ccs-err" role="alert"><p>${esc(text)}</p><button type="button" class="btn" data-act="${esc(act)}">Try again</button></div>`;
  }

  function btn(label, act, opts) {
    const o = opts || {};
    const cls = ["btn"].concat(o.cls ? [o.cls] : []).join(" ");
    const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
    const busy = o.busy ? " busy" : "";
    const dis = o.disabled || o.busy ? " disabled" : "";
    const aria = o.aria ? ` aria-label="${esc(o.aria)}"` : "";
    return `<button type="button" class="${cls}${busy}" data-act="${esc(act)}"${data}${dis}${aria}><span class="ccs-spin" aria-hidden="true"></span>${esc(o.busy && o.busyLabel ? o.busyLabel : label)}</button>`;
  }

  /** The words of a script, word for word, the way the card shows them. */
  function wordsHtml(s, openMap) {
    const om = openMap || {};
    const restOpen = om[`rest:${s.id}`] ? " open" : "";
    const v = partsView(s);
    if (!v) {
      const long = LONG_FORMATS.includes(s.script_format) || String(s.body || "").length > 900;
      if (!long) return `<p class="ccs-pre">${esc(s.body)}</p>`;
      const body = String(s.body || "");
      const cut = body.indexOf("\n\n", 240);
      const head = cut > 0 ? body.slice(0, cut) : body.slice(0, 400);
      const rest = cut > 0 ? body.slice(cut + 2) : body.slice(400);
      return `<p class="ccs-pre">${esc(head)}</p>` +
        (rest ? `<details class="ccs-more" data-fold="rest:${esc(s.id)}"${restOpen}><summary>Read the rest</summary><p class="ccs-pre">${esc(rest)}</p></details>` : "");
    }
    const hook = v.hook.map((t) => `<p class="ccs-pre ccs-hook"><b>${esc(t)}</b></p>`).join("");
    const line2 = v.line2.map((t) => `<p class="ccs-pre ccs-hook"><b>${esc(t)}</b></p>`).join("");
    const cues = v.cue.length ? `<ul class="ccs-cues" aria-label="Cues">${v.cue.map((t) => `<li class="ccs-pre">${esc(t)}</li>`).join("")}</ul>` : "";
    const body = v.body.map((t) => `<p class="ccs-pre">${esc(t)}</p>`).join("");
    const reveal = v.reveal.map((t) => `<p class="ccs-pre"><span class="eyebrow">Reveal</span><br>${esc(t)}</p>`).join("");
    const cta = v.cta.map((t) => `<p class="ccs-pre"><span class="eyebrow">Call to action</span><br>${esc(t)}</p>`).join("");
    const middle = cues + body + reveal + cta;
    const long = LONG_FORMATS.includes(s.script_format);
    return hook + line2 + (long && middle
      ? `<details class="ccs-more" data-fold="rest:${esc(s.id)}"${restOpen}><summary>Read the rest</summary>${middle}</details>`
      : middle);
  }

  function animationsHtml(s, open) {
    const plan = Array.isArray(s.animation_plan) ? s.animation_plan : [];
    if (!plan.length) return "";
    const items = plan.map((a) => {
      const an = isObj(a.anchor) ? a.anchor : {};
      const where = an.phrase ? `on "${an.phrase}"` : (an.cue != null ? `on cue ${an.cue}${an.keyword ? `, "${an.keyword}"` : ""}` : "");
      const secs = Number.isFinite(Number(a.seconds)) ? `, ${a.seconds} seconds` : "";
      return `<li>${esc(a.template || "animation")} ${esc(where)}${esc(secs)}</li>`;
    }).join("");
    return `<details class="ccs-more" data-fold="anim:${esc(s.id)}"${open ? " open" : ""}><summary>Planned animations (${plan.length})</summary><ul class="ccs-list">${items}</ul></details>`;
  }

  function adTextHtml(s, open) {
    const m = isObj(s.meta_copy) ? s.meta_copy : null;
    if (!m) return "";
    const row = (label, v) => (v == null || v === "" ? "" : `<p><span class="eyebrow">${esc(label)}</span><br><span class="ccs-pre">${esc(v)}</span></p>`);
    const cta = m.cta_type ? String(m.cta_type).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null;
    return `<details class="ccs-more" data-fold="ad:${esc(s.id)}"${open ? " open" : ""}><summary>Ad text</summary>` +
      row("Main text", m.primary_text) + row("Headline", m.headline) + row("Description", m.description) + row("Button", cta) +
      `</details>`;
  }

  function versionsHtml(s, vstate, open) {
    let inner = "";
    if (!open) inner = "";
    else if (!vstate || vstate.status === "loading") inner = skeleton(2);
    else if (vstate.status === "error") inner = partErr(vstate.error, "versions-retry");
    else {
      inner = `<ol class="ccs-versions">${vstate.items.map((v) => {
        const checks = checkWords(v.check_results).map((c) =>
          `<li><b>${esc(c.name)}:</b> ${esc(c.state)}${c.lines.length ? `<ul class="ccs-list">${c.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}</li>`
        ).join("");
        const by = SOURCE_WORDS[v.source] || "saved";
        return `<li class="ccs-version"><p><b>Version ${esc(v.version)}</b> · ${esc(STATUS_WORDS[v.status] || v.status)} · ${esc(by)} · ${timeTag(v.created_at, vstate.now)}</p>` +
          (v.fix_note ? `<p class="caption">Fix note: ${esc(v.fix_note)}</p>` : "") +
          `<ul class="ccs-checks">${checks}</ul>` +
          `<details class="ccs-more" data-fold="vw:${esc(v.id)}"${vstate.open && vstate.open[`vw:${v.id}`] ? " open" : ""}><summary>Show the words</summary><p class="ccs-pre">${esc(v.body)}</p></details></li>`;
      }).join("")}</ol>`;
    }
    return `<details class="ccs-more" data-fold="ver:${esc(s.id)}" data-load="versions" data-id="${esc(s.id)}"${open ? " open" : ""}><summary>Every version and its checks</summary>${inner}</details>`;
  }

  function conflictHtml(cf) {
    const theirs = isObj(cf.current) ? cf.current : {};
    const isEdit = cf.kind === "edit";
    const buttons = isEdit
      ? btn("Use mine", "conflict-mine", { cls: "primary", busy: cf.busy, busyLabel: "Saving…" }) + btn("Use theirs", "conflict-theirs")
      : btn("Read the new version", "conflict-theirs", { cls: "primary" });
    return `<div class="ccs-conflict" role="alert">` +
      `<p><b>This script changed since you opened it.</b> Version ${esc(theirs.version ?? "unknown")} is saved now. Nothing of yours was saved yet.</p>` +
      `<div class="ccs-yt"><div class="ccs-yt-col"><p class="eyebrow">${isEdit ? "Yours" : "What you were reading"}</p><p class="ccs-pre">${esc(cf.mine)}</p></div>` +
      `<div class="ccs-yt-col"><p class="eyebrow">Saved now (version ${esc(theirs.version ?? "unknown")})</p><p class="ccs-pre">${esc(theirs.body ?? "")}</p></div></div>` +
      `<div class="ccs-row-btns">${buttons}</div></div>`;
  }

  function editPanelHtml(s, panel) {
    const parts = Array.isArray(s.parts) && s.parts.length ? s.parts : null;
    let boxes = "";
    if (parts) {
      let cue = 0;
      boxes = parts.map((p, i) => {
        const label = p.kind === "cue" ? `${PART_LABELS.cue} ${++cue}` : (PART_LABELS[p.kind] || p.kind);
        const rows = p.kind === "body" ? 6 : 2;
        return `<div class="ccs-field"><label for="ccs-edit-${i}">${esc(label)}</label>` +
          `<textarea id="ccs-edit-${i}" name="edit-${esc(s.id)}-${i}" data-keep rows="${rows}">${esc(p.text)}</textarea></div>`;
      }).join("");
    } else {
      boxes = `<div class="ccs-field"><label for="ccs-edit-body">The whole script</label>` +
        `<textarea id="ccs-edit-body" name="edit-${esc(s.id)}-body" data-keep rows="10">${esc(s.body)}</textarea></div>`;
    }
    return `<div class="ccs-panel" data-panel="edit"><p><b>Edit the words.</b> Your old version is kept. The checker may warn you. It never blocks your save.</p>` +
      boxes +
      `<div class="ccs-row-btns">${btn("Save new version", "edit-save", { cls: "primary", busy: panel.busy, busyLabel: "Saving…" })}${btn("Cancel", "panel-close")}</div></div>`;
  }

  function fixPanelHtml(s, panel) {
    return `<div class="ccs-panel" data-panel="fix">` +
      `<div class="ccs-field"><label for="ccs-fix-note">What should change?</label>` +
      `<textarea id="ccs-fix-note" name="fix-${esc(s.id)}" data-keep rows="4" placeholder="Say it in your words. The machine rewrites the script from it."></textarea>` +
      `<p class="caption">Tap the mic on your keyboard to talk instead of typing.</p></div>` +
      `<label class="ccs-check-row"><input type="checkbox" name="fix-rule-${esc(s.id)}" data-keep> Make this a rule for every script</label>` +
      `<p class="caption">One rewrite, about the cost of one script. Cost: unknown, not measured yet. The note goes to the machine exactly as you typed it.</p>` +
      `<div class="ccs-row-btns">${btn("Rewrite it", "fix-send", { cls: "primary", busy: panel.busy, busyLabel: "Sending…" })}${btn("Cancel", "panel-close")}</div></div>`;
  }

  function rejectPanelHtml(s, panel) {
    return `<div class="ccs-panel ccs-panel-reject" data-panel="reject">` +
      `<p><b>Reject this script?</b> It will not be filmed, and it leaves your drafts.</p>` +
      `<div class="ccs-field"><label for="ccs-reject-why">Why? (optional)</label>` +
      `<textarea id="ccs-reject-why" name="reject-${esc(s.id)}" data-keep rows="2" placeholder="Leave it empty if you like."></textarea></div>` +
      `<div class="ccs-row-btns">${btn("Reject it", "reject-send", { cls: "ccs-danger", busy: panel.busy, busyLabel: "Rejecting…" })}${btn("Keep it", "panel-close", { cls: "primary" })}</div></div>`;
  }

  /** One draft card: the words, the check line, the folds, then the buttons. */
  function cardHtml(st, s, index, total) {
    const funnels = st.funnels.items;
    const line = checkLine(s);
    const pending = st.pendingFix[s.root_script_id];
    const panel = st.panel && st.panel.id === s.id ? st.panel : null;
    const conflict = st.conflict && st.conflict.id === s.id ? st.conflict : null;
    const chips = (s.flagged ? chip("needs a look", "wip") : "") + (pending ? chip("rewriting", "") : "") +
      (s.needs_retake ? chip("film again", "") : "");
    const top = `<div class="ccs-card-top"><p class="caption">${esc(cardCaption(s, index, total, funnels))}</p>${chips ? `<div class="ccs-chips">${chips}</div>` : ""}</div>`;
    const flagTop = line.tone === "flag"
      ? `<div class="ccs-flag"><p>${esc(line.text)}</p>${line.more && line.more.length ? `<ul class="ccs-list">${line.more.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}</div>`
      : "";
    const title = s.title ? `<p class="eyebrow ccs-title">${esc(s.title)}</p>` : "";
    const checkP = line.tone !== "flag" ? `<p class="ccs-checkline ${esc(line.tone)}">${esc(line.text)}</p>` : "";
    const idea = s.idea_id && st.ideas.items.some((i) => i.id === s.idea_id) ? `<p class="caption">From one of your ideas.</p>` : "";
    const folds = animationsHtml(s, !!st.open[`anim:${s.id}`]) + adTextHtml(s, !!st.open[`ad:${s.id}`]) +
      versionsHtml(s, st.versions[s.id] && { ...st.versions[s.id], open: st.open }, !!st.open[`ver:${s.id}`]);

    let actions;
    if (conflict) actions = conflictHtml(conflict);
    else if (panel && panel.kind === "edit") actions = editPanelHtml(s, panel);
    else if (panel && panel.kind === "fix") actions = fixPanelHtml(s, panel);
    else if (panel && panel.kind === "reject") actions = rejectPanelHtml(s, panel);
    else if (pending) {
      const slow = Number.isFinite(pending.since) && st.now - pending.since > FIX_SLOW_MS;
      actions = `<div class="ccs-actions"><button type="button" class="btn primary ccs-approve" data-act="approve" disabled>Approve</button>` +
        `<p class="caption">${esc(slow
          ? "Still rewriting. If it does not come back, it shows on Today with a Retry button."
          : "Rewriting from your note. It comes back here when done. Approve waits for the new version.")}</p></div>`;
    } else {
      const busy = st.busy[`approve:${s.id}`];
      actions = `<div class="ccs-actions">` +
        btn("Approve", "approve", { cls: "primary ccs-approve", data: { id: s.id }, busy, busyLabel: "Approving…" }) +
        `<p class="caption">Free. It gets the next ad number and locks for filming.</p>` +
        `<div class="ccs-two">${btn("Edit", "edit", { data: { id: s.id } })}${btn("Fix", "fix", { data: { id: s.id } })}</div>` +
        `<div class="ccs-reject-gap">${btn("Reject", "reject", { cls: "ccs-reject", data: { id: s.id } })}</div></div>`;
    }

    return `<article class="card ccs-card" data-swipe="1" data-id="${esc(s.id)}" aria-label="${esc(cardCaption(s, index, total, funnels))}">` +
      top + flagTop + title + `<div class="ccs-words">${wordsHtml(s, st.open)}</div>` + checkP + idea +
      actions + sayHtml(st.say, `card:${s.id}`) + `<div class="ccs-folds">${folds}</div>` + `</article>`;
  }

  function inboxHtml(st) {
    const drafts = inboxOrder(st.scripts.items, st.pendingFix);
    const say = sayHtml(st.say, "inbox");
    if (!drafts.length) {
      const lines = [scheduleLine(st.settings.data), showWriteNow(st.batches) ? "Write now (at the top) makes some today." : null].filter(Boolean);
      return say + `<div class="card ccs-empty"><p><b>No scripts waiting for you.</b></p>${lines.map((l) => `<p class="caption">${esc(l)}</p>`).join("")}</div>`;
    }
    const i = Math.min(Math.max(st.index, 0), drafts.length - 1);
    const s = drafts[i];
    const left = drafts.length - 1 - i;
    const nav = drafts.length > 1
      ? `<nav class="ccs-nav" aria-label="Move between drafts">${btn("Previous", "prev", { disabled: i === 0 })}` +
        `<p class="caption">${esc(`${i + 1} of ${drafts.length} · ${left} left after this one`)}</p>${btn("Next", "next", { disabled: i >= drafts.length - 1 })}</nav>`
      : "";
    return say + cardHtml(st, s, i, drafts.length) + nav;
  }

  function filmListHtml(st) {
    const list = filmOrder(st.scripts.items);
    const say = sayHtml(st.say, "film");
    if (!list.length) return say + `<div class="card ccs-empty"><p><b>No approved scripts to film.</b></p><p class="caption">Approve a draft and it shows here with its ad number.</p></div>`;
    const busy = st.busy.order;
    const rows = list.map((s, i) => {
      const where = s.film_order == null ? "No film order saved yet" : `Film order ${s.film_order}`;
      const cap = [funnelName(s.funnel_key, st.funnels.items), formatWord(s.script_format), s.filmed_at ? "filmed" : "not filmed yet", where].join(" · ");
      const ad = s.ad_id ? `Ad ${s.ad_id}` : "Ad number unknown";
      const first = i === 0
        ? `<p class="caption ccs-first">Films first</p>`
        : btn("Film first", "order-first", { data: { root: s.root_script_id }, disabled: busy, aria: `Film ${ad} first` });
      return `<li class="card ccs-row" data-root="${esc(s.root_script_id)}"><div class="ccs-row-main"><p><b>${esc(ad)}</b> · ${esc(s.title || "untitled")}</p>` +
        `<p class="caption">${esc(cap)}</p>${s.needs_retake ? `<p class="caption">Needs a new take.</p>` : ""}</div>` +
        `<div class="ccs-order">` +
        btn("Up", "order-up", { data: { root: s.root_script_id }, disabled: busy || i === 0, aria: `Film ${ad} earlier` }) +
        btn("Down", "order-down", { data: { root: s.root_script_id }, disabled: busy || i === list.length - 1, aria: `Film ${ad} later` }) +
        first + `</div></li>`;
    }).join("");
    return say + `<p class="caption ccs-hint">The film order is the order you read them on shoot day. First is 1.</p><ol class="ccs-rows">${rows}</ol>`;
  }

  function plainListHtml(st, filter) {
    const items = (st.scripts.items || []).filter((s) => filter === "all" || s.status === filter);
    if (!items.length) return `<div class="card ccs-empty"><p><b>Nothing here yet.</b></p></div>`;
    const rows = items.map((s) => {
      const ad = s.ad_id ? `Ad ${s.ad_id}` : "No ad number";
      const tone = s.status === "locked" || s.status === "filmed" ? "on" : (s.status === "rejected" || s.status === "expired" ? "bad" : "");
      const cap = [funnelName(s.funnel_key, st.funnels.items), formatWord(s.script_format), `version ${s.version}`].join(" · ");
      const why = s.status === "rejected" && s.rejected_reason ? `<p class="caption">Why: ${esc(s.rejected_reason)}</p>` : "";
      const key = `row:${s.id}`;
      const open = !!st.open[key];
      return `<li><details class="card ccs-rowfold" data-fold="${esc(key)}"${open ? " open" : ""}><summary><b>${esc(ad)}</b> · ${esc(s.title || "untitled")} ${chip(STATUS_WORDS[s.status] || s.status, tone)}<span class="caption ccs-sumcap">${esc(cap)}</span></summary>` +
        (open ? `${why}<div class="ccs-words">${wordsHtml(s, st.open)}</div>${versionsHtml(s, st.versions[s.id] && { ...st.versions[s.id], open: st.open }, !!st.open[`ver:${s.id}`])}` : "") +
        `</details></li>`;
    }).join("");
    return `<ul class="ccs-rows">${rows}</ul>`;
  }

  function mainHtml(st) {
    if (st.scripts.status === "loading" && !st.scripts.loaded) {
      return `<div class="card ccs-card">${skeleton(5)}</div>`;
    }
    if (st.scripts.status === "error" && !st.scripts.loaded) {
      return partErr(`The scripts did not load. ${st.scripts.error} The rest of this tab is current.`, "scripts-retry");
    }
    const stale = st.scripts.status === "error"
      ? `<p class="caption ccs-stale">${esc(`The newest scripts did not load: ${st.scripts.error} This list is from ${azTime(st.scripts.as_of)}.`)}</p>` : "";
    if (st.filter === "draft") return stale + inboxHtml(st);
    if (st.filter === "locked") return stale + filmListHtml(st);
    return stale + plainListHtml(st, st.filter);
  }

  function headHtml(st) {
    const counts = countsByFilter(st.scripts.items);
    const drafts = inboxOrder(st.scripts.items, st.pendingFix);
    const flagged = drafts.filter((s) => s.flagged).length;
    const rewriting = drafts.filter((s) => st.pendingFix[s.root_script_id]).length;
    const sub = [];
    if (st.filter === "draft" && drafts.length) {
      if (flagged) sub.push(`${flagged} ${flagged === 1 ? "needs" : "need"} a look.`);
      if (rewriting) sub.push(`${rewriting} being rewritten.`);
    }
    const batchLine = st.batches.status === "ok" ? latestBatchLine(st.batches.items) : null;
    if (st.scripts.loaded) sub.push(`As of ${azTime(st.scripts.as_of)} Arizona time.`);
    const loading = st.scripts.status === "loading" && !st.scripts.loaded;

    let writeNow = "";
    if (showWriteNow(st.batches)) {
      writeNow = `<div class="ccs-writenow">${btn("Write now", "write-now", { busy: st.busy.writeNow, busyLabel: "Starting…" })}` +
        `<p class="caption">${esc(writeNowNote(st.settings.data))}</p>${sayHtml(st.say, "writenow")}</div>`;
    }
    const batchErr = st.batches.status === "error"
      ? `<p class="caption">${esc(`Batch history did not load: ${st.batches.error}`)}</p>` : "";

    const filters = `<div class="ccs-filters" role="group" aria-label="Show">${FILTERS.map((f) => {
      const on = st.filter === f.key;
      const n = st.scripts.loaded ? ` ${counts[f.key]}` : "";
      return `<button type="button" class="ccs-filter${on ? " on" : ""}" data-act="filter" data-filter="${f.key}" aria-pressed="${on}">${esc(f.label)}${esc(n)}</button>`;
    }).join("")}</div>`;

    return `<div class="card ccs-head"><div class="ccs-head-main">` +
      `<p class="eyebrow">Scripts</p>` +
      (loading ? skeleton(2) : `<h2>${esc(headline(counts, st.filter))}</h2>`) +
      (sub.length ? `<p class="caption">${esc(sub.join(" "))}</p>` : "") +
      (batchLine ? `<p class="caption">${esc(batchLine)}</p>` : "") + batchErr +
      `</div>${writeNow}</div>` + filters;
  }

  function ideasHtml(st) {
    const open = !!st.open.ideas;
    const ready = showWriteNow(st.batches);
    const ideas = (st.ideas.items || []).filter((i) => i && (i.kind == null || i.kind === "script"));
    const waiting = ideas.filter((i) => i.status === "new").length;
    let body = "";
    if (open) {
      const funnels = (st.funnels.items || []).filter((f) => f && f.active !== false);
      const fOpts = funnels.map((f) => `<option value="${esc(f.key)}">${esc(f.name || f.key)}</option>`).join("");
      const formatOpts = FORMATS.map((f) => `<option value="${f}">${esc(FORMAT_WORDS[f])}</option>`).join("");
      const funnelNote = st.funnels.status === "error" ? `<p class="caption">${esc(`The funnel list did not load: ${st.funnels.error} You can still save the idea.`)}</p>` : "";
      const shown = st.showAllIdeas ? ideas : ideas.slice(0, IDEAS_SHOWN);
      let list;
      if (st.ideas.status === "loading" && !st.ideas.loaded) list = skeleton(3);
      else if (st.ideas.status === "error" && !st.ideas.loaded) list = partErr(`Your ideas did not load. ${st.ideas.error}`, "ideas-retry");
      else if (!ideas.length) list = `<p class="caption">No ideas yet. Type or say one above. It goes in the next batch.</p>`;
      else {
        list = `<ul class="ccs-ideas">${shown.map((i) => {
          const tone = i.status === "written" ? "on" : (i.status === "failed" || i.status === "dropped" ? "bad" : (i.status === "writing" ? "wip" : ""));
          const text = String(i.raw_points || i.topic || "");
          const short = text.length > 220 ? text.slice(0, 220).replace(/\s+\S*$/, "") + "…" : text;
          const cap = [i.script_format ? formatWord(i.script_format) : null, i.funnel_key ? funnelName(i.funnel_key, st.funnels.items) : null, i.source === "suggestion" ? "a suggestion you accepted" : null].filter(Boolean).join(" · ");
          const open2 = i.script_id && (st.scripts.items || []).some((s) => s.id === i.script_id)
            ? btn("Open the script", "open-script", { data: { id: i.script_id } }) : "";
          return `<li class="ccs-idea"><div class="ccs-idea-top">${chip(ideaStatusWord(i.status), tone)}<span class="caption">${timeTag(i.created_at, st.now)}</span></div>` +
            `<p class="ccs-pre">${esc(short)}</p>${cap ? `<p class="caption">${esc(cap)}</p>` : ""}${open2}</li>`;
        }).join("")}</ul>` + (ideas.length > IDEAS_SHOWN
          ? btn(st.showAllIdeas ? "Show fewer" : `Show all ${ideas.length}`, "ideas-more") : "");
      }
      body = `<div class="ccs-fold-body">` +
        `<div class="ccs-field"><label for="ccs-idea-text">Your idea</label>` +
        `<textarea id="ccs-idea-text" name="idea-text" data-keep rows="5" placeholder="A few points is enough. Say it or type it."></textarea>` +
        `<p class="caption">Tap the mic on your keyboard to talk instead of typing.</p></div>` +
        `<div class="ccs-two-fields"><div class="ccs-field"><label for="ccs-idea-format">Format (optional)</label>` +
        `<select id="ccs-idea-format" name="idea-format" data-keep><option value="">Any format</option>${formatOpts}</select></div>` +
        `<div class="ccs-field"><label for="ccs-idea-funnel">Funnel (optional)</label>` +
        `<select id="ccs-idea-funnel" name="idea-funnel" data-keep><option value="">Any funnel</option>${fOpts}</select></div></div>` +
        funnelNote +
        `<div class="ccs-row-btns">${btn("Save idea", "idea-save", { busy: st.busy.ideaSave, busyLabel: "Saving…" })}` +
        (ready ? btn("Write it now", "idea-write", { busy: st.busy.ideaWrite, busyLabel: "Starting…" }) : "") + `</div>` +
        `<p class="caption">Save idea is free. It goes in the next batch.</p>` +
        (ready ? `<p class="caption">${esc(`Write it now writes one script from it today with the model. Cost and time: unknown, not measured yet. ${capWords(st.settings.data)}`)}</p>` : "") +
        sayHtml(st.say, "ideas") +
        `<p class="eyebrow ccs-sub">Your ideas</p>${list}</div>`;
    }
    return `<details class="card ccs-fold" data-fold="ideas"${open ? " open" : ""}><summary><h2 class="ccs-inline">Ideas</h2>` +
      `<span class="caption ccs-sumcap">${esc(st.ideas.loaded ? (waiting ? `${plural(waiting, "idea")} for the next batch` : "Drop an idea for the next batch") : "Drop an idea for the next batch")}</span></summary>${body}</details>`;
  }

  function rulesHtml(st) {
    const open = !!st.open.rules;
    let body = "";
    if (open) {
      const r = st.rules;
      if (r.status === "loading" && !r.loaded) body = skeleton(4);
      else if (r.status === "error" && !r.loaded) body = partErr(`The rules did not load. ${r.error}`, "rules-retry");
      else {
        const d = r.data || {};
        const part0 = Array.isArray(d.part0) ? d.part0 : [];
        const editing = st.ruleEdit;
        const list = part0.length ? `<ol class="ccs-rules">${part0.map((x) => {
          const isEd = editing != null && Number(editing) === Number(x.n);
          const inner = isEd
            ? `<div class="ccs-field"><label for="ccs-rule-${esc(x.n)}">${esc(`Rule ${x.n}`)}</label><textarea id="ccs-rule-${esc(x.n)}" name="rule-edit-${esc(x.n)}" data-keep rows="3">${esc(x.text)}</textarea></div>` +
              `<div class="ccs-row-btns">${btn("Save the rule", "rule-edit-save", { data: { n: x.n }, busy: st.busy.rule === "edit", disabled: !!st.busy.rule, busyLabel: "Saving…" })}${btn("Cancel", "rule-edit-cancel")}</div>`
            : `<p class="ccs-pre">${esc(x.text)}</p>${btn("Change", "rule-edit", { data: { n: x.n }, aria: `Change rule ${x.n}` })}`;
          return `<li class="ccs-rule"><span class="ccs-n" aria-hidden="true">${esc(x.n)}</span><div class="ccs-rule-body">${inner}</div></li>`;
        }).join("")}</ol>` : `<p class="caption">Part 0 has no rules yet. Add the first one below.</p>`;
        const banned = Array.isArray(d.banned) ? d.banned : [];
        const recent = Array.isArray(d.recent) ? d.recent : [];
        const src = d.source === "bundle"
          ? `<p class="caption">Read from the copy built into the site. It can be a little older than the repo.</p>` : "";
        const stale = r.status === "error" ? `<p class="caption">${esc(`The newest rules did not load: ${r.error}`)}</p>` : "";
        body = `<div class="ccs-fold-body">${stale}${src}` +
          `<p class="eyebrow ccs-sub">Part 0: every script follows these</p>${list}` +
          `<div class="ccs-field"><label for="ccs-rule-add">Add a rule</label><textarea id="ccs-rule-add" name="rule-add" data-keep rows="2" placeholder="One rule, in your words."></textarea></div>` +
          `<div class="ccs-row-btns">${btn("Add the rule", "rule-add", { busy: st.busy.rule === "add", disabled: !!st.busy.rule, busyLabel: "Saving…" })}</div>` +
          `<div class="ccs-field"><label for="ccs-rule-ban">Ban a phrase</label><input id="ccs-rule-ban" name="rule-ban" data-keep type="text" autocomplete="off" placeholder="A phrase no script may say"></div>` +
          `<div class="ccs-row-btns">${btn("Ban the phrase", "rule-ban", { busy: st.busy.rule === "ban", disabled: !!st.busy.rule, busyLabel: "Saving…" })}</div>` +
          `<p class="caption">Free. A change reaches the repo in a minute or two. The next batch follows it.</p>` +
          sayHtml(st.say, "rules") +
          `<p class="eyebrow ccs-sub">${esc(`Banned phrases (${banned.length})`)}</p>` +
          (banned.length ? `<ul class="ccs-banned">${banned.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<p class="caption">None yet.</p>`) +
          `<p class="eyebrow ccs-sub">Recent changes</p>` +
          (recent.length ? `<ul class="ccs-recent">${recent.map((x) => {
            const w = ruleStateWords(x);
            return `<li><div class="ccs-idea-top"><b>${esc(ruleActionWords(x))}</b>${chip(w.word, w.tone)}</div>` +
              `<p class="ccs-pre">${esc(x.text)}</p><p class="caption">${timeTag(x.at, st.now)}${w.detail ? ` · ${esc(w.detail)}` : ""}</p></li>`;
          }).join("")}</ul>` : `<p class="caption">No changes yet.</p>`) +
          `</div>`;
      }
    }
    return `<details class="card ccs-fold" data-fold="rules" data-load="rules"${open ? " open" : ""}><summary><h2 class="ccs-inline">Rules</h2>` +
      `<span class="caption ccs-sumcap">What every script follows. Add a rule or ban a phrase.</span></summary>${body}</details>`;
  }

  function batchesHtml(st) {
    const open = !!st.open.batches;
    let body = "";
    if (open) {
      const b = st.batches;
      if (b.status === "loading" && !b.loaded) body = skeleton(3);
      else if (b.status === "error" && !b.loaded) body = partErr(`Batch history did not load. ${b.error}`, "batches-retry");
      else if (!b.items.length) body = `<p class="caption">No batches yet. The first weekly drop or a Write now shows here.</p>`;
      else {
        body = `<ul class="ccs-batches">${b.items.map((x) => {
          const c = isObj(x.counts) ? x.counts : {};
          const kind = x.kind === "on_command" ? "Write now" : "Weekly drop";
          const tone = x.status === "released" ? "on" : (x.status === "failed" ? "bad" : "wip");
          const counts = `${c.ready ?? 0} of ${c.total ?? "unknown"} ready · ${c.flagged ?? 0} need a look · ${c.failed ?? 0} failed`;
          const out = x.released_at ? `Out ${azTime(x.released_at)}` : (x.release_at ? `Goes out ${azTime(x.release_at)}` : null);
          return `<li><div class="ccs-idea-top"><b>${esc(`${azDay(x.release_at || x.released_at)} · ${kind}`)}</b>${chip(batchStatusWord(x.status), tone)}</div>` +
            `<p class="caption">${esc(counts)}</p>${out ? `<p class="caption">${esc(out)} Arizona time</p>` : ""}` +
            (x.status === "failed" && x.error ? `<p class="caption">${esc(`Why it stopped: ${x.error}`)}</p>` : "") + `</li>`;
        }).join("")}</ul>`;
      }
    }
    return `<details class="card ccs-fold" data-fold="batches"${open ? " open" : ""}><summary><h2 class="ccs-inline">Batch history</h2>` +
      `<span class="caption ccs-sumcap">Every weekly drop and Write now</span></summary>${open ? `<div class="ccs-fold-body">${body}</div>` : ""}</details>`;
  }

  /* ── styles (injected once; no px font sizes, 8px spacing scale) ──────── */

  const CSS = `
.ccs{display:flex;flex-direction:column;gap:16px;min-width:0}
.ccs [hidden]{display:none!important}
.ccs .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0}
@media (min-width:720px){.ccs .card{padding:24px}}
.ccs p{overflow-wrap:anywhere}
.ccs .ccs-pre{white-space:pre-wrap;overflow-wrap:anywhere}
.ccs h2{font-weight:600;letter-spacing:-.01em;line-height:1.3}
.ccs .caption{color:var(--gray)}
.ccs .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--ink2);border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer;background:#fff;color:var(--ink2);min-height:44px;font-family:inherit;line-height:1.2;text-align:center}
.ccs .btn:hover{border-color:var(--ink)}
.ccs .btn.primary{background:var(--ink2);color:var(--paper)}
.ccs .btn.primary:hover{opacity:.92}
.ccs .btn[disabled]{opacity:.45;cursor:not-allowed}
.ccs .btn .ccs-spin{display:none;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ccsspin .8s linear infinite}
.ccs .btn.busy .ccs-spin{display:inline-block}
@keyframes ccsspin{to{transform:rotate(360deg)}}
/* Reject: a plain outline that names the risk in its word, not only its colour (UI-STANDARDS §12.6).
   Literal dark red so it reads the same on every tenant ramp. */
.ccs .btn.ccs-reject,.ccs .btn.ccs-danger{border-color:#6E2A22;color:#6E2A22;background:#fff}
.ccs .ccs-head{display:flex;flex-direction:column;gap:16px}
@media (min-width:960px){.ccs .ccs-head{flex-direction:row;justify-content:space-between;align-items:flex-start}}
.ccs .ccs-head-main{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1 1 auto}
.ccs .ccs-writenow{display:flex;flex-direction:column;gap:8px;min-width:0}
@media (min-width:960px){.ccs .ccs-writenow{flex:0 1 360px}}
.ccs .ccs-filters{display:flex;flex-wrap:wrap;gap:8px}
.ccs .ccs-filter{min-height:44px;padding:8px 16px;border:1px solid var(--line);border-radius:22px;background:#fff;color:var(--ink2);font-weight:600;cursor:pointer;font-family:inherit}
.ccs .ccs-filter.on{background:var(--ink2);border-color:var(--ink2);color:var(--paper)}
.ccs .ccs-card{display:flex;flex-direction:column;gap:16px;touch-action:pan-y}
.ccs .ccs-card-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.ccs .ccs-chips{display:flex;flex-wrap:wrap;gap:8px}
.ccs .ccs-words{display:flex;flex-direction:column;gap:16px;max-width:78ch}
.ccs .ccs-hook b{font-weight:600}
.ccs .ccs-cues{display:flex;flex-direction:column;gap:8px;padding-left:24px}
.ccs .ccs-list{display:flex;flex-direction:column;gap:8px;padding-left:24px;margin-top:8px}
/* "Needs a look" is literal amber, as pipeline.html's .c-needs-amount, so it stays amber on a
   one-hue tenant ramp (UI-STANDARDS §12.6). It also says "Needs a look" in words. */
.ccs .ccs-flag{border:1px solid #FCD34D;background:#FEF3C7;color:#92400E;border-radius:8px;padding:8px 16px}
.ccs .ccs-checkline.ok{color:#2C5138}
.ccs .ccs-checkline.warn{color:#92400E}
.ccs .ccs-checkline.none{color:var(--gray)}
.ccs .ccs-folds{display:flex;flex-direction:column;gap:8px;max-width:78ch}
.ccs details.ccs-more{border-top:1px solid var(--line);padding-top:8px}
.ccs details>summary{cursor:pointer;min-height:44px;padding:8px 0;font-weight:600}
.ccs .ccs-inline{display:inline}
.ccs .ccs-sumcap{display:block;font-weight:400;margin-top:4px}
.ccs details.ccs-rowfold .chip{margin-left:8px;vertical-align:middle}
.ccs .ccs-fold-body{display:flex;flex-direction:column;gap:16px;margin-top:16px}
.ccs .ccs-actions{display:flex;flex-direction:column;gap:8px;max-width:560px}
.ccs .ccs-approve{min-height:56px;width:100%}
.ccs .ccs-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ccs .ccs-two .btn{width:100%}
.ccs .ccs-reject-gap{margin-top:32px}
.ccs .ccs-reject-gap .btn{width:100%}
.ccs .ccs-panel{display:flex;flex-direction:column;gap:16px;border-top:1px solid var(--line);padding-top:16px;max-width:78ch}
.ccs .ccs-panel-reject{border-top-color:#6E2A22}
.ccs .ccs-row-btns{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.ccs .ccs-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.ccs .ccs-field label{font-weight:600;color:var(--ink2)}
.ccs textarea,.ccs select,.ccs input[type=text]{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 16px;background:#fff;min-height:44px;font-family:inherit;color:inherit;line-height:1.5}
.ccs textarea{resize:vertical}
.ccs .ccs-check-row{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.ccs .ccs-check-row input{width:24px;height:24px;flex:0 0 auto}
.ccs .ccs-two-fields{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:720px){.ccs .ccs-two-fields{grid-template-columns:1fr 1fr}}
.ccs .ccs-nav{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ccs .ccs-nav .caption{text-align:center}
.ccs .ccs-say{display:none}
.ccs .ccs-say.show{display:block;padding:8px 16px;border-radius:8px;border:1px solid var(--line)}
.ccs .ccs-say.ok{background:color-mix(in srgb,var(--ok) 28%,#fff);color:#2C5138}
.ccs .ccs-say.err{background:color-mix(in srgb,var(--alert) 28%,#fff);color:#6E2A22}
.ccs .ccs-say.wait{background:color-mix(in srgb,var(--warn) 28%,#fff);color:#6B4A12}
.ccs .ccs-say-more{padding-left:24px;margin-top:8px;display:flex;flex-direction:column;gap:8px}
.ccs .ccs-err{display:flex;flex-direction:column;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:16px;background:color-mix(in srgb,var(--alert) 22%,#fff);color:#6E2A22}
.ccs .ccs-conflict{display:flex;flex-direction:column;gap:16px;border:1px solid #FCD34D;background:#FEF3C7;color:#4A3410;border-radius:8px;padding:16px}
.ccs .ccs-yt{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:720px){.ccs .ccs-yt{grid-template-columns:1fr 1fr}}
.ccs .ccs-yt-col{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 16px;min-width:0}
.ccs .ccs-rows{list-style:none;display:flex;flex-direction:column;gap:8px}
.ccs .ccs-row{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}
.ccs .ccs-row-main{flex:1 1 240px;min-width:0}
.ccs .ccs-order{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ccs .ccs-first{min-height:44px;display:flex;align-items:center}
.ccs .ccs-versions{list-style:none;display:flex;flex-direction:column;gap:16px;margin-top:8px}
.ccs .ccs-version{border-left:2px solid var(--line);padding-left:16px;display:flex;flex-direction:column;gap:8px}
.ccs .ccs-checks{list-style:none;display:flex;flex-direction:column;gap:8px}
.ccs .ccs-ideas,.ccs .ccs-recent,.ccs .ccs-batches{list-style:none;display:flex;flex-direction:column}
.ccs .ccs-ideas>li,.ccs .ccs-recent>li,.ccs .ccs-batches>li{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-top:1px solid var(--line)}
.ccs .ccs-ideas>li:first-child,.ccs .ccs-recent>li:first-child,.ccs .ccs-batches>li:first-child{border-top-color:transparent;padding-top:0}
.ccs .ccs-idea .btn{align-self:flex-start}
.ccs .ccs-idea-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.ccs .ccs-rules{list-style:none;display:flex;flex-direction:column;gap:16px}
.ccs .ccs-rule{display:flex;gap:16px;align-items:flex-start}
.ccs .ccs-n{flex:0 0 32px;font-family:var(--mono);color:var(--gray);text-align:right;padding-top:2px}
.ccs .ccs-rule-body{display:flex;flex-direction:column;gap:8px;align-items:flex-start;min-width:0;flex:1}
.ccs .ccs-banned{list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.ccs .ccs-banned li{border:1px solid var(--line);border-radius:16px;padding:4px 16px;background:var(--soft)}
.ccs .ccs-sub{margin-top:8px}
.ccs .ccs-empty{display:flex;flex-direction:column;gap:8px}
.ccs .ccs-skels{display:flex;flex-direction:column;gap:8px}
.ccs .ccs-skel{display:block;height:16px;border-radius:8px;background:var(--soft);animation:ccspulse 1.2s ease-in-out infinite;width:70%}
.ccs .ccs-skel.wide{width:100%;height:24px}
@keyframes ccspulse{0%,100%{opacity:.45}50%{opacity:1}}
`;

  function injectStyle(doc) {
    if (!doc || doc.getElementById("ccs-style")) return;
    const el = doc.createElement("style");
    el.id = "ccs-style";
    el.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(el);
  }

  /* ── the live tab (DOM, ctx.api, timers) ──────────────────────────────── */

  function freshState() {
    return {
      ctx: null, root: null, shown: false, now: Date.now(),
      filter: "draft", index: 0,
      scripts: { status: "loading", loaded: false, items: [], as_of: null, error: null },
      batches: { status: "loading", loaded: false, items: [], write_now_ready: false, error: null },
      settings: { status: "loading", data: null, error: null },
      funnels: { status: "loading", items: [], error: null },
      ideas: { status: "loading", loaded: false, items: [], error: null },
      rules: { status: "idle", loaded: false, data: null, error: null },
      versions: {}, open: {}, busy: {}, intents: {},
      panel: null, conflict: null, say: null, ruleEdit: null, showAllIdeas: false,
      pendingFix: {}, writeWatch: null, timer: null, last: {}, swipe: null
    };
  }

  let st = freshState();

  /** ctx.api's answer, made safe: never throws, always {ok, status, data, conflict, current}. */
  async function call(method, path, body, opts) {
    const ctx = st.ctx;
    if (!ctx || typeof ctx.api !== "function") return { ok: false, status: 0, data: null, conflict: false, current: null };
    try {
      const r = (await ctx.api(method, path, body, opts || {})) || {};
      const status = Number(r.status) || 0;
      const data = r.data !== undefined ? r.data : null;
      const conflict = r.conflict === true || status === 409;
      const current = r.current || (isObj(data) ? data.current : null) || null;
      return { ok: r.ok === true && status < 400, status, data, conflict, current };
    } catch (_) {
      return { ok: false, status: 0, data: null, conflict: false, current: null };
    }
  }

  /** One request_id per tap, kept until it succeeds so a retry is not a second save. */
  function intent(key) {
    if (!st.intents[key]) st.intents[key] = newRequestId();
    return st.intents[key];
  }
  function intentDone(key) { delete st.intents[key]; }

  function say(scope, tone, text, more) {
    st.say = { scope, tone, text, more: more || [] };
  }

  /* Run a paid tap through the frame's cost sheet (it reads GET marketing/costs).
     The cost line is already printed under the button, so with no sheet the tap runs. */
  function withCostSheet(kind, title, run) {
    const ctx = st.ctx;
    if (!ctx || typeof ctx.costSheet !== "function") { run(); return; }
    let done = false;
    const go = () => { if (done) return; done = true; run(); };
    try {
      const r = ctx.costSheet({ kind, title, onConfirm: go });
      if (r && typeof r.then === "function") r.then((yes) => { if (yes === true) go(); }, () => {});
    } catch (_) { run(); }
  }

  /* ── loading ── */

  async function loadScripts() {
    st.scripts.status = "loading";
    paint();
    const r = await call("GET", "marketing/scripts");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.scripts)) {
      st.scripts = { status: "ok", loaded: true, items: r.data.scripts, as_of: r.data.as_of || new Date().toISOString(), error: null };
      settleFixes();
    } else {
      st.scripts.status = "error";
      st.scripts.error = plainError(r);
    }
    paint();
  }

  async function loadBatches() {
    const r = await call("GET", "marketing/batches");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.batches)) {
      st.batches = { status: "ok", loaded: true, items: r.data.batches, write_now_ready: r.data.write_now_ready === true, error: null };
    } else {
      st.batches.status = "error";
      st.batches.error = plainError(r);
      st.batches.write_now_ready = st.batches.loaded ? st.batches.write_now_ready : false;
    }
    paint();
  }

  async function loadSettings() {
    const r = await call("GET", "marketing/settings");
    if (r.ok && isObj(r.data) && isObj(r.data.settings)) st.settings = { status: "ok", data: r.data.settings, error: null };
    else st.settings = { status: "error", data: st.settings.data, error: plainError(r) };
    paint();
  }

  async function loadFunnels() {
    const r = await call("GET", "marketing/funnels");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.funnels)) st.funnels = { status: "ok", items: r.data.funnels, error: null };
    else st.funnels = { status: "error", items: st.funnels.items, error: plainError(r) };
    paint();
  }

  async function loadIdeas() {
    const r = await call("GET", "marketing/ideas");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.ideas)) st.ideas = { status: "ok", loaded: true, items: r.data.ideas, error: null };
    else { st.ideas.status = "error"; st.ideas.error = plainError(r); }
    paint();
  }

  async function loadRules() {
    st.rules.status = "loading";
    paint();
    const r = await call("GET", "marketing/rules");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.part0)) st.rules = { status: "ok", loaded: true, data: r.data, error: null };
    else { st.rules.status = "error"; st.rules.error = plainError(r); }
    paint();
  }

  async function loadVersions(id) {
    st.versions[id] = { status: "loading", items: [], error: null };
    paint();
    const r = await call("GET", "marketing/script?id=" + encodeURIComponent(id));
    if (r.ok && isObj(r.data) && Array.isArray(r.data.versions)) st.versions[id] = { status: "ok", items: r.data.versions, error: null, now: Date.now() };
    else st.versions[id] = { status: "error", items: [], error: plainError(r) };
    paint();
  }

  function loadAll() {
    return Promise.all([loadScripts(), loadBatches(), loadSettings(), loadFunnels(), loadIdeas(),
      st.open.rules ? loadRules() : Promise.resolve()]);
  }

  /* A Fix is done when a newer version of the same script shows up. */
  function settleFixes() {
    for (const [root, p] of Object.entries(st.pendingFix)) {
      const live = st.scripts.items.find((s) => s.root_script_id === root);
      if (live && Number(live.version) > Number(p.version)) {
        delete st.pendingFix[root];
        const name = live.title ? `"${live.title}"` : "Your script";
        say("inbox", "ok", `${name} was rewritten from your note. Version ${live.version} is in your drafts.`);
      } else if (live && live.status !== "draft") {
        delete st.pendingFix[root];
      }
    }
  }

  /* ── polling: every 5 seconds, only while this tab is on screen and the page is visible ── */

  /* A batch that is writing right now. A weekly batch planned for next Monday
     is not: polling for it would ask every 5 seconds for days. */
  function batchWriting() {
    return st.batches.items.some((b) => b && (b.status === "writing" || (b.status === "planned" && b.kind === "on_command")));
  }

  function needsPoll() {
    if (Object.keys(st.pendingFix).length) return true;
    if (st.writeWatch && st.now - st.writeWatch.since < WRITE_WATCH_MS) return true;
    if (batchWriting()) return true;
    if (st.open.rules && st.rules.data && Array.isArray(st.rules.data.recent) && st.rules.data.recent.some((x) => x.state === "waiting")) return true;
    if (st.ideas.items.some((i) => i && i.status === "writing")) return true;
    return false;
  }

  /* On screen: the page is not in the background and this tab's root is drawn. */
  function pageVisible() {
    const d = W.document;
    if (d && d.visibilityState === "hidden") return false;
    const r = st.root;
    if (r && typeof r.getClientRects === "function" && (r.isConnected === false || r.getClientRects().length === 0)) return false;
    return true;
  }

  async function tick() {
    st.now = Date.now();
    if (st.writeWatch && st.now - st.writeWatch.since >= WRITE_WATCH_MS) st.writeWatch = null;
    if (!st.shown || !pageVisible() || !needsPoll()) return;
    const jobs = [];
    const writing = !!st.writeWatch || batchWriting();
    if (Object.keys(st.pendingFix).length || writing) jobs.push(loadScripts());
    if (writing) jobs.push(loadBatches());
    if (st.open.rules && st.rules.data && (st.rules.data.recent || []).some((x) => x.state === "waiting")) jobs.push(loadRules());
    if (writing || st.ideas.items.some((i) => i && i.status === "writing")) jobs.push(loadIdeas());
    await Promise.all(jobs);
    if (st.writeWatch) {
      const b = st.batches.items.find((x) => x.id === st.writeWatch.batch_id);
      if (b && (b.status === "released" || b.status === "failed")) st.writeWatch = null;
    }
    paint();
  }

  function startTimer() {
    stopTimer();
    if (typeof W.setInterval !== "function") return;
    st.timer = W.setInterval(() => { tick(); }, POLL_MS);
  }
  function stopTimer() {
    if (st.timer != null && typeof W.clearInterval === "function") W.clearInterval(st.timer);
    st.timer = null;
  }

  /* ── painting: each section repaints only when its HTML changed, and typed
        words, ticks and focus survive the repaint ── */

  function keepInputs(el, write) {
    const doc = W.document;
    const kept = {};
    let focus = null;
    for (const f of el.querySelectorAll("[data-keep]")) {
      const name = f.getAttribute("name");
      if (!name) continue;
      kept[name] = { value: f.value, checked: f.checked };
      if (doc && doc.activeElement === f) {
        focus = { name, start: f.selectionStart, end: f.selectionEnd };
      }
    }
    write();
    for (const f of el.querySelectorAll("[data-keep]")) {
      const k = kept[f.getAttribute("name")];
      if (!k) continue;
      if (f.type === "checkbox") f.checked = k.checked;
      else f.value = k.value;
    }
    if (focus) {
      const f = el.querySelector(`[name="${focus.name}"]`);
      if (f) {
        f.focus();
        try { if (focus.start != null) f.setSelectionRange(focus.start, focus.end); } catch (_) { /* select boxes */ }
      }
    }
  }

  function paint() {
    if (!st.root || !st.root.querySelector) return;
    st.now = Date.now();
    const parts = { head: headHtml(st), main: mainHtml(st), ideas: ideasHtml(st), rules: rulesHtml(st), batches: batchesHtml(st) };
    for (const [k, html] of Object.entries(parts)) {
      if (st.last[k] === html) continue;
      const el = st.root.querySelector(`[data-sec="${k}"]`);
      if (!el) continue;
      keepInputs(el, () => { el.innerHTML = html; });
      st.last[k] = html;
    }
  }

  /* ── finding things ── */

  function byId(id) { return st.scripts.items.find((s) => s.id === id) || null; }

  function currentDraft() {
    const drafts = inboxOrder(st.scripts.items, st.pendingFix);
    if (!drafts.length) return null;
    const i = Math.min(Math.max(st.index, 0), drafts.length - 1);
    return drafts[i];
  }

  /* The list holds live versions only, so a save replaces the version it edited. */
  function replaceScript(oldId, next) {
    let i = st.scripts.items.findIndex((s) => s.id === oldId);
    if (i < 0) i = st.scripts.items.findIndex((s) => s.root_script_id === next.root_script_id);
    if (i >= 0) st.scripts.items.splice(i, 1, next);
    else st.scripts.items.unshift(next);
  }

  function fieldValue(name) {
    const el = st.root && st.root.querySelector(`[name="${name}"]`);
    if (!el) return null;
    return el.type === "checkbox" ? el.checked : el.value;
  }

  function clearField(name) {
    const el = st.root && st.root.querySelector(`[name="${name}"]`);
    if (el) { if (el.type === "checkbox") el.checked = false; else el.value = ""; }
  }

  /* ── actions ── */

  function stale(kind, s, mine, current, extra) {
    st.conflict = Object.assign({ kind, id: s.id, root: s.root_script_id, mine, current }, extra || {});
    st.panel = null;
  }

  async function approve(s) {
    const key = `approve:${s.id}`;
    if (st.busy[key]) return;
    st.busy[key] = true;
    paint();
    const rid = intent(key);
    const r = await call("POST", "marketing/scripts/approve", { request_id: rid, id: s.id, version: s.version }, { version: s.version, requestId: rid });
    delete st.busy[key];
    if (r.ok && isObj(r.data) && isObj(r.data.script)) {
      intentDone(key);
      replaceScript(s.id, r.data.script);
      const n = r.data.ad_number || r.data.script.ad_id;
      const more = r.data.registry === "skipped" && r.data.registry_note ? [String(r.data.registry_note)] : [];
      say("inbox", "ok", n ? `Approved. This is Ad ${n}.` : "Approved.", more);
    } else if (r.conflict) {
      intentDone(key);
      stale("approve", s, s.body, r.current);
    } else {
      say(`card:${s.id}`, "err", plainError(r));
    }
    paint();
  }

  async function saveEdit(s, mineOverride) {
    const key = `edit:${s.root_script_id}`;
    if (st.panel && st.panel.busy) return;
    let body;
    let parts = null;
    if (mineOverride) {
      body = mineOverride.body;
      parts = mineOverride.parts;
    } else if (Array.isArray(s.parts) && s.parts.length) {
      const next = s.parts.map((p, i) => ({ kind: p.kind, text: String(fieldValue(`edit-${s.id}-${i}`) ?? p.text) }));
      const changed = next.some((p, i) => p.text !== s.parts[i].text);
      if (!changed) { say(`card:${s.id}`, "wait", "Nothing changed yet. Change a line, then save."); paint(); return; }
      body = bodyFromEdits(s.body, s.parts, next);
      parts = next.filter((p) => p.text.trim());
    } else {
      body = String(fieldValue(`edit-${s.id}-body`) ?? s.body);
      if (body === s.body) { say(`card:${s.id}`, "wait", "Nothing changed yet. Change a line, then save."); paint(); return; }
    }
    if (!body.trim()) { say(`card:${s.id}`, "err", "The script cannot be empty. Nothing was saved."); paint(); return; }
    if (st.panel) st.panel.busy = true;
    if (st.conflict) st.conflict.busy = true;
    paint();
    const rid = intent(key);
    const req = { request_id: rid, id: s.id, version: s.version, body };
    if (parts) req.parts = parts;
    const r = await call("POST", "marketing/scripts/edit", req, { version: s.version, requestId: rid });
    if (st.panel) st.panel.busy = false;
    if (r.ok && isObj(r.data) && isObj(r.data.script)) {
      intentDone(key);
      st.panel = null;
      st.conflict = null;
      replaceScript(s.id, r.data.script);
      const warn = Array.isArray(r.data.warnings) ? r.data.warnings.map((w) => w && w.message).filter(Boolean) : [];
      say(`card:${r.data.script.id}`, "ok",
        `Saved as version ${r.data.script.version}. Your old version is kept.${warn.length ? " The checker says (it never blocks):" : ""}`, warn);
      if (st.filter === "draft") {
        const drafts = inboxOrder(st.scripts.items, st.pendingFix);
        const at = drafts.findIndex((x) => x.id === r.data.script.id);
        if (at >= 0) st.index = at;
      }
    } else if (r.conflict) {
      intentDone(key);
      stale("edit", s, body, r.current, { mineParts: parts });
    } else {
      if (st.conflict) st.conflict.busy = false;
      say(`card:${s.id}`, "err", plainError(r));
    }
    paint();
  }

  async function sendFix(s) {
    const note = String(fieldValue(`fix-${s.id}`) || "").trim();
    const makeRule = fieldValue(`fix-rule-${s.id}`) === true;
    if (!note) { say(`card:${s.id}`, "err", "Say what should change first. Nothing was sent."); paint(); return; }
    withCostSheet("fix_script", "Rewrite this script from your note", async () => {
      const key = `fix:${s.id}`;
      if (st.panel) st.panel.busy = true;
      paint();
      const rid = intent(key);
      const r = await call("POST", "marketing/scripts/fix", { request_id: rid, id: s.id, version: s.version, note, make_rule: makeRule }, { version: s.version, requestId: rid });
      if (st.panel) st.panel.busy = false;
      if (r.ok) {
        intentDone(key);
        st.panel = null;
        st.pendingFix[s.root_script_id] = { version: s.version, since: Date.now(), job_id: isObj(r.data) ? r.data.job_id : null };
        say("inbox", "wait", "Rewriting from your note. It comes back here when done. It moved to the end of your drafts.",
          makeRule ? ["Your note is also saved as a new rule for every script."] : []);
        startTimer();
      } else if (r.conflict) {
        intentDone(key);
        stale("fix", s, s.body, r.current);
      } else {
        say(`card:${s.id}`, "err", plainError(r));
      }
      paint();
    });
  }

  async function sendReject(s) {
    const key = `reject:${s.id}`;
    if (st.panel && st.panel.busy) return;
    const reason = String(fieldValue(`reject-${s.id}`) || "").trim();
    if (st.panel) st.panel.busy = true;
    paint();
    const rid = intent(key);
    const req = { request_id: rid, id: s.id, version: s.version };
    if (reason) req.reason = reason;
    const r = await call("POST", "marketing/scripts/reject", req, { version: s.version, requestId: rid });
    if (st.panel) st.panel.busy = false;
    if (r.ok && isObj(r.data) && isObj(r.data.script)) {
      intentDone(key);
      st.panel = null;
      replaceScript(s.id, r.data.script);
      say("inbox", "ok", "Rejected. It will not be filmed.");
    } else if (r.conflict) {
      intentDone(key);
      stale("reject", s, s.body, r.current);
    } else {
      say(`card:${s.id}`, "err", plainError(r));
    }
    paint();
  }

  async function sendOrder(rootId, how) {
    if (st.busy.order) return;
    const ids = filmOrder(st.scripts.items).map((s) => s.root_script_id);
    const next = moveInOrder(ids, rootId, how);
    if (next.join() === ids.join()) return;
    st.busy.order = true;
    paint();
    const key = `order:${next.join(",")}`;
    const rid = intent(key);
    const r = await call("POST", "marketing/scripts/order", { request_id: rid, order: next }, { requestId: rid });
    delete st.busy.order;
    if (r.ok) {
      intentDone(key);
      next.forEach((root, i) => {
        const s = st.scripts.items.find((x) => x.root_script_id === root && x.status === "locked");
        if (s) s.film_order = i + 1;
      });
      say("film", "ok", "Film order saved.");
    } else {
      say("film", "err", plainError(r));
    }
    paint();
  }

  function writeNow() {
    withCostSheet("start_batch", "Write scripts now", async () => {
      if (st.busy.writeNow) return;
      st.busy.writeNow = true;
      paint();
      const key = "write-now";
      const rid = intent(key);
      const r = await call("POST", "marketing/batches/write-now", { request_id: rid }, { requestId: rid });
      delete st.busy.writeNow;
      if (r.ok && isObj(r.data)) {
        intentDone(key);
        st.writeWatch = { batch_id: r.data.batch_id || null, since: Date.now() };
        say("writenow", "wait", "Writing now. New drafts show up here when they are done. You can leave this page.");
        startTimer();
        loadBatches();
      } else {
        say("writenow", "err", plainError(r));
      }
      paint();
    });
  }

  async function saveIdea(writeIt) {
    const text = String(fieldValue("idea-text") || "").trim();
    if (!text) { say("ideas", "err", "Type or say the idea first. Nothing was saved."); paint(); return; }
    const format = String(fieldValue("idea-format") || "");
    const funnel = String(fieldValue("idea-funnel") || "");
    const go = async () => {
      const busyKey = writeIt ? "ideaWrite" : "ideaSave";
      if (st.busy.ideaWrite || st.busy.ideaSave) return;
      st.busy[busyKey] = true;
      paint();
      const key = `idea:${writeIt ? "w" : "s"}:${text}:${format}:${funnel}`;
      const rid = intent(key);
      const req = { request_id: rid, raw_points: text };
      if (format) req.script_format = format;
      if (funnel) req.funnel_key = funnel;
      if (writeIt) req.write_now = true;
      const r = await call("POST", "marketing/ideas", req, { requestId: rid });
      delete st.busy[busyKey];
      if (r.ok && isObj(r.data) && isObj(r.data.idea)) {
        intentDone(key);
        st.ideas.items = [r.data.idea].concat(st.ideas.items.filter((i) => i.id !== r.data.idea.id));
        st.ideas.loaded = true;
        clearField("idea-text");
        if (writeIt && r.data.batch_id) {
          st.writeWatch = { batch_id: r.data.batch_id, since: Date.now() };
          say("ideas", "wait", "Saved. Writing one script from it now. It shows up in your drafts when it is done.");
          startTimer();
          loadBatches();
        } else if (writeIt && r.data.note) {
          say("ideas", "wait", `Saved, but not written now. ${r.data.note}`);
        } else {
          say("ideas", "ok", "Saved. It goes in the next batch.");
        }
      } else {
        say("ideas", "err", plainError(r));
      }
      paint();
    };
    if (writeIt) withCostSheet("start_batch", "Write one script from this idea now", go);
    else go();
  }

  async function sendRule(action, n) {
    if (st.busy.rule) return;
    let text = "";
    if (action === "add") text = String(fieldValue("rule-add") || "").trim();
    else if (action === "ban") text = String(fieldValue("rule-ban") || "").trim();
    else text = String(fieldValue(`rule-edit-${n}`) || "").trim();
    if (!text) { say("rules", "err", action === "ban" ? "Type the phrase first. Nothing was saved." : "Type the rule first. Nothing was saved."); paint(); return; }
    st.busy.rule = action;
    paint();
    const key = `rule:${action}:${n ?? ""}:${text}`;
    const rid = intent(key);
    const req = { request_id: rid, action, text };
    if (action === "edit") req.n = Number(n);
    const r = await call("POST", "marketing/rules", req, { requestId: rid });
    delete st.busy.rule;
    if (r.ok) {
      intentDone(key);
      if (action === "add") clearField("rule-add");
      if (action === "ban") clearField("rule-ban");
      if (action === "edit") st.ruleEdit = null;
      say("rules", "ok", action === "ban"
        ? "Saved. No script may say that phrase. It is reaching the repo now."
        : "Saved. The next batch follows it. It is reaching the repo now.");
      await loadRules();
      startTimer();
    } else {
      say("rules", "err", `The rule did not save. Nothing changed. ${plainError(r)}`);
    }
    paint();
  }

  function jumpToScript(id) {
    const s = byId(id);
    if (!s) return;
    if (s.status === "draft") {
      st.filter = "draft";
      const drafts = inboxOrder(st.scripts.items, st.pendingFix);
      st.index = Math.max(0, drafts.findIndex((x) => x.id === id));
    } else {
      st.filter = "all";
      st.open[`row:${id}`] = true;
    }
    st.panel = null;
    st.conflict = null;
    paint();
    const el = st.root.querySelector(`[data-sec="main"]`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }

  function move(delta) {
    const drafts = inboxOrder(st.scripts.items, st.pendingFix);
    if (!drafts.length) return;
    const next = Math.min(Math.max(st.index + delta, 0), drafts.length - 1);
    if (next === st.index) return;
    st.index = next;
    st.panel = null;
    st.conflict = null;
    if (st.say && st.say.scope !== "inbox") st.say = null;
    paint();
  }

  /* ── events (one delegated listener each; nothing posts on a swipe) ── */

  function onClick(ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b || !st.root.contains(b) || b.disabled) return;
    const act = b.getAttribute("data-act");
    const s = currentDraft();
    const cardId = b.closest("[data-id]") ? b.closest("[data-id]").getAttribute("data-id") : null;
    const card = cardId ? byId(cardId) : s;
    switch (act) {
      case "filter":
        st.filter = b.getAttribute("data-filter") || "draft";
        st.index = 0; st.panel = null; st.conflict = null; st.say = null;
        paint();
        break;
      case "prev": move(-1); break;
      case "next": move(1); break;
      case "approve": if (card) approve(card); break;
      case "edit": if (card) { st.panel = { kind: "edit", id: card.id, busy: false }; st.say = null; paint(); focusFirst("[data-panel] textarea"); } break;
      case "fix": if (card) { st.panel = { kind: "fix", id: card.id, busy: false }; st.say = null; paint(); focusFirst("#ccs-fix-note"); } break;
      case "reject": if (card) { st.panel = { kind: "reject", id: card.id, busy: false }; st.say = null; paint(); } break;
      case "panel-close": st.panel = null; paint(); break;
      case "edit-save": if (card) saveEdit(card); break;
      case "fix-send": if (card) sendFix(card); break;
      case "reject-send": if (card) sendReject(card); break;
      case "conflict-theirs": st.conflict = null; st.panel = null; st.say = null; loadScripts(); break;
      case "conflict-mine": useMine(); break;
      case "order-up": sendOrder(b.getAttribute("data-root"), "up"); break;
      case "order-down": sendOrder(b.getAttribute("data-root"), "down"); break;
      case "order-first": sendOrder(b.getAttribute("data-root"), "first"); break;
      case "write-now": writeNow(); break;
      case "idea-save": saveIdea(false); break;
      case "idea-write": saveIdea(true); break;
      case "ideas-more": st.showAllIdeas = !st.showAllIdeas; paint(); break;
      case "open-script": jumpToScript(b.getAttribute("data-id")); break;
      case "rule-add": sendRule("add"); break;
      case "rule-ban": sendRule("ban"); break;
      case "rule-edit": st.ruleEdit = Number(b.getAttribute("data-n")); paint(); break;
      case "rule-edit-cancel": st.ruleEdit = null; paint(); break;
      case "rule-edit-save": sendRule("edit", b.getAttribute("data-n")); break;
      case "scripts-retry": loadScripts(); break;
      case "ideas-retry": loadIdeas(); break;
      case "rules-retry": loadRules(); break;
      case "batches-retry": loadBatches(); break;
      case "versions-retry": {
        const d = b.closest("[data-load='versions']");
        if (d) loadVersions(d.getAttribute("data-id"));
        break;
      }
      default: break;
    }
  }

  /* "Use mine" after a 409 on Edit: read the live version, then save my words on top of it. */
  async function useMine() {
    const cf = st.conflict;
    if (!cf || cf.kind !== "edit") return;
    cf.busy = true;
    paint();
    const r = await call("GET", "marketing/scripts");
    if (r.ok && isObj(r.data) && Array.isArray(r.data.scripts)) {
      st.scripts = { status: "ok", loaded: true, items: r.data.scripts, as_of: r.data.as_of || new Date().toISOString(), error: null };
    }
    const live = st.scripts.items.find((s) => s.root_script_id === cf.root);
    if (!live) { cf.busy = false; say(`card:${cf.id}`, "err", "That script is gone now. Nothing was saved."); paint(); return; }
    st.conflict = { ...cf, id: live.id };
    await saveEdit(live, { body: cf.mine, parts: cf.mineParts || null });
  }

  function focusFirst(sel) {
    const el = st.root && st.root.querySelector(sel);
    if (el && typeof el.focus === "function") el.focus();
  }

  function onToggle(ev) {
    const d = ev.target;
    if (!d || d.tagName !== "DETAILS") return;
    const key = d.getAttribute("data-fold");
    if (!key) return;
    st.open[key] = d.open;
    if (d.open && key === "rules" && !st.rules.loaded && st.rules.status !== "loading") loadRules();
    if (d.open && d.getAttribute("data-load") === "versions") {
      const id = d.getAttribute("data-id");
      if (id && (!st.versions[id] || st.versions[id].status === "error")) { loadVersions(id); return; }
    }
    paint();
  }

  function onPointerDown(ev) {
    const card = ev.target && ev.target.closest ? ev.target.closest("[data-swipe]") : null;
    if (!card || st.filter !== "draft" || st.panel || st.conflict) { st.swipe = null; return; }
    if (ev.target.closest("button, a, input, textarea, select, summary, label")) { st.swipe = null; return; }
    st.swipe = { x: ev.clientX, y: ev.clientY };
  }

  function onPointerUp(ev) {
    const sw = st.swipe;
    st.swipe = null;
    if (!sw) return;
    const dx = ev.clientX - sw.x;
    const dy = ev.clientY - sw.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    move(dx < 0 ? 1 : -1);
  }

  /* ── the tab ── */

  function applyParam(p) {
    if (!p) return;
    const v = String(p);
    if (["draft", "locked", "filmed", "rejected", "all"].includes(v)) { st.filter = v; return; }
    if (v === "approved") { st.filter = "locked"; return; }
    if (v === "rules" || v === "ideas" || v === "batches") { st.open[v] = true; st.scrollTo = v; return; }
    if (/^[0-9a-f-]{36}$/i.test(v)) st.openId = v;
  }

  function render(rootEl, ctx) {
    stopTimer();
    st = freshState();
    st.ctx = ctx || {};
    st.root = rootEl;
    st.shown = true;
    applyParam(st.ctx.param);
    const doc = W.document;
    injectStyle(doc);
    rootEl.innerHTML = `<div class="ccs">` +
      `<section data-sec="head" aria-label="Scripts summary"></section>` +
      `<section data-sec="main" aria-label="Scripts"></section>` +
      `<section data-sec="ideas" aria-label="Ideas"></section>` +
      `<section data-sec="rules" aria-label="Rules"></section>` +
      `<section data-sec="batches" aria-label="Batch history"></section></div>`;
    /* Once per element: a second render on the same root must not double every tap. */
    if (!rootEl.__ccsBound) {
      rootEl.__ccsBound = true;
      rootEl.addEventListener("click", onClick);
      rootEl.addEventListener("toggle", onToggle, true);
      rootEl.addEventListener("pointerdown", onPointerDown);
      rootEl.addEventListener("pointerup", onPointerUp);
    }
    paint();
    startTimer();
    return loadAll().then(() => {
      if (st.openId) { const id = st.openId; st.openId = null; jumpToScript(id); }
      if (st.scrollTo) {
        const el = st.root.querySelector(`[data-sec="${st.scrollTo}"]`);
        st.scrollTo = null;
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
      }
    });
  }

  function refresh(ctx) {
    if (ctx) st.ctx = ctx;
    st.shown = true;
    startTimer();
    return loadAll();
  }

  function hide() {
    st.shown = false;
    stopTimer();
  }

  /* ── what the tests read ──────────────────────────────────────────────── */

  W.FundhubCCScripts = {
    FORMATS, FORMAT_WORDS, STATUS_WORDS, FILTERS, POLL_MS,
    esc, plural, azTime, azDay, when, formatWord, funnelName, hhmmWords, newRequestId,
    inboxOrder, filmOrder, moveInOrder, countsByFilter, cardCaption, flagReasons, checkLine, checkWords,
    partsView, joinParts, bodyFromEdits, headline, latestBatchLine, showWriteNow, writeNowNote, capWords,
    scheduleLine, ruleActionWords, ruleStateWords, ideaStatusWord, batchStatusWord, plainError,
    html: {
      head: headHtml, main: mainHtml, inbox: inboxHtml, card: cardHtml, film: filmListHtml, list: plainListHtml,
      ideas: ideasHtml, rules: rulesHtml, batches: batchesHtml, conflict: conflictHtml, versions: versionsHtml
    },
    state: freshState,
    CSS
  };

  /* ── register (docs/specs/command-center-tabs.md) ── */
  (W.FundhubCC = W.FundhubCC || { _q: [], registerTab(t) { this._q.push(t); } })
    .registerTab({ id: "scripts", label: "Scripts", order: 3, render, refresh, hide });
})(typeof window !== "undefined" ? window : this);
