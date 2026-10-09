// The hourly pulse's alerts: decide what to say, say it in one text, keep the incident record.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md deltas 6, 7, 8, 11) cutting contract section 5.
// TEXT ONLY tonight. No GitHub issue, no issue comment, no fixer. The fix line rides in the text.
//
// THE ONE SENDER. The hourly pulse owns two sends, both to Chris's own phone:
//   - the text: textMorningBrief() from ./notify.mjs, with dryRun:false passed ON PURPOSE (it defaults to true);
//   - the buzz: ntfy, the second road, used when the text failed or the text path itself is broken
//     (an alert must not ride the thing that broke).
// Both are reached through `sinks` so a test and `prove --beats` can hand in fakes. A beat never gets a sink,
// a token or this module (the beat guard bans importing it).
//
// ORDER (v1 delta 8): decide -> SEND THE TEXT -> write records. This file is split to match:
//   decide()         pure. Which beats are new breaks, still broken, healed, damped, quiet.
//   formatText()     pure. The words. 480 characters or fewer, plain ASCII, 4th grade.
//   act()            sends. Takes NO database handle: it cannot write a record.
//   saveIncidents()  records. Called AFTER the text. Opens, claims and closes incidents.
//
// DEDUPE. A re-run in the same hour must send one text. Two layers:
//   1. decide() reads last_alert_at off the open incident the runner loaded before the beats ran. A break whose
//      last text was under 50 minutes ago is QUIET (no text). This is what stops a retried run.
//   2. saveIncidents() calls claimAlert() (an atomic UPDATE, one claim per 50 minutes). If another invocation
//      won the claim first, we count a duplicate in the result (`dupes`). It cannot unsend, and the text goes
//      before the records on purpose: a slow database must never hold the text back.
//   Worst case is one duplicate text. That is accepted (contract 5.4).
//
// WHAT NEVER GOES IN A TEXT: a phone, an email, a name, an amount, a token, a response body. The text carries
// the beat's title, the step it stopped at, and line 1 of its own fix guide (all written in code). The runtime
// `detail` only ever reaches the buzz, after redact() and a scrub, capped.

import { textMorningBrief } from "./notify.mjs";
import { send as sendNtfy, isNtfyConfigured } from "../messaging/providers/ntfy.mjs";
import { redact } from "../lib/outbound-fetch.mjs";
import { openIncident, claimAlert, closeIncident } from "./records.mjs";

export const MAX_TEXT_CHARS = 480;
export const CLAIM_WINDOW_MS = 50 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
/** This many red beats at once is one text about one likely cause. */
export const STORM_AT = 4;
/** This many red beats failing with a "db:" detail means the database, not the beats. */
export const DB_DOWN_AT = 3;

const FALLBACK_FIX = "Open the pulse-hourly function log on Netlify and read the step it stopped at";
const TEXT_PATH_ID = "text-path";

/* ---------------- small, pure helpers ---------------- */

/** Plain ASCII, one line. Anything outside printable ASCII is dropped. */
export function ascii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A line the beat's author wrote (title, step, fix line): redacted, ASCII, cut. Not token-scrubbed (paths are long). */
export function cleanLine(value, max) {
  return cut(ascii(redact(value)), max);
}

/** Run-time text (a beat's `detail`): everything that could name a person or hold a secret is removed first. */
export function scrubDetail(value, max = 150) {
  const s = ascii(redact(value))
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/https?:\/\/[^\s)]+/gi, (u) => { try { return new URL(u).host; } catch { return "[link]"; } })
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9+/_=-]{24,}\b/g, "[long value]")
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "[amount]");
  return cut(s.replace(/\s+/g, " ").trim(), max);
}

function cut(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  // Cut back to the last space so a word is never sliced in half ("b." at the end of a text).
  const room = t.slice(0, Math.max(0, max - 3));
  const space = room.lastIndexOf(" ");
  const clean = space >= Math.floor(room.length / 2) ? room.slice(0, space) : room;
  return `${clean.trimEnd()}...`;
}

const noDot = (s) => String(s).replace(/[.\s]+$/g, "");

