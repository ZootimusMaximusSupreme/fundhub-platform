// Customer send hours (owner-set 2026-10-31): instant any hour, drips 9 a.m. to
// 5 p.m. Arizona, everything else unchanged. Arizona is UTC-7 all year, so
// 16:00Z is 9:00 a.m. there and 00:00Z is 5:00 p.m.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sendTiming, inDripWindow, nextDripWindowOpen, dripSendTime, nextHourStrike,
  INSTANT_TEMPLATE_KEYS, DRIP_TEMPLATE_KEYS
} from "./send-window.mjs";

const az = (iso) => new Date(iso);

describe("which kind of message a template is", () => {
  test("the welcome and the booking confirmation are instant", () => {
    for (const key of ["SMS-S00-WELCOME", "EMAIL-S00-WELCOME", "SMS-S04-01-CONFIRM", "EMAIL-S04-01-CONFIRM"]) {
      assert.equal(sendTiming(key), "instant", key);
    }
  });

  test("the follow-up sequences are drips", () => {
    for (const key of ["SMS-S02-RESUME-1", "EMAIL-S02-RESUME-3", "SMS-NOBOOK-01", "EMAIL-NOBOOK-03",
      "SMS-AISET03-MSG1", "SMS-AISET03-OPTIN-3", "SMS-S05A-NOSHOW-RECOVERY", "SMS-BS01-02-PRECALL"]) {
      assert.equal(sendTiming(key), "drip", key);
    }
  });

  test("call reminders and anything unlisted keep today's rules", () => {
    for (const key of ["SMS-S04-02-REMIND-24H", "SMS-S04-03-REMIND-2H", "E-01", "", null, undefined]) {
      assert.equal(sendTiming(key), "standard", String(key));
    }
  });

  test("no key is both instant and a drip", () => {
    for (const key of INSTANT_TEMPLATE_KEYS) assert.equal(DRIP_TEMPLATE_KEYS.has(key), false, key);
  });
});

describe("the 9 a.m. to 5 p.m. Arizona window", () => {
  test("opens at 9:00:00 and closes at 5:00:00 p.m.", () => {
    assert.equal(inDripWindow(az("2026-08-01T15:59:59Z")), false, "8:59:59 a.m.");
    assert.equal(inDripWindow(az("2026-08-01T16:00:00Z")), true, "9:00 a.m.");
    assert.equal(inDripWindow(az("2026-08-01T23:59:59Z")), true, "4:59:59 p.m.");
    assert.equal(inDripWindow(az("2026-08-02T00:00:00Z")), false, "5:00 p.m.");
  });

  test("a drip due before 9 a.m. waits for 9 a.m. the same day", () => {
    assert.equal(nextDripWindowOpen(az("2026-08-01T13:30:00Z")).toISOString(), "2026-08-01T16:00:00.000Z");
  });

  test("a drip due after 5 p.m. waits for 9 a.m. the next day", () => {
    assert.equal(nextDripWindowOpen(az("2026-08-02T01:30:00Z")).toISOString(), "2026-08-02T16:00:00.000Z");
  });

  test("a drip due at midnight on the last day of a month waits for the 1st", () => {
    assert.equal(nextDripWindowOpen(az("2026-11-01T06:59:00Z")).toISOString(), "2026-11-01T16:00:00.000Z");
    assert.equal(nextDripWindowOpen(az("2026-12-01T01:00:00Z")).toISOString(), "2026-12-01T16:00:00.000Z");
  });

  test("a drip is planned no later than 4:50 p.m., so the 4:55 sweep sends it before 5", () => {
    assert.equal(dripSendTime(az("2026-08-01T23:50:00Z")).toISOString(), "2026-08-01T23:50:00.000Z", "4:50 p.m. stays");
    assert.equal(dripSendTime(az("2026-08-01T23:50:59Z")).toISOString(), "2026-08-01T23:50:59.000Z", "4:50:59 p.m. stays: the 4:55 sweep sends it");
    assert.equal(dripSendTime(az("2026-08-01T23:51:00Z")).toISOString(), "2026-08-02T16:00:00.000Z", "4:51 p.m. waits for 9 a.m.");
    // Review of PR #346: 4:55:59 used to be kept, and the 5:00 sweep held it to 9 a.m. with no new check.
    assert.equal(dripSendTime(az("2026-08-01T23:55:59Z")).toISOString(), "2026-08-02T16:00:00.000Z", "4:55:59 p.m. waits for 9 a.m.");
  });

  test("dripSendTime keeps a time inside the window and moves one outside it", () => {
    const inside = az("2026-08-01T18:20:00Z");
    assert.equal(dripSendTime(inside).toISOString(), inside.toISOString());
    assert.equal(dripSendTime(az("2026-08-02T05:00:00Z")).toISOString(), "2026-08-02T16:00:00.000Z");
    assert.throws(() => dripSendTime("not a date"));
  });

  test("Arizona does not move its clocks: 9 a.m. is 16:00Z in winter too", () => {
    assert.equal(nextDripWindowOpen(az("2026-01-15T05:00:00Z")).toISOString(), "2026-01-15T16:00:00.000Z");
  });

  test("nextHourStrike follows daylight saving in a zone that has it", () => {
    // New York, the night clocks spring forward (2026-03-08): 8 a.m. is 12:00Z.
    assert.equal(nextHourStrike(az("2026-03-08T05:00:00Z"), "America/New_York", 8).toISOString(), "2026-03-08T12:00:00.000Z");
  });
});
