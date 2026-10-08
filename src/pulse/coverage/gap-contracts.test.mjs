import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OFFERS } from "../../config/offers.mjs";
import { CHECKS as SLICE_CHECKS } from "./slice-10-contracts.mjs";
import {
  CHECK_IDS,
  SQL_RECON,
  SQL_SENT,
  SQL_SIGNED,
  SQL_TEMPLATES,
  classifyBareSignGet,
  gapChecks,
  liveContractTemplateKeys,
  signRouteIsWired
} from "./gap-contracts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-1111-1111-111111111111";

function fakeDb(matchers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      for (const [re, rows] of matchers) {
        if (re.test(text)) return { rows };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function reconRow(overrides = {}) {
  return {
    code: "AG-07",
    status: "live",
    runtime: "inngest",
    runtime_ref: "daily-pulse",
    ...overrides
  };
}

function healthyDb(extra = []) {
  const keys = liveContractTemplateKeys().map((template_key) => ({ template_key }));
  return fakeDb([
    [/gap:sent-unsignable/, []],
    [/gap:signed-store/, []],
    [/gap:templates/, keys],
    [/gap:recon/, [reconRow()]],
    ...extra
  ]);
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok(row.suggestedFix === null || typeof row.suggestedFix === "string");
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /watchdog/);
  }
  assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
}

test("gap checks use the four-field shape and do not repeat slice 10", async () => {
  assert.deepEqual(CHECK_IDS, [
    "contracts:sent-unsignable",
    "contracts:sign-route",
    "contracts:signed-not-stored",
    "contracts:template-missing",
    "contracts:tripwire"
  ]);
  const sliceIds = new Set(SLICE_CHECKS.map((row) => row.id));
  for (const id of CHECK_IDS) assert.equal(sliceIds.has(id), false);

  const rows = await gapChecks({});
  assert.equal(rows.length, CHECK_IDS.length);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) shape(row);
});

test("no database skips the reads and does not call the sign link", async () => {
  const rows = await gapChecks({});
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId["contracts:sent-unsignable"].status, "skip");
  assert.equal(byId["contracts:signed-not-stored"].status, "skip");
  assert.equal(byId["contracts:template-missing"].status, "skip");
  assert.equal(byId["contracts:tripwire"].status, "skip");
  assert.equal(byId["contracts:sign-route"].status, "PASS");
  assert.match(byId["contracts:sign-route"].detail, /did not call it/);
  assert.match(byId["contracts:sign-route"].detail, /404/);
});

test("a healthy file passes, and a bare GET 404 is not a break", async () => {
  const calls = [];
  const db = healthyDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      return { status: 404, body: { ok: false, error: "not_found", path: "contracts/sign" } };
    }
  });
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "PASS", row.id);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(calls[0].url, "https://fundhub.ai/api/contracts/sign");
  assert.equal(calls[0].url.includes("?"), false);
  assert.equal(db.calls.length, 4);
  for (const call of db.calls) {
    assert.match(call.text, /^\s*\/\*|^\s*SELECT/);
    assert.doesNotMatch(call.text, /\b(INSERT|UPDATE|DELETE)\b/);
    assert.equal(call.params[0], ORG);
  }
});

test("a sent contract with no frozen copy fails, and a signable queue does not", async () => {
  const stuck = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, [
        { id: "c-1", template_key: "FUNDING-AGREEMENT", status: "sent", why: "no_anchor" },
        { id: "c-2", template_key: "FUNDING-AGREEMENT", status: "viewed", why: "no_signer" }
      ]],
      [/gap:signed-store/, []],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))],
      [/gap:recon/, [reconRow()]]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const sent = stuck.find((row) => row.id === "contracts:sent-unsignable");
  assert.equal(sent.status, "FAIL");
  assert.match(sent.detail, /c-1/);
  assert.match(sent.detail, /no frozen copy/);
  assert.match(sent.detail, /nobody can sign/);
  assert.match(sent.suggestedFix, /Do not sign/);

  const clear = await gapChecks({
    db: healthyDb(),
    orgId: ORG,
    routeMounted: true
  });
  assert.equal(clear.find((row) => row.id === "contracts:sent-unsignable").status, "PASS");
});

test("a signed contract with no stored file fails", async () => {
  const rows = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, [{ id: "signed-9", template_key: "CREDIT-REPAIR-AGREEMENT" }]],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))],
      [/gap:recon/, [reconRow()]]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const stored = rows.find((row) => row.id === "contracts:signed-not-stored");
  assert.equal(stored.status, "FAIL");
  assert.match(stored.detail, /signed-9/);
  assert.match(stored.detail, /no stored signed file/);
  assert.match(stored.suggestedFix, /Do not sign again/);
});

test("a live offer with no active template fails, and shelved offers are not required", async () => {
  const keys = liveContractTemplateKeys();
  assert.ok(keys.includes("CAPITAL-BLUEPRINT-AGREEMENT"));
  assert.ok(keys.includes("REPAIR-AND-FUNDING-AGREEMENT"));
  assert.ok(keys.includes("FUNDING-AGREEMENT"));
  const fromOffers = Object.values(OFFERS).map((offer) => offer.contractTemplateKey).filter(Boolean);
  assert.equal(
    new Set(keys).size,
    new Set([...fromOffers, "REPAIR-AND-FUNDING-AGREEMENT"]).size
  );
  assert.equal(keys.includes("DECLINE-AUTOPSY"), false);

  const present = keys
    .filter((key) => key !== "CAPITAL-BLUEPRINT-AGREEMENT")
    .map((template_key) => ({ template_key }));
  const rows = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, []],
      [/gap:templates/, present],
      [/gap:recon/, [reconRow()]]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const missing = rows.find((row) => row.id === "contracts:template-missing");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /CAPITAL-BLUEPRINT-AGREEMENT/);
  assert.match(missing.detail, /Capital Blueprint/);
  assert.match(missing.suggestedFix, /Do not mint a new offer/);
});

