import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { OFFERS } from "../../config/offers.mjs";
import { isUuid } from "../../http/read-api.mjs";
import { verifyContractRequest } from "../../contracts/signed-link.mjs";
import { CHECKS as SLICE_CHECKS } from "./slice-10-contracts.mjs";
import {
  CHECK_IDS,
  FORGED_LINK,
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
  // A hung sign door must end as a red row, so every call carries its own time limit.
  assert.ok(calls.every((c) => c.opts.signal instanceof AbortSignal && c.opts.signal.aborted === false));
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
  // The router's own 404 is named as that, not as "not the expected 404".
  assert.match(classifyForgedSignGet(404, { path: "contracts/sign" }).detail, /router has no route for contracts\/sign/);

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

// ─────────────────────────────────────────────────────────────────────────────
// Pins that read the real sign door's own rules, so the queries cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

const listOf = (text) => [...String(text).matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);

test("the 'nobody can sign' clause uses the signer states the sign door uses", () => {
  // Source of truth 1: the states the table allows.
  const migration = fs.readFileSync(path.join(ROOT, "db/migrations/125_contract_esign.sql"), "utf8");
  const allowed = /status\s+text NOT NULL DEFAULT 'pending'\s+CHECK \(status IN \(([^)]*)\)\)/.exec(migration);
  assert.ok(allowed, "contract_signers.status CHECK moved; update this pin");
  // Source of truth 2: the states signers.mjs treats as finished, and its turn rule.
  const signers = fs.readFileSync(path.join(ROOT, "src/contracts/signers.mjs"), "utf8");
  const terminal = /const TERMINAL = new Set\(\[([^\]]*)\]\)/.exec(signers);
  assert.ok(terminal, "TERMINAL in signers.mjs moved; update this pin");
  assert.match(signers, /\.filter\(\(s\) => s\.status !== "signed"\)/, "canSign's turn rule changed; update SQL_SENT");
  const open = listOf(allowed[1]).filter((state) => !listOf(terminal[1]).includes(state));
  assert.deepEqual(open, ["pending", "sent", "viewed"]);

  const where = SQL_SENT.slice(SQL_SENT.indexOf("WHERE c.org_id"));
  // The whole signer test is in the WHERE, not only in the label above it.
  const clause = /OR NOT EXISTS \(\s*SELECT 1\s+FROM contract_signers s\s+WHERE s\.contract_id = c\.id\s+AND s\.status IN \(([^)]*)\)\s+AND \(\s+c\.signing_order = 'parallel'\s+OR NOT EXISTS \(\s*SELECT 1\s+FROM contract_signers ahead\s+WHERE ahead\.contract_id = c\.id\s+AND ahead\.signer_index < s\.signer_index\s+AND ahead\.status <> 'signed'\s+\)\s+\)\s+\)/.exec(where);
  assert.ok(clause, "the 'nobody can sign' clause is missing from the WHERE or changed shape");
  assert.deepEqual(listOf(clause[1]), open);
});

test("every query is scoped to the one company and the signed-file read checks both stored rows", () => {
  assert.match(SQL_SENT, /WHERE c\.org_id = \$1::uuid/);
  assert.match(SQL_SIGNED, /WHERE c\.org_id = \$1::uuid/);
  assert.match(SQL_TEMPLATES, /WHERE org_id = \$1::uuid/);
  assert.match(SQL_TEMPLATES, /template_key = ANY\(\$2::text\[\]\)/);
  assert.match(SQL_SIGNED, /OR NOT EXISTS \(\s*SELECT 1 FROM document_versions dv\s+WHERE dv\.id = c\.signed_document_version_id\s*\)/);
  assert.match(SQL_SIGNED, /OR NOT EXISTS \(\s*SELECT 1 FROM documents d\s+WHERE d\.id = c\.signed_document_id\s*\)/);
});

test("the forged link is shaped to reach the secret check and can never be a 410", () => {
  const url = new URL(FORGED_LINK, "http://x.invalid");
  assert.equal(url.pathname, "/api/contracts/sign");
  // A malformed id is refused (404) before the secret is read, which would hide a missing secret.
  assert.equal(isUuid(url.searchParams.get("id")), true);
  assert.ok(Number(url.searchParams.get("exp")) * 1000 > Date.now() + 365 * 24 * 3600 * 1000, "the link must not be expired");

  const secret = "S".repeat(48);
  const withSecret = verifyContractRequest(FORGED_LINK, { secret });
  assert.deepEqual([withSecret.valid, withSecret.reason], [false, "bad_signature"]);
  // The door checks the signature before the expiry, so even a long-dead forged link is a 404, never a 410.
  const old = verifyContractRequest(FORGED_LINK.replace(/exp=\d+/, "exp=1"), { secret });
  assert.deepEqual([old.valid, old.reason], [false, "bad_signature"]);

  // No secret: the door says not_configured, which is what makes the check red.
  const saved = { a: process.env.CONTRACT_URL_SECRET, b: process.env.DOCUMENT_URL_SECRET };
  delete process.env.CONTRACT_URL_SECRET;
  delete process.env.DOCUMENT_URL_SECRET;
  try {
    assert.equal(verifyContractRequest(FORGED_LINK).reason, "no_secret");
  } finally {
    if (saved.a !== undefined) process.env.CONTRACT_URL_SECRET = saved.a;
    if (saved.b !== undefined) process.env.DOCUMENT_URL_SECRET = saved.b;
  }
});

