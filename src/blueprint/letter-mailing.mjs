// $97 per explicitly selected Blueprint letter batch. Never buys a fresh pull.
// The batch can hold the two funding letters and, since unit MAIL (Chris,
// 2026-11-07: "if you want us to print, generate and send them, we can do
// that"), a repair round's bureau letters. One price, one checkout, one mail
// house, one tracker for both.
import {createHash,randomUUID} from 'node:crypto';
import {checkoutExpiresAt} from '../paid-services/link-ttl.mjs';
import {withTransaction} from '../db/with-transaction.mjs';
import {verifiedIdentity} from '../identity/verified.mjs';
import {storeFromEnv} from '../documents/store.mjs';
import {bureauMailAddress} from '../messaging/providers/mail-letter.mjs';
import {createMailingProviders,safeCheckoutUrl} from '../messaging/providers/blueprint-letter-mailing.mjs';
import {currentRepairMailAuthorizationSql} from '../repair/dispute-auth.mjs';
import {isBlueprintCoachClient} from './coach.mjs';
import {letterCycle,readLetterApprovals} from './fulfillment-cycle.mjs';

export const MAILING_PRICE_CENTS=9700;
export const MAX_MAILING_LETTERS=6;
export const MAILING_AUTHORIZATION='I authorize Fundhub to charge $97 USD once for this selected mailing batch and mail these exact letters on my behalf using my recorded return address.';
/* The bureau has 30 days to answer a dispute, counted from when the bureau gets
   the letter (Codex CX27). PostGrid never confirms delivery, so the clock starts
   at its expected delivery date, and there is no reply date until that is known. */
export const MAILING_REPLY_DAYS=30;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FUNDING_LETTER_SUBTYPES=Object.freeze(['funding_inquiry_removal','funding_personal_info']);
/* Saved by src/repair/persist-generated-letters.mjs: the same words as
   dispute_letters.body_text, as an HTML file, with metadata.letterId. */
export const REPAIR_LETTER_SUBTYPE='metro2_dispute_letter_pack';
const SUBTYPES=[...FUNDING_LETTER_SUBTYPES,REPAIR_LETTER_SUBTYPE];
const MAX_PDF_BYTES=5*1024*1024,MAX_HTML_BYTES=512*1024;
const isRepair=f=>f?.subtype===REPAIR_LETTER_SUBTYPE;
const mimeFor=f=>isRepair(f)?'text/html':'application/pdf';
/* A repair letter is open for the $97 mailing only while nobody has taken it:
   it targets the bureau, it is not claimed or mailed (the staff send rules of
   src/repair/send.mjs), the client did not save their own submission, the
   Fundhub team does not own that round, and the dispute authorization is
   current (the same SQL the staff send checks). $1 org, $2 client, l = the letter. */
const REPAIR_LETTER_OPEN_SQL=`l.target='bureau' AND l.status IN ('generated','ready')
  AND l.send_claimed_at IS NULL AND l.mailed_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM blueprint_repair_submissions r WHERE r.letter_id=l.id AND r.org_id=l.org_id AND r.client_id=l.client_id)
  AND NOT EXISTS(SELECT 1 FROM blueprint_client_services cs JOIN paid_service_requests cp ON cp.id=cs.id AND cp.org_id=cs.org_id AND cp.client_id=cs.client_id
    WHERE cs.org_id=l.org_id AND cs.client_id=l.client_id AND cs.state IN ('paid','in_progress')
      AND cp.status IN ('paid','staged','fulfilled') AND cp.payment_ref IS NOT NULL AND cp.amount_paid_cents=cp.price_total_cents
      AND (cs.service_kind='repair_full' OR (cs.service_kind='repair_round' AND cs.round_key=l.round)))
  AND ${currentRepairMailAuthorizationSql(1,2)}`;
