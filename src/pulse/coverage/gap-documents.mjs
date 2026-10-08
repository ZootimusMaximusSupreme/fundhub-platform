// Document upload and delivery gaps for the morning pulse. Report only.
// Slice 09 already checks that the doors are on the registry and the jobs
// are in the workflow index. This file does not repeat that.
//
// Read-only. GET probes only. SELECT only. Never uploads a file. Never sends
// mail. Recon (AG-07) is the one tripwire. Do not add a second watchdog.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import { SWEEP_CRON as VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";

export const ID_UPLOAD = "documents:upload-route";
export const ID_UNCHASED = "documents:required-unchased";
export const ID_STUCK = "documents:stuck-processing";
export const ID_OPEN = "documents:cannot-open";

/** clients.custom_fields key written by the doc request (inquiry-docs DOC_01_LOCK). */
export const REQUEST_FIELD = "doc_01_request_sent_at";
export const MISSING_TAG = "docs:missing";

/** Follow-up asks. The first request (SMS-DOC-01 / EMAIL-DOC-01) is not a chase. */
export const CHASE_TEMPLATE_KEYS = Object.freeze([
  "SMS-VAULT-ASK-1",
  "EMAIL-VAULT-ASK-2",
  "SMS-VAULT-ASK-3",
  "SMS-DOC-02-REQUEST-MORE"
]);

/** money_agent_tasks.source for a vault ask (document-vault-chase TASK_SOURCE). */
export const VAULT_ASK_SOURCE = "doc-vault";

/** tasks.source_workflow values that mean somebody already chased or is reading. */
export const STAFF_CHASE_SOURCES = Object.freeze([
  "document-vault",
  "document-vault-review",
  "doc-check"
]);

/** failed_events.handler_name for a document the reader has not finished. */
export const READER_HANDLER = "doc-check";

export const DEFAULT_BASE_URL = "https://fundhub.ai";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export const VAULT_RED_MS = STALE_MULTIPLE * (cronIntervalMs(VAULT_CHASE_CRON) || DAY_MS);
export const READER_RED_MS = STALE_MULTIPLE * (cronIntervalMs(DOC_CHECK_RETRY_CRON) || (20 * MIN_MS));

const RECON =
  "Recon (AG-07) reports this on the morning pulse. Do not build a second watchdog. Do not upload a file from this check. Do not email a client.";

const ALIVE_HTTP = new Set([400, 401, 403, 405]);

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function fix(lead) {
  return `${lead} ${RECON}`;
}

function clip(s, n = 180) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function windowLabel(ms) {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(ms / MIN_MS);
  return `${minutes} minutes`;
}

function countOf(result) {
  const n = Number(result && result.rows && result.rows[0] && result.rows[0].n);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function hasDb(ctx) {
  return !!(ctx && ctx.db && typeof ctx.db.query === "function" && ctx.orgId);
}

function fetchOf(ctx) {
  const f = ctx && (ctx.fetchImpl || ctx.fetch);
  return typeof f === "function" ? f : null;
}

function baseOf(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function nowOf(ctx) {
  const n = ctx && ctx.now;
  if (n instanceof Date && Number.isFinite(n.getTime())) return n;
  return new Date();
}

function routeAlive(status) {
  return (status >= 200 && status < 300) || ALIVE_HTTP.has(status);
}

async function selectOnly(db, sql, params) {
  const stripped = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^select\b/i.test(stripped)) {
    throw new Error("documents gap checks are read-only");
  }
  return db.query(sql, params);
}

async function probeGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  const status = res && res.status;
  if (!Number.isFinite(status)) throw new Error("probe returned no status");
  return status;
}

