/* api/payment-links.mjs, driven end to end — same approach as
 * src/http/subscriptions-endpoints.test.mjs: src/db.mjs's `db` is a plain
 * object with one `query` method, stubbed here, so both the session lookup
 * and every store call run exactly as they do in production with no Postgres.
 *
 * package.json's test glob is src/** and scripts/** only (CLAUDE.md, traps),
 * so this lives here and imports the handler from api/.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import paymentLinks from "../../api/payment-links.mjs";
import { ROLE_SETS } from "./read-api.mjs";
import { clearHandlers } from "../events/registry.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_CLIENT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const LINK_ID = "55555555-1111-4111-8111-555555555555";
const CHECKOUT_BASE = "https://pay.commas.io/c/onboarding";

let savedQuery = null;
let savedEnv = null;
let savedKey = null;
beforeEach(() => {
  savedQuery = db.query;
  savedEnv = process.env.COMMAS_CHECKOUT_BASE_URL;
  process.env.COMMAS_CHECKOUT_BASE_URL = CHECKOUT_BASE;
  /* REAL-MONEY GUARD. "create" now reaches the live checkout-session API when
     FANBASIS_CHECKOUT_API_KEY is present, and that call mints a REAL, payable
     Commas session. `npm test` does not load .env, but a developer who sourced
     it into their shell would have the key exported for the whole run. So the
     key is removed for every test here and restored after. Belt; the braces
     are the `noNetwork` fetch below. */
  savedKey = process.env.FANBASIS_CHECKOUT_API_KEY;
  delete process.env.FANBASIS_CHECKOUT_API_KEY;
  clearHandlers(); // sendTemplated's message.queued emit must not reach a stray handler from another suite
});
afterEach(() => {
  db.query = savedQuery;
  if (savedEnv === undefined) delete process.env.COMMAS_CHECKOUT_BASE_URL;
  else process.env.COMMAS_CHECKOUT_BASE_URL = savedEnv;
  if (savedKey === undefined) delete process.env.FANBASIS_CHECKOUT_API_KEY;
  else process.env.FANBASIS_CHECKOUT_API_KEY = savedKey;
});

const makeRes = () => ({
  statusCode: 0, body: null, headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

const LINK_ROW = {
  id: LINK_ID, org_id: ORG_A, client_id: CID, purpose: "deposit", description: null,
  amount_cents: "250000", currency: "USD", status: "created",
  link_ref: "pl_abc123", checkout_url: `${CHECKOUT_BASE}?amount=2500.00&ref=pl_abc123`,
  provider: "commas", commas_session_id: null, paid_amount_cents: null,
  created_by_staff_id: "staff-1", created_at: "2026-08-01T00:00:00.000Z",
  sent_at: null, paid_at: null, expired_at: null
};

const INVOICE_ID = "66666666-1111-4111-8111-666666666666";
const INVOICE_ROW = {
  id: INVOICE_ID, org_id: ORG_A, client_id: CID, source: "other",
  status: "draft", amount_due: "100.00", currency: "USD",
  idempotency_key: `present-invoice:${CID}:10000`,
  notes: "Invoice this client"
};

const ROUTES = {
  ownsClient: { re: /SELECT\s+1\s+FROM\s+clients/i, rows: () => [{ "?column?": 1 }] },
  linksInsert: { re: /INSERT\s+INTO\s+payment_links/i, rows: () => [LINK_ROW] },
  linksGetOne: { re: /SELECT\s+\*\s+FROM\s+payment_links\s+WHERE\s+id/i, rows: () => [LINK_ROW] },
  linksSetSent: { re: /UPDATE\s+payment_links[\s\S]*status = 'sent'/i, rows: () => [{ ...LINK_ROW, status: "sent", sent_at: "2026-08-02T00:00:00.000Z" }] },
  linksSetExpired: { re: /UPDATE\s+payment_links[\s\S]*status = 'expired'/i, rows: () => [{ ...LINK_ROW, status: "expired", expired_at: "2026-08-02T00:00:00.000Z" }] },
  linksList: { re: /SELECT\s+\*\s+FROM\s+payment_links\s+WHERE\s+org_id[\s\S]*client_id/i, rows: () => [LINK_ROW] },
  invoicesInsert: { re: /INSERT\s+INTO\s+invoices/i, rows: () => [INVOICE_ROW] },
  invoicesByKey: { re: /FROM\s+invoices\s+WHERE\s+org_id[\s\S]*idempotency_key/i, rows: () => [INVOICE_ROW] },
  templateLookup: { re: /FROM\s+message_templates/i, rows: () => [] }, // no template row => template_pending, no live send
  optOuts: { re: /FROM\s+opt_outs/i, rows: () => [] }
};

function stubDb({ role = "owner", roles = [role], orgId = ORG_A, authenticated = true, ownsClient = true, handlers = {} } = {}) {
  const queries = [];
  db.query = async (sql, params) => {
    const text = String(sql);
    const isSession = /FROM\s+sessions/i.test(text) || (/session/i.test(text) && !/payment_links|clients|message_templates/i.test(text));
    if (isSession) {
      if (!authenticated) return { rows: [] };
      return {
        rows: [{
          session_id: "sess-1", expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1", org_id: orgId, role, roles, email: `${role}@fundhub.ai`, name: role,
          status: "active", active_flag: "true"
        }]
      };
    }
    queries.push({ sql: text, params });
    for (const [name, spec] of Object.entries(ROUTES)) {
      if (!spec.re.test(text)) continue;
      const h = handlers[name];
      if (typeof h === "function") return h(params, text);
      if (h && h.throws) throw h.throws;
      if (h) return { rows: h.rows || [] };
      return { rows: spec.rows ? spec.rows() : [] };
    }
    throw new Error(`test stub: no route for SQL: ${text.slice(0, 90)}`);
  };
  if (!("ownsClient" in handlers)) handlers.ownsClient = { rows: ownsClient ? [{ "?column?": 1 }] : [] };
  return queries;
}

/* A fetch that refuses. No test in this file may reach the network — the mint
   path posts real money requests to a real payment processor. A test that
   wants the mint branch hands in its own fetchImpl. */
const noNetwork = async (url) => {
  throw new Error(`test stub: refused a live request to ${String(url)}`);
};

async function call(opts = {}) {
  const { method = "GET", query = {}, body = undefined, env, fetchImpl = noNetwork, ...rest } = opts;
  const queries = stubDb(rest);
  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query, body };
  const deps = { env: env ?? process.env, fetchImpl };
  const thrown = await paymentLinks(req, res, deps).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, queries, thrown };
}

