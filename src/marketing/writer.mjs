// @ts-check
// src/marketing/writer.mjs — the script writer: one Claude call writes one script, the
// checks send it back when it breaks a rule, and the draft is saved for Chris.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.6 (Writer), Appendix A (Chris's
// rules), Appendix B (recipes), §4 traps 3 and 8. Laws: sample-clients-consistent and
// proof-cards-from-source (data-tied animations take no data from the writer).
//
// TWO JOBS (src/marketing/job-kinds.mjs, group 'writer'; the background worker runs them):
//   write_slot  {batch_id, slot}            → writeSlot(): one new draft for one plan slot
//   fix_script  {script_id, version, note}  → fixScript(): Chris's note → a new version
//
// ─────────────────────────────────────────────────────────────────────────────────────
// THE CALL. callModel({provider:'anthropic'}) from src/agents/model.mjs, so only
// api.anthropic.com is ever called (an OpenAI key in the same env is ignored):
//   model      MARKETING_WRITER_MODEL, default claude-opus-5-5
//   effort     'medium' (Opus 5.5 always thinks; effort is the only control, and it is
//              sent, never left to the vendor's default)
//   maxTokens  16000 (thinking counts toward it)
//   timeoutMs  5 minutes
//   cache      true (the system prompt: rules, voice, recipe, catalog, angles)
//   outputSchema SAVE_SCRIPT_SCHEMA
//
// WHY A SCHEMA AND NOT THE SPEC'S "FORCED save_script TOOL". Spec §7.6 says "a forced
// save_script tool whose schema is the output below". Forcing a tool (tool_choice 'any'
// or a named tool) is HTTP 400 on claude-opus-5-5 and claude-sonnet-5-5 (claude-api
// skill, "Forced tool use removed"), and callModel refuses it before sending. The same
// guarantee comes from structured outputs: output_config.format with this JSON schema,
// so the reply is the save_script object itself. No request here carries tool_choice.
//
// Structured outputs accept no maxLength and need additionalProperties:false and every
// key required on every object. So: the 40-character headline is checked in code below;
// an animation's props travel as a JSON object written as text (each template takes
// different keys, and a free-form object is not allowed) and are parsed here; an anchor
// carries phrase, cue and keyword, with null for the ones its style does not use.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// THE CHECK LOOP (spec §7.6):
//   1. Code checks: checkScriptText(..., {strict:true}) (scripts/ads/check-script.mjs),
//      the parts match the body word for word, validateAnimationPlan (catalog only,
//      data-tied templates take no props), the Meta copy (headline 40 characters or
//      fewer, the same word rules), no price on a book-a-call ad (rule 29), usable label
//      keys, and the compliance screen (src/compliance/screen.mjs, offer type 'funding'
//      for both funnels, platform meta) on body and meta_copy. Failures go back to
//      Claude for up to 2 rounds. (The compliance screen is pattern-only, so it runs with
//      the code checks and its reasons go back too; spec step 3 still holds: it runs on
//      the final body and meta_copy.)
//   2. One judge pass with MARKETING_CHECK_MODEL (default claude-sonnet-5-5, effort
//      'medium', structured output) for Appendix A rules 13-34 plus "carry" (3), "round
//      two" (9) and "man" (12). Violations go back once. The judge is not run again.
//   3. Sameness (src/marketing/sameness.mjs): overlap above 0.5 with the last 30 hooks or
//      bodies, a hook or CTA another script in the batch has, or an intro over its cap →
//      one rewrite. A batch duplicate that survives the rewrite is refused (not saved).
// A rewrite replaces the draft only when it passes the code checks, or when the draft it
// replaces did not pass them either. A draft that still fails anything is saved FLAGGED
// (check_results.flagged = true, with plain reasons): it ships marked "needs a look".
//
// COST (spec §7.6, Appendix E). Every call that got an answer is logged in
// marketing_model_usage with the model that SERVED it (a refusal fallback can answer on
// another model). Before every call: costStatus(); at either cap (max_batch_cost_usd,
// max_month_cost_usd) the writer stops, the slot fails 'cost cap reached', and one buzz
// is queued (one per batch for the batch cap, one per Arizona month for the month cap).
//
// THE SAVE (§4 trap 3). ad_scripts and ad_labels force partner row security, so every
// read and write runs inside asStaff() (src/partners/rls.mjs), the same way
// api/scripts/write.mjs does: the ad_scripts row and its ad_labels upserts in ONE staff
// transaction. NO TRANSACTION IS EVER OPEN DURING A MODEL CALL: every database step
// opens, finishes and closes its own short transaction before the next call. The worker
// (not the 26-second API) runs this, so a slow model never holds a request open.
//
// WHAT IT NEVER DOES. It writes ad_scripts rows (plus their ad_labels, the idea it came
// from, the cost log and the cost buzz) and nothing else. It never enqueues a repo write:
// the repo is public, and draft files are committed at release (U35, spec §7.7); Chris's
// own edits enqueue at save (U25). It never names a price except through offerFacts().
// It never sends anything to a customer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callModel as defaultCallModel, classifyModelFailure, MODEL_NOT_SENT, MODEL_NO_JSON,
  MODEL_NO_CREDIT, MODEL_RATE_LIMITED, MODEL_SERVER_ERROR, MODEL_UNREACHABLE
} from "../agents/model.mjs";
import { checkScriptText, loadBannedLive } from "../../scripts/ads/check-script.mjs";
import { DEFAULT_STYLE } from "../../marketing/ads/rules-data.mjs";
import { validateAnimationPlan } from "./animation-plan.mjs";
import { offerFacts, OFFER_KEYS } from "./offer-facts.mjs";
import { logUsage as defaultLogUsage, costStatus as defaultCostStatus } from "./model-usage.mjs";
import { queueBuzz as defaultQueueBuzz } from "./notify.mjs";
import { getOrCreateSettings } from "./settings-store.mjs";
import { getContents as defaultGetContents } from "../repo/github.mjs";
import { screen as defaultScreen } from "../compliance/screen.mjs";
import { asStaff as defaultAsStaff } from "../partners/rls.mjs";
import { normaliseLabelKey, isLabelKey, friendlyName } from "../ads/label-keys.mjs";
import { checkSameness, hookOf, ctaOf, introKind, introCaps, RECENT_LIMIT } from "./sameness.mjs";
import {
  buildSystemPrompt, buildUserPrompt, buildFixPrompt, buildRewritePrompt,
  buildJudgeSystem, buildJudgeUser, formatPrice,
  JUDGED_RULES, PART_KINDS, SCRIPT_LANES, SCRIPT_FORMATS, STYLES
} from "./writer-prompt.mjs";

// ── The call ──────────────────────────────────────────────────────────────────────────

export const DEFAULT_WRITER_MODEL = "claude-opus-5-5";
export const DEFAULT_CHECK_MODEL = "claude-sonnet-5-5";
export const WRITER_EFFORT = "medium";
export const CHECK_EFFORT = "medium";
export const WRITER_MAX_TOKENS = 16000;
export const CHECK_MAX_TOKENS = 16000;
export const WRITER_TIMEOUT_MS = 5 * 60_000;
export const CHECK_TIMEOUT_MS = 5 * 60_000;

/** Rewrite rounds for code-check failures (spec §7.6 step 1). */
export const STRICT_ROUNDS = 2;

/** A Meta headline is 40 characters or fewer (Appendix B). Checked here: structured
 *  outputs accept no maxLength. */
export const HEADLINE_MAX = 40;

/* A background function is killed at 15 minutes (spec §4 trap 5). With no deadline from
   the worker, one script gets 10 minutes: a rewrite round only starts when a whole call
   (5 minutes) still fits. The worker passes deps.deadlineAt to tighten this. */
export const WRITER_BUDGET_MS = 10 * 60_000;

export const HOUSE_PARTNER_SLUG = "fundhub-house";
export const COST_CAP_REASON = "cost cap reached";
export const COST_CAP_BUZZ_KIND = "cost_cap";

/** The files the system prompt is built from, read at the batch's rules_sha. */
export const RULE_FILES = Object.freeze({
  rules: "marketing/ads/RULES.md",
  voice: "marketing/ads/VOICE.md",
  recipes: "marketing/ads/RECIPES.md",
  catalog: "marketing/broll/catalog.json",
  angles: "marketing/ads/angles.json",
  banned: "marketing/ads/banned-live.json"
});

/* The copies bundled with every function (netlify.toml included_files). Literal paths
   on purpose: a computed path here would let the function bundler pull in far more of
   the repo than these six files. */
