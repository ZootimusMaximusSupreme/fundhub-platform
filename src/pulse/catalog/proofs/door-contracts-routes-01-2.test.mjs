import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import applicationsHandler from "../../../../api/applications.mjs";
import bankAccountsHandler from "../../../../api/finance/bank-accounts.mjs";
import entitiesHandler from "../../../../api/finance/entities.mjs";
import moneySetupHandler from "../../../../api/money/setup.mjs";
import {
  ORG_ID,
  fakeDb,
  makeRes,
  req,
  runWithSharedDb,
  staffSession,
} from "../../../testing/handler-harness.mjs";
import { DOOR_CONTRACTS_ROUTES_01_ROW_KEYS } from "./door-contracts-routes-01.mjs";
import {
  DOOR_CONTRACTS_ROUTES_01_2_PROOFS,
  DOOR_CONTRACTS_ROUTES_01_2_ROW_KEYS,
  doorContractsRoutes012Proof,
  doorContractsRoutes012RowKey,
} from "./door-contracts-routes-01-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const GENERATED = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"),
).items.filter((row) => ["routes-0.json", "routes-1.json"].includes(row.sourceFile));

const CLIENT_ID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const APP_ID = "a1000000-0000-4000-8000-000000000001";
const LENDER_ID = "1e000000-0000-4000-8000-000000000001";
const ENTITY_ID = "e1000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "ba000000-0000-4000-8000-000000000001";

async function invoke(handler, request, database, deps = {}) {
  const response = makeRes();
  await runWithSharedDb(database, () => handler(request, response, { db: database, ...deps }));
  return { response, database };
}

function appRow(over = {}) {
  return {
    id: APP_ID,
    org_id: ORG_ID,
    client_id: CLIENT_ID,
    lender_id: LENDER_ID,
    lender_name: "Safe Bank",
    bank: "Safe Bank",
    lender_table: "banks",
    status: "Approved",
    approved_amount: "45000.50",
    approval_excluded_at: null,
    approval_excluded_by: null,
    approval_exclusion_reason: null,
    updated_at: "2026-10-12T10:00:00.000Z",
    ...over,
  };
}

async function proveApplicationsRead() {
  const play = {
    play_name: "No PG",
    status: "Approved",
    decided_at: "2026-10-12T09:00:00.000Z",
    application_id: APP_ID,
    lender_id: LENDER_ID,
    lender_name: "Safe Bank",
  };
  const application = appRow({ approved_amount: null });
  const byClient = fakeDb([
    staffSession(),
    [/FROM application_decisions d/, [play]],
    [/SELECT id, lender_id, lender_name, bank, status, approved_amount/, [application]],
  ]);
  const clientResult = await invoke(
    applicationsHandler,
    req("GET", { query: { client_id: CLIENT_ID, limit: "20" } }),
    byClient,
  );
  assert.equal(clientResult.response.statusCode, 200);
  assert.deepEqual(clientResult.response.body, {
    ok: true,
    decisions: [play],
    applications: [application],
  });
  assert.deepEqual(byClient.find(/FROM application_decisions d/)[0].params, [ORG_ID, CLIENT_ID, 20]);
  assert.deepEqual(
    byClient.find(/SELECT id, lender_id, lender_name, bank, status, approved_amount/)[0].params,
    [ORG_ID, CLIENT_ID, 200],
  );

  const decision = {
    id: "d1000000-0000-4000-8000-000000000001",
    application_id: APP_ID,
    event_type: "bank_decision",
    status: "Approved",
    notes: "Bank email received",
  };
  const byApplication = fakeDb([
    staffSession(),
    [/FROM application_decisions\s+WHERE/, [decision]],
  ]);
  const applicationResult = await invoke(
    applicationsHandler,
    req("GET", { query: { application_id: APP_ID, limit: "5" } }),
    byApplication,
  );
  assert.equal(applicationResult.response.statusCode, 200);
  assert.deepEqual(applicationResult.response.body, { ok: true, decisions: [decision] });
  assert.deepEqual(byApplication.find(/FROM application_decisions\s+WHERE/)[0].params, [ORG_ID, APP_ID, 5]);
}

