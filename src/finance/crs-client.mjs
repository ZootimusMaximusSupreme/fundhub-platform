// The CRS (Stitch Credit) HTTP client. Username and password in, one bureau's
// credit report out.
//
// AUTH IS A LOGIN, NOT AN API KEY. This was wrong in an earlier reading of the
// integration and it is worth stating plainly: there is no static key. The
// client posts a username and password to /users/login, gets a bearer token and
// a refresh token back, and carries the bearer on every later call. The token
// is short-lived — the sandbox answers `expires: 3600`, in seconds — so it is
// cached on the instance and reused. One tri-bureau pull is one login, not
// three.
//
// EVERYTHING GOES THROUGH THE PROVIDER. This client builds the request, but
// src/messaging/providers/crs-softview.mjs owns the only CRS call to the
// outbound chokepoint. That provider declares the ADAPTERS fence, which holds
// every request unless ADAPTERS_DRY_RUN is explicitly off.
//
// THIS FILE NEVER CHOOSES WHOSE CREDIT TO PULL. It is handed an identity and it
// checks that identity against the host before building a request
// (src/finance/crs-identities.mjs). The check is here, at the last point before
// the wire, rather than in the caller that picks the identity — a caller can be
// replaced by a new caller, and the guarantee has to survive that.
//
// WHAT IT DOES NOT DO. No database, no events, no soft-pull ledger, no scoring,
// no merging of bureaus. It makes calls and returns what came back. The pull is
// coordinated in src/finance/crs-pull.mjs and nowhere else.

import {
  redactCrsError,
  requestCrsSandbox
} from "../messaging/providers/crs-softview.mjs";
import {
  BUREAUS,
  CRS_PRODUCTION_HOST,
  CRS_SANDBOX_HOST,
  assertIdentityAllowed,
  isoBirthDate,
  livePullAllowed,
  normalizeHost
} from "./crs-identities.mjs";
import {
  BUREAU_FILE_STATUS,
  bureauHardErrors,
  classifyBureauReport,
  creditFileStatuses
} from "./crs-map.mjs";

/* ── What goes in the request, per bureau ──────────────────────────────────
   Spec docs/specs/roadmap-checkout-soft-pull-2026-09-22.md §2-§3 and its
   independent check.

   SUFFIX. Equifax's suffix field holds 2 characters (confirmed, Redocly
   Equifax tag), so III is NOT sent to Equifax — a blank is sent, which is
   what every pull sent before this change. JR, SR, II and IV fit. Experian's
   basic schema shows 3 characters; TransUnion documents none. Both get the
   stored value (JR, SR, II, III or IV — all 3 characters or fewer).

   PREVIOUS ADDRESS. CRS says past addresses help a bureau match, but nobody
   has told us the borrowerResidencyType label a past address takes on the
   Standard Format endpoints we call (spec §2: "We send the previous address
   once CRS tells us the right label for it"). So the mapping is built and the
   label is null: a stored previous address is NOT sent until someone sets
   this to the label CRS confirms. The current home is always sent. */
export const SUFFIX_MAX_BY_BUREAU = Object.freeze({ EQ: 2, EX: 3, TU: 3 });
export const CRS_PRIOR_RESIDENCY_TYPE = null;

/** Capital letters, no accents, single spaces. José → JOSE. */
export function bureauText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** The suffix this bureau can take, or "" when it does not fit. */
export function suffixForBureau(suffix, bureau) {
  const s = bureauText(suffix).replace(/\./g, "");
  if (!s) return "";
  const max = SUFFIX_MAX_BY_BUREAU[bureau] ?? 3;
  return s.length <= max ? s : "";
}

/** "Current" for the home; the prior label (null today) for a past address. */
export function residencyTypeFor(address) {
  if (address?.borrowerResidencyType) return address.borrowerResidencyType;
  if (String(address?.residency ?? "").toLowerCase() === "previous") return CRS_PRIOR_RESIDENCY_TYPE;
  return "Current";
}

