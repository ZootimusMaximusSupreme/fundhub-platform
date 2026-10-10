// The document vault on the closer's path (Capital Blueprint B3): when the CSM
// closing prep call and the closer alert are opened, the task carries one sentence
// saying whether the file is complete. The dedupe key does not move.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  vaultNote, createBlueprintCsmPrepCallTask, createBlueprintCloserReadyTask, evaluateBlueprintCloserReady,
  CSM_PREP_TITLE, CSM_PREP_SOURCE, CLOSER_READY_TITLE, CLOSER_READY_SOURCE, PREP_CALL_DEDUPE
} from "./closer-ready.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-07T12:00:00Z");

const doc = (id, subtype) => ({
  id, kind: "client_upload", subtype, title: subtype, generated_at: "2026-10-01T10:00:00Z", expires_at: null, metadata: {}
});
const accepted = (document_id) => ({
  document_id, status: "accepted", item_key: null, entity_id: null, covers: 1, period_end: null, reason: null,
  reviewed_at: "2026-10-02T10:00:00Z", reviewed_by_name: null
});

const COMPLETE_DOCS = [
  doc("00000000-0000-4000-8000-0000000000a1", "id_document"),
  doc("00000000-0000-4000-8000-0000000000a2", "proof_of_address"),
  doc("00000000-0000-4000-8000-0000000000a3", "tax_return"),
  doc("00000000-0000-4000-8000-0000000000a4", "tax_return")
];

/** Answers the vault's reads, the tasks table, and the bits the gate needs. */
function mockDb(state = {}) {
  const s = {
    clientExists: true, documents: [], reviews: [], vaultThrows: null, tasks: {}, inserts: [],
    insertThrowsOnDetail: null, csm: null, waypointTotal: 2, waypointOpen: 0, buyer: true, ...state
  };
  return {
    state: s,
    async query(sql, params = []) {
      if (/FROM transactions/i.test(sql) && /products/i.test(sql)) return { rows: s.buyer ? [{ x: 1 }] : [] };
      if (/client_waypoints/i.test(sql) && /open_count/i.test(sql)) return { rows: [{ total: s.waypointTotal, open_count: s.waypointOpen }] };
      if (/FROM crs_results/i.test(sql)) return { rows: [{ result: { scores: { ex: 720, eq: 705, tu: 710 } }, created_at: "2026-01-02T00:00:00Z" }] };
      if (/FROM tradelines/i.test(sql)) return { rows: [{ id: "t1", org_id: ORG, client_id: CLIENT, lender: "Chase", kind: "revolving", credit_limit_cents: 1000000, balance_cents: 250000, apr: "0.1899", closed_at: null }] };
      if (/FROM card_liabilities/i.test(sql)) return { rows: [] };
      if (/FROM businesses/i.test(sql) && /age_months/i.test(sql)) return { rows: [] };
      if (/FROM clients/i.test(sql) && /custom_fields/i.test(sql)) return { rows: [{ custom_fields: { crs_negative_items_count: 0 } }] };
      if (/assigned_csm_staff_id/i.test(sql)) return { rows: [{ assigned_csm_staff_id: s.csm }] };
      // ── the vault's reads
      if (s.vaultThrows && /FROM (documents|document_vault|entities|pii_identity|businesses)/i.test(sql)) throw new Error(s.vaultThrows);
      if (/SELECT id, first_name, last_name FROM clients/i.test(sql)) return { rows: s.clientExists ? [{ id: CLIENT, first_name: "Sim", last_name: "Buyer" }] : [] };
      if (/FROM entities/i.test(sql)) return { rows: [] };
      if (/FROM businesses/i.test(sql)) return { rows: [] };
      if (/FROM documents/i.test(sql)) return { rows: s.documents };
      if (/FROM document_vault_reviews/i.test(sql)) return { rows: s.reviews };
      if (/FROM document_vault_items/i.test(sql)) return { rows: [] };
      if (/FROM pii_identity/i.test(sql)) return { rows: [] };
      // ── tasks
      if (/FROM tasks/i.test(sql) && /source_workflow/i.test(sql)) {
        const row = s.tasks[`${params[1]}:${params[2]}`];
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const withDetail = /\bdetail\b/.test(sql);
        if (withDetail && s.insertThrowsOnDetail) throw Object.assign(new Error("column \"detail\" of relation \"tasks\" does not exist"), { code: s.insertThrowsOnDetail });
        s.inserts.push({ sql, params, withDetail });
        const key = `${params[5]}:${params[3]}`;
        s.tasks[key] = s.tasks[key] || { id: `task-${s.inserts.length}`, done: false };
        return { rows: [{ id: s.tasks[key].id }] };
      }
      return { rows: [] };
    }
  };
}

