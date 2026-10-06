// src/marketing/http.mjs without a database: the gate, the error answers, and
// withRequest's one transaction, driven through the REAL asStaff()
// (src/partners/rls.mjs) on a pool-shaped fake that keeps a tiny in-memory
// marketing_requests table and honours BEGIN / COMMIT / ROLLBACK.
//
// The same rules run against real Postgres in src/http/marketing-settings.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  gateMarketing, withRequest, staffRead, readBody, checkRequestId,
  InvalidError, StaleError, NotFoundError,
  sendInvalid, sendStale, sendNotFound, sendKnownError, isNotReady, sendNotReady
} from "./http.mjs";
import settingsHandler from "../../api/marketing/settings.mjs";
import funnelsHandler from "../../api/marketing/funnels.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const RID = "req-0001-aaaa";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/* A pool with one table, marketing_requests, and a log of every statement.
   Rows written inside a transaction land only on COMMIT. `other` lets a test
   act as a second writer that saves the same request_id mid-flight. */
function fakePool() {
  const saved = new Map();
  const log = [];
  let connects = 0;
  const pool = {
    saved, log,
    get connects() { return connects; },
    async connect() {
      connects++;
      let pending = null;
      const writes = [];
      return {
        release() {},
        async query(sql, params = []) {
          const s = String(sql).replace(/\s+/g, " ").trim();
          log.push(s);
          if (s === "BEGIN") { pending = []; return { rows: [] }; }
          if (s === "COMMIT") {
            for (const w of pending || []) {
              if (w.kind === "save") saved.set(w.row.request_id, w.row);
              else pool.applied.push(w.what);
            }
            pending = null;
            return { rows: [] };
          }
          if (s === "ROLLBACK") { pending = null; return { rows: [] }; }
          if (s.startsWith("SELECT set_config")) return { rows: [] };
          if (s.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
          if (s.startsWith("SELECT org_id, route, response FROM marketing_requests")) {
            const row = saved.get(params[0]);
            return { rows: row ? [{ org_id: row.org_id, route: row.route, response: row.response }] : [] };
          }
          if (s.startsWith("INSERT INTO marketing_requests")) {
            if (saved.has(params[0])) {
              const e = new Error('duplicate key value violates unique constraint "marketing_requests_pkey"');
              Object.assign(e, { code: "23505", constraint: "marketing_requests_pkey" });
              throw e;
            }
            pending.push({ kind: "save", row: { request_id: params[0], org_id: params[1], route: params[2], response: JSON.parse(params[3]) } });
            return { rows: [] };
          }
          if (s.startsWith("WRITE")) { pending.push({ kind: "write", what: params[0] }); writes.push(params[0]); return { rows: [] }; }
          throw new Error("fake pool: unexpected SQL " + s);
        }
      };
    },
    applied: []
  };
  return pool;
}

describe("withRequest", () => {
  test("a new request runs fn once, saves the answer as the last statement, and commits", async () => {
    const pool = fakePool();
    let runs = 0;
    const out = await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID }, async (tx) => {
      runs++;
      await tx.query("WRITE", ["settings saved"]);
      return { settings: { enabled: true } };
    });
    assert.deepEqual(out, { settings: { enabled: true } });
    assert.equal(runs, 1);
    assert.deepEqual(pool.applied, ["settings saved"]);
    assert.deepEqual(pool.saved.get(RID), {
      request_id: RID, org_id: ORG_A, route: "marketing/settings", response: { settings: { enabled: true } }
    });
    // One transaction: BEGIN, actor, partner, lock, look up, the write, the save, COMMIT.
    const i = (p) => pool.log.findIndex((s) => s.startsWith(p));
    assert.equal(pool.connects, 1);
    assert.ok(i("SELECT pg_advisory_xact_lock") < i("SELECT org_id, route, response"), "lock before look-up");
    assert.ok(i("WRITE") < i("INSERT INTO marketing_requests"), "the change before the saved answer");
    assert.equal(pool.log[pool.log.length - 2].startsWith("INSERT INTO marketing_requests"), true, "the save is the last statement");
    assert.equal(pool.log[pool.log.length - 1], "COMMIT");
  });

  test("the same request_id from the same company and route answers the saved body and does not run fn", async () => {
    const pool = fakePool();
    const first = await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID },
      async (tx) => { await tx.query("WRITE", ["one"]); return { n: 1 }; });
    let ran = false;
    const again = await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID },
      async () => { ran = true; return { n: 2 }; });
    assert.deepEqual(again, first);
    assert.equal(ran, false);
    assert.deepEqual(pool.applied, ["one"], "written once");
    assert.equal(pool.log.filter((s) => s.startsWith("INSERT INTO marketing_requests")).length, 1);
  });

  test("the same request_id from another company or another route is 400 invalid request_id", async () => {
    const pool = fakePool();
    await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID }, async () => ({ ok: 1 }));
    for (const opts of [
      { orgId: ORG_B, route: "marketing/settings", requestId: RID },
      { orgId: ORG_A, route: "marketing/funnels", requestId: RID }
    ]) {
      let ran = false;
      await assert.rejects(
        withRequest(pool, opts, async () => { ran = true; return {}; }),
        (err) => err instanceof InvalidError && err.field === "request_id"
      );
      assert.equal(ran, false);
    }
    assert.equal(pool.saved.size, 1);
  });

  test("fn throwing rolls everything back: no change, no saved answer", async () => {
    const pool = fakePool();
    await assert.rejects(
      withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID }, async (tx) => {
        await tx.query("WRITE", ["half done"]);
        throw new StaleError({ v: 1 });
      }),
      StaleError
    );
    assert.deepEqual(pool.applied, []);
    assert.equal(pool.saved.size, 0);
    assert.ok(pool.log.includes("ROLLBACK"));
    // A retry with the same id after a refusal is not stuck on it.
    const out = await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID },
      async (tx) => { await tx.query("WRITE", ["done"]); return { ok: true }; });
    assert.deepEqual(out, { ok: true });
  });

  test("a copy that hits the primary key rolls back and answers the first saved body", async () => {
    const pool = fakePool();
    const out = await withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID }, async (tx) => {
      await tx.query("WRITE", ["the copy's change"]);
      // The first copy finishes while this one is still running.
      pool.saved.set(RID, { request_id: RID, org_id: ORG_A, route: "marketing/settings", response: { first: true } });
      return { first: false };
    });
    assert.deepEqual(out, { first: true });
    assert.deepEqual(pool.applied, [], "the copy's change was rolled back");
  });

  test("a primary-key clash with another company's id is still a 400, not that company's answer", async () => {
    const pool = fakePool();
    await assert.rejects(
      withRequest(pool, { orgId: ORG_A, route: "marketing/settings", requestId: RID }, async () => {
        pool.saved.set(RID, { request_id: RID, org_id: ORG_B, route: "marketing/settings", response: { secret: 1 } });
        return { mine: 1 };
      }),
      (err) => err instanceof InvalidError && err.field === "request_id"
    );
  });

  test("the answer comes back as the JSON that was saved (a Date is its ISO string)", async () => {
    const pool = fakePool();
    const when = new Date("2026-10-05T14:00:00.123Z");
    const out = await withRequest(pool, { orgId: ORG_A, route: "r/x", requestId: RID }, async () => ({ at: when, n: null }));
    assert.deepEqual(out, { at: "2026-10-05T14:00:00.123Z", n: null });
    assert.deepEqual(pool.saved.get(RID).response, out);
  });

  test("a bad request_id is refused before any connection is opened", async () => {
    const pool = fakePool();
    for (const bad of [undefined, null, "", "short", "has space in it", "x".repeat(201), 12345678, "semi;colon-id"]) {
      await assert.rejects(
        withRequest(pool, { orgId: ORG_A, route: "r", requestId: /** @type {any} */ (bad) }, async () => ({})),
        (err) => err instanceof InvalidError && err.field === "request_id",
        String(bad)
      );
    }
    assert.equal(pool.connects, 0);
    assert.equal(checkRequestId("0b6f3c1e-8c1a-4d0e-9a7b-3f2d1c0b9a88"), "0b6f3c1e-8c1a-4d0e-9a7b-3f2d1c0b9a88");
  });

  test("withRequest refuses to run without a company or a route", async () => {
    const pool = fakePool();
    await assert.rejects(withRequest(pool, { orgId: "nope", route: "r", requestId: RID }, async () => ({})), /orgId/);
    await assert.rejects(withRequest(pool, { orgId: ORG_A, route: " ", requestId: RID }, async () => ({})), /route/);
    await assert.rejects(withRequest(pool, { orgId: ORG_A, route: "r", requestId: RID }, async () => undefined), /answer body/);
    assert.equal(pool.saved.size, 0);
  });

  test("staffRead runs one staff transaction", async () => {
    const pool = fakePool();
    const out = await staffRead(pool, async () => 42);
    assert.equal(out, 42);
    assert.deepEqual(pool.log.slice(0, 1), ["BEGIN"]);
    assert.ok(pool.log.some((s) => s.startsWith("SELECT set_config('fundhub.actor'")));
    assert.equal(pool.log[pool.log.length - 1], "COMMIT");
  });
});

