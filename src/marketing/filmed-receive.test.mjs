// Original take bytes land in a folder. No re-encode. Nothing already there is deleted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import {
  cleanTakeName, takeNameFromRequest, commitOriginal, storeOriginalStream,
  startFilmedReceive, filmedDir, lanIPv4
} from "./filmed-receive.mjs";

const NAMED = "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "filmed-receive-"));
}

describe("cleanTakeName", () => {
  test("keeps the filmed name, including the em dash", () => {
    assert.equal(cleanTakeName(NAMED), NAMED);
    assert.equal(cleanTakeName("  Take 2.mov  "), "Take 2.mov");
  });

  test("refuses a path, a hidden name, and a file that is not a video", () => {
    assert.equal(cleanTakeName("../secret.mp4"), null);
    assert.equal(cleanTakeName("a/b.mp4"), null);
    assert.equal(cleanTakeName(".hidden.mp4"), null);
    assert.equal(cleanTakeName("notes.txt"), null);
    assert.equal(cleanTakeName(""), null);
  });
});

describe("takeNameFromRequest", () => {
  test("reads the PUT path and the POST header", () => {
    assert.equal(takeNameFromRequest("/takes/" + encodeURIComponent(NAMED)), NAMED);
    assert.equal(takeNameFromRequest("/takes", { "x-take-name": "Take 3.m4v" }), "Take 3.m4v");
    assert.equal(takeNameFromRequest("/takes/" + encodeURIComponent("../x.mp4")), null);
  });
});

describe("commitOriginal", () => {
  test("writes the original bytes and leaves an existing file alone", () => {
    const dir = tmpDir();
    const a = path.join(dir, "a.bin");
    const b = path.join(dir, "b.bin");
    fs.writeFileSync(a, Buffer.from("original-bytes-aaaa"));
    fs.writeFileSync(b, Buffer.from("different-bytes-bbbb"));

    const first = commitOriginal(dir, NAMED, a);
    assert.equal(first.duplicate, false);
    assert.equal(fs.readFileSync(path.join(dir, NAMED)).toString(), "original-bytes-aaaa");
    assert.equal(fs.existsSync(a), false);

    const again = commitOriginal(dir, NAMED, b);
    assert.equal(again.duplicate, true);
    assert.equal(fs.existsSync(b), false);
    assert.equal(fs.readdirSync(dir).length, 1);
    assert.equal(fs.readFileSync(path.join(dir, NAMED)).toString(), "original-bytes-aaaa");
  });
});

describe("the phone drop", () => {
  test("PUT stores the body byte for byte", async () => {
    const dir = tmpDir();
    const body = Buffer.from("ftyp-not-reencoded");
    const drop = await startFilmedReceive({ dir, port: 0, host: "127.0.0.1" });
    try {
      const status = await put(drop.port, "/takes/" + encodeURIComponent("Take 1.mp4"), body);
      assert.equal(status, 201);
      assert.deepEqual(fs.readFileSync(path.join(dir, "Take 1.mp4")), body);

      const again = await put(drop.port, "/takes/" + encodeURIComponent("Take 1.mp4"), body);
      assert.equal(again, 200);
      assert.equal(fs.readdirSync(dir).filter((f) => !f.startsWith(".")).length, 1);

      const ask = await options(drop.port, "/takes/" + encodeURIComponent("Take 1.mp4"));
      assert.equal(ask.status, 204);
      assert.equal(ask["access-control-allow-private-network"], "true");
      assert.equal(ask["access-control-allow-origin"], "*");
    } finally {
      await drop.close();
    }
  });

  test("POST with X-Take-Name stores the body", async () => {
    const dir = tmpDir();
    const stored = await storeOriginalStream(dir, "Take 4.mov", (async function* () {
      yield Buffer.from("mov-bytes");
    })());
    assert.equal(stored.name, "Take 4.mov");
    assert.equal(fs.readFileSync(path.join(dir, "Take 4.mov")).toString(), "mov-bytes");
  });
});

function options(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "OPTIONS", path: urlPath }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, ...res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function put(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, method: "PUT", path: urlPath,
      headers: { "content-length": body.length }
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("folder", () => {
  test("the folder is marketing/ads/filmed, same as the copy script", () => {
    const dir = filmedDir("/repo");
    assert.equal(dir, path.join("/repo", "marketing", "ads", "filmed"));
  });

  test("lan address skips the internal one", () => {
    assert.equal(lanIPv4({ lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] }), null);
    assert.equal(lanIPv4({
      en0: [{ family: "IPv4", internal: false, address: "10.0.0.8" }]
    }), "10.0.0.8");
  });
});
