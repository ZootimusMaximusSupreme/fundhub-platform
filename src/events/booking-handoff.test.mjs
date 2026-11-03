import test from "node:test";
import assert from "node:assert/strict";
import {
  ticketEligible,providerEvent,validAck,attemptBookingHandoff,sweepBookingHandoffs,
  CLAIM_SQL,EVENT_SQL,BOOKING_SQL,SETTLE_SQL,DUE_SQL,EXHAUSTED_SQL,MAX_AGE_MS,LEASE_MS,MAX_BATCH
} from "./booking-handoff.mjs";

const BASE=Date.parse("2026-11-03T02:00:00Z"),ORG="00000000-0000-4000-8000-000000000001",ID="00000000-0000-4000-8000-000000000002",CLIENT="00000000-0000-4000-8000-000000000003";
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  let clock=BASE;
  const q={id:"ticket",org_id:ORG,event_id:ID,status:"pending",next_attempt_at:new Date(BASE).toISOString(),attempts:0,max_attempts:7};
  const event={id:ID,org_id:ORG,name:"booking.created",client_id:CLIENT,owned_client_id:CLIENT,client_is_demo:false,created_at:new Date(BASE).toISOString(),payload:{bookingUid:"one-call",startTime:new Date(BASE+3600000).toISOString()}};
  const bookings=[{status:"booked",client_id:CLIENT,starts_at:event.payload.startTime}];
  const calls=[];
  const db={async query(sql,p=[]) {
    calls.push({sql,p});
    if(sql===CLAIM_SQL){if(q.status!=="pending"||p[0]!==ORG||p[1]!==ID||Date.parse(q.next_attempt_at)>Date.parse(p[2]))return{rows:[]};q.attempts++;q.next_attempt_at=new Date(Date.parse(p[2])+LEASE_MS).toISOString();return{rows:[{...q,lease_at:q.next_attempt_at}]};}
    if(sql===EVENT_SQL)return{rows:event?[event]:[]};
    if(sql===BOOKING_SQL)return{rows:bookings};
    if(sql===SETTLE_SQL){assert.ok(["pending","resolved","ignored","exhausted"].includes(p[3]));if(p[0]!==q.id||p[1]!==ORG||q.status!=="pending"||q.next_attempt_at!==p[2])return{rows:[]};q.status=p[3];q.error_code=p[6];q.resolved_at=["resolved","ignored"].includes(q.status)?p[4]:null;if(q.status!=="pending")q.next_attempt_at=null;return{rows:[{id:q.id}]};}
    if(sql===DUE_SQL){assert.equal(p[1],MAX_BATCH);return{rows:q.status==="pending"&&Date.parse(q.next_attempt_at)<=clock?[{org_id:ORG,event_id:ID}]:[]};}
    if(sql===EXHAUSTED_SQL)return{rows:[{n:q.status==="exhausted"?1:0}]};
    throw Error("Unexpected handoff SQL");
  }};
  return{db,q,event,bookings,calls,now:()=>clock,advance:n=>{clock+=n;}};
}
const options=(f,sendEvent)=>({now:f.now,hasEventKey:()=>true,sendEvent,waitMs:10});
const run=(f,send)=>attemptBookingHandoff(f.db,{orgId:ORG,eventId:ID},options(f,send));

test("booking ticket is limited to fresh future created bookings without prove/demo/skip flags",()=>{
  const p={startTime:new Date(BASE+1).toISOString()};
  assert.equal(ticketEligible("booking.created",p,{},BASE),true);
  for(const name of ["booking.rescheduled","deposit.paid","payment.received"])assert.equal(ticketEligible(name,p,{},BASE),false);
  for(const opts of [{isDemo:true},{skipInngest:true}])assert.equal(ticketEligible("booking.created",p,opts,BASE),false);
  for(const payload of [{startTime:"bad"},{startTime:new Date(BASE).toISOString()},{...p,synthetic:"TRUE"},{...p,simulated:true}])assert.equal(ticketEligible("booking.created",payload,{},BASE),false);
});

test("only a single usable provider ACK is accepted",()=>{
  assert.equal(validAck({ids:["01ABCDEF"]}),true);
  for(const value of [null,{},true,{ids:[]},{ids:[""]},{ids:[" "]},{ids:[1]},{ids:["a","b"]}])assert.equal(validAck(value),false);
});

test("first and repeat attempts bind the provider ID to organization and original stored event",()=>{
  const f=fixture(),e=providerEvent(f.event);
  assert.equal(e.id,`fundhub:booking.created:${ORG}:${ID}`);
  assert.deepEqual(e.data,{id:ID,payload:f.event.payload,orgId:ORG,clientId:CLIENT});
  assert.notEqual(providerEvent({...f.event,org_id:"other"}).id,e.id);
});

test("valid ACK resolves the ticket, not a claim of SMS delivery",async()=>{
  const f=fixture();assert.equal((await run(f,async()=>({ids:["receipt"]}))).outcome,"accepted");
  assert.equal(f.q.status,"resolved");assert.ok(f.q.resolved_at);assert.equal(f.q.next_attempt_at,null);
  assert.ok(!f.calls.some(x=>/INSERT INTO messages/.test(x.sql)));
});

