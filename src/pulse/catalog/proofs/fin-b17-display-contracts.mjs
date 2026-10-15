// Finish-853 batch 17 (tier 4, lane gap-catalog-display): the live checks for four controls whose saved
// result can be read.
//
//   staff chat       "Message > Staff (internal): pick a teammate and send"   the saved internal message
//   Present deck     "Section 06 FinanceOS demo links"                        the sample client the links open
//   Present deck     "Soft pull panel: consent / paid / pull-status lines"    the rows behind the three lines
//   money page       "Connection status lines"                                the saved connection row
//
// Each is one read-only SQL text the display lane runs for the company. It takes $1::uuid (the company)
// and returns sample_count (how many saved results exist) and bad_count (how many are wrong). The three
// that wait on a person's first use are `emptyAs: "quiet"`: green with the words "no saved results yet",
// red on the first wrong one. The demo client check is NOT quiet: the sample client must exist, so a
// missing one is red.
//
// Every check is built from NAMED bad-result conditions joined with OR. fin-b17-live-contracts.test.mjs
// runs the exact text over stand-in rows (real column names from db/migrations), then drops each named
// condition from the text and shows the row it guards is no longer caught.
//
// This file imports nothing. scripts/pulse/compile-catalog.mjs reads it at build time; the live bundle
// reads the compiled copy in src/pulse/catalog/generated.json. It must not import display-saved-result.mjs
// (that file imports this one).

export const FIN_B17_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B17_LIVE_TEST = "src/pulse/catalog/proofs/fin-b17-live-contracts.test.mjs";

/** The one client every Present demo link opens (public/app/present.js FOS_DEMO_CLIENT). */
export const FIN_B17_DEMO_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";

/** `names` kept out of the text, for the test that drops one condition at a time. */
function orJoin(pairs, without, indent = "         ") {
  const kept = pairs.filter(([name]) => !without.includes(name));
  if (!kept.length) return "1 = 0";
  return kept.map(([, expr]) => `(${expr})`).join(`\n${indent}OR `);
}

// ───────────────────── staff chat: an internal message (chat-widget.js, api/chat/messages.mjs) ─────────────────────
//
// "Message > Staff (internal)": pick a teammate and send. src/chat/internal.mjs writes the saved result:
// a conversation of kind 'internal' with no client and a pair key, exactly two people in
// conversation_participants, and a message row that is outbound, on the internal channel, from a staff
// person who is one of the two, with words, no client, and status 'delivered' (it never goes through the
// client compliance gate, so it must never sit queued for the client outbound path).

export const CHAT_BAD = Object.freeze([
  ["an internal message is not an outbound staff message on the internal channel",
    `m.direction <> 'outbound' OR m.channel <> 'internal' OR m.sender_kind IS DISTINCT FROM 'staff'`],
  ["an internal message names no sender",
    `m.sender_staff_id IS NULL`],
  ["an internal message was sent by someone who is not in the conversation",
    `m.sender_staff_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM conversation_participants p
               WHERE p.conversation_id = m.conversation_id AND p.staff_id = m.sender_staff_id)`],
  ["an internal message has no words",
    `NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL`],
  ["an internal message is tied to a client",
    `m.client_id IS NOT NULL`],
  ["an internal message is not marked delivered, so it may be waiting on the client outbound path",
    `m.status IS DISTINCT FROM 'delivered'`],
  ["an internal conversation does not have exactly two people in it",
    `(SELECT count(*) FROM conversation_participants p WHERE p.conversation_id = c.id) <> 2`],
  ["an internal conversation has no pair key, or is tied to a client",
    `NULLIF(BTRIM(COALESCE(c.internal_pair_key, '')), '') IS NULL OR c.client_id IS NOT NULL`],
]);

export function chatInternalSql({ without = [] } = {}) {
  return `/* display-result:fin-b17-chat-internal */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(CHAT_BAD, without)})::int AS bad_count
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND c.kind = 'internal'
   AND COALESCE(m.is_demo, false) = false
   AND COALESCE(c.is_demo, false) = false`;
}

// ───────────────────── Present: the sample client behind the 16 FinanceOS demo links ─────────────────────
//
// public/app/present.js opens /app/financeos.html?client_id=<sample client>#<tab> for sixteen tabs. The page
// behind a link reads this one client's containers, accounts, credit file and tradelines
// (scripts/finance-os-sample-v3.mjs). If the client is gone, or one of those is empty, the rep opens an
// empty or broken page on a live call. The check has one sample (the client, in this company). Not quiet:
// no client is a failure.

export const DEMO_BAD = Object.freeze([
  ["the sample client has no container (personal or business) for FinanceOS to show",
    `NOT EXISTS (SELECT 1 FROM entities e WHERE e.org_id = c.org_id AND e.client_id = c.id AND e.archived_at IS NULL)`],
  ["the sample client has no open bank account for FinanceOS to show",
    `NOT EXISTS (SELECT 1 FROM bank_accounts a WHERE a.org_id = c.org_id AND a.client_id = c.id AND a.closed_at IS NULL)`],
  ["the sample client has no credit file for the Credit tab",
    `NOT EXISTS (SELECT 1 FROM crs_results r WHERE r.org_id = c.org_id AND r.client_id = c.id)`],
  ["the sample client has no tradelines for the Credit tab",
    `NOT EXISTS (SELECT 1 FROM tradelines t WHERE t.org_id = c.org_id AND t.client_id = c.id)`],
]);

