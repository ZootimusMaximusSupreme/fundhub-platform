// CRM screen links and the records those screens should show.
// Read only. Never texts. Never charges. Never pulls credit.
// Recon (AG-07) stays the only tripwire. This is not a second watchdog.
//
// The morning desk ping already GETs the four screens and treats an API 401
// as up. It does not read the JSON, and it does not notice an href that is
// not on that list. This check does.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = path.resolve(HERE, "../../../public/app");
const DEFAULT_PUBLIC_DIR = path.resolve(HERE, "../../../public");

export const SCREEN_FILES = Object.freeze([
  "pipeline.html",
  "client-control-panel.html",
  "closer-dashboard.html",
  "sales-floor.html"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK_TOKEN = /(?:href\s*=\s*|location\.href\s*=\s*|\.href\s*=\s*|window\.open\(\s*)["']([^"']+)["']/gi;
const QUOTED_PAGE = /["']((?:\/app\/|https?:\/\/[^"'/]+\/app\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.html(?:\?[^"']*)?)["']/gi;

function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function row(id, status, detail, suggestedFix = null) {
  return {
    id,
    status,
    detail: clip(detail, 500),
    suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null
  };
}

/** A relative or /app/ page name. External sites and hashes are not app links. */
export function appPageFile(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s.startsWith("#") || /^mailto:/i.test(s) || /^javascript:/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();
      if (host !== "fundhub.ai" && host !== "www.fundhub.ai" && host !== "localhost") return null;
      s = u.pathname;
    } catch {
      return null;
    }
  }
  s = s.split("#")[0].split("?")[0];
  if (!s || s.includes("..")) return null;
  if (s.startsWith("/app/")) s = s.slice("/app/".length);
  else if (s.startsWith("/")) return null;
  else if (s.includes("/")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*\.html$/i.test(s)) return null;
  return s;
}

/** Page files an HTML or script blob links to, with the source name kept. */
export function extractAppLinks(text, sourceName = "screen") {
  const found = new Map();
  const blobs = [String(text || "")];
  for (const blob of blobs) {
    for (const re of [LINK_TOKEN, QUOTED_PAGE]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(blob))) {
        const file = appPageFile(match[1]);
        if (!file) continue;
        if (!found.has(file)) found.set(file, new Set());
        found.get(file).add(sourceName);
      }
    }
  }
  return found;
}

function readSources(appDir) {
  const out = [];
  const seen = new Set();
  for (const name of SCREEN_FILES) {
    const full = path.join(appDir, name);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    out.push({ name, text });
    seen.add(name);
    for (const match of text.matchAll(/<script\s+src="([^"]+\.js)"/gi)) {
      const src = match[1];
      if (!src || src.includes("://") || src.startsWith("/") || src.includes("..")) continue;
      const base = path.basename(src);
      if (seen.has(base)) continue;
      const jsPath = path.join(appDir, base);
      if (!fs.existsSync(jsPath)) continue;
      seen.add(base);
      out.push({ name: base, text: fs.readFileSync(jsPath, "utf8") });
    }
  }
  return out;
}

function linksFromSources(sources) {
  const found = new Map();
  for (const source of sources || []) {
    const part = extractAppLinks(source.text, source.name || "screen");
    for (const [file, names] of part) {
      if (!found.has(file)) found.set(file, new Set());
      for (const name of names) found.get(file).add(name);
    }
  }
  return found;
}

function deskList() {
  return new Set(PULSE_REGISTRY.map((item) => coverageKey(item)));
}

function orgUuid(orgId) {
  const s = String(orgId || "").trim();
  return UUID_RE.test(s) ? s : null;
}

function withOrg(sql, orgId, column) {
  if (!orgId) return sql;
  const limit = sql.match(/\s+LIMIT\s+\d+\s*$/i);
  const base = limit ? sql.slice(0, limit.index) : sql;
  const glue = /\bWHERE\b/i.test(base) ? " AND " : " WHERE ";
  return `${base}${glue}${column} = $1::uuid${limit ? limit[0] : ""}`;
}

