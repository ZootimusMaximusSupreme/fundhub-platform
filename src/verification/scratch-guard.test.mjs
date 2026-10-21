import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHarnessSafe,
  isLocalScratchDatabaseUrl,
  LIVE_CLIENTS_ERROR,
  PRIVILEGED_ROLE_ERROR
} from "./scratch-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function fakeDb(rowsByCall) {
  let i = 0;
  return {
    query: async () => {
      const rows = rowsByCall[i++] || [];
      return { rows };
    }
  };
}

test("refuses a superuser or BYPASSRLS login before any write", async () => {
  const db = fakeDb([[{ usename: "postgres", privileged: true }]]);
  await assert.rejects(() => assertHarnessSafe(db), (err) => {
    assert.equal(err.message, PRIVILEGED_ROLE_ERROR);
    return true;
  });
});

test("refuses a database that already has live clients", async () => {
  const db = fakeDb([
    [{ usename: "fundhub_app", privileged: false }],
    [{ n: 12 }]
  ]);
  await assert.rejects(() => assertHarnessSafe(db), (err) => {
    assert.ok(err.message.startsWith(LIVE_CLIENTS_ERROR));
    assert.match(err.message, /12 live files/);
    return true;
  });
});

test("allows fundhub_app on a database with no live clients", async () => {
  const db = fakeDb([
    [{ usename: "fundhub_app", privileged: false }],
    [{ n: 0 }]
  ]);
  await assertHarnessSafe(db);
});

test("agent journey re-asserts scratch-safe before mass-retire", () => {
  const src = readFileSync(join(here, "journeys/agent.mjs"), "utf8");
  const retireIdx = src.indexOf("status = 'retired'");
  assert.ok(retireIdx > 0, "expected mass-retire UPDATE in agent journey");
  const guardIdx = src.lastIndexOf("assertHarnessSafe", retireIdx);
  assert.ok(guardIdx > 0 && guardIdx < retireIdx,
    "assertHarnessSafe must run before mass-retire");
});

test("fixtures re-asserts scratch-safe before outbound pause", () => {
  const src = readFileSync(join(here, "fixtures.mjs"), "utf8");
  const pauseIdx = src.indexOf("outbound_enabled = false");
  assert.ok(pauseIdx > 0, "expected outbound pause in fixtures");
  const guardIdx = src.lastIndexOf("assertHarnessSafe", pauseIdx);
  assert.ok(guardIdx > 0 && guardIdx < pauseIdx,
    "assertHarnessSafe must run before outbound pause");
});

test("isLocalScratchDatabaseUrl: only a loopback host with a disposable database name", () => {
  // PASS: what CI and a laptop scratch run use.
  assert.equal(isLocalScratchDatabaseUrl("postgres://postgres:postgres@127.0.0.1:5432/fundhub_ci"), true);
  assert.equal(isLocalScratchDatabaseUrl("postgresql://u:p@localhost/fundhub_test"), true);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u@[::1]:5433/scratch"), true);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u@localhost/fundhub-scratch-2"), true);
  // FAIL: anything hosted, unnamed, or a name that only contains the letters.
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres"), false);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@db.example.supabase.co:5432/fundhub_ci"), false);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@127.0.0.1:5432/postgres"), false);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@localhost/fundhub"), false);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@localhost/financial"), false);
  assert.equal(isLocalScratchDatabaseUrl("postgres://u:p@localhost/latest"), false);
  assert.equal(isLocalScratchDatabaseUrl("mysql://u@localhost/fundhub_test"), false);
  assert.equal(isLocalScratchDatabaseUrl(""), false);
  assert.equal(isLocalScratchDatabaseUrl(undefined), false);
  assert.equal(isLocalScratchDatabaseUrl("not a url"), false);
});

// The two PG tests that deleted live Fundhub templates (2026-10-20). They stay
// scratch-only, and the seeder test never clears the Fundhub company's rows again.
test("the template-deleting PG tests are scratch-only", () => {
  const seed = readFileSync(join(here, "../messaging/seed/seed.pg.test.mjs"), "utf8");
  assert.match(seed, /const RUN = isLocalScratchDatabaseUrl\(process\.env\.DATABASE_URL\) && !!docsDir;/);
  assert.doesNotMatch(seed, /slug\s*=\s*'fundhub'/, "the seeder test must not target the Fundhub org");
  assert.doesNotMatch(seed, /DELETE FROM message_templates WHERE org_id IN/);
  assert.match(seed, /DELETE FROM message_templates WHERE org_id = \$1`, \[orgId\]/);
  assert.match(seed, /seedTemplates\(db, seedable, \{ orgSlug: ORG_SLUG \}\)/);

  const cutover = readFileSync(join(here, "../messaging/cutover-acceptance.pg.test.mjs"), "utf8");
  assert.match(cutover, /const RUN = isLocalScratchDatabaseUrl\(process\.env\.DATABASE_URL\);/);
  assert.doesNotMatch(cutover, /const RUN = !!process\.env\.DATABASE_URL/);
});
