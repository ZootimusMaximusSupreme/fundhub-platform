// finish-853 batch 08: POST /api/repair/generate. The real handler, the real credit-file analysis,
// the real letter writer, the real case store and the real card mover run over stand-in tables that
// answer by the client and company each statement names, with a recording stand-in for the letter
// file store. The row's words: analyses a client's stored credit file and stores the dispute letters
// it supports (cases, items, letters, saved letter files) and moves the repair card; mails
// nothing; honest refusals answer 200 ok:false. Practice test, fake data, no network, no database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/repair/generate.mjs";
import { makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { fakeDb } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const PIPE = "0b110000-0000-4000-8000-000000000001";
const STAGES = [
  { id: "57a60000-0000-4000-8000-000000000001", pipeline_id: PIPE, org_id: ORG_ID, key: "analysis", pipeline_key: "optimization" },
  { id: "57a60000-0000-4000-8000-000000000002", pipeline_id: PIPE, org_id: ORG_ID, key: "letters_generated", pipeline_key: "optimization" },
  { id: "57a60000-0000-4000-8000-000000000003", pipeline_id: PIPE, org_id: ORG_ID, key: "ready_to_send", pipeline_key: "optimization" },
];
const FILE = {
  bureausPulled: ["EX"],
  bureaus: { EX: {
    creditFiles: [{ creditFileDetail: { creditFileInfileDate: "2026-09-03", creditFileResultStatusType: "FileReturned", sourceType: "Experian" } }],
    inquiries: [],
    tradelines: [{
      creditorName: "MIDLAND CREDIT MANAGEMENT", accountIdentifier: "SIM-MCM-6642", accountOpenedDate: "2024-02-20", accountReportedDate: "2026-08-28",
      accountOwnershipType: "Individual", accountStatusType: "Open", accountType: "Open", loanType: "CollectionAgencyAttorney", businessType: "Collection",
      currentRatingType: "CollectionOrChargeOff", currentBalanceAmount: "1840", pastDueAmount: "0", sourceType: "Experian",
    }],
  } },
};
const realFetch = globalThis.fetch;
const asked = [];
before(() => { globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

function repairFile({ agreement = true, consent = false, verified = true, pull = FILE, cases = [], pulledAt = "2026-09-03T00:00:00Z", tier = "REPAIR_ONLY", olderPull = null } = {}) {
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG_ID, first_name: "Sim", last_name: "Repair", outcome_tier: tier },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Foreign", last_name: "Person", outcome_tier: tier },
    ],
    // The older pull is stored FIRST, so only the statement's own ORDER BY ... LIMIT 1 puts the newest one on top.
    crs_results: pull ? [
      ...(olderPull ? [{ id: "p0", org_id: ORG_ID, client_id: CLIENT, result: olderPull, created_at: "2026-06-01T00:00:00Z" }] : []),
      { id: "p1", org_id: ORG_ID, client_id: CLIENT, result: pull, created_at: pulledAt },
    ] : [],
    pii_identity: [{
      org_id: ORG_ID, client_id: CLIENT, addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }],
      ...(verified ? { verified_legal_name: "Sim Repair", verified_address: { line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" },
        verified_dob: null, verified_by: "doc-check", verified_at: "2026-09-01T00:00:00Z", verified_field_sources: {} } : {}),
    }],
    contracts: agreement ? [{ id: "k1", org_id: ORG_ID, client_id: CLIENT, status: "signed" }] : [],
    client_consents: consent ? [{ id: "cc1", org_id: ORG_ID, client_id: CLIENT, kind: "dispute_authorization", is_valid: true, granted_at: "2026-09-01T00:00:00Z" }] : [],
    dispute_cases: cases.map((c, i) => ({ id: `ca00000${i}-0000-4000-8000-000000000000`, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", status: "open", ...c })),
    dispute_items: [], dispute_letters: [], documents: [], document_versions: [], cards: [],
  };
  const stored = [];
  const store = { put: async (arg) => { stored.push({ filename: arg && arg.filename, kind: arg && arg.kind, orgId: arg && arg.orgId, clientId: arg && arg.clientId, html: String((arg && arg.body) || "") }); return { key: `store/${arg && arg.filename}` }; }, get: async () => null };
  const fake = tablesDb({
    tables,
    autoInsert: true,
    rules: [
      [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map(() => ({ "?column?": 1 }))],
      [/^\s*SELECT first_name, last_name FROM clients/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1])],
      [/^\s*SELECT outcome_tier FROM clients/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map((c) => ({ outcome_tier: c.outcome_tier }))],
      [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id\s+FROM pipeline_stages ps/i, (_s, p) => STAGES.filter((s) => s.pipeline_key === p[0] && s.key === p[1] && s.org_id === p[2])
        .map((s) => ({ stage_id: s.id, pipeline_id: s.pipeline_id }))],
      [/^\s*SELECT id FROM cards WHERE client_id = \$1 AND pipeline_id = \$2/i, (_s, p) => tables.cards.filter((c) => c.client_id === p[0] && c.pipeline_id === p[1]).map((c) => ({ id: c.id }))],
      [/^\s*UPDATE cards SET stage_id = \$2 WHERE id = \$1/i, (_s, p) => { const c = tables.cards.find((x) => x.id === p[0]); if (c) c.stage_id = p[1]; return { rows: [], rowCount: 1 }; }],
      [/^\s*INSERT INTO cards \(org_id, client_id, pipeline_id, stage_id\)/i, (_s, p) => { tables.cards.push({ id: `k${tables.cards.length + 1}`, org_id: p[0], client_id: p[1], pipeline_id: p[2], stage_id: p[3] }); return { rows: [], rowCount: 1 }; }],
      [/^\s*SELECT dc\.id, dc\.org_id, dc\.client_id, dc\.bureau, dc\.round,/i, []],
      [/^\s*SELECT MAX\(dl\.created_at\) AS newest/i, (_s, p) => {
        const rows = tables.dispute_letters.filter((l) => l.org_id === p[0] && l.client_id === p[1] && p[2].includes(l.round) && (l.target || "bureau") === "bureau");
        return [{ newest: rows.map((l) => l.created_at).sort().at(-1) || null }];
      }],
    ],
  });
  return { fake, tables, store, stored };
}

