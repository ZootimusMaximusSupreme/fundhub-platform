#!/usr/bin/env node
/**
 * Push FundHub funnel HTML + tracking to ClickFunnels 2.0 via Custom HTML Pages API.
 * GA 2026-09-18: POST /workspaces/{id}/pages/custom_html, PUT /pages/{id} (custom_html, head_code).
 *
 * Auth (names only in logs): CLICKFUNNELS_API_KEY + CLICKFUNNELS_SUBDOMAIN,
 * or analytics_connections row (platform=clickfunnels) via DATABASE_URL.
 *
 * Never prints secrets. Never commits .env.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

import { cfFetch } from "../src/analytics/clickfunnels.mjs";
import { decryptToken } from "../src/adplatforms/tokens.mjs";
import {
  metaPixelId,
  metaPixelHeadHtml,
  directRoasHeadHtml,
  wrapCustomHtmlDocument,
  headBlocksHtml,
  DO_NOT_FULL_REPLACE_PATHS,
  PUSH_MANIFEST,
  trackingFooterScripts,
  isClickFunnelsPageHtml,
  upsertMarkedBlock,
  nextFooterCode,
  nextHeadCode,
  nextFunnelHeadCode,
  hasScriptSrc,
  footerScriptTag,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  CLARITY_SRC,
  DEFER_FOOTER_SRCS,
  ga4HeadHtml,
} from "../marketing/landing-pages/tracking-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SUBDOMAIN = "chrisstanbridgestea3f77f";

function loadDotEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

function baseUrl(subdomain) {
  return `https://${subdomain}.myclickfunnels.com/api/v2`;
}

/** GET/PUT/POST to ClickFunnels (FundHub push — includes write methods). */
async function cfApi({ url, apiKey, ctx = {}, method = "GET", body }) {
  if (method === "GET") return cfFetch({ url, apiKey, ctx, method });
  const doFetch = ctx.fetch || globalThis.fetch;
  const res = await doFetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "FundHub-CF-Push/1.0 (+https://fundhub.ai)",
    },
    body,
  });
  const text = await res.text().catch(() => "");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed.error === "string" ? parsed.error : String(text).slice(0, 500);
    const e = new Error(`ClickFunnels ${res.status}: ${message}`);
    e.status = res.status;
    e.platformMessage = message;
    throw e;
  }
  return {
    body: parsed,
    nextCursor:
      typeof res.headers?.get === "function" ? res.headers.get("pagination-next") : null,
  };
}

async function credsFromEnv() {
  const apiKey = String(process.env.CLICKFUNNELS_API_KEY ?? "").trim();
  const subdomain = String(process.env.CLICKFUNNELS_SUBDOMAIN ?? DEFAULT_SUBDOMAIN)
    .trim()
    .toLowerCase();
  if (!apiKey) return null;
  return { api_key: apiKey, subdomain, source: "CLICKFUNNELS_API_KEY" };
}

async function credsFromDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const pool = new pg.Pool({ connectionString: url });
  try {
    const r = await pool.query(
      `SELECT org_id, external_account_id, encrypted_credentials
       FROM analytics_connections WHERE platform = 'clickfunnels' AND connection_state = 'active'
       LIMIT 1`,
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    const json = decryptToken(row.encrypted_credentials, { partnerId: row.org_id });
    const parsed = JSON.parse(json);
    return {
      api_key: parsed.api_key,
      subdomain: parsed.subdomain || row.external_account_id,
      source: "analytics_connections",
    };
  } finally {
    await pool.end();
  }
}

async function resolveCreds() {
  const fromEnv = await credsFromEnv();
  if (fromEnv) return fromEnv;
  const fromDb = await credsFromDb();
  if (fromDb) return fromDb;
  return null;
}

async function resolveWorkspaceId(creds, ctx = {}) {
  if (process.env.CLICKFUNNELS_WORKSPACE_ID) {
    return String(process.env.CLICKFUNNELS_WORKSPACE_ID).trim();
  }
  const teams = await walkAll(`${baseUrl(creds.subdomain)}/teams`, creds.api_key, ctx);
  for (const team of teams) {
    const workspaces = await walkAll(
      `${baseUrl(creds.subdomain)}/teams/${team.id}/workspaces`,
      creds.api_key,
      ctx,
    );
    const match = workspaces.find((w) => w.subdomain === creds.subdomain);
    if (match) return match.id;
    if (workspaces.length === 1) return workspaces[0].id;
  }
  throw new Error(`workspace not found for subdomain ${creds.subdomain}`);
}

async function walkAll(url, apiKey, ctx) {
  const out = [];
  let after = null;
  for (let page = 0; page < 25; page++) {
    const u = new URL(url);
    if (after) u.searchParams.set("after", after);
    const { body, nextCursor } = await cfApi({ url: u.toString(), apiKey, ctx });
    if (Array.isArray(body)) out.push(...body);
    if (!nextCursor) break;
    after = nextCursor;
  }
  return out;
}

