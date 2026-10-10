// Portal tripwires — the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-portal.pg.test.mjs
//
// WHY THIS FILE EXISTS. gap-portal.test.mjs hands the lane a fake database that
// returns canned rows, and matches words in the SQL text. That proves the wording
// and the status rules. It cannot prove the SQL, and the SQL is where the logic
// of three checks lives: who is "a paying client who has not signed in", which
// client the progress page is read for, and what that client's own rows say. A
// wrong join, a wrong unit or a flipped boolean there still passed the fake
// (a checker broke six lines of NEVER_SIGNED_IN_SQL and 78 of 78 tests stayed
// green, 2026-10-09). These scenarios run the real SQL on a real Postgres and
// make it answer yes or no for made-up people.
//
// HOW IT STAYS HARMLESS. Each query runs inside BEGIN READ ONLY and is always
// rolled back. Every real table the statement names is shadowed by a CTE that
// holds ONLY the made-up rows of that scenario (the real table is read with
// WHERE false, only to take its column types, so a dropped or renamed column
// still breaks the test). No real row is ever read, so the test gives the same
// answers on an empty scratch database as on production. Nothing is written
// (the database would refuse it). Nothing is sent.
//
// Each scenario names a person, says what the customer saw, and says what the
// check must answer. RED means the check must list that person. GREEN means it
// must not.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import { REPAIR_PIPELINE } from "../../repair/pipeline.mjs";
import * as M from "./gap-portal.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const uuid = () => crypto.randomUUID();

/** The database's own clock, read once: now() is fixed for a whole transaction. */
let NOW = new Date();
const hrs = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const days = (d) => hrs(d * 24);

const SHADOWS = {
  entitlements: {
    cols: "org_id, client_id, granted_at, revoked_at, expires_at, is_demo",
    rec: "org_id uuid, client_id uuid, granted_at timestamptz, revoked_at timestamptz, expires_at timestamptz, is_demo boolean"
  },
  documents: {
    cols: "org_id, client_id, kind, is_demo, generated_at, created_at",
    rec: "org_id uuid, client_id uuid, kind text, is_demo boolean, generated_at timestamptz, created_at timestamptz"
  },
  clients: {
    cols: "id, org_id, email, custom_fields, is_demo",
    rec: "id uuid, org_id uuid, email text, custom_fields jsonb, is_demo boolean"
  },
  transactions: {
    cols: "org_id, client_id, status, is_demo, created_at",
    rec: "org_id uuid, client_id uuid, status text, is_demo boolean, created_at timestamptz"
  },
  events: {
    cols: "org_id, client_id, name, created_at",
    rec: "org_id uuid, client_id uuid, name text, created_at timestamptz"
  },
  accounts: {
    cols: "id, org_id, client_id, kind, last_login_at",
    rec: "id uuid, org_id uuid, client_id uuid, kind text, last_login_at timestamptz"
  },
  account_magic_links: {
    cols: "org_id, client_id, account_id, email, consumed_at, created_at",
    rec: "org_id uuid, client_id uuid, account_id uuid, email text, consumed_at timestamptz, created_at timestamptz"
  },
  client_waypoints: {
    cols: "org_id, client_id",
    rec: "org_id uuid, client_id uuid"
  },
  cards: {
    cols: "org_id, client_id, stage_id, pipeline_id",
    rec: "org_id uuid, client_id uuid, stage_id uuid, pipeline_id uuid"
  },
  pipeline_stages: {
    cols: "id, key",
    rec: "id uuid, key text"
  },
  pipelines: {
    cols: "id, key",
    rec: "id uuid, key text"
  }
};

let conn = null;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
  await conn.query("SET LOCAL statement_timeout = '20s'");
  await conn.query("SELECT set_config('fundhub.actor','staff',true)");
  const ro = await conn.query("SHOW transaction_read_only");
  assert.equal(ro.rows[0].transaction_read_only, "on", "the harness must be read only");
  NOW = new Date((await conn.query("SELECT now() AS n")).rows[0].n);
});

