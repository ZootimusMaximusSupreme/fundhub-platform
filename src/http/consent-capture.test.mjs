// Endpoint tests for /api/consent/capture — the capture flow, with a stubbed
// database and NO DATABASE_URL.
//
// WHY THIS IS A .test.mjs AND NOT A .pg.test.mjs. CLAUDE.md §12 records that
// with DATABASE_URL unset the ~193 *.pg.test.mjs tests skip and the suite still
// reports zero failures — so a rule that only has a pg test is a rule that is
// unproven on most runs. The claims below are the ones that must hold on EVERY
// pass, because each of them is a way the gate could be opened by accident:
//
//   * org scoping comes from the session and a body/query org is ignored;
//   * a staff principal cannot reach a client outside their own org;
//   * a client principal can only ever act on themself;
//   * the role gate is a real second call and refuses roles outside the set;
//   * the consent WORDS are never taken from the request body.
//
// HOW THE DATABASE IS STUBBED. src/db.mjs exports `db` as a plain object
// `{ query }`, and every handler imports that same object, so replacing its
// `query` property swaps the database for the whole import graph — no module
// mocking, no flags, no DATABASE_URL. The stub is a router over the SQL text: it
// answers the session lookup that requireAuth performs and then whatever the
// handler asks next, recording everything for assertions. pool() is never
// reached, so nothing tries to connect.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/consent/capture.mjs";
import { CURRENT_SOFT_PULL_VERSION, SOFT_PULL_DISCLOSURES } from "../consent/disclosures.mjs";
import { verifySoftPullApproveToken } from "../consent/approve-token.mjs";
import { encryptSsn } from "../pii/index.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const OTHER_CLIENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STAFF = "33333333-3333-3333-3333-333333333333";
const CONSENT_ID = "66666666-6666-6666-6666-666666666666";

const realQuery = db.query;
let calls = [];

/* stubDb — route by SQL text. `session` describes who the caller is; null means
   no valid session at all. `owns` answers the org check the endpoint performs
   against `clients` — true means the named client really is in the caller's
   org, false means they are not and the endpoint must refuse. Anything else the
   handler asks is answered from `answers`, a list of [pattern, result] pairs
   consulted in order, defaulting to an empty result set. */
function stubDb({ session = null, owns = true, answers = [] } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });

    // requireAuth → authenticate → verifySession
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      /* `in` and not `??`. A test that sets role:null or orgId:null is testing
         exactly the null — and `null ?? "closer"` would quietly hand the handler
         a valid closer session instead, so the assertion would pass against a
         case that never ran. That is how a stub hides the bug it was written to
         find, and it did here before this was fixed. */
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG),
        role: pick("role", "closer"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    /* The org check — `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`.
       Routed here rather than left to `answers` so that every case in this file
       keeps its existing outcome without having to know the query exists; the
       cases that want the refusal pass owns:false. It cannot collide with the
       consent reads: OWNS matches "FROM clients WHERE id" and SELECT matches
       "FROM client_consents", and neither string contains the other. */
    if (OWNS.test(text)) return { rows: owns ? [{ "?column?": 1 }] : [] };

    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

/* A minimal res double. Records status and body rather than writing anything. */
function mkRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
  return res;
}

const mkReq = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer tok" },
  query: {},
  body: {},
  ...over
});

const consentRow = (over = {}) => ({
  id: CONSENT_ID, org_id: ORG, client_id: CLIENT, kind: "soft_pull_consent",
  consent_text: SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text,
  consent_version: CURRENT_SOFT_PULL_VERSION,
  granted_by_kind: "staff", granted_by_account_id: null, granted_by_staff_id: STAFF,
  capture_method: "typed", granted_name: "Dana Client",
  captured_ip: null, captured_user_agent: null, document_id: null,
  granted_at: new Date(Date.now() - 60_000), expires_at: null,
  revoked_at: null, revoked_reason: null, revoked_by_kind: null,
  revoked_by_account_id: null, revoked_by_staff_id: null,
  created_at: new Date(), updated_at: new Date(), is_valid: true,
  ...over
});

const INSERT = /INSERT INTO client_consents/i;
const SELECT = /FROM client_consents/i;
const UPDATE = /UPDATE client_consents/i;
const OWNS = /FROM clients WHERE id/i;

// ── DATABASE_URL really is unset ───────────────────────────────────────────

test("this file never reaches a real database, whatever DATABASE_URL says", async () => {
  /* The claim is that these rules are proven on EVERY pass, including the
     passes with no database — so the suite must neither need DATABASE_URL nor
     be affected by it.
   *
   * Asserting `DATABASE_URL === undefined` was the first version of this test
   * and it was wrong: CLAUDE.md §12 tells you to verify the suite WITH a real
   * Postgres, and under that instruction this test failed while everything it
   * was guarding still worked. A guard that fires on the recommended workflow
   * trains people to ignore it.
   *
   * So it proves the real property instead. DATABASE_URL is pointed at an
   * address nothing is listening on for the duration of one request. If any
   * code path reached the actual pool rather than the stub, it would fail to
   * connect and this would not return 200. */
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nonexistent";
  try {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);
    assert.equal(res.statusCode, 200,
      "the handler reached something other than the stub — this suite has grown a real database dependency");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    db.query = realQuery;
  }
});

// ── authentication ─────────────────────────────────────────────────────────

