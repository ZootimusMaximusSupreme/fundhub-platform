// The batch 15 rows that cannot honestly be attached today, and exactly why.
// Each one is a finding, not a failure. fin-b15-not-attachable.test.mjs holds each reason to the
// repo: the moment the reason stops being true, that test goes red and says the row can now be
// attached.

export const FIN_B15_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "marketing-command-center.html",
    control: "Scripts: 'Try again' buttons on a failed part",
    why: "The row says every failed part has a Try again button that works. Three of the parts (the scripts list, "
      + "the ideas list and the batch history) do, and their spec cases pass. The other two do not: when the Rules "
      + "fold or the Every version fold fails to read, onToggle in public/app/marketing-cc-scripts.js starts the "
      + "read again on every repaint while the status is error, so the failed read repeats without end (1,059 reads "
      + "in 1.5 seconds, measured with a Rules read that answers 500) and the Try again button is repainted faster "
      + "than it can be pressed. A test that pressed it could not tell a working button from the timer. The page "
      + "has to stop restarting a read that already failed before this row can be proved."
  })
]);
