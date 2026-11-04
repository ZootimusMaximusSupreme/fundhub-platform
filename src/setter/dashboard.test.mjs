import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { sanitizeHandoffPatch, sanitizeSetterResidentialAddress, missingForCompletion, updateSetterHandoff, listSetterQueue, setterNumbers, targetDialBy, surveySummary, latestUndoableDial } from "./dashboard.mjs";

const STAFF = { id: "staff-1", org_id: "org-1", role: "owner", name: "Chris" };
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const ADDRESS_TEST_DB = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const COMPLETE_SURVEY = {
  cf_svy_funding_target_amount: "$100k - $200k",
  cf_svy_planned_use: "Equipment or buildout",
  cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"],
  cf_svy_has_business: "No, personal funding only",
  cf_svy_annual_income_range: "$100k-$199k",
  cf_svy_income_verifiable: "Yes, W-2 or tax returns",
  cf_svy_available_capital: "$5k - $9,999"
};

test("survey summary shows nested ClickFunnels choices as readable answers", () => {
  const answers = surveySummary({
    cf_svy_money_change_now_labels: '["[\\"Grow faster (more customers / more reach)\\"]"]',
    cf_svy_planned_use: "Not sure yet"
  });
  const motivation = answers.find(row => row.key === "cf_svy_money_change_now");
  assert.equal(motivation.question, "What Would This Money Change Right Now?");
  assert.equal(motivation.answer, "Grow faster (more customers / more reach)");
  assert.deepEqual(motivation.answer_values, ["Grow faster (more customers / more reach)"]);
  assert.equal(motivation.type, "multi");
  assert.ok(motivation.options.includes("Grow faster (more customers / more reach)"));
  assert.equal(answers.find(row => row.key === "cf_svy_planned_use").answer, "Not sure yet");
  assert.equal(surveySummary({ cf_svy_money_change_now_labels: '["Growth","Stability"]' })[0].answer, "Growth, Stability");
  assert.equal(surveySummary({ cf_svy_money_change_now_labels: "[custom answer" })[0].answer, "[custom answer");
});

function completeHandoff() {
  return { dialed_at: "2026-10-26T20:00:00Z", call_attempts: 1, disposition: "reached",
    time_confirmed: true, frame_warmed: true, problem: "Needs working capital",
    goal: "Open a second location", computer_ready: true, app_on_phone: false };
}

