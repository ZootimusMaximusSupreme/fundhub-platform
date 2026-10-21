// The client portal truth: the SQL, the page reads and the verdicts the morning lane
// src/pulse/coverage/gap-portal.mjs and the hourly beat client-portal both run.
//
// Moved here unchanged from gap-portal.mjs (2026-10-20), except for how they read:
//   - the database comes in as `db` (db.query) or `run` (a scope), exactly as before;
//   - the web comes in as `web(url, init)`, the same call shape the lane's fetch had.
//     The lane passes its fetch; the hourly beat passes webFromProbe(ctx.http) below.
//   - checklistProductCodes and readClientLibrary are copies of code a beat cannot
//     import (src/waypoints/purchase.mjs, src/documents/retrieve.mjs). gap-portal.test.mjs
//     holds each copy equal to its original.
// The real progress read (portal:progress-read-real-client) is not here: it lives in
// ./progress-check.mjs with the read it runs (./progress-read.mjs), and runs in the hourly
// beat client-progress (2026-10-20).
//
// Read only: SELECT for the database, GET for the web. Report only. Never auto-fix.

import { onOwnerHold } from "./owner-hold.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const PORTAL_SHELL_PATH = "/app/client-portal.html";
export const PORTAL_SUMMARY_PATH = "/api/read/portal-summary";

export const PAID = "succeeded";

/** A payment younger than this may still be on its way through the webhook. */
export const GRACE = "1 hour";

/* A test client is one nobody is selling to: the demo flag, the synthetic flag
   (scripts/sim/flag-sim-clients.mjs sets it), the +walk-N / +sim-N tags that the
   sim seeder writes into every address, or an address on a domain reserved for
   testing. Measured 2026-10-08: the seven "paid, no entitlement" clients were all
   +walk-0N / +sim-NN walk clients that nobody had flagged yet. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$`;

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

/* The payment the join above cannot see: a product_name that matches no product
   and no alias. resolve_product_id() hands back NULL, so the join drops it and a
   renamed or brand-new product name would pass unnoticed. reconcileFromTransactions
   counts the same row as "unresolved" and leaves it alone.
   A name that matches nothing is not a break by itself: the one real purchase on
   file ("Consulting Services Standard") has an old name and its client still holds
   an entitlement from another path. So a row only counts when the client holds NO
   entitlement of any kind.
   It also has to have come in through the payment door. Every real payment leaves
   a payment.received event for its client in the same moment; a row dropped
   straight into transactions leaves none (measured 2026-10-08: the 10-07 test
   batch). Those are counted apart, not failed. */
