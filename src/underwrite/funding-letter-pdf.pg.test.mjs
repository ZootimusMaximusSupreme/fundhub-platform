// F46, END TO END: how many deliverable rows land in `documents`.
//
// FIVE FOR AN ORDINARY CLIENT. SIX FOR A THIN-FILE OR AUTHORIZED-USER-DOMINANT
// ONE. The sixth is the Business Readiness Guide, and the vendor only adds it to
// the pack when `consumerSignals.tradelines.thinFile` is true or
// `consumerSignals.tradelines.auDominance` is over 0.6
// (vendor/underwriteiq-full/api/lite/crs/build-documents.js:162-168). Both
// classes are proven here, because a test of only the ordinary client is exactly
// what let the sixth stay dropped after the fifth was fixed.
//
// Nothing here is stubbed. It seeds a client, puts the repo's own `academy`
// simulated credit file behind it (scripts/sim/push-credit.mjs — the profile the
// 2026-09-03 manual walkthrough used, which tiers FULL_FUNDING), runs the REAL
// buildLetterPackForClient, and hands the pack to the REAL
// persistFundingLetterFiles. Then it reads the table.
//
// HOW THE AU-DOMINANT CLIENT IS MADE: the same `academy` payload with every
// tradeline but the first flipped to `accountOwnershipType: "AuthorizedUser"`.
// That is the one field normalize-soft-pull.js:200 reads to set `isAU`, and
// derive-consumer-signals.js:115 turns into auDominance. Nine of twelve
// tradelines authorized-user gives 0.75, over the 0.6 threshold, and the file
// still tiers FULL_FUNDING — so this is one funding client with a sixth
// document, not a different journey.
//
// MEASURED on a scratch Postgres 2026-09-05, before each half of the fix:
//   ordinary client    — pack carried 5 analysis files, 4 rows landed
//                        (funding_summary dropped)
//   AU-dominant client — pack carried 6 analysis files, 5 rows landed
//                        (business_prep_summary dropped, at the same line)
//
// WHY THE `academy` PROFILE AND NOT src/demo/simulate-client.mjs's OWN FILE:
// the demo client tiers MANUAL_REVIEW, and buildDocuments() emits hold_notice +
// operator_checklist for that tier (build-documents.js:34-55) — no funding
// summary at all. The Capital Readiness Summary only exists on a funding tier,
// so a test that does not reach one proves nothing about F46.
//
// SKIPS with no DATABASE_URL, the convention every .pg.test.mjs here follows.
// Lives under src/ so npm test's glob actually runs it (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";

/* A test identity, so the simulator never reads the owner's gitignored file
   (credentials/sim-identity/owner-identity.local.json). That file exists only
   on Chris's Mac, so in CI every test here died in its hook with "identity file
   not found" (2026-10-05). Same pattern as
   src/deliverables/business-duplication-map.test.mjs. */
const TEST_IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildLetterPackForClient } from "./letter-pack.mjs";
import { persistFundingLetterFiles } from "./funding-letter-pdf.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "f46.fixture";

/** What an ORDINARY funding client gets. Four was the first defect. The
    Business Duplication Map joined the pack on 2026-10-02. */
const ORDINARY_SUBTYPES = [
  "bank_lender_match_list",
  "business_duplication_map",
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "funding_snapshot",
  "funding_summary"
];

/** What a THIN-FILE / AU-DOMINANT client gets. Five was the second defect. */
const AU_DOMINANT_SUBTYPES = [
  "bank_lender_match_list",
  "business_duplication_map",
  "business_prep_summary",
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "funding_snapshot",
  "funding_summary"
];

/** Flip every tradeline but the first to authorized-user, on every bureau. */
function makeAuDominant(payload) {
  for (const code of ["TU", "EX", "EQ"]) {
    payload.bureaus[code].tradelines = payload.bureaus[code].tradelines
      .map((t, i) => (i >= 1 ? { ...t, accountOwnershipType: "AuthorizedUser" } : t));
  }
  return payload;
}

/**
 * Seed one client, put a credit file behind it, build the real pack, hand it to
 * the real saver. `shape` may rewrite the payload before it is stored.
 */
async function seedAndSave(label, shape = (p) => p) {
  const org = await resolveDefaultOrg(db);
  const email = `${EMAIL_TAG}.${label}.${Date.now()}@example.com`;
  // is_demo so the append-only document_versions trigger lets the fixture be
  // removed afterwards (db/migrations/150_demo_wipe_allow.sql).
  const clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
     VALUES ($1,$2,'F46','Fixture',true) RETURNING id`, [org, email])).rows[0].id;

  const payload = shape(buildPayload("academy", { email, name: "F46 Fixture", identity: TEST_IDENTITY }));
  const tier = runTierEngineFromCrsResult(payload, {
    submittedName: "F46 Fixture", submittedAddress: ""
  });
  assert.equal(tier.outcome, "FULL_FUNDING",
    `the ${label} fixture must tier for funding or this proves nothing`);
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
     VALUES ($1,$2,$3::jsonb,$4)`,
    [org, clientId, JSON.stringify(payload), tier.outcome]);

  const pack = await buildLetterPackForClient(db, { clientId, pack: "funding" });
  const stored = await persistFundingLetterFiles(db, createStore(memoryProvider()), {
    orgId: org, clientId, files: pack.files || [], generatedBy: "f46-pg-test"
  });
  return { org, clientId, pack, stored, tier };
}

/** The analysis rows only — a letter row carries no `docType` in its metadata. */
async function subtypesFor(org, clientId) {
  const { rows } = await db.query(
    `SELECT subtype, title, mime_type FROM documents
      WHERE org_id = $1 AND client_id = $2 AND kind = 'deliverable'
        AND (metadata->>'docType') IS NOT NULL
      ORDER BY subtype`, [org, clientId]);
  return rows;
}

