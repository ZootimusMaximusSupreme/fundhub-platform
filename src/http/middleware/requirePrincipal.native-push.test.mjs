import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePrincipal } from "./requirePrincipal.mjs";

test("client principal carries its verified account session for native device binding", async () => {
  const sessionId = "1776d94f-f9a8-4551-a6b3-e502c77d2bbd";
  const accountId = "654fa3de-802b-4b92-a81c-c7fb55886644";
  const orgId = "614669c0-706d-4f1a-a0ed-c70eedba35c8";
  const clientId = "79289a7e-b4da-419a-b761-608aeaa2ef71";
  const db = { async query(sql) {
    if (sql.includes("UPDATE sessions")) return { rows: [] };
    if (sql.includes("UPDATE account_sessions")) return { rows: [{
      id: sessionId, account_id: accountId, org_id: orgId,
      expires_at: new Date(Date.now() + 60_000), active_client_id: null
    }] };
    if (sql.includes("FROM accounts WHERE id")) return { rows: [{
      id: accountId, org_id: orgId, kind: "client", status: "active",
      client_id: clientId, affiliate_id: null, partner_id: null,
      email: "test@example.invalid", name: "Test"
    }] };
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  } };
  const principal = await resolvePrincipal({ headers: { authorization: "Bearer test-session" } }, { db });
  assert.equal(principal.kind, "client");
  assert.equal(principal.clientId, clientId);
  assert.equal(principal.sessionId, sessionId);
});