async function proveApplicationsWrite() {
  const statusDb = fakeDb([
    staffSession(),
    [/UPDATE applications[\s\S]*status = \$3/, [appRow()]],
    [/INSERT INTO application_decisions/, []],
  ]);
  const statusResult = await invoke(
    applicationsHandler,
    req("POST", { body: { application_id: APP_ID, status: "Approved", notes: "Bank said yes" } }),
    statusDb,
  );
  assert.equal(statusResult.response.statusCode, 200);
  assert.deepEqual(statusResult.response.body, { ok: true, application: appRow() });
  assert.deepEqual(statusDb.find(/UPDATE applications[\s\S]*status = \$3/)[0].params, [ORG_ID, APP_ID, "Approved"]);
  assert.deepEqual(statusDb.find(/INSERT INTO application_decisions/)[0].params, [
    ORG_ID,
    APP_ID,
    "status_change",
    "Approved",
    "banks",
    "Olive Owner",
    "Bank said yes",
    null,
  ]);

  const decisionDb = fakeDb([
    staffSession(),
    [/SELECT id FROM applications[\s\S]*client_id = \$2/, [{ id: APP_ID }]],
    [/UPDATE applications[\s\S]*status = \$3/, [appRow()]],
    [/INSERT INTO application_decisions/, []],
  ]);
  const decisionResult = await invoke(
    applicationsHandler,
    req("POST", {
      body: {
        client_id: CLIENT_ID,
        lender_id: LENDER_ID,
        status: "Approved",
        approved_amount: "$45,000.50",
        play_name: "No PG",
      },
    }),
    decisionDb,
  );
  assert.equal(decisionResult.response.statusCode, 200);
  assert.deepEqual(decisionResult.response.body, { ok: true, application: appRow() });
  assert.deepEqual(decisionDb.find(/SELECT id FROM applications[\s\S]*client_id = \$2/)[0].params, [
    ORG_ID,
    CLIENT_ID,
    LENDER_ID,
  ]);
  const bankUpdate = decisionDb.find(/UPDATE applications[\s\S]*status = \$3/)[0];
  assert.deepEqual(bankUpdate.params, [ORG_ID, APP_ID, "Approved", "45000.50"]);
  assert.match(bankUpdate.sql, /approved_amount = \$4/);

  const refusedDb = fakeDb([staffSession()]);
  const refused = await invoke(
    applicationsHandler,
    req("POST", {
      body: {
        client_id: CLIENT_ID,
        lender_id: LENDER_ID,
        status: "Approved",
        approved_amount: "not money",
      },
    }),
    refusedDb,
  );
  assert.equal(refused.response.statusCode, 400);
  assert.deepEqual(refused.response.body, {
    ok: false,
    error: "invalid_approved_amount",
    message: "approved_amount must be a dollar amount greater than zero, like 45000 or 45000.50",
  });
  assert.equal(refusedDb.find(/UPDATE applications|INSERT INTO applications/).length, 0);
}

