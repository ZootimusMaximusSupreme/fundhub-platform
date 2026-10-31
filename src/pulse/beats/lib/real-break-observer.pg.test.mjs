// SELECT-only synthetic regressions for two Pulse false-green/false-red risks.
// Fixture tables are CTEs, not production tables. No SMS, calendar, or provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../../../db.mjs";
import { BOOKED_NO_OUTCOME_SQL } from "./calls-truth.mjs";
import { buildJourneyZeroSql, SMS_JOURNEY_STEPS } from "./sms-truth.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT = "44444444-4444-4444-8444-444444444444";
const BOOKING_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BOOKING_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

function literal(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// CTE shadows the real table names for the duration of ONE read-only query.
// Every test sets immutable fake rows, and no database row is inserted.
function bookedFixture({ bStart = "2026-10-29T11:15:00Z", bEnd = "2026-10-29T12:00:00Z",
                         outcomeRef = "provider-b", outcomeAt = "2026-10-29T12:10:00Z",
                         outcomeClient = CLIENT } = {}) {
  const cte = `WITH
    bookings(id, org_id, client_id, status, starts_at, ends_at, provider_uid) AS (
      VALUES
      ('${BOOKING_A}'::uuid, '${ORG}'::uuid, '${CLIENT}'::uuid, 'booked'::text,
       '2026-10-29T10:00:00Z'::timestamptz, '2026-10-29T11:00:00Z'::timestamptz, 'provider-a'::text),
      ('${BOOKING_B}'::uuid, '${ORG}'::uuid, '${CLIENT}'::uuid, 'booked'::text,
       ${literal(bStart)}::timestamptz, ${literal(bEnd)}::timestamptz, 'provider-b'::text)
    ),
    clients(id, org_id, is_demo, custom_fields) AS (
      VALUES ('${CLIENT}'::uuid, '${ORG}'::uuid, false, '{}'::jsonb)
    ),
    call_outcomes(org_id, client_id, booking_ref, logged_at, is_demo) AS (
      VALUES ('${ORG}'::uuid, ${literal(outcomeClient)}::uuid,
              ${outcomeRef === null ? "NULL::text" : literal(outcomeRef) + "::text"},
              ${literal(outcomeAt)}::timestamptz, false)
    )`;
  return cte + "\n" + BOOKED_NO_OUTCOME_SQL;
}

// An incomplete booking identity plus a reused provider UID is ambiguous.
// This uses the actual Postgres SELECT with immutable fake table rows.
function nullClientDuplicateUidFixture({ duplicate = true, exactBookingRef = false } = {}) {
  const aUid = duplicate ? "shared-provider-uid" : "unique-provider-a";
  const bUid = duplicate ? "shared-provider-uid" : "unique-provider-b";
  const outcomeRef = exactBookingRef ? BOOKING_A : aUid;
  // For the ambiguous case the outcome was logged for B; for the unique
  // case only A's unmatched buyer identity is unknown.
  const outcomeClient = duplicate && !exactBookingRef ? CLIENT : OTHER_CLIENT;
  return `WITH
    bookings(id, org_id, client_id, status, starts_at, ends_at, provider_uid) AS (
      VALUES
      ('${BOOKING_A}'::uuid, '${ORG}'::uuid, NULL::uuid, 'booked'::text,
       '2026-10-29T10:00:00Z'::timestamptz, '2026-10-29T11:00:00Z'::timestamptz, ${literal(aUid)}::text),
      ('${BOOKING_B}'::uuid, '${ORG}'::uuid, '${CLIENT}'::uuid, 'booked'::text,
       '2026-10-29T11:15:00Z'::timestamptz, '2026-10-29T12:00:00Z'::timestamptz, ${literal(bUid)}::text)
    ),
    clients(id, org_id, is_demo, custom_fields) AS (
      VALUES ('${CLIENT}'::uuid, '${ORG}'::uuid, false, '{}'::jsonb)
    ),
    call_outcomes(org_id, client_id, booking_ref, logged_at, is_demo) AS (
      VALUES ('${ORG}'::uuid, '${outcomeClient}'::uuid,
              ${literal(outcomeRef)}::text,
              '2026-10-29T12:05:00Z'::timestamptz, false)
    )\n` + BOOKED_NO_OUTCOME_SQL;
}

function smsFixture({ email = "buyer@normalcorp.com", eventFields = {}, clientFields = {} } = {}) {
  const payload = JSON.stringify({ email, ...eventFields });
  const custom = JSON.stringify(clientFields);
  const cte = `WITH
    events(id, org_id, name, payload, client_id, is_demo, created_at) AS (
      VALUES ('33333333-3333-4333-8333-333333333333'::uuid, '${ORG}'::uuid,
              'booking.created'::text, ${literal(payload)}::jsonb, NULL::uuid, false,
              '2026-10-29T10:00:00Z'::timestamptz)
    ),
    message_templates(org_id, template_key, channel, compliance_passed, body, subject) AS (
      VALUES ('${ORG}'::uuid, 'SMS-S04-01-CONFIRM'::text, 'sms'::text, true,
              'Your booking is ready'::text, ''::text)
    ),
    clients(id, org_id, email, is_demo, custom_fields) AS (
      VALUES ('${CLIENT}'::uuid, '${ORG}'::uuid, ${literal(email)}::text,
              false, ${literal(custom)}::jsonb)
    ),
    opt_outs(client_id, channel, opted_in_at) AS (
      SELECT NULL::uuid, NULL::text, NULL::timestamptz WHERE false
    ),
    messages(org_id, channel, direction, provider_ref, client_id, template_key) AS (
      SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::text WHERE false
    )`;
  const step = SMS_JOURNEY_STEPS.filter((s) => s.eventName === "booking.created");
  return cte + "\n" + buildJourneyZeroSql(step);
}

test("Pulse SQL contracts keep explicit booking identity and bounded fallback", () => {
  assert.match(BOOKED_NO_OUTCOME_SQL, /o\.booking_ref IS NULL OR btrim\(o\.booking_ref\) = ''/);
  assert.match(BOOKED_NO_OUTCOME_SQL, /o\.logged_at <= COALESCE\(b\.ends_at, b\.starts_at\) \+ interval '2 hours'/);
  const sms = buildJourneyZeroSql();
  for (const marker of ["payload->>'simulated'", "payload->>'synthetic'",
                         "custom_fields->>'synthetic'", "%+sim-%"]) {
    assert.ok(sms.includes(marker), `missing SMS synthetic guard: ${marker}`);
  }
});

const livePg = Boolean(process.env.DATABASE_URL);
test("later call B outcome must not hide earlier unanswered call A (real SELECT fixture)", {
  skip: !livePg && "no disposable Postgres configured"
}, async () => {
  const exactB = await db.query(bookedFixture(), [
    ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"
  ]);
  assert.deepEqual(exactB.rows.map((r) => r.id), [BOOKING_A]);
  // A matching provider UID is not enough: the closer must have logged the
  // disposition against the same buyer, not another buyer in the same org.
  const wrongClientRef = await db.query(bookedFixture({
    outcomeClient: OTHER_CLIENT
  }), [ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"]);
  assert.deepEqual(wrongClientRef.rows.map((r) => r.id), [BOOKING_A, BOOKING_B]);
  const wrongClientUnlinked = await db.query(bookedFixture({
    outcomeClient: OTHER_CLIENT, outcomeRef: null
  }), [ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"]);
  assert.deepEqual(wrongClientUnlinked.rows.map((r) => r.id), [BOOKING_A, BOOKING_B]);
  const lateUnlinked = await db.query(bookedFixture({
    bStart: "2026-10-29T17:00:00Z",
    bEnd: "2026-10-29T18:00:00Z",
    outcomeRef: null,
    outcomeAt: "2026-10-29T18:10:00Z"
  }), [ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"]);
  assert.deepEqual(lateUnlinked.rows.map((r) => r.id), [BOOKING_A]);
  // Baseline false-green: both calls are in the same two-hour fallback
  // window, and one unlinked staff outcome previously cleared BOTH.
  // Neither appointment has a trustworthy attributed result: remain RED.
  const ambiguous = await db.query(bookedFixture({ outcomeRef: null }), [
    ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"
  ]);
  assert.deepEqual(ambiguous.rows.map((r) => r.id), [BOOKING_A, BOOKING_B]);
  // A lone eligible appointment can still use a genuinely unlinked outcome.
  const uniqueA = await db.query(bookedFixture({
    bStart: "2026-10-29T17:00:00Z",
    bEnd: "2026-10-29T18:00:00Z",
    outcomeRef: null,
    outcomeAt: "2026-10-29T11:05:00Z"
  }), [ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"]);
  assert.deepEqual(uniqueA.rows.map((r) => r.id), [BOOKING_B]);
});

test("two bookings sharing a provider UID do not borrow one outcome across NULL client identity (read-only PG)", {
  skip: !livePg && "no disposable Postgres configured"
}, async () => {
  const args = [ORG, "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z"];
  const ambiguous = await db.query(nullClientDuplicateUidFixture(), args);
  assert.deepEqual(ambiguous.rows.map((r) => r.id), [BOOKING_A],
    "one outcome for B must not also clear A when A has no client identity");
  const unique = await db.query(nullClientDuplicateUidFixture({ duplicate: false }), args);
  assert.deepEqual(unique.rows.map((r) => r.id), [BOOKING_B],
    "a unique provider UID still links a NULL-client appointment without a false RED");
  const explicitLocal = await db.query(nullClientDuplicateUidFixture({
    duplicate: true, exactBookingRef: true
  }), args);
  assert.deepEqual(explicitLocal.rows.map((r) => r.id), [BOOKING_B],
    "an exact local booking UUID remains trusted even if provider UIDs collide");
});

test("simulated SMS journeys are excluded but genuine missing SMS remains RED", {
  skip: !livePg && "no disposable Postgres configured"
}, async () => {
  const params = [ORG, "2026-10-29T12:00:00Z", "2026-10-22T00:00:00Z"];
  const cases = [
    [{ eventFields: { simulated: true } }, 0],
    [{ eventFields: { synthetic: true } }, 0],
    [{ clientFields: { synthetic: true } }, 0],
    [{ email: "buyer+sim-repair-full@normalcorp.com" }, 0],
    [{ email: "buyer@normalcorp.com" }, 1]
  ];
  for (const [data, expected] of cases) {
    const result = await db.query(smsFixture(data), params);
    assert.equal(Number(result.rows[0]?.n), expected, JSON.stringify(data));
  }
});

test.after(async () => {
  if (livePg) await close();
});
