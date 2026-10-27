// Finish-853 batch 02: the eight live display checks, run as the exact SQL text the lane runs.
// (Repair cycle 1 widened them: see the manifest. Each wrong-result case below is one real way the
// control's saved result can be wrong, and each is red on its own.)
//
// There is no Postgres on this Mac, so each contract's text is run on an in-memory database
// whose tables carry the REAL column names (fin-b02-sql-kit.mjs reads db/schema and
// db/migrations). Each check gets: a good result (green), the empty case (quiet), one wrong
// result per way it can be wrong (red), and another company's wrong result (not counted).
// A column the product does not have makes the test throw, so a typo cannot hide.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeStandIn, REPO_ROOT } from "./fin-b02-sql-kit.mjs";
import {
  FIN_B02_DISPLAY_CASES,
  FIN_B02_HERO_READY_CONTRACT,
  FIN_B02_HERO_LIVE_TEST,
  FIN_B02_HERO_TEST,
  FIN_B02_LIVE_ROWS,
  FIN_B02_LIVE_TEST,
  FIN_B02_RESULT_CONTRACTS,
  PRIMARY_PAY_OFFER_KEYS,
} from "./fin-b02-display-contracts.mjs";
import { DISPLAY_RESULT_CONTRACTS, displaySavedResultContract } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { getOffer } from "../../../config/offers.mjs";
import { MAGIC_LINK_TEMPLATE_KEY } from "../../../auth/magic-link.mjs";
import { INVOICE_TEMPLATE_KEY } from "../../../invoices/notify.mjs";
import { STAFF_TASK_ROLE, STAFF_TASK_SOURCE } from "../../../finance/money-tasks.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function ago(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function contractFor(control) {
  const hit = displaySavedResultContract({ control });
  assert.ok(hit, `no contract for: ${control}`);
  return hit;
}

/**
 * One scenario: seed(s, org) writes a GOOD result for a company. Each wrong[] entry says how to
 * make that one result wrong (it gets the seed, then its own change runs against the stand-in).
 */
function suite(title, control, tables, seed, wrong, { windowed = true } = {}) {
  const contract = contractFor(control);
  const withStandIn = (fn) => {
    const s = makeStandIn(tables);
    try { return fn(s); } finally { s.close(); }
  };

  test(`${title}: contract is read-only, quiet when empty, and names the company`, () => {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.match(contract.sql, /\$1::uuid/);
    assert.doesNotMatch(contract.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    withStandIn((s) => {
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
    });
    // Empty reads as green, with the words that say nothing was judged yet.
    const verdict = judgeDisplayResult(
      { id: "x", control, surface: "s", contract },
      { sample_count: 0, bad_count: 0 },
    );
    assert.equal(verdict.status, "PASS");
    assert.match(verdict.detail, /no saved results yet/);
  });

  test(`${title}: a good saved result is counted and passes`, () => {
    withStandIn((s) => {
      seed(s, ORG);
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
    });
  });

  for (const [label, change] of wrong) {
    test(`${title}: ${label} goes red`, () => {
      withStandIn((s) => {
        seed(s, ORG, change);
        assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 }, label);
      });
    });
  }

  test(`${title}: another company's wrong result is not counted`, () => {
    withStandIn((s) => {
      seed(s, ORG);
      seed(s, OTHER, wrong[0][1]);
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
      assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 1 });
    });
  });

  if (windowed) {
    test(`${title}: a result older than 60 days is not judged`, () => {
      withStandIn((s) => {
        seed(s, ORG, { ...wrong[0][1], old: true });
        assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
      });
    });
  }
}

// A seed takes a `change` object. Keys are named per scenario; `old` ages the result to 90 days.
const id = (org, name) => `${name}-${org.slice(0, 4)}`;

/* ── 1. Send soft pull ───────────────────────────────────────────────────── */
const STAMP = "closer_deck_soft_pull_link_id";
suite(
  "send soft pull",
  FIN_B02_RESULT_CONTRACTS[0].control,
  ["messages", "payment_links", "clients"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const link = id(org, "link");
    const when = ago(c.old ? 90 : 1);
    const checkout = `https://checkout.example/pay/${link}`;
    const approve = `https://fundhub.ai/app/soft-pull-approve.html?org=${org}&client=${c.approveFor || client}&exp=1&sig=abc`;
    s.insert("clients", {
      id: client, org_id: org, phone: c.noPhone ? null : "phone-on-file",
      custom_fields: { [STAMP]: link, closer_deck_soft_pull_sent_at: when },
    });
    if (!c.noLink) {
      s.insert("payment_links", {
        id: link, org_id: org, client_id: c.otherClient ? "someone-else" : client,
        purpose: c.purpose || "diagnostic", amount_cents: c.amount ?? 3200, status: "sent",
        checkout_url: c.noCheckoutUrl ? null : (c.checkoutHasClient ? `${checkout}?client=${client}` : checkout),
      });
    }
    const form = c.noApproveLink ? "" : `<p><a href="${approve}">Open soft-pull authorization form</a></p>`;
    const payUrl = c.checkoutHasClient ? `${checkout}?client=${client}` : checkout;
    const body = "body" in c ? c.body : `${form}<p><a href="${c.badCheckout ? "https://elsewhere.example/x" : payUrl}">Pay</a></p>`;
    s.insert("messages", {
      id: id(org, "m-email"), org_id: org, client_id: client, direction: c.direction || "outbound",
      channel: c.channel || "email", provider_ref: `staff:soft-pull-send:${link}`,
      to_address: c.toAddress ?? "email-on-file", status: c.status || "sent", rendered_body: body, created_at: when,
    });
    if (!c.noSms) {
      s.insert("messages", {
        id: id(org, "m-sms"), org_id: org, client_id: client, direction: "outbound", channel: "sms",
        provider_ref: `staff:soft-pull-sms:${link}`, to_address: "phone-on-file", created_at: when,
      });
    }
  },
  [
    ["the pay link is missing", { noLink: true }],
    ["the pay link is for $31 not the catalog price", { amount: 3100 }],
    ["the link is not a diagnostic link", { purpose: "deposit" }],
    ["the link belongs to another client", { otherClient: true }],
    ["the approval email has no address", { toAddress: "" }],
    ["the first message is not an email", { channel: "sms" }],
    ["the client has a phone and no text was written", { noSms: true }],
    ["the email failed", { status: "failed" }],
    ["the email was blocked", { status: "blocked" }],
    ["the email carries no approval form and no pay link", { body: "<p>Hi there</p>" }],
    ["the email has no body at all", { body: null }],
    ["the email carries the pay link and no approval form", { noApproveLink: true }],
    ["the email carries no approval form, and the pay link's own address happens to name the client", { noApproveLink: true, checkoutHasClient: true }],
    ["the pay link has no checkout address to put in the email", { noCheckoutUrl: true }],
    ["the approval form in the email is another client's", { approveFor: "someone-else" }],
    ["the email does not carry the pay link's own checkout address", { badCheckout: true }],
  ],
);

