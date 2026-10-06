// @ts-check
// ClickFunnels custom HTML pages, for funnels the dashboard builds (build units
// X4 and X4F).
//
// Docs read first (law: .claude/skills/clickfunnels-developers-docs):
// https://developers.myclickfunnels.com/llms.txt and the reference pages
// createfunnel, createpage, createcustomhtmlpage, updatepages, getfunnelstructure,
// listdomains, listfunnels, listworkflowsteps and createworkflowstep, read
// 2026-10-06:
//   GET  /workspaces/{workspace_id}/pages                 list pages (paged, Pagination-Next)
//   GET  /workspaces/{workspace_id}/funnels               list funnels (id, name, current_path,
//                                                          domain_id, archived)
//   GET  /workspaces/{workspace_id}/domains               the website domains (id, name)
//   POST /workspaces/{workspace_id}/funnels               create {funnel:{name, current_path,
//                                                          domain_id, live_mode}}
//   POST /workspaces/{workspace_id}/pages/custom_html     create {page:{name, description,
//                                                          custom_html, current_path, sort_order,
//                                                          funnel:{funnel_id}}}. With the funnel
//                                                          block the page is a STEP of that
//                                                          funnel and current_path is the step's
//                                                          address on the funnel's domain.
//                                                          Without it the page is standalone and
//                                                          is served on the workspace subdomain
//                                                          only, never on apply.fundhub.ai
//                                                          (measured 2026-10-06, page 25568231),
//                                                          so this file never makes one.
//                                                          head_code is REFUSED (422), so the
//                                                          tracking rides inside custom_html.
//   PUT  /pages/{id}                                      {page:{custom_html}} replaces the page;
//                                                          {page:{funnel:{show_page_step_id}}}
//                                                          moves the page onto that step (the
//                                                          page that was on it is kept, unlinked)
//   GET  /pages/{id}                                      one page (funnel, show_page_step, sdk)
//   GET  /funnels/{id}/structure                          the funnel's steps in order
//   GET  /teams, /teams/{id}/workspaces                   find the workspace when no id is set
// Bearer key and a User-Agent on every call (ClickFunnels' Authentication doc).
// Workflow steps (createworkflowstep) have no page step type, so a page joins a
// funnel only by being made in it or by being moved onto one of its steps.
//
// WHERE A FUNNEL PAGE LIVES. A page's `url` is ALWAYS the workspace subdomain +
// the page's own path, even for a page inside a funnel on apply.fundhub.ai (read
// 2026-10-06: /roadmap's page answers url .../fundhub-297-roadmap-sales). The
// address people open is the funnel's domain + show_page_step.current_path. So
// stepOf() reads the funnel and the step, and the caller (src/marketing/
// funnel-push.mjs) decides the address from the funnel it made on the domain.
//
// WHAT THIS FILE MAY DO, AND NOTHING ELSE:
//   * read the lists of pages, funnels and domains, one page, and a funnel's steps;
//   * CREATE a new funnel (it never changes or deletes a funnel);
//   * CREATE a new custom HTML page INSIDE a funnel (a page with no funnel is
//     refused here, before a request is built);
//   * PUT a page id that the caller proves is its own — a page this machine
//     created and saved in marketing_funnel_pages.cf_page_id: its HTML, or onto a
//     step of the funnel this machine made. Any other id is refused here, before
//     a request is built. It never deletes a page and never writes head_code or
//     footer_code.
//   * GET one of our live pages with a cache-busting query (the push proof).
//
// Every call goes through transmit() behind the ADAPTERS fence
// (src/lib/outbound-fetch.mjs): held unless ADAPTERS_DRY_RUN is an explicit off
// value. NEVER THROWS: each function answers {ok, error, ...} in plain words.
// The key is never logged; transmit() redacts vendor errors.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";

export const PROVIDER = "clickfunnels-pages";
export const TRANSMITS = true;

/** The workspace host when CLICKFUNNELS_SUBDOMAIN is not set (scripts/cf-push-custom-html.mjs). */
export const DEFAULT_SUBDOMAIN = "chrisstanbridgestea3f77f";
export const TIMEOUT_MS = 20_000;
/** Pages read per list (ClickFunnels pages 20 rows at a time). */
export const MAX_LIST_PAGES = 50;
const USER_AGENT = "Fundhub-Funnel-Builder/1.0 (+https://fundhub.ai)";
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PATH_RE = /^\/[a-z0-9]+(-[a-z0-9]+)*$/;

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {{ apiKey: string, subdomain: string, workspaceId: string | null }} Creds */

