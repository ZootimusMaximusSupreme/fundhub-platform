import {
  APPROVED_NO_AMOUNT_AFTER_MS, APPROVED_NO_AMOUNT_SQL, APPROVED_UNPAID_AFTER_MS, APPROVED_UNPAID_SQL,
  CARD_STACKING, CHECK_IDS, DAY_MS, FUNDED_BILL_WAIT_MS, FUNDED_CARDS_SQL, FUNDED_ROUNDS_SQL,
  HELD_PAYOUTS_SQL, LEDGER_RULE_SQL, LOOKBACK_MS, OPEN_VERSIONS_SQL, PAYOUT_HELD_AFTER_MS,
  SAMPLE_ROWS_SQL, SEED_CLIENT_EMAIL_RE, SEED_PAYMENT_REF_RE, SHOWN, SLO_PRODUCTS_SQL
} from "./money-funding-sql.mjs";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function clip(error) {
  return String((error && error.message) || error).replace(/\s+/g, " ").trim().slice(0, 160);
}

function dollars(value) {
  const amount = Math.round(num(value) * 100) / 100;
  const [whole, cents] = amount.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? `$${grouped}` : `$${grouped}.${cents}`;
}

function dayText(value) {
  const day = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(day.getTime())) return "an unknown day";
  return day.toISOString().slice(0, 10);
}

function who(value) {
  const code = value && value.client_code ? String(value.client_code).trim() : "";
  if (code) return code;
  const id = value && value.client_id ? String(value.client_id) : "";
  return id ? id.slice(0, 8) : "an unknown client";
}

function listed(items, shown = SHOWN) {
  const head = items.slice(0, shown).join("; ");
  const more = items.length > shown ? `; and ${items.length - shown} more` : "";
  return head + more;
}

export function roundProblems(round) {
  const out = [];
  const cardStacking = round.card_stacking === true;
  const bills = num(round.bills);
  const billsNothingOnPurpose = cardStacking && num(round.confirmed_approvals) === 0 && num(round.excluded_approvals) > 0;
  if (cardStacking && round.has_closeout !== true && !billsNothingOnPurpose) out.push("no closeout record");
  if (bills === 0 && !billsNothingOnPurpose) {
    let why;
    if (cardStacking && num(round.confirmed_approvals) === 0) {
      why = "no bank yes with a dollar amount is on the round";
    } else if (num(round.linked_sales) === 0) {
      why = "the round is linked to no sale, so no fee percent";
    } else if (!(num(round.fee_percent) > 0 && num(round.fee_percent) <= 100)) {
      why = "the sale agreed no success-fee percent";
    } else {
      why = "the bill workflow F-07 did not make one";
    }
    out.push(`no success-fee bill (${why})`);
  }
  if (num(round.back_end_staff) > 0 && num(round.commission_rows) === 0) {
    out.push(`no staff commission rows (${plural(num(round.back_end_staff), "staff member")} attributed)`);
  }
  return out;
}

export function judgeFundedBills({ rounds = [], cards = [] } = {}) {
  const id = "funding:funded-no-bill";
  const broken = [];
  for (const round of rounds) {
    const problems = roundProblems(round);
    if (problems.length) broken.push({ round, problems });
  }
  const roundsRead = rounds.length ? num(rounds[0].total) || rounds.length : 0;
  const cardsRead = cards.length ? num(cards[0].total) || cards.length : 0;
  if (broken.length === 0 && cards.length === 0) {
    const days = Math.round(LOOKBACK_MS / DAY_MS);
    if (roundsRead === 0) {
      return row(id, "PASS", `no round has been funded in the last ${days} days, so no bill is due to be checked`);
    }
    return row(
      id,
      "PASS",
      `${plural(roundsRead, "funded round")} in the last ${days} days each ${roundsRead === 1 ? "has" : "have"} its closeout, success-fee bill and commission rows`
    );
  }
  const parts = [];
  if (broken.length) {
    const lines = broken.map(({ round, problems }) => `${who(round)} round ${num(round.round_number) || "?"}: ${problems.join(", ")}`);
    parts.push(`${plural(broken.length, "funded round")} the money chain did not finish. ${listed(lines)}`);
  }
  if (cards.length) {
    const names = cards.map((card) => who(card));
    parts.push(
      `${plural(cardsRead, "card")} sit${cardsRead === 1 ? "s" : ""} in Funded on the card-stacking board but the client has no funded round, so nothing was billed (${listed(names, 5)})`
    );
  }
  return row(
    id,
    "FAIL",
    `${parts.join(". ")}.`,
    "Open the client's funding round and the funded card. Re-run the funded step so the closeout, the success-fee bill and the commission rows are made. The pulse does not fix this."
  );
}

export function judgeApprovedNoAmount({ rows = [] } = {}) {
  const id = "funding:approved-no-amount";
  if (rows.length === 0) return row(id, "PASS", "no bank yes older than a day is missing its dollar amount");
  const total = num(rows[0].total) || rows.length;
  const names = rows.map((answer) => `${answer.bank} (${who(answer)}, since ${dayText(answer.since)})`);
  return row(
    id,
    "FAIL",
    `${plural(total, "bank yes", "bank yes answers")} older than a day ${total === 1 ? "has" : "have"} no dollar amount, so ${total === 1 ? "it" : "they"} can never be billed. ${listed(names)}.`,
    "Open each file and type in the approved amount from the bank's answer, or mark the approval as not counting. The pulse does not fix this."
  );
}