const ran = (queries, name) => queries.filter((q) => ROUTES[name].re.test(q.sql));

describe("GET /api/payment-links", () => {
  test("no session is a 401 and reads nothing", async () => {
    const r = await call({ query: { client_id: CID }, authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(r.queries, []);
  });

  for (const role of [...ROLE_SETS.FINANCE]) {
    test(`a ${role} lists this client's links`, async () => {
      const r = await call({ query: { client_id: CID }, role });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.FINANCE and was refused`);
      assert.equal(r.body.items.length, 1);
      assert.equal(r.body.items[0].amount_display, "2500.00");
    });
  }

  for (const role of ["closer", "setter", "funding_advisor", "client", ""]) {
    test(`a ${JSON.stringify(role)} is refused — a payment link is a request for money`, async () => {
      const r = await call({ query: { client_id: CID }, role });
      assert.equal(r.status, 403);
      assert.deepEqual(r.queries, []);
    });
  }

  test("a session with no org matches nothing", async () => {
    const r = await call({ query: { client_id: CID }, orgId: null });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(r.queries, []);
  });

  test("a malformed client_id is a 400 before any query", async () => {
    const r = await call({ query: { client_id: "not-a-uuid" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.queries, []);
  });

  test("a client in another org is a 403 and the links are never read", async () => {
    const r = await call({ query: { client_id: OTHER_CLIENT }, ownsClient: false });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "linksList").length, 0);
  });

  test("the read carries the SESSION's org, never one from the query string", async () => {
    const r = await call({ query: { client_id: CID, org_id: ORG_B } });
    const q = ran(r.queries, "linksList")[0];
    assert.ok(q.params.includes(ORG_A));
    assert.ok(!q.params.includes(ORG_B));
  });
});

describe("POST /api/payment-links — create", () => {
  const create = (body, opts = {}) =>
    call({ method: "POST", body: { action: "create", client_id: CID, ...body }, ...opts });

  test("an org_id in the body is refused outright", async () => {
    const r = await create({ org_id: ORG_B, purpose: "deposit", price: "25.00" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.deepEqual(r.queries, []);
  });

  /* These two replace a single older test, "no COMMAS_CHECKOUT_BASE_URL
     configured means 503, not an invented link", which asserted the defect:
     it locked in a 503 whenever the base URL was missing, even though the
     FanBasis API key alone is enough to mint a link. Refusing to invent a link
     is still asserted — in (a), where there really is no way to build one. */

  test("neither checkout setting configured means 503, not an invented link", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" }, { env: {} });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "commas_not_configured");
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("the FanBasis API key alone is enough — no COMMAS_CHECKOUT_BASE_URL needed", async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push({ url: String(url), body: JSON.parse(opts.body), apiKey: opts.headers["x-api-key"] });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { id: "N1test", payment_link: "https://www.fanbasis.com/agency-checkout/x/N1test" }
        })
      };
    };
    const r = await create({ purpose: "deposit", price: "25.00" }, {
      env: { FANBASIS_CHECKOUT_API_KEY: "fb-key" },
      fetchImpl
    });
    assert.notEqual(r.status, 503, "the API key was set and the endpoint still refused");
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1, "the checkout-session API was never called");
    assert.equal(seen[0].apiKey, "fb-key");
    assert.equal(seen[0].body.amount_cents, 2500);
    // The row records what the provider actually returned. Nothing is invented.
    const ins = ran(r.queries, "linksInsert")[0];
    assert.ok(ins, "no payment_links row was written");
    assert.equal(ins.params[7], "https://www.fanbasis.com/agency-checkout/x/N1test");
    assert.equal(ins.params[9], "N1test");
  });

  test("a checkout provider that refuses is a 502 the CRM can read, not a 500", async () => {
    const fetchImpl = async () => ({
      ok: false, status: 500, text: async () => JSON.stringify({ message: "upstream on fire" })
    });
    const r = await create({ purpose: "deposit", price: "25.00" }, {
      env: { FANBASIS_CHECKOUT_API_KEY: "fb-key" },
      fetchImpl
    });
    assert.equal(r.thrown, null, "the provider error escaped the handler and became a generic 500");
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "commas_checkout_failed");
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("dollars convert to integer cents once, at the boundary", async () => {
    const r = await create({ purpose: "deposit", price: "2500.00" });
    assert.equal(r.status, 200);
    const ins = ran(r.queries, "linksInsert")[0];
    assert.ok(ins.params.includes(250000), `expected 250000 cents in ${JSON.stringify(ins.params)}`);
  });

  test("an absent amount is refused — there is no 'unknown price' payment link", async () => {
    const r = await create({ purpose: "deposit" });
    assert.equal(r.status, 400);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("a zero or negative amount is refused", async () => {
    for (const price of ["0", "-5.00"]) {
      const r = await create({ purpose: "repair", price });
      assert.equal(r.status, 400, `price ${price} was accepted`);
    }
  });

  test("price and price_cents together are refused, not silently resolved", async () => {
    const r = await create({ purpose: "deposit", price: "25.00", price_cents: 2600 });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /not both/i);
  });

  test("purpose=custom with no description is refused before any write", async () => {
    const r = await create({ purpose: "custom", price: "10.00" });
    assert.equal(r.status, 400);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("purpose invoice writes an invoice row and no payment link", async () => {
    const r = await create({ purpose: "invoice", price: "100.00", description: "Credit repair, done-for-you" }, { env: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.invoice.id, INVOICE_ID);
    assert.equal(r.body.invoice.status, "draft");
    assert.equal(ran(r.queries, "invoicesInsert").length, 1);
    const ins = ran(r.queries, "invoicesInsert")[0];
    assert.equal(ins.params[0], ORG_A);
    assert.equal(ins.params[1], CID);
    assert.equal(ins.params[3], "other");
    assert.equal(ins.params[5], 100);
    assert.equal(ins.params[12], `present-invoice:${CID}:10000`);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("purpose invoice replay returns the same invoice and still mints no pay link", async () => {
    const r = await create(
      { purpose: "invoice", price_cents: 10000, description: "Credit repair, done-for-you" },
      { env: {}, handlers: { invoicesInsert: { rows: [] } } }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.invoice.id, INVOICE_ID);
    assert.equal(ran(r.queries, "invoicesInsert").length, 1);
    assert.equal(ran(r.queries, "invoicesByKey").length, 1);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  test("an unknown purpose is refused", async () => {
    const r = await create({ purpose: "yacht", price: "10.00" });
    assert.equal(r.status, 400);
  });

  test("the row is filed under the session's org and the acting staff member", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" });
    const ins = ran(r.queries, "linksInsert")[0];
    assert.equal(ins.params[0], ORG_A);
    assert.equal(ins.params[8], "staff-1");
  });

  test("a client in another org cannot have a link created for them", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" }, { ownsClient: false });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  /* A closer CAN create. They already mint links through api/closer-deck.mjs
     (send_pay_link / send_soft_pull), so refusing them here only closed the
     CRM's own button to the one person whose job is taking payment on the
     call. Creating is where that stops: sending the ask by SMS and expiring a
     live ask stay on ROLE_SETS.FINANCE, asserted in the send block below. */
  test("a closer can create a payment link for a client their own org owns", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" }, { role: "closer" });
    assert.equal(r.status, 200, "a closer was refused the create action");
    assert.equal(ran(r.queries, "linksInsert").length, 1);
    const ins = ran(r.queries, "linksInsert")[0];
    assert.equal(ins.params[0], ORG_A, "the link was not filed under the closer's own org");
  });

  test("a closer still cannot create a link for a client another org owns", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" }, { role: "closer", ownsClient: false });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "linksInsert").length, 0);
  });

  for (const role of ["setter", "funding_advisor", "inquiry_specialist", "client"]) {
    test(`a ${role} cannot create a payment link`, async () => {
      const r = await create({ purpose: "deposit", price: "25.00" }, { role });
      assert.equal(r.status, 403);
      assert.deepEqual(r.queries, []);
    });
  }

  test("the response carries a real checkout URL for the CRM to copy", async () => {
    const r = await create({ purpose: "deposit", price: "25.00" });
    assert.ok(r.body.link.checkout_url.startsWith(CHECKOUT_BASE));
  });
});

describe("POST /api/payment-links — send", () => {
  const send = (opts = {}) => call({ method: "POST", body: { action: "send", id: LINK_ID }, ...opts });

  test("a malformed id is a 400 before any query", async () => {
    const r = await call({ method: "POST", body: { action: "send", id: "nope" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.queries, []);
  });

  test("an unknown link is a 404", async () => {
    const r = await send({ handlers: { linksGetOne: { rows: [] } } });
    assert.equal(r.status, 404);
  });

  test("send with no template approved yet queues nothing and does not mark the link sent", async () => {
    const r = await send();
    assert.equal(r.status, 200);
    assert.equal(r.body.message_queued, false);
    assert.equal(r.body.message_reason, "template_pending");
    assert.notEqual(r.body.link.status, "sent");
    assert.equal(ran(r.queries, "linksSetSent").length, 0);
  });

  test("sending an already-paid link is refused — it would ask for settled money again", async () => {
    const r = await send({ handlers: { linksGetOne: { rows: [{ ...LINK_ROW, status: "paid" }] } } });
    assert.equal(r.status, 409);
    assert.equal(ran(r.queries, "linksSetSent").length, 0);
  });

  test("sending an expired link is refused", async () => {
    const r = await send({ handlers: { linksGetOne: { rows: [{ ...LINK_ROW, status: "expired" }] } } });
    assert.equal(r.status, 409);
  });

  test("a link in another org cannot be sent", async () => {
    const r = await send({ handlers: { linksGetOne: { rows: [] } } }); // org-scoped lookup finds nothing
    assert.equal(r.status, 404);
  });

  for (const role of ["closer", "setter", "funding_advisor", "client"]) {
    test(`a ${role} cannot send a payment link`, async () => {
      const r = await send({ role });
      assert.equal(r.status, 403);
      assert.deepEqual(r.queries, []);
    });
  }
});

describe("POST /api/payment-links — expire", () => {
  const expire = (opts = {}) => call({ method: "POST", body: { action: "expire", id: LINK_ID }, ...opts });

  test("created -> expired", async () => {
    const r = await expire();
    assert.equal(r.status, 200);
    assert.equal(r.body.link.status, "expired");
  });

  test("expiring an already-paid link is a 409, not a silent status change", async () => {
    const r = await expire({ handlers: { linksSetExpired: { rows: [] } } });
    assert.equal(r.status, 409);
  });

  test("an unknown link is a 404", async () => {
    const r = await expire({ handlers: { linksGetOne: { rows: [] } } });
    assert.equal(r.status, 404);
  });

  test("a closer cannot expire a link — creating is the only action they gained", async () => {
    const r = await expire({ role: "closer" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.queries, []);
  });
});

describe("method + action guards", () => {
  test("a PUT is a 405 with an allow header and touches nothing", async () => {
    const r = await call({ method: "PUT", body: {} });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "GET, POST");
    assert.deepEqual(r.queries, []);
  });

  test("an unknown action is a 400 and writes nothing", async () => {
    const r = await call({ method: "POST", body: { action: "cash_it_in", client_id: CID } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_action");
  });
});


test("an assigned closer cannot inherit finance list/send/expire operations", async () => {
  for (const [method,body] of [["GET",{}],["POST",{action:"send",id:LINK_ID}],["POST",{action:"expire",id:LINK_ID}]]) {
    const r=await call({method,body,query:{client_id:CID},role:"setter",roles:["setter","closer"]});
    assert.equal(r.status,403);
    assert.equal(r.queries.some(c=>/payment_links|INSERT INTO messages/.test(c.sql)),false);
  }
});
