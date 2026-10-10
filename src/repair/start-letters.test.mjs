// Tests for src/repair/start-letters.mjs — the one shared call that starts the
// Repair letter writer, used by both doors:
//   1. repair.docs.complete   (src/repair/handlers.mjs)
//   2. a signed dispute authorization   (api/consent/capture.mjs)
//
// Two kinds of test here.
//   * Unit tests with the writer injected: they prove WHEN the writer is asked.
//   * One run through the REAL writer on a stateful fake database: it proves
//     the story that was broken for the one paying repair client. The writer
//     refuses with `no_authorization`, nothing is saved, the card stays on
//     'analysis'. The client then signs. The letters get made and the card moves.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  startRepairLetters,
  startLettersAfterAuthorization,
  LETTER_WAIT_STAGE
} from "./start-letters.mjs";
import { analyzeAndGenerate } from "./analyze.mjs";
import { onRepairEvent } from "./handlers.mjs";
import { TEMPLATE_BY_EVENT } from "./notify.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/* ── unit tests: when is the writer asked? ──────────────────────────────── */

describe("startRepairLetters", () => {
  const db = { query: async () => ({ rows: [] }) };

  test("asks the writer for round R1 with the ids, the staff id and a document store", async () => {
    let seen = null;
    const store = { name: "fake-store" };
    const out = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT, staffId: STAFF }, {
      analyzeAndGenerate: async (_db, args) => { seen = args; return { ok: true, letters: [] }; },
      storeFromEnv: () => store
    });
    assert.equal(out.ok, true);
    assert.deepEqual(seen, {
      orgId: ORG, clientId: CLIENT, round: "R1", staffId: STAFF, documentStore: store
    });
  });

  test("hands back the writer's refusal untouched", async () => {
    const out = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT }, {
      analyzeAndGenerate: async () => ({ ok: false, reason: "no_authorization" }),
      storeFromEnv: () => null
    });
    assert.deepEqual(out, { ok: false, reason: "no_authorization" });
  });

  test("a writer that throws comes back as a refusal, never as a throw", async () => {
    const out = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT }, {
      analyzeAndGenerate: async () => { throw new Error("storage is down"); },
      storeFromEnv: () => null
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /storage is down/);
  });
});

describe("startLettersAfterAuthorization", () => {
  const db = { query: async () => ({ rows: [] }) };
  const writerThatCounts = () => {
    const state = { calls: 0 };
    return {
      state,
      deps: (stage) => ({
        readRepairStage: async () => stage,
        analyzeAndGenerate: async () => { state.calls++; return { ok: true, letters: [{}] }; },
        storeFromEnv: () => null
      })
    };
  };

  test("a card waiting on analysis runs the writer once", async () => {
    const w = writerThatCounts();
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT, staffId: STAFF }, w.deps("analysis"));
    assert.equal(LETTER_WAIT_STAGE, "analysis");
    assert.equal(out.started, true);
    assert.equal(out.letters.ok, true);
    assert.equal(w.state.calls, 1);
  });

  for (const stage of ["intake", "awaiting_documents", "letters_generated", "ready_to_send", "stalled", "cancelled", null]) {
    test(`a card on ${stage === null ? "no stage at all (not a repair client)" : stage} does nothing`, async () => {
      const w = writerThatCounts();
      const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, w.deps(stage));
      assert.equal(out.started, false);
      assert.equal(out.reason, "card_not_waiting_on_letters");
      assert.equal(w.state.calls, 0, "the writer ran on a card that is not waiting for letters");
    });
  }

  test("missing ids do nothing and do not even read the card", async () => {
    let read = 0;
    const deps = { readRepairStage: async () => { read++; return "analysis"; } };
    assert.equal((await startLettersAfterAuthorization(db, { orgId: ORG }, deps)).started, false);
    assert.equal((await startLettersAfterAuthorization(db, { clientId: CLIENT }, deps)).started, false);
    assert.equal((await startLettersAfterAuthorization(null, { orgId: ORG, clientId: CLIENT }, deps)).started, false);
    assert.equal(read, 0);
  });

  test("a writer that throws never throws out of here", async () => {
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, {
      readRepairStage: async () => "analysis",
      analyzeAndGenerate: async () => { throw new Error("boom"); },
      storeFromEnv: () => null
    });
    assert.equal(out.started, true);
    assert.equal(out.letters.ok, false);
    assert.match(out.letters.reason, /boom/);
  });

  test("a card read that throws never throws out of here", async () => {
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, {
      readRepairStage: async () => { throw new Error("db is down"); },
      analyzeAndGenerate: async () => { throw new Error("must not run"); }
    });
    assert.equal(out.started, false);
    assert.match(out.reason, /db is down/);
  });
});

