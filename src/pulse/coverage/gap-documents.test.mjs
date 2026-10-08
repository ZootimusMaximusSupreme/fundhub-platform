import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CHECKS as SLICE_CHECKS } from "./slice-09-documents.mjs";
import { DOC_01_LOCK, EMAIL_TEMPLATE_KEY as DOC01_EMAIL, SMS_TEMPLATE_KEY as DOC01_SMS } from "../../handlers/inquiry-docs.mjs";
import { SMS_DOC_02, WORKFLOW_ID } from "../../handlers/doc-check.mjs";
import { TASK_SOURCE, TEMPLATE_KEYS } from "../../finance/document-vault-chase.mjs";
import {
  EMAIL_TEMPLATE_KEY as F02_EMAIL,
  EMAIL_FOLLOWUP_TEMPLATE_KEY as F02_FOLLOWUP,
  SMS_TEMPLATE_KEY as F02_SMS
} from "../../workflows/f-02-portal-id-missing.mjs";
import { EMAIL_TEMPLATE_KEY as F06_EMAIL, SMS_TEMPLATE_KEY as F06_SMS } from "../../workflows/f-06-funding-conditions-missing-docs.mjs";
import {
  CHASE_TEMPLATE_KEYS,
  FIRST_ASK_TEMPLATE_KEYS,
  ID_OPEN,
  ID_STORE,
  ID_STUCK,
  ID_UNCHASED,
  MISSING_TAG,
  OPEN_SAMPLE,
  READER_HANDLER,
  READER_RED_MS,
  READER_UNREAD_MS,
  RECEIVED_KINDS,
  REQUEST_FIELD,
  STORE_TIMEOUT_MS,
  VAULT_ASK_SOURCE,
  VAULT_RED_MS,
  gapChecks
} from "./gap-documents.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const SRC = readFileSync(fileURLToPath(new URL("./gap-documents.mjs", import.meta.url)), "utf8");
const NOW = new Date("2026-10-08T15:00:00.000Z");

/**
 * Answers by what the SQL is and records every query. Every answer can be a
 * number, a row list, or an Error.
 */
