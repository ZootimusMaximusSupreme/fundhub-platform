import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "./send.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";

function response() {
  return {
    code: 200,
    body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function harness({ owned = true, agreement = false, consent = false } = {}) {
  const state = { sent: 0, agreementReads: 0, consentReads: 0, queries: [] };
  const deps = {
    db: {
      async query(sql, params) {
        state.queries.push({ sql, params });
        assert.match(sql, /FROM clients WHERE id = \$1 AND org_id = \$2/);
        assert.deepEqual(params, [CLIENT, ORG]);
        return { rows: owned ? [{ one: 1 }] : [] };
      }
    },
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "inquiry_specialist" }),
    hasRepairAgreement: async (_db, args) => {
      state.agreementReads++;
      assert.deepEqual(args, { orgId: ORG, clientId: CLIENT });
      return agreement;
    },
    hasDisputeAuthorization: async (_db, args) => {
      state.consentReads++;
      assert.deepEqual(args, { orgId: ORG, clientId: CLIENT });
      return consent;
    },
    sendRepairLetters: async (_db, args) => {
      state.sent++;
      assert.deepEqual([args.orgId, args.clientId, args.staffId], [ORG, CLIENT, STAFF]);
      return { ok: true, results: [{ bureau: "EX", ok: true }] };
    }
  };
  const request = {
    method: "POST",
    body: {
      mail: true,
      client_id: CLIENT,
      mail_from: { address_line1: "Synthetic return address" },
      // Legacy ad-hoc no-ID letters must not bypass the authorization gate.
      letters: [{ bureau: "EX", html: "<p>synthetic only</p>" }]
    }
  };
  return { state, deps, request };
}

test("owned client without signed agreement or current dispute consent cannot send even an ad-hoc letter", async () => {
  const h = harness();
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 403);
  assert.equal(res.body.error, "repair_dispute_authorization_required");
  assert.equal(h.state.sent, 0);
  assert.equal(h.state.agreementReads, 1);
  assert.equal(h.state.consentReads, 1);
});

test("signed repair agreement authorizes the existing staff mailing pipeline", async () => {
  const h = harness({ agreement: true });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 200);
  assert.equal(h.state.sent, 1);
  assert.equal(h.state.agreementReads, 1);
  assert.equal(h.state.consentReads, 0);
});

test("live dispute authorization independently authorizes mailing", async () => {
  const h = harness({ consent: true });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 200);
  assert.equal(h.state.sent, 1);
  assert.equal(h.state.consentReads, 1);
});

test("foreign-org client refusal happens before authorization or mailing", async () => {
  const h = harness({ owned: false, agreement: true });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 404);
  assert.equal(h.state.sent, 0);
  assert.equal(h.state.agreementReads, 0);
});

test("invalid or revoked dispute consent refuses mailing", async () => {
  const h = harness({ agreement: false, consent: false });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 403);
  assert.equal(h.state.sent, 0);
});
