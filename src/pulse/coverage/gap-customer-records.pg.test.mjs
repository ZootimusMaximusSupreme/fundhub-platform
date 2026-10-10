// Customer records and bank links — the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-customer-records.pg.test.mjs
//
// WHY THIS FILE EXISTS. The unit tests for gap-bank-links, gap-money-helper and
// gap-records hand each lane a fake database that returns canned counts. That
// proves the wording and the status rules. It cannot prove the SQL, and the SQL
// is where the logic lives: which login is "the newest per bank", what "told"
// means, when a held row is stuck, when an erasure was replaced, which consent
// was live when a recording was saved. These scenarios run the real SQL on a
// real Postgres and make it answer for made-up people.
//
// HOW IT STAYS HARMLESS (the same way gap-portal.pg.test.mjs does). Each query
// runs inside BEGIN READ ONLY and is always rolled back. Every real table the
// statement names is shadowed by a CTE that holds ONLY the made-up rows of that
// scenario (the real table is read with WHERE false, only to take its column
// types, so a dropped or renamed column still breaks the test). No real row is
// ever read, so the answers are the same on an empty scratch database as on
// production. Nothing is written (the database would refuse it). Nothing is sent.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import * as BANKS from "./gap-bank-links.mjs";
import * as HELPER from "./gap-money-helper.mjs";
import * as RECORDS from "./gap-records.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const uuid = () => crypto.randomUUID();

let NOW = new Date();
const hrs = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const days = (d) => hrs(d * 24);

