// @ts-check
// src/marketing/planner.mjs — the planner. It "reads the room" (last week's spend by
// funnel and by angle, Chris's waiting ideas, the angle list, the competitor board) and
// lays out the next batch slot by slot, every slot with a plain reason.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.5 (all of it), §2 items 2, 3 and 5,
// Appendix A rule 34. Plan unit U23. Answer shape: docs/specs/marketing-machine-api.md
// §6.4 (GET/POST marketing/batches/next).
//
// PURE. planBatch(input) takes plain data and returns the plan: no clock (the caller
// passes `now`), no database, no network, no model. The database half is
// src/marketing/planner-data.mjs (gatherPlanInputs, savePlan), which runs inside a staff
// transaction. U35's start_batch job calls gatherPlanInputs -> planBatch -> savePlan.
//
// THE STEPS (spec §7.5, in its order)
//   1. Total. size_rule 'total': scripts_per_day x days_per_batch (21 by default).
//      'per_funnel': that, times the funnels in play. A one-time override
//      (next_overrides.total) replaces it for the next weekly batch. Write now brings its
//      own count.
//   2. Funnels in play: active funnels with spend in the last 7 Arizona days. When nothing
//      spent, every active funnel.
//   3. Spend -> funnel: the ad NUMBER's live script names a funnel (ads.fundhub_ad_number
//      = ad_scripts.ad_id, archived_at NULL) first; else the Meta campaign the ad sits in
//      is on a funnel's meta_campaign_ids; else the spend is "Unmapped". Same rule as
//      U32's GET marketing/funnels/stats (src/marketing/metrics-rollups.mjs).
//   4. Split: the total by spend share x weight (largest remainder). Each funnel gets at
//      least one day's worth (scripts_per_day) when that fits for every funnel.
//   5. Fill each funnel's slots, in this order:
//        a. Chris's ideas (source chris or suggestion, status new, not held by a batch);
//        b. follow the money: new versions of the angles with the most spend on that
//           funnel, at most 40% of the funnel's slots, each a new hook AND a new body
//           (Appendix A rule 34). The winner rule replaces "most spend" once it exists;
//        c. fresh angles from marketing/ads/angles.json not used in 30 days;
//        d. new entrants from the competitor board (api/adintel/board.mjs), only when it
//           has rows;
//        e. what is left: a new angle the writer picks (the spec's "or a new angle the
//           writer proposes", kept last so the board still gets its turn).
//   6. Formats come from each funnel's format_mix. Long ads only from Chris's ideas with
//      points. VSLs only on command.
//   7. Every slot has a reason, and the plan carries 3 angle suggestions with numbers.
//
// READINGS WRITTEN DOWN (the owner was asleep; each is the safe default and is on the
// board for him):
//   * WINNER RULE. The spec leaves its shape blank ("a blank setting Chris fills in
//     later", §2 item 5). Nothing can read a rule that has no shape, so follow the money
//     ranks by spend whether winner_rule is set or not. When the rule gets a shape, it
//     plugs in at rankFollowMoney().
//   * "NOT RUN IN 30 DAYS". An angle counts as used in the last 30 Arizona days when an
//     ad with that angle spent then, OR a script with that angle was written then (not
//     an import), OR an unreleased batch's plan names it. Without the last two, the
//     angles the machine wrote last Monday (not filmed yet, so not spending) would come
//     back as "fresh" every week.
//   * AN IDEA NAMING A FUNNEL WITH NO SPEND. Chris's word beats a written rule (spec top
//     rule), so his idea still gets written: that active funnel joins the plan with one
//     slot per such idea, taken off the total before the split. An idea naming a funnel
//     that is turned off or does not exist waits in the inbox, as does a VSL idea on a
//     weekly batch (VSLs only on command) and any idea past the batch size.
//   * per_funnel. The total grows with the funnels in play (§7.5 step 1); the split
//     still follows spend share x weight (§7.5 step 4 applies to both rules).
//   * Overrides apply to the next WEEKLY batch only (spec §7.5 last line: "Chris's
//     changes go into next_overrides"). Write now brings its own count and funnel.
//
// NULL MEANS UNKNOWN, NEVER 0 (CLAUDE.md §12). A funnel or angle with no saved ad-day in
// the window has spend null, unless every saved ad-day was placed somewhere else (then a
// known 0). Money is integer cents. Days are Arizona days (src/lib/ad-account-day.mjs).

import { adAccountDay, AD_ACCOUNT_TZ } from "../lib/ad-account-day.mjs";
import { addDays } from "../metro2/dates.mjs";
import { isoWeek } from "../creative-intel/weekly.mjs";
import { normaliseLabelKey, isLabelKey, friendlyName } from "../ads/label-keys.mjs";
import { cpl } from "./metrics.mjs";
import { formatPrice } from "./writer-prompt.mjs";
import { DEFAULT_STYLE } from "../../marketing/ads/rules-data.mjs";

/* ── words and limits ───────────────────────────────────────────────────── */

/** Where a slot came from (API contract §6.4). */
export const SLOT_SOURCES = Object.freeze(["chris_idea", "follow_money", "fresh_angle", "competitor"]);
/** The script formats, in the order format_style lists them (spec §6 Step 3). */
export const PLAN_FORMATS = Object.freeze(["standard", "sorting", "long", "notes", "greenscreen", "vsl"]);
const STYLES = Object.freeze(["bullets", "words"]);
/** Spend share follows the last 7 Arizona days, today included (spec §2 item 3). */
export const SPEND_DAYS = 7;
/** A fresh angle has not been used in this many Arizona days (spec §7.5 step 5.3). */
export const FRESH_DAYS = 30;
/** Follow the money takes at most this share of a funnel's slots (spec §7.5 step 5.2). */
export const FOLLOW_MONEY_SHARE = 0.4;
/** The plan carries this many angle suggestions (spec §7.5 step 7). */
export const SUGGESTION_COUNT = 3;
/** One-time changes Chris can save for the next weekly batch (next_overrides). */
export const OVERRIDE_KEYS = Object.freeze(["total", "funnel_slots", "skip_angles"]);
export const MAX_OVERRIDE_TOTAL = 100;
export const MAX_OVERRIDE_FUNNEL_SLOTS = 100;
export const MAX_SKIP_ANGLES = 100;
/** Competitor board weeks older than this many days are old news, not "new entrants". */
export const COMPETITOR_MAX_AGE_DAYS = 14;

