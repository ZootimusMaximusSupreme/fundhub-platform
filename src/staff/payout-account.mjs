// Staff payout destinations only. Linking records a bank; nothing here sends money.
import { withTransaction } from "../db/with-transaction.mjs";
import { plaidConfigFromEnv, linkAccount, getAccounts, SEAM_REASONS } from "../banking/plaid.mjs";
import { pickPayoutAccount, SANDBOX_LABEL } from "../affiliates/payout-rail.mjs";

export const STAFF_PAYOUT_ROLES = new Set(["closer", "sales_manager"]);
export const TRANSFER_UNAVAILABLE_MESSAGE = "Payout bank linking is unavailable until Plaid Transfer is enabled.";

export function canLinkStaffPayout(staff) {
  const primary = String(staff?.role || "").trim().toLowerCase();
  if (!primary || ["owner", "admin", "partner", "client", "affiliate", "outbound_rep"].includes(primary)) return false;
  const roles = [primary, ...(Array.isArray(staff?.roles) ? staff.roles : [])];
  return roles.some((role) => STAFF_PAYOUT_ROLES.has(String(role || "").trim().toLowerCase()));
}

// Separate credentials and token key from client, affiliate, and company links.
export function staffPlaidEnv(env = process.env) {
  return {
    ...env,
    PLAID_ENV: env.STAFF_PLAID_ENV,
    PLAID_CLIENT_ID: env.STAFF_PLAID_CLIENT_ID,
    PLAID_SECRET: env.STAFF_PLAID_SECRET,
    PLAID_TOKEN_ENC_KEY: env.STAFF_PLAID_TOKEN_ENC_KEY
  };
}

const refuse = (status, error, message, extra = {}) => ({ ok: false, status, error, message, ...extra });

function configured(env) {
  if (env.STAFF_PLAID_TRANSFER_ENABLED !== "1") {
    return { mapped: null, ready: false, error: "transfer_unavailable",
      message: TRANSFER_UNAVAILABLE_MESSAGE, missing: [] };
  }
  const mapped = staffPlaidEnv(env);
  const cfg = plaidConfigFromEnv(mapped);
  const missing = [...cfg.missing, ...cfg.problems].map((name) => name.replaceAll("PLAID_", "STAFF_PLAID_"));
  if (mapped.PLAID_ENV !== "production") missing.push("STAFF_PLAID_ENV=production");
  return { mapped, ready: missing.length === 0, error: "not_configured",
    message: "Staff bank linking is not set up yet.", missing };
}

export function staffPayoutLinkAvailability(env = process.env) {
  const cfg = configured(env);
  return { linking_available: cfg.ready, linking_message: cfg.ready ? null : cfg.message };
}

export function maskedStaffPayoutAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    environment: row.environment,
    institution: row.institution_name || null,
    name: row.account_name || null,
    mask: row.account_mask || null,
    subtype: row.account_subtype || null,
    status: row.status
  };
}

export async function currentStaffPayoutAccount(db, { orgId, staffId }) {
  const row = (await db.query(
    `SELECT id, environment, institution_name, account_name, account_mask, account_subtype, status
       FROM staff_payout_accounts
      WHERE org_id=$1 AND staff_id=$2 AND status='active' LIMIT 1`,
    [orgId, staffId]
  )).rows[0];
  return maskedStaffPayoutAccount(row);
}

export async function startStaffPayoutLink({ staffId, env = process.env, http = null }) {
  const cfg = configured(env);
  if (!cfg.ready) return refuse(503, cfg.error, cfg.message, { missing: cfg.missing });
  const { createLinkToken } = http || (await import("../banking/providers/plaid-http.mjs"));
  const result = await createLinkToken({ clientUserId: `staff-payout:${staffId}`, products: ["transfer"] }, {
    environment: "production", clientId: cfg.mapped.PLAID_CLIENT_ID,
    secret: cfg.mapped.PLAID_SECRET, env: cfg.mapped
  });
  if (!result.ok) return refuse(502, result.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
    "Plaid did not open the bank link.", { detail: result.error ?? null });
  return { ok: true, status: 200, linkToken: result.linkToken,
    expiration: result.expiration ?? null, environment: "production" };
}

