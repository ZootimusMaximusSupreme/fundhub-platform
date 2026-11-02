// The contract endpoints, against a real Postgres and real sessions.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLERS. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed under
// api/ is never collected and passes forever by never running (CLAUDE.md §12).
// The handlers are imported from here — the same arrangement, and the same
// reason, as src/http/pii.pg.test.mjs and src/http/finance-soft-pull.pg.test.mjs.
//
// WHAT THIS PINS THAT THE MODULE TESTS CANNOT. src/contracts/*.pg.test.mjs prove
// the module and the tables behave. That leaves the questions only a caller can
// ask: can somebody with no session reach any of this; can a staff role that may
// not write contract wording write it anyway; can a session for one company
// reach another company's contracts; and — the one that matters most — can an
// anonymous request get a signature recorded without a valid link.
//
// Every call carries a token minted for a real `sessions` row. There is no
// injection seam, deliberately.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { signContractUrl } from "../contracts/signed-link.mjs";
import { listSigners } from "../contracts/signers.mjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import writeHandler from "../../api/contracts.mjs";
import readHandlerFn from "../../api/read/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "E".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.http.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_http_test_%@example.com";
const KEY_LIKE = "CTHTTP-%";
const FOREIGN_ORG_SLUG = "cthttp-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); }
  finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

