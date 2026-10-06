// ClickFunnels 2.0 REST API adapter — read-only, for the funnel/page performance
// panel. This module owns every call this app makes to ClickFunnels; nothing
// outside it constructs a ClickFunnels URL or holds an API key.
//
// VERIFIED, NOT ASSUMED. Every path, param name and error shape below was
// checked on 2026-09-07 against ClickFunnels' own published OpenAPI schema
// (https://developers.myclickfunnels.com/openapi/clickfunnels-api.json) and its
// docs (developers.myclickfunnels.com/docs/*). That schema disagrees with the
// build spec this file was written against in several places — flagged here so
// the next reader does not "fix" this back to the spec's assumptions:
//
//   1. THERE IS NO TOP-LEVEL GET /funnels OR GET /funnels/{id}/pages. Funnels
//      and pages are listed per WORKSPACE:
//        GET /workspaces/{workspace_id}/funnels
//        GET /workspaces/{workspace_id}/pages?filter[funnel_ids]=<id>
//      An API key is issued per TEAM, and a team can hold more than one
//      workspace/subdomain, so there is no way to skip straight to "the"
//      workspace from an api_key alone. This adapter resolves it itself:
//      GET /teams, then GET /teams/{team_id}/workspaces for each, matched to
//      the connection's own subdomain via the workspace's `subdomain` field
//      (Workspace schema has one). See resolveWorkspaceId() below. The result
//      is cached on the caller-supplied `ctx` object for the rest of one call
//      chain (e.g. one sync run), so a sync that calls listFunnels() once and
//      listPages() once per funnel does the team/workspace walk only once.
//
//   2. The stats query params are `timerange_start` / `timerange_end`
//      (ISO 8601), not `from`/`to`. fetchPageStats still takes `{ from, to }`
//      as its own argument names (matching this file's contract) and maps them
//      onto the real param names at the HTTP boundary.
//
//   3. ClickFunnels has no field literally named "conversions". The closest
//      documented concept for a funnel step is `optins` — an opt-in is the
//      step-level conversion event in ClickFunnels' own stats vocabulary
//      (their Stats Skill doc). fetchPageStats maps `step.optins` onto
//      `conversions`. If Chris means something else by "conversions" (a sale,
//      not an opt-in), that is `step.sales_count` instead — flagged rather
//      than guessed silently.
//
//   4. ClickFunnels' error envelope is `{"error": "plain string"}` on both 401
//      and 404 (confirmed against every documented error response in the
//      schema) — not Meta's `{"error": {"message": ...}}` object shape. And
//      ClickFunnels' own Authentication doc states plainly: "Our security
//      settings require a User-Agent." src/adplatforms/_api.mjs's
//      callPlatform() does neither (wrong error shape, no way to add a
//      header), so this file has its own small fetch wrapper, cfFetch(),
//      instead of reusing it.
//
//   5. Pagination is cursor-based: `after=<last item's id>`, 20 rows per page,
//      a `Pagination-Next` response header names the next cursor when more
//      rows exist. walkAll() below follows it to the end, capped at 25 pages
//      (500 rows) per resource so one runaway account can never spin a sync
//      forever.
//
//   6. AS OF THIS CHECK, the funnel/page stats endpoints are NOT marked
//      "closed beta" anywhere in the public docs, the OpenAPI schema, or the
//      docs changelog — they are fully documented, with response schemas,
//      worked examples, and a changelog entry about a recent addition to the
//      stats response ("Funnel-level opt-in totals in the stats API"). That
//      contradicts the build spec's premise. The 403/404-degrades-gracefully
//      handling the spec asked for is kept anyway: it costs nothing, it is
//      correct regardless of why a 403/404 happens, and a per-account beta
//      gate that never made it into the public docs is still possible — this
//      account has not been tried against the real API.
//
// TOKEN DISCIPLINE. credsFor() (this module's tokenFor()-equivalent) decrypts
// connection.encrypted_credentials fresh on every call and hands back a plain
// object; nothing here stores it on the connection, logs it, or lets it
// outlive the function that asked for it — same rule as
// src/adplatforms/meta.mjs's tokenFor().

import { decryptToken } from "../adplatforms/tokens.mjs";
import { transmit, ADAPTERS } from "../lib/outbound-fetch.mjs";

export const PLATFORM = "clickfunnels";

const API_VERSION = "v2";
const MAX_PAGES = 25; // 25 * 20 rows/page = 500 rows per resource, per call chain

function baseUrl(subdomain) {
  return `https://${subdomain}.myclickfunnels.com/api/${API_VERSION}`;
}

/* credsFor — decrypts connection.encrypted_credentials into {api_key, subdomain}.
   Exported so tests can exercise the decrypt step directly without a live
   ClickFunnels account; every adapter call below still re-derives its own
   copy rather than passing one around. */
