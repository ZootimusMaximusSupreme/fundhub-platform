// Email that should go out and does not. Read-only. Report only.
//
// Slice 12 names the messaging sweepers. It does not read the email queue.
// pipeline:outbound (src/pulse/pipeline-motion.mjs) already counts every
// outbound row still queued past 30 minutes, email included, so this file does
// NOT count queued email a second time. It reads what that check cannot see:
// email picked up and never finished (status sending).
// Resend and Mailgun send. This file does not call them.
//
// Tripwire is the morning pulse, Recon (AG-07). Do not build a second watchdog.
// Do not send email. Do not flip the outbound switch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** The dispatcher flips queued to sending, calls the provider, then writes the result. Nothing reclaims a row that dies in between. */
export const SENDING_STUCK_MINUTES = 15;

/** A failed send stays red for 3 mornings. */
export const PROVIDER_FAIL_DAYS = 3;

/** A magic link expires in minutes. A missing email shows the same day. */
export const MAGIC_LINK_HOURS = 24;

/** Same key as MAGIC_LINK_TEMPLATE_KEY in src/auth/magic-link.mjs. */
export const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";

export const SENDING_STUCK_SQL = `
SELECT count(*)::int AS n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'email'
   AND status = 'sending'
   AND coalesce(last_attempt_at, updated_at, created_at) < $2::timestamptz
`.trim();

/* failed is the provider give-up. bounced is the provider saying the mail did not
   arrive (src/adapters/resend-events.mjs, mailgun.mjs). Test-address and synthetic
   holds are not a provider outage. A missing address is not one either. A failed row
   with no error text still counts. */
export const PROVIDER_FAIL_SQL = `
SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed_n,
       count(*) FILTER (WHERE status = 'bounced')::int AS bounced_n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'email'
   AND status IN ('failed', 'bounced')
   AND coalesce(last_attempt_at, updated_at, created_at) >= $2::timestamptz
   AND (
     status = 'bounced'
     OR (
       coalesce(last_error, '') NOT ILIKE '%test address%'
       AND coalesce(last_error, '') NOT ILIKE '%test record from a journey run%'
       AND coalesce(last_error, '') NOT ILIKE '%to send to%'
     )
   )
`.trim();

/* Exact provider_ref is workflow:<template>:magic-link:<link id>.
   A caller that passes its own event id still queues the same template
   a few minutes later. Either match means the mail was queued.
   The booking confirm links (365 day life, queueEmail false in
   src/workflows/s-04b-booking-reminders.mjs) ride inside the confirm email and
   never queue this template, so only short-lived links are read. A null client
   never matches a null client. */
export const MAGIC_LINK_SQL = `
SELECT count(*)::int AS n
  FROM account_magic_links l
 WHERE l.org_id = $1::uuid
   AND l.outcome = 'issued'
   AND l.created_at >= $2::timestamptz
   AND (l.expires_at IS NULL OR l.expires_at - l.created_at <= interval '1 hour')
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
              (l.client_id IS NOT NULL AND m.client_id = l.client_id)
              OR lower(coalesce(m.to_address, '')) = lower(l.email)
            )
          )
        )
   )
`.trim();

/* The roadmap drip (src/workflows/slo-infinite-drip.mjs, 8:00 a.m. Arizona) moves a
   person's slo_drip_step up by one every time it runs, whether or not an email was
   queued. So a person whose step is higher than the number of drip emails they
   have is a person the drip skipped. This reads the result in the database, which
   is the one place that works when the source file is not on disk.
   Measured 2026-10-08: sendTemplated is called with eventId null, so the ref is
   workflow:<template>:null and every person after the first dedupes into the
   first person's row. */
export const DRIP_SQL = `
SELECT count(*)::int AS n,
       COALESCE(sum(gap), 0)::int AS missing
  FROM (
    SELECT s.step - s.sent AS gap
      FROM (
        SELECT CASE WHEN c.custom_fields->>'slo_drip_step' ~ '^[0-9]+$'
                    THEN (c.custom_fields->>'slo_drip_step')::int ELSE 0 END AS step,
               (SELECT count(*) FROM messages m
                 WHERE m.org_id = c.org_id
                   AND m.client_id = c.id
                   AND m.channel = 'email'
                   AND m.template_key LIKE 'EMAIL-SLO-DRIP-%')::int AS sent
          FROM clients c
         WHERE c.org_id = $1::uuid
           AND COALESCE(c.is_demo, false) = false
           AND c.custom_fields->>'slo_drip_on' = '1'
      ) s
     WHERE s.step > s.sent
  ) g
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

/**
 * The morning files are read from disk. A deployed function does not carry
 * src/, so an unreadable file is a skip with the reason, never a FAIL and
 * never a PASS. The roadmap drip has its own database read (email:drip-step-no-email)
 * that works without the file.
 */
function morningCheck(sources) {
  const id = "email:morning-no-failure-check";
  const misses = unreadMorningEmailPaths(sources);
  const unreadable = misses.filter((row) => row.why === "could not be read");
  const real = misses.filter((row) => row.why !== "could not be read");
  if (real.length) {
    const detail = real.map((row) => `${row.file} (${row.when}) ${row.why}.`).join(" ");
    return check(
      id,
      "FAIL",
      detail,
      `Read the send result in that morning job and leave the miss on its tally. ${RECON}`
    );
  }
  if (unreadable.length) {
    const names = unreadable.map((row) => row.file).join(", ");
    return check(id, "skip", `Morning email source not on disk in this run, so not read: ${names}.`);
  }
  const names = MORNING_EMAIL_PATHS.map((row) => row.id).join(", ");
  return check(id, "PASS", `Morning email paths check whether the mail queued: ${names}.`);
}

/** One read. rows[0] with every named column a real number, or a reason. */
async function safeRead(db, sql, params, columns) {
  try {
    const { rows } = await db.query(sql, params);
    const got = rows && rows[0];
    if (!got) return { ok: false, error: "no row came back", unreadable: true };
    const out = {};
    for (const col of columns) {
      const raw = got[col];
      const n = raw == null || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${col} came back unreadable`, unreadable: true };
      out[col] = n > 0 ? Math.floor(n) : 0;
    }
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 160) };
  }
}

