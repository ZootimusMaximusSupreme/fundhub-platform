import assert from "node:assert/strict";
import test from "node:test";

import {
  actingClientId,
  addAuthorizedRep,
  destinationAddress,
  setActiveFile,
} from "../../../auth/authorized-rep.mjs";
import { eventForStage } from "../../../funding/card-stacking-rounds.mjs";
import { clearRuleCache } from "../../../compliance/screen.mjs";
import { dispatchOne, OUTCOME } from "../../../messaging/dispatch.mjs";
import { recorded, reset } from "../../../messaging/providers/memory.mjs";

const ORG = "20000000-0000-4000-8000-000000000001";
const CLIENT_A = "20000000-0000-4000-8000-000000000002";
const CLIENT_B = "20000000-0000-4000-8000-000000000003";
const CLIENT_C = "20000000-0000-4000-8000-000000000004";
const ACCOUNT_1 = "20000000-0000-4000-8000-000000000005";
const ACCOUNT_2 = "20000000-0000-4000-8000-000000000006";
const STAFF = "20000000-0000-4000-8000-000000000007";

function repWriterDb() {
  const clients = new Set([CLIENT_A, CLIENT_B]);
  const accounts = new Map([
    ["rep-one@example.test", { id: ACCOUNT_1, kind: "authorized_rep" }],
    ["rep-two@example.test", { id: ACCOUNT_2, kind: "authorized_rep" }],
  ]);
  const links = new Map();
  const removed = [];

  return {
    links,
    removed,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT id FROM clients WHERE id = $1")) {
        return { rows: clients.has(params[0]) ? [{ id: params[0] }] : [] };
      }
      if (text.includes("SELECT id FROM clients WHERE org_id = $1")) return { rows: [] };
      if (text.includes("SELECT id, kind FROM accounts")) {
        const account = accounts.get(params[1]);
        return { rows: account ? [account] : [] };
      }
      if (text.includes("UPDATE accounts")) return { rows: [] };
      if (text.includes("SELECT account_id FROM client_authorized_reps")) {
        const accountId = links.get(params[0]);
        return { rows: accountId ? [{ account_id: accountId }] : [] };
      }
      if (text.includes("UPDATE client_authorized_reps SET removed_at")) {
        const accountId = links.get(params[0]);
        if (accountId) removed.push({ clientId: params[0], accountId });
        links.delete(params[0]);
        return { rows: [] };
      }
      if (text.includes("UPDATE account_sessions")) return { rows: [] };
      if (text.includes("INSERT INTO client_authorized_reps")) {
        links.set(params[2], params[1]);
        return { rows: [] };
      }
      throw new Error(`unexpected authorized-rep write query: ${text.slice(0, 120)}`);
    },
  };
}

