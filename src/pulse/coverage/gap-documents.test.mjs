import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CHECKS as SLICE_CHECKS } from "./slice-09-documents.mjs";
import { DOC_01_LOCK } from "../../handlers/inquiry-docs.mjs";
import { SMS_DOC_02, WORKFLOW_ID } from "../../handlers/doc-check.mjs";
import { TASK_SOURCE, TEMPLATE_KEYS } from "../../finance/document-vault-chase.mjs";
import {
  CHASE_TEMPLATE_KEYS,
  ID_OPEN,
  ID_STUCK,
  ID_UNCHASED,
  ID_UPLOAD,
  MISSING_TAG,
  READER_HANDLER,
  READER_RED_MS,
  REQUEST_FIELD,
  VAULT_ASK_SOURCE,
  VAULT_RED_MS,
  gapChecks
} from "./gap-documents.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const SRC = readFileSync(fileURLToPath(new URL("./gap-documents.mjs", import.meta.url)), "utf8");

function fakeFetch(status, calls) {
  return async (url, opts) => {
    calls.push({ url, opts });
    if (status === "throw") throw new Error("socket down");
    return { status };
  };
}

function fakeDb(counts, seen) {
  return {
    query: async (sql, params) => {
      const s = String(sql);
      if (!/^\s*select\b/i.test(s)) throw new Error(`not a read: ${s.slice(0, 40)}`);
      seen.push({ sql: s, params });
      if (/failed_events/.test(s)) return { rows: [{ n: counts.reads ?? 0 }] };
      if (/delivery_status/.test(s)) return { rows: [{ n: counts.pending ?? 0 }] };
      if (/current_version_id/.test(s)) return { rows: [{ n: counts.unopenable ?? 0 }] };
      if (/doc_01_request_sent_at/.test(s)) return { rows: [{ n: counts.unchased ?? 0 }] };
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    }
  };
}

function byId(rows, id) {
  const row = rows.find((r) => r.id === id);
  assert.ok(row, `missing ${id}`);
  return row;
}

test("gap checks use the request lock, the vault ask, and the reader handler", () => {
  assert.equal(REQUEST_FIELD, DOC_01_LOCK);
  assert.equal(VAULT_ASK_SOURCE, TASK_SOURCE);
  assert.equal(READER_HANDLER, WORKFLOW_ID);
  for (const key of TEMPLATE_KEYS) assert.ok(CHASE_TEMPLATE_KEYS.includes(key));
  assert.ok(CHASE_TEMPLATE_KEYS.includes(SMS_DOC_02));
  assert.equal(CHASE_TEMPLATE_KEYS.includes("SMS-DOC-01-REQUEST"), false);
  assert.equal(CHASE_TEMPLATE_KEYS.includes("EMAIL-DOC-01-REQUEST"), false);
  assert.equal(MISSING_TAG, "docs:missing");
  assert.equal(VAULT_RED_MS, 3 * 24 * 60 * 60 * 1000);
  assert.equal(READER_RED_MS, 3 * 20 * 60 * 1000);
});

test("gap checks do not repeat slice 09 and do not write or send", () => {
  const sliceIds = new Set(SLICE_CHECKS.map((row) => row.id));
  for (const id of [ID_UPLOAD, ID_UNCHASED, ID_STUCK, ID_OPEN]) {
    assert.equal(sliceIds.has(id), false);
  }
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|workflowInIndex|alreadyInRegistry/);
  assert.doesNotMatch(SRC, /\.html/);
  assert.doesNotMatch(SRC, /sendTemplated|method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /\b(insert|update|delete)\b/i);
});

test("no fetch and no database skips all four", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.equal(row.status, "skip");
    assert.equal(typeof row.detail, "string");
    assert.equal(row.suggestedFix, null);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  }
});

test("upload route: GET 405 is PASS and GET 404 is FAIL", async () => {
  const okCalls = [];
  const ok = await gapChecks({ fetchImpl: fakeFetch(405, okCalls) });
  const pass = byId(ok, ID_UPLOAD);
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /405/);
  assert.match(pass.detail, /No file was uploaded/);
  assert.equal(okCalls[0].opts.method, "GET");
  assert.equal(okCalls[0].opts.body, undefined);
  assert.match(okCalls[0].url, /\/api\/documents-upload$/);

  const badCalls = [];
  const bad = await gapChecks({ fetchImpl: fakeFetch(404, badCalls) });
  const fail = byId(bad, ID_UPLOAD);
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /404/);
  assert.match(fail.detail, /dead/);
  assert.match(fail.suggestedFix, /Recon \(AG-07\)/);
  assert.match(fail.suggestedFix, /Do not build a second watchdog/);
  assert.match(fail.suggestedFix, /Do not upload a file/);
  assert.match(fail.suggestedFix, /Do not email a client/);
  assert.equal(badCalls[0].opts.method, "GET");
});

