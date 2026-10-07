-- 472_document_vault.sql — the application document vault (Capital Blueprint, B3).
--
-- Offer line: "The agent collects bank statements, tax returns and ID ahead of time,
-- so the file is complete when the closer calls."
--
-- WHAT ALREADY EXISTED, AND WAS REUSED. Uploads live in `documents` (030, kind
-- 'client_upload', 118) and arrive through POST /api/documents-upload. The list
-- of papers, the status of each line and the "file complete" answer are computed
-- in src/finance/document-vault*.mjs from those rows. That is why this migration
-- is small: it does NOT copy uploads anywhere and it does NOT touch `documents`
-- (whose artifact columns are immutable on purpose). It adds only what a person
-- decides, and what a person adds.
--
-- FOUR THINGS HERE.
--
--   1. document_vault_reviews — a person accepts or rejects ONE uploaded file.
--      One row per document (unique on document_id; changing your mind updates
--      the row). It can also say which line a file belongs under (item_key) and
--      which business (entity_id), because a file that arrived labelled "other"
--      must be filed by a person, never guessed from its file name. `covers` is
--      how many months or years one file spans (a single PDF holding 3 months of
--      statements is 3). `period_end` is the statement's end date, or the date a
--      certificate was issued: that is when a file's age starts counting.
--
--   2. document_vault_items — two kinds of staff override on the standard list
--      (src/finance/document-vault-items.mjs):
--        'custom'  a line staff add for one client (a business license, a profit
--                  and loss statement). No repo source says lenders always want
--                  these, so they are never standard.
--        'waiver'  a standard line that does not apply to this client or business
--                  (a one-year-old company has no two years of returns). A reason
--                  is required.
--      Nothing is deleted: removing a custom line or putting a waived line back
--      stamps retired_at.
--
--   3. tasks.detail — a readable note on a task. tasks.body is the dedupe key
--      (006's unique index is on client, source and body), so it cannot carry
--      sentences. closer-ready.mjs writes the vault line here ("file complete" or
--      "3 items still open: ...") when it opens the CSM closing prep call and the
--      closer alert, and /api/tasks returns it. Nullable; every other task is
--      unchanged.
--
--   4. Three message templates for the ask (src/finance/document-vault-chase.mjs):
--      a text, an email, a text. Same shape as the waypoint nudge (text, email,
--      text, then a person). DO NOTHING on conflict: a company that has already
--      edited one in the template editor keeps its copy.
--
-- THE ASK ITSELF USES AN EXISTING TABLE. Each ask is one money_agent_tasks row
-- (464): kind 'other', source 'doc-vault', task_key 'vault:<line>:<scope>'. No
-- new queue and no change to 464's CHECK lists (money_agent_log is not touched).

-- ───────────────────────────── 1. reviews ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_vault_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  client_id             uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES documents(id),
  status                text NOT NULL
    CONSTRAINT document_vault_reviews_status_ck CHECK (status IN ('accepted', 'rejected')),
  -- File this document under a line (a standard key or a custom one). NULL = by its subtype.
  item_key              text
    CONSTRAINT document_vault_reviews_key_ck CHECK (item_key IS NULL OR item_key ~ '^[a-z0-9_]{2,64}$'),
  -- The business container this file belongs to. NULL = the client, or the only business.
  entity_id             uuid REFERENCES entities(id),
  covers                integer NOT NULL DEFAULT 1
    CONSTRAINT document_vault_reviews_covers_ck CHECK (covers BETWEEN 1 AND 24),
  period_end            date,
  -- Required on a reject. The client reads it as what to fix.
  reason                text,
  reviewed_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  reviewed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_vault_reviews_reject_reason_ck
    CHECK (status <> 'rejected' OR (reason IS NOT NULL AND reason ~ '[^[:space:]]'))
);

CREATE UNIQUE INDEX IF NOT EXISTS document_vault_reviews_one_per_document
  ON public.document_vault_reviews (document_id);
CREATE INDEX IF NOT EXISTS document_vault_reviews_client_idx
  ON public.document_vault_reviews (org_id, client_id);