test("send soft pull: a client with no phone number needs no text row", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[0].control);
  const s = makeStandIn(["messages", "payment_links", "clients"]);
  try {
    s.insert("clients", { id: "c", org_id: ORG, phone: null });
    s.insert("payment_links", { id: "l", org_id: ORG, client_id: "c", purpose: "diagnostic", amount_cents: 3200, status: "sent", checkout_url: "https://checkout.example/pay/l" });
    s.insert("messages", {
      id: "m", org_id: ORG, client_id: "c", direction: "outbound", channel: "email", provider_ref: "staff:soft-pull-send:l",
      to_address: "email-on-file", status: "queued", created_at: ago(1),
      rendered_body: "go: https://fundhub.ai/app/soft-pull-approve.html?org=o&client=c&exp=1&sig=s and https://checkout.example/pay/l",
    });
    // queued (waiting to leave) is not a failure
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});

test("send soft pull: a client the deck stamped as sent, whose email row is gone, goes red", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[0].control);
  const s = makeStandIn(["messages", "payment_links", "clients"]);
  try {
    s.insert("clients", { id: "c", org_id: ORG, custom_fields: { [STAMP]: "link-9", closer_deck_soft_pull_sent_at: ago(2) } });
    s.insert("payment_links", { id: "link-9", org_id: ORG, client_id: "c", purpose: "diagnostic", amount_cents: 3200, status: "sent" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 });
    // a stamp older than the window, a demo client and another company's client are not judged
    s.insert("clients", { id: "c-old", org_id: ORG, custom_fields: { [STAMP]: "link-8", closer_deck_soft_pull_sent_at: ago(90) } });
    s.insert("clients", { id: "c-demo", org_id: ORG, is_demo: true, custom_fields: { [STAMP]: "link-7", closer_deck_soft_pull_sent_at: ago(2) } });
    s.insert("clients", { id: "c-other", org_id: OTHER, custom_fields: { [STAMP]: "link-6", closer_deck_soft_pull_sent_at: ago(2) } });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 });
    assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 1 });
  } finally { s.close(); }
});

/* ── 2. S-23 sale motion ─────────────────────────────────────────────────── */
suite(
  "sale motion",
  FIN_B02_RESULT_CONTRACTS[1].control,
  ["messages", "payment_links"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const link = id(org, "link");
    s.insert("payment_links", {
      id: link, org_id: org, client_id: c.otherClient ? "someone-else" : client,
      description: c.description || "Capital Blueprint", purpose: "custom", amount_cents: 500000,
      status: "sent", sale_motion: "sale_motion" in c ? c.sale_motion : "upsell",
    });
    if (c.noLink) s.db.exec(`DELETE FROM payment_links WHERE id = '${link}'`);
    s.insert("messages", {
      id: id(org, "m"), org_id: org, client_id: client, direction: "outbound", channel: "email",
      provider_ref: `staff:pay-link-send:${link}`, created_at: ago(c.old ? 90 : 1),
    });
  },
  [
    ["a Capital Blueprint link was sent with no downsell or upsell", { sale_motion: null }],
    ["a primary offer link carries a motion", { description: "Funding, done-for-you", sale_motion: "downsell" }],
    ["the sent pay link is missing", { noLink: true }],
    ["the link belongs to another client", { otherClient: true }],
  ],
);

test("sale motion: a primary offer with no motion, and a blueprint with a downsell, are both fine", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[1].control);
  const s = makeStandIn(["messages", "payment_links"]);
  try {
    s.insert("payment_links", { id: "a", org_id: ORG, client_id: "c", description: "Funding, done-for-you", purpose: "deposit", amount_cents: 300000, status: "sent", sale_motion: null });
    s.insert("messages", { id: "ma", org_id: ORG, client_id: "c", provider_ref: "staff:pay-link-send:a", created_at: ago(1) });
    s.insert("payment_links", { id: "b", org_id: ORG, client_id: "c", description: "Capital Blueprint", purpose: "custom", amount_cents: 500000, status: "sent", sale_motion: "downsell" });
    s.insert("messages", { id: "mb", org_id: ORG, client_id: "c", provider_ref: "staff:pay-link-send:b", created_at: ago(1) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 0 });
  } finally { s.close(); }
});

