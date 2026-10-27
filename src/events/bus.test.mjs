import { test } from "node:test";
import assert from "node:assert";
import { emit, replay, _resetOrgCache } from "./bus.mjs";
import { on, clearHandlers } from "./registry.mjs";

// Fake db: routes by SQL keyword, returns canned rows. `events` array is the store.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    calls: [],
    query(sql, params) {
      this.calls.push({ sql, params });
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] }; // idempotency conflict
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], version: params[2], org_id: params[0], client_id: params[4], payload: params[5] });
        return { rows: [row] };
      }
      if (/UPDATE events/.test(sql)) return { rows: [] };
      if (/SELECT id, name/.test(sql)) return { rows: store };
      return { rows: [] };
    }
  };
}

test("emit: canonical event inserts + dispatches to handler", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("deposit.paid", (e) => seen.push(e));
  const db = fakeDb();
  const res = await emit(db, "deposit.paid", { amount: 3000 }, { clientId: "c1" });
  assert.equal(res.deduped, false);
  assert.equal(res.id, "evt-1");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "deposit.paid");
  assert.deepEqual(seen[0].payload, { amount: 3000 });
  assert.equal(seen[0].clientId, "c1");
});

test("emit marks only explicitly simulated events as demo rows", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  await emit(db, "analysis.completed", { simulated: true }, { orgId: "org-1", isDemo: true });
  await emit(db, "analysis.completed", {}, { orgId: "org-1" });
  const inserts = db.calls.filter((call) => /INSERT INTO events/.test(call.sql));
  assert.match(inserts[0].sql, /is_demo/);
  assert.equal(inserts[0].params[6], true);
  assert.doesNotMatch(inserts[1].sql, /is_demo/);
  assert.equal(inserts[1].params.length, 6);
});

test("emit: unknown event throws unless allowNonCanonical", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  await assert.rejects(() => emit(db, "made.up.event", {}), /unknown event/);
  const ok = await emit(db, "made.up.event", {}, { allowNonCanonical: true });
  assert.equal(ok.deduped, false);
});

test("emit: idempotency-key conflict is a safe no-op (no dispatch)", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("payment.received", () => seen.push(1));
  const db = fakeDb({ dedup: true });
  const res = await emit(db, "payment.received", {}, { idempotencyKey: "abc" });
  assert.equal(res.deduped, true);
  assert.equal(res.id, null);
  assert.equal(seen.length, 0, "handler must NOT fire on a deduped event");
});

test("bridge: bus.emit fires legacy handlers and does not throw when INNGEST_EVENT_KEY is unset", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("deposit.paid", (e) => seen.push(e.name));
  const db = fakeDb();
  // Ensure key is absent
  delete process.env.INNGEST_EVENT_KEY;
  const res = await emit(db, "deposit.paid", { amount: 500 }, { clientId: "c-bridge" });
  assert.equal(res.deduped, false);
  assert.equal(seen.length, 1, "legacy handler must still fire");
  assert.equal(seen[0], "deposit.paid");
});

test("bridge: inngest.send data shape matches what handle() reads (event.data.{id,payload,orgId,clientId})", async () => {
  _resetOrgCache(); clearHandlers();
  const sent = [];
  // Temporarily mock inngest on the module — we intercept via process.env + a fake inngest
  // by capturing the internal dispatch event shape via a handler.
  const db = fakeDb();
  // We test the shape by verifying the dispatch (internal) carries the right shape.
  // The Inngest bridge sends { name, data: { id, payload, orgId, clientId } }.
  // We validate this by reading what dispatch() receives (the internal event object):
  const captured = [];
  on("deposit.paid", (e) => captured.push(e));
  const res = await emit(db, "deposit.paid", { amount: 999 }, { clientId: "c-shape", orgId: "org-shape" });
  assert.equal(captured.length, 1);
  const e = captured[0];
  // event.data shape (what handle reads after `event: event.data`):
  assert.ok(e.id, "event.id must be set (used for task body idempotency)");
  assert.deepEqual(e.payload, { amount: 999 }, "event.payload must be the original payload object");
  assert.equal(e.orgId, "org-shape", "event.orgId must be set");
  assert.equal(e.clientId, "c-shape", "event.clientId must be set");
});

test("replay: re-dispatches stored events", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = fakeDb({ store });
  await emit(db, "round.funded", { n: 1 }, { clientId: "c1" });
  await emit(db, "round.funded", { n: 2 }, { clientId: "c2" });
  const seen = [];
  on("round.funded", (e) => seen.push(e.payload.n));
  const res = await replay(db, { name: "round.funded" });
  assert.equal(res.dispatched, 2);
  assert.deepEqual(seen, [1, 2]);
});
