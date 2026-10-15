// finish-853 batch 08: POST /api/partner-marketing/generate-copy. The real handler, the real copy
// writer, the real token meter, the real compliance screen and the real section history run over
// stand-in tables, with a recording stand-in for the one model call (a fake key set for this file,
// no network, no spend). The row's words: rewrites the unlocked sections of a white-label partner's
// page with the writing model, inside the partner's monthly token cap, and versions each section;
// locked sections refuse. Practice test, fake data, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/partner-marketing/generate-copy.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const PAGE = "9c000000-0000-4000-8000-000000000001";
const KEYS = ["OPENAI_API_KEY", "COMPANY_BRAIN_OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
const saved = {};
const realFetch = globalThis.fetch;
const modelCalls = [];
let reply = null;
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  delete process.env.COMPANY_BRAIN_OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = "test-model-key";
  globalThis.fetch = async (url, init) => {
    modelCalls.push({ url: String(url), body: JSON.parse(init.body) });
    const content = JSON.stringify(reply);
    const payload = { choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 30 } };
    return { ok: true, status: 200, headers: { get: () => null, forEach() {} }, text: async () => JSON.stringify(payload), json: async () => payload };
  };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { modelCalls.length = 0; reply = { headline: "Fund the next step of your business", sub: "Review your options with a person who reads the details." }; clearRuleCache(); });

const SECTIONS = () => [
  { id: "hero", type: "hero", headline: "Get funded", sub: "Up to $250k, if you qualify" },
  { id: "about", type: "text", text: "We help owners understand their options." },
  { id: "legal-lender", type: "legal", locked: true, headline: "Not a direct lender", text: "We are not a lender." },
];

function copyFile({ suite = true, cap = 1000, used = 0, rules = [] } = {}) {
  const tables = {
    partner_pages: [
      { id: PAGE, org_id: ORG_ID, partner_id: PARTNER, funnel_key: "apply", title: "Apply", body_json: { sections: SECTIONS() } },
      { id: "9c000000-0000-4000-8000-000000000002", org_id: ORG_ID, partner_id: OTHER_PARTNER, funnel_key: "apply", title: "Theirs", body_json: { sections: SECTIONS() } },
    ],
    partner_brand: [{ partner_id: PARTNER, org_id: ORG_ID, entity_name: "Acme Capital", voice: "plain", ink: "#101820", paper: "#ffffff", display_face: "Inter" }],
    partner_module_settings: [{ partner_id: PARTNER, org_id: ORG_ID, marketing_suite_enabled: suite, ai_token_cap_monthly: cap }],
    partner_ai_usage: used ? [{ org_id: ORG_ID, partner_id: PARTNER, input_tokens: used, output_tokens: 0, created_at: new Date().toISOString() }] : [],
    partner_page_section_versions: [],
    compliance_rules: rules,
    partners: [{ id: PARTNER, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: ORG_ID }],
  };
  const fake = tablesDb({
    tables,
    autoInsert: true,
    autoUpdate: true,
    rules: [
      [/^\s*SELECT COALESCE\(SUM\(input_tokens \+ output_tokens\), 0\)::int AS used\s+FROM partner_ai_usage/i,
        (_s, p) => [{ used: tables.partner_ai_usage.filter((u) => u.partner_id === p[0]).reduce((n, u) => n + u.input_tokens + u.output_tokens, 0) }]],
      [/^\s*SELECT \* FROM partner_pages WHERE id = \$1/i, (_s, p) => tables.partner_pages.filter((r) => r.id === p[0])],
      [/^\s*SELECT \* FROM partner_brand WHERE partner_id = \$1/i, (_s, p) => tables.partner_brand.filter((r) => r.partner_id === p[0])],
      [/FROM compliance_rules/i, () => tables.compliance_rules],
      [/^\s*(BEGIN|COMMIT|ROLLBACK)\b|set_config/i, []],
    ],
  });
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.tables = tables;
  return fake;
}