after(async () => {
  if (!HAS_DB) return;
  try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
  conn.release();
  await close();
});

/** The shadows this statement actually names, as CTEs placed in front of it. */
function withShadows(sql, paramCount) {
  const used = Object.keys(SHADOWS).filter((t) => new RegExp(`\\b(?:FROM|JOIN)\\s+${t}\\b`, "i").test(sql));
  const ctes = used.map((table, i) => {
    const def = SHADOWS[table];
    return `${table} AS (SELECT ${def.cols} FROM ${table} WHERE false UNION ALL SELECT ${def.cols} FROM jsonb_to_recordset($${paramCount + i + 1}::jsonb) AS x(${def.rec}))`;
  }).join(",\n");
  const lead = /^\/\*[\s\S]*?\*\/\s*/.exec(sql)?.[0] || "";
  const rest = sql.slice(lead.length);
  const text = /^with\b/i.test(rest)
    ? `${lead}WITH ${ctes},\n${rest.replace(/^with\b/i, "")}`
    : `${lead}WITH ${ctes}\n${rest}`;
  return { text, used };
}

/** Run one statement over made-up rows. A failed statement is rolled back to its own savepoint. */
async function run(sql, params, fakes = {}) {
  const { text, used } = withShadows(sql, params.length);
  const extra = used.map((t) => JSON.stringify(fakes[t] || []));
  const unknown = Object.keys(fakes).filter((t) => !SHADOWS[t]);
  assert.deepEqual(unknown, [], "scenario names a table that is not shadowed");
  await conn.query("SAVEPOINT scenario");
  try {
    return (await conn.query(text, [...params, ...extra])).rows;
  } finally {
    await conn.query("ROLLBACK TO SAVEPOINT scenario");
    await conn.query("RELEASE SAVEPOINT scenario");
  }
}

/* ------------------------------------------------------------------ made-up people */

function client(over = {}) {
  const id = over.id || uuid();
  return {
    id,
    org_id: over.org_id || ORG,
    email: over.email === undefined ? `maria.${id.slice(0, 6)}@gmail.com` : over.email,
    custom_fields: over.custom_fields || {},
    is_demo: over.is_demo ?? false
  };
}

const grant = (c, hoursAgo, over = {}) => ({
  org_id: ORG, client_id: c.id, granted_at: hrs(hoursAgo), revoked_at: null, expires_at: null, is_demo: false, ...over
});
const pack = (c, generatedHoursAgo, over = {}) => ({
  org_id: ORG, client_id: c.id, kind: "deliverable", is_demo: false,
  generated_at: generatedHoursAgo == null ? null : hrs(generatedHoursAgo),
  created_at: hrs(over.createdHoursAgo ?? generatedHoursAgo ?? 1), ...over.row
});
const payment = (c, hoursAgo, over = {}) => ({
  org_id: ORG, client_id: c.id, status: "succeeded", is_demo: false, created_at: hrs(hoursAgo), ...over
});
const doorEvent = (c, hoursAgo, over = {}) => ({
  org_id: ORG, client_id: c.id, name: "payment.received", created_at: hrs(hoursAgo), ...over
});
const account = (c, over = {}) => ({
  id: uuid(), org_id: ORG, client_id: c.id, kind: "client", last_login_at: null, ...over
});
const link = (over = {}) => ({
  org_id: ORG, client_id: null, account_id: null, email: "someone@gmail.com", consumed_at: null, created_at: hrs(1), ...over
});

/** A real buyer: access 5 days ago, paid 6 days ago through the payment door, never signed in. */
function buyer(c, over = {}) {
  return {
    clients: [c],
    entitlements: [grant(c, 120)],
    transactions: [payment(c, 144)],
    events: [doorEvent(c, 144)],
    ...over
  };
}

const SIGN_IN = [ORG, M.INTERNAL_CLIENT_EMAIL_RE];
const signInRows = (fakes) => run(M.NEVER_SIGNED_IN_SQL, SIGN_IN, fakes);
const forClient = (rows, c) => rows.find((r) => r.client_id === c.id);

