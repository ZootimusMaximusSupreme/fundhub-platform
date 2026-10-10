import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { smsBody } from "./notify-fanout.mjs";

/* The fan-out itself imports the real providers; those are fenced and refuse
   with MESSAGING_DRY_RUN unset, which is exactly what these tests rely on: a
   run here can never send anything. The shape is what is under test. */
/* Texting hours (src/pulse/quiet-hours.mjs): send() holds both roads outside 6 a.m. to 10 p.m. Arizona time.
   These tests are about the shape of a send inside the window, so each one hands in a clock at noon Arizona
   time; without it they would fail at night. The held case has its own tests at the bottom. */
const IN_WINDOW = new Date("2026-10-09T19:00:00Z");
const notification = {
  title: "084_t01 is ready",
  click: "https://video.example/final.mp4",
  actions: [{ label: "Approve", url: "https://fundhub.ai/a?token=x" }, { label: "Reject", url: "https://fundhub.ai/r?token=x" }]
};

describe("the text Chris gets", () => {
  test("carries the video and both decisions, one link per line", () => {
    const body = smsBody(notification);
    assert.match(body, /^084_t01 is ready\n/);
    assert.match(body, /\nWatch: https:\/\/video\.example\/final\.mp4\n/);
    assert.match(body, /\nApprove: https:\/\/fundhub\.ai\/a\?token=x\n/);
    assert.match(body, /\nReject: https:\/\/fundhub\.ai\/r\?token=x$/);
  });

  test("a notification with no links is still a readable sentence", () => {
    assert.equal(smsBody({ title: "Ad 84 is ready" }), "Ad 84 is ready");
  });
});

describe("the fan-out never throws and never sends from a test", async () => {
  const { send } = await import("./notify-fanout.mjs");
  test("with no number set, the text is skipped and said so", async () => {
    const res = await send({ id: "r1", notification }, { env: { NTFY_TOPIC: "" }, now: IN_WINDOW });
    assert.equal(res.channels.sms, false);
    assert.match(res.error || "", /no number set for a text/);
  });
});

describe("the pulse number reaches Twilio in the shape it wants", async () => {
  const { normalizeUsNumber, chrisPulseSmsTo } = await import("../pulse/notify.mjs");
  test("common ways a US number gets typed all become +1 and ten digits", () => {
    for (const v of ["6025551234", "602 555 1234", "(602) 555-1234", "1-602-555-1234", "16025551234", "+16025551234"]) {
      assert.equal(normalizeUsNumber(v), "+16025551234", v);
    }
  });
  test("an already-international number is left alone", () => {
    assert.equal(normalizeUsNumber("+447700900123"), "+447700900123");
  });
  test("chrisPulseSmsTo hands back the tidied number", () => {
    assert.equal(chrisPulseSmsTo({ PULSE_SMS_TO: "(602) 555-1234" }), "+16025551234");
    assert.equal(chrisPulseSmsTo({}), null);
  });
});

describe("the finished-ad text does not follow the pulse number", async () => {
  const { adVideoSmsTo, send } = await import("./notify-fanout.mjs");
  const pulse = "+15555550165";
  const ad = "+15555550198";
  const from = "+15555550168";

  test("AD_VIDEO_SMS_TO wins when both numbers are set", () => {
    assert.equal(adVideoSmsTo({ AD_VIDEO_SMS_TO: ad, PULSE_SMS_TO: pulse }), ad);
  });

  test("an empty ad-video number still uses the pulse number", () => {
    assert.equal(adVideoSmsTo({ PULSE_SMS_TO: pulse }), pulse);
    assert.equal(adVideoSmsTo({}), null);
  });

  test("the log's last two digits are that destination, not the Twilio from-number", async () => {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(" ")); };
    try {
      await send(
        { id: "r-dest", notification: { title: "Ad is ready", click: "https://v.example/f.mp4", actions: [] } },
        { env: { AD_VIDEO_SMS_TO: ad, PULSE_SMS_TO: pulse, TWILIO_SEND_FROM: from }, now: IN_WINDOW }
      );
    } finally {
      console.log = orig;
    }
    const line = lines.find((l) => l.includes("[ad-video-notify]")) || "";
    assert.match(line, /to …98/);
    assert.doesNotMatch(line, /…65/);
    assert.doesNotMatch(line, /…68/);
  });
});

/* THE LOG LINE THAT PROVES A TEXT WENT (board grok-handoff-ad-video-text-2026-09-24,
   "Done means … the worker log line shows `sms: sent`").

   Nothing leaves this machine: the fence is opened ONLY inside the env handed
   to send(), and every request goes to the stand-in transport below, which
   answers the way Twilio and ntfy answer. The numbers are 555-01xx fiction. */
