import { test } from "node:test";
import assert from "node:assert/strict";
import { PULSE_SMS_TO_ENV } from "../pulse/notify.mjs";
import { BLAKE_FROM_EMAIL, PROCESSED_LABEL } from "./blake-lead.mjs";
import { sendChrisLeadSms, watchBlakeLeads } from "./blake-lead-watch.mjs";

const STAFF_TO = "+15555550123";
/* Texting hours (src/pulse/quiet-hours.mjs): Chris is texted only 6 a.m. to 10 p.m. Arizona time. The send
   tests hand in a clock at noon Arizona time so they pass at any hour; the held case is tested at the bottom. */
const IN_WINDOW = new Date("2026-10-09T19:00:00Z");
const AT_2AM = new Date("2026-10-10T09:07:00Z");
const BLAKE_FROM = `Blake Evertsen <${BLAKE_FROM_EMAIL}>`;

function fakeGmail({ messages }) {
  const labeled = new Set();
  return {
    labels: [{ id: "lbl1", name: PROCESSED_LABEL }],
    async getOrCreateLabel(name) {
      assert.equal(name, PROCESSED_LABEL);
      return "lbl1";
    },
    async listMessages() {
      return { messages: messages.map((m) => ({ id: m.id })) };
    },
    async getMessage(id) {
      return messages.find((m) => m.id === id);
    },
    headerValue(message, name) {
      const headers = message?.payload?.headers || [];
      const hit = headers.find((h) => String(h.name).toLowerCase() === String(name).toLowerCase());
      return hit?.value || null;
    },
    async addLabels(id, ids) {
      assert.deepEqual(ids, ["lbl1"]);
      labeled.add(id);
    },
    labeled
  };
}

function fullMessage({ id, from, subject, text, date }) {
  return {
    id,
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
        { name: "Date", value: date || new Date().toUTCString() }
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from(text, "utf8").toString("base64") }
    }
  };
}

test("sendChrisLeadSms uses the pulse dest and never names Blake or repair", async () => {
  const calls = [];
  const out = await sendChrisLeadSms({
    name: "Sim Blake Lead",
    phone: "+15555550199",
    env: { [PULSE_SMS_TO_ENV]: STAFF_TO },
    now: IN_WINDOW,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.sent, true);
  assert.equal(out.to, STAFF_TO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, STAFF_TO);
  assert.match(calls[0].body, /Sim Blake Lead/);
  assert.match(calls[0].body, /555-0199/);
  assert.doesNotMatch(calls[0].body, /Blake Evertsen|Blake Edwardson|credit repair|\brepair\b/i);
});

test("watch texts Chris the referred person and skips signature-only mail", async () => {
  const client = fakeGmail({
    messages: [
      fullMessage({
        id: "m-lead",
        from: BLAKE_FROM,
        subject: "Pat Rivera - [Credit Repair] Booking Link",
        text: [
          "**CLIENT INFO**",
          "Pat Rivera",
          "202-555-0133",
          "pat@example.com",
          "Blake Evertsen",
          "561-555-0199"
        ].join("\n")
      }),
      fullMessage({
        id: "m-sig",
        from: BLAKE_FROM,
        subject: "Thanks",
        text: ["Blake Evertsen", "Founder & CEO", "561-555-0199"].join("\n")
      })
    ]
  });
  const calls = [];
  const out = await watchBlakeLeads({
    env: { [PULSE_SMS_TO_ENV]: STAFF_TO },
    gmailClient: client,
    now: IN_WINDOW,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.scanned, 2);
  assert.equal(out.sent, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /Pat Rivera/);
  assert.match(calls[0].body, /202/);
  assert.doesNotMatch(calls[0].body, /Blake Evertsen|repair/i);
  assert.ok(client.labeled.has("m-lead"));
  assert.ok(client.labeled.has("m-sig"));
});

test("old Blake mail is labeled and not texted", async () => {
  const client = fakeGmail({
    messages: [
      fullMessage({
        id: "m-old",
        from: BLAKE_FROM,
        subject: "Pat Rivera - [Credit Repair] Booking Link",
        date: new Date(Date.now() - 20 * 60 * 60 * 1000).toUTCString(),
        text: ["**CLIENT INFO**", "Pat Rivera", "202-555-0133"].join("\n")
      })
    ]
  });
  const calls = [];
  const out = await watchBlakeLeads({
    env: { [PULSE_SMS_TO_ENV]: STAFF_TO },
    gmailClient: client,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.sent, 0);
  assert.equal(calls.length, 0);
  assert.ok(client.labeled.has("m-old"));
});

test("watch does nothing when PULSE_SMS_TO is missing", async () => {
  const out = await watchBlakeLeads({
    env: {},
    gmailClient: fakeGmail({ messages: [] })
  });
  assert.equal(out.sent, 0);
  assert.match(out.reason, /PULSE_SMS_TO unset/);
});

test("texting hours: at 2:07 a.m. Arizona the lead text is held, and the mail is left unlabeled for the 6 a.m. poll", async () => {
  const held = await sendChrisLeadSms({
    name: "Sim Blake Lead",
    phone: "+15555550199",
    env: { [PULSE_SMS_TO_ENV]: STAFF_TO },
    now: AT_2AM,
    sendImpl: async () => { throw new Error("must not send at night"); }
  });
  assert.equal(held.sent, false);
  assert.equal(held.reason, "held_quiet_hours");

  const lead = () => fullMessage({
    id: "m-night",
    from: BLAKE_FROM,
    subject: "Pat Rivera - [Credit Repair] Booking Link",
    text: ["**CLIENT INFO**", "Pat Rivera", "202-555-0133"].join("\n")
  });
  const calls = [];
  const sendImpl = async (msg) => { calls.push(msg); return { status: "sent" }; };
  const night = fakeGmail({ messages: [lead()] });
  const out = await watchBlakeLeads({ env: { [PULSE_SMS_TO_ENV]: STAFF_TO }, gmailClient: night, now: AT_2AM, sendImpl });
  assert.equal(out.sent, 0);
  assert.equal(calls.length, 0, "nothing was texted at night");
  assert.equal(night.labeled.has("m-night"), false, "not labeled, so the next poll inside the window texts it");

  const morning = fakeGmail({ messages: [lead()] });
  const later = await watchBlakeLeads({ env: { [PULSE_SMS_TO_ENV]: STAFF_TO }, gmailClient: morning, now: new Date("2026-10-10T13:00:00Z"), sendImpl });
  assert.equal(later.sent, 1, "6:00 a.m.: the held lead goes out");
  assert.equal(calls.length, 1);
});
