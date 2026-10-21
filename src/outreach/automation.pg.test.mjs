// Real PostgreSQL proof for the automatic half of bank outreach (495).
// A unique disposable schema holds 483 + 495 and the few existing columns they
// read (staff, lenders, messages, message_templates, agents). No customer rows,
// no network: the search engine and the model are fakes passed in.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { readOutreach, writeOutreach } from './store.mjs';
import { searchSweep, sequenceSweep } from './automation.mjs';
import { recordBankerReply, processReplies } from './replies.mjs';
import { gapChecks } from '../pulse/coverage/gap-bank-outreach.mjs';

const url = process.env.DATABASE_URL;
const schema = `outreach_auto_${randomUUID().replaceAll('-', '')}`;
const ENV = { BANK_OUTREACH_FROM: 'Fundhub Bank Partnerships <partners@fundhub.ai>', BANK_OUTREACH_POSTAL_ADDRESS: '100 Test Street, Phoenix, AZ 85001', RESEND_REPLY_TO_DOMAIN: 'reply.example.org', UNSUBSCRIBE_TOKEN_SECRET: 's'.repeat(40), APP_BASE_URL: 'https://fundhub.ai' };
const WED = new Date('2026-11-04T16:00:00Z'); // Wednesday 09:00 Arizona
const at = (base, days) => new Date(base.getTime() + days * 86400000);

