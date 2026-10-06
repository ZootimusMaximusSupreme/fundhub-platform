// Guard: a test must not leave message_channel_routing pointing at `memory`
// on a real (non-test) org — and must not UPDATE shared routing without a
// teardown that puts it back.
//
// WHY THIS IS NAMED *.test.mjs AND NOT *.pg.test.mjs
//
// Same reason as src/security/superuser-guard.test.mjs: a guard that skips
// itself when DATABASE_URL is unset would be green on precisely the laptop
// run that silently rewrote production routing last time. The static half
// of this file always runs. The runtime half skips only when there is no
// database to ask.
//
// TWO CHECKS.
//
// 1. STATIC. Any test file that UPDATEs message_channel_routing (the shape
//    that rewrites an existing org's provider) must also restore in an
//    after() hook — either by writing the saved rows back, or by deleting a
//    dedicated test org's rows. INSERT…memory for a suite-owned org is fine;
//    UPDATE of a shared org without restore is not.
//
// 2. RUNTIME (DATABASE_URL). The default org's seeded providers must not be
//    `memory`. That is the smoking gun of an unrestored mutation against a
//    shared database.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const TEST_SLUG_MARKERS = [
  "-pg-test",
  "-test-co",
  "pg-test",
  "test-co",
  "acceptance-pg",
  "outbox-test",
  "ctnotify-test",
  "compose-pg-test",
  "staff-sweeper-pg-test",
  "reply-inbox-acceptance-pg"
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".test.mjs") || name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

/** Strip block and line comments so a restore living only in a comment does
    not count. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* THE OFFENCE CANNOT BE ITS OWN ALIBI (walkthrough-4 defect 22, 2026-09-06).
   The old check flagged `UPDATE message_channel_routing SET provider` and then
   accepted `... SET provider = $` as the restore — the same line of ordinary
   parameterised SQL — so a test that repointed routing and never put it back
   stayed green. It also only saw `provider` as the FIRST column after SET.

   Now: the offence is any UPDATE of the table whose SET list names provider.
   A restore is a DELETE of the org's rows, destroyMemoryRoutedOrg(), a saved
   copy (savedRouting), or a SECOND provider UPDATE that sits after a teardown
   (after(, afterEach( or finally {). One UPDATE alone never restores itself. */
const PROVIDER_UPDATE = /UPDATE\s+message_channel_routing\s+SET\b[^`;'"]*?\bprovider\s*=/gi;
const TEARDOWN = /\bafter(Each)?\s*\(|\bfinally\s*\{/g;

export function routingOffence(src) {
  const updates = [...src.matchAll(PROVIDER_UPDATE)].map((m) => m.index);
  if (!updates.length) return false;
  if (/DELETE\s+FROM\s+message_channel_routing\s+WHERE\s+org_id/i.test(src) ||
      /destroyMemoryRoutedOrg\s*\(/.test(src) ||
      /savedRouting/.test(src)) return false;
  const teardowns = [...src.matchAll(TEARDOWN)].map((m) => m.index);
  const restoredInTeardown = updates.length >= 2 &&
    updates.slice(1).some((u) => teardowns.some((t) => t < u));
  return !restoredInTeardown;
}

test("the routing check itself: one UPDATE is never its own restore", () => {
  const set = "await db.query(`UPDATE message_channel_routing SET provider = $2 WHERE org_id = $1`, [org, 'memory']);";
  assert.equal(routingOffence(set), true, "a lone parameterised provider UPDATE must be flagged");
  assert.equal(routingOffence("db.query(`UPDATE message_channel_routing SET enabled = false, provider = 'memory' WHERE org_id = $1`)"), true,
    "provider later in the SET list must be seen");
  assert.equal(routingOffence(set + "\nafter(async () => { " + set.replace("'memory'", "saved") + " });"), false,
    "an UPDATE in the test plus one in after() is a restore");
  assert.equal(routingOffence(set + "\nafter(async () => { await db.query(`DELETE FROM message_channel_routing WHERE org_id = $1`, [org]); });"), false,
    "deleting the suite org's rows is a restore");
  assert.equal(routingOffence("db.query(`UPDATE message_channel_routing SET enabled = false WHERE org_id = $1`)"), false,
    "an UPDATE that does not touch provider is not this offence");
});

test("no test UPDATEs message_channel_routing without restoring it", () => {
  const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))];
  const offenders = [];

  for (const file of files) {
    // This guard file mentions the UPDATE shape in comments and strings —
    // exclude itself.
    if (file.endsWith("routing-restore.guard.test.mjs")) continue;

    const raw = fs.readFileSync(file, "utf8");
    const src = stripComments(raw);

    // The dangerous shape: UPDATE an existing routing row's provider.
    // INSERT … memory for a suite-owned org is the approved pattern and is
    // not matched here.
    if (routingOffence(src)) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these test files UPDATE message_channel_routing.provider and never restore " +
      "it in after(). Against a shared (or production) database that silently " +
      "repoints live message routing at a no-op provider:\n  " +
      offenders.join("\n  ")
  );
});

test("default org message_channel_routing is not left on the memory provider",
  { skip: !process.env.DATABASE_URL ? "no DATABASE_URL" : false },
  async () => {
    const { db, close } = await import("../db.mjs");
    try {
      const { rows } = await db.query(
        `SELECT channel, provider
           FROM message_channel_routing
          WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
          ORDER BY channel`
      );
      assert.ok(rows.length > 0, "default org has no message_channel_routing rows — seed missing?");
      const memory = rows.filter((r) => r.provider === "memory");
      assert.deepEqual(
        memory,
        [],
        "default org message_channel_routing still has provider='memory' after the " +
          "suite. A test mutated shared routing and did not restore it. Channels: " +
          memory.map((r) => r.channel).join(", ")
      );

      // Soft check: known seed defaults. An intentional cutover to twilio is
      // fine; memory is never a legitimate live provider for the default org.
      for (const row of rows) {
        assert.notEqual(
          row.provider,
          "memory",
          `default org ${row.channel} routed to memory`
        );
      }
    } finally {
      await close();
    }
  }
);

test("non-test orgs do not route any channel to memory",
  { skip: !process.env.DATABASE_URL ? "no DATABASE_URL" : false },
  async () => {
    const { db, close } = await import("../db.mjs");
    try {
      const { rows } = await db.query(
        `SELECT o.slug, o.is_default, r.channel, r.provider
           FROM message_channel_routing r
           JOIN orgs o ON o.id = r.org_id
          WHERE r.provider = 'memory'`
      );
      const leaked = rows.filter((r) => {
        if (r.is_default) return true;
        const slug = String(r.slug || "");
        return !TEST_SLUG_MARKERS.some((m) => slug.includes(m));
      });
      assert.deepEqual(
        leaked,
        [],
        "message_channel_routing has provider='memory' on an org that does not " +
          "look like a test fixture. That is the permanent-repoint failure mode:\n" +
          leaked.map((r) => `  ${r.slug} ${r.channel}`).join("\n")
      );
    } finally {
      await close();
    }
  }
);

after(async () => {
  // close() is called inside the runtime tests; nothing else to tear down.
});
