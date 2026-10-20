import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacts, parseInstitutionCsv, lenderValues, dueAt, httpUrl } from './model.mjs';

const complete = { minimum_score: 680, minimum_time_in_business_years: 'unknown', minimum_revenue_threshold: 'unknown', bureaus_pulled: ['ex', 'tu'], inquiry_tolerance: 'Ask banker after 3 inquiries', stated_income: false, eligible_states: ['AZ'], application_url: 'https://bank.example/apply', paper_application_url: 'unknown' };
test('normalizes fact types while preserving unknowns and real false', () => {
  const facts = normalizeFacts(complete, { complete: true });
  assert.deepEqual(facts.bureaus_pulled, ['EX', 'TU']);
  assert.equal(facts.minimum_time_in_business_years, 'unknown');
  assert.equal(facts.stated_income, false);
  const values = lenderValues({ org_id: 'org', name: 'Bank' }, { lender_table: 'OnlineBizCC', product_name: 'Card', evidence: 'Banker email' }, facts, { id: 'staff' });
  assert.equal(values[8], null); assert.equal(values[9], null);
  assert.match(values[7], /Minimum credit score 680\./);
  assert.match(values[7], /Stated income: no/);
});
test('verification rejects blank facts, made-up types and absent real application path', () => {
  for (const changes of [{ minimum_score: '' }, { minimum_score: '680' }, { minimum_score: 680.5 }, { stated_income: 'false' }, { bureaus_pulled: [] }, { eligible_states: ['Arizona'] }, { eligible_states: ['ZZ'] }, { minimum_revenue_threshold: -1 }, { minimum_time_in_business_years: 1.234 }, { application_url: 'unknown', paper_application_url: 'unknown' }, { application_url: 'javascript:alert(1)' }, { guessed: 'yes' }]) {
    assert.throws(() => normalizeFacts({ ...complete, ...changes }, { complete: true }));
  }
});
test('CSV handles FDIC names/quotes, canonical IDs, repeat targets and four launch states', () => {
  const out = parseInstitutionCsv('fdic', '\uFEFFCERT,NAME,STALP,CITY\r\n00123,"Bank, First",AZ,Phoenix\r\n123,"Bank, First",AZ,Phoenix\r\n123,"Bank, First",CA,LA\r\n124,Other,NY,NY');
  assert.equal(out.items.length, 2); assert.equal(out.skipped, 1);
  assert.equal(out.items[0].name, 'Bank, First'); assert.equal(out.items[0].institution_key, 'fdic:123');
});
test('CSV handles NCUA headers, rejects names as identity and invalid data', () => {
  assert.equal(parseInstitutionCsv('ncua', 'CU_NUMBER,CU_NAME,STATE\n123,Sample CU,SC').items[0].institution_key, 'ncua:123');
  assert.throws(() => parseInstitutionCsv('fdic', 'NAME,STATE\nBank,AZ'));
  assert.throws(() => parseInstitutionCsv('fdic', 'CERT,NAME,STATE\nname,Bank,AZ'));
  assert.throws(() => parseInstitutionCsv('fdic', 'CERT,NAME,STATE\n1,"Bank,AZ'));
});
test('dates default immediately and URL fields reject non-http application paths', () => {
  assert.equal(dueAt(null, '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
  assert.throws(() => dueAt('not a date'));
  assert.throws(() => httpUrl('file:///tmp/application.pdf', 'application URL'));
});
