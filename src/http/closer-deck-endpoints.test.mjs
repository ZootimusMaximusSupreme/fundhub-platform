// COMPLIANCE REVIEW REQUIRED — closer-deck pay link, letters, disposition.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formatCents } from "../config/offers.mjs";
import readCloserDeck, { CLOSER_DECK_ROLES } from "../../api/read/closer-deck.mjs";
import closerDeckWrite from "../../api/closer-deck.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function staff(role, orgId = ORG) {
  return { id: "staff-1", org_id: orgId, role, name: role, email: role + "@x.test", status: "active" };
}

function dbWithClient(client = { id: CID, first_name: "A", last_name: "B", outcome_tier: null, custom_fields: {}, business_name: null }) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/SELECT 1 FROM clients/i.test(s)) return { rows: [{ "?column?": 1 }] };
      if (/FROM clients c/i.test(s)) return { rows: [client] };
      if (/FROM crs_results/i.test(s)) return { rows: [] };
      return { rows: [] };
    }
  };
}

async function get(opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "closer";
  await readCloserDeck(
    { method: "GET", query: opts.query ?? { client_id: CID } },
    res,
    {
      db: opts.db ?? dbWithClient(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId))
    }
  );
  return res;
}

async function post(body, opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "closer";
  await closerDeckWrite(
    { method: "POST", body },
    res,
    {
      db: opts.db ?? dbWithClient(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId)),
      env: opts.env
    }
  );
  return res;
}