test("sale motion: primary offers in the SQL and the assessment skip a motion", () => {
  const closerDeck = fs.readFileSync(path.join(REPO_ROOT, "src/sales/closer-deck.mjs"), "utf8");
  const set = /primaryPayOffers = new Set\(\[([^\]]+)\]\)/.exec(closerDeck);
  assert.ok(set, "the primaryPayOffers set moved in src/sales/closer-deck.mjs");
  const keys = [...set[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["SOFT_PULL", ...PRIMARY_PAY_OFFER_KEYS]);
  const presentJs = fs.readFileSync(path.join(REPO_ROOT, "public/app/present.js"), "utf8");
  for (const key of keys) assert.ok(presentJs.includes(`"${key}"`));
});

/* ── 3. Amount paid today ────────────────────────────────────────────────── */
const REPAIR_TABLES = ["repair_programs", "clients", "payment_links", "sales", "products", "sale_payments"];
const FULL_CENTS = getOffer("REPAIR_DFY").priceCents;
const TRIAL_CENTS = getOffer("REPAIR_TRIAL").priceCents;

/**
 * One repair program, good unless `c` says otherwise: a full program at the catalog price, paid in
 * full by a paid repair pay link the same day. Keys: program, cap, price, paid, noPayment,
 * linkPurpose, linkStatus, linkCents, linkDaysAfter, sale (agreed price in dollars), salePaid.
 */
function repairProgram(s, org, c = {}) {
  const client = id(org, "client");
  const created = ago(c.old ? 90 : 3);
  s.insert("clients", { id: client, org_id: org, is_demo: c.demo === true });
  const program = c.program || "full";
  const catalog = (program === "trial" ? TRIAL_CENTS : FULL_CENTS) / 100;
  s.insert("repair_programs", {
    id: id(org, "rp"), org_id: org, client_id: client, program,
    rounds_cap: c.cap ?? (program === "trial" ? 2 : 6), price_total: c.price ?? catalog, amount_paid: c.paid ?? catalog,
    status: "active", created_at: created,
  });
  if (!c.noPayment && !c.sale) {
    const cents = c.linkCents ?? Math.round(catalog * 100);
    const paidAt = c.linkDaysAfter ? ago((c.old ? 90 : 3) - c.linkDaysAfter) : created;
    s.insert("payment_links", {
      id: id(org, "link"), org_id: org, client_id: client, purpose: c.linkPurpose || "repair",
      status: c.linkStatus || "paid", amount_cents: cents, paid_amount_cents: cents, paid_at: paidAt,
    });
  }
  if (c.sale != null) {
    s.insert("products", { id: id(org, "prod"), org_id: org, code: "repair-bundle", category: c.saleCategory || "repair" });
    s.insert("sales", { id: id(org, "sale"), org_id: org, client_id: c.saleOfOther ? "someone-else" : client, product_id: id(org, "prod"), agreed_price: c.sale, status: "active" });
    if (c.salePaid) {
      const paidAt = c.salePaidDaysAfter ? ago((c.old ? 90 : 3) - c.salePaidDaysAfter) : created;
      s.insert("sale_payments", { id: id(org, "sp"), org_id: org, sale_id: id(org, "sale"), amount: c.salePaid, paid_at: paidAt });
    }
  }
  return client;
}

suite(
  "amount paid today",
  FIN_B02_RESULT_CONTRACTS[2].control,
  REPAIR_TABLES,
  repairProgram,
  [
    ["more was paid than the program costs", { paid: 1500 }],
    ["a negative amount was saved as paid", { paid: -5 }],
    ["a trial program has the full round cap", { program: "trial", cap: 6 }],
    ["a full program has the trial round cap", { cap: 2 }],
    ["the price saved is $1, not the catalog price and not any sale's price", { price: 1, paid: 1, linkCents: 100 }],
    ["the price saved is above the catalog price and no sale agreed to it", { price: 1200, paid: 1200, linkCents: 120000 }],
    ["an amount is saved as paid and no payment is on file", { noPayment: true }],
    ["the saved amount paid is more than the money on file", { linkCents: 50000 }],
    ["the only payment on file is a deposit link, not repair money", { linkPurpose: "deposit" }],
    ["the repair pay link was never paid", { linkStatus: "sent" }],
    ["the client paid in full before the program was made and the box saved $0", { paid: 0 }],
    ["the client's repair sale paid the whole price before the program was made and the box saved $0", { sale: 1000, price: 1000, paid: 0, salePaid: 1000 }],
    ["a sale of another product at the same wrong price does not excuse the price", { sale: 1, price: 1, paid: 0, saleCategory: "funding" }],
    ["another client's repair sale at the same wrong price does not excuse the price", { sale: 1, price: 1, paid: 0, saleOfOther: true }],
    ["the money on file is a sale's payments of another product, not repair money", { sale: 1000, price: 1000, paid: 1000, saleCategory: "funding", salePaid: 1000 }],
  ],
  { windowed: false },
);

