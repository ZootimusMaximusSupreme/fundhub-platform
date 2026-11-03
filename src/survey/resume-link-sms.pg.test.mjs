// Seed 302 stores a plain /apply URL. At send time, approved come-back emails
// replace it with an email-bound saved-answer link; SMS stays on plain /apply.
// Read actual template rows after all migrations and seeds, as production holds them.
import { test, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { RESUME_BASE_URL, RESUME_LINK_TAG } from "./resume-link.mjs";
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

test("seeded come-back emails keep the plain link for the send-time resume transform", { skip: !HAS_DB }, async () => {
  const keys = ["EMAIL-S02-RESUME-1", "EMAIL-S02-RESUME-2", "EMAIL-S02-RESUME-3"];
  const { rows } = await db.query(
    `SELECT DISTINCT template_key, channel, body FROM message_templates
      WHERE template_key = ANY($1::text[])
      ORDER BY 1`, [keys]);
  assert.deepEqual([...new Set(rows.map((r) => r.template_key))], keys);
  for (const row of rows) {
    assert.equal(row.channel, "email", row.template_key);
    assert.ok(row.body.includes(RESUME_BASE_URL), `${row.template_key}: the plain fallback link is missing`);
    assert.doesNotMatch(row.body, /\?r=|\{\{survey_resume_link\}\}/,
      `${row.template_key}: codes are rendered per lead, not stored in templates`);
  }
});