describe("GET /api/read/closer-deck", () => {
  test("unsigned is 401", async () => {
    const res = await get({
      requireAuth: async (_req, r) => {
        r.status(401).json({ ok: false, error: "unauthorized" });
        return null;
      }
    });
    assert.equal(res.statusCode, 401);
  });

  test("a setter is refused", async () => {
    const res = await get({ role: "setter" });
    assert.equal(res.statusCode, 403);
  });

  for (const role of CLOSER_DECK_ROLES) {
    test(`a ${role} can read the deck payload`, async () => {
      const res = await get({ role });
      assert.equal(res.statusCode, 200, role + " " + JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.engine.available, false);
      assert.equal(res.body.engine.reason, "engine data unavailable");
      assert.ok(Array.isArray(res.body.offers));
      assert.ok(res.body.offers.some((o) => o.key === "FUNDING_DFY"));
    });
  }

  test("contact= is accepted as the client id", async () => {
    const res = await get({ query: { contact: CID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, CID);
  });

  test("missing client is 404, not a demo person", async () => {
    const res = await get({
      db: { async query() { return { rows: [] }; } }
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /api/closer-deck", () => {
  test("the Blueprint endpoint forwards the exact custom amount and refuses invalid overrides", async () => {
    let captured;
    let agreedCents = 500000;
    const db = {
      async query(sql, params) {
        if (/FROM contracts/.test(sql)) {
          const fee = formatCents(agreedCents);
          const rendered_body = "Capital Blueprint tuition " + fee;
          return { rows: [{ id: "agreement-blueprint", status: "sent", merge_values: { package_fee: fee },
            rendered_body, body_sha: "sha256:" + createHash("sha256").update(rendered_body).digest("hex") }] };
        }
        if (/SELECT 1 FROM clients/.test(sql)) return { rows: [{ exists: 1 }] };
        if (/FROM products/.test(sql)) return { rows: [{ id: "blueprint-product", code: "consulting-package" }] };
        if (/INSERT INTO payment_links/.test(sql)) {
          captured = params;
          throw new Error("test_checkout_captured");
        }
        return { rows: [] };
      }
    };
    const env = { COMMAS_CHECKOUT_BASE_URL: "https://pay.example/checkout" };
    const base = { action: "send_pay_link", client_id: CID, offer_key: "UWIQ_DELIVERABLES", sale_motion: "upsell" };
    for (const cents of [500000, 750000, 1000000]) {
      captured = null;
      agreedCents = cents;
      const res = await post({ ...base, amount_cents: cents }, { db, env });
      assert.equal(res.body.message, "test_checkout_captured");
      assert.equal(captured[4], cents);
    }
    for (const amount_cents of [499999, 1000001, 750001, "750000", null]) {
      captured = null;
      const res = await post({ ...base, amount_cents }, { db, env });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "invalid_offer_amount");
      assert.equal(captured, null);
    }
    const fixed = await post({ ...base, offer_key: "REPAIR_DFY", amount_cents: 100000 }, { db, env });
    assert.equal(fixed.body.error, "invalid_offer_amount");
  });

  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env.COMMAS_CHECKOUT_BASE_URL;
    delete process.env.COMMAS_CHECKOUT_BASE_URL;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.COMMAS_CHECKOUT_BASE_URL;
    else process.env.COMMAS_CHECKOUT_BASE_URL = savedEnv;
  });

  test("letters on the qualified funding offer are 409", async () => {
    const res = await post({
      action: "generate_letters",
      client_id: CID,
      offer_key: "FUNDING_DFY",
      tier: "FULL_FUNDING"
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "letters_blocked_funding_route");
  });

  test("pay link without Commas config is 503, not an invented URL", async () => {
    const res = await post({
      action: "send_pay_link",
      client_id: CID,
      offer_key: "REPAIR_DFY"
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "commas_not_configured");
  });

  test("first-sale offers skip sale_motion_required; deliverables still require it", async () => {
    process.env.COMMAS_CHECKOUT_BASE_URL = "https://pay.example/checkout";
    for (const key of ["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]) {
      const res = await post({
        action: "send_pay_link",
        client_id: CID,
        offer_key: key
      });
      assert.notEqual(res.body.error, "sale_motion_required", key);
    }
    const blocked = await post({
      action: "send_pay_link",
      client_id: CID,
      offer_key: "UWIQ_DELIVERABLES"
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.body.error, "sale_motion_required");
  });

  test("soft pull without Commas config is 503", async () => {
    const res = await post({
      action: "send_soft_pull",
      client_id: CID
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "commas_not_configured");
  });

  test("soft pull with a fresh file is 200 skip when post-purchase is on", async () => {
    const prev = process.env.SLO_POST_PURCHASE_ENABLED;
    process.env.SLO_POST_PURCHASE_ENABLED = "true";
    try {
      const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const res = await post({
        action: "send_soft_pull",
        client_id: CID
      }, {
        db: {
          async query(sql) {
            const s = String(sql);
            if (/SELECT 1 FROM clients/i.test(s)) return { rows: [{ "?column?": 1 }] };
            if (/FROM crs_results/i.test(s)) {
              return { rows: [{ id: "crs-fresh", created_at: createdAt, result: {} }] };
            }
            return { rows: [] };
          }
        }
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, "send_soft_pull");
      assert.equal(res.body.skipped, true);
      assert.equal(res.body.reason, "fresh_pull_on_file");
      assert.equal(res.body.error, undefined);
    } finally {
      if (prev === undefined) delete process.env.SLO_POST_PURCHASE_ENABLED;
      else process.env.SLO_POST_PURCHASE_ENABLED = prev;
    }
  });

  test("soft pull with a fresh file still sends when post-purchase is off", async () => {
    const prev = process.env.SLO_POST_PURCHASE_ENABLED;
    delete process.env.SLO_POST_PURCHASE_ENABLED;
    try {
      const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const res = await post({
        action: "send_soft_pull",
        client_id: CID
      }, {
        db: {
          async query(sql) {
            const s = String(sql);
            if (/SELECT 1 FROM clients/i.test(s)) return { rows: [{ "?column?": 1 }] };
            if (/FROM crs_results/i.test(s)) {
              return { rows: [{ id: "crs-fresh", created_at: createdAt, result: {} }] };
            }
            return { rows: [] };
          }
        }
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, "commas_not_configured");
      assert.equal(res.body.skipped, undefined);
    } finally {
      if (prev === undefined) delete process.env.SLO_POST_PURCHASE_ENABLED;
      else process.env.SLO_POST_PURCHASE_ENABLED = prev;
    }
  });

  test("retired ebook action is refused", async () => {
    const res = await post({
      action: "send_ebook",
      client_id: CID
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
    assert.doesNotMatch(res.body.message, /send_ebook/);
  });

  test("a setter cannot fire cockpit actions", async () => {
    const res = await post({
      action: "log_disposition",
      client_id: CID,
      offer_key: "REPAIR_DFY"
    }, { role: "setter" });
    assert.equal(res.statusCode, 403);
  });

  test("a non-db throw still writes JSON, not a blank handler_no_response", async () => {
    const res = await post({
      action: "log_disposition",
      client_id: CID,
      offer_key: "REPAIR_DFY"
    }, {
      db: {
        async query(sql) {
          if (/SELECT 1 FROM clients/i.test(sql)) return { rows: [{}] };
          throw new TypeError("Do not know how to serialize a BigInt");
        }
      }
    });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "send_failed");
    assert.match(String(res.body.message), /BigInt/);
  });
});
