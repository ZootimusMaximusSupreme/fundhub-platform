import { withTransaction } from '../db/with-transaction.mjs';
import { PROGRAM_KEY, MANAGER_ROLES, OUTREACH_ROLES, LENDER_TABLES, fail, text, uuid, httpUrl, dueAt, status, normalizeFacts, parseInstitutionCsv, lenderValues, lenderExtras, productFields, factsForType } from './model.mjs';
import { stopSequence, arizonaDayStart, templateFor, renderWarmup, WARMUP_EMAIL_KEY, WARMUP_SMS_KEY } from './queue.mjs';
import { stripQuoted, AGENT_CODE } from './replies.mjs';
import { mailConfig, inSendWindow, BANK_EMAIL_KEYS, COLD_KEYS } from './mail.mjs';
import { serperKey, SIGNUP_URL } from '../messaging/providers/serper-search.mjs';
import { DEFAULT_SEARCHES_PER_DAY, DEFAULT_EMAILS_PER_DAY } from './automation.mjs';

async function identity(db, staff) {
  if (!staff?.id || !staff?.org_id) fail('Sign in to your staff account', 401);
  uuid(staff.id); uuid(staff.org_id, 'organization');
  const actual = (await db.query(`SELECT id,org_id,name,email,role FROM staff WHERE id=$1 AND org_id=$2 AND status='active' AND COALESCE((to_jsonb(staff)->>'active')::boolean,true)`, [staff.id, staff.org_id])).rows[0];
  if (!actual || !OUTREACH_ROLES.includes(actual.role)) fail('Bank outreach access required', 403);
  return { ...actual, canManage: MANAGER_ROLES.includes(actual.role) };
}
function manager(staff) { if (!staff.canManage) fail('A manager must do this', 403); }
async function program(db, staff, create = false) {
  if (create) await db.query(`INSERT INTO outreach_programs(org_id,key) VALUES($1,$2) ON CONFLICT(org_id,key) DO NOTHING`, [staff.org_id, PROGRAM_KEY]);
  return (await db.query(`SELECT * FROM outreach_programs WHERE org_id=$1 AND key=$2`, [staff.org_id, PROGRAM_KEY])).rows[0] || { key: PROGRAM_KEY, states: ['AZ', 'SC', 'FL', 'CA'] };
}
async function account(db, staff, id, lock = false) {
  uuid(id, 'account');
  const row = (await db.query(`SELECT a.* FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id WHERE a.id=$1 AND a.org_id=$2 AND p.key=$3 AND ($4::boolean OR a.assigned_staff_id=$5) ${lock ? 'FOR UPDATE OF a' : ''}`, [id, staff.org_id, PROGRAM_KEY, staff.canManage, staff.id])).rows[0];
  if (!row) fail('Bank account not found', 404);
  return row;
}
async function reps(db, staff) {
  return (await db.query(`SELECT id,name,role FROM staff WHERE org_id=$1 AND status='active' AND COALESCE((to_jsonb(staff)->>'active')::boolean,true) AND role=ANY($2::text[]) AND ($3::boolean OR id=$4) ORDER BY name,id`, [staff.org_id, OUTREACH_ROLES, staff.canManage, staff.id])).rows;
}
async function scopedSummary(db, staff) {
  return (await db.query(`WITH scope AS (
    SELECT a.* FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id
    WHERE a.org_id=$1 AND p.key=$4 AND ($2::boolean OR a.assigned_staff_id=$3)
  ) SELECT count(*)::int total,
    count(*) FILTER(WHERE status='verified_partner')::int verified_partners,
    count(*) FILTER(WHERE status NOT IN ('paused','closed') AND (nullif(btrim(next_action),'') IS NULL OR next_due_at IS NULL))::int missing_next_action,
    count(*) FILTER(WHERE status NOT IN ('paused','closed') AND next_due_at<=now())::int due_now,
    (SELECT count(*)::int FROM outreach_contact_leads l JOIN scope a ON a.id=l.account_id AND a.org_id=l.org_id WHERE l.status='suggested') leads_waiting,
    (SELECT count(*)::int FROM outreach_inbound_emails r JOIN scope a ON a.id=r.account_id AND a.org_id=r.org_id WHERE r.status IN ('new','needs_human')) replies_waiting,
    (SELECT count(*)::int FROM outreach_products x JOIN scope a ON a.id=x.account_id AND a.org_id=x.org_id WHERE x.first_verified_at>=(date_trunc('week',now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix')) verified_products_week,
    (SELECT count(*)::int FROM outreach_products x JOIN scope a ON a.id=x.account_id AND a.org_id=x.org_id WHERE x.first_verified_at>=((date_trunc('week',now() AT TIME ZONE 'America/Phoenix')-interval '7 days') AT TIME ZONE 'America/Phoenix') AND x.first_verified_at<(date_trunc('week',now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix')) verified_products_previous_week
    FROM scope`, [staff.org_id, staff.canManage, staff.id, PROGRAM_KEY])).rows[0];
}
// What the machine is doing and what it is waiting on. Managers only.
async function automationStatus(db, staff, env) {
  const dayStart = arizonaDayStart(new Date());
  const cfg = mailConfig(env);
  const [search, email, replies, templates, agent] = await Promise.all([
    db.query(`SELECT (SELECT count(*)::int FROM outreach_search_runs WHERE created_at>=$2::timestamptz) used_today,
      count(*) FILTER(WHERE a.banker_search_at IS NULL)::int never_searched, count(*)::int accounts
      FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id WHERE a.org_id=$1 AND p.key=$3`, [staff.org_id, dayStart, PROGRAM_KEY]),
    db.query(`SELECT (SELECT count(*)::int FROM messages WHERE template_key=ANY($2::text[]) AND created_at>=$3::timestamptz) sent_today,
      count(*) FILTER(WHERE status='active')::int active_sequences, count(*)::int sequences FROM outreach_email_sequences WHERE org_id=$1`, [staff.org_id, COLD_KEYS, dayStart]),
    db.query(`SELECT count(*) FILTER(WHERE status='new')::int waiting, count(*) FILTER(WHERE status='needs_human')::int needs_human FROM outreach_inbound_emails WHERE org_id=$1`, [staff.org_id]),
    db.query(`SELECT count(*) FILTER(WHERE compliance_passed)::int approved, count(*)::int total FROM message_templates WHERE org_id=$1 AND template_key=ANY($2::text[])`, [staff.org_id, BANK_EMAIL_KEYS]),
    db.query(`SELECT status FROM agents WHERE org_id=$1 AND code=$2`, [staff.org_id, AGENT_CODE])
  ]);
  const perDay = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };
  return {
    search: { configured: !!serperKey(env), signup_url: SIGNUP_URL, per_day_cap: perDay(env.BANK_OUTREACH_SEARCHES_PER_DAY, DEFAULT_SEARCHES_PER_DAY), ...search.rows[0] },
    email: { configured: cfg.ok, missing: cfg.missing, in_send_window: inSendWindow(new Date()), per_day_cap: perDay(env.BANK_OUTREACH_EMAILS_PER_DAY, DEFAULT_EMAILS_PER_DAY), templates_approved: templates.rows[0].approved, templates_total: BANK_EMAIL_KEYS.length, ...email.rows[0] },
    replies: { agent_status: agent.rows[0]?.status || 'missing', ...replies.rows[0] }
  };
}

