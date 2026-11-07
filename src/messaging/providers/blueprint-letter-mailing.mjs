// Explicit Blueprint mailing purchases only. No scheduler may create a charge.
// Primary docs: commasdocs.com (Customers / Checkout Sessions / Transactions),
// guides.postgrid.com/api/resources/print_mail/subresources/letters/methods/create/
// (pdf or html content) and .../letters/methods/retrieve/ (status, imbStatus).
import { transmit, ADAPTERS, MESSAGING } from '../../lib/outbound-fetch.mjs';
import { fenceVerdict, ADAPTERS_DRY_RUN, MESSAGING_DRY_RUN } from '../../lib/dry-run.mjs';
import { checkoutConfig, createCheckoutSession } from '../../payments/commas-api.mjs';

const numericId = v => /^\d+$/.test(String(v || '')) && Number(v) > 0;
const emailOf = v => String(v || '').trim().toLowerCase();
export function moneyCents(value) {
  const s = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [a,b=''] = s.split('.'); const n = Number(a)*100+Number(b.padEnd(2,'0'));
  return Number.isSafeInteger(n) ? n : null;
}
export function safeCheckoutUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password
    && ['fanbasis.com','www.fanbasis.com','pay.commas.io','commas.io'].includes(u.hostname) ? u.href : null; }
  catch { return null; }
}
function destination(a) {
  if(!a?.company_name||!a.address_line1||!a.address_city||!a.address_state||!a.address_zip)return null;
  return {companyName:a.company_name,addressLine1:a.address_line1,addressLine2:a.address_line2||undefined,city:a.address_city,provinceOrState:a.address_state,postalOrZip:a.address_zip,countryCode:a.address_country||'US'};
}
function contact(a) {
  if (!a?.name || !a.line1 || !a.city || !a.state || !a.postalCode) return null;
  const [firstName,...rest] = a.name.trim().split(/\s+/);
  return {firstName,lastName:rest.join(' ') || undefined,addressLine1:a.line1,
    addressLine2:a.line2 || undefined,city:a.city,provinceOrState:a.state,postalOrZip:a.postalCode,countryCode:'US'};
}
export function createMailingProviders({env=process.env,fetchImpl=fetch}={}) {
  const cfg=checkoutConfig(env);
  const adapters=fenceVerdict(ADAPTERS_DRY_RUN,env).allowed;
  const mail=!!env.POSTGRID_API_KEY && fenceVerdict(MESSAGING_DRY_RUN,env).allowed;
  const capabilities=()=>({savedCardSupported:false,hostedCheckoutSupported:!!cfg.ok&&adapters,
    mailSupported:mail,reason:!mail?'mail_provider_unavailable':!cfg.ok||!adapters?'payment_provider_unavailable':null});
  async function request(path,{method='GET',body,idempotencyKey}={}) {
    if (!cfg.ok || !adapters) return {ok:false,preTransmission:true};
    return transmit(`${cfg.base}${path}`,{method,headers:{'x-api-key':cfg.apiKey,
      ...(body?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
      ...(body?{body:JSON.stringify(body)}:{})},{fence:ADAPTERS,env,fetchImpl,what:'Blueprint mailing payment',timeoutMs:10000});
  }
  return { capabilities,
    async savedCards({customerId,email}) {
      const normalized=emailOf(email);if(!normalized||!numericId(customerId))return [];
      // Numeric customer ID must come from a previously verified same-account
      // provider receipt binding. Never discover a chargeable card by email.
      const methods=await request(`/customers/${customerId}/payment-methods`);
      const data=methods.body?.data;
      if(!methods.ok||String(data?.customer?.id)!==String(customerId)||emailOf(data.customer.email)!==normalized
        ||!Array.isArray(data.payment_methods))return [];
      return data.payment_methods.filter(m=>m.type==='card'&&typeof m.id==='string'&&/^[a-zA-Z0-9_-]{4,100}$/.test(m.id)
        &&/^\d{4}$/.test(String(m.last4||''))).slice(0,5).map(m=>({customerId:String(customerId),methodId:m.id,
          label:`${String(m.metadata?.data?.card_type||'Card').replace(/[^a-zA-Z ]/g,'').slice(0,20)} ending ${m.last4}`}));
    },
    async charge({customerId,methodId,orderId,amountCents}) {
      if(!numericId(customerId)||!methodId||amountCents!==9700)return {ok:false,preTransmission:true};
      const r=await request(`/customers/${customerId}/charge`,{method:'POST',
        body:{payment_method_id:methodId,amount_cents:9700,description:'Document Mailing Service'},idempotencyKey:`blueprint-mail:${orderId}`});
      const d=r.body?.data;
      if(r.ok&&r.body?.status==='success'&&d?.status==='succeeded'&&d.charge_id&&moneyCents(d.amount)===9700)
        return {ok:true,paid:true,providerRef:String(d.charge_id),amountCents:9700};
      // Only a documented, definite refusal permits a different checkout. A timeout,
      // malformed success or pending response may already have charged the buyer.
      const msg=String(r.body?.message||'');
      const refused=[403,404].includes(r.status)&&/no authorized subscription|manual rebill|rebilling.*(disabled|not enabled)/i.test(msg);
      return {ok:false,definitiveRefusal:refused,preTransmission:r.preTransmission===true||r.transmitted===false,
        pending:r.ok,providerRef:d?.charge_id?String(d.charge_id):null};
    },
    async hosted({orderId,orgId,clientId}) {
      if(!cfg.ok||!adapters)return {ok:false,preTransmission:true};
      const out=await createCheckoutSession({amountCents:9700,productTitle:'Document Mailing Service',type:'onetime_non_reusable',
        metadata:{link_ref:orderId,org_id:orgId,client_id:clientId,service_kind:'letter_mailing'},env,fetchImpl,timeoutMs:10000});
      const url=safeCheckoutUrl(out.paymentLink);
      return out.ok&&url&&out.productId?{ok:true,checkoutUrl:url,sessionId:String(out.checkoutSessionId||out.productId),productId:String(out.productId)}
        :{ok:false,preTransmission:!cfg.ok||!adapters};
    },
    async readHosted(order) {
      if(!order.checkout_product_id)return {status:'unknown'};
      const r=await request(`/checkout-sessions/transactions?product_id=${encodeURIComponent(order.checkout_product_id)}&per_page=100`);
      const rows=r.body?.data?.transactions;
      if(!r.ok||!Array.isArray(rows))return {status:'unavailable'};
      const matched=rows.filter(t=>String(t.product?.id??t.product_id??t.checkout_session_id??'')===order.checkout_product_id);
      const paid=matched.filter(t=>['succeeded','paid','completed','success'].includes(String(t.status||'').toLowerCase()));
      if(!paid.length)return {status:'pending'};
      if(paid.length!==1)return {status:'mismatch'};
      const t=paid[0], meta=t.api_metadata?.data||t.metadata||{};
      const payer=emailOf(t.customer?.email||t.fan?.email||t.buyer?.email||t.customer_email);
      if((Array.isArray(t.refunds)&&t.refunds.length)||t.refunded===true||Number(t.amount_refunded||t.refunded_amount||0)>0)return {status:'mismatch'};
      const amount=moneyCents(t.amount??t.amount_paid??t.total??t.product?.price);
      if(payer!==emailOf(order.snapshot.email)||amount!==9700||String(t.currency||'').toUpperCase()!=='USD'
        ||(meta.link_ref!=null&&meta.link_ref!==order.id)||(meta.org_id!=null&&meta.org_id!==order.org_id)||(meta.client_id!=null&&meta.client_id!==order.client_id)||!t.id)return {status:'mismatch'};
      return {status:'paid',providerRef:String(t.id),amountCents:amount};
    },
    /* One envelope: a funding letter's saved PDF, or a repair letter's saved
       HTML file (PostGrid's `html` content, the same form fields). */
    async sendEnvelope({order,envelope,pdf,html}) {
      if(!mail)return {ok:false,preTransmission:true};
      const from=contact(order.snapshot.from), to=destination(envelope.snapshot.to);
      const isPdf=html==null&&Buffer.isBuffer(pdf)&&pdf.length<=5*1024*1024&&pdf.subarray(0,5).equals(Buffer.from('%PDF-'));
      const isHtml=pdf==null&&typeof html==='string'&&Buffer.byteLength(html)<=512*1024&&/^\s*<(?:!doctype\s+html|html)[\s>]/i.test(html);
      if(!from||!to?.addressLine1||!(isPdf||isHtml))return {ok:false,preTransmission:true};
      const form=new FormData();
      for(const [prefix,value] of [['from',from],['to',to]])for(const [k,v] of Object.entries(value))if(v!=null)form.append(`${prefix}[${k}]`,String(v));
      if(isPdf)form.append('pdf',new Blob([pdf],{type:'application/pdf'}),'letter.pdf');
      else form.append('html',html);
      for(const [k,v] of Object.entries({envelopeType:'flat',addressPlacement:'top_first_page',color:'false',doubleSided:'true',mailingClass:'usps_first_class',description:'Document Mailing Service'}))form.append(k,v);
      form.append('metadata[fundhub_mailing_order]',order.id);form.append('metadata[fundhub_envelope]',envelope.id);
      const r=await transmit('https://api.postgrid.com/print-mail/v1/letters',{method:'POST',
        headers:{'x-api-key':env.POSTGRID_API_KEY,'idempotency-key':`blueprint-mail-envelope:${envelope.id}`},body:form},
        {fence:MESSAGING,env,fetchImpl,what:'Explicit paid Blueprint letter mailing',timeoutMs:15000});
      const d=r.body?.data||r.body;
      return r.ok&&typeof d?.id==='string'&&/^letter_[a-zA-Z0-9]+$/.test(d.id)
        ?{ok:true,providerId:d.id}:{ok:false,preTransmission:r.transmitted===false};
    },
    /* The tracker read: GET one letter PostGrid accepted. Reads only; it cannot
       create, change or cancel mail. Only the fields the tracker uses come back. */
    async readLetter(providerId) {
      const id=String(providerId||'');
      if(!mail||!/^letter_[a-zA-Z0-9]+$/.test(id))return {ok:false,preTransmission:true};
      const r=await transmit(`https://api.postgrid.com/print-mail/v1/letters/${encodeURIComponent(id)}`,{method:'GET',
        headers:{'x-api-key':env.POSTGRID_API_KEY}},{fence:MESSAGING,env,fetchImpl,what:'Blueprint letter mailing tracker read',timeoutMs:5000});
      const l=r.body?.data&&typeof r.body.data==='object'?r.body.data:r.body;
      if(!r.ok||!l||typeof l!=='object'||l.id!==id)return {ok:false,preTransmission:r.transmitted===false};
      const text=v=>typeof v==='string'&&v.length<=64?v:null;
      return {ok:true,letter:{status:text(l.status),imbStatus:text(l.imbStatus),imbDate:text(l.imbDate),updatedAt:text(l.updatedAt)}};
    }
  };
}