/** Line 1 of a beat's fix guide. */
export function fixLineOf(beat) {
  const first = String(beat?.fixGuide ?? "").split("\n")[0] ?? "";
  return cleanLine(first, 120) || FALLBACK_FIX;
}

const infoOf = (beatsById, beatId, result) => {
  const beat = beatsById && typeof beatsById.get === "function" ? beatsById.get(beatId) : null;
  return {
    beat,
    title: cleanLine(beat?.title || beatId, 60) || beatId,
    step: cleanLine(result?.step || "unknown", 40) || "unknown",
    fix: beat ? fixLineOf(beat) : FALLBACK_FIX
  };
};

const hoursBetween = (from, to) => {
  const a = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const b = to instanceof Date ? to.getTime() : new Date(to).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / HOUR_MS : null;
};

/** A "db:" detail: what a beat says when the read box could not be used. The harness may put "threw: " in front. */
export const isDbDetail = (detail) => /^(?:threw:\s*)?db:/i.test(String(detail ?? "").trim());

/* ---------------- decide ---------------- */

/**
 * Sort this run's results into what has to be said.
 *
 * @param {object} a
 * @param {Array}  a.results      BeatResult[] from this run (red ones carry step and detail)
 * @param {Array|null} a.open     open incident rows (snake_case, from listOpenIncidents), or null when unknown
 * @param {Map|null}   a.prev     beatId -> [{ ok }] newest first (lastResults), or null when unreadable
 * @param {Map}    a.beatsById    beatId -> beat module (title, damp, fixGuide)
 * @param {Date}   a.now
 * @param {boolean} a.dbDown      the runner could not read the database before the beats ran
 */
export function decide({ results = [], open = null, prev = null, beatsById = new Map(), now = new Date(), dbDown = false } = {}) {
  const openByBeat = new Map();
  if (Array.isArray(open)) for (const row of open) if (row && !row.closed_at) openByBeat.set(row.beat_id, row);

  const plan = { newBreaks: [], stillBroken: [], healed: [], damped: [], quiet: [], storm: false, dbDown: false, red: 0, dbReds: 0 };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  for (const result of results) {
    const beatId = result?.beatId;
    if (!beatId) continue;
    const inc = open === null ? null : openByBeat.get(beatId) ?? null;

    if (result.ok === false) {
      plan.red++;
      if (isDbDetail(result.detail)) plan.dbReds++;
      if (inc) {
        const h = hoursBetween(inc.opened_at, nowMs);
        const entry = { beatId, result, incident: inc, hour: h === null ? null : Math.floor(h) + 1 };
        const last = inc.last_alert_at ? new Date(inc.last_alert_at).getTime() : null;
        if (last === null || !Number.isFinite(last) || nowMs - last >= CLAIM_WINDOW_MS) plan.stillBroken.push(entry);
        else plan.quiet.push(entry);
        continue;
      }
      // No open incident (or we cannot tell). Flap damping: a beat with damp N needs its last N results all red.
      const beat = beatsById.get(beatId);
      const damp = Number.isInteger(beat?.damp) && beat.damp > 1 ? beat.damp : 1;
      let eligible = true;
      if (damp > 1 && prev !== null) {
        const rows = (prev instanceof Map ? prev.get(beatId) : prev[beatId]) || [];
        eligible = rows.length >= damp - 1 && rows.slice(0, damp - 1).every((x) => x && x.ok === false);
      }
      if (eligible) plan.newBreaks.push({ beatId, result, incident: null, hour: null });
      else plan.damped.push({ beatId, result });
    } else if (result.ok === true && inc) {
      const h = hoursBetween(inc.opened_at, nowMs);
      plan.healed.push({ beatId, result, incident: inc, hours: h === null ? null : Math.max(1, Math.round(h)) });
    }
  }

  const due = plan.newBreaks.length + plan.stillBroken.length;
  plan.storm = plan.red >= STORM_AT && due > 0;
  plan.dbDown = Boolean(dbDown) && plan.dbReds >= DB_DOWN_AT && due > 0;
  return plan;
}

/** True when this plan has anything to say. */
export function hasNews(plan) {
  return Boolean(plan && (plan.newBreaks.length || plan.stillBroken.length || plan.healed.length));
}

