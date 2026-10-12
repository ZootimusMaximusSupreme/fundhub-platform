// Save the original bytes in the proper offer's Drive folder, no live write.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SLO_ADS_FOLDER_ID, DIRECT_BOOK_ADS_FOLDER_ID, TAKE_CHUNK_BYTES,
  takeUploadName, takeFolderForName, chunkOk, parseContentRange,
  sealTakeToken, openTakeToken, beginTake, continueTake
} from "./take-upload.mjs";
import { mintFilmKey } from "./shoot-film-key.mjs";
import handler from "../../api/marketing/shoot/take.mjs";

const SECRET = "film-test-secret-film-test-secret-32";
const ORG = "11111111-1111-4111-8111-111111111111";
const SHOOT = "22222222-2222-4222-8222-222222222222";
const SESSION = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=dry";
const NAME = "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4";

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

describe("the file name", () => {
  test("a real take name is kept", () => {
    assert.equal(takeUploadName(NAME), NAME);
  });

  test("a missing name still uploads", () => {
    assert.equal(takeUploadName(""), "Take.mp4");
    assert.equal(takeUploadName("../"), "Take.mp4");
    assert.equal(takeUploadName("notes"), "notes.mp4");
  });

  test("Direct Book and SLO have distinct and explicit upload folders", () => {
    assert.equal(takeFolderForName("Direct Book Ad 5 — Paying for speed Take 1.mp4"), DIRECT_BOOK_ADS_FOLDER_ID);
    assert.equal(takeFolderForName("Direct Book VSL 1 — Watch page Take 2.mp4"), DIRECT_BOOK_ADS_FOLDER_ID);
    assert.equal(takeFolderForName("Direct Book Thank You Take 1.mp4"), DIRECT_BOOK_ADS_FOLDER_ID);
    assert.equal(takeFolderForName(NAME), SLO_ADS_FOLDER_ID);
    assert.equal(takeFolderForName("Take.webm"), null);
    assert.equal(takeFolderForName("SLO Ad 7 Take 1.mp4"), null);
    assert.equal(takeFolderForName("Other Offer Ad 5 — Paying for speed Take 1.mp4"), null);
  });
});

describe("the pieces", () => {
  test("the last short piece is allowed and a middle piece must line up", () => {
    assert.equal(chunkOk({ start: 0, length: 16, total: 16 }), true);
    assert.equal(chunkOk({ start: 100, length: TAKE_CHUNK_BYTES, total: TAKE_CHUNK_BYTES * 3 }), false);
    assert.equal(chunkOk({ start: 0, length: TAKE_CHUNK_BYTES, total: TAKE_CHUNK_BYTES * 2 }), true);
    assert.equal(parseContentRange("bytes 0-15/16").length, 16);
  });

  test("a token cannot be rewritten into a different upload", () => {
    const token = sealTakeToken({ sessionUrl: SESSION, total: 16, name: NAME, contentType: "video/mp4" }, SECRET);
    assert.equal(openTakeToken(token, SECRET).name, NAME);
    assert.equal(openTakeToken(token + "x", SECRET), null);
    assert.equal(openTakeToken(token, SECRET + "nope"), null);
  });
});