function fakeDb(booked = true) {
  const client = { client_id: CLIENT_ID, first_name: "Pat", last_name: "Lee", phone: "+15551234567",
    email: "pat@example.com", custom_fields: {}, booked_at: booked ? "2026-10-26T19:00:00Z" : null,
    booking_time: booked ? "2026-10-28T19:00:00Z" : null, closer_staff_id: STAFF.id,
    qualification_bucket: null };
  const bookings = [];
  const queries = [];
  const db = { async query(sql, params) {
    queries.push(sql);
    // A copy, as a real read returns: the row the writes below change is `client`, and the
    // copy the code holds is what the row looked like when it was read.
    if (sql.includes("SELECT id FROM clients WHERE") && sql.includes("FOR UPDATE")) return { rows: [{ id: client.client_id }] };
    if (sql.includes("FROM clients c")) return { rows: [structuredClone(client)] };
    if (sql.includes("SELECT custom_fields FROM clients")) return { rows: [{ custom_fields: structuredClone(client.custom_fields) }] };
    if (sql.includes("SELECT id, name FROM staff")) return { rows: [{ id: "staff-2", name: "Closer" }] };
    if (sql.includes("UPDATE clients")) {
      if (sql.includes("qualification_bucket")) {
        client.qualification_bucket = params[1];
        return { rows: [] };
      }
      if (sql.includes("'credit_tier'")) {
        client.custom_fields.credit_tier = params[2];
        return { rows: [] };
      }
      if (sql.includes("'{setter_survey_edits}'")) {
        client.custom_fields.setter_survey_edits = JSON.parse(params[2]);
        return { rows: [{ survey_edits: client.custom_fields.setter_survey_edits }] };
      }
      if (sql.includes("'{setter_residential_address}'")) {
        if (client.custom_fields.setter_residential_address) {
          client.custom_fields.setter_residential_address_history = [
            ...(client.custom_fields.setter_residential_address_history || []),
            client.custom_fields.setter_residential_address
          ];
        }
        client.custom_fields.setter_residential_address = JSON.parse(params[2]);
        return { rows: [{ address: client.custom_fields.setter_residential_address }] };
      }
      if (params[3] != null && Number(client.custom_fields.setter_handoff?.call_attempts || 0) !== params[3]) {
        return { rows: [] };
      }
      client.custom_fields.setter_handoff = { ...(client.custom_fields.setter_handoff || {}), ...JSON.parse(params[2]) };
      return { rows: [{ custom_fields: client.custom_fields }] };
    }
    if (sql.includes("UPDATE bookings SET qualification_bucket")) {
      for (const booking of bookings) if (booking.qualification_bucket == null) booking.qualification_bucket = params[1];
      return { rows: [] };
    }
    if (sql.includes("UPDATE tasks")) return { rows: [] };
    if (sql.includes("UPDATE setter_dial_events")) return { rows: [] };
    if (sql.includes("UPDATE cards")) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  return { db, client, bookings, queries };
}

test("handoff input refuses unsupported claims and keeps only checklist fields", () => {
  assert.match(sanitizeHandoffPatch({ goal: "Pre-approved for $100,000" }).error, /unsupported/);
  assert.match(sanitizeHandoffPatch({ problem: "SSN 123-45-6789" }).error, /unsupported/);
  assert.deepEqual(sanitizeHandoffPatch({ goal: "Growth", disposition_at: "2099-01-01T00:00:00Z" }).patch, { goal: "Growth" });
});

test("setter home address needs a complete residence confirmed by the lead", () => {
  const full = { line1: "123 Main St", line2: "Unit 2", city: "Phoenix", state: "az", zip: "85001", confirmed: true };
  assert.deepEqual(sanitizeSetterResidentialAddress(full).address, {
    line1: "123 Main St", line2: "Unit 2", city: "Phoenix", state: "AZ", zip: "85001"
  });
  for (const invalid of [
    { ...full, confirmed: false }, { ...full, line1: "PO Box 22" },
    { ...full, city: "" }, { ...full, state: "Arizona" }, { ...full, zip: "8500" }
  ]) assert.ok(sanitizeSetterResidentialAddress(invalid).error);
});

test("setter address save preserves the survey, the prior address, and an unchanged retry", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  const input = { client_id: CLIENT_ID, action: "save_address",
    address: { line1: "123 Main St", line2: "", city: "Phoenix", state: "AZ", zip: "85001", confirmed: true } };
  const first = await updateSetterHandoff(db, STAFF, input, { now: () => new Date("2026-11-02T20:00:00Z") });
  assert.equal(first.status, 200);
  assert.equal(first.body.address.source, "setter_confirmed");
  assert.equal(first.body.address.confirmed_by_staff_id, STAFF.id);
  assert.equal(client.custom_fields.cf_svy_planned_use_label, "Open a shop");
  assert.equal(client.custom_fields.setter_residential_address_history, undefined);
  const repeat = await updateSetterHandoff(db, STAFF, input, { now: () => new Date("2026-11-02T21:00:00Z") });
  assert.equal(repeat.body.address.confirmed_at, first.body.address.confirmed_at);
  input.address.line1 = "456 Oak Ave";
  const changed = await updateSetterHandoff(db, STAFF, input, { now: () => new Date("2026-11-02T22:00:00Z") });
  assert.equal(changed.body.address.line1, "456 Oak Ave");
  assert.equal(client.custom_fields.setter_residential_address_history[0].line1, "123 Main St");
  assert.equal(client.custom_fields.setter_residential_address_history.length, 1);
});

test("setter address save claims the locked newest task and rejects changed or saved ownership", async () => {
  const setter = { ...STAFF, role: "setter" };
  const input = { client_id: CLIENT_ID, action: "save_address",
    address: { line1: "123 Main St", line2: "", city: "Phoenix", state: "AZ", zip: "85001", confirmed: true } };
  for (const mode of ["unclaimed", "reassigned", "handoff"]) {
    const { db, client, queries } = fakeDb();
    if (mode === "handoff") client.custom_fields.setter_handoff = { setter_staff_id: "another-setter" };
    const original = db.query;
    let claimed = null;
    db.query = async (sql, params) => {
      if (sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")) return { rows: [{ assignee_staff_id: null }] };
      if (sql.trim().startsWith("SELECT id, assignee_staff_id FROM tasks")) {
        assert.match(sql, /ORDER BY created_at DESC LIMIT 1 FOR UPDATE/);
        return { rows: [{ id: "latest-task", assignee_staff_id: mode === "reassigned" ? "another-setter" : null }] };
      }
      if (sql.includes("UPDATE tasks SET assignee_staff_id")) {
        claimed = params;
        return { rows: [{ id: params[0] }] };
      }
      return original(sql, params);
    };
    const result = await updateSetterHandoff(db, setter, input);
    if (mode === "unclaimed") {
      assert.equal(result.status, 200);
      assert.deepEqual(claimed, ["latest-task", STAFF.org_id, CLIENT_ID, STAFF.id]);
      assert.equal(client.custom_fields.setter_residential_address.confirmed_by_staff_id, STAFF.id);
    } else {
      assert.equal(result.status, 403, mode);
      assert.equal(claimed, null);
      assert.equal(queries.some(sql => sql.includes("UPDATE clients")), false);
    }
  }
});

test("setter address JSONB, task claim and reload persist in scratch Postgres and roll back", {
  skip: !isLocalScratchDatabaseUrl(ADDRESS_TEST_DB)
}, async () => {
  const testPool = new pg.Pool({ connectionString: ADDRESS_TEST_DB });
  const writer = await testPool.connect();
  const slug = `setter-address-${randomUUID()}`;
  try {
    const role = (await writer.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    await writer.query("BEGIN");
    const org = (await writer.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic setter address') RETURNING id", [slug])).rows[0].id;
    const foreign = (await writer.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic foreign address') RETURNING id", [slug + "-foreign"])).rows[0].id;
    const staffId = (await writer.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id", [org])).rows[0].id;
    const otherStaffId = (await writer.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Other synthetic setter','setter','active') RETURNING id", [org])).rows[0].id;
    const clientId = (await writer.query(
      "INSERT INTO clients(org_id,first_name,email,is_demo,custom_fields) VALUES($1,'Synthetic',$2,true,$3::jsonb) RETURNING id",
      [org, `e2e+address-${randomUUID()}@example.test`, JSON.stringify({ cf_svy_planned_use_label: "Original survey", unrelated: { keep: true } })]
    )).rows[0].id;
    const taskId = (await writer.query("INSERT INTO tasks(org_id,client_id,title,assignee_role) VALUES($1,$2,'Synthetic address','setter') RETURNING id", [org, clientId])).rows[0].id;
    const staff = { id: staffId, org_id: org, role: "setter" };
    const address = { line1: "100 Synthetic Way", line2: "Unit 2", city: "Phoenix", state: "AZ", zip: "85001", confirmed: true };
    const input = { client_id: clientId, action: "save_address", address };
    const now = () => new Date("2026-11-02T20:00:00Z");
    const first = await updateSetterHandoff(writer, staff, input, { now });
    assert.equal(first.status, 200);
    assert.equal((await writer.query("SELECT assignee_staff_id FROM tasks WHERE id=$1", [taskId])).rows[0].assignee_staff_id, staffId);
    assert.equal(first.body.address.confirmed_by_staff_id, staffId);
    const repeat = await updateSetterHandoff(writer, staff, input, { now: () => new Date("2026-11-02T21:00:00Z") });
    assert.deepEqual(repeat.body.address, first.body.address);
    const changed = await updateSetterHandoff(writer, staff, { ...input, address: { ...address, line1: "200 Synthetic Way" } }, { now });
    assert.equal(changed.status, 200);
    const fields = (await writer.query("SELECT custom_fields FROM clients WHERE id=$1", [clientId])).rows[0].custom_fields;
    assert.deepEqual(fields.setter_residential_address_history, [first.body.address]);
    assert.equal(fields.setter_residential_address.line1, "200 Synthetic Way");
    assert.equal(fields.cf_svy_planned_use_label, "Original survey");
    assert.deepEqual(fields.unrelated, { keep: true });
    const reloaded = await listSetterQueue(writer, staff, { client_id: clientId });
    assert.equal(reloaded.items[0].residential_address.line1, "200 Synthetic Way");
    assert.equal((await updateSetterHandoff(writer, { ...staff, org_id: foreign }, input)).status, 404);
    await writer.query("UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{setter_handoff}',$2::jsonb) WHERE id=$1", [clientId, JSON.stringify({ setter_staff_id: otherStaffId })]);
    assert.equal((await updateSetterHandoff(writer, staff, input)).status, 403);
  } finally {
    try {
      await writer.query("ROLLBACK");
      assert.equal(Number((await writer.query("SELECT count(*) AS n FROM orgs WHERE slug=$1 OR slug=$2", [slug, slug + "-foreign"])).rows[0].n), 0);
    } finally {
      writer.release();
      await testPool.end();
    }
  }
});

test("saving a disposition records when it happened; unrelated saves keep that time", async () => {
  const { db, client } = fakeDb();
  const first = "2026-10-31T19:00:00.000Z";
  const later = "2026-10-31T20:00:00.000Z";
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "reached" } }, { now: () => new Date(first) });
  assert.equal(client.custom_fields.setter_handoff.disposition_at, first);
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { goal: "Growth" } }, { now: () => new Date(later) });
  assert.equal(client.custom_fields.setter_handoff.disposition_at, first);
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "reached", goal: "Growth" } }, { now: () => new Date(later) });
  assert.equal(client.custom_fields.setter_handoff.disposition_at, first,
    "autosave of the same result must not make an old conversation look new");
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "booked_on_call" } }, { now: () => new Date(later) });
  assert.equal(client.custom_fields.setter_handoff.disposition_at, later);
});

