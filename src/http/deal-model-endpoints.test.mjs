/* /api/finance/model — the deal model, driven end to end against a stubbed
 * database. Plus the one-line defect next door in api/read/tradelines.mjs that
 * let a guardrail be switched off from the address bar.
 *
 * WHY IT LIVES HERE AND NOT NEXT TO THE HANDLER. package.json's test glob walks
 * src/ and scripts/ ONLY (CLAUDE.md, traps). A test placed under api/ is never
 * run by anything and reports nothing, forever. So the test sits in src/http/
 * and imports the api/ handler, which is what the rest of this directory does.
 *
 * WHY IT RUNS WITHOUT POSTGRES. src/db.mjs exports `db` as a plain object with a
 * single `query` method, so the session lookup, the ownership check, the trigger
 * configuration read and the tradelines read are all stubbed and the handler
 * runs exactly as it does in production. Same approach as
 * src/http/finance-liabilities.test.mjs, and for the same reason: THE TENANCY
 * BUG THIS GUARDS IS INVISIBLE ON A ONE-ORG DATABASE and every database this
 * repo has is a one-org database.
 *
 * THE FIVE THINGS THIS FILE EXISTS TO STOP:
 *
 *   1. A GUARDRAIL SWITCHED OFF FROM A URL. api/read/tradelines.mjs:65 took
 *      `?utilization_threshold=` and passed `Number(raw)` into calcFunding with
 *      no check. 0.99 disables the hard stop; "abc" becomes NaN, which loses
 *      every comparison, and disables it while looking like it ran.
 *
 *   2. A CROSS-TENANT READ. The org comes from the SESSION. A client id from
 *      another org must be refused before a card is read, so the tests assert on
 *      THE PARAMETERS ACTUALLY BOUND, not just on the status code.
 *
 *   3. A DEPOSIT CHARGED TWICE. The calculator's own test pins the
 *      arithmetic; this pins that the ENDPOINT does not undo it on the way out,
 *      because the number it returns is the one a closer reads to a client.
 *
 *   4. A FEE PERCENTAGE OFF BY A HUNDRED. "10" in the fee box means 10% to the
 *      person typing it and 1000% to the calculator — a $2.5M fee on a $250k
 *      round, computed without complaint.
 *
 *   5. AN UNKNOWN BECOMING A ZERO. A card with no recorded limit is not a card
 *      with no headroom, and a card with no recorded balance is not a card at 0%
 *      utilization — the second one makes the guardrail optimistic, which is the
 *      one direction a safety gate must not be wrong in.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import model from "../../api/finance/model.mjs";
import tradelinesRead from "../../api/read/tradelines.mjs";
import { ROLE_SETS } from "./read-api.mjs";
import { UTILIZATION_THRESHOLD_MAX } from "../calculators/deal-funding.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A; ORG_B's client id is what
   a mistaken or malicious caller pastes in. On a single-org database these are
   the same value and the hole is unobservable, which is why it survives. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CLIENT = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";

/* Two real cards. Amex is the cheaper money and must be drawn first whatever
   order the rows arrive in. Money is integer cents in the row, dollars in the
   answer — that conversion is the seam this endpoint is most likely to get
   wrong, so the fixtures are round numbers and the assertions are exact. */
const AMEX = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", org_id: ORG_A, client_id: CLIENT,
  lender: "Amex", kind: "revolving",
  credit_limit_cents: "1000000",  // $10,000
  balance_cents: "0",
  apr: "0.18990", closed_at: null
};
const CHASE = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", org_id: ORG_A, client_id: CLIENT,
  lender: "Chase Ink", kind: "revolving",
  credit_limit_cents: "500000",   // $5,000
  balance_cents: "0",
  apr: "0.24990", closed_at: null
};

let savedQuery = null;
beforeEach(() => { savedQuery = db.query; });
afterEach(() => { db.query = savedQuery; });

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/**
 * call(opts) — run a real handler against a stubbed database.
 *
 * Every query is recorded with its SQL and its bound parameters, because "which
 * rows was this allowed to reach" is a question only the parameters answer.
 */
