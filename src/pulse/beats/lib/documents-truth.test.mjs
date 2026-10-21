// documents:stuck-processing: one judge for the morning lane and the hourly beat, with the same windows.
import test from "node:test";
import assert from "node:assert/strict";

import * as truth from "./documents-truth.mjs";
import * as lane from "../../coverage/gap-documents.mjs";

const NOW = new Date("2026-10-08T15:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";

function read(answers = {}) {
  return async (sql) => {
    if (/FROM documents/.test(sql)) return { rows: answers.delivery ?? [{ pending: 0, failed: 0 }] };
    if (/FROM failed_events/.test(sql)) return { rows: answers.reader ?? [{ overdue: 0, unread: 0 }] };
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
}

test("documents truth: the lane's windows (from its crons) equal the numbers the beat uses", () => {
  assert.equal(truth.STUCK_WINDOWS.vaultRedMs, lane.VAULT_RED_MS);
  assert.equal(truth.STUCK_WINDOWS.readerRedMs, lane.READER_RED_MS);
  assert.equal(truth.STUCK_WINDOWS.readerUnreadMs, lane.READER_UNREAD_MS);
  assert.equal(lane.STUCK_DELIVERY_SQL, truth.STUCK_DELIVERY_SQL);
  assert.equal(lane.STUCK_READER_SQL, truth.STUCK_READER_SQL);
  assert.equal(lane.READER_HANDLER, truth.READER_HANDLER);
  assert.equal(lane.ID_STUCK, truth.ID_STUCK);
});

test("documents truth: the hourly read gives the lane's own row, both ways", async () => {
  for (const answers of [{}, { delivery: [{ pending: 2, failed: 1 }] }, { reader: [{ overdue: 1, unread: 0 }] }]) {
    const hourly = await truth.readStuckProcessing({ read: read(answers), orgId: ORG, now: NOW });
    const db = { query: read(answers) };
    const daily = (await lane.gapChecks({ db, orgId: ORG, now: NOW, documentStore: { name: "netlify-blobs" } }))
      .find((row) => row.id === truth.ID_STUCK);
    assert.deepEqual(hourly, daily);
  }
  const red = await truth.readStuckProcessing({ read: read({ delivery: [{ pending: 2, failed: 0 }] }), orgId: ORG, now: NOW });
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /2 document rows stuck pending past 3 days/);
});

test("documents truth: a count with no row is a skip and a read that throws is the lane's FAIL, never green", async () => {
  const empty = await truth.readStuckProcessing({ read: read({ delivery: [] }), orgId: ORG, now: NOW });
  assert.equal(empty.status, "skip");
  const thrown = await truth.readStuckProcessing({ read: async () => { throw new Error("connection refused"); }, orgId: ORG, now: NOW });
  assert.equal(thrown.status, "FAIL");
  assert.match(thrown.detail, /read failed: connection refused/);
});
