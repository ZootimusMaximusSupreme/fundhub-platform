// Actual PostgreSQL SQL proof against rollback-only TEMP fixtures. No providers.
// DATABASE_URL must name a loopback test/scratch/CI database. Production is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readBusinessPlans, writeBusinessPlans, BLUEPRINT_PLANS_FIELD } from "./business-plans.mjs";

function safeFixtureUrl(raw) {
  try {
    const u = new URL(raw);
    const database = decodeURIComponent(u.pathname.slice(1));
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
    const namedFixture = /^[a-z0-9_-]+$/i.test(database) && /(?:^|[_-])(?:test|scratch|ci)(?:$|[_-])/i.test(database);
    // pg connection-string query fields can override host/database: accept none.
    return ["postgres:", "postgresql:"].includes(u.protocol) && local && namedFixture && !u.search && !u.hash;
  } catch { return false; }
}
const connectionString = process.env.DATABASE_URL || "";
const fixtureOptions = { skip: connectionString ? false : "No DATABASE_URL: PostgreSQL persistence is NOT PROVED" };
const ORG = "11111111-1111-4111-8111-111111111111", OTHER_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-4222-8222-222222222222", OTHER_CLIENT = "33333333-3333-4333-8333-333333333333", FOREIGN_CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN = "44444444-4444-4444-8444-444444444444", PLAN2 = "55555555-5555-4555-8555-555555555555", PLAN3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", PLAN4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC = "66666666-6666-4666-8666-666666666666", EIN = "77777777-7777-4777-8777-777777777777", ACTUAL_BUSINESS = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-11-02T18:00:00.000Z"), scope = { orgId: ORG, clientId: CLIENT };
const plan = (id = PLAN, extra = {}) => ({ id, name: "Fixture preparation LLC", activity: "Synthetic local cleaning service for this test only.", formationState: "AZ", ...extra });
const bank = (id = DOC, extra = {}) => ({ id, bankName: "Fixture credit union", accountType: "business_checking", status: "planned", plannedOpenOn: "2026-12-01", depositPlanCents: 50000, ...extra });

