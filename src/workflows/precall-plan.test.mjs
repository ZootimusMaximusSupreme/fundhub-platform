import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrecallSchedule, deckFor, PRECALL_SLOTS, planPrecall,
  cancelPrecall, claimPushOnce, sweepPrecall, precallDispatchReason } from "./precall-plan.mjs";

test("canonical 17 slots preserve funding omissions and unique lane lessons", () => {
  assert.equal(PRECALL_SLOTS.length, 17);
  assert.deepEqual(PRECALL_SLOTS.map((s,i)=>s[0]===null?i:null).filter(i=>i!==null),[0,4,9,13]);
  for(const lane of ["qualified","unqualified"]) { const slugs=PRECALL_SLOTS.map((_,i)=>deckFor(i,lane)).filter(Boolean); assert.equal(new Set(slugs).size,slugs.length); }
  for (let i = 0; i < PRECALL_SLOTS.length; i++) {
    assert.equal(deckFor(i, "qualified"), PRECALL_SLOTS[i][0]);
    assert.ok(deckFor(i, "unqualified"));
  }
});

test("booked plan uses the exact approved BS01 timing and channels", async () => {
  const {DECK_SLOTS,deckTime}=await import("./precall-decks.mjs");
  const call=new Date("2026-11-07T16:00:00Z"),now=new Date("2026-11-04T15:00:00Z");
  const rows=buildPrecallSchedule({phase:"booked",startTime:call,now,lane:"qualified"});
  assert.ok(rows.length>5);
  for(const row of rows) {
    assert.equal(row.dueAt.getTime(),deckTime(call,row.slot).getTime());
    assert.equal(row.channel,DECK_SLOTS[row.slot].channel);
    assert.equal(row.deckSlug,DECK_SLOTS[row.slot].funding);
    assert.ok(row.dueAt<call && row.dueAt-now>=3_600_000);
    assert.equal(row.channel==="push",false);
    for(const lead of [48,24,2]) assert.ok(Math.abs(row.dueAt-(call-lead*3_600_000))>=3_600_000);
  }
});

test("short notice and absent score do not dump old lessons or guess a lane", () => {
  const call = new Date("2026-11-07T16:00:00Z");
  assert.deepEqual(buildPrecallSchedule({ phase: "booked", startTime: call,
    now: new Date("2026-11-06T17:00:00Z"), lane: null }), []);
  const rows = buildPrecallSchedule({ phase: "booked", startTime: call,
    now: new Date("2026-11-06T17:00:00Z"), lane: "unqualified" });
  assert.ok(rows.every((row) => row.dueAt > new Date("2026-11-06T17:00:00Z")));
});

test("before booking, four lessons are planned one per day", () => {
  const rows = buildPrecallSchedule({ phase: "prebooking", startTime: "2026-11-04T16:00:00Z",
    lane: "unqualified" });
  assert.deepEqual(rows.map((row) => row.slot), [1, 0, 2, 6]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].dueAt - rows[i - 1].dueAt >= 24 * 3_600_000);
});

test("planner cancels unsent rows, keeps queued history, and writes a new lane plan", async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT custom_fields")) return { rows: [{ custom_fields: { cf_svy_self_reported_fico: "700-759" } }] };
    if (sql.startsWith("UPDATE precall_send_plans")) return { rows: [{ id: "old" }] };
    return { rows: [] };
  } };
  const out = await planPrecall(db, { orgId: "org", clientId: "client", eventId: "event",
    phase: "booked", startTime: "2026-11-07T16:00:00Z", now: new Date("2026-11-04T15:00:00Z") });
  assert.equal(out.lane, "qualified");
  assert.equal(out.planned, calls.filter((call) => call.sql.includes("INSERT INTO precall_send_plans")).length);
  assert.match(calls.find((call) => call.sql.startsWith("UPDATE precall_send_plans")).sql, /status IN \('planned', 'blocked', 'claimed', 'queued'\)/);
  assert.ok(calls.some((call) => call.params?.includes("pre-underwriting")));
  assert.equal(await cancelPrecall(db, { orgId: "org", clientId: "client" }), 1);
});

test("a push plan has only one durable outbound claim", async () => {
  let claims = 0;
  const db = { query: async () => ({ rows: claims++ === 0 ? [{ plan_id: "p" }] : [] }) };
  assert.equal(await claimPushOnce(db, { planId: "p", orgId: "o" }), true);
  assert.equal(await claimPushOnce(db, { planId: "p", orgId: "o" }), false);
});

