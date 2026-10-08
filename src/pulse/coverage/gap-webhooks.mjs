// Inbound webhook doors for the morning pulse. Read only.
// Twilio status, Commas (Fanbasis), ClickFunnels, and calendar booking.
// Calendar bookings land on the ClickFunnels webhook. There is no second door.
//
// A GET that answers 401 or 405 means the door is mounted and refused the probe.
// A 404 means the door is missing. This file never POSTs and never replays a payment.
// Tripwire is existing Recon (AG-07). Do not add another watcher.
//
// Twilio status and ClickFunnels answer inside the request. They do not keep a
// failed queue. Commas does: commas_inbox. A row the sweeper has finished
// retrying stays status failed. That is the stuck row this file counts.

import { MAX_ATTEMPTS } from "../../payments/commas-inbox.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";

/** Same limit the commas inbox sweeper stops at. A failed row at this count is not picked up again. */
export const STUCK_AFTER_ATTEMPTS = MAX_ATTEMPTS;

export const DOORS = Object.freeze([
  {
    id: "webhooks:twilio-status",
    path: "/api/webhooks/twilio-status",
    label: "Twilio status"
  },
  {
    id: "webhooks:commas",
    path: "/api/webhooks/commas",
    label: "Commas (Fanbasis)"
  },
  {
    id: "webhooks:clickfunnels",
    path: "/api/webhooks/clickfunnels",
    label: "ClickFunnels"
  },
  {
    id: "webhooks:calendar-booking",
    path: "/api/webhooks/clickfunnels",
    label: "calendar booking"
  }
]);

export const CHECK_IDS = Object.freeze([
  ...DOORS.map((door) => door.id),
  "webhooks:stuck-failed"
]);

const ACCEPTED = new Set([401, 405]);

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not POST a webhook. Do not replay a payment. Do not add another watcher.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}${path}`;
}

function doorFix(door) {
  return `${RECON} Mount ${door.path} on the existing webhook handler.`;
}

function stuckFix() {
  return (
    `${RECON} Read commas_inbox where status is failed and attempts are at the sweeper limit. ` +
    "Leave the existing commas inbox sweeper as the retry."
  );
}

/**
 * One GET per unique path. Calendar booking shares the ClickFunnels path,
 * so that URL is probed once and both checks read the same answer.
 */
async function probeDoors(fetchImpl, baseUrl) {
  const byPath = new Map();
  const paths = [...new Set(DOORS.map((door) => door.path))];
  await Promise.all(paths.map(async (path) => {
    const url = joinUrl(baseUrl, path);
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json" }
      });
      const status = Number(res?.status);
      byPath.set(path, { status: Number.isFinite(status) ? status : null });
    } catch (err) {
      byPath.set(path, { error: String(err?.message || err).slice(0, 160) });
    }
  }));
  return byPath;
}

function doorDetail(door, status) {
  if (door.id === "webhooks:calendar-booking") {
    return `calendar booking door answered ${status} (ClickFunnels webhook, where booking posts land)`;
  }
  return `${door.label} door answered ${status}`;
}

function doorCheck(door, probe) {
  if (!probe) {
    return row(door.id, "FAIL", `${door.label} door was not probed`, doorFix(door));
  }
  if (probe.error) {
    return row(
      door.id,
      "FAIL",
      `${door.label} door unreachable: ${probe.error}`,
      doorFix(door)
    );
  }
  if (ACCEPTED.has(probe.status)) {
    return row(door.id, "PASS", doorDetail(door, probe.status));
  }
  if (probe.status === 404) {
    return row(door.id, "FAIL", `${door.label} door is missing (404)`, doorFix(door));
  }
  const shown = probe.status == null ? "no status" : String(probe.status);
  return row(
    door.id,
    "FAIL",
    `${door.label} door answered ${shown} (expected 401 or 405)`,
    doorFix(door)
  );
}

const STUCK_SQL = `
  /* gap:stuck-failed */
  SELECT count(*)::int AS n
    FROM commas_inbox
   WHERE org_id = $1::uuid
     AND status = 'failed'
     AND attempts >= $2::int
`;

function countOf(result) {
  const raw = result?.rows?.[0]?.n;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function checkStuck({ db, orgId }) {
  const id = "webhooks:stuck-failed";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — stuck webhook rows not read");
  }
  try {
    const result = await db.query(STUCK_SQL, [orgId, STUCK_AFTER_ATTEMPTS]);
    const n = countOf(result);
    if (n == null) {
      return row(id, "FAIL", "could not read stuck webhook rows", stuckFix());
    }
    if (n === 0) {
      return row(
        id,
        "PASS",
        "no Commas (Fanbasis) inbox row is stuck failed after the sweeper stopped retrying"
      );
    }
    const noun = n === 1 ? "row is" : "rows are";
    return row(
      id,
      "FAIL",
      `${n} Commas (Fanbasis) inbox ${noun} stuck failed (attempts at the sweeper limit).`,
      stuckFix()
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read stuck webhook rows: ${String(err?.message || err).slice(0, 180)}`,
      stuckFix()
    );
  }
}

/**
 * Read-only inbound webhook checks.
 * ctx: { fetchImpl, baseUrl, db, orgId }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
  const baseUrl = ctx.baseUrl || DEFAULT_BASE_URL;
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;

  let doors;
  if (!fetchImpl) {
    doors = DOORS.map((door) => row(
      door.id,
      "skip",
      "no fetch in this run — webhook doors not probed"
    ));
  } else {
    const probed = await probeDoors(fetchImpl, baseUrl);
    doors = DOORS.map((door) => doorCheck(door, probed.get(door.path)));
  }

  return [...doors, await checkStuck({ db, orgId })];
}