async function call({
  handler = model,
  role = "owner",
  orgId = ORG_A,
  method = "POST",
  query = {},
  body = undefined,
  authenticated = true,
  owns = true,             // does the named client belong to the caller's org
  cards = [AMEX, CHASE],   // what listTradelines returns
  triggerRows = [],        // upsell_triggers rows for this org
  triggerError = null,     // the configuration read failing
  readError = null         // the tradelines read failing
} = {}) {
  const reads = [];
  db.query = async (sql, params) => {
    const s = String(sql);
    const record = (kind) => { reads.push({ kind, sql: s, params }); };

    if (/FROM\s+clients\s+WHERE\s+id/i.test(s)) {
      record("ownsClient");
      return { rows: owns ? [{ "?column?": 1 }] : [] };
    }
    if (/FROM\s+upsell_triggers/i.test(s)) {
      record("triggers");
      if (triggerError) throw triggerError;
      return { rows: triggerRows };
    }
    if (/FROM\s+tradelines/i.test(s)) {
      record("listTradelines");
      if (readError) throw readError;
      return { rows: cards };
    }
    // verifySession's CTE. One live session for a staff member with this role.
    if (!authenticated) return { rows: [] };
    return {
      rows: [{
        session_id: "sess-1",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        staff_id: "staff-1",
        org_id: orgId,
        role,
        email: `${role}@fundhub.ai`,
        name: role,
        status: "active",
        active_flag: "true"
      }]
    };
  };

  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query, body };
  const thrown = await handler(req, res).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, reads, thrown };
}

const post = (body, opts = {}) => call({ body, ...opts });
const kinds = (r) => r.reads.map((x) => x.kind);

/* ── the gate ──────────────────────────────────────────────────────────────── */

