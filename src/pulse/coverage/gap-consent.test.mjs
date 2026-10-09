// Consent gap — fakes only. No live database. No consent is recorded.
// The SQL itself was run read-only against the live database with the real
// tables replaced by made-up rows (see ops/workflows/heartbeat-gaps-2026-10-08/consent.md).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { SOFT_PULL_KIND as ROLLUP_KIND } from "../../fulfillment/read-signals.mjs";
import { PULSE_REGISTRY } from "../registry.mjs";
import {
  CHECK_IDS,
  CONSENT_API_PATH,
  CONSENT_PAGE_PATH,
  DISPUTE_GRACE_DAYS,
  DISPUTE_SQL,
  PAID_GRACE_HOURS,
  READ_ONLY_SQL,
  REQUIRED_SQL,
  SLO_LOOKBACK_DAYS,
  SLO_STORE_SQL,
  SOFT_PULL_KIND,
  STORE_GRACE_HOURS,
  STORE_SQL,
  TEST_CLIENT_EMAIL_RE,
  assertSelect,
  consentDoorsListed,
  doorUp,
  gapChecks
} from "./gap-consent.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const SHAPE = ["detail", "id", "status", "suggestedFix"];

function db(counts = { required: 0, store: 0, slo: 0, dispute: 0 }, calls = []) {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      const text = String(sql);
      if (text.includes("FROM repair_programs rp")) return { rows: [{ n: counts.dispute ?? 0 }] };
      if (text.includes("FROM payment_links pl")) return { rows: [{ n: counts.slo ?? 0 }] };
      if (text.includes("FROM contracts ct")) return { rows: [{ n: counts.store }] };
      if (text.includes("FROM clients c")) return { rows: [{ n: counts.required }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function page(status = 200, text = `<script>fetch("${CONSENT_API_PATH}?client_id=")</script>`, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    return { status, text: async () => text };
  };
}

function assertShape(rows) {
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), SHAPE);
    assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Do not record consent for a real person/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

test("consent doors are on the morning pulse list", () => {
  assert.equal(consentDoorsListed(PULSE_REGISTRY), true);
  assert.equal(SOFT_PULL_KIND, ROLLUP_KIND);
  assert.match(REQUIRED_SQL, /revoked_at IS NULL/);
  assert.ok(REQUIRED_SQL.includes(CONSENT_VALID_SQL.trim()));
  assert.match(STORE_SQL, /revoked_at >= ct\.signed_at/);
  assert.match(STORE_SQL, /signed_document_id IS NULL/);
  // A withdrawal after signing is not a failed store. Pin the whole exemption: flip
  // any one line of it and the check calls a real withdrawal a break.
  assert.match(
    STORE_SQL,
    /cc\.kind = 'soft_pull_consent'\s+AND cc\.revoked_at IS NOT NULL\s+AND ct\.signed_at IS NOT NULL\s+AND cc\.revoked_at >= ct\.signed_at/
  );
  assert.doesNotMatch(REQUIRED_SQL, /\b(insert|update|delete|ssn)\b/i);
  assert.doesNotMatch(STORE_SQL, /\b(insert|update|delete|signer_name|ssn)\b/i);
  assert.doesNotMatch(SLO_STORE_SQL, /\b(insert|update|delete|signer_name|ssn)\b/i);
  // An address may be matched against the test pattern. It is never returned:
  // every statement answers with one count and nothing else.
  for (const sql of READ_ONLY_SQL) {
    assert.match(sql.trim(), /^SELECT count\(\*\)::int AS n\b/);
    assert.equal((sql.match(/\bemail\b/gi) || []).length, 1, "the address appears once, inside the test-client match");
    assert.match(sql, /COALESCE\(c\.email, ''\) ~\* \$\d/);
  }
});

test("doorUp: page needs 2xx, API may refuse a bare GET", () => {
  assert.equal(doorUp("page", 200), true);
  assert.equal(doorUp("page", 401), false);
  assert.equal(doorUp("page", 500), false);
  assert.equal(doorUp("api", 401), true);
  assert.equal(doorUp("api", 400), true);
  assert.equal(doorUp("api", 403), true);
  assert.equal(doorUp("api", 405), true);
  assert.equal(doorUp("api", 404), false);
  assert.equal(doorUp("api", 500), false);
});

test("no database and no fetch → five skips, and the site is not called", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    throw new Error("should not fetch");
  };
  try {
    const rows = await gapChecks({});
    assert.equal(called, false);
    assertShape(rows);
    assert.ok(rows.every((row) => row.status === "skip"));
  } finally {
    globalThis.fetch = orig;
  }
});