async function proveApplicationExclusion() {
  const excluded = appRow({
    approval_excluded_at: "2026-10-12T11:00:00.000Z",
    approval_excluded_by: "Olive Owner",
    approval_exclusion_reason: "Client did not accept it",
  });
  const excludeDb = fakeDb([
    staffSession(),
    [/SELECT id, status, approval_excluded_at[\s\S]*FROM applications/, [appRow()]],
    [/UPDATE applications[\s\S]*approval_excluded_at = now\(\)/, [excluded]],
    [/INSERT INTO application_decisions/, []],
  ]);
  const exclude = await invoke(
    applicationsHandler,
    req("POST", {
      body: {
        action: "exclude_approval",
        application_id: APP_ID,
        reason: "Client did not accept it",
      },
    }),
    excludeDb,
  );
  assert.equal(exclude.response.statusCode, 200);
  assert.deepEqual(exclude.response.body, { ok: true, application: excluded });
  assert.deepEqual(excludeDb.find(/approval_excluded_at = now/)[0].params, [
    ORG_ID,
    APP_ID,
    "Olive Owner",
    "Client did not accept it",
  ]);
  assert.equal(excludeDb.find(/INSERT INTO application_decisions/)[0].params[2], "approval_excluded");

  const reinstated = appRow();
  const reinstateDb = fakeDb([
    staffSession(),
    [/SELECT id, status, approval_excluded_at[\s\S]*FROM applications/, [excluded]],
    [/UPDATE applications[\s\S]*approval_excluded_at = NULL/, [reinstated]],
    [/INSERT INTO application_decisions/, []],
  ]);
  const reinstate = await invoke(
    applicationsHandler,
    req("POST", { body: { action: "reinstate_approval", application_id: APP_ID } }),
    reinstateDb,
  );
  assert.equal(reinstate.response.statusCode, 200);
  assert.deepEqual(reinstate.response.body, { ok: true, application: reinstated });
  assert.deepEqual(reinstateDb.find(/approval_excluded_at = NULL/)[0].params, [ORG_ID, APP_ID]);
  assert.equal(reinstateDb.find(/INSERT INTO application_decisions/)[0].params[2], "approval_reinstated");
}

const ENTITY_ROWS = [
  {
    id: ENTITY_ID,
    kind: "business",
    name: "Acme LLC",
    archived_at: null,
    created_at: "2026-10-12T08:00:00.000Z",
  },
  {
    id: "e2000000-0000-4000-8000-000000000002",
    kind: "personal",
    name: "Personal",
    archived_at: "2026-10-12T09:00:00.000Z",
    created_at: "2026-10-11T08:00:00.000Z",
  },
];

function entitiesDb() {
  return fakeDb([
    staffSession(),
    [/SELECT 1 FROM clients/, [{ "?column?": 1 }]],
    [/INSERT INTO entities/, [{ id: ENTITY_ID }]],
    [/UPDATE entities SET name/, [{ id: ENTITY_ID, client_id: CLIENT_ID }]],
    [/UPDATE entities SET archived_at/, [{ id: ENTITY_ID, client_id: CLIENT_ID }]],
    [/SELECT id, kind, name, archived_at, created_at[\s\S]*FROM entities/, ENTITY_ROWS],
  ]);
}

async function proveEntitiesRead() {
  const database = entitiesDb();
  const { response } = await invoke(
    entitiesHandler,
    req("GET", { query: { client_id: CLIENT_ID } }),
    database,
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    client_id: CLIENT_ID,
    entities: ENTITY_ROWS,
  });
  assert.deepEqual(database.find(/SELECT 1 FROM clients/)[0].params, [CLIENT_ID, ORG_ID]);
  assert.deepEqual(database.find(/FROM entities/)[0].params, [ORG_ID, CLIENT_ID]);
}

async function proveEntitiesWrite() {
  const createdDb = entitiesDb();
  const created = await invoke(
    entitiesHandler,
    req("POST", { body: { action: "create", client_id: CLIENT_ID, kind: "business", name: " Acme LLC " } }),
    createdDb,
  );
  assert.equal(created.response.statusCode, 201);
  assert.deepEqual(created.response.body, {
    ok: true,
    action: "create",
    entity_id: ENTITY_ID,
    client_id: CLIENT_ID,
    entities: ENTITY_ROWS,
  });
  assert.deepEqual(createdDb.find(/INSERT INTO entities/)[0].params, [ORG_ID, CLIENT_ID, "business", "Acme LLC"]);

  const renamedDb = entitiesDb();
  const renamed = await invoke(
    entitiesHandler,
    req("POST", { body: { action: "rename", entity_id: ENTITY_ID, name: "Acme Holdings" } }),
    renamedDb,
  );
  assert.equal(renamed.response.statusCode, 200);
  assert.deepEqual(renamed.response.body, {
    ok: true,
    action: "rename",
    entity_id: ENTITY_ID,
    client_id: CLIENT_ID,
    entities: ENTITY_ROWS,
  });
  assert.deepEqual(renamedDb.find(/UPDATE entities SET name/)[0].params, [ENTITY_ID, ORG_ID, "Acme Holdings"]);

  const archivedDb = entitiesDb();
  const archived = await invoke(
    entitiesHandler,
    req("POST", { body: { action: "archive", entity_id: ENTITY_ID } }),
    archivedDb,
  );
  assert.equal(archived.response.statusCode, 200);
  assert.deepEqual(archived.response.body, {
    ok: true,
    action: "archive",
    entity_id: ENTITY_ID,
    client_id: CLIENT_ID,
    entities: ENTITY_ROWS,
  });
  assert.deepEqual(archivedDb.find(/UPDATE entities SET archived_at/)[0].params, [ENTITY_ID, ORG_ID]);
  assert.equal(archivedDb.find(/DELETE/).length, 0);
}