/* Why a bureau that answered with no file is not a success. The vendor's raw
   status value is quoted so a human can see exactly what came back. */
function noFileError(bureau, fileStatus, report) {
  const raw = creditFileStatuses(report).join(", ");
  const what = fileStatus === BUREAU_FILE_STATUS.FROZEN
    ? "the file is frozen at this bureau"
    : "the bureau returned no file";
  return `${bureau}: ${what}${raw ? ` (${raw})` : ""}`;
}

export class CrsError extends Error {
  constructor(message, { status = 502, code = null, blocked = false } = {}) {
    super(message);
    this.name = "CrsError";
    this.status = status;
    this.code = code;
    this.blocked = blocked;
  }
}

/* The prequal FICO 9 product, per bureau, exactly as the vendor's Postman
   collection spells the paths. Written out per bureau rather than assembled
   from a template because they are NOT symmetrical — Experian nests its
   consumer report under /experian/credit-profile/ and the other two do not, and
   a clever template would have to encode that exception anyway.

   `retrieve` re-reads a report CRS already produced, keyed by the RequestID the
   order returned. It is not a second pull and does not create a second inquiry. */
const PRODUCTS = Object.freeze({
  TU: Object.freeze({
    label: "TransUnion",
    order: "/transunion/credit-report/standard/tu-prequal-fico9",
    retrieve: (id) => `/transunion/credit-report/standard/tu-prequal-fico9/${encodeURIComponent(id)}`
  }),
  EX: Object.freeze({
    label: "Experian",
    order: "/experian/credit-profile/credit-report/standard/exp-prequal-fico9",
    retrieve: (id) => `/experian/credit-profile/credit-report/standard/exp-prequal-fico9/${encodeURIComponent(id)}`
  }),
  EQ: Object.freeze({
    label: "Equifax",
    order: "/equifax/credit-report/standard/efx-prequal-fico9",
    retrieve: (id) => `/equifax/credit-report/standard/efx-prequal-fico9/${encodeURIComponent(id)}`
  })
});

export const CRS_PRODUCTS = PRODUCTS;

/** Renew this long before the token actually dies, so a slow call cannot land
 *  on the far side of the expiry it was issued under. */
export const TOKEN_SKEW_MS = 60_000;

/** CRS is a synchronous report call, not a quick ack — the default 10s in the
 *  chokepoint times out a normal Experian order. */
export const CRS_TIMEOUT_MS = 45_000;

/**
 * crsConfigFromEnv — the three variables, or a description of what is missing.
 * Never throws: a caller that runs before configuration exists should be able
 * to say so, not crash.
 */
export function crsConfigFromEnv(env = process.env) {
  const username = String(env?.CRS_API_USERNAME ?? "").trim();
  const password = String(env?.CRS_API_PASSWORD ?? "").trim();
  const host = normalizeHost(env?.CRS_API_HOST);

  const missing = [];
  if (!username) missing.push("CRS_API_USERNAME");
  if (!password) missing.push("CRS_API_PASSWORD");
  if (!host) missing.push("CRS_API_HOST");

  return {
    configured: missing.length === 0,
    missing,
    username,
    password,
    host,
    baseUrl: host ? `https://${host}/api` : null
  };
}

/* The report shapes CRS returns carry these at the top level — see the vendor's
   sandbox payload library. Used only to tell "the order returned the report" from
   "the order returned a receipt and the report needs retrieving". */
function binFromBusinessSearch(body) {
  if (!body || typeof body !== "object") return null;
  if (typeof body.bin === "string" && body.bin.trim()) return body.bin.trim();
  const lists = [body.results, body.data?.results, Array.isArray(body.data) ? body.data : null];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const bin = row?.bin || row?.BIN;
      if (typeof bin === "string" && bin.trim()) return bin.trim();
    }
  }
  return null;
}

/* LexisNexis Top Business returns a selection key, not a report-ready company
   record. The caller must show this small, explicit match list and send the
   chosen ids back — never guess that the first search hit is the right firm. */