function fakeDb(a = {}, seen = []) {
  const give = (v) => { if (v instanceof Error) throw v; return v; };
  return {
    seen,
    query: async (sql, params) => {
      const s = String(sql);
      if (!/^\s*select\b/i.test(s)) throw new Error(`not a read: ${s.slice(0, 40)}`);
      seen.push({ sql: s, params });
      if (/FROM clients c/.test(s)) return { rows: [{ n: give(a.unchased ?? 0) }] };
      if (/FILTER \(WHERE delivery_status = 'pending'/.test(s)) {
        const v = give(a.delivery ?? {});
        return { rows: [{ pending: v.pending ?? 0, failed: v.failed ?? 0 }] };
      }
      if (/FROM failed_events/.test(s)) {
        const v = give(a.reader ?? {});
        return { rows: [{ overdue: v.overdue ?? 0, unread: v.unread ?? 0 }] };
      }
      if (/d\.current_version_id IS NULL/.test(s)) return { rows: [{ n: give(a.unopenable ?? 0) }] };
      if (/SELECT d\.id::text AS document_id/.test(s)) {
        const all = give(a.sample ?? []);
        return { rows: all.slice(0, params[1]) };
      }
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    }
  };
}

function fileRows(n) {
  return Array.from({ length: n }, (_, i) => ({ document_id: `doc-${i + 1}`, storage_key: `netlify-blob://documents/secret-key-${i + 1}` }));
}

function fakeStore({ name = "netlify-blobs", exists = async () => true, calls = [] } = {}) {
  return {
    name,
    calls,
    exists: async (key) => { calls.push(key); return exists(key); }
  };
}

function byId(rows, id) {
  const row = rows.find((r) => r.id === id);
  assert.ok(row, `missing ${id}`);
  return row;
}

test("gap checks use the request lock, the first asks, the chases, and the reader handler", () => {
  assert.equal(REQUEST_FIELD, DOC_01_LOCK);
  assert.equal(VAULT_ASK_SOURCE, TASK_SOURCE);
  assert.equal(READER_HANDLER, WORKFLOW_ID);
  for (const key of TEMPLATE_KEYS) assert.ok(CHASE_TEMPLATE_KEYS.includes(key));
  assert.ok(CHASE_TEMPLATE_KEYS.includes(SMS_DOC_02));
  assert.ok(CHASE_TEMPLATE_KEYS.includes(F02_FOLLOWUP));
  // The first asks are exactly what the three request flows write, and none of them is a chase.
  assert.deepEqual(
    [...FIRST_ASK_TEMPLATE_KEYS].sort(),
    [DOC01_EMAIL, DOC01_SMS, F02_EMAIL, F02_SMS, F06_EMAIL, F06_SMS].sort()
  );
  for (const key of FIRST_ASK_TEMPLATE_KEYS) assert.equal(CHASE_TEMPLATE_KEYS.includes(key), false, key);
  assert.deepEqual([...RECEIVED_KINDS], ["client_upload", "inquiry_doc"]);
  assert.equal(MISSING_TAG, "docs:missing");
  assert.equal(VAULT_RED_MS, 3 * 24 * 60 * 60 * 1000);
  assert.equal(READER_RED_MS, 3 * 20 * 60 * 1000);
  assert.equal(READER_UNREAD_MS, 3 * 24 * 60 * 60 * 1000);
});

test("gap checks do not repeat slice 09 or the registry pings, and do not write or send", () => {
  const sliceIds = new Set(SLICE_CHECKS.map((row) => row.id));
  for (const id of [ID_STORE, ID_UNCHASED, ID_STUCK, ID_OPEN]) {
    assert.equal(sliceIds.has(id), false);
  }
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|workflowInIndex|alreadyInRegistry/);
  assert.doesNotMatch(SRC, /\.html/);
  assert.doesNotMatch(SRC, /sendTemplated|method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /\b(insert|update|delete)\b\s+(into|from|\w+\s+set)/i);
  // The upload and download doors are pinged by the registry. This file never calls them.
  assert.doesNotMatch(SRC, /\bfetchImpl\b|\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\.(put|set|del)\s*\(/);   // the store is only asked whether a file exists
  assert.doesNotMatch(SRC, /FROM agents/);            // Recon is read by the daily pulse itself
});

test("no database skips all four", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.equal(row.status, "skip");
    assert.equal(typeof row.detail, "string");
    assert.equal(row.suggestedFix, null);
  }
  assert.deepEqual(rows.map((r) => r.id), [ID_STORE, ID_UNCHASED, ID_STUCK, ID_OPEN]);
});

test("upload store: a real store with the newest file in it is PASS, and no files yet is PASS", async () => {
  const store = fakeStore();
  const seen = [];
  const rows = await gapChecks({ db: fakeDb({ sample: fileRows(5) }, seen), orgId: ORG, now: NOW, documentStore: store });
  const row = byId(rows, ID_STORE);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /netlify-blobs store/);
  assert.match(row.detail, /No file was uploaded/);
  const sampleQuery = seen.find((q) => /SELECT d\.id::text AS document_id/.test(q.sql) && q.params[1] === 1);
  assert.ok(sampleQuery, "the upload check reads back exactly the newest file");
  assert.equal(sampleQuery.params[0], ORG);

  const none = await gapChecks({ db: fakeDb({ sample: [] }), orgId: ORG, documentStore: fakeStore() });
  assert.equal(byId(none, ID_STORE).status, "PASS");
  assert.match(byId(none, ID_STORE).detail, /No saved file to read back yet/);
});

