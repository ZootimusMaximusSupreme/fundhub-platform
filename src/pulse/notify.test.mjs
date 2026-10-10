import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_SMS_TO_ENV,
  CHRIS_PULSE_SMS_ENV,
  DARWIN_WHATSAPP_ENV,
  chrisPulseSmsTo,
  darwinWhatsAppNumber,
  formatChrisSms,
  formatDarwinTicket,
  textChris,
  ticketDarwin
} from "./notify.mjs";

const FAKE_PULSE_SMS = "+15555550123";

test("Chris SMS dest comes from env and the body names no credit outcome", () => {
  const body = formatChrisSms({
    date: "2026-08-25",
    pass: 4,
    fail: 1,
    skip: 1,
    topFails: ["gate-relay: no heartbeat.json"]
  });
  assert.match(body, /2026-08-25/);
  assert.match(body, /4 passed/);
  assert.match(body, /1 failed/);
  assert.match(body, /gate-relay/);
  assert.match(body, /did not change any product code/);
  assert.doesNotMatch(body, /approved|score|FICO|credit/i);
  assert.equal(chrisPulseSmsTo({}), null);
  assert.equal(chrisPulseSmsTo({ [PULSE_SMS_TO_ENV]: "   " }), null);
  assert.equal(chrisPulseSmsTo({ [PULSE_SMS_TO_ENV]: FAKE_PULSE_SMS }), FAKE_PULSE_SMS);
  assert.equal(chrisPulseSmsTo({ [CHRIS_PULSE_SMS_ENV]: FAKE_PULSE_SMS }), FAKE_PULSE_SMS);
});

test("Chris SMS is skipped until PULSE_SMS_TO is set — no number is invented", async () => {
  const calls = [];
  const out = await textChris({
    date: "2026-08-25",
    pass: 1,
    fail: 0,
    env: {},
    dryRun: false,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.sent, false);
  assert.match(out.reason, /PULSE_SMS_TO unset/);
  assert.equal(out.to, null);
  assert.equal(calls.length, 0);
});

test("Darwin WhatsApp is skipped until DARWIN_WHATSAPP is set — no number is invented", async () => {
  assert.equal(darwinWhatsAppNumber({}), null);
  assert.equal(darwinWhatsAppNumber({ [DARWIN_WHATSAPP_ENV]: "   " }), null);
  const calls = [];
  const out = await ticketDarwin({
    date: "2026-08-25",
    findings: ["health: down"],
    suggestedFixes: ["Read /api/health?strict=1"],
    env: {},
    dryRun: false,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.sent, false);
  assert.match(out.reason, /DARWIN_WHATSAPP unset/);
  assert.equal(out.to, null);
  assert.equal(calls.length, 0);
  assert.match(out.ticket, /Audit only/);
  assert.match(out.ticket, /health: down/);
});

test("dry-run never sends Chris or Darwin", async () => {
  const boom = async () => {
    throw new Error("send must not run in dry-run");
  };
  const sms = await textChris({
    date: "2026-08-25",
    pass: 1,
    fail: 0,
    env: { [PULSE_SMS_TO_ENV]: FAKE_PULSE_SMS, [DARWIN_WHATSAPP_ENV]: "+15555550100" },
    dryRun: true,
    sendImpl: boom
  });
  const darwin = await ticketDarwin({
    date: "2026-08-25",
    findings: [],
    env: { [DARWIN_WHATSAPP_ENV]: "+15555550100" },
    dryRun: true,
    sendImpl: boom
  });
  assert.equal(sms.sent, false);
  assert.equal(sms.reason, "dry_run");
  assert.equal(sms.to, FAKE_PULSE_SMS);
  assert.equal(darwin.sent, false);
  assert.equal(darwin.reason, "dry_run");
  assert.equal(darwin.to, "+15555550100");
});

test("Darwin ticket lists FAIL rows and suggested fixes", () => {
  const ticket = formatDarwinTicket({
    date: "2026-08-25",
    findings: ["login: 500"],
    suggestedFixes: ["Restore /login.html"]
  });
  assert.match(ticket, /Fundhub pulse ticket 2026-08-25/);
  assert.match(ticket, /1\. login: 500/);
  assert.match(ticket, /1\. Restore \/login.html/);
  assert.match(ticket, /No auto-fix/);
});

/* Texting hours (owner law 2026-10-09, .claude/rules/texting-hours.md): both senders to Chris's number hold
   everything outside 6 a.m. to 10 p.m. Arizona time (UTC-7). */
test("texting hours: textMorningBrief and textChris hold at night and send in the window", async () => {
  const { textMorningBrief } = await import("./notify.mjs");
  const env = { [PULSE_SMS_TO_ENV]: FAKE_PULSE_SMS };
  const sends = [];
  const sendImpl = async (m) => { sends.push(m); return { status: "sent", providerMessageId: "SM1" }; };
  const cases = [
    ["2026-10-09T12:59:59Z", false], // 5:59:59 a.m.
    ["2026-10-09T13:00:00Z", true],  // 6:00:00 a.m.
    ["2026-10-10T04:59:59Z", true],  // 9:59:59 p.m.
    ["2026-10-10T05:00:00Z", false], // 10:00:00 p.m.
    ["2026-10-10T09:07:00Z", false]  // 2:07 a.m.
  ];
  for (const [iso, goes] of cases) {
    const before = sends.length;
    const brief = await textMorningBrief({ body: "x", env, dryRun: false, now: new Date(iso), sendImpl });
    assert.equal(brief.delivery_status, goes ? "sent" : "held_quiet_hours", `brief ${iso}`);
    assert.equal(brief.sent_to_last4, "0123", `brief ${iso}`);
    const chris = await textChris({ date: "2026-10-09", pass: 1, fail: 0, skip: 0, env, dryRun: false, now: new Date(iso), sendImpl });
    assert.equal(chris.sent, goes, `textChris ${iso}`);
    if (!goes) assert.equal(chris.reason, "held_quiet_hours");
    assert.equal(sends.length - before, goes ? 2 : 0, `sends ${iso}`);
  }
});