function topBusinessMatches(body) {
  const rows = Array.isArray(body) ? body
    : Array.isArray(body?.results) ? body.results
      : Array.isArray(body?.data?.results) ? body.data.results
        : body && typeof body === "object" ? [body] : [];
  return rows.map((row) => {
    const seleID = Number(row?.seleID ?? row?.seleId);
    const orgID = Number(row?.orgID ?? row?.orgId ?? 0);
    const ultID = Number(row?.ultID ?? row?.ultId ?? 0);
    if (!Number.isSafeInteger(seleID) || seleID <= 0
        || !Number.isSafeInteger(orgID) || orgID < 0
        || !Number.isSafeInteger(ultID) || ultID < 0) return null;
    return {
      seleID,
      orgID,
      ultID,
      companyName: String(row?.companyName ?? row?.businessName ?? row?.name ?? "").trim(),
      streetAddress: String(row?.streetAddress ?? row?.address ?? "").trim(),
      city: String(row?.city ?? "").trim(),
      state: String(row?.state ?? "").trim().toUpperCase(),
      zipCode: String(row?.zipCode ?? row?.postalCode ?? "").trim()
    };
  }).filter(Boolean);
}

function looksLikeReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Array.isArray(body.creditFiles)
      || Array.isArray(body.tradelines)
      || Array.isArray(body.scores);
}

/* CRS reports its own failures in the body as well as the status: an
   `Access Denied` comes back with `codes: ["CRS113"]`. Surfacing that string
   beats surfacing "HTTP 401" when somebody has to work out why a pull failed. */
function vendorError(body) {
  if (!body || typeof body !== "object") return null;
  const codes = Array.isArray(body.codes) ? body.codes.filter(Boolean) : [];
  const messages = Array.isArray(body.messages) ? body.messages.filter(Boolean) : [];
  if (!codes.length && !messages.length) return null;
  return [messages.join("; "), codes.length ? `(${codes.join(", ")})` : ""]
    .filter(Boolean).join(" ");
}

/**
 * createCrsClient — one client, one token cache.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.env]        Defaults to process.env.
 * @param {Function} [opts.fetchImpl]  Test seam. Does NOT bypass the fence.
 * @param {Function} [opts.now]        Clock seam, milliseconds.
 */
