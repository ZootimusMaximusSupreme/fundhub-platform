// The S4 row tracker is what turns "this test ran" into "this row is proved", so
// it is tested on its own: an empty callback claims nothing, a callback that fails
// claims nothing, and a listed row that was never run fails the file.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows } from "./s4-proof-rows.mjs";

const HELPER = "s4-money-helper.test.mjs";
const SUGGESTIONS = /^Suggestion buttons x3/;
const THREAD = /^Thread: each message/;
const MESSAGE_BOX = /^Message box \+ Send/;

test("an empty callback is refused and claims nothing", async () => {
  const proof = proofRows(HELPER);
  await assert.rejects(proof.check(SUGGESTIONS, async () => {}), /not an empty one/);
  await assert.rejects(proof.check(SUGGESTIONS, () => {}), /not an empty one/);
  assert.throws(() => proof.assertAllClaimed(), /Suggestion buttons x3/);
});

test("a callback that holds only comments is refused too", async () => {
  const proof = proofRows(HELPER);
  await assert.rejects(proof.check(SUGGESTIONS, async () => { /* the buttons are checked elsewhere */ }), /not an empty one/);
  await assert.rejects(proof.check(SUGGESTIONS, async (row) => {
    // TODO prove it
    /* later */
  }), /not an empty one/);
  await assert.rejects(proof.check(SUGGESTIONS, async function () {}), /not an empty one/);
  assert.throws(() => proof.assertAllClaimed(), /Suggestion buttons x3/);
});

test("a callback that fails leaves its row unclaimed", async () => {
  const proof = proofRows(HELPER);
  await assert.rejects(proof.check(SUGGESTIONS, async () => { assert.equal(1, 2); }));
  assert.throws(() => proof.assertAllClaimed(), /Suggestion buttons x3/);
});

test("a row is claimed only after its own callback passes, and every listed row must be claimed", async () => {
  const proof = proofRows(HELPER);
  for (const matcher of [SUGGESTIONS, THREAD]) await proof.check(matcher, async () => { assert.ok(true); });
  assert.throws(() => proof.assertAllClaimed(), (error) => /Message box \+ Send/.test(error.message) && !/Suggestion buttons/.test(error.message));
  await proof.check(MESSAGE_BOX, async () => { assert.ok(true); });
  assert.doesNotThrow(() => proof.assertAllClaimed());
});

test("a matcher that names no row, or two rows, is an error", async () => {
  const proof = proofRows(HELPER);
  await assert.rejects(proof.check(/^no such control/, async () => { assert.ok(true); }), /found 0/);
  await assert.rejects(proof.check(/./, async () => { assert.ok(true); }), /found 3/);
});
