import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OFFERS } from "../../config/offers.mjs";
import { CHECKS as SLICE_CHECKS } from "./slice-10-contracts.mjs";
import {
  CHECK_IDS,
  SQL_SENT,
  SQL_SIGNED,
  SQL_TEMPLATES,
  classifyBareSignGet,
  classifyForgedSignGet,
  gapChecks,
  liveContractTemplateKeys,
  signRouteIsWired
} from "./gap-contracts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ORG = "11111111-1111-1111-1111-111111111111";

function fakeDb(matchers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      for (const [re, rows] of matchers) {
        if (re.test(text)) {
          if (rows instanceof Error) throw rows;
          return { rows };
        }
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function healthyDb(extra = []) {
  const keys = liveContractTemplateKeys().map((template_key) => ({ template_key }));
  return fakeDb([
    [/gap:sent-unsignable/, []],
    [/gap:signed-store/, []],
    [/gap:templates/, keys],
    ...extra
  ]);
}

/** A fetch that answers the bare GET and the forged-link GET (the one with a query string). */
function signFetch({ bare = { status: 404, body: { ok: false, error: "not_found" } }, forged = bare, calls = [] } = {}) {
  return function fetchImpl(url, opts) {
    calls.push({ url, opts });
    return String(url).includes("?") ? forged : bare;
  };
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

const byId = (rows, id) => rows.find((row) => row.id === id);

test("gap checks use the four-field shape and do not repeat slice 10 or Recon", async () => {
  assert.deepEqual(CHECK_IDS, [
    "contracts:sent-unsignable",
    "contracts:sign-route",
    "contracts:signed-not-stored",
    "contracts:template-missing"
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
  assert.equal(byId(rows, "contracts:sent-unsignable").status, "skip");
  assert.equal(byId(rows, "contracts:signed-not-stored").status, "skip");
  assert.equal(byId(rows, "contracts:template-missing").status, "skip");
  assert.equal(byId(rows, "contracts:sign-route").status, "PASS");
  assert.match(byId(rows, "contracts:sign-route").detail, /did not call it/);
  assert.match(byId(rows, "contracts:sign-route").detail, /404/);
});

test("a healthy file passes, a bare GET 404 is not a break, and the forged link is also asked", async () => {
  const calls = [];
  const db = healthyDb();
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: signFetch({ calls }) });
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "PASS", row.id);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.opts.method === "GET"));
  assert.equal(calls[0].url, "https://fundhub.ai/api/contracts/sign");
  assert.equal(calls[0].url.includes("?"), false);
  assert.match(calls[1].url, /^https:\/\/fundhub\.ai\/api\/contracts\/sign\?id=00000000-0000-4000-8000-000000000000&exp=\d+&sig=00$/);
  assert.equal(db.calls.length, 3);
  for (const call of db.calls) {
    assert.match(call.text, /^\s*\/\*|^\s*SELECT/);
    assert.doesNotMatch(call.text, /\b(INSERT|UPDATE|DELETE)\b/);
    assert.equal(call.params[0], ORG);
  }
  // ctx.fetch works too.
  const alias = await gapChecks({ db: healthyDb(), orgId: ORG, fetch: signFetch() });
  assert.equal(byId(alias, "contracts:sign-route").status, "PASS");
});

test("a sent contract the client cannot sign fails with the reason, and a signable queue does not", async () => {
  const stuck = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, [
        { id: "c-1", template_key: "FUNDING-AGREEMENT", status: "sent", why: "no_anchor" },
        { id: "c-2", template_key: "FUNDING-AGREEMENT", status: "viewed", why: "no_signer" },
        { id: "c-3", template_key: "FUNDING-AGREEMENT", status: "sent", why: "content_changed" }
      ]],
      [/gap:signed-store/, []],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const sent = byId(stuck, "contracts:sent-unsignable");
  assert.equal(sent.status, "FAIL");
  assert.match(sent.detail, /3 sent contracts cannot be signed/);
  assert.match(sent.detail, /c-1 \(no frozen copy/);
  assert.match(sent.detail, /nobody can sign/);
  assert.match(sent.detail, /c-3 \(the words do not match/);
  assert.match(sent.suggestedFix, /Do not sign/);

  const clear = await gapChecks({ db: healthyDb(), orgId: ORG, routeMounted: true });
  assert.equal(byId(clear, "contracts:sent-unsignable").status, "PASS");
});

test("a signed contract with no stored file fails", async () => {
  const rows = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, [{ id: "signed-9", template_key: "CREDIT-REPAIR-AGREEMENT" }]],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const stored = byId(rows, "contracts:signed-not-stored");
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
      [/gap:templates/, present]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const missing = byId(rows, "contracts:template-missing");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /CAPITAL-BLUEPRINT-AGREEMENT/);
  assert.match(missing.detail, /Capital Blueprint/);
  assert.match(missing.suggestedFix, /Do not mint a new offer/);

  // The keys are passed to the read, so a template that is not a live offer's cannot hide a gap.
  const db = healthyDb();
  await gapChecks({ db, orgId: ORG, routeMounted: true });
  const tmpl = db.calls.find((c) => /gap:templates/.test(c.text));
  assert.deepEqual(tmpl.params[1], keys);
});

