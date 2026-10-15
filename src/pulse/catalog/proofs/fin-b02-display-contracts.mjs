// Finish-853 batch 02: live saved-result checks for display controls that already leave a
// durable result. Each contract is one read-only SQL text. It takes the company as $1::uuid
// and returns sample_count (how many saved results exist) and bad_count (how many are wrong).
//
// Every contract is `emptyAs: "quiet"`: a control nobody has used in the window has nothing
// to judge, so it is green with the words "no saved results yet" and goes red on the first
// wrong one. The window (60 days) keeps old imported rows from turning a live check red.
//
// The SQL is written in the common subset of Postgres and SQLite on purpose (no regexes, no
// intervals other than `now() - interval 'N days'`, no arrays), so fin-b02-live-contracts.test.mjs
// can run the exact text against stand-in rows built from the real column names.
//
// This file imports only the offer catalog. It is read at build time by
// scripts/pulse/compile-catalog.mjs; the live bundle reads the compiled copy in generated.json.

import { getOffer } from "../../../config/offers.mjs";

export const FIN_B02_SOURCE = "src/pulse/catalog/proofs/fin-b02-display-contracts.mjs";
export const FIN_B02_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B02_LIVE_TEST = "src/pulse/catalog/proofs/fin-b02-live-contracts.test.mjs";
export const FIN_B02_PRESENT_TEST = "src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs";
export const FIN_B02_TRANSFERS_TEST = "src/pulse/catalog/proofs/fin-b02-transfers-open.test.mjs";
export const FIN_B02_FUNDED_TEST = "src/pulse/catalog/proofs/fin-b02-funded-column.test.mjs";
export const FIN_B02_FLOOR_TEST = "src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs";

/** The four offers the deck sells without a sale motion (src/sales/closer-deck.mjs sendDeckPayLink). */
export const PRIMARY_PAY_OFFER_KEYS = Object.freeze(["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]);

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;
const softPullCents = getOffer("SOFT_PULL").priceCents;
const primaryNames = PRIMARY_PAY_OFFER_KEYS.map((key) => getOffer(key).name);

function contract(control, requirement, key, body) {
  return Object.freeze({
    control,
    mode: "query",
    emptyAs: "quiet",
    requirement,
    sql: `/* display-result:${key} */\n${body.trim()}`,
  });
}

const SOFT_PULL_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE p.id IS NULL
         OR p.client_id IS DISTINCT FROM m.client_id
         OR p.purpose IS DISTINCT FROM 'diagnostic'
         OR p.amount_cents IS DISTINCT FROM ${softPullCents}
         OR m.channel IS DISTINCT FROM 'email'
         OR m.direction IS DISTINCT FROM 'outbound'
         OR NULLIF(BTRIM(COALESCE(m.to_address, '')), '') IS NULL
         OR (NULLIF(BTRIM(COALESCE(c.phone, '')), '') IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM messages s
                WHERE s.org_id = m.org_id AND s.channel = 'sms'
                  AND s.provider_ref = 'staff:soft-pull-sms:' || p.id::text)))::int AS bad_count
  FROM messages m
  LEFT JOIN payment_links p ON p.org_id = m.org_id AND ('staff:soft-pull-send:' || p.id::text) = m.provider_ref
  LEFT JOIN clients c ON c.org_id = m.org_id AND c.id = m.client_id
 WHERE m.org_id = $1::uuid AND m.provider_ref LIKE 'staff:soft-pull-send:%'
   AND m.created_at >= now() - interval '60 days'`;

const SALE_MOTION_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE p.id IS NULL
         OR p.client_id IS DISTINCT FROM m.client_id
         OR (COALESCE(p.description, '') IN (${primaryNames.map(sqlText).join(", ")}) AND p.sale_motion IS NOT NULL)
         OR (COALESCE(p.description, '') NOT IN (${primaryNames.map(sqlText).join(", ")})
             AND COALESCE(p.sale_motion, '') NOT IN ('downsell', 'upsell')))::int AS bad_count
  FROM messages m
  LEFT JOIN payment_links p ON p.org_id = m.org_id AND ('staff:pay-link-send:' || p.id::text) = m.provider_ref
 WHERE m.org_id = $1::uuid AND m.provider_ref LIKE 'staff:pay-link-send:%'
   AND m.created_at >= now() - interval '60 days'`;