test("setter can save both funding paths and personal work facts without changing the survey", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.cf_svy_has_business_label = "Yes, 1-2 years";
  client.custom_fields.cf_svy_business_revenue_label = "$100k - $249k";
  const handoff = {
    triage_personal_or_business: "both", employment_status: "w2",
    employment_details: "Warehouse manager", annual_personal_income: "$100k-$199k",
    income_verification: "Yes, pay stubs"
  };
  const saved = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", handoff });
  assert.equal(saved.status, 200);
  for (const [key, value] of Object.entries(handoff)) assert.equal(saved.body.item.setter_handoff[key], value);
  assert.equal(client.custom_fields.cf_svy_has_business_label, "Yes, 1-2 years");
  assert.equal(client.custom_fields.cf_svy_business_revenue_label, "$100k - $249k");
  assert.equal(client.custom_fields.setter_survey_edits, undefined);
  for (const invalid of [
    { triage_personal_or_business: "either" }, { employment_status: "guessed" },
    { annual_personal_income: "$1m" }, { income_verification: "Probably" },
    { employment_details: "SSN 123-45-6789" }
  ]) {
    const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", handoff: invalid });
    assert.equal(result.status, 400);
  }
});

test("dial target waits until 6 a.m. Phoenix for an overnight lead", () => {
  assert.equal(targetDialBy("2026-10-27T06:00:00Z"), "2026-10-27T13:00:00.000Z");
  assert.equal(targetDialBy("2026-10-27T20:00:00Z"), "2026-10-27T20:01:00.000Z");
});

test("completion requires booked webhook, triage fields for opt-in, and handoff facts", () => {
  const h = { lead_type: "opt_in", ...completeHandoff() };
  assert.deepEqual(missingForCompletion(h, { booked_at: null, booking_time: null }),
    ["booking", "triage_problem", "triage_goal", "triage_personal_or_business"]);
  assert.deepEqual(missingForCompletion({ lead_type: "booked", ...completeHandoff() },
    { booked_at: "2026-10-26", booking_time: "2026-10-28" }), []);
});

test("saved checklist merges, completion is gated, and complete handoff is visible on client", async () => {
  const { db, client, queries } = fakeDb();
  const moves = [];
  const saved = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { dialed_at: "2026-10-26T20:00:00Z", call_attempts: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.setter_handoff.call_attempts, 1);
  const incomplete = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete",
    handoff: { goal: "Open a second location" } });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.error, "handoff_incomplete");
  assert.equal(queries.some(q => q.includes("UPDATE tasks")), false);
  assert.deepEqual(moves, []);
  const completed = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete",
    handoff: completeHandoff() }, { buildText: () => "Saved handoff",
    advanceStage: async (_writer, args) => { moves.push(args); return { moved: true }; } });
  assert.equal(completed.status, 200);
  assert.equal(client.custom_fields.setter_handoff.handoff_text, "Saved handoff");
  assert.ok(client.custom_fields.setter_handoff.complete_at);
  assert.equal(completed.body.item.needs_work, false);
  assert.equal(queries.some(q => q.includes("UPDATE tasks")), true);
  assert.equal(queries.some(q => q.includes("UPDATE cards")), true);
  assert.deepEqual(moves, [{ orgId: STAFF.org_id, clientId: CLIENT_ID, pipelineKey: "sales", stageKey: "confirmed" }]);
});

test("completing a handoff never moves a card back from a later Sales stage", async () => {
  const { db, queries } = fakeDb();
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete", expected_call_attempts: 0,
    handoff: completeHandoff() }, {
    advanceStage: async () => ({ moved: false, reason: "already_at_or_past", stageKey: "showed" })
  });
  assert.equal(result.status, 200);
  assert.equal(queries.some(q => q.includes("UPDATE cards")), false);
  assert.equal(queries.some(q => q.includes("UPDATE tasks")), true);
});

test("Complete cannot confirm a handoff after Undo changes its dial count", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = completeHandoff();
  const query = db.query;
  db.query = async (sql, params) => {
    if (sql.includes("UPDATE clients") && sql.includes("'{setter_handoff}'")) {
      client.custom_fields.setter_handoff.call_attempts = 0;
      client.custom_fields.setter_handoff.dialed_at = null;
    }
    return query(sql, params);
  };
  let advanced = false;
  const result = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "complete", expected_call_attempts: 1, handoff: completeHandoff()
  }, { advanceStage: async () => { advanced = true; return { moved: true }; } });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "handoff_dial_count_changed");
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 0);
  assert.equal(client.custom_fields.setter_handoff.complete_at, undefined);
  assert.equal(advanced, false);
});

