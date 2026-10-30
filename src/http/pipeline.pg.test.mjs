// api/dashboard/pipeline.mjs is one generic handler for every pipeline key —
// it looks up whatever `key` the caller asks for against the `pipelines`
// table and was never special-cased to "sales". The frontend (pipeline.html)
// used to call it only for Sales and hardcode "no board yet" for the other
// rails without ever asking the backend, which made the endpoint look
// pipeline-specific when it never was. This proves the non-Sales keys answer
// with real stages and cards through the exact same code path Sales already
// used — same auth, same org scoping, same shape.
//
// affiliates_hiring (R-07) is retired; affiliates_white_label and hiring are
// the replacement rails (migrations 115 and 051).
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import pipeline from "../../api/dashboard/pipeline.mjs";
import { createSession } from "../auth/session.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const asStaff = (token, query) => ({
  method: "GET",
  headers: { authorization: "Bearer " + token },
  query: query || {}
});

// One card per pipeline, dropped into its second stage (index 1) so a bug
// that only checks "the first stage has something" can't pass by accident.
const PIPELINES = [
  { key: "sales",                 name: "Sales Test",                 stages: ["new_lead", "survey_complete", "booked"] },
  { key: "funding_card_stacking", name: "Card Stacking Test",         stages: ["apply_now", "round_submitted", "approved"] },
  { key: "funding_altfin",        name: "Alt-Fin Test",               stages: ["app_created", "docs_stips", "underwriting"] },
  { key: "optimization",          name: "Optimization Test",          stages: ["round_sent", "bureau_processing", "portal_updated"] },
  { key: "inquiry_removal",       name: "Inquiry Removal Test",       stages: ["requested", "specialist_assigned", "calls_in_progress"] },
  { key: "ar_collections",        name: "AR Collections Test",        stages: ["invoice_sent", "reminder", "escalation"] },
  { key: "affiliates_white_label", name: "Affiliates White Label Test", stages: ["recruiting", "invited", "agreement_signed"] },
  { key: "hiring",                name: "Hiring Test",                stages: ["applied", "screening", "group_interview"] }
];

let orgId = null;
let token = null;
let clientId = null;
const pipelineIds = {};
const cardIds = [];

