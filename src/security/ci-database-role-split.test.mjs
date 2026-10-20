import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const WORKFLOW = new URL("../../.github/workflows/tests.yml", import.meta.url);
const RLS_POOL = new URL("../testing/rls-pool.mjs", import.meta.url);
const FIXTURE_SUITES = [
  "../compliance/invariants.pg.test.mjs",
  "../creative/generate.pg.test.mjs",
  "../http/creative-endpoints.pg.test.mjs",
  "../social/social.pg.test.mjs",
];

function workflowStep(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = source.indexOf("\n      - name:", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

test("Postgres isolation suites use the owner for fixtures and the app role for assertions", () => {
  const workflow = fs.readFileSync(WORKFLOW, "utf8");
  const step = workflowStep(workflow, "Partner isolation, owner fixtures and unprivileged assertions");
  assert.match(step, /DATABASE_URL: \$\{\{ env\.MIGRATION_DATABASE_URL \}\}/);
  assert.doesNotMatch(step, /DATABASE_URL: \$\{\{ env\.APP_DATABASE_URL \}\}/);
  assert.match(workflow, /APP_DATABASE_URL: postgres:\/\/fundhub_app:/);

  const rlsPool = fs.readFileSync(RLS_POOL, "utf8");
  assert.match(rlsPool, /process\.env\.APP_DATABASE_URL/);
  for (const relative of FIXTURE_SUITES) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /from ["']\.\.\/testing\/rls-pool\.mjs["']|from ["']\.\.\/\.\.\/testing\/rls-pool\.mjs["']/,
      `${relative} must keep assertions on APP_DATABASE_URL through rls-pool`);
    assert.match(step, new RegExp(relative.replace(/^\.\.\//, "src/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