test("a sent contract whose signer said no is named as declined, not as a system fault", async () => {
  const rows = await gapChecks({
    db: fakeDb([
      [/gap:sent-unsignable/, [{ id: "c-7", template_key: "FUNDING-AGREEMENT", status: "sent", why: "declined" }]],
      [/gap:signed-store/, []],
      [/gap:templates/, liveContractTemplateKeys().map((template_key) => ({ template_key }))]
    ]),
    orgId: ORG,
    routeMounted: true
  });
  const sent = byId(rows, "contracts:sent-unsignable");
  assert.equal(sent.status, "FAIL");
  assert.match(sent.detail, /c-7 \(a signer said no, so staff must void it or send a new one\)/);
  assert.match(SQL_SENT, /d\.status = 'declined'\s*\)\s*THEN 'declined'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// The real queries, run on a real Postgres over made-up rows.
//
// Each table the query names is replaced, for that one statement, by a list of
// made-up rows (a CTE with the table's name shadows the real table). The gap
// file's own SQL runs unchanged. The whole thing sits in BEGIN READ ONLY and is
// rolled back, so nothing is created or written, even on the live database.
// Runs when DATABASE_URL is set (CI, and the live proof). Skipped without it;
// the pins above still run everywhere.
// ─────────────────────────────────────────────────────────────────────────────

const HAVE_DB = !!process.env.DATABASE_URL;
const NO_DB = "no DATABASE_URL: the made-up-rows proof runs in CI and in the live proof";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const BODY = "This agreement is between Fundhub and the client.";
const sha = (text) => `sha256:${createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex")}`;

const SHADOW_COLS = {
  contracts: [
    ["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["status", "text"], ["template_key", "text"],
    ["document_version_id", "uuid"], ["rendered_body", "text"], ["body_sha", "text"],
    ["source_kind", "text"], ["source_document_id", "uuid"], ["signing_order", "text"],
    ["signed_document_id", "uuid"], ["signed_document_version_id", "uuid"], ["signed_body_sha", "text"]
  ],
  document_versions: [["id", "uuid"], ["checksum", "text"]],
  documents: [["id", "uuid"]],
  contract_signers: [["contract_id", "uuid"], ["status", "text"], ["signer_index", "integer"]],
  contract_templates: [["org_id", "uuid"], ["template_key", "text"], ["active", "boolean"], ["is_demo", "boolean"]]
};

async function withShadow(rowsByTable, run) {
  const { default: pg } = await import("pg");
  const url = process.env.DATABASE_URL;
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const tables = Object.keys(SHADOW_COLS);
    const db = {
      async query(sql, params = []) {
        const withs = tables.map((name, i) => {
          const cols = SHADOW_COLS[name].map(([c, t]) => `"${c}" ${t}`).join(", ");
          return `${name} AS (SELECT * FROM jsonb_to_recordset($${params.length + i + 1}::jsonb) AS x(${cols}))`;
        });
        const json = tables.map((name) => JSON.stringify(rowsByTable[name] || []));
        return client.query(`WITH ${withs.join(", ")} ${String(sql)}`, [...params, ...json]);
      }
    };
    return await run(db);
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* nothing was written */ }
    await client.end();
  }
}

/** Made-up ids that read well in a failure message. */
function idMaker() {
  const ids = {};
  const id = (label) => {
    if (!ids[label]) ids[label] = `00000000-0000-4000-8000-${String(Object.keys(ids).length + 1).padStart(12, "0")}`;
    return ids[label];
  };
  const label = (value) => Object.keys(ids).find((key) => ids[key] === value) || value;
  return { id, label };
}

function sentFixture() {
  const { id, label } = idMaker();
  const contracts = [];
  const versions = [];
  const signers = [];
  const add = (name, opts = {}, expected = null) => {
    const body = "body" in opts ? opts.body : BODY;
    const hashed = body == null ? BODY : body;
    let versionId = null;
    if (opts.anchor === undefined || opts.anchor === true) {
      versionId = id(`${name}:version`);
      versions.push({ id: versionId, checksum: "checksum" in opts ? opts.checksum : sha(hashed) });
    } else if (opts.anchor === "ghost") {
      versionId = id(`${name}:ghost`);
    }
    contracts.push({
      id: id(name),
      org_id: opts.org || ORG,
      is_demo: opts.demo === true,
      status: opts.status || "sent",
      template_key: "FUNDING-AGREEMENT",
      document_version_id: versionId,
      rendered_body: body,
      body_sha: "bodySha" in opts ? opts.bodySha : (body == null ? null : sha(body)),
      source_kind: (opts.source && opts.source.source_kind) || "text",
      source_document_id: (opts.source && opts.source.source_document_id) || null,
      signing_order: opts.order || "sequential"
    });
    (opts.signers || ["pending"]).forEach((status, i) => {
      signers.push({ contract_id: id(name), status, signer_index: i });
    });
    return [name, expected];
  };
  const cases = [
    add("ok-single"),
    add("ok-viewed", { status: "viewed", signers: ["viewed"] }),
    add("ok-parallel-one-signed", { order: "parallel", signers: ["signed", "pending"] }),
    add("ok-parallel-both-pending", { order: "parallel", signers: ["pending", "pending"] }),
    add("ok-parallel-one-declined", { order: "parallel", signers: ["declined", "pending"] }),
    add("ok-sequential-second-turn", { signers: ["signed", "pending"] }),
    add("ok-sequential-third-turn", { signers: ["signed", "signed", "viewed"] }),
    add("ok-sequential-first-turn", { signers: ["pending", "pending"] }),
    add("ok-pdf", { source: { source_kind: "pdf", source_document_id: id("pdf-file") } }),
    add("ok-unicode-crlf", { body: "Café — 契約\r\nSecond line" }),
    add("no-signers", { signers: [] }, "no_signer"),
    add("everyone-signed-but-status-sent", { signers: ["signed", "signed"] }, "no_signer"),
    add("only-signer-declined", { signers: ["declined"] }, "declined"),
    add("sequential-first-declined", { signers: ["declined", "pending"] }, "declined"),
    add("parallel-all-declined", { order: "parallel", signers: ["declined", "declined"] }, "declined"),
    add("no-anchor", { anchor: false }, "no_anchor"),
    add("anchor-points-nowhere", { anchor: "ghost" }, "no_anchor"),
    add("anchor-without-checksum", { checksum: null }, "no_anchor"),
    add("no-words", { body: null }, "no_body"),
    add("no-words-hash", { bodySha: null }, "no_body"),
    add("pdf-file-missing", { source: { source_kind: "pdf", source_document_id: null } }, "pdf_missing"),
    add("words-changed-after-send", { body: "Edited after it was sent.", checksum: sha(BODY), bodySha: sha(BODY) }, "content_changed"),
    add("only-body-hash-differs", { bodySha: sha("something else") }, "content_changed"),
    add("only-frozen-copy-differs", { checksum: sha("something else") }, "content_changed"),
    add("draft-not-sent", { status: "draft", signers: [] }),
    add("already-signed", { status: "signed", signers: ["signed"] }),
    add("voided", { status: "void", signers: [] }),
    add("demo-contract", { demo: true, signers: [] }),
    add("other-company", { org: OTHER_ORG, signers: [] })
  ];
  return { rowsByTable: { contracts, document_versions: versions, contract_signers: signers }, cases, label };
}

test("the sent-contract query flags exactly the contracts a client cannot sign, on real rows", { skip: HAVE_DB ? false : NO_DB }, async () => {
  const { rowsByTable, cases, label } = sentFixture();
  const out = await withShadow(rowsByTable, (db) => db.query(SQL_SENT, [ORG]));
  const got = Object.fromEntries(out.rows.map((row) => [label(row.id), row.why]));
  const want = Object.fromEntries(cases.filter(([, why]) => why).map(([name, why]) => [name, why]));
  assert.deepEqual(got, want);
});

test("the signed-contract query flags exactly the signed contracts with no stored copy, on real rows", { skip: HAVE_DB ? false : NO_DB }, async () => {
  const { id, label } = idMaker();
  const contracts = [];
  const versions = [{ id: id("version-ok"), checksum: "x" }];
  const documents = [{ id: id("document-ok") }];
  const signed = (name, over = {}) => contracts.push({
    id: id(name),
    org_id: ORG,
    is_demo: false,
    status: "signed",
    template_key: "FUNDING-AGREEMENT",
    signed_document_id: id("document-ok"),
    signed_document_version_id: id("version-ok"),
    signed_body_sha: "sha256:abc",
    ...over
  });
  signed("stored-ok");
  signed("no-signed-document", { signed_document_id: null });
  signed("no-signed-version", { signed_document_version_id: null });
  signed("no-signed-hash", { signed_body_sha: null });
  signed("signed-version-row-gone", { signed_document_version_id: id("version-ghost") });
  signed("signed-document-row-gone", { signed_document_id: id("document-ghost") });
  signed("demo-signed-empty", { is_demo: true, signed_document_id: null });
  signed("other-company-empty", { org_id: OTHER_ORG, signed_document_id: null });
  signed("still-sent-empty", { status: "sent", signed_document_id: null, signed_document_version_id: null, signed_body_sha: null });

  const out = await withShadow({ contracts, document_versions: versions, documents }, (db) => db.query(SQL_SIGNED, [ORG]));
  assert.deepEqual(
    out.rows.map((row) => label(row.id)).sort(),
    ["no-signed-document", "no-signed-hash", "no-signed-version", "signed-document-row-gone", "signed-version-row-gone"]
  );
});

test("the template query returns only this company's active, real templates for the keys asked", { skip: HAVE_DB ? false : NO_DB }, async () => {
  const rows = [
    { org_id: ORG, template_key: "A", active: true, is_demo: false },
    { org_id: ORG, template_key: "B", active: false, is_demo: false },
    { org_id: OTHER_ORG, template_key: "C", active: true, is_demo: false },
    { org_id: ORG, template_key: "D", active: true, is_demo: true },
    { org_id: ORG, template_key: "E", active: true, is_demo: false }
  ];
  const out = await withShadow({ contract_templates: rows }, (db) => db.query(SQL_TEMPLATES, [ORG, ["A", "B", "C", "D"]]));
  assert.deepEqual(out.rows.map((row) => row.template_key), ["A"]);
});

test("the whole lane, on made-up rows: stuck, unsaved and missing go red; a healthy file stays green", { skip: HAVE_DB ? false : NO_DB }, async () => {
  const keys = liveContractTemplateKeys();
  const templates = keys.map((template_key) => ({ org_id: ORG, template_key, active: true, is_demo: false }));
  const good = sentFixture();
  const healthy = good.cases.filter(([, why]) => !why).map(([name]) => name);
  assert.ok(healthy.length > 5);
  const healthyRows = {
    contracts: good.rowsByTable.contracts.filter((c) => healthy.includes(good.label(c.id))),
    document_versions: good.rowsByTable.document_versions,
    contract_signers: good.rowsByTable.contract_signers,
    contract_templates: templates
  };
  // The healthy sent contracts include one with status "signed"; give it a stored copy so the signed read is clean too.
  const docId = "00000000-0000-4000-8000-0000000000aa";
  const verId = "00000000-0000-4000-8000-0000000000bb";
  healthyRows.contracts = healthyRows.contracts.map((c) =>
    c.status === "signed" ? { ...c, signed_document_id: docId, signed_document_version_id: verId, signed_body_sha: "sha256:abc" } : c);
  healthyRows.document_versions = [...healthyRows.document_versions, { id: verId, checksum: "x" }];
  healthyRows.documents = [{ id: docId }];
  const clean = await withShadow(healthyRows, (db) => gapChecks({ db, orgId: ORG, routeMounted: true }));
  for (const id of ["contracts:sent-unsignable", "contracts:signed-not-stored", "contracts:template-missing"]) {
    assert.equal(byId(clean, id).status, "PASS", `${id}: ${byId(clean, id).detail}`);
  }

  const broken = await withShadow(
    {
      ...good.rowsByTable,
      contracts: [
        ...good.rowsByTable.contracts,
        { id: "00000000-0000-4000-8000-0000000000cc", org_id: ORG, is_demo: false, status: "signed", template_key: "FUNDING-AGREEMENT" }
      ],
      contract_templates: templates.filter((t) => t.template_key !== "CAPITAL-BLUEPRINT-AGREEMENT")
    },
    (db) => gapChecks({ db, orgId: ORG, routeMounted: true })
  );
  assert.equal(byId(broken, "contracts:sent-unsignable").status, "FAIL");
  assert.match(byId(broken, "contracts:sent-unsignable").detail, /cannot be signed/);
  assert.equal(byId(broken, "contracts:signed-not-stored").status, "FAIL");
  assert.match(byId(broken, "contracts:signed-not-stored").detail, /0000000000cc/);
  assert.equal(byId(broken, "contracts:template-missing").status, "FAIL");
  assert.match(byId(broken, "contracts:template-missing").detail, /CAPITAL-BLUEPRINT-AGREEMENT/);
});
