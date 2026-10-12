import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