// JSONB may reorder object keys after a fresh database read. Content hashes
// must depend on values, while retaining the order of selected-file arrays.
function canonicalJson(value){
  if(value instanceof Date)return value.toJSON();
  if(Array.isArray(value))return value.map(canonicalJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalJson(value[key])]));
  return value;
}
const hash=v=>createHash('sha256').update(JSON.stringify(canonicalJson(v))).digest('hex');
export class LetterMailingError extends Error {constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
function fail(code,message,status=409){throw new LetterMailingError(code,message,status);}
function scopeCheck(s){if(!UUID.test(s?.orgId||'')||!UUID.test(s?.clientId||''))fail('forbidden','Sign in to your client account.',403);}
const at=s=>new Date(s.now||new Date());
const identityOf=async(db,s)=>{const i=await verifiedIdentity(db,s);return {name:i.legalName,line1:i.address?.line1,line2:i.address?.line2||null,city:i.address?.city,state:i.address?.state,postalCode:i.address?.zip};};
function validFrom(a){return !!(a?.name&&a.line1&&a.city&&/^[A-Z]{2}$/.test(a.state||'')&&/^\d{5}(?:-\d{4})?$/.test(a.postalCode||''));}
function fileOf(d){const bureau=String(d.metadata?.bureau||'').toUpperCase();return {documentId:d.id,versionId:d.version_id,title:d.title,
  subtype:d.subtype,bureau,generatedAt:d.generated_at,checksum:d.version_checksum,storageKey:d.version_storage_key,
  mimeType:d.version_mime_type,byteSize:Number(d.version_byte_size),to:bureauMailAddress(bureau),
  /* A repair letter also freezes which dispute letter it is, and its round. */
  ...(d.subtype===REPAIR_LETTER_SUBTYPE?{letterId:String(d.metadata?.letterId||''),round:d.metadata?.round==null?null:String(d.metadata.round),
    target:d.metadata?.target==null?null:String(d.metadata.target)}:{})};}
function fileFits(f){return isRepair(f)?f.mimeType==='text/html'&&f.byteSize<=MAX_HTML_BYTES:f.mimeType==='application/pdf'&&f.byteSize<=MAX_PDF_BYTES;}
/* letter_open is read with the letter (repo.letters): REPAIR_LETTER_OPEN_SQL for this file's own letter. */
function repairOpen(d,f){return !isRepair(f)||(UUID.test(f.letterId||'')&&f.target==='bureau'&&d.letter_open===true);}
function eligible(d,now=new Date()){const f=fileOf(d);return SUBTYPES.includes(f.subtype)&&['EX','EQ','TU'].includes(f.bureau)&&UUID.test(f.versionId||'')
  &&/^sha256:[a-f0-9]{64}$/.test(f.checksum||'')&&f.storageKey&&fileFits(f)
  &&Number.isSafeInteger(f.byteSize)&&f.byteSize>4&&!d.already_claimed&&repairOpen(d,f)
  &&(!d.expires_at||new Date(d.expires_at).getTime()>new Date(now).getTime());}
function ownsBinding(b,s,email){return !!(b&&b.provider==='commas'&&b.source==='verified_provider_receipt'&&b.orgId===s.orgId&&b.clientId===s.clientId&&b.accountId===s.accountId&&/^\d+$/.test(String(b.customerId||''))&&Number(b.customerId)>0&&String(b.email||'').toLowerCase()===String(email||'').toLowerCase());}
const publicItem=f=>({documentId:f.documentId,title:f.title,subtype:f.subtype,bureau:f.bureau,...(isRepair(f)?{kind:'repair',round:f.round??null}:{})});
const iso=v=>{if(!v)return null;const d=v instanceof Date?v:new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();};
/**
 * The tracker for one envelope the mail house accepted, from what it reported
 * (trackLetterMailings). Mail: "sending" while PostGrid has only accepted the
 * letter or is still printing it; "done" (Mailed) only once PostGrid reports
 * processed_for_delivery, with that date (Codex CX28). Delivery is never
 * "delivered": PostGrid never confirms it (CX26). Expected = PostGrid's
 * "completed" date (its own "most likely delivered"); Out for delivery = the
 * post office's last scan. Reply due = the expected delivery date + 30 days, and
 * null until that date is known (CX27). null before acceptance.
 */
export function mailTracker(e){
  if(!e||e.state!=='accepted')return null;
  const status=e.provider_status||null,imb=e.imb_status||null,expected=iso(e.expected_delivery_at);
  return {mail:e.mailed_at?{state:'done',at:iso(e.mailed_at)}:{state:'sending',at:null},
    delivery:expected?{state:'expected',at:expected}:{state:imb==='out_for_delivery'?'now':'todo',at:null},
    replyDueAt:expected?iso(e.reply_due_at):null,
    problem:status==='cancelled'?'cancelled':e.returned_at||imb==='returned_to_sender'?'returned':null,
    checkedAt:iso(e.tracked_at)};
}
export function publicMailingOrder(o){return {id:o.id,orderId:o.id,status:o.state,totalCents:Number(o.price_total_cents),currency:'USD',quoteVersion:o.quote_version,
  items:o.snapshot.files.map(publicItem),returnAddressSummary:o.snapshot.from,
  paymentOptions:o.snapshot.paymentOptions.map(p=>({id:p.id,label:p.label,kind:p.kind})),
  checkoutUrl:safeCheckoutUrl(o.checkout_url),reason:o.reason||null,
  envelopes:(o.envelopes||[]).map(e=>({bureau:e.bureau,status:e.state,providerId:e.provider_id||null,trackingUrl:null,
    documentId:e.document_id||e.snapshot?.documentId||null,letterId:e.dispute_letter_id||null,mailStatus:mailStatus(e),tracker:mailTracker(e)}))};}
/**
 * One word per envelope for every screen that counts letters (PREM's repair
 * card included), so "mailed" means the same thing everywhere (Codex CX28):
 *   'sending'  our call to PostGrid is out, or PostGrid has the letter but has
 *              not reported it handed to the post office (accepted, printing);
 *   'mailed'   PostGrid reported processed_for_delivery; tracker.mail.at is the date;
 *   null       not with the mail house: paid and waiting, held for review, or
 *              cancelled by the mail house.
 */
export function mailStatus(e){
  if(e?.state==='sending')return 'sending';
  if(e?.state!=='accepted'||e.provider_status==='cancelled')return null;
  return e.mailed_at?'mailed':'sending';
}

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
        AND e.checksum=v.checksum AND e.bureau=d.metadata->>'bureau' AND e.state IN ('sending','accepted','needs_review')) AS already_claimed,
      CASE WHEN d.subtype=$4 THEN EXISTS(SELECT 1 FROM dispute_letters l WHERE l.org_id=d.org_id AND l.client_id=d.client_id
        AND l.id::text=d.metadata->>'letterId' AND l.bureau=d.metadata->>'bureau' AND d.metadata->>'target'='bureau'
        AND ${REPAIR_LETTER_OPEN_SQL}) END AS letter_open
      FROM documents d JOIN document_versions v ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE d.org_id=$1 AND d.client_id=$2 AND d.kind='deliverable' AND d.subtype=ANY($3::text[])
      AND d.checksum=v.checksum ORDER BY d.generated_at DESC LIMIT 30`,[s.orgId,s.clientId,SUBTYPES,REPAIR_LETTER_SUBTYPE])).rows;},
    async current(s,f){return !!(await db.query(`SELECT 1 FROM documents d JOIN document_versions v
      ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE d.id=$1 AND d.org_id=$2 AND d.client_id=$3 AND d.current_version_id=$4
      AND d.kind='deliverable' AND d.subtype=$5 AND d.metadata->>'bureau'=$6
      AND v.checksum=$7 AND d.checksum=$7 AND v.storage_key=$8 AND v.mime_type=$10
      AND (d.expires_at IS NULL OR d.expires_at>$9)`,[f.documentId,s.orgId,s.clientId,f.versionId,f.subtype,f.bureau,f.checksum,f.storageKey,at(s),mimeFor(f)])).rows[0];},
    /* Is this frozen repair letter still open for the $97 mailing right now? */
    async repairOpen(s,f){return !!(await db.query(`SELECT 1 FROM dispute_letters l
      WHERE l.org_id=$1 AND l.client_id=$2 AND l.id::text=$3 AND l.bureau=$4 AND ${REPAIR_LETTER_OPEN_SQL}`,
      [s.orgId,s.clientId,String(f.letterId||''),f.bureau])).rows[0];},
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
      for(const f of snapshot.files)await tx.query(`INSERT INTO blueprint_letter_mailing_envelopes (id,order_id,org_id,client_id,document_id,document_version_id,checksum,bureau,snapshot,dispute_letter_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[randomUUID(),id,s.orgId,s.clientId,f.documentId,f.versionId,f.checksum,f.bureau,JSON.stringify(f),isRepair(f)?f.letterId:null]);
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
    /* A repair envelope takes its dispute letter in the same transaction, with
       the staff send's own claim (status 'sending', send_claimed_at). When the
       letter was mailed, claimed or self-submitted meanwhile, neither is taken. */
    async claim(s,id,envelopeId){return withTransaction(db,async tx=>{
      const e=(await tx.query(`UPDATE blueprint_letter_mailing_envelopes e SET state='sending',claimed_at=$4,claim_token=$5,updated_at=now()
      WHERE e.id=$1 AND e.order_id=$2 AND e.org_id=$3 AND e.client_id=$6 AND e.state='ready'
      AND EXISTS(SELECT 1 FROM blueprint_letter_mailing_orders o WHERE o.id=e.order_id AND o.org_id=e.org_id AND o.client_id=e.client_id
        AND o.payment_state='paid' AND o.state IN ('mail_pending','mailing') AND o.authorized_at IS NOT NULL)
      RETURNING *`,[envelopeId,id,s.orgId,at(s),randomUUID(),s.clientId])).rows[0]||null;
      if(!e?.dispute_letter_id)return e;
      const letter=(await tx.query(`WITH prior AS (SELECT id,status FROM dispute_letters WHERE id=$3 AND org_id=$1 AND client_id=$2)
        UPDATE dispute_letters l SET status='sending',send_claimed_at=$5 FROM prior
        WHERE l.id=prior.id AND l.org_id=$1 AND l.client_id=$2 AND l.bureau=$4 AND ${REPAIR_LETTER_OPEN_SQL}
        RETURNING prior.status AS prior_status,l.send_claimed_at::text AS claim_token`,[s.orgId,s.clientId,e.dispute_letter_id,e.bureau,at(s)])).rows[0];
      if(!letter)fail('repair_letter_already_handled','This letter was already sent another way.');
      return {...e,letterClaim:{priorStatus:letter.prior_status,token:letter.claim_token}};
    });},
    /* Nothing left this process (src/repair/send.mjs releaseLetterClaim): give the
       dispute letter back. Never on a row with a mailing, never someone else's claim. */
    async releaseRepairLetter(s,e){if(!e?.dispute_letter_id||!e.letterClaim?.token)return;
      await db.query(`UPDATE dispute_letters SET status=COALESCE($4,'ready'),send_claimed_at=NULL
        WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='sending' AND mailed_at IS NULL AND send_claimed_at=$5::timestamptz`,
        [e.dispute_letter_id,s.orgId,s.clientId,e.letterClaim.priorStatus||null,e.letterClaim.token]);},
    /* The mail house took it. That is not mailed (Codex CX28): the envelope is
       accepted, and a repair letter keeps its claim ('sending') and gains the
       mail house's id, so the staff send and the client's own submission stay
       closed, the stuck-claim list and a clear leave it alone (333, 334), and
       PostGrid's delivery webhook can find it. track() marks it sent when
       PostGrid reports the handoff. One transaction. */
    async accepted(s,id,e,providerId){return withTransaction(db,async tx=>{
      const done=(await tx.query(`UPDATE blueprint_letter_mailing_envelopes SET state='accepted',provider_id=$6,accepted_at=$7,updated_at=now()
        WHERE id=$1 AND order_id=$2 AND org_id=$3 AND client_id=$4 AND claim_token=$5 AND state='sending' RETURNING id`,
        [e.id,id,s.orgId,s.clientId,e.claim_token,providerId,at(s)])).rows[0];
      if(!done||!e.dispute_letter_id)return;
      await tx.query(`UPDATE dispute_letters SET postgrid_letter_id=COALESCE($4::text,postgrid_letter_id)
        WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='sending'`,[e.dispute_letter_id,s.orgId,s.clientId,providerId]);
    });},
    /* The tracker queue: accepted, no expected delivery date yet, not returned
       or cancelled, accepted in the last 45 days, not read in 6 hours. Every company. */
    async trackable(limit,now){return (await db.query(`SELECT id,order_id,org_id,client_id,provider_id,accepted_at FROM blueprint_letter_mailing_envelopes
      WHERE state='accepted' AND provider_id ~ '^letter_[a-zA-Z0-9]+$' AND expected_delivery_at IS NULL AND returned_at IS NULL
        AND provider_status IS DISTINCT FROM 'cancelled' AND accepted_at > $2::timestamptz - interval '45 days'
        AND (tracked_at IS NULL OR tracked_at < $2::timestamptz - interval '6 hours')
      ORDER BY tracked_at NULLS FIRST,accepted_at LIMIT $1`,[limit,now])).rows;},
    /* Dates are set once; a null fact (or a failed read) changes nothing but
       tracked_at. When PostGrid first reports the handoff to the post office,
       a repair letter's file says mailed then, with that date: the letter
       sent, the round's items sent, the case waiting on the bureau (CX28).
       When the expected delivery date first lands, the bureau's reply date is
       that date + 30 days, on the envelope and (for a repair letter, when the
       case has none yet) on its dispute case, so the client's progress page
       and the tracker show the same date (CX27). One transaction. Answers
       null when nothing was saved, else whether the letter was mailed just now. */
    async track(e,facts,now){return withTransaction(db,async tx=>{
      const before=(await tx.query(`SELECT mailed_at FROM blueprint_letter_mailing_envelopes
        WHERE id=$1 AND order_id=$2 AND org_id=$3 AND client_id=$4 AND state='accepted' FOR UPDATE`,[e.id,e.order_id,e.org_id,e.client_id])).rows[0];
      if(!before)return null;
      const row=(await tx.query(`UPDATE blueprint_letter_mailing_envelopes SET
          provider_status=COALESCE($5,provider_status),imb_status=COALESCE($6,imb_status),
          mailed_at=COALESCE(mailed_at,$7),expected_delivery_at=COALESCE(expected_delivery_at,$8),returned_at=COALESCE(returned_at,$9),
          reply_due_at=COALESCE(reply_due_at,COALESCE(expected_delivery_at,$8)+($11::int*interval '1 day')),tracked_at=$10,updated_at=now()
        WHERE id=$1 AND order_id=$2 AND org_id=$3 AND client_id=$4 AND state='accepted'
        RETURNING id,order_id,bureau,provider_id,dispute_letter_id,mailed_at,reply_due_at`,
        [e.id,e.order_id,e.org_id,e.client_id,facts?.providerStatus??null,facts?.imbStatus??null,facts?.mailedAt??null,
          facts?.expectedDeliveryAt??null,facts?.returnedAt??null,now,MAILING_REPLY_DAYS])).rows[0];
      if(!row)return null;
      const mailedNow=!before.mailed_at&&!!row.mailed_at;
      if(row.dispute_letter_id&&mailedNow){
        const letter=(await tx.query(`UPDATE dispute_letters SET status='sent',mailed_at=COALESCE(mailed_at,$4)
          WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='sending' AND postgrid_letter_id=$5 RETURNING case_id,round`,
          [row.dispute_letter_id,e.org_id,e.client_id,row.mailed_at,row.provider_id])).rows[0];
        if(letter){
          await tx.query(`UPDATE dispute_items SET status='sent' WHERE case_id=$1 AND org_id=$2 AND client_id=$3 AND round=$4
            AND status IN ('open','escalated','unaddressed')`,[letter.case_id,e.org_id,e.client_id,letter.round]);
          await tx.query(`UPDATE dispute_cases SET status=CASE WHEN status IN ('closed','cancelled') THEN status ELSE 'awaiting_response' END,updated_at=now()
            WHERE id=$1 AND org_id=$2 AND client_id=$3`,[letter.case_id,e.org_id,e.client_id]);
        }
      }
      if(row.dispute_letter_id&&row.reply_due_at)await tx.query(`UPDATE dispute_cases c SET response_due_at=$4,updated_at=now()
        FROM dispute_letters l WHERE l.id=$1 AND l.org_id=$2 AND l.client_id=$3
          AND c.id=l.case_id AND c.org_id=l.org_id AND c.client_id=l.client_id AND c.response_due_at IS NULL`,
        [row.dispute_letter_id,e.org_id,e.client_id,row.reply_due_at]);
      return {mailedNow,orderId:row.order_id,bureau:row.bureau,providerId:row.provider_id||null,disputeLetterId:row.dispute_letter_id||null};
    });},
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
// Read-only buyer readiness. Reuse the exact scoped current-version file rules,
// without constructing a provider, checking capabilities or looking up cards.
export async function readBlueprintLetterReadiness(db,s,{repo=createMailingRepository(db)}={}){
  scopeCheck(s);
  const [rows,orders]=await Promise.all([repo.letters(s),repo.orders(s)]);
  const usableLetterCount=rows.filter(row=>eligible({...row,already_claimed:false},at(s))).length;
  const requested=orders.filter(order=>order&&['payment_pending','awaiting_payment','mail_pending','mailing','mailed','needs_review'].includes(order.state));
  const hasRequest=requested.length>0||rows.some(row=>row.already_claimed);
  return {orgId:s.orgId,clientId:s.clientId,state:hasRequest?'requested':usableLetterCount?'ready':'not_ready',usableLetterCount,mailingOrderCount:requested.length};
}
function dependencies(db,deps){return {...deps,repo:deps.repo||createMailingRepository(db),providers:deps.providers||createMailingProviders(deps),
  loadFrom:deps.loadFrom||identityOf,active:deps.active||isBlueprintCoachClient,
  loadPdf:deps.loadPdf|| (async f=>(await storeFromEnv(deps.env||process.env).get(f.storageKey,{expectedChecksum:f.checksum})).body)};}