export function createCrsClient({ env = process.env, fetchImpl, now = Date.now } = {}) {
  const config = crsConfigFromEnv(env);

  // Token state. Held on the instance rather than at module scope: a module
  // global would be shared by every org and every test in the process, and the
  // reuse it buys is only worth having inside a single pull anyway.
  let token = null;
  let refreshToken = null;
  let expiresAt = 0;
  let inFlight = null;

  function requireConfig() {
    if (!config.configured) {
      throw new CrsError(
        `CRS is not configured — missing ${config.missing.join(", ")}`,
        { status: 503, code: "not_configured" }
      );
    }
    if (config.host === CRS_PRODUCTION_HOST) {
      // TWO KEYS. Host alone is never enough — see CRS_ALLOW_LIVE.
      if (!livePullAllowed(env)) {
        throw new CrsError(
          "CRS production host refused — CRS_ALLOW_LIVE is not explicitly on",
          { status: 503, code: "production_host_refused" }
        );
      }
    } else if (config.host !== CRS_SANDBOX_HOST) {
      throw new CrsError(
        `CRS host refused — CRS_API_HOST must be ${CRS_SANDBOX_HOST}` +
        ` (or ${CRS_PRODUCTION_HOST} with CRS_ALLOW_LIVE on)`,
        { status: 503, code: "unknown_host" }
      );
    }
  }

  async function call(path, { method = "POST", body, bearer } = {}) {
    requireConfig();
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;

    return requestCrsSandbox({
      url: `${config.baseUrl}${path}`,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      what: `CRS ${method} ${path}`,
      env,
      fetchImpl,
      timeoutMs: CRS_TIMEOUT_MS
    });
  }

  function storeSession(body) {
    // `expires` is a count of SECONDS in every sample the vendor ships. Treated
    // as unknown when it is not a positive number rather than defaulted to an
    // hour: a token we wrongly believe is fresh fails the NEXT call, which is
    // the confusing kind of failure. An unknown expiry means "re-login", which
    // is merely wasteful.
    const seconds = Number(body?.expires);
    token = typeof body?.token === "string" && body.token ? body.token : null;
    refreshToken = typeof body?.refreshToken === "string" && body.refreshToken
      ? body.refreshToken
      : null;
    expiresAt = token && Number.isFinite(seconds) && seconds > 0
      ? now() + seconds * 1000
      : 0;
    return token;
  }

  function safeResponseError(res, fallback) {
    return redactCrsError(
      vendorError(res?.body) || res?.error || fallback,
      { secrets: [config.username, config.password, token, refreshToken] }
    );
  }

  async function login() {
    const res = await call("/users/login", {
      body: { username: config.username, password: config.password }
    });
    if (res.blocked) {
      throw new CrsError(
        `CRS login held by the adapters fence: ${safeResponseError(res, "request blocked")}`,
        { status: 503, code: "fence_blocked", blocked: true }
      );
    }
    if (!res.ok || !res.body?.token) {
      throw new CrsError(
        `CRS login failed: ${safeResponseError(res, `HTTP ${res.status}`)}`,
        { status: 502, code: "login_failed" }
      );
    }
    return storeSession(res.body);
  }

  async function refresh() {
    if (!refreshToken) return login();
    const res = await call("/users/refresh-token", { body: { refreshToken } });
    if (res.blocked) {
      throw new CrsError(
        `CRS token refresh held by the adapters fence: ${safeResponseError(res, "request blocked")}`,
        { status: 503, code: "fence_blocked", blocked: true }
      );
    }
    if (!res.ok || !res.body?.token) {
      refreshToken = null;
      return login();
    }
    return storeSession(res.body);
  }

  /** A live bearer token. Concurrent callers share one login, not one each. */
  async function getToken({ force = false } = {}) {
    if (!force && token && expiresAt - TOKEN_SKEW_MS > now()) return token;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        return (!force && refreshToken) ? await refresh() : await login();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /* An authenticated call, with exactly one re-auth on a 401.
     ONE retry, not a loop: if a freshly minted token is also rejected, the
     credentials or the account are the problem and asking again cannot fix it.
     CLAUDE.md §8 — two failed attempts at the same thing is where we stop. */
  async function authed(path, { method = "POST", body } = {}) {
    let res = await call(path, { method, body, bearer: await getToken() });
    if (res.status === 401 || res.status === 403) {
      res = await call(path, { method, body, bearer: await getToken({ force: true }) });
    }
    return res;
  }

  function productFor(bureau) {
    const product = PRODUCTS[bureau];
    if (!product) {
      throw new CrsError(`bureau must be one of: ${BUREAUS.join(", ")}`,
        { status: 400, code: "unknown_bureau" });
    }
    return product;
  }

  /* The request body CRS wants: the identity, flat, with its addresses. Built
     from named fields rather than by spreading the caller's object so that a
     stray internal field — a client id, a note, anything — cannot ride along to
     a credit bureau. */
  function orderBody(identity, bureau) {
    const body = {
      firstName: bureauText(identity.firstName),
      middleName: bureauText(identity.middleName),
      lastName: bureauText(identity.lastName),
      suffix: suffixForBureau(identity.suffix, bureau),
      birthDate: isoBirthDate(identity.birthDate) || "",
      ssn: String(identity.ssn ?? "").replace(/\D/g, ""),
      addresses: (Array.isArray(identity.addresses) ? identity.addresses : [])
        .map((a) => ({ a, type: residencyTypeFor(a) }))
        // A past address with no confirmed label is kept on file, not sent.
        .filter(({ type }) => Boolean(type))
        .map(({ a, type }) => ({
          borrowerResidencyType: type,
          addressLine1: bureauText(a?.addressLine1),
          // Apt / unit. Equifax's basic schema has its own 5-character box;
          // the Standard Format endpoints take it here.
          addressLine2: bureauText(a?.addressLine2),
          city: bureauText(a?.city),
          state: bureauText(a?.state),
          postalCode: a?.postalCode ?? ""
        }))
    };
    if (identity.email) body.email = identity.email;
    return body;
  }

  /**
   * orderPrequal — order one bureau's prequal FICO 9 report.
   *
   * Returns `{ ok, bureau, report, requestId, status, error, blocked }` and does
   * not throw for a vendor failure: a tri-bureau pull wants to know that
   * Equifax failed while TransUnion succeeded, and an exception per bureau
   * makes that awkward to express. A misconfiguration or a refused identity
   * DOES throw — those are programming and compliance faults, not vendor
   * weather, and they must not be swallowed into a partial result.
   */
  async function orderPrequal({ bureau, identity } = {}) {
    const product = productFor(bureau);

    // THE GATE. Before a body is built, before anything is on the wire.
    assertIdentityAllowed({ host: config.host, bureau, identity, env });

    const res = await authed(product.order, { body: orderBody(identity, bureau) });

    // CRS keys its own retention log by this id and returns it in a header, not
    // in the body. Kept for provenance: it is how a human asks the vendor what
    // we were sent, months later.
    const requestId = res.headers?.requestid ?? res.headers?.["request-id"] ?? null;
    const ERROR = BUREAU_FILE_STATUS.ERROR;

    if (res.blocked) {
      return { ok: false, bureau, report: null, requestId: null, status: 0,
        blocked: true, fileStatus: ERROR, error: safeResponseError(res, "request blocked") };
    }
    if (!res.ok) {
      return { ok: false, bureau, report: null, requestId, status: res.status,
        blocked: false, fileStatus: ERROR,
        error: safeResponseError(res, `HTTP ${res.status}`) };
    }

    // The order normally answers with the report itself. When it answers with a
    // receipt instead, the report is fetched by id — the vendor's own Postman
    // collection models both steps, so neither is a guess.
    if (looksLikeReport(res.body)) {
      return reportResult({ bureau, body: res.body, requestId, status: res.status });
    }
    if (requestId) {
      return retrievePrequal({ bureau, requestId, identity });
    }
    return { ok: false, bureau, report: null, requestId, status: res.status,
      blocked: false, fileStatus: ERROR,
      error: "CRS returned neither a report nor a RequestID to retrieve one with" };
  }

  /* A report body came back. It is a success ONLY when a file came back.
     A frozen file and a no-file answer used to be returned as ok — the body
     has a creditFiles array, so it "looked like a report" — and were stored
     as a successful pull with nothing in it. Now they come back ok:false with
     fileStatus saying which, and the body is kept for whoever reads why. */
  function reportResult({ bureau, body, requestId, status }) {
    const hard = bureauHardErrors(body);
    if (hard) {
      return { ok: false, bureau, report: body, requestId, status,
        blocked: false, fileStatus: BUREAU_FILE_STATUS.ERROR, error: hard };
    }
    const fileStatus = classifyBureauReport(body);
    if (fileStatus !== BUREAU_FILE_STATUS.FILE_RETURNED) {
      return { ok: false, bureau, report: body, requestId, status,
        blocked: false, fileStatus, error: noFileError(bureau, fileStatus, body) };
    }
    return { ok: true, bureau, report: body, requestId, status,
      blocked: false, fileStatus, error: null };
  }

  /** retrievePrequal — re-read a report CRS already produced. Not a new pull. */
  async function retrievePrequal({ bureau, requestId, identity } = {}) {
    const product = productFor(bureau);
    if (!requestId) {
      throw new CrsError("requestId is required to retrieve a report",
        { status: 400, code: "request_id_required" });
    }
    assertIdentityAllowed({ host: config.host, bureau, identity, env });

    const res = await authed(product.retrieve(requestId), { body: orderBody(identity, bureau) });

    if (res.blocked) {
      return { ok: false, bureau, report: null, requestId, status: 0,
        blocked: true, fileStatus: BUREAU_FILE_STATUS.ERROR,
        error: safeResponseError(res, "request blocked") };
    }
    if (!res.ok || !looksLikeReport(res.body)) {
      return { ok: false, bureau, report: null, requestId, status: res.status,
        blocked: false, fileStatus: BUREAU_FILE_STATUS.ERROR,
        error: safeResponseError(res, "CRS returned no report for that RequestID") };
    }
    return reportResult({ bureau, body: res.body, requestId, status: res.status });
  }

  /**
   * orderBusinessReport — Experian Business for one saved company.
   * Search by name and state, then order that match. A miss or a vendor
   * error comes back ok:false. It does not throw, so one company cannot
   * cancel the personal pull.
   */
  async function orderBusinessReport({ name, state } = {}) {
    const company = String(name ?? "").trim();
    const st = String(state ?? "").trim().toUpperCase();
    if (!company || !/^[A-Z]{2}$/.test(st)) {
      return { ok: false, report: null, bin: null, error: "name and state are required" };
    }
    const search = await authed("/ccc/exp/search", { body: { name: company, state: st } });
    if (search.blocked || !search.ok) {
      return { ok: false, report: null, bin: null,
        error: safeResponseError(search, "business search failed") };
    }
    const bin = binFromBusinessSearch(search.body);
    if (!bin) {
      return { ok: false, report: null, bin: null, error: "no business match" };
    }
    const report = await authed("/ccc/exp/report", { body: { bin } });
    if (report.blocked || !report.ok || !report.body || typeof report.body !== "object") {
      return { ok: false, report: null, bin,
        error: safeResponseError(report, "business report failed") };
    }
    return { ok: true, report: report.body, bin, error: null };
  }

  /** Search LNR Top Business. This contains business-only fields: no person,
   * SSN, date of birth, or consumer-credit identity is accepted here. */
  async function searchTopBusiness({ companyName, streetAddress = "", city = "", state = "", zipCode = "" } = {}) {
    const company = String(companyName ?? "").trim();
    if (!company) return { ok: false, matches: [], error: "company name is required" };
    const search = await authed("/top-business-search/top-business-search", {
      body: {
        companyName: company,
        streetAddress: String(streetAddress ?? "").trim(),
        city: String(city ?? "").trim(),
        state: String(state ?? "").trim().toUpperCase(),
        zipCode: String(zipCode ?? "").trim()
      }
    });
    if (search.blocked || !search.ok) {
      return { ok: false, matches: [], error: safeResponseError(search, "LNR business search failed") };
    }
    return { ok: true, matches: topBusinessMatches(search.body), error: null };
  }

  /** Pull the LNR Comprehensive Business Report for a match the operator chose. */
  async function pullTopBusinessReport({ seleID, orgID, ultID } = {}) {
    const ids = { seleID: Number(seleID), orgID: Number(orgID), ultID: Number(ultID) };
    if (!Number.isSafeInteger(ids.seleID) || ids.seleID <= 0
        || !Number.isSafeInteger(ids.orgID) || ids.orgID < 0
        || !Number.isSafeInteger(ids.ultID) || ids.ultID < 0) {
      return { ok: false, report: null, error: "a valid LNR business match is required" };
    }
    const report = await authed("/top-business-report/top-business-report", { body: ids });
    if (report.blocked || !report.ok || !report.body || typeof report.body !== "object") {
      return { ok: false, report: null, error: safeResponseError(report, "LNR business report failed") };
    }
    return { ok: true, report: report.body, error: null };
  }

  return {
    config,
    host: config.host,
    isConfigured: () => config.configured,
    login,
    refresh,
    getToken,
    orderPrequal,
    retrievePrequal,
    orderBusinessReport,
    searchTopBusiness,
    pullTopBusinessReport,
    // Test seam only — lets a test assert the cache without exporting the
    // token itself, which has no business leaving this closure.
    _tokenState: () => ({ hasToken: !!token, hasRefresh: !!refreshToken, expiresAt })
  };
}
