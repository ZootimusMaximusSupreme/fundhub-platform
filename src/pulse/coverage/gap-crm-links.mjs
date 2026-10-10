// CRM screen links and the records those screens should show.
// Read only. Never texts. Never charges. Never pulls credit.
// Recon (AG-07) stays the only tripwire. This is not a second watchdog.
//
// The registry already pings the four screens and every /app page, and it
// already pings the CRM read routes (a 401 counts as up). This file does what a
// ping cannot: it reads what the screens link to, and reads the records the
// screens are drawn from.
//
// Review notes (Claude, 2026-10-08):
//   * The first draft read public/app/*.html and public/assets/lenders/* from
//     disk. A Netlify function carries neither folder (public/ is static, it is
//     not in included_files). On the server the page check would have found no
//     links and said PASS, and the logo check would have called all 596 logos
//     missing. Every read of the screens and logos now goes over HTTP.
//   * Nine "crm-data" checks sent GET to staff-only read routes with no session.
//     Each answered 401 and each skipped, every morning, forever. A skip that
//     cannot ever be anything else is not coverage. The routes are pinged by the
//     registry already. Five of the nine are replaced by reads of the record
//     itself (the same library functions the routes call). Four are dropped:
//     clients, pipeline-counts, documents and sales-floor. They read inline SQL
//     inside the route file, or are owned by another lane (gap-sales-manager,
//     gap-documents), so there was nothing honest to run here without a staff
//     session.
//   * Every link on the four screens points at a page the registry already
//     pings. Fetching all 34 again was a copy of that ping. Only a link to a page
//     that is NOT on the desk list is fetched now. That is where a typo shows up.
//   * The logo check now spot checks over HTTP: the newest 10 logos plus a
//     rotating 40 a day, so every logo is checked inside 15 days.
//   * Second review (Claude, 2026-10-08): three dropped reads came back (the
//     Pipeline board, the rail counts and the client list). The Pipeline screen is drawn from three routes (dashboard/pipeline,
//     dashboard/pipeline-counts, dashboard/clients) that need a staff session and
//     hold their SQL inside the route file, so nothing could run them and a
//     renamed column would blank the screen with no row going red. They cannot
//     be called in process (the db handle and the staff gate are imported inside
//     the route). So the same SELECTs are copied below, and the test reads the
//     three route files and fails the moment a copy drifts from its route.
//   * The "already on the desk list" set is now desk pages only. It used to hold
//     every registry row, so a link such as careers.html (a public page, not an
//     /app page) looked watched when /app/careers.html would 404.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { orgDemoModeEnabled } from "../../demo/exclude-demo.mjs";
import { unpricedApprovalConditions } from "../../funding/success-fee.mjs";

export const SCREEN_FILES = Object.freeze([
  "pipeline.html",
  "client-control-panel.html",
  "closer-dashboard.html",
  "sales-floor.html"
]);

export const CHECK_IDS = Object.freeze([
  "crm-links:pages",
  "crm-links:bank-logos",
  "crm-data:pipeline-cards",
  "crm-data:pipeline",
  "crm-data:pipeline-counts",
  "crm-data:clients",
  "crm-data:lenders",
  "crm-data:client",
  "crm-data:lender-matches",
  "crm-data:tradelines"
]);

/** The three route reads behind the Pipeline screen. They need no client on file. */
const ROUTE_IDS = Object.freeze([
  "crm-data:pipeline",
  "crm-data:pipeline-counts",
  "crm-data:clients"
]);

/** The four library reads, in the order they run. The first needs no client. */
const LIBRARY_IDS = Object.freeze([
  "crm-data:lenders",
  "crm-data:client",
  "crm-data:lender-matches",
  "crm-data:tradelines"
]);

/** Every record read, in the order they run. */
const RECORD_IDS = Object.freeze([...ROUTE_IDS, ...LIBRARY_IDS]);

/** Logos looked at per morning: the newest few, plus one slice of a rotation. */
export const LOGO_NEWEST = 10;
export const LOGO_ROTATION = 40;
export const LOGO_PLACEHOLDER = "/assets/lenders/placeholder.svg";