/** Assert on one client's row, or on its absence. */
async function expectListed(t, name, fakes, c, want) {
  await t.test(name, async () => {
    const row = forClient(await signInRows(fakes), c);
    assert.ok(row, `${name}: the client was not listed`);
    for (const [key, val] of Object.entries(want || {})) {
      assert.equal(row[key], val, `${name}: ${key} was ${row[key]}, wanted ${val}`);
    }
  });
}
async function expectNotListed(t, name, fakes, c) {
  await t.test(name, async () => {
    const row = forClient(await signInRows(fakes), c);
    assert.equal(row, undefined, `${name}: the client was listed and should not be`);
  });
}

/* ------------------------------------------------------------------ the harness itself */

test("portal SQL: the harness is read only, so a write is refused by the database", { skip: !HAS_DB }, async () => {
  await conn.query("SAVEPOINT probe");
  try {
    await assert.rejects(conn.query("CREATE TEMP TABLE portal_pg_probe (x int)"), /read-only transaction/);
  } finally {
    await conn.query("ROLLBACK TO SAVEPOINT probe");
    await conn.query("RELEASE SAVEPOINT probe");
  }
  const rows = await signInRows({});
  assert.deepEqual(rows, [], "with no made-up rows, nothing is listed (no real row is read)");
});

/* ------------------------------------------------------------------ sign-in: who is listed, and the clock */

test("portal SQL, sign-in: who holds access, and how long", { skip: !HAS_DB }, async (t) => {
  const c = client();
  await expectListed(t, "RED: access 5 days ago, paid through the door, never signed in", buyer(c), c, {
    is_test: false, paid_through_door: true, signed_in: false, asked_since_access: false
  });
  await t.test("days_held is in DAYS (5 days of access reads about 5)", async () => {
    const row = forClient(await signInRows(buyer(c)), c);
    const d = Number(row.days_held);
    assert.ok(d > 4.99 && d < 5.01, `days_held was ${d}`);
  });
  await expectNotListed(t, "GREEN: access only 71 hours ago is inside the 72 hour grace", buyer(c, { entitlements: [grant(c, 71)] }), c);
  await expectListed(t, "RED: access 73 hours ago is past the grace", buyer(c, { entitlements: [grant(c, 73)] }), c);
  await expectNotListed(t, "GREEN: access given a minute ago", buyer(c, { entitlements: [grant(c, 0.02)] }), c);

  await t.test("the clock starts at the FIRST grant (10 days and 1 day ago reads 10)", async () => {
    const row = forClient(await signInRows(buyer(c, { entitlements: [grant(c, 240), grant(c, 24)] })), c);
    assert.ok(row, "listed");
    const d = Number(row.days_held);
    assert.ok(d > 9.99 && d < 10.01, `days_held was ${d}`);
  });
  await t.test("the clock starts at the stored pack when it is older than the grant (9 days vs 1 day)", async () => {
    const row = forClient(await signInRows(buyer(c, { entitlements: [grant(c, 24)], documents: [pack(c, 216)] })), c);
    assert.ok(row, "listed");
    const d = Number(row.days_held);
    assert.ok(d > 8.99 && d < 9.01, `days_held was ${d}`);
  });
  await t.test("one row per client even with two grants and a pack", async () => {
    const rows = await signInRows(buyer(c, { entitlements: [grant(c, 240), grant(c, 24)], documents: [pack(c, 216)] }));
    assert.equal(rows.filter((r) => r.client_id === c.id).length, 1);
  });

  await expectNotListed(t, "GREEN: the only grant was revoked", buyer(c, { entitlements: [grant(c, 120, { revoked_at: hrs(24) })] }), c);
  await expectNotListed(t, "GREEN: the only grant expired", buyer(c, { entitlements: [grant(c, 120, { expires_at: hrs(1) })] }), c);
  await expectListed(t, "RED: a grant that expires in the future still counts", buyer(c, { entitlements: [grant(c, 120, { expires_at: hrs(-500) })] }), c);
  await expectNotListed(t, "GREEN: a demo grant", buyer(c, { entitlements: [grant(c, 120, { is_demo: true })] }), c);
  await t.test("a revoked old grant does not start the clock (revoked 10 days ago, live one 5 days ago reads 5)", async () => {
    const row = forClient(await signInRows(buyer(c, {
      entitlements: [grant(c, 240, { revoked_at: hrs(200) }), grant(c, 120)]
    })), c);
    assert.ok(row, "listed");
    const d = Number(row.days_held);
    assert.ok(d > 4.99 && d < 5.01, `days_held was ${d}`);
  });

  await expectListed(t, "RED: a stored pack alone counts as access", buyer(c, { entitlements: [], documents: [pack(c, 120)] }), c);
  await t.test("a stored pack's generated_at wins over its created_at (generated 5 days ago, row made 1 hour ago)", async () => {
    const row = forClient(await signInRows(buyer(c, { entitlements: [], documents: [pack(c, 120, { createdHoursAgo: 1 })] })), c);
    assert.ok(row, "listed");
    const d = Number(row.days_held);
    assert.ok(d > 4.99 && d < 5.01, `days_held was ${d}`);
  });
  await t.test("a stored pack with no generated_at uses created_at", async () => {
    const row = forClient(await signInRows(buyer(c, { entitlements: [], documents: [pack(c, null, { createdHoursAgo: 120 })] })), c);
    assert.ok(row, "listed");
    assert.ok(Number(row.days_held) > 4.99);
  });
  await expectNotListed(t, "GREEN: a document that is not a deliverable", buyer(c, { entitlements: [], documents: [pack(c, 120, { row: { kind: "contract" } })] }), c);
  await expectNotListed(t, "GREEN: a demo deliverable", buyer(c, { entitlements: [], documents: [pack(c, 120, { row: { is_demo: true } })] }), c);

  await expectNotListed(t, "GREEN: the grant belongs to another company", buyer(c, { entitlements: [grant(c, 120, { org_id: OTHER_ORG })] }), c);
  const away = client({ org_id: OTHER_ORG });
  await expectNotListed(t, "GREEN: the client row belongs to another company than the grant", buyer(away), away);
  await expectNotListed(t, "GREEN: no access at all", buyer(c, { entitlements: [] }), c);
});

