// Exact read-only checks for the Flow catalog rows that have no stronger proof.
// An inactive template is checked by its exact key. Every other missing path
// stays not proved by its exact surface name until a deeper result check replaces it.

import agents from "../../../ops/workflows/coverage-every-surface-2026-10-10/agents.json" with { type: "json" };
import journeys from "../../../ops/workflows/coverage-every-surface-2026-10-10/journeys.json" with { type: "json" };
import messages from "../../../ops/workflows/coverage-every-surface-2026-10-10/messages.json" with { type: "json" };

import {
  EXPECTED_FLOW_GAP_COUNTS,
  flowGapRows,
  isInactiveTemplateRow,
} from "../catalog/proofs/flow-gap-cases.mjs";
import { runFinB22Live } from "../catalog/proofs/fin-b22-flow-live.mjs";
import { runFinB22PageReads } from "../catalog/proofs/fin-b22-page-reads.mjs";

const DAY = 24 * 60 * 60 * 1000;
export const LOOKBACK_DAYS = 7;

export const FLOW_ROWS = Object.freeze(flowGapRows(messages, journeys, agents));
export const CHECK_IDS = Object.freeze(FLOW_ROWS.map((row) => `flow:${row.family}:${row.surface}`));

const actualCounts = FLOW_ROWS.reduce((out, row) => {
  out[row.family] = (out[row.family] || 0) + 1;
  return out;
}, {});
for (const [family, expected] of Object.entries(EXPECTED_FLOW_GAP_COUNTS)) {
  if (actualCounts[family] !== expected) {
    throw new Error(`Flow gap monitor drifted: expected ${expected} ${family} rows, found ${actualCounts[family] || 0}.`);
  }
}

const INACTIVE_CONTROL_SURFACES = new Set([
  "inbound:suppression-and-slugs-src-mail",
  "api:POST /api/chat/portal-message",
]);

const MESSAGE_FINDINGS = Object.freeze({
  "template:payment_link_notice": "The payment-link text is still unapproved, so the CRM send path cannot prove a final fake-provider receipt.",
  "api-action:payment-link-send": "The payment-link send action still lacks a passing endpoint-to-template-to-receipt proof.",
  "workflow:waypoint-nudge-sweeper": "The hourly waypoint sequence has no exact final receipt check for its three named templates and staff-task finish.",
  "dispatch:sms-duplicate-guard-NOT-WIRED": "The SMS duplicate guard is not imported by dispatch, so this named brake does not run.",
  "job:staff-message-sweeper": "The staff-message sweeper has no exact proof that each released row reaches its final provider receipt.",
  "provider:web-push-and-client-push": "The client push sender has no caller, so no client push result can occur.",
  "receipt:twilio-status-webhook": "The Twilio receipt door is not covered by the launch-secret check for its signing token.",
  "api:POST /api/chat/messages": "The staff chat send path has no exact trigger-to-copy-to-placeholder-to-final-receipt proof.",
  "ui:ops-admin outbound mail panel": "The four outbound-mail controls have no exact click-to-result checks.",
  "api:POST /api/message-templates": "Template save, approve, rename, and refused-delete results are not covered by one exact control check.",
  "api:POST /api/auth/send-portal-link": "The owner portal-link action has no exact queued-copy and fake-delivery result proof.",
  "api:POST /api/auth/magic-link and magic-link-verify": "The magic-link request and single-use verify path has no exact end-to-end result proof.",
  "owner-alert:owner_notifications queue (finance alerts)": "Finance owner alerts can enter owner_notifications, but no sender consumes that queue.",
  "script:one-off senders in scripts/": "The named one-off senders have no recurring exact receipt check.",
  "template-copy:seed-vs-live-drift": "No executable check compares each live template body and approval flag with its SQL seed.",
  "template-copy:SQL-seeded-only-keys-not-in-doc-source": "No executable check proves the named SQL-only templates remain present and correct in live data.",
  "manual-proof:comms-map-2026-09-19 (template delivery proof)": "The named delivery proof is a stale hand-run document, not a recurring executable result.",
});

export const INACTIVE_TEMPLATE_SQL = `
SELECT m.template_key, count(*)::int AS n, max(m.created_at) AS last_at
  FROM messages m
 WHERE m.org_id = COALESCE($1::uuid, (SELECT id FROM orgs WHERE is_default LIMIT 1))
   AND m.direction = 'outbound'
   AND m.created_at >= $2::timestamptz
   AND m.template_key = ANY($3::text[])
 GROUP BY m.template_key
 ORDER BY m.template_key`.trim();

function result(row, status, detail, suggestedFix = null, na = undefined) {
  return {
    id: `flow:${row.family}:${row.surface}`,
    status,
    detail,
    suggestedFix,
    ...(na ? { na } : {}),
  };
}

function templateKey(row) {
  return String(row.surface).slice("template:".length);
}

const INACTIVE_ROWS = Object.freeze(FLOW_ROWS.filter(
  (row) => row.family === "message" && isInactiveTemplateRow(row),
));
const INACTIVE_KEYS = Object.freeze(INACTIVE_ROWS.map(templateKey));
const VERIFY_BATCHES = new WeakMap();

function inactiveKind(row) {
  const control = String(row.control || "");
  if (control.includes("doc source copy for alias(es)")) return "an alias-only source key";
  if (control.includes("retired / dormant")) return "retired or dormant";
  return "inactive with no sender";
}

