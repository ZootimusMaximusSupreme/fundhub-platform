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
//
// TIER 1, 2026-10-09: two more rows.
//   webhooks:inbound-doors-mounted  the nine other doors vendors knock on
//     (twilio inbound, resend, mailgun, mailgun-events, postgrid, bland,
//     lendflow, inquiry-removal, submagic). Same two probes as above, run for
//     each. A live GET is 405 for any name, so the router in this process is the
//     one that can say "no such door".
//   webhooks:receipts-silent-after-sends  we sent texts and emails: did a
//     delivery receipt come back for them? Reads messages and webhook_captures.
//     The router keeps one webhook_captures row per receipt it accepted, and a
//     refused receipt (wrong signing key, no secret) leaves no row at all, so a
//     dead receipt door looks like silence. Each send is matched to its own
//     receipt by the vendor's message id, so receipts for other sends (the pulse
//     text, staff texts) cannot hide the gap.

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

export const INBOUND_DOORS_ID = "webhooks:inbound-doors-mounted";
export const RECEIPTS_ID = "webhooks:receipts-silent-after-sends";

export const CHECK_IDS = Object.freeze([
  ...DOORS.map((door) => door.id),
  "webhooks:stuck-failed",
  INBOUND_DOORS_ID,
  RECEIPTS_ID
]);

const ACCEPTED = new Set([401, 405]);

/** Three GETs run side by side. 8 seconds each leaves the lane well inside its step. */
export const PROBE_TIMEOUT_MS = 8000;

/** What a mounted provider says to an unsigned, empty, secret-less probe. 404 is the only "not mounted". */
const ROUTER_REFUSED = new Set([400, 401, 403, 405, 422]);

/**
 * The nine other doors. The first four rows above watch twilio-status, commas and
 * clickfunnels; these are the rest of the providers src/http/router.mjs serves
 * (merchant-whop and merchant-commas are a client's own processor, not watched here).
 * `carries` is what a customer loses when the door is gone, in plain words.
 */
export const INBOUND_DOORS = Object.freeze([
  { provider: "twilio", carries: "texts customers send back, and STOP" },
  { provider: "resend", carries: "email delivery receipts and spam complaints" },
  { provider: "mailgun", carries: "bank decision emails" },
  { provider: "mailgun-events", carries: "bank mail delivery receipts" },
  { provider: "postgrid", carries: "letter delivery, which starts the call clock" },
  { provider: "bland", carries: "finished voice calls" },
  { provider: "lendflow", carries: "funding round updates" },
  { provider: "inquiry-removal", carries: "inquiry removal results" },
  { provider: "submagic", carries: "finished ad videos" }
]);

/**
 * What a mounted provider says to the unsigned empty probe. Measured 2026-10-09 against
 * the real router: 401 for eight of them, 400 for submagic (no project id), and 503 for
 * resend (no signing secret in the probe, so it fails closed). 404 "unknown provider"
 * is the only "not mounted".
 */
const INBOUND_ROUTER_REFUSED = new Set([...ROUTER_REFUSED, 503]);

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
  return probePaths(fetchImpl, baseUrl, DOORS.map((door) => door.path));
}