function readFragment(relPath) {
  const abs = join(ROOT, relPath);
  return readFileSync(abs, "utf8");
}

function trackingHeadScripts({ skipMeta, skipDirectRoas, skipGa4, env = process.env }) {
  const parts = [];
  if (!skipMeta) parts.push(metaPixelHeadHtml(metaPixelId(env).id));
  if (!skipDirectRoas) parts.push(directRoasHeadHtml(env));
  if (!skipGa4) {
    const ga = ga4HeadHtml(env);
    if (ga) parts.push(ga);
  }
  return parts.join("\n");
}

function footerSrcs(footBits) {
  return [...String(footBits).matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
}

function injectIntoCustomHtmlDocument(html, { headBits = "", footBits = "" } = {}) {
  let out = html;
  if (headBits && !out.includes(headBits.slice(0, 40))) {
    if (out.includes("</head>")) out = out.replace("</head>", `${headBits}\n</head>`);
    else out = `${headBits}\n${out}`;
  }
  if (footBits && !out.includes(footBits.slice(0, 40))) {
    if (out.includes("</body>")) out = out.replace("</body>", `${footBits}\n</body>`);
    else out = `${out}\n${footBits}`;
  }
  return out;
}

async function getCustomHtml(creds, pageId, ctx) {
  const { body } = await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}/custom_html`,
    apiKey: creds.api_key,
    ctx,
  });
  return body.custom_html ?? "";
}

function injectBlock(html, block) {
  if (!block || html.includes(block.slice(0, 40))) return html;
  return `${html}\n${block}`;
}

async function listPages(creds, workspaceId, ctx) {
  const funnels = await walkAll(
    `${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/funnels`,
    creds.api_key,
    ctx,
  );
  const pages = [];
  for (const f of funnels) {
    const url = new URL(`${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/pages`);
    url.searchParams.set("filter[funnel_ids]", String(f.id));
    const rows = await walkAll(url.toString(), creds.api_key, ctx);
    for (const p of rows) {
      pages.push({
        id: p.id,
        name: p.name,
        current_path: p.current_path,
        funnel_id: f.id,
        funnel_name: f.name,
      });
    }
  }
  return pages;
}

/**
 * The public page as a visitor gets it (no auth). Empty string when it cannot be
 * read, or when what came back is not a ClickFunnels page (a bot wall or error page
 * would otherwise read as "no scripts on the page" and every tag would be appended again).
 */
async function fetchLiveHtml(url, ctx = {}) {
  if (!url) return "";
  const doFetch = ctx.fetch || globalThis.fetch;
  try {
    const res = await doFetch(url, {
      headers: { "user-agent": "Fundhub-CF-Push/1.0 (+https://fundhub.ai)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return isClickFunnelsPageHtml(html) ? html : "";
  } catch {
    return "";
  }
}

async function getPage(creds, pageId, ctx) {
  const { body } = await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}`,
    apiKey: creds.api_key,
    ctx,
  });
  return body;
}

