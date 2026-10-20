// Real PostgreSQL contract proof. A unique disposable schema holds migration
// 483 plus the existing staff/lenders columns it consumes. No customer rows.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { readOutreach, writeOutreach, schedulePartnerCheckins } from './store.mjs';
import writeHandler from '../../api/bank-outreach.mjs';
import readHandler from '../../api/read/bank-outreach.mjs';

const url = process.env.DATABASE_URL;
const schema = `outreach_test_${randomUUID().replaceAll('-', '')}`;
const facts = { minimum_score: 680, minimum_time_in_business_years: 'unknown', minimum_revenue_threshold: 'unknown', bureaus_pulled: ['EX'], inquiry_tolerance: 'Three inquiries in six months', stated_income: false, eligible_states: ['AZ', 'CA'], application_url: 'https://bank.example/apply', paper_application_url: 'unknown' };

describe('bank outreach disposable PostgreSQL', { skip: !url ? 'no DATABASE_URL: PostgreSQL proof not run' : false }, () => {
  let pool; let db; let org; let otherOrg; let owner; let rep; let secondRep; let otherOwner;
  const write = (staff, body) => writeOutreach(db, { staff, body });
  const read = (staff, query = {}) => readOutreach(db, { staff, query });
  async function target(cert, state = 'AZ') {
    await write(owner, { action: 'import', source: 'fdic', csv: `CERT,NAME,STALP\n${cert},Test Bank ${cert},${state}` });
    return (await db.query(`SELECT * FROM outreach_accounts WHERE org_id=$1 AND external_id=$2 AND state=$3`, [org, String(cert), state])).rows[0];
  }
  async function staffRow(orgId, role) {
    return (await db.query(`INSERT INTO staff(org_id,name,email,role,status) VALUES($1,$2,$3,$4,'active') RETURNING *`, [orgId, role, `${randomUUID()}@example.test`, role])).rows[0];
  }
  async function productReady(a, extra = {}) {
    await write(owner, { action: 'save_contact', account_id: a.id, name: 'Real Banker', email: 'banker@bank.example' });
    return (await write(owner, { action: 'save_product', account_id: a.id, product_name: 'Business card', lender_table: 'OnlineBizCC', facts, evidence: 'Banker email dated 2026-10-19 confirming these terms', ...extra })).product;
  }
  before(async () => {
    const targetUrl = new URL(url);
    assert.ok(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(targetUrl.hostname) || /(?:test|scratch|e2e|_ci)(?:$|[_-])/i.test(targetUrl.pathname.slice(1)), 'Use a local or explicitly named scratch/test database');
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(`CREATE SCHEMA ${schema}`);
    db = {
      query: async (sql, values) => { const c = await db.connect(); try { return await c.query(sql, values); } finally { c.release(); } },
      connect: async () => { const c = await pool.connect(); await c.query(`SET search_path TO ${schema},public`); await c.query(`SET TIME ZONE 'UTC'`); return c; }
    };
    await db.query(`CREATE TABLE orgs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL);
      CREATE TABLE staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),name text NOT NULL,email text,role text,status text,active boolean DEFAULT true);
      CREATE TABLE staff_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),key text NOT NULL,name text NOT NULL,active boolean DEFAULT true);
      CREATE TYPE ${schema}.lender_table AS ENUM ('OnlineBizCC','InBranchBizCC','BizLOC_Stated','BizLOC_Documented','PersonalCC','PersonalLoans','PersonalLOC');
      CREATE TABLE lenders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),lender_table lender_table NOT NULL,name text NOT NULL,product_name text,application_url text,eligible_states text,bureaus_pulled text,stated_requirements text,minimum_time_in_business_years numeric(6,2),minimum_revenue_threshold numeric(14,2),notes text,last_updated_by text,last_updated_date date,active boolean DEFAULT true,updated_at timestamptz DEFAULT now());`);
    org = (await db.query(`INSERT INTO orgs(name) VALUES('Outreach test') RETURNING id`)).rows[0].id;
    otherOrg = (await db.query(`INSERT INTO orgs(name) VALUES('Other outreach test') RETURNING id`)).rows[0].id;
    await db.query(await readFile(new URL('../../db/migrations/483_bank_outreach.sql', import.meta.url), 'utf8'));
    owner = await staffRow(org, 'owner'); rep = await staffRow(org, 'outbound_rep'); secondRep = await staffRow(org, 'outbound_rep'); otherOwner = await staffRow(otherOrg, 'owner');
  });
  after(async () => {
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
  });

  test('migration enables forced RLS with no public/browser grants; history has no app update grant', async () => {
    const tables = (await db.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace=$1::regnamespace AND relname=ANY($2::text[])`, [schema, ['outreach_programs', 'outreach_accounts', 'outreach_contacts', 'outreach_activities', 'outreach_products', 'outreach_assignments']])).rows;
    assert.equal(tables.length, 6); assert.ok(tables.every(t => t.relrowsecurity && t.relforcerowsecurity));
    const browser = (await db.query(`SELECT grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema=$1 AND grantee IN ('PUBLIC','anon','authenticated')`, [schema])).rows;
    assert.deepEqual(browser, []);
    const history = (await db.query(`SELECT privilege_type FROM information_schema.table_privileges WHERE table_schema=$1 AND table_name IN ('outreach_activities','outreach_assignments') AND grantee='fundhub_app' AND privilege_type IN ('UPDATE','DELETE')`, [schema])).rows;
    assert.deepEqual(history, []);
  });
  test('imports are idempotent by canonical institution and state; launch states default', async () => {
    assert.equal((await db.query(`SELECT count(*)::int n FROM staff_roles WHERE key='outbound_rep' AND org_id=ANY($1::uuid[])`, [[org, otherOrg]])).rows[0].n, 2);
    const body = { action: 'import', source: 'fdic', csv: 'CERT,NAME,STALP\n100,Same Bank,AZ\n100,Same Bank,CA\n100,Same Bank,AZ\n101,Other Bank,NY' };
    const first = await write(owner, body); const again = await write(owner, body);
    assert.equal(first.imported, 2); assert.equal(first.skipped, 1); assert.equal(again.imported, 0); assert.equal(again.existing, 2);
    assert.deepEqual(first.program.states, ['AZ', 'SC', 'FL', 'CA']);
    const targets = (await db.query(`SELECT institution_key,state FROM outreach_accounts WHERE external_id='100'`)).rows;
    assert.equal(targets.length, 2); assert.ok(targets.every(t => t.institution_key === 'fdic:100'));
  });
  test('direct store denies unassigned/other-rep/cross-org records, manager actions, stale and forged roles', async () => {
    const a = await target(110);
    assert.equal((await read(rep)).total, 0);
    await assert.rejects(read(rep, { id: a.id }), { statusCode: 404 });
    await assert.rejects(write(rep, { action: 'import', source: 'fdic', csv: 'CERT,NAME,STALP\n120,X,AZ' }), { statusCode: 403 });
    await write(owner, { action: 'assign', id: a.id, staff_id: rep.id });
    assert.equal((await read(rep, { id: a.id })).account.id, a.id);
    await assert.rejects(read(secondRep, { id: a.id }), { statusCode: 404 });
    await assert.rejects(read(otherOwner, { id: a.id }), { statusCode: 404 });
    await assert.rejects(write(owner, { action: 'assign', id: a.id, staff_id: otherOwner.id }), { statusCode: 400 });
    await assert.rejects(write({ ...rep, role: 'owner' }, { action: 'assign', id: a.id, staff_id: rep.id }), { statusCode: 403 });
    await db.query(`UPDATE staff SET status='disabled' WHERE id=$1`, [secondRep.id]);
    await assert.rejects(read(secondRep), { statusCode: 403 });
    await db.query(`UPDATE staff SET status='active' WHERE id=$1`, [secondRep.id]);
    await write(owner, { action: 'assign', id: a.id, staff_id: secondRep.id });
    await assert.rejects(read(rep, { id: a.id }), { statusCode: 404 });
    const history = (await db.query(`SELECT previous_staff_id,assigned_staff_id FROM outreach_assignments WHERE account_id=$1 ORDER BY created_at`, [a.id])).rows;
    assert.equal(history.length, 2); assert.equal(history[1].previous_staff_id, rep.id); assert.equal(history[1].assigned_staff_id, secondRep.id);
  });
  test('touch appends evidence and defaults next work immediately; foreign contact writes roll back', async () => {
    const a = await target(130); const b = await target(131);
    await write(owner, { action: 'assign', id: a.id, staff_id: rep.id });
    const contact = (await write(owner, { action: 'save_contact', account_id: b.id, name: 'Other banker', phone: '5551234567' })).contact;
    const touch = await write(rep, { action: 'log_touch', account_id: a.id, channel: 'call', outcome: 'left_voicemail', note: 'Called banker', next_action: 'Call again' });
    assert.equal(touch.account.next_action, 'Call again'); assert.ok(new Date(touch.account.next_due_at).getTime() <= Date.now());
    await assert.rejects(write(rep, { action: 'log_touch', account_id: a.id, contact_id: contact.id, channel: 'email', outcome: 'sent', next_action: 'Reply' }), { statusCode: 404 });
    assert.equal((await read(rep, { id: a.id })).activities.length, 1);
    await assert.rejects(write(rep, { action: 'log_touch', account_id: a.id, channel: 'call', outcome: 'called' }), { statusCode: 400 });
    assert.equal((await read(rep, { id: a.id })).activities.length, 1);
  });
  test('verification requires real facts/evidence/banker/path, promotes once, preserves unknown and updates its own row', async () => {
    const a = await target(140); const product = await productReady(a);
    const saved = await write(owner, { action: 'verify_product', id: product.id });
    const lender = (await db.query(`SELECT * FROM lenders WHERE id=$1`, [saved.lender_id])).rows[0];
    assert.equal(lender.name, a.name); assert.equal(lender.product_name, 'Business card'); assert.equal(lender.application_url, facts.application_url);
    assert.equal(lender.minimum_time_in_business_years, null); assert.equal(lender.minimum_revenue_threshold, null); assert.match(lender.stated_requirements, /680/); assert.match(lender.stated_requirements, /Stated income: no/);
    await write(owner, { action: 'verify_product', id: product.id });
    assert.equal((await db.query(`SELECT count(*)::int n FROM lenders WHERE id=$1`, [saved.lender_id])).rows[0].n, 1);
    const edit = await write(owner, { action: 'save_product', id: product.id, account_id: a.id, product_name: 'Business card updated', lender_table: 'OnlineBizCC', facts: { ...facts, minimum_score: 700 }, evidence: 'Updated banker terms' });
    assert.ok(edit.product.verified_at); assert.equal(edit.product.product_name, 'Business card'); assert.equal(edit.product.draft.product_name, 'Business card updated');
    assert.equal((await db.query(`SELECT product_name FROM lenders WHERE id=$1`, [saved.lender_id])).rows[0].product_name, 'Business card');
    await write(owner, { action: 'verify_product', id: product.id });
    const updated = (await db.query(`SELECT * FROM lenders WHERE id=$1`, [saved.lender_id])).rows[0];
    assert.equal(updated.product_name, 'Business card updated'); assert.match(updated.stated_requirements, /700/);
    const approved = (await db.query(`SELECT * FROM outreach_products WHERE id=$1`, [product.id])).rows[0];
    assert.equal(approved.draft, null); assert.equal(approved.first_verified_at.toISOString(), saved.product.first_verified_at.toISOString());
    const audit = (await db.query(`SELECT note FROM outreach_activities WHERE account_id=$1 AND outcome='product_verified' ORDER BY created_at DESC LIMIT 1`, [a.id])).rows[0];
    const snapshot = JSON.parse(audit.note).previous_verified;
    assert.equal(snapshot.product.facts.minimum_score, 680); assert.equal(snapshot.lender.product_name, 'Business card');
    const bad = await target(141); const p = (await write(owner, { action: 'save_product', account_id: bad.id, product_name: 'Incomplete', lender_table: 'PersonalLOC', facts: {}, evidence: '' })).product;
    await assert.rejects(write(owner, { action: 'verify_product', id: p.id }), { statusCode: 400 });
    await write(owner, { action: 'assign', id: a.id, staff_id: rep.id });
    await assert.rejects(write(rep, { action: 'verify_product', id: product.id }), { statusCode: 403 });
    await assert.rejects(write(rep, { action: 'save_product', id: product.id, account_id: a.id, product_name: 'Rep overwrite', lender_table: 'OnlineBizCC', facts, evidence: 'Unapproved change' }), { statusCode: 403 });
  });
  test('promotion rollback leaves no lender when downstream save fails; name alone never links', async () => {
    const a = await target(150); const p = await productReady(a);
    const original = (await db.query(`INSERT INTO lenders(org_id,lender_table,name,product_name) VALUES($1,'OnlineBizCC',$2,'Existing unrelated') RETURNING id`, [org, a.name])).rows[0];
    const beforeCount = (await db.query(`SELECT count(*)::int n FROM lenders`)).rows[0].n;
    const broken = {
      connect: async () => { const c = await db.connect(); return { release: () => c.release(), query: (sql, values) => /UPDATE outreach_products SET lender_id/.test(sql) ? Promise.reject(new Error('injected saved-result failure')) : c.query(sql, values) }; }
    };
    await assert.rejects(writeOutreach(broken, { staff: owner, body: { action: 'verify_product', id: p.id } }), /injected saved-result failure/);
    assert.equal((await db.query(`SELECT count(*)::int n FROM lenders`)).rows[0].n, beforeCount);
    assert.equal((await db.query(`SELECT verified_at FROM outreach_products WHERE id=$1`, [p.id])).rows[0].verified_at, null);
    const result = await write(owner, { action: 'verify_product', id: p.id });
    assert.notEqual(result.lender_id, original.id);
    assert.equal((await db.query(`SELECT product_name FROM lenders WHERE id=$1`, [original.id])).rows[0].product_name, 'Existing unrelated');
  });
  test('cross-org lender/contact references fail and manager-selected same-org row is explicit', async () => {
    const a = await target(160); const otherLender = (await db.query(`INSERT INTO lenders(org_id,lender_table,name) VALUES($1,'OnlineBizCC','Other org') RETURNING id`, [otherOrg])).rows[0];
    await assert.rejects(productReady(a, { lender_id: otherLender.id }), { statusCode: 400 });
    const ownLender = (await db.query(`INSERT INTO lenders(org_id,lender_table,name) VALUES($1,'OnlineBizCC','Manager selected') RETURNING id`, [org])).rows[0];
    const p = await productReady(a, { lender_id: ownLender.id });
    const result = await write(owner, { action: 'verify_product', id: p.id });
    assert.equal(result.lender_id, ownLender.id);
    const otherProgram = (await write(otherOwner, { action: 'import', source: 'ncua', csv: 'CU_NUMBER,CU_NAME,STATE\n600,Other CU,FL' })).program;
    await assert.rejects(db.query(`INSERT INTO outreach_accounts(org_id,program_id,source,external_id,institution_key,name,state) VALUES($1,$2,'ncua','601','ncua:601','Cross org','FL')`, [org, otherProgram.id]), { code: '23503' });
  });
  test('calendar check-ins are monthly/quarterly, idempotent and preserve deliberately scheduled work', async () => {
    const active = await target(170); const quiet = await target(171);
    for (const a of [active, quiet]) { const p = await productReady(a); await write(owner, { action: 'verify_product', id: p.id }); }
    await db.query(`UPDATE outreach_accounts SET next_action=NULL,next_due_at=NULL,last_partner_checkin_at='2026-01-31T12:00:00Z',partner_activity=CASE WHEN id=$1 THEN 'quiet' ELSE 'active' END WHERE id=ANY($2::uuid[])`, [quiet.id, [active.id, quiet.id]]);
    assert.equal((await schedulePartnerCheckins(db, { now: '2026-02-01T12:00:00Z' })).scheduled, 2);
    const rows = (await db.query(`SELECT id,next_due_at FROM outreach_accounts WHERE id=ANY($1::uuid[]) ORDER BY id`, [[active.id, quiet.id]])).rows;
    assert.equal(new Date(rows.find(r => r.id === active.id).next_due_at).toISOString(), '2026-02-28T12:00:00.000Z');
    assert.equal(new Date(rows.find(r => r.id === quiet.id).next_due_at).toISOString(), '2026-04-30T12:00:00.000Z');
    assert.equal((await schedulePartnerCheckins(db, { now: '2026-02-02T12:00:00Z' })).scheduled, 0);
  });
  test('concurrent verification shares one promoted row; incomplete amendment leaves published facts and KPI intact', async () => {
    const a = await target(175); const p = await productReady(a);
    const results = await Promise.all([write(owner, { action: 'verify_product', id: p.id }), write(owner, { action: 'verify_product', id: p.id })]);
    assert.equal(results[0].lender_id, results[1].lender_id);
    assert.equal((await db.query(`SELECT count(*)::int n FROM lenders WHERE name=$1`, [a.name])).rows[0].n, 1);
    const summary = (await read(owner)).summary;
    await write(owner, { action: 'save_product', id: p.id, account_id: a.id, product_name: 'Incomplete amendment', lender_table: 'OnlineBizCC', facts: {}, evidence: 'tbd' });
    await assert.rejects(write(owner, { action: 'verify_product', id: p.id }), { statusCode: 400 });
    const detail = await read(owner, { id: a.id });
    assert.equal(detail.products[0].product_name, 'Business card'); assert.equal(detail.products[0].facts.minimum_score, 680); assert.ok(detail.products[0].verified_at);
    assert.equal((await db.query(`SELECT product_name FROM lenders WHERE id=$1`, [results[0].lender_id])).rows[0].product_name, 'Business card');
    assert.equal((await read(owner)).summary.verified_products_week, summary.verified_products_week);
    await assert.rejects(write(owner, { action: 'save_product', id: p.id, account_id: a.id, product_name: 'Wrong category', lender_table: 'PersonalCC', facts, evidence: 'Banker terms' }), { statusCode: 400 });
  });
  test('real HTTP handlers save the rep journey through manager verification and enforce both ownership boundaries', async () => {
    async function http(staff, method, payload) {
      const apiDb = {
        connect: db.connect,
        query: async (sql, values) => {
          if (/FROM live JOIN staff/.test(sql)) return { rows: [{ session_id: randomUUID(), expires_at: new Date(Date.now() + 3600000), staff_id: staff.id, org_id: staff.org_id, role: staff.role, email: staff.email, name: staff.name, status: 'active', active_flag: 'true' }] };
          return db.query(sql, values);
        }
      };
      const req = { method, url: method === 'GET' ? '/api/read/bank-outreach' : '/api/bank-outreach', headers: { authorization: 'Bearer test-session-only' }, ...(method === 'GET' ? { query: payload } : { body: payload }) };
      const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await (method === 'GET' ? readHandler : writeHandler)(req, res, { db: apiDb });
      return res;
    }
    const a = await target(180);
    assert.equal((await http(owner, 'POST', { action: 'assign', id: a.id, staff_id: rep.id })).statusCode, 200);
    const touched = await http(rep, 'POST', { action: 'log_touch', account_id: a.id, channel: 'linkedin', outcome: 'banker_replied', note: 'Banker offered business card terms', next_action: 'Save product terms' });
    assert.equal(touched.statusCode, 200); assert.equal(touched.body.account.next_action, 'Save product terms');
    assert.equal((await http(rep, 'POST', { action: 'save_contact', account_id: a.id, name: 'HTTP Banker', email: 'http-banker@bank.example' })).statusCode, 200);
    const draft = await http(rep, 'POST', { action: 'save_product', account_id: a.id, product_name: 'HTTP Business Card', lender_table: 'OnlineBizCC', facts, evidence: 'Banker email confirming terms and application link' });
    assert.equal(draft.statusCode, 200); assert.equal(draft.body.product.verified_at, null);
    assert.equal((await http(rep, 'POST', { action: 'verify_product', id: draft.body.product.id })).statusCode, 403);
    const verified = await http(owner, 'POST', { action: 'verify_product', id: draft.body.product.id });
    assert.equal(verified.statusCode, 200); assert.ok(verified.body.product.verified_at);
    const saved = await http(rep, 'GET', { id: a.id });
    assert.equal(saved.statusCode, 200); assert.equal(saved.body.products[0].lender_id, verified.body.lender_id); assert.equal(saved.body.account.status, 'verified_partner');
    const lender = (await db.query(`SELECT * FROM lenders WHERE id=$1`, [verified.body.lender_id])).rows[0];
    assert.equal(lender.product_name, 'HTTP Business Card'); assert.equal(lender.org_id, org);
    assert.equal((await http(secondRep, 'GET', { id: a.id })).statusCode, 404);
    assert.equal((await http(otherOwner, 'GET', { id: a.id })).statusCode, 404);
    assert.equal((await http(secondRep, 'POST', { action: 'log_touch', account_id: a.id, channel: 'note', outcome: 'guessed', next_action: 'Read' })).statusCode, 404);
    assert.equal((await http(otherOwner, 'POST', { action: 'save_product', account_id: a.id, product_name: 'Cross org overwrite', lender_table: 'OnlineBizCC', facts, evidence: 'x' })).statusCode, 404);
  });
  test('migration repeat keeps schema and staff catalog idempotent', async () => {
    await db.query(await readFile(new URL('../../db/migrations/483_bank_outreach.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query(`SELECT count(*)::int n FROM staff_roles WHERE key='outbound_rep' AND org_id=ANY($1::uuid[])`, [[org, otherOrg]])).rows[0].n, 2);
    const p = (await db.query(`INSERT INTO outreach_programs(org_id,key) VALUES($1,'future_relationships') RETURNING key`, [org])).rows[0];
    assert.equal(p.key, 'future_relationships');
  });
});