const BUNDLED_URLS = Object.freeze({
  rules: () => new URL("../../marketing/ads/RULES.md", import.meta.url),
  voice: () => new URL("../../marketing/ads/VOICE.md", import.meta.url),
  recipes: () => new URL("../../marketing/ads/RECIPES.md", import.meta.url),
  catalog: () => new URL("../../marketing/broll/catalog.json", import.meta.url),
  angles: () => new URL("../../marketing/ads/angles.json", import.meta.url),
  banned: () => new URL("../../marketing/ads/banned-live.json", import.meta.url)
});

/** Which model writes. A blank or masked setting uses the default. */
export function writerModel(env = process.env) {
  return modelFromEnv(env?.MARKETING_WRITER_MODEL, DEFAULT_WRITER_MODEL);
}

/** Which model judges. A blank or masked setting uses the default. */
export function checkModel(env = process.env) {
  return modelFromEnv(env?.MARKETING_CHECK_MODEL, DEFAULT_CHECK_MODEL);
}

/** @param {unknown} v @param {string} fallback */
function modelFromEnv(v, fallback) {
  const s = String(v ?? "").trim();
  return s && !s.includes("*") ? s : fallback;
}

// ── The schemas ───────────────────────────────────────────────────────────────────────

/** @param {any} o */
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_INTEGER = { anyOf: [{ type: "integer" }, { type: "null" }] };

/**
 * The save_script object: the shape of every writer reply (spec §7.6 "The output").
 * Sent as callModel's outputSchema (structured outputs). Every object closed, every key
 * required.
 */
export const SAVE_SCRIPT_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [
    "title", "angle_key", "hook_key", "offer_key", "lane", "script_format", "style",
    "body", "parts", "meta_copy", "animation_plan"
  ],
  properties: {
    title: { type: "string", description: "The angle's name." },
    angle_key: { type: "string", description: "The angle's key from the angle list, or a new key (lower case, underscores)." },
    hook_key: { type: "string", description: "A short key for this hook (lower case, underscores)." },
    offer_key: { type: "string", enum: [...OFFER_KEYS] },
    lane: { type: "string", enum: [...SCRIPT_LANES] },
    script_format: { type: "string", enum: [...SCRIPT_FORMATS] },
    style: { type: "string", enum: [...STYLES] },
    body: { type: "string", description: "The teleprompter text: CAPS = punch, a blank line = pause, ↑ = pitch up." },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text"],
        properties: {
          kind: { type: "string", enum: [...PART_KINDS] },
          text: { type: "string" }
        }
      }
    },
    meta_copy: {
      type: "object",
      additionalProperties: false,
      required: ["primary_text", "headline", "description", "cta_type"],
      properties: {
        primary_text: { type: "string" },
        headline: { type: "string", description: "40 characters or fewer." },
        description: { type: "string" },
        cta_type: { type: "string" }
      }
    },
    animation_plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["anchor", "template", "props", "seconds"],
        properties: {
          anchor: {
            type: "object",
            additionalProperties: false,
            required: ["phrase", "cue", "keyword"],
            properties: { phrase: NULLABLE_STRING, cue: NULLABLE_INTEGER, keyword: NULLABLE_STRING }
          },
          template: { type: "string", description: "An id from the animation catalog." },
          props: { type: "string", description: "A JSON object written as text. \"{}\" for a data-tied template." },
          seconds: { type: "number" }
        }
      }
    }
  }
});

/** The judge's reply: the rule broken, the exact words, and the fix. */
export const JUDGE_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["violations"],
  properties: {
    violations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule", "quote", "fix"],
        properties: {
          rule: { type: "integer" },
          quote: { type: "string" },
          fix: { type: "string" }
        }
      }
    }
  }
});

// ── Small helpers ─────────────────────────────────────────────────────────────────────

/** @param {unknown} s */
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const CUE_MARK = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+/;
/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** @param {any} v */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The Arizona month a moment falls in, "YYYY-MM" (the cost month, model-usage.mjs). */
function arizonaMonth(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit" })
    .formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || { value: "" }).value;
  return `${get("year")}-${get("month")}`;
}

// ── Reading the rules at one commit ───────────────────────────────────────────────────

/* Files read from GitHub at a commit never change, so they are kept for the life of the
   function. Files read without a commit, or from the bundle, are read again each time. */
const SHA_CACHE = new Map();

/** @param {keyof typeof BUNDLED_URLS} name */
function readBundled(name) {
  const candidates = [];
  try { candidates.push(fileURLToPath(BUNDLED_URLS[name]())); } catch { /* no module path */ }
  try { candidates.push(join(process.cwd(), RULE_FILES[name])); } catch { /* no working directory */ }
  for (const p of candidates) {
    try { return readFileSync(p, "utf8"); } catch { /* try the next */ }
  }
  return null;
}

/**
 * The six rule files, from GitHub at `ref` when it answers, else the bundled copies.
 * Never throws; a file nobody can read comes back null and is named in `missing`.
 * @param {Record<string, any>} env
 * @param {{ ref?: string|null, fetchImpl?: any, getContents?: Function }} [opts]
 */
export async function readRuleFiles(env, { ref = null, fetchImpl, getContents = defaultGetContents } = {}) {
  /** @type {Record<string, string|null>} */
  const text = {};
  /** @type {Record<string, 'github'|'bundled'|null>} */
  const from = {};
  for (const name of /** @type {(keyof typeof RULE_FILES)[]} */ (Object.keys(RULE_FILES))) {
    const path = RULE_FILES[name];
    const key = ref ? `${ref}|${path}` : null;
    if (key && SHA_CACHE.has(key)) { text[name] = SHA_CACHE.get(key); from[name] = "github"; continue; }
    let got = null;
    try {
      const res = await getContents(path, { ref: ref || undefined, env, fetchImpl });
      if (res && res.ok && typeof res.content === "string") got = res.content;
    } catch { /* GitHub could not be read: the bundled copy below */ }
    if (got != null) {
      if (key) SHA_CACHE.set(key, got);
      text[name] = got; from[name] = "github";
    } else {
      text[name] = readBundled(name); from[name] = text[name] == null ? null : "bundled";
    }
  }
  /** @param {string|null} s @param {any} fallback */
  const parseJson = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };
  const catalog = parseJson(text.catalog, null);
  const angles = parseJson(text.angles, null);
  const banned = parseJson(text.banned, null);
  const missing = [];
  if (!text.rules) missing.push(RULE_FILES.rules);
  if (!Array.isArray(catalog) || !catalog.length) missing.push(RULE_FILES.catalog);
  const sources = new Set(Object.values(from).filter(Boolean));
  return {
    rules: text.rules || "",
    voice: text.voice || "",
    recipes: text.recipes || "",
    catalog: Array.isArray(catalog) ? catalog : [],
    angles: Array.isArray(angles) ? angles : [],
    bannedLive: Array.isArray(banned)
      ? banned.filter((x) => typeof x === "string" && x.trim())
      : loadBannedLive().phrases,
    missing,
    source: { sha: ref || null, from: sources.size === 1 ? [...sources][0] : (sources.size ? "mixed" : null) }
  };
}

// ── The store: every database step, each in its own short staff transaction ──────────

/**
 * asStaff() takes a pool. A worker passes src/db.mjs's `db` (query only), which means
 * the app's own pool; a test passes a pg Pool (connect()) or deps.pool.
 * @param {any} db @param {any} deps
 */
function scopeDeps(db, deps) {
  if (deps && typeof deps.pool === "function") return { pool: deps.pool };
  if (db && typeof db.connect === "function") return { pool: () => db };
  if (db && typeof db.pool === "function") return { pool: db.pool };
  return {};
}

const SCRIPT_TEXT_SQL = `SELECT root_script_id, hook_text, body, parts FROM ad_scripts`;

/** @param {any} row */
function scriptText(row) {
  return {
    root_script_id: row.root_script_id,
    hook: row.hook_text && String(row.hook_text).trim() ? String(row.hook_text).trim() : hookOf(row),
    body: row.body,
    parts: Array.isArray(row.parts) ? row.parts : null
  };
}

/** The last 30 live scripts of the org, newest first, leaving out one script's versions. */
async function recentScripts(tx, orgId, excludeRoot) {
  const { rows } = await tx.query(
    `${SCRIPT_TEXT_SQL}
      WHERE org_id = $1 AND archived_at IS NULL
        AND ($2::uuid IS NULL OR root_script_id <> $2::uuid)
      ORDER BY created_at DESC
      LIMIT ${RECENT_LIMIT}`,
    [orgId, excludeRoot || null]
  );
  return rows.map(scriptText);
}

