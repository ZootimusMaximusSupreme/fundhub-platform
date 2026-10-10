// Money A lane: the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-money-funding.pg.test.mjs
//
// WHY THIS FILE EXISTS. gap-money-funding.test.mjs hands the lane a fake database that returns canned
// rows. That proves the wording and the status rules. It cannot prove the SQL, and the SQL is where
// the logic lives: what counts as a bill, which round is owed a commission, which approval is "priced".
// A check that is flipped or loosened there still passes the fake. These scenarios run the real SQL
// and the real verdict code on a real Postgres and make them answer yes or no for made-up people.
//
// HOW IT STAYS HARMLESS. Every statement runs inside BEGIN READ ONLY and is always rolled back. The
// real tables are shadowed by a CTE that holds ONLY the made-up rows of that scenario, so no real row
// is ever read and the test reads the same on an empty scratch database as on production. The CTE
// also selects its columns FROM the real table with WHERE false, so a column that does not exist on
// the real schema fails here. Nothing is written (the database would refuse it). Nothing is sent.
//
// RED means the lane must go red for that person. GREEN means it must stay green.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import { gapChecks } from "./gap-money-funding.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const NOW = new Date();
const min = (n) => new Date(NOW.getTime() - n * 60000).toISOString();
const hours = (n) => min(n * 60);
const days = (n) => min(n * 24 * 60);
const uuid = () => crypto.randomUUID();

const SHADOWS = {
  funding_rounds: {
    cols: "id, org_id, client_id, round_number, product, status, funded_amount, is_demo, updated_at",
    rec: "id uuid, org_id uuid, client_id uuid, round_number int, product text, status text, funded_amount numeric, is_demo boolean, updated_at timestamptz"
  },
  clients: {
    cols: "id, org_id, client_code, email, is_demo",
    rec: "id uuid, org_id uuid, client_code text, email text, is_demo boolean"
  },
  funding_closeout: {
    cols: "funding_round_id, org_id",
    rec: "funding_round_id uuid, org_id uuid"
  },
  invoices: {
    cols: "org_id, funding_round_id, client_id, source, invoice_type, status, is_demo",
    rec: "org_id uuid, funding_round_id uuid, client_id uuid, source text, invoice_type text, status text, is_demo boolean"
  },
  funding_round_sales: {
    cols: "org_id, funding_round_id, sale_id",
    rec: "org_id uuid, funding_round_id uuid, sale_id uuid"
  },
  sale_attributions: {
    cols: "org_id, sale_id, basis",
    rec: "org_id uuid, sale_id uuid, basis text"
  },
  commission_ledger: {
    cols: "org_id, funding_round_id, client_id, sale_id, basis, reverses_ledger_id, status, rule_id, amount, approved_at, paid_at, earned_at, is_demo",
    rec: "org_id uuid, funding_round_id uuid, client_id uuid, sale_id uuid, basis text, reverses_ledger_id uuid, status text, rule_id uuid, amount numeric, approved_at timestamptz, paid_at timestamptz, earned_at timestamptz, is_demo boolean"
  },
  applications: {
    cols: "id, org_id, funding_round_id, client_id, lender_name, bank, status, approved_amount, approval_excluded_at, status_updated_date, updated_at, created_at, is_demo",
    rec: "id uuid, org_id uuid, funding_round_id uuid, client_id uuid, lender_name text, bank text, status text, approved_amount numeric, approval_excluded_at timestamptz, status_updated_date timestamptz, updated_at timestamptz, created_at timestamptz, is_demo boolean"
  },
  sales: {
    cols: "id, org_id, client_id, product_id, sale_motion, status, agreed_success_fee_percent, agreed_price, sold_at, notes, external_ref, is_demo",
    rec: "id uuid, org_id uuid, client_id uuid, product_id uuid, sale_motion text, status text, agreed_success_fee_percent numeric, agreed_price numeric, sold_at timestamptz, notes text, external_ref text, is_demo boolean"
  },
  cards: {
    cols: "id, org_id, client_id, pipeline_id, stage_id, entered_at, updated_at, is_demo",
    rec: "id uuid, org_id uuid, client_id uuid, pipeline_id uuid, stage_id uuid, entered_at timestamptz, updated_at timestamptz, is_demo boolean"
  },
  pipelines: {
    cols: "id, org_id, key",
    rec: "id uuid, org_id uuid, key text"
  },
  pipeline_stages: {
    cols: "id, pipeline_id, key",
    rec: "id uuid, pipeline_id uuid, key text"
  },
  affiliate_payouts: {
    cols: "id, org_id, affiliate_id, status, amount, hold_reason, created_at",
    rec: "id uuid, org_id uuid, affiliate_id uuid, status text, amount numeric, hold_reason text, created_at timestamptz"
  },
  affiliates: {
    cols: "id, org_id, name, partner_license_signed_at, tax_form_received_at, is_demo",
    rec: "id uuid, org_id uuid, name text, partner_license_signed_at timestamptz, tax_form_received_at timestamptz, is_demo boolean"
  },
  partner_payouts: {
    cols: "id, org_id, partner_id, status, amount, hold_reason, created_at",
    rec: "id uuid, org_id uuid, partner_id uuid, status text, amount numeric, hold_reason text, created_at timestamptz"
  },
  partners: {
    cols: "id, org_id, name, agreement_signed_at, is_demo",
    rec: "id uuid, org_id uuid, name text, agreement_signed_at timestamptz, is_demo boolean"
  },
  commission_rules: {
    cols: "id, org_id, basis, stacking, active, product_id, role, staff_id, sale_motion, effective_from, effective_to",
    rec: "id uuid, org_id uuid, basis text, stacking text, active boolean, product_id uuid, role text, staff_id uuid, sale_motion text, effective_from timestamptz, effective_to timestamptz"
  },
  slo_connections: {
    cols: "org_id, product_id, active",
    rec: "org_id uuid, product_id uuid, active boolean"
  },
  products: {
    cols: "id, org_id, code, name",
    rec: "id uuid, org_id uuid, code text, name text"
  },
  transactions: {
    cols: "org_id, client_id, provider_ref, amount_paid, is_demo",
    rec: "org_id uuid, client_id uuid, provider_ref text, amount_paid numeric, is_demo boolean"
  },
  messages: {
    cols: "org_id, client_id, is_demo",
    rec: "org_id uuid, client_id uuid, is_demo boolean"
  }
};

