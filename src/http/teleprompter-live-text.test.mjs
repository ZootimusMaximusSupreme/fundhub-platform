// The teleprompter text goes to Chris's own phone, so it follows texting hours (owner law 2026-10-09,
// .claude/rules/texting-hours.md): outside 6 a.m. to 10 p.m. Arizona time it answers 202 held and sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

import handler from "../../netlify/functions/teleprompter-live-text.mjs";

const NONCE = "test-nonce-0123456789";

async function withNonce(fn) {
  const before = process.env.TELEPROMPTER_TEXT_NONCE;
  process.env.TELEPROMPTER_TEXT_NONCE = NONCE;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.TELEPROMPTER_TEXT_NONCE;
    else process.env.TELEPROMPTER_TEXT_NONCE = before;
  }
}

test("teleprompter text: at 2:07 a.m. Arizona it is held (202) and nothing reaches the network", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("no network in this test"); };
  try {
    const res = await withNonce(() => handler(
      new Request(`https://fundhub.ai/.netlify/functions/teleprompter-live-text?n=${NONCE}`, { method: "POST" }),
      { now: () => new Date("2026-10-10T09:07:00Z") }
    ));
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { status: "held_quiet_hours" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("teleprompter text: a GET or a wrong nonce is still 404, day or night", async () => {
  const night = { now: () => new Date("2026-10-10T09:07:00Z") };
  assert.equal((await handler(new Request("https://fundhub.ai/x", { method: "GET" }), night)).status, 404);
  const wrong = await withNonce(() => handler(new Request("https://fundhub.ai/x?n=nope", { method: "POST" }), night));
  assert.equal(wrong.status, 404);
});
