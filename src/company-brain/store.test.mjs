import test from "node:test";
import assert from "node:assert/strict";

import { chunkText } from "./chunk.mjs";
import { tiersForRole, assertOwnerOnlyRole } from "./access.mjs";
import { embedTexts, toVectorLiteral, EMBEDDING_DIMS } from "./embed.mjs";
import { upsertExtractedFile, replaceFileChunks } from "./store.mjs";
import { retrieveChunks } from "./retrieve.mjs";

function fakeEmbedding(seed = 1) {
  const v = new Array(EMBEDDING_DIMS).fill(0);
  v[0] = seed;
  v[1] = 1 / seed;
  return v;
}

test("chunkText splits with overlap and skips empty", () => {
  assert.deepEqual(chunkText("  "), []);
  const text = "a".repeat(5000);
  const parts = chunkText(text, { size: 1000, overlap: 100 });
  assert.ok(parts.length >= 5);
  assert.ok(parts.every((p) => p.length <= 1000));
});

test("tiersForRole uses ROLE_SETS (step 5)", () => {
  assert.deepEqual(tiersForRole("closer"), ["public", "sales", "staff"]);
  assert.deepEqual(tiersForRole("funding_advisor"), ["public", "sales", "staff"]);
  assert.ok(assertOwnerOnlyRole("owner").ok);
  assert.ok(assertOwnerOnlyRole("admin").ok);
  assert.ok(assertOwnerOnlyRole("closer").ok);
  assert.ok(tiersForRole("owner").includes("owner"));
  assert.ok(!tiersForRole("owner").includes("affiliate"));
  assert.ok(!tiersForRole("closer").includes("owner"));
});

test("embedTexts uses providers/http postJson via mocked fetch", async () => {
  const emb = fakeEmbedding(3);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ data: [{ index: 0, embedding: emb }] });
    },
    async json() {
      return { data: [{ index: 0, embedding: emb }] };
    }
  });
  // postJson expects res.json/text - check http.mjs - it uses text then JSON.parse
  const fetchImpl2 = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify({ data: [{ index: 0, embedding: emb }] });
    }
  });

  const out = await embedTexts(["hello"], {
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: fetchImpl2
  });
  assert.equal(out.ok, true);
  assert.equal(out.embeddings[0].length, EMBEDDING_DIMS);
  assert.match(toVectorLiteral(out.embeddings[0]), /^\[/);
  void fetchImpl;
});

