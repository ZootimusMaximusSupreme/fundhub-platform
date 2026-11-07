import { adaptersBlocked } from "../lib/dry-run.mjs";
import { createCrsClient } from "./crs-client.mjs";
import { CRS_PRODUCTION_HOST, CRS_SANDBOX_HOST, normalizeHost } from "./crs-identities.mjs";
import { buildPropertyRequest, parsePropertyResponse, propertyRequestFingerprint, propertyRequestId, PropertyReportError } from "./crs-property-contract.mjs";
import { requestCrsProperty } from "../messaging/providers/crs-property.mjs";

export function propertyConfigFromEnv(env = process.env) {
  const host = normalizeHost(env.CRS_PROPERTY_API_HOST);
  const environment = host === CRS_PRODUCTION_HOST ? "production" : host === CRS_SANDBOX_HOST ? "sandbox" : null;
  const missing = [];
  for (const name of ["CRS_PROPERTY_API_USERNAME", "CRS_PROPERTY_API_PASSWORD"]) if (!String(env[name] || "").trim()) missing.push(name);
  if (!environment) missing.push("CRS_PROPERTY_API_HOST");
  if (!/^[a-f0-9]{64}$/.test(String(env.CRS_PROPERTY_SANDBOX_IDENTITY_SHA256 || ""))) missing.push("CRS_PROPERTY_SANDBOX_IDENTITY_SHA256");
  if (environment === "production" && !/^(1|true|yes|on)$/i.test(String(env.CRS_PROPERTY_ALLOW_LIVE || ""))) missing.push("CRS_PROPERTY_ALLOW_LIVE");
  if (adaptersBlocked(env)) missing.push("ADAPTERS_DRY_RUN");
  return { configured: missing.length === 0, missing, host, environment };
}

export function createCrsPropertyClient({ env = process.env, fetchImpl } = {}) {
  const config = propertyConfigFromEnv(env);
  // Reuse CRS login/refresh; no working credit or OffersIQ credential changes.
  const auth = createCrsClient({ env: { ...env, CRS_API_HOST: config.host,
    CRS_API_USERNAME: env.CRS_PROPERTY_API_USERNAME, CRS_API_PASSWORD: env.CRS_PROPERTY_API_PASSWORD,
    CRS_ALLOW_LIVE: env.CRS_PROPERTY_ALLOW_LIVE }, fetchImpl });
  return { config, async order({ identity } = {}) {
    if (!config.configured) throw new PropertyReportError("property_not_configured", 503);
    const body = buildPropertyRequest(identity);
    const fingerprint = propertyRequestFingerprint(body);
    const fixture = env.CRS_PROPERTY_SANDBOX_IDENTITY_SHA256;
    if ((config.environment === "sandbox") !== (fingerprint === fixture)) throw new PropertyReportError("property_identity_refused", 422);
    let token;
    try { token = await auth.getToken(); } catch { throw new PropertyReportError("property_auth_failed", 502); }
    const response = await requestCrsProperty({ host: config.host, body, token, env, fetchImpl });
    const requestId = propertyRequestId(response.headers?.requestid || response.headers?.["request-id"]);
    if (!response.ok) return { ok: false, uncertain: response.transmitted === true,
      code: response.blocked ? "property_transmission_blocked" : "property_provider_uncertain", requestId };
    try { return { ok: true, report: parsePropertyResponse({ body: response.body, requestId, identity }), requestId }; }
    catch (error) { return { ok: false, uncertain: true,
      code: error instanceof PropertyReportError ? error.code : "invalid_provider_response", requestId }; }
  } };
}
