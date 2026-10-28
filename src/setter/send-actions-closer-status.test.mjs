// Do not leak an appointment and the customer's stated funding problem
// to a former or suspended closer left on a stale booking assignment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performSetterSendAction } from "./send-actions.mjs";

const orgId = "org-current";
const staff = { id: "setter-current", role: "setter", name: "Jane Setter" };
const client = {
  id: "client-current", first_name: "Buyer", phone: "+15555550123",
  booking_time: "2026-10-28T18:00:00Z"
};
const handoff = {
  complete_at: "2026-10-27T02:00:00Z",
  goal: "Equipment", problem: "Cash flow"
};

for (const status of ["inactive", "suspended", null]) {
  test(`a stale closer (${String(status)}) receives no lead or staff message`, async () => {
    let sends = 0;
    const reads = [];
    const db = {
      query: async (sql, params) => {
        reads.push({ sql, params });
        return { rows: [{
          id: "former-closer", name: "Former Closer",
          phone: "+15555550999", status
        }] };
      }
    };
    await assert.rejects(
      () => performSetterSendAction({
        action: "send_handoff", client, handoff, staff, db, orgId,
        closerStaffId: "former-closer",
        sendLeadImpl: async () => { sends += 1; throw new Error("should not send lead"); },
        sendCloserImpl: async () => { sends += 1; throw new Error("should not send staff"); }
      }),
      /closer staff assignment is not active/
    );
    assert.equal(sends, 0, "do not send even the first leg before validating staff assignment");
    assert.equal(reads.length, 1);
    assert.match(reads[0].sql, /FROM staff WHERE org_id = \$1 AND id = \$2/);
    assert.deepEqual(reads[0].params, [orgId, "former-closer"]);
  });
}

test("an active, org-owned closer still receives the two separate handoff legs", async () => {
  const sent = [];
  const db = { query: async () => ({
    rows: [{ id: "active-closer", name: "Active Closer", phone: "+15555550999", status: "active" }]
  }) };
  const result = await performSetterSendAction({
    action: "send_handoff", client, handoff, staff, db, orgId,
    closerStaffId: "active-closer",
    sendLeadImpl: async () => { sent.push("lead"); return { outcome: "sent", message: { id: "lead" } }; },
    sendCloserImpl: async () => { sent.push("closer"); return { outcome: "sent", message: { id: "closer" } }; }
  });
  assert.deepEqual(sent, ["lead", "closer"]);
  assert.ok(result.handoffPatch.handoff_sent_at);
});

test("an inactive closer also blocks the intro-video action before any send", async () => {
  let sends = 0;
  const db = { query: async () => ({
    rows: [{ id: "former-closer", name: "Former Closer", phone: "+15555550999", status: "inactive" }]
  }) };
  await assert.rejects(
    () => performSetterSendAction({
      action: "send_intro_video", client, handoff, staff, db, orgId,
      closerStaffId: "former-closer",
      env: { SETTER_INTRO_VIDEO_URL: "https://fundhub.ai/intro.mp4" },
      sendLeadImpl: async () => { sends += 1; }
    }),
    /closer staff assignment is not active/
  );
  assert.equal(sends, 0);
});

for (const phone of [null, "", "5551231234", "+0123456789"]) {
  test(`a closer with a malformed phone (${String(phone)}) causes zero partial handoff sends`, async () => {
    let sends = 0;
    const db = { query: async () => ({
      rows: [{ id: "active-closer", name: "Active Closer", phone, status: "active" }]
    }) };
    await assert.rejects(
      () => performSetterSendAction({
        action: "send_handoff", client, handoff, staff, db, orgId,
        closerStaffId: "active-closer",
        sendLeadImpl: async () => { sends += 1; },
        sendCloserImpl: async () => { sends += 1; }
      }),
      /closer phone is missing or invalid/
    );
    assert.equal(sends, 0, "a bad closer number must not produce a buyer-only handoff");
  });
}
