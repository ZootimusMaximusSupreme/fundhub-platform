// POST /api/partner-marketing/generate-copy with NO block chosen, through the real handler
// (finish-the-853, batch 01, repair cycle 1).
//
// partner-marketing-generate-copy-handler.test.mjs holds every refusal. It never writes a whole page
// that holds a locked legal block, so removing the "skip locked blocks" rule left it green. Here the
// real handler runs end to end: the session gate, the page and brand reads, the writing code and the
// compliance screen. Only the database and the model are stand-ins, and the model answer is made up.
// Nothing is sent anywhere: the network is refused except the one stubbed model call.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/partner-marketing/generate-copy.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const PAGE = "9c000000-0000-4000-8000-000000000001";

const SECTIONS = [
  { id: "hero", type: "hero", headline: "Get funded", sub: "Up to $250k, if you qualify" },
  { id: "legal-lender", type: "legal", locked: true, headline: "Not a direct lender", text: "We are not a lender." },
  { id: "faq", type: "faq", headline: "Questions", sub: "Ask us anything" },
  { id: "legal-sms", type: "legal", locked: true, headline: "Messages", text: "Reply STOP to opt out." },
];

const MODEL_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COMPANY_BRAIN_OPENAI_API_KEY"];
const savedKeys = {};
const asked = [];
const realFetch = globalThis.fetch;
before(() => {
  for (const k of MODEL_KEYS) { savedKeys[k] = process.env[k]; delete process.env[k]; }
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  globalThis.fetch = async (url, init) => {
    if (!/anthropic/i.test(String(url))) throw new Error("network refused in this test: " + url);
    const body = JSON.parse(init.body);
    const text = String(body.messages?.[0]?.content || "");
    asked.push(text);
    const id = /Section id: ([^;\n]+);/.exec(text)?.[1];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ headline: `Rewritten ${id}`, sub: "Lenders decide." }) }],
        usage: { input_tokens: 11, output_tokens: 7 },
        model: "claude-test",
      }),
    };
  };
});
after(() => {
  for (const k of MODEL_KEYS) {
    if (savedKeys[k] === undefined) delete process.env[k]; else process.env[k] = savedKeys[k];
  }
  globalThis.fetch = realFetch;
});

const rules = [
  staffSession(),
  [/SELECT \* FROM partner_pages WHERE id = \$1/, [{
    id: PAGE, org_id: ORG_ID, partner_id: PARTNER, title: "Fund your business", funnel_key: "partner-board",
    body_json: { template: "apply", sections: SECTIONS },
  }]],
  [/SELECT \* FROM partner_brand WHERE partner_id = \$1/, [{ partner_id: PARTNER, entity_name: "Acme Capital", voice: "plain" }]],
  [/FROM partner_module_settings/, [{ marketing_suite_enabled: true, ai_token_cap_monthly: 100000, org_id: ORG_ID }]],
  [/FROM partner_ai_usage/, [{ used: 0 }]],
  [/INSERT INTO partner_ai_usage/, [{ id: "u1", input_tokens: 11, output_tokens: 7 }]],
  [/FROM compliance_rules/, []],
];

async function call(body) {
  asked.length = 0;
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

const savedBody = (fake) => {
  const upd = fake.find(/UPDATE partner_pages/i)[0];
  return upd ? JSON.parse(upd.params[1]) : null;
};

describe("POST /api/partner-marketing/generate-copy, whole page", () => {
  test("every unlocked block is rewritten and every locked legal block is saved exactly as it was", async () => {
    const { res, fake } = await call({ page_id: PAGE });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    // The answer lists only the blocks it wrote.
    assert.deepEqual(res.body.results.map((r) => r.section_id).sort(), ["faq", "hero"]);
    // The saved page: unlocked blocks carry the new words, locked blocks are untouched.
    const saved = savedBody(fake);
    assert.ok(saved, "the page was not saved");
    for (const id of ["hero", "faq"]) {
      assert.equal(saved.sections.find((s) => s.id === id).headline, `Rewritten ${id}`);
    }
    for (const s of SECTIONS.filter((x) => x.locked)) {
      assert.deepEqual(saved.sections.find((x) => x.id === s.id), s);
    }
    // The same is what the person is told came back.
    for (const s of SECTIONS.filter((x) => x.locked)) {
      assert.deepEqual(res.body.body.sections.find((x) => x.id === s.id), s);
    }
  });

  test("the model is never shown a locked block, and no history row is made for one", async () => {
    const { fake } = await call({ page_id: PAGE });
    assert.equal(asked.length, 2);
    for (const q of asked) {
      assert.doesNotMatch(q, /Section id: legal-/);
      assert.doesNotMatch(q, /We are not a lender|Reply STOP to opt out/);
    }
    const history = fake.find(/INSERT INTO partner_page_section_versions/i).map((c) => c.params[3]).sort();
    assert.deepEqual(history, ["faq", "hero"]);
  });

  test("an empty section_id means the whole page; a blank string is not a block called nothing", async () => {
    const blank = await call({ page_id: PAGE, section_id: "   " });
    assert.equal(blank.res.statusCode, 200, JSON.stringify(blank.res.body));
    assert.equal(blank.res.body.results.length, 2);
    const none = await call({ page_id: PAGE, section_id: null });
    assert.equal(none.res.statusCode, 200);
    assert.equal(none.res.body.results.length, 2);
  });

  test("a block chosen by id writes only that block, and a locked id is still refused", async () => {
    const one = await call({ page_id: PAGE, section_id: "faq" });
    assert.equal(one.res.statusCode, 200);
    assert.deepEqual(one.res.body.results.map((r) => r.section_id), ["faq"]);
    assert.equal(asked.length, 1);
    const locked = await call({ page_id: PAGE, section_id: "legal-sms" });
    assert.equal(locked.res.statusCode, 400);
    assert.equal(locked.res.body.error, "locked_section");
    assert.equal(savedBody(locked.fake), null);
  });
});
