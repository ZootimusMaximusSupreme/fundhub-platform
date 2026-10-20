import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPartialLaneOnlyNotChecked, isRunnerOnlyNotChecked, unknownRequestedLanes } from "./prove-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function workflowJob(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `missing required workflow job ${name}`);
  let end = start + 1;
  while (end < lines.length && !/^  [a-zA-Z0-9_-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

test("outreach keeps its real PostgreSQL and browser gates while both bundle proofs match the canonical release runner", () => {
  const root = path.resolve(HERE, "../..");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/bank-outreach-proof.yml"), "utf8");
  const ship = workflowJob(fs.readFileSync(path.join(root, ".github/workflows/ship.yml"), "utf8"), "ship");
  const core = workflowJob(workflow, "outreach");
  const hourly = workflowJob(workflow, "hourly-release-runner");
  const canonicalRunner = ship.match(/^    runs-on: (.+)$/m)?.[1];
  assert.equal(canonicalRunner, "macos-latest");
  assert.match(hourly, new RegExp(`^    runs-on: ${canonicalRunner}$`, "m"));
  assert.match(ship, /NODE_OPTIONS: ["']?--dns-result-order=ipv4first/);
  assert.match(hourly, /NODE_OPTIONS: --dns-result-order=ipv4first/);
  assert.match(core, /runs-on: ubuntu-latest/);
  for (const command of ["node db/migrate.mjs", "VERIFY_STRICT: \"1\"", "npm run verify:e2e",
    "e2e/bank-outreach.spec.mjs e2e/sidebar-roles.spec.mjs"]) {
    assert.ok(core.includes(command), `existing gate disappeared: ${command}`);
  }
  assert.equal((workflow.match(/run: npm run pulse:prove -- --beats\s*$/gm) || []).length, 1);
  assert.match(hourly, /run: npm run pulse:prove -- --beats\s*$/m);
  assert.equal((workflow.match(/run: npm run pulse:prove -- --lanes=gap-bank-outreach\s*$/gm) || []).length, 1);
  assert.doesNotMatch(core, /run: npm run pulse:prove/, "network-dependent bundle proofs belong on the canonical release runner");
  for (const id of ["hourly", "morning"]) {
    const start = hourly.indexOf(`        id: ${id}\n`);
    assert.ok(start >= 0, `missing required ${id} bundle proof`);
    const end = hourly.indexOf("      - name:", start);
    const step = hourly.slice(start, end < 0 ? undefined : end);
    assert.match(step, /if: always\(\) && !cancelled\(\) && steps\.migrate\.outcome == 'success'/);
    assert.match(step, /DATABASE_URL: \$\{\{ env\.APP_DATABASE_URL \}\}/);
    assert.match(step, id === "hourly" ? /run: npm run pulse:prove -- --beats\s*$/m
      : /run: npm run pulse:prove -- --lanes=gap-bank-outreach\s*$/m);
  }
  assert.match(hourly, /DATABASE_URL: \$\{\{ env\.APP_DATABASE_URL \}\}/);
  assert.match(hourly, /if: always\(\) && !cancelled\(\) && steps\.migrate\.outcome == 'success'/);
  assert.doesNotMatch(workflow, /continue-on-error|--fixture|--slow-apply-links|--read-delay/);
});

test("outreach release proof uses its own disposable database, all migrations and no production credential", () => {
  const workflow = fs.readFileSync(path.resolve(HERE, "../../.github/workflows/bank-outreach-proof.yml"), "utf8");
  const hourly = workflowJob(workflow, "hourly-release-runner");
  assert.match(hourly, /postgres:\/\/fundhub_app:ci_not_a_secret@127\.0\.0\.1:55432\/fundhub_outreach_ci/);
  assert.match(hourly, /initdb .*--username=postgres -D "\$RUNNER_TEMP\/outreach-pg"/);
  assert.match(hourly, /brew install postgresql@17 pgvector/);
  assert.match(hourly, /node db\/migrate\.mjs/);
  assert.match(hourly, /npm run migrations:manifest/);
  assert.match(hourly, /git diff --exit-code -- db\/expected-migrations\.mjs/);
  assert.match(hourly, /ALTER ROLE fundhub_app LOGIN/);
  assert.match(hourly, /pg_ctl -D "\$RUNNER_TEMP\/outreach-pg" -m fast -w stop/);
  assert.doesNotMatch(hourly, /secrets\.|ship-env-from-netlify|npm run ship|netlify deploy|supabase db/);
});

test("masked laptop values stay named and do not block bundle proof", () => {
  assert.equal(isRunnerOnlyNotChecked({ id: "keys:any", why: "the laptop copy is a row of asterisks" }), true);
});

test("GitHub may omit live-only Twilio and Resend values", () => {
  const row = { id: "keys:vendor-key-read", why: "Twilio was not asked: TWILIO_SEND_ACCOUNT_SID is not set here." };
  assert.equal(isRunnerOnlyNotChecked(row, { ci: true }), true);
  assert.equal(isRunnerOnlyNotChecked(row, { ci: false }), false);
});

test("the CI exception is closed to other rows and real refusals", () => {
  assert.equal(isRunnerOnlyNotChecked({ id: "ads-meta:matches", why: "AD_TOKEN_ENC_KEY is not set here" }, { ci: true }), false);
  assert.equal(isRunnerOnlyNotChecked({ id: "keys:vendor-key-read", why: "Twilio refused the saved key" }, { ci: true }), false);
});

test("a targeted lane proof ignores only claims whose other lane was not selected", () => {
  const row = { id: "10-contracts:contracts/sign", why: "Claims covered by contracts:sign-route, but contracts:sign-route did not run today." };
  assert.equal(isPartialLaneOnlyNotChecked(row, { partial: true }), true);
  assert.equal(isPartialLaneOnlyNotChecked(row, { partial: false }), false);
  assert.equal(isPartialLaneOnlyNotChecked({ why: "The selected lane failed." }, { partial: true }), false);
});

test("unknown requested lanes are returned once and known lanes are kept", () => {
  assert.deepEqual(
    unknownRequestedLanes(["gap-sms", "missing", "missing"], ["gap-sms", "gap-email"]),
    ["missing"]
  );
});

test("prove rejects an unknown requested lane before starting proof work", () => {
  const result = spawnSync(process.execPath, [path.join(HERE, "prove.mjs"), "--repo", "--lanes=not-a-real-lane"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pulse:prove: unknown requested lane: not-a-real-lane/);
  assert.doesNotMatch(result.stdout, /building the api bundle|Pulse proof/);
});

test("live red and not-checked findings stay visible without becoming proof-engine failures", () => {
  const source = fs.readFileSync(path.join(HERE, "prove.mjs"), "utf8");
  assert.match(source, /redRows\.slice\(0, MAX_PRINTED_FINDINGS\)/);
  const problems = source.slice(source.indexOf("const problems = ["), source.indexOf("if (problems.length)"));
  assert.doesNotMatch(problems, /notChecked\.map/);
});

test("the hourly read delay wraps every database query round trip", () => {
  const source = fs.readFileSync(path.join(HERE, "prove.mjs"), "utf8");
  const hourly = source.slice(source.indexOf("async function proveBeats()"));
  const rawQueries = [...hourly.matchAll(/\b\w+\.query\(/g)].map((match) => match[0]);

  assert.deepEqual(rawQueries, ["client.query("], "only queryRoundTrip may call a database client's query method directly");
  assert.match(hourly, /const queryRoundTrip = async \(client, \.\.\.queryArgs\) => \{\s*if \(READ_DELAY_MS\) await wait\(READ_DELAY_MS\);\s*return client\.query\(\.\.\.queryArgs\);\s*\}/);
  assert.match(hourly, /Math\.min\(READ_BOX_COUNT, judgedBeats\.length\)/);
});

test("the slow apply-links capacity fixture keeps the full list and delayed runs keep honest timing rules", () => {
  const source = fs.readFileSync(path.join(HERE, "prove.mjs"), "utf8");
  const hourly = source.slice(source.indexOf("async function proveBeats()"));

  assert.match(hourly, /proofBeats = loadedBeats\.map\(\(beat\) => beat\.id === "apply-links" \? slowApplyBeat : beat\)/);
  assert.match(hourly, /await ctx\.step\(slowStep, \(\) => wait\(SLOW_APPLY_LINKS_MS\)\)/);
  assert.match(hourly, /for \(const step of skippedSteps\) ctx\.skipStep\(step,/);
  assert.match(hourly, /SLOW_APPLY_LINKS_MS && r\.beatId === "apply-links"/);
  assert.match(hourly, /const DELAYED_DEADLINE_MODE = READ_DELAY_MS > 0 && !FIXTURE/);
  assert.match(hourly, /const timingLimitMs = DELAYED_DEADLINE_MODE \? deadlineMs : deadlineMs \/ 2/);
  assert.match(hourly, /reached its unchanged \$\{deadlineMs\} ms deadline in artificial-delay mode/);
  assert.doesNotMatch(hourly, /r\.beatId === ["']money-funding["']/);
  assert.match(hourly, /out\.ran !== loadedBeats\.length/);
});

test("hourly site timing trace keeps native GETs and the failed verdict intact", () => {
  const source = fs.readFileSync(path.join(HERE, "prove.mjs"), "utf8");
  const hourly = source.slice(source.indexOf("async function proveBeats()"));

  assert.match(hourly, /const response = await realFetch\(url, init\)/, "the proof must preserve fetch options, including the abort signal");
  assert.match(hourly, /target\.host === "fundhub\.ai" && tracedSitePaths\.has\(target\.pathname\)/);
  assert.match(hourly, /siteFetchTrace\.push\(\{ path: target\.pathname, status: response\.status, ms:/);
  assert.match(hourly, /code: String\(err\?\.cause\?\.code \|\| ""\)\.replace\(\/\[\^a-z0-9_\]\/gi, ""\)/);
  assert.match(hourly, /aborted: init\?\.signal\?\.aborted === true/);
  assert.match(hourly, /if \(problems\.length\) \{\s*for \(const trace of siteFetchTrace\)/);
  assert.match(hourly, /const timingLimitMs = DELAYED_DEADLINE_MODE \? deadlineMs : deadlineMs \/ 2/);
  assert.doesNotMatch(hourly, /siteFetchTrace\.push\([^\n]*(?:search|href|body)/, "trace must not print query strings or response bodies");
});

test("prove rejects an unsafe slow apply-links duration before starting proof work", () => {
  const result = spawnSync(process.execPath, [path.join(HERE, "prove.mjs"), "--beats", "--slow-apply-links=11001"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pulse:prove: --slow-apply-links must be a whole number from 0 to 11000 ms/);
  assert.doesNotMatch(result.stdout, /building the pulse-hourly bundle|cold load:/);
});

