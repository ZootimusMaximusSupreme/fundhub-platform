// The bundled ad-strategy doctrine is word for word from the repo files it
// names (unit X3). A change to a source file must be made here too, or this fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STRATEGY_PICK, HAMMER_THEM, DRIVE_SOPS, NAMED_STRATEGIES, STRATEGY_DOCTRINE, DOCTRINE_SOURCES } from "./doctrine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("every excerpt is still in its source file, word for word", () => {
  const asc = read("marketing/ads/ascension/ascension-ads.md");
  assert.ok(asc.includes(STRATEGY_PICK), "ascension-ads.md §1 changed: regenerate doctrine.mjs");
  assert.ok(asc.includes(HAMMER_THEM), "ascension-ads.md §5 changed: regenerate doctrine.mjs");
  const index = read("marketing/copy/Drive-Source-Index.md");
  for (const line of DRIVE_SOPS) assert.ok(index.includes(line), `Drive-Source-Index.md lost: ${line}`);
  const partner = read("marketing/flywheel/partner/05-ad-strategy.md");
  assert.ok(partner.includes("Venus Fly Trap 1.0 and 2.0 and the Tornado"));
  assert.ok(partner.includes("The Harvester") && partner.includes("Hammer Them") && partner.includes("The Forester"));
  for (const p of DOCTRINE_SOURCES) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
});

test("the block the plans read names its limits and every named strategy", () => {
  assert.match(STRATEGY_DOCTRINE, /they are UNKNOWN here: say so, and do not fill them in from memory/);
  assert.match(STRATEGY_DOCTRINE, /written for the Ascension funnel/);
  for (const s of NAMED_STRATEGIES) assert.ok(STRATEGY_DOCTRINE.includes(s), s);
  assert.equal(NAMED_STRATEGIES.length, 6);
});
