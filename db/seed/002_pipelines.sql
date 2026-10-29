-- Seed the 6 original pipelines + stages from Master Rebuild Spec § 5
-- (current GHL stages + the May 4 advisor logic doc). Default org = fundhub.
--
-- 'affiliates_hiring' (R-07) is RETIRED — see migrations/051_hiring.sql,
-- migrations/115_affiliates_white_label.sql, and
-- migrations/127_retire_affiliates_hiring.sql. Hiring and Affiliates + White
-- Label are their own rails, added by those migrations, not this seed.

WITH org AS (SELECT id FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipelines (org_id, key, name)
SELECT org.id, k, n FROM org, (VALUES
  ('sales',                 'Sales'),
  ('funding_card_stacking', 'Funding: Card Stacking'),
  ('funding_altfin',        'Funding: Alt-Fin (Lendflow)'),
  ('optimization',          'Optimization (Repair) Rounds'),
  ('inquiry_removal',       'Inquiry Removal'),
  ('ar_collections',        'AR / Collections')
) AS v(k, n)
ON CONFLICT (org_id, key) DO NOTHING;

-- Stages per pipeline (sort_order = display order).
WITH org AS (SELECT id AS oid FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
SELECT org.oid, p.id, s.key, s.name, s.ord
FROM org
JOIN pipelines p ON p.org_id = org.oid
JOIN (VALUES
  -- Sales (S + DPC series)
  ('sales','new_lead','New Lead',0),('sales','survey_complete','Survey Complete',1),
  ('sales','booked','Booked',2),('sales','confirmed','Set',3),('sales','showed','Showed',4),
  ('sales','diagnostic_paid','Diagnostic Paid',5),('sales','decision_rendered','Decision Rendered',6),
  ('sales','closed_won','Closed Won (deposit)',7),('sales','downsell','Downsell',8),('sales','lost','Lost',9),
  -- Funding: Card Stacking (F series + FUNDING_ROUNDS)
  ('funding_card_stacking','apply_now','Apply Now',0),('funding_card_stacking','round_submitted','Round Submitted',1),
  ('funding_card_stacking','approved','Approved',2),('funding_card_stacking','action_required','Action Required',3),
  ('funding_card_stacking','funded','Funded',4),('funding_card_stacking','closed','Closed',5),
  -- Funding: Alt-Fin (cards move ONLY from Lendflow webhooks)
  ('funding_altfin','app_created','App Created',0),('funding_altfin','docs_stips','Docs/Stips',1),
  ('funding_altfin','underwriting','Underwriting',2),('funding_altfin','offers','Offers',3),
  ('funding_altfin','offer_accepted','Offer Accepted',4),('funding_altfin','funded','Funded',5),('funding_altfin','closed','Closed',6),
  -- Optimization (Repair) — DS-02 letters attach here and ONLY here
  ('optimization','intake','Intake',0),('optimization','awaiting_documents','Awaiting Documents',1),
  ('optimization','analysis','Analysis',2),('optimization','letters_generated','Letters Generated',3),
  ('optimization','ready_to_send','Ready to Send',4),('optimization','in_transit','In Transit',5),
  ('optimization','awaiting_response','Awaiting Response',6),('optimization','response_received','Response Received',7),
  ('optimization','round_complete','Round Complete',8),('optimization','program_complete','Program Complete',9),
  ('optimization','on_hold','On Hold',100),('optimization','stalled','Stalled',101),
  ('optimization','cancelled','Cancelled',102),
  -- legacy aliases kept for remap safety on old seeds
  ('optimization','round_sent','Round Sent (legacy)',900),('optimization','bureau_processing','Bureau Processing (legacy)',901),
  ('optimization','portal_updated','Portal Updated (legacy)',902),('optimization','upgrade_invite','Upgrade Invite (legacy)',903),
  -- Inquiry Removal (fraud gate resolvable per Chris)
  ('inquiry_removal','requested','Requested',0),('inquiry_removal','specialist_assigned','Specialist Assigned',1),
  ('inquiry_removal','calls_in_progress','Calls In Progress',2),('inquiry_removal','removed','Removed',3),
  ('inquiry_removal','resume_funding','Resume Funding',4),('inquiry_removal','hold','Hold',5),
  -- AR / Collections (AR series + voice agent)
  ('ar_collections','invoice_sent','Invoice Sent',0),('ar_collections','reminder','Reminder',1),
  ('ar_collections','escalation','Escalation',2),('ar_collections','paid','Paid',3),('ar_collections','written_off','Written Off',4)
) AS s(pkey, key, name, ord) ON s.pkey = p.key
ON CONFLICT (pipeline_id, key) DO NOTHING;
