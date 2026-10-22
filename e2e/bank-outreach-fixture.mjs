import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, OWNER, json } from './harness.mjs';
import { STATE_CODES } from '../src/outreach/model.mjs';

// Shared fictional data for Chromium and WebKit. Never reaches a live API.
const REP = { ok: true, staff: { ...OWNER.staff, id: 'rep-1', role: 'outbound_rep', name: 'Casey Reed' } };
const account = i => ({ id: 'bank-' + i, name: ['Mesa Community Bank', 'Coastal Business Credit Union', 'Pacific Commercial Bank'][i % 3] + (i > 2 ? ' ' + (i + 1) : ''), source: 'fdic', external_id: String(1000 + i), state: ['AZ', 'SC', 'FL', 'CA'][i % 4], city: 'Phoenix', website: 'https://bank.example', assigned_staff_id: 'rep-1', assigned_staff_name: 'Casey Reed', status: 'researching', partner_activity: 'active', next_action: 'Confirm business line requirements with banker', next_due_at: '2026-01-01T15:00:00Z' });
const summary = { verified_products_week: 7, verified_products_previous_week: 4, verified_partners: 12, missing_next_action: 0, due_now: 18, total: 27, leads_waiting: 0, replies_waiting: 0 };
const contacts = [{ id: 'contact-1', name: 'Avery Lane', title: 'Business banker', email: 'avery@bank.example', phone: '+16025550101', linkedin_url: 'https://www.linkedin.com/in/avery-fixture' }];
export const facts = { minimum_score: 'unknown', minimum_time_in_business_years: 2, minimum_revenue_threshold: 250000, bureaus_pulled: ['EX', 'EQ'], inquiry_tolerance: 'Up to 3 in 6 months', stated_income: false, eligible_states: ['AZ', 'CA'], application_url: 'https://bank.example/apply', paper_application_url: 'unknown' };
const product = { id: 'product-1', product_name: 'Business working capital line', lender_table: 'BizLOC_Documented', facts, evidence: 'Avery Lane · banker email · October 19, 2026', verified_at: null };