test("sign link: 404 is pass, a dead answer is fail, a missing route is fail", async () => {
  assert.equal(signRouteIsWired(), true);
  assert.equal(classifyBareSignGet(404, { ok: false, error: "not_found" }).status, "PASS");
  assert.equal(classifyBareSignGet(404, null).status, "PASS");
  assert.equal(classifyBareSignGet(500, null).status, "FAIL");
  assert.equal(classifyBareSignGet(200, { ok: true }).status, "FAIL");
  assert.equal(classifyBareSignGet(405, null).status, "FAIL");
  assert.equal(classifyBareSignGet(503, { ok: false, error: "not_configured" }).status, "FAIL");

  const closed = await gapChecks({
    routeMounted: true,
    signProbe: { status: 404, body: { ok: false, error: "not_found" } }
  });
  assert.equal(byId(closed, "contracts:sign-route").status, "PASS");

  const dead = await gapChecks({
    db: healthyDb(),
    orgId: ORG,
    routeMounted: true,
    signProbe: { status: 500, body: { ok: false, error: "sign_failed" } }
  });
  const sign = byId(dead, "contracts:sign-route");
  assert.equal(sign.status, "FAIL");
  assert.match(sign.detail, /500/);
  assert.match(sign.suggestedFix, /404/);
  assert.match(sign.suggestedFix, /Do not sign/);

  const unwired = await gapChecks({
    routeMounted: false,
    signProbe: { status: 404, body: { ok: false, error: "not_found" } }
  });
  const missing = byId(unwired, "contracts:sign-route");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /not wired/);
  assert.doesNotMatch(missing.detail, /404/);
});

test("sign link: the router's own no-such-route 404 is a break, the door's closed 404 is not", async () => {
  // Live: the sign door answers {"error":"not_found"}. An unknown route answers the same
  // words plus {"path": "..."}. Only the second one means the route is gone.
  const gone = classifyBareSignGet(404, { ok: false, error: "not_found", path: "contracts/sign" });
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /no route for contracts\/sign/);
  const rows = await gapChecks({
    routeMounted: true,
    fetchImpl: signFetch({ bare: { status: 404, body: { ok: false, error: "not_found", path: "contracts/sign" } } })
  });
  const row = byId(rows, "contracts:sign-route");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /router has no route/);
});

test("sign link: a forged link must answer 404, and 503 means the signing secret is missing", async () => {
  assert.equal(classifyForgedSignGet(404, { ok: false, error: "not_found" }).status, "PASS");
  assert.equal(classifyForgedSignGet(503, { ok: false, error: "not_configured" }).status, "FAIL");
  assert.equal(classifyForgedSignGet(200, { ok: true }).status, "FAIL");
  assert.equal(classifyForgedSignGet(500, null).status, "FAIL");
  assert.equal(classifyForgedSignGet(401, null).status, "FAIL");
  assert.equal(classifyForgedSignGet(404, { path: "contracts/sign" }).status, "FAIL");

  const noSecret = await gapChecks({
    routeMounted: true,
    fetchImpl: signFetch({
      bare: { status: 404, body: { ok: false, error: "not_found" } },
      forged: { status: 503, body: { ok: false, error: "not_configured" } }
    })
  });
  const row = byId(noSecret, "contracts:sign-route");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no signing secret/);
  assert.match(row.detail, /Every client sign link would be dead/);
  assert.match(row.suggestedFix, /Do not sign/);

  const crashed = await gapChecks({
    routeMounted: true,
    signProbe: { status: 404, body: { ok: false, error: "not_found" } },
    signLinkProbe: { status: 500, body: null }
  });
  assert.equal(byId(crashed, "contracts:sign-route").status, "FAIL");
  assert.match(byId(crashed, "contracts:sign-route").detail, /500/);
});

test("sign link: a fetch that throws is a fail, and an unreadable route map leans on the live call", async () => {
  const down = await gapChecks({
    routeMounted: true,
    fetchImpl: () => { throw new Error("socket closed"); }
  });
  assert.equal(byId(down, "contracts:sign-route").status, "FAIL");
  assert.match(byId(down, "contracts:sign-route").detail, /socket closed/);

  assert.equal(signRouteIsWired(null, () => { throw new Error("ENOENT"); }), null);
  assert.equal(signRouteIsWired('const ROUTES = { "contracts/sign": contractsSign }'), true);
  assert.equal(signRouteIsWired("const ROUTES = {}"), false);

  // Route map unreadable, no fetch: nothing was checked, so it is a skip, not a PASS.
  const blind = await gapChecks({ routeMounted: null });
  assert.equal(byId(blind, "contracts:sign-route").status, "skip");
  // Route map unreadable, live answers: the live answer decides.
  const live = await gapChecks({ routeMounted: null, fetchImpl: signFetch() });
  assert.equal(byId(live, "contracts:sign-route").status, "PASS");
  const liveBad = await gapChecks({
    routeMounted: null,
    fetchImpl: signFetch({ bare: { status: 500, body: null } })
  });
  assert.equal(byId(liveBad, "contracts:sign-route").status, "FAIL");
});

