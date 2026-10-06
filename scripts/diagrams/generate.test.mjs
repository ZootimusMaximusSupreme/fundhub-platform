import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { build, stale, OUT_DIR } from "./generate.mjs";
import { extractPipelines, extractCanonicalGroups, extractAdapters, extractAll } from "./extract.mjs";
import { renderRail, renderAgentTriggers, BANNER } from "./render.mjs";

// --- the anti-drift guarantee ----------------------------------------------
// This is the test that gives the diagrams their value. Rename an event, add a
// workflow, add a pipeline stage, change an adapter's signature scheme — and this
// fails until `npm run diagrams` is run and the result committed.
test("docs/diagrams is in sync with the code", async () => {
  const bad = await stale();
  assert.deepEqual(
    bad, [],
    `docs/diagrams is stale:\n${bad.map((b) => `  ${b.reason} — ${b.rel}`).join("\n")}\n\nRun \`npm run diagrams\` and commit the result.`
  );
});

test("every generated file carries the do-not-edit banner", async () => {
  const files = await build();
  for (const [rel, contents] of Object.entries(files)) {
    assert.ok(contents.startsWith(BANNER), `${rel} must open with the generated banner`);
  }
});

test("generation is deterministic — two runs produce identical bytes", async () => {
  const a = await build();
  const b = await build();
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], `${k} is not deterministic`);
});

test("one file per rail, plus the four top-level diagrams", async () => {
  const files = await build();
  const { pipelines } = await extractAll();
  assert.equal(pipelines.length, 6, "the seed defines 6 rails (hiring + affiliates_white_label come from later migrations)");
  for (const p of pipelines) {
    assert.ok(files[`rails/${p.key}.md`], `missing a state machine for rail ${p.key}`);
  }
  for (const f of ["README.md", "event-flow.md", "adapter-boundary.md", "agent-triggers.md", "rails/README.md"]) {
    assert.ok(files[f], `missing ${f}`);
  }
  assert.equal(Object.keys(files).length, 6 + 5);
});