async function checkUploadRoute(ctx) {
  const fetchImpl = fetchOf(ctx);
  if (!fetchImpl) {
    return check(ID_UPLOAD, "skip", "no fetch in this run — upload route not probed");
  }
  const url = `${baseOf(ctx)}/api/documents-upload`;
  let status;
  try {
    status = await probeGet(fetchImpl, url);
  } catch (err) {
    return check(
      ID_UPLOAD,
      "FAIL",
      `upload route unreachable: ${clip(err && err.message)}`,
      fix("Restore POST /api/documents-upload. This check only sends GET.")
    );
  }
  if (!routeAlive(status)) {
    return check(
      ID_UPLOAD,
      "FAIL",
      `GET /api/documents-upload answered ${status}. The upload route is dead. No file was uploaded.`,
      fix("Restore POST /api/documents-upload. This check only sends GET.")
    );
  }
  return check(
    ID_UPLOAD,
    "PASS",
    `GET /api/documents-upload answered ${status}. No file was uploaded.`
  );
}
checkUploadRoute.checkId = ID_UPLOAD;

const UNCHASED_SQL = `
SELECT count(*)::int AS n
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND coalesce(c.custom_fields->>'doc_01_request_sent_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
   AND (c.custom_fields->>'doc_01_request_sent_at')::timestamptz < $2::timestamptz
   AND $3::text = ANY(c.tags)
   AND NOT EXISTS (
     SELECT 1 FROM documents d
      WHERE d.org_id = c.org_id
        AND d.client_id = c.id
        AND d.kind = 'client_upload'
        AND d.created_at >= (c.custom_fields->>'doc_01_request_sent_at')::timestamptz
   )
   AND NOT EXISTS (
     SELECT 1 FROM messages m
      WHERE m.org_id = c.org_id
        AND m.client_id = c.id
        AND m.created_at >= (c.custom_fields->>'doc_01_request_sent_at')::timestamptz
        AND m.template_key = ANY($4::text[])
   )
   AND NOT EXISTS (
     SELECT 1 FROM money_agent_tasks t
      WHERE t.org_id = c.org_id
        AND t.client_id = c.id
        AND t.source = $5::text
        AND t.created_at >= (c.custom_fields->>'doc_01_request_sent_at')::timestamptz
   )
   AND NOT EXISTS (
     SELECT 1 FROM tasks k
      WHERE k.org_id = c.org_id
        AND k.client_id = c.id
        AND k.source_workflow = ANY($6::text[])
        AND k.created_at >= (c.custom_fields->>'doc_01_request_sent_at')::timestamptz
   )`;

async function checkRequiredUnchased(ctx) {
  if (!hasDb(ctx)) {
    return check(ID_UNCHASED, "skip", "no database in this run — required-doc chase not read");
  }
  const now = nowOf(ctx);
  const cutoff = new Date(now.getTime() - VAULT_RED_MS);
  const result = await selectOnly(ctx.db, UNCHASED_SQL, [
    ctx.orgId,
    cutoff.toISOString(),
    MISSING_TAG,
    CHASE_TEMPLATE_KEYS,
    VAULT_ASK_SOURCE,
    STAFF_CHASE_SOURCES
  ]);
  const n = countOf(result);
  const label = windowLabel(VAULT_RED_MS);
  if (n === 0) {
    return check(
      ID_UNCHASED,
      "PASS",
      `no required doc still missing past ${label} with no chase and no file`
    );
  }
  return check(
    ID_UNCHASED,
    "FAIL",
    `${n} required doc${n === 1 ? "" : "s"} requested past ${label}, never received, and never chased`,
    fix("document-vault-chase should have asked for the missing paper. Read that job's last run.")
  );
}
checkRequiredUnchased.checkId = ID_UNCHASED;

const STUCK_DELIVERY_SQL = `
SELECT count(*)::int AS n
  FROM documents
 WHERE org_id = $1::uuid
   AND delivery_status = 'pending'
   AND updated_at < $2::timestamptz`;

const STUCK_READER_SQL = `
SELECT count(*)::int AS n
  FROM failed_events
 WHERE org_id = $1::uuid
   AND handler_name = $2::text
   AND status = 'pending'
   AND coalesce(next_attempt_at, last_seen_at) < $3::timestamptz`;