let conn = null;
let spN = 0;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
  await conn.query("SET LOCAL statement_timeout = '20s'");
  await conn.query("SELECT set_config('fundhub.actor','staff',true)");
  const ro = await conn.query("SHOW transaction_read_only");
  assert.equal(ro.rows[0].transaction_read_only, "on", "the harness must be read only");
});

after(async () => {
  if (!HAS_DB) return;
  try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
  conn.release();
  await close();
});

/** Put the made-up rows in front of the SQL as CTEs named like the real tables. */
function withShadows(sql, paramCount) {
  const ctes = Object.entries(SHADOWS).map(([table, def], i) =>
    `${table} AS (SELECT ${def.cols} FROM ${table} WHERE false UNION ALL SELECT ${def.cols} FROM jsonb_to_recordset($${paramCount + i + 1}::jsonb) AS x(${def.rec}))`
  ).join(",\n");
  const lead = /^\/\*[\s\S]*?\*\/\s*/.exec(sql)?.[0] || "";
  const rest = sql.slice(lead.length);
  if (/^with\b/i.test(rest)) return `${lead}WITH ${ctes},\n${rest.replace(/^with\b/i, "")}`;
  return `${lead}WITH ${ctes}\n${rest}`;
}

/** A database for the lane: every statement runs against the made-up rows, one at a time, read only. */
function shadowDb(fakes = {}) {
  let chain = Promise.resolve();
  return {
    query(sql, params = []) {
      const p = chain.then(async () => {
        const text = withShadows(String(sql).trim(), params.length);
        const extra = Object.keys(SHADOWS).map((t) => JSON.stringify(fakes[t] || []));
        const sp = `mf_${++spN}`;
        await conn.query(`SAVEPOINT ${sp}`);
        try {
          const r = await conn.query(text, [...params, ...extra]);
          await conn.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (err) {
          await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw err;
        }
      });
      chain = p.catch(() => {});
      return p;
    }
  };
}

/** Run the whole lane on the made-up rows. Returns { id: row }. */
async function lane(fakes = {}) {
  const rows = await gapChecks({ db: shadowDb(fakes), orgId: ORG, now: NOW });
  const out = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

/** Every check that is not under test must read green on the empty books of one scenario. */
function expect(t, rows, id, status, detailRe) {
  const row = rows[id];
  assert.ok(row, `${id}: no row`);
  assert.equal(row.status, status, `${id}: wanted ${status}, got ${row.status}: ${row.detail}`);
  if (detailRe) assert.match(row.detail, detailRe, `${id}: detail was: ${row.detail}`);
}

/* ------------------------------------------------------------------ made-up people and money */

let codeN = 100;
function client(over = {}) {
  const id = over.id || uuid();
  codeN += 1;
  return {
    id, org_id: over.org_id || ORG, client_code: over.client_code === undefined ? `FH-000${codeN}` : over.client_code,
    email: over.email ?? `maria.${id.slice(0, 6)}@gmail.com`, is_demo: over.is_demo ?? false
  };
}
function round(c, over = {}) {
  return {
    id: over.id || uuid(), org_id: over.org_id || ORG, client_id: c.id, round_number: 1,
    product: "card_stacking", status: "funded", funded_amount: 25000, is_demo: false, updated_at: hours(3), ...over
  };
}
function closeout(r) { return { funding_round_id: r.id, org_id: ORG }; }
function bill(r, c, over = {}) {
  return { org_id: ORG, funding_round_id: r.id, client_id: c.id, source: "funding_success_fee", invoice_type: "success_fee", status: "sent", is_demo: false, ...over };
}
function sale(c, over = {}) {
  return {
    id: over.id || uuid(), org_id: over.org_id || ORG, client_id: c.id, product_id: over.product_id || uuid(), sale_motion: null,
    status: "active", agreed_success_fee_percent: 10, agreed_price: 3000, sold_at: days(20), notes: null, external_ref: null, is_demo: false, ...over
  };
}
function link(r, s) { return { org_id: ORG, funding_round_id: r.id, sale_id: s.id }; }
function attribution(s, basis = "back_end") { return { org_id: ORG, sale_id: s.id, basis }; }
function ledgerRow(over = {}) {
  return {
    org_id: ORG, funding_round_id: null, client_id: null, sale_id: null, basis: "back_end", reverses_ledger_id: null,
    status: "earned", rule_id: null, amount: 100, approved_at: null, paid_at: null, earned_at: days(5), is_demo: false, ...over
  };
}
function app(over = {}) {
  return {
    id: uuid(), org_id: ORG, funding_round_id: null, client_id: null, lender_name: "Chase", bank: "Chase", status: "Approved",
    approved_amount: 10000, approval_excluded_at: null, status_updated_date: days(2), updated_at: days(2), created_at: days(3), is_demo: false, ...over
  };
}
function rule(over = {}) {
  return {
    id: uuid(), org_id: ORG, basis: "front_end", stacking: "base", active: true, product_id: null, role: "closer",
    staff_id: null, sale_motion: null, effective_from: days(100), effective_to: null, ...over
  };
}
function payout(over = {}) {
  return { id: uuid(), org_id: ORG, affiliate_id: null, status: "held", amount: 125.5, hold_reason: "partner_license_unsigned", created_at: days(3), ...over };
}
function affiliate(over = {}) {
  return { id: uuid(), org_id: ORG, name: "Jordan Cruz", partner_license_signed_at: null, tax_form_received_at: null, is_demo: false, ...over };
}

/** A fully billed, fully paid-out card-stacking round. The "everything is right" baseline. */
function goodRound() {
  const c = client();
  const r = round(c);
  const s = sale(c);
  return {
    c, r, s,
    fakes: {
      clients: [c], funding_rounds: [r], sales: [s], funding_round_sales: [link(r, s)],
      sale_attributions: [attribution(s)], funding_closeout: [closeout(r)], invoices: [bill(r, c)],
      commission_ledger: [ledgerRow({ funding_round_id: r.id, client_id: c.id, sale_id: s.id, rule_id: uuid() })],
      applications: [app({ funding_round_id: r.id, client_id: c.id })]
    }
  };
}

/* ------------------------------------------------------------------ the harness itself */

test("money SQL: the harness is read only, so a write is refused by the database", { skip: !HAS_DB }, async () => {
  await assert.rejects(conn.query("CREATE TEMP TABLE money_pg_probe (x int)"), /read-only transaction/);
  await conn.query("ROLLBACK");
  await conn.query("BEGIN READ ONLY");
  await conn.query("SET LOCAL statement_timeout = '20s'");
  await conn.query("SELECT set_config('fundhub.actor','staff',true)");
});

test("money SQL: empty books read green on every check", { skip: !HAS_DB }, async (t) => {
  const rows = await lane({});
  for (const id of ["funding:funded-no-bill", "funding:approved-no-amount", "partners:payout-held", "commissions:ledger", "commissions:slo-map", "books:sample-rows"]) {
    expect(t, rows, id, "PASS");
  }
});

/* ------------------------------------------------------------------ check 1: funded with no bill */

test("funded-no-bill SQL: a funded round with nothing behind it is red, and says what is missing", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const r = round(c);
  const s = sale(c);
  const rows = await lane({
    clients: [c], funding_rounds: [r], sales: [s], funding_round_sales: [link(r, s)], sale_attributions: [attribution(s)]
  });
  expect(t, rows, "funding:funded-no-bill", "FAIL", new RegExp(`${c.client_code} round 1: no closeout record, no success-fee bill`));
  assert.match(rows["funding:funded-no-bill"].detail, /no bank yes with a dollar amount is on the round/);
  assert.match(rows["funding:funded-no-bill"].detail, /no staff commission rows \(1 staff member attributed\)/);
});

test("funded-no-bill SQL: a funded round with closeout, bill and commission rows is green and counted", { skip: !HAS_DB }, async (t) => {
  const g = goodRound();
  const rows = await lane(g.fakes);
  expect(t, rows, "funding:funded-no-bill", "PASS", /1 funded round in the last 60 days each has its closeout/);
});

test("funded-no-bill SQL: the cause comes from the facts on the round", { skip: !HAS_DB }, async (t) => {
  // Approvals are there, the sale agreed no percent.
  let g = goodRound();
  g.fakes.invoices = [];
  g.fakes.sales = [{ ...g.s, agreed_success_fee_percent: null }];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /the sale agreed no success-fee percent/);
  // Approvals are there, a percent is agreed, so the workflow is the suspect.
  g = goodRound();
  g.fakes.invoices = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /the bill workflow F-07 did not make one/);
  // The round was never linked to a sale.
  g = goodRound();
  g.fakes.invoices = [];
  g.fakes.funding_round_sales = [];
  g.fakes.sale_attributions = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /linked to no sale/);
});

