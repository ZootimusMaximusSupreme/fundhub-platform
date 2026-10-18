// An affiliate session may read only their own row from /api/read/affiliates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run as affiliatesRun } from "../../api/read/affiliates.mjs";

const AFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function res() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test("affiliate principal binds their own id", async () => {
  const calls = [];
  const r = res();
  await affiliatesRun(
    { method: "GET", query: { limit: "50" }, headers: {} },
    r,
    {
      db: {
        query: (sql, params) => {
          calls.push({ sql, params });
          return Promise.resolve({ rows: [] });
        }
      },
      requireAuth: async () => null,
      requirePrincipal: async () => ({
        kind: "affiliate",
        orgId: ORG,
        affiliateId: AFF_ID
      })
    }
  );
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.includes(AFF_ID));
  assert.ok(calls[0].params.includes(ORG));
});

test("affiliate with no affiliateId sees nothing", async () => {
  const calls = [];
  const r = res();
  await affiliatesRun(
    { method: "GET", query: {}, headers: {} },
    r,
    {
      db: {
        query: (sql, params) => {
          calls.push({ sql, params });
          return Promise.resolve({ rows: [] });
        }
      },
      requireAuth: async () => null,
      requirePrincipal: async () => ({
        kind: "affiliate",
        orgId: ORG,
        affiliateId: null
      })
    }
  );
  assert.equal(r.code, 200);
  assert.equal(calls.length, 0);
  assert.equal(r.body.items.length, 0);
});

test("linked client reads only the persisted own affiliate, ignoring a forged query", async () => {
  const calls = [];
  const r = res();
  await affiliatesRun({ method: "GET", query: { affiliate_id: "other", org_id: "other" }, headers: {} }, r, {
    db: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } },
    requirePrincipal: async () => ({ kind: "client", orgId: ORG, affiliateId: AFF_ID })
  });
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[3], ORG);
  assert.equal(calls[0].params[4], AFF_ID);
  assert.ok(!calls[0].params.includes("other"));
});

test("unenrolled client receives no roster and performs no query", async () => {
  const r = res();
  await affiliatesRun({ method: "GET", query: {}, headers: {} }, r, {
    db: { query: async () => { throw new Error("must not fetch a roster"); } },
    requirePrincipal: async () => ({ kind: "client", orgId: ORG, affiliateId: null })
  });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.items, []);
});
