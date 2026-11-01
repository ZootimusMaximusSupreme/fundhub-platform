// POST /api/auth/magic-link  { email }
// → 200 { ok: true, message }        ALWAYS, for any well-formed address
// → 400 { ok: false, error }         the field was empty or not an address
// → 429 { ok: false, error }         too many requests, + Retry-After
//
// Thin mount over src/auth/magic-link.mjs. Every decision — the rate limit, who
// gets a link, what is written down — lives there. This file speaks HTTP.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE 200 IS THE SECURITY PROPERTY, AND IT IS WHY THIS FILE IS SO SHORT.
//
// requestMagicLink() hands back an `outcome` saying whether the address matched
// an account, matched a client, or matched nothing. NONE of that reaches the
// response. Not in a field, not in a different status code, not in a reworded
// message. A caller who can tell "we sent it" from "there is nobody here" has a
// form that answers the question "is this person a Fundhub client?" for any
// address they care to type — which for a consumer-finance product is a list
// worth money to the wrong buyer.
//
// It is the same discipline loginAccount() already keeps by returning one error
// for an unknown email and a wrong password, and the reason this handler must
// not "helpfully" forward what the service layer knows.
//
// THE 429 IS UNIFORM TOO. The limiter counts request ROWS, and a request writes
// a row whether or not the address matched anything (117_account_magic_links).
// So a stranger's address throttles on exactly the same schedule a customer's
// does, and the throttle cannot be used to sort one from the other.
// ─────────────────────────────────────────────────────────────────────────────

import { db, dbTarget } from "../../src/db.mjs";
import { requestMagicLink } from "../../src/auth/magic-link.mjs";
import { safeError } from "../../src/http/health.mjs";

/* THE ONE SENTENCE EVERY CALLER GETS. Written to be true regardless of which
   outcome actually happened: it describes what the system does with an address
   that has a portal, and says nothing about whether this one does. */
const UNIFORM_MESSAGE =
  "If that email address has a Fundhub portal, a sign-in link is on its way. " +
  "The link expires in 15 minutes.";

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const { email } = req.body || {};
  const ip = clientIp(req);
  const userAgent = req.headers?.["user-agent"] || null;

  let out;
  try {
    out = await requestMagicLink(db, {
      email, ip, userAgent,
      bookingClaim: req.body?.booking_claim === true
    });
  } catch (err) {
    /* Same pattern as api/auth/login.mjs and for the same reason: the adapter
       catches, scrubs and answers a generic internal_error, which leaves the
       real cause visible nowhere at all. This puts it in the function log and
       re-throws unchanged, so what the caller sees is decided in exactly one
       place and is not changed by this block. */
    console.error(
      `auth/magic-link: request failed — ${safeError(err)}` +
      (err && err.code ? ` (code ${err.code})` : "") +
      ` — connected to ${dbTarget()}`
    );
    throw err;
  }

  if (!out.ok) {
    // The only refusal, and it reveals nothing: the address was malformed,
    // which the person who typed it can see for themselves.
    return res.status(out.status || 400).json({ ok: false, error: out.error });
  }

  if (out.limited) {
    res.setHeader("Retry-After", String((out.retryAfterMinutes || 15) * 60));
    return res.status(429).json({
      ok: false,
      error: "too_many_requests",
      message: "Too many sign-in link requests. Try again in a few minutes."
    });
  }

  // `out` also carries outcome, sent, token, linkId and expiresAt. NOT ONE OF
  // THEM IS READ HERE. See the header — the uniform reply is the whole point,
  // and the token in particular is the credential itself, which belongs in the
  // email and nowhere else.
  return res.status(200).json({ ok: true, message: UNIFORM_MESSAGE });
}