const REPAIR_PAID_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.amount_paid IS NULL OR r.price_total IS NULL
         OR r.amount_paid < 0 OR r.price_total < 0
         OR r.amount_paid > r.price_total
         OR (r.program = 'trial' AND r.rounds_cap IS DISTINCT FROM 2)
         OR (r.program = 'full' AND r.rounds_cap IS DISTINCT FROM 6))::int AS bad_count
  FROM repair_programs r
  JOIN clients c ON c.org_id = r.org_id AND c.id = r.client_id
 WHERE r.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false`;

const INVOICE_BACKLOG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (i.emailed_at IS NOT NULL AND (me.id IS NULL
            OR me.client_id IS DISTINCT FROM i.client_id
            OR me.channel IS DISTINCT FROM 'email'
            OR me.direction IS DISTINCT FROM 'outbound'
            OR NULLIF(BTRIM(COALESCE(me.to_address, '')), '') IS NULL))
         OR (i.emailed_at IS NULL AND ms.id IS NOT NULL))::int AS bad_count
  FROM invoices i
  LEFT JOIN messages me ON me.org_id = i.org_id AND me.id = i.email_message_id
  LEFT JOIN messages ms ON ms.org_id = i.org_id AND ms.provider_ref = 'invoice:' || i.id::text || ':sent'
 WHERE i.org_id = $1::uuid AND COALESCE(i.is_demo, false) = false
   AND (i.emailed_at IS NOT NULL OR ms.id IS NOT NULL)
   AND COALESCE(i.emailed_at, ms.created_at) >= now() - interval '60 days'`;

const FUNDED_COLUMN_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM funding_rounds fr
              WHERE fr.org_id = cd.org_id AND fr.client_id = cd.client_id
                AND fr.status IN ('funded', 'closed') AND fr.funded_amount > 0)
         OR NOT EXISTS (
             SELECT 1 FROM events e
              WHERE e.org_id = cd.org_id AND e.client_id = cd.client_id AND e.name = 'round.funded'))::int AS bad_count
  FROM cards cd
  JOIN pipelines p ON p.org_id = cd.org_id AND p.id = cd.pipeline_id AND p.key = 'funding_card_stacking'
  JOIN pipeline_stages ps ON ps.org_id = cd.org_id AND ps.id = cd.stage_id AND ps.key = 'funded'
 WHERE cd.org_id = $1::uuid AND COALESCE(cd.is_demo, false) = false
   AND cd.entered_at >= now() - interval '60 days'`;

const SOFT_PULL_APPROVE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.id IS NULL
         OR a.client_id IS DISTINCT FROM k.client_id
         OR a.kind IS DISTINCT FROM 'client'
         OR NULLIF(BTRIM(COALESCE(k.consent_text, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(k.consent_version, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(k.granted_name, '')), '') IS NULL
         OR NOT EXISTS (
              SELECT 1 FROM pii_identity pi
               WHERE pi.org_id = k.org_id AND pi.client_id = k.client_id
                 AND pi.ssn_enc IS NOT NULL AND pi.dob IS NOT NULL)
         OR NOT EXISTS (
              SELECT 1 FROM payment_links pl
               WHERE pl.org_id = k.org_id AND pl.client_id = k.client_id
                 AND pl.purpose = 'diagnostic' AND pl.status IN ('created', 'sent', 'paid'))
         OR EXISTS (
              SELECT 1 FROM payment_links pl
               WHERE pl.org_id = k.org_id AND pl.client_id = k.client_id
                 AND pl.purpose = 'diagnostic' AND pl.status IN ('created', 'sent')
                 AND pl.amount_cents IS DISTINCT FROM ${softPullCents} + 1000 * (
                       SELECT count(*) FROM businesses b
                        WHERE b.org_id = k.org_id AND b.client_id = k.client_id
                          AND b.entity_data->>'source' = 'soft_pull_approve'))
         OR NOT EXISTS (
              SELECT 1 FROM account_magic_links ml
               WHERE ml.org_id = k.org_id AND ml.client_id = k.client_id AND ml.outcome = 'issued'))::int AS bad_count
  FROM client_consents k
  JOIN clients c ON c.org_id = k.org_id AND c.id = k.client_id
  LEFT JOIN accounts a ON a.org_id = k.org_id AND a.id = k.granted_by_account_id
 WHERE k.org_id = $1::uuid AND k.kind = 'soft_pull_consent'
   AND k.granted_by_kind = 'client' AND k.capture_method = 'typed'
   AND k.revoked_at IS NULL AND COALESCE(c.is_demo, false) = false
   AND k.granted_at >= now() - interval '60 days'`;

export const FIN_B02_RESULT_CONTRACTS = Object.freeze([
  contract(
    "'Send soft pull ($32 + approval form)': mints the $32 pay link, emails and texts the approval form",
    "Every soft-pull send email must point to one diagnostic pay link of the catalog price for the same client, carry an address, and have its text on file when the client has a phone.",
    "deck-soft-pull-send",
    SOFT_PULL_SEND_SQL,
  ),
  contract(
    "S-23 'Sale motion' select (Downsell / Upsell), shown for non-primary offers",
    "Every pay link sent from the deck must carry no sale motion for the four primary offers, and a downsell or upsell for every other offer.",
    "deck-sale-motion",
    SALE_MOTION_SQL,
  ),
  contract(
    "Repair offers: 'Amount paid today' box (price_total and amount_paid on the repair program)",
    "Every repair program must keep an amount paid that is never negative and never above its price, and a round cap that matches its program.",
    "repair-amount-paid",
    REPAIR_PAID_SQL,
  ),
  contract(
    "email_invoice_backlog (server): emails every invoice the client was never told about, bounded to 200",
    "Every invoice stamped as emailed must link its own email message for the same client and an address, and no invoice may have its email on file while it still reads never emailed.",
    "invoice-backlog-email",
    INVOICE_BACKLOG_SQL,
  ),
  contract(
    "Funding: Card Stacking column 'Funded' (funded): shows count and funding est.; accepts a dropped card",
    "Every card sitting in the Funded column must have a funded round with a positive funded amount and the round.funded receipt.",
    "card-stacking-funded-column",
    FUNDED_COLUMN_SQL,
  ),
  contract(
    "'I agree - submit soft-pull approval': saves consent, SSN and DOB, businesses, a portal account and sign-in email, and mints the exact-total checkout",
    "Every typed client soft-pull consent must have a named client account, the identity on file, an open or paid diagnostic pay link at the exact total for the saved businesses, and an issued sign-in link.",
    "soft-pull-approve-submit",
    SOFT_PULL_APPROVE_SQL,
  ),
]);

