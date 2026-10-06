#!/usr/bin/env node
// Find the Facebook Page id and the Instagram account id our Meta ads run as.
//
// WHY. A new ad creative needs object_story_spec.page_id and
// object_story_spec.instagram_user_id (spec §10.1, §10.2). They are not
// secrets, but nothing in the repo holds them. This reads them off Meta once;
// the main session then sets META_PAGE_ID and META_INSTAGRAM_USER_ID (new
// vars, no --secret) at ship time.
//
// WHAT IT TOUCHES.
//   Database: ONE read — the Meta rows of ad_platform_connections (the ad
//             account id and the stored key), under staff scope, the same way
//             scripts/meta-backfill-ad-days.mjs reads them. Nothing is written.
//   Meta:     GET only, every call through callPlatform:
//               1. /me/permissions                — the key must hold ads_management
//               2. /act_<id>/ads?fields=creative{object_story_spec}
//                                                 — a recent ad's Page and Instagram ids
//               3. /act_<id>/promote_pages        — only if no ad named a Page
//               4. /<page>?fields=instagram_business_account
//                                                 — only if no ad named an Instagram id
//             The ad account id comes from the connection row. None is typed here.
//
// OUTPUT. stdout holds only the ids, as two lines:
//   META_PAGE_ID=<id>
//   META_INSTAGRAM_USER_ID=<id>
// Where each came from, and anything Meta refused, goes to stderr in plain
// words. A Meta error is printed as Meta said it (with the key scrubbed), and
// the script stops.
//
// RUN (from a checkout that has .env with DATABASE_URL and AD_TOKEN_ENC_KEY):
//   node scripts/meta-page-ids.mjs
//   node scripts/meta-page-ids.mjs --partner <uuid>      # one partner's connection
//   node scripts/meta-page-ids.mjs --connection <uuid>   # one connection

import { pathToFileURL } from "node:url";
import { asStaff } from "../src/partners/rls.mjs";
import { decryptToken } from "../src/adplatforms/tokens.mjs";
import { callPlatform } from "../src/adplatforms/_api.mjs";
import { API_VERSION } from "../src/adplatforms/meta.mjs";
import { syncBlockReason } from "../api/campaigns/sync.mjs";

const BASE = "https://graph.facebook.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_ADS = 25;

/** --partner, --connection. Throws a plain sentence on a bad value. */
export function parseArgs(argv = []) {
  const out = { partnerId: null, connectionId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--partner") out.partnerId = argv[++i] ?? null;
    else if (a === "--connection") out.connectionId = argv[++i] ?? null;
    else throw new Error(`unknown option ${a}`);
  }
  if (out.partnerId != null && !UUID.test(out.partnerId)) throw new Error("--partner must be a uuid");
  if (out.connectionId != null && !UUID.test(out.connectionId)) throw new Error("--connection must be a uuid");
  return out;
}

export const CONNECTIONS_SQL = `
  SELECT id, org_id, partner_id, external_ad_account_id, connection_state, encrypted_access_token
    FROM ad_platform_connections
   WHERE platform = 'meta'
   ORDER BY created_at`;

/** The first usable Meta connection (or the one named). → { connection } | { error } */
export function pickConnection(rows = [], { partnerId = null, connectionId = null } = {}) {
  const wanted = rows.filter((c) =>
    (!partnerId || c.partner_id === partnerId) && (!connectionId || c.id === connectionId));
  if (!wanted.length) return { error: "No Meta connection matches. Connect the ad account first." };
  for (const c of wanted) if (!syncBlockReason(c)) return { connection: c };
  return { error: syncBlockReason(wanted[0]) };
}

const acct = (connection) => {
  const id = String(connection.external_ad_account_id || "");
  return id.startsWith("act_") ? id : `act_${id}`;
};

/** Newest ad first; the first ad naming a Page gives page_id, and the first ad
    naming that Page AND an Instagram id gives instagram_user_id. */
export function idsFromAds(ads = []) {
  const sorted = [...(Array.isArray(ads) ? ads : [])].sort((a, b) =>
    String(b?.created_time || "").localeCompare(String(a?.created_time || "")));
  let page_id = null;
  let instagram_user_id = null;
  for (const ad of sorted) {
    const oss = ad?.creative?.object_story_spec;
    if (!oss?.page_id) continue;
    if (!page_id) page_id = String(oss.page_id);
    if (String(oss.page_id) === page_id && oss.instagram_user_id) {
      instagram_user_id = String(oss.instagram_user_id);
      break;
    }
  }
  return { page_id, instagram_user_id };
}

