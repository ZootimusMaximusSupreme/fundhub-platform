// Message tests (src/messaging/experiments.mjs): the keys, the coin flip, and "a B key is its base key
// for send hours". No database. The database halves are experiments.pg.test.mjs and
// experiment-report.pg.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  VARIANT_SUFFIX, MIN_PER_ARM, EXPERIMENTS,
  experimentFor, baseKeyOf, variantKeyFor, withVariants, armFor
} from "./experiments.mjs";
import { sendTiming, INSTANT_TEMPLATE_KEYS, DRIP_TEMPLATE_KEYS } from "./send-window.mjs";
import { smsDedupBatchKey } from "./sms-dedup.mjs";
import { workflowRefsFor, annotateTemplates } from "./template-usage.mjs";

const FOUR = ["SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2", "SMS-NOBOOK-02", "EMAIL-NOBOOK-02"];
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("the tests and their keys", () => {
  test("the two tests are exactly the ones the board names", () => {
    assert.deepEqual(EXPERIMENTS.map((e) => e.name), ["resume-proof", "nobook-proof"]);
    assert.deepEqual(EXPERIMENTS[0], {
      name: "resume-proof",
      keys: ["SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2"],
      goal: "survey.completed",
      windowDays: 7,
      label: "Come-back chase, message 2: real proof or not"
    });
    assert.deepEqual(EXPERIMENTS[1], {
      name: "nobook-proof",
      keys: ["SMS-NOBOOK-02", "EMAIL-NOBOOK-02"],
      goal: "booking.created",
      windowDays: 7,
      label: "Never-booked chase, message 2: real proof or not"
    });
    assert.equal(VARIANT_SUFFIX, "-B");
    assert.equal(MIN_PER_ARM, 30);
  });

  test("the list cannot be changed by a caller", () => {
    assert.ok(Object.isFrozen(EXPERIMENTS));
    for (const e of EXPERIMENTS) {
      assert.ok(Object.isFrozen(e));
      assert.ok(Object.isFrozen(e.keys));
    }
  });

  test("version B's key is the base key plus -B", () => {
    assert.equal(variantKeyFor("EMAIL-NOBOOK-02"), "EMAIL-NOBOOK-02-B");
    assert.equal(variantKeyFor("SMS-S02-RESUME-2"), "SMS-S02-RESUME-2-B");
  });

  test("a base key and its B key belong to the same test; nothing else does", () => {
    for (const key of FOUR) {
      const test = experimentFor(key);
      assert.ok(test, key);
      assert.equal(experimentFor(variantKeyFor(key)), test, `${key}-B is the same test as ${key}`);
    }
    assert.equal(experimentFor("SMS-NOBOOK-02").name, "nobook-proof");
    assert.equal(experimentFor("EMAIL-S02-RESUME-2-B").name, "resume-proof");
    for (const key of ["SMS-NOBOOK-01", "SMS-NOBOOK-03-B", "SMS-S02-RESUME-2-B-B", "SMS-S00-WELCOME", "", null, undefined, 7]) {
      assert.equal(experimentFor(key), null, String(key));
    }
  });

  test("baseKeyOf takes -B off a known B key and touches nothing else", () => {
    for (const key of FOUR) {
      assert.equal(baseKeyOf(variantKeyFor(key)), key);
      assert.equal(baseKeyOf(key), key);
    }
    // A key that merely ends in -B is not a version B of anything.
    assert.equal(baseKeyOf("SMS-FOO-B"), "SMS-FOO-B");
    assert.equal(baseKeyOf("SMS-NOBOOK-03-B"), "SMS-NOBOOK-03-B");
    assert.equal(baseKeyOf("SMS-NOBOOK-02-B-B"), "SMS-NOBOOK-02-B-B");
    assert.equal(baseKeyOf(""), "");
    assert.equal(baseKeyOf(null), null);
    assert.equal(baseKeyOf(undefined), undefined);
  });

  test("withVariants adds each tested key's B key once, and nothing for any other key", () => {
    assert.deepEqual(withVariants(["SMS-S02-RESUME-1", "SMS-S02-RESUME-2", "SMS-S02-RESUME-3"]),
      ["SMS-S02-RESUME-1", "SMS-S02-RESUME-2", "SMS-S02-RESUME-2-B", "SMS-S02-RESUME-3"]);
    assert.deepEqual(withVariants(["SMS-NOBOOK-02", "SMS-NOBOOK-02-B"]), ["SMS-NOBOOK-02", "SMS-NOBOOK-02-B"]);
    assert.deepEqual(withVariants(["SMS-FOO"]), ["SMS-FOO"]);
    assert.deepEqual(withVariants([]), []);
  });
});

