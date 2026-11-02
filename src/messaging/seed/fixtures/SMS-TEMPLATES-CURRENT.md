# FIXTURE — shaped like fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md

Not real copy. Exercises `## KEY` headings, plain-text bodies, and an empty body.

SMS-BROKEN-01-EMPTY deliberately has NO body and NO footer. The 2026-08-21
footer sweep pasted `— Chris at Fundhub...` onto it too, which made the empty
case non-empty and silently deleted the only test of a header with nothing
under it. Leave that block empty.

## SMS-FIX-01-PLAIN

Hey {{contact.first_name}}, line one.
Line two with {{custom_values.booking_link}}.
— Chris at Fundhub. Reply STOP to opt out.
## SMS-FIX-02-SINGLE

Single line body.
— Chris at Fundhub. Reply STOP to opt out.
## SMS-CLEAN-01-PLAIN

Body sits directly under the header.
— Chris at Fundhub. Reply STOP to opt out.
## SMS-BROKEN-01-EMPTY

## SMS-F03-01-ROUND-SUBMITTED

Update from Chris, {{contact.first_name}}: Round {{custom_fields.funding_round_number}} has been submitted. Partner banks usually review within 24 to 72 hours, sometimes longer. I'll text you the moment there's movement. What happens next: {{custom_values.funding_round_next_steps_video_link}}
— Chris at Fundhub. Reply STOP to opt out.
