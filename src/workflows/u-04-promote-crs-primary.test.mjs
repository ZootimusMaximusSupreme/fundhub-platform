import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./u-04-promote-crs-primary.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: CRS result promotes to primary, removes the analyzer-primary tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["primary:analyzer"], custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 700 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "CRS");
  assert.equal(db.clients[0].tags.includes("primary:analyzer"), false);
});

test("branch: analyzer-only source does not promote", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

// CB-11 / R18. A rehearsal pull (crs-pull `simulate: true`) emits a real
// analysis.completed stamped simulated:true with every score null. It used to null
// primary_fico_score and strip the analyzer-primary tag.
test("CB-11: a rehearsal pull leaves the primary score, source and analyzer tag alone", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1", org_id: "org-1", email: "a@b.com",
      tags: ["primary:analyzer"],
      custom_fields: { primary_fico_score: 688, primary_snapshot_source: "Analyzer" }
    }]
  });
  const before = JSON.stringify(db.clients[0]);
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", simulated: true, scores: { ex: null, eq: null, tu: null } }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(db.clients[0].custom_fields.primary_fico_score, 688, "the stored score must survive a rehearsal");
  assert.equal(JSON.stringify(db.clients[0]), before, "nothing on the client may change");
  assert.equal(res.done, false);
  assert.equal(res.reason, "simulated_no_file");
});

test("CB-11: a walkthrough file (simulated WITH an Experian score) is still promoted", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["primary:analyzer"], custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", simulated: true, scores: { ex: 771, eq: 778, tu: 766 } }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.primary_fico_score, 771);
  assert.equal(db.clients[0].tags.includes("primary:analyzer"), false);
});