test("staff links one representative to two files and a new person replaces one live link", async () => {
  const db = repWriterDb();
  const common = { orgId: ORG, name: "Fake Rep", phone: "+15551234567", staffId: STAFF };

  const first = await addAuthorizedRep(db, {
    ...common, clientId: CLIENT_A, email: "rep-one@example.test",
  });
  const second = await addAuthorizedRep(db, {
    ...common, clientId: CLIENT_B, email: "rep-one@example.test",
  });
  const replacement = await addAuthorizedRep(db, {
    ...common, clientId: CLIENT_A, email: "rep-two@example.test",
  });

  assert.deepEqual(
    [first.ok, second.ok, replacement.ok, replacement.replaced],
    [true, true, true, true],
  );
  assert.equal(db.links.get(CLIENT_A), ACCOUNT_2);
  assert.equal(db.links.get(CLIENT_B), ACCOUNT_1);
  assert.deepEqual(db.removed, [{ clientId: CLIENT_A, accountId: ACCOUNT_1 }]);
});
test("the portal opens the first linked file and refuses an unlinked switch", async () => {
  const sessionWrites = [];
  const linked = new Set([CLIENT_A, CLIENT_B]);
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT client_id FROM client_authorized_reps")) {
        return { rows: [{ client_id: CLIENT_A }] };
      }
      if (text.includes("SELECT 1 FROM client_authorized_reps")) {
        return { rows: linked.has(params[1]) ? [{ "?column?": 1 }] : [] };
      }
      if (text.includes("UPDATE account_sessions")) {
        sessionWrites.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected authorized-rep portal query: ${text.slice(0, 120)}`);
    },
  };

  const first = await actingClientId(db, {
    accountId: ACCOUNT_1, orgId: ORG, sessionId: "session-1", activeClientId: null,
  });
  const switched = await setActiveFile(db, {
    accountId: ACCOUNT_1, clientId: CLIENT_B, orgId: ORG,
  });
  const refused = await setActiveFile(db, {
    accountId: ACCOUNT_1, clientId: CLIENT_C, orgId: ORG,
  });

  assert.equal(first, CLIENT_A);
  assert.deepEqual(switched, { ok: true, clientId: CLIENT_B });
  assert.deepEqual(refused, { ok: false, status: 403, error: "not_your_file" });
  assert.deepEqual(sessionWrites, [
    ["session-1", CLIENT_A],
    [ACCOUNT_1, CLIENT_B],
  ]);
});

function representativeDeliveryDb() {
  const updates = [];
  const reps = new Map([
    [CLIENT_A, { account_id: ACCOUNT_1, email: "rep@example.test", phone: "+15550001111", name: "Fake Rep" }],
  ]);
  const clients = new Map([
    [CLIENT_A, { email: "client-a@example.test", phone: "+15550002222" }],
    [CLIENT_C, { email: "client-c@example.test", phone: "+15550003333" }],
  ]);

  return {
    updates,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM opt_outs")) return { rows: [] };
      if (text.includes("FROM compliance_rules")) return { rows: [] };
      if (text.includes("SELECT body, subject FROM message_templates")) {
        return { rows: [{ body: "Ready", subject: "Update" }] };
      }
      if (text.includes("FROM message_channel_routing")) {
        return { rows: [{ provider: "memory", enabled: true }] };
      }
      if (text.includes("AS address FROM clients")) {
        const row = clients.get(params[0]) || {};
        return { rows: [{ address: text.includes("SELECT phone") ? row.phone : row.email }] };
      }
      if (text.includes("JOIN accounts")) {
        const rep = reps.get(params[0]);
        return { rows: rep ? [rep] : [] };
      }
      if (text.includes("UPDATE messages")) {
        updates.push({ sql: text, params });
        return { rows: [] };
      }
      throw new Error(`unexpected representative-delivery query: ${text.slice(0, 120)}`);
    },
  };
}

test("email and text reach the representative through the final memory delivery result", async () => {
  clearRuleCache();
  reset();
  const db = representativeDeliveryDb();
  const env = {
    APP_BASE_URL: "https://example.test",
    UNSUBSCRIBE_TOKEN_SECRET: "fake-flow-proof-secret-that-is-long-enough",
  };
  const messages = [
    { id: "rep-email", client_id: CLIENT_A, channel: "email", subject: "Update" },
    { id: "rep-sms", client_id: CLIENT_A, channel: "sms", subject: null },
    { id: "client-email", client_id: CLIENT_C, channel: "email", subject: "Update" },
  ].map((row) => ({
    ...row,
    org_id: ORG,
    rendered_body: "Your file is ready.",
    template_key: "FLOW-REP-PROOF",
    provider_ref: `proof:${row.id}`,
    attempts: 1,
    to_address: null,
  }));

  const results = [];
  for (const message of messages) {
    results.push(await dispatchOne(db, message, {
      env,
      now: () => new Date("2026-10-11T17:00:00Z"),
      fetchImpl: async () => { throw new Error("memory delivery must not use the network"); },
    }));
  }

  assert.deepEqual(results.map((row) => row.outcome), [OUTCOME.SENT, OUTCOME.SENT, OUTCOME.SENT]);
  assert.deepEqual(recorded().map((row) => row.to), [
    "rep@example.test",
    "+15550001111",
    "client-c@example.test",
  ]);
  assert.equal(db.updates.filter((entry) => entry.sql.includes("status = 'sent'")).length, 3);

  assert.equal(await destinationAddress(db, CLIENT_A, "email", "client-a@example.test"), "rep@example.test");
  assert.equal(await destinationAddress(db, CLIENT_C, "email", "client-c@example.test"), "client-c@example.test");
});

test("Action Required is a state-only funding move with no event result", () => {
  assert.equal(eventForStage("action_required"), null);
  assert.equal(eventForStage("funded"), "round.funded");
});
