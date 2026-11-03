// The demo portal is unlocked and full of sample data. A real client's is not.
//
// WHY THIS FILE EXISTS. Owner ask 2026-09-25: "for the demo portal please make
// sure they are all unlocked so daddy can see whats going on, please put sample
// data in as well." The risk in granting that is the opposite mistake — a demo
// branch that leaks onto a real client's screen, or sample figures that a
// paying client mistakes for their own file. So this holds both halves:
// ?demo=1 (and the app's existing `fh_demo` key) unlocks everything and labels
// it sample, and nothing else on the page can take that branch.
//
// It RUNS the page's own demo code rather than reading it, the same way
// src/http/portal-own-course.test.mjs runs the What You Own block.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_FILE = path.resolve(HERE, "../../public/app/client-portal.html");
const HTML = fs.readFileSync(PORTAL_FILE, "utf8");

/** The demo block, cut out of the page rather than copied. */
function demoSource() {
  const start = HTML.indexOf("  function isDemoPortal() {");
  const end = HTML.indexOf("  function paintDemoPortal() {");
  assert.ok(start > 0 && end > start, "could not find the demo block in client-portal.html");
  return HTML.slice(start, end);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Run the demo block with a chosen URL flag and stored flag. */
function runDemoBlock({ param = null, stored = null } = {}) {
  const blobs = [];
  const ctx = vm.createContext({
    esc,
    FHData: { param: (k) => (k === "demo" ? param : null) },
    localStorage: { getItem: () => stored },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    URL: { createObjectURL: (b) => { blobs.push(b); return `blob:sample-${blobs.length}`; } },
    Date
  });
  vm.runInContext(demoSource(), ctx);
  return { ctx, blobs };
}

describe("the demo portal is unlocked, and only the demo", () => {
  test("?demo=1 and the app's fh_demo key both open it — nothing else does", () => {
    assert.equal(runDemoBlock({ param: "1" }).ctx.isDemoPortal(), true);
    assert.equal(runDemoBlock({ stored: "1" }).ctx.isDemoPortal(), true);
    assert.equal(runDemoBlock({}).ctx.isDemoPortal(), false, "a normal client is not in demo mode");
    assert.equal(runDemoBlock({ param: "0" }).ctx.isDemoPortal(), false);
    assert.equal(runDemoBlock({ param: "yes" }).ctx.isDemoPortal(), false);
  });

  test("?demo=1 gets past the shell's sign-in bounce, using the shell's own demo key", () => {
    // Measured live 2026-09-25: shell.js sends a visitor with no session to
    // /portal-login.html before this page paints, so ?demo=1 showed a sign-in
    // form. The escape is the app's own demo session key, written before
    // shell.js (which is deferred) can build its session promise.
    const shellTag = HTML.indexOf('<script defer src="shell.js">');
    const setter = HTML.indexOf('localStorage.setItem("fh_demo_staff"');
    assert.ok(setter > 0, "the demo writes the shell's own demo session key");
    assert.ok(setter < shellTag, "and writes it before shell.js is loaded");
    // Only on a deliberate ?demo=1, and it must not claim a staff role for the
    // rest of the app: fh_role is the cached staff hint and stays untouched.
    const block = HTML.slice(HTML.indexOf("<!-- ══ THE DEMO PORTAL GETS PAST"), shellTag);
    assert.match(block, /q\.get\("demo"\) !== "1"\) return;/);
    assert.ok(!/setItem\(\s*["']fh_role["']/.test(block),
      "a demo visit must not cache a staff role for the rest of the app");
    assert.match(block, /role: "owner"/,
      "owner is the one role shell.js lets open a client's portal");
  });

  test("demoMode is set in one place only — the demo paint function", () => {
    const sets = [...HTML.matchAll(/demoMode\s*=\s*true/g)];
    assert.equal(sets.length, 1, "exactly one thing may turn demo mode on");
    const paint = HTML.slice(HTML.indexOf("function paintDemoPortal() {"));
    assert.match(paint.slice(0, 200), /demoMode = true/,
      "and that one thing is paintDemoPortal");
  });

  test("the demo unlocks every card: all six entitlement codes, the pull, and the paid order", () => {
    const paint = HTML.slice(
      HTML.indexOf("function paintDemoPortal() {"),
      HTML.indexOf("if (isDemoPortal()) {")
    );
    for (const code of [
      "credit-analysis-report",
      "credit-optimization-roadmap",
      "funding-snapshot",
      "bank-lender-match-list",
      "metro2-letter-pack",
      "funding-mastery-course"
    ]) {
      assert.ok(paint.includes(`"${code}"`), `the demo grants ${code}`);
    }
    assert.match(paint, /softPullDone = true/, "the soft pull reads Done, not locked at a price");
    assert.match(paint, /sloPaid = true/, "the $297 Blueprint and its five pack rows are open");
    // The one rule that would empty a card Chris asked to see is skipped on demo.
    assert.match(HTML, /var active = entActive \|\| \{\};/, "tile rendering retains the actual entitlement map");
    assert.match(HTML, /if \(!demoMode && active\["metro2-letter-pack"\]\)/, "only real letter-pack owners hide the trial card; demo keeps every card visible");
  });

  test("every sample deliverable is openable and says SAMPLE on it", () => {
    const { ctx, blobs } = runDemoBlock({ param: "1" });
    const docs = ctx.demoDocuments();

    assert.equal(docs.length, 5, "the five $297 deliverables");
    assert.equal(docs.map((d) => d.subtype).join(","), [
      "credit_analysis_report",
      "credit_optimization_roadmap",
      "funding_snapshot",
      "bank_lender_match_list",
      "metro2_dispute_letter_pack"
    ].join(","));
    for (const d of docs) {
      assert.equal(d.kind, "deliverable", `${d.subtype} lands in What You Own`);
      assert.ok(d.download && d.download.url, `${d.subtype} has a file that opens`);
    }

    // Each file states what it is before anything else on the page.
    assert.equal(blobs.length, 5);
    for (const b of blobs) {
      const body = String(b.parts[0]);
      assert.match(body, /SAMPLE — demo portal\. Not a real client and not a real credit file\./);
      assert.match(body, /Fundhub|SAMPLE/);
    }
  });

  test("no sample invents a person, an address, or a credit file", () => {
    const { blobs, ctx } = runDemoBlock({ param: "1" });
    const docs = JSON.stringify(ctx.demoDocuments());
    const all = blobs.map((b) => String(b.parts[0])).join("\n") + docs;
    assert.ok(!/@[a-z0-9-]+\.(com|net|org|ai)\b/i.test(all), "no email address");
    assert.ok(!/\b\d{3}-\d{2}-\d{4}\b/.test(all), "no SSN shape");
    assert.ok(!/\b\d{1,5}\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr)\b/i.test(all),
      "no street address");
    assert.ok(!/\.(jpg|jpeg|png|webp|gif)\b/i.test(all), "no face, no photo");
    assert.match(all, /DEMO Client/, "the demo person is named DEMO, per src/auth/demo-roster.mjs");
  });

  test("the demo reads nothing from the server — it cannot show a real client", () => {
    const demoBlock = HTML.slice(
      HTML.indexOf("  function isDemoPortal() {"),
      HTML.indexOf("if (isDemoPortal()) {")
    );
    for (const read of ["FHData.entitlements", "FHData.portalSummary", "FHData.portalContracts",
      "FHData.client(", "clientIdFromSession"]) {
      assert.ok(!demoBlock.includes(read), `the demo must not call ${read}`);
    }
    // And it returns before the real reads are wired, so none of them can fire.
    assert.match(HTML, /if \(isDemoPortal\(\)\) \{\s*\n\s*paintDemoPortal\(\);\s*\n\s*return;/);
    assert.ok(HTML.indexOf("if (isDemoPortal()) {") < HTML.indexOf("FHData.wire(FHData.portalContracts"),
      "the demo branch comes before every live read on this screen");
  });

  test("a normal client still sees every offer, and sees them locked", () => {
    // The demo unlocks; it does not change what anyone else is shown. All six
    // offer cards ship on the grid, and they ship LOCKED — so an unpaid client
    // reads the real offers, not the demo's unlocked ones.
    for (const key of ["SOFT_PULL", "FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL",
      "UWIQ_DELIVERABLES", "FUNDING_MASTERY"]) {
      assert.ok(HTML.includes(`<article class="tile locked" data-tile="${key}">`),
        `${key} ships on the grid, locked, for a real client`);
    }
    assert.ok(!/OWNED_ONLY/.test(HTML), "no owned-only hide list may return to this page");
    // The sample figures live inside the demo block and nowhere a real client's
    // paint path can reach them. The block starts at its own banner comment,
    // because that comment names the demo furniture it is about to use.
    const demoStart = HTML.indexOf("  /* ══ THE DEMO PORTAL ══");
    assert.ok(demoStart > 0, "the demo block is banner-commented so it can be found");
    const outsideDemo = HTML.slice(0, demoStart) +
      HTML.slice(HTML.indexOf("if (isDemoPortal()) {"));
    for (const sample of ["DEMO Client", "$85,000", "Harborwick", "Quillcrest", "$297.00"]) {
      assert.ok(!outsideDemo.includes(sample),
        `${sample} is demo-only furniture and must not sit on the live paint path`);
    }
  });
});
