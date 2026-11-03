// Reconciles only client-confirmed saved orders. It never creates a charge.
import {inngest} from './client.mjs';
import {db} from '../db.mjs';
import {sweepLetterMailings} from '../blueprint/letter-mailing.mjs';
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
export async function handle({db:database=db,step}={}){return step?.run?step.run('reconcile-confirmed-mailing-orders',()=>sweepBlueprintLetterMailing(database)):sweepBlueprintLetterMailing(database);}
export const blueprintLetterMailing=inngest.createFunction({id:SOURCE_WORKFLOW,name:'Confirmed Blueprint letter mailing recovery'}, {cron:SWEEP_CRON},handle);
export default sweepBlueprintLetterMailing;
