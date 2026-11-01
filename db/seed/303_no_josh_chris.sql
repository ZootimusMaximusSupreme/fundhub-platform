-- 303_no_josh_chris.sql
--
-- A seed, not a migration, on purpose (same reason as 301): seeds 007 to 034 and 295 write
-- these template rows and run after every migration on a new database, so a migration would
-- lose to them there. Numbered after 302 so it runs last. On production the older seeds ran
-- long ago and this one runs once. Seed 302 lives on another branch.
--
-- Owner rule, 2026-10-31, Chris Stanbridge: "from now on we're gonna be removing Josh AI from
-- the system because it's too confusing. People are like, oh, am I hopping on a call with
-- Josh? Am I hopping on a call with Chris? ... Anywhere in the repo that says Josh just remove
-- it it's Chris now for everything ... just use my name ... I'll sign it."
-- Law: .ai/rules/no-josh-chris-everywhere.md
--
-- The live words are database rows, so editing the old seed files changes nothing on
-- production. This file changes the rows themselves. Three tables hold Josh:
--
--   1. message_templates  Every text and email that still says Josh now says Chris. On a
--                         database built only from db/ that is 30 rows: 27 emails signed
--                         "- Josh" on their own line (SLO drip, gift, coupon, $197 and
--                         first-five emails, and the portal sign-in link), and 3 texts
--                         (SMS-AISET04-HANDOFF, SMS-BS01-02-PRECALL, SMS-SLO-DIG).
--   2. agents             The setter's name ("Setter Josh" is AG-04, now "Setter Chris") and
--                         "Josh at Fundhub" on the three retired GHL agents. Also the prompt
--                         and runtime notes of any agent, so a prompt that someone typed into
--                         the Agent Editor on production and says "You are Josh" now says
--                         "You are Chris". That is the voice agent's introduction on a call.
--   3. journeys           The Journeys editor saves a node that names the agent by its exact
--                         name ("Setter Josh"). The agent is renamed above, so the saved
--                         journeys are renamed with it, or the journey check would report an
--                         agent that no longer exists.
--
-- Why a word swap and not 30 pasted bodies (the way seed 301 pastes its 20):
--   - Only the name changes. Every other word stays exactly as it is on production, including
--     any edit Chris made in the template editor.
--   - The source-doc seeder (src/messaging/seed/seed.mjs) writes template rows from
--     fundhub-docs/sources, and those docs are not in db/. A production database can hold
--     Josh-signed rows under keys that no file in db/ names, so no fixed list of keys is safe.
--     The swap finds every row that still says Josh, on any key and for any company, and
--     nothing else.
--   - Safe to run twice. Once nothing says Josh, the WHERE finds no rows.
--   - Whole word only (\mJosh\M, case sensitive), so a name like Joshua is never touched.
--   Every changed sentence was read: "it's Josh at Fundhub" is now "it's Chris at Fundhub", a
--   "- Josh" sign-off is "- Chris", "Josh from Fundhub here" is "Chris from Fundhub here".
--
-- What this file does to a template row:
--   - Swaps the name in subject and body.
--   - Clears approved_by, approved_at and approved_body_sha, because whatever a person signed
--     off was the old words (116_template_approval.sql); a stale hash would turn the pulse's
--     "template-copy:seed-vs-live-drift" check red.
--   - Does not touch compliance_passed. A row that was approved stays approved and keeps
--     sending. A row someone held back stays held back.
--   Writing a template sends nothing.
--
-- Not changed here, on purpose: messages already sent (their words are history), the Inngest
-- function id ai-set-01-josh-setter (it is stored in outbound_calls.kind and in run history),
-- and the old signature picture files that emails already in people's inboxes load by address.
--
-- Left out on purpose, five keys: SMS-S04-01-CONFIRM, SMS-S04-02-REMIND-24H,
-- SMS-S04-03-REMIND-2H, SMS-BS01-01-CONFIRMATION-HUB and SMS-BS01-02-PRECALL-NUDGE. Chris's
-- rule of 2026-10-31 says no message may ask a lead to reply to confirm; the one ask is to
-- accept the calendar invite in their email. Seed 305 (branch claude/confirm-on-calendar)
-- rewrites those five completely, signed Chris, with no reply ask. They are excluded here so
-- the two seeds can never overwrite each other, whichever order they ship in. This file adds
-- no reply-to-confirm ask anywhere: it only swaps the name.

-- 1. Message templates.
UPDATE message_templates
   SET subject           = regexp_replace(subject, '\mJosh\M', 'Chris', 'g'),
       body              = regexp_replace(body,    '\mJosh\M', 'Chris', 'g'),
       approved_by       = NULL,
       approved_at       = NULL,
       approved_body_sha = NULL,
       updated_at        = now()
 WHERE (subject ~ '\mJosh\M' OR body ~ '\mJosh\M')
   AND template_key NOT IN (
         'SMS-S04-01-CONFIRM',
         'SMS-S04-02-REMIND-24H',
         'SMS-S04-03-REMIND-2H',
         'SMS-BS01-01-CONFIRMATION-HUB',
         'SMS-BS01-02-PRECALL-NUDGE'
       );

-- 2. Agents.
UPDATE agents
   SET name          = regexp_replace(name,          '\mJosh\M', 'Chris', 'g'),
       from_name     = regexp_replace(from_name,     '\mJosh\M', 'Chris', 'g'),
       prompt        = regexp_replace(prompt,        '\mJosh\M', 'Chris', 'g'),
       runtime_notes = regexp_replace(runtime_notes, '\mJosh\M', 'Chris', 'g'),
       updated_at    = now()
 WHERE name          ~ '\mJosh\M'
    OR from_name     ~ '\mJosh\M'
    OR prompt        ~ '\mJosh\M'
    OR runtime_notes ~ '\mJosh\M';

-- 3. Saved journeys. Every saved journey names its agent node by the agent's exact name.
UPDATE journeys
   SET name        = regexp_replace(name,        '\mJosh\M', 'Chris', 'g'),
       start_when  = regexp_replace(start_when,  '\mJosh\M', 'Chris', 'g'),
       end_when    = regexp_replace(end_when,    '\mJosh\M', 'Chris', 'g'),
       description = regexp_replace(description, '\mJosh\M', 'Chris', 'g'),
       nodes       = regexp_replace(nodes::text, '\mJosh\M', 'Chris', 'g')::jsonb,
       updated_at  = now()
 WHERE name        ~ '\mJosh\M'
    OR start_when  ~ '\mJosh\M'
    OR end_when    ~ '\mJosh\M'
    OR description ~ '\mJosh\M'
    OR nodes::text ~ '\mJosh\M';