const SHADOWS = {
  plaid_items: {
    cols: "id, org_id, client_id, plaid_item_id, plaid_institution_id, institution_name, link_state, last_error_code, last_error_at, created_at, updated_at",
    rec: "id uuid, org_id uuid, client_id uuid, plaid_item_id text, plaid_institution_id text, institution_name text, link_state text, last_error_code text, last_error_at timestamptz, created_at timestamptz, updated_at timestamptz"
  },
  tasks: {
    cols: "id, org_id, client_id, title, body, source_workflow, created_at",
    rec: "id uuid, org_id uuid, client_id uuid, title text, body text, source_workflow text, created_at timestamptz"
  },
  messages: {
    cols: "org_id, client_id, direction, status, template_key, rendered_body, created_at",
    rec: "org_id uuid, client_id uuid, direction text, status text, template_key text, rendered_body text, created_at timestamptz"
  },
  merchant_connections: {
    cols: "org_id, mode, status, encrypted_api_key, last_synced_at, last_sync_error, created_at",
    rec: "org_id uuid, mode text, status text, encrypted_api_key text, last_synced_at timestamptz, last_sync_error text, created_at timestamptz"
  },
  money_agent_tasks: {
    cols: "org_id, client_id, assignee, status, moves_money, due_on, created_at, updated_at, claimed_at, result",
    rec: "org_id uuid, client_id uuid, assignee text, status text, moves_money boolean, due_on date, created_at timestamptz, updated_at timestamptz, claimed_at timestamptz, result jsonb"
  },
  money_helper_turns: {
    cols: "org_id, client_id, status, created_at, claimed_at, updated_at",
    rec: "org_id uuid, client_id uuid, status text, created_at timestamptz, claimed_at timestamptz, updated_at timestamptz"
  },
  money_agent_log: {
    cols: "org_id, client_id, action, idempotency_key, created_at",
    rec: "org_id uuid, client_id uuid, action text, idempotency_key text, created_at timestamptz"
  },
  clients: {
    cols: "id, org_id, email, custom_fields, is_demo",
    rec: "id uuid, org_id uuid, email text, custom_fields jsonb, is_demo boolean"
  },
  erasure_requests: {
    cols: "org_id, kind, subject_client_id, subject_item_id, status, created_at",
    rec: "org_id uuid, kind text, subject_client_id uuid, subject_item_id uuid, status text, created_at timestamptz"
  },
  pii_access_log: {
    cols: "org_id, client_id, accessed_by, created_at",
    rec: "org_id uuid, client_id uuid, accessed_by text, created_at timestamptz"
  },
  staff: {
    cols: "id, org_id",
    rec: "id uuid, org_id uuid"
  },
  ai_bureau_config: {
    cols: "org_id, bureau_code, active, service_number, menu_path",
    rec: "org_id uuid, bureau_code text, active boolean, service_number text, menu_path text"
  },
  customer_insights: {
    cols: "org_id, client_id, recording_url, marketing_cleared, created_at",
    rec: "org_id uuid, client_id uuid, recording_url text, marketing_cleared boolean, created_at timestamptz"
  },
  client_consents: {
    cols: "org_id, client_id, kind, granted_at, revoked_at, expires_at",
    rec: "org_id uuid, client_id uuid, kind text, granted_at timestamptz, revoked_at timestamptz, expires_at timestamptz"
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
  const lead = /^\s*\/\*[\s\S]*?\*\/\s*/.exec(sql)?.[0] || "";
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
  const unused = Object.keys(fakes).filter((t) => !used.includes(t));
  assert.deepEqual(unused, [], "scenario gives rows to a table this statement never reads");
  await conn.query("SAVEPOINT scenario");
  try {
    return (await conn.query(text, [...params, ...extra])).rows;
  } finally {
    await conn.query("ROLLBACK TO SAVEPOINT scenario");
    await conn.query("RELEASE SAVEPOINT scenario");
  }
}

/* ------------------------------------------------------------------ made-up rows */

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

const bank = (c, over = {}) => ({
  id: uuid(), org_id: ORG, client_id: c.id, plaid_item_id: `item-${uuid().slice(0, 8)}`,
  plaid_institution_id: "ins_chase", institution_name: "Chase",
  link_state: "active", last_error_code: null, last_error_at: null,
  created_at: days(30), updated_at: days(30), ...over
});
const broken = (c, ago, over = {}) => bank(c, {
  link_state: "error", last_error_code: "ITEM_LOGIN_REQUIRED",
  last_error_at: ago, created_at: days(60), updated_at: ago, ...over
});
const task = (c, createdAgo, over = {}) => ({
  id: uuid(), org_id: ORG, client_id: c.id, title: "Reconnect the client's bank login", body: null,
  source_workflow: "csm", created_at: createdAgo, ...over
});
const message = (c, createdAgo, over = {}) => ({
  org_id: ORG, client_id: c.id, direction: "outbound", status: "delivered", template_key: null,
  rendered_body: "Please link your bank again so we can see your accounts.", created_at: createdAgo, ...over
});

/* ------------------------------------------------------------------ the harness itself */

test("records SQL: the harness is read only, and with no made-up rows nothing is listed", { skip: !HAS_DB }, async () => {
  await conn.query("SAVEPOINT probe");
  try {
    await assert.rejects(conn.query("CREATE TEMP TABLE records_pg_probe (x int)"), /read-only transaction/);
  } finally {
    await conn.query("ROLLBACK TO SAVEPOINT probe");
    await conn.query("RELEASE SAVEPOINT probe");
  }
  const [row] = await run(BANKS.LOGIN_SQL, [ORG, days(1), BANKS.BANK_TOLD_RE], {});
  assert.equal(row.banks, 0);
  assert.equal(row.broken, 0);
});

/* ------------------------------------------------------------------ banks:login-broken */

const loginRow = async (fakes, org = ORG) => (await run(BANKS.LOGIN_SQL, [org, hrs(BANKS.LOGIN_WINDOW_MS / 3600000), BANKS.BANK_TOLD_RE], fakes))[0];

test("login SQL: RED when a bank login broke 3 days ago and nobody told the client", { skip: !HAS_DB }, async () => {
  const c = client();
  const r = await loginRow({ plaid_items: [broken(c, days(3))], tasks: [], messages: [] });
  assert.equal(r.broken, 1);
  assert.equal(r.clients, 1);
  assert.equal(r.last_code, "ITEM_LOGIN_REQUIRED");
  assert.ok(r.oldest, "the oldest break is named");
});

test("login SQL: GREEN once the client links the same bank again (the newest login is judged)", { skip: !HAS_DB }, async () => {
  const c = client();
  const oldBroken = broken(c, days(3));
  const relinked = bank(c, { created_at: days(1), updated_at: days(1) });
  const r = await loginRow({ plaid_items: [oldBroken, relinked], tasks: [], messages: [] });
  assert.equal(r.banks, 1, "two logins at one bank are one bank");
  assert.equal(r.in_error, 0);
  assert.equal(r.broken, 0);
});

test("login SQL: the same bank by NAME when the institution id is missing, and a different bank is its own bank", { skip: !HAS_DB }, async () => {
  const c = client();
  const a = broken(c, days(3), { plaid_institution_id: null, institution_name: "First Credit Union" });
  const a2 = bank(c, { plaid_institution_id: null, institution_name: "first credit union", created_at: days(1) });
  const other = broken(c, days(4), { plaid_institution_id: "ins_other", institution_name: "Other Bank" });
  const r = await loginRow({ plaid_items: [a, a2, other], tasks: [], messages: [] });
  assert.equal(r.banks, 2);
  assert.equal(r.broken, 1, "only the other bank is still broken");
});

test("login SQL: a row with no institution at all is its own bank and cannot hide behind another", { skip: !HAS_DB }, async () => {
  const c = client();
  const mystery = broken(c, days(3), { plaid_institution_id: null, institution_name: null });
  const active = bank(c, { created_at: days(1) });
  const r = await loginRow({ plaid_items: [mystery, active], tasks: [], messages: [] });
  assert.equal(r.banks, 2);
  assert.equal(r.broken, 1);
});

test("login SQL: GREEN inside the first day (2 hours old)", { skip: !HAS_DB }, async () => {
  const c = client();
  const r = await loginRow({ plaid_items: [broken(c, hrs(2))], tasks: [], messages: [] });
  assert.equal(r.in_error, 1);
  assert.equal(r.broken, 0);
});

test("login SQL: GREEN when a staff task about the bank login was opened after the break", { skip: !HAS_DB }, async () => {
  const c = client();
  const r = await loginRow({ plaid_items: [broken(c, days(3))], tasks: [task(c, days(2))], messages: [] });
  assert.equal(r.broken, 0);
  assert.equal(r.followed_up, 1);
});

test("login SQL: RED when the task is about something else, came before the break, or is another client's", { skip: !HAS_DB }, async () => {
  const c = client();
  const other = client();
  const rows = [broken(c, days(3))];
  const cases = {
    "about a card limit": [task(c, days(2), { title: "Call about the card limit", body: "Raise it" })],
    "opened 5 days ago, before the break": [task(c, days(5))],
    "another client's task": [task(other, days(2))]
  };
  for (const [name, tasks] of Object.entries(cases)) {
    const r = await loginRow({ plaid_items: rows, tasks, messages: [] });
    assert.equal(r.broken, 1, name);
  }
});

test("login SQL: a message counts only when it really left (sent, delivered), is outbound and says it", { skip: !HAS_DB }, async () => {
  const c = client();
  const rows = [broken(c, days(3))];
  for (const status of ["sent", "delivered"]) {
    const r = await loginRow({ plaid_items: rows, tasks: [], messages: [message(c, days(2), { status })] });
    assert.equal(r.broken, 0, `status ${status}`);
  }
  for (const [name, msg] of Object.entries({
    queued: message(c, days(2), { status: "queued" }),
    failed: message(c, days(2), { status: "failed" }),
    bounced: message(c, days(2), { status: "bounced" }),
    inbound: message(c, days(2), { direction: "inbound", status: "received" }),
    "about something else": message(c, days(2), { rendered_body: "Your roadmap is ready" }),
    "before the break": message(c, days(5))
  })) {
    const r = await loginRow({ plaid_items: rows, tasks: [], messages: [msg] });
    assert.equal(r.broken, 1, name);
  }
  // The template key can carry the words when the body does not.
  const byKey = await loginRow({
    plaid_items: rows, tasks: [],
    messages: [message(c, days(2), { rendered_body: null, template_key: "SMS-BANK-LOGIN-RELINK" })]
  });
  assert.equal(byKey.broken, 0);
});

test("login SQL: a mock login is left out, and another company's login is not counted for this company", { skip: !HAS_DB }, async () => {
  const c = client();
  const mock = broken(c, days(3), { plaid_item_id: `mock:${c.id}` });
  assert.equal((await loginRow({ plaid_items: [mock], tasks: [], messages: [] })).banks, 0);
  const foreign = client({ org_id: OTHER_ORG });
  const theirs = broken(foreign, days(3), { org_id: OTHER_ORG });
  assert.equal((await loginRow({ plaid_items: [theirs], tasks: [], messages: [] })).broken, 0);
  // With no company, every company is read.
  assert.equal((await loginRow({ plaid_items: [theirs], tasks: [], messages: [] }, null)).broken, 1);
});

test("login SQL: the break time falls back to the row's own times when last_error_at is empty", { skip: !HAS_DB }, async () => {
  const c = client();
  const noStamp = broken(c, null, { last_error_at: null, updated_at: days(3), created_at: days(40) });
  assert.equal((await loginRow({ plaid_items: [noStamp], tasks: [], messages: [] })).broken, 1);
});

/* ------------------------------------------------------------------ banks:merchant-sync */

const merchantRow = async (rows, org = ORG) =>
  (await run(BANKS.MERCHANT_SQL, [org, hrs(BANKS.MERCHANT_QUIET_MS / 3600000)], { merchant_connections: rows }))[0];

const conn1 = (over = {}) => ({
  org_id: ORG, mode: "pull", status: "active", encrypted_api_key: "v1:x:y:z",
  last_synced_at: hrs(5), last_sync_error: null, created_at: days(30), ...over
});

test("merchant SQL: RED for no sync in 3 days, for a sync error, and for a connection that never synced in 5 days", { skip: !HAS_DB }, async () => {
  const r = await merchantRow([
    conn1({ last_synced_at: days(3) }),
    conn1({ last_sync_error: "The key was refused (401)." }),
    conn1({ last_synced_at: null, created_at: days(5) }),
    conn1()
  ]);
  assert.equal(r.live, 4);
  assert.equal(r.late, 3);
  assert.equal(r.errored, 1);
  assert.equal(r.quiet, 2);
  assert.equal(r.sample_error, "The key was refused (401).");
});

test("merchant SQL: GREEN for a sync 1 day ago, a connection made an hour ago, and rows the sweeper never works", { skip: !HAS_DB }, async () => {
  const r = await merchantRow([
    conn1({ last_synced_at: days(1) }),
    conn1({ last_synced_at: null, created_at: hrs(1) }),
    conn1({ mode: "push", last_synced_at: days(9) }),
    conn1({ status: "disabled", last_synced_at: days(9) }),
    conn1({ status: "waiting", last_synced_at: days(9) }),
    conn1({ encrypted_api_key: null, last_synced_at: days(9) }),
    conn1({ org_id: OTHER_ORG, last_synced_at: days(9) })
  ]);
  assert.equal(r.live, 2);
  assert.equal(r.late, 0);
});

/* ------------------------------------------------------------------ helper:rows-stuck */

function helperParams(over = {}) {
  return [
    over.org === undefined ? ORG : over.org,
    over.demoOn ?? false,
    TEST_CLIENT_EMAIL_RE,
    hrs(HELPER.STUCK_AFTER_MS / 3600000),
    HELPER.proposalCutoffDay(NOW),
    hrs(HELPER.FAILED_TURN_LOOK_MS / 3600000),
    hrs(HELPER.READY_PRESS_GRACE_MS / 3600000),
    HELPER.CSM_PREP_SOURCE,
    HELPER.PREP_CALL_BODY
  ];
}
const helperRow = async (fakes, over) => (await run(HELPER.STUCK_SQL, helperParams(over), { clients: [], ...fakes }))[0];

const agentTask = (c, over = {}) => ({
  org_id: ORG, client_id: c.id, assignee: "agent", status: "queued", moves_money: false,
  due_on: null, created_at: hrs(2), updated_at: hrs(2), claimed_at: null, result: null, ...over
});
const turn = (c, over = {}) => ({
  org_id: ORG, client_id: c.id, status: "queued", created_at: hrs(2), claimed_at: null, updated_at: hrs(2), ...over
});
const press = (c, round, ago, over = {}) => ({
  org_id: ORG, client_id: c.id, action: "ready_to_fund", idempotency_key: `ready-to-fund:${c.id}:r${round}`, created_at: ago, ...over
});
const prepTask = (c, body, over = {}) => ({
  id: uuid(), org_id: ORG, client_id: c.id, title: "Blueprint closing prep call", body,
  source_workflow: HELPER.CSM_PREP_SOURCE, created_at: hrs(1), ...over
});

test("helper SQL: a queued agent row is stuck after 10 minutes, not before, and a person row is never the helper's", { skip: !HAS_DB }, async () => {
  const c = client();
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [agentTask(c)] })).tasks_queued, 1);
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [agentTask(c, { created_at: new Date(NOW.getTime() - 60000).toISOString() })] })).tasks_queued, 0);
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [agentTask(c, { assignee: "person" })] })).tasks_queued, 0);
});