export async function readOutreach(db, { staff: input, query = {}, env = process.env } = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) fail('Enter valid outreach filters');
  const staff = await identity(db, input);
  const base = { ok: true, canManage: staff.canManage, program: await program(db, staff), productFields: productFields() };
  if (query.id) {
    const a = await account(db, staff, query.id);
    const saved = (await db.query(`SELECT * FROM outreach_contacts WHERE org_id=$1 AND account_id=$2 ORDER BY created_at,id`, [staff.org_id, a.id])).rows;
    // First-contact words for the rep to send by hand, signed by the bank's rep (or the person reading it).
    // Rendered from the stored templates whether or not they are approved; a missing one is null.
    const assignedRep = a.assigned_staff_id ? (await db.query(`SELECT name FROM staff WHERE id=$1 AND org_id=$2`, [a.assigned_staff_id, staff.org_id])).rows[0] : null;
    const emailTemplate = await templateFor(db, staff.org_id, WARMUP_EMAIL_KEY, { approvedOnly: false });
    const smsTemplate = await templateFor(db, staff.org_id, WARMUP_SMS_KEY, { approvedOnly: false, channel: 'sms' });
    const contacts = saved.map(contact => ({ ...contact, warmup: renderWarmup({ emailTemplate, smsTemplate }, { account: a, contact, repName: assignedRep?.name || staff.name }) }));
    const activities = (await db.query(`SELECT x.*,s.name staff_name FROM outreach_activities x LEFT JOIN staff s ON s.id=x.staff_id AND s.org_id=x.org_id WHERE x.org_id=$1 AND x.account_id=$2 ORDER BY x.created_at DESC,x.id DESC LIMIT 500`, [staff.org_id, a.id])).rows;
    const products = (await db.query(`SELECT * FROM outreach_products WHERE org_id=$1 AND account_id=$2 ORDER BY created_at,id`, [staff.org_id, a.id])).rows;
    // Pending manager amendments are not published banker facts. Keep them out
    // of the rep response, including the copies retained in approval history.
    const visibleProducts = staff.canManage ? products : products.map(({ draft: _draft, ...published }) => published);
    const visibleActivities = staff.canManage ? activities : activities.map(activity => {
      if (activity.outcome === 'product_amendment_drafted') return { ...activity, note: 'Manager amendment awaiting verification' };
      if (activity.outcome === 'product_verified') return { ...activity, note: 'Product verified into Lenders' };
      return activity;
    });
    const leads = (await db.query(`SELECT id,name,title,employer,linkedin_url,snippet,confidence,status,contact_id,reviewed_at,created_at FROM outreach_contact_leads WHERE org_id=$1 AND account_id=$2 ORDER BY (status='suggested') DESC,(confidence='high') DESC,created_at DESC,id LIMIT 100`, [staff.org_id, a.id])).rows;
    const sequences = (await db.query(`SELECT id,contact_id,status,step,next_due_at,last_sent_at,stopped_at,stop_reason FROM outreach_email_sequences WHERE org_id=$1 AND account_id=$2 ORDER BY created_at,id`, [staff.org_id, a.id])).rows;
    const replies = (await db.query(`SELECT id,contact_id,from_address,subject,body,received_at,status,kind,ai_mode,summary,suggested,suggestion_status,draft_reply,reply_message_id,error,processed_at FROM outreach_inbound_emails WHERE org_id=$1 AND account_id=$2 ORDER BY received_at DESC,id DESC LIMIT 100`, [staff.org_id, a.id])).rows;
    return { ...base, account: a, contacts, activities: visibleActivities, products: visibleProducts, leads, sequences, replies };
  }
  const summary = await scopedSummary(db, staff);
  const seats = await reps(db, staff);
  if (query.view === 'team') {
    manager(staff);
    const byRep = (await db.query(`SELECT s.id staff_id,s.name,count(a.id)::int total,count(a.id) FILTER(WHERE a.status='verified_partner')::int verified_partners,count(a.id) FILTER(WHERE a.next_due_at<=now() AND a.status NOT IN ('paused','closed'))::int due_now FROM staff s LEFT JOIN outreach_accounts a ON a.assigned_staff_id=s.id AND a.org_id=s.org_id LEFT JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id WHERE s.org_id=$1 AND s.status='active' AND s.role=ANY($2::text[]) AND (p.key=$3 OR p.id IS NULL) GROUP BY s.id,s.name ORDER BY s.name`, [staff.org_id, OUTREACH_ROLES, PROGRAM_KEY])).rows;
    const byState = (await db.query(`SELECT a.state,count(*)::int total,count(*) FILTER(WHERE a.status='verified_partner')::int verified_partners,count(*) FILTER(WHERE a.next_due_at<=now() AND a.status NOT IN ('paused','closed'))::int due_now FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id WHERE a.org_id=$1 AND p.key=$2 GROUP BY a.state ORDER BY a.state`, [staff.org_id, PROGRAM_KEY])).rows;
    return { ...base, summary, byRep, byState, reps: seats };
  }
  if (query.view === 'automation') {
    manager(staff);
    return { ...base, summary, automation: await automationStatus(db, staff, env) };
  }
  const state = query.state ? text(query.state, 'state', { max: 2 }).toUpperCase() : null;
  if (state && !base.program.states.includes(state)) fail('Choose a program state');
  const filterStatus = query.status ? status(query.status) : null;
  const search = text(query.q, 'search', { max: 200 });
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 25));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const params = [staff.org_id, staff.canManage, staff.id, PROGRAM_KEY, state, filterStatus, search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null];
  const where = `a.org_id=$1 AND ($2::boolean OR a.assigned_staff_id=$3) AND p.key=$4 AND ($5::text IS NULL OR a.state=$5) AND ($6::text IS NULL OR a.status=$6) AND ($7::text IS NULL OR a.name ILIKE $7 OR a.city ILIKE $7)`;
  const total = (await db.query(`SELECT count(*)::int total FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id WHERE ${where}`, params)).rows[0].total;
  const items = (await db.query(`SELECT a.*,s.name assigned_staff_name,
    (SELECT count(*)::int FROM outreach_contact_leads l WHERE l.org_id=a.org_id AND l.account_id=a.id AND l.status='suggested') leads_waiting,
    (SELECT count(*)::int FROM outreach_inbound_emails r WHERE r.org_id=a.org_id AND r.account_id=a.id AND r.status IN ('new','needs_human')) replies_waiting
    FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id LEFT JOIN staff s ON s.id=a.assigned_staff_id AND s.org_id=a.org_id WHERE ${where} ORDER BY (a.status IN ('paused','closed')) ASC,a.next_due_at ASC NULLS LAST,a.name,a.id LIMIT $8 OFFSET $9`, [...params, limit, offset])).rows;
  return { ...base, items, total, summary, reps: seats };
}

