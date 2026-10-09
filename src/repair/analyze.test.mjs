import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addressFromBusinessEntity,
  analyzeAndGenerate,
  hasActiveRepairProgram,
  loadVerifiedIdentity,
  resetVerifiedIdentityCache,
  verifiedAddressLabel
} from "./analyze.mjs";

/* THE VERIFIED IDENTITY — the stand-in for src/identity/ in these tests.
   The one name and the one address a letter is allowed to assert come off the
   client's uploaded government ID and proof of address, never off the CRM
   record. src/identity/ owns that read and is another lane's module; until it
   exists, analyzeAndGenerate answers null for every client and the letters make
   no name or address claim at all. These tests inject it through the same seam
   that module will fill. */
const VERIFIED = Object.freeze({
  legalName: "Sim Repair",
  address: "412 Pecan St, Austin, TX, 78701",
  source: "id_document",
  verifiedAt: "2026-09-01T00:00:00Z"
});
const verifiedIdentity = () => VERIFIED;
/** Name verified off the ID, no proof of address accepted yet. */
const verifiedNameOnly = () => ({ ...VERIFIED, address: null });

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakeDb(handlers = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      for (const [re, rows] of Object.entries(handlers)) {
        if (new RegExp(re, "i").test(text)) {
          return { rows: typeof rows === "function" ? rows(text, params) : (rows || []) };
        }
      }
      return { rows: [] };
    }
  };
}

describe("addressFromBusinessEntity", () => {
  test("reads the soft-pull company street", () => {
    const addr = addressFromBusinessEntity({
      address_line1: "204 Horse Blvd",
      city: "Austin",
      state: "TX",
      postal_code: "78701"
    });
    assert.equal(addr.address_line1, "204 Horse Blvd");
    assert.equal(addr.address_city, "Austin");
    assert.equal(addr.address_state, "TX");
    assert.equal(addr.address_zip, "78701");
  });

  test("refuses an empty entity", () => {
    assert.equal(addressFromBusinessEntity({ city: "Austin" }), null);
    assert.equal(addressFromBusinessEntity(null), null);
  });
});

describe("analyzeAndGenerate", () => {
  test("letters already on file still refuse without a signed repair agreement", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM dispute_letters/i.test(c.sql)));
  });

  test("staff dispute authorization is enough when no signed contract exists", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true);
    assert.equal(r.letters.length, 1);
  });

  test("letters already on file succeed when a signed repair agreement exists", async () => {
    const db = fakeDb({
      "FROM contracts": [{ "?column?": 1 }],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true);
    assert.equal(r.letters.length, 1);
  });

  test("enroll without a signed repair agreement refuses before the credit file", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM repair_programs": [{ program: "trial", rounds_cap: 2, status: "active" }],
      "FROM crs_results": [{ result: { bureausPulled: ["EQ"] } }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM crs_results/i.test(c.sql)));
  });

  test("no agreement still refuses before the credit file", async () => {
    const db = fakeDb({
      "FROM dispute_letters dl": [],
      "FROM client_consents": [],
      "FROM contracts": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: { bureausPulled: ["EQ"] } }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM crs_results/i.test(c.sql)));
  });
});

/* OWNER DECISION, 2026-09-03 — "any derogatory deserves a letter, but only if
   they are in the correct offer path." These two tests are the whole rule: the
   same damaged credit file produces letters for a repair-path client and nothing
   for a client off that path. The Metro 2 engine finds no defect in this file, so
   every claim in the letter comes from the derogatory pass. */