test("upsertExtractedFile writes file + chunks through db mock", async () => {
  const rows = { files: [], chunks: [], queries: [] };
  const db = {
    async query(sql, params) {
      rows.queries.push({ sql, params });
      if (/SELECT id, content_sha256 FROM brain_files/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO brain_files/i.test(sql)) {
        return { rows: [{ id: "file-1" }] };
      }
      if (/DELETE FROM brain_chunks/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO brain_chunks/i.test(sql)) {
        rows.chunks.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const embed = async (texts) => ({
    ok: true,
    embeddings: texts.map((_, i) => fakeEmbedding(i + 1))
  });

  const out = await upsertExtractedFile(db, {
    orgId: "org-1",
    extracted: {
      fileId: "drive-1",
      name: "SOP.md",
      mimeType: "text/plain",
      text: "Do the thing. ".repeat(50),
      webViewLink: "https://drive.google.com/file/d/drive-1",
      ok: true
    },
    embed,
    classify: false
  });

  assert.equal(out.ok, true);
  assert.equal(out.fileId, "file-1");
  assert.ok(out.chunkCount >= 1);
  assert.ok(rows.chunks.length >= 1);
  assert.equal(rows.chunks[0][4], "owner"); // access_tier
});

// A Drive file named <UUID>.mp4 (an iPhone export) must not be tagged with a client that
// does not exist. The id sniffed from a name is kept only for a real client of the same company.
const SNIFFED = "45741577-919b-4791-8a70-3abf0baaf181";

function recordingDb({ clientExists, rows }) {
  return {
    async query(sql, params) {
      rows.queries.push({ sql, params });
      if (/FROM clients WHERE id/i.test(sql)) {
        return { rows: clientExists ? [{ id: params[0] }] : [] };
      }
      if (/INSERT INTO brain_files/i.test(sql)) {
        rows.insert = params;
        return { rows: [{ id: "file-rec" }] };
      }
      return { rows: [] };
    }
  };
}

const RECORDING = {
  fileId: "drive-rec",
  name: `${SNIFFED.toUpperCase()}.mp4`,
  mimeType: "video/mp4",
  webViewLink: "https://drive.google.com/file/d/drive-rec",
  needsTranscription: true,
  clientId: SNIFFED,
  unattached: false,
  ok: true
};

test("upsertExtractedFile keeps a sniffed client id when that client exists in the company", async () => {
  const rows = { queries: [], insert: null };
  const out = await upsertExtractedFile(recordingDb({ clientExists: true, rows }), {
    orgId: "org-1",
    extracted: { ...RECORDING },
    classify: false
  });
  assert.equal(out.ok, true);
  const lookup = rows.queries.find((q) => /FROM clients WHERE id/i.test(q.sql));
  assert.deepEqual(lookup.params, [SNIFFED, "org-1"], "the lookup is limited to this company");
  assert.equal(rows.insert[6], SNIFFED, "client_id kept");
  assert.equal(rows.insert[7], false, "not unattached");
});

test("upsertExtractedFile saves NULL when the sniffed client id is not a client of the company", async () => {
  const rows = { queries: [], insert: null };
  const out = await upsertExtractedFile(recordingDb({ clientExists: false, rows }), {
    orgId: "org-1",
    extracted: { ...RECORDING },
    classify: false
  });
  assert.equal(out.ok, true);
  assert.equal(rows.insert[6], null, "client_id is NULL, not the made-up id");
  assert.equal(rows.insert[7], true, "the file is unattached");
});

test("upsertExtractedFile never asks the database about an id that is not a UUID", async () => {
  const rows = { queries: [], insert: null };
  const out = await upsertExtractedFile(recordingDb({ clientExists: true, rows }), {
    orgId: "org-1",
    extracted: { ...RECORDING, clientId: "cid-1" },
    classify: false
  });
  assert.equal(out.ok, true);
  assert.equal(rows.queries.some((q) => /FROM clients WHERE id/i.test(q.sql)), false);
  assert.equal(rows.insert[6], null);
  assert.equal(rows.insert[7], true);
});

test("upsertExtractedFile makes no client lookup for a file with no client id", async () => {
  const rows = { queries: [], insert: null };
  await upsertExtractedFile(recordingDb({ clientExists: true, rows }), {
    orgId: "org-1",
    extracted: { ...RECORDING, clientId: null, unattached: true },
    classify: false
  });
  assert.equal(rows.queries.some((q) => /FROM clients WHERE id/i.test(q.sql)), false);
  assert.equal(rows.insert[6], null);
});

test("replaceFileChunks embeds text onto an existing file via OpenAI", async () => {
  const chunks = [];
  const updates = [];
  const db = {
    async query(sql, params) {
      if (/DELETE FROM brain_chunks/i.test(sql)) return { rows: [] };
      if (/INSERT INTO brain_chunks/i.test(sql)) {
        chunks.push(params);
        return { rows: [] };
      }
      if (/UPDATE brain_files/i.test(sql)) {
        updates.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const out = await replaceFileChunks(db, {
    orgId: "org-1",
    fileId: "file-9",
    text: "Closer day 1. We are not the bank. ".repeat(40),
    accessTier: "staff",
    env: { OPENAI_API_KEY: "sk-test" },
    embed: async (texts) => ({
      ok: true,
      embeddings: texts.map((_, i) => fakeEmbedding(i + 2))
    })
  });
  assert.equal(out.ok, true);
  assert.ok(out.chunkCount >= 1);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0][4], "staff");
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], "file-9");
});

test("replaceFileChunks stays dead when OpenAI embed fails", async () => {
  const out = await replaceFileChunks({
    async query() { throw new Error("db should not run"); }
  }, {
    orgId: "org-1",
    fileId: "file-9",
    text: "enough words to make a chunk",
    embed: async () => ({ ok: false, embeddings: [], error: "not_configured:OPENAI_API_KEY" })
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /OPENAI_API_KEY/);
});

test("retrieveChunks refuses non-STAFF before any db call", async () => {
  let called = false;
  const db = {
    async query() {
      called = true;
      return { rows: [] };
    }
  };
  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "partner",
    query: "scripts",
    embed: async () => ({ ok: true, embeddings: [fakeEmbedding(1)] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "use_affiliate_path");
  assert.equal(called, false);
});

test("retrieveChunks filters by tier in SQL and returns rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return {
        rows: [{
          chunk_id: "c1",
          content: "Closer script",
          access_tier: "owner",
          chunk_index: 0,
          file_id: "f1",
          drive_file_id: "d1",
          file_name: "script.doc",
          web_view_link: "https://drive.google.com/file/d/d1",
          client_id: null,
          mime_type: "application/vnd.google-apps.document",
          distance: 0.12
        }]
      };
    }
  };

  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "owner",
    query: "closer script",
    embed: async () => ({ ok: true, embeddings: [fakeEmbedding(1)] })
  });

  assert.equal(out.ok, true);
  assert.equal(out.chunks.length, 1);
  assert.equal(out.chunks[0].fileName, "script.doc");
  assert.match(seen[0].sql, /access_tier = ANY/i);
  assert.ok(seen[0].params[1].includes("owner"));
  assert.ok(!seen[0].params[1].includes("affiliate"));
});
