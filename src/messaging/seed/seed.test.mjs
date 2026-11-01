// Seeder + workflow-audit tests. No Postgres required: seedTemplates() takes the
// src/db.mjs { query } interface, so a fake stands in for it here.
//
// The live-Postgres check lives in seed.pg.test.mjs and self-skips.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { seedTemplates, countByChannel } from "./seed.mjs";
import { formatReport } from "./report.mjs";
import {
  stringLiterals,
  findTemplateKeyRefs,
  findHardcodedCopy,
  findUntemplatedOutboundInserts,
  listWorkflowFiles,
  auditWorkflows,
} from "./workflow-audit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A fake db that behaves like the upsert: first write of a key inserts, later
// writes of the same key update.
function fakeDb({ orgSlug = "fundhub" } = {}) {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const [templateKey, channel, subject, body, compliancePassed, sourceDoc, slug] = params;
      if (slug !== orgSlug) return { rows: [] }; // org not found
      const inserted = !rows.has(templateKey);
      rows.set(templateKey, { templateKey, channel, subject, body, compliancePassed, sourceDoc });
      return { rows: [{ inserted }] };
    },
  };
}

const TPL = [
  { templateKey: "SMS-A", channel: "sms", subject: null, body: "one", compliancePassed: true, sourceDoc: "a.md" },
  { templateKey: "EM-A", channel: "email", subject: "S", body: "two", compliancePassed: false, sourceDoc: "b.md" },
];

// -------------------------------------------------------------------- upsert

test("seedTemplates: writes one row per template and reports inserted/updated", async () => {
  const db = fakeDb();
  const r = await seedTemplates(db, TPL);
  assert.deepEqual(r, { inserted: 2, updated: 0, total: 2 });
  assert.equal(db.rows.size, 2);
});

test("seedTemplates: re-running is idempotent — no new rows, all updates", async () => {
  const db = fakeDb();
  await seedTemplates(db, TPL);
  const again = await seedTemplates(db, TPL);
  assert.deepEqual(again, { inserted: 0, updated: 2, total: 2 });
  assert.equal(db.rows.size, 2);
});

test("seedTemplates: a changed doc overwrites the stored copy on re-run", async () => {
  const db = fakeDb();
  await seedTemplates(db, TPL);
  await seedTemplates(db, [{ ...TPL[0], body: "edited in the doc" }]);
  assert.equal(db.rows.get("SMS-A").body, "edited in the doc");
});

test("seedTemplates: the SQL is an upsert on (org_id, template_key)", async () => {
  const db = fakeDb();
  await seedTemplates(db, TPL);
  const { sql } = db.calls[0];
  assert.match(sql, /ON CONFLICT \(org_id, template_key\) DO UPDATE/);
  assert.match(sql, /INSERT INTO message_templates/);
  assert.match(sql, /source_doc/);
});

test("seedTemplates: subject is null for sms and carried for email", async () => {
  const db = fakeDb();
  await seedTemplates(db, TPL);
  assert.equal(db.rows.get("SMS-A").subject, null);
  assert.equal(db.rows.get("EM-A").subject, "S");
});

test("seedTemplates: a missing org fails loudly instead of writing nothing quietly", async () => {
  const db = fakeDb({ orgSlug: "somebody-else" });
  await assert.rejects(() => seedTemplates(db, TPL), /org 'fundhub' not found/);
});

test("countByChannel: counts per channel", () => {
  assert.deepEqual(countByChannel(TPL), { sms: 1, email: 1 });
});

// ------------------------------------------------------------ string scanner

test("stringLiterals: prose inside // and /* */ comments is not a literal", () => {
  const found = stringLiterals(`
    // they must not mint a client — don't do it
    /* a block comment with "quotes" inside */
    const a = "real literal";
  `).map((l) => l.value);
  assert.deepEqual(found, ["real literal"]);
});

test("stringLiterals: handles all three quote styles and escapes", () => {
  const found = stringLiterals(`const a='x'; const b="y\\"z"; const c=\`t\`;`).map((l) => l.value);
  assert.deepEqual(found, ["x", 'y"z', "t"]);
});

test("stringLiterals: reports the line a literal starts on", () => {
  const lits = stringLiterals('\n\nconst a = "hi";');
  assert.equal(lits[0].line, 3);
});

// -------------------------------------------------------------- key refs

test("findTemplateKeyRefs: finds explicit template_key / renderTemplate references", () => {
  const src = `
    await send({ template_key: "SMS-F03-01-ROUND-SUBMITTED" });
    renderTemplate("AR-PP1");
    const t = { templateKey: 'F-02' };
  `;
  assert.deepEqual(findTemplateKeyRefs(src).map((r) => r.key).sort(), [
    "AR-PP1",
    "F-02",
    "SMS-F03-01-ROUND-SUBMITTED",
  ]);
});

