// The paid client's explicit mailing purchase. Self-mailing remains available.
import {db} from '../../src/db.mjs';
import {requirePrincipal} from '../../src/http/middleware/requirePrincipal.mjs';
import {requireBlueprintPlanScope} from './business-plans.mjs';
import {LetterMailingError,readLetterMailing,quoteLetterMailing,confirmLetterMailing,reconcileLetterMailing} from '../../src/blueprint/letter-mailing.mjs';
import {FulfillmentCycleError,saveLetterStep} from '../../src/blueprint/fulfillment-cycle.mjs';
const ALLOWED={quote:['action','documentIds'],confirm:['action','orderId','quoteVersion','paymentOptionId','authorization','idempotencyKey'],status:['action','orderId'],
  // The fulfillment cycle: the client approves a letter, then checks its mailing address.
  approve_letter:['action','documentId'],check_address:['action','documentId']};
export default async function handler(req,res,deps={}){
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  let principal;
  try{
    const database=deps.db||db;
    const scope=await requireBlueprintPlanScope(req,res,{...deps,requirePrincipal:async(...args)=>{principal=await (deps.requirePrincipal||requirePrincipal)(...args);return principal;}});
    if(!scope)return;
    scope.accountId=principal?.accountId;
    const services=deps.mailing||{readLetterMailing,quoteLetterMailing,confirmLetterMailing,reconcileLetterMailing};
    const options=deps.mailingDependencies||{};
    if(req.method==='GET')return res.status(200).json(await services.readLetterMailing(database,scope,options));
    const b=req.body;
    if(!b||Array.isArray(b)||typeof b!=='object'||!ALLOWED[b.action]||Object.keys(b).some(k=>!ALLOWED[b.action].includes(k)))
      return res.status(400).json({ok:false,error:'invalid_input',message:'Choose an available mailing action.'});
    if(b.action==='approve_letter'||b.action==='check_address')
      return res.status(200).json(await (deps.saveLetterStep||saveLetterStep)(database,scope,{documentId:b.documentId,step:b.action==='approve_letter'?'approve':'address'}));
    const result=b.action==='quote'?await services.quoteLetterMailing(database,scope,b,options)
      :b.action==='confirm'?await services.confirmLetterMailing(database,scope,b,options)
      :await services.reconcileLetterMailing(database,scope,b.orderId,options);
    return res.status(200).json(result);
  }catch(e){if(e instanceof LetterMailingError||e instanceof FulfillmentCycleError)return res.status(e.status).json({ok:false,error:e.code,message:e.message});
    return res.status(500).json({ok:false,error:'letter_mailing_unavailable',message:'Your mailing request could not be loaded. Check its status before trying again.'});}
}