test("helper SQL: a claimed row is stuck, and a row held on purpose (in_progress) is not", { skip: !HAS_DB }, async () => {
  const c = client();
  const claimed = agentTask(c, { status: "claimed", claimed_at: hrs(1) });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [claimed] })).tasks_claimed, 1);
  const held = agentTask(c, { status: "claimed", claimed_at: hrs(1), result: { in_progress: true, client_message: "Waiting on you" } });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [held] })).tasks_claimed, 0);
  const fresh = agentTask(c, { status: "claimed", claimed_at: new Date(NOW.getTime() - 30000).toISOString() });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [fresh] })).tasks_claimed, 0);
});

test("helper SQL: a money proposal is late only after the engine's own expiry day, and a later due day keeps it alive", { skip: !HAS_DB }, async () => {
  const c = client();
  const proposal = (createdAgo, over = {}) => agentTask(c, {
    status: "needs_approval", moves_money: true, created_at: createdAgo, updated_at: createdAgo, ...over
  });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [proposal(days(5))] })).proposals_late, 1);
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [proposal(days(1))] })).proposals_late, 0);
  const dueLater = proposal(days(6), { due_on: HELPER.proposalCutoffDay(NOW) });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [dueLater] })).proposals_late, 0, "a due day on the cut-off day is not before it");
  const dueOld = proposal(days(6), { due_on: HELPER.proposalCutoffDay(new Date(NOW.getTime() - 5 * 86400000)) });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [dueOld] })).proposals_late, 1);
});

