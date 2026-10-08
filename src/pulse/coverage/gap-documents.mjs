// Document upload and delivery gaps for the morning pulse. Report only.
// Slice 09 already checks that the doors are on the registry and the jobs
// are in the workflow index. The registry already pings GET /api/documents-upload
// and GET /api/documents-download every morning (reg:documents-upload answers
// 405, reg:documents-download answers 401, and both are live doors). This file
// does not repeat any of that.
//
// A 405 cannot tell you where an upload LANDS or whether it can be read back, so
// this file reads the two things the ping cannot: the file store behind the
// upload door, and the document rows themselves.
//
// Read-only. SELECT only. Store reads are existence checks (HEAD). Never uploads
// a file. Never sends mail. Recon (AG-07) is the one tripwire. Do not add a
// second watchdog.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import { SWEEP_CRON as VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";

export const ID_STORE = "documents:upload-store";
export const ID_UNCHASED = "documents:required-unchased";
export const ID_STUCK = "documents:stuck-processing";
export const ID_OPEN = "documents:cannot-open";

/** clients.custom_fields key written by the doc request (inquiry-docs DOC_01_LOCK). */
export const REQUEST_FIELD = "doc_01_request_sent_at";
export const MISSING_TAG = "docs:missing";

/**
 * The first ask for a missing paper, on any path that tags docs:missing:
 * the deposit and inquiry request (DOC-01), the onboarding nudge (F-02), and the
 * bank asking for more (F-06). The earliest one is when the client was asked.
 */
export const FIRST_ASK_TEMPLATE_KEYS = Object.freeze([
  "SMS-DOC-01-REQUEST",
  "EMAIL-DOC-01-REQUEST",
  "SMS-F02-ID-PORTAL-NEEDED",
  "EMAIL-F02-ID-PORTAL-NEEDED",
  "SMS-F06-MISSING-DOCS",
  "EMAIL-F06-MISSING-DOCS"
]);

/** Follow-up asks. A first ask above is never a chase. */
export const CHASE_TEMPLATE_KEYS = Object.freeze([
  "SMS-VAULT-ASK-1",
  "EMAIL-VAULT-ASK-2",
  "SMS-VAULT-ASK-3",
  "SMS-DOC-02-REQUEST-MORE",
  "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP"
]);

/** documents.kind values that mean the CLIENT sent us a file (the vault counts both). */
export const RECEIVED_KINDS = Object.freeze(["client_upload", "inquiry_doc"]);

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

/** The store names that keep files after a cold start. "memory" does not. */
export const REAL_STORES = Object.freeze(["netlify-blobs", "vercel-blob"]);

/** How many of the newest saved files are read back from the store. */
export const OPEN_SAMPLE = 5;

/** One store answer may take this long. A store that hangs must not hang the morning pulse. */
export const STORE_TIMEOUT_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export const VAULT_RED_MS = STALE_MULTIPLE * (cronIntervalMs(VAULT_CHASE_CRON) || DAY_MS);
export const READER_RED_MS = STALE_MULTIPLE * (cronIntervalMs(DOC_CHECK_RETRY_CRON) || (20 * MIN_MS));
/** The reader backs off to once a day, so a read still pending after 3 of those has not worked. */
export const READER_UNREAD_MS = STALE_MULTIPLE * DAY_MS;

const RECON =
  "Recon (AG-07) reports this on the morning pulse. Do not build a second watchdog. Do not upload a file from this check. Do not email a client.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function fix(lead) {
  return `${lead} ${RECON}`;
}