const FUNNEL_KEY_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;
const HHMM_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── types ──────────────────────────────────────────────────────────────── */

/**
 * @typedef {{ key: string, name?: string|null, active?: boolean|null,
 *             weight?: number|string|null, format_mix?: Record<string, number>|null,
 *             book_call?: boolean|null }} FunnelIn
 * @typedef {{ ad_row_id: string, ad_number?: string|null, script_funnel_key?: string|null,
 *             script_angle_key?: string|null, spine_angle_key?: string|null,
 *             campaign_funnel_key?: string|null, spend_7d_cents?: number|string|null,
 *             ad_days_7d?: number|string|null, last_spend_day?: string|null }} AdRowIn
 * @typedef {{ ad_number: string|number|null, leads?: number|string|null }} LeadRowIn
 * @typedef {{ ad_number: string|number|null, funnel_key?: string|null, angle_key?: string|null }} ScriptLabelIn
 * @typedef {{ angle_key: string, last_used_on: string }} RecentAngleIn
 * @typedef {{ key: string, name?: string|null }} AngleIn
 * @typedef {{ id: string, source?: string|null, raw_points?: string|null, topic?: string|null,
 *             script_format?: string|null, funnel_key?: string|null, angle_key?: string|null,
 *             created_at?: string|Date|null }} IdeaIn
 * @typedef {{ advertiser_id: string, name?: string|null, platform?: string|null,
 *             creatives?: number|string|null, angle?: string|null }} CompetitorIn
 * @typedef {{ count?: number|null, funnel_key?: string|null, idea_ids?: string[]|null }} OnCommand
 * @typedef {{ total?: number, funnel_slots?: Record<string, number>, skip_angles?: string[] }} Overrides
 * @typedef {{ scripts_per_day?: number|null, days_per_batch?: number|null, size_rule?: string|null,
 *             format_style?: Record<string, string>|null, winner_rule?: any,
 *             batch_weekday?: number|null, batch_time?: string|null, timezone?: string|null }} SettingsIn
 *
 * @typedef {{
 *   now?: Date|string,
 *   settings?: SettingsIn,
 *   funnels?: FunnelIn[],
 *   ad_rows?: AdRowIn[],
 *   lead_rows?: LeadRowIn[],
 *   script_labels?: ScriptLabelIn[],
 *   recent_angles?: RecentAngleIn[],
 *   angles?: AngleIn[],
 *   ideas?: IdeaIn[],
 *   competitors?: CompetitorIn[],
 *   overrides?: Overrides|null,
 *   on_command?: OnCommand|null
 * }} PlanInput
 *
 * @typedef {{ n: number, funnel_key: string, script_format: string, style: string,
 *             source: string, angle_key: string|null, idea_id: string|null, reason: string }} Slot
 * @typedef {{ funnel_key: string, name: string, spend_7d_cents: number|null, share: number|null,
 *             slots: number }} FunnelPlan
 * @typedef {{ angle_key: string, name: string, why: string, last_ran_on: string|null,
 *             numbers: { spend_7d_cents: number|null, leads: number|null, cpl_cents: number|null } }} Suggestion
 * @typedef {{ total: number, size_rule: string, funnels: FunnelPlan[], slots: Slot[],
 *             suggestions: Suggestion[], unmapped_spend_cents: number|null,
 *             overrides: Overrides|null }} Plan
 *
 * @typedef {{ ad_row_id: string, ad_number: string|null, funnel_key: string|null,
 *             angle_key: string|null, spend_7d_cents: number|null, ad_days_7d: number,
 *             last_spend_day: string|null }} AdRow
 */

/* ── small helpers ──────────────────────────────────────────────────────── */

/** A count or an amount, or null when it is not known. pg sends bigint as text.
    @param {unknown} v @returns {number|null} */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A whole number above 0, else the default. @param {unknown} v @param {number} d */
function positiveInt(v, d) {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : d;
}

/** a + b where b may be unknown: unknown adds nothing; unknown + unknown stays unknown.
    @param {number|null} a @param {unknown} b @returns {number|null} */
function addKnown(a, b) {
  const n = num(b);
  return n === null ? a : (a ?? 0) + n;
}

/** Rounded to four places, like src/marketing/metrics.mjs fraction(). @param {number} x */
const round4 = (x) => Math.round(x * 10_000) / 10_000;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** "2026-09-28" → "Sep 28". @param {string|null} day */
export function dayWords(day) {
  if (!day || !DAY_RE.test(day)) return null;
  const m = Number(day.slice(5, 7));
  return `${MONTHS[m - 1]} ${Number(day.slice(8, 10))}`;
}

/** A timestamp → its Arizona day, "YYYY-MM-DD". @param {unknown} v */
function arizonaDay(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && DAY_RE.test(v)) return v;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : adAccountDay(d);
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "the most", "the 2nd most", "the 3rd most". @param {number} rank 1-based */
function rankWords(rank) {
  if (rank === 1) return "the most";
  const tail = rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[rank % 10] || "th";
  return `the ${rank}${tail} most`;
}

/** Integer cents → "$412.00" (always two places in a reason), or null when unknown.
    @param {number|null} cents */
function dollars(cents) {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return null;
  const whole = formatPrice(Math.round(cents));
  if (whole === null) return null;
  return whole.includes(".") ? whole : `${whole}.00`;
}

/* ── time: the next release and its week ───────────────────────────────── */

/** Wall-clock parts of `date` in `tz`. @param {Date} date @param {string} tz */
function zonedParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
  });
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second), weekday
  };
}

