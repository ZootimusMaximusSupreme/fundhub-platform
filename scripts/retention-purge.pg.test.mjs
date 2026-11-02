// Real-Postgres tests for migration 100 and the retention purge runner.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here. Skipped,
// not passed — a suite that reports green without a database has told you
// nothing, and CLAUDE.md §12 records that ~193 tests in this repo already skip
// silently for exactly this reason.
//
// WHAT THIS PROVES THAT THE UNIT TESTS CANNOT.
//
// scripts/retention-purge.test.mjs watches the SQL the tool sends and proves a
// dry run issues no write statement. That is a claim about the code. This file
// makes the claim about the DATABASE: it counts every row in all five tables,
// runs a dry run, counts again, and fails if a single number moved. If some
// future refactor routes a write through a path the fake handle never sees, the
// unit test could still pass and this one would not.
//
// It also pins the things only a real server can answer:
//   * the CHECK constraint's class list and DATA_CLASSES agree
//   * every seeded retain_days really is NULL, so a fresh database purges nothing
//   * de-identification leaves amount_cents exactly as it was
//   * a purge scoped to one org does not touch another org's rows
//
// This file lives under scripts/ because package.json's test glob is
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs".

import { test, before, after, describe } from "node:test";
import assert from "node:assert";

import { db, close } from "../src/db.mjs";
import { plan, apply, resolveActor } from "./retention-purge.mjs";
import { DATA_CLASSES, loadPolicy, policyGaps } from "../src/retention/policy.mjs";
import { CLASSES } from "../src/retention/classes.mjs";
import { reviewRetention } from "../src/workflows/retention-review.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const SLUG_A = "retention-100-scratch-a";
const SLUG_B = "retention-100-scratch-b";
const OLD = "now() - interval '400 days'";

let orgA = null;
let orgB = null;
let clientA = null;
let clientB = null;
let staffA = null;

/* Every table this suite writes to, in an order that respects the foreign keys:
   pii_access_log and events reference clients WITHOUT a cascade, so they go
   first or the client delete fails. */
async function wipe(orgId) {
  for (const sql of [
    `DELETE FROM retention_run_receipts WHERE org_id = $1`,
    `DELETE FROM pii_access_log     WHERE org_id = $1`,
    `DELETE FROM events             WHERE org_id = $1`,
    `DELETE FROM bank_transactions  WHERE org_id = $1`,
    `DELETE FROM bank_accounts      WHERE org_id = $1`,
    `DELETE FROM soft_pull_requests WHERE org_id = $1`,
    `DELETE FROM crs_results        WHERE org_id = $1`,
    `DELETE FROM decline_autopsy_uploads WHERE org_id = $1`,
    `DELETE FROM clients            WHERE org_id = $1`,
    `DELETE FROM staff              WHERE org_id = $1`
  ]) await db.query(sql, [orgId]);
}

/* One expired row in each of the six classes, aged past any plausible retention
   period. Every value here is chosen to satisfy the constraints those tables
   actually carry — 085's non-zero amount and settled-row date rule, 077's
   non-blank reason and requester agreement. */
