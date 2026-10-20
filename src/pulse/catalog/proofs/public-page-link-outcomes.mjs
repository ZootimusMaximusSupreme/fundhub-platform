import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_PAGE_LINK_OUTCOME_TEST = "src/pulse/catalog/proofs/public-page-link-outcomes.test.mjs";
const PRIOR_PUBLIC_TEST = "src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs";
const PRIOR_PUBLIC_2_TEST = "src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_MAP = JSON.parse(fs.readFileSync(
  path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/public-pages.json"),
  "utf8",
));

const SPECS = [
  {
    id: "e02a2404a30fc5610afb",
    surface: "link:404.html -> /app/",
    sourcePath: "/404.html",
    label: "The CRM sign-in required",
    href: "/app/",
    destination: { kind: "page", path: "/login.html", search: "?next=/app/", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "aa163ac5ea8a062b9340",
    surface: "link:404.html -> /login.html",
    sourcePath: "/404.html",
    label: "Sign in staff and demo access",
    href: "/login.html",
    destination: { kind: "page", path: "/login.html", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "e9720def3de87ce88990",
    surface: "link:affiliates/index.html -> /login.html",
    sourcePath: "/affiliates/",
    label: "Log in",
    href: "/login.html",
    destination: { kind: "page", path: "/login.html", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "73bde33ad6b137fa3dca",
    surface: "link:affiliates/index.html -> /partner/menu/",
    sourcePath: "/affiliates/",
    label: "SEE EVERY WAY IN →",
    href: "/partner/menu/",
    destination: { kind: "page", path: "/partner/menu/", title: "Every Way to Work With FundHub", heading: "Four Ways In. You Can Start Anywhere." },
  },
  {
    id: "d6960aeba1adbc711ab7",
    surface: "link:affiliates/index.html -> /partner/",
    sourcePath: "/affiliates/",
    label: "See the white-label offer",
    href: "/partner/",
    destination: { kind: "page", path: "/partner/", title: "Partner With FundHub — Run a Funding Company Under Your Own Name", heading: "You Found the Client. You Should Keep the Client." },
  },
  {
    id: "7bf90626e053bd0c2d15",
    surface: "link:education/index.html -> /login.html",
    sourcePath: "/education/",
    label: "Log in",
    href: "/login.html",
    destination: { kind: "page", path: "/login.html", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "a03437e62a8c7683ee39",
    surface: "link:education/index.html -> /education/enroll/?program=credit-mastery",
    sourcePath: "/education/",
    label: "Enroll in Credit Mastery",
    href: "/education/enroll/?program=credit-mastery",
    destination: { kind: "page", path: "/education/enroll/", search: "?program=credit-mastery", title: "Enroll | Fundhub Education", heading: "Start your enrollment.", selector: "form#enroll-form", selectValue: "credit-mastery" },
  },
  {
    id: "ee2d2652971dbf64b17a",
    surface: "link:education/index.html -> /education/enroll/?program=capital-strategy",
    sourcePath: "/education/",
    label: "Enroll in Capital Strategy",
    href: "/education/enroll/?program=capital-strategy",
    destination: { kind: "page", path: "/education/enroll/", search: "?program=capital-strategy", title: "Enroll | Fundhub Education", heading: "Start your enrollment.", selector: "form#enroll-form", selectValue: "capital-strategy" },
  },
  {
    id: "b6d230597e460f3f6441",
    surface: "link:index.html -> /login.html",
    sourcePath: "/",
    label: "Log in",
    href: "/login.html",
    destination: { kind: "page", path: "/login.html", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "27eae87c629dcb08a487",
    surface: "link:optimize-plan.html -> https://apply.fundhub.ai/schedule/phonecall",
    sourcePath: "/optimize-plan.html",
    prepare: "build-plan",
    label: "Book my call",
    href: "https://apply.fundhub.ai/schedule/phonecall",
    destination: { kind: "external-request" },
  },
  {
    id: "bb52ed26b096a7862073",
    surface: "link:optimize.html -> https://smartcredit.com/cblp/?PID=29056",
    sourcePath: "/optimize.html",
    prepare: "smartcredit-consent",
    label: "Get My Credit Report",
    href: "https://smartcredit.com/cblp/?PID=29056",
    destination: { kind: "external-request" },
  },
  {
    id: "fd22dfe0aaad06bc2dd7",
    surface: "link:optimize.html -> https://apply.fundhub.ai/schedule/phonecall",
    sourcePath: "/optimize.html",
    label: "Or book a call first",
    href: "https://apply.fundhub.ai/schedule/phonecall",
    destination: { kind: "external-request" },
  },
  {
    id: "f7b6906f374944bd6948",
    surface: "link:partner/menu/index.html -> /partner/board/",
    sourcePath: "/partner/menu/",
    label: "See the Winner's Board →",
    href: "/partner/board/",
    destination: { kind: "page", path: "/partner/board/", title: "Winner's Board — See What's Actually Running in Funding", heading: "You Already Know Your Ads Stop Working. You Just Can't See What's Still Running." },
  },
  {
    id: "4bc6aa6b4e9d0507742f",
    surface: "link:partner/menu/index.html -> /partner/trial/",
    sourcePath: "/partner/menu/",
    label: "See the Live Trial →",
    href: "/partner/trial/",
    destination: { kind: "page", path: "/partner/trial/", title: "Live Trial — Seven Days With Your Name on It", heading: "You Want the Partnership. You Just Want to Feel the Work First." },
  },
  {
    id: "fbf4d929476ce49caee9",
    surface: "link:partner/menu/index.html -> /partner/",
    sourcePath: "/partner/menu/",
    label: "See the Partnership →",
    href: "/partner/",
    destination: { kind: "page", path: "/partner/", title: "Partner With FundHub — Run a Funding Company Under Your Own Name", heading: "You Found the Client. You Should Keep the Client." },
  },
  {
    id: "47caa3a9f6980a2d7a34",
    surface: "link:partner/trial/index.html -> /partner/",
    sourcePath: "/partner/trial/",
    label: "Skip This — Go Straight to the Partnership",
    href: "/partner/",
    destination: { kind: "page", path: "/partner/", title: "Partner With FundHub — Run a Funding Company Under Your Own Name", heading: "You Found the Client. You Should Keep the Client." },
  },
  {
    id: "fcd52ab239186412d528",
    surface: "link:reset-password.html -> /login.html",
    sourcePath: "/reset-password.html?token=one-shot-proof",
    prepare: "reset-success",
    label: "Sign in now →",
    href: "/login.html",
    destination: { kind: "page", path: "/login.html", title: "Sign in | fundhub", heading: "fundhub", selector: "form#f" },
  },
  {
    id: "148c20a684de4e3bc9ec",
    surface: "link:roadmap/index.html -> /roadmap/pay.html",
    sourcePath: "/roadmap/",
    label: "Show Me What I Qualify For —",
    href: "/roadmap/pay.html",
    destination: { kind: "page", path: "/roadmap/pay.html", title: "Checkout | Complete Funding Diagnostic | Fundhub", heading: "Your Complete Funding Diagnostic", selector: "form#pay" },
  },
  {
    id: "f111bbe076624d4b7dcd",
    surface: "button:unsubscribe.html#go",
    sourcePath: "/unsubscribe.html?org=org-proof&client=client-proof&channel=email&exp=1790000000&sig=signed-proof",
    action: "unsubscribe",
    destination: { kind: "saved-opt-out" },
  },
];

const PRIOR_PUBLIC_2_IDS = new Set([
  "27eae87c629dcb08a487",
  "bb52ed26b096a7862073",
  "fd22dfe0aaad06bc2dd7",
  "fcd52ab239186412d528",
  "f111bbe076624d4b7dcd",
]);

function exactCase(spec) {
  const matches = PUBLIC_MAP.filter((row) => row.surface === spec.surface);
  if (matches.length !== 1) {
    throw new Error(`Expected one public-page row for ${spec.surface}, found ${matches.length}`);
  }
  const mapped = matches[0];
  const priorTest = PRIOR_PUBLIC_2_IDS.has(spec.id) ? PRIOR_PUBLIC_2_TEST : PRIOR_PUBLIC_TEST;
  return Object.freeze({
    ...spec,
    sourceFile: "public-pages.json",
    control: mapped.control,
    key: `public-pages.json\0${mapped.surface}\0${mapped.control}`,
    depth: "deep",
    evidence: `${priorTest}; ${PUBLIC_PAGE_LINK_OUTCOME_TEST}`,
    tests: Object.freeze([priorTest, PUBLIC_PAGE_LINK_OUTCOME_TEST]),
  });
}

export const PUBLIC_PAGE_LINK_OUTCOME_CASES = Object.freeze(SPECS.map(exactCase));
export const PUBLIC_PAGE_LINK_OUTCOME_IDS = Object.freeze(PUBLIC_PAGE_LINK_OUTCOME_CASES.map((entry) => entry.id));
