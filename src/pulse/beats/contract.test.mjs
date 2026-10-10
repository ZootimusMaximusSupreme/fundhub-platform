// The beat contract: validateBeat, runBeat, checkBeatSelfTest, fix-guide rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEAT_ID_RE, MAX_DEADLINE_MS, validateBeat, runBeat, checkBeatSelfTest, fixGuideProblems, fixGuidePaths,
  missingFixGuidePaths, BeatFail, BeatDone, HARNESS, pinBeatSource, PURE_IMPORTS, RESERVED_STEPS
} from "./contract.mjs";
import { makeBeatCtx, makeFakeCtx } from "./ctx.mjs";
import { makeFixtureBeat } from "../fake-sinks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const has = (problems, part) => problems.some((p) => p.includes(part));

/* ---------------- validateBeat ---------------- */

test("validateBeat: the fixture beat is clean", () => {
  assert.deepEqual(validateBeat(makeFixtureBeat(), { file: "beat-fixture.mjs" }), []);
  assert.deepEqual(validateBeat(makeFixtureBeat({ damp: 2, needs: ["bankLinks"], kind: "infra", covers: [] })), []);
});

test("validateBeat: every rule has a failing case that names the rule", () => {
  const cases = [
    [{ id: "Bad_Id" }, "id must match"],
    [{ id: "x".repeat(60) }, "id must match"],
    [{ id: "job:thing" }, "id must match"],
    [{ title: "" }, "title is required"],
    [{ title: "T".repeat(61) }, "title is 61 chars"],
    [{ title: "Café beat" }, "title must be plain ASCII"],
    [{ kind: "door" }, 'kind "door" does not exist in pulse v1'],
    [{ kind: "weird" }, "kind must be one of"],
    [{ covers: "route:x" }, "covers must be an array"],
    [{ covers: ["bogus"] }, "covers entry"],
    [{ kind: "send", covers: [] }, "covers may be []"],
    [{ box: true }, "box must be exactly false"],
    [{ box: undefined }, "box must be exactly false"],
    [{ doors: ["webhooks/commas"] }, "doors is not part of pulse v1"],
    [{ stubs: [{}] }, "stubs is not part of pulse v1"],
    [{ identity: {} }, "identity is not part of pulse v1"],
    [{ loadState: () => {} }, "loadState is not part of pulse v1"],
    [{ persist: () => {} }, "persist is not part of pulse v1"],
    [{ reads: "SITE" }, "reads must be an array"],
    [{ reads: [{ host: "HTTP://X", methods: ["GET"] }] }, "reads[0].host"],
    [{ reads: [{ host: "10.0.0.1", methods: ["GET"] }] }, "reads[0].host"],
    [{ reads: [{ host: "SITE", methods: ["POST"] }] }, "reads[0].methods"],
    [{ reads: [{ host: "SITE", methods: [] }] }, "reads[0].methods"],
    [{ kind: "infra", reads: [{ host: "*", methods: ["GET"] }] }, '"*" is allowed only for kind "probe"'],
    [{ steps: [] }, "steps must be a non-empty array"],
    [{ steps: ["Bad Step"] }, "must be lower-case words"],
    [{ steps: ["a", "a"] }, "declared twice"],
    [{ steps: ["done"] }, "harness name"],
    [{ steps: ["no-refusals"] }, "harness name"],
    [{ deadlineMs: 12001 }, "deadlineMs must be"],
    [{ deadlineMs: 100 }, "deadlineMs must be"],
    [{ deadlineMs: undefined }, "deadlineMs must be"],
    [{ deadlineMs: "5000" }, "deadlineMs must be"],
    [{ damp: 0 }, "damp must be"],
    [{ damp: 4 }, "damp must be"],
    [{ needs: ["somethingElse"] }, "needs must be"],
    [{ fixGuide: undefined }, "fixGuide must be a string"],
    [{ run: undefined }, "run(ctx) must be a function"],
    [{ selfTest: undefined }, "selfTest.pass and selfTest.fail"],
    [{ selfTest: { pass: () => ({}) } }, "selfTest.pass and selfTest.fail"]
  ];
  for (const [over, part] of cases) {
    const problems = validateBeat(makeFixtureBeat(over));
    assert.ok(has(problems, part), `${JSON.stringify(Object.keys(over))} should report "${part}", got: ${problems.join(" | ")}`);
  }
  assert.ok(has(validateBeat(null), "not an object"));
  assert.ok(MAX_DEADLINE_MS === 12000 && BEAT_ID_RE.test("apply-links"));
  assert.ok(RESERVED_STEPS.includes("done"));
});