async function isCustomHtmlPage(creds, pageId, ctx) {
  try {
    await cfApi({
      url: `${baseUrl(creds.subdomain)}/pages/${pageId}/custom_html`,
      apiKey: creds.api_key,
      ctx,
    });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

async function appendHeadFooter(creds, pageId, headSnippet, footerSnippet, ctx, dryRun) {
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      pageId,
      mode: "head_footer_append",
      would_append_footer_srcs: footerSrcs(footerSnippet),
      would_append_head: Boolean(headSnippet),
    };
  }
  if (!headSnippet && !footerSnippet) {
    return { ok: true, pageId, mode: "head_footer_append", skipped: true, reason: "tracking_already_present" };
  }
  const page = await getPage(creds, pageId, ctx);
  const payload = { page: {} };
  if (headSnippet) {
    payload.page.head_code = headSnippet;
    payload.page.head_code_mode = "append";
  }
  if (footerSnippet) {
    payload.page.footer_code = footerSnippet;
    payload.page.footer_code_mode = "append";
  }
  const { body } = await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}`,
    apiKey: creds.api_key,
    ctx,
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return { ok: true, pageId, body };
}

/** GET one page with head_code / footer_code expanded (they are left out otherwise). */
async function getFunnelHead(creds, funnelId, ctx) {
  const url = new URL(`${baseUrl(creds.subdomain)}/funnels/${funnelId}`);
  url.searchParams.append("expand[]", "head_code");
  const { body } = await cfApi({ url: url.toString(), apiKey: creds.api_key, ctx });
  if (!body || !Object.prototype.hasOwnProperty.call(body, "head_code")) {
    throw new Error(`funnel ${funnelId}: head_code not returned with expand — refusing to strip a pixel blind`);
  }
  return String(body.head_code ?? "");
}

/**
 * Funnel-level head_code (row strategy "funnel_head_pixel"): swap the one Meta pixel
 * <script> for metaPixelHeadHtml (PageView with eventID) and leave every other byte.
 * Reads first and stops, writing nothing, when the head cannot be read or does not hold
 * exactly one pixel. Snapshots the live head before the write, sends the whole head with
 * head_code_mode "replace" (PUT /funnels/{id}), then reads it back and fails unless it
 * matches what was sent.
 */
async function pushFunnelHeadPixel(creds, row, pixelId, ctx, dryRun, snapDir) {
  let live;
  try {
    live = await getFunnelHead(creds, row.funnelId, ctx);
  } catch (err) {
    return { ok: false, skipped: true, reason: "funnel_head_unreadable", detail: err.message };
  }
  let plan;
  try {
    plan = nextFunnelHeadCode(live, pixelId);
  } catch (err) {
    return { ok: false, skipped: true, reason: "funnel_head_pixel_not_one", detail: err.message };
  }
  const base = { funnel_id: row.funnelId, head_changed: plan.changed, head_length_before: live.length };
  if (!plan.changed) return { ok: true, ...base, skipped: true, reason: "pixel_already_right" };
  if (dryRun) return { ok: true, dryRun: true, ...base, head_length_after: plan.next.length };
  mkdirSync(snapDir, { recursive: true });
  const snapshot = join(snapDir, `funnel-${row.funnelId}-head_code.html`);
  writeFileSync(snapshot, live, "utf8");
  await cfApi({
    url: `${baseUrl(creds.subdomain)}/funnels/${row.funnelId}`,
    apiKey: creds.api_key,
    ctx,
    method: "PUT",
    body: JSON.stringify({ funnel: { head_code: plan.next, head_code_mode: "replace" } }),
  });
  const after = await getFunnelHead(creds, row.funnelId, ctx);
  const verified = after.trim() === plan.next.trim();
  return { ok: verified, ...base, verified, snapshot: snapshot.slice(ROOT.length + 1), head_length_after: after.length };
}

async function getPageCode(creds, pageId, slot, ctx) {
  const url = new URL(`${baseUrl(creds.subdomain)}/pages/${pageId}`);
  url.searchParams.append("expand[]", slot);
  const { body } = await cfApi({ url: url.toString(), apiKey: creds.api_key, ctx });
  if (!body || !Object.prototype.hasOwnProperty.call(body, slot)) {
    throw new Error(`page ${pageId}: ${slot} not returned with expand — refusing to write blind`);
  }
  return String(body[slot] ?? "");
}

/**
 * Upsert one marked block (row.marker) from row.fragment into a builder page's
 * head_code or footer_code. Snapshots the live code first. Never touches the body.
 */
async function upsertCodeBlock(creds, pageId, row, ctx, dryRun, snapDir) {
  const slot = row.codeSlot === "footer_code" ? "footer_code" : "head_code";
  const block = readFragment(row.fragment);
  const live = await getPageCode(creds, pageId, slot, ctx);
  mkdirSync(snapDir, { recursive: true });
  const snapshot = join(snapDir, `page-${pageId}-${slot}.html`);
  writeFileSync(snapshot, live, "utf8");
  const plan = upsertMarkedBlock(live, block, row.marker);
  const base = { slot, marker: row.marker, action: plan.mode, snapshot: snapshot.slice(ROOT.length + 1) };
  if (!plan.changed) return { ok: true, pageId, ...base, skipped: true, reason: "block_unchanged" };
  if (dryRun) return { ok: true, dryRun: true, pageId, ...base };
  await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}`,
    apiKey: creds.api_key,
    ctx,
    method: "PUT",
    body: JSON.stringify({ page: { [slot]: plan.send, [`${slot}_mode`]: plan.mode } }),
  });
  const after = await getPageCode(creds, pageId, slot, ctx);
  // append keeps every byte that was there; replace must equal what was sent
  const verified =
    after.includes(block.trim()) &&
    (plan.mode === "replace" ? after.trim() === plan.next.trim() : after.includes(live.trim()));
  return { ok: verified, pageId, ...base, verified, code_length_before: live.length, code_length_after: after.length };
}

/**
 * Builder page (the body cannot be replaced by API): add this row's footer scripts.
 * Reads the live footer_code (expand[]) and the public page first and stops, appending
 * nothing, if either cannot be read: a blind write would stack every tag again.
 * Sends the whole footer with footer_code_mode "replace" (ClickFunnels "append" stored a
 * pushed tag twice), then reads it back and fails unless it matches what was sent.
 */