export function credsFor(connection) {
  const json = decryptToken(connection?.encrypted_credentials, { partnerId: connection?.org_id });
  if (!json) throw new Error("connection has no credentials");
  let creds;
  try {
    creds = JSON.parse(json);
  } catch {
    throw new Error("connection credentials are not valid JSON");
  }
  if (!creds.api_key || !creds.subdomain) {
    throw new Error("connection credentials are missing api_key or subdomain");
  }
  return creds;
}

function scrubKey(text, key) {
  let out = String(text ?? "");
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]");
}

/* cfFetch — the one place an HTTP request to ClickFunnels is made.

   Every thrown error carries:
     platformMessage — ClickFunnels' own words (its {"error": "..."} string)
     status          — the HTTP status
     retryable       — 429 and 5xx only

   Returns { body, nextCursor } on success; nextCursor is the `Pagination-Next`
   response header (a string id) or null when there is no further page. */
export async function cfFetch({ url, apiKey, ctx = {}, method = "GET", body = undefined }) {
  const doFetch = ctx.fetch || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available");

  let res;
  try {
    const init = {
      method,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        // ClickFunnels' own Authentication doc: "Our security settings
        // require a User-Agent." Omitting it is a real, documented failure
        // mode here, not defensive boilerplate.
        "user-agent": "FundHub-Analytics/1.0 (+https://fundhub.ai)"
      }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    res = await doFetch(url, init);
  } catch (err) {
    const e = new Error(`ClickFunnels unreachable: ${scrubKey(String(err?.message || err), apiKey)}`);
    e.platformMessage = "ClickFunnels could not be reached.";
    e.retryable = true;
    throw e;
  }

  const text = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw text for the message */ }

  if (!res.ok) {
    const message = (parsed && typeof parsed.error === "string")
      ? parsed.error
      : String(text || `ClickFunnels ${res.status}`).slice(0, 500);
    const e = new Error(scrubKey(`ClickFunnels ${res.status}: ${message}`, apiKey));
    e.platformMessage = scrubKey(message, apiKey);
    e.status = res.status;
    e.retryable = res.status === 429 || res.status >= 500;
    throw e;
  }

  const nextCursor = (typeof res.headers?.get === "function" ? res.headers.get("pagination-next") : null) || null;
  return { body: parsed, nextCursor };
}

/* walkAll — follow cursor pagination to the end (or MAX_PAGES), returning the
   concatenated rows. `url` is a URL instance; a clone is mutated per page so
   the caller's own query params (filters, etc.) survive. */
async function walkAll({ url, apiKey, ctx }) {
  const out = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(url.toString());
    if (after) u.searchParams.set("after", after);
    const { body, nextCursor } = await cfFetch({ url: u.toString(), apiKey, ctx });
    if (Array.isArray(body)) out.push(...body);
    if (!nextCursor) break;
    after = nextCursor;
  }
  return out;
}

/* resolveWorkspaceId — the team/workspace walk described in deviation #1
   above. Cached on `ctx.workspaceId` so a caller that shares one `ctx` object
   across listFunnels()/listPages() calls (as api/analytics/clickfunnels-sync.mjs
   does for one sync run) pays this cost once. */
async function resolveWorkspaceId(creds, ctx) {
  if (ctx.workspaceId) return ctx.workspaceId;

  const teams = await walkAll({
    url: new URL(`${baseUrl(creds.subdomain)}/teams`),
    apiKey: creds.api_key,
    ctx
  });

  for (const team of teams) {
    const workspaces = await walkAll({
      url: new URL(`${baseUrl(creds.subdomain)}/teams/${team.id}/workspaces`),
      apiKey: creds.api_key,
      ctx
    });
    const match = workspaces.find((w) => w.subdomain === creds.subdomain);
    if (match) {
      ctx.workspaceId = match.id;
      return match.id;
    }
  }

  throw new Error(
    `no ClickFunnels workspace with subdomain "${creds.subdomain}" is visible to this API key`
  );
}

/* Upsert a Contact — POST /workspaces/{id}/contacts/upsert, match on email.
   Docs: https://developers.myclickfunnels.com/reference/upsertcontacts.md
   Empty fields are omitted. ClickFunnels does not clear a field when the
   value is null. */
