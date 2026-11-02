import {test} from 'node:test';
import assert from 'node:assert/strict';
import {precallPlannerEnabled,planForBooking,planAfterSurvey,refreshPrecallForScore,sweepPrecall,durableOwnsBooking,registerPrecallPlans} from './precall-plan.mjs';
import {getHandlers} from '../events/registry.mjs';
import {runDeckDrip} from './bs-01-precall-launcher.mjs';
test('durable rollout requires both explicit flags and defaults to zero reads/writes/claims',async()=>{
 assert.equal(precallPlannerEnabled({}),false);assert.equal(precallPlannerEnabled({BS_DECK_LESSONS_ENABLED:'true'}),false);
 assert.equal(precallPlannerEnabled({BS_PRECALL_PLANNER_ENABLED:'true'}),false);
 assert.equal(precallPlannerEnabled({BS_DECK_LESSONS_ENABLED:'true',BS_PRECALL_PLANNER_ENABLED:'true'}),true);
 const db={query(){throw new Error('disabled planner touched database');}};
 await planForBooking(db,{}, {enabled:false});await planAfterSurvey({},db,{enabled:false});
 await refreshPrecallForScore(db,{}, {enabled:false});await sweepPrecall(db,{enabled:false});
 assert.equal(await durableOwnsBooking(db,{}, {enabled:false}),false);
});
test('survey and cancellation hooks are actually registered on the existing bus',()=>{
 registerPrecallPlans();assert.ok(getHandlers('survey.completed').some(f=>f.name==='planAfterSurvey'));
 assert.ok(getHandlers('booking.cancelled').some(f=>f.name==='cancelForBookingEvent'));
});
test('an already running inline workflow yields before sending once durable plan owns its booking',async()=>{
 const previous=process.env.BS_PRECALL_PLANNER_ENABLED, lessons=process.env.BS_DECK_LESSONS_ENABLED;
 process.env.BS_PRECALL_PLANNER_ENABLED='true';process.env.BS_DECK_LESSONS_ENABLED='true';
 try{
 let ownReads=0,sends=0;
 const db={async query(sql){if(sql.includes('FROM precall_send_plans')){ownReads++;return{rows:[{one:1}]};}
 if(sql.includes('SELECT custom_fields'))return{rows:[{custom_fields:{cf_svy_self_reported_fico:'700-759'}}]};
 if(sql.includes('INSERT INTO messages'))sends++;return{rows:[]};}};
 const out=await runDeckDrip({db,orgId:'org',clientId:'client',eventId:'e',startTime:new Date(Date.now()+10*86400000),
 step:{run:async(_name,fn)=>fn(),sleepUntil:async()=>{}},enabled:true});
 assert.equal(out.stoppedBecause,'durable_plan_owns_booking');assert.ok(ownReads>0);assert.equal(sends,0);
 }finally{if(previous===undefined)delete process.env.BS_PRECALL_PLANNER_ENABLED;else process.env.BS_PRECALL_PLANNER_ENABLED=previous;
 if(lessons===undefined)delete process.env.BS_DECK_LESSONS_ENABLED;else process.env.BS_DECK_LESSONS_ENABLED=lessons;}
});
