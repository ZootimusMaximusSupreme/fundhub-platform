-- Keep the S-00 and S-02 copy truthful while survey links open plain /apply.
-- Runs after 301, including on databases where 301 already ran.

UPDATE message_templates AS t
   SET body = v.body,
       compliance_passed = true,
       approved_by = NULL,
       approved_at = NULL,
       approved_body_sha = NULL,
       updated_at = now()
  FROM (VALUES
    ('SMS-S00-WELCOME', $copy$Chris with Fundhub here. Got your info, thank you. To finish your questions and pick a call time, start here: https://apply.fundhub.ai/apply
Reply STOP to opt out.$copy$),
    ('SMS-S02-RESUME-1', $copy$Chris with Fundhub here. If you still want to finish your questions and pick a call time, start here: https://apply.fundhub.ai/apply
Reply STOP to opt out.$copy$),
    ('SMS-S02-RESUME-2', $copy$Still want to talk funding? Start the Fundhub questions here, then pick a call time: https://apply.fundhub.ai/apply
Reply STOP to opt out.$copy$),
    ('SMS-S02-RESUME-3', $copy$Last note about the Fundhub questions. If you still want a call, start here: https://apply.fundhub.ai/apply
Reply STOP to opt out.$copy$)
  ) AS v(template_key, body)
 WHERE t.template_key = v.template_key;

UPDATE message_templates
   SET body = replace(replace(replace(body,
         'This button opens your questions right where you left off.',
         'This button starts the questions again from the first one.'),
         'This button takes you back to your questions.',
         'This button starts the questions again from the first one.'),
         '{{survey_resume_link}}', 'https://apply.fundhub.ai/apply'),
       compliance_passed = true,
       approved_by = NULL,
       approved_at = NULL,
       approved_body_sha = NULL,
       updated_at = now()
 WHERE template_key = 'EMAIL-S00-WELCOME';

UPDATE message_templates
   SET subject = 'Finish your Fundhub questions',
       body = replace(replace(replace(replace(replace(body,
         'Your answers are saved. No starting over.',
         'The survey starts again at the first question.'),
         'The button below picks up at {{survey_stopped_at}}.',
         'Use the button below to start the questions again.'),
         'Pick up where I stopped', 'Start my questions'),
         '<title>Pick up where you stopped</title>', '<title>Finish your questions</title>'),
         '{{survey_resume_link}}', 'https://apply.fundhub.ai/apply'),
       compliance_passed = true,
       approved_by = NULL,
       approved_at = NULL,
       approved_body_sha = NULL,
       updated_at = now()
 WHERE template_key = 'EMAIL-S02-RESUME-1';

UPDATE message_templates
   SET body = replace(replace(body,
         'That starts with your questions. You''re {{survey_taps_left}} away.',
         'That starts with your questions. Open the survey and finish them.'),
         '{{survey_resume_link}}', 'https://apply.fundhub.ai/apply'),
       compliance_passed = true,
       approved_by = NULL,
       approved_at = NULL,
       approved_body_sha = NULL,
       updated_at = now()
 WHERE template_key = 'EMAIL-S02-RESUME-2';

UPDATE message_templates
   SET body = replace(replace(body,
         'If funding is still on your list, it''s {{survey_taps_left}}, then you pick a call time.',
         'If funding is still on your list, start the questions again and then pick a call time.'),
         '{{survey_resume_link}}', 'https://apply.fundhub.ai/apply'),
       compliance_passed = true,
       approved_by = NULL,
       approved_at = NULL,
       approved_body_sha = NULL,
       updated_at = now()
 WHERE template_key = 'EMAIL-S02-RESUME-3';
