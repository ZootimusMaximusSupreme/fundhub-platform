import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { evaluateLeadOffersIq, getOffersIqStatus } from "./offersiq.mjs";

const SCRATCH_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const ENV = {
  CRS_OFFERSIQ_API_HOST: "mware.crscreditapi.com",
  CRS_OFFERSIQ_API_USERNAME: "synthetic-user",
  CRS_OFFERSIQ_API_PASSWORD: "synthetic-password",
  CRS_OFFERSIQ_RULESET_ID: "752",
  CRS_OFFERSIQ_ALLOW_LIVE: "on",
  ADAPTERS_DRY_RUN: "off"
};
const CONSENT = {
  accepted: true,
  termsUrl: "https://fundhub.ai/terms/#offer-matching",
  consentVersion: "offersiq-2026-11-04",
  consentTimestamp: "2026-11-04T18:00:00.000Z"
};

test("OffersIQ ledger persists one synthetic receipt and shared summary as fundhub_app", {
  skip: !isLocalScratchDatabaseUrl(SCRATCH_URL)
}, async () => {
  const pool = new pg.Pool({ connectionString: SCRATCH_URL });
  const writer = await pool.connect();
  const slug = `offersiq-scratch-${randomUUID()}`;
  let calls = 0;
  try {
    const role = (await writer.query(
      "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
    )).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    await writer.query("BEGIN");
    const orgId = (await writer.query(
      "INSERT INTO orgs(slug,name) VALUES($1,'Synthetic OffersIQ') RETURNING id", [slug]
    )).rows[0].id;
    const foreignOrgId = (await writer.query(
      "INSERT INTO orgs(slug,name) VALUES($1,'Synthetic foreign OffersIQ') RETURNING id", [`${slug}-foreign`]
    )).rows[0].id;
    const staffId = (await writer.query(
      "INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id",
      [orgId]
    )).rows[0].id;
    const fields = {
      unrelated: { keep: true },
      setter_residential_address: {
        line1: "123 Main St", line2: "", city: "Phoenix", state: "AZ", zip: "85001",
        source: "setter_confirmed", confirmed_at: "2026-11-04T17:00:00.000Z",
        confirmed_by_staff_id: staffId
      }
    };
    const clientId = (await writer.query(
      `INSERT INTO clients(org_id,first_name,last_name,phone,email,is_demo,custom_fields)
       VALUES($1,'Pat','Lee','+15551234567',$2,true,$3::jsonb) RETURNING id`,
      [orgId, `offersiq+${randomUUID()}@example.test`, JSON.stringify(fields)]
    )).rows[0].id;
    await writer.query(
      `INSERT INTO tasks(org_id,client_id,title,assignee_role,assignee_staff_id)
       VALUES($1,$2,'Synthetic OffersIQ','setter',$3)`, [orgId, clientId, staffId]
    );
    const staff = { id: staffId, org_id: orgId, role: "setter" };
    const provider = { async evaluateOffersIq({ identity, consent }) {
      calls += 1;
      assert.equal(identity.address.line1, "123 Main St");
      assert.equal(identity.phone, "5551234567");
      assert.equal(consent.accepted, true);
      return { ok: true, status: 200, requestId: randomUUID(), decision: {
        outcome: "matched", decisionStatus: "APPROVED", overallDecision: true,
        requestId: randomUUID(),
        offersIQSummary: { creditScore: 721, totalAccountCount: 12,
          openMortgageDelinquency: false, unknownIdentity: "secret" },
        ruleEvaluation: { ruleSetName: "Synthetic offer", totalConditions: 2,
          passedConditions: 2, failedConditions: 0 }
      } };
    } };
    const opts = { env: ENV, client: provider, now: () => new Date("2026-11-04T18:01:00.000Z") };
    const operationId = randomUUID();
    const first = await evaluateLeadOffersIq(writer, staff,
      { clientId, operationId, consent: CONSENT }, opts);
    assert.equal(first.body.status, "matched");
    assert.equal(first.body.replayed, false);
    const second = await evaluateLeadOffersIq(writer, staff,
      { clientId, operationId: randomUUID(), consent: CONSENT }, opts);
    assert.equal(second.body.replayed, true);
    assert.equal(calls, 1);
    assert.equal((await getOffersIqStatus(writer, staff, { clientId }, { env: ENV })).body.status, "matched");
    const rows = (await writer.query(
      "SELECT * FROM offersiq_requests WHERE org_id=$1 AND client_id=$2", [orgId, clientId]
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].requester_staff_id, staffId);
    assert.equal(rows[0].consent_terms_url, CONSENT.termsUrl);
    assert.equal(rows[0].status, "matched");
    const saved = (await writer.query(
      "SELECT custom_fields FROM clients WHERE id=$1 AND org_id=$2", [clientId, orgId]
    )).rows[0].custom_fields;
    assert.equal(saved.unrelated.keep, true);
    assert.equal(saved.offersiq.credit_score, 721);
    assert.deepEqual(saved.offersiq.offers_iq_summary,
      { creditScore: 721, totalAccountCount: 12, openMortgageDelinquency: false });
    assert.doesNotMatch(JSON.stringify(rows[0]), /unknownIdentity|secret/);

    // The first receipt remains historical if the address changes during a wire.
    const addressB = { ...fields.setter_residential_address, line1: "200 Main St",
      confirmed_at: "2026-11-04T18:01:30.000Z" };
    const addressC = { ...addressB, line1: "300 Main St",
      confirmed_at: "2026-11-04T18:02:00.000Z" };
    await writer.query(
      "UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{setter_residential_address}',$2::jsonb) WHERE id=$1",
      [clientId, JSON.stringify(addressB)]
    );
    const staleOperationId = randomUUID();
    const stale = await evaluateLeadOffersIq(writer, staff,
      { clientId, operationId: staleOperationId, consent: CONSENT }, {
        env: ENV, now: () => new Date("2026-11-04T18:02:30.000Z"),
        client: { async evaluateOffersIq() {
          await writer.query(
            "UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{setter_residential_address}',$2::jsonb) WHERE id=$1",
            [clientId, JSON.stringify(addressC)]
          );
          const receipt = randomUUID();
          return { ok: true, status: 200, requestId: receipt, decision: {
            outcome: "matched", decisionStatus: "APPROVED", requestId: receipt,
            offersIQSummary: { creditScore: 610 }
          } };
        } }
      });
    assert.equal(stale.body.status, "needs_review");
    assert.equal(stale.body.result.stale, true);
    const afterStale = (await writer.query(
      "SELECT custom_fields FROM clients WHERE id=$1", [clientId]
    )).rows[0].custom_fields;
    assert.equal(afterStale.offersiq.credit_score, 721);
    const historical = (await writer.query(
      "SELECT status, normalized_response FROM offersiq_requests WHERE operation_id=$1",
      [staleOperationId]
    )).rows;
    assert.equal(historical.length, 1);
    assert.equal(historical[0].status, "matched");
    assert.equal(historical[0].normalized_response.credit_score, 610);

    // The database itself rejects two pending claims for one lead.
    const claimSql = `INSERT INTO offersiq_requests
      (org_id,client_id,requester_staff_id,operation_id,rule_set_id,environment,
       identity_fingerprint,identity_source,address_confirmed_at,
       consent_terms_url,consent_version,consent_accepted_at,status)
      VALUES($1,$2,$3,$4,752,'production',$5,'setter_confirmed',
             $6,$7,$8,$9,'in_flight')`;
    const claimArgs = [orgId, clientId, staffId, randomUUID(), "a".repeat(64),
      addressC.confirmed_at, CONSENT.termsUrl, CONSENT.consentVersion,
      CONSENT.consentTimestamp];
    await writer.query(claimSql, claimArgs);
    await writer.query("SAVEPOINT second_claim");
    await assert.rejects(
      writer.query(claimSql, [orgId, clientId, staffId, randomUUID(), "b".repeat(64),
        addressC.confirmed_at, CONSENT.termsUrl, CONSENT.consentVersion,
        CONSENT.consentTimestamp]),
      error => error.code === "23505"
    );
    await writer.query("ROLLBACK TO SAVEPOINT second_claim");
    assert.equal((await getOffersIqStatus(writer, { ...staff, org_id: foreignOrgId },
      { clientId }, { env: ENV })).status, 404);
  } finally {
    try {
      await writer.query("ROLLBACK");
      assert.equal(Number((await writer.query(
        "SELECT count(*) AS n FROM orgs WHERE slug=$1 OR slug=$2", [slug, `${slug}-foreign`]
      )).rows[0].n), 0);
    } finally {
      writer.release();
      await pool.end();
    }
  }
});