before(async () => {
  if (!HAS_DB) return;

  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('pipeline-endpoints-test', 'Pipeline Endpoints Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'pipeline-endpoints-test@example.test', 'Test Staff', 'owner', 'active')
     RETURNING id`, [orgId])).rows[0].id;
  token = (await createSession(db, { staffId, orgId })).token;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, funded_amount)
     VALUES ($1, 'Pipeline', 'Endpoints', 4200) RETURNING id`, [orgId])).rows[0].id;

  for (const p of PIPELINES) {
    const pipelineId = (await db.query(
      `INSERT INTO pipelines (org_id, key, name) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, p.key, p.name])).rows[0].id;
    pipelineIds[p.key] = pipelineId;

    let secondStageId = null;
    for (let i = 0; i < p.stages.length; i++) {
      const stageId = (await db.query(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, pipelineId, p.stages[i], p.stages[i], i])).rows[0].id;
      if (i === 1) secondStageId = stageId;
    }

    const cardId = (await db.query(
      `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, owner)
       VALUES ($1, $2, $3, $4, 'Test Owner') RETURNING id`,
      [orgId, clientId, pipelineId, secondStageId])).rows[0].id;
    cardIds.push(cardId);
  }
});

after(async () => {
  if (!HAS_DB) return;
  if (clientId) {
    await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
    await db.query(`DELETE FROM conversations WHERE client_id = $1`, [clientId]);
  }
  await db.query(`DELETE FROM cards WHERE id = ANY($1::uuid[])`, [cardIds]);
  await db.query(`DELETE FROM pipeline_stages WHERE pipeline_id = ANY($1::uuid[])`,
    [Object.values(pipelineIds)]);
  await db.query(`DELETE FROM pipelines WHERE id = ANY($1::uuid[])`, [Object.values(pipelineIds)]);
  if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await db.query(`DELETE FROM staff WHERE email = 'pipeline-endpoints-test@example.test'`);
  await db.query(`DELETE FROM orgs WHERE slug = 'pipeline-endpoints-test'`);
  await close();
});

for (const p of PIPELINES) {
  test(`GET /api/dashboard/pipeline?key=${p.key} returns that pipeline's stages and cards`,
    { skip: !HAS_DB }, async () => {
      const res = makeRes();
      await pipeline(asStaff(token, { key: p.key }), res);

      assert.equal(res.statusCode, 200, `${p.key} must return 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.pipeline, p.key);
      assert.equal(res.body.stages.length, p.stages.length,
        `${p.key} must return one column per seeded stage`);

      const withCard = res.body.stages.find((s) => s.count === 1);
      assert.ok(withCard, `${p.key} must have exactly one stage carrying the seeded card`);
      assert.equal(withCard.key, p.stages[1], "the card must be in the stage it was seeded into, not the first one");
      assert.equal(withCard.cards[0].name, "Pipeline Endpoints");
      assert.equal(withCard.cards[0].amount, 4200);

      const empty = res.body.stages.filter((s) => s.count === 0);
      assert.equal(empty.length, p.stages.length - 1,
        "every other stage must still render as an empty column, not disappear");
    });
}

test("Sales cards prefer the next active call, then the latest past call", { skip: !HAS_DB }, async () => {
  const now = Date.now();
  const earlier = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const next = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const later = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  const inserted = (await db.query(
    `INSERT INTO bookings (org_id, client_id, source, starts_at, status)
     VALUES ($1, $2, 'sim', $3, 'booked'),
            ($1, $2, 'sim', $4, 'rescheduled'),
            ($1, $2, 'sim', $5, 'booked')
     RETURNING id`, [orgId, clientId, earlier, next, later]
  )).rows.map((row) => row.id);

  async function cardFor(key) {
    const res = makeRes();
    await pipeline(asStaff(token, { key }), res);
    assert.equal(res.statusCode, 200);
    return res.body.stages.find((stage) => stage.count === 1).cards[0];
  }

  try {
    assert.equal(new Date((await cardFor("sales")).booked_starts_at).toISOString(), next);
    assert.equal((await cardFor("optimization")).booked_starts_at, null);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [inserted[1]]);
    assert.equal(new Date((await cardFor("sales")).booked_starts_at).toISOString(), later);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [inserted[2]]);
    assert.equal(new Date((await cardFor("sales")).booked_starts_at).toISOString(), earlier);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [inserted[0]]);
    assert.equal((await cardFor("sales")).booked_starts_at, null);
  } finally {
    await db.query(`DELETE FROM bookings WHERE id = ANY($1::uuid[])`, [inserted]);
  }
});

test("pipeline cards mark sms/email needs_reply when that person wrote last", { skip: !HAS_DB }, async () => {
  const sms = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now()) RETURNING id`, [orgId, clientId])).rows[0].id;
  const email = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'email', now()) RETURNING id`, [orgId, clientId])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,$3,'inbound','sms','any update?','received'),
            ($1,$2,$4,'outbound','email','thanks','sent')`,
    [orgId, clientId, sms, email]);

  const res = makeRes();
  await pipeline(asStaff(token, { key: "sales" }), res);
  assert.equal(res.statusCode, 200);
  const card = res.body.stages.find((s) => s.count === 1).cards[0];
  assert.equal(card.sms_needs_reply, true);
  assert.equal(card.email_needs_reply, false);
});

/* A BANK SAID YES AND NOBODY HAS SAID HOW MUCH — surfaced on the board.
   Recording an approval with no dollar amount is allowed (owner-set
   2026-08-29): when a bank comes back the fulfillment team often has to ask the
   client or wait for the bank's approval email before they know the limit. It
   is allowed, but it must not rot — until the dollars are in, that approval is
   left out of the round's lender breakdown and no success fee is ever billed
   for it. So the card carries the fact.

   NULL IS UNKNOWN AND STILL SURVIVES — nothing here turns an unknown amount
   into 0 (CLAUDE.md §12).

   REVISED 2026-08-30. This used to say "NULL ONLY", and that was wrong in two
   ways, both of which were live defects on the board:

     * A recorded 0 is not a fact anybody could bill. guardFundedAmount refuses
       the Funded move on NULL OR <= 0, so a legacy 0 was clean on the board and
       blocked at the move — a wall with no warning in front of it.
     * An approval somebody has recorded as NOT COUNTING (the "Doesn't count"
       button, db/migrations/272_approval_excluded.sql, shipped the same day
       this flag did) still said "Amount needed" on its card, forever.

   The flag now reads the same string the biller reads —
   unpricedApprovalConditions() in src/funding/success-fee.mjs — so the board,
   the Funded guard and the invoice cannot drift apart again. Both cases are
   asserted below. */
