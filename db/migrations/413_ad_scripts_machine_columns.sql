-- 413_ad_scripts_machine_columns.sql — the script machine's columns on ad_scripts:
-- a status, a root that ties every version of one script together, the machine's
-- own fields, and the backfill of the rows already there.
--
-- Spec: docs/specs/marketing-machine-2026-10-04.md §7.4 (Data), §4 traps 3, 4, 9.
-- Plan unit U11 (ops/workflows/marketing-machine-2026-10-plan.json). The tables
-- the new batch_id / idea_id columns point at (marketing_batches, ad_ideas) are
-- created in 414, which also adds those two foreign keys.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT CHANGES ABOUT A SCRIPT, IN THREE SENTENCES
--
--   1. A script now has a STATUS: draft → locked | rejected | expired;
--      locked → filmed; filmed → locked (needs_retake) when its video is
--      rejected; any version that a newer one replaced → superseded.
--   2. Every version of one script shares a ROOT (root_script_id, the id of
--      version 1). There is at most ONE live version per root, and a version
--      number is used once per root.
--   3. A rewrite ARCHIVES the version it replaces, in the same transaction that
--      inserts the new one (spec §4 trap 9). This overrides 377's column comment
--      on ad_scripts.version, which said two rewrite branches may both be
--      version 2. They may not any more: api/scripts/write.mjs refuses to
--      rewrite a version that is already archived (409 stale).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EVERY OLD WRITER STILL WORKS, UNCHANGED
--
-- Grepped 2026-10-05 for INSERT INTO ad_scripts across src/, scripts/, api/:
--   api/scripts/write.mjs (updated in the same change), scripts/ad-scripts-load-
--   locked.mjs, and the fixtures in src/http/ad-spine, ad-asset-link,
--   compliance/invariants and db/label-spine pg tests.
-- None of them names status, source or root_script_id. So:
--   * status  is NOT NULL DEFAULT 'draft'
--   * source  is NOT NULL DEFAULT 'chris'
--   * root_script_id is NOT NULL and filled by a BEFORE INSERT trigger
--     (set_root_script_id) for every writer, old or new.
-- The trigger matters more than it looks: a NULL root would make both unique
-- indexes below useless, because NULLs never collide in a unique index.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION, MEASURED BEFORE THIS FILE WAS WRITTEN (2026-10-05, read-only
-- SELECT inside BEGIN READ ONLY via the Supabase MCP)
--
--   8 rows, all version 1, none with a parent, none archived.
--   7 carry ad_id 84-90 (the locked $297 ads)  → become 'locked'.
--   1 has no ad_id ('MKT-WALK 2026-09-17')     → becomes 'draft'.
--   Simulated backfill: 0 rows without a root, 0 duplicate (root, version),
--   0 roots with two live rows, 0 locked rows without an ad_id. Every
--   constraint below holds on those 8 rows.
--
--
-- NULL MEANS UNKNOWN (CLAUDE.md §12). Every new column except status, source,
-- needs_retake and root_script_id is nullable, and NULL means nobody has said.
-- A backfilled locked row has locked_at NULL because nobody recorded when it was
-- locked, not because it was locked at the epoch.


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 0 — ACT AS STAFF FOR THE LENGTH OF THIS MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Part 3 below UPDATEs ad_scripts, which forces partner row security (377 Part
-- 4e). Exactly as 377 Part 0 does: a transaction-local set_config, never a bare
-- SET. is_local = true dies at the COMMIT db/migrate.mjs wraps around this file,
-- so 'staff' cannot leak onto the pooled connection migrate.mjs reuses for the
-- next file.

SELECT set_config('fundhub.actor', 'staff', true);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — THE NEW COLUMNS
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ad_scripts
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS script_format   text,
  ADD COLUMN IF NOT EXISTS style           text,
  ADD COLUMN IF NOT EXISTS funnel_key      text,
  ADD COLUMN IF NOT EXISTS batch_id        uuid,
  ADD COLUMN IF NOT EXISTS idea_id         uuid,
  -- Nullable for the length of Part 3 only; Part 5 makes it NOT NULL.
  ADD COLUMN IF NOT EXISTS root_script_id  uuid REFERENCES ad_scripts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parts           jsonb,
  ADD COLUMN IF NOT EXISTS check_results   jsonb,
  ADD COLUMN IF NOT EXISTS fix_note        text,
  ADD COLUMN IF NOT EXISTS animation_plan  jsonb,
  ADD COLUMN IF NOT EXISTS meta_copy       jsonb,
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'chris',
  ADD COLUMN IF NOT EXISTS film_order      integer,
  ADD COLUMN IF NOT EXISTS needs_retake    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by       uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by     uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS filmed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS repo_path       text,
  ADD COLUMN IF NOT EXISTS repo_commit     text;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — THE SHAPE CHECKS (DROP IF EXISTS, then ADD — spec §4 trap 4)
