// Verify that the CAPI receipt updates only the same stored track event.
// Skipped without DATABASE_URL, like every other *.pg.test.mjs, and refuses a
// hosted Supabase address: LOCAL scratch database only. It inserts events rows
// keyed to this run and removes them after. Nothing here calls Meta.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { RECORD_META_SQL } from "./track-send.mjs";

const URL_SET = process.env.DATABASE_URL || "";
const HOSTED = /supabase\.(co|com)\b|oqpnlusrotpxfenysfxz/i.test(URL_SET);
const SKIP = !URL_SET ? "no DATABASE_URL"
  : HOSTED ? "DATABASE_URL is a hosted Supabase database; scratch Postgres only"
  : false;

const RUN = `pgmeta${Date.now().toString(36)}`;
const SID = `${RUN}-sess`;

describe("Meta hook queries — real events table", { skip: SKIP }, () => {
  let org;

  async function insert(name, key, payload, age = "0 seconds") {
    const r = await db.query(
      `INSERT INTO events (org_id, name, idempotency_key, payload, created_at)
       VALUES ($1, $2, $3, $4, now() - $5::interval) RETURNING id`,
      [org, name, key, payload, age]
    );
    return r.rows[0].id;
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
  });

  after(async () => {
    await db.query(`DELETE FROM events WHERE org_id = $1 AND idempotency_key LIKE $2`, [org, `${RUN}:%`]);
    await close();
  });

  test("the result lands as payload.meta; the rest of the row is kept", async () => {
    const id = await insert("funnel.survey_answer", `${RUN}:r1`, { session_id: SID, event: "survey_answer", cf_contact: { ok: true } });
    await db.query(RECORD_META_SQL, [{ meta: { sent: 1, event_name: "Lead", event_id: `${SID}.1` } }, id]);
    const p = (await db.query(`SELECT payload FROM events WHERE id = $1`, [id])).rows[0].payload;
    assert.deepEqual(p.meta, { sent: 1, event_name: "Lead", event_id: `${SID}.1` });
    assert.equal(p.event, "survey_answer");
    assert.deepEqual(p.cf_contact, { ok: true });
  });
});