describe("the worker log line says what each channel did", async () => {
  const { send } = await import("./notify-fanout.mjs");
  const env = {
    MESSAGING_DRY_RUN: "0",
    AD_VIDEO_SMS_TO: "+15555550198",
    TWILIO_SEND_ACCOUNT_SID: "ACtest00000000000000000000000000",
    TWILIO_SEND_AUTH_TOKEN: "test-token",
    TWILIO_SEND_FROM: "+15555550168",
    NTFY_TOPIC: "test-topic"
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const capture = async (fn) => {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(" ")); };
    try { return { out: await fn(), line: lines.find((l) => l.includes("[ad-video-notify]")) || "" }; }
    finally { console.log = orig; }
  };

  test("Twilio and ntfy both accept: the line reads sms: sent and ntfy: sent", async () => {
    const hosts = [];
    const fetchImpl = async (url) => {
      const host = new URL(String(url)).host;
      hosts.push(host);
      return host === "api.twilio.com" ? json(201, { sid: "SMtest", status: "queued" }) : json(200, { id: "n1" });
    };
    const { out, line } = await capture(() => send({ id: "r", notification }, { env, fetchImpl, now: IN_WINDOW }));
    assert.equal(line, "[ad-video-notify] sms: sent to …98 | ntfy: sent");
    assert.equal(out.status, "sent");
    assert.deepEqual(hosts.sort(), ["api.twilio.com", "ntfy.sh"]);
  });

  test("Twilio refuses the number: the line says not sent, and the row is not marked notified", async () => {
    const fetchImpl = async (url) => (new URL(String(url)).host === "api.twilio.com"
      ? json(400, { code: 21211, message: "The 'To' number is not a valid phone number." })
      : json(200, { id: "n1" }));
    const { out, line } = await capture(() => send({ id: "r", notification }, { env, fetchImpl, now: IN_WINDOW }));
    assert.match(line, /^\[ad-video-notify\] sms: not sent \(.*21211.*\) to …98 \| ntfy: sent$/);
    assert.equal(out.ok, false, "with a number set, the text is what counts — ntfy alone is not a send");
    assert.match(out.error, /text not sent/);
  });
});

describe("with a number set, the text is what counts", async () => {
  const { send } = await import("./notify-fanout.mjs");
  const notification = { title: "Ad 84 take 1 is ready", click: "https://v.example/f.mp4", actions: [] };
  test("no number: an ntfy-only setup still reports what it did", async () => {
    const res = await send({ id: "r", notification }, { env: {}, now: IN_WINDOW });
    assert.equal(res.ok, false, "nothing is configured in a test, so nothing sent");
    assert.match(res.error, /no number set for a text/);
  });
});

/* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). Both roads ring Chris's own phone, so
   outside 6 a.m. to 10 p.m. Arizona time neither is used, even with every key set and a transport that would
   accept. The answer is "held_quiet_hours", never "sent", so the caller keeps the buzz for later. */
describe("texting hours: the finished-ad buzz waits for 6 a.m.", async () => {
  const { send } = await import("./notify-fanout.mjs");
  const env = {
    MESSAGING_DRY_RUN: "0",
    AD_VIDEO_SMS_TO: "+15555550198",
    TWILIO_SEND_ACCOUNT_SID: "ACtest00000000000000000000000000",
    TWILIO_SEND_AUTH_TOKEN: "test-token",
    TWILIO_SEND_FROM: "+15555550168",
    NTFY_TOPIC: "test-topic"
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const quiet = async (fn) => {
    const orig = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = orig; }
  };
  const run = (iso) => {
    const hosts = [];
    const fetchImpl = async (url) => {
      const host = new URL(String(url)).host;
      hosts.push(host);
      return host === "api.twilio.com" ? json(201, { sid: "SMtest", status: "queued" }) : json(200, { id: "n1" });
    };
    return quiet(() => send({ id: "r", notification }, { env, fetchImpl, now: new Date(iso) })).then((out) => ({ out, hosts }));
  };

  test("2:07 a.m. Arizona: no text, no ntfy, the answer is held (not sent)", async () => {
    const { out, hosts } = await run("2026-10-10T09:07:00Z");
    assert.deepEqual(hosts, [], "nothing reached Twilio or ntfy");
    assert.equal(out.ok, false);
    assert.equal(out.status, "held_quiet_hours");
    assert.deepEqual(out.channels, { ntfy: false, sms: false });
  });

  test("9:59:59 p.m. goes; 10:00:00 p.m. is held", async () => {
    const late = await run("2026-10-10T04:59:59Z");
    assert.equal(late.out.status, "sent");
    assert.deepEqual(late.hosts.sort(), ["api.twilio.com", "ntfy.sh"]);
    const ten = await run("2026-10-10T05:00:00Z");
    assert.equal(ten.out.status, "held_quiet_hours");
    assert.deepEqual(ten.hosts, []);
  });

  test("5:59:59 a.m. is held; 6:00:00 a.m. goes", async () => {
    const early = await run("2026-10-09T12:59:59Z");
    assert.equal(early.out.status, "held_quiet_hours");
    assert.deepEqual(early.hosts, []);
    const six = await run("2026-10-09T13:00:00Z");
    assert.equal(six.out.status, "sent");
  });
});
