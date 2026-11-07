// Generates fictional dashboard data and embeds the existing pure lesson/payment
// helpers into its isolated browser adapter. Never connects to a database/provider.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { cardStacking, INQUIRY_RULE, recommendBank, relationshipView, SOURCES as BANK_SOURCES, CRS_SQL as BANK_CRS_SQL } from '../../src/finance/bank-strategy.mjs';
import { buildFundability } from '../../src/finance/fundability.mjs';
import { countFields } from '../../src/finance/sample-credit-file.mjs';
import { tradelineView, ENTITIES_SQL as TL_ENTITIES_SQL, BUSINESSES_SQL as TL_BUSINESSES_SQL, ACCOUNTS_SQL as TL_ACCOUNTS_SQL,
  STAFF_LINES_SQL as TL_STAFF_LINES_SQL, ENTRIES_SQL as TL_ENTRIES_SQL, BOOK_SQL as TL_BOOK_SQL } from '../../src/finance/tradeline-inventory.mjs';
import { parseLenderCsv } from '../../src/lenders/csv.mjs';
import { resolveLogoPath } from '../../src/lenders/resolve-logo.mjs';
import { applicationGuide, fullReportRows, inquiryCall, letterCycle } from '../../src/blueprint/fulfillment-cycle.mjs';
import { BUREAU_SCRIPTS, bureauDialPlan } from '../../src/inquiry-ops/bureau-dial-plan.mjs';
import { detectIncome, TRANSFER_MATCH_DAYS, WINDOW_DAYS } from '../../src/banking/income.mjs';
import { samplePayloads as localBankSamples } from '../../src/http/fixtures/local-banks.sample.mjs';
import { fileAlertsPayload } from '../../src/finance/file-alerts/read.mjs';
import { SMART_KINDS } from '../../src/finance/file-alerts/board.mjs';
import { readName, readAmount, readCustomInput, customView, CUSTOM_ITEM_KINDS, CUSTOM_SCOPES, NAME_MAX, AMOUNT_MAX_CENTS, ITEMS_MAX, MAX_YEARS_AHEAD, MAX_YEARS_BACK } from '../../src/finance/file-alerts/custom.mjs';
import { FileAlertInputError } from '../../src/finance/file-alerts/store.mjs';
import { addDaysIso } from '../../src/finance/file-alerts/common.mjs';
import { REMIND_DAYS_BEFORE } from '../../src/pulse/beats/lib/card-due-plan.mjs';
import { ACCOUNT_SQL } from '../../src/finance/money-overview.mjs';
import { findBillProblems, READ_DAYS as CLEANUP_READ_DAYS } from '../../src/banking/bill-cleanup.mjs';
import { normaliseMerchant } from '../../src/banking/recurring.mjs';
import { nextOccurrence } from '../../src/banking/statement-cycles.mjs';
import { isUuid } from '../../src/http/read-api.mjs';

// The current engine uses local calendar months for account ages. Pin this
// standalone generator so the fictional fixture is identical on macOS and CI.
process.env.TZ = 'UTC';
// The sample bureau call shows the number written in each call script, never a
// host setting, so the fixture is the same wherever it is built.
for (const script of BUREAU_SCRIPTS) delete process.env[script.env];

