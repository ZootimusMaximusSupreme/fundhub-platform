// Banker replies — saved the moment Mailgun hands them over, read on a clock.
//
// SAME SHAPE AS THE BLUEPRINT COACH. The model returns one JSON object (what
// kind of reply, which facts the banker stated). It never writes words a banker
// reads: every reply email is a reviewed template, and the only dynamic part is
// the list of questions still unanswered, built here from FACT_KEYS.
//
// FACTS STAY SUGGESTIONS. Pulled facts are saved on the reply. A rep applies
// them into a product draft (src/outreach/store.mjs apply_reply_suggestion) and
// a manager still verifies into Lenders. Nothing here touches `lenders`.
//
// AGENT BANK-OUTREACH-REPLY (migration 495) decides how much runs:
//   draft  — rules only: STOP, out-of-office, bounces. Everything else waits for a rep.
//   shadow — the model sorts and suggests; the reply is drafted, not sent.
//   live   — the chosen reply is queued (still needs approved copy and mail config).
import { callModel } from '../agents/model.mjs';
import { FACT_KEYS, LENDER_TABLES, normalizeFacts } from './model.mjs';
import { REPLY_KEYS, refFor } from './mail.mjs';
import { templateFor, loadTarget, renderBankEmail, queueBankEmail, logAutomation, stopSequence, iso } from './queue.mjs';

export const AGENT_CODE = 'BANK-OUTREACH-REPLY';
export const KINDS = Object.freeze(['interested', 'data', 'call', 'not_now', 'wrong_person', 'opt_out', 'auto_reply', 'bounce', 'other']);
export const REPLY_CAP_30_DAYS = 3;
export const REPLY_SWEEP_CAP = 5;
const HUMAN_KINDS = new Set(['interested', 'data', 'call', 'not_now', 'wrong_person', 'other']);

/* The banker's own new words, without the thread they replied under. */
export function stripQuoted(body) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const cut = text.search(/^(On .{4,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+)$/im);
  return (cut >= 0 ? text.slice(0, cut) : text).split('\n').filter(line => !/^\s*>/.test(line)).join('\n').trim();
}

