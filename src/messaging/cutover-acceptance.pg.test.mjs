// THE ACCEPTANCE BAR FOR TICKET 1, ASSERTED AGAINST A REAL DATABASE.
// SKIPS unless DATABASE_URL is set.
//
// Every other test file in this feature checks a part. This one checks the four
// promises the ticket actually made, plus the race, end to end through the real
// queue: sendTemplated writes the row, the dispatcher claims it, the gate judges
// it, and a provider spy counts what got out.
//
// THE PROVIDER SPY IS THE ASSERTION. Not "the status says blocked" — a status is
// a claim about what happened. The spy is a count of how many times this code
// contacted the outside world. Where a test below says zero, zero is the thing
// that matters and the status is corroboration.
//
// Requires: node db/migrate.mjs (through 111_messages_address.sql).

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { db, close } from "../db.mjs";
import { dispatchDue, claimDue, OUTCOME } from "./dispatch.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { handle as n06Handle } from "../workflows/n-06-renewal-second-wave.mjs";
import { replay } from "../events/bus.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";

const RUN = !!process.env.DATABASE_URL;

const TAG = "cutover-acceptance";
const EMAIL_TPL = "EMAIL-N06-RENEWAL";
const SMS_TPL = "SMS-N06-RENEWAL";

let orgId = null;
let clientId = null;

/* Mid-morning Arizona. Every test that is not about the clock pins it here, so
   a suite run at 2am does not silently become a quiet-hours test. */
const MIDDAY = () => new Date("2026-08-03T16:00:00Z");

/** A fetch spy. Its call count is the number of messages that reached a
    provider. Returns the shape both providers read a success out of. */
function spy() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      /* `sid` is Twilio's success key (providers/twilio.mjs:204) and was missing:
         the provider answered "accepted the message but returned no sid" and the
         send was recorded as a retry, so the quiet-hours test could never see
         the text leave and blamed the window. `id` is Resend's. The comment
         above has always claimed this returns the shape BOTH providers read;
         now it does. */
      text: async () => JSON.stringify({
        id: `prov-${calls.length}`,
        messageId: `prov-${calls.length}`,
        sid: `SM${String(calls.length).padStart(32, "0")}`
      })
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const ENV = {
  /* This whole file is the cutover acceptance run — its entire job is to prove
     messages DO go out under the right conditions. The dry-run fence defaults
     to blocked, so it has to be declared down here or every assertion below
     would pass by sending nothing, which is the opposite of acceptance. */
  MESSAGING_DRY_RUN: "0",
  /* RESEND, not Mailgun. The email provider moved and this block did not: the
     dispatcher answered `retry — resend is not configured: RESEND_API_KEY,
     RESEND_FROM not set` on every message, so the acceptance run sent nothing
     and three tests failed claiming the send path was broken. Same fake-key
     shape the other suites use (providers.test.mjs:357, staff-mail.test.mjs:44).
     The Mailgun keys are left below because src/messaging/providers/mailgun.mjs
     still exists and resolve() may still pick it for a letter channel. */
  RESEND_API_KEY: "re_test_0123456789abcdef",
  RESEND_FROM: "Fundhub <no-reply@fundhub.ai>",
  /* Same story on the SMS half: twilio answered `retry — not configured` so the
     quiet-hours test could never observe the text going out once the window
     opened, and reported it as the window being broken. */
  TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TWILIO_SEND_AUTH_TOKEN: "twilio-test-token",
  TWILIO_SEND_FROM: "+15550000000",
  MAILGUN_SEND_API_KEY: "key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  MAILGUN_SEND_DOMAIN: "mg.example.com",
  MAILGUN_SEND_FROM: "Fundhub <no-reply@mg.example.com>",
  GHL_RELAY_API_KEY: "crm-token"
};

const opts = (fetchImpl, now = MIDDAY) => ({ fetchImpl, env: ENV, now, orgId, limit: 50 });