async function scopedClient(s,d){scopeCheck(s);const c=await d.repo.client(s);if(!c||c.id!==s.clientId||c.org_id!==s.orgId)fail('client_not_found','Client file not found.',404);return c;}
/* The exact saved bytes, checked again before money or mail: a funding letter
   is its PDF, a repair letter its HTML file (the words the client opened). */
function checkFile(content,f){const b=Buffer.from(content||[]);
  const head=isRepair(f)?/^\s*<(?:!doctype\s+html|html)[\s>]/i.test(b.subarray(0,128).toString('utf8')):b.subarray(0,5).equals(Buffer.from('%PDF-'));
  if(b.length!==f.byteSize||b.length>(isRepair(f)?MAX_HTML_BYTES:MAX_PDF_BYTES)||!head
  ||`sha256:${createHash('sha256').update(b).digest('hex')}`!==f.checksum)fail('letter_content_unavailable','A selected letter needs to be regenerated before mailing.');return b;}
const REPAIR_HANDLED='This letter was already sent another way. Nothing was charged.';
export async function readLetterMailing(db,s,deps={}){const d=dependencies(db,deps);const client=await scopedClient(s,d);
  const rows=await d.repo.letters(s),orders=await d.repo.orders(s),binding=await d.repo.verifiedCustomer(s);
  const capabilities={...d.providers.capabilities(),savedCardSupported:ownsBinding(binding,s,client.email)};
  // The fulfillment cycle: the exact bureau address and the client's approval of this letter version.
  const approvals=await (deps.readLetterApprovals||readLetterApprovals)(db,s);
  /* A repair letter is listed while it can be mailed for $97, or once it is in a
     mailing. One that went another way (self-mailed, staff-mailed, team-run,
     not a bureau letter) stays on the repair work list only. */
  const shown=rows.filter(r=>r.subtype!==REPAIR_LETTER_SUBTYPE||r.already_claimed||eligible(r,at(s)));
  return {ok:true,letters:shown.map(r=>{const f=fileOf(r),ok=!!eligible(r,at(s));return {documentId:r.id,title:r.title,subtype:r.subtype,bureau:String(r.metadata?.bureau||''),generatedAt:r.generated_at,
    eligibleForMailing:ok,reason:ok?null:r.already_claimed?'already_requested':'letter_not_ready',
    kind:isRepair(f)?'repair':'funding',...(isRepair(f)?{round:f.round,letterId:UUID.test(f.letterId||'')?f.letterId:null}:{}),
    ...letterCycle({bureau:r.metadata?.bureau,target:r.metadata?.target??'bureau',versionId:r.version_id,approvals})};}),orders:orders.map(publicMailingOrder),capabilities,priceCents:9700,maxLetters:MAX_MAILING_LETTERS};}