async function seedExpired(orgId, clientId, staffId, { tag }) {
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, created_at)
     VALUES ($1,$2,$3,'REPAIR_ONLY',${OLD})`,
    [orgId, clientId, JSON.stringify({ bureau: "experian", score: 611, tag })]
  );
  await db.query(
    `INSERT INTO pii_access_log (org_id, client_id, accessed_by, field, created_at)
     VALUES ($1,$2,'tester','ssn',${OLD})`,
    [orgId, clientId]
  );
  await db.query(
    `INSERT INTO soft_pull_requests
       (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, cost_cents, requested_at, created_at)
     VALUES ($1,$2,'staff',$3,'retention suite fixture', NULL, ${OLD}, ${OLD})`,
    [orgId, clientId, staffId]
  );
  /* A REAL bank_accounts ROW, NOT gen_random_uuid().
     bank_account_id used to be an invented uuid here, which the table accepted
     because it had no foreign key. Migration 092 added one, so an id belonging
     to nothing is now rejected outright and every case in this file died in the
     fixture. Same correction 092 already made to recurring.pg.test.mjs. */
  const acct = (await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, name)
     VALUES ($1,$2,'retention suite fixture account') RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
  await db.query(
    `INSERT INTO bank_transactions
       (org_id, client_id, bank_account_id, amount_cents, posted_on, merchant_name,
        provider_transaction_id, provider, raw, is_pending, created_at)
     VALUES ($1,$2,$5, -12345, current_date - 400,
             'SQ *BLUE BOTTLE 4471 OAKLAND CA', $3, 'plaid',
             $4::jsonb, false, ${OLD})`,
    [orgId, clientId, `ret-100-${tag}`, JSON.stringify({ account_masked: "****1234", tag }), acct]
  );
  await db.query(
    `INSERT INTO events (org_id, name, idempotency_key, client_id, created_at)
     VALUES ($1,'booking.created',$2,$3,${OLD})`,
    [orgId, `demo:${tag}:booking.created`, clientId]
  );
  /* broker_upload_rows. NOTE THE SHAPE: no client_id, and no contact column
     exists on decline_autopsy_rows to put one in. That is the point of the
     table. In production this class has NO retention period at all (owner-set:
     retain in full), so the runner never reaches its purge — the fixture exists
     so the mechanism is still exercised the same way every other class's is. */
  const autopsy = (await db.query(
    `INSERT INTO decline_autopsy_uploads (org_id, autopsy_ref, buyer_email, paid_at, created_at)
     VALUES ($1,$2,$3,${OLD},${OLD}) RETURNING id`,
    [orgId, `ret${tag.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.padEnd(24, "0").slice(0, 32),
     `retention-suite-${tag}@broker.test`]
  )).rows[0].id;
  await db.query(
    `INSERT INTO decline_autopsy_rows (org_id, autopsy_id, row_label, fico_band, created_at)
     VALUES ($1,$2,'A-1','720+',${OLD})`,
    [orgId, autopsy]
  );
}

/* The six row counts, as one object. This is the measurement the headline test
   takes before and after a dry run. */
async function census(orgId) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM crs_results        WHERE org_id = $1)::int AS crs,
            (SELECT count(*) FROM pii_access_log     WHERE org_id = $1)::int AS pii,
            (SELECT count(*) FROM soft_pull_requests WHERE org_id = $1)::int AS pulls,
            (SELECT count(*) FROM bank_transactions  WHERE org_id = $1)::int AS bank,
            (SELECT count(*) FROM events             WHERE org_id = $1)::int AS events,
            (SELECT count(*) FROM decline_autopsy_rows WHERE org_id = $1)::int AS autopsy_rows`,
    [orgId]
  );
  return rows[0];
}

/* The de-identifiable content, so a dry run can be shown not to have blanked it
   either. A row count alone would not catch an UPDATE. */
async function contentFingerprint(orgId) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM crs_results
              WHERE org_id = $1 AND NOT (result ? '_retention_purged'))::int AS crs_intact,
            (SELECT count(*) FROM bank_transactions
              WHERE org_id = $1 AND merchant_name IS NOT NULL)::int AS bank_named,
            (SELECT coalesce(sum(amount_cents), 0) FROM bank_transactions
              WHERE org_id = $1)::bigint AS bank_total`,
    [orgId]
  );
  return { ...rows[0], bank_total: String(rows[0].bank_total) };
}

async function setPolicy(orgId, retainDays) {
  for (const name of DATA_CLASSES) {
    await db.query(
      `INSERT INTO retention_policy (org_id, data_class, action, retain_days, signed_off_at, signed_off_by)
       VALUES ($1,$2,$3,$4,now(),'retention suite')
       ON CONFLICT (org_id, data_class) DO UPDATE SET retain_days = EXCLUDED.retain_days,
         signed_off_at = EXCLUDED.signed_off_at, signed_off_by = EXCLUDED.signed_off_by`,
      [orgId, name, CLASSES[name].action, retainDays]
    );
  }
}

