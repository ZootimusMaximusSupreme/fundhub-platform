// Real-Postgres integration test for the message_templates seeder.
// Runs ONLY on a local scratch database (127.0.0.1/localhost, name with ci, test or
// scratch) and only with fundhub-docs present. Anything else skips.
//
// Defect (2026-10-20): this file used to DELETE every template of the 'fundhub' org
// whenever DATABASE_URL was set. Run against production it wiped 137 live seeded
// templates (welcome email and text, booking confirm, contract email, document asks).
// It now seeds a throwaway org of its own and never touches Fundhub's rows.
//
// Proves what the unit tests cannot: the upsert actually round-trips against the
// real schema, re-running converges instead of duplicating, and the copy that
// lands in Postgres is byte-identical to the source doc.
//
// Requires: npm run migrate (which applies db/seed/006_message_templates_source_doc.sql).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, close } from "../../db.mjs";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { collect, findDocsDir } from "./collect.mjs";
import { seedTemplates } from "./seed.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
// findDocsDir() returns null rather than throwing, so "the sibling repo is not
// cloned" is expressed as a value. The previous try/catch around resolveDocsDir()
// swallowed EVERY error into a skip, which would have hidden a real bug in the
// resolver as "nothing to test".
const docsDir = findDocsDir();
const RUN = isLocalScratchDatabaseUrl(process.env.DATABASE_URL) && !!docsDir;
const ORG_SLUG = `message-seed-pg-${randomUUID()}`;

let seedable = [];
let orgId = null;

before(async () => {
  if (!RUN) return;
  seedable = collect(docsDir).seedable;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Message Seeder PG Test') RETURNING id`,
    [ORG_SLUG]
  )).rows[0].id;
});

after(async () => {
  if (orgId) {
    await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  }
  if (HAS_DB) await close();
});

test("seeds every parsed template into a real message_templates table", { skip: !RUN }, async () => {
  const r = await seedTemplates(db, seedable, { orgSlug: ORG_SLUG });
  assert.equal(r.inserted, seedable.length);
  assert.equal(r.updated, 0);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1`, [orgId]);
  assert.equal(rows[0].n, seedable.length);
});

test("re-running is idempotent — same row count, all updates, no duplicates", { skip: !RUN }, async () => {
  const before2 = (await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1`, [orgId])).rows[0].n;
  const r = await seedTemplates(db, seedable, { orgSlug: ORG_SLUG });
  const after2 = (await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1`, [orgId])).rows[0].n;
  assert.equal(r.inserted, 0);
  assert.equal(r.updated, seedable.length);
  assert.equal(after2, before2);
});

test("an edited doc body overwrites the stored row rather than adding one", { skip: !RUN }, async () => {
  const key = seedable[0].templateKey;
  const before2 = (await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1`, [orgId])).rows[0].n;
  await seedTemplates(db, [{ ...seedable[0], body: "EDITED IN THE DOC" }], { orgSlug: ORG_SLUG });
  const row = await db.query(`SELECT body FROM message_templates WHERE org_id = $1 AND template_key = $2`, [orgId, key]);
  assert.equal(row.rows[0].body, "EDITED IN THE DOC");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1`, [orgId])).rows[0].n, before2);
  await seedTemplates(db, [seedable[0]], { orgSlug: ORG_SLUG }); // restore
});

test("channel split and compliance flags land as specified", { skip: !RUN }, async () => {
  const { rows } = await db.query(
    `SELECT channel,
            count(*)::int AS n,
            count(*) FILTER (WHERE compliance_passed)::int AS compliant,
            count(*) FILTER (WHERE subject IS NOT NULL)::int AS with_subject
       FROM message_templates WHERE org_id = $1 GROUP BY channel ORDER BY channel`,
    [orgId]
  );
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
  // The audited SMS are all compliance_passed; the emails are all unaudited.
  assert.equal(byChannel.sms.compliant, byChannel.sms.n);
  assert.equal(byChannel.sms.with_subject, 0);
  assert.equal(byChannel.email.compliant, 0);
  assert.equal(byChannel.email.with_subject, byChannel.email.n);
});

test("no row was seeded with an empty body", { skip: !RUN }, async () => {
  const { rows } = await db.query(`SELECT template_key FROM message_templates WHERE org_id = $1 AND btrim(body) = ''`, [orgId]);
  assert.deepEqual(rows, []);
});

test("stored copy is byte-identical to the source doc — nothing was rewritten", { skip: !RUN }, async () => {
  const cache = new Map();
  const docText = (sourceDoc) => {
    if (!cache.has(sourceDoc)) {
      cache.set(sourceDoc, fs.readFileSync(path.join(docsDir, path.basename(sourceDoc)), "utf8"));
    }
    return cache.get(sourceDoc);
  };

  const { rows } = await db.query(`SELECT template_key, channel, subject, body, source_doc FROM message_templates WHERE org_id = $1`, [orgId]);
  const mismatched = [];
  for (const r of rows) {
    const doc = docText(r.source_doc);
    // Email bodies are contiguous doc lines; SMS bodies had their "> " markers
    // stripped, so they are checked line by line.
    const ok =
      r.channel === "email"
        ? doc.includes(r.body) && doc.includes(r.subject)
        : r.body.split("\n").every((line) => doc.includes(line));
    if (!ok) mismatched.push(r.template_key);
  }
  assert.deepEqual(mismatched, []);
});

test("source_doc is recorded for every row", { skip: !RUN }, async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1 AND source_doc IS NULL`, [orgId]);
  assert.equal(rows[0].n, 0);
});
