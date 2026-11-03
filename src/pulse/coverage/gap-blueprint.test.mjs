import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CHECK_IDS, REAL_ADVISOR_SQL, MONTHLY_DELIVERY_SQL, COACH_CALL_DELIVERY_SQL, PREPARATION_EVIDENCE_SQL, LETTER_MAILING_SQL, RESPONSE_VALIDATION_SQL, gapChecks } from "./gap-blueprint.mjs";
import { CSM_ASSIGNMENT_EXCEPTION_SOURCE } from "../../blueprint/assign-csm.mjs";
import { MONTHLY_DELIVERY_EXCEPTION_SOURCE } from "../../finance/finance-os-pull-fulfil.mjs";
import { OFFERS } from "../../config/offers.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-20T12:00:00Z");
function dbFor(counts = [0, 0, 0, 0, 0, 0]) {
  const calls = [];
  const allCounts = [...counts, ...Array(Math.max(0, CHECK_IDS.length - counts.length)).fill(0)];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    const value = allCounts[calls.length - 1];
    if (value instanceof Error) throw value;
    return { rows: value === undefined ? [] : [{ n: value }] };
  } };
}

test("Blueprint checks report both broken staff links and failed saved-result delivery red", async () => {
  const db = dbFor([2, 1, 0, 0]);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.deepEqual(out.map((r) => r.id), CHECK_IDS);
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "FAIL", "PASS", "PASS", "PASS", "PASS"]);
  assert.match(out[0].detail, /^2 active paid Blueprint clients linked to a demo, disabled or other-company staff person$/);
  assert.match(out[0].suggestedFix, new RegExp(CSM_ASSIGNMENT_EXCEPTION_SOURCE));
  assert.match(out[1].suggestedFix, /saved credit result/);
  assert.match(out[1].suggestedFix, /Do not request another paid credit pull/);
  assert.equal(db.calls[1].params[1], MONTHLY_DELIVERY_EXCEPTION_SOURCE);
  assert.equal(db.calls[0].params[3], OFFERS.UWIQ_DELIVERABLES.productCode);
  assert.equal(db.calls[0].params[4], PAID_TRANSACTION_STATUS);
  assert.equal(db.calls[0].params[1], NOW.toISOString());
  assert.ok(db.calls.every((call) => call.params[0] === ORG));
});

test("healthy or empty counts pass, but a missing scoped reader skips without queries", async () => {
  assert.deepEqual((await gapChecks({ db: dbFor(), orgId: ORG, now: NOW })).map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
  const db = dbFor();
  assert.deepEqual((await gapChecks({ db, now: NOW })).map((r) => r.status), ["skip", "skip", "skip", "skip", "skip", "skip"]);
  assert.equal(db.calls.length, 0);
  assert.deepEqual((await gapChecks({ orgId: ORG })).map((r) => r.status), ["skip", "skip", "skip", "skip", "skip", "skip"]);
});

test("the existing staff read scope wins over the unscoped pool", async () => {
  const db = dbFor([1, 0, 0, 0]);
  let scopeCalls = 0;
  const out = await gapChecks({ orgId: ORG, now: NOW,
    db: { query() { throw new Error("unscoped pool must not be used"); } },
    scope: async (fn) => { scopeCalls += 1; return fn(db); }
  });
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(scopeCalls, 6);
});

test("failed or malformed reads stay red independently and never expose database error values", async () => {
  for (const invalid of [undefined, null, "", false, true, [], {}, -1, 0.5, "not a number", new Error("secret@example.com customer data")]) {
    const out = await gapChecks({ db: dbFor([invalid, 0, 0, 0]), orgId: ORG, now: NOW });
    assert.deepEqual(out.map((r) => r.status), ["FAIL", "PASS", "PASS", "PASS", "PASS", "PASS"]);
    assert.doesNotMatch(JSON.stringify(out), /secret@example.com|customer data/);
  }
  const out = await gapChecks({ db: dbFor(), orgId: ORG, now: "invalid" });
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "FAIL", "FAIL", "FAIL", "FAIL", "FAIL"]);
});

