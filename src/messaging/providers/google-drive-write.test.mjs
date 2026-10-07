// The Drive write provider.
//
// NO NETWORK. One injected `fetchImpl` answers both the Google token exchange
// and the Drive call after it. ADAPTERS_DRY_RUN is "0" wherever a write is
// expected, because the fence defaults to BLOCKED.
//
// The two properties worth the most here are the two named in the module's
// header: a read-only token is reported as a read-only token rather than as a
// mystery, and a video is refused outright instead of being mangled by a
// transport that reads every response as text.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER, ENABLED, TRANSMITS, FOLDER_MIME,
  DRIVE_WRITE_SCOPE, MAX_TEXT_UPLOAD_BYTES, MAX_VIDEO_BYTES,
  grantsWrite, resetTokenCache,
  listNewVideos, getFileMeta, renameFile, ensureFolder, uploadTextFile,
  downloadFile, uploadVideo, openVideoSession, putVideoChunk
} from "./google-drive-write.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** An OAuth token.json inline, the shape src/company-brain/config.mjs reads. */
const tokenJson = JSON.stringify({
  refresh_token: "rt-test", client_id: "cid-test", client_secret: "cs-test"
});

const envWith = (extra = {}) => ({
  ADAPTERS_DRY_RUN: "0",
  GOOGLE_DRIVE_OAUTH_TOKEN_JSON: tokenJson,
  ...extra
});

/* One fetch stand-in for both hops. The first call is always Google's token
   endpoint; everything after it is Drive. */
function fakeFetch({ scope = DRIVE_WRITE_SCOPE, responses = [] } = {}) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const body = { access_token: "at-test", expires_in: 3600, token_type: "Bearer", scope };
      return { ok: true, status: 200, headers: { forEach() {} }, text: async () => JSON.stringify(body) };
    }
    const { status = 200, body = {} } = queue.length > 1 ? queue.shift() : (queue[0] || {});
    return {
      ok: status >= 200 && status < 300, status,
      headers: { forEach() {} }, text: async () => JSON.stringify(body)
    };
  };
  impl.calls = calls;
  impl.drive = () => calls.filter((c) => !c.url.includes("oauth2.googleapis.com"));
  return impl;
}

beforeEach(() => resetTokenCache());

describe("scope", () => {
  test("read-only does not write, and full drive does", () => {
    assert.equal(grantsWrite("https://www.googleapis.com/auth/drive.readonly"), false);
    assert.equal(grantsWrite(DRIVE_WRITE_SCOPE), true);
    assert.equal(grantsWrite("https://www.googleapis.com/auth/drive.file"), true);
    assert.equal(grantsWrite(null), null, "Google not saying is not the same as Google saying no");
  });

  test("A READ-ONLY TOKEN IS NAMED, NOT GUESSED AT — and the stored key is left alone", async () => {
    const impl = fakeFetch({ scope: "https://www.googleapis.com/auth/drive.readonly" });
    const res = await ensureFolder({ parentId: "root", name: "043", env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, false);
    assert.match(res.error, /read-only/);
    assert.match(res.error, /left exactly as (it is|they are)/);
    assert.equal(impl.drive().length, 0, "a write was attempted on a token that cannot write");
  });

  test("a 403 from Google says what it usually means", async () => {
    const impl = fakeFetch({ responses: [{ status: 403, body: { error: { message: "insufficientPermissions" } } }] });
    const res = await renameFile("f1", "043_t02_raw.mp4", { env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, false);
    assert.match(res.error, /read-only token/);
  });
});

describe("the fence", () => {
  test("nothing is written when ADAPTERS_DRY_RUN is unset", async () => {
    const impl = fakeFetch({});
    const res = await ensureFolder({
      parentId: "root", name: "043",
      env: { GOOGLE_DRIVE_OAUTH_TOKEN_JSON: tokenJson }, fetchImpl: impl
    });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
    assert.equal(impl.drive().length, 0);
  });
});

describe("finding new takes", () => {
  test("a file still uploading is skipped — it has an id and zero bytes", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: { files: [
      { id: "a", name: "VID_1.mp4", mimeType: "video/mp4", size: "0", createdTime: "2026-09-23T10:00:00Z" },
      { id: "b", name: "VID_2.mp4", mimeType: "video/mp4", size: "184000000", createdTime: "2026-09-23T10:05:00Z" }
    ] } }] });
    const res = await listNewVideos({ folderId: "raw", env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, true);
    assert.deepEqual(res.files.map((f) => f.id), ["b"]);
    assert.equal(res.skipped, 1);
  });

  test("something that is not a video is skipped", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: { files: [
      { id: "n", name: "notes.txt", mimeType: "text/plain", size: "40" }
    ] } }] });
    const res = await listNewVideos({ folderId: "raw", env: envWith(), fetchImpl: impl });
    assert.deepEqual(res.files, []);
  });

  test("the watermark and the folder both reach the query", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: { files: [] } }] });
    await listNewVideos({ folderId: "RAWID", since: "2026-09-23T09:00:00.000Z", env: envWith(), fetchImpl: impl });
    const url = decodeURIComponent(impl.drive()[0].url);
    assert.match(url, /'RAWID' in parents/);
    assert.match(url, /trashed = false/);
    /* modifiedTime, not createdTime: a take filmed last week and moved into
       Raw today was created last week. Measured 2026-09-24 — see listNewVideos. */
    assert.match(url, /modifiedTime > '2026-09-23T09:00:00.000Z'/);
  });

  test("no folder id means no call at all", async () => {
    const impl = fakeFetch({});
    const res = await listNewVideos({ env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(impl.calls.length, 0);
  });
});

