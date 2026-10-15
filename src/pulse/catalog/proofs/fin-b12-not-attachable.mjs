// The three batch 12 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b12-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.

export const FIN_B12_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    id: "catalog-display:desks-b.json:documents.html:Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired)",
    sourceFile: "desks-b.json",
    surface: "documents.html",
    control: "Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired)",
    why: "The select offers Generation failed, but the page can never put a document there: the loader maps generated_at to "
      + "\"generated\" or \"queued\" and nothing else, and the documents table has no column that says a generation failed. "
      + "Choosing that option always shows an empty list, so the row's claim cannot be proved, and no saved result exists to judge it.",
  }),
  Object.freeze({
    id: "catalog-display:desks-b.json:galaxy.html:Legend strip (size, brightness, pace colors)",
    sourceFile: "desks-b.json",
    surface: "galaxy.html",
    control: "Legend strip (size, brightness, pace colors)",
    why: "The legend says size is output today and brightness is working right now, but the live sky moves both on dice: "
      + "evActivity adds 1 to 3 to a worker's output every time it fires, and evActivity and evHandoff flip idle workers to active at random. "
      + "So what the sky draws is not the day's real numbers, and the legend cannot be proved true. The swatch colours do match the canvas palette.",
  }),
  Object.freeze({
    id: "catalog-display:desks-b.json:galaxy.html:Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads",
    sourceFile: "desks-b.json",
    surface: "galaxy.html",
    control: "Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads",
    why: "A rail pulse names only a stage and no client, as the row says. But a hand-off thread is labelled with a real client name picked at random "
      + "from the feed (fillC picks any client, and the route is just two neighbours in the worker list), so the sky says a worker handed that "
      + "client to another worker when nothing of the kind happened. The row cannot be proved while a hand-off carries an invented client.",
  }),
]);