async function pushBuilderFooter(creds, pageId, row, ctx, dryRun, snapDir) {
  let liveFoot;
  try {
    liveFoot = await getPageCode(creds, pageId, "footer_code", ctx);
  } catch {
    liveFoot = null;
  }
  const liveHtml = await fetchLiveHtml(row.liveUrl, ctx);
  if (liveFoot === null || !liveHtml) {
    return {
      ok: false,
      skipped: true,
      reason: "live_page_unreadable",
      detail: liveFoot === null ? "footer_code not returned by the API" : "public page not readable as a ClickFunnels page",
      live_html_read: Boolean(liveHtml),
    };
  }
  let liveHead = "";
  try {
    liveHead = await getPageCode(creds, pageId, "head_code", ctx);
  } catch {
    return {
      ok: false,
      skipped: true,
      reason: "live_page_unreadable",
      detail: "head_code not returned by the API",
      live_html_read: true,
    };
  }
  let funnelHead = "";
  let funnelHeadRead = false;
  if (row.funnelId) {
    try {
      funnelHead = await getFunnelHead(creds, row.funnelId, ctx);
      funnelHeadRead = true;
    } catch {
      funnelHeadRead = false;
    }
  }
  mkdirSync(snapDir, { recursive: true });
  const snapshot = join(snapDir, `page-${pageId}-footer_code.html`);
  writeFileSync(snapshot, liveFoot, "utf8");
  const headSnapshot = join(snapDir, `page-${pageId}-head_code.html`);
  writeFileSync(headSnapshot, liveHead, "utf8");
  const plan = nextFooterCode(liveFoot, {
    includeVslBeacon: !!row.vslBeacon,
    extraSrcs: row.extraFooterScripts ?? [],
    dropSrcs: row.dropFooterScripts ?? [],
    existing: liveHtml,
    // Marked inline blocks (apply-book: fh-book-confirm) go out in this same replace write.
    blocks: (row.footerBlocks ?? []).map((b) => ({ block: readFragment(b.fragment), marker: b.marker })),
  });
  // No funnel head read means we do not know if the pixel already loads once.
  // Leave the page head alone rather than strip the only copy.
  const headPlan = funnelHeadRead ? nextHeadCode(liveHead, { funnelHead }) : { next: liveHead, changed: false };
  const base = {
    live_html_read: true,
    snapshot: snapshot.slice(ROOT.length + 1),
    head_snapshot: headSnapshot.slice(ROOT.length + 1),
    would_append_footer_srcs: plan.added,
    collapsed_duplicate_srcs: plan.collapsed,
    footer_blocks: plan.blocks,
    head_changed: headPlan.changed,
    funnel_head_read: funnelHeadRead,
  };
  if (!plan.changed && !headPlan.changed) {
    return { ok: true, pageId, ...base, skipped: true, reason: "footer_already_right" };
  }
  if (dryRun) return { ok: true, dryRun: true, pageId, ...base };
  const page = {};
  if (plan.changed) {
    page.footer_code = plan.next;
    page.footer_code_mode = "replace";
  }
  if (headPlan.changed) {
    page.head_code = headPlan.next;
    page.head_code_mode = "replace";
  }
  await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}`,
    apiKey: creds.api_key,
    ctx,
    method: "PUT",
    body: JSON.stringify({ page }),
  });
  const after = plan.changed ? await getPageCode(creds, pageId, "footer_code", ctx) : liveFoot;
  const afterHead = headPlan.changed ? await getPageCode(creds, pageId, "head_code", ctx) : liveHead;
  const verified =
    (!plan.changed || after.trim() === plan.next.trim()) &&
    (!headPlan.changed || afterHead.trim() === headPlan.next.trim());
  return {
    ok: verified,
    pageId,
    ...base,
    verified,
    code_length_before: liveFoot.length,
    code_length_after: after.length,
    head_length_before: liveHead.length,
    head_length_after: afterHead.length,
  };
}

async function putCustomHtml(creds, pageId, html, ctx, dryRun) {
  if (dryRun) {
    return { ok: true, dryRun: true, pageId, mode: "custom_html_put" };
  }
  const { body } = await cfApi({
    url: `${baseUrl(creds.subdomain)}/pages/${pageId}`,
    apiKey: creds.api_key,
    ctx,
    method: "PUT",
    body: JSON.stringify({ page: { custom_html: html } }),
  });
  return { ok: true, pageId, body };
}

async function createCustomHtmlPage(creds, workspaceId, opts, ctx, dryRun) {
  if (dryRun) {
    return { ok: true, dryRun: true, mode: "custom_html_create", name: opts.name };
  }
  const { body } = await cfApi({
    url: `${baseUrl(creds.subdomain)}/workspaces/${workspaceId}/pages/custom_html`,
    apiKey: creds.api_key,
    ctx,
    method: "POST",
    body: JSON.stringify({ page: opts }),
  });
  return { ok: true, body };
}

async function snapshotCustomHtml(creds, pageId, ctx, outDir) {
  try {
    const { body } = await cfApi({
      url: `${baseUrl(creds.subdomain)}/pages/${pageId}/custom_html`,
      apiKey: creds.api_key,
      ctx,
    });
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `page-${pageId}-custom-html.html`);
    writeFileSync(file, body.custom_html ?? "", "utf8");
    return file;
  } catch {
    return null;
  }
}

async function cmdList(creds) {
  const ctx = {};
  const workspaceId = await resolveWorkspaceId(creds, ctx);
  console.log(
    JSON.stringify(
      {
        auth: creds.source,
        subdomain: creds.subdomain,
        workspace_id: workspaceId,
        pages: await listPages(creds, workspaceId, ctx),
      },
      null,
      2,
    ),
  );
}

function redactSecret(text, secret) {
  const raw = String(text ?? "");
  if (!secret) return raw.slice(0, 300);
  return raw.split(secret).join("[redacted]").slice(0, 300);
}

/** Push-time only. The fragment in git never contains the ingest secret. */
function injectApplySurveyRuntime(html, { secret, pixelId, pageToken }) {
  let out = html;
  const head = [];
  if (pageToken && !out.includes("cf-page-token")) {
    head.push(
      `<meta name="cf-page-token" content="${String(pageToken).replace(/"/g, "&quot;")}">`,
    );
    head.push('<script src="https://sdk.myclickfunnels.com/sdk.js" defer></script>');
  }
  if (pixelId && !out.includes("fbq('init'")) head.push(metaPixelHeadHtml(pixelId));
  if (secret && !out.includes("window.FH_APPLY_SURVEY_INGEST=")) {
    head.push(`<script>window.FH_APPLY_SURVEY_INGEST=${JSON.stringify(secret)};</script>`);
  }
  if (!out.includes("googletagmanager.com/gtag/js")) {
    const ga = ga4HeadHtml(process.env);
    if (ga) head.push(ga);
  }
  if (head.length) {
    const block = head.join("\n");
    if (out.includes("</head>")) out = out.replace("</head>", `${block}\n</head>`);
    else out = `${block}\n${out}`;
  }
  if (!hasScriptSrc(out, FH_ATTRIBUTION_SRC)) {
    const tag = `<script src="${FH_ATTRIBUTION_SRC}"></script>`;
    if (out.includes("</body>")) out = out.replace("</body>", `${tag}\n</body>`);
    else out = `${out}\n${tag}`;
  }
  // Step opens + button presses, and Clarity, on the /watch path's survey step.
  const more = [];
  if (!hasScriptSrc(out, FH_EVENTS_SRC)) more.push(`<script src="${FH_EVENTS_SRC}"></script>`);
  if (!hasScriptSrc(out, CLARITY_SRC) && String(process.env.CLARITY_PROJECT_ID ?? "").trim()) {
    more.push(footerScriptTag(CLARITY_SRC, { defer: true }));
  }
  if (more.length) {
    const tags = more.join("\n");
    if (out.includes("</body>")) out = out.replace("</body>", `${tags}\n</body>`);
    else out = `${out}\n${tags}`;
  }
  return out;
}