const MONEY_NOW = new Date("2026-10-12T12:00:00.000Z");
const MONEY_SECRET = "s".repeat(40);

function moneyDb({ links = [] } = {}) {
  return fakeDb([
    [/FROM clients/, [{ id: CLIENT_ID, first_name: "Ada", last_name: "Lane", "?column?": 1 }]],
    [/FROM payment_links/, links],
    [/FROM soft_pull_requests/, []],
    [/FROM crs_results/, []],
    [/FROM entities/, [{ n: 0 }]],
    [/FROM subscriptions/, []],
  ]);
}

const clientPrincipal = () => ({
  kind: "client",
  accountId: "ac000000-0000-4000-8000-000000000001",
  orgId: ORG_ID,
  clientId: CLIENT_ID,
});

const gateAs = (principal) => async () => principal;

async function proveMoneySetupRead() {
  const database = moneyDb();
  const { response } = await invoke(
    moneySetupHandler,
    { method: "GET", query: { client_id: "99999999-9999-4999-8999-999999999999" } },
    database,
    {
      requirePrincipal: gateAs(clientPrincipal()),
      now: () => MONEY_NOW,
      env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" },
    },
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    client: { id: CLIENT_ID, name: "Ada Lane" },
    as_of: MONEY_NOW.toISOString(),
    paid: false,
    paid_at: null,
    setup_fee_cents: 49700,
    price_per_container_cents: null,
    containers: 0,
    monthly_cents: null,
    open_checkout: null,
    soft_pull: {
      requested: false,
      completed: false,
      last_pulled_at: null,
      price: { base_cents: 3200, business_addon_cents: 1000 },
    },
    entitled: false,
    steps: [
      { key: "pay", label: "Pay setup fee", done: false },
      { key: "soft_pull", label: "Run your soft pull", done: false },
      { key: "accounts", label: "Add your businesses and accounts", done: false },
      { key: "live", label: "You're live", done: false },
    ],
    current_step: "pay",
  });
  assert.equal(
    database.calls.some((call) => call.params.includes("99999999-9999-4999-8999-999999999999")),
    false,
  );
}

async function proveMoneySetupCheckout() {
  const noPriceDb = moneyDb();
  const noPrice = await invoke(
    moneySetupHandler,
    { method: "POST", body: { action: "start_checkout" } },
    noPriceDb,
    {
      requirePrincipal: gateAs(clientPrincipal()),
      env: {},
      createPaymentLink: async () => assert.fail("price-less checkout must not mint"),
    },
  );
  assert.equal(noPrice.response.statusCode, 409);
  assert.deepEqual(noPrice.response.body, {
    ok: false,
    error: "price_not_set",
    message: "The setup price is not set yet. Nothing was charged and no checkout was made.",
  });
  assert.equal(noPriceDb.find(/INSERT|UPDATE|DELETE/).length, 0);

  const mintCalls = [];
  const mintedDb = moneyDb();
  const minted = await invoke(
    moneySetupHandler,
    { method: "POST", body: { action: "start_checkout" } },
    mintedDb,
    {
      requirePrincipal: gateAs(clientPrincipal()),
      env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" },
      createPaymentLink: async (_db, args) => {
        mintCalls.push(args);
        return { checkout_url: "https://pay.example.test/setup/real" };
      },
    },
  );
  assert.equal(minted.response.statusCode, 200);
  assert.deepEqual(minted.response.body, {
    ok: true,
    reused: false,
    checkout_url: "https://pay.example.test/setup/real",
    amount_cents: 49700,
  });
  assert.equal(mintCalls.length, 1);
  assert.deepEqual(
    {
      orgId: mintCalls[0].orgId,
      clientId: mintCalls[0].clientId,
      purpose: mintCalls[0].purpose,
      description: mintCalls[0].description,
      commasProductTitle: mintCalls[0].commasProductTitle,
      amountCents: mintCalls[0].amountCents,
      createdByStaffId: mintCalls[0].createdByStaffId,
    },
    {
      orgId: ORG_ID,
      clientId: CLIENT_ID,
      purpose: "custom",
      description: "Finance OS setup",
      commasProductTitle: "Consulting Services Engagement",
      amountCents: 49700,
      createdByStaffId: null,
    },
  );
}