-- ═══════════════════════════════════════════════════════════════════════════

-- The six states of spec §7.4 "How status moves".
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_status_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_status_ck
  CHECK (status IN ('draft', 'locked', 'rejected', 'filmed', 'superseded', 'expired'));

-- Who wrote this version. 'import' = a row that was here before the machine
-- (Part 3); imported rows stay out of the Inbox, expiry and the nightly check.
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_source_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_source_ck
  CHECK (source IN ('machine', 'chris', 'agent', 'import'));

-- Words or bullets (owner decision 15: standard ads use bullets).
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_style_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_style_ck
  CHECK (style IS NULL OR style IN ('words', 'bullets'));

-- script_format (standard, sorting, long, notes, greenscreen, vsl today) and
-- funnel_key (marketing_funnels.key, e.g. book_call, roadmap_147) take the same
-- shape as the four label keys (377:197-204): a SHAPE, not a list, so a new
-- format or funnel never needs a migration (naming is never a blocker,
-- owner-set 2026-09-06). Named script_format because 377:246-247 keeps
-- "format" free on purpose — creative_assets.format means the aspect ratio.
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_script_format_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_script_format_ck
  CHECK (script_format IS NULL OR script_format ~ '^[a-z][a-z0-9_]{1,48}$');

ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_funnel_key_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_funnel_key_ck
  CHECK (funnel_key IS NULL OR funnel_key ~ '^[a-z][a-z0-9_]{1,48}$');

-- parts is the marked-up body: [{kind: hook|line2|body|cue|reveal|cta, text}].
-- The prompter, the aligner and the animation anchors all walk it as a list.
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_parts_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_parts_ck
  CHECK (parts IS NULL OR jsonb_typeof(parts) = 'array');


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3 — THE BACKFILL, IN THE SPEC'S ORDER
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. Archived rows become superseded.
--   2. Rows with an ad_id become locked.
--   3. All other rows become drafts.
--   Every backfilled row gets source 'import', and root_script_id = the id of
--   the first version in its parent chain (recursive; today every row is its
--   own root, because no production row has a parent).
--
-- ONLY ROWS WITH NO ROOT YET ARE TOUCHED. Every row written after Part 4 gets a
-- root from the trigger, so this UPDATE can never relabel a real machine or
-- Chris row as an import — a re-run of this block is a no-op.
--
-- A ROW THE CHAIN CANNOT REACH (a parent cycle, which no writer can produce)
-- keeps a NULL root, and Part 5's SET NOT NULL then fails this file loudly.
-- That is on purpose: a guessed root would be a wrong fact in the database.
--
-- updated_at IS KEPT. trg_ad_scripts_updated_at (377 Part 4f) stamps now() on
-- every UPDATE, and the ad-video matcher orders candidates by updated_at
-- (src/ad-videos/store.mjs). Filling new columns is not an edit to the script,
-- so the stamp is switched off for this one statement and back on after it.
-- ALTER TABLE ... DISABLE TRIGGER is transactional: if anything fails, the
-- ROLLBACK db/migrate.mjs runs puts the trigger back as it was.
--
-- src/http/ad-scripts-machine.pg.test.mjs runs the block between the BEGIN and
-- END markers verbatim against fixture rows, so the markers are load-bearing.

-- BEGIN U11 BACKFILL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'trg_ad_scripts_updated_at'
                AND tgrelid = 'public.ad_scripts'::regclass) THEN
    EXECUTE 'ALTER TABLE ad_scripts DISABLE TRIGGER trg_ad_scripts_updated_at';
  END IF;
END $$;