async function pageOnApplyStep(creds, workspaceId, ctx) {
  const pages = await listPages(creds, workspaceId, ctx);
  const mine = pages.filter((p) => p.funnel_name === "Fundhub Funnel");
  for (const p of mine) {
    const body = await getPage(creds, p.id, ctx);
    const step = body && body.show_page_step;
    if (step && step.current_path === "/apply") return body;
  }
  return null;
}

function ensureScriptTags(html, srcs) {
  let out = String(html ?? "");
  const added = [];
  for (const src of srcs) {
    if (hasScriptSrc(out, src)) continue;
    const tag = footerScriptTag(src, { defer: src === CLARITY_SRC });
    if (out.includes("</body>")) out = out.replace("</body>", `${tag}\n</body>`);
    else out = `${out}\n${tag}`;
    added.push(src);
  }
  return { html: out, added };
}

async function pushApplySurveyReplace(creds, workspaceId, row, ctx, dryRun) {
  const secret = String(process.env.CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET ?? "").trim();
  if (!secret) {
    return { ok: false, error: "CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET missing" };
  }
  const pixel = metaPixelId(process.env);
  const baseHtml = readFragment(row.fragment);
  const marker = 'data-fh-apply-survey="1"';
  const current = await pageOnApplyStep(creds, workspaceId, ctx);
  let existing = "";
  if (current && (await isCustomHtmlPage(creds, current.id, ctx))) {
    existing = await getCustomHtml(creds, current.id, ctx);
  }
  const build = (token) =>
    injectApplySurveyRuntime(baseHtml, { secret, pixelId: pixel.id, pageToken: token });

  if (current && existing.includes(marker)) {
    const want = [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC];
    if (String(process.env.CLARITY_PROJECT_ID ?? "").trim()) want.push(CLARITY_SRC);
    const patched = ensureScriptTags(existing, want);
    // A comment that names the file used to count as "already there", so /apply
    // shipped with no attribution script. Add the missing tag only. Do not
    // rebuild the survey (that would rewrite the page).
    if (patched.added.length) {
      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          mode: "custom_html_script_ensure",
          pageId: current.id,
          added: patched.added,
        };
      }
      const snapDir = join(ROOT, "ops/workflows/cf-push-snapshots");
      await snapshotCustomHtml(creds, current.id, ctx, snapDir);
      await putCustomHtml(creds, current.id, patched.html, ctx, false);
      return {
        ok: true,
        mode: "custom_html_script_ensure",
        pageId: current.id,
        added: patched.added,
      };
    }
    const token = current.sdk && current.sdk.token;
    const html = build(token);
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        mode: "custom_html_put",
        pageId: current.id,
        bytes: html.length,
        has_ingest: html.includes("window.FH_APPLY_SURVEY_INGEST="),
        has_attribution: html.includes("fh-attribution.js"),
        has_pixel: html.includes("fbq('init'"),
      };
    }
    await putCustomHtml(creds, current.id, html, ctx, false);
    return {
      ok: true,
      mode: "custom_html_put",
      pageId: current.id,
      bytes: html.length,
      has_ingest: true,
      has_attribution: html.includes("fh-attribution.js"),
    };
  }

  const stepId = row.showPageStepId || (current && current.show_page_step && current.show_page_step.public_id);
  if (!stepId) return { ok: false, error: "apply_show_page_step_missing" };
  const first = build(null);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode: "custom_html_create",
      showPageStepId: stepId,
      bytes: first.length,
      has_ingest: first.includes("window.FH_APPLY_SURVEY_INGEST="),
      has_attribution: first.includes("fh-attribution.js"),
      current_page_id: current ? current.id : null,
    };
  }
  let created;
  try {
    created = await createCustomHtmlPage(
      creds,
      workspaceId,
      {
        name: "Apply",
        description: "Custom apply survey",
        custom_html: first,
        current_path: "/apply",
        funnel: { show_page_step_id: stepId },
      },
      ctx,
      false,
    );
  } catch (err) {
    return { ok: false, error: redactSecret(err.message, secret), status: err.status ?? null };
  }
  const body = created.body && created.body.page ? created.body.page : created.body;
  const newId = body && (body.id || body.public_id);
  const token = body && body.sdk && body.sdk.token;
  if (newId && token) {
    try {
      await putCustomHtml(creds, newId, build(token), ctx, false);
    } catch (err) {
      return {
        ok: false,
        error: redactSecret(err.message, secret),
        pageId: newId,
        mode: "custom_html_create",
        token_put_failed: true,
      };
    }
  }
  return {
    ok: true,
    mode: "custom_html_create",
    pageId: newId || null,
    showPageStepId: stepId,
    sdk_token: Boolean(token),
    bytes: first.length,
  };
}

