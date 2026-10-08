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

import {
  BLUEPRINT_PRODUCT_CODE,
  productCreatesChecklist
} from "../../waypoints/purchase.mjs";
import { listClientLibrary } from "../../documents/retrieve.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const PORTAL_SHELL_PATH = "/app/client-portal.html";
export const PORTAL_SUMMARY_PATH = "/api/read/portal-summary";

const PAID = "succeeded";

/** A payment younger than this may still be on its way through the webhook. */
export const GRACE = "1 hour";

/* A test client is one nobody is selling to: the demo flag, the synthetic flag
   (scripts/sim/flag-sim-clients.mjs sets it), the +walk-N / +sim-N tags that the
   sim seeder writes into every address, or an address on a domain reserved for
   testing. Measured 2026-10-08: the seven "paid, no entitlement" clients were all
   +walk-0N / +sim-NN walk clients that nobody had flagged yet. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost)$`;

export const PAID_ENTITLEMENT_SQL = `
/* gap:portal-paid-entitlement */
WITH paid AS (
  SELECT t.org_id, t.client_id, pe.entitlement_code,
         (c.is_demo IS TRUE
          OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(c.email, '') ~* $3) AS is_test
    FROM transactions t
    JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
    JOIN product_entitlements pe
      ON pe.org_id = t.org_id
     AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
    LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
   WHERE t.org_id = $1::uuid
     AND lower(btrim(COALESCE(t.status, ''))) = $2
     AND t.client_id IS NOT NULL
     AND t.is_demo IS NOT TRUE
     AND t.created_at < now() - interval '${GRACE}'
)
SELECT p.client_id::text AS client_id,
       p.is_test,
       EXISTS (
         SELECT 1 FROM entitlements e
          WHERE e.org_id = p.org_id
            AND e.client_id = p.client_id
            AND e.entitlement_code = lower(btrim(p.entitlement_code))
       ) AS has_entitlement
  FROM paid p
`.trim();

export const NEXT_STEP_SQL = `
/* gap:portal-next-step */
SELECT client_id, reason FROM (
  SELECT DISTINCT t.client_id::text AS client_id, 'paid_checklist'::text AS reason
    FROM transactions t
    JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
    LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
   WHERE t.org_id = $1::uuid
     AND lower(btrim(COALESCE(t.status, ''))) = $2
     AND t.client_id IS NOT NULL
     AND t.is_demo IS NOT TRUE
     AND t.created_at < now() - interval '${GRACE}'
     AND lower(btrim(p.code)) = ANY($3::text[])
     AND NOT (c.is_demo IS TRUE
              OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
              OR COALESCE(c.email, '') ~* $4)
     AND NOT EXISTS (
       SELECT 1 FROM client_waypoints w
        WHERE w.org_id = t.org_id AND w.client_id = t.client_id
     )
  UNION
  SELECT rp.client_id::text, 'repair_enrolled'::text
    FROM repair_programs rp
    LEFT JOIN clients c ON c.id = rp.client_id AND c.org_id = rp.org_id
   WHERE rp.org_id = $1::uuid
     AND rp.status <> 'cancelled'
     AND rp.created_at < now() - interval '${GRACE}'
     AND NOT (c.is_demo IS TRUE
              OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
              OR COALESCE(c.email, '') ~* $4)
     AND NOT EXISTS (
       SELECT 1 FROM client_waypoints w
        WHERE w.org_id = rp.org_id AND w.client_id = rp.client_id
     )
) missing
`.trim();

/* One client to run the summary reads against: the newest real one. */
export const SUMMARY_CLIENT_SQL = `
/* gap:portal-summary-client */
SELECT c.id::text AS id
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND c.is_demo IS NOT TRUE
 ORDER BY c.created_at DESC
 LIMIT 1
