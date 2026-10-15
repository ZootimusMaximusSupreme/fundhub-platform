// finish-853 batch 08: POST and DELETE /api/demo/simulate. The real handler, the real simulated-client
// loader and the real tradeline and card-liability ingest run over in-memory stand-in tables. The
// teardown's own statements are executed by the stand-in the way Postgres reads them: the catalog
// question returns the test's list of tables that point at a client, and the one big "wipe the
// children" statement is read for the delete targets it names and for the client condition it carries.
// A stand-in does not enforce foreign keys; the *.pg.test.mjs files own that. Practice test, fake data,
// no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/demo/simulate.mjs";
import { staffSession, req, makeRes, runWithSharedDb, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { rowsWhere, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const PIPELINE = "b1000000-0000-4000-8000-000000000001";
const OTHER_PIPELINE = "b2000000-0000-4000-8000-000000000002";
const STAGE_FIRST = "b3000000-0000-4000-8000-000000000001";
const STAGE_LATER = "b3000000-0000-4000-8000-000000000002";
const STAGE_OTHER_ORG = "b3000000-0000-4000-8000-000000000009";
const CLIENT = (n) => `c${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;

const demoOnly = (sql, rows) => (/\bis_demo\s*=\s*true\b/i.test(sql) ? rows.filter((r) => r.is_demo === true) : rows);

function world({ pipelines = true, failBankInsert = false, catalog, refuse = {}, flipDemoOnRead = null } = {}) {
  const tables = {
    clients: [], crs_results: [], tradelines: [], card_liabilities: [], card_liability_history: [],
    cards: [], bank_accounts: [], messages: [], events: [], contracts: [], contract_signers: [], new_things: [],
    invoices: [], invoice_payments: [], documents: [], document_versions: [],
    pipelines: pipelines ? [
      { id: PIPELINE, org_id: ORG_ID, key: "sales" },
      { id: OTHER_PIPELINE, org_id: OTHER_ORG_ID, key: "sales" },
    ] : [],
    pipeline_stages: pipelines ? [
      { id: STAGE_LATER, pipeline_id: PIPELINE, sort_order: 20 },
      { id: STAGE_FIRST, pipeline_id: PIPELINE, sort_order: 10 },
      { id: STAGE_OTHER_ORG, pipeline_id: OTHER_PIPELINE, sort_order: 1 },
    ] : [],
  };
  const fkChildren = catalog || [
    { table_name: "messages", column_name: "client_id", on_delete: "a" },
    { table_name: "events", column_name: "client_id", on_delete: "n" },
    { table_name: "cards", column_name: "client_id", on_delete: "a" },
    { table_name: "crs_results", column_name: "client_id", on_delete: "a" },
    { table_name: "tradelines", column_name: "client_id", on_delete: "a" },
    { table_name: "contracts", column_name: "client_id", on_delete: "a" },
  ];
  let snapshot = null;
  const wipes = [];
  const restore = () => {
    for (const k of Object.keys(snapshot)) tables[k].splice(0, tables[k].length, ...snapshot[k]);
  };
  const rules = [
    staffSession({ role: world.role || "owner", org_id: world.org === undefined ? ORG_ID : world.org }),
    [/^\s*BEGIN\b/i, () => { snapshot = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))])); return []; }],
    [/^\s*COMMIT\b/i, () => { snapshot = null; return []; }],
    [/^\s*ROLLBACK\b/i, () => { if (snapshot) restore(); snapshot = null; return []; }],
    // The first sales stage: the pipeline the statement names (key and company), earliest sort_order.
    [/FROM pipelines p\s+JOIN pipeline_stages ps/i, (sql, p) => {
      const key = /p\.key = '([^']*)'/.exec(sql)?.[1];
      const dir = /ORDER BY ps\.sort_order (ASC|DESC)/i.exec(sql)?.[1] || "ASC";
      const lines = tables.pipelines.filter((x) => x.org_id === p[0] && x.key === key);
      const stages = tables.pipeline_stages.filter((s) => lines.some((l) => l.id === s.pipeline_id))
        .sort((a, b) => (dir.toUpperCase() === "ASC" ? a.sort_order - b.sort_order : b.sort_order - a.sort_order));
      return stages.slice(0, 1).map((s) => ({ stage_id: s.id, pipeline_id: s.pipeline_id }));
    }],
    [/UPDATE clients SET custom_fields = custom_fields \|\| \$2::jsonb/i, (sql, p) => {
      for (const row of tables.clients.filter((c) => c.id === p[0])) row.custom_fields = { ...(row.custom_fields || {}), ...JSON.parse(p[1]) };
      return { rows: [], rowCount: 1 };
    }],
    [/FROM tradelines WHERE client_id = \$1 AND account_ref = ANY\(\$2::text\[\]\)/i, (sql, p) =>
      tables.tradelines.filter((t) => t.client_id === p[0] && p[1].includes(t.account_ref)).map((t) => ({ id: t.id, account_ref: t.account_ref }))],
    [/^\s*UPDATE card_liability_history\s+SET liability_id/i, { rows: [], rowCount: 0 }],
    [(sql) => failBankInsert && /^\s*INSERT INTO bank_accounts/i.test(sql), () => new Error("bank_accounts is not there")],
    // Teardown: which tables point at a client (the catalog question).
    [/FROM pg_constraint con/i, () => fkChildren.map((r) => ({ ...r }))],
    [/^\s*SELECT id, email FROM clients WHERE org_id = \$1 AND id = \$2/i, (sql, p) => {
      const kept = demoOnly(sql, rowsWhere(tables.clients, "FROM clients WHERE org_id = $1 AND id = $2", p)).map((r) => ({ id: r.id, email: r.email }));
      // Someone un-flags the client right after it was read (the row changed underneath the teardown).
      if (flipDemoOnRead) for (const c of tables.clients) if (c.id === flipDemoOnRead) c.is_demo = false;
      return kept;
    }],
    [/^\s*SELECT id, email FROM clients\s+WHERE org_id = \$1 AND is_demo = true/i, (sql, p) => {
      const like = new RegExp(`^${String(p[1]).replace(/[.+*?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
      const kept = demoOnly(sql, tables.clients.filter((c) => c.org_id === p[0]))
        .filter((c) => like.test(c.email) || (c.tags || []).includes("simulated"))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, Number(p[2]));
      return kept.map((r) => ({ id: r.id, email: r.email }));
    }],
    // The one statement that wipes every child of the client.
    [/^\s*WITH victim AS/i, (sql, p) => {
      const where = /victim AS \(SELECT id FROM clients (WHERE [^)]*)\)/i.exec(sql)[1];
      const victims = demoOnly(where, rowsWhere(tables.clients, `FROM clients ${where}`, p));
      const ids = new Set(victims.map((r) => r.id));
      const doomed = [];
      for (const m of sql.matchAll(/AS \(DELETE FROM "([A-Za-z_]\w*)" WHERE "([A-Za-z_]\w*)" IN \(SELECT id FROM "([A-Za-z_]\w*)" WHERE client_id IN \(SELECT id FROM victim\)\)\)/g)) {
        const parents = new Set(tables[m[3]].filter((r) => ids.has(r.client_id)).map((r) => r.id));
        doomed.push([m[1], tables[m[1]].filter((r) => parents.has(r[m[2]]))]);
      }
      for (const m of sql.matchAll(/AS \(DELETE FROM "([A-Za-z_]\w*)" WHERE "([A-Za-z_]\w*)" IN \(SELECT id FROM victim\)\)/g)) {
        if (!tables[m[1]]) throw new Error(`stand-in has no table ${m[1]}`);
        doomed.push([m[1], tables[m[1]].filter((r) => ids.has(r[m[2]]))]);
      }
      for (const [name, rows] of doomed) for (const row of rows) { const i = tables[name].indexOf(row); if (i >= 0) tables[name].splice(i, 1); }
      wipes.push({ victims: [...ids], deleted: doomed.map(([n, r]) => [n, r.length]) });
      return [{ matched: ids.size }];
    }],
    [/^\s*DELETE FROM clients WHERE id = \$1\b/i, (sql, p) => {
      if (refuse[p[0]]) return Object.assign(new Error(refuse[p[0]].message), refuse[p[0]].props);
      const hit = demoOnly(sql, tables.clients.filter((c) => c.id === p[0]));
      for (const row of hit) tables.clients.splice(tables.clients.indexOf(row), 1);
      return { rows: hit.map((r) => ({ id: r.id })), rowCount: hit.length };
    }],
  ];
  const fake = tablesDb({ tables, rules, autoInsert: true, autoUpdate: true, defaults: { crs_results: { created_at: "2026-10-14T12:00:00.000Z" } } });
  fake.tables = tables;
  fake.wipes = wipes;
  return fake;
}
world.role = "owner";
world.org = ORG_ID;

