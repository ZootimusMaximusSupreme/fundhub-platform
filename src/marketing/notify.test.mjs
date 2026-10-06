// Pure tests for src/marketing/notify.mjs: when a buzz may go out (quiet hours), and the
// guards that keep a text from ever leaving without an injected send(). The database half
// (one waiting per group, one per kind per 10 minutes, retries, give-up) is proved against
// real Postgres in src/http/marketing-buzzes.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nextSendTime, clockMinutes, buzzMessage, queueBuzz, sendDueBuzzes,
  BUZZ_TZ, DEFAULT_QUIET_START, DEFAULT_QUIET_END, KIND_GAP_MINUTES, MAX_SEND_ATTEMPTS
} from "./notify.mjs";

const iso = (d) => d.toISOString();

describe("nextSendTime — Arizona (UTC-7 all year), quiet 21:00-07:00", () => {
  test("defaults are the spec's: 21:00-07:00 America/Phoenix, 10-minute gap, 5 tries", () => {
    assert.equal(BUZZ_TZ, "America/Phoenix");
    assert.equal(DEFAULT_QUIET_START, "21:00");
    assert.equal(DEFAULT_QUIET_END, "07:00");
    assert.equal(KIND_GAP_MINUTES, 10);
    assert.equal(MAX_SEND_ATTEMPTS, 5);
  });

  test("late evening waits for 07:00 the next morning", () => {
    // 2026-10-04 23:30 Arizona = 2026-10-05 06:30 UTC
    const out = nextSendTime(new Date("2026-10-05T06:30:00Z"), "21:00", "07:00", "America/Phoenix");
    assert.equal(iso(out), "2026-10-05T14:00:00.000Z"); // 07:00 Arizona
  });

  test("21:00 exactly is quiet", () => {
    // 2026-10-05 21:00 Arizona = 2026-10-06 04:00 UTC
    assert.equal(iso(nextSendTime(new Date("2026-10-06T04:00:00Z"))), "2026-10-06T14:00:00.000Z");
  });

  test("the small hours wait for 07:00 the same morning", () => {
    // 03:00 Arizona = 10:00 UTC
    assert.equal(iso(nextSendTime(new Date("2026-10-05T10:00:00Z"))), "2026-10-05T14:00:00.000Z");
    // 06:59:59 Arizona
    assert.equal(iso(nextSendTime(new Date("2026-10-05T13:59:59Z"))), "2026-10-05T14:00:00.000Z");
  });

  test("07:00 exactly and the daytime go out now", () => {
    for (const t of ["2026-10-05T14:00:00.000Z", "2026-10-05T19:00:00.000Z", "2026-10-06T03:59:00.000Z"]) {
      assert.equal(iso(nextSendTime(new Date(t))), t, t);
    }
  });

  test("a month end rolls to the 1st", () => {
    // 2026-10-31 22:00 Arizona = 2026-11-01 05:00 UTC → 2026-11-01 07:00 Arizona
    assert.equal(iso(nextSendTime(new Date("2026-11-01T05:00:00Z"))), "2026-11-01T14:00:00.000Z");
  });

  test("Postgres time strings (HH:MM:SS) read the same", () => {
    assert.equal(iso(nextSendTime(new Date("2026-10-05T06:30:00Z"), "21:00:00", "07:00:00")), "2026-10-05T14:00:00.000Z");
  });

  test("a window that does not wrap midnight", () => {
    // 14:00 Arizona inside 13:00-15:00 → 15:00 Arizona (22:00 UTC)
    assert.equal(iso(nextSendTime(new Date("2026-10-05T21:00:00Z"), "13:00", "15:00")), "2026-10-05T22:00:00.000Z");
    // 16:00 Arizona is outside
    assert.equal(iso(nextSendTime(new Date("2026-10-05T23:00:00Z"), "13:00", "15:00")), "2026-10-05T23:00:00.000Z");
  });

  test("start equal to end means no quiet hours", () => {
    assert.equal(iso(nextSendTime(new Date("2026-10-05T06:30:00Z"), "00:00", "00:00")), "2026-10-05T06:30:00.000Z");
  });

  test("missing or unreadable times fall back to 21:00-07:00, never to no quiet hours", () => {
    for (const [s, e] of [[undefined, undefined], [null, null], ["", ""], ["bed time", "25:99"]]) {
      assert.equal(iso(nextSendTime(new Date("2026-10-05T06:30:00Z"), s, e)), "2026-10-05T14:00:00.000Z", `${s}/${e}`);
    }
  });

  test("an unknown zone falls back to Arizona", () => {
    assert.equal(iso(nextSendTime(new Date("2026-10-05T06:30:00Z"), "21:00", "07:00", "Mars/Olympus")), "2026-10-05T14:00:00.000Z");
  });

  test("a daylight-time zone lands on the right hour across the change", () => {
    // Denver, 2026-10-31 23:00 MDT (UTC-6) = 2026-11-01 05:00 UTC. Clocks fall back at 02:00,
    // so 07:00 that morning is MST (UTC-7) = 14:00 UTC.
    assert.equal(iso(nextSendTime(new Date("2026-11-01T05:00:00Z"), "21:00", "07:00", "America/Denver")), "2026-11-01T14:00:00.000Z");
    // Summer: 2026-07-01 23:00 MDT = 2026-07-02 05:00 UTC → 07:00 MDT = 13:00 UTC
    assert.equal(iso(nextSendTime(new Date("2026-07-02T05:00:00Z"), "21:00", "07:00", "America/Denver")), "2026-07-02T13:00:00.000Z");
  });

  test("does not change the time it was given", () => {
    const now = new Date("2026-10-05T06:30:00Z");
    nextSendTime(now);
    assert.equal(iso(now), "2026-10-05T06:30:00.000Z");
  });
});

