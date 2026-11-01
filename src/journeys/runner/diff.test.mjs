/* Intent versus code.
 *
 * The two canaries this file exists for, both known-true findings, so a diff
 * that misses either is not actually checking anything:
 *
 *   1. "Sales Manager" — the editor offers it, the code has no such role.
 *   2. ['Screen','Affiliate portal — not built yet'] — a gap already sitting
 *      in the data as plain text that nothing reads.
 *
 * CANARY 1 IS PINNED TO A FIXTURE, DELIBERATELY. The sales_manager role is
 * being built in this same change. A test that read the live ROLE_SETS would
 * stop catching anything the moment it landed — the check would go green
 * because the finding was fixed, not because the checker works. So the fixture
 * below hardcodes a role list without sales_manager and asserts the diff flags
 * it. That assertion stays true forever, whatever the real role list does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { diff, matchScreen, indexRun } from "./diff.mjs";
import { gatherScreens, gatherRails } from "./facts.mjs";
import { SEED_JOURNEYS, EDITOR_ROLES } from "../seed-journeys.mjs";

const DAY = 24 * 60 * 60 * 1000;

/* A fixture of what the code holds. Fixed on purpose — see the header. */
function facts(over = {}) {
  return {
    orgId: "org-1",
    roles: {
      // The six staff roles ROLE_SETS.STAFF held when this test was written.
      // NOT read from the live module: see the header.
      staff: ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter"],
      finance: ["owner", "admin"]
    },
    pipelines: [{ key: "sales", name: "Sales" }, { key: "funding_card_stacking", name: "Funding: Card Stacking" }],
    stages: [
      { pipeline: "Sales", stage: "Survey Complete" },
      { pipeline: "Sales", stage: "Booked" },
      { pipeline: "Sales", stage: "Closed Won (deposit)" },
      { pipeline: "Sales", stage: "Downsell" },
      { pipeline: "Funding: Card Stacking", stage: "Round Submitted" },
      { pipeline: "Funding: Card Stacking", stage: "Funded" }
    ],
    agents: [
      { code: "AG-04", name: "Setter Chris", status: "live", prompt: null },
      { code: "AG-09", name: "Inquiry Removal AI", status: "live", prompt: null }
    ],
    templates: [{ template_key: "SMS-F03-ROUND-SUBMITTED", channel: "sms", compliance_passed: true }],
    clientColumns: ["id", "email", "phone", "funded", "outcome_tier", "custom_fields"],
    customFieldsWritten: ["survey_complete"],
    products: [{ bucket: "crs", nameIncludes: "business financial assessment" }],
    screens: [
      { file: "pipeline.html", title: "Pipeline", wired: true, evidence: "FHData" },
      { file: "affiliate.html", title: "Affiliate", wired: true, evidence: "FHData" },
      { file: "galaxy.html", title: "Galaxy", wired: false, evidence: "no data call found" }
    ],
    routes: new Set(["journeys", "dashboard/pipeline"]),
    rails: { commas: { adapter: true, secretEnv: "COMMAS_WEBHOOK_SECRET", secretSet: true } },
    journeyKeys: ["client", "setter", "closer", "advisor", "affiliate", "partner"],
    journeys: SEED_JOURNEYS,
    ...over
  };
}

const node = (type, cfg, touches = []) => ({ id: "n1", type, title: `a ${type}`, cfg, touches });
const oneJourney = (nodes) => ({ probe: { name: "Probe", start: "s", end: "e", nodes } });

// ── CANARY 1 ──────────────────────────────────────────────────────────────

test("CANARY: flags Sales Manager as a role the code does not implement", () => {
  // Not told to look for it — the journey simply assigns to the role the
  // editor offers, and the diff notices the code cannot honour it.
  const { findings } = diff(oneJourney([node("assign", { role: "Sales Manager" })]), facts());

  const hit = findings.find((f) => f.category === "assign" && f.verdict === "mismatch");
  assert.ok(hit, "assigning to Sales Manager must produce a mismatch");
  assert.match(hit.summary, /Sales Manager/);
  assert.match(hit.summary, /assigned to nobody/);
  assert.equal(hit.role, "sales_manager");
});