/* ------------------------------------------------------------------ sign-in: has the client signed in */

test("portal SQL, sign-in: signed_in is a login on a client account OR a used link", { skip: !HAS_DB }, async (t) => {
  const c = client();
  await expectListed(t, "RED: no account, no link", buyer(c), c, { signed_in: false });
  const a = account(c);
  await expectListed(t, "RED: an account that never logged in (still 'invited')", buyer(c, { accounts: [a] }), c, { signed_in: false });
  await expectListed(t, "GREEN: a client account with a login", buyer(c, { accounts: [account(c, { last_login_at: hrs(30) })] }), c, { signed_in: true });
  await expectListed(t, "RED: a login on a different kind of account that points at the client does not count",
    buyer(c, { accounts: [account(c, { kind: "partner", last_login_at: hrs(30) })] }), c, { signed_in: false });
  const other = client();
  await expectListed(t, "RED: another client's login does not count", buyer(c, { accounts: [account(other, { last_login_at: hrs(30) })] }), c, { signed_in: false });
  await expectListed(t, "RED: a login on an account of another company does not count",
    buyer(c, { accounts: [account(c, { org_id: OTHER_ORG, last_login_at: hrs(30) })] }), c, { signed_in: false });

  await expectListed(t, "GREEN: a used link bound to the client", buyer(c, { account_magic_links: [link({ client_id: c.id, consumed_at: hrs(30) })] }), c, { signed_in: true });
  await expectListed(t, "GREEN: a used link bound to the client's account only",
    buyer(c, { accounts: [a], account_magic_links: [link({ account_id: a.id, consumed_at: hrs(30) })] }), c, { signed_in: true });
  await expectListed(t, "RED: a link that was sent and never used", buyer(c, { account_magic_links: [link({ client_id: c.id })] }), c, { signed_in: false });
  await expectListed(t, "RED: another client's used link does not count",
    buyer(c, { account_magic_links: [link({ client_id: other.id, consumed_at: hrs(30) })] }), c, { signed_in: false });
  await expectListed(t, "RED: a used link of another company does not count",
    buyer(c, { account_magic_links: [link({ client_id: c.id, consumed_at: hrs(30), org_id: OTHER_ORG })] }), c, { signed_in: false });

  await expectListed(t, "GREEN: a login and a used link together", buyer(c, {
    accounts: [account(c, { last_login_at: hrs(30) })],
    account_magic_links: [link({ client_id: c.id, consumed_at: hrs(30) })]
  }), c, { signed_in: true });
  await expectListed(t, "GREEN: a login with a link that was never used (OR, not AND)", buyer(c, {
    accounts: [account(c, { last_login_at: hrs(30) })],
    account_magic_links: [link({ client_id: c.id })]
  }), c, { signed_in: true });
  await expectListed(t, "GREEN: a used link with an account that never logged in (OR, not AND)", buyer(c, {
    accounts: [a], account_magic_links: [link({ client_id: c.id, consumed_at: hrs(30) })]
  }), c, { signed_in: true });
});