describe("error answers", () => {
  test("400, 409 and 404 bodies", () => {
    const a = res(); sendInvalid(a, "patch.size_rule", "size_rule must be one of: total, per_funnel.");
    assert.equal(a.code, 400);
    assert.deepEqual(a.body, { error: "invalid", field: "patch.size_rule", message: "size_rule must be one of: total, per_funnel." });

    const b = res(); sendStale(b, { updated_at: "x" });
    assert.equal(b.code, 409);
    assert.equal(b.body.error, "stale");
    assert.deepEqual(b.body.current, { updated_at: "x" });
    assert.ok(b.body.message.length > 10);

    const c = res(); sendNotFound(c);
    assert.equal(c.code, 404);
    assert.equal(c.body.error, "not_found");
  });

  test("sendKnownError maps the three refusals and leaves anything else alone", () => {
    const cases = [[new InvalidError("f", "m"), 400], [new StaleError({}), 409], [new NotFoundError(), 404]];
    for (const [err, code] of cases) {
      const r = res();
      assert.equal(sendKnownError(r, err), true);
      assert.equal(r.code, code);
    }
    const r = res();
    assert.equal(sendKnownError(r, new Error("boom")), false);
    assert.equal(r.code, null);
  });

  test("a missing marketing_* table is 'not live yet' (503); any other missing table is not", () => {
    const err = Object.assign(new Error('relation "marketing_settings" does not exist'), { code: "42P01" });
    assert.equal(isNotReady(err), true);
    const r = res();
    assert.equal(sendNotReady(r, err, "Marketing settings"), true);
    assert.equal(r.code, 503);
    assert.equal(r.body.error, "not_ready");
    assert.equal(isNotReady(Object.assign(new Error('relation "campaigns" does not exist'), { code: "42P01" })), false);
    assert.equal(isNotReady(Object.assign(new Error("other"), { code: "23505" })), false);
  });

  test("readBody takes an object or JSON text, and refuses anything else", () => {
    assert.deepEqual(readBody({ body: { a: 1 } }), { a: 1 });
    assert.deepEqual(readBody({ body: '{"a":1}' }), { a: 1 });
    assert.deepEqual(readBody({}), {});
    for (const body of ["{not json", "[1,2]", [1], 7]) {
      assert.throws(() => readBody({ body }), (e) => e instanceof InvalidError && e.field === "body");
    }
  });
});