describe("the real picture size", () => {
  test("width and height come off the file, not off a form", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: {
      id: "b", name: "VID_2.mp4",
      videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "102000" }
    } }] });
    const res = await getFileMeta("b", { env: envWith(), fetchImpl: impl });
    assert.equal(res.width, 1080);
    assert.equal(res.height, 1920);
    assert.equal(res.durationSeconds, 102);
  });
});

describe("folders", () => {
  test("an existing folder is reused — a second pass must not make a second 043", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: { files: [{ id: "f043", name: "043" }] } }] });
    const res = await ensureFolder({ parentId: "paul", name: "043", env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, true);
    assert.equal(res.folderId, "f043");
    assert.equal(res.created, false);
    assert.equal(impl.drive().length, 1, "it created a folder that already existed");
  });

  test("a missing folder is made once", async () => {
    const impl = fakeFetch({ responses: [
      { status: 200, body: { files: [] } },
      { status: 200, body: { id: "new043", name: "043" } }
    ] });
    const res = await ensureFolder({ parentId: "paul", name: "043", env: envWith(), fetchImpl: impl });
    assert.equal(res.created, true);
    assert.equal(res.folderId, "new043");
    assert.equal(JSON.parse(impl.drive()[1].init.body).mimeType, FOLDER_MIME);
  });
});