test("a live page and zero rows → five PASS", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0, slo: 0 }, calls),
    fetchImpl: page()
  });
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(String(call.sql).trim(), /^select\b/i);
    assert.equal(call.params[0], ORG);
    assert.equal(call.params[1], false);
    assert.equal(call.params[call.params.length - 1], TEST_CLIENT_EMAIL_RE);
  }
  assert.equal(calls.find((c) => String(c.sql).includes("FROM clients c\n")).params[2], SOFT_PULL_KIND);
});

test("a dead page fails the page row and the database rows still run", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0, slo: 0 }),
    fetchImpl: page(500)
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "consent:page");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /500/);
  assert.equal(rows.find((r) => r.id === "consent:required").status, "PASS");
  assert.equal(rows.find((r) => r.id === "consent:store").status, "PASS");
  assert.equal(rows.find((r) => r.id === "consent:slo-store").status, "PASS");
  assert.equal(rows.find((r) => r.id === "consent:dispute-required").status, "PASS");
});

test("a page that loads but does not call the capture API is a dead page", async () => {
  const rows = await gapChecks({ fetchImpl: page(200, "<html>Please sign in</html>") });
  const row = rows.find((r) => r.id === "consent:page");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /does not call \/api\/consent\/capture/);
});

test("a 404 page and an unreachable page both fail", async () => {
  const four = await gapChecks({ fetchImpl: page(404, "missing") });
  assert.equal(four.find((r) => r.id === "consent:page").status, "FAIL");
  assert.match(four.find((r) => r.id === "consent:page").detail, /404/);
  const down = await gapChecks({
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  const row = down.find((r) => r.id === "consent:page");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /socket hang up/);
});

test("the fetch alias still works when only ctx.fetch is given", async () => {
  const rows = await gapChecks({ fetch: page() });
  assert.equal(rows.find((r) => r.id === "consent:page").status, "PASS");
});

test("fetch is one GET of the page, carries no client, and has a timeout", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: ORG,
    db: db(),
    baseUrl: "https://fundhub.ai/",
    fetchImpl: page(200, `x ${CONSENT_API_PATH} y`, calls)
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://fundhub.ai${CONSENT_PAGE_PATH}`);
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(calls[0].opts.body, undefined);
  assert.ok(calls[0].opts.signal, "the page fetch must carry a timeout");
  assert.equal(String(calls[0].url).includes("client"), false);
  assert.equal(rows[0].status, "PASS");
});

test("the API door is not pinged here, the registry already does", async () => {
  const calls = [];
  await gapChecks({ orgId: ORG, db: db(), fetchImpl: page(200, undefined, calls) });
  assert.ok(calls.every((c) => !String(c.url).includes("/api/")));
});

test("a client who must have consent and has none is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 2, store: 0, slo: 0 }),
    fetchImpl: page()
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "consent:required");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 clients/);
  assert.match(row.detail, new RegExp(`over ${PAID_GRACE_HOURS} hours ago`));
  assert.equal(rows.find((r) => r.id === "consent:store").status, "PASS");
});

test("a signed paper with no consent row is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 1, slo: 0 }),
    fetchImpl: page()
  });
  const row = rows.find((r) => r.id === "consent:store");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 signed soft-pull paper/);
});

test("an identity saved with no consent row is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0, slo: 2 }),
    fetchImpl: page()
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "consent:slo-store");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 roadmap orders saved an identity and no consent row/);
  assert.match(row.suggestedFix, /roadmap pull form/);
  const one = await gapChecks({ orgId: ORG, db: db({ required: 0, store: 0, slo: 1 }), fetchImpl: page() });
  assert.match(one.find((r) => r.id === "consent:slo-store").detail, /1 roadmap order saved an identity/);
});

test("one client missing consent uses the singular", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 1, store: 0, slo: 0 }),
    fetchImpl: page()
  });
  assert.match(rows.find((r) => r.id === "consent:required").detail, /1 client paid/);
});

test("a read error fails that reading and still returns all five", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    fetchImpl: page(),
    db: {
      query: async (sql) => {
        if (String(sql).includes("FROM contracts ct")) throw new Error("db down");
        return { rows: [{ n: 0 }] };
      }
    }
  });
  assert.equal(rows.length, 5);
  assert.equal(rows.find((r) => r.id === "consent:required").status, "PASS");
  const store = rows.find((r) => r.id === "consent:store");
  assert.equal(store.status, "FAIL");
  assert.match(store.detail, /db down/);
  assert.equal(rows.find((r) => r.id === "consent:slo-store").status, "PASS");
});