/** A stop with Meta's own words, made plain. */
function metaStop(step, err) {
  const said = String(err?.platformMessage || err?.message || err).slice(0, 500);
  const e = new Error(`Meta refused ${step}. Meta said: ${said}`);
  e.metaStop = true;
  return e;
}

/**
 * findPageIds — the four GETs above. Every collaborator is an argument so the
 * test drives it with a fake Meta. → { page_id, instagram_user_id, notes: [] }
 */
export async function findPageIds({ connection, token, ctx = {}, version = API_VERSION } = {}) {
  const get = (path) => callPlatform({ url: `${BASE}/${version}/${path}`, token, method: "GET", ctx });
  const notes = [];

  // 1. The key must be able to manage ads at all.
  let perms;
  try { perms = await get("me/permissions"); } catch (e) { throw metaStop("to list the key's permissions", e); }
  const granted = (perms?.data || []).some((p) => p?.permission === "ads_management" && p?.status === "granted");
  if (!granted) {
    const e = new Error("The stored Meta key does not have ads_management, so it cannot load ads. Reconnect the ad account with that permission.");
    e.metaStop = true;
    throw e;
  }
  notes.push("The key has ads_management.");

  // 2. A recent ad's creative.
  const account = acct(connection);
  let ads;
  try {
    const qs = new URLSearchParams({ fields: "created_time,creative{object_story_spec}", limit: String(RECENT_ADS) });
    ads = await get(`${account}/ads?${qs}`);
  } catch (e) { throw metaStop("to list the ad account's ads", e); }
  let { page_id, instagram_user_id } = idsFromAds(ads?.data);
  if (page_id) notes.push("Page id read from a recent ad.");
  if (instagram_user_id) notes.push("Instagram id read from a recent ad.");

  // 3. No ad named a Page: the Pages this ad account can promote.
  if (!page_id) {
    let pages;
    try { pages = await get(`${account}/promote_pages?${new URLSearchParams({ fields: "id,name" })}`); }
    catch (e) { throw metaStop("to list the Pages this ad account can promote", e); }
    const first = (pages?.data || []).find((p) => p?.id);
    if (first) { page_id = String(first.id); notes.push("Page id read from the ad account's promotable Pages."); }
  }

  // 4. No ad named an Instagram id: the Page's linked Instagram business account.
  if (page_id && !instagram_user_id) {
    let page;
    try { page = await get(`${encodeURIComponent(page_id)}?${new URLSearchParams({ fields: "instagram_business_account" })}`); }
    catch (e) { throw metaStop("to read the Page's Instagram account", e); }
    if (page?.instagram_business_account?.id) {
      instagram_user_id = String(page.instagram_business_account.id);
      notes.push("Instagram id read from the Page's linked Instagram business account.");
    }
  }

  if (!page_id) notes.push("Meta shows no Page for this ad account.");
  else if (!instagram_user_id) notes.push("Meta shows no Instagram account on this Page.");
  return { page_id, instagram_user_id, notes };
}

/** One run: read the connection, decrypt its key, ask Meta. */
export async function run({
  partnerId = null,
  connectionId = null,
  fetch = globalThis.fetch,
  staffScope = asStaff,
  decrypt = (c) => decryptToken(c.encrypted_access_token, { partnerId: c.partner_id })
} = {}) {
  const rows = await staffScope((tx) => tx.query(CONNECTIONS_SQL).then((r) => r.rows));
  const picked = pickConnection(rows, { partnerId, connectionId });
  if (picked.error) return { ok: false, error: picked.error };
  const token = decrypt(picked.connection);
  if (!token) return { ok: false, error: "This Meta connection has no saved key. Connect the ad account again." };
  try {
    const found = await findPageIds({ connection: picked.connection, token, ctx: { fetch } });
    return { ok: Boolean(found.page_id), ...found };
  } catch (e) {
    if (e?.metaStop) return { ok: false, error: e.message };
    throw e;
  }
}

/** The lines for stdout: the two ids, nothing else. */
export function idLines({ page_id, instagram_user_id } = {}) {
  const lines = [];
  if (page_id) lines.push(`META_PAGE_ID=${page_id}`);
  if (instagram_user_id) lines.push(`META_INSTAGRAM_USER_ID=${instagram_user_id}`);
  return lines;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  const { close } = await import("../src/db.mjs");
  try {
    const result = await run(args);
    if (result.error) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    for (const n of result.notes || []) console.error(n);
    const lines = idLines(result);
    if (lines.length) console.log(lines.join("\n"));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
