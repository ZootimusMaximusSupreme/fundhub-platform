import assert from "node:assert/strict";
import test from "node:test";

import { handle as sweepMeetTranscripts } from "./meet-transcript-sweeper.mjs";
import { handle as readBureauResponse } from "./repair-bureau-response.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

test("meet-transcript-sweeper pairs real words and stamps the sales call", async () => {
  const upserts = [];
  const callUpdates = [];
  const steps = [];
  const db = {
    async query(sql, params = []) {
      if (/UNION/i.test(sql) && /brain_drive_sync/i.test(sql)) {
        return { rows: [{ org_id: ORG }] };
      }
      if (/needs_transcription = true/i.test(sql)) {
        return {
          rows: [{
            id: "brain-recording",
            drive_file_id: "drive-recording",
            name: "Funding Call - Jane Doe - Recording.mp4",
            mime_type: "video/mp4",
            web_view_link: "https://drive.google.com/file/d/recording",
            client_id: CLIENT
          }]
        };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return { rows: [{ id: "brain-transcript", name: "Funding Call - Jane Doe - Transcript" }] };
      }
      if (/FROM brain_chunks/i.test(sql)) {
        assert.equal(params[0], "brain-transcript");
        return { rows: [{ content: "Closer: the approved starting amount is three thousand dollars." }] };
      }
      if (/UPDATE call_outcomes SET transcript/i.test(sql)) {
        callUpdates.push({ sql, params });
        return { rows: [{ id: "call-outcome-1" }] };
      }
      return { rows: [] };
    }
  };

  const summary = await sweepMeetTranscripts({
    db,
    env: {},
    step: {
      async run(name, work) {
        steps.push(name);
        return work();
      }
    },
    syncDrive: async () => ({ ok: true }),
    upsert: async (_db, args) => {
      upserts.push(args);
      return { ok: true, fileId: "brain-recording" };
    }
  });

  assert.deepEqual(steps, ["sweep-meet-words"]);
  assert.equal(summary.orgs, 1);
  assert.equal(summary.synced, 1);
  assert.equal(summary.paired, 1);
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].extracted.text, /three thousand dollars/);
  assert.equal(upserts[0].extracted.needsTranscription, false);
  assert.equal(callUpdates.length, 1);
  assert.equal(callUpdates[0].params[0], ORG);
  assert.equal(callUpdates[0].params[1], CLIENT);
  assert.match(callUpdates[0].params[2], /three thousand dollars/);
});

test("repair-bureau-response-reader records and advances a clear bureau answer", async () => {
  const responses = [];
  const itemUpdates = [];
  const sent = [];
  const events = [];
  const itemId = "33333333-3333-4333-8333-333333333333";
  const caseId = "44444444-4444-4444-8444-444444444444";
  const documentId = "55555555-5555-4555-8555-555555555555";
  const items = [{
    id: itemId,
    case_id: caseId,
    creditor: "Midland",
    account_last4: "4521",
    round: "R1",
    status: "sent"
  }];
  const db = {
    async query(sql, params = []) {
      if (/FROM documents d/i.test(sql)) {
        assert.deepEqual(params.slice(0, 4), [documentId, ORG, CLIENT, "bureau_response"]);
        return { rows: [{ id: documentId }] };
      }
      if (/INSERT INTO dispute_responses/i.test(sql)) {
        const row = {
          id: `response-${responses.length + 1}`,
          case_id: params[0],
          org_id: params[1],
          client_id: params[2],
          raw_text: params[3],
          parse_json: JSON.parse(params[4]),
          confidence: params[5],
          confirmed: params[6],
          confirmed_by: params[7]
        };
        responses.push(row);
        return { rows: [row] };
      }
      if (/UPDATE dispute_items/i.test(sql)) {
        itemUpdates.push({ id: params[0], status: params[1], round: params[2], outcome: params[3] });
        return { rows: [] };
      }
      if (/INSERT INTO repair_decision_log/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };

  const result = await readBureauResponse({
    db,
    event: {
      id: "event-bureau-response",
      orgId: ORG,
      clientId: CLIENT,
      payload: {
        kind: "bureau_response",
        document_id: documentId,
        mime_type: "image/jpeg"
      }
    },
    bytes: Buffer.from("stand-in bureau response"),
    items,
    callModelImpl: async () => ({
      mode: "fake",
      error: null,
      text: JSON.stringify({
        quality: "pass",
        text: "Experian response for account ending 4521: the item has been deleted from your file. Account 4521 deleted.",
        bureau_guess: "EX",
        message_to_client: ""
      })
    }),
    sendTemplatedImpl: async (_db, message) => {
      sent.push(message);
      return { sent: true, fake: true };
    },
    onEvent: async (_db, event) => {
      events.push(event);
      return { ok: true };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "advanced");
  assert.equal(result.parse.outcomes[0].outcome, "deleted");
  assert.equal(responses.length, 1);
  assert.equal(responses[0].confirmed, true);
  assert.equal(itemUpdates.length, 1);
  assert.equal(itemUpdates[0].id, itemId);
  assert.equal(itemUpdates[0].status, "deleted");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateKey, "EMAIL-REPAIR-RESPONSE-RESULTS");
  assert.ok(events.some((event) => event.name === "repair.response.parsed"));
});
