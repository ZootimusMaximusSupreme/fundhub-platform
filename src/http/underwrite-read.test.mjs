// GET /api/read/underwrite — the endpoint, against a stubbed database.
//
// NO DATABASE_URL, NO POSTGRES. The handler takes an optional third parameter
// `{ db }`; Netlify and Vercel both call handler(req, res), so production always
// gets the real pool and this file always gets the stub. That seam is the only
// reason these checks run on every pass instead of only on the passes that happen
// to have a database — which is exactly how the requireAuth `roles` hole survived
// two rounds (see src/http/auth-gate.test.mjs).
//
// ⚠️ THIS FILE MUST LIVE UNDER src/. npm test's glob is "src/**" and "scripts/**"
// only; a test placed next to the handler under api/ silently never runs.

import { test, describe } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

import handler from "../../api/read/underwrite.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRADELINE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/* A fake res that records instead of writing. Same surface the Netlify shim
   implements: status().json(), setHeader, end. */
function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    end() { return res; }
  };
  return res;
}

/**
 * A stub db that dispatches on the SQL text. Every query this handler can issue
 * is answered explicitly; anything unrecognised THROWS rather than returning an
 * empty result, so a new query added to the handler cannot silently read as
 * "this client has no data".
 */
function makeDb({ session = {}, client = undefined, tradelines = [], liabilities = [], crs = [], businesses = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      assertBind(sql, params);
      calls.push({ sql, params });

      if (sql.includes("UPDATE sessions")) {
        // verifySession's shape. `session: null` means no valid session.
        if (session === null) return { rows: [] };
        return {
          rows: [{
            session_id: "sess", expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1", org_id: ORG, role: "closer",
            email: "closer@example.com", name: "A Closer", status: "active",
            active_flag: "true",
            ...session
          }]
        };
      }
      if (sql.includes("FROM clients")) {
        return { rows: client === undefined ? [] : [client] };
      }
      if (sql.includes("FROM tradelines")) return { rows: tradelines };
      if (sql.includes("FROM card_liabilities")) return { rows: liabilities };
      if (sql.includes("FROM crs_results")) return { rows: crs };
      if (sql.includes("FROM businesses")) return { rows: businesses };

      throw new Error("stub db: unexpected query:\n" + sql);
    }
  };
}

const req = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer test-token" },
  query: { client_id: CLIENT },
  ...over
});

const CLIENT_ROW = {
  id: CLIENT,
  custom_fields: {
    crs_inquiries_ex: 4, crs_inquiries_eq: 1, crs_inquiries_tu: 0,
    crs_negative_items_count: 0,
    crs_late_payments_count: 0,
    business_age_months: 30
  }
};

const TRADELINE_ROW = {
  id: TRADELINE, org_id: ORG, client_id: CLIENT,
  lender: "Chase", kind: "revolving",
  credit_limit_cents: 2_000_000,  // $20,000
  balance_cents: 1_700_000,       // $17,000 -> 85%
  apr: "0.1899", closed_at: null
};

const CRS_ROW = { result: { scores: { ex: 720, eq: 705, tu: 710 } }, created_at: "2026-01-02T00:00:00Z" };

/* The deps object the handler takes as its third parameter. Returns { db } — not
   a bare db — because `deps.db ?? db` silently falls back to the REAL pool when
   the shape is wrong, and the resulting 503 looks like a broken assertion rather
   than a broken fixture. */
const fullDb = (over = {}) => ({
  db: makeDb({ client: CLIENT_ROW, tradelines: [TRADELINE_ROW], crs: [CRS_ROW], ...over })
});

/* ─────────────────────────── method and auth ─────────────────────────── */

