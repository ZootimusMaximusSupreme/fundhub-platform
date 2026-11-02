-- Align the existing $200 two-round enrollment with the words buyers sign and receive.
-- Keep previously signed agreement snapshots intact.
UPDATE contract_templates
   SET body = replace(body,
       'You pay {{field.trial_fee}} for the first done-for-you dispute round described above.',
       'You pay {{field.trial_fee}} once for the two done-for-you dispute rounds described above.'),
       updated_at = now()
 WHERE template_key = 'REPAIR-TRIAL-AGREEMENT'
   AND strpos(body, 'You pay {{field.trial_fee}} for the first done-for-you dispute round described above.') > 0;

UPDATE message_templates
   SET subject = CASE
         WHEN subject = 'Your first repair round is starting'
         THEN 'Your two-round repair test run'
         ELSE subject
       END,
       body = replace(replace(replace(replace(body,
         'Your test round is starting.',
         'Your $200 test run covers two done-for-you rounds.'),
         'This is one full round, done for you — we identify what''s disputable, send the letters, and show you exactly what comes back from the bureaus.',
         'Your credit specialist builds Round 1 from your file. After we record the response and get a newer pull, we prepare Round 2. You can track letters and replies in your portal as they are recorded.'),
         'When the round closes, we''ll go through the results with you and you can decide whether to keep going.',
         'After both rounds, we''ll review the results with you and you can decide whether to keep going.'),
         '<title>Your first repair round is starting</title>', '<title>Your two-round repair test run</title>'),
       updated_at = now()
 WHERE template_key = 'EMAIL-OFFER-REPAIR-TRIAL'
   AND strpos(body, 'This is one full round, done for you') > 0;
