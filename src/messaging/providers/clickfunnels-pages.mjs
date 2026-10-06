// @ts-check
// ClickFunnels custom HTML pages, for funnels the dashboard builds (build unit X4).
//
// Docs read first (law: .claude/skills/clickfunnels-developers-docs): the
// OpenAPI at https://developers.myclickfunnels.com/openapi/clickfunnels-api.json,
// fetched 2026-10-06:
//   GET  /workspaces/{workspace_id}/pages                 list pages (paged, Pagination-Next)
//   POST /workspaces/{workspace_id}/pages/custom_html     create {page:{name, description,
//                                                          custom_html, current_path}}; no
//                                                          `funnel` block = a standalone page.
//                                                          head_code is REFUSED (422), so the
//                                                          tracking rides inside custom_html.
//                                                          The answer carries id, public_id,
//                                                          current_path, url and sdk.token.
//   PUT  /pages/{id}                                      {page:{custom_html}} replaces the page
//   GET  /teams, /teams/{id}/workspaces                   find the workspace when no id is set
// Bearer key and a User-Agent on every call (ClickFunnels' Authentication doc).
//
// WHAT THIS FILE MAY DO, AND NOTHING ELSE:
//   * read the list of pages (to know which addresses are taken);
//   * CREATE a new custom HTML page;
//   * PUT the HTML of a page id that the caller proves is its own — a page this
//     machine created and saved in marketing_funnel_pages.cf_page_id. Any other
//     id is refused here, before a request is built. It never deletes a page,
//     never touches a funnel, never writes head_code or footer_code.
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
  return { apiKey, subdomain, workspaceId: /^[A-Za-z0-9_-]{1,40}$/.test(ws) ? ws : null };
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
  if (r.status === 422) return `${doing}: ClickFunnels refused the page (HTTP 422: ${String(r.error || "").slice(0, 200)}).`;
  if (!r.status) return `${doing}: ClickFunnels could not be reached (${r.error}).`;
  return `${doing}: ClickFunnels answered HTTP ${r.status} (${String(r.error || "").slice(0, 200)}).`;
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
 * READ ONLY. Every page in the workspace (id, name, description, current_path,
 * url, custom_html_page, show_page_step.current_path).
 * @param {{ env?: Env, fetchImpl?: Function, creds?: Creds, workspace?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function listPages(opts = {}) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const io = { env, fetchImpl: opts.fetchImpl };
  const ws = opts.workspace ? { ok: true, id: opts.workspace } : await workspaceId(creds, io);
  if (!ws.ok) return fail(ws.error);
  const all = await walk(creds, `${base(creds)}/workspaces/${encodeURIComponent(ws.id)}/pages`, io, "Reading the ClickFunnels page list");
  if (!all.ok) return fail(all.error);
  return { ok: true, pages: all.rows, workspace: ws.id };
}

/**
 * CREATE one new standalone custom HTML page at `path`.
 * @param {{ name: string, description: string, html: string, path: string,
 *           workspace: string, env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function createCustomHtmlPage(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  if (!opts.workspace) return fail("No ClickFunnels workspace id.");
  if (!/^\/[a-z0-9]+(-[a-z0-9]+)*$/.test(String(opts.path || ""))) return fail(`Refused to create a page at ${JSON.stringify(opts.path)}: not a clean address.`);
  const r = await call(creds, "POST", `${base(creds)}/workspaces/${encodeURIComponent(opts.workspace)}/pages/custom_html`, {
    env, fetchImpl: opts.fetchImpl, what: `ClickFunnels create page ${opts.path}`,
    body: { page: { name: opts.name, description: opts.description, custom_html: opts.html, current_path: opts.path } }
  });
  // The status rides along so the caller can tell a refusal (401, 403, 422: the
  // same on a retry) from a busy answer (429) that is worth trying again later.
  if (!r.ok) return fail(why(r, `Making ${opts.path}`), { status: Number(r.status) || 0 });
  const page = r.body && typeof r.body === "object" && r.body.page && typeof r.body.page === "object" ? r.body.page : r.body;
  const id = page && (page.id ?? page.public_id);
  if (id == null || id === "") return fail(`Making ${opts.path}: ClickFunnels answered without a page id.`);
  return {
    ok: true,
    id: String(id),
    publicId: page.public_id != null ? String(page.public_id) : null,
    url: typeof page.url === "string" && page.url ? page.url : null,
    currentPath: typeof page.current_path === "string" ? page.current_path : null,
    token: page.sdk && typeof page.sdk.token === "string" ? page.sdk.token : null
  };
}

/**
 * READ ONLY. One page (to read back the page token of a page we made).
 * @param {{ pageId: string, env?: Env, fetchImpl?: Function, creds?: Creds }} opts
 * @returns {Promise<any>}
 */
export async function getPage(opts) {
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const id = String(opts.pageId ?? "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return fail(`Not a page id: ${JSON.stringify(id)}`);
  const r = await call(creds, "GET", `${base(creds)}/pages/${encodeURIComponent(id)}`, { env, fetchImpl: opts.fetchImpl, what: `ClickFunnels page ${id}` });
  if (!r.ok) return fail(why(r, `Reading page ${id}`));
  const page = r.body && typeof r.body === "object" ? r.body : {};
  return { ok: true, page, token: page.sdk && typeof page.sdk.token === "string" ? page.sdk.token : null };
}

/**
 * PUT the HTML of ONE OF OUR OWN pages. `ownedIds` is the list of ClickFunnels
 * page ids this machine created (marketing_funnel_pages.cf_page_id). Any other
 * id is refused here and no request is made.
 * @param {{ pageId: string, html: string, ownedIds: string[], env?: Env,
 *           fetchImpl?: Function, creds?: Creds }} opts
 */
export async function putOwnPageHtml(opts) {
  const id = String(opts.pageId ?? "");
  const owned = new Set((Array.isArray(opts.ownedIds) ? opts.ownedIds : []).map(String));
  if (!id || !owned.has(id)) {
    return fail(`Refused: page ${id || "(none)"} was not made by this machine, so it is never changed from here.`, { refused: true });
  }
  const env = opts.env ?? process.env;
  const creds = opts.creds ?? cfCreds(env);
  if ("error" in creds) return fail(creds.error);
  const r = await call(creds, "PUT", `${base(creds)}/pages/${encodeURIComponent(id)}`, {
    env, fetchImpl: opts.fetchImpl, what: `ClickFunnels page ${id} html`,
    body: { page: { custom_html: opts.html } }
  });
  if (!r.ok) return fail(why(r, `Saving page ${id}`));
  return { ok: true };
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

export default { PROVIDER, TRANSMITS, cfCreds, workspaceId, listPages, getPage, createCustomHtmlPage, putOwnPageHtml, fetchLivePage };
