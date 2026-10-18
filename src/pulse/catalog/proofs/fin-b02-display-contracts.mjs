// Finish-853 batch 02: live saved-result checks for display controls that already leave a
// durable result. Each contract is one read-only SQL text. It takes the company as $1::uuid
// and returns sample_count (how many saved results exist) and bad_count (how many are wrong).
//
// Every contract is `emptyAs: "quiet"`: a control nobody has used in the window has nothing
// to judge, so it is green with the words "no saved results yet" and goes red on the first
// wrong one. The window (60 days) keeps old imported rows from turning a live check red.
//
// The SQL is written in the common subset of Postgres and SQLite on purpose (no regexes, no
// intervals other than `now() - interval 'N days'` and `table.column +/- interval 'N day'`, no
// arrays), so fin-b02-live-contracts.test.mjs
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
export const FIN_B02_HERO_TEST = "src/pulse/catalog/proofs/fin-b02-hero-bar.test.mjs";
export const FIN_B02_HERO_LIVE_TEST = "src/pulse/catalog/proofs/fin-b02-hero-live.test.mjs";
export const FIN_B02_DO_TASK_TEST = "src/pulse/catalog/proofs/fin-b02-do-task.test.mjs";
export const FIN_B02_INVOICE_TEST = "src/pulse/catalog/proofs/fin-b02-invoice-backlog.test.mjs";
// Page and handler halves that already existed and are now attached to the rows that name them.
export const S4_PRESENT_DECK_TEST = "src/pulse/catalog/proofs/s4-present-deck.test.mjs";
export const S4_SOFT_PULL_APPROVE_TEST = "src/pulse/catalog/proofs/s4-soft-pull-approve.test.mjs";
export const MONEY_NEXT_SCREEN_TEST = "src/http/money-next-screen.test.mjs";
export const MONEY_TASKS_TEST = "src/finance/money-tasks.test.mjs";
export const MONEY_TASKS_ROUTE_TEST = "src/http/money-tasks.test.mjs";
export const OUTBOUND_ROUTE_TEST = "src/http/s2-message-routes-outbound.test.mjs";
export const STAFF_UI_RUNNER_TEST = "src/pulse/catalog/proofs/display-batch-staff-ui.test.mjs";

