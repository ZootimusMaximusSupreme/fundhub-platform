import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contractsDb,baseBook,IDS } from '../testing/fin-b08-contracts-db.mjs';
import { createDraft,send,listContracts } from './send.mjs';
import { queueSignerMessages,remindContract } from './notify.mjs';
import { handoffUrl } from '../affiliates/blueprint-handoff-link.mjs';
const ORG=randomUUID(),OTHER=randomUUID(),ACCOUNT=randomUUID(),STAFF=randomUUID(),AFF=randomUUID(),SECRET='synthetic-account-contract-secret-over32characters';
const saved={};
before(()=>{for(const key of ['MESSAGING_DRY_RUN','ADAPTERS_DRY_RUN']){saved[key]=process.env[key];process.env[key]='1';}mock.method(globalThis,'fetch',async()=>{throw Error('No network is allowed in contract fixtures');});});
after(()=>{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}mock.restoreAll();});
function world({validAccount=true}={}){
 const book=baseBook({orgId:ORG,otherOrgId:OTHER,staffId:STAFF});
 const template=book.templates[0];Object.assign(template,{template_key:'BLUEPRINT-SELF-FUNDING-AGREEMENT',manual_fields:[],body:'Full implementation for {{field.package_fee}}. Fee {{field.package_fee}}.',name:'Full Blueprint'});
 const db=contractsDb({...book,extraRules:[[/SELECT id FROM accounts WHERE id=\$1 AND org_id=\$2 AND kind='affiliate' AND status='active'/,(_sql,p)=>validAccount&&p[0]===ACCOUNT&&p[1]===ORG?[{id:ACCOUNT}]:[]]]});
 db.tables.message_templates.push({org_id:ORG,template_key:'CONTRACT-SEND-EMAIL',channel:'email',subject:'Please sign',body:'Read {{contract.link}}',compliance_passed:true},{org_id:ORG,template_key:'CONTRACT-REMIND-EMAIL',channel:'email',subject:'Reminder',body:'Read {{contract.link}}',compliance_passed:true});
 const query=db.query.bind(db);
 db.query=async(sql,params)=>{
  if(/INSERT INTO messages/.test(sql)&&/ON CONFLICT \(org_id, provider_ref\).*DO NOTHING/s.test(sql)) {
   const ref=params[4];
   if(db.tables.messages.some(m=>m.org_id===params[0]&&m.provider_ref===ref))return {rows:[],rowCount:0};
  }
  return query(sql,params);
 };
 return db;
}
async function prepared(db,amount=2900000){
 const draft=await createDraft(db,{orgId:ORG,accountId:ACCOUNT,clientId:IDS.client,templateId:IDS.template,amountCents:amount});
 const record={org_id:ORG,affiliate_id:AFF,account_id:ACCOUNT,client_id:IDS.client,contract_id:draft.id,payment_link_id:randomUUID(),amount_cents:amount};
 db.tables.clients[0].custom_fields.blueprint_seller_sale=record;
 return {draft,record};
}
test('an affiliate draft records its actual account and exact29K without a staff stand-in',async()=>{
 const db=world();const {draft}=await prepared(db);
 assert.equal(draft.created_by,null);assert.equal(draft.created_by_account_id,ACCOUNT);
 assert.equal(draft.merge_values._blueprint_amount_cents,2900000);assert.equal(draft.merge_values.package_fee,'$29,000');
});
test('account actor validates active same-company affiliate and refuses mixed/missing actors',async()=>{
 for(const options of [{accountId:randomUUID()},{accountId:ACCOUNT,orgId:OTHER},{accountId:ACCOUNT,staffId:STAFF},{}]){
  await assert.rejects(createDraft(world(),{orgId:ORG,clientId:IDS.client,templateId:IDS.template,...options}));
 }
 await assert.rejects(createDraft(world({validAccount:false}),{orgId:ORG,accountId:ACCOUNT,clientId:IDS.client,templateId:IDS.template}),{code:'account_actor_forbidden'});
});
test('affiliate send freezes actual sender and emits only the stable buyer URL in its normal message',async()=>{
 const db=world();const {draft,record}=await prepared(db);
 const out=await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,amountCents:2900000,secret:SECRET,resend:false});
 assert.equal(out.contract.status,'sent');assert.equal(out.contract.sent_by,null);assert.equal(out.contract.sent_by_account_id,ACCOUNT);
 assert.match(out.contract.rendered_body,/\$29,000/);
 const message=db.tables.messages.find(m=>String(m.provider_ref).endsWith(':send'));
 assert.ok(message,'existing message pipeline queues the agreement notice');
 assert.ok(message.rendered_body.includes(handoffUrl(record,{},SECRET)));
 assert.ok(!message.rendered_body.includes('/contract.html?'));
 const count=db.tables.messages.length;await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,secret:SECRET,resend:false});
 assert.equal(db.tables.messages.length,count,'retrying same seller operation does not send another email');
 const list=await listContracts(db,{orgId:ORG});assert.ok(list.some(c=>c.id===draft.id),'nullable employee sender does not hide the contract');
});
test('reminders keep the permanent bound-buyer link and never switch to a fresh expiring URL',async()=>{
 const db=world();const {draft,record}=await prepared(db);
 await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,amountCents:2900000,secret:SECRET,resend:false});
 const contract=db.tables.contracts.find(c=>c.id===draft.id);const signers=db.tables.contract_signers.filter(s=>s.contract_id===draft.id);
 await remindContract(db,{orgId:ORG,contract,secret:SECRET,chasesSoFar:0,listSigners:async()=>signers,mintLinks:async()=>({links:signers.map(s=>({signer_id:s.id,url:'https://fundhub.ai/contract.html?expired-inner-fixture'}))})});
 const reminder=db.tables.messages.find(m=>String(m.provider_ref).endsWith(':chase1'));
 assert.ok(reminder?.rendered_body.includes(handoffUrl(record,{},SECRET)));
 assert.ok(!reminder.rendered_body.includes('expired-inner-fixture'));
});
test('seller notification rejects mismatched pinned contract/actor and does not share the buyer bearer with another signer',async()=>{
 const db=world();const {draft}=await prepared(db);const signers=db.tables.contract_signers.filter(s=>s.contract_id===draft.id);
 db.tables.clients[0].custom_fields.blueprint_seller_sale.account_id=randomUUID();
 await assert.rejects(queueSignerMessages(db,{orgId:ORG,contract:draft,signers,links:signers.map(s=>({signer_id:s.id,url:'inner'})),secret:SECRET}),/matching permanent buyer handoff/);
 assert.equal(db.tables.messages.length,0);
});
test('ordinary staff contracts preserve their original actor and signer-specific mail',async()=>{
 const db=world();const draft=await createDraft(db,{orgId:ORG,staffId:STAFF,clientId:IDS.client,templateId:IDS.template,amountCents:3000000});
 const out=await send(db,{orgId:ORG,staffId:STAFF,id:draft.id,secret:SECRET});
 assert.equal(out.contract.created_by,STAFF);assert.equal(out.contract.created_by_account_id,null);assert.equal(out.contract.sent_by,STAFF);assert.equal(out.contract.sent_by_account_id,null);
 const message=db.tables.messages.find(m=>String(m.provider_ref).endsWith(':send'));assert.ok(message.rendered_body.includes('/contract.html?'));
});

test('same seller send recovers an interrupted initial notice without a deliberate resend',async()=>{
 const db=world();const {draft,record}=await prepared(db);
 const template=db.tables.message_templates.find(t=>t.template_key==='CONTRACT-SEND-EMAIL');template.compliance_passed=false;
 await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,secret:SECRET,resend:false});
 assert.equal(db.tables.contracts.find(c=>c.id===draft.id).status,'sent');assert.equal(db.tables.messages.length,0);
 template.compliance_passed=true;
 await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,secret:SECRET,resend:false});
 await send(db,{orgId:ORG,accountId:ACCOUNT,id:draft.id,secret:SECRET,resend:false});
 assert.equal(db.tables.messages.length,1);assert.match(db.tables.messages[0].provider_ref,/:send$/);
 assert.ok(db.tables.messages[0].rendered_body.includes(handoffUrl(record,{},SECRET)));
});