async function appendActivity(db, staff, a, body, { outcome, note, touch = false } = {}) {
  const next = text(body.next_action, 'next action', { required: true, max: 1000 });
  const due = dueAt(body.next_due_at);
  const channel = body.channel || 'note';
  if (!['linkedin', 'email', 'call', 'note'].includes(channel)) fail('Choose a valid channel');
  const contactId = body.contact_id ? uuid(body.contact_id, 'contact') : null;
  if (contactId && !(await db.query(`SELECT id FROM outreach_contacts WHERE id=$1 AND account_id=$2 AND org_id=$3`, [contactId, a.id, staff.org_id])).rows.length) fail('Contact not found', 404);
  const result = (await db.query(`INSERT INTO outreach_activities(org_id,account_id,contact_id,staff_id,channel,outcome,note,next_action,next_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [staff.org_id, a.id, contactId, staff.id, channel, outcome || text(body.outcome, 'outcome', { required: true, max: 1000 }), note || text(body.note, 'note'), next, due])).rows[0];
  await db.query(`UPDATE outreach_accounts SET next_action=$3,next_due_at=$4,last_touch_at=CASE WHEN $5::boolean THEN now() ELSE last_touch_at END,last_partner_checkin_at=CASE WHEN $5::boolean AND status='verified_partner' THEN now() ELSE last_partner_checkin_at END,updated_at=now() WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id, next, due, touch]);
  return result;
}

