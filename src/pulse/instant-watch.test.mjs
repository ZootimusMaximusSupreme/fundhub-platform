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
    now: new Date("2026-10-09T19:00:00Z"), // noon Arizona: inside texting hours
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

/* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). The 5-minute watch texts Chris's own
   number, so from 10 p.m. to 6 a.m. Arizona time it sends nothing AND writes no alert row: the cooldown reads
   those rows, and a row written at night would keep the first 6 a.m. run quiet. */
function watchDb() {
  const ORG_ID = "11111111-1111-4111-8111-111111111111";
  const rows = [];
  return {
    rows,
    query: async (sql, params) => {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: ORG_ID }] };
      if (/INSERT INTO agent_runs/.test(sql)) { rows.push({ created_at: Date.now(), detail: params[3], outcome: params[2] }); return { rows: [] }; }
      if (/FROM agent_runs/.test(sql)) {
        const like = String(params[3]).replace(/%/g, "");
        return { rows: rows.filter((r) => r.detail.includes(like)).map(() => ({ x: 1 })) };
      }
      return { rows: [{ n: 0 }] };
    }
  };
}
const downFetch = async () => ({ status: 503, text: "down" });
const watchAt = (db, iso, sent) => runInstantWatch({
  db, now: new Date(iso), env: { PULSE_SMS_TO: "+16025551234" }, fetchImpl: downFetch,
  sendImpl: async (msg) => { sent.push(msg.body); return { ok: true, status: "sent" }; }
});

test("texting hours: a door down at 2:07 a.m. sends nothing and records no alert; at 6:00 a.m. it texts at once", async () => {
  const db = watchDb();
  const sent = [];
  const night = await watchAt(db, "2026-10-10T09:07:00Z", sent);
  assert.equal(night.failures.length > 0, true);
  assert.equal(night.sms.sent, false);
  assert.equal(night.sms.reason, "held_quiet_hours");
  assert.equal(sent.length, 0, "no text at night");
  assert.equal(db.rows.length, 0, "no alert row at night, so the cooldown cannot swallow the 6 a.m. text");

  const six = await watchAt(db, "2026-10-10T13:00:00Z", sent);
  assert.equal(six.sms.sent, true, "the first run inside the window texts the still-down door");
  assert.equal(sent.length, 1);
  assert.equal(db.rows.length, 1);
});

test("texting hours: 9:59:59 p.m. texts, 10:00:00 p.m. is held, 5:59:59 a.m. is held", async () => {
  for (const [iso, want] of [["2026-10-10T04:59:59Z", true], ["2026-10-10T05:00:00Z", false], ["2026-10-10T12:59:59Z", false]]) {
    const sent = [];
    const out = await watchAt(null, iso, sent);
    assert.equal(out.sms.sent, want, iso);
    assert.equal(sent.length, want ? 1 : 0, iso);
  }
});
