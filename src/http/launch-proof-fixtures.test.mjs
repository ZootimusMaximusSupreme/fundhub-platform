import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLIENT_EMAIL,
  CLIENT_NAME,
  FIXTURE_MARKER,
  RULE_NAME
} from "../../scripts/launch-proof-fixtures.mjs";

const ROOT = new URL("../../", import.meta.url);
const text = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("launch-proof fixtures are unmistakably fake and use the allowed e2e address", () => {
  assert.match(CLIENT_EMAIL, /^e2e\+aff-/);
  assert.match(CLIENT_NAME, /E2E.*TEST FIXTURE/);
  assert.match(RULE_NAME, /E2E.*READ ONLY.*FIXTURE/);
  assert.match(FIXTURE_MARKER, /^fundhub-launch-proof-/);
});

test("the tier fixture is inactive and cleanup is pinned to exact marked rows", () => {
  const fixture = text("scripts/launch-proof-fixtures.mjs");
  assert.match(
    fixture,
    /'front_end', 'bonus', 'closer', 'tiered', 'marginal',[\s\S]*false, \$4/
  );
  assert.match(fixture, /DELETE FROM cards WHERE id = \$1 AND client_id = \$2/);
  assert.match(
    fixture,
    /DELETE FROM commission_rules[\s\S]*id = \$1[\s\S]*name = \$2[\s\S]*notes = \$3[\s\S]*active = false/
  );
  assert.match(
    fixture,
    /DELETE FROM clients[\s\S]*id = \$1[\s\S]*lower\(email\) = \$2[\s\S]*client_master_key = \$3[\s\S]*launch_proof_fixture' = \$3/
  );
});

test("the browser proof reads fixtures and always registers cleanup", () => {
  const spec = text("e2e/launch-proof-live.spec.mjs");
  assert.match(spec, /test\.afterAll[\s\S]*cleanupLaunchProofFixtures/);
  assert.doesNotMatch(spec, /\.c-btn\.route|fhDrawerDel|data-chg|data-save/);
  assert.match(spec, /toHaveCount\(0\)/);

  const requiredLive = text("playwright.live.config.mjs");
  assert.match(requiredLive, /testMatch: \["\*\*\/live-\*\.spec\.mjs"\]/);
  assert.doesNotMatch(requiredLive, /launch-proof-live/);

  const localBrowser = text("playwright.config.mjs");
  assert.match(localBrowser, /testIgnore: \[[^\]]*"\*\*\/launch-proof-live\.spec\.mjs"/);
  // Every live-*.spec.mjs signs in to the real fundhub.ai, so the offline run
  // ignores them too (walkthrough-4 defect 9).
  assert.match(localBrowser, /testIgnore: \[[^\]]*"\*\*\/live-\*\.spec\.mjs"/);
});