async function checkStuckProcessing(ctx) {
  if (!hasDb(ctx)) {
    return check(ID_STUCK, "skip", "no database in this run — stuck document rows not read");
  }
  const now = nowOf(ctx);
  const deliveryCutoff = new Date(now.getTime() - VAULT_RED_MS);
  const readerCutoff = new Date(now.getTime() - READER_RED_MS);
  const [delivery, reader] = await Promise.all([
    selectOnly(ctx.db, STUCK_DELIVERY_SQL, [ctx.orgId, deliveryCutoff.toISOString()]),
    selectOnly(ctx.db, STUCK_READER_SQL, [ctx.orgId, READER_HANDLER, readerCutoff.toISOString()])
  ]);
  const pending = countOf(delivery);
  const reads = countOf(reader);
  const pendingLabel = windowLabel(VAULT_RED_MS);
  const readLabel = windowLabel(READER_RED_MS);
  if (pending === 0 && reads === 0) {
    return check(
      ID_STUCK,
      "PASS",
      `no document row left pending past ${pendingLabel}, and no doc-check read overdue past ${readLabel}`
    );
  }
  const parts = [];
  if (pending > 0) {
    parts.push(`${pending} document row${pending === 1 ? "" : "s"} stuck pending past ${pendingLabel}`);
  }
  if (reads > 0) {
    parts.push(`${reads} document read${reads === 1 ? "" : "s"} still processing past ${readLabel}`);
  }
  return check(
    ID_STUCK,
    "FAIL",
    parts.join("; "),
    fix("Read documents stuck at delivery_status pending and failed_events for handler doc-check. The retry sweeper already owns the read.")
  );
}
checkStuckProcessing.checkId = ID_STUCK;

const UNOPENABLE_SQL = `
SELECT count(*)::int AS n
  FROM documents d
 WHERE d.org_id = $1::uuid
   AND (
     d.current_version_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM document_versions v
        WHERE v.id = d.current_version_id
          AND v.document_id = d.id
          AND nullif(btrim(v.storage_key), '') IS NOT NULL
     )
   )`;

async function checkCannotOpen(ctx) {
  const fetchImpl = fetchOf(ctx);
  const dbReady = hasDb(ctx);
  if (!fetchImpl && !dbReady) {
    return check(ID_OPEN, "skip", "no fetch and no database — open-file path not read");
  }
  let routeStatus = null;
  let routeError = null;
  if (fetchImpl) {
    try {
      routeStatus = await probeGet(fetchImpl, `${baseOf(ctx)}/api/documents-download`);
    } catch (err) {
      routeError = clip(err && err.message);
    }
  }
  let unopenable = null;
  if (dbReady) {
    unopenable = countOf(await selectOnly(ctx.db, UNOPENABLE_SQL, [ctx.orgId]));
  }
  const parts = [];
  if (routeError) parts.push(`download route unreachable: ${routeError}`);
  else if (routeStatus != null && !routeAlive(routeStatus)) {
    parts.push(`GET /api/documents-download answered ${routeStatus}. A client cannot open their file. No file was opened.`);
  }
  if (unopenable > 0) {
    parts.push(`${unopenable} document row${unopenable === 1 ? "" : "s"} have no version a client can open`);
  }
  if (parts.length) {
    return check(
      ID_OPEN,
      "FAIL",
      parts.join("; "),
      fix("Restore GET /api/documents-download and the current version on the document row. This check does not open a client file.")
    );
  }
  const bits = [];
  if (routeStatus != null) bits.push(`GET /api/documents-download answered ${routeStatus}`);
  if (unopenable === 0) bits.push("every document row has a version");
  if (routeStatus == null) bits.push("download route not probed");
  if (unopenable == null) bits.push("document rows not read");
  return check(ID_OPEN, "PASS", `${bits.join("; ")}. No file was opened.`);
}
checkCannotOpen.checkId = ID_OPEN;

const RUNNERS = [checkUploadRoute, checkRequiredUnchased, checkStuckProcessing, checkCannotOpen];

/** Four read-only gap checks. Shape is { id, status, detail, suggestedFix }. */
export async function gapChecks(ctx = {}) {
  return Promise.all(RUNNERS.map(async (fn) => {
    try {
      return await fn(ctx);
    } catch (err) {
      return check(
        fn.checkId,
        "FAIL",
        `read failed: ${clip(err && err.message)}`,
        fix("Read the document gap query. Do not write from this check.")
      );
    }
  }));
}
