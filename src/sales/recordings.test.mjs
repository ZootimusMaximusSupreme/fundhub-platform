import test from "node:test";
import assert from "node:assert/strict";
import {
  filenameMentionsPerson,
  recordingCallTime,
  uniqueNameMatch,
  attachDriveRecording,
  listRecentRecordings,
  stampCallTranscript
} from "./recordings.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

test("filenameMentionsPerson needs both first and last", () => {
  assert.equal(
    filenameMentionsPerson("Strategy session - Jane Doe - 2026-08-15", "Jane", "Doe"),
    true
  );
  assert.equal(filenameMentionsPerson("Meeting with Jane", "Jane", "Doe"), false);
  assert.equal(filenameMentionsPerson("orphan.mp4", "Jane", "Doe"), false);
});

test("uniqueNameMatch attaches only when one client matches", () => {
  const clients = [
    { id: "a", first_name: "Jane", last_name: "Doe" },
    { id: "b", first_name: "John", last_name: "Smith" }
  ];
  assert.equal(
    uniqueNameMatch(clients, "Meet - Jane Doe").id,
    "a"
  );
  assert.equal(
    uniqueNameMatch(
      [{ id: "a", first_name: "Jane", last_name: "Doe" },
       { id: "c", first_name: "Jane", last_name: "Doe" }],
      "Meet - Jane Doe"
    ),
    null
  );
});

test("recordingCallTime reads Google's scheduled time and UTC offset", () => {
  assert.equal(
    recordingCallTime("Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Recording.mp4"),
    "2026-08-24T22:00:00.000Z"
  );
  assert.equal(recordingCallTime("Meet Recording 2026-08-24"), null);
});

test("attachDriveRecording stamps the call nearest the file's exact meeting time", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/UPDATE call_outcomes/i.test(sql)) return { rows: [{ id: "co-1" }] };
      if (/UPDATE customer_insights/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const out = await attachDriveRecording(db, {
    orgId: ORG,
    clientId: CLIENT,
    fileName: "Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Recording.mp4",
    url: "https://drive.google.com/file/d/abc"
  });
  assert.equal(out.attached, true);
  assert.equal(out.clientId, CLIENT);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].params[3], "2026-08-24T22:00:00.000Z");
  assert.match(seen[0].sql, /LEFT JOIN tasks/i);
  assert.match(seen[0].sql, /LEFT JOIN bookings/i);
  assert.match(seen[0].sql, /interval '15 minutes'/i);
  assert.doesNotMatch(seen[0].sql, /COALESCE\(b\.starts_at, t\.due_at, o\.logged_at\)/i);
  assert.match(seen[0].sql, /ORDER BY ABS\(EXTRACT\(EPOCH/i);
});

test("attachDriveRecording does not guess a call when the file has no exact time", async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (/UPDATE customer_insights/i.test(sql)) return { rows: [] };
      return { rows: [{ id: "wrong-call" }] };
    }
  };
  const out = await attachDriveRecording(db, {
    orgId: ORG,
    clientId: CLIENT,
    fileName: "Meet Recording.mp4",
    url: "https://drive.google.com/file/d/no-time"
  });
  assert.equal(out.attached, true);
  assert.equal(seen.some((sql) => /UPDATE call_outcomes/i.test(sql)), false);
});