export async function quoteLetterMailing(db,s,input,deps={}){const d=dependencies(db,deps),client=await scopedClient(s,d),ids=input?.documentIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_MAILING_LETTERS||ids.some(id=>!UUID.test(id))||new Set(ids).size!==ids.length)fail('invalid_letters','Choose one to six distinct letters.',400);
  if(!d.providers.capabilities().mailSupported||!d.providers.capabilities().hostedCheckoutSupported)fail('mailing_unavailable','Mailing checkout is unavailable. You can still download and mail your letters.');
  const rows=await d.repo.letters(s),selected=ids.map(id=>rows.find(r=>r.id===id));
  if(selected.some(r=>!r||!eligible(r,at(s))))fail('letter_not_available','Choose ready letters from your own file.');
  const files=selected.map(fileOf).sort((a,b)=>a.documentId.localeCompare(b.documentId)),from=await d.loadFrom(db,s);
  if(new Set(files.map(f=>`${f.bureau}:${f.checksum}`)).size!==files.length)fail('duplicate_letter_content','Choose one copy of each letter for each bureau.');
  if(!validFrom(from))fail('return_address_required','Confirm your legal name and home mailing address first.');
  for(const f of files){if(!await d.repo.current(s,f))fail('letter_changed','A selected letter changed. Review a new quote.');
    if(isRepair(f)&&!await d.repo.repairOpen(s,f))fail('repair_letter_already_handled',REPAIR_HANDLED);checkFile(await d.loadPdf(f),f);}
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
  for(const f of o.snapshot.files){if(!await d.repo.current(s,f))fail('letter_changed','A selected letter changed. Review a new quote.');
    if(isRepair(f)&&!await d.repo.repairOpen(s,f))fail('repair_letter_already_handled',REPAIR_HANDLED);checkFile(await d.loadPdf(f),f);}
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
  /* Provably nothing left this process: a repair letter goes back to its file. */
  const giveBack=async c=>{if(c?.dispute_letter_id&&d.repo.releaseRepairLetter)try{await d.repo.releaseRepairLetter(s,c);}catch{/* the claim stays for a person */}};
  for(const e of o.envelopes){
    if(e.state==='sending'&&at(s).getTime()-new Date(e.claimed_at).getTime()>15*60*1000){await d.repo.envelopeHold(s,id,e);break;}
    if(e.state!=='ready'||sent>=Math.min(deps.maxEnvelopes||2,2))continue;
    if(!await d.repo.current(s,e.snapshot)){await d.repo.hold(s,id,'letter_version_changed');break;}
    let file;try{file=checkFile(await d.loadPdf(e.snapshot),e.snapshot);}catch{await d.repo.hold(s,id,'letter_content_unavailable');break;}
    let claimed;try{claimed=await d.repo.claim(s,id,e.id);}catch(err){await d.repo.hold(s,id,err?.code==='repair_letter_already_handled'?'repair_letter_already_handled':'duplicate_letter_claim');break;}
    if(!claimed)continue;
    if(!await d.repo.current(s,e.snapshot)){await giveBack(claimed);await d.repo.envelopeHold(s,id,claimed,'letter_version_changed');break;}
    const content=isRepair(e.snapshot)?{html:file.toString('utf8')}:{pdf:file};
    let r;try{r=await d.providers.sendEnvelope({order:o,envelope:claimed,...content});}catch{r={ok:false};}
    if(r.ok&&r.providerId){
      // The mail house has it. Recording that is the one thing that stops a second envelope: one retry.
      try{await d.repo.accepted(s,id,claimed,r.providerId);}catch{await d.repo.accepted(s,id,claimed,r.providerId);}
    }else {if(r.preTransmission===true)await giveBack(claimed);await d.repo.envelopeHold(s,id,claimed);break;}
    sent++;
  }
  await d.repo.complete(s,id);
  return {ok:true,...publicMailingOrder(await ownOrder(s,id,d))};
}
/* Repair letters PostGrid just reported handed to the post office move the
   repair file to "in transit" and queue the existing letters-sent email ("your
   dispute letters ... are on the way"): at the handoff, never at acceptance
   (Codex CX28). One event per batch per tracker run (src/repair/handlers.mjs,
   the event the staff send and the client's own receipt already fire). Best
   effort: the mailing is already recorded, so a failure is logged, not thrown. */
