// THE STAFF GALAXY INVENTS NO MONEY — walkthrough-4 defect 4 (2026-09-06).
//
// galaxy.html (the owner's and staff's own Galaxy) kept the dice the owner
// ruled off partner-galaxy.html on 2026-08-19 (T10-02): a scheduled evMoney()
// rolled "+$18,500 ROUND FUNDED" over a real staff member, wrote it into their
// timeline and added it to the real Cash collected / Funded today tiles. The
// rail pulses also put a real client's name on a randomly picked stage and
// added 1 to the real "Deposits" count each time. The sky stays; the made-up
// facts go. Mirrors src/http/partner-galaxy-tiles.test.mjs for the partner sky.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = fs.readFileSync(path.join(ROOT, "public/app/galaxy.html"), "utf8");
// Comments may name what was removed; only running code counts.
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

function fnBody(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.ok(start !== -1, name + "() is gone");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name + "() never closes");
}

test("no evMoney, and no scheduler runs one", () => {
  assert.ok(!/function\s+evMoney\s*\(/.test(CODE), "evMoney() is back");
  assert.ok(!/fn\s*:\s*evMoney/.test(CODE), "a scheduler lists evMoney again");
});

test("no dice-rolled dollar amount and no money legend", () => {
  assert.ok(!/8500\s*\+\s*Math\.round\(Math\.random\(\)/.test(CODE));
  assert.ok(!/3000\s*\+\s*\(Math\.random\(\)/.test(CODE));
  assert.ok(!/money landing/i.test(CODE));
  assert.ok(!/'Round funded'|'Deposit paid'/.test(CODE));
});

test("a rail pulse carries no client name and never bumps the real Deposits count", () => {
  const body = fnBody(CODE, "evMove");
  assert.ok(!/CLIENTS\)/.test(body.replace(/!CLIENTS\.length/, "")), "evMove picks a client name again");
  assert.ok(!/bumpKPI\(\s*'move'/.test(body), "evMove adds to the server's Deposits figure again");
});
