// Client portal after they are a client. Report only. Never auto-fix. Never text.
// Slice 26 already lists which doors sit in the pulse registry. This file does
// not repeat that list. It looks for four breaks on the live path:
//   portal page 404, portal summary 500, a paid client with no entitlement,
//   a journey step that should unlock and did not.
// Read-only SQL, plus a signed-out GET of the portal shell.
// Do not log in as a real client. One tripwire: existing Recon (AG-07).
// Do not invent a second watchdog.
//
// What this file does NOT do, on purpose:
//   - It does not ping GET /api/read/portal-summary. reg:read/portal-summary in
//     the registry already does, and a signed-out 401 never reaches the SQL.
//   - It does not read Recon. The daily pulse already has a `recon` check.
//
// Tier 1 tripwires (Claude, 2026-10-09), three more rows a customer would feel:
//   portal:page-scripts-load          the six customer pages and every script and
//                                     style file each one names, read live
//   portal:progress-read-real-client the real client-progress read, run for the
//                                     newest paying client, with every swallowed
//                                     read failure counted
//   portal:paid-client-never-signed-in a paying client holds access for 72 hours
//                                     and has never signed in
// All three are read only: GET for the web, SELECT for the database. The progress
// read goes through a guard that refuses anything that is not a plain read.
//
// THE SQL, THE PAGE READS AND THE VERDICTS LIVE IN src/pulse/beats/lib/portal-truth.mjs
// (2026-10-20), so the hourly beat client-portal runs the same checks as this lane:
// portal:page-scripts-load, portal:paid-entitlement, portal:next-step, portal:summary
// and portal:paid-client-never-signed-in. This file keeps what only a morning run can
// do: the real progress read (it runs src/progress/read.mjs, which a beat may not
// import), the audit's re-check (naVerify) and the run's own fetch and org.

import {
  DEFAULT_BASE_URL,
  PAID,
  INTERNAL_CLIENT_EMAIL_RE,
  NEVER_SIGNED_IN_SQL,
  PAID_THROUGH_THE_DOOR_SQL,
  NEVER_SIGNED_IN_ID,
  check,
  clip,
  raceTimeout,
  readNeverSignedIn,
  waitingOf,
  heldOnly,
  checkPortalPage as portalPageTruth,
  checkPageScripts as pageScriptsTruth,
  checkPortalSummary,
  checkPaidEntitlement,
  checkNextStep,
  checkPaidNeverSignedIn
} from "../beats/lib/portal-truth.mjs";

export * from "../beats/lib/portal-truth.mjs";

/** The portal shell check, with this run's fetch as the web it reads. */
export function checkPortalPage({ fetchImpl, ...rest } = {}) {
  return portalPageTruth({ web: fetchImpl, ...rest });
}

/** The customer pages and their files, with this run's fetch as the web it reads. */
export function checkPageScripts({ fetchImpl, ...rest } = {}) {
  return pageScriptsTruth({ web: fetchImpl, ...rest });
}

async function defaultOrgId(db) {
  const { rows } = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  return rows[0]?.id || null;
}

/* The newest real paying client: the one whose progress page we read. */
export const PROGRESS_CLIENT_SQL = `
/* gap:portal-progress-client */
SELECT t.client_id::text AS id
  FROM transactions t
  JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
 WHERE t.org_id = $1::uuid
   AND lower(btrim(COALESCE(t.status, ''))) = $2
   AND t.is_demo IS NOT TRUE
   AND NOT (c.is_demo IS TRUE
            OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
            OR COALESCE(c.email, '') ~* $3)
   AND ${PAID_THROUGH_THE_DOOR_SQL}
 ORDER BY t.created_at DESC
 LIMIT 1
`.trim();

/* What the client's own rows say, counted without the progress code, so the page
   can be held against them. Three plain facts: how many steps they have, how
   many documents, and which repair stage their card is in. */
export const PROGRESS_ROWS_SQL = `
/* gap:portal-progress-rows */
SELECT
  (SELECT count(*) FROM client_waypoints w
    WHERE w.org_id = $1::uuid AND w.client_id = $2::uuid)::int AS waypoints,
  (SELECT count(*) FROM documents d
    WHERE d.org_id = $1::uuid AND d.client_id = $2::uuid
      AND d.kind = 'deliverable')::int AS deliverables,
  (SELECT COALESCE(array_agg(ps.key), '{}'::text[])
     FROM cards c
     JOIN pipeline_stages ps ON ps.id = c.stage_id
     JOIN pipelines p ON p.id = c.pipeline_id AND p.key = $3
    WHERE c.org_id = $1::uuid AND c.client_id = $2::uuid) AS repair_stages
`.trim();

export const READ_ONLY_SQL_TIER_1 = Object.freeze([
  NEVER_SIGNED_IN_SQL,
  PROGRESS_CLIENT_SQL,
  PROGRESS_ROWS_SQL
]);

/* ── portal:progress-read-real-client ───────────────────────────────────────
   The progress page is a screen that draws whatever readClientProgress hands it.
   That function is built to fail soft: a read that throws is logged and the
   section comes back empty, so a dropped column does not give a 500. It gives a
   client an empty page that looks like a new client. This check runs the real
   function for the newest paying client and counts every read that failed
   underneath, then holds the answer against the client's own rows. */

