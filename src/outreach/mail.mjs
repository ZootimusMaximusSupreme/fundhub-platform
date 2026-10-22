// Banker email plumbing — template keys, config, the footer, the reply tag and
// the unsubscribe link. Pure apart from reading env. Nothing here sends.
//
// A banker is not a client. Their opt-out lives on outreach_contacts, their
// replies come back to reply+bk-<contact id>@<reply domain>, and their
// unsubscribe link is the clients' page with channel=banker_email. The channel
// is inside the signed string (src/messaging/unsubscribe.mjs), so a banker link
// can never be edited into a client link, or the other way round.
import { signUnsubscribeUrl } from '../messaging/unsubscribe.mjs';

export const COLD_STEPS = Object.freeze([
  Object.freeze({ step: 1, afterDays: 0, key: 'EMAIL-BANK-OUTREACH-1' }),
  Object.freeze({ step: 2, afterDays: 4, key: 'EMAIL-BANK-OUTREACH-2' }),
  Object.freeze({ step: 3, afterDays: 5, key: 'EMAIL-BANK-OUTREACH-3' })
]);
export const REPLY_KEYS = Object.freeze({
  ask: 'EMAIL-BANK-OUTREACH-REPLY-ASK',
  thanks: 'EMAIL-BANK-OUTREACH-REPLY-THANKS',
  call: 'EMAIL-BANK-OUTREACH-REPLY-CALL',
  referral: 'EMAIL-BANK-OUTREACH-REPLY-REFERRAL'
});
export const COLD_KEYS = Object.freeze(COLD_STEPS.map(s => s.key));
/** Every key that may leave with no client attached; src/messaging/gate.mjs reads this. */
export const BANK_EMAIL_KEYS = Object.freeze([...COLD_KEYS, ...Object.values(REPLY_KEYS)]);
export const BANKER_CHANNEL = 'banker_email';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REF_RE = new RegExp(`^bank-outreach:(${UUID}):(step[1-3]|reply-${UUID})$`, 'i');
const TAG_RE = new RegExp(`(?:^|[<\\s,])reply\\+bk-(${UUID})@`, 'i');

export const refFor = (contactId, kind) => `bank-outreach:${contactId}:${kind}`;
export function contactIdFromRef(ref) { return REF_RE.exec(String(ref || ''))?.[1]?.toLowerCase() || null; }
export function replyTagFor(contactId) { return new RegExp(`^${UUID}$`, 'i').test(String(contactId || '')) ? `bk-${String(contactId).toLowerCase()}` : null; }
export function contactIdFromRecipient(recipient) { return TAG_RE.exec(String(recipient || '').trim())?.[1]?.toLowerCase() || null; }

export function publicBaseUrl(env = process.env) {
  return String(env.APP_BASE_URL || env.URL || 'https://fundhub.ai').replace(/\/+$/, '');
}

const masked = v => !v || String(v).includes('*');
/** What sending needs. Missing pieces are named; none is invented. */
export function mailConfig(env = process.env) {
  const from = String(env.BANK_OUTREACH_FROM || '').trim();
  const postal = String(env.BANK_OUTREACH_POSTAL_ADDRESS || '').trim();
  const replyDomain = String(env.RESEND_REPLY_TO_DOMAIN || '').trim();
  const missing = [];
  if (masked(from) || !/@/.test(from)) missing.push('BANK_OUTREACH_FROM');
  if (masked(postal) || postal.length < 10) missing.push('BANK_OUTREACH_POSTAL_ADDRESS');
  if (masked(replyDomain)) missing.push('RESEND_REPLY_TO_DOMAIN');
  if (masked(env.UNSUBSCRIBE_TOKEN_SECRET) && masked(env.DOCUMENT_URL_SECRET)) missing.push('UNSUBSCRIBE_TOKEN_SECRET');
  return { ok: missing.length === 0, missing, from, postal, replyDomain };
}

export function bankerUnsubscribeUrl({ orgId, contactId, env = process.env, now = Date.now }) {
  return signUnsubscribeUrl({ orgId, clientId: contactId, channel: BANKER_CHANNEL, baseUrl: publicBaseUrl(env), env, now }).url;
}

export function footer({ postal, unsubscribeUrl }) {
  return [`Fundhub · ${postal}`, `To stop these emails, reply STOP or open ${unsubscribeUrl}`].join('\n');
}

/* What the dispatcher adds to a banker email: the From, the reply tag and the
   one-click unsubscribe header. null for every other message. A banker message
   with no From configured comes back with an error so it is held, never sent
   from the default client address. */
export function bankEnvelope(message, env = process.env) {
  if (!BANK_EMAIL_KEYS.includes(String(message?.template_key || ''))) return null;
  const contactId = contactIdFromRef(message.provider_ref);
  if (!contactId) return { error: 'bank outreach email has no banker reference' };
  const cfg = mailConfig(env);
  if (!cfg.ok) return { error: `bank outreach email is missing ${cfg.missing.join(', ')}` };
  let unsubscribeUrl = null;
  try { unsubscribeUrl = bankerUnsubscribeUrl({ orgId: message.org_id, contactId, env }); } catch { unsubscribeUrl = null; }
  if (!unsubscribeUrl) return { error: 'bank outreach unsubscribe link could not be signed' };
  return { from: cfg.from, replyTag: replyTagFor(contactId), unsubscribeUrl, contactId };
}

const firstNameOf = full => String(full || '').trim().split(/\s+/)[0] || 'there';
/** Merge tags the bank templates may use, and no others. */
export const DEFAULT_REP_NAME = 'Fundhub Bank Partnerships';
export function mailContext({ account, contact, stateName, footerText, missingQuestions = '', replySubject = '', repName = '' }) {
  return {
    banker: { first_name: firstNameOf(contact?.name) },
    bank: { name: account?.search_name || account?.name || '', state_name: stateName || account?.state || '' },
    rep: { name: String(repName || '').trim() || DEFAULT_REP_NAME },
    outreach: { footer: footerText, missing_questions: missingQuestions },
    reply: { subject: String(replySubject || 'Fundhub').replace(/^\s*(re|fwd?):\s*/i, '').slice(0, 200) || 'Fundhub' }
  };
}

/* An Arizona weekday morning. Cold email only; replies answer when they arrive. */
export function inSendWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  return !['Sat', 'Sun'].includes(parts.weekday) && hour >= 6 && hour < 14;
}
