/* The ad-video background worker is an OPEN URL that spends money.
 *
 * It lives at /.netlify/functions/ad-video-worker-background because only a
 * background function gets 15 minutes, and a background function is reached by
 * a request rather than a clock. That means the path is public. A pass of it
 * creates a Submagic project and bills API minutes.
 *
 * So the only thing between the open internet and Chris's Submagic bill is the
 * shared-secret check. These tests are that check's alarm. They never touch a
 * database: every refusal happens before sweep() is called.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { AUTH_HEADER } from "../../netlify/functions/ad-video-worker-background.mjs";

const source = readFileSync(new URL("../../netlify/functions/ad-video-worker-background.mjs", import.meta.url), "utf8");

const req = (value) => ({
  headers: { get: (name) => (name === AUTH_HEADER && value !== undefined ? value : null) }
});

describe("the ad-video worker refuses anyone without the secret", () => {
  test("uses only the modern default export, outside Lambda's 4 KB env trap", async () => {
    assert.doesNotMatch(source, /export\s+(const|let|var|async\s+function|function)\s+handler\b/);
    assert.doesNotMatch(source, /export\s*\{[^}]*\bhandler\b[^}]*\}/);
    const mod = await import("../../netlify/functions/ad-video-worker-background.mjs");
    assert.equal(typeof mod.default, "function");
    assert.equal(mod.handler, undefined);
  });

  test("no secret configured means the door is CLOSED, not open", async () => {
    const had = process.env.AD_VIDEO_WORKER_SECRET;
    delete process.env.AD_VIDEO_WORKER_SECRET;
    try {
      const res = await handler(req("anything"));
      assert.equal(res.status, 404,
        "a missing variable must never be what makes a paid endpoint public");
    } finally {
      if (had !== undefined) process.env.AD_VIDEO_WORKER_SECRET = had;
    }
  });

  test("a wrong secret is refused", async () => {
    const had = process.env.AD_VIDEO_WORKER_SECRET;
    process.env.AD_VIDEO_WORKER_SECRET = "right";
    try {
      const res = await handler(req("wrong"));
      assert.equal(res.status, 404);
    } finally {
      if (had === undefined) delete process.env.AD_VIDEO_WORKER_SECRET;
      else process.env.AD_VIDEO_WORKER_SECRET = had;
    }
  });

  test("no header at all is refused", async () => {
    const had = process.env.AD_VIDEO_WORKER_SECRET;
    process.env.AD_VIDEO_WORKER_SECRET = "right";
    try {
      const res = await handler({ headers: { get: () => null } });
      assert.equal(res.status, 404);
    } finally {
      if (had === undefined) delete process.env.AD_VIDEO_WORKER_SECRET;
      else process.env.AD_VIDEO_WORKER_SECRET = had;
    }
  });
});
