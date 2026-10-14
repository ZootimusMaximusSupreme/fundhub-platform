import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPartialLaneOnlyNotChecked, isRunnerOnlyNotChecked, unknownRequestedLanes } from "./prove-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

test("prove rejects an unsafe slow apply-links duration before starting proof work", () => {
  const result = spawnSync(process.execPath, [path.join(HERE, "prove.mjs"), "--beats", "--slow-apply-links=11001"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pulse:prove: --slow-apply-links must be a whole number from 0 to 11000 ms/);
  assert.doesNotMatch(result.stdout, /building the pulse-hourly bundle|cold load:/);
});