export const PROGRESS_TIMEOUT_MS = 12000;

const WRITE_WORDS = Object.freeze([
  "insert", "update", "delete", "truncate", "alter", "drop", "create", "grant", "revoke"
]);

/** True when the text is one plain read: it starts with select or with, and
    names no write word. The progress read is held to this, so a future change
    that makes it write is refused here and shows up red. */
export function isPlainRead(sql) {
  const text = String(typeof sql === "string" ? sql : (sql && sql.text) || "");
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().toLowerCase();
  if (!/^(select|with)\b/.test(bare)) return false;
  const words = bare.split(/[^a-z_]+/);
  return !WRITE_WORDS.some((w) => words.includes(w));
}

function guardedDb(db) {
  const errors = [];
  return {
    errors,
    query: async (sql, params) => {
      if (!isPlainRead(sql)) {
        const err = Object.assign(new Error("the pulse refused a query that is not a plain read"), { refused: true });
        errors.push(err);
        throw err;
      }
      try {
        return await db.query(sql, params);
      } catch (err) {
        errors.push(err);
        throw err;
      }
    }
  };
}

async function loadProgressModules() {
  const read = await import("../../progress/read.mjs");
  const pipeline = await import("../../repair/pipeline.mjs");
  return { readClientProgress: read.readClientProgress, REPAIR_PIPELINE: pipeline.REPAIR_PIPELINE };
}

function shapeProblems(payload) {
  const bad = [];
  if (!payload || typeof payload !== "object") return ["the read gave back nothing"];
  if (!payload.stage || typeof payload.stage !== "object") bad.push("no stage block");
  if (!payload.scores || !Array.isArray(payload.scores.personal) || payload.scores.personal.length !== 3) {
    bad.push("no three score panels");
  }
  if (!payload.movement || typeof payload.movement !== "object") bad.push("no movement block");
  for (const key of ["waypoints", "timeline", "deliverables"]) {
    if (!Array.isArray(payload[key])) bad.push(`no ${key} list`);
  }
  return bad;
}

export async function checkProgressRead({
  run, orgId, deps = null, timeoutMs = PROGRESS_TIMEOUT_MS
} = {}) {
  const id = "portal:progress-read-real-client";
  if (typeof run !== "function") return check(id, "skip", "no database in this run — progress read not run");
  if (!orgId) return check(id, "skip", "no org in this run — progress read not run");

  let mods = deps;
  if (!mods) {
    try {
      mods = await loadProgressModules();
    } catch (err) {
      return check(
        id,
        "FAIL",
        `the progress read code would not load: ${clip(err)}`,
        "Fix the import named above in src/progress/read.mjs. Do not auto-fix from this pulse."
      );
    }
  }
  const fix = "Fix the read named above behind GET /api/read/client-progress. Do not auto-fix from this pulse.";

  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  const seconds = Math.round(timeoutMs / 1000);

  // 1. Who to read: the newest real paying client.
  let clientId;
  try {
    clientId = await raceTimeout(run(async (tx) => {
      const r = await tx.query(PROGRESS_CLIENT_SQL, [orgId, PAID, INTERNAL_CLIENT_EMAIL_RE]);
      return r && r.rows && r.rows[0] ? r.rows[0].id : null;
    }), left());
  } catch (err) {
    return check(id, "skip", `could not pick a paying client to read: ${err && err.isTimeout ? `no answer in ${seconds} seconds` : clip(err)}`);
  }
  if (!clientId) return check(id, "skip", "no real paying client on file — progress read not run");

  // 2. The real read, behind the guard. Errors it swallows are counted.
  let outcome;
  try {
    outcome = await raceTimeout(run(async (tx) => {
      const guard = guardedDb(tx);
      try {
        const payload = await mods.readClientProgress(guard, { orgId, clientId });
        return { payload, threw: null, errors: guard.errors };
      } catch (err) {
        return { payload: null, threw: err, errors: guard.errors };
      }
    }), left());
  } catch (err) {
    if (err && err.isTimeout) {
      return check(
        id,
        "FAIL",
        `the progress read for the newest paying client did not finish inside ${seconds} seconds — the page would hang`,
        fix
      );
    }
    return check(id, "skip", `could not run the progress read: ${clip(err)}`);
  }

  const problems = [];
  if (outcome.threw) problems.push(`the read threw: ${clip(outcome.threw)}`);
  if (outcome.errors.some((e) => e && e.refused)) {
    problems.push("the progress read tried to run a query that is not a plain read, and the pulse refused it");
  } else if (outcome.errors.length) {
    const n = outcome.errors.length;
    problems.push(
      `${n} read${n === 1 ? "" : "s"} behind the page failed and the page would show an empty section: ${clip(outcome.errors[0])}`
    );
  }
  if (!outcome.threw) problems.push(...shapeProblems(outcome.payload));

  // 3. Hold the answer against the client's own rows.
  let rows = null;
  let rowsError = null;
  if (!outcome.threw && !outcome.errors.length) {
    try {
      rows = await raceTimeout(run(async (tx) => {
        const r = await tx.query(PROGRESS_ROWS_SQL, [orgId, clientId, mods.REPAIR_PIPELINE]);
        return r && r.rows ? r.rows[0] || null : null;
      }), left());
    } catch (err) {
      rowsError = err;
    }
  }
  const payload = outcome.payload;
  if (rows && payload && !problems.length) {
    const steps = Number(rows.waypoints);
    if (Array.isArray(payload.waypoints) && payload.waypoints.length !== steps) {
      problems.push(`the client has ${steps} checklist step${steps === 1 ? "" : "s"} on file and the page gets ${payload.waypoints.length}`);
    }
    const docs = Number(rows.deliverables);
    if (Array.isArray(payload.deliverables) && payload.deliverables.length !== docs) {
      problems.push(`the client has ${docs} document${docs === 1 ? "" : "s"} on file and the page gets ${payload.deliverables.length}`);
    }
    const stages = Array.isArray(rows.repair_stages) ? rows.repair_stages : [];
    if (stages.length && !stages.includes(payload.stage && payload.stage.key)) {
      problems.push(`the client's repair card is at "${stages[0]}" and the page shows "${(payload.stage && payload.stage.key) || "no stage"}"`);
    }
  }

  if (problems.length) {
    return check(id, "FAIL", `progress read for the newest paying client: ${problems.join("; ")}`, fix);
  }
  if (rowsError) {
    return check(id, "skip", `the read ran clean but its rows could not be counted for the cross-check: ${rowsError.isTimeout ? "no answer in time" : clip(rowsError)}`);
  }
  const scored = payload.scores.personal.filter((p) => p && p.score != null).length;
  return check(
    id,
    "PASS",
    `the real progress read ran for the newest paying client with no read failing: ` +
      `stage ${(payload.stage && payload.stage.key) || "not started"}, ${scored} of 3 scores, ` +
      `${payload.waypoints.length} checklist steps, ${payload.deliverables.length} documents, and the counts match the client's own rows`
  );
}