const send = /** @type {(url: string, init: object, opts: object) => Promise<any>} */ (transmit);

/**
 * The key, host and workspace from the environment, or { error } when the key
 * is missing or masked.
 * @param {Env} [env]
 * @returns {Creds | { error: string }}
 */
export function cfCreds(env = process.env) {
  const apiKey = String(env?.CLICKFUNNELS_API_KEY ?? "").trim();
  if (!apiKey || apiKey.includes("*")) return { error: "CLICKFUNNELS_API_KEY is not set (or is masked) on the server." };
  const sub = String(env?.CLICKFUNNELS_SUBDOMAIN ?? "").trim().toLowerCase();
  const subdomain = /^[a-z0-9-]{1,63}$/.test(sub) ? sub : DEFAULT_SUBDOMAIN;
  const ws = String(env?.CLICKFUNNELS_WORKSPACE_ID ?? "").trim();
  return { apiKey, subdomain, workspaceId: ID_RE.test(ws) ? ws : null };
}

const base = (/** @type {Creds} */ c) => `https://${c.subdomain}.myclickfunnels.com/api/v2`;

/**
 * @param {Creds} creds
 * @param {string} method
 * @param {string} url
 * @param {{ env?: Env, fetchImpl?: Function, body?: any, what: string }} opts
 */
function call(creds, method, url, { env, fetchImpl, body, what }) {
  return send(url, {
    method,
    headers: {
      authorization: `Bearer ${creds.apiKey}`,
      "user-agent": USER_AGENT,
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }, { fence: ADAPTERS, what, env, fetchImpl, timeoutMs: TIMEOUT_MS });
}

/** @returns {any} A failed answer: { ok: false, error, ...extra }. */
const fail = (error, extra = {}) => ({ ok: false, error: String(error || "failed"), ...extra });

/** A plain sentence for a failed call. */
function why(r, doing) {
  if (r.blocked) return `${doing}: held by the outbound fence (${r.error}).`;
  if (r.status === 401 || r.status === 403) return `${doing}: ClickFunnels refused the key (HTTP ${r.status}).`;
  if (r.status === 422) return `${doing}: ClickFunnels refused it (HTTP 422: ${String(r.error || "").slice(0, 200)}).`;
  if (!r.status) return `${doing}: ClickFunnels could not be reached (${r.error}).`;
  return `${doing}: ClickFunnels answered HTTP ${r.status} (${String(r.error || "").slice(0, 200)}).`;
}

/** The object an answer carries (some answers wrap it: {page:{...}}, {funnel:{...}}). */
function bodyOf(r, key) {
  const b = r && r.body && typeof r.body === "object" ? r.body : null;
  if (!b) return null;
  return b[key] && typeof b[key] === "object" ? b[key] : b;
}

/** Every row of a paged list, following Pagination-Next. @returns {Promise<any>} */
async function walk(creds, url, opts, doing) {
  const rows = [];
  let after = null;
  for (let i = 0; i < MAX_LIST_PAGES; i += 1) {
    const u = new URL(url);
    if (after) u.searchParams.set("after", after);
    const r = await call(creds, "GET", u.toString(), { ...opts, what: doing });
    if (!r.ok) return fail(why(r, doing));
    if (Array.isArray(r.body)) rows.push(...r.body);
    after = (r.headers && r.headers["pagination-next"]) || null;
    if (!after) return { ok: true, rows };
  }
  return fail(`${doing}: more than ${MAX_LIST_PAGES} pages of results; stopped rather than guess.`);
}

/**
 * The workspace id: CLICKFUNNELS_WORKSPACE_ID, else the workspace whose
 * subdomain matches (GET /teams, then each team's workspaces).
 * @param {Creds} creds
 * @param {{ env?: Env, fetchImpl?: Function }} [opts]
 * @returns {Promise<any>}
 */
export async function workspaceId(creds, opts = {}) {
  if (creds.workspaceId) return { ok: true, id: creds.workspaceId };
  const teams = await walk(creds, `${base(creds)}/teams`, opts, "Reading ClickFunnels teams");
  if (!teams.ok) return teams;
  for (const team of teams.rows) {
    const ws = await walk(creds, `${base(creds)}/teams/${encodeURIComponent(team.id)}/workspaces`, opts, "Reading ClickFunnels workspaces");
    if (!ws.ok) return ws;
    const match = ws.rows.find((w) => String(w.subdomain || "").toLowerCase() === creds.subdomain);
    if (match) return { ok: true, id: String(match.id) };
    if (ws.rows.length === 1) return { ok: true, id: String(ws.rows[0].id) };
  }
  return fail(`No ClickFunnels workspace has the subdomain ${creds.subdomain}. Set CLICKFUNNELS_WORKSPACE_ID.`);
}

/**
 * READ ONLY. One workspace list (pages, funnels or domains).
 * @param {"pages"|"funnels"|"domains"} what
 * @param {{ env?: Env, fetchImpl?: Function, creds?: Creds, workspace?: string }} opts
 * @param {string} doing
 * @returns {Promise<any>}
 */
async function listOf(what, opts, doing) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const io = { env, fetchImpl: opts.fetchImpl };
  const ws = opts.workspace ? { ok: true, id: opts.workspace } : await workspaceId(creds, io);
  if (!ws.ok) return fail(ws.error);
  const all = await walk(creds, `${base(creds)}/workspaces/${encodeURIComponent(ws.id)}/${what}`, io, doing);
  if (!all.ok) return fail(all.error);
  return { ok: true, rows: all.rows, workspace: ws.id };
}

