// GET /api/auth/session — who am I. 200 { ok, principal, staff } or 401.
// The screens call this on load to gate themselves and render role-aware nav.
//
// ─────────────────────────────────────────────────────────────────────────────
// IT NOW ANSWERS FOR NON-EMPLOYEES TOO, AND THAT IS THE WHOLE UNBLOCK.
//
// Before this change: POST /api/auth/login already minted sessions for client,
// affiliate and partner principals (src/auth/account-session.mjs:loginAccount,
// wired in api/auth/login.mjs since db/migrations/044_accounts.sql), but THIS
// endpoint resolved staff sessions only. So a client, affiliate or partner could
// sign in successfully, be handed a real token, land on /app/ — and
// public/app/shell.js would call here, get a 401, and bounce them straight back
// to the login page. Sign in, bounce, sign in, bounce. The three portals were
// unreachable not because the login was missing but because this reply was.
//
// HOW IT ANSWERS: it PROJECTS the principal into the shape shell.js already
// reads. shell.js gates on `staff.role` (shell.js:536) and its ROLE_TABS map
// keys on 'client', 'affiliate' and 'partner' (shell.js:120) — it has always
// been ready for these three; nothing had ever handed them to it. So the role
// this endpoint reports for an account session IS its principal kind, which is
// exactly what that map expects. applyBrand() themes CRM chrome from
// /api/org-brand (docs/specs/BRAND-THEMING-SPEC.md); partner_id is still projected
// for partner-surface screens, not for CRM colours.
//
// `principal` is added alongside, naming the kind honestly, so nothing has to
// infer type from a role string. The staff reply is byte-for-byte what it was
// plus that one field — no existing caller changes behaviour.
//
// THIS GRANTS NOTHING. It is a "who am I" read. Every endpoint that actually
// returns data still gates itself: requireAuth accepts staff sessions only, and
// requirePrincipal admits a kind only where an endpoint explicitly names it. A
// client learning its own name and role here cannot read a row it could not read
// before. The projection is presentation, not permission.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../src/db.mjs";
import { attachStaff, bearerToken } from "../../src/http/middleware/requireAuth.mjs";
import { verifyAccountSession } from "../../src/auth/account-session.mjs";
import { clientHadCall } from "../../src/auth/client-had-call.mjs";
import { clientSampleAccount, realPortalData } from "../../src/demo/client-portal-samples.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // Employees first — the hot path, and the two token spaces are separate
  // tables so a token is only ever valid in one of them.
  const staff = await attachStaff(req, { db });
  if (staff) return res.status(200).json({ ok: true, principal: "staff", staff });

  // attachStaff sets this when the CHECK itself failed rather than the token.
  // Trying the accounts table next would fail the same way and double the
  // timeout, and answering 401 during a database outage tells a signed-in user
  // their credentials are bad — the misleading answer requireAuth.mjs was
  // rewritten to stop giving.
  if (req.authUnavailable) {
    return res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "unauthorized" });

  let account = null;
  try {
    account = await verifyAccountSession(db, token, {});
  } catch {
    return res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
  }
  if (!account) return res.status(401).json({ ok: false, error: "unauthorized" });

  const p = account.principal;
  const projected = {
    id: p.accountId,
    org_id: p.orgId,
    role: p.kind,
    email: p.email,
    name: p.name,
    status: "active",          // verifyAccountSession only returns active accounts
    principal_kind: p.kind,    // unambiguous, for anything that should not read `role`
    client_id: p.clientId,
    affiliate_id: p.affiliateId,
    partner_id: p.partnerId,   // partner-surface screens; CRM uses org-brand
    authorized_rep: p.authorizedRep === true
  };

  const payload = {
    ok: true,
    principal: p.kind,
    staff: projected
  };

  // Client principals only. The portal chat widget auto-opens before the sales
  // call; had_call tells it to stop after a closer has logged one. Not a new
  // route — same GET /api/auth/session payload.
  if (p.kind === "client") {
    if (await clientSampleAccount(db, p)) {
      payload.portal_sample_available = true;
      payload.portal_sample = !realPortalData(req);
    }
    const call = await clientHadCall(db, { orgId: p.orgId, clientId: p.clientId });
    payload.had_call = call.had_call;
    payload.had_call_at = call.had_call_at;
    projected.had_call = call.had_call;
    projected.had_call_at = call.had_call_at;
  }

  return res.status(200).json(payload);
}