/* ------------------------------------------------------------------ sign-in: did they ask since access */

test("portal SQL, sign-in: asked_since_access is a request since access, by client OR by their own address", { skip: !HAS_DB }, async (t) => {
  const c = client({ email: "Maria.Stone@Gmail.com " });
  await expectListed(t, "RED: no request at all", buyer(c), c, { asked_since_access: false });
  await expectListed(t, "GREEN: a request bound to the client, after access was given",
    buyer(c, { account_magic_links: [link({ client_id: c.id, created_at: hrs(30) })] }), c, { asked_since_access: true });
  await expectListed(t, "GREEN: a request found by the client's address only (stored with no client id), after access",
    buyer(c, { account_magic_links: [link({ email: "maria.stone@gmail.com", created_at: hrs(30) })] }), c, { asked_since_access: true });
  await expectListed(t, "RED: the 09-27 case — the client typed their address and was refused 8 days BEFORE access was given",
    buyer(c, { account_magic_links: [link({ email: "maria.stone@gmail.com", created_at: hrs(120 + 8 * 24) })] }), c, { asked_since_access: false });
  await expectListed(t, "RED: a request bound to the client but made before access was given",
    buyer(c, { account_magic_links: [link({ client_id: c.id, created_at: hrs(130) })] }), c, { asked_since_access: false });
  await expectListed(t, "RED: someone else's address",
    buyer(c, { account_magic_links: [link({ email: "someone.else@gmail.com", created_at: hrs(30) })] }), c, { asked_since_access: false });
  const other = client();
  await expectListed(t, "RED: a request bound to another client",
    buyer(c, { account_magic_links: [link({ client_id: other.id, email: "other@gmail.com", created_at: hrs(30) })] }), c, { asked_since_access: false });
  await expectListed(t, "RED: the same address asked in another company",
    buyer(c, { account_magic_links: [link({ email: "maria.stone@gmail.com", created_at: hrs(30), org_id: OTHER_ORG })] }), c, { asked_since_access: false });
  const noMail = client({ email: null });
  await expectListed(t, "RED: a client with no address on file matches nothing by address",
    buyer(noMail, { account_magic_links: [link({ email: "someone@gmail.com", created_at: hrs(30) })] }), noMail, { asked_since_access: false });
  await expectListed(t, "GREEN: a client with no address still matches by client id",
    buyer(noMail, { account_magic_links: [link({ client_id: noMail.id, created_at: hrs(30) })] }), noMail, { asked_since_access: true });
  await t.test("a request counts for the person it names, not for everyone in the list", async () => {
    const x = client();
    const y = client();
    const rows = await signInRows({
      clients: [x, y],
      entitlements: [grant(x, 120), grant(y, 120)],
      transactions: [payment(x, 144), payment(y, 144)],
      events: [doorEvent(x, 144), doorEvent(y, 144)],
      account_magic_links: [link({ client_id: x.id, email: x.email, created_at: hrs(30) })]
    });
    assert.equal(forClient(rows, x).asked_since_access, true);
    assert.equal(forClient(rows, y).asked_since_access, false);
  });
});

