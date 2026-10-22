// The first-contact words (owner, 2026-10-21): warm the banker up and ask for a call, never for data points.
// Migration 503 rewrites the three cold emails and adds the text. These tests read the migration file itself,
// so a change to the copy or to the exact 495 words it replaces cannot slip past.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWarmup, WARMUP_EMAIL_KEY, WARMUP_SMS_KEY } from './queue.mjs';
import { COLD_KEYS } from './mail.mjs';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const m495 = fs.readFileSync(path.join(DB, '495_bank_outreach_automation.sql'), 'utf8');
const m503 = fs.readFileSync(path.join(DB, '503_bank_outreach_manual_first.sql'), 'utf8');
const copy495 = new Map([...m495.matchAll(/\('(EMAIL-BANK-OUTREACH-[A-Z0-9-]+)', '([^']*)',\s*\$c\$([\s\S]*?)\$c\$\)/g)].map(([, key, subject, body]) => [key, { subject, body }]));
const rewrites = [...m503.matchAll(/\('(EMAIL-BANK-OUTREACH-[0-9])',\s*\$old\$([\s\S]*?)\$old\$,\s*'([^']*)',\s*\$new\$([\s\S]*?)\$new\$\)/g)].map(([, key, oldBody, subject, body]) => ({ key, oldBody, subject, body }));
const sms = m503.match(/'SMS-BANK-OUTREACH-1', 'sms', NULL,\s*\$c\$([\s\S]*?)\$c\$, false/)?.[1];
const ALLOWED_TAGS = new Set(['banker.first_name', 'bank.name', 'bank.state_name', 'rep.name', 'outreach.footer']);
const tagsOf = value => [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);

test('503 rewrites exactly the three cold emails, and only from the exact 495 words', () => {
  assert.deepEqual(rewrites.map(r => r.key), COLD_KEYS);
  assert.equal(copy495.size, 7);
  for (const r of rewrites) assert.equal(r.oldBody, copy495.get(r.key).body, `${r.key}: 503 must match the 495 body character for character`);
  assert.match(m503, /t\.compliance_passed = false/);
  assert.match(m503, /t\.body = v\.old_body/);
  assert.doesNotMatch(m503, /compliance_passed\s*=\s*true/i, '503 approves nothing');
  assert.doesNotMatch(m503, /UPDATE agents|status\s*=\s*'(shadow|live)'/i, '503 starts no agent');
  // The three reply templates are not touched.
  assert.doesNotMatch(m503, /EMAIL-BANK-OUTREACH-REPLY/);
});

test('the warm-up emails sound like a person, ask for a call and never ask for data points', () => {
  for (const r of rewrites) {
    const all = `${r.subject}\n${r.body}`;
    assert.match(r.body, /\bcall\b/i, `${r.key} asks for a call`);
    assert.match(r.body, /^Hi \{\{banker\.first_name\}\},\n\n/, r.key);
    // Signed by the rep, then Fundhub, then the footer the automatic path still needs.
    assert.ok(r.body.endsWith('\n\n{{rep.name}}\nFundhub\n\n{{outreach.footer}}'), `${r.key} ends with the rep's name, Fundhub, then the footer`);
    assert.doesNotMatch(all, /credit score|bureau|application link|inquir|stated income|what you approve|three answers|three facts|data point|which products you offer/i, `${r.key} asks for no data points`);
    assert.doesNotMatch(all, /\b(maybe|might|could|we think|i think|probably|likely|hopefully|chances are|possibly|perhaps)\b/i, `${r.key} speaks with certainty`);
    assert.doesNotMatch(all, /\b(guarantee\w*|promis\w*|approv\w*|pre-verified|within \d+ (hours|days)|fast)\b/i, `${r.key} promises nothing about approvals, amounts or timing`);
    for (const word of all.match(/fund\s?hub/gi) || []) assert.equal(word, 'Fundhub');
    assert.match(all, /Fundhub/);
    assert.ok(tagsOf(all).every(t => ALLOWED_TAGS.has(t)), `${r.key} uses only known merge tags: ${tagsOf(all)}`);
    assert.ok(r.body.length < 900, `${r.key} stays short`);
  }
  assert.ok(rewrites[0].body.includes('{{bank.state_name}}') && rewrites[0].body.includes('{{bank.name}}'));
  assert.equal(new Set(rewrites.map(r => r.subject)).size, 3, 'three different subjects');
});

test('the text is under 300 characters, signed by the rep and ends with the opt-out words', () => {
  assert.ok(sms, 'SMS-BANK-OUTREACH-1 is in 503');
  assert.ok(sms.length < 300, `${sms.length} characters`);
  assert.ok(sms.endsWith('Reply STOP to opt out.'));
  assert.ok(tagsOf(sms).every(t => ALLOWED_TAGS.has(t) && t !== 'outreach.footer'));
  assert.match(sms, /\{\{rep\.name\}\} with Fundhub/);
  assert.match(sms, /call/);
  assert.doesNotMatch(sms, /credit score|bureau|application link|\b(maybe|might|could|probably|we think)\b/i);
  // Seeded unapproved, for the company slug only, and a repeat changes nothing.
  assert.match(m503, /'SMS-BANK-OUTREACH-1', 'sms', NULL,[\s\S]*?\$c\$, false\s+FROM orgs o\s+WHERE o\.slug = 'fundhub'\s+ON CONFLICT \(org_id, template_key\) DO NOTHING/);
  assert.match(m503, /to_regclass\('message_templates'\) IS NOT NULL/);
});

const email = { subject: rewrites[0].subject, body: rewrites[0].body };
const smsTemplate = { body: sms };
const bank = { name: 'First Bank of Arizona, National Association', state: 'AZ' };

test('renderWarmup fills one contact at a time, signs as the rep and leaves no footer or leftover tag', () => {
  const jane = renderWarmup({ emailTemplate: email, smsTemplate }, { account: bank, contact: { name: 'Jane Doe' }, repName: 'Mike Rep' });
  const sam = renderWarmup({ emailTemplate: email, smsTemplate }, { account: bank, contact: { name: 'Sam Stone' }, repName: 'Mike Rep' });
  assert.equal(jane.email.subject, 'A quick call about First Bank of Arizona');
  assert.match(jane.email.body, /^Hi Jane,\n\nI'm Mike Rep with Fundhub\. We have clients in Arizona who need credit cards, lines of credit and loans, and I want to send them to First Bank of Arizona\./);
  assert.ok(jane.email.body.endsWith('Mike Rep\nFundhub'), 'body ends at the signature, no trailing blank lines');
  assert.match(sam.email.body, /^Hi Sam,/);
  assert.notEqual(jane.email.body, sam.email.body);
  assert.match(jane.text, /^Hi Jane, this is Mike Rep with Fundhub\. I have clients in Arizona/);
  assert.ok(jane.text.length < 300 && jane.text.endsWith('Reply STOP to opt out.'));
  for (const out of [jane.email.subject, jane.email.body, jane.text]) assert.doesNotMatch(out, /\{\{|footer|undefined|null/);
  assert.doesNotMatch(jane.email.body, /unsubscribe|reply STOP|Phoenix/i, 'a hand-sent note carries no automatic-send footer');
});

test('a missing template is null, never invented; no rep name signs as the partnerships team', () => {
  assert.deepEqual(renderWarmup({}, { account: bank, contact: { name: 'Jane Doe' }, repName: 'Mike' }), { email: null, text: null });
  assert.equal(renderWarmup({ emailTemplate: email }, { account: bank, contact: { name: 'Jane Doe' }, repName: 'Mike' }).text, null);
  assert.equal(renderWarmup({ smsTemplate }, { account: bank, contact: { name: 'Jane Doe' }, repName: 'Mike' }).email, null);
  const unsigned = renderWarmup({ emailTemplate: email, smsTemplate }, { account: bank, contact: { name: 'Jane Doe' } });
  assert.match(unsigned.email.body, /I'm Fundhub Bank Partnerships with Fundhub/);
  assert.ok(unsigned.email.body.endsWith('Fundhub Bank Partnerships\nFundhub'));
  assert.equal(renderWarmup({ emailTemplate: email }, { account: { name: 'Bank', state: 'ZZ' }, contact: { name: '' }, repName: 'Mike' }).email.body.startsWith('Hi there,'), true);
});

test('the template keys are the ones the spec names', () => {
  assert.equal(WARMUP_EMAIL_KEY, 'EMAIL-BANK-OUTREACH-1');
  assert.equal(WARMUP_SMS_KEY, 'SMS-BANK-OUTREACH-1');
  assert.ok(COLD_KEYS.includes(WARMUP_EMAIL_KEY));
});