test("THE TICKET IS WRONG ABOUT WHERE Sales Manager APPEARS — the journeys editor does not offer it", () => {
  /* Ticket 8 says: "The editor's ROLES list contains Sales Manager and the
     code has no such role." The second half is true. The FIRST HALF IS NOT.
     public/app/journeys.html offers eight roles and Sales Manager is not one
     of them — the string does not appear in that file at all.

     Where it really appears: public/crm.html and public/app/staff-teams.html
     (the PM-01…PM-18 permission matrix and the role dropdowns), plus the
     wireframes. Those are mock screens, not the journeys editor.

     This matters for the canary. "A journey can already assign work to Sales
     Manager" is not currently true — no seeded journey does, and the editor
     gives no way to. The gap is real (the role is unbuilt) but the route by
     which the ticket expected the runner to find it does not exist, so the
     runner would report nothing on the authored data. Pinned here so the
     correction survives, and so a future edit that DOES add the role to the
     editor makes this test go red and get re-read. */
  assert.equal(
    EDITOR_ROLES.includes("Sales Manager"),
    false,
    "if the editor gains a Sales Manager role, the canary above starts firing on real data — re-read this test"
  );
  assert.deepEqual(EDITOR_ROLES, [
    "Client", "Setter", "Closer", "Funding Advisor", "Inquiry Specialist", "Owner", "Affiliate", "Partner"
  ]);

  // Every role the editor DOES offer is either a principal or a real staff
  // role — so on the authored data the assign check has nothing to flag.
  const PRINCIPALS = ["client", "affiliate", "partner"];
  const f = facts();
  const unbuilt = EDITOR_ROLES.map((label) => label.toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((k) => !PRINCIPALS.includes(k))
    .filter((k) => !f.roles.staff.includes(k));
  assert.deepEqual(unbuilt, [], "no role the editor offers is unbuilt — Sales Manager is not on that list");
});

test("a role the code does implement passes", () => {
  const { findings } = diff(oneJourney([node("assign", { role: "Funding Advisor" })]), facts());
  const hit = findings.find((f) => f.category === "assign");
  assert.equal(hit.verdict, "ok");
  assert.equal(hit.role, "funding_advisor");
});

test("assigning to a principal type is not judged against the staff role set", () => {
  const { findings } = diff(oneJourney([node("assign", { role: "Client" })]), facts());
  assert.equal(findings.find((f) => f.category === "assign").verdict, "ok");
});

// ── CANARY 2 ──────────────────────────────────────────────────────────────

test("CANARY: the unbuilt affiliate portal surfaces as an unresolved Screen row", () => {
  const { findings } = diff(SEED_JOURNEYS, facts());
  const hit = findings.find(
    (f) => f.category === "touch:Screen" && f.label === "Affiliate portal — not built yet"
  );
  assert.ok(hit, "the touches entry must produce a row");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /no screen in public\/app\/ resolves/);
});

test("a screen label that cannot be resolved is never guessed at", () => {
  assert.equal(matchScreen("Affiliate portal — not built yet", facts().screens), null);
  assert.equal(matchScreen("Some screen nobody built", facts().screens), null);
  // A real one does resolve.
  assert.equal(matchScreen("Pipeline", facts().screens)?.screen.file, "pipeline.html");
});

test("a touched screen that is a wireframe is a mismatch, not a pass", () => {
  const { findings } = diff(
    oneJourney([node("record", {}, [["Screen", "Galaxy"]])]),
    facts()
  );
  const hit = findings.find((f) => f.category === "touch:Screen");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /wireframe/);
});

// ── the rest of the node table ────────────────────────────────────────────

test("a stage in the wrong pipeline is caught, and says where it really lives", () => {
  const { findings } = diff(oneJourney([node("stage", { stage: "Funded", pipeline: "Sales" })]), facts());
  const hit = findings.find((f) => f.category === "stage");
  assert.equal(hit.verdict, "mismatch");
  assert.equal(hit.foundIn, "Funding: Card Stacking");
});

test("a stage that exists nowhere is caught", () => {
  const { findings } = diff(oneJourney([node("stage", { stage: "Nonexistent", pipeline: "Sales" })]), facts());
  assert.equal(findings.find((f) => f.category === "stage").verdict, "mismatch");
});

test("an agent the editor offers but the registry does not hold is caught", () => {
  const { findings } = diff(oneJourney([node("agent", { agent: "UnderwriteIQ" })]), facts());
  const hit = findings.find((f) => f.category === "agent");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /no such agent is registered/);
});

test("a live agent passes, and a live agent with no prompt says so", () => {
  const { findings } = diff(oneJourney([node("agent", { agent: "Setter Chris" })]), facts());
  const hit = findings.find((f) => f.category === "agent");
  assert.equal(hit.verdict, "ok");
  assert.equal(hit.promptMissing, true);
});

test("payment routing is checked on name only, never amount", () => {
  const ok = diff(oneJourney([node("payment", { product: "Business Financial Assessment", amount: "32.00" })]), facts());
  assert.equal(ok.findings.find((f) => f.category === "payment").verdict, "ok");

  // Same product, wildly different amount — still routes, because routing
  // never reads the amount.
  const odd = diff(oneJourney([node("payment", { product: "Business Financial Assessment", amount: "99999" })]), facts());
  assert.equal(odd.findings.find((f) => f.category === "payment").verdict, "ok");

  const bad = diff(oneJourney([node("payment", { product: "Mystery Box", amount: "32.00" })]), facts());
  assert.equal(bad.findings.find((f) => f.category === "payment").verdict, "mismatch");
});