test("upload store: the memory store, an unknown store, a missing file, or a dead store is FAIL", async () => {
  const mem = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, documentStore: fakeStore({ name: "memory" }) });
  assert.equal(byId(mem, ID_STORE).status, "FAIL");
  assert.match(byId(mem, ID_STORE).detail, /memory only.*lost at the next cold start/);
  assert.match(byId(mem, ID_STORE).suggestedFix, /DOCUMENT_STORE_PROVIDER/);
  assert.match(byId(mem, ID_STORE).suggestedFix, /Do not upload a file/);

  // The real provider list, with no store handed in: unset means memory, a typo means unknown.
  const unset = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, env: {} });
  assert.equal(byId(unset, ID_STORE).status, "FAIL");
  assert.match(byId(unset, ID_STORE).detail, /memory/);
  const typo = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, env: { DOCUMENT_STORE_PROVIDER: "netlfy-blobs" } });
  assert.equal(byId(typo, ID_STORE).status, "FAIL");
  assert.match(byId(typo, ID_STORE).detail, /not one the upload door knows/);

  const gone = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, documentStore: fakeStore({ exists: async () => false }) });
  assert.equal(byId(gone, ID_STORE).status, "FAIL");
  assert.match(byId(gone, ID_STORE).detail, /newest saved file \(document doc-1\) is not in the netlify-blobs store/);
  assert.doesNotMatch(byId(gone, ID_STORE).detail, /secret-key/);      // a storage key is a credential

  const dead = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, documentStore: fakeStore({ exists: async () => { throw new Error("blob store down"); } }) });
  assert.equal(byId(dead, ID_STORE).status, "FAIL");

  // A store that never answers is a FAIL, and it does not hang the pulse.
  const hung = fakeStore({ exists: () => new Promise(() => {}) });
  const t0 = Date.now();
  const hungRows = await gapChecks({ db: fakeDb({ sample: fileRows(5) }), orgId: ORG, documentStore: hung, storeTimeoutMs: 20 });
  assert.ok(Date.now() - t0 < 2000, "a hung store must be cut off");
  assert.equal(byId(hungRows, ID_STORE).status, "FAIL");
  assert.equal(byId(hungRows, ID_OPEN).status, "FAIL");
  assert.equal(STORE_TIMEOUT_MS, 8000);

  // A provider with no exists() cannot be asked, so nothing is claimed about the file.
  const noAsk = await gapChecks({ db: fakeDb({ sample: fileRows(1) }), orgId: ORG, documentStore: { name: "vercel-blob" } });
  assert.equal(byId(noAsk, ID_STORE).status, "PASS");
});

test("required doc with no chase: zero is PASS and one is FAIL, and the read looks at all three request paths", async () => {
  const seen = [];
  const clear = await gapChecks({ db: fakeDb({ unchased: 0 }, seen), orgId: ORG, now: NOW, documentStore: fakeStore() });
  assert.equal(byId(clear, ID_UNCHASED).status, "PASS");
  const ask = seen.find((row) => /FROM clients c/.test(row.sql));
  assert.ok(ask);
  assert.equal(ask.params[0], ORG);
  assert.equal(Date.parse(ask.params[1]), NOW.getTime() - VAULT_RED_MS);
  assert.equal(ask.params[2], MISSING_TAG);
  assert.deepEqual(ask.params[3], CHASE_TEMPLATE_KEYS);
  assert.equal(ask.params[4], VAULT_ASK_SOURCE);
  assert.deepEqual(ask.params[6], FIRST_ASK_TEMPLATE_KEYS);
  assert.deepEqual(ask.params[7], RECEIVED_KINDS);

  const hit = await gapChecks({ db: fakeDb({ unchased: 1 }), orgId: ORG, now: NOW, documentStore: fakeStore() });
  const fail = byId(hit, ID_UNCHASED);
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /1 required doc requested/);
  assert.match(fail.detail, /never chased/);
  assert.match(fail.suggestedFix, /document-vault-chase only chases paid Capital Blueprint buyers/);
  assert.match(fail.suggestedFix, /Do not email a client/);

  const two = await gapChecks({ db: fakeDb({ unchased: 2 }), orgId: ORG, now: NOW });
  assert.match(byId(two, ID_UNCHASED).detail, /2 required docs requested/);
});

test("the unchased read: a client file of either kind counts, a first ask is not a chase, demo is out", () => {
  const sql = SRC.slice(SRC.indexOf("const UNCHASED_SQL"), SRC.indexOf("async function checkRequiredUnchased"));
  assert.match(sql, /d\.kind = ANY\(\$8::text\[\]\)/);                     // client_upload AND inquiry_doc
  assert.match(sql, /m\.template_key = ANY\(\$7::text\[\]\)/);             // the request time comes from the first asks
  assert.match(sql, /m\.template_key = ANY\(\$4::text\[\]\)/);             // a chase is one of the chase keys
  assert.match(sql, /least\(/);
  assert.match(sql, /THEN \(c\.custom_fields->>'doc_01_request_sent_at'\)::timestamptz END/);   // the cast only runs on a date
  assert.match(sql, /\$3::text = ANY\(c\.tags\)/);
  assert.match(sql, /c\.is_demo IS NOT TRUE/);
  assert.match(sql, /'synthetic', ''\) <> 'true'/);
  assert.match(sql, /r\.at < \$2::timestamptz/);
  assert.equal((sql.match(/created_at >= r\.at/g) || []).length, 4);      // file, chase message, vault task, staff task: all after the ask
});