/* upsertContact — THE ONE WRITE IN THIS FILE, AND IT GOES THROUGH THE FENCE.
   It sends a buyer's or applicant's details to ClickFunnels, which changes a
   vendor record about a person. Everything else here is a GET of Chris's own
   workspace. It used to go out through cfFetch's raw fetch like the reads, so
   ADAPTERS_DRY_RUN could not hold it while this file sat on the raw-fetch
   allow-list as "GET only" (found 2026-10-05 by
   src/lib/no-unfenced-transmit.test.mjs). It now goes through transmit() with
   the ADAPTERS fence: held unless ADAPTERS_DRY_RUN is an explicit off value,
   exactly like every other vendor write. ctx.env picks the switch (defaults to
   process.env); ctx.fetch is the test seam. A held write throws with
   `blocked: true` so a caller can say "held", not "refused". */
export async function upsertContact(creds, contact, ctx = {}) {
  if (!creds?.api_key || !creds?.subdomain) throw new Error("ClickFunnels credentials are missing");
  if (!contact?.email_address) throw new Error("contact email is required");
  const workspaceId = await resolveWorkspaceId(creds, ctx);
  const url = `${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/contacts/upsert`;
  const r = await transmit(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${creds.api_key}`,
      "user-agent": "FundHub-Analytics/1.0 (+https://fundhub.ai)"
    },
    body: JSON.stringify({ contact })
  }, { fence: ADAPTERS, what: "ClickFunnels contact upsert", env: ctx.env, fetchImpl: ctx.fetch });

  if (r.blocked) {
    const e = new Error(scrubKey(`ClickFunnels contact upsert held: ${r.error}`, creds.api_key));
    e.platformMessage = "Held by the ADAPTERS_DRY_RUN switch. Nothing was sent to ClickFunnels.";
    e.blocked = true;
    e.retryable = false;
    throw e;
  }
  if (!r.ok) {
    if (!r.status) {
      const e = new Error(`ClickFunnels unreachable: ${scrubKey(String(r.error || ""), creds.api_key)}`);
      e.platformMessage = "ClickFunnels could not be reached.";
      e.retryable = true;
      throw e;
    }
    const message = (r.body && typeof r.body.error === "string")
      ? r.body.error
      : String(r.error || `ClickFunnels ${r.status}`).slice(0, 500);
    const e = new Error(scrubKey(`ClickFunnels ${r.status}: ${message}`, creds.api_key));
    e.platformMessage = scrubKey(message, creds.api_key);
    e.status = r.status;
    e.retryable = r.status === 429 || r.status >= 500;
    throw e;
  }
  return r.body;
}

export async function listFunnels(connection, ctx = {}) {
  const creds = credsFor(connection);
  const workspaceId = await resolveWorkspaceId(creds, ctx);
  const url = new URL(`${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/funnels`);
  const rows = await walkAll({ url, apiKey: creds.api_key, ctx });
  return rows.map((f) => ({ id: f.id, name: f.name }));
}

export async function listPages(connection, funnelId, ctx = {}) {
  const creds = credsFor(connection);
  const workspaceId = await resolveWorkspaceId(creds, ctx);
  const url = new URL(`${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/pages`);
  url.searchParams.set("filter[funnel_ids]", String(funnelId));
  const rows = await walkAll({ url, apiKey: creds.api_key, ctx });
  return rows.map((p) => ({ id: p.id, name: p.name, funnel_id: funnelId }));
}

/* fetchPageStats — the single most important correctness requirement in this
   file. A 403 or 404 from ClickFunnels' own stats endpoint is a real,
   expected, reportable outcome (see deviation #6 above for why this stays in
   even though the current docs show the endpoint as generally available) —
   NEVER an unhandled throw. Any other failure (401, 429, 5xx, unreachable)
   still throws, with ClickFunnels' own message preserved on .platformMessage. */
export async function fetchPageStats(connection, pageId, { from, to } = {}, ctx = {}) {
  const creds = credsFor(connection);
  const url = new URL(`${baseUrl(creds.subdomain)}/pages/${pageId}/stats`);
  if (from) url.searchParams.set("timerange_start", from);
  if (to) url.searchParams.set("timerange_end", to);

  let body;
  try {
    ({ body } = await cfFetch({ url: url.toString(), apiKey: creds.api_key, ctx }));
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      return { available: false, reason: err.platformMessage || `ClickFunnels returned ${err.status}` };
    }
    throw err;
  }

  // funnel/step are null when the page is not reached via a funnel step
  // (a standalone or site page) — ClickFunnels' own docs say this endpoint
  // "currently only reports analytics for pages reached via a funnel step".
  // That is not a platform error; it is a real, reportable "nothing to show".
  if (!body || !body.step) {
    return { available: false, reason: "page is not reached via a funnel step — ClickFunnels reports no stats for it" };
  }

  const views = Number.isFinite(body.step.views_all) ? body.step.views_all : null;
  const conversions = Number.isFinite(body.step.optins) ? body.step.optins : null;
  return { available: true, views, conversions };
}
