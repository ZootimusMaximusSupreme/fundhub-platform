// A connection-local fixture exercises the same PostgreSQL query used in production.
// Only allow a loopback scratch instance; never query customers or call Meta.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { publicContact } from "./public-contact.mjs";
import { hashEmail, hashPhone } from "./user-data.mjs";

const url = process.env.DATABASE_URL || "";
let local = false;
try { local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); } catch { /* not configured */ }
describe("public survey contact provenance", { skip: local ? false : "requires local scratch PostgreSQL" }, () => {
  const org = randomUUID(), clientId = randomUUID();
  let db;
  before(async () => {
    db = new pg.Client({ connectionString: url }); await db.connect();
    await db.query("CREATE TEMP TABLE events (id uuid PRIMARY KEY, org_id uuid, client_id uuid, name text, idempotency_key text, created_at timestamptz, payload jsonb)");
  });
  after(async () => { await db?.end(); });
  async function add({ name, data, client = null, age = "0 seconds", tenant = org, key = null }) {
    const id = randomUUID();
    await db.query("INSERT INTO events VALUES ($1,$2,$3,$4,$5,now()-$6::interval,$7)", [id, tenant, client, name, key, age, data]);
    return id;
  }
  const email = "reader@neutral.test", phone = "2025550102";
  async function receipt({ home = false, source, tenant, name = "survey.completed", client = clientId, address = email, age = "1 minute" } = {}) {
    return add({ name, tenant, client, age, key: home ? "website-survey:fixture:completed" : "clickfunnels:fixture:survey.completed",
      data: { email: address, phone, source: source || (home ? "website:home" : "clickfunnels"), funnel: home ? undefined : "apply-survey" } });
  }
  async function link(session_id, id, home = false, age = "0 seconds") {
    return add({ name: "funnel.survey_answer", age, data: { session_id, page: home ? "/home" : "/apply",
      props: { survey: home ? "home" : "apply", last: true, completion_acknowledged: true, public_contact_receipt: id } } });
  }
  test("each public form supplies hashes only from its own acknowledged receipt", async () => {
    for (const home of [false, true]) {
      const session = randomUUID(); await link(session, await receipt({ home }), home);
      assert.deepEqual(await publicContact(db, org, session), { clientId, emailHash: hashEmail(email), phoneHash: hashPhone(phone), actor: "person" });
    }
  });

  test("an old survey marker without an acknowledgement cannot supply a customer identifier", async () => {
    const session_id = randomUUID();
    await add({ name: "funnel.survey_answer", data: { session_id, page: "/apply",
      props: { survey: "apply", last: true, public_contact_receipt: await receipt() } } });
    assert.equal(await publicContact(db, org, session_id), null);
  });
  test("wrong session, source, tenant, event, age or malformed receipt cannot identify anyone", async () => {
    for (const id of [await receipt({ source: "checkout" }), await receipt({ tenant: randomUUID() }),
      await receipt({ name: "payment.received" }), await receipt({ age: "3 days" }), await receipt({ client: null }), "not-an-id", null]) {
      const session = randomUUID(); await link(session, id); assert.equal(await publicContact(db, org, session), null);
    }
    assert.equal(await publicContact(db, org, randomUUID()), null);
  });
  test("an ambiguous or stale session stays anonymous", async () => {
    const shared = randomUUID(), stale = randomUUID();
    await link(shared, await receipt()); await link(shared, await receipt({ client: randomUUID(), address: "another@neutral.test" }));
    await link(stale, await receipt({ age: "26 hours" }), false, "25 hours 59 minutes");
    assert.equal(await publicContact(db, org, shared), null); assert.equal(await publicContact(db, org, stale), null);
  });
});