before(async () => {
  if (!HAS_DB) return;

  for (const slug of [SLUG_A, SLUG_B]) {
    await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [slug, `Retention 100 scratch ${slug.slice(-1).toUpperCase()}`]
    );
  }
  orgA = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG_A])).rows[0].id;
  orgB = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG_B])).rows[0].id;

  await wipe(orgA);
  await wipe(orgB);
  await db.query(`DELETE FROM retention_policy WHERE org_id = ANY($1::uuid[])`, [[orgA, orgB]]);

  staffA = (await db.query(
    `INSERT INTO staff (org_id, name, role, status) VALUES ($1,'Retention Tester','owner','active') RETURNING id`,
    [orgA]
  )).rows[0].id;
  clientA = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ret','Alpha') RETURNING id`,
    [orgA]
  )).rows[0].id;
  clientB = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ret','Bravo') RETURNING id`,
    [orgB]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe(orgA);
  await wipe(orgB);
  await db.query(`DELETE FROM retention_policy WHERE org_id = ANY($1::uuid[])`, [[orgA, orgB]]);
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1::text[])`, [[SLUG_A, SLUG_B]]);
  await close();
});

// ═══════════════════════════════════════════════════════════════════════════
// What migration 100 actually created.
// ═══════════════════════════════════════════════════════════════════════════

describe("migration 100 — the table and the view", () => {
  test("the table, the unique constraint and the view all exist", { skip: !HAS_DB }, async () => {
    const t = await db.query(`SELECT to_regclass('public.retention_policy') AS t`);
    assert.ok(t.rows[0].t, "retention_policy was not created — run the migrations");

    const v = await db.query(`SELECT to_regclass('public.v_retention_policy_gaps') AS v`);
    assert.ok(v.rows[0].v, "v_retention_policy_gaps was not created");

    const u = await db.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'uq_retention_policy_org_class'`
    );
    assert.equal(u.rowCount, 1, "one policy per class per org is not enforced");
  });

  test("the CHECK constraint and DATA_CLASSES cannot drift apart", { skip: !HAS_DB }, async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.retention_policy'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%data_class%'`
    );
    assert.equal(rows.length, 1, "expected exactly one data_class CHECK");
    const def = rows[0].def;
    for (const name of DATA_CLASSES) {
      assert.ok(def.includes(name), `the CHECK constraint does not allow "${name}"`);
    }
    // And nothing the code does not know about.
    const inConstraint = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const name of inConstraint) {
      assert.ok(DATA_CLASSES.includes(name), `the CHECK allows "${name}" but no handler exists`);
    }
  });

  test("an unknown data class is refused by the database", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO retention_policy (org_id, data_class, action) VALUES ($1,'everything','delete')`,
        [orgA]
      ),
      (e) => e.code === "23514"
    );
  });

  /* The owner's windows, as stated. `months` is what the owner said; `days` is
     what B2 wrote. The test below proves the second is never shorter than the
     first, using Postgres's own calendar rather than arithmetic in this file. */
  const OWNER_SET = [
    { data_class: "crs_raw_payloads",  days: 762, months: 25 },
    { data_class: "pii_access_log",    days: 762, months: 25 },
    { data_class: "soft_pull_ledger",  days: 762, months: 25 },
    { data_class: "bank_transactions", days: 731, months: 24 },
    { data_class: "mock_data",         days: 7,   months: null }
  ];

  test("*** the default org carries the owner-set windows, signed off ***", { skip: !HAS_DB }, async () => {
    const defaultOrg = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    const { rows } = await db.query(
      `SELECT data_class, retain_days, action, signed_off_at, signed_off_by, notes
         FROM retention_policy WHERE org_id = $1 ORDER BY data_class`,
      [defaultOrg]
    );
    assert.equal(rows.length, DATA_CLASSES.length, "migration 100 did not seed every class");

    for (const want of OWNER_SET) {
      const got = rows.find((r) => r.data_class === want.data_class);
      assert.ok(got, `${want.data_class} is missing`);
      assert.equal(got.retain_days, want.days, `${want.data_class} window is not the owner's number`);
      assert.equal(got.signed_off_by, "owner", `${want.data_class} is not recorded as owner-set`);
      assert.ok(got.signed_off_at, `${want.data_class} is not signed off`);
      // The owner's stated condition has to stay findable after the gaps view
      // stops reporting a signed-off class.
      assert.match(got.notes, /counsel reviews these/i, `${want.data_class} lost the counsel-review condition`);
      assert.match(got.notes, /OWNER-SET/, `${want.data_class} lost its provenance`);
    }
  });

  test("*** the month-to-day conversion is never SHORT, per Postgres's calendar ***", { skip: !HAS_DB }, async () => {
    // The failure this guards against is silent: 25 x 30.4 = 760 days, which is
    // two days short of a 25-month window that starts in the wrong month, and
    // records would be destroyed before the window they were meant to cover had
    // elapsed. Asked of the database rather than computed here, so a leap year is
    // handled by the thing that actually knows about leap years.
    for (const want of OWNER_SET) {
      if (want.months === null) continue;
      const { rows } = await db.query(
        `SELECT max((d + make_interval(months => $1::int))::date - d::date) AS longest
           FROM generate_series(date '2024-01-01', date '2031-12-01', interval '1 month') d`,
        [want.months]
      );
      const longest = Number(rows[0].longest);
      assert.ok(
        want.days >= longest,
        `${want.data_class}: ${want.days} days is SHORTER than the longest ${want.months}-month span (${longest} days) — records would be purged early`
      );
      // And not absurdly generous either — within a month of the true ceiling.
      assert.ok(want.days <= longest + 31, `${want.data_class}: ${want.days} days overshoots ${want.months} months`);
    }
  });

  test("a NON-default org keeps its NULL window — one business's call is not another's", { skip: !HAS_DB }, async () => {
    // orgA was created by this suite, after the migration, so it has no rows at
    // all. The point being pinned is that B2 is scoped to is_default: a tenant
    // nobody has spoken to must never inherit the owner's numbers.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n
         FROM retention_policy
        WHERE org_id <> (SELECT id FROM orgs WHERE is_default LIMIT 1)
          AND retain_days IS NOT NULL
          AND signed_off_by = 'owner'`
    );
    assert.equal(rows[0].n, 0, "the owner's windows leaked onto another org");
  });

  test("the seeded windows drop out of the gaps report, because they are signed off", { skip: !HAS_DB }, async () => {
    // This is the flip side of signing off, and it is stated here so it is not a
    // surprise later: v_retention_policy_gaps reports until BOTH set and signed.
    // The default org is now both, so it is silent. The counsel-review condition
    // lives in the notes column, asserted above.
    const defaultOrg = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    const gaps = await policyGaps(db, { orgId: defaultOrg });
    assert.deepEqual(gaps, [], "a signed-off window is still being reported as a gap");
  });

  test("a zero retention period is refused by the column", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO retention_policy (org_id, data_class, action, retain_days)
         VALUES ($1,'mock_data','delete',0)`,
        [orgB]
      ),
      (e) => e.code === "23514",
      "retain_days = 0 was accepted — zero means purge everything"
    );
  });

  test("two policies for the same class in one org are refused", { skip: !HAS_DB }, async () => {
    await db.query(
      `INSERT INTO retention_policy (org_id, data_class, action) VALUES ($1,'mock_data','delete')
       ON CONFLICT (org_id, data_class) DO NOTHING`,
      [orgB]
    );
    await assert.rejects(
      () => db.query(
        `INSERT INTO retention_policy (org_id, data_class, action) VALUES ($1,'mock_data','delete')`,
        [orgB]
      ),
      (e) => e.code === "23505"
    );
    await db.query(`DELETE FROM retention_policy WHERE org_id = $1`, [orgB]);
  });

  test("policy rows go when their org goes", { skip: !HAS_DB }, async () => {
    const doomed = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('retention-100-doomed','Doomed') RETURNING id`
    )).rows[0].id;
    await db.query(
      `INSERT INTO retention_policy (org_id, data_class, action) VALUES ($1,'mock_data','delete')`,
      [doomed]
    );
    await db.query(`DELETE FROM orgs WHERE id = $1`, [doomed]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM retention_policy WHERE org_id = $1`, [doomed]
    );
    assert.equal(rows[0].n, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE HEADLINE. A dry run changes nothing, measured against the database.
// ═══════════════════════════════════════════════════════════════════════════

describe("a dry run removes nothing", () => {
  test("*** ROW COUNTS AND CONTENT ARE IDENTICAL BEFORE AND AFTER A DRY RUN ***", { skip: !HAS_DB }, async () => {
    await wipe(orgA);
    staffA = (await db.query(
      `INSERT INTO staff (org_id, name, role, status) VALUES ($1,'Retention Tester','owner','active') RETURNING id`,
      [orgA]
    )).rows[0].id;
    clientA = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ret','Alpha') RETURNING id`,
      [orgA]
    )).rows[0].id;
    await seedExpired(orgA, clientA, staffA, { tag: "dry" });

    // A retention period of ONE DAY on every class, against rows aged 400 days.
    // This is the most dangerous configuration available: everything is expired.
    // If a dry run were going to remove something, it would remove all of it.
    await setPolicy(orgA, 1);

    const countsBefore = await census(orgA);
    const contentBefore = await contentFingerprint(orgA);
    assert.equal(countsBefore.crs, 1, "the fixture did not land — nothing would be proven");
    assert.equal(countsBefore.pii, 1);
    assert.equal(countsBefore.pulls, 1);
    assert.equal(countsBefore.bank, 1);
    assert.equal(countsBefore.events, 1);

    // THE DRY RUN. plan() is what the runner calls without --apply.
    const result = await plan(db, { orgId: orgA });

    // It found the expired rows — this is not passing because it looked at nothing.
    const byClass = Object.fromEntries(result.items.map((i) => [i.dataClass, i]));
    for (const name of DATA_CLASSES) {
      assert.equal(byClass[name].skipped, undefined, `${name} was skipped; it should have been counted`);
      assert.equal(byClass[name].expired, 1, `${name} should have found exactly 1 expired row`);
    }

    // And it changed absolutely nothing.
    assert.deepEqual(await census(orgA), countsBefore, "A DRY RUN DELETED ROWS");
    assert.deepEqual(await contentFingerprint(orgA), contentBefore, "A DRY RUN REWROTE DATA");
  });

  test("a dry run does not blank a payload or a merchant name", { skip: !HAS_DB }, async () => {
    await plan(db, { orgId: orgA });
    const { rows } = await db.query(
      `SELECT (SELECT result->>'bureau' FROM crs_results WHERE org_id = $1 LIMIT 1) AS bureau,
              (SELECT merchant_name FROM bank_transactions WHERE org_id = $1 LIMIT 1) AS merchant`,
      [orgA]
    );
    assert.equal(rows[0].bureau, "experian", "the credit-report payload was emptied by a dry run");
    assert.match(rows[0].merchant, /BLUE BOTTLE/, "the merchant name was scrubbed by a dry run");
  });
});

