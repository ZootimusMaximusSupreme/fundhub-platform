// Shared by the slice-2 route tests (src/http/s2-*.test.mjs): one way to run a
// real api/ handler against a stand-in database, and the one list of staff roles
// every role gate is judged against.
//
// A role gate is only proved when EVERY role is tried: the ones it admits get
// through and each of the others is refused. Trying one allowed role and one
// refused role leaves the rest of the list unjudged, so a gate opened to a
// setter or a csm would stay green. splitRoles() turns the gate's written list
// into the two halves, and the roles come from the app's own STAFF set, so a
// role added later joins every table without an edit here.
import { fakeDb, makeRes, runWithSharedDb, ORG_ID } from "../../../testing/handler-harness.mjs";
import { ROLE_SETS } from "../../../http/read-api.mjs";

export const STAFF_ROLES = Object.freeze([...ROLE_SETS.STAFF]);

export const CLIENT = "c1000000-0000-4000-8000-000000000001";
export const DANA = Object.freeze({
  first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100",
});

/**
 * A stand-in answer to "is this client in this company": it answers from BOTH
 * statement parameters ($1 the client, $2 the company), the way the database
 * does, so a handler that asks about the wrong company is told no.
 */
export function clientIn(re, row, { clientId = CLIENT, orgId = ORG_ID } = {}) {
  return [re, (_s, p) => (p[0] === clientId && p[1] === orgId ? [row] : [])];
}

/**
 * Refuse every outbound call for the file's tests and keep what was asked for.
 * Pass node:test's before and after; returns the list of addresses asked for.
 */
export function refuseNetwork({ before, after }) {
  const real = globalThis.fetch;
  const asked = [];
  before(() => {
    globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
  });
  after(() => { globalThis.fetch = real; });
  return asked;
}

/** { admitted, refused }: every staff role, split by the gate's written list. */
export function splitRoles(allowed) {
  const allow = new Set(allowed);
  return {
    admitted: STAFF_ROLES.filter((role) => allow.has(role)),
    refused: STAFF_ROLES.filter((role) => !allow.has(role)),
  };
}

/** Run one handler call against a stand-in database; keep every statement it ran. */
export async function call(handler, request, rules, deps) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => (deps ? handler(request, res, deps) : handler(request, res)));
  return { res, fake };
}