describe("who gets which version", () => {
  test("the same person gets the same version every time", () => {
    for (let i = 0; i < 200; i += 1) {
      for (const e of EXPERIMENTS) {
        const first = armFor(id(i), e.name);
        assert.ok(first === "A" || first === "B");
        for (let again = 0; again < 3; again += 1) assert.equal(armFor(id(i), e.name), first);
      }
    }
  });

  test("it follows the rule on the board: the low bit of the first byte of sha256(test:client)", () => {
    for (let i = 0; i < 300; i += 1) {
      for (const e of EXPERIMENTS) {
        const byte = crypto.createHash("sha256").update(`${e.name}:${id(i)}`).digest()[0];
        assert.equal(armFor(id(i), e.name), (byte & 1) ? "B" : "A", `${e.name} ${id(i)}`);
      }
    }
  });

  test("10,000 people split 48 to 52 percent, in both tests", () => {
    for (const e of EXPERIMENTS) {
      let b = 0;
      for (let i = 0; i < 10000; i += 1) if (armFor(id(i), e.name) === "B") b += 1;
      assert.ok(b >= 4800 && b <= 5200, `${e.name}: ${b} of 10000 in B`);
    }
  });

  test("each test flips its own coin: a person can be A in one and B in the other", () => {
    let same = 0;
    for (let i = 0; i < 10000; i += 1) if (armFor(id(i), "resume-proof") === armFor(id(i), "nobook-proof")) same += 1;
    assert.ok(same > 4500 && same < 5500, `${same} of 10000 matched`);
  });

  test("a differently written uuid is the same person", () => {
    for (let i = 0; i < 100; i += 1) {
      const a = crypto.randomUUID();
      assert.equal(armFor(a.toUpperCase(), "resume-proof"), armFor(a, "resume-proof"));
      assert.equal(armFor(`  ${a} `, "nobook-proof"), armFor(a, "nobook-proof"));
    }
  });

  test("anything it cannot place is A, the message that has always gone out", () => {
    assert.equal(armFor(null, "resume-proof"), "A");
    assert.equal(armFor("", "resume-proof"), "A");
    assert.equal(armFor(id(1), ""), "A");
    assert.equal(armFor(undefined, undefined), "A");
  });
});

describe("a B key is its base key for send hours", () => {
  test("the four tested keys sort the same as their B keys", () => {
    for (const key of FOUR) {
      assert.equal(sendTiming(variantKeyFor(key)), sendTiming(key), key);
      assert.equal(sendTiming(variantKeyFor(key)), "drip", `${key}-B is a drip, 9 a.m. to 5 p.m. Arizona`);
    }
  });

  test("every listed key that has a B key sorts the same as it", () => {
    let checked = 0;
    for (const key of [...INSTANT_TEMPLATE_KEYS, ...DRIP_TEMPLATE_KEYS]) {
      if (!experimentFor(key)) continue;
      assert.equal(sendTiming(variantKeyFor(key)), sendTiming(key), key);
      checked += 1;
    }
    assert.equal(checked, FOUR.length);
  });

  test("a key that only ends in -B gets no special treatment", () => {
    assert.equal(sendTiming("SMS-NOBOOK-03-B"), "standard");
    assert.equal(sendTiming("SMS-S00-WELCOME-B"), "standard");
    assert.equal(sendTiming("SMS-FOO-B"), "standard");
    assert.equal(sendTiming("SMS-NOBOOK-03"), "drip");
  });

  test("the sender's duplicate-text guard counts A and B as one step", () => {
    const key = (templateKey) => smsDedupBatchKey({ orgId: "org", templateKey, bodyFingerprint: null, toAddress: "+15551234567" });
    for (const k of FOUR) assert.equal(key(variantKeyFor(k)), key(k), k);
    assert.notEqual(key("SMS-NOBOOK-02"), key("SMS-NOBOOK-03"));
  });
});

describe("the template editor", () => {
  test("a B template is used by whatever uses its base key", () => {
    for (const key of FOUR) {
      const base = workflowRefsFor(key);
      assert.ok(base.length > 0, `${key} is named in workflow code`);
      assert.deepEqual(workflowRefsFor(variantKeyFor(key)), base, `${key}-B inherits it`);
    }
    assert.deepEqual(workflowRefsFor("SMS-NOBOOK-03-B"), []);
  });

  test("the list marks a B template as sent by an automation, not as unused", () => {
    const rows = annotateTemplates([
      { template_key: "SMS-NOBOOK-02" },
      { template_key: "SMS-NOBOOK-02-B" },
      { template_key: "SMS-NOT-A-KEY-B" }
    ]);
    assert.equal(rows[1].used_by.locked, true);
    assert.deepEqual(rows[1].used_by.workflows, rows[0].used_by.workflows);
    assert.equal(rows[1].used_by.summary, rows[0].used_by.summary);
    assert.equal(rows[2].used_by.locked, false);
  });
});
