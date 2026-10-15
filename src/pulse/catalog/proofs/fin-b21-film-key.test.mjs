// Batch 21 practice test: the teleprompter's film link (?k=), at the door.
//
// The real handlers api/marketing/shoot.mjs and api/marketing/shoot/mark.mjs, with a stand-in
// database and a sign-in check that fails the test if it is ever asked. It shows:
//   - a key names one shoot: it reads that shoot, and a key for another shoot or another company is closed;
//   - a forged key, an expired key and a key made with another secret are closed, with no data read;
//   - a missing secret closes every key;
//   - a film key reads and marks with no sign-in at all;
//   - a film key cannot write the shoot (POST goes to the sign-in check instead).
// No database, no network. A practice test, not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import markHandler from "../../../../api/marketing/shoot/mark.mjs";
import shootHandler from "../../../../api/marketing/shoot.mjs";
import { FILM_LINK_CLOSED, mintFilmKey } from "../../../marketing/shoot-film-key.mjs";

const SECRET = "a-film-secret-of-more-than-thirty-two-chars";
const OTHER_SECRET = "another-film-secret-of-more-than-thirty-two-chars";
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000b2";
const SHOOT = "00000000-0000-4000-8000-000000000901";
const OTHER_SHOOT = "00000000-0000-4000-8000-000000000902";
const SCRIPT = "00000000-0000-4000-8000-000000000101";
const NOW = Date.parse("2026-10-14T12:00:00.000Z");

/** A pool-shaped stand-in: one open shoot in ORG with one script slot and no live script rows. */
function standIn({ shootOrg = ORG, shootId = SHOOT } = {}) {
  const calls = { connects: 0, queries: [] };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.queries.push({ text, params });
      if (/FROM marketing_shoots WHERE org_id = \$1 AND status <> 'done'/.test(text)) {
        return params[0] === shootOrg
          ? { rows: [{ id: shootId, org_id: shootOrg, shoot_date: "2026-10-14", status: "filming", root_script_ids: [], marks: {},
              started_at: new Date(NOW - 3_600_000), finished_at: null, created_at: new Date(NOW - 7_200_000), updated_at: new Date(NOW) }] }
          : { rows: [] };
      }
      if (/count\(\*\)::int AS n/.test(text)) return { rows: [{ n: 0 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = { async connect() { calls.connects += 1; return client; } };
  return { pool, calls };
}

function res() {
  const out = { statusCode: 0, body: null, headers: {} };
  return Object.assign(out, {
    setHeader(name, value) { out.headers[name] = value; },
    status(code) { out.statusCode = code; return out; },
    json(body) { out.body = body; return out; }
  });
}

function request(method, { key = "", body = null, query = {} } = {}) {
  return { method, headers: key ? { "x-shoot-film": key } : {}, query, body };
}

function deps({ db, secret = SECRET } = {}) {
  const asked = { auth: 0 };
  return {
    asked,
    deps: {
      db,
      env: { FILM_URL_SECRET: secret },
      now: () => new Date(NOW),
      // A film key must never reach this. If it does the test fails.
      requireAuth: async (_req, response) => {
        asked.auth += 1;
        response.status(401).json({ error: "unauthorized" });
        return null;
      }
    }
  };
}

const mint = (over = {}) => mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, now: () => NOW, ...over }).token;

test("a good key reads that one shoot with no sign-in", async () => {
  const { pool, calls } = standIn();
  const { deps: d, asked } = deps({ db: pool });
  const out = res();
  await shootHandler(request("GET", { key: mint() }), out, d);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.shoot.id, SHOOT);
  assert.equal(asked.auth, 0, "a film key never asks for a sign-in");
  assert.ok(calls.queries.some((q) => q.params[0] === ORG), "it read the key's own company");
  assert.equal(out.body.film, undefined, "a film key is not handed a fresh film link");
});

test("a key made for another shoot is closed even when it is signed right (swapped key)", async () => {
  const { pool } = standIn({ shootId: SHOOT });
  const { deps: d, asked } = deps({ db: pool });
  const out = res();
  await shootHandler(request("GET", { key: mint({ shootId: OTHER_SHOOT }) }), out, d);
  assert.equal(out.statusCode, 404);
  assert.equal(out.body.message, FILM_LINK_CLOSED);
  assert.equal(asked.auth, 0);
});

