// The script machine's data layer (migrations 413 and 414), against real
// Postgres (DATABASE_URL). Spec docs/specs/marketing-machine-2026-10-04.md §7.4,
// plan unit U11.
//
// WHAT THIS PROVES
//   * 413's backfill, run VERBATIM from the migration file (the block between
//     its BEGIN/END U11 BACKFILL markers) against rows shaped like the ones on
//     production before 413: archived → superseded, numbered → locked, the rest
//     draft, every one source 'import', root = the first version of its chain,
//     and updated_at left alone.
//   * Every old writer still works: an insert that names no status, source or
//     root lands as a draft by chris that is its own root.
//   * A rewrite inherits its parent's root; a locked script must carry a number;
//     a script has one live version and uses each version number once.
//   * next_ad_number(): 91 above 90, floor 91 on an empty org, distinct numbers
//     for two transactions that ask at the same moment, non-number text ignored,
//     works with or without marketing_settings, EXECUTE for fundhub_app only.
//   * 414's tables refuse the shapes the spec rules out.
//
// HOW IT STAYS OUT OF EVERYBODY ELSE'S WAY. Every row lives in this file's own
// org (slug below), so the numbers it asserts cannot be moved by another
// suite's scripts in the default org. Almost every test runs inside ONE
// transaction that is rolled back, so it leaves nothing behind; the two DDL
// tricks (switching the root trigger off, dropping the ad_id shape check) are
// rolled back with it. *.pg.test.mjs files run one at a time
// (scripts/run-suite.mjs, --test-concurrency=1), so a short ALTER TABLE inside
// a rolled-back transaction blocks nobody. Needs the table owner, which is the
// connection CI's suite uses.
//
// The concurrency test is the one that commits; after() deletes its rows.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { db, pool, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "zz-u11-ad-scripts-machine-test";
const PARTNER_SLUG = "zz-u11-house";
const MIGRATION_413 = new URL("../../db/migrations/413_ad_scripts_machine_columns.sql", import.meta.url);

/* The backfill exactly as 413 runs it. If the markers move or vanish this
   fails loudly rather than testing a copy that drifted. */
function backfillSql() {
  const sql = readFileSync(MIGRATION_413, "utf8");
  const start = sql.indexOf("-- BEGIN U11 BACKFILL");
  const end = sql.indexOf("-- END U11 BACKFILL");
  assert.ok(start >= 0 && end > start, "413 lost its BEGIN/END U11 BACKFILL markers");
  return sql.slice(start, end);
}

/* One connection, one transaction, acting as staff (ad_scripts forces partner
   row security, 377 Part 4e). Rolled back unless commit is asked for. */
async function inTx(fn, { commit = false, isolation = null } = {}) {
  const client = await pool().connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : "BEGIN");
    await client.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const out = await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the first error is the one worth throwing */ }
    throw err;
  } finally {
    client.release();
  }
}