describe("the brief", () => {
  test("it goes up as multipart, with a boundary the text cannot contain", async () => {
    const impl = fakeFetch({ responses: [{ status: 200, body: { id: "brief1", name: "043_brief.txt" } }] });
    const res = await uploadTextFile({
      parentId: "f043", name: "043_brief.txt",
      content: "Ad number: 43\nLanding link: https://fundhub.ai/?utm_content=43",
      env: envWith(), fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(res.fileId, "brief1");
    const call = impl.drive()[0];
    assert.match(call.init.headers["Content-Type"], /multipart\/related; boundary=/);
    const boundary = call.init.headers["Content-Type"].split("boundary=")[1];
    assert.equal(call.init.body.split(boundary).length - 1, 3, "the boundary must appear exactly three times");
  });

  test("anything big enough to be media is refused before a byte moves", async () => {
    const impl = fakeFetch({});
    const res = await uploadTextFile({
      parentId: "f", name: "big.bin", content: "x".repeat(MAX_TEXT_UPLOAD_BYTES + 1),
      env: envWith(), fetchImpl: impl
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /carries text, not media/);
    assert.equal(impl.calls.length, 0);
  });
});

/* ── THE GAP THAT USED TO BE HERE IS CLOSED ─────────────────────────────────
   uploadVideo() refused until 2026-09-22, because the chokepoint read every
   response as text and an MP4 came back mangled. The fix was NOT a raw fetch
   in this file — that is the hole src/lib/no-unfenced-transmit.test.mjs
   exists to stop. The missing half was built inside the chokepoint instead
   (transmitBinary / postBinaryTo), so the bytes move with a fence, a size cap
   and a long clock. These tests are what that now buys. */

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

/* A fetch stand-in that can answer BYTES as well as JSON, and that can carry
   response headers — the resumable upload's session URL arrives in `location`
   and nowhere else. */
function binaryFetch({ scope = DRIVE_WRITE_SCOPE, responses = [] } = {}) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const body = { access_token: "at-test", expires_in: 3600, token_type: "Bearer", scope };
      return { ok: true, status: 200, headers: { forEach() {} }, text: async () => JSON.stringify(body) };
    }
    const next = queue.length > 1 ? queue.shift() : (queue[0] || {});
    const { status = 200, body = {}, bytes = null, headers = {} } = next;
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const res = {
      ok: status >= 200 && status < 300, status,
      headers: { forEach(fn) { for (const [k, v] of Object.entries(lower)) fn(v, k); } },
      text: async () => (typeof body === "string" ? body : JSON.stringify(body))
    };
    if (bytes) {
      let done = false;
      res.body = { getReader: () => ({
        read: async () => (done ? { done: true } : (done = true, { done: false, value: bytes })),
        cancel: async () => { done = true; }
      }) };
    }
    return res;
  };
  impl.calls = calls;
  impl.drive = () => calls.filter((c) => !c.url.includes("oauth2.googleapis.com"));
  return impl;
}

describe("reading a take out of Drive", () => {
  test("the bytes come back whole, with our own token and no public link", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: MP4, headers: { "content-type": "video/mp4" } }] });
    const res = await downloadFile("drv1", { env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, true);
    assert.deepEqual([...res.bytes], [...MP4]);
    assert.equal(res.contentType, "video/mp4");
    const call = impl.drive()[0];
    assert.match(call.url, /alt=media/);
    assert.match(call.init.headers.authorization, /^Bearer /,
      "authenticated, which is why there is no virus-scan page and no size threshold");
  });

  test("a file still uploading from the phone is a RETRY, not a paid minute", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: new Uint8Array(0) }] });
    const res = await downloadFile("drv1", { env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
    assert.match(res.error, /empty file/);
  });

  test("a take bigger than the cap is refused before the body is pulled", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: MP4, headers: { "content-length": "999999999" } }] });
    const res = await downloadFile("drv1", { env: envWith(), fetchImpl: impl, maxBytes: 1000 });
    assert.equal(res.ok, false);
    assert.match(res.error, /over the 1000-byte cap/);
  });

  test("the fence holds a download as firmly as it holds a write", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: MP4 }] });
    const res = await downloadFile("drv1", { env: { GOOGLE_DRIVE_OAUTH_TOKEN_JSON: tokenJson }, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
    assert.equal(impl.drive().length, 0);
  });

  test("no file id means no call", async () => {
    const impl = binaryFetch({});
    const res = await downloadFile("", { env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(impl.calls.length, 0);
  });
});

describe("THE PROVIDER CANNOT SHARE A FILE WITH ANYONE", () => {
  /* shareAnyoneWithLink() used to live here: one POST that added
     `{ role: "reader", type: "anyone" }` to a take so Submagic could fetch it
     from a plain URL. Nothing ever took that permission back off, and Google
     grants no expiry on an `anyone` permission, so a take handed over for one
     edit stayed readable by anyone holding its id for the life of the file.

     It was deleted on 2026-09-22 with its only caller, the `link` staging mode.
     Submagic's own documented route takes the bytes directly, so no public link
     is needed by anybody.

     These two assertions are the guard. The first stops the export coming back.
     The second stops the same POST being written under a different name. */
  test("the share function is gone, not merely unused", async () => {
    const mod = await import("./google-drive-write.mjs");
    assert.equal(mod.shareAnyoneWithLink, undefined);
    assert.equal(mod.default.shareAnyoneWithLink, undefined);
  });

  test("nothing in this provider asks Google for an `anyone` permission", () => {
    const src = fs.readFileSync(path.join(HERE, "google-drive-write.mjs"), "utf8");
    /* Comments stripped, so the note explaining WHY this is gone does not itself
       trip the check that it is gone. */
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/type:\s*["']anyone["']/.test(body), false,
      "publishing an owner file to the whole internet is a decision, not a helper");
    assert.equal(/\/permissions/.test(body), false,
      "this provider has no business writing Drive permissions at all");
  });
});

