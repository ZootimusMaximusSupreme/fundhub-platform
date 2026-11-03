// GET /api/blueprint/plan — the actual paid buyer's guided portal workspace.
import { db } from '../../src/db.mjs';
import { requireBlueprintPlanScope } from './business-plans.mjs';
import { readBusinessPlans } from '../../src/blueprint/business-plans.mjs';
import { buildBlueprintClientPlan } from '../../src/blueprint/client-plan.mjs';
import { preparationGuidance, websitePrompt } from '../../src/blueprint/preparation-guidance.mjs';
import { rankLocalCreditUnions } from '../../src/blueprint/local-credit-unions.mjs';

export default async function handler(req,res,deps={}) {
  if(req.method!=='GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  try {
    const scope=await requireBlueprintPlanScope(req,res,deps);
    if(!scope)return;
    const build=deps.buildBlueprintClientPlan||buildBlueprintClientPlan;
    const result=await build(deps.db||db,scope,{
      readBusinessPlans:deps.readBusinessPlans||readBusinessPlans,
      preparationGuidance:deps.preparationGuidance||preparationGuidance,
      websitePrompt:deps.websitePrompt||websitePrompt,
      rankLocalCreditUnions:deps.rankLocalCreditUnions||rankLocalCreditUnions,
      ...deps.planDependencies
    });
    if(!result)return res.status(404).json({ok:false,error:'client_not_found'});
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ok:false,error:'blueprint_plan_unavailable',message:'Your saved Blueprint plan could not be loaded. Please try again.'});
  }
}