test("empty ACK or transport rejection stays pending with its lease",async()=>{
  for(const sender of [async()=>({ids:[]}),async()=>{throw Error("unknown transport");}]){
    const f=fixture();assert.equal((await run(f,sender)).outcome,"pending");assert.equal(f.q.status,"pending");assert.equal(f.q.resolved_at,null);assert.equal(f.q.error_code,"booking_ack_unknown");
    assert.equal((await run(f,sender)).outcome,"unclaimed");
  }
});

test("timeout is unknown, and a late ACK can settle only its current lease",async()=>{
  const f=fixture();let done;const promise=new Promise(r=>{done=r;});
  assert.equal((await run(f,()=>promise)).outcome,"pending");assert.equal(f.q.status,"pending");
  done({ids:["late"]});await pause();await pause();assert.equal(f.q.status,"resolved");
});

test("a late old request cannot overwrite a newer pending owner",async()=>{
  const f=fixture();let oldDone,newDone;
  await run(f,()=>new Promise(r=>{oldDone=r;}));f.advance(LEASE_MS+1);
  await run(f,()=>new Promise(r=>{newDone=r;}));
  oldDone({ids:["old"]});await pause();await pause();assert.equal(f.q.status,"pending");
  newDone({ids:["new"]});await pause();await pause();assert.equal(f.q.status,"resolved");
});

test("provider accept then local receipt failure retries with the same provider ID",async()=>{
  const f=fixture(),query=f.db.query.bind(f.db);let crash=true;f.db.query=async(sql,p)=>{if(sql===SETTLE_SQL&&p[3]==="resolved"&&crash){crash=false;throw Error("process lost receipt");}return query(sql,p);};
  const received=new Set(),sent=[];const sender=async e=>{sent.push(e.id);received.add(e.id);return{ids:["accepted"]};};
  assert.equal((await run(f,sender)).outcome,"pending");f.advance(LEASE_MS+1);
  assert.equal((await run(f,sender)).outcome,"accepted");assert.equal(sent.length,2);assert.equal(received.size,1);assert.equal(sent[0],sent[1]);
});

test("overlapping attempts acquire one lease and submit once",async()=>{
  const f=fixture();let n=0;const send=async()=>{n++;return{ids:["ack"]};};
  const result=await Promise.all([run(f,send),run(f,send)]);assert.equal(n,1);assert.deepEqual(result.map(x=>x.outcome).sort(),["accepted","unclaimed"]);
});

test("slow database reads cannot send beyond appointment, age or lease boundaries",async()=>{
  for(const mode of ["appointment","age","lease"]){
    const f=fixture(),query=f.db.query.bind(f.db);let sent=0;
    if(mode==="appointment"){f.event.payload.startTime=new Date(BASE+1000).toISOString();f.bookings[0].starts_at=f.event.payload.startTime;}
    if(mode==="age")f.event.created_at=new Date(BASE-MAX_AGE_MS+1000).toISOString();
    f.db.query=async(sql,p)=>{const r=await query(sql,p);if(sql===BOOKING_SQL)f.advance(mode==="lease"?LEASE_MS+1:2000);return r;};
    const result=await run(f,async()=>{sent++;return{ids:["unsafe"]};});
    assert.equal(sent,0);assert.equal(result.outcome,mode==="lease"?"lease_changed":"exhausted");
    assert.equal(f.q.status,mode==="lease"?"pending":"exhausted");
  }
});

test("foreign client, age expiry and old appointments never reach the provider",async()=>{
  for(const change of [f=>{f.event.owned_client_id=null;},f=>{f.advance(MAX_AGE_MS);},f=>{f.event.payload.startTime=new Date(BASE-1).toISOString();}]){
    const f=fixture();change(f);let sent=0;assert.equal((await run(f,async()=>{sent++;return{ids:["bad"]};})).outcome,"exhausted");assert.equal(sent,0);assert.equal(f.q.status,"exhausted");assert.equal(f.q.resolved_at,null);
  }
});

test("cancellation or changed appointment is observably ignored without a send",async()=>{
  for(const change of [f=>{f.bookings[0].status="cancelled";},f=>{f.bookings[0].starts_at=new Date(BASE+7200000).toISOString();}]){
    const f=fixture();change(f);let sent=0;assert.equal((await run(f,async()=>{sent++;})).outcome,"ignored");assert.equal(sent,0);assert.equal(f.q.status,"ignored");assert.ok(f.q.resolved_at);
  }
});

test("missing booking record and missing key wait without false acknowledgement",async()=>{
  const f=fixture();f.bookings.length=0;let sent=0;assert.equal((await run(f,async()=>{sent++;})).outcome,"pending");assert.equal(sent,0);
  const g=fixture();assert.equal((await attemptBookingHandoff(g.db,{orgId:ORG,eventId:ID},{now:g.now,hasEventKey:()=>false,sendEvent:async()=>{sent++;}})).outcome,"pending");assert.equal(sent,0);
});

test("the existing worker reads only its dedicated capped ticket batch and reports exhausted tickets red",async()=>{
  const f=fixture();f.advance(MAX_AGE_MS);const r=await sweepBookingHandoffs(f.db,options(f,async()=>({ids:["never"]})));
  assert.equal(r.scanned,1);assert.equal(r.exhausted,1);assert.ok(f.calls.some(x=>x.sql===DUE_SQL&&x.p[1]===4));
  const bad=fixture();bad.db.query=async sql=>({rows:sql===DUE_SQL?[]:[]});await assert.rejects(sweepBookingHandoffs(bad.db),/unreadable/);
});
