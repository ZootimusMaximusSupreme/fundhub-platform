// Marketing settings and funnels: read, check, save. Tables from
// db/migrations/410_marketing_settings_funnels.sql; spec
// docs/specs/marketing-machine-2026-10-04.md §6 Step 3 and §17.
//
//   getOrCreateSettings(db, orgId)            the company's one settings row; the
//                                             first read makes it with the
//                                             defaults (race-safe: ON CONFLICT DO
//                                             NOTHING, then read)
//   saveSettings(tx, orgId, {patch,           check every key, refuse a stale
//     updatedAt, staffId})                    updated_at (409), save, return the row
//   listFunnels(db, orgId)
//   upsertFunnel(tx, orgId, {funnel})         one funnel by key: make it, or change
//                                             it when updated_at still matches
//   listCampaignsWithSpend(tx, {orgId, now})  synced Meta campaigns + their spend
//                                             over the last 7 Arizona days
//   listAdSets(tx, {orgId})                   synced Meta ad sets (the default-ad-
//                                             set picker)
//
// The pure checks (validateSettingsPatch, validateFunnelInput, the *View shapers)
// are exported for src/marketing/settings-store.test.mjs.
//
// WHO THE QUERIES RUN AS. The three marketing_* tables admit every role (410's
// *_app_all policy). campaigns, ads, ad_sets and ad_metrics_daily FORCE partner
// row security: a bare query sees nothing and looks like "no campaigns". The
// routes run all of these inside asStaff() (withRequest for writes).
//
// updated_at IS COMPARED IN MILLISECONDS, IN JS. The screen gets updated_at as
// an ISO string (milliseconds) and sends it back. The row is read FOR UPDATE and
// compared after node-postgres has parsed it the same way, so the precision is
// the same on both sides. Every save moves updated_at forward by at least one
// millisecond, so two saves can never share a stamp.
//
// NULL MEANS UNKNOWN. A campaign with no saved ad-days in the window has
// spend_7d_cents null, never 0. Money is integer cents.

import { InvalidError, StaleError } from "./http.mjs";
import { isOfferKey, OFFER_KEYS } from "./offer-facts.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";
import { pageView, PAGES_JSON_SQL } from "./funnel-store.mjs";

/* ── vocabularies ────────────────────────────────────────────────────────── */

/** The script formats — the keys of format_style (spec §6 Step 3 default). */
export const FORMATS = Object.freeze(["standard", "sorting", "long", "notes", "greenscreen", "vsl"]);
export const FORMAT_STYLES = Object.freeze(["bullets", "words"]);
export const SIZE_RULES = Object.freeze(["total", "per_funnel"]);
export const ANIMATION_MODES = Object.freeze(["fullframe", "overlay"]);
/** The ad_lane enum: 286 plus 'slo' from 406. */
export const AD_LANES = Object.freeze(["funding600", "premium", "sorting", "uwiq", "wl", "slo", "unknown"]);

/** GET marketing/settings → {settings:{...these keys, in this order}}. */
export const SETTINGS_KEYS = Object.freeze([
  "org_id", "enabled", "batch_weekday", "batch_time", "timezone", "scripts_per_day",
  "days_per_batch", "size_rule", "format_style", "draft_expiry_days", "winner_rule",
  "ad_number_floor", "next_overrides", "max_batch_cost_usd", "max_month_cost_usd",
  "submagic_template", "caption_position_y", "magic_zooms", "clean_audio",
  "caption_dictionary", "animation_mode", "flip_horizontal", "settle_minutes",
  "quiet_start", "quiet_end", "updated_at", "updated_by"
]);

/** Set by the server, never by a patch. */
const SERVER_SET = new Set(["org_id", "updated_at", "updated_by"]);

/* The two research dials (migration 429, design docs/specs/command-center-design-2026-10-05.md
   §3.8 item 3 and §6 "Slice 10", unit X2): "Research: stop at $__ a run" and "Research
   counts against the $300 month cap". Kept OUT of SETTINGS_KEYS on purpose: that list
   is spec §6 Step 3's column table, pinned to migration 410. The answer carries these
   two after it. */
export const RESEARCH_SETTINGS_KEYS = Object.freeze(["max_research_cost_usd", "research_shares_month_cap"]);

