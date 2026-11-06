-- Owner-approved 2026-11-06: preserve each actual staff or affiliate contract actor.
ALTER TABLE contracts ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS sent_by_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_creator_subject_ck') THEN
  ALTER TABLE contracts ADD CONSTRAINT contracts_creator_subject_ck CHECK (num_nonnulls(created_by,created_by_account_id)=1);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_sender_subject_ck') THEN
  ALTER TABLE contracts ADD CONSTRAINT contracts_sender_subject_ck CHECK (num_nonnulls(sent_by,sent_by_account_id)<=1);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION guard_contract_account_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id THEN
   RAISE EXCEPTION 'The actual contract creator cannot be changed';
  END IF;
  IF (OLD.sent_by IS NOT NULL OR OLD.sent_by_account_id IS NOT NULL OR OLD.sent_at IS NOT NULL OR OLD.status<>'draft') AND (NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_by_account_id IS DISTINCT FROM OLD.sent_by_account_id) THEN
   RAISE EXCEPTION 'The actual contract sender is frozen once sent';
  END IF;
 END IF;
 IF NEW.created_by_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts a
  WHERE a.id=NEW.created_by_account_id AND a.org_id=NEW.org_id AND a.kind='affiliate') THEN
  RAISE EXCEPTION 'Contract creator must be an affiliate in the same company';
 END IF;
 IF NEW.sent_by_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts a
  WHERE a.id=NEW.sent_by_account_id AND a.org_id=NEW.org_id AND a.kind='affiliate') THEN
  RAISE EXCEPTION 'Contract sender must be an affiliate in the same company';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contract_account_actor ON contracts;
CREATE TRIGGER trg_contract_account_actor BEFORE INSERT OR UPDATE OF org_id,created_by,created_by_account_id,sent_by,sent_by_account_id
 ON contracts FOR EACH ROW EXECUTE FUNCTION guard_contract_account_actor();