async function withFixture(fn) {
  assert.equal(safeFixtureUrl(connectionString), true, "Refused DATABASE_URL: use a clean loopback PostgreSQL URL naming a test, scratch or CI database; no connection attempted");
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  let client;
  try {
    client = await pool.connect();
    const connected = (await client.query("SELECT current_database() AS name")).rows[0].name;
    assert.equal(connected, decodeURIComponent(new URL(connectionString).pathname.slice(1)), "Connection database did not match the guarded fixture URL");
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO pg_temp, public");
    for (const sql of [
      `CREATE TEMP TABLE clients (id uuid PRIMARY KEY, org_id uuid NOT NULL, custom_fields jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`,
      `CREATE TEMP TABLE businesses (id uuid PRIMARY KEY, org_id uuid NOT NULL, client_id uuid NOT NULL, name text, age_months integer, entity_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`,
      `CREATE TEMP TABLE documents (id uuid PRIMARY KEY, org_id uuid NOT NULL, client_id uuid NOT NULL, kind text NOT NULL, subtype text, title text, generated_at timestamptz NOT NULL, current_version_id uuid, metadata jsonb NOT NULL DEFAULT '{}') ON COMMIT DROP`,
      `CREATE TEMP TABLE document_vault_reviews (document_id uuid PRIMARY KEY, org_id uuid NOT NULL, client_id uuid NOT NULL, status text NOT NULL, reviewed_at timestamptz NOT NULL, entity_id uuid) ON COMMIT DROP`
    ]) await client.query(sql);
    await client.query(`INSERT INTO pg_temp.clients (id,org_id,custom_fields) VALUES ($1,$2,$3::jsonb),($4,$2,'{}'),($5,$6,'{}')`, [CLIENT, ORG, JSON.stringify({ unrelatedStatus: "keep-original", staffNote: "Fixture staff note stays" }), OTHER_CLIENT, FOREIGN_CLIENT, OTHER_ORG]);
    const tableCount = (await client.query(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = pg_my_temp_schema() AND relname = ANY($1::text[])`, [["clients", "businesses", "documents", "document_vault_reviews"]])).rows[0].n;
    assert.equal(tableCount, 4, "Every store table must be a transaction-local fixture");
    const write = (action, input, selectedScope = scope) => writeBusinessPlans(client, selectedScope, action, input, { now: NOW });
    // Fresh adapter invokes the real reader against SQL again, with no JS state cache.
    const read = () => readBusinessPlans({ query: (...args) => client.query(...args) }, { ...scope, now: NOW });
    const addDoc = async ({ id = DOC, orgId = ORG, clientId = CLIENT, subtype = "articles_of_organization", metadata = {} } = {}) => client.query(`INSERT INTO pg_temp.documents (id,org_id,client_id,kind,subtype,title,generated_at,metadata) VALUES ($1,$2,$3,'client_upload',$4,$5,'2026-11-01T12:00:00Z',$6::jsonb)`, [id, orgId, clientId, subtype, "Fixture " + subtype, JSON.stringify({ original_filename: subtype + ".pdf", ...metadata })]);
    await fn({ client, write, read, addDoc });
  } finally {
    if (client) { try { await client.query("ROLLBACK"); } finally { client.release(); } }
    await pool.end();
  }
}

test("PostgreSQL fixture guard refuses production names, external hosts and URL overrides", () => {
  assert.equal(safeFixtureUrl("postgres://127.0.0.1:5432/fundhub_ci"), true);
  assert.equal(safeFixtureUrl("postgresql://localhost/fundhub_scratch"), true);
  assert.equal(safeFixtureUrl("postgres://[::1]/fundhub_test"), true);
  for (const url of ["postgres://localhost/fundhub", "postgres://db.example.com/fundhub_test", "https://localhost/fundhub_test", "postgres://localhost/fundhub_ci?host=db.example.com", "postgres://localhost/fundhub_ci?dbname=production", "postgres://localhost/production#fundhub_test", "not a url"]) assert.equal(safeFixtureUrl(url), false);
});

test("PG: three then four plans and zero/unknown settings survive a fresh SQL reader", fixtureOptions, async () => withFixture(async ({ write, read }) => {
  await write("save_settings", { targetBusinessCount: 3, started: true, hasExistingBusiness: false, availableCashCents: 0, monthlyIncomeCents: null, homeState: "AZ", postalCode: "85004" });
  for (const id of [PLAN, PLAN2, PLAN3]) await write("save_business", plan(id));
  let saved = await read(); assert.equal(saved.businesses.length, 3); assert.equal(saved.availableCashCents, 0); assert.equal(saved.monthlyIncomeCents, null); assert.equal(saved.hasExistingBusiness, false); assert.equal(saved.startedAt, NOW.toISOString());
  await write("save_settings", { targetBusinessCount: 4 }); await write("save_business", plan(PLAN4));
  saved = await read(); assert.equal(saved.businesses.length, 4); assert.deepEqual(saved.businesses.map(b => b.id), [PLAN, PLAN2, PLAN3, PLAN4]);
  await assert.rejects(write("save_business", plan(DOC)), { code: "business_plan_limit" });
}));

test("PG: each business retains its own reported bank milestones and partial changes", fixtureOptions, async () => withFixture(async ({ client, write, read }) => {
  await write("save_business", plan(PLAN, { bankPreparation: { documentsReady: true, relationships: [bank(DOC, { status: "reported_funded", openedOn: "2026-11-01", depositedOn: "2026-11-02", depositReportedCents: 40000, seasoningDays: 90, nextReviewOn: "2027-01-31" })] } }));
  await write("save_business", plan(PLAN2, { name: "Other fixture LLC", bankPreparation: { relationships: [bank(EIN, { bankName: "Other fixture bank", depositPlanCents: 0 })] } }));
  await write("save_business", { id: PLAN, bankPreparation: { accountOpeningIssue: true } });
  const saved = await read(), first = saved.businesses[0].bankPreparation, second = saved.businesses[1].bankPreparation;
  assert.equal(first.documentsReady, true); assert.equal(first.accountOpeningIssue, true); assert.equal(first.relationships[0].status, "reported_funded"); assert.equal(first.relationships[0].depositReportedCents, 40000); assert.equal(first.relationships[0].seasoningDays, 90);
  assert.equal(second.documentsReady, false); assert.equal(second.relationships[0].status, "planned"); assert.equal(second.relationships[0].depositPlanCents, 0); assert.equal(second.relationships[0].depositReportedCents, null);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_temp.businesses")).rows[0].n, 0, "Preparation must not insert formed companies");
}));

test("PG: unrelated custom fields and saved step notes/dates survive later updates", fixtureOptions, async () => withFixture(async ({ client, write, read }) => {
  await write("save_business", plan());
  await write("save_step", { stepKey: "formation", businessPlanId: PLAN, status: "blocked", note: "Waiting for fixture document review.", targetDate: "2026-12-01" });
  await write("save_settings", { availableCashCents: 120000 });
  await write("save_step", { stepKey: "formation", businessPlanId: PLAN, status: "in_progress" });
  const saved = await read(), row = (await client.query("SELECT custom_fields FROM pg_temp.clients WHERE id=$1", [CLIENT])).rows[0];
  assert.equal(row.custom_fields.unrelatedStatus, "keep-original"); assert.equal(row.custom_fields.staffNote, "Fixture staff note stays"); assert.equal(row.custom_fields[BLUEPRINT_PLANS_FIELD].availableCashCents, 120000);
  assert.equal(saved.stepProgress[0].note, "Waiting for fixture document review."); assert.equal(saved.stepProgress[0].targetDate, "2026-12-01"); assert.equal(saved.stepProgress[0].verification, "client_reported"); assert.equal(saved.businesses[0].evidence.formation.status, "not_added");
}));

test("PG: foreign company/client/business/document references cannot cross the saved scope", fixtureOptions, async () => withFixture(async ({ client, write, read, addDoc }) => {
  await write("save_business", plan());
  await assert.rejects(readBusinessPlans(client, { orgId: OTHER_ORG, clientId: CLIENT }), { code: "client_not_found" });
  await assert.rejects(write("save_settings", { started: true }, { orgId: ORG, clientId: FOREIGN_CLIENT }), { code: "client_not_found" });
  await client.query(`INSERT INTO pg_temp.businesses (id,org_id,client_id,name) VALUES ($1,$2,$3,'Foreign fixture business')`, [ACTUAL_BUSINESS, OTHER_ORG, FOREIGN_CLIENT]);
  await assert.rejects(write("save_business", { id: PLAN, businessId: ACTUAL_BUSINESS }), { code: "business_not_found" });
  await addDoc({ clientId: OTHER_CLIENT });
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC }), { code: "evidence_not_found" });
  await addDoc({ id: EIN, orgId: OTHER_ORG, clientId: FOREIGN_CLIENT });
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: EIN }), { code: "evidence_not_found" });
  assert.equal((await read()).businesses[0].evidence.formation.status, "not_added");
  assert.deepEqual((await client.query("SELECT custom_fields FROM pg_temp.clients WHERE id=$1", [FOREIGN_CLIENT])).rows[0].custom_fields, {});
}));

test("PG: received files become reviewed only from a current same-scope server review", fixtureOptions, async () => withFixture(async ({ client, write, read, addDoc }) => {
  await write("save_business", plan()); await addDoc(); await addDoc({ id: EIN, subtype: "ein_letter" });
  await write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC }); await write("attach_evidence", { businessId: PLAN, kind: "ein", documentId: EIN });
  let saved = await read(); assert.equal(saved.businesses[0].evidence.formation.status, "evidence_received"); assert.equal(saved.businesses[0].evidence.ein.status, "evidence_received");
  await assert.rejects(write("save_business", { id: PLAN, reviewed: true }), { code: "field_not_accepted" });
  await client.query(`INSERT INTO pg_temp.document_vault_reviews (document_id,org_id,client_id,status,reviewed_at) VALUES ($1,$2,$3,'accepted','2026-11-02T10:00:00Z')`, [DOC, ORG, CLIENT]);
  saved = await read(); assert.equal(saved.businesses[0].evidence.formation.status, "reviewed"); assert.equal(saved.businesses[0].evidence.ein.status, "evidence_received");
  await client.query("UPDATE pg_temp.document_vault_reviews SET status='rejected' WHERE document_id=$1", [DOC]); assert.equal((await read()).businesses[0].evidence.formation.status, "rejected");
  await client.query("UPDATE pg_temp.document_vault_reviews SET status='accepted',reviewed_at='2026-10-30T10:00:00Z' WHERE document_id=$1", [DOC]); assert.equal((await read()).businesses[0].evidence.formation.status, "evidence_received");
}));

test("PG: same-ID retries do not duplicate plans and one file cannot prove two businesses", fixtureOptions, async () => withFixture(async ({ client, write, read, addDoc }) => {
  await client.query(`INSERT INTO pg_temp.businesses (id,org_id,client_id,name,age_months,entity_data) VALUES ($1,$2,$3,'Existing fixture business',12,'{}')`, [ACTUAL_BUSINESS, ORG, CLIENT]);
  await write("save_business", plan(PLAN, { businessId: ACTUAL_BUSINESS })); await write("save_business", { id: PLAN, name: "Updated fixture preparation LLC" }); await write("save_business", plan(PLAN2));
  await addDoc(); await write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC });
  await assert.rejects(write("attach_evidence", { businessId: PLAN2, kind: "formation", documentId: DOC }), { code: "evidence_already_linked" });
  const saved = await read(); assert.equal(saved.businesses.length, 2); assert.equal(saved.businesses[0].name, "Updated fixture preparation LLC"); assert.equal(saved.existingBusinesses.length, 1); assert.equal(saved.existingBusinesses[0].id, ACTUAL_BUSINESS); assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_temp.businesses")).rows[0].n, 1);
}));