export const SETTINGS_PATCH_KEYS = Object.freeze([
  ...SETTINGS_KEYS.filter((k) => !SERVER_SET.has(k)),
  ...RESEARCH_SETTINGS_KEYS
]);

/** GET marketing/funnels → funnels:[{...these keys}]. */
export const FUNNEL_KEYS = Object.freeze([
  "id", "key", "name", "landing_url", "offer_key", "lane", "book_call", "format_mix",
  "cta_type", "meta_campaign_ids", "default_ad_set_external_id", "weight", "active",
  "created_at", "updated_at",
  // The funnel builder (build unit X4, migration 425). A funnel mapped by hand
  // has kind null, no tag, status 'live', pages [] and events_seen null (unknown).
  "kind", "url", "path", "tag", "utm_campaign", "utm_template", "campaign", "status",
  "live_at", "created_by", "pages", "events_seen"
]);
/** The fields a built funnel's pages were written for. Settings cannot change them. */
const BUILT_FIXED = Object.freeze(["landing_url", "lane", "offer_key", "book_call"]);
/** What POST marketing/funnels may send inside `funnel`. */
export const FUNNEL_WRITE_KEYS = Object.freeze([
  "key", "name", "landing_url", "offer_key", "lane", "book_call", "format_mix",
  "cta_type", "meta_campaign_ids", "default_ad_set_external_id", "weight", "active",
  "updated_at"
]);
/** A new funnel cannot be made without these. */
const FUNNEL_REQUIRED = Object.freeze(["name", "landing_url", "lane"]);

const INT_MAX = 2147483647;
const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const FUNNEL_KEY_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;
const META_ID_RE = /^[0-9]{1,32}$/;
const CTA_RE = /^[A-Z][A-Z_]{1,49}$/;

/* ── small checks ────────────────────────────────────────────────────────── */

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function bool(field, v) {
  if (typeof v !== "boolean") throw new InvalidError(field, `${label(field)} must be true or false.`);
  return v;
}

function positiveInt(field, v) {
  if (!Number.isInteger(v) || v < 1 || v > INT_MAX) {
    throw new InvalidError(field, `${label(field)} must be a whole number, 1 or more.`);
  }
  return v;
}

function oneOf(field, v, list) {
  if (typeof v !== "string" || !list.includes(v)) {
    throw new InvalidError(field, `${label(field)} must be one of: ${list.join(", ")}.`);
  }
  return v;
}

function hhmm(field, v) {
  if (typeof v !== "string" || !HHMM_RE.test(v)) {
    throw new InvalidError(field, `${label(field)} must be a time like 07:00 (24-hour, HH:MM).`);
  }
  return v;
}

function text(field, v, max) {
  if (typeof v !== "string" || !v.trim() || v.length > max) {
    throw new InvalidError(field, `${label(field)} must be words, 1 to ${max} letters long.`);
  }
  return v.trim();
}

function objectOrNull(field, v) {
  if (v === null) return null;
  if (!isPlainObject(v)) throw new InvalidError(field, `${label(field)} must be an object, or null to leave it blank.`);
  return v;
}

function timeZone(field, v) {
  if (typeof v !== "string" || !v.trim()) throw new InvalidError(field, `${label(field)} must be a time zone like America/Phoenix.`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
  } catch {
    throw new InvalidError(field, `${label(field)} "${v}" is not a time zone this system knows. Try America/Phoenix.`);
  }
  return v;
}

/* "patch.batch_weekday" → "batch_weekday" for the sentence. */
function label(field) {
  return String(field).replace(/^(patch|funnel)\./, "");
}

/** updated_at the caller read → milliseconds. Missing or not a time → 400. */
export function parseUpdatedAt(v, field = "updated_at") {
  const ms = typeof v === "string" && v.trim() ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) {
    throw new InvalidError(field, "Send back the updated_at you read (an ISO time), so a newer save is not lost.");
  }
  return ms;
}

const msOf = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const hhmmOf = (v) => (v == null ? null : String(v).slice(0, 5));

/* ── settings: check ─────────────────────────────────────────────────────── */

