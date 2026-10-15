import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmptyRehearsal } from "./simulated-pull.mjs";

test("a rehearsal pull (simulated, every score null) is an empty rehearsal", () => {
  assert.equal(isEmptyRehearsal({ source: "crs", simulated: true, scores: { ex: null, eq: null, tu: null } }), true);
});

test("a rehearsal with no scores key at all is an empty rehearsal", () => {
  assert.equal(isEmptyRehearsal({ source: "crs", simulated: true }), true);
  assert.equal(isEmptyRehearsal({ source: "crs", simulated: true, scores: {} }), true);
});

test("a rehearsal with a blank or non-number Experian score is an empty rehearsal", () => {
  assert.equal(isEmptyRehearsal({ simulated: true, scores: { ex: "" } }), true);
  assert.equal(isEmptyRehearsal({ simulated: true, scores: { ex: "n/a" } }), true);
});

test("a walkthrough file (simulated, with an Experian score) is NOT an empty rehearsal", () => {
  assert.equal(isEmptyRehearsal({ source: "crs", simulated: true, scores: { ex: 771, eq: 778, tu: 766 } }), false);
  assert.equal(isEmptyRehearsal({ simulated: true, scores: { ex: "640" } }), false);
});

test("a real pull is never an empty rehearsal, even with a null score", () => {
  assert.equal(isEmptyRehearsal({ source: "crs", scores: { ex: null, eq: null, tu: null } }), false);
  assert.equal(isEmptyRehearsal({ source: "crs", simulated: false, scores: { ex: null } }), false);
  assert.equal(isEmptyRehearsal({ source: "crs", scores: { ex: 700 } }), false);
});

test("an unreadable payload answers false and never throws", () => {
  assert.equal(isEmptyRehearsal(null), false);
  assert.equal(isEmptyRehearsal(undefined), false);
  assert.equal(isEmptyRehearsal("simulated"), false);
});