test("sign link: 404 is pass, a dead answer is fail, a missing route is fail", async () => {
  assert.equal(signRouteIsWired(), true);
  assert.equal(classifyBareSignGet(404, { ok: false, error: "not_found" }).status, "PASS");
  assert.equal(
    classifyBareSignGet(404, { ok: false, error: "not_found", path: "contracts/sign" }).status,
    "PASS"
  );
  assert.equal(classifyBareSignGet(500, null).status, "FAIL");
  assert.equal(classifyBareSignGet(200, { ok: true }).status, "FAIL");
  assert.equal(classifyBareSignGet(405, null).status, "FAIL");

  const closed = await gapChecks({
    routeMounted: true,
    signProbe: { status: 404, body: { ok: false, error: "not_found" } }
  });
  assert.equal(closed.find((row) => row.id === "contracts:sign-route").status, "PASS");

  const dead = await gapChecks({
    db: healthyDb(),
    orgId: ORG,
    routeMounted: true,
    signProbe: { status: 500, body: { ok: false, error: "sign_failed" } }
  });
  const sign = dead.find((row) => row.id === "contracts:sign-route");
  assert.equal(sign.status, "FAIL");
  assert.match(sign.detail, /500/);
  assert.match(sign.suggestedFix, /404/);
  assert.match(sign.suggestedFix, /Do not sign/);

  const unwired = await gapChecks({
    routeMounted: false,
    signProbe: { status: 404, body: { ok: false, error: "not_found" } }
  });
  const missing = unwired.find((row) => row.id === "contracts:sign-route");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /not wired/);
  assert.doesNotMatch(missing.detail, /404/);
});

test("Recon is the one tripwire", async () => {
  const missing = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, []],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))],
      [/gap:recon/, []]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const gone = missing.find((row) => row.id === "contracts:tripwire");
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /AG-07 is missing/);
  assert.match(gone.suggestedFix, /Do not invent a second watchdog/);

  const wrong = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, []],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))],
      [/gap:recon/, [reconRow({ status: "retired", runtime: "ghl", runtime_ref: "GHL-RECON" })]]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const bad = wrong.find((row) => row.id === "contracts:tripwire");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /retired/);
  assert.match(bad.suggestedFix, /second watchdog/);
});

test("a read error skips that check and leaves the others", async () => {
  const rows = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, []],
      [/gap:templates/, []],
      [/gap:recon/, []]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  // templates matcher returns [] so the check FAILs (missing), not a throw.
  // Force a throw on the signed read only.
  const thrown = await gapChecks({
    db: {
      async query(sql) {
        const text = String(sql);
        if (/gap:signed-store/.test(text)) throw new Error("permission denied");
        if (/gap:sent-unsignable/.test(text)) return { rows: [] };
        if (/gap:templates/.test(text)) {
          return { rows: liveContractTemplateKeys().map((template_key) => ({ template_key })) };
        }
        if (/gap:recon/.test(text)) return { rows: [reconRow()] };
        throw new Error(text.slice(0, 40));
      }
    },
    orgId: ORG,
    routeMounted: true
  });
  const stored = thrown.find((row) => row.id === "contracts:signed-not-stored");
  assert.equal(stored.status, "skip");
  assert.match(stored.detail, /permission denied/);
  assert.equal(thrown.find((row) => row.id === "contracts:sent-unsignable").status, "PASS");
  assert.equal(thrown.find((row) => row.id === "contracts:tripwire").status, "PASS");
  assert.equal(rows.find((row) => row.id === "contracts:template-missing").status, "FAIL");
});

test("the queries only read, and the file does not sign or edit a page", () => {
  for (const sql of [SQL_SENT, SQL_SIGNED, SQL_TEMPLATES, SQL_RECON]) {
    assert.match(sql, /SELECT/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  }
  assert.match(SQL_SENT, /status IN \('sent', 'viewed'\)/);
  assert.match(SQL_SENT, /document_version_id IS NULL/);
  assert.match(SQL_SENT, /contract_signers/);
  assert.match(SQL_SENT, /signing_order = 'parallel'/);
  assert.match(SQL_SIGNED, /status = 'signed'/);
  assert.match(SQL_SIGNED, /signed_document_id IS NULL/);
  assert.match(SQL_SIGNED, /signed_document_version_id IS NULL/);
  assert.match(SQL_TEMPLATES, /contract_templates/);
  assert.match(SQL_TEMPLATES, /active = true/);
  assert.match(SQL_RECON, /AG-07|\$2/);
  assert.match(SQL_RECON, /FROM agents/);

  const src = fs.readFileSync(path.join(HERE, "gap-contracts.mjs"), "utf8");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(src, /\.html/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.doesNotMatch(src, /from ["'][^"']*notify/);
  assert.doesNotMatch(src, /slice-10-contracts/);
  assert.doesNotMatch(src, /PULSE_REGISTRY|MACHINE_CHECKS/);
  assert.match(src, /export async function gapChecks/);
});