test("monthly review stores a count-only receipt without changing customer rows", { skip: !HAS_DB }, async () => {
  const before = await census(orgA);
  const contentBefore = await contentFingerprint(orgA);
  const oneOrg = {
    query(sql, params) {
      if (sql.includes("SELECT id FROM orgs ORDER BY id")) return Promise.resolve({ rows: [{ id: orgA }] });
      return db.query(sql, params);
    }
  };
  const result = await reviewRetention(oneOrg, { asOf: new Date("2035-01-01T04:00:00Z") });
  assert.equal(result.count, 1);
  const receipt = (await db.query(
    `SELECT kind, actor_staff_id, plan_counts, applied_counts
       FROM retention_run_receipts
      WHERE org_id = $1 AND run_key = '2035-01'`, [orgA]
  )).rows[0];
  assert.equal(receipt.kind, "review");
  assert.equal(receipt.actor_staff_id, null);
  assert.equal(receipt.plan_counts.length, DATA_CLASSES.length);
  assert.deepEqual(receipt.applied_counts, []);
  assert.deepEqual(await census(orgA), before);
  assert.deepEqual(await contentFingerprint(orgA), contentBefore);
});

// ═══════════════════════════════════════════════════════════════════════════
// An unset retention period purges nothing, even with --apply.
// ═══════════════════════════════════════════════════════════════════════════