test("a count that does not come back is a FAIL, never a pass", async () => {
  for (const bad of [null, "", undefined, "abc"]) {
    const rows = await gapChecks({
      orgId: ORG,
      fetchImpl: page(),
      db: { query: async () => ({ rows: [{ n: bad }] }) }
    });
    for (const id of ["consent:required", "consent:store", "consent:slo-store", "consent:dispute-required"]) {
      const row = rows.find((r) => r.id === id);
      assert.equal(row.status, "FAIL", `${id} with n=${String(bad)}`);
      assert.match(row.detail, /did not return a count/);
    }
  }
  const empty = await gapChecks({ orgId: ORG, fetchImpl: page(), db: { query: async () => ({ rows: [] }) } });
  assert.ok(["consent:required", "consent:store", "consent:slo-store", "consent:dispute-required"].every((id) => empty.find((r) => r.id === id).status === "FAIL"));
});

test("every database read going wrong fails all four, none passes", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    fetchImpl: page(),
    db: { query: async () => { throw new Error("connection terminated"); } }
  });
  assertShape(rows);
  for (const id of ["consent:required", "consent:store", "consent:slo-store", "consent:dispute-required"]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "FAIL", id);
    assert.match(row.detail, /connection terminated/);
  }
});

test("reads go through the staff scope when one is passed, not the plain db", async () => {
  const viaScope = [];
  const viaDb = [];
  const rows = await gapChecks({
    orgId: ORG,
    fetchImpl: page(),
    db: db({ required: 0, store: 0, slo: 0 }, viaDb),
    scope: (fn) => fn(db({ required: 0, store: 0, slo: 0 }, viaScope))
  });
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(viaScope.length, 4);
  assert.equal(viaDb.length, 0);
});

test("demoOn is passed through and a bad org does not query", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: "not-a-uuid",
    demoOn: true,
    db: db({ required: 0, store: 0, slo: 0 }, calls),
    fetchImpl: page()
  });
  assert.equal(calls.length, 0);
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "skip");
  assert.equal(rows[3].status, "skip");
  assert.equal(rows[4].status, "skip");

  const again = [];
  await gapChecks({
    orgId: ORG,
    demoOn: true,
    db: db({ required: 0, store: 0, slo: 0 }, again),
    fetchImpl: page()
  });
  assert.ok(again.every((call) => call.params[1] === true));
});

test("the sql waits for fresh payments and leaves test clients out", () => {
  assert.equal(PAID_GRACE_HOURS, 24);
  assert.equal(STORE_GRACE_HOURS, 1);
  assert.equal(SLO_LOOKBACK_DAYS, 7);
  // required: a diagnostic.paid event in the last 24 hours means "still filling the form in".
  assert.match(REQUIRED_SQL, /ev\.name = 'diagnostic\.paid'/);
  assert.match(REQUIRED_SQL, new RegExp(`ev\\.created_at > now\\(\\) - interval '${PAID_GRACE_HOURS} hours'`));
  // store: a paper signed a moment ago may still be mid-handler.
  assert.match(STORE_SQL, new RegExp(`ct\\.signed_at < now\\(\\) - interval '${STORE_GRACE_HOURS} hour'`));
  // slo-store: window is one hour to seven days, roadmap orders only, any consent row counts.
  assert.match(SLO_STORE_SQL, new RegExp(`identity_stored_at < now\\(\\) - interval '${STORE_GRACE_HOURS} hour'`));
  assert.match(SLO_STORE_SQL, new RegExp(`identity_stored_at > now\\(\\) - interval '${SLO_LOOKBACK_DAYS} days'`));
  assert.match(SLO_STORE_SQL, /left\(pl\.link_ref, 4\) = 'slo_'/);
  assert.match(SLO_STORE_SQL, /cc\.kind = 'soft_pull_consent'/);
  assert.doesNotMatch(SLO_STORE_SQL, /revoked_at/, "a withdrawn consent still proves a row was stored");
  for (const sql of READ_ONLY_SQL) {
    assert.match(sql, /custom_fields ->> 'synthetic'/);
    assert.match(sql, /is_demo/);
    assert.match(sql, /\$2::boolean OR NOT/);
  }
});

test("the test-client pattern catches sim tags and test domains, not real people", () => {
  const re = new RegExp(TEST_CLIENT_EMAIL_RE, "i");
  for (const mail of [
    "stanbridgejchris+walk-01@gmail.com",
    "stanbridgejchris+sim-12@gmail.com",
    "someone@example.org",
    "adv-blk5a-1.1@example.test",
    "x@thing.invalid",
    "roster@demo.fundhub.local"
  ]) {
    assert.ok(re.test(mail), mail);
  }
  for (const mail of [
    "bramselleslach@gmail.com",
    "jane.walker@gmail.com",
    "bob+simple@gmail.com",
    "dave@test-company.com"
  ]) {
    assert.ok(!re.test(mail), mail);
  }
});

