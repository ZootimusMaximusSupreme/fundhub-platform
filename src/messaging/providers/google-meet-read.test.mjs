import assert from "node:assert/strict";
import { test } from "node:test";
import { readGoogleMeetPresence, meetConnectionStatus } from "./google-meet-read.mjs";

const SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
const env = { GOOGLE_MEET_OAUTH_TOKEN_JSON: JSON.stringify({ client_id: "fixture", client_secret: "fixture",
  refresh_token: "fixture", scope: SCOPE }) };
const args = { meetingUrl: "https://meet.google.com/abc-defg-hij", env, now: new Date("2026-11-02T18:00:00Z") };
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("Meet uses its separate connection only; calendar, Drive and Gmail are never a fallback", async () => {
  let calls = 0;
  const out = await readGoogleMeetPresence({ ...args, env: { GOOGLE_GMAIL_OAUTH_TOKEN_JSON: env.GOOGLE_MEET_OAUTH_TOKEN_JSON },
    fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal(out.status, "unavailable"); assert.equal(out.reason, "not_connected"); assert.equal(calls, 0);
  assert.equal(out.presence.participantCount, null); assert.equal(out.presence.verifiedLeadJoined, null);
  assert.equal(meetConnectionStatus({ GOOGLE_MEET_OAUTH_TOKEN_JSON: "invalid" }).ready, false);
});

test("unapproved URLs and wrong declared scopes fail before any token request", async () => {
  for (const input of [{ meetingUrl: "https://evil.example/abc" },
    { meetingUrl: args.meetingUrl + "?room=other" },
    { env: { GOOGLE_MEET_OAUTH_TOKEN_JSON: JSON.stringify({ client_id: "x", client_secret: "x", refresh_token: "x", scope: "calendar" }) } }]) {
    let called = false;
    const out = await readGoogleMeetPresence({ ...args, ...input, fetchImpl: async () => { called = true; } });
    assert.equal(out.status, "unavailable"); assert.equal(called, false);
  }
});

test("real active sessions are required; identity remains unknown and Google resource IDs stay private", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "secret-access", scope: SCOPE });
    const u = new URL(url);
    if (u.pathname === "/v2/conferenceRecords") {
      assert.match(u.searchParams.get("filter"), /space.meeting_code = "abc-defg-hij" AND end_time IS NULL/);
      return json({ conferenceRecords: [{ name: "conferenceRecords/conf1" }] });
    }
    if (u.pathname.endsWith("/participants")) {
      if (!u.searchParams.get("pageToken")) return json({ participants: [
        { name: "conferenceRecords/conf1/participants/p1", signedinUser: { user: "users/private-id", displayName: "Guest <one>" } }
      ], nextPageToken: "second" });
      return json({ participants: [{ name: "conferenceRecords/conf1/participants/p2", anonymousUser: { displayName: "Left guest" } }] });
    }
    assert.equal(u.searchParams.get("filter"), "end_time IS NULL");
    return json({ participantSessions: u.pathname.includes("/p1/")
      ? [{ startTime: "2026-11-02T17:59:00Z" }]
      : [{ startTime: "2026-11-02T17:55:00Z", endTime: "2026-11-02T17:58:00Z" }] });
  };
  const out = await readGoogleMeetPresence({ ...args, fetchImpl });
  assert.equal(out.status, "available"); assert.equal(out.presence.participantCount, 1);
  assert.deepEqual(out.presence.participants, [{ displayName: "Guest <one>", identity: "unidentified" }]);
  assert.equal(out.presence.verifiedLeadJoined, null);
  assert.doesNotMatch(JSON.stringify(out), /private-id|conf1|secret-access|client_secret/);
  assert.ok(calls.slice(1).every(c => c.options.method === "GET"));
});

test("Google scope/service denial and transport errors remain unavailable, never empty or present", async () => {
  for (const [reason, expected] of [["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficient_scope"], ["SERVICE_DISABLED", "meet_api_disabled"]]) {
    const out = await readGoogleMeetPresence({ ...args, fetchImpl: async url => url.includes("oauth2.googleapis.com")
      ? json({ access_token: "secret" })
      : new Response(JSON.stringify({ error: { message: "private details", details: [{ reason }] } }), { status: 403 }) });
    assert.equal(out.reason, expected); assert.equal(out.status, "unavailable");
    assert.equal(out.presence.conferenceActive, null); assert.doesNotMatch(JSON.stringify(out), /private details/);
  }
  const out = await readGoogleMeetPresence({ ...args, fetchImpl: async () => { throw new Error("secret error"); } });
  assert.equal(out.reason, "connection_refused");
});

test("ended conferences and a successful empty Google response do not fabricate presence", async () => {
  for (const conferences of [[], [{ name: "conferenceRecords/old", endTime: "2026-11-01T18:00:00Z" }]]) {
    let calls = 0;
    const out = await readGoogleMeetPresence({ ...args, fetchImpl: async url => {
      calls++;
      return url.includes("oauth2.googleapis.com") ? json({ access_token: "secret" }) : json({ conferenceRecords: conferences });
    } });
    assert.equal(calls, 2); assert.equal(out.status, "empty"); assert.equal(out.presence.participantCount, 0);
    assert.equal(out.presence.conferenceActive, false);
  }
});

test("malformed cross-conference resource names and repeated pagination stop closed", async () => {
  for (const body of [{ conferenceRecords: [{ name: "https://evil.example" }] }, { conferenceRecords: [], nextPageToken: "loop" }]) {
    const out = await readGoogleMeetPresence({ ...args, fetchImpl: async url => url.includes("oauth2.googleapis.com")
      ? json({ access_token: "secret" }) : json(body) });
    assert.equal(out.status, "unavailable"); assert.equal(out.reason, "invalid_provider_response");
  }
});


test("a reused room cannot expose another booking window and malformed session times are not presence", async () => {
  let participantReads = 0;
  const out = await readGoogleMeetPresence({ ...args, callStartsAt: "2026-11-02T18:00:00Z", fetchImpl: async url => {
    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "secret" });
    if (url.includes("/participants")) { participantReads++; throw new Error("must not read other call"); }
    assert.match(new URL(url).searchParams.get("filter"), /start_time >= "2026-11-02T17:30:00.000Z"/);
    return json({ conferenceRecords: [{ name: "conferenceRecords/old", startTime: "2026-11-01T18:00:00Z" }] });
  } });
  assert.equal(participantReads, 0); assert.equal(out.status, "unavailable");
  assert.equal(out.reason, "conference_outside_call_window"); assert.equal(out.presence.conferenceActive, null);
  const bad = await readGoogleMeetPresence({ ...args, fetchImpl: async url => {
    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "secret" });
    if (url.endsWith("x")) throw new Error("unreachable");
    if (new URL(url).pathname.endsWith("/participantSessions")) return json({ participantSessions: [{ startTime: "not-a-date" }] });
    if (new URL(url).pathname.endsWith("/participants")) return json({ participants: [{ name: "conferenceRecords/c/participants/p" }] });
    return json({ conferenceRecords: [{ name: "conferenceRecords/c" }] });
  } });
  assert.equal(bad.status, "unavailable"); assert.equal(bad.reason, "invalid_provider_response");
});

test("Meet connection heartbeat distinguishes missing setup from actual joined proof", async () => {
  const { gapChecks } = await import("../../pulse/coverage/gap-meet-presence.mjs");
  assert.equal((await gapChecks({ env: {} }))[0].status, "FAIL");
  const configured = (await gapChecks({ env }))[0];
  assert.equal(configured.status, "PASS"); assert.match(configured.detail, /not joined-participant proof/);
});
