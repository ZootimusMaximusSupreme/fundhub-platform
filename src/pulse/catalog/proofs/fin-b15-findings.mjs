// A product fault found while proving batch 15, written down so the proof of the row it touches can
// never drift away from it. fin-b15-findings.test.mjs holds each fault to the repo: the moment the
// fault is fixed, that test goes red and says what to take back out of the specs.
//
// Nothing in the page is changed by this file. It is a record and a tripwire for the test code only.

export const FIN_B15_FINDINGS = Object.freeze([
  Object.freeze({
    surface: "marketing-command-center.html",
    control: "Scripts: 'Try again' buttons on a failed part",
    // The two spec tests that press Try again on the Rules fold and the Every version fold, with the page's
    // restart muted. They are the proof of the row, and they carry the mute because of this fault.
    mutedTests: Object.freeze([
      "Scripts: Try again on a failed Rules fold reads the rules once more and paints them (the page's restart on repaint muted)",
      "Scripts: Try again on a failed Every version fold reads the versions once more and paints them (the page's restart on repaint muted)"
    ]),
    // The test that is marked expected-to-fail and measures the fault on the shipped page, with nothing muted.
    findingTest: "FINDING: a failed Rules read waits for Try again and is not started again on every repaint",
    spec: "e2e/fin-b15-cc-controls.spec.mjs",
    what: "When the Rules fold or the Every version fold fails to read, onToggle in "
      + "public/app/marketing-cc-scripts.js starts the same read again on every repaint while the status is "
      + "error, so the failed read repeats without end (1,059 reads in 1.5 seconds, measured with a Rules read "
      + "that answers 500) and the Try again button is repainted faster than a person can press it. "
      + "The page heals by itself when the server answers, so a person is not stuck, but the server is hit "
      + "hundreds of times a second while it is down and the button is never a stable thing to press.",
    whenFixed: "Take muteRepaintRestarts out of the two Try again tests and the test.fail() marker off the "
      + "FINDING test in e2e/fin-b15-cc-controls.spec.mjs. The row stays attached."
  })
]);