/** One GET per unique path, all side by side. Returns Map(path → { status } | { error }). */
async function probePaths(fetchImpl, baseUrl, allPaths) {
  const byPath = new Map();
  const paths = [...new Set(allPaths)];
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

function numberOf(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function countOf(result) {
  return numberOf(result?.rows?.[0]?.n);
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

// ---------------------------------------------------------------------------
// webhooks:inbound-doors-mounted
// ---------------------------------------------------------------------------

function clipText(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/** The router's own "no such provider" answer. A bare 404 from a test double counts the same. */
function isUnknownProvider(out) {
  if (Number(out?.status) !== 404) return false;
  const err = out?.body?.error;
  return err == null || /unknown provider/i.test(String(err));
}

function liveProblem(probe) {
  if (!probe) return "live site was not asked";
  if (probe.error) return `live site did not answer (${probe.error})`;
  if (probe.status === 404) return "live site answered 404";
  if (!ACCEPTED.has(probe.status)) {
    return `live site answered ${probe.status == null ? "no status" : probe.status} (expected 401 or 405)`;
  }
  return null;
}

function routerProblem(routed) {
  if (!routed) return "router was not asked";
  if (routed.error) return `router could not be checked (${routed.error})`;
  if (isUnknownProvider(routed)) return "router has no door for it (404 unknown provider)";
  if (!INBOUND_ROUTER_REFUSED.has(routed.status)) {
    return `router answered ${routed.status == null ? "no status" : routed.status} to an unsigned empty probe (expected a refusal)`;
  }
  return null;
}

/** The router in this process for every inbound provider. One slow or broken handler never blocks the rest. */
async function probeInboundRouter(routerProbe, baseUrl) {
  const byProvider = new Map();
  let probe = routerProbe;
  if (typeof probe !== "function") {
    try {
      probe = await loadRouterProbe();
    } catch (err) {
      const error = `webhook router would not load: ${String(err?.message || err).slice(0, 140)}`;
      for (const door of INBOUND_DOORS) byProvider.set(door.provider, { error });
      return byProvider;
    }
  }
  await Promise.all(INBOUND_DOORS.map(async (door) => {
    let timer;
    try {
      const url = joinUrl(baseUrl, `/api/webhooks/${door.provider}`);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer in time")), PROBE_TIMEOUT_MS);
      });
      const out = await Promise.race([Promise.resolve(probe(door.provider, url)), timeout]);
      const status = Number(out?.status);
      byProvider.set(door.provider, {
        status: Number.isFinite(status) ? status : null,
        body: out?.body ?? null
      });
    } catch (err) {
      byProvider.set(door.provider, { error: String(err?.message || err).slice(0, 160) });
    } finally {
      clearTimeout(timer);
    }
  }));
  return byProvider;
}

function inboundDoorsFix(broken) {
  const names = broken.map((b) => b.provider).join(", ");
  return (
    `${RECON} Doors to look at: ${names}. ` +
    "A missing provider is added to the tables in src/http/router.mjs. " +
    "The live site must route /api/webhooks/<provider> to api/webhooks/[provider].mjs."
  );
}

/**
 * Is every inbound door still there? ctx: { fetchImpl, baseUrl, routerProbe }.
 * Two probes per provider, same as the first four rows: a live GET (proves the
 * /api/webhooks/ prefix is deployed) and the router in this process (the only one
 * that can say "no such provider", because the live GET is 405 for any name).
 */
async function checkInboundDoors({ fetchImpl, baseUrl, routerProbe }) {
  if (!fetchImpl) {
    return row(INBOUND_DOORS_ID, "skip", "no fetch in this run — inbound webhook doors not probed");
  }
  try {
    const paths = INBOUND_DOORS.map((d) => `/api/webhooks/${d.provider}`);
    const [live, routed] = await Promise.all([
      probePaths(fetchImpl, baseUrl, paths),
      probeInboundRouter(routerProbe, baseUrl)
    ]);
    const broken = [];
    for (const door of INBOUND_DOORS) {
      const problems = [
        liveProblem(live.get(`/api/webhooks/${door.provider}`)),
        routerProblem(routed.get(door.provider))
      ].filter(Boolean);
      if (problems.length) broken.push({ provider: door.provider, carries: door.carries, problems });
    }
    if (!broken.length) {
      const list = INBOUND_DOORS.map((d) => d.provider).join(", ");
      return row(
        INBOUND_DOORS_ID,
        "PASS",
        `all ${INBOUND_DOORS.length} inbound doors are mounted (${list}): the live site answered, and the webhook router refused an unsigned empty probe on each`
      );
    }
    // The pulse keeps 500 characters. Up to three broken doors get what a customer loses; more than
    // three get the short form so that every door still fits, and the fix text names them all.
    const full = broken.length <= 3;
    const lines = broken.map((b) => (
      full ? `${b.provider} (${b.carries}): ${b.problems.join("; ")}` : `${b.provider}: ${b.problems[0]}`
    ));
    return row(
      INBOUND_DOORS_ID,
      "FAIL",
      clipText(`${broken.length} of ${INBOUND_DOORS.length} inbound doors are broken. ${lines.join(" | ")}`, 495),
      inboundDoorsFix(broken)
    );
  } catch (err) {
    return row(INBOUND_DOORS_ID, "skip", `inbound doors could not be probed: ${String(err?.message || err).slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// webhooks:receipts-silent-after-sends
// ---------------------------------------------------------------------------

/** Texts and emails that went out, and the receipt door each one answers on. */
export const RECEIPT_CHANNELS = Object.freeze([
  Object.freeze({ channel: "sms", provider: "twilio", door: "twilio-status", noun: "text", nouns: "texts" }),
  Object.freeze({ channel: "email", provider: "resend", door: "resend", noun: "email", nouns: "emails" })
]);

/** Real volume is a handful a day (measured 2026-10-09: 0 to 7 texts a day, and 4 of the last 10 full days had none), so a 24 hour look is blind on a quiet day. */
export const RECEIPT_LOOKBACK_HOURS = 72;
/** A receipt arrives in seconds. An hour of grace covers a slow carrier or a held email. */
export const RECEIPT_GRACE_MINUTES = 60;
/** Look at the newest few sends per channel. Three in a row with no receipt is not chance (1 in 74 lost one, measured). */
export const RECEIPT_NEWEST_SENDS = 3;

/* The router stores a webhook_captures row for every receipt it accepted (status 200) and for
   nothing it refused, so a wrong signing key or a missing secret leaves silence, not a row.
   Each send is matched to its own receipt by the vendor's message id (Twilio SM..., Resend
   email id) found in the stored body. Matching by provider alone would let the pulse's own
   texts hide a dead door. A receipt cannot come before the row it is about, so captures are
   only read from the send's creation on. */
export const RECEIPTS_SQL = `
  /* gap:receipts-silent */
  WITH sends AS (
    SELECT m.channel,
           m.provider_message_id AS sid,
           m.created_at,
           COALESCE(m.last_attempt_at, m.created_at) AS sent_at,
           row_number() OVER (
             PARTITION BY m.channel
             ORDER BY COALESCE(m.last_attempt_at, m.created_at) DESC
           ) AS rn
      FROM messages m
     WHERE m.org_id = $1::uuid
       AND m.direction = 'outbound'
       AND COALESCE(m.is_demo, false) = false
       AND m.provider_message_id IS NOT NULL
       AND (
         (m.channel = 'sms' AND m.provider = 'twilio')
         OR (m.channel = 'email' AND m.provider = 'resend')
       )
       AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
       AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz
  )
  SELECT s.channel,
         (SELECT count(*)::int FROM sends t WHERE t.channel = s.channel) AS sends,
         count(*)::int AS checked,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1
             FROM webhook_captures c
            WHERE c.provider = CASE s.channel WHEN 'sms' THEN 'twilio-status' ELSE 'resend' END
              AND c.created_at >= s.created_at
              AND position(s.sid in c.raw_body) > 0
         ))::int AS got,
         max(s.sent_at) AS newest_sent_at
    FROM sends s
   WHERE s.rn <= $4::int
   GROUP BY s.channel
`;

function stamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function receiptsFix(silent) {
  const parts = [];
  for (const c of silent) {
    if (c.channel === "sms") {
      parts.push(
        "Texts: receipts come back to /api/webhooks/twilio-status. A signing key that does not match the one Twilio signs with " +
        "answers 401 to every receipt and leaves no row. A missing public base url sends no callback address at all."
      );
    } else {
      parts.push(
        "Emails: receipts come back to /api/webhooks/resend. No RESEND_WEBHOOK_SECRET answers 503 to every receipt, " +
        "a wrong one answers 401, and neither leaves a row."
      );
    }
  }
  return `${RECON} ${parts.join(" ")} Read the webhook_captures rows for that provider to see when the last receipt arrived.`;
}

/**
 * Did a delivery receipt come back for what we sent? ctx: { db, orgId, now }.
 * Red for a channel when the newest sends (old enough to have a receipt) have none.
 * A channel with nothing sent in the window has nothing to wait for and is not red.
 */
async function checkReceipts({ db, orgId, now }) {
  if (!db || typeof db.query !== "function") {
    return row(RECEIPTS_ID, "skip", "no database in this run — delivery receipts not read");
  }
  if (!orgId) {
    return row(RECEIPTS_ID, "skip", "no company in this run — delivery receipts not read");
  }
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const since = new Date(clock.getTime() - RECEIPT_LOOKBACK_HOURS * 3600 * 1000);
  const before = new Date(clock.getTime() - RECEIPT_GRACE_MINUTES * 60 * 1000);
  let result;
  try {
    result = await db.query(RECEIPTS_SQL, [orgId, since.toISOString(), before.toISOString(), RECEIPT_NEWEST_SENDS]);
  } catch (err) {
    return row(RECEIPTS_ID, "skip", `delivery receipts could not be read: ${String(err?.message || err).slice(0, 160)}`);
  }
  if (!result || !Array.isArray(result.rows)) {
    return row(RECEIPTS_ID, "skip", "delivery receipts could not be read: the database sent no rows back");
  }
  const byChannel = new Map(result.rows.map((r) => [String(r?.channel), r]));
  const silent = [];
  const notes = [];
  for (const c of RECEIPT_CHANNELS) {
    const got = byChannel.get(c.channel);
    if (!got) {
      notes.push(`no ${c.nouns} to wait on in the last ${RECEIPT_LOOKBACK_HOURS} hours`);
      continue;
    }
    const checked = numberOf(got.checked);
    const back = numberOf(got.got);
    if (checked == null || back == null || back > checked) {
      return row(RECEIPTS_ID, "skip", `delivery receipt counts for ${c.nouns} came back unreadable`);
    }
    if (checked > 0 && back === 0) {
      silent.push({ ...c, checked, newest: stamp(got.newest_sent_at) });
    } else {
      notes.push(`${back} of the newest ${checked} ${c.nouns} have a receipt`);
    }
  }
  if (!silent.length) {
    return row(RECEIPTS_ID, "PASS", clipText(`delivery receipts are coming back: ${notes.join("; ")}`, 480));
  }
  const lines = silent.map((c) => {
    const newest = c.newest ? `, newest sent ${c.newest}` : "";
    return `none of the newest ${c.checked} ${c.nouns} has a delivery receipt (door /api/webhooks/${c.door}${newest})`;
  });
  return row(
    RECEIPTS_ID,
    "FAIL",
    clipText(`We sent ${silent.map((c) => c.nouns).join(" and ")} and no receipt came back: ${lines.join("; ")}. A dropped message would still read as sent.`, 480),
    receiptsFix(silent)
  );
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

  const firstFour = async () => {
    if (!fetchImpl) {
      return DOORS.map((door) => row(
        door.id,
        "skip",
        "no fetch in this run — webhook doors not probed"
      ));
    }
    const [probed, routed] = await Promise.all([
      probeDoors(fetchImpl, baseUrl),
      probeRouter(ctx.routerProbe, baseUrl)
    ]);
    return DOORS.map((door) => withRouter(
      door,
      doorCheck(door, probed.get(door.path)),
      routed.get(providerOf(door))
    ));
  };

  // The four doors, the stuck-row read and the two Tier 1 rows run side by side:
  // this whole lane is one pulse step with a 26 second ceiling.
  const [doors, stuck, inbound, receipts] = await Promise.all([
    firstFour(),
    checkStuck({ db, orgId }),
    checkInboundDoors({ fetchImpl, baseUrl, routerProbe: ctx.routerProbe }),
    checkReceipts({ db, orgId, now: ctx.now })
  ]);

  return [...doors, stuck, inbound, receipts];
}