async function announceRepairMailed(db,{orgId,clientId,orderId},letters,deps){
  if(!letters.length)return;
  const ids=letters.map(l=>l.letterId).sort();
  try{const fire=deps.onRepairEvent||(await import('../repair/handlers.mjs')).onRepairEvent;
    await fire(db,{name:'repair.letters.sent',orgId,clientId,payload:{source:'blueprint_letter_mailing',orderId,
      results:letters.map(l=>({ok:true,letterId:l.letterId,bureau:l.bureau,providerId:l.providerId})),
      idempotencyKey:`repair.letters.sent:blueprint-mail:${orderId}:${ids.join('+')}`}});
  }catch(err){console.warn('[blueprint-mail] repair file not moved after mailing:',String(err?.message||err).slice(0,160));}
}
export async function processLetterMailingOrder(db,s,id,deps={}){const reconciled=await reconcileLetterMailing(db,s,id,deps);if(!reconciled.ok)return reconciled;return fulfilLetterMailing(db,s,id,deps);}
export async function sweepLetterMailings(db,deps={}){const d=dependencies(db,deps),rows=await d.repo.pending(Math.min(Math.max(deps.limit||5,1),5));
  const result={ok:true,examined:rows.length,mailed:0,needsReview:await d.repo.heldCount(),failed:0};
  for(const row of rows)try{const r=await processLetterMailingOrder(db,{orgId:row.org_id,clientId:row.client_id,now:deps.now||new Date()},row.id,deps);
    if(r.status==='mailed')result.mailed++;if(r.status==='needs_review')result.needsReview++;if(!r.ok)result.failed++;
  }catch{result.failed++;}
  result.ok=result.failed===0&&result.needsReview===0;return result;
}