test("a card flags an approval that has no dollar amount, and a recorded amount clears it",
  { skip: !HAS_DB }, async () => {
    const cardOn = async (key) => {
      const res = makeRes();
      await pipeline(asStaff(token, { key }), res);
      assert.equal(res.statusCode, 200);
      return res.body.stages.find((s) => s.count === 1).cards[0];
    };
    const cardOnBoard = () => cardOn("funding_card_stacking");

    assert.equal((await cardOnBoard()).approval_amount_missing, false,
      "a file with no approvals at all has nothing waiting");

    const roundId = (await db.query(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product)
       VALUES ($1, $2, 1, 'open', 'card_stacking') RETURNING id`,
      [orgId, clientId])).rows[0].id;

    // Approved, amount unknown.
    const appId = (await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status)
       VALUES ($1, $2, $3, 'Mesa Community Bank', 'Approved') RETURNING id`,
      [orgId, roundId, clientId])).rows[0].id;
    assert.equal((await cardOnBoard()).approval_amount_missing, true,
      "the card must say the amount is missing");

    // The amount arrives later. The flag clears.
    await db.query(`UPDATE applications SET approved_amount = 45000 WHERE id = $1`, [appId]);
    assert.equal((await cardOnBoard()).approval_amount_missing, false,
      "once the dollars are recorded the card stops asking");

    // A RECORDED ZERO IS NOT A PRICED APPROVAL. It cannot be invoiced, and
    // guardFundedAmount refuses the Funded move on it, so the board has to say
    // so too or the refusal arrives with no warning in front of it.
    await db.query(`UPDATE applications SET approved_amount = 0 WHERE id = $1`, [appId]);
    assert.equal((await cardOnBoard()).approval_amount_missing, true,
      "a zero cannot be billed, so the card must still ask for the amount");

    // MARKED AS NOT COUNTING — the way out. The bank's yes is untouched; what
    // is recorded is that we are not billing for it. The card must stop asking.
    await db.query(
      `UPDATE applications
          SET approved_amount = NULL,
              approval_excluded_at = now(),
              approval_excluded_by = 'Dana Advisor',
              approval_exclusion_reason = 'client never used it'
        WHERE id = $1`,
      [appId]
    );
    assert.equal((await cardOnBoard()).approval_amount_missing, false,
      "an approval recorded as not counting must stop asking for an amount");
    assert.equal(
      (await db.query(`SELECT status FROM applications WHERE id = $1`, [appId])).rows[0].status,
      "Approved",
      "excluding an approval must not rewrite what the bank said");

    // Undo it and the ask comes straight back.
    await db.query(
      `UPDATE applications
          SET approval_excluded_at = NULL, approval_excluded_by = NULL,
              approval_exclusion_reason = NULL
        WHERE id = $1`,
      [appId]
    );
    assert.equal((await cardOnBoard()).approval_amount_missing, true,
      "reinstating an approval puts it back in the queue");

    // A DENIED bank with no amount is not a missing amount — a denial has none.
    await db.query(`UPDATE applications SET status = 'Denied', approved_amount = NULL WHERE id = $1`, [appId]);
    assert.equal((await cardOnBoard()).approval_amount_missing, false,
      "a denial carries no approved amount and must not be flagged");

    await db.query(`DELETE FROM applications WHERE id = $1`, [appId]);
    await db.query(`DELETE FROM funding_rounds WHERE id = $1`, [roundId]);
  });

