import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(here, "../../public/app/phone-format.js"), "utf8");
const window = {};
runInNewContext(source, { window });

test("CRM phone labels format US numbers and preserve other values", () => {
  const format = window.FHFormatPhone;
  assert.equal(format("+14702920106"), "(470) 292-0106");
  assert.equal(format("4702920106"), "(470) 292-0106");
  assert.equal(format("1 (470) 292-0106"), "(470) 292-0106");
  assert.equal(format("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(format("4702920106 ext 42"), "(470) 292-0106 ext 42");
  assert.equal(format("+1 602-555-0102 ext. 42"), "(602) 555-0102 ext. 42");
  assert.equal(format("579"), "579");
  assert.equal(format(null), "");
});