export const UNRESOLVED_PAID_SQL = `
/* gap:portal-unresolved-paid */
SELECT t.client_id::text AS client_id,
       (c.is_demo IS TRUE
        OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
        OR COALESCE(c.email, '') ~* $3) AS is_test,
       EXISTS (
         SELECT 1 FROM entitlements e
          WHERE e.org_id = t.org_id
            AND e.client_id = t.client_id
       ) AS has_any_entitlement,
       EXISTS (
         SELECT 1 FROM events ev
          WHERE ev.org_id = t.org_id
            AND ev.client_id = t.client_id
            AND ev.name = 'payment.received'
            AND ev.created_at BETWEEN t.created_at - interval '1 day'
                                  AND t.created_at + interval '1 day'
       ) AS came_through_the_door
  FROM transactions t
  LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
 WHERE t.org_id = $1::uuid
   AND lower(btrim(COALESCE(t.status, ''))) = $2
   AND t.client_id IS NOT NULL
   AND t.is_demo IS NOT TRUE
   AND t.created_at < now() - interval '${GRACE}'
   AND resolve_product_id(t.org_id, t.product_name) IS NULL
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
  UNRESOLVED_PAID_SQL,
  NEXT_STEP_SQL,
  SUMMARY_CLIENT_SQL,
  ...SUMMARY_READS.map((r) => r.sql)
]);

/* The portal summary's documents read: listClientLibrary(db, { orgId, clientId,
   sign: false }) in src/documents/retrieve.mjs, as the SQL text and parameters it
   sends. A beat cannot import that module, so this is a copy. gap-portal.test.mjs
   runs the real function and this one against the same fake database and fails on
   any difference in the SQL or the parameters. With sign: false the real function
   only renames columns after the read, so the read is the whole of it. */
const PUBLIC_DOC_COLUMNS = `
  d.id, d.org_id, d.client_id, d.document_key, d.kind, d.subtype, d.title,
  d.invoice_id, d.current_version, d.current_version_id,
  d.mime_type, d.byte_size, d.checksum, d.generated_by, d.generated_at,
  d.delivered_at, d.delivery_channel, d.delivery_status,
  d.signature_required, d.signed_at, d.signer_name, d.signature_ref,
  d.expires_at, d.metadata, d.created_at, d.updated_at`;

export const LIBRARY_SQL = `SELECT ${PUBLIC_DOC_COLUMNS},
            count(v.id)::int AS version_count
       FROM documents d
       LEFT JOIN document_versions v ON v.document_id = d.id
      WHERE d.org_id = $1
        AND d.client_id = $2
        AND ($3::text[] IS NULL OR d.kind = ANY($3))
        AND ($4::uuid[] IS NULL OR d.id = ANY($4))
        AND ($5::boolean OR d.expires_at IS NULL OR d.expires_at > now())
      GROUP BY d.id
      ORDER BY d.kind ASC, d.generated_at DESC`;

/** The documents read the portal summary runs, for one client. Throws when it fails. */
export async function readClientLibrary(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) throw new Error("listClientLibrary requires orgId and clientId");
  const res = await db.query(LIBRARY_SQL, [orgId, clientId, null, null, true]);
  return res.rows;
}

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

/* The product that opens the client checklist: src/waypoints/purchase.mjs
   BLUEPRINT_PRODUCT_CODE (OFFERS.UWIQ_DELIVERABLES.productCode), the one code in its
   CHECKLIST_PRODUCT_CODES. A beat cannot import that module, so the value is carried
   here; gap-portal.test.mjs holds checklistProductCodes() equal to what
   productCreatesChecklist(BLUEPRINT_PRODUCT_CODE) says. */
export const CHECKLIST_PRODUCT_CODES = Object.freeze(["consulting-package"]);

/** Product codes whose payment must open the client checklist. */
export function checklistProductCodes() {
  return [...CHECKLIST_PRODUCT_CODES];
}

async function readGet(web, url, accept) {
  const init = {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  };
  // A page that never answers must not hold up the whole morning pulse.
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(15000);
  }
  const res = await web(url, init);
  const text = typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res.status), text: String(text || "") };
}

export async function checkPortalPage({ web, baseUrl = DEFAULT_BASE_URL } = {}) {
  if (!web) {
    return check("portal:page", "skip", "no fetch in this run — portal page not read");
  }
  const origin = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${origin}${PORTAL_SHELL_PATH}`;
  try {
    const { status, text } = await readGet(web, url, "text/html");
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
    await readClientLibrary(db, { orgId, clientId });
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

    // A paid row whose product name matches no product drops out of the join
    // above. Read those apart (see UNRESOLVED_PAID_SQL for what counts).
    const unresolvedOut = await db.query(UNRESOLVED_PAID_SQL, [orgId, PAID, TEST_CLIENT_EMAIL_RE]);
    const unresolved = ((unresolvedOut && unresolvedOut.rows) || []).filter((r) => r.is_test !== true);
    const stranded = new Set(
      unresolved
        .filter((r) => r.has_any_entitlement !== true && r.came_through_the_door === true)
        .map((r) => String(r.client_id))
    );
    const noDoor = new Set(
      unresolved
        .filter((r) => r.has_any_entitlement !== true && r.came_through_the_door !== true)
        .map((r) => String(r.client_id))
    );

    if (missing.size === 0 && stranded.size === 0) {
      const testNote = testMissing.size
        ? ` ${testMissing.size} test client${testMissing.size === 1 ? " has" : "s have"} none and ${testMissing.size === 1 ? "is" : "are"} left out.`
        : "";
      const doorNote = noDoor.size
        ? ` ${noDoor.size} payment${noDoor.size === 1 ? "" : "s"} with no payment event ${noDoor.size === 1 ? "is" : "are"} left out.`
        : "";
      return check(
        "portal:paid-entitlement",
        "PASS",
        `every paid mapped product has an entitlement row (${real.length} paid rows read, plus ` +
          `${unresolved.length} under a product name that matches no product).${testNote}${doorNote}`
      );
    }
    const parts = [];
    if (missing.size) {
      const n = missing.size;
      parts.push(`${n} paid client${n === 1 ? "" : "s"} ha${n === 1 ? "s" : "ve"} no entitlement for a mapped product`);
    }
    if (stranded.size) {
      const n = stranded.size;
      parts.push(
        `${n} paid client${n === 1 ? "" : "s"} paid under a product name that matches no product and hold${n === 1 ? "s" : ""} no entitlement at all`
      );
    }
    const fixes = [];
    if (missing.size) {
      fixes.push("Write the entitlement the product map already names. Use the existing reconcile. Do not create a new catalog product.");
    }
    if (stranded.size) {
      fixes.push("Add the product name as an alias on the product it belongs to, then use the existing reconcile. Do not guess a product.");
    }
    return check(
      "portal:paid-entitlement",
      "FAIL",
      parts.join(". "),
      `${fixes.join(" ")} Do not auto-fix from this pulse.`
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

/* ═══════════════════════════════════════════════════════════════════════════
   Tier 1 tripwires — Claude, 2026-10-09
   ═══════════════════════════════════════════════════════════════════════════ */

/* A test client for the two checks below that look at who PAID. Wider than
   TEST_CLIENT_EMAIL_RE on purpose, and kept apart so portal:paid-entitlement and
   portal:next-step do not change. Measured 2026-10-09: the 10-07 test batch also
   left clients on test+...@fundhub.ai, e2e+...@fundhub.ai and
   ...+test.commas.NNN@gmail.com addresses, and the e2e ones DO carry a payment
   event, so the payment event alone does not tell a test from a buyer. */
export const INTERNAL_CLIENT_EMAIL_RE =
  `${TEST_CLIENT_EMAIL_RE}|^(test|e2e)\\+|\\+test[._-]|@fundhub\\.ai$`;

/* Held access older than this with no sign-in is a customer we have lost touch
   with. The welcome mail and the sign-in link go out when access is granted. */
export const SIGN_IN_GRACE = "72 hours";

/* The same mark portal:paid-entitlement uses for "this payment came in through
   the payment door": a payment.received event for the client within a day of the
   transaction. A row pasted straight into transactions leaves none. */
export const PAID_THROUGH_THE_DOOR_SQL = `EXISTS (
         SELECT 1 FROM events ev
          WHERE ev.org_id = t.org_id
            AND ev.client_id = t.client_id
            AND ev.name = 'payment.received'
            AND ev.created_at BETWEEN t.created_at - interval '1 day'
                                  AND t.created_at + interval '1 day'
       )`;

/* Every paying client who holds access: a live entitlement or a stored pack.
   One row per client. "since" is when the access was first given, so the 72
   hours start there and not at the payment (a payment can sit days before the
   access lands). A paying client is one with a succeeded, non-demo payment that
   came through the payment door.

   asked_since_access: did the client ask for a sign-in link AFTER access was
   given? A request is theirs when it is bound to the client OR when the address
   typed is the client's own address. Both are needed: a request that finds no
   account or client is stored with client_id NULL and account_id NULL (see
   db/migrations/117_account_magic_links.sql), so the address is the only thing
   that ties it to the person. A request made before access was given does not
   count, because it could not have worked. Measured 2026-10-09: the one waiting
   client typed their address on 09-27, was refused (no_account), and had access
   given on 10-05; matching on client_id alone said they had never asked. */
export const NEVER_SIGNED_IN_SQL = `
/* gap:portal-never-signed-in */
WITH access AS (
  SELECT e.org_id, e.client_id, min(e.granted_at) AS since
    FROM entitlements e
   WHERE e.org_id = $1::uuid
     AND e.revoked_at IS NULL
     AND (e.expires_at IS NULL OR e.expires_at > now())
     AND e.is_demo IS NOT TRUE
   GROUP BY e.org_id, e.client_id
  UNION ALL
  SELECT d.org_id, d.client_id, min(COALESCE(d.generated_at, d.created_at))
    FROM documents d
   WHERE d.org_id = $1::uuid
     AND d.kind = 'deliverable'
     AND d.is_demo IS NOT TRUE
     AND d.client_id IS NOT NULL
   GROUP BY d.org_id, d.client_id
), held AS (
  SELECT org_id, client_id, min(since) AS since
    FROM access
   GROUP BY org_id, client_id
)
SELECT h.client_id::text AS client_id,
       c.client_code,
       EXTRACT(EPOCH FROM (now() - h.since)) / 86400.0 AS days_held,
       (c.is_demo IS TRUE
        OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
        OR COALESCE(c.email, '') ~* $2) AS is_test,
       EXISTS (
         SELECT 1 FROM transactions t
          WHERE t.org_id = h.org_id
            AND t.client_id = h.client_id
            AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
            AND t.is_demo IS NOT TRUE
            AND ${PAID_THROUGH_THE_DOOR_SQL}
       ) AS paid_through_door,
       (EXISTS (
          SELECT 1 FROM accounts a
           WHERE a.org_id = h.org_id
             AND a.client_id = h.client_id
             AND a.kind = 'client'
             AND a.last_login_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM account_magic_links m
           WHERE m.org_id = h.org_id
             AND m.consumed_at IS NOT NULL
             AND (m.client_id = h.client_id
                  OR m.account_id IN (
                       SELECT a2.id FROM accounts a2
                        WHERE a2.org_id = h.org_id AND a2.client_id = h.client_id))
        )) AS signed_in,
       EXISTS (
         SELECT 1 FROM account_magic_links m2
          WHERE m2.org_id = h.org_id
            AND m2.created_at >= h.since
            AND (m2.client_id = h.client_id
                 OR m2.email = lower(btrim(COALESCE(c.email, ''))))
       ) AS asked_since_access
  FROM held h
  JOIN clients c ON c.id = h.client_id AND c.org_id = h.org_id
 WHERE h.since < now() - interval '${SIGN_IN_GRACE}'
`.trim();


/* ── portal:page-scripts-load ───────────────────────────────────────────────
   The six pages a customer opens, as the live site serves them. `needs` are the
   few things the page cannot work without; `needsScripts` says the page is
   empty without its scripts (client-portal and FinanceOS draw everything from
   them). Nothing else about the page's words is pinned, so a copy change is not
   a false alarm. The progress page is /progress.html (public/progress.html), not
   under /app/. */
export const CUSTOMER_PAGES = Object.freeze([
  Object.freeze({
    path: "/portal-login.html",
    needs: Object.freeze([
      { re: /<form\b/i, label: "its sign-in form" },
      { re: /type="email"/i, label: "its email box" }
    ])
  }),
  Object.freeze({
    path: "/reset-password.html",
    needs: Object.freeze([
      { re: /<form\b/i, label: "its form" },
      { re: /type="password"/i, label: "its reset fields" }
    ])
  }),
  Object.freeze({
    path: "/app/client-portal.html",
    needsScripts: true,
    needs: Object.freeze([{ re: /data-tile=/i, label: "its tiles" }])
  }),
  Object.freeze({ path: "/progress.html", needs: Object.freeze([]) }),
  Object.freeze({ path: "/app/payment-success.html", needs: Object.freeze([]) }),
  Object.freeze({ path: "/app/financeos.html", needsScripts: true, needs: Object.freeze([]) })
]);

const FILE_TIMEOUT_MS = 8000;
export const PAGES_BUDGET_MS = 14000;
const FILE_CONCURRENCY = 8;
const MIN_PAGE_BYTES = 500;
const LISTED_PROBLEMS = 4;

function attrsOf(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/**
 * The same-origin script and style files one page names, read from the page's
 * own text. Comments are ignored. A script that only a service worker line names
 * (SW_URL or serviceWorker.register) is included, because the portal's push
 * notices die without it.
 * @returns {Array<{url: string, kind: "script"|"style", worker: boolean}>}
 */
export function pageAssets(html, pageUrl, origin) {
  const text = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const found = new Map();
  const add = (value, kind, worker = false) => {
    if (value == null || String(value).trim() === "") return;
    let u;
    try { u = new URL(String(value).trim(), pageUrl); } catch { return; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    if (u.origin !== origin) return;
    u.hash = "";
    const key = `${u.pathname}${u.search}`;
    if (!found.has(key)) found.set(key, { url: u.href, kind, worker });
  };
  const tags = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = tags.exec(text))) {
    const tag = m[0];
    const attrs = attrsOf(tag);
    if (m[1].toLowerCase() === "script") {
      add(attrs.src, "script");
    } else {
      const rel = String(attrs.rel || "").toLowerCase().split(/\s+/);
      if (rel.includes("stylesheet")) add(attrs.href, "style");
      else if (rel.includes("modulepreload")) add(attrs.href, "script");
    }
  }
  const sw = /(?:serviceWorker\s*\.\s*register\(\s*|\bSW_URL\s*=\s*)["']([^"']+)["']/g;
  while ((m = sw.exec(text))) add(m[1], "script", true);
  return [...found.values()];
}

function pageProblem(page, body) {
  if (body.length < MIN_PAGE_BYTES) return `came back almost empty (${body.length} bytes)`;
  if (!/<\/html>/i.test(body)) return "is cut short (no closing html tag)";
  const title = /<title>([\s\S]*?)<\/title>/i.exec(body);
  if (!title || !title[1].trim()) return "has no title";
  for (const need of page.needs) {
    if (!need.re.test(body)) return `has lost ${need.label}`;
  }
  return null;
}

async function getFile(web, url, deadline) {
  const left = Math.min(FILE_TIMEOUT_MS, deadline - Date.now());
  if (left <= 0) return { unread: true };
  const init = { method: "GET", credentials: "omit", headers: { accept: "*/*" } };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(left);
  }
  try {
    const res = await web(url, init);
    // Only webFromProbe sets this: a page it could not read to the end is not read,
    // never judged on half its text. A real fetch answer has no such field.
    if (res && res.partial === true) return { unread: true, cut: true };
    const body = typeof res.text === "function" ? await res.text() : "";
    const type = res.headers && typeof res.headers.get === "function"
      ? String(res.headers.get("content-type") || "") : "";
    return { status: Number(res.status), body: String(body || ""), type };
  } catch (err) {
    return { error: clip(err) };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}

export async function checkPageScripts({
  web, baseUrl = DEFAULT_BASE_URL, budgetMs = PAGES_BUDGET_MS
} = {}) {
  const id = "portal:page-scripts-load";
  if (typeof web !== "function") {
    return check(id, "skip", "no fetch in this run — customer pages and their scripts not read");
  }
  const origin = new URL(String(baseUrl || DEFAULT_BASE_URL)).origin;
  const deadline = Date.now() + budgetMs;
  const problems = [];
  let unread = 0;

  const pages = await Promise.all(CUSTOMER_PAGES.map(async (page) => {
    const url = `${origin}${page.path}`;
    return { page, url, got: await getFile(web, url, deadline) };
  }));

  const files = new Map();
  let pagesWhole = 0;
  for (const { page, url, got } of pages) {
    if (got.unread) { unread += 1; continue; }
    if (got.error) { problems.push(`${page.path} did not answer (${got.error})`); continue; }
    if (got.status !== 200) { problems.push(`${page.path} answered ${got.status}`); continue; }
    const why = pageProblem(page, got.body);
    if (why) problems.push(`${page.path} ${why}`);
    else pagesWhole += 1;
    const assets = pageAssets(got.body, url, origin);
    // A service worker named in a line of code does not count as one of the
    // page's own scripts: a page with only that is still empty.
    if (page.needsScripts && !assets.some((a) => a.kind === "script" && !a.worker)) {
      problems.push(`${page.path} names no script at all`);
    }
    for (const a of assets) {
      const key = new URL(a.url);
      const name = `${key.pathname}${key.search}`;
      if (!files.has(name)) files.set(name, { name, url: a.url, kind: a.kind, page: page.path });
    }
  }

  const list = [...files.values()];
  const results = await mapLimit(list, FILE_CONCURRENCY, async (f) => ({
    f, got: await getFile(web, f.url, deadline)
  }));
  for (const { f, got } of results) {
    if (got.unread) { unread += 1; continue; }
    const where = f.name;
    if (got.error) problems.push(`${where} did not answer (${got.error})`);
    else if (got.status !== 200) problems.push(`${where} answered ${got.status}`);
    else if (got.body.trim() === "") problems.push(`${where} is empty`);
    else if (/text\/html/i.test(got.type)) {
      problems.push(`${where} came back as a web page, not a ${f.kind === "script" ? "script" : "style file"}`);
    }
  }

  if (problems.length) {
    const shown = problems.slice(0, LISTED_PROBLEMS).join("; ");
    const more = problems.length > LISTED_PROBLEMS ? `; and ${problems.length - LISTED_PROBLEMS} more` : "";
    return check(
      id,
      "FAIL",
      `${problems.length} problem${problems.length === 1 ? "" : "s"} on the customer pages: ${shown}${more}`,
      "Put back the page or file named above so the page loads whole. Do not auto-fix from this pulse."
    );
  }
  if (unread) {
    const cut = [...pages.map((p) => p.got), ...results.map((r) => r.got)].filter((got) => got.cut).length;
    const why = cut
      ? `${cut} page${cut === 1 ? "" : "s"} could not be read to the end in byte ranges`
      : `ran out of time (${Math.round(budgetMs / 1000)} s)`;
    return check(
      id,
      "skip",
      `${why} with ${unread} of ${CUSTOMER_PAGES.length + list.length} files not read; nothing red in the rest`
    );
  }
  return check(
    id,
    "PASS",
    `${pagesWhole} customer pages answered whole and all ${list.length} script and style files they name answered with content`
  );
}

export function raceTimeout(promise, ms) {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { isTimeout: true })), ms);
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

/* ── portal:paid-client-never-signed-in ─────────────────────────────────────
   A client who paid, was given access, and has not signed in. The sign-in link
   creates the account the first time it is used, so a client with no account row
   at all has not signed in either. */
export const NEVER_SIGNED_IN_ID = "portal:paid-client-never-signed-in";
export const READ_TIMEOUT_MS = 12000;

export async function readNeverSignedIn(run, orgId) {
  return raceTimeout(run(async (tx) => {
    const r = await tx.query(NEVER_SIGNED_IN_SQL, [orgId, INTERNAL_CLIENT_EMAIL_RE]);
    return (r && r.rows) || [];
  }), READ_TIMEOUT_MS);
}

/* Paying clients past the 72 hours who have not signed in: real, paid through the door. */
export function waitingOf(rows) {
  return rows.filter((r) => r.is_test !== true && r.paid_through_door === true && r.signed_in !== true);
}

/* The held client codes when EVERY waiting client is on the owner's no-contact hold, else null. */
export function heldOnly(waiting) {
  if (!waiting.length || !waiting.every((r) => onOwnerHold(r.client_code))) return null;
  return [...new Set(waiting.map((r) => r.client_code))].sort();
}

export async function checkPaidNeverSignedIn({ run, orgId } = {}) {
  const id = NEVER_SIGNED_IN_ID;
  if (typeof run !== "function") return check(id, "skip", "no database in this run — client sign-ins not read");
  if (!orgId) return check(id, "skip", "no org in this run — client sign-ins not read");
  let rows;
  try {
    rows = await readNeverSignedIn(run, orgId);
  } catch (err) {
    return check(id, "skip", `could not read who has signed in: ${err && err.isTimeout ? "no answer in time" : clip(err)}`);
  }
  const real = rows.filter((r) => r.is_test !== true && r.paid_through_door === true);
  const testCount = rows.filter((r) => r.is_test === true).length;
  const unpaidCount = rows.filter((r) => r.is_test !== true && r.paid_through_door !== true).length;
  const left = `Left out: ${testCount} test client${testCount === 1 ? "" : "s"}, ${unpaidCount} with no payment event.`;
  const waiting = waitingOf(rows);
  const held = heldOnly(waiting);
  if (held) {
    // Owner call 2026-10-09: no sign-in link and no call for these clients (src/pulse/owner-hold.mjs).
    // The audit asks this lane again (naVerify below); any other waiting client makes this red by name.
    const n = waiting.length;
    return {
      ...check(
        id,
        "na",
        `${n} paying client${n === 1 ? " has" : "s have"} held portal access for over ${SIGN_IN_GRACE} and not signed in, ` +
          `and ${n === 1 ? "it is" : "they are"} ${held.join(" and ")}, on the owner's no-contact hold. ` +
          `Judged again the day another paying client waits. ${left}`
      ),
      na: { code: "owner-hold-client", args: { check: id, orgId: String(orgId), clients: held } }
    };
  }
  if (!waiting.length) {
    return check(
      id,
      "PASS",
      real.length
        ? `${real.length} paying client${real.length === 1 ? " has" : "s have"} held portal access for over ${SIGN_IN_GRACE} and every one has signed in. ${left}`
        : `no paying client has held portal access for over ${SIGN_IN_GRACE} yet. ${left}`
    );
  }
  const n = waiting.length;
  const oldest = Math.floor(Math.max(...waiting.map((r) => Number(r.days_held) || 0)));
  const asked = waiting.filter((r) => r.asked_since_access === true).length;
  return check(
    id,
    "FAIL",
    `${n} paying client${n === 1 ? " has" : "s have"} held portal access for over ${SIGN_IN_GRACE} and ${n === 1 ? "has" : "have"} never signed in ` +
      `(longest wait ${oldest} day${oldest === 1 ? "" : "s"}; ${asked} of ${n} asked for a sign-in link since access was given). ${left}`,
    "Send each of them their sign-in link from the staff screen, or call them. Do not auto-fix from this pulse."
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The hourly beat (client-portal, 2026-10-20)
   ═══════════════════════════════════════════════════════════════════════════ */

/** The checks the beat runs every hour, in this order. */
export const HOURLY_CHECK_IDS = Object.freeze([
  "portal:page-scripts-load",
  "portal:paid-entitlement",
  "portal:next-step",
  "portal:summary",
  NEVER_SIGNED_IN_ID
]);

/** The beat's clock is 12 s in all, so the pages get 10 s of it (the morning lane gives them 14). */
export const PAGES_BUDGET_HOURLY_MS = 10000;

/** The probe (src/messaging/providers/pulse-probe.mjs MAX_BODY_BYTES) stops reading a page at 64 KB. */
export const PROBE_CHUNK_BYTES = 64 * 1024;
/** A page longer than this many chunks (2 MB) is not read to the end, so it is not judged. */
const MAX_CHUNKS = 32;

function timeoutError() {
  return Object.assign(new Error("no answer in time"), { isTimeout: true });
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    const stop = () => reject(timeoutError());
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", stop); resolve(value); },
      (err) => { signal.removeEventListener("abort", stop); reject(err); }
    );
  });
}