export function demoClientSql({ without = [] } = {}) {
  return `/* display-result:fin-b17-demo-client */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(DEMO_BAD, without)})::int AS bad_count
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND c.id = '${FIN_B17_DEMO_CLIENT}'::uuid`;
}

// ───────────────────── Present: the rows behind the soft pull panel's three lines ─────────────────────
//
// The panel (cockpit, phase 03) says consent, paid and pull status from src/sales/closer-deck.mjs
// softPullStatus(): the newest soft_pull_consent, the newest 'diagnostic' payment link, the newest
// soft_pull_requests row and the newest stored credit result. Only conditions a real write can leave behind
// are named here. The database already refuses, by CHECK constraint, a fulfilled request with no stored
// result (soft_pull_requests_result_ck, 077) and a payment link with no amount (payment_links.amount_cents
// is NOT NULL and > 0, 119), so neither is named: a condition that can never be true can never go red.
//
//   a request   that points at a credit result which is another client's or another company's (the foreign
//               key checks the id and nothing else; src/finance/soft-pulls.mjs guards it in code), or that
//               was recorded before any soft pull consent had been granted for the client (the consent
//               line would say "waiting" beside a pull that already happened; requestSoftPull refuses
//               without a valid consent, so this is a write that went round the gate)
//   a link      the panel calls paid (status 'paid' or a paid time) with no paid amount saved, or with a
//               paid amount that is not the amount the panel prints. markPaid writes paid_amount_cents
//               from the event's amount and writes NULL when the event had none.
// Demo and synthetic clients are left out, as src/pulse/coverage/gap-soft-pull.mjs leaves them out. The
// client is joined with LEFT JOIN on its company: a request whose client is not found in this company is
// judged, never silently dropped, and a foreign client's demo flag cannot hide it.

export const PULL_REQUEST_BAD = Object.freeze([
  ["a pull request points at a credit result that is not this client's",
    `r.crs_result_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM crs_results x
               WHERE x.id = r.crs_result_id AND x.org_id = r.org_id AND x.client_id = r.client_id)`],
  ["a pull request was recorded before any soft pull consent was granted for the client",
    `NOT EXISTS (
              SELECT 1 FROM client_consents k
               WHERE k.org_id = r.org_id AND k.client_id = r.client_id
                 AND k.kind = 'soft_pull_consent' AND k.granted_at <= r.requested_at)`],
]);

export const PULL_LINK_BAD = Object.freeze([
  ["the pull's payment link is paid and no paid amount was saved, so the panel prints an amount nothing backs",
    `(l.status = 'paid' OR l.paid_at IS NOT NULL) AND l.paid_amount_cents IS NULL`],
  ["the pull's payment link is paid for an amount that is not the amount the panel prints",
    `(l.status = 'paid' OR l.paid_at IS NOT NULL) AND l.paid_amount_cents IS NOT NULL
             AND l.paid_amount_cents <> l.amount_cents`],
]);

export function softPullPanelSql({ without = [] } = {}) {
  return `/* display-result:fin-b17-soft-pull-panel */
SELECT COALESCE(sum(x.n), 0)::int AS sample_count,
       COALESCE(sum(x.bad), 0)::int AS bad_count
  FROM (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE ${orJoin(PULL_REQUEST_BAD, without, "                 ")}) AS bad
      FROM soft_pull_requests r
      LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
     WHERE r.org_id = $1::uuid
       AND COALESCE(c.is_demo, false) = false
       AND COALESCE(c.custom_fields ->> 'synthetic', '') <> 'true'
    UNION ALL
    SELECT count(*) AS n,
           count(*) FILTER (WHERE ${orJoin(PULL_LINK_BAD, without, "                 ")}) AS bad
      FROM payment_links l
     WHERE l.org_id = $1::uuid
       AND l.purpose = 'diagnostic'
       AND COALESCE(l.is_demo, false) = false
       AND (l.status = 'paid' OR l.paid_at IS NOT NULL)
  ) x`;
}

// ───────────────────── money page: the saved connection row behind each status line ─────────────────────
//
// /app/money-connections.html paints, under each processor: "Last sale or payout: <time> · N events",
// "Last synced: <time>", the last sync error, and "Still reading your history". They come from one
// merchant_connections row and its merchant_events (src/merchant/store.mjs publicConnection). The event
// count is not a saved column: SELECT_CONNECTION counts the connection's events when it reads, so that
// count and the time the page paints from the row are judged by running the real SELECT over stand-in rows
// (fin-b17-money-connections.test.mjs). The sync error is held to 300 characters by a CHECK
// (merchant_connections_sync_error_len, 457), so length is not a condition: it could never be true.