describe("derogatory items and the offer path", () => {
  const DAMAGED_FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          }
        }],
        inquiries: [],
        tradelines: [{
          creditorName: "MIDLAND CREDIT MANAGEMENT",
          accountIdentifier: "SIM-MCM-6642",
          accountOpenedDate: "2024-02-20",
          accountReportedDate: "2026-08-28",
          accountOwnershipType: "Individual",
          accountStatusType: "Open",
          accountType: "Open",
          loanType: "CollectionAgencyAttorney",
          businessType: "Collection",
          currentRatingType: "CollectionOrChargeOff",
          currentBalanceAmount: "1840",
          pastDueAmount: "0",
          sourceType: "Experian"
        }]
      }
    }
  };

  function dbFor(tier, { agreement = false, personalAddress = true, program = null, entitlement = false } = {}) {
    return fakeDb({
      /* The writer never reads entitlements. This row is here so a test can
         prove that: a client holding metro2-letter-pack (every Capital
         Blueprint buyer does) must not become a repair-path client by it. */
      "v_client_entitlements": entitlement ? [{ "?column?": 1 }] : [],
      // Order matters: the outcome_tier read must be matched before the
      // first_name/last_name read, and both are "FROM clients".
      "outcome_tier FROM clients": [{ outcome_tier: tier }],
      "first_name, last_name": [{ first_name: "Sim", last_name: "Repair" }],
      /* pii_identity is the ONLY source of the client's own address. Without a
         row here the floor makes no address claim, which is the point of the
         second test below. */
      "FROM pii_identity": personalAddress
        ? [{ addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }] }]
        : [],
      "FROM contracts": agreement ? [{ "?column?": 1 }] : [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": program ? [program] : [],
      "FROM crs_results": [{ result: DAMAGED_FILE }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1"
      }],
      "INSERT INTO dispute_items": [{ id: "item-1" }],
      "INSERT INTO dispute_letters": [{ id: "letter-1", bureau: "EX", case_id: "case-1" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("a repair-path client gets a letter for a collection the engine finds no defect in", async () => {
    const db = dbFor("REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
    /* The derogatory claim leads, and the personal-information floor
       (../metro2/diy/personal-info-floor.mjs) sits underneath it — owner-set
       2026-09-03, cleanup runs on every repair-path client on every round. This
       file carries no alias block and no address block, so the floor's two
       claims are the CONFIRM pair, never a fabricated second name. */
    assert.deepEqual(
      r.letters[0].ruleIds,
      ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]
    );
  });

  test("FUNDING_PLUS_REPAIR is a repair path too", async () => {
    const db = dbFor("FUNDING_PLUS_REPAIR");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });

  test("a funding-only client gets nothing, whatever the file holds", async () => {
    const db = dbFor("FULL_FUNDING");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_violations");
  });

  test("a signed repair agreement is a repair path even with no tier stamped", async () => {
    const db = dbFor(null, { agreement: true });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });

  /* ADDED 2026-10-09 (ZU-P). A repair buyer's file is not graded REPAIR_ONLY the
     moment they pay, and they may not have signed the (placeholder) repair
     agreement either. What they do have is an ACTIVE repair_programs row. The
     measured case is the one paying repair client: with the row ignored his file
     made 9 / 1 / 10 claims (TransUnion / Experian / Equifax); counted as the
     repair path it makes 13 / 5 / 14. */
  describe("an active repair program is a repair path", () => {
    const ACTIVE = { program: "full", rounds_cap: 6, status: "active" };

    test("PASS: an active program with no tier and no agreement gets the full repair letters", async () => {
      const db = dbFor(null, { program: ACTIVE });
      const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.letters.length, 1);
      assert.deepEqual(
        r.letters[0].ruleIds,
        ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]
      );
    });

    test("PASS: an active trial program counts too", async () => {
      const db = dbFor("FULL_FUNDING", { program: { program: "trial", rounds_cap: 2, status: "active" } });
      const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.letters.length, 1);
    });

    test("FAIL twin: the same file with NO program row gets nothing", async () => {
      const db = dbFor(null);
      const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_violations");
    });

    for (const status of ["cancelled", "complete", "upsell_pending"]) {
      test(`FAIL twin: a ${status} program is not a repair path`, async () => {
        const db = dbFor(null, { program: { program: "full", rounds_cap: 6, status } });
        const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
        assert.equal(r.ok, false);
        assert.equal(r.reason, "no_violations");
      });
    }

    test("a Capital Blueprint buyer (entitlement, no program) is unchanged", async () => {
      const db = dbFor("FULL_FUNDING", { entitlement: true });
      const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_violations");
      assert.ok(
        !db.seen.some((c) => /v_client_entitlements|entitlement/i.test(c.sql)),
        "the writer read entitlements; the repair path must be keyed to the program row"
      );
    });

    test("the active program does not skip the identity wall", async () => {
      // On the repair path with no verified name the writer still refuses.
      const db = dbFor(null, { program: ACTIVE });
      const r = await analyzeAndGenerate(db, {
        orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity: () => null
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "identity_not_verified");
    });

    test("hasActiveRepairProgram reads the status and nothing else", () => {
      assert.equal(hasActiveRepairProgram({ status: "active" }), true);
      for (const status of ["cancelled", "complete", "upsell_pending", "", null, undefined]) {
        assert.equal(hasActiveRepairProgram({ status }), false, String(status));
      }
      assert.equal(hasActiveRepairProgram(null), false);
      assert.equal(hasActiveRepairProgram(undefined), false);
      assert.equal(hasActiveRepairProgram({ program: "full" }), false);
    });
  });
});

