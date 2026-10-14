// Small kit for the S5 route proofs. It wraps the shared handler harness so a
// proof reads as: who calls, what the stand-in database holds, what came back.
// Nothing here reaches a real database, a vendor, or a network.

import assert from "node:assert/strict";

import {
  ORG_ID,
  accountSession,
  fakeDb,
  makeRes,
  req as authedRequest,
  runWithSharedDb,
  staffSession,
} from "../../../testing/handler-harness.mjs";
import { S5_ROUTE_ROWS } from "./s5-door-contracts.mjs";

export { ORG_ID };

// hit(handler, options) runs the REAL api/ handler once.
//   role / staff  who is signed in (staffSession answers the session check)
//   rules         stand-in database answers: [[RegExp | fn, rows | fn]]
//   account       sign in as a partner/client account instead: { kind, partnerId }
//   anonymous     send no sign-in at all
//   deps          third handler argument (a fixed clock, for example)
// It returns what the caller would see, plus the stand-in db so a proof can
// read the exact SQL parameters that were bound.
export async function hit(handler, {
  method = "GET", query, body, role = "owner", staff = {}, rules = [], anonymous = false, headers, deps, account = null,
} = {}) {
  const session = account ? accountSession(account) : [staffSession({ role, ...staff })];
  const database = fakeDb([...session, ...rules]);
  const request = anonymous
    ? { method, body: body ?? {}, query: query || {}, headers: headers || {} }
    : authedRequest(method, { body, query, headers });
  const response = makeRes();
  await runWithSharedDb(database, () => (deps ? handler(request, response, deps) : handler(request, response)));
  return { status: response.statusCode, body: response.body, headers: response.headers, db: database };
}

// Every SQL call that matched a pattern, with its bound parameters.
export function sqlCalls(result, pattern) {
  return result.db.calls.filter((call) => pattern.test(call.sql));
}

// Every kind of staff sign-in a gate has to tell apart. "partner" and "client"
// are included on purpose: a staff door must refuse them too.
export const EVERY_ROLE = [
  "owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter", "partner", "client",
];

// Signs in as EVERY role and judges the gate both ways: each role in `allowed`
// gets past it, and each other role is refused with a 403 before any data is
// read or written. A gate that was only ever tried with the roles it admits
// proves nothing, and a role added to the allowed set by mistake turns this red.
// `request` is what hit() takes (method, body, query, rules).
export async function assertRoleGate(handler, allowed, request = {}) {
  assert.ok(allowed.every((role) => EVERY_ROLE.includes(role)), "allowed roles must be known roles");
  for (const role of EVERY_ROLE) {
    let result;
    try {
      result = await hit(handler, { ...request, role });
    } catch (error) {
      // A handler that gets past the gate and then trips on an empty stand-in
      // database was let in. Only a refusal is judged here.
      assert.ok(allowed.includes(role), `${role} was not refused: ${error.message}`);
      continue;
    }
    if (allowed.includes(role)) {
      assert.ok(![401, 403].includes(result.status), `${role} must be let in, got ${result.status}`);
      continue;
    }
    assert.equal(result.status, 403, `${role} must be refused`);
    const reads = result.db.calls.filter((call) => !/FROM live JOIN staff/.test(call.sql));
    assert.deepEqual(reads.map((call) => call.sql), [], `${role} is refused before any data is read or written`);
  }
}

// Bookkeeping so a proof file can only claim rows that exist in the registry,
// and the registry cannot list a row its proof file never ran.
export function exerciseLog(testFile) {
  const expected = new Set(S5_ROUTE_ROWS.filter((row) => row.test === testFile).map((row) => row.name));
  const seen = new Set();
  return {
    expected,
    mark(name) {
      if (!expected.has(name)) throw new Error(`${name} is not a registry row for ${testFile}`);
      seen.add(name);
    },
    missing() {
      return [...expected].filter((name) => !seen.has(name));
    },
  };
}
