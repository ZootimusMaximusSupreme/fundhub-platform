import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SEED = new URL("../../db/seed/305_containment_plain_survey_copy.sql", import.meta.url);
const KEYS = [
  "SMS-S00-WELCOME", "EMAIL-S00-WELCOME",
  "SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1",
  "SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2",
  "SMS-S02-RESUME-3", "EMAIL-S02-RESUME-3"
];
const OLD = [
  "Get pulled away? This link saves your spot: {{survey_resume_link}}",
  "This button opens your questions right where you left off. {{survey_resume_link}}",
  "You stopped at {{survey_stopped_at}}. {{survey_taps_left}} {{survey_resume_link}}",
  "<title>Pick up where you stopped</title> Your answers are saved. No starting over. The button below picks up at {{survey_stopped_at}}. Pick up where I stopped {{survey_resume_link}}",
  "You're {{survey_taps_left}} away. {{survey_resume_link}}",
  "That starts with your questions. You're {{survey_taps_left}} away. {{survey_resume_link}}",
  "Your link still drops you right back where you were: {{survey_resume_link}}",
  "If funding is still on your list, it's {{survey_taps_left}}, then you pick a call time. {{survey_resume_link}}"
];

test("seed 302 makes every S-00/S-02 template neutral and clears old body approvals", { skip: !HAS_DB }, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const org = (await conn.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Containment Copy Test') RETURNING id`,
      [`containment-copy-${randomUUID()}`]
    )).rows[0].id;
    for (let i = 0; i < KEYS.length; i++) {
      await conn.query(
        `INSERT INTO message_templates
           (org_id, template_key, channel, subject, body, compliance_passed, approved_at, approved_body_sha)
         VALUES ($1,$2,$3,$4,$5,true,now(),'previous-approved-body')`,
        [org, KEYS[i], KEYS[i].startsWith("SMS") ? "sms" : "email", KEYS[i].startsWith("EMAIL") ? "Old subject" : null, OLD[i]]
      );
    }
    const sql = await readFile(SEED, "utf8");
    await conn.query(sql);
    const first = (await conn.query(
      `SELECT template_key, body, subject, approved_by, approved_at, approved_body_sha
         FROM message_templates WHERE org_id = $1 AND template_key = ANY($2) ORDER BY template_key`,
      [org, KEYS]
    )).rows;
    assert.equal(first.length, 8);
    for (const row of first) {
      assert.ok(row.body.includes("https://apply.fundhub.ai/apply"), row.template_key);
      assert.doesNotMatch(row.body, /\{\{survey_(?:resume_link|stopped_at|taps_left)\}\}/);
      assert.doesNotMatch(row.body, /right where you left off|right back where you were|pick up where you stopped|no starting over/i);
      assert.equal(row.approved_by, null);
      assert.equal(row.approved_at, null);
      assert.equal(row.approved_body_sha, null);
      if (row.template_key.startsWith("SMS")) {
        assert.doesNotMatch(row.body, /\{\{contact\.|stopped at|taps left|more taps/i);
      }
    }
    await conn.query(sql);
    const second = (await conn.query(
      `SELECT template_key, body, subject FROM message_templates WHERE org_id = $1 AND template_key = ANY($2) ORDER BY template_key`,
      [org, KEYS]
    )).rows;
    assert.deepEqual(second, first.map(({ template_key, body, subject }) => ({ template_key, body, subject })),
      "the seed is safe to apply again");
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
    await close();
  }
});
