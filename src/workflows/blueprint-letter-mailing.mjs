// Reconciles only client-confirmed saved orders. It never creates a charge.
// A second step reads the mail tracker for letters the mail house accepted
// (GET only, at most three letters, its own 26-second step).
import {inngest} from './client.mjs';
import {db} from '../db.mjs';
import {sweepLetterMailings,trackLetterMailings} from '../blueprint/letter-mailing.mjs';
import {recordHeartbeat} from '../pulse/heartbeats.mjs';
export const SOURCE_WORKFLOW='blueprint-letter-mailing';
export const SWEEP_CRON='*/5 * * * *';
export async function sweepBlueprintLetterMailing(database=db,options={}){
  const startedAt=options.now||new Date();let result;
  try{result=await (options.sweep||sweepLetterMailings)(database,{...options,limit:Math.min(options.limit||5,5),maxEnvelopes:2});}
  catch{result={ok:false,examined:0,mailed:0,needsReview:0,failed:1};}
  await (options.recordHeartbeat||recordHeartbeat)(database,{job:SOURCE_WORKFLOW,runner:options.runner||'netlify',startedAt,
    outcome:result.ok?'ok':'error',itemCount:result.examined||0,error:result.ok?null:'Blueprint mailing orders need review'});
  return result;
}
/* A failed tracker read keeps every saved fact. It does not make the mailing
   job red: blueprint:letter-mailing goes red when a letter is never read. */
export async function trackBlueprintLetterMailing(database=db,options={}){
  try{return await (options.track||trackLetterMailings)(database,{...options,limit:3});}
  catch{return {ok:false,examined:0,updated:0,failed:1};}
}
export async function handle({db:database=db,step}={}){
  const run=(name,work)=>step?.run?step.run(name,work):work();
  const result=await run('reconcile-confirmed-mailing-orders',()=>sweepBlueprintLetterMailing(database));
  await run('read-mail-tracker',()=>trackBlueprintLetterMailing(database));
  return result;
}
export const blueprintLetterMailing = inngest.createFunction({id:'blueprint-letter-mailing',name:'Confirmed Blueprint letter mailing recovery'}, {cron:SWEEP_CRON},handle);
export default sweepBlueprintLetterMailing;