-- ───────────────────────────── 2. staff-added lines and waivers ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_vault_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  client_id             uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The business container the line is for. NULL = the client (personal line).
  entity_id             uuid REFERENCES entities(id),
  -- A custom line's own key (custom_<8 hex>), or the standard key a waiver switches off.
  item_key              text NOT NULL
    CONSTRAINT document_vault_items_key_ck CHECK (item_key ~ '^[a-z0-9_]{2,64}$'),
  kind                  text NOT NULL
    CONSTRAINT document_vault_items_kind_ck CHECK (kind IN ('custom', 'waiver')),
  title                 text,
  -- custom: what to send and why. waiver: why this line does not apply (required).
  note                  text,
  -- custom only: an upload subtype whose files file under this line automatically.
  subtype               text,
  need                  integer NOT NULL DEFAULT 1
    CONSTRAINT document_vault_items_need_ck CHECK (need BETWEEN 1 AND 24),
  created_by_staff_id   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  retired_at            timestamptz,
  retired_by_staff_id   uuid REFERENCES staff(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_vault_items_custom_title_ck
    CHECK (kind <> 'custom' OR (title IS NOT NULL AND title ~ '[^[:space:]]')),
  CONSTRAINT document_vault_items_waiver_reason_ck
    CHECK (kind <> 'waiver' OR (note IS NOT NULL AND note ~ '[^[:space:]]'))
);

-- One live row per line per business (or per client). Retiring frees the slot.
CREATE UNIQUE INDEX IF NOT EXISTS document_vault_items_one_live
  ON public.document_vault_items
     (org_id, client_id, item_key, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS document_vault_items_client_idx
  ON public.document_vault_items (org_id, client_id)
  WHERE retired_at IS NULL;

-- updated_at, the way every table here does it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'document_vault_reviews_updated_at') THEN
    CREATE TRIGGER document_vault_reviews_updated_at
      BEFORE UPDATE ON public.document_vault_reviews
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'document_vault_items_updated_at') THEN
    CREATE TRIGGER document_vault_items_updated_at
      BEFORE UPDATE ON public.document_vault_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Row-level security: declared here, with its policy, so a fresh database and the
-- live one describe the same state (see src/security/rls-shape.test.mjs). The app
-- scopes every query by org_id itself, the way it does for money_agent_tasks.
ALTER TABLE public.document_vault_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vault_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_vault_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vault_items   FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'document_vault_reviews' AND policyname = 'document_vault_reviews_app_all') THEN
    CREATE POLICY document_vault_reviews_app_all ON public.document_vault_reviews
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'document_vault_items' AND policyname = 'document_vault_items_app_all') THEN
    CREATE POLICY document_vault_items_app_all ON public.document_vault_items
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- No DELETE grant: nothing here is ever deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.document_vault_reviews TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.document_vault_items   TO fundhub_app;
  END IF;
END $$;

-- ───────────────────────────── 3. tasks.detail ─────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS detail text;
COMMENT ON COLUMN public.tasks.detail IS
  'A readable note for the person who opens the task. tasks.body is the dedupe key, so it cannot hold sentences. Null on every task that has no note.';

-- ───────────────────────────── 4. the ask, in three texts ─────────────────────────────
-- The {{vault.*}} tags are filled by src/finance/document-vault-chase.mjs:
--   vault.what         the next line, in words: "your last 3 months of business bank statements for Fundhub LLC"
--   vault.more_phrase  " After that, 3 more documents." or empty when this is the last one
--   vault.reply_phrase " Or reply to this text with a photo." for the three personal papers
--                      only (a texted photo is filed as an ID, address, statement or return,
--                      never as a business paper), else empty
--   vault.list_html    every open line as an HTML list (email only; names are HTML-escaped)
-- {{CLIENT_PORTAL_URL}} and {{contact.first_name}} come from the client record,
-- the same as the other document requests (SMS-DOC-01-REQUEST).

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, t.template_key, t.channel, t.subject, t.body, true
  FROM orgs o
 CROSS JOIN (VALUES
   ('SMS-VAULT-ASK-1', 'sms', NULL::text,
    $c$Hey {{contact.first_name}}, Fundhub. To keep your file moving we still need {{vault.what}}.{{vault.more_phrase}} Upload it in your portal: {{CLIENT_PORTAL_URL}}{{vault.reply_phrase}} Reply STOP to opt out.$c$),
   ('EMAIL-VAULT-ASK-2', 'email', 'Documents still needed for your file',
    $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Documents still needed for your file</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your file is built so the funding call goes fast. These papers are still missing:</p>
            {{vault.list_html}}
            <p style="margin:16px 0;">Upload them in your portal: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">If one of these does not apply to you, tell us and we will take it off the list.</p>
            <p style="margin:0 0 16px 0;">Fundhub</p>
            <p style="margin:0;font-size:13px;color:#52525B;">fundhub.ai<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$),
   ('SMS-VAULT-ASK-3', 'sms', NULL::text,
    $c$Hey {{contact.first_name}}, Fundhub. Checking in: we still need {{vault.what}} for your file.{{vault.more_phrase}} If something is in the way, reply here and a person will help. Portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.$c$)
 ) AS t(template_key, channel, subject, body)
ON CONFLICT (org_id, template_key) DO NOTHING;