test("helper SQL: a chat turn with no answer is stuck, a failed turn is red for a day, an answered one is fine", { skip: !HAS_DB }, async () => {
  const c = client();
  assert.equal((await helperRow({ clients: [c], money_helper_turns: [turn(c)] })).turns_open, 1);
  assert.equal((await helperRow({ clients: [c], money_helper_turns: [turn(c, { status: "running", claimed_at: hrs(1) })] })).turns_open, 1);
  assert.equal((await helperRow({ clients: [c], money_helper_turns: [turn(c, { status: "answered" })] })).turns_open, 0);
  assert.equal((await helperRow({ clients: [c], money_helper_turns: [turn(c, { status: "failed", updated_at: hrs(3) })] })).turns_failed, 1);
  assert.equal((await helperRow({ clients: [c], money_helper_turns: [turn(c, { status: "failed", updated_at: days(3) })] })).turns_failed, 0);
});

test("helper SQL: a ready-to-get-funded press with no prep-call task is stuck, round by round", { skip: !HAS_DB }, async () => {
  const c = client();
  const r1 = press(c, 1, hrs(3));
  assert.equal((await helperRow({ clients: [c], money_agent_log: [r1], tasks: [] })).ready_no_task, 1);
  assert.equal((await helperRow({ clients: [c], money_agent_log: [r1], tasks: [prepTask(c, "blueprint-csm-prep-call")] })).ready_no_task, 0);
  // A press 5 minutes ago may still be making its task.
  const justNow = press(c, 1, new Date(NOW.getTime() - 5 * 60000).toISOString());
  assert.equal((await helperRow({ clients: [c], money_agent_log: [justNow], tasks: [] })).ready_no_task, 0);
  // Round 2 needs the round 2 task: the round 1 task does not cover it.
  const r2 = press(c, 2, hrs(3));
  assert.equal((await helperRow({ clients: [c], money_agent_log: [r2], tasks: [prepTask(c, "blueprint-csm-prep-call")] })).ready_no_task, 1);
  assert.equal((await helperRow({ clients: [c], money_agent_log: [r2], tasks: [prepTask(c, "blueprint-csm-prep-call:r2")] })).ready_no_task, 0);
  // A task from another source, or for another client, does not count.
  assert.equal((await helperRow({ clients: [c], money_agent_log: [r1], tasks: [prepTask(c, "blueprint-csm-prep-call", { source_workflow: "csm" })] })).ready_no_task, 1);
  const other = client();
  assert.equal((await helperRow({ clients: [c, other], money_agent_log: [r1], tasks: [prepTask(other, "blueprint-csm-prep-call")] })).ready_no_task, 1);
});