/* OWNER DECISION, 2026-09-03, FINAL — the personal-information floor.
   "On EVERY customer on the credit-repair path, on EVERY round, clean file or
   not, ALWAYS run personal-information cleanup." So a spotless file on a
   repair-path client still produces a letter, and a client off that path still
   produces nothing from the same file. */
describe("the personal-information floor", () => {
  /* One bureau, one name, one address, one clean account, one inquiry from the
     creditor of that same account. Nothing here is disputable on its own: the
     Metro 2 engine finds no defect, there is no derogatory item, the name and
     address do not vary and the inquiry is explained by an account on the file. */
  const SPOTLESS_FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [{ firstName: "Sim", middleName: null, lastName: "Repair" }],
          addresses: [{
            addressLine1: "412 Pecan St", city: "Austin", state: "TX",
            postalCode: "78701", borrowerResidencyType: "Current",
            dateReported: "2026-08-01"
          }],
          ssns: [],
          employments: []
        }],
        inquiries: [{
          creditorName: "EXAMPLE BANK NA", inquiryDate: "2026-08-01",
          businessType: "Banking", sourceType: "Experian"
        }],
        tradelines: [{
          creditorName: "EXAMPLE BANK NA",
          accountIdentifier: "5121080011112222",
          accountOpenedDate: "2019-06-12",
          accountReportedDate: "2026-09-01",
          accountOwnershipType: "Individual",
          accountStatusType: "Open",
          accountType: "Revolving",
          currentRatingType: "AsAgreed",
          currentBalanceAmount: "1842",
          pastDueAmount: "0",
          sourceType: "Experian"
        }]
      }
    }
  };

  function dbFor(file, tier, { personalAddress = true } = {}) {
    return fakeDb({
      "outcome_tier FROM clients": [{ outcome_tier: tier }],
      "first_name, last_name": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM pii_identity": personalAddress
        ? [{ addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }] }]
        : [],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: file }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1"
      }],
      "INSERT INTO dispute_items": [{ id: "item-1" }],
      "INSERT INTO dispute_letters": [{ id: "letter-1", bureau: "EX", case_id: "case-1" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("a spotless file on a repair client still produces a cleanup letter", async () => {
    const db = dbFor(SPOTLESS_FILE, "REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
    assert.deepEqual(
      r.letters[0].ruleIds.slice().sort(),
      ["PI-ADDRESS-CONFIRM", "PI-NAME-CONFIRM"]
    );
  });

  test("with NO verified address the letter makes no address claim at all", async () => {
    /* THE BUSINESS ADDRESS IS NOT THE HOME ADDRESS. loadIdentity is allowed to
       fall back to the company street for the letterhead, because an envelope
       needs a reply address. It is not allowed to feed that value to the floor:
       doing so asserted the client's business address as their residence and
       asked the bureau to delete their real one. Nor may the CRM address stand
       in for a verified one — only the proof of address the client uploaded
       counts, and here they uploaded an ID and nothing else. */
    const db = fakeDb({
      "outcome_tier FROM clients": [{ outcome_tier: "REPAIR_ONLY" }],
      "first_name, last_name": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM pii_identity": [],
      "FROM businesses": [{
        entity_data: { address_line1: "204 Horse Blvd", city: "Austin", state: "TX", postal_code: "78701" }
      }],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: SPOTLESS_FILE }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1"
      }],
      "INSERT INTO dispute_items": [{ id: "item-1" }],
      "INSERT INTO dispute_letters": [{ id: "letter-1", bureau: "EX", case_id: "case-1" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
    const r = await analyzeAndGenerate(db, {
      orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity: verifiedNameOnly
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.letters[0].ruleIds, ["PI-NAME-CONFIRM"]);
    const body = r.letters[0].body_text;
    assert.doesNotMatch(body, /My address is/i,
      "a letter may not state an address the client has never given us");
    assert.doesNotMatch(body, /delete "412 Pecan St[^"]*"/,
      "and it may not ask the bureau to delete the address that IS on the file");
    /* The company street may still appear once, as the return address at the
       top of the letter. It may not appear inside a claim. */
    assert.match(body, /204 Horse Blvd/);
  });

  test("the same spotless file off the repair path produces nothing", async () => {
    const db = dbFor(SPOTLESS_FILE, "FULL_FUNDING");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_violations");
  });

  test("one name on the file is never disputed as a second name", async () => {
    const db = dbFor(SPOTLESS_FILE, "REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.ok(!/PI-NAME-CONSOLIDATE/.test(r.letters[0].body_text),
      "a file carrying one name must never be told it carries more than one");
  });
});

/* OWNER RULE, 2026-09-03 — "re-pull the credit file before each round and drop
   from the next round whatever has already been removed." Dropping what was
   removed is automatic: every claim is computed from the newest stored pull, so
   a deleted item is simply not there. The re-pull is not automatic, so Round 2
   and later refuse until a newer pull is on record. */
describe("the re-pull gate between rounds", () => {
  const FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [{ firstName: "Sim", lastName: "Repair" }],
          addresses: [], ssns: [], employments: []
        }],
        inquiries: [],
        tradelines: []
      }
    }
  };

  /* Key order matters: the MAX(created_at) read must be matched before the
     round-letters read, because both queries name `dispute_letters dl`. */
  function dbFor({ pulledAt, priorRoundAt }) {
    return fakeDb({
      "MAX\\(dl\\.created_at\\)": [{ newest: priorRoundAt }],
      "outcome_tier FROM clients": [{ outcome_tier: "REPAIR_ONLY" }],
      "first_name, last_name": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [{ program: "full", rounds_cap: 6, status: "active" }],
      "FROM crs_results": [{ result: FILE, created_at: pulledAt }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-2", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R2"
      }],
      "INSERT INTO dispute_items": [{ id: "item-2" }],
      "INSERT INTO dispute_letters": [{ id: "letter-2", bureau: "EX", case_id: "case-2" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("Round 2 on the same file Round 1 was written from is refused", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2", verifiedIdentity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "credit_file_stale_for_round");
  });

  test("a fresh pull clears it — the refusal is not a lock", async () => {
    const db = dbFor({ pulledAt: "2026-08-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });

  test("Round 1 is never blocked — there is no earlier round to be stale against", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a client with no earlier round is not blocked", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: null });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2", verifiedIdentity });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});


/* ── NO VERIFIED DOCUMENTS, NO CLAIM ABOUT WHO THE CONSUMER IS ─────────────
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * The one name and the one address a letter asserts are read off the client's
 * uploaded government ID and proof of address (src/identity/). Where that read
 * has not happened, the letter says nothing at all about the client's name or
 * address. It does NOT fall back to clients.first_name, to the first row of
 * pii_identity, or to the letterhead's company-address fallback. A dispute
 * letter goes to a credit bureau in a real person's name; asserting an identity
 * on the strength of a typed CRM field is how a client's real address ends up
 * in a deletion list.
 */
describe("no verified identity", () => {
  const CLEAN_FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [{ firstName: "Sim", middleName: null, lastName: "Repair" }],
          addresses: [{
            addressLine1: "412 Pecan St", city: "Austin", state: "TX",
            postalCode: "78701", borrowerResidencyType: "Current",
            dateReported: "2026-08-01"
          }],
          ssns: [], employments: []
        }],
        inquiries: [],
        tradelines: []
      }
    }
  };

  /* Same file, plus one collection, so there is something to dispute even when
     the personal-information floor stays silent. */
  const CLEAN_PLUS_COLLECTION = structuredClone(CLEAN_FILE);
  CLEAN_PLUS_COLLECTION.bureaus.EX.tradelines = [{
    creditorName: "MIDLAND CREDIT MANAGEMENT",
    accountIdentifier: "SIM-MCM-6642",
    accountOpenedDate: "2024-02-20",
    accountReportedDate: "2026-08-28",
    accountOwnershipType: "Individual",
    accountStatusType: "Open",
    accountType: "Open",
    loanType: "CollectionAgencyAttorney",
    businessType: "Collection",
    currentRatingType: "CollectionOrChargeOff",
    currentBalanceAmount: "1840",
    pastDueAmount: "0",
    sourceType: "Experian"
  }];

  /* `tier` decides the repair path: REPAIR_ONLY is on it, FUNDING_READY is not.
     Everything else about the client is identical, so a test can hold the file
     still and move only that. */
  function dbFor(file, { tier = "REPAIR_ONLY" } = {}) {
    return fakeDb({
      "outcome_tier FROM clients": [{ outcome_tier: tier }],
      "first_name, last_name": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM pii_identity": [{
        addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }]
      }],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: file }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1"
      }],
      "INSERT INTO dispute_items": [{ id: "item-1" }],
      "INSERT INTO dispute_letters": [{ id: "letter-1", bureau: "EX", case_id: "case-1" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("a clean file and no verified identity produces NO letter, not a CRM-backed one", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_FILE), {
      orgId: ORG, clientId: CLIENT, round: "R1"
    });
    assert.equal(r.ok, false);
    /* The refusal reason CHANGED 2026-09-06 and the change is the point. It
       used to be `no_violations`, which the Repair desk prints as "the credit
       file looks clean — nothing to dispute". On this client that sentence is
       false in the way that matters: the file may be spotless or a wreck, and
       what is actually missing is the identity read. A Specialist told the file
       is clean closes the case; a Specialist told the ID has not been read goes
       and gets it. Both halves of the owner's rules survive — the floor still
       runs for every repair client, and no letter names anybody on the strength
       of a typed CRM field. */
    assert.equal(r.reason, "identity_not_verified");
  });

  /* The same clean file on a client who is NOT on the repair path. There is no
     floor to be missing an input for, so the honest answer is still that the
     engine found nothing. The new refusal must not leak onto this path. */
  test("off the repair path, a clean file is still plain no_violations", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_FILE, { tier: "FUNDING_READY" }), {
      orgId: ORG, clientId: CLIENT, round: "R1"
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_violations");
  });

  /* CHANGED 2026-09-06, and the change is the whole of finding HIGH 3.
     This test used to assert that a repair client with an unread ID and a real
     collection on the file still got the letter, with the personal-information
     claims simply absent. That was the code's real behaviour and it contradicted
     the sentence shipped beside it, which told the owner such a client "now gets
     NO letter at all". Both could not be true.

     The refusal is the half that was kept, because the letterhead and the
     signature block were still being filled from clients.first_name /
     last_name — a typed form field, not a document. A letter that cannot be
     ADDRESSED truthfully refuses; it does not guess. So the gate moved ahead of
     every letter and no longer depends on the file being clean. */
  test("a real dispute does not ship either, until the ID is read", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_PLUS_COLLECTION), {
      orgId: ORG, clientId: CLIENT, round: "R1"
    });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, "identity_not_verified");
    assert.equal(r.round, "R1");
  });

  test("with the documents read, the same file carries the name and address claims", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_PLUS_COLLECTION), {
      orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(
      r.letters[0].ruleIds,
      ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]
    );
    assert.equal(r.verified_identity, true);
    assert.equal(r.verified_identity_source, "id_document");
    /* HIGH 4. The letterhead and the signature block carry the name the ID
       proved, not the one a closer typed into the CRM. */
    const body = r.letters[0].body_text;
    assert.match(body, /^Sim Repair$/m, body.slice(0, 400));
  });

  /* A verified name and NO accepted proof of address still produces the letter:
     the name is what a bureau matches the file by, and the address claim simply
     is not made. Pins that the gate is on the NAME and not on both. */
  test("a verified name with no proof of address still ships, with no address claim", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_PLUS_COLLECTION), {
      orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity: verifiedNameOnly
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.letters[0].ruleIds, ["DEROG-COLLECTION", "PI-NAME-CONFIRM"]);
    const body = r.letters[0].body_text;
    assert.match(body, /^Sim Repair$/m);
    assert.ok(!/PI-ADDRESS/.test(body), "no address claim without a proof of address");
  });

  /* ── HIGH 4, PROVEN THE ONLY WAY IT CAN BE ────────────────────────────────
   *
   * Every other fixture in this file gives the CRM row and the ID the SAME name
   * ("Sim Repair"), so an assertion on the letterhead there passes whichever
   * source it came from and proves nothing. Here the two disagree: the CRM says
   * "Sim Repair" because that is what a closer typed, and the government ID says
   * "Simone Repair-Vega". The letter is addressed and signed with the ID's name,
   * and the typed one appears nowhere in it. */
  test("the letterhead and signature use the ID's name, not the CRM's", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_PLUS_COLLECTION), {
      orgId: ORG,
      clientId: CLIENT,
      round: "R1",
      verifiedIdentity: () => ({ ...VERIFIED, legalName: "Simone Repair-Vega" })
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const body = r.letters[0].body_text;
    assert.match(body, /^Simone Repair-Vega$/m, body.slice(0, 400));
    /* The signature block prints the name a second time under "Signature:". */
    assert.equal(
      body.split("\n").filter((l) => l.trim() === "Simone Repair-Vega").length,
      2,
      "letterhead and signature block both carry the verified name"
    );
    assert.ok(
      !body.split("\n").some((l) => l.trim() === "Sim Repair"),
      "the typed CRM name is on no line of the letter"
    );
  });

  test("an identity module that throws is treated as no identity, never as a crash", async () => {
    const r = await analyzeAndGenerate(dbFor(CLEAN_PLUS_COLLECTION), {
      orgId: ORG,
      clientId: CLIENT,
      round: "R1",
      verifiedIdentity: () => { throw new Error("identity service down"); }
    });
    /* The point of this test is that the throw is swallowed. A module that is
       down reads as "no identity", which is now a refusal rather than a letter
       with a CRM name on it — but it is still an answer and never an exception. */
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, "identity_not_verified");
  });

  test("ONE name claim per bureau, never two", async () => {
    /* The file carries a name that is not the consumer's. M2-032 in
       ../metro2/checks/personal-info.mjs disputes it by name, and it can fire
       now that the consumer side of the context is supplied. The floor's own
       name claim stands down rather than asking for the same deletion twice —
       ../metro2/diy/personal-info-floor.mjs mergePersonalInfoClaims. */
    const mixedFile = structuredClone(CLEAN_FILE);
    mixedFile.bureaus.EX.creditFiles[0].aliases.push({ firstName: "Simon", lastName: "Repairs" });
    const r = await analyzeAndGenerate(dbFor(mixedFile), {
      orgId: ORG, clientId: CLIENT, round: "R1", verifiedIdentity
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const ids = r.letters[0].ruleIds;
    assert.ok(ids.includes("M2-032"), JSON.stringify(ids));
    assert.equal(ids.filter((id) => /NAME/.test(id)).length, 0, JSON.stringify(ids));
    assert.ok(ids.includes("PI-ADDRESS-CONFIRM"), "the address half is untouched");
  });
});