const SETTINGS_CHECKS = {
  enabled: bool,
  batch_weekday: (f, v) => {
    if (!Number.isInteger(v) || v < 0 || v > 6) throw new InvalidError(f, "batch_weekday must be 0 to 6 (0 is Sunday, 1 is Monday).");
    return v;
  },
  batch_time: hhmm,
  timezone: timeZone,
  scripts_per_day: positiveInt,
  days_per_batch: positiveInt,
  size_rule: (f, v) => oneOf(f, v, SIZE_RULES),
  format_style: (f, v) => {
    if (!isPlainObject(v)) throw new InvalidError(f, `format_style must be an object like {"standard":"bullets"}.`);
    for (const [k, style] of Object.entries(v)) {
      if (!FORMATS.includes(k)) throw new InvalidError(`${f}.${k}`, `"${k}" is not a script format. Formats: ${FORMATS.join(", ")}.`);
      oneOf(`${f}.${k}`, style, FORMAT_STYLES);
    }
    return v;
  },
  draft_expiry_days: positiveInt,
  winner_rule: objectOrNull,
  ad_number_floor: positiveInt,
  next_overrides: objectOrNull,
  max_batch_cost_usd: positiveInt,
  max_month_cost_usd: positiveInt,
  submagic_template: (f, v) => text(f, v, 100),
  caption_position_y: (f, v) => {
    if (v === null) return null;
    if (!Number.isInteger(v) || v < 0 || v > INT_MAX) throw new InvalidError(f, "caption_position_y must be a whole number, 0 or more, or null.");
    return v;
  },
  magic_zooms: bool,
  clean_audio: bool,
  caption_dictionary: (f, v) => {
    if (!Array.isArray(v) || v.length > 1000) throw new InvalidError(f, "caption_dictionary must be a list of words (up to 1000).");
    return v.map((w, i) => text(`${f}.${i}`, w, 100));
  },
  animation_mode: (f, v) => oneOf(f, v, ANIMATION_MODES),
  flip_horizontal: bool,
  settle_minutes: positiveInt,
  quiet_start: hhmm,
  quiet_end: hhmm,
  /* Dollars of model spend, up to 2 decimals, 0.01 to 1000; null = not set (the
     deep research card then asks for a stop amount on every run). */
  max_research_cost_usd: (f, v) => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.01 || v > 1000 || Math.abs(Math.round(v * 100) - v * 100) > 1e-9) {
      throw new InvalidError(f, "max_research_cost_usd must be dollars from 0.01 to 1000 (like 5 or 2.50), or null to leave it blank.");
    }
    return v;
  },
  research_shares_month_cap: bool
};

/**
 * Checks a settings patch. Returns the cleaned values; throws InvalidError with
 * field "patch.<key>" on the first bad one. Unknown keys and server-set keys are
 * refused, not ignored, so a typo never looks like a save.
 */
export function validateSettingsPatch(patch) {
  if (!isPlainObject(patch)) throw new InvalidError("patch", "patch must be an object of the settings to change.");
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new InvalidError("patch", "patch is empty. Nothing to save.");
  const out = {};
  for (const k of keys) {
    const field = `patch.${k}`;
    if (SERVER_SET.has(k)) {
      throw new InvalidError(field, k === "updated_at"
        ? "updated_at goes next to patch, not inside it. The server sets the new one."
        : `${k} is set by the server. Leave it out.`);
    }
    const check = Object.prototype.hasOwnProperty.call(SETTINGS_CHECKS, k) ? SETTINGS_CHECKS[k] : null;
    if (!check) throw new InvalidError(field, `"${k}" is not a setting.`);
    out[k] = check(field, patch[k]);
  }
  return out;
}