/** Every deliverable row, analysis and letter alike. */
async function allDeliverableCount(org, clientId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM documents
      WHERE org_id = $1 AND client_id = $2 AND kind = 'deliverable'`,
    [org, clientId]);
  return rows[0].n;
}

describe("F46 end to end — an ORDINARY client gets five deliverables",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
    let org, clientId, pack, stored;

    before(async () => {
      ({ org, clientId, pack, stored } = await seedAndSave("ordinary"));
    });

    after(async () => {
      if (!HAVE_DB) return;
      await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]).catch(() => {});
    });

    test("the pack itself carries the Capital Readiness Summary", () => {
      assert.equal(pack.reason, null, `pack failed: ${pack.reason}`);
      const types = (pack.files || []).map((f) => f.type);
      assert.ok(types.includes("funding_summary"),
        `the pack has no funding_summary file — types were ${JSON.stringify(types)}`);
      const summary = pack.files.find((f) => f.type === "funding_summary");
      assert.equal(summary.filename, "Capital-Readiness-Summary.pdf");
    });

    test("the pack does NOT carry the conditional sixth", () => {
      const types = (pack.files || []).map((f) => f.type);
      assert.ok(!types.includes("business_prep_summary"),
        "this client is neither thin-file nor AU-dominant — the sixth must not appear");
    });

    test("the saver stores six (five plus the Business Duplication Map), and recognises every file", () => {
      assert.equal(stored.skipped, null);
      assert.equal(stored.stored.length, 6);
      assert.deepEqual(stored.unrecognised, [],
        `the saver did not recognise ${JSON.stringify(stored.unrecognised)}`);
      assert.equal(
        stored.stored.length + stored.notStored.length + stored.unrecognised.length,
        stored.filesIn, "some file in the pack was not accounted for");
    });

    test("six deliverable rows are in the table, one per subtype", async () => {
      const rows = await subtypesFor(org, clientId);
      assert.deepEqual(rows.map((r) => r.subtype), ORDINARY_SUBTYPES);
      assert.equal(await allDeliverableCount(org, clientId), stored.stored.length,
        "a deliverable row landed that the saver did not report storing");
      const summary = rows.find((r) => r.subtype === "funding_summary");
      assert.equal(summary.title, "Capital Readiness Summary");
      assert.equal(summary.mime_type, "application/pdf");
      const map = rows.find((r) => r.subtype === "business_duplication_map");
      assert.equal(map.title, "Business Duplication Map");
      assert.equal(map.mime_type, "text/html");
    });

    test("the stored summary has real bytes behind it", async () => {
      const { rows } = await db.query(
        `SELECT byte_size, storage_key FROM documents
          WHERE org_id = $1 AND client_id = $2 AND subtype = 'funding_summary'`,
        [org, clientId]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].storage_key, "no storage key — nothing was actually stored");
      assert.ok(Number(rows[0].byte_size) > 0, "the summary was stored empty");
    });
  });

describe("F46 end to end — an AUTHORIZED-USER-DOMINANT client gets six",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
    let org, clientId, pack, stored, tier;

    before(async () => {
      ({ org, clientId, pack, stored, tier } = await seedAndSave("audom", makeAuDominant));
    });

    after(async () => {
      if (!HAVE_DB) return;
      await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]).catch(() => {});
      await close();
    });

    test("this fixture really is the class the vendor gates the sixth on", () => {
      const tl = tier.consumerSignals?.tradelines || {};
      assert.ok(tl.auDominance > 0.6,
        `auDominance was ${tl.auDominance} — build-documents.js:163 needs over 0.6`);
    });

    test("the pack carries the Business Readiness Guide", () => {
      assert.equal(pack.reason, null, `pack failed: ${pack.reason}`);
      const types = (pack.files || []).map((f) => f.type);
      assert.ok(types.includes("business_prep_summary"),
        `the pack has no business_prep_summary file — types were ${JSON.stringify(types)}`);
      const guide = pack.files.find((f) => f.type === "business_prep_summary");
      assert.equal(guide.filename, "Business-Readiness-Guide.pdf");
    });

    test("the saver stores seven (six plus the Business Duplication Map), and recognises every file", () => {
      assert.equal(stored.skipped, null);
      assert.equal(stored.stored.length, 7);
      assert.deepEqual(stored.unrecognised, [],
        `the saver did not recognise ${JSON.stringify(stored.unrecognised)}`);
      assert.equal(
        stored.stored.length + stored.notStored.length + stored.unrecognised.length,
        stored.filesIn, "some file in the pack was not accounted for");
    });

    test("seven deliverable rows are in the table, one per subtype", async () => {
      const rows = await subtypesFor(org, clientId);
      assert.deepEqual(rows.map((r) => r.subtype), AU_DOMINANT_SUBTYPES);
      assert.equal(await allDeliverableCount(org, clientId), stored.stored.length,
        "a deliverable row landed that the saver did not report storing");
      const guide = rows.find((r) => r.subtype === "business_prep_summary");
      assert.equal(guide.title, "Business Readiness Guide");
      assert.equal(guide.mime_type, "application/pdf");
    });

    test("the stored guide has real bytes behind it", async () => {
      const { rows } = await db.query(
        `SELECT byte_size, storage_key FROM documents
          WHERE org_id = $1 AND client_id = $2 AND subtype = 'business_prep_summary'`,
        [org, clientId]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].storage_key, "no storage key — nothing was actually stored");
      assert.ok(Number(rows[0].byte_size) > 0, "the guide was stored empty");
    });
  });
