// Finish-853 batch 15: the Lenders desk and Marketing Command Center rows that are proved by a
// PRACTICE TEST (a real page in Chromium, fake /api answers, one press, and a judgement of the exact
// request the page sends and the words it paints). A practice test reads no live data.
//
// Each entry names the row, and the spec tests (or the node test) that press it. The runner test
// next to this file (fin-b15-display-specs.test.mjs) runs the named spec tests and fails if one
// does not pass or if a named title did not run, so a renamed or removed test cannot leave a row
// quietly proved. Every one of these tests was broken on purpose in the page and went red; the
// breaks are listed in ops/workflows/finish-853-2026-10-14/manifest-b15.md.
//
// `tests` names only the node tests that run them; the spec files are named in `evidence` so the
// catalog counts them as executable targets.
//
// Some rows here ALSO own a live check (fin-b15-display-contracts.mjs): the live check reads what the
// control left in the saved data, and the practice test holds what the saved data cannot say (what the
// button sent, what the real job does with a refused answer, the numbers inside a saved file). Those rows
// are marked `alsoLive: true`. A row with only a practice test says so by having no contract there.

export const FIN_B15_RUNNER_TEST = "src/pulse/catalog/proofs/fin-b15-display-specs.test.mjs";
export const FIN_B15_GATE_TEST = "src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs";
export const FIN_B15_DISMISS_TEST = "src/pulse/catalog/proofs/fin-b15-lenders-dismiss.test.mjs";
export const FIN_B15_FUNNEL_BUILD_TEST = "src/pulse/catalog/proofs/fin-b15-funnel-build.test.mjs";
export const FIN_B15_SPEND_READ_TEST = "src/pulse/catalog/proofs/fin-b15-spend-read.test.mjs";
export const FIN_B15_RESEARCH_BRAIN_TEST = "src/pulse/catalog/proofs/fin-b15-research-brain.test.mjs";

const MC = "marketing-command-center.html";
const FRAME = "e2e/marketing-command-center.spec.mjs";
const SCRIPTS = "e2e/marketing-cc-scripts.spec.mjs";
const NUMBERS = "e2e/cc-tab-numbers.spec.mjs";
const LAUNCH = "e2e/cc-tab-launch.spec.mjs";
const MINE = "e2e/fin-b15-cc-controls.spec.mjs";
const FRAME_MINE = "e2e/fin-b15-cc-frame.spec.mjs";
const DISMISS_SPEC = "e2e/fin-b15-lenders-dismiss.spec.mjs";
const SETTINGS_FUNNEL = "e2e/fin-b15-cc-settings-funnel.spec.mjs";
const SETTINGS = "e2e/marketing-cc-settings.spec.mjs";