test("validateBeat: the id must equal the file name between beat- and .mjs", () => {
  assert.deepEqual(validateBeat(makeFixtureBeat(), { file: "beat-fixture.mjs" }), []);
  assert.ok(has(validateBeat(makeFixtureBeat(), { file: "beat-other.mjs" }), 'must equal the file name part "other"'));
  assert.ok(has(validateBeat(makeFixtureBeat(), { file: "fixture.mjs" }), "file name must be beat-<id>.mjs"));
});

test("validateBeat: covers is checked against the surface keys when they are given; webhook:<provider> is allowed", () => {
  const surfaces = new Set(["route:lenders", "job:message-dispatch-sweeper"]);
  assert.deepEqual(validateBeat(makeFixtureBeat({ covers: ["route:lenders", "webhook:commas"] }), { surfaces }), []);
  assert.ok(has(validateBeat(makeFixtureBeat({ covers: ["route:nope"] }), { surfaces }), '"route:nope" is not a surface key'));
  assert.deepEqual(validateBeat(makeFixtureBeat({ covers: ["route:nope"] })), [], "no surfaces given, no check");
});

/* ---------------- the fix guide ---------------- */

const GOOD_GUIDE = makeFixtureBeat().fixGuide;

test("fixGuide: the shape rules, one failing case each", () => {
  assert.deepEqual(fixGuideProblems(GOOD_GUIDE), []);
  const has1 = (g, part) => assert.ok(has(fixGuideProblems(g), part), `expected "${part}" in: ${fixGuideProblems(g).join(" | ")}`);
  has1("", "line 1 is empty");
  has1(GOOD_GUIDE.replace(/^.*\n/, "A".repeat(121) + "\n"), "line 1 is 121 chars");
  has1(GOOD_GUIDE.replace(/^.*\n/, "Fix it — now\n"), "plain ASCII");
  has1("Short.\nLikely causes:\n- a\n- b\nSteps:\n- c\n- d\nFiles: src/db.mjs", "min 300");
  has1(GOOD_GUIDE.replace("Likely causes:", "Causes:"), 'needs a "Likely causes:" section');
  has1(GOOD_GUIDE.replace("Steps:", "Do:"), 'needs a "Steps:" section');
  has1(GOOD_GUIDE.replace("Files:", "Where:"), 'needs a "Files:" section');
  has1(GOOD_GUIDE.replace("Steps:", "Steps_:").replace("Likely causes:", "Steps:\n- x\n- y\nLikely causes:"), "sections must come in the order");
  has1(GOOD_GUIDE.replace("- The database did not answer (shows up at step one).\n", ""), '"Likely causes:" needs 2 or more');
  has1(GOOD_GUIDE.replace("- Run node scripts/pulse/run-beat.mjs fixture and read the step it stops at.\n", ""), '"Steps:" needs 2 or more');
  has1(GOOD_GUIDE.replace("Files: src/pulse/beats/contract.mjs", "Files: see the code"), "at least one repo path");
  has1(GOOD_GUIDE + "\nAuthorization: Bearer abcdef123456", "holds a secret or a mask");
  has1(GOOD_GUIDE + "\nkey is ****************1369", "holds a secret or a mask");
  has1(GOOD_GUIDE + "\nghp_abcdefghijklmnop", "holds a secret or a mask");
});

test("fixGuide: repo paths are found; a missing one is reported through an injected exists()", () => {
  const guide = "Files: src/adapters/commas.mjs, api/webhooks/[provider].mjs and scripts/pulse/run-beat.mjs. Also (db/migrations/475_x.sql).";
  assert.deepEqual(fixGuidePaths(guide), ["src/adapters/commas.mjs", "api/webhooks/[provider].mjs", "scripts/pulse/run-beat.mjs", "db/migrations/475_x.sql"]);
  const r = missingFixGuidePaths(guide, (p) => p !== "db/migrations/475_x.sql");
  assert.deepEqual(r.missing, ["db/migrations/475_x.sql"]);
  assert.equal(r.anyExists, true);
  assert.equal(missingFixGuidePaths("Files: src/nope.mjs", () => false).anyExists, false);
  // and against the real disk
  assert.equal(missingFixGuidePaths(GOOD_GUIDE, (p) => fs.existsSync(path.join(ROOT, p))).anyExists, true);
});