test("funded-no-bill SQL: only a live success-fee bill counts", { skip: !HAS_DB }, async (t) => {
  let g = goodRound();
  g.fakes.invoices = [bill(g.r, g.c, { status: "void" })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no success-fee bill/);
  g = goodRound();
  g.fakes.invoices = [bill(g.r, g.c, { status: "written_off" })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no success-fee bill/);
  // The other kind of invoice (a deposit invoice) is not the success fee.
  g = goodRound();
  g.fakes.invoices = [bill(g.r, g.c, { source: "diy_letters", invoice_type: "deposit" })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no success-fee bill/);
  // Either mark is enough, as in billed-fee-check.mjs.
  g = goodRound();
  g.fakes.invoices = [bill(g.r, g.c, { source: "other", invoice_type: "success_fee" })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
});

test("funded-no-bill SQL: the closeout is owed on a card-stacking round, not on an alt-fin one", { skip: !HAS_DB }, async (t) => {
  let g = goodRound();
  g.fakes.funding_closeout = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no closeout record/);
  g = goodRound();
  g.fakes.funding_closeout = [];
  g.fakes.funding_rounds = [{ ...g.r, product: "altfin" }];
  g.fakes.applications = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
  g = goodRound();
  g.fakes.funding_closeout = [];
  g.fakes.funding_rounds = [{ ...g.r, product: null }];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
});