function inactiveTemplateResult(row, count, since) {
  const key = templateKey(row);
  const kind = inactiveKind(row);
  if (count > 0) {
    return result(
      row,
      "FAIL",
      `${row.surface} is mapped as ${kind}, but ${count} outbound message${count === 1 ? "" : "s"} used that exact key in the last ${LOOKBACK_DAYS} days.`,
      `Trace the sender for ${key}. Give that exact path trigger, copy, placeholder, and final receipt proof before removing this red.`,
    );
  }
  return result(
    row,
    "na",
    `${row.surface} is ${kind}. No outbound message used that exact key in the last ${LOOKBACK_DAYS} days.`,
    null,
    { code: "no-sender", args: { surface: row.surface, key, count: 1, days: LOOKBACK_DAYS, since } },
  );
}

function staticResult(row) {
  if (row.family === "message") {
    if (INACTIVE_CONTROL_SURFACES.has(row.surface)) {
      return result(
        row,
        "na",
        `${row.surface} is an inbound-only control. It has no outbound customer result to judge.`,
        null,
        { code: "no-sender", args: { surface: row.surface, kind: "inbound-only", count: 1 } },
      );
    }
    const finding = MESSAGE_FINDINGS[row.surface];
    return result(
      row,
      "NOT_PROVED",
      `${row.surface}: ${finding || `the named control has no exact final-result checker: ${row.control}`}`,
      `Add or repair the exact read-only result check for ${row.surface}. Do not send from the pulse.`,
    );
  }

  if (row.family === "journey") {
    if (/#reach-/.test(row.surface)) {
      return result(
        row,
        "NOT_PROVED",
        `${row.surface}: no signed-in role probe proves this exact route group can be reached. Named result: ${row.control}`,
        `Add a read-only signed-role route probe for ${row.surface}.`,
      );
    }
    if (row.surface.endsWith("#stays-blocked")) {
      return result(
        row,
        "NOT_PROVED",
        `${row.surface}: no signed-in role probe proves the exact blocked route group stays blocked. Named result: ${row.control}`,
        `Add a read-only denied-route probe for ${row.surface}.`,
      );
    }
    return result(
      row,
      "NOT_PROVED",
      `${row.surface}: no executable check walks this exact event order to its named result: ${row.control}`,
      `Add a read-only or fake-provider result check for ${row.surface}.`,
    );
  }

  return result(
    row,
    "NOT_PROVED",
    `${row.surface}: the journeys proxy accepts caller-supplied system and user prompts, so there is no fixed active prompt and judged runtime result to prove.`,
    "Give this agent path a fixed server prompt and a fake-model result judge, then replace this red check.",
  );
}

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

async function readInactiveCounts(ctx, keys, since) {
  const run = bind(ctx);
  if (!run) return { error: "no database in this run", counts: new Map() };
  try {
    const answer = await run((db) => db.query(INACTIVE_TEMPLATE_SQL, [ctx.orgId || null, since, keys]));
    if (!Array.isArray(answer?.rows)) return { error: "the inactive-template read returned no rows", counts: new Map() };
    return {
      error: null,
      counts: new Map(answer.rows.map((item) => [String(item.template_key), Number(item.n || 0)])),
    };
  } catch (error) {
    return { error: String(error?.message || error || "unknown read error"), counts: new Map() };
  }
}

async function readInactiveCountsForVerify(ctx, since) {
  const handle = typeof ctx?.scope === "function" ? ctx.scope : ctx?.db;
  if (!handle || (typeof handle !== "object" && typeof handle !== "function")) {
    return readInactiveCounts(ctx, INACTIVE_KEYS, since);
  }
  let bySince = VERIFY_BATCHES.get(handle);
  if (!bySince) {
    bySince = new Map();
    VERIFY_BATCHES.set(handle, bySince);
  }
  const cacheKey = `${ctx?.orgId || ""}\0${since}`;
  if (!bySince.has(cacheKey)) {
    bySince.set(cacheKey, readInactiveCounts(ctx, INACTIVE_KEYS, since));
  }
  return bySince.get(cacheKey);
}

export async function gapChecks(ctx = {}) {
  const now = new Date(ctx.now || Date.now());
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString();
  const [read, live, pages] = await Promise.all([
    readInactiveCounts(ctx, INACTIVE_KEYS, since),
    runFinB22Live({ ...ctx, now }),
    runFinB22PageReads(ctx),
  ]);

  return FLOW_ROWS.map((row) => {
    // A row with a saved-result query (fin-b22-flow-live.mjs) is judged by what the flow really left behind;
    // a row with a page read (fin-b22-page-reads.mjs) is judged by what the live public page holds.
    const rowId = `flow:${row.family}:${row.surface}`;
    const liveRow = live.get(rowId) || pages.get(rowId);
    if (liveRow) return liveRow;
    if (!isInactiveTemplateRow(row)) return staticResult(row);
    if (read.error) return result(row, "skip", `${row.surface} was not checked: ${read.error}.`);
    return inactiveTemplateResult(row, read.counts.get(templateKey(row)) || 0, since);
  });
}

export const naVerify = Object.freeze({
  "no-sender": async (args, ctx = {}) => {
    const surface = String(args?.surface || "");
    if (args?.kind === "inbound-only") {
      const row = FLOW_ROWS.find((item) => item.surface === surface && item.family === "message");
      return INACTIVE_CONTROL_SURFACES.has(surface) && String(row?.control || "").toLowerCase().includes("inbound");
    }

    const key = String(args?.key || "");
    const row = FLOW_ROWS.find((item) => item.surface === surface && item.family === "message");
    if (!key || !row || !isInactiveTemplateRow(row) || templateKey(row) !== key) return false;
    const since = args?.since && Number.isFinite(new Date(args.since).getTime()) ? new Date(args.since) : null;
    const days = Number(args?.days);
    if (!since || !Number.isFinite(days) || days < 1) return false;
    const read = await readInactiveCountsForVerify(ctx, since.toISOString());
    return !read.error && (read.counts.get(key) || 0) === 0;
  },
});