test("listRecentRecordings is honest when Drive is off and files are empty", async () => {
  const db = {
    async query(sql) {
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/brain_files/i.test(sql)) return { rows: [] };
      if (/call_outcomes/i.test(sql)) return { rows: [] };
      if (/FROM clients/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const out = await listRecentRecordings(db, { orgId: ORG, env: {}, now: new Date("2026-08-15T18:00:00Z") });
  assert.equal(out.drive_ready, false);
  assert.ok(out.missing.includes("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"));
  assert.equal(out.items.length, 0);
  assert.match(out.reason, /not connected/i);
});

test("listRecentRecordings returns today's Drive file and name-matches a client", async () => {
  const now = new Date("2026-08-15T18:00:00Z");
  const updates = [];
  const db = {
    async query(sql, params) {
      if (/brain_drive_sync/i.test(sql)) {
        return { rows: [{ last_sync_at: "2026-08-15T17:00:00Z", last_error: null }] };
      }
      if (/FROM brain_files/i.test(sql)) {
        return {
          rows: [{
            id: "bf-1",
            name: "Strategy session - Jane Doe",
            web_view_link: "https://drive.google.com/file/d/rec1",
            client_id: null,
            unattached: true,
            indexed_at: "2026-08-15T16:00:00Z",
            created_at: "2026-08-15T16:00:00Z",
            mime_type: "video/mp4",
            needs_transcription: true,
            first_name: null,
            last_name: null
          }]
        };
      }
      if (/FROM call_outcomes/i.test(sql) && /SELECT o.id/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM clients c/i.test(sql)) {
        return { rows: [{ id: CLIENT, first_name: "Jane", last_name: "Doe" }] };
      }
      if (/UPDATE brain_files/i.test(sql)) {
        updates.push(params);
        return { rows: [] };
      }
      if (/UPDATE call_outcomes/i.test(sql) || /UPDATE customer_insights/i.test(sql)) {
        return { rows: [{ id: "x" }] };
      }
      return { rows: [] };
    }
  };
  const env = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n"
    }),
    GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
  };
  const out = await listRecentRecordings(db, { orgId: ORG, now, env });
  assert.equal(out.drive_ready, true);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].client_id, CLIENT);
  assert.equal(out.items[0].is_today, true);
  assert.equal(out.items[0].url, "https://drive.google.com/file/d/rec1");
  assert.equal(out.items[0].has_words, false);
  assert.equal(updates.length, 1);
});

test("listRecentRecordings retries an already-linked timestamped file against a late call row", async () => {
  const stamped = [];
  const db = {
    async query(sql, params) {
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/FROM brain_files/i.test(sql)) return { rows: [{
        id: "bf-linked", name: "Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Recording.mp4",
        web_view_link: "https://drive.google.com/file/d/linked", client_id: CLIENT,
        unattached: false, indexed_at: "2026-08-24T22:30:00Z", created_at: "2026-08-24T22:30:00Z",
        mime_type: "video/mp4", needs_transcription: true, first_name: "Jane", last_name: "Doe"
      }] };
      if (/UPDATE call_outcomes/i.test(sql)) { stamped.push(params); return { rows: [{ id: "late-call" }] }; }
      if (/SELECT o\.id/i.test(sql)) return { rows: [] };
      if (/FROM clients c/i.test(sql)) return { rows: [] };
      if (/UPDATE brain_files|UPDATE customer_insights/i.test(sql)) throw new Error("linked retry must not rewrite the file or another insight");
      return { rows: [] };
    }
  };
  const out = await listRecentRecordings(db, { orgId: ORG, now: new Date("2026-08-25T00:00:00Z"), env: {} });
  assert.equal(stamped.length, 1);
  assert.equal(stamped[0][3], "2026-08-24T22:00:00.000Z");
  assert.equal(out.items[0].client_name, "Jane Doe");
});

test("stampCallTranscript writes words only onto the call with that recording URL", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/recording_url = \$4/i.test(sql)) return { rows: [{ id: "co-1" }] };
      return { rows: [] };
    }
  };
  const out = await stampCallTranscript(db, {
    orgId: ORG,
    clientId: CLIENT,
    url: "https://drive.google.com/file/d/exact-call",
    transcript: "the start is part of ten percent"
  });
  assert.equal(out.stamped, 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0].sql, /recording_url = \$4/i);
});

test("stampCallTranscript does not fall back to the latest call when URL matching fails", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [] };
    }
  };
  const out = await stampCallTranscript(db, {
    orgId: ORG,
    clientId: CLIENT,
    url: "https://drive.google.com/file/d/not-on-a-call",
    transcript: "words from an older call"
  });
  assert.equal(out.stamped, 0);
  assert.equal(seen.length, 1);
  assert.match(seen[0].sql, /recording_url = \$4/i);
});
