import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { reconcileClientBankEvidence } from "../blueprint/bank-evidence.mjs";

export async function handle({db:database=db}={}) {
  const {rows}=await database.query(`SELECT DISTINCT org_id,client_id FROM blueprint_fulfillment_engagements
    WHERE status='active' AND execution_owner='client' AND funding_round_id IS NOT NULL`);
  const failed=[];
  for (const row of rows) {
    try { await reconcileClientBankEvidence(database,{orgId:row.org_id,clientId:row.client_id}); }
    catch (error) { failed.push({clientId:row.client_id,error:String(error?.message || error)}); }
  }
  if (failed.length) throw new Error("Blueprint bank evidence failed on "+failed.length+" client(s): "+failed[0].error);
  return {checked:rows.length};
}

export const blueprintBankEvidenceSweeper=inngest.createFunction(
  {id:"blueprint-bank-evidence",name:"Reconcile bank proof for client funding rounds"},
  {cron:"17 * * * *"},()=>handle());
