-- Only the two fixed-price phrases change. Existing sent/signed contracts keep
-- their immutable rendered_body and merge_values. No contract row is changed.
-- package_fee is filled and validated by contracts/send.mjs, never typed in.
UPDATE contract_templates
   SET body = replace(replace(body,
         'The tuition for this program is five thousand United States dollars ($5,000).',
         'The tuition for this program is {{field.package_fee}} United States dollars.'),
         'Tuition is five thousand dollars ($5,000), charged one time.',
         'Tuition is {{field.package_fee}}, charged one time.'),
       manual_fields = '[]'::jsonb,
       updated_at = now()
 WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
   AND (strpos(body, 'The tuition for this program is five thousand United States dollars ($5,000).') > 0
     OR strpos(body, 'Tuition is five thousand dollars ($5,000), charged one time.') > 0);