/** Every live script of one batch, leaving out one script's versions. */
async function batchScripts(tx, orgId, batchId, excludeRoot) {
  const { rows } = await tx.query(
    `${SCRIPT_TEXT_SQL}
      WHERE org_id = $1 AND batch_id = $2 AND archived_at IS NULL
        AND ($3::uuid IS NULL OR root_script_id <> $3::uuid)
      ORDER BY created_at`,
    [orgId, batchId, excludeRoot || null]
  );
  return rows.map(scriptText);
}

/** The 3 closest approved scripts with the same format and funnel (same angle first). */
async function approvedExamples(tx, { orgId, format, funnelKey, angleKey, excludeRoot }) {
  const { rows } = await tx.query(
    `SELECT title, body FROM ad_scripts
      WHERE org_id = $1 AND archived_at IS NULL AND status IN ('locked', 'filmed')
        AND script_format = $2 AND funnel_key = $3
        AND ($5::uuid IS NULL OR root_script_id <> $5::uuid)
      ORDER BY (angle_key IS NOT DISTINCT FROM $4) DESC, locked_at DESC NULLS LAST, created_at DESC
      LIMIT 3`,
    [orgId, format, funnelKey, angleKey || null, excludeRoot || null]
  );
  return rows.map((r) => ({ title: r.title, body: r.body }));
}

const FUNNEL_SQL = `SELECT key, name, landing_url, offer_key, lane::text AS lane, book_call, cta_type, active
                      FROM marketing_funnels WHERE org_id = $1 AND key = $2`;

/* The four label slots and the ad_labels kind each feeds (api/scripts/write.mjs). */
const LABEL_KINDS = Object.freeze([
  ["script_type", "script_type"],
  ["angle_key", "angle"],
  ["hook_key", "hook"],
  ["offer_key", "offer"]
]);

/* What kind of piece a machine script is (ad_scripts.script_type, 377): a VSL, else a
   cold direct-response ad (RULES.md Part 3 Section 1). Both keys are in 377's seed. */
const scriptTypeOf = (format) => (format === "vsl" ? "vsl" : "cold");

/**
 * The dictionary learns: fill a blank name, never overwrite one a person typed.
 * @param {any} tx @param {string} orgId @param {Record<string, string|null>} labels
 * @param {Record<string, string>} [names] a friendlier name per angle key (angles.json)
 */
async function upsertLabels(tx, orgId, labels, names = {}) {
  for (const [column, kind] of LABEL_KINDS) {
    const key = labels[column];
    if (!key || !isLabelKey(key)) continue;
    const name = kind === "angle" && names[key] ? names[key] : friendlyName(key);
    await tx.query(
      `INSERT INTO ad_labels (org_id, kind, key, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, kind, key) DO UPDATE
         SET name = EXCLUDED.name
       WHERE ad_labels.name IS NULL`,
      [orgId, kind, key, name]
    );
  }
}

/** The columns a saved draft fills, in INSERT order after the fixed ones. */
function draftColumns(draft, checkResults) {
  return {
    title: draft.title || null,
    body: draft.body,
    hook_text: hookOf(draft) || null,
    script_type: scriptTypeOf(draft.script_format),
    lane: draft.lane || null,
    angle_key: draft.angle_key,
    hook_key: draft.hook_key,
    offer_key: draft.offer_key || null,
    script_format: draft.script_format,
    style: draft.style,
    parts: JSON.stringify(draft.parts),
    check_results: JSON.stringify(checkResults),
    animation_plan: JSON.stringify(draft.animation_plan),
    meta_copy: JSON.stringify(draft.meta_copy)
  };
}

/**
 * The default store: SQL against Postgres, every step in its own asStaff() transaction.
 * A test may replace any method through deps.store.
 * @param {any} db @param {any} deps
 */
