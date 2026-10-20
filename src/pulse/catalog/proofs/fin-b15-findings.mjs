// A product fault found while proving batch 15, written down so the proof of the row it touches can
// never drift away from it. Fixed 2026-10-20; fin-b15-findings.test.mjs now holds the fix to the repo,
// so the fault cannot come back without a red test.
//
// Nothing in the page is changed by this file. It is a record and a tripwire for the test code only.

export const FIN_B15_FINDINGS = Object.freeze([
  Object.freeze({
    surface: "marketing-command-center.html",
    control: "Scripts: 'Try again' buttons on a failed part",
    fixed: "2026-10-20",
    // The two spec tests that press Try again on the Rules fold and the Every version fold. They are the
    // proof of the row. They used to mute the page's restart because of this fault; they no longer do.
    retryTests: Object.freeze([
      "Scripts: Try again on a failed Rules fold reads the rules once more and paints them",
      "Scripts: Try again on a failed Every version fold reads the versions once more and paints them"
    ]),
    // The test that measures the fault on the page with nothing muted. It used to be expected-to-fail;
    // now it must pass.
    findingTest: "a failed Rules read waits for Try again and is not started again on every repaint",
    spec: "e2e/fin-b15-cc-controls.spec.mjs",
    what: "When the Rules fold or the Every version fold failed to read, onToggle in "
      + "public/app/marketing-cc-scripts.js started the same read again on every repaint while the status was "
      + "error, so the failed read repeated without end (1,059 reads in 1.5 seconds, measured with a Rules read "
      + "that answers 500; 1,408 measured again on 2026-10-20) and the Try again button was repainted faster "
      + "than a person could press it. The server was hit hundreds of times a second while it was down.",
    fix: "onToggle retries a failed read only when the fold is really opened (it was closed before this "
      + "toggle), never on the toggle a repaint fires for a fold that is already open."
  })
]);
