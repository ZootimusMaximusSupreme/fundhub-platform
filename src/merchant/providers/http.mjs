// The one GET every merchant pull provider makes, fenced.
//
// Every processor read in src/merchant/providers/ goes through getJson(), and
// getJson() goes through transmit() in src/lib/outbound-fetch.mjs with the
// ADAPTERS fence — same as src/banking/providers/plaid-http.mjs. A processor
// account holding a client's sales is an outside vendor with standing read
// access, exactly the class ADAPTERS_DRY_RUN holds. While that flag is not set
// to an off value, every pull is held and says so; nothing is sent.
//
// READ ONLY. GET, never POST. Nothing here can refund, charge or pay out.
//
// NEVER LOGS OR RETURNS THE KEY. The caller's headers carry it in and nothing
// carries it out: errors are built from a code and an HTTP status only, never
// from the vendor's response text, which could echo a request back.
import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";

export class MerchantPullError extends Error {
  /** code: blocked | auth_failed | rate_limited | http_error | bad_response | bad_key */
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function getJson(url, { headers = {}, env = process.env, fetchImpl = undefined, what = "merchant pull", timeoutMs = 15_000 } = {}) {
  const res = await transmit(url, {
    method: "GET",
    headers: { accept: "application/json", ...headers }
  }, {
    fence: ADAPTERS,
    what,
    env,
    fetchImpl,
    timeoutMs
  });

  if (res.blocked) {
    throw new MerchantPullError("blocked",
      "Processor reads are switched off on this server right now (ADAPTERS_DRY_RUN). Nothing was sent.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new MerchantPullError("auth_failed",
      "The processor did not accept this API key. Check the key and its read permissions, then paste it again.", res.status);
  }
  if (res.status === 429) {
    throw new MerchantPullError("rate_limited", "The processor asked us to slow down. The next sync will pick up from here.", 429);
  }
  if (!res.ok || res.status < 200 || res.status >= 300) {
    throw new MerchantPullError("http_error",
      res.status ? `The processor answered with an error (${res.status}). The next sync will try again.`
        : "The processor did not answer in time. The next sync will try again.", res.status || 0);
  }
  if (!res.body || typeof res.body !== "object") {
    throw new MerchantPullError("bad_response", "The processor answered with something we could not read.", res.status);
  }
  return res.body;
}
