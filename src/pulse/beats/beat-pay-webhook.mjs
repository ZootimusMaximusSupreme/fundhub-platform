// Beat: the payment notice door (Chris's failure #1: "the payment webhook stopped working").
//
// READ ONLY. Nothing is posted, nothing is stored. It asks five questions:
//
//   secret-present    is COMMAS_WEBHOOK_SECRET set on the server?            (live only)
//   door-mounted      does GET /api/webhooks/commas answer 405?              (one GET to our own site)
//   verifier-accepts  does the real signature check accept a signed body?    (SKIPPED, see the step)
//   sweeper-alive     did the commas-inbox-sweeper clock run in the last 3 minutes?
//   inbox-not-stuck   is any paid notice waiting in commas_inbox, or gone for good?
//
// WHAT THIS CAN NEVER PROVE. That Commas still SENDS notices to us, and that the signing secret
// at Commas matches ours. Commas sends each notice once and never again, and this repo has no
// "list recent payments" call. A green here means our side is ready. It does not mean a notice
// is on its way. The detail of a green run says so.
//
// Sources of the rules (read, not invented):
//   door      api/webhooks/[provider].mjs      a GET answers 405 {"ok":false,"error":"Method not allowed"}
//   clocks    src/pulse/heartbeats.mjs         3 x the 1 minute schedule; src/pulse/coverage/gap-payments.mjs
//   inbox     src/pulse/coverage/gap-payments.mjs  COMMAS_INBOX_WAITING_SQL and gap-webhooks.mjs STUCK_SQL
//             (those were proven on live data; this beat reads the same columns the same way)

import { BeatFail, isMasked } from "./contract.mjs";

