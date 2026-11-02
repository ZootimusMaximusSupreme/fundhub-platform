import { test, describe } from "node:test";
import assert from "node:assert";
import {
  redact, pageParams, page, allowsRole, requireRole, readHandler,
  ROLE_SETS, MAX_LIMIT, DEFAULT_LIMIT, isUuid, CLIENT_DATA_ERRORS, boundedLimit,
  unitFraction
} from "./read-api.mjs";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

describe("read-api", () => {

  // ── redaction: the rule that must hold whatever the SQL selected ──

  test("storage keys and SSNs never survive redaction", () => {
    const out = redact({
      id: "1", title: "Funding Snapshot",
      storage_key: "s3://bucket/secret.pdf", storage_path: "/mnt/x",
      s3_key: "k", object_key: "k",
      ssn: "123-45-6789", client_ssn: "1", ssn_last4: "6789",
      social_security_number: "x",
      password: "p", password_hash: "$scrypt$…", token_hash: "abc"
    });
    assert.deepEqual(Object.keys(out).sort(), ["id", "title"]);
  });

  test("redaction recurses, so a joined row cannot smuggle one out", () => {
    const out = redact({ id: 1, document: { title: "t", storage_key: "s3://x" },
                         list: [{ ssn: "1", ok: true }] });
    assert.equal(out.document.storage_key, undefined);
    assert.equal(out.document.title, "t");
    assert.equal(out.list[0].ssn, undefined);
    assert.equal(out.list[0].ok, true);
  });

  test("the safe derived forms are allowed through", () => {
    const out = redact({ ssn_present: true, has_ssn: false, ssn: "123" });
    assert.equal(out.ssn_present, true);
    assert.equal(out.has_ssn, false);
    assert.equal(out.ssn, undefined);
  });

  test("redaction leaves dates and primitives alone", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const out = redact({ when: d, n: 5, s: "x", nil: null, t: true });
    assert.equal(out.when.getTime(), d.getTime());
    assert.deepEqual([out.n, out.s, out.nil, out.t], [5, "x", null, true]);
  });

  // ── pagination: no endpoint may return an unbounded set ──

  test("limit is bounded at MAX_LIMIT and defaults sanely", () => {
    assert.equal(pageParams({}).limit, DEFAULT_LIMIT);
    assert.equal(pageParams({ limit: "10" }).limit, 10);
    assert.equal(pageParams({ limit: "100000" }).limit, MAX_LIMIT,
      "an unbounded request must be capped, not honoured");
    assert.equal(pageParams({ limit: "0" }).limit, DEFAULT_LIMIT);
    assert.equal(pageParams({ limit: "-5" }).limit, DEFAULT_LIMIT);
    assert.equal(pageParams({ limit: "abc" }).limit, DEFAULT_LIMIT);
  });

  test("offset is non-negative", () => {
    assert.equal(pageParams({}).offset, 0);
    assert.equal(pageParams({ offset: "40" }).offset, 40);
    assert.equal(pageParams({ offset: "-40" }).offset, 0);
    assert.equal(pageParams({ offset: "junk" }).offset, 0);
  });

  test("hasMore comes from the extra row and is not returned to the caller", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ i }));
    const p = page(rows, { limit: 10, offset: 0 });
    assert.equal(p.hasMore, true);
    assert.equal(p.items.length, 10, "the probe row must not be served");
    assert.equal(p.count, 10);

    const short = page(rows.slice(0, 4), { limit: 10, offset: 0 });
    assert.equal(short.hasMore, false);
    assert.equal(short.items.length, 4);
  });

  test("page redacts its items", () => {
    const p = page([{ id: 1, storage_key: "s3://x" }], { limit: 10, offset: 0 });
    assert.equal(p.items[0].storage_key, undefined);
  });

  // ── role gating: deny by default ──

  test("an endpoint with no role set admits nobody", () => {
    assert.equal(allowsRole(undefined, "owner"), false);
    assert.equal(allowsRole(null, "owner"), false);
    const r = res();
    assert.equal(requireRole(r, { role: "owner" }, undefined), false);
    assert.equal(r.code, 403);
  });

  test("FINANCE excludes non-privileged staff; STAFF includes them", () => {
    for (const role of ["owner", "admin"]) {
      assert.equal(allowsRole(ROLE_SETS.FINANCE, role), true, role);
    }
    for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist"]) {
      assert.equal(allowsRole(ROLE_SETS.FINANCE, role), false, `${role} reached FINANCE`);
      assert.equal(allowsRole(ROLE_SETS.STAFF, role), true, `${role} blocked from STAFF`);
    }
  });

  test("principal types are never allowed by any role set", () => {
    for (const set of Object.values(ROLE_SETS)) {
      for (const role of ["client", "affiliate", "partner", "", null, undefined]) {
        assert.equal(allowsRole(set, role), false, `${role} reached a staff role set`);
      }
    }
  });

  test("the role is folded before the check", () => {
    assert.equal(allowsRole(ROLE_SETS.FINANCE, " Owner "), true);
    assert.equal(allowsRole(ROLE_SETS.STAFF, "CLOSER"), true);
  });

  test("a forbidden response is 403 and names the requirement", () => {
    const r = res();
    assert.equal(requireRole(r, { role: "setter" }, ROLE_SETS.FINANCE), false);
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "forbidden");
    assert.match(r.body.message, /owner/);
  });

  test("an assigned second role passes its role gate without changing the primary", () => {
    const staff = { role: "closer", roles: ["closer", "setter"] };
    assert.equal(requireRole(res(), staff, ROLE_SETS.SETTER), true);
    assert.equal(staff.role, "closer");
    assert.equal(requireRole(res(), staff, ROLE_SETS.FINANCE), false);
    assert.equal(requireRole(res(), { role: "closer", roles: ["owner"] }, ROLE_SETS.OPS), false);
  });

  test("external and restricted primary identities cannot borrow employee roles", () => {
    for (const role of ["client", "affiliate", "partner", "outbound_rep"]) {
      const r = res();
      assert.equal(requireRole(r, { role, roles: ["owner"] }, ROLE_SETS.FINANCE), false);
      assert.equal(r.code, 403);
    }
  });

  // ── the wrapper ──

  const deps = (staff) => ({
    db: {},
    requireAuth: async (req, res) => {
      if (!staff) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
      return staff;
    }
  });

  test("no session is 401 and never runs the query", async () => {
    let ran = false;
    const h = readHandler({ roles: ROLE_SETS.STAFF, fetch: async () => { ran = true; return []; } });
    const r = res();
    await h({ method: "GET", query: {} }, r, deps(null));
    assert.equal(r.code, 401);
    assert.equal(ran, false, "the query ran for an unauthenticated caller");
  });

  test("a wrong role is 403 and never runs the query", async () => {
    let ran = false;
    const h = readHandler({ roles: ROLE_SETS.FINANCE, fetch: async () => { ran = true; return []; } });
    const r = res();
    await h({ method: "GET", query: {} }, r, deps({ role: "setter" }));
    assert.equal(r.code, 403);
    assert.equal(ran, false, "the query ran for a forbidden role");
  });

  test("a non-GET method is 405", async () => {
    const h = readHandler({ roles: ROLE_SETS.STAFF, fetch: async () => [] });
    const r = res();
    await h({ method: "POST", query: {} }, r, deps({ role: "owner" }));
    assert.equal(r.code, 405);
  });

  test("a successful read is paginated and redacted", async () => {
    const h = readHandler({
      roles: ROLE_SETS.STAFF,
      fetch: async (db, { limit }) =>
        Array.from({ length: limit + 1 }, (_, i) => ({ i, storage_key: "s3://x" }))
    });
    const r = res();
    await h({ method: "GET", query: { limit: "3" } }, r, deps({ role: "closer" }));
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.items.length, 3);
    assert.equal(r.body.hasMore, true);
    assert.equal(r.body.items[0].storage_key, undefined);
  });

  test("a query error is 500 with the DSN scrubbed", async () => {
    const h = readHandler({
      roles: ROLE_SETS.STAFF,
      fetch: async () => { throw new Error("connect failed postgres://u:pw@host/db"); }
    });
    const r = res();
    await h({ method: "GET", query: {} }, r, deps({ role: "owner" }));
    assert.equal(r.code, 500);
    assert.equal(r.body.error, "query_failed");
    assert.doesNotMatch(r.body.message, /pw@host/);
    assert.match(r.body.message, /\[redacted\]/);
  });

  /* A malformed `?id=` used to surface as a 500 carrying the raw Postgres
     message, which made every wired screen announce "backend unavailable" for
     what was only a stale URL. These pin the classification. */
  test("a bad uuid is a 400, not a 500, and echoes nothing back", async () => {
    const pgErr = Object.assign(
      new Error('invalid input syntax for type uuid: "zzz"'), { code: "22P02" });
    const h = readHandler({ roles: ROLE_SETS.STAFF, fetch: async () => { throw pgErr; } });
    const r = res();
    await h({ method: "GET", query: { client_id: "zzz" } }, r, deps({ role: "owner" }));
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_parameter");
    // The caller's bad value must not be reflected, and the column type is an
    // internal detail.
    assert.doesNotMatch(JSON.stringify(r.body), /zzz|uuid|invalid input syntax/i);
  });

  test("every class-22 data error is a 400", async () => {
    for (const code of CLIENT_DATA_ERRORS) {
      const h = readHandler({
        roles: ROLE_SETS.STAFF,
        fetch: async () => { throw Object.assign(new Error("bad value"), { code }); }
      });
      const r = res();
      await h({ method: "GET", query: {} }, r, deps({ role: "owner" }));
      assert.equal(r.code, 400, `SQLSTATE ${code} should be a 400`);
    }
  });

  test("a genuine failure is still a 500 — the 400 path must not swallow outages", async () => {
    // 08006 is connection_failure. That IS our problem and must stay a 500,
    // otherwise a real outage renders as a polite "bad request".
    const h = readHandler({
      roles: ROLE_SETS.STAFF,
      fetch: async () => { throw Object.assign(new Error("connection refused"), { code: "08006" }); }
    });
    const r = res();
    await h({ method: "GET", query: {} }, r, deps({ role: "owner" }));
    assert.equal(r.code, 500);
    assert.equal(r.body.error, "query_failed");
  });

  test("isUuid accepts a real uuid and rejects the shapes that reached Postgres", () => {
    assert.equal(isUuid("f3263bdb-45da-4056-8d6c-7c999d944fee"), true);
    assert.equal(isUuid("F3263BDB-45DA-4056-8D6C-7C999D944FEE"), true);
    assert.equal(isUuid(" f3263bdb-45da-4056-8d6c-7c999d944fee "), true);
    for (const bad of ["zzz", "", null, undefined, 12, {},
                       "f3263bdb-45da-4056-8d6c-7c999d944fe",     // one short
                       "f3263bdb-45da-4056-8d6c-7c999d944feez",   // one long
                       "f3263bdb45da40568d6c7c999d944fee",        // no dashes
                       "g3263bdb-45da-4056-8d6c-7c999d944fee",    // non-hex
                       "f3263bdb-45da-4056-8d6c-7c999d944fee' OR 1=1"]) {
      assert.equal(isUuid(bad), false, `isUuid(${JSON.stringify(bad)}) should be false`);
    }
  });

  test("single:true returns one object, or 404", async () => {
    const found = readHandler({ roles: ROLE_SETS.STAFF, single: true,
      fetch: async () => [{ id: 1, ssn: "x" }] });
    const r1 = res();
    await found({ method: "GET", query: {} }, r1, deps({ role: "owner" }));
    assert.equal(r1.code, 200);
    assert.equal(r1.body.id, 1);
    assert.equal(r1.body.ssn, undefined);

    const missing = readHandler({ roles: ROLE_SETS.STAFF, single: true, fetch: async () => [] });
    const r2 = res();
    await missing({ method: "GET", query: {} }, r2, deps({ role: "owner" }));
    assert.equal(r2.code, 404);
  });
});

