// Real migrated-schema/auth proof. Only synthetic rows inside rolled-back
// transactions; the sole fake is Google's network boundary, never SQL/auth.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import handler, { MEET_CALL_SCOPE_SQL } from '../../api/read/meet-presence.mjs';
import { readGoogleMeetPresence } from '../messaging/providers/google-meet-read.mjs';
import { createSession, hashToken } from '../auth/session.mjs';

const dsn = process.env.DATABASE_URL;
const scratch = (() => {
  try { const u = new URL(dsn); return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)
    && /scratch|test|ci/i.test(u.pathname); } catch { return false; }
})();
const options = { skip: scratch ? false : 'Local scratch DATABASE_URL required; no real database proof ran.' };
const START = '2026-11-02T18:00:00.000Z';
const ROOM = 'https://meet.google.com/abc-defg-hij';
const SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
const fakeEnv = { GOOGLE_MEET_OAUTH_TOKEN_JSON: JSON.stringify({ client_id: 'fixture', client_secret: 'fixture', refresh_token: 'fixture', scope: SCOPE }) };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });

async function fixture(run) {
  const sql = new pg.Client({ connectionString: dsn }); await sql.connect();
  try {
    await sql.query('BEGIN');
    assert.equal((await sql.query('SELECT current_user AS role')).rows[0].role, 'fundhub_app');
    const privileges = (await sql.query(`SELECT has_table_privilege(current_user,'staff_role_assignments','SELECT') AS r,
      has_table_privilege(current_user,'staff_role_assignments','INSERT') AS w`)).rows[0];
    assert.deepEqual(privileges, { r: true, w: false }, 'proof must not broaden assignment grants');
    const org = (await sql.query('SELECT id FROM orgs WHERE is_default LIMIT 1')).rows[0].id;
    const foreignOrg = (await sql.query("INSERT INTO orgs(slug,name) VALUES($1,'Meet foreign fixture') RETURNING id", [`meet-${randomUUID()}`])).rows[0].id;
    const makeStaff = async (role, tenant = org) => {
      const staff = (await sql.query(`INSERT INTO staff(org_id,name,email,role,status)
        VALUES($1,'Meet fixture',$2,$3,'active') RETURNING id`, [tenant, `${randomUUID()}@example.test`, role])).rows[0].id;
      return { id: staff, token: (await createSession(sql, { orgId: tenant, staffId: staff })).token };
    };
    const actors = {};
    for (const role of ['owner', 'admin', 'sales_manager', 'closer', 'setter', 'outbound_rep', 'partner']) actors[role] = await makeStaff(role);
    actors.otherCloser = await makeStaff('closer');
    const clients = [];
    const bookings = [];
    const tasks = [];
    for (const [tenant, assigned] of [[org, actors.closer.id], [org, actors.otherCloser.id], [foreignOrg, actors.closer.id]]) {
      const person = (await sql.query(`INSERT INTO clients(org_id,email,first_name,last_name)
        VALUES($1,$2,'Meet','Fixture') RETURNING id`, [tenant, `${randomUUID()}@example.test`])).rows[0].id;
      clients.push(person);
      bookings.push((await sql.query(`INSERT INTO bookings(org_id,client_id,source,starts_at,status,meeting_url)
        VALUES($1,$2,'meet-fixture',$3,'booked',$4) RETURNING id`, [tenant, person, START, ROOM])).rows[0].id);
      tasks.push((await sql.query(`INSERT INTO tasks(org_id,client_id,title,due_at,assignee_role,assignee_staff_id,meeting_url)
        VALUES($1,$2,'Booked call fixture',$3,'closer',$4,$5) RETURNING id`, [tenant, person, START, assigned, ROOM])).rows[0].id);
    }
    const assign = async roles => {
      const r = (await sql.query('SELECT set_staff_role_assignments($1,$2,$3,$4) AS result',
        [hashToken(actors.owner.token), actors.setter.id, 'setter', roles])).rows[0].result;
      assert.equal(r.ok, true, JSON.stringify(r));
    };
    const events = [];
    const cache = new Map();
    let lastScope;
    const db = { async query(query, params) {
      const result = await sql.query(query, params);
      if (query === MEET_CALL_SCOPE_SQL) { lastScope = { params, rows: result.rows }; events.push('scope'); }
      return result;
    } };
    const read = async ({ actor = actors.closer, client = clients[0], env = fakeEnv, mode = 'available', query = { client_id: client } } = {}) => {
      const res = response();
      await handler({ method: 'GET', url: '/api/read/meet-presence', query, headers: { authorization: `Bearer ${actor.token}` } }, res, {
        db, cache, clock: () => Date.parse(START), env,
        readPresence: input => readGoogleMeetPresence({ ...input, fetchImpl: async url => {
          assert.ok(lastScope?.rows.length, 'a real successful scoped SQL read must precede EVERY Google network request');
          assert.equal(lastScope.params[0], client); assert.equal(lastScope.params[1], org);
          events.push('network');
          if (url.includes('oauth2.googleapis.com')) return json({ access_token: 'fixture-access', scope: SCOPE });
          const path = new URL(url).pathname;
          if (path.endsWith('/conferenceRecords')) return json({ conferenceRecords: mode === 'empty' ? [] : [{ name: 'conferenceRecords/private-conference', startTime: START }] });
          if (path.endsWith('/participants')) return json({ participants: [{ name: 'conferenceRecords/private-conference/participants/private-person', signedinUser: { user: 'users/private-google-id', displayName: 'Guest Fixture' } }] });
          return json({ participantSessions: [{ startTime: START }] });
        } })
      });
      return res;
    };
    await run({ sql, org, foreignOrg, actors, clients, bookings, tasks, events, cache, assign, read });
  } finally { await sql.query('ROLLBACK'); await sql.end(); }
}

