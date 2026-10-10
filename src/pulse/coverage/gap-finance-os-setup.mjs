// FinanceOS setup fee for the morning pulse. Read only. Report only. (coverage batch W2, 2026-10-10)
//
// Two yes-or-no questions a paying client would feel:
//
//   finance-os-setup:paid-turns-on   Did every client who paid the setup fee get FinanceOS turned on?
//   finance-os-setup:price-set       Does the Setup page have a price, or does it show "$X"?
//
// The setup fee is one payment_links row: purpose 'custom' and description 'Finance OS setup'
// (src/finance/money-setup.mjs SETUP_PURPOSE and SETUP_DESCRIPTION). When Commas says it is paid,
// src/handlers/payment-links.mjs calls ensureFinanceOsForSetupPayment, which opens one finance-os
// subscription with provider_ref 'payment_link:<link id>'. A client who already holds an active
// finance-os plan (a Capital Blueprint buyer) gets no second row, and that is also "turned on".
//
// So "turned on" here is: a finance-os subscription exists for that client with that link's
// provider_ref (it was opened for this payment, even if it has ended since), or the client holds an
// active finance-os plan right now. Only "never turned on" is red.
//
// The price comes from FINANCE_OS_SETUP_FEE_CENTS (src/finance/money-setup.mjs readSetupFeeCents).
// The same name is on the keys list in src/pulse/coverage/gap-keys.mjs. That row asks "is the key
// set". This row asks the question a client feels: "does Step 1 show a real price".
//
// A failed read is a skip with the reason, never a PASS. Test clients and demo links are left out
// and counted apart. Read only: no payment taken, no subscription opened, no text.

import { INBOX_PROCESSING_WAIT_MS } from "./gap-payments.mjs";
import {
  TEST_CLIENT_EMAIL_RE, TRIP, ageOf, intOf, looksMasked, nowOf, plural, readRow, row, runnerOf, skipWhy, testClientSql
} from "./money-reads.mjs";

export const CHECK_IDS = Object.freeze([
  "finance-os-setup:paid-turns-on",
  "finance-os-setup:price-set"
]);

/** The two columns that name the setup link. Held equal to src/finance/money-setup.mjs by a drift test. */
export const SETUP_PURPOSE = "custom";
export const SETUP_DESCRIPTION = "Finance OS setup";
export const SETUP_TIER = "finance-os";
export const SETUP_PROVIDER_REF_PREFIX = "payment_link:";
export const SETUP_FEE_ENV = "FINANCE_OS_SETUP_FEE_CENTS";

/** The webhook, then the Commas inbox clock, get this long to open the plan before it is a break. */
export const SETUP_GRACE_MS = INBOX_PROCESSING_WAIT_MS;

export const PAID_TURNS_ON_SQL = `
  /* gap:finance-os-setup-paid-turns-on */
  SELECT count(*) FILTER (WHERE NOT x.is_test)::int AS paid_n,
         count(*) FILTER (WHERE x.is_test)::int AS test_n,
         count(*) FILTER (WHERE NOT x.is_test AND NOT x.turned_on)::int AS n,
         min(x.paid_at) FILTER (WHERE NOT x.is_test AND NOT x.turned_on) AS oldest,
         left(
           string_agg(COALESCE(x.client_code, 'no code') || ' ($' || (x.amount_cents / 100)::text || ')', ', ' ORDER BY x.paid_at DESC)
             FILTER (WHERE NOT x.is_test AND NOT x.turned_on),
           240
         ) AS sample
    FROM (
      SELECT pl.id, pl.paid_at, pl.amount_cents, c.client_code,
             ${testClientSql("c.email", "$3")} AS is_test,
             EXISTS (
               SELECT 1
                 FROM subscriptions s
                WHERE s.org_id = pl.org_id
                  AND s.client_id = pl.client_id
                  AND s.tier = '${SETUP_TIER}'
                  AND (
                    s.provider_ref = '${SETUP_PROVIDER_REF_PREFIX}' || pl.id::text
                    OR (s.status = 'active'
                        AND s.effective_from <= $4::timestamptz
                        AND (s.effective_to IS NULL OR s.effective_to > $4::timestamptz))
                  )
             ) AS turned_on
        FROM payment_links pl
        LEFT JOIN clients c ON c.id = pl.client_id AND c.org_id = pl.org_id
       WHERE pl.org_id = $1::uuid
         AND pl.purpose = '${SETUP_PURPOSE}'
         AND pl.description = '${SETUP_DESCRIPTION}'
         AND pl.status = 'paid'
         AND COALESCE(pl.is_demo, false) = false
         AND pl.paid_at < $2::timestamptz
    ) x
`;

