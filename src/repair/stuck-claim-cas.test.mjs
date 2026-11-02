// Stale repair-mail reconcile: an old tab must not clear a newer send claim.
// Pure Node mock — no PostGrid, no production database, no physical mail.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { clearStuckSendClaim } from "./send.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "55555555-5555-4555-8555-555555555555";

test("stale repair-mail reconcile read cannot clear a newer active send claim", async () => {
  const letterId = randomUUID();
  const clientId = randomUUID();
  const caseId = randomUUID();
  const oldToken = "2026-10-31 10:00:00.123456+00";
  const newToken = "2026-10-31 11:00:00.654321+00";

  const staleClaimedAt = new Date(Date.now() - 3_600_000);
  let live = {
    status: "sending",
    send_claimed_at: staleClaimedAt,
    claim_token: oldToken,
    mailed_at: null,
    postgrid_letter_id: null,
  };

  let interleaved = false;
  const decisionInserts = [];
  const updateBoundTokens = [];
  const staleReader = {
    async query(sql, params = []) {
      if (/FROM dispute_letters/.test(sql) && /^\s*SELECT/i.test(sql)) {
        const snapshot = {
          id: letterId,
          client_id: clientId,
          case_id: caseId,
          status: "sending",
          mailed_at: null,
          postgrid_letter_id: null,
          send_claimed_at: staleClaimedAt,
          claim_token: oldToken,
        };
        if (!interleaved) {
          interleaved = true;
          live = {
            status: "sending",
            send_claimed_at: new Date(),
            claim_token: newToken,
            mailed_at: null,
            postgrid_letter_id: null,
          };
        }
        return { rows: [snapshot] };
      }
      if (/^\s*UPDATE dispute_letters/i.test(sql)) {
        const boundToken = params[4];
        updateBoundTokens.push(boundToken);
        if (boundToken !== live.claim_token) return { rows: [] };
        live = {
          status: "ready",
          send_claimed_at: null,
          claim_token: null,
          mailed_at: null,
          postgrid_letter_id: null,
        };
        return { rows: [{ id: letterId, status: "ready" }] };
      }
      if (/INSERT INTO repair_decision_log/i.test(sql)) {
        decisionInserts.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };

  const stale = await clearStuckSendClaim(staleReader, {
    orgId: ORG,
    letterId,
    staffId: STAFF,
    reason: "synthetic provider reconciliation",
    minAgeMinutes: 0,
  });

  assert.equal(interleaved, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "not_claimed");
  assert.deepEqual(updateBoundTokens, [oldToken], "CAS UPDATE must bind the stale read token, not the live claim");
  assert.equal(decisionInserts.length, 0, "failed CAS must not write repair_decision_log");
  assert.equal(live.status, "sending");
  assert.ok(live.send_claimed_at);
  assert.ok(live.claim_token);
  assert.notEqual(live.claim_token, oldToken);
  assert.equal(live.mailed_at, null);
});

test("current claim token can still be cleared after provider reconciliation", async () => {
  const letterId = randomUUID();
  const clientId = randomUUID();
  const caseId = randomUUID();
  // Driver returns a Date; Postgres binds send_claimed_at::text AS claim_token on UPDATE.
  const token = "2026-10-31 12:00:00.111111+00";
  const sendClaimedAt = new Date("2026-10-31T12:00:00.111Z");

  let live = {
    status: "sending",
    send_claimed_at: sendClaimedAt,
    claim_token: token,
    mailed_at: null,
    postgrid_letter_id: null,
  };

  const db = {
    async query(sql, params = []) {
      if (/FROM dispute_letters/.test(sql) && /^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: letterId,
            client_id: clientId,
            case_id: caseId,
            status: live.status,
            mailed_at: live.mailed_at,
            postgrid_letter_id: live.postgrid_letter_id,
            send_claimed_at: live.send_claimed_at,
            claim_token: live.claim_token,
          }],
        };
      }
      if (/^\s*UPDATE dispute_letters/i.test(sql)) {
        assert.equal(params[4], token, "UPDATE must use claim_token text from SELECT, not a JS Date reserialisation");
        assert.notEqual(params[4], sendClaimedAt.toISOString());
        live = { status: "ready", send_claimed_at: null, claim_token: null, mailed_at: null, postgrid_letter_id: null };
        return { rows: [{ id: letterId, status: "ready" }] };
      }
      if (/INSERT INTO repair_decision_log/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };

  const out = await clearStuckSendClaim(db, {
    orgId: ORG,
    letterId,
    staffId: STAFF,
    reason: "synthetic provider did not accept",
    minAgeMinutes: 0,
  });

  assert.equal(out.ok, true);
  assert.equal(out.letterId, letterId);
  assert.equal(out.status, "ready");
  assert.equal(live.status, "ready");
  assert.equal(live.send_claimed_at, null);
  assert.equal(live.claim_token, null);
});