async function call(method, { body, query, fake = world() } = {}) {
  const res = makeRes();
  const request = req(method, { body, query });
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}
const as = (role, org = ORG_ID) => { world.role = role; world.org = org; };

function seedClients(fake, { n = 0 } = {}) {
  const make = (id, over) => ({ id, org_id: ORG_ID, email: `sim+${id.slice(0, 4)}@demo.fundhub.local`, is_demo: true, tags: ["is_demo", "simulated"], created_at: `2026-10-0${(n % 8) + 1}T00:00:00Z`, ...over });
  const rows = [
    make(CLIENT(1), {}),
    make(CLIENT(2), {}),
    { id: CLIENT(3), org_id: ORG_ID, email: "real.person@example.test", is_demo: false, tags: [], created_at: "2026-09-01T00:00:00Z" },
    make(CLIENT(4), { org_id: OTHER_ORG_ID }),
    // A real person who only LOOKS simulated: the demo-looking email and tag, but not flagged demo.
    { id: CLIENT(5), org_id: ORG_ID, email: "sim+lookalike@demo.fundhub.local", is_demo: false, tags: ["simulated"], created_at: "2026-09-02T00:00:00Z" },
  ];
  fake.tables.clients.push(...rows);
  for (const c of rows) {
    fake.tables.messages.push({ id: `m-${c.id}`, client_id: c.id });
    fake.tables.events.push({ id: `e-${c.id}`, client_id: c.id });
    fake.tables.contracts.push({ id: `k-${c.id}`, client_id: c.id });
    fake.tables.contract_signers.push({ id: `s-${c.id}`, contract_id: `k-${c.id}` });
  }
  return rows;
}
const kids = (fake, id) => ({
  messages: fake.tables.messages.filter((r) => r.client_id === id).length,
  events: fake.tables.events.filter((r) => r.client_id === id).length,
  contracts: fake.tables.contracts.filter((r) => r.client_id === id).length,
  signers: fake.tables.contract_signers.filter((r) => r.contract_id === `k-${id}`).length,
});

