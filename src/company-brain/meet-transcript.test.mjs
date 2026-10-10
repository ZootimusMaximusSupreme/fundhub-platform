import test from "node:test";
import assert from "node:assert/strict";
import { applyMeetWords, pairMeetTranscripts, processOrgMeetWords, sweepMeetTranscripts } from "./meet-transcript.mjs";
import { WHISPER_CREDITS_ERROR } from "./transcribe.mjs";
import { SWEEP_CRON } from "../workflows/meet-transcript-sweeper.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

test("pairMeetTranscripts copies sibling transcript words onto the recording", async () => {
  const upserts = [];
  const db = {
    async query(sql, params) {
      if (/needs_transcription = true/i.test(sql)) {
        return {
          rows: [{
            id: "bf-rec",
            drive_file_id: "drv-rec",
            name: "Funding Call - Jane Doe - Recording.mp4",
            mime_type: "video/mp4",
            web_view_link: "https://drive.google.com/file/d/rec",
            client_id: CLIENT
          }]
        };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return {
          rows: [{
            id: "bf-doc",
            name: "Funding Call - Jane Doe - Transcript"
          }]
        };
      }
      if (/FROM brain_chunks/i.test(sql)) {
        assert.equal(params[0], "bf-doc");
        return { rows: [{ content: "Closer: the start is three thousand." }] };
      }
      return { rows: [] };
    }
  };
  const out = await pairMeetTranscripts(db, {
    orgId: ORG,
    upsert: async (_db, args) => {
      upserts.push(args);
      return { ok: true, fileId: "bf-rec" };
    }
  });
  assert.equal(out.applied, 1);
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].extracted.text, /three thousand/);
  assert.equal(upserts[0].extracted.needsTranscription, false);
});

test("pairMeetTranscripts does not guess when two docs share a stem", async () => {
  const db = {
    async query(sql) {
      if (/needs_transcription = true/i.test(sql)) {
        return {
          rows: [{
            id: "bf-rec",
            drive_file_id: "drv-rec",
            name: "Call - Recording.mp4",
            mime_type: "video/mp4",
            web_view_link: null,
            client_id: null
          }]
        };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return {
          rows: [
            { id: "a", name: "Call - Transcript" },
            { id: "b", name: "Call - Gemini notes" }
          ]
        };
      }
      if (/FROM brain_chunks/i.test(sql)) {
        return { rows: [{ content: "words" }] };
      }
      return { rows: [] };
    }
  };
  const out = await pairMeetTranscripts(db, {
    orgId: ORG,
    upsert: async () => {
      throw new Error("should not upsert");
    }
  });
  assert.equal(out.applied, 0);
});

function pendingAvDb(rows) {
  return {
    async query(sql) {
      if (/needs_transcription = true/i.test(sql) && /mime_type LIKE 'video\/%'/i.test(sql)) {
        return { rows };
      }
      if (/needs_transcription = true/i.test(sql)) {
        return { rows };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return { rows: [] };
      }
      if (/SELECT DISTINCT org_id FROM brain_files/i.test(sql)) {
        return { rows: [{ org_id: ORG }, { org_id: "00000000-0000-4000-8000-000000000002" }] };
      }
      return { rows: [] };
    }
  };
}

test("a 429 credit miss leaves files pending and does not whisper the rest", async () => {
  let whisperCalls = 0;
  let upserts = 0;
  const db = pendingAvDb([
    {
      id: "bf-a",
      drive_file_id: "drv-a",
      name: "Meet Recording - Call A.mp4",
      mime_type: "video/mp4",
      web_view_link: null,
      client_id: null
    },
    {
      id: "bf-b",
      drive_file_id: "drv-b",
      name: "Meet Recording - Call B.mp4",
      mime_type: "video/mp4",
      web_view_link: null,
      client_id: null
    }
  ]);
  const client = {
    async getFile() { return { size: 1_000_000 }; },
    async downloadMedia() { return Buffer.from("ID3fake"); }
  };
  const out = await processOrgMeetWords(db, {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    client,
    upsert: async () => {
      upserts += 1;
      return { ok: true, fileId: "bf-a" };
    },
    fetchImpl: async () => {
      whisperCalls += 1;
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          error: { type: "insufficient_quota", message: "You exceeded your current quota" }
        }),
        headers: { forEach() {} }
      };
    }
  });
  assert.equal(whisperCalls, 1);
  assert.equal(upserts, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.reason, WHISPER_CREDITS_ERROR);
});

