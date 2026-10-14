# Broken-items walk-through — plan for 2026-10-14

Owner (Chris, 2026-10-13 night): "go through all the broken ones tomorrow and then go 1 by 1 and you ask questions."

## Before the walk-through (agent work, no Chris needed)

1. Wait for the five proof builders (`ops/workflows/not-proved-slices-2026-10-14/`) and their checkers. Merge them one at a time, run the full suite and `npm run pulse:prove` (and `-- --beats`), ship once.
2. Read the 6 a.m. scorecard (`pulse_scorecards`, newest row, read only). Build the list from rows with status `red` only. "Not proved yet" is NOT on this list.
3. Leave out what Chris already decided: Bram (FH-000507) is closed; the join link is Justice and Sarah's calendar setup; Twilio is Chris's credit; the five welcome templates stay pending (owner 2026-10-13).
4. Order: money, customer messages, customer data, staff only. Group rows with one shared cause (for example the same missing key) into one question.

## The walk-through (Chris and agent, one item at a time)

For each item the agent says, in 4th grade words:
- what it is, and what a customer or staff member would see if it stays broken;
- how long it has been red, and what the check actually read (the proof line);
- ONE question only Chris can answer: fix it / leave it / that is expected.

The agent then logs his answer on this board as `owner-set` (date, item id, answer) and moves on. No item comes back after it is answered. Items answered "fix it" go to a Codex-build, Claude-test batch. Items answered "that is expected" become a verified "nothing to judge" with a code, never a silent skip.

## Decision log (fill in during the walk-through)

| Item id | What it is | Chris's answer | Date |
|---|---|---|---|
