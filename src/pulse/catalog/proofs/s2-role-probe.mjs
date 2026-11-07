// A signed-in role probe for the journey "reach" and "stays blocked" rows.
//
// It signs in as one kind of person (a staff role or an account kind) against a
// stand-in database, sends a GET and a POST through the REAL api adapter
// to one route, and says what the route's own gate did with that person. The
// network is refused and nothing is written anywhere: every read and write goes
// to the stand-in.
//
// What it can and cannot see, said plainly:
//   - It sees the entry gate (signed in, right kind of person, right role).
//   - Bank passkey status supplies a concrete owned target and live identity.
//   - An empty POST body is refused for being empty on some routes BEFORE their
//     later role check. Those routes look reachable here and are named, one by
//     one, in the test that uses this file. They are never counted as proved.
import { fakeDb, useSharedDb, staffSession, accountSession } from "../../../testing/handler-harness.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const PARTNER_ID = "b1000000-0000-4000-8000-000000000001";
const AFFILIATE_ID = "af000000-0000-4000-8000-000000000001";

/** Journey principals plus staff roles needed by the approved bank outreach boundary. */
export const PRINCIPALS = Object.freeze({
  client: () => accountSession({ kind: "client", clientId: CLIENT_ID }),
  affiliate: () => accountSession({ kind: "affiliate" }),
  "white-label": () => accountSession({ kind: "partner", partnerId: PARTNER_ID }),
  "role-owner": () => [staffSession({ role: "owner" })],
  "role-admin": () => [staffSession({ role: "admin" })],
  "role-outbound-rep": () => [staffSession({ role: "outbound_rep" })],
  "role-csm": () => [staffSession({ role: "csm" })],
  "role-setter": () => [staffSession({ role: "setter" })],
  // These roles may link their own payout bank only from a recent MFA session.
  // The probe exercises the role gate with that required proof present.
  "role-sales-manager": () => [staffSession({ role: "sales_manager", mfa_verified_at: new Date().toISOString() })],
  "role-closer": () => [staffSession({ role: "closer", mfa_verified_at: new Date().toISOString() })],
  "role-funding-advisor": () => [staffSession({ role: "funding_advisor" })],
  "role-inquiry-remover": () => [staffSession({ role: "inquiry_specialist" })],
});

// Prefix-routed doors have no exact key in ROUTES; these paths reach them.
const PATH_FOR = Object.freeze({
  "webhooks/:provider": "webhooks/twilio",
  "documents/:id": "documents/00000000-0000-4000-8000-000000000000",
});

const SECRET_DOOR_CODES = new Set(["bad_signature", "invalid_api_key", "missing_api_key"]);
const CONDITION_CODES = new Set(["no_active_shift", "suite_off"]);

async function oneCall(handler, path, method, rules, anonymous, postBody = {}) {
  const fake = fakeDb(rules);
  const restore = useSharedDb(fake);
  try {
    const headers = { "content-type": "application/json" };
    if (!anonymous) headers.authorization = "Bearer test-token-not-real";
    const init = { method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(postBody) }) };
    const response = await Promise.race([
      handler(new Request(`https://example.test/api/${path}`, init), {}),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    let body = {};
    try { body = JSON.parse(await response.text()); } catch { body = {}; }
    return { status: response.status, code: String(body.error || body.reason || "") };
  } catch (error) {
    return { status: 0, code: `threw:${String(error?.message || error).slice(0, 40)}` };
  } finally {
    restore();
  }
}