/* ---------------- formatText ---------------- */

/**
 * The one text for this run, or null when there is nothing to say. Always <= 480 characters, ASCII only.
 * Returns { body, kind }.
 */
export function formatText(plan, { beatsById = new Map() } = {}) {
  if (!hasNews(plan)) return null;
  const breaks = [
    ...plan.newBreaks.map((e) => ({ ...e, kind: "new" })),
    ...plan.stillBroken.map((e) => ({ ...e, kind: "still" }))
  ];
  const healed = plan.healed;

  if (plan.dbDown && breaks.length) {
    return fit({
      kind: "db_down",
      make: () => `Fundhub BROKEN: the database is not answering. ${plan.red} checks are red. Fix: open https://fundhub.ai/api/health and the Supabase project.`
    });
  }

  if (plan.storm && breaks.length) {
    const first = infoOf(beatsById, breaks[0].beatId, breaks[0].result);
    return fit({
      kind: "storm",
      make: ({ title, step, fix }) => {
        const tail = healed.length ? ` ${healed.length} fixed.` : "";
        return `Fundhub BROKEN: ${plan.red} checks are red at once. Likely one cause. First: ${title} at "${step}". Fix: ${noDot(fix)}.${tail}`;
      },
      parts: first
    });
  }

  const total = breaks.length + healed.length;
  if (total === 1 && breaks.length === 1) {
    const e = breaks[0];
    const info = infoOf(beatsById, e.beatId, e.result);
    if (e.kind === "new") {
      return fit({ kind: "break", parts: info, make: ({ title, step, fix }) => `Fundhub BROKEN: ${title}. It stopped at "${step}". Fix: ${noDot(fix)}.` });
    }
    const hourWords = e.hour ? `, hour ${e.hour}` : "";
    return fit({ kind: "still", parts: info, make: ({ title, step, fix }) => `Fundhub STILL BROKEN${hourWords}: ${title} at "${step}". Fix: ${noDot(fix)}.` });
  }
  if (total === 1) {
    const h = healed[0];
    const info = infoOf(beatsById, h.beatId, h.result);
    const how = h.hours ? ` It was broken ${h.hours} h.` : "";
    return fit({ kind: "fixed", parts: info, make: ({ title }) => `Fundhub FIXED: ${title}.${how}` });
  }

  // Two or more things changed in one run: one text, each fix line cut short.
  const items = [
    ...breaks.map((e) => ({ type: e.kind === "still" ? "still" : "new", info: infoOf(beatsById, e.beatId, e.result), hour: e.hour })),
    ...healed.map((h) => ({ type: "fixed", info: infoOf(beatsById, h.beatId, h.result), hours: h.hours }))
  ];
  return fitMany(items);
}

/* Try the roomy version first, then cut the pieces until it fits. The last resort is a plain cut. */
const LADDER = [
  { title: 60, step: 40, fix: 120 },
  { title: 50, step: 30, fix: 80 },
  { title: 40, step: 24, fix: 50 },
  { title: 30, step: 18, fix: 30 },
  { title: 24, step: 14, fix: 0 }
];

function fit({ kind, make, parts = { title: "", step: "", fix: "" } }) {
  let body = "";
  for (const rung of LADDER) {
    body = make({ title: cut(parts.title, rung.title), step: cut(parts.step, rung.step), fix: rung.fix ? cut(parts.fix, rung.fix) : "see the pulse log" });
    if (body.length <= MAX_TEXT_CHARS) return { body: ascii(body), kind };
  }
  return { body: ascii(cut(body, MAX_TEXT_CHARS)), kind };
}

function fitMany(items) {
  const n = items.length;
  const shown = items.slice(0, 3);
  const more = n - shown.length;
  let body = "";
  for (const rung of LADDER) {
    const fixCut = Math.min(rung.fix, 60);
    const bits = shown.map((it) => {
      const t = cut(it.info.title, rung.title);
      if (it.type === "fixed") return `FIXED: ${t}${it.hours ? ` (${it.hours} h)` : ""}`;
      const lead = it.type === "still" ? "STILL BROKEN" : "BROKEN";
      const fix = fixCut ? ` Fix: ${noDot(cut(it.info.fix, fixCut))}.` : "";
      return `${lead}: ${t} at "${cut(it.info.step, rung.step)}".${fix}`;
    });
    body = `Fundhub: ${n} things changed. ${bits.join(" ")}${more > 0 ? ` And ${more} more.` : ""}`;
    if (body.length <= MAX_TEXT_CHARS) return { body: ascii(body), kind: "mixed" };
  }
  return { body: ascii(cut(body, MAX_TEXT_CHARS)), kind: "mixed" };
}

