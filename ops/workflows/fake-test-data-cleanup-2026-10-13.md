# Fake test data cleanup — 2026-10-13

Owner order (Chris, 2026-10-13): "116. remove."

## What was true

The "116 fake clients" count was wrong. Of 116 clients created Oct 11 9:40 p.m. to Oct 12 11:12 a.m. Arizona:
- 79 were fake test clients (`example.com` emails, no payment, no message sent).
- 37 look like real people (real names, Gmail/Yahoo, 36 with phones), added within 5 minutes at 10:14 p.m. Oct 11, probably a contact import. One is staff (Sarah Blankstein). **Not touched.**

## What was done (one guarded transaction, committed)

- Removed 54 fake clients and everything tied to them (bank_inbox 1, messages 1, tasks 10, events 59, and the rows that cascade from clients: rounds, sales, cards, bookings, waypoints, and the rest).
- 25 fake clients have rows in tables that are locked against deletes on purpose (invoices, contracts, documents, entitlements, commission ledger, affiliate referrals). The locks were not bypassed. Those 25 are marked `is_demo = true`, the flag the app uses to keep fake records out of reports.
- Guards held: exactly 79 targets, 54 removed, 25 marked, the 37 real-looking clients unchanged.
- Full copy of every affected row, taken before the change: `credentials/backups/fake-test-clients-2026-10-13.json` (gitignored, 678 rows).

## Left

- 9 more `example.com` clients from earlier test runs (Sept 30 and Oct 7: FH-000523 to FH-000556) were outside this order and were not touched.
- Root cause: database tests were run against production. A guard in the test runner that refuses the live database is not built yet.