test("helper SQL: test clients and other companies are left out unless asked for", { skip: !HAS_DB }, async () => {
  const sim = client({ email: "stanbridgejchris+sim-4@gmail.com" });
  const demo = client({ is_demo: true });
  const synth = client({ custom_fields: { synthetic: "true" } });
  const rows = [agentTask(sim), agentTask(demo), agentTask(synth)];
  assert.equal((await helperRow({ clients: [sim, demo, synth], money_agent_tasks: rows })).tasks_queued, 0);
  assert.equal((await helperRow({ clients: [sim, demo, synth], money_agent_tasks: rows }, { demoOn: true })).tasks_queued, 3);
  const c = client();
  const foreign = agentTask(c, { org_id: OTHER_ORG });
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [foreign] })).tasks_queued, 0);
  assert.equal((await helperRow({ clients: [c], money_agent_tasks: [foreign] }, { org: null })).tasks_queued, 1);
});

/* ------------------------------------------------------------------ privacy:erasure */

const erasureRow = async (rows, org = ORG) =>
  (await run(RECORDS.ERASURE_SQL, [org, hrs(RECORDS.ERASURE_WINDOW_MS / 3600000)], { erasure_requests: rows }))[0];

const erasureRec = (subject, status, ago, over = {}) => ({
  org_id: ORG, kind: "client_erasure", subject_client_id: subject, subject_item_id: null, status, created_at: ago, ...over
});

