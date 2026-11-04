import { verifyPassword } from "../src/auth/hash.mjs";

const STAFF_EMAILS = ["chris@fundhub.ai", "owner@fundhub.ai", "admin@fundhub.ai"];
const ACCOUNT_EMAILS = ["affiliate@fundhub.ai", "partner@fundhub.ai"];

// Check the exact principals used by the live browser specs before they make
// repeated failed login requests. This reads hashes but never returns them.
export async function inspectLiveAuthFixtures(db, password) {
  if (!password) return ["live test password is missing"];
  const [staff, accounts] = await Promise.all([
    db.query(
      `SELECT lower(email) AS email, status, removed_at, password_hash
         FROM staff WHERE lower(email) = ANY($1::text[])`,
      [STAFF_EMAILS]
    ),
    db.query(
      `SELECT lower(email) AS email, status, password_hash
         FROM accounts WHERE lower(email) = ANY($1::text[])`,
      [ACCOUNT_EMAILS]
    )
  ]);
  const problems = [];
  for (const [kind, expected, result] of [
    ["staff", STAFF_EMAILS, staff], ["account", ACCOUNT_EMAILS, accounts]
  ]) {
    const byEmail = new Map(result.rows.map((row) => [row.email, row]));
    for (const email of expected) {
      const row = byEmail.get(email);
      if (!row) { problems.push(`${kind} ${email} is missing`); continue; }
      if (row.removed_at || row.status !== "active") {
        problems.push(`${kind} ${email} is not active`);
        continue;
      }
      let matches = false;
      if (row.password_hash) {
        try { matches = await verifyPassword(password, row.password_hash); } catch { /* unusable hash */ }
      }
      if (!matches) problems.push(`${kind} ${email} does not match the live test password`);
    }
  }
  return problems;
}