/** The settings row as GET/POST marketing/settings answer it. */
export function settingsView(row) {
  if (!row) return null;
  return {
    org_id: row.org_id,
    enabled: row.enabled,
    batch_weekday: row.batch_weekday,
    batch_time: hhmmOf(row.batch_time),
    timezone: row.timezone,
    scripts_per_day: row.scripts_per_day,
    days_per_batch: row.days_per_batch,
    size_rule: row.size_rule,
    format_style: row.format_style,
    draft_expiry_days: row.draft_expiry_days,
    winner_rule: row.winner_rule ?? null,
    ad_number_floor: row.ad_number_floor,
    next_overrides: row.next_overrides ?? null,
    max_batch_cost_usd: row.max_batch_cost_usd,
    max_month_cost_usd: row.max_month_cost_usd,
    submagic_template: row.submagic_template,
    caption_position_y: row.caption_position_y ?? null,
    magic_zooms: row.magic_zooms,
    clean_audio: row.clean_audio,
    caption_dictionary: row.caption_dictionary || [],
    animation_mode: row.animation_mode,
    flip_horizontal: row.flip_horizontal,
    settle_minutes: row.settle_minutes,
    quiet_start: hhmmOf(row.quiet_start),
    quiet_end: hhmmOf(row.quiet_end),
    updated_at: iso(row.updated_at),
    updated_by: row.updated_by ?? null,
    // Migration 429. NULL is "not set", never 0. A row read before 429 ran has no
    // column at all: research then counts against the month cap (the default).
    max_research_cost_usd: row.max_research_cost_usd == null ? null : Number(row.max_research_cost_usd),
    research_shares_month_cap: row.research_shares_month_cap == null ? true : row.research_shares_month_cap === true
  };
}

/* ── settings: read and save ─────────────────────────────────────────────── */

const ENSURE_SETTINGS_SQL =
  `INSERT INTO marketing_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`;

/** The company's settings row. The first read makes it, with the defaults. */
export async function getOrCreateSettings(db, orgId) {
  await db.query(ENSURE_SETTINGS_SQL, [orgId]);
  const { rows } = await db.query(`SELECT * FROM marketing_settings WHERE org_id = $1`, [orgId]);
  return rows[0] || null;
}

/* Columns that hold JSON go in as text and are cast; format_style merges into
   what is saved (one format at a time is a normal change); text[] goes in as a
   JS array. */
const JSON_COLS = new Set(["winner_rule", "next_overrides"]);
const TIME_COLS = new Set(["batch_time", "quiet_start", "quiet_end"]);

/**
 * Saves a settings patch inside the caller's transaction.
 * InvalidError → 400. StaleError (carries the saved settings) → 409.
 */
export async function saveSettings(tx, orgId, { patch, updatedAt, staffId = null } = {}) {
  const values = validateSettingsPatch(patch);
  const sentMs = parseUpdatedAt(updatedAt);

  await tx.query(ENSURE_SETTINGS_SQL, [orgId]);
  const { rows } = await tx.query(`SELECT * FROM marketing_settings WHERE org_id = $1 FOR UPDATE`, [orgId]);
  const current = rows[0];
  if (msOf(current.updated_at) !== sentMs) throw new StaleError(settingsView(current));

  const sets = [];
  const params = [orgId];
  for (const [k, v] of Object.entries(values)) {
    if (k === "format_style") {
      params.push(JSON.stringify(v));
      sets.push(`format_style = format_style || $${params.length}::jsonb`);
    } else if (JSON_COLS.has(k)) {
      params.push(v === null ? null : JSON.stringify(v));
      sets.push(`${k} = $${params.length}::jsonb`);
    } else if (TIME_COLS.has(k)) {
      params.push(v);
      sets.push(`${k} = $${params.length}::time`);
    } else if (k === "caption_dictionary") {
      params.push(v);
      sets.push(`${k} = $${params.length}::text[]`);
    } else {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  params.push(staffId);
  sets.push(`updated_by = $${params.length}`);
  sets.push(`updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')`);

  const saved = await tx.query(
    `UPDATE marketing_settings SET ${sets.join(", ")} WHERE org_id = $1 RETURNING *`,
    params
  );
  return saved.rows[0];
}

/* ── funnels: check ──────────────────────────────────────────────────────── */

const FUNNEL_CHECKS = {
  name: (f, v) => text(f, v, 120),
  landing_url: (f, v) => {
    let u = null;
    try { u = typeof v === "string" && v.length <= 2000 ? new URL(v) : null; } catch { u = null; }
    if (!u || u.protocol !== "https:" || !/^https:\/\//.test(v)) {
      throw new InvalidError(f, "landing_url must be a full https:// web address.");
    }
    return v;
  },
  offer_key: (f, v) => {
    if (v === null) return null;
    if (!isOfferKey(v)) throw new InvalidError(f, `offer_key must be one of: ${OFFER_KEYS.join(", ")} (or null).`);
    return v;
  },
  lane: (f, v) => oneOf(f, v, AD_LANES),
  book_call: bool,
  format_mix: (f, v) => {
    if (!isPlainObject(v)) throw new InvalidError(f, `format_mix must be an object like {"standard":2,"sorting":1}.`);
    let any = false;
    for (const [k, n] of Object.entries(v)) {
      if (!FORMATS.includes(k)) throw new InvalidError(`${f}.${k}`, `"${k}" is not a script format. Formats: ${FORMATS.join(", ")}.`);
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        throw new InvalidError(`${f}.${k}`, `format_mix.${k} must be a number, 0 or more.`);
      }
      if (n > 0) any = true;
    }
    if (!any) throw new InvalidError(f, "format_mix needs at least one format above 0.");
    return v;
  },
  cta_type: (f, v) => {
    if (typeof v !== "string" || !CTA_RE.test(v)) {
      throw new InvalidError(f, "cta_type must be a Meta button type in capitals, like LEARN_MORE.");
    }
    return v;
  },
  meta_campaign_ids: (f, v) => {
    if (!Array.isArray(v)) throw new InvalidError(f, "meta_campaign_ids must be a list of Meta campaign ids.");
    for (const id of v) {
      if (typeof id !== "string" || !META_ID_RE.test(id)) {
        throw new InvalidError(f, "Each Meta campaign id must be its digits, sent as text (like \"120212345678901234\").");
      }
    }
    return [...new Set(v)];
  },
  default_ad_set_external_id: (f, v) => {
    if (v === null) return null;
    if (typeof v !== "string" || !META_ID_RE.test(v)) {
      throw new InvalidError(f, "default_ad_set_external_id must be a Meta ad set id (digits, as text), or null.");
    }
    return v;
  },
  weight: (f, v) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e6) {
      throw new InvalidError(f, "weight must be a number, 0 or more.");
    }
    return v;
  },
  active: bool
};

