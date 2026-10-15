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
      + "manager is let in, and src/http/journeys-run-handler.test.mjs names that set on purpose. The page's own refusal text "
      + "('Only an owner or admin can run this') and the row words both say owner and admin only. A proof of the row as "
      + "written would have to claim something the product does not do, so it is not attached.",
  }),
]);
