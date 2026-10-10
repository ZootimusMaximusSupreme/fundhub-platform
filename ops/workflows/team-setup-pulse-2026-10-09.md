# Closer and setter calendar setup — in the heartbeat and pulse (2026-10-09)

Owner (Chris, 2026-10-09): "We already sent an email to Justice asking him to upload his information so we can plug it into ClickFunnels through API ... this better be part of the system we're building (the heartbeat and pulse)."

## What is true (checked 2026-10-09)

- Chris emailed Justice Nikkel (justice.nikkel@gmail.com) and Sarah Blankstein (sarahblankstein247@gmail.com) on 2026-10-07 at 10:41 a.m. Arizona, subject "Quick setup: connect your calendar for booked calls". Neither has replied.
- The ClickFunnels public API (249 paths, v2.0.0) has no call to invite a team member, connect a calendar, add a host or set hours. One scheduling path exists: list booked calls. A person must click these steps inside ClickFunnels.
- The ClickFunnels team has 2 seats (made Aug 7 and Aug 11). Neither is Justice or Sarah, so the invite was not sent or was not accepted.
- The live booking page (https://apply.fundhub.ai/funding-book-call) lists one host, Chris Stanbridge, and the place is Google Meet. ClickFunnels says a host can be picked only once a calendar is connected, so a person showing up as a host means their calendar is connected.

## Corrected design (Opus design, then Opus skeptic)

Facts checked again on 2026-10-09 (read-only):
- Gmail (stanbridgejchris@gmail.com). Two SENT threads, each holding 1 message. Justice: 2026-10-07T17:41:33Z. Sarah: 17:41:35Z. No mail has come from justice.nikkel@gmail.com, sarahblankstein247@gmail.com, justice.nikkel@fundhub.ai or sarah.b@fundhub.ai since Oct 6. Sarah's email does NOT have the line 'Booked sales calls will land on your calendar.' It does say 'We're connecting your Google calendar to our booking page' and that she will get a ClickFunnels invite.
- Live GET https://apply.fundhub.ai/funding-book-call returned 200 (161 KB). It has <script type="application/json" data-liquid-replace="item" id="state-node-script-2"> with event_type id 14234 'Funding Strategy Meeting', meeting_type 'one', event_hosts [14784 Chris Stanbridge], selected_host.pretty_location 'Google Meet' and staff_selection null. The hidden fields are host_id 14784 and event_type_id 14234.
- ClickFunnels GET /api/v2/teams (laptop key is real, 43 characters): 200. Team 456014 has 2 memberships, one admin made 2026-08-07 and one with no role made 2026-08-11. Neither is Justice or Sarah.
- ClickFunnels OpenAPI 2.0.0 has 249 paths. The only appointment path is GET /workspaces/{id}/appointments/scheduled_events. There is no invite, host, calendar, availability or conferencing path.
- ClickFunnels help, 'Appointments - How to Create and Manage Event Types', last updated Dec 1, 2025: 'The host's name will appear in the dropdown from calendar connections ... team members ... connect their individual calendars ... which can then be selected as a host.' So a listed host means a connected calendar.
- tasks has 16 columns, including title NOT NULL, due_at, done, is_demo, detail and assignee_role. Its role check allows 'owner'. The unique index tasks_idempotency_idx is (client_id, source_workflow, body) NULLS NOT DISTINCT. The RLS policy is qual true, so a plain read is not blind. The only trigger is updated_at. No closer-calendar row exists today.
- staff: 968bb01e… 'Justice Nikkel', closer, active. 6ccdca88… 'Sarah Blankstein', sales_manager, active. Both are in org fb789b0b….
- PULSE_CRON is 'TZ=America/Phoenix 0 6 * * *'. The step name is coverage-gap-closer-setup. namespaceGapId keeps 'closer-setup:*' ids. orderReds ranks a non-tripwire id last after day 1. There are 41 gap lanes now.
- Every skip row lands in audit:not-checked (src/pulse/self-audit.mjs).
- DARWIN_WHATSAPP and FUNNEL_URL are not set on production (names only), so no WhatsApp ticket carries the red.
- Run receipts (c2f24467) and the repair flow (4b499c75) are merged and shipped (ops/ship-log.md 13:51 and 14:02). No open branch touches the pulse except stale worktree-agent-ab01924b6953606d2 (Oct 6), which adds one line to registry.mjs. No clash.

Corrected design. It is the same two morning-only rows, with these changes:

1. NEW src/pulse/coverage/gap-closer-setup.mjs
Exports CHECK_IDS ['closer-setup:calendar-late','closer-setup:booking-page-host'], ASK_SOURCE 'closer-calendar-ask', GRACE_DAYS 3, ASK_BODY_PREFIX 'closer-calendar:' and gapChecks(ctx).
- One SELECT and one GET, run side by side. The GET has a 10 s timeout.
- The SELECT goes through ctx.scope if given, else ctx.db. It reads tasks t JOIN staff s, filtered on org_id = $1, source_workflow = 'closer-calendar-ask', done = false and is_demo = false. It parses the body as 'closer-calendar:<staff id>:<asked ISO>' to get the true ask time, and uses due_at as the red-after time.
- The GET is FUNNEL_URL (or https://apply.fundhub.ai) + /funding-book-call. It scans every <script ...type="application/json"...> in any attribute order, JSON.parses each, and uses the first one with event_type.
- calendar-late: the PASS, FAIL and skip rules are as designed.
  - detail carries the names, the ask date, days since, the due day and the hosts seen.
  - customerSees: 'No buyer is hurt yet. Chris still takes every booked call.'
  - suggestedFix line 1, with no name and no pronoun: 'A closer is past due to join the booking page. Send the ClickFunnels invite, nudge, give more days, or drop the ask.'
  - suggestedFix line 2: 'Only a ClickFunnels team admin can send the invite and add a host. The API cannot. The pulse sends nothing.'
  - If the staff row is no longer active, say so in the detail.
- booking-page-host: as designed. The detail names whose place was read ('place shown for <selected host>'). The empty-host FAIL stays, with a note that ClickFunnels may drop the block instead, which gives a skip.
- Both rows are emitted in every case: no ctx, a dead db, or a failed fetch.
- No INSERT, UPDATE, DELETE, BEGIN, COMMIT or SET. No POST. No fs. No messaging, notify or create-task import.

2. NEW src/pulse/coverage/gap-closer-setup.test.mjs
The test list from the design, plus:
- a fixture copied from the live tag, with data-liquid-replace in between and two state blocks;
- body parsing of the ask time;
- customerSees and fix line 1 hold no staff name;
- the SELECT and the GET run side by side.

3. EDIT src/pulse/coverage/modules.mjs
One literal line after gap-closer.mjs.

4. NEW scripts/closer-setup-ask.mjs and scripts/closer-setup-ask.test.mjs
- open wraps createTask from src/lib/create-task.mjs the way src/ops/csuite-tasks.mjs does:
  - an IS NOT DISTINCT FROM pre-check, orgId = the default org, clientId null;
  - title 'Waiting: <name> calendar on the booking page';
  - sourceWorkflow ASK_SOURCE (imported from the lane), assigneeRole 'owner';
  - body 'closer-calendar:<staff id>:<asked ISO>', dueAt = asked + GRACE_DAYS;
  - detail 'Asked by email on <date>. Needs: ClickFunnels invite, calendar connected, added as host on Funding Strategy Meeting.'
  - It does not override created_at.
- snooze runs UPDATE due_at on the one open row matched by the body prefix.
- close runs UPDATE done = true.
- It refuses an unknown or non-active staff id, and has --dry-run.

5. EDIT docs/journeys/heartbeat-flow.md
One row: a person's setup step is a reminder lane, not a tripwire, and a skip there lands in audit:not-checked.

6. EDIT docs/journeys/CHANGELOG.md
One line at the top.

7. BOARD
One card on the hourly-lanes board (ops/workflows/pulse-hourly-lanes-2026-10-09/): gap-closer-setup must be { hourly: false, web: true, reason: 'a person does not answer faster by the hour; the 6 a.m. run is enough' }. If src/pulse/lanes/manifest.mjs exists by build time, add that row there instead.

8. DATA
Run open twice, each with --asked-at:
- Justice 968bb01e-0079-4508-aded-8a361d54ecbb, 2026-10-07T17:41:33Z
- Sarah 6ccdca88-60af-4b7e-af15-28259ead4786, 2026-10-07T17:41:35Z
Both are due 3 days later. The first red is on the Oct 11 6 a.m. run.

9. Do not touch
The same list as the design (tripwires, baseline, registry, heartbeats, beats, na-conditions, daily-pulse, self-audit, morning-brief, gap-calls, gap-funnels, run-slices, rules). No TRIPWIRES entry, and no hourly beat.

Gates: npm run lint; npx tsc --noEmit; npm test; npm run pulse:prove (1 GET, 0 POST, 0 writes, lane under 20 s); npm run ship once; then read the next 6 a.m. pulse_scorecards row.

Corrected risks:
- A skip is not harmless. It shows inside the red audit:not-checked line, and if ClickFunnels changes its page code it stands there and hides other not-checked rows.
- The ask row shows on the owner task list and on the Sales Calendar on its due day. Any staff member can see it or mark it done.
- The other risks stay as written: no one is named for the ClickFunnels clicks; a name mismatch keeps the row red; the page may show old content for a while; future Gmail asks are invisible unless an agent runs the writer; calls:booked-no-join-link stays red.

needsFromChris (unchanged):
1. Who does the ClickFunnels clicks, or try the ClickFunnels agent door with one Approve click.
2. Should booked calls land on Sarah's calendar too? Her email says her calendar joins the booking page but not that calls land on it.
3. 3 days is the default. He can change it.

## Plain words for Chris

I found the email. You sent it Oct 7 at 10:41 a.m. It went to Justice and to Sarah. Neither one has written back. I checked Gmail today.

Our system did not know about it. You sent it from Gmail. Nothing in our system wrote it down. So the pulse had nothing to watch. That is the hole.

One hard fact first. ClickFunnels has no API door for this. It cannot send the team invite. It cannot hook up a calendar. It cannot add Justice as a host or set his hours. A person must click those in ClickFunnels. Your ClickFunnels team has 2 seats today. Neither one is Justice or Sarah. So the invite was not sent, or they have not taken it.

Here is the fix. We add two checks to the 6 a.m. pulse.

Check 1 watches the ask. We save one line for each person. It says who we asked, when, and the due day. While we wait, it stays green. It says "day 2 of 3." After the due day it turns red. The red says to send the invite, nudge them, give more days, or drop the ask. It goes green when the person shows up on the booking page. With 3 days, the first red comes in the Oct 11 morning text.

Check 2 reads the live booking page. Today the page lists one host: you. The place is Google Meet. ClickFunnels' own help page says a host can only be picked once a calendar is hooked up. So when Justice shows up there, his calendar is hooked up.

What the server cannot see:
- It cannot see a reply. This kind of check may only read web pages. When a reply comes, an agent gives more days.
- It cannot see which closer got a call once there are two hosts.
- It cannot see the Meet link.

If the page cannot be read, the check says "not checked." That shows up inside one red line called audit:not-checked. So it is never hidden.

The ask shows on your task list. It also shows on the Sales Calendar on its due day. Staff can see it.

We add no new texts. The 6 a.m. text already waits for your texting hours. This red sorts behind new breaks, so it cannot hide one. It will not text you every hour, even when the hourly checks come.

I need 2 answers from you:
1. Who does the ClickFunnels clicks? Or should we try the ClickFunnels agent door? That needs one Approve click from you.
2. Should calls land on Sarah's calendar too? Her email says her calendar joins the booking page. It does not say calls land on it.