async function proveMoneySetupSoftPull() {
  const signCalls = [];
  const database = moneyDb();
  const { response } = await invoke(
    moneySetupHandler,
    { method: "POST", body: { action: "request_soft_pull" } },
    database,
    {
      requirePrincipal: gateAs(clientPrincipal()),
      env: { DOCUMENT_URL_SECRET: MONEY_SECRET },
      signSoftPullApproveUrl: (args) => {
        signCalls.push(args);
        return {
          path: "/app/soft-pull-approve.html?org=o&client=c&exp=1&sig=s",
          expiresAtIso: "2026-10-12T18:00:00.000Z",
        };
      },
    },
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    approve_url: "/app/soft-pull-approve.html?org=o&client=c&exp=1&sig=s",
    expires_at: "2026-10-12T18:00:00.000Z",
  });
  assert.deepEqual(signCalls, [{ orgId: ORG_ID, clientId: CLIENT_ID, secret: MONEY_SECRET }]);
  assert.equal(database.find(/INSERT|UPDATE|DELETE/).length, 0);
}

const BANK_ROW = {
  id: ACCOUNT_ID,
  client_id: CLIENT_ID,
  name: "Business Checking",
  official_name: null,
  mask: "1234",
  account_type: "depository",
  account_subtype: "checking",
  currency_code: "USD",
  available_balance_cents: "120450",
  current_balance_cents: "125000",
  credit_limit_cents: null,
  balance_as_of: "2026-07-01T00:00:00.000Z",
  entity_kind: "business",
  entity_kind_source: "staff_reviewed",
  entity_kind_set_at: "2026-07-02T00:00:00.000Z",
  closed_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-07-02T00:00:00.000Z",
};

function bankDb() {
  return fakeDb([
    staffSession(),
    [/SELECT\s+1\s+FROM\s+clients/i, [{ "?column?": 1 }]],
    [/SELECT\s+id,\s*client_id\s+FROM\s+bank_accounts/i, [{ id: ACCOUNT_ID, client_id: CLIENT_ID }]],
    [/INSERT\s+INTO\s+bank_accounts/i, [{ id: ACCOUNT_ID }]],
    [/UPDATE\s+bank_accounts[\s\S]*entity_kind\s*=/i, [{ id: ACCOUNT_ID, client_id: CLIENT_ID }]],
    [/UPDATE\s+bank_accounts[\s\S]*closed_at\s*=\s*COALESCE/i, [{
      id: ACCOUNT_ID,
      client_id: CLIENT_ID,
      closed_at: "2026-10-12T15:00:00.000Z",
    }]],
    [/FROM\s+bank_accounts\s+WHERE\s+org_id/i, [BANK_ROW]],
  ]);
}