const OPT_OUT_FIRST = /^(stop|unsubscribe|remove( me)?|opt[ -]?out|stop emailing( me)?|do not (email|contact) me|please remove me|take me off)\b/i;
const OPT_OUT_ANYWHERE = /\b(unsubscribe|remove me from (your|the|this)|stop emailing me|do not (email|contact) me|take me off (your|the|this) (list|emails?)|opt me out)\b/i;
/* Rules that need no model: a bounce, an out-of-office, a request to stop. */
export function rulesKind({ from_address: from = '', subject = '', body = '' } = {}) {
  if (/mailer-daemon|postmaster@/i.test(from) || /^(undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail)/i.test(subject)) return 'bounce';
  if (/(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|autoreply|away from (my|the) (desk|office)|on vacation|\booo\b)/i.test(subject)) return 'auto_reply';
  const text = stripQuoted(body);
  if (/^\s*unsubscribe\s*$/i.test(subject) || OPT_OUT_FIRST.test(text) || (text.length < 300 && OPT_OUT_ANYWHERE.test(text))) return 'opt_out';
  if (text.length < 1500 && /\b(i am|i'm) (currently )?(out of (the )?office|away|on (vacation|leave))\b|limited access to (my )?e-?mail/i.test(text.slice(0, 500))) return 'auto_reply';
  return null;
}

/* The model's answer, checked field by field. Anything that does not fit the
   shape is dropped, never coerced into a fact. */
export function parseModelReply(textValue) {
  const raw = String(textValue || '');
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const kind = KINDS.includes(obj.kind) && obj.kind !== 'bounce' ? obj.kind : 'other';
  const facts = {};
  if (obj.facts && typeof obj.facts === 'object' && !Array.isArray(obj.facts)) {
    for (const key of FACT_KEYS) {
      if (!Object.hasOwn(obj.facts, key)) continue;
      try { Object.assign(facts, normalizeFacts({ [key]: obj.facts[key] })); } catch { /* not a valid fact: dropped */ }
    }
  }
  const short = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  let referral = null;
  if (obj.referral && typeof obj.referral === 'object') {
    const email = short(obj.referral.email, 320);
    const name = short(obj.referral.name, 120);
    if (name || (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) referral = { name, email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null };
  }
  return {
    kind,
    summary: short(obj.summary, 200),
    product_name: short(obj.product_name, 120),
    lender_table: LENDER_TABLES.includes(obj.lender_table) ? obj.lender_table : null,
    facts,
    evidence_quote: short(obj.evidence_quote, 300),
    referral
  };
}

const QUESTIONS = [
  ['products', 'Which products do you offer? (business cards, personal cards, lines of credit, loans)'],
  ['minimum_score', 'What is the minimum credit score you approve?'],
  ['minimum_time_in_business_years', 'How long does a business need to be open?'],
  ['minimum_revenue_threshold', 'What minimum yearly revenue do you need?'],
  ['bureaus_pulled', 'Which credit bureau do you pull? (Experian, Equifax or TransUnion)'],
  ['inquiry_tolerance', 'How many recent credit inquiries do you accept?'],
  ['stated_income', 'Do you accept stated income?'],
  ['eligible_states', 'Which states do you serve?'],
  ['application', 'Where do clients apply? (an online link or a paper application)']
];
/* The questions still open, numbered. An answer of "unknown" counts as answered. */
export function missingQuestions(known) {
  const has = key => key === 'application' ? known.has('application_url') || known.has('paper_application_url') : known.has(key);
  return QUESTIONS.filter(([key]) => !has(key)).map(([, q], i) => `${i + 1}. ${q}`);
}

async function knownFacts(db, row, parsed) {
  const known = new Set();
  const products = (await db.query(`SELECT facts, draft FROM outreach_products WHERE org_id=$1 AND account_id=$2`, [row.org_id, row.account_id])).rows;
  for (const p of products) {
    known.add('products');
    for (const key of Object.keys(p.facts || {})) known.add(key);
    for (const key of Object.keys(p.draft?.facts || {})) known.add(key);
  }
  const pending = (await db.query(`SELECT suggested FROM outreach_inbound_emails WHERE org_id=$1 AND account_id=$2 AND suggestion_status IN ('pending','applied') AND id<>$3`, [row.org_id, row.account_id, row.id])).rows;
  for (const s of [...pending.map(r => r.suggested), parsed]) {
    if (!s) continue;
    if (s.product_name || s.lender_table) known.add('products');
    for (const key of Object.keys(s.facts || {})) known.add(key);
  }
  return known;
}

export function chooseReply(kind, { missing = [], referral = null } = {}) {
  if (kind === 'call') return 'call';
  if (kind === 'wrong_person') return referral ? null : 'referral';
  if (kind === 'data' || kind === 'interested') return missing.length ? 'ask' : 'thanks';
  return null;
}

/* Does a person need to look? Anything unsure, a call, a named referral, facts
   to apply, or an answer we could not send: yes. A live, sent answer: no. */
export function needsPerson(kind, mode, { queued = false, hasFacts = false, referral = null } = {}) {
  if (!HUMAN_KINDS.has(kind)) return false;
  if (mode !== 'live') return true;
  if (kind === 'not_now') return false;
  if (kind === 'call' || kind === 'other') return true;
  if (kind === 'wrong_person') return !!referral || !queued;
  return !!hasFacts || !queued;
}

const NEXT = {
  call: 'Call the banker: they asked for a call',
  wrong_person: 'Banker pointed to someone else: save the right contact',
  not_now: 'Check back with the banker',
  data: "Apply the banker's facts and save the product",
  interested: 'Answer the interested banker',
  other: 'Read the banker reply and answer'
};

/* Saved straight from the Mailgun webhook. Cheap rules run here too, so a STOP
   or any real reply stops the cold emails before the next pass can send one. */
export async function recordBankerReply(db, { contactId, from = null, subject = null, text = '', messageId = null, now = null } = {}) {
  const contact = (await db.query(`SELECT id, org_id, account_id FROM outreach_contacts WHERE id=$1`, [contactId])).rows[0];
  if (!contact) return { ok: false, reason: 'unknown_banker' };
  const body = String(text || '').slice(0, 20000);
  const inserted = (await db.query(`INSERT INTO outreach_inbound_emails(org_id,account_id,contact_id,provider_message_id,from_address,subject,body,received_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now()))
    ON CONFLICT (org_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING RETURNING id`,
  [contact.org_id, contact.account_id, contact.id, messageId || null, from ? String(from).slice(0, 320) : null, subject ? String(subject).slice(0, 500) : null, body, now ? iso(now) : null])).rows[0];
  if (!inserted) return { ok: true, deduped: true };
  const kind = rulesKind({ from_address: from || '', subject: subject || '', body });
  if (kind === 'opt_out') {
    await db.query(`UPDATE outreach_contacts SET email_opt_out_at=COALESCE(email_opt_out_at,now()),updated_at=now() WHERE org_id=$1 AND id=$2`, [contact.org_id, contact.id]);
    await stopSequence(db, { orgId: contact.org_id, contactId: contact.id, reason: 'opted_out' });
  } else if (kind === 'bounce') {
    await stopSequence(db, { orgId: contact.org_id, contactId: contact.id, reason: 'bounced' });
  } else if (kind !== 'auto_reply') {
    await stopSequence(db, { orgId: contact.org_id, contactId: contact.id, reason: 'replied' });
  }
  return { ok: true, id: inserted.id, deduped: false, kind };
}

function modelInput(row, target) {
  return JSON.stringify({ bank: target.account_name, state: target.state, banker: target.contact_name, subject: row.subject || '', email: stripQuoted(row.body).slice(0, 6000) });
}

async function setAccountNext(db, target, { nextAction, dueAt, engage }) {
  await db.query(`UPDATE outreach_accounts SET next_action=$3,next_due_at=$4::timestamptz,last_touch_at=now(),
      status=CASE WHEN $5::boolean AND status IN ('new','researching','contacted') THEN 'engaged' ELSE status END,updated_at=now()
    WHERE org_id=$1 AND id=$2`, [target.org_id, target.account_id, nextAction, dueAt, engage]);
}

/* One reply, start to finish. Returns what happened; the caller saves errors. */
export async function handleReply(db, row, { env = process.env, now = new Date(), model = callModel } = {}) {
  const target = await loadTarget(db, { orgId: row.org_id, contactId: row.contact_id });
  if (!target) throw new Error('banker or bank row is missing');
  let kind = rulesKind(row);
  let mode = 'rules'; let parsed = null; let error = null;
  if (!kind) {
    const agent = (await db.query(`SELECT status, prompt FROM agents WHERE org_id=$1 AND code=$2`, [row.org_id, AGENT_CODE])).rows[0];
    if (agent && ['shadow', 'live'].includes(agent.status) && String(agent.prompt || '').trim()) {
      const result = await model({ system: agent.prompt, user: modelInput(row, target), env, maxTokens: 700 });
      if (!result || result.mode === 'shadow' || !result.text || result.error) error = String(result?.error || result?.detail || 'the model gave no answer').slice(0, 300);
      else if (!(parsed = parseModelReply(result.text))) error = 'the model answer was not the expected JSON';
      else { kind = parsed.kind; mode = agent.status; }
    }
  }
  kind = kind || 'other';

  const hasFacts = !!(parsed && (Object.keys(parsed.facts).length || parsed.product_name || parsed.lender_table));
  const suggested = parsed && (hasFacts || parsed.referral) ? { product_name: parsed.product_name, lender_table: parsed.lender_table, facts: parsed.facts, evidence_quote: parsed.evidence_quote, referral: parsed.referral } : null;
  const nowIso = iso(now);

  if (kind === 'opt_out') {
    await db.query(`UPDATE outreach_contacts SET email_opt_out_at=COALESCE(email_opt_out_at,now()),updated_at=now() WHERE org_id=$1 AND id=$2`, [row.org_id, row.contact_id]);
    await stopSequence(db, { orgId: row.org_id, contactId: row.contact_id, reason: 'opted_out', now });
    await logAutomation(db, { orgId: row.org_id, accountId: row.account_id, contactId: row.contact_id, channel: 'email', outcome: 'banker_opted_out', note: 'Banker asked us to stop emailing', nextAction: target.next_action, nextDueAt: target.next_due_at });
  } else if (kind === 'bounce') {
    await stopSequence(db, { orgId: row.org_id, contactId: row.contact_id, reason: 'bounced', now });
    await logAutomation(db, { orgId: row.org_id, accountId: row.account_id, contactId: row.contact_id, channel: 'email', outcome: 'email_bounced', note: 'The banker email address bounced', nextAction: target.next_action, nextDueAt: target.next_due_at });
  } else if (HUMAN_KINDS.has(kind)) {
    await stopSequence(db, { orgId: row.org_id, contactId: row.contact_id, reason: 'replied', now });
  }

  let replyMessageId = null; let replyReason = null; let draft = null;
  const known = HUMAN_KINDS.has(kind) ? await knownFacts(db, row, suggested) : new Set();
  const missing = missingQuestions(known);
  const replyKind = mode === 'rules' ? null : chooseReply(kind, { missing, referral: parsed?.referral });
  if (replyKind) {
    const key = REPLY_KEYS[replyKind];
    const tpl = await templateFor(db, row.org_id, key, { approvedOnly: false });
    const rendered = tpl ? renderBankEmail(tpl, target, { env, missingQuestions: missing.join('\n'), replySubject: row.subject }) : null;
    if (!tpl) replyReason = 'template_missing';
    else if (rendered.reason) replyReason = `${rendered.reason}: ${rendered.missing.join(', ')}`;
    else if (mode !== 'live') replyReason = 'shadow_mode';
    else if (!tpl.compliance_passed) replyReason = 'template_pending';
    else if (target.email_opt_out_at || !target.email) replyReason = 'no_email';
    else {
      const sent = (await db.query(`SELECT count(*)::int n FROM messages WHERE org_id=$1 AND provider_ref LIKE $2 AND created_at > now() - interval '30 days'`, [row.org_id, `bank-outreach:${row.contact_id}:reply-%`])).rows[0].n;
      if (sent >= REPLY_CAP_30_DAYS) replyReason = 'reply_cap';
      else {
        replyMessageId = await queueBankEmail(db, { target, templateKey: key, subject: rendered.subject, body: rendered.body, providerRef: refFor(row.contact_id, `reply-${row.id}`) });
        if (!replyMessageId) replyReason = 'already_queued';
      }
    }
    draft = { template_key: key, ...(rendered && !rendered.reason ? { subject: rendered.subject, body: rendered.body } : {}), approved: !!tpl?.compliance_passed, queued_message_id: replyMessageId, reason: replyReason };
  }

  const person = needsPerson(kind, mode, { queued: !!replyMessageId, hasFacts, referral: parsed?.referral });
  if (HUMAN_KINDS.has(kind)) {
    const later = kind === 'not_now' && mode === 'live';
    const nextAction = hasFacts ? NEXT.data : NEXT[kind] || NEXT.other;
    const dueAt = later ? new Date(new Date(nowIso).getTime() + 90 * 86400000).toISOString() : nowIso;
    await setAccountNext(db, target, { nextAction, dueAt, engage: kind !== 'not_now' });
    const note = [parsed?.summary || 'Banker replied by email', replyMessageId ? 'Reply email queued.' : replyReason ? `Reply not sent (${replyReason}).` : null].filter(Boolean).join(' ');
    await logAutomation(db, { orgId: row.org_id, accountId: row.account_id, contactId: row.contact_id, channel: 'email', outcome: `banker_reply:${kind}`, note, nextAction, nextDueAt: dueAt });
  }

  const status = person || error ? 'needs_human' : 'handled';
  await db.query(`UPDATE outreach_inbound_emails SET status=$3,kind=$4,ai_mode=$5,summary=$6,suggested=$7::jsonb,suggestion_status=$8,draft_reply=$9::jsonb,reply_message_id=$10,error=$11,processed_at=$12::timestamptz,updated_at=now()
    WHERE org_id=$1 AND id=$2`,
  [row.org_id, row.id, status, kind, mode, parsed?.summary || null, suggested ? JSON.stringify(suggested) : null, hasFacts ? 'pending' : 'none', draft ? JSON.stringify(draft) : null, replyMessageId, error, nowIso]);
  return { id: row.id, kind, mode, status, replyMessageId, replyReason, error };
}

/* Every new reply, a few per pass. Never throws: the next pass is the retry,
   and after three failed tries the reply goes to a person with the error. */
export async function processReplies(db, { env = process.env, now = new Date(), model = callModel, cap = REPLY_SWEEP_CAP } = {}) {
  const claimed = (await db.query(`UPDATE outreach_inbound_emails r SET attempts=r.attempts+1,updated_at=now()
    WHERE r.id IN (SELECT id FROM outreach_inbound_emails WHERE status='new' AND attempts<3 ORDER BY received_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING r.*`, [cap])).rows;
  const results = [];
  for (const row of claimed) {
    try { results.push(await handleReply(db, row, { env, now, model })); }
    catch (err) {
      const message = String(err?.message || err).slice(0, 300);
      await db.query(`UPDATE outreach_inbound_emails SET error=$2,status=CASE WHEN attempts>=3 THEN 'needs_human' ELSE status END,processed_at=CASE WHEN attempts>=3 THEN now() ELSE processed_at END,updated_at=now() WHERE id=$1`, [row.id, message]);
      results.push({ id: row.id, error: message });
    }
  }
  return { ok: true, processed: results.length, results };
}
