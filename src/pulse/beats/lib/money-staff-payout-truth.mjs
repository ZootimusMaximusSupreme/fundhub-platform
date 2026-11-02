// Read-only saved-destination integrity, shared by hourly and daily money lanes.
// Model: src/staff/payout-account.mjs and migration541. No bank call or payment.
import { row, runnerOf } from "./money-truth-utils.mjs";

export const CHECK_IDS = Object.freeze(["staff-payout:destination-integrity"]);
export const STAFF_PAYOUT_INTEGRITY_SQL = `
WITH active_destinations AS (
 SELECT a.staff_id, a.org_id, a.linked_by_staff_id, a.environment,
        a.plaid_item_id, a.plaid_account_id, a.encrypted_access_token, a.consent_granted_at,
        s.id AS target_id, s.org_id AS target_org,
        linker.id AS linker_id, linker.org_id AS linker_org
   FROM staff_payout_accounts a
   LEFT JOIN staff s ON s.id = a.staff_id
   LEFT JOIN staff linker ON linker.id = a.linked_by_staff_id
  WHERE a.org_id = $1::uuid AND a.status = 'active'
)
SELECT count(*)::int AS active_n,
       count(*) FILTER (WHERE target_id IS NULL OR target_org IS DISTINCT FROM org_id
         OR linker_id IS NULL OR linker_org IS DISTINCT FROM org_id
         OR linked_by_staff_id IS DISTINCT FROM staff_id)::int AS wrong_owner_n,
       count(*) FILTER (WHERE environment IS DISTINCT FROM 'production')::int AS unsafe_environment_n,
       count(*) FILTER (WHERE NULLIF(btrim(plaid_item_id), '') IS NULL
         OR NULLIF(btrim(plaid_account_id), '') IS NULL
         OR NULLIF(btrim(encrypted_access_token), '') IS NULL
         OR consent_granted_at IS NULL)::int AS incomplete_n,
       (SELECT count(*)::int FROM (
          SELECT staff_id FROM active_destinations GROUP BY staff_id HAVING count(*) > 1
        ) duplicates)::int AS duplicate_staff_n,
       (SELECT count(*)::int FROM (
          SELECT plaid_item_id, plaid_account_id FROM active_destinations
          GROUP BY plaid_item_id, plaid_account_id HAVING count(*) > 1
        ) duplicates)::int AS duplicate_bank_n
  FROM active_destinations
`.trim();
export const HEALTHY_STAFF_PAYOUT_COUNTS = Object.freeze({
  active_n: 0, wrong_owner_n: 0, unsafe_environment_n: 0,
  incomplete_n: 0, duplicate_staff_n: 0, duplicate_bank_n: 0
});

export async function readStaffPayoutTruth(ctx = {}) {
  const id = CHECK_IDS[0], run = runnerOf(ctx);
  const fail = detail => [row(id, "FAIL", detail,
    "Review the one staff payout destination writer and saved ownership. Do not move money, call Plaid or rewrite bank records from this check.")];
  if (!run) return fail("Staff payout destination integrity was not read: no database reader.");
  try {
    let orgId = ctx.orgId;
    if (!orgId) orgId = (await run(tx => tx.query("SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1"))).rows?.[0]?.id;
    if (!orgId) return fail("Staff payout destination integrity was not read: no company scope.");
    const out = await run(tx => tx.query(STAFF_PAYOUT_INTEGRITY_SQL, [orgId]));
    const counts = out.rows?.[0];
    const names = Object.keys(HEALTHY_STAFF_PAYOUT_COUNTS);
    if (!counts || names.some(name => counts[name] == null || counts[name] === "" || !Number.isInteger(Number(counts[name])) || Number(counts[name]) < 0)) {
      return fail("Staff payout destination integrity returned incomplete counts; no healthy result was established.");
    }
    if (names.filter(name => name !== "active_n").some(name => Number(counts[name]) > 0)) {
      return fail(`Saved staff payout destination break: owner ${counts.wrong_owner_n}, environment ${counts.unsafe_environment_n}, incomplete ${counts.incomplete_n}, duplicate staff ${counts.duplicate_staff_n}, duplicate bank ${counts.duplicate_bank_n}. No bank identifiers were exposed.`);
    }
    return [row(id, "PASS", `${counts.active_n} active staff payout destinations have consistent saved self/org ownership, production environment, required fields and uniqueness. This does not prove bank ownership or a payment.`)];
  } catch {
    return fail("Staff payout destination integrity could not be read; a failed SQL/schema read is not a healthy destination.");
  }
}