/* ── the docs door uses the same call ──────────────────────────────────── */

describe("repair.docs.complete goes through the shared call", () => {
  test("onRepairEvent starts the writer for repair.docs.complete and for nothing else", async () => {
    const asked = [];
    const db = {
      query: async (sql, params) => {
        const text = String(sql);
        // moveCardToStage: no stage row -> { moved:false }. Enough for this test.
        asked.push({ text, params });
        return { rows: [] };
      }
    };
    const done = await onRepairEvent(db, {
      name: "repair.docs.complete", orgId: ORG, clientId: CLIENT, payload: { staffId: STAFF }
    });
    // The real writer ran against the empty fake and refused. It is an answer, not a throw.
    assert.ok(done.letters && done.letters.ok === false, JSON.stringify(done.letters));
    assert.equal(done.letters.reason, "no_authorization");

    const other = await onRepairEvent(db, {
      name: "repair.letters.sent", orgId: ORG, clientId: CLIENT, payload: {}
    });
    assert.equal(other.letters, null, "the writer ran for an event that is not repair.docs.complete");
  });
});

/* ── the whole story, through the real writer ─────────────────────────── */

describe("sign after the documents land: refused, then signed, then letters", () => {
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
  const VERIFIED = { legalName: "Sim Repair", address: "412 Pecan St, Austin, TX, 78701", source: "id_document" };

  /* A fake database that REMEMBERS: whether a consent is on file, which stage
     the card is on, and which dispute rows were written. The repair client has
     a paid, active program and nothing signed. */
  function statefulDb({ consent = false, stage = "analysis" } = {}) {
    const s = { consent, stage, writes: [], letters: [], moves: [] };
    const query = async (sql, params) => {
      const text = String(sql);
      if (/INSERT INTO dispute_|INSERT INTO documents/i.test(text)) s.writes.push(text.slice(0, 60));

      // readRepairStage
      if (/SELECT ps\.key AS stage_key/i.test(text)) return { rows: s.stage ? [{ stage_key: s.stage }] : [] };
      // moveCardToStage
      if (/FROM pipeline_stages ps\s+JOIN pipelines p ON p\.id = ps\.pipeline_id\s+WHERE p\.key = \$1 AND ps\.key = \$2/i.test(text)) {
        return { rows: [{ stage_id: params[1], pipeline_id: "pipe-1" }] };
      }
      if (/SELECT id FROM cards WHERE client_id/i.test(text)) return { rows: [{ id: "card-1" }] };
      if (/UPDATE cards SET stage_id/i.test(text)) { s.stage = params[1]; s.moves.push(params[1]); return { rows: [] }; }

      // the writer's gate
      if (/FROM contracts/i.test(text)) return { rows: [] };
      if (/FROM client_consents/i.test(text)) return { rows: s.consent ? [{ is_valid: true }] : [] };
      if (/FROM repair_programs/i.test(text)) return { rows: [{ program: "full", rounds_cap: 6, status: "active" }] };

      // what the writer reads and writes
      if (/FROM dispute_letters dl\s+JOIN dispute_cases dc ON dc\.id = dl\.case_id\s+WHERE dl\.org_id = \$1::uuid AND dl\.client_id = \$2::uuid\s+AND dc\.round = \$3/i.test(text)) {
        return { rows: s.letters };
      }
      if (/first_name, last_name/i.test(text)) return { rows: [{ first_name: "Sim", last_name: "Repair" }] };
      if (/FROM pii_identity/i.test(text)) {
        return { rows: [{ addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }] }] };
      }
      if (/FROM crs_results/i.test(text)) return { rows: [{ result: DAMAGED_FILE, created_at: "2026-09-03T00:00:00Z" }] };
      if (/INSERT INTO dispute_cases/i.test(text)) {
        return { rows: [{ id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1" }] };
      }
      if (/INSERT INTO dispute_items/i.test(text)) return { rows: [{ id: "item-1" }] };
      if (/INSERT INTO dispute_letters/i.test(text)) {
        const row = { id: "letter-1", bureau: "EX", case_id: "case-1", body_text: "x", rule_ids: [] };
        s.letters.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    };
    return { s, db: { query } };
  }

  /* The real writer, with the verified identity handed in the way the
     existing analyze tests do (src/identity is another lane's module). */
  const deps = {
    analyzeAndGenerate: (db, args) => analyzeAndGenerate(db, { ...args, verifiedIdentity: () => VERIFIED }),
    storeFromEnv: () => null
  };

  test("PASS: refused with nothing signed, then signing makes the letters and moves the card", async () => {
    const { s, db } = statefulDb({ consent: false, stage: "analysis" });

    // Door 1: the documents land. Nothing is signed, so the writer refuses.
    const first = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.deepEqual(first, { ok: false, reason: "no_authorization" });
    assert.equal(s.writes.length, 0, "a refusal saved something");
    assert.equal(s.stage, "analysis", "a refusal moved the card");
    assert.equal(s.letters.length, 0);

    // The client signs the portal box. The consent row now exists.
    s.consent = true;

    // Door 2: the signature starts the letters.
    const second = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(second.started, true);
    assert.equal(second.letters.ok, true, JSON.stringify(second.letters));
    assert.ok(s.letters.length >= 1, "no letter was saved");
    assert.deepEqual(s.moves, ["letters_generated", "ready_to_send"], "the card did not move through the letter stages");
    assert.equal(s.stage, "ready_to_send");
  });

  test("PASS: asking the writer twice does not make a second set", async () => {
    const { s, db } = statefulDb({ consent: true, stage: "analysis" });
    const first = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(first.ok, true, JSON.stringify(first));
    const writesAfterFirst = s.writes.length;
    const second = await startRepairLetters(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(second.ok, true);
    assert.equal(second.already_generated, true);
    assert.equal(s.writes.length, writesAfterFirst, "the second call wrote more rows");
  });

  test("FAIL twin: a card that is not on analysis gets no letters from a signature", async () => {
    const { s, db } = statefulDb({ consent: true, stage: "awaiting_documents" });
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(out.started, false);
    assert.equal(s.writes.length, 0);
    assert.equal(s.stage, "awaiting_documents");
  });

  test("FAIL twin: a client with no repair card gets no letters from a signature", async () => {
    const { s, db } = statefulDb({ consent: true, stage: null });
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(out.started, false);
    assert.equal(s.writes.length, 0);
  });

  test("FAIL twin: on the analysis card with the consent missing, the writer still refuses and saves nothing", async () => {
    const { s, db } = statefulDb({ consent: false, stage: "analysis" });
    const out = await startLettersAfterAuthorization(db, { orgId: ORG, clientId: CLIENT }, deps);
    assert.equal(out.started, true);
    assert.equal(out.letters.reason, "no_authorization");
    assert.equal(s.writes.length, 0);
    assert.equal(s.stage, "analysis");
  });

  test("making the letters queues no email to the client", () => {
    // The writer fires these two events. If either ever gets an email template,
    // signing would start emailing the client. That is a decision for Chris.
    assert.equal(TEMPLATE_BY_EVENT["repair.analysis.complete"], undefined);
    assert.equal(TEMPLATE_BY_EVENT["repair.letters.ready"], undefined);
    assert.equal(TEMPLATE_BY_EVENT["repair.docs.complete"], undefined);
  });
});