test("completing a setter handoff alerts the different closer with saved facts", async () => {
  const { db, client } = fakeDb();
  client.closer_staff_id = "staff-2";
  const alerts = [];
  const input = { client_id: CLIENT_ID, action: "complete", expected_call_attempts: 0, handoff: completeHandoff() };
  const deps = {
    advanceStage: async () => ({ moved: true }),
    closerAlert: async (_db, args) => { alerts.push(args); return { queued: 1 }; }
  };
  const first = await updateSetterHandoff(db, STAFF, input, deps);
  input.expected_call_attempts = 1;
  const repeat = await updateSetterHandoff(db, STAFF, input, deps);
  assert.equal(first.status, 200);
  assert.equal(repeat.status, 200);
  assert.equal(alerts.length, 2, "retries use the same durable SMS key in the alert helper");
  assert.equal(alerts[0].closerStaffId, "staff-2");
  assert.equal(alerts[0].setterStaffId, STAFF.id);
  assert.equal(alerts[0].handoff.goal, "Open a second location");
  assert.equal(alerts[0].startTime, client.booking_time);
});

test("opt-in cannot complete until booking webhook adds a booking", async () => {
  const { db } = fakeDb(false);
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete", expected_call_attempts: 0,
    handoff: { ...completeHandoff(), triage_problem: "Cash flow", triage_goal: "Expand",
      triage_personal_or_business: "business" } });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body.missing, ["booking"]);
});

test("editing a completed checklist keeps the closer note in sync and preserves completion gates", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { lead_type: "booked", ...completeHandoff(),
    complete_at: "2026-10-26T21:00:00Z", handoff_text: "Old note" };
  const edited = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { problem: "New stuck part" } }, { buildText: ({ handoff }) => handoff.problem });
  assert.equal(edited.status, 200);
  assert.equal(client.custom_fields.setter_handoff.handoff_text, "New stuck part");
  assert.equal(client.custom_fields.setter_handoff.complete_at, "2026-10-26T21:00:00Z");
  const invalid = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { problem: "" } });
  assert.equal(invalid.status, 400);
  assert.equal(client.custom_fields.setter_handoff.problem, "New stuck part");
});

test("send action receives saved handoff and persists timestamp only after send", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { lead_type: "booked", ...completeHandoff(), complete_at: "2026-10-26T21:00:00Z" };
  let seen = null;
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "send_handoff", handoff: {} }, {
    sendAction: async args => {
      seen = args;
      return { same_staff: true, handoffPatch: { handoff_sent_at: "2026-10-26T21:01:00Z" } };
    }
  });
  assert.equal(result.status, 200);
  assert.equal(seen.action, "send_handoff");
  assert.equal(seen.setterStaffId, STAFF.id);
  assert.equal(seen.closerStaffId, STAFF.id);
  assert.equal(seen.handoff.goal, "Open a second location");
  assert.equal(client.custom_fields.setter_handoff.handoff_sent_at, "2026-10-26T21:01:00Z");
});

test("queue returns booked and opt-in leads with survey echo and saved handoff", async () => {
  const db = { async query(sql, params) {
    assert.equal(params[0], STAFF.org_id);
    if (sql.includes("WITH bounds AS")) return { rows: [{ dials: 0, booked: 0, showed: 0, no_shows: 0 }] };
    assert.match(sql, /assignee_role = 'setter'/);
    return { rows: [{ client_id: CLIENT_ID, first_name: "Pat", last_name: "Lee",
      phone: "+15551234567", created_at: "2026-10-26T20:00:00Z",
      target_dial_by: "2026-10-26T20:01:00Z", booked_at: null, booking_time: null,
      custom_fields: { cf_svy_planned_use_label: "Open a shop",
        cf_svy_money_change_now_labels: '["[\\"Grow faster\\"]"]',
        setter_survey_edits: { cf_svy_planned_use: "Buy equipment" }, setter_handoff: { call_attempts: 2 } } }] };
  } };
  const result = await listSetterQueue(db, STAFF);
  assert.equal(result.items[0].lead_type, "opt_in");
  assert.equal(result.items[0].setter_handoff.call_attempts, 2);
  assert.ok(result.items[0].survey.some(x => x.answer === "Open a shop"));
  assert.ok(result.items[0].survey.some(x => x.key === "cf_svy_planned_use"));
  assert.equal(result.items[0].survey.find(x => x.key === "cf_svy_money_change_now").answer, "Grow faster");
  assert.deepEqual(result.items[0].survey_edits, { cf_svy_planned_use: "Buy equipment" });
  assert.equal(result.numbers.dials, 0);
});

test("each queued lead enters the survey regardless of saved score", async () => {
  const lead = (id, custom_fields) => ({ client_id: id, first_name: "Pat", created_at: "2026-10-26T16:00:00Z", custom_fields });
  const db = { async query(sql) {
    if (sql.includes("WITH bounds AS")) return { rows: [{ dials: 0, booked: 0, showed: 0, no_shows: 0 }] };
    return { rows: [
      lead("a", { ...COMPLETE_SURVEY, cf_svy_self_reported_fico_label: "700-749" }),
      lead("b", { ...COMPLETE_SURVEY, cf_svy_self_reported_fico_label: "650-699" }),
      lead("c", { ...COMPLETE_SURVEY, cf_svy_self_reported_fico_label: "Not sure" }),
      lead("d", {})
    ] };
  } };
  const result = await listSetterQueue(db, STAFF);
  assert.deepEqual(result.items.map(x => x.booking_url), [
    "https://apply.fundhub.ai/apply",
    "https://apply.fundhub.ai/apply",
    "https://apply.fundhub.ai/apply",
    "https://apply.fundhub.ai/apply"
  ]);
  assert.equal(result.booking_url, "https://apply.fundhub.ai/funding-book-call", "the existing generic fallback redirects into /apply at the live calendar");
  assert.ok(result.items.every(x => !/700|650|unqualified/i.test(String(x.booking_url))));
});

test("a saved checklist keeps an unfinished lead on the survey", async () => {
  const { db, client } = fakeDb(false);
  client.custom_fields.cf_svy_self_reported_fico_label = "580-649";
  const saved = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { dialed_at: "2026-10-26T20:00:00Z", call_attempts: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.booking_url, "https://apply.fundhub.ai/apply");
});

test("correcting the score on the call keeps the survey entry link", async () => {
  const { db, client } = fakeDb(false);
  Object.assign(client.custom_fields, COMPLETE_SURVEY);
  client.custom_fields.cf_svy_self_reported_fico_label = "620-699";
  const up = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "700-759" } });
  assert.equal(up.status, 200);
  assert.equal(up.body.booking_url, "https://apply.fundhub.ai/apply");
  const back = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey", survey_edits: {} });
  assert.equal(back.body.booking_url, "https://apply.fundhub.ai/apply", "clearing the edit still starts at the survey");
});

