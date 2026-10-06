// The job-kind registry: every entry the worker may claim has a group, a lazy load and a
// handler that exports run(job, ctx). Passes on the empty registry; fails the moment a line
// is added whose handler has no run().

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JOB_KINDS, JOB_GROUPS, checkJobKinds } from "./job-kinds.mjs";

describe("JOB_KINDS", () => {
  test("every registered kind is well formed and its handler exports run()", async () => {
    const problems = await checkJobKinds(JOB_KINDS);
    assert.deepEqual(problems, [], problems.join("\n"));
  });

  test("'offer' is never a queue kind (it runs on its own path)", () => {
    assert.equal(Object.prototype.hasOwnProperty.call(JOB_KINDS, "offer"), false);
  });

  test("the four groups the worker paces by (research added by unit X2)", () => {
    assert.deepEqual([...JOB_GROUPS], ["writer", "loader", "system", "research"]);
  });

  test("the two research kinds are registered, in the research group", () => {
    assert.equal(JOB_KINDS.flywheel_stage.group, "research");
    assert.equal(JOB_KINDS.deep_research.group, "research");
  });
});

describe("checkJobKinds catches a bad entry", () => {
  test("an entry whose handler has no run() is a problem", async () => {
    const problems = await checkJobKinds({ write_slot: { group: "writer", load: async () => ({ notRun() {} }) } });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /write_slot: the handler does not export run/);
  });

  test("a good entry passes", async () => {
    const problems = await checkJobKinds({ write_slot: { group: "writer", load: async () => ({ run: async () => ({}) }) } });
    assert.deepEqual(problems, []);
  });

  test("a wrong group, a missing load, a load that throws and 'offer' are each named", async () => {
    const problems = await checkJobKinds({
      a: { group: "painter", load: async () => ({ run() {} }) },
      b: { group: "system" },
      c: { group: "loader", load: async () => { throw new Error("no such file"); } },
      offer: { group: "writer", load: async () => ({ run() {} }) }
    });
    assert.equal(problems.length, 4, problems.join("\n"));
    assert.match(problems.join("\n"), /a: group must be one of/);
    assert.match(problems.join("\n"), /b: load must be a function/);
    assert.match(problems.join("\n"), /c: the handler did not load \(no such file\)/);
    assert.match(problems.join("\n"), /'offer' must not be in JOB_KINDS/);
  });
});