test("sweepMeetTranscripts stops other orgs after a credit miss", async () => {
  let orgsSeen = 0;
  const db = {
    async query(sql) {
      if (/UNION/i.test(sql) && /brain_drive_sync/i.test(sql)) {
        return { rows: [{ org_id: ORG }, { org_id: "00000000-0000-4000-8000-000000000002" }] };
      }
      if (/SELECT DISTINCT org_id FROM brain_files/i.test(sql)) {
        return { rows: [{ org_id: ORG }, { org_id: "00000000-0000-4000-8000-000000000002" }] };
      }
      if (/needs_transcription = true/i.test(sql) && /mime_type LIKE 'video\/%'/i.test(sql)) {
        orgsSeen += 1;
        return {
          rows: [{
            id: "bf-a",
            drive_file_id: "drv-a",
            name: "Meet Recording - Call A.mp4",
            mime_type: "video/mp4",
            web_view_link: null,
            client_id: null
          }]
        };
      }
      if (/needs_transcription = true/i.test(sql)) {
        return { rows: [] };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const summary = await sweepMeetTranscripts(db, {
    env: { OPENAI_API_KEY: "sk-test" },
    syncDrive: async () => ({ ok: true }),
    client: {
      async getFile() { return { size: 1_000_000 }; },
      async downloadMedia() { return Buffer.from("ID3fake"); }
    },
    upsert: async () => ({ ok: true }),
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        error: { type: "insufficient_quota", message: "You exceeded your current quota" }
      }),
      headers: { forEach() {} }
    })
  });
  assert.equal(summary.reason, WHISPER_CREDITS_ERROR);
  assert.equal(summary.orgs, 1);
  assert.ok(orgsSeen <= 1);
});

test("Meet word sweeper stays on a ten-minute keep-alive", () => {
  assert.equal(SWEEP_CRON, "*/10 * * * *");
});

test("applyMeetWords still stamps the sales call when Brain embed is down", async () => {
  const updates = [];
  const db = {
    async query(sql, params) {
      updates.push({ sql, params });
      return { rows: [{ id: "co-1" }] };
    }
  };
  const out = await applyMeetWords(db, {
    orgId: ORG,
    extracted: {
      fileId: "drv-rec",
      name: "Meet Recording - Jane.mp4",
      webViewLink: "https://drive.google.com/file/d/rec",
      clientId: CLIENT
    },
    text: "three thousand is a start",
    upsert: async () => ({ ok: false, reason: "embed_failed" })
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "sales_words_saved_brain_embed_skipped");
  assert.ok(updates.some((u) => /SET transcript/i.test(u.sql)));
  assert.ok(updates.some((u) => /needs_transcription = false/i.test(u.sql)));
});

test("course videos are not whispered", async () => {
  let downloads = 0;
  let whisperCalls = 0;
  const db = pendingAvDb([{
    id: "bf-course",
    drive_file_id: "drv-course",
    name: "1. Intro to funding.mp4",
    mime_type: "video/mp4",
    web_view_link: null,
    client_id: null
  }]);
  const out = await processOrgMeetWords(db, {
    orgId: ORG,
    env: { OPENAI_API_KEY: "sk-test" },
    client: {
      async getFile() { throw new Error("should not size course"); },
      async downloadMedia() {
        downloads += 1;
        return Buffer.from("ID3fake");
      }
    },
    upsert: async () => {
      throw new Error("should not upsert course");
    },
    fetchImpl: async () => {
      whisperCalls += 1;
      throw new Error("should not whisper course");
    }
  });
  assert.equal(downloads, 0);
  assert.equal(whisperCalls, 0);
  assert.equal(out.whispered, 0);
  assert.equal(out.skipped, 1);
});
