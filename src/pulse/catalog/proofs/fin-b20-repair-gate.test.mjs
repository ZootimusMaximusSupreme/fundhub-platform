// Finish-853 batch 20, repair cycle 1: the staff shell's role gate, held for every screen and every role.
//
//   1. The whole table. allowedFor() is lifted out of the real public/app/shell.js (the lines from `var ALL`
//      to just before homeFor, which are pure: lists and one function) and run for every role and every
//      screen. The expected table below is written by hand from who each screen's data is for; it is not
//      derived from the shell's lists, so loosening or narrowing who may open a screen turns it red.
//   2. Real Chromium cases for the screens the first cycle never opened: Hiring, Staff & Teams, Social
//      Studio, the owner-and-admin desks, and the Consent desk for each role that uses it.
//   3. The bounce that happens before the session answers (the remembered role, pass 1).
//
// Nothing is saved anywhere real.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, makePage } from "./fin-b20-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHELL = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");

// ---------------------------------------------------------------------------------------------
// 1. The table
function liftGate() {
  const from = SHELL.indexOf("  var ALL = [");
  const to = SHELL.indexOf("  function homeFor(role, ok)");
  assert.ok(from > 0 && to > from, "shell.js still holds its screen lists and allowedFor() in one stretch");
  const code = SHELL.slice(from, to);
  return new Function(`${code}\n return { ALL: ALL, allowedFor: allowedFor, roles: Object.keys(ROLE_TABS) };`)();
}

const STAFF = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist"];
const OWNER_ADMIN = ["owner", "admin"];
const BANK_ROLES = [...OWNER_ADMIN, "sales_manager", "outbound_rep"];
// Screens that only some roles open. Everything in ALL that is not here is the shared staff surface.
const NARROW = {
  "bank-outreach.html": BANK_ROLES,                                     // assigned banks, never client files
  "setter-dashboard.html": OWNER_ADMIN.concat("setter"),                // human setter queue and handoff
  "hiring.html": OWNER_ADMIN,                                            // applicant personal data
  "staff-teams.html": [...OWNER_ADMIN, "sales_manager"],                 // staff and pay reads: finance roles
  "products-commissions.html": [...OWNER_ADMIN, "sales_manager"],
  "social-studio.html": [...OWNER_ADMIN, "partner"],
  "creative-factory.html": [...OWNER_ADMIN, "partner"],
  "campaign-manager.html": OWNER_ADMIN,
  "marketing-command-center.html": OWNER_ADMIN,
  "journeys.html": OWNER_ADMIN,
  "contracts.html": OWNER_ADMIN,
  "galaxy.html": OWNER_ADMIN,
  "finance-os.html": OWNER_ADMIN,
  "company-brain.html": STAFF,             // approved staff source search; owner-tier stays server-restricted
  "agent-editor.html": OWNER_ADMIN,
  "ops-admin.html": OWNER_ADMIN,
  "content-admin.html": OWNER_ADMIN,
  "lenders.html": [...OWNER_ADMIN, "funding_advisor"],
  "consent-capture.html": [...OWNER_ADMIN, "closer", "funding_advisor", "csm"],
  "sales-floor.html": [...OWNER_ADMIN, "sales_manager"],
  "my-numbers.html": [...OWNER_ADMIN, "closer"],
  "brand-studio.html": [...OWNER_ADMIN, "partner"],
  "partner-training.html": [...OWNER_ADMIN, "partner"],
  "partner-galaxy.html": ["owner", "partner"],
  "client-portal.html": ["owner", "client"],
  "affiliate.html": ["owner", "client", "affiliate"],
};

test("the gate table: every role opens exactly the screens it is meant to and no others", () => {
  const { ALL, allowedFor, roles } = liftGate();
  for (const screen of Object.keys(NARROW)) assert.ok(ALL.includes(screen), `${screen} is a screen the shell knows`);
  assert.deepEqual([...roles].sort(), [...STAFF, "outbound_rep", "client", "affiliate", "partner"].sort(), "the roles the shell knows");
  assert.deepEqual(allowedFor(""), [], "no role, no screens");

  const wrong = [];
  for (const role of [...roles, "wizard"]) {                                 // an unknown role is staff spelled oddly
    const asStaff = STAFF.includes(role) || role === "wizard";
    const allowed = new Set(allowedFor(role));
    for (const screen of ALL) {
      const expected = NARROW[screen] ? NARROW[screen].includes(role) : asStaff;
      // an unknown role gets the shared surface only, never a narrow screen
      const want = role === "wizard" ? !NARROW[screen] : expected;
      if (allowed.has(screen) !== want) wrong.push(`${role} ${want ? "must open" : "must not open"} ${screen}`);
    }
  }
  assert.deepEqual(wrong, []);
  // a role is sent somewhere it can stay: every role opens at least one screen in the list
  for (const role of roles) assert.ok(allowedFor(role).length > 0, `${role} has a home`);
});

