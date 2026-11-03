// Real migrated Postgres only; synthetic rows are rolled back. No network sends.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import pg from "pg";
import { emit, _resetOrgCache } from "./bus.mjs";
import { on, clearHandlers } from "./registry.mjs";
import { inngest } from "../workflows/client.mjs";
import { handleClickFunnelsWebhook } from "../adapters/clickfunnels.mjs";
import { onBookingCreated } from "../handlers/comms.mjs";
import { INSERT_SQL, SETTLE_SQL, HANDLER, CUTOVER_AT, attemptBookingHandoff, LEASE_MS } from "./booking-handoff.mjs";

const dsn=process.env.APP_DATABASE_URL||process.env.DATABASE_URL;
const safe=(()=>{try{const u=new URL(dsn);return ["localhost","127.0.0.1","::1","[::1]"].includes(u.hostname)&&/scratch|test|ci/i.test(u.pathname);}catch{return false;}})();
if(dsn&&!safe)throw Error("Booking handoff proof refuses a non-loopback/non-scratch database");
const options={skip:safe?false:"Loopback scratch Postgres unavailable; no database proof ran"};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(run){
  const sql=new pg.Client({connectionString:dsn});await sql.connect();
  const pending=new Set();
  const db={query(query,p){const request=sql.query(query,p);pending.add(request);request.then(()=>pending.delete(request),()=>pending.delete(request));return request;}};
  const provider=mock.method(inngest,"send",async()=>({ids:["scratch-ack"]}));
  try{
    await sql.query("BEGIN");await sql.query("SET LOCAL ROLE fundhub_app");
    const role=(await sql.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.deepEqual(role,{role:"fundhub_app",rolsuper:false,rolbypassrls:false});
    const org=(await sql.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
    const foreign=(await sql.query("INSERT INTO orgs(slug,name) VALUES($1,'Booking handoff fixture') RETURNING id",[`handoff-${randomUUID()}`])).rows[0].id;
    const email=`${randomUUID()}@example.test`;
    const client=(await sql.query("INSERT INTO clients(org_id,email,first_name,ghl_contact_id) VALUES($1,$2,'Handoff fixture','scratch-only') RETURNING id",[org,email])).rows[0].id;
    const now=Date.parse((await sql.query("SELECT now() AS t")).rows[0].t);
    assert.ok(now>=Date.parse(CUTOVER_AT),"test must run after the explicit forward cutover");
    const payload={email,bookingUid:`scratch-${randomUUID()}`,startTime:new Date(now+3600000).toISOString(),source:"clickfunnels"};
    await run({sql,db,org,foreign,client,email,now,payload,provider});
  }finally{
    // Finish only this fixture's nonblocking handoff reads before rollback.
    for(let i=0;i<12;i++){await tick();await Promise.allSettled([...pending]);}
    clearHandlers();_resetOrgCache();provider.mock.restore();
    await sql.query("ROLLBACK");await sql.end();
  }
}
async function insert(f,key=randomUUID()){
  return(await f.sql.query(INSERT_SQL,[f.org,"booking.created",1,key,f.client,f.payload])).rows[0].id;
}
async function booking(f,eventId){await f.sql.query(`INSERT INTO bookings(org_id,client_id,source,provider_uid,starts_at,status,attendee_email,raw)
 VALUES($1,$2,'clickfunnels',$3,$4,'booked',$5,jsonb_build_object('__event_id',$6::text))`,[f.org,f.client,f.payload.bookingUid,f.payload.startTime,f.email,eventId]);}

test("real booking event and handoff ticket are atomic; duplicate event never backfills or repeats dispatch",options,async()=>fixture(async f=>{
  clearHandlers();let handlers=0;on("booking.created",()=>handlers++);
  await f.sql.query("SAVEPOINT failed_ticket");
  const bad={query:(q,p)=>f.sql.query(q===INSERT_SQL?q.replace("'Awaiting booking workflow acknowledgement'","(1/0)::text"):q,p)};
  await assert.rejects(()=>emit(bad,"booking.created",f.payload,{orgId:f.org,clientId:f.client,idempotencyKey:"atomic-scratch"}),/division by zero/);
  await f.sql.query("ROLLBACK TO SAVEPOINT failed_ticket");
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM events WHERE org_id=$1 AND idempotency_key='atomic-scratch'",[f.org])).rows[0].n,0);
  assert.equal(handlers,0);
  const id=await insert(f,"atomic-scratch");
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM failed_events WHERE org_id=$1 AND event_id=$2 AND handler_name=$3",[f.org,id,HANDLER])).rows[0].n,1);
  const again=await emit(f.db,"booking.created",f.payload,{orgId:f.org,clientId:f.client,idempotencyKey:"atomic-scratch"});
  assert.equal(again.deduped,true);assert.equal(handlers,0);
  // An old event without the new ticket is not adopted by a duplicate request.
  const oldKey=`old-${randomUUID()}`;
  const old=(await f.sql.query("INSERT INTO events(org_id,name,version,idempotency_key,client_id,payload) VALUES($1,'booking.created',1,$2,$3,$4) RETURNING id",[f.org,oldKey,f.client,f.payload])).rows[0].id;
  assert.equal((await emit(f.db,"booking.created",f.payload,{orgId:f.org,clientId:f.client,idempotencyKey:oldKey})).deduped,true);
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM failed_events WHERE event_id=$1 AND handler_name=$2",[old,HANDLER])).rows[0].n,0);
}));

test("real handoff SQL leases one attempt, rejects foreign scope and preserves the same provider identity after lost ACK",options,async()=>fixture(async f=>{
  const id=await insert(f);await booking(f,id);let now=f.now,calls=0,lostReceipt=true;const ids=[],accepted=new Set();
  const db={query(q,p){if(q===SETTLE_SQL&&p[3]==="resolved"&&lostReceipt){lostReceipt=false;throw Error("scratch lost local ACK write");}return f.db.query(q,p);}};
  const opts={now:()=>now,hasEventKey:()=>true,sendEvent:async e=>{calls++;ids.push(e.id);accepted.add(e.id);return{ids:["provider-already-accepted"]};}};
  assert.equal((await attemptBookingHandoff(db,{orgId:f.foreign,eventId:id},opts)).outcome,"unclaimed");
  const outcomes=await Promise.all([attemptBookingHandoff(db,{orgId:f.org,eventId:id},opts),attemptBookingHandoff(db,{orgId:f.org,eventId:id},opts)]);
  assert.deepEqual(outcomes.map(x=>x.outcome).sort(),["pending","unclaimed"]);assert.equal(calls,1);
  now+=LEASE_MS+1;
  assert.equal((await attemptBookingHandoff(db,{orgId:f.org,eventId:id},opts)).outcome,"accepted");
  assert.equal(calls,2);assert.equal(new Set(ids).size,1);assert.equal(accepted.size,1);
  const q=(await f.sql.query("SELECT status,resolved_at,next_attempt_at,attempts FROM failed_events WHERE event_id=$1 AND handler_name=$2",[id,HANDLER])).rows[0];
  assert.equal(q.status,"resolved");assert.ok(q.resolved_at);assert.equal(q.next_attempt_at,null);assert.equal(q.attempts,2);
}));

test("real current-booking cancellation and 15-minute expiry prevent provider calls",options,async()=>fixture(async f=>{
  const id=await insert(f);await booking(f,id);let sent=0;
  await f.sql.query("UPDATE bookings SET status='cancelled' WHERE org_id=$1 AND provider_uid=$2",[f.org,f.payload.bookingUid]);
  const opts={now:()=>f.now,hasEventKey:()=>true,sendEvent:async()=>{sent++;return{ids:["must-not-send"]};}};
  assert.equal((await attemptBookingHandoff(f.db,{orgId:f.org,eventId:id},opts)).outcome,"ignored");
  const expired=await insert(f);
  assert.equal((await attemptBookingHandoff(f.db,{orgId:f.org,eventId:expired},{...opts,now:()=>f.now+15*60000})).outcome,"exhausted");
  assert.equal(sent,0);
  const states=(await f.sql.query("SELECT status,resolved_at FROM failed_events WHERE event_id=ANY($1::uuid[]) AND handler_name=$2 ORDER BY status",[[id,expired],HANDLER])).rows;
  assert.equal(states[0].status,"exhausted");assert.equal(states[0].resolved_at,null);assert.equal(states[1].status,"ignored");assert.ok(states[1].resolved_at);
}));

test("real ClickFunnels retry after ticket failure creates one event/ticket/booking; later handler failure retains the ticket",options,async()=>fixture(async f=>{
  clearHandlers();_resetOrgCache();on("booking.created",onBookingCreated);
  on("booking.created",async()=>{throw Error("scratch later local handler failure");});
  const raw=JSON.stringify({event_type:"appointments/scheduled_event.created",event_id:`cf-${randomUUID()}`,data:{id:randomUUID(),start_on:f.payload.startTime,end_on:new Date(f.now+5400000).toISOString(),primary_contact:{email_address:f.email,first_name:"Handoff",last_name:"Fixture"}}});
  const secret="scratch-only-cf-signature",signatureHeader=createHmac("sha256",secret).update(raw).digest("hex");
  const input={rawBody:raw,signatureHeader,secret};
  await f.sql.query("SAVEPOINT cf_ticket_failure");
  const bad={query:(q,p)=>f.sql.query(q===INSERT_SQL?q.replace("'Awaiting booking workflow acknowledgement'","(1/0)::text"):q,p)};
  await assert.rejects(()=>handleClickFunnelsWebhook({...input,db:bad}),/division by zero/);
  await f.sql.query("ROLLBACK TO SAVEPOINT cf_ticket_failure");
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM bookings WHERE org_id=$1 AND client_id=$2",[f.org,f.client])).rows[0].n,0);
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM events WHERE org_id=$1 AND client_id=$2 AND name='booking.created'",[f.org,f.client])).rows[0].n,0);
  const result=await handleClickFunnelsWebhook({...input,db:f.db});assert.equal(result.ok,true);
  // Execute the identical webhook again: the existing-slot early return may not strand a ticket.
  await handleClickFunnelsWebhook({...input,db:f.db});
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM bookings WHERE org_id=$1 AND client_id=$2",[f.org,f.client])).rows[0].n,1);
  const events=(await f.sql.query("SELECT id FROM events WHERE org_id=$1 AND client_id=$2 AND name='booking.created'",[f.org,f.client])).rows;assert.equal(events.length,1);
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM failed_events WHERE org_id=$1 AND event_id=$2 AND handler_name=$3",[f.org,events[0].id,HANDLER])).rows[0].n,1);
  assert.equal((await f.sql.query("SELECT count(*)::int n FROM failed_events WHERE org_id=$1 AND event_id=$2 AND handler_name<>$3",[f.org,events[0].id,HANDLER])).rows[0].n,1,"later failed local handler has its own durable receipt");
}));