test("a condition on a field nothing writes is a branch that can never be taken", () => {
  const bad = diff(oneJourney([node("condition", { field: "nobody_writes_this", op: "is true" })]), facts());
  const hit = bad.findings.find((f) => f.category === "condition");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /can never be taken/);

  const good = diff(oneJourney([node("condition", { field: "survey_complete", op: "is true" })]), facts());
  assert.equal(good.findings.find((f) => f.category === "condition").verdict, "ok");
});

test("Rule touches are reported and never asserted on", () => {
  const { findings } = diff(
    oneJourney([node("record", {}, [["Rule", "Anything at all, in prose"]])]),
    facts()
  );
  const hit = findings.find((f) => f.category === "touch:Rule");
  assert.equal(hit.verdict, "note", "a Rule is never ok or mismatch — it is a note");
  assert.equal(hit.summary, "Anything at all, in prose");
});

test("a template that has not passed compliance is a dead journey step", () => {
  const f = facts({ templates: [{ template_key: "SMS-S01-WELCOME", channel: "sms", compliance_passed: false }] });
  const { findings } = diff(oneJourney([node("sms", {}, [["Template", "S-01"]])]), f);
  const hit = findings.find((x) => x.category === "touch:Template");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /never render/);
});

test("a missing template makes sendTemplated a silent no-op, and says so", () => {
  const { findings } = diff(oneJourney([node("sms", {}, [["Template", "Z-99"]])]), facts());
  const hit = findings.find((x) => x.category === "touch:Template");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /silent no-op/);
});

// ── could-not-check is its own verdict ────────────────────────────────────

test("an unreadable table is unverified, never ok and never a mismatch", () => {
  const blind = facts({ templates: null, agents: null, stages: null, pipelines: null, clientColumns: null });
  const { findings } = diff(
    oneJourney([
      node("stage", { stage: "Booked", pipeline: "Sales" }),
      node("agent", { agent: "Setter Chris" }),
      node("condition", { field: "survey_complete", op: "is true" }),
      node("sms", {}, [["Template", "S-01"]])
    ]),
    blind
  );
  for (const f of findings) {
    assert.equal(f.verdict, "unverified", `${f.category} must be unverified when the data could not be read`);
  }
});

// ── screen coverage ───────────────────────────────────────────────────────

test("every screen is classified into exactly one of the three buckets", () => {
  const { screenCoverage } = diff(SEED_JOURNEYS, facts());
  const buckets = new Set(["touched and wired", "touched and wireframe", "touched by no journey"]);
  assert.equal(screenCoverage.length, 3);
  for (const s of screenCoverage) assert.ok(buckets.has(s.classification), s.classification);
});

test("REAL public/app: every screen on disk is classified", () => {
  // Against the real filesystem, not the fixture — this is the acceptance
  // criterion "every screen in public/app/ is classified".
  const screens = gatherScreens();
  /* A floor, not a count. It exists to prove this read the real public/app
     directory rather than the 3-screen fixture above, so it must not be a
     number that moves whenever a screen is added or removed.

     It was 30, and the Finance OS consolidation took the inventory to 29 by
     folding eleven finance screens into finance-os.html. Lowered to 20 and
     given this note so the next consolidation does not read as a regression.
     The assertion that actually matters is the one below: EVERY screen found
     is classified, exactly, with none left out. */
  assert.ok(screens.length >= 20, `expected the real screen inventory, got ${screens.length}`);
  const { screenCoverage } = diff(SEED_JOURNEYS, facts({ screens }));
  assert.equal(screenCoverage.length, screens.length, "no screen may be left out of the classification");
  const unclassified = screenCoverage.filter((s) => !s.classification);
  assert.deepEqual(unclassified, []);
});

test("a rail with no secret set fails closed and is reported", () => {
  const f = facts({ rails: { commas: { adapter: true, secretEnv: "COMMAS_WEBHOOK_SECRET", secretSet: false } } });
  const { findings } = diff(oneJourney([node("payment", { product: "Business Financial Assessment" }, [["Rail", "Commas / Payva"]])]), f);
  const hit = findings.find((x) => x.category === "touch:Rail");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /fails closed/);
});

test("gatherRails reads the real adapter directory", () => {
  const rails = gatherRails({});
  assert.equal(rails.commas.adapter, true, "src/adapters/commas.mjs exists");
  assert.equal(rails.commas.secretSet, false, "with no env, the secret is not set");
});

// ── the run index ─────────────────────────────────────────────────────────