/* An error that came from Postgres naming the constraint it hit. */
const pgErr = (code, constraint) => (err) => {
  assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${err.code}: ${err.message}`);
  if (constraint) assert.equal(err.constraint, constraint, err.message);
  return true;
};

describe("ad_scripts machine data (413, 414)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner;

  /* insert — a script in this file's org. Only the columns the caller names are
     sent, so a call with none of the new ones is exactly an old-shape insert. */
  const insert = (c, fields = {}) => {
    const row = { org_id: org, partner_id: partner, body: "HOOK: they said no.\nCTA: book a call.", ...fields };
    const cols = Object.keys(row);
    return c.query(
      `INSERT INTO ad_scripts (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING *`,
      cols.map((k) => row[k])
    ).then((r) => r.rows[0]);
  };

  const archive = (c, id) => c.query(`UPDATE ad_scripts SET archived_at = now() WHERE id = $1`, [id]);
  const next = (c, o = org) => c.query(`SELECT next_ad_number($1) AS n`, [o]).then((r) => Number(r.rows[0].n));

  /* Leaves first: a row nothing else points at (as parent or root) can go. */
  async function purgeScripts() {
    await inTx(async (c) => {
      for (let i = 0; i < 20; i++) {
        const gone = await c.query(
          `DELETE FROM ad_scripts s
            WHERE s.org_id = $1
              AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                               WHERE k.id <> s.id
                                 AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`,
          [org]
        );
        if (!gone.rowCount) break;
      }
    }, { commit: true });
  }

  before(async () => {
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'U11 ad scripts machine test')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [ORG_SLUG]
    )).rows[0].id;
    const existing = (await db.query(
      `SELECT id FROM partners WHERE org_id = $1 AND slug = $2`, [org, PARTNER_SLUG]
    )).rows[0];
    partner = existing ? existing.id : (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1, 'U11 test house', $2) RETURNING id`,
      [org, PARTNER_SLUG]
    )).rows[0].id;
    await purgeScripts();
  });

  after(async () => {
    try {
      await purgeScripts();
      await db.query(`DELETE FROM partners WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [org]);
    } finally {
      await close();
    }
  });

  // ── 413: the backfill ──────────────────────────────────────────────────────

  test("the backfill: archived → superseded, numbered → locked, else draft; all import; root = first version; updated_at kept", async () => {
    await inTx(async (c) => {
      // Recreate the world before 413: rows with no root. The trigger is
      // switched off and NOT NULL dropped, inside this rolled-back transaction.
      await c.query(`ALTER TABLE ad_scripts DISABLE TRIGGER trg_ad_scripts_set_root`);
      await c.query(`ALTER TABLE ad_scripts ALTER COLUMN root_script_id DROP NOT NULL`);

      const old = "2026-09-24T12:00:00Z";
      const archivedPlain = await insert(c, { title: "archived, no number", archived_at: old, updated_at: old });
      // Archived wins over a number: the spec's order is archived first.
      const archivedNumbered = await insert(c, { title: "archived, numbered", ad_id: "88", archived_at: old, updated_at: old });
      const numbered = await insert(c, { title: "live, numbered", ad_id: "90", updated_at: old });
      const plain = await insert(c, { title: "live, no number", updated_at: old });
      // A chain of three: v1 and v2 archived, v3 live with a number.
      const v1 = await insert(c, { title: "chain v1", archived_at: old, updated_at: old });
      const v2 = await insert(c, { title: "chain v2", version: 2, parent_script_id: v1.id, archived_at: old, updated_at: old });
      const v3 = await insert(c, { title: "chain v3", version: 3, parent_script_id: v2.id, ad_id: "89", updated_at: old });

      for (const r of [archivedPlain, numbered, plain, v3]) {
        assert.equal(r.root_script_id, null, "the fixture row got a root before the backfill ran");
        assert.equal(r.status, "draft", "a pre-413 row should read as the column default before the backfill");
        assert.equal(r.source, "chris");
      }

      await c.query(backfillSql());

      const got = Object.fromEntries((await c.query(
        `SELECT id, status, source, root_script_id, updated_at FROM ad_scripts WHERE org_id = $1`, [org]
      )).rows.map((r) => [r.id, r]));

      const expect = [
        [archivedPlain, "superseded", archivedPlain.id],
        [archivedNumbered, "superseded", archivedNumbered.id],
        [numbered, "locked", numbered.id],
        [plain, "draft", plain.id],
        [v1, "superseded", v1.id],
        [v2, "superseded", v1.id],
        [v3, "locked", v1.id]
      ];
      for (const [row, status, root] of expect) {
        const g = got[row.id];
        assert.ok(g, `${row.title} vanished`);
        assert.equal(g.status, status, `${row.title}: status`);
        assert.equal(g.source, "import", `${row.title}: source`);
        assert.equal(g.root_script_id, root, `${row.title}: root`);
        assert.equal(new Date(g.updated_at).toISOString(), new Date(old).toISOString(),
          `${row.title}: the backfill moved updated_at — filling new columns is not an edit`);
      }

      // The stamp is switched back on after the block.
      const trig = (await c.query(
        `SELECT tgenabled FROM pg_trigger
          WHERE tgname = 'trg_ad_scripts_updated_at' AND tgrelid = 'public.ad_scripts'::regclass`
      )).rows[0];
      assert.equal(trig.tgenabled, "O", "413's backfill left the updated_at trigger switched off");

      // Every row now has a root, so 413 Part 5 succeeds.
      await c.query(`ALTER TABLE ad_scripts ALTER COLUMN root_script_id SET NOT NULL`);

      // A second run of the block changes nothing: only root-less rows are touched.
      const again = await c.query(backfillSql());
      const stillLocked = (await c.query(`SELECT status, source FROM ad_scripts WHERE id = $1`, [numbered.id])).rows[0];
      assert.equal(stillLocked.status, "locked");
      assert.ok(again, "the block ran twice");
    });
  });

  // ── 413: defaults and the root trigger ─────────────────────────────────────

  test("an insert in the old write.mjs shape lands as a draft by chris that is its own root", async () => {
    await inTx(async (c) => {
      const row = await insert(c, { title: "old shape" });
      assert.equal(row.status, "draft");
      assert.equal(row.source, "chris");
      assert.equal(row.root_script_id, row.id, "an original script must be its own root");
      assert.equal(row.needs_retake, false);
      for (const col of ["script_format", "style", "funnel_key", "batch_id", "idea_id", "parts",
                         "check_results", "fix_note", "animation_plan", "meta_copy", "film_order",
                         "locked_at", "locked_by", "rejected_at", "rejected_by", "rejected_reason",
                         "filmed_at", "repo_path", "repo_commit"]) {
        assert.strictEqual(row[col], null, `${col} must start NULL (unknown), got ${JSON.stringify(row[col])}`);
      }
    });
  });

  test("a rewrite takes its parent's root, all the way down a chain", async () => {
    await inTx(async (c) => {
      const v1 = await insert(c, { title: "v1" });
      await archive(c, v1.id);
      const v2 = await insert(c, { title: "v2", version: 2, parent_script_id: v1.id });
      assert.equal(v2.root_script_id, v1.id);
      await archive(c, v2.id);
      const v3 = await insert(c, { title: "v3", version: 3, parent_script_id: v2.id });
      assert.equal(v3.root_script_id, v1.id, "a grandchild must share version 1's root");
    });
  });

  test("a root the writer sends is kept", async () => {
    await inTx(async (c) => {
      const v1 = await insert(c, { title: "v1" });
      await archive(c, v1.id);
      const v2 = await insert(c, { title: "v2", version: 2, root_script_id: v1.id });
      assert.equal(v2.root_script_id, v1.id);
    });
  });

  test("a parent that cannot be found is refused, not given a second root", async () => {
    await assert.rejects(
      () => inTx((c) => insert(c, { parent_script_id: "00000000-0000-4000-8000-000000000413" })),
      /was not found from this session/
    );
  });

  // ── 413: the version rules ─────────────────────────────────────────────────

  test("a locked or filmed script with no number is refused", async () => {
    for (const status of ["locked", "filmed"]) {
      await assert.rejects(
        () => inTx((c) => insert(c, { status })),
        pgErr("23514", "ad_scripts_number_when_locked_ck"),
        `${status} without an ad_id was accepted`
      );
    }
    // With a number it is fine.
    await inTx(async (c) => {
      const row = await insert(c, { status: "locked", ad_id: "91" });
      assert.equal(row.status, "locked");
    });
  });

  test("a second live version of the same script is refused", async () => {
    // The old write.mjs shape: a rewrite inserted beside a parent that is still live.
    await assert.rejects(
      () => inTx(async (c) => {
        const v1 = await insert(c, { title: "v1" });
        await insert(c, { title: "v2", version: 2, parent_script_id: v1.id });
      }),
      pgErr("23505", "ad_scripts_one_live_per_root_uq")
    );
  });

  test("a version number is used once per script", async () => {
    await assert.rejects(
      () => inTx(async (c) => {
        const v1 = await insert(c, { title: "v1" });
        await archive(c, v1.id);
        await insert(c, { title: "another v1", version: 1, root_script_id: v1.id });
      }),
      pgErr("23505", "ad_scripts_root_version_uq")
    );
  });

  test("status, source and parts refuse anything outside their shape", async () => {
    await assert.rejects(() => inTx((c) => insert(c, { status: "approved" })), pgErr("23514", "ad_scripts_status_ck"));
    await assert.rejects(() => inTx((c) => insert(c, { source: "robot" })), pgErr("23514", "ad_scripts_source_ck"));
    await assert.rejects(() => inTx((c) => insert(c, { style: "prose" })), pgErr("23514", "ad_scripts_style_ck"));
    await assert.rejects(() => inTx((c) => insert(c, { parts: { kind: "hook" } })), pgErr("23514", "ad_scripts_parts_ck"));
    await inTx(async (c) => {
      const row = await insert(c, {
        source: "machine", style: "bullets", script_format: "standard", funnel_key: "roadmap_147",
        parts: JSON.stringify([{ kind: "hook", text: "They said no." }])
      });
      assert.equal(row.source, "machine");
      assert.deepEqual(row.parts, [{ kind: "hook", text: "They said no." }]);
    });
  });

  // ── 414: next_ad_number ────────────────────────────────────────────────────

  test("next_ad_number: 91 on an empty org, 91 above 90, max + 1 above that", async () => {
    await inTx(async (c) => {
      assert.equal(await next(c), 91, "an org with no numbers starts at the floor, 91");
      await insert(c, { title: "84", ad_id: "84" });
      await insert(c, { title: "90", ad_id: "90" });
      assert.equal(await next(c), 91, "max 90 and floor 91 must give 91");
      const old = await insert(c, { title: "120, retired", ad_id: "120" });
      await archive(c, old.id);
      assert.equal(await next(c), 121, "a retired version's number is still never reused");
    });
  });

  test("next_ad_number works whether or not marketing_settings exists yet", async () => {
    await inTx(async (c) => {
      const reg = (await c.query(`SELECT to_regclass('public.marketing_settings') AS t`)).rows[0].t;
      // Either way this org has no settings row, so the floor is 91. When the
      // table is absent this is the exact case 414's to_regclass guard is for.
      assert.equal(await next(c), 91,
        reg ? "marketing_settings exists but this org has no row: the floor must default to 91"
            : "marketing_settings does not exist yet: the floor must default to 91");
    });
  });

  test("next_ad_number ignores text that is not one of our numbers", async () => {
    await inTx(async (c) => {
      // The shape check refuses these on every real write path; dropping it
      // inside this rolled-back transaction is the only way to plant one.
      await c.query(`ALTER TABLE ad_scripts DROP CONSTRAINT ad_scripts_ad_id_ck`);
      await insert(c, { title: "letters", ad_id: "abc" });
      await insert(c, { title: "mixed", ad_id: "12x" });
      await insert(c, { title: "ten digits", ad_id: "9999999999" });
      await insert(c, { title: "a real one", ad_id: "95" });
      assert.equal(await next(c), 96);
    });
  });

  test("next_ad_number gives two transactions that ask at once two different numbers", async () => {
    const first = await pool().connect();
    const second = await pool().connect();
    let n1, n2;
    try {
      await first.query("BEGIN");
      await first.query("SELECT set_config('fundhub.actor', 'staff', true)");
      await second.query("BEGIN");
      await second.query("SELECT set_config('fundhub.actor', 'staff', true)");
      const secondPid = (await second.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;

      n1 = Number((await first.query(`SELECT next_ad_number($1) AS n`, [org])).rows[0].n);
      await first.query(
        `INSERT INTO ad_scripts (org_id, partner_id, body, ad_id, status)
         VALUES ($1, $2, 'concurrency fixture', $3, 'locked')`,
        [org, partner, String(n1)]
      );

      // The second caller asks while the first still holds its lock.
      const pending = second.query(`SELECT next_ad_number($1) AS n`, [org]);

      // Prove it is really waiting on the lock, not just slow.
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const a = (await db.query(
          `SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`, [secondPid]
        )).rows[0];
        waiting = !!a && a.wait_event_type === "Lock" && a.wait_event === "advisory";
        if (!waiting) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(waiting, "the second caller never waited on the per-org lock");

      await first.query("COMMIT");
      n2 = Number((await pending).rows[0].n);
      await second.query("ROLLBACK");
    } finally {
      try { await first.query("ROLLBACK"); } catch { /* already committed */ }
      try { await second.query("ROLLBACK"); } catch { /* already rolled back */ }
      first.release();
      second.release();
    }
    assert.equal(n1, 91);
    assert.notEqual(n2, n1, "two transactions were handed the same number");
    assert.equal(n2, n1 + 1);
  });

  test("next_ad_number refuses a REPEATABLE READ transaction, where it could hand out a number twice", async () => {
    await assert.rejects(
      () => inTx((c) => next(c), { isolation: "REPEATABLE READ" }),
      /READ COMMITTED/
    );
  });

  test("next_ad_number leaves the caller's actor as it found it", async () => {
    await inTx(async (c) => {
      await c.query(`SELECT set_config('fundhub.actor', 'partner', true)`);
      await next(c);
      const actor = (await c.query(`SELECT current_setting('fundhub.actor', true) AS a`)).rows[0].a;
      assert.equal(actor, "partner", "next_ad_number changed who the caller is acting as");
    });
  });

  test("next_ad_number is a fixed-path SECURITY DEFINER that only fundhub_app may run", async () => {
    const fn = (await db.query(
      `SELECT p.prosecdef, p.proconfig, p.provolatile
         FROM pg_proc p
        WHERE p.oid = 'public.next_ad_number(uuid)'::regprocedure`
    )).rows[0];
    assert.ok(fn, "next_ad_number(uuid) does not exist");
    // Who besides the owner may EXECUTE it. A NULL proacl means Postgres's
    // default, which includes PUBLIC — acldefault() spells that out.
    fn.runners = (await db.query(
      `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS who
         FROM pg_proc p,
              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'public.next_ad_number(uuid)'::regprocedure
          AND a.privilege_type = 'EXECUTE'
          AND a.grantee <> p.proowner`
    )).rows.map((r) => r.who).sort();
    assert.equal(fn.prosecdef, true, "must be SECURITY DEFINER to see every partner's numbers");
    assert.equal(fn.provolatile, "v", "must be VOLATILE, or it reads a snapshot from before the lock");
    assert.ok((fn.proconfig || []).some((s) => /^search_path=public,\s*pg_temp$/.test(s)),
      `search_path is not pinned: ${JSON.stringify(fn.proconfig)}`);
    const hasApp = (await db.query(`SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'`)).rows.length > 0;
    assert.deepEqual(fn.runners, hasApp ? ["fundhub_app"] : [],
      "EXECUTE must belong to fundhub_app only — never PUBLIC, anon or authenticated");
  });

  // ── 414: the batch, idea and voice tables ──────────────────────────────────

  test("one weekly batch per org per week; Write now batches are not limited", async () => {
    await assert.rejects(
      () => inTx(async (c) => {
        await c.query(`INSERT INTO marketing_batches (org_id, kind, week_key) VALUES ($1, 'weekly', '2026-W41')`, [org]);
        await c.query(`INSERT INTO marketing_batches (org_id, kind, week_key) VALUES ($1, 'weekly', '2026-W41')`, [org]);
      }),
      pgErr("23505", "marketing_batches_one_weekly_uq")
    );
    await assert.rejects(
      () => inTx((c) => c.query(`INSERT INTO marketing_batches (org_id, kind) VALUES ($1, 'weekly')`, [org])),
      pgErr("23514", "marketing_batches_weekly_has_week_ck")
    );
    await assert.rejects(
      () => inTx((c) => c.query(`INSERT INTO marketing_batches (org_id, kind, status) VALUES ($1, 'on_command', 'failed')`, [org])),
      pgErr("23514", "marketing_batches_failed_reason_ck")
    );
    await inTx(async (c) => {
      for (let i = 0; i < 2; i++) {
        await c.query(`INSERT INTO marketing_batches (org_id, kind, week_key) VALUES ($1, 'on_command', '2026-W41')`, [org]);
      }
      const b = (await c.query(`SELECT status, total FROM marketing_batches WHERE org_id = $1 LIMIT 1`, [org])).rows[0];
      assert.equal(b.status, "planned");
      assert.equal(b.total, 0);
    });
  });

  test("a script can point at its batch and its idea; an opening needs a target", async () => {
    await inTx(async (c) => {
      const batch = (await c.query(
        `INSERT INTO marketing_batches (org_id, kind) VALUES ($1, 'on_command') RETURNING id`, [org]
      )).rows[0].id;
      const idea = (await c.query(
        `INSERT INTO ad_ideas (org_id, partner_id, batch_id, raw_points, lane)
         VALUES ($1, $2, $3, 'denied, no reason given', 'sorting') RETURNING *`, [org, partner, batch]
      )).rows[0];
      assert.equal(idea.source, "chris");
      assert.equal(idea.kind, "script");
      assert.equal(idea.status, "new");
      const script = await insert(c, { source: "machine", batch_id: batch, idea_id: idea.id });
      await c.query(`UPDATE ad_ideas SET status = 'written', script_id = $2 WHERE id = $1`, [idea.id, script.id]);
      assert.equal(script.batch_id, batch);
    });
    await assert.rejects(
      () => inTx((c) => c.query(`INSERT INTO ad_ideas (org_id, kind) VALUES ($1, 'opening')`, [org])),
      pgErr("23514", "ad_ideas_opening_target_ck")
    );
    await assert.rejects(
      () => inTx((c) => insert(c, { batch_id: "00000000-0000-4000-8000-000000000414" })),
      pgErr("23503", "ad_scripts_batch_id_fkey")
    );
  });

  test("a voice pair must change something", async () => {
    await assert.rejects(
      () => inTx((c) => c.query(
        `INSERT INTO voice_pairs (org_id, "before", "after") VALUES ($1, 'same words', 'same words')`, [org])),
      pgErr("23514", "voice_pairs_changed_ck")
    );
    await inTx(async (c) => {
      const s = await insert(c, { source: "machine" });
      const p = (await c.query(
        `INSERT INTO voice_pairs (org_id, script_id, before, after, kind)
         VALUES ($1, $2, 'Most business owners never ask.', 'Nobody asks.', 'hook') RETURNING *`,
        [org, s.id]
      )).rows[0];
      assert.equal(p.exported_at, null);
    });
  });

  test("the three new tables force row security and carry a policy", async () => {
    const rows = (await db.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname = 'public' AND p.tablename = c.relname
                         AND p.policyname = c.relname || '_app_all') AS has_policy
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)
        ORDER BY c.relname`,
      [["marketing_batches", "ad_ideas", "voice_pairs"]]
    )).rows;
    assert.equal(rows.length, 3, "a 414 table is missing");
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname}: RLS not enabled`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname}: RLS not forced`);
      assert.equal(r.has_policy, true, `${r.relname}: no ${r.relname}_app_all policy`);
    }
  });
});
