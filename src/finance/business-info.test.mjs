// src/finance/business-info.mjs — stubbed db, no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert";

import {
  readBusinessInfo, saveBusinessInfo, listBusinessInfo, infoView, FINANCE_OS_BUSINESS_SOURCE
} from "./business-info.mjs";

const ORG = "org-1";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const NOW = new Date("2026-10-06T12:00:00Z");

function fakeDb(routes) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, rows] of routes) {
        if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
      }
      return { rows: [] };
    }
  };
}

describe("readBusinessInfo", () => {
  test("reads every field; blanks are null, never guessed", () => {
    const i = readBusinessInfo({
      legal_name: " Fundhub LLC ", dba: "", ein_last4: "0000", entity_type: "LLC",
      formation_state: "az", started: "2021-03", industry: "Business funding",
      address_line1: "1 Main St", city: "Phoenix", state: "AZ", postal_code: "85004",
      phone: "(602) 555-0100", website: "fundhub.ai"
    }, { now: NOW });
    assert.equal(i.legal_name, "Fundhub LLC");
    assert.equal(i.dba, null);
    assert.equal(i.ein_last4, "0000");
    assert.equal(i.entity_type, "llc");
    assert.equal(i.formation_state, "AZ");
    assert.equal(i.started, "2021-03");
    assert.equal(i.age_months, 67);
    assert.equal(i.phone, "6025550100");
    assert.equal(i.website, "https://fundhub.ai");
    assert.deepEqual(readBusinessInfo({}, { now: NOW }).ein_last4, null);
  });

  test("a full EIN is refused, not trimmed — and so is any ein / ssn key", () => {
    assert.throws(() => readBusinessInfo({ ein_last4: "12-3456789" }), /last 4 digits only/);
    assert.throws(() => readBusinessInfo({ ein_last4: "123456789" }), /never store a full EIN/);
    assert.throws(() => readBusinessInfo({ ein: "12-3456789" }), /never store a full EIN/);
    assert.throws(() => readBusinessInfo({ ssn: "123-45-6789" }), /Social Security/);
    assert.throws(() => readBusinessInfo({ ein_last4: "12" }), /exactly 4 digits/);
  });

  test("bad values name the field", () => {
    assert.throws(() => readBusinessInfo({ entity_type: "corp" }), /entity_type/);
    assert.throws(() => readBusinessInfo({ formation_state: "Arizona" }), /formation_state/);
    assert.throws(() => readBusinessInfo({ started: "2099-01" }, { now: NOW }), /future/);
    assert.throws(() => readBusinessInfo({ started: "March" }), /started/);
    assert.throws(() => readBusinessInfo({ phone: "555" }), /phone/);
    assert.throws(() => readBusinessInfo({ postal_code: "8500" }), /postal_code/);
    assert.throws(() => readBusinessInfo({ website: "not a site" }), /website/);
  });
});

describe("saveBusinessInfo", () => {
  const ent = (over = {}) => ({ id: BIZ, client_id: CLIENT, kind: "business", name: "Fundhub LLC", archived_at: null, ...over });

  test("first save inserts one businesses row tied to the container, source finance_os, last 4 only", async () => {
    const db = fakeDb([
      [/FROM entities/, [ent()]],
      [/INSERT INTO businesses/, [{ id: "b-1" }]]
    ]);
    const info = readBusinessInfo({ ein_last4: "0000", state: "AZ", started: "2021-03" }, { now: NOW });
    const r = await saveBusinessInfo(db, { orgId: ORG, clientId: CLIENT, containerId: BIZ, info });
    assert.deepEqual(r, { ok: true, business_id: "b-1", created: true });
    const lock = db.calls.find((c) => /FROM entities/.test(c.sql));
    assert.match(lock.sql, /FOR UPDATE/);
    assert.deepEqual(lock.params, [BIZ, ORG, CLIENT]);
    const ins = db.calls.find((c) => /INSERT INTO businesses/.test(c.sql));
    assert.equal(ins.params[2], "Fundhub LLC", "no legal name given → the container's name");
    assert.equal(ins.params[3], 67);
    const data = JSON.parse(ins.params[4]);
    assert.equal(data.source, FINANCE_OS_BUSINESS_SOURCE);
    assert.equal(data.entity_id, BIZ);
    assert.equal(data.ein_last4, "0000");
    assert.equal(data.state, "AZ");
    assert.equal(data.incorporated_date, "2021-03");
    assert.equal("ein" in data, false, "no full-EIN key is ever written");
    assert.equal(db.calls.some((c) => /DELETE/.test(c.sql)), false);
  });

  test("second save updates the same row, never a second one", async () => {
    const db = fakeDb([
      [/FROM entities/, [ent()]],
      [/SELECT id FROM businesses/, [{ id: "b-1" }]],
      [/UPDATE businesses/, []]
    ]);
    const r = await saveBusinessInfo(db, { orgId: ORG, clientId: CLIENT, containerId: BIZ, info: readBusinessInfo({ legal_name: "Fundhub, LLC" }) });
    assert.deepEqual(r, { ok: true, business_id: "b-1", created: false });
    assert.equal(db.calls.some((c) => /INSERT/.test(c.sql)), false);
    const up = db.calls.find((c) => /UPDATE businesses/.test(c.sql));
    assert.deepEqual(up.params.slice(0, 4), ["b-1", ORG, CLIENT, "Fundhub, LLC"]);
  });

  test("another client's container, a personal container, or an archived one is refused", async () => {
    let r = await saveBusinessInfo(fakeDb([]), { orgId: ORG, clientId: CLIENT, containerId: BIZ, info: {} });
    assert.equal(r.reason, "container_not_found");
    r = await saveBusinessInfo(fakeDb([[/FROM entities/, [ent({ kind: "personal" })]]]), { orgId: ORG, clientId: CLIENT, containerId: BIZ, info: {} });
    assert.equal(r.reason, "not_a_business_container");
    r = await saveBusinessInfo(fakeDb([[/FROM entities/, [ent({ archived_at: "2026-01-01" })]]]), { orgId: ORG, clientId: CLIENT, containerId: BIZ, info: {} });
    assert.equal(r.reason, "container_archived");
  });
});

describe("listBusinessInfo / infoView", () => {
  test("maps container → info, only finance_os rows, scoped by org and client", async () => {
    const db = fakeDb([[/FROM businesses/, [
      { id: "b-1", name: "Fundhub LLC", age_months: 66, entity_data: { source: "finance_os", entity_id: BIZ, ein_last4: "0000", incorporated_date: "2021-03" } }
    ]]]);
    const m = await listBusinessInfo(db, { orgId: ORG, clientId: CLIENT });
    assert.deepEqual(db.calls[0].params, [ORG, CLIENT, "finance_os"]);
    const v = m.get(BIZ);
    assert.equal(v.legal_name, "Fundhub LLC");
    assert.equal(v.ein_last4, "0000");
    assert.equal(v.started, "2021-03");
    assert.equal(v.age_months, 66);
  });

  test("infoView never surfaces a full EIN even if an old row had one", () => {
    const v = infoView({ id: "x", name: "A", entity_data: { ein: "12-3456789", ein_last4: "6789" } });
    assert.equal(JSON.stringify(v).includes("3456789"), false);
  });
});