/* ── The mail tracker ─────────────────────────────────────────────────────── */
const PROVIDER_STATUSES=Object.freeze(['ready','printing','processed_for_delivery','completed','cancelled']);
const IMB_STATUSES=Object.freeze(['entered_mail_stream','out_for_delivery','returned_to_sender']);
/**
 * What one PostGrid letter read proves (guides.postgrid.com, letters: retrieve;
 * postgrid.readme.io, tracking your orders). Mailed = PostGrid's own status
 * processed_for_delivery, "handed off to the local postal service" (or the
 * later completed); ready and printing are not mailed (Codex CX28). The mailed
 * date is that report's time, or an earlier post office scan; never before the
 * handoff. completed is PostGrid's own "most likely delivered" and not a
 * confirmation, so its date is only the EXPECTED delivery date (CX26);
 * PostGrid's letter has no other delivery estimate field. imbStatus = the post
 * office's scans. Dates come from PostGrid's clock, never after now and never
 * before the acceptance. A word PostGrid did not send stays null.
 */
export function letterTrackFacts(letter,{now=new Date(),acceptedAt=null}={}){
  const status=PROVIDER_STATUSES.includes(letter?.status)?letter.status:null;
  const imb=IMB_STATUSES.includes(letter?.imbStatus)?letter.imbStatus:null;
  const hi=new Date(now).getTime(),low=acceptedAt==null?NaN:new Date(acceptedAt).getTime();
  /* A date-only scan day ("2026-11-10") is that calendar day everywhere in the
     US: read it at noon UTC, the same rule blueprint-plan.js uses for dates. */
  const when=v=>{if(v==null||v==='')return null;let t=new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v))?`${v}T12:00:00Z`:v).getTime();if(!Number.isFinite(t))return null;
    if(Number.isFinite(low))t=Math.max(t,low);return new Date(Math.min(t,hi)).toISOString();};
  const changed=when(letter?.updatedAt)||new Date(hi).toISOString(),scanned=when(letter?.imbDate)||changed;
  const earlier=(a,b)=>a&&b?(a<b?a:b):a||b,later=(a,b)=>a&&b?(a>b?a:b):a||b;
  const handedOff=['processed_for_delivery','completed'].includes(status);
  const mailedAt=handedOff?earlier(changed,['entered_mail_stream','out_for_delivery'].includes(imb)?scanned:null):null;
  return {providerStatus:status,imbStatus:imb,mailedAt,
    expectedDeliveryAt:status==='completed'?later(changed,mailedAt):null,returnedAt:imb==='returned_to_sender'?scanned:null};
}
/**
 * Read what the mail house reports for up to three accepted envelopes (GET only)
 * and save it on the tracker. Never sends, never charges, never changes an
 * envelope's state. A failed read keeps every saved fact; only the read time moves.
 */
