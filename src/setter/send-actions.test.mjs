import test from "node:test";
import assert from "node:assert/strict";
import { buildSetterHandoffText, hasSetterIntroVideo, performSetterSendAction } from "./send-actions.mjs";

test("intro video remains unavailable until a public HTTPS URL is configured", () => {
  assert.equal(hasSetterIntroVideo({}), false);
  assert.equal(hasSetterIntroVideo({ SETTER_INTRO_VIDEO_URL: "http://example.com/intro.mp4" }), false);
  assert.equal(hasSetterIntroVideo({ SETTER_INTRO_VIDEO_URL: "https://example.com/intro.mp4" }), true);
});

const client = { client_id: "client-1", first_name: "Jane", phone: "+15555550123",
  booking_time: "2026-10-28T18:00:00Z", custom_fields: { cf_svy_planned_use_label: "equipment" } };
const handoff = { complete_at: "2026-10-27T02:00:00Z", problem: "Old equipment",
  goal: "Buy equipment", computer_ready: true };
const owner = { id: "staff-chris", role: "owner", name: "Chris Stanbridge" };

test("SOP handoff uses saved problem, goal, survey, and booked time", () => {
  const body = buildSetterHandoffText({ client, handoff, setter: owner, closer: owner });
  assert.match(body, /Buy equipment/);
  assert.match(body, /Old equipment/);
  assert.match(body, /equipment/);
  assert.match(body, /Chris at Fundhub/);
  assert.doesNotMatch(body, /maybe|we think/i);
});

test("SOP handoff prefers setter edits while preserving the submitted survey", () => {
  const withEdit = { ...client, custom_fields: { ...client.custom_fields,
    cf_svy_money_change_now_label: "grow faster",
    setter_survey_edits: { cf_svy_planned_use: "hire staff" } } };
  const body = buildSetterHandoffText({ client: withEdit, handoff, setter: owner, closer: owner });
  assert.match(body, /Survey said hire staff/);
  assert.doesNotMatch(body, /Survey said equipment/);
  assert.doesNotMatch(body, /Survey said grow faster/);
  assert.equal(withEdit.custom_fields.cf_svy_planned_use_label, "equipment");
});

test("Chris as setter and closer sends only the lead leg", async () => {
  const calls = [];
  const result = await performSetterSendAction({ action: "send_handoff", client, handoff,
    staff: owner, db: {}, orgId: "org-1", setterStaffId: owner.id,
    closerStaffId: owner.id,
    sendLeadImpl: async (_db, args) => { calls.push(["lead", args]);
      return { outcome: "sent", message: { id: "lead-msg", status: "sent" } }; },
    sendCloserImpl: async () => { calls.push(["closer"]); throw new Error("self text"); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "lead");
  assert.doesNotMatch(calls[0][1].body, /Old equipment|Buy equipment/);
  assert.equal(result.same_staff, true);
  assert.ok(result.handoffPatch.handoff_sent_at);
});

test("different closer gets a separate SMS after the lead", async () => {
  const calls = [];
  const result = await performSetterSendAction({ action: "send_handoff", client, handoff,
    staff: owner, db: { async query() { return { rows: [{ id: "staff-closer", name: "Alex",
      phone: "+15555550234", status: "active" }] }; } }, orgId: "org-1",
    setterStaffId: owner.id, closerStaffId: "staff-closer",
    sendLeadImpl: async (_db, args) => { calls.push(["lead", args.body]); return { outcome: "sent", message: { id: "lead" } }; },
    sendCloserImpl: async (_db, args) => { calls.push(["closer", args.body]); return { outcome: "sent", message: { id: "closer" } }; }
  });
  assert.deepEqual(calls.map((entry) => entry[0]), ["lead", "closer"]);
  assert.doesNotMatch(calls[0][1], /Old equipment|Buy equipment/);
  assert.match(calls[1][1], /Old equipment/);
  assert.match(calls[1][1], /Buy equipment/);
  assert.equal(result.same_staff, false);
  assert.ok(result.handoffPatch.handoff_sent_at);
});

test("video button requires HTTPS URL and records only a real send", async () => {
  await assert.rejects(performSetterSendAction({ action: "send_intro_video", client, handoff,
    staff: owner, db: {}, orgId: "org-1", env: { SETTER_INTRO_VIDEO_URL: "http://bad" } }), /HTTPS/);
  const result = await performSetterSendAction({ action: "send_intro_video", client, handoff,
    staff: owner, db: {}, orgId: "org-1", env: { SETTER_INTRO_VIDEO_URL: "https://fundhub.ai/intro.mp4" },
    sendLeadImpl: async () => ({ outcome: "deferred", message: { id: "held", status: "queued" } }) });
  assert.equal(result.handoffPatch.video_sent_at, undefined);
});