test("funded-no-bill SQL: a round where a person excluded every bank yes bills nothing on purpose", { skip: !HAS_DB }, async (t) => {
  const g = goodRound();
  g.fakes.invoices = [];
  g.fakes.funding_closeout = [];
  g.fakes.commission_ledger = [];
  g.fakes.sale_attributions = [];
  g.fakes.applications = [app({ funding_round_id: g.r.id, client_id: g.c.id, approval_excluded_at: hours(30), approved_amount: 5000 })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
  // The same round with the bank yes still counted is a real break.
  g.fakes.applications = [app({ funding_round_id: g.r.id, client_id: g.c.id, approved_amount: 5000 })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no closeout record, no success-fee bill/);
});

test("funded-no-bill SQL: a commission is owed only when somebody is attributed on the back end", { skip: !HAS_DB }, async (t) => {
  let g = goodRound();
  g.fakes.commission_ledger = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no staff commission rows/);
  // Nobody attributed: nobody to pay.
  g = goodRound();
  g.fakes.commission_ledger = [];
  g.fakes.sale_attributions = [];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
  // Only a front end attribution: it is not owed on the funded round.
  g = goodRound();
  g.fakes.commission_ledger = [];
  g.fakes.sale_attributions = [attribution(g.s, "front_end")];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "PASS");
  // A front end row is not the back end commission.
  g = goodRound();
  g.fakes.commission_ledger = [ledgerRow({ funding_round_id: g.r.id, basis: "front_end" })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no staff commission rows/);
  // A void row and a reversal row are not a commission.
  g = goodRound();
  g.fakes.commission_ledger = [ledgerRow({ funding_round_id: g.r.id, status: "void" }), ledgerRow({ funding_round_id: g.r.id, reverses_ledger_id: uuid() })];
  expect(t, await lane(g.fakes), "funding:funded-no-bill", "FAIL", /no staff commission rows/);
});

test("funded-no-bill SQL: a round inside the wait, past the lookback, demo, unfunded or another company's is not judged", { skip: !HAS_DB }, async (t) => {
  const bare = (over, cOver = {}) => {
    const c = client(cOver);
    return { clients: [c], funding_rounds: [round(c, over)] };
  };
  expect(t, await lane(bare({ updated_at: min(10) })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ updated_at: days(61) })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ is_demo: true })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({}, { is_demo: true })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ status: "approved" })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ funded_amount: 0 })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ funded_amount: null })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  expect(t, await lane(bare({ org_id: OTHER_ORG }, { org_id: OTHER_ORG })), "funding:funded-no-bill", "PASS", /no round has been funded/);
  // A round that was funded and then closed is still owed its bill.
  expect(t, await lane(bare({ status: "closed" })), "funding:funded-no-bill", "FAIL", /no success-fee bill/);
});