describe("gateMarketing", () => {
  const auth = (staff) => async (_req, r) => {
    if (!staff) { r.status(401).json({ ok: false, error: "unauthorized" }); return null; }
    return staff;
  };

  test("no session → 401, a closer or csm → 403, owner and admin pass", async () => {
    const r1 = res();
    assert.equal(await gateMarketing({}, r1, { requireAuth: auth(null) }), null);
    assert.equal(r1.code, 401);

    for (const role of ["closer", "csm", "funding_advisor", "inquiry_specialist"]) {
      const r = res();
      assert.equal(await gateMarketing({}, r, { requireAuth: auth({ id: "s", role, org_id: ORG_A }) }), null, role);
      assert.equal(r.code, 403, role);
    }
    for (const role of ["owner", "admin"]) {
      const r = res();
      const staff = await gateMarketing({}, r, { requireAuth: auth({ id: "s", role, org_id: ORG_A }) });
      assert.equal(staff.role, role);
      assert.equal(r.code, null);
    }
  });

  test("an owner with no company on the session → 403", async () => {
    const r = res();
    assert.equal(await gateMarketing({}, r, { requireAuth: auth({ id: "s", role: "owner", org_id: null }) }), null);
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "forbidden");
  });
});

describe("the two routes, before the database", () => {
  const owner = async () => ({ id: "33333333-3333-4333-8333-333333333333", role: "owner", org_id: ORG_A });
  const closer = async () => ({ id: "s", role: "closer", org_id: ORG_A });
  const neverConnect = { connect: async () => { throw new Error("must not reach the database"); } };

  for (const [name, handler] of [["settings", settingsHandler], ["funnels", funnelsHandler]]) {
    test(`${name}: PUT is 405; a closer is 403 and nothing is read`, async () => {
      const r = res();
      await handler({ method: "PUT", headers: {} }, r, { db: neverConnect, requireAuth: owner });
      assert.equal(r.code, 405);
      const c = res();
      await handler({ method: "GET", headers: {} }, c, { db: neverConnect, requireAuth: closer });
      assert.equal(c.code, 403);
    });
  }

  test("settings POST: a bad body is 400 with the field, before the database", async () => {
    const send = async (body) => {
      const r = res();
      await settingsHandler({ method: "POST", headers: {}, body }, r, { db: neverConnect, requireAuth: owner });
      return r;
    };
    const good = { request_id: RID, updated_at: "2026-10-05T14:00:00.000Z", patch: { scripts_per_day: 4 } };
    assert.equal((await send({ ...good, request_id: undefined })).body.field, "request_id");
    assert.equal((await send({ ...good, updated_at: "yesterday" })).body.field, "updated_at");
    assert.equal((await send({ ...good, patch: { size_rule: "some" } })).body.field, "patch.size_rule");
    const unknown = await send({ ...good, patch: { colour: "red" } });
    assert.equal(unknown.code, 400);
    assert.deepEqual(unknown.body.error, "invalid");
    assert.equal(unknown.body.field, "patch.colour");
  });

  test("funnels POST: a bad body is 400 with the field, before the database", async () => {
    const send = async (funnel) => {
      const r = res();
      await funnelsHandler({ method: "POST", headers: {}, body: { request_id: RID, funnel } }, r, { db: neverConnect, requireAuth: owner });
      return r;
    };
    assert.equal((await send({ key: "Bad Key" })).body.field, "funnel.key");
    assert.equal((await send({ key: "book_call", lane: "tiktok" })).body.field, "funnel.lane");
    assert.equal((await send({ key: "book_call", offer_key: "mystery" })).body.field, "funnel.offer_key");
    assert.equal((await send({ key: "book_call", colour: "red" })).body.field, "funnel.colour");
  });
});
