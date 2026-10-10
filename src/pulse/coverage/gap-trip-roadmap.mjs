// The roadmap trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:roadmap   Did every buyer who paid for the $297 roadmap in the last 60 days get every step
//                  the company owes, and what is the first step that is missing?
//
// THE LADDER (the brief's order).
//
//    1 roadmap_paid       client   paid the roadmap (payment_links, purpose diagnostic, link slo_*)
//    2 pull_form_filled   client   filled the pull form (payment_links.identity_stored_at), or a
//                                  credit file is already on record
//    3 pack_delivered     system   the pack is saved whole and the pack-ready email was queued
//    4 portal_sign_in     client   signed in to the portal
//
// Every judgement below is the one another lane already makes, so the trip and those lanes cannot
// disagree:
//   * the reminder owed to a buyer who has not filled the form after 2 hours is gap-soft-pull.mjs
//     (PAID_FORM_HOURS, NUDGE_KEYS, NUDGE_DEAD_STATUSES), and a buyer on a company, test or bot address
//     is owed none (classifyVisitor, the same call that lane makes);
//   * the pack is due 2 hours after the credit pull finished (gap-underwrite.mjs GRACE_MS), and "whole"
//     and "told" are judgePackFiles and judgePackEmail from that file, called on this buyer's row;
//   * a buyer who has held access for 72 hours and never signed in is portal:paid-client-never-signed-in
//     (gap-portal.mjs SIGN_IN_GRACE).
//
// WHAT IS RED (and only this):
//   * a paid buyer is past 2 hours with an empty form and no reminder went out;
//   * the credit pull finished 2 hours ago and no pack file was saved;
//   * a saved pack older than 30 minutes is not whole (a promised file is missing, a file is empty or
//     came from the short printer, the free map is missing), or no pack-ready email was queued;
//   * access has been held for 72 hours and the buyer never signed in.
//
// WHAT IS NEVER RED: a buyer who has not filled the form yet (inside 2 hours, or reminded), a pack
// whose only gap is a summary this run cannot say is owed, a buyer who signed in.
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no credit pull, no AI call. A failed read is a skip with the reason.