/* credit_tier is the one word on the person ("qualified" or "unqualified") that
   every screen and report reads. A setter's score fix moves it, and clearing the
   fix puts it back to what the person typed. */
test("fixing the score on the call moves credit_tier, and clearing the fix moves it back", async () => {
  const { db, client } = fakeDb(false);
  client.custom_fields.cf_svy_self_reported_fico_label = "620-699";
  client.custom_fields.credit_tier = "unqualified";
  const up = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "760-850" } });
  assert.equal(up.status, 200);
  assert.equal(client.custom_fields.credit_tier, "qualified");
  const down = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "500-619" } });
  assert.equal(down.status, 200);
  assert.equal(client.custom_fields.credit_tier, "unqualified");
  const cleared = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey", survey_edits: {} });
  assert.equal(cleared.status, 200);
  assert.equal(client.custom_fields.credit_tier, "unqualified", "back to the typed 620-699");
});

test("setter score correction updates the client bucket and fills only unbucketed calls", async () => {
  const { db, client, bookings } = fakeDb(false);
  client.custom_fields.cf_svy_self_reported_fico_label = "620-699";
  client.qualification_bucket = "funding_unqualified";
  bookings.push({ qualification_bucket: "funding_unqualified" }, { qualification_bucket: null });
  const up = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "700-759" } });
  assert.equal(up.status, 200);
  assert.equal(client.qualification_bucket, "funding_qualified");
  assert.deepEqual(bookings.map((booking) => booking.qualification_bucket),
    ["funding_unqualified", "funding_qualified"], "a known booking bucket stays frozen");
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey", survey_edits: {} });
  assert.equal(client.qualification_bucket, "funding_unqualified", "clearing the edit restores the submitted score bucket");
  assert.equal(bookings[1].qualification_bucket, "funding_qualified", "the first known booking bucket remains frozen");
});

test("a score the person never gave cannot be corrected, so credit_tier stays unwritten", async () => {
  const { db, client } = fakeDb(false);
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "700-759" } });
  assert.equal(result.status, 400, "a score the person never gave is not a question the setter can correct");
  assert.equal(client.custom_fields.credit_tier, undefined);
});

test("an answer saved before the new ranges still sets credit_tier, and a fix moves it", async () => {
  const { db, client, queries } = fakeDb(false);
  client.custom_fields.cf_svy_self_reported_fico_label = "650-699";
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  // No fix to the score, only another answer: the old typed 650-699 reads as unqualified.
  const other = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Equipment or buildout" } });
  assert.equal(other.status, 200);
  assert.equal(client.custom_fields.credit_tier, "unqualified");
  // The same word again: nothing to write.
  const writes = queries.filter(sql => sql.includes("'credit_tier'")).length;
  assert.equal(writes, 1);
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Equipment or buildout" } });
  assert.equal(queries.filter(sql => sql.includes("'credit_tier'")).length, 1, "unchanged tier is not written again");
  // A fix to a 700-and-up answer moves it.
  const up = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_self_reported_fico: "700-759" } });
  assert.equal(up.status, 200);
  assert.equal(client.custom_fields.credit_tier, "qualified");
});

test("no readable score anywhere leaves credit_tier exactly as it was", async () => {
  const { db, client, queries } = fakeDb(false);
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  client.custom_fields.credit_tier = "qualified";
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Equipment or buildout" } });
  assert.equal(result.status, 200);
  assert.equal(client.custom_fields.credit_tier, "qualified");
  assert.equal(queries.some(sql => sql.includes("'credit_tier'")), false);
});

test("saving the checklist never touches credit_tier", async () => {
  const { db, client, queries } = fakeDb(false);
  client.custom_fields.cf_svy_self_reported_fico_label = "760-850";
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0, handoff: { call_attempts: 1 } });
  assert.equal(result.status, 200);
  assert.equal(client.custom_fields.credit_tier, undefined);
  assert.equal(queries.some(sql => sql.includes("'credit_tier'")), false);
});

test("the queue routes new and older score answers through the survey", async () => {
  const lead = (id, custom_fields) => ({ client_id: id, first_name: "Pat", created_at: "2026-10-26T16:00:00Z", custom_fields });
  const labels = ["700-759", "760-850", "620-699", "500-619", "Not sure", "750+", "500-579"];
  const db = { async query(sql) {
    if (sql.includes("WITH bounds AS")) return { rows: [{ dials: 0, booked: 0, showed: 0, no_shows: 0 }] };
    return { rows: labels.map((label, i) => lead(`c${i}`, { ...COMPLETE_SURVEY, cf_svy_self_reported_fico_label: label })) };
  } };
  const result = await listSetterQueue(db, STAFF);
  assert.deepEqual(result.items.map(x => x.booking_url), labels.map(() => "https://apply.fundhub.ai/apply"));
});

/* ── "No answer" starts the no-answer text cadence (AI-SET-03) ──────────────── */

const NOON_PHOENIX = () => new Date("2026-10-31T19:00:00Z");

function emitSpy({ fail = false } = {}) {
  const calls = [];
  const emitFn = async (db, name, payload, opts) => {
    calls.push({ name, payload, opts });
    if (fail) throw new Error("bus is down");
    return { id: "evt-1", deduped: false };
  };
  return { calls, emitFn };
}

test("saving No answer starts the cadence: one setter.no_answer event, keyed by lead and Arizona day", async () => {
  const { db } = fakeDb();
  const { calls, emitFn } = emitSpy();
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { disposition: "no_answer", call_attempts: 1 } }, { emit: emitFn, now: NOON_PHOENIX });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "setter.no_answer");
  assert.deepEqual(calls[0].payload, { disposition: "no_answer", setter_staff_id: STAFF.id, call_attempts: 1 });
  assert.deepEqual(calls[0].opts, {
    orgId: STAFF.org_id, clientId: CLIENT_ID, idempotencyKey: `setter.no_answer:${CLIENT_ID}:2026-10-31`
  });
});

