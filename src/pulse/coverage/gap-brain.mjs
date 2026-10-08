// Company Brain and Drive sync breakage for the morning pulse. Read only.
// Tripwire is existing Recon (AG-07). Do not add another watcher.
// Do not run a new Drive sync. Do not upload.
//
// meet-transcript-sweeper already runs every 10 minutes and writes
// brain_drive_sync. This file only reads what that job left behind,
// plus whether the search and read doors answer 500.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";

/** Same cron as meet-transcript-sweeper. Red after 3 times that gap. */
export const DRIVE_SYNC_CRON = "*/10 * * * *";

const DRIVE_SYNC_INTERVAL_MS = cronIntervalMs(DRIVE_SYNC_CRON);
if (!DRIVE_SYNC_INTERVAL_MS) {
  throw new Error(`schedule "${DRIVE_SYNC_CRON}" is a shape this check does not read`);
}

/** 30 minutes. A scan older than this has missed 3 sweeper runs. */
export const DRIVE_SYNC_STALE_MS = STALE_MULTIPLE * DRIVE_SYNC_INTERVAL_MS;

/** GET only. These doors answer a question. They do not scan Drive or take a file. */
export const SEARCH_READ_PATHS = Object.freeze([
  "/api/read/company-brain",
  "/api/read/company-brain-affiliate"
]);

export const CHECK_IDS = Object.freeze([
  "brain:drive-last-error",
  "brain:drive-sync-stale",
  "brain:search-read-route"
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not add another watcher. " +
  "Do not run a new Drive sync. Do not upload.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(text, n = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Same "up" rule as the morning registry ping for an API door. */
export function searchReadStatusUp(status) {
  const code = Number(status);
  return (
    (code >= 200 && code < 300) ||
    code === 400 ||
    code === 401 ||
    code === 403 ||
    code === 405
  );
}

const LAST_ERROR_SQL = `
  /* gap:drive-last-error */
  SELECT count(*)::int AS n,
         string_agg(left(last_error, 160), ' / ') AS errors
    FROM brain_drive_sync
   WHERE org_id = $1::uuid
     AND last_error IS NOT NULL
     AND btrim(last_error) <> ''
`;

const STALE_SQL = `
  /* gap:drive-sync-stale */
  SELECT count(*)::int AS n,
         max(last_sync_at) AS last_sync_at
    FROM brain_drive_sync
   WHERE org_id = $1::uuid
`;

async function checkDriveLastError({ db, orgId }) {
  const id = "brain:drive-last-error";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — Drive sync last_error not read");
  }
  try {
    const result = await db.query(LAST_ERROR_SQL, [orgId]);
    const n = countOf(result);
    if (n === 0) {
      return row(id, "PASS", "Drive sync last_error is empty");
    }
    const errors = clip(result?.rows?.[0]?.errors);
    const verb = n === 1 ? "has" : "have";
    return row(
      id,
      "FAIL",
      `${plural(n, "Drive sync row")} ${verb} last_error set${errors ? `: ${errors}` : ""}.`,
      `${RECON} Read brain_drive_sync.last_error for this company.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read Drive sync last_error: ${clip(err?.message || err, 180)}`,
      `${RECON} Read brain_drive_sync.last_error. Do not write that row from this pulse.`
    );
  }
}

function ageMinutes(last, now) {
  return Math.round(((now.getTime() - last.getTime()) / 60000) * 10) / 10;
}

async function checkDriveSyncStale({ db, orgId, now }) {
  const id = "brain:drive-sync-stale";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — Drive sync time not read");
  }
  const limitMin = DRIVE_SYNC_STALE_MS / 60000;
  try {
    const result = await db.query(STALE_SQL, [orgId]);
    const head = result?.rows?.[0] || {};
    const n = countOf(result);
    const last = head.last_sync_at ? new Date(head.last_sync_at) : null;
    if (!n || !last || Number.isNaN(last.getTime())) {
      return row(
        id,
        "FAIL",
        `Drive has never been scanned for this company. The sweeper is meet-transcript-sweeper, every 10 min, red after ${limitMin} min.`,
        `${RECON} Read brain_drive_sync.last_sync_at. The job is meet-transcript-sweeper (${DRIVE_SYNC_CRON}).`
      );
    }
    const ageMin = ageMinutes(last, now);
    if (now.getTime() - last.getTime() > DRIVE_SYNC_STALE_MS) {
      return row(
        id,
        "FAIL",
        `Drive last scanned ${last.toISOString()} (${ageMin} min ago, red after ${limitMin} min / 3 times ${DRIVE_SYNC_CRON}).`,
        `${RECON} Read brain_drive_sync.last_sync_at against meet-transcript-sweeper (${DRIVE_SYNC_CRON}).`
      );
    }
    return row(id, "PASS", `Drive last scanned ${last.toISOString()} (${ageMin} min ago).`);
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read Drive sync time: ${clip(err?.message || err, 180)}`,
      `${RECON} Read brain_drive_sync.last_sync_at. Do not write that row from this pulse.`
    );
  }
}

async function checkSearchReadRoute({ fetchImpl, baseUrl }) {
  const id = "brain:search-read-route";
  if (typeof fetchImpl !== "function") {
    return row(id, "skip", "no fetch in this run — brain search and read routes not probed");
  }
  const origin = String(baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const bad = [];
  try {
    for (const path of SEARCH_READ_PATHS) {
      const url = `${origin}${path}`;
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" }
        });
        const status = Number(res?.status);
        if (!searchReadStatusUp(status)) {
          bad.push(`${path} answered ${status}`);
        }
      } catch (err) {
        bad.push(`${path} unreachable: ${clip(err?.message || err, 120)}`);
      }
    }
  } catch (err) {
    return row(
      id,
      "FAIL",
      `brain search and read routes could not be probed: ${clip(err?.message || err, 180)}`,
      `${RECON} Read GET /api/read/company-brain and GET /api/read/company-brain-affiliate. Do not POST.`
    );
  }
  if (bad.length) {
    return row(
      id,
      "FAIL",
      bad.join("; "),
      `${RECON} Read GET /api/read/company-brain and GET /api/read/company-brain-affiliate. A 500 means the route crashed. Do not POST.`
    );
  }
  return row(
    id,
    "PASS",
    "brain search and read doors answered without a 500 (GET only)"
  );
}

/**
 * Three read-only checks. ctx: { db, orgId, now, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fetchImpl = ctx.fetchImpl;
  const baseUrl = ctx.baseUrl;
  return [
    await checkDriveLastError({ db, orgId }),
    await checkDriveSyncStale({ db, orgId, now }),
    await checkSearchReadRoute({ fetchImpl, baseUrl })
  ];
}
