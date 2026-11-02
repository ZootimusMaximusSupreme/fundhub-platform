// POST /api/proxy/launch — create a geo-targeted Oxylabs session for Apply.
// Roles: owner, funding_advisor. Org-scoped. Session-authed.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { launchProxySession, ProxySessionError } from "../../src/proxy/launch.mjs";

export const PROXY_ROLES = new Set(["owner", "funding_advisor"]);

// Plain next step per failure, so the screen can tell the advisor what to do
// instead of only showing an error code. Never promises routing that is off.
const NEXT_STEP = {
  oxylabs_credentials_missing:
    "The proxy account is not set up yet. Ask the owner to add the proxy login before applying.",
  oxylabs_auth_failed:
    "The proxy login was rejected. The owner needs to fix OXYLABS_USERNAME and OXYLABS_PASSWORD (account id, no customer- prefix).",
  client_location_missing:
    "Add the client's city and state on their file, then try Apply again.",
  application_url_missing:
    "Add the application URL on this lender's row on the Lenders screen, then try Apply again.",
  lender_not_found: "Pick a lender that exists on the Lenders screen, then try Apply again.",
  client_not_found: "Open a client that exists in this account, then try Apply again.",
  application_not_found: "Open an application that exists, then try Apply again.",
  client_mismatch: "This application belongs to a different client. Open the right client and try again.",
  funding_on_hold: "Resolve the fraud, document, or funding hold on this file before applying.",
  lender_bureau_unknown: "Confirm which bureau this lender pulls before applying while an inquiry is protected.",
  lender_bureau_on_hold: "Pick a lender that pulls a clean bureau, or wait until this bureau clears.",
  // One code, two real causes: the exit answered from the wrong place, OR it never
  // answered at all (timeout / refused). src/adapters/oxylabs.mjs collapses both into
  // `geo_unavailable`, so this line must be true of both. There is deliberately no
  // `geo_mismatch` key — nothing in this repo emits that code, and a step filed under
  // a name that is never used can never reach the screen.
  geo_unavailable:
    "No connection near the client answered, or the one that did was somewhere else. " +
    "Do not apply. Wait a minute and try Apply again."
};

// Shown when the failure is not one of the named ones above, so the screen is never
// left with a bare code and no next step.
const NEXT_STEP_FALLBACK =
  "Try Apply again. If it keeps failing, sign out and back in, then tell the owner what this message says.";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, PROXY_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId) || !isUuid(staff.id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  if (body.lender_id != null && body.lender_id !== "" && !isUuid(body.lender_id)) {
    return res.status(400).json({ ok: false, error: "lender_id must be a uuid" });
  }
  if (body.application_id != null && body.application_id !== "" && !isUuid(body.application_id)) {
    return res.status(400).json({ ok: false, error: "application_id must be a uuid" });
  }
  if (!body.lender_id && !body.application_id) {
    return res.status(400).json({
      ok: false,
      error: "lender_id or application_id is required"
    });
  }

  try {
    const result = await launchProxySession(database, {
      orgId,
      staffId: staff.id,
      clientId: body.client_id,
      lenderId: body.lender_id || null,
      applicationId: body.application_id || null,
      env,
      fetchFn: deps.fetchFn
    });
    return res.status(200).json({
      ok: true,
      session_id: result.session.id,
      session: {
        id: result.session.id,
        status: result.session.status,
        client_id: result.session.client_id,
        lender_id: result.session.lender_id,
        application_id: result.session.application_id,
        started_at: result.session.started_at
      },
      connection: result.connection,
      verification: result.verification,
      application_url: result.application_url,
      lender: result.lender,
      bank_form_email: result.bank_form_email,
      routing_active: false,
      extension_required: true,
      notice:
        "Exit IP verified server-side. Browser routing is active only if the Fundhub Proxy Chrome extension is installed and confirms ACTIVE. Otherwise use the manual proxy settings below — do not submit the bank application until the exit city matches."
    });
  } catch (err) {
    if (err instanceof ProxySessionError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code,
        message: err.message,
        session_id: err.sessionId || null,
        attempts: err.attempts || undefined,
        routing_active: false,
        next_step: NEXT_STEP[err.code] || NEXT_STEP_FALLBACK
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
