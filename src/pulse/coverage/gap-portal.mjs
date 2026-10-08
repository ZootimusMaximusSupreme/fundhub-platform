// Client portal after they are a client. Report only. Never auto-fix. Never text.
// Slice 26 already lists which doors sit in the pulse registry. This file does
// not repeat that list. It looks for four breaks on the live path:
//   portal page 404, portal summary 500, a paid client with no entitlement,
//   a journey step that should unlock and did not.
// Read-only SQL, plus a signed-out GET of the portal shell and the summary door.
// Do not log in as a real client. One tripwire: existing Recon (AG-07).
// Do not invent a second watchdog.

import {
  BLUEPRINT_PRODUCT_CODE,
  productCreatesChecklist
} from "../../waypoints/purchase.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const PORTAL_SHELL_PATH = "/app/client-portal.html";
export const PORTAL_SUMMARY_PATH = "/api/read/portal-summary";
export const RECON_CODE = "AG-07";
export const RECON_WORKFLOW = "daily-pulse";

const PAID = "succeeded";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).slice(0, 160);
}

/** Product codes whose payment must open the client checklist. */
export function checklistProductCodes() {
  const code = String(BLUEPRINT_PRODUCT_CODE || "").trim().toLowerCase();
  return productCreatesChecklist(code) ? [code] : [];
}

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  });
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
      return check("portal:page", "PASS", "client portal page loaded");
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

export async function checkPortalSummary({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  if (!fetchImpl) {
    return check("portal:summary", "skip", "no fetch in this run — portal summary not read");
  }
  const origin = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${origin}${PORTAL_SUMMARY_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "application/json");
    if (status >= 500) {
      return check(
        "portal:summary",
        "FAIL",
        `portal summary answered ${status}: ${text.slice(0, 120)}`,
        "Fix GET /api/read/portal-summary. Do not sign in as a real client. Do not auto-fix from this pulse."
      );
    }
    if (status === 404) {
      return check(
        "portal:summary",
        "FAIL",
        "portal summary is missing (404)",
        "Restore GET /api/read/portal-summary. Do not auto-fix from this pulse."
      );
    }
    if (
      status === 401 ||
      status === 403 ||
      status === 400 ||
      status === 405 ||
      (status >= 200 && status < 300)
    ) {
      return check(
        "portal:summary",
        "PASS",
        `portal summary answered ${status} with no client login`
      );
    }
    return check(
      "portal:summary",
      "FAIL",
      `portal summary answered ${status}`,
      "Fix GET /api/read/portal-summary so it does not crash. Do not sign in as a real client. Do not auto-fix from this pulse."
    );
  } catch (err) {
    return check(
      "portal:summary",
      "FAIL",
      `portal summary unreachable: ${clip(err)}`,
      "Confirm GET /api/read/portal-summary is deployed."
    );
  }
}

export async function checkPaidEntitlement({ db, orgId } = {}) {
  if (!db) {
    return check("portal:paid-entitlement", "skip", "no database in this run — paid entitlements not read");
  }
  if (!orgId) {
    return check("portal:paid-entitlement", "skip", "no org in this run — paid entitlements not read");
  }
  try {
    const { rows } = await db.query(
      `SELECT t.client_id, p.code AS product_code, pe.entitlement_code
         FROM transactions t
         JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
         JOIN product_entitlements pe
           ON pe.org_id = t.org_id
          AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
        WHERE t.org_id = $1
          AND lower(btrim(COALESCE(t.status, ''))) = $2
          AND t.client_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM clients c
             WHERE c.id = t.client_id
               AND c.org_id = t.org_id
               AND c.is_demo IS TRUE
          )
          AND NOT EXISTS (
            SELECT 1 FROM entitlements e
             WHERE e.org_id = t.org_id
               AND e.client_id = t.client_id
               AND e.entitlement_code = lower(btrim(pe.entitlement_code))
          )`,
      [orgId, PAID]
    );
    const clients = new Set((rows || []).map((r) => String(r.client_id)));
    if (clients.size === 0) {
      return check("portal:paid-entitlement", "PASS", "every paid mapped product has an entitlement row");
    }
    const n = clients.size;
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
    const { rows } = await db.query(
      `SELECT client_id, reason FROM (
         SELECT DISTINCT t.client_id, 'paid_checklist'::text AS reason
           FROM transactions t
           JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
          WHERE t.org_id = $1
            AND lower(btrim(COALESCE(t.status, ''))) = $2
            AND t.client_id IS NOT NULL
            AND lower(btrim(p.code)) = ANY($3::text[])
            AND NOT EXISTS (
              SELECT 1 FROM clients c
               WHERE c.id = t.client_id
                 AND c.org_id = t.org_id
                 AND c.is_demo IS TRUE
            )
            AND NOT EXISTS (
              SELECT 1 FROM client_waypoints w
               WHERE w.org_id = t.org_id AND w.client_id = t.client_id
            )
         UNION
         SELECT rp.client_id, 'repair_enrolled'::text
           FROM repair_programs rp
          WHERE rp.org_id = $1
            AND rp.status <> 'cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM clients c
               WHERE c.id = rp.client_id
                 AND c.org_id = rp.org_id
                 AND c.is_demo IS TRUE
            )
            AND NOT EXISTS (
              SELECT 1 FROM client_waypoints w
               WHERE w.org_id = rp.org_id AND w.client_id = rp.client_id
            )
       ) missing`,
      [orgId, PAID, codes]
    );
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

export async function checkReconTripwire({ db, orgId } = {}) {
  if (!db) {
    return check("portal:recon", "skip", "no database in this run — Recon status not read");
  }
  if (!orgId) {
    return check("portal:recon", "skip", "no org in this run — Recon status not read");
  }
  try {
    const { rows } = await db.query(
      `SELECT code, status, runtime, runtime_ref
         FROM agents
        WHERE org_id = $1 AND code = $2
        LIMIT 1`,
      [orgId, RECON_CODE]
    );
    const row = rows && rows[0];
    if (!row) {
      return check(
        "portal:recon",
        "FAIL",
        "AG-07 is missing",
        "Re-seed Recon (AG-07). Do not invent a second watchdog."
      );
    }
    if (row.status !== "live" || row.runtime !== "inngest" || row.runtime_ref !== RECON_WORKFLOW) {
      return check(
        "portal:recon",
        "FAIL",
        `AG-07 status=${row.status} runtime=${row.runtime} ref=${row.runtime_ref}`,
        "Turn AG-07 live on inngest / daily-pulse. Do not invent a second watchdog."
      );
    }
    return check("portal:recon", "PASS", "AG-07 Recon is live on daily-pulse");
  } catch (err) {
    return check(
      "portal:recon",
      "FAIL",
      `Recon read failed: ${clip(err)}`,
      "Read AG-07. Do not invent a second watchdog."
    );
  }
}

export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const fetchImpl = ctx.fetchImpl === undefined ? globalThis.fetch : ctx.fetchImpl;
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
      await checkPortalSummary({ fetchImpl, baseUrl }),
      check("portal:paid-entitlement", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:next-step", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:recon", "FAIL", detail, "Read AG-07. Do not invent a second watchdog.")
    ];
  }
  return [
    await checkPortalPage({ fetchImpl, baseUrl }),
    await checkPortalSummary({ fetchImpl, baseUrl }),
    await checkPaidEntitlement({ db, orgId }),
    await checkNextStep({ db, orgId }),
    await checkReconTripwire({ db, orgId })
  ];
}
