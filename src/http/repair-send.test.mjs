// COMPLIANCE REVIEW REQUIRED — /api/repair/send human mail gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/send.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

test("DFY/repair send path calls mail helper when mail=true", async () => {
  const mailCalls = [];
  const db = {
    async query(sql, params) {
      assertBind(sql, params);
      const s = String(sql);
      if (s.includes("FROM clients")) return { rows: [{ id: "1" }] };
      if (s.includes("pipeline") || s.includes("cards") || s.includes("dispute_letters")) {
        return { rows: [{ stage_id: "s1", pipeline_id: "p1", id: "c1" }] };
      }
      return { rows: [] };
    }
  };
  const req = {
    method: "POST",
    body: {
      mail: true,
      client_id: "33333333-3333-4333-8333-333333333333",
      mail_from: {
        first_name: "Pat",
        last_name: "Client",
        address_line1: "12 Oak St",
        address_city: "Dallas",
        address_state: "TX",
        address_zip: "75201"
      },
      letters: [{ bureau: "EX", pdf: "JVBERi0=", letter_id: "55555555-5555-4555-8555-555555555555" }]
    }
  };
  const res = resCapture();
  await handler(req, res, {
    db,
    requireAuth: async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "22222222-2222-4222-8222-222222222222",
      role: "owner"
    }),
    // This fixture represents a client whose signed repair agreement is on file.
    // The separate authorization regression verifies unsigned clients are refused.
    hasRepairAgreement: async (_db, { orgId, clientId }) => {
      assert.equal(orgId, "22222222-2222-4222-8222-222222222222");
      assert.equal(clientId, "33333333-3333-4333-8333-333333333333");
      return true;
    },
    mailBureauLetter: async (opts) => {
      mailCalls.push(opts);
      return { ok: true, providerId: "letter_dfy_1" };
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(mailCalls.length, 1);
  assert.equal(mailCalls[0].bureau, "EX");
  assert.equal(mailCalls[0].pdf, "JVBERi0=");
  assert.equal(mailCalls[0].from.first_name, "Pat");
});

test("repair send without mail=true fails closed", async () => {
  const mailCalls = [];
  const res = resCapture();
  await handler({
    method: "POST",
    body: {
      mail: false,
      client_id: "33333333-3333-4333-8333-333333333333",
      letters: [{ bureau: "EX", html: "<p>x</p>" }]
    }
  }, res, {
    db: { async query() { return { rows: [{ id: "1" }] }; } },
    requireAuth: async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "22222222-2222-4222-8222-222222222222",
      role: "owner"
    }),
    mailBureauLetter: async (opts) => { mailCalls.push(opts); return { ok: true, providerId: "x" }; }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "no_channel");
  assert.equal(mailCalls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE LIVE ROUTE MUST DECIDE ON THE FACT, NOT ON A STRING
//
// The closure in api/repair/send.mjs rebuilt the provider's answer as
// { ok, outcome, error } and threw the rest away, so "did a request actually
// leave this process?" — which the provider states as `preTransmission` —
// never reached src/repair/send.mjs. It was left matching the error text
// against a hardcoded list of wordings. A refusal not on that list kept the
// letter's claim and needed a human to release it.

const LETTER_ID = "55555555-5555-4555-8555-555555555555";
const IDENT = {
  first_name: "Pat",
  last_name: "Client",
  address_line1: "12 Oak St",
  address_city: "Dallas",
  address_state: "TX",
  address_zip: "75201"
};

/** A db that lets the send loop claim the letter and records every statement. */
function claimingDb(statements) {
  return {
    async query(sql, params) {
      assertBind(sql, params);
      const s = String(sql).replace(/\s+/g, " ");
      statements.push(s);
      if (s.includes("FROM clients")) return { rows: [{ id: "1" }] };
      if (/UPDATE dispute_letters d SET status = 'sending'/.test(s)) {
        return { rows: [{ prior_status: "ready" }] };
      }
      return { rows: [] };
    }
  };
}

async function post(deps, statements) {
  const res = resCapture();
  await handler({
    method: "POST",
    body: {
      mail: true,
      client_id: "33333333-3333-4333-8333-333333333333",
      mail_from: IDENT,
      letters: [{ bureau: "EX", html: "<p>x</p>", letter_id: LETTER_ID }]
    }
  }, res, {
    db: claimingDb(statements),
    requireAuth: async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "22222222-2222-4222-8222-222222222222",
      role: "owner"
    }),
    // Existing provider/replay tests exercise AUTHORIZED mail. The new route
    // tests separately enforce 403 before any send when authorization is absent.
    hasRepairAgreement: async (_db, { orgId, clientId }) => {
      assert.equal(orgId, "22222222-2222-4222-8222-222222222222");
      assert.equal(clientId, "33333333-3333-4333-8333-333333333333");
      return true;
    },
    ...deps
  });
  return res;
}

test("a refusal the provider says happened before transmission gives the letter back", async () => {
  const statements = [];
  // A wording that is deliberately NOT on PRE_TRANSMISSION_REFUSALS. Before the
  // fix the fact was dropped here and the string list was the only test, so this
  // letter kept its claim and could not be re-sent without a person.
  const res = await post({
    mailBureauLetter: async () => ({
      ok: false,
      preTransmission: true,
      error: "some brand new refusal nobody has written a prefix for"
    })
  }, statements);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false, "the send failed, which is correct");
  assert.ok(
    statements.some((s) => /SET status = COALESCE\(\$4, 'ready'\), send_claimed_at = NULL/.test(s)),
    "and the claim was released, because the provider said nothing left the process"
  );
});