describe("who may reach the endpoint", () => {
  test("no session is a 401 and touches no consent table", async () => {
    stubDb({ session: null });
    const res = mkRes();
    await handler(mkReq({ headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.ok(!calls.some((c) => SELECT.test(c.text)));
  });

  test("an invalid token is a 401", async () => {
    stubDb({ session: null });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 401);
  });

  test("a method other than GET or POST is a 405 with an allow header", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ method: "DELETE" }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

// ── the role gate is a real second call ────────────────────────────────────

describe("the role gate", () => {
  for (const role of ["setter", "inquiry_specialist", "partner", "recruiter", "", null]) {
    test(`a ${JSON.stringify(role)} staff session is refused with 403 and writes nothing`, async () => {
      // These roles pass requireAuth — they are valid sessions. The gate that
      // stops them is the SECOND call, which is the one api/read/tradelines.mjs
      // was missing when it passed { roles } to requireAuth and had it dropped.
      stubDb({ session: { role } });
      const res = mkRes();
      await handler(mkReq({
        method: "POST",
        body: { client_id: CLIENT, capture_method: "checkbox" }
      }), res);

      assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} got past the gate`);
      assert.ok(!calls.some((c) => INSERT.test(c.text)),
        `role ${JSON.stringify(role)} recorded a consent`);
    });
  }

  for (const role of ["owner", "admin", "closer", "funding_advisor"]) {
    test(`a ${role} may capture`, async () => {
      stubDb({ session: { role }, answers: [[INSERT, { rows: [consentRow()] }]] });
      const res = mkRes();
      await handler(mkReq({
        method: "POST",
        body: { client_id: CLIENT, capture_method: "typed", granted_name: "Dana Client" }
      }), res);
      assert.equal(res.statusCode, 200, `${role} was refused: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
    });
  }

  /* THE CSM IS DELIBERATELY NOT IN THE PULL-EQUIVALENT SET. They run the
     recorded calls, so they record the two conversation consents — and a
     credit-pull consent is not one of them. Widening CONSENT_ROLES to include
     them was the first attempt at this and it would have handed the CSM the
     key that unlocks a pull. These two tests are why that cannot come back. */

  test("a csm may capture a call_recording consent", async () => {
    stubDb({ session: { role: "csm" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, kind: "call_recording", capture_method: "typed", granted_name: "Dana Client" }
    }), res);
    assert.equal(res.statusCode, 200, `csm was refused: ${JSON.stringify(res.body)}`);
  });

  test("a csm may NOT capture a soft-pull consent — that is the key to a credit pull", async () => {
    stubDb({ session: { role: "csm" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, kind: "soft_pull_consent", capture_method: "typed", granted_name: "Dana Client" }
    }), res);
    assert.equal(res.statusCode, 403,
      "a csm capturing a soft-pull consent is a way around the narrower role set on the pull endpoint");
    assert.equal(res.body.code, "role_may_not_capture_this_kind");
  });

  test("the capture role set matches the soft-pull role set exactly", async () => {
    // A wider set here would be a way around the narrower one on the pull
    // endpoint, because a consent is the thing that unlocks the pull.
    const fs = await import("node:fs");
    const url = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const read = (p) => fs.readFileSync(path.resolve(here, p), "utf8");
    const setOf = (src, name) => {
      const m = new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`).exec(src);
      return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort();
    };
    assert.deepEqual(
      setOf(read("../../api/consent/capture.mjs"), "CONSENT_ROLES"),
      setOf(read("../../api/finance/soft-pull.mjs"), "SOFT_PULL_ROLES"),
      "the consent and soft-pull role sets have drifted apart — one is now a way around the other"
    );
  });
});

// ── org scoping comes from the session ─────────────────────────────────────

describe("org scoping", () => {
  test("the org in the query string is ignored — the session's org is used", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT, org_id: OTHER_ORG } }), res);

    assert.equal(res.statusCode, 200);
    const read = calls.find((c) => SELECT.test(c.text));
    assert.equal(read.params[0], ORG, "the query-string org reached the database");
    assert.ok(!read.params.includes(OTHER_ORG), "the caller's org appeared in the query");
  });

  test("the org in the POST body is ignored — the session's org is used", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, org_id: OTHER_ORG, capture_method: "checkbox" }
    }), res);

    assert.equal(res.statusCode, 200);
    const ins = calls.find((c) => INSERT.test(c.text));
    assert.equal(ins.params[0], ORG, "the body org was written to the row");
    assert.ok(!ins.params.includes(OTHER_ORG));
  });

  test("a session with no org is refused, not defaulted", async () => {
    // Fail closed. Picking a default org would file the consent under the wrong
    // tenant and gate the wrong tenant's credit pulls.
    stubDb({ session: { orgId: null, role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /org_id is required/);
    assert.ok(!calls.some((c) => SELECT.test(c.text) || INSERT.test(c.text)));
  });
});

// ── a staff principal cannot cross into another company ────────────────────

describe("the client must be in the caller's own org", () => {
  /* THE HOLE THIS CLOSES. ownsClient() used to return `true` for ANY staff
     principal, with no query at all, while api/finance/soft-pull.mjs and
     api/finance/crs-pull.mjs both checked the clients row. Because the write
     stamps the CALLER's org onto the consent, an employee at org A could file a
     consent naming org B's consumer — and since a consent is what unlocks a
     credit pull, the looser endpoint was a way around the stricter one.

     GET AND POST ARE TESTED SEPARATELY AND THAT IS THE POINT, not duplication.
     ownsClient() is now async, so a call site that forgot its `await` gets a
     Promise back, and a Promise is truthy — `!promise` is false and the refusal
     never fires. One missed await disables the check on exactly one method
     while the other method's test still passes. */

  test("GET for a client outside the session's org is a 403 and reads no consent", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, owns: false });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: OTHER_CLIENT } }), res);

    assert.equal(res.statusCode, 403, "a staff session reached another company's client");
    assert.equal(res.body.error, "forbidden");
    assert.ok(!calls.some((c) => SELECT.test(c.text)),
      "another company's consent history was read before the refusal");
  });

  test("POST for a client outside the session's org is a 403 and writes nothing", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, owns: false });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: OTHER_CLIENT, capture_method: "typed", granted_name: "Dana Client" }
    }), res);

    assert.equal(res.statusCode, 403, "a staff session recorded a consent for another company's client");
    assert.ok(!calls.some((c) => INSERT.test(c.text)),
      "a consent row was written naming a client the caller does not have");
  });

  test("a revoke for a client outside the session's org is a 403 and revokes nothing", async () => {
    // The revoke path is scoped by org inside revokeConsent() as well, but the
    // client named on the request is checked here first — otherwise the 403 and
    // the 409 leak apart and tell a prober which uuids are real.
    stubDb({ session: { orgId: ORG, role: "closer" }, owns: false });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: OTHER_CLIENT, action: "revoke",
        consent_id: CONSENT_ID, reason: "client withdrew on a call"
      }
    }), res);

    assert.equal(res.statusCode, 403);
    assert.ok(!calls.some((c) => UPDATE.test(c.text)));
  });

  test("the org check is scoped by the SESSION's org, not by anything in the request", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, org_id: OTHER_ORG, capture_method: "checkbox" }
    }), res);

    assert.equal(res.statusCode, 200);
    const check = calls.find((c) => OWNS.test(c.text));
    assert.ok(check, "the endpoint did not check the client against an org at all");
    assert.equal(check.params[0], CLIENT);
    assert.equal(check.params[1], ORG, "the request's org was used to scope the check");
  });

  test("the check runs before anything is read or written, on GET and on POST", async () => {
    for (const req of [
      mkReq({ query: { client_id: CLIENT } }),
      mkReq({ method: "POST", body: { client_id: CLIENT, capture_method: "checkbox" } })
    ]) {
      stubDb({
        session: { role: "closer" },
        answers: [[SELECT, { rows: [consentRow()] }], [INSERT, { rows: [consentRow()] }]]
      });
      const res = mkRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200);

      const owns = calls.findIndex((c) => OWNS.test(c.text));
      const touch = calls.findIndex((c) => SELECT.test(c.text) || INSERT.test(c.text));
      assert.ok(owns >= 0, `${req.method} skipped the org check entirely`);
      assert.ok(owns < touch, `${req.method} touched client_consents before checking the org`);
    }
  });

  test("the consent org check is the same query the soft-pull endpoint runs", async () => {
    /* Same idea as the role-set test above: the two endpoints have to stay
       identical, because the consent is what unlocks the pull. Comparing the
       source text catches a drift that no behavioural test would, since both
       files would still pass their own suites while checking different things. */
    const fs = await import("node:fs");
    const url = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const read = (p) => fs.readFileSync(path.resolve(here, p), "utf8");
    const QUERY = "SELECT 1 FROM clients WHERE id = $1 AND org_id = $2";

    for (const f of ["../../api/consent/capture.mjs", "../../api/finance/soft-pull.mjs"]) {
      assert.ok(read(f).includes(QUERY),
        `${f} no longer scopes its client check by org with the shared query`);
    }
  });
});

// ── the words are never taken from the body ────────────────────────────────

describe("the consent wording is server-owned", () => {
  test("a consent_text in the body is ignored, and the server's words are stored", async () => {
    // THE MOST IMPORTANT TEST IN THIS FILE. If the body could set the text,
    // anybody who can reach this endpoint could record that a consumer agreed
    // to a sentence they never saw.
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    const forged = "I agree to a HARD credit pull and waive all my rights.";
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "typed", granted_name: "Dana Client",
        consent_text: forged
      }
    }), res);

    assert.equal(res.statusCode, 200);
    const ins = calls.find((c) => INSERT.test(c.text));
    assert.ok(!ins.params.includes(forged), "the body's wording was written to the row");
    assert.equal(ins.params[3], SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text,
      "the stored words are not the server's own copy of that version");
    assert.equal(ins.params[4], CURRENT_SOFT_PULL_VERSION);
  });

  test("an unknown consent_version is refused, not silently upgraded to the current one", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "checkbox", consent_version: "soft-pull-v99"
      }
    }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "consent_version_unknown");
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });

  test("GET returns the disclosure so the screen never holds its own copy", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.disclosure.version, CURRENT_SOFT_PULL_VERSION);
    assert.equal(res.body.disclosure.text, SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text);
  });
});

// ── attribution comes from the session ─────────────────────────────────────

describe("attribution", () => {
  test("a staff capture is attributed to the session's staff id, not the body's", async () => {
    stubDb({ session: { staffId: STAFF, role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "checkbox",
        granted_by_staff_id: "99999999-9999-9999-9999-999999999999",
        granted_by_kind: "client"
      }
    }), res);

    const ins = calls.find((c) => INSERT.test(c.text));
    // [org, client, kind, text, version, granterKind, accountId, staffId, ...]
    assert.equal(ins.params[5], "staff", "the body redirected the attribution kind");
    assert.equal(ins.params[7], STAFF);
    assert.equal(ins.params[6], null);
    assert.ok(!ins.params.includes("99999999-9999-9999-9999-999999999999"),
      "a body-supplied staff id was written as the granter");
  });

  test("the user agent is read from the request headers, not from the body", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "user-agent": "RealBrowser/1.0" },
      body: {
        client_id: CLIENT, capture_method: "checkbox",
        captured_user_agent: "Forged/9.9", captured_ip: "9.9.9.9"
      }
    }), res);

    const ins = calls.find((c) => INSERT.test(c.text));
    assert.equal(ins.params[11], "RealBrowser/1.0");
    assert.ok(!ins.params.includes("Forged/9.9"), "a body-supplied user agent became evidence");
    assert.ok(!ins.params.includes("9.9.9.9"), "a body-supplied ip became evidence");
  });

  test("x-forwarded-for's first entry is taken as the client ip", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      body: { client_id: CLIENT, capture_method: "checkbox" }
    }), res);
    assert.equal(calls.find((c) => INSERT.test(c.text)).params[10], "203.0.113.7");
  });

  test("a junk x-forwarded-for is dropped rather than stored as a fact", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "x-forwarded-for": "not-an-address" },
      body: { client_id: CLIENT, capture_method: "checkbox" }
    }), res);
    assert.equal(calls.find((c) => INSERT.test(c.text)).params[10], null);
  });
});

// ── input validation ───────────────────────────────────────────────────────

describe("input validation", () => {
  for (const bad of [undefined, "", "not-a-uuid", "123", "22222222-2222-2222-2222"]) {
    test(`client_id ${JSON.stringify(bad)} is a 400 on GET and on POST`, async () => {
      for (const req of [
        mkReq({ query: { client_id: bad } }),
        mkReq({ method: "POST", body: { client_id: bad, capture_method: "checkbox" } })
      ]) {
        stubDb({ session: { role: "closer" } });
        const res = mkRes();
        await handler(req, res);
        assert.equal(res.statusCode, 400);
        assert.ok(!calls.some((c) => INSERT.test(c.text)));
      }
    });
  }

  test("an unknown kind is refused rather than coerced to the default", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT, kind: "vibes" } }), res);
    assert.equal(res.statusCode, 400);
  });

  test("an invented capture method is a 400 and writes nothing", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, capture_method: "verbal" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "capture_method_invalid");
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });

  test("a typed capture with no name is a 400", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, capture_method: "typed" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "granted_name_required");
  });

  test("an unknown action is refused rather than treated as a grant", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, action: "approve", capture_method: "checkbox" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });
});

// ── revocation ─────────────────────────────────────────────────────────────

describe("revocation", () => {
  test("a revoke with no reason is refused", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "reason_required");
    assert.ok(!calls.some((c) => UPDATE.test(c.text)));
  });

  test("a revoke is scoped by the session's org", async () => {
    stubDb({
      session: { orgId: ORG, role: "closer" },
      answers: [[UPDATE, { rows: [consentRow({ revoked_at: new Date(), revoked_reason: "withdrew" })] }]]
    });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID,
        reason: "client withdrew on a call", org_id: OTHER_ORG
      }
    }), res);

    assert.equal(res.statusCode, 200);
    const upd = calls.find((c) => UPDATE.test(c.text));
    assert.equal(upd.params[1], ORG, "the revoke was scoped by the body's org");
    assert.equal(res.body.consent.valid, false);
  });

  test("revoking something not live is a 409, not a success", async () => {
    stubDb({ session: { role: "closer" }, answers: [[UPDATE, { rows: [] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID, reason: "withdrew" }
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "not_revocable");
  });
});

// ── the GET answer ─────────────────────────────────────────────────────────

describe("the status read", () => {
  test("returns the verdict and the history together", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status.valid, true);
    assert.equal(res.body.kind, "soft_pull_consent");
    assert.ok(Array.isArray(res.body.history));
  });

  test("a client with no consent reads as none, not as an error", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: OTHER_CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status.valid, false);
    assert.equal(res.body.status.reason, "none_on_file");
  });
});


// ── the client-approval link, and the identity boolean ─────────────────────

/* WHAT THESE PROVE, AND WHY THEY ARE IN THIS FILE RATHER THAN A NEW ONE.
 *
 * OWNER DECISION, 2026-08-19: identity capture is CLIENT SELF-SERVE. Staff
 * never see, type or handle a Social Security number. A closer hands over a
 * signed link; the client fills the form in themselves. So the GET here gained
 * exactly two things — a freshly signed link, and a yes/no on whether an
 * identity is already held — and the third test below is the one that matters
 * most: NOTHING ELSE about that identity may come out of this endpoint.
 *
 * These are .test.mjs and not .pg.test.mjs for the reason in this file's own
 * header: with DATABASE_URL unset the pg tests skip and the suite still reports
 * zero failures, so a PII rule proven only there is a PII rule unproven on most
 * runs. The stub answers the pii_identity read like any other query. */

const APPROVE_SECRET = "s".repeat(48);
const PII_KEY = Buffer.alloc(32, 7).toString("base64");
const IDENTITY = /FROM pii_identity/i;

/* Distinctive junk, on purpose. Every value here is odd enough that finding it
   anywhere inside the serialized response is proof of a leak rather than a
   coincidence — which is what lets the deny-list scan the whole body instead of
   three named fields. The two-letter state is the one exception and is left out
   of the value scan: "AZ" is too short to be evidence of anything. It is
   covered by the key scan instead. */
const FAKE = Object.freeze({
  ssn: "123456789",
  last4: "6789",
  dob: "1980-02-29",
  line1: "77 Nowhere Ln",
  city: "Zzyzxville",
  state: "AZ",
  postal: "85001"
});

/* A pii_identity row as the table really holds one: the SSN as ciphertext, the
   date of birth and the addresses in the clear. Encrypted for real, with the
   same throwaway key src/pii/index.test.mjs uses, so readIdentity() genuinely
   decrypts it and genuinely produces an ssn_last4 — a deny-list run against a
   record that could not be decrypted would pass without proving anything. */
function identityRow(over = {}) {
  return {
    id: "77777777-7777-7777-7777-777777777777",
    org_id: ORG,
    client_id: CLIENT,
    ssn_enc: encryptSsn(FAKE.ssn, { clientId: CLIENT, env: { PII_ENC_KEY: PII_KEY } }),
    dob: FAKE.dob,
    addresses: [{
      addressLine1: FAKE.line1, city: FAKE.city, state: FAKE.state, postalCode: FAKE.postal
    }],
    created_at: new Date(),
    updated_at: new Date(),
    ...over
  };
}

/* withEnv — set process.env for the length of one call and put it back exactly
   as it was, including "it was not set at all". Same shape as the DATABASE_URL
   test at the top of this file. node:test runs the tests in a file one after
   another, so a mutation restored in a finally cannot reach another test. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  const put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  for (const [k, v] of Object.entries(vars)) put(k, v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) put(k, v);
  }
}

/* Every key at every depth of the response, so the scan cannot be defeated by
   nesting the leak one level down. */
function everyKey(value, out = []) {
  if (Array.isArray(value)) { value.forEach((v) => everyKey(v, out)); return out; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.push(k); everyKey(v, out); }
  }
  return out;
}

describe("the client approval link", () => {
  test("a staff GET carries a link that really opens the client's approval form", async () => {
    const body = await withEnv(
      { DOCUMENT_URL_SECRET: APPROVE_SECRET, PUBLIC_BASE_URL: "https://fundhub.test" },
      async () => {
        stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
        const res = mkRes();
        await handler(mkReq({ query: { client_id: CLIENT } }), res);
        assert.equal(res.statusCode, 200);
        return res.body;
      }
    );

    const link = body.approval_link;
    assert.ok(link, "no approval link was minted for a staff GET");
    assert.equal(link.unavailable_reason, null);
    assert.ok(
      link.url.startsWith("https://fundhub.test/app/soft-pull-approve.html?"),
      `the link does not point at the client form: ${link.url}`
    );

    /* THE REAL ASSERTION. Not "a url-shaped string came back" — the signature
       in it verifies, which is the only thing that decides whether the page
       opens for the client or shows them "this link is invalid". */
    const u = new URL(link.url);
    const payload = verifySoftPullApproveToken({
      orgId: u.searchParams.get("org"),
      clientId: u.searchParams.get("client"),
      exp: u.searchParams.get("exp"),
      sig: u.searchParams.get("sig"),
      secret: APPROVE_SECRET
    });
    assert.ok(payload, "the minted link does not verify — the client would be turned away");
    assert.equal(payload.orgId, ORG);
    assert.equal(payload.clientId, CLIENT);

    // The expiry the screen shows has to be the expiry the link actually has.
    assert.equal(new Date(link.expires_at).getTime(), payload.expiresAt * 1000);
    const hoursOut = (new Date(link.expires_at).getTime() - Date.now()) / 3_600_000;
    assert.ok(hoursOut > 5.5 && hoursOut < 6.5, `expiry is ${hoursOut}h out, expected the 6h default`);
  });

  test("with no base url configured the link falls back to the live site", async () => {
    /* publicBaseUrl() in the handler is a byte-for-byte copy of the one at
       src/sales/closer-deck.mjs:331-335, because that file mints this same link
       for the emailed version of this flow. A copied link and an emailed link
       have to resolve to the same place. */
    const body = await withEnv(
      { DOCUMENT_URL_SECRET: APPROVE_SECRET, PUBLIC_BASE_URL: undefined, URL: undefined },
      async () => {
        stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
        const res = mkRes();
        await handler(mkReq({ query: { client_id: CLIENT } }), res);
        return res.body;
      }
    );
    assert.ok(body.approval_link.url.startsWith("https://fundhub.ai/app/soft-pull-approve.html?"),
      body.approval_link.url);
  });

  for (const [label, value] of [
    ["unset", undefined],
    ["too short to sign with", "nowhere near thirty-two"]
  ]) {
    test(`a signing key that is ${label} leaves the link null WITH WORDS, and does not take the screen down`, async () => {
      /* FAIL SOFT, VISIBLY. secretFromEnv() throws
         (src/documents/signed-url.mjs:29-37). If that throw escaped, the whole
         consent answer would 500 — and this endpoint is also the only thing
         telling a closer whether the client has consented at all. A missing
         config value must not blank that out. */
      const out = await withEnv({ DOCUMENT_URL_SECRET: value }, async () => {
        stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
        const res = mkRes();
        await handler(mkReq({ query: { client_id: CLIENT } }), res);
        return res;
      });

      assert.equal(out.statusCode, 200, "a missing signing key took the consent screen down");
      assert.equal(out.body.ok, true);
      assert.equal(out.body.status.valid, true, "the consent answer was lost along with the link");
      assert.ok(Array.isArray(out.body.history));

      const link = out.body.approval_link;
      assert.equal(link.url, null);
      assert.equal(link.expires_at, null);

      const why = link.unavailable_reason;
      assert.ok(typeof why === "string" && why.length > 40 && /\s/.test(why),
        `the reason is a machine code, not something to show a closer: ${JSON.stringify(why)}`);
      assert.match(why, /DOCUMENT_URL_SECRET/,
        "the reason does not name the setting, so nobody can act on it");
      assert.ok(!why.includes(APPROVE_SECRET), "the reason quoted a secret value");
    });
  }

  test("a client's own session gets no bearer link minted into it", async () => {
    /* The link is a bearer credential — the HMAC in the url is the whole
       credential. A signed-in client can already reach the form, so minting one
       into their response would put a credential somewhere it has no reason to
       be. Staff get it because handing it over IS the flow. */
    const body = await withEnv({ DOCUMENT_URL_SECRET: APPROVE_SECRET }, async () => {
      stubDb({
        session: null,
        answers: [
          [/UPDATE account_sessions/i, { rows: [{ id: "as-1", account_id: "acct-1", org_id: ORG, expires_at: new Date(Date.now() + 3_600_000) }] }],
          [/FROM accounts WHERE id/i, { rows: [{
            id: "acct-1", org_id: ORG, kind: "client", email: "c@example.com",
            name: "Dana Client", status: "active",
            client_id: CLIENT, affiliate_id: null, partner_id: null
          }] }],
          [SELECT, { rows: [consentRow()] }]
        ]
      });
      const res = mkRes();
      await handler(mkReq({ query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 200, `the client session was refused: ${JSON.stringify(res.body)}`);
      return res.body;
    });
    assert.equal(body.approval_link, null, "a signed link was minted into a client's own response");
  });

  test("no link and no identity read for a consent kind that has neither", async () => {
    /* dispute_authorization has no approval page behind it and no bureau pull.
       Minting the soft-pull link there would hand a client the wrong form, and
       reading pii_identity on that request would touch the identity table for
       no reason at all. */
    const body = await withEnv({ DOCUMENT_URL_SECRET: APPROVE_SECRET }, async () => {
      stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [] }]] });
      const res = mkRes();
      await handler(mkReq({ query: { client_id: CLIENT, kind: "dispute_authorization" } }), res);
      assert.equal(res.statusCode, 200);
      return res.body;
    });
    assert.equal(body.approval_link, null);
    assert.equal(body.identity, null);
    assert.ok(!calls.some((c) => IDENTITY.test(c.text)),
      "the identity table was read on a request that has nothing to do with a credit pull");
  });
});

describe("whether an identity is on file", () => {
  const cases = [
    ["no identity row at all", [], false],
    ["a row with encrypted SSN bytes", [identityRow()], true],
    ["a row that exists but holds no SSN", [identityRow({ ssn_enc: null })], false]
  ];

  for (const [label, rows, expected] of cases) {
    test(`${label} reads as ${expected}`, async () => {
      /* The pull refuses on the SSN specifically — src/finance/crs-pull.mjs
         :548-559 loads the identity and gives up when there is none. A row with
         a date of birth and an address but no number is still a refusal, so it
         has to read as false here or the screen would tell a closer they are
         clear when they are not. */
      const body = await withEnv({ PII_ENC_KEY: PII_KEY, DOCUMENT_URL_SECRET: APPROVE_SECRET }, async () => {
        stubDb({
          session: { role: "closer" },
          answers: [[SELECT, { rows: [consentRow()] }], [IDENTITY, { rows }]]
        });
        const res = mkRes();
        await handler(mkReq({ query: { client_id: CLIENT } }), res);
        assert.equal(res.statusCode, 200);
        return res.body;
      });
      assert.deepEqual(body.identity, { on_file: expected });
    });
  }

  test("the presence check does not write an access-log row", async () => {
    /* readIdentity() discloses nothing and is deliberately not logged
       (src/pii/index.mjs, rule 2). revealSsn() IS logged. Using the logged one
       for a presence check would bury the entries an audit actually cares about
       under thousands of screen loads where nobody looked at anything. */
    await withEnv({ PII_ENC_KEY: PII_KEY, DOCUMENT_URL_SECRET: APPROVE_SECRET }, async () => {
      stubDb({
        session: { role: "closer" },
        answers: [[SELECT, { rows: [consentRow()] }], [IDENTITY, { rows: [identityRow()] }]]
      });
      const res = mkRes();
      await handler(mkReq({ query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 200);
    });
    assert.ok(!calls.some((c) => /pii_access_log/i.test(c.text)),
      "a page load was recorded as somebody accessing an SSN");
  });
});

describe("no identity data leaves this endpoint", () => {
  test("NOTHING from the identity record appears anywhere in the GET response", async () => {
    /* THE MOST IMPORTANT TEST FOR THE OWNER DECISION OF 2026-08-19. Staff never
       see a Social Security number, and this endpoint is the one a staff screen
       calls. A boolean and a link expiry are the entire permitted surface.

       WRITTEN AS A DENY-LIST OVER THE WHOLE SERIALIZED BODY, not as a check of
       three named fields, and that is the point: a field added to this response
       next month cannot leak past it. Two scans, because a leak has two shapes
       — the VALUE somewhere in the payload, and a KEY that means identity data
       wherever it is nested. */
    const body = await withEnv({ PII_ENC_KEY: PII_KEY, DOCUMENT_URL_SECRET: APPROVE_SECRET }, async () => {
      stubDb({
        session: { role: "closer" },
        answers: [[SELECT, { rows: [consentRow()] }], [IDENTITY, { rows: [identityRow()] }]]
      });
      const res = mkRes();
      await handler(mkReq({ query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 200);
      return res.body;
    });

    /* NOT VACUOUS. If the identity read had silently stopped happening, every
       assertion below would pass while proving nothing. This says the record
       really was read, really was decryptable, and really did contain the
       values being denied.

       DELIBERATELY NOT A deepEqual ON THE WHOLE OBJECT. An exact-shape check
       here would fail on any added field before the scans below ever ran, so
       the scans — the part that generalises to a field nobody has written yet —
       would never be the thing that caught a leak. The exact shape is pinned in
       "whether an identity is on file" above; this test's job is the scan. */
    assert.equal(body.identity && body.identity.on_file, true,
      "the identity record was never read, so this test proves nothing");

    const serialized = JSON.stringify(body);

    for (const [what, value] of Object.entries(FAKE)) {
      if (what === "state") continue; // two letters — see the note on FAKE
      assert.ok(!serialized.includes(value),
        `the ${what} from the identity record came back in the response`);
    }
    assert.ok(!serialized.includes("123-45-6789"), "a formatted SSN came back in the response");
    assert.ok(!/\b\d{9}\b/.test(serialized), "a nine-digit run came back in the response");
    assert.ok(!serialized.includes("Buffer"), "raw ciphertext bytes came back in the response");

    const FORBIDDEN_KEY = /ssn|social|dob|birth|address|postal|zip|city/i;
    for (const key of everyKey(body)) {
      assert.ok(!FORBIDDEN_KEY.test(key),
        `the response grew a field named ${JSON.stringify(key)} — identity data must not leave this endpoint`);
    }
  });
});

// ── F35 · A CLIENT MAY ONLY AUTHORIZE DISPUTE LETTERS IF THEY BOUGHT THEM ──

describe("the dispute-authorization gate on the POST", () => {
  /* THE SERVER SIDE OF F35, and until now the untested side. The portal card is
     hidden by api/read/portal-summary.mjs, but a hidden card is a screen rule:
     anybody can post this body by hand. The refusal that actually holds is the
     one below, and these tests are what proves it exists.

     Owner-set 2026-09-03: "It's only for repair and for the funding offer. If
     they're getting deliverables, meaning e-products and courses, they don't
     need to sign for shit." */

  const ENT = /v_client_entitlements/i;
  const TIER = /SELECT outcome_tier FROM clients/i;

  /* A signed-in CLIENT holding the entitlement codes given, and with `tier` on
     their client row.

     IT DOES NOT USE stubDb(), AND THAT IS THE WHOLE POINT. stubDb answers
     OWNS — /FROM clients WHERE id/ — before it consults `answers`, and the tier
     read this test has to reach is `SELECT outcome_tier FROM clients WHERE
     id = $1 AND org_id = $2`, which that pattern swallows. Routed through
     stubDb, every tier below came back undefined and the REPAIR_ONLY case
     passed against the BROKEN gate — a test that proves nothing, written to
     prove the one thing that had already been shipped wrong twice. So the tier
     is answered first here, ahead of OWNS.

     THE TIER IS ANSWERED ON PURPOSE. The right behaviour does not need it. It is
     here so that a gate which went back to reading the tier gets the DANGEROUS
     answer and these tests catch it, rather than a null that makes every case
     pass by accident.

     (A client principal never runs the OWNS query at all — ownsClient() compares
     principal.clientId directly for a client — so nothing else needs it.) */
  const clientHolding = (codes, tier = null) => {
    calls = [];
    db.query = async (text, params) => {
      calls.push({ text, params });
      if (/UPDATE account_sessions/i.test(text)) {
        return { rows: [{ id: "as-1", account_id: "acct-1", org_id: ORG, expires_at: new Date(Date.now() + 3_600_000) }] };
      }
      if (/FROM accounts WHERE id/i.test(text)) {
        return { rows: [{
          id: "acct-1", org_id: ORG, kind: "client", email: "c@example.com",
          name: "Dana Client", status: "active",
          client_id: CLIENT, affiliate_id: null, partner_id: null
        }] };
      }
      if (TIER.test(text)) return { rows: [{ outcome_tier: tier }] };
      if (OWNS.test(text)) return { rows: [{ "?column?": 1 }] };
      if (ENT.test(text)) return { rows: codes.includes(params[2]) ? [{ "?column?": 1 }] : [] };
      if (INSERT.test(text)) {
        return { rows: [consentRow({ kind: "dispute_authorization", granted_by_kind: "client" })] };
      }
      return { rows: [] };
    };
  };

  const post = async () => {
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, kind: "dispute_authorization", action: "grant",
              capture_method: "typed", granted_name: "Dana Client" }
    }), res);
    return res;
  };

  test("a COURSE-ONLY buyer is refused, and nothing is written", async () => {
    clientHolding(["funding-mastery-course"]);
    const res = await post();
    assert.equal(res.statusCode, 403, `the course buyer was allowed to sign: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, "not_on_dispute_path");
    assert.ok(!calls.some((c) => INSERT.test(c.text)),
      "a consent row was written for somebody who never bought dispute work");
  });

  test("a course-only buyer whose PULL graded REPAIR_ONLY is refused too", async () => {
    /* THE LEAK THIS BLOCK EXISTS FOR. clients.outcome_tier is written by a real
       credit pull (src/finance/crs-pull.mjs persistOutcomeTier), and the gate
       used to reach REPAIR_ONLY through onRepairPath() and answer yes — so a
       course buyer with a weak credit file could sign after all. */
    clientHolding(["funding-mastery-course"], "REPAIR_ONLY");
    const res = await post();
    assert.equal(res.statusCode, 403,
      `REPAIR_ONLY on a course-only buyer opened the door: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, "not_on_dispute_path");
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });

  test("a course-only buyer whose PULL graded FULL_FUNDING is refused too", async () => {
    clientHolding(["funding-mastery-course"], "FULL_FUNDING");
    const res = await post();
    assert.equal(res.statusCode, 403, `FULL_FUNDING opened the door: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, "not_on_dispute_path");
  });

  test("a client who bought nothing at all is refused", async () => {
    clientHolding([]);
    const res = await post();
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "not_on_dispute_path");
  });

  for (const [label, code] of [["repair", "metro2-letter-pack"], ["the funding offer", "funding-snapshot"]]) {
    test(`a ${label} buyer IS allowed, and the row is written`, async () => {
      /* NOT VACUOUS. If the gate simply refused everybody, the four tests above
         would still pass and the two real customers would silently lose the
         ability to authorize their own letters. */
      clientHolding([code]);
      const res = await post();
      assert.equal(res.statusCode, 200, `the ${label} buyer was refused: ${JSON.stringify(res.body)}`);
      assert.ok(calls.some((c) => INSERT.test(c.text)), "no consent row was written");
    });
  }

  test("STAFF are not narrowed — a recorded authorization still goes through", async () => {
    /* A person on a call, looking at the file, exercising judgment. The same
       roles already decide whether to order the pull. Only the self-serve path
       is closed. */
    stubDb({
      session: { role: "closer" },
      answers: [[INSERT, { rows: [consentRow({ kind: "dispute_authorization" })] }], [SELECT, { rows: [] }]]
    });
    const res = await post();
    assert.equal(res.statusCode, 200, `staff were blocked: ${JSON.stringify(res.body)}`);
    assert.ok(!calls.some((c) => ENT.test(c.text)),
      "the entitlement gate ran on a staff capture, which is not what it is for");
  });

  test("the refusal is a sentence a client can read, not a code", async () => {
    clientHolding(["funding-mastery-course"]);
    const res = await post();
    const msg = res.body.error;
    assert.ok(typeof msg === "string" && msg.length > 30 && /\s/.test(msg), String(msg));
    assert.ok(!/entitlement|outcome_tier|403/i.test(msg),
      `the refusal talks about the database instead of the customer: ${msg}`);
  });
});