/**
 * READ ONLY. Every page in the workspace (id, name, description, current_path,
 * url, custom_html_page, show_page_step, funnel).
 * @param {{ env?: Env, fetchImpl?: Function, creds?: Creds, workspace?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function listPages(opts = {}) {
  const r = await listOf("pages", opts, "Reading the ClickFunnels page list");
  return r.ok ? { ok: true, pages: r.rows, workspace: r.workspace } : r;
}

/**
 * READ ONLY. Every funnel in the workspace (id, public_id, name, current_path,
 * domain_id, archived).
 * @param {{ env?: Env, fetchImpl?: Function, creds?: Creds, workspace?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function listFunnels(opts = {}) {
  const r = await listOf("funnels", opts, "Reading the ClickFunnels funnel list");
  return r.ok ? { ok: true, funnels: r.rows, workspace: r.workspace } : r;
}

/**
 * READ ONLY. The workspace's website domains (id, name, status, connected).
 * @param {{ env?: Env, fetchImpl?: Function, creds?: Creds, workspace?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function listDomains(opts = {}) {
  const r = await listOf("domains", opts, "Reading the ClickFunnels domains");
  return r.ok ? { ok: true, domains: r.rows, workspace: r.workspace } : r;
}

/**
 * Where a page sits: its funnel id and its step's id and path, or nulls for a
 * page that is in no funnel (standalone). Paths are lower case, no trailing slash.
 * @param {any} page
 * @returns {{ funnelId: string|null, funnelPublicId: string|null, stepId: string|null, stepPath: string|null, standalone: boolean }}
 */
export function stepOf(page) {
  const f = page && typeof page === "object" && page.funnel && typeof page.funnel === "object" ? page.funnel : null;
  const s = page && typeof page === "object" && page.show_page_step && typeof page.show_page_step === "object" ? page.show_page_step : null;
  const raw = s && typeof s.current_path === "string" ? s.current_path.trim().toLowerCase().replace(/\/+$/, "") : "";
  return {
    funnelId: f && f.id != null && f.id !== "" ? String(f.id) : null,
    funnelPublicId: f && f.public_id != null && f.public_id !== "" ? String(f.public_id) : null,
    stepId: s && s.id != null && s.id !== "" ? String(s.id) : null,
    stepPath: raw.startsWith("/") ? raw : null,
    standalone: !f && !s
  };
}

