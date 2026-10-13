-- 480_hiring_coo_req.sql — the COO seat for the hiring funnel (fundhub.ai/join/).
--
-- OWNER-SET 2026-10-13 (Chris, in chat): the hiring funnel hires closers,
-- setters, CSMs and a COO. Closers, setters and CSMs book on the sales
-- manager's calendar. The COO books with Chris, because a COO sits above the
-- sales manager.
--
-- 294's routing rule already says it: sales-facing seats go to sales_manager,
-- "anything other than that goes to either a hiring manager or the COO. For now
-- it's just give the COO, which is me, the CEO." So owner_role is 'owner', and
-- src/hiring/owner.mjs routes the "New application" task to Chris.
--
-- bench_target 0. 051's "4-5 on the bench" is about closers, where churn is the
-- norm. A COO is one seat; a standing task to keep spare COOs warm is not a
-- thing anybody asked for.
--
-- interview_booking_url is NOT seeded. It is Chris's calendar link and it is not
-- in this repository. v_hiring_config_gaps (295) already reports an empty one,
-- and the funnel answers "we'll reach out" instead of a calendar until it is set.

INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role)
SELECT o.id, 'coo', 'Chief Operating Officer', 0, 'owner'
  FROM orgs o
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM hiring_roles r WHERE r.org_id = o.id AND r.key = 'coo'
   );
