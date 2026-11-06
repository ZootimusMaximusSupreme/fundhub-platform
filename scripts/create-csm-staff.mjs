// Create the real Client Success Manager login, idempotently.
//
//   DATABASE_URL=postgres://... node scripts/create-csm-staff.mjs --dry-run
//   DATABASE_URL=postgres://... node scripts/create-csm-staff.mjs
//   DATABASE_URL=postgres://... node scripts/create-csm-staff.mjs \
//       --email sam.rivera@fundhub.ai --name "Sam Rivera"
//
// WHY THIS SCRIPT EXISTS. Production holds exactly one staff row with
// role='csm' and it is csm@demo.fundhub.local, a seeded demo account that
// src/auth/demo-logins.mjs refuses to authenticate unless DEMO_LOGINS_ENABLED
// is set — and turning that flag on publishes a shared password on the login
// page, which is not something to do on a system holding real customers. So
// the CSM screens have a role, an endpoint and a home, and nobody who can
// reach them. This creates the one real row that closes that.
//
// ───────────────────────────────────────────────────────────────────────────
// NO PASSWORD IS EVER CHOSEN, TRANSPORTED, OR DEFAULTED HERE.
//
// This is a thin wrapper over src/auth/invite.mjs — the same code path POST
// /api/auth/invite runs when an owner adds somebody on the Staff screen. It
// writes a single-use invite token and nothing else. The person opens the link
// and types their own password into /reset-password.html, so there is no
// moment where anyone but the account holder knows the secret. That is why
// this script does NOT follow scripts/create-staff.mjs (password on argv,
// visible in shell history and to `ps`) or scripts/seed-staff.mjs (a shared
// password from the environment).
//
// The link it prints IS the credential until it is used or replaced and it works once.
// Treat it like a password: hand it over directly, do not paste it into a
// ticket, a chat log or a document.
// ───────────────────────────────────────────────────────────────────────────
//
// SAFE TO RE-RUN. Three cases, and none of them destroys anything:
//
//   no row yet          → creates it and prints a permanent single-use invite link
//   row exists, invited → replaces the old invite with a fresh permanent single-use link
//   row exists, active  → the password is already set, so it does NOT touch
//                         it; prints a permanent single-use password-reset link instead
//   row exists, suspended → refuses and stops. Reactivating somebody who was
//                         deliberately switched off is a decision, not a
//                         side effect of re-running a script.
//
// WHAT IT DOES NOT DO: it does not deploy, it does not migrate, it does not
// set an environment variable, and it never prints a password or a hash.

import { db, close, dbTarget } from "../src/db.mjs";
import { inviteStaff, requestPasswordReset } from "../src/auth/invite.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";
import { staffRoleKey } from "../src/auth/company-email.mjs";
import {
  credentialLink, inviteMailCopy, resetMailCopy, looksLikeEmail, sendStaffCredentialEmail
} from "../src/auth/staff-mail.mjs";

const ROLE = "csm";

// Defaults, both overridable. csm@fundhub.ai matches the address every other
// role already uses in production (owner@, admin@, closer@, advisor@,
// inquiry@, sales@, setter@ — all live, none of them demo rows), so a CSM
// login is not a new convention. Pass --email to use a person's own name
// instead; the login is a login, not a mailbox.
const DEFAULT_EMAIL = "csm@fundhub.ai";
const DEFAULT_NAME = "Client Success Manager";

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const email = String(flag("email", DEFAULT_EMAIL)).trim().toLowerCase();
const name = String(flag("name", DEFAULT_NAME)).trim();
// Optional. When given, the link is emailed to that address as well as
// printed, so the holder can be the only person who ever sees it. Goes out
// through src/messaging/providers/resend.mjs — the same sender the Staff
// screen uses, no new outbound path.
const mailTo = flag("mail", null);

if (!email.includes("@")) {
  console.error(`--email ${email} is not an email address.`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL is not set.

  DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" \\
    node scripts/create-csm-staff.mjs --dry-run`);
  process.exit(1);
}
// A guard, not a formality: staffRoleKey is the map POST /api/auth/invite
// folds the Staff screen's label through, and 'csm' was missing from it until
// 2026-09-17. If this ever fails again, the screen cannot create a CSM either.
if (staffRoleKey(ROLE) !== ROLE) {
  console.error(
    `src/auth/company-email.mjs does not resolve the role "${ROLE}". ` +
    `Fix that map first — the Staff screen's invite button is broken the same way.`
  );
  process.exit(1);
}

