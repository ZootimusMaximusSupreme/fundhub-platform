// The batch 14 display rows that cannot honestly be attached today, and exactly why.
// Each one is a finding, not a failure. Four rows, in two kinds:
//
//   a row whose own words name something the product does not do (the Page gate row), and
//   three rows whose control gives a wrong result today, on the page as it is shipped. A test that passed
//   them would have to pass the wrong result, and a test that asked for the right result would be red.
//
// fin-b14-rows.test.mjs holds every reason to the repo: it reads the source line each reason rests on, and the
// moment that line changes it goes red and says the row can now be attached. For the three wrong results, a test
// named KNOWN BREAK in fin-b14-journeys.test.mjs pins what the page does today
// (it runs in a real browser with fake answers), so a fixed page also turns that test red. The rest of each
// control is exercised in the same files and passes; only the wrong result keeps the row out.

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
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "journeys.html",
    control: "Bottom bar: Discard (revert unsaved edits)",
    why: "Discard returns the open journey to its saved steps, and that part works for every journey (fin-b14-journeys.test.mjs, "
      + "'Discard puts the journey back to the saved one': the saved steps, the changed mark, History, Undo, Setter's own saved "
      + "steps, and the applied copy after an Apply). The wrong result is in the count. public/app/journeys.html keeps ONE unsaved "
      + "counter for the whole page, and the Discard handler sets it to zero (`dirty=0;delete touched[active]`) whatever the other "
      + "journeys hold. Measured in a real browser run (fin-b14-journeys.test.mjs, 'KNOWN BREAK ... Discard'): delete a step on "
      + "Client, change a step on Setter, press Discard on Setter. The header then says nothing is unsaved, the bottom bar is gone, "
      + "Apply answers 'Nothing to apply' and sends no request, while Client's deleted step is still deleted and cannot be saved "
      + "until some other change counts again. The same zero is reached by Undo after a Discard. A test that passed this row "
      + "would pass a Discard that strands another journey's changes. The fix is a per-journey count (or a count worked out "
      + "from what is touched); then this row attaches with the tests that are already there.",
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "journeys.html",
    control: "Step panel: 'Make the change' (AI rewrites one step) and canvas ask box 'Make the change' + example prompts",
    why: "The engine that applies an AI answer is exercised end to end and passes (fin-b14-journeys.test.mjs): the words and the whole "
      + "journey it is shown, a step added at the top, in a path, and after a step, a partial rewrite that keeps the other "
      + "settings, defaults on an added step, a removal that comes back on Throw it away, the Claude line in History, the busy "
      + "guard, the no-key worked example and the door's own gate and answers (fin-b14-journeys-handlers.test.mjs). The wrong "
      + "result is an answer that only removes steps, which the page's own system prompt documents as a normal answer "
      + "({\"op\":\"delete\"}). stagePatch applies the delete to the draft, finds nothing added or changed, pops the undo copy "
      + "and says 'That came back empty. Try saying it a different way.' (`if(!added.length&&!changed.length){undoStack.pop();"
      + "askErr=...}`). Measured in a real browser run ('KNOWN BREAK ... Make the change'): the step is gone from the canvas, "
      + "there is no Keep it / Throw it away bar, no unsaved count and no undo, and the words say the answer was empty. "
      + "Fix: count a removal as a change that waits on the bar. Then this row attaches.",
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "journeys.html",
    control: "Step panel: 'Run from here' (plays the journey in the browser from this step)",
    why: "From a step at the top of the journey it plays from that step and passes (fin-b14-journeys.test.mjs, 'Run from here plays "
      + "the journey from the picked step'). From a step inside a path the simulator is not taking it plays the whole journey from "
      + "the top. startSim builds the plan for the chosen path only, cuts it at the picked step with `findIndex(...)` and "
      + "`if(at>0) steps=steps.slice(at)`; a step on the other path is not in the plan, findIndex answers -1, nothing is cut, "
      + "and the run starts at the first step. Measured in a real browser run ('KNOWN BREAK ... Run from here'): Run from "
      + "here on 'Email a nudge' (the No path, first-path setting) plays the survey text first and fires all five steps. The "
      + "row says it plays from this step. Fix: start from the step's own path (or say it is not on a path that runs). "
      + "Then this row attaches.",
  }),
]);