test("erasure SQL: RED for a request still 'requested' after a day and for any failed request", { skip: !HAS_DB }, async () => {
  const a = uuid();
  const b = uuid();
  const r = await erasureRow([erasureRec(a, "requested", days(2)), erasureRec(b, "failed", hrs(1))]);
  assert.equal(r.waiting, 1);
  assert.equal(r.failed, 1);
});

test("erasure SQL: GREEN for a request made an hour ago, and for a completed one", { skip: !HAS_DB }, async () => {
  const a = uuid();
  const r = await erasureRow([erasureRec(a, "requested", hrs(1)), erasureRec(uuid(), "completed", days(9))]);
  assert.equal(r.waiting, 0);
  assert.equal(r.failed, 0);
});

test("erasure SQL: a later completed request for the same person clears the earlier failed or waiting one", { skip: !HAS_DB }, async () => {
  const a = uuid();
  const cleared = await erasureRow([erasureRec(a, "failed", days(3)), erasureRec(a, "completed", days(1))]);
  assert.equal(cleared.failed, 0);
  const waitingCleared = await erasureRow([erasureRec(a, "requested", days(3)), erasureRec(a, "completed", days(1))]);
  assert.equal(waitingCleared.waiting, 0);
  // A completed request that came BEFORE the failure does not clear it.
  const stillRed = await erasureRow([erasureRec(a, "completed", days(5)), erasureRec(a, "failed", days(2))]);
  assert.equal(stillRed.failed, 1);
});

test("erasure SQL: the replacement must be the same person, the same kind and the same bank login", { skip: !HAS_DB }, async () => {
  const a = uuid();
  const itemA = uuid();
  const itemB = uuid();
  const otherPerson = await erasureRow([erasureRec(a, "failed", days(3)), erasureRec(uuid(), "completed", days(1))]);
  assert.equal(otherPerson.failed, 1);
  const otherKind = await erasureRow([
    erasureRec(a, "failed", days(3), { kind: "bank_revoke", subject_item_id: itemA }),
    erasureRec(a, "completed", days(1))
  ]);
  assert.equal(otherKind.failed, 1);
  const otherItem = await erasureRow([
    erasureRec(a, "failed", days(3), { kind: "bank_revoke", subject_item_id: itemA }),
    erasureRec(a, "completed", days(1), { kind: "bank_revoke", subject_item_id: itemB })
  ]);
  assert.equal(otherItem.failed, 1);
  const sameItem = await erasureRow([
    erasureRec(a, "failed", days(3), { kind: "bank_revoke", subject_item_id: itemA }),
    erasureRec(a, "completed", days(1), { kind: "bank_revoke", subject_item_id: itemA })
  ]);
  assert.equal(sameItem.failed, 0);
});

