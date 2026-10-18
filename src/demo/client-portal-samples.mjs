// Account-scoped, read-only presentation. Never seeds or changes a live record.
import bundle from './client-portal-sample-bundle.json' with { type: 'json' };

export async function clientSampleAccount(database, p) {
  if (p?.kind !== 'client' || p.authorizedRep || !p.accountId || !p.clientId || !p.orgId || String(p.email).toLowerCase() !== 'client@fundhub.ai') return false;
  try {
    const r=await database.query(`SELECT a.id AS account_id,a.org_id,a.client_id,a.email,a.kind,a.status,
        c.org_id AS client_org_id,c.client_master_key
      FROM accounts a JOIN clients c ON c.id=a.client_id AND c.org_id=a.org_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.client_id=$3
        AND a.kind='client' AND a.status='active' AND lower(a.email)='client@fundhub.ai'
        AND c.client_master_key='FDH-TEST-CLIENT-ROLE-ACCOUNT'`,[p.accountId,p.orgId,p.clientId]);
    const a=r.rows[0];
    return !!(a&&a.account_id===p.accountId&&a.org_id===p.orgId&&a.client_org_id===p.orgId&&a.client_id===p.clientId&&a.kind==='client'&&a.status==='active'&&a.email.toLowerCase()==='client@fundhub.ai'&&a.client_master_key==='FDH-TEST-CLIENT-ROLE-ACCOUNT');
  } catch {return null;}
}

export function realPortalData(req) {
  return /(?:^|;\s*)fh_portal_data=real(?:;|$)/.test(String(req.headers?.cookie||''));
}

// Invoked only after authentication/kind permission. The original handler still
// executes every scope/read gate. Only its successful read response is decorated.
export async function installClientSamples(req,res,p,database,{data=bundle}={}) {
  const path=String(req.url||'').split('?')[0];
  const covered=Object.hasOwn(data.reads||{},path);
  const method=req.method||'GET';
  const realAction=path==='/api/affiliates/refer';
  if((method==='GET'&&!covered)||realAction)return true;
  const eligible=await clientSampleAccount(database,p);
  if(eligible===null&&!realPortalData(req)){
    res.status(503).json({ok:false,error:'sample_identity_unavailable',message:'We could not verify the account data view. Nothing was changed. Please try again.'});
    return false;
  }
  if(!eligible)return true;
  res.setHeader('Cache-Control','private, no-store');
  if(realPortalData(req))return true;
  if(method!=='GET') {
    res.status(409).json({ok:false,error:'sample_read_only',message:'Sample view is read-only. Choose View real account to use this action.'});
    return false;
  }
  if(!covered)return true;
  const json=res.json.bind(res),status=res.status.bind(res);let code=200;
  res.status=function(n){code=n;return status(n);};
  res.json=function(payload){
    if(code>=200&&code<300&&payload?.ok===true){
      const sample=structuredClone(data.reads[path]);
      if(path==='/api/read/client-progress')sample.referral=payload.referral;
      return json({...sample,portal_sample:true,sample_notice:data.notice});
    }
    return json(payload);
  };
  return true;
}
