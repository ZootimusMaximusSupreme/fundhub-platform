-- Restore the approved missed-call copy after the stale source-doc seed
-- overwrote it. Keep the update scoped to the broken live template body.
UPDATE message_templates
   SET body = $c${{contact.first_name}}, it's Fundhub — looks like we missed each other on your call. Nothing is lost and nothing is closed. Grab a new time whenever suits: {{custom_values.booking_link}} Reply STOP to opt out.$c$,
       updated_at = now()
 WHERE template_key = 'SMS-S05A-NOSHOW-RECOVERY'
   AND source_doc = 'fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md'
   AND body LIKE '%{{appointment.start_time}}%';