/** The buzz: a little longer than the text, with a scrubbed detail for each red beat. Never holds a secret. */
export function formatBuzz(plan, { beatsById = new Map() } = {}) {
  const text = formatText(plan, { beatsById });
  if (!text) return null;
  const lines = [text.body];
  for (const e of [...plan.newBreaks, ...plan.stillBroken].slice(0, 3)) {
    const d = scrubDetail(e.result?.detail, 100);
    if (d) lines.push(`${cleanLine(e.beatId, 44)}: ${d}`);
  }
  return { title: "Fundhub pulse", body: cut(ascii(lines.join(" | ")), 480), kind: text.kind };
}

/* ---------------- sinks ---------------- */

/**
 * The two real roads to Chris's phone.
 *   text(body, { env })           -> { delivery_status: "sent" | "failed" | "no_number" | "dry_run", sent_to_last4, error }
 *   ntfy(notification, { env })   -> { status: "sent" | "failed" | "rejected", error } or null when ntfy is not configured
 */
export function realSinks() {
  return {
    real: true,
    text: (body, { env } = {}) => textMorningBrief({ body, env, dryRun: false }),
    ntfy: async (notification, { env } = {}) => (isNtfyConfigured(env) ? sendNtfy({ notification }, { env }) : null)
  };
}

/**
 * Recording fakes. They send nothing and remember what they were handed (calls.text, calls.ntfy).
 * textStatus: "sent" | "failed" | "no_number" | "throw" | "hang".  ntfyStatus: null (not configured) | "sent" | "failed" | "throw" | "hang".
 */
export function recordingSinks({ textStatus = "sent", ntfyStatus = null } = {}) {
  const calls = { text: [], ntfy: [] };
  return {
    real: false,
    calls,
    text: async (body) => {
      calls.text.push(body);
      if (textStatus === "throw") throw new Error("fake text sink threw");
      if (textStatus === "hang") return new Promise(() => {});
      const sent = textStatus === "sent";
      return { delivery_status: textStatus, sent_to_last4: "0000", error: sent ? null : `fake ${textStatus}`, provider_message_id: null };
    },
    ntfy: async (notification) => {
      calls.ntfy.push(notification);
      if (ntfyStatus === null) return null;
      if (ntfyStatus === "throw") throw new Error("fake ntfy sink threw");
      if (ntfyStatus === "hang") return new Promise(() => {});
      return { status: ntfyStatus, providerMessageId: null, error: ntfyStatus === "sent" ? null : `fake ntfy ${ntfyStatus}` };
    }
  };
}