async function ask(db, sql, params) {
  try {
    const out = await db.query(sql, params);
    return { rows: (out && out.rows) || [] };
  } catch (err) {
    return { error: clip(err && err.message, 160) };
  }
}

function countOf(result) {
  if (!result || result.error) return null;
  const n = Number(result.rows[0] && result.rows[0].n);
  return Number.isFinite(n) ? n : null;
}

async function loadFacts(db, orgId) {
  if (!db || typeof db.query !== "function") return null;
  const params = orgId ? [orgId] : [];
  const clientIdSql = withOrg(
    "SELECT id FROM clients WHERE COALESCE(is_demo, false) = false LIMIT 1",
    orgId,
    "org_id"
  );
  const clientCountSql = withOrg(
    "SELECT count(*)::int AS n FROM clients WHERE COALESCE(is_demo, false) = false",
    orgId,
    "org_id"
  );
  const stageSql = withOrg(
    "SELECT count(*)::int AS n FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.key = 'sales'",
    orgId,
    "p.org_id"
  );
  const pipelineSql = withOrg(
    "SELECT count(*)::int AS n FROM pipelines WHERE key = 'sales'",
    orgId,
    "org_id"
  );
  const docSql = withOrg(
    "SELECT count(*)::int AS n FROM documents",
    orgId,
    "org_id"
  );
  const lenderSql = withOrg(
    "SELECT count(*)::int AS n FROM lenders",
    orgId,
    "org_id"
  );
  const logoSql = withOrg(
    "SELECT DISTINCT logo_path FROM lenders WHERE logo_path IS NOT NULL AND btrim(logo_path) <> ''",
    orgId,
    "org_id"
  );
  const [clientId, clientCount, stages, pipelines, docs, lenders, logos] = await Promise.all([
    ask(db, clientIdSql, params),
    ask(db, clientCountSql, params),
    ask(db, stageSql, params),
    ask(db, pipelineSql, params),
    ask(db, docSql, params),
    ask(db, lenderSql, params),
    ask(db, logoSql, params)
  ]);
  const idRaw = clientId && !clientId.error && clientId.rows[0] && clientId.rows[0].id;
  const id = UUID_RE.test(String(idRaw || "")) ? String(idRaw) : null;
  return {
    clientId: id,
    clientIdError: clientId && clientId.error,
    clientCount: countOf(clientCount),
    clientCountError: clientCount && clientCount.error,
    stageCount: countOf(stages),
    stageError: stages && stages.error,
    pipelineCount: countOf(pipelines),
    pipelineError: pipelines && pipelines.error,
    docCount: countOf(docs),
    docError: docs && docs.error,
    lenderCount: countOf(lenders),
    lenderError: lenders && lenders.error,
    logos: logos && !logos.error ? logos.rows.map((r) => r && r.logo_path).filter(Boolean) : [],
    logoError: logos && logos.error
  };
}

async function readUrl(fetchImpl, url, headers) {
  const res = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html,application/json", ...(headers || {}) },
    signal: AbortSignal.timeout(15000)
  });
  const status = res && res.status;
  let text = "";
  if (res && typeof res.text === "function") text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status, body, text };
}

function httpDead(status) {
  return status === 404 || status >= 500;
}

function locked(status) {
  return status === 401 || status === 403;
}

