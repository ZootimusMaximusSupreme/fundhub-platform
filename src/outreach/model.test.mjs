import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacts, normalizeFact, parseInstitutionCsv, lenderValues, lenderExtras, factsForType, productFields, dueAt, httpUrl, FACT_KEYS, FIELD_KEYS, FIELD_CATALOG, LENDER_EXTRA_COLUMNS, LENDER_TABLES, TYPE_FIELDS, NOT_APPLICABLE } from './model.mjs';

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
test('official FDIC WEBADDR header preserves the bank website', () => {
  const result = parseInstitutionCsv('fdic', 'CERT,NAME,STALP,CITY,WEBADDR\n123,First Bank,AZ,Phoenix,https://bank.example');
  assert.equal(result.items[0].website, 'https://bank.example');
});
test('dates default immediately and URL fields reject non-http application paths', () => {
  assert.equal(dueAt(null, '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
  assert.throws(() => dueAt('not a date'));
  assert.throws(() => httpUrl('file:///tmp/application.pdf', 'application URL'));
});


/* ---- Product field catalog (owner spec 2026-10-21, section 1 and 4) ---------------------------------------- */
const EVERY = ['minimum_score', 'bureaus_pulled', 'double_pull', 'inquiry_tolerance', 'stated_income', 'eligible_states', 'application_url', 'paper_application_url', 'relationship_required', 'requires_account_opening', 'minimum_deposit', 'prequal_soft_pull'];
const SPEC_ADDS = {
  OnlineBizCC: ['minimum_time_in_business_years', 'minimum_revenue_threshold', 'business_bureau_pulled', 'underwriter', 'intro_offers', 'multiple_llc_allowed'],
  InBranchBizCC: ['minimum_time_in_business_years', 'minimum_revenue_threshold', 'business_bureau_pulled', 'underwriter', 'intro_offers', 'multiple_llc_allowed'],
  BizLOC_Stated: ['minimum_time_in_business_years', 'minimum_revenue_threshold', 'business_bureau_pulled', 'average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'documents_required', 'collateral_required', 'line_type'],
  BizLOC_Documented: ['minimum_time_in_business_years', 'minimum_revenue_threshold', 'business_bureau_pulled', 'average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'documents_required', 'collateral_required', 'line_type'],
  PersonalCC: ['underwriter', 'intro_offers'],
  PersonalLOC: ['average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'collateral_required'],
  PersonalLoans: ['application_method', 'typical_amount', 'apr_pct', 'repayment_months', 'funding_speed']
};
// One valid answer per field type, for building complete products.
const SAMPLE = { score: 700, years: 2.5, money: 12000.5, pct: 9.99, months: 36, yesno: true, bureaus: ['ex', 'eq'], states: ['az', 'ca'], url: 'https://bank.example/apply', text: 'A real answer' };
const answers = table => Object.fromEntries(TYPE_FIELDS[table].map(key => [key, key === 'paper_application_url' ? 'unknown' : SAMPLE[FIELD_CATALOG[key].type]]));

test('catalog: the first nine keys are the original facts in their original order; every field has a label and a known type', () => {
  assert.deepEqual(FIELD_KEYS.slice(0, 9), FACT_KEYS);
  assert.equal(FIELD_KEYS.length, 29);
  const types = new Set(['score', 'years', 'money', 'pct', 'months', 'yesno', 'bureaus', 'states', 'url', 'text']);
  for (const key of FIELD_KEYS) { assert.ok(FIELD_CATALOG[key].label, key); assert.ok(types.has(FIELD_CATALOG[key].type), key); }
  assert.deepEqual(FACT_KEYS.map(k => FIELD_CATALOG[k].type), ['score', 'years', 'money', 'bureaus', 'text', 'yesno', 'states', 'url', 'url']);
});
test('catalog: every product type lists exactly what the spec table says, in catalog order', () => {
  assert.deepEqual(Object.keys(TYPE_FIELDS), LENDER_TABLES);
  for (const table of LENDER_TABLES) {
    const wanted = new Set([...EVERY, ...SPEC_ADDS[table]]);
    assert.deepEqual([...TYPE_FIELDS[table]], FIELD_KEYS.filter(k => wanted.has(k)), table);
    assert.equal(TYPE_FIELDS[table].length, wanted.size, table);
  }
  assert.equal(TYPE_FIELDS.OnlineBizCC.length, 18); assert.equal(TYPE_FIELDS.BizLOC_Stated.length, 22);
  assert.equal(TYPE_FIELDS.PersonalCC.length, 14); assert.equal(TYPE_FIELDS.PersonalLOC.length, 17); assert.equal(TYPE_FIELDS.PersonalLoans.length, 17);
});
test('catalog: the two business-only keys are n/a on personal products only', () => {
  for (const table of ['OnlineBizCC', 'InBranchBizCC', 'BizLOC_Stated', 'BizLOC_Documented']) assert.deepEqual([...NOT_APPLICABLE[table]], [], table);
  for (const table of ['PersonalCC', 'PersonalLOC', 'PersonalLoans']) {
    assert.deepEqual([...NOT_APPLICABLE[table]], ['minimum_time_in_business_years', 'minimum_revenue_threshold'], table);
    assert.ok(!TYPE_FIELDS[table].includes('minimum_time_in_business_years') && !TYPE_FIELDS[table].includes('minimum_revenue_threshold'), table);
  }
});
test('productFields has the exact shape the screen reads and hands out fresh copies', () => {
  const view = productFields();
  assert.deepEqual(Object.keys(view), ['fields', 'types', 'notApplicable']);
  assert.deepEqual(view.fields.apr_pct, { label: 'APR (percent)', type: 'pct' });
  assert.deepEqual(view.fields.minimum_score, { label: 'Minimum credit score', type: 'score' });
  assert.deepEqual(Object.keys(view.types), LENDER_TABLES); assert.deepEqual(Object.keys(view.notApplicable), LENDER_TABLES);
  assert.deepEqual(view.types.PersonalLoans, FIELD_KEYS.filter(k => [...EVERY, ...SPEC_ADDS.PersonalLoans].includes(k)));
  assert.deepEqual(view.notApplicable.PersonalCC, ['minimum_time_in_business_years', 'minimum_revenue_threshold']);
  assert.deepEqual(view.notApplicable.OnlineBizCC, []);
  view.types.PersonalLoans.pop(); view.fields.apr_pct.label = 'changed';
  assert.equal(productFields().types.PersonalLoans.length, 17); assert.equal(productFields().fields.apr_pct.label, 'APR (percent)');
  assert.equal(JSON.parse(JSON.stringify(productFields())).types.OnlineBizCC.length, 18);
});
test('without a product type the original nine facts behave exactly as before', () => {
  assert.throws(() => normalizeFacts({ ...complete, double_pull: true }, { complete: true }), /Unknown product fact: double_pull/);
  assert.throws(() => normalizeFacts({ ...complete, apr_pct: 9 }), /Unknown product fact: apr_pct/);
  assert.deepEqual(normalizeFacts({}), {});
  assert.throws(() => normalizeFacts({ minimum_score: 680 }, { complete: true }), /Answer minimum_time_in_business_years or enter unknown/);
  assert.deepEqual(Object.keys(normalizeFacts(complete, { complete: true })), FACT_KEYS);
});
test('every product type is complete only when each of its fields is answered or unknown', () => {
  for (const table of LENDER_TABLES) {
    const full = answers(table);
    const facts = normalizeFacts(full, { complete: true, lenderTable: table });
    assert.deepEqual(Object.keys(facts).filter(k => !NOT_APPLICABLE[table].includes(k)), TYPE_FIELDS[table], table);
    for (const key of NOT_APPLICABLE[table]) assert.equal(facts[key], 'n/a', `${table} ${key}`);
    for (const key of TYPE_FIELDS[table]) {
      const { [key]: _gone, ...without } = full;
      const needsLink = key === 'application_url' ? { paper_application_url: 'https://bank.example/paper' } : {};
      assert.throws(() => normalizeFacts({ ...without, ...needsLink }, { complete: true, lenderTable: table }), new RegExp(`Answer ${FIELD_CATALOG[key].label.replace(/[()]/g, '.')} or enter unknown`), `${table} missing ${key}`);
      // "unknown" counts as answered, and stays "unknown": never zero, false or "all states".
      const unknown = normalizeFacts({ ...full, [key]: 'unknown', ...(key === 'application_url' ? { paper_application_url: 'https://bank.example/paper' } : {}) }, { complete: true, lenderTable: table });
      assert.equal(unknown[key], 'unknown', `${table} ${key}`);
    }
    // A draft can be partial; only the n/a keys are filled by the server.
    assert.deepEqual(normalizeFacts({}, { lenderTable: table }), Object.fromEntries(NOT_APPLICABLE[table].map(k => [k, 'n/a'])));
  }
  assert.throws(() => normalizeFacts({ ...answers('OnlineBizCC'), application_url: 'unknown', paper_application_url: 'unknown' }, { complete: true, lenderTable: 'OnlineBizCC' }), /real application URL/);
});
test('n/a is the server\'s value for business-only keys on personal products, and nothing a business product may use', () => {
  const loan = answers('PersonalLoans');
  for (const given of [undefined, null, '', 'unknown', 'n/a']) assert.equal(normalizeFacts({ ...loan, minimum_time_in_business_years: given }, { complete: true, lenderTable: 'PersonalLoans' }).minimum_time_in_business_years, 'n/a');
  for (const bad of [3, 0, false, 'two years']) {
    assert.throws(() => normalizeFacts({ ...loan, minimum_revenue_threshold: bad }, { complete: true, lenderTable: 'PersonalLoans' }), /does not apply/);
  }
  for (const given of ['n/a', undefined]) assert.throws(() => normalizeFacts({ ...answers('OnlineBizCC'), minimum_time_in_business_years: given }, { complete: true, lenderTable: 'OnlineBizCC' }));
  // The legacy path never produced n/a, so a business answer of "n/a" is still not a number.
  assert.throws(() => normalizeFacts({ ...complete, minimum_revenue_threshold: 'n/a' }));
});
test('a key another product type asks for is refused, with the on-screen label', () => {
  assert.throws(() => normalizeFacts({ max_line: 5000 }, { lenderTable: 'OnlineBizCC' }), /Largest line does not apply/);
  assert.throws(() => normalizeFacts({ underwriter: 'Elan' }, { lenderTable: 'PersonalLoans' }), /Who underwrites it does not apply/);
  assert.throws(() => normalizeFacts({ made_up: 1 }, { lenderTable: 'PersonalCC' }), /Unknown product fact: made_up/);
  assert.throws(() => normalizeFacts({}, { lenderTable: 'Mortgage' }), /existing lender product category/);
  assert.deepEqual(factsForType('PersonalLoans', { minimum_score: 700, max_line: 5000, minimum_revenue_threshold: 1, apr_pct: 8 }), { minimum_score: 700, apr_pct: 8 });
});
test('values are checked by field type; nothing is coerced', () => {
  const bad = [['minimum_score', 299], ['minimum_score', '700'], ['apr_pct', -1], ['apr_pct', 100.01], ['apr_pct', 9.999], ['typical_amount', 1.234], ['typical_amount', -5], ['typical_amount', '5000'],
    ['repayment_months', 0], ['repayment_months', 601], ['repayment_months', 12.5], ['repayment_months', '12'], ['double_pull', 'yes'], ['double_pull', 1], ['collateral_required', 'false'],
    ['bureaus_pulled', ['XX']], ['bureaus_pulled', []], ['eligible_states', ['Arizona']], ['application_method', 5], ['application_method', '   '], ['application_url', 'javascript:alert(1)'], ['funding_speed', ['fast']]];
  for (const [key, value] of bad) assert.throws(() => normalizeFacts({ [key]: value }, { lenderTable: 'PersonalLoans' }), undefined, `${key}=${JSON.stringify(value)}`);
  for (const [key, value, expected] of [['apr_pct', 0, 0], ['apr_pct', 100, 100], ['repayment_months', 1, 1], ['repayment_months', 600, 600], ['double_pull', false, false], ['typical_amount', 0, 0], ['funding_speed', ' Same day ', 'Same day']]) {
    assert.equal(normalizeFacts({ [key]: value }, { lenderTable: 'PersonalLoans' })[key], expected, key);
  }
  assert.equal(normalizeFact('apr_pct', ''), undefined); assert.equal(normalizeFact('apr_pct', null), undefined); assert.equal(normalizeFact('apr_pct', 'unknown'), 'unknown');
  assert.throws(() => normalizeFact('nope', 1), /Unknown product fact/);
});
test('lender columns: yes/no become Yes/No, numbers stay numbers, unknown and n/a are NULL, other types add nothing', () => {
  const extras = lenderExtras('BizLOC_Stated', normalizeFacts({ ...answers('BizLOC_Stated'), double_pull: true, relationship_required: false, requires_account_opening: 'unknown', apr_pct: 11.5, max_line: 250000, line_type: 'revolving', minimum_deposit: 'unknown' }, { complete: true, lenderTable: 'BizLOC_Stated' }));
  assert.deepEqual(Object.keys(extras), ['double_pull', 'relationship_required', 'requires_account_opening', 'minimum_deposit', 'prequal_soft_pull', 'business_bureau_pulled', 'apr_range_pct', 'average_starting_loc', 'max_known_loc', 'draw_period_renewal', 'docs_requested', 'collateral_required', 'loc_type']);
  assert.equal(extras.double_pull, 'Yes'); assert.equal(extras.relationship_required, 'No'); assert.equal(extras.requires_account_opening, null); assert.equal(extras.minimum_deposit, null);
  assert.equal(extras.apr_range_pct, 11.5); assert.equal(extras.max_known_loc, 250000); assert.equal(extras.loc_type, 'revolving'); assert.equal(extras.collateral_required, 'Yes');
  // A personal card has no line, no APR and no loan columns; the base nine live in the base twelve columns, not here.
  const card = lenderExtras('PersonalCC', normalizeFacts(answers('PersonalCC'), { complete: true, lenderTable: 'PersonalCC' }));
  assert.deepEqual(Object.keys(card), ['double_pull', 'relationship_required', 'requires_account_opening', 'minimum_deposit', 'prequal_soft_pull', 'underwriter_interaction', 'intro_offers']);
  for (const table of LENDER_TABLES) for (const column of Object.keys(lenderExtras(table, normalizeFacts(answers(table), { complete: true, lenderTable: table })))) assert.ok(Object.values(LENDER_EXTRA_COLUMNS).includes(column), `${table} ${column}`);
  assert.deepEqual(lenderExtras('PersonalLoans', {}), Object.fromEntries(Object.keys(lenderExtras('PersonalLoans', {})).map(k => [k, null])));
  assert.deepEqual(Object.keys(LENDER_EXTRA_COLUMNS).filter(k => FACT_KEYS.includes(k)), []);
});
test('lender base columns: n/a on a personal product is NULL like unknown, and the base twelve keep their exact format', () => {
  const facts = normalizeFacts({ ...answers('PersonalLoans'), inquiry_tolerance: 'n/a' }, { complete: true, lenderTable: 'PersonalLoans' });
  assert.equal(facts.minimum_time_in_business_years, 'n/a');
  const values = lenderValues({ org_id: 'org', name: 'Bank' }, { lender_table: 'PersonalLoans', product_name: 'Loan', evidence: 'Banker email' }, facts, { name: 'Rep Name' });
  assert.equal(values.length, 12);
  assert.equal(values[8], null); assert.equal(values[9], null);
  // A banker's own typed "n/a" is their word and stays in the requirements text; only the two business-only keys null out.
  assert.match(values[7], /^Minimum credit score 700\. Inquiry tolerance: n\/a\. Stated income: yes\.$/);
  assert.equal(values[10], 'Banker email\nPaper application: unknown');
  assert.equal(values[11], 'Rep Name');
  assert.equal(values[6], 'EX/EQ'); assert.equal(values[5], 'AZ, CA'); assert.equal(values[4], 'https://bank.example/apply');
});
