// The reader the batch 05 guard uses to decide that a named test is a live test.
// It has to go RED for every way a test can be switched off while the suite still
// exits 0, and it must not cry wolf over ordinary test code.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { blankComments, inspectNamedTests, ownLevelExits } from "./fin-b05-test-binding.mjs";

const TITLE = "the named test";
const live = (body = "assert.equal(value, 1);") => `import test from "node:test";\n\ntest("${TITLE}", async () => {\n  ${body}\n});\n`;
const inspect = (source, titles = [TITLE]) => inspectNamedTests(source, titles);
const CLEAN = { missing: [], hollow: [], markers: [], earlyExit: [], gutted: [] };

test("a live top-level test with an assertion is found, with nothing flagged", () => {
  assert.deepEqual(inspect(live()), CLEAN);
});

test("a test switched off with .skip, .todo or .only is not live", () => {
  for (const word of ["skip", "todo", "only"]) {
    const source = `test.${word}("${TITLE}", async () => {\n  assert.equal(value, 1);\n});\n`;
    const out = inspect(source);
    assert.deepEqual(out.missing, [TITLE], word);
    assert.equal(out.markers.length, 1, word);
  }
});

test("a test switched off with an options object is not live", () => {
  const source = `test("${TITLE}", { skip: true }, async () => {\n  assert.equal(value, 1);\n});\n`;
  const out = inspect(source);
  assert.deepEqual(out.missing, [TITLE]);
  assert.ok(out.markers.length > 0);
  const todo = inspect(`test("${TITLE}", { todo: "later" }, async () => {\n  assert.equal(value, 1);\n});\n`);
  assert.deepEqual(todo.missing, [TITLE]);
});

test("a title that only survives in a comment is not a test", () => {
  const line = `import test from "node:test";\n// test("${TITLE}", async () => {\n//   assert.equal(value, 1);\n// });\n`;
  assert.deepEqual(inspect(line).missing, [TITLE]);
  const block = `/*\ntest("${TITLE}", async () => {\n  assert.equal(value, 1);\n});\n*/\n`;
  assert.deepEqual(inspect(block).missing, [TITLE]);
  const renamed = live().replace(`test("${TITLE}"`, `test("a new title"`) + `// was: test("${TITLE}", async () => {\n`;
  assert.deepEqual(inspect(renamed).missing, [TITLE]);
});

test("a title that only appears inside a string, or in a test nested under a condition or a group, is not a test", () => {
  assert.deepEqual(inspect(`const names = ["${TITLE}"];\n`).missing, [TITLE]);
  // Indented under an if.
  assert.deepEqual(inspect(`if (process.env.RUN_IT) {\n  test("${TITLE}", async () => {\n    assert.ok(value);\n  });\n}\n`).missing, [TITLE]);
  // Still at column 0 but inside the block: depth, not indentation, decides.
  assert.deepEqual(inspect(`if (process.env.RUN_IT) {\ntest("${TITLE}", async () => {\n  assert.ok(value);\n});\n}\n`).missing, [TITLE]);
  assert.deepEqual(inspect(`describe("group", () => {\ntest("${TITLE}", async () => {\n  assert.ok(value);\n});\n});\n`).missing, [TITLE]);
  // A real top-level test after a block that closed is live again.
  const after = `if (a) {\n  doIt();\n}\ntest("${TITLE}", async () => {\n  assert.ok(value);\n});\n`;
  assert.deepEqual(inspect(after), CLEAN);
  // A bracket in a string or a regex does not shift the depth.
  const quirky = `const a = "}}}";\nconst b = /[}\\]]/;\nconst c = \`\${"{"}\`;\ntest("${TITLE}", async () => {\n  assert.ok(value);\n});\n`;
  assert.deepEqual(inspect(quirky), CLEAN);
});

test("a test that asserts nothing is hollow, and one that asserts through a helper is not", () => {
  assert.deepEqual(inspect(live("const x = 1;")).hollow, [TITLE]);
  assert.deepEqual(inspect(live("await assertNothingWritten(out, 'x');")).hollow, []);
});

test("a run that ends the process early is flagged", () => {
  assert.deepEqual(inspect(`process.exit(0);\n${live()}`).markers, ["process.exit"]);
});

test("words inside a title or a string are not mistaken for a switched-off test", () => {
  const body = `test("answers only POST: only after Round 4 skip: todo: process.exit", async () => {\n  assert.equal(value, "only: skip:");\n});\n`;
  const out = inspect(body, ["answers only POST: only after Round 4 skip: todo: process.exit"]);
  assert.deepEqual(out, CLEAN);
});