test("SQL uses actual same-org staff eligibility and paid-period bounds, never task existence as assignment proof", () => {
  assert.match(REAL_ADVISOR_SQL, /t\.org_id = c\.org_id AND t\.client_id = c\.id/);
  assert.match(REAL_ADVISOR_SQL, /s\.org_id = c\.org_id AND s\.client_id = c\.id/);
  assert.match(REAL_ADVISOR_SQL, /s\.org_id = c\.org_id AND s\.id = c\.assigned_csm_staff_id/);
  // Owner-set 2026-10-20: no staff link is the normal AI-CSM state, never red.
  assert.match(REAL_ADVISOR_SQL, /AND c\.assigned_csm_staff_id IS NOT NULL\s+AND NOT EXISTS \(/);
  for (const predicate of ["s.status = 'active'", "s.active = true", "s.is_demo = false", "s.current_period_start <=", "s.current_period_end >"]) {
    assert.ok(REAL_ADVISOR_SQL.includes(predicate), predicate);
  }
  assert.doesNotMatch(REAL_ADVISOR_SQL, /\benabled\b|FROM tasks/);
  assert.match(MONTHLY_DELIVERY_SQL, /c\.org_id = t\.org_id AND c\.id = t\.client_id/);
  assert.match(MONTHLY_DELIVERY_SQL, /t\.done = false/);
  assert.doesNotMatch(MONTHLY_DELIVERY_SQL, /subscriptions|current_period_end/);
  const source = readFileSync(new URL("./gap-blueprint.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b|\bfetch\s*\(|createTask\(|requestSoftPull\(/);
  assert.match(REAL_ADVISOR_SQL, /SELECT count\(\*\)::int AS n/);
  assert.match(MONTHLY_DELIVERY_SQL, /SELECT count\(\*\)::int AS n/);
});

test("stuck or unattributed coach calls stay red without exposing clients or ordering another call", async () => {
  const db = dbFor([0, 0, 2, 0]);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.deepEqual(out.map((r) => r.status), ["PASS", "PASS", "FAIL", "PASS", "PASS", "PASS"]);
  assert.match(out[2].detail, /^2 Blueprint coach-call/);
  assert.match(out[2].suggestedFix, /Do not redial/);
  assert.deepEqual(db.calls[2].params.slice(0, 2), [ORG, NOW.toISOString()]);
  for (const predicate of ["n.step = 5", "n.kind = 'voice_call'", "n.template_key = 'BP-COACH-VOICE'",
    "n.outcome = 'claimed'", "interval '1 hour'", "n.outcome = 'queued'", "m.id = n.message_id",
    "m.org_id = n.org_id", "m.client_id = n.client_id", "m.provider_ref = n.idempotency_key",
    "m.status = 'sent'", "m.provider = 'bland'", "oc.call_id = m.provider_message_id",
    "oc.org_id = m.org_id", "oc.client_id = m.client_id", "t.source_workflow = 'blueprint-coach-call'"]) {
    assert.ok(COACH_CALL_DELIVERY_SQL.includes(predicate), predicate);
  }
  for (const invalid of [undefined, -1, new Error("private@customer.com")]) {
    const failed = await gapChecks({ db: dbFor([0, 0, invalid, 0]), orgId: ORG, now: NOW });
    assert.equal(failed[2].status, "FAIL");
    assert.doesNotMatch(JSON.stringify(failed), /private@customer/);
  }
});

// Actual migrated-table SQL proof is restricted to a local named scratch DB.
const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
function safeScratchConnection(value) {
  try {
    const url = new URL(value), name = url.pathname.slice(1);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      && /^[a-z0-9_-]+$/i.test(name) && /(?:^|[_-])(test|scratch|ci)(?:$|[_-])/i.test(name)
      && !url.search && !url.hash;
  } catch { return false; }
}
safe = safeScratchConnection(connectionString);
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("SQL fixture guard accepts only a named loopback scratch database without connection overrides", () => {
  assert.equal(safeScratchConnection("postgres://127.0.0.1/fundhub_ci"), true);
  for (const value of ["postgres://localhost/production", "postgres://remote.example/fundhub_test", "postgres://localhost/fundhub_test?host=production", "postgres://localhost/production#_test", "https://localhost/fundhub_test"]) assert.equal(safeScratchConnection(value), false);
});

test("actual SQL catches demo/disabled/cross-org staff links and unresolved delivery; an unlinked buyer is the normal AI-CSM state", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of ["clients", "staff", "transactions", "products", "product_aliases", "subscriptions", "tasks", "client_waypoints", "documents", "document_versions", "paid_service_requests", "blueprint_letter_mailing_orders", "blueprint_letter_mailing_envelopes"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const org = randomUUID();
    const client = (await db.query(`INSERT INTO clients (org_id, first_name, email)
      VALUES ($1,'Blueprint','buyer@realcompany.com') RETURNING id`, [org])).rows[0].id;
    await db.query(`INSERT INTO products (org_id, code, name)
      VALUES ($1,$2,'Capital Blueprint')`, [org, OFFERS.UWIQ_DELIVERABLES.productCode]);
    await db.query(`INSERT INTO transactions (org_id,client_id,product_name,status)
      VALUES ($1,$2,'Capital Blueprint',$3)`, [org, client, PAID_TRANSACTION_STATUS]);
    await db.query(`INSERT INTO subscriptions (org_id,client_id,tier,status,current_period_start,current_period_end,effective_from)
      VALUES ($1,$2,'finance-os','active','2026-01-01','2027-01-01','2026-01-01')`, [org, client]);
    const advisor = (await db.query(`INSERT INTO staff (org_id,name,role,status,active,is_demo)
      VALUES ($1,'Real advisor','csm','active',true,false) RETURNING id`, [org])).rows[0].id;
    const run = () => gapChecks({ db, orgId: org, now: NOW });
    assert.equal((await run())[0].status, "PASS", "owner-set 2026-10-20: no staff CSM is normal; AI coaches and team queue cover it");
    await db.query("UPDATE clients SET assigned_csm_staff_id=$2 WHERE id=$1", [client, advisor]);
    assert.equal((await run())[0].status, "PASS");
    for (const change of ["is_demo=true", "active=false", "status='suspended'"]) {
      await db.query(`UPDATE staff SET ${change} WHERE id=$1`, [advisor]);
      assert.equal((await run())[0].status, "FAIL", change);
      await db.query("UPDATE staff SET is_demo=false,active=true,status='active' WHERE id=$1", [advisor]);
    }
    await db.query("UPDATE staff SET org_id=$2 WHERE id=$1", [advisor, randomUUID()]);
    assert.equal((await run())[0].status, "FAIL", "other-org assignment is not real support");
    await db.query("UPDATE transactions SET status='pending' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "unpaid client is outside the paid population");
    await db.query("UPDATE transactions SET status=$2 WHERE client_id=$1", [client, PAID_TRANSACTION_STATUS]);
    await db.query("UPDATE subscriptions SET status='past_due' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "inactive paid access is excluded");
    await db.query("UPDATE subscriptions SET status='active' WHERE client_id=$1", [client]);
    await db.query("UPDATE clients SET is_demo=true WHERE id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "demo buyer excluded");
    await db.query("UPDATE clients SET is_demo=false WHERE id=$1", [client]);
    assert.equal((await gapChecks({ db, orgId: randomUUID(), now: NOW }))[0].status, "PASS");
    await db.query("UPDATE subscriptions SET current_period_end='2026-10-20T12:00:00Z' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "paid-year end is exclusive");
    await db.query(`INSERT INTO tasks (org_id,client_id,title,source_workflow,assignee_role,done)
      VALUES ($1,$2,'Finish delivery',$3,'owner',false)`, [org, client, MONTHLY_DELIVERY_EXCEPTION_SOURCE]);
    assert.equal((await run())[1].status, "FAIL", "delivery remains open after year end");
    assert.equal((await gapChecks({ db, orgId: randomUUID(), now: NOW }))[1].status, "PASS", "other-org delivery is excluded");
    await db.query("UPDATE tasks SET is_demo=true WHERE client_id=$1", [client]);
    assert.equal((await run())[1].status, "PASS", "demo task is excluded");
    await db.query("UPDATE tasks SET is_demo=false WHERE client_id=$1", [client]);
    await db.query("UPDATE tasks SET done=true WHERE client_id=$1", [client]);
    assert.equal((await run())[1].status, "PASS");
    await db.query(`INSERT INTO tasks (org_id,client_id,title,source_workflow,assignee_role,done)
      VALUES ($1,$2,'Reconcile saved AI call','blueprint-coach-call','csm',false)`, [org, client]);
    assert.equal((await run())[2].status, "FAIL", "call attribution exceptions remain visible after access ends");
    assert.equal((await gapChecks({ db, orgId: randomUUID(), now: NOW }))[2].status, "PASS");
    await db.query("UPDATE tasks SET done=true WHERE client_id=$1", [client]);
    assert.equal((await run())[2].status, "PASS");
  } finally { await db.query("ROLLBACK"); db.release(); }
});


test("preparation evidence failures have a scoped daily twin and keep database/customer details private", async () => {
  for (const n of [1, 2, undefined, null, new Error("private@customer.com document-id")]) {
    const db = dbFor([0, 0, 0, n]);
    const out = await gapChecks({ db, orgId: ORG, now: NOW });
    assert.deepEqual(out.map((r) => r.status), ["PASS", "PASS", "PASS", "FAIL", "PASS", "PASS"]);
    assert.equal(out[3].id, "blueprint:preparation-evidence");
    assert.doesNotMatch(JSON.stringify(out), /private@customer|document-id/);
    assert.deepEqual(db.calls[3].params, [ORG, NOW.toISOString(), db.calls[0].params[2], OFFERS.UWIQ_DELIVERABLES.productCode, PAID_TRANSACTION_STATUS]);
    assert.match(out[3].suggestedFix, /reported work separate from reviewed proof/);
  }
});

test("preparation daily evidence keeps reviewed-business precedence with empty upload metadata fallback", () => {
  const canonical = "COALESCE(r.entity_id::text, NULLIF(d.metadata->>'entity_id', ''))";
  assert.equal(PREPARATION_EVIDENCE_SQL.split(canonical).length - 1, 2);
  assert.doesNotMatch(PREPARATION_EVIDENCE_SQL, /COALESCE\(NULLIF\(d\.metadata/);
});

test("actual preparation integrity SQL distinguishes absent work, missing proof and same-client proof", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of ["clients", "transactions", "products", "product_aliases", "entitlements", "documents", "document_vault_reviews"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const org = randomUUID(), foreignOrg = randomUUID(), planId = randomUUID(), documentId = randomUUID();
    const client = (await db.query(`INSERT INTO clients (org_id, first_name, email) VALUES ($1,'Blueprint','buyer@realcompany.com') RETURNING id`, [org])).rows[0].id;
    const otherClient = (await db.query(`INSERT INTO clients (org_id, first_name, email) VALUES ($1,'Other','other@realcompany.com') RETURNING id`, [org])).rows[0].id;
    await db.query(`INSERT INTO products (org_id, code, name) VALUES ($1,$2,'Capital Blueprint')`, [org, OFFERS.UWIQ_DELIVERABLES.productCode]);
    const paid = (await db.query(`INSERT INTO transactions (org_id,client_id,product_name,status,created_at)
      VALUES ($1,$2,'Capital Blueprint',$3,$4) RETURNING id`, [org, client, PAID_TRANSACTION_STATUS, new Date(NOW.getTime() - 86400000)])).rows[0].id;
    await db.query(`INSERT INTO entitlements (org_id,client_id,entitlement_code,source_transaction_id)
      VALUES ($1,$2,'credit-optimization-roadmap',$3)`, [org, client, paid]);
    const base = () => ({ version: 1, targetBusinessCount: 4, businesses: [{ id: planId, formationStatus: "planned",
      entityId: null, evidence: { formation: { documentId }, ein: { documentId: null } } }], stepProgress: [] });
    const setState = async (state) => db.query(`UPDATE clients SET custom_fields = $2::jsonb WHERE id=$1`, [client, JSON.stringify({ blueprint_business_plans: state })]);
    const count = async (scopeOrg = org) => (await db.query(PREPARATION_EVIDENCE_SQL,
      [scopeOrg, NOW.toISOString(), "\\.test$", OFFERS.UWIQ_DELIVERABLES.productCode, PAID_TRANSACTION_STATUS])).rows[0].n;
    assert.equal(await count(), 0, "no saved plan is not a delivery failure");
    for (const empty of [null, {}, [], { businesses: [] }, { businesses: [], stepProgress: [] }, { version: 1, targetBusinessCount: 4, businesses: [], stepProgress: [] }]) {
      await setState(empty);
      assert.equal(await count(), 0, "legacy empty setup and no client work stay healthy");
    }
    await setState(base());
    assert.equal(await count(), 1, "a linked missing document is a real integrity failure");
    await db.query(`INSERT INTO documents (id,org_id,client_id,document_key,kind,subtype,title)
      VALUES ($1,$2,$3,$4,'client_upload','articles_of_organization','Formation proof')`, [documentId, org, otherClient, `formation|${documentId}`]);
    assert.equal(await count(), 1, "a different client's document cannot satisfy the link");
    await db.query(`UPDATE documents SET client_id=$2,org_id=$3 WHERE id=$1`, [documentId, client, foreignOrg]);
    assert.equal(await count(), 1, "a different company's document cannot satisfy the link");
    await db.query(`UPDATE documents SET org_id=$2,subtype='ein_letter' WHERE id=$1`, [documentId, org]);
    assert.equal(await count(), 1, "the wrong document type cannot satisfy formation proof");
    await db.query(`UPDATE documents SET subtype='articles_of_organization' WHERE id=$1`, [documentId]);
    assert.equal(await count(), 0, "a genuine same-client linked upload is intact, not a claim of review or completion");
    await db.query(`UPDATE documents SET metadata='{"entity_id":""}'::jsonb WHERE id=$1`, [documentId]);
    assert.equal(await count(), 0, "empty legacy entity metadata agrees with the actual evidence reader");
    const entityId = randomUUID(), reviewedElsewhere = randomUUID();
    const businessLinked = base();
    businessLinked.businesses[0].entityId = entityId;
    await setState(businessLinked);
    await db.query(`UPDATE documents SET metadata=$2::jsonb WHERE id=$1`, [documentId, JSON.stringify({ entity_id: entityId })]);
    await db.query(`INSERT INTO document_vault_reviews (document_id,org_id,client_id,status,entity_id)
      VALUES ($1,$2,$3,'accepted',$4)`, [documentId, org, client, reviewedElsewhere]);
    assert.equal(await count(), 1, "matching upload metadata cannot override a staff review assigning proof to another business");
    await db.query(`UPDATE documents SET metadata=$2::jsonb WHERE id=$1`, [documentId, JSON.stringify({ entity_id: reviewedElsewhere })]);
    await db.query(`UPDATE document_vault_reviews SET entity_id=$2 WHERE document_id=$1`, [documentId, entityId]);
    assert.equal(await count(), 0, "a matching reviewed business wins over stale upload metadata without a false alarm");
    await db.query(`UPDATE document_vault_reviews SET entity_id=NULL WHERE document_id=$1`, [documentId]);
    assert.equal(await count(), 1, "without a reviewed business, conflicting upload metadata remains an invalid link");
    await db.query(`UPDATE documents SET metadata=$2::jsonb WHERE id=$1`, [documentId, JSON.stringify({ entity_id: entityId })]);
    assert.equal(await count(), 0, "without a reviewed business, matching upload metadata still supplies the link");
    await db.query(`DELETE FROM document_vault_reviews WHERE document_id=$1`, [documentId]);
    await db.query(`UPDATE documents SET metadata='{"entity_id":""}'::jsonb WHERE id=$1`, [documentId]);
    await setState(base());
    const duplicated = base();
    duplicated.businesses.push({ ...duplicated.businesses[0], id: randomUUID() });
    await setState(duplicated);
    assert.equal(await count(), 1, "one proof cannot silently satisfy two separate business plans");
    const orphan = base();
    orphan.stepProgress.push({ stepKey: "formation", businessPlanId: randomUUID(), status: "reported_complete", verification: "client_reported" });
    await setState(orphan);
    assert.equal(await count(), 1, "progress linked to a nonexistent plan is broken");
    const fakeReview = base();
    fakeReview.stepProgress.push({ stepKey: "formation", businessPlanId: planId, status: "reported_complete", verification: "reviewed" });
    await setState(fakeReview);
    assert.equal(await count(), 1, "a client report cannot claim independent proof review");
    await setState({ version: 1, targetBusinessCount: 4, businesses: {}, stepProgress: [] });
    assert.equal(await count(), 1, "malformed saved state is red without unsafe JSON expansion");
    assert.equal(await count(foreignOrg), 0, "another organization's state is excluded");
    await db.query(`UPDATE entitlements SET revoked_at=$2 WHERE client_id=$1`, [client, NOW]);
    assert.equal(await count(), 0, "revoked paid-year scope is not treated as an active buyer");
  } finally { await db.query("ROLLBACK"); db.release(); }
});

test("new daily mail and response failures stay independent and do not expose source data", async () => {
  for (const index of [4, 5]) for (const n of [2, undefined, null, -1, new Error("private@customer.example document-version")]) {
    const counts = [0, 0, 0, 0, 0, 0]; counts[index] = n;
    const db = dbFor(counts), result = await gapChecks({ db, orgId: ORG, now: NOW });
    assert.equal(result[index].status, "FAIL");
    assert.ok(result.every((row, at) => at === index || row.status === "PASS"));
    assert.doesNotMatch(JSON.stringify(result), /private@customer|document-version/);
    assert.deepEqual(db.calls[index].params, [ORG, NOW.toISOString(), db.calls[0].params[2]]);
    assert.match(result[index].suggestedFix, index === 4 ? /Do not repeat a charge or resend/ : /current-version bureau response/);
  }
});

test("mail monitoring binds exact ledger and frozen envelopes while retaining historical mailed versions", () => {
  for (const predicate of ["o.state = 'needs_review'", "interval '15 minutes'", "p.price_total_cents IS DISTINCT FROM 9700", "p.currency IS DISTINCT FROM 'USD'",
    "p.amount_paid_cents IS DISTINCT FROM 9700", "p.payment_ref IS DISTINCT FROM o.provider_payment_ref", "p.produced_kind IS DISTINCT FROM 'letter_mailing_batch'",
    "e.org_id IS DISTINCT FROM o.org_id", "e.client_id IS DISTINCT FROM o.client_id", "v.document_id = d.id AND v.org_id = d.org_id", "v.checksum = e.checksum",
    "v.storage_key = e.snapshot->>'storageKey'", "file->>'versionId' = e.document_version_id::text", "o.state IN ('quoted', 'cancelled', 'mailed')",
    "e.state <> 'accepted'", "NULLIF(btrim(e.provider_id), '') IS NULL", "e.accepted_at IS NULL"]) assert.ok(LETTER_MAILING_SQL.includes(predicate), predicate);
  assert.doesNotMatch(LETTER_MAILING_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
});

test("response monitoring requires current same-scope accepted reader proof instead of an upload label", () => {
  for (const predicate of ["w.state = 'done'", "w.verify_kind = 'bureau_response_upload'", "d.org_id = w.org_id AND d.client_id = w.client_id", "d.kind = 'bureau_response'",
    "d.expires_at > $2::timestamptz", "v->'schema' = '1'::jsonb", "v->>'validator' = 'bureau-response-reader'", "v->>'document_id' = d.id::text",
    "v->>'version_id' = d.current_version_id::text", "v->>'status' = 'accepted'", "v->>'quality' = 'pass'", "v->>'document_type' = 'bureau_response'",
    "v->>'client_match' = 'match'", "v->>'authenticity' = 'clear'", "v->>'bureau' IN ('EX', 'EQ', 'TU')", "v->>'recipient_name'", "v->>'reviewed_at'"]) assert.ok(RESPONSE_VALIDATION_SQL.includes(predicate), predicate);
  assert.doesNotMatch(RESPONSE_VALIDATION_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
});

async function withMonitorFixture(tables, work) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name, new URL(connectionString).pathname.slice(1));
    await db.query("SET LOCAL search_path TO pg_temp, public");
    for (const table of tables) await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    await work(db);
  } finally { await db.query("ROLLBACK"); db.release(); }
}

test("actual mailing SQL distinguishes unpaid work, stale attempts, ledger mismatches and immutable mailed versions", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => withMonitorFixture(["clients", "documents", "document_versions", "paid_service_requests", "blueprint_letter_mailing_orders", "blueprint_letter_mailing_envelopes"], async db => {
  const org = randomUUID(), foreignOrg = randomUUID(), client = randomUUID(), otherClient = randomUUID(), order = randomUUID(), doc = randomUUID(), version = randomUUID(), envelope = randomUUID();
  const checksum = "sha256:" + "a".repeat(64), key = "fixture/blueprint-letter.pdf", payment = "fixture_payment";
  const file = { documentId: doc, versionId: version, checksum, bureau: "EX", storageKey: key };
  const components = amount => JSON.stringify([{ code: "blueprint_letter_mailing_batch", label: "Mail fixture", quantity: 1, unit_cents: amount, amount_cents: amount }]);
  await db.query("INSERT INTO clients(id,org_id,first_name,email) VALUES($1,$2,'Fixture','fixture-buyer@fixture-business.com')", [client, org]);
  await db.query(`INSERT INTO documents(id,org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type,metadata)
    VALUES($1,$2,$3,$4,'deliverable','funding_personal_info','Fixture letter',$5,'application/pdf','{"bureau":"EX"}')`, [doc, org, client, `fixture|${doc}`, key]);
  await db.query(`INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,checksum)
    VALUES($1,$2,$3,1,$4,'application/pdf',$5)`, [version, org, doc, key, checksum]);
  await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [doc, version]);
  await db.query(`INSERT INTO paid_service_requests(id,org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,status,
    price_components,price_total_cents,currency,amount_paid_cents,paid_at,payment_ref)
    VALUES($1,$2,$3,'letter_mailing','client',$4,'paid',$5::jsonb,9700,'USD',9700,$6,$7)`, [order, org, client, randomUUID(), components(9700), NOW, payment]);
  await db.query(`INSERT INTO blueprint_letter_mailing_orders(id,org_id,client_id,quote_version,snapshot,state,payment_state,authorized_at,
    authorized_account_id,authorization_text,confirmation_key,attempt_started_at,provider_payment_ref,paid_at,created_at)
    VALUES($1,$2,$3,$4,$5::jsonb,'mail_pending','paid',$6,$7,'Fixture explicit authorization','fixture_confirmation',$6,$8,$6,$6)`,
    [order, org, client, "a".repeat(64), JSON.stringify({ files: [file] }), NOW, randomUUID(), payment]);
  await db.query(`INSERT INTO blueprint_letter_mailing_envelopes(id,order_id,org_id,client_id,document_id,document_version_id,checksum,bureau,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,'EX',$8::jsonb)`, [envelope, order, org, client, doc, version, checksum, JSON.stringify(file)]);
  const count = async (scopeOrg = org) => (await db.query(LETTER_MAILING_SQL, [scopeOrg, NOW.toISOString(), "\\.test$"])).rows[0].n;
  assert.equal(await count(), 0, "a fresh paid batch waiting for its worker is intact");
  await db.query("UPDATE paid_service_requests SET status='quoted',paid_at=NULL,amount_paid_cents=NULL,payment_ref=NULL WHERE id=$1", [order]);
  await db.query("UPDATE blueprint_letter_mailing_orders SET state='quoted',payment_state='none',paid_at=NULL,provider_payment_ref=NULL WHERE id=$1", [order]);
  assert.equal(await count(), 0, "an unpaid quote is normal client work, not failed delivery");
  await db.query("UPDATE blueprint_letter_mailing_orders SET state='payment_pending',payment_state='charging',attempt_started_at=$2 WHERE id=$1", [order, new Date(NOW.getTime() - 16 * 60_000)]);
  assert.equal(await count(), 1, "an unresolved charge attempt cannot remain healthy after fifteen minutes");
  await db.query("UPDATE blueprint_letter_mailing_orders SET attempt_started_at=$2 WHERE id=$1", [order, NOW]);
  assert.equal(await count(), 0, "a fresh payment attempt retains its grace period");
  await db.query("UPDATE paid_service_requests SET status='paid',paid_at=$2,amount_paid_cents=9700,payment_ref=$3 WHERE id=$1", [order, NOW, payment]);
  await db.query("UPDATE blueprint_letter_mailing_orders SET state='mail_pending',payment_state='paid',paid_at=$2,provider_payment_ref=$3 WHERE id=$1", [order, NOW, payment]);
  await db.query("UPDATE blueprint_letter_mailing_orders SET paid_at=$2 WHERE id=$1", [order, new Date(NOW.getTime() - 16 * 60_000)]);
  assert.equal(await count(), 1, "paid work cannot remain unmailed past its attempt grace");
  await db.query("UPDATE blueprint_letter_mailing_orders SET paid_at=$2,state='needs_review' WHERE id=$1", [order, NOW]);
  assert.equal(await count(), 1, "an explicit review hold stays red immediately");
  await db.query("UPDATE blueprint_letter_mailing_orders SET state='mail_pending' WHERE id=$1", [order]);
  await db.query("UPDATE paid_service_requests SET payment_ref='different_fixture_receipt' WHERE id=$1", [order]);
  assert.equal(await count(), 1, "another receipt cannot satisfy this payment");
  await db.query("UPDATE paid_service_requests SET payment_ref=$2,price_components=$3::jsonb,price_total_cents=9701 WHERE id=$1", [order, payment, components(9701)]);
  assert.equal(await count(), 1, "a priced batch must match exactly $97");
  await db.query("UPDATE paid_service_requests SET price_components=$2::jsonb,price_total_cents=9700 WHERE id=$1", [order, components(9700)]);
  for (const [column, value, restore] of [["client_id", otherClient, client], ["org_id", foreignOrg, org], ["checksum", "sha256:" + "b".repeat(64), checksum]]) {
    await db.query(`UPDATE blueprint_letter_mailing_envelopes SET ${column}=$2 WHERE id=$1`, [envelope, value]);
    assert.equal(await count(), 1, `${column} mismatch cannot prove delivery`);
    await db.query(`UPDATE blueprint_letter_mailing_envelopes SET ${column}=$2 WHERE id=$1`, [envelope, restore]);
  }
  await db.query(`UPDATE blueprint_letter_mailing_envelopes SET state='sending',claim_token=$2,claimed_at=$3 WHERE id=$1`, [envelope, randomUUID(), new Date(NOW.getTime() - 16 * 60_000)]);
  assert.equal(await count(), 1, "an uncertain send claim stays red without a resend");
  await db.query(`UPDATE blueprint_letter_mailing_envelopes SET state='accepted',provider_id='fixture_envelope',accepted_at=$2 WHERE id=$1`, [envelope, NOW]);
  assert.equal(await count(), 0);
  await db.query(`UPDATE paid_service_requests SET status='fulfilled',resolved_at=$2,produced_kind='letter_mailing_batch',produced_ref=$1 WHERE id=$1`, [order, NOW]);
  await db.query("UPDATE blueprint_letter_mailing_orders SET state='mailed' WHERE id=$1", [order]);
  const replacement = randomUUID();
  await db.query(`INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,checksum)
    VALUES($1,$2,$3,2,'fixture/replacement.pdf','application/pdf',$4)`, [replacement, org, doc, "sha256:" + "c".repeat(64)]);
  await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [doc, replacement]);
  assert.equal(await count(), 0, "historical mailed content remains valid after a later regeneration");
  await db.query("UPDATE blueprint_letter_mailing_envelopes SET provider_id='' WHERE id=$1", [envelope]);
  assert.equal(await count(), 1, "mailed status still requires every provider receipt");
  assert.equal(await count(foreignOrg), 0, "another company's records remain outside scope");
  for (const change of ["is_demo=true", "custom_fields='{" + '"synthetic":"true"' + "}'::jsonb", "email='fixture@example.test'"]) {
    await db.query(`UPDATE clients SET ${change} WHERE id=$1`, [client]);
    assert.equal(await count(), 0, "demo, synthetic and fixture email exclusions apply to mailing");
    await db.query("UPDATE clients SET is_demo=false,custom_fields='{}',email='fixture-buyer@fixture-business.com' WHERE id=$1", [client]);
  }
}));

test("actual response SQL refuses unreviewed, stale, held, foreign and expired uploads before a done-step claim", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => withMonitorFixture(["clients", "client_waypoints", "documents", "document_versions"], async db => {
  const org = randomUUID(), foreignOrg = randomUUID(), client = randomUUID(), otherClient = randomUUID(), doc = randomUUID(), version = randomUUID(), waypoint = randomUUID();
  await db.query("INSERT INTO clients(id,org_id,first_name,email) VALUES($1,$2,'Fixture','fixture-buyer@fixture-business.com')", [client, org]);
  await db.query(`INSERT INTO client_waypoints(id,org_id,client_id,key,title,owner_kind,state,completed_at,verify_kind)
    VALUES($1,$2,$3,'blueprint_bureau_response','Upload response','client','done',$4,'bureau_response_upload')`, [waypoint, org, client, NOW]);
  const count = async (scopeOrg = org) => (await db.query(RESPONSE_VALIDATION_SQL, [scopeOrg, NOW.toISOString(), "\\.test$"])).rows[0].n;
  assert.equal(await count(), 1, "done requires actual reviewed evidence");
  await db.query("UPDATE client_waypoints SET state='in_progress',completed_at=NULL WHERE id=$1", [waypoint]);
  assert.equal(await count(), 0, "unfinished client work is not a monitoring failure");
  await db.query("UPDATE client_waypoints SET state='done',completed_at=$2 WHERE id=$1", [waypoint, NOW]);
  await db.query(`INSERT INTO documents(id,org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type)
    VALUES($1,$2,$3,$4,'bureau_response','bureau_letter','Fixture reply','fixture/reply.pdf','application/pdf')`, [doc, org, client, `fixture|${doc}`]);
  await db.query(`INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type)
    VALUES($1,$2,$3,1,'fixture/reply.pdf','application/pdf')`, [version, org, doc]);
  await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [doc, version]);
  assert.equal(await count(), 1, "an upload label and real bytes alone are not a validation");
  const accepted = { schema: 1, validator: "bureau-response-reader", document_id: doc, version_id: version,
    status: "accepted", quality: "pass", document_type: "bureau_response", client_match: "match", authenticity: "clear", bureau: "EX", recipient_name: "Fixture Person", reviewed_at: NOW.toISOString() };
  const validation = async value => db.query("UPDATE documents SET metadata=$2::jsonb WHERE id=$1", [doc, JSON.stringify({ bureau_response_validation: value })]);
  await validation(accepted);
  assert.equal(await count(), 0);
  for (const [field, value] of [["schema", "1"], ["validator", "uploaded_by_client"], ["document_id", randomUUID()], ["version_id", randomUUID()],
    ["status", "request_more"], ["status", "hold"], ["quality", "retake"], ["document_type", "sample"], ["client_match", "mismatch"],
    ["authenticity", "suspected_altered"], ["bureau", "unknown"], ["recipient_name", ""], ["reviewed_at", "not a date"]]) {
    await validation({ ...accepted, [field]: value });
    assert.equal(await count(), 1, `${field} cannot satisfy a completed upload`);
  }
  await validation(accepted);
  for (const [column, value, restore] of [["org_id", foreignOrg, org], ["client_id", otherClient, client], ["expires_at", NOW, null]]) {
    await db.query(`UPDATE documents SET ${column}=$2 WHERE id=$1`, [doc, value]);
    assert.equal(await count(), 1, `${column} invalidates this proof`);
    await db.query(`UPDATE documents SET ${column}=$2 WHERE id=$1`, [doc, restore]);
  }
  const replacement = randomUUID();
  await db.query(`INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type)
    VALUES($1,$2,$3,2,'fixture/reply-replacement.pdf','application/pdf')`, [replacement, org, doc]);
  await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [doc, replacement]);
  assert.equal(await count(), 1, "an accepted prior version cannot validate its unreviewed replacement");
  await validation({ ...accepted, version_id: replacement });
  assert.equal(await count(), 0, "a genuine current-version acceptance satisfies the same-client step");
  await db.query("UPDATE document_versions SET org_id=$2 WHERE id=$1", [replacement, foreignOrg]);
  assert.equal(await count(), 1, "the version row must also belong to the actual document/company");
  assert.equal(await count(foreignOrg), 0);
  await db.query("UPDATE clients SET custom_fields='{" + '"synthetic":"true"' + "}'::jsonb WHERE id=$1", [client]);
  assert.equal(await count(), 0, "synthetic clients do not enter the live proof count");
}));
