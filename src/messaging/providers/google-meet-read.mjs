// Read-only Google Meet presence. Calendar times and clicks are never presence.
import { readFileSync } from "node:fs";
import { fetchOAuthAccessToken } from "../../company-brain/auth.mjs";
import { meetLinkValue } from "../../bookings/meet-link.mjs";

const SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
const API = "https://meet.googleapis.com/v2/";

function connection(env) {
  try {
    const value = env.GOOGLE_MEET_OAUTH_TOKEN_JSON ||
      (env.GOOGLE_MEET_OAUTH_TOKEN_PATH ? readFileSync(env.GOOGLE_MEET_OAUTH_TOKEN_PATH, "utf8") : "");
    if (!value) return { ready: false, reason: "not_connected" };
    const data = typeof value === "string" ? JSON.parse(value) : value;
    if (!data?.client_id || !data.client_secret || !data.refresh_token) return { ready: false, reason: "invalid_connection" };
    if (data.scope && !String(data.scope).split(/\s+/).includes(SCOPE)) return { ready: false, reason: "insufficient_scope" };
    return { ready: true, credentials: { clientId: data.client_id, clientSecret: data.client_secret, refreshToken: data.refresh_token } };
  } catch { return { ready: false, reason: "invalid_connection" }; }
}

export function meetConnectionStatus(env = process.env) {
  const { ready, reason } = connection(env);
  return { ready, reason: reason || null };
}

function unavailable(reason, checkedAt) {
  return { status: "unavailable", checkedAt, reason,
    presence: { conferenceActive: null, participantCount: null, participants: [], verifiedLeadJoined: null } };
}

class MeetReadError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

// Every request goes to a fixed Google endpoint. Resource names and pagination
// are checked; neither caller-supplied URLs nor Google response URLs are followed.
export async function readGoogleMeetPresence({ meetingUrl, callStartsAt, env = process.env, fetchImpl = globalThis.fetch,
  now = new Date(), signal = AbortSignal.timeout(10_000) } = {}) {
  const checkedAt = new Date(now).toISOString();
  const link = meetLinkValue(meetingUrl);
  if (!link) return unavailable("no_meet_link", checkedAt);
  const cfg = connection(env);
  if (!cfg.ready) return unavailable(cfg.reason, checkedAt);
  const callTime = callStartsAt == null ? null : new Date(callStartsAt).getTime();
  if (callTime != null && !Number.isFinite(callTime)) return unavailable("invalid_call_time", checkedAt);
  const fetchBound = (url, options = {}) => fetchImpl(url, { ...options, signal });
  let token;
  try { token = await fetchOAuthAccessToken({ ...cfg.credentials, fetchImpl: fetchBound }); }
  catch { return unavailable("connection_refused", checkedAt); }
  if (token.scope && !token.scope.split(/\s+/).includes(SCOPE)) return unavailable("insufficient_scope", checkedAt);

  async function list(resource, query, field) {
    const all = [];
    let pageToken = "";
    const seen = new Set();
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({ ...query, pageSize: "100", ...(pageToken ? { pageToken } : {}) });
      const response = await fetchBound(API + resource + "?" + params, {
        method: "GET", headers: { authorization: `Bearer ${token.accessToken}` }
      });
      const body = await response.json();
      if (!response.ok) {
        const reasons = (body.error?.details || []).map(item => item.reason);
        throw new MeetReadError(reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ? "insufficient_scope"
          : reasons.includes("SERVICE_DISABLED") ? "meet_api_disabled" : "provider_unavailable");
      }
      if (body[field] != null && !Array.isArray(body[field])) throw new MeetReadError("invalid_provider_response");
      all.push(...(body[field] || []));
      if (all.length > 100) throw new MeetReadError("provider_limit");
      pageToken = body.nextPageToken || "";
      if (!pageToken) return all;
      if (typeof pageToken !== "string" || seen.has(pageToken)) throw new MeetReadError("invalid_provider_response");
      seen.add(pageToken);
    }
    throw new MeetReadError("provider_limit");
  }

  try {
    const code = new URL(link).pathname.slice(1);
    // A reused host room must not reveal a different day's conference. The
    // booking bounds scope the provider read; only a real session proves presence.
    const windowFilter = callTime == null ? "" : ` AND start_time >= "${new Date(callTime - 30 * 60_000).toISOString()}" AND start_time <= "${new Date(callTime + 4 * 3_600_000).toISOString()}"`;
    const conferences = await list("conferenceRecords", { filter: `space.meeting_code = "${code}" AND end_time IS NULL${windowFilter}` }, "conferenceRecords");
    const active = conferences.filter(item => !item.endTime);
    const participants = [];
    let scopedConferences = 0;
    for (const conference of active) {
      if (callTime != null) {
        const started = new Date(conference.startTime).getTime();
        if (!Number.isFinite(started)) throw new MeetReadError("invalid_provider_response");
        if (started < callTime - 30 * 60_000 || started > callTime + 4 * 3_600_000) {
          throw new MeetReadError("conference_outside_call_window");
        }
      }
      scopedConferences++;
      if (!/^conferenceRecords\/[A-Za-z0-9_-]+$/.test(conference.name || "")) throw new MeetReadError("invalid_provider_response");
      const people = await list(conference.name + "/participants", { filter: "latest_end_time IS NULL" }, "participants");
      for (const person of people) {
        const prefix = conference.name + "/participants/";
        if (!String(person.name || "").startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(person.name.slice(prefix.length))) {
          throw new MeetReadError("invalid_provider_response");
        }
        const sessions = await list(person.name + "/participantSessions", { filter: "end_time IS NULL" }, "participantSessions");
        if (sessions.some(session => !Number.isFinite(Date.parse(session.startTime)))) {
          throw new MeetReadError("invalid_provider_response");
        }
        if (!sessions.some(session => !session.endTime)) continue;
        const user = person.signedinUser || person.anonymousUser || person.phoneUser || {};
        const name = String(user.displayName || "Participant").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
        participants.push({ displayName: name || "Participant", identity: "unidentified" });
      }
    }
    return { status: participants.length ? "available" : "empty", checkedAt,
      reason: scopedConferences ? (participants.length ? null : "no_active_participants") : "no_active_conference",
      presence: { conferenceActive: scopedConferences > 0, participantCount: participants.length,
        participants, verifiedLeadJoined: null } };
  } catch (error) { return unavailable(error instanceof MeetReadError ? error.reason : "provider_unavailable", checkedAt); }
}
