// The hourly pulse runner: fire every beat, decide, text Chris, then keep the record.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md) cutting contract section 3.
// READ ONLY TONIGHT. A beat reaches data through ONE read box for the whole run (BEGIN READ ONLY, then
// ROLLBACK; src/pulse/beats/readbox.mjs) and the web through GET and HEAD only (pulse-probe). Nothing a beat
// can do saves a row, sends a message, calls a vendor with a write, or emits an event.
//
// WHAT THIS FILE MAY WRITE (live mode only, never in a beat, never before the text):
//   pulse_beats, pulse_bank_links, pulse_incidents   through src/pulse/records.mjs, plain single statements.
//   Nothing else. It sends one text (and, when needed, one buzz) to Chris through src/pulse/alerts.mjs.
//
// THE CLOCK (one deadline, counted from entry; critic issue 3):
//
//   0 s ---- prefetch (2 s cap) ---- box opens ---- beats (13 s cap) ---- close box ---- TEXT (6 s reserved) ---- records (2.5 s cap)
//            org, open incidents,                    all beats at once                    cannot start later      best effort
//            last results, bank links                                                     than 16 s from entry
//
// The beats phase ends at the earlier of entry + 13 s and entry + 22 s - 6 s, so the text always has its 6 s.
// A beat still running at the cut is recorded red, at the step it was in, "cut at the 13 s beat budget", with
// its time left unmeasured (null, never 0).
//
// MODES. "live" writes records and sends for real. "prove" and "one" do neither: they never write a record and
// they use recording fakes for the text unless the caller hands in sinks. A run that is not live can never reach
// a real provider, even if a caller forgets to pass sinks.
//
// `ok` means the runner finished and tried to save. A red beat does NOT make the run not-ok (or every break would
// also turn job:pulse-hourly red at 6 a.m.). The run is not-ok when: the env gate failed, the runner crashed, the
// records could not be saved, there were no beats to run (an empty list is blind, never green), or an alert was due
// and reached neither the text nor the buzz (critic issue 11).
//
// TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). Outside 6 a.m. to 10 p.m. Arizona time the
// run still fires every beat, still opens incidents and still damps, but sends nothing (alerts.mjs act() holds it)
// and claims nothing, so the 6:07 a.m. run tells Chris. A held alert is not a broken run. The blind-pulse text
// below is held the same way.
//
// WHEN THE DATABASE IS DOWN. Beats that read fail at their first read with detail "db: ..." (the harness puts
// "threw: " in front). The text says the database is down ONCE. Alerts fall back to texting every hour with no state.

import crypto from "node:crypto";
import { db as sharedDb, pool as sharedPool } from "../db.mjs";
import { runBeat, HARNESS } from "./beats/contract.mjs";
import { makeBeatCtx } from "./beats/ctx.mjs";
import { openReadBox, readDbSettings, DB_SETTINGS_SQL } from "./beats/readbox.mjs";
import { loadBeats } from "./beats/index.mjs";
import { makeProbe } from "../messaging/providers/pulse-probe.mjs";
import { redact } from "../lib/outbound-fetch.mjs";
import {
  defaultOrgId, listOpenIncidents, lastResults, loadBankLinks, writeBeatResults, upsertBankLinks, cleanError
} from "./records.mjs";
import { decide, act, saveIncidents, realSinks, recordingSinks, cleanLine } from "./alerts.mjs";
import { inTextWindow, HELD } from "./quiet-hours.mjs";

export const RUN_BUDGET_MS = 22_000;
export const BEATS_PHASE_MS = 13_000;
export const ALERTS_PHASE_MS = 6_000;
export const RECORDS_MS = 2_500;
export const PREFETCH_MS = 2_000;
export const BOX_OPEN_MS = 2_500;
export const BOX_CLOSE_MS = 2_500;
/** The text never gets less than this, even when the earlier phases ran late. */
export const MIN_TEXT_MS = 2_500;

