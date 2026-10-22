import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripQuoted, rulesKind, parseModelReply, missingQuestions, chooseReply, needsPerson } from './replies.mjs';

test('only the banker\'s new words are read, not the thread under them', () => {
  assert.equal(stripQuoted('Sounds good.\n\nOn Tue, Oct 20, 2026 at 9:00 AM Fundhub wrote:\n> Hi Jane'), 'Sounds good.');
  assert.equal(stripQuoted('Yes\n> quoted line\nThanks'), 'Yes\nThanks');
});

test('STOP, out-of-office and bounces need no model; ordinary replies go on', () => {
  assert.equal(rulesKind({ body: 'STOP' }), 'opt_out');
  assert.equal(rulesKind({ body: 'Please remove me from your list. Thanks' }), 'opt_out');
  assert.equal(rulesKind({ subject: 'unsubscribe', body: '' }), 'opt_out');
  assert.equal(rulesKind({ subject: 'Automatic reply: Clients', body: 'I am out of the office' }), 'auto_reply');
  assert.equal(rulesKind({ from_address: 'MAILER-DAEMON@bank.example', subject: 'Undeliverable', body: '' }), 'bounce');
  assert.equal(rulesKind({ body: 'We approve 680+ and pull Experian. Apply at https://bank.example/apply' }), null);
  // "stop" inside a sentence about something else is not an opt-out.
  assert.equal(rulesKind({ body: 'We will stop by your office next week to talk about clients.' }), null);
});

test('the model answer is checked field by field; bad facts are dropped, never coerced', () => {
  const out = parseModelReply('Here: {"kind":"data","summary":"Gave rules","lender_table":"OnlineBizCC","product_name":"Business card","facts":{"minimum_score":680,"bureaus_pulled":["ex"],"stated_income":"yes","eligible_states":["AZ","ZZ"],"made_up":1},"evidence_quote":"680 and Experian","referral":{"name":"Bo","email":"bad"}}');
  assert.equal(out.kind, 'data');
  assert.deepEqual(out.facts, { minimum_score: 680, bureaus_pulled: ['EX'] });
  assert.equal(out.lender_table, 'OnlineBizCC');
  assert.deepEqual(out.referral, { name: 'Bo', email: null });
  assert.equal(parseModelReply('{"kind":"bounce"}').kind, 'other');
  assert.equal(parseModelReply('{"kind":"wire money"}').kind, 'other');
  assert.equal(parseModelReply('{"lender_table":"Mortgage"}').lender_table, null);
  assert.equal(parseModelReply('not json'), null);
});

test('the reply asks only for what is still open', () => {
  const all = missingQuestions(new Set());
  assert.equal(all.length, 9);
  const some = missingQuestions(new Set(['products', 'minimum_score', 'bureaus_pulled', 'paper_application_url']));
  assert.equal(some.length, 5);
  assert.ok(!some.some(q => /apply/i.test(q)));
  assert.match(some[0], /^1\. /);
});

test('which reply, and when a person must look', () => {
  assert.equal(chooseReply('data', { missing: ['1. x'] }), 'ask');
  assert.equal(chooseReply('data', { missing: [] }), 'thanks');
  assert.equal(chooseReply('call'), 'call');
  assert.equal(chooseReply('wrong_person'), 'referral');
  assert.equal(chooseReply('wrong_person', { referral: { name: 'Bo' } }), null);
  assert.equal(chooseReply('not_now'), null);
  assert.equal(needsPerson('opt_out', 'live'), false);
  assert.equal(needsPerson('data', 'shadow', { queued: false }), true);
  assert.equal(needsPerson('interested', 'live', { queued: true }), false);
  assert.equal(needsPerson('data', 'live', { queued: true, hasFacts: true }), true);
  assert.equal(needsPerson('call', 'live', { queued: true }), true);
  assert.equal(needsPerson('not_now', 'live'), false);
  assert.equal(needsPerson('other', 'rules'), true);
});

test('the model answer understands the whole field catalog; once the product type is named, only that type\'s keys', () => {
  const reply = (table, facts) => parseModelReply(JSON.stringify({ kind: 'data', lender_table: table, facts }));
  // No product type named: any valid catalog key is accepted, bad values are dropped.
  assert.deepEqual(reply(null, { double_pull: true, apr_pct: 9.5, max_line: 'bad', funding_speed: 'Next day', typical_amount: 15000, repayment_months: 0 }).facts, { double_pull: true, apr_pct: 9.5, funding_speed: 'Next day', typical_amount: 15000 });
  // A personal loan: its own keys come through; a key from another product type is dropped, not coerced.
  assert.deepEqual(reply('PersonalLoans', { minimum_score: 700, repayment_months: 48, apr_pct: 9.99, max_line: 5000, underwriter: 'Elan', minimum_time_in_business_years: 3 }).facts, { minimum_score: 700, repayment_months: 48, apr_pct: 9.99 });
  assert.deepEqual(reply('BizLOC_Stated', { max_line: 250000, collateral_required: false, underwriter: 'Elan', minimum_revenue_threshold: 90000 }).facts, { max_line: 250000, collateral_required: false, minimum_revenue_threshold: 90000 });
  // "unknown" is an answer; blank is not.
  assert.deepEqual(reply('PersonalCC', { intro_offers: 'unknown', underwriter: '', double_pull: null }).facts, { intro_offers: 'unknown' });
  assert.deepEqual(reply('OnlineBizCC', { made_up_key: 1 }).facts, {});
});

test('the reply asks the questions for the product type it knows, and the original nine when it does not', () => {
  const none = new Set(['products']);
  const loan = missingQuestions(none, { lenderTable: 'PersonalLoans' });
  assert.equal(loan.length, 16);
  assert.ok(loan.some(q => /usual|typical approved amount/i.test(q)) && loan.some(q => /How many months is repayment/.test(q)) && loan.some(q => /What APR/.test(q)));
  assert.ok(!loan.some(q => /How long does a business need to be open|minimum yearly revenue/.test(q)), 'business-only questions are not asked of a personal product');
  assert.ok(!loan.some(q => /largest line|collateral/i.test(q)));
  assert.match(loan[0], /^1\. What is the minimum credit score/);
  const line = missingQuestions(new Set(['products', 'minimum_score', 'max_line', 'application_url', 'apr_pct']), { lenderTable: 'BizLOC_Stated' });
  assert.ok(!line.some(q => /minimum credit score|largest line|What APR|apply\?/i.test(q)));
  assert.ok(line.some(q => /How long does a business need to be open/.test(q)) && line.some(q => /collateral/.test(q)) && line.some(q => /revolving/.test(q)));
  // An unknown product type, or none, keeps the original nine exactly.
  assert.equal(missingQuestions(new Set()).length, 9);
  assert.equal(missingQuestions(new Set(), { lenderTable: 'Mortgage' }).length, 9);
  assert.equal(missingQuestions(new Set(), { lenderTable: null }).length, 9);
});
