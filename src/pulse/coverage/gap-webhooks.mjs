// Inbound webhook doors for the morning pulse. Read only.
// Twilio status, Commas (Fanbasis), ClickFunnels, and calendar booking.
// Calendar bookings land on the ClickFunnels webhook. There is no second door.
//
// TWO PROBES PER DOOR, because one of them cannot tell a door from a wall.
//   1. A live GET. api/webhooks/[provider].mjs answers 405 to every non-POST
//      BEFORE it looks at the provider name, so GET /api/webhooks/anything-at-all
//      is 405 (measured 2026-10-08, including a provider that does not exist). A 405
//      proves the webhook function is deployed. A 404 means the /api/webhooks/
//      prefix itself is gone. It cannot say whether one provider is mounted.
//   2. The router, in this process: the same table the live door reads. An empty
//      body with no signature, no secrets and a database that refuses every query
//      is answered 401 by a mounted provider and 404 "unknown provider" by one that
//      is not. Nothing is parsed, nothing is written, nothing is replayed.
// This file never POSTs. Tripwire is existing Recon (AG-07). Do not add another watcher.
//
// Twilio status and ClickFunnels answer inside the request. They do not keep a
// failed queue. Commas does: commas_inbox. A row the sweeper has finished
// retrying stays status failed, and a row that died mid-claim at the retry limit
// stays processing. Those are the stuck rows this file counts.

import { MAX_ATTEMPTS, STALE_CLAIM_MINUTES } from "../../payments/commas-inbox.mjs";

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

/** Three GETs run side by side. 8 seconds each leaves the lane well inside its step. */
export const PROBE_TIMEOUT_MS = 8000;

/** What a mounted provider says to an unsigned, empty, secret-less probe. 404 is the only "not mounted". */
const ROUTER_REFUSED = new Set([400, 401, 403, 405, 422]);

/** A database that refuses everything. The probe cannot write even if an adapter tried. */
export const REFUSING_DB = Object.freeze({
  async query() {
    throw new Error("gap check: the webhook probe never touches the database");
  }
});

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
    `${RECON} Read commas_inbox where status is failed, or processing and old, and attempts are at the sweeper limit. ` +
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
        headers: { accept: "application/json" },
        // Each lane is one pulse step with a 26 second ceiling. A hung door must be a FAIL, not a dead step.
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      const status = Number(res?.status);
      byPath.set(path, { status: Number.isFinite(status) ? status : null });
    } catch (err) {
      byPath.set(path, { error: String(err?.message || err).slice(0, 160) });
    }
  }));
  return byPath;
}

/**
 * The router in this process, called the way a provider with no signature would call it.
 * Returns { status } or { error }. ctx.routerProbe(provider, url) replaces it in tests.
 */
export async function loadRouterProbe() {
  const { handleWebhook: route } = await import("../../http/router.mjs");
  return (provider, url) => route({
    db: REFUSING_DB,
    provider,
    rawBody: "",
    headers: {},
    url,
    env: {}
  });
}

async function probeRouter(routerProbe, baseUrl) {
  const byProvider = new Map();
  let probe = routerProbe;
  if (typeof probe !== "function") {
    try {
      probe = await loadRouterProbe();
    } catch (err) {
      const error = `webhook router would not load: ${String(err?.message || err).slice(0, 140)}`;
      for (const door of DOORS) byProvider.set(providerOf(door), { error });
      return byProvider;
    }
  }
  for (const door of DOORS) {
    const provider = providerOf(door);
    if (byProvider.has(provider)) continue;
    try {
      const out = await probe(provider, joinUrl(baseUrl, door.path));
      const status = Number(out?.status);
      byProvider.set(provider, { status: Number.isFinite(status) ? status : null });
    } catch (err) {
      byProvider.set(provider, { error: String(err?.message || err).slice(0, 160) });
    }
  }
  return byProvider;
}

function providerOf(door) {
  return door.path.split("/").pop();
}

function doorDetail(door, status) {
  if (door.id === "webhooks:calendar-booking") {
    return `calendar booking door answered ${status} (ClickFunnels webhook, where booking posts land)`;
  }
  return `${door.label} door answered ${status}`;
}

/** Folds the router answer into a row the live GET already passed. */
function withRouter(door, passRow, router) {
  if (passRow.status !== "PASS") return passRow;
  if (!router) {
    return row(door.id, "FAIL", `${door.label} door was not checked in the webhook router`, doorFix(door));
  }
  if (router.error) {
    return row(door.id, "FAIL", `${door.label} door could not be checked in the webhook router: ${router.error}`, doorFix(door));
  }
  if (router.status === 404) {
    return row(
      door.id,
      "FAIL",
      `${door.label} door is missing from the webhook router (404 unknown provider), even though the live site answers`,
      doorFix(door)
    );
  }
  if (!ROUTER_REFUSED.has(router.status)) {
    const shown = router.status == null ? "no status" : String(router.status);
    return row(
      door.id,
      "FAIL",
      `${door.label} door answered ${shown} to an unsigned empty probe in the webhook router (expected 401)`,
      doorFix(door)
    );
  }
  return row(door.id, "PASS", `${passRow.detail}; the webhook router refused an unsigned empty probe (${router.status}), so it is mounted`);
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

/* The sweeper claims rows with attempts < the limit (src/payments/commas-inbox.mjs).
   A failed row at the limit is never claimed again. A processing row at the limit
   is not reclaimed after the stale window either, so both are stuck for good. */
const STUCK_SQL = `
  /* gap:stuck-failed */
  SELECT count(*)::int AS n
    FROM commas_inbox
   WHERE org_id = $1::uuid
     AND attempts >= $2::int
     AND (
       status = 'failed'
       OR (status = 'processing' AND claimed_at < now() - interval '${Number(STALE_CLAIM_MINUTES)} minutes')
     )
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
      `${n} Commas (Fanbasis) inbox ${noun} stuck failed (attempts at the sweeper limit; failed, or claimed and never finished).`,
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
 * ctx: { fetchImpl, baseUrl, db, orgId, routerProbe }. routerProbe is for tests.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 * No fetch in the run means a bare run: the doors are skipped, not guessed.
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : typeof ctx.fetch === "function" ? ctx.fetch : null;
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
    const [probed, routed] = await Promise.all([
      probeDoors(fetchImpl, baseUrl),
      probeRouter(ctx.routerProbe, baseUrl)
    ]);
    doors = DOORS.map((door) => withRouter(
      door,
      doorCheck(door, probed.get(door.path)),
      routed.get(providerOf(door))
    ));
  }

  return [...doors, await checkStuck({ db, orgId })];
}