/**
 * CREATE one new funnel on a domain. live_mode is on, as for the /roadmap funnel
 * (docs/sops/clickfunnels-custom-html-push.md). Answers the funnel's id and the
 * domain ClickFunnels put it on.
 * @param {{ name: string, path: string, domainId: string, workspace: string,
 *           env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function createFunnel(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  if (!opts.workspace) return fail("No ClickFunnels workspace id.");
  if (!PATH_RE.test(String(opts.path || ""))) return fail(`Refused to make a funnel at ${JSON.stringify(opts.path)}: not a clean address.`);
  const domain = String(opts.domainId ?? "");
  if (!/^\d{1,20}$/.test(domain)) return fail("Refused to make a funnel with no domain: it would not be served on the funnel host.");
  const r = await call(creds, "POST", `${base(creds)}/workspaces/${encodeURIComponent(opts.workspace)}/funnels`, {
    env, fetchImpl: opts.fetchImpl, what: `ClickFunnels create funnel ${opts.path}`,
    body: { funnel: { name: String(opts.name || "").slice(0, 200), current_path: opts.path, domain_id: Number(domain), live_mode: true } }
  });
  if (!r.ok) return fail(why(r, `Making the funnel ${opts.path}`), { status: Number(r.status) || 0 });
  const f = bodyOf(r, "funnel");
  if (!f || f.id == null || f.id === "") return fail(`Making the funnel ${opts.path}: ClickFunnels answered without a funnel id.`);
  return {
    ok: true,
    funnel: f,
    id: String(f.id),
    publicId: f.public_id != null ? String(f.public_id) : null,
    domainId: f.domain_id != null ? String(f.domain_id) : null,
    currentPath: typeof f.current_path === "string" ? f.current_path : null
  };
}

/**
 * CREATE one new custom HTML page as a step of `funnelId`, at `path` on the
 * funnel's domain. `sortOrder` (zero based) places the step; left out, the step
 * goes last. A page with no funnel is refused before any request.
 * @param {{ name: string, description: string, html: string, path: string, funnelId: string,
 *           sortOrder?: number|null, workspace: string, env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function createCustomHtmlPage(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  if (!opts.workspace) return fail("No ClickFunnels workspace id.");
  if (!PATH_RE.test(String(opts.path || ""))) return fail(`Refused to create a page at ${JSON.stringify(opts.path)}: not a clean address.`);
  const funnelId = String(opts.funnelId ?? "");
  if (!ID_RE.test(funnelId)) {
    return fail(`Refused to create ${opts.path} outside a funnel: a standalone page is never served on the funnel host.`);
  }
  const sort = opts.sortOrder;
  if (sort != null && !(Number.isInteger(sort) && sort >= 0)) return fail(`Refused: ${JSON.stringify(sort)} is not a step position.`);
  const r = await call(creds, "POST", `${base(creds)}/workspaces/${encodeURIComponent(opts.workspace)}/pages/custom_html`, {
    env, fetchImpl: opts.fetchImpl, what: `ClickFunnels create page ${opts.path}`,
    body: {
      page: {
        name: opts.name, description: opts.description, custom_html: opts.html, current_path: opts.path,
        ...(sort != null ? { sort_order: sort } : {}),
        funnel: { funnel_id: funnelId }
      }
    }
  });
  // The status rides along so the caller can tell a refusal (401, 403, 422: the
  // same on a retry) from a busy answer (429) that is worth trying again later.
  if (!r.ok) return fail(why(r, `Making ${opts.path}`), { status: Number(r.status) || 0 });
  const page = bodyOf(r, "page");
  const id = page && (page.id ?? page.public_id);
  if (id == null || id === "") return fail(`Making ${opts.path}: ClickFunnels answered without a page id.`);
  return {
    ok: true,
    page,
    id: String(id),
    publicId: page.public_id != null ? String(page.public_id) : null,
    url: typeof page.url === "string" && page.url ? page.url : null,
    currentPath: typeof page.current_path === "string" ? page.current_path : null,
    token: page.sdk && typeof page.sdk.token === "string" ? page.sdk.token : null,
    ...stepOf(page)
  };
}

/**
 * READ ONLY. One page (to read back where it sits and its page token).
 * @param {{ pageId: string, env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function getPage(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const id = String(opts.pageId ?? "");
  if (!ID_RE.test(id)) return fail(`Not a page id: ${JSON.stringify(id)}`);
  const r = await call(creds, "GET", `${base(creds)}/pages/${encodeURIComponent(id)}`, { env, fetchImpl: opts.fetchImpl, what: `ClickFunnels page ${id}` });
  if (!r.ok) return fail(why(r, `Reading page ${id}`), { status: Number(r.status) || 0 });
  const page = bodyOf(r, "page") || {};
  return { ok: true, page, token: page.sdk && typeof page.sdk.token === "string" ? page.sdk.token : null, ...stepOf(page) };
}

/**
 * READ ONLY. A funnel's steps in the order people move through them
 * (GET /funnels/{id}/structure: follow the array, not sort_order).
 * steps: [{ type, stepId, pageId }].
 * @param {{ funnelId: string, env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function funnelStructure(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const id = String(opts.funnelId ?? "");
  if (!ID_RE.test(id)) return fail(`Not a funnel id: ${JSON.stringify(id)}`);
  const r = await call(creds, "GET", `${base(creds)}/funnels/${encodeURIComponent(id)}/structure`, { env, fetchImpl: opts.fetchImpl, what: `ClickFunnels funnel ${id} steps` });
  if (!r.ok) return fail(why(r, `Reading the steps of funnel ${id}`));
  const b = r.body && typeof r.body === "object" ? r.body : {};
  const steps = (Array.isArray(b.steps) ? b.steps : []).map((s) => ({
    type: String((s && s.step_type) || ""),
    stepId: s && s.show_page_step_id != null ? String(s.show_page_step_id) : null,
    pageId: s && s.page && s.page.id != null ? String(s.page.id) : null
  }));
  return { ok: true, steps };
}

/**
 * The one PUT this file makes, for ONE OF OUR OWN pages. `ownedIds` is the list
 * of ClickFunnels page ids this machine created (marketing_funnel_pages.cf_page_id).
 * Any other id is refused here and no request is made.
 * @param {{ pageId: string, ownedIds: string[], page: object, doing: string, env?: Env,
 *           fetchImpl?: Function, creds?: Creds }} opts
 */
