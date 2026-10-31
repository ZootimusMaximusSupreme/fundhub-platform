// Survey resume links (owner-set 2026-10-31, funnel workflows fix).
//
// A lead who opts in on /apply and stops partway gets a text and an email whose
// link opens /apply on the question where they stopped:
//
//   https://apply.fundhub.ai/apply?r=<token>
//
// The page hands <token> to GET /api/public/survey-resume, which answers with
// the saved contact, the saved answers and the next question to ask.
//
// SAME SHAPE AS EVERY OTHER CONSUMER-FACING LINK IN THIS REPO: the person
// clicking is not signed in and never will be, so the HMAC and its expiry ARE
// the credential. See src/messaging/unsubscribe.mjs, the nearest sibling.
//
//   - NO NEW SECRET. It signs with the unsubscribe key (UNSUBSCRIBE_TOKEN_SECRET,
//     DOCUMENT_URL_SECRET as the fallback). Every message the company sends
//     already needs that key to carry its unsubscribe link, so a link that cannot
//     be signed here is a send path that is already red.
//   - SCHEME "survey-resume-v1" is the first thing the HMAC sees, so a link made
//     for one purpose can never verify as another even though the key is shared.
//   - THE TOKEN CARRIES NO EMAIL, PHONE OR NAME, and no company. Only the client's
//     id and the day it dies. The door looks the person up by that id and reads
//     the company off the client's own row; nothing readable about them rides in a
//     text message or an email.
//   - 30 DAYS, counted in whole UTC days: a link works through the end of the 30th
//     day after it was made, so it is never shorter than 30 days and never longer
//     than 31. A lead may open the text a week later. Past that the link is a 404
//     and the page starts a fresh survey.
//   - A BAD SIGNATURE, AN EXPIRED LINK AND A TAMPERED ID ARE ALL THE SAME null.
//     Telling them apart turns the door into an oracle for which ids exist.
//
// THE TOKEN IS SHORT BECAUSE IT GOES IN A TEXT MESSAGE. A long link pushes every
// come-back text into a third SMS segment. Three parts, no separators:
//
//   <client id: 22 chars> <expiry: base36 days, 2 chars until 2029> <tag: 22 chars>
//
//   client id  the 16 bytes of the client's uuid, base64url.
//   expiry     the last day the link works, as whole UTC days since 2026-01-01,
//              written in base36 ("99" is 30 November 2026).
//   tag        the first 16 bytes of the HMAC-SHA256 of the client's 16 bytes and the
//              expiry as written, base64url. 128 bits is far past guessable: nobody
//              can check a guess offline, because the key never leaves the server.
//
// A full link is 33 characters of address and 46 of token: 79.

import { createHmac, timingSafeEqual } from "node:crypto";
import { unsubscribeSecret } from "../messaging/unsubscribe.mjs";

export const RESUME_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const RESUME_BASE_URL = "https://apply.fundhub.ai/apply";
/* The merge tag that carries the link. It goes in EMAIL only, never in a text: the
   link opens the person's saved answers, and the public form can put any phone on an
   existing lead's email, so a text can reach someone else. The email address is the
   lead's identity (review 2026-10-31). sendTemplated drops it from every text. */
export const RESUME_LINK_TAG = "survey_resume_link";

const SCHEME = "survey-resume-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
// Expiry days count from here (2026-01-01 UTC), so the number stays two characters until mid-2029.
const EPOCH_DAY = Date.UTC(2026, 0, 1) / DAY_MS;
const CLIENT_BYTES = 16;
const CLIENT_CHARS = Math.ceil((CLIENT_BYTES * 8) / 6); // 22
const TAG_BYTES = 16;
const TAG_CHARS = Math.ceil((TAG_BYTES * 8) / 6); // 22
const MAX_EXPIRY_CHARS = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_ALPHABET = /^[A-Za-z0-9_-]+$/;
const BASE36 = /^[0-9a-z]+$/;

const uuidBytes = (id) => Buffer.from(String(id).replace(/-/g, ""), "hex");
const uuidText = (bytes) => {
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/* `now` is injectable the way every signed link here takes it: a function that
   returns milliseconds. A number or a Date works too, so a test can pin the clock
   in whichever shape is handy. */
function nowMs(now) {
  if (typeof now === "function") return Number(now());
  if (now instanceof Date) return now.getTime();
  if (now != null && Number.isFinite(Number(now))) return Number(now);
  return Date.now();
}

/* The tag covers the client's bytes and the expiry exactly as it is written in the
   token, so changing either changes the tag. The client part is a fixed 16 bytes,
   so the two cannot run into each other. */
const tagOf = (client, expiry, key) =>
  createHmac("sha256", key).update(`${SCHEME}|`).update(client).update(expiry).digest().subarray(0, TAG_BYTES);

/** The signing key. Fail closed: no key, no links. The unsubscribe key, on purpose. */
export function surveyResumeSecret(env = process.env) {
  try {
    return unsubscribeSecret(env);
  } catch {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET (or DOCUMENT_URL_SECRET) is missing or too short " +
      "(need >= 32 chars) — refusing to sign survey resume links");
  }
}

