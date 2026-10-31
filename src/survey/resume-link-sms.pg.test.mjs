// No text template names the come-back link (review 2026-10-31).
//
// {{survey_resume_link}} is a bearer link: it opens the person's saved answers at
// /api/public/survey-resume. The public /apply form can put any phone on an existing
// lead's email, so a text can reach someone else; the email address is the lead's
// identity. So the link goes in email only. sendTemplated already drops the tag from
// every text (src/workflows/messaging.mjs); this test keeps the words honest too, so no
// text promises a link it will never show. It reads the templates after every
// migration and seed has run, the way production holds them.
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

test("the come-back emails still carry the link, so a person can pick up where they stopped", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT DISTINCT template_key FROM message_templates
      WHERE template_key = ANY($2::text[]) AND body LIKE '%{{' || $1 || '}}%'
      ORDER BY 1`, [RESUME_LINK_TAG, ["EMAIL-S02-RESUME-1", "EMAIL-S02-RESUME-2", "EMAIL-S02-RESUME-3"]]);
  assert.deepEqual(rows.map((r) => r.template_key), ["EMAIL-S02-RESUME-1", "EMAIL-S02-RESUME-2", "EMAIL-S02-RESUME-3"]);
});