test("amount paid today: a deposit below the price, a discounted sale, and a later payment are all fine", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[2].control);
  const s = makeStandIn(REPAIR_TABLES);
  try {
    // a $50 deposit on a trial, with a $50 paid link
    repairProgram(s, ORG, { program: "trial", paid: 50, linkCents: 5000 });
    // a program sold at an agreed $800 (discounted), paid $800 through its sale's payments
    repairProgram(s, OTHER, { sale: 800, price: 800, paid: 800, salePaid: 800 });
    // the client paid the whole price AFTER the program was made: the box said $0 at the time, which is true
    const THIRD = "33333333-3333-4333-8333-333333333333";
    repairProgram(s, THIRD, { paid: 0, linkDaysAfter: 2 });
    // the same, through the repair sale's payments
    const FOURTH = "44444444-4444-4444-8444-444444444444";
    repairProgram(s, FOURTH, { sale: 1000, price: 1000, paid: 0, salePaid: 1000, salePaidDaysAfter: 2 });
    // a free program: nothing was owed, so nothing paid is not a lost payment
    const FIFTH = "55555555-5555-4555-8555-555555555555";
    s.insert("clients", { id: "client-free", org_id: FIFTH, is_demo: false });
    s.insert("repair_programs", { id: "rp-free", org_id: FIFTH, client_id: "client-free", program: "trial", rounds_cap: 2, price_total: 0, amount_paid: 0, status: "active", created_at: ago(2) });
    s.insert("products", { id: "prod-free", org_id: FIFTH, code: "repair-trial", category: "repair" });
    s.insert("sales", { id: "sale-free", org_id: FIFTH, client_id: "client-free", product_id: "prod-free", agreed_price: 0, status: "active" });
    s.insert("sale_payments", { id: "sp-free", org_id: FIFTH, sale_id: "sale-free", amount: 0, paid_at: ago(2) });
    // the free program's price is not the catalog price, but its own sale agreed to $0
    // a deposit link of the full price, paid before, is not repair money: the box saying $0 is not a lost payment
    const SIXTH = "66666666-6666-4666-8666-666666666666";
    repairProgram(s, SIXTH, { paid: 0, linkPurpose: "deposit" });
    // a repair link that expired is not money either, even with a paid-at on it
    const SEVENTH = "77777777-7777-4777-8777-777777777777";
    repairProgram(s, SEVENTH, { paid: 0, linkStatus: "expired" });
    assert.deepEqual(s.run(contract.sql, SIXTH), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, SEVENTH), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, THIRD), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, FOURTH), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, FIFTH), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});

test("amount paid today: rows with no timestamps are judged (a paid link with no paid-at counts as paid before)", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[2].control);
  const s = makeStandIn(REPAIR_TABLES);
  try {
    s.insert("clients", { id: "c", org_id: ORG, is_demo: false });
    // the program row carries no created_at at all: still judged on money (the table always has one)
    s.insert("repair_programs", { id: "r", org_id: ORG, client_id: "c", program: "full", rounds_cap: 6, price_total: 1, amount_paid: 1, status: "active" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 }, "price 1 is not the catalog price");
    s.db.exec("UPDATE repair_programs SET price_total = 1000, amount_paid = 0");
    s.insert("payment_links", { id: "l", org_id: ORG, client_id: "c", purpose: "repair", status: "paid", amount_cents: 100000 });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 }, "paid in full by a link, saved as $0, no timestamps");
    // the same, through a repair sale's payment with no paid-at
    s.db.exec("DELETE FROM payment_links");
    s.insert("products", { id: "pr", org_id: ORG, code: "repair-bundle", category: "repair" });
    s.insert("sales", { id: "sa", org_id: ORG, client_id: "c", product_id: "pr", agreed_price: 1000, status: "active" });
    s.insert("sale_payments", { id: "sp", org_id: ORG, sale_id: "sa", amount: 1000 });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 }, "paid in full by a sale payment, saved as $0, no timestamps");
  } finally { s.close(); }
});

test("amount paid today: a demo client is not judged, and an old program is judged only on bounds and caps", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[2].control);
  const s = makeStandIn(REPAIR_TABLES);
  try {
    repairProgram(s, ORG, { demo: true, paid: 999, price: 100, noPayment: true });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
  const t = makeStandIn(REPAIR_TABLES);
  try {
    // 90 days old, no payment on file and an odd price: an import, not this control's result
    repairProgram(t, ORG, { old: true, noPayment: true, price: 1, paid: 1 });
    assert.deepEqual(t.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { t.close(); }
});

test("amount paid today: the catalog prices in the SQL are the two repair prices", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[2].control);
  assert.match(contract.sql, new RegExp(`THEN ${TRIAL_CENTS} ELSE ${FULL_CENTS} END`));
  assert.equal(TRIAL_CENTS, 20000);
  assert.equal(FULL_CENTS, 100000);
});

/* ── 4. email_invoice_backlog ────────────────────────────────────────────── */
suite(
  "invoice backlog email",
  FIN_B02_RESULT_CONTRACTS[3].control,
  ["invoices", "messages"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const inv = id(org, "inv");
    const msg = id(org, "msg");
    const when = ago(c.old ? 90 : 1);
    const stamped = c.unstamped !== true;
    s.insert("invoices", {
      id: inv, org_id: org, client_id: client, status: "sent", amount_due: 250,
      emailed_at: stamped ? when : null,
      email_message_id: stamped && !c.noLink ? msg : null,
      is_demo: c.demo === true,
    });
    s.insert("messages", {
      id: msg, org_id: org, client_id: c.otherClient ? "someone-else" : client, direction: c.direction || "outbound",
      channel: c.channel || "email", template_key: c.template || INVOICE_TEMPLATE_KEY,
      provider_ref: c.otherInvoice ? "invoice:some-other-invoice:sent" : `invoice:${inv}:sent`, status: c.status || "queued",
      to_address: c.toAddress ?? "email-on-file", created_at: when,
    });
  },
  [
    ["an invoice is stamped emailed with no email message linked", { noLink: true }],
    ["the linked email belongs to another client", { otherClient: true }],
    ["the linked message is not an email", { channel: "sms" }],
    ["the linked email has no address", { toAddress: "" }],
    ["the linked email is an unrelated template's email, not the invoice email", { template: "EMAIL-OFFER-SOFT-PULL" }],
    ["the linked email is another invoice's email", { otherInvoice: true }],
    ["the linked email failed, so the client was never told", { status: "failed" }],
    ["the linked email was blocked, so the client was never told", { status: "blocked" }],
    ["the client was emailed but the invoice still reads never emailed", { unstamped: true }],
  ],
);