test("mermaid fences are balanced and non-empty in every file", async () => {
  const files = await build();
  let blocks = 0;
  for (const [rel, contents] of Object.entries(files)) {
    const opens = (contents.match(/^```mermaid$/gm) || []).length;
    const fences = (contents.match(/^```/gm) || []).length;
    assert.equal(fences % 2, 0, `${rel} has an unclosed code fence`);
    for (const m of contents.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      blocks++;
      assert.ok(m[1].trim().length > 0, `${rel} has an empty mermaid block`);
      assert.match(m[1].trim(), /^(flowchart|stateDiagram-v2)/, `${rel} block must declare a diagram type`);
    }
    assert.equal(opens, [...contents.matchAll(/```mermaid\n/g)].length, `${rel} fence mismatch`);
  }
  assert.ok(blocks >= 10, `expected at least 11 diagrams, got ${blocks}`);
});

// --- extraction -------------------------------------------------------------

test("pipelines come from the seed, with stages in sort_order", () => {
  const pipelines = extractPipelines();
  const sales = pipelines.find((p) => p.key === "sales");
  assert.ok(sales, "sales rail must be extracted");
  assert.equal(sales.name, "Sales");
  assert.deepEqual(sales.stages.map((s) => s.sort), [...sales.stages.map((_, i) => i)], "stages are ordered");
  assert.equal(sales.stages[0].key, "new_lead");
  assert.equal(sales.stages.at(-1).key, "lost");
});

test("pipeline extraction is driven by the SQL, not by a hard-coded list", () => {
  const sql = `
INSERT INTO pipelines (org_id, key, name)
SELECT org.id, k, n FROM org, (VALUES
  ('only_one', 'Only One')
) AS v(k, n)
ON CONFLICT DO NOTHING;

-- Stages per pipeline (sort_order = display order).
INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
JOIN (VALUES
  ('only_one','second','Second',1),('only_one','first','First',0)
) AS s(pkey, key, name, ord)
ON CONFLICT DO NOTHING;`;
  const [p] = extractPipelines(sql);
  assert.equal(p.key, "only_one");
  assert.deepEqual(p.stages.map((s) => s.key), ["first", "second"], "re-sorted into sort_order");
});

test("canonical events are grouped by the section comments inside the array", () => {
  const groups = extractCanonicalGroups();
  const titles = groups.map((g) => g.title);
  assert.ok(titles.includes("journey spine"), `expected a journey spine group, got ${titles.join(", ")}`);
  // The file-header comments sit at column 0 and must not become groups.
  assert.ok(!titles.some((t) => /Canonical event names/i.test(t)), "file header must not be read as a group");
  // The parenthetical aside on the billing group is trimmed off its title.
  assert.ok(!titles.some((t) => t.includes("(")), `group titles keep a parenthetical: ${titles.join(", ")}`);
});

test("every canonical event lands in exactly one group", async () => {
  const { canonicalEvents, canonicalGroups } = await extractAll();
  const grouped = canonicalGroups.flatMap((g) => g.events);
  assert.deepEqual([...grouped].sort(), [...canonicalEvents].sort(), "no event dropped or duplicated");
});

test("adapters report their auth scheme and emitted events", async () => {
  const { canonicalEvents } = await extractAll();
  const adapters = extractAdapters(canonicalEvents);
  // 12: eight webhook/direct + oxylabs + hubstaff + inquiry-removal (IRA bridge)
  // + resend-events (2026-08-18, T5-16 — delivery/bounce/complaint receipts for
  // the live email provider, which had no webhook door at all).
  //
  // Was 13 until 4fb2a3d5 removed the Cal.com adapter and its webhook door —
  // correctly, because bookings come from ClickFunnels and no Cal.com booking
  // has ever existed. The count here was not updated with it, so this test has
  // been red ever since: the code was right and the number describing it was
  // stale. Kept as a hard count on purpose — it is what catches an adapter
  // being added or dropped without anyone saying so — but if you change the
  // set, change this line in the same commit.
  //
  // 13 since 2026-09-29: src/adapters/clarity-export.mjs (d62c2820b), the one
  // door owner law allows for Microsoft Clarity Data Export pulls
  // (.claude/rules/clarity-export-rate-limit.md). It went in without this
  // line moving, so the count was one short from then until 2026-10-05.
  assert.equal(adapters.length, 13, "13 adapters in src/adapters");

  const twilio = adapters.find((a) => a.name === "twilio");
  assert.equal(twilio.scheme, "HMAC-SHA1", "Twilio signs with SHA1, unlike the rest");
  assert.deepEqual(twilio.events, ["message.inbound"]);

  const crs = adapters.find((a) => a.name === "crs");
  assert.equal(crs.inbound, false, "CRS is a direct call, not a signed webhook");
  assert.equal(crs.verifiers.length, 0);

  const ira = adapters.find((a) => a.name === "inquiry-removal");
  assert.ok(ira, "inquiry-removal adapter must be extracted");
  assert.equal(ira.inbound, true);
  assert.ok(ira.verifiers.length > 0, "inquiry-removal verifies a signature");
  assert.ok(ira.events.includes("inquiry.removed"));

  for (const a of adapters) {
    assert.ok(a.events.every((e) => canonicalEvents.includes(e)), `${a.name} emits a non-canonical event`);
  }
});

test("workflow triggers are read off the real Inngest functions", async () => {
  const { workflows, canonicalEvents } = await extractAll();
  assert.ok(workflows.length >= 40, `expected the full port, got ${workflows.length}`);
  for (const w of workflows) {
    assert.ok(w.id, "every function has an id");
    for (const e of w.events) {
      assert.ok(canonicalEvents.includes(e), `${w.id} triggers on non-canonical "${e}"`);
    }
  }
  const multi = workflows.find((w) => w.events.length > 1);
  assert.ok(multi, "at least one function has multiple triggers (AF-02)");
});

// --- rendering --------------------------------------------------------------

test("a rail with no code-driven moves says so instead of implying it is driven", () => {
  const rail = { key: "funding_altfin", name: "Funding: Alt-Fin", stages: [{ key: "app_created", name: "App Created", sort: 0 }] };
  const md = renderRail(rail, []);
  assert.match(md, /Nothing in this repo moves a card on this rail/);
  assert.match(md, /Lendflow webhooks/);
});

test("a rail's notes name the workflow that moves the card", () => {
  const rail = { key: "sales", name: "Sales", stages: [{ key: "booked", name: "Booked", sort: 0 }] };
  const md = renderRail(rail, [{ workflow: "s-04-call-booked", pipeline: "sales", stage: "booked" }]);
  assert.match(md, /note right of booked : moved by s-04-call-booked/);
  assert.doesNotMatch(md, /Nothing in this repo moves a card/);
});

test("rails state the arrows are display order, not a transition table", () => {
  const rail = { key: "sales", name: "Sales", stages: [{ key: "a", name: "A", sort: 0 }, { key: "b", name: "B", sort: 1 }] };
  const md = renderRail(rail, []);
  assert.match(md, /not as permitted transitions/);
  assert.match(md, /does not invent one/);
});

test("state labels are quoted, so stage names with spaces and parens stay valid", () => {
  const rail = { key: "sales", name: "Sales", stages: [{ key: "closed_won", name: "Closed Won (deposit)", sort: 0 }] };
  const md = renderRail(rail, []);
  assert.match(md, /state "Closed Won \(deposit\)" as closed_won/);
});

test("the agent trigger map lists canonical events that nothing listens to", () => {
  const md = renderAgentTriggers({
    workflows: [{ id: "w-1", name: "W1", events: ["entry.captured"], crons: [] }],
    canonicalGroups: [{ title: "journey spine", events: ["entry.captured", "file.finalized"] }]
  });
  assert.match(md, /Canonical events that trigger nothing/);
  assert.match(md, /`file\.finalized`/);
});

test("the agent trigger map is explicit that AG-xx wireframe agents are not code", () => {
  const md = renderAgentTriggers({
    workflows: [{ id: "w-1", name: "W1", events: ["entry.captured"], crons: [] }],
    canonicalGroups: [{ title: "journey spine", events: ["entry.captured"] }]
  });
  assert.match(md, /agent-editor\.html/);
  assert.match(md, /no code behind/);
});

test("the adapter boundary flags adapters never proven against a real payload", async () => {
  const files = await build();
  const md = files["adapter-boundary.md"];
  const { adapters } = await extractAll();
  const unverified = adapters.filter((a) => a.unverified);
  assert.ok(unverified.length > 0, "several adapters still carry CONFIRM banners");
  for (const a of unverified) assert.ok(md.includes(`\`${a.name}\``), `${a.name} missing from the boundary map`);
  assert.match(md, /CONFIRM/);
});

// --- committed output -------------------------------------------------------

test("the committed docs/diagrams directory exists and holds no stray files", async () => {
  const files = await build();
  const expected = new Set(Object.keys(files));
  const found = [];
  (function walk(dir, prefix = "") {
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (fs.statSync(abs).isDirectory()) walk(abs, rel);
      else found.push(rel);
    }
  })(OUT_DIR);
  for (const f of found) assert.ok(expected.has(f), `stray file in docs/diagrams: ${f} (nothing generates it)`);
});