/* boundedLimit — for the three handlers that roll their own pagination.
   Each did `Math.min(parseInt(v) || fallback, cap)`, which has no LOWER bound,
   so ?limit=-1 reached Postgres and raised "LIMIT must not be negative" as a
   500. A caller's bad number is not a server fault. */
describe("boundedLimit", () => {
  const OPTS = { fallback: 100, cap: 200 };

  test("a negative limit clamps to 1 instead of reaching Postgres", () => {
    assert.equal(boundedLimit("-1", OPTS), 1);
    assert.equal(boundedLimit("-999999", OPTS), 1);
    assert.equal(boundedLimit("0", OPTS), 1);
  });

  test("the cap holds", () => {
    assert.equal(boundedLimit("999999", OPTS), 200);
    assert.equal(boundedLimit("201", OPTS), 200);
  });

  test("absent or unparseable falls back", () => {
    for (const v of [undefined, null, "", "abc", "NaN", {}, []]) {
      assert.equal(boundedLimit(v, OPTS), 100, JSON.stringify(v));
    }
  });

  test("a normal value passes through, and a float truncates", () => {
    assert.equal(boundedLimit("50", OPTS), 50);
    assert.equal(boundedLimit("1.9", OPTS), 1);
  });

  test("the result is always an integer in [1, cap]", () => {
    for (const v of ["-5", "0", "1", "7", "200", "201", "1e9", "abc", ""]) {
      const n = boundedLimit(v, OPTS);
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 200, `${v} -> ${n}`);
    }
  });
});