/** The page on a funnel step, found by the step's path (the page id changes when a step is swapped). */
async function pageOnStep(creds, workspaceId, funnelName, stepPath, ctx) {
  const pages = await listPages(creds, workspaceId, ctx);
  for (const p of pages.filter((x) => x.funnel_name === funnelName)) {
    const body = await getPage(creds, p.id, ctx);
    if (body?.show_page_step?.current_path === stepPath) return body;
  }
  return null;
}

/**
 * Whole-step custom HTML page built from one fragment. A custom page gets no funnel
 * head code, so the pixel, Direct ROAS and every footer script ride inside the document.
 * First run: the step holds a builder page, so a custom page is made on the same step
 * (the builder page is left in place, never deleted). Later runs: PUT the same page.
 */
function buildStepDocument(row, pageToken, pixelId) {
  let body = readFragment(row.fragment);
  const headClarity = Boolean(String(process.env.CLARITY_PROJECT_ID ?? "").trim());
  for (const src of [FH_ATTRIBUTION_SRC, ...(row.extraFooterScripts ?? [])]) {
    if (src === CLARITY_SRC && headClarity) continue;
    if (!hasScriptSrc(body, src)) body += `\n${footerScriptTag(src, { defer: DEFER_FOOTER_SRCS.has(src) })}`;
  }
  const html = wrapCustomHtmlDocument({
    bodyHtml: body,
    pageToken,
    pixelId,
    includeVslBeacon: !!row.vslBeacon,
    headFirstHtml: [directRoasHeadHtml(process.env), headBlocksHtml(row, readFragment)].filter(Boolean).join("\n"),
    env: process.env,
  });
  return row.title ? html.replace("<title>Fundhub</title>", `<title>${row.title}</title>`) : html;
}

