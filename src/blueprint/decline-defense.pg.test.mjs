// Decline defense against a real Postgres: migration 470's guards, the real
// setApplicationStatus (application_decisions rows), the real createTask (the
// tasks idempotency index), and the store end to end.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. CI runs it
// against a scratch database built from db/migrations. Never point it at the
// live database — it writes, then removes, its own test client.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { recordDecline, readDeclines, recordOutcome, setStepStatus, SOURCE_WORKFLOW } from "./decline-defense.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_LIKE = "decline.defense.pg.%@example.com";
const STAFF = { id: null, name: "Decline Test", email: "decline.test@example.com" };
const BY = { kind: "staff", name: "Decline Test" };

const LETTER = `Thank you for applying for the Chase Ink Business Cash card.
Unfortunately, we are unable to approve your application. The principal reasons are:
- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines
If you would like us to reconsider, please call 1-800-453-9719 within 30 days.`;

async function deleteClients(ids) {
  if (!ids.length) return;
  const kids = (await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'public.clients'::regclass
        AND c.contype = 'f' AND c.confdeltype <> 'c' AND array_length(c.conkey, 1) = 1`
  )).rows;
  for (const k of kids) await db.query(`DELETE FROM ${k.tbl} WHERE ${k.col} = ANY($1::uuid[])`, [ids]);
  await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
}

async function purge() {
  const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [EMAIL_LIKE])).rows.map((r) => r.id);
  await deleteClients(ids);
}

async function makeClient(org, tag, { buyer = true } = {}) {
  const id = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
     VALUES ($1, 'Decline', $2, $3, '{}'::jsonb) RETURNING id`,
    [org, tag, `decline.defense.pg.${tag}@example.com`]
  )).rows[0].id;
  if (buyer) {
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)
       VALUES ($1, $2, 'Consulting Services Package', 5000.00, 'succeeded', 'commas', $3, '{}'::jsonb)`,
      [org, id, `decline-defense-pg-${tag}`]
    );
  }
  const round = (await db.query(
    `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product) VALUES ($1, $2, 1, 'open', 'card_stacking') RETURNING id`,
    [org, id]
  )).rows[0].id;
  const app = (await db.query(
    `INSERT INTO applications (org_id, funding_round_id, client_id, bank, lender_name, product_name, status)
     VALUES ($1, $2, $3, 'Chase', 'Chase', 'Ink Business Cash', 'Applied') RETURNING id`,
    [org, round, id]
  )).rows[0].id;
  return { id, app };
}

describe("decline defense against Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
  });
  after(async () => {
    await purge();
    await close();
  });

  test("staff record: decline + plan + one task; the application says Denied with its audit row", async () => {
    const c = await makeClient(org, "record");
    const out = await recordDecline(db, { orgId: org, clientId: c.id, by: BY, staff: STAFF, source: "staff",
      input: { application_id: c.app, text: LETTER, declined_on: "2026-10-02", recon_on: "2026-10-09" } });
    assert.equal(out.ok, true);
    assert.equal(out.created, true);
    const d = (await db.query(`SELECT * FROM blueprint_declines WHERE id = $1`, [out.decline_id])).rows[0];
    assert.deepEqual(d.reason_categories, ["too_many_inquiries"]);
    assert.equal(d.needs_person, true);
    assert.deepEqual(d.bureaus_pulled, []);
    const steps = (await db.query(`SELECT * FROM blueprint_decline_steps WHERE decline_id = $1 ORDER BY position`, [d.id])).rows;
    assert.ok(steps.length >= 8);
    assert.ok(steps.every((s) => s.is_blank || (s.step_text && s.source_kind && s.source_ref)));
    const tasks = (await db.query(`SELECT * FROM tasks WHERE client_id = $1 AND source_workflow = $2`, [c.id, SOURCE_WORKFLOW])).rows;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assignee_role, "funding_advisor");
    assert.equal(d.task_id, tasks[0].id);
    const app = (await db.query(`SELECT status FROM applications WHERE id = $1`, [c.app])).rows[0];
    assert.equal(app.status, "Denied");
    const audit = (await db.query(`SELECT event_type, status FROM application_decisions WHERE application_id = $1`, [c.app])).rows;
    assert.ok(audit.some((r) => r.event_type === "decline_recorded" && r.status === "Denied"));

    const again = await recordDecline(db, { orgId: org, clientId: c.id, by: BY, staff: STAFF, source: "staff", input: { application_id: c.app, text: LETTER } });
    assert.equal(again.duplicate, true);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE client_id = $1 AND source_workflow = $2`, [c.id, SOURCE_WORKFLOW])).rows[0].n, 1);
  });

  test("approved on reconsideration: the application becomes Approved with the amount", async () => {
    const c = await makeClient(org, "approve");
    const out = await recordDecline(db, { orgId: org, clientId: c.id, by: BY, staff: STAFF, source: "staff", input: { application_id: c.app, text: LETTER } });
    const res = await recordOutcome(db, { orgId: org, clientId: c.id, declineId: out.decline_id, outcome: "approved_on_recon", approvedAmount: "15000", staff: STAFF, by: BY });
    assert.equal(res.approved_amount, "15000.00");
    const app = (await db.query(`SELECT status, approved_amount FROM applications WHERE id = $1`, [c.app])).rows[0];
    assert.equal(app.status, "Approved");
    assert.equal(String(app.approved_amount), "15000.00");
  });

  test("a client's paste never touches the application; the client view carries no sources", async () => {
    const c = await makeClient(org, "paste");
    await recordDecline(db, { orgId: org, clientId: c.id, by: { kind: "client" }, source: "client_paste", input: { application_id: c.app, text: LETTER } });
    assert.equal((await db.query(`SELECT status FROM applications WHERE id = $1`, [c.app])).rows[0].status, "Applied");
    const { view } = await readDeclines(db, { orgId: org, clientId: c.id, viewer: { kind: "client" } });
    assert.equal(view.declines.length, 1);
    assert.doesNotMatch(JSON.stringify(view), /Calling DENIED|SUGGESTION_CATALOGUE|source_ref/);
  });

  test("not a Blueprint buyer: refused, nothing written", async () => {
    const c = await makeClient(org, "nobuy", { buyer: false });
    const out = await recordDecline(db, { orgId: org, clientId: c.id, by: BY, staff: STAFF, source: "staff", input: { bank: "Chase", text: LETTER } });
    assert.deepEqual(out, { ok: false, error: "not_blueprint_buyer" });
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM blueprint_declines WHERE client_id = $1`, [c.id])).rows[0].n, 0);
  });

  test("the database guards: cited steps, blanks, needs-a-person, re-apply date, bureaus, reason set", async () => {
    const c = await makeClient(org, "guards");
    const out = await recordDecline(db, { orgId: org, clientId: c.id, by: BY, staff: STAFF, source: "staff", input: { bank: "Chase", text: LETTER } });
    const decline = out.decline_id;
    const reject = async (sql, params, name) => {
      await assert.rejects(db.query(sql, params), (e) => String(e.message).includes(name) || String(e.constraint || "").includes(name), name);
    };
    await reject(`INSERT INTO blueprint_decline_steps (org_id, decline_id, position, step_key, who, step_text, client_text)
                  VALUES ($1, $2, 90, 'made_up', 'ops', 'Tell the bank anything', 'x')`, [org, decline], "blueprint_decline_steps_cited_ck");
    await reject(`INSERT INTO blueprint_decline_steps (org_id, decline_id, position, step_key, who, client_text, is_blank, blank_label, status, done_at)
                  VALUES ($1, $2, 91, 'blank_done', 'ops', 'x', true, 'write it', 'done', now())`, [org, decline], "blueprint_decline_steps_blank_done_ck");
    await reject(`INSERT INTO blueprint_declines (org_id, client_id, bank, source, needs_person, reason_categories)
                  VALUES ($1, $2, 'Chase', 'staff', false, '{}')`, [org, c.id], "blueprint_declines_needs_person_ck");
    await reject(`INSERT INTO blueprint_declines (org_id, client_id, bank, source, needs_person, reason_categories)
                  VALUES ($1, $2, 'Chase', 'staff', false, '{guessed_reason}')`, [org, c.id], "blueprint_declines_reasons_ck");
    await reject(`INSERT INTO blueprint_declines (org_id, client_id, bank, source, needs_person, bureaus_pulled)
                  VALUES ($1, $2, 'Chase', 'staff', true, '{innovis}')`, [org, c.id], "blueprint_declines_bureaus_ck");
    await reject(`UPDATE blueprint_declines SET outcome = 'reapply_later', outcome_at = now() WHERE id = $1`, [decline], "blueprint_declines_reapply_ck");
    await reject(`UPDATE blueprint_declines SET outcome_approved_amount = 0, outcome = 'approved_on_recon', outcome_at = now() WHERE id = $1`, [decline], "blueprint_declines_amount_ck");

    const blank = (await db.query(`SELECT step_key FROM blueprint_decline_steps WHERE decline_id = $1 AND is_blank LIMIT 1`, [decline])).rows[0];
    assert.ok(blank);
    const done = await setStepStatus(db, { orgId: org, clientId: c.id, declineId: decline, stepKey: blank.step_key, status: "done", filledText: "Written by ops.", by: BY });
    assert.equal(done.step.status, "done");
  });
});