describe("vaultNote", () => {
  test("complete: one sentence that says so", async () => {
    const db = mockDb({ documents: COMPLETE_DOCS, reviews: COMPLETE_DOCS.map((d) => accepted(d.id)) });
    const n = await vaultNote(db, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.equal(n.line, "Document vault: file complete — 3 of 3 items accepted.");
    assert.deepEqual([n.vault.complete, n.vault.open], [true, 0]);
  });

  test("incomplete: names what is open and where each stands", async () => {
    const db = mockDb({ documents: [COMPLETE_DOCS[0]], reviews: [] });
    const n = await vaultNote(db, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.match(n.line, /^Document vault: 0 of 3 items done\. Still open: Government photo ID \(sent, waiting for review\); /);
    assert.equal(n.vault.complete, false);
    assert.equal(n.vault.open, 3);
  });

  test("a vault that cannot be read says so, and is never 'complete'", async () => {
    const n = await vaultNote(mockDb({ vaultThrows: "connection reset" }), { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.match(n.line, /could not be checked/);
    assert.equal(n.vault.complete, null);
    assert.match(n.vault.error, /connection reset/);
  });

  test("a client the vault cannot find has no line", async () => {
    const n = await vaultNote(mockDb({ clientExists: false }), { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.deepEqual(n, { line: null, vault: null });
  });
});

describe("the CSM closing prep call", () => {
  test("carries the vault line; the key, the title and the source do not move", async () => {
    const db = mockDb({ documents: COMPLETE_DOCS, reviews: COMPLETE_DOCS.map((d) => accepted(d.id)) });
    const res = await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(res.created, true);
    assert.equal(res.detail, "Document vault: file complete — 3 of 3 items accepted.");
    const ins = db.state.inserts[0];
    assert.equal(ins.withDetail, true);
    assert.equal(ins.params[2], CSM_PREP_TITLE);
    assert.equal(ins.params[3], PREP_CALL_DEDUPE, "body is still the dedupe key");
    assert.equal(ins.params[5], CSM_PREP_SOURCE);
    assert.equal(ins.params[6], "csm");
    assert.equal(ins.params[9], "Document vault: file complete — 3 of 3 items accepted.");
  });

  test("an incomplete vault is on the task too, so the CSM can collect before the closer calls", async () => {
    const db = mockDb({ documents: [] });
    await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    assert.match(db.state.inserts[0].params[9], /^Document vault: 0 of 3 items done\. Still open: Government photo ID \(not sent\)/);
  });

  test("DEDUPE IS UNCHANGED: asking twice makes one task, and the second ask writes nothing", async () => {
    const db = mockDb();
    const first = await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    // createTask looks the task up by (client, source, body) before inserting.
    db.state.tasks[`${CSM_PREP_SOURCE}:${PREP_CALL_DEDUPE}`] = { id: first.id, done: false };
    const second = await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(second.created, false);
    assert.equal(second.reason, "duplicate_event");
    assert.equal(db.state.inserts.length, 1);
  });

  test("a vault that cannot be read never stops the task: it is opened with 'could not be checked'", async () => {
    const db = mockDb({ vaultThrows: "relation \"document_vault_reviews\" does not exist" });
    const res = await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(res.created, true);
    assert.match(db.state.inserts[0].params[9], /could not be checked/);
  });

  test("a database without tasks.detail (472 not applied) still gets the task, with no note", async () => {
    const db = mockDb({ insertThrowsOnDetail: "42703" });
    const res = await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(res.created, true);
    assert.equal(db.state.inserts.length, 1);
    assert.equal(db.state.inserts[0].withDetail, false);
    assert.equal(db.state.inserts[0].params.length, 9, "the original nine-value insert");
  });

  test("any other database error is still an error", async () => {
    const db = mockDb({ insertThrowsOnDetail: "23505" });
    await assert.rejects(() => createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT }), /detail/);
  });

  test("a FinanceOS 'Ready to get funded' round 2 carries the line under its own key", async () => {
    const db = mockDb();
    await createBlueprintCsmPrepCallTask(db, { orgId: ORG, clientId: CLIENT, eventId: `${PREP_CALL_DEDUPE}:r2` });
    assert.equal(db.state.inserts[0].params[3], `${PREP_CALL_DEDUPE}:r2`);
    assert.ok(db.state.inserts[0].params[9]);
  });

  test("with no ids nothing is read or written", async () => {
    const db = mockDb();
    assert.deepEqual(await createBlueprintCsmPrepCallTask(db, {}), { created: false, reason: "missing_ids" });
    assert.deepEqual(await createBlueprintCloserReadyTask(db, {}), { created: false, reason: "missing_ids" });
    assert.equal(db.state.inserts.length, 0);
  });
});

describe("the closer alert", () => {
  test("carries the vault line", async () => {
    const db = mockDb({ documents: [COMPLETE_DOCS[0]], reviews: [accepted(COMPLETE_DOCS[0].id)] });
    const res = await createBlueprintCloserReadyTask(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(res.created, true);
    const ins = db.state.inserts[0];
    assert.equal(ins.params[2], CLOSER_READY_TITLE);
    assert.equal(ins.params[5], CLOSER_READY_SOURCE);
    assert.equal(ins.params[6], "closer");
    assert.match(ins.params[9], /^Document vault: 1 of 3 items done\. Still open: Proof of current address \(not sent\)/);
  });

  test("the whole gate: a fundable file with prep closed opens the CSM call with the vault line, then the closer after it is done", async () => {
    const db = mockDb();
    const first = await evaluateBlueprintCloserReady(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(first.branch, "csm_prep_open");
    assert.match(db.state.inserts[0].params[9], /^Document vault: /);
    // The CSM marks the call done: the next pass alerts the closer, also with the line.
    db.state.tasks[`${CSM_PREP_SOURCE}:${PREP_CALL_DEDUPE}`].done = true;
    const second = await evaluateBlueprintCloserReady(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(second.branch, "closer_alert");
    const closer = db.state.inserts.find((i) => i.params[5] === CLOSER_READY_SOURCE);
    assert.match(closer.params[9], /^Document vault: /);
  });
});
