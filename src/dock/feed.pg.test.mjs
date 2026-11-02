import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,close} from '../db.mjs';
import {closerDayCalendar} from './feed.mjs';
test('real PG closer full-day calendar excludes other staff/org/day/finished/archived calls',{skip:!process.env.DATABASE_URL},async()=>{
 const db=await pool().connect();try{await db.query('BEGIN');
 await db.query('CREATE TEMP TABLE bookings(LIKE public.bookings INCLUDING DEFAULTS);CREATE TEMP TABLE clients(LIKE public.clients INCLUDING DEFAULTS);CREATE TEMP TABLE tasks(LIKE public.tasks INCLUDING DEFAULTS);CREATE TEMP TABLE call_outcomes(LIKE public.call_outcomes INCLUDING DEFAULTS)');
 const org=randomUUID(),foreignOrg=randomUUID(),staff=randomUUID(),otherStaff=randomUUID(),now=new Date('2026-11-02T05:00:00Z');
 const add=async({at,who=staff,tenant=org,done=false,archived=false,outcome=false,bookingOutcome=false}={})=>{
 const client=randomUUID(),task=randomUUID(),ref=randomUUID();
 await db.query('INSERT INTO clients(id,org_id,first_name,custom_fields) VALUES($1,$2,$3,$4)',[client,tenant,'Calendar '+task,{...(archived?{crm_archived_at:'2026-11-01'}:{}),cf_svy_funding_target_amount_label:'$100k - $200k',setter_handoff:{problem:'Saved private problem',computer_ready:false},secret:'not-exposed'}]);
 await db.query("INSERT INTO tasks(id,org_id,client_id,title,assignee_role,assignee_staff_id,due_at,done,body,meeting_url) VALUES($1,$2,$3,'Closer call','closer',$4,$5,$6,$7,'https://meet.google.com/abc-defg-hij')",[task,tenant,client,who,at,done,ref]);
 if(outcome || bookingOutcome)await db.query("INSERT INTO call_outcomes(org_id,client_id,staff_id,outcome,task_id,booking_ref) VALUES($1,$2,$3,'no_show',$4,$5)",[tenant,client,staff,bookingOutcome?null:task,bookingOutcome?ref:null]);
 await db.query("INSERT INTO bookings(id,org_id,client_id,starts_at,status,source) VALUES($1,$2,$3,$4,'booked','clickfunnels')",[randomUUID(),tenant,client,at]);
 return task;
 };
 const expected=[];for(const at of ['2026-11-01T07:00:00Z','2026-11-01T14:00:00Z','2026-11-01T20:00:00Z','2026-11-02T05:30:00Z','2026-11-02T06:59:59Z'])expected.push(await add({at}));
 for(const item of [{at:'2026-11-01T06:59:59Z'},{at:'2026-11-02T07:00:00Z'},{at:'2026-11-01T15:00:00Z',who:otherStaff},{at:'2026-11-01T15:00:00Z',who:null},{at:'2026-11-01T15:00:00Z',tenant:foreignOrg},{at:'2026-11-01T15:00:00Z',done:true},{at:'2026-11-01T15:00:00Z',archived:true},{at:'2026-11-01T15:00:00Z',outcome:true},{at:'2026-11-01T15:00:00Z',bookingOutcome:true}])await add(item);
 const calendar=await closerDayCalendar(db,{orgId:org,staffId:staff,now});
 assert.deepEqual(calendar.calls.map(call=>call.taskId),expected);assert.equal(calendar.nextCallId,expected[3]);assert.equal(calendar.calls.length,5);assert.ok(calendar.calls.every(call=>call.bookingId));
 assert.equal(calendar.calls[0].secondsUntilStart,-79200);assert.equal(calendar.calls[3].secondsUntilStart,1800);
 assert.equal(calendar.calls[0].setterHandoff.computer_ready,false);assert.equal(JSON.stringify(calendar).includes('not-exposed'),false);
 assert.equal((await closerDayCalendar(db,{orgId:foreignOrg,staffId:otherStaff,now})).calls.length,0);
 }finally{await db.query('ROLLBACK');db.release();await close();}
});