/**
 * Checks POST marketing/funnels's `funnel`. Returns {key, values, updatedAt}:
 * values holds only the fields that were sent (minus key and updated_at);
 * updatedAt is null when it was not sent. Throws InvalidError "funnel.<key>".
 */
export function validateFunnelInput(funnel) {
  if (!isPlainObject(funnel)) throw new InvalidError("funnel", "funnel must be an object with at least a key.");
  for (const k of Object.keys(funnel)) {
    if (!FUNNEL_WRITE_KEYS.includes(k)) {
      throw new InvalidError(`funnel.${k}`, k === "id" || k === "created_at"
        ? `${k} is set by the server. Leave it out.`
        : `"${k}" is not a funnel field.`);
    }
  }
  const key = funnel.key;
  if (typeof key !== "string" || !FUNNEL_KEY_RE.test(key)) {
    throw new InvalidError("funnel.key", "key must be lowercase letters, numbers and _ (like book_call), up to 63.");
  }
  let updatedAt = null;
  if (funnel.updated_at !== undefined && funnel.updated_at !== null) {
    parseUpdatedAt(funnel.updated_at, "funnel.updated_at");
    updatedAt = funnel.updated_at;
  }
  const values = {};
  for (const [k, v] of Object.entries(funnel)) {
    if (k === "key" || k === "updated_at") continue;
    values[k] = FUNNEL_CHECKS[k](`funnel.${k}`, v);
  }
  return { key, values, updatedAt };
}

/** A funnel row as GET/POST marketing/funnels answer it. */
export function funnelView(row) {
  if (!row) return null;
  const pages = Array.isArray(row.pages) ? row.pages : [];
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    landing_url: row.landing_url,
    offer_key: row.offer_key ?? null,
    lane: row.lane,
    book_call: row.book_call,
    format_mix: row.format_mix,
    cta_type: row.cta_type,
    meta_campaign_ids: row.meta_campaign_ids || [],
    default_ad_set_external_id: row.default_ad_set_external_id ?? null,
    // numeric arrives from node-postgres as a string.
    weight: row.weight == null ? null : Number(row.weight),
    active: row.active,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    kind: row.kind ?? null,
    url: row.landing_url,
    path: row.path ?? null,
    tag: row.tag ?? null,
    utm_campaign: row.utm_campaign ?? null,
    utm_template: utmTemplate(row.utm_campaign ?? row.lane),
    campaign: row.campaign ?? null,
    status: row.status ?? "live",
    live_at: iso(row.live_at),
    created_by: row.created_by ?? null,
    pages: pages.map((p) => pageView(p)),
    events_seen: row.kind ? pages.reduce((n, p) => n + (Number(p.events_seen) || 0), 0) : null
  };
}

