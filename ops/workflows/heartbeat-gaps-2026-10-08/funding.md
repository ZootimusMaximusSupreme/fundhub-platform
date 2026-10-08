# Funding desk gaps

Lane 11. Report only. Read only.

Recon (AG-07) on the morning pulse is the one tripwire. This file does not add a second watcher.

## What it looks at

1. A funding round that is still open after 72 hours.
2. The lender list is empty when the book file has banks to load.
3. The applications path is not wired, or a row has sat on Apply for 72 hours with no submit date.
4. A funding file has sat on the advisor queue for 72 hours with no next step.

## What it does not look at

Slice 14 already checks the funding job list. Slice 28 already checks the desk doors. Those checks stay there.

This file does not send a real lender application. It does not change a page.

## Check shape

Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| id | FAIL means |
|---|---|
| funding:round-stuck | An open round has not moved in 72 hours |
| funding:lender-book | The list has no banks and the book has rows |
| funding:submit-path | The applications route is missing, or Apply rows sat with no submit date |
| funding:advisor-queue | A funding file waited 72 hours with a blank next step |
| funding:recon | Recon (AG-07) is missing or not live on daily-pulse |

No database means skip. An empty lender list with an empty book is a skip. That is not a missed load.

## Prove

`node --test src/pulse/coverage/gap-funding.test.mjs`