test("funded-no-bill SQL: a card in Funded with no funded round for its client is red", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const board = { id: uuid(), org_id: ORG, key: "funding_card_stacking" };
  const stage = { id: uuid(), pipeline_id: board.id, key: "funded" };
  const card = { id: uuid(), org_id: ORG, client_id: c.id, pipeline_id: board.id, stage_id: stage.id, entered_at: hours(5), updated_at: hours(5), is_demo: false };
  const fakes = { clients: [c], pipelines: [board], pipeline_stages: [stage], cards: [card] };
  expect(t, await lane(fakes), "funding:funded-no-bill", "FAIL", new RegExp(`1 card sits in Funded.*${c.client_code}`));
  // The same client with a funded, fully billed round is green.
  const g = goodRound();
  const gcard = { ...card, client_id: g.c.id };
  expect(t, await lane({ ...g.fakes, pipelines: [board], pipeline_stages: [stage], cards: [gcard] }), "funding:funded-no-bill", "PASS");
  // Just moved: inside the wait.
  expect(t, await lane({ ...fakes, cards: [{ ...card, entered_at: min(5) }] }), "funding:funded-no-bill", "PASS");
  // Another stage of the same board, another board's Funded column, and a demo card are not this.
  const other = { id: uuid(), pipeline_id: board.id, key: "approved" };
  expect(t, await lane({ ...fakes, pipeline_stages: [other], cards: [{ ...card, stage_id: other.id }] }), "funding:funded-no-bill", "PASS");
  const altBoard = { id: uuid(), org_id: ORG, key: "funding_altfin" };
  const altStage = { id: uuid(), pipeline_id: altBoard.id, key: "funded" };
  expect(t, await lane({ ...fakes, pipelines: [altBoard], pipeline_stages: [altStage], cards: [{ ...card, pipeline_id: altBoard.id, stage_id: altStage.id }] }), "funding:funded-no-bill", "PASS");
  expect(t, await lane({ ...fakes, cards: [{ ...card, is_demo: true }] }), "funding:funded-no-bill", "PASS");
});

/* ------------------------------------------------------------------ check 2: approved with no amount */

test("approved-no-amount SQL: a bank yes with no number, older than a day, is red and named", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const r = round(c, { status: "approved", funded_amount: null });
  const rows = await lane({
    clients: [c], funding_rounds: [r],
    applications: [app({ funding_round_id: r.id, client_id: c.id, approved_amount: null, lender_name: "Wells Fargo" })]
  });
  expect(t, rows, "funding:approved-no-amount", "FAIL", new RegExp(`Wells Fargo \\(${c.client_code}`));
  expect(t, await lane({ clients: [c], funding_rounds: [r], applications: [app({ funding_round_id: r.id, approved_amount: 0 })] }), "funding:approved-no-amount", "FAIL", /1 bank yes older than a day has no dollar amount/);
});

test("approved-no-amount SQL: a priced, excluded, young, denied or demo answer is not red", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const green = async (over) => expect(t, await lane({ clients: [c], applications: [app({ client_id: c.id, ...over })] }), "funding:approved-no-amount", "PASS");
  await green({ approved_amount: 5000 });
  await green({ approved_amount: null, approval_excluded_at: hours(30) });
  await green({ approved_amount: null, status_updated_date: hours(2), updated_at: hours(2), created_at: hours(2) });
  await green({ approved_amount: null, status: "Denied" });
  await green({ approved_amount: null, is_demo: true });
  await green({ approved_amount: null, org_id: OTHER_ORG });
  await green({ approved_amount: null, status_updated_date: days(61), updated_at: days(61), created_at: days(61) });
  // A demo client's answer is out too.
  const d = client({ is_demo: true });
  expect(t, await lane({ clients: [d], applications: [app({ client_id: d.id, approved_amount: null })] }), "funding:approved-no-amount", "PASS");
});

test("approved-no-amount SQL: the age is the day the status changed, not the last time anyone touched the row", { skip: !HAS_DB }, async (t) => {
  const c = client();
  // Answered 3 days ago; a note was typed 1 hour ago. Still old enough.
  const old = app({ client_id: c.id, approved_amount: null, status_updated_date: days(3), updated_at: hours(1) });
  expect(t, await lane({ clients: [c], applications: [old] }), "funding:approved-no-amount", "FAIL");
  // No status date at all: the row's own update time is used.
  const noDate = app({ client_id: c.id, approved_amount: null, status_updated_date: null, updated_at: days(3) });
  expect(t, await lane({ clients: [c], applications: [noDate] }), "funding:approved-no-amount", "FAIL");
});

/* ------------------------------------------------------------------ check 3: payouts on hold */

