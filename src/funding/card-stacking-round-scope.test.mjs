// Fulfillment regression: never borrow another funding round's approvals or
// success-fee evidence when a staff action names a missing/stale round.
// Mock-only: no database write, event delivery, payment, bureau call or message.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roundFor, guardFundedAmount, emitCardStackingRoundTransition
} from "./card-stacking-rounds.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function roundDb() {
  const latest = { id: "historical-round-1", round_number: 1, status: "approved" };
  const queries = [];
  return {
    latest,
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("AND round_number = $3")) {
        assert.equal(params[0], ORG);
        assert.equal(params[1], CLIENT);
        return { rows: params[2] === 1 ? [latest] : [] };
      }
      if (sql.includes("ORDER BY round_number DESC")) return { rows: [latest] };
      throw new Error("An unexpected database read or write was attempted");
    }
  };
}

test("explicit missing round does not silently use the latest round", async () => {
  const db = roundDb();
  assert.equal(await roundFor(db, { orgId: ORG, clientId: CLIENT, roundNumber: 2 }), null);
  assert.equal(db.queries.length, 1, "only the requested round is queried");
  assert.equal(db.queries[0].params[2], 2);
  assert.equal(await roundFor(db, { orgId: ORG, clientId: CLIENT, roundNumber: 0 }), null);
  assert.equal(await roundFor(db, { orgId: ORG, clientId: CLIENT, roundNumber: "not-a-number" }), null);
  assert.equal(db.queries.length, 1, "invalid round numbers never hit the database");
  assert.equal((await roundFor(db, { orgId: ORG, clientId: CLIENT })).id, db.latest.id,
    "only an omitted round number is allowed to select the latest");
});

test("the funded gate refuses an explicit stale round instead of accepting its prior approvals", async () => {
  const db = roundDb();
  const verdict = await guardFundedAmount(db, {
    orgId: ORG, clientId: CLIENT, roundNumber: 2, fundedAmount: 25000
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "funding_round_not_found");
  assert.equal(verdict.round, null);
  assert.equal(db.queries.length, 1, "do not inspect bank approvals or amounts from another round");
});

test("no funded event or fee evidence is emitted for a missing explicit round", async () => {
  const db = roundDb();
  const out = await emitCardStackingRoundTransition(db, {
    orgId: ORG, clientId: CLIENT, stageKey: "funded", roundNumber: 2,
    fundedAmount: 25000
  });
  assert.equal(out.emitted, false);
  assert.equal(out.reason, "funding_round_not_found");
  assert.equal(out.roundNumber, 2);
  assert.equal(db.queries.length, 1, "must not read the previous round's fee agreement");
});

test("malformed explicit round numbers cannot silently fall back to a different round", async () => {
  const db = roundDb();
  const out = await emitCardStackingRoundTransition(db, {
    orgId: ORG, clientId: CLIENT, stageKey: "funded", roundNumber: "bad",
    fundedAmount: 25000
  });
  assert.equal(out.emitted, false);
  assert.equal(out.reason, "invalid_round_number");
  assert.equal(db.queries.length, 0);
});