/** How far `tz` is ahead of UTC at instant `ms`, in ms. @param {number} ms @param {string} tz */
function zoneOffset(ms, tz) {
  const p = zonedParts(new Date(ms), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - (ms - (ms % 1000));
}

/** A wall-clock time in `tz` → the instant. Days past the month end roll over.
    @param {{y:number, m:number, d:number, hh:number, mm:number}} wall @param {string} tz */
function wallToInstant({ y, m, d, hh, mm }, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let at = guess - zoneOffset(guess, tz);
  const again = guess - zoneOffset(at, tz);
  if (again !== at) at = again;
  return new Date(at);
}

/** A usable IANA zone, else the ad account's (America/Phoenix). @param {unknown} tz */
function zoneOrDefault(tz) {
  if (typeof tz === "string" && tz.trim()) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { /* fall through */ }
  }
  return AD_ACCOUNT_TZ;
}

/**
 * The next weekly drop strictly after `now`: batch_weekday (0 = Sunday) at batch_time in
 * the settings time zone. Monday 07:00 America/Phoenix is 14:00 UTC every week.
 * (Plan unit U35's contract names this function for its schedule; U35 may move it into
 * src/marketing/schedule.mjs and import it back here.)
 * @param {SettingsIn|null|undefined} settings @param {Date|string} [now]
 * @returns {Date}
 */
export function nextReleaseAt(settings, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  const tz = zoneOrDefault(settings && settings.timezone);
  const wdRaw = num(settings && settings.batch_weekday);
  const weekday = wdRaw !== null && Number.isInteger(wdRaw) && wdRaw >= 0 && wdRaw <= 6 ? wdRaw : 1;
  const t = HHMM_RE.exec(String((settings && settings.batch_time) || "07:00")) || HHMM_RE.exec("07:00");
  const hh = Number(/** @type {RegExpExecArray} */ (t)[1]);
  const mm = Number(/** @type {RegExpExecArray} */ (t)[2]);
  const p = zonedParts(at, tz);
  const ahead = (weekday - p.weekday + 7) % 7;
  let release = wallToInstant({ y: p.y, m: p.m, d: p.d + ahead, hh, mm }, tz);
  if (release.getTime() <= at.getTime()) release = wallToInstant({ y: p.y, m: p.m, d: p.d + ahead + 7, hh, mm }, tz);
  return release;
}

/**
 * The ISO week of `releaseAt` in the settings time zone, written YYYY-Www — the
 * marketing_batches.week_key rule (414) and the same answer as Postgres
 * to_char(release_at AT TIME ZONE tz, 'IYYY-"W"IW').
 * @param {Date|string} releaseAt @param {string|null|undefined} tz
 */
export function weekKey(releaseAt, tz) {
  const at = releaseAt instanceof Date ? releaseAt : new Date(releaseAt);
  const p = zonedParts(at, zoneOrDefault(tz));
  // isoWeek reads the UTC calendar day, so hand it the local day at UTC midnight.
  return isoWeek(new Date(Date.UTC(p.y, p.m - 1, p.d)));
}

/** The Arizona windows the plan reads. @param {Date|string} [now] */
export function planWindows(now = new Date()) {
  const today = adAccountDay(now instanceof Date ? now : new Date(now));
  return {
    today,
    spendFrom: /** @type {string} */ (addDays(today, -(SPEND_DAYS - 1))),
    freshFrom: /** @type {string} */ (addDays(today, -(FRESH_DAYS - 1)))
  };
}

/* ── overrides (next_overrides) ─────────────────────────────────────────── */

/**
 * Checks one-time changes from POST marketing/batches/next. Pure. {} (or every key
 * empty) clears them: value null.
 *   total         whole number 1..100: the size of the next weekly batch
 *   funnel_slots  {funnel_key: whole number 0..100}: that funnel gets exactly this many
 *                 (0 = leave it out this time); the rest is split as usual
 *   skip_angles   [angle_key]: the planner leaves these angles out this time (Chris's own
 *                 ideas with that angle are still written)
 * @param {unknown} o
 * @returns {{ ok: true, value: Overrides|null } | { ok: false, field: string, message: string }}
 */