test('real Meet auth/SQL scopes own assignment before Google; other client, foreign tenant and unknown IDs reveal nothing', options, async () => fixture(async f => {
  const own = await f.read(); assert.equal(own.code, 200, JSON.stringify(own.body));
  assert.equal(own.body.bookingId, f.bookings[0]); assert.equal(own.body.status, 'available');
  assert.deepEqual(f.events, ['scope', 'network', 'network', 'network', 'network']);
  assert.equal(own.headers['Cache-Control'], 'no-store');
  const calls = f.events.filter(e => e === 'network').length;
  for (const client of [f.clients[1], f.clients[2], randomUUID()]) {
    const r = await f.read({ client }); assert.equal(r.code, 403); assert.equal(r.body.error, 'booked_call_not_accessible');
  }
  assert.equal(f.events.filter(e => e === 'network').length, calls);
  // A forged foreign-org booking for the same client cannot replace its real booking.
  await f.sql.query(`INSERT INTO bookings(org_id,client_id,source,starts_at,status,meeting_url,created_at)
    VALUES($1,$2,'meet-fixture',$3,'booked','https://meet.google.com/xxx-yyyy-zzz',now()+interval '1 hour')`, [f.foreignOrg, f.clients[0], START]);
  assert.equal((await f.read()).body.bookingId, f.bookings[0]);
}));

test('real Meet cached presence cannot survive assignment revocation, completion, wrong date/role, archive or newer cancellation', options, async () => fixture(async f => {
  assert.equal((await f.read()).code, 200);
  const calls = f.events.filter(e => e === 'network').length;
  const deny = async () => { assert.equal((await f.read()).code, 403); assert.equal(f.events.filter(e => e === 'network').length, calls); };
  await f.sql.query('UPDATE tasks SET assignee_staff_id=NULL WHERE id=$1', [f.tasks[0]]); await deny();
  await f.sql.query('UPDATE tasks SET assignee_staff_id=$2,done=true WHERE id=$1', [f.tasks[0], f.actors.closer.id]); await deny();
  await f.sql.query("UPDATE tasks SET done=false,due_at=due_at+interval '1 hour' WHERE id=$1", [f.tasks[0]]); await deny();
  await f.sql.query("UPDATE tasks SET due_at=$2,assignee_role='setter' WHERE id=$1", [f.tasks[0], START]); await deny();
  await f.sql.query("UPDATE tasks SET assignee_role='closer' WHERE id=$1", [f.tasks[0]]);
  await f.sql.query(`UPDATE clients SET custom_fields=jsonb_build_object('crm_archived_at','2026-11-02') WHERE id=$1`, [f.clients[0]]); await deny();
  await f.sql.query("UPDATE clients SET custom_fields='{}' WHERE id=$1", [f.clients[0]]);
  await f.sql.query(`INSERT INTO bookings(org_id,client_id,source,starts_at,status,meeting_url,created_at)
    VALUES($1,$2,'meet-fixture',$3,'cancelled',$4,now()+interval '1 minute')`, [f.org, f.clients[0], START, ROOM]);
  await deny();
}));

test('real sessions allow secondary closer only personal calls; only primary owner/admin/manager get broader company reads', options, async () => fixture(async f => {
  for (const role of ['owner', 'admin', 'sales_manager']) assert.equal((await f.read({ actor: f.actors[role], client: f.clients[1] })).code, 200);
  await f.assign(['closer', 'sales_manager']);
  await f.sql.query('UPDATE tasks SET assignee_staff_id=$2 WHERE id=$1', [f.tasks[0], f.actors.setter.id]);
  assert.equal((await f.read({ actor: f.actors.setter })).code, 200);
  assert.equal((await f.read({ actor: f.actors.setter, client: f.clients[1] })).code, 403, 'secondary manager must not confer company privilege');
  await f.assign(['sales_manager']);
  assert.equal((await f.read({ actor: f.actors.setter })).code, 403, 'secondary manager without closer is not a Meet reader');
  await f.assign(['closer']);
  await f.sql.query("UPDATE staff_roles SET active=false WHERE org_id=$1 AND key='closer'", [f.org]);
  assert.equal((await f.read({ actor: f.actors.setter })).code, 403, 'secondary role removal is checked on the live session');
  for (const role of ['outbound_rep', 'partner']) assert.equal((await f.read({ actor: f.actors[role] })).code, 403);
  assert.equal((await f.read({ actor: { token: 'unknown-fixture-token' } })).code, 401);
}));

test('real authorized Meet route preserves unavailable/empty/active observations and never claims identified lead presence', options, async () => fixture(async f => {
  const unknown = await f.read({ env: {} }); assert.equal(unknown.code, 200); assert.equal(unknown.body.status, 'unavailable');
  assert.equal(unknown.body.presence.conferenceActive, null); assert.equal(unknown.body.presence.participantCount, null);
  assert.equal(unknown.body.presence.verifiedLeadJoined, null); assert.equal(f.events.includes('network'), false);
  f.cache.clear(); const empty = await f.read({ mode: 'empty' });
  assert.equal(empty.body.status, 'empty'); assert.equal(empty.body.presence.participantCount, 0); assert.equal(empty.body.presence.conferenceActive, false);
  f.cache.clear(); const active = await f.read();
  assert.equal(active.body.checkedAt, START);
  assert.deepEqual(active.body.presence.participants, [{ displayName: 'Guest Fixture', identity: 'unidentified' }]);
  assert.equal(active.body.presence.verifiedLeadJoined, null);
  assert.doesNotMatch(JSON.stringify(active.body), /private-google-id|private-conference|private-person|fixture-access|client_secret/);
}));
