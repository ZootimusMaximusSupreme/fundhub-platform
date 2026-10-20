/* Postgres-backed tests for the inbound webhook door (src/http/router.mjs).
 *
 * WHAT THIS PINS THAT THE STUBBED ROUTER TESTS CANNOT.
 * src/http/router.test.mjs drives handleWebhook against a fake `db.query` and
 * proves the DECISIONS: who is refused, which adapter is reached, what the
 * response body says. It cannot prove that the receipt this door now writes is
 * legal SQL against the real webhook_captures table, that a jsonb column
 * accepts the header map and the decision object being handed to it, or that a
 * refused request leaves the table exactly as it found it. Those are the claims
 * here, and they are asserted against the ROWS, not the responses.
 *
 * THE BUG THIS EXISTS FOR. A signed PostGrid ping (letter.updated) and a signed
 * Bland ping (call not finished) both answered 200 and both did nothing else —
 * correctly, by design, in both cases. But neither left any trace, so an
 * operator staring at a provider dashboard that said "delivered" had no way to
 * tell "we received it and ignored it on purpose" from "it was dropped on the
 * floor". The early returns are unchanged. What is new is the receipt.
 *
 * AND THE GUARD THAT MATTERS MORE THAN THE FEATURE: an UNVERIFIED request must
 * write NOTHING. Capturing unverified traffic would let anyone on the internet
 * fill this table by POSTing garbage at /api/webhooks/<anything>. That is
 * tested explicitly, per provider, below.
 *
 * It lives under src/http/ and not next to the handler because package.json's
 * test glob walks src/ and scripts/ only; a test in api/ is never collected and
 * passes forever by never running (CLAUDE.md, traps).
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { handleWebhook } from "./router.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";
import pg from "pg";
import { handleBlandWebhook } from "../adapters/bland.mjs";
import { recordDispatch } from "../lib/outbound-calls.mjs";
import { register as registerComms } from "../handlers/comms.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
let HAVE_SCRATCH_DB = false;
try {
  const url = new URL(process.env.DATABASE_URL);
  HAVE_SCRATCH_DB = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* completed-call fixture writes require an explicit local scratch database */ }

/* Every body this file sends carries this nonce, so cleanup can delete exactly
   the rows this run created and nothing else — the table is shared with the
   ClickFunnels capture rows. */
const NONCE = `t7-lane-c-${process.pid}-${Date.now()}`;

const POSTGRID_SECRET = "pg_capture_test_secret";
const BLAND_SECRET = "bland_capture_test_secret";
const CF_SECRET = "cf_capture_test_secret";

const hmac = (secret, raw) => crypto.createHmac("sha256", secret).update(raw).digest("hex");

const reset = () => { _resetOrgCache(); clearHandlers(); _resetRegistered(); };

async function capturesFor(provider) {
  const r = await db.query(
    `SELECT id, org_id, provider, headers, raw_body, parsed, created_at
       FROM webhook_captures
      WHERE provider = $1 AND raw_body LIKE '%' || $2 || '%'
      ORDER BY created_at`,
    [provider, NONCE]
  );
  return r.rows;
}

/* Narrower than capturesFor: the ClickFunnels cases below run the SAME provider
   twice under two different flag settings, so each needs to count only its own
   delivery. Every needle contains NONCE, so cleanup still sweeps them. */
async function capturesLike(provider, needle) {
  const r = await db.query(
    `SELECT id, org_id, provider, headers, raw_body, parsed,
            octet_length(raw_body) AS stored_bytes
       FROM webhook_captures
      WHERE provider = $1 AND raw_body LIKE '%' || $2 || '%'
      ORDER BY created_at`,
    [provider, needle]
  );
  return r.rows;
}