export function checkOverrides(o) {
  if (!isPlainObject(o)) {
    return { ok: false, field: "overrides", message: "overrides must be an object. Send {} to clear them." };
  }
  /** @type {Overrides} */
  const out = {};
  for (const k of Object.keys(o)) {
    if (!OVERRIDE_KEYS.includes(k)) {
      return { ok: false, field: `overrides.${k}`, message: `"${k}" is not a change the planner takes. It takes: ${OVERRIDE_KEYS.join(", ")}.` };
    }
  }
  if (o.total !== undefined && o.total !== null) {
    const t = o.total;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > MAX_OVERRIDE_TOTAL) {
      return { ok: false, field: "overrides.total", message: `total must be a whole number from 1 to ${MAX_OVERRIDE_TOTAL}.` };
    }
    out.total = t;
  }
  if (o.funnel_slots !== undefined && o.funnel_slots !== null) {
    if (!isPlainObject(o.funnel_slots)) {
      return { ok: false, field: "overrides.funnel_slots", message: `funnel_slots must be an object like {"book_call": 7}.` };
    }
    /** @type {Record<string, number>} */
    const slots = {};
    for (const [key, n] of Object.entries(o.funnel_slots)) {
      if (!FUNNEL_KEY_RE.test(key)) {
        return { ok: false, field: `overrides.funnel_slots.${key}`, message: `"${key}" is not a funnel key.` };
      }
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_OVERRIDE_FUNNEL_SLOTS) {
        return { ok: false, field: `overrides.funnel_slots.${key}`, message: `The count for ${key} must be a whole number from 0 to ${MAX_OVERRIDE_FUNNEL_SLOTS}.` };
      }
      slots[key] = n;
    }
    if (Object.keys(slots).length) out.funnel_slots = slots;
  }
  if (out.total !== undefined && out.funnel_slots) {
    const pinned = Object.values(out.funnel_slots).reduce((a, b) => a + b, 0);
    if (pinned > out.total) {
      return { ok: false, field: "overrides.funnel_slots", message: `Those funnels add up to ${pinned} scripts, more than the total of ${out.total}.` };
    }
  }
  if (o.skip_angles !== undefined && o.skip_angles !== null) {
    if (!Array.isArray(o.skip_angles) || o.skip_angles.length > MAX_SKIP_ANGLES) {
      return { ok: false, field: "overrides.skip_angles", message: `skip_angles must be a list of angle keys (up to ${MAX_SKIP_ANGLES}).` };
    }
    /** @type {string[]} */
    const keys = [];
    for (const a of o.skip_angles) {
      const k = typeof a === "string" ? normaliseLabelKey(a) : null;
      if (!k || !isLabelKey(k)) {
        return { ok: false, field: "overrides.skip_angles", message: `"${String(a)}" is not an angle key (like two_files).` };
      }
      if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length) out.skip_angles = keys;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

/** Saved overrides, read leniently: a bad part is dropped, never a crash. @param {unknown} o */
export function cleanOverrides(o) {
  if (!isPlainObject(o)) return null;
  /** @type {Record<string, any>} */
  const keep = {};
  for (const k of OVERRIDE_KEYS) {
    if (o[k] === undefined || o[k] === null) continue;
    const one = checkOverrides({ [k]: o[k] });
    if (one.ok && one.value) Object.assign(keep, one.value);
  }
  return Object.keys(keep).length ? /** @type {Overrides} */ (keep) : null;
}

/* ── step 3: which funnel and which angle each ads row belongs to ──────── */

/**
 * resolveAdRows(rows, funnelKeys) → one row per ads row with its funnel and angle.
 * Funnel: the number's live script's funnel_key when it names a funnel of the company,
 * else the funnel the ad's campaign is mapped to, else null (Unmapped).
 * Angle: the number's live script's angle_key, else the label the ad inherits through
 * v_ad_label_spine (ads → creative_assets → the creative's script).
 * @param {AdRowIn[]} [rows] @param {Set<string>} [funnelKeys]
 * @returns {AdRow[]}
 */
export function resolveAdRows(rows = [], funnelKeys = new Set()) {
  return rows.map((r) => {
    const scriptFunnel = r.script_funnel_key && funnelKeys.has(r.script_funnel_key) ? r.script_funnel_key : null;
    const campaignFunnel = r.campaign_funnel_key && funnelKeys.has(r.campaign_funnel_key) ? r.campaign_funnel_key : null;
    const last = r.last_spend_day ? String(r.last_spend_day).slice(0, 10) : null;
    return {
      ad_row_id: String(r.ad_row_id),
      ad_number: r.ad_number === null || r.ad_number === undefined ? null : String(r.ad_number),
      funnel_key: scriptFunnel ?? campaignFunnel,
      angle_key: normaliseLabelKey(r.script_angle_key) ?? normaliseLabelKey(r.spine_angle_key),
      spend_7d_cents: num(r.spend_7d_cents),
      ad_days_7d: num(r.ad_days_7d) ?? 0,
      last_spend_day: last && DAY_RE.test(last) ? last : null
    };
  });
}

/** @param {Set<string>|undefined} set */
const onlyOne = (set) => (set && set.size === 1 ? [...set][0] : null);

/**
 * leadsByAngle(leadRows, scriptLabels, ads) → Map angle_key → leads in the window.
 * A number's angle: its live script's angle_key, else the one angle all of its ads rows
 * agree on, else none (never a guess between two).
 * @param {LeadRowIn[]} [leadRows] @param {ScriptLabelIn[]} [scriptLabels] @param {AdRow[]} [ads]
 * @returns {Map<string, number>}
 */
export function leadsByAngle(leadRows = [], scriptLabels = [], ads = []) {
  /** @type {Map<string, string|null>} */
  const scriptAngle = new Map();
  for (const s of scriptLabels) {
    if (s && s.ad_number !== null && s.ad_number !== undefined) scriptAngle.set(String(s.ad_number), normaliseLabelKey(s.angle_key));
  }
  /** @type {Map<string, Set<string>>} */
  const seen = new Map();
  for (const a of ads) {
    if (!a.ad_number || !a.angle_key) continue;
    const set = seen.get(a.ad_number) ?? new Set();
    set.add(a.angle_key);
    seen.set(a.ad_number, set);
  }
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const l of leadRows) {
    const n = l && l.ad_number !== null && l.ad_number !== undefined ? String(l.ad_number) : null;
    const leads = num(l && l.leads);
    if (!n || leads === null || leads <= 0) continue;
    const angle = scriptAngle.get(n) ?? onlyOne(seen.get(n));
    if (!angle) continue;
    out.set(angle, (out.get(angle) ?? 0) + leads);
  }
  return out;
}

/**
 * spendByFunnel(ads) → { spendOf(key), unmapped_spend_cents, total_ad_days }
 * Each ads row's 7-day spend goes to its funnel or to Unmapped. A funnel with no placed
 * ad-day reads null, or a known 0 when every saved ad-day was placed elsewhere.
 * Unmapped reads null when the window has no saved ad-day at all.
 * @param {AdRow[]} ads
 */
export function spendByFunnel(ads) {
  /** @type {Map<string, {cents: number|null, days: number}>} */
  const byFunnel = new Map();
  const unmapped = { cents: /** @type {number|null} */ (null), days: 0 };
  let totalDays = 0;
  for (const a of ads) {
    const days = a.ad_days_7d || 0;
    if (days <= 0) continue;
    totalDays += days;
    let target = unmapped;
    if (a.funnel_key) {
      target = byFunnel.get(a.funnel_key) ?? { cents: null, days: 0 };
      byFunnel.set(a.funnel_key, target);
    }
    target.cents = addKnown(target.cents, a.spend_7d_cents);
    target.days += days;
  }
  const allPlaced = totalDays > 0 && unmapped.days === 0;
  return {
    /** @param {string} key @returns {number|null} */
    spendOf(key) {
      const s = byFunnel.get(key);
      return s && s.days > 0 ? s.cents : (allPlaced ? 0 : null);
    },
    unmapped_spend_cents: totalDays === 0 ? null : (unmapped.days > 0 ? unmapped.cents : 0),
    total_ad_days: totalDays
  };
}

/* ── step 4: the split ─────────────────────────────────────────────────── */

/**
 * splitSlots(R, funnels, perDay) → Map key → slots. R slots go to the funnels by score
 * (spend share x weight; equal shares when nothing spent) with the largest-remainder
 * rule. When every funnel can have a whole day (perDay each fits in R), a funnel below
 * one day takes slots from the funnel with the most above a day.
 * @param {number} R
 * @param {Array<{ key: string, spend: number|null, weight: number }>} funnels
 * @param {number} perDay
 * @returns {Map<string, number>}
 */
