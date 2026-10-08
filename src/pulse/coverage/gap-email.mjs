// Email that should go out and does not. Read-only. Report only.
//
// Slice 12 names the messaging sweepers. It does not read the email queue.
// pipeline:outbound counts every channel. This file counts email only.
// Resend and Mailgun send. This file does not call them.
//
// Tripwire is the morning pulse, Recon (AG-07). Do not build a second watchdog.
// Do not send email. Do not flip the outbound switch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** Same 30 minutes as pipeline:outbound. Email rows only. */
export const STUCK_MINUTES = 30;

/** A failed send stays red for 3 mornings. */
export const PROVIDER_FAIL_DAYS = 3;

/** A magic link expires in minutes. A missing email shows the same day. */
export const MAGIC_LINK_HOURS = 24;

/** Same key as MAGIC_LINK_TEMPLATE_KEY in src/auth/magic-link.mjs. */
export const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";

export const STUCK_SQL = `
SELECT count(*)::int AS n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'email'
   AND status = 'queued'
   AND coalesce(scheduled_at, created_at) < $2::timestamptz
`.trim();

/* status failed is the provider give-up. Test-address and synthetic holds
   are not a provider outage. A missing address is not one either. */
export const PROVIDER_FAIL_SQL = `
SELECT count(*)::int AS n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'email'
   AND status = 'failed'
   AND coalesce(last_attempt_at, updated_at, created_at) >= $2::timestamptz
   AND last_error IS NOT NULL
   AND last_error NOT ILIKE '%test address%'
   AND last_error NOT ILIKE '%test record from a journey run%'
   AND last_error NOT ILIKE '%to send to%'
`.trim();

/* Exact provider_ref is workflow:<template>:magic-link:<link id>.
   A caller that passes its own event id still queues the same template
   a few minutes later. Either match means the mail was queued. */
export const MAGIC_LINK_SQL = `
SELECT count(*)::int AS n
  FROM account_magic_links l
 WHERE l.org_id = $1::uuid
   AND l.outcome = 'issued'
   AND l.created_at >= $2::timestamptz
   AND NOT EXISTS (
     SELECT 1
       FROM messages m
      WHERE m.org_id = l.org_id
        AND m.direction = 'outbound'
        AND m.channel = 'email'
        AND m.template_key = $3
        AND (
          m.provider_ref = 'workflow:' || $3 || ':magic-link:' || l.id::text
          OR (
            m.created_at >= l.created_at - interval '2 minutes'
            AND m.created_at <= l.created_at + interval '10 minutes'
            AND (
              m.client_id IS NOT DISTINCT FROM l.client_id
              OR lower(coalesce(m.to_address, '')) = lower(l.email)
            )
          )
        )
   )
`.trim();

/* Morning jobs that queue email. The file is the place the send result
   is supposed to be read. slo-infinite-drip is 8:00 a.m. Arizona.
   contract-chaser is 10:00 UTC. document-vault-chase is 9:45 a.m. Arizona. */
export const MORNING_EMAIL_PATHS = Object.freeze([
  Object.freeze({
    id: "slo-infinite-drip",
    file: "src/workflows/slo-infinite-drip.mjs",
    when: "8:00 a.m. Arizona"
  }),
  Object.freeze({
    id: "contract-chaser",
    file: "src/contracts/notify.mjs",
    when: "10:00 UTC"
  }),
  Object.freeze({
    id: "document-vault-chase",
    file: "src/finance/document-vault-chase.mjs",
    when: "9:45 a.m. Arizona"
  })
]);

const FAILURE_CHECK = /\.sent\b|notQueued|template_pending|send_failed|nothing_queued/;

const RECON =
  "Report it on the morning pulse (Recon AG-07). Do not send email from this check. Do not flip outbound. Do not build a second watchdog.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function canQuery(db) {
  return !!(db && typeof db.query === "function");
}

/**
 * True when this source queues email and never reads whether that queue worked.
 * A file that does not queue email is not this gap.
 */
