// Slice 1 (money routes): /api/public/slo-pull, the door the paying $297 buyer
// posts to from apply.fundhub.ai. Two results matter for money: the browser's
// permission question is answered for that origin (or the buyer is blocked with
// no error on the page), and the SLO_DEMO_PAY switch stores nothing.
import assert from "node:assert/strict";
import test from "node:test";

import slopull from "../../../../api/public/slo-pull.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { fakeDb, makeRes } from "../../../testing/handler-harness.mjs";

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REF = "slo_0123456789abcdef01234567";
const WIDGET = "https://apply.fundhub.ai";
const FIELD_VALUE_SSN = ["987", "65", "4321"].join("");

const BODY = {
  ref: REF, client_id: CLIENT, first_name: "Ada", last_name: "Byron", dob: "1990-01-02",
  ssn: FIELD_VALUE_SSN, address: "100 Test Ave", city: "Denton", state: "TX", zip: "76205", consent: true,
};

function request(method, { origin = WIDGET, body } = {}) {
  return { method, headers: origin ? { origin } : {}, ...(body ? { body } : {}) };
}

test("slo-pull OPTIONS from the widget origin is answered so the browser lets the buyer POST JSON, and reads nothing", async () => {
  assert.equal(ROUTES["public/slo-pull"], slopull);
  const db = fakeDb([]);
  const res = makeRes();
  await slopull(request("OPTIONS"), res, { db });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], WIDGET, "the origin is echoed, never a star");
  assert.equal(res.headers.vary, "Origin");
  assert.match(res.headers["access-control-allow-methods"], /\bPOST\b/);
  assert.match(res.headers["access-control-allow-headers"], /content-type/i);
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
  assert.equal(db.calls.length, 0, "a preflight never touches the database");
});

test("slo-pull gives a stranger origin no cross-site permission, on the preflight and on the POST", async () => {
  const preflight = makeRes();
  await slopull(request("OPTIONS", { origin: "https://evil.example" }), preflight, { db: fakeDb([]) });
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
  assert.equal(preflight.headers["access-control-allow-methods"], undefined);

  const post = makeRes();
  await slopull(request("POST", { origin: "https://evil.example", body: BODY }), post, {
    env: { SLO_DEMO_PAY: "1" }, checkAddresses: async () => [], db: fakeDb([]),
  });
  assert.equal(post.headers["access-control-allow-origin"], undefined);
});

test("slo-pull POST from the widget carries the origin header too, so the browser can read the answer", async () => {
  const res = makeRes();
  await slopull(request("POST", { body: BODY }), res, { env: { SLO_DEMO_PAY: "1" }, checkAddresses: async () => [], db: fakeDb([]) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], WIDGET);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("SLO_DEMO_PAY=1 checks the form, answers ok and stores NOTHING; with it off the same POST goes to the real order lookup", async () => {
  const on = fakeDb([]);
  const demo = makeRes();
  await slopull(request("POST", { body: BODY }), demo, {
    env: { SLO_DEMO_PAY: "1" }, checkAddresses: async () => [], db: on,
    emit: async () => { throw new Error("demo must not emit"); },
  });
  assert.equal(demo.statusCode, 200);
  assert.deepEqual(
    { ok: demo.body.ok, demo: demo.body.demo, stored: demo.body.stored, pull_requested: demo.body.pull_requested, next: demo.body.next },
    { ok: true, demo: true, stored: false, pull_requested: false, next: "book" },
  );
  assert.equal(on.calls.length, 0, "no identity, consent, business or order is read or written");
  assert.equal(JSON.stringify(demo.body).includes(FIELD_VALUE_SSN), false, "the number typed is never echoed back");

  const off = fakeDb([]);
  const live = makeRes();
  await slopull(request("POST", { body: BODY }), live, { env: {}, checkAddresses: async () => [], db: off });
  assert.equal(live.statusCode, 404, "off: the real path runs and finds no paid order for a guessed person");
  assert.equal(live.body.error, "not_found");
  assert.ok(off.calls.length > 0, "off: the order lookup really ran against the database");
  assert.equal(off.find(/INSERT|UPDATE/i).length, 0, "and nothing was written for a person with no paid order");
});

test("slo-pull in demo mode still refuses an address that cannot be found, before it answers ok", async () => {
  const res = makeRes();
  await slopull(request("POST", { body: BODY }), res, {
    env: { SLO_DEMO_PAY: "1" }, db: fakeDb([]),
    checkAddresses: async () => [{ field: "address", code: "address_unverified", message: "We couldn't find that address." }],
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, "address_unverified");
});