describe("method, auth and role gate", () => {
  test("a non-GET method is refused with an allow header", async () => {
    const res = makeRes();
    await handler(req({ method: "POST" }), res, { db: makeDb() });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET");
  });

  test("no session is 401", async () => {
    const res = makeRes();
    await handler(req({ headers: {} }), res, { db: makeDb({ session: null }) });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
  });

  test("an invalid token is 401", async () => {
    const res = makeRes();
    await handler(req(), res, { db: makeDb({ session: null }) });
    assert.equal(res.statusCode, 401);
  });

  test("a role outside ROLE_SETS.STAFF is 403", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({ session: { role: "affiliate_manager" } }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  });

  test("every ROLE_SETS.STAFF role is admitted", async () => {
    for (const role of ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter"]) {
      const res = makeRes();
      await handler(req(), res, fullDb({ session: { role } }));
      assert.equal(res.statusCode, 200, `role ${role} should be admitted`);
    }
  });
});

/* ─────────────────────────── org scoping ─────────────────────────── */

describe("org scoping comes from the session and fails closed", () => {
  test("a session with no org is refused, not run unscoped", async () => {
    for (const org_id of [null, undefined, "", "not-a-uuid"]) {
      const res = makeRes();
      const deps = fullDb({ session: { org_id } });
      await handler(req(), res, deps);
      assert.equal(res.statusCode, 403, `org_id ${JSON.stringify(org_id)} must fail closed`);
      // And it must not have gone on to read anything.
      assert.ok(!deps.db.calls.some((c) => c.sql.includes("FROM clients")),
        "a session without an org must never reach a data query");
    }
  });

  test("the org is taken from the session, NEVER from the query string", async () => {
    const res = makeRes();
    const deps = fullDb();
    // A caller trying to widen their own scope.
    await handler(req({ query: { client_id: CLIENT, org_id: OTHER_ORG } }), res, deps);
    assert.equal(res.statusCode, 200);
    const clientQuery = deps.db.calls.find((c) => c.sql.includes("FROM clients"));
    assert.deepEqual(clientQuery.params, [CLIENT, ORG],
      "the org parameter must be the session's, and the query string's must be ignored");
  });

  test("a client in another org is 404, not 403", async () => {
    // The stub returns no row because the handler's WHERE includes org_id.
    // 404 rather than 403 on purpose: 403 would confirm the uuid names a real
    // client somewhere, which is the thing the scope is hiding.
    const res = makeRes();
    await handler(req(), res, fullDb({ client: undefined }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "client_not_found");
  });

  test("every data query carries the org id as well as the client id", async () => {
    const res = makeRes();
    const deps = fullDb();
    await handler(req(), res, deps);
    assert.equal(res.statusCode, 200);
    for (const table of ["FROM tradelines", "FROM card_liabilities", "FROM crs_results", "FROM businesses"]) {
      const call = deps.db.calls.find((c) => c.sql.includes(table));
      assert.ok(call, `expected a query against ${table}`);
      assert.deepEqual(call.params, [CLIENT, ORG],
        `${table} must be scoped by org as well as client`);
    }
  });
});

/* ─────────────────────────── input validation ─────────────────────────── */

describe("client_id validation", () => {
  test("a missing or non-uuid client_id is 400", async () => {
    for (const client_id of [undefined, "", "123", "'; DROP TABLE clients; --"]) {
      const res = makeRes();
      await handler(req({ query: { client_id } }), res, fullDb());
      assert.equal(res.statusCode, 400, `client_id ${JSON.stringify(client_id)} must be refused`);
    }
  });
});

/* ─────────────────────────── the payload ─────────────────────────── */

describe("the response body", () => {
  test("returns the engine assessment, the sentences, and the numbers behind them", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb());
    assert.equal(res.statusCode, 200);
    const body = res.body;

    assert.equal(body.ok, true);
    assert.equal(body.clientId, CLIENT);

    // The engine's own output is present and unmodified in shape.
    assert.equal(body.underwrite.primary_bureau, "experian");
    assert.equal(body.underwrite.metrics.score, 720);
    assert.equal(body.underwrite.metrics.utilization_pct, 85,
      "$17,000 on a $20,000 limit is 85 PERCENT UNITS — not 0.85 and not 8500");

    // Every suggestion carries its reasoning.
    assert.ok(body.suggestions.length > 0);
    for (const s of body.suggestions) {
      assert.equal(typeof s.text, "string");
      assert.equal(s.engine, "underwrite_iq_lite");
      assert.equal(s.recognised, true, `unrecognised sentence: ${s.text}`);
      assert.ok(s.basis, `no basis for: ${s.text}`);
    }

    const util = body.suggestions.find((s) => s.topic === "utilization");
    assert.ok(util, "an 85% utilization must produce a utilization sentence");
    assert.equal(util.basis.utilization_pct, 85);
    assert.equal(util.basis.unit, "percent");
    assert.equal(util.basis.compared_against.extreme_band_from_pct, 80);

    // The vendored commit travels with the response.
    assert.match(body.engine.upstreamCommit, /^[0-9a-f]{40}$/);
  });

  test("the engine's sentences are returned verbatim, never rewritten", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb());
    // Exact strings from the vendored engine. If the endpoint ever starts
    // editorialising, this breaks.
    assert.ok(res.body.suggestions.some((s) =>
      s.text === "Your utilization is extremely high (80%+). Paying balances down aggressively will unlock a large jump in scores and approvals."));
  });

  test("BOTH utilization engines are reported, each naming itself", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb());
    const voices = res.body.utilizationVoices;

    const iq = voices.find((v) => v.engine === "underwrite_iq_lite");
    const fundhub = voices.find((v) => v.engine === "fundhub_alerts_evaluate");
    assert.ok(iq, "the vendored engine's utilization line must be attributed");
    assert.ok(fundhub, "fundhub's own evaluateUtilization line must be attributed");

    // Same portfolio, two conventions, both stated rather than silently merged.
    assert.equal(iq.value, 85);
    assert.equal(iq.unit, "percent");
    assert.equal(fundhub.value, 0.85);
    assert.equal(fundhub.unit, "fraction");
    assert.equal(fundhub.over, true);
  });

  test("a client with no credit pull gets an honest empty assessment, not a guess", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({ crs: [], tradelines: [] }));
    assert.equal(res.statusCode, 200);
    const body = res.body;

    assert.deepEqual(body.dataCompleteness.bureausAssessed, []);
    assert.deepEqual(body.dataCompleteness.bureausUnavailable, ["experian", "equifax", "transunion"]);
    assert.ok(body.dataCompleteness.missing.client.some((m) => m.field === "crs_results"));

    // No card funding could be computed, so the banner number is null — not a
    // made-up placeholder — and the caveat flag says so.
    assert.equal(body.underwrite.lite_banner_funding, null);
    assert.equal(body.caveats.bannerFundingIsFallback, true);
    assert.match(body.caveats.bannerFundingNote, /no figure to show/);
  });

  test("PARTIAL DATA: a sentence resting on an unentered field names that field", async () => {
    // Negatives and late payments deliberately absent from custom_fields.
    const res = makeRes();
    await handler(req(), res, fullDb({
      client: { id: CLIENT, custom_fields: { crs_inquiries_ex: 2 } }
    }));
    assert.equal(res.statusCode, 200);

    const missingFields = res.body.dataCompleteness.missing.experian.map((m) => m.field);
    assert.ok(missingFields.includes("negatives"),
      "an unentered negatives count must be named, because the engine counts it as zero");
    assert.ok(missingFields.includes("late_payment_events"));

    // At least one sentence must be flagged as resting on data nobody entered,
    // with the field named rather than a confident line built on a null.
    const resting = res.body.suggestions.filter((s) => s.restsOnMissingData);
    assert.ok(resting.length > 0, "some advice here rests on absent data and must say so");
    for (const s of resting) {
      assert.ok(s.missingFields.length > 0, `${s.id} is flagged but names no field`);
      for (const f of s.missingFields) {
        assert.ok(f.field && f.reason && f.effect,
          "a named missing field must say what it is, why it is missing and what it changes");
      }
    }
  });

  test("the seasoning gap is reported when no line has a stored open date", async () => {
    // Still the common case for older rows and manual entries with no date
    // given. A caller must not be able to read the numbers without seeing that
    // they are a floor.
    const res = makeRes();
    await handler(req(), res, fullDb());
    assert.equal(res.body.caveats.fundingFiguresAreFloors, true);
    assert.match(res.body.caveats.fundingFiguresNote, /no account-opened date/);
    assert.ok(res.body.dataCompleteness.tradelineGaps.every((g) => g.missing.includes("opened")));
  });

  test("the seasoning caveat clears once the stored tradeline has a real open date", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({
      tradelines: [{ ...TRADELINE_ROW, opened_on: "2018-01-01" }]
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.caveats.fundingFiguresAreFloors, false,
      "a fully-dated file must not still be flagged as a funding floor");
    assert.equal(res.body.caveats.fundingFiguresNote, null);
    assert.ok(res.body.dataCompleteness.tradelineGaps.every((g) => !g.missing.includes("opened")));
  });

  test("two saved companies raise the UnderwriteIQ combined total vs one, all else equal", async () => {
    const seasoned = { ...TRADELINE_ROW, opened_on: "2018-01-01" };
    const one = makeRes();
    await handler(req(), one, fullDb({
      tradelines: [seasoned],
      businesses: [{ age_months: 30 }]
    }));
    const two = makeRes();
    await handler(req(), two, fullDb({
      tradelines: [seasoned],
      businesses: [{ age_months: 30 }, { age_months: 30 }]
    }));
    assert.equal(one.statusCode, 200);
    assert.equal(two.statusCode, 200);
    const oneTotal = one.body.underwrite.totals.total_combined_funding;
    const twoTotal = two.body.underwrite.totals.total_combined_funding;
    assert.ok(Number.isFinite(oneTotal) && oneTotal > 0, "one company must still produce a figure");
    assert.ok(twoTotal > oneTotal, "a second company must raise the shown pre-approval");
    assert.equal(
      two.body.underwrite.totals.total_business_funding,
      one.body.underwrite.totals.total_business_funding * 2
    );
  });

  test("two saved companies stay $0 when the file has no $5,000 card — no invented floor", async () => {
    // Repair horse shape: known age, two companies, biggest open card $1,894.
    // Lite company dollars are a multiple of card funding. No $5k card → $0.
    const thinCard = {
      ...TRADELINE_ROW,
      credit_limit_cents: 189_400,
      balance_cents: 176_200,
      opened_on: "2018-01-01"
    };
    const repairClient = {
      ...CLIENT_ROW,
      custom_fields: {
        ...CLIENT_ROW.custom_fields,
        business_age_months: 18,
        crs_negative_items_count: 16,
        crs_late_payments_count: 2
      }
    };
    const repairCrs = [{ result: { scores: { ex: 630, eq: 636 } }, created_at: "2026-01-02T00:00:00Z" }];
    const one = makeRes();
    await handler(req(), one, {
      db: makeDb({
        client: repairClient,
        tradelines: [thinCard],
        crs: repairCrs,
        businesses: [{ age_months: null }]
      })
    });
    const two = makeRes();
    await handler(req(), two, {
      db: makeDb({
        client: repairClient,
        tradelines: [thinCard],
        crs: repairCrs,
        businesses: [{ age_months: null }, { age_months: null }]
      })
    });
    assert.equal(one.statusCode, 200);
    assert.equal(two.statusCode, 200);
    assert.equal(one.body.underwrite.personal.card_funding, 0);
    assert.equal(one.body.underwrite.totals.total_combined_funding, 0);
    assert.equal(two.body.underwrite.totals.total_combined_funding, 0);
    assert.equal(two.body.underwrite.totals.total_business_funding, 0);
  });

  test("no promise is added on top of the engine's own strings", async () => {

    const res = makeRes();
    await handler(req(), res, fullDb());
    // Every sentence in the response must be one the vendored engine produced.
    // Nothing this repo wrote may appear as advice to a client.
    const { buildSuggestions } = await import("../underwrite/engine.mjs");
    const engineStrings = new Set(buildSuggestions(res.body.underwrite));
    for (const s of res.body.suggestions) {
      assert.ok(engineStrings.has(s.text),
        `"${s.text}" is not a sentence the engine produced — the endpoint must not add advice`);
    }
  });
});


