-- 498 — client checklist steps say "our team", never "your advisor".
--
-- OWNER DECISION (Chris, 2026-10-20, final): Capital Blueprint has no named
-- human advisor. AI coaches do the touch-base and the Fundhub team works a CSM
-- queue. Client-facing words say "the Fundhub team" / "our team", never "your
-- advisor". 490 and 491 already carry this for the coach prompts, the coach
-- email and the agreement. This file is the client checklist.
--
-- 362 and 363 are applied in production, so editing them would be a silent
-- no-op (migrate.mjs keys on <dir>/<file>). This file supersedes their wording.
--
-- WHAT CHANGES, AND ONLY WHERE THE TEXT IS STILL EXACTLY THE OLD TEXT:
--   * waypoint_definitions (the catalog the seeder reads)
--       no_new_credit.detail, personal_loan.title, personal_loan.detail
--   * client_waypoints (each client's stored copy of the step — seed.mjs copies
--     the rendered title and detail onto the row, and none of these three
--     strings carries a {token}, so the rendered text equals the 362 text)
--       the same three fields on the same two keys
--   * client_waypoints.state_reason on no_new_credit, written by
--     src/waypoints/verify.mjs newAccountReason(): only the closing sentence
--     "Let your advisor know if ... not yours." changes, and only on a reason
--     that still has the exact generated shape.
-- Title and detail are separate UPDATEs, so a row where the owner edited one of
-- them still gets the other fixed and keeps the edit. A replay changes nothing.
--
-- NOT TOUCHED: the "funding advisor" staff role, any other table, any other key.
-- Copy only. No DELETE, no schema change, no send. The table names are left
-- unqualified so src/waypoints/step-words-fundhub-team.pg.test.mjs can run this
-- exact file against temp tables in a rolled-back transaction.

-- ── the catalog ────────────────────────────────────────────────────────────
UPDATE waypoint_definitions
   SET detail = $new$A new card adds a hard inquiry and lowers the average age of your accounts. Talk to our team before you apply for anything.$new$
 WHERE key = 'no_new_credit'
   AND detail = $old$A new card adds a hard inquiry and lowers the average age of your accounts. Talk to your advisor before you apply for anything.$old$;

UPDATE waypoint_definitions
   SET title = $new$Talk to our team about a personal loan$new$
 WHERE key = 'personal_loan'
   AND title = $old$Talk to your advisor about a personal loan$old$;

UPDATE waypoint_definitions
   SET detail = $new$Raise it early, before any of the optimization work changes your accounts. Our team will walk you through whether it fits your plan.$new$
 WHERE key = 'personal_loan'
   AND detail = $old$Raise it early, before any of the optimization work changes your accounts. Your advisor will walk you through whether it fits your plan.$old$;

-- ── each client's stored step ──────────────────────────────────────────────
UPDATE client_waypoints
   SET detail = $new$A new card adds a hard inquiry and lowers the average age of your accounts. Talk to our team before you apply for anything.$new$
 WHERE key = 'no_new_credit'
   AND detail = $old$A new card adds a hard inquiry and lowers the average age of your accounts. Talk to your advisor before you apply for anything.$old$;

UPDATE client_waypoints
   SET title = $new$Talk to our team about a personal loan$new$
 WHERE key = 'personal_loan'
   AND title = $old$Talk to your advisor about a personal loan$old$;

UPDATE client_waypoints
   SET detail = $new$Raise it early, before any of the optimization work changes your accounts. Our team will walk you through whether it fits your plan.$new$
 WHERE key = 'personal_loan'
   AND detail = $old$Raise it early, before any of the optimization work changes your accounts. Your advisor will walk you through whether it fits your plan.$old$;

-- ── the blocked reason on the no-new-credit step ───────────────────────────
UPDATE client_waypoints
   SET state_reason = regexp_replace(
         state_reason,
         ' Let your advisor know if (this is|any of these are) not yours\.$',
         ' Let our team know if \1 not yours.')
 WHERE key = 'no_new_credit'
   AND state_reason ~ '^Your credit file now shows (an account that was|accounts that were|[0-9]+ accounts that were) not on it when you enrolled(: .+)?\. Let your advisor know if (this is|any of these are) not yours\.$';
