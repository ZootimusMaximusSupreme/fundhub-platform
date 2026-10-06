// Postgres-backed tests for POST /api/repair/generate.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12). The handler is imported
// from here instead, and imported INSIDE before() so that "no DATABASE_URL" is a
// real skip rather than a module-load failure.
//
// WHY IT EXISTS. src/metro2/rounds/store.mjs holds the only three INSERTs into
// dispute_cases, dispute_items and dispute_letters, and nothing in the repo
// called any of them. src/repair/cases.mjs decides `can_send` by counting
// dispute_letters rows, so the Repair desk was permanently empty and not one
// dispute letter had ever been produced. The seam being tested here is that
// writer.
//
// These tests assert against STORED ROWS, not response shapes. "A letter was
// generated" is a fact about dispute_letters, not about a JSON body — and the
// two refusal tests assert the ABSENCE of rows, because the expensive failure
// mode for this endpoint is inventing a dispute for a client who has none.
//
// Run it against a scratch database, never production:
//   DATABASE_URL="postgres://…/fundhub_t4" node --test src/http/repair-generate.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { listRepairCases } from "../repair/cases.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const EMAIL = "repair_generate_pg_test@example.com";
const STAFF_EMAIL = "repair_generate_pg_staff@example.com";
const OTHER_STAFF_EMAIL = "repair_generate_pg_closer@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/* A stored Equifax pull that the Metro 2 engine really does find violations in:
   an account whose Date of Account Information is 790 days stale (M2-005) and
   the same creditor pulling twice on one day (M2-036). Shape copied from
   src/metro2/diy/from-crs.test.mjs, which is the fixture the engine's own tests
   use — not invented here, so a change to the engine breaks this honestly. */
function equifaxReport(over = {}) {
  return {
    requestedBureaus: { transunion: false, experian: false, equifax: true },
    responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
    creditFiles: [
      {
        creditFileDetail: {
          creditFileInfileDate: "2026-03-01",
          creditFileResultStatusType: "FileReturned",
          sourceType: "Equifax"
        }
      }
    ],
    inquiries: over.inquiries ?? [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
    ],
    tradelines: over.tradelines ?? [
      {
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountOwnershipType: "Individual",
        accountReportedDate: "2024-01-01",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }
    ]
  };
}

/* The same file with the two defects removed: reported three days before the
   pull, and a single inquiry. The engine finds nothing, which is the ordinary
   outcome for a clean report and must NOT produce a letter. */
function cleanReport() {
  return equifaxReport({
    inquiries: [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2026-02-01", businessType: "Finance", sourceType: "Equifax" }
    ],
    tradelines: [
      {
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountOwnershipType: "Individual",
        accountReportedDate: "2026-02-25",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }
    ]
  });
}