async function saveProduct(db, staff, a, body) {
  const name = text(body.product_name, 'product name', { required: true, max: 250 });
  if (!LENDER_TABLES.includes(body.lender_table)) fail('Choose an existing lender product category');
  const facts = normalizeFacts(body.facts || {}, { lenderTable: body.lender_table });
  const evidence = text(body.evidence, 'evidence') || '';
  let previous;
  if (body.id) {
    uuid(body.id, 'product');
    previous = (await db.query(`SELECT * FROM outreach_products WHERE id=$1 AND org_id=$2 AND account_id=$3 FOR UPDATE`, [body.id, staff.org_id, a.id])).rows[0];
    if (!previous) fail('Product not found', 404);
  }
  if (previous?.verified_at) manager(staff);
  let lenderId = previous?.lender_id || null;
  if (Object.hasOwn(body, 'lender_id') && body.lender_id !== lenderId) {
    manager(staff);
    // A promoted product cannot be repointed and overwrite another lender row.
    if (previous?.first_verified_at || previous?.verified_at) fail('This product already has its own lender row');
    lenderId = body.lender_id ? uuid(body.lender_id, 'lender') : null;
  }
  if (lenderId) {
    const linked = (await db.query(`SELECT id FROM lenders WHERE id=$1 AND org_id=$2 AND lender_table=$3 AND active`, [lenderId, staff.org_id, body.lender_table])).rows[0];
    if (!linked) fail('Choose an active lender in this organization and product category');
    const claimed = (await db.query(`SELECT id FROM outreach_products WHERE lender_id=$1 AND ($2::uuid IS NULL OR id<>$2) AND org_id=$3`, [lenderId, previous?.id || null, staff.org_id])).rows[0];
    if (claimed) fail('That lender row already belongs to another outreach product');
  }
  const params = [staff.org_id, a.id, name, body.lender_table, JSON.stringify(facts), evidence, lenderId, staff.id];
  if (previous?.verified_at) {
    const candidate = { product_name: name, lender_table: body.lender_table, facts, evidence };
    const result = (await db.query(`UPDATE outreach_products SET draft=$4::jsonb,updated_at=now() WHERE org_id=$1 AND account_id=$2 AND id=$3 RETURNING *`, [staff.org_id, a.id, previous.id, JSON.stringify(candidate)])).rows[0];
    await appendActivity(db, staff, a, { next_action: 'Review and verify amended product data' }, { outcome: 'product_amendment_drafted', note: JSON.stringify({ product_id: previous.id, draft: candidate }) });
    return { product: result };
  }
  const result = previous
    ? (await db.query(`UPDATE outreach_products SET product_name=$3,lender_table=$4,facts=$5::jsonb,evidence=$6,lender_id=$7,verified_at=NULL,verified_by=NULL,updated_at=now() WHERE org_id=$1 AND account_id=$2 AND id=$8 RETURNING *`, [...params.slice(0, 7), previous.id])).rows[0]
    : (await db.query(`INSERT INTO outreach_products(org_id,account_id,product_name,lender_table,facts,evidence,lender_id,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`, params)).rows[0];
  await appendActivity(db, staff, a, { next_action: 'Review and verify product data' }, { outcome: 'product_saved', note: name });
  await db.query(`UPDATE outreach_accounts SET status='product_pending' WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id]);
  return { product: result };
}

// A manager verifies any product. A rep pushes their own bank's first complete product to Lenders:
// account() already limits a rep to banks assigned to them. A product that is already published, or
// that holds a manager's pending amendment, stays a manager's call.
async function verifyProduct(db, staff, id) {
  uuid(id, 'product');
  // Lock account first, consistent with every other product write.
  const ref = (await db.query(`SELECT account_id FROM outreach_products WHERE id=$1 AND org_id=$2`, [id, staff.org_id])).rows[0];
  if (!ref) fail('Product not found', 404);
  const a = await account(db, staff, ref.account_id, true);
  const published = (await db.query(`SELECT * FROM outreach_products WHERE id=$1 AND org_id=$2 AND account_id=$3 FOR UPDATE`, [id, staff.org_id, a.id])).rows[0];
  if (published.verified_at || published.draft) manager(staff);
  const product = { ...published, ...(published.draft || {}) };
  if (published.verified_at && product.lender_table !== published.lender_table) fail('Keep the approved product category; add a new product for another category');
  const facts = normalizeFacts(product.facts, { complete: true, lenderTable: product.lender_table });
  if (!product.evidence.trim() || ['unknown', 'none', 'n/a', 'tbd'].includes(product.evidence.trim().toLowerCase())) fail('Add source evidence before verification');
  const contacts = (await db.query(`SELECT id FROM outreach_contacts WHERE org_id=$1 AND account_id=$2 AND nullif(btrim(name),'') IS NOT NULL AND (nullif(btrim(email),'') IS NOT NULL OR nullif(btrim(phone),'') IS NOT NULL OR nullif(btrim(linkedin_url),'') IS NOT NULL) LIMIT 1`, [staff.org_id, a.id])).rows;
  if (!contacts.length) fail('Add a reachable banker before verification');
  const values = lenderValues(a, product, facts, staff);
  // Typed columns for the answers beyond the base twelve. Names come from the field catalog, never from input.
  const extras = lenderExtras(product.lender_table, facts);
  const extraColumns = Object.keys(extras);
  const extraValues = Object.values(extras);
  let lender; let priorLender = null;
  if (product.lender_id) {
    priorLender = (await db.query(`SELECT * FROM lenders WHERE org_id=$1 AND id=$2 FOR UPDATE`, [staff.org_id, product.lender_id])).rows[0];
    if (!priorLender) fail('Linked lender is missing from this organization');
    if (!priorLender.active || priorLender.lender_table !== product.lender_table) fail('Linked lender changed; choose an active lender in this product category', 409);
    const extraSet = extraColumns.map((column, i) => `,${column}=$${14 + i}`).join('');
    lender = (await db.query(`UPDATE lenders SET lender_table=$2,name=$3,product_name=$4,application_url=$5,eligible_states=$6,bureaus_pulled=$7,stated_requirements=$8,minimum_time_in_business_years=$9,minimum_revenue_threshold=$10,notes=$11,last_updated_by=$12,last_updated_date=current_date,updated_at=now()${extraSet} WHERE org_id=$1 AND id=$13 AND active AND lender_table=$2 RETURNING id`, [...values, product.lender_id, ...extraValues])).rows[0];
    if (!lender) fail('Linked lender is missing from this organization');
  } else {
    const extraNames = extraColumns.map(column => `,${column}`).join('');
    const extraParams = extraColumns.map((_, i) => `,$${13 + i}`).join('');
    lender = (await db.query(`INSERT INTO lenders(org_id,lender_table,name,product_name,application_url,eligible_states,bureaus_pulled,stated_requirements,minimum_time_in_business_years,minimum_revenue_threshold,notes,last_updated_by,last_updated_date${extraNames}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,current_date${extraParams}) RETURNING id`, [...values, ...extraValues])).rows[0];
  }
  const verified = (await db.query(`UPDATE outreach_products SET lender_id=$3,verified_at=now(),first_verified_at=COALESCE(first_verified_at,now()),verified_by=$4,product_name=$5,lender_table=$6,facts=$7::jsonb,evidence=$8,draft=NULL,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *`, [staff.org_id, product.id, lender.id, staff.id, product.product_name, product.lender_table, JSON.stringify(facts), product.evidence])).rows[0];
  const checkin = (await db.query(`SELECT now()+CASE WHEN $1::text='quiet' THEN interval '3 months' ELSE interval '1 month' END due`, [a.partner_activity])).rows[0].due;
  await appendActivity(db, staff, a, { next_action: 'Check in with banker', next_due_at: checkin }, { outcome: 'product_verified', note: JSON.stringify({ product_id: product.id, approved: { product_name: product.product_name, lender_table: product.lender_table, facts, evidence: product.evidence, lender_id: lender.id }, previous_verified: published.verified_at ? { product: published, lender: priorLender } : null }) });
  await db.query(`UPDATE outreach_accounts SET status='verified_partner',last_partner_checkin_at=now() WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id]);
  return { product: verified, lender_id: lender.id };
}