test("the scanner keeps length and newlines, and is not fooled by quotes, slashes and template text", () => {
  const source = [
    'const url = "https://example.test/a//b";',
    "const re = /\"[a-z]+\\/\\//g; // a comment with a \" quote",
    "const tpl = `a // not a comment ${ `inner // still text ${1 + 1}` } and /* not one */`;",
    "const half = 4 / 2 / 1; // a comment",
    "/* a block",
    'test("hidden in a block", async () => {});',
    "*/",
    `test("${TITLE}", async () => {`,
    "  assert.ok(/'/.test(\"'\"));",
    "});",
    "",
  ].join("\n");
  const blank = blankComments(source);
  assert.equal(blank.length, source.length);
  assert.deepEqual([...blank].map((c) => c === "\n"), [...source].map((c) => c === "\n"));
  assert.ok(blank.includes("https://example.test/a//b"), "a string with // was cut");
  assert.ok(blank.includes("${ `inner // still text"), "template text was cut");
  assert.ok(!blank.includes("hidden in a block"), "a commented-out test survived");
  assert.ok(!blank.includes("a comment with"), "a line comment survived");
  const out = inspect(source, [TITLE, "hidden in a block"]);
  assert.deepEqual(out.missing, ["hidden in a block"]);
  assert.deepEqual(out.hollow, []);
});

test("the scanner copes with every proof file in this folder (same length, same lines, no throw)", () => {
  const dir = new URL("./", import.meta.url);
  const files = fs.readdirSync(dir).filter((name) => /\.mjs$/.test(name));
  assert.ok(files.length > 10);
  for (const name of files) {
    const source = fs.readFileSync(new URL(name, dir), "utf8");
    for (const strings of [false, true]) {
      const blank = blankComments(source, { strings });
      assert.equal(blank.length, source.length, name);
      assert.equal(blank.split("\n").length, source.split("\n").length, name);
    }
  }
});

