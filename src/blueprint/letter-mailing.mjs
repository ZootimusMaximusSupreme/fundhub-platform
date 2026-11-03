// $97 per explicitly selected Blueprint letter batch. Never buys a fresh pull.
import {createHash,randomUUID} from 'node:crypto';
import {checkoutExpiresAt} from '../paid-services/link-ttl.mjs';
import {withTransaction} from '../db/with-transaction.mjs';
import {verifiedIdentity} from '../identity/verified.mjs';
import {storeFromEnv} from '../documents/store.mjs';
import {bureauMailAddress} from '../messaging/providers/mail-letter.mjs';
import {createMailingProviders,safeCheckoutUrl} from '../messaging/providers/blueprint-letter-mailing.mjs';
import {isBlueprintCoachClient} from './coach.mjs';

export const MAILING_PRICE_CENTS=9700;
export const MAX_MAILING_LETTERS=6;
export const MAILING_AUTHORIZATION='I authorize Fundhub to charge $97 USD once for this selected mailing batch and mail these exact letters on my behalf using my recorded return address.';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBTYPES=['funding_inquiry_removal','funding_personal_info'];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class LetterMailingError extends Error {constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
function fail(code,message,status=409){throw new LetterMailingError(code,message,status);}
function scopeCheck(s){if(!UUID.test(s?.orgId||'')||!UUID.test(s?.clientId||''))fail('forbidden','Sign in to your client account.',403);}
const at=s=>new Date(s.now||new Date());
const identityOf=async(db,s)=>{const i=await verifiedIdentity(db,s);return {name:i.legalName,line1:i.address?.line1,line2:i.address?.line2||null,city:i.address?.city,state:i.address?.state,postalCode:i.address?.zip};};
function validFrom(a){return !!(a?.name&&a.line1&&a.city&&/^[A-Z]{2}$/.test(a.state||'')&&/^\d{5}(?:-\d{4})?$/.test(a.postalCode||''));}
function fileOf(d){const bureau=String(d.metadata?.bureau||'').toUpperCase();return {documentId:d.id,versionId:d.version_id,title:d.title,
  subtype:d.subtype,bureau,generatedAt:d.generated_at,checksum:d.version_checksum,storageKey:d.version_storage_key,
  mimeType:d.version_mime_type,byteSize:Number(d.version_byte_size),to:bureauMailAddress(bureau)};}
function eligible(d,now=new Date()){const f=fileOf(d);return SUBTYPES.includes(f.subtype)&&['EX','EQ','TU'].includes(f.bureau)&&UUID.test(f.versionId||'')
  &&/^sha256:[a-f0-9]{64}$/.test(f.checksum||'')&&f.storageKey&&f.mimeType==='application/pdf'
  &&Number.isSafeInteger(f.byteSize)&&f.byteSize>4&&f.byteSize<=5*1024*1024&&!d.already_claimed
  &&(!d.expires_at||new Date(d.expires_at).getTime()>new Date(now).getTime());}
function ownsBinding(b,s,email){return !!(b&&b.provider==='commas'&&b.source==='verified_provider_receipt'&&b.orgId===s.orgId&&b.clientId===s.clientId&&b.accountId===s.accountId&&/^\d+$/.test(String(b.customerId||''))&&Number(b.customerId)>0&&String(b.email||'').toLowerCase()===String(email||'').toLowerCase());}
const publicItem=f=>({documentId:f.documentId,title:f.title,subtype:f.subtype,bureau:f.bureau});
export function publicMailingOrder(o){return {id:o.id,orderId:o.id,status:o.state,totalCents:Number(o.price_total_cents),currency:'USD',quoteVersion:o.quote_version,
  items:o.snapshot.files.map(publicItem),returnAddressSummary:o.snapshot.from,
  paymentOptions:o.snapshot.paymentOptions.map(p=>({id:p.id,label:p.label,kind:p.kind})),
  checkoutUrl:safeCheckoutUrl(o.checkout_url),reason:o.reason||null,
  envelopes:(o.envelopes||[]).map(e=>({bureau:e.bureau,status:e.state,providerId:e.provider_id||null,trackingUrl:null}))};}

export function createMailingRepository(db){
  const get=async(s,id,conn=db)=>{
    const o=(await conn.query(`SELECT o.*,p.price_total_cents,p.status AS ledger_status,p.amount_paid_cents AS ledger_amount_paid_cents,p.payment_ref AS ledger_payment_ref FROM blueprint_letter_mailing_orders o
      JOIN paid_service_requests p ON p.id=o.id AND p.org_id=o.org_id AND p.client_id=o.client_id AND p.service_kind='letter_mailing'
      WHERE o.id=$1 AND o.org_id=$2 AND o.client_id=$3`,[id,s.orgId,s.clientId])).rows[0];
    if(!o)return null;
    o.envelopes=(await conn.query(`SELECT * FROM blueprint_letter_mailing_envelopes WHERE order_id=$1 AND org_id=$2 AND client_id=$3 ORDER BY id`,[id,s.orgId,s.clientId])).rows;
    return o;
  };
  return {get,
    async client(s){return (await db.query(`SELECT id,org_id,email FROM clients WHERE id=$1 AND org_id=$2`,[s.clientId,s.orgId])).rows[0]||null;},
    async letters(s){return (await db.query(`SELECT d.id,d.title,d.subtype,d.metadata,d.generated_at,d.expires_at,v.id AS version_id,
      v.storage_key AS version_storage_key,v.checksum AS version_checksum,v.mime_type AS version_mime_type,v.byte_size AS version_byte_size,
      EXISTS(SELECT 1 FROM blueprint_letter_mailing_envelopes e WHERE e.org_id=d.org_id AND e.client_id=d.client_id
        AND e.checksum=v.checksum AND e.bureau=d.metadata->>'bureau' AND e.state IN ('sending','accepted','needs_review')) AS already_claimed
      FROM documents d JOIN document_versions v ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE d.org_id=$1 AND d.client_id=$2 AND d.kind='deliverable' AND d.subtype=ANY($3::text[]) ORDER BY d.generated_at DESC LIMIT 30`,[s.orgId,s.clientId,SUBTYPES])).rows;},
    async current(s,f){return !!(await db.query(`SELECT 1 FROM documents d JOIN document_versions v
      ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE d.id=$1 AND d.org_id=$2 AND d.client_id=$3 AND d.current_version_id=$4
      AND d.kind='deliverable' AND d.subtype=$5 AND d.metadata->>'bureau'=$6
      AND v.checksum=$7 AND d.checksum=$7 AND v.storage_key=$8 AND v.mime_type='application/pdf'
      AND (d.expires_at IS NULL OR d.expires_at>$9)`,[f.documentId,s.orgId,s.clientId,f.versionId,f.subtype,f.bureau,f.checksum,f.storageKey,at(s)])).rows[0];},
    async orders(s){const ids=(await db.query(`SELECT id FROM blueprint_letter_mailing_orders WHERE org_id=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 10`,[s.orgId,s.clientId])).rows;
      return Promise.all(ids.map(r=>get(s,r.id)));},
    // Existing client_cards hold method tokens, but no server-verified numeric
    // Commas customer/current-account binding. Hosted checkout is the live rail.
    // A prior purchase or matching/reassigned CRM email is never that binding.
    async verifiedCustomer(){return null;},
    async quote(s,snapshot,quoteVersion){return withTransaction(db,async tx=>{
      if(!(await tx.query(`SELECT id FROM clients WHERE id=$1 AND org_id=$2 FOR UPDATE`,[s.clientId,s.orgId])).rows[0])fail('client_not_found','Client file not found.',404);
      if(!UUID.test(s.accountId||'')||!(await tx.query(`SELECT id FROM accounts WHERE id=$1 AND org_id=$2 AND client_id=$3 AND kind='client' AND status='active'`,[s.accountId,s.orgId,s.clientId])).rows[0])fail('forbidden','Sign in with your client account.',403);
      const old=(await tx.query(`SELECT id FROM blueprint_letter_mailing_orders WHERE org_id=$1 AND client_id=$2 AND state NOT IN ('mailed','cancelled') ORDER BY created_at LIMIT 1 FOR UPDATE`,[s.orgId,s.clientId])).rows[0];
      if(old){const existing=await get(s,old.id,tx);
        const expired=at(s).getTime()-new Date(existing.created_at).getTime()>30*60*1000;
        if(existing.quote_version===quoteVersion&&!expired)return existing;
        if(existing.state!=='quoted'||existing.payment_state!=='none')fail('mailing_order_in_flight','Finish or resolve your existing mailing request first.');
        await tx.query(`UPDATE blueprint_letter_mailing_orders SET state='cancelled',reason='quote_replaced',updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3 AND state='quoted' AND payment_state='none'`,[old.id,s.orgId,s.clientId]);
        await tx.query(`UPDATE paid_service_requests SET status='cancelled',state_reason='quote_replaced',resolved_at=$4 WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='quoted'`,[old.id,s.orgId,s.clientId,at(s)]);
      }
      const id=randomUUID();
      await tx.query(`INSERT INTO paid_service_requests (id,org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,status,price_components,price_total_cents,currency,idempotency_key)
        VALUES ($1,$2,$3,'letter_mailing','client',$4,'quoted',$5::jsonb,9700,'USD',$6)`,[id,s.orgId,s.clientId,s.accountId,JSON.stringify([{code:'blueprint_letter_mailing_batch',label:'Mail selected letter batch',quantity:1,unit_cents:9700,amount_cents:9700}]),`blueprint-mail:${id}`]);
      await tx.query(`INSERT INTO blueprint_letter_mailing_orders (id,org_id,client_id,quote_version,snapshot) VALUES ($1,$2,$3,$4,$5::jsonb)`,[id,s.orgId,s.clientId,quoteVersion,JSON.stringify(snapshot)]);
      for(const f of snapshot.files)await tx.query(`INSERT INTO blueprint_letter_mailing_envelopes (id,order_id,org_id,client_id,document_id,document_version_id,checksum,bureau,snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[randomUUID(),id,s.orgId,s.clientId,f.documentId,f.versionId,f.checksum,f.bureau,JSON.stringify(f)]);
      return get(s,id,tx);
    });},
    async begin(s,id,{quoteVersion,option,idempotencyKey}){return (await db.query(`UPDATE blueprint_letter_mailing_orders SET payment_state=$4,state='payment_pending',payment_option_id=$5,
      authorized_at=$6,authorization_text=$7,authorized_account_id=$8,confirmation_key=$9,attempt_started_at=$6,updated_at=now()
      WHERE id=$1 AND org_id=$2 AND client_id=$3 AND payment_state='none' AND state='quoted' AND quote_version=$10 RETURNING id`,
      [id,s.orgId,s.clientId,option.kind==='saved_card'?'charging':'creating_checkout',option.id,at(s),MAILING_AUTHORIZATION,s.accountId,idempotencyKey,quoteVersion])).rows.length>0;},
    async startHosted(s,id){return (await db.query(`UPDATE blueprint_letter_mailing_orders SET payment_state='creating_checkout',updated_at=now()
      WHERE id=$1 AND org_id=$2 AND client_id=$3 AND payment_state='charging' RETURNING id`,[id,s.orgId,s.clientId])).rows.length>0;},
    async saveHosted(s,id,r){return withTransaction(db,async tx=>{await tx.query(`UPDATE blueprint_letter_mailing_orders SET payment_state='awaiting_payment',state='awaiting_payment',
      checkout_url=$4,checkout_session_id=$5,checkout_product_id=$6,updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3 AND payment_state='creating_checkout'`,[id,s.orgId,s.clientId,r.checkoutUrl,r.sessionId,r.productId]);
      await tx.query(`UPDATE paid_service_requests SET status='awaiting_payment',checkout_url=$4,checkout_expires_at=$5 WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='quoted'`,[id,s.orgId,s.clientId,r.checkoutUrl,checkoutExpiresAt(at(s))]);});},
    async paid(s,id,receipt){if(receipt.amountCents!==9700||!receipt.providerRef)fail('payment_mismatch','Payment needs review.');return withTransaction(db,async tx=>{
      const ledger=(await tx.query(`SELECT status,payment_ref,amount_paid_cents FROM paid_service_requests WHERE id=$1 AND org_id=$2 AND client_id=$3 AND service_kind='letter_mailing' FOR UPDATE`,[id,s.orgId,s.clientId])).rows[0];
      if(!ledger||!['quoted','awaiting_payment','paid'].includes(ledger.status)
        ||(ledger.payment_ref&&ledger.payment_ref!==receipt.providerRef)
        ||(ledger.status==='paid'&&ledger.amount_paid_cents!=null&&Number(ledger.amount_paid_cents)!==9700)){
        await tx.query(`UPDATE blueprint_letter_mailing_orders SET state='needs_review',reason='payment_ledger_mismatch',updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3`,[id,s.orgId,s.clientId]);return;
      }
      const updated=(await tx.query(`UPDATE blueprint_letter_mailing_orders SET payment_state='paid',state='mail_pending',provider_payment_ref=$4,paid_at=$5,reason=NULL,updated_at=now()
        WHERE id=$1 AND org_id=$2 AND client_id=$3 AND payment_state IN ('charging','awaiting_payment') AND authorized_at IS NOT NULL RETURNING id`,[id,s.orgId,s.clientId,receipt.providerRef,at(s)])).rows[0];
      if(updated)await tx.query(`UPDATE paid_service_requests SET status='paid',paid_at=$4,payment_ref=$5,amount_paid_cents=9700 WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status IN ('quoted','awaiting_payment','paid')`,[id,s.orgId,s.clientId,at(s),receipt.providerRef]);
    });},
    async hold(s,id,reason){await db.query(`UPDATE blueprint_letter_mailing_orders SET state='needs_review',reason=$4,updated_at=now()
      WHERE id=$1 AND org_id=$2 AND client_id=$3 AND state<>'mailed'`,[id,s.orgId,s.clientId,reason]);},
    async claim(s,id,envelopeId){return (await db.query(`UPDATE blueprint_letter_mailing_envelopes e SET state='sending',claimed_at=$4,claim_token=$5,updated_at=now()
      WHERE e.id=$1 AND e.order_id=$2 AND e.org_id=$3 AND e.client_id=$6 AND e.state='ready'
      AND EXISTS(SELECT 1 FROM blueprint_letter_mailing_orders o WHERE o.id=e.order_id AND o.org_id=e.org_id AND o.client_id=e.client_id
        AND o.payment_state='paid' AND o.state IN ('mail_pending','mailing') AND o.authorized_at IS NOT NULL)
      RETURNING *`,[envelopeId,id,s.orgId,at(s),randomUUID(),s.clientId])).rows[0]||null;},
    async accepted(s,id,e,providerId){await db.query(`UPDATE blueprint_letter_mailing_envelopes SET state='accepted',provider_id=$6,accepted_at=$7,updated_at=now()
      WHERE id=$1 AND order_id=$2 AND org_id=$3 AND client_id=$4 AND claim_token=$5 AND state='sending'`,[e.id,id,s.orgId,s.clientId,e.claim_token,providerId,at(s)]);},
    async envelopeHold(s,id,e,reason='mail_outcome_unknown'){await db.query(`UPDATE blueprint_letter_mailing_envelopes SET state='needs_review',updated_at=now()
      WHERE id=$1 AND order_id=$2 AND org_id=$3 AND client_id=$4 AND state='sending'`,[e.id,id,s.orgId,s.clientId]);await this.hold(s,id,reason);},
    async complete(s,id){return withTransaction(db,async tx=>{const changed=(await tx.query(`UPDATE blueprint_letter_mailing_orders o SET state='mailed',updated_at=now()
      WHERE id=$1 AND org_id=$2 AND client_id=$3 AND payment_state='paid' AND authorized_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM paid_service_requests p WHERE p.id=o.id AND p.org_id=o.org_id AND p.client_id=o.client_id AND p.status='paid' AND p.amount_paid_cents=9700 AND p.payment_ref=o.provider_payment_ref)
      AND EXISTS(SELECT 1 FROM blueprint_letter_mailing_envelopes e WHERE e.order_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM blueprint_letter_mailing_envelopes e WHERE e.order_id=o.id AND e.state<>'accepted') RETURNING id`,[id,s.orgId,s.clientId])).rows[0];
      if(changed)await tx.query(`UPDATE paid_service_requests SET status='fulfilled',resolved_at=$4,produced_kind='letter_mailing_batch',produced_ref=$1,
        produced=produced||jsonb_build_object('mailed',true,'mailing_order_id',$1::text,'envelopes',(SELECT jsonb_agg(jsonb_build_object('document_id',e.document_id,'document_version_id',e.document_version_id,'bureau',e.bureau,'provider_id',e.provider_id,'accepted_at',e.accepted_at)) FROM blueprint_letter_mailing_envelopes e WHERE e.order_id=$1 AND e.org_id=$2 AND e.client_id=$3)) WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='paid'`,[id,s.orgId,s.clientId,at(s)]);
    });},
    async checked(s,id){await db.query(`UPDATE blueprint_letter_mailing_orders SET updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3`,[id,s.orgId,s.clientId]);},
    async heldCount(){return Number((await db.query(`SELECT count(*)::int AS n FROM blueprint_letter_mailing_orders WHERE state='needs_review'`)).rows[0]?.n||0);},
    async pending(limit){return (await db.query(`SELECT id,org_id,client_id FROM blueprint_letter_mailing_orders WHERE state IN ('awaiting_payment','payment_pending','mail_pending','mailing') ORDER BY CASE WHEN payment_state='paid' THEN 0 ELSE 1 END,updated_at LIMIT $1`,[limit])).rows;}
  };
}
function dependencies(db,deps){return {...deps,repo:deps.repo||createMailingRepository(db),providers:deps.providers||createMailingProviders(deps),
  loadFrom:deps.loadFrom||identityOf,active:deps.active||isBlueprintCoachClient,
  loadPdf:deps.loadPdf|| (async f=>(await storeFromEnv(deps.env||process.env).get(f.storageKey,{expectedChecksum:f.checksum})).body)};}
async function scopedClient(s,d){scopeCheck(s);const c=await d.repo.client(s);if(!c||c.id!==s.clientId||c.org_id!==s.orgId)fail('client_not_found','Client file not found.',404);return c;}
function checkPdf(pdf,f){const b=Buffer.from(pdf||[]);if(b.length!==f.byteSize||b.length>5*1024*1024||!b.subarray(0,5).equals(Buffer.from('%PDF-'))
  ||`sha256:${createHash('sha256').update(b).digest('hex')}`!==f.checksum)fail('letter_content_unavailable','A selected letter needs to be regenerated before mailing.');return b;}
export async function readLetterMailing(db,s,deps={}){const d=dependencies(db,deps);const client=await scopedClient(s,d);
  const rows=await d.repo.letters(s),orders=await d.repo.orders(s),binding=await d.repo.verifiedCustomer(s);
  const capabilities={...d.providers.capabilities(),savedCardSupported:ownsBinding(binding,s,client.email)};
  return {ok:true,letters:rows.map(r=>({documentId:r.id,title:r.title,subtype:r.subtype,bureau:String(r.metadata?.bureau||''),generatedAt:r.generated_at,
    eligibleForMailing:!!eligible(r,at(s)),reason:eligible(r,at(s))?null:r.already_claimed?'already_requested':'letter_not_ready'})),orders:orders.map(publicMailingOrder),capabilities,priceCents:9700,maxLetters:MAX_MAILING_LETTERS};}
export async function quoteLetterMailing(db,s,input,deps={}){const d=dependencies(db,deps),client=await scopedClient(s,d),ids=input?.documentIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_MAILING_LETTERS||ids.some(id=>!UUID.test(id))||new Set(ids).size!==ids.length)fail('invalid_letters','Choose one to six distinct letters.',400);
  if(!d.providers.capabilities().mailSupported||!d.providers.capabilities().hostedCheckoutSupported)fail('mailing_unavailable','Mailing checkout is unavailable. You can still download and mail your letters.');
  const rows=await d.repo.letters(s),selected=ids.map(id=>rows.find(r=>r.id===id));
  if(selected.some(r=>!r||!eligible(r,at(s))))fail('letter_not_available','Choose ready letters from your own file.');
  const files=selected.map(fileOf).sort((a,b)=>a.documentId.localeCompare(b.documentId)),from=await d.loadFrom(db,s);
  if(new Set(files.map(f=>`${f.bureau}:${f.checksum}`)).size!==files.length)fail('duplicate_letter_content','Choose one copy of each letter for each bureau.');
  if(!validFrom(from))fail('return_address_required','Confirm your legal name and home mailing address first.');
  for(const f of files){if(!await d.repo.current(s,f))fail('letter_changed','A selected letter changed. Review a new quote.');checkPdf(await d.loadPdf(f),f);}
  let saved=[];const binding=await d.repo.verifiedCustomer(s);try{if(ownsBinding(binding,s,client.email))saved=await d.providers.savedCards({customerId:binding.customerId,email:binding.email});}catch{/* Hosted checkout is always available without stored-card assumptions. */}
  const paymentOptions=saved.map(c=>({id:randomUUID(),label:c.label,kind:'saved_card',customerId:c.customerId,methodId:c.methodId,accountId:binding.accountId}));
  paymentOptions.push({id:'hosted_checkout',label:'Pay on secure checkout',kind:'hosted_checkout'});
  // Payment options are not a price/version input: a refreshed provider card list
  // must never create a second order for the same immutable mailing selection.
  const quoteVersion=hash({files,from,totalCents:9700,currency:'USD'});
  const snapshot={email:String(client.email||'').trim().toLowerCase(),from,files,paymentOptions,createdAt:at(s).toISOString()};
  const order=await d.repo.quote(s,snapshot,quoteVersion);return {ok:true,...publicMailingOrder(order)};
}
async function ownOrder(s,id,d){if(!UUID.test(id||''))fail('order_not_found','Mailing request not found.',404);const o=await d.repo.get(s,id);
  if(!o||o.org_id!==s.orgId||o.client_id!==s.clientId||Number(o.price_total_cents)!==9700)fail('order_not_found','Mailing request not found.',404);return o;}
async function hosted(s,o,d){let r;try{r=await d.providers.hosted({orderId:o.id,orgId:s.orgId,clientId:s.clientId});}catch{r={ok:false};}
  if(r.ok&&safeCheckoutUrl(r.checkoutUrl)&&r.productId&&r.sessionId)await d.repo.saveHosted(s,o.id,r);
  else await d.repo.hold(s,o.id,'checkout_outcome_unknown');}
export async function confirmLetterMailing(db,s,input,deps={}){const d=dependencies(db,deps),client=await scopedClient(s,d);
  if(input?.authorization!==true||typeof input.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey))fail('authorization_required','Confirm the one-time $97 charge and mailing authorization.',400);
  const o=await ownOrder(s,input.orderId,d);
  if(input.quoteVersion!==o.quote_version)fail('quote_changed','Review the current mailing quote before paying.');
  if(o.state==='cancelled')fail('quote_changed','This quote was replaced. Review your latest selected letters.');
  if(['failed','cancelled','refunded','fulfilled'].includes(o.ledger_status)&&o.state!=='mailed'){await d.repo.hold(s,o.id,'payment_ledger_mismatch');fail('payment_needs_review','Your payment or mailing request needs review.');}
  if(o.payment_state!=='none')return {ok:true,...publicMailingOrder(o)};
  const option=o.snapshot.paymentOptions.find(p=>p.id===input.paymentOptionId);if(!option)fail('payment_option_invalid','Choose a payment option from this quote.',400);
  if(at(s).getTime()-new Date(o.created_at||o.snapshot.createdAt).getTime()>30*60*1000)fail('quote_expired','Request a fresh mailing quote before paying.');
  const from=await d.loadFrom(db,s);if(!validFrom(from)||hash(from)!==hash(o.snapshot.from))fail('return_address_changed','Your return address changed. Review a new mailing quote.');
  const caps=d.providers.capabilities();if(!caps.mailSupported||!caps.hostedCheckoutSupported)fail('mailing_unavailable','Mailing checkout is unavailable. No new payment was started.');
  for(const f of o.snapshot.files){if(!await d.repo.current(s,f))fail('letter_changed','A selected letter changed. Review a new quote.');checkPdf(await d.loadPdf(f),f);}
  if(option.kind==='saved_card'){
    // Re-read ownership immediately before charging, never accept a card/customer ID from the browser.
    const binding=await d.repo.verifiedCustomer(s);
    if(!ownsBinding(binding,s,client.email)||binding.customerId!==option.customerId||binding.accountId!==option.accountId||String(client.email||'').toLowerCase()!==o.snapshot.email)fail('saved_card_unavailable','Use secure checkout for this account.');
    let cards=[];try{cards=await d.providers.savedCards({customerId:binding.customerId,email:binding.email});}catch{/* unavailable is not authorization */}
    if(!cards.some(c=>c.customerId===option.customerId&&c.methodId===option.methodId))fail('saved_card_unavailable','That saved card is unavailable. Choose secure checkout.');
  }
  if(await d.repo.begin(s,o.id,{quoteVersion:o.quote_version,option,idempotencyKey:input.idempotencyKey})){
    if(option.kind==='hosted_checkout')await hosted(s,o,d);
    else {let r;try{r=await d.providers.charge({customerId:option.customerId,methodId:option.methodId,orderId:o.id,amountCents:9700});}catch{r={ok:false};}
      if(r.ok&&r.paid&&r.amountCents===9700&&r.providerRef)await d.repo.paid(s,o.id,r);
      else if(r.definitiveRefusal&&await d.repo.startHosted(s,o.id))await hosted(s,o,d);
      else await d.repo.hold(s,o.id,'payment_outcome_unknown');
    }
  }
  const current=await ownOrder(s,o.id,d);
  if(current.state==='cancelled')fail('quote_changed','This quote was replaced. Review your latest selected letters.');
  return {ok:true,...publicMailingOrder(current)};
}
export async function reconcileLetterMailing(db,s,id,deps={}){const d=dependencies(db,deps);scopeCheck(s);let o=await ownOrder(s,id,d);let unavailable=false;
  if(['failed','cancelled','refunded'].includes(o.ledger_status)&&o.state!=='mailed'){await d.repo.hold(s,id,'payment_ledger_mismatch');}
  else if((o.payment_state==='awaiting_payment'||(o.payment_state==='paid'&&o.checkout_product_id&&['mail_pending','mailing'].includes(o.state)))&&o.state!=='needs_review'){
    let r;try{r=await d.providers.readHosted(o);}catch{r={status:'unavailable'};}
    if(r.status==='unavailable')unavailable=true;
    if(o.payment_state==='paid'&&r.status==='paid'&&r.providerRef!==o.provider_payment_ref)await d.repo.hold(s,id,'payment_receipt_mismatch');
    else if(r.status==='paid'&&r.amountCents===9700&&r.providerRef)await d.repo.paid(s,id,r);
    else if(o.payment_state==='paid'&&r.status==='pending')await d.repo.hold(s,id,'payment_receipt_mismatch');
    else if(['mismatch','unknown'].includes(r.status))await d.repo.hold(s,id,'payment_receipt_mismatch');
  }else if(['charging','creating_checkout'].includes(o.payment_state)&&o.state!=='needs_review'
    &&at(s).getTime()-new Date(o.attempt_started_at).getTime()>15*60*1000)await d.repo.hold(s,id,'payment_outcome_unknown');
  await d.repo.checked(s,id);o=await ownOrder(s,id,d);return {ok:!unavailable,...publicMailingOrder(o),...(unavailable?{reason:'payment_provider_unavailable'}:{})};
}
export async function fulfilLetterMailing(db,s,id,deps={}){const d=dependencies(db,deps);scopeCheck(s);const o=await ownOrder(s,id,d);
  if(o.payment_state!=='paid'||!o.provider_payment_ref||!o.authorized_at||!['mail_pending','mailing'].includes(o.state))return {ok:true,...publicMailingOrder(o)};
  if(o.ledger_status!=='paid'||Number(o.ledger_amount_paid_cents)!==9700||o.ledger_payment_ref!==o.provider_payment_ref){await d.repo.hold(s,id,'payment_ledger_mismatch');return {ok:true,...publicMailingOrder(await ownOrder(s,id,d))};}
  if(!await d.active(db,{orgId:s.orgId,clientId:s.clientId,asOf:at(s)})){await d.repo.hold(s,id,'blueprint_access_inactive');return {ok:true,...publicMailingOrder(await ownOrder(s,id,d))};}
  if(!d.providers.capabilities().mailSupported)return {ok:false,...publicMailingOrder(o),reason:'mail_provider_unavailable'};
  for(const f of o.snapshot.files)if(!await d.repo.current(s,f)){await d.repo.hold(s,id,'letter_version_changed');return {ok:true,...publicMailingOrder(await ownOrder(s,id,d))};}
  let sent=0;
  for(const e of o.envelopes){
    if(e.state==='sending'&&at(s).getTime()-new Date(e.claimed_at).getTime()>15*60*1000){await d.repo.envelopeHold(s,id,e);break;}
    if(e.state!=='ready'||sent>=Math.min(deps.maxEnvelopes||2,2))continue;
    if(!await d.repo.current(s,e.snapshot)){await d.repo.hold(s,id,'letter_version_changed');break;}
    let pdf;try{pdf=checkPdf(await d.loadPdf(e.snapshot),e.snapshot);}catch{await d.repo.hold(s,id,'letter_content_unavailable');break;}
    let claimed;try{claimed=await d.repo.claim(s,id,e.id);}catch{await d.repo.hold(s,id,'duplicate_letter_claim');break;}
    if(!claimed)continue;
    if(!await d.repo.current(s,e.snapshot)){await d.repo.envelopeHold(s,id,claimed,'letter_version_changed');break;}
    let r;try{r=await d.providers.sendEnvelope({order:o,envelope:claimed,pdf});}catch{r={ok:false};}
    if(r.ok&&r.providerId)await d.repo.accepted(s,id,claimed,r.providerId);
    else {await d.repo.envelopeHold(s,id,claimed);break;}
    sent++;
  }
  await d.repo.complete(s,id);return {ok:true,...publicMailingOrder(await ownOrder(s,id,d))};
}
export async function processLetterMailingOrder(db,s,id,deps={}){const reconciled=await reconcileLetterMailing(db,s,id,deps);if(!reconciled.ok)return reconciled;return fulfilLetterMailing(db,s,id,deps);}
export async function sweepLetterMailings(db,deps={}){const d=dependencies(db,deps),rows=await d.repo.pending(Math.min(Math.max(deps.limit||5,1),5));
  const result={ok:true,examined:rows.length,mailed:0,needsReview:await d.repo.heldCount(),failed:0};
  for(const row of rows)try{const r=await processLetterMailingOrder(db,{orgId:row.org_id,clientId:row.client_id,now:deps.now||new Date()},row.id,deps);
    if(r.status==='mailed')result.mailed++;if(r.status==='needs_review')result.needsReview++;if(!r.ok)result.failed++;
  }catch{result.failed++;}
  result.ok=result.failed===0&&result.needsReview===0;return result;
}
