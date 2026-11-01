-- A completed setter handoff means Set. Customer call confirmation is a separate flag.
-- Keep the existing stage id and key so current cards and saved moves remain linked.
UPDATE pipeline_stages s
   SET name = 'Set'
  FROM pipelines p
 WHERE p.id = s.pipeline_id AND p.org_id = s.org_id
   AND p.key = 'sales' AND s.key = 'confirmed';

-- Existing finished handoffs should appear as Set when their Sales card is still
-- before Set. Never move a card back from a later sales outcome.
UPDATE cards cd
   SET stage_id = set_stage.id, entered_at = now()
  FROM clients c, pipelines p, pipeline_stages set_stage, pipeline_stages old_stage
 WHERE c.id = cd.client_id AND c.org_id = cd.org_id
   AND p.id = cd.pipeline_id AND p.org_id = cd.org_id AND p.key = 'sales'
   AND set_stage.pipeline_id = p.id AND set_stage.org_id = p.org_id AND set_stage.key = 'confirmed'
   AND old_stage.id = cd.stage_id AND old_stage.pipeline_id = p.id
   AND old_stage.sort_order < set_stage.sort_order
   AND NULLIF(c.custom_fields->'setter_handoff'->>'complete_at', '') IS NOT NULL;
