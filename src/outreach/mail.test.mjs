import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refFor, contactIdFromRef, replyTagFor, contactIdFromRecipient, mailConfig, bankEnvelope, footer, inSendWindow, bankerUnsubscribeUrl, BANKER_CHANNEL, mailContext } from './mail.mjs';
import { verifyUnsubscribeRequest } from '../messaging/unsubscribe.mjs';
import { replyClientIdFrom } from '../adapters/mailgun.mjs';

const C = '0d6f2c1e-1111-4222-8333-444455556666';
const ORG = '00000000-0000-4000-8000-000000000001';
const ENV = { BANK_OUTREACH_FROM: 'Fundhub Bank Partnerships <partners@fundhub.ai>', BANK_OUTREACH_POSTAL_ADDRESS: '100 Real Street, Phoenix, AZ 85001', RESEND_REPLY_TO_DOMAIN: 'reply.example.org', UNSUBSCRIBE_TOKEN_SECRET: 'x'.repeat(40), APP_BASE_URL: 'https://fundhub.ai' };

test('references and reply tags name one banker and never look like a client reply', () => {
  assert.equal(contactIdFromRef(refFor(C, 'step2')), C);
  assert.equal(contactIdFromRef(`bank-outreach:${C}:reply-${C}`), C);
  assert.equal(contactIdFromRef(`workflow:x:${C}`), null);
  assert.equal(replyTagFor(C), `bk-${C}`);
  assert.equal(contactIdFromRecipient(`Fundhub <reply+bk-${C}@reply.example.org>`), C);
  assert.equal(contactIdFromRecipient(`reply+${C}@reply.example.org`), null);
  // The client reply door must not read a banker tag as a client id.
  assert.equal(replyClientIdFrom(`reply+bk-${C}@reply.example.org`), null);
});

test('sending settings are named when missing, never invented; masked values do not count', () => {
  assert.deepEqual(mailConfig({}).missing, ['BANK_OUTREACH_FROM', 'BANK_OUTREACH_POSTAL_ADDRESS', 'RESEND_REPLY_TO_DOMAIN', 'UNSUBSCRIBE_TOKEN_SECRET']);
  assert.ok(mailConfig({ ...ENV, BANK_OUTREACH_POSTAL_ADDRESS: '****1234' }).missing.includes('BANK_OUTREACH_POSTAL_ADDRESS'));
  assert.equal(mailConfig(ENV).ok, true);
});

test('the dispatcher envelope: only bank keys, held when settings are missing', () => {
  assert.equal(bankEnvelope({ template_key: 'EMAIL-S00-WELCOME', provider_ref: refFor(C, 'step1') }, ENV), null);
  assert.match(bankEnvelope({ template_key: 'EMAIL-BANK-OUTREACH-1', provider_ref: refFor(C, 'step1'), org_id: ORG }, {}).error, /missing/);
  assert.match(bankEnvelope({ template_key: 'EMAIL-BANK-OUTREACH-1', provider_ref: 'nope', org_id: ORG }, ENV).error, /reference/);
  const env = bankEnvelope({ template_key: 'EMAIL-BANK-OUTREACH-1', provider_ref: refFor(C, 'step1'), org_id: ORG }, ENV);
  assert.equal(env.from, ENV.BANK_OUTREACH_FROM);
  assert.equal(env.replyTag, `bk-${C}`);
  assert.match(env.unsubscribeUrl, /^https:\/\/fundhub\.ai\/unsubscribe\.html\?/);
});

test('a banker unsubscribe link verifies only as a banker link', () => {
  const url = bankerUnsubscribeUrl({ orgId: ORG, contactId: C, env: ENV });
  const q = Object.fromEntries(new URL(url).searchParams);
  assert.equal(verifyUnsubscribeRequest(q, { env: ENV }).channel, BANKER_CHANNEL);
  assert.equal(verifyUnsubscribeRequest({ ...q, channel: 'email' }, { env: ENV }), null);
});

test('footer carries the mailing address and both ways out; window is Arizona weekday mornings', () => {
  const text = footer({ postal: ENV.BANK_OUTREACH_POSTAL_ADDRESS, unsubscribeUrl: 'https://x/u' });
  assert.match(text, /100 Real Street/); assert.match(text, /reply STOP/); assert.match(text, /https:\/\/x\/u/);
  assert.equal(inSendWindow(new Date('2026-10-21T16:00:00Z')), true); // Wed 9:00 AZ
  assert.equal(inSendWindow(new Date('2026-10-21T22:00:00Z')), false); // Wed 15:00 AZ
  assert.equal(inSendWindow(new Date('2026-10-24T16:00:00Z')), false); // Sat
  assert.equal(mailContext({ account: { name: 'Bank' }, contact: { name: 'Jane Doe' }, replySubject: 'RE: Clients' }).reply.subject, 'Clients');
});

test('the rep\'s name is a merge tag; with no rep it signs as the partnerships team, never blank', () => {
  assert.equal(mailContext({ account: { name: 'Bank' }, contact: { name: 'Jane Doe' }, repName: ' Mike Rep ' }).rep.name, 'Mike Rep');
  assert.equal(mailContext({ account: { name: 'Bank' }, contact: { name: 'Jane Doe' } }).rep.name, 'Fundhub Bank Partnerships');
  assert.equal(mailContext({ account: { name: 'Bank' }, contact: { name: 'Jane Doe' }, repName: '   ' }).rep.name, 'Fundhub Bank Partnerships');
  assert.equal(mailContext({ account: { name: 'Bank' }, contact: { name: 'Jane Doe' }, repName: 'Mike' }).banker.first_name, 'Jane');
});