// The product field catalog, copied from the build spec's tables
// (docs/specs/bank-outreach-manual-first-2026-10-21.md §1). Order is the catalog order.
// A spec case proves this copy equals the server's productFields().
const FIELD_ROWS = [
  ['minimum_score', 'Minimum credit score', 'score'], ['minimum_time_in_business_years', 'Minimum years in business', 'years'],
  ['minimum_revenue_threshold', 'Minimum yearly revenue', 'money'], ['bureaus_pulled', 'Bureaus pulled', 'bureaus'],
  ['inquiry_tolerance', 'Inquiries they accept', 'text'], ['stated_income', 'Accepts stated income', 'yesno'],
  ['eligible_states', 'States served', 'states'], ['application_url', 'Online application link', 'url'],
  ['paper_application_url', 'Paper application link', 'url'], ['double_pull', 'Pulls two bureaus', 'yesno'],
  ['relationship_required', 'Needs an existing relationship', 'yesno'], ['requires_account_opening', 'Must open an account first', 'yesno'],
  ['minimum_deposit', 'Minimum deposit', 'money'], ['prequal_soft_pull', 'Soft-pull pre-qualification', 'yesno'],
  ['business_bureau_pulled', 'Business bureau pulled', 'text'], ['underwriter', 'Who underwrites it', 'text'],
  ['intro_offers', 'Intro offer', 'text'], ['multiple_llc_allowed', 'More than one LLC allowed', 'yesno'],
  ['application_method', 'How clients apply', 'text'], ['typical_amount', 'Typical approved amount', 'money'],
  ['apr_pct', 'APR (percent)', 'pct'], ['repayment_months', 'Repayment months', 'months'],
  ['funding_speed', 'How fast it funds', 'text'], ['average_starting_line', 'Usual starting line', 'money'],
  ['max_line', 'Largest line', 'money'], ['draw_and_renewal', 'Draw period and renewal', 'text'],
  ['documents_required', 'Documents required', 'text'], ['collateral_required', 'Collateral required', 'yesno'],
  ['line_type', 'Line type', 'text']
];
const EVERY_PRODUCT = ['minimum_score', 'bureaus_pulled', 'double_pull', 'inquiry_tolerance', 'stated_income', 'eligible_states', 'application_url', 'paper_application_url', 'relationship_required', 'requires_account_opening', 'minimum_deposit', 'prequal_soft_pull'];
const BUSINESS_ONLY = ['minimum_time_in_business_years', 'minimum_revenue_threshold'];
const BIZ_CARD = [...BUSINESS_ONLY, 'business_bureau_pulled', 'underwriter', 'intro_offers', 'multiple_llc_allowed'];
const BIZ_LINE = [...BUSINESS_ONLY, 'business_bureau_pulled', 'average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'documents_required', 'collateral_required', 'line_type'];
const ADDS = { OnlineBizCC: BIZ_CARD, InBranchBizCC: BIZ_CARD, BizLOC_Stated: BIZ_LINE, BizLOC_Documented: BIZ_LINE, PersonalCC: ['underwriter', 'intro_offers'], PersonalLOC: ['average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'collateral_required'], PersonalLoans: ['application_method', 'typical_amount', 'apr_pct', 'repayment_months', 'funding_speed'] };
const inCatalogOrder = keys => FIELD_ROWS.map(([key]) => key).filter(key => keys.includes(key));
export const PRODUCT_FIELDS = Object.freeze({
  fields: Object.fromEntries(FIELD_ROWS.map(([key, label, type]) => [key, { label, type }])),
  types: Object.fromEntries(Object.entries(ADDS).map(([table, adds]) => [table, inCatalogOrder([...EVERY_PRODUCT, ...adds])])),
  notApplicable: Object.fromEntries(Object.entries(ADDS).map(([table, adds]) => [table, BUSINESS_ONLY.filter(key => !adds.includes(key))]))
});
// Fictional warm-up copy for Avery Lane. It carries characters a mailto:/sms: link must encode.
export const WARMUP = {
  email: { subject: 'Arizona clients for Mesa Community Bank & a quick call?', body: "Hi Avery,\n\nI'm Casey with Fundhub. I have Arizona clients who need business cards and lines of credit. Can we hop on a quick call so I learn what you look for?\n\nCasey Reed\nFundhub" },
  text: "Hi Avery, it's Casey with Fundhub. I have Arizona clients for Mesa Community Bank. Can we set up a quick call this week? Reply STOP to opt out."
};

// Automation data for one fictional bank (bank-0). Every row agrees with the others:
// the two bankers who replied have stopped emails, the STOP reply opted Riley out,
// and the queue counts match the found bankers and replies still waiting.
const autoCounts = i => ({ leads_waiting: i === 0 ? 2 : i % 6 === 2 ? 1 : 0, replies_waiting: i === 0 ? 2 : i % 9 === 4 ? 1 : 0 });
const autoTotals = Array.from({ length: 27 }, (_, i) => autoCounts(i)).reduce((sum, c) => ({ leads_waiting: sum.leads_waiting + c.leads_waiting, replies_waiting: sum.replies_waiting + c.replies_waiting }), { leads_waiting: 0, replies_waiting: 0 });
const autoData = () => ({
  account: { ...account(0), status: 'engaged', next_action: "Apply the banker's facts and save the product", next_due_at: '2026-10-17T20:10:00Z' },
  contacts: [
    { ...contacts[0], email_opt_out_at: null },
    { id: 'contact-2', name: 'Jordan Pike', title: 'Business relationship manager', email: 'jordan.pike@bank.example', phone: '', linkedin_url: 'https://www.linkedin.com/in/jordan-pike-fixture', email_opt_out_at: null },
    { id: 'contact-3', name: 'Morgan Hale', title: 'Small business lending officer', email: 'morgan.hale@bank.example', phone: '+16025550133', linkedin_url: '', email_opt_out_at: null },
    { id: 'contact-4', name: 'Riley Shaw', title: 'Branch manager', email: 'riley.shaw@bank.example', phone: '', linkedin_url: '', email_opt_out_at: '2026-10-16T17:20:00Z' }
  ],
  leads: [
    { id: 'lead-1', name: 'Taylor Brooks', title: 'Business banking officer', employer: 'Mesa Community Bank', linkedin_url: 'https://www.linkedin.com/in/taylor-brooks-fixture', snippet: 'Business banking officer at Mesa Community Bank in Phoenix. Helps local owners with business cards and lines of credit.', confidence: 'high', status: 'suggested', contact_id: null, created_at: '2026-10-20T15:15:00Z' },
    { id: 'lead-2', name: 'Dana Ruiz', title: 'Commercial lending assistant', employer: 'Mesa Community Bank', linkedin_url: 'https://www.linkedin.com/in/dana-ruiz-fixture', snippet: 'Commercial lending team, Mesa Community Bank, Tempe, Arizona.', confidence: 'medium', status: 'suggested', contact_id: null, created_at: '2026-10-20T15:15:00Z' },
    { id: 'lead-3', name: 'Jordan Pike', title: 'Business relationship manager', employer: 'Mesa Community Bank', linkedin_url: 'https://www.linkedin.com/in/jordan-pike-fixture', snippet: 'Business relationship manager at Mesa Community Bank.', confidence: 'high', status: 'accepted', contact_id: 'contact-2', created_at: '2026-10-06T15:15:00Z' },
    { id: 'lead-4', name: 'Sam Ortiz', title: 'Teller', employer: 'Mesa Community Bank', linkedin_url: 'https://www.linkedin.com/in/sam-ortiz-fixture', snippet: 'Teller at a Mesa Community Bank branch.', confidence: 'medium', status: 'dismissed', contact_id: null, created_at: '2026-10-06T15:15:00Z' }
  ],
  sequences: [
    { id: 'seq-1', contact_id: 'contact-1', status: 'active', step: 1, next_due_at: '2026-10-24T16:00:00Z', last_sent_at: '2026-10-20T16:05:00Z', stopped_at: null, stop_reason: null },
    { id: 'seq-2', contact_id: 'contact-2', status: 'stopped', step: 2, next_due_at: '2026-10-19T16:00:00Z', last_sent_at: '2026-10-14T16:05:00Z', stopped_at: '2026-10-15T18:40:00Z', stop_reason: 'replied' },
    { id: 'seq-3', contact_id: 'contact-3', status: 'stopped', step: 1, next_due_at: '2026-10-17T16:00:00Z', last_sent_at: '2026-10-13T16:05:00Z', stopped_at: '2026-10-17T20:10:00Z', stop_reason: 'replied' },
    { id: 'seq-4', contact_id: 'contact-4', status: 'stopped', step: 1, next_due_at: '2026-10-17T16:00:00Z', last_sent_at: '2026-10-13T16:05:00Z', stopped_at: '2026-10-16T17:20:00Z', stop_reason: 'opted_out' }
  ],
  replies: [
    { id: 'reply-2', contact_id: 'contact-3', from_address: 'morgan.hale@bank.example', subject: 'Re: Fundhub referrals', body: 'Can we set up a call next week?\nOur Business Platinum Card needs 3 years in business and $250,000 in yearly revenue.\n\nMorgan', received_at: '2026-10-17T20:10:00Z', status: 'needs_human', kind: 'call', ai_mode: 'shadow', summary: 'Banker asked for a call and shared card rules.', suggested: { product_name: 'Business Platinum Card', lender_table: 'OnlineBizCC', facts: { minimum_time_in_business_years: 3, minimum_revenue_threshold: 250000 }, evidence_quote: 'Our Business Platinum Card needs 3 years in business and $250,000 in yearly revenue.', referral: null }, suggestion_status: 'pending', draft_reply: { template_key: 'EMAIL-BANK-OUTREACH-REPLY-CALL', subject: 'Re: Fundhub referrals', body: 'Thanks, Morgan.\nA call works. Pick a time that suits you this week.', approved: false, queued_message_id: null, reason: 'shadow_mode' }, reply_message_id: null, error: null, processed_at: '2026-10-17T20:12:00Z' },
    { id: 'reply-3', contact_id: 'contact-4', from_address: 'riley.shaw@bank.example', subject: 'STOP', body: 'STOP', received_at: '2026-10-16T17:20:00Z', status: 'handled', kind: 'opt_out', ai_mode: 'rules', summary: null, suggested: null, suggestion_status: 'none', draft_reply: null, reply_message_id: null, error: null, processed_at: '2026-10-16T17:21:00Z' },
    { id: 'reply-1', contact_id: 'contact-2', from_address: 'jordan.pike@bank.example', subject: 'Re: Business clients for Mesa Community Bank', body: 'Hi Casey,\nWe approve business cards from a 680 score with 2 years in business.\nWe pull Experian only. Apply here: https://bank.example/business-card\n<b>Not markup</b>\n\nJordan', received_at: '2026-10-15T18:40:00Z', status: 'needs_human', kind: 'data', ai_mode: 'shadow', summary: 'Banker shared business card rules and an application link.', suggested: { product_name: null, lender_table: null, facts: { minimum_score: 680, minimum_time_in_business_years: 2, bureaus_pulled: ['EX'], application_url: 'https://bank.example/business-card' }, evidence_quote: 'We approve business cards from a 680 score with 2 years in business.', referral: null }, suggestion_status: 'pending', draft_reply: { template_key: 'EMAIL-BANK-OUTREACH-REPLY-ASK', subject: 'Re: Business clients for Mesa Community Bank', body: 'Thanks, Jordan.\n1. What minimum yearly revenue do you need?\n2. How many recent credit inquiries do you accept?', approved: false, queued_message_id: null, reason: 'shadow_mode' }, reply_message_id: null, error: null, processed_at: '2026-10-15T18:42:00Z' }
  ],
  activities: [
    { id: 'act-4', actor: 'automation', staff_id: null, staff_name: null, channel: 'email', outcome: 'auto_email_step_1', note: 'Automatic email 1 of 3 queued', next_action: "Apply the banker's facts and save the product", next_due_at: '2026-10-17T20:10:00Z', created_at: '2026-10-20T16:05:00Z' },
    { id: 'act-3', actor: 'automation', staff_id: null, staff_name: null, channel: 'linkedin', outcome: 'bankers_found', note: '2 bankers found by a LinkedIn search', next_action: "Apply the banker's facts and save the product", next_due_at: '2026-10-17T20:10:00Z', created_at: '2026-10-20T15:15:00Z' },
    { id: 'act-2', actor: 'automation', staff_id: null, staff_name: null, channel: 'email', outcome: 'banker_reply:call', note: 'Banker asked for a call and shared card rules. Reply not sent (shadow_mode).', next_action: "Apply the banker's facts and save the product", next_due_at: '2026-10-17T20:10:00Z', created_at: '2026-10-17T20:12:00Z' },
    { id: 'act-1', actor: 'staff', staff_id: 'rep-1', staff_name: 'Casey Reed', channel: 'linkedin', outcome: 'contact_saved', note: 'Jordan Pike', next_action: 'Contact banker', next_due_at: '2026-10-06T16:00:00Z', created_at: '2026-10-06T16:00:00Z' }
  ]
});
const automationViewFor = (config, empty) => empty
  ? { search: { configured: true, signup_url: 'https://serper.dev', per_day_cap: 80, used_today: 0, never_searched: 0, accounts: 0 }, email: { configured: true, missing: [], in_send_window: true, per_day_cap: 40, sent_today: 0, templates_approved: 3, templates_total: 7, active_sequences: 0, sequences: 0 }, replies: { agent_status: 'shadow', waiting: 0, needs_human: 0 } }
  : config === 'unset'
    ? { search: { configured: false, signup_url: 'https://serper.dev', per_day_cap: 80, used_today: 0, never_searched: 27, accounts: 27 }, email: { configured: false, missing: ['BANK_OUTREACH_FROM', 'BANK_OUTREACH_POSTAL_ADDRESS'], in_send_window: false, per_day_cap: 40, sent_today: 0, templates_approved: 0, templates_total: 7, active_sequences: 0, sequences: 0 }, replies: { agent_status: 'draft', waiting: 0, needs_human: 0 } }
    : { search: { configured: true, signup_url: 'https://serper.dev', per_day_cap: 80, used_today: 12, never_searched: 9, accounts: 27 }, email: { configured: true, missing: [], in_send_window: true, per_day_cap: 40, sent_today: 1, templates_approved: 3, templates_total: 7, active_sequences: 1, sequences: 4 }, replies: { agent_status: 'shadow', waiting: 0, needs_human: 2 } };
// 'approved': every setting saved and all 7 bank emails approved.
const automationView = (config, empty) => {
  const view = automationViewFor(config === 'approved' ? 'ready' : config, empty);
  if (config === 'approved') view.email.templates_approved = view.email.templates_total;
  return view;
};
// The store's own 409 words for a second review of the same row.
const CONFLICT = { accept_lead: 'This found banker was already reviewed', dismiss_lead: 'This found banker was already reviewed', apply_reply_suggestion: 'This reply has no facts waiting', dismiss_reply_suggestion: 'This reply has no facts waiting' };

// catalog: answer like the server that sends productFields and banker warm-ups.
// Without it, every response has today's shape (the fallback the screen must keep).
export async function fixture(page, { manager = false, state = 'full', failWrite = false, published = false, draft = false, filteredEmpty = false, filteredInactive = false, automation = false, autoConfig = 'ready', states = STATE_CODES, catalog = false } = {}) {
  const posts = [], reads = [], faults = { detail: false, team: false, automation: false, conflict: null }, gates = {}, data = { account: account(0), contacts: structuredClone(contacts), products: [{ ...structuredClone(product), verified_at: published ? '2026-10-19T15:00:00Z' : null }] };
  if (automation) Object.assign(data, autoData());
  if (catalog) data.contacts[0].warmup = structuredClone(WARMUP);
  const hold = name => { let open; gates[name] = new Promise(resolve => { open = resolve; }); return () => { delete gates[name]; open(); }; };
  if (draft) data.products[0].draft = { ...structuredClone(product), product_name: 'Proposed business line', facts: { ...facts, minimum_score: 680 } };
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
  // Like the server: a rep's seat list holds only their own seat.
  const base = { ok: true, canManage: manager, program: { states: [...states] }, summary: state === 'empty' ? Object.fromEntries(Object.keys(summary).map(key => [key, 0])) : automation ? { ...summary, ...autoTotals } : summary, reps: manager ? [{ id: 'rep-1', name: 'Casey Reed' }, { id: 'rep-2', name: 'Morgan Ellis' }] : [{ id: 'rep-1', name: 'Casey Reed' }], ...(catalog ? { productFields: structuredClone(PRODUCT_FIELDS) } : {}) };
  const item = i => (automation ? { ...account(i), ...autoCounts(i), ...(i === 0 ? { status: data.account.status, next_action: data.account.next_action, next_due_at: data.account.next_due_at } : {}) } : account(i));
  await openScreen(page, '/app/bank-outreach.html', manager ? OWNER : REP, {
    '/api/read/bank-outreach': async (route, { url }) => {
      const query = Object.fromEntries(new URL(url).searchParams); reads.push(query);
      if (query.id) return faults.detail ? { ok: false, message: 'Banker details could not load.' } : { ...base, ...data };
      if (query.view === 'team' && faults.team) return { ok: false, message: 'Team results could not load.' };
      if (query.view === 'automation') {
        if (!manager) return json(route, { ok: false, message: 'A manager must do this' }, 403);
        if (gates.automation) await gates.automation;
        if (faults.automation) return { ok: false, message: 'Automation status could not load.' };
        return { ...base, automation: automationView(autoConfig, state === 'empty') };
      }
      if (query.view === 'team') return { ...base, byRep: state === 'empty' ? [] : [{ staff_id: 'rep-1', name: 'Casey Reed', total: 14, verified_partners: 7, due_now: 8 }, { staff_id: 'rep-2', name: 'Morgan Ellis', total: 13, verified_partners: 5, due_now: 10 }], byState: state === 'empty' ? [] : ['AZ', 'SC', 'FL', 'CA'].map(state => ({ state, total: 7, verified_partners: 3, due_now: 4 })) };
      if (state === 'loading') await pending;
      if (state === 'error') return { ok: false, message: 'The bank list is temporarily unavailable.' };
      if (filteredEmpty && (query.q || query.state || query.status)) return { ...base, total: 0, items: [] };
      if (filteredInactive && ['paused', 'closed'].includes(query.status)) { data.account = { ...account(0), status: query.status }; return { ...base, total: 1, items: [data.account] }; }
      return { ...base, total: state === 'empty' ? 0 : 27, items: state === 'empty' ? [] : Array.from({ length: Number(query.offset || 0) ? 2 : 25 }, (_, i) => item(i + Number(query.offset || 0))) };
    },
    '/api/bank-outreach': async route => {
      const body = JSON.parse(route.request().postData()); posts.push(body);
      if (failWrite) return json(route, { ok: false, message: 'Save failed. Your notes are still here.' }, 500);
      if (automation && CONFLICT[body.action] && faults.conflict === body.action) {
        // Another teammate reviewed it first: the saved row changed, and this save is refused.
        const lead = data.leads.find(l => l.id === body.lead_id), reply = data.replies.find(r => r.id === body.reply_id);
        if (lead) lead.status = body.action === 'accept_lead' ? 'accepted' : 'dismissed';
        if (reply) Object.assign(reply, { suggestion_status: body.action === 'apply_reply_suggestion' ? 'applied' : 'dismissed' });
        return json(route, { ok: false, message: CONFLICT[body.action] }, 409);
      }
      if (body.action === 'accept_lead' || body.action === 'dismiss_lead') {
        const lead = data.leads.find(l => l.id === body.lead_id);
        if (lead.status !== 'suggested') return json(route, { ok: false, message: CONFLICT[body.action] }, 409);
        if (body.action === 'accept_lead') { const contact = { id: 'contact-' + (data.contacts.length + 1), name: lead.name, title: lead.title, email: null, phone: null, linkedin_url: lead.linkedin_url, email_opt_out_at: null }; data.contacts.push(contact); Object.assign(lead, { status: 'accepted', contact_id: contact.id }); }
        else lead.status = 'dismissed';
      }
      if (body.action === 'stop_emails') Object.assign(data.sequences.find(s => s.contact_id === body.contact_id && s.status === 'active'), { status: 'stopped', stop_reason: 'manual', stopped_at: '2026-10-20T19:00:00Z' });
      if (['apply_reply_suggestion', 'dismiss_reply_suggestion', 'mark_reply_handled'].includes(body.action)) {
        const reply = data.replies.find(r => r.id === body.reply_id);
        if (body.action === 'mark_reply_handled') reply.status = 'handled';
        else if (reply.suggestion_status !== 'pending') return json(route, { ok: false, message: CONFLICT[body.action] }, 409);
        else if (body.action === 'dismiss_reply_suggestion') reply.suggestion_status = 'dismissed';
        else {
          const s = reply.suggested;
          data.products.push({ id: 'product-' + (data.products.length + 1), product_name: body.product_name ?? s.product_name, lender_table: body.lender_table ?? s.lender_table, facts: s.facts, evidence: `Banker email from ${reply.from_address} on ${reply.received_at.slice(0, 10)}: "${s.evidence_quote}"`, verified_at: null });
          Object.assign(reply, { suggestion_status: 'applied', status: 'handled' });
        }
      }
      if (body.action === 'save_contact') { const contact = { ...body, id: body.id || 'contact-2' }; const index = data.contacts.findIndex(c => c.id === contact.id); if (index < 0) data.contacts.push(contact); else data.contacts[index] = contact; }
      if (body.action === 'log_touch') { data.account.next_action = body.next_action; if (body.next_due_at) data.account.next_due_at = body.next_due_at; }
      if (body.action === 'save_product') { data.products = [{ ...body, id: body.id || 'product-2', verified_at: null }]; }
      if (body.action === 'verify_product') data.products[0].verified_at = new Date().toISOString();
      if (body.action === 'set_status') Object.assign(data.account, { status: body.status, next_action: body.next_action, partner_activity: body.partner_activity });
      if (body.action === 'assign') data.account.assigned_staff_id = body.staff_id;
      return json(route, { ...base, imported: 3, existing: 2, skipped: 1 });
    }
  });
  return { posts, reads, faults, data, release, hold };
}

export async function astraMeasurements(page, scope = 'body') {
  return page.locator(scope).evaluate((root, scope) => {
    const visible = el => {
      if (el.closest('[hidden],[aria-hidden="true"],dialog:not([open])')) return false;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS' && !ancestor.open &&
            !ancestor.querySelector(':scope > summary')?.contains(el)) return false;
      }
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility === 'visible' &&
        Number(style.opacity) !== 0 && box.width > 1 && box.height > 1;
    };
    const info = el => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return {
        tag: el.tagName, id: el.id, name: el.getAttribute('name'),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 100),
        font: parseFloat(style.fontSize), width: box.width, height: box.height,
      };
    };
    const controls = [...root.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,summary')]
      .filter(visible).map(info);
    const text = [...root.querySelectorAll('*')].filter(visible).filter(el =>
      [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())).map(info);
    return {
      scope, viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      controls, smallTargets: controls.filter(c => c.width < 43.99 || c.height < 43.99),
      smallInputs: controls.filter(c => /^(INPUT|SELECT|TEXTAREA)$/.test(c.tag) && c.font < 16),
      smallText: text.filter(t => t.font < 13),
      primary: [...root.querySelectorAll('.button.primary')].filter(visible).map(info),
    };
  }, scope);
}