export function splitSlots(R, funnels, perDay) {
  /** @type {Map<string, number>} */
  const out = new Map(funnels.map((f) => [f.key, 0]));
  if (R <= 0 || funnels.length === 0) return out;
  const totalSpend = funnels.reduce((t, f) => t + (f.spend && f.spend > 0 ? f.spend : 0), 0);
  let scores = funnels.map((f) => {
    const share = totalSpend > 0 ? (f.spend && f.spend > 0 ? f.spend : 0) / totalSpend : 1 / funnels.length;
    return share * Math.max(0, f.weight);
  });
  if (!scores.some((s) => s > 0)) scores = funnels.map(() => 1);
  const S = scores.reduce((a, b) => a + b, 0);
  const rows = funnels.map((f, i) => {
    const q = (R * scores[i]) / S;
    return { key: f.key, score: scores[i], base: Math.floor(q), frac: q - Math.floor(q) };
  });
  let left = R - rows.reduce((t, r) => t + r.base, 0);
  const byRemainder = [...rows].sort((a, b) => b.frac - a.frac || b.score - a.score || (a.key < b.key ? -1 : 1));
  for (const r of byRemainder) {
    if (left <= 0) break;
    r.base += 1;
    left -= 1;
  }
  const floor = funnels.length * perDay <= R ? perDay : 0;
  if (floor > 0) {
    const needy = [...rows].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    for (const r of needy) {
      while (r.base < floor) {
        const donor = rows
          .filter((d) => d !== r && d.base > floor)
          .sort((a, b) => b.base - a.base || a.score - b.score || (a.key < b.key ? 1 : -1))[0];
        if (!donor) break;
        donor.base -= 1;
        r.base += 1;
      }
    }
  }
  for (const r of rows) out.set(r.key, r.base);
  return out;
}

/* ── step 6: formats ───────────────────────────────────────────────────── */

/**
 * The formats the machine may pick for a funnel, with their weights: format_mix minus
 * 'long' (only Chris's ideas with points) and minus 'vsl' unless on command. Nothing
 * usable → standard.
 * @param {Record<string, number>|null|undefined} mix @param {boolean} onCommand
 * @returns {Array<[string, number]>}
 */
export function machineFormats(mix, onCommand) {
  /** @type {Array<[string, number]>} */
  const out = [];
  for (const f of PLAN_FORMATS) {
    if (f === "long" || (f === "vsl" && !onCommand)) continue;
    const w = num(mix && isPlainObject(mix) ? mix[f] : null);
    if (w !== null && w > 0) out.push([f, w]);
  }
  return out.length ? out : [["standard", 1]];
}

/**
 * n formats from the weights, spread out (smooth weighted round robin), so a
 * {standard:2, sorting:1} funnel reads standard, sorting, standard, standard, sorting...
 * @param {Array<[string, number]>} weights @param {number} n @returns {string[]}
 */
export function spreadFormats(weights, n) {
  const total = weights.reduce((t, [, w]) => t + w, 0);
  const current = weights.map(() => 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let j = 0; j < weights.length; j++) {
      current[j] += weights[j][1];
      if (current[j] > current[best]) best = j;
    }
    current[best] -= total;
    out.push(weights[best][0]);
  }
  return out;
}

/** The style for a format: the settings' format_style, else the default. @param {SettingsIn} settings @param {string} format */
function styleFor(settings, format) {
  const s = settings && isPlainObject(settings.format_style) ? settings.format_style[format] : null;
  if (typeof s === "string" && STYLES.includes(s)) return s;
  return /** @type {Record<string, string>} */ (DEFAULT_STYLE)[format] || "words";
}

/* ── the plan ──────────────────────────────────────────────────────────── */

/**
 * planBatch(input) → the plan (spec §7.5). Pure and deterministic: the same input
 * always gives the same plan.
 * @param {PlanInput} input
 * @returns {Plan}
 */