describe("/api/contracts endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, foreignOrg, foreignClient, n = 0;
  const staff = {};          // role → { id, token }
  let priorSecret;

  const post = async (bodyObj, token, headers = {}) => {
    const r = res();
    await writeHandler({
      method: "POST", query: {}, body: bodyObj,
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...headers }
    }, r);
    return r;
  };

  const read = async (query, token) => {
    const r = res();
    await readHandlerFn({
      method: "GET", query, headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const callSign = async (query, { method = "GET", body = null, ip = null, ua = null } = {}) => {
    const r = res();
    await signHandler({
      method, query, body,
      headers: ua ? { "user-agent": ua } : {},
      socket: { remoteAddress: ip }
    }, r);
    return r;
  };

  /* The query string of a real signed link, as the page would send it.
     Naming a signer mints THAT PERSON'S link — its own signature space, so it
     can never be replayed as anybody else's. */
  const linkQuery = (contractId, ttlSeconds = undefined, now = undefined, signerId = null) => {
    const link = signContractUrl({ contractId, signerId, secret: SECRET, ttlSeconds, now });
    const u = new URL(link.url, "http://x.invalid");
    const q = { id: contractId, exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
    if (signerId) q.s = signerId;
    return q;
  };

  async function samplePdf(pages = 2) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      doc.addPage([612, 792]).drawText(`p${i + 1}`, { x: 50, y: 700, size: 12, font });
    }
    return Buffer.from(await doc.save());
  }

  const purge = async () => {
    const ids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE])).rows.map((r) => r.id);
    if (ids.length) {
      // Signers first: contract_signers references contracts and is itself
      // delete-blocked, so the fixture unwinds in dependency order with both
      // guards off. No application path can do this, which is the point.
      await withTriggerDisabled("contract_signers", "trg_contract_signers_no_delete", () =>
        db.query(
          `DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`,
          [ids]));
      await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
        db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
      await withTriggerDisabled("documents", "trg_documents_no_delete", () =>
        withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
          await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
          await db.query(
            `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
          await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
        }));
      /* Sending a contract now queues a message per signer, so these have to go
         before the client they reference. */
      await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await withTriggerDisabled("contract_templates", "trg_contract_templates_no_delete", () =>
      db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]));
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM clients WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
      [FOREIGN_ORG_SLUG]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  };

  before(async () => {
    /* The handlers read the secret from the environment — there is no injection
       seam on an endpoint, which is the point of testing at this level. */
    priorSecret = process.env.CONTRACT_URL_SECRET;
    process.env.CONTRACT_URL_SECRET = SECRET;

    org = await resolveDefaultOrg(db);
    await purge();

    /* Both sides of both gates need a witness: an owner who may do everything,
       and a setter — a full ROLE_SETS.STAFF member — who may send but may NOT
       write contract wording or void. If that distinction ever collapses, this
       is where it shows. */
    for (const role of ["owner", "admin", "setter", "closer"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Contract Httptest ${role}`, role, `contract_http_test_${role}@example.com`])).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Katherine','Johnson','contract.http.test.kj@example.com') RETURNING id`, [org])).rows[0].id;

    // A second company, with its own consumer and its own owner.
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Other Co') RETURNING id`, [FOREIGN_ORG_SLUG])).rows[0].id;
    foreignClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Foreign','Client','contract.http.test.foreign@example.com') RETURNING id`,
      [foreignOrg])).rows[0].id;
    const fid = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Contract Httptest foreign','owner','contract_http_test_foreign@example.com','active')
       RETURNING id`, [foreignOrg])).rows[0].id;
    staff.foreign = { id: fid, token: (await createSession(db, { staffId: fid, orgId: foreignOrg })).token };
  });

  after(async () => {
    await purge();
    if (priorSecret === undefined) delete process.env.CONTRACT_URL_SECRET;
    else process.env.CONTRACT_URL_SECRET = priorSecret;
    await close();
  });

  /* A template + a sent contract, made through the ENDPOINTS rather than the
     module, so the fixture itself exercises the path under test. */
  async function sentContract(token = staff.owner.token) {
    n += 1;
    const t = await post({
      action: "create_template", template_key: `CTHTTP-${n}`, name: `Http ${n}`,
      body: "Fee {{field.fee}} for {{contact.full_name}}.",
      manual_fields: [{ key: "fee", label: "Fee", required: true }]
    }, staff.owner.token);
    assert.equal(t.code, 200, JSON.stringify(t.body));
    const d = await post({
      action: "create_draft", client_id: client, template_id: t.body.template.id,
      values: { fee: "10%" }
    }, token);
    assert.equal(d.code, 200, JSON.stringify(d.body));
    const s = await post({ action: "send", id: d.body.contract.id }, token);
    assert.equal(s.code, 200, JSON.stringify(s.body));
    return { template: t.body.template, contract: s.body.contract, link: s.body.link };
  }

  // ── auth ──────────────────────────────────────────────────────────────────

  describe("the staff endpoints refuse anybody who is not signed in", () => {
    test("no token is 401 on both the write and the read", async () => {
      assert.equal((await post({ action: "preview", template_id: client }, null)).code, 401);
      assert.equal((await read({ view: "templates" }, null)).code, 401);
    });

    test("a junk token is 401", async () => {
      assert.equal((await post({ action: "preview" }, "not-a-token")).code, 401);
    });

    test("the write endpoint is POST only and the read endpoint is GET only", async () => {
      const a = res();
      await writeHandler({ method: "GET", query: {}, headers: {} }, a);
      assert.equal(a.code, 405);
      assert.equal(a.headers.allow, "POST");

      const b = res();
      await readHandlerFn({ method: "POST", query: {}, headers: {} }, b);
      assert.equal(b.code, 405);
    });
  });

  // ── the two gates ─────────────────────────────────────────────────────────

  describe("who may write contract wording", () => {
    test("only an owner may write agreement templates", async () => {
      n += 1;
      const r = await post({
        action: "create_template", template_key: `CTHTTP-G${n}`, name: `Gate ${n}`, body: "Words."
      }, staff.owner.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
    });

    test("an admin, setter and closer may not write agreement templates", async () => {
      for (const role of ["admin", "setter", "closer"]) {
        const r = await post({
          action: "create_template", template_key: "CTHTTP-NOPE", name: "Nope", body: "Words."
        }, staff[role].token);
        assert.equal(r.code, 403, `${role} got through`);
        assert.deepEqual(r.body.required, ["owner"]);
      }
      const rows = (await db.query(
        `SELECT count(*)::int AS n FROM contract_templates WHERE template_key = 'CTHTTP-NOPE'`)).rows[0].n;
      assert.equal(rows, 0, "a refused create must not have written a row");
    });

    test("but a setter and a closer MAY send — that is the ordinary case", async () => {
      const { contract } = await sentContract(staff.setter.token);
      assert.equal(contract.status, "sent");
      const again = await sentContract(staff.closer.token);
      assert.equal(again.contract.status, "sent");
    });

    test("voiding is owner/admin, and a refused void changes nothing", async () => {
      const { contract } = await sentContract();
      const refused = await post({ action: "void", id: contract.id, reason: "nope" }, staff.setter.token);
      assert.equal(refused.code, 403);
      assert.equal((await db.query(`SELECT status FROM contracts WHERE id=$1`, [contract.id])).rows[0].status, "sent");

      const ok = await post({ action: "void", id: contract.id, reason: "Client withdrew" }, staff.owner.token);
      assert.equal(ok.code, 200);
      assert.equal(ok.body.contract.status, "void");
    });

    test("a rename is refused outright rather than silently ignored", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-R${n}`, name: "Rename me", body: "Words."
      }, staff.owner.token);
      const r = await post({
        action: "save_template", id: t.body.template.id, template_key: "CTHTTP-SOMETHINGELSE",
        name: "Rename me", body: "Words."
      }, staff.owner.token);
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "rename_refused");
    });

    test("an unknown action is refused and lists what is allowed", async () => {
      const r = await post({ action: "delete_everything" }, staff.owner.token);
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "unknown_action");
      assert.ok(Array.isArray(r.body.allowed));
    });

    test("a malformed id is a 400, never a 500 out of Postgres", async () => {
      for (const body of [{ action: "send", id: "zzz" }, { action: "save_draft", id: "zzz" },
                          { action: "preview", template_id: "zzz" },
                          { action: "create_draft", client_id: "zzz", template_id: "zzz" }]) {
        const r = await post(body, staff.owner.token);
        assert.equal(r.code, 400, JSON.stringify(r.body));
      }
    });
  });

  // ── org scoping ───────────────────────────────────────────────────────────

  describe("one company cannot reach another company's contracts", () => {
    test("the queue and the single read both come back empty-handed", async () => {
      const { contract } = await sentContract();
      const one = await read({ id: contract.id }, staff.foreign.token);
      assert.equal(one.code, 404);
      const list = await read({ view: "contracts" }, staff.foreign.token);
      assert.equal(list.code, 200);
      assert.equal(list.body.items.some((r) => r.id === contract.id), false);
    });

    test("and cannot send it either", async () => {
      const { contract } = await sentContract();
      const r = await post({ action: "send", id: contract.id }, staff.foreign.token);
      assert.equal(r.code, 404);
    });

    test("a draft cannot be created for another company's client", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-X${n}`, name: "Cross", body: "Words."
      }, staff.owner.token);
      const r = await post({
        action: "create_draft", client_id: foreignClient, template_id: t.body.template.id
      }, staff.owner.token);
      assert.equal(r.code, 404);
      assert.equal(r.body.error, "client_not_found");
    });
  });

  // ── the read surface ──────────────────────────────────────────────────────

  describe("/api/read/contracts", () => {
    test("serves the library, the queue and one contract with its wording", async () => {
      const { template, contract } = await sentContract();

      const lib = await read({ view: "templates" }, staff.closer.token);
      assert.equal(lib.code, 200);
      const mine = lib.body.items.find((r) => r.id === template.id);
      assert.ok(mine, "the template is missing from the library");
      assert.ok(Array.isArray(mine.manual_fields));

      const queue = await read({ view: "contracts", client_id: client }, staff.closer.token);
      assert.ok(queue.body.items.some((r) => r.id === contract.id));

      const one = await read({ id: contract.id }, staff.closer.token);
      assert.equal(one.code, 200);
      assert.match(one.body.contract.rendered_body, /Fee 10% for Katherine Johnson\./);
      assert.equal(one.body.integrity.ok, true);
      assert.ok(one.body.copy_hash);
    });

    test("never returns a storage key, whatever it selected", async () => {
      const { contract } = await sentContract();
      const one = await read({ id: contract.id }, staff.owner.token);
      assert.equal(JSON.stringify(one.body).includes("storage_key"), false);
    });

    test("reports a tampered contract to the CRM rather than hiding it", async () => {
      const { contract } = await sentContract();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = 'edited' WHERE id = $1`, [contract.id]));
      const one = await read({ id: contract.id }, staff.owner.token);
      assert.equal(one.body.integrity.ok, false);
      assert.equal(one.body.integrity.reason, "content_changed");
    });

    test("a bad id or client id is a 400, and an unknown one is a 404", async () => {
      assert.equal((await read({ id: "zzz" }, staff.owner.token)).code, 400);
      assert.equal((await read({ view: "contracts", client_id: "zzz" }, staff.owner.token)).code, 400);
      assert.equal((await read({ id: "00000000-0000-0000-0000-000000000000" }, staff.owner.token)).code, 404);
    });
  });

  /* ── what the Documents screen asks for ────────────────────────────────────
     Batch contracts-dedup-2026-08-17: Contracts became template setup only and
     every sent contract is watched from Documents instead. A `documents` row
     carries no contract id, so these are the calls that get one. */

  describe("finding the contract behind a document row", () => {
    test("A DOCUMENT ID FINDS THE CONTRACT THAT OWNS IT", async () => {
      const { contract } = await sentContract();
      assert.ok(contract.document_id, "a sent contract must have registered a document");

      const r = await read(
        { view: "contracts", document_id: contract.document_id }, staff.closer.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.view, "contracts");
      const hit = r.body.items.find((x) => x.id === contract.id);
      assert.ok(hit, "the owning contract did not come back");
      assert.equal(hit.document_id, contract.document_id);
      // The status badge the screen draws. Nothing else in the row supplies it.
      assert.ok(["sent", "viewed"].includes(hit.status), `unexpected status ${hit.status}`);
    });

    test("several ids in one call, and nothing that was not asked for", async () => {
      const a = await sentContract();
      const b = await sentContract();
      const r = await read({
        view: "contracts",
        document_id: `${a.contract.document_id},${b.contract.document_id}`
      }, staff.closer.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.deepEqual(
        r.body.items.map((x) => x.id).sort(),
        [a.contract.id, b.contract.id].sort());
    });

    test("ANOTHER COMPANY'S SESSION GETS NOTHING FROM THIS COMPANY'S DOCUMENT ID", async () => {
      const { contract } = await sentContract();
      const r = await read(
        { view: "contracts", document_id: contract.document_id }, staff.foreign.token);
      assert.equal(r.code, 200);
      assert.equal(r.body.items.length, 0);
    });

    test("an id that owns no contract is an empty answer, and junk is a 400", async () => {
      const none = await read(
        { view: "contracts", document_id: "00000000-0000-0000-0000-000000000000" },
        staff.owner.token);
      assert.equal(none.code, 200);
      assert.equal(none.body.items.length, 0);

      for (const bad of ["zzz", `${"0".repeat(8)}-0000-0000-0000-000000000000,zzz`, ","]) {
        const r = await read({ view: "contracts", document_id: bad }, staff.owner.token);
        assert.equal(r.code, 400, `"${bad}" should have been refused`);
        assert.equal(r.body.error, "invalid_document_id");
      }
    });

    test("the filter never returns a storage key", async () => {
      const { contract } = await sentContract();
      const r = await read(
        { view: "contracts", document_id: contract.document_id }, staff.owner.token);
      assert.equal(JSON.stringify(r.body).includes("storage_key"), false);
    });
  });

  describe("reminding one contract", () => {
    /* The gate is the point of this one. run_reminders — the whole-company
       sweep — is owner/admin. Reminding the one person holding up one contract
       is the same act as sending it, and sending is ordinary staff work. */
    test("AN ORDINARY STAFF MEMBER MAY REMIND ONE CONTRACT", async () => {
      const { contract } = await sentContract(staff.closer.token);
      const r = await post({ action: "remind", id: contract.id }, staff.setter.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.action, "remind");
      assert.equal(r.body.contract_id, contract.id);
      assert.equal(r.body.reminder, 1);
      assert.ok(r.body.waiting_on && r.body.waiting_on.name, "nobody was named as waiting");
      assert.equal(typeof r.body.message, "string");
      assert.ok(r.body.message.length > 0, "a reminder must always say what happened");
    });

    test("a draft has nobody to remind", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-RM${n}`, name: `Remind ${n}`, body: "Words."
      }, staff.owner.token);
      const d = await post({
        action: "create_draft", client_id: client, template_id: t.body.template.id
      }, staff.owner.token);
      const r = await post({ action: "remind", id: d.body.contract.id }, staff.owner.token);
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "not_sent");
    });

    test("A VOIDED CONTRACT IS NEVER CHASED", async () => {
      const { contract } = await sentContract();
      const v = await post({ action: "void", id: contract.id, reason: "test" }, staff.owner.token);
      assert.equal(v.code, 200, JSON.stringify(v.body));
      const r = await post({ action: "remind", id: contract.id }, staff.owner.token);
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "already_finished");
    });

    test("IT GIVES UP AFTER THE CAP rather than emailing forever", async () => {
      const { contract } = await sentContract();
      const signers = await listSigners(db, contract.id);
      // Four reminders already on the record. Written straight in, because what
      // the cap counts is the messages themselves — see chasesFor().
      for (let i = 1; i <= 4; i++) {
        await db.query(
          `INSERT INTO messages
             (org_id, client_id, direction, channel, template_key, rendered_body,
              provider_ref, status, compliance_check_passed, to_address)
           VALUES ($1,$2,'outbound','email','CONTRACT-REMIND-EMAIL','x',$3,'queued',true,$4)`,
          [org, client, `contract:${contract.id}:${signers[0].id}:chase${i}`,
           "contract.http.test.kj@example.com"]);
      }
      const r = await post({ action: "remind", id: contract.id }, staff.owner.token);
      assert.equal(r.code, 409, JSON.stringify(r.body));
      assert.equal(r.body.error, "chase_limit");
      assert.match(r.body.message, /call/i);
    });

    test("an unknown id is a 404, junk is a 400, and another company's is a 404", async () => {
      assert.equal((await post({ action: "remind", id: "zzz" }, staff.owner.token)).code, 400);
      assert.equal((await post(
        { action: "remind", id: "00000000-0000-0000-0000-000000000000" },
        staff.owner.token)).code, 404);

      const { contract } = await sentContract();
      const foreign = await post({ action: "remind", id: contract.id }, staff.foreign.token);
      assert.equal(foreign.code, 404);
    });
  });

  // ── the client endpoint ───────────────────────────────────────────────────

  describe("/api/contracts/sign — the anonymous half", () => {
    test("a valid link renders the words, with no session anywhere", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id));
      assert.equal(r.code, 200);
      assert.match(r.body.contract.body, /Fee 10%/);
      assert.equal(r.body.contract.can_sign, true);
      assert.equal(r.headers["cache-control"], "private, no-store");
    });

    test("a forged signature is an undifferentiated 404", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      const r = await callSign({ ...q, sig: "0".repeat(64) });
      assert.equal(r.code, 404);
      assert.deepEqual(r.body, { ok: false, error: "not_found" });
    });

    test("a link for one contract does not open another", async () => {
      const a = await sentContract();
      const b = await sentContract();
      const r = await callSign({ ...linkQuery(a.contract.id), id: b.contract.id });
      assert.equal(r.code, 404);
    });

    test("an unknown id, a malformed id and a draft all answer the same 404", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-DR${n}`, name: "Draft", body: "Words."
      }, staff.owner.token);
      const d = await post({
        action: "create_draft", client_id: client, template_id: t.body.template.id }, staff.owner.token);

      const unknown = await callSign(linkQuery("00000000-0000-0000-0000-000000000000"));
      const malformed = await callSign({ id: "zzz", exp: "1", sig: "x" });
      const draft = await callSign(linkQuery(d.body.contract.id));
      for (const r of [unknown, malformed, draft]) {
        assert.equal(r.code, 404);
        assert.deepEqual(r.body, { ok: false, error: "not_found" });
      }
    });

    test("an expired link says so — the one deliberate exception, and it is benign", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id, 60, () => Date.now() - 3600 * 1000);
      const r = await callSign(q);
      assert.equal(r.code, 410);
      assert.equal(r.body.error, "link_expired");
    });

    test("signing through the endpoint records the IP the request came from", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      const r = await callSign(q, {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true },
        ip: "198.51.100.22", ua: "Mozilla/5.0 (endpoint test)"
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
      assert.equal(row.status, "signed");
      assert.equal(row.signer_name, "Katherine Johnson");
      assert.equal(row.signer_ip, "198.51.100.22");
      assert.equal(row.signer_user_agent, "Mozilla/5.0 (endpoint test)");
    });

    test("an unticked box is refused and writes nothing", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id), {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: false } });
      assert.equal(r.code, 400);
      assert.equal((await db.query(`SELECT signed_at FROM contracts WHERE id=$1`, [contract.id])).rows[0].signed_at, null);
    });

    test("A FORGED LINK CANNOT SIGN, even with a perfect body", async () => {
      const { contract } = await sentContract();
      const r = await callSign({ ...linkQuery(contract.id), sig: "f".repeat(64) }, {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      assert.equal(r.code, 404);
      assert.equal((await db.query(`SELECT signed_at FROM contracts WHERE id=$1`, [contract.id])).rows[0].signed_at, null);
    });

    test("a tampered contract is refused with 409 through the endpoint too", async () => {
      const { contract } = await sentContract();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = rendered_body || '!' WHERE id = $1`, [contract.id]));
      const r = await callSign(linkQuery(contract.id), {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "content_changed");
    });

    test("only GET and POST are answered", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id), { method: "DELETE" });
      assert.equal(r.code, 405);
      assert.equal(r.headers.allow, "GET, POST");
    });

    test("the signed copy stays readable on the same link afterwards", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      await callSign(q, { method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      const after = await callSign(q);
      assert.equal(after.code, 200);
      assert.equal(after.body.contract.status, "signed");
      assert.equal(after.body.contract.signer_name, "Katherine Johnson");
      assert.equal(after.body.contract.can_sign, false);
    });
  });

  // ── uploaded PDFs, boxes, several signers ─────────────────────────────────

  describe("uploading a document and placing boxes on it", () => {
    async function uploadedTemplate(token = staff.owner.token, signerCount = 1) {
      n += 1;
      const up = await post({
        action: "upload_template", template_key: `CTHTTP-PDF${n}`, name: `Pdf ${n}`,
        filename: "deal.pdf", file: (await samplePdf(2)).toString("base64")
      }, token);
      if (up.code !== 200) return up;
      const fields = [
        { id: "who", page: 0, x: 0.2, y: 0.2, w: 0.4, h: 0.03, type: "text", signer: 0,
          label: "Name", source: "contact.full_name" },
        ...Array.from({ length: signerCount }, (_, i) => ({
          id: `sig${i}`, page: 1, x: 0.05 + i * 0.3, y: 0.6, w: 0.25, h: 0.05,
          type: "signature", signer: i, label: `Signature ${i + 1}`, source: "manual"
        }))
      ];
      const saved = await post({
        action: "save_fields", id: up.body.template.id, fields,
        signer_roles: Array.from({ length: signerCount }, (_, i) =>
          ({ label: i === 0 ? "Client" : `Party ${i + 1}` }))
      }, token);
      return saved;
    }

    test("an owner can upload a PDF and the endpoint reports its pages", async () => {
      n += 1;
      const r = await post({
        action: "upload_template", template_key: `CTHTTP-UP${n}`, name: "Uploaded",
        filename: "deal.pdf", file: (await samplePdf(3)).toString("base64")
      }, staff.owner.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.template.source_kind, "pdf");
      assert.equal(r.body.template.page_count, 3);
      assert.match(r.body.message, /3 pages/);
    });

    test("UPLOADING IS OWNER/ADMIN — a setter cannot, and nothing is written", async () => {
      const r = await post({
        action: "upload_template", template_key: "CTHTTP-NOPE2", name: "Nope",
        filename: "d.pdf", file: (await samplePdf(1)).toString("base64")
      }, staff.setter.token);
      assert.equal(r.code, 403);
      const rows = (await db.query(
        `SELECT count(*)::int AS n FROM contract_templates WHERE template_key = 'CTHTTP-NOPE2'`)).rows[0].n;
      assert.equal(rows, 0);
    });

    test("placing boxes is owner/admin too", async () => {
      const t = await uploadedTemplate();
      const r = await post({ action: "save_fields", id: t.body.template.id, fields: [] }, staff.closer.token);
      assert.equal(r.code, 403);
    });

    test("a non-PDF is refused with a sentence a person can act on", async () => {
      n += 1;
      const r = await post({
        action: "upload_template", template_key: `CTHTTP-BAD${n}`, name: "Bad",
        filename: "deal.docx", file: Buffer.from("PK word doc").toString("base64")
      }, staff.owner.token);
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "not_a_pdf");
      assert.match(r.body.message, /Save As or Print/);
    });

    test("a box off the page is refused, and says which one", async () => {
      const t = await uploadedTemplate();
      const r = await post({
        action: "save_fields", id: t.body.template.id,
        fields: [{ id: "x", page: 0, x: 0.9, y: 0.5, w: 0.4, h: 0.05, type: "text", signer: 0 }]
      }, staff.owner.token);
      assert.equal(r.code, 400);
      assert.match(r.body.message, /hangs off the edge/);
    });

    test("the file comes back for the editor, and never a storage key", async () => {
      const t = await uploadedTemplate();
      const r = await read({ file: "template", template_id: t.body.template.id }, staff.owner.token);
      assert.equal(r.code, 200);
      assert.equal(r.body.page_count, 2);
      assert.ok(r.body.pdf_base64.length > 100);
      assert.equal(Buffer.from(r.body.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");
      assert.equal(JSON.stringify(r.body).includes("storage_key"), false);
    });

    test("another company cannot fetch the file", async () => {
      const t = await uploadedTemplate();
      const r = await read({ file: "template", template_id: t.body.template.id }, staff.foreign.token);
      assert.equal(r.code, 404);
    });
  });

  describe("sending to several people, in order", () => {
    async function twoParty(token = staff.owner.token) {
      n += 1;
      const up = await post({
        action: "upload_template", template_key: `CTHTTP-TWO${n}`, name: `Two ${n}`,
        filename: "deal.pdf", file: (await samplePdf(2)).toString("base64")
      }, staff.owner.token);
      await post({
        action: "save_fields", id: up.body.template.id,
        signer_roles: [{ label: "Client" }, { label: "Lender" }],
        fields: [
          { id: "sig0", page: 1, x: 0.05, y: 0.6, w: 0.25, h: 0.05, type: "signature", signer: 0 },
          { id: "sig1", page: 1, x: 0.4, y: 0.6, w: 0.25, h: 0.05, type: "signature", signer: 1 }
        ]
      }, staff.owner.token);
      const d = await post({
        action: "create_draft", client_id: client, template_id: up.body.template.id,
        signers: [
          { role_label: "Client", name: "Katherine Johnson", email: "kj@x.test", client_id: client },
          { role_label: "Lender", name: "Bo Lender", email: "bo@x.test" }
        ],
        signing_order: "sequential"
      }, token);
      assert.equal(d.code, 200, JSON.stringify(d.body));
      const s = await post({ action: "send", id: d.body.contract.id }, token);
      assert.equal(s.code, 200, JSON.stringify(s.body));
      return { contract: s.body.contract, links: s.body.links };
    }

    test("the send returns one link per signer", async () => {
      const { links } = await twoParty();
      assert.equal(links.length, 2);
      assert.deepEqual(links.map((l) => l.role_label), ["Client", "Lender"]);
      assert.ok(links[0].signer_id && links[1].signer_id);
      assert.notEqual(links[0].url, links[1].url);
    });

    test("SIGNER 2'S LINK IS REFUSED UNTIL SIGNER 1 HAS SIGNED", async () => {
      const { contract, links } = await twoParty();
      const q2 = linkQuery(contract.id, undefined, undefined, links[1].signer_id);

      const early = await callSign(q2);
      assert.equal(early.code, 409);
      assert.equal(early.body.error, "not_your_turn");
      assert.match(early.body.message, /Katherine Johnson/);

      const earlySign = await callSign(q2, {
        method: "POST", body: { signer_name: "Bo Lender", agreed: true } });
      assert.equal(earlySign.code, 409);

      // Signer 1 goes.
      const q1 = linkQuery(contract.id, undefined, undefined, links[0].signer_id);
      const first = await callSign(q1, {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true }, ip: "203.0.113.5" });
      assert.equal(first.code, 200, JSON.stringify(first.body));
      assert.equal(first.body.complete, false);

      // Now signer 2 may.
      const nowOk = await callSign(q2);
      assert.equal(nowOk.code, 200);
      assert.equal(nowOk.body.contract.can_sign, true);
      const second = await callSign(q2, {
        method: "POST", body: { signer_name: "Bo Lender", agreed: true }, ip: "198.51.100.6" });
      assert.equal(second.code, 200);
      assert.equal(second.body.complete, true);

      const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
      assert.equal(row.status, "signed");
      assert.ok(row.signed_document_id);
    });

    test("A CONTRACT-WIDE LINK CANNOT SIGN A MULTI-SIGNER CONTRACT", async () => {
      const { contract } = await twoParty();
      const r = await callSign(linkQuery(contract.id), {
        method: "POST", body: { signer_name: "Anybody", agreed: true } });
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "signer_required");
    });

    test("one signer's link cannot open as the other signer", async () => {
      const { contract, links } = await twoParty();
      const q1 = linkQuery(contract.id, undefined, undefined, links[0].signer_id);
      // Same signature, different signer id in the query.
      const r = await callSign({ ...q1, s: links[1].signer_id });
      assert.equal(r.code, 404);
    });

    test("the document itself is served through the same signature check", async () => {
      const { contract, links } = await twoParty();
      const q = linkQuery(contract.id, undefined, undefined, links[0].signer_id);
      const ok = await callSign({ ...q, file: "1" });
      assert.equal(ok.code, 200);
      assert.equal(Buffer.from(ok.body.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");

      const forged = await callSign({ ...q, file: "1", sig: "0".repeat(64) });
      assert.equal(forged.code, 404);
    });

    test("declining is recorded through the endpoint", async () => {
      const { contract, links } = await twoParty();
      const q1 = linkQuery(contract.id, undefined, undefined, links[0].signer_id);
      const r = await callSign(q1, {
        method: "POST", body: { action: "decline", reason: "The fee is wrong" } });
      assert.equal(r.code, 200);
      const rows = await listSigners(db, contract.id);
      assert.equal(rows[0].status, "declined");
      assert.equal(rows[0].decline_reason, "The fee is wrong");
    });

    test("the CRM read shows every signer and who is being waited on", async () => {
      const { contract } = await twoParty();
      const r = await read({ id: contract.id }, staff.closer.token);
      assert.equal(r.code, 200);
      assert.equal(r.body.signers.length, 2);
      assert.equal(r.body.waiting_on.name, "Katherine Johnson");
    });

    test("the finished PDF is downloadable from the CRM", async () => {
      const { contract, links } = await twoParty();
      for (const l of links) {
        await callSign(linkQuery(contract.id, undefined, undefined, l.signer_id), {
          method: "POST", body: { signer_name: l.name, agreed: true } });
      }
      const r = await read({ file: "contract", id: contract.id }, staff.owner.token);
      assert.equal(r.code, 200);
      assert.equal(r.body.signed, true);
      const doc = await PDFDocument.load(Buffer.from(r.body.pdf_base64, "base64"));
      assert.equal(doc.getPageCount(), 3, "2 source pages + the signature record");
    });
  });

  describe("adding a contact without leaving the screen", () => {
    test("any staff role may add one", async () => {
      const r = await post({
        action: "create_client", first_name: "New", last_name: "Person",
        email: "contract.http.test.new1@example.com"
      }, staff.setter.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.existing, false);
      assert.ok(r.body.client.id);
    });

    test("A DUPLICATE EMAIL REUSES THE EXISTING CONTACT rather than making a second one", async () => {
      const body = {
        action: "create_client", first_name: "Dup", last_name: "Person",
        email: "contract.http.test.dup@example.com"
      };
      const first = await post(body, staff.owner.token);
      const second = await post(body, staff.owner.token);
      assert.equal(second.code, 200);
      assert.equal(second.body.existing, true);
      assert.equal(second.body.client.id, first.body.client.id);
      const count = (await db.query(
        `SELECT count(*)::int AS n FROM clients WHERE lower(email) = $1`,
        ["contract.http.test.dup@example.com"])).rows[0].n;
      assert.equal(count, 1);
    });

    test("a nameless contact and a malformed email are refused", async () => {
      assert.equal((await post({ action: "create_client", email: "x@y.co" }, staff.owner.token)).code, 400);
      assert.equal((await post({
        action: "create_client", first_name: "A", email: "not-an-email"
      }, staff.owner.token)).code, 400);
    });

    test("a new contact belongs to the caller's company, never another", async () => {
      const r = await post({
        action: "create_client", first_name: "Scoped", last_name: "Person",
        email: "contract.http.test.scoped@example.com"
      }, staff.foreign.token);
      assert.equal(r.code, 200);
      const row = (await db.query(`SELECT org_id FROM clients WHERE id = $1`, [r.body.client.id])).rows[0];
      assert.equal(row.org_id, foreignOrg);
    });
  });

  describe("running the reminder sweep from the CRM", () => {
    /* Chasing also runs on a schedule (src/workflows/contract-chaser.mjs), but
       Inngest is switched off, so this endpoint is how it happens today. A
       reminder system that only exists behind a switch nobody has thrown is a
       reminder system that does not exist. */
    test("owner and admin may run it", async () => {
      for (const role of ["owner", "admin"]) {
        const r = await post({ action: "run_reminders" }, staff[role].token);
        assert.equal(r.code, 200, `${role} was refused: ${JSON.stringify(r.body)}`);
        assert.ok(r.body.result);
        assert.ok(typeof r.body.message === "string" && r.body.message.length);
      }
    });

    test("A SETTER MAY NOT — reminders go to real people, in bulk", async () => {
      const r = await post({ action: "run_reminders" }, staff.setter.token);
      assert.equal(r.code, 403);
      assert.deepEqual(r.body.required, ["owner", "admin"]);
    });

    test("it only ever sweeps the caller's own company", async () => {
      // A freshly sent contract is not yet old enough to chase, so a sweep for
      // this org finds nothing — and a sweep by the other company must also
      // never see it, whatever its age.
      await sentContract();
      const foreign = await post({ action: "run_reminders" }, staff.foreign.token);
      assert.equal(foreign.code, 200);
      assert.equal(foreign.body.result.considered, 0);
    });
  });
});