export async function trackLetterMailings(db,deps={}){
  const repo=deps.repo||createMailingRepository(db),providers=deps.providers||createMailingProviders(deps),now=deps.now||new Date();
  const rows=await repo.trackable(Math.min(Math.max(Number(deps.limit)||3,1),3),now);
  const result={ok:true,examined:rows.length,updated:0,failed:0,mailed:0};
  const handedOff=new Map();
  for(const e of rows){let r;try{r=await providers.readLetter(e.provider_id);}catch{r={ok:false};}
    if(!r?.ok||!r.letter){result.failed++;try{await repo.track(e,null,now);}catch{/* next read retries */}continue;}
    let saved;try{saved=await repo.track(e,letterTrackFacts(r.letter,{now,acceptedAt:e.accepted_at}),now);}
    catch{result.failed++;continue;/* one envelope fails alone; blueprint:letter-mailing shows a letter never read */}
    if(!saved)continue;
    result.updated++;
    if(!saved.mailedNow)continue;
    result.mailed++;
    if(!saved.disputeLetterId)continue;
    const key=`${e.org_id}:${e.client_id}:${saved.orderId}`;
    if(!handedOff.has(key))handedOff.set(key,{orgId:e.org_id,clientId:e.client_id,orderId:saved.orderId,letters:[]});
    handedOff.get(key).letters.push({letterId:saved.disputeLetterId,bureau:saved.bureau,providerId:saved.providerId});
  }
  for(const batch of handedOff.values())await announceRepairMailed(db,batch,batch.letters,deps);
  result.ok=result.failed===0;return result;
}