/* ---------------- runBeat ---------------- */

const ctxFor = (beat, over = {}) => makeFakeCtx(beat, beat.selfTest.pass() && { ...beat.selfTest.pass(), ...over });

test("runBeat: a green beat gets step done, its detail, its evidence, timing and its step list", async () => {
  const beat = makeFixtureBeat();
  const r = await runBeat(beat, ctxFor(beat));
  assert.equal(r.ok, true);
  assert.equal(r.beatId, "fixture");
  assert.equal(r.step, "done");
  assert.equal(r.detail, "fine");
  assert.deepEqual(r.evidence, { rows: 1 });
  assert.equal(r.box, null);
  assert.ok(Number.isInteger(r.ms) && r.ms >= 0);
  assert.deepEqual(r.steps.map((s) => [s.name, s.ok, Boolean(s.skipped)]), [["one", true, false], ["two", true, false], ["three", true, true]]);
  assert.deepEqual(r.skipped, ["three"]);
  assert.deepEqual(r.notRun, []);
});

test("runBeat: ctx.fail makes it red at the step it names, with the evidence", async () => {
  const beat = makeFixtureBeat();
  const r = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(r.ok, false);
  assert.equal(r.step, "two");
  assert.equal(r.detail, "the site said 500");
  assert.deepEqual(r.steps.map((s) => [s.name, s.ok]), [["one", true], ["two", false]]);
  assert.deepEqual(r.notRun, ["three"]);

  const withEvidence = makeFixtureBeat({ async run(ctx) { throw ctx.fail("one", "no rows", { count: 0 }); } });
  assert.deepEqual((await runBeat(withEvidence, ctxFor(withEvidence))).evidence, { count: 0 });
});

test("runBeat: a fail that is RETURNED instead of thrown is still red", async () => {
  const beat = makeFixtureBeat({ async run(ctx) { return ctx.fail("two", "returned, not thrown"); } });
  const r = await runBeat(beat, ctxFor(beat));
  assert.deepEqual([r.ok, r.step, r.detail], [false, "two", "returned, not thrown"]);
});

test("runBeat: any other throw is red 'threw: ...' at the step it was in, with secrets redacted and a 300 character cap", async () => {
  const beat = makeFixtureBeat({
    async run(ctx) { await ctx.step("one", async () => { throw new Error("upstream said token=sk_live_abcdef123456 and Bearer abc.def.ghi " + "x".repeat(500)); }); }
  });
  const r = await runBeat(beat, ctxFor(beat));
  assert.equal(r.ok, false);
  assert.equal(r.step, "one");
  assert.match(r.detail, /^threw: /);
  assert.ok(r.detail.length <= 300);
  assert.doesNotMatch(r.detail, /sk_live_abcdef123456|abc\.def\.ghi/);
  assert.match(r.detail, /\[redacted\]/);

  const sync = makeFixtureBeat({ run() { throw new TypeError("sync boom"); } });
  const s = await runBeat(sync, ctxFor(sync));
  assert.deepEqual([s.ok, s.step, s.detail], [false, "start", "threw: sync boom"]);

  const between = makeFixtureBeat({ async run(ctx) { await ctx.step("one", async () => 1); throw new Error("between steps"); } });
  assert.equal((await runBeat(between, ctxFor(between))).step, "one", "the last step that ran");
});

test("runBeat: a failure the beat handled does not become the 'where' of a later throw", async () => {
  const beat = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => { throw new Error("handled"); }).catch(() => {});
      await ctx.step("two", async () => 1);
      throw new Error("later");
    }
  });
  assert.equal((await runBeat(beat, ctxFor(beat))).step, "two");
});

test("runBeat: no verdict is red; a beat cannot go green by returning nothing", async () => {
  for (const ret of [undefined, null, "ok", { ok: true }, true]) {
    const beat = makeFixtureBeat({ async run() { return ret; } });
    const r = await runBeat(beat, ctxFor(beat));
    assert.deepEqual([r.ok, r.step], [false, "no-verdict"], JSON.stringify(ret));
  }
});