export function planBatch(input) {
  const settings = input.settings || {};
  const now = input.now ?? new Date();
  const { freshFrom } = planWindows(now);
  const onCommand = input.on_command && isPlainObject(input.on_command) ? input.on_command : null;
  const overrides = onCommand ? null : cleanOverrides(input.overrides);
  const skip = new Set(overrides && overrides.skip_angles ? overrides.skip_angles : []);
  const perDay = positiveInt(settings.scripts_per_day, 3);
  const days = positiveInt(settings.days_per_batch, 7);
  const sizeRule = settings.size_rule === "per_funnel" ? "per_funnel" : "total";

  /* funnels */
  const allFunnels = (input.funnels || []).filter((f) => f && typeof f.key === "string");
  const funnelByKey = new Map(allFunnels.map((f) => [f.key, f]));
  const funnelKeys = new Set(funnelByKey.keys());
  const isActive = (/** @type {FunnelIn} */ f) => f.active !== false;
  const funnelName = (/** @type {string} */ key) => {
    const f = funnelByKey.get(key);
    return (f && typeof f.name === "string" && f.name.trim()) ? f.name.trim() : key;
  };
  const weightOf = (/** @type {string} */ key) => {
    const w = num(funnelByKey.get(key)?.weight);
    return w === null ? 1 : Math.max(0, w);
  };

  /* step 3: spend by funnel, by angle */
  const ads = resolveAdRows(input.ad_rows || [], funnelKeys);
  const money = spendByFunnel(ads);
  const angleNames = new Map();
  for (const a of input.angles || []) {
    const k = a && typeof a.key === "string" ? normaliseLabelKey(a.key) : null;
    if (k && isLabelKey(k) && !angleNames.has(k)) angleNames.set(k, (typeof a.name === "string" && a.name.trim()) ? a.name.trim() : friendlyName(k));
  }
  const angleName = (/** @type {string} */ k) => angleNames.get(k) ?? friendlyName(k) ?? k;

  /* step 2: funnels in play */
  const active = allFunnels.filter(isActive);
  let inPlay;
  if (onCommand && onCommand.funnel_key) {
    const f = funnelByKey.get(onCommand.funnel_key);
    inPlay = f ? [f] : [];
  } else {
    const spent = active.filter((f) => (money.spendOf(f.key) ?? 0) > 0);
    inPlay = spent.length ? spent : active;
  }
  const inPlayKeys = new Set(inPlay.map((f) => f.key));

  /* step 1: total */
  let total;
  if (onCommand) total = positiveInt(onCommand.count, perDay);
  else if (overrides && overrides.total) total = overrides.total;
  else total = perDay * days * (sizeRule === "per_funnel" ? inPlay.length : 1);

  /* ideas: who is eligible and where each one wants to go */
  const namedIds = onCommand && Array.isArray(onCommand.idea_ids) ? onCommand.idea_ids.map(String) : [];
  const ideas = [...(input.ideas || [])].filter((i) => i && i.id).sort((a, b) => {
    const na = namedIds.indexOf(String(a.id));
    const nb = namedIds.indexOf(String(b.id));
    if ((na >= 0) !== (nb >= 0)) return na >= 0 ? -1 : 1;
    if (na >= 0 && nb >= 0) return na - nb;
    const ta = timeMs(a.created_at);
    const tb = timeMs(b.created_at);
    return ta - tb || (String(a.id) < String(b.id) ? -1 : 1);
  });
  /** @type {Array<{ idea: IdeaIn, format: string|null, funnel: string|null }>} */
  const eligible = [];
  for (const idea of ideas) {
    let format = typeof idea.script_format === "string" && PLAN_FORMATS.includes(idea.script_format) ? idea.script_format : null;
    if (format === "vsl" && !onCommand) continue;                 // VSLs only on command
    const hasPoints = typeof idea.raw_points === "string" && idea.raw_points.trim() !== "";
    if (format === "long" && !hasPoints) format = null;            // long only with points
    let funnel = null;
    if (idea.funnel_key) {
      const f = funnelByKey.get(idea.funnel_key);
      if (!f) continue;                                            // no such funnel: waits
      if (onCommand && onCommand.funnel_key) {
        if (f.key !== onCommand.funnel_key) continue;              // Write now for another funnel
      } else if (!isActive(f)) continue;                           // turned off: waits
      funnel = f.key;
    } else if (onCommand && onCommand.funnel_key) {
      funnel = onCommand.funnel_key;
    }
    eligible.push({ idea, format, funnel });
  }

  /* step 4: pins (Chris's one-time funnel counts, then his ideas' own funnels), split */
  /** @type {Map<string, number>} */
  const pins = new Map();
  if (overrides && overrides.funnel_slots) {
    for (const [key, n] of Object.entries(overrides.funnel_slots)) {
      const f = funnelByKey.get(key);
      if (f && isActive(f)) pins.set(key, n);
    }
  }
  const pinnedTotal = () => [...pins.values()].reduce((a, b) => a + b, 0);
  if (pinnedTotal() > total) total = pinnedTotal();
  if (!(onCommand && onCommand.funnel_key)) {
    /** @type {Map<string, number>} */
    const wantIdeas = new Map();
    for (const e of eligible) {
      if (e.funnel && !inPlayKeys.has(e.funnel) && !pins.has(e.funnel)) wantIdeas.set(e.funnel, (wantIdeas.get(e.funnel) ?? 0) + 1);
    }
    for (const [key, n] of [...wantIdeas].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const room = total - pinnedTotal();
      if (room <= 0) break;
      pins.set(key, Math.min(n, room));
    }
  }
  const free = inPlay.filter((f) => !pins.has(f.key));
  const split = splitSlots(
    Math.max(0, total - pinnedTotal()),
    free.map((f) => ({ key: f.key, spend: money.spendOf(f.key), weight: weightOf(f.key) })),
    perDay
  );
  /** @type {Map<string, number>} */
  const alloc = new Map([...pins, ...split]);

  /* the funnels list: funnels that get slots first (most slots first), then the rest */
  const activeSpend = active.reduce((t, f) => t + Math.max(0, money.spendOf(f.key) ?? 0), 0);
  const order = [...alloc.keys()].filter((k) => (alloc.get(k) ?? 0) > 0).sort((a, b) =>
    (alloc.get(b) ?? 0) - (alloc.get(a) ?? 0) ||
    (money.spendOf(b) ?? -1) - (money.spendOf(a) ?? -1) ||
    (a < b ? -1 : 1));
  const shown = [...order, ...active.map((f) => f.key).filter((k) => !order.includes(k)).sort()];

  /** @type {Map<string, Array<Omit<Slot, 'n'|'style'|'script_format'> & { script_format: string|null }>>} */
  const filled = new Map(order.map((k) => [k, []]));
  const room = (/** @type {string} */ k) => (alloc.get(k) ?? 0) - (filled.get(k)?.length ?? 0);
  /** @type {Set<string>} */
  const planAngles = new Set();

  /* 5a. Chris's ideas */
  for (const e of eligible) {
    let target = e.funnel;
    if (target) {
      if (!filled.has(target) || room(target) <= 0) continue;     // full: waits for the next batch
    } else {
      const open = order.filter((k) => room(k) > 0);
      if (!open.length) continue;
      target = open.sort((a, b) => room(b) - room(a) || (alloc.get(b) ?? 0) - (alloc.get(a) ?? 0) || (a < b ? -1 : 1))[0];
    }
    const angle = normaliseLabelKey(e.idea.angle_key);
    if (angle) planAngles.add(angle);
    /** @type {any} */ (filled.get(target)).push({
      funnel_key: target,
      script_format: e.format,
      source: "chris_idea",
      angle_key: angle && isLabelKey(angle) ? angle : null,
      idea_id: String(e.idea.id),
      reason: ideaReason(e.idea, target, inPlayKeys, funnelName)
    });
  }

  /* 5b. follow the money */
  for (const key of order) {
    const cap = Math.floor((alloc.get(key) ?? 0) * FOLLOW_MONEY_SHARE);
    const n = Math.min(cap, room(key));
    if (n <= 0) continue;
    const ranked = rankFollowMoney(ads, key, skip, settings.winner_rule);
    if (!ranked.length) continue;
    const copies = splitSlots(n, ranked.map((r) => ({ key: r.angle_key, spend: r.cents, weight: 1 })), 0);
    ranked.forEach((r, i) => {
      const m = copies.get(r.angle_key) ?? 0;
      for (let v = 1; v <= m; v++) {
        planAngles.add(r.angle_key);
        /** @type {any} */ (filled.get(key)).push({
          funnel_key: key,
          script_format: null,
          source: "follow_money",
          angle_key: r.angle_key,
          idea_id: null,
          reason: `${angleName(r.angle_key)} spent ${rankWords(i + 1)} on ${funnelName(key)} last week (${dollars(r.cents)}). ` +
            `New hook and new body.${m > 1 ? ` Version ${v} of ${m}.` : ""}`
        });
      }
    });
  }

  /* 5c. fresh angles, one per slot, taken in turn by each funnel */
  const usedOn = lastUsed(ads, input.recent_angles || []);
  const lastRan = lastRanByAngle(ads);
  const freshQueue = [...angleNames.keys()].filter((k) =>
    !skip.has(k) && !planAngles.has(k) && !((usedOn.get(k) ?? "") >= freshFrom));
  roundRobin(order, room, (key) => {
    const k = freshQueue.shift();
    if (!k) return false;
    planAngles.add(k);
    const ran = lastRan.get(k) ?? null;
    /** @type {any} */ (filled.get(key)).push({
      funnel_key: key,
      script_format: null,
      source: "fresh_angle",
      angle_key: k,
      idea_id: null,
      reason: ran ? `${angleName(k)} last ran ${dayWords(ran)}, not in the last 30 days.` : `${angleName(k)} has not run in 30 days.`
    });
    return true;
  });

  /* 5d. competitor new entrants, only when the board has rows */
  const entrants = (input.competitors || []).filter((c) => c && c.advertiser_id);
  roundRobin(order, room, (key) => {
    const c = entrants.shift();
    if (!c) return false;
    const who = (typeof c.name === "string" && c.name.trim()) ? c.name.trim() : "A new advertiser";
    const count = num(c.creatives);
    const theirAngle = typeof c.angle === "string" && c.angle.trim() ? c.angle.trim().replace(/_/g, " ") : null;
    /** @type {any} */ (filled.get(key)).push({
      funnel_key: key,
      script_format: null,
      source: "competitor",
      angle_key: null,
      idea_id: null,
      reason: `New on the competitor board this week: ${who}${count ? ` (${plural(count, "new ad")})` : ""}.` +
        `${theirAngle ? ` They lead with ${theirAngle}.` : ""} Write our own take on it, and never name them in the ad.`
    });
    return true;
  });

  /* 5e. the rest: the writer picks a new angle */
  for (const key of order) {
    while (room(key) > 0) {
      /** @type {any} */ (filled.get(key)).push({
        funnel_key: key,
        script_format: null,
        source: "fresh_angle",
        angle_key: null,
        idea_id: null,
        reason: angleNames.size
          ? "Every angle on the list was used in the last 30 days, so the writer picks a new angle."
          : "The angle list could not be read, so the writer picks the angle."
      });
    }
  }

  /* step 6: formats and styles, then number the slots */
  /** @type {Slot[]} */
  const slots = [];
  for (const key of order) {
    const list = filled.get(key) || [];
    const need = list.filter((s) => s.script_format === null).length;
    const picks = spreadFormats(machineFormats(funnelByKey.get(key)?.format_mix, !!onCommand), need);
    for (const s of list) {
      const format = s.script_format ?? /** @type {string} */ (picks.shift());
      slots.push({
        n: slots.length + 1,
        funnel_key: s.funnel_key,
        script_format: format,
        style: styleFor(settings, format),
        source: s.source,
        angle_key: s.angle_key,
        idea_id: s.idea_id,
        reason: s.reason
      });
    }
  }

  /* the funnels list */
  /** @type {FunnelPlan[]} */
  const funnels = shown.map((key) => {
    const spend = money.spendOf(key);
    return {
      funnel_key: key,
      name: funnelName(key),
      spend_7d_cents: spend,
      share: activeSpend > 0 && spend !== null ? round4(Math.max(0, spend) / activeSpend) : null,
      slots: alloc.get(key) ?? 0
    };
  });

  /* step 7: suggestions */
  const waitingAngles = new Set((input.ideas || []).map((i) => normaliseLabelKey(i && i.angle_key)).filter(Boolean));
  const suggestions = suggestAngles({
    ads, angleNames, angleName, skip, planAngles, waitingAngles, usedOn, lastRan, freshFrom,
    leads: leadsByAngle(input.lead_rows || [], input.script_labels || [], ads)
  });

  return {
    total: slots.length,
    size_rule: sizeRule,
    funnels,
    slots,
    suggestions,
    unmapped_spend_cents: money.unmapped_spend_cents,
    overrides
  };
}

