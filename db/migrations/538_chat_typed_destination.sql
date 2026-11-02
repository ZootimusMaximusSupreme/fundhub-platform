-- Preserve whether staff supplied a one-message destination. Existing rows
-- remain unknown (NULL), so an old idempotency key fails closed on replay.
-- New rows record true or false. No recipient address or historical send is
-- changed by this migration.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_address_was_typed boolean;

COMMENT ON COLUMN messages.to_address_was_typed IS
  'For staff-authored chat replies: true when staff typed the destination, false when the contact record supplied it, NULL for older rows. Used to reject a reused send key with changed recipient intent.';