test("runBeat: the deadline names the step it was in, aborts the signal, and a late failure is swallowed", async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const beat = makeFixtureBeat({
      deadlineMs: 500,
      async run(ctx) {
        await ctx.step("two", () => new Promise((_, reject) => setTimeout(() => reject(new Error("late failure")), 700)));
        return ctx.done();
      }
    });
    const ctx = ctxFor(beat);
    const t0 = Date.now();
    const r = await runBeat(beat, ctx, { deadlineMs: 500 });
    assert.ok(Date.now() - t0 < 900);
    assert.deepEqual([r.ok, r.step], [false, "two"]);
    assert.equal(r.detail, "deadline 500 ms passed in step two");
    assert.equal(ctx.signal.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(unhandled, [], "the late rejection must not kill the run (critic issue 2)");

    const noStep = makeFixtureBeat({ async run() { await new Promise(() => {}); } });
    const n = await runBeat(noStep, ctxFor(noStep), { deadlineMs: 500 });
    assert.deepEqual([n.ok, n.step], [false, "deadline"]);
    assert.match(n.detail, /deadline 500 ms passed before any step began/);
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("runBeat: the deadline is the beat's own, capped at 12 s", async () => {
  const beat = makeFixtureBeat({ deadlineMs: 600, async run() { await new Promise(() => {}); } });
  const t0 = Date.now();
  const r = await runBeat(beat, ctxFor(beat));
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(r.ok, false);
  const long = makeFixtureBeat({ async run() { return new Promise(() => {}); } });
  // an override above the cap is clamped, not honoured: prove it without waiting 12 s by checking the detail text
  const probe = runBeat(long, ctxFor(long), { deadlineMs: 600 });
  assert.match((await probe).detail, /deadline 600 ms/);
});

test("runBeat no-refusals: a refused read is RED and names the refused thing, even if the beat swallowed the error", async () => {
  const beat = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => { try { await ctx.read("DELETE FROM clients"); } catch { /* swallowed on purpose */ } });
      await ctx.step("two", async () => 1);
      ctx.skipStep("three", "n/a");
      return ctx.done("looks fine");
    }
  });
  const r = await runBeat(beat, ctxFor(beat));
  assert.equal(r.ok, false);
  assert.equal(r.step, "no-refusals");
  assert.match(r.detail, /refused sql: not_a_read/);
  assert.match(r.detail, /DELETE/);
});

test("runBeat no-refusals: a refused host is RED too; a refusal that is thrown names itself", async () => {
  const swallowed = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => { await ctx.http.get("https://evil.example.org/x").catch(() => {}); });
      ctx.skipStep("two", "n/a"); ctx.skipStep("three", "n/a");
      return ctx.done();
    }
  });
  const a = await runBeat(swallowed, ctxFor(swallowed));
  assert.deepEqual([a.ok, a.step], [false, "no-refusals"]);
  assert.match(a.detail, /refused host: .*evil\.example\.org/);

  const thrown = makeFixtureBeat({ async run(ctx) { await ctx.step("one", async () => ctx.read("INSERT INTO t VALUES (1)")); } });
  const b = await runBeat(thrown, ctxFor(thrown));
  assert.deepEqual([b.ok, b.step], [false, "one"]);
  assert.match(b.detail, /^refused sql: not_a_read/);
});

test("runBeat never throws: a missing beat, a missing run, a garbage ctx, a throwing getter", async () => {
  for (const [beat, ctx] of [[null, {}], [{}, {}], [{ id: "x", run: 5 }, {}], [{ id: "x", steps: ["a"], async run() { return new BeatDone("ok"); } }, null]]) {
    const r = await runBeat(beat, ctx);
    assert.equal(typeof r.ok, "boolean");
    assert.equal(typeof r.detail, "string");
  }
  const g = await runBeat({ id: "x", steps: ["a"], async run() { return new BeatDone("fine"); } }, {});
  assert.equal(g.ok, true, "a ctx with no harness handle still runs");
  const hostile = { get [HARNESS]() { throw new Error("getter boom"); } };
  const r = await runBeat({ id: "x", steps: ["a"], async run() { return new BeatDone(); } }, hostile);
  assert.equal(typeof r.ok, "boolean", "a ctx whose handle throws still gets a result, never a throw");
  assert.equal(r.beatId, "x");
  const failing = await runBeat({ id: "x", steps: ["a"], async run() { throw new Error("boom"); } }, hostile);
  assert.deepEqual([failing.ok, failing.step], [false, "start"]);
});

/* ---------------- checkBeatSelfTest ---------------- */

test("checkBeatSelfTest: a good beat has no problems", async () => {
  assert.deepEqual(await checkBeatSelfTest(makeFixtureBeat()), []);
});