test("a failure the provider says MAY have transmitted keeps the letter claimed", async () => {
  const statements = [];
  // The mirror image, and the more dangerous direction. The wording here starts
  // with a prefix that IS on the string list, so before the fix the coincidence
  // would have released a letter that may already be in the post.
  const res = await post({
    mailBureauLetter: async () => ({
      ok: false,
      preTransmission: false,
      error: "pdf_or_html_required — reported by the provider AFTER the call went out"
    })
  }, statements);

  assert.equal(res.body.ok, false);
  assert.equal(
    statements.some((s) => /send_claimed_at = NULL/.test(s)), false,
    "the stated fact beats the matching prefix, and nothing is released"
  );
});

test("a 200 with no provider id is recorded as a mailing through the live route", async () => {
  const statements = [];
  const res = await post({
    // PostGrid answering 200 with a body that carries no id.
    mailBureauLetter: async () => ({ ok: true, providerId: null })
  }, statements);

  assert.equal(res.body.ok, true);
  assert.equal(res.body.results[0].providerId, null);
  assert.ok(
    statements.some((s) => /mailed_at = COALESCE\(mailed_at, now\(\)\)/.test(s)),
    "the mailing is written down even though there is no id to write with it"
  );
});

test("a letter is claimed only while nobody is sending it, nobody has mailed it and it is not already sent; a refusal releases only a claim still held", async () => {
  const statements = [];
  await post({ mailBureauLetter: async () => ({ ok: false, preTransmission: true, error: "refused before it left" }) }, statements);
  const one = (re) => statements.find((s) => re.test(s));
  assertSqlHas(one(/UPDATE dispute_letters d SET status = 'sending'/), {
    "this letter, this company, this client": "WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid",
    "not claimed already": "AND d.send_claimed_at IS NULL",
    "not mailed already": "AND d.mailed_at IS NULL",
    "not in a sent state": "AND d.status NOT IN ('sending', 'sent', 'delivered')"
  });
  assertSqlHas(one(/SET status = COALESCE\(\$4, 'ready'\), send_claimed_at = NULL/), {
    "only this letter, still held": "WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid AND status = 'sending' AND mailed_at IS NULL"
  });
});

test("a mailed letter is marked sent once: the first mailing time is kept", async () => {
  const statements = [];
  await post({ mailBureauLetter: async () => ({ ok: true, providerId: "pg_1" }) }, statements);
  const mark = statements.find((s) => /mailed_at = COALESCE\(mailed_at, now\(\)\)/.test(s));
  assertSqlHas(mark, { "marked sent": "SET status = 'sent'", "keeps the first mailing time": "mailed_at = COALESCE(mailed_at, now())" });
});
