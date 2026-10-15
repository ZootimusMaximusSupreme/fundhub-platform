// Finish-853 batch 17: the four live checks (staff internal chat, the Present sample client, the soft pull
// panel's rows, the money connection status lines) run over stand-in rows.
//
// The exact SQL text each contract carries is run (fin-b17-sql-kit.mjs, SQLite, real column names from
// db/migrations). For every named bad-result condition:
//   - a row that breaks ONLY that condition is counted bad,
//   - the same text with that one condition left out does not count it (so the condition is what caught it),
//   - clean rows, another company's rows and demo rows are never counted.
// No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import {
  FIN_B17_CHECKS, FIN_B17_RESULT_CONTRACTS, FIN_B17_LIVE_CASES, FIN_B17_LIVE_ROWS, FIN_B17_DEMO_CLIENT,
  chatInternalSql, demoClientSql, softPullPanelSql, connectionLinesSql,
  CHAT_BAD, DEMO_BAD, PULL_REQUEST_BAD, PULL_LINK_BAD, CONNECTION_BAD,
} from "./fin-b17-display-contracts.mjs";
import { makeStandIn, portableSql, schemaColumns, tablesIn } from "./fin-b17-sql-kit.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const NOW_ISO = "2026-10-14T12:00:00.000Z";

// ───────────────────────── the contracts themselves ─────────────────────────

