// Survey containment (2026-10-31): the come-back emails and texts open plain /apply.
// No saved-answer bearer code is sent; the survey starts at the first question.
// Seed 302 replaces the old email resume placeholder with the literal public URL.
// The SMS placeholder guard remains: sendTemplated also drops that tag from texts.
// Read actual template rows after all migrations and seeds, as production holds them.
import { test, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { RESUME_LINK_TAG } from "./resume-link.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);

after(async () => { if (HAS_DB) await close(); });

test("no text template names the come-back link, after every migration and seed", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT DISTINCT template_key FROM message_templates
      WHERE (channel = 'sms' OR template_key LIKE 'SMS-%')
        AND body LIKE '%{{' || $1 || '}}%'
      ORDER BY 1`, [RESUME_LINK_TAG]);
  assert.deepEqual(rows.map((r) => r.template_key), []);
});

test("the come-back emails render a resume tag while texts stay plain", { skip: !HAS_DB }, async () => {
  const keys = ["EMAIL-S02-RESUME-1", "EMAIL-S02-RESUME-2", "EMAIL-S02-RESUME-3"];
  const { rows } = await db.query(
    `SELECT DISTINCT template_key, channel, body FROM message_templates
      WHERE template_key = ANY($1::text[])
      ORDER BY 1`, [keys]);
  assert.deepEqual([...new Set(rows.map((r) => r.template_key))], keys);
  for (const row of rows) {
    assert.equal(row.channel, "email", row.template_key);
    assert.ok(row.body.includes(`{{${RESUME_LINK_TAG}}}`), `${row.template_key}: the email resume tag is missing`);
    assert.doesNotMatch(row.body, /\?r=/, `${row.template_key}: codes are rendered per lead, not stored in templates`);
  }
});
