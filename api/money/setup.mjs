// /api/money/setup[?client_id=<uuid>]
//
//   GET                               → where this client stands on Finance OS setup
//   POST { action: "start_checkout" }   → the setup-fee checkout URL (only when a fee is set)
//   POST { action: "request_soft_pull" } → the signed soft-pull approval form for this file
//
// The read lives in src/finance/money-setup.mjs; this file gates and routes.
//
// SAME TWO CALLERS AS api/money/overview.mjs, SAME GATE, COPIED.
//   * A signed-in CLIENT sees and acts on their own file only. The client_id
//     comes off the SESSION; a client_id in the query or body is never read.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) + requireClientInOrg on client_id
//     (query on GET, query or body on POST).
//
// NOTHING HERE CHARGES ANYONE OR PULLS CREDIT.
//   * start_checkout mints a hosted Commas checkout through the existing
//     createPaymentLink (src/payment-links/index.mjs). A link is an invitation,
//     not a payment. With no fee set (FINANCE_OS_SETUP_FEE_CENTS unset) it
//     answers 409 price_not_set and writes nothing. An unpaid setup link already
//     on file is handed back instead of minting a second one.
//   * request_soft_pull hands back the signed approval form — the same link the
//     closer deck and the consent desk send. That form is the existing gate:
//     consent, identity, then the $32 soft-pull checkout. The pull itself runs
//     only after that payment (diagnostic.paid). Nothing is written here.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  readSetupStatus, readSetupLinks, readSetupFeeCents,
  SETUP_PURPOSE, SETUP_DESCRIPTION, SETUP_COMMAS_TITLE
} from "../../src/finance/money-setup.mjs";
import { createPaymentLink } from "../../src/payment-links/index.mjs";
import { signSoftPullApproveUrl } from "../../src/consent/approve-token.mjs";
import { secretFromEnv } from "../../src/documents/signed-url.mjs";

const ACTIONS = new Set(["start_checkout", "request_soft_pull"]);

/** Who and which file. Writes the refusal and returns null when not allowed. */
async function resolveScope(req, res, { database, gate }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, staffId: null, staffRole: null };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;
  const qid = (req.query && req.query.client_id) || (req.body && req.body.client_id);
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, staffId: staff.id || principal.staffId || null, staffRole: staff.role || null };
}

async function startCheckout(res, scope, { database, env, mint }) {
  const fee = readSetupFeeCents(env);
  if (fee === null) {
    return res.status(409).json({
      ok: false,
      error: "price_not_set",
      message: "The setup price is not set yet. Nothing was charged and no checkout was made."
    });
  }
  const links = await readSetupLinks(database, scope);
  if (links.paid) {
    return res.status(200).json({ ok: true, already_paid: true, checkout_url: null });
  }
  if (links.open && Number(links.open.amount_cents) === fee) {
    return res.status(200).json({ ok: true, reused: true, checkout_url: links.open.checkout_url, amount_cents: fee });
  }
  try {
    const row = await mint(database, {
      orgId: scope.orgId,
      clientId: scope.clientId,
      purpose: SETUP_PURPOSE,
      description: SETUP_DESCRIPTION,
      commasProductTitle: SETUP_COMMAS_TITLE,
      amountCents: fee,
      createdByStaffId: scope.staffId,
      createdByRole: scope.staffRole,
      checkoutBaseUrl: env.COMMAS_CHECKOUT_BASE_URL || null,
      env
    });
    return res.status(200).json({ ok: true, reused: false, checkout_url: row.checkout_url, amount_cents: fee });
  } catch (e) {
    if (e && e.code === "commas_not_configured") {
      return res.status(503).json({ ok: false, error: "not_configured", message: "Checkout is not set up yet. Nothing was charged." });
    }
    if (e && e.code === "commas_checkout_failed") {
      return res.status(502).json({ ok: false, error: "checkout_failed", message: "The checkout page could not be made. Nothing was charged. Try again in a few minutes." });
    }
    throw e;
  }
}

function requestSoftPull(res, scope, { env, sign }) {
  let secret;
  try {
    secret = secretFromEnv(env);
  } catch {
    return res.status(503).json({
      ok: false,
      error: "not_configured",
      message: "The soft-pull form cannot be opened right now. Nothing was charged. [DOCUMENT_URL_SECRET]"
    });
  }
  const link = sign({ orgId: scope.orgId, clientId: scope.clientId, secret });
  /* The relative path, so the form opens on the same site the page is on. */
  return res.status(200).json({ ok: true, approve_url: link.path, expires_at: link.expiresAtIso });
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const mint = deps.createPaymentLink || createPaymentLink;
  const sign = deps.signSoftPullApproveUrl || signSoftPullApproveUrl;
  const method = req.method || "GET";

  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let action = null;
  if (method === "POST") {
    action = String((req.body || {}).action || "").trim();
    if (!ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: "action must be start_checkout or request_soft_pull" });
    }
  }

  const scope = await resolveScope(req, res, { database, gate });
  if (!scope) return;

  try {
    if (action === "start_checkout") return await startCheckout(res, scope, { database, env, mint });
    if (action === "request_soft_pull") return requestSoftPull(res, scope, { env, sign });
    const payload = await readSetupStatus(database, { ...scope, env, asOf: clock() });
    if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
    return res.status(200).json(payload);
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