before(async () => {
  if (!RUN) return;
  orgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;

  /* Resend's own test inbox, not @example.com. Email routes to Resend, and
     Resend refuses example.com on sight (HTTP 422), so the dispatcher now holds
     that address as a test address before any send (M7, 2026-10-05). The
     transport is a spy here either way; this keeps the fixture an address the
     real provider would take, so the acceptance run still proves a send. */
  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone, ghl_contact_id)
     VALUES ($1,'Acceptance','Case','delivered+acceptance-case@resend.dev','+15550000001','crmAcceptance')
     RETURNING id`,
    [orgId]
  )).rows[0].id;

  // Real templates, compliance-passed. Without these sendTemplated returns
  // template_pending and queues nothing, and every test below would pass by
  // doing nothing at all.
  for (const [key, channel, subject, body] of [
    [EMAIL_TPL, "email", "About your file, {{contact.first_name}}", "Hello {{contact.first_name}}, your file is ready to discuss."],
    [SMS_TPL, "sms", null, "Hi {{contact.first_name}}, your file is ready to discuss."]
  ]) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (org_id, template_key) DO UPDATE
         SET body = EXCLUDED.body, subject = EXCLUDED.subject, compliance_passed = true`,
      [orgId, key, channel, subject, body]
    );
  }
});

after(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM tasks WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM opt_outs WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM events WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM funding_rounds WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2)`,
    [orgId, [EMAIL_TPL, SMS_TPL]]);
  await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await close();
});

beforeEach(async () => {
  clearRuleCache();
  if (!RUN) return;
  // Each test starts from an empty queue and no consent history, so an earlier
  // test's leftovers cannot make a later one pass.
  await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM opt_outs WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM tasks WHERE client_id = $1`, [clientId]);
});

/** Queue one message the way production does — through sendTemplated. */
async function queueReal({ channel = "email", templateKey = EMAIL_TPL, eventId = null, body = null } = {}) {
  if (body === null) {
    return sendTemplated(db, {
      orgId, clientId, channel, templateKey,
      eventId: eventId || `evt-${Math.random().toString(16).slice(2)}`
    });
  }
  // A body the templates cannot produce (restricted wording) is written
  // directly, because the point of that test is the gate, not the template.
  await db.query(
    `INSERT INTO messages
       (org_id, client_id, direction, channel, template_key, rendered_body,
        provider, provider_ref, status, compliance_check_passed, to_address)
     VALUES ($1,$2,'outbound',$3,$4,$5,'internal',$6,'queued',true,$7)`,
    [orgId, clientId, channel, TAG, body, `${TAG}:${Math.random()}`, "delivered+acceptance-case@resend.dev"]
  );
  return { sent: true };
}

const rowsFor = async () =>
  (await db.query(
    `SELECT id, status, blocked_reason, scheduled_at, attempts, to_address, subject
       FROM messages WHERE client_id = $1 ORDER BY created_at`,
    [clientId]
  )).rows;

// ═══════════════════════════════════════════════════════════════════════════
// 1. REPLAYING THE EVENT LOG SENDS NOTHING
// ═══════════════════════════════════════════════════════════════════════════