const root = fileURLToPath(new URL('../../', import.meta.url));
const at = '2026-11-06T12:00:00.000Z';
const ids = Object.fromEntries(['org','client','account','engagement','case','lender','document','application','business','business2','business3','letter','report'].map((key,i)=>[key,`a0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const business = (id,name,activity) => ({id,name,activity,formationState:'AZ',operatingState:'AZ',formationStatus:'planned',formationDate:null,ownershipSince:null,operatingSince:null,website:null,evidence:{formation:{status:'not_added'},ein:{status:'not_added'}},bankPreparation:{documentsReady:false,accountOpeningIssue:false,relationships:[]}});
const businessPlans = {orgId:ids.org,clientId:ids.client,targetBusinessCount:3,setupStep:3,startedAt:at,hasExistingBusiness:false,homeState:'AZ',postalCode:'85004',availableCashCents:600000,monthlyIncomeCents:750000,cashBufferCents:200000,oneTimePayoffCents:100000,availableEvidence:[],businesses:[business(ids.business,'Cedar Grove LLC','Website design for local shops'),business(ids.business2,'Willow Studio LLC','Commercial photography'),business(ids.business3,'Juniper Services LLC','Office cleaning')],existingBusinesses:[],stepProgress:[],businessPreparation:{},payoffPlan:{strategy:'snowball',monthlyBudgetCents:70000,debts:[{id:'sample-card-a',label:'Sample Card A',balanceCents:240000,aprBps:2199,minimumPaymentCents:7000},{id:'sample-card-b',label:'Sample Card B',balanceCents:85000,aprBps:2699,minimumPaymentCents:3500}]}};
const progress = {orgId:ids.org,clientId:ids.client,nextStep:{waypointId:'sample-mail-letters'},waypoints:[{id:'sample-mail-letters',key:'blueprint_dispute_mail_letters',title:'Review and mail your current letters',detail:'Review the sample letter packet and save a sample submission receipt.',owner:'client',state:'in_progress',verifyKind:'document',completedAt:null},{id:'sample-business',key:'form_llc',title:'Prepare your first business',detail:'Save the name, real activity and formation state.',owner:'client',state:'not_started',verifyKind:'document',completedAt:null}]};
const bankPlan = {ok:true,client:{id:ids.client},recommended_banks:[{id:ids.lender,name:'Sample Community Bank',product:'Business checking',minimum_deposit_cents:50000,seasoning_days:90,reason:'Fictional bank for demonstrating saved deposit planning.',steps:['Review the account requirements.','Record the actual opening and deposit dates.'],source:'Fictional demo — not a lender recommendation'}]};
const db = {query:async sql=> /FROM clients/.test(sql)?{rows:[{id:ids.client,org_id:ids.org,first_name:'Alex',last_name:'Sample',custom_fields:{}}]}:/FROM crs_results|FROM documents/.test(sql)?{rows:[]}:(()=>{throw new Error('Unexpected demo-generation query');})()};
const planScope={orgId:ids.org,clientId:ids.client,now:new Date(at)};
// The plan's fictional bank read keeps its own sample bank. The banks near Alex
// Sample are their own read in the demo (GET /api/money/banks?view=local_banks,
// seed.localBanks below, from src/http/fixtures/local-banks.sample.mjs).
const planDeps={readBusinessPlans:async()=>businessPlans,readClientProgress:async()=>progress,bankStrategy:async()=>bankPlan,attachLocalBanks:async(_db,{payload})=>payload,preparationGuidance,websitePrompt,rankLocalCreditUnions:async()=>({status:'candidates_for_review',source:{name:'Fictional demo directory',asOf:'2026-11-06'},candidates:[{name:'Sample Community Credit Union',city:'Phoenix',state:'AZ',membership:'Sample membership requirements need review',minimum_deposit_cents:50000}]}),readBlueprintLetterReadiness:async()=>({orgId:ids.org,clientId:ids.client,state:'ready',usableLetterCount:2,mailingOrderCount:0})};
const plan = await buildBlueprintClientPlan(db,planScope,planDeps);
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
// 3: letters keep the client's approval (unit CYCLE). A saved older sample starts fresh.
seed.schema=3;
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
// Each account number ends in the last 4 its bank account shows (the masks the
// sample money year uses below), so the report and the bank name the same
// account (What you have joins them into one row).
const SAMPLE_MASKS={'Sample Card A':'1144','Sample Card B':'7302','Sample Auto Loan':'5517'};
const reportAccount=name=>'XXXXXXXX'+SAMPLE_MASKS[name];
function fictionalCrsReport(updated=false){const asOf=updated?at:'2026-10-06T12:00:00.000Z';const bureaus={};for(const [code,bureau,score] of [['EX','Experian',updated?712:662],['EQ','Equifax',updated?718:668],['TU','TransUnion',updated?715:665]]){const line=(name,id,type,limit,balance,opened)=>({accountIdentifier:id,accountOpenedDate:opened,accountOwnershipType:'Individual',accountReportedDate:asOf.slice(0,10),accountStatusType:'Open',accountType:type,borrowerSourceType:'Borrower',creditLimitAmount:String(limit),highBalanceAmount:String(limit),currentBalanceAmount:String(balance),creditorName:name,sourceType:bureau,businessType:'Banking',loanType:type==='Revolving'?'CreditCard':'Automobile',monthlyPaymentAmount:type==='Revolving'?'70':'250',monthsReviewedCount:'36',_30DayLates:'0',_60DayLates:'0',_90DayLates:'0',currentRatingCode:'C',currentRatingType:'AsAgreed',paymentPatternData:'CCCCCCCCCCCCCCCCCCCCCCCC',paymentPatternStartDate:asOf.slice(0,10),derogatoryDataIndicator:false});bureaus[code]={requestData:{firstName:'Alex',lastName:'Sample',addresses:[{borrowerResidencyType:'Current',addressLine1:'100 Example Street',city:'Phoenix',state:'AZ',postalCode:'85004'}]},repositoryIncluded:{experian:code==='EX',equifax:code==='EQ',transunion:code==='TU'},responseDetail:{dateRequested:asOf},creditFiles:[{creditFileDetail:{sourceType:bureau,creditFileInfileDate:asOf.slice(0,10),creditFileResultStatusType:'FileReturned'},aliases:[{firstName:'Alex',lastName:'Sample'}],addresses:[{addressLine1:'100 Example Street',city:'Phoenix',state:'AZ',postalCode:'85004',dateReported:asOf.slice(0,10)}]}],scores:[{borrowerSourceType:'Borrower',modelName:'FICO Score 9',modelNameType:'F9',sourceType:bureau,scoreValue:String(score)}],tradelines:[line('Sample Card A',reportAccount('Sample Card A'),'Revolving',8000,updated?400:2400,'2019-01-01'),line('Sample Card B',reportAccount('Sample Card B'),'Revolving',5000,updated?250:850,'2021-03-01'),line('Sample Auto Loan',reportAccount('Sample Auto Loan'),'Installment',20000,9000,'2022-02-01')],inquiries:updated?[]:[{creditorName:'Sample Community Bank',inquiryDate:'2026-09-06',sourceType:bureau,businessType:'Banking'}],publicRecords:[],responseAlertMessages:[]};}return{bureaus,bureausPulled:['TU','EX','EQ'],environment:'fictional_demo',simulated:true};}
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
  return {raw,analysis,source,creditContext,opportunity:buildFundingOpportunity({analysis,source,businessPlans}),engine:scored};
}
const snapshots={initial:creditSnapshot(false),updated:creditSnapshot(true)};
seed.creditSnapshots=Object.fromEntries(Object.entries(snapshots).map(([key,{engine,...snap}])=>[key,snap]));
// "Your path" (src/waypoints/blueprint-path.mjs) for each demo stage that has a
// pull, built by the same plan read from saved pulls that carry the engine's
// FULL output (normalized included), so each card's use is read off the pull
// the way the live read does: one pull (optimize), then first -> newest
// (ready/completed). The stage with no pull keeps plan.path above.
const pullRow=snap=>({id:snap.source.reportId,org_id:ids.org,client_id:ids.client,provider:'fictional_demo',created_at:snap.source.asOf,result:snap.engine});
// The pulls as the Finance OS reads take them (unit PREM's fundability, unit TL's
// What you have): the report with what the engine printed on it, the way a saved
// pull keeps both (src/finance/sample-credit-file.mjs withEngineResult), newest
// first. The counts a pull leaves on the client (countFields) are counted from
// this report the way that file counts its own: inquiries per bureau, negative
// lines, late payments.
const savedPull=snap=>({id:snap.source.reportId,provider:'fictional_demo',is_demo:false,result:{...snap.raw,...snap.engine},created_at:snap.source.asOf});
const pullsFor={none:[],initial:[savedPull(snapshots.initial)],updated:[savedPull(snapshots.updated),savedPull(snapshots.initial)]};
function reportCounts(raw){
  const lines=Object.values(raw.bureaus).flatMap(b=>b.tradelines||[]);
  return {inquiries:Object.fromEntries(['EX','EQ','TU'].map(code=>[code,(raw.bureaus[code].inquiries||[]).length])),
    negativeItems:lines.filter(l=>l.derogatoryDataIndicator===true).length,
    latePayments:lines.reduce((n,l)=>n+Number(l._30DayLates)+Number(l._60DayLates)+Number(l._90DayLates),0)};
}
// Fundability: the real read (src/finance/fundability.mjs buildFundability) on
// those pulls, for its six checks, ring and tier. Its own dollar estimate comes
// out $0 on this report (it finds no opened dates on the lines), so the dollar
// figure the demo shows stays the engine's funding opportunity, as before.
// The engine inside ages accounts by the clock, so the clock is the pull day
// here too (the same freeze creditSnapshot uses), and every build is the same.
function onPullDay(asOf,fn){
  const OriginalDate=globalThis.Date;
  try{globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[asOf]));}static now(){return new OriginalDate(asOf).getTime();}};return fn();}
  finally{globalThis.Date=OriginalDate;}
}
seed.fundability=Object.fromEntries(['initial','updated'].map(key=>{
  const snap=snapshots[key],read=onPullDay(snap.source.asOf,()=>buildFundability({client:{id:ids.client,first_name:'Alex',last_name:'Sample',
    custom_fields:countFields(reportCounts(snap.raw))},asOf:new Date(snap.source.asOf),crsRows:pullsFor[key]}));
  if(!read.has_pull)throw Error('The sample fundability read found no pull: '+key);
  return [key,{score:read.now.score,score_max:read.now.score_max,unknown:read.now.unknown,tier:read.now.tier,factors:read.now.factors,missing:read.now.missing,sentences:read.now.sentences}];
}));
// The path's fundability and business figure come from the demo's OWN Fundability
// read (public/app/blueprint-demo.js moneyFundability): the checks above, and the
// same pull's opportunity for each business.
const demoFundability=snap=>{const f=seed.fundability[snap===snapshots.updated?'updated':'initial'];
  return {score:f.score,score_max:f.score_max,unknown:f.unknown,tier:f.tier,
    businesses:snap.opportunity.businesses.map(b=>({business_id:b.businessId||null,name:b.name,age_months:null,estimate_cents:b.currentCents??null,multiplier:null}))};};
async function pathFromPulls(newest,first,snap){
  const pulls={query:async(sql,params)=>/FROM crs_results/.test(sql)?{rows:[/ORDER BY created_at ASC/.test(sql)?first:newest]}:db.query(sql,params)};
  return (await buildBlueprintClientPlan(pulls,planScope,{...planDeps,readFundability:async()=>demoFundability(snap)})).path;
}
seed.creditPaths={initial:await pathFromPulls(pullRow(snapshots.initial),pullRow(snapshots.initial),snapshots.initial),updated:await pathFromPulls(pullRow(snapshots.updated),pullRow(snapshots.initial),snapshots.updated)};
// Canonical shapes for the FinanceOS tabs that have nothing honest to show for
// this sample (no funding papers, no money-helper turns) plus the setup base.
// Every other tab is built at read time in the adapter from the fictional
// report, the business plan and the sample money year (seed.money) below.
seed.moneyEmpty={
  setup:{paid:false,paid_at:null,setup_fee_cents:null,price_per_container_cents:null,containers:0,monthly_cents:null,open_checkout:null,soft_pull:{requested:false,completed:false,last_pulled_at:null,price:{base_cents:null,business_addon_cents:null}},entitled:true,steps:[],current_step:null},
  vault:{audience:'client',complete:false,summary:{},scopes:[],items:[],unfiled:[],settings:{}},
  declines:{items:[],declines:[],settings:{},sources:[]},
  helper:{viewer:'client',today:at.slice(0,10),helper:null,turns:[],pending:[]}
};

// ---------------------------------------------------------------------------
// One year of fictional money history for the FinanceOS demo (unit G).
// Ported from the prototype Chris approved (ops/workflows/finance-os-cfo-demo-2026-11-06.html):
// the same seeded generator (seed 20261106), start day, bills and Stripe
// payouts, drawn in the same order. It is one sample person, so a fact this
// file already prints wins over the prototype's typed copy of it (root call
// 2026-11-07 under sample-clients-consistent):
//   * Card A $2,400 -> $400 and Card B $850 -> $250 on the two pull days: the
//     engine report's own lines, hit exactly by running the year twice.
//   * Card APRs and minimums: the saved Blueprint payoff plan. The auto loan:
//     the report's balance and monthly payment; its rate is not on file (null).
//   * Personal cash on the latest pull day: the plan's available cash. Money
//     coming in: the plan's monthly income. Cash buffer: the plan's buffer.
// Money is integer cents. No business accounts: the three LLCs are not formed,
// so business cash stays unknown (null), never $0.
const MONEY_SEED=20261106;
const MONEY_START='2025-11-07';
const MONEY_LENGTH=365;
const MONEY_DAY=864e5;
/* Everyday debit spending per day, in dollars. The prototype's 10–60 was set
   for its own paycheck; with the plan's $7,500 a month coming in, this range
   saves a little each month, keeps checking above zero all year and lands
   on the plan's cash. */
const SAMPLE_DAILY_SPEND=[70,170];
const moneyTime=day=>Date.parse(day+'T00:00:00Z');
const moneyIso=time=>new Date(time).toISOString().slice(0,10);
function moneyRandom(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const reportLine=(snapshot,name)=>{const line=snapshot.raw.bureaus.EX.tradelines.find(l=>l.creditorName===name);if(!line)throw Error('Report line missing: '+name);return line;};
const reportCents=(line,field)=>Math.round(Number(line[field])*100);

/** The five sample accounts. Every fact names where it comes from. */
function sampleMoneyAccounts(snapshots,plans){
  const debt=label=>plans.payoffPlan.debts.find(d=>d.label===label);
  const card=(key,id,name,mask,due,close)=>{const line=reportLine(snapshots.initial,name),saved=debt(name);
    return {key,id,name,mask,type:'credit',subtype:'credit card',limit_cents:reportCents(line,'creditLimitAmount'),apr_bps:saved.aprBps,min_cents:saved.minimumPaymentCents,due_day:due,statement_close_day:close,opened_on:line.accountOpenedDate};};
  const loan=reportLine(snapshots.initial,'Sample Auto Loan');
  return [
    {key:'chk',id:'sample-checking',name:'Sample Everyday Checking',mask:'4821',type:'depository',subtype:'checking'},
    {key:'sav',id:'sample-savings',name:'Sample High-Yield Savings',mask:'9930',type:'depository',subtype:'savings',apy_bps:400},
    card('cardA','sample-card-a','Sample Card A',SAMPLE_MASKS['Sample Card A'],25,21),
    card('cardB','sample-card-b','Sample Card B',SAMPLE_MASKS['Sample Card B'],18,14),
    {key:'loan',id:'sample-auto-loan',name:'Sample Auto Loan',mask:SAMPLE_MASKS['Sample Auto Loan'],type:'loan',subtype:'auto',original_cents:reportCents(loan,'creditLimitAmount'),apr_bps:null,payment_cents:reportCents(loan,'monthlyPaymentAmount'),due_day:15,opened_on:loan.accountOpenedDate}
  ];
}

/* The prototype's repeat bills, in cents. `important` is the prototype's own
   starting set for phone alerts: the tech stack and the auto loan. */
const SAMPLE_BILLS=[
  {key:'rent',name:'Rent',day:1,cents:210000,category:'Home',important:false},
  {key:'gws',name:'Google Workspace',day:3,cents:1440,category:'Tech stack',important:true},
  {key:'gym',name:'Gym',day:5,cents:4500,category:'Personal',important:false},
  {key:'vz',name:'Verizon Wireless',day:8,cents:9500,category:'Phone',important:false},
  {key:'gpt',name:'ChatGPT Plus',day:9,cents:2000,category:'Tech stack',important:true},
  {key:'cox',name:'Cox Internet',day:12,cents:8000,category:'Home',important:false},
  {key:'adobe',name:'Adobe Creative Cloud',day:14,cents:5499,category:'Tech stack',important:true,changes:[{from:'2026-09-01',cents:5999}]},
  {key:'auto',name:'Sample Auto Loan payment',day:15,cents:null,category:'Loan',important:true,account:'sample-auto-loan'},
  {key:'notion',name:'Notion',day:18,cents:1000,category:'Tech stack',important:true},
  {key:'geico',name:'GEICO Auto Insurance',day:20,cents:16200,category:'Insurance',important:false}
];
const SAMPLE_MERCHANTS={payroll:{name:'Sample Employer Inc · Payroll',category:'Paycheck'},stripe:{name:'Stripe · Payout',category:'Merchant payout'},zelle:{name:'Zelle from J. Rivera',category:'One-time deposit'},
  from_savings:{name:'Transfer from Savings ••9930',category:'Own transfer'},to_checking:{name:'Transfer to Checking ••4821',category:'Own transfer'},
  to_savings:{name:'Transfer to Savings ••9930',category:'Own transfer'},from_checking:{name:'Transfer from Checking ••4821',category:'Own transfer'},
  spend:{name:'Debit card purchases',category:'Everyday spending'},pay_card_a:{name:'Payment · Sample Card A',category:'Card payment'},
  pay_card_b:{name:'Payment · Sample Card B',category:'Card payment'},interest:{name:'Interest paid',category:'Interest'},
  ...Object.fromEntries(SAMPLE_BILLS.map(b=>[b.key,{name:b.name,category:b.category}]))};

/**
 * One run of the prototype's day-by-day model, in integer cents.
 * p = { payroll, chk, sav, cardA, cardB, keepA, keepB, loan, initialDay }
 * keepA/keepB: what each card keeps after its pay-down step (Oct 9 / Oct 10).
 * Returns balances per account per day, every checking/savings transaction
 * (negative = money left), the Stripe payouts, and the card spend since each
 * card's last payment (the second run uses it to land on the report exactly).
 */
function runSampleYear(p){
  const days=Array.from({length:MONEY_LENGTH},(_,i)=>moneyIso(moneyTime(MONEY_START)+i*MONEY_DAY));
  const R=moneyRandom(MONEY_SEED),draw=(a,b)=>Math.round((a+R()*(b-a))*100);
  let chk=p.chk,sav=p.sav,A=p.cardA,B=p.cardB,spendA=0,spendB=0,tailA=0,tailB=0,accrued=0;
  const balances={chk:[],sav:[],cardA:[],cardB:[],loan:[]},rows=[],payouts=[];
  const tx=(i,account,amount,merchant)=>rows.push([i,account,amount,merchant]);
  for(let i=0;i<MONEY_LENGTH;i++){
    const d=days[i],dt=new Date(moneyTime(d)),dom=dt.getUTCDate(),dow=dt.getUTCDay();
    if(dow===5&&Math.round((moneyTime(d)-moneyTime('2025-11-14'))/MONEY_DAY)%14===0){chk+=p.payroll;tx(i,'chk',p.payroll,'payroll');}
    if(dow===2){const payout=draw(250,460);chk+=payout;tx(i,'chk',payout,'stripe');payouts.push([i,payout]);}
    if(d==='2026-07-18'){chk+=30000;tx(i,'chk',30000,'zelle');}
    if(d==='2026-03-06'){chk+=150000;sav-=150000;tx(i,'chk',150000,'from_savings');tx(i,'sav',-150000,'to_checking');}
    for(const b of SAMPLE_BILLS){
      if(dom!==b.day)continue;
      const amount=b.key==='auto'?p.loanPayment:(b.changes||[]).filter(c=>d>=c.from).at(-1)?.cents??b.cents;
      chk-=amount;tx(i,'chk',-amount,b.key);
      if(b.key==='gws'&&d==='2026-10-03'){chk-=amount;tx(i,'chk',-amount,b.key);}
    }
    const spend=draw(...SAMPLE_DAILY_SPEND);chk-=spend;tx(i,'chk',-spend,'spend');
    const sa=draw(0,44),sb=draw(0,18);A+=sa;B+=sb;spendA+=sa;spendB+=sb;tailA+=sa;tailB+=sb;
    if(dom===2){chk-=10000;sav+=10000;tx(i,'chk',-10000,'to_savings');tx(i,'sav',10000,'from_checking');}
    if(d<p.initialDay&&dom===25){const pay=spendA+draw(-80,40);A-=pay;chk-=pay;spendA=0;tailA=0;tx(i,'chk',-pay,'pay_card_a');}
    if(d<p.initialDay&&dom===18){const pay=spendB+draw(-30,20);B-=pay;chk-=pay;spendB=0;tailB=0;tx(i,'chk',-pay,'pay_card_b');}
    // The Blueprint pay-down steps, then each statement paid in full.
    if(d==='2026-10-09'){const pay=A-p.keepA;A-=pay;chk-=pay;spendA=0;tailA=0;tx(i,'chk',-pay,'pay_card_a');}
    if(d==='2026-10-10'){const pay=B-p.keepB;B-=pay;chk-=pay;spendB=0;tailB=0;tx(i,'chk',-pay,'pay_card_b');}
    if(d>'2026-10-10'&&dom===25){A-=spendA;chk-=spendA;tx(i,'chk',-spendA,'pay_card_a');spendA=0;tailA=0;}
    if(d>'2026-10-10'&&dom===18){B-=spendB;chk-=spendB;tx(i,'chk',-spendB,'pay_card_b');spendB=0;tailB=0;}
    accrued+=sav*p.savingsApyBps/10000/365;
    if(dom===1&&i>0){const paid=Math.round(accrued);sav+=paid;accrued-=paid;tx(i,'sav',paid,'interest');}
    balances.chk.push(chk);balances.sav.push(sav);balances.cardA.push(A);balances.cardB.push(B);balances.loan.push(p.loan);
  }
  return {days,balances,rows,payouts,tail:{cardA:tailA,cardB:tailB}};
}

/* The 90-day repeat-deposit average, read the prototype's way. */
function ninetyDayAverage(year,merchant,endDay){
  const end=moneyTime(endDay),start=end-90*MONEY_DAY;
  const hits=year.rows.filter(r=>r[3]===merchant&&moneyTime(year.days[r[0]])>start&&moneyTime(year.days[r[0]])<=end);
  return hits.length?hits.reduce((s,r)=>s+r[2],0)/hits.length:null;
}

/**
 * The year, run twice. The first run measures; the second starts each card
 * where it must so the report's lines are hit exactly on both pull days, pays
 * the paycheck that makes money coming in the plan's monthly income, and
 * starts checking where personal cash is the plan's available cash on the
 * latest pull day. Every day-to-day change still comes from the same draws.
 */
function simulateSampleYear({accounts,snapshots,plans}){
  const initialDay=snapshots.initial.source.asOf.slice(0,10),updatedDay=snapshots.updated.source.asOf.slice(0,10);
  const acct=Object.fromEntries(accounts.map(a=>[a.key,a]));
  const target=(snap,name)=>reportCents(reportLine(snap,name),'currentBalanceAmount');
  const base={initialDay,chk:0,sav:280000,cardA:235000,cardB:82000,keepA:0,keepB:0,payroll:215000,
    loan:target(snapshots.initial,'Sample Auto Loan'),loanPayment:acct.loan.payment_cents,savingsApyBps:acct.sav.apy_bps};
  const first=runSampleYear(base);
  const i1=first.days.indexOf(initialDay),i2=first.days.indexOf(updatedDay);
  if(i1<0||i2!==MONEY_LENGTH-1)throw Error('The sample year must hold both pull days and end on the latest one');
  const stripe=ninetyDayAverage(first,'stripe',updatedDay);
  const payroll=Math.round((plans.monthlyIncomeCents-stripe*52/12)*12/26);
  const second=runSampleYear({...base,payroll,
    cardA:base.cardA+target(snapshots.initial,'Sample Card A')-first.balances.cardA[i1],
    cardB:base.cardB+target(snapshots.initial,'Sample Card B')-first.balances.cardB[i1],
    keepA:target(snapshots.updated,'Sample Card A')-first.tail.cardA,
    keepB:target(snapshots.updated,'Sample Card B')-first.tail.cardB});
  const shift=plans.availableCashCents-(second.balances.chk[i2]+second.balances.sav[i2]);
  second.balances.chk=second.balances.chk.map(v=>v+shift);
  const checks=[['cardA',i1,target(snapshots.initial,'Sample Card A')],['cardA',i2,target(snapshots.updated,'Sample Card A')],
    ['cardB',i1,target(snapshots.initial,'Sample Card B')],['cardB',i2,target(snapshots.updated,'Sample Card B')],['loan',i1,base.loan],['loan',i2,target(snapshots.updated,'Sample Auto Loan')]];
  for(const [key,i,cents] of checks)if(second.balances[key][i]!==cents)throw Error(`Sample ${key} missed the report on ${second.days[i]}`);
  if(second.balances.chk[i2]+second.balances.sav[i2]!==plans.availableCashCents)throw Error('Sample cash missed the plan');
  for(const [key,series] of Object.entries(second.balances))if(series.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Sample '+key+' went below zero');
  return {...second,payroll,initialDay,updatedDay,openingChecking:shift};
}

/* Bank recommendations come from the bank book itself (the CSV the lenders
   table loads from), through the real recommendBank(). Its words decide the
   seasoning days; its empty minimum_deposit column stays "not set". Each real
   bank carries its own mark through the real resolveLogoPath() (owner rule
   2026-11-07: every bank shows its own logo); logo_path is the lenders read's field. */
function sampleBankBook(){
  const book=parseLenderCsv(readFileSync(root+'docs/legacy-strong/lenders-legacy-strong.csv','utf8')).rows;
  return ['LEGACY-INBRANCHBIZCC-CHASE','LEGACY-ONLINEBIZCC-BANK-OF-AMERICA'].map(ref=>{
    const row=book.find(r=>r.external_row_id===ref);if(!row)throw Error('Bank book row missing: '+ref);
    const quote=String(row.stated_requirements).split(/[;\n]+|(?<=[.!?])\s+/).map(s=>s.trim()).find(s=>/\$5K/.test(s));
    if(!quote)throw Error('Bank book seasoning amount missing: '+ref);
    const logo_path=resolveLogoPath({name:row.name,externalRowId:row.external_row_id,exists:rel=>existsSync(root+'public'+rel)});
    if(!logo_path)throw Error('Bank book logo missing: '+ref);
    return {book:{...row,id:null,logo_path},recommended:{...recommendBank({...row,id:null,lane:'business',covers_states:['AZ']},{states:['AZ']}),logo_path},deposit_quote:quote};
  });
}

/* Money coming in: the repeat deposits in the 90 days up to a day, the way the
   prototype's detector reads them. One-time money and own transfers are named
   and left out. Unit C's detector contract adds its fields here. */
function sampleIncomeModel(){
  return {window_days:90,streams:[
    {key:'payroll',name:'Paycheck · Sample Employer Inc',cadence:'biweekly',per_year:26,kind:'personal',merchant:'payroll'},
    {key:'stripe',name:'Stripe payouts',cadence:'weekly',per_year:52,kind:'personal',merchant:'stripe'}],
    left_out:[{merchant:'zelle',reason:'Happened once. One-time money is not counted.'},{merchant:'from_savings',reason:'Your own money moving between your accounts.'}]};
}

/* Staff planned both banks for the first business at $5,000: the bank book's
   own "$5K" seasoning sentence is the reason. Nothing is opened or deposited
   yet. relationshipView() is the real tracker line for each pull day. */
function sampleBankPlan(banks,plans,days){
  const first=plans.businesses[0];
  const rows=banks.map((b,i)=>({id:`sample-bank-plan-${i+1}`,bank_key:b.book.name.trim().toLowerCase(),bank_name:b.book.name,account_kind:'business',lender_id:null,entity_id:first.id,
    state:'planned',planned_open_on:null,planned_deposit_cents:500000,opened_on:null,notes:'Staff plan from the bank book: '+b.deposit_quote}));
  const containers=new Map([[first.id,{name:first.name}]]);
  return {rows,views:Object.fromEntries(Object.entries(days).map(([key,today])=>[key,rows.map((row,i)=>({...relationshipView(row,{today,deposits:[],book:banks[i].book,containers}),logo_path:banks[i].book.logo_path}))]))};
}

/* The card order for the same two bank book rows, through the real
   cardStacking(), once per credit file the demo can show (none yet, the first
   pull, the latest pull) so its inquiry counts are that file's own. The
   inquiry note uses the real read's own words and sources. UnderwriteIQ's
   card-stack verdict is not run on this sample, so it stays out (no engine). */
function sampleCardStacking(banks,planRows,snapshots){
  const matches=banks.map(b=>({...b.book,lane:'business',covers_states:['AZ']}));
  const inquiries=snap=>({total:snap.analysis.consumerSignals.inquiries.total,by_bureau:Object.fromEntries([['experian','EX'],['equifax','EQ'],['transunion','TU']].map(([name,code])=>[name,snap.raw.bureaus[code].inquiries.length]))});
  const stack=snap=>{const inq=snap?inquiries(snap):null,out=cardStacking(matches,{relationships:planRows,inquiries:inq});
    out.inquiries={total:inq?inq.total:null,by_bureau:inq?inq.by_bureau:null,text:inq?`You have ${inq.total} inquir${inq.total===1?'y':'ies'} now. Each new card adds a hard pull.`:'Your inquiry count: not on file yet.',source:BANK_SOURCES.creditFile,rule:{text:INQUIRY_RULE,source:BANK_SOURCES.ownerInquiries}};
    return out;};
  return {none:stack(null),initial:stack(snapshots.initial),updated:stack(snapshots.updated)};
}

function buildSampleMoney({snapshots,plans}){
  const accounts=sampleMoneyAccounts(snapshots,plans);
  const year=simulateSampleYear({accounts,snapshots,plans});
  const banks=sampleBankBook();
  const asOf={initial:year.initialDay,updated:year.updatedDay};
  const bankPlan=sampleBankPlan(banks,plans,asOf);
  return {
    schema:1,seed:MONEY_SEED,currency:'usd',start:MONEY_START,days:MONEY_LENGTH,asOf,
    source:'Fictional sample: the approved FinanceOS prototype model (seed 20261106), pinned to this file\'s engine report and saved Blueprint plan.',
    pins:{cards:'creditSnapshots raw EX tradelines on both pull days',card_terms:'plan.businessPlans.payoffPlan.debts',loan:'creditSnapshots raw EX tradeline; rate not on file',
      cash:'plan.businessPlans.availableCashCents on '+asOf.updated,income:'plan.businessPlans.monthlyIncomeCents',buffer:'plan.businessPlans.cashBufferCents'},
    payroll_cents:year.payroll,
    income_target_cents:plans.monthlyIncomeCents,
    cash_target_cents:plans.availableCashCents,
    cash_buffer_cents:plans.cashBufferCents,
    accounts,balances:year.balances,
    merchants:SAMPLE_MERCHANTS,
    transactions:{columns:['day','account','amount_cents','merchant'],rows:year.rows},
    payouts:{columns:['day','amount_cents'],rows:year.payouts},
    bills:SAMPLE_BILLS.map(b=>b.key==='auto'?{...b,cents:accounts.find(a=>a.key==='loan').payment_cents}:b),
    income:sampleIncomeModel(),
    banks:banks.map(b=>({recommended:b.recommended,deposit_quote:b.deposit_quote,book_ref:b.book.external_row_id})),
    bankPlan:bankPlan.views,
    cardStacking:sampleCardStacking(banks,bankPlan.rows,snapshots)
  };
}
seed.money=buildSampleMoney({snapshots:seed.creditSnapshots,plans:businessPlans});
if(process.argv.includes('--money-json')){process.stdout.write(JSON.stringify(seed.money));process.exit(0);}

// ---------------------------------------------------------------------------
// The client fulfillment cycle (unit CYCLE), made by its own helpers in
// src/blueprint/fulfillment-cycle.mjs from this one sample file:
//   * cycle.fullReports: one full credit report document, one version per soft
//     pull, the way src/handlers/crs-full-report.mjs saves it. "initial" is the
//     first pull (Oct 6); "updated" is both pulls (Oct 6 and Nov 6).
//   * each sample letter: its bureau's mailing address from the saved bureau
//     list, its version, and no approval yet.
//   * cycle.guide: the application guide on the latest pull day. Personal is the
//     plan's monthly income. Household is what the real income finder counts in
//     the sample deposits. No business account and no business is on file, so
//     business income stays null.
//   * each inquiry case: "Call <bureau>" with the number the Fundhub caller dials.

/* Money coming in on one day, read the way loadIncome() reads it
   (src/banking/income.mjs): the deposits in its window, the withdrawals that
   could pair with them, then the pure detectIncome(). */
function sampleIncome(money,today){
  const dayOf=i=>moneyIso(moneyTime(money.start)+i*MONEY_DAY),shift=(day,n)=>moneyIso(moneyTime(day)+n*MONEY_DAY),from=shift(today,-WINDOW_DAYS);
  const account=Object.fromEntries(money.accounts.map(a=>[a.key,a]));
  const rows=money.transactions.rows.map(([i,key,cents,merchant],n)=>({id:'sample-tx-'+n,provider_transaction_id:'sample-tx-'+n,bank_account_id:account[key].id,amount_cents:cents,posted_on:dayOf(i),merchant_name:money.merchants[merchant].name,category:null,is_pending:false}))
    .filter(r=>r.amount_cents>0?r.posted_on>=from&&r.posted_on<=today:r.posted_on>=shift(from,-TRANSFER_MATCH_DAYS)&&r.posted_on<=shift(today,TRANSFER_MATCH_DAYS));
  return detectIncome(rows,{now:today,accounts:money.accounts.map(a=>({id:a.id,type:a.type,kind:'personal',name:a.name,mask:a.mask}))});
}
const reportVersions=[seed.creditSnapshots.initial,seed.creditSnapshots.updated].map((snap,i)=>({document_id:ids.report,version:i+1,generated_at:snap.source.asOf}));
seed.cycle={
  fullReports:{initial:fullReportRows(reportVersions.slice(0,1)),updated:fullReportRows(reportVersions)},
  guide:applicationGuide({income:sampleIncome(seed.money,seed.money.asOf.updated),plan:{monthlyIncomeCents:businessPlans.monthlyIncomeCents},businessCount:businessPlans.existingBusinesses.length})
};
seed.letters.letters=seed.letters.letters.map(letter=>({...letter,...letterCycle({bureau:letter.bureau,versionId:letter.currentVersionId})}));
const dialPlan=bureauDialPlan({env:{}});
seed.inquiries.cases=seed.inquiries.cases.map(c=>({...c,selfCall:inquiryCall({bureau:c.bureau,inquiries:c.inquiries,missing:c.packet.missing,name:seed.session.staff.name,dial:dialPlan})}));

// ---------------------------------------------------------------------------
// Banks near Alex Sample (unit LOC): GET /api/money/banks?view=local_banks, the
// payload src/http/fixtures/local-banks.sample.mjs builds with the real
// attachLocalBanks() on the FDIC and NCUA files, once for each day the demo's
// money reads can be "as of" (the two pull days).
seed.localBanks={};
for(const [key,day] of Object.entries(seed.money.asOf))seed.localBanks[key]=(await localBankSamples(day)).full;

// ---------------------------------------------------------------------------
// The Alerts board (unit AL2): GET /api/money/alerts `board`, made by the real
// read (src/finance/file-alerts/read.mjs fileAlertsPayload, which builds it with
// buildAlertBoard) over this sample's own rows, the way
// src/finance/file-alerts/sample-payload.mjs does: the sample year's accounts on
// the pull day, each card's due and close day, the repeat bills with the
// prototype's Important set, the bill cleanup's own finds in the sample
// transactions, the staff bank plan (nothing opened, so no seasoning count), no
// text or phone alert sent, no phone set up and no linked bank logo. The demo's
// businesses and the alerts and bills the client adds change in the demo, so
// the saved board has neither; the adapter adds each business and each item the
// way buildAlertBoard does, and src/ui/blueprint-dashboard-demo.test.mjs checks
// it against this read (--alerts-json).
const SAMPLE_BILL_ID=Object.fromEntries(SAMPLE_BILLS.map((b,i)=>[b.key,`e0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
async function sampleAlertsPayload(money,{day,businesses=[],custom=[],closeDays={}}={}){
  const i=Math.round((moneyTime(day)-moneyTime(money.start))/MONEY_DAY);
  if(!Number.isInteger(i)||i<0||i>=money.days)throw Error('The alerts day is outside the sample year: '+day);
  const balance=a=>money.balances[a.key][i];
  const accounts=money.accounts.map(a=>({id:a.id,name:a.name,official_name:null,mask:a.mask,provider:'manual',account_type:a.type,account_subtype:a.subtype,
    available_balance_cents:a.type==='depository'?balance(a):a.type==='credit'?a.limit_cents-balance(a):null,current_balance_cents:balance(a),credit_limit_cents:a.type==='credit'?a.limit_cents:null,
    entity_kind:'personal',entity_kind_source:'staff_reviewed',entity_kind_set_at:null,entity_id:null,closed_at:null,institution_name:'Sample Community Bank'}));
  const closeOf=a=>Number.isInteger(closeDays[a.id])?closeDays[a.id]:a.statement_close_day;
  const cycles=money.accounts.filter(a=>a.type!=='depository').map(a=>a.type==='credit'
    ?{bank_account_id:a.id,statement_close_day:closeOf(a),payment_due_day:a.due_day,minimum_payment_cents:a.min_cents,source:Number.isInteger(closeDays[a.id])?'manual':'provider',raw:{}}
    :{bank_account_id:a.id,statement_close_day:null,payment_due_day:a.due_day,minimum_payment_cents:a.payment_cents,source:'manual',raw:{}});
  const checking=money.accounts.find(a=>a.key==='chk');
  const bills=money.bills.filter(b=>!b.account).map(b=>{const next=nextOccurrence(b.day,day),cents=(b.changes||[]).filter(c=>next>=c.from).at(-1)?.cents??b.cents;
    return {id:SAMPLE_BILL_ID[b.key],bank_account_id:checking.id,merchant_key:normaliseMerchant(b.name),merchant_display:b.name,cadence:'monthly',typical_amount_cents:-cents,next_expected_on:next,next_expected_unknown_reason:null,confidence_label:'high',important:b.important===true};});
  const account=Object.fromEntries(money.accounts.map(a=>[a.key,a])),from=moneyIso(moneyTime(day)-CLEANUP_READ_DAYS*MONEY_DAY);
  const moves=money.transactions.rows.map(([d,key,cents,merchant],n)=>({bank_account_id:account[key].id,provider_transaction_id:'sample-tx-'+n,amount_cents:cents,posted_on:moneyIso(moneyTime(money.start)+d*MONEY_DAY),merchant_name:money.merchants[merchant].name,is_pending:false}))
    .filter(r=>r.posted_on>=from&&r.posted_on<=day);
  const named=[...businesses].map(b=>({id:String(b.id),kind:'business',name:b.name})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.id<b.id?-1:a.id>b.id?1:0);
  const conn={async query(sql){
    const s=String(sql);
    if(/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s))return {rows:[{id:ids.client,first_name:'Alex',last_name:'Sample'}]};
    if(/item_created_at/.test(s))return {rows:accounts.map(a=>({id:a.id,account_type:a.account_type,plaid_item_id:null,mask:a.mask,name:a.name,closed_at:null,created_at:money.start+'T00:00:00.000Z',balance_as_of:null,item_created_at:null}))};
    if(s===ACCOUNT_SQL)return {rows:accounts};
    if(/FROM entities/.test(s))return {rows:named};
    if(/FROM account_statement_cycles s/.test(s))return {rows:cycles.map(row=>({row}))};
    if(/FROM card_liabilities l|FROM clarity_payments p/.test(s))return {rows:[]};
    throw Error('Unexpected alerts sample query: '+s.slice(0,80));
  }};
  const store={readSettings:async()=>({payment_timing:true,promo_end:true,cash_reserve:true,new_credit:true,phone_alerts:true,saved:false,updated_by_kind:null,updated_at:null}),
    listAlerts:async()=>[],reserveState:async()=>({open:new Map(),episodes:new Map()})};
  return fileAlertsPayload(conn,{orgId:ids.org,clientId:ids.client,now:new Date(day+'T12:00:00.000Z'),env:{}},{store,
    isOptedOut:async()=>false,isBlueprint:async()=>true,financeOsEntitlement:async()=>({entitled:true,subscriptionId:null,reason:null}),
    listBills:async()=>bills,phoneState:async()=>({hasPhone:false,optedOut:false}),listPhoneAlerts:async()=>[],listCustom:async()=>custom,
    loadBillCleanup:async()=>({...findBillProblems(moves,{now:day,accounts:accounts.map(a=>({id:a.id,account_type:a.account_type,closed_at:null,entity_kind:a.entity_kind,name:a.name,official_name:null,mask:a.mask,container_kind:null}))}),capped:false}),
    readRelationships:async()=>money.bankPlan[Object.keys(money.asOf).find(k=>money.asOf[k]===day)]||[],
    accountLogos:async()=>new Map()});
}
if(process.argv.includes('--alerts-json')){
  const spec=JSON.parse(process.argv[process.argv.indexOf('--alerts-json')+1]||'{}');
  const out=JSON.stringify(await sampleAlertsPayload(seed.money,spec));
  await new Promise(resolve=>process.stdout.write(out,resolve));process.exit(0);
}
/* The names a scope takes when no business is named (buildAlertBoard's own words). */
const boardSource=readFileSync(root+'src/finance/file-alerts/board.mjs','utf8');
const looseNames=Object.fromEntries([...(boardSource.match(/const LOOSE_NAMES = Object\.freeze\(\{([^}]*)\}\);/)?.[1]||'').matchAll(/(\w+): "([^"]*)"/g)].map(m=>[m[1],m[2]]));
if(!['personal','business','unknown'].every(k=>typeof looseNames[k]==='string'))throw Error('The board\'s scope names were not found');
seed.alerts={smartKinds:[...SMART_KINDS],looseNames,boards:{},phoneOn:null};
for(const [key,day] of Object.entries(seed.money.asOf)){
  const payload=await sampleAlertsPayload(seed.money,{day});
  if(!payload?.board)throw Error('The sample alerts read has no board on '+day);
  seed.alerts.boards[key]=payload.board;
  seed.alerts.phoneOn??={custom_alert:payload.phone.kinds.custom_alert.on===true,custom_bill:payload.phone.kinds.custom_bill.on===true};
}

// ---------------------------------------------------------------------------
// What you have (unit TL): GET /api/money/accounts?view=tradelines, made by the
// real read (src/finance/tradeline-inventory.mjs tradelineView) over Alex
// Sample's own rows: the sample year's accounts (typed in by Alex: "Added by
// you"), the pulls the stage has (savedPull above), no line staff added, no bank
// on Fundhub's bank list and no logo. The demo's businesses change in the demo,
// so the saved views have none; the adapter adds each business as its own group
// the way the read groups them, and src/ui/blueprint-dashboard-demo.test.mjs
// checks it against this read (--tradelines-json).
async function sampleTradelines(money,{pull='none',businesses=[]}={}){
  if(!Object.hasOwn(pullsFor,pull))throw Error('Unknown sample pull: '+pull);
  const accounts=money.accounts.map(a=>({id:a.id,name:a.name,official_name:null,mask:a.mask,account_type:a.type,account_subtype:a.subtype,
    credit_limit_cents:a.type==='credit'?a.limit_cents:null,entity_kind:'personal',entity_id:null,plaid_item_id:null,closed_at:null,
    entered_by:'client',app_kind:null,plaid_institution_id:null,institution_name:null}));
  const entities=businesses.map(b=>({id:String(b.id),kind:'business',name:b.name,archived_at:null}));
  const conn={async query(sql){
    const s=String(sql);
    if(s===TL_ENTITIES_SQL)return {rows:entities};
    if(s===TL_ACCOUNTS_SQL)return {rows:accounts};
    if(s===BANK_CRS_SQL)return {rows:pullsFor[pull]};
    if([TL_BUSINESSES_SQL,TL_STAFF_LINES_SQL,TL_ENTRIES_SQL,TL_BOOK_SQL].includes(s)||/FROM plaid_institutions|FROM lenders/.test(s))return {rows:[]};
    throw Error('Unexpected tradelines sample query: '+s.slice(0,80));
  }};
  return tradelineView(conn,{orgId:ids.org,clientId:ids.client});
}
if(process.argv.includes('--tradelines-json')){
  const spec=JSON.parse(process.argv[process.argv.indexOf('--tradelines-json')+1]||'{}');
  const out=JSON.stringify(await sampleTradelines(seed.money,spec));
  await new Promise(resolve=>process.stdout.write(out,resolve));process.exit(0);
}
seed.tradelines={};
for(const pull of Object.keys(pullsFor))seed.tradelines[pull]=await sampleTradelines(seed.money,{pull});

const progressSource=readFileSync(root+'src/pulse/beats/lib/progress-read.mjs','utf8');
const nextSource=progressSource.match(/export function nextStepOf\(waypoints = \[\]\) \{[\s\S]*?^\}/m)?.[0]?.replace(/^export /,'');
if(!nextSource)throw Error('Canonical progress next-step helper was not found');
seed.provenance = {source:'Fictional values; real Blueprint lesson, waypoint, service-type and debt-allocation helpers',payoffSha256:createHash('sha256').update(payoffSource).digest('hex'),guidanceSha256:createHash('sha256').update(guidanceSource).digest('hex'),progressSha256:createHash('sha256').update(progressSource).digest('hex')};

const payoff = payoffSource.replace(/^export default .*;?$/gm,'').replace(/^export /gm,'');
const guidance = guidanceSource.replace(/^import .*;\s*$/gm,'').replace(/^export default .*;?$/gm,'').replace(/^export /gm,'');
const opportunitySource=readFileSync(root+'src/blueprint/funding-opportunity.mjs','utf8').split('/** Existing scoped reads')[0].replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
seed.provenance.opportunitySha256=createHash('sha256').update(opportunitySource).digest('hex');
// The client's own alerts and bills (unit AL2): the real input check and the
// real item view (src/finance/file-alerts/custom.mjs), with the real date
// planner (src/pulse/beats/lib/custom-alert-plan.mjs) and its helpers, embedded
// as they run on the server, so the demo saves and shows what the server would.
const stripModule=src=>src.replace(/^import[\s\S]*?;[ \t]*$/gm,'').replace(/^export default .*;?$/gm,'').replace(/^export /gm,'');
const cardDueHelpersSource=readFileSync(root+'src/pulse/beats/lib/card-due-helpers.mjs','utf8');
const customPlanSource=readFileSync(root+'src/pulse/beats/lib/custom-alert-plan.mjs','utf8');
const customSource=readFileSync(root+'src/finance/file-alerts/custom.mjs','utf8');
const uuidLine=customSource.match(/^const UUID_RE = .*;$/m)?.[0],badLine=customSource.match(/^const bad = .*;$/m)?.[0];
if(!uuidLine||!badLine)throw Error('The custom alert input check helpers were not found');
if(readFileSync(root+'src/http/read-api.mjs','utf8').match(/^const UUID_RE = .*;$/m)?.[0]!==uuidLine)throw Error('isUuid and the custom alert id check must use the same pattern');
const customAlertsCode=`const realCustomAlerts=(()=>{\n${stripModule(cardDueHelpersSource)}\nconst REMIND_DAYS_BEFORE=${JSON.stringify(REMIND_DAYS_BEFORE)};\n${stripModule(customPlanSource)}\n${FileAlertInputError.toString()}\n${addDaysIso.toString()}\n${uuidLine}\n${badLine}\nconst CUSTOM_ITEM_KINDS=${JSON.stringify(CUSTOM_ITEM_KINDS)},CUSTOM_SCOPES=${JSON.stringify(CUSTOM_SCOPES)},NAME_MAX=${JSON.stringify(NAME_MAX)},AMOUNT_MAX_CENTS=${JSON.stringify(AMOUNT_MAX_CENTS)},ITEMS_MAX=${JSON.stringify(ITEMS_MAX)},MAX_YEARS_AHEAD=${JSON.stringify(MAX_YEARS_AHEAD)},MAX_YEARS_BACK=${JSON.stringify(MAX_YEARS_BACK)};\n${readName.toString()}\n${readAmount.toString()}\n${readCustomInput.toString()}\n${customView.toString()}\n${isUuid.toString()}\nreturn {readCustomInput,customView,isUuid,FileAlertInputError,ITEMS_MAX};\n})();`;
seed.provenance.customAlertsSha256=createHash('sha256').update(cardDueHelpersSource+customPlanSource+customSource).digest('hex');
const json=JSON.stringify(seed,null,2)+'\n';
const generated = `const DATA = ${JSON.stringify(seed)};\nconst realSetupSteps=${setupSteps.toString()};\nconst realFundingOpportunity=(()=>{${opportunitySource}\nreturn buildFundingOpportunity;})();\nconst realNextStep = (()=>{const OPEN_STATES = new Set(['not_started','in_progress','blocked']);\n${nextSource}\nreturn nextStepOf;})();\nconst realDebtPlanner = (() => {\n${payoff}\nreturn planMonthlyDebtPayments;\n})();\nconst realGuidance = (() => {\nconst PAYOFF_SOURCE_URL = ${JSON.stringify('https://www.consumerfinance.gov/documents/5782/cfpb_ymyg-toolkit_reducing-debt-worksheet.pdf')};\n${guidance}\nreturn {preparationGuidance,websitePrompt};\n})();\n${customAlertsCode}`;
const adapterPath=root+'public/app/blueprint-demo.js';
const adapter=readFileSync(adapterPath,'utf8');
if (!adapter.includes('// BEGIN GENERATED BLUEPRINT DATA') || !adapter.includes('// END GENERATED BLUEPRINT DATA')) throw new Error('Demo adapter generation markers are missing');
// A function, so a "$&" or "$'" inside the embedded code is copied as written.
const output=adapter.replace(/\/\/ BEGIN GENERATED BLUEPRINT DATA[\s\S]*?\/\/ END GENERATED BLUEPRINT DATA/,()=>`// BEGIN GENERATED BLUEPRINT DATA\n${generated}\n// END GENERATED BLUEPRINT DATA`);
if(process.argv.includes('--check')) {
  if(readFileSync(root+'public/app/blueprint-demo-data.json','utf8')!==json||adapter!==output) { console.error('Blueprint demo generated data is stale');process.exitCode=1; }
  else console.log('Blueprint demo generated data is current');
} else {writeFileSync(root+'public/app/blueprint-demo-data.json',json);writeFileSync(adapterPath,output);console.log('Generated fictional full Blueprint dashboard data');}