/* ------------------------------------------------------------------ sign-in: test clients, and who paid */

test("portal SQL, sign-in: is_test marks demo, synthetic and internal addresses, never a buyer", { skip: !HAS_DB }, async (t) => {
  const real = client();
  await expectListed(t, "RED: a real buyer is not a test", buyer(real), real, { is_test: false });
  const demo = client({ is_demo: true });
  await expectListed(t, "test: demo flag", buyer(demo), demo, { is_test: true });
  const synth = client({ custom_fields: { synthetic: "true" } });
  await expectListed(t, "test: synthetic flag", buyer(synth), synth, { is_test: true });
  const notSynth = client({ custom_fields: { synthetic: "false" } });
  await expectListed(t, "real: synthetic flag set to false", buyer(notSynth), notSynth, { is_test: false });
  for (const mail of [
    "test+crs@fundhub.ai",
    "e2e+financeos-14a16@fundhub.ai",
    "someone@fundhub.ai",
    "TEST+Upper@Fundhub.AI",
    "bakerskater987+test.commas.1786606351723@gmail.com",
    "stanbridgejchris+sim-12@gmail.com",
    "adv-blk5a-1.1@example.test"
  ]) {
    const x = client({ email: mail });
    await expectListed(t, `test: ${mail}`, buyer(x), x, { is_test: true });
  }
  for (const mail of ["bramselleslach@gmail.com", "test.person@gmail.com", "pat+testing@gmail.com", "jane@fundhub.com"]) {
    const x = client({ email: mail });
    await expectListed(t, `real: ${mail}`, buyer(x), x, { is_test: false });
  }
});

test("portal SQL, sign-in: paid_through_door needs a succeeded, non-demo payment with a payment event within a day", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const door = (over) => buyer(c, over);
  await expectListed(t, "GREEN: succeeded, with a payment event at the same time", door(), c, { paid_through_door: true });
  await expectListed(t, "GREEN: the event came 20 hours after the payment", door({ events: [doorEvent(c, 124)] }), c, { paid_through_door: true });
  await expectListed(t, "GREEN: the event came 20 hours before the payment", door({ events: [doorEvent(c, 164)] }), c, { paid_through_door: true });
  await expectListed(t, "RED: the event is 3 days away from the payment (a pasted row)", door({ events: [doorEvent(c, 144 + 72)] }), c, { paid_through_door: false });
  await expectListed(t, "RED: the event is 28 hours away", door({ events: [doorEvent(c, 144 - 28)] }), c, { paid_through_door: false });
  await expectListed(t, "RED: no payment event at all", door({ events: [] }), c, { paid_through_door: false });
  await expectListed(t, "RED: an event with another name", door({ events: [doorEvent(c, 144, { name: "payment.failed" })] }), c, { paid_through_door: false });
  const other = client();
  await expectListed(t, "RED: another client's payment event", door({ events: [doorEvent(other, 144)] }), c, { paid_through_door: false });
  await expectListed(t, "RED: a payment event of another company", door({ events: [doorEvent(c, 144, { org_id: OTHER_ORG })] }), c, { paid_through_door: false });
  await expectListed(t, "GREEN: status with odd case and spaces still counts", door({ transactions: [payment(c, 144, { status: " Succeeded " })] }), c, { paid_through_door: true });
  await expectListed(t, "RED: a failed payment", door({ transactions: [payment(c, 144, { status: "failed" })] }), c, { paid_through_door: false });
  await expectListed(t, "RED: a pending payment", door({ transactions: [payment(c, 144, { status: "pending" })] }), c, { paid_through_door: false });
  await expectListed(t, "RED: a demo payment", door({ transactions: [payment(c, 144, { is_demo: true })] }), c, { paid_through_door: false });
  await expectListed(t, "RED: only another client's payment", door({ transactions: [payment(other, 144)] }), c, { paid_through_door: false });
  await expectListed(t, "RED: a payment of another company", door({ transactions: [payment(c, 144, { org_id: OTHER_ORG })] }), c, { paid_through_door: false });
  await expectListed(t, "GREEN: a failed payment AND a good one", door({ transactions: [payment(c, 150, { status: "failed" }), payment(c, 144)] }), c, { paid_through_door: true });
  await expectListed(t, "RED: no payment at all (access given by hand)", door({ transactions: [], events: [] }), c, { paid_through_door: false });
});

