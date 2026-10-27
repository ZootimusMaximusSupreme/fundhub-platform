// GET /api/read/portal-summary against a real Postgres — the three answers the
// client portal paints its whole screen from.
//
// WHY THIS FILE EXISTS ON TOP OF src/http/portal-stage.test.mjs. That one proves
// portalStage() is a correct ladder over four booleans. It cannot prove the
// booleans are right, and every one of walk findings F33, F34 and F35 was a
// wrong boolean, not a wrong ladder: the pull HAD run, the call HAD happened, a
// $5,000 agreement HAD been signed, and the screen still said "Your call is
// next". So this file writes the real rows into the real tables and asks the
// real endpoint what it now says.
//
// IT LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test glob is
// "src/**" and "scripts/**"; a test placed in api/ is never collected and passes
// forever by never running (CLAUDE.md §12).
//
// THE SESSION IS REAL. requirePrincipal runs against the real account_sessions
// table, so every call carries a token minted for a real row and the "a client
// reads their own file" rule is exercised rather than assumed.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { grant } from "../entitlements/entitlements.mjs";
import handler from "../../api/read/portal-summary.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const CLIENT_EMAIL = "w4b.portal.stage@example.com";
const ACCT_EMAIL = "w4b_portal_stage_acct@example.com";
const STAFF_EMAIL = "w4b_portal_stage_advisor@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/read/portal-summary — stage, advisor, dispute consent",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, token, advisorStaffId;

  /* The client's own read. No client_id in the query — a client principal reads
     the file bound to their session and nothing else. */
  const load = async () => {
    const r = res();
    await handler({ method: "GET", query: {}, headers: { authorization: "Bearer " + token } }, r);
    assert.equal(r.code, 200, "portal summary did not answer 200: " + JSON.stringify(r.body));
    return r.body;
  };

  async function withTriggerOff(table, trigger, run) {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    try {
      await run();
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
  }

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email = $1`, [CLIENT_EMAIL]))
      .rows.map((x) => x.id);
    if (ids.length) {
      await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM call_outcomes WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [ids]);
      /* entitlements (032) and contracts (124) are append-only by trigger. The
         scoped disable/enable is the pattern src/entitlements/entitlements.pg.test.mjs
         already uses for its own fixture rows; nothing outside this file's own
         clients is touched.

         THE try/finally IS THE LOAD-BEARING PART. A throw between the disable
         and the enable leaves the guard OFF for every test that runs after this
         one in the same database, which turns one broken fixture into a suite
         full of failures somebody else has to diagnose. */
      await withTriggerOff("entitlements", "trg_entitlements_no_delete", async () => {
        await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [ids]);
      });
      await withTriggerOff("contracts", "trg_contracts_no_delete", async () => {
        await db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]);
      });
      await db.query(`DELETE FROM accounts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE 'w4b_portal_stage_acct%'`);
    const strays = (await db.query(`SELECT id FROM clients WHERE email LIKE 'w4b.portal.stage%'`)).rows.map((x) => x.id);
    if (strays.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [strays]);
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    if (!HAVE_DB) return;
    org = await resolveDefaultOrg(db);
    await purge();

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Sim','Five-Academy',$2,'{}'::jsonb) RETURNING id`,
      [org, CLIENT_EMAIL])).rows[0].id;

    // 044's accounts_active_needs_hash wants a hash on an active account; this
    // signs in through createAccountSession directly, so it is a placeholder
    // nothing authenticates against.
    const accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
       VALUES ($1,'client',$2,'Sim Five-Academy','active',$3,'scrypt$placeholder') RETURNING id`,
      [org, ACCT_EMAIL, client])).rows[0].id;
    token = (await createAccountSession(db, { accountId, orgId: org })).token;

    advisorStaffId = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1,'Marcus Hale',$2,'funding_advisor','active') RETURNING id`,
      [org, STAFF_EMAIL])).rows[0].id;
  });

  after(async () => {
    if (!HAVE_DB) return;
    await purge();
    await close();
  });

  /* ── F33 · THE STAGE ─────────────────────────────────────────────────────
     One test, walked forward one fact at a time, because the failure was a
     screen that never moved. Each step writes the row a real event writes and
     re-reads the endpoint. */
  test("the stage advances at the pull, the call, the signature and the payment", async () => {
    let s = (await load()).stage;
    assert.equal(s.key, "booked", "a client with nothing on file is before the call");
    assert.equal(s.before_call, true);

    // 1 · THE PULL LANDS. A non-demo crs_results row IS the pull; the screen no
    //     longer waits for a flag to be mirrored onto the client record.
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo)
       VALUES ($1,$2,$3,'FULL_FUNDING',false)`,
      [org, client, JSON.stringify({ scores: { experian: 690 } })]
    );
    /* AND THE TIER LANDS ON THE CLIENT ROW, because that is where every gate
       reads it from — src/finance/crs-pull.mjs persistOutcomeTier() does this
       same UPDATE on any non-simulated pull. Writing it only onto crs_results
       left clients.outcome_tier NULL, which made the F35 assertions below pass
       without ever putting a tier in front of the gate they were testing. */
    await db.query(`UPDATE clients SET outcome_tier = 'FULL_FUNDING' WHERE id = $1`, [client]);
    s = (await load()).stage;
    assert.equal(s.key, "soft_pull");
    assert.equal(s.soft_pull_complete, true);
    assert.equal(s.before_call, false, "after a real pull the screen must stop saying 'before your call'");

    // 2 · THE CALL HAPPENS. A closer typing a disposition is the stronger of the
    //     two witnesses and does not depend on any webhook having fired.
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at, is_demo)
       VALUES ($1,$2,$3,'deposit',0, now(), false)`,
      [org, client, advisorStaffId]
    );
    s = (await load()).stage;
    assert.equal(s.key, "call_held");
    assert.equal(s.call_held, true);

    // 3 · THE AGREEMENT IS SIGNED. This is the exact state the walk photographed
    //     while the screen still read "Your call is next".
    const tpl = (await db.query(
      `SELECT id, template_key FROM contract_templates
        WHERE org_id = $1 AND template_key = 'FUNDING-MASTERY-AGREEMENT' LIMIT 1`, [org])).rows[0];
    assert.ok(tpl, "the seeded Funding Mastery agreement template is missing");
    /* A signed contract row has to satisfy contracts_sent_has_artifact_ck and
       contracts_signature_pair_ck: anything past draft carries a rendered body,
       its hash, a sent time and a signer name. Filling them is not ceremony —
       it is what makes this row the same shape as one a real signature writes. */
    await db.query(
      `INSERT INTO contracts (org_id, client_id, template_id, template_key, title, kind,
                              merge_values, rendered_body, body_sha, sent_at, source_kind,
                              signature_required, status, signed_at, signer_name, created_by, is_demo)
       VALUES ($1,$2,$3,$4,'Funding Mastery Program Agreement','contract',
               '{}'::jsonb, 'Agreement body.', 'sha256:abc123', now(), 'text',
               true, 'signed', now(), 'Sim Five-Academy', $5, false)`,
      [org, client, tpl.id, tpl.template_key, advisorStaffId]
    );
    s = (await load()).stage;
    assert.equal(s.key, "agreement_signed");
    assert.equal(s.agreement_signed, true);
    assert.ok(s.contract_signed_at, "the signed date must come back for the screen to state it");
    assert.equal(s.payment_posted, false, "no money has posted yet and the screen must not say it has");

    // 4 · THE MONEY POSTS.
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, raw_payload, is_demo)
       VALUES ($1,$2,'Funding Mastery', 5000, 'succeeded','test','{}'::jsonb,false)`,
      [org, client]
    );
    s = (await load()).stage;
    assert.equal(s.key, "paid");
    assert.equal(s.payment_posted, true);
  });

  /* ── F35 · WHO MAY BE ASKED TO SIGN ──────────────────────────────────────
     Owner-set 2026-09-03: repair and the funding offer, never courses or
     e-products. The client above owns nothing yet, and the pull above stamped
     FULL_FUNDING onto clients.outcome_tier — which is precisely the trap: a
     course buyer who had a pull must still be refused. */
  test("the dispute-consent gate follows the offer, not the tier", async () => {
    const tierOnFile = async () =>
      (await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [client])).rows[0].outcome_tier;
    assert.equal(await tierOnFile(), "FULL_FUNDING",
      "the tier must actually be on the client row or this test proves nothing");

    let body = await load();
    assert.equal(body.dispute_consent, false, "a client who bought nothing must not be asked to sign");
    assert.equal(body.repair_path, false);

    await grant(db, { orgId: org, clientId: client, code: "funding-mastery-course" });
    body = await load();
    assert.equal(body.dispute_consent, false,
      "a COURSE buyer whose pull said FULL_FUNDING must still be refused — this is F35");

    /* THE SECOND HALF OF F35, and the one that got shipped broken: REPAIR_ONLY.
       The gate used to reach that tier through onRepairPath() and say yes, and
       a real pull writes REPAIR_ONLY onto this column on any client whose file
       grades that way — course buyers included. */
    await db.query(`UPDATE clients SET outcome_tier = 'REPAIR_ONLY' WHERE id = $1`, [client]);
    body = await load();
    assert.equal(body.dispute_consent, false,
      "a COURSE buyer whose pull said REPAIR_ONLY must still be refused — this is F35 too");
    assert.equal(body.repair_path, true,
      "repair_path itself still follows the tier; only the consent gate stopped doing so");
    await db.query(`UPDATE clients SET outcome_tier = 'FULL_FUNDING' WHERE id = $1`, [client]);

    await grant(db, { orgId: org, clientId: client, code: "funding-snapshot" });
    body = await load();
    assert.equal(body.dispute_consent, true, "the funding offer must be able to authorize its own letters");
    assert.equal(body.repair_path, false, "the funding client is still not a repair client");

    await grant(db, { orgId: org, clientId: client, code: "metro2-letter-pack" });
    body = await load();
    assert.equal(body.dispute_consent, true);
    assert.equal(body.repair_path, true, "the repair entitlement is what makes repair_path true");
  });

  /* ── F34 · THE ADVISOR ───────────────────────────────────────────────────
     A name a client is allowed to read, or a plain "nobody yet" — never a guess. */
  test("the advisor is named from the file, or is honestly absent", async () => {
    let body = await load();
    /* NOTHING IN THIS REPOSITORY EVER WRITES AN ADVISOR ASSIGNMENT, so the
       call_outcomes fallback is the only source a real client has. The closer
       above IS a funding_advisor, so this file has one; a client whose only
       logged call was a closer's would still get null, which is the point of
       readAdvisor's third source being role-filtered. */
    assert.ok(body.advisor && body.advisor.name === "Marcus Hale",
      "the funding advisor who logged the call is the advisor on the file");
    assert.equal(body.advisor.source, "call_outcome");
    assert.equal(body.advisor.email, undefined, "no contact details leave this endpoint");

    // A typed name on the client record wins over every derived source.
    await db.query(
      `UPDATE clients SET custom_fields = jsonb_set(COALESCE(custom_fields,'{}'::jsonb),'{advisor_name}', '"Dana Reyes"')
        WHERE id = $1`, [client]);
    body = await load();
    assert.equal(body.advisor.name, "Dana Reyes");
    assert.equal(body.advisor.source, "custom_field");
  });

  test("a client with nobody on the file gets null, not an invented name", async () => {
    const other = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'No','Advisor','w4b.portal.stage.b@example.com','{}'::jsonb) RETURNING id`,
      [org])).rows[0].id;
    const acct = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
       VALUES ($1,'client','w4b_portal_stage_acct_b@example.com','No Advisor','active',$2,'scrypt$placeholder')
       RETURNING id`, [org, other])).rows[0].id;
    const t = (await createAccountSession(db, { accountId: acct, orgId: org })).token;

    const r = res();
    await handler({ method: "GET", query: {}, headers: { authorization: "Bearer " + t } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.advisor, null, "unknown must stay unknown");
    assert.equal(r.body.dispute_consent, false);
    assert.equal(r.body.stage.key, "booked");

    await db.query(`DELETE FROM accounts WHERE client_id = $1`, [other]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [other]);
  });

  test("the client summary carries the sample flag beside an estimate", async () => {
    await db.query(`UPDATE clients SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
      || jsonb_build_object('analyzer_prequal_amount', 410000, 'prequal_sample', true)
      WHERE id = $1`, [client]);
    let body = await load();
    assert.equal(body.prequal_display, "$410,000");
    assert.equal(body.prequal_sample, true);

    await db.query(`UPDATE clients SET custom_fields = custom_fields
      || jsonb_build_object('prequal_sample', false) WHERE id = $1`, [client]);
    body = await load();
    assert.equal(body.prequal_sample, false);
  });
});
