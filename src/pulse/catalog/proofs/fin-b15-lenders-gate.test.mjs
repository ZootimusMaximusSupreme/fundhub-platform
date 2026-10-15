// Practice test (fake data, stand-in database, the real api/ handlers) for the Lenders desk row
//   "Page gate: owner, admin, funding_advisor only (read + write endpoints return 403 to every
//    other role)".
//
// The page itself has no role check; the four endpoints behind it are the gate. Each one is called
// as every kind of sign-in (owner, admin, sales manager, closer, funding advisor, inquiry
// specialist, CSM, setter, partner, client). Owner, admin and funding advisor get through; every
// other role is refused with a 403 before a single row is read or written.
//
// api/read/lender-matches.mjs (the "which lenders fit this client" box on the closer dashboard) is a
// different feature and stays open to every staff role on purpose; it is held here too so the line
// between the two cannot move quietly.

import assert from "node:assert/strict";
import test from "node:test";

import readLenders from "../../../../api/read/lenders.mjs";
import writeLenders from "../../../../api/lenders.mjs";
import readObservations from "../../../../api/read/lender-observations.mjs";
import writeObservations from "../../../../api/lender-observations.mjs";
import writeBureauConfig from "../../../../api/ai-bureau-config.mjs";
import { assertRoleGate, hit } from "./s5-route-kit.mjs";

const ALLOWED = ["owner", "admin", "funding_advisor"];

test("GET /api/read/lenders: only owner, admin and funding advisor are let in", async () => {
  await assertRoleGate(readLenders, ALLOWED, { method: "GET" });
});

test("POST /api/lenders: only owner, admin and funding advisor are let in", async () => {
  await assertRoleGate(writeLenders, ALLOWED, { method: "POST", body: {} });
});

test("GET /api/read/lender-observations (the mismatch queue read): same three roles", async () => {
  await assertRoleGate(readObservations, ALLOWED, { method: "GET", query: { mismatch_only: "true", review_status: "pending" } });
});

test("POST /api/lender-observations (Dismiss, Confirm, Corrected): same three roles", async () => {
  await assertRoleGate(writeObservations, ALLOWED, { method: "POST", body: { action: "review" } });
});

test("POST /api/ai-bureau-config (the AI bureau tab save): same three roles", async () => {
  await assertRoleGate(writeBureauConfig, ALLOWED, { method: "POST", body: {} });
});

test("a signed-out caller is refused with 401 and nothing is read", async () => {
  for (const [handler, method] of [[readLenders, "GET"], [writeLenders, "POST"], [readObservations, "GET"], [writeObservations, "POST"]]) {
    const out = await hit(handler, { method, anonymous: true, body: {} });
    assert.equal(out.status, 401);
    assert.equal(out.db.calls.length, 0);
  }
});