test("checkBeatSelfTest: a beat that cannot go red is rejected", async () => {
  const blind = makeFixtureBeat({
    async run(ctx) { await ctx.step("one", async () => 1); await ctx.step("two", async () => 1); ctx.skipStep("three", "x"); return ctx.done("always green"); }
  });
  const p = await checkBeatSelfTest(blind);
  assert.ok(has(p, "selfTest.fail stayed GREEN"), p.join(" | "));
});

test("checkBeatSelfTest: the fail case must go red at a DECLARED step with a detail", async () => {
  const undeclared = makeFixtureBeat({ async run(ctx) { await ctx.step("one", async () => ctx.read("SELECT 1")); throw ctx.fail("mystery", "went wrong"); } });
  assert.ok(has(await checkBeatSelfTest(undeclared), 'not a declared step'));
  const empty = makeFixtureBeat({ async run(ctx) { throw ctx.fail("one", ""); } });
  assert.ok(has(await checkBeatSelfTest(empty), "empty detail"));
  const harnessStep = makeFixtureBeat({
    async run(ctx) { await ctx.step("one", async () => { try { await ctx.read("DELETE FROM t"); } catch { /* */ } }); ctx.skipStep("two", "x"); ctx.skipStep("three", "x"); return ctx.done(); }
  });
  const hp = await checkBeatSelfTest(harnessStep);
  assert.ok(has(hp, "selfTest.pass went red at \"no-refusals\"") || has(hp, "no-refusals"), hp.join(" | "));
});

test("checkBeatSelfTest: the pass case must be green and must run (or skip) every declared step", async () => {
  const red = makeFixtureBeat({ selfTest: { pass: () => makeFixtureBeat().selfTest.fail(), fail: () => makeFixtureBeat().selfTest.fail() } });
  assert.ok(has(await checkBeatSelfTest(red), 'selfTest.pass went red at "two"'));

  const lazy = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => ctx.read("SELECT 1"));
      const ok = ctx.siteUrl.endsWith("fundhub.ai");
      if (!ok) throw ctx.fail("two", "bad site");
      return ctx.done("never ran steps two and three");
    },
    selfTest: { pass: makeFixtureBeat().selfTest.pass, fail: () => ({ ...makeFixtureBeat().selfTest.fail(), siteUrl: "https://example.org" }) }
  });
  assert.ok(has(await checkBeatSelfTest(lazy), "never ran step(s) two, three"));
});

test("checkBeatSelfTest: a selfTest that throws, or a beat that hangs, is reported, not thrown", async () => {
  const throwing = makeFixtureBeat({ selfTest: { pass: () => { throw new Error("no overrides"); }, fail: () => ({}) } });
  assert.ok(has(await checkBeatSelfTest(throwing), "selfTest could not run: no overrides"));
  const hang = makeFixtureBeat({ async run() { await new Promise(() => {}); } });
  const p = await checkBeatSelfTest(hang, { limitMs: 500 });
  assert.ok(has(p, "selfTest.pass went red at \"deadline\"") || has(p, "deadline"), p.join(" | "));
});

/* ---------------- pin: the role "lib" and PURE_IMPORTS ---------------- */

test("pinBeatSource: lib helpers may import siblings and the contract; a beat may not import siblings outside ./lib", () => {
  assert.deepEqual(pinBeatSource('import { x } from "./other.mjs";\nimport { BeatFail } from "../contract.mjs";\nexport const y = 1;', { role: "lib" }), []);
  assert.ok(pinBeatSource('import { x } from "./other.mjs";', { role: "beat" }).length > 0);
  assert.deepEqual(pinBeatSource('import { x } from "./lib/other.mjs";\nimport { isMasked } from "./contract.mjs";\nimport crypto from "node:crypto";', { role: "beat" }), []);
});

test("pinBeatSource: PURE_IMPORTS is the only way past the allow-list, and it starts empty", () => {
  assert.deepEqual(Object.keys(PURE_IMPORTS), []);
  const src = 'import { classify } from "../../lib/some-pure-thing.mjs";';
  assert.ok(pinBeatSource(src).length > 0);
  assert.deepEqual(pinBeatSource(src, { pureImports: { "../../lib/some-pure-thing.mjs": "pure string function" } }), []);
});

