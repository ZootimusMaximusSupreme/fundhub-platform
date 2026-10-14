import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as fundingTruth from "./trip-funding-truth.mjs";
import * as partnerTruth from "./trip-partner-truth.mjs";
import * as fundingCoverage from "../../coverage/gap-trip-funding.mjs";
import * as partnerCoverage from "../../coverage/gap-trip-partner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTS = ["trip-funding-truth.mjs", "trip-partner-truth.mjs"];
const IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

test("daily and hourly trip checks share the same SQL and verdict functions", () => {
  assert.equal(fundingCoverage.TRIP_SQL, fundingTruth.TRIP_SQL);
  assert.equal(fundingCoverage.judgeFunding, fundingTruth.judgeFunding);
  assert.equal(partnerCoverage.AFFILIATE_SQL, partnerTruth.AFFILIATE_SQL);
  assert.equal(partnerCoverage.PARTNER_SQL, partnerTruth.PARTNER_SQL);
  assert.equal(partnerCoverage.judgePartner, partnerTruth.judgePartner);
});

test("trip truth import closure stays inside beats/lib", () => {
  const seen = new Set();
  const visit = (file) => {
    const full = path.resolve(HERE, file);
    assert.equal(full.startsWith(`${HERE}${path.sep}`), true, `${file} left beats/lib`);
    if (seen.has(full)) return;
    seen.add(full);
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      assert.equal(spec.startsWith("./"), true, `${path.basename(full)} imports ${spec}`);
      visit(spec);
    }
  };
  for (const file of STARTS) visit(file);
  assert.deepEqual(
    [...seen].map((file) => path.basename(file)).sort(),
    ["trip-funding-truth.mjs", "trip-partner-sql.mjs", "trip-partner-truth.mjs", "trip-truth-kit.mjs"]
  );
});
