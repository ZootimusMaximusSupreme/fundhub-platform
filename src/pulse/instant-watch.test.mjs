import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInstantSms, runInstantWatch, recentInstantAlert } from "./instant-watch.mjs";

test("formatInstantSms names each failure", () => {
  const s = formatInstantSms([{ id: "health", detail: "strict health answered 503" }]);
  assert.match(s, /health:/);
  assert.match(s, /503/);
});

test("runInstantWatch texts on health FAIL when dest is set", async () => {
  const sent = [];
  const result = await runInstantWatch({
    db: null,
    env: { PULSE_SMS_TO: "+16025551234" },
    fetchImpl: async () => ({ status: 503, text: "down" }),
    sendImpl: async (msg) => {
      sent.push(msg.body);
      return { ok: true, status: "sent" };
    }
  });
  assert.equal(result.failures.length, 3);
  assert.equal(result.sms.sent, true);
  assert.ok(sent[0].includes("health:"));
});

test("recentInstantAlert respects cooldown row", async () => {
  let q = 0;
  const db = {
    query: async () => {
      q += 1;
      return { rows: q === 1 ? [{ x: 1 }] : [] };
    }
  };
  const yes = await recentInstantAlert(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fingerprint: "health,login",
    sinceMs: Date.now() - 3600000
  });
  assert.equal(yes, true);
});