/** What happened to one person on one route key. */
export async function probeRoute(handler, key, principalName, { blueprintPaid = true, targetClientId = CLIENT_ID,
  passkeyTargetKind, passkeyBody, passkeyAffiliateLinked = true, passkeySessionLive = true } = {}) {
  let path = PATH_FOR[key] || key;
  const rules = principalName ? PRINCIPALS[principalName]() : [];
  let postBody = {};
  // The passkey door's missing-target 400 is public input validation, not
  // evidence of role access. Exercise its actual target-specific status gate.
  if (key === "auth/passkey") {
    const targetKind = passkeyTargetKind || (principalName === "client" ? "client_bank"
      : principalName === "affiliate" ? "affiliate_payout" : "company_bank");
    postBody = passkeyBody || { action: "status", target_kind: targetKind };
    const staff = principalName?.startsWith("role-") ? rules[0][1]()[0] : null;
    let account = principalName && !staff ? rules[1][1]()[0] : null;
    // The affiliate fixture needs its own payout target only for this route;
    // other routes retain their original target/capability fixtures.
    if (account && principalName === "affiliate") {
      account = { ...account, affiliate_id: passkeyAffiliateLinked ? AFFILIATE_ID : null };
      rules[1] = [rules[1][0], () => [account]];
    }
    const orgId = staff?.org_id || account?.org_id;
    const subjectId = "9e000000-0000-4000-8000-000000000001";
    const sessionId = staff?.session_id || (account ? rules[0][1]()[0].id : null);
    const targetId = targetKind === "company_bank" ? orgId
      : targetKind === "client_bank" ? account?.client_id : account?.affiliate_id;
    const actorId = staff?.staff_id || account?.id;
    rules.push([
      /FROM (?:accounts a JOIN account_sessions s|staff a JOIN sessions s)/,
      (_sql, params) => passkeySessionLive && actorId && targetId && params.length === 5 &&
        params.every((value, index) => value === [actorId, orgId, sessionId, targetKind, targetId][index])
        ? [{ email: "probe@example.test", name: "Probe", fresh_primary: true }] : []
    ], [
      /SELECT \* FROM auth_passkey_subjects WHERE org_id=\$1/,
      (_sql, params) => params.length === 3 && params[0] === orgId && params[1] === (account?.id || null) && params[2] === (staff?.staff_id || null)
        ? [{ id: subjectId, org_id: orgId, account_id: account?.id || null, staff_id: staff?.staff_id || null, enrolled_at: null }] : []
    ]);
  }
  // This client-only door checks that the signed-in client has a file before
  // returning the saved switch. Give the probe that one file; other roles get none.
  if (key === "push/preferences" && principalName === "client") {
    rules.push([/FROM clients WHERE org_id = \$1 AND id = \$2 LIMIT 1/, () => [{ marketing_push_enabled: false }]]);
  }
  // Outreach rechecks the live staff row after the session. Answer only this
  // tenant-scoped identity read with the same staff; the real role checks run.
  if (["bank-outreach", "read/bank-outreach"].includes(key) && principalName?.startsWith("role-")) {
    const session = rules[0][1]()[0];
    const staff = { ...session, id: session.staff_id };
    rules.push([
      /^SELECT id,org_id,name,email,role FROM staff WHERE id=\$1 AND org_id=\$2 AND status='active' AND COALESCE\(\(to_jsonb\(staff\)->>'active'\)::boolean,true\)$/,
      (_sql, params) => params[0] === staff.id && params[1] === staff.org_id ? [staff] : [],
    ]);
  }
  // A full Blueprint route tests paid access after its real session gate. Give
  // the stand-in one exact owned purchase; an empty DB cannot prove that gate's
  // client branch. Staff GETs select that same client through the real org check.
  if (["blueprint/funding", "blueprint/inquiries", "blueprint/repair", "blueprint/services"].includes(key) && principalName) {
    const staff = principalName.startsWith("role-") ? rules[0][1]()[0] : null;
    const account = principalName === "client" ? rules[1][1]()[0] : null;
    const orgId = staff?.org_id || account?.org_id;
    if (staff && ["blueprint/funding", "blueprint/services"].includes(key)) {
      path += `?${key === "blueprint/funding" ? "clientId" : "client_id"}=${encodeURIComponent(targetClientId)}`;
    }
    if (orgId) {
      rules.push([
        /^SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2$/,
        (_sql, params) => params[0] === CLIENT_ID && params[1] === orgId ? [{exists:1}] : []
      ]);
      rules.push([
        /FROM blueprint_fulfillment_engagements g/,
        (_sql, params) => blueprintPaid && params[0] === orgId && params[1] === CLIENT_ID
          && params[2] === "blueprint-self-funding" && params[3] === "blueprint-client-fulfillment"
          ? [{ id:"b1000000-0000-4000-8000-000000000002",orgId,clientId:CLIENT_ID,
            transactionId:"b1000000-0000-4000-8000-000000000003",
            entitlementId:"b1000000-0000-4000-8000-000000000004", productCode:"blueprint-self-funding",
            roundId:null,opensAt:new Date().toISOString(),status:"active",executionOwner:"client" }]
          : []
      ]);
    }
  }
  const get = await oneCall(handler, path, "GET", rules, !principalName);
  const post = await oneCall(handler, path, "POST", rules, !principalName, postBody);
  return { GET: get, POST: post };
}

/**
 * The verdict for one probe:
 *   "reach"       a method got past the entry gate (any answer but 401, 403, 405)
 *   "reach-late"  refused only by a condition after the gate (no shift, suite off,
 *                 banking not configured): the person was recognised and admitted
 *   "secret-door" no session is read at all; the door asks for its own signature
 *                 or key, and answered that way
 *   "blocked"     401 or 403 from the gate, and no method got past it
 *   "unclear"     nothing but 405 or crashes
 */
export function verdictFor(probe) {
  const answers = Object.values(probe);
  const secret = answers.find((a) => a.status === 401 && SECRET_DOOR_CODES.has(a.code));
  if (answers.some((a) => a.status && ![401, 403, 405].includes(a.status))) return "reach";
  if (answers.some((a) => a.status === 403 && (CONDITION_CODES.has(a.code) || /^banking surface requires/.test(a.code)))) {
    return "reach-late";
  }
  if (secret) return "secret-door";
  if (answers.some((a) => a.status === 401 || a.status === 403)) return "blocked";
  return "unclear";
}

export const OPENS = new Set(["reach", "reach-late", "secret-door"]);