async function checkPaidTurnsOn({ run, orgId, now }) {
  const id = CHECK_IDS[0];
  const why = skipWhy({ run, orgId }, "paid setup fees");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - SETUP_GRACE_MS).toISOString();
  const got = await readRow(run, id, "paid setup fees", PAID_TURNS_ON_SQL, [
    orgId, cutoff, TEST_CLIENT_EMAIL_RE, now.toISOString()
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const paid = intOf(r.paid_n);
  const n = intOf(r.n);
  const testNote = intOf(r.test_n) ? ` (${plural(intOf(r.test_n), "test-client setup payment")} left out)` : "";
  if (n === 0) {
    return row(
      id,
      "PASS",
      paid === 0
        ? `no real client has paid the FinanceOS setup fee yet${testNote}`
        : `${plural(paid, "client")} paid the FinanceOS setup fee and each has FinanceOS turned on${testNote}`
    );
  }
  const oldest = r.oldest ? ` The oldest paid ${ageOf(r.oldest, now)} ago.` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Clients: ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "client")} paid the FinanceOS setup fee and FinanceOS was never turned on for them.${oldest}${sample}${testNote}`,
    `Read the paid payment_links row (purpose custom, description Finance OS setup) and the subscriptions rows for that client. ` +
      `src/handlers/payment-links.mjs calls ensureFinanceOsForSetupPayment (src/finance/money-setup.mjs) when a link is marked paid. ` +
      `Another plan in the way (075 allows one live plan per client) refuses it with a reason. Turn FinanceOS on by hand through the existing subscription flow. ${TRIP}`
  );
}

/** Whole cents above 0, or null. Same parse as readSetupFeeCents in src/finance/money-setup.mjs. */
export function parseSetupFeeCents(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function checkPriceSet({ env }) {
  const id = CHECK_IDS[1];
  if (!env || typeof env !== "object") return row(id, "skip", "no environment in this run, so the setup price was not read");
  const raw = env[SETUP_FEE_ENV];
  const cents = parseSetupFeeCents(raw);
  if (cents !== null) {
    return row(id, "PASS", `the FinanceOS setup price is set (${SETUP_FEE_ENV} is a whole number of cents above zero)`);
  }
  if (raw !== undefined && raw !== null && String(raw).trim() !== "" && looksMasked(raw)) {
    return row(id, "skip", `${SETUP_FEE_ENV} on this copy of the settings is a mask, not the live value, so the price was not read`);
  }
  return row(
    id,
    "FAIL",
    `${SETUP_FEE_ENV} is not set to a whole number of cents above zero, so Step 1 on the Setup page shows "$X" and the Pay button answers 409 price_not_set.`,
    `Set ${SETUP_FEE_ENV} (whole cents) on Netlify production, without --secret, then ship once. The price is Chris's call. ` +
      `Read src/finance/money-setup.mjs readSetupFeeCents and api/money/setup.mjs. ${TRIP}`
  );
}

/**
 * Two read-only checks. ctx: { db, scope, orgId, now, env }.
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  const out = [];
  try {
    out.push(await checkPaidTurnsOn({ run, orgId, now }));
  } catch (err) {
    out.push(row(CHECK_IDS[0], "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`));
  }
  out.push(checkPriceSet({ env: ctx.env }));
  return out;
}