test("findTemplateKeyRefs: finds SMS-shaped keys anywhere, ignores comments", () => {
  const src = `// SMS-GHOST-99-IN-A-COMMENT\nconst k = "SMS-S04-01-CONFIRM";`;
  assert.deepEqual(findTemplateKeyRefs(src).map((r) => r.key), ["SMS-S04-01-CONFIRM"]);
});

test("auditWorkflows: a referenced key with no row is reported as dangling", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
  fs.mkdirSync(path.join(dir, "src/workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src/workflows/f03.mjs"),
    `export const step = { template_key: "SMS-F03-01-ROUND-SUBMITTED" };\n` +
      `export const bad = { template_key: "SMS-DOES-NOT-EXIST" };\n`
  );
  const r = auditWorkflows(["SMS-F03-01-ROUND-SUBMITTED"], { root: dir });
  assert.deepEqual(r.danglingKeys.map((d) => d.templateKey), ["SMS-DOES-NOT-EXIST"]);
  assert.deepEqual(r.scannedFiles, [path.join("src", "workflows", "f03.mjs")]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------- hardcoded copy

test("findHardcodedCopy: a literal with merge tags is copy", () => {
  const hits = findHardcodedCopy(`const m = "Hey {{contact.first_name}}, your round is live.";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].why, "contains merge tags");
});

test("findHardcodedCopy: a literal bound into a copy column of messages/tasks is copy", () => {
  const src = `
    await db.query(
      \`INSERT INTO tasks (org_id, client_id, title, body, due_at, source_workflow)
       VALUES ($1,$2,$3,$4,$5,'clickfunnels')\`,
      [event.orgId, clientId, "Strategy session booked", uid, p.startTime || null]
    );
  `;
  const hits = findHardcodedCopy(src);
  assert.deepEqual(hits.map((h) => h.text), ["Strategy session booked"]);
  assert.match(hits[0].why, /^bound into tasks/);
});

test("findHardcodedCopy: enum-ish bound params are not mistaken for copy", () => {
  const src = `
    await db.query(
      \`INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, status)
       VALUES ($1,$2,'outbound',$3,$4,$5,$6)\`,
      [orgId, clientId, "sms", body, "twilio", "sent"]
    );
  `;
  assert.deepEqual(findHardcodedCopy(src), []);
});

test("findHardcodedCopy: the SQL itself is never reported as copy", () => {
  const src = "await db.query(`SELECT id FROM clients WHERE org_id=$1 LIMIT 1`, [orgId]);";
  assert.deepEqual(findHardcodedCopy(src), []);
});

test("findHardcodedCopy: prose in a comment is not reported", () => {
  const src = `// Creates a closer follow-up task, deduped by (client, uid).\nconst x = 1;`;
  assert.deepEqual(findHardcodedCopy(src), []);
});

test("findUntemplatedOutboundInserts: flags outbound message rows with no template_key", () => {
  const outbound = "`INSERT INTO messages (org_id, direction, rendered_body) VALUES ($1,'outbound',$2)`";
  assert.equal(findUntemplatedOutboundInserts(outbound).length, 1);
});

test("findUntemplatedOutboundInserts: inbound rows and templated rows are exempt", () => {
  const inbound = "`INSERT INTO messages (org_id, direction, rendered_body) VALUES ($1,'inbound',$2)`";
  const templated = "`INSERT INTO messages (org_id, direction, template_key, rendered_body) VALUES ($1,'outbound',$2,$3)`";
  assert.deepEqual(findUntemplatedOutboundInserts(inbound), []);
  assert.deepEqual(findUntemplatedOutboundInserts(templated), []);
});

test("listWorkflowFiles: skips test files and the seeder's own directory", () => {
  const files = listWorkflowFiles();
  assert.ok(files.length > 0);
  assert.ok(!files.some((f) => f.endsWith(".test.mjs")));
  assert.ok(!files.some((f) => f.startsWith(path.join("src", "messaging", "seed"))));
});

// ------------------------------------------------------------------- report

test("formatReport: renders every required section, including the empty ones", () => {
  const text = formatReport({
    docsDir: "/docs",
    perDoc: [{ file: "a.md", note: "n", found: 2, expected: 2 }],
    seedable: TPL,
    byChannel: countByChannel(TPL),
    problems: { emptyBody: [], duplicates: [], keyHygiene: [] },
    mergeTags: [{ tag: "contact.first_name", count: 3, channels: ["sms"], templateKeys: ["SMS-A"] }],
    audit: { scannedFiles: ["src/handlers/comms.mjs"], danglingKeys: [], hardcodedCopy: [], untemplatedOutbound: [] },
    write: { inserted: 2, updated: 0, total: 2 },
  });
  assert.match(text, /sms\s+1 rows/);
  assert.match(text, /email\s+1 rows/);
  assert.match(text, /EMPTY BODIES — not seeded/);
  assert.match(text, /none — every parsed template has a body/);
  assert.match(text, /MERGE TAGS — 1 distinct/);
  assert.match(text, /\{\{contact\.first_name\}\}/);
  assert.match(text, /template keys referenced but not seeded/);
  assert.match(text, /copy still hardcoded in workflow files/);
});

test("formatReport: flags a doc whose count differs from what its header claims", () => {
  const text = formatReport({
    docsDir: "/docs",
    perDoc: [{ file: "a.md", note: "n", found: 8, expected: 11 }],
    seedable: [],
    byChannel: {},
    problems: { emptyBody: [], duplicates: [], keyHygiene: [] },
    mergeTags: [],
    audit: { scannedFiles: [], danglingKeys: [], hardcodedCopy: [], untemplatedOutbound: [] },
    write: null,
  });
  assert.match(text, /⚠ doc header says 11/);
});

test("formatReport: an empty body is listed, never summarised away", () => {
  const text = formatReport({
    docsDir: "/docs",
    perDoc: [],
    seedable: [],
    byChannel: {},
    problems: {
      emptyBody: [{ templateKey: "SMS-BROKEN-01", channel: "sms", sourceDoc: "a.md", label: "SMS-BROKEN-01" }],
      duplicates: [],
      keyHygiene: [],
    },
    mergeTags: [],
    audit: { scannedFiles: [], danglingKeys: [], hardcodedCopy: [], untemplatedOutbound: [] },
    write: null,
  });
  assert.match(text, /✗ SMS-BROKEN-01 {2}\[sms\] {2}a\.md/);
});

// ------------------------------------------------- the real docs, if present

test("the real source docs parse to the counts the docs themselves claim", async (t) => {
  const { findDocsDir, collect } = await import("./collect.mjs");
  // A value, not an exception: catching everything here would have turned a real
  // resolver bug into a silent skip.
  const docsDir = findDocsDir();
  if (!docsDir) {
    t.skip("fundhub-docs not checked out next to this repo");
    return;
  }
  const { perDoc, seedable, problems } = collect(docsDir);
  const byFile = Object.fromEntries(perDoc.map((d) => [d.file, d.found]));
  assert.equal(byFile["SMS-TEMPLATES-CURRENT.md"], 26);
  assert.equal(byFile["EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"], 162);
  assert.equal(problems.emptyBody.length, 0);
  assert.equal(new Set(seedable.map((x) => x.templateKey)).size, seedable.length);
  assert.ok(seedable.some((x) => x.templateKey === "SMS-F03-01-ROUND-SUBMITTED"));
  const f03 = seedable.find((x) => x.templateKey === "SMS-F03-01-ROUND-SUBMITTED");

  /* Copy is verbatim: the parsed body must survive the parser exactly as
     written in the source doc.

     This used to assert the opening sentence as a hardcoded string
     ("Fundhub update, ..."). The copy was rewritten on 2026-08-21 to
     "Update from Chris, ..." and this line was not, so it sat red ever after -
     the parser was fine and the sentence describing it was stale. A test that
     pins marketing copy breaks every time marketing copy changes, which trains
     everyone to ignore it.

     So: prove the property instead of the wording. The parsed body must appear
     character-for-character inside the raw source file. That is exactly what
     "verbatim" means, and a copy edit can no longer break it - only the parser
     mangling text can. */
  const rawSms = fs.readFileSync(path.join(docsDir, "SMS-TEMPLATES-CURRENT.md"), "utf8");
  assert.ok(
    rawSms.includes(f03.body),
    "the parsed body must appear verbatim in the source doc - the parser altered the copy"
  );

  /* The opt-out line is a compliance requirement, not copy, so it IS pinned. */
  assert.ok(f03.body.endsWith("Reply STOP to opt out."));
  assert.equal(f03.compliancePassed, true);

  const noShow = seedable.find((x) => x.templateKey === "SMS-S05A-NOSHOW-RECOVERY");
  assert.ok(noShow, "the missed-call text must remain in the source doc");
  assert.doesNotMatch(noShow.body, /appointment\.start_time|at \./);
  const restore = fs.readFileSync(path.join(HERE, "..", "..", "..", "db", "seed", "300_sms_noshow_copy_restore.sql"), "utf8");
  assert.ok(restore.includes(noShow.body), "the live copy restore must match future source-doc reseeds");
});
