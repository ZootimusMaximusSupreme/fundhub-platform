import { inngest } from "./client.mjs";
import { processBlueprintClientServices } from "../blueprint/report-requests.mjs";
import { db } from "../db.mjs";
import { reconcileClientBankEvidence } from "../blueprint/bank-evidence.mjs";

export async function handle({db:database=db,processServices=processBlueprintClientServices}={}) {
  const {rows}=await database.query(`SELECT DISTINCT org_id,client_id FROM blueprint_fulfillment_engagements
    WHERE status='active' AND execution_owner='client' AND funding_round_id IS NOT NULL`);
  const failed=[];
  for (const row of rows) {
    try { await reconcileClientBankEvidence(database,{orgId:row.org_id,clientId:row.client_id}); }
    catch (error) { failed.push({clientId:row.client_id,error:String(error?.message || error)}); }
  }
  const services=await processServices(database);
  if (!services.ok) failed.push(...(services.errors || [{error:"paid service processing failed"}]));
  if (failed.length) throw new Error("Blueprint bank evidence failed on "+failed.length+" client(s): "+failed[0].error);
  return {checked:rows.length,services};
}

export const blueprintBankEvidenceSweeper = inngest.createFunction(
  { id: "blueprint-bank-evidence", name: "Reconcile bank proof for client funding rounds" },
  { cron: "17 * * * *" },
  () => handle()
);