async function totalCaptures() {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM webhook_captures WHERE raw_body LIKE '%' || $1 || '%'`,
    [NONCE]
  );
  return r.rows[0].n;
}

describe("inbound webhook capture (src/http/router.mjs)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  before(async () => {
    // Leave no rows behind from an interrupted earlier run of the same pid.
    await db.query(`DELETE FROM webhook_captures WHERE raw_body LIKE '%' || $1 || '%'`, [NONCE]);
  });

  after(async () => {
    await db.query(`DELETE FROM webhook_captures WHERE raw_body LIKE '%' || $1 || '%'`, [NONCE]);
    await close();
  });

  /* --- T7-10: the PostGrid ping that vanished ------------------------------ */
  test("a signed PostGrid letter.updated still answers 200 ignored AND now leaves a row", async () => {
    reset();
    const raw = JSON.stringify({
      event: "letter.updated",
      job_id: `letter_${NONCE}`,
      status: "processed_for_delivery",
      note: NONCE
    });
    const out = await handleWebhook({
      db,
      provider: "postgrid",
      rawBody: raw,
      headers: { "postgrid-signature": hmac(POSTGRID_SECRET, raw) },
      url: "https://x/api/webhooks/postgrid",
      env: { POSTGRID_WEBHOOK_SECRET: POSTGRID_SECRET }
    });

    // The early return is UNCHANGED — a letter.updated is not a delivery.
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.ignored, true);
    assert.equal(out.body.eventType, "letter.updated");

    const rows = await capturesFor("postgrid");
    assert.equal(rows.length, 1, "a verified PostGrid webhook left no receipt");
    assert.equal(rows[0].raw_body, raw, "the receipt must hold the payload verbatim");
    assert.equal(rows[0].org_id, null, "org_id is deliberately NULL — the tenant is unknown at the door");
    // The decision is the part an operator cannot get from the payload alone.
    assert.equal(rows[0].parsed.status, 200);
    assert.equal(rows[0].parsed.outcome.ignored, true);
    assert.equal(rows[0].parsed.outcome.eventType, "letter.updated");
    assert.equal(rows[0].headers["postgrid-signature"], hmac(POSTGRID_SECRET, raw));
  });

  /* The nastier half of T7-10. A delivery.confirmed for a letter id we cannot
     match answers PostGrid a flat 200 — the provider is told "fine" — while
     internally nothing was scheduled, because no inquiry_removal_cases row
     carries that letter id. That mismatch used to leave no trace anywhere. The
     receipt now records both halves: the 200 we sent and the case_not_found we
     actually reached. */
  test("a PostGrid delivery.confirmed is captured too, with its real outcome", async () => {
    reset();
    const raw = JSON.stringify({
      event: "delivery.confirmed",
      job_id: `letter_missing_${NONCE}`,
      status: "delivered",
      timestamp: "2026-08-07T14:00:00.000Z"
    });
    const out = await handleWebhook({
      db,
      provider: "postgrid",
      rawBody: raw,
      headers: { "postgrid-signature": hmac(POSTGRID_SECRET, raw) },
      url: "https://x/api/webhooks/postgrid",
      env: { POSTGRID_WEBHOOK_SECRET: POSTGRID_SECRET }
    });
    assert.equal(out.status, 200);

    const rows = await capturesFor("postgrid");
    assert.equal(rows.length, 2, "the delivery path must be captured as well as the ignored path");
    const delivered = rows[1];
    assert.equal(delivered.parsed.status, 200, "PostGrid was told 200");
    assert.equal(
      delivered.parsed.outcome.reason,
      "case_not_found",
      "the receipt must record that the 200 hid a letter we could not match"
    );
  });

  /* --- T7-11: the Bland ping that vanished --------------------------------- */
  test("a signed Bland not-completed call still answers 200 AND now leaves a row", async () => {
    reset();
    const raw = JSON.stringify({
      call_id: `call_${NONCE}`,
      status: "in-progress",
      completed: false
    });
    const out = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });

    // The early return is UNCHANGED — an unfinished call emits nothing.
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.reason, "not_completed");
    assert.deepEqual(out.body.emitted, []);

    const rows = await capturesFor("bland");
    assert.equal(rows.length, 1, "a verified Bland webhook left no receipt");
    assert.equal(rows[0].raw_body, raw);
    assert.equal(rows[0].parsed.outcome.reason, "not_completed");
    assert.equal(rows[0].org_id, null);
  });

  /* --- THE STORAGE-EXHAUSTION GUARD ---------------------------------------- */
  test("an UNVERIFIED request writes nothing — no signature, wrong signature, unknown provider", async () => {
    const before = await totalCaptures();

    const attempts = [
      // No signature at all.
      { provider: "postgrid", headers: {}, env: { POSTGRID_WEBHOOK_SECRET: POSTGRID_SECRET }, expect: 401 },
      { provider: "bland", headers: {}, env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }, expect: 401 },
      // A forged signature against a configured key.
      { provider: "postgrid", headers: { "postgrid-signature": "deadbeef" }, env: { POSTGRID_WEBHOOK_SECRET: POSTGRID_SECRET }, expect: 401 },
      { provider: "bland", headers: { "x-bland-signature": "deadbeef" }, env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }, expect: 401 },
      // A correct signature for the WRONG key.
      { provider: "bland", headers: { "x-bland-signature": hmac("not-the-key", `{"note":"${NONCE}"}`) }, env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }, expect: 401 },
      // A provider that does not exist — the open-door case.
      { provider: "myspace", headers: {}, env: {}, expect: 404 }
    ];

    for (const a of attempts) {
      reset();
      const out = await handleWebhook({
        db,
        provider: a.provider,
        rawBody: `{"note":"${NONCE}"}`,
        headers: a.headers,
        url: `https://x/api/webhooks/${a.provider}`,
        env: a.env
      });
      assert.equal(out.status, a.expect, `${a.provider} answered ${out.status}, expected ${a.expect}`);
    }

    assert.equal(
      await totalCaptures(),
      before,
      "unverified traffic reached webhook_captures — anyone could fill this table"
    );
  });

  /* --- Cal.com removed 2026-08-23 ------------------------------------------ */
  test("Cal.com is gone — /api/webhooks/cal and /calcom 404 and write nothing", async () => {
    const before = await totalCaptures();
    for (const provider of ["cal", "calcom"]) {
      reset();
      const raw = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: NONCE } });
      const out = await handleWebhook({
        db, provider, rawBody: raw, headers: {},
        url: `https://x/api/webhooks/${provider}`, env: {}
      });
      assert.equal(out.status, 404, `${provider} must not have an adapter`);
    }
    assert.equal(await totalCaptures(), before, "a dead vendor must not write a receipt");
  });

  /* --- EXACTLY ONE ROW PER DELIVERY, IN BOTH CONFIGURATIONS -----------------

     ClickFunnels is the provider every real booking arrives through, and it was
     the one provider producing NO receipt at all in production.

     The router skipped it, reasoning that src/adapters/clickfunnels.mjs writes
     its own row. It does — but only when process.env.CF_CAPTURE_MODE === "1",
     and that flag is unset on Netlify. One writer minus a default-off flag is
     zero writers, so the ticket's own goal ("every verified inbound webhook
     leaves a receipt") was missed by the busiest door in the system.

     Both settings of that flag are exercised here, against the real table, and
     both must land on exactly ONE row. Not two (a duplicate), not zero (the
     bug). This is the test that would have caught it: the earlier version
     asserted zero under the production setting and called that correct. */
  const cfDelivery = async (marker) => {
    reset();
    // No email → the adapter answers 200 no_email and emits nothing.
    const raw = JSON.stringify({ event_type: "order.created", id: marker, data: {} });
    const out = await handleWebhook({
      db, provider: "clickfunnels", rawBody: raw,
      headers: { "x-webhook-clickfunnels-signature": hmac(CF_SECRET, raw) },
      url: "https://x/api/webhooks/clickfunnels",
      env: { CLICKFUNNELS_WEBHOOK_SECRET: CF_SECRET }
    });
    assert.equal(out.status, 200, "the ClickFunnels signature must verify for this test to mean anything");
    return { raw, out };
  };

  test("ClickFunnels leaves exactly one receipt with CF_CAPTURE_MODE unset — the production setting", async () => {
    const prev = process.env.CF_CAPTURE_MODE;
    delete process.env.CF_CAPTURE_MODE;
    try {
      const marker = `${NONCE}-cf-off`;
      const { raw } = await cfDelivery(marker);

      const rows = await capturesLike("clickfunnels", marker);
      assert.equal(
        rows.length,
        1,
        "with CF_CAPTURE_MODE unset the adapter writes nothing, so the router must — this is the production hole"
      );
      assert.equal(rows[0].raw_body, raw, "the receipt must hold the payload verbatim");
      // The router's receipt records the DECISION; the adapter's does not.
      assert.equal(rows[0].parsed.status, 200);
      assert.equal(rows[0].parsed.outcome.reason, "no_email");
    } finally {
      if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
      else process.env.CF_CAPTURE_MODE = prev;
    }
  });

  test("ClickFunnels leaves exactly one receipt with CF_CAPTURE_MODE=1 — not two", async () => {
    const prev = process.env.CF_CAPTURE_MODE;
    process.env.CF_CAPTURE_MODE = "1";
    try {
      const marker = `${NONCE}-cf-on`;
      const { raw } = await cfDelivery(marker);

      const rows = await capturesLike("clickfunnels", marker);
      assert.equal(
        rows.length,
        1,
        "one delivery wrote more than one row — the router and the adapter both captured it"
      );
      assert.equal(rows[0].raw_body, raw);
    } finally {
      if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
      else process.env.CF_CAPTURE_MODE = prev;
    }
  });

  /* --- THE STORED BODY IS CAPPED -------------------------------------------

     A verified 2,000,056-byte body was stored whole. One row per delivery, no
     truncation, no retention job, on a shared production Postgres.

     The row must still exist — that a large delivery arrived is the fact worth
     keeping — and the stored value must SAY it is incomplete. A silently
     shortened payload is a worse trap than no payload: an operator reads it as
     the whole delivery and hunts a parsing bug that was never there. */
  test("an oversized verified body is stored truncated, marked, and still leaves exactly one row", async () => {
    reset();
    const padding = "x".repeat(2_000_000);
    const raw = JSON.stringify({
      call_id: `call_big_${NONCE}`,
      status: "in-progress",
      completed: false,
      padding
    });
    const originalBytes = Buffer.byteLength(raw, "utf8");
    assert.ok(originalBytes > 2_000_000, "the reproduction needs a genuinely oversized body");

    const out = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });
    // The cap must not change what the provider is told.
    assert.equal(out.status, 200);
    assert.equal(out.body.reason, "not_completed");

    const rows = await capturesLike("bland", `call_big_${NONCE}`);
    assert.equal(rows.length, 1, "the oversized delivery must still leave a receipt — never dropped");
    const row = rows[0];

    assert.ok(
      row.stored_bytes < originalBytes,
      `the whole ${originalBytes}-byte body was stored — the cap did nothing`
    );
    assert.ok(
      row.stored_bytes < 70 * 1024,
      `stored ${row.stored_bytes} bytes — the cap is not holding`
    );

    // The truncation is visible IN THE VALUE, with the original length.
    assert.match(row.raw_body, /TRUNCATED BY WEBHOOK CAPTURE/);
    assert.match(
      row.raw_body,
      new RegExp(`of ${originalBytes} bytes`),
      "the marker must state how long the original delivery actually was"
    );
    // The head of the payload survives, so the receipt is still useful.
    assert.ok(
      row.raw_body.startsWith(`{"call_id":"call_big_${NONCE}"`),
      "the start of the payload must be kept"
    );
    // And it is queryable, not only greppable.
    assert.equal(row.parsed.raw_body_truncated.original_bytes, originalBytes);
    assert.ok(row.parsed.raw_body_truncated.stored_bytes > 0);
    // The decision is recorded exactly as it is for a small body.
    assert.equal(row.parsed.status, 200);
    assert.equal(row.parsed.outcome.reason, "not_completed");
  });

  test("a body under the cap is stored verbatim, with no truncation marker", async () => {
    reset();
    const raw = JSON.stringify({
      call_id: `call_small_${NONCE}`,
      status: "in-progress",
      completed: false,
      padding: "y".repeat(4096)
    });
    const out = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });
    assert.equal(out.status, 200);

    const rows = await capturesLike("bland", `call_small_${NONCE}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].raw_body, raw, "a normal-sized payload must not be touched by the cap");
    assert.equal(rows[0].parsed.raw_body_truncated, undefined, "a normal payload must not be marked truncated");
  });

  /* --- credentials never land in long-lived storage ------------------------ */
  test("a credential header on a verified request is not persisted", async () => {
    reset();
    const raw = JSON.stringify({
      call_id: `call_hdr_${NONCE}`,
      status: "in-progress",
      completed: false
    });
    const out = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: {
        "x-bland-signature": hmac(BLAND_SECRET, raw),
        authorization: "Bearer super-secret-token",
        cookie: "session=abc",
        "x-api-key": "k-123",
        "user-agent": "Bland/1.0"
      },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });
    assert.equal(out.status, 200);

    const rows = await capturesFor("bland");
    const row = rows.find((r) => r.raw_body === raw);
    assert.ok(row, "the verified Bland webhook was not captured");
    assert.equal(row.headers.authorization, undefined, "an Authorization header was written to storage");
    assert.equal(row.headers.cookie, undefined, "a Cookie header was written to storage");
    assert.equal(row.headers["x-api-key"], undefined, "an API key header was written to storage");
    assert.equal(row.headers["user-agent"], "Bland/1.0", "useful headers must still be kept");
  });

  /* --- the kill switch is OFF by default ----------------------------------- */
  test("WEBHOOK_CAPTURE=0 disables the receipt; unset leaves it ON", async () => {
    reset();
    const raw = JSON.stringify({
      call_id: `call_off_${NONCE}`,
      status: "in-progress",
      completed: false
    });
    const before = await totalCaptures();
    const out = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET, WEBHOOK_CAPTURE: "0" }
    });
    assert.equal(out.status, 200, "the kill switch must not change the response");
    assert.equal(await totalCaptures(), before, "WEBHOOK_CAPTURE=0 did not disable the capture");

    /* And the default. This is the whole point of the flag defaulting ON: with
       no WEBHOOK_CAPTURE set at all, the same request DOES leave a receipt. */
    reset();
    const out2 = await handleWebhook({
      db,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });
    assert.equal(out2.status, 200);
    assert.equal(await totalCaptures(), before + 1, "the capture must be ON when nothing is configured");
  });

  /* --- a broken capture must never break a webhook -------------------------- */
  test("a failing capture insert still returns the provider its 200", async () => {
    reset();
    const raw = JSON.stringify({
      call_id: `call_boom_${NONCE}`,
      status: "in-progress",
      completed: false
    });
    const exploding = {
      query(sql, params) {
        if (/INSERT INTO webhook_captures/.test(sql)) throw new Error("disk on fire");
        return db.query(sql, params);
      }
    };
    const out = await handleWebhook({
      db: exploding,
      provider: "bland",
      rawBody: raw,
      headers: { "x-bland-signature": hmac(BLAND_SECRET, raw) },
      url: "https://x/api/webhooks/bland",
      env: { BLAND_WEBHOOK_SECRET: BLAND_SECRET }
    });
    assert.equal(out.status, 200, "a capture failure must never cost the provider its 200");
    assert.equal(out.body.reason, "not_completed");
  });
});

describe("completed Bland calls use their verified stored dispatch", {
  skip: !HAVE_SCRATCH_DB || Boolean(process.env.INNGEST_EVENT_KEY)
    ? "requires a local scratch database without a live event key" : false
}, () => {
  async function withFixture(run) {
    const tx = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    await tx.connect();
    await tx.query("BEGIN");
    try {
      clearHandlers();
      registerComms();
      const org = (await tx.query("SELECT id FROM orgs ORDER BY id LIMIT 1")).rows[0]?.id;
      assert.ok(org, "scratch migrations must seed an org");
      const client = (await tx.query(`INSERT INTO clients (org_id, email, first_name, last_name)
        VALUES ($1,$2,'Bland','Scratch') RETURNING id`,
      [org, `e2e+aff-bland-${crypto.randomUUID()}@example.com`])).rows[0].id;
      const callId = `call_${NONCE}_${crypto.randomUUID()}`;
      await recordDispatch({ callId, clientId: client, orgId: org, kind: "blueprint-accountability", db: tx });
      await run({ tx, org, client, callId });
    } finally {
      await tx.query("ROLLBACK");
      await tx.end();
      reset();
    }
  }

  async function deliver(tx, body, extra = {}) {
    const rawBody = JSON.stringify(body);
    return handleBlandWebhook({ db: tx, rawBody,
      signatureHeader: hmac(BLAND_SECRET, rawBody), secret: BLAND_SECRET, ...extra });
  }

  test("completed call and late transcript persist once on the actual dispatch's client", async () => {
    await withFixture(async ({ tx, org, client, callId }) => {
      const body = { call_id: callId, status: "completed", completed: true,
        disposition: "answered", duration: 45, metadata: { client_id: crypto.randomUUID(), org_id: crypto.randomUUID() } };
      const first = await deliver(tx, body);
      assert.equal(first.status, 200);
      assert.equal(first.emitted.length, 1);
      const later = await deliver(tx, { ...body, summary: "Client will upload the receipt.",
        transcript: "Client: I will upload my payment receipt today." });
      assert.equal(later.status, 200);
      assert.equal(later.emitted[0].deduped, true);
      const events = (await tx.query(`SELECT org_id, client_id FROM events
        WHERE name = 'call.completed' AND idempotency_key = $1`, [`bland:${callId}:call.completed`])).rows;
      assert.equal(events.length, 1);
      assert.equal(events[0].org_id, org);
      assert.equal(events[0].client_id, client);
      const messages = (await tx.query(`SELECT org_id, client_id, channel, rendered_body, conversation_id
        FROM messages WHERE provider = 'bland' AND provider_ref = $1`, [callId])).rows;
      assert.equal(messages.length, 1);
      assert.equal(messages[0].org_id, org);
      assert.equal(messages[0].client_id, client);
      assert.equal(messages[0].channel, "voice");
      assert.match(messages[0].rendered_body, /Client: I will upload my payment receipt today\./);
      assert.ok(messages[0].conversation_id, "the call must join the client's persisted conversation history");
    });
  });

  test("unknown dispatch or wrong caller client never emits a completed event or saves words", async () => {
    await withFixture(async ({ tx, callId }) => {
      const body = { call_id: callId, status: "completed", transcript: "Must not attach to another file." };
      const mismatch = await deliver(tx, body, { clientId: crypto.randomUUID() });
      assert.equal(mismatch.status, 409);
      assert.equal(mismatch.reason, "call_attribution_mismatch");
      const unknownCall = `${callId}_unknown`;
      const unknown = await deliver(tx, { ...body, call_id: unknownCall });
      assert.equal(unknown.status, 409);
      assert.equal(unknown.reason, "call_dispatch_not_found");
      assert.equal(Number((await tx.query(`SELECT count(*) AS n FROM events
        WHERE name = 'call.completed' AND payload->>'callId' = ANY($1)`, [[callId, unknownCall]])).rows[0].n), 0);
      assert.equal(Number((await tx.query(`SELECT count(*) AS n FROM messages
        WHERE provider = 'bland' AND provider_ref = ANY($1)`, [[callId, unknownCall]])).rows[0].n), 0);
    });
  });
});
