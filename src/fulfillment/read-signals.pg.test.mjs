/* THE ROLLUP ARITHMETIC AND THE DEMO FILTER, AGAINST A REAL POSTGRES.
 *
 * COMPLIANCE REVIEW REQUIRED — one of these counts ("Needs Pull") is a claim
 * about who is waiting on a credit pull.
 *
 * WHAT THIS ADDS THAT THE STUB TEST CANNOT.
 * src/http/dashboard-next-action.test.mjs scripts the database, so it proves
 * the endpoints WIRE the derivation correctly but it cannot execute a single
 * line of SQL. Everything below is arithmetic that only Postgres can settle:
 *
 *   * a DEMO credit row must not count as a real pull, in the tile as well as
 *     in the chip (Phase 0 — api/dashboard/clients.mjs's own crs_count has no
 *     is_demo filter, and that bug must not be repeated in new code);
 *   * a DEMO CLIENT must not appear in any tile while Demo Mode is off;
 *   * "Needs Pull" must count only clients whose WRITTEN PERMISSION IS LIVE,
 *     judged by the one consent predicate the pull endpoint itself enforces —
 *     a tile that counts people nobody may pull for contradicts the chip
 *     beside it (GATE A at the number level);
 *   * "Total Prequal" must stay NULL when nothing was recorded, never 0, and
 *     must report how many clients contributed;
 *   * "Ready" must stay NULL because Phase 0 found no honest source for it;
 *   * "Total Approved" must add up the bank approvals on REAL rounds of
 *     funding-tier clients only, and stay NULL when none is recorded (hole 8).
 *
 * SKIPS WITHOUT DATABASE_URL, which is the default. That is why the wiring
 * assertions live in the stub test instead — those must run on every push.
 *
 * ISOLATION. Everything is created inside a throwaway org of its own and torn
 * down in after(), so this cannot see or disturb another suite's rows.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db } from "../db.mjs";
import { listRollups, gatherListSignals, signalsForListRow } from "./read-signals.mjs";
import { deriveNextAction } from "./next-action.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = `fulfillment-read-signals-${process.pid}`;

let orgId = null;
const ids = {};

async function seed() {
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Fulfillment read-signals test') RETURNING id`,
    [SLUG]
  )).rows[0].id;

  const client = async (name, { tier = null, cf = {}, demo = false } = {}) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier, custom_fields, is_demo)
     VALUES ($1, $2, 'Test', $3, $4, $5::jsonb, $6) RETURNING id`,
    [orgId, name, `${name}.${process.pid}@example.test`, tier, JSON.stringify(cf), demo]
  )).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Signals Tester', $2, 'closer', 'active') RETURNING id`,
    [orgId, `signals.${process.pid}@example.test`]
  )).rows[0].id;

  // A — paid for the report, consented, and the ONLY credit row on file is a
  // demo row. Both the tile and the chip must treat that as "no pull yet".
  ids.demoOnly = await client("paidDemoOnly", {
    tier: "FULL_FUNDING",
    cf: { crs_paid: true, total_funding_estimate: 50000 }
  });
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, is_demo) VALUES ($1,$2,'{}'::jsonb,true)`,
    [orgId, ids.demoOnly]
  );
  await db.query(
    `INSERT INTO client_consents
       (org_id, client_id, kind, consent_text, capture_method, granted_name,
        granted_by_kind, granted_by_staff_id, granted_at)
     VALUES ($1,$2,'soft_pull_consent','I agree','typed','Paid Demo','staff',$3, now())`,
    [orgId, ids.demoOnly, staffId]
  );

  // B — paid, and a REAL credit row is in. Not waiting on a pull.
  ids.realPull = await client("paidReal", { tier: "FULL_FUNDING", cf: { crs_paid: true, total_funding_estimate: 40000 } });
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, is_demo) VALUES ($1,$2,'{}'::jsonb,false)`,
    [orgId, ids.realPull]
  );
  /* B also carries a DEMO task and a DEMO funding round. Both belong to a REAL
     client, so no client-level demo filter can hide them — the only thing that
     can is the row-level one. Until it existed, this demo task added a client
     to "Action Needed" and painted a blocker pill with Demo Mode OFF, and this
     demo round's approved amount drove a funding chip. */
  await db.query(
    `INSERT INTO tasks (org_id, client_id, title, done, is_demo)
     VALUES ($1,$2,'Demo task — must never count',false,true)`,
    [orgId, ids.realPull]
  );
  await db.query(
    `INSERT INTO funding_rounds (org_id, client_id, round_number, status, approved_amount, is_demo)
     VALUES ($1,$2,1,'approved',75000.00,true)`,
    [orgId, ids.realPull]
  );

  // C — one open task, so exactly one client is "action needed".
  ids.hasTask = await client("hasTask", { tier: "REPAIR_ONLY" });
  await db.query(
    `INSERT INTO tasks (org_id, client_id, title, done) VALUES ($1,$2,'Do a thing',false)`,
    [orgId, ids.hasTask]
  );

  // D — a DEMO client carrying a large prequal. Must be invisible in every tile.
  ids.demoClient = await client("demoClient", {
    demo: true,
    cf: { crs_paid: true, total_funding_estimate: 999999 }
  });
}