async function checkPageLinks(ctx, links) {
  const appDir = ctx.appDir || DEFAULT_APP_DIR;
  const base = String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const watched = deskList();
  const fails = [];
  const files = [...links.keys()].sort();
  for (const file of files) {
    const from = [...(links.get(file) || [])].sort().join(", ") || "a CRM screen";
    const onDisk = fs.existsSync(path.join(appDir, file));
    const onList = watched.has(file);
    let live = null;
    if (typeof ctx.fetchImpl === "function") {
      try {
        live = await readUrl(ctx.fetchImpl, `${base}/app/${file}`, ctx.headers);
      } catch (err) {
        fails.push(row(
          `crm-link:${file}`,
          "FAIL",
          `${from} links to ${file}, and the GET did not answer: ${clip(err && err.message, 120)}`,
          `Fix the link to ${file} on ${from}. Do not auto-fix from this pulse.`
        ));
        continue;
      }
    }
    const deadLive = live && httpDead(live.status);
    if (!onDisk || deadLive) {
      const why = !onDisk
        ? `${file} is not in public/app`
        : `GET /app/${file} answered ${live.status}`;
      const watchedNote = onList
        ? " The morning desk list already names this file."
        : " This file is not on the morning desk list.";
      fails.push(row(
        `crm-link:${file}`,
        "FAIL",
        `${from} links to ${file}. ${why}.${watchedNote}`,
        `Fix the link to ${file} on ${from}. Do not auto-fix from this pulse.`
      ));
    }
  }
  if (fails.length) return fails;
  const watchedN = files.filter((file) => watched.has(file)).length;
  const liveNote = typeof ctx.fetchImpl === "function"
    ? "Live GET returned no 404 or 500."
    : "Live GET was not run. The files are on disk.";
  return [row(
    "crm-links:pages",
    "PASS",
    files.length
      ? `${files.length} internal /app links on the pipeline, client control panel, closer dashboard, and sales floor resolve. ${watchedN} are already on the morning desk list. ${liveNote}`
      : "No internal /app page links were found on the CRM screens passed in."
  )];
}

