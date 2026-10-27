// Where a booked customer's Google Meet link comes from.
//
// WHAT HAPPENS TODAY (measured 2026-10-20, read only):
//   * ClickFunnels is the booking page. Its host is Chris and its place is Google
//     Meet. When a customer books, ClickFunnels puts the call on the host's
//     Google Calendar, and Google adds a Meet link to that event and emails the
//     customer the invite. On the 11 "Funding Strategy Meeting" events on the
//     host calendar from 2026-09-03 to 2026-10-10, every one carries a Meet
//     link, the customer as a guest, and the same start time as the booking.
//   * ClickFunnels' own webhook carries no link at all (the appointment payload
//     has no place field; src/adapters/clickfunnels.mjs sets meetingUrl: null).
//     That is why no booking row ever held a link and the 15-minute text fell
//     back to the portal sign-in page.
//
// SO THE LINK IS READ FROM THE HOST CALENDAR: one GET for the events at the call's
// start, matched on the exact start time and the customer's email as a guest.
// The event's own Meet link is kept. Nothing is created, so the customer never
// gets a second, different link.
//
// WHICH GOOGLE LOGIN. The same desktop OAuth token the Gmail and Drive readers
// use (GOOGLE_DRIVE_OAUTH_TOKEN_*, GOOGLE_OAUTH_TOKEN_*, GOOGLE_GMAIL_OAUTH_TOKEN_*,
// in that order — src/company-brain/config.mjs). It belongs to the host's Google
// account and its grant includes calendar.readonly (scripts/google-oauth-mint.mjs
// was run with the calendar scopes on 2026-09-18). A token whose grant has no
// calendar scope is skipped with that reason; it is never treated as "no event".
//
// READ ONLY. Token refresh plus GET. No write to Google, no message, no event.
// Never throws: every miss comes back as { ok: false, reason }.

import { driveConfigFromEnv } from "../company-brain/config.mjs";
import { fetchOAuthAccessToken } from "../company-brain/auth.mjs";

export const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Any of these in a token's grant lets it read events. */
export const CALENDAR_READ_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events"
]);

/** A real Meet room address, and nothing else. */
export const MEET_LINK_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,}$/i;

const WINDOW_MS = 60 * 1000;

function clip(v, n = 160) {
  return String(v && v.message ? v.message : v).replace(/\s+/g, " ").trim().slice(0, n);
}

/** A normalized Google Meet room address, or null. */
export function meetLinkValue(value) {
  const link = typeof value === "string" ? value.trim() : "";
  return MEET_LINK_RE.test(link) ? link : null;
}

/** The Meet link on one calendar event, or null. */
export function meetLinkOf(event) {
  if (!event || typeof event !== "object") return null;
  const candidates = [event.hangoutLink];
  for (const p of event.conferenceData?.entryPoints || []) {
    if (p && p.entryPointType === "video") candidates.push(p.uri);
  }
  for (const c of candidates) {
    const link = meetLinkValue(c);
    if (link) return link;
  }
  return null;
}

/**
 * The host event for one booked call: not cancelled, starting at exactly the
 * booked moment, with the customer on the guest list. Null when none matches.
 */
export function pickHostEvent(items, { email, startMs }) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !Number.isFinite(startMs)) return null;
  for (const ev of Array.isArray(items) ? items : []) {
    if (!ev || ev.status === "cancelled") continue;
    const at = new Date(ev.start?.dateTime || "").getTime();
    if (at !== startMs) continue;
    const guests = (ev.attendees || []).map((a) => String(a?.email || "").trim().toLowerCase());
    if (!guests.includes(mail)) continue;
    const url = meetLinkOf(ev);
    if (url) return { event: ev, url };
  }
  return null;
}

function hasCalendarScope(scope) {
  if (scope == null) return true; // Google did not say; let the GET answer.
  const granted = String(scope).split(/\s+/);
  return CALENDAR_READ_SCOPES.some((s) => granted.includes(s));
}

/**
 * findMeetLink({ email, startTime, env, fetchImpl }) → { ok, url?, source?, reason? }
 */
export async function findMeetLink({ email, startTime, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !mail.includes("@")) return { ok: false, reason: "no_customer_email" };
  const startMs = new Date(startTime || "").getTime();
  if (!Number.isFinite(startMs)) return { ok: false, reason: "no_start_time" };
  if (typeof fetchImpl !== "function") return { ok: false, reason: "no_fetch" };

  let cfg;
  try {
    cfg = driveConfigFromEnv(env);
  } catch (err) {
    return { ok: false, reason: `google_config_unreadable:${clip(err)}` };
  }
  const candidates = Array.isArray(cfg?.oauthCandidates) ? cfg.oauthCandidates : [];
  if (candidates.length === 0) return { ok: false, reason: "no_google_oauth_token" };

  const misses = [];
  for (const cand of candidates) {
    const name = cand.tokenSource || "google_token";
    let token;
    try {
      token = await fetchOAuthAccessToken({ ...cand.credentials, fetchImpl });
    } catch (err) {
      misses.push(`${name}:token_refused:${clip(err, 80)}`);
      continue;
    }
    if (!hasCalendarScope(token.scope)) {
      misses.push(`${name}:no_calendar_scope`);
      continue;
    }
    const qs = new URLSearchParams({
      timeMin: new Date(startMs - WINDOW_MS).toISOString(),
      timeMax: new Date(startMs + WINDOW_MS).toISOString(),
      singleEvents: "true",
      maxResults: "25"
    });
    let body;
    try {
      const res = await fetchImpl(`${CALENDAR_EVENTS_URL}?${qs}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token.accessToken}` }
      });
      if (!res || !res.ok) {
        misses.push(`${name}:calendar_http_${res ? res.status : "none"}`);
        continue;
      }
      body = await res.json();
    } catch (err) {
      misses.push(`${name}:calendar_read_failed:${clip(err, 80)}`);
      continue;
    }
    const hit = pickHostEvent(body?.items, { email: mail, startMs });
    if (hit) return { ok: true, url: hit.url, source: name };
    misses.push(`${name}:no_matching_event`);
  }
  return { ok: false, reason: misses.join("; ") || "no_google_oauth_token" };
}