async function pushCustomHtmlStep(creds, workspaceId, row, pixelId, ctx, dryRun, snapDir) {
  const current = await pageOnStep(creds, workspaceId, row.funnelName, row.stepPath, ctx);
  if (!current) return { ok: false, error: "step_page_not_found" };
  const stepId = current.show_page_step.public_id;
  if (current.custom_html_page) {
    const html = buildStepDocument(row, current.sdk?.token, pixelId);
    if (!dryRun) await snapshotCustomHtml(creds, current.id, ctx, snapDir);
    const r = await putCustomHtml(creds, current.id, html, ctx, dryRun);
    return { ...r, mode: "custom_html_put", pageId: current.id, bytes: html.length };
  }
  const first = buildStepDocument(row, null, pixelId);
  if (dryRun) {
    return { ok: true, dryRun: true, mode: "custom_html_create", replaces_builder_page: current.id, showPageStepId: stepId, bytes: first.length };
  }
  const created = await createCustomHtmlPage(
    creds,
    workspaceId,
    { name: row.title || row.key, description: `Custom HTML ${row.stepPath}`, custom_html: first, current_path: row.stepPath, funnel: { show_page_step_id: stepId } },
    ctx,
    false,
  );
  const body = created.body?.page ?? created.body;
  const newId = body?.id;
  const token = body?.sdk?.token;
  if (newId && token) await putCustomHtml(creds, newId, buildStepDocument(row, token, pixelId), ctx, false);
  return { ok: Boolean(newId), mode: "custom_html_create", pageId: newId ?? null, replaced_builder_page: current.id, showPageStepId: stepId, sdk_token: Boolean(token) };
}

