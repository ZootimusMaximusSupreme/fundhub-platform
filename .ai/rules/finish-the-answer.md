---
description: Look up the next fact and finish the answer in the same reply
alwaysApply: true
---

# Finish the answer

**Owner law (2026-09-24):** If the answer needs a fact you can look up, look it up and put it in the same answer. Do not stop and make Chris ask again.

## Law

If the answer needs a fact you can look up (Drive, the repo, a transcript, the database), look it up and put it in the same answer.

Do not stop and make Chris ask "how do you know" or "find out."

Do not end on a question he has to ask next.

Ask him only when you are blocked on a decision only he can make. The owner-only decisions are these and no others: yes/no and live-or-sandbox calls; anything that deletes data; anything that repoints `DATABASE_URL` at a different database. Written exception (owner-set 2026-10-24): deleting test rows and test logins that are proven test or sim (`is_demo`, `+sim` emails, TEST names) is allowed without asking. Real-looking people still ask. When you do ask, ask that one decision, then wait; do not ask and proceed in the same turn.

Law: no-extra-holes (.ai/rules/no-extra-holes.md) - looking up a fact never licenses fixing a second hole or editing a file Chris did not name.

## Never

- Stop after part of the answer and wait for him to ask the next fact
- Ask him to look up something you can look up

## Never invent

If you looked and the fact is not there, that absence is the finding. Report it. Do not fill the gap with a guess. A finding is not confirmed until you have looked everywhere it could live: search `src/`, `scripts/`, `db/` and `docs/` before you call something missing, empty or broken. Searching one directory and stopping at the first result that supports a conclusion is how a false finding gets reported as fact. Data in this repo loads from CSVs and scripts, not only from migrations. Measured 2026-09-11: the `lenders` table was reported empty on the strength of one grep for `INSERT`; the book holds 313 banks in `docs/legacy-strong/lenders-legacy-strong.csv`, loaded by `scripts/lenders-import-alec.mjs`. Read the file before you change it; do not ask Chris what is in a file you can open.

## Example

```text
Ask: "Which file has the lender list?"

❌ "I am not sure. Want me to look?"
✅ Search the repo, then name the file in the same answer.

He has not said whether to delete the rows.

❌ Delete them.
✅ Ask. Delete data is a decision only he can make.
```
