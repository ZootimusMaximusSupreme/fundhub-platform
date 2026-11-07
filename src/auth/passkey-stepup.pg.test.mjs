// Actual local PostgreSQL + real P-256 WebAuthn signatures. No provider calls.
import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { passkeyAction, bankPasskeyAssurance } from "./passkey-stepup.mjs";
import { authorizeAccountPlaidLink, advanceAccountPlaidLink } from "./account-plaid-mfa.mjs";
import { syntheticPasskey } from "./passkey-test-support.mjs";
import { hashToken } from "./session.mjs";
import { PLAID_GRANT_SQL } from "../pulse/beats/lib/auth-truth.mjs";
import { eraseClient } from "../privacy/erasure.mjs";
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

describe("bank passkey real PostgreSQL app-role and signed assertion proof", {
  skip: isLocalScratchDatabaseUrl(url) ? false : "local scratch PostgreSQL required"
}, () => {
  let admin, app;
  before(async () => {
    admin = new pg.Pool({ connectionString: url });
    app = new pg.Pool({ connectionString: url, options: "-c role=fundhub_app", max: 6 });
    const role = (await app.query(`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role, { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
  });
  after(async () => { await app?.end(); await admin?.end(); });
  async function fixture(run) {
    const orgId=randomUUID(), email=`e2e+passkey-${randomUUID()}@example.test`;
    await admin.query(`INSERT INTO orgs(id,slug,name) VALUES ($1,$2,'Passkey scratch')`,[orgId,randomUUID()]);
    const clientId=(await admin.query(`INSERT INTO clients(org_id,email,first_name,last_name) VALUES ($1,$2,'Passkey','Scratch') RETURNING id`,[orgId,email])).rows[0].id;
    const accountId=(await admin.query(`INSERT INTO accounts(org_id,kind,email,status,password_hash,client_id)
      VALUES ($1,'client',$2,'active','test-not-login',$3) RETURNING id`,[orgId,email,clientId])).rows[0].id;
    const sessionId=(await admin.query(`INSERT INTO account_sessions(org_id,account_id,token_hash,expires_at)
      VALUES ($1,$2,$3,now()+interval '7 days') RETURNING id`,[orgId,accountId,hashToken(randomUUID())])).rows[0].id;
    const i={orgId,accountId,sessionId,targetKind:"client_bank",targetId:clientId};
    const act=(body,who=i)=>passkeyAction(app,who,body);
    async function enroll(key=syntheticPasskey(),extra={}) {
      const options=await act({action:"register_options",...extra}); assert.equal(options.ok,true,JSON.stringify(options));
      assert.equal(options.options.authenticatorSelection.userVerification,"required");
      const result=await act({action:"register_verify",challenge_token:options.challenge_token,response:key.registration(options.options)});
      assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.assured,false);
      return key;
    }
    async function verify(key,extra={}) {
      const options=await act({action:"authenticate_options"});assert.equal(options.ok,true,JSON.stringify(options));
      const result=await act({action:"authenticate_verify",challenge_token:options.challenge_token,response:key.assertion(options.options,extra)});
      return {result,options};
    }
    try { return await run({i,act,enroll,verify,admin,app}); }
    finally {
      // Only this fixture's synthetic rows, in this guarded disposable database.
      const c=await admin.connect();
      try {
        await c.query("BEGIN");await c.query("SET LOCAL session_replication_role='replica'");
        for(const t of ["auth_passkey_assurances","auth_passkey_challenges","auth_passkey_recovery_codes","auth_passkeys"])
          await c.query(`DELETE FROM ${t} WHERE subject_id IN (SELECT id FROM auth_passkey_subjects WHERE org_id=$1)`,[orgId]);
        await c.query(`DELETE FROM auth_passkey_subjects WHERE org_id=$1`,[orgId]);
        for(const t of ["account_plaid_link_grants","account_sessions","accounts","sessions","staff","clients","affiliates","orgs"])
          await c.query(`DELETE FROM ${t} WHERE ${t==="orgs"?"id":"org_id"}=$1`,[orgId]);
        await c.query("COMMIT");
        assert.equal((await c.query("SELECT count(*)::int AS n FROM orgs WHERE id=$1",[orgId])).rows[0].n,0);
      } catch(e) {await c.query("ROLLBACK");throw e;} finally {c.release();}
    }
  }
  test("registration alone cannot issue Plaid grant; separate UV assertion stamps exact stored evidence and recovery hashes",async()=>fixture(async({i,act,enroll,verify,app})=>{
    assert.equal((await act({action:"status"})).enrolled,false);
    assert.equal((await authorizeAccountPlaidLink(app,{...i,consent:true})).error,"passkey_required");
    const key=await enroll(); assert.equal(await bankPasskeyAssurance(app,i),null);
    assert.equal((await authorizeAccountPlaidLink(app,{...i,consent:true})).error,"passkey_required");
    const {result}=await verify(key);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.recovery_codes.length,10);
    const proof=await bankPasskeyAssurance(app,i);assert.ok(proof);
    const grant=await authorizeAccountPlaidLink(app,{...i,consent:true});assert.equal(grant.ok,true);
    const row=(await app.query("SELECT * FROM account_plaid_link_grants WHERE id=$1",[grant.grant_id])).rows[0];
    assert.equal(row.consent_version,"plaid-link-2026-11-06");
    assert.equal(row.passkey_assurance_id,proof.id);
    assert.equal(row.mfa_verified_at.toISOString(),proof.verified_at.toISOString());assert.equal(row.account_session_id,i.sessionId);
    assert.equal((await app.query(`SELECT g.mfa_verified_at=a.verified_at AS exact FROM account_plaid_link_grants g
      JOIN auth_passkey_assurances a ON a.id=$2 WHERE g.id=$1`,[grant.grant_id,proof.id])).rows[0].exact,true);
    const codes=(await app.query("SELECT code_hash FROM auth_passkey_recovery_codes WHERE subject_id IN (SELECT id FROM auth_passkey_subjects WHERE account_id=$1)",[i.accountId])).rows;
    assert.equal(codes.length,10);assert.ok(codes.every(c=>/^[a-f0-9]{64}$/.test(c.code_hash)));
    for(const code of result.recovery_codes)assert.ok(!JSON.stringify(codes).includes(code));
    assert.ok(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"open"}));
    assert.equal(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"open"}),null);
    assert.ok(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"exchange"}));
    assert.equal(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"exchange"}),null);
    assert.equal((await act({action:"status"})).assured,true);
  }));
  test("heartbeat requires exact scoped assertion evidence after rollout and preserves earlier consent receipts",async()=>fixture(async({i,enroll,verify,admin,app})=>{
    const key=await enroll();assert.equal((await verify(key)).result.ok,true);
    const grant=await authorizeAccountPlaidLink(app,{...i,consent:true});assert.equal(grant.ok,true);
    const count=async()=>Number((await app.query(PLAID_GRANT_SQL)).rows[0].broken_grants);
    assert.equal(await count(),0);
    const proof=await bankPasskeyAssurance(app,i);
    await admin.query("UPDATE account_plaid_link_grants SET mfa_verified_at=NULL WHERE id=$1",[grant.grant_id]);
    assert.equal(await count(),1,"new receipt without an assertion stays red");
    await admin.query(`UPDATE account_plaid_link_grants SET mfa_verified_at=(SELECT verified_at FROM auth_passkey_assurances WHERE id=$2) WHERE id=$1`,[grant.grant_id,proof.id]);
    assert.equal(await count(),0);
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=verified_at+interval '16 minutes' WHERE id=$1",[proof.id]);
    assert.equal(await count(),1,"overlong assertion stays red");
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=verified_at+interval '15 minutes',revoked_at=verified_at-interval '1 second' WHERE id=$1",[proof.id]);
    assert.equal(await count(),1,"assertion revoked before consent stays red");
    await admin.query("UPDATE auth_passkey_assurances SET revoked_at=now()+interval '1 second' WHERE id=$1",[proof.id]);
    assert.equal(await count(),0,"later recovery does not erase a valid historical receipt");
    await admin.query("DELETE FROM account_sessions WHERE id=$1",[i.sessionId]);
    assert.equal((await app.query("SELECT account_session_id,passkey_assurance_id FROM account_plaid_link_grants WHERE id=$1",[grant.grant_id])).rows[0].account_session_id,null);
    assert.equal(await count(),0,"ordinary expired-session cleanup preserves the exact durable assertion receipt");
    await admin.query("DELETE FROM auth_passkey_assurances WHERE id=$1",[proof.id]);
    assert.equal(await count(),1,"missing cryptographic receipt stays red");
    await admin.query(`UPDATE account_plaid_link_grants SET mfa_verified_at=NULL,
      consent_version='plaid-link-2026-11-02' WHERE id=$1`,[grant.grant_id]);
    assert.equal(await count(),0,"legacy consent-only receipts retain their meaning even during the migration/deploy window");
    await admin.query("UPDATE account_plaid_link_grants SET consent_version='unknown' WHERE id=$1",[grant.grant_id]);
    assert.equal(await count(),1,"unknown consent versions stay red");
  }));
  test("erasure and account cleanup clear the durable proof pointers without blocking cascades or another account",async()=>fixture(async({i,enroll,verify,app})=>{
    const key=await enroll();await verify(key);
    const grant=await authorizeAccountPlaidLink(app,{...i,consent:true});
    assert.ok(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"open"}));
    await fixture(async other=>{
      const unrelated=await other.enroll();await other.verify(unrelated);
      const tx=await app.connect();
      try {
        await tx.query("BEGIN");
        const result=await eraseClient(tx,{orgId:i.orgId,clientId:i.targetId,
          requestedBy:{label:"Synthetic passkey privacy regression"},reason:"Disposable synthetic account cleanup regression"});
        assert.equal(result.erased,true);
        await tx.query("DELETE FROM accounts WHERE id=$1 AND org_id=$2",[i.accountId,i.orgId]);
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
        const receipt=(await tx.query("SELECT account_id,account_session_id,passkey_assurance_id,mfa_verified_at,consumed_at FROM account_plaid_link_grants WHERE id=$1",[grant.grant_id])).rows[0];
        assert.equal(receipt.account_id,null);assert.equal(receipt.account_session_id,null);assert.equal(receipt.passkey_assurance_id,null);
        assert.ok(receipt.mfa_verified_at);assert.ok(receipt.consumed_at);
        assert.equal(Number((await tx.query("SELECT count(*) AS n FROM auth_passkey_subjects WHERE account_id=$1",[i.accountId])).rows[0].n),0);
        assert.equal(Number((await tx.query("SELECT count(*) AS n FROM auth_passkeys WHERE credential_id=$1 AND revoked_at IS NULL",[unrelated.id])).rows[0].n),1);
        assert.equal(Number((await tx.query(PLAID_GRANT_SQL)).rows[0].broken_grants),0);
      } finally {await tx.query("ROLLBACK");tx.release();}
    });
  }));
  test("stale primary login cannot enroll, and old session/foreign org or target cannot borrow assurance",async()=>fixture(async({i,act,enroll,verify,admin,app})=>{
    await admin.query("UPDATE account_sessions SET created_at=now()-interval '11 minutes' WHERE id=$1",[i.sessionId]);
    assert.equal((await act({action:"register_options"})).error,"fresh_login_required");
    await admin.query("UPDATE account_sessions SET created_at=now() WHERE id=$1",[i.sessionId]);
    const key=await enroll();assert.equal((await verify(key)).result.ok,true);
    for(const changed of [{orgId:randomUUID()},{targetId:randomUUID()},{sessionId:randomUUID()}])
      assert.equal(await bankPasskeyAssurance(app,{...i,...changed}),null);
    await admin.query("UPDATE account_sessions SET revoked_at=now() WHERE id=$1",[i.sessionId]);
    assert.equal(await bankPasskeyAssurance(app,i),null);assert.equal((await act({action:"authenticate_options"})).error,"forbidden");
  }));
  test("registration enforces real UP/UV, origin, RP id and challenge, consumes failed and expired challenges",async()=>fixture(async({act,admin,i})=>{
    const key=syntheticPasskey();
    for(const invalid of [{flags:0x59},{flags:0x5c},{rpID:"evil.test"},{client:{origin:"https://evil.test"}},{client:{crossOrigin:true}},{client:{challenge:"wrong"}}]) {
      const options=await act({action:"register_options"});const body={action:"register_verify",challenge_token:options.challenge_token,response:key.registration(options.options,invalid)};
      assert.equal((await act(body)).error,"passkey_verification_failed");assert.equal((await act(body)).error,"passkey_verification_failed");
      // Each failed verification and replay has its own durable rate entry.
      await admin.query("UPDATE auth_passkey_challenges SET created_at=now()-interval '16 minutes' WHERE session_id=$1",[i.sessionId]);
    }
    const old=await act({action:"register_options"});await admin.query("UPDATE auth_passkey_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(old.challenge_token)]);
    assert.equal((await act({action:"register_verify",challenge_token:old.challenge_token,response:key.registration(old.options)})).error,"passkey_verification_failed");
  }));
  test("assertion enforces signature/UP/UV/origin/RP/owner; one signed assertion cannot succeed concurrently twice",async()=>fixture(async({act,enroll,admin,app,i})=>{
    const key=await enroll();
    for(const invalid of [{flags:0x19},{flags:0x1c},{flags:0x05},{rpID:"evil.test"},{client:{origin:"https://evil.test"}},{corruptSignature:true},{userHandle:"foreign"}]) {
      const o=await act({action:"authenticate_options"});assert.equal((await act({action:"authenticate_verify",challenge_token:o.challenge_token,response:key.assertion(o.options,invalid)})).error,"passkey_verification_failed");
    }
    const o=await act({action:"authenticate_options"});const response=key.assertion(o.options);
    const results=await Promise.all([act({action:"authenticate_verify",challenge_token:o.challenge_token,response}),act({action:"authenticate_verify",challenge_token:o.challenge_token,response})]);
    assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.error==="passkey_verification_failed").length,1);
    assert.equal((await app.query("SELECT count(*)::int AS n FROM auth_passkey_assurances WHERE session_id=$1",[i.sessionId])).rows[0].n,1);
    const next=await act({action:"authenticate_options"});const sameCounter=key.assertion(next.options,{counter:1});
    assert.equal((await act({action:"authenticate_verify",challenge_token:next.challenge_token,response:sameCounter})).error,"passkey_verification_failed");
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=now()-interval '1 second' WHERE session_id=$1",[i.sessionId]);
    assert.equal(await bankPasskeyAssurance(app,i),null);
  }));
  test("expired/revoked proof blocks both opening and exchanging grants, even with non-null recorded MFA",async()=>fixture(async({i,enroll,verify,app,admin})=>{
    const key=await enroll();await verify(key);const grant=await authorizeAccountPlaidLink(app,{...i,consent:true});
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=now()-interval '1 second' WHERE session_id=$1",[i.sessionId]);
    assert.equal(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"open"}),null);
    await verify(key,{counter:2});assert.ok(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"open"}));
    await admin.query("UPDATE auth_passkeys SET revoked_at=now() WHERE subject_id IN (SELECT id FROM auth_passkey_subjects WHERE account_id=$1)",[i.accountId]);
    assert.equal(await advanceAccountPlaidLink(app,{...i,token:grant.grant_token,stage:"exchange"}),null);
  }));
  test("extra key/removal require recent assertion and preserve at least one key",async()=>fixture(async({act,enroll,verify})=>{
    const first=await enroll();assert.equal((await act({action:"register_options"})).error,"passkey_required");
    assert.equal((await act({action:"remove",credential_id:randomUUID()})).error,"passkey_required");
    await verify(first);const second=await enroll();const status=await act({action:"status"});assert.equal(status.credentials.length,2);
    const removed=await act({action:"remove",credential_id:status.credentials[1].id});assert.equal(removed.ok,true);
    assert.equal((await act({action:"remove",credential_id:status.credentials[0].id})).error,"last_passkey_required");assert.ok(second);
  }));
  test("one-use recovery plus fresh login only permits reenrollment; new registration still needs a new assertion",async()=>fixture(async({i,act,enroll,verify,app,admin})=>{
    const key=await enroll();const {result}=await verify(key);const code=result.recovery_codes[0];
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=now()-interval '1 second' WHERE session_id=$1",[i.sessionId]);
    const recovered=await act({action:"recover",recovery_code:code});assert.equal(recovered.ok,true);
    assert.equal(await bankPasskeyAssurance(app,i),null);assert.equal((await authorizeAccountPlaidLink(app,{...i,consent:true})).error,"passkey_required");
    assert.equal((await act({action:"recover",recovery_code:code})).ok,true,"an unused code survives lost/cancelled authorizations");
    assert.equal((await act({action:"register_options"})).error,"passkey_required");
    const replacement=await enroll(syntheticPasskey(),{recovery_token:recovered.recovery_token});
    assert.equal(await bankPasskeyAssurance(app,i),null);assert.equal((await verify(replacement)).result.recovery_codes.length,10);
    assert.ok(await bankPasskeyAssurance(app,i));
    assert.equal((await act({action:"recover",recovery_code:code})).error,"passkey_verification_failed");
    assert.equal((await act({action:"register_options",recovery_token:recovered.recovery_token})).error,"passkey_verification_failed");
  }));
  test("lost/cancelled/expired recovery and stale final identity preserve the last code and existing key",async()=>fixture(async({i,act,enroll,verify,app,admin})=>{
    const old=await enroll();const {result}=await verify(old),code=result.recovery_codes[0];
    const subjectId=(await app.query("SELECT id FROM auth_passkey_subjects WHERE account_id=$1",[i.accountId])).rows[0].id;
    // Keep the selected code as the sole usable recovery code.
    const selected=hashToken(code.replaceAll("-","").toUpperCase());
    await admin.query("UPDATE auth_passkey_recovery_codes SET used_at=now() WHERE subject_id=$1 AND code_hash<>$2",[subjectId,selected]);
    await admin.query("UPDATE auth_passkey_assurances SET expires_at=now()-interval '1 second' WHERE session_id=$1",[i.sessionId]);
    const remaining=async()=>Number((await app.query("SELECT count(*)::int AS n FROM auth_passkey_recovery_codes WHERE subject_id=$1 AND used_at IS NULL AND revoked_at IS NULL",[subjectId])).rows[0].n);
    const preserved=async()=>{assert.equal(await remaining(),1);assert.equal((await app.query("SELECT count(*)::int AS n FROM auth_passkeys WHERE subject_id=$1 AND revoked_at IS NULL",[subjectId])).rows[0].n,1);};
    const lost=await act({action:"recover",recovery_code:code});assert.equal(lost.ok,true);await preserved();
    await admin.query("UPDATE auth_passkey_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(lost.recovery_token)]);
    assert.equal((await act({action:"register_options",recovery_token:lost.recovery_token})).error,"passkey_verification_failed");await preserved();
    const retry=await act({action:"recover",recovery_code:code});assert.equal(retry.ok,true);
    const setup=await act({action:"register_options",recovery_token:retry.recovery_token}),replacement=syntheticPasskey();
    await preserved();
    await admin.query("UPDATE auth_passkey_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(setup.challenge_token)]);
    assert.equal((await act({action:"register_verify",challenge_token:setup.challenge_token,response:replacement.registration(setup.options)})).error,"passkey_verification_failed");await preserved();
    const recovery=await act({action:"recover",recovery_code:code}),o=await act({action:"register_options",recovery_token:recovery.recovery_token});
    const otherSession=(await admin.query("INSERT INTO account_sessions(org_id,account_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '7 days') RETURNING id",[i.orgId,i.accountId,hashToken(randomUUID())])).rows[0].id;
    assert.equal((await act({action:"register_verify",challenge_token:o.challenge_token,response:replacement.registration(o.options)},{...i,sessionId:otherSession})).error,"passkey_verification_failed");await preserved();
    const bound=await act({action:"recover",recovery_code:code});
    assert.equal((await act({action:"register_options",recovery_token:bound.recovery_token},{...i,sessionId:otherSession})).error,"passkey_verification_failed");
    assert.equal((await act({action:"register_options",recovery_token:bound.recovery_token})).ok,true);await preserved();
    await admin.query("UPDATE account_sessions SET created_at=now()-interval '11 minutes' WHERE id=$1",[i.sessionId]);
    assert.equal((await act({action:"register_verify",challenge_token:o.challenge_token,response:replacement.registration(o.options)})).error,"passkey_verification_failed");await preserved();
    await admin.query("UPDATE account_sessions SET created_at=now() WHERE id=$1",[i.sessionId]);
    const cancelled=await act({action:"recover",recovery_code:code});assert.equal(cancelled.ok,true);
    await act({action:"register_options",recovery_token:cancelled.recovery_token});await preserved();
    assert.equal((await verify(old,{counter:2})).result.ok,true,"existing key still works after every abandoned recovery");
  }));
  test("parallel recovery replacement registrations consume one code once and keep one new key",async()=>fixture(async({i,act,enroll,verify,app})=>{
    const old=await enroll(),initial=(await verify(old)).result,code=initial.recovery_codes[0];
    const a=await act({action:"recover",recovery_code:code}),b=await act({action:"recover",recovery_code:code});
    const ao=await act({action:"register_options",recovery_token:a.recovery_token}),bo=await act({action:"register_options",recovery_token:b.recovery_token});
    const ak=syntheticPasskey(),bk=syntheticPasskey();
    const outcomes=await Promise.all([act({action:"register_verify",challenge_token:ao.challenge_token,response:ak.registration(ao.options)}),
      act({action:"register_verify",challenge_token:bo.challenge_token,response:bk.registration(bo.options)})]);
    assert.equal(outcomes.filter(x=>x.ok).length,1);assert.equal(outcomes.filter(x=>x.error==="passkey_verification_failed").length,1);
    const active=(await app.query("SELECT k.credential_id FROM auth_passkeys k JOIN auth_passkey_subjects s ON s.id=k.subject_id WHERE s.account_id=$1 AND k.revoked_at IS NULL",[i.accountId])).rows;
    assert.equal(active.length,1);assert.equal(await bankPasskeyAssurance(app,i),null);
    assert.equal((await act({action:"recover",recovery_code:code})).error,"passkey_verification_failed");
    const winner=active[0].credential_id===ak.id?ak:bk;assert.equal((await verify(winner)).result.ok,true);
    assert.equal((await act({action:"status"})).credentials.length,1);
    assert.equal((await app.query("SELECT count(*)::int AS n FROM auth_passkey_recovery_codes c JOIN auth_passkey_subjects s ON s.id=c.subject_id WHERE s.account_id=$1 AND c.used_at IS NOT NULL",[i.accountId])).rows[0].n,1);
  }));
  test("legacy consent-only grants stay unusable and assurance does not renew ordinary login sessions",async()=>fixture(async({i,act,enroll,verify,app,admin})=>{
    const before=(await app.query("SELECT expires_at FROM account_sessions WHERE id=$1",[i.sessionId])).rows[0].expires_at;
    const key=await enroll();await admin.query("UPDATE account_sessions SET created_at=now()-interval '2 days' WHERE id=$1",[i.sessionId]);
    assert.equal((await verify(key)).result.ok,true,"an existing key works with the existing long session");
    const token=randomUUID().replaceAll("-","")+"A".repeat(11);
    await admin.query(`INSERT INTO account_plaid_link_grants(token_hash,org_id,account_id,account_session_id,target_kind,target_id,
      consent_scope,consent_version,consent_text,privacy_url,mfa_verified_at)
      VALUES ($1,$2,$3,$4,'client_bank',$5,'["accounts"]','legacy','consent','https://fundhub.ai/privacy/',NULL)`,
      [hashToken(token),i.orgId,i.accountId,i.sessionId,i.targetId]);
    assert.equal(await advanceAccountPlaidLink(app,{...i,token,stage:"open"}),null);
    const after=(await app.query("SELECT expires_at FROM account_sessions WHERE id=$1",[i.sessionId])).rows[0].expires_at;
    assert.equal(after.toISOString(),before.toISOString());
    assert.equal((await act({action:"status"})).assured,true);
  }));
  test("aggregate durable rate limit cannot be reset with new challenge tokens",async()=>fixture(async({act})=>{
    await act({action:"status"});
    for(let n=0;n<10;n++)assert.equal((await act({action:"authenticate_verify",challenge_token:randomUUID(),response:{}})).status,401);
    assert.equal((await act({action:"register_options"})).status,429);
    assert.equal((await act({action:"status"})).assured,false);
  }));
  test("database scope, forced RLS and provider-role grants remain enforced",async()=>fixture(async({i,act,app})=>{
    await act({action:"status"});
    const subject=(await app.query("SELECT id FROM auth_passkey_subjects WHERE account_id=$1",[i.accountId])).rows[0];
    await assert.rejects(()=>app.query(`INSERT INTO auth_passkey_challenges(token_hash,subject_id,session_id,target_kind,target_id,purpose,challenge)
      VALUES ($1,$2,$3,'client_bank',$4,'authentication','test')`,[hashToken(randomUUID()),subject.id,randomUUID(),i.targetId]),e=>e.code==="23514");
    const tables=(await app.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",[["auth_passkey_subjects","auth_passkeys","auth_passkey_challenges","auth_passkey_assurances","auth_passkey_recovery_codes"]])).rows;
    assert.equal(tables.length,5);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
    assert.equal((await app.query("SELECT has_table_privilege('fundhub_app','auth_passkeys','TRUNCATE') AS allowed")).rows[0].allowed,false);
  }));
  test("owner and affiliate receive only their bank target assurance under real stored sessions",async()=>fixture(async({i,admin,app})=>{
    const staffId=(await admin.query(`INSERT INTO staff(org_id,email,name,role,status) VALUES ($1,$2,'Owner scratch','owner','active') RETURNING id`,[i.orgId,`e2e+owner-${randomUUID()}@example.test`])).rows[0].id;
    const sessionId=(await admin.query(`INSERT INTO sessions(org_id,staff_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '7 days') RETURNING id`,[i.orgId,staffId,hashToken(randomUUID())])).rows[0].id;
    const affiliateId=(await admin.query(`INSERT INTO affiliates(org_id,name,status) VALUES ($1,'Scratch affiliate','active') RETURNING id`,[i.orgId])).rows[0].id;
    const accountId=(await admin.query(`INSERT INTO accounts(org_id,kind,email,status,password_hash,affiliate_id) VALUES ($1,'affiliate',$2,'active','test-only',$3) RETURNING id`,[i.orgId,`e2e+aff-${randomUUID()}@example.test`,affiliateId])).rows[0].id;
    const affiliateSession=(await admin.query(`INSERT INTO account_sessions(org_id,account_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '7 days') RETURNING id`,[i.orgId,accountId,hashToken(randomUUID())])).rows[0].id;
    for(const who of [{orgId:i.orgId,staffId,sessionId,targetKind:"company_bank",targetId:i.orgId},
      {orgId:i.orgId,accountId,sessionId:affiliateSession,targetKind:"affiliate_payout",targetId:affiliateId}]) {
      const key=syntheticPasskey(),options=await passkeyAction(app,who,{action:"register_options"});assert.equal(options.ok,true,JSON.stringify(options));
      assert.equal((await passkeyAction(app,who,{action:"register_verify",challenge_token:options.challenge_token,response:key.registration(options.options)})).ok,true);
      const auth=await passkeyAction(app,who,{action:"authenticate_options"});
      assert.equal((await passkeyAction(app,who,{action:"authenticate_verify",challenge_token:auth.challenge_token,response:key.assertion(auth.options)})).ok,true);
      assert.ok(await bankPasskeyAssurance(app,who));
      if(who.accountId)assert.equal((await authorizeAccountPlaidLink(app,{...who,consent:true})).ok,true);
      assert.equal(await bankPasskeyAssurance(app,{...who,targetId:randomUUID()}),null);
    }
    const lightId=(await admin.query(`INSERT INTO affiliates(org_id,name,status) VALUES ($1,'Light affiliate','active') RETURNING id`,[i.orgId])).rows[0].id;
    await admin.query("UPDATE accounts SET affiliate_id=$2 WHERE id=$1",[i.accountId,lightId]);
    const light={...i,targetKind:"affiliate_payout",targetId:lightId};
    assert.equal((await passkeyAction(app,light,{action:"register_options"})).ok,true,"client light-affiliate keeps its existing payout path");
  }));
});
