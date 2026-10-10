// Inbound webhooks from a CLIENT'S own Whop or Commas account.
//
//   POST /api/webhooks/merchant-whop/<connection id>
//   POST /api/webhooks/merchant-commas/<connection id>
//
// Reached through the same door as every other provider webhook
// (api/webhooks/[provider].mjs → src/http/router.mjs dispatchWebhook), so it is
// POST-only and gets the raw bytes the processor signed.
//
// EVERY REFUSAL LOOKS THE SAME. An unknown connection id, a turned-off
// connection, a connection with no secret yet and a bad signature all answer
// 401 bad_signature. A different answer for "no such id" would let anyone on
// the internet find out which connection ids exist.
//
// Nothing here calls out. It reads one row, checks one signature, writes rows.
import { findForWebhook, recordEvents } from "./store.mjs";
import { verifyWhopSignature, whopEventsFrom, verifyClientCommasSignature, commasEventsFrom } from "./normalize.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED = { status: 401, body: { ok: false, error: "bad_signature" } };

/* parseMerchantProvider("merchant-whop/<uuid>") → { provider, connectionId } | null */
export function parseMerchantProvider(provider) {
  const m = /^merchant-(whop|commas)\/([^/]+)$/i.exec(String(provider || ""));
  if (!m) return null;
  return { provider: m[1].toLowerCase(), connectionId: m[2] };
}

export async function handleMerchantWebhook({ db, provider, connectionId, rawBody, headers = {}, env = process.env, now = Date.now() }) {
  if (provider !== "whop" && provider !== "commas") return { status: 404, body: { ok: false, error: "unknown provider" } };
  if (!UUID_RE.test(String(connectionId || ""))) return REFUSED;

  let found;
  try {
    found = await findForWebhook(db, { connectionId, provider, env });
  } catch (err) {
    // A missing encryption key or a tampered ciphertext. Say nothing useful to
    // the caller; the processor will retry, which is what we want.
    if (err && (err.code === "NOT_CONFIGURED" || err.code === "SECRET_AUTH_FAILED")) {
      return { status: 503, body: { ok: false, error: "not_configured" } };
    }
    throw err;
  }
  if (!found) return REFUSED;

  const check = provider === "whop"
    ? verifyWhopSignature({ rawBody, headers, secret: found.secret, now })
    : verifyClientCommasSignature({ rawBody, headers, secret: found.secret });
  if (!check.ok) return REFUSED;

  let body;
  try { body = rawBody ? JSON.parse(rawBody) : {}; }
  catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }

  const out = provider === "whop" ? whopEventsFrom(body) : commasEventsFrom(body);
  if (!out.events.length) {
    // Verified, understood, and not a money fact we keep. 200 so the
    // processor does not retry it for ever.
    return { status: 200, body: { ok: true, ignored: out.ignored || "nothing to record" } };
  }
  const saved = await recordEvents(db, found.connection, out.events);
  return { status: 200, body: { ok: true, inserted: saved.inserted, duplicates: saved.duplicates } };
}
