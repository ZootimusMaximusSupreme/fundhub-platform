import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {isLocalScratchDatabaseUrl} from '../verification/scratch-guard.mjs';
import {onPaymentRefunded,onPaymentDisputed,knownReversalClient} from './commas-disputes.mjs';

const url=process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
test('Whop reversals route only the original successful owned receipt and preserve existing accounting policy', {skip:!isLocalScratchDatabaseUrl(url)}, async () => {
  const pool=new pg.Pool({connectionString:url,ssl:false});
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const orgId=(await db.query('SELECT id FROM orgs ORDER BY created_at LIMIT 1')).rows[0].id;
    const clientId=(await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Synthetic reversal',$2) RETURNING id",[orgId,randomUUID()+'@example.test'])).rows[0].id;
    const paymentId='whop-fixture-'+randomUUID();
    await db.query("INSERT INTO transactions(org_id,client_id,provider,provider_ref,product_name,amount_paid,status) VALUES($1,$2,'whop',$3,'blueprint-self-funding',25000,'succeeded')",[orgId,clientId,paymentId]);
    const event={id:randomUUID(),orgId,clientId:randomUUID(),name:'payment.refunded',payload:{source:'whop',originalProviderRef:paymentId,providerRef:'refund-'+randomUUID(),amount:25000}};
    assert.equal(await knownReversalClient(db,event),clientId);
    await onPaymentRefunded(event,db);
    await onPaymentRefunded(event,db);
    await onPaymentDisputed({...event,id:randomUUID(),name:'payment.disputed',payload:{...event.payload,dueBy:'2027-01-01T00:00:00Z'}},db);
    const tasks=(await db.query("SELECT client_id,source_workflow FROM tasks WHERE client_id=$1 AND source_workflow IN ('commas-refund','commas-dispute') ORDER BY source_workflow",[clientId])).rows;
    assert.equal(tasks.length,2);
    assert.ok(tasks.every(row=>row.client_id===clientId));
    assert.equal(await knownReversalClient(db,{...event,payload:{...event.payload,source:'commas'}}),null);
    assert.equal(await knownReversalClient(db,{...event,orgId:randomUUID()}),null);
    await assert.rejects(onPaymentRefunded({...event,payload:{...event.payload,originalProviderRef:'unknown'}},db),/unowned/);
    assert.equal((await db.query('SELECT status FROM transactions WHERE org_id=$1 AND provider_ref=$2',[orgId,paymentId])).rows[0].status,'succeeded');
  } finally {await db.query('ROLLBACK');db.release();await pool.end();}
});