test("the walk index folds messages and sleeps per journey", () => {
  const idx = indexRun({
    paths: [
      { pathId: "client#1", messages: [{}, {}], stepRecord: [{ kind: "sleep", ms: DAY }] },
      { pathId: "client#2", messages: [{}], stepRecord: [{ kind: "sleep", ms: 2 * DAY }] },
      { pathId: "setter#1", messages: [], stepRecord: [] }
    ]
  });
  assert.equal(idx.messagesByJourney.get("client"), 3);
  assert.equal(idx.sleepsByJourney.get("client"), 2 * DAY);
  assert.equal(idx.messagesByJourney.get("setter"), 0);
});

test("a journey that sends messages but wrote none is a mismatch", () => {
  const report = { paths: [{ pathId: "probe#1", messages: [], stepRecord: [] }] };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "sms");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /no message row was written/);
});

// ── the three-way message verdict ─────────────────────────────────────────

/* The bug these four tests exist for: "no message row was written" was
   reported whenever the in-memory PROVIDER logged nothing, which is true of
   every message the safety fence or the compliance gate held. Those messages
   WERE written. The owner was told the opposite of what happened. */
const ledgerPath = (over = {}) => ({
  pathId: "probe#1",
  journeyKey: "probe",
  messages: [],
  stepRecord: [],
  messageLedger: { queued: 0, sent: 0, held: 0, holdReasons: [], ...over }
});

test("queued and sent is the only verdict that passes", () => {
  const report = { paths: [ledgerPath({ queued: 2, sent: 2 })] };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "sms");
  assert.equal(hit.verdict, "ok");
  assert.equal(hit.sent, 2);
});

test("a message the safety fence held is NOT reported as never written", () => {
  const report = {
    paths: [ledgerPath({
      queued: 3,
      sent: 0,
      held: 3,
      holdReasons: [{ reason: "the safety fence stopped this whole path before anything was handed over", detail: "twilio" }]
    })]
  };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "sms");
  assert.equal(hit.verdict, "unverified", "held is not the same as never written");
  assert.doesNotMatch(hit.summary, /no message row was written/);
  assert.match(hit.summary, /3 messages were written and then held/);
  assert.match(hit.summary, /safety fence/);
  assert.equal(hit.queued, 3);
});

test("a hold reason in the dispatcher's own vocabulary is put into words", () => {
  const report = { paths: [ledgerPath({ queued: 1, sent: 0, held: 1, holdReasons: [{ reason: "deferred", detail: null }] })] };
  const { findings } = diff(oneJourney([node("email", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "email");
  assert.equal(hit.verdict, "unverified");
  assert.match(hit.summary, /quiet hours/);
});

test("nothing queued is still a mismatch, and now it is actually true", () => {
  const report = { paths: [ledgerPath({ queued: 0, sent: 0, held: 0 })] };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "sms");
  assert.equal(hit.verdict, "mismatch");
  assert.match(hit.summary, /no message row was written/);
});

test("a messages table that would not read is could-not-check, never a mismatch", () => {
  const report = { paths: [{ pathId: "probe#1", journeyKey: "probe", messages: [], stepRecord: [], messageLedger: null }] };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  const hit = findings.find((f) => f.category === "sms");
  assert.equal(hit.verdict, "unverified");
  assert.match(hit.summary, /could not be read/);
});

test("one unreadable path makes the whole journey's answer unknown", () => {
  // Averaging a failed read away against a good one is the false green this
  // harness exists to refuse.
  const report = {
    paths: [
      ledgerPath({ queued: 2, sent: 2 }),
      { pathId: "probe#2", journeyKey: "probe", messages: [], stepRecord: [], messageLedger: null }
    ]
  };
  const { findings } = diff(oneJourney([node("sms", { body: "hi" })]), facts(), report);
  assert.equal(findings.find((f) => f.category === "sms").verdict, "unverified");
});

// ── the screens folder ────────────────────────────────────────────────────

test("gatherScreens returns null when the folder cannot be read, never an empty list", () => {
  assert.equal(gatherScreens("/nonexistent/definitely/not/a/directory"), null);
});

test("an unreadable screens folder is could-not-check, and does not accuse every screen of not existing", () => {
  const blind = facts({ screens: null });
  const { findings, screenCoverage, screensUnreadable } = diff(
    oneJourney([node("record", {}, [["Screen", "Pipeline"]])]),
    blind
  );
  assert.equal(screensUnreadable, true);
  assert.deepEqual(screenCoverage, [], "nothing may be listed when nothing could be read");

  const touch = findings.find((f) => f.category === "touch:Screen");
  assert.equal(touch.verdict, "unverified");
  assert.match(touch.summary, /could not be read/);

  // And the failed read is its own row, so an empty screen list is never
  // mistaken for "this product has no screens".
  const own = findings.find((f) => f.category === "screens");
  assert.ok(own, "the failed read must be a finding in its own right");
  assert.equal(own.verdict, "unverified");
});

test("matchScreen never guesses when there is no list to match against", () => {
  assert.equal(matchScreen("Pipeline", null), null);
});