test("invoice backlog email: an email that is queued, sent or delivered is a client who was told", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[3].control);
  const s = makeStandIn(["invoices", "messages"]);
  try {
    for (const [i, status] of ["queued", "sent", "delivered"].entries()) {
      s.insert("invoices", { id: `i${i}`, org_id: ORG, client_id: "c", status: "sent", amount_due: 100, emailed_at: ago(1), email_message_id: `m${i}` });
      s.insert("messages", { id: `m${i}`, org_id: ORG, client_id: "c", direction: "outbound", channel: "email", template_key: INVOICE_TEMPLATE_KEY, provider_ref: `invoice:i${i}:sent`, to_address: "email-on-file", status, created_at: ago(1) });
    }
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 3, bad_count: 0 });
  } finally { s.close(); }
});

test("invoice backlog email: the backlog itself (sent, never emailed, no message) is not wrong", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[3].control);
  const s = makeStandIn(["invoices", "messages"]);
  try {
    s.insert("invoices", { id: "i1", org_id: ORG, client_id: "c", status: "sent", amount_due: 100, emailed_at: null, email_message_id: null });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});

test("invoice backlog email: the 'bounded to 200' half is held by the route test, and the handler still says 200", () => {
  const route = fs.readFileSync(path.join(REPO_ROOT, "src/http/s2-message-routes-outbound.test.mjs"), "utf8");
  assert.match(route, /the backlog emails every never-sent invoice once and the bound is 200/);
  assert.match(route, /read\.params\[1\], 200/);
  const handler = fs.readFileSync(path.join(REPO_ROOT, "api/messages-outbound.mjs"), "utf8");
  assert.match(handler, /Math\.min\(Number\(body\.limit\) \|\| 50, 200\)/);
});

/* ── 5. Card Stacking 'Funded' column ────────────────────────────────────── */
suite(
  "funded column",
  FIN_B02_RESULT_CONTRACTS[4].control,
  ["cards", "pipelines", "pipeline_stages", "funding_rounds", "events"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const pipeline = id(org, "pipe");
    const stage = id(org, "funded");
    s.insert("pipelines", { id: pipeline, org_id: org, key: "funding_card_stacking" });
    s.insert("pipeline_stages", { id: stage, org_id: org, pipeline_id: pipeline, key: "funded" });
    s.insert("cards", { id: id(org, "card"), org_id: org, client_id: client, pipeline_id: pipeline, stage_id: stage, entered_at: ago(c.old ? 90 : 2) });
    if (!c.noRound) {
      s.insert("funding_rounds", {
        id: id(org, "round"), org_id: org, client_id: client, round_number: 1,
        status: c.roundStatus || "funded", funded_amount: c.funded ?? 25000,
      });
    }
    if (!c.noEvent) s.insert("events", { id: id(org, "evt"), org_id: org, client_id: client, name: "round.funded" });
  },
  [
    ["the card is Funded and the client has no round", { noRound: true }],
    ["the round says funded with $0", { funded: 0 }],
    ["the round never reached funded", { roundStatus: "submitted" }],
    ["the round.funded receipt is missing", { noEvent: true }],
  ],
);