async function wipe() {
  if (!orgId) return;
  await db.query(`DELETE FROM crs_results WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM funding_rounds WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM tasks WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM client_consents WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM staff WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  orgId = null;
}

describe("fulfillment read layer: the tiles and the demo filter (real Postgres)", { skip: !HAS_DB }, () => {
  before(seed);
  after(wipe);

  /* THE NULL THAT EMPTIED BOTH TILES.

     hasFraudAlert compared TRIM(custom_fields->>'round_hold_reason') to
     'Fraud Alert' with no COALESCE. A client with no hold reason - the common
     case - made that NULL, which poisoned the whole OR (false OR NULL OR false
     is NULL), NOT NULL is NULL, and COUNT(*) FILTER silently dropped the row.

     needs_pull and needs_consent are two halves of ONE population, so the tell
     was a client satisfying every term and appearing in NEITHER. Measured
     2026-08-27 on real Postgres: both read 0 with one qualifying client.

     This test states the invariant rather than the arithmetic: every paid,
     unpulled, non-fraud client lands in exactly one of the two counts. A NULL
     anywhere in that predicate makes it fail again. */
  test("a client with no round_hold_reason is not silently dropped from BOTH tiles", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.ok(
      t.needs_pull + t.needs_consent >= 1,
      "paidDemoOnly has no round_hold_reason and qualifies on every other term, " +
      "so it must appear in needs_pull or needs_consent. Zero in both means a NULL " +
      "is poisoning the fraud predicate again — see the COALESCE in read-signals.mjs."
    );
  });

  test("a demo credit row does not make it into the Needs Pull tile", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.equal(t.needs_pull, 1,
      "exactly one client has paid with no REAL credit row. A different number means " +
      "the tile is counting demo credit rows as real pulls (Phase 0's live defect).");
  });

  test("a demo client is invisible while Demo Mode is off", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.equal(t.total_clients, 3, "the demo client was counted as a real one");
    assert.equal(t.total_prequal, "40000",
      "the sample-backed or demo client's prequal was added to the company total");
    assert.equal(t.total_prequal_clients, 1,
      "the screen was not told the whole prequal total came from one client");
  });

  test("Demo Mode on shows the demo client, so the toggle still works", async () => {
    const t = await listRollups(db, { orgId, demoOn: true });
    assert.equal(t.total_clients, 4);
  });

  test("Action Needed counts clients with an open task, not tasks", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.equal(t.action_needed, 1);
  });

  /* THE DEMO FILTER IS ROW-LEVEL, NOT ONLY CLIENT-LEVEL. Both rows below belong
     to a REAL client, so hiding demo CLIENTS does nothing about them. */
  test("a DEMO task does not add a real client to Action Needed", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.equal(t.action_needed, 1,
      "the demo task on a real client was counted. Demo Mode is OFF and the tile " +
      "claimed two clients need action when only one does.");
  });

  test("a DEMO task and a DEMO funding round drive nothing on a real client", async () => {
    const row = (await db.query(
      `SELECT id, custom_fields AS custom_fields_raw, tags AS tags_raw, outcome_tier
         FROM clients WHERE id = $1::uuid`,
      [ids.realPull]
    )).rows[0];
    const batched = await gatherListSignals(db, { orgId, clientIds: [ids.realPull] });
    const signals = signalsForListRow(row, batched.get(String(ids.realPull)));

    assert.deepEqual(signals.tasks, [],
      "a demo task was handed to the derivation as a real one");
    assert.deepEqual(signals.funding_rounds, [],
      "a demo funding round was handed to the derivation as a real one");
    assert.deepEqual(signals.open_blockers, [],
      "a demo task was painted as a blocker pill on a real client with Demo Mode off");

    const derived = deriveNextAction(signals);
    assert.equal(derived.degraded, false,
      "every signal was readable, so the answer must not be degraded");
    assert.notEqual(derived.next_action && derived.next_action.key, "prepare_next_round",
      "a demo round's approved amount drove a funding chip on a real client");
    assert.strictEqual(derived.funding_round, null,
      "a demo round's approved amount was shown as this client's money");
  });

  test("Ready stays null, and Total Approved stays null when the only approval is a demo round", async () => {
    const t = await listRollups(db, { orgId, demoOn: false });
    assert.strictEqual(t.ready, null, "0 would claim nobody is ready; nothing was recorded");
    assert.strictEqual(t.total_approved, null,
      "the only approval on file is B's DEMO round — counting it adds $75,000 nobody approved, " +
      "and 0 would claim nobody was approved");
    assert.strictEqual(t.total_approved_rounds, 0);
    assert.strictEqual(t.funded_rounds_no_approval, 0);
  });

  /* HOLE 8, the live shape. Sim Eight-Funding on 2026-09-17: round 1 funded
     $25,000 with no bank yes, round 2 funded $25,000 with a $10,000 bank yes.
     A REPAIR_ONLY client's round must not reach the total (GATE B). Rows are
     added and removed inside this test so no other test here sees them. */
  test("Total Approved adds real approvals on funding tiers and counts funded rounds with none", async () => {
    const mk = async (name, tier) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier)
       VALUES ($1, $2, 'Test', $3, $4) RETURNING id`,
      [orgId, name, `${name}.${process.pid}@example.test`, tier]
    )).rows[0].id;
    const funded = await mk("twoFundedRounds", "PREMIUM_STACK");
    const repair = await mk("repairOnlyRound", "REPAIR_ONLY");
    try {
      await db.query(
        `INSERT INTO funding_rounds (org_id, client_id, round_number, status, approved_amount, funded_amount)
         VALUES ($1,$2,1,'funded',NULL,25000.00), ($1,$2,2,'funded',10000.00,25000.00),
                ($1,$3,1,'approved',5000.00,NULL)`,
        [orgId, funded, repair]
      );
      const t = await listRollups(db, { orgId, demoOn: false });
      assert.strictEqual(t.total_approved, "10000.00",
        "the $10,000 bank yes was not counted, or the REPAIR_ONLY round's $5,000 or the demo round's $75,000 was");
      assert.strictEqual(t.total_approved_rounds, 1);
      assert.strictEqual(t.funded_rounds_no_approval, 1,
        "round 1 funded with no bank yes on it, and the tile was not told");
    } finally {
      await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1::uuid[])`, [[funded, repair]]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [[funded, repair]]);
    }
  });

  test("no prequal recorded at all stays null, it does not become zero", async () => {
    const empty = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Empty') RETURNING id`,
      [`${SLUG}-empty`]
    )).rows[0].id;
    try {
      const t = await listRollups(db, { orgId: empty, demoOn: false });
      assert.equal(t.total_clients, 0);
      assert.strictEqual(t.total_prequal, null, "unknown money became $0, which is a claim nobody made");
      assert.strictEqual(t.total_prequal_clients, 0);
    } finally {
      await db.query(`DELETE FROM orgs WHERE id = $1`, [empty]);
    }
  });

  test("the chips agree with the tiles, off the same rows", async () => {
    const clientIds = [ids.demoOnly, ids.realPull, ids.hasTask];
    const rows = (await db.query(
      `SELECT id, custom_fields AS custom_fields_raw, tags AS tags_raw, outcome_tier
         FROM clients WHERE id = ANY($1::uuid[])`,
      [clientIds]
    )).rows;
    const signals = await gatherListSignals(db, { orgId, clientIds });
    const chip = {};
    for (const r of rows) {
      const derived = deriveNextAction(signalsForListRow(r, signals.get(String(r.id))));
      assert.equal(derived.degraded, false,
        `every signal for ${r.id} was readable, so the answer must not be degraded`);
      chip[String(r.id)] = derived.next_action && derived.next_action.key;
    }

    assert.equal(chip[ids.demoOnly], "pull_crs",
      "the client whose only credit row is a demo row was not told to pull");
    assert.notEqual(chip[ids.realPull], "pull_crs",
      "a client whose credit is already in was told to pull it again");
    // GATE A: no consent on file, and no credit in, so the answer is permission.
    assert.equal(chip[ids.hasTask], "get_consent",
      "a client with no written permission was not told to get it first");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   GATE A AT THE NUMBER LEVEL.

   "Needs Pull" is a claim about who somebody may pull credit for. Before this
   test the tile asked only "paid, and nothing pulled" — it never looked at
   client_consents — so it counted a strict superset of the clients the chip and
   the pull endpoint will ever allow a pull for. A tile headed "Needs Pull" that
   includes people nobody may pull for contradicts the chip painted beside it.

   Its own org, so the counts here are exactly these four clients and nothing
   another suite created can move them.
   ──────────────────────────────────────────────────────────────────────────── */
let cOrgId = null;
const cIds = {};

async function seedConsent() {
  cOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Fulfillment consent-gate test') RETURNING id`,
    [`${SLUG}-consent`]
  )).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Consent Tester', $2, 'closer', 'active') RETURNING id`,
    [cOrgId, `consent.${process.pid}@example.test`]
  )).rows[0].id;

  // All four have PAID and none has a demo credit row, so the only thing that
  // separates them is written permission and whether the credit is already in.
  const client = async (name) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier, custom_fields)
     VALUES ($1, $2, 'Test', $3, 'FULL_FUNDING', '{"crs_paid": true}'::jsonb) RETURNING id`,
    [cOrgId, name, `${name}.${process.pid}@example.test`]
  )).rows[0].id;

  /* Both timestamps come from the SAME now() in the SAME statement. Taking
     revoked_at from the web server's clock trips client_consents_revoked_after_ck
     whenever the two clocks disagree by a millisecond — which is the reason
     src/consent/index.mjs evaluates validity in SQL in the first place. */
  const consent = async (clientId, { revoked = false } = {}) => db.query(
    `INSERT INTO client_consents
       (org_id, client_id, kind, consent_text, capture_method, granted_name,
        granted_by_kind, granted_by_staff_id, granted_at,
        revoked_at, revoked_reason, revoked_by_kind, revoked_by_staff_id)
     VALUES ($1,$2,'soft_pull_consent','I agree','typed','Consent Tester','staff',$3, now(),
             CASE WHEN $4::boolean THEN now() END,
             CASE WHEN $4::boolean THEN 'client asked us to stop' END,
             CASE WHEN $4::boolean THEN 'staff' END,
             CASE WHEN $4::boolean THEN $3::uuid END)`,
    [cOrgId, clientId, staffId, revoked === true]
  );

  // 1. NO consent row at all. Nobody may pull for them.
  cIds.noConsent = await client("noConsent");

  // 2. Consent given and then TAKEN BACK. Nobody may pull for them either, and
  //    a row existing is not the same as a row being usable.
  cIds.revoked = await client("revokedConsent");
  await consent(cIds.revoked, { revoked: true });

  // 3. Live permission, nothing pulled. THIS IS THE ONLY ONE "Needs Pull".
  cIds.valid = await client("validConsent");
  await consent(cIds.valid);

  // 4. Live permission and the credit is already in. Nothing to pull.
  cIds.validPulled = await client("validPulled");
  await consent(cIds.validPulled);
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, is_demo) VALUES ($1,$2,'{}'::jsonb,false)`,
    [cOrgId, cIds.validPulled]
  );
}