/* THE FLAG BELONGS TO THE FUNDING RAIL AND TO THE ROUND SOMEBODY IS WORKING.

   This is now the source of the "Waiting on us" number at the top of
   pipeline.html, so anything the flag over-reports inflates the one figure the
   screen exists to answer. Each case below made the board claim more work than
   actually existed. See the comment above CARDS_SQL's approval_amount_missing
   in api/dashboard/pipeline.mjs. */
test("an approval with no amount is not chased on the wrong rail, the wrong round, or after it was written off",
  { skip: !HAS_DB }, async () => {
    const cardOn = async (key) => {
      const res = makeRes();
      await pipeline(asStaff(token, { key }), res);
      assert.equal(res.statusCode, 200);
      return res.body.stages.find((s) => s.count === 1).cards[0];
    };

    const round1 = (await db.query(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product)
       VALUES ($1, $2, 1, 'closed', 'card_stacking') RETURNING id`,
      [orgId, clientId])).rows[0].id;
    const appId = (await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status)
       VALUES ($1, $2, $3, 'Mesa Community Bank', 'Approved') RETURNING id`,
      [orgId, round1, clientId])).rows[0].id;

    assert.equal((await cardOn("funding_card_stacking")).approval_amount_missing, true,
      "the newest round IS round 1 right now, so it is flagged");

    // THE RAIL. One SQL statement serves all eight boards. The same client's
    // Sales card and Inquiry Removal card used to carry this funding chip,
    // where nobody looking at those boards can do anything about it.
    assert.equal((await cardOn("sales")).approval_amount_missing, false,
      "a funding fact must not leak onto the Sales board");
    assert.equal((await cardOn("inquiry_removal")).approval_amount_missing, false,
      "a funding fact must not leak onto the Inquiry Removal board");

    // THE ROUND. A blank amount left behind in round 1 used to keep flagging
    // through rounds 2 and 3, forever.
    const round2 = (await db.query(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product)
       VALUES ($1, $2, 2, 'open', 'card_stacking') RETURNING id`,
      [orgId, clientId])).rows[0].id;
    assert.equal((await cardOn("funding_card_stacking")).approval_amount_missing, false,
      "round 1's leftover must not follow the client into round 2");

    // And a genuinely blank approval on the round being worked still shows.
    const app2 = (await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status)
       VALUES ($1, $2, $3, 'Second Bank', 'Approved') RETURNING id`,
      [orgId, round2, clientId])).rows[0].id;
    assert.equal((await cardOn("funding_card_stacking")).approval_amount_missing, true,
      "the round being worked is still chased");

    // WRITTEN OFF. Migration 272: somebody recorded, with their name and the
    // time on it, that this approval does not count — withdrawn, or never
    // used. The Client Control Panel has always honoured that and this board
    // did not, so the two screens disagreed about the same client and the
    // board kept asking a question that had already been answered.
    await db.query(
      `UPDATE applications
          SET approval_excluded_at = now(), approval_excluded_by = 'test',
              approval_exclusion_reason = 'never used'
        WHERE id = $1`, [app2]);
    assert.equal((await cardOn("funding_card_stacking")).approval_amount_missing, false,
      "an approval somebody has written off is not still waiting on anybody");

    // Reinstating it puts the question back — the decision is reversible.
    await db.query(`UPDATE applications SET approval_excluded_at = NULL WHERE id = $1`, [app2]);
    assert.equal((await cardOn("funding_card_stacking")).approval_amount_missing, true,
      "putting the approval back in the round puts the chase back too");

    await db.query(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [[appId, app2]]);
    await db.query(`DELETE FROM funding_rounds WHERE id = ANY($1::uuid[])`, [[round1, round2]]);
  });

test("an unknown pipeline key is a 404, not a silent empty board", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline(asStaff(token, { key: "not_a_real_pipeline" }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "unknown_pipeline");
});

test("no credential at all is refused", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline({ method: "GET", headers: {}, query: { key: "sales" } }, res);
  assert.equal(res.statusCode, 401);
});

test("a non-GET method is refused before touching the database", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline({ method: "POST", headers: {}, query: { key: "sales" } }, res);
  assert.equal(res.statusCode, 405);
});