/** The four offers the deck sells without a sale motion (src/sales/closer-deck.mjs sendDeckPayLink). */
export const PRIMARY_PAY_OFFER_KEYS = Object.freeze(["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]);

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;
const softPullCents = getOffer("SOFT_PULL").priceCents;
const repairTrialCents = getOffer("REPAIR_TRIAL").priceCents;
const repairFullCents = getOffer("REPAIR_DFY").priceCents;
// src/invoices/notify.mjs INVOICE_TEMPLATE_KEY. The live-contracts test pins that they agree.
const INVOICE_TEMPLATE_KEY = "INVOICE-SENT-EMAIL";
// src/auth/magic-link.mjs MAGIC_LINK_TEMPLATE_KEY. The live-contracts test pins that they agree.
const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";
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

// Every soft-pull send the closer deck wrote (the email, by its provider_ref) must have gone out
// whole: its own $32 diagnostic link for the same client, an address, an email that did not fail
// or get blocked, a body that carries the signed approval form for THIS client and the pay link's
// own checkout address, and (when the client has a phone) its text. The second half runs the other
// way: a client the deck stamped as sent (closer_deck_soft_pull_link_id) whose email row is gone.
const SOFT_PULL_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.bad)::int AS bad_count
  FROM (
    SELECT (p.id IS NULL
         OR p.client_id IS DISTINCT FROM m.client_id
         OR p.purpose IS DISTINCT FROM 'diagnostic'
         OR p.amount_cents IS DISTINCT FROM ${softPullCents}
         OR m.channel IS DISTINCT FROM 'email'
         OR m.direction IS DISTINCT FROM 'outbound'
         OR NULLIF(BTRIM(COALESCE(m.to_address, '')), '') IS NULL
         OR COALESCE(m.status, '') IN ('failed', 'blocked')
         OR m.rendered_body IS NULL
         OR m.rendered_body NOT LIKE '%/app/soft-pull-approve.html?%'
         OR m.rendered_body NOT LIKE '%client=' || m.client_id::text || '%'
         OR p.checkout_url IS NULL
         OR m.rendered_body NOT LIKE '%' || p.checkout_url || '%'
         OR (NULLIF(BTRIM(COALESCE(c.phone, '')), '') IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM messages x
                WHERE x.org_id = m.org_id AND x.channel = 'sms'
                  AND x.provider_ref = 'staff:soft-pull-sms:' || p.id::text))) AS bad
      FROM messages m
      LEFT JOIN payment_links p ON p.org_id = m.org_id AND ('staff:soft-pull-send:' || p.id::text) = m.provider_ref
      LEFT JOIN clients c ON c.org_id = m.org_id AND c.id = m.client_id
     WHERE m.org_id = $1::uuid AND m.provider_ref LIKE 'staff:soft-pull-send:%'
       AND m.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT true AS bad
      FROM clients k
     WHERE k.org_id = $1::uuid AND COALESCE(k.is_demo, false) = false
       AND NULLIF(k.custom_fields->>'closer_deck_soft_pull_link_id', '') IS NOT NULL
       AND (k.custom_fields->>'closer_deck_soft_pull_sent_at')::timestamptz >= now() - interval '60 days'
       AND NOT EXISTS (
             SELECT 1 FROM messages x
              WHERE x.org_id = k.org_id
                AND x.provider_ref = 'staff:soft-pull-send:' || (k.custom_fields->>'closer_deck_soft_pull_link_id'))
  ) s`;

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

// A repair program row must keep what the box and the sale say. Old rows (imports, the first trials)
// are judged only on the bounds and the round cap. A program made in the last 60 days is also judged
// on money: the price is the catalog price or what this client's own repair sale agreed to; the
// amount paid never exceeds the money on file (a paid repair pay link, or the payments of a repair
// sale); and a client who had paid the whole price before the program was made is not saved as $0.
const REPAIR_PAID_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.amount_paid IS NULL OR r.price_total IS NULL
         OR r.amount_paid < 0 OR r.price_total < 0
         OR r.amount_paid > r.price_total
         OR (r.program = 'trial' AND r.rounds_cap IS DISTINCT FROM 2)
         OR (r.program = 'full' AND r.rounds_cap IS DISTINCT FROM 6)
         OR ((r.created_at IS NULL OR r.created_at >= now() - interval '60 days') AND (
              (ROUND(r.price_total * 100) IS DISTINCT FROM (CASE WHEN r.program = 'trial' THEN ${repairTrialCents} ELSE ${repairFullCents} END)
               AND NOT EXISTS (
                 SELECT 1 FROM sales s
                   JOIN products pr ON pr.org_id = s.org_id AND pr.id = s.product_id
                  WHERE s.org_id = r.org_id AND s.client_id = r.client_id AND pr.category = 'repair'
                    AND ROUND(s.agreed_price * 100) = ROUND(r.price_total * 100)))
              OR (ROUND(r.amount_paid * 100) > COALESCE(pl.cents, 0)
                  AND ROUND(r.amount_paid * 100) > COALESCE(sp.cents, 0))
              OR (r.amount_paid = 0 AND ROUND(r.price_total * 100) > 0 AND (
                    (SELECT COALESCE(SUM(COALESCE(x.paid_amount_cents, x.amount_cents, 0)), 0)
                       FROM payment_links x
                      WHERE x.org_id = r.org_id AND x.client_id = r.client_id AND x.purpose = 'repair'
                        AND x.status = 'paid' AND (x.paid_at IS NULL OR x.paid_at <= r.created_at + interval '1 day')) >= ROUND(r.price_total * 100)
                    OR (SELECT COALESCE(SUM(ROUND(y.amount * 100)), 0)
                          FROM sale_payments y
                          JOIN sales s2 ON s2.org_id = y.org_id AND s2.id = y.sale_id
                          JOIN products p2 ON p2.org_id = s2.org_id AND p2.id = s2.product_id AND p2.category = 'repair'
                         WHERE y.org_id = r.org_id AND s2.client_id = r.client_id
                           AND (y.paid_at IS NULL OR y.paid_at <= r.created_at + interval '1 day')) >= ROUND(r.price_total * 100)))
         )))::int AS bad_count
  FROM repair_programs r
  JOIN clients c ON c.org_id = r.org_id AND c.id = r.client_id
  LEFT JOIN (
    SELECT org_id, client_id, SUM(COALESCE(paid_amount_cents, amount_cents, 0)) AS cents
      FROM payment_links
     WHERE purpose = 'repair' AND status = 'paid'
     GROUP BY org_id, client_id) pl ON pl.org_id = r.org_id AND pl.client_id = r.client_id
  LEFT JOIN (
    SELECT s3.org_id AS org_id, s3.client_id AS client_id, SUM(ROUND(z.amount * 100)) AS cents
      FROM sale_payments z
      JOIN sales s3 ON s3.org_id = z.org_id AND s3.id = z.sale_id
      JOIN products p3 ON p3.org_id = s3.org_id AND p3.id = s3.product_id AND p3.category = 'repair'
     GROUP BY s3.org_id, s3.client_id) sp ON sp.org_id = r.org_id AND sp.client_id = r.client_id
 WHERE r.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false`;

