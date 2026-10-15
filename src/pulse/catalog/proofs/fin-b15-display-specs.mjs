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

export const FIN_B15_RUNNER_TEST = "src/pulse/catalog/proofs/fin-b15-display-specs.test.mjs";
export const FIN_B15_GATE_TEST = "src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs";

const MC = "marketing-command-center.html";
const FRAME = "e2e/marketing-command-center.spec.mjs";
const SCRIPTS = "e2e/marketing-cc-scripts.spec.mjs";
const NUMBERS = "e2e/cc-tab-numbers.spec.mjs";
const LAUNCH = "e2e/cc-tab-launch.spec.mjs";
const MINE = "e2e/fin-b15-cc-controls.spec.mjs";

const ENTRIES = [
  {
    surface: "lenders.html",
    control: "Page gate: owner, admin, funding_advisor only (read + write endpoints return 403 to every other role)",
    test: FIN_B15_GATE_TEST
  },
  {
    surface: MC,
    control: "Frame: 5-minute auto reload, reload on focus, footer 'as of' stamp",
    specs: [{ spec: FRAME, titles: [
      "the footer clock, the 5-minute reload, the reload on focus, and a failed reload that keeps the numbers",
      "the reload on focus: a focus after a minute away reads again, and a focus within half a minute reads nothing",
      "a read that never answers is given up on after 20 seconds, and the next 5-minute reload still runs"
    ] }]
  },
  {
    surface: MC,
    control: "Frame: gear button (opens Settings tab, Today comes back as it was)",
    specs: [{ spec: FRAME, titles: ["the frame: the gear opens Settings, Today comes back as it was, and Back works"] }]
  },
  {
    surface: MC,
    control: "Frame: tab strip (Today, Ideas, Scripts, Shoot, Launch, Numbers) with hash routing that keeps its place",
    specs: [{ spec: FRAME, titles: [
      "the frame: the strip shows only tabs that exist, in work order; Settings sits behind the gear, top-right",
      "the frame: a link to a tab with no module (#videos) lands on Today and the address says so",
      "the frame: a buzz link straight to #settings opens Settings, and the last tab is remembered"
    ] }]
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
      "Launch: while an ad is loading the state is read again every 20 seconds, with the approved list",
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
        "Numbers: a funnel whose spend, cash and ROAS are not saved prints unknown, never $0 or 0.00x"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: card Previous / Next buttons and swipe between drafts (never saves)",
    specs: [
      { spec: SCRIPTS, titles: ["a swipe moves between cards and never saves"] },
      { spec: MINE, titles: ["Scripts: Previous and Next move between the drafts and never save"] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: conflict banner: 'Use mine' / 'Use theirs' / 'Read the new version' (409 on a stale version)",
    specs: [
      { spec: SCRIPTS, titles: ["a stale Edit shows both texts; Use mine saves on the live version"] },
      { spec: MINE, titles: [
        "Scripts: after a stale Edit, Use theirs drops my words, reads the live version, and saves nothing more",
        "Scripts: after a stale Approve, Read the new version closes the banner, reads again, and approves nothing more"
      ] }
    ]
  },
  {
    surface: MC,
    control: "Scripts: filter chips: Drafts, Approved, Filmed, Rejected, All (with counts)",
    specs: [{ spec: MINE, titles: ["Scripts: the five filter chips carry their counts, and each one shows only its own scripts"] }]
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
  const runners = entry.test ? [entry.test] : [FIN_B15_RUNNER_TEST];
  return Object.freeze({
    sourceFile: "desks-c.json",
    surface: entry.surface,
    control: entry.control,
    depth: "e2e",
    evidence: [...runners, ...specFiles].join(" "),
    tests: Object.freeze(runners)
  });
}));