/** The one text sent when the pulse has no checks to run (the list would not load, or it is empty). */
export const BLIND_TEXT = "Fundhub BROKEN: the hourly pulse could not load its checks. Fix: open the pulse-hourly function log on Netlify.";

export const MODES = Object.freeze(["live", "prove", "one"]);

/** A sleep you can cancel, so a finished phase does not leave a timer holding the process open. */
function cancellableWait(ms) {
  let timer;
  const promise = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, ms)); });
  return { promise, cancel: () => clearTimeout(timer) };
}
const TIMED_OUT = Symbol("timed out");

/** Race a promise against a cap. Never rejects. { ok:true, value } | { ok:false, timedOut, error }. */
async function settle(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), Math.max(1, ms)); });
  try {
    const r = await Promise.race([
      Promise.resolve(promise).then((value) => ({ value }), (error) => ({ error })),
      timeout
    ]);
    if (r === TIMED_OUT) return { ok: false, timedOut: true, error: new Error(`no answer in ${Math.round(ms)} ms`) };
    return "error" in r ? { ok: false, timedOut: false, error: r.error } : { ok: true, value: r.value };
  } finally {
    clearTimeout(timer);
  }
}

const say = (err) => cleanError(err);

/** The site address a beat may call. The env gate and ctx.siteUrl both use it. */
export function siteUrlOf(env = {}) {
  const live = Boolean(env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);
  const raw = String(env.URL || env.DEPLOY_PRIME_URL || (live ? "https://fundhub.ai" : "")).trim();
  return raw.replace(/\/+$/, "");
}

/** What is missing before anything may run. [] = go. */
export function missingEnv(env = {}) {
  const miss = [];
  if (!String(env.DATABASE_URL || "").trim()) miss.push("DATABASE_URL");
  if (!siteUrlOf(env)) miss.push("URL");
  return miss;
}

function emptyResult(runId, extra = {}) {
  return {
    ok: false, runId, ran: 0, failed: 0, timedOut: 0, results: [],
    records: { written: false, error: null },
    alerts: { texts: [], issues: [], ntfy: null, error: null },
    dbUp: false, ms: 0, ...extra
  };
}

/** A result with the bulky parts removed, for the RunResult that is logged and returned. */
function slim(r) {
  const ev = r.evidence && typeof r.evidence === "object" ? { ...r.evidence } : null;
  if (ev && Array.isArray(ev.bankLinks)) { ev.bankLinksCount = ev.bankLinks.length; delete ev.bankLinks; }
  return { ...r, evidence: ev };
}

/**
 * Run the hourly pulse once.
 *
 * @param {object} [o]
 * @param {object} [o.env]       default process.env
 * @param {Date}   [o.now]
 * @param {Array}  [o.beats]     beat modules. Default: loadBeats() (the literal list)
 * @param {"live"|"prove"|"one"} [o.mode]
 * @param {string[]} [o.only]    run just these beat ids
 * @param {object} [o.sinks]     { text, ntfy } (alerts.mjs). Ignored in live mode only when null.
 * @param {object} [o.rdb]       { query(sql, params) } for records and the pre-run reads. Default: the shared pool
 * @param {Function} [o.connect] () => pg client, for the one read box. Default: shared pool connect
 * @param {object} [o.probe]     { get, head }. Default: pulse-probe (GET and HEAD only)
 * @param {object} [o.budgets]   override the phase caps (tests)
 * @param {Function} [o.loadBeatsImpl]  replaces the literal-list loader (tests)
 */
