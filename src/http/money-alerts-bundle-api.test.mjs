// /api/money/alerts — the alerts bundle's two additions (unit AL): GET
// ?part=bundle answers only the bundle, and POST set_bundle_alert switches one of
// the three bundle texts. Same gate as every other alerts call. Stubbed principal,
// db and logic; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/alerts.mjs";
import { setBundleAlert } from "../finance/file-alerts/bundle.mjs";

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "org-1";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}
const clientP = { kind: "client", accountId: "acc-1", orgId: ORG, clientId: MINE };
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => (kinds.includes(p.kind) ? p : (res.status(403).json({ ok: false }), null));
const db = { query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: params[0] === MINE && params[1] === ORG ? [{ x: 1 }] : [] } : { rows: [] }) };

async function call(req, principal, extra = {}) {
  const res = makeRes();
  const seen = { bundle: [], read: 0, saved: [] };
  await handler(req, res, {
    db, requirePrincipal: gateAs(principal), now: () => new Date("2026-11-06T16:00:00Z"), env: {},
    fileAlertsPayload: async () => { seen.read += 1; return { ok: true, cards: [], alerts: [] }; },
    alertsBundlePayload: async (_d, a) => { seen.bundle.push(a); return { card_rule: { cards: [] } }; },
    setBundleAlert: (d, a) => setBundleAlert(d, a, { bundleStore: { setBundleAlertEnabled: async (_c, s) => { seen.saved.push(s); } } }),
    ...extra
  });
  return { res, seen };
}

describe("GET ?part=bundle", () => {
  test("without it the read is exactly as before: no bundle, no bundle read", async () => {
    const { res, seen } = await call({ method: "GET", query: {} }, clientP);
    assert.equal(res.statusCode, 200);
    assert.equal("bundle" in res.body, false);
    assert.equal(seen.bundle.length, 0);
    assert.equal(seen.read, 1);
  });

  test("with it a client gets only their own bundle, and the alerts read is not built again", async () => {
    const { res, seen } = await call({ method: "GET", query: { part: "bundle", client_id: OTHER } }, clientP);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, bundle: { card_rule: { cards: [] } } });
    assert.equal(seen.bundle[0].clientId, MINE);
    assert.equal(seen.bundle[0].orgId, ORG);
    assert.equal(seen.read, 0);
  });

  test("staff need the client's id and the client must be in their company", async () => {
    const ok = await call({ method: "GET", query: { part: "bundle", client_id: MINE } }, staffP("owner"));
    assert.equal(ok.res.statusCode, 200);
    const other = await call({ method: "GET", query: { part: "bundle", client_id: OTHER } }, staffP("owner"));
    assert.equal(other.res.statusCode, 404);
    assert.equal(other.seen.bundle.length, 0);
    const none = await call({ method: "GET", query: { part: "bundle" } }, staffP("owner"));
    assert.equal(none.res.statusCode, 400);
  });

  test("a client the builder cannot find is a 404, not an empty bundle", async () => {
    const { res } = await call({ method: "GET", query: { part: "bundle" } }, clientP, { alertsBundlePayload: async () => null });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST set_bundle_alert", () => {
  test("switches one bundle text, stamped with who did it", async () => {
    const { res, seen } = await call({ method: "POST", body: { action: "set_bundle_alert", kind: "weekly_money", enabled: false } }, clientP);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "set_bundle_alert", saved: { kind: "weekly_money", enabled: false } });
    assert.equal(seen.saved[0].clientId, MINE);
    assert.equal(seen.saved[0].by, "client");
  });

  test("staff switches are stamped staff and pinned to the client in their company", async () => {
    const { res, seen } = await call({ method: "POST", body: { action: "set_bundle_alert", kind: "card_over_10", enabled: true, client_id: MINE } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(seen.saved[0].by, "staff");
    const other = await call({ method: "POST", body: { action: "set_bundle_alert", kind: "card_over_10", enabled: true, client_id: OTHER } }, staffP("owner"));
    assert.equal(other.res.statusCode, 404);
    assert.equal(other.seen.saved.length, 0);
  });

  test("an older kind or a non-boolean is a plain 400 naming the field", async () => {
    const bad = await call({ method: "POST", body: { action: "set_bundle_alert", kind: "promo_end", enabled: false } }, clientP);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.field, "kind");
    const notBool = await call({ method: "POST", body: { action: "set_bundle_alert", kind: "card_over_10", enabled: "no" } }, clientP);
    assert.equal(notBool.res.statusCode, 400);
    assert.equal(notBool.res.body.field, "enabled");
    assert.equal(bad.seen.saved.length + notBool.seen.saved.length, 0);
  });
});