describe("putting the finished ad in Paul's folder", () => {
  const session = "https://upload.test/session/abc";

  test("it downloads the render, opens a session, then PUTs the bytes", async () => {
    const impl = binaryFetch({ responses: [
      { status: 200, bytes: MP4, headers: { "content-type": "video/mp4" } },   // the render
      { status: 200, body: {}, headers: { location: session } },                // session opened
      { status: 200, body: { id: "final1", name: "043_t02_final_v1.mp4" } }     // bytes accepted
    ] });
    const res = await uploadVideo({
      parentId: "f043", name: "043_t02_final_v1.mp4", sourceUrl: "https://cdn.test/o.mp4",
      env: envWith(), fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(res.fileId, "final1");
    assert.equal(res.byteLength, MP4.byteLength);

    const calls = impl.drive();
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://cdn.test/o.mp4");
    assert.equal(calls[0].init.headers, undefined,
      "our Drive token must never be attached to a third-party host");
    assert.match(calls[1].url, /uploadType=resumable/);
    assert.equal(calls[2].url, session);
    assert.equal(calls[2].init.method, "PUT");
    assert.deepEqual([...calls[2].init.body], [...MP4]);
  });

  test("bytes already in hand skip the download entirely", async () => {
    const impl = binaryFetch({ responses: [
      { status: 200, body: {}, headers: { location: session } },
      { status: 200, body: { id: "final2" } }
    ] });
    const res = await uploadVideo({
      parentId: "f043", name: "n.mp4", bytes: MP4, env: envWith(), fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(impl.drive().length, 2);
  });

  test("a session with no location header is reported, not guessed at", async () => {
    const impl = binaryFetch({ responses: [
      { status: 200, body: {}, headers: {} },
      { status: 200, body: { id: "never" } }
    ] });
    const res = await uploadVideo({ parentId: "f", name: "n.mp4", bytes: MP4, env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.match(res.error, /no location header/);
    assert.equal(impl.drive().length, 1, "nothing was uploaded to a URL we did not get");
  });

  test("a render bigger than the cap never reaches Drive", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: MP4, headers: { "content-length": "999999999" } }] });
    const res = await uploadVideo({
      parentId: "f", name: "n.mp4", sourceUrl: "https://cdn.test/o.mp4",
      env: envWith(), fetchImpl: impl, maxBytes: 100
    });
    assert.equal(res.ok, false);
    assert.equal(impl.drive().length, 1, "it stopped at the download and never opened an upload session");
  });

  test("neither bytes nor a link is a refusal, with no call at all", async () => {
    const impl = binaryFetch({});
    const res = await uploadVideo({ parentId: "f", name: "n.mp4", env: envWith(), fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, false);
    assert.match(res.error, /bytes or an http\(s\) sourceUrl/);
    assert.equal(impl.calls.length, 0);
  });

  test("the fence holds the whole thing", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, bytes: MP4 }] });
    const res = await uploadVideo({
      parentId: "f", name: "n.mp4", sourceUrl: "https://cdn.test/o.mp4",
      env: { GOOGLE_DRIVE_OAUTH_TOKEN_JSON: tokenJson }, fetchImpl: impl
    });
    assert.equal(res.ok, false);
    assert.equal(impl.drive().length, 0);
  });

  test("the video cap is a memory ceiling, and it is a real number", () => {
    assert.equal(MAX_VIDEO_BYTES, 512 * 1024 * 1024);
    assert.ok(MAX_VIDEO_BYTES > MAX_TEXT_UPLOAD_BYTES * 50, "a take is not a brief");
  });
});