`.trim();

/* These four are copied word for word from api/read/portal-summary.mjs. If the
   handler changes one, gap-portal.test.mjs fails until this file follows it.
   They are the reads that turn the whole summary into a 500 when they throw;
   every other read in that handler fails soft. */
export const SUMMARY_READS = Object.freeze([
  {
    label: "client",
    sql: `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`
  },
  {
    label: "credit results",
    sql: `SELECT id, outcome_tier, result, created_at, is_demo
           FROM crs_results
          WHERE client_id = $1 AND org_id = $2
            AND is_demo IS NOT TRUE
          ORDER BY created_at DESC`
  },
  {
    label: "businesses",
    sql: `SELECT name, age_months, entity_data
           FROM businesses
          WHERE client_id = $1 AND org_id = $2
          ORDER BY updated_at DESC
          LIMIT 5`
  },
  {
    label: "inquiry case",
    sql: `SELECT 1
           FROM inquiry_removal_cases
          WHERE client_id = $1 AND org_id = $2
            AND closed_at IS NULL
            AND is_demo IS NOT TRUE
          LIMIT 1`
  }
]);

export const READ_ONLY_SQL = Object.freeze([
  PAID_ENTITLEMENT_SQL,
  NEXT_STEP_SQL,
  SUMMARY_CLIENT_SQL,
  ...SUMMARY_READS.map((r) => r.sql)
]);

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Product codes whose payment must open the client checklist. */
export function checklistProductCodes() {
  const code = String(BLUEPRINT_PRODUCT_CODE || "").trim().toLowerCase();
  return productCreatesChecklist(code) ? [code] : [];
}

async function readGet(fetchImpl, url, accept) {
  const init = {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  };
  // A page that never answers must not hold up the whole morning pulse.
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(15000);
  }
  const res = await fetchImpl(url, init);
  const text = typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res.status), text: String(text || "") };
}

async function defaultOrgId(db) {
  const { rows } = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  return rows[0]?.id || null;
}

export async function checkPortalPage({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  if (!fetchImpl) {
    return check("portal:page", "skip", "no fetch in this run — portal page not read");
  }
  const origin = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${origin}${PORTAL_SHELL_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "text/html");
    if (status === 404) {
      return check(
        "portal:page",
        "FAIL",
        "client portal page answered 404",
        "Put the client portal page back at /app/client-portal.html. Do not auto-fix from this pulse."
      );
    }
    const looksLikePortal = /data-tile=/i.test(text);
    if (status >= 200 && status < 300 && looksLikePortal) {
      return check("portal:page", "PASS", "client portal page loaded with its tiles");
    }
    return check(
      "portal:page",
      "FAIL",
      `client portal page answered ${status}, portal tiles missing=${!looksLikePortal}`,
      "Restore /app/client-portal.html so a client can open their portal. Do not auto-fix from this pulse."
    );
  } catch (err) {
    return check(
      "portal:page",
      "FAIL",
      `client portal page unreachable: ${clip(err)}`,
      "Confirm https://fundhub.ai/app/client-portal.html is deployed."
    );
  }
}

/**
 * Run the reads that make the portal summary 500 when they throw, for one real
 * client. The handler needs a signed-in client, which this pulse never is, so a
 * signed-out ping only ever sees the 401 (reg:read/portal-summary does that).
 * This reads the database the way the handler does, so a dropped column or a
 * missing table fails here the same way.
 */
export async function checkPortalSummary({ db, orgId } = {}) {
  const id = "portal:summary";
  if (!db) return check(id, "skip", "no database in this run — portal summary reads not run");
  if (!orgId) return check(id, "skip", "no org in this run — portal summary reads not run");
  const fix = "Fix the read named above in GET /api/read/portal-summary. Do not sign in as a real client. Do not auto-fix from this pulse.";

  let clientId;
  try {
    const found = await db.query(SUMMARY_CLIENT_SQL, [orgId]);
    clientId = found && found.rows && found.rows[0] ? found.rows[0].id : null;
  } catch (err) {
    return check(id, "FAIL", `portal summary could not pick a client to read: ${clip(err)}`, fix);
  }
  if (!clientId) return check(id, "skip", "no real client on file — portal summary reads not run");

  for (const read of SUMMARY_READS) {
    try {
      await db.query(read.sql, [clientId, orgId]);
    } catch (err) {
      return check(id, "FAIL", `portal summary read "${read.label}" failed: ${clip(err)}`, fix);
    }
  }
  try {
    await listClientLibrary(db, { orgId, clientId, sign: false });
  } catch (err) {
    return check(id, "FAIL", `portal summary read "documents" failed: ${clip(err)}`, fix);
  }
  return check(
    id,
    "PASS",
    `the ${SUMMARY_READS.length + 1} reads the portal summary needs ran for one client with no error`
  );
}

export async function checkPaidEntitlement({ db, orgId } = {}) {
  if (!db) {
    return check("portal:paid-entitlement", "skip", "no database in this run — paid entitlements not read");
  }
  if (!orgId) {
    return check("portal:paid-entitlement", "skip", "no org in this run — paid entitlements not read");
  }
  try {
    const { rows } = await db.query(PAID_ENTITLEMENT_SQL, [orgId, PAID, TEST_CLIENT_EMAIL_RE]);
    const all = rows || [];
    const real = all.filter((r) => r.is_test !== true);
    const testMissing = new Set(
      all.filter((r) => r.is_test === true && r.has_entitlement !== true).map((r) => String(r.client_id))
    );
    const missing = new Set(
      real.filter((r) => r.has_entitlement !== true).map((r) => String(r.client_id))
    );
    if (missing.size === 0) {
      const note = testMissing.size
        ? ` ${testMissing.size} test client${testMissing.size === 1 ? " has" : "s have"} none and ${testMissing.size === 1 ? "is" : "are"} left out.`
        : "";
      return check(
        "portal:paid-entitlement",
        "PASS",
        `every paid mapped product has an entitlement row (${real.length} real purchases read).${note}`
      );
    }
    const n = missing.size;
    return check(
      "portal:paid-entitlement",
      "FAIL",
      `${n} paid client${n === 1 ? "" : "s"} ha${n === 1 ? "s" : "ve"} no entitlement for a mapped product`,
      "Write the entitlement the product map already names. Use the existing reconcile. Do not create a new catalog product. Do not auto-fix from this pulse."
    );
  } catch (err) {
    return check(
      "portal:paid-entitlement",
      "FAIL",
      `paid entitlement read failed: ${clip(err)}`,
      "Read the entitlement ledger. Do not auto-fix from this pulse."
    );
  }
}

export async function checkNextStep({ db, orgId } = {}) {
  if (!db) {
    return check("portal:next-step", "skip", "no database in this run — journey steps not read");
  }
  if (!orgId) {
    return check("portal:next-step", "skip", "no org in this run — journey steps not read");
  }
  const codes = checklistProductCodes();
  try {
    const { rows } = await db.query(NEXT_STEP_SQL, [orgId, PAID, codes, TEST_CLIENT_EMAIL_RE]);
    const clients = new Set((rows || []).map((r) => String(r.client_id)));
    if (clients.size === 0) {
      return check("portal:next-step", "PASS", "paid checklist clients and repair enrolments have journey steps");
    }
    const n = clients.size;
    return check(
      "portal:next-step",
      "FAIL",
      `${n} client${n === 1 ? "" : "s"} should have a next step and the checklist is empty`,
      "Use the checklist that already runs for a blueprint payment or a repair enrolment. Do not invent new steps. Do not auto-fix from this pulse."
    );
  } catch (err) {
    return check(
      "portal:next-step",
      "FAIL",
      `journey step read failed: ${clip(err)}`,
      "Read client waypoints. Do not auto-fix from this pulse."
    );
  }
}

export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const fetchImpl = ctx.fetchImpl || ctx.fetch || globalThis.fetch;
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
  if (orgError) {
    const detail = `could not read the default org: ${clip(orgError)}`;
    return [
      await checkPortalPage({ fetchImpl, baseUrl }),
      check("portal:summary", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:paid-entitlement", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:next-step", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse.")
    ];
  }
  return [
    await checkPortalPage({ fetchImpl, baseUrl }),
    await checkPortalSummary({ db, orgId }),
    await checkPaidEntitlement({ db, orgId }),
    await checkNextStep({ db, orgId })
  ];
}