export async function expectAstraControls(page, testInfo, state, scope = 'body') {
  const measured = await astraMeasurements(page, scope);
  await testInfo.attach(state + '-measurements', {
    body: JSON.stringify(measured, null, 2), contentType: 'application/json',
  });
  expect(measured.pageWidth, state + ': no sideways page overflow').toBeLessThanOrEqual(measured.viewport.width + 1);
  expect(measured.bodyFont, state + ': body text').toBe(16);
  expect(measured.smallTargets, state + ': rendered targets below 44px').toEqual([]);
  expect(measured.smallInputs, state + ': editable text below 16px').toEqual([]);
  expect(measured.smallText, state + ': captions below 13px').toEqual([]);
  for (const primary of measured.primary) expect(primary.height, state + ': primary ' + primary.text).toBeGreaterThanOrEqual(48);
  return measured;
}

export async function captureAstra(page, testInfo, name, selector) {
  if (!process.env.BANK_OUTREACH_CAPTURE) return;
  const output = path.resolve('ops/workflows/build-evidence/bank-outreach/astra');
  fs.mkdirSync(output, { recursive: true });
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.evaluate(({ selector, name }) => {
    const target = document.querySelector(selector), box = target.getBoundingClientRect();
    const host = document.querySelector('dialog[open]') || document.body;
    const overlay = document.createElement('div'); overlay.id = 'bank-astra-evidence';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border:2px solid #d32323`;
    const caption = document.createElement('div');
    const edge = box.bottom > innerHeight - 112 && box.top > 112 ? 'top' : 'bottom';
    caption.style.cssText = `position:absolute;${edge}:8px;left:8px;right:8px;background:#fff;border:2px solid #d32323;padding:8px;color:#a11313;font:13px/1.4 system-ui`;
    caption.textContent = name + ' · Safe local fixture, not live bank facts. Red box marks the measured controls.';
    overlay.append(ring, caption); host.append(overlay);
  }, { selector, name });
  const filename = `${testInfo.project.name}-${name}.png`;
  try {
    const screenshot = await page.screenshot({ path: path.join(output, filename), scale: 'css' });
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
  } finally { await page.locator('#bank-astra-evidence').evaluate(el => el.remove()); }
}

export async function inspectExpandedShell(page, testInfo, prefix) {
  await page.locator('#fh-shell-chip-show').click();
  await page.locator('.fh-account-technical > summary').click();
  await expect(page.locator('.fh-account-technical')).toHaveAttribute('open', '');
  await expectAstraControls(page, testInfo, prefix + '-account-open');
  const signOut = page.locator('#fh-shell-out');
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  await signOut.click({ trial: true }); // Prove reachability without signing out.
  await captureAstra(page, testInfo, prefix + '-account-open', '.fh-account-menu');
  await page.locator('#fh-shell-chip-show').click();
  // The nested disclosure remains open inside a closed parent. It is not visible.
  await expectAstraControls(page, testInfo, prefix + '-account-closed');
  await page.locator('#fh-workspace-scope > summary').click();
  await expect(page.locator('#fh-workspace-scope')).toHaveAttribute('open', '');
  await expectAstraControls(page, testInfo, prefix + '-context-open');
  await captureAstra(page, testInfo, prefix + '-context-open', '.fh-context-panel');
  await page.locator('#fh-workspace-scope > summary').click();
}
