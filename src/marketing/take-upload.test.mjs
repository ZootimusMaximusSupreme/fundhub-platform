// Save the original bytes in the proper offer's Drive folder, no live write.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SLO_ADS_FOLDER_ID, DIRECT_BOOK_ADS_FOLDER_ID, TAKE_CHUNK_BYTES,
  takeUploadName, takeFolderForName, offerWordForKey, offerKeyForName, resolveVideoFolder, MARKETING_VIDEO_PARENT_ID, chunkOk, parseContentRange,
  sealTakeToken, openTakeToken, beginTake, continueTake
} from "./take-upload.mjs";
import * as takeUpload from "./take-upload.mjs";
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

  test("future registered offers get their own folders, never silently SLO", async () => {
    const offer = "capital_blueprint";
    const title = offerWordForKey(offer);
    assert.ok(title && title.length);
    const name = title + " Ad 1 — Build your funding plan Take 1.mp4";
    assert.equal(offerKeyForName(name, offer), offer);
    assert.equal(offerKeyForName(name, "funding_dfy"), null);
    const asks = [];
    const got = await resolveVideoFolder(name, offer, {
      ensureFolder: async (request) => {
        asks.push(request);
        return { ok: true, folderId: "new-offer-folder" };
      },
    });
    assert.deepEqual(got, { offerKey: offer, folderId: "new-offer-folder" });
    assert.equal(asks.length, 1);
    assert.equal(asks[0].parentId, MARKETING_VIDEO_PARENT_ID);
    assert.equal(asks[0].name, title + " Ads");
    assert.equal(await resolveVideoFolder("Fake Ad 1 — No Take 1.mp4", "made_up_offer", {
      ensureFolder: () => assert.fail("unknown offer must not create folders")
    }), null);
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

describe("take capture diagnostics", () => {
  const prefix = "FundHub recording diagnostics v1\n";

  test("formats bounded measured fields and strips unknown strings and identifiers", () => {
    const description = takeUpload.takeCaptureDescription({
      elapsed_ms: 2500, camera_frames: 147, copied_frames: 140, missed_callbacks: 7,
      camera_longest_gap_ms: 54, copied_longest_gap_ms: 60, copy_total_ms: 174,
      copy_longest_ms: 18, has_video_callbacks: true,
      has_frame_requests: true, frame_requests: 140, frame_request_failures: 0,
      canvas_width: 1080, canvas_height: 1920, target_fps: 60,
      start_width: 1080, start_height: 1920, start_frame_rate: 60, start_frame_rate_max: 60,
      start_preview_width: 1080, start_preview_height: 1920, start_facing: "user",
      end_width: 1080, end_height: 1920, end_frame_rate: 30, end_frame_rate_max: 60,
      end_preview_width: 1080, end_preview_height: 1920, end_facing: "environment",
      lens_changes: 1,
      deviceId: "private-camera-id", token: "secret", extra: "do not send"
    });
    assert.ok(description.startsWith(prefix));
    assert.ok(description.length < 4096);
    const data = JSON.parse(description.slice(prefix.length));
    assert.equal(data.elapsed_ms, 2500);
    assert.equal(data.camera_frames, 147);
    assert.equal(data.copied_frames, 140);
    assert.equal(data.copy_total_ms, 174);
    assert.equal(data.copy_longest_ms, 18);
    assert.equal(data.has_video_callbacks, true);
    assert.equal(data.has_frame_requests, true);
    assert.equal(data.frame_requests, 140);
    assert.equal(data.frame_request_failures, 0);
    assert.equal(data.start_frame_rate, 60);
    assert.equal(data.end_frame_rate, 30);
    assert.equal(data.start_frame_rate_max, 60);
    assert.equal(data.end_frame_rate_max, 60);
    assert.equal(data.start_facing, "user");
    assert.equal(data.end_facing, "environment");
    assert.equal(data.lens_changes, 1);
    assert.equal(data.deviceId, undefined);
    assert.equal(data.token, undefined);
    assert.equal(data.extra, undefined);
  });

  test("omits bad metrics and refuses a missing or invalid elapsed time", () => {
    assert.equal(takeUpload.takeCaptureDescription({ camera_frames: 1 }), "");
    assert.equal(takeUpload.takeCaptureDescription({ elapsed_ms: -1 }), "");
    assert.equal(takeUpload.takeCaptureDescription({ elapsed_ms: Number.POSITIVE_INFINITY }), "");
    const description = takeUpload.takeCaptureDescription({
      elapsed_ms: 2500, camera_frames: -1, copied_frames: Number.POSITIVE_INFINITY,
      missed_callbacks: 1e100, target_fps: "60", start_frame_rate: Number.NaN,
      start_frame_rate_max: 241, end_frame_rate_max: -1,
      copy_total_ms: 10000001, copy_longest_ms: -1,
      camera_longest_gap_ms: -12, lens_changes: 1e100,
      has_frame_requests: "true", frame_requests: -1, frame_request_failures: 1e100,
      start_facing: "private-camera-id", end_facing: "environment"
    });
    const data = JSON.parse(description.slice(prefix.length));
    assert.equal(data.elapsed_ms, 2500);
    for (const field of ["camera_frames", "copied_frames", "copy_total_ms", "copy_longest_ms", "missed_callbacks", "target_fps", "start_frame_rate", "start_frame_rate_max", "end_frame_rate_max", "camera_longest_gap_ms", "lens_changes", "has_frame_requests", "frame_requests", "frame_request_failures", "start_facing"]) {
      assert.equal(data[field], undefined, field);
    }
    assert.equal(data.end_facing, "environment");
  });

  test("records only known canvas paths so GPU and 2D takes can be compared", () => {
    for (const mode of ["webgl", "2d"]) {
      const data = JSON.parse(takeUpload.takeCaptureDescription({ elapsed_ms: 1000, capture_mode: mode }).slice(prefix.length));
      assert.equal(data.capture_mode, mode);
    }
    const data = JSON.parse(takeUpload.takeCaptureDescription({ elapsed_ms: 1000, capture_mode: "private-device-id" }).slice(prefix.length));
    assert.equal(data.capture_mode, undefined);
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
    assert.equal(calls[0].description, undefined, "older takes without diagnostics still upload");
  });

  test("a take starts Drive upload with its sanitized diagnostics description", async () => {
    const out = res();
    const calls = [];
    await handler({
      method: "POST", headers: {},
      body: { name: NAME, bytes: 16, diagnostics: {
        elapsed_ms: 2500, camera_frames: 147, copied_frames: 140,
        start_frame_rate: 60, start_frame_rate_max: 60, end_frame_rate_max: 60,
        copy_total_ms: 174, copy_longest_ms: 18,
        target_fps: 60, deviceId: "private-camera-id"
      } }
    }, out, {
      filmSecret: SECRET,
      openVideoSession: async (arg) => { calls.push(arg); return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].description.startsWith("FundHub recording diagnostics v1\n"));
    assert.match(calls[0].description, /"camera_frames":147/);
    assert.match(calls[0].description, /"start_frame_rate_max":60/);
    assert.match(calls[0].description, /"end_frame_rate_max":60/);
    assert.match(calls[0].description, /"copy_total_ms":174/);
    assert.match(calls[0].description, /"copy_longest_ms":18/);
    assert.doesNotMatch(calls[0].description, /deviceId|private-camera-id/);
  });

  test("invalid diagnostics never block an otherwise valid video upload", async () => {
    const out = res();
    const calls = [];
    await handler({
      method: "POST", headers: {},
      body: { name: NAME, bytes: 16, diagnostics: { elapsed_ms: -1, token: "secret" } }
    }, out, {
      filmSecret: SECRET,
      openVideoSession: async (arg) => { calls.push(arg); return { ok: true, sessionUrl: SESSION }; }
    });
    assert.equal(out.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].description, undefined);
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