export function heldReason(payout) {
  const bits = [];
  if (payout.kind === "partner") {
    if (payout.license_missing === true) bits.push("the partner agreement is not signed (agreement_signed_at is empty)");
  } else {
    if (payout.license_missing === true) bits.push("the partner license is not signed (partner_license_signed_at is empty)");
    if (payout.tax_missing === true) bits.push("the tax form is not on file (tax_form_received_at is empty)");
  }
  if (bits.length === 0) {
    const why = payout.hold_reason ? String(payout.hold_reason) : "no reason written";
    return `held as "${why}" but its stamps are now set, so the hold was never released`;
  }
  return bits.join(" and ");
}

export function judgeHeldPayouts({ rows = [] } = {}) {
  const id = "partners:payout-held";
  if (rows.length === 0) return row(id, "PASS", "no affiliate or partner payout is on hold");
  const total = num(rows[0].total) || rows.length;
  const sum = rows.reduce((amount, payout) => amount + num(payout.amount), 0);
  const lines = rows.map(
    (payout) => `${payout.who || "an unnamed payee"} ${dollars(payout.amount)}: ${heldReason(payout)} (held since ${dayText(payout.created_at)})`
  );
  return row(
    id,
    "FAIL",
    `${plural(total, "payout")} ${total === 1 ? "is" : "are"} on hold${total > rows.length ? "" : `, ${dollars(sum)} in all`}. ${listed(lines)}.`,
    "Get the missing license or tax form recorded for each person, then the next payout run can release the money. The pulse does not release or pay anything."
  );
}

export function judgeLedger({ approved = {}, rules = {}, open = {} } = {}) {
  const id = "commissions:ledger";
  const parts = [];
  const unpaid = num(approved.n);
  if (unpaid > 0) {
    parts.push(
      `${plural(unpaid, "approved commission row")} (${dollars(approved.dollars)}) ${unpaid === 1 ? "has" : "have"} sat unpaid for more than ${Math.round(APPROVED_UNPAID_AFTER_MS / DAY_MS)} days, the oldest approved ${dayText(approved.oldest)}`
    );
  }
  const noRule = num(rules.no_rule);
  const wrong = num(rules.wrong_version);
  if (noRule + wrong > 0) {
    const bits = [];
    if (noRule > 0) bits.push(`${noRule} name no rule`);
    if (wrong > 0) bits.push(`${wrong} name a rule that was not in force on the sale date`);
    parts.push(`${plural(noRule + wrong, "earned or approved row")} ${noRule + wrong === 1 ? "does" : "do"} not match a rate version (${bits.join(", ")})`);
  }
  const scopes = num(open.scopes);
  if (scopes > 0) {
    parts.push(`${plural(scopes, "pay scope")} ${scopes === 1 ? "has" : "have"} more than one open rate version, so the rate it pays is a coin flip`);
  }
  if (parts.length) {
    return row(
      id,
      "FAIL",
      `${parts.join(". ")}.`,
      "Open the commissions screen. Mark paid what was paid, void or correct a row that names no rate, and close the extra rate version. The pulse does not approve, pay or change a rate."
    );
  }
  const read = num(rules.read_rows);
  if (read === 0) {
    return row(id, "PASS", "the ledger has no earned or approved commission rows yet, and no pay scope has two open rate versions");
  }
  return row(
    id,
    "PASS",
    `${plural(read, "earned or approved row")} read: none is unpaid past ${Math.round(APPROVED_UNPAID_AFTER_MS / DAY_MS)} days, each names a rate version in force on its sale date, and no pay scope has two open versions`
  );
}

export function judgeSloMap({ rows = [] } = {}) {
  const id = "commissions:slo-map";
  const days = Math.round(LOOKBACK_MS / DAY_MS);
  if (rows.length === 0) {
    return row(id, "PASS", `no product has been sold through ClickFunnels in the last ${days} days, so there is no map to judge`);
  }
  const products = new Map();
  for (const value of rows) {
    const key = String(value.product_id || value.product);
    const current = products.get(key) || { product: value.product, sales: 0, mapped: true, ruled: true };
    current.sales += num(value.sales);
    current.mapped = current.mapped && value.mapped === true;
    current.ruled = current.ruled && value.ruled === true;
    products.set(key, current);
  }
  const bad = [];
  for (const product of products.values()) {
    const gaps = [];
    if (!product.mapped) gaps.push("no active map, so the next paid order for it is turned away");
    if (!product.ruled) gaps.push("no commission rule is open for it");
    if (gaps.length) bad.push(`${product.product} (sold ${plural(product.sales, "time")}): ${gaps.join(" and ")}`);
  }
  if (bad.length === 0) {
    return row(id, "PASS", `${plural(products.size, "product")} sold through ClickFunnels in the last ${days} days, and each has an active map and a commission rule`);
  }
  return row(
    id,
    "FAIL",
    `${plural(bad.length, "ClickFunnels product")} ${bad.length === 1 ? "is" : "are"} not set up. ${listed(bad)}.`,
    "Open the SLO connections tab and map the ClickFunnels product to the Fundhub product, and add the commission rule on the commissions tab. The pulse does not change a map or a rate."
  );
}