test("stuck processing: pending or failed delivery, an overdue read, or an unread document is FAIL", async () => {
  const seen = [];
  const clear = await gapChecks({ db: fakeDb({}, seen), orgId: ORG, now: NOW });
  assert.equal(byId(clear, ID_STUCK).status, "PASS");
  const reader = seen.find((q) => /FROM failed_events/.test(q.sql));
  assert.equal(reader.params[0], ORG);
  assert.equal(reader.params[1], READER_HANDLER);
  assert.equal(Date.parse(reader.params[2]), NOW.getTime() - READER_RED_MS);
  assert.equal(Date.parse(reader.params[3]), NOW.getTime() - READER_UNREAD_MS);
  const delivery = seen.find((q) => /FILTER \(WHERE delivery_status = 'pending'/.test(q.sql));
  assert.equal(Date.parse(delivery.params[1]), NOW.getTime() - VAULT_RED_MS);

  const pending = await gapChecks({ db: fakeDb({ delivery: { pending: 2 } }), orgId: ORG, now: NOW });
  assert.equal(byId(pending, ID_STUCK).status, "FAIL");
  assert.match(byId(pending, ID_STUCK).detail, /2 document rows stuck pending/);

  const failed = await gapChecks({ db: fakeDb({ delivery: { failed: 1 } }), orgId: ORG, now: NOW });
  assert.equal(byId(failed, ID_STUCK).status, "FAIL");
  assert.match(byId(failed, ID_STUCK).detail, /1 document row failed or bounced on delivery/);

  const overdue = await gapChecks({ db: fakeDb({ reader: { overdue: 1 } }), orgId: ORG, now: NOW });
  assert.equal(byId(overdue, ID_STUCK).status, "FAIL");
  assert.match(byId(overdue, ID_STUCK).detail, /1 document read still processing past 60 minutes/);
  assert.match(byId(overdue, ID_STUCK).suggestedFix, /doc-check/);
  assert.match(byId(overdue, ID_STUCK).suggestedFix, /Do not build a second watchdog/);

  const unread = await gapChecks({ db: fakeDb({ reader: { unread: 3 } }), orgId: ORG, now: NOW });
  assert.equal(byId(unread, ID_STUCK).status, "FAIL");
  assert.match(byId(unread, ID_STUCK).detail, /3 documents still unread after 3 days of retries/);

  const all = await gapChecks({ db: fakeDb({ delivery: { pending: 1, failed: 1 }, reader: { overdue: 1, unread: 1 } }), orgId: ORG, now: NOW });
  assert.equal(byId(all, ID_STUCK).detail.split("; ").length, 4);
});

test("the stuck reads leave demo rows out and only count a pending read", () => {
  const delivery = SRC.slice(SRC.indexOf("const STUCK_DELIVERY_SQL"), SRC.indexOf("const STUCK_READER_SQL"));
  assert.match(delivery, /delivery_status = 'pending' AND updated_at < \$2::timestamptz/);
  assert.match(delivery, /delivery_status IN \('failed', 'bounced'\)/);
  assert.match(delivery, /is_demo IS NOT TRUE/);
  const reader = SRC.slice(SRC.indexOf("const STUCK_READER_SQL"), SRC.indexOf("async function checkStuckProcessing"));
  assert.match(reader, /handler_name = \$2::text/);
  assert.match(reader, /status = 'pending'/);
  assert.match(reader, /coalesce\(next_attempt_at, last_seen_at\) < \$3::timestamptz/);
  assert.match(reader, /first_seen_at < \$4::timestamptz/);
});

test("client cannot open a file: a row with no version or a file missing from the store is FAIL", async () => {
  const store = fakeStore();
  const seen = [];
  const clear = await gapChecks({ db: fakeDb({ sample: fileRows(8) }, seen), orgId: ORG, documentStore: store });
  const pass = byId(clear, ID_OPEN);
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /5 newest saved files are in the file store/);
  assert.match(pass.detail, /No file was opened/);
  assert.equal(OPEN_SAMPLE, 5);
  const sampleQuery = seen.find((q) => /SELECT d\.id::text AS document_id/.test(q.sql) && q.params[1] === OPEN_SAMPLE);
  assert.ok(sampleQuery, "reads the newest OPEN_SAMPLE files");
  assert.equal(store.calls.length, 1 + OPEN_SAMPLE);   // the newest file (upload check) plus the sample (open check), nothing else
  assert.ok(store.calls.every((key) => key.startsWith("netlify-blob://")));

  const rowFail = await gapChecks({ db: fakeDb({ unopenable: 3, sample: [] }), orgId: ORG, documentStore: fakeStore() });
  const row = byId(rowFail, ID_OPEN);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /3 document rows have no version/);
  assert.match(row.suggestedFix, /does not open a client file/);

  const some = fakeStore({ exists: async (key) => !key.endsWith("-2") && !key.endsWith("-4") });
  const missing = await gapChecks({ db: fakeDb({ sample: fileRows(5) }), orgId: ORG, documentStore: some });
  assert.equal(byId(missing, ID_OPEN).status, "FAIL");
  assert.match(byId(missing, ID_OPEN).detail, /2 of the 5 newest saved files are not in the file store/);
  assert.doesNotMatch(byId(missing, ID_OPEN).detail, /secret-key/);

  const dead = await gapChecks({ db: fakeDb({ sample: fileRows(2) }), orgId: ORG, env: { DOCUMENT_STORE_PROVIDER: "bogus" } });
  assert.equal(byId(dead, ID_OPEN).status, "FAIL");
  assert.match(byId(dead, ID_OPEN).detail, /2 of the 2 newest saved files are not in the file store/);

  const both = await gapChecks({ db: fakeDb({ unopenable: 1, sample: fileRows(1) }), orgId: ORG, documentStore: fakeStore({ exists: async () => false }) });
  assert.equal(byId(both, ID_OPEN).detail.split("; ").length, 2);

  const empty = await gapChecks({ db: fakeDb({ sample: [] }), orgId: ORG, documentStore: fakeStore() });
  assert.equal(byId(empty, ID_OPEN).status, "PASS");
});