const sleepFlag = Symbol("timed out");
async function within(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(sleepFlag), Math.max(1, ms)); });
  try {
    return await Promise.race([Promise.resolve(promise).then((v) => v, (e) => ({ __threw: e })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- act: send the text ---------------- */

/**
 * Send the one text for this run, and the buzz when it is needed. Takes NO database handle.
 *
 * Returns { due, kind, body, texts: [{ kind, delivery_status, sent_to_last4 }], ntfy: { status } | null,
 *           delivered, error }.
 *   due        there was news to tell
 *   delivered  the text was "sent" OR the buzz was "sent"
 */
export async function act(plan, { env = process.env, sinks, beatsById = new Map(), capMs = 6000 } = {}) {
  const text = formatText(plan, { beatsById });
  if (!text) return { due: false, kind: null, body: null, texts: [], ntfy: null, delivered: false, error: null };

  const s = sinks || realSinks();
  const started = Date.now();
  const left = () => Math.max(500, capMs - (Date.now() - started));

  const textPathRed = [...plan.newBreaks, ...plan.stillBroken].some((e) => e.beatId === TEXT_PATH_ID);
  const buzz = formatBuzz(plan, { beatsById });
  const notification = { title: buzz.title, body: buzz.body, priority: 5, tags: ["rotating_light"] };

  const sendText = async (ms) => {
    const r = await within(s.text(text.body, { env }), ms);
    if (r === sleepFlag) return { delivery_status: "failed", sent_to_last4: null, error: "the text did not answer in time" };
    if (r && r.__threw) return { delivery_status: "failed", sent_to_last4: null, error: cleanLine((r.__threw && r.__threw.message) || r.__threw, 120) };
    return r || { delivery_status: "failed", sent_to_last4: null, error: "the text sink returned nothing" };
  };
  const sendBuzz = async (ms) => {
    const r = await within(s.ntfy(notification, { env }), ms);
    if (r === sleepFlag) return { status: "failed", error: "the buzz did not answer in time" };
    if (r && r.__threw) return { status: "failed", error: cleanLine((r.__threw && r.__threw.message) || r.__threw, 120) };
    return r; // null = ntfy is not configured
  };

  let textRes;
  let buzzRes = null;
  if (textPathRed) {
    // The text path itself is red: do not wait for it. Both roads at once.
    [textRes, buzzRes] = await Promise.all([sendText(left()), sendBuzz(left())]);
  } else {
    textRes = await sendText(Math.min(left(), Math.max(1500, capMs - 1500)));
    if (textRes.delivery_status !== "sent") buzzRes = await sendBuzz(left());
  }

  const textSent = textRes.delivery_status === "sent";
  const buzzSent = Boolean(buzzRes && buzzRes.status === "sent");
  const failedBoth = !textSent && !buzzSent;
  return {
    due: true,
    kind: text.kind,
    body: text.body,
    texts: [{ kind: text.kind, delivery_status: String(textRes.delivery_status || "failed"), sent_to_last4: textRes.sent_to_last4 ?? null }],
    ntfy: buzzRes ? { status: String(buzzRes.status || "failed") } : null,
    delivered: textSent || buzzSent,
    error: failedBoth ? cleanLine(`alert due but not delivered: text ${textRes.delivery_status}${textRes.error ? ` (${textRes.error})` : ""}${buzzRes ? `; buzz ${buzzRes.status}` : "; buzz not set up"}`, 200) : null
  };
}

/* ---------------- saveIncidents: the records, after the text ---------------- */

/**
 * Open, claim and close incidents. Runs AFTER act(). Every call is one statement and none throws.
 *
 * delivered false: incidents still open, but nothing is claimed, so the next run's text is not "quiet".
 * Returns { opened, claimed, dupes, closed, errors: [string] }.
 */
export async function saveIncidents(plan, { rdb, orgId, runId, delivered = false } = {}) {
  const out = { opened: 0, claimed: 0, dupes: 0, closed: 0, errors: [] };
  if (!rdb || !orgId || !runId) return out;
  const note = (r) => { if (r && r.ok === false && r.error) out.errors.push(String(r.error).slice(0, 160)); };

  const jobs = [];
  for (const e of plan.newBreaks) {
    jobs.push((async () => {
      const r = await openIncident(rdb, { orgId, beatId: e.beatId, runId, step: e.result?.step, detail: redact(e.result?.detail) });
      note(r);
      if (!r.ok) return;
      if (r.won) out.opened++;
      if (r.won && delivered && r.id) {
        const c = await claimAlert(rdb, r.id);
        note(c);
        if (c.ok && c.claimed) out.claimed++;
        else if (c.ok) out.dupes++;
      }
    })());
  }
  if (delivered) {
    for (const e of plan.stillBroken) {
      jobs.push((async () => {
        const c = await claimAlert(rdb, e.incident.id);
        note(c);
        if (c.ok && c.claimed) out.claimed++;
        else if (c.ok) out.dupes++;
      })());
    }
  }
  for (const h of plan.healed) {
    jobs.push((async () => {
      const r = await closeIncident(rdb, h.incident.id, { closedBy: "auto" });
      note(r);
      if (r.ok && r.closed) out.closed++;
    })());
  }
  await Promise.all(jobs);
  return out;
}