describe("who may reach the deal model at all", () => {

  test("an unrecognised session token is a 401 and reads nothing", async () => {
    const r = await post({}, { authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(kinds(r), []);
  });

  for (const role of [...ROLE_SETS.STAFF]) {
    test(`a ${role} may model a deal`, async () => {
      const r = await post({ approved_funding: 250000 }, { role });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.STAFF and was refused`);
    });
  }

  for (const role of ["partner", "client", "", null]) {
    test(`a session whose role is ${JSON.stringify(role)} is refused and reads nothing`, async () => {
      const r = await post({ approved_funding: 250000 }, { role });
      assert.equal(r.status, 403, "the gate is deny-by-default");
      assert.deepEqual(kinds(r), []);
    });
  }

  test("a session with NO org binds nothing and matches nothing — it fails CLOSED", async () => {
    const r = await post({ approved_funding: 1000 }, { orgId: null });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(kinds(r), [], "an org-less session reached the database");
  });

  test("GET is a 405 with an allow header — this endpoint computes, it does not list", async () => {
    const r = await call({ method: "GET" });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "POST");
  });

  for (const field of ["org_id", "orgId"]) {
    test(`a body carrying ${field} is refused — the org comes from the session`, async () => {
      const r = await post({ [field]: ORG_B, approved_funding: 1000 });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, `${field}_not_accepted`);
      assert.deepEqual(kinds(r), []);
    });
  }
});

/* ── tenancy ───────────────────────────────────────────────────────────────── */

describe("a client id in the body is not an authorisation", () => {

  test("a client belonging to another org is refused BEFORE a card is read", async () => {
    const r = await post({ client_id: OTHER_CLIENT, approved_funding: 250000 }, { owns: false });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "forbidden");
    assert.ok(!kinds(r).includes("listTradelines"),
      "another org's client had their cards read before the check refused them");
  });

  test("the ownership check binds the SESSION's org, never a supplied one", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000 });
    const own = r.reads.find((x) => x.kind === "ownsClient");
    assert.deepEqual(own.params, [CLIENT, ORG_A]);
  });

  test("the tradelines read is org-scoped too — belt and braces, both bound", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000 });
    const list = r.reads.find((x) => x.kind === "listTradelines");
    assert.ok(list, "no tradelines read happened at all");
    assert.equal(list.params[0], ORG_A, "the org id bound was not the session's");
    assert.equal(list.params[1], CLIENT);
  });

  test("the configuration read is org-scoped", async () => {
    const r = await post({ approved_funding: 1000 });
    const cfg = r.reads.find((x) => x.kind === "triggers");
    assert.deepEqual(cfg.params, [ORG_A]);
  });

  test("a client id that is not a uuid is a 400, not a database error", async () => {
    const r = await post({ client_id: "'; drop table clients; --", approved_funding: 1000 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /uuid/);
    assert.deepEqual(kinds(r), []);
  });
});

/* ── the money ─────────────────────────────────────────────────────────────── */

describe("net cash — the number somebody reads out loud", () => {

  test("the worked example arrives whole: funding, fee, deposit, net", async () => {
    const r = await post({ approved_funding: 250000, fee_pct: 0.10, down_payment: 3000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.units, "dollars", "the unit is not stated on the answer");
    const n = r.body.net;
    assert.equal(n.approved_funding, 250000);
    assert.equal(n.success_fee, 25000);
    assert.equal(n.deposit, 3000);
    assert.equal(n.net_cash_to_client, 225000);
    assert.equal(n.fee_from_proceeds, 22000);
    assert.equal(n.fee_paid_out_of_pocket, 3000);
  });

  test("a larger deposit credits the fee once through the endpoint", async () => {
    const small = await post({ approved_funding: 250000, fee_pct: 0.10, down_payment: 3000 });
    const large = await post({ approved_funding: 250000, fee_pct: 0.10, down_payment: 9000 });
    assert.equal(small.body.net.net_cash_to_client, 225000);
    assert.equal(large.body.net.net_cash_to_client, 225000);
    assert.equal(large.body.net.success_fee, 25000);
    assert.equal(large.body.net.fee_from_proceeds, 16000);
    assert.equal(large.body.net.fee_paid_out_of_pocket, 9000);
  });

  test("debts entered are a separate visible line and a separate subtraction", async () => {
    const r = await post({
      approved_funding: 250000, fee_pct: 0.10, down_payment: 3000, existing_debts: 12000
    });
    const n = r.body.net;
    assert.equal(n.existing_debts, 12000);
    assert.equal(n.net_cash_after_debts, 213000, "225,000 − 12,000");
    assert.equal(n.existing_debts_source, "entered_on_this_screen",
      "a typed assumption must not read as a stored deal term");
  });

  test("no debts entered is UNKNOWN, not zero", async () => {
    const r = await post({ approved_funding: 250000, fee_pct: 0.10 });
    assert.equal(r.body.net.existing_debts, null);
    assert.equal(r.body.net.net_cash_after_debts, null,
      "an unentered payoff produced a figure anyway");
    assert.equal(r.body.net.existing_debts_source, null);
  });

  test("no approved funding yields nulls and says so — never zeros", async () => {
    const r = await post({});
    assert.equal(r.status, 200);
    assert.equal(r.body.net.net_cash_to_client, null);
    assert.equal(r.body.net.success_fee, null);
    assert.ok(r.body.reasons.includes("no_approved_funding"));
  });

  test("money written the way a person writes it is read, to the cent", async () => {
    const r = await post({ approved_funding: "$250,000.00", fee_pct: 0.10 });
    assert.equal(r.body.net.approved_funding, 250000);
    assert.equal(r.body.net.success_fee, 25000);
  });

  test("the monthly obligation and the cliff come back computed", async () => {
    const r = await post({
      approved_funding: 250000, fee_pct: 0.10, intro_months: 12,
      post_intro_apr: 0.249, min_payment_pct: 0.02
    });
    assert.ok(r.body.deal.monthly.intro.month1Payment > 0);
    assert.equal(typeof r.body.deal.cliff.triggered, "boolean");
    assert.ok(r.body.deal.cliff.interest > 0, "the post-intro interest figure is missing");
  });
});

/* ── the inputs that are refused ───────────────────────────────────────────── */

describe("a number this endpoint cannot read is refused, never guessed", () => {

  test("a fee percentage written as 10 is refused — it would bill $2.5M on $250k", async () => {
    const r = await post({ approved_funding: 250000, fee_pct: 10 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /fraction, not a percentage/);
  });

  test("a negative amount is refused", async () => {
    const r = await post({ approved_funding: -250000 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /approved_funding/);
  });

  test("an amount that is not a number is refused, not treated as zero", async () => {
    const r = await post({ approved_funding: "lots" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /approved_funding/);
  });

  test("an empty box is UNSUPPLIED, not a bad value", async () => {
    const r = await post({ approved_funding: 250000, down_payment: "", existing_debts: "" });
    assert.equal(r.status, 200);
    assert.equal(r.body.net.deposit, 0, "calcDeal's own default for a deposit is zero");
    assert.equal(r.body.net.existing_debts, null);
  });

  test("an array in a money field is refused, not read as zero", async () => {
    // Number("") is 0 and [] stringifies to "", so an unguarded parser turns
    // this into a $0 line rather than a refusal.
    const r = await post({ approved_funding: 250000, existing_debts: [] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /existing_debts/);
  });

  test("a fractional month count is refused", async () => {
    const r = await post({ approved_funding: 250000, intro_months: 12.5 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /whole number of months/);
  });
});

/* ── the guardrail line ────────────────────────────────────────────────────── */

describe("the utilization threshold — where it comes from, and what is refused", () => {

  test("0.99 from a caller is refused: that is the guardrail switched off", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000, utilization_threshold: 0.99 });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "above_maximum");
    assert.match(r.body.error, /switches the guardrail off/);
    assert.ok(!kinds(r).includes("listTradelines"),
      "the deal was modelled anyway on a threshold the endpoint had already refused");
  });

  test("a threshold that is not a number is refused — NaN loses every comparison", async () => {
    const r = await post({ approved_funding: 250000, utilization_threshold: "abc" });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "not_a_number");
  });

  test("30 meaning 30% is refused with the convention named, not divided by a hundred", async () => {
    const r = await post({ approved_funding: 250000, utilization_threshold: 30 });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "not_a_fraction");
  });

  test("a threshold at the top of the band is accepted, and the answer says it came from the request", async () => {
    const r = await post({
      client_id: CLIENT, approved_funding: 250000, requested_amount: 1000,
      utilization_threshold: UTILIZATION_THRESHOLD_MAX
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.guardrail_threshold.value, UTILIZATION_THRESHOLD_MAX);
    assert.equal(r.body.guardrail_threshold.source, "request");
    assert.equal(r.body.funding.guardrail.threshold, UTILIZATION_THRESHOLD_MAX,
      "the calculator measured against a different line than the answer reports");
  });

  test("with nothing asked for, the org's configured line is used and named", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000, requested_amount: 1000 },
      { triggerRows: [{ threshold_bps: 2500 }] });
    assert.equal(r.body.guardrail_threshold.value, 0.25);
    assert.equal(r.body.guardrail_threshold.source, "org_configuration");
    assert.equal(r.body.funding.guardrail.threshold, 0.25);
  });

  test("an org that has configured nothing gets the standard line", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000, requested_amount: 1000 });
    assert.equal(r.body.guardrail_threshold.value, 0.30);
    assert.equal(r.body.guardrail_threshold.source, "default");
    assert.equal(r.body.guardrail_threshold.note, null);
  });

  test("an unset threshold on a stored rule is not a zero", async () => {
    const r = await post({ approved_funding: 250000 }, { triggerRows: [{ threshold_bps: null }] });
    assert.equal(r.body.guardrail_threshold.value, 0.30);
    assert.equal(r.body.guardrail_threshold.source, "default");
  });

  test("a configured threshold outside the band cannot smuggle the guardrail off either", async () => {
    // upsell_triggers CHECKs 0..100000 bps — up to 1000%. 9000% would be a
    // guardrail that never fires, stored rather than typed.
    const r = await post({ approved_funding: 250000 }, { triggerRows: [{ threshold_bps: 90000 }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.guardrail_threshold.value, 0.30, "a stored value bypassed the band");
    assert.equal(r.body.guardrail_threshold.source, "default");
    assert.match(r.body.guardrail_threshold.note, /outside the range/);
  });

  test("if the configuration cannot be read, the STRICTER line is used and the answer says so", async () => {
    const r = await post({ approved_funding: 250000 }, { triggerError: new Error("connection reset") });
    assert.equal(r.status, 200);
    assert.equal(r.body.guardrail_threshold.value, 0.30);
    assert.match(r.body.guardrail_threshold.note, /could not be read/);
  });
});

/* ── the waterfall ─────────────────────────────────────────────────────────── */

describe("the waterfall runs on stored cards or it does not run", () => {

  test("with no client named there is no funding block and the answer says why", async () => {
    const r = await post({ approved_funding: 250000, requested_amount: 12000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.funding, null);
    assert.equal(r.body.cards, null);
    assert.ok(r.body.reasons.includes("no_client_named"));
    assert.ok(!kinds(r).includes("listTradelines"));
  });

  test("a client with no cards on file is said out loud, not modelled against nothing", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000, requested_amount: 12000 },
      { cards: [] });
    assert.equal(r.body.funding, null, "a waterfall was drawn over cards nobody has recorded");
    assert.ok(r.body.reasons.includes("no_tradelines_on_file"));
    assert.equal(r.body.cards.on_file, 0);
  });

  test("a client whose only line is an auto loan has no drawable cards", async () => {
    const r = await post({ client_id: CLIENT, requested_amount: 12000 }, {
      cards: [{ ...AMEX, kind: "installment", lender: "Ally Auto" }]
    });
    assert.equal(r.body.funding, null);
    assert.ok(r.body.reasons.includes("no_drawable_cards_on_file"));
    assert.equal(r.body.cards.excluded_installment, 1);
  });

  test("cheapest money first, and the shortfall is reported", async () => {
    // Chase is listed first to prove the ORDER comes from the APR and not from
    // the row order. $18,000 asked against $15,000 of headroom.
    const r = await post({ client_id: CLIENT, requested_amount: 18000 }, { cards: [CHASE, AMEX] });
    const draws = r.body.funding.allocation.draws;
    assert.equal(draws[0].lender, "Amex", "the waterfall did not draw the cheapest money first");
    assert.equal(draws[0].draw, 10000);
    assert.equal(draws[1].lender, "Chase Ink");
    assert.equal(draws[1].draw, 5000);
    assert.equal(r.body.funding.allocation.shortfall, 3000);
    assert.equal(r.body.funding.allocation.fullyFunded, false);
  });

  test("cards but no amount asked for: headroom, no allocation, and the reason", async () => {
    const r = await post({ client_id: CLIENT, approved_funding: 250000 });
    assert.equal(r.body.funding.totalAvailableCredit, 15000);
    assert.equal(r.body.funding.allocation, null,
      "an allocation appeared for an amount nobody asked for");
    assert.ok(r.body.reasons.includes("no_requested_amount"));
  });

  test("a card with no recorded limit is counted as a hole, not as no headroom", async () => {
    const r = await post({ client_id: CLIENT, requested_amount: 5000 }, {
      cards: [AMEX, { ...CHASE, credit_limit_cents: null }]
    });
    assert.equal(r.body.cards.considered, 1);
    assert.equal(r.body.cards.excluded_no_credit_limit, 1,
      "the screen has no way to mark the total as a floor");
    const unpriced = r.body.cards.list.find((c) => c.lender === "Chase Ink");
    assert.equal(unpriced.credit_limit, null, "an unknown limit came back as a number");
  });

  test("a card with no recorded balance reports the unknown, not the zero the calculator saw", async () => {
    const r = await post({ client_id: CLIENT, requested_amount: 5000 }, {
      cards: [{ ...AMEX, balance_cents: null }, CHASE]
    });
    assert.equal(r.body.cards.balance_unknown, 1,
      "nothing tells the screen the guardrail is optimistic about this card");
    const amex = r.body.cards.list.find((c) => c.lender === "Amex");
    assert.equal(amex.current_balance, null, "an unknown balance was shown as $0.00");
    assert.equal(amex.balance_known, false);
  });

  test("an unpriced card is drawn LAST, after every card with a price", async () => {
    const r = await post({ client_id: CLIENT, requested_amount: 20000 }, {
      cards: [{ ...AMEX, apr: null }, CHASE]
    });
    const draws = r.body.funding.allocation.draws;
    assert.equal(draws[0].lender, "Chase Ink", "money of unknown price was offered first");
    assert.equal(r.body.cards.apr_unknown, 1);
  });
});

/* ── the guardrail verdict ─────────────────────────────────────────────────── */

describe("the guardrail is marginal, not absolute, and the endpoint keeps it that way", () => {

  test("a draw that crosses the line is a hard stop", async () => {
    // $10,000 limit, no balance, $4,000 drawn — 0% before, 40% after.
    const r = await post({ client_id: CLIENT, requested_amount: 4000 }, { cards: [AMEX] });
    assert.equal(r.body.funding.guardrail.hardStop, true);
    assert.equal(r.body.funding.guardrail.perCard[0].causedBreach, true);
    assert.match(r.body.funding.guardrail.message, /HARD STOP/);
  });

  test("a client already over the line is a NOTE, not a block — it is a pre-existing condition", async () => {
    /* Chase sits at 92% before anything is drawn, which puts the client at 30.7%
       across both cards before this deal exists. All $1,000 goes to Amex, which
       ends at 10%. Nothing this deal does crosses a line that was already
       crossed — an absolute 30% gate would refuse this client forever, at zero
       draw, for a balance that has nothing to do with this round. */
    const r = await post({ client_id: CLIENT, requested_amount: 1000 }, {
      cards: [AMEX, { ...CHASE, balance_cents: "460000" }]
    });
    const g = r.body.funding.guardrail;
    assert.equal(g.hardStop, false,
      "a pre-existing balance blocked a deal it has nothing to do with");
    const chase = g.perCard.find((c) => c.lender === "Chase Ink");
    assert.equal(chase.preExistingOver, true);
    assert.equal(chase.causedBreach, false);
    assert.match(g.message, /pre-existing/);
  });
});

/* ── the defect next door ──────────────────────────────────────────────────── */

describe("api/read/tradelines — the same threshold, validated by the same rule", () => {

  const readCall = (q, opts = {}) =>
    call({ handler: tradelinesRead, method: "GET", query: { client_id: CLIENT, ...q }, ...opts });

  test("?utilization_threshold=0.99 no longer switches the hard stop off", async () => {
    const r = await readCall({ requested_amount: 4000, utilization_threshold: "0.99" });
    assert.equal(r.status, 400, "the address bar can still disable the guardrail");
    assert.equal(r.body.reason, "above_maximum");
  });

  test("?utilization_threshold=abc is refused rather than becoming a silent NaN", async () => {
    // Number("abc") is NaN; every comparison against NaN is false, so the
    // guardrail reported no breach while looking like it had run.
    const r = await readCall({ requested_amount: 4000, utilization_threshold: "abc" });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "not_a_number");
  });

  test("a threshold inside the band still works", async () => {
    const r = await readCall({ requested_amount: 4000, utilization_threshold: "0.25" });
    assert.equal(r.status, 200);
    assert.equal(r.body.funding.guardrail.threshold, 0.25);
  });

  test("omitting it is not an error — the calculator's own default applies", async () => {
    const r = await readCall({ requested_amount: 4000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.funding.guardrail.threshold, 0.30);
  });

  test("an empty parameter is the same as omitting it", async () => {
    const r = await readCall({ requested_amount: 4000, utilization_threshold: "" });
    assert.equal(r.status, 200);
    assert.equal(r.body.funding.guardrail.threshold, 0.30);
  });
});
