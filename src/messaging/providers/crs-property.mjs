import { ADAPTERS, transmit } from "../../lib/outbound-fetch.mjs";
import { CRS_PRODUCTION_HOST, CRS_SANDBOX_HOST } from "../../finance/crs-identities.mjs";
import { propertyRequestFingerprint } from "../../finance/crs-property-contract.mjs";

export const TRANSMITS = true;
const on = v => /^(1|true|yes|on)$/i.test(String(v || "").trim());
const held = () => ({ ok: false, blocked: true, transmitted: false, status: 0,
  body: null, headers: {}, error: "property_request_refused", fence: ADAPTERS });

// Only one documented endpoint; no arbitrary URL, method, query, or retry.
export function requestCrsProperty({ host, body, token, env = process.env, fetchImpl } = {}) {
  const fixture = String(env.CRS_PROPERTY_SANDBOX_IDENTITY_SHA256 || "").trim();
  let fingerprint;
  try { fingerprint = propertyRequestFingerprint(body); } catch { return Promise.resolve(held()); }
  if (!/^[a-f0-9]{64}$/.test(fixture) || typeof token !== "string" || !token
      || (host !== CRS_SANDBOX_HOST && host !== CRS_PRODUCTION_HOST)
      || (host === CRS_SANDBOX_HOST && fingerprint !== fixture)
      || (host === CRS_PRODUCTION_HOST && (fingerprint === fixture || !on(env.CRS_PROPERTY_ALLOW_LIVE)))) {
    return Promise.resolve(held());
  }
  return transmit(`https://${host}/api/pp/foreclosure/data`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { fence: ADAPTERS, what: "CRS property report", env, fetchImpl, timeoutMs: 45_000 });
}