test("upload route: a down socket is FAIL and still GET", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: fakeFetch("throw", calls) });
  const row = byId(rows, ID_UPLOAD);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /unreachable/);
  assert.equal(calls[0].opts.method, "GET");
});

test("required doc with no chase: zero is PASS and one is FAIL", async () => {
  const now = new Date("2026-10-08T15:00:00.000Z");
  const seen = [];
  const clear = await gapChecks({
    db: fakeDb({ unchased: 0 }, seen),
    orgId: ORG,
    now
  });
  assert.equal(byId(clear, ID_UNCHASED).status, "PASS");
  const ask = seen.find((row) => /doc_01_request_sent_at/.test(row.sql));
  assert.ok(ask);
  assert.equal(ask.params[0], ORG);
  assert.equal(Date.parse(ask.params[1]), now.getTime() - VAULT_RED_MS);
  assert.equal(ask.params[4], VAULT_ASK_SOURCE);
  assert.deepEqual(ask.params[3], CHASE_TEMPLATE_KEYS);

  const hit = await gapChecks({
    db: fakeDb({ unchased: 1 }, []),
    orgId: ORG,
    now
  });
  const fail = byId(hit, ID_UNCHASED);
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /1 required doc requested/);
  assert.match(fail.detail, /never chased/);
  assert.match(fail.suggestedFix, /document-vault-chase/);
  assert.match(fail.suggestedFix, /Do not email a client/);
});

test("stuck processing: pending delivery or an overdue read is FAIL", async () => {
  const clear = await gapChecks({
    db: fakeDb({}, []),
    orgId: ORG
  });
  assert.equal(byId(clear, ID_STUCK).status, "PASS");

  const pending = await gapChecks({
    db: fakeDb({ pending: 2 }, []),
    orgId: ORG
  });
  const pendingFail = byId(pending, ID_STUCK);
  assert.equal(pendingFail.status, "FAIL");
  assert.match(pendingFail.detail, /2 document rows stuck pending/);

  const reads = await gapChecks({
    db: fakeDb({ reads: 1 }, []),
    orgId: ORG
  });
  const readFail = byId(reads, ID_STUCK);
  assert.equal(readFail.status, "FAIL");
  assert.match(readFail.detail, /1 document read still processing past 60 minutes/);
  assert.match(readFail.suggestedFix, /doc-check/);
  assert.match(readFail.suggestedFix, /Do not build a second watchdog/);
});

test("client cannot open a file: route 404 or a row with no version is FAIL", async () => {
  const calls = [];
  const clear = await gapChecks({
    db: fakeDb({ unopenable: 0 }, []),
    orgId: ORG,
    fetchImpl: fakeFetch(401, calls)
  });
  const pass = byId(clear, ID_OPEN);
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /401/);
  assert.match(pass.detail, /No file was opened/);
  assert.ok(calls.some((c) => /\/api\/documents-download$/.test(c.url) && c.opts.method === "GET"));
  assert.ok(calls.every((c) => c.opts.method === "GET"));

  const dead = await gapChecks({
    fetchImpl: fakeFetch(404, [])
  });
  const deadRow = byId(dead, ID_OPEN);
  assert.equal(deadRow.status, "FAIL");
  assert.match(deadRow.detail, /cannot open their file/);
  assert.match(deadRow.suggestedFix, /documents-download/);

  const rows = await gapChecks({
    db: fakeDb({ unopenable: 3 }, []),
    orgId: ORG
  });
  const rowFail = byId(rows, ID_OPEN);
  assert.equal(rowFail.status, "FAIL");
  assert.match(rowFail.detail, /3 document rows have no version/);
});

test("a database error on one check is FAIL and the other checks still return", async () => {
  const db = {
    query: async (sql) => {
      if (/doc_01_request_sent_at/.test(sql)) throw new Error("relation missing");
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: async () => ({ status: 405 }) });
  assert.equal(rows.length, 4);
  assert.equal(byId(rows, ID_UNCHASED).status, "FAIL");
  assert.match(byId(rows, ID_UNCHASED).detail, /read failed/);
  assert.equal(byId(rows, ID_UPLOAD).status, "PASS");
  assert.equal(byId(rows, ID_STUCK).status, "PASS");
});