export function morningEmailPathMissesFailureCheck(src) {
  const text = String(src || "");
  const sendsEmail = /channel:\s*["']email["']/.test(text)
    || (/["']email["']/.test(text) && /sendTemplated|queueSignerMessages|INSERT INTO messages/.test(text));
  if (!sendsEmail) return false;
  return !FAILURE_CHECK.test(text);
}

export function unreadMorningEmailPaths(sources, paths = MORNING_EMAIL_PATHS) {
  const misses = [];
  for (const row of paths) {
    const src = sources ? sources[row.file] : undefined;
    if (typeof src !== "string") {
      misses.push({ ...row, why: "could not be read" });
      continue;
    }
    if (morningEmailPathMissesFailureCheck(src)) {
      misses.push({ ...row, why: "sends email and does not check whether it queued" });
    }
  }
  return misses;
}

function loadMorningSources({ root = REPO_ROOT, sources } = {}) {
  if (sources) return sources;
  const out = {};
  for (const row of MORNING_EMAIL_PATHS) {
    try {
      out[row.file] = fs.readFileSync(path.join(root, row.file), "utf8");
    } catch {
      out[row.file] = null;
    }
  }
  return out;
}

function morningCheck(sources) {
  const misses = unreadMorningEmailPaths(sources);
  if (!misses.length) {
    const names = MORNING_EMAIL_PATHS.map((row) => row.id).join(", ");
    return check(
      "email:morning-no-failure-check",
      "PASS",
      `Morning email paths check whether the mail queued: ${names}.`
    );
  }
  const detail = misses.map((row) => `${row.file} (${row.when}) ${row.why}.`).join(" ");
  return check(
    "email:morning-no-failure-check",
    "FAIL",
    detail,
    `Read the send result in that morning job and leave the miss on its tally. ${RECON}`
  );
}

async function safeCount(db, sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    const n = Number(rows?.[0]?.n || 0);
    return { ok: true, n: Number.isFinite(n) && n > 0 ? n : 0 };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 160) };
  }
}

function fromCount(id, result, passDetail, failDetail, fix) {
  if (!result.ok) return check(id, "FAIL", `could not read: ${result.error}`, fix);
  if (result.n > 0) return check(id, "FAIL", failDetail(result.n), fix);
  return check(id, "PASS", passDetail);
}

function stuckDetail(n) {
  if (n === 1) return `1 outbound email is still queued past ${STUCK_MINUTES} minutes.`;
  return `${n} outbound emails are still queued past ${STUCK_MINUTES} minutes.`;
}

function providerDetail(n) {
  if (n === 1) return `1 outbound email failed at the provider in the last ${PROVIDER_FAIL_DAYS} days.`;
  return `${n} outbound emails failed at the provider in the last ${PROVIDER_FAIL_DAYS} days.`;
}

function magicDetail(n) {
  if (n === 1) return "1 magic-link sign-in was issued and no email was queued.";
  return `${n} magic-link sign-ins were issued and no email was queued.`;
}

/**
 * gapChecks — four read-only rows.
 * ctx: { db, orgId, now, root, sources }.
 * sources replaces the morning-file read (tests). Never writes. Never sends.
 */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
  const rows = [];
  if (!canQuery(ctx.db) || !ctx.orgId) {
    const why = !canQuery(ctx.db) ? "no database in this run" : "no org in this run";
    rows.push(check("email:queued-stuck", "skip", `${why} — email queue not read`));
    rows.push(check("email:provider-fail", "skip", `${why} — email failures not read`));
    rows.push(check("email:magic-link-unqueued", "skip", `${why} — magic-link mail not read`));
  } else {
    const stuckBefore = new Date(now.getTime() - STUCK_MINUTES * 60 * 1000);
    const failedSince = new Date(now.getTime() - PROVIDER_FAIL_DAYS * 24 * 60 * 60 * 1000);
    const magicSince = new Date(now.getTime() - MAGIC_LINK_HOURS * 60 * 60 * 1000);
    const stuckFix = `The message dispatch sweeper already drains this queue. Read the stuck email rows. ${RECON}`;
    const providerFix = `Read last_error on the failed email. ${RECON}`;
    const magicFix = `requestMagicLink queues ${MAGIC_LINK_TEMPLATE_KEY} and then stops. Read why that email row is missing. ${RECON}`;
    const [stuck, failed, magic] = await Promise.all([
      safeCount(ctx.db, STUCK_SQL, [ctx.orgId, stuckBefore]),
      safeCount(ctx.db, PROVIDER_FAIL_SQL, [ctx.orgId, failedSince]),
      safeCount(ctx.db, MAGIC_LINK_SQL, [ctx.orgId, magicSince, MAGIC_LINK_TEMPLATE_KEY])
    ]);
    rows.push(fromCount(
      "email:queued-stuck",
      stuck,
      `no outbound email queued longer than ${STUCK_MINUTES} minutes`,
      stuckDetail,
      stuckFix
    ));
    rows.push(fromCount(
      "email:provider-fail",
      failed,
      `no outbound email marked failed in the last ${PROVIDER_FAIL_DAYS} days`,
      providerDetail,
      providerFix
    ));
    rows.push(fromCount(
      "email:magic-link-unqueued",
      magic,
      `no issued magic link in the last ${MAGIC_LINK_HOURS} hours is missing its email`,
      magicDetail,
      magicFix
    ));
  }
  rows.push(morningCheck(loadMorningSources(ctx)));
  return rows;
}
