# Scripts for `../delete-fake-data-2026-10-20.md`

Run from this folder with Node. They connect as `fundhub_app` using `DATABASE_URL` from the main checkout's gitignored `.env`.

- `plan.cjs`: read only. It builds `plan-final.json`, which lists every row id to delete, in delete order.
- `exec.cjs`: one transaction. The default is a dry run that rolls back. `--commit` keeps the change. It recounts against the plan, takes the backup, deletes, checks, and rolls back on any mismatch.
- `verify.cjs`: read-only read-back.
- `lib.cjs`: the shared foreign-key walk. `FAKE_SQL` decides who counts as fake.

`plan-final.json` holds row ids only, no names or emails. It is the plan that was committed on 2026-10-20.