test("saving the same screen again starts nothing; a fresh dial that again got no answer does", async () => {
  const { db, client } = fakeDb();
  const { calls, emitFn } = emitSpy();
  const deps = { emit: emitFn, now: NOON_PHOENIX };
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { disposition: "no_answer", call_attempts: 1 } }, deps);
  assert.equal(calls.length, 1);
  // The screen saves again with the same result and the same dial count.
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", handoff: { disposition: "no_answer", call_attempts: 1, goal: "Open a shop" } }, deps);
  assert.equal(calls.length, 1, "nothing changed: no event");
  // Another dial, still no answer: the count goes up, so the event is sent (the bus drops it as a same-day repeat).
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "log_dial", handoff: { disposition: "no_answer" } }, deps);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].payload.call_attempts, 2);
  assert.equal(calls[1].opts.idempotencyKey, calls[0].opts.idempotencyKey, "the same day, the same key: the bus keeps one cadence");
});

test("the next Arizona day is a new key", async () => {
  const { db } = fakeDb();
  const { calls, emitFn } = emitSpy();
  // 06:30Z is 11:30 p.m. the day before in Arizona; 07:30Z is 12:30 a.m.
  const keyAt = async (iso, attempts) => {
    calls.length = 0;
    await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "log_dial", handoff: { disposition: "no_answer" } },
      { emit: emitFn, now: () => new Date(iso) });
    return calls[0]?.opts.idempotencyKey.split(":").pop();
  };
  assert.equal(await keyAt("2026-11-01T06:30:00Z"), "2026-10-31");
  assert.equal(await keyAt("2026-11-01T07:30:00Z"), "2026-11-01");
});

test("no other result starts the cadence", async () => {
  const { db } = fakeDb();
  const { calls, emitFn } = emitSpy();
  for (const disposition of ["reached", "reschedule", "booked_on_call", ""]) {
    const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: disposition === "reached" ? 0 : 1,
      handoff: { disposition, call_attempts: 1 } },
      { emit: emitFn, now: NOON_PHOENIX });
    assert.equal(result.status, 200, disposition);
  }
  // A dial logged with no result chosen is not a no-answer either.
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "log_dial", handoff: {} }, { emit: emitFn, now: NOON_PHOENIX });
  assert.deepEqual(calls, []);
});

test("only a save that says No answer starts it, even when No answer was saved earlier", async () => {
  const { db, client } = fakeDb();
  const { calls, emitFn } = emitSpy();
  const deps = { emit: emitFn, now: NOON_PHOENIX };
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { disposition: "no_answer", call_attempts: 1 } }, deps);
  assert.equal(calls.length, 1);
  // A dial logged without naming a result: the saved No answer is not this save's word.
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "log_dial", handoff: {} }, deps);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.equal(client.custom_fields.setter_handoff.disposition, "no_answer");
  assert.equal(calls.length, 1);
});

test("a request that answers with an error starts nothing", async () => {
  const { db, client } = fakeDb();
  const { calls, emitFn } = emitSpy();
  // The send_handoff button needs a completed handoff, so this answers 400.
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "send_handoff", expected_call_attempts: 0,
    handoff: { disposition: "no_answer", call_attempts: 1 } }, { emit: emitFn, now: NOON_PHOENIX });
  assert.equal(result.status, 400);
  assert.equal(client.custom_fields.setter_handoff.disposition, "no_answer", "the word was saved before the send was refused");
  assert.deepEqual(calls, []);
});

test("a save that fails starts nothing", async () => {
  const { db, client } = fakeDb();
  const { calls, emitFn } = emitSpy();
  const deps = { emit: emitFn, now: NOON_PHOENIX };
  // 400: the text is refused.
  const refused = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "no_answer", goal: "Pre-approved for $100,000" } }, deps);
  assert.equal(refused.status, 400);
  // 403: another setter owns this lead.
  client.custom_fields.setter_handoff = { setter_staff_id: "staff-9", call_attempts: 0 };
  const setter = { id: "staff-2", org_id: STAFF.org_id, role: "setter", name: "Alex" };
  const original = db.query;
  db.query = async (sql, params) => sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")
    ? { rows: [{ assignee_staff_id: "staff-9" }] }
    : original(sql, params);
  const blocked = await updateSetterHandoff(db, setter, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "no_answer", call_attempts: 1 } }, deps);
  assert.equal(blocked.status, 403);
  db.query = original;
  // 404: no such lead.
  const missing = { async query() { return { rows: [] }; } };
  const none = await updateSetterHandoff(missing, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { disposition: "no_answer" } }, deps);
  assert.equal(none.status, 404);
  assert.deepEqual(calls, []);
});

test("a cadence that cannot start logs a warning and the save still succeeds", async () => {
  const { db, client } = fakeDb();
  const { calls, emitFn } = emitSpy({ fail: true });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let result;
  try {
    result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
      handoff: { disposition: "no_answer", call_attempts: 1 } }, { emit: emitFn, now: NOON_PHOENIX });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(result.status, 200);
  assert.equal(client.custom_fields.setter_handoff.disposition, "no_answer", "the result was saved");
  assert.equal(calls.length, 1);
  assert.ok(warnings.some(w => /no-answer text cadence not started: bus is down/.test(w)), warnings.join("\n"));
});

test("the setter's own name goes on the event, not the owner's who edited it", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { setter_staff_id: "staff-alex", setter_name: "Alex Setter", call_attempts: 0 };
  const { calls, emitFn } = emitSpy();
  await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { disposition: "no_answer", call_attempts: 1 } },
    { emit: emitFn, now: NOON_PHOENIX });
  assert.equal(calls[0].payload.setter_staff_id, "staff-alex");
});

test("survey save replaces edits, keeps submitted answers, and does not complete the task", async () => {
  const { db, client, queries } = fakeDb();
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  client.custom_fields.cf_svy_funding_target_amount_label = "$50k - $100k";
  const first = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Equipment or buildout", cf_svy_funding_target_amount: "$100k - $200k" } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.survey_edits, { cf_svy_planned_use: "Equipment or buildout", cf_svy_funding_target_amount: "$100k - $200k" });
  const second = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Growth (marketing, inventory, hiring)" } });
  assert.deepEqual(second.body.survey_edits, { cf_svy_planned_use: "Growth (marketing, inventory, hiring)" });
  const checklist = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { call_attempts: 1 } });
  assert.deepEqual(checklist.body.item.survey_edits, { cf_svy_planned_use: "Growth (marketing, inventory, hiring)" });
  assert.equal(client.custom_fields.cf_svy_planned_use_label, "Open a shop");
  assert.equal(client.custom_fields.cf_svy_funding_target_amount_label, "$50k - $100k");
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 1);
  assert.equal(queries.some(sql => sql.includes("UPDATE tasks") || sql.includes("UPDATE cards")), false);
  const reset = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey", survey_edits: {} });
  assert.deepEqual(reset.body.survey_edits, {});
});

