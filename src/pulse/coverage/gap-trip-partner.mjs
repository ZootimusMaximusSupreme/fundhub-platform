// Morning wrapper around the beat-safe partner-trip truth.
// The SQL and verdict live in one place so hourly and daily runs cannot disagree.

import { clip, nowOf, readRows, runnerOf, skipWhy } from "./money-reads.mjs";
import { skipRow } from "./trip-kit.mjs";
import {
  AFFILIATE_SQL, CHECK_IDS, PAGE_CAP, PARTNER_SQL, ROW_CAP,
  judgePartner, pickPages, readPage, tripParams
} from "../beats/lib/trip-partner-truth.mjs";

export * from "../beats/lib/trip-partner-truth.mjs";

const ID = CHECK_IDS[0];

async function readPages(web, origin, partners, now) {
  const out = new Map();
  const rows = partners.filter((value) => value.page_slug && value.status === "active");
  const picked = pickPages(rows.map((value) => ({ partner_id: value.payee_id, slug: value.page_slug })), now, PAGE_CAP);
  const results = await Promise.all(picked.map(async (value) => [value.partner_id, await readPage(web, origin, value)]));
  for (const [id, result] of results) out.set(String(id), result);
  return out;
}

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the partner trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  const params = tripParams(orgId, now);
  try {
    const affiliates = await readRows(run, ID, "the affiliate trips", AFFILIATE_SQL, params.affiliate);
    if (affiliates.skip) return [affiliates.skip];
    const partners = await readRows(run, ID, "the white-label partner trips", PARTNER_SQL, params.partner);
    if (partners.skip) return [partners.skip];
    let pages = new Map();
    let note = "";
    const web = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
    const wantsPages = partners.rows.some((value) => value.page_slug && value.status === "active");
    if (wantsPages) {
      if (web) pages = await readPages(web, String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, ""), partners.rows, now);
      else note = "The published pages were not opened in this run, so \"live\" was not judged.";
    }
    if (affiliates.rows.length >= ROW_CAP || partners.rows.length >= ROW_CAP) {
      note = `${note} Only the first ${ROW_CAP} of one list were read.`.trim();
    }
    return [judgePartner({ affiliates: affiliates.rows, partners: partners.rows, pages, now, note })];
  } catch (err) {
    return [skipRow(ID, `could not judge the partner trips: ${clip(err)}`)];
  }
}