/* A stored pull that carries its accounts, in the live payload shape
   src/tradelines/index.mjs already normalises (confirmed against the vendor
   sandbox library — see that file's key lists). */
const CRS_ROW_WITH_LINES = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  created_at: "2026-01-02T00:00:00Z",
  result: {
    scores: { ex: 720, eq: 705, tu: 710 },
    tradelines: [{
      creditorName: "American Express Blue Business Cash",
      accountType: "revolving",
      accountIdentifier: "SIM-AMEX-001",
      creditLimitAmount: "25000",
      currentBalance: "4800",
      accountOpenedDate: "2020-08-01",
      apr: "18.49"
    }]
  }
};

describe("the accounts come out of the same file the scores did", () => {
  test("no stored rows: the accounts inside the pull are used, and the source says so", async () => {
    // The live failure this closes. One `crs_results` row produced three scores
    // AND "your file is thin, $0", because the scores were read out of the pull
    // and the accounts were only ever read out of the table.
    const res = makeRes();
    await handler(req(), res, fullDb({ tradelines: [], crs: [CRS_ROW_WITH_LINES] }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tradelineSource, "crs_results");
    assert.ok(res.body.underwrite.personal.highest_revolving_limit > 0,
      "the $25,000 limit in the stored pull must reach the engine");
    assert.ok(res.body.underwrite.totals.total_combined_funding > 0,
      "a file with an open seasoned card must not report $0");
    for (const x of res.body.suggestions) {
      assert.ok(!/file is thin/i.test(x.text), x.text);
    }
  });

  test("stored rows win — the pull is never read on top of them", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({
      tradelines: [{ ...TRADELINE_ROW, opened_on: "2018-01-01" }],
      crs: [CRS_ROW_WITH_LINES]
    }));
    assert.equal(res.body.tradelineSource, "tradelines");
    // $20,000 from the stored row, NOT the $25,000 in the pull, and not both.
    assert.equal(res.body.underwrite.personal.highest_revolving_limit, 20_000);
  });

  test("neither the table nor the pull has accounts: that is reported, not filled in", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({ tradelines: [], crs: [CRS_ROW] }));
    assert.equal(res.body.tradelineSource, "none");
    assert.equal(res.body.underwrite.totals.total_combined_funding, 0);
    const gaps = res.body.dataCompleteness.missing.experian || [];
    assert.ok(gaps.some((g) => g.field === "tradelines"),
      "an empty file must still name the missing lines");
  });

  test("an empty newer pull does not hide the accounts in an older one", async () => {
    const res = makeRes();
    await handler(req(), res, fullDb({
      tradelines: [],
      crs: [CRS_ROW, CRS_ROW_WITH_LINES]   // newest first, as the handler orders them
    }));
    assert.equal(res.body.tradelineSource, "crs_results");
    assert.ok(res.body.underwrite.personal.highest_revolving_limit > 0);
  });
});