/* The UTMs every ad for a funnel carries (migration 286, src/marketing/url-tags.mjs):
   utm_campaign is the funnel's lane, utm_content the ad's number. null when the
   lane is one the database files as "unknown". */
function utmTemplate(lane) {
  const l = String(lane ?? "");
  if (!l || l === "unknown" || !AD_LANES.includes(l)) return null;
  return `utm_source=fb&utm_medium=paid&utm_campaign=${l}&utm_content={ad_number}`;
}

/* ── funnels: read and save ──────────────────────────────────────────────── */

export async function listFunnels(db, orgId) {
  const { rows } = await db.query(
    `SELECT f.*, ${PAGES_JSON_SQL}
       FROM marketing_funnels f
      WHERE f.org_id = $1
      ORDER BY f.active DESC, f.key`,
    [orgId]
  );
  return rows;
}

const FUNNEL_SQL_TYPE = {
  lane: "::ad_lane",
  format_mix: "::jsonb",
  meta_campaign_ids: "::text[]",
  weight: "::numeric"
};
const sqlValue = (k, v) => (k === "format_mix" ? JSON.stringify(v) : v);

/**
 * Makes or changes one funnel by key, inside the caller's transaction.
 *   no funnel with that key   → made (name, landing_url and lane are required)
 *   it exists                 → changed, only when updated_at is sent and still
 *                               matches; otherwise 409 with what is saved
 * A Meta campaign may sit on one funnel only: a campaign already on another
 * funnel of this company is refused (400), so spend is never counted twice.
 */