/* ------------------------------------------------------------------ privacy:pii-company */

const piiRow = async (fakes, org = ORG) =>
  (await run(RECORDS.PII_COMPANY_SQL, [org, days(RECORDS.PII_LOOKBACK_DAYS)], fakes))[0];

test("identity SQL: RED when staff from one company revealed a client of another", { skip: !HAS_DB }, async () => {
  const outsider = { id: uuid(), org_id: OTHER_ORG };
  const insider = { id: uuid(), org_id: ORG };
  const c = uuid();
  const r = await piiRow({
    staff: [outsider, insider],
    pii_access_log: [
      { org_id: ORG, client_id: c, accessed_by: outsider.id, created_at: hrs(5) },
      { org_id: ORG, client_id: c, accessed_by: insider.id, created_at: hrs(4) },
      { org_id: ORG, client_id: c, accessed_by: "inquiry-bureau-call", created_at: hrs(3) }
    ]
  });
  assert.equal(r.reveals, 3);
  assert.equal(r.by_staff, 2);
  assert.equal(r.across, 1);
  assert.equal(r.clients, 1);
  assert.equal(r.staff_n, 1);
});

test("identity SQL: GREEN for same-company reveals, system labels, and a reveal older than 7 days", { skip: !HAS_DB }, async () => {
  const outsider = { id: uuid(), org_id: OTHER_ORG };
  const insider = { id: uuid(), org_id: ORG };
  const c = uuid();
  const r = await piiRow({
    staff: [outsider, insider],
    pii_access_log: [
      { org_id: ORG, client_id: c, accessed_by: insider.id, created_at: hrs(4) },
      { org_id: ORG, client_id: c, accessed_by: "inquiry-bureau-call", created_at: hrs(3) },
      { org_id: ORG, client_id: c, accessed_by: outsider.id, created_at: days(9) }
    ]
  });
  assert.equal(r.across, 0);
  assert.equal(r.reveals, 2, "the 9 day old row is outside the window");
});

/* ------------------------------------------------------------------ bureau-config:complete */

test("bureau SQL: the filled rows read PASS, the blank ones read FAIL, and a blank string is blank", { skip: !HAS_DB }, async () => {
  const row = (code, number, menu, over = {}) => ({ org_id: ORG, bureau_code: code, active: true, service_number: number, menu_path: menu, ...over });
  const good = await run(RECORDS.BUREAU_SQL, [ORG], {
    ai_bureau_config: [row("EX", "800-555-0101", "1,2,3"), row("EQ", "800-555-0102", "2,1"), row("TU", "800-555-0103", "3,1,2")]
  });
  assert.equal(RECORDS.judgeBureauConfig(good).status, "PASS");

  const blank = await run(RECORDS.BUREAU_SQL, [ORG], {
    ai_bureau_config: [row("EX", "800-555-0101", "1,2,3"), row("EQ", "   ", "2,1"), row("TU", "800-555-0103", "")]
  });
  const r = RECORDS.judgeBureauConfig(blank);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no service number for EQ/);
  assert.match(r.detail, /no menu path for TU/);

  const lower = await run(RECORDS.BUREAU_SQL, [ORG], {
    ai_bureau_config: [row("ex", "800-555-0101", "1"), row("eq", "800-555-0102", "1"), row("tu", "800-555-0103", "1")]
  });
  assert.equal(RECORDS.judgeBureauConfig(lower).status, "PASS", "a lower case code is read as upper case");

  const foreign = await run(RECORDS.BUREAU_SQL, [ORG], {
    ai_bureau_config: [row("EX", "800", "1", { org_id: OTHER_ORG })]
  });
  assert.equal(foreign.length, 0, "another company's row is not this company's config");
});

/* ------------------------------------------------------------------ consent:recording-and-ads */

const consentRow = async (fakes, demoOn = false) =>
  (await run(RECORDS.CONSENT_SQL, [ORG, demoOn, TEST_CLIENT_EMAIL_RE], fakes))[0];

