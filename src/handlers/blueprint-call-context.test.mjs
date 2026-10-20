import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBlandEvent, mapToCanonical } from "../adapters/bland.mjs";
import { onCallCompleted } from "./comms.mjs";

test("Bland words, summary and recording survive canonical mapping into the CRM voice message", async () => {
  const [event] = mapToCanonical(normalizeBlandEvent({
    call_id: "call-blueprint", completed: true, status: "completed",
    concatenated_transcript: "assistant: Did you mail the letters?\nuser: I mailed them today.",
    summary: "Client reports mailing; proof still needed.",
    recording_url: "https://recordings.example.test/call-blueprint"
  }));
  const seen = [];
  await onCallCompleted({ ...event, orgId: "org-a", clientId: "client-a" }, {
    query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; }
  });
  const insert = seen.find((x) => /INSERT INTO messages/.test(x.sql));
  assert.equal(insert.params[0], "org-a");
  assert.equal(insert.params[1], "client-a");
  assert.match(insert.params[2], /proof still needed/);
  assert.match(insert.params[2], /user: I mailed them today/);
  assert.match(insert.params[2], /Recording: https:\/\/recordings/);
  assert.equal(insert.params[4], "call-blueprint");
  assert.match(insert.sql, /messages\.client_id IS NOT DISTINCT FROM EXCLUDED\.client_id/);
  assert.match(insert.sql, /WHEN \$7::text IS NOT NULL/);
});

test("Bland per-turn transcripts retain speakers and absent words stay unknown", () => {
  const evt = normalizeBlandEvent({ completed: true, transcripts: [
    { user: "agent", text: "What is next?" }, { user: "user", text: "Deposit Friday." }, null
  ] });
  assert.equal(evt.transcript, "agent: What is next?\nuser: Deposit Friday.");
  assert.equal(normalizeBlandEvent({ completed: true }).transcript, null);
});

test("a receipt without transcript does not replace previously saved call words", async () => {
  let inserted;
  await onCallCompleted({ orgId: "org-a", clientId: "client-a", payload: {
    callId: "call-blueprint", disposition: "human", status: "completed"
  } }, { query: async (sql, params) => { if (/INSERT INTO messages/.test(sql)) inserted = { sql, params }; return { rows: [] }; } });
  assert.equal(inserted.params[6], null);
  assert.match(inserted.sql, /ELSE COALESCE\(messages\.rendered_body, EXCLUDED\.rendered_body\)/);
});