describe("a filmed take, one original piece at a time", () => {
  const session = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";
  const folder = "13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";
  const clip = new Uint8Array([0, 1, 2, 255, 10, 20, 30, 40]);

  test("the session is opened in the SLO Ads folder and no video bytes move yet", async () => {
    const impl = binaryFetch({ responses: [
      { status: 200, body: {}, headers: { location: session } }
    ] });
    const res = await openVideoSession({
      parentId: folder,
      name: "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4",
      totalBytes: 800,
      contentType: "video/mp4",
      env: envWith(),
      fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(res.sessionUrl, session);
    const call = impl.drive()[0];
    assert.match(call.url, /uploadType=resumable/);
    const meta = JSON.parse(call.init.body);
    assert.deepEqual(meta.parents, [folder]);
    assert.equal(meta.name, "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4");
    assert.equal(call.init.headers["X-Upload-Content-Length"], "800");
    assert.equal(impl.drive().length, 1);
  });

  test("the piece that leaves is the piece that was handed in", async () => {
    const impl = binaryFetch({ responses: [
      { status: 200, body: { id: "drv-take", name: "Take.mp4" } }
    ] });
    const res = await putVideoChunk({
      sessionUrl: session,
      bytes: clip,
      start: 0,
      end: clip.byteLength - 1,
      total: clip.byteLength,
      contentType: "video/mp4",
      env: envWith(),
      fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(res.done, true);
    assert.equal(res.fileId, "drv-take");
    const call = impl.drive()[0];
    assert.equal(call.init.method, "PUT");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.url, session);
    assert.deepEqual([...call.init.body], [...clip]);
    assert.equal(call.init.headers["content-range"], `bytes 0-${clip.byteLength - 1}/${clip.byteLength}`);
  });

  test("308 means Drive has that piece and the file is not finished", async () => {
    const impl = binaryFetch({ responses: [
      { status: 308, body: "", headers: { range: "bytes=0-7" } }
    ] });
    const res = await putVideoChunk({
      sessionUrl: session,
      bytes: clip,
      start: 0,
      end: 7,
      total: 16,
      env: envWith(),
      fetchImpl: impl
    });
    assert.equal(res.ok, true);
    assert.equal(res.done, false);
    assert.equal(res.received, 8);
  });

  test("a session URL that is not Drive is refused before any call", async () => {
    const impl = binaryFetch({});
    const res = await putVideoChunk({
      sessionUrl: "https://evil.example/upload",
      bytes: clip,
      start: 0,
      end: 7,
      total: 8,
      env: envWith(),
      fetchImpl: impl
    });
    assert.equal(res.ok, false);
    assert.equal(impl.calls.length, 0);
  });

  test("the fence holds the session open", async () => {
    const impl = binaryFetch({ responses: [{ status: 200, body: {}, headers: { location: session } }] });
    const res = await openVideoSession({
      parentId: folder, name: "Take.mp4", totalBytes: 8,
      env: { GOOGLE_DRIVE_OAUTH_TOKEN_JSON: tokenJson }, fetchImpl: impl
    });
    assert.equal(res.ok, false);
    assert.equal(impl.drive().length, 0);
  });
});

describe("the posture of this file", () => {
  test("it ships unrouted", () => {
    assert.equal(PROVIDER, "google_drive_write");
    assert.equal(ENABLED, false);
    assert.equal(TRANSMITS, true);
  });

  test("it is NOT in the provider registry", () => {
    const index = fs.readFileSync(path.join(HERE, "index.mjs"), "utf8");
    assert.ok(!/google-drive-write|google_drive_write/.test(index));
  });

  test("the read-only client next door is still read-only", () => {
    const src = fs.readFileSync(path.join(HERE, "../../company-brain/drive-client.mjs"), "utf8");
    assert.match(src.slice(0, 200), /never writes, deletes, or moves/,
      "the write side lives here; if that header ever changes, the split has been undone");
  });
});