/* ------------------------------------------------------------------ progress: which client is read */

const PICK = [ORG, "succeeded", M.INTERNAL_CLIENT_EMAIL_RE];
const pickRows = (fakes) => run(M.PROGRESS_CLIENT_SQL, PICK, fakes);

function paidFakes(entries) {
  const out = { clients: [], transactions: [], events: [] };
  for (const { c, hoursAgo = 48, tx = {}, ev = null } of entries) {
    out.clients.push(c);
    out.transactions.push(payment(c, hoursAgo, tx));
    if (ev !== false) out.events.push(doorEvent(c, hoursAgo, ev || {}));
  }
  return out;
}

test("portal SQL, progress: the client read is the newest real paying client", { skip: !HAS_DB }, async (t) => {
  const older = client();
  const newer = client();
  await t.test("RED: nobody paid, nothing to read", async () => {
    assert.deepEqual(await pickRows({}), []);
  });
  await t.test("the newest of two real paying clients is picked", async () => {
    const rows = await pickRows(paidFakes([{ c: older, hoursAgo: 240 }, { c: newer, hoursAgo: 48 }]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, newer.id);
  });
  await t.test("the newest is picked whatever order the rows come in", async () => {
    const rows = await pickRows(paidFakes([{ c: newer, hoursAgo: 48 }, { c: older, hoursAgo: 240 }]));
    assert.equal(rows[0].id, newer.id);
  });
  const skips = [
    ["a demo client", () => client({ is_demo: true }), {}],
    ["a synthetic client", () => client({ custom_fields: { synthetic: "true" } }), {}],
    ["an internal test address", () => client({ email: "test+x@fundhub.ai" }), {}],
    ["an e2e address", () => client({ email: "e2e+x@fundhub.ai" }), {}],
    ["a failed payment", () => client(), { tx: { status: "failed" } }],
    ["a pending payment", () => client(), { tx: { status: "pending" } }],
    ["a demo payment", () => client(), { tx: { is_demo: true } }],
    ["a payment with no payment event", () => client(), { ev: false }],
    ["a payment whose event is 3 days away", () => client(), { ev: { created_at: hrs(48 + 72) } }],
    ["a payment of another company", () => client(), { tx: { org_id: OTHER_ORG } }],
    ["a client row of another company", () => client({ org_id: OTHER_ORG }), {}]
  ];
  for (const [label, make, extra] of skips) {
    await t.test(`GREEN: ${label} is passed over for the older real client`, async () => {
      const skipped = make();
      const rows = await pickRows(paidFakes([{ c: older, hoursAgo: 240 }, { c: skipped, hoursAgo: 48, ...extra }]));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, older.id, `${label} was picked`);
    });
  }
  await t.test("GREEN: a payment with odd-case status still counts", async () => {
    const rows = await pickRows(paidFakes([{ c: newer, hoursAgo: 48, tx: { status: " Succeeded " } }]));
    assert.equal(rows[0].id, newer.id);
  });
  await t.test("the status asked for is the one passed in", async () => {
    const x = client();
    const rows = await run(M.PROGRESS_CLIENT_SQL, [ORG, "failed", M.INTERNAL_CLIENT_EMAIL_RE], paidFakes([{ c: x, tx: { status: "failed" } }, { c: older, hoursAgo: 240 }]));
    assert.equal(rows[0].id, x.id);
  });
});