test("payout-held SQL: a held affiliate payout is red and names the empty stamp", { skip: !HAS_DB }, async (t) => {
  const a = affiliate();
  const rows = await lane({ affiliates: [a], affiliate_payouts: [payout({ affiliate_id: a.id })] });
  expect(t, rows, "partners:payout-held", "FAIL", /Jordan Cruz \$125\.50: the partner license is not signed \(partner_license_signed_at is empty\) and the tax form is not on file \(tax_form_received_at is empty\)/);
  // License signed, tax form missing: only the tax form is named.
  const half = affiliate({ partner_license_signed_at: days(30) });
  const r2 = await lane({ affiliates: [half], affiliate_payouts: [payout({ affiliate_id: half.id, hold_reason: "tax_form_missing" })] });
  expect(t, r2, "partners:payout-held", "FAIL", /the tax form is not on file/);
  assert.doesNotMatch(r2["partners:payout-held"].detail, /license is not signed/);
  // Both stamps set and the payout still held: the hold was never released.
  const both = affiliate({ partner_license_signed_at: days(30), tax_form_received_at: days(20) });
  const r3 = await lane({ affiliates: [both], affiliate_payouts: [payout({ affiliate_id: both.id })] });
  expect(t, r3, "partners:payout-held", "FAIL", /its stamps are now set, so the hold was never released/);
});

test("payout-held SQL: pending, processing, paid, void, young, demo and other-company payouts are not red", { skip: !HAS_DB }, async (t) => {
  const a = affiliate();
  const green = async (over, aff = a) => expect(t, await lane({ affiliates: [aff], affiliate_payouts: [payout({ affiliate_id: aff.id, ...over })] }), "partners:payout-held", "PASS");
  await green({ status: "pending", hold_reason: null });
  await green({ status: "processing", hold_reason: null });
  await green({ status: "paid", hold_reason: null });
  await green({ status: "void", hold_reason: null });
  await green({ created_at: hours(3) });
  await green({}, affiliate({ is_demo: true }));
  await green({ org_id: OTHER_ORG });
});

test("payout-held SQL: a held partner payout counts too, and the two kinds are totalled together", { skip: !HAS_DB }, async (t) => {
  const a = affiliate();
  const p = { id: uuid(), org_id: ORG, name: "Acme Funding", agreement_signed_at: null, is_demo: false };
  const rows = await lane({
    affiliates: [a], affiliate_payouts: [payout({ affiliate_id: a.id })],
    partners: [p], partner_payouts: [{ id: uuid(), org_id: ORG, partner_id: p.id, status: "held", amount: 1000, hold_reason: "partner_agreement_unsigned", created_at: days(2) }]
  });
  expect(t, rows, "partners:payout-held", "FAIL", /2 payouts are on hold, \$1,125\.50 in all/);
  assert.match(rows["partners:payout-held"].detail, /Acme Funding \$1,000: the partner agreement is not signed/);
});

/* ------------------------------------------------------------------ check 4: the ledger and its rates */

test("ledger SQL: approved and unpaid past 35 days is red, inside it is not, paid is not", { skip: !HAS_DB }, async (t) => {
  const red = ledgerRow({ status: "approved", approved_at: days(40), amount: 500, rule_id: uuid() });
  const r = rule({ id: red.rule_id, basis: "back_end" });
  const rows = await lane({ commission_ledger: [red], commission_rules: [r] });
  expect(t, rows, "commissions:ledger", "FAIL", /1 approved commission row \(\$500\) has sat unpaid for more than 35 days/);
  const young = { ...red, approved_at: days(10) };
  expect(t, await lane({ commission_ledger: [young], commission_rules: [r] }), "commissions:ledger", "PASS");
  const paid = { ...red, status: "paid", paid_at: days(5) };
  expect(t, await lane({ commission_ledger: [paid], commission_rules: [r] }), "commissions:ledger", "PASS");
  const demo = { ...red, is_demo: true };
  expect(t, await lane({ commission_ledger: [demo], commission_rules: [r] }), "commissions:ledger", "PASS");
});

test("ledger SQL: a row that names no rule, or a rule not in force on the sale date, is red", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const s = sale(c, { sold_at: days(30) });
  // Names no rule.
  let rows = await lane({ commission_ledger: [ledgerRow({ sale_id: s.id, rule_id: null })], sales: [s] });
  expect(t, rows, "commissions:ledger", "FAIL", /1 earned or approved row does not match a rate version \(1 name no rule\)/);
  // Names a rule that was closed before the sale.
  const closedBefore = rule({ effective_from: days(100), effective_to: days(60) });
  rows = await lane({ commission_ledger: [ledgerRow({ sale_id: s.id, rule_id: closedBefore.id })], sales: [s], commission_rules: [closedBefore] });
  expect(t, rows, "commissions:ledger", "FAIL", /1 name a rule that was not in force on the sale date/);
  // Names a rule that opened after the sale.
  const openedAfter = rule({ effective_from: days(10) });
  rows = await lane({ commission_ledger: [ledgerRow({ sale_id: s.id, rule_id: openedAfter.id })], sales: [s], commission_rules: [openedAfter] });
  expect(t, rows, "commissions:ledger", "FAIL", /not in force on the sale date/);
  // Names a rule of the other basis.
  const wrongBasis = rule({ basis: "back_end" });
  rows = await lane({ commission_ledger: [ledgerRow({ sale_id: s.id, basis: "front_end", rule_id: wrongBasis.id })], sales: [s], commission_rules: [wrongBasis] });
  expect(t, rows, "commissions:ledger", "FAIL", /not in force on the sale date/);
});

