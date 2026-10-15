// The reader the batch 05 guard uses to decide that a named test is a live test.
// It has to go RED for every way a test can be switched off while the suite still
// exits 0, and it must not cry wolf over ordinary test code.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { blankComments, inspectNamedTests } from "./fin-b05-test-binding.mjs";

const TITLE = "the named test";
const live = (body = "assert.equal(1, 1);") => `import test from "node:test";\n\ntest("${TITLE}", async () => {\n  ${body}\n});\n`;
const inspect = (source, titles = [TITLE]) => inspectNamedTests(source, titles);

test("a live top-level test with an assertion is found, with nothing flagged", () => {
  assert.deepEqual(inspect(live()), { missing: [], hollow: [], markers: [] });
});

test("a test switched off with .skip, .todo or .only is not live", () => {
  for (const word of ["skip", "todo", "only"]) {
    const source = `test.${word}("${TITLE}", async () => {\n  assert.equal(1, 1);\n});\n`;
    const out = inspect(source);
    assert.deepEqual(out.missing, [TITLE], word);
    assert.equal(out.markers.length, 1, word);
  }
});

test("a test switched off with an options object is not live", () => {
  const source = `test("${TITLE}", { skip: true }, async () => {\n  assert.equal(1, 1);\n});\n`;
  const out = inspect(source);
  assert.deepEqual(out.missing, [TITLE]);
  assert.ok(out.markers.length > 0);
  const todo = inspect(`test("${TITLE}", { todo: "later" }, async () => {\n  assert.equal(1, 1);\n});\n`);
  assert.deepEqual(todo.missing, [TITLE]);
});

test("a title that only survives in a comment is not a test", () => {
  const line = `import test from "node:test";\n// test("${TITLE}", async () => {\n//   assert.equal(1, 1);\n// });\n`;
  assert.deepEqual(inspect(line).missing, [TITLE]);
  const block = `/*\ntest("${TITLE}", async () => {\n  assert.equal(1, 1);\n});\n*/\n`;
  assert.deepEqual(inspect(block).missing, [TITLE]);
  const renamed = live().replace(`test("${TITLE}"`, `test("a new title"`) + `// was: test("${TITLE}", async () => {\n`;
  assert.deepEqual(inspect(renamed).missing, [TITLE]);
});

test("a title that only appears inside a string, or in a test nested under a condition or a group, is not a test", () => {
  assert.deepEqual(inspect(`const names = ["${TITLE}"];\n`).missing, [TITLE]);
  // Indented under an if.
  assert.deepEqual(inspect(`if (process.env.RUN_IT) {\n  test("${TITLE}", async () => {\n    assert.ok(true);\n  });\n}\n`).missing, [TITLE]);
  // Still at column 0 but inside the block: depth, not indentation, decides.
  assert.deepEqual(inspect(`if (process.env.RUN_IT) {\ntest("${TITLE}", async () => {\n  assert.ok(true);\n});\n}\n`).missing, [TITLE]);
  assert.deepEqual(inspect(`describe("group", () => {\ntest("${TITLE}", async () => {\n  assert.ok(true);\n});\n});\n`).missing, [TITLE]);
  // A real top-level test after a block that closed is live again.
  const after = `if (a) {\n  doIt();\n}\ntest("${TITLE}", async () => {\n  assert.ok(true);\n});\n`;
  assert.deepEqual(inspect(after), { missing: [], hollow: [], markers: [] });
  // A bracket in a string or a regex does not shift the depth.
  const quirky = `const a = "}}}";\nconst b = /[}\\]]/;\nconst c = \`\${"{"}\`;\ntest("${TITLE}", async () => {\n  assert.ok(true);\n});\n`;
  assert.deepEqual(inspect(quirky), { missing: [], hollow: [], markers: [] });
});

test("a test that asserts nothing is hollow, and one that asserts through a helper is not", () => {
  assert.deepEqual(inspect(live("const x = 1;")).hollow, [TITLE]);
  assert.deepEqual(inspect(live("await assertNothingWritten(out, 'x');")).hollow, []);
});

test("a run that ends the process early is flagged", () => {
  assert.deepEqual(inspect(`process.exit(0);\n${live()}`).markers, ["process.exit"]);
});

test("words inside a title or a string are not mistaken for a switched-off test", () => {
  const body = `test("answers only POST: only after Round 4 skip: todo: process.exit", async () => {\n  assert.equal("only: skip:", "only: skip:");\n});\n`;
  const out = inspect(body, ["answers only POST: only after Round 4 skip: todo: process.exit"]);
  assert.deepEqual(out, { missing: [], hollow: [], markers: [] });
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
  assert.deepEqual(inspectNamedTests(source, titles), { missing: [], hollow: [], markers: [] });
});