/* ------------------------------------------------------------------ progress: the client's own rows */

const progressRows = (clientId, fakes) => run(M.PROGRESS_ROWS_SQL, [ORG, clientId, REPAIR_PIPELINE], fakes);
const wp = (cid, org = ORG) => ({ org_id: org, client_id: cid });
const deliv = (cid, over = {}) => ({
  org_id: ORG, client_id: cid, kind: "deliverable", is_demo: false, generated_at: hrs(48), created_at: hrs(48), ...over
});

test("portal SQL, progress: counts steps, documents and the repair stage for this client only", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const other = client();
  await t.test("a client with nothing on file reads 0, 0 and no stage", async () => {
    const [row] = await progressRows(c.id, {});
    assert.equal(row.waypoints, 0);
    assert.equal(row.deliverables, 0);
    assert.deepEqual(row.repair_stages, []);
  });
  await t.test("checklist steps are counted for this client and this company only", async () => {
    const [row] = await progressRows(c.id, {
      client_waypoints: [wp(c.id), wp(c.id), wp(c.id), wp(other.id), wp(other.id), wp(c.id, OTHER_ORG)]
    });
    assert.equal(row.waypoints, 3);
  });
  await t.test("only deliverables are counted, for this client and this company only", async () => {
    const [row] = await progressRows(c.id, {
      documents: [
        deliv(c.id), deliv(c.id),
        deliv(c.id, { kind: "contract" }), deliv(c.id, { kind: "letter" }),
        deliv(other.id), deliv(c.id, { org_id: OTHER_ORG })
      ]
    });
    assert.equal(row.deliverables, 2);
  });
  const pipe = uuid();
  const otherPipe = uuid();
  const analysis = uuid();
  const dispute = uuid();
  const stages = [{ id: analysis, key: "analysis" }, { id: dispute, key: "dispute" }];
  const pipelines = [{ id: pipe, key: REPAIR_PIPELINE }, { id: otherPipe, key: "sales" }];
  const card = (cid, stage, pipeline, org = ORG) => ({ org_id: org, client_id: cid, stage_id: stage, pipeline_id: pipeline });
  await t.test("the repair stage is the key of the stage the client's repair card sits in", async () => {
    const [row] = await progressRows(c.id, {
      cards: [card(c.id, analysis, pipe)], pipeline_stages: stages, pipelines
    });
    assert.deepEqual(row.repair_stages, ["analysis"]);
  });
  await t.test("a card in another pipeline is not a repair stage", async () => {
    const [row] = await progressRows(c.id, {
      cards: [card(c.id, analysis, otherPipe)], pipeline_stages: stages, pipelines
    });
    assert.deepEqual(row.repair_stages, []);
  });
  await t.test("another client's card, or another company's, is not this client's stage", async () => {
    const [row] = await progressRows(c.id, {
      cards: [card(other.id, analysis, pipe), card(c.id, dispute, pipe, OTHER_ORG)], pipeline_stages: stages, pipelines
    });
    assert.deepEqual(row.repair_stages, []);
  });
  await t.test("two repair cards give both stage keys", async () => {
    const [row] = await progressRows(c.id, {
      cards: [card(c.id, analysis, pipe), card(c.id, dispute, pipe)], pipeline_stages: stages, pipelines
    });
    assert.deepEqual([...row.repair_stages].sort(), ["analysis", "dispute"]);
  });
  await t.test("the pipeline asked for is the one passed in", async () => {
    const [row] = await run(M.PROGRESS_ROWS_SQL, [ORG, c.id, "sales"], {
      cards: [card(c.id, analysis, otherPipe), card(c.id, dispute, pipe)], pipeline_stages: stages, pipelines
    });
    assert.deepEqual(row.repair_stages, ["analysis"]);
  });
});
