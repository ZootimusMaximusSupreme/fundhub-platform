import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMeetLink, pickHostEvent, meetLinkOf, CALENDAR_EVENTS_URL } from "./meet-link.mjs";
import { fillMeetingUrl } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "meet-link.mjs"), "utf8");

const MEET = "https://meet.google.com/kcz-tqvb-xyz";
const START = "2026-10-10T21:00:00.000Z";
const TOKEN = JSON.stringify({ refresh_token: "r", client_id: "c", client_secret: "s" });

/* The shape Google Calendar returned for the real booking on 2026-10-10:
   start in the host's time zone, the customer and the host as guests. */
function hostEvent(o = {}) {
  return {
    status: "confirmed",
    summary: "Funding Strategy Meeting — Lead",
    start: { dateTime: "2026-10-10T14:00:00-07:00" },
    attendees: [{ email: "Lead@Acme.com" }, { email: "host@gmail.com" }],
    hangoutLink: MEET,
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: MEET }] },
    ...o
  };
}

/* A fake Google: the token door answers with a grant, the calendar door with
   events. Every request is recorded so a test can see what was asked. */
function fakeGoogle({ scope = "https://www.googleapis.com/auth/calendar.readonly", items = [hostEvent()], tokenStatus = 200, calStatus = 200 } = {}) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    asked.push({ url: String(url), method: init.method || "GET", auth: init.headers?.authorization || null });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return {
        ok: tokenStatus === 200, status: tokenStatus,
        text: async () => JSON.stringify(tokenStatus === 200 ? { access_token: "at", expires_in: 3600, scope } : { error: "invalid_client" })
      };
    }
    return { ok: calStatus === 200, status: calStatus, json: async () => ({ items }) };
  };
  return { fetchImpl, asked };
}

test("meetLinkOf: a real Meet room only; junk and other hosts are not a join link", () => {
  assert.equal(meetLinkOf(hostEvent()), MEET);
  assert.equal(meetLinkOf(hostEvent({ hangoutLink: undefined })), MEET, "the video entry point counts too");
  assert.equal(meetLinkOf(hostEvent({ hangoutLink: "https://evil.example/meet.google.com/abc", conferenceData: null })), null);
  assert.equal(meetLinkOf(hostEvent({ hangoutLink: "", conferenceData: null })), null);
  assert.equal(meetLinkOf(null), null);
});

test("pickHostEvent: same moment and the customer is a guest, or nothing", () => {
  const startMs = new Date(START).getTime();
  assert.equal(pickHostEvent([hostEvent()], { email: "lead@acme.com", startMs })?.url, MEET);
  assert.equal(pickHostEvent([hostEvent()], { email: "other@acme.com", startMs }), null, "another person's call");
  assert.equal(pickHostEvent([hostEvent()], { email: "lead@acme.com", startMs: startMs + 30 * 60e3 }), null, "another time");
  assert.equal(pickHostEvent([hostEvent({ status: "cancelled" })], { email: "lead@acme.com", startMs }), null, "a cancelled event");
  assert.equal(pickHostEvent([hostEvent({ hangoutLink: null, conferenceData: null })], { email: "lead@acme.com", startMs }), null, "an event with no Meet");
});

test("findMeetLink: reads the host calendar with one GET around the start and returns the event's Meet link", async () => {
  const g = fakeGoogle();
  const r = await findMeetLink({ email: "lead@acme.com", startTime: START, env: { GOOGLE_GMAIL_OAUTH_TOKEN_JSON: TOKEN }, fetchImpl: g.fetchImpl });
  assert.deepEqual(r, { ok: true, url: MEET, source: "GOOGLE_GMAIL_OAUTH_TOKEN_JSON" });
  const cal = g.asked.filter((a) => a.url.startsWith(CALENDAR_EVENTS_URL));
  assert.equal(cal.length, 1);
  assert.equal(cal[0].method, "GET");
  assert.equal(cal[0].auth, "Bearer at");
  const qs = new URL(cal[0].url).searchParams;
  assert.equal(qs.get("timeMin"), "2026-10-10T20:59:00.000Z");
  assert.equal(qs.get("timeMax"), "2026-10-10T21:01:00.000Z");
  assert.equal(qs.get("singleEvents"), "true");
});

