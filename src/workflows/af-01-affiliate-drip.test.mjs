import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sweep, SWEEP_CRON, af01AffiliateDrip } from "./af-01-affiliate-drip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("affiliate drip sweeper is registered and uses plus-tag SQL", () => {
  const index = fs.readFileSync(path.join(HERE, "index.mjs"), "utf8");
  assert.ok(/af01AffiliateDrip/.test(index));
  const drip = fs.readFileSync(path.join(HERE, "../affiliates/drip.mjs"), "utf8");
  assert.match(drip, /\+aff-/);
  assert.match(drip, /\+sim-/);
});

test("cron is a bounded sweep, not a 12-email sequence", () => {
  assert.equal(SWEEP_CRON, "20 * * * *");
  assert.equal(af01AffiliateDrip.id(), "af-01-affiliate-drip");
});

test("a broken database is reported, not thrown", async () => {
  const db = { query: async () => { throw new Error("connection refused"); } };
  const res = await sweep(db);
  assert.equal(res.ok, false);
  assert.match(res.error, /connection refused/);
});
