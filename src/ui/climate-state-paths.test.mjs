import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { judgeClimateReading } from "../pulse/catalog/proofs/fin-b22-page-reads.mjs";

const PATHS = new URL("../../public/climate/maps/us-states-paths.json", import.meta.url);

test("the climate map has a distinct real outline for every state and DC", async () => {
  const paths = JSON.parse(await readFile(PATHS, "utf8"));
  const outlines = new Map(Object.entries(paths));
  const now = new Date("2026-10-18T18:00:00.000Z");
  const result = judgeClimateReading({
    now,
    outlines,
    api: {
      ok: true,
      as_of: now.toISOString(),
      national: { score: 50 },
      states: Object.keys(paths).map((state) => ({ state, score: 50, color: "#58d7b8" }))
    }
  });

  assert.equal(Object.keys(paths).length, 51);
  assert.equal(result.status, "PASS", result.detail);
});