test("a key made for another company reads nothing", async () => {
  const { pool } = standIn({ shootOrg: ORG });
  const { deps: d } = deps({ db: pool });
  const out = res();
  await shootHandler(request("GET", { key: mint({ orgId: OTHER_ORG }) }), out, d);
  assert.equal(out.statusCode, 404);
  assert.equal(out.body.message, FILM_LINK_CLOSED);
});

test("a forged key, an expired key and a key made with another secret are closed before any data is read", async () => {
  const good = mint();
  const forged = good.slice(0, -4) + (good.endsWith("aaaa") ? "bbbb" : "aaaa");
  const expired = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, ttlSeconds: 60, now: () => NOW - 10 * 60_000 }).token;
  const wrongSecret = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: OTHER_SECRET, now: () => NOW }).token;
  for (const [label, key] of [["forged", forged], ["expired", expired], ["made with another secret", wrongSecret], ["not a key at all", "film-key-1"]]) {
    const { pool, calls } = standIn();
    const { deps: d, asked } = deps({ db: pool });
    const out = res();
    await shootHandler(request("GET", { key }), out, d);
    assert.equal(out.statusCode, 404, label);
    assert.equal(out.body.message, FILM_LINK_CLOSED, label);
    assert.equal(calls.connects, 0, `${label}: nothing was read`);
    assert.equal(asked.auth, 0, label);
  }
});

test("with no film secret set, every key is closed", async () => {
  const { pool, calls } = standIn();
  const { deps: d } = deps({ db: pool, secret: "" });
  const out = res();
  await shootHandler(request("GET", { key: mint() }), out, d);
  assert.equal(out.statusCode, 404);
  assert.equal(calls.connects, 0);
});

test("a film key cannot write the shoot: a POST goes to the sign-in check and nothing is saved", async () => {
  const { pool, calls } = standIn();
  const { deps: d, asked } = deps({ db: pool });
  const out = res();
  await shootHandler(request("POST", { key: mint(), body: { request_id: "a-request-id-1", id: SHOOT, status: "done" } }), out, d);
  assert.equal(asked.auth, 1, "the key did not stand in for a sign-in");
  assert.equal(out.statusCode, 401);
  assert.equal(calls.connects, 0);
});

test("a key marks the take on its own shoot only, with no sign-in", async () => {
  const body = (shootId) => ({ request_id: "a-request-id-2", shoot_id: shootId, root_script_id: SCRIPT, mark: "got_it" });

  // Another shoot: closed at the door, nothing read or written.
  {
    const { pool, calls } = standIn();
    const { deps: d, asked } = deps({ db: pool });
    const out = res();
    await markHandler(request("POST", { key: mint(), body: body(OTHER_SHOOT) }), out, d);
    assert.equal(out.statusCode, 404);
    assert.equal(out.body.message, FILM_LINK_CLOSED);
    assert.equal(calls.connects, 0);
    assert.equal(asked.auth, 0);
  }
  // A forged key: closed.
  {
    const { pool, calls } = standIn();
    const { deps: d } = deps({ db: pool });
    const out = res();
    await markHandler(request("POST", { key: `${mint().slice(0, -4)}ffff`, body: body(SHOOT) }), out, d);
    assert.equal(out.statusCode, 404);
    assert.equal(calls.connects, 0);
  }
  // The right shoot: it goes on to the save, with no sign-in asked. The stand-in has no such script on
  // the shoot, so the save answers "not found" from its own check, which proves the door was opened.
  {
    const { pool, calls } = standIn();
    const { deps: d, asked } = deps({ db: pool });
    const out = res();
    await markHandler(request("POST", { key: mint(), body: body(SHOOT) }), out, d);
    assert.equal(asked.auth, 0);
    assert.ok(calls.connects >= 1, "the door opened and the save ran");
    assert.equal(out.statusCode, 404);
    assert.match(out.body.message, /not found|not on it/i);
  }
});