function clip(s, n = 180) {
  return String((s && s.message) || s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

function windowLabel(ms) {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(ms / MIN_MS);
  return `${minutes} minutes`;
}

function countOf(result, key = "n") {
  const n = Number(result && result.rows && result.rows[0] && result.rows[0][key]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function hasDb(ctx) {
  return !!(ctx && ctx.db && typeof ctx.db.query === "function" && ctx.orgId);
}

function nowOf(ctx) {
  const n = ctx && ctx.now;
  if (n instanceof Date && Number.isFinite(n.getTime())) return n;
  return new Date();
}

async function selectOnly(db, sql, params) {
  const stripped = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^select\b/i.test(stripped)) {
    throw new Error("documents gap checks are read-only");
  }
  return db.query(sql, params);
}

/**
 * The store the upload door writes to. Returns a provider with `name` and `exists`.
 * Tests hand one in as ctx.documentStore. Live, it is the same one the upload and
 * download doors build from DOCUMENT_STORE_PROVIDER.
 */
async function storeOf(ctx) {
  if (ctx.documentStore) return ctx.documentStore;
  const { providerFromEnv } = await import("../../documents/store.mjs");
  return providerFromEnv(ctx.env || process.env);
}

const SAMPLE_SQL = `
SELECT d.id::text AS document_id, v.storage_key
  FROM documents d
  JOIN document_versions v ON v.id = d.current_version_id AND v.document_id = d.id
 WHERE d.org_id = $1::uuid
   AND d.is_demo IS NOT TRUE
   AND nullif(btrim(v.storage_key), '') IS NOT NULL
 ORDER BY v.created_at DESC
 LIMIT $2::int`;

function withTimeout(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the store did not answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Is each sampled file really in the store? A store that cannot answer counts as missing. */
async function readBack(store, rows, timeoutMs = STORE_TIMEOUT_MS) {
  const missing = [];
  // exists() is optional on a provider. Without it nothing can be read back, and nothing is claimed.
  if (typeof store.exists !== "function") return missing;
  for (const row of rows) {
    let there = false;
    try {
      there = (await withTimeout(Promise.resolve(store.exists(row.storage_key)), timeoutMs)) === true;
    } catch {
      there = false;
    }
    if (!there) missing.push(String(row.document_id));
  }
  return missing;
}

async function checkUploadStore(ctx) {
  if (!hasDb(ctx)) {
    return check(ID_STORE, "skip", "no database in this run — upload store not read");
  }
  let store;
  try {
    store = await storeOf(ctx);
  } catch (err) {
    return check(
      ID_STORE,
      "FAIL",
      `the document store setting is not one the upload door knows: ${clip(err)}`,
      fix("Set DOCUMENT_STORE_PROVIDER to netlify-blobs. Uploads cannot be saved without it.")
    );
  }
  if (!REAL_STORES.includes(store.name)) {
    return check(
      ID_STORE,
      "FAIL",
      `uploads are going to the ${store.name} store. It keeps files in memory only, so every upload is lost at the next cold start.`,
      fix("Set DOCUMENT_STORE_PROVIDER to netlify-blobs on the live site.")
    );
  }
  const newest = (await selectOnly(ctx.db, SAMPLE_SQL, [ctx.orgId, 1])).rows || [];
  if (newest.length === 0) {
    return check(ID_STORE, "PASS", `uploads go to the ${store.name} store. No saved file to read back yet.`);
  }
  const missing = await readBack(store, newest, ctx.storeTimeoutMs);
  if (missing.length) {
    return check(
      ID_STORE,
      "FAIL",
      `the newest saved file (document ${missing[0]}) is not in the ${store.name} store, so the last upload did not land or the store cannot be read`,
      fix("Read the upload door log and the file store. This check only asks the store whether the file exists.")
    );
  }
  return check(ID_STORE, "PASS", `uploads go to the ${store.name} store, and the newest saved file is there. No file was uploaded.`);
}
checkUploadStore.checkId = ID_STORE;

const UNCHASED_SQL = `
SELECT count(*)::int AS n
  FROM clients c
  CROSS JOIN LATERAL (
    SELECT least(
      CASE WHEN c.custom_fields->>'doc_01_request_sent_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           THEN (c.custom_fields->>'doc_01_request_sent_at')::timestamptz END,
      (SELECT min(m.created_at) FROM messages m
        WHERE m.org_id = c.org_id
          AND m.client_id = c.id
          AND m.template_key = ANY($7::text[]))
    ) AS at
  ) r
 WHERE c.org_id = $1::uuid
   AND c.is_demo IS NOT TRUE
   AND coalesce(c.custom_fields->>'synthetic', '') <> 'true'
   AND $3::text = ANY(c.tags)
   AND r.at < $2::timestamptz
   AND NOT EXISTS (
     SELECT 1 FROM documents d
      WHERE d.org_id = c.org_id
        AND d.client_id = c.id
        AND d.kind = ANY($8::text[])
        AND d.created_at >= r.at
   )
   AND NOT EXISTS (
     SELECT 1 FROM messages m
      WHERE m.org_id = c.org_id
        AND m.client_id = c.id
        AND m.created_at >= r.at
        AND m.template_key = ANY($4::text[])
   )
   AND NOT EXISTS (
     SELECT 1 FROM money_agent_tasks t
      WHERE t.org_id = c.org_id
        AND t.client_id = c.id
        AND t.source = $5::text
        AND t.created_at >= r.at
   )
   AND NOT EXISTS (
     SELECT 1 FROM tasks k
      WHERE k.org_id = c.org_id
        AND k.client_id = c.id
        AND k.source_workflow = ANY($6::text[])
        AND k.created_at >= r.at
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
    STAFF_CHASE_SOURCES,
    FIRST_ASK_TEMPLATE_KEYS,
    RECEIVED_KINDS
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
    fix("Nothing chased these clients after the first ask. document-vault-chase only chases paid Capital Blueprint buyers, so for anyone else a person has to follow up. Read the client's tags and messages.")
  );
}
checkRequiredUnchased.checkId = ID_UNCHASED;

const STUCK_DELIVERY_SQL = `
SELECT count(*) FILTER (WHERE delivery_status = 'pending' AND updated_at < $2::timestamptz)::int AS pending,
       count(*) FILTER (WHERE delivery_status IN ('failed', 'bounced'))::int AS failed
  FROM documents
 WHERE org_id = $1::uuid
   AND is_demo IS NOT TRUE
   AND delivery_status IN ('pending', 'failed', 'bounced')`;

const STUCK_READER_SQL = `
SELECT count(*) FILTER (WHERE coalesce(next_attempt_at, last_seen_at) < $3::timestamptz)::int AS overdue,
       count(*) FILTER (WHERE first_seen_at < $4::timestamptz)::int AS unread
  FROM failed_events
 WHERE org_id = $1::uuid
   AND handler_name = $2::text
   AND status = 'pending'`;

async function checkStuckProcessing(ctx) {
  if (!hasDb(ctx)) {
    return check(ID_STUCK, "skip", "no database in this run — stuck document rows not read");
  }
  const now = nowOf(ctx);
  const deliveryCutoff = new Date(now.getTime() - VAULT_RED_MS);
  const readerCutoff = new Date(now.getTime() - READER_RED_MS);
  const unreadCutoff = new Date(now.getTime() - READER_UNREAD_MS);
  const [delivery, reader] = await Promise.all([
    selectOnly(ctx.db, STUCK_DELIVERY_SQL, [ctx.orgId, deliveryCutoff.toISOString()]),
    selectOnly(ctx.db, STUCK_READER_SQL, [
      ctx.orgId,
      READER_HANDLER,
      readerCutoff.toISOString(),
      unreadCutoff.toISOString()
    ])
  ]);
  const pending = countOf(delivery, "pending");
  const failed = countOf(delivery, "failed");
  const overdue = countOf(reader, "overdue");
  const unread = countOf(reader, "unread");
  const pendingLabel = windowLabel(VAULT_RED_MS);
  const readLabel = windowLabel(READER_RED_MS);
  const unreadLabel = windowLabel(READER_UNREAD_MS);
  if (pending === 0 && failed === 0 && overdue === 0 && unread === 0) {
    return check(
      ID_STUCK,
      "PASS",
      `no document row stuck pending past ${pendingLabel} or failed to deliver, and no doc-check read overdue past ${readLabel} or unread past ${unreadLabel}`
    );
  }
  const parts = [];
  if (pending > 0) {
    parts.push(`${pending} document row${pending === 1 ? "" : "s"} stuck pending past ${pendingLabel}`);
  }
  if (failed > 0) {
    parts.push(`${failed} document row${failed === 1 ? "" : "s"} failed or bounced on delivery`);
  }
  if (overdue > 0) {
    parts.push(`${overdue} document read${overdue === 1 ? "" : "s"} still processing past ${readLabel}`);
  }
  if (unread > 0) {
    parts.push(`${unread} document${unread === 1 ? "" : "s"} still unread after ${unreadLabel} of retries`);
  }
  return check(
    ID_STUCK,
    "FAIL",
    parts.join("; "),
    fix("Read documents stuck at delivery_status pending, failed or bounced, and failed_events for handler doc-check. The retry sweeper already owns the read; if it keeps failing, look at why the reader cannot answer.")
  );
}
checkStuckProcessing.checkId = ID_STUCK;

const UNOPENABLE_SQL = `
SELECT count(*)::int AS n
  FROM documents d
 WHERE d.org_id = $1::uuid
   AND d.is_demo IS NOT TRUE
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
  if (!hasDb(ctx)) {
    return check(ID_OPEN, "skip", "no database in this run — open-file path not read");
  }
  const unopenable = countOf(await selectOnly(ctx.db, UNOPENABLE_SQL, [ctx.orgId]));
  const sample = (await selectOnly(ctx.db, SAMPLE_SQL, [ctx.orgId, OPEN_SAMPLE])).rows || [];
  let missing = [];
  let storeNote = null;
  if (sample.length) {
    try {
      missing = await readBack(await storeOf(ctx), sample, ctx.storeTimeoutMs);
    } catch (err) {
      storeNote = clip(err);
      missing = sample.map((row) => String(row.document_id));
    }
  }
  const parts = [];
  if (unopenable > 0) {
    parts.push(`${unopenable} document row${unopenable === 1 ? "" : "s"} have no version a client can open`);
  }
  if (missing.length) {
    parts.push(
      `${missing.length} of the ${sample.length} newest saved files are not in the file store${storeNote ? ` (${storeNote})` : ""}`
    );
  }
  if (parts.length) {
    return check(
      ID_OPEN,
      "FAIL",
      `A client cannot open their file: ${parts.join("; ")}`,
      fix("Restore the current version and the stored file on the document row. This check only asks the store whether a file exists. It does not open a client file.")
    );
  }
  return check(
    ID_OPEN,
    "PASS",
    sample.length
      ? `every document row has a version, and the ${sample.length} newest saved files are in the file store. No file was opened.`
      : "every document row has a version. No saved file to read back yet."
  );
}
checkCannotOpen.checkId = ID_OPEN;

const RUNNERS = [checkUploadStore, checkRequiredUnchased, checkStuckProcessing, checkCannotOpen];

/**
 * Four read-only gap checks. Shape is { id, status, detail, suggestedFix }.
 * ctx: { db, orgId, now, env }. `ctx.documentStore` and `ctx.storeTimeoutMs` are for tests only.
 */
export async function gapChecks(ctx = {}) {
  return Promise.all(RUNNERS.map(async (fn) => {
    try {
      return await fn(ctx);
    } catch (err) {
      return check(
        fn.checkId,
        "FAIL",
        `read failed: ${clip(err)}`,
        fix("Read the document gap query. Do not write from this check.")
      );
    }
  }));
}