test("survey save rejects unseen keys and invalid values", async () => {
  const { db, client, queries } = fakeDb();
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  client.custom_fields.cf_svy_money_change_now_labels = '["Grow faster (more customers / more reach)"]';
  for (const survey_edits of [null, { unknown: "X" }, { cf_svy_funding_target_amount: "$100k" },
    { cf_svy_planned_use: 123 }, { cf_svy_planned_use: "X".repeat(1001) },
    { cf_svy_planned_use: "Typed answer" },
    { cf_svy_money_change_now: "Grow faster (more customers / more reach), Grow faster (more customers / more reach)" }]) {
    const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey", survey_edits });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_survey_edits");
  }
  assert.equal(queries.some(sql => sql.includes("UPDATE clients")), false);
});

test("survey choices save multiple answers and preserve an older typed edit", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.cf_svy_money_change_now_labels = '["Grow faster (more customers / more reach)"]';
  client.custom_fields.cf_svy_planned_use_label = "Not sure yet";
  client.custom_fields.setter_survey_edits = { cf_svy_planned_use: "Custom use from an earlier call" };
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: {
      cf_svy_money_change_now: "Grow faster (more customers / more reach), Stability (cover bills / buffer slow weeks)",
      cf_svy_planned_use: "Custom use from an earlier call"
    } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.survey_edits, {
    cf_svy_money_change_now: "Grow faster (more customers / more reach), Stability (cover bills / buffer slow weeks)",
    cf_svy_planned_use: "Custom use from an earlier call"
  });
});

test("completed handoff text follows the edited survey without resending", async () => {
  const { db, client, queries } = fakeDb();
  client.custom_fields.cf_svy_planned_use_label = "Open a shop";
  client.custom_fields.setter_handoff = { complete_at: "2026-10-26T21:00:00Z", ...completeHandoff() };
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save_survey",
    survey_edits: { cf_svy_planned_use: "Equipment or buildout" } });
  assert.equal(result.status, 200);
  assert.match(client.custom_fields.setter_handoff.handoff_text, /Survey said Equipment or buildout/);
  assert.doesNotMatch(client.custom_fields.setter_handoff.handoff_text, /Open a shop/);
  assert.equal(queries.some(sql => sql.includes("UPDATE tasks") || sql.includes("INSERT INTO messages")), false);
});

test("booked lead dial target starts from booking time, not its earlier opt-in task", async () => {
  const db = { async query() { return { rows: [{ client_id: CLIENT_ID, first_name: "Pat",
    created_at: "2026-10-26T16:00:00Z", booked_at: "2026-10-26T20:00:00Z",
    booking_time: "2026-10-28T19:00:00Z", custom_fields: {} }] }; } };
  const result = await listSetterQueue(db, STAFF);
  assert.equal(result.items[0].target_dial_by, "2026-10-26T20:01:00.000Z");
});

test("setter numbers are self-scoped and keep dial-to-book separate from show rate", async () => {
  const seen = [];
  const db = { async query(sql, params) {
    seen.push({ sql, params });
    return { rows: [{ dials: 10, booked: 2, showed: 3, no_shows: 1 }] };
  } };
  const numbers = await setterNumbers(db, { ...STAFF, id: "staff-human-setter" }, {
    now: new Date("2026-10-30T16:00:00Z"), includeDemo: false
  });
  assert.deepEqual(numbers, {
    dials: 10, booked: 2, dial_to_book_rate: 0.2,
    showed: 3, no_shows: 1, show_rate: 0.75
  });
  assert.deepEqual(seen[0].params, [STAFF.org_id, "staff-human-setter", false, "2026-10-30T16:00:00.000Z"]);
  assert.match(seen[0].sql, /setter_staff_id' = \$2::text/);
  assert.match(seen[0].sql, /dial_attempt_days/);
  assert.match(seen[0].sql, /handoff->>'lead_type' = 'opt_in'/);
  assert.match(seen[0].sql, /o\.outcome = 'no_show'/);
  assert.match(seen[0].sql, /b\.created_at < x\.day_end/);
  assert.match(seen[0].sql, /o\.logged_at < x\.day_end/);
  assert.match(seen[0].sql, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(seen[0].sql, /COALESCE\(o\.is_demo, false\) = false/);
});

test("log dial keeps an exact server-owned count for the Phoenix day", async () => {
  const { db, client } = fakeDb();
  const now = () => new Date("2026-10-28T00:30:00.000Z");
  const first = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "log_dial", handoff: {}
  }, { now });
  assert.equal(first.status, 200);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 1);
  assert.equal(client.custom_fields.setter_handoff.dial_attempt_days["2026-10-27"], 1);
  const second = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "log_dial", handoff: {}
  }, { now });
  assert.equal(second.status, 200);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.equal(client.custom_fields.setter_handoff.dial_attempt_days["2026-10-27"], 2);
});

test("a Save started before a dial keeps the newly committed count and Phoenix day", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { call_attempts: 1, dial_attempt_days: { "2026-10-31": 1 } };
  const query = db.query;
  db.query = async (sql, params) => {
    if (sql.includes("UPDATE clients") && sql.includes("'{setter_handoff}'")) {
      client.custom_fields.setter_handoff.call_attempts = 2;
      client.custom_fields.setter_handoff.dial_attempt_days["2026-11-01"] = 1;
    }
    return query(sql, params);
  };
  const saved = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "save", expected_call_attempts: 1,
    handoff: { call_attempts: 1, goal: "Keep this edit" }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.setter_handoff.call_attempts, 2);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.deepEqual(client.custom_fields.setter_handoff.dial_attempt_days, { "2026-10-31": 1, "2026-11-01": 1 });
  assert.equal(client.custom_fields.setter_handoff.goal, "Keep this edit");
});