/* The guardrail ceiling api/read/tradelines.mjs takes off the query string. It
   used to reach calcFunding as a bare Number(), so the one control that stops a
   closer over-drawing a client could be switched off from the URL bar. These are
   the two ways that happened, and they fail in opposite-looking ways. */
describe("unitFraction — the guardrail bypass", () => {

  test("a ceiling above 1 is refused, not clamped", () => {
    // ?utilization_threshold=999 set the ceiling to 99,900%. No card can breach
    // that, so every allocation passed the guardrail.
    for (const v of ["999", "1.0001", "100", "30"]) {
      assert.equal(unitFraction(v).valid, false, v);
    }
  });

  test("a non-numeric ceiling is refused, because NaN silently disables it", () => {
    // Number("abc") is NaN and every comparison against NaN is false, so the
    // guardrail never fires — the same bypass, without looking like a number.
    for (const v of ["abc", "NaN", "Infinity", "1e999", {}, []]) {
      assert.equal(unitFraction(v).valid, false, JSON.stringify(v));
    }
  });

  test("zero and negatives are refused", () => {
    for (const v of ["0", "-0.3", "-1"]) {
      assert.equal(unitFraction(v).valid, false, v);
    }
  });

  test("absent is valid and carries no value, so the default stands", () => {
    for (const v of [undefined, null, ""]) {
      const r = unitFraction(v);
      assert.equal(r.valid, true, JSON.stringify(v));
      assert.equal(r.present, false);
      assert.equal(r.value, undefined);
    }
  });

  test("a real fraction passes through, including the boundary", () => {
    assert.deepEqual(unitFraction("0.3"), { present: true, value: 0.3, valid: true });
    assert.deepEqual(unitFraction("1"), { present: true, value: 1, valid: true });
    assert.deepEqual(unitFraction(0.29), { present: true, value: 0.29, valid: true });
  });
});