const insight = (c, over = {}) => ({
  org_id: ORG, client_id: c.id, recording_url: "https://recordings.example.test/abc", marketing_cleared: false,
  created_at: days(2), ...over
});
const grantOf = (c, kind, over = {}) => ({
  org_id: ORG, client_id: c.id, kind, granted_at: days(5), revoked_at: null, expires_at: null, ...over
});

test("consent SQL: RED for a recording saved with no call-recording consent, GREEN with one that was live", { skip: !HAS_DB }, async () => {
  const c = client();
  const none = await consentRow({ customer_insights: [insight(c)], client_consents: [], clients: [c] });
  assert.equal(none.recordings, 1);
  assert.equal(none.recorded_no_consent, 1);
  const ok = await consentRow({ customer_insights: [insight(c)], client_consents: [grantOf(c, "call_recording")], clients: [c] });
  assert.equal(ok.recorded_no_consent, 0);
});

test("consent SQL: the consent must have been live when the recording was saved", { skip: !HAS_DB }, async () => {
  const c = client();
  const saved = insight(c, { created_at: days(2) });
  const cases = {
    "granted after it was saved": [grantOf(c, "call_recording", { granted_at: days(1) })],
    "revoked before it was saved": [grantOf(c, "call_recording", { granted_at: days(9), revoked_at: days(4) })],
    "expired before it was saved": [grantOf(c, "call_recording", { granted_at: days(9), expires_at: days(3) })],
    "the wrong kind": [grantOf(c, "marketing_use")],
    "another client's consent": [grantOf(client(), "call_recording")]
  };
  for (const [name, consents] of Object.entries(cases)) {
    const r = await consentRow({ customer_insights: [saved], client_consents: consents, clients: [c] });
    assert.equal(r.recorded_no_consent, 1, name);
  }
  const revokedLater = await consentRow({
    customer_insights: [saved],
    client_consents: [grantOf(c, "call_recording", { granted_at: days(9), revoked_at: days(1) })],
    clients: [c]
  });
  assert.equal(revokedLater.recorded_no_consent, 0, "a withdrawal after the recording does not make the recording a break");
});

test("consent SQL: a clip cleared for ads is red when the marketing consent is gone, green while it is live", { skip: !HAS_DB }, async () => {
  const c = client();
  const cleared = insight(c, { marketing_cleared: true, recording_url: null });
  const live = await consentRow({ customer_insights: [cleared], client_consents: [grantOf(c, "marketing_use")], clients: [c] });
  assert.equal(live.cleared, 1);
  assert.equal(live.cleared_no_consent, 0);
  const revoked = await consentRow({
    customer_insights: [cleared],
    client_consents: [grantOf(c, "marketing_use", { revoked_at: days(1) })],
    clients: [c]
  });
  assert.equal(revoked.cleared_no_consent, 1);
  const expired = await consentRow({
    customer_insights: [cleared],
    client_consents: [grantOf(c, "marketing_use", { expires_at: days(1) })],
    clients: [c]
  });
  assert.equal(expired.cleared_no_consent, 1);
  const never = await consentRow({ customer_insights: [cleared], client_consents: [], clients: [c] });
  assert.equal(never.cleared_no_consent, 1);
  const recordingOnly = await consentRow({
    customer_insights: [cleared],
    client_consents: [grantOf(c, "call_recording")],
    clients: [c]
  });
  assert.equal(recordingOnly.cleared_no_consent, 1, "agreeing to be recorded is not agreeing to be advertised");
  const notCleared = await consentRow({ customer_insights: [insight(c, { recording_url: null })], client_consents: [], clients: [c] });
  assert.equal(notCleared.cleared, 0);
  assert.equal(notCleared.cleared_no_consent, 0);
});

test("consent SQL: test clients are left out unless asked for", { skip: !HAS_DB }, async () => {
  const sim = client({ email: "stanbridgejchris+walk-2@gmail.com" });
  const rows = { customer_insights: [insight(sim)], client_consents: [], clients: [sim] };
  assert.equal((await consentRow(rows)).recordings, 0);
  assert.equal((await consentRow(rows, true)).recorded_no_consent, 1);
});