export function makeStore(db, deps = {}) {
  const asStaff = deps.asStaff || defaultAsStaff;
  const scope = scopeDeps(db, deps);
  /** @param {(tx: any) => Promise<any>} fn */
  const inStaff = (fn) => asStaff(fn, scope);
  const screen = deps.screen || defaultScreen;
  const logUsage = deps.logUsage || defaultLogUsage;
  const costStatus = deps.costStatus || defaultCostStatus;
  const queueBuzz = deps.queueBuzz || defaultQueueBuzz;
  /* Plain queries (cost log, cost status, buzz) go to tables with an app-wide policy
     (411), so they need no staff transaction. A pool-only db is used through a client. */
  const plain = db && typeof db.query === "function" ? db : null;
  /** @param {(q: any) => Promise<any>} fn */
  const viaPlain = (fn) => (plain ? fn(plain) : inStaff(fn));

  const store = {
    /** Everything one slot needs, read in one short staff transaction. */
    async loadSlotContext({ orgId, batchId, slot }) {
      return inStaff(async (tx) => {
        const batch = batchId
          ? (await tx.query(
              `SELECT id, org_id, kind, status, rules_sha, total FROM marketing_batches
                WHERE id = $1 AND org_id = $2`, [batchId, orgId])).rows[0] || null
          : null;
        const settings = await getOrCreateSettings(tx, orgId);
        const funnel = (await tx.query(FUNNEL_SQL, [orgId, slot.funnel_key])).rows[0] || null;
        const partner = (await tx.query(
          `SELECT id FROM partners WHERE org_id = $1 AND slug = $2`, [orgId, HOUSE_PARTNER_SLUG])).rows[0] || null;
        const idea = slot.idea_id
          ? (await tx.query(
              `SELECT id, raw_points, topic, angle_key, status FROM ad_ideas WHERE id = $1 AND org_id = $2`,
              [slot.idea_id, orgId])).rows[0] || null
          : null;
        const angleKey = normaliseLabelKey(slot.angle_key || (idea && idea.angle_key) || null);
        return {
          batch, settings, funnel, idea,
          partnerId: partner ? partner.id : null,
          recent: await recentScripts(tx, orgId, null),
          siblings: batch ? await batchScripts(tx, orgId, batch.id, null) : [],
          examples: funnel
            ? await approvedExamples(tx, { orgId, format: slot.script_format, funnelKey: funnel.key, angleKey, excludeRoot: null })
            : []
        };
      });
    },

    /** Everything a fix needs: the script, its batch, funnel, and what to compare with. */
    async loadFixContext({ orgId, scriptId }) {
      return inStaff(async (tx) => {
        const script = (await tx.query(
          `SELECT id, org_id, partner_id, version, root_script_id, ad_id, status, source, archived_at,
                  title, body, parts, meta_copy, animation_plan, script_format, style, funnel_key,
                  batch_id, idea_id, angle_key, hook_key, offer_key, lane::text AS lane
             FROM ad_scripts WHERE id = $1`, [scriptId])).rows[0] || null;
        if (!script || script.org_id !== orgId) return { script: null };
        const batch = script.batch_id
          ? (await tx.query(
              `SELECT id, org_id, kind, status, rules_sha, total FROM marketing_batches WHERE id = $1`,
              [script.batch_id])).rows[0] || null
          : null;
        const settings = await getOrCreateSettings(tx, orgId);
        const funnel = script.funnel_key ? (await tx.query(FUNNEL_SQL, [orgId, script.funnel_key])).rows[0] || null : null;
        return {
          script, batch, settings, funnel,
          partnerId: script.partner_id,
          recent: await recentScripts(tx, orgId, script.root_script_id),
          siblings: batch ? await batchScripts(tx, orgId, batch.id, script.root_script_id) : [],
          examples: []
        };
      });
    },

    /** The compliance screen on the script and its Meta copy (fails closed: an error is a block). */
    async screenCopy({ orgId, partnerId, text }) {
      return inStaff((tx) => screen(tx, {
        orgId, partnerId, kind: "ad", offerType: "funding", platform: "meta", text,
        approveBeforeLaunch: true
      }));
    },

    /**
     * Saves a new draft (version 1, status draft, source machine) and its labels in ONE
     * staff transaction. The batch row is locked first, so two drafts of one batch save
     * one after the other and the batch-duplicate check below sees the first.
     * @returns {Promise<{id: string, root_script_id: string, version: number, status: string, source: string, check_results: any} | {refused: string}>}
     */
    async saveDraft({ orgId, partnerId, batch, ideaId, draft, checkResults, angleNames }) {
      return inStaff(async (tx) => {
        let results = checkResults;
        if (batch) {
          await tx.query(`SELECT id FROM marketing_batches WHERE id = $1 FOR UPDATE`, [batch.id]);
          const sibs = await batchScripts(tx, orgId, batch.id, null);
          const same = checkSameness(draft, { batch: sibs, batchTotal: Number(batch.total) || undefined });
          if (same.refused) {
            return { refused: same.reasons.filter((r) => /batch already has this/.test(r)).join(" ") || same.reasons.join(" ") };
          }
          if (same.intro.over && !(results.sameness && results.sameness.intro && results.sameness.intro.over)) {
            results = {
              ...results,
              flagged: true,
              flag_reasons: [...(results.flag_reasons || []), "Another script in this batch saved first and used up this intro (rule 31)."],
              sameness: { ...(results.sameness || {}), intro: same.intro }
            };
          }
        }
        const c = draftColumns(draft, results);
        const row = (await tx.query(
          `INSERT INTO ad_scripts
             (org_id, partner_id, version, title, body, hook_text, script_type, lane,
              angle_key, hook_key, offer_key, status, source, script_format, style, funnel_key,
              batch_id, idea_id, parts, check_results, animation_plan, meta_copy)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7::ad_lane,
                   $8, $9, $10, 'draft', 'machine', $11, $12, $13,
                   $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb)
           RETURNING id, root_script_id, version, status, source`,
          [orgId, partnerId, c.title, c.body, c.hook_text, c.script_type, c.lane,
            c.angle_key, c.hook_key, c.offer_key, c.script_format, c.style, draft.funnel_key,
            batch ? batch.id : null, ideaId || null, c.parts, c.check_results, c.animation_plan, c.meta_copy]
        )).rows[0];
        await upsertLabels(tx, orgId, { script_type: c.script_type, angle_key: c.angle_key, hook_key: c.hook_key, offer_key: c.offer_key }, angleNames);
        if (ideaId) {
          await tx.query(
            `UPDATE ad_ideas SET status = 'written', script_id = $1, batch_id = COALESCE(batch_id, $2)
              WHERE id = $3 AND org_id = $4`,
            [row.id, batch ? batch.id : null, ideaId, orgId]
          );
        }
        return { ...row, check_results: results };
      });
    },

    /**
     * Saves a fix as a new version in ONE staff transaction: lock the parent, archive it,
     * insert the new version with the same root and the same number (spec §4 trap 9).
     * A locked or filmed script's fix stays locked (its new words still need filming).
     * @returns {Promise<{id: string, version: number, status: string, ad_id: string|null, root_script_id: string} | {stale: true} | {missing: true}>}
     */
    async saveFix({ orgId, parentId, parentVersion, draft, checkResults, note, angleNames }) {
      return inStaff(async (tx) => {
        const parent = (await tx.query(
          `SELECT id, org_id, partner_id, version, root_script_id, ad_id, status, source, archived_at,
                  batch_id, idea_id, funnel_key, film_order, locked_at, locked_by
             FROM ad_scripts WHERE id = $1 FOR UPDATE`, [parentId])).rows[0];
        if (!parent || parent.org_id !== orgId) return { missing: true };
        if (parent.archived_at || Number(parent.version) !== Number(parentVersion)) return { stale: true };
        const archived = await tx.query(
          `UPDATE ad_scripts
              SET archived_at = now(),
                  status = CASE WHEN source = 'machine' THEN 'superseded' ELSE status END
            WHERE id = $1 AND archived_at IS NULL`, [parent.id]);
        if (archived.rowCount !== 1) return { stale: true };
        const locked = parent.status === "locked" || parent.status === "filmed";
        const c = draftColumns(draft, checkResults);
        const row = (await tx.query(
          `INSERT INTO ad_scripts
             (org_id, partner_id, parent_script_id, version, title, body, hook_text, script_type, lane,
              angle_key, hook_key, offer_key, root_script_id, ad_id, status, source,
              script_format, style, funnel_key, batch_id, idea_id,
              parts, check_results, fix_note, animation_plan, meta_copy,
              film_order, locked_at, locked_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::ad_lane,
                   $10, $11, $12, $13, $14, $15, 'machine',
                   $16, $17, $18, $19, $20,
                   $21::jsonb, $22::jsonb, $23, $24::jsonb, $25::jsonb,
                   $26, $27, $28)
           RETURNING id, root_script_id, version, status, ad_id`,
          [orgId, parent.partner_id, parent.id, Number(parent.version) + 1, c.title, c.body, c.hook_text, c.script_type, c.lane,
            c.angle_key, c.hook_key, c.offer_key, parent.root_script_id, parent.ad_id, locked ? "locked" : "draft",
            c.script_format, c.style, parent.funnel_key ?? draft.funnel_key ?? null, parent.batch_id, parent.idea_id,
            c.parts, c.check_results, String(note ?? ""), c.animation_plan, c.meta_copy,
            parent.film_order, locked ? parent.locked_at : null, locked ? parent.locked_by : null]
        )).rows[0];
        await upsertLabels(tx, orgId, { script_type: c.script_type, angle_key: c.angle_key, hook_key: c.hook_key, offer_key: c.offer_key }, angleNames);
        return row;
      });
    },

    /** A slot that could not be written: its idea says why (never for a retryable failure). */
    async markIdeaFailed({ orgId, ideaId, reason }) {
      if (!ideaId) return;
      await inStaff((tx) => tx.query(
        `UPDATE ad_ideas SET status = 'failed', failure_reason = $1, attempts = attempts + 1
          WHERE id = $2 AND org_id = $3 AND status <> 'written'`,
        [String(reason || "the writer failed").slice(0, 1000), ideaId, orgId]));
    },

    /** @param {any} row */
    logUsage: (row) => viaPlain((q) => logUsage(q, row)),

    /** @param {any} args */
    costStatus: (args) => viaPlain((q) => costStatus(q, args)),

    /** One buzz per group, ever: a cap buzz already queued or sent is not queued again. */
    async buzzOnce({ orgId, kind, groupKey, body, quietStart, quietEnd, tz }) {
      return viaPlain(async (q) => {
        const seen = await q.query(
          `SELECT 1 FROM marketing_buzzes WHERE org_id = $1 AND kind = $2 AND group_key = $3 LIMIT 1`,
          [orgId, kind, groupKey]);
        if (seen.rows.length) return { queued: false };
        await queueBuzz(q, { orgId, kind, body, groupKey, quietStart, quietEnd, tz });
        return { queued: true };
      });
    }
  };
  return deps.store ? { ...store, ...deps.store } : store;
}

// ── Turning a reply into a draft ──────────────────────────────────────────────────────

/**
 * The reply as a draft the checks and the save can use. The slot's own facts win over
 * whatever the reply echoed: format, style, offer, lane, funnel and the Meta button come
 * from the slot and the funnel, and a slot that names its angle keeps that angle.
 * Returns null when the reply has no script in it.
 * @param {any} json @param {any} run
 * @returns {{ draft: any, parseErrors: string[] } | null}
 */
export function normalizeDraft(json, run) {
  if (!isObj(json) || typeof json.body !== "string" || !json.body.trim()) return null;
  const parseErrors = [];
  const parts = (Array.isArray(json.parts) ? json.parts : [])
    .filter((p) => isObj(p))
    .map((p) => ({ kind: String(p.kind ?? ""), text: String(p.text ?? "").trim() }));
  const meta = isObj(json.meta_copy) ? json.meta_copy : {};
  const plan = (Array.isArray(json.animation_plan) ? json.animation_plan : []).map((item, i) => {
    const it = isObj(item) ? item : {};
    let props = {};
    if (isObj(it.props)) props = it.props;
    else if (typeof it.props === "string" && it.props.trim()) {
      try {
        const parsed = JSON.parse(it.props);
        if (isObj(parsed)) props = parsed;
        else parseErrors.push(`Animation ${i + 1}: props must be a JSON object written as text, like "{}".`);
      } catch {
        parseErrors.push(`Animation ${i + 1}: props is not valid JSON. Write a JSON object as text, like "{}".`);
      }
    }
    const a = isObj(it.anchor) ? it.anchor : {};
    const anchor = run.style === "bullets"
      ? { cue: Number.isInteger(a.cue) ? a.cue : (a.cue ?? null), keyword: typeof a.keyword === "string" ? a.keyword : null }
      : { phrase: typeof a.phrase === "string" ? a.phrase : null };
    return { anchor, template: typeof it.template === "string" ? it.template : null, props, seconds: it.seconds };
  });
  const replyAngle = normaliseLabelKey(json.angle_key);
  const angleKey = run.angleKey || (replyAngle && isLabelKey(replyAngle) ? replyAngle : (run.fallbackAngleKey || replyAngle));
  return {
    draft: {
      title: squash(json.title) || (run.angle ? run.angle.name : null) || null,
      angle_key: angleKey,
      hook_key: normaliseLabelKey(json.hook_key),
      offer_key: run.offerKey,
      lane: run.lane,
      funnel_key: run.funnelKey,
      script_format: run.format,
      style: run.style,
      body: json.body.replace(/\r\n?/g, "\n").trim(),
      parts,
      meta_copy: {
        primary_text: String(meta.primary_text ?? "").trim(),
        headline: String(meta.headline ?? "").trim(),
        description: String(meta.description ?? "").trim(),
        cta_type: run.ctaType
      },
      animation_plan: plan
    },
    parseErrors
  };
}

