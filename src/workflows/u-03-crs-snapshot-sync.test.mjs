import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./u-03-crs-snapshot-sync.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: CRS-sourced analysis.completed syncs the snapshot fields", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 640 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
  assert.equal(db.clients[0].custom_fields.crs_fico_score, 640);
  assert.deepEqual(db.clients[0].tags, ["crs:snapshot"]);
  assert.equal(res.ax07.fired, false);
});

test("branch: non-CRS source (e.g. analyzer estimate) is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_crs_source");
});

// CB-11 / R18. A rehearsal pull (crs-pull `simulate: true`) emits a real
// analysis.completed stamped simulated:true with every score null. It used to
// null the client's stored score, re-run the funding-pause check on a file with no
// negatives, and so reopen a paused gate.
const REHEARSAL = { source: "crs", simulated: true, scores: { ex: null, eq: null, tu: null }, crsResultId: "crs-rehearsal" };

test("CB-11: a rehearsal pull leaves the stored score, the snapshot fields and the pause alone", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1", org_id: "org-1", email: "a@b.com",
      tags: ["funding:paused"],
      custom_fields: {
        crs_fico_score: 702,
        crs_status: "Complete",
        crs_snapshot_date: "2026-10-01T00:00:00.000Z",
        crs_negative_baseline_set: true,
        crs_negative_keys: ["tl:1111:collection"],
        round_hold_reason: "funding_paused"
      }
    }],
    crsResults: [{ id: "crs-rehearsal", client_id: "cl-1", result: { simulated: true, tradelines: [] } }]
  });
  const before = JSON.stringify(db.clients[0]);
  const res = await handle({ event: ev("analysis.completed", REHEARSAL, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(db.clients[0].custom_fields.crs_fico_score, 702, "the stored score must survive a rehearsal");
  assert.equal(JSON.stringify(db.clients[0]), before, "nothing on the client may change");
  assert.equal(db.tasks.length, 0, "a rehearsal raises no task");
  assert.equal(res.done, false);
  assert.equal(res.reason, "simulated_no_file");
});

test("CB-11: a walkthrough file (simulated WITH an Experian score) still syncs the snapshot", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", simulated: true, scores: { ex: 771, eq: 778, tu: 766 } }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.crs_fico_score, 771);
  assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
});