test("replay() over the same event log sends ZERO messages", { skip: !RUN }, async () => {
  const f = spy();

  // Queue and send one message for real, so there is something in the log and
  // something already delivered.
  await queueReal({ eventId: "replay-evt-1" });
  const first = await dispatchDue(db, opts(f));
  assert.equal(first.counts[OUTCOME.SENT], 1, "the setup must actually send one message");
  assert.equal(f.calls.length, 1);

  const before = f.calls.length;
  const messagesBefore = (await rowsFor()).length;

  // Replay everything in the log for this client. Handlers re-run; nothing may
  // be re-queued, because provider_ref conflicts into DO NOTHING — and nothing
  // may be re-sent, because replay does not dispatch.
  await replay(db, { throwOnHandlerError: false });

  assert.equal(f.calls.length, before,
    `REPLAY SENT ${f.calls.length - before} MESSAGE(S) — replaying the log contacted a provider`);
  assert.equal((await rowsFor()).length, messagesBefore,
    "replay duplicated a message row");

  // And a second dispatch pass after the replay has nothing to do.
  const after2 = await dispatchDue(db, opts(f));
  assert.equal(after2.claimed, 0, "replay left something claimable behind");
  assert.equal(f.calls.length, before, "the pass after a replay sent something");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. n-06 — THE WORKFLOW THAT SLEPT 180 DAYS PAST THE OPT-OUT
// ═══════════════════════════════════════════════════════════════════════════

test("n-06: a client who opted out during the sleep gets nothing", { skip: !RUN }, async () => {
  const f = spy();

  // n-06 only proceeds for a client with a funded round.
  await db.query(
    `INSERT INTO funding_rounds (org_id, client_id, round_number, funded_amount, status)
     VALUES ($1,$2,1,500000,'funded')`,
    [orgId, clientId]
  );

  // THE OPT-OUT HAPPENS DURING THE SLEEP — after the workflow started, before it
  // queues anything. Recorded on BOTH channels: sendTemplated's own guard only
  // covers sms, so email is the channel that proves the gate is doing the work.
  await recordOptOut(db, clientId, orgId, "sms");
  await recordOptOut(db, clientId, orgId, "email");

  // fakeStep: sleep is a no-op, which is what "180 days later" looks like here.
  const step = {
    run: async (_name, fn) => fn(),
    sleep: async () => {}
  };
  await n06Handle({
    event: { id: "n06-evt-1", orgId, clientId, payload: { client_id: clientId } },
    db, step
  });

  // Whatever n-06 managed to queue, the dispatcher must send none of it.
  const result = await dispatchDue(db, opts(f));

  assert.equal(f.calls.length, 0,
    `A MESSAGE WAS SENT TO A CLIENT WHO OPTED OUT — ${f.calls.length} provider call(s)`);

  // NOT A VACUOUS LOOP. If n-06 queued nothing — a missing template, an
  // ineligible client — there would be no rows to check and this test would
  // pass by doing nothing. Assert there was something to stop first.
  const rows = await rowsFor();
  assert.ok(rows.length >= 1,
    "n-06 queued nothing, so this test proved nothing about the gate");
  assert.equal(result.claimed, rows.length, "every queued message should have been claimed");

  for (const row of rows) {
    assert.equal(row.status, "blocked", `a queued message survived as '${row.status}'`);
    assert.match(row.blocked_reason || "", /opted_out/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. QUIET HOURS — HELD AT 20:00, STILL WAITING AT 20:05, OUT AFTER 08:00
// ═══════════════════════════════════════════════════════════════════════════

test("an SMS queued at 20:00 MST is still queued at 20:05 and sends after 08:00 MST",
  { skip: !RUN }, async () => {
    const f = spy();
    await queueReal({ channel: "sms", templateKey: SMS_TPL, eventId: "quiet-evt-1" });

    // 20:00 Arizona on 2026-08-03 is 03:00 UTC on 2026-08-04 (MST, UTC-7).
    const at2000 = () => new Date("2026-08-04T03:00:00Z");
    const at2005 = () => new Date("2026-08-04T03:05:00Z");
    const at0800 = () => new Date("2026-08-04T15:00:00Z");

    const pass1 = await dispatchDue(db, opts(f, at2000));
    assert.equal(pass1.counts[OUTCOME.DEFERRED], 1, "the text should have been held, not sent or blocked");
    assert.equal(f.calls.length, 0, "A TEXT WAS SENT AT 8PM");

    let [row] = await rowsFor();
    assert.equal(row.status, "queued", "a held text must stay queued, not become 'blocked'");
    assert.equal(row.blocked_reason, null,
      "A HELD TEXT WAS RECORDED AS A PERMANENT BLOCK — it would never send");

    // 20:05 — five minutes later, the sweeper runs again. Still nothing.
    const pass2 = await dispatchDue(db, opts(f, at2005));
    assert.equal(pass2.claimed, 0, "the text became due again inside the window");
    assert.equal(f.calls.length, 0, "A TEXT WAS SENT AT 8:05PM");

    [row] = await rowsFor();
    assert.equal(row.status, "queued", "still waiting at 20:05");
    assert.equal(new Date(row.scheduled_at).toISOString(), "2026-08-04T15:00:00.000Z",
      "the text should be due at 08:00 Arizona the next morning");

    // 08:00 the next morning. Now it goes.
    const pass3 = await dispatchDue(db, opts(f, at0800));
    assert.equal(pass3.counts[OUTCOME.SENT], 1, "the text did not send once the window opened");
    assert.equal(f.calls.length, 1, "exactly one text should have gone out");

    [row] = await rowsFor();
    assert.equal(row.status, "sent");
  });

// ═══════════════════════════════════════════════════════════════════════════
// 4. RESTRICTED WORDING — BLOCKED, TASK RAISED, NOTHING SENT
// ═══════════════════════════════════════════════════════════════════════════

test("restricted wording is blocked, raises a task, and reaches no provider",
  { skip: !RUN }, async () => {
    const f = spy();

    // A real rule out of compliance_rules (047), matched by a real body. The
    // body is fixed rather than derived from the rule's pattern: deriving it
    // meant the test could quietly stop tripping any rule and still pass.
    const rules = (await db.query(
      `SELECT rule_key, rule_set FROM compliance_rules
        WHERE rule_key IN ('guaranteed-approval', 'guaranteed-funding-amount')`
    )).rows;
    assert.ok(rules.length > 0,
      "the guaranteed-approval rules are not seeded — this test cannot prove anything");

    const body = "We guarantee approval for your funding.";

    await queueReal({ body });

    const before = (await db.query(
      `SELECT count(*)::int AS n FROM tasks WHERE client_id = $1`, [clientId]
    )).rows[0].n;

    const result = await dispatchDue(db, opts(f));

    assert.equal(f.calls.length, 0,
      `COPY THAT BREAKS A COMPLIANCE RULE WAS SENT — ${f.calls.length} provider call(s)`);
    assert.equal(result.counts[OUTCOME.BLOCKED], 1);

    const [row] = await rowsFor();
    assert.equal(row.status, "blocked");
    assert.ok(row.blocked_reason, "the reason must be recorded on the message");

    const after3 = (await db.query(
      `SELECT count(*)::int AS n FROM tasks WHERE client_id = $1`, [clientId]
    )).rows[0].n;
    assert.equal(after3, before + 1, "a human was not told to fix the copy");
  });

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE RACE — TWO DISPATCHERS, ONE ROW, EXACTLY ONE SEND
// ═══════════════════════════════════════════════════════════════════════════

test("two dispatchers racing the same message produce exactly one send",
  { skip: !RUN }, async () => {
    // ONE message. Both dispatchers go for the same row, at the same time, with
    // the same spy — so the spy's call count IS the number of sends.
    await queueReal({ eventId: "race-evt-1" });
    const [row] = await rowsFor();
    const f = spy();

    const [a, b] = await Promise.all([
      dispatchDue(db, opts(f)),
      dispatchDue(db, opts(f))
    ]);

    assert.equal(f.calls.length, 1,
      `THE SAME MESSAGE WAS SENT ${f.calls.length} TIMES BY RACING DISPATCHERS`);
    assert.equal(a.claimed + b.claimed, 1, "the row was claimed twice");

    const [after4] = await rowsFor();
    assert.equal(after4.id, row.id);
    assert.equal(after4.status, "sent");
    assert.equal(after4.attempts, 1, "a losing dispatcher must not spend an attempt");
  });

test("the claim UPDATE returns zero rows on the second attempt", { skip: !RUN }, async () => {
  // The mechanism underneath the race, asserted on its own so a future change to
  // the claim statement fails here with a clear reason rather than as a
  // mysterious double send.
  await queueReal({ eventId: "claim-evt-1" });

  const first = await claimDue(db, { orgId, limit: 50 });
  assert.equal(first.length, 1, "the first claim should take the row");

  const second = await claimDue(db, { orgId, limit: 50 });
  assert.equal(second.length, 0,
    "THE CLAIM RETURNED A ROW TWICE — two dispatchers would both send it");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. WHAT THE QUEUE RECORDED — 111's columns, filled by the real path
// ═══════════════════════════════════════════════════════════════════════════

test("the destination and the rendered subject are recorded when the message is queued",
  { skip: !RUN }, async () => {
    await queueReal({ eventId: "address-evt-1" });
    const [row] = await rowsFor();

    assert.equal(row.to_address, "delivered+acceptance-case@resend.dev",
      "the destination must be recorded at queue time");
    assert.equal(row.subject, "About your file, Acceptance",
      "the subject must be recorded RENDERED — an unrendered one shows the client a merge tag");
  });

test("message.queued is emitted once, and a replay does not emit it again",
  { skip: !RUN }, async () => {
    const countQueued = async () => (await db.query(
      `SELECT count(*)::int AS n FROM events WHERE client_id = $1 AND name = 'message.queued'`,
      [clientId]
    )).rows[0].n;

    await db.query(`DELETE FROM events WHERE client_id = $1`, [clientId]);
    await queueReal({ eventId: "emit-evt-1" });
    assert.equal(await countQueued(), 1, "queueing a message should announce it once");

    // The same event again — the message row conflicts into DO NOTHING, so
    // nothing was queued and nothing may be announced.
    await queueReal({ eventId: "emit-evt-1" });
    assert.equal(await countQueued(), 1,
      "a re-queued duplicate announced itself a second time");
  });
