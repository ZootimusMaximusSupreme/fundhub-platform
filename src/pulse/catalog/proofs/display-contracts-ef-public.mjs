const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs";

function row(id, sourceFile, surface, control, recipe, details = {}) {
  const key = `${sourceFile}\0${surface}\0${control}`;
  return Object.freeze({
    id,
    key,
    sourceFile,
    surface,
    control,
    recipe,
    ...details,
    depth: "e2e",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
  });
}

const publicScreen = (id, surface, control, page, title, heading) => row(
  id,
  "public-pages.json",
  surface,
  control,
  "public-screen",
  { page, title, heading },
);

const publicLink = (id, surface, control, page, href, label) => row(
  id,
  "public-pages.json",
  surface,
  control,
  "public-link",
  { page, href, label },
);

export const DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES = Object.freeze([
  publicScreen("9f36642b4115151d9bf8", "page:404.html", "Page /404.html (Fundhub — Not found): loads", "/404.html", "Fundhub — Not found", "That page isn't here."),
  publicScreen("652e597d312c8a9829ab", "page:consulting/privacy/index.html", "Page /consulting/privacy/ (Privacy Policy | FH Consulting): loads", "/consulting/privacy/", "Privacy Policy | FH Consulting", "Privacy Policy"),
  publicScreen("338d4d265a27ab8c8f73", "page:consulting/refund/index.html", "Page /consulting/refund/ (Refund Policy | FH Consulting): loads", "/consulting/refund/", "Refund Policy | FH Consulting", "Refund Policy"),
  publicScreen("85843bd678b25fbcd755", "page:consulting/terms/index.html", "Page /consulting/terms/ (Terms of Service | FH Consulting): loads", "/consulting/terms/", "Terms of Service | FH Consulting", "Terms of Service"),
  publicScreen("64902778e5a01e4c9f55", "page:education/enroll/index.html", "Page /education/enroll/ (Enroll | Fundhub Education): loads", "/education/enroll/", "Enroll | Fundhub Education", "Start your enrollment."),
  publicScreen("69f4ed5c352a33d1cde6", "page:education/learn/index.html", "Page /education/learn/ (Course access | Fundhub Education): loads", "/education/learn/", "Course access | Fundhub Education", "The programs have not opened yet."),
  publicScreen("cc843e842df6cd5f8e28", "page:education/privacy/index.html", "Page /education/privacy/ (Privacy Policy | Fundhub Education): loads", "/education/privacy/", "Privacy Policy | Fundhub Education", "Privacy Policy"),
  publicScreen("f3a0322687f1404d02ec", "page:education/refund/index.html", "Page /education/refund/ (Refund Policy | Fundhub Education): loads", "/education/refund/", "Refund Policy | Fundhub Education", "Refund Policy"),
  publicScreen("517b016138109045c725", "page:education/terms/index.html", "Page /education/terms/ (Terms of Service | Fundhub Education): loads", "/education/terms/", "Terms of Service | Fundhub Education", "Terms of Service"),
  publicScreen("8427448958b47e409205", "page:optimize-plan.html", "Page /optimize-plan.html (Your roadmap | Fundhub Credit Solutions LLC): loads", "/optimize-plan.html", "Your roadmap | Fundhub Credit Solutions LLC", "Build Your Plan"),
  publicScreen("3eac01d6bf60178d0ea3", "page:optimize.html", "Page /optimize.html (Your credit report | Fundhub Credit Solutions LLC): loads", "/optimize.html", "Your credit report | Fundhub Credit Solutions LLC", "Get Your Own Credit Report"),
  publicScreen("dba3a2a0ded964d01892", "page:partner/board/index.html", "Page /partner/board/ (Winner's Board — See What's Actually Running in Funding): loads", "/partner/board/", "Winner's Board — See What's Actually Running in Funding", "You Already Know Your Ads Stop Working. You Just Can't See What's Still Running."),
  publicScreen("31eec245b48a20b4cc26", "page:partner/board/live/index.html", "Page /partner/board/live/ (Winner's Board — Live): loads", "/partner/board/live/", "Winner's Board — Live", "Winner's Board"),
  publicScreen("d5c2936e1d763646b0bb", "page:partner/menu/index.html", "Page /partner/menu/ (Every Way to Work With FundHub): loads", "/partner/menu/", "Every Way to Work With FundHub", "Four Ways In. You Can Start Anywhere."),
  publicScreen("062b440f7aecd3c74bc7", "page:partner/trial/index.html", "Page /partner/trial/ (Live Trial — Seven Days With Your Name on It): loads", "/partner/trial/", "Live Trial — Seven Days With Your Name on It", "You Want the Partnership. You Just Want to Feel the Work First."),
  publicScreen("e58dbb44704d96e35fea", "page:partner/trial/live/index.html", "Page /partner/trial/live/ (Your Live Trial): loads", "/partner/trial/live/", "Your Live Trial", "Your live trial"),

  publicLink("e02a2404a30fc5610afb", "link:404.html -> /app/", "Link 'The CRM sign-in required' to /app/", "/404.html", "/app/", "The CRM sign-in required"),
  publicLink("aa163ac5ea8a062b9340", "link:404.html -> /login.html", "Link 'Sign in staff and demo access' to /login.html", "/404.html", "/login.html", "Sign in staff and demo access"),
  publicLink("e9720def3de87ce88990", "link:affiliates/index.html -> /login.html", "Link 'Log in' to /login.html", "/affiliates/", "/login.html", "Log in"),
  publicLink("73bde33ad6b137fa3dca", "link:affiliates/index.html -> /partner/menu/", "Link 'SEE EVERY WAY IN →' to /partner/menu/", "/affiliates/", "/partner/menu/", "SEE EVERY WAY IN →"),
  publicLink("d6960aeba1adbc711ab7", "link:affiliates/index.html -> /partner/", "Link 'See the white-label offer' to /partner/", "/affiliates/", "/partner/", "See the white-label offer"),
  publicLink("7bf90626e053bd0c2d15", "link:education/index.html -> /login.html", "Link 'Log in' to /login.html", "/education/", "/login.html", "Log in"),
  publicLink("a03437e62a8c7683ee39", "link:education/index.html -> /education/enroll/?program=credit-mastery", "Link 'Enroll in Credit Mastery' to /education/enroll/?program=credit-mastery", "/education/", "/education/enroll/?program=credit-mastery", "Enroll in Credit Mastery"),
  publicLink("ee2d2652971dbf64b17a", "link:education/index.html -> /education/enroll/?program=capital-strategy", "Link 'Enroll in Capital Strategy' to /education/enroll/?program=capital-strategy", "/education/", "/education/enroll/?program=capital-strategy", "Enroll in Capital Strategy"),
  publicLink("b6d230597e460f3f6441", "link:index.html -> /login.html", "Link 'Log in' to /login.html", "/", "/login.html", "Log in"),
  publicLink("f7b6906f374944bd6948", "link:partner/menu/index.html -> /partner/board/", "Link 'See the Winner's Board →' to /partner/board/", "/partner/menu/", "/partner/board/", "See the Winner's Board →"),
  publicLink("4bc6aa6b4e9d0507742f", "link:partner/menu/index.html -> /partner/trial/", "Link 'See the Live Trial →' to /partner/trial/", "/partner/menu/", "/partner/trial/", "See the Live Trial →"),
  publicLink("fbf4d929476ce49caee9", "link:partner/menu/index.html -> /partner/", "Link 'See the Partnership →' to /partner/", "/partner/menu/", "/partner/", "See the Partnership →"),
  publicLink("47caa3a9f6980a2d7a34", "link:partner/trial/index.html -> /partner/", "Link 'Skip This — Go Straight to the Partnership' to /partner/", "/partner/trial/", "/partner/", "Skip This — Go Straight to the Partnership"),
  publicLink("148c20a684de4e3bc9ec", "link:roadmap/index.html -> /roadmap/pay.html", "Link 'Show Me What I Qualify For —' to /roadmap/pay.html", "/roadmap/", "/roadmap/pay.html", "Show Me What I Qualify For —"),

  row("6d5f45b6f0a492eee8bf", "desks-e.json", "public/app/morning-brief.html", "Open the brief from the link in Chris's text: ?date=YYYY-MM-DD&kind=morning|evening&k=<code> (no sign-in, code never stored)", "morning-open"),
  row("9e666541f9d2173f0479", "desks-e.json", "public/app/morning-brief.html", "Show all N red checks / Show only the first 5 (toggle button)", "morning-toggle"),

  row("941299e8010b7c318b5d", "desks-e.json", "public/app/payment-success.html", "Open the page after checkout (?ref=<payment reference>&client_id=<uuid>; no sign-in needed to load)", "payment-open"),
  row("95d8ec94f46ad1abc064", "desks-e.json", "public/app/payment-success.html", "The bounded check: up to 6 reads, 3 seconds apart, then stops; baseline = what was already open", "payment-bounded"),
  row("3e2c30161da56a2224ad", "desks-e.json", "public/app/payment-success.html", "State shown: Just opened on your account / Nothing new has opened yet / Nothing is open yet / cannot check (signed out) / cannot tell which account / could not reach your account", "payment-states"),
  row("93dee849efe359af0794", "desks-e.json", "public/app/payment-success.html", "The feed it reads: entitlements opened by a payment", "payment-feed"),
  row("b41c3a95fa2539c1ab66", "desks-e.json", "public/app/payment-success.html", "Check again (button after the 6 tries, starts one more round)", "payment-again"),
  row("01b73f7a357811d35e52", "desks-e.json", "public/app/payment-success.html", "Back to your portal (link, carries client_id)", "payment-back"),
  row("f4efe6831e1b8a95d6dc", "desks-e.json", "public/app/payment-success.html", "Payment reference line (shows ?ref= as text)", "payment-reference"),

  row("ff64d69f563ea9664848", "desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", "Page open: reads the shoot with the film key (?k=) and shows the first script not marked Got it", "remote-open"),
  row("1dbb64457a91746e89e4", "desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", "Play / Pause (moves the words on THIS phone only; the page says it cannot pause the iPad)", "remote-play"),
  row("6f0520bb9aff32abf277", "desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", "'Open the iPad page with the mirror on' link", "remote-link"),
  row("7f6b3f463fa413237194", "desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", "'Words' text box (typing resets the play clock; focus pauses it)", "remote-words"),
  row("20ef043b4d91b696dc20", "desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", "'Save words': posts the words as a new script version through the same edit route the iPad uses", "remote-save"),
]);

export const DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_METADATA = Object.freeze({
  runner: "rendered Chromium with controlled local HTTP routes",
  sourceFiles: Object.freeze(["desks-e.json", "desks-f.json", "public-pages.json"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES.length,
});