/** ms of a time (0 when unknown, so unknown sorts first). @param {unknown} v */
function timeMs(v) {
  if (v === null || v === undefined || v === "") return 0;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Each funnel in `order` with room takes one item in turn until `take` says the
 * source is empty or every funnel is full.
 * @param {string[]} order @param {(k: string) => number} room @param {(k: string) => boolean} take
 */
function roundRobin(order, room, take) {
  for (;;) {
    let placed = false;
    for (const key of order) {
      if (room(key) <= 0) continue;
      if (!take(key)) return;
      placed = true;
    }
    if (!placed) return;
  }
}

/**
 * The angles to follow the money on, for one funnel: the angles with spend on that
 * funnel in the last 7 days, most first. Angles Chris skipped this time are left out.
 * winner_rule has no shape yet (spec §2 item 5), so spend decides either way.
 * @param {AdRow[]} ads @param {string} funnelKey @param {Set<string>} skip @param {any} _winnerRule
 * @returns {Array<{ angle_key: string, cents: number }>}
 */
export function rankFollowMoney(ads, funnelKey, skip, _winnerRule) {
  /** @type {Map<string, number>} */
  const by = new Map();
  for (const a of ads) {
    if (a.funnel_key !== funnelKey || !a.angle_key || !isLabelKey(a.angle_key) || skip.has(a.angle_key)) continue;
    if (!(a.ad_days_7d > 0) || a.spend_7d_cents === null) continue;
    by.set(a.angle_key, (by.get(a.angle_key) ?? 0) + a.spend_7d_cents);
  }
  return [...by].filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([angle_key, cents]) => ({ angle_key, cents }));
}