test("funded column: a card in another column or another pipeline is not judged", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[4].control);
  const s = makeStandIn(["cards", "pipelines", "pipeline_stages", "funding_rounds", "events"]);
  try {
    s.insert("pipelines", { id: "p1", org_id: ORG, key: "funding_card_stacking" });
    s.insert("pipelines", { id: "p2", org_id: ORG, key: "sales" });
    s.insert("pipeline_stages", { id: "s-sub", org_id: ORG, pipeline_id: "p1", key: "submitted" });
    s.insert("pipeline_stages", { id: "s-funded-sales", org_id: ORG, pipeline_id: "p2", key: "funded" });
    s.insert("cards", { id: "k1", org_id: ORG, client_id: "c1", pipeline_id: "p1", stage_id: "s-sub", entered_at: ago(1) });
    s.insert("cards", { id: "k2", org_id: ORG, client_id: "c2", pipeline_id: "p2", stage_id: "s-funded-sales", entered_at: ago(1) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});

/* ── 6. 'I agree - submit soft-pull approval' ────────────────────────────── */
const APPROVE_TABLES = ["client_consents", "clients", "accounts", "pii_identity", "payment_links", "businesses", "account_magic_links", "messages"];
suite(
  "soft-pull approval",
  FIN_B02_RESULT_CONTRACTS[5].control,
  APPROVE_TABLES,
  (s, org, c = {}) => {
    const client = id(org, "client");
    const account = id(org, "acct");
    const when = ago(c.old ? 90 : 1);
    s.insert("clients", { id: client, org_id: org, is_demo: false });
    if (!c.noAccount) s.insert("accounts", { id: account, org_id: org, kind: "client", client_id: c.accountOfOther ? "someone-else" : client, status: "active" });
    s.insert("client_consents", {
      id: id(org, "k"), org_id: org, client_id: client, kind: "soft_pull_consent",
      consent_text: c.blankText ? "   " : "I authorize a soft inquiry.",
      consent_version: c.blankVersion ? "  " : "v1",
      granted_by_kind: "client", granted_by_account_id: account, capture_method: "typed",
      granted_name: c.blankName ? "" : "Test Person", granted_at: when,
    });
    if (!c.noIdentity) s.insert("pii_identity", { id: id(org, "pii"), org_id: org, client_id: client, ssn_enc: c.noSsn ? null : "enc", dob: "1990-01-01" });
    for (let i = 0; i < 2; i += 1) {
      s.insert("businesses", { id: id(org, `b${i}`), org_id: org, client_id: client, name: `Biz ${i}`, entity_data: { source: "soft_pull_approve" } });
    }
    if (!c.noLink) {
      s.insert("payment_links", {
        id: id(org, "link"), org_id: org, client_id: client, purpose: "diagnostic",
        amount_cents: c.total ?? 5200, status: c.linkStatus || "sent",
      });
    }
    if (c.staleLink) {
      s.insert("payment_links", { id: id(org, "stale"), org_id: org, client_id: client, purpose: "diagnostic", amount_cents: 3200, status: "created" });
    }
    const linkId = id(org, "ml");
    const linkAt = c.linkDaysEarlier ? ago((c.old ? 90 : 1) + c.linkDaysEarlier)
      : c.linkDaysLater ? ago((c.old ? 90 : 1) - c.linkDaysLater) : when;
    s.insert("account_magic_links", {
      id: linkId, org_id: org, client_id: c.linkOfOther ? "someone-else" : client, email: "email-on-file",
      outcome: c.noSignIn ? "no_account" : "issued", created_at: linkAt,
    });
    // The sign-in email: the exact message the link's own id names (src/auth/magic-link.mjs).
    if (!c.noMail) {
      s.insert("messages", {
        id: id(org, "mail"), org_id: org, client_id: c.mailOfOther ? "someone-else" : client,
        direction: c.mailDirection || "outbound", channel: c.mailChannel || "email", template_key: MAGIC_LINK_TEMPLATE_KEY,
        provider_ref: `workflow:${MAGIC_LINK_TEMPLATE_KEY}:magic-link:${c.mailForOtherLink ? "some-other-link" : linkId}`,
        status: c.mailStatus || "queued", to_address: "email-on-file", created_at: when,
      });
    }
  },
  [
    ["no portal account holds the consent", { noAccount: true }],
    ["the consenting account belongs to a different client", { accountOfOther: true }],
    ["the saved consent words are blank", { blankText: true }],
    ["the saved consent version is blank", { blankVersion: true }],
    ["the typed legal name is blank", { blankName: true }],
    ["no identity row was saved", { noIdentity: true }],
    ["the identity has no Social Security number", { noSsn: true }],
    ["no diagnostic pay link exists at all", { noLink: true }],
    ["the open checkout is not the exact total for 2 businesses", { total: 3200 }],
    ["a stale $32 link is still open next to the right total", { staleLink: true }],
    ["no sign-in link was issued", { noSignIn: true }],
    ["a sign-in link was issued and no sign-in email was ever queued", { noMail: true }],
    ["the sign-in email failed", { mailStatus: "failed" }],
    ["the sign-in email was blocked", { mailStatus: "blocked" }],
    ["the sign-in email belongs to another client", { mailOfOther: true }],
    ["the only sign-in email is for some other link", { mailForOtherLink: true }],
    ["the sign-in link was issued 400 days before this consent", { linkDaysEarlier: 400 }],
    ["the sign-in link was issued 5 days after this consent", { linkDaysLater: 5 }],
    ["the only issued sign-in link is another client's", { linkOfOther: true }],
    ["the only sign-in message is a text, not an email", { mailChannel: "sms" }],
    ["the only sign-in message is inbound, not sent to the client", { mailDirection: "inbound" }],
  ],
);

test("soft-pull approval: a paid link, a staff-recorded consent and a withdrawn consent are not this control's result", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[5].control);
  const s = makeStandIn(APPROVE_TABLES);
  try {
    s.insert("clients", { id: "c1", org_id: ORG, is_demo: false });
    s.insert("accounts", { id: "a1", org_id: ORG, kind: "client", client_id: "c1" });
    s.insert("client_consents", { id: "k1", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "words", consent_version: "v1", granted_by_kind: "client", granted_by_account_id: "a1", capture_method: "typed", granted_name: "T P", granted_at: ago(1) });
    s.insert("pii_identity", { id: "p1", org_id: ORG, client_id: "c1", ssn_enc: "enc", dob: "1990-01-01" });
    s.insert("payment_links", { id: "l1", org_id: ORG, client_id: "c1", purpose: "diagnostic", amount_cents: 3200, status: "paid" });
    s.insert("account_magic_links", { id: "m1", org_id: ORG, client_id: "c1", email: "email-on-file", outcome: "issued", created_at: ago(1) });
    s.insert("messages", { id: "mm1", org_id: ORG, client_id: "c1", direction: "outbound", channel: "email", provider_ref: `workflow:${MAGIC_LINK_TEMPLATE_KEY}:magic-link:m1`, status: "sent", created_at: ago(1) });
    // Staff recorded this consent on a call, and this one was withdrawn: neither is the page's save.
    s.insert("client_consents", { id: "k2", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "", granted_by_kind: "staff", capture_method: "checkbox", granted_at: ago(1) });
    s.insert("client_consents", { id: "k3", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "", granted_by_kind: "client", capture_method: "typed", granted_at: ago(1), revoked_at: ago(0) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});

test("invoice backlog email: the template key in the SQL is the one invoice emails are queued under", () => {
  assert.equal(INVOICE_TEMPLATE_KEY, "INVOICE-SENT-EMAIL");
  const sql = contractFor(FIN_B02_RESULT_CONTRACTS[3].control).sql;
  assert.ok(sql.includes(`'${INVOICE_TEMPLATE_KEY}'`));
  const sender = fs.readFileSync(path.join(REPO_ROOT, "src/invoices/notify.mjs"), "utf8");
  assert.match(sender, /`invoice:\$\{inv\.id\}:\$\{purpose\}`/);
});

test("soft-pull approval: the template key in the SQL is the one the sign-in email is sent under", () => {
  assert.equal(MAGIC_LINK_TEMPLATE_KEY, "EMAIL-PORTAL-MAGIC-LINK");
  assert.ok(contractFor(FIN_B02_RESULT_CONTRACTS[5].control).sql.includes(`workflow:${MAGIC_LINK_TEMPLATE_KEY}:magic-link:`));
  const sender = fs.readFileSync(path.join(REPO_ROOT, "src/auth/magic-link.mjs"), "utf8");
  assert.match(sender, /eventId: eventId \|\| `magic-link:\$\{ins\.rows\[0\]\.id\}`/);
  // and the message row's provider_ref is `workflow:<template>:<event id>` (src/workflows/messaging.mjs)
  const queue = fs.readFileSync(path.join(REPO_ROOT, "src/workflows/messaging.mjs"), "utf8");
  assert.match(queue, /const providerRef = `workflow:\$\{templateKey\}:\$\{eventId\}`;/);
});

/* ── 7. Do task (money-next) ─────────────────────────────────────────────── */
suite(
  "do task",
  FIN_B02_RESULT_CONTRACTS[6].control,
  ["money_agent_log", "money_agent_tasks", "tasks"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const task = id(org, "task");
    const staffTask = id(org, "csm");
    const assignee = c.agent ? "agent" : "person";
    if (!c.agent && !c.noStaffTask) {
      s.insert("tasks", {
        id: staffTask, org_id: c.taskOtherOrg ? "99999999-9999-4999-8999-999999999999" : org, client_id: c.taskOfOther ? "someone-else" : client,
        source_workflow: c.taskWrongSource ? "other-flow" : STAFF_TASK_SOURCE,
        assignee_role: c.taskWrongRole ? "closer" : STAFF_TASK_ROLE, title: "FinanceOS: pay the card",
      });
    }
    s.insert("money_agent_tasks", {
      id: task, org_id: org, client_id: client, task_key: "pay-card", status: "queued",
      assignee: c.rowAssignee || assignee, moves_money: c.moves === true, amount_cents: c.moves ? 25000 : null,
      staff_task_id: c.agent || c.noStaffTask ? null : staffTask,
    });
    s.insert("money_agent_log", {
      id: id(org, "log"), org_id: org, client_id: c.otherClient ? "someone-else" : client, item_kind: "money_task",
      item_id: c.noTask ? "no-such-task" : task, action: "task_assigned",
      idempotency_key: c.badKey ? "money-task:wrong:assigned" : `money-task:${task}:assigned`,
      task_id: c.agent || c.noStaffTask ? null : (c.logTaskWrong ? "some-other-task" : staffTask),
      amount_cents: c.moves ? (c.amountWrong ? 99999 : 25000) : null,
      detail: { task_key: c.keyWrong ? "other-key" : "pay-card", assignee: c.noAssignee ? null : assignee, moves_money: c.moves === true },
    });
  },
  [
    ["the assignment log points at no task", { noTask: true }],
    ["the log is on another client", { otherClient: true }],
    ["the log carries the wrong idempotency key", { badKey: true }],
    ["the log names no assignee", { noAssignee: true }],
    ["a step handed to a person opened no CSM task", { noStaffTask: true }],
    ["the log does not point at the CSM task the step opened", { logTaskWrong: true }],
    ["the CSM task belongs to another client", { taskOfOther: true }],
    ["the CSM task belongs to another company", { taskOtherOrg: true }],
    ["the CSM task was not opened by the money-task flow", { taskWrongSource: true }],
    ["the CSM task is not on the CSM role", { taskWrongRole: true }],
    ["the task row says agent and the log says person", { rowAssignee: "agent" }],
    ["the log names another task key than the row", { keyWrong: true }],
  ],
  { windowed: false },
);

test("do task: an agent step needs no CSM task, a money step must carry the same amount on the row and the log", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[6].control);
  const s = makeStandIn(["money_agent_log", "money_agent_tasks", "tasks"]);
  try {
    const put = (org, c) => {
      s.insert("money_agent_tasks", { id: `t-${c.n}`, org_id: org, client_id: "cl", task_key: "k", status: "queued", assignee: "agent", moves_money: c.moves, amount_cents: c.moves ? 25000 : null });
      s.insert("money_agent_log", { id: `l-${c.n}`, org_id: org, client_id: "cl", item_kind: "money_task", item_id: `t-${c.n}`, action: "task_assigned", idempotency_key: `money-task:t-${c.n}:assigned`, amount_cents: c.moves ? c.logAmount : null, detail: { task_key: "k", assignee: "agent" } });
    };
    put(ORG, { n: 1, moves: false });
    put(ORG, { n: 2, moves: true, logAmount: 25000 });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 0 });
    put(ORG, { n: 3, moves: true, logAmount: 99999 });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 3, bad_count: 1 });
    // a step that moves money with no amount on the row, and none on the log, has nothing to approve
    s.insert("money_agent_tasks", { id: "t-4", org_id: ORG, client_id: "cl", task_key: "k", status: "queued", assignee: "agent", moves_money: true, amount_cents: null });
    s.insert("money_agent_log", { id: "l-4", org_id: ORG, client_id: "cl", item_kind: "money_task", item_id: "t-4", action: "task_assigned", idempotency_key: "money-task:t-4:assigned", amount_cents: null, detail: { task_key: "k", assignee: "agent" } });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 4, bad_count: 2 });
  } finally { s.close(); }
});