describe("verifiedAddressLabel", () => {
  test("a string passes through, an object is flattened, nothing is invented", () => {
    assert.equal(verifiedAddressLabel("412 Pecan St, Austin, TX, 78701"),
      "412 Pecan St, Austin, TX, 78701");
    assert.equal(
      verifiedAddressLabel({ line1: "412 Pecan St", city: "Austin", state: "TX", postal: "78701" }),
      "412 Pecan St, Austin, TX, 78701"
    );
    assert.equal(verifiedAddressLabel(null), null);
    assert.equal(verifiedAddressLabel("   "), null);
    assert.equal(verifiedAddressLabel({}), null);
  });

  /* THE SHAPE ../identity/verified.mjs ACTUALLY STORES WHEN THE AGENT ANSWERS
     WITH ONE STRING. `normalizeVerifiedAddress` accepts that — a model reading a
     utility bill answers "412 Pecan St, Austin, TX 78701", not five fields — and
     writes every component null with the whole line in `formatted`. Measured
     2026-09-06: this function read only the components, returned null, and the
     floor made no address claim for a client whose address was verified. */
  test("an address stored only as a formatted line is still an address", () => {
    assert.equal(
      verifiedAddressLabel({
        line1: null, line2: null, city: null, state: null, zip: null,
        formatted: "412 Pecan St, Austin, TX 78701"
      }),
      "412 Pecan St, Austin, TX 78701"
    );
  });

  /* Components win, and `formatted` is never merged into them. A row carrying
     both must not print half of one address and half of another. */
  test("components beat the formatted line, and are never mixed with it", () => {
    assert.equal(
      verifiedAddressLabel({
        line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701",
        formatted: "99 Somewhere Else Rd, Dallas, TX 75201"
      }),
      "412 Pecan St, Austin, TX, 78701"
    );
  });

  /* An empty formatted line is still nothing, and nothing stays null. */
  test("a blank formatted line is unknown, not an empty address", () => {
    assert.equal(verifiedAddressLabel({ formatted: "   " }), null);
    assert.equal(verifiedAddressLabel({ formatted: null }), null);
  });
});