test("four live checks, one registry contract each; three wait quietly for a first use, the sample client does not", () => {
  assert.equal(FIN_B17_CHECKS.length, 4);
  assert.equal(FIN_B17_RESULT_CONTRACTS.length, 4);
  assert.equal(FIN_B17_LIVE_ROWS.length, 4);
  assert.equal(FIN_B17_LIVE_CASES.length, 4);
  assert.equal(new Set(FIN_B17_RESULT_CONTRACTS.map((c) => c.control)).size, 4);
  assert.equal(new Set(FIN_B17_RESULT_CONTRACTS.map((c) => c.sql)).size, 4);
  const quiet = FIN_B17_RESULT_CONTRACTS.filter((c) => c.emptyAs === "quiet").map((c) => c.control);
  assert.equal(quiet.length, 3);
  assert.ok(!quiet.includes("Section 06 FinanceOS demo links: 16 tabs open the sample client in a new tab (owner, admin, sales_manager, closer only)"));
  for (const contract of FIN_B17_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.match(contract.sql, /^\/\* display-result:[a-z0-9-]+ \*\//);
    assert.match(contract.sql, /AS sample_count/);
    assert.match(contract.sql, /AS bad_count/);
    assert.match(contract.sql, /\$1::uuid/);
    assert.ok(!/\$2/.test(contract.sql), "takes the company and nothing else");
    assert.ok(!/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i.test(contract.sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/'[^']*'/g, "''")), "read only");
    assert.ok(contract.requirement.length > 80);
  }
  for (const live of FIN_B17_LIVE_CASES) {
    assert.match(live.evidence, /gap-catalog-display\.mjs/, "a live row stays in the display lane");
    assert.ok(live.tests.includes("src/pulse/catalog/proofs/fin-b17-live-contracts.test.mjs"));
    assert.ok(live.tests.length >= 2, "and also runs the practice test that presses the same control");
  }
});

test("every table a contract reads is a real table, and every column it names is a real column", () => {
  const schema = schemaColumns();
  for (const contract of FIN_B17_RESULT_CONTRACTS) {
    for (const table of tablesIn(contract.sql)) assert.ok(schema.has(table), `${table} is not in db/schema or db/migrations`);
    portableSql(contract.sql); // refuses a spelling the kit cannot run
  }
});

// ───────────────────────── a small harness ─────────────────────────

function counts(tables, rows, sql, org = ORG) {
  const standIn = makeStandIn(tables);
  try {
    for (const [table, row] of rows) standIn.insert(table, row);
    return standIn.run(sql, org);
  } finally {
    standIn.close();
  }
}

/**
 * For one check: the clean rows are never bad; each named condition has rows that break only it, the
 * full text counts them bad and the text without that condition does not.
 */
function conditionTest({ title, tables, sqlOf, names, clean, bads }) {
  test(`${title}: clean, other-company and demo rows are not counted`, () => {
    const got = counts(tables, clean(), sqlOf());
    assert.equal(got.bad_count, 0);
    assert.ok(got.sample_count >= 1, "the clean rows are samples");
  });

  test(`${title}: every named condition is exercised by a row that breaks only it`, () => {
    assert.deepEqual([...Object.keys(bads)].sort(), [...names].sort(), "a case for every condition, and no case for a missing one");
  });

  for (const name of names) {
    test(`${title}: red on "${name}", and only that condition catches it`, () => {
      for (const added of bads[name]) {
        const base = counts(tables, clean(), sqlOf());
        const withBad = counts(tables, [...clean(), ...added], sqlOf());
        assert.ok(withBad.bad_count > base.bad_count, `"${name}" must turn the check red`);
        assert.ok(withBad.sample_count > base.sample_count, "the broken row is a sample");
        const withoutIt = counts(tables, [...clean(), ...added], sqlOf({ without: [name] }));
        assert.equal(withoutIt.bad_count, base.bad_count, `without "${name}" the same rows must not be caught`);
      }
    });
  }
}

// ───────────────────────── staff internal chat ─────────────────────────

const PEER_A = "a1000000-0000-4000-8000-0000000000a1";
const PEER_B = "a2000000-0000-4000-8000-0000000000a2";
const PEER_Z = "a9000000-0000-4000-8000-0000000000a9";
let n = 0;
const uid = (prefix) => `${prefix}000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function thread({ org = ORG, kind = "internal", people = [PEER_A, PEER_B], pairKey = `${PEER_A}:${PEER_B}`, clientId = null, demo = false, messages = [{}] } = {}) {
  const id = uid("c1");
  const rows = [["conversations", { id, org_id: org, kind, channel: "internal", client_id: clientId, internal_pair_key: pairKey, is_demo: demo }]];
  for (const staff of people) rows.push(["conversation_participants", { conversation_id: id, staff_id: staff }]);
  for (const over of messages) {
    rows.push(["messages", {
      id: uid("e1"), org_id: org, conversation_id: id, client_id: null, direction: "outbound", channel: "internal",
      rendered_body: "Are you on the 3pm?", status: "delivered", sender_staff_id: PEER_A, sender_kind: "staff", is_demo: demo, ...over,
    }]);
  }
  return rows;
}
const chatClean = () => [
  ...thread({ messages: [{}, { sender_staff_id: PEER_B, rendered_body: "Yes, see you there." }] }),
  // never counted, though each is wrong in some way
  ...thread({ org: OTHER_ORG, messages: [{ status: "queued", sender_staff_id: null }] }),
  ...thread({ demo: true, messages: [{ status: "queued", rendered_body: "" }] }),
  ...thread({ kind: "client", clientId: uid("d1"), people: [], pairKey: null, messages: [{ direction: "outbound", channel: "sms", status: "queued", client_id: uid("d1") }] }),
];

conditionTest({
  title: "internal chat message",
  tables: ["messages", "conversations", "conversation_participants"],
  sqlOf: chatInternalSql,
  names: CHAT_BAD.map(([name]) => name),
  clean: chatClean,
  bads: {
    "an internal message is not an outbound staff message on the internal channel": [
      thread({ messages: [{ direction: "inbound" }] }), thread({ messages: [{ channel: "sms" }] }), thread({ messages: [{ sender_kind: "system" }] }),
    ],
    "an internal message names no sender": [thread({ messages: [{ sender_staff_id: null }] })],
    "an internal message was sent by someone who is not in the conversation": [thread({ messages: [{ sender_staff_id: PEER_Z }] })],
    "an internal message has no words": [thread({ messages: [{ rendered_body: "   " }] }), thread({ messages: [{ rendered_body: null }] })],
    "an internal message is tied to a client": [thread({ messages: [{ client_id: uid("d2") }] })],
    "an internal message is not marked delivered, so it may be waiting on the client outbound path": [
      thread({ messages: [{ status: "queued" }] }), thread({ messages: [{ status: "failed" }] }),
    ],
    "an internal conversation does not have exactly two people in it": [
      thread({ people: [PEER_A, PEER_B, PEER_Z] }), thread({ people: [PEER_A] }),
    ],
    "an internal conversation has no pair key, or is tied to a client": [
      thread({ pairKey: null }), thread({ pairKey: "  " }), thread({ clientId: uid("d3") }),
    ],
  },
});

test("internal chat message: no staff messages at all is no sample, so the quiet check stays green", () => {
  assert.deepEqual(counts(["messages", "conversations", "conversation_participants"], [], chatInternalSql()), { sample_count: 0, bad_count: 0 });
});

// ───────────────────────── the Present sample client ─────────────────────────

function demoRows({ without = null, org = ORG, id = FIN_B17_DEMO_CLIENT } = {}) {
  const rows = [["clients", { id, org_id: org, first_name: "Test", last_name: "Test" }]];
  if (without !== "container" && without !== "container-archived") rows.push(["entities", { id: uid("e2"), org_id: org, client_id: id, kind: "personal", name: "Chris (personal)", archived_at: null }]);
  if (without === "container-archived") rows.push(["entities", { id: uid("e2"), org_id: org, client_id: id, kind: "personal", name: "Old", archived_at: NOW_ISO }]);
  if (without !== "account" && without !== "account-closed") rows.push(["bank_accounts", { id: uid("b2"), org_id: org, client_id: id, name: "Personal Checking", closed_at: null }]);
  if (without === "account-closed") rows.push(["bank_accounts", { id: uid("b2"), org_id: org, client_id: id, name: "Old bank", closed_at: NOW_ISO }]);
  if (without !== "credit") rows.push(["crs_results", { id: uid("f2"), org_id: org, client_id: id }]);
  if (without !== "tradelines") rows.push(["tradelines", { id: uid("f3"), org_id: org, client_id: id, lender: "Sample Visa" }]);
  return rows;
}
const DEMO_TABLES = ["clients", "entities", "bank_accounts", "crs_results", "tradelines"];
const DEMO_CASES = [
  [DEMO_BAD[0][0], "container"],
  [DEMO_BAD[0][0], "container-archived"],
  [DEMO_BAD[1][0], "account"],
  [DEMO_BAD[1][0], "account-closed"],
  [DEMO_BAD[2][0], "credit"],
  [DEMO_BAD[3][0], "tradelines"],
];

test("sample client: whole, it is one sample and not bad; another company's copy, or another client, is not it", () => {
  assert.deepEqual(counts(DEMO_TABLES, demoRows(), demoClientSql()), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(counts(DEMO_TABLES, demoRows({ org: OTHER_ORG }), demoClientSql()), { sample_count: 0, bad_count: 0 }, "the sample client in another company is not this company's");
  assert.deepEqual(counts(DEMO_TABLES, demoRows({ id: uid("77") }), demoClientSql()), { sample_count: 0, bad_count: 0 }, "another client is not the sample");
  // another company's whole set of rows does not satisfy this company's client
  const mixed = [...demoRows({ without: "tradelines" }), ["tradelines", { id: uid("f4"), org_id: OTHER_ORG, client_id: FIN_B17_DEMO_CLIENT, lender: "Other" }]];
  assert.deepEqual(counts(DEMO_TABLES, mixed, demoClientSql()), { sample_count: 1, bad_count: 1 });
});

for (const [name, without] of DEMO_CASES) {
  test(`sample client: red on "${name}" (${without}), and only that condition catches it`, () => {
    const rows = demoRows({ without });
    assert.deepEqual(counts(DEMO_TABLES, rows, demoClientSql()), { sample_count: 1, bad_count: 1 });
    assert.deepEqual(counts(DEMO_TABLES, rows, demoClientSql({ without: [name] })), { sample_count: 1, bad_count: 0 });
  });
}

test("sample client: a container, account, credit file or tradeline held only by another company does not count", () => {
  const theirs = {
    container: ["entities", { id: uid("e7"), org_id: OTHER_ORG, client_id: FIN_B17_DEMO_CLIENT, kind: "personal", name: "Theirs", archived_at: null }],
    account: ["bank_accounts", { id: uid("b7"), org_id: OTHER_ORG, client_id: FIN_B17_DEMO_CLIENT, name: "Theirs", closed_at: null }],
    credit: ["crs_results", { id: uid("f7"), org_id: OTHER_ORG, client_id: FIN_B17_DEMO_CLIENT }],
    tradelines: ["tradelines", { id: uid("f8"), org_id: OTHER_ORG, client_id: FIN_B17_DEMO_CLIENT, lender: "Theirs" }],
  };
  for (const [without, row] of Object.entries(theirs)) {
    const rows = [...demoRows({ without }), row];
    assert.deepEqual(counts(DEMO_TABLES, rows, demoClientSql()), { sample_count: 1, bad_count: 1 }, `${without} held by another company`);
  }
});

test("sample client: every named condition is exercised", () => {
  assert.deepEqual([...new Set(DEMO_CASES.map(([name]) => name))].sort(), DEMO_BAD.map(([name]) => name).sort());
});

test("sample client: a company with no such client has no sample, so the check is not quiet and goes red (no saved result)", () => {
  const contract = FIN_B17_RESULT_CONTRACTS.find((c) => /demo links/.test(c.control));
  assert.equal(contract.emptyAs, undefined);
  assert.deepEqual(counts(DEMO_TABLES, [], demoClientSql()), { sample_count: 0, bad_count: 0 });
});

// ───────────────────────── the soft pull panel's rows ─────────────────────────

const K1 = "c1000000-0000-4000-8000-0000000000c1";
const K2 = "c2000000-0000-4000-8000-0000000000c2";
const RESULT_K1 = "d1000000-0000-4000-8000-0000000000d1";
const RESULT_K2 = "d2000000-0000-4000-8000-0000000000d2";
const RESULT_OTHER_ORG = "d6000000-0000-4000-8000-0000000000d6";
const PULL_TABLES = ["soft_pull_requests", "crs_results", "payment_links"];
const request = (over = {}) => ["soft_pull_requests", { id: uid("a3"), org_id: ORG, client_id: K1, status: "complete", crs_result_id: RESULT_K1, ...over }];
const link = (over = {}) => ["payment_links", { id: uid("a4"), org_id: ORG, client_id: K1, purpose: "diagnostic", amount_cents: 3200, status: "paid", paid_at: NOW_ISO, is_demo: false, ...over }];
const pullClean = () => [
  ["crs_results", { id: RESULT_K1, org_id: ORG, client_id: K1 }],
  ["crs_results", { id: RESULT_K2, org_id: ORG, client_id: K2 }],
  request(),
  request({ client_id: K2, status: "pending", crs_result_id: null }),
  link(),
  link({ status: "sent", paid_at: null, client_id: K2 }),
  // never counted
  link({ purpose: "repair", amount_cents: null, status: "paid", paid_at: null }),
  link({ is_demo: true, amount_cents: 0 }),
  ["soft_pull_requests", { id: uid("a5"), org_id: OTHER_ORG, client_id: K1, status: "complete", crs_result_id: null }],
  ["payment_links", { id: uid("a6"), org_id: OTHER_ORG, client_id: K1, purpose: "diagnostic", amount_cents: null, status: "paid", paid_at: null, is_demo: false }],
];

conditionTest({
  title: "soft pull panel rows",
  tables: PULL_TABLES,
  sqlOf: softPullPanelSql,
  names: [...PULL_REQUEST_BAD, ...PULL_LINK_BAD].map(([name]) => name),
  clean: pullClean,
  bads: {
    "a pull request says it is finished and no credit result is stored for the client": [
      [request({ client_id: uid("c3"), status: "complete", crs_result_id: null })],
      [request({ client_id: uid("c3"), status: "Completed", crs_result_id: null })],
      // the only result stored for the client is saved under another company
      [["crs_results", { id: uid("d7"), org_id: OTHER_ORG, client_id: "c7000000-0000-4000-8000-0000000000c7" }], request({ client_id: "c7000000-0000-4000-8000-0000000000c7", status: "complete", crs_result_id: null })],
    ],
    "a pull request points at a credit result that is not this client's": [
      [request({ client_id: K1, status: "pending", crs_result_id: RESULT_K2 })],
      [request({ client_id: K1, status: "pending", crs_result_id: uid("d4") })],
      // the same id and client, but the result is saved under another company
      [["crs_results", { id: RESULT_OTHER_ORG, org_id: OTHER_ORG, client_id: K1 }], request({ client_id: K1, status: "pending", crs_result_id: RESULT_OTHER_ORG })],
    ],
    "the pull's payment link has no amount, so the panel would print $0.00": [
      [link({ amount_cents: null, client_id: uid("c4") })], [link({ amount_cents: 0, client_id: uid("c4") })],
    ],
    "the pull's payment link is marked paid with no paid time": [[link({ status: "paid", paid_at: null, client_id: uid("c4") })]],
    "the pull's payment link has a paid time and is not marked paid": [[link({ status: "sent", paid_at: NOW_ISO, client_id: uid("c4") })]],
  },
});

test("soft pull panel rows: a finished request whose client has a result stored by another path is fine", () => {
  const before = counts(PULL_TABLES, pullClean(), softPullPanelSql());
  const rows = [...pullClean(), ["crs_results", { id: uid("d5"), org_id: ORG, client_id: K2 }], request({ client_id: K2, status: "complete", crs_result_id: null })];
  const after = counts(PULL_TABLES, rows, softPullPanelSql());
  assert.equal(after.bad_count, before.bad_count, "the server answers 'complete' from the stored result, so the panel agrees with the file");
  assert.equal(after.sample_count, before.sample_count + 1);
});

// ───────────────────────── the money connection status lines ─────────────────────────

const CONN_TABLES = ["merchant_connections", "merchant_events"];
const conn = (over = {}) => ({
  id: uid("c5"), org_id: ORG, client_id: K1, entity_id: uid("e5"), provider: "whop", status: "active", mode: "pull",
  last_event_at: NOW_ISO, last_synced_at: NOW_ISO, synced_through: NOW_ISO, sync_cursor: null, last_sync_error: null, ...over,
});
const withEvent = (c) => [["merchant_connections", c], ["merchant_events", { id: uid("e6"), connection_id: c.id, provider_event_id: uid("p"), kind: "sale", received_at: NOW_ISO }]];
const connClean = () => {
  const a = conn();
  const b = conn({ status: "waiting", mode: "push", last_event_at: null, last_synced_at: null, synced_through: null });
  const c = conn({ sync_cursor: "page-4", last_sync_error: "The processor did not accept this API key." });
  return [
    ...withEvent(a), ["merchant_connections", b], ...withEvent(c),
    // never counted: another company's broken connection
    ...withEvent(conn({ org_id: OTHER_ORG, last_event_at: null })),
  ];
};

conditionTest({
  title: "connection status lines",
  tables: CONN_TABLES,
  sqlOf: connectionLinesSql,
  names: CONNECTION_BAD.map(([name]) => name),
  clean: connClean,
  bads: {
    "events are saved for the connection and its last sale or payout time is empty": [withEvent(conn({ last_event_at: null }))],
    "a last sale or payout time is set and no event is saved for the connection": [[["merchant_connections", conn({ last_event_at: NOW_ISO })]]],
    "a pull connection finished a sync and has no last synced time": [[["merchant_connections", conn({ last_event_at: null, last_synced_at: null, synced_through: NOW_ISO })]]],
    "a turned-off connection still says it is reading, so a next sync is promised that will never run": [
      [["merchant_connections", conn({ last_event_at: null, status: "disabled", sync_cursor: "page-2" })]],
    ],
    "a sync error has no words or is longer than the 300 characters the page saves": [
      [["merchant_connections", conn({ last_event_at: null, last_sync_error: "   " })]],
      [["merchant_connections", conn({ last_event_at: null, last_sync_error: "x".repeat(301) })]],
    ],
  },
});