test("a manual count edit conflicts when a dial commits during Save", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { call_attempts: 1, dial_attempt_days: { "2026-10-31": 1 } };
  const query = db.query;
  db.query = async (sql, params) => {
    if (sql.includes("UPDATE clients") && sql.includes("'{setter_handoff}'")) {
      client.custom_fields.setter_handoff.call_attempts = 2;
      client.custom_fields.setter_handoff.dial_attempt_days["2026-11-01"] = 1;
    }
    return query(sql, params);
  };
  const saved = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "save", expected_call_attempts: 1,
    handoff: { call_attempts: 3, goal: "Do not save on conflict" }
  });
  assert.equal(saved.status, 409);
  assert.equal(saved.body.error, "handoff_dial_count_changed");
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.equal(client.custom_fields.setter_handoff.goal, undefined);
});

test("an older tab saves checklist facts after a dial without erasing the dial", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = {
    call_attempts: 2, dial_attempt_days: { "2026-10-31": 1, "2026-11-01": 1 }
  };
  const saved = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "save", expected_call_attempts: 1,
    handoff: { call_attempts: 1, goal: "Still safe to save" }
  });
  assert.equal(saved.status, 200);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.deepEqual(client.custom_fields.setter_handoff.dial_attempt_days,
    { "2026-10-31": 1, "2026-11-01": 1 });
  assert.equal(client.custom_fields.setter_handoff.goal, "Still safe to save");
});

test("a cached legacy tab cannot overwrite the logged count without a baseline", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = {
    call_attempts: 2, dial_attempt_days: { "2026-10-31": 1, "2026-11-01": 1 }
  };
  const saved = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "save",
    handoff: { call_attempts: 1, goal: "Legacy checklist edit" }
  });
  assert.equal(saved.status, 409);
  assert.equal(saved.body.error, "handoff_dial_count_changed");
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 2);
  assert.deepEqual(client.custom_fields.setter_handoff.dial_attempt_days,
    { "2026-10-31": 1, "2026-11-01": 1 });
  assert.equal(client.custom_fields.setter_handoff.goal, undefined);
});

test("an owner edit preserves the human setter identity already on the handoff", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = {
    setter_staff_id: "staff-alex", setter_name: "Alex Setter", call_attempts: 1
  };
  const result = await updateSetterHandoff(db, STAFF, {
    client_id: CLIENT_ID, action: "save", handoff: { goal: "New location" }
  });
  assert.equal(result.status, 200);
  assert.equal(client.custom_fields.setter_handoff.setter_staff_id, "staff-alex");
  assert.equal(client.custom_fields.setter_handoff.setter_name, "Alex Setter");
});

test("setter can save only an assigned or unclaimed task and claims it", async () => {
  const { db, client } = fakeDb();
  const setter = { id: "staff-2", org_id: STAFF.org_id, role: "setter", name: "Alex" };
  let assignee = null;
  const original = db.query;
  db.query = async (sql, params) => {
    if (sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")) return { rows: [{ assignee_staff_id: assignee }] };
    if (sql.includes("UPDATE tasks SET assignee_staff_id")) {
      if (assignee && assignee !== params[2]) return { rows: [] };
      assignee = params[2];
      return { rows: [{ id: "task-1" }] };
    }
    return original(sql, params);
  };
  const first = await updateSetterHandoff(db, setter, { client_id: CLIENT_ID, action: "save", expected_call_attempts: 0,
    handoff: { call_attempts: 1 } });
  assert.equal(first.status, 200);
  assert.equal(assignee, setter.id);
  assert.equal(client.custom_fields.setter_handoff.setter_staff_id, setter.id);
  const other = await updateSetterHandoff(db, { ...setter, id: "staff-3" }, { client_id: CLIENT_ID, action: "save",
    handoff: { call_attempts: 2 } });
  assert.equal(other.status, 403);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 1);
  const address = await updateSetterHandoff(db, { ...setter, id: "staff-3" }, {
    client_id: CLIENT_ID, action: "save_address",
    address: { line1: "123 Main St", line2: "", city: "Phoenix", state: "AZ", zip: "85001", confirmed: true }
  });
  assert.equal(address.status, 403);
  assert.equal(client.custom_fields.setter_residential_address, undefined);
});


test("assigned setters keep personal queue and Undo boundaries even with another primary job", async () => {
  for (const role of ["closer", "csm", "funding_advisor", "inquiry_specialist", "sales_manager"]) {
    const staff={...STAFF,role,roles:[role,"setter"]};
    const calls=[];
    const db={async query(sql,args){calls.push({sql,args});return{rows:[]};}};
    await listSetterQueue(db,staff);
    assert.equal(calls[0].args[1],true,role);
    assert.equal(calls[0].args[2],staff.id,role);
    await latestUndoableDial(db,staff);
    assert.equal(calls.at(-1).args[2],true,role);
  }
  for(const role of ["owner","admin"]){
    const calls=[];
    await listSetterQueue({async query(sql,args){calls.push({sql,args});return{rows:[]};}}, {...STAFF,role});
    assert.equal(calls[0].args[1],false,role);
  }
});
test("a secondary setter cannot edit another setter's lead or emit a follow-up", async () => {
  const {db,queries}=fakeDb();
  const original=db.query;
  db.query=async(sql,args)=>sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")
    ? {rows:[{assignee_staff_id:"another-setter"}]}:original(sql,args);
  let emitted=false;
  const result=await updateSetterHandoff(db,{...STAFF,role:"closer",roles:["closer","setter"]},
    {client_id:CLIENT_ID,action:"save",handoff:{disposition:"no_answer"}},
    {emit:async()=>{emitted=true;}});
  assert.equal(result.status,403);
  assert.equal(emitted,false);
  assert.equal(queries.some(sql=>sql.includes("UPDATE")),false);
});


test("a linked client is prioritized inside the same role-scoped queue before the page limit", async () => {
  const calls = [];
  const staff = { ...STAFF, role: "setter" };
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  await listSetterQueue(db, staff, { client_id: CLIENT_ID });
  const query = calls[0];
  assert.deepEqual(query.params, [STAFF.org_id, true, STAFF.id, 50, 0, CLIENT_ID]);
  assert.match(query.sql, /WHERE t.org_id = \$1/);
  assert.match(query.sql, /t.assignee_staff_id = \$3/);
  assert.match(query.sql, /crm_archived_at/);
  assert.match(query.sql, /setter_handoff'->>'setter_staff_id' = \$3::text/);
  assert.match(query.sql, /ORDER BY CASE WHEN client_id = \$6::uuid THEN 0 ELSE 1 END,[\s\S]*LIMIT \$4 OFFSET \$5/);
});
