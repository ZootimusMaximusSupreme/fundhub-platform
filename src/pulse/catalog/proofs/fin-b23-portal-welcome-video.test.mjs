// Practice test (fake data, real page): the welcome video player on
// client-portal.html. It proves the rendered player uses the signed link the
// server returned, shows the returned title and length once the file loads, asks
// for a fresh link exactly once when the first one has expired, and says "not
// available" when no file ever loads. The video file is a one second sound file
// so the browser fires its real loadedmetadata and error events.
//
// The stand-in server for the link read is strict, like the real endpoint: a
// read with no sign-in is refused, and a staff member walking a client's portal
// who forgets the client id is handed some other client's video. So the fresh
// link read after an expiry only works when it carries the same sign-in and the
// same client id as the first read. Where a link has to lapse in the middle of
// a play, the test fires the same `error` event the browser raises when a seek
// meets a lapsed link, because a one second file never makes a second request.

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

/**
 * The media server: `good` names which links really serve a file, every other link answers 403 (expired).
 * ranges: true answers byte-range requests like real storage does, so the player can seek.
 */
function mediaServer(good, media, { ranges = false } = {}) {
  return (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname;
    if (!name.startsWith("/proof-media/")) return false;
    media.push(name);
    if (good.some((g) => name.endsWith(g))) {
      const asked = ranges && /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      if (asked) {
        const start = Number(asked[1]);
        const end = asked[2] ? Math.min(Number(asked[2]), SOUND.length - 1) : SOUND.length - 1;
        res.writeHead(206, { "content-type": "audio/wav", "content-range": `bytes ${start}-${end}/${SOUND.length}`, "content-length": end - start + 1, "accept-ranges": "bytes" });
        res.end(SOUND.subarray(start, end + 1));
        return true;
      }
      res.writeHead(200, { "content-type": "audio/wav", "content-length": SOUND.length, "accept-ranges": ranges ? "bytes" : "none" });
      res.end(SOUND);
    } else {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("link expired");
    }
    return true;
  };
}

const WRONG_CLIENT = { ok: true, video: { title: "Welcome for somebody else", duration_label: "9:59", stream: { url: "/proof-media/wrong-client.wav", expiresAt: 1, expiresAtIso: "2026-10-14T20:00:00Z" } } };

/**
 * The signed links the server hands out, in order.
 * strict: { clientId } - a read with no sign-in is refused (401), and a read that
 * does not name that client gets another client's video, as the real endpoint
 * would for a staff session with no client chosen.
 * answerFor(readNumber) - overrides the answer for one read (1 = the first).
 */
