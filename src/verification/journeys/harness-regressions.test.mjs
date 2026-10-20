import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, STATUS } from '../assert.mjs';
import { assertFundingCreditor, runFundingJourney } from './funding.mjs';
import { assertContractTampering } from './adversarial.mjs';
import { assertWorkflowRegistry } from './workflows.mjs';
import { functions } from '../../workflows/index.mjs';
import { bodyHash } from '../../contracts/send.mjs';
import { buildSimulatedCrsPayload } from '../../demo/simulate-client.mjs';
import { BUREAU_FIELDS } from '../fixtures.mjs';

const red = collector => collector.items.some(item => [STATUS.FAIL, STATUS.SILENT].includes(item.status));
test('funding creditor proof selects the stable account when Toyota is returned first', () => {
  const collector = createCollector();
  const chase = { id: 'persisted-chase-row', account_ref: 'SIM-CHASE-001', lender: 'Chase Sapphire Preferred' };
  const selected = assertFundingCreditor([{ id: 'persisted-toyota-row', account_ref: 'SIM-TOYO-001', lender: 'Toyota Motor Credit' }, chase], collector);
  assert.equal(collector.items[0].status, STATUS.PASS);
  assert.equal(selected, chase); assert.equal(selected.id, 'persisted-chase-row');
});
test('funding creditor proof remains red for missing or incorrectly mapped Chase account', () => {
  for (const rows of [[], [{ account_ref: 'SIM-CHASE-001', lender: 'Toyota Motor Credit' }], [{ account_ref: 'SIM-CHASE-001' }]]) {
    const collector = createCollector(); const selected = assertFundingCreditor(rows, collector); assert.equal(red(collector), true);
    assert.equal(selected, rows.find(row => row.account_ref === 'SIM-CHASE-001') || null);
  }
});
test('the actual funding bureau block retains the selected row through its later field checks', async () => {
  // Execute the exact bureau section from the real journey. Earlier payment and
  // consent steps are outside this regression; all downstream sample references
  // in this section run, so a lost local binding raises the same CI crash here.
  const source = runFundingJourney.toString();
  const start = source.indexOf('  const tl =');
  const end = source.indexOf('  steps.push({', start);
  assert.ok(start > 0 && end > start);
  const bureauBlock = source.slice(start, end);
  const rows = [{ id: 'toyota-row', account_ref: 'SIM-TOYO-001', lender: 'Toyota Motor Credit' }, { id: 'chase-row', account_ref: 'SIM-CHASE-001', lender: 'Chase Sapphire Preferred' }];
  const db = { query: async sql => {
    if (/SELECT \* FROM tradelines/.test(sql)) return { rows };
    if (/INSERT INTO crs_results/.test(sql)) return { rows: [{ id: 'new-crs-result' }] };
    if (/UPDATE clients SET outcome_tier/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected bureau-section query: ${sql}`);
  } };
  const collector = createCollector();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const exercise = new AsyncFunction('db', 'ctx', 'sim', 'collector', 'section', 'journey', 'role', 'assertFundingCreditor', 'buildSimulatedCrsPayload', 'ingestCrsResult', 'BUREAU_FIELDS', `${bureauBlock}\nreturn sample;`);
  const selected = await exercise(db, { orgId: 'org' }, { client: { id: 'client' }, email: 'fixture@example.test' }, collector, 'DATA', 'FUNDING', 'system', assertFundingCreditor, buildSimulatedCrsPayload, async () => ({ ingested: 2 }), BUREAU_FIELDS);
  assert.equal(selected.id, 'chase-row');
  assert.ok(collector.items.some(item => item.id === 'fund-bureau-accountIdentifier'));
  assert.equal(red(collector), false);
});

function contractProbeDb({ mutation = 'frozen', checksum = null } = {}) {
  const contract = { id: '00000000-0000-4000-8000-000000000001', org_id: 'org', document_version_id: '00000000-0000-4000-8000-000000000002', rendered_body: 'The original signed wording.', body_sha: bodyHash('The original signed wording.') };
  const db = { query: async (sql, values) => {
    if (/SELECT checksum FROM document_versions/.test(sql)) return { rows: [{ checksum: checksum || contract.body_sha }] };
    if (/UPDATE contracts SET rendered_body/.test(sql)) {
      if (mutation === 'frozen') throw Object.assign(new Error('This contract wording is frozen'), { code: 'P0001' });
      if (mutation === 'missing_column') throw Object.assign(new Error('column rendered_body does not exist'), { code: '42703' });
      if (mutation === 'permission') throw Object.assign(new Error('permission denied for table contracts'), { code: '42501' });
      if (mutation === 'noop') return { rows: [] };
      return { rows: [{ ...contract, rendered_body: values[1] }] };
    }
    if (/SELECT \* FROM contracts/.test(sql)) return { rows: [contract] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return { db, contract };
}
test('tamper probe exercises the real verifier and checksum while keeping the real frozen-wording guard intact', async () => {
  const { db, contract } = contractProbeDb(); const collector = createCollector();
  await assertContractTampering(db, contract, collector);
  assert.equal(red(collector), false);
  assert.equal(collector.items.find(item => item.id === 'adv-tamper-contract').status, STATUS.PASS);
  assert.equal(collector.items.find(item => item.id === 'adv-tamper-frozen').status, STATUS.PASS);
});
test('tamper probe never turns SQL failure/no-op or an invalid original anchor green', async () => {
  for (const options of [{ mutation: 'missing_column' }, { mutation: 'permission' }, { mutation: 'noop' }, { checksum: 'invalid original checksum' }]) {
    const { db, contract } = contractProbeDb(options); const collector = createCollector();
    await assertContractTampering(db, contract, collector);
    assert.equal(red(collector), true);
    assert.equal(collector.items.some(item => item.id === 'adv-tamper-contract' && item.status === STATUS.PASS), false);
  }
});
test('tamper probe stays red if the verifier accepts changed content or the database allows a frozen edit', async () => {
  const { db, contract } = contractProbeDb(); const brokenVerifier = createCollector();
  await assertContractTampering(db, contract, brokenVerifier, {}, { verify: async () => ({ ok: true }) });
  assert.equal(brokenVerifier.items.find(item => item.id === 'adv-tamper-contract').status, STATUS.FAIL);
  const brokenDb = contractProbeDb({ mutation: 'accepted' }); const collector = createCollector();
  await assertContractTampering(brokenDb.db, brokenDb.contract, collector);
  assert.equal(red(collector), true);
});

test('workflow registry proves required contracts and allows additional valid workflows without an arbitrary ceiling', () => {
  const collector = createCollector();
  assertWorkflowRegistry([...functions, ...Array.from({ length: 60 }, (_, index) => ({ opts: { id: `new-${index}`, triggers: [{ event: 'new.event' }] }, fn() {} }))], collector);
  assert.equal(red(collector), false);
});
test('workflow registry stays red for missing check-ins, duplicate IDs, wrong trigger or non-callable handlers', () => {
  const checkin = functions.find(fn => fn.id() === 'bank-outreach-checkins');
  const malformed = { opts: { id: 'bank-outreach-checkins', triggers: [{ cron: '0 0 * * *' }] }, fn() {} };
  for (const registry of [functions.filter(fn => fn !== checkin), [...functions, checkin], functions.map(fn => fn === checkin ? malformed : fn), [...functions, { opts: { id: 'no-handler' } }]]) {
    const collector = createCollector(); assertWorkflowRegistry(registry, collector); assert.equal(red(collector), true);
  }
});