const DAY_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK_TOKEN = /(?:href\s*=\s*|location\.href\s*=\s*|\.href\s*=\s*|window\.open\(\s*)["']([^"']+)["']/gi;
const QUOTED_PAGE = /["']((?:\/app\/|https?:\/\/[^"'/]+\/app\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.html(?:\?[^"']*)?)["']/gi;
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

const RECON = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse.";

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

function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
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

/**
 * JavaScript with its comments blanked out. Strings are walked so a "//" inside
 * a URL string, or a quote inside a comment, is not mistaken for the other thing.
 * A string that runs to the end of a line is closed there, so one odd character
 * cannot swallow the rest of the file. Prose in a comment that names a screen
 * which was removed ("card-stack.html?client_id=...") is not a link.
 */
export function stripJsComments(src) {
  const text = String(src || "");
  const n = text.length;
  let out = "";
  let mode = "code";
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (mode === "code") {
      if (ch === "/" && nx === "*") { mode = "block"; out += " "; i += 2; continue; }
      if (ch === "/" && nx === "/") { mode = "line"; out += " "; i += 2; continue; }
      if (ch === "'") mode = "sq";
      else if (ch === '"') mode = "dq";
      else if (ch === "`") mode = "tpl";
      out += ch;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (ch === "\n") { mode = "code"; out += ch; }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && nx === "/") { mode = "code"; i += 2; } else { i += 1; }
      continue;
    }
    out += ch;
    if (ch === "\\") { out += nx == null ? "" : nx; i += 2; continue; }
    if ((mode === "sq" && ch === "'") || (mode === "dq" && ch === '"') || (mode === "tpl" && ch === "`")) mode = "code";
    else if ((mode === "sq" || mode === "dq") && ch === "\n") mode = "code";
    i += 1;
  }
  return out;
}

/** An HTML page with its comments gone, inline scripts and styles included. */
export function stripHtmlComments(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open, body, close) => `${open}${stripJsComments(body)}${close}`)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, body, close) => `${open}${body.replace(/\/\*[\s\S]*?\*\//g, " ")}${close}`);
}

/** Comments out of one screen or script file, by its name. */
export function stripComments(name, text) {
  return /\.js$/i.test(String(name || "")) ? stripJsComments(text) : stripHtmlComments(text);
}

/** Page files an HTML or script blob links to, with the source name kept. Comments are not links. */
export function extractAppLinks(text, sourceName = "screen") {
  const found = new Map();
  const blob = stripComments(sourceName, text);
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
  return found;
}

