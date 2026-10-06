// Seeding a real client's checklist, and closing it from a real re-pull.
//
// WHY THESE ARE POSTGRES TESTS. Every claim here is a claim about what happens
// to ROWS: that enrolment creates them, that enrolling twice makes one set and
// not two, and that a waypoint moves to done only when the data says so. None
// of that can be proved against a fake db object.
//
// THE CREDIT FILES ARE NOT HAND-WRITTEN FIXTURES. They come from
// scripts/sim/push-credit.mjs — the manual-walkthrough simulator — through the
// real tier engine, which is the same path src/deliverables/preview.mjs uses. So
// what is seeded here is what a real tri-merge produces, including the part that
// caught a design mistake: the same card is reported once by each bureau.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12 —
// a skipped pg test is not a green one).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";
import crsEngine from "../finance/vendor/crs-engine.cjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { seedClientWaypoints } from "./seed.mjs";
import { evaluateWaypoints } from "./verify.mjs";
import { listWaypoints } from "./store.mjs";
import { enrollRepairProgram } from "../repair/enroll.mjs";
import { onAnalysisCompleted } from "../handlers/client-lifecycle.mjs";
import { rlsDb, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";

/* A test identity, so the simulator never reads the owner's gitignored file
   (credentials/sim-identity/owner-identity.local.json). That file exists only
   on Chris's Mac, so in CI every test here died in its hook with "identity file
   not found" (2026-10-05). Same pattern as
   src/deliverables/business-duplication-map.test.mjs. */
const TEST_IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_LIKE = "waypoint.seed.pg.%@example.com";
const ENROLLED_AT = new Date("2026-09-06T12:00:00.000Z");
const ENROLL_EMAIL_LIKE = "waypoint.enrol.pg.%@example.com";
const IDENT_EMAIL_LIKE = "waypoint.ident.pg.%@example.com";

/* ═══════════════════════════════════════════════════════════════════════════
   CLEANING UP AFTER A CLIENT, AND WHY IT IS NOT A HAND-WRITTEN LIST.

   MEASURED 2026-09-06 on a clean scratch database. enrollRepairProgram writes an
   `events` row AND queues the welcome email, which is a row in `messages`.
   Neither table carries ON DELETE CASCADE on client_id. The purge in this file
   deleted events and not messages, so the client delete raised a foreign-key
   error INSIDE after() — and node:test tallies results before it runs that hook,
   so the file printed "tests 18 / pass 18 / fail 0" and EXITED 1. Worse, the
   client survived, and on a SECOND run against the same database the one test
   that proves the whole lane — "enrolling a client builds their checklist" —
   was silently CANCELLED and never executed.

   So the children are read out of the catalog rather than typed here. A table
   that starts pointing at clients next month is covered without anybody
   remembering to come back to this line.
   ═══════════════════════════════════════════════════════════════════════════ */
async function deleteClients(ids) {
  if (!ids.length) return;
  const kids = (await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'public.clients'::regclass
        AND c.contype = 'f'
        AND c.confdeltype <> 'c'
        AND array_length(c.conkey, 1) = 1`
  )).rows;
  for (const k of kids) {
    await db.query(`DELETE FROM ${k.tbl} WHERE ${k.col} = ANY($1::uuid[])`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
}

async function purgeByEmail(like) {
  const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [like]))
    .rows.map((r) => r.id);
  await deleteClients(ids);
}

/** A credit file the way a real pull produces one. */
function creditFile(profile, overrides = {}) {
  const payload = buildPayload(profile, {
    email: null,
    name: "Seed Subject",
    pulledAt: "2026-09-05T00:00:00.000Z",
    identity: TEST_IDENTITY
  });
  /* THIS FILE RUNS ON A FROZEN CLOCK (pulled 2026-09-05, enrolled 2026-09-06),
     but the engine judged the pull's age against the REAL clock, so from early
     October the same file tiered MANUAL_REVIEW (report too old) instead of
     REPAIR_ONLY. The cards on it do not change with the tier, but a test file
     must not change answer with the date it runs on. The vendor engine takes a
     referenceDate for exactly this ("useful in tests",
     vendor/underwriteiq-crs/engine.js); it is set to the enrolment day so the
     file is a day old, as the timeline says. */
  const engine = runTierEngineFromCrsResult(payload, {
    submittedName: "Seed Subject",
    submittedAddress: "100 Test Ave, Denton, TX 76205"
  }, {
    runEngine: (args) => crsEngine.runCRSEngine({ ...args, referenceDate: ENROLLED_AT })
  });
  return { ...engine, ...overrides };
}

/** Re-pull the same file with one card's balance rewritten on every bureau. */
function withBalance(file, creditorFragment, newBalance) {
  const clone = JSON.parse(JSON.stringify(file));
  for (const list of [clone?.normalized?.tradelines, clone?.tradelines]) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      const name = String(t.creditorName || t.creditor || "");
      if (name.toLowerCase().includes(creditorFragment.toLowerCase())) {
        if ("currentBalance" in t) t.currentBalance = newBalance;
        if ("balance" in t) t.balance = newBalance;
        if ("currentBalanceAmount" in t) t.currentBalanceAmount = newBalance;
      }
    }
  }
  return clone;
}

/** Re-pull the same file with a card that was never on it before.
 *
 *  IT GETS ITS OWN ACCOUNT NUMBER AND ITS OWN OPENED DATE, because a real new
 *  card has both. Cloning the model's identity would make this a copy of an
 *  existing card wearing a different name, which is the RENAME case and not the
 *  new-card case — the two are exactly what this lane now has to tell apart. */
function withNewCard(file, creditor, { ref = "SIM-NEWCARD-7412", opened = "2026-08-01" } = {}) {
  const clone = JSON.parse(JSON.stringify(file));
  for (const key of ["tradelines"]) {
    const list = clone?.normalized?.[key];
    if (!Array.isArray(list) || !list.length) continue;
    const model = list.find((t) => String(t.accountType || "").toLowerCase() === "revolving") || list[0];
    list.push({
      ...JSON.parse(JSON.stringify(model)),
      creditorName: creditor,
      creditor,
      accountIdentifier: ref,
      account_ref: ref,
      openedDate: opened,
      accountOpenedDate: opened,
      currentBalance: 900,
      balance: 900,
      creditLimit: 2000,
      effectiveLimit: 2000
    });
  }
  return clone;
}

/** Re-pull THE SAME FILE with one creditor spelled differently, and nothing
 *  else touched — the account number and the opened date are left exactly as
 *  they were, because that is what a bureau tidying up a creditor string does. */
function withCreditorRenamed(file, fragment, renamed) {
  const clone = JSON.parse(JSON.stringify(file));
  for (const list of [clone?.normalized?.tradelines, clone?.tradelines]) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      const name = String(t.creditorName || t.creditor || "");
      if (!name.toLowerCase().includes(fragment.toLowerCase())) continue;
      if ("creditorName" in t) t.creditorName = renamed;
      if ("creditor" in t) t.creditor = renamed;
    }
  }
  return clone;
}

describe("nothing seeds a waypoint — until enrolment does", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client;

  const purge = () => purgeByEmail(EMAIL_LIKE);

  async function freshClient(email, customFields = {}) {
    return (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Seed','Subject',$2,$3::jsonb) RETURNING id`,
      [org, email, JSON.stringify(customFields)]
    )).rows[0].id;
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    client = await freshClient("waypoint.seed.pg.subject@example.com", { state: "TX", city: "Denton" });
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, client, JSON.stringify(creditFile("repair"))]
    );
  });

  /* close() is deliberately NOT called here. node:test runs the two describes in
     this file one after the other against the SAME module-level pool, so
     closing it now would kill the second suite before its first query. The last
     describe closes it. */
  after(async () => {
    await purge();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE CATALOG
  // ─────────────────────────────────────────────────────────────────────────

  test("the catalog holds the six client tasks and NOT the ones the owner ruled out", async () => {
    const rows = (await db.query(
      `SELECT key, verify_kind, due_offset_days, paid_alternative_price_cents
         FROM waypoint_definitions WHERE active ORDER BY position`
    )).rows;
    assert.deepEqual(rows.map((r) => r.key), [
      "paydown_revolving_account",
      "blueprint_dispute_mail_letters",
      "blueprint_dispute_mail_receipt",
      "blueprint_dispute_bureau_response",
      "no_new_credit", "personal_loan",
      "form_llc", "get_ein", "business_checking"
    ]);
    // "we dont do DUNS" — Chris, 2026-09-05. Nor net-30 vendors, nor Paydex:
    // the platform holds no vendor list and no Paydex field, so a waypoint for
    // any of them could never be closed by anything.
    const all = (await db.query(`SELECT key, title, detail FROM waypoint_definitions`)).rows;
    const blob = JSON.stringify(all).toLowerCase();
    for (const banned of ["duns", "dun &", "bradstreet", "paydex", "uline", "quill", "grainger", "net-30", "net 30"]) {
      assert.ok(!blob.includes(banned), `the catalog must not mention ${banned}`);
    }
    // Owner-set branding: no "credit repair" in client-facing copy.
    assert.ok(!blob.includes("credit repair"));
  });

  test("every price in the catalog is NULL — no waypoint pretends to sell something", async () => {
    const priced = (await db.query(
      `SELECT key FROM waypoint_definitions WHERE paid_alternative_price_cents IS NOT NULL`
    )).rows;
    assert.deepEqual(priced, [], "nothing on the client list is priced today");
    // And zero can never be stored in its place — the database refuses it.
    await assert.rejects(
      db.query(
        `INSERT INTO waypoint_definitions (key, title, owner_kind, paid_alternative_price_cents)
         VALUES ('zero_price_probe','Probe','client',0)`
      ),
      /waypoint_definitions_paid_price_ck/
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SEEDING
  // ─────────────────────────────────────────────────────────────────────────

  test("a real client gets a checklist, one row per card and not one per bureau row", async () => {
    const before = await listWaypoints(db, { orgId: org, clientId: client });
    assert.deepEqual(before, [], "this client has no checklist before anything seeds one");

    const out = await seedClientWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
    assert.equal(out.ok, true);
    assert.equal(out.creditFile, "crs_result");

    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    /* THE SIMULATOR'S REPAIR FILE CHANGED UNDER THIS TEST. It was written on
       2026-09-06 against "Capital One Platinum", "Credit One Bank" and an OPEN
       "Synchrony Bank / Care Credit". The same day 8663c59b4 restored the
       laptop's scripts/sim/push-credit.mjs, which spells the cards the way a
       bureau does (CAPITAL ONE, CREDIT ONE BANK, SYNCB/CARE CREDIT) and reports
       the charged-off Synchrony card CLOSED, as real bureaus do. A closed card
       gets no paydown (skipped: account_closed), so two paydowns, not three.
       First run against a real database in CI: 2026-10-05. */
    assert.deepEqual(rows.map((r) => r.key), [
      "paydown_capital_one",
      "paydown_credit_one_bank",
      "no_new_credit",
      "personal_loan",
      "form_llc",
      "get_ein",
      "business_checking"
    ]);
    // The repair profile reports its three cards EIGHT times across three
    // bureaus (3 + 3 + 2). Two open cards, two paydown waypoints — not eight,
    // and none for the closed one.
    assert.equal(rows.filter((r) => r.verify_kind === "paydown").length, 2);
    assert.ok(!rows.some((r) => r.key.startsWith("paydown_syncb")), "a closed card is never a paydown");
    for (const r of rows) assert.equal(r.owner_kind, "client");
  });

  test("the paydown says a real creditor and a real number, in integer cents", async () => {
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const w = rows.find((r) => r.key === "paydown_capital_one");
    assert.equal(w.title, "Pay CAPITAL ONE down to $300");
    assert.equal(w.params.target_cents, 30000);
    assert.equal(w.params.balance_at_seed_cents, 287000);
    assert.equal(w.params.limit_at_seed_cents, 300000);
    assert.equal(Number.isInteger(w.params.target_cents), true);
  });

  test("the state the client lives in reaches the LLC task", async () => {
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const llc = rows.find((r) => r.key === "form_llc");
    assert.match(llc.detail, /Secretary of State in TX\./);
  });

  test("what CAN be checked is marked so, and what cannot is NULL — not guessed at", async () => {
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const kinds = Object.fromEntries(rows.map((r) => [r.key, r.verify_kind]));
    assert.equal(kinds.paydown_capital_one, "paydown");
    assert.equal(kinds.no_new_credit, "no_new_credit");
    // Nothing in this platform can see an IRS record, a bank account, a
    // Secretary of State filing, or a loan the client took elsewhere.
    assert.equal(kinds.get_ein, null);
    assert.equal(kinds.business_checking, null);
    assert.equal(kinds.form_llc, null);
    assert.equal(kinds.personal_loan, null);
  });

  test("a task nobody set a date for is NOT overdue, ever", async () => {
    const rows = await listWaypoints(db, {
      orgId: org, clientId: client, now: new Date("2030-01-01T00:00:00.000Z")
    });
    const ein = rows.find((r) => r.key === "get_ein");
    assert.equal(ein.due_at, null);
    assert.equal(ein.overdue, false, "no deadline means never overdue, four years later included");
    const paydown = rows.find((r) => r.key === "paydown_capital_one");
    assert.equal(paydown.due_at.toISOString(), "2026-10-06T12:00:00.000Z");
    assert.equal(paydown.overdue, true);
  });

  test("SEEDING TWICE MAKES ONE SET", async () => {
    const first = await listWaypoints(db, { orgId: org, clientId: client });
    await seedClientWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
    const second = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(second.length, first.length);
    assert.deepEqual(second.map((r) => r.key), first.map((r) => r.key));
    assert.deepEqual(second.map((r) => r.id), first.map((r) => r.id), "the same rows, not new ones");
  });

  test("re-seeding after the balances moved updates the same row and keeps the deadline", async () => {
    const before = await listWaypoints(db, { orgId: org, clientId: client });
    const beforeRow = before.find((r) => r.key === "paydown_capital_one");

    const cheaper = withBalance(creditFile("repair"), "Capital One", 1200);
    await seedClientWaypoints(db, {
      orgId: org, clientId: client, crsResult: cheaper,
      now: new Date("2026-12-01T00:00:00.000Z")
    });

    const after = await listWaypoints(db, { orgId: org, clientId: client });
    const afterRow = after.find((r) => r.key === "paydown_capital_one");
    assert.equal(after.length, before.length, "still one set");
    assert.equal(afterRow.id, beforeRow.id, "the same row");
    assert.equal(afterRow.params.balance_at_seed_cents, 120000, "with the fresh balance");
    assert.equal(
      afterRow.due_at.toISOString(), beforeRow.due_at.toISOString(),
      "and the deadline the client was originally given, not a new one"
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CLOSING FROM THE DATA
  // ─────────────────────────────────────────────────────────────────────────

  test("a paydown CLOSES when a re-pull shows the balance under the target", async () => {
    const paid = withBalance(creditFile("repair"), "Credit One Bank", 100);
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: paid, now: new Date("2026-10-01T00:00:00.000Z")
    });
    assert.ok(out.completed.some((c) => c.key === "paydown_credit_one_bank"), JSON.stringify(out));

    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const w = rows.find((r) => r.key === "paydown_credit_one_bank");
    assert.equal(w.state, "done");
    assert.equal(w.completed_at.toISOString(), "2026-10-01T00:00:00.000Z");
  });

  test("a paydown STAYS OPEN when the balance did not move", async () => {
    /* The Capital One card: the only other open card on the repair file since
       the Synchrony card is reported closed (see the seeding test above). */
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const w = rows.find((r) => r.key === "paydown_capital_one");
    assert.equal(w.state, "not_started", "untouched by the run that closed the other card");

    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: creditFile("repair"), now: new Date("2026-10-01T00:00:00.000Z")
    });
    assert.equal(
      out.unchanged.find((u) => u.key === "paydown_capital_one").reason,
      "above_target"
    );
    const after = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(after.find((r) => r.key === "paydown_capital_one").state, "not_started");
  });

  test("a new card on a later pull BLOCKS the do-not-open-credit row, and never closes it", async () => {
    const before = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(before.find((r) => r.key === "no_new_credit").state, "not_started");

    const clean = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: creditFile("repair"), now: new Date("2026-10-05T00:00:00.000Z")
    });
    assert.equal(
      clean.unchanged.find((u) => u.key === "no_new_credit").reason,
      "no_new_accounts_seen",
      "keeping the rule is never proof, so the row is not completed"
    );

    const opened = withNewCard(creditFile("repair"), "Brand New Bank Card");
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: opened, now: new Date("2026-10-06T00:00:00.000Z")
    });
    assert.ok(out.blocked.some((b) => b.key === "no_new_credit"), JSON.stringify(out));

    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const w = rows.find((r) => r.key === "no_new_credit");
    assert.equal(w.state, "blocked");
    assert.match(w.state_reason, /Brand New Bank Card/);
    assert.equal(w.completed_at, null);
  });

  /* ORDER MATTERS HERE, AND THIS IS THE REASON. The next test re-reads this
     client against a DIFFERENT simulator profile, which carries cards the
     enrolment file never had — so it legitimately trips the do-not-open-credit
     check and leaves that row blocked. This test has to run while the row is
     still untouched. */
  test("A CARD MISSING FROM THE NEW FILE IS UNKNOWN, AND UNKNOWN IS NOT PAID OFF", async () => {
    // The trial profile has no Capital One card on it at all.
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: creditFile("trial"), now: new Date("2026-10-02T00:00:00.000Z")
    });
    assert.equal(
      out.unchanged.find((u) => u.key === "paydown_capital_one").reason,
      "account_not_on_file"
    );
    assert.ok(!out.completed.some((c) => c.key === "paydown_capital_one"));
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(rows.find((r) => r.key === "paydown_capital_one").state, "not_started");
  });

  test("THE EIN STAYS OPEN, BECAUSE NOTHING IN THIS PLATFORM CAN SEE ONE", async () => {
    await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: creditFile("repair"), now: new Date("2026-10-03T00:00:00.000Z")
    });
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    for (const key of ["get_ein", "business_checking", "form_llc", "personal_loan"]) {
      const w = rows.find((r) => r.key === key);
      assert.equal(w.state, "not_started", `${key} must not be closed by a credit pull`);
      assert.equal(w.completed_at, null);
    }
  });

  test("no credit file means NO verdicts at all — nothing is closed and nothing is blocked", async () => {
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: null, now: new Date("2026-10-04T00:00:00.000Z")
    });
    assert.equal(out.creditFile, "none");
    assert.deepEqual(out.completed, []);
    assert.deepEqual(out.blocked, []);
    assert.ok(out.unchanged.every((u) => u.reason === "no_credit_file"));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE CLIENT WITH NO CREDIT FILE
  // ─────────────────────────────────────────────────────────────────────────

  test("a client with no pull still gets the tasks that need no file, and no invented paydown", async () => {
    const bare = await freshClient("waypoint.seed.pg.nofile@example.com", {});
    const out = await seedClientWaypoints(db, { orgId: org, clientId: bare, now: ENROLLED_AT });
    assert.equal(out.creditFile, "none");
    const rows = await listWaypoints(db, { orgId: org, clientId: bare });
    assert.deepEqual(rows.map((r) => r.key), [
      "no_new_credit", "personal_loan", "form_llc", "get_ein", "business_checking"
    ]);
    // No state on file: the sentence still reads.
    assert.match(rows.find((r) => r.key === "form_llc").detail, /Secretary of State\. Send us/);
    // And the baseline is NULL, not [], so a later pull cannot report every
    // card this client has ever owned as newly opened.
    assert.equal(rows.find((r) => r.key === "no_new_credit").params.accounts_at_seed, null);
  });

  test("with a NULL baseline the do-not-open-credit check refuses to conclude anything", async () => {
    const bare = (await db.query(
      `SELECT id FROM clients WHERE email = $1`, ["waypoint.seed.pg.nofile@example.com"]
    )).rows[0].id;
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: bare, crsResult: creditFile("repair"), now: new Date("2026-10-07T00:00:00.000Z")
    });
    assert.equal(out.unchanged.find((u) => u.key === "no_new_credit").reason, "no_baseline");
    assert.deepEqual(out.blocked, []);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE WIRE. Not "the seeder works if you call it" — "enrolling a client calls
