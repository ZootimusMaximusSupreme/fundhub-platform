// A conversation ID is not evidence its client belongs to that organization.
// The database has a client foreign key but no composite client/org constraint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAndSend } from "./compose.mjs";

test("staff reply refuses an own-org thread pointing to a foreign-org client", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM conversations cv/.test(sql)) {
        // SQL-semantics fake: this row exists in conversations but the client
        // belongs to a different org, so an exact-org join returns nothing.
        if (/JOIN clients c ON c\.id = cv\.client_id AND c\.org_id = cv\.org_id/.test(sql)) {
          return { rows: [] };
        }
        return { rows: [{ id: "conversation-A", client_id: "client-B", channel: "sms" }] };
      }
      throw new Error("cannot query address, insert message, or dispatch for a foreign client");
    }
  };

  await assert.rejects(
    () => composeAndSend(db, {
      orgId: "org-A", staffId: "staff-A", conversationId: "conversation-A",
      body: "Private funding status"
    }),
    (err) => err?.code === "BAD_REQUEST" && /no such conversation/.test(err.message)
  );
  assert.equal(calls.length, 1, "the wrong-client conversation must stop before any other SQL");
  assert.deepEqual(calls[0].params, ["conversation-A", "org-A"]);
  assert.match(calls[0].sql, /JOIN clients c ON c\.id = cv\.client_id AND c\.org_id = cv\.org_id/);
});