export async function runPulse({
  env = process.env, now = new Date(), beats, mode = "live", only = null, sinks = null,
  rdb = sharedDb, connect = () => sharedPool().connect(), probe, budgets = {}, loadBeatsImpl = loadBeats
} = {}) {
  const t0 = Date.now();
  const runId = crypto.randomUUID();
  const B = {
    run: RUN_BUDGET_MS, beats: BEATS_PHASE_MS, alerts: ALERTS_PHASE_MS, records: RECORDS_MS, prefetch: PREFETCH_MS,
    boxOpen: BOX_OPEN_MS, boxClose: BOX_CLOSE_MS, minText: MIN_TEXT_MS, ...budgets
  };
  const elapsed = () => Date.now() - t0;

  // 1. The env gate. With no database or no site address, do NOTHING: no beat, no network, no database.
  const miss = missingEnv(env);
  if (miss.length) return emptyResult(runId, { ok: false, error: `missing env: ${miss.join(", ")}`, ms: elapsed() });
  if (!MODES.includes(mode)) return emptyResult(runId, { ok: false, error: `unknown mode: ${String(mode).slice(0, 20)}`, ms: elapsed() });
  const live = mode === "live";
  // A run that is not live can never reach a real provider.
  const theSinks = sinks || (live ? realSinks() : recordingSinks());

  /** A run that has no checks to run. A blind pulse must not be a silent one: live mode texts once. */
  const blindRun = async (error) => {
    const out = emptyResult(runId, { ok: false, error, ms: elapsed() });
    if (live && !inTextWindow(now)) {
      out.alerts.texts = [{ kind: "load_failed", delivery_status: HELD, sent_to_last4: null }];
      out.alerts.held = true;
    } else if (live) {
      const s = await settle(theSinks.text(BLIND_TEXT, { env }), B.alerts);
      out.alerts.texts = [{ kind: "load_failed", delivery_status: s.ok ? String(s.value?.delivery_status || "failed") : "failed", sent_to_last4: s.ok ? s.value?.sent_to_last4 ?? null : null }];
      out.ms = elapsed();
    }
    return out;
  };

  try {
    // 2. The beats.
    let list;
    try {
      list = beats ?? (await loadBeatsImpl());
    } catch (err) {
      return blindRun(`could not load the beats: ${say(err)}`);
    }
    if (only) {
      const want = new Set(only);
      const have = new Set(list.map((b) => b.id));
      const unknown = [...want].filter((id) => !have.has(id));
      if (unknown.length) return emptyResult(runId, { ok: false, error: `no such beat: ${unknown.join(", ").slice(0, 80)}`, ms: elapsed() });
      list = list.filter((b) => want.has(b.id));
    }
    // An empty list is a blind pulse, not a green one (checker finding, high): nothing was checked, so nothing may
    // be called well. Live: one text and not ok. The heartbeat then goes red instead of green forever.
    if (list.length === 0) return blindRun("no beats to run: the beat list is empty");
    const beatsById = new Map(list.map((b) => [b.id, b]));

    // 3. Prefetch (2 s cap in all): default org, open incidents, the last results of each beat, bank-link state.
    let orgId = null;
    let dbUp = false;
    let open = null;
    let prev = null;
    let bankLinks = [];
    const prefetchEnd = t0 + B.prefetch;
    const room = () => Math.max(1, prefetchEnd - Date.now());
    const org = await settle(defaultOrgId(rdb), room());
    if (org.ok && org.value?.ok && org.value.orgId) {
      orgId = org.value.orgId;
      dbUp = true;
      const needsLinks = list.some((b) => Array.isArray(b.needs) && b.needs.includes("bankLinks"));
      const [inc, last, links] = await Promise.all([
        settle(listOpenIncidents(rdb, orgId), room()),
        settle(lastResults(rdb, { orgId, beatIds: list.map((b) => b.id) }), room()),
        needsLinks ? settle(loadBankLinks(rdb, orgId), room()) : Promise.resolve(null)
      ]);
      if (inc.ok && inc.value?.ok) open = inc.value.rows;
      if (last.ok && last.value?.ok) {
        prev = new Map();
        for (const row of last.value.rows) {
          if (!prev.has(row.beat_id)) prev.set(row.beat_id, []);
          prev.get(row.beat_id).push(row); // already newest first within a beat
        }
      }
      if (links && links.ok && links.value?.ok) bankLinks = links.value.rows;
    }

    // 4. ONE read box for the whole run. If it will not open, beats that read go red at their first read with "db:".
    let box = null;
    let boxProblem = null;
    if (!dbUp) {
      boxProblem = "the database is not answering";
    } else {
      const opening = openReadBox({ connect });
      const o = await settle(opening, B.boxOpen);
      if (o.ok) box = o.value;
      else {
        boxProblem = o.timedOut ? "the read box did not open in time" : say(o.error);
        // If it opens late, close it at once so the connection is never left holding a slot.
        opening.then((late) => late.close({ timedOut: true }), () => {});
      }
    }
    const dbError = boxProblem ? `db: ${boxProblem}` : null;
    const read = box ? (text, params) => box.read(text, params) : async () => { throw new Error(dbError || "db: no database"); };

    const plain = (sql) => {
      if (sql !== DB_SETTINGS_SQL) throw new Error("only the fixed settings query may run outside the read box");
      return rdb.query(sql);
    };
    const theProbe = probe || makeProbe({ env });
    const site = siteUrlOf(env);
    const ctxEnv = { ...env, URL: site };

    // 5. The beats phase. All at once, whole phase capped. Each beat has its own ctx and its own deadline.
    // The phase is capped at 13 s from its own start, and never runs into the text's 6 s (entry + 22 s - 6 s).
    const phaseMs = Math.max(1, Math.min(B.beats, t0 + B.run - B.alerts - Date.now()));
    const entries = list.map((beat) => {
      const e = { beat, ctx: null, result: null, promise: null };
      try {
        e.ctx = makeBeatCtx({
          beat, runId, env: ctxEnv, now, siteUrl: site,
          state: Array.isArray(beat.needs) && beat.needs.includes("bankLinks") ? { bankLinks } : null,
          read, probe: theProbe, dbSettings: () => readDbSettings(plain)
        });
        e.promise = runBeat(beat, e.ctx, { deadlineMs: beat.deadlineMs }).then(
          (r) => { e.result = r; return r; },
          (err) => { e.result = failedResult(beat.id, "start", `harness error: ${say(err)}`); return e.result; }
        );
      } catch (err) {
        e.result = failedResult(beat.id, "start", `could not start: ${say(err)}`);
        e.promise = Promise.resolve(e.result);
      }
      return e;
    });
    const phaseTimer = cancellableWait(phaseMs);
    await Promise.race([Promise.all(entries.map((e) => e.promise)), phaseTimer.promise]);
    phaseTimer.cancel();

    let cut = 0;
    for (const e of entries) {
      if (e.result) continue;
      cut++;
      const h = e.ctx?.[HARNESS];
      let step = "deadline";
      let steps = [];
      try { step = h?.currentStep() || h?.lastStep() || "deadline"; steps = h ? h.steps() : []; h?.abort("run cut"); } catch { /* ignore */ }
      e.result = {
        beatId: e.beat.id, ok: false, step: String(step),
        detail: cutDetail(B.beats),
        ms: null, steps, skipped: [], notRun: [], evidence: null, box: null
      };
    }
    const results = entries.map((e) => e.result);

    // 6. Close the box (ROLLBACK, then destroy). Capped, so a stuck statement cannot eat the text's time.
    let boxReport = null;
    if (box) {
      const closed = await settle(box.close({ timedOut: cut > 0 }), B.boxClose);
      boxReport = closed.ok ? closed.value : { ...box.report(), closeTimedOut: true };
    }

    // 7. Decide, and SEND THE TEXT (before any record is written).
    const plan = decide({ results, open, prev, beatsById, now, dbDown: !dbUp || Boolean(boxProblem) });
    const textBudget = Math.max(B.minText, Math.min(B.alerts, t0 + B.run - Date.now()));
    const sent = await act(plan, { env, sinks: theSinks, beatsById, capMs: textBudget, now });

    // 8. Records (live only, best effort, own cap). Never inside the box, never before the text.
    const records = { written: false, error: null };
    let incidents = null;
    if (!live) {
      records.error = `mode ${mode}: nothing is written`;
    } else if (!dbUp || !orgId) {
      records.error = "the database is not answering; nothing was saved";
    } else {
      // Only a beat that DECLARES it needs bank links may write them (a stray bankLinks field in some other
      // beat's evidence must never overwrite the saved state).
      const linkBeats = new Set(list.filter((b) => Array.isArray(b.needs) && b.needs.includes("bankLinks")).map((b) => b.id));
      const links = results.flatMap((r) => (linkBeats.has(r.beatId) && r.evidence && Array.isArray(r.evidence.bankLinks) ? r.evidence.bankLinks : []));
      const saved = await settle(Promise.all([
        writeBeatResults(rdb, { orgId, runId, results }),
        links.length ? upsertBankLinks(rdb, { orgId, rows: links }) : Promise.resolve({ ok: true }),
        saveIncidents(plan, { rdb, orgId, runId, delivered: sent.delivered, held: Boolean(sent.held) })
      ]), B.records);
      if (!saved.ok) {
        records.error = saved.timedOut ? `records took more than ${B.records} ms` : say(saved.error);
      } else {
        const [beatRows, linkRows, inc] = saved.value;
        incidents = inc;
        const bad = [beatRows, linkRows].find((x) => x && x.ok === false);
        if (bad) records.error = bad.missingTable ? "the pulse tables are not there yet (migration 475 not applied)" : String(bad.error || "records failed");
        else records.written = true;
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    const problems = [];
    if (live && !records.written) problems.push(`records: ${records.error}`);
    if (sent.due && !sent.delivered && !sent.held) problems.push(sent.error || "alert due but not delivered");
    const out = {
      ok: problems.length === 0,
      runId,
      ran: results.length,
      failed,
      timedOut: cut,
      results: results.map(slim),
      records,
      alerts: {
        texts: sent.texts,
        issues: [],
        ntfy: sent.ntfy,
        error: sent.error,
        due: sent.due,
        delivered: sent.delivered,
        held: Boolean(sent.held),
        body: sent.body,
        newBreaks: plan.newBreaks.map((e) => e.beatId),
        stillBroken: plan.stillBroken.map((e) => e.beatId),
        healed: plan.healed.map((e) => e.beatId),
        healedQuiet: plan.healedQuiet.map((e) => e.beatId),
        damped: plan.damped.map((e) => e.beatId),
        quiet: plan.quiet.map((e) => e.beatId),
        storm: plan.storm,
        incidents
      },
      dbUp,
      box: boxReport,
      ms: elapsed()
    };
    if (problems.length) out.error = problems.join("; ").slice(0, 300);
    return out;
  } catch (err) {
    return emptyResult(runId, { ok: false, error: `the runner crashed: ${cleanLine(redact((err && err.message) || err), 200)}`, ms: elapsed() });
  }
}

/** What a beat that was still running at the cut is recorded as. */
export function cutDetail(budgetMs) {
  return `cut at the ${budgetMs >= 1000 ? `${Math.round(budgetMs / 1000)} s` : `${budgetMs} ms`} beat budget`;
}

function failedResult(beatId, step, detail) {
  return { beatId, ok: false, step, detail: redact(detail).slice(0, 300), ms: 0, steps: [], skipped: [], notRun: [], evidence: null, box: null };
}

/** The small summary the scheduled function answers with. Counts only: no beat names, no details. */
export function publicSummary(result) {
  const r = result && typeof result === "object" ? result : {};
  const out = {
    ok: r.ok === true,
    ran: Number.isInteger(r.ran) ? r.ran : 0,
    failed: Number.isInteger(r.failed) ? r.failed : 0,
    timedOut: Number.isInteger(r.timedOut) ? r.timedOut : 0,
    ms: Number.isFinite(r.ms) ? Math.round(r.ms) : null
  };
  if (r.error) out.error = redact(String(r.error)).replace(/\s+/g, " ").slice(0, 160);
  return out;
}