export const id = "pay-webhook";
export const title = "Payment notice door";
export const kind = "infra";
// webhook:commas is a key of the router's provider table (src/http/router.mjs, STD.commas).
export const covers = ["job:commas-inbox-drain", "webhook:commas"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["secret-present", "door-mounted", "verifier-accepts", "sweeper-alive", "inbox-not-stuck"];
export const damp = 1;
export const deadlineMs = 9000;

export const fixGuide = `Payment notices may not be arriving. Check the Commas signing secret on Netlify and the receipt clocks.

Likely causes:
- secret-present or verifier-accepts: COMMAS_WEBHOOK_SECRET is empty or was changed at Commas, so every real notice answers 401.
- door-mounted 404: the webhooks/ prefix is gone from netlify/functions/api.mjs, or api/webhooks/[provider].mjs was removed. A 5xx or no answer means the api function does not load (look for "Cannot find module" in the Netlify function log).
- sweeper-alive: the commas-inbox-sweeper clock stopped. Look at job_heartbeats for commas-inbox-sweeper, and check the scheduled function did not throw at load.
- inbox-not-stuck: a notice is waiting, or gave up after 10 tries. Read the row in commas_inbox and its last_error.
Steps:
- For the secret: copy the signing secret from the Commas webhook settings and set COMMAS_WEBHOOK_SECRET on Netlify production WITHOUT --secret. Never delete the old value first. Then ship once.
- For the door: restore the webhooks/ prefix in netlify/functions/api.mjs, then ship once.
- For the clock: open the Netlify scheduled function commas-inbox-sweeper and read its last run. The Inngest clock commas-inbox-drain also drains the inbox.
- For a waiting notice: keep the row bytes as they are. Commas never sends a notice twice.
- This beat cannot prove that Commas still sends, or that its secret matches ours. If this is green and payments stop, check the Commas webhook log.
Files: api/webhooks/[provider].mjs, netlify/functions/api.mjs, netlify/functions/commas-inbox-sweeper.mjs, src/payments/commas-inbox.mjs, src/adapters/commas.mjs
`;

/* The inbox rules, in one place. Each number has a source:
     10 tries      MAX_ATTEMPTS in src/payments/commas-inbox.mjs
     15 minutes    STALE_CLAIM_MINUTES in the same file (a claim held longer is taken back)
     10 minutes    INBOX_WAIT_MS in src/pulse/coverage/gap-payments.mjs
     20 minutes    INBOX_PROCESSING_WAIT_MS there (stale claim + 5)
   beat-pay-webhook.test.mjs checks them against those files. */
export const MAX_ATTEMPTS = 10;
export const WAIT_MINUTES = 10;
export const PROCESSING_WAIT_MINUTES = 20;
export const GAVE_UP_HOURS = 24;
export const SWEEPER_JOB = "commas-inbox-sweeper";
export const SWEEPER_SCHEDULE_MS = 60 * 1000;
export const SWEEPER_STALE_MS = 3 * SWEEPER_SCHEDULE_MS;
export const DOOR_PATH = "/api/webhooks/commas";

/* The newest receipt the sweeper left, and how its last pass ended. Same columns as
   checkJobHeartbeats in src/pulse/heartbeats.mjs. */
export const SWEEPER_SQL = `
  SELECT max(finished_at) AS last_at,
         (array_agg(outcome ORDER BY finished_at DESC))[1] AS last_outcome
    FROM job_heartbeats
   WHERE job = $1
`;

/* One row of counts. Simulated receipts (sim-pay-) are left out, like the morning pulse does:
   no card was charged for them. Rows are not filtered by company: the read box runs with staff
   scope and this company has one org. */
export const INBOX_SQL = `
  SELECT count(*) FILTER (WHERE w.waiting)::int AS waiting_n,
         count(*) FILTER (WHERE w.waiting AND w.status = 'pending')::int AS pending_n,
         count(*) FILTER (WHERE w.waiting AND w.status = 'failed')::int AS failed_n,
         count(*) FILTER (WHERE w.waiting AND w.status = 'processing')::int AS processing_n,
         count(*) FILTER (WHERE w.waiting AND w.event_type = 'payment.succeeded')::int AS paid_n,
         count(*) FILTER (WHERE w.gave_up)::int AS gave_up_n,
         floor(extract(epoch FROM (now() - min(w.received_at) FILTER (WHERE w.waiting))))::int AS oldest_s
    FROM (
      SELECT ci.status, ci.event_type, ci.received_at,
             (
               ci.status = 'pending'
               OR (ci.status = 'failed'
                   AND ci.attempts < ${MAX_ATTEMPTS}
                   AND COALESCE(ci.claimed_at, ci.received_at) < now() - interval '${WAIT_MINUTES} minutes')
               OR (ci.status = 'processing'
                   AND ci.attempts < ${MAX_ATTEMPTS}
                   AND ci.claimed_at < now() - interval '${PROCESSING_WAIT_MINUTES} minutes')
             ) AND ci.received_at < now() - interval '${WAIT_MINUTES} minutes' AS waiting,
             (
               ci.attempts >= ${MAX_ATTEMPTS}
               AND (ci.status = 'failed'
                    OR (ci.status = 'processing' AND ci.claimed_at < now() - interval '15 minutes'))
               AND COALESCE(ci.claimed_at, ci.received_at) > now() - interval '${GAVE_UP_HOURS} hours'
             ) AS gave_up
        FROM commas_inbox ci
       WHERE COALESCE(ci.payment_id, '') NOT LIKE 'sim-pay-%'
    ) w
`;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const minutes = (seconds) => {
  const m = Math.floor(num(seconds) / 60);
  return m < 1 ? "under a minute" : `${m} min`;
};

/* A read that fails. If the runner says the database is down (detail starts "db:"), pass that
   through word for word, so the runner folds it into its one database-down text. Any other read
   failure (a timeout, a missing table) stays a break of this door, with the table named. */
const readFailed = (ctx, step, table, err) => {
  const msg = String((err && err.message) || err).slice(0, 120);
  return ctx.fail(step, /^db:/i.test(msg.trim()) ? msg : `Could not read ${table}: ${msg}`);
};

const SKIP_VERIFIER =
  "The real signature check is verifyCommasSignature in src/adapters/commas.mjs. That file pulls in the event bus and " +
  "the database, so it is not pure and a beat may not import it (the static pin forbids it). A copy of the check here " +
  "would prove nothing. Needs the check moved to a file with no imports first.";

export async function run(ctx) {
  // 1. Is the secret there? A laptop holds a mask, so skip there. On the server an empty or
  //    masked value IS the break: every real notice would answer 401.
  if (!ctx.live) {
    ctx.skipStep("secret-present", "not on the server, so the signing secret here is a mask, not the real one");
  } else {
    await ctx.step("secret-present", async () => {
      if (isMasked(ctx.env.COMMAS_WEBHOOK_SECRET)) {
        throw ctx.fail("secret-present", "COMMAS_WEBHOOK_SECRET is empty (or only stars) on the server. Every real payment notice would be refused with 401.");
      }
    });
  }

  // 2. The door. One GET to our own site. A 405 means the webhooks/ prefix is mounted and the
  //    function loaded. (Any provider name answers 405, so this does not prove commas itself.)
  await ctx.step("door-mounted", async () => {
    const res = await ctx.http.get(`${ctx.siteUrl}${DOOR_PATH}`, { headers: { accept: "application/json" } });
    if (res.status === 405) {
      if (!/method not allowed/i.test(String(res.body || res.bodySnippet || ""))) {
        throw ctx.fail("door-mounted", `GET ${DOOR_PATH} answered 405 but not from the webhook function (its "Method not allowed" answer is missing).`);
      }
      return;
    }
    if (res.status === 404) {
      throw ctx.fail("door-mounted", `GET ${DOOR_PATH} answered 404. The webhooks/ prefix is not mounted, so Commas payment notices would be lost.`);
    }
    if (res.class === "blocked") {
      throw ctx.fail("door-mounted", "The pulse's own web fence is holding its calls (ADAPTERS_DRY_RUN), so the door was not asked.");
    }
    if (res.status >= 500) {
      throw ctx.fail("door-mounted", `GET ${DOOR_PATH} answered HTTP ${res.status}. The api function is not loading.`);
    }
    if (!res.status) {
      throw ctx.fail("door-mounted", `GET ${DOOR_PATH} got no answer (${res.class || "network"}).`);
    }
    throw ctx.fail("door-mounted", `GET ${DOOR_PATH} answered HTTP ${res.status}, not 405.`);
  });

  // 3. The real verifier. Cannot run from a beat. Said out loud, never faked.
  ctx.skipStep("verifier-accepts", SKIP_VERIFIER);

  // 4. Is the sweeper clock alive?
  await ctx.step("sweeper-alive", async () => {
    let row;
    try {
      row = (await ctx.read(SWEEPER_SQL, [SWEEPER_JOB])).rows[0];
    } catch (err) {
      if (err instanceof BeatFail) throw err;
      throw readFailed(ctx, "sweeper-alive", "job_heartbeats", err);
    }
    if (!row || !row.last_at) {
      throw ctx.fail("sweeper-alive", `job_heartbeats has no run of ${SWEEPER_JOB}. The payment inbox clock may never have started.`);
    }
    const last = new Date(row.last_at).getTime();
    if (!Number.isFinite(last)) {
      throw ctx.fail("sweeper-alive", `The newest ${SWEEPER_JOB} receipt has a time that cannot be read.`);
    }
    const ageMs = ctx.now.getTime() - last;
    if (ageMs > SWEEPER_STALE_MS) {
      throw ctx.fail("sweeper-alive", `${SWEEPER_JOB} last ran ${minutes(ageMs / 1000)} ago (it runs every minute). Paid notices are not being picked up.`);
    }
    if (row.last_outcome === "error") {
      throw ctx.fail("sweeper-alive", `${SWEEPER_JOB} ran ${minutes(ageMs / 1000)} ago but that pass ended in an error. Read its job_heartbeats row.`);
    }
  });

  // 5. Is any notice stuck?
  let inbox;
  await ctx.step("inbox-not-stuck", async () => {
    let row;
    try {
      row = (await ctx.read(INBOX_SQL)).rows[0] || {};
    } catch (err) {
      if (err instanceof BeatFail) throw err;
      throw readFailed(ctx, "inbox-not-stuck", "commas_inbox", err);
    }
    inbox = { waiting: num(row.waiting_n), pending: num(row.pending_n), failed: num(row.failed_n), processing: num(row.processing_n), paid: num(row.paid_n), gaveUp: num(row.gave_up_n), oldestS: num(row.oldest_s) };
    const bad = [];
    if (inbox.waiting > 0) {
      bad.push(
        `${plural(inbox.waiting, "payment notice is", "payment notices are")} waiting over ${WAIT_MINUTES} min in the inbox ` +
        `(${inbox.pending} never tried, ${inbox.failed} failed with tries left, ${inbox.processing} stuck mid-pass; ${inbox.paid} paid). Oldest: ${minutes(inbox.oldestS)}.`
      );
    }
    if (inbox.gaveUp > 0) {
      bad.push(`${plural(inbox.gaveUp, "notice gave", "notices gave")} up after ${MAX_ATTEMPTS} tries in the last ${GAVE_UP_HOURS} h.`);
    }
    if (bad.length) throw ctx.fail("inbox-not-stuck", bad.join(" "), inbox);
  });

  const skipped = ctx.live ? "" : " The signing secret was not checked (laptop).";
  return ctx.done(
    `Door answers 405, sweeper ran in the last 3 min, inbox is clear.${skipped} The signature check itself was NOT run, so a wrong signing secret at Commas would not show here. Cannot prove Commas still sends.`,
    inbox ? { inbox } : null
  );
}

/* ---- self test: fake inputs for the generic harness (src/pulse/beats/contract.mjs checkBeatSelfTest) ---- */

const SITE = "https://fundhub.ai";
const DOOR_OK = { status: 405, body: '{"ok":false,"error":"Method not allowed"}' };
const sweeperRows = (over) => ({ match: /FROM job_heartbeats/, rows: [{ last_at: new Date("2026-10-09T19:06:30.000Z"), last_outcome: "ok", ...over }] });
const inboxRows = (over) => ({
  match: /FROM commas_inbox/,
  rows: [{ waiting_n: 0, pending_n: 0, failed_n: 0, processing_n: 0, paid_n: 0, gave_up_n: 0, oldest_s: null, ...over }]
});

export const selfTest = {
  pass: () => ({
    env: { NETLIFY: "true", COMMAS_WEBHOOK_SECRET: "selftest-signing-secret-not-real" },
    http: { [`GET ${SITE}${DOOR_PATH}`]: DOOR_OK },
    read: [sweeperRows(), inboxRows()]
  }),
  // The door answers 404: the beat must stop at door-mounted.
  fail: () => ({
    env: { NETLIFY: "true", COMMAS_WEBHOOK_SECRET: "selftest-signing-secret-not-real" },
    http: { [`GET ${SITE}${DOOR_PATH}`]: { status: 404, body: '{"error":"Not found"}' } },
    read: [sweeperRows(), inboxRows()]
  })
};
