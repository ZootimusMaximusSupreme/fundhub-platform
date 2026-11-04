// CRS transport. This is the only CRS module allowed to touch the outbound
// chokepoint. URL construction and authentication stay in the finance client;
// this module owns the final host check and the ADAPTERS fence.
//
// Sandbox is always allowed. Production needs CRS_ALLOW_LIVE explicitly on
// AND the production hostname — either one alone fails closed.

import {
  ADAPTERS,
  redact,
  transmit
} from "../../lib/outbound-fetch.mjs";
import {
  CRS_PRODUCTION_HOST,
  CRS_SANDBOX_HOST,
  assertIdentityAllowed,
  livePullAllowed
} from "../../finance/crs-identities.mjs";
import {
  assertOffersIqWireBody,
  isOffersIqProductionFixtureIdentity
} from "../../finance/offersiq-contract.mjs";

export const TRANSMITS = true;

const AUTH_PATHS = new Set([
  "/api/users/login",
  "/api/users/refresh-token"
]);

const REPORT_PATHS = Object.freeze({
  TU: "/api/transunion/credit-report/standard/tu-prequal-fico9",
  EX: "/api/experian/credit-profile/credit-report/standard/exp-prequal-fico9",
  EQ: "/api/equifax/credit-report/standard/efx-prequal-fico9"
});
const OFFERSIQ_EVALUATE_PATH = "/api/offersiq/evaluate";
const OFFERSIQ_REEVALUATE_PATH = /^\/api\/offersiq\/reevaluate\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/* Company search and report. Not a consumer identity, so they do not go
   through the personal-file gate. The host check above still applies. */
const BUSINESS_PATHS = new Set([
  "/api/ccc/exp/search",
  "/api/ccc/exp/report",
  "/api/top-business-search/top-business-search",
  "/api/top-business-report/top-business-report",
  "/api/top-business-report/pdf/top-business-report"
]);

function bureauForReportPath(pathname) {
  for (const [bureau, orderPath] of Object.entries(REPORT_PATHS)) {
    if (pathname === orderPath) return bureau;
    if (pathname.startsWith(`${orderPath}/`)) {
      const requestId = pathname.slice(orderPath.length + 1);
      if (requestId && !requestId.includes("/")) return bureau;
    }
  }
  return null;
}

function refused(error) {
  return {
    ok: false,
    blocked: true,
    status: 0,
    body: null,
    headers: {},
    error,
    fence: ADAPTERS
  };
}

export function redactCrsError(value, { secrets = [] } = {}) {
  let safe = redact(value)
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[redacted-ssn]");

  for (const secret of secrets) {
    const text = String(secret ?? "");
    if (text) safe = safe.split(text).join("[redacted]");
  }
  return safe;
}

export function requestCrsSandbox({
  url,
  method = "POST",
  headers = {},
  body,
  env = process.env,
  fetchImpl,
  timeoutMs,
  signal,
  what
} = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve(refused("CRS request refused: invalid sandbox URL"));
  }

  const host = target.hostname.toLowerCase();
  const sandboxOk = host === CRS_SANDBOX_HOST;
  const productionOk = host === CRS_PRODUCTION_HOST && livePullAllowed(env);
  if (
    target.protocol !== "https:"
    || (!sandboxOk && !productionOk)
    || (target.port && target.port !== "443")
    || target.username
    || target.password
  ) {
    return Promise.resolve(refused(
      productionOk === false && host === CRS_PRODUCTION_HOST
        ? "CRS request refused: CRS_ALLOW_LIVE is not explicitly on"
        : "CRS request refused: allowed CRS host required"
    ));
  }
  if (method !== "POST" || target.search || target.hash) {
    return Promise.resolve(refused("CRS request refused: unsupported request shape"));
  }

  const bureau = bureauForReportPath(target.pathname);
  const offersIqEvaluate = target.pathname === OFFERSIQ_EVALUATE_PATH;
  const offersIqReevaluate = OFFERSIQ_REEVALUATE_PATH.test(target.pathname);
  if (!AUTH_PATHS.has(target.pathname) && !BUSINESS_PATHS.has(target.pathname) && !bureau
      && !offersIqEvaluate && !offersIqReevaluate) {
    return Promise.resolve(refused("CRS request refused: endpoint not allowed"));
  }
  if (bureau) {
    let identity;
    try {
      identity = typeof body === "string" ? JSON.parse(body) : body;
      assertIdentityAllowed({ host: target.hostname, bureau, identity, env });
    } catch {
      return Promise.resolve(refused("CRS request refused: identity not allowed for host"));
    }
  }
  if (offersIqEvaluate) {
    try {
      const requestBody = typeof body === "string" ? JSON.parse(body) : body;
      const checked = assertOffersIqWireBody(requestBody, { sandbox: sandboxOk });
      if (productionOk && isOffersIqProductionFixtureIdentity(checked.consumerData)) {
        return Promise.resolve(refused("CRS request refused: sandbox identity on production"));
      }
      body = JSON.stringify(checked);
    } catch {
      return Promise.resolve(refused("CRS request refused: OffersIQ identity or consent not allowed"));
    }
  }
  if (offersIqReevaluate && body !== undefined && body !== null) {
    return Promise.resolve(refused("CRS request refused: OffersIQ re-evaluation has no body"));
  }

  return transmit(target.toString(), {
    method,
    headers,
    body
  }, {
    fence: ADAPTERS,
    what,
    env,
    fetchImpl,
    timeoutMs,
    signal
  });
}