/* ─────────────────────────── failure handling ─────────────────────────── */

describe("failures", () => {
  test("a malformed-uuid database error becomes a 400, not a 500", async () => {
    const deps = fullDb();
    const inner = deps.db.query.bind(deps.db);
    deps.db.query = async (sql, params) => {
      if (sql.includes("FROM clients")) {
        const e = new Error("invalid input syntax for type uuid");
        e.code = "22P02";
        throw e;
      }
      return inner(sql, params);
    };
    const res = makeRes();
    await handler(req(), res, deps);
    assert.equal(res.statusCode, 400);
  });

  test("an unexpected database error is not swallowed", async () => {
    const deps = fullDb();
    const inner = deps.db.query.bind(deps.db);
    deps.db.query = async (sql, params) => {
      if (sql.includes("FROM tradelines")) throw new Error("connection terminated");
      return inner(sql, params);
    };
    const res = makeRes();
    /* STILL NOT SWALLOWED — but it now SURFACES AS AN ANSWER instead of as a
       throw, and that is the whole of the finance-os-500 fix.

       The original assertion here was `assert.rejects(...)`. Its intent was that
       a real outage must not be reported as a clean empty result, and that intent
       is kept and tightened below. What it accidentally also pinned was the
       ROUTE the outage took out of this handler: `throw` lands in
       netlify/functions/api.mjs's catch, which answers 500 internal_error, which
       public/app/data.js words as "something went wrong on our side ... The
       database did not report a problem." That is how a dead database was shown
       on finance-os.html as "Funding capacity could not be read — HTTP 500
       internal_error", pointing whoever read it at this file instead of at
       Postgres.

       So the case now asserts the STATUS rather than the mechanism: 503 carrying
       db:"down", which data.js classifies as source "nodb" and words as "the
       database is not answering". Louder than the old behaviour, not quieter —
       and a swallowed outage would fail this as surely as it failed the old
       assertion, because a 200 is neither 503 nor an empty body. */
    const thrown = await handler(req(), res, deps).then(() => null, (e) => e);
    assert.equal(thrown, null,
      "the outage escaped as a throw; api.mjs turns that into a 500 that blames our code");
    assert.equal(res.statusCode, 503,
      "a real outage must surface as an outage, not as a clean empty result");
    assert.equal(res.body.db, "down",
      "without db:'down' public/app/data.js cannot tell this from our own code breaking");
  });

  test("the handler never reads DATABASE_URL", async () => {
    /* ASSERTED AGAINST THE HANDLER, NOT AGAINST THE ENVIRONMENT.
       This case used to read `assert.equal(process.env.DATABASE_URL, undefined)`.
       That is a claim about the shell the suite happens to be running in, not
       about the seam: it passed only while nobody had a database configured, and
       went red the moment the suite was run the way CLAUDE.md §12 says to verify
       it — against real Postgres — on a handler that is perfectly correct.

       The seam is what the name promises, so the seam is what is checked: the
       handler's own source never touches DATABASE_URL or the pool, and every db
       call in this file arrives through the injected `deps`. That holds with a
       database configured and without one. */
    const src = await readFile(new URL("../../api/read/underwrite.mjs", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /DATABASE_URL/,
      "the handler reads DATABASE_URL directly — the injected db seam is not the only way in");
    assert.doesNotMatch(code, /\bpool\s*\(/,
      "the handler reaches for the connection pool directly instead of the injected db");
  });
});

/* ─────────────────────────── routing ─────────────────────────── */

describe("the handler is actually reachable", () => {
  test("read/underwrite is in the hardcoded ROUTES map", async () => {
    // A handler file is not a route. This repo has shipped an unrouted handler
    // twice; src/http/routes.test.mjs is the general check and this is the
    // specific one for this endpoint.
    const { ROUTES } = await import("../../netlify/functions/api.mjs");
    assert.equal(typeof ROUTES["read/underwrite"], "function",
      "api/read/underwrite.mjs must be wired into netlify/functions/api.mjs or it 404s");
    assert.equal(ROUTES["read/underwrite"], handler);
  });
});

describe("the statements behind the read", () => {
  test("every read names this client and this company, and the newest pull is the one the engine speaks from", async () => {
    const res = makeRes();
    const deps = fullDb();
    await handler(req(), res, deps);
    assert.equal(res.statusCode, 200);
    const sqlOf = (re) => deps.db.calls.find((c) => re.test(c.sql)).sql;
    assertSqlHas(sqlOf(/FROM clients/), { "the client, in this company": "WHERE id = $1 AND org_id = $2" });
    assertSqlHas(sqlOf(/FROM tradelines/), { "this client's cards, lowest rate first": "WHERE client_id = $1 AND org_id = $2 ORDER BY apr ASC NULLS LAST, lender ASC" });
    assertSqlHas(sqlOf(/FROM card_liabilities/), { "newest observation first": "WHERE client_id = $1 AND org_id = $2 ORDER BY as_of DESC" });
    assertSqlHas(sqlOf(/FROM crs_results/), { "newest pull first": "WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC" });
    assertSqlHas(sqlOf(/FROM businesses/), { "oldest company first": "WHERE client_id = $1 AND org_id = $2 ORDER BY created_at ASC" });
  });
});
