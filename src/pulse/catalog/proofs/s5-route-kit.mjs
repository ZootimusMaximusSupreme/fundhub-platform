// Small kit for the S5 route proofs. It wraps the shared handler harness so a
// proof reads as: who calls, what the stand-in database holds, what came back.
// Nothing here reaches a real database, a vendor, or a network.

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