// ── The code checks ───────────────────────────────────────────────────────────────────

/** Every part is a known kind and sits in the body word for word, in order. */
function checkParts(draft) {
  const errors = [];
  const flatBody = squash(String(draft.body).split("\n").map((l) => l.replace(CUE_MARK, "")).join("\n"));
  let at = 0;
  draft.parts.forEach((p, i) => {
    const n = i + 1;
    if (!PART_KINDS.includes(p.kind)) {
      errors.push(`Part ${n} has kind "${p.kind}". A part is one of ${PART_KINDS.join(", ")}.`);
      return;
    }
    const t = squash(String(p.text).replace(CUE_MARK, ""));
    if (!t) { errors.push(`Part ${n} (${p.kind}) is empty.`); return; }
    const found = flatBody.indexOf(t, at);
    if (found >= 0) { at = found + t.length; return; }
    errors.push(flatBody.includes(t)
      ? `Part ${n} (${p.kind}) is out of order. List the parts in the order they appear in the body.`
      : `Part ${n} (${p.kind}) is not in the body word for word: "${t.slice(0, 80)}". Copy each part from the body exactly.`);
  });
  if (!draft.parts.length) errors.push("There are no parts. Mark every piece of the body as a part.");
  if (["standard", "sorting"].includes(draft.script_format)) {
    for (const kind of ["hook", "cta"]) {
      if (!draft.parts.some((p) => p.kind === kind)) errors.push(`There is no ${kind} part. A ${draft.script_format} script has a hook and a cta.`);
    }
  }
  return { passed: errors.length === 0, errors };
}

/* The checker's hook and close rules read the first two lines as a hook and the text as
   a script. Meta copy is neither, so only the word rules apply to it. */
const HOOK_SHAPE_RULES = new Set(["opener", "cause-first-2", "cause-first-3", "close-promises", "length", "bullets-shape", "empty"]);

/** The Meta copy: present, a headline of 40 characters or fewer, and the same word rules. */
function checkMetaCopy(draft, bannedLive) {
  const m = draft.meta_copy;
  const failures = [];
  if (!m.primary_text) failures.push({ rule: "meta-primary-text", message: "The Meta primary_text is empty." });
  if (!m.headline) failures.push({ rule: "meta-headline", message: "The Meta headline is empty." });
  else if ([...m.headline].length > HEADLINE_MAX) {
    failures.push({ rule: "meta-headline", message: `The Meta headline has ${[...m.headline].length} characters. It must be ${HEADLINE_MAX} or fewer.` });
  }
  const text = [m.primary_text, m.headline, m.description].filter(Boolean).join("\n");
  if (text) {
    const r = checkScriptText(text, { strict: true, bannedLive });
    for (const f of r.failures) {
      if (!HOOK_SHAPE_RULES.has(f.rule)) failures.push({ rule: f.rule, message: `Meta copy: ${f.message}` });
    }
  }
  return { passed: failures.length === 0, failures };
}

/** Every way a known offer price can be written: with and without the thousands comma,
 *  with and without ".00". Built from offerFacts(), never typed here. */
function priceForms() {
  const out = [];
  for (const key of OFFER_KEYS) {
    const f = offerFacts(key);
    const p = f ? formatPrice(f.price_cents) : null;
    if (!p) continue;
    out.push(p, p.replace(/,/g, ""));
    if (!p.includes(".")) out.push(`${p}.00`, `${p.replace(/,/g, "")}.00`);
  }
  return [...new Set(out)];
}

/** Rule 29: a book-a-call ad never mentions a price. Prices come only from offerFacts(). */
function checkOffer(draft, bookCall) {
  const failures = [];
  if (bookCall) {
    const m = draft.meta_copy;
    const text = [draft.body, m.primary_text, m.headline, m.description].join("\n");
    for (const p of priceForms()) {
      const re = new RegExp(`${p.replace(/[$.]/g, (c) => `\\${c}`)}(?!\\d|[.,]\\d)`);
      if (re.test(text)) {
        failures.push({ rule: "book-call-price", message: `This is a book-a-call ad, so it never says a price (rule 29). It says ${p}.` });
      }
    }
  }
  return { passed: failures.length === 0, failures, book_call: bookCall };
}

/** The angle and hook keys must be keys the database takes. */
function checkLabels(draft) {
  const failures = [];
  for (const k of ["angle_key", "hook_key"]) {
    if (!draft[k] || !isLabelKey(draft[k])) {
      failures.push({ rule: "label", message: `${k} "${draft[k] ?? ""}" is not a usable key. A key is lower case letters, digits and underscores, starts with a letter, and is 2 to 49 characters long.` });
    }
  }
  return { passed: failures.length === 0, failures };
}

/* Compliance reasons that say nothing about the words: the approval gate (every ad waits
   for Chris anyway) and a Meta category that is not configured yet (the loader, U28,
   blocks on that itself at load). Everything else, including an engine error, counts. */
/** @param {any} r */
const isCopyReason = (r) => r && r.rule_set !== "approval" && r.code !== "special_ad_category_unset" && r.severity !== "warn";

/**
 * Every code check on one candidate. Async only for the compliance screen.
 * @param {any} run @param {{ draft: any, parseErrors: string[] }} cand
 */
async function codeChecks(run, cand) {
  const d = cand.draft;
  const strict = checkScriptText(d.body, { format: d.script_format, style: d.style, strict: true, parts: d.parts, bannedLive: run.bannedLive });
  const parts = checkParts(d);
  const anim = validateAnimationPlan(d.animation_plan, { catalog: run.catalog, body: d.body, parts: d.parts, style: d.style, scriptFormat: d.script_format });
  const animation = {
    passed: anim.ok && cand.parseErrors.length === 0,
    errors: [...cand.parseErrors.map((message) => ({ item: null, code: "bad_props", message })), ...anim.errors]
  };
  const meta = checkMetaCopy(d, run.bannedLive);
  const offer = checkOffer(d, run.bookCall);
  const labels = checkLabels(d);
  const m = d.meta_copy;
  const screened = await run.store.screenCopy({
    orgId: run.orgId, partnerId: run.partnerId,
    text: [d.body, m.primary_text, m.headline, m.description].filter(Boolean).join("\n\n")
  });
  const copyReasons = (screened.reasons || []).filter(isCopyReason);
  const compliance = { state: screened.state, reasons: screened.reasons || [], copy_blocked: copyReasons.length > 0 };

  const problems = [
    ...strict.failures.map((f) => `Rule check${f.line ? ` (line ${f.line})` : ""}: ${f.message}`),
    ...parts.errors,
    ...animation.errors.map((e) => `Animation plan: ${e.message}`),
    ...meta.failures.map((f) => f.message),
    ...offer.failures.map((f) => f.message),
    ...labels.failures.map((f) => f.message),
    ...copyReasons.map((r) => `Compliance: ${r.message}`)
  ];
  const failedAreas = [
    !strict.ok && "the rule checker",
    !parts.passed && "the parts",
    !animation.passed && "the animation plan",
    !meta.passed && "the Meta copy",
    !offer.passed && "the price rule",
    !labels.passed && "the label keys",
    compliance.copy_blocked && "the compliance screen"
  ].filter(Boolean);
  return { ok: problems.length === 0, strict, parts, animation, meta, offer, labels, compliance, problems, failedAreas };
}

// ── Calling Claude ────────────────────────────────────────────────────────────────────

/** @param {string|null} reason */
function temporaryWords(reason) {
  switch (reason) {
    case MODEL_NO_CREDIT: return "The writer stopped: the Anthropic account is out of credit.";
    case MODEL_RATE_LIMITED: return "The writer stopped: Anthropic said too many requests. It will try again.";
    case MODEL_SERVER_ERROR: return "The writer stopped: Anthropic had a server error. It will try again.";
    case MODEL_UNREACHABLE: return "The writer stopped: it could not reach Anthropic. It will try again.";
    default: return "The writer stopped for a moment. It will try again.";
  }
}

/**
 * What went wrong with one reply, in plain words, or null when it holds JSON.
 * kind: no_json (retry once) | refusal | temporary (the job retries) | permanent.
 * @param {any} res @param {number} timeoutMs
 */
