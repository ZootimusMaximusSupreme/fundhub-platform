import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skill = name => readFileSync(path.join(root, ".agents/skills", name, "SKILL.md"), "utf8");

test("system map points to a retrievable, explicitly historical revision", () => {
  const instructions = skill("fundhub-system-map");
  const reference = instructions.match(/git show ([0-9a-f]{40}:ops\/workflows\/system-map-2026-08-26\.md)/);
  assert.ok(reference, "historical map revision is missing");
  assert.match(instructions, /snapshot/);
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim();
  if (shallow === "true") {
    assert.match(instructions, /shallow clone/);
    assert.match(instructions, /mark the historical reference unavailable/);
  } else {
    const map = execFileSync("git", ["show", reference[1]], { cwd: root, encoding: "utf8" });
    assert.match(map, /FundHub system map/);
  }
});

test("agent proof requires the actual model and observed actions", () => {
  const instructions = skill("fundhub-agent-tester");
  assert.match(instructions, /actual provider, model and runtime path/);
  assert.match(instructions, /action order UNVERIFIED/);
  assert.match(instructions, /prompt hash/);
  assert.match(instructions, /source-owned assistants/);
  assert.doesNotMatch(instructions, /Same model path the product uses \(`src\/agents\/model.mjs` `callModel`\)/);
});

test("audit and version-control boards respect the no-new-Markdown rule", () => {
  for (const name of ["fundhub-agent-tester", "fundhub-auditor", "fundhub-perf-auditor", "fundhub-version-control"]) {
    const instructions = skill(name);
    assert.match(instructions, /\.txt/);
    assert.match(instructions, /Markdown.*explicit|explicit.*Markdown/i);
  }
});

test("the orchestrator reassesses instead of abandoning authorized work after three loops", () => {
  const instructions = skill("fundhub-orchestrator");
  assert.doesNotMatch(instructions, /Three loops max/);
  assert.match(instructions, /Continue safe, authorized work/);
});

test("instruction-only repairs have scoped proof and shipping follows the queue", () => {
  assert.match(skill("fundhub-fixer"), /instruction-only repair/);
  assert.match(skill("fundhub-fixer"), /independently check the affected instructions/);
  assert.match(skill("fundhub-auditor"), /mark that step UNVERIFIED and continue independent checks/);
  assert.match(skill("fundhub-version-control"), /npm run preflight/);
  assert.match(skill("fundhub-version-control"), /npm run ship-change/);
});