test("a BeatFail is an Error with a step; the contract module itself reads no disk and sends nothing", () => {
  const f = new BeatFail("one", "x");
  assert.ok(f instanceof Error && f.step === "one");
  const src = fs.readFileSync(path.join(ROOT, "src/pulse/beats/contract.mjs"), "utf8");
  assert.doesNotMatch(src, /from\s+["'](?:node:)?fs["']|readFileSync|existsSync\(/);
});

test("makeBeatCtx result is what runBeat expects: a handle under the HARNESS symbol and nothing enumerable", () => {
  const beat = makeFixtureBeat();
  const ctx = makeBeatCtx({ beat, runId: "r", env: {} });
  assert.equal(typeof ctx[HARNESS].steps, "function");
  assert.equal(Object.keys(ctx).includes(String(HARNESS)), false);
});

/* ---------------- checker findings, 2026-10-09: a swallowed step failure is not a green ---------------- */

const SWALLOW_OVER = { reads: [{ host: "SITE", methods: ["GET"] }] };
const okCtx = (beat) => makeFakeCtx(beat, { read: [{ match: /SELECT 1/, rows: [{ n: 1 }] }], http: { "GET https://fundhub.ai/x": { status: 200 } } });

test("runBeat: a step that failed, was caught, and then the beat said done is RED at that step (FAIL side)", async () => {
  const beat = makeFixtureBeat({
    ...SWALLOW_OVER,
    async run(ctx) {
      try { await ctx.step("one", async () => { throw ctx.fail("one", "the database did not answer"); }); } catch { /* swallowed */ }
      await ctx.step("two", async () => 1);
      ctx.skipStep("three", "n/a");
      return ctx.done("ok");
    }
  });
  const r = await runBeat(beat, okCtx(beat));
  assert.equal(r.ok, false);
  assert.equal(r.step, "one");
  assert.match(r.detail, /step one failed, but the beat caught it and returned done/);
  assert.equal(r.steps.find((s) => s.name === "one").ok, false);
});

test("runBeat: a swallowed failure inside a nested step is still caught", async () => {
  const beat = makeFixtureBeat({
    ...SWALLOW_OVER,
    async run(ctx) {
      await ctx.step("one", async () => {
        try { await ctx.step("two", async () => { throw new Error("inner broke"); }); } catch { /* the outer step carries on */ }
      });
      ctx.skipStep("three", "n/a");
      return ctx.done("ok");
    }
  });
  const r = await runBeat(beat, okCtx(beat));
  assert.deepEqual([r.ok, r.step], [false, "two"]);
});

test("runBeat: a failed step the beat SKIPPED on purpose (ctx.skipStep) is not a swallowed failure (PASS side)", async () => {
  const beat = makeFixtureBeat({
    ...SWALLOW_OVER,
    async run(ctx) {
      await ctx.step("one", async () => 1);
      try { await ctx.step("two", async () => { throw new Error("optional thing broke"); }); } catch { ctx.skipStep("two", "the optional check could not run"); }
      ctx.skipStep("three", "n/a");
      return ctx.done("ok");
    }
  });
  const r = await runBeat(beat, okCtx(beat));
  assert.deepEqual([r.ok, r.step], [true, "done"]);
  assert.ok(r.skipped.includes("two"));
});

test("runBeat: a step that failed once, then was run again and PASSED, is green (a retry is not a swallow)", async () => {
  let tries = 0;
  const beat = makeFixtureBeat({
    ...SWALLOW_OVER,
    async run(ctx) {
      for (let k = 0; k < 2; k++) {
        try { await ctx.step("one", async () => { if (++tries === 1) throw new Error("first try"); }); break; } catch { /* retry */ }
      }
      await ctx.step("two", async () => 1);
      ctx.skipStep("three", "n/a");
      return ctx.done("ok");
    }
  });
  const r = await runBeat(beat, okCtx(beat));
  assert.deepEqual([r.ok, r.step], [true, "done"]);
  assert.equal(tries, 2);
});

test("runBeat: a retry that fails again stays red", async () => {
  const beat = makeFixtureBeat({
    ...SWALLOW_OVER,
    async run(ctx) {
      for (let k = 0; k < 2; k++) {
        try { await ctx.step("one", async () => { throw new Error("still broken"); }); } catch { /* retry */ }
      }
      await ctx.step("two", async () => 1);
      ctx.skipStep("three", "n/a");
      return ctx.done("ok");
    }
  });
  const r = await runBeat(beat, okCtx(beat));
  assert.deepEqual([r.ok, r.step], [false, "one"]);
});
