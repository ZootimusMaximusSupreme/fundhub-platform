// Generates fictional dashboard data and embeds the existing pure lesson/payment
// helpers into its isolated browser adapter. Never connects to a database/provider.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBlueprintClientPlan } from '../../src/blueprint/client-plan.mjs';
import { preparationGuidance, websitePrompt } from '../../src/blueprint/preparation-guidance.mjs';
import { expandDefinitions, revolvingAccounts } from '../../src/waypoints/definitions.mjs';
import { nextStepOf } from '../../src/progress/read.mjs';
import { closedBy } from '../../src/waypoints/self-attest.mjs';
import { OFFERS } from '../../src/config/offers.mjs';
import { blueprintServiceTypes } from '../../src/blueprint/client-services.mjs';
import { setupSteps } from '../../src/finance/money-setup.mjs';
import { MAILING_PRICE_CENTS, MAX_MAILING_LETTERS } from '../../src/blueprint/letter-mailing.mjs';
import { runTierEngineFromCrsResult } from '../../src/finance/crs-tier.mjs';
import { buildFundingOpportunity } from '../../src/blueprint/funding-opportunity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const at = '2026-11-06T12:00:00.000Z';
const ids = Object.fromEntries(['org','client','account','engagement','case','lender','document','application','business','business2','business3','letter','report'].map((key,i)=>[key,`a0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const business = (id,name,activity) => ({id,name,activity,formationState:'AZ',operatingState:'AZ',formationStatus:'planned',formationDate:null,ownershipSince:null,operatingSince:null,website:null,evidence:{formation:{status:'not_added'},ein:{status:'not_added'}},bankPreparation:{documentsReady:false,accountOpeningIssue:false,relationships:[]}});
const businessPlans = {orgId:ids.org,clientId:ids.client,targetBusinessCount:3,setupStep:3,startedAt:at,hasExistingBusiness:false,homeState:'AZ',postalCode:'85004',availableCashCents:600000,monthlyIncomeCents:750000,cashBufferCents:200000,oneTimePayoffCents:100000,availableEvidence:[],businesses:[business(ids.business,'Cedar Grove LLC','Website design for local shops'),business(ids.business2,'Willow Studio LLC','Commercial photography'),business(ids.business3,'Juniper Services LLC','Office cleaning')],existingBusinesses:[],stepProgress:[],businessPreparation:{},payoffPlan:{strategy:'snowball',monthlyBudgetCents:70000,debts:[{id:'sample-card-a',label:'Sample Card A',balanceCents:240000,aprBps:2199,minimumPaymentCents:7000},{id:'sample-card-b',label:'Sample Card B',balanceCents:85000,aprBps:2699,minimumPaymentCents:3500}]}};
const progress = {orgId:ids.org,clientId:ids.client,nextStep:{waypointId:'sample-mail-letters'},waypoints:[{id:'sample-mail-letters',key:'blueprint_dispute_mail_letters',title:'Review and mail your current letters',detail:'Review the sample letter packet and save a sample submission receipt.',owner:'client',state:'in_progress',verifyKind:'document',completedAt:null},{id:'sample-business',key:'blueprint_business_formation',title:'Prepare your first business',detail:'Save the name, real activity and formation state.',owner:'client',state:'not_started',verifyKind:'document',completedAt:null}]};
const bankPlan = {ok:true,client:{id:ids.client},recommended_banks:[{id:ids.lender,name:'Sample Community Bank',product:'Business checking',minimum_deposit_cents:50000,seasoning_days:90,reason:'Fictional bank for demonstrating saved deposit planning.',steps:['Review the account requirements.','Record the actual opening and deposit dates.'],source:'Fictional demo — not a lender recommendation'}]};
const db = {query:async sql=> /FROM clients/.test(sql)?{rows:[{id:ids.client,org_id:ids.org,first_name:'Alex',last_name:'Sample',custom_fields:{}}]}:/FROM crs_results|FROM documents/.test(sql)?{rows:[]}:(()=>{throw new Error('Unexpected demo-generation query');})()};
const plan = await buildBlueprintClientPlan(db,{orgId:ids.org,clientId:ids.client,now:new Date(at)},{readBusinessPlans:async()=>businessPlans,readClientProgress:async()=>progress,bankStrategy:async()=>bankPlan,preparationGuidance,websitePrompt,rankLocalCreditUnions:async()=>({status:'candidates_for_review',source:{name:'Fictional demo directory',asOf:'2026-11-06'},candidates:[{name:'Sample Community Credit Union',city:'Phoenix',state:'AZ',membership:'Sample membership requirements need review',minimum_deposit_cents:50000}]}),readBlueprintLetterReadiness:async()=>({orgId:ids.org,clientId:ids.client,state:'ready',usableLetterCount:2,mailingOrderCount:0})});
const engagement = {id:ids.engagement,orgId:ids.org,clientId:ids.client,status:'active',executionOwner:'client',roundId:'sample-purchased-round',productKey:'blueprint-self-funding',priceCents:3000000,purchasedAt:at};
const seed = {schema:1,generatedAt:at,ids,session:{ok:true,principal:'client',staff:{id:ids.account,org_id:ids.org,client_id:ids.client,role:'client',name:'Alex Sample'}},plan,
  funding:{ok:true,engagement,state:'optimize',nextAction:'Review your sample repair and inquiry work before opening the next bank.',lenders:[{id:ids.lender,name:'Sample Community Bank',productName:'Sample business credit line',businessId:ids.business,businessName:'Cedar Grove LLC',available:false,reason:'Waiting for the sample bureau evidence review.'}],applications:[],canFinishSubmissions:false,submissionsClosed:false},
  inquiries:{ok:true,cases:[{id:ids.case,bureau:'Experian',status:'In progress',executionOwner:'client',packet:{complete:true,missing:[],uploads:[]},portalUrl:null,documentUploadUrl:null,nextCheckAt:'2026-11-09T12:00:00.000Z',call:{status:'not_requested'},inquiries:[{id:'sample-inquiry',name:'Sample Community Bank inquiry',state:'pending_verification'}],documents:[{id:ids.document,title:'Open sample inquiry packet'}],actions:{canRecordSubmission:true,canLaunchCall:true,canCheckSavedEvidence:true}}]},
  repair:{ok:true,program:{id:'sample-repair-program',round:1},authorization:{signed:true,packetComplete:true,missing:[],uploads:[]},stage:'Ready to prepare sample repair letters',cases:[{id:'sample-repair-case',bureau:'Experian',round:'R1',status:'Ready',portalUrl:null,documentUploadUrl:null,items:[{id:'sample-repair-item',creditor:'Sample reporting item',status:'Open'}],letters:[]}],actions:{canGenerate:true}},
  services:{ok:true,engagement,allowance:{includedAvailable:true,nextIncludedAt:'2026-12-06T12:00:00.000Z',pendingRequestId:null,engagementActive:true},reportSetup:{required:false},checkoutProviders:[{id:'commas',label:'Sample pay in full'},{id:'whop',label:'Sample financing through Whop'}],serviceTypes:[{key:'inquiry_removal',label:'Inquiry removal',priceCents:null,requiresQuote:true,targets:[{id:ids.case,label:'Sample Experian case'}]},{key:'repair_round',label:'One repair round',priceCents:null,requiresQuote:true,targets:[{id:'sample-repair-case',label:'Sample repair round'}]},{key:'full_repair',label:'Full repair',priceCents:null,requiresQuote:true},{key:'funding_round',label:'Funding takeover',priceCents:null,requiresQuote:true,targets:[{id:'sample-purchased-round',label:'Current sample funding round'}]}],requests:[],capabilities:{requestHelp:true,requestReport:true,quote:false}},
  letters:{ok:true,letters:[{id:ids.document,title:'Sample Experian inquiry letter',bureau:'Experian',currentVersionId:'sample-v1',versionId:'sample-v1',download:null},{id:ids.letter,title:'Sample personal-information letter',bureau:'TransUnion',currentVersionId:'sample-v1',versionId:'sample-v1',download:null}],orders:[],returnAddress:{name:'Alex Sample',line1:'100 Example Street',city:'Phoenix',state:'AZ',postalCode:'85004'}},documents:[{id:ids.document,title:'Sample inquiry packet',kind:'inquiry_doc'},{id:ids.letter,title:'Sample personal-information letter',kind:'inquiry_doc'}],messages:[],scenario:'optimize'};
const payoffSource = readFileSync(root+'src/blueprint/payoff-plan.mjs','utf8');
const guidanceSource = readFileSync(root+'src/blueprint/preparation-guidance.mjs','utf8');
seed.funding.applications=[{id:'sample-previous-application',lenderId:'sample-previous-lender',lenderName:'Sample Neighborhood Bank',status:'Sample pending',reportedStatus:'pending',outcomeVerified:false,sample:true}];
seed.services.requests=[{id:'sample-help-quote',serviceKind:'inquiry_removal',status:'quoted',priceCents:50000,quoteVersion:1,note:'Fictional service quote for the demo; not a live price.'}];
seed.letters.letters=seed.letters.letters.map(letter=>({...letter,documentId:letter.id,generatedAt:at,eligibleForMailing:true,reason:null}));
// Capabilities describe local sample previews, never a configured live provider.
seed.letters.capabilities={mailSupported:true,hostedCheckoutSupported:true,savedCardSupported:false};
seed.letters.priceCents=MAILING_PRICE_CENTS;seed.letters.maxLetters=MAX_MAILING_LETTERS;
// The portal and progress renderers consume their existing real reader shapes.
const portalBundle=JSON.parse(readFileSync(root+'src/demo/client-portal-sample-bundle.json','utf8'));
const definitions=JSON.parse(readFileSync(root+'scripts/demo/fixtures/blueprint-waypoint-definitions.json','utf8')).definitions;
const expanded=expandDefinitions({definitions,accounts:revolvingAccounts([['Sample Card A','Experian',2400,8000,null,null,'OPEN'],['Sample Card B','TransUnion',850,5000,null,null,'OPEN']]),state:'AZ',enrolledAt:new Date(at),hasCreditFile:true}).waypoints;
const canonicalWaypoints=expanded.map((w,index)=>({id:`b0000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,key:w.key,order:w.position,title:w.title,detail:w.detail,owner:w.ownerKind,state:w.verifyKind==='no_new_credit'?'in_progress':'not_started',dueAt:w.dueAt,overdue:false,completedAt:null,closedBy:closedBy({owner_kind:w.ownerKind,verify_kind:w.verifyKind}),verifyKind:w.verifyKind,params:w.params,paidAlternative:null}));
seed.schema=2;
seed.offer='implementation';
seed.scenario='start';
seed.firstVisit={scenario:'start',businesses:[],startedAt:null};
seed.offers={preparation:{key:OFFERS.UWIQ_DELIVERABLES.key,productCode:OFFERS.UWIQ_DELIVERABLES.productCode,name:'Capital Blueprint preparation',priceCents:OFFERS.UWIQ_DELIVERABLES.priceMaxCents,minimumCents:OFFERS.UWIQ_DELIVERABLES.priceMinCents,maximumCents:OFFERS.UWIQ_DELIVERABLES.priceMaxCents,contractTemplateKey:OFFERS.UWIQ_DELIVERABLES.contractTemplateKey,hasFundingEngine:false},implementation:{key:OFFERS.BLUEPRINT_SELF_FUNDING.key,productCode:OFFERS.BLUEPRINT_SELF_FUNDING.productCode,name:OFFERS.BLUEPRINT_SELF_FUNDING.name,priceCents:OFFERS.BLUEPRINT_SELF_FUNDING.priceCents,minimumCents:OFFERS.BLUEPRINT_SELF_FUNDING.priceMinCents,maximumCents:OFFERS.BLUEPRINT_SELF_FUNDING.priceMaxCents,contractTemplateKey:OFFERS.BLUEPRINT_SELF_FUNDING.contractTemplateKey,hasFundingEngine:true}};
seed.canonicalWaypoints=canonicalWaypoints;
seed.plan.progress={...structuredClone(portalBundle.reads['/api/read/client-progress']),orgId:ids.org,clientId:ids.client,waypoints:canonicalWaypoints,nextStep:nextStepOf(canonicalWaypoints),deliverables:[],timeline:[],paidServices:[]};
seed.portalSummary=structuredClone(portalBundle.reads['/api/read/portal-summary']);
const targets={inquiry_removal:[{id:ids.case,label:'Sample Experian case'}],repair_round:[{id:'sample-repair-case',label:'Sample repair round'}],funding_round:[{id:engagement.roundId,label:'This purchased sample funding round'}]};
seed.services.serviceTypes=blueprintServiceTypes().map(type=>({...type,targets:targets[type.key]||[]}));
seed.services.requests=[];
seed.readyToFund={...structuredClone(portalBundle.reads['/api/money/ready-to-fund']),offers:{blueprint:{owned:true,name:'Capital Blueprint',sell:{how:'call',url:null}},financeos:{entitled:true,setup_url:null}}};
seed.messages=[{id:'sample-csm-welcome',direction:'outbound',channel:'sms',rendered_body:'Welcome to Fundhub. Start your Blueprint setup, then follow the next step from your own file. Use this conversation for an aged-business question, repair help or optional managed funding. The team reviews your actual facts before quoting work.',body:'Welcome to Fundhub. Your team can guide the next step.',sender_kind:'staff',sender_name:'Fundhub team',status:'sample',created_at:at}];
seed.documents.push(...[['credit_analysis_report','Sample Credit Analysis Report'],['credit_optimization_roadmap','Sample Credit Optimization Roadmap'],['funding_snapshot','Sample Funding Snapshot'],['bank_lender_match_list','Sample Bank and Lender Match List']].map(([subtype,title],index)=>({id:index===0?ids.report:`c0000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,title,subtype,kind:'deliverable',receivedAt:at,sample:true})));
seed.documents=seed.documents.map(doc=>({...doc,subtype:doc.subtype||(doc.id===ids.document?'inquiry_removal_letter':'personal_information_letter'),sample:true}));

// This is built from the documented raw schema only. No vendor fixture identity,
// account, address history, SSN, employer or provider destination is copied.
function fictionalCrsReport(updated=false){const asOf=updated?at:'2026-10-06T12:00:00.000Z';const bureaus={};for(const [code,bureau,score] of [['EX','Experian',updated?712:662],['EQ','Equifax',updated?718:668],['TU','TransUnion',updated?715:665]]){const line=(name,id,type,limit,balance,opened)=>({accountIdentifier:id,accountOpenedDate:opened,accountOwnershipType:'Individual',accountReportedDate:asOf.slice(0,10),accountStatusType:'Open',accountType:type,borrowerSourceType:'Borrower',creditLimitAmount:String(limit),highBalanceAmount:String(limit),currentBalanceAmount:String(balance),creditorName:name,sourceType:bureau,businessType:'Banking',loanType:type==='Revolving'?'CreditCard':'Automobile',monthlyPaymentAmount:type==='Revolving'?'70':'250',monthsReviewedCount:'36',_30DayLates:'0',_60DayLates:'0',_90DayLates:'0',currentRatingCode:'C',currentRatingType:'AsAgreed',paymentPatternData:'CCCCCCCCCCCCCCCCCCCCCCCC',paymentPatternStartDate:asOf.slice(0,10),derogatoryDataIndicator:false});bureaus[code]={requestData:{firstName:'Alex',lastName:'Sample',addresses:[{borrowerResidencyType:'Current',addressLine1:'100 Example Street',city:'Phoenix',state:'AZ',postalCode:'85004'}]},repositoryIncluded:{experian:code==='EX',equifax:code==='EQ',transunion:code==='TU'},responseDetail:{dateRequested:asOf},creditFiles:[{creditFileDetail:{sourceType:bureau,creditFileInfileDate:asOf.slice(0,10),creditFileResultStatusType:'FileReturned'},aliases:[{firstName:'Alex',lastName:'Sample'}],addresses:[{addressLine1:'100 Example Street',city:'Phoenix',state:'AZ',postalCode:'85004',dateReported:asOf.slice(0,10)}]}],scores:[{borrowerSourceType:'Borrower',modelName:'FICO Score 9',modelNameType:'F9',sourceType:bureau,scoreValue:String(score)}],tradelines:[line('Sample Card A','SAMPLE-CARD-A','Revolving',8000,updated?400:2400,'2019-01-01'),line('Sample Card B','SAMPLE-CARD-B','Revolving',5000,updated?250:850,'2021-03-01'),line('Sample Auto Loan','SAMPLE-AUTO','Installment',20000,9000,'2022-02-01')],inquiries:updated?[]:[{creditorName:'Sample Community Bank',inquiryDate:'2026-09-06',sourceType:bureau,businessType:'Banking'}],publicRecords:[],responseAlertMessages:[]};}return{bureaus,bureausPulled:['TU','EX','EQ'],environment:'fictional_demo',simulated:true};}
function creditSnapshot(updated){
  const raw=fictionalCrsReport(updated),asOf=raw.bureaus.EX.responseDetail.dateRequested;
  const OriginalDate=globalThis.Date;
  let scored;
  // Freeze only this synchronous pure generation call for reproducible source
  // findings/age calculations; the shipped browser clock is never changed.
  try{globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[asOf]));}static now(){return new OriginalDate(asOf).getTime();}};scored=runTierEngineFromCrsResult(raw,{submittedName:'Alex Sample',submittedAddress:'100 Example Street, Phoenix, AZ, 85004'});}finally{globalThis.Date=OriginalDate;}
  const analysis=Object.fromEntries(['ok','outcome','consumerSignals','businessSignals','preapprovals','projectedPreapproval','findings'].map(key=>[key,scored[key]]));
  const source={reportId:updated?'sample-crs-report-updated':'sample-crs-report-initial',asOf};
  const creditContext={source:'sample_credit_report',...source,authorizedUserReviewRequired:analysis.consumerSignals.tradelines.au>0,securedCreditReviewRequired:analysis.consumerSignals.tradelines.thinFile,authorizedUserCount:analysis.consumerSignals.tradelines.au,thinFile:analysis.consumerSignals.tradelines.thinFile,authorizedUserFindingCodes:[],sample:true};
  return {raw,analysis,source,creditContext,opportunity:buildFundingOpportunity({analysis,source,businessPlans})};
}
seed.creditSnapshots={initial:creditSnapshot(false),updated:creditSnapshot(true)};
// Canonical shapes for auxiliary FinanceOS tabs, with honestly empty source
// collections. Populated overview/credit/fundability/plan are built from the
// same fictional report and business plan at read time in the adapter.
seed.moneyEmpty={
  alerts:{enrolled:false,settings:{},cards:[],reserve:{},alerts:[]},
  banks:{location:null,containers:[],recommended_banks:[],banks_left_out:[],card_stacking:null,next_sequence:[],next_round:null,relationships:[],not_set:[]},
  connections:{connections:[],containers:[],summary:{connected:0,manual:0},open_api_url:null},
  payments:{owed:[],plans:[],upcoming:[],agent_log:[],agent:null},
  setup:{paid:false,paid_at:null,setup_fee_cents:null,price_per_container_cents:null,containers:0,monthly_cents:null,open_checkout:null,soft_pull:{requested:false,completed:false,last_pulled_at:null,price:{base_cents:null,business_addon_cents:null}},entitled:true,steps:[],current_step:null},
  strategy:{sandbox:true,tip:'Sample planning only. No payments or transfers are made.',inputs:{},targets:[],methods:[],sources:[],defaults:{},plan:[],saved:null},
  transfers:{mode:'sample',limits:{},accounts:[],waiting:[],history:[]},
  trends:{range:'3m',from:null,to:at.slice(0,10),has_history:false,daily:[],monthly:[],sales:[],credit:[],sales_unavailable:true},
  vault:{audience:'client',complete:false,summary:{},scopes:[],items:[],unfiled:[],settings:{}},
  declines:{items:[],declines:[],settings:{},sources:[]},
  helper:{viewer:'client',today:at.slice(0,10),helper:null,turns:[],pending:[]}
};

const progressSource=readFileSync(root+'src/pulse/beats/lib/progress-read.mjs','utf8');
const nextSource=progressSource.match(/export function nextStepOf\(waypoints = \[\]\) \{[\s\S]*?^\}/m)?.[0]?.replace(/^export /,'');
if(!nextSource)throw Error('Canonical progress next-step helper was not found');
seed.provenance = {source:'Fictional values; real Blueprint lesson, waypoint, service-type and debt-allocation helpers',payoffSha256:createHash('sha256').update(payoffSource).digest('hex'),guidanceSha256:createHash('sha256').update(guidanceSource).digest('hex'),progressSha256:createHash('sha256').update(progressSource).digest('hex')};

const payoff = payoffSource.replace(/^export default .*;?$/gm,'').replace(/^export /gm,'');
const guidance = guidanceSource.replace(/^import .*;\s*$/gm,'').replace(/^export default .*;?$/gm,'').replace(/^export /gm,'');
const opportunitySource=readFileSync(root+'src/blueprint/funding-opportunity.mjs','utf8').split('/** Existing scoped reads')[0].replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
seed.provenance.opportunitySha256=createHash('sha256').update(opportunitySource).digest('hex');
const json=JSON.stringify(seed,null,2)+'\n';
const generated = `const DATA = ${JSON.stringify(seed)};\nconst realSetupSteps=${setupSteps.toString()};\nconst realFundingOpportunity=(()=>{${opportunitySource}\nreturn buildFundingOpportunity;})();\nconst realNextStep = (()=>{const OPEN_STATES = new Set(['not_started','in_progress','blocked']);\n${nextSource}\nreturn nextStepOf;})();\nconst realDebtPlanner = (() => {\n${payoff}\nreturn planMonthlyDebtPayments;\n})();\nconst realGuidance = (() => {\nconst PAYOFF_SOURCE_URL = ${JSON.stringify('https://www.consumerfinance.gov/documents/5782/cfpb_ymyg-toolkit_reducing-debt-worksheet.pdf')};\n${guidance}\nreturn {preparationGuidance,websitePrompt};\n})();`;
const adapterPath=root+'public/app/blueprint-demo.js';
const adapter=readFileSync(adapterPath,'utf8');
if (!adapter.includes('// BEGIN GENERATED BLUEPRINT DATA') || !adapter.includes('// END GENERATED BLUEPRINT DATA')) throw new Error('Demo adapter generation markers are missing');
const output=adapter.replace(/\/\/ BEGIN GENERATED BLUEPRINT DATA[\s\S]*?\/\/ END GENERATED BLUEPRINT DATA/,`// BEGIN GENERATED BLUEPRINT DATA\n${generated}\n// END GENERATED BLUEPRINT DATA`);
if(process.argv.includes('--check')) {
  if(readFileSync(root+'public/app/blueprint-demo-data.json','utf8')!==json||adapter!==output) { console.error('Blueprint demo generated data is stale');process.exitCode=1; }
  else console.log('Blueprint demo generated data is current');
} else {writeFileSync(root+'public/app/blueprint-demo-data.json',json);writeFileSync(adapterPath,output);console.log('Generated fictional full Blueprint dashboard data');}