test("the read guard accepts SELECT and WITH and refuses every write word", () => {
  for (const sql of READ_ONLY_SQL) assert.doesNotThrow(() => assertSelect(sql));
  assert.doesNotThrow(() => assertSelect("WITH a AS (SELECT 1) SELECT * FROM a"));
  for (const sql of [
    "INSERT INTO client_consents DEFAULT VALUES",
    "UPDATE client_consents SET revoked_at = now()",
    "DELETE FROM client_consents",
    "SELECT 1; DROP TABLE client_consents",
    "WITH x AS (DELETE FROM client_consents RETURNING 1) SELECT * FROM x",
    "TRUNCATE client_consents",
    "BEGIN"
  ]) {
    assert.throws(() => assertSelect(sql), /refused a write/, sql);
  }
});

test("the module does not record consent or start another monitor", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-consent.mjs"), "utf8");
  assert.doesNotMatch(src, /captureConsent/);
  assert.doesNotMatch(src, /\bINSERT\b/);
  assert.doesNotMatch(src, /\bUPDATE\b/);
  assert.doesNotMatch(src, /\bDELETE\b/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.doesNotMatch(src, /setInterval|setTimeout|inngest|checkRegistry/);
  assert.doesNotMatch(src, /<html/);
  // The pulse runs inside the deployed function, where public/ and api/ are not on disk.
  assert.doesNotMatch(src, /node:fs|existsSync|readFileSync/);
});

/* Repair clients who cannot have letters prepared. */

test("an active repair client with no authorization and no agreement is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0, slo: 0, dispute: 2 }),
    fetchImpl: page()
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "consent:dispute-required");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 active repair clients have been enrolled over 7 days/);
  assert.match(row.detail, /neither a live dispute authorization nor a signed repair agreement/);
  assert.match(row.suggestedFix, /no letters can be prepared/);
  assert.equal(rows.find((r) => r.id === "consent:required").status, "PASS");
  const one = await gapChecks({ orgId: ORG, db: db({ dispute: 1 }), fetchImpl: page() });
  assert.match(one.find((r) => r.id === "consent:dispute-required").detail, /1 active repair client has been enrolled/);
});

test("no repair client in the wrong state is a PASS and says what it looked at", async () => {
  const rows = await gapChecks({ orgId: ORG, db: db({ dispute: 0 }), fetchImpl: page() });
  const row = rows.find((r) => r.id === "consent:dispute-required");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /active repair client older than 7 days/);
});

test("the repair reading asks the database with the org, the demo flag and the test pattern", async () => {
  const calls = [];
  await gapChecks({ orgId: ORG, db: db({ dispute: 0 }, calls), fetchImpl: page() });
  const call = calls.find((c) => String(c.sql).includes("FROM repair_programs rp"));
  assert.deepEqual(call.params, [ORG, false, TEST_CLIENT_EMAIL_RE]);
});

test("the repair sql waits a week, counts only active programs, and accepts either paper", () => {
  assert.equal(DISPUTE_GRACE_DAYS, 7);
  assert.match(DISPUTE_SQL, /rp\.status = 'active'/);
  assert.match(DISPUTE_SQL, new RegExp(`rp\\.created_at < now\\(\\) - interval '${DISPUTE_GRACE_DAYS} days'`));
  // Live authorization, using the one validity rule.
  assert.match(DISPUTE_SQL, /cc\.kind = 'dispute_authorization'/);
  assert.ok(DISPUTE_SQL.includes(CONSENT_VALID_SQL.trim()));
  // A withdrawal is a real no.
  assert.match(DISPUTE_SQL, /cc\.kind = 'dispute_authorization'\s+AND cc\.revoked_at IS NOT NULL/);
  // A signed repair agreement is the other way in.
  assert.match(DISPUTE_SQL, /k\.status = 'signed'/);
  assert.match(DISPUTE_SQL, /t\.subtype = 'credit_repair' OR k\.template_key ILIKE '%REPAIR%'/);
  assert.equal((DISPUTE_SQL.match(/NOT EXISTS/g) || []).length, 3);
  assert.doesNotMatch(DISPUTE_SQL, /\b(insert|update|delete|drop|alter|truncate|ssn)\b/i);
});

test("the repair sql accepts the same agreement the letter gate accepts", () => {
  // src/repair/dispute-auth.mjs decides whether letters may be prepared. If it
  // changes what counts as a signed repair agreement, this fails until we follow.
  const gate = fs.readFileSync(path.join(HERE, "../../repair/dispute-auth.mjs"), "utf8").replace(/\s+/g, " ");
  assert.ok(gate.includes("c.status = 'signed'"));
  assert.ok(gate.includes("t.subtype = 'credit_repair'"));
  assert.ok(gate.includes("c.template_key ILIKE '%REPAIR%'"));
  assert.ok(gate.includes('kind: "dispute_authorization"'));
  const analyze = fs.readFileSync(path.join(HERE, "../../repair/analyze.mjs"), "utf8").replace(/\s+/g, " ");
  assert.ok(analyze.includes("const authorized = hasAgreement || (await hasDisputeAuthorization(db, { orgId, clientId }))"));
});
