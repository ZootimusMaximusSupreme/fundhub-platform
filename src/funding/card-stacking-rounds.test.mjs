// Set A 2026-10-20, item 16. Owner: closing a round is ONE round done, not the job done. A funding
// sequence has about six rounds, and the whole engagement completes only when the sequence closes.
// So the Close round receipt says stage "closed" and never claims the engagement is complete.

import test from "node:test";
import assert from "node:assert/strict";

import { emitCardStackingRoundTransition } from "./card-stacking-rounds.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function eventsDb() {
  const saved = [];
  return {
    saved,
    async query(sql, params) {
      if (/INSERT INTO events/.test(sql)) {
        saved.push({ name: params[1], clientId: params[4], payload: params[5], key: params[3] });
        return { rows: [{ id: `e${saved.length}` }] };
      }
      return { rows: [] };
    }
  };
}

test("Close round names the closed stage, the client and the round, and does not mark the engagement complete", async () => {
  const prior = process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_EVENT_KEY;
  try {
    const db = eventsDb();
    const out = await emitCardStackingRoundTransition(db, { orgId: ORG, clientId: CLIENT, stageKey: "closed", roundNumber: 2 });
    assert.equal(out.eventName, "round.closeout");
    assert.equal(db.saved.length, 1);
    const [event] = db.saved;
    assert.equal(event.name, "round.closeout");
    assert.equal(event.clientId, CLIENT);
    assert.equal(event.payload.stage, "closed");
    assert.equal(event.payload.source, "card_stacking");
    assert.equal(event.payload.roundNumber, 2);
    assert.equal(event.payload.engagementComplete, false, "one round closing is not the whole engagement");
  } finally {
    if (prior !== undefined) process.env.INNGEST_EVENT_KEY = prior;
  }
});

test("no other round stage claims the engagement is complete either", async () => {
  const prior = process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_EVENT_KEY;
  try {
    for (const stageKey of ["apply_now", "round_submitted", "approved"]) {
      const db = eventsDb();
      await emitCardStackingRoundTransition(db, { orgId: ORG, clientId: CLIENT, stageKey, roundNumber: 1 });
      assert.equal(db.saved[0].payload.engagementComplete, false, stageKey);
    }
  } finally {
    if (prior !== undefined) process.env.INNGEST_EVENT_KEY = prior;
  }
});