/** Same-folder script files an HTML page loads. External and other-folder scripts are not ours. */
export function scriptFiles(html) {
  const out = [];
  const blob = String(html || "");
  SCRIPT_SRC.lastIndex = 0;
  let match;
  while ((match = SCRIPT_SRC.exec(blob))) {
    let src = String(match[1]).split("#")[0].split("?")[0];
    if (src.startsWith("/app/")) src = src.slice("/app/".length);
    // Anything left with a slash or a scheme in it (other folders, other sites) fails this and is not ours.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(src)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

function mergeLinks(sources) {
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

/** Desk pages only (the /app files the registry pings). An API key or a public page of the same name is not one. */
function deskList() {
  return new Set(PULSE_REGISTRY.filter((item) => item && item.kind === "desk").map((item) => coverageKey(item)));
}

function originOf(baseUrl) {
  return String(baseUrl || "https://fundhub.ai").trim().replace(/\/+$/, "") || "https://fundhub.ai";
}

function fetchOf(ctx) {
  if (typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/** ctx.db is what the read routes use (the plain role). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

async function one(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows && out.rows[0]) || {};
}

async function all(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows) || [];
}

function dead(status) {
  return status === 404 || status >= 500;
}

async function getText(fetchImpl, url, method = "GET") {
  const send = () => fetchImpl(url, {
    method,
    headers: { accept: "text/html,application/javascript,*/*" },
    signal: AbortSignal.timeout(15000)
  });
  // One retry when the request itself throws (a dropped connection). A status code is never retried.
  let res;
  try {
    res = await send();
  } catch {
    res = await send();
  }
  const status = Number(res && res.status);
  let text = "";
  if (method === "GET" && status >= 200 && status < 300 && res && typeof res.text === "function") {
    text = await res.text();
  }
  return { status, text };
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

/* ───────────── links ───────────── */

async function loadScreens(fetchImpl, base) {
  const sources = [];
  const unreadable = [];
  const fails = [];
  const pages = await inBatches(SCREEN_FILES, 4, async (screen) => {
    try {
      return { screen, ...(await getText(fetchImpl, `${base}/app/${screen}`)) };
    } catch (err) {
      return { screen, status: 0, text: "", error: errText(err) };
    }
  });
  const scriptFrom = new Map();
  for (const page of pages) {
    if (page.status >= 200 && page.status < 300) {
      sources.push({ name: page.screen, text: page.text });
      for (const file of scriptFiles(page.text)) {
        if (!scriptFrom.has(file)) scriptFrom.set(file, []);
        scriptFrom.get(file).push(page.screen);
      }
    } else {
      unreadable.push(`${page.screen} ${page.error ? `did not answer (${page.error})` : `answered ${page.status}`}`);
    }
  }
  const scripts = await inBatches([...scriptFrom.keys()].sort(), 6, async (file) => {
    try {
      return { file, ...(await getText(fetchImpl, `${base}/app/${file}`)) };
    } catch (err) {
      return { file, status: 0, text: "", error: errText(err) };
    }
  });
  for (const script of scripts) {
    const from = scriptFrom.get(script.file).sort().join(", ");
    if (script.status >= 200 && script.status < 300) {
      sources.push({ name: script.file, text: script.text });
    } else if (script.error || dead(script.status)) {
      fails.push(row(
        `crm-script:${script.file}`,
        "FAIL",
        `${from} loads ${script.file} and ${script.error ? `the GET did not answer: ${script.error}` : `GET /app/${script.file} answered ${script.status}`}. The screen will not work without it.`,
        `Restore /app/${script.file} or fix the script tag on ${from}. ${RECON}`
      ));
    } else {
      unreadable.push(`${script.file} answered ${script.status}`);
    }
  }
  return { sources, unreadable, fails };
}

async function checkPageLinks(ctx) {
  const id = "crm-links:pages";
  const fetchImpl = fetchOf(ctx);
  if (!fetchImpl) return [row(id, "skip", "no fetch in this run — CRM screens not read")];
  const base = originOf(ctx.baseUrl);
  const watched = deskList();

  let sources;
  let unreadable = [];
  const fails = [];
  if (Array.isArray(ctx.sources)) {
    sources = ctx.sources;
  } else {
    const loaded = await loadScreens(fetchImpl, base);
    sources = loaded.sources;
    unreadable = loaded.unreadable;
    fails.push(...loaded.fails);
  }

  const links = mergeLinks(sources);
  const files = [...links.keys()].sort();
  const onList = files.filter((file) => watched.has(file));
  const offList = files.filter((file) => !watched.has(file));

  const checked = await inBatches(offList, 6, async (file) => {
    const from = [...links.get(file)].sort().join(", ") || "a CRM screen";
    try {
      const { status } = await getText(fetchImpl, `${base}/app/${file}`);
      return { file, from, status };
    } catch (err) {
      return { file, from, status: 0, error: errText(err) };
    }
  });
  for (const hit of checked) {
    if (hit.error || dead(hit.status)) {
      fails.push(row(
        `crm-link:${hit.file}`,
        "FAIL",
        `${hit.from} links to ${hit.file}. ${hit.error ? `The GET did not answer: ${hit.error}` : `GET /app/${hit.file} answered ${hit.status}`}. This file is not on the morning desk list.`,
        `Fix the link to ${hit.file} on ${hit.from}. ${RECON}`
      ));
    }
  }

  if (fails.length) return fails;
  if (unreadable.length) {
    return [row(
      id,
      "skip",
      `could not read every CRM screen, so some links were not checked: ${unreadable.join("; ")}. The registry pings these files.`
    )];
  }
  if (!files.length) {
    return [row(id, "skip", "the CRM screens were read and no internal /app page links were found in them")];
  }
  return [row(
    id,
    "PASS",
    `${files.length} internal /app links read from the CRM screens over HTTP. ${onList.length} are on the morning desk list, which pings them.${offList.length ? ` ${offList.length} were not on it, were fetched, and all answered.` : ""}`
  )];
}

/* ───────────── logos ───────────── */

export const LOGO_SQL = `
  /* gap:crm-logos */
  SELECT logo_path, max(updated_at) AS updated_at
    FROM lenders
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
     AND (
       logo_path LIKE '/assets/lenders/%'
       OR logo_path LIKE 'assets/lenders/%'
       OR logo_path LIKE '%..%'
     )
   GROUP BY logo_path
   ORDER BY logo_path ASC
`;

/**
 * A logo path the page can never load. The control panel sets the picture's src
 * to the stored path as written, from /app/, so "assets/lenders/x.png" lands on
 * /app/assets/lenders/x.png, and a path with ".." is never right.
 */
export function isBadLogoPath(raw) {
  const full = String(raw == null ? "" : raw).trim();
  // Another site's picture is not ours to judge.
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(full)) return false;
  const s = full.split("#")[0].split("?")[0];
  return s.includes("..") || s.startsWith("assets/lenders/");
}

/** A logo path under this site's own /assets/lenders folder, the only kind fetched. */
export function isOwnLogoPath(raw) {
  const s = String(raw == null ? "" : raw).trim();
  return s.startsWith("/assets/lenders/") && !s.includes("..");
}

/** Today's logos: the newest few, plus a slice that moves a little every day. */
export function pickLogos(rows, now = new Date()) {
  const list = (rows || []).filter((r) => r && r.logo_path);
  const newest = [...list]
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
    .slice(0, LOGO_NEWEST)
    .map((r) => r.logo_path);
  const sorted = list.map((r) => r.logo_path);
  const slice = [];
  if (sorted.length) {
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = (day * LOGO_ROTATION) % sorted.length;
    const take = Math.min(LOGO_ROTATION, sorted.length);
    for (let i = 0; i < take; i += 1) slice.push(sorted[(start + i) % sorted.length]);
  }
  const picked = [...new Set([...newest, ...slice, LOGO_PLACEHOLDER])];
  return { picked, total: sorted.length };
}

async function checkLogos(ctx, run, orgId, now) {
  const id = "crm-links:bank-logos";
  const fetchImpl = fetchOf(ctx);
  if (!run) return row(id, "skip", "no database in this run — bank logo paths not read");
  if (!fetchImpl) return row(id, "skip", "no fetch in this run — bank logo files not checked");
  let rows;
  try {
    rows = await all(run, LOGO_SQL, [orgId]);
  } catch (err) {
    return row(id, "FAIL", `could not read bank logo paths: ${errText(err)}`, `Read lenders.logo_path. ${RECON}`);
  }
  const badPaths = [...new Set(rows.map((r) => String((r && r.logo_path) || "").trim()).filter(isBadLogoPath))];
  const ownRows = rows.filter((r) => r && isOwnLogoPath(r.logo_path));
  if (!ownRows.length && !badPaths.length) return row(id, "skip", "no /assets/lenders bank logo paths on file");
  const { picked, total } = pickLogos(ownRows, now);
  const base = originOf(ctx.baseUrl);
  const results = await inBatches(picked, 10, async (p) => {
    try {
      const { status } = await getText(fetchImpl, `${base}${p}`, "HEAD");
      return { p, status };
    } catch (err) {
      return { p, status: 0, error: errText(err) };
    }
  });
  const missing = results.filter((r) => r.error || dead(r.status));
  const problems = [
    ...badPaths.map((p) => `${p} (a path the page cannot load)`),
    ...missing.map((r) => (r.error ? `${r.p} (no answer)` : `${r.p} (${r.status})`))
  ];
  if (problems.length) {
    const shown = problems.slice(0, 6).join(", ");
    const more = problems.length > 6 ? ` and ${problems.length - 6} more` : "";
    return row(
      id,
      "FAIL",
      `${problems.length} of ${picked.length + badPaths.length} bank logos checked today do not load: ${shown}${more}`,
      `Put the logo file under public/assets/lenders or point the bank at ${LOGO_PLACEHOLDER}. ${RECON}`
    );
  }
  return row(
    id,
    "PASS",
    `${picked.length} of ${total} bank logos checked today (the newest ${LOGO_NEWEST} and a rotating ${LOGO_ROTATION}, so all are covered in ${Math.ceil(total / LOGO_ROTATION)} days). All loaded.`
  );
}

/* ───────────── records the screens draw ───────────── */

/**
 * Cards that sit on a rail but cannot show on it. The board drops a card whose
 * stage is not one of that rail's stages, and a card with neither a client nor a
 * partner. Same joins as api/dashboard/pipeline-counts.mjs.
 */
export const PIPELINE_CARDS_SQL = `
  /* gap:crm-pipeline-cards */
  SELECT p.key,
         (SELECT count(*)::int FROM pipeline_stages ps WHERE ps.pipeline_id = p.id) AS stages,
         count(cd.id)::int AS cards,
         count(cd.id) FILTER (WHERE s.id IS NULL)::int AS no_stage,
         count(cd.id) FILTER (WHERE c.id IS NULL AND pr.id IS NULL)::int AS no_owner
    FROM pipelines p
    LEFT JOIN cards cd ON cd.pipeline_id = p.id AND cd.org_id = p.org_id
    LEFT JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
    LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
   WHERE ($1::uuid IS NULL OR p.org_id = $1::uuid)
   GROUP BY p.id, p.key
   ORDER BY p.key ASC
`;

export const CLIENT_PICK_SQL = `
  /* gap:crm-client */
  SELECT id::text AS id
    FROM clients
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
   ORDER BY created_at DESC
   LIMIT 1
`;

/** The two reads api/dashboard/client.mjs makes besides readClientStepRows. One row is enough. */
export const CLIENT_TX_SQL = `
  /* gap:crm-client-transactions */
  SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
    FROM transactions
   WHERE client_id = $1::uuid AND org_id = $2::uuid
   ORDER BY created_at DESC
   LIMIT 1
`;

export const CLIENT_MSG_SQL = `
  /* gap:crm-client-messages */
  SELECT id, direction, channel, template_key, rendered_body, provider, status, created_at
    FROM messages
   WHERE client_id = $1::uuid AND org_id = $2::uuid
   ORDER BY created_at DESC
   LIMIT 1
`;

export const LENDER_COUNT_SQL = `
  /* gap:crm-lender-count */
  SELECT count(*)::int AS n
    FROM lenders
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
`;

/**
 * Copies of the SQL inside the three dashboard routes behind the Pipeline screen.
 * Comments are left out and nothing else is changed. The test reads the route
 * files and fails if any copy no longer matches its route.
 *   BOARD_STAGES_SQL, BOARD_CARDS_SQL   api/dashboard/pipeline.mjs      (STAGES_SQL, CARDS_SQL)
 *   COUNTS_SQL                          api/dashboard/pipeline-counts.mjs (COUNTS_SQL)
 *   CLIENTS_LIST_SQL                    api/dashboard/clients.mjs        (SQL)
 */
export const BOARD_KEY = "sales";
/** The route's own default read size. */
export const BOARD_LIMIT = 500;
export const CLIENTS_LIST_LIMIT = 5;

export const BOARD_STAGES_SQL = `
  SELECT s.id, s.key, s.name, s.sort_order
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
   WHERE p.key = $1 AND p.org_id = $2
   ORDER BY s.sort_order ASC, s.name ASC
`;

export const BOARD_CARDS_SQL = `
  SELECT
    cd.id,
    cd.stage_id,
    cd.owner,
    cd.entered_at,
    c.id            AS client_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    c.is_demo,
    (c.custom_fields->>'total_funding_estimate') AS total_funding_estimate,
    c.custom_fields->>'cf_svy_self_reported_fico' AS survey_fico_raw,
    c.custom_fields->>'cf_svy_self_reported_fico_label' AS survey_fico_label,
    pr.name AS partner_name,
    pr.contact_email AS partner_email,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel IN ('sms', 'text')
         AND last.direction = 'inbound'
    ) AS sms_needs_reply,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel = 'email'
         AND last.direction = 'inbound'
    ) AS email_needs_reply,
    (
      p.key IN ('funding_card_stacking', 'funding_altfin')
      AND EXISTS (
        SELECT 1
          FROM applications a
         WHERE a.client_id = c.id
           AND a.org_id = p.org_id
           AND ${unpricedApprovalConditions("a")}
           AND a.funding_round_id = (
                 SELECT fr.id
                   FROM funding_rounds fr
                  WHERE fr.client_id = c.id
                    AND fr.org_id = p.org_id
                  ORDER BY fr.round_number DESC, fr.created_at DESC
                  LIMIT 1
               )
      )
    ) AS approval_amount_missing
  FROM cards cd
  JOIN pipelines p ON p.id = cd.pipeline_id
  LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
  LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
  WHERE p.key = $1 AND p.org_id = $2 AND cd.org_id = $2
    AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
    AND ($4::boolean OR COALESCE(c.is_demo, false) = false)
    AND (c.custom_fields->>'crm_archived_at' IS NULL)
  ORDER BY cd.entered_at DESC
  LIMIT $3
`;

export const COUNTS_SQL = `
  SELECT p.key AS pipeline_key,
         COUNT(cd.id) FILTER (
           WHERE s.id IS NOT NULL
             AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
             AND ($2::boolean OR COALESCE(c.is_demo, false) = false)
             AND (c.custom_fields->>'crm_archived_at') IS NULL
         )::int AS count
    FROM pipelines p
    LEFT JOIN cards cd
      ON cd.pipeline_id = p.id AND cd.org_id = $1
    LEFT JOIN pipeline_stages s
      ON s.id = cd.stage_id AND s.pipeline_id = p.id
    LEFT JOIN clients c
      ON c.id = cd.client_id AND c.org_id = p.org_id
    LEFT JOIN partners pr
      ON pr.id = cd.partner_id AND pr.org_id = p.org_id
   WHERE p.org_id = $1
   GROUP BY p.key
   ORDER BY p.key ASC
`;

export const CLIENTS_LIST_SQL = `
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.email,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    c.is_demo,
    c.custom_fields                                   AS custom_fields_raw,
    c.tags                                            AS tags_raw,
    (c.custom_fields->>'crs_paid')::boolean          AS crs_paid,
    (c.custom_fields->>'deposit_paid')::boolean       AS deposit_paid,
    (c.custom_fields->>'sale_closed')::boolean        AS sale_closed,
    (c.custom_fields->>'total_funding_estimate')      AS total_funding_estimate,
    c.created_at,
    COUNT(DISTINCT t.id)                              AS tx_count,
    (ARRAY_AGG(t.product_name ORDER BY t.created_at DESC))[1] AS tx_latest_product,
    (ARRAY_AGG(t.amount_paid  ORDER BY t.created_at DESC))[1] AS tx_latest_amount,
    (ARRAY_AGG(t.status       ORDER BY t.created_at DESC))[1] AS tx_latest_status,
    COUNT(DISTINCT cr.id)                             AS crs_count,
    COUNT(DISTINCT tk.id)                             AS task_count,
    (ARRAY_AGG(m.channel   ORDER BY m.created_at DESC))[1] AS last_msg_channel,
    (ARRAY_AGG(m.direction ORDER BY m.created_at DESC))[1] AS last_msg_direction,
    (ARRAY_AGG(m.created_at ORDER BY m.created_at DESC))[1] AS last_msg_at
  FROM clients c
  LEFT JOIN transactions t   ON t.client_id = c.id AND t.org_id = c.org_id
  LEFT JOIN crs_results  cr  ON cr.client_id = c.id AND cr.org_id = c.org_id
  LEFT JOIN tasks        tk  ON tk.client_id = c.id AND tk.org_id = c.org_id
  LEFT JOIN messages     m   ON m.client_id  = c.id AND m.org_id = c.org_id
  WHERE c.org_id = $1
    AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
  GROUP BY c.id
  ORDER BY c.created_at DESC
  LIMIT $2
`;

/** The Pipeline board read for the sales rail. The route answers 404 when the rail has no columns. */
export function judgeBoard(stages, cards) {
  const id = "crm-data:pipeline";
  const cols = stages || [];
  if (!cols.length) {
    return row(
      id,
      "FAIL",
      "the sales pipeline has no columns, so the Pipeline board read answers unknown_pipeline (404) and the board stays empty",
      `Open Pipeline. The sales rail has no stages. ${RECON}`
    );
  }
  return row(id, "PASS", `the Pipeline board read for the sales rail returned ${cols.length} columns and ${(cards || []).length} cards`);
}

/** The rail counts. A company with no pipelines leaves every rail tab on a dash. */
export function judgeRailCounts(rows) {
  const id = "crm-data:pipeline-counts";
  const rails = rows || [];
  if (!rails.length) {
    return row(
      id,
      "FAIL",
      "the rail count read returned no pipelines, so every rail tab on the Pipeline screen shows a dash",
      `Open Pipeline. The rail tabs have no counts. ${RECON}`
    );
  }
  const total = rails.reduce((n, r) => n + Number(r.count || 0), 0);
  return row(id, "PASS", `the rail count read returned ${rails.length} rails holding ${total} cards`);
}

/** The client list on the Pipeline screen. Empty is only a break when a client is on file. */
export function judgeClientsList(rows, clientOnFile) {
  const id = "crm-data:clients";
  const list = rows || [];
  if (!list.length && clientOnFile) {
    return row(
      id,
      "FAIL",
      "a client is on file and the Pipeline client list read came back empty",
      `Open Pipeline. The client list should show. ${RECON}`
    );
  }
  return row(id, "PASS", `the Pipeline client list read returned ${list.length} clients`);
}

async function checkRouteReads(db, readers, orgId, clientOnFile) {
  const demoRead = (readers && readers.orgDemoModeEnabled) || orgDemoModeEnabled;
  let demoOn;
  try {
    demoOn = (await demoRead(db, orgId)) === true;
  } catch (err) {
    const why = `the demo mode setting could not be read, and every Pipeline route reads it first: ${errText(err)}`;
    return ROUTE_IDS.map((id) => row(id, "FAIL", why, `Read the orgs table. ${RECON}`));
  }
  const guarded = async (id, fix, go) => {
    try {
      return await go();
    } catch (err) {
      return row(id, "FAIL", `the Pipeline read threw: ${errText(err)}`, fix);
    }
  };
  const run = (fn) => fn(db);
  return Promise.all([
    guarded("crm-data:pipeline", `Open Pipeline. Restore the board read (api/dashboard/pipeline). ${RECON}`, async () => {
      const stages = await all(run, BOARD_STAGES_SQL, [BOARD_KEY, orgId]);
      if (!stages.length) return judgeBoard(stages, []);
      const cards = await all(run, BOARD_CARDS_SQL, [BOARD_KEY, orgId, BOARD_LIMIT, demoOn]);
      return judgeBoard(stages, cards);
    }),
    guarded("crm-data:pipeline-counts", `Open Pipeline. Restore the rail count read (api/dashboard/pipeline-counts). ${RECON}`, async () =>
      judgeRailCounts(await all(run, COUNTS_SQL, [orgId, demoOn]))),
    guarded("crm-data:clients", `Open Pipeline. Restore the client list read (api/dashboard/clients). ${RECON}`, async () =>
      judgeClientsList(await all(run, CLIENTS_LIST_SQL, [orgId, CLIENTS_LIST_LIMIT, demoOn]), clientOnFile))
  ]);
}

export function judgePipelineCards(rows) {
  const id = "crm-data:pipeline-cards";
  const list = rows || [];
  const sales = list.find((r) => r && r.key === "sales");
  if (!sales) {
    return row(
      id,
      "FAIL",
      "there is no sales pipeline for this company, so the Pipeline screen has no board",
      `Open Pipeline. The sales rail row is missing. ${RECON}`
    );
  }
  if (Number(sales.stages) === 0) {
    return row(
      id,
      "FAIL",
      "the sales pipeline has no columns, so the Pipeline screen shows an empty board",
      `Open Pipeline. The sales rail has no stages. ${RECON}`
    );
  }
  const lost = list
    .map((r) => ({ key: r.key, hidden: Number(r.no_stage || 0) + Number(r.no_owner || 0), noStage: Number(r.no_stage || 0), noOwner: Number(r.no_owner || 0) }))
    .filter((r) => r.hidden > 0);
  if (lost.length) {
    const total = lost.reduce((n, r) => n + r.hidden, 0);
    const named = lost
      .slice(0, 4)
      .map((r) => `${r.key}: ${r.noStage ? `${r.noStage} in no column` : ""}${r.noStage && r.noOwner ? ", " : ""}${r.noOwner ? `${r.noOwner} with no client or partner` : ""}`)
      .join("; ");
    return row(
      id,
      "FAIL",
      `${total} pipeline card${total === 1 ? "" : "s"} exist but cannot show on the board (${named})`,
      `Open Pipeline. These cards sit on a rail but their column or their person is gone. ${RECON}`
    );
  }
  const cards = list.reduce((n, r) => n + Number(r.cards || 0), 0);
  return row(id, "PASS", `${cards} cards on ${list.length} rails, and every one has a column and a person, so each can show`);
}

async function checkPipelineCards(run, orgId) {
  const id = "crm-data:pipeline-cards";
  if (!run) return row(id, "skip", "no database in this run — pipeline cards not read");
  try {
    return judgePipelineCards(await all(run, PIPELINE_CARDS_SQL, [orgId]));
  } catch (err) {
    return row(id, "FAIL", `could not read the pipeline cards: ${errText(err)}`, `Read pipelines, cards and pipeline_stages. ${RECON}`);
  }
}

async function loadReaders(ctx) {
  if (ctx.crmReaders) return ctx.crmReaders;
  const [lenders, tradelines, clientStep] = await Promise.all([
    import("../../lenders/store.mjs"),
    import("../../tradelines/store.mjs"),
    import("../../fulfillment/client-step.mjs")
  ]);
  return {
    listLenders: lenders.listLenders,
    matchForClient: lenders.matchForClient,
    listTradelines: tradelines.listTradelines,
    readClientStepRows: clientStep.readClientStepRows,
    orgDemoModeEnabled
  };
}

async function checkLenders(db, readers, orgId) {
  const id = "crm-data:lenders";
  try {
    const count = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n);
    const list = await readers.listLenders(db, { orgId, limit: 5 });
    if (!Array.isArray(list)) {
      return row(id, "FAIL", "the bank list read did not return a list", `Open Lenders. Restore listLenders. ${RECON}`);
    }
    if (!Number.isFinite(count) || count === 0) {
      return row(
        id,
        "FAIL",
        "the bank book is empty, so the client control panel has no bank to open",
        `Load the lender book on Lenders. ${RECON}`
      );
    }
    if (list.length === 0) {
      return row(
        id,
        "FAIL",
        `${count} banks are on file and the bank list read came back empty`,
        `Open Lenders from the client control panel. The list should show. ${RECON}`
      );
    }
    return row(id, "PASS", `${count} banks on file and the bank list read returned banks`);
  } catch (err) {
    return row(id, "FAIL", `the bank list read threw: ${errText(err)}`, `Open Lenders. Restore the bank list read. ${RECON}`);
  }
}

async function checkClient(db, readers, orgId, clientId) {
  const id = "crm-data:client";
  const fix = `Open the client control panel for that person. Restore the client file read. ${RECON}`;
  try {
    const rows = await readers.readClientStepRows(db, { orgId, clientId });
    if (!rows || !rows.client) {
      return row(id, "FAIL", "a client is on file and the client control panel read did not return that person", fix);
    }
    await one((fn) => fn(db), CLIENT_TX_SQL, [clientId, orgId]);
    await one((fn) => fn(db), CLIENT_MSG_SQL, [clientId, orgId]);
    return row(id, "PASS", "the client control panel read returned a client on file, with their credit pulls, tasks, rounds, invoices, payments and messages readable");
  } catch (err) {
    return row(id, "FAIL", `the client control panel read threw: ${errText(err)}`, fix);
  }
}

async function checkLenderMatches(db, readers, orgId, clientId, lenderCount) {
  const id = "crm-data:lender-matches";
  try {
    const result = await readers.matchForClient(db, { orgId, clientId });
    if (!result || !result.summary || !Array.isArray(result.matches)) {
      return row(
        id,
        "FAIL",
        result ? "the bank match read did not return a match list for a client on file" : "a client is on file and the bank match read says there is no such client",
        `Open the client control panel. Restore the bank match read. ${RECON}`
      );
    }
    const book = result.summary.lender_count;
    if (lenderCount > 0 && Number(book) === 0) {
      return row(
        id,
        "FAIL",
        "banks are on file but the client match read says the bank book is empty",
        `Open Lenders and the client control panel. The bank list should show. ${RECON}`
      );
    }
    const n = result.summary.match_count == null ? result.matches.length : result.summary.match_count;
    return row(id, "PASS", `the bank match read answered for a client on file with ${n} matches`);
  } catch (err) {
    return row(id, "FAIL", `the bank match read threw: ${errText(err)}`, `Open the client control panel. Restore the bank match read. ${RECON}`);
  }
}

async function checkTradelines(db, readers, orgId, clientId) {
  const id = "crm-data:tradelines";
  try {
    const rows = await readers.listTradelines(db, { orgId, clientId });
    if (!Array.isArray(rows)) {
      return row(id, "FAIL", "the closer dashboard card read did not return a list", `Open the closer dashboard. Restore the card read. ${RECON}`);
    }
    return row(id, "PASS", `the closer dashboard card read answered for a client on file with ${rows.length} cards`);
  } catch (err) {
    return row(id, "FAIL", `the closer dashboard card read threw: ${errText(err)}`, `Open the closer dashboard. Restore the card read. ${RECON}`);
  }
}

/**
 * Morning-pulse rows for dead CRM links and records that should show and do not.
 * ctx: { db, scope, orgId, now, fetchImpl, baseUrl }.
 * `ctx.sources` replaces the live screens, `ctx.crmReaders` replaces the library reads (tests).
 * GET and HEAD only. No POST. No form submit. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const orgRaw = String(ctx.orgId || "").trim();
  const orgId = UUID_RE.test(orgRaw) ? orgRaw : null;
  const run = bind(ctx);

  const pages = await checkPageLinks(ctx);
  const logos = await checkLogos(ctx, run, orgId, now);
  const cards = await checkPipelineCards(run, orgId);

  const reads = [];
  const db = ctx.db && typeof ctx.db.query === "function" ? ctx.db : null;
  const skipReads = (why) => {
    for (const idName of RECORD_IDS) reads.push(row(idName, "skip", why));
  };
  if (!db) {
    skipReads("no database in this run — records not read");
  } else if (!orgId) {
    skipReads("no org id in this run — records not read");
  } else {
    let readers = null;
    let loadError = null;
    try {
      readers = await loadReaders(ctx);
    } catch (err) {
      loadError = errText(err);
    }
    let clientId = null;
    let pickError = null;
    try {
      const picked = await one((fn) => fn(db), CLIENT_PICK_SQL, [orgId]);
      clientId = UUID_RE.test(String(picked.id || "")) ? String(picked.id) : null;
    } catch (err) {
      pickError = errText(err);
    }
    // The three Pipeline route reads need no library code and no client. They run either way.
    reads.push(...(await checkRouteReads(db, readers, orgId, !!clientId)));

    if (!readers) {
      for (const idName of LIBRARY_IDS) {
        reads.push(row(idName, "FAIL", `the record read code would not load: ${loadError}`, `Restore src/lenders/store.mjs and src/tradelines/store.mjs. ${RECON}`));
      }
    } else {
      reads.push(await checkLenders(db, readers, orgId));
      if (!clientId) {
        const why = pickError ? `could not pick a client (${pickError})` : "no client on file — the record reads were not run";
        const status = pickError ? "FAIL" : "skip";
        const fix = pickError ? `Read the clients table. ${RECON}` : null;
        for (const idName of LIBRARY_IDS.slice(1)) reads.push(row(idName, status, why, fix));
      } else {
        let lenderCount = 0;
        try {
          lenderCount = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n) || 0;
        } catch {
          lenderCount = 0;
        }
        reads.push(await checkClient(db, readers, orgId, clientId));
        reads.push(await checkLenderMatches(db, readers, orgId, clientId, lenderCount));
        reads.push(await checkTradelines(db, readers, orgId, clientId));
      }
    }
  }
  return [...pages, logos, cards, ...reads];
}
