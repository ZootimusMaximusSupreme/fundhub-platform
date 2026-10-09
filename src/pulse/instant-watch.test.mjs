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
  assert.equal(result.failures.length, 4);
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

test("a dead database still texts: it is one red row, not a crash", async () => {
  const sent = [];
  const deadDb = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
  const result = await runInstantWatch({
    db: deadDb,
    env: { PULSE_SMS_TO: "+16025551234" },
    now: new Date("2026-10-09T13:02:00Z"),
    fetchImpl: async () => ({ status: 503, text: "down" }),
    sendImpl: async (msg) => {
      sent.push(msg.body);
      return { ok: true, status: "sent" };
    }
  });
  assert.ok(result.failures.some((f) => f.id === "db"), "the dead database is a red row");
  assert.equal(result.sms.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /database could not be read/);
});

test("with the database down it texts at most twice an hour (first 5 minutes of each half hour)", async () => {
  const deadDb = { query: async () => { throw new Error("down"); } };
  const runAt = async (iso) => {
    const sent = [];
    await runInstantWatch({
      db: deadDb,
      env: { PULSE_SMS_TO: "+16025551234" },
      now: new Date(iso),
      fetchImpl: async () => ({ status: 200, text: "Sign in password Generate Apps Apply door" }),
      sendImpl: async (msg) => { sent.push(msg.body); return { ok: true, status: "sent" }; }
    });
    return sent.length;
  };
  assert.equal(await runAt("2026-10-09T13:00:00Z"), 1);
  assert.equal(await runAt("2026-10-09T13:10:00Z"), 0);
  assert.equal(await runAt("2026-10-09T13:31:00Z"), 1);
  assert.equal(await runAt("2026-10-09T13:45:00Z"), 0);
});