test("the batch 05 handler test is read as live, with its own named tests found and no markers", () => {
  const source = fs.readFileSync(new URL("./fin-b05-door-closer-deck-letters.test.mjs", import.meta.url), "utf8");
  const titles = [...source.matchAll(/^test\("([^"]+)", async \(\) => \{$/gm)].map((m) => m[1]);
  assert.ok(titles.length >= 14, `found ${titles.length} tests`);
  assert.deepEqual(inspectNamedTests(source, titles), CLEAN);
});

test("a test that is switched off from inside its own body is flagged: t.skip then return, a bare return, a tautology then return", () => {
  // The three shapes an independent checker used against the first version of the
  // guard; each one exited 0 and left the guard at 7 of 7.
  const shapes = {
    "t.skip then return": `test("${TITLE}", async (t) => {\n  t.skip("off");\n  return;\n  assert.equal(value, 1);\n});\n`,
    "a bare early return": `test("${TITLE}", async () => {\n  return;\n  assert.equal(value, 1);\n});\n`,
    "assert.ok(true) then return": `test("${TITLE}", async () => {\n  assert.ok(true);\n  return;\n  assert.equal(value, 1);\n});\n`,
  };
  for (const [label, source] of Object.entries(shapes)) {
    const out = inspect(source);
    const caught = out.markers.length > 0 || out.hollow.length > 0 || out.earlyExit.length > 0;
    assert.equal(caught, true, `${label} was not caught: ${JSON.stringify(out)}`);
  }
  assert.deepEqual(inspect(shapes["t.skip then return"]).markers, [".skip"]);
  assert.deepEqual(inspect(shapes["a bare early return"]).earlyExit, [TITLE]);
  assert.deepEqual(inspect(shapes["assert.ok(true) then return"]).earlyExit, [TITLE]);
  // .skip and .todo on any receiver, as a call or a property read.
  for (const word of ["skip", "todo"]) {
    const out = inspect(live(`ctx.${word}("later");\n  assert.equal(value, 1);`));
    assert.deepEqual(out.markers, [`.${word}`], word);
  }
});

test("a return, break or continue at the callback's own level is an early exit; inside a nested function it is not", () => {
  const exits = (body) => inspect(live(body)).earlyExit;
  assert.deepEqual(exits("if (cond) return;\n  assert.equal(value, 1);"), [TITLE]);
  assert.deepEqual(exits("for (const x of xs) {\n    if (!x) continue;\n    assert.equal(x, 1);\n  }"), [TITLE]);
  assert.deepEqual(exits("while (true) {\n    break;\n  }\n  assert.equal(value, 1);"), [TITLE]);
  assert.deepEqual(exits("try {\n    await go();\n  } finally {\n    return;\n  }\n  assert.equal(value, 1);"), [TITLE]);
  // A function nested in the test keeps its own returns: a helper, a callback, a method, a function expression.
  assert.deepEqual(exits("const pick = (x) => {\n    return x.id;\n  };\n  assert.equal(pick(a), 1);"), []);
  assert.deepEqual(exits("const ids = rows.map((row) => {\n    if (!row) return null;\n    return row.id;\n  });\n  assert.deepEqual(ids, [1]);"), []);
  assert.deepEqual(exits("const o = {\n    run() {\n      return 1;\n    },\n  };\n  assert.equal(o.run(), 1);"), []);
  assert.deepEqual(exits("const f = async function named(a) {\n    return a;\n  };\n  assert.equal(await f(1), 1);"), []);
  assert.deepEqual(exits("await rolesLetIn(async (role) => {\n    const out = await run(role);\n    return out.status;\n  });\n  assert.equal(value, 1);"), []);
  // A nested function does not hide a return that sits after it, at the test's own level.
  assert.deepEqual(exits("const f = () => {\n    return 1;\n  };\n  return;\n  assert.equal(f(), 1);"), [TITLE]);
  // A property or method called return, break or continue is not a statement.
  assert.deepEqual(exits("assert.equal(thing.return, 1);\n  assert.equal(thing.break(), 1);"), []);
  // The words as parts of longer names are not statements either.
  assert.deepEqual(exits("const returned = 1;\n  const continued = 2;\n  assert.equal(returned + continued, 3);"), []);
});

test("an assertion that cannot fail does not make a test live; one with a real argument does", () => {
  const hollow = (body) => inspect(live(body)).hollow;
  for (const body of [
    "assert.ok(true);",
    "assert(true);",
    "assert.equal(1, 1);",
    'assert.equal("a", "a");',
    "assert.deepEqual([], []);",
    "assert.ok(1, 'always');",
    "assert.ok(true);\n  assert.equal(2, 2);",
    "assert.match('abc', /b/);",
  ]) {
    assert.deepEqual(hollow(body), [TITLE], body);
  }
  for (const body of [
    "assert.ok(value);",
    "assert.equal(out.status, 200);",
    "assert.equal(1, value);",
    "assert.ok(true);\n  assert.equal(out.status, 200);",
    "await assertNothingWritten(out, 'x');",
    "assert.fail('never reached');",
    "await assert.rejects(go());",
  ]) {
    assert.deepEqual(hollow(body), [], body);
  }
});

test("a constant-false condition is flagged as a switch", () => {
  for (const cond of ["false", "0", "null", "undefined"]) {
    const out = inspect(live(`if (${cond}) {\n    assert.equal(value, 1);\n  }`));
    assert.equal(out.markers.length, 1, cond);
  }
  assert.deepEqual(inspect(live("if (value) {\n    assert.equal(value, 1);\n  }")).markers, []);
});

test("every way of writing the callback is found and read", () => {
  const forms = [
    `test("${TITLE}", async () => {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", () => {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", async (t) => {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", async ({ name }) => {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", async function () {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", function named(a, b) {\n  assert.equal(value, 1);\n});\n`,
    `test("${TITLE}", t => {\n  assert.equal(value, 1);\n});\n`,
  ];
  for (const source of forms) assert.deepEqual(inspect(source), CLEAN, source);
  // Each of them is an early exit, and a hollow body, when the same way is used to cut it short.
  for (const source of forms) {
    const cut = source.replace("  assert.equal(value, 1);", "  return;\n  assert.equal(value, 1);");
    assert.deepEqual(inspect(cut).earlyExit, [TITLE], cut);
  }
});

test("ownLevelExits reads brackets, not indentation", () => {
  const src = "{\nif (a) {\n const f = () => { return 1; };\n}\nreturn;\n}";
  const open = src.indexOf("{");
  const close = src.lastIndexOf("}");
  assert.deepEqual(ownLevelExits(src, open, close), ["return"]);
  const nestedOnly = "{\nconst f = function () { return 1; };\nf();\n}";
  assert.deepEqual(ownLevelExits(nestedOnly, 0, nestedOnly.length - 1), []);
});

test("an assertion helper that was emptied, or made to return at once, is flagged; a working one is not", () => {
  const withHelper = (helper) => `${helper}\n${live("assertThing(out);")}`;
  const gutted = (helper) => inspect(withHelper(helper)).gutted;
  assert.deepEqual(gutted("function assertThing(out) {\n  assert.equal(out.status, 200);\n}"), []);
  assert.deepEqual(gutted("async function assertThing(out) {\n  const rows = await load(out);\n  assert.deepEqual(rows, []);\n}"), []);
  // Emptied.
  assert.deepEqual(gutted("function assertThing(out) {\n}"), ["assertThing"]);
  assert.deepEqual(gutted("function assertThing(out) {\n  const rows = out.rows;\n}"), ["assertThing"]);
  // Made to return before it asserts.
  assert.deepEqual(gutted("function assertThing(out) {\n  return;\n  assert.equal(out.status, 200);\n}"), ["assertThing"]);
  assert.deepEqual(gutted("function assertThing(out) {\n  if (out) return;\n  assert.equal(out.status, 200);\n}"), ["assertThing"]);
  // Reduced to a tautology.
  assert.deepEqual(gutted("function assertThing(out) {\n  assert.ok(true);\n}"), ["assertThing"]);
  // A nested function's own return is not the helper's.
  assert.deepEqual(gutted("function assertThing(rows) {\n  const ids = rows.map((row) => {\n    return row.id;\n  });\n  assert.deepEqual(ids, [1]);\n}"), []);
  // Only helpers declared at the top level are read; other functions are not held to it.
  assert.deepEqual(inspect(`function other() {\n  return 1;\n}\n${live()}`).gutted, []);
});