function sameOriginLogo(logoPath) {
  const raw = String(logoPath || "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const clean = raw.split("#")[0].split("?")[0];
  if (clean.includes("..")) return { bad: true, path: clean };
  if (clean.startsWith("/assets/lenders/")) return { bad: false, path: clean, rel: clean.slice(1) };
  if (clean.startsWith("assets/lenders/")) {
    return { bad: true, path: clean, rel: clean, relative: true };
  }
  return null;
}

function logoFileExists(ctx, spec) {
  if (typeof ctx.logoExists === "function") return ctx.logoExists(spec.path);
  const publicDir = ctx.publicDir || DEFAULT_PUBLIC_DIR;
  const full = path.resolve(publicDir, spec.rel);
  const root = path.resolve(publicDir);
  if (full !== root && !full.startsWith(root + path.sep)) return false;
  return fs.existsSync(full);
}

function checkLogos(ctx, facts) {
  if (!facts) {
    return row("crm-links:bank-logos", "skip", "no database in this run — bank logo paths not read");
  }
  if (facts.logoError) {
    return row("crm-links:bank-logos", "skip", `could not read bank logo paths (${facts.logoError})`);
  }
  const paths = facts.logos || [];
  if (!paths.length) {
    return row("crm-links:bank-logos", "skip", "no bank logo paths on file");
  }
  const missing = [];
  let sameOrigin = 0;
  let external = 0;
  for (const logoPath of paths) {
    const spec = sameOriginLogo(logoPath);
    if (!spec) {
      if (/^https?:\/\//i.test(String(logoPath))) external += 1;
      continue;
    }
    sameOrigin += 1;
    if (spec.bad || !logoFileExists(ctx, spec)) missing.push(spec.path);
  }
  if (!sameOrigin && external) {
    return row(
      "crm-links:bank-logos",
      "PASS",
      `${external} bank logo path${external === 1 ? "" : "s"} point off this site. None are /assets/lenders files to check.`
    );
  }
  if (!sameOrigin) {
    return row("crm-links:bank-logos", "skip", "no same-origin bank logo paths on file");
  }
  if (missing.length) {
    const shown = missing.slice(0, 8).join(", ");
    const more = missing.length > 8 ? ` and ${missing.length - 8} more` : "";
    return row(
      "crm-links:bank-logos",
      "FAIL",
      `${missing.length} bank logo${missing.length === 1 ? "" : "s"} on the client control panel do not resolve: ${shown}${more}`,
      "Put the logo file under public/assets/lenders or point the bank at /assets/lenders/placeholder.svg. Do not auto-fix from this pulse."
    );
  }
  return row(
    "crm-links:bank-logos",
    "PASS",
    `${sameOrigin} bank logo path${sameOrigin === 1 ? "" : "s"} resolve under public/assets/lenders.`
  );
}

async function checkJson(ctx, id, urlPath, judge) {
  if (typeof ctx.fetchImpl !== "function") {
    return row(id, "skip", "no fetch in this run — record not read");
  }
  const base = String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  let http;
  try {
    http = await readUrl(ctx.fetchImpl, `${base}${urlPath}`, ctx.headers);
  } catch (err) {
    return row(
      id,
      "FAIL",
      `GET ${urlPath} did not answer: ${clip(err && err.message, 120)}`,
      `Restore GET ${urlPath}. Do not auto-fix from this pulse.`
    );
  }
  if (locked(http.status)) {
    return row(
      id,
      "skip",
      `GET ${urlPath} answered ${http.status} without a staff session. The morning ping already treats that as up.`
    );
  }
  if (http.status >= 400) {
    return row(
      id,
      "FAIL",
      `GET ${urlPath} answered ${http.status}`,
      `Restore GET ${urlPath}. The screen should show a record. Do not auto-fix from this pulse.`
    );
  }
  return judge(http);
}

async function checkReads(ctx, facts) {
  const id = facts && facts.clientId;
  const out = [];

  out.push(await checkJson(ctx, "crm-data:pipeline", "/api/dashboard/pipeline?key=sales", (http) => {
    const stages = http.body && http.body.stages;
    const empty = !http.body || http.body.ok === false || !Array.isArray(stages) || stages.length === 0;
    const expected = facts && facts.stageCount;
    if (facts && facts.stageError && empty) {
      return row("crm-data:pipeline", "skip", `pipeline read was empty and stage count could not be read (${facts.stageError})`);
    }
    if (expected == null) {
      if (!empty) {
        return row("crm-data:pipeline", "PASS", `sales board read answered ${http.status} with ${stages.length} columns`);
      }
      return row("crm-data:pipeline", "skip", "sales board read was empty and there is no database to show that columns should be there");
    }
    if (expected > 0 && empty) {
      return row(
        "crm-data:pipeline",
        "FAIL",
        `sales board should show ${expected} columns and the read came back empty`,
        "Open Pipeline. Restore GET /api/dashboard/pipeline?key=sales so the columns show. Do not auto-fix from this pulse."
      );
    }
    if (empty) {
      return row("crm-data:pipeline", "PASS", "no sales columns on file, and the read is empty");
    }
    return row("crm-data:pipeline", "PASS", `sales board read answered ${http.status} with ${stages.length} columns`);
  }));

  out.push(await checkJson(ctx, "crm-data:pipeline-counts", "/api/dashboard/pipeline-counts", (http) => {
    const counts = http.body && http.body.counts;
    const sales = counts && Object.prototype.hasOwnProperty.call(counts, "sales") ? counts.sales : null;
    const hasSales = sales != null && Number.isFinite(Number(sales));
    const expected = facts && facts.pipelineCount;
    if (facts && facts.pipelineError && !hasSales) {
      return row("crm-data:pipeline-counts", "skip", `pipeline counts omitted sales and the pipeline row could not be read (${facts.pipelineError})`);
    }
    if (expected == null) {
      if (hasSales) return row("crm-data:pipeline-counts", "PASS", `pipeline counts include sales=${Number(sales)}`);
      return row("crm-data:pipeline-counts", "skip", "pipeline counts omitted sales and there is no database to show the sales rail should be there");
    }
    if (expected > 0 && !hasSales) {
      return row(
        "crm-data:pipeline-counts",
        "FAIL",
        "the sales rail is on file and GET /api/dashboard/pipeline-counts left it out",
        "Restore GET /api/dashboard/pipeline-counts so the Pipeline tabs show a number. Do not auto-fix from this pulse."
      );
    }
    if (!hasSales) return row("crm-data:pipeline-counts", "PASS", "no sales pipeline on file, and the counts omit it");
    return row("crm-data:pipeline-counts", "PASS", `pipeline counts include sales=${Number(sales)}`);
  }));

  out.push(await checkJson(ctx, "crm-data:clients", "/api/dashboard/clients", (http) => {
    const list = http.body && http.body.clients;
    const empty = !http.body || http.body.ok === false || !Array.isArray(list) || list.length === 0;
    const expected = facts && facts.clientCount;
    if (facts && facts.clientCountError && empty) {
      return row("crm-data:clients", "skip", `client list was empty and the count could not be read (${facts.clientCountError})`);
    }
    if (expected == null) {
      if (!empty) return row("crm-data:clients", "PASS", `client list answered ${http.status} with ${list.length} people`);
      return row("crm-data:clients", "skip", "client list was empty and there is no database to show that a person should be there");
    }
    if (expected > 0 && empty) {
      const people = expected === 1 ? "1 client is" : `${expected} clients are`;
      return row(
        "crm-data:clients",
        "FAIL",
        `${people} on file and GET /api/dashboard/clients came back empty`,
        "Open Pipeline and the client list. Restore GET /api/dashboard/clients. Do not auto-fix from this pulse."
      );
    }
    if (empty) return row("crm-data:clients", "PASS", "no clients on file, and the list is empty");
    return row("crm-data:clients", "PASS", `client list answered ${http.status} with ${list.length} people`);
  }));

  if (!id) {
    const why = facts && facts.clientIdError
      ? `could not pick a client (${facts.clientIdError})`
      : "no client on file — client, closer, and bank-match reads not run";
    out.push(row("crm-data:client", "skip", why));
    out.push(row("crm-data:tradelines", "skip", why));
    out.push(row("crm-data:lender-matches", "skip", why));
  } else {
    out.push(await checkJson(ctx, "crm-data:client", `/api/dashboard/client?id=${encodeURIComponent(id)}`, (http) => {
      const client = http.body && http.body.client;
      if (!http.body || http.body.ok === false || !client || !client.id) {
        return row(
          "crm-data:client",
          "FAIL",
          "a client is on file and GET /api/dashboard/client did not return that person",
          "Open the client control panel for that person. Restore GET /api/dashboard/client. Do not auto-fix from this pulse."
        );
      }
      return row("crm-data:client", "PASS", `client file read answered ${http.status}`);
    }));

    out.push(await checkJson(ctx, "crm-data:tradelines", `/api/read/tradelines?client_id=${encodeURIComponent(id)}`, (http) => {
      if (!http.body || http.body.ok === false || !Object.prototype.hasOwnProperty.call(http.body, "data")) {
        return row(
          "crm-data:tradelines",
          "FAIL",
          "closer dashboard read did not return a card list for a client on file",
          "Open the closer dashboard for that person. Restore GET /api/read/tradelines. Do not auto-fix from this pulse."
        );
      }
      const n = Array.isArray(http.body.data) ? http.body.data.length : 0;
      return row("crm-data:tradelines", "PASS", `closer dashboard read answered ${http.status} with ${n} cards`);
    }));

    out.push(await checkJson(ctx, "crm-data:lender-matches", `/api/read/lender-matches?client_id=${encodeURIComponent(id)}`, (http) => {
      if (!http.body || http.body.ok === false || !Array.isArray(http.body.matches)) {
        return row(
          "crm-data:lender-matches",
          "FAIL",
          "client control panel bank match read did not return a list for a client on file",
          "Open the client control panel. Restore GET /api/read/lender-matches. Do not auto-fix from this pulse."
        );
      }
      const book = http.body.summary && http.body.summary.lender_count;
      if (facts && facts.lenderCount > 0 && book === 0) {
        return row(
          "crm-data:lender-matches",
          "FAIL",
          "banks are on file but the client match read says the bank book is empty",
          "Open Lenders and the client control panel. The bank list should show. Do not auto-fix from this pulse."
        );
      }
      return row(
        "crm-data:lender-matches",
        "PASS",
        `bank match read answered ${http.status} with ${http.body.match_count == null ? http.body.matches.length : http.body.match_count} matches`
      );
    }));
  }

  out.push(await checkJson(ctx, "crm-data:sales-floor", "/api/read/sales-floor", (http) => {
    const body = http.body;
    if (!body || body.ok === false || !body.period || !body.hero) {
      return row(
        "crm-data:sales-floor",
        "FAIL",
        "sales floor read answered but the screen's numbers were missing",
        "Open Sales floor. Restore GET /api/read/sales-floor. Do not auto-fix from this pulse."
      );
    }
    return row("crm-data:sales-floor", "PASS", `sales floor read answered ${http.status}`);
  }));

  out.push(await checkJson(ctx, "crm-data:documents", "/api/read/documents", (http) => {
    const items = http.body && http.body.items;
    const empty = !http.body || http.body.ok === false || !Array.isArray(items) || items.length === 0;
    const expected = facts && facts.docCount;
    if (facts && facts.docError && empty) {
      return row("crm-data:documents", "skip", `document list was empty and the count could not be read (${facts.docError})`);
    }
    if (expected == null) {
      if (!empty) return row("crm-data:documents", "PASS", `document list answered ${http.status} with ${items.length} files`);
      return row("crm-data:documents", "skip", "document list was empty and there is no database to show that a file should be there");
    }
    if (expected > 0 && empty) {
      return row(
        "crm-data:documents",
        "FAIL",
        `${expected} documents are on file and GET /api/read/documents came back empty`,
        "Open Documents. Restore GET /api/read/documents. Do not auto-fix from this pulse."
      );
    }
    if (empty) return row("crm-data:documents", "PASS", "no documents on file, and the list is empty");
    return row("crm-data:documents", "PASS", `document list answered ${http.status} with ${items.length} files`);
  }));

  out.push(await checkJson(ctx, "crm-data:lenders", "/api/read/lenders", (http) => {
    const list = http.body && http.body.lenders;
    const empty = !http.body || http.body.ok === false || !Array.isArray(list) || list.length === 0
      || (http.body.meta && http.body.meta.empty === true && list.length === 0);
    const expected = facts && facts.lenderCount;
    if (facts && facts.lenderError && empty) {
      return row("crm-data:lenders", "skip", `bank list was empty and the count could not be read (${facts.lenderError})`);
    }
    if (expected == null) {
      if (!empty) return row("crm-data:lenders", "PASS", `bank list answered ${http.status} with ${list.length} banks`);
      return row("crm-data:lenders", "skip", "bank list was empty and there is no database to show that a bank should be there");
    }
    if (expected > 0 && empty) {
      return row(
        "crm-data:lenders",
        "FAIL",
        `${expected} banks are on file and GET /api/read/lenders came back empty`,
        "Open Lenders from the client control panel. Restore GET /api/read/lenders. Do not auto-fix from this pulse."
      );
    }
    if (empty) {
      return row(
        "crm-data:lenders",
        "FAIL",
        "the bank book is empty, so the client control panel has no bank to open",
        "Load the lender book on Lenders. Do not auto-fix from this pulse."
      );
    }
    return row("crm-data:lenders", "PASS", `bank list answered ${http.status} with ${list.length} banks`);
  }));

  return out;
}

/**
 * Morning-pulse rows for dead CRM links and empty reads.
 * `ctx.sources` replaces the four live screens (tests).
 * `ctx.fetchImpl` may GET. 404 and 500 fail. No POST. No form submit.
 * `ctx.db` is SELECT only, and only when the caller passes one.
 */
export async function gapChecks(ctx = {}) {
  const appDir = ctx.appDir || DEFAULT_APP_DIR;
  const orgId = orgUuid(ctx.orgId);
  const sources = ctx.sources === undefined ? readSources(appDir) : ctx.sources;
  const links = linksFromSources(sources);
  const facts = await loadFacts(ctx.db, orgId);
  const pages = await checkPageLinks({ ...ctx, appDir }, links);
  const logos = checkLogos(ctx, facts);
  const reads = await checkReads(ctx, facts);
  return [...pages, logos, ...reads];
}