async function openPortal(open, { links, query = "", answer, strict = null, answerFor = null }) {
  const reads = [];
  const handlers = {
    "/api/content/welcome-video": async (route, { url }) => {
      const search = new URL(url).search;
      const auth = route.request().headers().authorization || "";
      reads.push({ url: search, auth });
      const n = reads.length;
      const link = links[Math.min(n - 1, links.length - 1)];
      if (answer) return json(route, answer);
      if (strict) {
        if (auth !== "Bearer e2e-token") return json(route, { ok: false, error: "unauthorized" }, 401);
        if (strict.clientId && search !== `?client_id=${strict.clientId}`) return json(route, WRONG_CLIENT);
      }
      const special = answerFor && answerFor(n);
      if (special) return json(route, special.body, special.status || 200);
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
  const { page, reads } = await openPortal(open, { links: ["/proof-media/expired.wav", "/proof-media/fresh.wav"], strict: {} });
  await waitFor(() => reads.length === 2, "the one fresh link read");
  assert.deepEqual(reads, [{ url: "", auth: "Bearer e2e-token" }, { url: "", auth: "Bearer e2e-token" }], "the fresh link is asked for with the same sign-in");
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

test("the fresh link is asked for with the same sign-in and for the same client the staff member is walking", { timeout: 60_000 }, async (t) => {
  const media = [];
  const { open } = await startPages(t, { serve: mediaServer(["cl-123-fresh.wav"], media) });
  // The server hands out an expired link first, then this client's fresh one; anyone
  // who does not name the client (or does not sign in) is NOT given that fresh link.
  const { page, reads } = await openPortal(open, {
    links: ["/proof-media/cl-123-expired.wav", "/proof-media/cl-123-fresh.wav"],
    query: "?id=cl-123",
    strict: { clientId: "cl-123" },
  });
  await waitFor(() => reads.length === 2, "the fresh link read");
  assert.deepEqual(reads, [
    { url: "?client_id=cl-123", auth: "Bearer e2e-token" },
    { url: "?client_id=cl-123", auth: "Bearer e2e-token" },
  ]);
  await page.waitForFunction(() => document.querySelector("#video-title")?.textContent === "Welcome from Dana at Fundhub");
  assert.equal(await page.locator("#player video.video-el").getAttribute("src"), "/proof-media/cl-123-fresh.wav");
  assert.equal(await page.locator("#vnow").innerText(), "3:15");
  assert.equal(media.includes("/proof-media/wrong-client.wav"), false, "another client's video is never fetched");
  assert.equal(await page.locator("#video-empty").isVisible(), false);
  await page.close();
});

test("a link that lapses later is replaced again, and the viewer keeps their place", { timeout: 90_000 }, async (t) => {
  const media = [];
  const { open } = await startPages(t, { serve: mediaServer(["second.wav", "third.wav"], media, { ranges: true }) });
  const { page, reads } = await openPortal(open, {
    links: ["/proof-media/first-lapsed.wav", "/proof-media/second.wav", "/proof-media/third.wav"],
    strict: {},
  });
  // First link is dead, the second one plays: that is the one retry, and it is now spent.
  await waitFor(() => reads.length === 2, "the first fresh link read");
  await page.waitForFunction(() => document.querySelector("#video-title")?.textContent === "Welcome from Dana at Fundhub");
  assert.equal(await page.locator("#player video.video-el").getAttribute("src"), "/proof-media/second.wav");

  // The viewer is half way in when the second link lapses too.
  await page.evaluate(() => { document.querySelector("#player video").currentTime = 0.5; });
  await page.waitForFunction(() => Math.abs(document.querySelector("#player video").currentTime - 0.5) < 0.05);
  await page.evaluate(() => document.querySelector("#player video").dispatchEvent(new Event("error")));

  // A good load gave the retry back, so there is one more fresh link, and it plays from the same place.
  await waitFor(() => reads.length === 3, "the second fresh link read (the retry was given back after a good load)");
  await page.waitForFunction(() => document.querySelector("#player video")?.getAttribute("src") === "/proof-media/third.wav");
  await page.waitForFunction(() => document.querySelector("#player video").readyState >= 1);
  const place = await page.evaluate(() => document.querySelector("#player video").currentTime);
  assert.ok(Math.abs(place - 0.5) < 0.1, `playback resumes where it was (0.5 s), got ${place}`);
  assert.equal(await page.locator("#video-empty").isVisible(), false);
  assert.equal(await page.locator("#player video.video-el").count(), 1);
  await page.close();
});

test("a video that already played stays on screen when no fresh link can be had", { timeout: 90_000 }, async (t) => {
  for (const [label, second] of [
    ["the server has no video to give", { body: { ok: true, video: null } }],
    ["the server refuses", { body: { ok: false, error: "forbidden" }, status: 403 }],
  ]) {
    const { open } = await startPages(t, { serve: mediaServer(["plays.wav"], []) });
    const { page, reads } = await openPortal(open, {
      links: ["/proof-media/plays.wav"],
      answerFor: (n) => (n === 2 ? second : null),
    });
    await page.waitForFunction(() => document.querySelector("#video-title")?.textContent === "Welcome from Dana at Fundhub");
    // The link lapses mid-play. The fresh read comes back empty or refused.
    await page.evaluate(() => document.querySelector("#player video").dispatchEvent(new Event("error")));
    await waitFor(() => reads.length === 2, `${label}: the fresh link read`);
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#player video.video-el").count(), 1, `${label}: the video that played is still there`);
    assert.equal(await page.locator("#video-empty").isVisible(), false, `${label}: it does not say not available`);
    assert.equal(reads.length, 2, `${label}: no loop`);
    await page.close();
  }
});