describe("no retention period means no purge, even under --apply", () => {
  test("*** --apply ON A FRESHLY MIGRATED POLICY REMOVES NOTHING ***", { skip: !HAS_DB }, async () => {
    // Every retain_days back to NULL, which is exactly what migration 100 seeds.
    await db.query(`UPDATE retention_policy SET retain_days = NULL WHERE org_id = $1`, [orgA]);

    const countsBefore = await census(orgA);
    const contentBefore = await contentFingerprint(orgA);

    const result = await plan(db, { orgId: orgA });
    for (const item of result.items) {
      assert.match(item.skipped ?? "", /no retention period set/, `${item.dataClass} was not skipped`);
    }

    const applied = await apply(db, { orgId: orgA, items: result.items, actorId: staffA });
    assert.deepEqual(applied, [], "apply() acted on a class with no retention period");
    assert.deepEqual(await census(orgA), countsBefore, "--apply DELETED ROWS WITH NO RETENTION PERIOD SET");
    assert.deepEqual(await contentFingerprint(orgA), contentBefore, "--apply REWROTE DATA WITH NO RETENTION PERIOD SET");
  });

  test("a NULL period reaches the reader as an ABSENT key, never a zero", { skip: !HAS_DB }, async () => {
    const policy = await loadPolicy(db, { orgId: orgA });
    for (const name of DATA_CLASSES) {
      assert.equal("retainDays" in policy.get(name), false, `${name} carried a retainDays key when unset`);
    }
  });

  test("rows NEWER than the retention period are left alone", { skip: !HAS_DB }, async () => {
    // 3650 days against rows aged 400: set, signed off, and nothing is expired.
    await setPolicy(orgA, 3650);
    const countsBefore = await census(orgA);
    const result = await plan(db, { orgId: orgA });
    for (const item of result.items) {
      assert.equal(item.skipped, undefined);
      assert.equal(item.expired, 0, `${item.dataClass} treated a row inside its retention period as expired`);
    }
    await apply(db, { orgId: orgA, items: result.items, actorId: staffA });
    assert.deepEqual(await census(orgA), countsBefore, "rows inside the retention period were removed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// --apply, when it is asked for and a period is set, actually does the work.
// This is the control: without it, every test above passes for the wrong reason.
// ═══════════════════════════════════════════════════════════════════════════

describe("--apply does what it says, and only what it says", () => {
  test("delete classes are deleted; de-identify classes keep their row", { skip: !HAS_DB }, async () => {
    await setPolicy(orgA, 1);
    const result = await plan(db, { orgId: orgA });
    const applied = await apply(db, { orgId: orgA, items: result.items, actorId: staffA });
    assert.equal(applied.length, DATA_CLASSES.length);
    assert.ok(applied.receiptId, "an applied purge did not return its receipt id");
    const receipt = (await db.query(
      `SELECT kind, actor_staff_id, plan_counts, applied_counts
         FROM retention_run_receipts WHERE id = $1 AND org_id = $2`,
      [applied.receiptId, orgA]
    )).rows[0];
    assert.equal(receipt.kind, "apply");
    assert.equal(receipt.actor_staff_id, staffA);
    assert.equal(receipt.plan_counts.length, DATA_CLASSES.length);
    assert.equal(receipt.applied_counts.length, DATA_CLASSES.length);
    for (const a of applied) assert.equal(a.affected, 1, `${a.dataClass} affected ${a.affected} rows, expected 1`);

    const after = await census(orgA);
    // Deleted outright.
    assert.equal(after.pii, 0, "the PII access log was not deleted");
    assert.equal(after.pulls, 0, "the soft-pull ledger was not deleted");
    assert.equal(after.events, 0, "the demo event was not deleted");
    // Row survives, content does not.
    assert.equal(after.crs, 1, "the credit-report ROW was deleted; it should have been de-identified");
    assert.equal(after.bank, 1, "the bank transaction ROW was deleted; it should have been de-identified");
  });

  test("*** de-identifying a bank transaction does not touch the amount ***", { skip: !HAS_DB }, async () => {
    const { rows } = await db.query(
      `SELECT amount_cents, merchant_name, posted_on, raw ? '_retention_purged' AS tombstoned
         FROM bank_transactions WHERE org_id = $1`,
      [orgA]
    );
    assert.equal(rows.length, 1);
    // Integer cents, negative because money left the account (085's convention).
    assert.equal(String(rows[0].amount_cents), "-12345", "the amount was rewritten by de-identification");
    assert.ok(rows[0].posted_on, "the posted date was destroyed");
    assert.equal(rows[0].merchant_name, null, "the merchant name was not scrubbed");
    assert.equal(rows[0].tombstoned, true, "the raw payload was not replaced with a tombstone");
  });

  test("the credit-report row survives with its outcome tier; the payload is gone", { skip: !HAS_DB }, async () => {
    const { rows } = await db.query(
      `SELECT outcome_tier, result ? '_retention_purged' AS tombstoned, result->>'bureau' AS bureau
         FROM crs_results WHERE org_id = $1`,
      [orgA]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome_tier, "REPAIR_ONLY", "the derived outcome label was destroyed");
    assert.equal(rows[0].tombstoned, true, "the bureau payload was not replaced");
    assert.equal(rows[0].bureau, null, "the bureau payload survived de-identification");
  });

  test("re-running is a no-op — an already-purged row is not counted twice", { skip: !HAS_DB }, async () => {
    const result = await plan(db, { orgId: orgA });
    const byClass = Object.fromEntries(result.items.map((i) => [i.dataClass, i]));
    assert.equal(byClass.crs_raw_payloads.expired, 0, "a tombstoned payload was counted again");
    assert.equal(byClass.bank_transactions.expired, 0, "a tombstoned transaction was counted again");

    const applied = await apply(db, { orgId: orgA, items: result.items, actorId: staffA });
    for (const a of applied) assert.equal(a.affected, 0, `${a.dataClass} churned rows on a second run`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Org scoping. The purge never crosses a tenancy boundary.
// ═══════════════════════════════════════════════════════════════════════════

describe("org scoping is real, and it fails closed", () => {
  test("*** PURGING ONE ORG LEAVES ANOTHER ORG'S ROWS UNTOUCHED ***", { skip: !HAS_DB }, async () => {
    await wipe(orgA);
    await wipe(orgB);
    const staffOfA = (await db.query(
      `INSERT INTO staff (org_id, name, role, status) VALUES ($1,'A Owner','owner','active') RETURNING id`, [orgA]
    )).rows[0].id;
    const staffOfB = (await db.query(
      `INSERT INTO staff (org_id, name, role, status) VALUES ($1,'B Owner','owner','active') RETURNING id`, [orgB]
    )).rows[0].id;
    clientA = (await db.query(
      `INSERT INTO clients (org_id, first_name) VALUES ($1,'Alpha') RETURNING id`, [orgA]
    )).rows[0].id;
    clientB = (await db.query(
      `INSERT INTO clients (org_id, first_name) VALUES ($1,'Bravo') RETURNING id`, [orgB]
    )).rows[0].id;

    await seedExpired(orgA, clientA, staffOfA, { tag: "scope-a" });
    await seedExpired(orgB, clientB, staffOfB, { tag: "scope-b" });
    await setPolicy(orgA, 1);
    await setPolicy(orgB, 1);

    const bBefore = await census(orgB);
    const bContentBefore = await contentFingerprint(orgB);

    const result = await plan(db, { orgId: orgA });
    await apply(db, { orgId: orgA, items: result.items, actorId: staffOfA });

    assert.deepEqual(await census(orgB), bBefore, "PURGING ORG A REMOVED ORG B'S ROWS");
    assert.deepEqual(await contentFingerprint(orgB), bContentBefore, "PURGING ORG A REWROTE ORG B'S DATA");
    // And org A really was purged, so the assertion above means something.
    assert.equal((await census(orgA)).pii, 0, "org A was not purged");
  });

  test("the org comes off the staff record, and a bad actor gets nothing", { skip: !HAS_DB }, async () => {
    const staffOfB = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 LIMIT 1`, [orgB]
    )).rows[0].id;

    const ok = await resolveActor(db, { staffId: staffOfB });
    assert.equal(ok.error, undefined);
    assert.equal(ok.staff.orgId, orgB, "the org did not come from the staff member's own record");

    const nobody = await resolveActor(db, {});
    assert.match(nobody.error, /say who you are/);

    const ghost = await resolveActor(db, { staffId: "00000000-0000-0000-0000-000000000000" });
    assert.match(ghost.error, /no staff member/);
  });

  test("a newly created staff member cannot purge — 'invited' is the default", { skip: !HAS_DB }, async () => {
    // staff.status defaults to 'invited', not 'active'. So somebody who has been
    // added but has never logged in cannot run this tool, without anybody having
    // to remember to lock them out. Pinned because it is a real fail-closed
    // property of the schema and a future default change would silently open it.
    const fresh = (await db.query(
      `INSERT INTO staff (org_id, name, role) VALUES ($1,'Never Logged In','owner') RETURNING id, status`,
      [orgB]
    )).rows[0];
    assert.equal(fresh.status, "invited", "staff.status no longer defaults to 'invited'");

    const res = await resolveActor(db, { staffId: fresh.id });
    assert.match(res.error, /not active/);
    assert.equal(res.staff, undefined);

    await db.query(`DELETE FROM staff WHERE id = $1`, [fresh.id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The gaps view keeps reporting until somebody confirms — 088/089's rule.
// ═══════════════════════════════════════════════════════════════════════════

describe("the gaps view reports until a human signs off", () => {
  test("an org with no policy rows is reported once per missing class", { skip: !HAS_DB }, async () => {
    await db.query(`DELETE FROM retention_policy WHERE org_id = $1`, [orgB]);
    const gaps = await policyGaps(db, { orgId: orgB });
    assert.equal(gaps.length, DATA_CLASSES.length, "a missing class was not reported");
    for (const g of gaps) {
      assert.equal(g.setting, "retention_policy");
      assert.match(g.status, /no policy row for this data class/);
      assert.ok(g.consequence.trim().length > 0, "every gap says what being wrong costs");
    }
  });

  test("an UNSET period is reported, and says the runner removes nothing", { skip: !HAS_DB }, async () => {
    for (const name of DATA_CLASSES) {
      await db.query(
        `INSERT INTO retention_policy (org_id, data_class, action) VALUES ($1,$2,$3)`,
        [orgB, name, CLASSES[name].action]
      );
    }
    const gaps = await policyGaps(db, { orgId: orgB });
    assert.equal(gaps.length, DATA_CLASSES.length);
    for (const g of gaps) {
      assert.equal(g.value, "null");
      assert.match(g.status, /UNSET/);
      assert.match(g.status, /removes nothing/);
    }
  });

  test("*** A PERIOD THAT IS SET BUT UNSIGNED IS STILL REPORTED ***", { skip: !HAS_DB }, async () => {
    // The branch that stops a provisional number hardening into a fact.
    await db.query(
      `UPDATE retention_policy SET retain_days = 90 WHERE org_id = $1 AND data_class = 'mock_data'`,
      [orgB]
    );
    const gaps = await policyGaps(db, { orgId: orgB });
    const mock = gaps.find((g) => g.data_class === "mock_data");
    assert.ok(mock, "a set-but-unsigned period stopped being reported");
    assert.equal(mock.value, "90");
    assert.match(mock.status, /AWAITING SIGN-OFF/);
    assert.match(mock.status, /WILL act/);
  });

  test("signing a class off stops it being reported — and only it", { skip: !HAS_DB }, async () => {
    await db.query(
      `UPDATE retention_policy
          SET signed_off_at = now(), signed_off_by = 'retention suite'
        WHERE org_id = $1 AND data_class = 'mock_data'`,
      [orgB]
    );
    const classes = (await policyGaps(db, { orgId: orgB })).map((g) => g.data_class);
    assert.equal(classes.includes("mock_data"), false, "a signed-off class is still reported");
    assert.ok(classes.includes("pii_access_log"), "signing off one class silenced another");
  });
});