/** A read that failed is a FAIL (we cannot see the break). A count that came back blank is a skip. */
function unreadRow(id, result, fix) {
  if (result.unreadable) return check(id, "skip", `could not read: ${result.error}`);
  return check(id, "FAIL", `could not read: ${result.error}`, fix);
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function sendingDetail(n) {
  if (n === 1) return `1 outbound email has been on sending for more than ${SENDING_STUCK_MINUTES} minutes.`;
  return `${n} outbound emails have been on sending for more than ${SENDING_STUCK_MINUTES} minutes.`;
}

function providerDetail(failed, bounced) {
  const parts = [];
  if (failed) parts.push(`${failed} failed at the provider`);
  if (bounced) parts.push(`${bounced} bounced`);
  const total = failed + bounced;
  return `${total} outbound ${plural(total, "email", "emails")} did not arrive in the last ${PROVIDER_FAIL_DAYS} days (${parts.join(", ")}).`;
}

function magicDetail(n) {
  if (n === 1) return "1 magic-link sign-in was issued and no email was queued.";
  return `${n} magic-link sign-ins were issued and no email was queued.`;
}

function dripDetail(n, missing) {
  return `${n} ${plural(n, "person is", "people are")} on the roadmap drip with ${missing} ${plural(missing, "step", "steps")} that never queued an email.`;
}

/**
 * gapChecks — five read-only rows.
 * ctx: { db, orgId, now, root, sources }.
 * sources replaces the morning-file read (tests). Never writes. Never sends.
 */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
  const rows = [];
  if (!canQuery(ctx.db) || !ctx.orgId) {
    const why = !canQuery(ctx.db) ? "no database in this run" : "no org in this run";
    rows.push(check("email:sending-stuck", "skip", `${why} — email on sending not read`));
    rows.push(check("email:provider-fail", "skip", `${why} — email failures not read`));
    rows.push(check("email:magic-link-unqueued", "skip", `${why} — magic-link mail not read`));
    rows.push(check("email:drip-step-no-email", "skip", `${why} — roadmap drip not read`));
  } else {
    const sendingBefore = new Date(now.getTime() - SENDING_STUCK_MINUTES * 60 * 1000);
    const failedSince = new Date(now.getTime() - PROVIDER_FAIL_DAYS * 24 * 60 * 60 * 1000);
    const magicSince = new Date(now.getTime() - MAGIC_LINK_HOURS * 60 * 60 * 1000);
    const sendingFix = `The dispatcher picked this email up and never wrote a result, and nothing puts it back. Read the messages rows still on sending. ${RECON}`;
    const providerFix = `Read last_error on the failed email, or the bounce on the bounced one. ${RECON}`;
    const magicFix = `requestMagicLink queues ${MAGIC_LINK_TEMPLATE_KEY} and then stops. Read why that email row is missing. ${RECON}`;
    const dripFix = `The drip moved their step and no email row exists. Read slo_drip_step on the client and the EMAIL-SLO-DRIP rows. sendTemplated ignores a repeat provider_ref. ${RECON}`;
    const [sending, failed, magic, drip] = await Promise.all([
      safeRead(ctx.db, SENDING_STUCK_SQL, [ctx.orgId, sendingBefore], ["n"]),
      safeRead(ctx.db, PROVIDER_FAIL_SQL, [ctx.orgId, failedSince], ["failed_n", "bounced_n"]),
      safeRead(ctx.db, MAGIC_LINK_SQL, [ctx.orgId, magicSince, MAGIC_LINK_TEMPLATE_KEY], ["n"]),
      safeRead(ctx.db, DRIP_SQL, [ctx.orgId], ["n", "missing"])
    ]);
    rows.push(!sending.ok
      ? unreadRow("email:sending-stuck", sending, sendingFix)
      : sending.n > 0
        ? check("email:sending-stuck", "FAIL", sendingDetail(sending.n), sendingFix)
        : check("email:sending-stuck", "PASS", `no outbound email on sending longer than ${SENDING_STUCK_MINUTES} minutes`));
    rows.push(!failed.ok
      ? unreadRow("email:provider-fail", failed, providerFix)
      : failed.failed_n + failed.bounced_n > 0
        ? check("email:provider-fail", "FAIL", providerDetail(failed.failed_n, failed.bounced_n), providerFix)
        : check("email:provider-fail", "PASS", `no outbound email failed or bounced in the last ${PROVIDER_FAIL_DAYS} days`));
    rows.push(!magic.ok
      ? unreadRow("email:magic-link-unqueued", magic, magicFix)
      : magic.n > 0
        ? check("email:magic-link-unqueued", "FAIL", magicDetail(magic.n), magicFix)
        : check("email:magic-link-unqueued", "PASS", `no issued magic link in the last ${MAGIC_LINK_HOURS} hours is missing its email`));
    rows.push(!drip.ok
      ? unreadRow("email:drip-step-no-email", drip, dripFix)
      : drip.n > 0
        ? check("email:drip-step-no-email", "FAIL", dripDetail(drip.n, drip.missing), dripFix)
        : check("email:drip-step-no-email", "PASS", "every person on the roadmap drip has an email row for each step the drip took"));
  }
  rows.push(morningCheck(loadMorningSources(ctx)));
  return rows;
}
