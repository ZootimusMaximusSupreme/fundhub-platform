// Finish-the-853, batch 01: Brand Studio "Write page copy" with no block chosen (the whole page).
//
// The button is labelled "all unlocked blocks". Whole-page is the case where a page holds legal
// blocks that must never be rewritten, and the one case the older tests in copy-generate.test.mjs
// and src/http/partner-marketing-generate-copy-handler.test.mjs do not run (they write one chosen
// block, or ask for a locked block by id). The real writing code runs; the database is a stand-in
// and the model answer is a made-up reply that never leaves this process.
import assert from "node:assert/strict";
import test from "node:test";

import { defaultBody, isLockedSection } from "./templates.mjs";
import { generateSectionCopy } from "./copy-generate.mjs";

const PID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakeDb() {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (/FROM partner_module_settings/i.test(sql)) return { rows: [{ marketing_suite_enabled: true, ai_token_cap_monthly: 250000, org_id: ORG }] };
      if (/FROM partner_ai_usage/i.test(sql)) return { rows: [{ used: 0 }] };
      if (/FROM compliance_rules/i.test(sql)) return { rows: [] };
      if (/INSERT INTO partner_ai_usage/i.test(sql)) return { rows: [{ id: "u1", input_tokens: params[4], output_tokens: params[5] }] };
      if (/INSERT INTO partner_page_section_versions/i.test(sql)) { writes.push({ kind: "history", sectionId: params[3] }); return { rows: [] }; }
      if (/UPDATE partner_pages/i.test(sql)) { writes.push({ kind: "page", body: JSON.parse(params[1]) }); return { rows: [] }; }
      throw new Error("unexpected sql: " + sql);
    },
  };
}

/* A model that answers every request with a fresh headline and keeps what it was asked about. */
function recordingModel(asked) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const text = body.messages?.[0]?.content || "";
    asked.push(String(text));
    const id = /Section id: ([^;\n]+);/.exec(String(text))?.[1];
    return {
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ headline: `Rewritten ${id}`, sub: "Lenders decide." }) }],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    };
  };
}

async function writeWholePage(body) {
  const db = fakeDb();
  const asked = [];
  const out = await generateSectionCopy({
    db, orgId: ORG, partnerId: PID,
    page: { id: PAGE, org_id: ORG, partner_id: PID, title: "Apply", funnel_key: "apply", body_json: body },
    brand: { entity_name: "Acme" },
    sectionId: null,
    env: { ANTHROPIC_API_KEY: "test-key-not-real" },
    fetchImpl: recordingModel(asked),
  });
  return { out, db, asked };
}

test("a whole-page write rewrites every unlocked block and leaves every locked legal block exactly as it was", async () => {
  const body = defaultBody("apply", { entity_name: "Acme" });
  const locked = body.sections.filter(isLockedSection);
  const unlocked = body.sections.filter((s) => !isLockedSection(s));
  assert.ok(locked.length >= 3, "the fixture must hold locked legal blocks");
  assert.ok(unlocked.length >= 2, "the fixture must hold unlocked blocks");

  const { out, db } = await writeWholePage(body);

  // It did not refuse: the whole page is a normal ask and the locked blocks are skipped, not an error.
  assert.deepEqual(out.results.map((r) => r.section_id).sort(), unlocked.map((s) => s.id).sort());
  // Every unlocked block now says the new words.
  for (const s of unlocked) {
    assert.equal(out.body.sections.find((x) => x.id === s.id).headline, `Rewritten ${s.id}`);
  }
  // Every locked block is the same object content, word for word.
  for (const s of locked) {
    assert.deepEqual(out.body.sections.find((x) => x.id === s.id), s, `${s.id} was changed`);
  }
  // The saved page carries the same locked blocks, and none of them got a history row.
  const saved = db.writes.find((w) => w.kind === "page");
  for (const s of locked) assert.deepEqual(saved.body.sections.find((x) => x.id === s.id), s);
  const history = db.writes.filter((w) => w.kind === "history").map((w) => w.sectionId);
  assert.deepEqual(history.sort(), unlocked.map((s) => s.id).sort());
  for (const s of locked) assert.ok(!history.includes(s.id), `${s.id} got a history row`);
});

test("the model is asked once for each unlocked block and never about a locked one", async () => {
  const body = defaultBody("apply", { entity_name: "Acme" });
  const locked = body.sections.filter(isLockedSection);
  const unlocked = body.sections.filter((s) => !isLockedSection(s));
  const { asked } = await writeWholePage(body);
  assert.equal(asked.length, unlocked.length);
  for (const s of unlocked) assert.ok(asked.some((q) => q.includes(`Section id: ${s.id};`)), `${s.id} was not asked`);
  for (const s of locked) {
    assert.ok(!asked.some((q) => q.includes(`Section id: ${s.id};`)), `${s.id} was sent to the model`);
    assert.ok(!asked.some((q) => q.includes(s.text)), `the words of ${s.id} were sent to the model`);
  }
});

test("a locked block marked locked in the page is skipped even when it sits between unlocked ones", async () => {
  const body = {
    template: "apply",
    sections: [
      { id: "hero", type: "hero", headline: "Hero", sub: "x" },
      { id: "legal-x", type: "legal", locked: true, headline: "Stay", text: "Do not touch me." },
      { id: "faq", type: "faq", headline: "Questions", sub: "y" },
    ],
  };
  const { out, asked } = await writeWholePage(body);
  assert.deepEqual(out.results.map((r) => r.section_id), ["hero", "faq"]);
  assert.equal(out.body.sections[1].headline, "Stay");
  assert.equal(out.body.sections[1].text, "Do not touch me.");
  assert.equal(asked.length, 2);
});