describe("POST /api/repair/generate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, orgId, staffId, otherStaffId, token, otherToken, clientId;

  const post = async (body, tok = token) => {
    const r = res();
    await handler(
      { method: "POST", body, headers: { authorization: "Bearer " + tok } },
      r
    );
    return r;
  };

  /* Client-only cleanup, called before each test. events.client_id is a plain
     foreign key with NO cascade, so those rows go first or the DELETE fails with
     23503. dispute_cases / dispute_items / dispute_letters / crs_results /
     pii_identity / cards all cascade from clients. */
  async function wipeClient() {
    await db.query(
      `DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    await db.query(
      `DELETE FROM repair_decision_log WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);

      /* contracts carries trg_contracts_no_delete — "contracts are never
         deleted, void it instead". A test wipe is the one place that has to get
         past it, the same way lifecycle.pg.test.mjs:48 and tamper.pg.test.mjs:64
         already do. Without this the wipe threw, before() never finished, and
         all five tests in this file died together. Re-enabled in a finally so a
         failure cannot leave the guard off for the rest of the run. */
      await db.query(`ALTER TABLE contracts DISABLE TRIGGER trg_contracts_no_delete`).catch(() => {});
      try {
        await db.query(
          `DELETE FROM contracts WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
      } finally {
        await db.query(`ALTER TABLE contracts ENABLE TRIGGER trg_contracts_no_delete`).catch(() => {});
      }
    /* documents.client_id is RESTRICT and documents refuse DELETE
       (trg_documents_no_delete, 030_documents.sql). Rows a generate saved for
       this client have to go first, past the guard the same way
       src/contracts/lifecycle.pg.test.mjs does, or the client DELETE below
       fails with 23503 and every later test dies in this wipe (CI, 2026-10-05).
       Re-enabled in a finally so a failure cannot leave either guard off. */
    await db.query(`ALTER TABLE document_versions DISABLE TRIGGER trg_document_versions_no_delete`).catch(() => {});
    await db.query(`ALTER TABLE documents DISABLE TRIGGER trg_documents_no_delete`).catch(() => {});
    try {
      await db.query(
        `UPDATE documents SET current_version_id = NULL
          WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
      await db.query(
        `DELETE FROM document_versions WHERE document_id IN
           (SELECT d.id FROM documents d JOIN clients c ON c.id = d.client_id WHERE c.email = $1)`, [EMAIL]);
      await db.query(
        `DELETE FROM documents WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    } finally {
      await db.query(`ALTER TABLE documents ENABLE TRIGGER trg_documents_no_delete`).catch(() => {});
      await db.query(`ALTER TABLE document_versions ENABLE TRIGGER trg_document_versions_no_delete`).catch(() => {});
    }
    await db.query(
      `DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  }

  async function wipeAll() {
    await wipeClient();
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email = ANY($1::text[]))`,
      [[STAFF_EMAIL, OTHER_STAFF_EMAIL]]);
    await db.query(`DELETE FROM staff WHERE email = ANY($1::text[])`, [[STAFF_EMAIL, OTHER_STAFF_EMAIL]]);
  }

  /* A client with a real name and a real postal address. Both come from the
     fixture, never from the module under test — the whole point is that a name
     is never fabricated when one is absent. */
  /* `verified` is the state of the DOC-CHECK read, and it is a separate axis
     from `withAddress`. src/identity/verified.mjs holds what a government ID and
     a proof of address actually proved, and src/repair/analyze.mjs quotes ONLY
     that — never clients.first_name, never pii_identity.addresses[0]. So a
     client can have an address typed into the CRM and still have no address a
     letter may state.
       "both"  ID and proof of address both accepted — the ordinary repair client
       "name"  ID accepted, no proof of address yet
       "none"  nothing read yet, which is a refusal and not a clean file */
  async function buildClient({
    result = null, withAddress = true, name = ["Real", "Person"],
    authorized = true, agreement, verified = "both"
  } = {}) {
    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,$4) RETURNING id`, [orgId, EMAIL, name[0], name[1]]
    )).rows[0].id;
    const verifiedName = verified === "none" ? null : `${name[0]} ${name[1]}`;
    const verifiedAddress = verified === "both"
      ? JSON.stringify({ line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" })
      : null;
    if (withAddress || verifiedName || verifiedAddress) {
      await db.query(
        `INSERT INTO pii_identity
           (org_id, client_id, addresses, verified_legal_name, verified_address, verified_by, verified_at)
         VALUES ($1,$2,$3::jsonb,$4::text,$5::jsonb,$6::text,
                 CASE WHEN $4::text IS NULL AND $5::jsonb IS NULL THEN NULL ELSE now() END)`,
        [orgId, clientId, JSON.stringify(withAddress ? [
          { address_line1: "412 Pecan St", address_city: "Austin", address_state: "TX", address_zip: "78701" }
        ] : []),
        verifiedName, verifiedAddress,
        verifiedName || verifiedAddress ? "doc-check-v1" : null]
      );
    }
    if (authorized) {
      await db.query(
        `INSERT INTO client_consents (
           org_id, client_id, kind, consent_version, consent_text,
           capture_method, granted_name, granted_by_kind, granted_by_staff_id
         ) VALUES (
           $1::uuid, $2::uuid, 'dispute_authorization', 'dispute-auth-v1',
           'I authorize Fundhub to prepare dispute letters for my review.',
           'typed', $3, 'staff', $4::uuid
         )`,
        [orgId, clientId, `${name[0]} ${name[1]}`, staffId]
      );
    }
    const hasAgreement = agreement !== undefined ? agreement : authorized;
    if (hasAgreement) {
      let tpl = (await db.query(
        `SELECT id, template_key FROM contract_templates
          WHERE org_id = $1::uuid
            AND (subtype = 'credit_repair' OR template_key ILIKE '%REPAIR%')
          LIMIT 1`,
        [orgId]
      )).rows[0];
      if (!tpl) {
        tpl = (await db.query(
          `INSERT INTO contract_templates
             (org_id, template_key, name, kind, subtype, body, created_by)
           VALUES (
             $1::uuid, 'CREDIT-REPAIR-AGREEMENT', 'Credit repair agreement',
             'contract', 'credit_repair', 'Repair agreement body', $2::uuid
           )
           RETURNING id, template_key`,
          [orgId, staffId]
        )).rows[0];
      }
      await db.query(
        `INSERT INTO contracts (
           org_id, client_id, template_id, template_key, title, kind, subtype,
           status, created_by, rendered_body, body_sha, sent_at, signed_at, signer_name
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4, 'Credit repair agreement',
           'contract', 'credit_repair', 'signed', $5::uuid,
           'Signed repair agreement', $6, now(), now(), $7
         )`,
        [orgId, clientId, tpl.id, tpl.template_key, staffId,
         "sha256:" + "ab".repeat(32), `${name[0]} ${name[1]}`]
      );
    }
    if (result) {
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3::jsonb)`,
        [orgId, clientId, JSON.stringify(result)]
      );
    }
    return clientId;
  }

  const countRows = async (table) => Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE client_id = $1::uuid`, [clientId]
  )).rows[0].n);

  before(async () => {
    ({ default: handler } = await import("../../api/repair/generate.mjs"));
    await wipeAll();
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'PG Specialist','inquiry_specialist',$2,'active') RETURNING id`,
      [orgId, STAFF_EMAIL]
    )).rows[0].id;
    ({ token } = await createSession(db, { staffId, orgId }));

    otherStaffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'PG Setter','setter',$2,'active') RETURNING id`,
      [orgId, OTHER_STAFF_EMAIL]
    )).rows[0].id;
    ({ token: otherToken } = await createSession(db, { staffId: otherStaffId, orgId }));
    assert.ok(otherStaffId);
  });

  after(async () => {
    await wipeAll();
    await close();
  });

  test("no dispute authorization: refuses before looking at the credit file", async () => {
    await wipeClient();
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } },
      authorized: false
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_authorization");
    assert.equal(await countRows("dispute_letters"), 0);
  });

  test("staff consent without a signed repair agreement still writes letters", async () => {
    await wipeClient();
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } },
      authorized: true,
      agreement: false
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(await countRows("dispute_letters"), 1);
  });

  test("no credit file on record: refuses, and writes no dispute rows at all", async () => {
    await wipeClient();
    await buildClient({ result: null });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_credit_file",
      "a client with no pull must be refused, never given an invented file");

    assert.equal(await countRows("dispute_cases"), 0, "no case may exist without a credit file");
    assert.equal(await countRows("dispute_items"), 0);
    assert.equal(await countRows("dispute_letters"), 0);
  });

  /* OWNER DECISION, 2026-09-03, FINAL. This test used to assert that a clean
     credit file produced NOTHING. It no longer does, and the change is the
     point: "on EVERY customer on the credit-repair path, on EVERY round, clean
     file or not, ALWAYS run personal-information cleanup." buildClient's default
     puts a signed repair agreement on the client, so this client IS on the
     repair path and the floor fires.

     The protection the old test existed for has not been dropped — it moved to
     the test directly below, which is the same clean file on a client who is NOT
     on the repair path, and still writes nothing at all. */
  test("a clean credit file on a repair client still gets the cleanup letter", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: cleanReport() } } });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(await countRows("dispute_letters"), 1,
      "a repair customer with a spotless file still gets personal-information cleanup");

    const items = await db.query(
      `SELECT rule_id FROM dispute_items WHERE client_id = $1::uuid ORDER BY rule_id`, [clientId]);
    assert.deepEqual(items.rows.map((i) => i.rule_id),
      ["PI-ADDRESS-CONFIRM", "PI-NAME-CONFIRM"],
      "on a tidy file the floor CONFIRMS one name and one address — it never "
      + "disputes a second name or address that is not there");

    const letters = await db.query(
      `SELECT body_text FROM dispute_letters WHERE client_id = $1::uuid`, [clientId]);
    assert.doesNotMatch(letters.rows[0].body_text, /more than one name/i,
      "this file carries no second name and the letter must not say it does");
    assert.doesNotMatch(letters.rows[0].body_text, /Metro 2/,
      "no Metro 2 defect is claimed, so the letter must not say one is");

    /* THE LETTER ITSELF, NOT JUST THE CLAIMS INSIDE IT. Both claims here say
       the file is CORRECT, so nothing in the letter may tell the bureau the
       file is inaccurate or demand that it be corrected. A letter cannot say
       "these two things are right, please fix them". */
    const body = letters.rows[0].body_text;
    assert.doesNotMatch(body, /inaccurat/i,
      "every claim in this letter says the file is right — it may not call the file inaccurate");
    assert.doesNotMatch(body, /reporting error|defect/i);
    assert.doesNotMatch(body, /Delete or correct each item/i,
      "it may not demand correction of the items it has just confirmed");
    assert.doesNotMatch(body, /Violation PI-/,
      "a claim that says the file is correct is not a violation and is not headed as one");
    assert.match(body, /Request PI-NAME-CONFIRM/);
    assert.match(body, /Re: Round 1 FCRA personal information confirmation/,
      "the subject line must say what the letter is");
    assert.doesNotMatch(body, /\{"/, "no raw data blob may appear in a mailed letter");
  });

  test("a repair client with NO address on record: the letter claims nothing about an address", async () => {
    /* The letterhead may fall back to a company address because the envelope
       needs a reply address. Nothing INSIDE the letter may assert that the
       company's street is where the client lives, and the client's real
       addresses on the file may not be put in a delete list. */
    await wipeClient();
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: cleanReport() } },
      withAddress: false,
      /* ID accepted, proof of address not. This is the condition that matters:
         an address typed into the CRM is not an address a letter may state, so
         "no address on record" means no VERIFIED address. */
      verified: "name"
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body));

    const items = await db.query(
      `SELECT rule_id FROM dispute_items WHERE client_id = $1::uuid ORDER BY rule_id`, [clientId]);
    assert.deepEqual(items.rows.map((i) => i.rule_id), ["PI-NAME-CONFIRM"],
      "the name cleanup still happens; the address claim does not, because we do not know the address");

    const letters = await db.query(
      `SELECT body_text FROM dispute_letters WHERE client_id = $1::uuid`, [clientId]);
    assert.doesNotMatch(letters.rows[0].body_text, /My address is/i,
      "a letter may not state an address the client has never given us");
  });

  /* THE STATE THE VERIFIED-IDENTITY RULE CREATED, AND WHAT IT MUST SAY.
     A repair client whose government ID has not been read yet gets no letter,
     because a mailed dispute may not name a person on the strength of a field
     a closer typed. That is correct. What it may NOT do is answer
     "the credit file looks clean" — the file is not the problem, and a
     Specialist reading that would close the case. */
  test("a repair client whose ID has not been read is refused by NAME, not called clean", async () => {
    await wipeClient();
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: cleanReport() } },
      verified: "none"
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false, JSON.stringify(r.body));
    assert.equal(r.body.reason, "identity_not_verified", JSON.stringify(r.body));
    assert.match(r.body.message, /ID has not been read/i,
      "the desk is told what is missing, not that the file is clean");
    assert.equal(await countRows("dispute_letters"), 0);
    assert.equal(await countRows("dispute_items"), 0,
      "nothing is written when there is nothing we may truthfully claim");
  });

  test("the same clean file, a client NOT on the repair path: writes nothing", async () => {
    await wipeClient();
    /* Staff dispute authorization, but no signed repair agreement and no repair
       outcome tier — so this client is not on the repair path. */
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: cleanReport() } },
      authorized: true,
      agreement: false,
      /* Verified, so the refusal below can only be about the repair path and
         never about a missing identity read. */
      verified: "both"
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_violations",
      "finding nothing is a legitimate outcome and must not be dressed up as a success");

    assert.equal(await countRows("dispute_letters"), 0,
      "no rule-backed finding means no letter — a letter here would be an invented dispute");
    assert.equal(await countRows("dispute_cases"), 0);
  });

  test("a file with real violations: case, items and letter rows really exist", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body));

    const cases = await db.query(
      `SELECT id, bureau, round, status FROM dispute_cases WHERE client_id = $1::uuid`, [clientId]);
    assert.equal(cases.rows.length, 1, "one bureau had findings, so one case");
    assert.equal(cases.rows[0].bureau, "EQ");
    assert.equal(cases.rows[0].round, "R1");

    const items = await db.query(
      `SELECT rule_id, severity FROM dispute_items WHERE client_id = $1::uuid ORDER BY rule_id`, [clientId]);
    assert.ok(items.rows.length >= 2, "the engine's findings are stored as items");
    assert.ok(items.rows.every((i) => i.rule_id && i.severity),
      "every stored item carries a rule id and a severity — nothing is filed without one");

    const letters = await db.query(
      `SELECT id, bureau, status, body_text, rule_ids, fingerprint
         FROM dispute_letters WHERE client_id = $1::uuid`, [clientId]);
    assert.equal(letters.rows.length, 1, "one letter row was really written");
    const letter = letters.rows[0];
    assert.equal(letter.status, "generated");
    assert.ok(letter.body_text.length > 200, "the letter has a real body");
    assert.ok(letter.rule_ids.length >= 2, "the letter names the rules it claims");
    assert.match(letter.body_text, /Real Person/,
      "the letter carries the client's real name from the clients row");
    assert.doesNotMatch(letter.body_text, /\[Consumer Name\]/,
      "a stored letter must never go out with a placeholder name");

    /* THE TRAP. generateLetter's fingerprint is the raw shingle set — every
       distinct 5-character slice of the letter, hundreds of entries. Storing it
       raw would put a chopped-up copy of the letter in the row beside the
       letter. It is reduced to one digest. */
    assert.equal(letter.fingerprint.length, 1,
      "fingerprint is one digest, not the whole shingle set");
    assert.match(letter.fingerprint[0], /^sha256:[0-9a-f]{64}$/);

    /* And the point of all of it: the client is now on the Repair desk with a
       Send available, which was impossible before because nothing wrote here. */
    const desk = await listRepairCases(db, { orgId, limit: 200 });
    const file = desk.files.find((f) => f.client_id === clientId);
    assert.ok(file, "the client now appears on the Repair desk queue");
    assert.equal(file.can_send, true, "the desk can offer a Send");
    assert.equal(file.letters_ready, 1);
    assert.equal(file.stage_key, "ready_to_send",
      "the optimization card moved, which is what puts the client on the desk");
  });

  /* WHAT PRESSING GENERATE TWICE ACTUALLY DOES, MEASURED 2026-09-06.
   *
   * This test asserted that the second call answers `already_generated`. It does
   * not, and it never could once two things that both belong here met:
   *
   *   1. The endpoint AUTO-ADVANCES. With no `round` in the body it reads the
   *      highest round this client has reached and asks for the one after it
   *      (nextRound, and that has been on main all along). So the second press
   *      is not a second R1 — it is R2.
   *   2. R2 NEEDS A FRESH PULL. `credit_file_stale_for_round` refuses any round
   *      after R1 whose newest credit file is older than the previous round's
   *      letters. Here the pull is seven milliseconds older than the R1 letter
   *      it just produced, so R2 is refused. That is the gate working, not
   *      failing: nobody can tell what the bureaus removed from a report taken
   *      before the letter went out.
   *
   * Both halves are pinned below, and the thing the test is really for — that a
   * second press writes NO second case, item or letter — is pinned either way.
   * The `already_generated` answer is real and is asked for by name, which is
   * the honest way to ask it: same client, same round, twice. */
  test("pressing generate twice writes nothing twice — and says which round it tried", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const first = await post({ client_id: clientId });
    assert.equal(first.body.ok, true, JSON.stringify(first.body));
    const cases1 = await countRows("dispute_cases");
    const items1 = await countRows("dispute_items");
    const letters1 = await countRows("dispute_letters");
    assert.equal(letters1, 1);

    /* No round named: the endpoint moves the client on to R2 by itself. */
    const second = await post({ client_id: clientId });
    assert.equal(second.code, 200);
    assert.equal(second.body.ok, false, JSON.stringify(second.body));
    assert.equal(second.body.reason, "credit_file_stale_for_round", JSON.stringify(second.body));
    assert.equal(second.body.round, "R2", "the second press is the NEXT round, not a repeat of R1");

    /* The same round asked for by name IS idempotent, and says so. */
    const again = await post({ client_id: clientId, round: "R1" });
    assert.equal(again.code, 200);
    assert.equal(again.body.ok, true, JSON.stringify(again.body));
    assert.equal(again.body.already_generated, true,
      "asking for a round that already has letters reports it rather than redoing it");

    assert.equal(await countRows("dispute_cases"), cases1, "no duplicate case");
    assert.equal(await countRows("dispute_items"), items1, "no duplicate items");
    assert.equal(await countRows("dispute_letters"), letters1, "no duplicate letter");
  });

  test("a role outside owner/admin/closer/inquiry_specialist is refused with 403", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const r = await post({ client_id: clientId }, otherToken);

    assert.equal(r.code, 403, "a setter may not generate dispute letters");
    assert.equal(r.body.ok, false);
    assert.equal(await countRows("dispute_letters"), 0,
      "the gate stops the write, not just the response");
  });

  test("a client_id that is not a uuid is a 400, not a crash", async () => {
    const r = await post({ client_id: "not-a-uuid" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "client_id_required");
  });

  test("a round outside the R1–R6/FURNISHER set is a 400", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });
    const r = await post({ client_id: clientId, round: "R9" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_round");
    assert.equal(await countRows("dispute_cases"), 0);
  });

  test("GET is refused — this endpoint only writes on POST", async () => {
    const r = res();
    await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, r);
    assert.equal(r.code, 405);
  });
});