async function call(body, fake, who = [staffSession({ role: "owner" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res));
  return res;
}
const asPartner = (partnerId = PARTNER) => accountSession({ kind: "partner", partnerId, orgId: ORG_ID });

describe("POST /api/partner-marketing/generate-copy", () => {
  test("it rewrites each unlocked section, saves the old one as a version, meters the tokens, and never sends a locked block to the model", async () => {
    const fake = copyFile();
    const res = await call({ page_id: PAGE }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    const page = fake.tables.partner_pages[0];
    const hero = page.body_json.sections.find((s) => s.id === "hero");
    assert.equal(hero.headline, "Fund the next step of your business");
    assert.equal(hero.sub, "Review your options with a person who reads the details.");
    const about = page.body_json.sections.find((s) => s.id === "about");
    assert.equal(about.type, "text");
    const legal = page.body_json.sections.find((s) => s.id === "legal-lender");
    assert.deepEqual(legal, SECTIONS()[2], "the locked legal block is untouched");
    assert.equal(modelCalls.length, 2, "the two unlocked sections are written, the locked one is never sent");
    for (const call of modelCalls) assert.doesNotMatch(JSON.stringify(call.body), /We are not a lender|legal-lender/);
    assert.deepEqual(fake.tables.partner_page_section_versions.map((v) => v.section_id).sort(), ["about", "hero"]);
    const old = fake.tables.partner_page_section_versions.find((v) => v.section_id === "hero");
    const kept = typeof old.section_json === "string" ? JSON.parse(old.section_json) : old.section_json;
    assert.equal(kept.headline, "Get funded", "the version holds what was there before");
    assert.equal(old.partner_id, PARTNER);
    assert.equal(fake.tables.partner_ai_usage.filter((u) => u.purpose === "copy").length, 2);
    assert.equal(fake.tables.partner_ai_usage.at(-1).input_tokens, 120);
    assert.equal(fake.tables.partner_ai_usage.at(-1).partner_id, PARTNER);
  });

  test("a section id writes only that section, and a locked section refuses", async () => {
    const fake = copyFile();
    const one = await call({ page_id: PAGE, section_id: "about" }, fake);
    assert.equal(one.statusCode, 200);
    assert.equal(modelCalls.length, 1);
    assert.equal(fake.tables.partner_pages[0].body_json.sections.find((s) => s.id === "hero").headline, "Get funded", "the hero was not rewritten");
    const locked = await call({ page_id: PAGE, section_id: "legal-lender" }, fake);
    assert.equal(locked.statusCode, 400);
    assert.equal(locked.body.error, "locked_section");
    assert.equal(modelCalls.length, 1, "no model call for a locked block");
    const missing = await call({ page_id: PAGE, section_id: "nope" }, fake);
    assert.equal(missing.statusCode, 404);
  });

  test("copy the compliance screen blocks is not written to the page and is reported as blocked", async () => {
    reply = { headline: "Guaranteed approval for everyone", sub: "Fund now." };
    const fake = copyFile({ rules: [{ rule_set: "claims", rule_key: "no-guarantee", offer_types: [], platforms: [], match_type: "phrase", pattern: "guaranteed approval", severity: "block", message: "No guarantees.", citation: null }] });
    const res = await call({ page_id: PAGE, section_id: "hero" }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.results[0].state, "blocked");
    assert.match(JSON.stringify(res.body.results[0].reasons), /no-guarantee/);
    assert.equal(fake.tables.partner_pages[0].body_json.sections.find((s) => s.id === "hero").headline, "Get funded", "the blocked copy never reaches the page");
    assert.equal(fake.tables.partner_page_section_versions.length, 0);
  });

  test("a switched-off suite and a spent monthly cap refuse before any model call, and the page is unchanged", async () => {
    const off = copyFile({ suite: false });
    const a = await call({ page_id: PAGE }, off);
    assert.equal(a.statusCode, 403);
    assert.equal(a.body.error, "suite_off");
    const spent = copyFile({ cap: 100, used: 100 });
    const b = await call({ page_id: PAGE }, spent);
    assert.equal(b.statusCode, 429);
    assert.equal(b.body.error, "token_cap");
    assert.equal(modelCalls.length, 0);
    for (const f of [off, spent]) {
      assert.equal(f.tables.partner_pages[0].body_json.sections[0].headline, "Get funded");
      assert.equal(f.tables.partner_ai_usage.filter((u) => u.purpose === "copy").length, 0);
    }
  });

  test("a partner writes only their own page; staff need owner or admin; everyone else is refused", async () => {
    const own = await call({ page_id: PAGE }, copyFile(), asPartner(PARTNER));
    assert.equal(own.statusCode, 200);
    const theirs = copyFile();
    const refused = await call({ page_id: PAGE }, theirs, asPartner(OTHER_PARTNER));
    assert.equal(refused.statusCode, 403);
    assert.equal(theirs.tables.partner_pages[0].body_json.sections[0].headline, "Get funded");
    const letIn = [];
    modelCalls.length = 0;
    for (const role of STAFF_ROLES) {
      const f = copyFile();
      const res = await call({ page_id: PAGE }, f, [staffSession({ role })]);
      if (res.statusCode !== 403) letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
    const none = await call({ page_id: PAGE }, copyFile(), []);
    assert.equal(none.statusCode, 401);
    const bad = await call({ page_id: "nope" }, copyFile());
    assert.equal(bad.statusCode, 400);
  });

  test("a page that is not on file is 404: no model call is made, no tokens are metered and nothing is saved", async () => {
    const fake = copyFile();
    const before = JSON.stringify(fake.tables.partner_pages);
    const res = await call({ page_id: "9c000000-0000-4000-8000-000000000099" }, fake);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
    assert.equal(modelCalls.length, 0);
    assert.equal(fake.tables.partner_ai_usage.length, 0);
    assert.equal(fake.tables.partner_page_section_versions.length, 0);
    assert.equal(JSON.stringify(fake.tables.partner_pages), before);
  });

  test("with no model on the site it says so with 503 and changes nothing", async () => {
    const held = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const fake = copyFile();
      const res = await call({ page_id: PAGE, section_id: "hero" }, fake);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, "no_model");
      assert.equal(fake.tables.partner_pages[0].body_json.sections[0].headline, "Get funded");
    } finally { process.env.OPENAI_API_KEY = held; }
  });
});
