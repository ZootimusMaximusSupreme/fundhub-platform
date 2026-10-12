import assert from "node:assert/strict";
import test from "node:test";

import { isRunnerOnlyNotChecked } from "./prove-policy.mjs";

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