export const CONNECTION_BAD = Object.freeze([
  ["events are saved for the connection and its last sale or payout time is empty",
    `c.last_event_at IS NULL AND EXISTS (SELECT 1 FROM merchant_events e WHERE e.connection_id = c.id)`],
  ["a last sale or payout time is set and no event is saved for the connection",
    `c.last_event_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM merchant_events e WHERE e.connection_id = c.id)`],
  ["the last sale or payout time is older than the newest event saved for the connection",
    `c.last_event_at IS NOT NULL AND c.last_event_at < (SELECT max(e.received_at) FROM merchant_events e WHERE e.connection_id = c.id)`],
  ["a pull connection finished a sync and has no last synced time",
    `c.mode = 'pull' AND c.synced_through IS NOT NULL AND c.last_synced_at IS NULL`],
  ["a turned-off connection still says it is reading, so a next sync is promised that will never run",
    `c.mode = 'pull' AND c.status = 'disabled' AND c.sync_cursor IS NOT NULL`],
  ["a sync error is only spaces, so the page would say the last sync did not finish and give no words",
    `c.last_sync_error IS NOT NULL AND BTRIM(c.last_sync_error) = ''`],
]);

export function connectionLinesSql({ without = [] } = {}) {
  return `/* display-result:fin-b17-connection-lines */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(CONNECTION_BAD, without)})::int AS bad_count
  FROM merchant_connections c
 WHERE c.org_id = $1::uuid`;
}

// ───────────────────── the registry list ─────────────────────

const CHECKS = [
  {
    key: "chat-internal",
    sourceFile: "desks-e.json",
    surface: "public/app/chat-widget.js (mounted by shell.js on the same desks; skipped for partner and affiliate roles)",
    control: "Message > Staff (internal): pick a teammate and send",
    requirement: "Every saved staff-to-staff message must be an outbound internal-channel message from one of the two people in its two-person conversation, with words, no client, and marked delivered.",
    sql: chatInternalSql,
    names: CHAT_BAD.map(([name]) => name),
    quiet: true,
    practice: "src/pulse/catalog/proofs/fin-b17-chat.test.mjs",
  },
  {
    key: "demo-client",
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "Section 06 FinanceOS demo links: 16 tabs open the sample client in a new tab (owner, admin, sales_manager, closer only)",
    requirement: "The sample client the sixteen FinanceOS demo links open must exist in this company, with a container, an open bank account, a credit file and tradelines for the tabs to show.",
    sql: demoClientSql,
    names: DEMO_BAD.map(([name]) => name),
    quiet: false,
    practice: "src/pulse/catalog/proofs/fin-b17-present.test.mjs",
  },
  {
    key: "soft-pull-panel",
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "Soft pull panel: consent / paid / pull-status lines (display)",
    requirement: "Every soft pull request must point only at a credit result that is its own client's and must have a soft pull consent granted before it, and every diagnostic payment link the panel calls paid must carry a paid amount equal to the amount the panel prints.",
    sql: softPullPanelSql,
    names: [...PULL_REQUEST_BAD, ...PULL_LINK_BAD].map(([name]) => name),
    quiet: true,
    practice: "src/pulse/catalog/proofs/fin-b17-present.test.mjs",
    extraTests: ["src/pulse/catalog/proofs/fin-b17-soft-pull-status.test.mjs", "src/sales/closer-deck.test.mjs"],
  },
  {
    key: "connection-lines",
    sourceFile: "desks-d.json",
    surface: "public/app/money-connections.html",
    control: "Connection status lines (last sale or payout, event count, last synced, last sync error, still-reading note)",
    requirement: "Every merchant connection must agree with its saved events about its last sale or payout time (set when events exist, empty when none do, and never older than the newest event), show a last synced time once a sync has finished, keep a still-reading promise only while it can run, and hold a sync error in words.",
    sql: connectionLinesSql,
    names: CONNECTION_BAD.map(([name]) => name),
    quiet: true,
    practice: "src/pulse/catalog/proofs/fin-b17-money-connections.test.mjs",
  },
];

export const FIN_B17_CHECKS = Object.freeze(CHECKS.map((check) => Object.freeze(check)));

/** The contracts the display lane runs, in the registry's own shape. */
export const FIN_B17_RESULT_CONTRACTS = Object.freeze(FIN_B17_CHECKS.map((check) => Object.freeze({
  control: check.control,
  mode: "query",
  ...(check.quiet ? { emptyAs: "quiet" } : {}),
  requirement: check.requirement,
  sql: check.sql(),
})));

/** The exact map rows (desks file, surface, control) each live check is attached to. */
export const FIN_B17_LIVE_ROWS = Object.freeze(FIN_B17_CHECKS.map((check) => Object.freeze([check.sourceFile, check.surface, check.control])));

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B17_LIVE_CASES = Object.freeze(FIN_B17_CHECKS.map((check) => {
  const tests = [FIN_B17_LIVE_TEST, check.practice, ...(check.extraTests || [])];
  return Object.freeze({
    sourceFile: check.sourceFile,
    surface: check.surface,
    control: check.control,
    depth: "deep",
    evidence: `${tests.join("; ")}; ${FIN_B17_LANE}`,
    tests: Object.freeze(tests),
  });
}));
