import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { persistOffersIqLeadSort } from "./offersiq-lead-sort-store.mjs";

const URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

test("sort storage preserves the paid receipt/cache and rejects partial, invalid and wrong-org writes", {
  skip: !isLocalScratchDatabaseUrl(URL)
}, async () => {
  const pool = new pg.Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const role = (await db.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    const org = (await db.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic sort') RETURNING id", [`offersiq-sort-${randomUUID()}`])).rows[0].id;
    const staff = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id", [org])).rows[0].id;
    const cache = { offersiq: { outcome: "matched", marker: "original" }, keep: true };
    const client = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo,custom_fields) VALUES($1,'Synthetic','Sort',true,$2::jsonb) RETURNING id", [org, JSON.stringify(cache)])).rows[0].id;
    const summary = { outcome: "matched", rule_set_id: 1232, environment: "sandbox",
      identity_fingerprint: "a".repeat(64), request_id: randomUUID(), checked_at: "2026-11-06T18:00:00Z" };
    const id = (await db.query(`INSERT INTO offersiq_requests(org_id,client_id,requester_staff_id,operation_id,
      rule_set_id,environment,identity_fingerprint,identity_source,address_confirmed_at,
      consent_terms_url,consent_version,consent_accepted_at,status,normalized_response,provider_request_id,finished_at)
      VALUES($1,$2,$3,$4,1232,'sandbox',$5,'setter_confirmed',now(),'https://example.test/terms','synthetic',now(),
      'matched',$6::jsonb,$7,now()) RETURNING id`, [org, client, staff, randomUUID(), summary.identity_fingerprint,
      JSON.stringify(summary), summary.request_id])).rows[0].id;
    const result = await persistOffersIqLeadSort(db, id, org, summary);
    assert.equal(result.bucket, "can_not_tell");
    const changed = { ...summary, request_id: randomUUID(), reason: "INSUFFICIENT_DATA", outcome: "needs_review" };
    await persistOffersIqLeadSort(db, id, org, changed, { reevaluated: true });
    const stored = (await db.query("SELECT * FROM offersiq_requests WHERE id=$1 AND org_id=$2", [id, org])).rows[0];
    assert.deepEqual(stored.normalized_response, summary);
    assert.deepEqual(stored.lead_sort_receipt, changed);
    assert.equal(stored.provider_request_id, summary.request_id);
    assert.equal(stored.status, "matched");
    assert.deepEqual((await db.query("SELECT custom_fields FROM clients WHERE id=$1", [client])).rows[0].custom_fields, cache);
    await assert.rejects(persistOffersIqLeadSort(db, id, randomUUID(), summary), /changed_or_missing/);
    await assert.rejects(persistOffersIqLeadSort(db, id, org, { ...summary, identity_fingerprint: "b".repeat(64) }), /changed_or_missing/);
    for (const assignment of ["lead_sort_points=101", "lead_sort_bucket='invented'", "lead_sort_version=NULL", "lead_sort_reasons='{}'::jsonb", "lead_sort_result='{}'::jsonb"]) {
      await db.query("SAVEPOINT bad_sort");
      await assert.rejects(db.query(`UPDATE offersiq_requests SET ${assignment} WHERE id=$1`, [id]), error => error.code === "23514");
      await db.query("ROLLBACK TO SAVEPOINT bad_sort");
    }
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
    await pool.end();
  }
});