export function failureOf(res, timeoutMs) {
  if (!res) return { kind: "permanent", reason: "The writer got no answer at all." };
  if (!res.error) {
    return isObj(res.json) ? null : { kind: "no_json", reason: "Claude's reply had no script in it." };
  }
  const e = String(res.error);
  if (res.stopReason === "refusal" || e.startsWith("refused:")) {
    const category = (res.raw && res.raw.stop_details && res.raw.stop_details.category) || null;
    return { kind: "refusal", category, reason: `Claude refused to write this (category: ${category || "none given"}).` };
  }
  if (e === MODEL_NO_JSON) return { kind: "no_json", reason: "Claude's reply had no script in it." };
  if (e.startsWith("cut off:")) return { kind: "no_json", reason: "Claude's reply was cut off before it finished." };
  if (e.startsWith(MODEL_NOT_SENT)) {
    return { kind: "permanent", reason: `The writer could not call Claude: ${e.slice(MODEL_NOT_SENT.length)}` };
  }
  if (/^anthropic timeout/.test(e)) {
    return { kind: "temporary", reason: `The writer stopped: the model took longer than ${Math.round(timeoutMs / 60_000)} minutes.` };
  }
  const c = classifyModelFailure({ status: res.status, error: e });
  if (c.temporary) return { kind: "temporary", reason: temporaryWords(c.reason) };
  return { kind: "permanent", reason: `The writer stopped: Anthropic refused the request (HTTP ${res.status ?? "unknown"}).` };
}

/** The cost caps, before every call. At a cap: one buzz, and the caller stops. */
async function capCheck(run) {
  const s = run.settings || {};
  const status = await run.store.costStatus({
    orgId: run.orgId, batchId: run.batchId,
    maxBatchUsd: s.max_batch_cost_usd, maxMonthUsd: s.max_month_cost_usd, now: new Date(run.now())
  });
  if (!status.batch_capped && !status.month_capped) return null;
  const which = status.month_capped ? "month" : "batch";
  const cap = Number(which === "month" ? s.max_month_cost_usd : s.max_batch_cost_usd);
  const capText = Number.isFinite(cap) ? ` $${cap}` : "";
  const body = which === "month"
    ? `The script writer stopped. This month's Claude spend hit the${capText} cap. Raise the cap in Settings to keep writing.`
    : `The script writer stopped. This batch's Claude spend hit the${capText} cap, so some scripts were not written. Raise the cap in Settings to write the rest.`;
  const groupKey = which === "month" ? `month:${arizonaMonth(run.now())}` : `batch:${run.batchId}`;
  await run.store.buzzOnce({
    orgId: run.orgId, kind: COST_CAP_BUZZ_KIND, groupKey, body,
    quietStart: s.quiet_start, quietEnd: s.quiet_end, tz: s.timezone
  });
  return { which, status };
}

/** One Claude call: the cap check, the call, and the cost log. */
async function modelCall(run, { purpose, model, system, user, schema, maxTokens, timeoutMs, effort }) {
  const capped = await capCheck(run);
  if (capped) return { capped };
  const res = await run.callModel({
    provider: "anthropic", model, system, user, env: run.env, fetchImpl: run.fetchImpl,
    maxTokens, timeoutMs, effort, cache: true, outputSchema: schema
  });
  if (res && res.mode !== "shadow") {
    const u = res.usage || {};
    const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (res.servedModel || tokens > 0) {
      const served = res.servedModel || model;
      await run.store.logUsage({ orgId: run.orgId, batchId: run.batchId, jobId: run.jobId, model: served, usage: u });
      run.calls.push({ purpose, model: served });
    }
  }
  return { res };
}

/**
 * The writer: one call, with one retry when the reply holds no JSON.
 * @returns {Promise<any>} {draft, parseErrors, raw} | {fail} | {capped}
 */
async function writeDraft(run, user) {
  /** @type {any} */
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await modelCall(run, {
      purpose: "write", model: run.writerModel, system: run.system, user, schema: SAVE_SCRIPT_SCHEMA,
      maxTokens: WRITER_MAX_TOKENS, timeoutMs: WRITER_TIMEOUT_MS, effort: WRITER_EFFORT
    });
    if (r.capped) return { capped: r.capped };
    let f = failureOf(r.res, WRITER_TIMEOUT_MS);
    if (!f) {
      const cand = normalizeDraft(r.res.json, run);
      if (cand) return { ...cand, raw: r.res.json };
      f = { kind: "no_json", reason: "Claude's reply had no script in it." };
    }
    last = f;
    if (f.kind === "no_json" && attempt === 1) continue;
    if (f.kind === "no_json") {
      return { fail: { kind: "permanent", reason: `${f.reason.replace(/\.$/, "")}, twice. Nothing was saved.` } };
    }
    return { fail: f };
  }
  return { fail: last };
}

/**
 * The judge: one pass, with one retry when the reply holds no JSON.
 * @returns {Promise<any>} {judge} | {capped}
 */
async function runJudge(run, draft) {
  const base = { ran: false, passed: null, model: run.checkModel, notes: [], sent_back: false, taken: false, error: null };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await modelCall(run, {
      purpose: "judge", model: run.checkModel, system: run.judgeSystem,
      user: buildJudgeUser({ draft, bookCall: run.bookCall, offerLabel: run.offer ? run.offer.label : null, note: run.note }),
      schema: JUDGE_SCHEMA, maxTokens: CHECK_MAX_TOKENS, timeoutMs: CHECK_TIMEOUT_MS, effort: CHECK_EFFORT
    });
    if (r.capped) return { capped: r.capped };
    let f = failureOf(r.res, CHECK_TIMEOUT_MS);
    if (!f) {
      const v = r.res.json.violations;
      if (Array.isArray(v)) {
        const notes = v
          .filter((x) => isObj(x) && Number.isInteger(x.rule) && JUDGED_RULES.includes(x.rule))
          .map((x) => ({ rule: x.rule, quote: squash(x.quote), fix: squash(x.fix) }));
        return { judge: { ...base, ran: true, passed: notes.length === 0, notes } };
      }
      f = { kind: "no_json", reason: "The judge's reply had no list in it." };
    }
    if (f.kind === "no_json" && attempt === 1) continue;
    return { judge: { ...base, error: f.reason } };
  }
  return { judge: base };
}

/** True when a whole call still fits before the deadline. */
const timeLeft = (run) => run.now() + WRITER_TIMEOUT_MS <= run.deadlineAt;

/**
 * The check loop on a first draft: code-check rounds, the judge, sameness.
 * @param {any} run @param {any} first @param {string} basePrompt
 */
async function checkLoop(run, first, basePrompt) {
  let cur = first;
  let det = await codeChecks(run, cur);
  const notes = { time_ran_out: false, rewrite_errors: /** @type {string[]} */ ([]) };
  /** Asks for a rewrite; returns the new candidate or null (and notes why). */
  const rewrite = async (problems) => {
    if (!timeLeft(run)) { notes.time_ran_out = true; return { none: true }; }
    const next = await writeDraft(run, buildRewritePrompt(basePrompt, cur.raw, problems));
    if (next.capped) return { capped: next.capped };
    if (next.fail) { notes.rewrite_errors.push(next.fail.reason); return { none: true }; }
    return { cand: next, det: await codeChecks(run, next) };
  };

  // 1. Code checks: up to 2 rounds.
  let rounds = 0;
  while (!det.ok && rounds < STRICT_ROUNDS) {
    const r = await rewrite(det.problems);
    if (r.capped) return { capped: r.capped };
    if (r.none) break;
    rounds++;
    if (r.det.ok || r.det.problems.length <= det.problems.length) { cur = r.cand; det = r.det; }
  }

  // 2. The judge: one pass; violations go back once.
  /** @type {any} */
  let judge;
  if (timeLeft(run)) {
    const j = await runJudge(run, cur.draft);
    if (j.capped) return { capped: j.capped };
    judge = j.judge;
    if (judge.ran && judge.notes.length) {
      judge.sent_back = true;
      const r = await rewrite(judge.notes.map((v) => `Rule ${v.rule}: "${v.quote}". ${v.fix}`));
      if (r.capped) return { capped: r.capped };
      if (!r.none && (r.det.ok || !det.ok)) { cur = r.cand; det = r.det; judge.taken = true; }
    }
  } else {
    notes.time_ran_out = true;
    judge = { ran: false, passed: null, model: run.checkModel, notes: [], sent_back: false, taken: false, error: "there was not enough time left to run it" };
  }

  // 3. Sameness: one rewrite.
  let same = checkSameness(cur.draft, run.sameCtx);
  let sameRewritten = false;
  if (same.rewrite) {
    const r = await rewrite(same.reasons);
    if (r.capped) return { capped: r.capped };
    if (!r.none && (r.det.ok || !det.ok)) {
      cur = r.cand; det = r.det; same = checkSameness(cur.draft, run.sameCtx); sameRewritten = true;
    }
  }
  return { cur, det, judge, same, sameRewritten, rounds, notes };
}

