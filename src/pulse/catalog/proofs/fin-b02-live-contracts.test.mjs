// Finish-853 batch 02: the seven live display checks, run as the exact SQL text the lane runs.
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
  FIN_B02_LIVE_ROWS,
  FIN_B02_RESULT_CONTRACTS,
  PRIMARY_PAY_OFFER_KEYS,
} from "./fin-b02-display-contracts.mjs";
import { DISPLAY_RESULT_CONTRACTS, displaySavedResultContract } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

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
suite(
  "send soft pull",
  FIN_B02_RESULT_CONTRACTS[0].control,
  ["messages", "payment_links", "clients"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const link = id(org, "link");
    const when = ago(c.old ? 90 : 1);
    s.insert("clients", { id: client, org_id: org, phone: c.noPhone ? null : "phone-on-file" });
    if (!c.noLink) {
      s.insert("payment_links", {
        id: link, org_id: org, client_id: c.otherClient ? "someone-else" : client,
        purpose: c.purpose || "diagnostic", amount_cents: c.amount ?? 3200, status: "sent",
      });
    }
    s.insert("messages", {
      id: id(org, "m-email"), org_id: org, client_id: client, direction: c.direction || "outbound",
      channel: c.channel || "email", provider_ref: `staff:soft-pull-send:${link}`,
      to_address: c.toAddress ?? "email-on-file", created_at: when,
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
  ],
);

test("send soft pull: a client with no phone number needs no text row", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[0].control);
  const s = makeStandIn(["messages", "payment_links", "clients"]);
  try {
    s.insert("clients", { id: "c", org_id: ORG, phone: null });
    s.insert("payment_links", { id: "l", org_id: ORG, client_id: "c", purpose: "diagnostic", amount_cents: 3200, status: "sent" });
    s.insert("messages", { id: "m", org_id: ORG, client_id: "c", direction: "outbound", channel: "email", provider_ref: "staff:soft-pull-send:l", to_address: "email-on-file", created_at: ago(1) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
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

test("sale motion: the four primary offers in the SQL are the four the server skips a motion for", () => {
  const closerDeck = fs.readFileSync(path.join(REPO_ROOT, "src/sales/closer-deck.mjs"), "utf8");
  const set = /primaryPayOffers = new Set\(\[([^\]]+)\]\)/.exec(closerDeck);
  assert.ok(set, "the primaryPayOffers set moved in src/sales/closer-deck.mjs");
  const keys = [...set[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...PRIMARY_PAY_OFFER_KEYS]);
  const presentJs = fs.readFileSync(path.join(REPO_ROOT, "public/app/present.js"), "utf8");
  for (const key of keys) assert.ok(presentJs.includes(`"${key}"`));
});

/* ── 3. Amount paid today ────────────────────────────────────────────────── */
suite(
  "amount paid today",
  FIN_B02_RESULT_CONTRACTS[2].control,
  ["repair_programs", "clients"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    s.insert("clients", { id: client, org_id: org, is_demo: c.demo === true });
    s.insert("repair_programs", {
      id: id(org, "rp"), org_id: org, client_id: client, program: c.program || "full",
      rounds_cap: c.cap ?? 6, price_total: c.price ?? 1000, amount_paid: c.paid ?? 1000, status: "active",
    });
  },
  [
    ["more was paid than the program costs", { paid: 1500 }],
    ["a negative amount was saved as paid", { paid: -5 }],
    ["a trial program has the full round cap", { program: "trial", price: 200, paid: 200, cap: 6 }],
    ["a full program has the trial round cap", { cap: 2 }],
  ],
  { windowed: false },
);

test("amount paid today: a deposit below the price is fine, and a demo client is not judged", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[2].control);
  const s = makeStandIn(["repair_programs", "clients"]);
  try {
    s.insert("clients", { id: "c1", org_id: ORG, is_demo: false });
    s.insert("repair_programs", { id: "r1", org_id: ORG, client_id: "c1", program: "trial", rounds_cap: 2, price_total: 200, amount_paid: 50, status: "active" });
    s.insert("clients", { id: "c2", org_id: ORG, is_demo: true });
    s.insert("repair_programs", { id: "r2", org_id: ORG, client_id: "c2", program: "full", rounds_cap: 6, price_total: 100, amount_paid: 999, status: "active" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
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
      channel: c.channel || "email", template_key: "INVOICE-SENT-EMAIL",
      provider_ref: c.unstamped ? `invoice:${inv}:sent` : `invoice:${inv}:sent`,
      to_address: c.toAddress ?? "email-on-file", created_at: when,
    });
  },
  [
    ["an invoice is stamped emailed with no email message linked", { noLink: true }],
    ["the linked email belongs to another client", { otherClient: true }],
    ["the linked message is not an email", { channel: "sms" }],
    ["the linked email has no address", { toAddress: "" }],
    ["the client was emailed but the invoice still reads never emailed", { unstamped: true }],
  ],
);

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
suite(
  "soft-pull approval",
  FIN_B02_RESULT_CONTRACTS[5].control,
  ["client_consents", "clients", "accounts", "pii_identity", "payment_links", "businesses", "account_magic_links"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const account = id(org, "acct");
    const when = ago(c.old ? 90 : 1);
    s.insert("clients", { id: client, org_id: org, is_demo: false });
    if (!c.noAccount) s.insert("accounts", { id: account, org_id: org, kind: "client", client_id: c.accountOfOther ? "someone-else" : client, status: "active" });
    s.insert("client_consents", {
      id: id(org, "k"), org_id: org, client_id: client, kind: "soft_pull_consent",
      consent_text: c.blankText ? "   " : "I authorize a soft inquiry.", consent_version: "v1",
      granted_by_kind: "client", granted_by_account_id: account, capture_method: "typed",
      granted_name: "Test Person", granted_at: when,
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
    s.insert("account_magic_links", {
      id: id(org, "ml"), org_id: org, client_id: client, email: "email-on-file",
      outcome: c.noSignIn ? "no_account" : "issued",
    });
  },
  [
    ["no portal account holds the consent", { noAccount: true }],
    ["the consenting account belongs to a different client", { accountOfOther: true }],
    ["the saved consent words are blank", { blankText: true }],
    ["no identity row was saved", { noIdentity: true }],
    ["the identity has no Social Security number", { noSsn: true }],
    ["no diagnostic pay link exists at all", { noLink: true }],
    ["the open checkout is not the exact total for 2 businesses", { total: 3200 }],
    ["a stale $32 link is still open next to the right total", { staleLink: true }],
    ["no sign-in link was issued", { noSignIn: true }],
  ],
);

test("soft-pull approval: a paid link, a staff-recorded consent and a withdrawn consent are not this control's result", () => {
  const contract = contractFor(FIN_B02_RESULT_CONTRACTS[5].control);
  const s = makeStandIn(["client_consents", "clients", "accounts", "pii_identity", "payment_links", "businesses", "account_magic_links"]);
  try {
    s.insert("clients", { id: "c1", org_id: ORG, is_demo: false });
    s.insert("accounts", { id: "a1", org_id: ORG, kind: "client", client_id: "c1" });
    s.insert("client_consents", { id: "k1", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "words", consent_version: "v1", granted_by_kind: "client", granted_by_account_id: "a1", capture_method: "typed", granted_name: "T P", granted_at: ago(1) });
    s.insert("pii_identity", { id: "p1", org_id: ORG, client_id: "c1", ssn_enc: "enc", dob: "1990-01-01" });
    s.insert("payment_links", { id: "l1", org_id: ORG, client_id: "c1", purpose: "diagnostic", amount_cents: 3200, status: "paid" });
    s.insert("account_magic_links", { id: "m1", org_id: ORG, client_id: "c1", email: "email-on-file", outcome: "issued" });
    // Staff recorded this consent on a call, and this one was withdrawn: neither is the page's save.
    s.insert("client_consents", { id: "k2", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "", granted_by_kind: "staff", capture_method: "checkbox", granted_at: ago(1) });
    s.insert("client_consents", { id: "k3", org_id: ORG, client_id: "c1", kind: "soft_pull_consent", consent_text: "", granted_by_kind: "client", capture_method: "typed", granted_at: ago(1), revoked_at: ago(0) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});

/* ── 7. Do task (money-next) reuses the one do-task SQL ──────────────────── */
suite(
  "do task",
  "Do task (per step the money helper or a person can do)",
  ["money_agent_log", "money_agent_tasks"],
  (s, org, c = {}) => {
    const client = id(org, "client");
    const task = id(org, "task");
    s.insert("money_agent_tasks", { id: task, org_id: org, client_id: client, task_key: "pay-card", status: "queued" });
    s.insert("money_agent_log", {
      id: id(org, "log"), org_id: org, client_id: c.otherClient ? "someone-else" : client, item_kind: "money_task",
      item_id: c.noTask ? "no-such-task" : task, action: "task_assigned",
      idempotency_key: c.badKey ? "money-task:wrong:assigned" : `money-task:${task}:assigned`,
      detail: { task_key: "pay-card", assignee: c.noAssignee ? null : "agent" },
    });
  },
  [
    ["the assignment log points at no task", { noTask: true }],
    ["the log is on another client", { otherClient: true }],
    ["the log carries the wrong idempotency key", { badKey: true }],
    ["the log names no assignee", { noAssignee: true }],
  ],
  { windowed: false },
);

/* ── the shape of the whole set ──────────────────────────────────────────── */
test("every live control text is one exact map row and owns exactly one contract", () => {
  const MAPS = new Map();
  const rowsFor = (file) => {
    if (!MAPS.has(file)) {
      MAPS.set(file, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10", file), "utf8")));
    }
    return MAPS.get(file);
  };
  assert.equal(FIN_B02_LIVE_ROWS.length, 8);
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
  for (const c of FIN_B02_RESULT_CONTRACTS) {
    assert.match(c.sql, /^\/\* display-result:[a-z0-9-]+ \*\//);
    assert.match(c.sql, /sample_count/);
    assert.match(c.sql, /bad_count/);
    assert.ok(c.requirement.length > 40, c.control);
  }
  const markers = FIN_B02_RESULT_CONTRACTS.map((c) => /display-result:([a-z0-9-]+)/.exec(c.sql)[1]);
  assert.equal(new Set(markers).size, markers.length);
});