// ── ZU-P · THE SIGNATURE STARTS THE LETTERS ────────────────────────────────

describe("a signed dispute authorization starts the Repair letters", () => {
  /* The letter writer refuses with `no_authorization` when a repair client's
     documents land before they sign, saves nothing, and used to never try
     again. The signing box now retries it, but only for a card waiting on
     'analysis' (src/repair/start-letters.mjs). The signature is saved FIRST and
     nothing the writer does may change the answer the client gets.

     The writer here is the REAL one, run against the stub. Its first questions
     are a signed contract (`FROM contracts`) and then the consent; once it is
     authorized it looks for letters already on file (`FROM dispute_letters dl`).
     Seeing that last query after the INSERT is the proof the writer was asked. */

  const STAGE = /SELECT ps\.key AS stage_key/i;
  const CONTRACTS = /FROM contracts/i;
  const EXISTING_LETTERS = /FROM dispute_letters dl/i;
  const ENT = /v_client_entitlements/i;

  const disputeBody = () => ({
    client_id: CLIENT, kind: "dispute_authorization", action: "grant",
    capture_method: "typed", granted_name: "Dana Client"
  });

  const postDispute = async (body = disputeBody()) => {
    const res = mkRes();
    await handler(mkReq({ method: "POST", body }), res);
    return res;
  };

  const idx = (re) => calls.findIndex((c) => re.test(c.text));

  /* A staff caller. `stage` is what the repair card read answers (a string, or
     null for no card). `agreement` makes a signed repair contract exist. */
  const staffSigns = ({ stage = "analysis", agreement = false, lettersThrow = false, stageThrows = false } = {}) => {
    const disputeRow = consentRow({ kind: "dispute_authorization" });
    stubDb({
      session: { role: "closer" },
      answers: [
        [INSERT, { rows: [disputeRow] }],
        [STAGE, () => {
          if (stageThrows) throw new Error("card read failed");
          return { rows: stage ? [{ stage_key: stage }] : [] };
        }],
        [CONTRACTS, { rows: agreement ? [{ "?column?": 1 }] : [] }],
        [EXISTING_LETTERS, () => {
          if (lettersThrow) throw new Error("letter table is down");
          return { rows: [{ id: "l-1", bureau: "EX", case_id: "c-1", body_text: "x", rule_ids: [] }] };
        }],
        [SELECT, { rows: [disputeRow] }]
      ]
    });
  };

  test("PASS: a card on analysis runs the writer after the signature is stored", async () => {
    staffSigns({ stage: "analysis" });
    const res = await postDispute();
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.consent.kind, "dispute_authorization");
    const stored = idx(INSERT);
    assert.ok(stored >= 0, "the consent was not stored");
    assert.ok(idx(STAGE) > stored, "the card was read before the signature was stored");
    assert.ok(idx(EXISTING_LETTERS) > idx(STAGE),
      "the letter writer was not asked, though the card is waiting on analysis");
  });

  test("PASS: the client's own signature in the portal starts them too", async () => {
    const disputeRow = consentRow({ kind: "dispute_authorization", granted_by_kind: "client" });
    calls = [];
    db.query = async (text, params) => {
      calls.push({ text, params });
      if (/UPDATE account_sessions/i.test(text)) {
        return { rows: [{ id: "as-1", account_id: "acct-1", org_id: ORG, expires_at: new Date(Date.now() + 3_600_000) }] };
      }
      if (/FROM accounts WHERE id/i.test(text)) {
        return { rows: [{
          id: "acct-1", org_id: ORG, kind: "client", email: "c@example.com", name: "Dana Client",
          status: "active", client_id: CLIENT, affiliate_id: null, partner_id: null
        }] };
      }
      if (ENT.test(text)) return { rows: params[2] === "metro2-letter-pack" ? [{ "?column?": 1 }] : [] };
      if (INSERT.test(text)) return { rows: [disputeRow] };
      if (STAGE.test(text)) return { rows: [{ stage_key: "analysis" }] };
      if (CONTRACTS.test(text)) return { rows: [] };
      if (EXISTING_LETTERS.test(text)) return { rows: [{ id: "l-1", bureau: "EX", case_id: "c-1", body_text: "x", rule_ids: [] }] };
      if (SELECT.test(text)) return { rows: [disputeRow] };
      return { rows: [] };
    };
    const res = await postDispute();
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(idx(EXISTING_LETTERS) > idx(INSERT), "the portal signature did not start the writer");
  });

  test("FAIL twin: a card that is not on analysis runs no writer", async () => {
    for (const stage of ["intake", "awaiting_documents", "letters_generated", "ready_to_send"]) {
      staffSigns({ stage });
      const res = await postDispute();
      assert.equal(res.statusCode, 200, `${stage}: ${JSON.stringify(res.body)}`);
      assert.ok(idx(STAGE) >= 0, `${stage}: the card was not read`);
      assert.equal(idx(CONTRACTS), -1, `${stage}: the writer ran on a card that is not waiting for letters`);
      assert.equal(idx(EXISTING_LETTERS), -1);
    }
  });

  test("FAIL twin: a client with no repair card runs no writer", async () => {
    staffSigns({ stage: null });
    const res = await postDispute();
    assert.equal(res.statusCode, 200);
    assert.equal(idx(CONTRACTS), -1);
    assert.equal(idx(EXISTING_LETTERS), -1);
  });

  test("FAIL twin: a different consent kind never reads the card", async () => {
    staffSigns({ stage: "analysis" });
    const res = await postDispute({
      client_id: CLIENT, kind: "soft_pull_consent", action: "grant",
      capture_method: "typed", granted_name: "Dana Client"
    });
    assert.equal(res.statusCode, 200);
    assert.equal(idx(STAGE), -1, "a soft-pull consent looked at the repair card");
    assert.equal(idx(CONTRACTS), -1);
  });

  test("FAIL twin: revoking a dispute authorization starts nothing", async () => {
    staffSigns({ stage: "analysis" });
    const res = await postDispute({
      client_id: CLIENT, kind: "dispute_authorization", action: "revoke",
      consent_id: CONSENT_ID, reason: "client asked"
    });
    // The revoke itself is answered by the consent module; what matters is the writer.
    assert.equal(idx(STAGE), -1, `a revoke read the repair card (status ${res.statusCode})`);
    assert.equal(idx(CONTRACTS), -1);
  });

  test("a writer that throws does NOT fail the signature", async () => {
    staffSigns({ stage: "analysis", agreement: true, lettersThrow: true });
    const res = await postDispute();
    assert.equal(res.statusCode, 200, `the signature was lost to a writer failure: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.consent.kind, "dispute_authorization");
    assert.ok(idx(INSERT) >= 0, "the consent was not stored");
    assert.ok(idx(EXISTING_LETTERS) > idx(INSERT), "the writer never ran, so the throw was never exercised");
  });

  test("a card read that throws does NOT fail the signature", async () => {
    staffSigns({ stage: "analysis", stageThrows: true });
    const res = await postDispute();
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.consent.kind, "dispute_authorization");
  });

  test("the response carries nothing about the letters", async () => {
    staffSigns({ stage: "analysis" });
    const res = await postDispute();
    assert.deepEqual(Object.keys(res.body).sort(), ["consent", "ok"]);
  });
});
