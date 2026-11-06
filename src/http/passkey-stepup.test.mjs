import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import route from "../../api/auth/passkey.mjs";
const orgId = randomUUID(), accountId = randomUUID(), sessionId = randomUUID(), clientId = randomUUID(), staffId = randomUUID();
const response = () => ({ statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; },
  status(n) { this.statusCode=n; return this; }, json(value) { this.body=value; return this; } });
const principal = { kind: "client", orgId, accountId, sessionId, clientId };
const deps = { db: {}, requirePrincipal: async () => principal };

test("passkey route is POST-only, no-store and refuses cross-origin or malformed calls", async () => {
  for (const [req, code] of [[{ method: "GET" },405], [{ method: "POST", headers: { origin: "https://evil.test" } },403],
    [{ method: "POST", headers: { "sec-fetch-site": "cross-site" } },403],
    [{ method: "POST", body: "bad" },400], [{ method: "POST", body: [] },400]]) {
    const res=response(); await route(req,res,deps); assert.equal(res.statusCode,code); assert.equal(res.headers["Cache-Control"],"no-store");
  }
});

test("client and affiliate passkey identities come only from their verified account session", async () => {
  for (const kind of ["client_bank","affiliate_payout"]) {
    const res=response(), ownTarget=randomUUID(); let seen;
    await route({ method: "POST", body: { action: "status", target_kind: kind,
      account_id: randomUUID(), target_id: randomUUID(), org_id: randomUUID(), session_id: randomUUID() } }, res,
    { ...deps, requirePrincipal: async () => ({ ...principal, affiliateId: ownTarget }),
      passkeyAction: async (_db, identity) => { seen=identity; return { ok:true }; } });
    assert.equal(res.statusCode,200); assert.equal(seen.accountId,accountId); assert.equal(seen.orgId,orgId);
    assert.equal(seen.sessionId,sessionId); assert.equal(seen.targetId,kind==="client_bank"?clientId:ownTarget);
  }
});

test("company bank requires owner, uses attached staff session and cannot accept a chosen org", async () => {
  for (const role of ["owner","admin","closer"]) {
    const res=response(); let seen;
    await route({ method:"POST",body:{ action:"status",target_kind:"company_bank",target_id:randomUUID() } },res,
      { db:{},requireAuth:async req => { req.session={id:sessionId}; return {id:staffId,org_id:orgId,role}; },
        passkeyAction:async (_db,i) => {seen=i;return {ok:true};} });
    assert.equal(res.statusCode,role==="owner"?200:403);
    if(role==="owner") assert.deepEqual(seen,{orgId,staffId,sessionId,targetKind:"company_bank",targetId:orgId});
    else assert.equal(seen,undefined);
  }
});

test("route preserves unauthenticated refusal and sanitizes model failures", async () => {
  const res=response(); await route({method:"POST",body:{target_kind:"client_bank",action:"status"}},res,
    {...deps,requirePrincipal:async (_req,r)=>{r.status(401).json({ok:false,error:"unauthorized"});return null;}});
  assert.equal(res.statusCode,401);
  const failed=response(); await route({method:"POST",body:{target_kind:"client_bank",action:"status"}},failed,
    {...deps,passkeyAction:async()=>{throw new Error("private verifier detail");}});
  assert.equal(failed.statusCode,503); assert.equal(failed.body.error,"passkey_unavailable");
  assert.ok(!JSON.stringify(failed.body).includes("private"));
});