const ENTRIES = [
  {
    surface: "lenders.html",
    control: "Page gate: owner, admin, funding_advisor only (read + write endpoints return 403 to every other role)",
    test: FIN_B15_GATE_TEST
  },
  {
    surface: MC,
    control: "Frame: 5-minute auto reload, reload on focus, footer 'as of' stamp",
    // The first three press Today's own timers (the footer stamp is Today's). The frame's OWN reload, the
    // only one Ideas, Scripts, Shoot, Launch and Numbers have, is pressed on a tab that registers refresh().
    specs: [
      { spec: FRAME, titles: [
        "the footer clock, the 5-minute reload, the reload on focus, and a failed reload that keeps the numbers",
        "the reload on focus: a focus after a minute away reads again, and a focus within half a minute reads nothing",
        "a read that never answers is given up on after 20 seconds, and the next 5-minute reload still runs"
      ] },
      { spec: FRAME_MINE, titles: [
        "the frame's own reload: a tab with refresh() is read again at 5 minutes, on focus after a minute away, on coming back into view, and never while the page is hidden"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Frame: gear button (opens Settings tab, Today comes back as it was)",
    specs: [{ spec: FRAME, titles: ["the frame: the gear opens Settings, Today comes back as it was, and Back works"] }]
  },
  {
    surface: MC,
    control: "Frame: tab strip (Today, Ideas, Scripts, Shoot, Launch, Numbers) with hash routing that keeps its place",
    specs: [
      { spec: FRAME, titles: [
        "the frame: the strip shows only tabs that exist, in work order; Settings sits behind the gear, top-right",
        "the frame: a link to a tab with no module (#videos) lands on Today and the address says so",
        "the frame: a buzz link straight to #settings opens Settings, and the last tab is remembered"
      ] },
      { spec: FRAME_MINE, titles: [
        "the frame strip: every tab link goes to its own address, and the gear goes to Settings",
        "the frame strip: the last tab is remembered whichever tab it was, and a view inside a tab (#probe/ads) keeps its place"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Ideas funnels: 'See the pages' / 'Hide the pages' + preview role buttons (sandboxed page preview)",
    specs: [{ spec: MINE, titles: ["Ideas: See the pages opens a sandboxed preview, the three page buttons switch it, Hide the pages closes it, and nothing is sent"] }]
  },
  {
    surface: MC,
    control: "Ideas: 'Go to step N' jump button",
    specs: [{ spec: MINE, titles: ["Ideas: after a spend read, Go to step N jumps to that step's own run button and sends nothing"] }]
  },
  {
    surface: MC,
    control: "Launch: links: 'Open Settings', 'Open Videos', 'Open Campaigns to pause a campaign or change its budget'",
    specs: [
      { spec: MINE, titles: ["Launch: Open Settings on an ad with no ad set goes to Settings and sends nothing"] },
      { spec: LAUNCH, titles: [
        "empty: says what will show and where to go",
        "full at 390px: count top-left, one filled button, every ad with its state",
        "full at 1280px: count top-left, one filled button, every ad with its state"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Launch: load-state poll every 20 s (uploading, waiting for Meta, making the ad, saving) + ad-video list",
    specs: [{ spec: MINE, titles: [
      "Launch: with an ad being loaded the state is read again at 20 seconds to the millisecond, with the approved list",
      "Launch: with an ad waiting in line to load the state is read again at 20 seconds to the millisecond, with the approved list",
      "Launch: each of the four load steps is painted in its own words, and an unknown step still says it is loading",
      "Launch: when nothing is loading the state is not polled at all"
    ] }]
  },
  {
    surface: MC,
    control: "Numbers: Ads table: 'Ad N' row button opens the drawer (watch curve, day select, 'What to film next', Close)",
    specs: [
      { spec: NUMBERS, titles: [
        "Drawer: the watch curve is drawn by hand, the diagnosis is in words, and it closes",
        "Drawer: a day with no curve, and an ad with no curve at all, say so"
      ] },
      { spec: MINE, titles: ["Numbers: the ad drawer's Day select switches the watch curve to the day picked, and sends nothing"] }
    ]
  },
  {
    surface: MC,
    control: "Numbers: Funnels view: page views, click to page, page to lead, lead to call, call to sale, spend, ROAS per funnel; 'Open Settings' when none",
    specs: [
      { spec: NUMBERS, titles: [
        "Funnels: page views, click to page, page to lead, lead to call, call to sale, spend and ROAS",
        "Funnels: unknown spend is unknown, not $0",
        "Empty angles and an empty funnel list each say what will show"
      ] },
      { spec: MINE, titles: [
        "Numbers: with no funnel set up the Funnels view says so and Open Settings goes to Settings > funnels",
        "Numbers: a funnel whose spend, cash and ROAS are not saved prints unknown, never $0 or 0.00x",
        "Numbers: every step of a funnel that has no saved number prints unknown, a real zero prints 0, and Showed is the showed count"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: card Previous / Next buttons and swipe between drafts (never saves)",
    specs: [
      { spec: SCRIPTS, titles: ["a swipe moves between cards and never saves"] },
      { spec: MINE, titles: ["Scripts: Previous and Next move one draft at a time over three drafts, stop at the ends, and never save"] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: conflict banner: 'Use mine' / 'Use theirs' / 'Read the new version' (409 on a stale version)",
    specs: [
      { spec: SCRIPTS, titles: ["a stale Edit shows both texts; Use mine saves on the live version"] },
      { spec: MINE, titles: [
        "Scripts: after a stale Edit, Use mine saves MY words on the live version, and never the saved ones",
        "Scripts: after a stale Edit, Use theirs drops my words, reads the live version, and saves nothing more",
        "Scripts: after a stale Approve, Read the new version closes the banner, reads again, and approves nothing more",
        "Scripts: a stale Fix puts up the banner with the saved version, and Read the new version sends nothing more",
        "Scripts: a stale Reject puts up the banner with the saved version, and Read the new version sends nothing more"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: 'Try again' buttons on a failed part",
    // Five parts have a Try again, all pressed on the page as shipped. The Rules fold and the Every version
    // fold used to restart a failed read on every repaint (product finding 1 in manifest-b15.md, fixed
    // 2026-10-20); fin-b15-findings.test.mjs keeps that fix from coming back.
    specs: [
      { spec: SCRIPTS, titles: [
        "Try again on the failed scripts list reads it again and paints it",
        "Try again on the failed ideas list reads it again and paints it",
        "Try again on the failed batch history reads it again and paints it"
      ] },
      { spec: MINE, titles: [
        "Scripts: Try again on a failed Rules fold reads the rules once more and paints them",
        "Scripts: Try again on a failed Every version fold reads the versions once more and paints them"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: filter chips: Drafts, Approved, Filmed, Rejected, All (with counts)",
    specs: [{ spec: MINE, titles: ["Scripts: the five filter chips carry their counts, and each one shows only its own scripts"] }]
  },

  // ── repair cycle 1 ─────────────────────────────────────────────────────────
  {
    // No live check: the saved row records no reviewer and no time, so a query can only judge how the
    // observation was LOGGED. The button itself is judged here, in the handler and on the page.
    surface: "lenders.html",
    control: "Mismatch queue row: Dismiss button",
    tests: [FIN_B15_DISMISS_TEST],
    specs: [{ spec: DISMISS_SPEC, titles: [
      "Dismiss sends that row's id and the word dismissed, the row leaves the queue, and the others stay",
      "Confirm and Corrected each send their own word, so Dismiss cannot be sending one of theirs",
      "a Dismiss the server refuses keeps the row in the queue and says so, and nothing else is sent"
    ] }]
  },
  {
    surface: MC,
    control: "Numbers: Angles cards: 'Make more of this' -> idea box (text + Save idea / Cancel)",
    alsoLive: true,
    specs: [
      { spec: NUMBERS, titles: [
        "Angles: the cards, and Make more of this saves an idea and says so",
        "Angles: a failed save keeps the words and sends the same request_id again"
      ] },
      { spec: MINE, titles: ["Numbers: an angle's idea box opens with its words, Cancel closes it and saves nothing, and the next open starts fresh"] }
    ]
  },
  {
    surface: MC,
    control: "Ideas flywheel step 6 (spend): run button 'Read the spend (free, no model)', Read it, Approve, Tweak, Resume / Start over / Retry",
    alsoLive: true,
    test: FIN_B15_SPEND_READ_TEST
  },
  {
    surface: MC,
    control: "Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check)",
    alsoLive: true,
    test: FIN_B15_FUNNEL_BUILD_TEST
  },
  {
    surface: MC,
    control: "Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo, unknown), ad button select, weight, Running checkbox, 'books a call' checkbox, mix of 6 script kinds",
    alsoLive: true,
    specs: [
      { spec: SETTINGS_FUNNEL, titles: [
        "funnel card: every box sends exactly what was typed or picked, and only what changed",
        "funnel card: each box alone sends only its own field, with the right word for it",
        "funnel card: a box that is not allowed is named in words, the old value stays, and nothing is sent"
      ] },
      { spec: SETTINGS, titles: [
        "funnels: link a campaign, pick its ad set, Save sends that funnel's change only",
        "funnels: unticking a campaign clears its ad set; a funnel's other boxes save in words",
        "funnels: a campaign already on another funnel is disabled with the reason",
        "funnels: a refused save says which funnel and why, in words; the rest still saves"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain', Retry",
    alsoLive: true,
    test: FIN_B15_RESEARCH_BRAIN_TEST
  }
];

/** The spec titles the runner must see pass, grouped by spec file. */
export const FIN_B15_SPEC_TITLES = (() => {
  const by = new Map();
  for (const entry of ENTRIES) {
    for (const { spec, titles } of entry.specs || []) {
      if (!by.has(spec)) by.set(spec, new Set());
      for (const t of titles) by.get(spec).add(t);
    }
  }
  return by;
})();

export const FIN_B15_DISPLAY_ENTRIES = Object.freeze(ENTRIES.map((e) => Object.freeze(e)));

export const FIN_B15_DISPLAY_PROOF_CASES = Object.freeze(ENTRIES.map((entry) => {
  const specFiles = [...new Set((entry.specs || []).map((s) => s.spec))];
  // The node tests that run this row: its own (test or tests), plus the spec runner when it names specs.
  const runners = [...(entry.tests || (entry.test ? [entry.test] : []))];
  if (specFiles.length && !runners.includes(FIN_B15_RUNNER_TEST)) runners.push(FIN_B15_RUNNER_TEST);
  return Object.freeze({
    sourceFile: "desks-c.json",
    surface: entry.surface,
    control: entry.control,
    depth: "e2e",
    evidence: [...runners, ...specFiles].join(" "),
    tests: Object.freeze(runners)
  });
}));