/** check_results: what every check said, and whether the draft needs a look. */
function buildCheckResults(run, loop) {
  const { det, judge, same } = loop;
  const reasons = [];
  if (!det.ok) reasons.push(`It still fails ${det.failedAreas.join(", ")} after ${plural(loop.rounds, "rewrite round")}.`);
  if (!judge.ran) reasons.push(`The rule judge did not run: ${judge.error || "no reason given"}.`.replace(/\.\.$/, "."));
  else if (judge.notes.length && !judge.taken) reasons.push(`The rule judge found ${plural(judge.notes.length, "problem")} the rewrite did not fix.`);
  if (same.overlap_too_high) {
    reasons.push(`It is still close to a recent script (hook ${Math.round(same.hook_overlap * 100)}%, body ${Math.round(same.body_overlap * 100)}%).`);
  }
  if (same.intro.over) reasons.push("It uses an intro this batch has already used up (rule 31).");
  if (same.refused) reasons.push("Another script in this batch has the same hook or call to action.");
  return {
    version: 1,
    flagged: reasons.length > 0,
    flag_reasons: reasons,
    strict: { passed: det.strict.ok, rounds: loop.rounds, failures: det.strict.failures, warnings: det.strict.warnings, words: det.strict.words },
    parts: det.parts,
    animation: det.animation,
    meta_copy: det.meta,
    offer: det.offer,
    labels: det.labels,
    judge: { passed: judge.ran ? judge.notes.length === 0 : null, ran: judge.ran, model: judge.model, notes: judge.notes, sent_back: judge.sent_back, taken: judge.taken, error: judge.error },
    compliance: det.compliance,
    sameness: {
      hook_overlap: same.hook_overlap, body_overlap: same.body_overlap,
      duplicate_hook: same.duplicate_hook, duplicate_cta: same.duplicate_cta,
      intro: same.intro, rewritten: loop.sameRewritten, refused: same.refused
    },
    rules: run.rulesSource,
    time_ran_out: loop.notes.time_ran_out,
    rewrite_errors: loop.notes.rewrite_errors,
    models: { writer: run.writerModel, check: run.checkModel },
    calls: run.calls
  };
}

// ── Building a run ────────────────────────────────────────────────────────────────────

/** @param {any} settings @param {string} format */
function styleFor(settings, format) {
  const fs = settings && isObj(settings.format_style) ? settings.format_style : {};
  const s = fs[format];
  if (STYLES.includes(s)) return s;
  return /** @type {Record<string,string>} */ (DEFAULT_STYLE)[format] || "words";
}

/** What the batch has used so far: hooks, CTAs, intros. */
function batchUse(siblings, batchTotal) {
  const caps = introCaps(Math.max(Number(batchTotal) || 0, siblings.length + 1));
  const kinds = siblings.map((s) => introKind(s.body));
  return {
    batchUsed: { hooks: siblings.map((s) => s.hook), ctas: siblings.map((s) => ctaOf(s)) },
    intro: {
      long_used: kinds.filter((k) => k === "long").length,
      short_used: kinds.filter((k) => k === "short").length,
      long_cap: caps.long, short_cap: caps.short
    }
  };
}

/** @param {string} reason @param {object} [extra] */
const failed = (reason, extra = {}) => ({ failed: true, reason, temporary: false, ...extra });

/**
 * The parts of a run every path shares.
 * @param {any} db @param {Record<string, any>} env @param {any} deps @param {any} ctx
 */
async function makeRun(db, env, deps, ctx) {
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  const start = now();
  const readRules = deps.readRuleFiles || readRuleFiles;
  const rules = await readRules(env, { ref: ctx.rulesSha || null, fetchImpl: deps.fetchImpl, getContents: deps.getContents });
  const angle = ctx.angleKey ? (rules.angles.find((a) => normaliseLabelKey(a.key) === ctx.angleKey) || null) : null;
  return {
    rules,
    run: {
      env, store: ctx.store, orgId: ctx.orgId, batchId: ctx.batchId || null, jobId: deps.jobId || null,
      partnerId: ctx.partnerId, settings: ctx.settings,
      callModel: deps.callModel || defaultCallModel, fetchImpl: deps.fetchImpl,
      writerModel: writerModel(env), checkModel: checkModel(env),
      now, deadlineAt: Number.isFinite(deps.deadlineAt) ? deps.deadlineAt : start + WRITER_BUDGET_MS,
      system: buildSystemPrompt({ rules: rules.rules, voice: rules.voice, recipes: rules.recipes, catalog: rules.catalog, angles: rules.angles, format: ctx.format }),
      judgeSystem: buildJudgeSystem(rules.rules),
      catalog: rules.catalog, bannedLive: rules.bannedLive,
      rulesSource: { ...rules.source, missing: rules.missing },
      format: ctx.format, style: ctx.style, funnelKey: ctx.funnel ? ctx.funnel.key : null,
      lane: ctx.lane, offerKey: ctx.offerKey, offer: ctx.offer, bookCall: ctx.bookCall,
      ctaType: (ctx.funnel && ctx.funnel.cta_type) || "LEARN_MORE",
      /* angleKey: the angle the draft must carry, whatever the reply says (a slot that
         names its angle). fallbackAngleKey: the angle kept when the reply's key is not
         usable (a fix keeps its angle unless Chris's note changes it). */
      angleKey: ctx.forceAngle && ctx.angleKey ? (angle ? normaliseLabelKey(angle.key) : ctx.angleKey) : null,
      fallbackAngleKey: ctx.angleKey || null,
      angle,
      note: ctx.note || null,
      sameCtx: { recent: ctx.recent, batch: ctx.siblings, batchTotal: Number(ctx.batchTotal) || undefined },
      calls: []
    },
    angle
  };
}

/** The angle names from angles.json, by key (for the dictionary's friendly names). */
function angleNames(angles) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of angles || []) {
    const k = normaliseLabelKey(a && a.key);
    if (k && a.name) out[k] = String(a.name);
  }
  return out;
}

// ── writeSlot ─────────────────────────────────────────────────────────────────────────

/**
 * Writes one draft for one plan slot and saves it.
 *
 * writeSlot(db, env, {batch, slot}, deps)
 *   batch  the marketing_batches row, or its id (null for a slot with no batch)
 *   slot   the planner's slot {n, funnel_key, script_format, style, source, angle_key, idea_id, reason}
 *   deps   {orgId, jobId, deadlineAt, now, fetchImpl, callModel, store, pool, asStaff, readRuleFiles, getContents}
 * → {script_id, flagged, check_results}
 * | {failed:true, reason, temporary}   temporary:true = the job should run again later
 *
 * @param {any} db @param {Record<string, any>} env
 * @param {{ batch?: any, slot?: any }} input @param {any} [deps]
 */