test("due email with no approved template stays blocked and queues no outbound message", async () => {
  const queries = [];
  const row = { id: "plan-1", org_id: "org", client_id: "client", source_event_id: "booking-1",
    phase: "booked", slot: 2, channel: "email", booking_uid: "booking-uid",
    call_start_at: new Date("2026-11-07T16:00:00Z"), created_at: new Date("2026-11-04T15:00:00Z") };
  const db = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith("SELECT status, starts_at, provider_uid FROM bookings")) return {rows:[{status:"booked",starts_at:row.call_start_at,provider_uid:row.booking_uid}]};
    if (sql.includes("RETURNING p.*")) return { rows: [row] };
    if (sql.startsWith("SELECT custom_fields")) return { rows: [{ custom_fields: { cf_svy_self_reported_fico: "700-759" } }] };
    if (sql.includes("FROM precall_send_plans") && sql.includes("status = 'claimed'")) return { rows: [{ one: 1 }] };
    return { rows: [] };
  } };
  const out = await sweepPrecall(db, { enabled:true, now: new Date("2026-11-05T16:00:00Z") });
  assert.deepEqual(out, { ok: true, claimed: 1, queued: 0, skipped: 0, blocked: 1 });
  assert.ok(queries.some((q) => q.params?.includes("EMAIL-BS-DECK-LESSON")));
  assert.ok(queries.some((q) => q.params?.includes("template_pending")));
  assert.equal(queries.filter((q) => q.sql.includes("INSERT INTO messages")).length, 0);
});

test("a cancelled claimed row is rechecked before any outbound lookup", async () => {
  const queries = [];
  const row = { id: "plan-2", org_id: "org", client_id: "client", source_event_id: "booking-2",
    phase: "prebooking", slot: 0, channel: "email", created_at: new Date("2026-11-04T15:00:00Z") };
  const db = { query: async (sql) => {
    queries.push(sql);
    if (sql.includes("RETURNING p.*")) return { rows: [row] };
    if (sql.startsWith("SELECT custom_fields")) return { rows: [{ custom_fields: { cf_svy_self_reported_fico: "700-759" } }] };
    return { rows: [] };
  } };
  const out = await sweepPrecall(db, { enabled:true, now: new Date("2026-11-05T16:00:00Z") });
  assert.equal(out.skipped, 1);
  assert.equal(queries.filter((sql) => sql.includes("FROM message_templates")).length, 0);
});

test("dispatch rechecks a queued lesson against its current plan before provider routing", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const message = { org_id: "org", client_id: "client", channel: "email",
    template_key: "EMAIL-BS-DECK-LESSON",
    provider_ref: `workflow:EMAIL-BS-DECK-LESSON:precall-plan:${id}` };
  let status = "cancelled";
  const db = { query: async (sql) => {
    if (sql.includes("FROM message_templates")) return {rows:[{body:"Approved lesson",subject:"Approved lesson",compliance_passed:true}]};
    if (sql.startsWith("SELECT * FROM precall_send_plans")) return { rows: [{
      id, org_id: "org", client_id: "client", status, slot: 2,
      phase: "prebooking", created_at: new Date("2026-11-04T15:00:00Z") }] };
    if (sql.startsWith("SELECT custom_fields")) return { rows: [{ custom_fields: { cf_svy_self_reported_fico: "500-619" } }] };
    return { rows: [] };
  } };
  assert.equal(await precallDispatchReason(db, message, new Date("2026-11-05T16:00:00Z"),{enabled:true,durable:true}), "precall_plan_inactive");
  status = "queued";
  assert.equal(await precallDispatchReason(db, message, new Date("2026-11-05T16:00:00Z"),{enabled:true,durable:true}), "precall_lane_changed");
});


test("planner never reads a score lane outside its supplied company", async () => {
  const calls=[];
  const db={async query(sql,args){calls.push({sql,args});return{rows:[]};}};
  const result=await planPrecall(db,{orgId:"org-a",clientId:"foreign-client",eventId:"event-a",phase:"prebooking"});
  const read=calls.find(c=>c.sql.startsWith("SELECT custom_fields FROM clients"));
  assert.match(read.sql,/WHERE id = \$1 AND org_id = \$2/);
  assert.deepEqual(read.args,["foreign-client","org-a"]);
  assert.equal(result.planned,0);
  assert.equal(calls.some(c=>c.sql.includes("INSERT INTO precall_send_plans")),false);
});