// it". This is the whole point of the lane and it is asserted against the real
// enrolment function, not a stub.
// ───────────────────────────────────────────────────────────────────────────
describe("enrolling a client builds their checklist", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client;

  /* enrollRepairProgram writes an events row AND a messages row, and neither
     table cascades from clients. deleteClients() finds both from the catalog —
     see the note at the top of this file for the run where forgetting one of
     them made this file exit 1 while printing zero failures. */
  const purge = () => purgeByEmail(ENROLL_EMAIL_LIKE);

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Enrol','Subject',$2,$3::jsonb) RETURNING id`,
      [org, "waypoint.enrol.pg.subject@example.com", JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, client, JSON.stringify(creditFile("repair"))]
    );
  });

  /* close() is NOT called here either. The identity suite below runs after this
     one against the same module-level pool. The last describe in the file closes
     it. */
  after(async () => {
    await purge();
  });

  test("enrolling writes the checklist, and enrolling AGAIN leaves one set", async () => {
    const before = await listWaypoints(db, { orgId: org, clientId: client });
    assert.deepEqual(before, [], "empty before enrolment — nothing else in the product writes this table");

    const first = await enrollRepairProgram(db, {
      orgId: org, clientId: client, program: "full", priceTotal: 1000, amountPaid: 0
    });
    assert.equal(first.ok, true);
    assert.equal(first.checklist.ok, true, JSON.stringify(first.checklist));

    const seeded = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(seeded.length, 7);
    assert.equal(seeded.filter((r) => r.verify_kind === "paydown").length, 2);

    await enrollRepairProgram(db, {
      orgId: org, clientId: client, program: "full", priceTotal: 1000, amountPaid: 0
    });
    const again = await listWaypoints(db, { orgId: org, clientId: client });
    assert.deepEqual(again.map((r) => r.id), seeded.map((r) => r.id), "the same rows, not a second set");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A CARD IS NOT ITS NAME.
//
// Everything in this suite exists because of one measured run: a reviewer
// re-pulled a byte-identical credit file with a single creditor string rewritten
// from "Credit One Bank" to "CREDIT ONE BANK N.A." — a tidy-up a bureau does to
// itself — and the client was told on their own portal that they had opened new
// credit, while the paydown on that same card was written off as missing from
// the file. Unknown had become a denial.
// ───────────────────────────────────────────────────────────────────────────
describe("a renamed card, a genuinely new card, and the way back", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client;
  const REPAIR = () => creditFile("repair");

  const purge = () => purgeByEmail(IDENT_EMAIL_LIKE);

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Ident','Subject',$2,$3::jsonb) RETURNING id`,
      [org, "waypoint.ident.pg.subject@example.com", JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, client, JSON.stringify(REPAIR())]
    );
    await seedClientWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
  });

  after(async () => {
    await purge();
  });

  const rowFor = async (key) =>
    (await listWaypoints(db, { orgId: org, clientId: client })).find((r) => r.key === key);

  test("the baseline records HOW each card is identified, not just what it is called", async () => {
    const nnc = await rowFor("no_new_credit");
    assert.equal(nnc.params.accounts_at_seed.length, 3);
    assert.equal(
      nnc.params.account_prints_at_seed.length, 3,
      "one print per card — a tri-merge reports each card three times and they collapse to one"
    );
    assert.equal(
      nnc.params.accounts_without_print_at_seed, 0,
      "every card on this file could be identified, which is what lets a later pull conclude anything"
    );
    assert.equal(nnc.params.baseline_locked, true);

    const paydown = await rowFor("paydown_credit_one_bank");
    assert.deepEqual(paydown.params.account_prints, ["o:2023-09-05|n:3018"]);
  });

  test("THE REVIEWER'S CASE: a creditor renamed is NOT new credit, and the paydown is not lost", async () => {
    const renamed = withCreditorRenamed(REPAIR(), "Credit One Bank", "CREDIT ONE BANK N.A.");
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: renamed, now: new Date("2026-10-01T00:00:00.000Z")
    });

    assert.deepEqual(out.blocked, [], JSON.stringify(out));
    assert.equal(
      out.unchanged.find((u) => u.key === "no_new_credit").reason,
      "no_new_accounts_seen",
      "the same card under a new name is the same card"
    );
    assert.equal(
      out.unchanged.find((u) => u.key === "paydown_credit_one_bank").reason,
      "above_target",
      "and the paydown is still being read against that card, not written off as missing"
    );
    assert.equal((await rowFor("no_new_credit")).state, "not_started");
    assert.equal((await rowFor("no_new_credit")).state_reason, null);
  });

  test("a renamed card that HAS been paid down still closes", async () => {
    /* ITS OWN CLIENT. This used the open Synchrony card, which the simulator
       now reports closed (8663c59b4), so the repair file has two open cards,
       and the re-seed and re-pull tests below each need one of them still
       open on the suite's client. Same file, same rename-then-pay, a second
       client (the suite's purge already covers its address). */
    const other = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Ident','Renamed',$2,$3::jsonb) RETURNING id`,
      [org, "waypoint.ident.pg.renamed@example.com", JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await seedClientWaypoints(db, { orgId: org, clientId: other, crsResult: REPAIR(), now: ENROLLED_AT });
    const keyFor = async (key) =>
      (await listWaypoints(db, { orgId: org, clientId: other })).find((r) => r.key === key);
    assert.equal((await keyFor("paydown_capital_one")).state, "not_started");

    const renamedAndPaid = withBalance(
      withCreditorRenamed(REPAIR(), "Capital One", "CAPITAL ONE BANK USA NA"),
      "CAPITAL ONE", 10
    );
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: other, crsResult: renamedAndPaid, now: new Date("2026-10-02T00:00:00.000Z")
    });
    assert.ok(
      out.completed.some((c) => c.key === "paydown_capital_one"),
      JSON.stringify(out)
    );
    assert.equal((await keyFor("paydown_capital_one")).state, "done");
  });

  test("A GENUINELY NEW CARD IS STILL CAUGHT, and the sentence reads like a person wrote it", async () => {
    const opened = withNewCard(REPAIR(), "Brand New Bank Card");
    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: opened, now: new Date("2026-10-03T00:00:00.000Z")
    });
    assert.ok(out.blocked.some((b) => b.key === "no_new_credit"), JSON.stringify(out));

    const w = await rowFor("no_new_credit");
    assert.equal(w.state, "blocked");
    assert.equal(w.completed_at, null);
    assert.equal(
      w.state_reason,
      "Your credit file now shows an account that was not on it when you enrolled: Brand New Bank Card. Let your advisor know if this is not yours."
    );
    // Not an accusation, no dollar figure, no claim about what happens next.
    const text = w.state_reason.toLowerCase();
    for (const banned of ["you opened", "credit repair", "qualify", "approved", "$"]) {
      assert.ok(!text.includes(banned), `the blocked reason must not say "${banned}"`);
    }
  });

  test("A RE-SEED WHILE BLOCKED DOES NOT ERASE THE EVIDENCE", async () => {
    const before = await rowFor("no_new_credit");
    assert.equal(before.state, "blocked", "set up by the test above");

    // Re-seed against the very file that caused the block. The old code rewrote
    // the baseline from this file, which folded "Brand New Bank Card" into the
    // list of accounts that were always there — leaving a row blocked forever
    // with a baseline saying nothing had happened.
    await seedClientWaypoints(db, {
      orgId: org, clientId: client,
      crsResult: withNewCard(REPAIR(), "Brand New Bank Card"),
      now: new Date("2026-10-04T00:00:00.000Z")
    });

    const after = await rowFor("no_new_credit");
    assert.deepEqual(
      after.params.accounts_at_seed, before.params.accounts_at_seed,
      "the enrolment baseline is written once and never rewritten"
    );
    assert.deepEqual(after.params.account_prints_at_seed, before.params.account_prints_at_seed);
    assert.ok(!after.params.accounts_at_seed.includes("brand_new_bank_card"));
    assert.equal(after.state, "blocked", "and the block is still standing on evidence that still exists");
  });

  test("THE BLOCK LIFTS WHEN THE ACCOUNT IS NO LONGER ON THE FILE", async () => {
    assert.equal((await rowFor("no_new_credit")).state, "blocked");

    const out = await evaluateWaypoints(db, {
      orgId: org, clientId: client, crsResult: REPAIR(), now: new Date("2026-10-05T00:00:00.000Z")
    });
    assert.ok(out.unblocked.some((u) => u.key === "no_new_credit"), JSON.stringify(out));

    const w = await rowFor("no_new_credit");
    assert.equal(w.state, "not_started", "the accusation follows the evidence in both directions");
    assert.equal(w.state_reason, null);
    assert.equal(w.completed_at, null, "and it is never completed — keeping the rule is not proof");
  });

  test("A RE-SEED CLOSES A CARD THAT HAS REACHED ITS TARGET, instead of leaving it stale", async () => {
    const before = await rowFor("paydown_credit_one_bank");
    assert.equal(before.state, "not_started");
    assert.equal(before.params.balance_at_seed_cents, 149000);

    const paid = withBalance(REPAIR(), "Credit One Bank", 100);
    const out = await seedClientWaypoints(db, {
      orgId: org, clientId: client, crsResult: paid, now: new Date("2026-10-06T00:00:00.000Z")
    });
    assert.deepEqual(out.completed, ["paydown_credit_one_bank"], JSON.stringify(out));

    const after = await rowFor("paydown_credit_one_bank");
    assert.equal(after.id, before.id, "the same row, not a second one");
    assert.equal(after.state, "done");
    assert.equal(after.params.balance_at_seed_cents, 10000, "and the numbers on it are the fresh ones");
    assert.equal(after.completed_at.toISOString(), "2026-10-06T00:00:00.000Z");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE WIRE. evaluateWaypoints() had NO production caller on this branch — a
  // grep found it in test files and nowhere else — so a client who paid a card
  // down was told to pay it down forever. This asserts the real handler, not a
  // stub: onAnalysisCompleted is what src/handlers/client-lifecycle.mjs
  // registers on analysis.completed, which is the event a finished credit pull
  // raises.
  // ─────────────────────────────────────────────────────────────────────────
  test("A RE-PULL CLOSES THE CHECKLIST, because the credit-pull handler now reads it", async () => {
    const beforeCap = await rowFor("paydown_capital_one");
    assert.equal(beforeCap.state, "not_started");

    // The client pays the Capital One card down under its $300 target, and the
    // pull that reports it lands as a real crs_results row.
    const paid = withBalance(REPAIR(), "Capital One", 120);
    const crsRow = (await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair') RETURNING id`,
      [org, client, JSON.stringify(paid)]
    )).rows[0];

    await onAnalysisCompleted({
      id: "evt-waypoint-wire-1",
      name: "analysis.completed",
      orgId: org,
      clientId: client,
      payload: { crsResultId: crsRow.id, source: "crs" }
    }, db);

    const after = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(
      after.find((r) => r.key === "paydown_capital_one").state, "done",
      "the card that was paid down closed itself"
    );
    // AND NOTHING ELSE MOVED.
    assert.equal(after.find((r) => r.key === "get_ein").state, "not_started");
    assert.equal(after.find((r) => r.key === "business_checking").state, "not_started");
    assert.equal(after.find((r) => r.key === "form_llc").state, "not_started");
    assert.equal(after.find((r) => r.key === "personal_loan").state, "not_started");
    assert.equal(
      after.find((r) => r.key === "no_new_credit").state, "not_started",
      "keeping the rule is never proof, so this one never closes"
    );
  });

  test("firing the same pull again changes nothing", async () => {
    const before = await listWaypoints(db, { orgId: org, clientId: client });
    const crsRow = (await db.query(
      `SELECT id FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [client]
    )).rows[0];

    await onAnalysisCompleted({
      id: "evt-waypoint-wire-1",
      name: "analysis.completed",
      orgId: org,
      clientId: client,
      payload: { crsResultId: crsRow.id, source: "crs" }
    }, db);

    const after = await listWaypoints(db, { orgId: org, clientId: client });
    assert.deepEqual(
      after.map((r) => [r.key, r.state, r.completed_at?.toISOString() ?? null]),
      before.map((r) => [r.key, r.state, r.completed_at?.toISOString() ?? null])
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// WHAT THE CHECKLIST IS ALLOWED TO SAY, AND WHO IS ALLOWED TO CHANGE IT.
// This describe is LAST in the file and it closes the pools.
// ───────────────────────────────────────────────────────────────────────────
describe("the catalog: its words, and its locks", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(async () => {
    await closeRlsPool();
    await close();
  });

  test("NO STEP PROMISES AN OUTCOME, AN APPROVAL, A TIMELINE OR AN AMOUNT", async () => {
    /* The defect this pins: the personal-loan step used to read "You qualify
       today, before any of the optimization work lands", and a reviewer got that
       sentence onto the portal of a client with ZERO rows in crs_results —
       nobody had pulled their credit at all. CLAUDE.md §7: never draft
       customer-facing claims about credit outcomes. */
    const rows = (await db.query(
      `SELECT key, title, coalesce(detail,'') AS detail FROM waypoint_definitions`
    )).rows;
    // Nine: 362's six plus the three Capital Blueprint dispute steps that
    // migration 400 added on 2026-09-29 (358cb50d6). The key list in the
    // catalog test above already names all nine; this count had stayed at six.
    assert.equal(rows.length, 9);

    const banned = [
      "qualify", "qualifies", "qualified", "approv", "guarantee", "will increase",
      "boost", "points", "score", "credit repair", "pre-approval"
    ];
    for (const r of rows) {
      const text = `${r.title} ${r.detail}`.toLowerCase();
      for (const word of banned) {
        assert.ok(!text.includes(word), `${r.key} must not say "${word}": ${text}`);
      }
      /* NO DOLLAR FIGURE IN THE STORED COPY. The paydown title carries the token
         {target}, which renders per client from 10% of the limit THEIR OWN FILE
         reports — a restatement of the task, not a promise. The token is what is
         stored; a literal amount here would be a number we invented. */
      assert.ok(!/\$\s?\d/.test(`${r.title} ${r.detail}`), `${r.key} must carry no dollar amount`);
    }
  });

  test("THE APPLICATION HOLDS SELECT ON THE CATALOG AND NOTHING ELSE", async () => {
    /* This claim was made once before and it was FALSE. 104_app_role.sql runs
       ALTER DEFAULT PRIVILEGES granting fundhub_app SELECT, INSERT, UPDATE and
       DELETE on every table created afterwards, so the app held all four the
       moment 361 created this one; the writes were stopped by row-level
       security, not by the grant — which meant an UPDATE reported success and
       changed nothing. Read from the catalog rather than believed. */
    const held = (await db.query(
      `SELECT DISTINCT privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = 'fundhub_app'
          AND table_schema = 'public'
          AND table_name = 'waypoint_definitions'
        ORDER BY 1`
    )).rows.map((r) => r.privilege_type);
    assert.deepEqual(held, ["SELECT"]);
  });

  test("A WRITE BY THE APPLICATION IS REFUSED OUT LOUD, not silently ignored", { skip: !rlsIsReal() ? "no APP_DATABASE_URL" : false }, async () => {
    await assert.rejects(
      rlsDb.query(`UPDATE waypoint_definitions SET title = 'nope' WHERE key = 'get_ein'`),
      /permission denied/i,
      "an UPDATE the app is not allowed to make must RAISE — the old shape returned UPDATE 0 with no error"
    );
    await assert.rejects(
      rlsDb.query(`INSERT INTO waypoint_definitions (key,title,owner_kind) VALUES ('nope','Nope','client')`),
      /permission denied/i
    );
    await assert.rejects(
      rlsDb.query(`DELETE FROM waypoint_definitions WHERE key = 'get_ein'`),
      /permission denied/i
    );
    // And the row is exactly as it was.
    const row = (await db.query(`SELECT title FROM waypoint_definitions WHERE key = 'get_ein'`)).rows[0];
    assert.equal(row.title, "Get your EIN from the IRS");
  });

  test("ROW-LEVEL SECURITY NO LONGER BLOCKS A NON-SUPERUSER WRITE — which is what breaks a deploy", { skip: !rlsIsReal() ? "no APP_DATABASE_URL" : false }, async () => {
    /* THE DEPLOY RISK, REPRODUCED IN BOTH DIRECTIONS.
       361 puts FORCE ROW LEVEL SECURITY on this table. FORCE subjects the table
       OWNER to its own policies, so under the SELECT-only policy 361 originally
       carried, every write failed for any role without superuser or BYPASSRLS —
       the owner included. Migration 362 INSERTs six rows as the migration role,
       so on a production database whose migration role is not a superuser THE
       WHOLE MIGRATION RUN WOULD FAIL.

       fundhub_app is NOSUPERUSER and NOBYPASSRLS (104_app_role.sql), so it is
       exactly the kind of role that would have hit this. Grant it the writes for
       the length of this test and the policy must let them through; take them
       away again and the grant must stop them. */
    const role = (await db.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'fundhub_app'`
    )).rows[0];
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);

    try {
      await db.query(`GRANT INSERT, UPDATE, DELETE ON waypoint_definitions TO fundhub_app`);

      const ins = await rlsDb.query(
        `INSERT INTO waypoint_definitions (key,title,owner_kind) VALUES ('rls_probe','Probe','client')`
      );
      assert.equal(ins.rowCount, 1, "the policy must permit an INSERT — 362 is one");

      const upd = await rlsDb.query(
        `UPDATE waypoint_definitions SET position = 999 WHERE key = 'rls_probe'`
      );
      assert.equal(upd.rowCount, 1, "and an UPDATE — changing the checklist is supposed to be an UPDATE");

      const del = await rlsDb.query(`DELETE FROM waypoint_definitions WHERE key = 'rls_probe'`);
      assert.equal(del.rowCount, 1);
    } finally {
      await db.query(`REVOKE INSERT, UPDATE, DELETE ON waypoint_definitions FROM fundhub_app`);
      await db.query(`DELETE FROM waypoint_definitions WHERE key = 'rls_probe'`);
    }

    // Back to read-only, and the nine rows (362's six + 400's three) are untouched.
    const held = (await db.query(
      `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'fundhub_app' AND table_name = 'waypoint_definitions'`
    )).rows.map((r) => r.privilege_type);
    assert.deepEqual(held, ["SELECT"]);
    assert.equal(
      Number((await db.query(`SELECT count(*)::int AS n FROM waypoint_definitions`)).rows[0].n), 9
    );
  });
});
