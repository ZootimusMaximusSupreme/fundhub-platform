import { test } from "node:test";
import assert from "node:assert/strict";
import { existingRoundClient, handle } from "./f-05-inquiry-cleanup-gate.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const step = { run: async (_label, operation) => operation() };
const event = (overrides = {}) => ({
  id: "f05+approved@example.test",
  name: "round.approved",
  orgId: ORG_A,
  clientId: CLIENT_A,
  payload: {},
  ...overrides
});

function fakeDb({
  clients = [{ id: CLIENT_A, org_id: ORG_A, email: "f05+owner@example.test" }],
  inquiries = []
} = {}) {
  const state = { clients, inquiries, queries: [], updates: 0 };
  state.query = async (sql, params = []) => {
    state.queries.push({ sql, params });
    if (/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
      const row = clients.find(c => c.id === params[0] && c.org_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/SELECT id FROM clients WHERE org_id = \$1 AND lower\(email\) = \$2/.test(sql)) {
      const row = clients.find(c => c.org_id === params[0] &&
        String(c.email || "").toLowerCase() === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/UPDATE inquiry_log/.test(sql)) {
      assert.match(sql, /org_id = \$1 AND client_id = \$2/, "never update a different tenant");
      assert.match(sql, /is_open = true/, "closed inquiries are immutable here");
      assert.match(sql, /confirmed_at IS NULL/, "confirmed removal is immutable here");
      const [orgId, clientId] = params;
      let updated = 0;
      for (const inq of inquiries) {
        if (inq.org_id !== orgId || inq.client_id !== clientId ||
            inq.is_open !== true || inq.confirmed_at != null ||
            inq.status === "Pending Removal" ||
            /(^|[^a-z])(removed|confirmed|deleted|cleared)([^a-z]|$)/i.test(String(inq.status || ""))) continue;
        inq.status = "Pending Removal";
        updated += 1;
      }
      state.updates += 1;
      return { rowCount: updated };
    }
    throw new Error("Unexpected SQL: " + sql);
  };
  return state;
}

const inquiry = (status, extras = {}) => ({
  org_id: ORG_A, client_id: CLIENT_A, status, is_open: true,
  confirmed_at: null, ...extras
});

test("open inquiries transition; replay updates zero rows", async () => {
  const db = fakeDb({ inquiries: [inquiry("New"), inquiry("Active"), inquiry("Pending Removal")] });
  const first = await handle({ event: event(), db, step });
  const second = await handle({ event: event(), db, step });
  assert.deepEqual(first, { done: true, updated: 2 });
  assert.deepEqual(second, { done: true, updated: 0 });
  assert.ok(db.inquiries.every(i => i.status === "Pending Removal"));
});

test("terminal statuses, confirmation timestamp and closed boolean never reopen", async () => {
  const statuses = ["Removed", "Cleared", "Confirmed", "Deleted", "Removed - verified", "unconfirmed", "Active"];
  const rows = statuses.map(s => inquiry(s));
  rows.push(inquiry("Active", { confirmed_at: new Date("2026-10-01") }));
  rows.push(inquiry("Active", { is_open: false }));
  const db = fakeDb({ inquiries: rows });
  const result = await handle({ event: event(), db, step });
  assert.equal(result.updated, 2, "only unconfirmed and active are open");
  assert.deepEqual(rows.map(r => r.status), [
    "Removed", "Cleared", "Confirmed", "Deleted", "Removed - verified",
    "Pending Removal", "Pending Removal", "Active", "Active"
  ]);
});

test("same client id in another organization's inquiry row cannot be rewritten", async () => {
  const foreign = inquiry("New", { org_id: ORG_B });
  const local = inquiry("New");
  const db = fakeDb({ inquiries: [foreign, local] });
  const result = await handle({ event: event(), db, step });
  assert.equal(result.updated, 1);
  assert.equal(foreign.status, "New");
  assert.equal(local.status, "Pending Removal");
});

test("an explicit cross-tenant client id is refused before ANY update", async () => {
  const db = fakeDb({ inquiries: [inquiry("New")] });
  const result = await handle({ event: event({ orgId: ORG_B }), db, step });
  assert.deepEqual(result, { done: false, reason: "no_client" });
  assert.equal(db.updates, 0);
  assert.equal(db.inquiries[0].status, "New");
});

test("an event without an organization is refused", async () => {
  const db = fakeDb({ inquiries: [inquiry("New")] });
  assert.deepEqual(await handle({ event: event({ orgId: null }), db, step }),
    { done: false, reason: "missing_org" });
  assert.equal(db.queries.length, 0);
});

test("email-only historical round event finds existing client, case-insensitively", async () => {
  const db = fakeDb({ inquiries: [inquiry("New")] });
  const result = await handle({
    event: event({ clientId: null, payload: { email: "  F05+OWNER@EXAMPLE.TEST " } }),
    db, step
  });
  assert.deepEqual(result, { done: true, updated: 1 });
});

test("unknown email cannot create a phantom client on round approval", async () => {
  const db = fakeDb({ inquiries: [inquiry("New")] });
  const result = await handle({
    event: event({ clientId: null, payload: { email: "f05+unknown@example.test" } }),
    db, step
  });
  assert.deepEqual(result, { done: false, reason: "no_client" });
  assert.equal(db.clients.length, 1);
  assert.equal(db.updates, 0);
  assert.ok(db.queries.every(q => /^SELECT/.test(q.sql)));
});

test("existing client lookup with no org or malformed client never writes", async () => {
  const db = fakeDb();
  assert.equal(await existingRoundClient(db, { clientId: CLIENT_B, orgId: ORG_A }), null);
  assert.equal(await existingRoundClient(db, { orgId: ORG_B, payload: { email: "f05+owner@example.test" } }), null);
  assert.equal(db.updates, 0);
});