const INVOICE_BACKLOG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (i.emailed_at IS NOT NULL AND (me.id IS NULL
            OR me.client_id IS DISTINCT FROM i.client_id
            OR me.channel IS DISTINCT FROM 'email'
            OR me.direction IS DISTINCT FROM 'outbound'
            OR NULLIF(BTRIM(COALESCE(me.to_address, '')), '') IS NULL
            OR COALESCE(me.status, '') IN ('failed', 'blocked')
            OR me.template_key IS DISTINCT FROM '${INVOICE_TEMPLATE_KEY}'
            OR COALESCE(me.provider_ref, '') NOT LIKE 'invoice:' || i.id::text || ':%'))
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
                JOIN messages mm ON mm.org_id = ml.org_id
                 AND mm.provider_ref = 'workflow:${MAGIC_LINK_TEMPLATE_KEY}:magic-link:' || ml.id::text
               WHERE ml.org_id = k.org_id AND ml.client_id = k.client_id AND ml.outcome = 'issued'
                 AND ml.created_at >= k.granted_at - interval '1 day'
                 AND ml.created_at <= k.granted_at + interval '1 day'
                 AND mm.client_id = k.client_id AND mm.channel = 'email' AND mm.direction = 'outbound'
                 AND COALESCE(mm.status, '') NOT IN ('failed', 'blocked')))::int AS bad_count
  FROM client_consents k
  JOIN clients c ON c.org_id = k.org_id AND c.id = k.client_id
  LEFT JOIN accounts a ON a.org_id = k.org_id AND a.id = k.granted_by_account_id
 WHERE k.org_id = $1::uuid AND k.kind = 'soft_pull_consent'
   AND k.granted_by_kind = 'client' AND k.capture_method = 'typed'
   AND k.revoked_at IS NULL AND COALESCE(c.is_demo, false) = false
   AND k.granted_at >= now() - interval '60 days'`;


// The hero's "Today" deposits and its "Funded, not just sold" rate both count call_outcomes rows with
// outcome 'deposit' (src/sales/metrics.mjs floorFunnelDay and depositToFunded). Each one must be a deposit
// somebody really paid: cash copied from one paid transaction of the same client, that payment used by
// one deposit only, and, when the client has a funded round, a funded flag the rate can count.
// A deposit with no linked payment has no transaction row, so it reads as another client's payment, not
// paid, and an amount of 0 against positive cash. Those legs are what catch it.
const HERO_DEPOSITS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE o.cash_collected_cents IS NULL OR o.cash_collected_cents <= 0
         OR t.client_id IS DISTINCT FROM o.client_id
         OR COALESCE(t.status, '') NOT IN ('paid', 'succeeded', 'complete', 'completed')
         OR ROUND(COALESCE(t.amount_paid, 0) * 100) IS DISTINCT FROM o.cash_collected_cents
         OR EXISTS (
              SELECT 1 FROM call_outcomes d
               WHERE d.org_id = o.org_id AND d.id <> o.id AND d.transaction_id = o.transaction_id)
         OR (COALESCE(c.funded, false) = false
             AND EXISTS (
                  SELECT 1 FROM funding_rounds fr
                   WHERE fr.org_id = o.org_id AND fr.client_id = o.client_id AND fr.status = 'funded')
             AND NOT EXISTS (
                  SELECT 1 FROM funding_rounds fr
                    JOIN funding_closeout fc ON fc.org_id = fr.org_id AND fc.funding_round_id = fr.id
                   WHERE fr.org_id = o.org_id AND fr.client_id = o.client_id))
         OR (COALESCE(c.funded, false) = true
             AND NOT EXISTS (
                  SELECT 1 FROM funding_rounds fr
                   WHERE fr.org_id = o.org_id AND fr.client_id = o.client_id AND fr.status IN ('funded', 'closed'))
             AND NOT EXISTS (
                  SELECT 1 FROM funding_rounds fr
                    JOIN funding_closeout fc ON fc.org_id = fr.org_id AND fc.funding_round_id = fr.id
                   WHERE fr.org_id = o.org_id AND fr.client_id = o.client_id)))::int AS bad_count
  FROM call_outcomes o
  JOIN clients c ON c.org_id = o.org_id AND c.id = o.client_id
  LEFT JOIN transactions t ON t.org_id = o.org_id AND t.id = o.transaction_id
 WHERE o.org_id = $1::uuid AND o.outcome = 'deposit'
   AND COALESCE(o.is_demo, false) = false AND COALESCE(c.is_demo, false) = false
   AND o.logged_at >= now() - interval '60 days'`;