function answer(status, body, headers, partial = false) {
  const named = headers && typeof headers === "object" ? headers : {};
  return Object.freeze({
    status,
    partial,
    headers: Object.freeze({
      get: (name) => {
        const value = named[String(name).toLowerCase()];
        return value == null ? null : String(value);
      }
    }),
    text: async () => body
  });
}

/** "bytes 65536-131071/238408" -> { start, end, total }, else null. */
export function contentRange(value) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(String(value || "").trim());
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}

/**
 * The web the lane's checks expect (web(url, init) -> { status, headers.get, text() }),
 * built on the beat's ctx.http: GET only, to the hosts the beat declared.
 *
 * The probe stops a body at 64 KB, and two customer pages are longer than that
 * (client-portal.html is about 238 KB). A page judged on its first 64 KB would lose
 * its closing tag and the script tags near its end, which is a false red. So a page
 * the probe cut short is read to the end in 64 KB byte ranges (Range: bytes=a-b, which
 * the site answers with 206 and Content-Range) and joined. If any piece does not come
 * back as the next exact range, the answer is marked partial and the lane's getFile
 * counts that page as not read, never judged on half its text. Each piece is decoded
 * as text on its own, so a letter that spans two pieces can turn into two replacement
 * marks; tags, paths and the closing tag are plain ASCII and are not affected.
 * init.signal (the lane's per-file timeout) stops the whole read, as it stops a fetch.
 */