import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { INTERNAL_CLIENT_EMAIL_RE, SIGN_IN_GRACE } from "./gap-portal.mjs";
import {
  AUTO_QUEUED_MINUTES, NUDGE_DEAD_STATUSES, NUDGE_KEYS, PAID_FORM_HOURS, PROCESSING_MINUTES
} from "./gap-soft-pull.mjs";
import {
  GRACE_MS, PACK_ANCHOR_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE, PACK_SETTLE_MS, PACK_SUBTYPES,
  judgePackEmail, judgePackFiles
} from "./gap-underwrite.mjs";
import { classifyVisitor } from "../../slo/visitor.mjs";
import {
  MIN_MS, clip, nowOf, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import {
  BY, DAY_MS, HOUR_MS, NO_FIX, defaultOrg, judgeTrip, makeNaVerify, realClientSql, skipRow, whoIs
} from "./trip-kit.mjs";

const ID = "trip:roadmap";
export const CHECK_IDS = Object.freeze([ID]);

export const TRIP_NAME = "roadmap";
export const WINDOW_MS = LOOKBACK_MS;
export const ROW_CAP = 200;

/** "72 hours" in gap-portal.mjs, in milliseconds. */
export const SIGN_IN_GRACE_MS = Number.parseInt(String(SIGN_IN_GRACE), 10) * HOUR_MS;
export const FORM_REMINDER_MS = PAID_FORM_HOURS * HOUR_MS;
/** The pull runs by itself after the form: queued 15 minutes at most, then 15 minutes in flight (gap-soft-pull.mjs). */
export const PULL_DUE_MS = (AUTO_QUEUED_MINUTES + PROCESSING_MINUTES) * MIN_MS;

export const STEPS = Object.freeze([
  Object.freeze({ key: "roadmap_paid", label: "paid for the roadmap", by: BY.CLIENT }),
  Object.freeze({ key: "pull_form_filled", label: "filled the pull form", by: BY.CLIENT }),
  Object.freeze({
    key: "pack_delivered", label: "pack saved whole and the pack-ready email queued", by: BY.SYSTEM,
    from: "pull_done", fromLabel: "the credit pull was due to finish", graceMs: GRACE_MS,
    source: "the pack is built when analysis.completed lands (src/slo/deliver.mjs); wait = gap-underwrite GRACE_MS (2 hours) after the pull finished, or after the pull was due (15 + 15 minutes after the form)"
  }),
  Object.freeze({ key: "portal_sign_in", label: "signed in to the portal", by: BY.CLIENT })
]);

/**
 * One row per paid roadmap buyer in the window. $1 org, $2 window start, $3 test-client pattern,
 * $4 every subtype that counts as a pack file, $5 the core pack subtypes, $6 the paths that queue the
 * pack email, $7 the pack email template, $8 the form-reminder templates, $9 the dead message statuses.
 * The pack and email columns are the field names judgePackFiles and judgePackEmail read.
 */
export const TRIP_SQL = `
  /* gap:trip-roadmap */
  SELECT t.id::text                   AS client_id,
         t.client_code                AS client_code,
         t.email                      AS email,
         pl.paid_at                   AS paid_at,
         pl.identity_stored_at        AS form_filled_at,
         cf.at                        AS credit_file_at,
         nd.at                        AS nudge_at,
         pd.at                        AS pull_done_at,
         pk.subtypes                  AS subtypes,
         pk.first_at                  AS first_at,
         pk.last_at                   AS last_at,
         pk.empty_n                   AS empty_n,
         pk.short_n                   AS short_n,
         pk.core_n                    AS core_n,
         pk.email_path                AS email_path,
         pk.tier                      AS tier,
         em.at                        AS email_at,
         si.signed_in                 AS signed_in,
         ac.since                     AS access_since
    FROM (
      SELECT c.id, c.client_code, c.email
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
    JOIN LATERAL (
      SELECT COALESCE(l.paid_at, l.updated_at) AS paid_at, l.identity_stored_at
        FROM payment_links l
       WHERE l.org_id = $1::uuid AND l.client_id = t.id
         AND l.purpose = 'diagnostic' AND l.link_ref LIKE 'slo_%'
         AND (l.status = 'paid' OR l.paid_at IS NOT NULL)
         AND COALESCE(l.is_demo, false) = false
       ORDER BY COALESCE(l.paid_at, l.updated_at) DESC
       LIMIT 1
    ) pl ON pl.paid_at >= $2::timestamptz
    LEFT JOIN LATERAL (
      SELECT min(r.created_at) AS at
        FROM crs_results r
       WHERE r.org_id = $1::uuid AND r.client_id = t.id AND COALESCE(r.is_demo, false) = false
    ) cf ON true
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS at
        FROM messages m
       WHERE m.org_id = $1::uuid AND m.client_id = t.id AND m.template_key = ANY($8::text[])
         AND lower(COALESCE(m.status, '')) <> ALL($9::text[])
         AND m.created_at >= pl.paid_at
    ) nd ON true
    LEFT JOIN LATERAL (
      SELECT min(e.created_at) AS at
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'analysis.completed'
         AND e.payload ->> 'source' = 'crs' AND COALESCE(e.is_demo, false) = false
         AND e.created_at >= pl.paid_at
    ) pd ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT d.subtype)                                     AS subtypes,
             min(d.created_at)                                                 AS first_at,
             max(d.created_at)                                                 AS last_at,
             count(*) FILTER (WHERE d.byte_size = 0)::int                      AS empty_n,
             count(*) FILTER (WHERE d.metadata ->> 'engine' = 'pdf-lib')::int  AS short_n,
             count(DISTINCT d.subtype) FILTER (WHERE d.subtype = ANY($5::text[]))::int AS core_n,
             COALESCE(bool_or(d.generated_by = ANY($6::text[])), false)        AS email_path,
             (SELECT COALESCE(NULLIF(r.outcome_tier, ''), NULLIF(r.result ->> 'outcome', ''))
                FROM crs_results r
               WHERE r.client_id = t.id AND r.org_id = $1::uuid AND r.created_at <= max(d.created_at)
               ORDER BY r.created_at DESC
               LIMIT 1)                                                        AS tier
        FROM documents d
       WHERE d.org_id = $1::uuid AND d.client_id = t.id AND d.kind = 'deliverable'
         AND d.subtype = ANY($4::text[]) AND COALESCE(d.is_demo, false) = false
         AND d.created_at >= pl.paid_at - interval '1 hour'
    ) pk ON true
    LEFT JOIN LATERAL (
      SELECT max(m.created_at) AS at
        FROM messages m
       WHERE m.org_id = $1::uuid AND m.client_id = t.id AND m.template_key = $7::text
    ) em ON true
    LEFT JOIN LATERAL (
      SELECT (
               EXISTS (
                 SELECT 1 FROM accounts a
                  WHERE a.org_id = $1::uuid AND a.client_id = t.id AND a.kind = 'client'
                    AND a.last_login_at IS NOT NULL)
               OR EXISTS (
                 SELECT 1 FROM account_magic_links ml
                  WHERE ml.org_id = $1::uuid AND ml.consumed_at IS NOT NULL
                    AND (ml.client_id = t.id
                         OR ml.account_id IN (
                              SELECT a2.id FROM accounts a2
                               WHERE a2.org_id = $1::uuid AND a2.client_id = t.id)))
             ) AS signed_in
    ) si ON true
    LEFT JOIN LATERAL (
      SELECT min(q.at) AS since
        FROM (
          SELECT en.granted_at AS at
            FROM entitlements en
           WHERE en.org_id = $1::uuid AND en.client_id = t.id AND en.revoked_at IS NULL
             AND (en.expires_at IS NULL OR en.expires_at > now()) AND en.is_demo IS NOT TRUE
          UNION ALL
          SELECT COALESCE(dd.generated_at, dd.created_at)
            FROM documents dd
           WHERE dd.org_id = $1::uuid AND dd.client_id = t.id AND dd.kind = 'deliverable'
             AND dd.is_demo IS NOT TRUE
        ) q
    ) ac ON true
   ORDER BY pl.paid_at ASC
   LIMIT ${ROW_CAP}
`;

const ms = (v) => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Pure. One SQL row to one trip row. */
export function toTripRow(r, now = new Date()) {
  const facts = {};
  const defects = [];
  const notOwed = [];
  const detail = {};
  const nowMs = now.getTime();
  const paidMs = ms(r.paid_at);

  if (r.paid_at) facts.roadmap_paid = r.paid_at;
  const formAt = r.form_filled_at || r.credit_file_at || null;
  if (formAt) facts.pull_form_filled = formAt;

  // The reminder the form is owed after 2 hours (gap-soft-pull.mjs judgePaidForm). A buyer on a
  // company, test or bot address is never sent one, so is never missed.
  if (!formAt && paidMs != null && nowMs - paidMs > FORM_REMINDER_MS) {
    const person = classifyVisitor({ email: String(r.email || "").trim().toLowerCase() }).actor === "person";
    if (person && !r.nudge_at) {
      defects.push({
        key: "pull_form_filled",
        why: `the pull form has been empty for over ${PAID_FORM_HOURS} hours and no reminder text or email went out`
      });
    }
  }

  // The anchor for the pack's two hours: the day the pull finished, or the time it was due to finish
  // (queued 15 minutes at most, then 15 minutes in flight) when the buyer filled the form and no pull
  // has finished. A buyer with only an old credit file and no form has no anchor.
  const doneMs = ms(r.pull_done_at);
  const filledMs = ms(r.form_filled_at);
  if (doneMs != null) facts.pull_done = r.pull_done_at;
  else if (filledMs != null) facts.pull_done = new Date(filledMs + PULL_DUE_MS);

  // The pack. judgePackFiles and judgePackEmail are the underwrite lane's own judges, run on one row.
  const hasPack = Array.isArray(r.subtypes) && r.subtypes.length > 0;
  if (hasPack) {
    const lastMs = ms(r.last_at);
    const settling = lastMs != null && lastMs > nowMs - PACK_SETTLE_MS;
    if (settling) {
      // Files save one by one, seconds apart. A pack under 30 minutes old is not judged yet.
      facts.pack_delivered = r.last_at;
    } else {
      const files = judgePackFiles([{
        client_id: r.client_id, subtypes: r.subtypes, first_at: r.first_at, last_at: r.last_at,
        empty_n: r.empty_n, short_n: r.short_n, slo: true, tier: r.tier
      }], now);
      const mail = judgePackEmail([{
        client_id: r.client_id, core_n: r.core_n, first_at: r.first_at, last_at: r.last_at,
        email_path: r.email_path === true, slo: true, email_at: r.email_at
      }], now);
      const whole = files.bad.length === 0;
      const told = mail.notTold.length === 0;
      if (whole && told) facts.pack_delivered = r.last_at;
      else if (!whole) defects.push({ key: "pack_delivered", why: `the saved pack ${files.bad[0].problems.join(" and ")}` });
      else defects.push({ key: "pack_delivered", why: "the pack is saved and no pack-ready email was queued for the buyer" });
    }
  }

  // The portal.
  if (r.signed_in === true) facts.portal_sign_in = true;
  let stall = null;
  const sinceMs = ms(r.access_since);
  if (r.signed_in !== true && sinceMs != null && nowMs - sinceMs > SIGN_IN_GRACE_MS) {
    stall = {
      key: "portal_sign_in",
      why: `the buyer has held access for over ${SIGN_IN_GRACE} and has never signed in (src/pulse/coverage/gap-portal.mjs)`
    };
  }

  return { who: whoIs(r), facts, notOwed, ended: null, stall, detail, defects };
}

/** Pure. The verdict for the rows the SELECT returned. */
export function judgeRoadmap({ rows = [], now = new Date() } = {}) {
  return judgeTrip({
    id: ID,
    tripName: TRIP_NAME,
    steps: STEPS,
    rows: rows.map((r) => toTripRow(r, now)),
    now,
    windowDays: Math.round(WINDOW_MS / DAY_MS),
    cap: ROW_CAP,
    what: "buyer",
    fix:
      "Open the buyer's file and read the step named. A missing reminder, pack file or pack email means the reminder job or the pack job did not run: " +
      "read the slo-paid-form-nudge and slo-pack-delivery runs for that client. Do not send or rebuild from the pulse. " + NO_FIX
  });
}

export function tripParams(orgId, now) {
  return [
    orgId,
    new Date(now.getTime() - WINDOW_MS).toISOString(),
    INTERNAL_CLIENT_EMAIL_RE,
    PACK_ANCHOR_SUBTYPES,
    PACK_SUBTYPES,
    PACK_EMAIL_PATHS,
    PACK_EMAIL_TEMPLATE,
    [...NUDGE_KEYS],
    [...NUDGE_DEAD_STATUSES]
  ];
}

async function startedCount(run, orgId, now) {
  const out = await run((tx) => tx.query(TRIP_SQL, tripParams(orgId, now)));
  return Array.isArray(out && out.rows) ? out.rows.length : 0;
}

export const naVerify = makeNaVerify({ id: ID, countStarted: startedCount, runnerOf, nowOf, defaultOrg });

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the roadmap trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the roadmap trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeRoadmap({ rows: got.rows, now })];
  } catch (err) {
    return [skipRow(ID, `could not judge the roadmap trips: ${clip(err)}`)];
  }
}

