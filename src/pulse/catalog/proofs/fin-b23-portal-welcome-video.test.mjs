// Practice test (fake data, real page): the welcome video player on
// client-portal.html. It proves the rendered player uses the signed link the
// server returned, shows the returned title and length once the file loads, asks
// for a fresh link exactly once when the first one has expired, and says "not
// available" when no file ever loads. The video file is a one second sound file
// so the browser fires its real loadedmetadata and error events.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";

function wavSecond() {
  const rate = 8000;
  const data = Buffer.alloc(rate, 128);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const SOUND = wavSecond();
const TITLE = "Welcome from Dana at Fundhub";

/** The media server: `good` names which links really serve a file, every other link answers 403 (expired). */
function mediaServer(good, media) {
  return (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (!name.startsWith("/proof-media/")) return false;
    media.push(name);
    if (good.some((g) => name.endsWith(g))) {
      res.writeHead(200, { "content-type": "audio/wav", "content-length": SOUND.length, "accept-ranges": "none" });
      res.end(SOUND);
    } else {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("link expired");
    }
    return true;
  };
}

/** The signed links the server hands out, in order. */
async function openPortal(open, { links, query = "", answer }) {
  const reads = [];
  const handlers = {
    "/api/content/welcome-video": async (route, { url }) => {
      reads.push({ url: new URL(url).search, auth: route.request().headers().authorization || "" });
      const link = links[Math.min(reads.length - 1, links.length - 1)];
      if (answer) return json(route, answer);
      return json(route, { ok: true, video: { title: TITLE, duration_label: "3:15", stream: { url: link, expiresAt: 1, expiresAtIso: "2026-10-14T20:00:00Z" } } });
    },
  };
  const opened = await open(`/app/client-portal.html${query}`, { handlers });
  return { ...opened, reads };
}

test("the player uses the returned signed link and shows its title and length", { timeout: 60_000 }, async (t) => {
  const media = [];
  const { open } = await startPages(t, { serve: mediaServer(["first.wav"], media) });
  const { page, reads } = await openPortal(open, { links: ["/proof-media/first.wav"] });
  await page.waitForSelector("#player video.video-el", { state: "attached" });
  assert.equal(await page.locator("#player video.video-el").getAttribute("src"), "/proof-media/first.wav");
  await page.waitForFunction(() => document.querySelector("#video-title")?.textContent === "Welcome from Dana at Fundhub");
  assert.equal(await page.locator("#vnow").innerText(), "3:15");
  assert.equal(await page.locator("#video-empty").isVisible(), false, "the empty line is hidden once a link exists");
  assert.equal(reads.length, 1, "one read, no retry for a link that works");
  assert.equal(reads[0].auth, "Bearer e2e-token");
  await page.close();
});

test("an expired link is replaced exactly once and the new link plays", { timeout: 60_000 }, async (t) => {
  const media = [];
  const { open } = await startPages(t, { serve: mediaServer(["fresh.wav"], media) });
  const { page, reads } = await openPortal(open, { links: ["/proof-media/expired.wav", "/proof-media/fresh.wav"] });
  await waitFor(() => reads.length === 2, "the one fresh link read");
  await page.waitForFunction(() => document.querySelector("#video-title")?.textContent === "Welcome from Dana at Fundhub");
  assert.equal(await page.locator("#player video.video-el").getAttribute("src"), "/proof-media/fresh.wav");
  assert.deepEqual(media.filter((m, i) => media.indexOf(m) === i), ["/proof-media/expired.wav", "/proof-media/fresh.wav"]);
  await page.waitForTimeout(400);
  assert.equal(reads.length, 2, "a link that works afterwards asks for nothing more");
  await page.close();
});

test("when the fresh link fails too, it stops after one retry and says not available", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t, { serve: mediaServer([], []) });
  const { page, reads } = await openPortal(open, { links: ["/proof-media/bad-1.wav", "/proof-media/bad-2.wav"] });
  await page.waitForFunction(() => document.querySelector("#video-empty") && !document.querySelector("#video-empty").hidden);
  assert.equal(await page.locator("#video-empty").innerText(), "Welcome video is not available");
  assert.equal(await page.locator("#player video.video-el").count(), 0, "the dead player is removed");
  await page.waitForTimeout(600);
  assert.equal(reads.length, 2, "exactly one retry, never a loop");
  await page.close();
});

test("no video mapped leaves the honest empty line; staff walking a client pass that client's id", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, reads } = await openPortal(open, { links: [], query: "?id=cl-123", answer: { ok: true, video: null } });
  await waitFor(() => reads.length === 1, "the read");
  assert.equal(reads[0].url, "?client_id=cl-123");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#player video").count(), 0);
  assert.equal(await page.locator("#video-empty").innerText(), "Welcome video is not available");
  assert.equal(await page.locator("#video-empty").isVisible(), true);
  await page.close();
});
