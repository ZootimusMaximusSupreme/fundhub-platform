-- Consent-only Plaid grants do not complete a second factor. Preserve older
-- verified timestamps, but leave new grants unstamped unless MFA really runs.
ALTER TABLE account_plaid_link_grants
  ALTER COLUMN mfa_verified_at DROP DEFAULT,
  ALTER COLUMN mfa_verified_at DROP NOT NULL;