/**
 * surveyResumeToken — mint the opaque token for one client. Throws without a client
 * id (a uuid) or without a key.
 *
 * `orgId` is accepted so callers keep the shared call shape (`{ orgId, clientId }`),
 * and ignored: the company is read off the client's row when the link is opened.
 */
export function surveyResumeToken({ clientId, now, secret, env = process.env } = {}) {
  if (!UUID.test(String(clientId))) throw new Error("surveyResumeToken requires clientId (a uuid)");
  const key = secret ?? surveyResumeSecret(env);
  const expiryDay = Math.floor((nowMs(now) + RESUME_TTL_SECONDS * 1000) / DAY_MS) - EPOCH_DAY;
  const expiry = expiryDay.toString(36);
  if (!(expiryDay >= 0) || expiry.length > MAX_EXPIRY_CHARS) {
    throw new Error("surveyResumeToken: the clock is outside the years a link can carry");
  }
  const client = uuidBytes(clientId);
  return client.toString("base64url") + expiry + tagOf(client, expiry, key).toString("base64url");
}

/**
 * surveyResumeUrl — the link that goes in the text and the email.
 *
 * NEVER THROWS, because it is called from inside the welcome send, and a lead
 * must not lose their welcome over a key. With no key (or an id that is not a
 * uuid) it logs the reason and returns the plain /apply link: not as good as a
 * token, because the person starts at the first question, but a working door
 * where a blank link would be a sentence promising one followed by nothing.
 * Same trade src/auth/magic-link.mjs portalLoginUrl() makes.
 */
export function surveyResumeUrl({ orgId, clientId, now, secret, env = process.env, baseUrl = RESUME_BASE_URL } = {}) {
  try {
    return `${baseUrl}?r=${surveyResumeToken({ orgId, clientId, now, secret, env })}`;
  } catch (err) {
    console.warn(`[survey-resume] no token in the link (${String(err?.message || err)}) — sending the plain apply link`);
    return baseUrl;
  }
}

/**
 * readSurveyResumeToken — { clientId } for a good token, else null.
 * Never throws: a malformed link is an invalid link, not a 500. The signature is
 * checked BEFORE the expiry so the answer cannot be used to probe which half of
 * a forged link was wrong.
 */
export function readSurveyResumeToken(token, { now, secret, env = process.env } = {}) {
  if (typeof token !== "string" || !TOKEN_ALPHABET.test(token)) return null;
  if (token.length < CLIENT_CHARS + 1 + TAG_CHARS || token.length > CLIENT_CHARS + MAX_EXPIRY_CHARS + TAG_CHARS) return null;

  const clientPart = token.slice(0, CLIENT_CHARS);
  const expiry = token.slice(CLIENT_CHARS, token.length - TAG_CHARS);
  const tagPart = token.slice(token.length - TAG_CHARS);
  if (!BASE36.test(expiry)) return null;

  let key;
  try { key = secret ?? surveyResumeSecret(env); } catch { return null; }

  /* ONE SPELLING PER TOKEN. 22 characters hold 132 bits and 16 bytes use 128, so the
     last character of each part has four spare bits that decode to nothing. A string
     with those bits changed would verify as the same token, and a token that can be
     rewritten without breaking it is not tamper-proof in the plain sense of the word.
     Writing the decoded bytes back out and comparing closes that. */
  const client = Buffer.from(clientPart, "base64url");
  const given = Buffer.from(tagPart, "base64url");
  if (client.length !== CLIENT_BYTES || client.toString("base64url") !== clientPart) return null;
  if (given.length !== TAG_BYTES || given.toString("base64url") !== tagPart) return null;

  if (!timingSafeEqual(given, tagOf(client, expiry, key))) return null;

  const expiryDay = parseInt(expiry, 36);
  if (expiryDay.toString(36) !== expiry) return null; // we never write a leading zero
  if (Math.floor(nowMs(now) / DAY_MS) > expiryDay + EPOCH_DAY) return null;

  return { clientId: uuidText(client) };
}