test("the open reads leave demo rows out and only ask about the current version's file", () => {
  const open = SRC.slice(SRC.indexOf("const UNOPENABLE_SQL"), SRC.indexOf("async function checkCannotOpen"));
  assert.match(open, /d\.is_demo IS NOT TRUE/);
  assert.match(open, /v\.id = d\.current_version_id/);
  assert.match(open, /v\.document_id = d\.id/);
  assert.match(open, /nullif\(btrim\(v\.storage_key\), ''\) IS NOT NULL/);
  const sample = SRC.slice(SRC.indexOf("const SAMPLE_SQL"), SRC.indexOf("/** Is each sampled file"));
  assert.match(sample, /d\.is_demo IS NOT TRUE/);
  assert.match(sample, /ORDER BY v\.created_at DESC/);
  assert.match(sample, /LIMIT \$2::int/);
});

test("a database error on one check is FAIL and the other checks still return", async () => {
  const db = fakeDb({ unchased: new Error("relation missing") });
  const rows = await gapChecks({ db, orgId: ORG, documentStore: fakeStore() });
  assert.equal(rows.length, 4);
  assert.equal(byId(rows, ID_UNCHASED).status, "FAIL");
  assert.match(byId(rows, ID_UNCHASED).detail, /read failed/);
  assert.equal(byId(rows, ID_STORE).status, "PASS");
  assert.equal(byId(rows, ID_STUCK).status, "PASS");
  assert.equal(byId(rows, ID_OPEN).status, "PASS");
});

test("no query ever writes", async () => {
  const seen = [];
  await gapChecks({ db: fakeDb({ sample: fileRows(5) }, seen), orgId: ORG, now: NOW, documentStore: fakeStore() });
  assert.ok(seen.length >= 6);
  for (const q of seen) assert.doesNotMatch(q.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
});
