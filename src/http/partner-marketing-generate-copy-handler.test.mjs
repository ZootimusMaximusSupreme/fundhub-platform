// POST /api/partner-marketing/generate-copy — the real handler, no Postgres, no AI.
//
// "Write page copy" on Brand Studio rewrites a white-label partner's public page.
// No test ever ran the door. AI spend is on hold (owner, 2026-10-06), so this
// file never calls a model: every model key is taken out of the process for the
// run and the network is refused. It proves the refusals a partner can hit
// (wrong partner, suite off, budget spent, locked legal block, no model on the
// site) and that a refusal changes nothing on the page.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/partner-marketing/generate-copy.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const PAGE = "9c000000-0000-4000-8000-000000000001";

const MODEL_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COMPANY_BRAIN_OPENAI_API_KEY"];
const savedKeys = {};
const netCalls = [];
const realFetch = globalThis.fetch;
before(() => {
  for (const k of MODEL_KEYS) { savedKeys[k] = process.env[k]; delete process.env[k]; }
  globalThis.fetch = async (url) => { netCalls.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of MODEL_KEYS) { if (savedKeys[k] !== undefined) process.env[k] = savedKeys[k]; }
  globalThis.fetch = realFetch;
});

const pageRow = (partnerId = PARTNER) => [/SELECT \* FROM partner_pages WHERE id = \$1/, [{
  id: PAGE, org_id: ORG_ID, partner_id: partnerId, title: "Fund your business", funnel_key: "partner-board",
  body_json: { sections: [
    { id: "hero", type: "hero", headline: "Get funded", sub: "Up to $250k, if you qualify" },
    { id: "legal-lender", type: "legal", locked: true, text: "We are not a lender." }
  ] }
}]];
const brandRow = [/SELECT \* FROM partner_brand WHERE partner_id = \$1/, [{ partner_id: PARTNER, entity_name: "Acme Capital", voice: "plain" }]];
const suite = (enabled) => [/FROM partner_module_settings/, [{ marketing_suite_enabled: enabled, ai_token_cap_monthly: 100000, org_id: ORG_ID }]];
const used = (n) => [/FROM partner_ai_usage/, [{ used: n }]];
const usageInsert = [/INSERT INTO partner_ai_usage/, [{ id: "u1", input_tokens: 0, output_tokens: 0 }]];

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

function pageChanged(fake) {
  return fake.calls.some((c) => /UPDATE partner_pages|INSERT INTO partner_page_section_versions/i.test(c.sql));
}

describe("POST /api/partner-marketing/generate-copy", () => {
  test("is routed", () => {
    assert.equal(ROUTES["partner-marketing/generate-copy"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401", async () => {
    const { res } = await call(req("POST", { body: { page_id: PAGE } }), []);
    assert.equal(res.statusCode, 401);
  });

  test("no page id: 400", async () => {
    const { res } = await call(req("POST", { body: {} }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "page_id_required");
  });

  test("a page that is not there: 404, rolled back", async () => {
    const { res, fake } = await call(req("POST", { body: { page_id: PAGE } }), [staffSession()]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.calls.filter((c) => c.sql === "ROLLBACK").length, 1);
  });

  test("a partner cannot rewrite another partner's page", async () => {
    const { res, fake } = await call(
      req("POST", { body: { page_id: PAGE } }),
      [...accountSession({ kind: "partner", partnerId: PARTNER }), pageRow(OTHER_PARTNER)]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
    assert.equal(pageChanged(fake), false);
  });

  test("the owner has not turned the suite on: 403 suite_off, nothing written", async () => {
    const { res, fake } = await call(
      req("POST", { body: { page_id: PAGE } }),
      [...accountSession({ kind: "partner", partnerId: PARTNER }), pageRow(), brandRow, suite(false)]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "suite_off");
    assert.equal(fake.find(/INSERT INTO partner_ai_usage/).length, 0);
    assert.equal(pageChanged(fake), false);
  });

  test("this month's writing budget is spent: 429, the model is never asked", async () => {
    const { res, fake } = await call(
      req("POST", { body: { page_id: PAGE } }),
      [staffSession(), pageRow(), brandRow, suite(true), used(100000)]
    );
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, "token_cap");
    assert.equal(res.body.usage.remaining, 0);
    assert.equal(fake.find(/INSERT INTO partner_ai_usage/).length, 0);
    assert.equal(netCalls.length, 0);
  });

  test("the locked legal block can never be rewritten: 400 locked_section", async () => {
    const { res, fake } = await call(
      req("POST", { body: { page_id: PAGE, section_id: "legal-lender" } }),
      [staffSession(), pageRow(), brandRow, suite(true), used(0)]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "locked_section");
    assert.equal(pageChanged(fake), false);
  });

  test("no model key on the site: 503 no_model, the page is not changed, nothing went on the wire", async () => {
    const { res, fake } = await call(
      req("POST", { body: { page_id: PAGE, section_id: "hero" } }),
      [staffSession(), pageRow(), brandRow, suite(true), used(0), usageInsert]
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "no_model");
    assert.equal(pageChanged(fake), false);
    assert.equal(netCalls.length, 0);
    // The whole thing rolled back, so the zero-token usage row did not stick.
    assert.equal(fake.calls.filter((c) => c.sql === "ROLLBACK").length, 1);
    assert.equal(fake.calls.filter((c) => c.sql === "COMMIT").length, 0);
  });
});
