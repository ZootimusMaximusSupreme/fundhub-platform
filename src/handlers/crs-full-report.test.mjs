import { test } from "node:test";
import assert from "node:assert/strict";
import { onAnalysisCompletedFullReport, REPORT_SUBTYPE } from "./crs-full-report.mjs";

const EVENT = { id: "event-1", orgId: "org-1", clientId: "client-1", payload: { source: "crs", crsResultId: "result-1" } };
const RESULT = { environment: "production", bureaus: { EX: { scores: [{ scoreValue: 700 }] } } };

function fakeDb({ provider = "crs_softview", result = RESULT, email = "client@fundhub.ai", archivedAt = null } = {}) {
  const calls = [];
  let queued = false;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM crs_results/.test(sql)) return { rows: [{ result, provider }] };
      if (/FROM clients/.test(sql)) return { rows: [{ first_name: "Test", last_name: "Person", email, crm_archived_at: archivedAt }] };
      if (/INSERT INTO messages/.test(sql)) {
        if (queued) return { rows: [] };
        queued = true;
        return { rows: [{ id: "message-1", created_at: "2026-10-29T18:00:00Z" }] };
      }
      if (/SELECT id, status FROM messages/.test(sql)) return { rows: [{ id: "message-1", status: "sent" }] };
      if (/INSERT INTO conversations|UPDATE messages/.test(sql)) return { rows: [{ id: "conversation-1" }] };
      return { rows: [] };
    }
  };
}

test("only a real production CRS result saves and queues the complete PDF once", async () => {
  const db = fakeDb();
  const persisted = [];
  const options = {
    store: {},
    buildPdf: async () => Buffer.from("%PDF-1.4 test"),
    persist: async (_db, _store, args) => { persisted.push(args); return { document: { id: "doc-1" } }; },
    dispatch: async () => ({ outcome: "sent" })
  };
  const first = await onAnalysisCompletedFullReport(EVENT, db, options);
  const second = await onAnalysisCompletedFullReport(EVENT, db, options);
  assert.equal(first.saved, true);
  assert.equal(first.emailed, true);
  assert.equal(second.deduped, true);
  assert.equal(persisted[0].subtype, REPORT_SUBTYPE);
  assert.equal(persisted[0].sourceEventId, EVENT.id);
  const sends = db.calls.filter(({ sql }) => /INSERT INTO messages/.test(sql));
  assert.equal(sends.length, 2);
  assert.equal(sends[0].params[3], "workflow:crs-full-report:result-1");
  assert.deepEqual(JSON.parse(sends[0].params[6]),
    [{ document_id: "doc-1", filename: "Fundhub-Credit-Report.pdf" }]);
});

test("simulated, sandbox, and non-CRS events send nothing", async () => {
  const db = fakeDb();
  assert.equal((await onAnalysisCompletedFullReport({ ...EVENT, payload: { ...EVENT.payload, simulated: true } }, db)).saved, false);
  assert.equal((await onAnalysisCompletedFullReport({ ...EVENT, payload: { source: "analyzer" } }, db)).saved, false);
  assert.equal(db.calls.length, 0);
  const sandbox = fakeDb({ result: { ...RESULT, environment: "sandbox" } });
  const out = await onAnalysisCompletedFullReport(EVENT, sandbox);
  assert.equal(out.saved, false);
  assert.equal(sandbox.calls.filter(({ sql }) => /INSERT INTO messages/.test(sql)).length, 0);
});

test("an archived client keeps the report but receives no stale-event email", async () => {
  const db = fakeDb({ archivedAt: "2026-10-29T18:00:00Z" });
  const out = await onAnalysisCompletedFullReport(EVENT, db, {
    store: {}, buildPdf: async () => Buffer.from("%PDF-1.4 test"),
    persist: async () => ({ document: { id: "doc-1" } })
  });
  assert.equal(out.saved, true);
  assert.equal(out.emailed, false);
  assert.equal(out.reason, "client_archived");
  assert.equal(db.calls.filter(({ sql }) => /INSERT INTO messages/.test(sql)).length, 0);
});