// ---------------------------------------------------------------------------------------------
// 2. Chromium: the screens the table says, opened for real
let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

const HOME = {
  owner: "pipeline.html", admin: "pipeline.html", sales_manager: "sales-floor.html", closer: "closer-dashboard.html",
  funding_advisor: "client-control-panel.html", csm: "csm-queue.html", setter: "setter-dashboard.html", inquiry_specialist: "inquiry-remover.html",
  outbound_rep: "bank-outreach.html",
  partner: "partner-galaxy.html", client: "client-portal.html", affiliate: "affiliate.html",
};

async function visit(role, file) {
  const page = await makePage(lab, { role });
  await page.goto(`${lab.origin}/app/${file}`, { waitUntil: "domcontentloaded" });
  const home = HOME[role];
  const allowed = NARROW[file] ? NARROW[file].includes(role) : STAFF.includes(role);
  if (allowed) {
    await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
    assert.equal(new URL(page.url()).pathname, `/app/${file}`, `${role} opens ${file}`);
  } else {
    await page.waitForURL((u) => u.pathname === `/app/${home}`, { timeout: 15_000 }).catch(() => {});
    assert.equal(new URL(page.url()).pathname, `/app/${home}`, `${role} is sent from ${file} to ${home}`);
  }
  await page.close();
}

test("role gate: bank outreach opens for managers and outbound reps, while outbound reps stay out of client work", { timeout: 420_000 }, async () => {
  for (const role of Object.keys(HOME)) await visit(role, "bank-outreach.html");
  for (const file of ["pipeline.html", "client-control-panel.html", "lenders.html", "documents.html", "staff-teams.html", "client-portal.html"]) {
    await visit("outbound_rep", file);
  }
});

test("role gate: Hiring and Staff & Teams, opened by the roles that may and sent home for the rest", { timeout: 420_000 }, async () => {
  for (const [role, file] of [
    ["owner", "hiring.html"], ["admin", "hiring.html"], ["sales_manager", "hiring.html"], ["closer", "hiring.html"], ["setter", "hiring.html"], ["csm", "hiring.html"],
    ["owner", "staff-teams.html"], ["admin", "staff-teams.html"], ["sales_manager", "staff-teams.html"], ["closer", "staff-teams.html"],
    ["funding_advisor", "staff-teams.html"], ["inquiry_specialist", "staff-teams.html"],
  ]) await visit(role, file);
});

test("role gate: Social Studio and the owner-and-admin desks, opened by the roles that may and sent home for the rest", { timeout: 420_000 }, async () => {
  for (const [role, file] of [
    ["owner", "social-studio.html"], ["admin", "social-studio.html"], ["partner", "social-studio.html"], ["sales_manager", "social-studio.html"],
    ["closer", "social-studio.html"], ["client", "social-studio.html"],
    ["owner", "journeys.html"], ["admin", "journeys.html"], ["setter", "journeys.html"], ["sales_manager", "journeys.html"],
    ["admin", "contracts.html"], ["csm", "contracts.html"], ["admin", "company-brain.html"], ["closer", "company-brain.html"],
  ]) await visit(role, file);
});

test("role gate: the Consent desk opens for owner, admin, closer, funding advisor and CSM, and for no one else", { timeout: 420_000 }, async () => {
  for (const role of ["owner", "admin", "closer", "funding_advisor", "csm", "setter", "sales_manager", "inquiry_specialist", "client", "partner", "affiliate"]) {
    await visit(role, "consent-capture.html");
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Pass 1: the remembered role answers before the session does
test("role gate: a remembered role bounces a forbidden page before the session has answered, and lets an allowed one stay", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, { role: "closer", hint: "closer", session: () => new Promise(() => {}) });
  await page.goto(`${lab.origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
  await page.close();

  const consent = await makePage(lab, { role: "setter", hint: "setter", session: () => new Promise(() => {}) });
  await consent.goto(`${lab.origin}/app/consent-capture.html`, { waitUntil: "domcontentloaded" });
  await consent.waitForURL((u) => u.pathname === "/app/setter-dashboard.html", { timeout: 15_000 });
  await consent.close();

  const stay = await makePage(lab, { role: "owner", hint: "owner", session: () => new Promise(() => {}) });
  await stay.goto(`${lab.origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(new URL(stay.url()).pathname, "/app/products-commissions.html");
  await stay.close();
});
