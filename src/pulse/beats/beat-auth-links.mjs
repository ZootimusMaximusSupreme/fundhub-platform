// auth-links: every hour, can a client still get a sign-in link by email, and does every sign-in that
// said yes make a session?
//
// Same SQL, same verdicts as the morning checks in gap-auth.mjs (the truth lives in lib/auth-truth.mjs).
// Four reads: the EMAIL-PORTAL-MAGIC-LINK template (it must exist, pass compliance and not be draft
// copy), sign-in links issued in 24 hours with no email queued, and sign-ins in 24 hours (staff
// password or a used magic link) with no session row, plus recent account Plaid consent receipts.
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   route:auth/magic-link, route:auth/send-portal-link   gap:auth-magic-link-dead
//   route:auth/magic-link-verify                         gap:auth-magic-link-dead, gap:auth-signin-no-session
//   route:auth/plaid-mfa                                  gap:auth-plaid-consent-integrity
// page:portal-login.html also names portal:paid-client-never-signed-in, which runs hourly in the
// client-portal beat, so page:portal-login.html is on that beat's `covers` (with this beat's
// gap-auth-magic-link-dead step named there as its other half).
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  MAGIC_DEAD_SQL, MAGIC_LINK_TEMPLATE_KEY, MAGIC_TEMPLATE_SQL, SIGNIN_NO_SESSION_SQL,
  PLAID_GRANT_SQL, magicLink, signinNoSession, plaidGrantIntegrity
} from "./lib/auth-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["gap:auth-magic-link-dead", "gap:auth-signin-no-session", "gap:auth-plaid-consent-integrity"]);

const ONE = (row) => Object.freeze([Object.freeze(row)]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const db = { query: (sql, params) => io.read(sql, params) };
    return [await magicLink(db, io.orgId), await signinNoSession(db), await plaidGrantIntegrity(db)];
  },
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([MAGIC_TEMPLATE_SQL, ONE({ template_key: MAGIC_LINK_TEMPLATE_KEY, compliance_passed: true, subject: "Your sign-in link", body: "Tap to sign in." })]),
      Object.freeze([MAGIC_DEAD_SQL, ONE({ n: 0 })]),
      Object.freeze([SIGNIN_NO_SESSION_SQL, ONE({ staff_ok: 2, staff_no_session: 0, links_used: 1, links_no_session: 0 })]),
      Object.freeze([PLAID_GRANT_SQL, ONE({ recent_grants: 0, broken_grants: 0 })])
    ]),
    // A sign-in link went out with no email queued: the beat must stop at the magic-link step.
    failRows: Object.freeze([Object.freeze([MAGIC_DEAD_SQL, ONE({ n: 1 })])])
  })
});

export const id = "auth-links";
export const title = "Sign-in links, sessions, and Plaid consent hold";
export const kind = "probe";
export const covers = ["route:auth/magic-link", "route:auth/send-portal-link", "route:auth/magic-link-verify", "route:auth/plaid-mfa"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "sign-in" });
}

export const fixGuide = [
  "A sign-in link, session, or Plaid MFA consent receipt is broken.",
  "",
  "Likely causes:",
  "- The EMAIL-PORTAL-MAGIC-LINK template is missing, not approved, or still draft copy, so no link email queues.",
  "- requestMagicLink saved the link and stopped before it queued the email.",
  "- createSession or the account session insert failed after the password or link was accepted.",
  "- A Plaid Link consent receipt lacks confirmed MFA, the account target, the right scope, or exchange evidence.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs auth-links and read the red step.",
  "- Read message_templates for EMAIL-PORTAL-MAGIC-LINK, then account_magic_links and the messages row for the link.",
  "- For a missing session, read sessions or account_sessions around the sign-in time. Do not send or write from the pulse.",
  "- For Plaid consent, inspect the count-only result and the affected grant inside the protected database. Do not open Link from this pulse.",
  "Files: src/pulse/beats/lib/auth-truth.mjs, api/auth/magic-link.mjs, api/auth/plaid-mfa.mjs, src/auth/account-session.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
