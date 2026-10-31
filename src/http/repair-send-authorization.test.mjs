import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/send.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const SAVED_LETTER = "44444444-4444-4444-8444-444444444444";

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
        if (sql.includes("FROM dispute_letters")) {
          assert.deepEqual(params.slice(0, 2), [ORG, CLIENT]);
          return { rows: [{ id: SAVED_LETTER, bureau: "EX", target: "bureau",
            status: "ready", body_text: "<p>synthetic only</p>",
            case_id: null, furnisher_address_id: null }] };
        }
        assert.match(sql, /FROM clients WHERE id = \$1 AND org_id = \$2/);
        assert.deepEqual(params, [CLIENT, ORG]);
        return { rows: owned ? [{ one: 1 }] : [] };
      }
    },
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "inquiry_specialist" }),
    hasActivePaidRepairProgram: async () => true,
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
      // Deliberately no saved ID: unauthorized mail must still fail with 403 first.
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

test("signed repair agreement authorizes a saved letter", async () => {
  const h = harness({ agreement: true });
  h.request.body.letters[0].letter_id = SAVED_LETTER;
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 200);
  assert.equal(h.state.sent, 1);
  assert.equal(h.state.agreementReads, 1);
  assert.equal(h.state.consentReads, 0);
});

test("live dispute authorization independently authorizes a saved letter", async () => {
  const h = harness({ consent: true });
  h.request.body.letters[0].letter_id = SAVED_LETTER;
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 200);
  assert.equal(h.state.sent, 1);
  assert.equal(h.state.consentReads, 1);
});

test("signed agreement does not permit untracked ad-hoc mailing", async () => {
  const h = harness({ agreement: true });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "saved_repair_letter_required");
  assert.equal(h.state.sent, 0);
});

test("mixed batch with a saved and unsaved letter refuses all before provider", async () => {
  const h = harness({ consent: true });
  h.request.body.letters.unshift({
    bureau: "TU",
    html: "<p>synthetic saved letter</p>",
    letter_id: SAVED_LETTER
  });
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "saved_repair_letter_required");
  assert.equal(h.state.sent, 0);
});

test("an invalid saved-letter reference cannot reach provider", async () => {
  const h = harness({ agreement: true });
  h.request.body.letters[0].letterId = "not-a-uuid";
  const res = response();
  await handler(h.request, res, h.deps);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "saved_repair_letter_required");
  assert.equal(h.state.sent, 0);
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
