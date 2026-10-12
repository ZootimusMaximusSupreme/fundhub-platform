import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function mapped(sourceFile, surface, control, recipe) {
  const rows = JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
  const matches = rows.filter((row) => row.surface === surface && row.control === control);
  if (matches.length !== 1) throw new Error(`expected one mapped row: ${sourceFile} / ${surface} / ${control}`);
  return Object.freeze({
    ...matches[0],
    sourceFile,
    surface,
    control,
    recipe,
    key: `${sourceFile}\0${surface}\0${control}`,
    depth: "e2e",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
  });
}

function group(sourceFile, surface, recipe, controls) {
  return controls.map((control) => mapped(sourceFile, surface, control, recipe));
}

const MY_NUMBERS = "public/app/my-numbers.html";
const TRAINING = "public/app/partner-training.html";
const TELEPROMPTER = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";

export const DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES = Object.freeze([
  ...group("desks-e.json", MY_NUMBERS, "my-numbers", [
    "Open the page (closer sees own numbers; owner, admin, sales_manager may pass ?staff_id=)",
    "Owed by you: unlogged calls and quiet deposits, each row a link to closer-dashboard.html?client_id=&task_id=",
    "On shift / Off shift chip and staff name chip in the header",
  ]),
  ...group("desks-e.json", TRAINING, "partner-training", [
    "Open the page (partner's own record; staff must pass ?partner_id=)",
    "Back to Home (header chip link to partner-galaxy.html)",
    "No write control exists on purpose (a partner cannot mark their own training)",
  ]),

  mapped("public-pages.json", "form:affiliates/index.html#pform", "Partner application form: name, email, phone, company, track, audience, SMS consent. Posts to /api/public/partner-apply, which makes an affiliate or partner application row and queues the partner welcome.", "partner-apply"),
  mapped("public-pages.json", "page:aniso-face/logo-6k/index.html", "Page /aniso-face/logo-6k/ (Fundhub ASCII): loads", "static-screen"),
  mapped("public-pages.json", "page:aniso-face/logo-6k/preview.html", "Page /aniso-face/logo-6k/preview.html (Fundhub ASCII 6K): loads", "static-screen"),
  mapped("public-pages.json", "form:careers.html#apply-form", "Job application form: role, name, email, phone, LinkedIn, how heard, website (a hidden trap field). Posts to /api/hiring/apply and starts the applicant follow-up cadence.", "careers"),
  mapped("public-pages.json", "button:careers.html#retry", "Try loading them again: reloads the open roles after a failed read of /api/hiring/apply.", "careers"),
  mapped("public-pages.json", "page:climate/404.html", "Page /climate/404.html (404: This page could not be found.FundHub Lending Climate Dashboard): loads (static export of the lending-climate dashboard; the controls are drawn by bundled scripts, listed below from docs/journeys/climate-lead-magnet-intended.md)", "static-screen"),
  mapped("public-pages.json", "page:climate/404/index.html", "Page /climate/404/ (404: This page could not be found.FundHub Lending Climate Dashboard): loads (static export of the lending-climate dashboard; the controls are drawn by bundled scripts, listed below from docs/journeys/climate-lead-magnet-intended.md)", "static-screen"),
  mapped("public-pages.json", "page:climate/lender-climate/index.html", "Page /climate/lender-climate/ (FundHub Lending Climate Dashboard): loads (static export of the lending-climate dashboard; the controls are drawn by bundled scripts, listed below from docs/journeys/climate-lead-magnet-intended.md)", "static-screen"),
  mapped("public-pages.json", "form:education/enroll/index.html#enroll-form", "Enrollment application: program, name, email, phone, SMS consent. Posts to /api/public/education-enroll, which saves an education_enrollments row. No card is taken.", "education-enroll"),
  mapped("public-pages.json", "form:login.html#f", "Staff and demo sign-in: email and password. Posts to /api/auth/login and sets the session cookie.", "login"),
  mapped("public-pages.json", "button:login.html#fh-forgot-go", "Send reset link: posts the typed email to /api/auth/reset for a reset mail (same answer for every address).", "login"),
  mapped("public-pages.json", "form:portal-login.html#f", "Client portal sign-in: email only. Posts to /api/auth/magic-link, which mails a 15 minute single-use link (always the same answer).", "portal-login"),
  mapped("public-pages.json", "form:reset-password.html#f", "Set a password from a reset or invite link: two password boxes. Posts to /api/auth/reset with the one-shot token from the address.", "reset-password"),
  mapped("public-pages.json", "link:reset-password.html -> /login.html", "Link 'Sign in now →' to /login.html", "reset-password"),
  mapped("public-pages.json", "form:optimize-plan.html#intake", "Roadmap intake: first name, last name, email, goal. Calls /api/public/optimize?view=roadmap to build the Audit roadmap on the page.", "optimize-plan"),
  mapped("public-pages.json", "link:optimize-plan.html -> https://apply.fundhub.ai/schedule/phonecall", "Link 'Book my call' to https://apply.fundhub.ai/schedule/phonecall", "public-link"),
  mapped("public-pages.json", "link:optimize.html -> https://smartcredit.com/cblp/?PID=29056", "Link 'Get My Credit Report' to https://smartcredit.com/cblp/?PID=29056", "public-link"),
  mapped("public-pages.json", "link:optimize.html -> https://apply.fundhub.ai/schedule/phonecall", "Link 'Or book a call first' to https://apply.fundhub.ai/schedule/phonecall", "public-link"),
  mapped("public-pages.json", "form:roadmap/pay.html#pay", "Roadmap checkout: first name, last name, email. Posts to /api/public/slo-checkout, which mints the Commas card page for the $297 diagnostic and redirects.", "roadmap-pay"),
  mapped("public-pages.json", "form:roadmap/pull.html#pull", "Pull form after paying: name, date of birth, SSN, address, soft-pull consent. Posts to /api/public/slo-pull, which stores identity against the paid file and emits diagnostic.paid.", "roadmap-pull"),
  mapped("public-pages.json", "button:unsubscribe.html#go", "Unsubscribe me: posts to /api/public/unsubscribe, which records the opt-out (a GET only reports state).", "unsubscribe"),

  ...group("desks-f.json", TELEPROMPTER, "teleprompter", [
    "Play / Pause button and the 3-2-1 countdown",
    "Speed minus and plus buttons (5 words a minute each), saved on the device",
    "'Remote' link (to teleprompter-remote.html with the same film key)",
  ]),
]);

export const DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_EF_PUBLIC_2_METADATA = Object.freeze({
  runner: "rendered Chromium with controlled local HTTP routes",
  sourceFiles: Object.freeze(["desks-e.json", "desks-f.json", "public-pages.json"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES.length,
});