test("do task: the CSM source and role in the SQL are the ones the press opens its task under", () => {
  assert.equal(STAFF_TASK_SOURCE, "money-task");
  assert.equal(STAFF_TASK_ROLE, "csm");
  const sql = contractFor(FIN_B02_RESULT_CONTRACTS[6].control).sql;
  assert.ok(sql.includes(`k.source_workflow = '${STAFF_TASK_SOURCE}'`));
  assert.ok(sql.includes(`k.assignee_role = '${STAFF_TASK_ROLE}'`));
});

/* ── the shape of the whole set ──────────────────────────────────────────── */
test("every live control text is one exact map row and owns exactly one contract", () => {
  const MAPS = new Map();
  const rowsFor = (file) => {
    if (!MAPS.has(file)) {
      MAPS.set(file, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10", file), "utf8")));
    }
    return MAPS.get(file);
  };
  assert.equal(FIN_B02_LIVE_ROWS.length, 7);
  const seen = new Set();
  for (const [file, surface, control] of FIN_B02_LIVE_ROWS) {
    const rows = rowsFor(file).filter((r) => r.surface === surface && r.control === control);
    assert.equal(rows.length, 1, `${file} / ${surface} / ${control}`);
    assert.ok(!seen.has(control));
    seen.add(control);
    assert.equal(DISPLAY_RESULT_CONTRACTS.filter((c) => c.control === control).length, 1, control);
  }
});

test("each new contract SQL is a fresh read: marker, $1::uuid, sample_count and bad_count", () => {
  const queries = FIN_B02_RESULT_CONTRACTS.filter((c) => c.mode === "query");
  assert.equal(queries.length, 8);
  for (const c of queries) {
    assert.match(c.sql, /^\/\* display-result:[a-z0-9-]+ \*\//);
    assert.match(c.sql, /sample_count/);
    assert.match(c.sql, /bad_count/);
    assert.match(c.sql, /\$1::uuid/);
    assert.ok(c.requirement.length > 40, c.control);
  }
  const markers = queries.map((c) => /display-result:([a-z0-9-]+)/.exec(c.sql)[1]);
  assert.equal(new Set(markers).size, markers.length);
  // The do-task text is no longer shared with the other "Do task" row: its own SQL, its own marker.
  assert.ok(!markers.includes("do-task"));
});

test("the hero is attached to its live deposit check and its browser target-bar proof", () => {
  const hero = DISPLAY_RESULT_CONTRACTS.find((c) => c.control === FIN_B02_HERO_READY_CONTRACT.control);
  assert.ok(hero, "the hero row has a contract entry");
  assert.equal(hero.mode, "query");
  assert.equal(hero.sql, FIN_B02_HERO_READY_CONTRACT.sql);
  assert.match(hero.requirement, /saved daily team target/);
  assert.match(hero.requirement, /bar exceed 100%/);
  assert.equal(FIN_B02_HERO_READY_CONTRACT.mode, "query");
  assert.equal(DISPLAY_RESULT_CONTRACTS.filter((c) => c.sql === FIN_B02_HERO_READY_CONTRACT.sql).length, 1);
  const page = fs.readFileSync(path.join(REPO_ROOT, "public/app/sales-floor.js"), "utf8");
  assert.match(page, /Number\(today\.deposits\) \/ dailyTarget \* 100/);
  assert.match(page, /Math\.min\(100,/);
  const read = fs.readFileSync(path.join(REPO_ROOT, "src/sales/metrics.mjs"), "utf8");
  assert.match(read, /period = 'daily' AND metric = 'deposits'/);
  assert.match(read, /target_deposits: validDailyTarget/);
});

test("each repaired row names the tests that press its control or run its handler", () => {
  const byControl = new Map(FIN_B02_DISPLAY_CASES.map((c) => [c.control, c]));
  const has = (control, ...tests) => {
    const found = byControl.get(control);
    assert.ok(found, control);
    for (const test of tests) {
      assert.ok(found.tests.includes(test), `${control} is missing ${test}`);
      assert.ok(fs.existsSync(path.join(REPO_ROOT, test)), test);
    }
  };
  has(FIN_B02_RESULT_CONTRACTS[2].control, FIN_B02_LIVE_TEST, "src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs", "src/pulse/catalog/proofs/s4-present-deck.test.mjs");
  has(FIN_B02_RESULT_CONTRACTS[3].control, FIN_B02_LIVE_TEST, "src/http/s2-message-routes-outbound.test.mjs", "src/pulse/catalog/proofs/fin-b02-invoice-backlog.test.mjs");
  has(FIN_B02_RESULT_CONTRACTS[5].control, FIN_B02_LIVE_TEST, "src/pulse/catalog/proofs/s4-soft-pull-approve.test.mjs");
  has(FIN_B02_RESULT_CONTRACTS[6].control, FIN_B02_LIVE_TEST, "src/http/money-next-screen.test.mjs", "src/http/money-tasks.test.mjs", "src/finance/money-tasks.test.mjs", "src/pulse/catalog/proofs/fin-b02-do-task.test.mjs");
  has(FIN_B02_RESULT_CONTRACTS[0].control, FIN_B02_LIVE_TEST, "src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs");
  has(FIN_B02_RESULT_CONTRACTS[7].control, FIN_B02_HERO_TEST, FIN_B02_HERO_LIVE_TEST);
  // The invoice row has ONE case, not two (the staff runner's case is replaced, not repeated).
  assert.equal(FIN_B02_DISPLAY_CASES.filter((c) => c.control === FIN_B02_RESULT_CONTRACTS[3].control).length, 1);
});