/** The exact map rows (desks file, surface) each live check is attached to. */
export const FIN_B02_LIVE_ROWS = Object.freeze([
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[0].control],
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[1].control],
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[2].control],
  // Already a deep case in display-batch-staff-ui.mjs (STAFF_UI_GROUPS), so it is not repeated in
  // FIN_B02_LIVE_CASES below; the contract alone is what turns it from not proved to a live check.
  ["desks-e.json", "public/app/ops-admin.html", FIN_B02_RESULT_CONTRACTS[3].control],
  ["desks-e.json", "public/app/pipeline.html", FIN_B02_RESULT_CONTRACTS[4].control],
  ["desks-f.json", "soft-pull-approve.html", FIN_B02_RESULT_CONTRACTS[5].control],
  // Reuses the existing do-task SQL (one entry in display-saved-result.mjs, same key and text).
  ["desks-d.json", "public/app/money-next.html", "Do task (per step the money helper or a person can do)"],
]);

function liveCase([sourceFile, surface, control], tests) {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: `${tests.join("; ")}; ${FIN_B02_LANE}`,
    tests: Object.freeze([...tests]),
  });
}

const ALREADY_IN_STAFF_GROUPS = new Set([FIN_B02_RESULT_CONTRACTS[3].control]);

// A live check judges the saved result. Where the row also names a screen half, the practice
// test that presses it is listed beside the live check, so the focused proof run executes both.
const SCREEN_HALF = new Map([
  [FIN_B02_RESULT_CONTRACTS[0].control, FIN_B02_PRESENT_TEST],
  [FIN_B02_RESULT_CONTRACTS[1].control, FIN_B02_PRESENT_TEST],
  [FIN_B02_RESULT_CONTRACTS[4].control, FIN_B02_FUNDED_TEST],
  // The page half: s4-soft-pull-approve.test.mjs fills the form, presses the submit button and holds
  // the exact request and the "Consent saved" / "Pay $42 assessment" result screen.
  [FIN_B02_RESULT_CONTRACTS[5].control, "src/pulse/catalog/proofs/s4-soft-pull-approve.test.mjs"],
]);

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B02_LIVE_CASES = Object.freeze(
  FIN_B02_LIVE_ROWS
    .filter(([, , control]) => !ALREADY_IN_STAFF_GROUPS.has(control))
    .map((row) => liveCase(row, [FIN_B02_LIVE_TEST, ...(SCREEN_HALF.has(row[2]) ? [SCREEN_HALF.get(row[2])] : [])])),
);

function practiceCase(sourceFile, surface, control, test) {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: test,
    tests: Object.freeze([test]),
  });
}

const PRESENT = "present.html (+ present.js, contract-send.js)";

/** Rows proved by a practice test that runs the real page script with fake answers. */
export const FIN_B02_PRACTICE_CASES = Object.freeze([
  practiceCase("desks-f.json", PRESENT, "'UnderwriteIQ package -> repair + funding' bridge button (S-19, repair route)", FIN_B02_PRESENT_TEST),
  practiceCase("desks-f.json", PRESENT, "Descent ladder, 6 buttons (Funding, Repair DFY, Repair trial, DIY letters, Funding Mastery, Education deliverables)", FIN_B02_PRESENT_TEST),
  practiceCase("desks-f.json", PRESENT, "Route the call (S-07): FULL FUNDING / FUNDING PLUS REPAIR / REPAIR ONLY buttons", FIN_B02_PRESENT_TEST),
  practiceCase(
    "desks-f.json",
    "sales-floor.html (+ sales-floor.js)",
    "Page open: the whole floor (hero, funnel, roster, offer stack, beliefs, sources, recordings, cold deals, discipline). The read also attaches loose Drive recordings to calls and clients (a write on a GET)",
    FIN_B02_FLOOR_TEST,
  ),
  practiceCase(
    "desks-e.json",
    "public/app/money-transfers.html",
    "Open the page (client signed in, or staff with ?client_id=); 401 sends to /portal-login.html or /login.html?next=",
    FIN_B02_TRANSFERS_TEST,
  ),
]);

export const FIN_B02_DISPLAY_CASES = Object.freeze([...FIN_B02_LIVE_CASES, ...FIN_B02_PRACTICE_CASES]);