async function call(body, file, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: file.fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : file.fake.query(sql, params)),
    connect: () => file.fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res, { db: combined, documentStore: file.store }));
  return { res, file };
}

describe("POST /api/repair/generate", () => {
  test("a repair client's stored credit file is turned into one saved letter per bureau, with its case, its items and its letter file", async () => {
    const file = repairFile();
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.round, "R1");
    assert.equal(res.body.letters.length, 1);
    assert.equal(res.body.letters[0].bureau, "EX");
    assert.deepEqual(res.body.letters[0].ruleIds, ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    assert.equal(file.tables.dispute_cases.length, 1);
    assert.deepEqual([file.tables.dispute_cases[0].org_id, file.tables.dispute_cases[0].client_id, file.tables.dispute_cases[0].bureau, file.tables.dispute_cases[0].round],
      [ORG_ID, CLIENT, "EX", "R1"]);
    assert.equal(file.tables.dispute_items.length, 3);
    assert.ok(file.tables.dispute_items.every((i) => i.case_id === file.tables.dispute_cases[0].id && i.client_id === CLIENT));
    assert.equal(file.tables.dispute_letters.length, 1);
    const letter = file.tables.dispute_letters[0];
    assert.equal(letter.status, "generated");
    assert.equal(letter.bureau, "EX");
    assert.match(letter.body_text, /MIDLAND CREDIT MANAGEMENT/);
    assert.match(letter.body_text, /Sim Repair/);
    assert.deepEqual(letter.rule_ids, ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    assert.equal(file.stored.length, 1, "the letter file is saved");
    assert.deepEqual([file.stored[0].filename, file.stored[0].kind, file.stored[0].orgId, file.stored[0].clientId], ["EX_R1_bureau.html", "deliverable", ORG_ID, CLIENT]);
    assert.match(file.stored[0].html, /Sim Repair/);
  });

  test("when the client has two stored credit files the newest one is the one analysed", async () => {
    const older = JSON.parse(JSON.stringify(FILE));
    older.bureaus.EX.tradelines[0].creditorName = "OLDER FURNISHER LLC";
    older.bureaus.EX.tradelines[0].accountIdentifier = "SIM-OLD-1001";
    const file = repairFile({ olderPull: older });
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    const letter = file.tables.dispute_letters[0];
    assert.match(letter.body_text, /MIDLAND CREDIT MANAGEMENT/);
    assert.doesNotMatch(letter.body_text, /OLDER FURNISHER/);
    assert.deepEqual(file.fake.calls.find((c) => /FROM crs_results/.test(c.sql)).params, [CLIENT, ORG_ID]);
  });

  test("it mails nothing: no web call, no mail provider, and the letter is saved as generated, never sent", async () => {
    const file = repairFile();
    asked.length = 0;
    await call({ client_id: CLIENT }, file);
    assert.deepEqual(asked, []);
    assert.equal(file.tables.dispute_letters.every((l) => l.status === "generated"), true);
    for (const c of file.fake.calls) assert.doesNotMatch(c.sql, /INSERT INTO messages|mailed_at|provider_id/i);
  });

  test("it moves the repair card to ready to send, on this company's board", async () => {
    const file = repairFile();
    await call({ client_id: CLIENT }, file);
    assert.equal(file.tables.cards.length, 1);
    assert.deepEqual([file.tables.cards[0].org_id, file.tables.cards[0].client_id, file.tables.cards[0].pipeline_id, file.tables.cards[0].stage_id],
      [ORG_ID, CLIENT, PIPE, STAGES[2].id]);
  });

  test("the same round again hands back the letters already made and writes nothing new", async () => {
    const file = repairFile();
    await call({ client_id: CLIENT }, file);
    const again = await call({ client_id: CLIENT, round: "R1" }, file);
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.already_generated, true);
    assert.equal(file.tables.dispute_cases.length, 1);
    assert.equal(file.tables.dispute_letters.length, 1);
    assert.equal(file.tables.dispute_items.length, 3);
  });

  test("honest refusals answer 200 with ok:false and words: no credit file, no authorization, ID not read, nothing to dispute", async () => {
    const cases = [
      [repairFile({ pull: null }), "no_credit_file", /No credit file on record/],
      [repairFile({ agreement: false }), "no_authorization", /No signed repair agreement/],
      [repairFile({ verified: false }), "identity_not_verified", /ID has not been read yet/],
      // Authorised by a staff dispute consent only, on a funding-only file: nothing the repair path would write.
      [repairFile({ agreement: false, consent: true, tier: "FULL_FUNDING" }), "no_violations", /nothing to dispute/],
    ];
    for (const [file, reason, words] of cases) {
      const { res } = await call({ client_id: CLIENT }, file);
      assert.equal(res.statusCode, 200, reason);
      assert.equal(res.body.ok, false, reason);
      assert.equal(res.body.reason, reason);
      assert.match(res.body.message, words);
      assert.equal(file.tables.dispute_cases.length + file.tables.dispute_letters.length, 0, `${reason}: nothing is written`);
      assert.equal(file.stored.length, 0);
    }
  });

  test("with no round named it works out the next one from the cases the client already has; round 2 on the same file is refused as stale", async () => {
    const file = repairFile({ cases: [{ round: "R1" }] });
    // An earlier round's letter exists, newer than the credit file: Round 2 needs a fresh pull.
    file.tables.dispute_letters.push({ id: "old-letter", org_id: ORG_ID, client_id: CLIENT, case_id: "ca000000-0000-4000-8000-000000000000", bureau: "EX", round: "R1", status: "sent", target: "bureau", created_at: "2026-09-10T00:00:00Z", body_text: "old", rule_ids: [] });
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.round, "R2");
    assert.equal(res.body.reason, "credit_file_stale_for_round");
    assert.equal(file.tables.dispute_cases.length, 1, "nothing new was written");
  });

  test("a client who has already been through the last round is told so with 409, and a round that does not exist is 400", async () => {
    const file = repairFile({ cases: [{ round: "R6" }] });
    const done = await call({ client_id: CLIENT }, file);
    assert.equal(done.res.statusCode, 409);
    assert.equal(done.res.body.error, "rounds_exhausted");
    const bad = await call({ client_id: CLIENT, round: "R9" }, repairFile());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_round");
  });

  test("a client of another company is 404 and nothing is read or written for them", async () => {
    const file = repairFile();
    const { res } = await call({ client_id: FOREIGN_CLIENT }, file);
    assert.equal(res.statusCode, 404);
    assert.equal(file.tables.dispute_cases.length, 0);
    assert.equal(file.fake.calls.filter((c) => /FROM crs_results/.test(c.sql)).length, 0);
  });

  test("only owner, admin, closer and inquiry specialist may stage letters; a client login and no login are refused", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const file = repairFile();
      const { res } = await call({ client_id: CLIENT }, file, [staffSession({ role })]);
      if (res.statusCode === 403) assert.equal(file.tables.dispute_cases.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "inquiry_specialist", "owner"]);
    const client = await call({ client_id: CLIENT }, repairFile(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 401);
    const missing = await call({}, repairFile());
    assert.equal(missing.res.statusCode, 400);
    assert.equal(missing.res.body.error, "client_id_required");
  });
});