describe("the route", () => {
  test("GET does not upload", async () => {
    const out = res();
    let opened = 0;
    await handler({ method: "GET", headers: {} }, out, {
      filmSecret: SECRET,
      openVideoSession: async () => { opened += 1; return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 405);
    assert.equal(opened, 0);
  });

  test("a bad film key does not upload", async () => {
    const out = res();
    let opened = 0;
    await handler({ method: "POST", headers: { "x-shoot-film": "nope" }, body: { name: NAME, bytes: 16 } }, out, {
      filmSecret: SECRET,
      openVideoSession: async () => { opened += 1; return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 404);
    assert.equal(opened, 0);
  });

  test("no sign-in starts a save in the SLO Ads folder", async () => {
    const out = res();
    const calls = [];
    await handler({
      method: "POST",
      headers: {},
      body: { name: NAME, bytes: 16, content_type: "video/mp4" }
    }, out, {
      filmSecret: SECRET,
      openVideoSession: async (arg) => { calls.push(arg); return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.name, NAME);
    assert.equal(out.body.chunk_bytes, TAKE_CHUNK_BYTES);
    assert.equal(calls[0].parentId, SLO_ADS_FOLDER_ID);
    assert.equal(calls[0].name, NAME);
    assert.equal(calls[0].totalBytes, 16);
  });

  test("Direct Book cannot be misrouted to SLO; unknown filenames fail closed", async () => {
    const calls = [];
    for (const name of ["Take.mp4", "Unidentified Ad 1 — Nope Take 1.mp4"]) {
      const out = res();
      await handler({ method: "POST", headers: {}, body: { name, bytes: 16 } }, out, {
        filmSecret: SECRET,
        openVideoSession: async (arg) => {
          calls.push(arg);
          return { ok: true, sessionUrl: SESSION };
        }
      });
      assert.equal(out.statusCode, 400);
      assert.equal(out.body.error, "unknown_offer");
    }
    assert.equal(calls.length, 0);
    const out = res();
    await handler({ method: "POST", headers: {}, body: { name: "Direct Book Ad 5 — Paying for speed Take 1.mp4", bytes: 16 } }, out, {
      filmSecret: SECRET,
      openVideoSession: async (arg) => { calls.push(arg); return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parentId, DIRECT_BOOK_ADS_FOLDER_ID);
  });

  test("a film key starts the same save", async () => {
    const key = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, now: () => Date.parse("2026-10-07T12:00:00Z") });
    const out = res();
    let parent = null;
    await handler({
      method: "POST",
      headers: { "x-shoot-film": key.token },
      body: { name: "Direct Book Ad 5 — Paying for speed Take 1.webm", bytes: 16, content_type: "video/webm" }
    }, out, {
      filmSecret: SECRET,
      now: () => Date.parse("2026-10-07T12:00:00Z"),
      openVideoSession: async (arg) => { parent = arg.parentId; return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 200);
    assert.equal(parent, DIRECT_BOOK_ADS_FOLDER_ID);
    assert.equal(out.body.name, "Direct Book Ad 5 — Paying for speed Take 1.webm");
  });

  test("the bytes handed to Drive are the bytes from the phone", async () => {
    const clip = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]);
    const started = await beginTake({ name: NAME, bytes: clip.length, content_type: "video/mp4" }, {
      filmSecret: SECRET,
      openVideoSession: async () => ({ ok: true, sessionUrl: SESSION })
    });
    let forwarded = null;
    const sent = await continueTake({
      token: started.body.token,
      range: `bytes 0-${clip.length - 1}/${clip.length}`,
      bytes: clip
    }, {
      filmSecret: SECRET,
      putVideoChunk: async (arg) => { forwarded = Buffer.from(arg.bytes); return { ok: true, done: true, received: clip.length, fileId: "dry" }; }
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.done, true);
    assert.equal(sent.body.file_id, "dry");
    assert.deepEqual([...forwarded], [...clip]);
  });
});

describe("the live site keeps the bytes", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  test("the api reads this upload as bytes, not as text", () => {
    const src = fs.readFileSync(path.join(root, "netlify/functions/api.mjs"), "utf8");
    assert.match(src, /marketing\/shoot\/take/);
    assert.match(src, /request\.text\(\) would\s+decode them as UTF-8/);
    assert.match(src, /Buffer\.from\(await request\.arrayBuffer\(\)\)/);
  });

  test("the morning check watches the route", () => {
    const src = fs.readFileSync(path.join(root, "src/pulse/registry.mjs"), "utf8");
    assert.match(src, /"marketing\/shoot\/take"/);
  });
});
