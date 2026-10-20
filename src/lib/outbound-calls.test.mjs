import { test } from "node:test";
import assert from "node:assert";
import { recordDispatch, resolveClientByCallId, resolveDispatchByCallId } from "./outbound-calls.mjs";

// In-memory db stub that tracks inserted rows.
function makeDb() {
  const rows = new Map(); // call_id → {client_id, org_id, kind}
  const clients = new Map();
  return {
    query(sql, params) {
      if (/INSERT INTO outbound_calls/.test(sql)) {
        const [call_id, client_id, org_id, kind] = params;
        // ON CONFLICT DO NOTHING semantics
        if (!rows.has(call_id)) rows.set(call_id, { client_id, org_id, kind });
        clients.set(client_id, org_id);
        return { rows: [] };
      }
      if (/SELECT client_id FROM outbound_calls/.test(sql)) {
        const [call_id] = params;
        const row = rows.get(call_id);
        return row ? { rows: [{ client_id: row.client_id }] } : { rows: [] };
      }
      if (/FROM outbound_calls oc/.test(sql)) {
        assert.match(sql, /JOIN clients c ON c.id = oc.client_id AND c.org_id = oc.org_id/);
        const row = rows.get(params[0]);
        return { rows: row && clients.get(row.client_id) === row.org_id ? [row] : [] };
      }
      return { rows: [] };
    },
    _rows: rows, _clients: clients
  };
}

test("recordDispatch: inserts a new dispatch record", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_1", clientId: "client-a", orgId: "org-1", kind: "inquiry_removal", db });
  assert.equal(db._rows.size, 1);
  assert.equal(db._rows.get("call_1").client_id, "client-a");
});

test("recordDispatch: idempotent — second call with same callId does not overwrite", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_2", clientId: "client-a", orgId: "org-1", kind: "inquiry_removal", db });
  await recordDispatch({ callId: "call_2", clientId: "client-b", orgId: "org-1", kind: "inquiry_removal", db });
  // Still client-a (first write wins)
  assert.equal(db._rows.get("call_2").client_id, "client-a");
});

test("resolveClientByCallId: returns client_id for known callId", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_3", clientId: "client-c", orgId: "org-1", kind: "inquiry_removal", db });
  const clientId = await resolveClientByCallId("call_3", db);
  assert.equal(clientId, "client-c");
});

test("resolveClientByCallId: returns null for unknown callId", async () => {
  const db = makeDb();
  const clientId = await resolveClientByCallId("call_unknown", db);
  assert.equal(clientId, null);
});

test("resolveDispatchByCallId returns the saved client and company together", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_a", clientId: "client-a", orgId: "org-a", kind: "coach", db });
  await recordDispatch({ callId: "call_b", clientId: "client-b", orgId: "org-b", kind: "coach", db });
  assert.deepEqual(await resolveDispatchByCallId("call_a", db), { clientId: "client-a", orgId: "org-a" });
  assert.deepEqual(await resolveDispatchByCallId("call_b", db), { clientId: "client-b", orgId: "org-b" });
  assert.equal(await resolveDispatchByCallId("unknown", db), null);
});

test("resolveDispatchByCallId refuses dispatch/client company mismatches", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_a", clientId: "client-a", orgId: "org-a", kind: "coach", db });
  db._clients.set("client-a", "org-b");
  assert.equal(await resolveDispatchByCallId("call_a", db), null);
  db._clients.delete("client-a");
  assert.equal(await resolveDispatchByCallId("call_a", db), null);
});