function assertBankSurface(body, extraKeys = []) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ["client_id", "details", "ok", "surface", ...extraKeys].sort(),
  );
  assert.equal(body.ok, true);
  assert.equal(body.client_id, CLIENT_ID);
  assert.deepEqual(body.details[ACCOUNT_ID], {
    official_name: null,
    currency_code: "USD",
    credit_limit_cents: null,
    credit_limit_display: null,
    hand_entered: true,
    created_at: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(body.surface.groups.map((group) => [group.key, group.count]), [
    ["personal", 0],
    ["business", 1],
    ["unknown", 0],
  ]);
  const account = body.surface.groups.find((group) => group.key === "business").accounts[0];
  assert.deepEqual(
    {
      id: account.id,
      name: account.name,
      mask: account.mask,
      type: account.account_type,
      subtype: account.account_subtype,
      available: account.available_balance_cents,
      current: account.current_balance_cents,
      availableDisplay: account.available_display,
      currentDisplay: account.current_display,
      kind: account.entity_kind,
      source: account.entity_kind_source,
      closedAt: account.closed_at,
    },
    {
      id: ACCOUNT_ID,
      name: "Business Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      available: 120450,
      current: 125000,
      availableDisplay: "1204.50",
      currentDisplay: "1250.00",
      kind: "business",
      source: "staff_reviewed",
      closedAt: null,
    },
  );
}

async function proveBankAccountsRead() {
  const database = bankDb();
  const { response } = await invoke(
    bankAccountsHandler,
    req("GET", { query: { client_id: CLIENT_ID } }),
    database,
  );
  assert.equal(response.statusCode, 200);
  assertBankSurface(response.body);
  assert.deepEqual(database.find(/SELECT\s+1\s+FROM\s+clients/i)[0].params, [CLIENT_ID, ORG_ID]);
  assert.deepEqual(database.find(/FROM\s+bank_accounts\s+WHERE\s+org_id/i)[0].params, [ORG_ID, CLIENT_ID]);
}

async function proveBankAccountsWrite() {
  const addedDb = bankDb();
  const added = await invoke(
    bankAccountsHandler,
    req("POST", {
      body: {
        action: "add",
        client_id: CLIENT_ID,
        name: "Reserve",
        mask: "•••• 4321",
        account_type: "other",
        currency_code: "usd",
        available: "1,204.50",
        current: "-12.50",
        credit_limit: "5,000.00",
        balance_as_of: "2026-10-11T00:00:00.000Z",
        entity_kind: "business",
        entity_kind_source: "document_verified",
        at: "2026-10-12T14:00:00.000Z",
      },
    }),
    addedDb,
  );
  assert.equal(added.response.statusCode, 201);
  assert.equal(added.response.body.action, "add");
  assert.equal(added.response.body.account_id, ACCOUNT_ID);
  const insert = addedDb.find(/INSERT\s+INTO\s+bank_accounts/i)[0];
  assert.deepEqual(insert.params.slice(0, 16), [
    ORG_ID,
    CLIENT_ID,
    "Reserve",
    null,
    "4321",
    "other",
    null,
    "USD",
    120450,
    -1250,
    500000,
    "2026-10-11T00:00:00.000Z",
    "business",
    "document_verified",
    "2026-10-12T14:00:00.000Z",
    null,
  ]);
  assert.equal(JSON.parse(insert.params[16]).entry, "manual");
  assertBankSurface(added.response.body, ["action", "account_id"]);

  const classifiedDb = bankDb();
  const classified = await invoke(
    bankAccountsHandler,
    req("POST", {
      body: {
        action: "classify",
        account_id: ACCOUNT_ID,
        entity_kind: "personal",
        entity_kind_source: "staff_reviewed",
        at: "2026-10-12T14:30:00.000Z",
      },
    }),
    classifiedDb,
  );
  assert.equal(classified.response.statusCode, 200);
  assert.deepEqual(classifiedDb.find(/UPDATE\s+bank_accounts[\s\S]*entity_kind\s*=/i)[0].params, [
    ACCOUNT_ID,
    ORG_ID,
    "personal",
    "staff_reviewed",
    "2026-10-12T14:30:00.000Z",
  ]);
  assert.equal(classified.response.body.action, "classify");
  assert.equal(classified.response.body.account_id, ACCOUNT_ID);

  const closedDb = bankDb();
  const closed = await invoke(
    bankAccountsHandler,
    req("POST", { body: { action: "close", account_id: ACCOUNT_ID, at: "2026-10-12T15:00:00.000Z" } }),
    closedDb,
  );
  assert.equal(closed.response.statusCode, 200);
  assert.deepEqual(closedDb.find(/UPDATE\s+bank_accounts[\s\S]*closed_at\s*=\s*COALESCE/i)[0].params, [
    ACCOUNT_ID,
    ORG_ID,
    "2026-10-12T15:00:00.000Z",
  ]);
  assert.equal(closed.response.body.action, "close");
  assert.equal(closed.response.body.closed_at, "2026-10-12T15:00:00.000Z");
  assert.equal(closedDb.find(/DELETE/i).length, 0);

  const refusedDb = bankDb();
  const refused = await invoke(
    bankAccountsHandler,
    req("POST", { body: { action: "add", client_id: CLIENT_ID, account_number: "4011223344556677" } }),
    refusedDb,
  );
  assert.equal(refused.response.statusCode, 400);
  assert.equal(refused.response.body.error, "account_number_not_accepted");
  assert.equal(refusedDb.find(/INSERT\s+INTO\s+bank_accounts/i).length, 0);
}

const RUNNERS = new Map([
  ["b8bc5824add2ef89a113", proveApplicationsRead],
  ["503556c4e0d1f1a71fe5", proveApplicationsWrite],
  ["8541087a66a369d274ce", proveApplicationExclusion],
  ["c76b671aba949673a18a", proveEntitiesRead],
  ["c180bdefaa3962cb17fc", proveEntitiesWrite],
  ["23bcc39b8ed2cbbdec9e", proveMoneySetupRead],
  ["72c056b2b1e085c4765d", proveMoneySetupCheckout],
  ["1bf2cfb2dc11f077194e", proveMoneySetupSoftPull],
  ["2d05a35a927e5c821ad7", proveBankAccountsRead],
  ["9f6241af887043ee66ba", proveBankAccountsWrite],
]);

test("Door 01 second shard exports only exact freshly compiled rows with full real-handler result proof", async (t) => {
  assert.equal(DOOR_CONTRACTS_ROUTES_01_2_PROOFS.length, 10);
  assert.equal(new Set(DOOR_CONTRACTS_ROUTES_01_2_ROW_KEYS).size, 10);
  assert.equal(
    DOOR_CONTRACTS_ROUTES_01_2_ROW_KEYS.some((key) => DOOR_CONTRACTS_ROUTES_01_ROW_KEYS.includes(key)),
    false,
    "the second shard must stay disjoint from the first",
  );

  const exercised = new Set();
  for (const entry of DOOR_CONTRACTS_ROUTES_01_2_PROOFS) {
    await t.test(entry.key, async () => {
      const rows = JSON.parse(fs.readFileSync(path.join(MAP, entry.sourceFile), "utf8"));
      const row = rows.find(
        (candidate) => candidate.surface === entry.surface && candidate.control === entry.control,
      );
      assert.ok(row, `missing catalog row ${entry.key}`);
      assert.equal(doorContractsRoutes012RowKey(entry.sourceFile, row), entry.key);
      assert.deepEqual(doorContractsRoutes012Proof(entry.sourceFile, row), entry.proof);

      const generated = GENERATED.find((candidate) => candidate.id === entry.generatedId);
      assert.ok(generated, `missing generated row ${entry.generatedId}`);
      assert.equal(generated.sourceFile, entry.sourceFile);
      assert.equal(generated.surface, entry.surface);
      assert.equal(generated.proofVerdict, undefined, `${entry.generatedId} stayed red after its result proof compiled`);
      assert.equal(generated.state, "wired");
      assert.equal(generated.proofDepth, entry.proof.depth);
      assert.ok(generated.proof.tests.includes(entry.proof.evidence));

      const runner = RUNNERS.get(entry.generatedId);
      assert.equal(typeof runner, "function", `missing real-handler runner ${entry.generatedId}`);
      await runner();
      exercised.add(entry.key);
    });
  }

  assert.deepEqual([...exercised].sort(), [...DOOR_CONTRACTS_ROUTES_01_2_ROW_KEYS].sort());
});