/* The audit asks the lane again (src/pulse/self-audit.mjs, makeLaneNaVerify). True only when
   the same read still finds waiting clients and every one is a client the row named and the
   owner holds. A failed read, a new waiting client, or nobody waiting at all is false. */
export const naVerify = Object.freeze({
  "owner-hold-client": async (args, ctx = {}) => {
    if (!args || args.check !== NEVER_SIGNED_IN_ID || typeof args.orgId !== "string" || !args.orgId) return false;
    const named = Array.isArray(args.clients) ? [...args.clients].sort() : [];
    const run = readerFor(ctx);
    if (!run) return false;
    const held = heldOnly(waitingOf(await readNeverSignedIn(run, args.orgId)));
    return !!held && held.length === named.length && held.every((code, i) => code === named[i]);
  }
});

/** Reads go through the staff scope when the run has one, and the shared pool
    when it does not. Every statement is a plain read. */
function readerFor(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/** One answer per address for the run, so the portal page is not fetched twice. */
function sharedFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") return fetchImpl;
  const seen = new Map();
  return (url, init) => {
    const key = `${String((init && init.method) || "GET").toUpperCase()} ${url}`;
    if (!seen.has(key)) {
      seen.set(key, (async () => {
        const res = await fetchImpl(url, init);
        const text = typeof res.text === "function" ? await res.text() : "";
        return { status: res.status, headers: res.headers, text };
      })());
    }
    return seen.get(key).then((r) => ({
      status: r.status,
      headers: r.headers,
      async text() { return r.text; }
    }));
  };
}

export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const rawFetch = ctx.fetchImpl || ctx.fetch || globalThis.fetch;
  const fetchImpl = sharedFetch(rawFetch);
  const baseUrl = ctx.baseUrl || DEFAULT_BASE_URL;
  let orgId = ctx.orgId || null;
  let orgError = null;
  if (!orgId && db) {
    try {
      orgId = await defaultOrgId(db);
    } catch (err) {
      orgError = err;
      orgId = null;
    }
  }
  const run = readerFor(ctx);
  if (orgError) {
    const detail = `could not read the default org: ${clip(orgError)}`;
    const [page, scripts] = await Promise.all([
      checkPortalPage({ fetchImpl, baseUrl }),
      checkPageScripts({ fetchImpl, baseUrl })
    ]);
    return [
      page,
      check("portal:summary", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:paid-entitlement", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:next-step", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      scripts,
      check("portal:progress-read-real-client", "skip", detail),
      check("portal:paid-client-never-signed-in", "skip", detail)
    ];
  }
  // Every check starts at once, so the lane stays well inside one step's clock.
  return Promise.all([
    checkPortalPage({ fetchImpl, baseUrl }),
    checkPortalSummary({ db, orgId }),
    checkPaidEntitlement({ db, orgId }),
    checkNextStep({ db, orgId }),
    checkPageScripts({ fetchImpl, baseUrl }),
    checkProgressRead({ run, orgId }),
    checkPaidNeverSignedIn({ run, orgId })
  ]);
}
