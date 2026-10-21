// @ts-check
// Serper.dev web search — the bank outreach banker finder's only outside call.
//
// Why Serper (board ops/workflows/bank-outreach-auto-2026-10-20.md): 2,500 free
// searches with no card, then $1 per 1,000, Google results, and its terms do not
// forbid keeping results. Brave's terms (3(b)(i)) forbid storing results in a
// database, which is the whole job here.
//
// READ-ONLY TO THE WORLD. One POST of a search phrase; it reaches no person and
// changes no record at a vendor, but it spends a credit, so it still goes
// through transmit() behind the ADAPTERS fence. We read the engine's own result
// list only: title, link, snippet. Nothing here opens linkedin.com or a bank site.
//
// The endpoint and header are the ones Serper's signed-in playground shows; its
// public pages do not print them. The first live call confirms them, and a
// wrong one comes back as a plain error, never as an empty "no bankers" answer.
//
// NEVER THROWS. Returns { ok, results[], error, status, blocked }.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";

export const PROVIDER = "serper";
/* Declared so src/lib/no-unfenced-transmit.test.mjs checks this file uses the
   fenced helper. */
export const TRANSMITS = true;
export const ENDPOINT = "https://google.serper.dev/search";
export const TIMEOUT_MS = 8_000;
export const SIGNUP_URL = "https://serper.dev";

/* transmit()'s options are declared only by its default values; this names the
   set this file passes, the same way github-repo.mjs does. */
const post = /** @type {(url: string, init: object, opts: object) => Promise<{ok:boolean, blocked:boolean, status:number, body:any, error:string|null}>} */ (transmit);

/** The key, or null when missing, empty or a masked copy ("****abcd"). */
export function serperKey(env = process.env) {
  const key = String(env?.SERPER_API_KEY || "").trim();
  if (!key || key.includes("*")) return null;
  return key;
}

/**
 * @param {{ query: string, num?: number }} args
 * @param {{ env?: Record<string, any>, fetchImpl?: Function, timeoutMs?: number }} [opts]
 */
export async function searchWeb({ query, num = 10 } = { query: "" }, { env = process.env, fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  const key = serperKey(env);
  if (!key) return { ok: false, blocked: false, status: 0, results: [], error: "SERPER_API_KEY is not set" };
  const q = String(query || "").trim();
  if (!q) return { ok: false, blocked: false, status: 0, results: [], error: "empty search" };
  const res = await post(ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ q, gl: "us", hl: "en", num: Math.max(1, Math.min(10, Number(num) || 10)) })
  }, { fence: ADAPTERS, what: "serper search", env, fetchImpl, timeoutMs });
  if (res.blocked) return { ok: false, blocked: true, status: 0, results: [], error: res.error || "held by the adapters dry-run fence" };
  if (!res.ok) return { ok: false, blocked: false, status: res.status || 0, results: [], error: res.error || `serper returned HTTP ${res.status || 0}` };
  const organic = res.body && Array.isArray(res.body.organic) ? res.body.organic : null;
  if (!organic) return { ok: false, blocked: false, status: res.status, results: [], error: "serper answered without an organic result list" };
  const results = organic.slice(0, 10).map((r) => ({
    title: typeof r?.title === "string" ? r.title : "",
    link: typeof r?.link === "string" ? r.link : "",
    snippet: typeof r?.snippet === "string" ? r.snippet : ""
  }));
  return { ok: true, blocked: false, status: res.status, results, error: null };
}