test("ledger SQL: a row whose rule was open on the sale date is green, even if the rule was closed since", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const s = sale(c, { sold_at: days(30) });
  const v1 = rule({ effective_from: days(100), effective_to: days(5) });
  const row = ledgerRow({ sale_id: s.id, rule_id: v1.id, basis: "front_end", status: "approved", approved_at: days(2) });
  const rows = await lane({ commission_ledger: [row], sales: [s], commission_rules: [v1] });
  expect(t, rows, "commissions:ledger", "PASS", /1 earned or approved row read/);
  // A reversal row has no rule and is not judged.
  const reversal = ledgerRow({ rule_id: null, reverses_ledger_id: uuid(), amount: -100 });
  expect(t, await lane({ commission_ledger: [reversal] }), "commissions:ledger", "PASS");
  // A voided row is not judged.
  expect(t, await lane({ commission_ledger: [ledgerRow({ status: "void", rule_id: null })] }), "commissions:ledger", "PASS");
  // With no sale on the row, the earned date stands in for the sale date.
  const noSale = ledgerRow({ rule_id: v1.id, basis: "front_end", earned_at: days(20) });
  expect(t, await lane({ commission_ledger: [noSale], commission_rules: [v1] }), "commissions:ledger", "PASS");
});

test("ledger SQL: two open base versions of one pay scope is red; bonus, inactive and different scopes are not", { skip: !HAS_DB }, async (t) => {
  const a = rule({ product_id: uuid() });
  const dup = { ...a, id: uuid() };
  expect(t, await lane({ commission_rules: [a, dup] }), "commissions:ledger", "FAIL", /1 pay scope has more than one open rate version/);
  const bonus = [{ ...a, stacking: "bonus" }, { ...dup, stacking: "bonus" }];
  expect(t, await lane({ commission_rules: bonus }), "commissions:ledger", "PASS");
  expect(t, await lane({ commission_rules: [a, { ...dup, active: false }] }), "commissions:ledger", "PASS");
  expect(t, await lane({ commission_rules: [a, { ...dup, role: "sales_manager" }] }), "commissions:ledger", "PASS");
  expect(t, await lane({ commission_rules: [a, { ...dup, product_id: uuid() }] }), "commissions:ledger", "PASS");
  expect(t, await lane({ commission_rules: [a, { ...dup, sale_motion: "upsell" }] }), "commissions:ledger", "PASS");
  // The closed older version and the open newer one are one chain, not two open versions.
  expect(t, await lane({ commission_rules: [{ ...a, effective_to: days(10) }, { ...dup, effective_from: days(10) }] }), "commissions:ledger", "PASS");
  expect(t, await lane({ commission_rules: [a, { ...dup, org_id: OTHER_ORG }] }), "commissions:ledger", "PASS");
});

/* ------------------------------------------------------------------ check 5: the ClickFunnels map */

function sloSale(c, productId, over = {}) {
  return sale(c, { product_id: productId, notes: "source:slo.clickfunnels", external_ref: `clickfunnels:order:${uuid()}:cfp1`, sold_at: days(3), ...over });
}

test("slo-map SQL: a sold product with no active map is red; with a map and a rule it is green", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const productId = uuid();
  const product = { id: productId, org_id: ORG, code: "slo-roadmap", name: "SLO Roadmap" };
  const base = { clients: [c], sales: [sloSale(c, productId), sloSale(c, productId)], products: [product] };
  const allRule = rule({ product_id: null });
  expect(t, await lane({ ...base, commission_rules: [allRule] }), "commissions:slo-map", "FAIL", /slo-roadmap \(sold 2 times\): no active map/);
  const map = { org_id: ORG, product_id: productId, active: true };
  expect(t, await lane({ ...base, slo_connections: [map], commission_rules: [allRule] }), "commissions:slo-map", "PASS", /1 product sold through ClickFunnels/);
  // A map that is switched off is not a map.
  expect(t, await lane({ ...base, slo_connections: [{ ...map, active: false }], commission_rules: [allRule] }), "commissions:slo-map", "FAIL", /no active map/);
  // A map for a different product is not this product's map.
  expect(t, await lane({ ...base, slo_connections: [{ ...map, product_id: uuid() }], commission_rules: [allRule] }), "commissions:slo-map", "FAIL", /no active map/);
});