/**
 * The last Arizona day each angle was used: an ad with it spent, a script with it was
 * written, or an unreleased plan names it (the data layer sends the last two).
 * @param {AdRow[]} ads @param {RecentAngleIn[]} recent
 * @returns {Map<string, string>}
 */
function lastUsed(ads, recent) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const bump = (/** @type {string|null} */ k, /** @type {string|null} */ day) => {
    if (!k || !day || !DAY_RE.test(day)) return;
    if ((out.get(k) ?? "") < day) out.set(k, day);
  };
  for (const a of ads) bump(a.angle_key, a.last_spend_day);
  for (const r of recent) bump(normaliseLabelKey(r && r.angle_key), r ? arizonaDay(r.last_used_on) : null);
  return out;
}

/** The last Arizona day an ad with each angle spent. @param {AdRow[]} ads */
function lastRanByAngle(ads) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const a of ads) {
    if (!a.angle_key || !a.last_spend_day) continue;
    if ((out.get(a.angle_key) ?? "") < a.last_spend_day) out.set(a.angle_key, a.last_spend_day);
  }
  return out;
}

/**
 * The reason on a Chris-idea slot. "Chris's idea from Oct 12." (or "Chris picked this
 * angle from the planner's suggestions on Oct 12."), plus a line when its funnel had no
 * spend and joined the plan for it.
 * @param {IdeaIn} idea @param {string} funnelKey @param {Set<string>} inPlay
 * @param {(k: string) => string} funnelName
 */
function ideaReason(idea, funnelKey, inPlay, funnelName) {
  const day = dayWords(arizonaDay(idea.created_at));
  const when = day ? ` from ${day}` : "";
  const first = idea.source === "suggestion"
    ? `Chris picked this angle from the planner's suggestions${day ? ` on ${day}` : ""}.`
    : `Chris's idea${when}.`;
  const extra = inPlay.has(funnelKey) ? "" : ` ${funnelName(funnelKey)} had no spend last week; it gets this slot because the idea names it.`;
  return first + extra;
}

/**
 * Three angle suggestions with their numbers (spec §7.5 step 7). Angles already in the
 * plan, skipped this time, or named by a waiting idea are left out, so each one adds
 * something; only when fewer than 3 are left do plan angles come back in. Order:
 *   1. angles with leads last week (most leads, then cheapest lead);
 *   2. angles with spend and no leads last week (most spend);
 *   3. angles not used in 30 days (angle list order);
 *   4. the rest (used lately, not spending last week).
 * @param {{ ads: AdRow[], angleNames: Map<string, string>, angleName: (k: string) => string,
 *           skip: Set<string>, planAngles: Set<string>, waitingAngles: Set<any>,
 *           usedOn: Map<string, string>, lastRan: Map<string, string>, freshFrom: string,
 *           leads: Map<string, number> }} ctx
 * @returns {Suggestion[]}
 */
function suggestAngles(ctx) {
  /** @type {Map<string, { spend: number|null, days: number }>} */
  const spend = new Map();
  for (const a of ctx.ads) {
    if (!a.angle_key || !(a.ad_days_7d > 0)) continue;
    const s = spend.get(a.angle_key) ?? { spend: null, days: 0 };
    s.spend = addKnown(s.spend, a.spend_7d_cents);
    s.days += a.ad_days_7d;
    spend.set(a.angle_key, s);
  }
  const keys = [...new Set([...ctx.angleNames.keys(), ...spend.keys(), ...ctx.leads.keys()])].filter(isLabelKey);

  const rows = keys.map((k, i) => {
    const s = spend.get(k);
    const spent = s && s.days > 0 ? s.spend : null;
    const leadCount = ctx.leads.has(k) ? /** @type {number} */ (ctx.leads.get(k)) : (s && s.days > 0 ? 0 : null);
    const cost = cpl({ spend_cents: spent, leads: leadCount });
    const used = ctx.usedOn.get(k) ?? null;
    const ran = ctx.lastRan.get(k) ?? null;
    let tier;
    let why;
    if (leadCount !== null && leadCount > 0) {
      tier = 1;
      why = cost !== null
        ? `${plural(leadCount, "lead")} last week at ${dollars(cost)} each.`
        : `${plural(leadCount, "lead")} last week.`;
    } else if (spent !== null && spent > 0) {
      tier = 2;
      why = `Spent ${dollars(spent)} last week. No leads yet.`;
    } else if (!used || used < ctx.freshFrom) {
      tier = 3;
      why = ran ? `Last ran ${dayWords(ran)}. Not in the last 30 days.` : "Not run in the last 30 days.";
    } else {
      tier = 4;
      why = ran ? `Last ran ${dayWords(ran)}.` : "Written lately. Not running yet.";
    }
    return {
      key: k, i, tier, leads: leadCount, spent, cost, used,
      suggestion: /** @type {Suggestion} */ ({
        angle_key: k,
        name: ctx.angleName(k),
        why,
        last_ran_on: ran,
        numbers: { spend_7d_cents: spent, leads: leadCount, cpl_cents: cost }
      })
    };
  });

  rows.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 1) return (b.leads ?? 0) - (a.leads ?? 0) || (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.i - b.i;
    if (a.tier === 2) return (b.spent ?? 0) - (a.spent ?? 0) || a.i - b.i;
    if (a.tier === 4) return String(a.used ?? "").localeCompare(String(b.used ?? "")) || a.i - b.i;
    return a.i - b.i;
  });

  const open = rows.filter((r) => !ctx.skip.has(r.key) && !ctx.planAngles.has(r.key) && !ctx.waitingAngles.has(r.key));
  const picked = open.slice(0, SUGGESTION_COUNT);
  if (picked.length < SUGGESTION_COUNT) {
    for (const r of rows) {
      if (picked.length >= SUGGESTION_COUNT) break;
      if (ctx.skip.has(r.key) || picked.includes(r)) continue;
      picked.push(r);
    }
  }
  return picked.map((r) => r.suggestion);
}