test("a read error is a red row for that check and leaves the others alone", async () => {
  const keys = liveContractTemplateKeys().map((template_key) => ({ template_key }));
  const thrown = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, new Error("permission denied")],
      [/gap:templates/, keys]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const stored = byId(thrown, "contracts:signed-not-stored");
  assert.equal(stored.status, "FAIL");
  assert.match(stored.detail, /could not read signed contracts: permission denied/);
  assert.match(stored.suggestedFix, /Do not write from this check/);
  shape(stored);
  assert.equal(byId(thrown, "contracts:sent-unsignable").status, "PASS");
  assert.equal(byId(thrown, "contracts:template-missing").status, "PASS");

  // Same for the other two reads.
  for (const [tag, id] of [["sent-unsignable", "contracts:sent-unsignable"], ["templates", "contracts:template-missing"]]) {
    const rows = await gapChecks({
      db: {
        async query(sql) {
          if (new RegExp(`gap:${tag}`).test(String(sql))) throw new Error("column gone");
          return { rows: [] };
        }
      },
      orgId: ORG,
      routeMounted: true
    });
    assert.equal(byId(rows, id).status, "FAIL", id);
    assert.match(byId(rows, id).detail, /column gone/);
  }

  // An empty template read means every live offer is missing its template.
  const empty = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, []],
      [/gap:signed-store/, []],
      [/gap:templates/, []]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  assert.equal(byId(empty, "contracts:template-missing").status, "FAIL");
});

test("the queries only read, mirror the sign door, and leave demo rows out", () => {
  for (const sql of [SQL_SENT, SQL_SIGNED, SQL_TEMPLATES]) {
    assert.match(sql, /SELECT/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  }
  assert.match(SQL_SENT, /status IN \('sent', 'viewed'\)/);
  assert.match(SQL_SENT, /document_version_id IS NULL/);
  assert.match(SQL_SENT, /contract_signers/);
  assert.match(SQL_SENT, /signing_order = 'parallel'/);
  assert.match(SQL_SENT, /ahead\.status <> 'signed'/);
  // The words are re-hashed the way verifyIntegrity does, not just compared as stored.
  assert.match(SQL_SENT, /'sha256:' \|\| encode\(sha256\(convert_to\(coalesce\(c\.rendered_body, ''\), 'UTF8'\)\), 'hex'\)/);
  assert.match(SQL_SENT, /h\.sha IS DISTINCT FROM dv\.checksum/);
  assert.match(SQL_SENT, /h\.sha IS DISTINCT FROM c\.body_sha/);
  // ...and both comparisons are in the WHERE, not only in the reason label above it.
  const where = SQL_SENT.slice(SQL_SENT.indexOf("WHERE c.org_id"));
  assert.match(where, /OR h\.sha IS DISTINCT FROM dv\.checksum\s+OR h\.sha IS DISTINCT FROM c\.body_sha/);
  assert.match(SQL_SENT, /c\.is_demo IS NOT TRUE/);
  assert.match(SQL_SIGNED, /status = 'signed'/);
  assert.match(SQL_SIGNED, /signed_document_id IS NULL/);
  assert.match(SQL_SIGNED, /signed_document_version_id IS NULL/);
  assert.match(SQL_SIGNED, /signed_body_sha IS NULL/);
  assert.match(SQL_SIGNED, /c\.is_demo IS NOT TRUE/);
  assert.match(SQL_TEMPLATES, /contract_templates/);
  assert.match(SQL_TEMPLATES, /active = true/);
  assert.match(SQL_TEMPLATES, /is_demo IS NOT TRUE/);
});

test("the hash in the query is the hash the sign door computes", () => {
  const send = fs.readFileSync(path.join(ROOT, "src/contracts/send.mjs"), "utf8");
  assert.ok(
    send.includes('`sha256:${createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex")}`'),
    "bodyHash in src/contracts/send.mjs changed; update SQL_SENT to match"
  );
  const sign = fs.readFileSync(path.join(ROOT, "src/contracts/sign.mjs"), "utf8");
  assert.ok(sign.includes("bodyHash(contract.rendered_body)"), "verifyIntegrity changed; update SQL_SENT to match");
});

test("the file does not sign, edit a page, read Recon, or send", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-contracts.mjs"), "utf8");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(src, /\.html/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.doesNotMatch(src, /from ["'][^"']*notify/);
  assert.doesNotMatch(src, /slice-10-contracts/);
  assert.doesNotMatch(src, /PULSE_REGISTRY|MACHINE_CHECKS/);
  assert.doesNotMatch(src, /FROM agents/);                       // Recon is the daily pulse's own check
  assert.match(src, /export async function gapChecks/);
});