const FOUND_ACTION = /^Review \d+ found bankers? and connect on LinkedIn$/;
// A found banker becomes a saved contact only when a rep says so.
async function reviewLead(db, staff, a, body) {
  const id = uuid(body.lead_id, 'found banker');
  const lead = (await db.query(`SELECT * FROM outreach_contact_leads WHERE id=$1 AND org_id=$2 AND account_id=$3 FOR UPDATE`, [id, staff.org_id, a.id])).rows[0];
  if (!lead) fail('Found banker not found', 404);
  if (lead.status !== 'suggested') fail('This found banker was already reviewed', 409);
  let contact = null;
  if (body.action === 'accept_lead') {
    contact = (await db.query(`INSERT INTO outreach_contacts(org_id,account_id,name,title,linkedin_url,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [staff.org_id, a.id, lead.name, lead.title, lead.linkedin_url, staff.id])).rows[0];
  }
  const updated = (await db.query(`UPDATE outreach_contact_leads SET status=$3,contact_id=$4,reviewed_by=$5,reviewed_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *`, [staff.org_id, id, contact ? 'accepted' : 'dismissed', contact?.id || null, staff.id])).rows[0];
  const left = (await db.query(`SELECT count(*)::int n FROM outreach_contact_leads WHERE org_id=$1 AND account_id=$2 AND status='suggested'`, [staff.org_id, a.id])).rows[0].n;
  const next = FOUND_ACTION.test(a.next_action || '') ? (contact ? 'Connect with the saved banker on LinkedIn' : left ? `Review ${left} found banker${left === 1 ? '' : 's'} and connect on LinkedIn` : 'Find and contact a banker') : (a.next_action || 'Contact banker');
  await appendActivity(db, staff, a, { next_action: next, next_due_at: a.next_due_at || undefined, contact_id: contact?.id }, { outcome: contact ? 'contact_saved' : 'found_banker_dismissed', note: lead.name });
  return { lead: updated, contact };
}

// A banker reply: apply its suggested facts as a product draft, set them aside,
// or mark the reply answered. A manager still verifies any product.
async function reviewReply(db, staff, a, body) {
  const id = uuid(body.reply_id, 'reply');
  const reply = (await db.query(`SELECT * FROM outreach_inbound_emails WHERE id=$1 AND org_id=$2 AND account_id=$3 FOR UPDATE`, [id, staff.org_id, a.id])).rows[0];
  if (!reply) fail('Reply not found', 404);
  if (body.action === 'mark_reply_handled') {
    if (reply.status === 'new') fail('This reply is still being read; try again in a few minutes', 409);
    const updated = (await db.query(`UPDATE outreach_inbound_emails SET status='handled',handled_by=$3,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING id,status`, [staff.org_id, id, staff.id])).rows[0];
    return { reply: updated };
  }
  if (reply.suggestion_status !== 'pending') fail('This reply has no facts waiting', 409);
  if (body.action === 'dismiss_reply_suggestion') {
    return { reply: (await db.query(`UPDATE outreach_inbound_emails SET suggestion_status='dismissed',handled_by=$3,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING id,suggestion_status`, [staff.org_id, id, staff.id])).rows[0] };
  }
  const s = reply.suggested || {};
  const quote = s.evidence_quote || stripQuoted(reply.body).slice(0, 300);
  const date = new Date(reply.received_at).toISOString().slice(0, 10);
  let facts = s.facts || {}; let evidence = `Banker email from ${reply.from_address || 'the banker'} on ${date}: "${quote}"`;
  let productId;
  if (body.product_id) {
    productId = uuid(body.product_id, 'product');
    const existing = (await db.query(`SELECT facts,draft,evidence FROM outreach_products WHERE id=$1 AND org_id=$2 AND account_id=$3`, [productId, staff.org_id, a.id])).rows[0];
    if (!existing) fail('Product not found', 404);
    facts = { ...(existing.draft?.facts || existing.facts || {}), ...facts };
    evidence = [existing.draft?.evidence ?? existing.evidence, evidence].filter(v => v && v.trim()).join('\n');
  }
  const lenderTable = body.lender_table ?? s.lender_table;
  // A suggestion can name a fact this kind of product does not ask for; drop it rather than refuse the whole save.
  if (LENDER_TABLES.includes(lenderTable)) facts = factsForType(lenderTable, facts);
  const saved = await saveProduct(db, staff, a, { id: productId, product_name: body.product_name ?? s.product_name, lender_table: lenderTable, facts, evidence });
  await db.query(`UPDATE outreach_inbound_emails SET suggestion_status='applied',status='handled',handled_by=$3,updated_at=now() WHERE org_id=$1 AND id=$2`, [staff.org_id, id, staff.id]);
  return saved;
}

export async function writeOutreach(db, { staff: input, body = {} } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Enter a valid outreach action');
  return withTransaction(db, async tx => {
    const staff = await identity(tx, input);
    const p = await program(tx, staff, true);
    const base = { ok: true, canManage: staff.canManage, program: p };
    if (body.action === 'import') {
      manager(staff);
      const parsed = parseInstitutionCsv(body.source, body.csv, p.states);
      let imported = 0;
      for (const row of parsed.items) {
        const result = await tx.query(`INSERT INTO outreach_accounts(org_id,program_id,source,external_id,institution_key,name,state,city,website,next_action,next_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Assign a rep and find a banker',now()) ON CONFLICT(org_id,program_id,source,external_id,state) DO NOTHING RETURNING id`, [staff.org_id, p.id, row.source, row.external_id, row.institution_key, row.name, row.state, row.city, row.website]);
        imported += result.rows.length;
      }
      return { ...base, imported, existing: parsed.items.length - imported, skipped: parsed.skipped };
    }
    if (body.action === 'verify_product') return { ...base, ...await verifyProduct(tx, staff, body.id) };
    const a = await account(tx, staff, body.account_id || body.id, true);
    if (body.action === 'assign') {
      manager(staff);
      const assigned = body.staff_id ? uuid(body.staff_id, 'rep') : null;
      if (assigned && !(await tx.query(`SELECT id FROM staff WHERE org_id=$1 AND id=$2 AND status='active' AND COALESCE((to_jsonb(staff)->>'active')::boolean,true) AND role=ANY($3::text[])`, [staff.org_id, assigned, OUTREACH_ROLES])).rows.length) fail('Choose an active rep in this organization');
      if (assigned !== a.assigned_staff_id) {
        await tx.query(`INSERT INTO outreach_assignments(org_id,account_id,previous_staff_id,assigned_staff_id,assigned_by) VALUES($1,$2,$3,$4,$5)`, [staff.org_id, a.id, a.assigned_staff_id, assigned, staff.id]);
        await tx.query(`UPDATE outreach_accounts SET assigned_staff_id=$3,next_action='Find and contact a banker',next_due_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id, assigned]);
      }
      return { ...base, account: await account(tx, staff, a.id) };
    }
    if (body.action === 'save_contact') {
      const name = text(body.name, 'banker name', { required: true, max: 250 });
      const linkedin = httpUrl(body.linkedin_url, 'LinkedIn URL');
      if (linkedin && (linkedin === 'unknown' || !/(^|\.)linkedin\.com$/i.test(new URL(linkedin).hostname))) fail('Enter a LinkedIn profile URL');
      const email = text(body.email, 'email', { max: 320 });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email');
      const phone = text(body.phone, 'phone', { max: 100 });
      if (phone && phone.replace(/\D/g, '').length < 7) fail('Enter a valid phone');
      const values = [staff.org_id, a.id, name, text(body.title, 'title', { max: 250 }), linkedin, email, phone, staff.id];
      const contact = body.id
        ? (await tx.query(`UPDATE outreach_contacts SET name=$3,title=$4,linkedin_url=$5,email=$6,phone=$7,updated_at=now() WHERE org_id=$1 AND account_id=$2 AND id=$8 RETURNING *`, [...values.slice(0, 7), uuid(body.id, 'contact')])).rows[0]
        : (await tx.query(`INSERT INTO outreach_contacts(org_id,account_id,name,title,linkedin_url,email,phone,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, values)).rows[0];
      if (!contact) fail('Contact not found', 404);
      await appendActivity(tx, staff, a, { next_action: a.next_action || 'Contact banker', next_due_at: a.next_due_at || undefined }, { outcome: 'contact_saved', note: name });
      return { ...base, contact };
    }
    if (body.action === 'save_product') return { ...base, ...await saveProduct(tx, staff, a, body) };
    if (body.action === 'accept_lead' || body.action === 'dismiss_lead') return { ...base, ...await reviewLead(tx, staff, a, body) };
    if (['apply_reply_suggestion', 'dismiss_reply_suggestion', 'mark_reply_handled'].includes(body.action)) return { ...base, ...await reviewReply(tx, staff, a, body) };
    if (body.action === 'stop_emails') {
      const contactId = uuid(body.contact_id, 'contact');
      if (!(await tx.query(`SELECT id FROM outreach_contacts WHERE id=$1 AND account_id=$2 AND org_id=$3`, [contactId, a.id, staff.org_id])).rows.length) fail('Contact not found', 404);
      const stopped = await stopSequence(tx, { orgId: staff.org_id, contactId, reason: 'manual', staffId: staff.id });
      if (stopped) await appendActivity(tx, staff, a, { next_action: a.next_action || 'Contact banker', next_due_at: a.next_due_at || undefined, contact_id: contactId }, { outcome: 'emails_stopped', note: 'Automatic emails stopped by staff' });
      return { ...base, stopped };
    }
    if (body.action === 'log_touch') {
      if (body.status) { status(body.status); if (body.status === 'verified_partner' && a.status !== 'verified_partner') fail('Verify a product before marking this partner verified'); }
      const activity = await appendActivity(tx, staff, a, body, { touch: true });
      if (body.status) await tx.query(`UPDATE outreach_accounts SET status=$3 WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id, body.status]);
      return { ...base, activity, account: await account(tx, staff, a.id) };
    }
    if (body.action === 'set_status') {
      const nextStatus = status(body.status);
      if (nextStatus === 'verified_partner' && !(await tx.query(`SELECT id FROM outreach_products WHERE org_id=$1 AND account_id=$2 AND verified_at IS NOT NULL`, [staff.org_id, a.id])).rows.length) fail('Verify a product before marking this partner verified');
      const partnerActivity = body.partner_activity || a.partner_activity;
      if (!['active', 'quiet'].includes(partnerActivity)) fail('Choose active or quiet partner');
      await appendActivity(tx, staff, a, body, { outcome: `status:${nextStatus}` });
      await tx.query(`UPDATE outreach_accounts SET status=$3,partner_activity=$4,updated_at=now() WHERE org_id=$1 AND id=$2`, [staff.org_id, a.id, nextStatus, partnerActivity]);
      return { ...base, account: await account(tx, staff, a.id) };
    }
    fail('Choose a valid outreach action');
  });
}

export async function schedulePartnerCheckins(db, { now = new Date() } = {}) {
  const at = dueAt(now);
  const result = await db.query(`UPDATE outreach_accounts a SET next_action='Check in with banker',next_due_at=COALESCE(a.last_partner_checkin_at,a.last_touch_at,a.updated_at)+CASE WHEN a.partner_activity='quiet' THEN interval '3 months' ELSE interval '1 month' END,updated_at=$1::timestamptz FROM outreach_programs p WHERE a.program_id=p.id AND a.org_id=p.org_id AND p.key=$2 AND a.status='verified_partner' AND (nullif(btrim(a.next_action),'') IS NULL OR a.next_due_at IS NULL) AND EXISTS(SELECT 1 FROM outreach_products x WHERE x.account_id=a.id AND x.org_id=a.org_id AND x.verified_at IS NOT NULL) RETURNING a.id,a.org_id,a.assigned_staff_id,a.next_due_at`, [at, PROGRAM_KEY]);
  return { ok: true, scheduled: result.rows.length };
}