describe('bank outreach automation on disposable PostgreSQL', { skip: !url ? 'no DATABASE_URL: PostgreSQL proof not run' : false }, () => {
  let pool; let db; let org; let owner; let rep; let otherRep;
  const write = (staff, body) => writeOutreach(db, { staff, body });
  const read = (staff, query = {}) => readOutreach(db, { staff, query, env: ENV });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  async function target(cert, state = 'AZ') {
    await write(owner, { action: 'import', source: 'fdic', csv: `CERT,NAME,STALP\n${cert},Test Bank ${cert},${state}` });
    return one(`SELECT * FROM outreach_accounts WHERE org_id=$1 AND external_id=$2 AND state=$3`, [org, String(cert), state]);
  }
  async function banker(account, email, name = 'Real Banker') {
    return (await write(owner, { action: 'save_contact', account_id: account.id, name, email })).contact;
  }
  const leadResult = (name, cert) => ({ title: `${name} - Vice President - Test Bank ${cert} | LinkedIn`, link: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}-${cert}`, snippet: `Vice President at Test Bank ${cert}. Phoenix, Arizona` });

  before(async () => {
    const targetUrl = new URL(url);
    assert.ok(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(targetUrl.hostname) || /(?:test|scratch|e2e|_ci)(?:$|[_-])/i.test(targetUrl.pathname.slice(1)), 'Use a local or explicitly named scratch/test database');
    pool = new pg.Pool({ connectionString: url, max: 4 });
    assert.ok((await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='fundhub_app' AND NOT rolsuper AND NOT rolbypassrls`)).rows.length, 'Apply migration 104 to provide the real unprivileged application role');
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO fundhub_app`);
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON TABLES TO fundhub_app`);
    db = {
      query: async (sql, values) => { const c = await db.connect(); try { return await c.query(sql, values); } finally { c.release(); } },
      connect: async () => { const c = await pool.connect(); await c.query(`SET search_path TO ${schema},public`); await c.query(`SET TIME ZONE 'UTC'`); return c; }
    };
    await db.query(`CREATE TABLE orgs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL);
      CREATE TABLE staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),name text NOT NULL,email text,role text,status text,active boolean DEFAULT true);
      CREATE TABLE staff_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),key text NOT NULL,name text NOT NULL,active boolean DEFAULT true);
      CREATE TYPE ${schema}.lender_table AS ENUM ('OnlineBizCC','InBranchBizCC','BizLOC_Stated','BizLOC_Documented','PersonalCC','PersonalLoans','PersonalLOC');
      CREATE TABLE lenders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs(id),lender_table lender_table NOT NULL,name text NOT NULL,product_name text,application_url text,eligible_states text,bureaus_pulled text,stated_requirements text,minimum_time_in_business_years numeric(6,2),minimum_revenue_threshold numeric(14,2),notes text,last_updated_by text,last_updated_date date,active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
      CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,client_id uuid,direction text,channel text,template_key text,rendered_body text,provider text,provider_ref text,status text,compliance_check_passed boolean,to_address text,subject text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX messages_ref_uniq ON messages(org_id, provider_ref) WHERE provider_ref IS NOT NULL;
      CREATE TABLE message_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,template_key text NOT NULL,channel text NOT NULL,subject text,body text NOT NULL,compliance_passed boolean NOT NULL DEFAULT false,UNIQUE(org_id,template_key));
      CREATE TABLE agents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,code text NOT NULL,status text NOT NULL,prompt text,UNIQUE(org_id,code));`);
    org = (await one(`INSERT INTO orgs(name) VALUES('Automation test') RETURNING id`)).id;
    await db.query(await readFile(new URL('../../db/migrations/483_bank_outreach.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../../db/migrations/495_bank_outreach_automation.sql', import.meta.url), 'utf8');
    await db.query(migration);
    // The 495 copy itself, loaded unapproved exactly as the migration seeds it.
    for (const [, key, subject, body] of migration.matchAll(/\('(EMAIL-BANK-OUTREACH-[A-Z0-9-]+)', '([^']*)',\s*\$c\$([\s\S]*?)\$c\$\)/g)) {
      await db.query(`INSERT INTO message_templates(org_id,template_key,channel,subject,body,compliance_passed) VALUES($1,$2,'email',$3,$4,false)`, [org, key, subject, body]);
    }
    const staffRow = async role => one(`INSERT INTO staff(org_id,name,email,role,status) VALUES($1,$2,$3,$4,'active') RETURNING *`, [org, role, `${randomUUID()}@example.test`, role]);
    owner = await staffRow('owner'); rep = await staffRow('outbound_rep'); otherRep = await staffRow('outbound_rep');
  });
  after(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); } });

  test('495 labels machine history, keeps search receipts append-only and refuses half-states', async () => {
    const a = await target(901);
    await db.query(`INSERT INTO outreach_activities(org_id,account_id,staff_id,actor,channel,outcome,next_action) VALUES($1,$2,NULL,'automation','note','x','y')`, [org, a.id]);
    await assert.rejects(db.query(`INSERT INTO outreach_activities(org_id,account_id,staff_id,actor,channel,outcome,next_action) VALUES($1,$2,NULL,'staff','note','x','y')`, [org, a.id]));
    const can = async (t, p) => (await one(`SELECT has_table_privilege('fundhub_app', $1, $2) ok`, [`${schema}.${t}`, p])).ok;
    assert.equal(await can('outreach_search_runs', 'INSERT'), true);
    assert.equal(await can('outreach_search_runs', 'UPDATE'), false);
    assert.equal(await can('outreach_inbound_emails', 'UPDATE'), true);
    assert.equal(await can('outreach_inbound_emails', 'DELETE'), false);
    const run = await one(`INSERT INTO outreach_search_runs(org_id,account_id,provider,query,status,result_count) VALUES($1,$2,'serper','q','done',0) RETURNING id`, [org, a.id]);
    await assert.rejects(db.query(`INSERT INTO outreach_contact_leads(org_id,account_id,search_run_id,name,linkedin_url,confidence,status,reviewed_at,reviewed_by) VALUES($1,$2,$3,'A B','https://www.linkedin.com/in/ab','high','accepted',now(),$4)`, [org, a.id, run.id, owner.id]), /check/i);
    await assert.rejects(db.query(`INSERT INTO outreach_contact_leads(org_id,account_id,search_run_id,name,linkedin_url,confidence) VALUES($1,$2,$3,'A B','https://evil.example/in/ab','high')`, [org, a.id, run.id]), /check/i);
    await assert.rejects(db.query(`INSERT INTO outreach_search_runs(org_id,account_id,provider,query,status) VALUES($1,$2,'serper','q','failed')`, [org, a.id]), /check/i);
  });

  test('banker search: owned rows first, leads saved once, daily cap, no key does nothing, fence restores', async () => {
    const owned = await target(911, 'CA'); const second = await target(912); const third = await target(913, 'FL');
    await write(owner, { action: 'assign', account_id: owned.id, staff_id: rep.id });
    const asked = []; let newHire = null;
    const search = async ({ query }) => { asked.push(query); const cert = query.match(/Test Bank (\d+)/)[1]; return { ok: true, results: [leadResult('Jane Doe', cert), leadResult('Jane Doe', cert), ...(newHire ? [leadResult(newHire, cert)] : []), { title: 'Other Person - VP - Wells Fargo | LinkedIn', link: 'https://www.linkedin.com/in/other', snippet: 'VP at Wells Fargo' }] }; };
    assert.equal((await searchSweep(db, { env: {}, search })).reason, 'no_search_key');
    assert.equal(asked.length, 0);
    const env = { SERPER_API_KEY: 'k'.repeat(30), BANK_OUTREACH_SEARCHES_PER_DAY: String(2 + Number((await one(`SELECT count(*)::int n FROM outreach_search_runs`)).n)) };
    const first = await searchSweep(db, { env, search, perPass: 6 });
    assert.equal(first.searched, 2);
    assert.match(asked[0], /"Test Bank 911"/, 'the rep-owned row is searched first');
    assert.match(asked[0], /"California"/);
    assert.equal((await searchSweep(db, { env, search })).reason, 'daily_cap');
    const leads = (await db.query(`SELECT * FROM outreach_contact_leads WHERE account_id=$1`, [owned.id])).rows;
    assert.equal(leads.length, 1, 'one lead per profile, wrong bank dropped');
    assert.equal(leads[0].status, 'suggested');
    assert.equal((await one(`SELECT next_action FROM outreach_accounts WHERE id=$1`, [owned.id])).next_action, 'Review 1 found banker and connect on LinkedIn', 'a system-written next action becomes the review step');
    const auto = await one(`SELECT actor,staff_id,outcome FROM outreach_activities WHERE account_id=$1 AND outcome='bankers_found'`, [owned.id]);
    assert.deepEqual({ actor: auto.actor, staff: auto.staff_id }, { actor: 'automation', staff: null });
    // A month later the same row is searched again; the same profile is not saved twice.
    const later = await searchSweep(db, { env: { SERPER_API_KEY: 'k'.repeat(30), BANK_OUTREACH_SEARCHES_PER_DAY: '1000' }, search, now: at(new Date(), 31) });
    assert.ok(later.searched >= 1);
    assert.equal((await db.query(`SELECT * FROM outreach_contact_leads WHERE account_id=$1`, [owned.id])).rows.length, 1);
    // A rep's own next action is never replaced by the machine.
    await write(owner, { action: 'log_touch', account_id: second.id, channel: 'call', outcome: 'Left voicemail', next_action: 'Call back Thursday' });
    newHire = 'Nia New';
    await searchSweep(db, { env: { SERPER_API_KEY: 'k'.repeat(30), BANK_OUTREACH_SEARCHES_PER_DAY: '1000' }, search, now: at(new Date(), 62) });
    assert.ok((await one(`SELECT 1 ok FROM outreach_contact_leads WHERE account_id=$1 AND name='Nia New'`, [second.id])), 'the monthly rerun found the new hire');
    assert.equal((await one(`SELECT next_action FROM outreach_accounts WHERE id=$1`, [second.id])).next_action, 'Call back Thursday');
    assert.equal((await one(`SELECT next_action FROM outreach_accounts WHERE id=$1`, [owned.id])).next_action, 'Review 2 found bankers and connect on LinkedIn', 'the machine refreshes its own review count');
    // The fence held the call: nothing spent, no claimed row stays marked searched.
    const marks = async () => (await db.query(`SELECT id, banker_search_at FROM outreach_accounts WHERE org_id=$1 ORDER BY id`, [org])).rows.map(r => `${r.id}:${r.banker_search_at?.toISOString?.() ?? r.banker_search_at}`);
    const before = await marks();
    let calls = 0;
    const held = await searchSweep(db, { env: { SERPER_API_KEY: 'k'.repeat(30), BANK_OUTREACH_SEARCHES_PER_DAY: '1000' }, search: async () => { calls++; return { ok: false, blocked: true, results: [] }; }, now: at(new Date(), 130) });
    assert.equal(held.reason, 'fence_blocked');
    assert.equal(calls, 1);
    assert.deepEqual(await marks(), before);
    assert.ok(third.id);
  });

  test('a rep reviews found bankers on their own rows only; accept saves a contact once', async () => {
    const a = await target(921);
    await write(owner, { action: 'assign', account_id: a.id, staff_id: rep.id });
    await searchSweep(db, { env: { SERPER_API_KEY: 'k'.repeat(30), BANK_OUTREACH_SEARCHES_PER_DAY: '1000' }, search: async () => ({ ok: true, results: [leadResult('Ann Lee', 921), leadResult('Bo Park', 921)] }), perPass: 50 });
    const view = await read(rep, { id: a.id });
    assert.equal(view.leads.length, 2);
    await assert.rejects(read(otherRep, { id: a.id }), /not found/i);
    const [ann, bo] = view.leads;
    const accepted = await write(rep, { action: 'accept_lead', account_id: a.id, lead_id: ann.id });
    assert.match(accepted.contact.linkedin_url, /^https:\/\/www\.linkedin\.com\/in\//);
    await assert.rejects(write(rep, { action: 'accept_lead', account_id: a.id, lead_id: ann.id }), /already reviewed/);
    await write(rep, { action: 'dismiss_lead', account_id: a.id, lead_id: bo.id });
    await assert.rejects(write(otherRep, { action: 'dismiss_lead', account_id: a.id, lead_id: bo.id }), /not found/i);
    const after = await read(rep, { id: a.id });
    assert.deepEqual(after.leads.map(l => l.status).sort(), ['accepted', 'dismissed']);
    assert.equal(after.contacts.length, 1);
  });

  test('email steps wait for approved copy and settings, then go once per step with the footer, and finish', async () => {
    const a = await target(931);
    const c = await banker(a, 'jane@bank931.example', 'Jane Doe');
    const off = await sequenceSweep(db, { env: {}, now: WED });
    assert.equal(off.reason, 'not_configured');
    assert.ok(off.missing.includes('BANK_OUTREACH_POSTAL_ADDRESS'));
    const seq = await one(`SELECT * FROM outreach_email_sequences WHERE contact_id=$1`, [c.id]);
    assert.equal(seq.status, 'active');
    const pending = await sequenceSweep(db, { env: ENV, now: WED });
    assert.ok(pending.results.some(r => r.waiting === 'template_pending'));
    assert.equal((await one(`SELECT step FROM outreach_email_sequences WHERE contact_id=$1`, [c.id])).step, 0, 'unapproved copy holds the step, never burns it');
    await db.query(`UPDATE message_templates SET compliance_passed=true WHERE org_id=$1`, [org]);
    const day1 = at(WED, 2);
    assert.equal((await sequenceSweep(db, { env: ENV, now: at(WED, 3.5) })).reason, 'outside_send_window');
    const sent1 = await sequenceSweep(db, { env: ENV, now: day1 });
    assert.ok(sent1.queued >= 1);
    const m1 = await one(`SELECT * FROM messages WHERE provider_ref=$1`, [`bank-outreach:${c.id}:step1`]);
    assert.equal(m1.to_address, 'jane@bank931.example');
    assert.equal(m1.client_id, null);
    assert.equal(m1.status, 'queued');
    assert.match(m1.subject, /Test Bank 931 in Arizona/);
    assert.match(m1.rendered_body, /^Hi Jane,/);
    assert.match(m1.rendered_body, /100 Test Street, Phoenix, AZ 85001/);
    assert.match(m1.rendered_body, /reply STOP or open https:\/\/fundhub\.ai\/unsubscribe\.html\?.*channel=banker_email/);
    assert.equal((await one(`SELECT status FROM outreach_accounts WHERE id=$1`, [a.id])).status, 'contacted');
    assert.equal((await sequenceSweep(db, { env: ENV, now: day1 })).results.filter(r => r.messageId).length, 0, 'a replayed pass queues nothing new');
    await sequenceSweep(db, { env: ENV, now: at(day1, 5) }); // Mon: step 2
    await sequenceSweep(db, { env: ENV, now: at(day1, 12) }); // Mon: step 3
    const refs = (await db.query(`SELECT provider_ref FROM messages WHERE provider_ref LIKE $1 ORDER BY provider_ref`, [`bank-outreach:${c.id}:%`])).rows.map(r => r.provider_ref.split(':')[2]);
    assert.deepEqual(refs, ['step1', 'step2', 'step3']);
    const done = await one(`SELECT status,stop_reason FROM outreach_email_sequences WHERE contact_id=$1`, [c.id]);
    assert.deepEqual(done, { status: 'stopped', stop_reason: 'completed' });
  });

  test('STOP or any real reply stops the cold emails; the safety check reads real rows both ways', async () => {
    const a = await target(941);
    const stopper = await banker(a, 'stop@bank941.example', 'Sam Stop');
    const replier = await banker(a, 'yes@bank941.example', 'Yan Yes');
    await sequenceSweep(db, { env: ENV, now: at(WED, 2) });
    const saved = await recordBankerReply(db, { contactId: stopper.id, from: 'stop@bank941.example', subject: 'Re: clients', text: 'STOP\n\nOn Mon wrote:\n> Hi', messageId: '<m-941-1@bank>' });
    assert.equal(saved.kind, 'opt_out');
    assert.equal((await recordBankerReply(db, { contactId: stopper.id, text: 'STOP', messageId: '<m-941-1@bank>' })).deduped, true);
    assert.ok((await one(`SELECT email_opt_out_at FROM outreach_contacts WHERE id=$1`, [stopper.id])).email_opt_out_at);
    assert.equal((await one(`SELECT stop_reason FROM outreach_email_sequences WHERE contact_id=$1`, [stopper.id])).stop_reason, 'opted_out');
    await recordBankerReply(db, { contactId: replier.id, from: 'yes@bank941.example', subject: 'Re: clients', text: 'Interested. Send details.', messageId: '<m-941-2@bank>' });
    assert.equal((await one(`SELECT stop_reason FROM outreach_email_sequences WHERE contact_id=$1`, [replier.id])).stop_reason, 'replied');
    assert.equal((await sequenceSweep(db, { env: ENV, now: at(WED, 9) })).results.filter(r => r.messageId && r.id).length, 0);

    const checks = async () => Object.fromEntries((await gapChecks({ db })).map(r => [r.id, r.status]));
    await db.query(`UPDATE messages SET status='sent' WHERE org_id=$1 AND template_key LIKE 'EMAIL-BANK-OUTREACH-%'`, [org]);
    assert.equal((await checks())['bank-outreach:email-safety'], 'PASS');
    await db.query(`INSERT INTO messages(org_id,direction,channel,template_key,provider_ref,status,to_address,created_at) VALUES($1,'outbound','email','EMAIL-BANK-OUTREACH-2',$2,'sent','stop@bank941.example',now()+interval '1 minute')`, [org, `bank-outreach:${stopper.id}:step2`]);
    assert.equal((await checks())['bank-outreach:email-safety'], 'FAIL');
    await db.query(`UPDATE messages SET status='blocked' WHERE provider_ref=$1`, [`bank-outreach:${stopper.id}:step2`]);
    assert.equal((await checks())['bank-outreach:email-safety'], 'PASS');
  });

  test('reply reader: draft waits for a person; shadow suggests and sends nothing; live queues the reviewed answer', async () => {
    const a = await target(951);
    await write(owner, { action: 'assign', account_id: a.id, staff_id: rep.id });
    const x = await banker(a, 'x@bank951.example', 'Xia Xu'); const y = await banker(a, 'y@bank951.example', 'Yo Yu'); const z = await banker(a, 'z@bank951.example', 'Zed Zu');
    const model = async () => ({ mode: 'live', text: JSON.stringify({ kind: 'data', summary: 'Gave score and bureau', product_name: 'Business card', lender_table: 'OnlineBizCC', facts: { minimum_score: 680, bureaus_pulled: ['EX'] }, evidence_quote: '680 minimum, we pull Experian', referral: null }) });
    await db.query(`INSERT INTO agents(org_id,code,status,prompt) VALUES($1,'BANK-OUTREACH-REPLY','draft','prompt')`, [org]);
    await recordBankerReply(db, { contactId: x.id, from: 'x@bank951.example', subject: 'Re: Pre-verified clients', text: 'Happy to talk, what do you need?', messageId: '<m-951-x@bank>' });
    await processReplies(db, { env: ENV, model, cap: 50 });
    const rx = await one(`SELECT * FROM outreach_inbound_emails WHERE contact_id=$1`, [x.id]);
    assert.deepEqual({ status: rx.status, kind: rx.kind, mode: rx.ai_mode }, { status: 'needs_human', kind: 'other', mode: 'rules' });
    const acct = await one(`SELECT status,next_action,next_due_at FROM outreach_accounts WHERE id=$1`, [a.id]);
    assert.equal(acct.status, 'engaged');
    assert.equal(acct.next_action, 'Read the banker reply and answer');
    assert.ok(new Date(acct.next_due_at) <= new Date());

    await db.query(`UPDATE agents SET status='shadow' WHERE org_id=$1`, [org]);
    await recordBankerReply(db, { contactId: y.id, from: 'y@bank951.example', subject: 'Re: Pre-verified clients', text: '680 minimum, we pull Experian.', messageId: '<m-951-y@bank>' });
    await processReplies(db, { env: ENV, model, cap: 50 });
    const ry = await one(`SELECT * FROM outreach_inbound_emails WHERE contact_id=$1`, [y.id]);
    assert.deepEqual({ status: ry.status, kind: ry.kind, mode: ry.ai_mode, suggestion: ry.suggestion_status }, { status: 'needs_human', kind: 'data', mode: 'shadow', suggestion: 'pending' });
    assert.equal(ry.draft_reply.template_key, 'EMAIL-BANK-OUTREACH-REPLY-ASK');
    assert.match(ry.draft_reply.body, /How long does a business need to be open\?/);
    assert.doesNotMatch(ry.draft_reply.body, /minimum credit score you approve/);
    assert.equal(ry.draft_reply.subject, 'Re: Pre-verified clients');
    assert.equal((await one(`SELECT count(*)::int n FROM messages WHERE provider_ref LIKE 'bank-outreach:%:reply-%' AND org_id=$1`, [org])).n, 0, 'shadow sends nothing');

    await db.query(`UPDATE agents SET status='live' WHERE org_id=$1`, [org]);
    const interested = async () => ({ mode: 'live', text: '{"kind":"interested","summary":"Wants clients","facts":{}}' });
    await recordBankerReply(db, { contactId: z.id, from: 'z@bank951.example', subject: 'RE: Last note', text: 'Yes, send them over.', messageId: '<m-951-z@bank>' });
    await processReplies(db, { env: ENV, model: interested, cap: 50 });
    const rz = await one(`SELECT * FROM outreach_inbound_emails WHERE contact_id=$1`, [z.id]);
    assert.equal(rz.status, 'handled');
    const answer = await one(`SELECT * FROM messages WHERE id=$1`, [rz.reply_message_id]);
    assert.equal(answer.template_key, 'EMAIL-BANK-OUTREACH-REPLY-ASK');
    assert.equal(answer.to_address, 'z@bank951.example');
    assert.equal(answer.subject, 'Re: Last note');
    assert.match(answer.rendered_body, /reply STOP/);

    // The rep applies the shadow suggestion: a product draft, evidence from the
    // banker's own words, waiting for a manager. Lenders is untouched.
    const applied = await write(rep, { action: 'apply_reply_suggestion', account_id: a.id, reply_id: ry.id });
    assert.equal(applied.product.facts.minimum_score, 680);
    assert.match(applied.product.evidence, /680 minimum, we pull Experian/);
    assert.equal(applied.product.verified_at, null);
    assert.equal((await one(`SELECT count(*)::int n FROM lenders WHERE org_id=$1`, [org])).n, 0);
    await assert.rejects(write(rep, { action: 'apply_reply_suggestion', account_id: a.id, reply_id: ry.id }), /no facts waiting/);
    await write(rep, { action: 'mark_reply_handled', account_id: a.id, reply_id: rx.id });
    assert.equal((await one(`SELECT status,handled_by FROM outreach_inbound_emails WHERE id=$1`, [rx.id])).handled_by, rep.id);
    const view = await read(rep, { id: a.id });
    assert.equal(view.replies.length, 3);
    assert.ok(view.activities.some(act => act.actor === 'automation' && /^banker_reply:/.test(act.outcome)));
  });

  test('a reply the machine has not read in an hour turns the deep check red; a manager sees the automation state', async () => {
    const a = await target(961);
    const c = await banker(a, 'late@bank961.example', 'Lu Late');
    await db.query(`INSERT INTO outreach_inbound_emails(org_id,account_id,contact_id,body,received_at) VALUES($1,$2,$3,'Hello',now()-interval '2 hours')`, [org, a.id, c.id]);
    const statusOf = async () => (await gapChecks({ db })).find(r => r.id === 'bank-outreach:reply-waiting').status;
    assert.equal(await statusOf(), 'FAIL');
    await processReplies(db, { env: ENV, cap: 50, model: async () => ({ mode: 'shadow', text: null }) });
    assert.equal(await statusOf(), 'PASS');
    const auto = await read(owner, { view: 'automation' });
    assert.equal(auto.automation.email.configured, true);
    assert.equal(auto.automation.email.templates_total, 7);
    assert.equal(auto.automation.replies.agent_status, 'live');
    assert.equal(typeof auto.automation.search.never_searched, 'number');
    await assert.rejects(read(rep, { view: 'automation' }), /manager/i);
  });
});
