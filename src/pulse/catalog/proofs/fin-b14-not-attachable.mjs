// The one batch 14 display row that cannot honestly be attached today, and exactly why.
// It is a finding, not a failure. fin-b14-rows.test.mjs holds the reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.

export const FIN_B14_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "journeys.html",
    control: "Page gate: owner and admin author journeys (PUT/ask/run answer 403 to others); no sidebar row exists (NAV_HIDDEN), reached only by URL or link",
    why: "The row says PUT, ask and run answer 403 to every role but owner and admin. That is true of GET/PUT /api/journeys and of "
      + "POST /api/journeys/ask (measured for all eight staff roles, fin-b14-journeys-handlers.test.mjs). It is not true of "
      + "POST /api/journeys/run: api/journeys/run.mjs gates on ROLE_SETS.FINANCE (owner, admin, sales_manager), so a sales "
      + "manager is let in. The words are not simply stale: the file header of run.mjs ('Owner/admin only, same gate as "
      + "/api/journeys'), the page's refusal text ('Only an owner or admin can run this') and docs/journeys/CHANGELOG.md "
      + "(2026-08-01, 'POST /api/journeys/run (owner/admin only)') all record owner and admin as the intent. The door "
      + "became wider by side effect: commit 8872266e3 wrote the run door on FINANCE when FINANCE was owner and admin, and in "
      + "the same commit FINANCE was widened to add sales_manager for commission visibility (the note on FINANCE names "
      + "invoices, staff records and payouts, not journeys). src/http/journeys-run-handler.test.mjs describes the wide set, "
      + "but it only describes what the code does. A proof of the row as written would claim something the product does "
      + "not do, and a test that pinned the wide set would turn the row green over a gate the repo's own record says is "
      + "wrong. Only the owner can pick: narrow the run door to owner and admin (then this row attaches), or say a sales "
      + "manager may run the test (then the row, the header and the toast change).",
  }),
]);