export async function upsertFunnel(tx, orgId, { funnel } = {}) {
  const { key, values, updatedAt } = validateFunnelInput(funnel);

  const cur = await tx.query(
    `SELECT * FROM marketing_funnels WHERE org_id = $1 AND key = $2 FOR UPDATE`,
    [orgId, key]
  );
  let row = cur.rows[0] || null;

  if (row) {
    if (updatedAt === null) {
      throw new StaleError(funnelView(row),
        "This funnel already exists. Open it, then save with its updated_at so a newer save is not lost.");
    }
    if (msOf(row.updated_at) !== Date.parse(updatedAt)) throw new StaleError(funnelView(row));
    if (row.kind) {
      const fixed = BUILT_FIXED.find((k) => values[k] !== undefined);
      if (fixed) {
        throw new InvalidError(`funnel.${fixed}`,
          `This funnel was built on the dashboard, so its ${fixed} is set by the builder. Rename it from its funnel card instead.`);
      }
    }
  } else {
    for (const k of FUNNEL_REQUIRED) {
      if (values[k] === undefined) throw new InvalidError(`funnel.${k}`, `A new funnel needs ${k}.`);
    }
  }

  if (values.meta_campaign_ids && values.meta_campaign_ids.length) {
    const taken = await tx.query(
      `SELECT key, ARRAY(SELECT unnest(meta_campaign_ids) INTERSECT SELECT unnest($3::text[])) AS ids
         FROM marketing_funnels
        WHERE org_id = $1 AND key <> $2 AND meta_campaign_ids && $3::text[]
        ORDER BY key LIMIT 1`,
      [orgId, key, values.meta_campaign_ids]
    );
    if (taken.rows[0]) {
      const t = taken.rows[0];
      throw new InvalidError("funnel.meta_campaign_ids",
        `Campaign ${t.ids[0]} is already on the ${t.key} funnel. Take it off there first.`);
    }
  }

  const cols = Object.keys(values);
  if (!row) {
    const params = [orgId, key, ...cols.map((k) => sqlValue(k, values[k]))];
    const ins = await tx.query(
      `INSERT INTO marketing_funnels (org_id, key${cols.map((k) => `, ${k}`).join("")})
       VALUES ($1, $2${cols.map((k, i) => `, $${i + 3}${FUNNEL_SQL_TYPE[k] || ""}`).join("")})
       ON CONFLICT (org_id, key) DO NOTHING
       RETURNING *`,
      params
    );
    if (ins.rows[0]) return ins.rows[0];
    // Made by someone else a moment ago. Show it; do not write over it.
    const now = await tx.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND key = $2`, [orgId, key]);
    throw new StaleError(funnelView(now.rows[0]),
      "Someone made this funnel a moment ago. Here it is. Look it over and save again.");
  }

  if (cols.length === 0) return row;
  const params = [row.id, ...cols.map((k) => sqlValue(k, values[k]))];
  const upd = await tx.query(
    `UPDATE marketing_funnels
        SET ${cols.map((k, i) => `${k} = $${i + 2}${FUNNEL_SQL_TYPE[k] || ""}`).join(", ")},
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE id = $1
      RETURNING *`,
    params
  );
  return upd.rows[0];
}

/* ── Meta campaigns and ad sets, for mapping funnels ─────────────────────── */

/* "2026-10-05" + n days, in plain calendar arithmetic (UTC, so no clock change
   moves it). */
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The last 7 Arizona days, today included — the Today tab's last_7_days. */
export function sevenDayWindow(now = new Date()) {
  const to = adAccountDay(now);
  return { from: addDays(to, -6), to };
}

/* A bigint sum arrives as a string. Integer cents, or null. */
const centsOrNull = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/**
 * Every synced Meta campaign of the company, with its spend over the last 7
 * Arizona days and the funnel that holds it. Run inside asStaff().
 * @returns {Promise<Array<{external_id: string, name: string, status: string|null, spend_7d_cents: number|null, funnel_key: string|null}>>}
 */
export async function listCampaignsWithSpend(tx, { orgId, now = new Date() }) {
  const { from, to } = sevenDayWindow(now);
  const { rows } = await tx.query(
    `SELECT c.external_id, c.name, c.status,
            s.spend_cents, s.ad_days,
            f.key AS funnel_key
       FROM campaigns c
       LEFT JOIN LATERAL (
         SELECT SUM(m.spend_cents)::bigint AS spend_cents, COUNT(m.id)::int AS ad_days
           FROM ads a
           JOIN ad_metrics_daily m
             ON m.ad_id = a.id AND m.date BETWEEN $2::date AND $3::date
          WHERE a.campaign_id = c.id
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT mf.key FROM marketing_funnels mf
          WHERE mf.org_id = c.org_id AND c.external_id = ANY (mf.meta_campaign_ids)
          ORDER BY mf.active DESC, mf.key
          LIMIT 1
       ) f ON true
      WHERE c.org_id = $1
        AND c.external_id IS NOT NULL
        AND c.platform = 'meta'
      ORDER BY s.spend_cents DESC NULLS LAST, c.name, c.external_id`,
    [orgId, from, to]
  );
  return rows.map((r) => ({
    external_id: r.external_id,
    name: r.name,
    status: r.status ?? null,
    // No saved ad-days in the window → unknown. Never 0.
    spend_7d_cents: Number(r.ad_days) > 0 ? centsOrNull(r.spend_cents) : null,
    funnel_key: r.funnel_key ?? null
  }));
}

/**
 * Every synced Meta ad set of the company, for the default-ad-set picker.
 * Run inside asStaff().
 * @returns {Promise<Array<{external_id: string, name: string, status: string|null, campaign_external_id: string|null}>>}
 */
export async function listAdSets(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT s.external_id, s.name, s.status, c.external_id AS campaign_external_id
       FROM ad_sets s
       JOIN campaigns c ON c.id = s.campaign_id
      WHERE s.org_id = $1
        AND s.external_id IS NOT NULL
        AND c.platform = 'meta'
      ORDER BY c.name, s.name, s.external_id`,
    [orgId]
  );
  return rows.map((r) => ({
    external_id: r.external_id,
    name: r.name,
    status: r.status ?? null,
    campaign_external_id: r.campaign_external_id ?? null
  }));
}
