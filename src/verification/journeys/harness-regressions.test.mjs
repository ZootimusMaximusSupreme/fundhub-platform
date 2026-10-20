import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, STATUS } from '../assert.mjs';
import { assertFundingCreditor } from './funding.mjs';
import { assertContractTampering } from './adversarial.mjs';
import { assertWorkflowRegistry } from './workflows.mjs';
import { functions } from '../../workflows/index.mjs';
import { bodyHash } from '../../contracts/send.mjs';

const red = collector => collector.items.some(item => [STATUS.FAIL, STATUS.SILENT].includes(item.status));
test('funding creditor proof selects the stable account when Toyota is returned first', () => {
  const collector = createCollector();
  assertFundingCreditor([{ account_ref: 'SIM-TOYO-001', lender: 'Toyota Motor Credit' }, { account_ref: 'SIM-CHASE-001', lender: 'Chase Sapphire Preferred' }], collector);
  assert.equal(collector.items[0].status, STATUS.PASS);
});
test('funding creditor proof remains red for missing or incorrectly mapped Chase account', () => {
  for (const rows of [[], [{ account_ref: 'SIM-CHASE-001', lender: 'Toyota Motor Credit' }], [{ account_ref: 'SIM-CHASE-001' }]]) {
    const collector = createCollector(); assertFundingCreditor(rows, collector); assert.equal(red(collector), true);
  }
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