export function webFromProbe(http, { chunkBytes = PROBE_CHUNK_BYTES } = {}) {
  const get = async (url, headers) => {
    const res = await http.get(url, { headers });
    if (!res || !Number(res.status)) throw new Error(String((res && res.error) || "no answer"));
    return res;
  };
  const piece = async (url, accept, at) => {
    const part = await get(url, { accept, range: `bytes=${at}-${at + chunkBytes - 1}` });
    const r = contentRange(part.headers && part.headers["content-range"]);
    if (Number(part.status) !== 206 || !r || r.start !== at || part.truncated) return null;
    return { r, text: String(part.body ?? "") };
  };
  return (url, init = {}) => abortable((async () => {
    const accept = (init.headers && init.headers.accept) || "*/*";
    const first = await get(url, { accept });
    const status = Number(first.status);
    const body = String(first.body ?? "");
    // Only a web page is judged on its whole text (closing tag, needs, the files it names). A
    // script or style file is judged on its status, a non-empty body and its type, which its
    // first 64 KB already answer, so it is not read further.
    const type = String((first.headers && first.headers["content-type"]) || "");
    if (!first.truncated || status !== 200 || !/text\/html/i.test(type)) return answer(status, body, first.headers);

    const start = Number(first.bytes);
    if (!(start > 0)) return answer(status, body, first.headers, true);
    const second = await piece(url, accept, start);
    if (!second) return answer(status, body, first.headers, true);
    const total = second.r.total;
    const offsets = [];
    for (let at = second.r.end + 1; at < total; at += chunkBytes) offsets.push(at);
    if (offsets.length + 2 > MAX_CHUNKS) return answer(status, body, first.headers, true);
    const rest = await Promise.all(offsets.map((at) => piece(url, accept, at)));
    if (rest.some((p) => !p)) return answer(status, body, first.headers, true);
    return answer(status, [body, second.text, ...rest.map((p) => p.text)].join(""), first.headers);
  })(), init.signal);
}

/**
 * The five checks the hourly beat runs, side by side, with the lane's own functions.
 * io: { read(sql, params), orgId, web, baseUrl, budgetMs }. Reads go through `read`
 * (the beat's read box, staff view); the web through `web` (webFromProbe(ctx.http)).
 */
export async function runPortalHourly({ read, orgId, web, baseUrl = DEFAULT_BASE_URL, budgetMs = PAGES_BUDGET_HOURLY_MS } = {}) {
  const db = { query: (sql, params) => read(sql, params) };
  const run = (fn) => fn(db);
  return Promise.all([
    checkPageScripts({ web, baseUrl: baseUrl || DEFAULT_BASE_URL, budgetMs }),
    checkPaidEntitlement({ db, orgId }),
    checkNextStep({ db, orgId }),
    checkPortalSummary({ db, orgId }),
    checkPaidNeverSignedIn({ run, orgId })
  ]);
}