export async function completeStaffPayoutLink(db, {
  orgId, staffId, publicToken, accountId = null, institution = null,
  now = new Date(), env = process.env, plaid = null
}) {
  const cfg = configured(env);
  if (!cfg.ready) return refuse(503, cfg.error, cfg.message, { missing: cfg.missing });
  const staff = (await db.query(
    `SELECT s.id, s.role, EXISTS (
       SELECT 1 FROM staff_role_assignments a
       JOIN staff_roles sr ON sr.id=a.role_id AND sr.org_id=a.org_id
       WHERE a.staff_id=s.id AND a.org_id=s.org_id AND sr.active
         AND sr.key IN ('closer','sales_manager')
     ) AS has_payout_role
     FROM staff s WHERE s.id=$1 AND s.org_id=$2 AND s.status='active'`,
    [staffId, orgId]
  )).rows[0];
  if (!staff || !canLinkStaffPayout({ role: staff.role,
    roles: staff.has_payout_role ? ["closer"] : [] })) {
    return refuse(403, "not_eligible", "Only active closers and sales managers can link payout banks.");
  }

  const provider = plaid || { linkAccount, getAccounts };
  const linked = await provider.linkAccount({ clientId: staffId, publicToken, env: cfg.mapped });
  if (!linked.ok) return refuse(linked.reason === SEAM_REASONS.NOT_CONFIGURED ? 503 : 502,
    linked.reason, "Plaid did not finish the bank link.");
  const { plaidItemId, encryptedAccessToken, environment } = linked.item;
  const accounts = await provider.getAccounts({ itemId: plaidItemId, encryptedAccessToken, env: cfg.mapped });
  if (!accounts.ok) return refuse(502, accounts.reason, "Plaid did not list the accounts.");
  const picked = pickPayoutAccount(accounts.accounts, accountId);
  if (picked.error) return refuse(409, picked.error, "Pick one checking or savings account for payouts.",
    { choices: picked.choices ?? [] });
  const account = picked.account;
  const suppliedName = institution?.name ? String(institution.name).slice(0, 200) : null;
  const institutionName = environment === "sandbox"
    ? `${suppliedName || "Plaid bank"} ${SANDBOX_LABEL}` : suppliedName;

  const row = await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE staff_payout_accounts SET status='replaced', updated_at=now()
        WHERE org_id=$1 AND staff_id=$2 AND status='active'
          AND NOT (plaid_item_id=$3 AND plaid_account_id=$4)`,
      [orgId, staffId, plaidItemId, account.plaidAccountId]
    );
    const saved = (await tx.query(
      `INSERT INTO staff_payout_accounts
        (org_id, staff_id, environment, plaid_item_id, plaid_account_id, encrypted_access_token,
         institution_name, account_name, account_mask, account_subtype,
         consent_granted_at, linked_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2)
       ON CONFLICT (org_id, plaid_item_id, plaid_account_id) DO UPDATE SET
         encrypted_access_token=EXCLUDED.encrypted_access_token,
         institution_name=EXCLUDED.institution_name, account_name=EXCLUDED.account_name,
         account_mask=EXCLUDED.account_mask, account_subtype=EXCLUDED.account_subtype,
         status='active', consent_granted_at=EXCLUDED.consent_granted_at, updated_at=now()
       WHERE staff_payout_accounts.staff_id=EXCLUDED.staff_id
       RETURNING id, environment, institution_name, account_name, account_mask, account_subtype, status`,
      [orgId, staffId, environment, plaidItemId, account.plaidAccountId,
       encryptedAccessToken, institutionName, account.name ?? null,
       account.mask ?? null, account.subtype ?? null, now]
    )).rows[0];
    if (!saved) throw new Error("Plaid bank link already belongs to another staff member");
    return saved;
  });
  return { ok: true, status: 200, account: maskedStaffPayoutAccount(row) };
}
