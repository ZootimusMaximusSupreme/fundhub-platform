import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createLinkToken } from '../../../banking/providers/plaid-http.mjs';
import { queueInviteEmail } from '../../../hiring/eeo-selfid.mjs';
import { resolveProductId } from '../../../handlers/money-chain.mjs';
import { renderTemplate } from '../../../lib/render-template.mjs';
import { sweep } from '../../../workflows/finance-os-trend-snapshots.mjs';
import { signReportUrl } from '../../../autopsy/link.mjs';
import { DATA_DIRECT_RESULT_CASES, directDataResultProofFor } from './data-direct-results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MAP_ROOT = path.join(ROOT, 'ops/workflows/coverage-every-surface-2026-10-10');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('the direct result list owns the exact 18 data rows left outside the table lane', () => {
  assert.equal(DATA_DIRECT_RESULT_CASES.length, 18);
  for (const item of DATA_DIRECT_RESULT_CASES) {
    const rows = JSON.parse(fs.readFileSync(path.join(MAP_ROOT, item.sourceFile), 'utf8'));
    const matches = rows.filter((row) => row.surface === item.surface && row.control === item.control);
    assert.equal(matches.length, 1, `${item.sourceFile}: ${item.surface}: ${item.control}`);
    assert.deepEqual(directDataResultProofFor(item.sourceFile, matches[0]), item.proof);
  }
});

test('Plaid Link executes its browser and consent result contracts with fake data', async () => {
  const money = read('public/app/money.js');
  const accounts = read('public/app/money-accounts.js');
  for (const source of [money, accounts]) {
    assert.match(source, /https:\/\/cdn\.plaid\.com\/link\/v2\/stable\/link-initialize\.js/);
    assert.match(source, /\/api\/banking\/link-token/);
    assert.match(source, /\/api\/banking\/link-exchange/);
    assert.doesNotMatch(source, /update_mode|update:\s*true|link_token.*relink/i);
    assert.doesNotMatch(source, /banking\/revoke|item\/remove|data-act=["']disconnect/i);
  }

  const plaidLink = read('src/banking/plaid-link.mjs');
  assert.match(plaidLink, /consent_granted_at, consent_scope/);
  assert.match(plaidLink, /JSON\.stringify\(\["accounts"\]\)/);
  const readers = [
    read('src/banking/plaid-refresh.mjs'),
    read('src/banking/plaid-transactions.mjs'),
    read('src/finance/money-transfers-store.mjs'),
  ];
  assert.ok(readers.every((source) => /consent_granted_at IS NOT NULL/.test(source)));

  let sentBody;
  const answer = await createLinkToken({ clientUserId: 'client-1' }, {
    environment: 'sandbox',
    clientId: 'client-id',
    secret: 'secret',
    env: { ADAPTERS_DRY_RUN: '0' },
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      const body = { link_token: 'link-1', expiration: 'soon' };
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  });
  assert.equal(answer.ok, true);
  assert.equal(sentBody.redirect_uri, undefined, 'OAuth redirect_uri is still absent and stays visible as a proved red result');

  const routes = read('netlify/functions/api.mjs');
  assert.doesNotMatch(routes, /plaid[^\n]*(webhook|item\/remove)/i);
  assert.doesNotMatch(plaidLink, /redirect_uri/);
});

test('the saved-bank freshness and vanished-account outcomes are checked, not inferred from a table name', () => {
  const overview = read('api/money/overview.mjs');
  const money = read('public/app/money.js');
  const refresh = read('src/banking/plaid-refresh.mjs');
  assert.doesNotMatch(overview, /SELECT[\s\S]{0,2500}balance_as_of/i);
  assert.match(money, /as of/i);
  assert.match(refresh, /vanished/);
  assert.match(refresh, /has NOT been closed or removed/);
});

test('the daily trend job runs snapshot then backfill on fake clients', async () => {
  const calls = [];
  const result = await sweep({}, {
    now: new Date('2026-10-11T07:30:00Z'),
    list: async () => [{ org_id: 'org-1', client_id: 'client-1' }],
    snapshot: async (_db, args) => { calls.push(['snapshot', args.day]); return { accounts: 2 }; },
    backfill: async (_db, args) => { calls.push(['backfill', args.today]); return { rollupRows: 3 }; },
  });
  assert.deepEqual(calls, [['snapshot', '2026-10-11'], ['backfill', '2026-10-11']]);
  assert.equal(result.accounts, 2);
  assert.equal(result.estimatedDays, 3);
});

test('the shelved report link, blank merge tag, and EEO email produce their real fake-data results', async () => {
  const signed = signReportUrl({
    orgId: '11111111-1111-4111-8111-111111111111',
    ref: 'sample-ref',
    secret: 'x'.repeat(64),
    now: () => Date.parse('2026-10-11T00:00:00Z'),
  });
  assert.match(signed.path, /^\/funnel\/decline-autopsy\/report\.html\?/);
  assert.match(
    read('netlify/functions/api.mjs'),
    /\/\* DECLINE AUTOPSY[\s\S]*["']public\/decline-autopsy-report["']:[^\n]*\*\//,
  );

  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(renderTemplate('Pay {{pay_url}}', {}), 'Pay ');
    assert.equal(renderTemplate('Open {{magic_link.url}}', { magic_link: null }), 'Open ');
  } finally {
    console.warn = oldWarn;
  }

  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ template_key: 'EMAIL-CANDIDATE-EEO-INVITE', channel: 'email', subject: 'Survey', body: 'Open {{survey.url}}' }] };
      }
      return { rows: [{ id: 'message-1' }] };
    },
  };
  const queued = await queueInviteEmail(db, {
    orgId: 'org-1',
    toAddress: 'candidate@example.test',
    firstName: 'Sam',
    token: 'token-value',
  });
  assert.equal(queued.queued, true);
  assert.match(queries[1].params[2], /https:\/\/fundhub\.ai\/eeo-survey\.html\?token=token-value/);
});

test('every emailed-link host chain is read from the code that builds that link', () => {
  const sources = [
    read('src/workflows/messaging.mjs'),
    read('src/messaging/dispatch.mjs'),
    read('src/auth/magic-link.mjs'),
    read('src/sales/closer-deck.mjs'),
    read('api/contracts.mjs'),
    read('src/affiliates/share-link.mjs'),
    read('src/ops/brief-link.mjs'),
  ].join('\n');
  for (const key of ['APP_BASE_URL', 'PUBLIC_BASE_URL', 'PORTAL_BASE_URL', 'DEPLOY_PRIME_URL']) {
    assert.match(sources, new RegExp(key));
  }
  assert.match(sources, /https:\/\/fundhub\.ai/);
});

test('the parked pipeline controls and product alias resolver return their current results', async () => {
  const html = read('public/app/pipeline.html');
  assert.doesNotMatch(html, /<div class="rail-tab"[^>]*data-rail="R-03"/);
  assert.match(html, /Optimization · Round Sent/);
  assert.match(html, /A payment does not move a card/);

  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/resolve_product_id/i.test(sql)) return { rows: [{ product_id: 'product-1' }] };
      return { rows: [] };
    },
  };
  assert.equal(await resolveProductId(db, 'org-1', { productName: 'Old offer name' }), 'product-1');
  assert.match(calls[0].sql, /resolve_product_id/);
  assert.deepEqual(calls[0].params, ['org-1', 'Old offer name']);
});