// "Do task" hands one money step to the money helper or to a person (src/finance/money-tasks.mjs
// doTask). The log row it writes names the task row; the task row must say the same task key and
// assignee; a step handed to a person must have opened its CSM task (staff_task_id, source
// money-task, role csm, same client) and the log must point at that task; a step that moves money
// must carry the same amount on the row and on the log. All of it is judged for every press ever
// made, since the control is new and a wrong one is wrong at any age.
const DO_TASK_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE t.id IS NULL OR l.client_id IS DISTINCT FROM t.client_id
         OR l.item_id IS DISTINCT FROM t.id
         OR l.idempotency_key IS DISTINCT FROM 'money-task:' || t.id::text || ':assigned'
         OR l.detail->>'task_key' IS NULL OR l.detail->>'assignee' IS NULL
         OR t.task_key IS DISTINCT FROM l.detail->>'task_key'
         OR t.assignee IS DISTINCT FROM l.detail->>'assignee'
         OR (t.assignee = 'person' AND (l.task_id IS DISTINCT FROM t.staff_task_id
              OR NOT EXISTS (
                   SELECT 1 FROM tasks k
                    WHERE k.org_id = t.org_id AND k.id = t.staff_task_id AND k.client_id = t.client_id
                      AND k.source_workflow = 'money-task' AND k.assignee_role = 'csm')))
         OR (t.moves_money = true AND (t.amount_cents IS NULL OR l.amount_cents IS DISTINCT FROM t.amount_cents)))::int AS bad_count
  FROM money_agent_log l
  LEFT JOIN money_agent_tasks t ON t.org_id = l.org_id AND t.id = l.item_id
 WHERE l.org_id = $1::uuid AND l.action = 'task_assigned'`;

const HERO_CONTROL = "Hero: 'Today' deposits, booked and held, 'Funded, not just sold' rate and target bar";
const HERO_REQUIREMENT =
  "Every deposit call the hero counts must have cash copied from one paid payment of the same client that no other deposit uses, " +
  "the funded flag must agree with the funded rounds in both directions, and the screen test must show today's deposits against " +
  "the saved daily team target without letting the bar exceed 100%.";

export const FIN_B02_RESULT_CONTRACTS = Object.freeze([
  contract(
    "'Send soft pull ($32 + approval form)': mints the $32 pay link, emails and texts the approval form",
    "Every soft-pull send email must point to one diagnostic pay link of the catalog price for the same client, carry an address, not be failed or blocked, carry the signed approval form for that client and the pay link's own checkout address, and have its text on file when the client has a phone; a client the deck stamped as sent must still have its email row.",
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
    "Every repair program must keep an amount paid that is never negative and never above its price, and a round cap that matches its program; one made in the last 60 days must also carry the catalog price (or its own repair sale's agreed price), must not show more paid than the money on file, and must not show $0 when the whole price was paid before it was made.",
    "repair-amount-paid",
    REPAIR_PAID_SQL,
  ),
  contract(
    "email_invoice_backlog (server): emails every invoice the client was never told about, bounded to 200",
    "Every invoice stamped as emailed must link its own invoice email (the invoice template, this invoice's own reference) for the same client and an address, that message must not have failed or been blocked, and no invoice may have its email on file while it still reads never emailed.",
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
    "Every typed client soft-pull consent must have a named client account, words, version and name, the identity on file, an open or paid diagnostic pay link at the exact total for the saved businesses, and an issued sign-in link whose own email went to that client and did not fail or get blocked.",
    "soft-pull-approve-submit",
    SOFT_PULL_APPROVE_SQL,
  ),
  contract(
    "Do task (per step the money helper or a person can do)",
    "Every task-assigned log must link the exact money task, client, task key and assignee, hand a person's step to a real CSM task of the same client that the log points at, and carry the same amount as a step that moves money.",
    "do-task-person-leg",
    DO_TASK_SQL,
  ),
  contract(
    HERO_CONTROL,
    HERO_REQUIREMENT,
    "sales-floor-hero-deposits",
    HERO_DEPOSITS_SQL,
  ),
]);

/** The hero's live saved-result contract, also imported directly by its focused SQL tests. */
export const FIN_B02_HERO_READY_CONTRACT = FIN_B02_RESULT_CONTRACTS[7];

/** The exact map rows (desks file, surface) each live check is attached to. */
export const FIN_B02_LIVE_ROWS = Object.freeze([
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[0].control],
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[1].control],
  ["desks-f.json", "present.html (+ present.js, contract-send.js)", FIN_B02_RESULT_CONTRACTS[2].control],
  // Also a deep case in display-batch-staff-ui.mjs (STAFF_UI_GROUPS), so it is not repeated in
  // FIN_B02_LIVE_CASES below (a second copy would be a second result case for one row); its tests are
  // widened by FIN_B02_TEST_OVERRIDES instead.
  ["desks-e.json", "public/app/ops-admin.html", FIN_B02_RESULT_CONTRACTS[3].control],
  ["desks-e.json", "public/app/pipeline.html", FIN_B02_RESULT_CONTRACTS[4].control],
  ["desks-f.json", "soft-pull-approve.html", FIN_B02_RESULT_CONTRACTS[5].control],
  // Repair cycle 1: its own SQL now (the person leg), no longer the shared do-task text.
  ["desks-d.json", "public/app/money-next.html", FIN_B02_RESULT_CONTRACTS[6].control],
]);

/** The hero row. Its live contract and browser test are joined by this exact display case. */
export const FIN_B02_HERO_ROW = Object.freeze(["desks-f.json", "sales-floor.html (+ sales-floor.js)", HERO_CONTROL]);

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

// A live check judges the saved result. The practice tests that press the control, or run the handler
// it calls, are listed beside it so the focused proof run executes them too.
const SCREEN_HALF = new Map([
  [FIN_B02_RESULT_CONTRACTS[0].control, [FIN_B02_PRESENT_TEST]],
  [FIN_B02_RESULT_CONTRACTS[1].control, [FIN_B02_PRESENT_TEST]],
  // The box itself: fin-b02-present-buttons.test.mjs presses the repair button with each typed
  // number (vm, no browser); s4-present-deck.test.mjs types 500 into the real box in Chromium.
  [FIN_B02_RESULT_CONTRACTS[2].control, [FIN_B02_PRESENT_TEST, S4_PRESENT_DECK_TEST]],
  [FIN_B02_RESULT_CONTRACTS[4].control, [FIN_B02_FUNDED_TEST]],
  // The page half: s4-soft-pull-approve.test.mjs fills the form, presses the submit button and holds
  // the exact request and the "Consent saved" / "Pay $42 assessment" result screen.
  [FIN_B02_RESULT_CONTRACTS[5].control, [S4_SOFT_PULL_APPROVE_TEST]],
  // The press (money-next-screen), the route it posts to (money-tasks route test), and the person leg
  // of doTask itself (money-tasks: one CSM task opened, linked to the row and to the log).
  // fin-b02-do-task.test.mjs runs the real doTask and judges what it saved with the live SQL itself.
  [FIN_B02_RESULT_CONTRACTS[6].control, [MONEY_NEXT_SCREEN_TEST, MONEY_TASKS_ROUTE_TEST, MONEY_TASKS_TEST, FIN_B02_DO_TASK_TEST]],
]);

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B02_LIVE_CASES = Object.freeze([
  ...FIN_B02_LIVE_ROWS
    .filter(([, , control]) => !ALREADY_IN_STAFF_GROUPS.has(control))
    .map((row) => liveCase(row, [FIN_B02_LIVE_TEST, ...(SCREEN_HALF.get(row[2]) || [])])),
  // The hero's live deposit check and its screen half run together for the exact row.
  liveCase(FIN_B02_HERO_ROW, [FIN_B02_HERO_TEST, FIN_B02_HERO_LIVE_TEST]),
]);

/**
 * A row that already has a case in display-batch-staff-ui.mjs, given the tests that really run what
 * it names. A later case for the same key replaces the earlier one in DISPLAY_PROOF_CASES, so the
 * staff runner and its spec are repeated here and nothing is lost.
 *
 * ops-admin "email_invoice_backlog (server)": the handler is run by the route test against a
 * stand-in queue (the backlog is read, every invoice is emailed once, the bound is 200).
 */
export const FIN_B02_TEST_OVERRIDES = Object.freeze([
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/ops-admin.html",
    control: FIN_B02_RESULT_CONTRACTS[3].control,
    depth: "deep",
    evidence: `${STAFF_UI_RUNNER_TEST} (runs e2e/ops-admin-outbound.spec.mjs); ${OUTBOUND_ROUTE_TEST}; ${FIN_B02_INVOICE_TEST}; ${FIN_B02_LIVE_TEST}; ${FIN_B02_LANE}`,
    tests: Object.freeze([STAFF_UI_RUNNER_TEST, OUTBOUND_ROUTE_TEST, FIN_B02_INVOICE_TEST, FIN_B02_LIVE_TEST]),
  }),
]);

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

export const FIN_B02_DISPLAY_CASES = Object.freeze([
  ...FIN_B02_LIVE_CASES,
  ...FIN_B02_TEST_OVERRIDES,
  ...FIN_B02_PRACTICE_CASES,
]);