test("slo-map SQL: the commission rule must be open now and cover the product and the motion", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const productId = uuid();
  const base = {
    clients: [c], sales: [sloSale(c, productId)], products: [{ id: productId, org_id: ORG, code: "slo-roadmap", name: "SLO Roadmap" }],
    slo_connections: [{ org_id: ORG, product_id: productId, active: true }]
  };
  expect(t, await lane({ ...base, commission_rules: [] }), "commissions:slo-map", "FAIL", /no commission rule is open for it/);
  // Its own rule is enough.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId })] }), "commissions:slo-map", "PASS");
  // A rule for another product is not.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: uuid() })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
  // A closed rule is not.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId, effective_to: days(1) })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
  // An inactive rule is not.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId, active: false })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
  // A back end rule is not a front end sale's rule.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId, basis: "back_end" })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
  // A downsell-only rule does not cover a plain sale.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId, sale_motion: "downsell" })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
  // A rule that opens later is not open now.
  expect(t, await lane({ ...base, commission_rules: [rule({ product_id: productId, effective_from: days(-5) })] }), "commissions:slo-map", "FAIL", /no commission rule is open/);
});

test("slo-map SQL: only ClickFunnels sales of the last 60 days are read", { skip: !HAS_DB }, async (t) => {
  const c = client();
  const productId = uuid();
  const nothing = (over) => lane({ clients: [c], sales: [sloSale(c, productId, over)] });
  expect(t, await lane({ clients: [c], sales: [sale(c, { product_id: productId })] }), "commissions:slo-map", "PASS", /no product has been sold through ClickFunnels/);
  expect(t, await nothing({ sold_at: days(61) }), "commissions:slo-map", "PASS", /no product has been sold through ClickFunnels/);
  expect(t, await nothing({ is_demo: true }), "commissions:slo-map", "PASS", /no product has been sold through ClickFunnels/);
  expect(t, await nothing({ status: "refunded" }), "commissions:slo-map", "PASS", /no product has been sold through ClickFunnels/);
  expect(t, await nothing({ org_id: OTHER_ORG }), "commissions:slo-map", "PASS", /no product has been sold through ClickFunnels/);
  // The order ref alone marks a ClickFunnels sale, as the notes alone do.
  expect(t, await nothing({ notes: null }), "commissions:slo-map", "FAIL", /no active map/);
  expect(t, await nothing({ external_ref: "seed_x" }), "commissions:slo-map", "FAIL", /no active map/);
});

/* ------------------------------------------------------------------ check 6: sample rows */

test("sample-rows SQL: the sample client and its fake payment and sale are red and counted", { skip: !HAS_DB }, async (t) => {
  const stamp = 1790000000000;
  const c = client({ email: `sample+${stamp}@fundhub.demo` });
  const tx = [
    { org_id: ORG, client_id: c.id, provider_ref: `seed_t32_${stamp}`, amount_paid: 32, is_demo: false },
    { org_id: ORG, client_id: c.id, provider_ref: `seed_tdep_${stamp}`, amount_paid: 3000, is_demo: false }
  ];
  const s = sale(c, { agreed_price: 3000, external_ref: `seed_tdep_${stamp}` });
  const rows = await lane({
    clients: [c], transactions: tx, sales: [s],
    messages: [{ org_id: ORG, client_id: c.id, is_demo: false }, { org_id: ORG, client_id: c.id, is_demo: false }]
  });
  expect(t, rows, "books:sample-rows", "FAIL", /1 sample client, 2 sample payments \(\$3,032\), 1 sale \(\$3,000\), 2 messages/);
});

test("sample-rows SQL: a real client, a flagged demo client, and the sim receipts are not red", { skip: !HAS_DB }, async (t) => {
  const real = client({ email: "maria.lopez@gmail.com" });
  const sim = { org_id: ORG, client_id: real.id, provider_ref: "sim-pay-1790742620460", amount_paid: 5000, is_demo: false };
  expect(t, await lane({ clients: [real], transactions: [sim], sales: [sale(real)] }), "books:sample-rows", "PASS");
  const flagged = client({ email: "sample+1790000000001@fundhub.demo", is_demo: true });
  expect(t, await lane({ clients: [flagged], sales: [sale(flagged)] }), "books:sample-rows", "PASS");
  const other = client({ email: "sample+1790000000002@fundhub.demo", org_id: OTHER_ORG });
  expect(t, await lane({ clients: [other] }), "books:sample-rows", "PASS");
});

test("sample-rows SQL: a seed payment finds its client even when the email was changed", { skip: !HAS_DB }, async (t) => {
  const c = client({ email: "someone.else@gmail.com" });
  const tx = { org_id: ORG, client_id: c.id, provider_ref: "seed_tdep_1790000000003", amount_paid: 3000, is_demo: false };
  const s = sale(c, { agreed_price: 3000 });
  const rows = await lane({
    clients: [c], transactions: [tx], sales: [s],
    commission_ledger: [ledgerRow({ client_id: c.id })], invoices: [bill({ id: uuid() }, c)]
  });
  expect(t, rows, "books:sample-rows", "FAIL", /1 sample client, 1 sample payment \(\$3,000\), 1 sale \(\$3,000\), 1 commission row, 1 invoice/);
});
