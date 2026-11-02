// Message tests: an A/B split for four follow-up messages (owner GO 2026-10-31,
// board ops/workflows/backend-selling-lanes-2026-10-30.md section 6e).
//
// A test has two versions of the same step. A is today's message. B is the same
// step with one real client win added. Version B is stored as its own template
// row, and its key is the base key plus "-B" (EMAIL-NOBOOK-02 and
// EMAIL-NOBOOK-02-B). Nothing else about a B message is new: it is sent by the
// same workflow at the same moment, held by the same send hours and the same
// gate, and counted by the same checks as its base key.
//
// WHO GETS WHICH VERSION. Each person lands in A or B by a coin flip that always
// lands the same way for that person and that test (armFor). So the text and the
// email of one step match, a replay picks the same version, and nothing is stored
// to remember it.
//
// B GOES OUT ONLY WHEN IT IS READY. sendTemplated (src/workflows/messaging.mjs)
// sends B only when the B row exists, is not draft copy and has passed
// compliance. Otherwise the person gets A. A missing B never means a blank or a
// skipped message.
//
// The report (src/messaging/experiment-report.mjs) counts both versions and names
// a winner only when the gap is big enough to trust. Nothing in this file or the
// report ever switches a version by itself.
//
// This file imports nothing from src/messaging/send-window.mjs, because
// send-window.mjs imports baseKeyOf from here.

import crypto from "node:crypto";

/** B's template key is the base key plus this. */
export const VARIANT_SUFFIX = "-B";

/** Each side needs at least this many people before the report may name a winner. */
export const MIN_PER_ARM = 30;

/* The tests. `keys` are the base keys, one text and one email. `goal` is the
   event that counts as success (events.name), `windowDays` how long after a
   person's first message in the test it may happen. The names are shared with the
   report and the Marketing page. Do not rename them. */
export const EXPERIMENTS = Object.freeze([
  Object.freeze({
    name: "resume-proof",
    keys: Object.freeze(["SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2"]),
    goal: "survey.completed",
    windowDays: 7,
    label: "Come-back chase, message 2: real proof or not"
  }),
  Object.freeze({
    name: "nobook-proof",
    keys: Object.freeze(["SMS-NOBOOK-02", "EMAIL-NOBOOK-02"]),
    goal: "booking.created",
    windowDays: 7,
    label: "Never-booked chase, message 2: real proof or not"
  })
]);

/** The B key for a base key. */
export function variantKeyFor(baseKey) {
  return `${baseKey}${VARIANT_SUFFIX}`;
}

// key -> test, for every base key and every B key. Built once.
const TEST_OF_KEY = new Map();
// B key -> its base key.
const BASE_OF_VARIANT = new Map();
for (const experiment of EXPERIMENTS) {
  for (const key of experiment.keys) {
    TEST_OF_KEY.set(key, experiment);
    TEST_OF_KEY.set(variantKeyFor(key), experiment);
    BASE_OF_VARIANT.set(variantKeyFor(key), key);
  }
}

/** The test a template key belongs to, whether it is a base key or its B key. Otherwise null. */
export function experimentFor(templateKey) {
  if (typeof templateKey !== "string") return null;
  return TEST_OF_KEY.get(templateKey) ?? null;
}

/** The base key of a B key. Any other key comes back as it was given, a "-B" on an unknown key included. */
export function baseKeyOf(templateKey) {
  if (typeof templateKey !== "string") return templateKey;
  return BASE_OF_VARIANT.get(templateKey) ?? templateKey;
}

/** The keys with the B key of every test's base key added. For a lookup that must see both versions. */
export function withVariants(keys) {
  const out = [];
  const add = (key) => { if (!out.includes(key)) out.push(key); };
  for (const key of keys) {
    add(key);
    // Only a base key has a B key; the B key of a B key, or of any other key, is not a thing.
    if (experimentFor(key) && baseKeyOf(key) === key) add(variantKeyFor(key));
  }
  return out;
}

/* armFor — "A" or "B", from the low bit of the first byte of sha256("<test>:<client id>").
   The same person and the same test give the same answer every time. The id is read
   in lower case so a differently written uuid cannot change it. Anything it cannot
   place (no person, no test name) is "A", the message that has always gone out. */
export function armFor(clientId, experimentName) {
  const id = String(clientId ?? "").trim().toLowerCase();
  const name = String(experimentName ?? "");
  if (!id || !name) return "A";
  const first = crypto.createHash("sha256").update(`${name}:${id}`).digest()[0];
  return (first & 1) === 1 ? "B" : "A";
}