async function cmdPush(creds, { dryRun = false, only = null } = {}) {
  const ctx = {};
  const workspaceId = await resolveWorkspaceId(creds, ctx);
  const pixel = metaPixelId(process.env);
  const pages = await listPages(creds, workspaceId, ctx);
  const byPath = new Map(
    pages.filter((p) => p.current_path).map((p) => [p.current_path, p]),
  );
  const byId = new Map(pages.map((p) => [String(p.id), p]));

  const results = [];
  const snapDir = join(ROOT, "ops/workflows/cf-push-snapshots");

  for (const row of PUSH_MANIFEST) {
    if (only && row.key !== only) continue;
    if (row.strategy === "apply_survey_replace") {
      try {
        const r = await pushApplySurveyReplace(creds, workspaceId, row, ctx, dryRun);
        if (!r.ok) process.exitCode = 1;
        results.push({
          key: row.key,
          liveUrl: row.liveUrl,
          mode: "apply_survey_replace",
          ...r,
        });
      } catch (err) {
        process.exitCode = 1;
        const secret = String(process.env.CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET ?? "").trim();
        results.push({
          key: row.key,
          liveUrl: row.liveUrl,
          ok: false,
          error: redactSecret(err.message, secret),
        });
      }
      continue;
    }
    if (row.strategy === "custom_html_step") {
      const r = await pushCustomHtmlStep(creds, workspaceId, row, pixel.id, ctx, dryRun, snapDir);
      if (!r.ok) process.exitCode = 1;
      results.push({ key: row.key, liveUrl: row.liveUrl, pixel_env: pixel.envName, ...r });
      continue;
    }
    if (row.strategy === "funnel_head_pixel") {
      const r = await pushFunnelHeadPixel(creds, row, pixel.id, ctx, dryRun, snapDir);
      if (!r.ok) process.exitCode = 1;
      results.push({ key: row.key, liveUrl: row.liveUrl, mode: "funnel_head_pixel", pixel_env: pixel.envName, ...r });
      continue;
    }
    if (!row.path && !row.pageId) {
      results.push({ key: row.key, skipped: true, reason: "no_path_map_yet" });
      continue;
    }
    const page =
      (row.pageId && byId.get(String(row.pageId))) || (row.path && byPath.get(row.path));
    if (!page) {
      results.push({ key: row.key, path: row.path, pageId: row.pageId, error: "page_not_found" });
      continue;
    }

    if (row.strategy === "code_block_upsert") {
      const r = await upsertCodeBlock(creds, page.id, row, ctx, dryRun, snapDir);
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        mode: "code_block_upsert",
        calendar_safe: true,
        ...r,
      });
      continue;
    }

    if (row.strategy === "custom_html_inject_only") {
      await snapshotCustomHtml(creds, page.id, ctx, snapDir);
      const existing = await getCustomHtml(creds, page.id, ctx);
      const head = trackingHeadScripts({
        skipMeta: existing.includes("fbq('init'"),
        skipDirectRoas: existing.includes("directroas.com"),
        skipGa4: existing.includes("googletagmanager.com/gtag/js"),
        env: process.env,
      });
      const foot = trackingFooterScripts({
        includeVslBeacon: !!row.vslBeacon,
        skipAttribution: existing.includes("fh-attribution.js"),
        extraSrcs: row.extraFooterScripts ?? [],
        existing,
      });
      const html = injectIntoCustomHtmlDocument(existing, { headBits: head, footBits: foot });
      const r = await putCustomHtml(creds, page.id, html, ctx, dryRun);
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        mode: "custom_html_inject_only",
        pixel_env: pixel.envName,
        ...r,
      });
      continue;
    }

    // Native calendar step with footer scripts to add: send the whole footer in replace
    // mode (append stored a tag twice on 2026-09-22). Body and calendar are never touched.
    if (row.strategy === "head_footer_append_only" && row.extraFooterScripts?.length) {
      const r = await pushBuilderFooter(creds, page.id, row, ctx, dryRun, snapDir);
      if (!r.ok) process.exitCode = 1;
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        calendar_safe: true,
        pixel_env: pixel.envName,
        ...r,
        mode: "builder_page_tracking_inject_only",
      });
      continue;
    }

    if (DO_NOT_FULL_REPLACE_PATHS.has(row.path) || row.strategy === "head_footer_append_only") {
      const livePage = await getPage(creds, page.id, ctx);
      const liveHead = String(livePage.head_code ?? "");
      const liveFoot = String(livePage.footer_code ?? "");
      const liveHasAttr =
        liveHead.includes("fh-attribution.js") || liveFoot.includes("fh-attribution.js");
      const liveHasMeta = liveHead.includes("fbq('init'") || liveFoot.includes("fbq('init'");
      const head = trackingHeadScripts({
        skipMeta: liveHasMeta,
        skipDirectRoas: liveHead.includes("directroas.com") || liveFoot.includes("directroas.com"),
        skipGa4: liveHead.includes("googletagmanager.com/gtag/js") || liveFoot.includes("googletagmanager.com/gtag/js"),
        env: process.env,
      });
      const foot = trackingFooterScripts({
        includeVslBeacon: !!row.vslBeacon,
        skipAttribution: liveHasAttr,
        extraSrcs: row.extraFooterScripts ?? [],
        existing: `${liveHead}\n${liveFoot}`,
      });
      await snapshotCustomHtml(creds, page.id, ctx, snapDir);
      const r = await appendHeadFooter(creds, page.id, head, foot, ctx, dryRun);
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        mode: "inject_head_footer_only",
        calendar_safe: true,
        pixel_env: pixel.envName,
        ...r,
      });
      continue;
    }

    const bodyHtml = row.fragment ? readFragment(row.fragment) : "";
    // The CF SDK shows a "NO_PAGE_META ERROR" badge on the live page without this token.
    const sdkToken = (await getPage(creds, page.id, ctx))?.sdk?.token;
    const html = wrapCustomHtmlDocument({
      bodyHtml,
      pageToken: sdkToken,
      pixelId: pixel.id,
      includeVslBeacon: !!row.vslBeacon,
      headFirstHtml: headBlocksHtml(row, readFragment),
      env: process.env,
    });

    await snapshotCustomHtml(creds, page.id, ctx, snapDir);
    const custom = await isCustomHtmlPage(creds, page.id, ctx);
    if (custom) {
      const r = await putCustomHtml(creds, page.id, html, ctx, dryRun);
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        mode: "custom_html_put",
        pixel_env: pixel.envName,
        ...r,
      });
    } else {
      const r = await pushBuilderFooter(creds, page.id, row, ctx, dryRun, snapDir);
      if (!r.ok) process.exitCode = 1;
      results.push({
        key: row.key,
        page_id: page.id,
        path: row.path,
        liveUrl: row.liveUrl,
        note: "Not a custom HTML page — footer code sent whole (replace), owned scripts kept to one copy; fragment body unchanged",
        pixel_env: pixel.envName,
        ...r,
        mode: "builder_page_tracking_inject_only",
      });
    }
  }

  console.log(JSON.stringify({ auth: creds.source, workspace_id: workspaceId, results }, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const onlyArg = rest.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  if (!cmd || !["list", "push"].includes(cmd)) {
    console.error("Usage: node scripts/cf-push-custom-html.mjs list|push [--dry-run] [--only=key]");
    process.exit(1);
  }

  const creds = await resolveCreds();
  if (!creds?.api_key) {
    console.error(
      JSON.stringify({
        error: "auth_missing",
        need_env: "CLICKFUNNELS_API_KEY",
        also: ["CLICKFUNNELS_SUBDOMAIN", "analytics_connections (clickfunnels)"],
      }),
    );
    process.exit(2);
  }

  if (cmd === "list") await cmdList(creds);
  else await cmdPush(creds, { dryRun, only });
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, status: err.status ?? null }));
  process.exit(1);
});