try {
  console.log(`database : ${dbTarget()}`);
  const orgId = await resolveDefaultOrg(db);

  // The inviter of record. inviteStaff() requires an owner or admin actor and
  // checks it for real, exactly as the HTTP handler does — this script gets no
  // shortcut around the authorization the app enforces.
  const actor = (await db.query(
    `SELECT id, org_id, role, email FROM staff
      WHERE org_id = $1 AND status = 'active' AND lower(role) IN ('owner','admin')
      ORDER BY (lower(email) = 'chris@fundhub.ai') DESC, lower(role) = 'owner' DESC, created_at
      LIMIT 1`,
    [orgId]
  )).rows[0];
  if (!actor) {
    console.error("No active owner or admin in this org to issue the invite. Stopping.");
    process.exit(1);
  }

  const existing = (await db.query(
    `SELECT id, email, name, role, status, (password_hash IS NOT NULL) AS has_password
       FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  )).rows[0];

  console.log(`inviter  : ${actor.email} (${actor.role})`);
  console.log(`login    : ${email}`);
  console.log(`name     : ${name}`);
  console.log(`role     : ${ROLE}`);
  console.log(`existing : ${existing ? `${existing.status}, role ${existing.role}, password ${existing.has_password ? "set" : "not set"}` : "none"}`);

  if (existing && existing.status === "suspended") {
    console.error(
      `\n${email} exists and is SUSPENDED. Refusing to touch it.\n` +
      `Somebody switched this account off on purpose. Reactivate it from the ` +
      `Staff screen if that is what you want, then run this again.`
    );
    process.exit(1);
  }

  const alreadyActive = !!existing && existing.status === "active" && existing.has_password;

  if (dryRun) {
    // Closes the pool before exiting: process.exit() skips the `finally` below.
    console.log(
      `\nDRY RUN — nothing was written.\n` +
      (alreadyActive
        ? `A real run would issue a permanent single-use password-RESET link. The existing password stays.`
        : existing
          ? `A real run would refresh this row and issue a permanent single-use INVITE link.`
          : `A real run would create this staff row and issue a permanent single-use INVITE link.`)
    );
    await close();
    process.exit(0);
  }

  let path, kind, expiresAt, copy;

  if (alreadyActive) {
    // The account already works. Re-running must not reset a password somebody
    // has chosen — same rule src/auth/seed-staff.mjs is built around. A reset
    // link is the non-destructive answer: it only does something if the person
    // actually opens it.
    const reset = await requestPasswordReset(db, { email, orgId });
    if (!reset.token) {
      console.error("Could not issue a reset link for that address. Stopping.");
      process.exit(1);
    }
    kind = "reset";
    expiresAt = reset.expiresAt;
    path = "/reset-password.html?token=" + encodeURIComponent(reset.token);
    copy = resetMailCopy({ loginEmail: email, link: credentialLink(path), expiresAt });
  } else {
    const result = await inviteStaff(db, { actor, email, name, role: ROLE, orgId });
    if (!result.ok) {
      console.error(`Invite refused: ${result.error} (${result.status}). Nothing was written.`);
      process.exit(1);
    }
    kind = "invite";
    expiresAt = result.expiresAt;
    path = "/reset-password.html?token=" + encodeURIComponent(result.token);
    copy = inviteMailCopy({ loginEmail: email, link: credentialLink(path), expiresAt });
    console.log(`\nstaff row: ${result.staff.status} — ${result.staff.email} (${result.staff.role})`);
  }

  if (mailTo) {
    if (!looksLikeEmail(mailTo)) {
      console.log(`\n--mail "${mailTo}" is not an email address — nothing was sent.`);
    } else {
      const sent = await sendStaffCredentialEmail({ to: mailTo, ...copy });
      console.log(`\nemailed  : ${sent.mailed ? `yes → ${mailTo}` : `NO (${sent.error}) — use the link below`}`);
    }
  }

  console.log(`
────────────────────────────────────────────────────────────────────────
${kind === "invite" ? "SET-PASSWORD LINK (invite)" : "PASSWORD RESET LINK"} — works ONCE, ${expiresAt === null ? "does not expire" : "expires " + new Date(expiresAt).toISOString()}

${credentialLink(path)}

This link is the credential. Give it to the person who will hold the
account and let them type their own password. Do not paste it into a
ticket, a chat log or a document.
────────────────────────────────────────────────────────────────────────

Then they sign in at https://fundhub.ai/login.html as ${email}
and land on the Client Success queue.`);
} catch (e) {
  // Names the failure, never a value.
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await close();
}