WITH RECURSIVE chain (id, root_id) AS (
  SELECT s.id, s.id
    FROM ad_scripts s
   WHERE s.parent_script_id IS NULL
  UNION ALL
  SELECT c.id, ch.root_id
    FROM ad_scripts c
    JOIN chain ch ON c.parent_script_id = ch.id
)
UPDATE ad_scripts s
   SET status = CASE
                  WHEN s.archived_at IS NOT NULL THEN 'superseded'
                  WHEN s.ad_id IS NOT NULL       THEN 'locked'
                  ELSE 'draft'
                END,
       source = 'import',
       root_script_id = chain.root_id
  FROM chain
 WHERE chain.id = s.id
   AND s.root_script_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'trg_ad_scripts_updated_at'
                AND tgrelid = 'public.ad_scripts'::regclass) THEN
    EXECUTE 'ALTER TABLE ad_scripts ENABLE TRIGGER trg_ad_scripts_updated_at';
  END IF;
END $$;
-- END U11 BACKFILL


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4 — EVERY NEW ROW GETS A ROOT: set_root_script_id()
-- ═══════════════════════════════════════════════════════════════════════════
--
-- root = COALESCE(the root the writer sent, the parent's root, the row's own id).
--
-- NEW.id is already filled here: a column DEFAULT (gen_random_uuid()) is applied
-- before BEFORE ROW triggers run.
--
-- NOT security definer, matching its neighbours (377's partner-move guard), so
-- it reads the parent through the caller's own row security. Every writer runs
-- inside asStaff() and sees every parent. If the parent is NOT visible — a
-- partner session pointing at another partner's script, or an id that does not
-- exist — the insert is refused here with a sentence, instead of quietly
-- starting a new root that splits one script's history in two.

CREATE OR REPLACE FUNCTION set_root_script_id() RETURNS trigger AS $$
DECLARE parent_root uuid;
BEGIN
  IF NEW.root_script_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_script_id IS NOT NULL THEN
    SELECT root_script_id INTO parent_root
      FROM ad_scripts
     WHERE id = NEW.parent_script_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'ad_scripts: parent script % was not found from this session, so the rewrite has no root (413)',
        NEW.parent_script_id;
    END IF;
  END IF;

  NEW.root_script_id := COALESCE(parent_root, NEW.id);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ad_scripts_set_root ON ad_scripts;
CREATE TRIGGER trg_ad_scripts_set_root
  BEFORE INSERT ON ad_scripts
  FOR EACH ROW EXECUTE FUNCTION set_root_script_id();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5 — THE VERSION RULES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ad_scripts ALTER COLUMN root_script_id SET NOT NULL;

-- A version number is used once per script.
DROP INDEX IF EXISTS ad_scripts_root_version_uq;
CREATE UNIQUE INDEX ad_scripts_root_version_uq
  ON ad_scripts (root_script_id, version);

-- One live version per script. A rewrite archives the old version first, in the
-- same transaction, then inserts the new one (spec §4 trap 9).
DROP INDEX IF EXISTS ad_scripts_one_live_per_root_uq;
CREATE UNIQUE INDEX ad_scripts_one_live_per_root_uq
  ON ad_scripts (root_script_id)
  WHERE archived_at IS NULL;

-- A locked or filmed script is an ad, and an ad has a number. The reverse is
-- not required: an old-shape insert with an ad_id (scripts/ad-scripts-load-
-- locked.mjs) still lands as a draft.
ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_number_when_locked_ck;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_number_when_locked_ck
  CHECK (status NOT IN ('locked', 'filmed') OR ad_id IS NOT NULL);

-- The Inbox and the scripts list read live rows by status; the batch view reads
-- one batch's rows.
CREATE INDEX IF NOT EXISTS ad_scripts_org_status_idx
  ON ad_scripts (org_id, status, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS ad_scripts_batch_idx
  ON ad_scripts (batch_id)
  WHERE batch_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6 — WHAT EACH NEW COLUMN MEANS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN ad_scripts.version IS
  'Which draft this is: 1, 2, 3, counted per root_script_id. Since 413 a number is used ONCE per root (ad_scripts_root_version_uq): a rewrite archives the version it replaces and takes parent.version + 1, so two branches can no longer both be version 2. This replaces 377''s note that said they could.';
COMMENT ON COLUMN ad_scripts.status IS
  'Where the script is (413, spec 7.4): draft → locked | rejected | expired; locked → filmed; filmed → locked with needs_retake when its video is rejected; superseded = a newer version replaced it. Old-shape inserts land as draft. Backfilled rows: archived → superseded, ad_id → locked, else draft.';
COMMENT ON COLUMN ad_scripts.source IS
  'Who wrote this version: machine (the writer), chris, agent, or import (a row that existed before 413). Old-shape inserts land as chris. Imported rows stay out of the Inbox, expiry and the nightly check.';
COMMENT ON COLUMN ad_scripts.root_script_id IS
  'The id of version 1 of this script. Every version of one script shares it. Filled by trg_ad_scripts_set_root for any writer that does not send it: the parent''s root, else the row''s own id. One live (archived_at IS NULL) row per root.';
COMMENT ON COLUMN ad_scripts.script_format IS
  'standard, sorting, long, notes, greenscreen or vsl (spec 7.1). A shape check, not a list. NULL = not said.';
COMMENT ON COLUMN ad_scripts.style IS
  'words or bullets (owner decision 15). NULL = not said.';
COMMENT ON COLUMN ad_scripts.funnel_key IS
  'marketing_funnels.key this script was written for (e.g. book_call, roadmap_147). NULL = not tied to a funnel.';
COMMENT ON COLUMN ad_scripts.batch_id IS
  'The marketing_batches row that wrote this script. NULL for anything the machine did not write. Foreign key added in 414.';
COMMENT ON COLUMN ad_scripts.idea_id IS
  'The ad_ideas row this script was written from. NULL when it came from no idea. Foreign key added in 414.';
COMMENT ON COLUMN ad_scripts.parts IS
  'The body marked up for the prompter, the aligner and the anchors: a JSON array of {kind: hook|line2|body|cue|reveal|cta, text}. NULL = not marked up.';
COMMENT ON COLUMN ad_scripts.check_results IS
  'What the checker, the judge and the compliance screen said about this version (spec 7.6). NULL = not checked.';
COMMENT ON COLUMN ad_scripts.fix_note IS
  'Chris''s note asking the writer to fix this script (POST marketing/scripts/fix). NULL = none.';
COMMENT ON COLUMN ad_scripts.animation_plan IS
  'The animations for this ad: [{anchor, template, props, seconds}] (spec 7.6). NULL = none planned.';
COMMENT ON COLUMN ad_scripts.meta_copy IS
  'The words that go on the Meta ad: {primary_text, headline, description, cta_type}. NULL = none written.';
COMMENT ON COLUMN ad_scripts.film_order IS
  'Where this script sits in the next shoot (POST marketing/scripts/order). NULL = not ordered.';
COMMENT ON COLUMN ad_scripts.needs_retake IS
  'true when the video of a filmed script was rejected and the script went back to locked to be filmed again.';
COMMENT ON COLUMN ad_scripts.locked_at IS
  'When a person locked (approved) this script. NULL on imported rows: nobody recorded it.';
COMMENT ON COLUMN ad_scripts.locked_by IS
  'The staff member who locked it. Only a person locks a script (spec §4 trap 17).';
COMMENT ON COLUMN ad_scripts.rejected_at IS
  'When a person rejected it.';
COMMENT ON COLUMN ad_scripts.rejected_by IS
  'The staff member who rejected it. Only a person rejects a script.';
COMMENT ON COLUMN ad_scripts.rejected_reason IS
  'Why. With no dictated reason the app writes "rejected from the app, no reason given" (spec §4 trap 17).';
COMMENT ON COLUMN ad_scripts.filmed_at IS
  'When M3 matched a take to this script.';
COMMENT ON COLUMN ad_scripts.repo_path IS
  'The repo file for this script: marketing/ads/scripts/machine/<batch>/<nn>-<slug>.md (spec 7.9). The file never moves.';
COMMENT ON COLUMN ad_scripts.repo_commit IS
  'The commit that last wrote this version''s repo file. NULL = not committed yet.';
COMMENT ON FUNCTION set_root_script_id() IS
  'BEFORE INSERT on ad_scripts (413): root_script_id = COALESCE(sent root, the parent''s root, the row''s own id). Refuses a parent this session cannot see rather than starting a second root for one script.';