describe("POST /api/demo/simulate", () => {
  test("it makes one demo client, a credit pull of its own, four cards with their billing positions, a pipeline card and a bank account, all inside the staff member's company", async () => {
    as("owner");
    const fake = world();
    const { res } = await call("POST", { fake, body: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(fake.tables.clients.length, 1);
    const client = fake.tables.clients[0];
    assert.equal(res.body.client_id, client.id);
    assert.match(res.body.email, /^sim\+\d+@demo\.fundhub\.local$/);
    assert.equal(client.email, res.body.email);
    assert.equal(client.org_id, ORG_ID);
    assert.equal(client.is_demo, true);
    assert.equal(client.channel_source, "simulated");
    assert.equal(client.outcome_tier, "FULL_FUNDING");
    assert.deepEqual(client.custom_fields, {
      crs_inquiries_ex: 4, crs_inquiries_eq: 2, crs_inquiries_tu: 1,
      crs_negative_items_count: 0, crs_late_payments_count: 0, business_age_months: 30,
    });

    const crs = fake.tables.crs_results;
    assert.equal(crs.length, 1);
    assert.equal(res.body.crs_id, crs[0].id);
    assert.equal(crs[0].client_id, client.id);
    assert.equal(crs[0].org_id, ORG_ID);
    assert.equal(crs[0].is_demo, true);
    assert.equal(crs[0].outcome_tier, "FULL_FUNDING");
    assert.deepEqual(crs[0].result.scores, { ex: 718, eq: 724, tu: 731 });
    assert.equal(crs[0].result.environment, "simulated", "never 'sandbox': a sandbox pull is skipped whole by the readers");

    assert.equal(res.body.tradeline_count, 4);
    assert.equal(fake.tables.tradelines.length, 4);
    for (const t of fake.tables.tradelines) {
      assert.equal(t.org_id, ORG_ID);
      assert.equal(t.client_id, client.id);
      assert.equal(t.is_demo, true, `${t.lender} is flagged demo`);
    }
    assert.deepEqual(fake.tables.tradelines.map((t) => t.lender).sort(),
      ["American Express Blue Business Cash", "Capital One Spark", "Chase Sapphire Preferred", "Toyota Motor Credit"]);
    const chase = fake.tables.tradelines.find((t) => /Chase/.test(t.lender));
    assert.equal(chase.credit_limit_cents, 1200000);
    assert.equal(chase.balance_cents, 210000);
    assert.equal(chase.account_ref, "SIM-CHASE-001");

    assert.equal(fake.tables.card_liabilities.length, 4, "every account has its billing position");
    for (const l of fake.tables.card_liabilities) {
      assert.equal(l.client_id, client.id);
      assert.equal(l.org_id, ORG_ID);
      assert.equal(l.is_demo, true);
      assert.ok(fake.tables.tradelines.some((t) => t.id === l.tradeline_id), "tied to a real card line");
    }

    assert.equal(fake.tables.cards.length, 1);
    const card = fake.tables.cards[0];
    assert.equal(res.body.card_id, card.id);
    assert.equal(card.stage_id, STAGE_FIRST, "the earliest stage of this company's sales pipeline");
    assert.equal(card.pipeline_id, PIPELINE);
    assert.equal(card.owner, STAFF_ID);
    assert.equal(card.is_demo, true);

    assert.equal(fake.tables.bank_accounts.length, 1);
    assert.equal(fake.tables.bank_accounts[0].is_demo, true);
    assert.equal(fake.tables.bank_accounts[0].client_id, client.id);
    assert.equal(res.body.href, `/app/finance-os.html?client_id=${client.id}`);

    for (const name of ["clients", "crs_results", "tradelines", "card_liabilities", "cards", "bank_accounts"]) {
      for (const row of fake.tables[name]) assert.equal(row.org_id, ORG_ID, `${name} row stays in the company`);
    }
  });

  test("the credit file reads as a real pull: FICO model names, every inquiry listed and counted the same way, one report per bureau, and a funded bank account", async () => {
    as("owner");
    const fake = world();
    const { res } = await call("POST", { fake, body: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const client = fake.tables.clients[0];
    const result = fake.tables.crs_results[0].result;
    assert.deepEqual(result.scoreModels, { ex: "FICO 9", eq: "FICO 9", tu: "FICO 9" }, "a model that does not read as FICO is thrown away by the readers");
    assert.deepEqual(result.bureausPulled, ["TU", "EX", "EQ"]);

    // The inquiry list and the per-bureau counts written on the client are one fact, counted from one list.
    assert.equal(result.inquiries.length, 7);
    const count = (code) => result.inquiries.filter((i) => i.source === code).length;
    assert.equal(count("EX"), client.custom_fields.crs_inquiries_ex);
    assert.equal(count("EQ"), client.custom_fields.crs_inquiries_eq);
    assert.equal(count("TU"), client.custom_fields.crs_inquiries_tu);
    for (const i of result.inquiries) assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(result.inquiries.every((i) => i.creditorName && i.sourceType && i.inquiryDate === i.date));

    // One report per bureau, in the shape a real merged pull keeps.
    assert.deepEqual(Object.keys(result.bureaus).sort(), ["EQ", "EX", "TU"]);
    const expectedScore = { EX: 718, EQ: 724, TU: 731 };
    for (const [code, report] of Object.entries(result.bureaus)) {
      assert.equal(report.scores[0].modelName, "FICO 9", code);
      assert.equal(report.scores[0].scoreValue, expectedScore[code], code);
      assert.equal(report.scores[0].scoreMaximumValue, 850);
      assert.equal(report.inquiries.length, count(code), `${code}: its own inquiries`);
      assert.ok(report.tradelines.every((t) => t.bureau === code), `${code}: its own accounts`);
      assert.deepEqual(report.publicRecords, []);
    }
    assert.equal(result.bureaus.EX.tradelines.length, 2);
    assert.equal(result.bureaus.EQ.tradelines.length, 1);
    assert.equal(result.bureaus.TU.tradelines.length, 1);
    assert.deepEqual(result.publicRecords, []);

    // The client says what it is, and can be found again by the wipe.
    assert.deepEqual(client.tags, ["is_demo", "simulated"]);
    assert.equal(client.consent_sms, true);
    assert.equal(client.first_name, "Simulated");
    assert.match(client.phone, /^\+1555\d{7}$/);

    const bank = fake.tables.bank_accounts[0];
    assert.equal(bank.current_balance_cents, 500000, "the account holds $5,000.00, in cents");
    assert.equal(bank.name, "Simulated Checking");
    assert.equal(bank.account_type, "depository");
    assert.equal(bank.mask, "4242");
    assert.equal(bank.currency_code, "USD");
    assert.deepEqual(bank.raw, { provider: "mock", is_demo: true });
  });

  test("a company with no sales pipeline still gets its client and credit file, just no pipeline card; a bank table that fails does not undo the client", async () => {
    as("admin");
    const noPipeline = world({ pipelines: false });
    const a = await call("POST", { fake: noPipeline, body: {} });
    assert.equal(a.res.statusCode, 200);
    assert.equal(a.res.body.card_id, null);
    assert.equal(noPipeline.tables.clients.length, 1);
    assert.equal(noPipeline.tables.tradelines.length, 4);

    const noBank = world({ failBankInsert: true });
    const b = await call("POST", { fake: noBank, body: {} });
    assert.equal(b.res.statusCode, 200);
    assert.equal(noBank.tables.bank_accounts.length, 0);
    assert.equal(noBank.tables.clients.length, 1);
    assert.equal(noBank.tables.cards.length, 1);
  });

  test("only owner and admin may load one: every other staff role is refused with 403 and nothing is written", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      as(role);
      const fake = world();
      const { res } = await call("POST", { fake, body: {} });
      if (res.statusCode === 403) {
        assert.equal(fake.tables.clients.length, 0, `${role}: no client`);
        assert.equal(fake.tables.crs_results.length, 0);
        assert.equal(fake.tables.tradelines.length, 0);
      } else { letIn.push(role); assert.equal(res.statusCode, 200); }
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
    as("owner");
  });

  test("no sign-in gets 401, a session with no company gets 403 no_org_scope, and any other method gets 405", async () => {
    as("owner");
    const none = makeRes();
    const bare = world();
    bare.query = async () => ({ rows: [], rowCount: 0 });
    await runWithSharedDb({ query: bare.query, connect: bare.connect }, () => handler(req("POST", { body: {} }), none));
    assert.equal(none.statusCode, 401);

    as("owner", null);
    const noOrg = world();
    const a = await call("POST", { fake: noOrg, body: {} });
    assert.equal(a.res.statusCode, 403);
    assert.equal(a.res.body.error, "no_org_scope");
    assert.equal(noOrg.tables.clients.length, 0);

    as("owner");
    const b = await call("PUT", { fake: world(), body: {} });
    assert.equal(b.res.statusCode, 405);
    assert.equal(b.res.headers.allow, "POST, DELETE");
  });
});

describe("DELETE /api/demo/simulate", () => {
  test("with a client id it wipes that demo client's children and the client, and only that one", async () => {
    as("owner");
    const fake = world();
    seedClients(fake);
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.removed.map((r) => r.id), [CLIENT(1)]);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.truncated, false);
    assert.equal(fake.tables.clients.some((c) => c.id === CLIENT(1)), false);
    assert.deepEqual(kids(fake, CLIENT(1)), { messages: 0, events: 0, contracts: 0, signers: 0 }, "nothing is left behind, signers included");
    for (const keep of [CLIENT(2), CLIENT(3), CLIENT(4), CLIENT(5)]) {
      assert.ok(fake.tables.clients.some((c) => c.id === keep), `${keep} is still there`);
      assert.deepEqual(kids(fake, keep), { messages: 1, events: 1, contracts: 1, signers: 1 });
    }
  });

  test("the children go first and the client last, inside one BEGIN and COMMIT", async () => {
    as("owner");
    const fake = world();
    seedClients(fake);
    await call("DELETE", { fake, body: { client_id: CLIENT(2) } });
    const order = fake.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 2).join(" "));
    const at = (needle) => order.findIndex((o) => o.startsWith(needle));
    assert.ok(at("BEGIN") >= 0 && at("WITH victim") > at("BEGIN"), "BEGIN before the child wipe");
    assert.ok(at("DELETE FROM") > at("WITH victim"), "the client is deleted after the children");
    assert.ok(at("COMMIT") > at("DELETE FROM"), "COMMIT after the client");
    assert.equal(order.includes("ROLLBACK"), false);
    const wipe = fake.calls.find((c) => /^\s*WITH victim/.test(c.sql));
    assert.deepEqual(wipe.params, [CLIENT(2)]);
    const catalog = fake.calls.find((c) => /FROM pg_constraint/.test(c.sql)).sql;
    assert.match(catalog, /con\.confrelid = 'public\.clients'::regclass/);
    assert.match(catalog, /con\.confdeltype <> 'c'/, "cascading links are left to the database");
    assert.match(catalog, /con\.contype = 'f'/);
    assert.doesNotMatch(wipe.sql, /DELETE FROM "clients"/, "the client is not in the children statement");
  });

  test("a real client is never removed by this path, even by its own id, and another company's demo client reads as not found", async () => {
    as("owner");
    const fake = world();
    seedClients(fake);
    const real = await call("DELETE", { fake, body: { client_id: CLIENT(3) } });
    const lookalike = await call("DELETE", { fake, body: { client_id: CLIENT(5) } });
    assert.equal(lookalike.res.body.count, 0, "a demo-looking email or tag is not enough: the demo flag decides");
    assert.equal(real.res.statusCode, 200);
    assert.equal(real.res.body.count, 0);
    assert.deepEqual(real.res.body.removed, []);
    const foreign = await call("DELETE", { fake, body: { client_id: CLIENT(4) } });
    assert.equal(foreign.res.body.count, 0);
    assert.equal(fake.tables.clients.length, 5, "no client changed");
    assert.equal(fake.tables.messages.length, 5);
    assert.equal(fake.wipes.length, 0, "no child statement ran for a client this path may not touch");
  });

  test("with no client id it removes every demo client of the company, newest first, and leaves real clients and other companies alone", async () => {
    as("admin");
    const fake = world();
    seedClients(fake);
    const { res } = await call("DELETE", { fake, body: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.removed.map((r) => r.id).sort(), [CLIENT(1), CLIENT(2)]);
    assert.equal(res.body.count, 2);
    assert.deepEqual(fake.tables.clients.map((c) => c.id).sort(), [CLIENT(3), CLIENT(4), CLIENT(5)]);
    for (const id of [CLIENT(3), CLIENT(4), CLIENT(5)]) assert.deepEqual(kids(fake, id), { messages: 1, events: 1, contracts: 1, signers: 1 });
    const list = fake.calls.find((c) => /^\s*SELECT id, email FROM clients\s+WHERE org_id/.test(c.sql));
    assert.match(list.sql, /WHERE org_id = \$1 AND is_demo = true/, "the list itself asks for this company's demo clients only");
    assert.deepEqual(list.params.slice(0, 2), [ORG_ID, "sim+%@demo.fundhub.local"]);
  });

  test("a big org is cut at 100 and says so, so the caller calls again", async () => {
    as("owner");
    const fake = world();
    for (let i = 0; i < 101; i += 1) {
      fake.tables.clients.push({ id: CLIENT(100 + i), org_id: ORG_ID, email: `sim+${i}@demo.fundhub.local`, is_demo: true, tags: ["simulated"], created_at: new Date(1760000000000 + i * 1000).toISOString() });
    }
    const { res } = await call("DELETE", { fake, body: {} });
    assert.equal(res.body.count, 100);
    assert.equal(res.body.truncated, true);
    assert.equal(fake.tables.clients.length, 1, "one demo client is left for the next call");
  });

  test("a table added to the schema later is cleaned too, because the list is read from the catalog every time", async () => {
    as("owner");
    const fake = world({ catalog: [
      { table_name: "messages", column_name: "client_id", on_delete: "a" },
      { table_name: "new_things", column_name: "owner_client_id", on_delete: "n" },
    ] });
    seedClients(fake);
    fake.tables.new_things.push({ id: "n1", owner_client_id: CLIENT(1) }, { id: "n2", owner_client_id: CLIENT(3) });
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.body.count, 1);
    assert.deepEqual(fake.tables.new_things.map((r) => r.id), ["n2"], "only the demo client's row went");
    const wipe = fake.calls.find((c) => /^\s*WITH victim/.test(c.sql));
    assert.match(wipe.sql, /DELETE FROM "new_things" WHERE "owner_client_id" IN \(SELECT id FROM victim\)/);
  });

  test("a client that stopped being demo between the read and the delete is not removed", async () => {
    as("owner");
    const fake = world({ flipDemoOnRead: CLIENT(1) });
    seedClients(fake);
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 0);
    assert.ok(fake.tables.clients.some((c) => c.id === CLIENT(1)), "the client row is still there");
    assert.deepEqual(kids(fake, CLIENT(1)), { messages: 1, events: 1, contracts: 1, signers: 1 }, "and so is everything that hangs off it");
  });

  test("when a table refuses the delete the answer names it, everything is rolled back, and the client keeps its data", async () => {
    as("owner");
    const fake = world({ refuse: { [CLIENT(1)]: { message: "update or delete violates foreign key", props: { table: "affiliate_payout_lines", code: "23503" } } } });
    seedClients(fake);
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.blocked_by, "affiliate_payout_lines");
    assert.equal(res.body.code, "23503");
    assert.match(res.body.error, /blocked by affiliate_payout_lines/, "the message itself names the table that refused");
    assert.ok(fake.tables.clients.some((c) => c.id === CLIENT(1)));
    assert.deepEqual(kids(fake, CLIENT(1)), { messages: 1, events: 1, contracts: 1, signers: 1 }, "the children are back: nothing half-erased");
    assert.equal(fake.calls.filter((c) => /^\s*ROLLBACK/.test(c.sql)).length, 1);
    assert.equal(fake.calls.filter((c) => /^\s*COMMIT/.test(c.sql)).length, 0);
  });

  test("a table name from the catalog that is not a plain identifier stops the wipe before any delete runs", async () => {
    as("owner");
    const fake = world({ catalog: [{ table_name: 'messages"; DROP TABLE clients; --', column_name: "client_id", on_delete: "a" }] });
    seedClients(fake);
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.statusCode, 500);
    assert.equal(fake.calls.some((c) => /DROP TABLE/i.test(c.sql)), false);
    assert.equal(fake.tables.clients.length, 5);
  });

  test("a demo client's invoice payments and document versions go with it, and only its own", async () => {
    as("owner");
    const fake = world({ catalog: [
      { table_name: "messages", column_name: "client_id", on_delete: "a" },
      { table_name: "events", column_name: "client_id", on_delete: "n" },
      { table_name: "contracts", column_name: "client_id", on_delete: "a" },
      { table_name: "invoices", column_name: "client_id", on_delete: "a" },
      { table_name: "documents", column_name: "client_id", on_delete: "a" },
    ] });
    seedClients(fake);
    for (const id of [CLIENT(1), CLIENT(2)]) {
      fake.tables.invoices.push({ id: `inv-${id}`, client_id: id });
      fake.tables.invoice_payments.push({ id: `pay-${id}`, invoice_id: `inv-${id}` });
      fake.tables.documents.push({ id: `doc-${id}`, client_id: id });
      fake.tables.document_versions.push({ id: `ver-${id}`, document_id: `doc-${id}` });
    }
    const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.count, 1);
    assert.deepEqual(fake.tables.invoice_payments.map((r) => r.id), [`pay-${CLIENT(2)}`], "the payment that hung off the invoice is gone");
    assert.deepEqual(fake.tables.document_versions.map((r) => r.id), [`ver-${CLIENT(2)}`], "the version that hung off the document is gone");
    assert.deepEqual(fake.tables.invoices.map((r) => r.id), [`inv-${CLIENT(2)}`]);
    assert.deepEqual(fake.tables.documents.map((r) => r.id), [`doc-${CLIENT(2)}`]);
    const wipe = fake.calls.find((c) => /^\s*WITH victim/.test(c.sql));
    assert.match(wipe.sql, /DELETE FROM "invoice_payments" WHERE "invoice_id" IN \(SELECT id FROM "invoices" WHERE client_id IN \(SELECT id FROM victim\)\)/);
    assert.match(wipe.sql, /DELETE FROM "document_versions" WHERE "document_id" IN \(SELECT id FROM "documents" WHERE client_id IN \(SELECT id FROM victim\)\)/);
    assert.match(wipe.sql, /DELETE FROM "contract_signers" WHERE "contract_id" IN \(SELECT id FROM "contracts" WHERE client_id IN \(SELECT id FROM victim\)\)/);
  });

  test("the client id may arrive in the address, and then only that client goes; a company named in the body is ignored", async () => {
    as("owner");
    const fake = world();
    seedClients(fake);
    const named = await call("DELETE", { fake, query: { client_id: CLIENT(1) } });
    assert.equal(named.res.statusCode, 200, JSON.stringify(named.res.body));
    assert.deepEqual(named.res.body.removed.map((r) => r.id), [CLIENT(1)], "one client, not every demo client");
    assert.ok(fake.tables.clients.some((c) => c.id === CLIENT(2)), "the other demo client of the company is still there");

    // A body that names another company changes nothing: the company is the sign-in's.
    const hostile = await call("DELETE", { fake, body: { org_id: OTHER_ORG_ID } });
    assert.equal(hostile.res.statusCode, 200);
    assert.deepEqual(hostile.res.body.removed.map((r) => r.id), [CLIENT(2)]);
    assert.ok(fake.tables.clients.some((c) => c.id === CLIENT(4)), "the other company's demo client is untouched");
    const list = fake.calls.filter((c) => /^\s*SELECT id, email FROM clients\s+WHERE org_id/.test(c.sql)).at(-1);
    assert.equal(list.params[0], ORG_ID);
  });

  test("when there are more than 100, the 100 newest go and the oldest is left for the next call", async () => {
    as("owner");
    const fake = world();
    for (let i = 0; i < 101; i += 1) {
      fake.tables.clients.push({ id: CLIENT(100 + i), org_id: ORG_ID, email: `sim+${i}@demo.fundhub.local`, is_demo: true, tags: ["simulated"], created_at: new Date(1760000000000 + i * 1000).toISOString() });
    }
    const { res } = await call("DELETE", { fake, body: {} });
    assert.equal(res.body.truncated, true);
    assert.deepEqual(fake.tables.clients.map((c) => c.id), [CLIENT(100)], "the oldest one is the one left");
    assert.equal(res.body.removed.some((r) => r.id === CLIENT(200)), true, "the newest went");
    const list = fake.calls.find((c) => /^\s*SELECT id, email FROM clients\s+WHERE org_id/.test(c.sql));
    assert.match(list.sql, /ORDER BY created_at DESC/);
    assert.equal(list.params[2], 101, "one more than the cap is read, to know it was cut");
  });

  test("only owner and admin may tear down: other roles get 403 and the book is untouched", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      as(role);
      const fake = world();
      seedClients(fake);
      const { res } = await call("DELETE", { fake, body: { client_id: CLIENT(1) } });
      if (res.statusCode === 403) {
        assert.equal(fake.tables.clients.length, 5, `${role}: nothing removed`);
        assert.equal(fake.calls.some((c) => /^\s*(BEGIN|WITH victim|DELETE)/.test(c.sql)), false);
      } else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
    as("owner");
  });
});