async function putOwnPage(opts) {
  const id = String(opts.pageId ?? "");
  const owned = new Set((Array.isArray(opts.ownedIds) ? opts.ownedIds : []).map(String));
  if (!id || !owned.has(id)) {
    return fail(`Refused: page ${id || "(none)"} was not made by this machine, so it is never changed from here.`, { refused: true });
  }
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const r = await call(creds, "PUT", `${base(creds)}/pages/${encodeURIComponent(id)}`, {
    env, fetchImpl: opts.fetchImpl, what: `ClickFunnels page ${id} ${opts.doing}`,
    body: { page: opts.page }
  });
  if (!r.ok) return fail(why(r, `${opts.doing} on page ${id}`), { status: Number(r.status) || 0 });
  return { ok: true };
}

/**
 * PUT the HTML of ONE OF OUR OWN pages. Any id not in `ownedIds` is refused here
 * and no request is made.
 * @param {{ pageId: string, html: string, ownedIds: string[], env?: Env,
 *           fetchImpl?: Function, creds?: Creds }} opts
 */
export function putOwnPageHtml(opts) {
  return putOwnPage({ ...opts, page: { custom_html: opts.html }, doing: "Saving the page" });
}

/**
 * Move ONE OF OUR OWN pages onto a step (PUT /pages/{id} funnel.show_page_step_id).
 * The page that was on that step is kept on ClickFunnels, unlinked. The caller
 * passes a step of the funnel this machine made. Any page id not in `ownedIds` is
 * refused here and no request is made.
 * @param {{ pageId: string, stepId: string, ownedIds: string[], env?: Env,
 *           fetchImpl?: Function, creds?: Creds }} opts
 */
export function moveOwnPageOntoStep(opts) {
  const step = String(opts.stepId ?? "");
  if (!ID_RE.test(step)) return Promise.resolve(fail(`Refused: ${JSON.stringify(step)} is not a step id.`, { refused: true }));
  return putOwnPage({ ...opts, page: { funnel: { show_page_step_id: step } }, doing: "Moving the page into the funnel" });
}

/**
 * The live page as a visitor gets it, with a cache-busting query so a stale
 * copy is not read as proof. No key is sent.
 * @param {{ url: string, now?: number, env?: Env, fetchImpl?: Function }} opts
 * @returns {Promise<{ ok: boolean, status: number, html: string, url: string, error: string|null }>}
 */
export async function fetchLivePage(opts) {
  let u;
  try { u = new URL(opts.url); } catch { return { ok: false, status: 0, html: "", url: String(opts.url), error: "not an address" }; }
  if (u.protocol !== "https:") return { ok: false, status: 0, html: "", url: u.toString(), error: "not https" };
  u.searchParams.set("fh_cb", String(opts.now ?? Date.now()));
  const r = await send(u.toString(), {
    method: "GET",
    headers: { "user-agent": USER_AGENT, "cache-control": "no-cache", pragma: "no-cache" }
  }, { fence: ADAPTERS, what: `live page proof ${u.pathname}`, env: opts.env ?? process.env, fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, asText: true });
  return {
    ok: !!r.ok,
    status: r.status || 0,
    html: typeof r.body === "string" ? r.body : "",
    url: u.toString(),
    error: r.ok ? null : (r.blocked ? `held by the outbound fence (${r.error})` : (r.error || `HTTP ${r.status}`))
  };
}

export default {
  PROVIDER, TRANSMITS, cfCreds, workspaceId, listPages, listFunnels, listDomains, stepOf, getPage, funnelStructure,
  createFunnel, createCustomHtmlPage, putOwnPageHtml, moveOwnPageOntoStep, fetchLivePage
};
