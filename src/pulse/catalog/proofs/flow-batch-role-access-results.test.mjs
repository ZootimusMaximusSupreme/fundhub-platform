import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { extractAll, reaches } from "../../../../scripts/journeys/extract.mjs";
import { PROVEN_ROLE_ACCESS_SURFACES } from "./flow-gap-cases.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const ROWS = JSON.parse(fs.readFileSync(
  new URL("ops/workflows/coverage-every-surface-2026-10-10/journeys.json", ROOT),
  "utf8",
));

const ROLE_ROWS = Object.freeze(ROWS.filter((row) => (
  /#(?:reach-.+|stays-blocked)$/.test(String(row.surface || ""))
)));

const AREA_LABELS = Object.freeze({
  auth: "Signing in and out",
  banking: "banking",
  campaigns: "Campaigns",
  consent: "consent",
  contracts: "contracts",
  creative: "Creative Factory",
  dashboard: "The dashboard",
  documents: "Documents",
  finance: "Finance",
  hiring: "Hiring",
  journeys: "journeys",
  privacy: "privacy",
  read: "Reading data",
  "top level": "Everything else",
  webhooks: "Incoming webhooks",
});

function area(key) {
  const head = String(key).split("/")[0];
  return String(key).includes("/") ? head : "top level";
}

function groupCounts(endpoints) {
  const out = new Map();
  for (const endpoint of endpoints) {
    const key = area(endpoint.key);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

function reachControl(journeyName, key, count) {
  const label = AREA_LABELS[key] || key;
  return `${journeyName} should be able to reach: ${label} (${count} route${count === 1 ? "" : "s"})`;
}

function blockedControl(journeyName, endpoints) {
  const counts = [...groupCounts(endpoints)].sort(([a], [b]) => a.localeCompare(b));
  const total = endpoints.length;
  const parts = counts.map(([key, count]) => `${AREA_LABELS[key] || key} (${count})`);
  return `${journeyName} should stay blocked from ${total} routes: ${parts.join(", ")}`;
}

test("only exact intended-to-live role gates receive deep proof", () => {
  assert.equal(ROLE_ROWS.length, 90);
  assert.equal(PROVEN_ROLE_ACCESS_SURFACES.size, 40);

  const model = extractAll();
  assert.equal(model.counts.unverified, 0, "an unverified live gate cannot be called proved");

  for (const row of ROLE_ROWS) {
    const match = /^journey:(.+)-intended#(.+)$/.exec(row.surface);
    assert.ok(match, row.surface);
    const [, journeyName, step] = match;
    const journey = model.journeys.find((item) => item.name === journeyName);
    assert.ok(journey, row.surface);

    const admitted = [];
    const refused = [];
    for (const endpoint of model.endpoints) {
      const decision = reaches(journey, endpoint.gate);
      assert.notEqual(decision.reachable, null, `${row.surface}: ${endpoint.key}`);
      (decision.reachable ? admitted : refused).push(endpoint);
    }

    let actual;
    if (step === "stays-blocked") {
      actual = blockedControl(journeyName, refused);
    } else {
      const slug = step.slice("reach-".length);
      const areaKey = Object.entries(AREA_LABELS)
        .find(([, label]) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug)?.[0];
      assert.ok(areaKey, `${row.surface}: unknown area`);
      const inArea = admitted.filter((endpoint) => area(endpoint.key) === areaKey);
      actual = reachControl(journeyName, areaKey, inArea.length);
    }

    assert.equal(
      PROVEN_ROLE_ACCESS_SURFACES.has(row.surface),
      actual === row.control,
      `${row.surface}: proof list must match the live gate result`,
    );
  }
});