export function judgeSampleRows({ counts = {} } = {}) {
  const id = "books:sample-rows";
  const found = {
    clients: num(counts.clients),
    payments: num(counts.payments),
    sales: num(counts.sales),
    commission_rows: num(counts.commission_rows),
    invoices: num(counts.invoices),
    messages: num(counts.messages)
  };
  const total = found.clients + found.payments + found.sales + found.commission_rows + found.invoices + found.messages;
  if (total === 0) return row(id, "PASS", "no sample client or sample payment from the dashboard seed tool is in the live books");
  const bits = [];
  if (found.clients) bits.push(plural(found.clients, "sample client"));
  if (found.payments) bits.push(`${plural(found.payments, "sample payment")} (${dollars(counts.payment_dollars)})`);
  if (found.sales) bits.push(`${plural(found.sales, "sale")} (${dollars(counts.sale_dollars)})`);
  if (found.commission_rows) bits.push(plural(found.commission_rows, "commission row"));
  if (found.invoices) bits.push(plural(found.invoices, "invoice"));
  if (found.messages) bits.push(plural(found.messages, "message"));
  return row(
    id,
    "FAIL",
    `The dashboard sample-client tool left fake money in the live books: ${bits.join(", ")}. They count toward real totals.`,
    "Flag these rows as demo or remove them (the sim purge script reports them first). Do not use the sample-client tool on the live company. The pulse does not delete anything."
  );
}

async function fundedNoBill(read, orgId, now) {
  const newerThan = new Date(now.getTime() - FUNDED_BILL_WAIT_MS);
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const rounds = await read(FUNDED_ROUNDS_SQL, [orgId, newerThan, olderThan, CARD_STACKING]);
  const cards = await read(FUNDED_CARDS_SQL, [orgId, newerThan, olderThan]);
  return judgeFundedBills({ rounds: rounds.rows || [], cards: cards.rows || [] });
}

async function approvedNoAmount(read, orgId, now) {
  const newerThan = new Date(now.getTime() - APPROVED_NO_AMOUNT_AFTER_MS);
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const result = await read(APPROVED_NO_AMOUNT_SQL, [orgId, newerThan, olderThan]);
  return judgeApprovedNoAmount({ rows: result.rows || [] });
}

async function payoutHeld(read, orgId, now) {
  const olderThan = new Date(now.getTime() - PAYOUT_HELD_AFTER_MS);
  const result = await read(HELD_PAYOUTS_SQL, [orgId, olderThan]);
  return judgeHeldPayouts({ rows: result.rows || [] });
}

async function ledger(read, orgId, now) {
  const cutoff = new Date(now.getTime() - APPROVED_UNPAID_AFTER_MS);
  const approved = await read(APPROVED_UNPAID_SQL, [orgId, cutoff]);
  const rules = await read(LEDGER_RULE_SQL, [orgId]);
  const open = await read(OPEN_VERSIONS_SQL, [orgId]);
  return judgeLedger({
    approved: (approved.rows || [])[0] || {},
    rules: (rules.rows || [])[0] || {},
    open: (open.rows || [])[0] || {}
  });
}

async function sloMap(read, orgId, now) {
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const result = await read(SLO_PRODUCTS_SQL, [orgId, now, olderThan]);
  return judgeSloMap({ rows: result.rows || [] });
}

async function sampleRows(read, orgId) {
  const result = await read(SAMPLE_ROWS_SQL, [orgId, SEED_CLIENT_EMAIL_RE, SEED_PAYMENT_REF_RE]);
  return judgeSampleRows({ counts: (result.rows || [])[0] || {} });
}

/** Run the exact W1 reads and verdicts with an injected read-only query function. */
export async function runMoneyFundingChecks({ read, orgId, now } = {}) {
  if (typeof read !== "function") {
    return CHECK_IDS.map((id) => row(id, "skip", "no database in this run, so the money books were not read"));
  }
  if (typeof orgId !== "string" || !orgId) {
    return CHECK_IDS.map((id) => row(id, "skip", "no company id in this run, so the money books were not read"));
  }
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  async function safely(id, work) {
    try {
      return await work();
    } catch (error) {
      return row(id, "skip", `could not read the books for this check: ${clip(error)}`);
    }
  }
  return Promise.all([
    safely("funding:funded-no-bill", () => fundedNoBill(read, orgId, clock)),
    safely("funding:approved-no-amount", () => approvedNoAmount(read, orgId, clock)),
    safely("partners:payout-held", () => payoutHeld(read, orgId, clock)),
    safely("commissions:ledger", () => ledger(read, orgId, clock)),
    safely("commissions:slo-map", () => sloMap(read, orgId, clock)),
    safely("books:sample-rows", () => sampleRows(read, orgId))
  ]);
}
