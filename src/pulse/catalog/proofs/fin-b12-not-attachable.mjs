// The three batch 12 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. Two files hold each reason to the repo: fin-b12-rows.test.mjs reads the
// page source and fin-b12-held-reasons.test.mjs drives the real page. The moment a reason stops being true,
// they go red, and that is the signal that the row can now be attached for real.
//
// Generation 2 challenged all three and kept all three. Each reason is now stated exactly, with what the
// first generation missed (documents: Not generated is dead too; galaxy: blocked is never sent, agent size
// is a constant, and the same dice move the census and the worker panel).

export const FIN_B12_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    id: "catalog-display:desks-b.json:documents.html:Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired)",
    sourceFile: "desks-b.json",
    surface: "documents.html",
    control: "Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired)",
    why: "Four of the six options work (Not delivered, Bounced, Awaiting signature, Signature expired). Two can never list a saved document. "
      + "Generation failed: the loader sets the generated column from generated_at only, to \"generated\" or \"queued\", and the documents table has no "
      + "column that says a generation failed. Not generated: documents.generated_at is NOT NULL DEFAULT now() and no later migration relaxes it, so every "
      + "saved document is generated and \"queued\" never happens. Choosing either option always shows \"Nothing matches that filter.\" There is no saved "
      + "result for them to judge, and a test over made-up rows (generated_at null) would prove a state the database cannot hold.",
  }),
  Object.freeze({
    id: "catalog-display:desks-b.json:galaxy.html:Legend strip (size, brightness, pace colors)",
    sourceFile: "desks-b.json",
    surface: "galaxy.html",
    control: "Legend strip (size, brightness, pace colors)",
    why: "The strip says size is output today and brightness is working right now. After the feed loads, the page moves both on dice: evActivity adds 1 to 3 "
      + "to a worker's output on a timer (the worker panel's Total events then climbs past the saved Events today plus Calls today), and evActivity and "
      + "evHandoff flip an idle worker to active at random, and nothing flips it back because the feed's lines never begin with Idle. The census count of "
      + "people working reads the same dice. Two more gaps in the same strip: the feed never sends a blocked state, so the blocked swatch cannot light on live "
      + "data, and an agent's size is 3 or 1 by sort order, not output. The swatch colours do match the canvas palette. None of the drift is saved anywhere, "
      + "so no saved result can judge the legend.",
  }),
  Object.freeze({
    id: "catalog-display:desks-b.json:galaxy.html:Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads",
    sourceFile: "desks-b.json",
    surface: "galaxy.html",
    control: "Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads",
    why: "A rail pulse names only a stage and no client, as the row says. The hand-off threads are the other half of the row: the feed sends routes: [] "
      + "(src/galaxy/company-activity.mjs), so the page makes up routes between neighbours in the worker list and labels each with a client name picked at random "
      + "from the feed (fillC). The sky says worker A handed client X to worker B when nothing of the kind was saved. The row cannot be proved while a hand-off "
      + "carries an invented client, and there is no saved hand-off to read.",
  }),
]);