/* THE SEAM WAS NEVER ONCE EXERCISED, AND THAT IS WHY IT WAS BROKEN.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * Every other test in this file hands analyzeAndGenerate a `verifiedIdentity`
 * function of its own, which is the right thing for testing what the letters
 * say. The consequence is that nothing ever asked the question a real client
 * asks: with no override, does this module FIND the identity module?
 *
 * MEASURED 2026-09-06, by running it. It did not. `IDENTITY_MODULES` guessed
 * three paths — index.mjs, verified-identity.mjs, identity.mjs — and the
 * identity lane had landed at `src/identity/verified.mjs`. All three imports
 * threw ERR_MODULE_NOT_FOUND, the resolver answered null, and on every real
 * client the floor's name claim and address claim were dropped and the engine's
 * name, date-of-birth and employment rules stayed dark. The module was built,
 * exporting exactly the function wanted, and nothing reached it.
 *
 * This test is the one that would have caught it: no override, a database stub
 * that answers the way the real table does, and an assertion that the name came
 * back. It fails if the module is renamed or moved again. */
describe("the verified identity is read from the module that actually exists", () => {
  const idDb = (row) => ({
    query: async () => ({ rows: row ? [row] : [] })
  });

  test("with no override, loadVerifiedIdentity reaches src/identity and returns the row", async () => {
    resetVerifiedIdentityCache();
    const got = await loadVerifiedIdentity(
      idDb({
        verified_legal_name: "Sim Repair",
        verified_address: { line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" },
        verified_dob: null,
        verified_by: "doc-check-v1",
        verified_at: "2026-09-01T00:00:00.000Z",
        verified_field_sources: {}
      }),
      { orgId: ORG, clientId: CLIENT }
    );
    assert.ok(got, "null here means no identity module was found — check IDENTITY_MODULES");
    assert.equal(got.legalName, "Sim Repair");
    assert.equal(verifiedAddressLabel(got.address), "412 Pecan St, Austin, TX, 78701");
  });

  test("a client with no verified row is null, and null makes no claim", async () => {
    resetVerifiedIdentityCache();
    const got = await loadVerifiedIdentity(idDb(null), { orgId: ORG, clientId: CLIENT });
    /* Every field null collapses to null in loadVerifiedIdentity, which is what
       the floor reads as "no name and no address are known". Unknown, not
       empty, and certainly not clients.first_name. */
    assert.equal(got, null);
  });
});