test("findMeetLink: no matching event, no calendar scope, a refused token, or no token are misses with the reason", async () => {
  const env = { GOOGLE_GMAIL_OAUTH_TOKEN_JSON: TOKEN };
  const none = await findMeetLink({ email: "lead@acme.com", startTime: START, env, fetchImpl: fakeGoogle({ items: [] }).fetchImpl });
  assert.equal(none.ok, false);
  assert.match(none.reason, /no_matching_event/);

  const scopeless = fakeGoogle({ scope: "https://www.googleapis.com/auth/drive.readonly" });
  const s = await findMeetLink({ email: "lead@acme.com", startTime: START, env, fetchImpl: scopeless.fetchImpl });
  assert.match(s.reason, /no_calendar_scope/);
  assert.equal(scopeless.asked.some((a) => a.url.startsWith(CALENDAR_EVENTS_URL)), false, "a token without the scope never reads the calendar");

  const refused = await findMeetLink({ email: "lead@acme.com", startTime: START, env, fetchImpl: fakeGoogle({ tokenStatus: 401 }).fetchImpl });
  assert.match(refused.reason, /token_refused/);

  const http = await findMeetLink({ email: "lead@acme.com", startTime: START, env, fetchImpl: fakeGoogle({ calStatus: 403 }).fetchImpl });
  assert.match(http.reason, /calendar_http_403/);

  assert.equal((await findMeetLink({ email: "lead@acme.com", startTime: START, env: {}, fetchImpl: fakeGoogle().fetchImpl })).reason, "no_google_oauth_token");
  assert.equal((await findMeetLink({ email: "", startTime: START, env })).reason, "no_customer_email");
  assert.equal((await findMeetLink({ email: "lead@acme.com", startTime: "soon", env })).reason, "no_start_time");
});

test("findMeetLink: a refused first token falls through to the next one", async () => {
  let n = 0;
  const g = fakeGoogle();
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token") && ++n === 1) {
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: "invalid_client" }) };
    }
    return g.fetchImpl(url, init);
  };
  const r = await findMeetLink({
    email: "lead@acme.com", startTime: START, fetchImpl,
    env: { GOOGLE_DRIVE_OAUTH_TOKEN_JSON: TOKEN, GOOGLE_GMAIL_OAUTH_TOKEN_JSON: TOKEN }
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, "GOOGLE_GMAIL_OAUTH_TOKEN_JSON");
});

test("source reads only: GET, no calendar write, no message, no event", () => {
  assert.doesNotMatch(SRC, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(SRC, /conferenceDataVersion|events\/insert|\/events\/[^?"]+\?/);
  assert.doesNotMatch(SRC, /sendTemplated|emit\(|from ["'][^"']*messaging/);
});

/* fillMeetingUrl — the one write, in src/bookings/store.mjs. */
function recordingDb(bookingRows = [{ provider_uid: "74249" }]) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE bookings/.test(sql)) return { rows: bookingRows };
      if (/UPDATE tasks/.test(sql)) return { rows: [{ id: "t1" }] };
      return { rows: [] };
    }
  };
}

test("fillMeetingUrl: fills a blank on the booking (by id, or by client and start) and on its call task", async () => {
  const db = recordingDb();
  const out = await fillMeetingUrl(db, { orgId: "org-1", clientId: "cl-1", providerUid: " form-1 ", startsAt: START, url: MEET });
  assert.deepEqual(out, { bookings: 1, tasks: 1 });
  const b = db.calls[0];
  assert.match(b.sql, /btrim\(COALESCE\(meeting_url, ''\)\) = ''/, "never overwrites a saved link");
  assert.match(b.sql, /org_id = \$1/);
  assert.deepEqual(b.params, ["org-1", "form-1", "cl-1", START, MEET]);
  const t = db.calls[1];
  assert.match(t.sql, /org_id = \$4 AND client_id = \$1 AND body = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(t.params[1], ["form-1", "74249"]);
});

test("fillMeetingUrl: nothing to match on means no write; no org or no link is refused", async () => {
  const db = recordingDb();
  assert.deepEqual(await fillMeetingUrl(db, { orgId: "org-1", url: MEET }), { bookings: 0, tasks: 0 });
  assert.equal(db.calls.length, 0);
  await assert.rejects(fillMeetingUrl(db, { clientId: "cl-1", startsAt: START, url: MEET }), /orgId is required/);
  await assert.rejects(fillMeetingUrl(db, { orgId: "org-1", clientId: "cl-1", startsAt: START, url: " " }), /url is required/);
});