async function wipeConsent() {
  if (!cOrgId) return;
  await db.query(`DELETE FROM crs_results WHERE org_id = $1`, [cOrgId]);
  await db.query(`DELETE FROM client_consents WHERE org_id = $1`, [cOrgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [cOrgId]);
  await db.query(`DELETE FROM staff WHERE org_id = $1`, [cOrgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [cOrgId]);
  cOrgId = null;
}

describe("Needs Pull counts only clients somebody may actually pull for", { skip: !HAS_DB }, () => {
  before(seedConsent);
  after(wipeConsent);

  test("exactly one of the four is Needs Pull — the one with live permission", async () => {
    const t = await listRollups(db, { orgId: cOrgId, demoOn: false });
    assert.equal(t.total_clients, 4, "the fixture did not seed four clients");
    assert.equal(t.needs_pull, 1,
      "Needs Pull must count ONLY the client with live written permission and " +
      "nothing pulled. Any higher number means the tile is counting clients " +
      "nobody may pull credit for, which contradicts the chip beside it.");
  });

  test("the ones with no live permission are counted as waiting on permission", async () => {
    const t = await listRollups(db, { orgId: cOrgId, demoOn: false });
    assert.equal(t.needs_consent, 2,
      "the no-consent client and the revoked-consent client have both paid with " +
      "nothing pulled, so they are waiting on permission — they must not vanish " +
      "from the screen just because they left Needs Pull");
    assert.strictEqual(t.needs_pull + t.needs_consent, 3,
      "the two counts split one population and must not lose or double-count a client");
  });

  test("the tile and the chip give the same answer for every one of the four", async () => {
    const clientIds = [cIds.noConsent, cIds.revoked, cIds.valid, cIds.validPulled];
    const rows = (await db.query(
      `SELECT id, custom_fields AS custom_fields_raw, tags AS tags_raw, outcome_tier
         FROM clients WHERE id = ANY($1::uuid[])`,
      [clientIds]
    )).rows;
    const signals = await gatherListSignals(db, { orgId: cOrgId, clientIds });
    const chip = {};
    for (const r of rows) {
      const derived = deriveNextAction(signalsForListRow(r, signals.get(String(r.id))));
      assert.equal(derived.degraded, false,
        `every signal for ${r.id} was readable, so the answer must not be degraded`);
      chip[String(r.id)] = derived.next_action && derived.next_action.key;
    }

    assert.equal(chip[cIds.noConsent], "get_consent",
      "a client with no written permission must be told to get it, never to pull");
    assert.equal(chip[cIds.revoked], "get_consent",
      "a client who took their permission back must be told to get it again");
    assert.equal(chip[cIds.valid], "pull_crs",
      "the client the tile counted must be the client the chip tells us to pull for");
    assert.notEqual(chip[cIds.validPulled], "pull_crs",
      "a client whose credit is already in was told to pull it again");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   ONE RULE, NOT TWO — THE TILE AND THE CHIP MUST AGREE ON "COMPLETE".

   There are two ways a client's credit can already be in. A real crs_results
   row is one. custom_fields.crs_status = 'Complete' is the other, and the tile
   never tested it. evaluatePullCrs() says NO the moment crs_status is Complete,
   and evaluateGetConsent() says NO too, so "Needs Pull" counted clients that no
   chip would ever be painted on — measured on real Postgres, the tile said 4
   and only 2 of those clients got the chip. A tile that disagrees with the row
   beneath it is worse than no tile.

   Its own org. The counts below are exactly these three clients.
   ──────────────────────────────────────────────────────────────────────────── */
let sOrgId = null;
const sIds = {};

async function seedStatus() {
  sOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Fulfillment crs-status test') RETURNING id`,
    [`${SLUG}-status`]
  )).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Status Tester', $2, 'closer', 'active') RETURNING id`,
    [sOrgId, `status.${process.pid}@example.test`]
  )).rows[0].id;

  // All three PAID, and not one of them has a crs_results row of any kind. The
  // only thing that separates them is crs_status and written permission.
  const client = async (name, cf) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier, custom_fields)
     VALUES ($1, $2, 'Test', $3, 'FULL_FUNDING', $4::jsonb) RETURNING id`,
    [sOrgId, name, `${name}.${process.pid}@example.test`, JSON.stringify(cf)]
  )).rows[0].id;

  const consent = async (clientId) => db.query(
    `INSERT INTO client_consents
       (org_id, client_id, kind, consent_text, capture_method, granted_name,
        granted_by_kind, granted_by_staff_id, granted_at)
     VALUES ($1,$2,'soft_pull_consent','I agree','typed','Status Tester','staff',$3, now())`,
    [sOrgId, clientId, staffId]
  );

  // 1. Nothing pulled and nothing recorded as complete. THIS is Needs Pull.
  sIds.open = await client("statusOpen", { crs_paid: true });
  await consent(sIds.open);

  // 2. The credit is IN, recorded on the client rather than as a result row.
  //    Nobody is waiting on a pull for them.
  sIds.complete = await client("statusComplete", { crs_paid: true, crs_status: "Complete" });
  await consent(sIds.complete);

  // 3. Same, with no written permission. Their credit is in, so they are not
  //    waiting on permission either — they must fall out of BOTH counts.
  sIds.completeNoConsent = await client("statusCompleteNoConsent",
    { crs_paid: true, crs_status: "Complete" });
}

async function wipeStatus() {
  if (!sOrgId) return;
  await db.query(`DELETE FROM client_consents WHERE org_id = $1`, [sOrgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [sOrgId]);
  await db.query(`DELETE FROM staff WHERE org_id = $1`, [sOrgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [sOrgId]);
  sOrgId = null;
}

describe("the tile leaves out a client whose credit is already Complete", { skip: !HAS_DB }, () => {
  before(seedStatus);
  after(wipeStatus);

  test("Needs Pull counts only the client whose credit is not in yet", async () => {
    const t = await listRollups(db, { orgId: sOrgId, demoOn: false });
    assert.equal(t.total_clients, 3, "the fixture did not seed three clients");
    assert.equal(t.needs_pull, 1,
      "Needs Pull must skip a client whose crs_status is already Complete. A " +
      "higher number means the tile is counting clients the chip will never be " +
      "painted on, which is the tile disagreeing with the row beneath it.");
  });

  test("a Complete client is not counted as waiting on permission either", async () => {
    const t = await listRollups(db, { orgId: sOrgId, demoOn: false });
    assert.equal(t.needs_consent, 0,
      "a client whose credit is already in was counted as waiting on written " +
      "permission. Nobody needs permission to pull credit that is already here.");
  });

  test("the tile and the chip give the same answer for every one of the three", async () => {
    const clientIds = [sIds.open, sIds.complete, sIds.completeNoConsent];
    const rows = (await db.query(
      `SELECT id, custom_fields AS custom_fields_raw, tags AS tags_raw, outcome_tier
         FROM clients WHERE id = ANY($1::uuid[])`,
      [clientIds]
    )).rows;
    const signals = await gatherListSignals(db, { orgId: sOrgId, clientIds });
    const chip = {};
    for (const r of rows) {
      const derived = deriveNextAction(signalsForListRow(r, signals.get(String(r.id))));
      assert.equal(derived.degraded, false,
        `every signal for ${r.id} was readable, so the answer must not be degraded`);
      chip[String(r.id)] = derived.next_action && derived.next_action.key;
    }

    assert.equal(chip[sIds.open], "pull_crs",
      "the one client the tile counted must be the one client the chip says to pull for");
    assert.notEqual(chip[sIds.complete], "pull_crs",
      "a client whose credit is already Complete was told to pull it");
    assert.notEqual(chip[sIds.completeNoConsent], "pull_crs",
      "a client whose credit is already Complete was told to pull it");
    assert.notEqual(chip[sIds.completeNoConsent], "get_consent",
      "a client whose credit is already in was told to go and get permission for it");
  });
});