describe("clockMinutes", () => {
  test("reads HH:MM and HH:MM:SS, refuses nonsense", () => {
    assert.equal(clockMinutes("07:00"), 420);
    assert.equal(clockMinutes("21:00:00"), 1260);
    assert.equal(clockMinutes("7:05"), 425);
    assert.equal(clockMinutes("24:00"), null);
    assert.equal(clockMinutes("12:60"), null);
    assert.equal(clockMinutes("noon"), null);
    assert.equal(clockMinutes(null), null);
  });
});

describe("buzzMessage", () => {
  test("is the notify-fanout shape; the text carries the title", () => {
    assert.deepEqual(buzzMessage({ id: "b1", body: "  18 of 21 scripts ready  " }), {
      id: "b1", notification: { title: "18 of 21 scripts ready", body: "18 of 21 scripts ready" }
    });
  });
});

describe("guards (no database touched)", () => {
  const noDb = { query: async () => { throw new Error("must not reach the database"); } };

  test("sendDueBuzzes refuses to run without an injected send()", async () => {
    await assert.rejects(sendDueBuzzes(noDb, {}), /pass send\(\)/);
    await assert.rejects(sendDueBuzzes(noDb, { send: "twilio" }), /pass send\(\)/);
  });

  test("queueBuzz refuses a buzz with no org, no kind or no words", async () => {
    await assert.rejects(queueBuzz(noDb, { kind: "scripts_ready", body: "x" }), /orgId/);
    await assert.rejects(queueBuzz(noDb, { orgId: "o", body: "x" }), /kind/);
    await assert.rejects(queueBuzz(noDb, { orgId: "o", kind: "scripts_ready", body: "   " }), /body/);
  });

  test("queueBuzz holds the row's send_after to the end of quiet hours", async () => {
    let params;
    const db = { query: async (_sql, p) => { params = p; return { rows: [{ id: "b1", send_after: p[4], created: true }] }; } };
    const out = await queueBuzz(db, {
      orgId: "o", kind: "scripts_ready", body: "Scripts ready", groupKey: " batch-1 ",
      quietStart: "21:00", quietEnd: "07:00", now: new Date("2026-10-05T06:30:00Z")
    });
    assert.deepEqual(params, ["o", "scripts_ready", "Scripts ready", "batch-1", "2026-10-05T14:00:00.000Z"]);
    assert.equal(out.created, true);
    assert.equal(Object.prototype.hasOwnProperty.call(out.buzz, "created"), false);
  });
});
