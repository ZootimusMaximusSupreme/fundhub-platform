-- Owner-approved Blueprint voice escalation after two unanswered, sent texts.
-- Step 5 is a receipt, NOT a new timed nudge rung. The four-rung ladder and
-- step-4 human handoff stay unchanged. Existing daily and destination UNIQUE
-- indexes now also protect this one voice contact. No rows or approvals change.
ALTER TABLE public.waypoint_nudges
  DROP CONSTRAINT IF EXISTS waypoint_nudges_step_ck,
  DROP CONSTRAINT IF EXISTS waypoint_nudges_kind_ck,
  DROP CONSTRAINT IF EXISTS waypoint_nudges_channel_ck,
  DROP CONSTRAINT IF EXISTS waypoint_nudges_shape_ck,
  DROP CONSTRAINT IF EXISTS waypoint_nudges_outcome_kind_ck,
  DROP CONSTRAINT IF EXISTS waypoint_nudges_destination_kind_ck;

ALTER TABLE public.waypoint_nudges
  ADD CONSTRAINT waypoint_nudges_step_ck CHECK (step BETWEEN 1 AND 5),
  ADD CONSTRAINT waypoint_nudges_kind_ck CHECK (kind IN ('client_message', 'staff_task', 'voice_call')),
  ADD CONSTRAINT waypoint_nudges_channel_ck CHECK (channel IS NULL OR channel IN ('sms', 'email', 'voice')),
  ADD CONSTRAINT waypoint_nudges_shape_ck CHECK (
    (kind = 'staff_task' AND step = 4 AND channel IS NULL
      AND client_local_date IS NULL AND message_id IS NULL)
    OR (kind = 'client_message' AND step BETWEEN 1 AND 3
      AND channel IS NOT NULL AND channel IN ('sms', 'email') AND task_id IS NULL)
    OR (kind = 'voice_call' AND step = 5 AND channel = 'voice'
      AND channel IS NOT NULL AND template_key IS NOT NULL
      AND template_key = 'BP-COACH-VOICE' AND task_id IS NULL)
  ),
  ADD CONSTRAINT waypoint_nudges_outcome_kind_ck CHECK (
    (kind = 'staff_task' AND outcome IN ('claimed', 'staff_task'))
    OR (kind = 'client_message' AND outcome <> 'staff_task')
    OR (kind = 'voice_call' AND outcome IN ('claimed', 'queued', 'refused'))
  ),
  ADD CONSTRAINT waypoint_nudges_destination_kind_ck CHECK (
    destination_key IS NULL OR kind IN ('client_message', 'voice_call')
  );

COMMENT ON COLUMN public.waypoint_nudges.step IS
  '1-3 = existing text/email ladder; 4 = existing human handoff; 5 = owner-approved Blueprint AI call receipt after two actually sent, unanswered texts on the same current step. Step 5 adds no timed ladder rung and shares all existing daily caps.';
