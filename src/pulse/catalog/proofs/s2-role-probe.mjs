// A signed-in role probe for the journey "reach" and "stays blocked" rows.
//
// It signs in as one kind of person (a staff role or an account kind) against a
// stand-in database, sends a GET and an empty POST through the REAL api adapter
// to one route, and says what the route's own gate did with that person. The
// network is refused and nothing is written anywhere: every read and write goes
// to the stand-in.
//
// What it can and cannot see, said plainly:
//   - It sees the entry gate (signed in, right kind of person, right role).
//   - An empty POST body is refused for being empty on some routes BEFORE their
//     later role check. Those routes look reachable here and are named, one by
//     one, in the test that uses this file. They are never counted as proved.
import { fakeDb, useSharedDb, staffSession, accountSession } from "../../../testing/handler-harness.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const PARTNER_ID = "b1000000-0000-4000-8000-000000000001";

/** The eight kinds of person the journeys describe, by journey name. */
export const PRINCIPALS = Object.freeze({
  client: () => accountSession({ kind: "client", clientId: CLIENT_ID }),
  affiliate: () => accountSession({ kind: "affiliate" }),
  "white-label": () => accountSession({ kind: "partner", partnerId: PARTNER_ID }),
  "role-owner": () => [staffSession({ role: "owner" })],
  "role-sales-manager": () => [staffSession({ role: "sales_manager" })],
  "role-closer": () => [staffSession({ role: "closer" })],
  "role-funding-advisor": () => [staffSession({ role: "funding_advisor" })],
  "role-inquiry-remover": () => [staffSession({ role: "inquiry_specialist" })],
});

// Prefix-routed doors have no exact key in ROUTES; these paths reach them.
const PATH_FOR = Object.freeze({
  "webhooks/:provider": "webhooks/twilio",
  "documents/:id": "documents/00000000-0000-4000-8000-000000000000",
});

const SECRET_DOOR_CODES = new Set(["bad_signature", "invalid_api_key", "missing_api_key"]);
const CONDITION_CODES = new Set(["no_active_shift", "suite_off"]);

async function oneCall(handler, path, method, rules, anonymous) {
  const fake = fakeDb(rules);
  const restore = useSharedDb(fake);
  try {
    const headers = { "content-type": "application/json" };
    if (!anonymous) headers.authorization = "Bearer test-token-not-real";
    const init = { method, headers, ...(method === "GET" ? {} : { body: "{}" }) };
    const response = await Promise.race([
      handler(new Request(`https://example.test/api/${path}`, init), {}),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    let body = {};
    try { body = JSON.parse(await response.text()); } catch { body = {}; }
    return { status: response.status, code: String(body.error || body.reason || "") };
  } catch (error) {
    return { status: 0, code: `threw:${String(error?.message || error).slice(0, 40)}` };
  } finally {
    restore();
  }
}

/** What happened to one person on one route key. */
export async function probeRoute(handler, key, principalName) {
  const path = PATH_FOR[key] || key;
  const rules = principalName ? PRINCIPALS[principalName]() : [];
  // This client-only door checks that the signed-in client has a file before
  // returning the saved switch. Give the probe that one file; other roles get none.
  if (key === "push/preferences" && principalName === "client") {
    rules.push([/FROM clients WHERE org_id = \$1 AND id = \$2 LIMIT 1/, () => [{ marketing_push_enabled: false }]]);
  }
  const get = await oneCall(handler, path, "GET", rules, !principalName);
  const post = await oneCall(handler, path, "POST", rules, !principalName);
  return { GET: get, POST: post };
}

/**
 * The verdict for one probe:
 *   "reach"       a method got past the entry gate (any answer but 401, 403, 405)
 *   "reach-late"  refused only by a condition after the gate (no shift, suite off,
 *                 banking not configured): the person was recognised and admitted
 *   "secret-door" no session is read at all; the door asks for its own signature
 *                 or key, and answered that way
 *   "blocked"     401 or 403 from the gate, and no method got past it
 *   "unclear"     nothing but 405 or crashes
 */
export function verdictFor(probe) {
  const answers = Object.values(probe);
  const secret = answers.find((a) => a.status === 401 && SECRET_DOOR_CODES.has(a.code));
  if (answers.some((a) => a.status && ![401, 403, 405].includes(a.status))) return "reach";
  if (answers.some((a) => a.status === 403 && (CONDITION_CODES.has(a.code) || /^banking surface requires/.test(a.code)))) {
    return "reach-late";
  }
  if (secret) return "secret-door";
  if (answers.some((a) => a.status === 401 || a.status === 403)) return "blocked";
  return "unclear";
}

export const OPENS = new Set(["reach", "reach-late", "secret-door"]);
