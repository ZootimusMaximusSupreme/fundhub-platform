// A repair decision must name the client (and the case, when there is one) it is about.
// The catalog data check reads repair_decision_log and goes red on a row with no client.
// This pins the one writer in src/repair/send.mjs: the decision it saves carries the
// letter's own client and case. No database needed; the stand-in db records the insert.

import assert from 'node:assert/strict';
import test from 'node:test';

import { clearStuckSendClaim } from './send.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';
const LETTER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CASE = '44444444-4444-4444-8444-444444444444';
const STAFF = '55555555-5555-4555-8555-555555555555';

function standInDb(letter) {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      if (/FROM dispute_letters/.test(sql) && /^\s*SELECT/i.test(sql)) return { rows: letter ? [letter] : [] };
      if (/^\s*UPDATE dispute_letters/i.test(sql)) return { rows: [{ id: LETTER, status: 'ready' }] };
      if (/INSERT INTO repair_decision_log/i.test(sql)) {
        inserts.push({ org_id: params[0], client_id: params[1], case_id: params[2], decision: params[3], payload: JSON.parse(params[4]) });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

const stuck = () => ({
  id: LETTER,
  client_id: CLIENT,
  case_id: CASE,
  status: 'sending',
  mailed_at: null,
  postgrid_letter_id: null,
  send_claimed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
});

test('clearing a stuck send claim saves a decision that names the letter\'s client and case', async () => {
  const db = standInDb(stuck());
  const out = await clearStuckSendClaim(db, { orgId: ORG, letterId: LETTER, staffId: STAFF, reason: 'PostGrid shows no letter' });
  assert.equal(out.ok, true);
  assert.equal(db.inserts.length, 1);
  const saved = db.inserts[0];
  assert.equal(saved.org_id, ORG);
  assert.equal(saved.client_id, CLIENT, 'the client is on the decision');
  assert.equal(saved.case_id, CASE, 'the case is on the decision');
  assert.equal(saved.decision, 'repair.letter.send_claim_cleared');
  assert.equal(saved.payload.staffId, STAFF);
  assert.equal(saved.payload.letterId, LETTER);
});

test('a refused clear saves no decision at all, so no unlinked row can appear', async () => {
  const mailed = { ...stuck(), mailed_at: new Date().toISOString() };
  const db = standInDb(mailed);
  const out = await clearStuckSendClaim(db, { orgId: ORG, letterId: LETTER, staffId: STAFF, reason: 'x' });
  assert.equal(out.ok, false);
  assert.equal(db.inserts.length, 0);
  const missing = standInDb(null);
  assert.equal((await clearStuckSendClaim(missing, { orgId: ORG, letterId: LETTER, staffId: STAFF, reason: 'x' })).reason, 'not_found');
  assert.equal(missing.inserts.length, 0);
});