export async function writeSlot(db, env, { batch = null, slot = null } = {}, deps = {}) {
  const store = makeStore(db, deps);
  const batchId = typeof batch === "string" ? batch : (batch && batch.id) || null;
  const orgId = deps.orgId || (batch && typeof batch === "object" ? batch.org_id : null);
  if (!orgId) throw new TypeError("writeSlot: orgId is required (deps.orgId or batch.org_id)");
  if (!isObj(slot) || !slot.funnel_key || !slot.script_format) {
    return failed("The slot has no funnel or no format, so nothing was written.");
  }
  if (!SCRIPT_FORMATS.includes(slot.script_format)) {
    return failed(`The slot's format "${slot.script_format}" is not one the writer knows.`);
  }

  const ctx = await store.loadSlotContext({ orgId, batchId, slot });
  const ideaId = ctx.idea ? ctx.idea.id : null;
  const giveUp = async (reason, extra = {}) => {
    await store.markIdeaFailed({ orgId, ideaId, reason });
    return failed(reason, extra);
  };
  if (batchId && !ctx.batch) return giveUp("The batch for this slot was not found.");
  if (!ctx.funnel) return giveUp(`There is no funnel named ${slot.funnel_key}.`);
  if (!ctx.partnerId) return giveUp("This company has no Fundhub (house) partner to file the script under.");

  const format = slot.script_format;
  const style = STYLES.includes(slot.style) ? slot.style : styleFor(ctx.settings, format);
  const offer = offerFacts(ctx.funnel.offer_key);
  const bookCall = !!ctx.funnel.book_call || !!(offer && offer.book_call);
  const angleKey = normaliseLabelKey(slot.angle_key || (ctx.idea && ctx.idea.angle_key) || null);

  const { run, rules } = await makeRun(db, env, deps, {
    store, orgId, batchId, partnerId: ctx.partnerId, settings: ctx.settings,
    rulesSha: ctx.batch ? ctx.batch.rules_sha : null,
    format, style, funnel: ctx.funnel, lane: ctx.funnel.lane, offerKey: offer ? offer.key : (ctx.funnel.offer_key || null),
    offer, bookCall, angleKey, forceAngle: true,
    recent: ctx.recent, siblings: ctx.siblings, batchTotal: ctx.batch ? ctx.batch.total : null
  });
  if (rules.missing.length) {
    return giveUp(`The writer could not read ${rules.missing.join(" and ")}, so nothing was written.`);
  }

  const use = batchUse(ctx.siblings, ctx.batch ? ctx.batch.total : null);
  const base = buildUserPrompt({
    slot: { ...slot, script_format: format }, style, funnel: ctx.funnel, offer, angle: run.angle,
    angleKey, idea: ctx.idea, recentHooks: ctx.recent.map((r) => r.hook),
    batchUsed: use.batchUsed, intro: use.intro, examples: ctx.examples
  });

  const first = await writeDraft(run, base);
  if (first.capped) return giveUp(COST_CAP_REASON, { cost_cap: first.capped.which });
  if (first.fail) {
    if (first.fail.kind === "temporary") return { failed: true, reason: first.fail.reason, temporary: true };
    return giveUp(first.fail.reason, first.fail.category ? { category: first.fail.category } : {});
  }

  const loop = await checkLoop(run, first, base);
  if (loop.capped) return giveUp(COST_CAP_REASON, { cost_cap: loop.capped.which });
  if (loop.same.refused) {
    return giveUp(`Refused: ${loop.same.reasons.filter((r) => /batch already has this/.test(r)).join(" ")} The one rewrite did not change it.`);
  }

  const checkResults = buildCheckResults(run, loop);
  const saved = await store.saveDraft({
    orgId, partnerId: ctx.partnerId, batch: ctx.batch, ideaId, draft: loop.cur.draft,
    checkResults, angleNames: angleNames(rules.angles)
  });
  if (saved.refused) return giveUp(`Refused: ${saved.refused}`);
  return { script_id: saved.id, flagged: saved.check_results.flagged === true, check_results: saved.check_results };
}

// ── fixScript ─────────────────────────────────────────────────────────────────────────

/**
 * Rewrites one script from Chris's note into a new version (archive + insert in one
 * transaction, same root, same ad number; a locked script's fix stays locked).
 *
 * fixScript(db, env, {script_id, version, note}, deps)
 * → {script_id, version, status, flagged, check_results}   script_id is the NEW version's id
 * | {failed:true, reason, temporary}
 *
 * Rule 0 (Chris's word beats every rule): the judge is told his note, and a hook or CTA
 * another script in the batch also has is flagged here, never refused.
 *
 * @param {any} db @param {Record<string, any>} env
 * @param {{ script_id?: string, version?: number, note?: string }} input @param {any} [deps]
 */
export async function fixScript(db, env, { script_id, version, note } = {}, deps = {}) {
  const store = makeStore(db, deps);
  const orgId = deps.orgId;
  if (!orgId) throw new TypeError("fixScript: orgId is required (deps.orgId)");
  if (!script_id) return failed("The fix names no script.");
  if (!String(note ?? "").trim()) return failed("The fix has no note from Chris, so nothing was changed.");

  const ctx = await store.loadFixContext({ orgId, scriptId: script_id });
  const s = ctx.script;
  if (!s) return failed("The script to fix was not found.");
  if (s.archived_at || (version != null && Number(version) !== Number(s.version))) {
    return failed("A newer version of this script was saved before the fix ran, so the fix was skipped. Ask again on the newest version.");
  }
  if (!ctx.partnerId) return failed("The script has no partner to file the new version under.");

  /* A script with no format was not written by the machine. The fix treats it as a
     standard ad (the default format of both funnels' mixes). */
  const format = SCRIPT_FORMATS.includes(s.script_format) ? s.script_format : "standard";
  const style = STYLES.includes(s.style) ? s.style : styleFor(ctx.settings, format);
  const offerKey = s.offer_key || (ctx.funnel && ctx.funnel.offer_key) || null;
  const offer = offerKey ? offerFacts(offerKey) : null;
  const bookCall = !!(ctx.funnel && ctx.funnel.book_call) || !!(offer && offer.book_call);
  const angleKey = normaliseLabelKey(s.angle_key);

  const { run, rules } = await makeRun(db, env, deps, {
    store, orgId, batchId: ctx.batch ? ctx.batch.id : null, partnerId: ctx.partnerId, settings: ctx.settings,
    rulesSha: null, // a fix reads the newest rules: Chris may have just added the rule his note is about
    format, style, funnel: ctx.funnel || { key: s.funnel_key, lane: s.lane, cta_type: (s.meta_copy && s.meta_copy.cta_type) || null },
    lane: (ctx.funnel && ctx.funnel.lane) || s.lane || null, offerKey, offer, bookCall,
    angleKey, forceAngle: false, note,
    recent: ctx.recent, siblings: ctx.siblings, batchTotal: ctx.batch ? ctx.batch.total : null
  });
  if (rules.missing.length) return failed(`The writer could not read ${rules.missing.join(" and ")}, so nothing was changed.`);

  const use = batchUse(ctx.siblings, ctx.batch ? ctx.batch.total : null);
  const base = buildFixPrompt({
    slot: { funnel_key: s.funnel_key || "", script_format: format }, style,
    funnel: ctx.funnel || { key: s.funnel_key, lane: s.lane, cta_type: run.ctaType }, offer, angle: run.angle, angleKey,
    idea: null, recentHooks: ctx.recent.map((r) => r.hook), batchUsed: use.batchUsed, intro: use.intro,
    script: { version: s.version, title: s.title, body: s.body, parts: s.parts, meta_copy: s.meta_copy, animation_plan: s.animation_plan },
    note: String(note)
  });

  const first = await writeDraft(run, base);
  if (first.capped) return failed(COST_CAP_REASON, { cost_cap: first.capped.which });
  if (first.fail) {
    if (first.fail.kind === "temporary") return { failed: true, reason: first.fail.reason, temporary: true };
    return failed(first.fail.reason, first.fail.category ? { category: first.fail.category } : {});
  }
  const loop = await checkLoop(run, first, base);
  if (loop.capped) return failed(COST_CAP_REASON, { cost_cap: loop.capped.which });

  const checkResults = buildCheckResults(run, loop);
  const saved = await store.saveFix({
    orgId, parentId: s.id, parentVersion: s.version, draft: loop.cur.draft, checkResults,
    note: String(note), angleNames: angleNames(rules.angles)
  });
  if (saved.missing) return failed("The script to fix was not found.");
  if (saved.stale) {
    return failed("A newer version of this script was saved while the fix was being written, so the fix was not saved. Ask again on the newest version.");
  }
  return { script_id: saved.id, version: Number(saved.version), status: saved.status, flagged: checkResults.flagged, check_results: checkResults };
}

// ── The job handlers (src/marketing/job-kinds.mjs) ────────────────────────────────────

/**
 * write_slot {batch_id, slot}. A slot that cannot be written returns {failed:true,
 * reason} (the job is done and says why); a failure worth another try throws, so the
 * queue runs it again (src/marketing/jobs.mjs failJob, up to 3 runs).
 * @param {any} job @param {{ db?: any, env?: any, deps?: any, deadlineAt?: number }} [ctx]
 */
export async function runWriteSlot(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const deps = { ...(ctx.deps || {}), orgId: job.org_id, jobId: job.id };
  if (deps.deadlineAt == null && Number.isFinite(ctx.deadlineAt)) deps.deadlineAt = ctx.deadlineAt;
  const out = await writeSlot(ctx.db, ctx.env || process.env, { batch: p.batch_id ?? null, slot: p.slot ?? null }, deps);
  if (out && out.failed && out.temporary) throw new Error(out.reason);
  return out;
}

/**
 * fix_script {script_id, version, note} (queued by POST marketing/scripts/fix, U26).
 * @param {any} job @param {{ db?: any, env?: any, deps?: any, deadlineAt?: number }} [ctx]
 */
export async function runFixScript(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const deps = { ...(ctx.deps || {}), orgId: job.org_id, jobId: job.id };
  if (deps.deadlineAt == null && Number.isFinite(ctx.deadlineAt)) deps.deadlineAt = ctx.deadlineAt;
  const out = await fixScript(ctx.db, ctx.env || process.env, { script_id: p.script_id, version: p.version, note: p.note }, deps);
  if (out && out.failed && out.temporary) throw new Error(out.reason);
  return out;
}
