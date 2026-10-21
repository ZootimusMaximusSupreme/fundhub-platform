import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIFT_JOBS } from "./beats/shifts.mjs";
import {
  PULSE_RUNNER_JOBS,
  PULSE_RUNNER_STALE_MS,
  checkPulseRunnerReceipt,
  formatInstantSms,
  runInstantWatch,
  recentInstantAlert
} from "./instant-watch.mjs";

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

function pulseRunnerDb(lastAt) {
  return {
    query: async (sql) => {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
      if (/FROM job_heartbeats/.test(sql)) return { rows: [{ last_at: lastAt }] };
      if (/FROM clients/.test(sql)) return { rows: [] };
      if (/FROM (cards|messages)/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM agent_runs/.test(sql)) return { rows: [] };
      if (/INSERT INTO agent_runs/.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    }
  };
}

const allDoorsPass = async () => ({ status: 200, text: "Sign in password Generate Apps Apply door roadmap $147" });

test("backup pulse circuit passes when pulse-hourly left a fresh receipt", async () => {
  const now = new Date("2026-10-09T19:00:00.000Z");
  const row = await checkPulseRunnerReceipt(
    pulseRunnerDb(new Date(now.getTime() - PULSE_RUNNER_STALE_MS + 1)),
    { now }
  );
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /circuit closed/);

  const result = await runInstantWatch({
    db: pulseRunnerDb(new Date(now.getTime() - 60 * 60 * 1000)),
    now,
    env: {},
    fetchImpl: allDoorsPass
  });
  assert.equal(result.failures.some((item) => item.id === "pulse:runner-stale"), false);
});

/* The hourly pulse runs in shifts (src/pulse/beats/shifts.mjs). A receipt fake that answers per job. */
function shiftReceiptDb(lastAtByJob) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      if (/FROM job_heartbeats/.test(sql)) {
        asked.push(params[0]);
        return { rows: [{ last_at: lastAtByJob[params[0]] ?? null }] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    }
  };
}

const SHIFT_IDS = ["pulse-hourly", "pulse-hourly-b", "pulse-hourly-c", "pulse-hourly-d"];

test("backup pulse circuit reads a receipt for every hourly shift, and closes only when all are fresh", async () => {
  const now = new Date("2026-10-09T19:00:00.000Z");
  const fresh = new Date(now.getTime() - 60 * 60 * 1000);
  assert.deepEqual([...PULSE_RUNNER_JOBS], [...SHIFT_JOBS]);
  assert.deepEqual([...PULSE_RUNNER_JOBS], SHIFT_IDS);
  const db = shiftReceiptDb(Object.fromEntries(SHIFT_IDS.map((job) => [job, fresh])));
  const row = await checkPulseRunnerReceipt(db, { now });
  assert.deepEqual(db.asked, SHIFT_IDS);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /^All 4 hourly pulse shifts left a fresh receipt/);
});

for (const job of ["pulse-hourly-b", "pulse-hourly-c", "pulse-hourly-d"]) {
  test(`backup pulse circuit goes red when only ${job} stops, and names it`, async () => {
    const now = new Date("2026-10-09T19:00:00.000Z");
    const fresh = new Date(now.getTime() - 60 * 60 * 1000);
    const row = await checkPulseRunnerReceipt(shiftReceiptDb({
      ...Object.fromEntries(SHIFT_IDS.map((id) => [id, fresh])),
      [job]: new Date(now.getTime() - PULSE_RUNNER_STALE_MS - 60 * 60 * 1000)
    }), { now });
    assert.equal(row.status, "FAIL");
    assert.equal(row.detail, `The hourly pulse (${job}) has not run for 4 h. The backup pulse circuit did not close.`);
    assert.equal(row.suggestedFix, `Check the ${job} function log on Netlify.`);
  });
}

test("backup pulse circuit goes red when every shift stops, and names every one", async () => {
  const now = new Date("2026-10-09T19:00:00.000Z");
  const old = new Date(now.getTime() - PULSE_RUNNER_STALE_MS - 1);
  const row = await checkPulseRunnerReceipt(shiftReceiptDb(Object.fromEntries(SHIFT_IDS.map((job) => [job, old]))), { now });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^The hourly pulse has not run for 3 h\. pulse-hourly-b has not run for 3 h either\. pulse-hourly-c has not run for 3 h either\. pulse-hourly-d has not run for 3 h either\./);
  assert.equal(row.suggestedFix, "Check the pulse-hourly, pulse-hourly-b, pulse-hourly-c and pulse-hourly-d function log on Netlify.");
});

test("a shift that has never run is not judged yet; before any shift has run there is nothing to judge", async () => {
  const now = new Date("2026-10-09T19:00:00.000Z");
  const fresh = new Date(now.getTime() - 60 * 60 * 1000);
  const onlyA = await checkPulseRunnerReceipt(shiftReceiptDb({ "pulse-hourly": fresh }), { now });
  assert.equal(onlyA.status, "PASS");
  assert.match(onlyA.detail, /^The hourly pulse left a fresh receipt/);
  const notC = await checkPulseRunnerReceipt(shiftReceiptDb({ "pulse-hourly": fresh, "pulse-hourly-b": fresh }), { now });
  assert.equal(notC.status, "PASS");
  assert.match(notC.detail, /^Both hourly pulse shifts left a fresh receipt/);
  const staleA = await checkPulseRunnerReceipt(shiftReceiptDb({ "pulse-hourly": new Date(now.getTime() - PULSE_RUNNER_STALE_MS - 1) }), { now });
  assert.equal(staleA.status, "FAIL");
  assert.equal(await checkPulseRunnerReceipt(shiftReceiptDb({}), { now }), null);
});

test("backup pulse circuit goes red when pulse-hourly does not return", async () => {
  const now = new Date("2026-10-09T19:00:00.000Z");
  const sent = [];
  const result = await runInstantWatch({
    db: pulseRunnerDb(new Date(now.getTime() - PULSE_RUNNER_STALE_MS - 1)),
    now,
    env: { PULSE_SMS_TO: "+16025551234" },
    fetchImpl: allDoorsPass,
    sendImpl: async (message) => { sent.push(message.body); return { ok: true, status: "sent" }; }
  });
  const red = result.failures.find((item) => item.id === "pulse:runner-stale");
  assert.equal(red?.status, "FAIL");
  assert.match(red?.detail || "", /circuit did not close/);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /pulse:runner-stale/);
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

/* THE EMAIL COPY (owner-set 2026-10-14: "we can just do emails for now"). The Twilio account is inactive, so the
   5-minute watch used to send its alert through a dead road and nobody was told (launch pass 2026-10-14, R06 /
   HB-01). It now goes through textMorningBrief, which sends the same body to PULSE_EMAIL_TO. These tests go red
   if the email copy is missing, if the cooldown or texting hours stop holding it, or if a dead text hides it. */
const OWNER_EMAIL = "owner-alerts@fundhub.ai";
const DAY_ISO = "2026-10-10T19:00:00Z"; // noon Arizona: inside texting hours
const deadTwilio = async () => ({ ok: false, status: "failed", error: "Twilio account is inactive" });

function emailRecorder(result = { status: "sent" }) {
  const emails = [];
  return { emails, emailImpl: async (message) => { emails.push(message); return result; } };
}

test("email copy: a door down with Twilio dead still emails the owner the same alert body", async () => {
  const db = watchDb();
  const { emails, emailImpl } = emailRecorder();
  const result = await runInstantWatch({
    db,
    now: new Date(DAY_ISO),
    env: { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch,
    sendImpl: deadTwilio,
    emailImpl
  });
  assert.equal(result.failures.length > 0, true);
  assert.equal(emails.length, 1, "one email copy went out");
  assert.equal(emails[0].to, OWNER_EMAIL);
  assert.equal(emails[0].channel, "email");
  assert.match(emails[0].subject, /^Fundhub pulse: /);
  assert.equal(emails[0].body, result.sms.body, "the email carries the same alert body as the text");
  assert.match(emails[0].body, /health:/);
  assert.equal(result.sms.sent, true, "delivered: the email went out even though the text did not");
  assert.equal(result.sms.text_status, "failed");
  assert.equal(result.sms.email_status, "sent");
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].outcome, "pass", "the alert row says delivered, so the cooldown holds");
});

test("email copy: with no phone set at all the email still goes out", async () => {
  const { emails, emailImpl } = emailRecorder();
  let texted = 0;
  const result = await runInstantWatch({
    db: null,
    now: new Date(DAY_ISO),
    env: { PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch,
    sendImpl: async () => { texted += 1; return { ok: true, status: "sent" }; },
    emailImpl
  });
  assert.equal(texted, 0, "no phone number, so no text attempt");
  assert.equal(emails.length, 1);
  assert.equal(result.sms.sent, true);
  assert.equal(result.sms.to, null);
});

test("email copy: a sent text still sends the email copy too, and an email failure does not hide a sent text", async () => {
  const both = emailRecorder();
  const a = await runInstantWatch({
    db: null, now: new Date(DAY_ISO), env: { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch, sendImpl: async () => ({ ok: true, status: "sent" }), emailImpl: both.emailImpl
  });
  assert.equal(both.emails.length, 1);
  assert.equal(a.sms.sent, true);
  assert.equal(a.sms.text_status, "sent");

  const emailDown = emailRecorder({ status: "failed", error: "resend 403" });
  const b = await runInstantWatch({
    db: null, now: new Date(DAY_ISO), env: { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch, sendImpl: async () => ({ ok: true, status: "sent" }), emailImpl: emailDown.emailImpl
  });
  assert.equal(b.sms.sent, true, "the text went, so the alert is delivered");
  assert.equal(b.sms.email_status, "failed");
});

test("email copy: text and email both failing is a failed alert that names both errors", async () => {
  const db = watchDb();
  const { emailImpl } = emailRecorder({ status: "failed", error: "resend 403" });
  const result = await runInstantWatch({
    db, now: new Date(DAY_ISO), env: { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch, sendImpl: deadTwilio, emailImpl
  });
  assert.equal(result.sms.sent, false);
  assert.match(result.sms.reason, /Twilio account is inactive/);
  assert.match(result.sms.reason, /email: resend 403/);
  assert.equal(db.rows[0].outcome, "fail");
});

test("email copy: a text sender that throws does not hide the email copy", async () => {
  const { emails, emailImpl } = emailRecorder();
  const result = await runInstantWatch({
    db: null, now: new Date(DAY_ISO), env: { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL },
    fetchImpl: downFetch, sendImpl: async () => { throw new Error("socket hang up"); }, emailImpl
  });
  assert.equal(emails.length, 1);
  assert.equal(result.sms.sent, true);
});

test("email copy: no phone and no email address is still reported as no_dest, and nothing is sent", async () => {
  const { emails, emailImpl } = emailRecorder();
  let texted = 0;
  const result = await runInstantWatch({
    db: null, now: new Date(DAY_ISO), env: {}, fetchImpl: downFetch,
    sendImpl: async () => { texted += 1; return { ok: true, status: "sent" }; }, emailImpl
  });
  assert.equal(result.sms.sent, false);
  assert.equal(result.sms.reason, "no_dest");
  assert.equal(texted, 0);
  assert.equal(emails.length, 0);
});

test("email copy: the cooldown holds, so a door that stays down emails once an hour, not every 5 minutes", async () => {
  const db = watchDb();
  const { emails, emailImpl } = emailRecorder();
  const env = { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL };
  const run = (iso) => runInstantWatch({ db, now: new Date(iso), env, fetchImpl: downFetch, sendImpl: deadTwilio, emailImpl });
  const first = await run("2026-10-10T19:00:00Z");
  assert.equal(first.sms.sent, true);
  assert.equal(emails.length, 1);
  const second = await run("2026-10-10T19:05:00Z");
  assert.equal(second.sms.sent, false);
  assert.equal(second.sms.reason, "cooldown");
  assert.equal(emails.length, 1, "no second email inside the cooldown");
});

test("email copy: texting hours hold the email too. Nothing at 2:07 a.m., no alert row, and 6:00 a.m. emails at once", async () => {
  const db = watchDb();
  const { emails, emailImpl } = emailRecorder();
  const env = { PULSE_SMS_TO: "+16025551234", PULSE_EMAIL_TO: OWNER_EMAIL };
  const night = await runInstantWatch({ db, now: new Date("2026-10-10T09:07:00Z"), env, fetchImpl: downFetch, sendImpl: deadTwilio, emailImpl });
  assert.equal(night.sms.sent, false);
  assert.equal(night.sms.reason, "held_quiet_hours");
  assert.equal(emails.length, 0, "no email at night");
  assert.equal(db.rows.length, 0, "no alert row at night");
  const six = await runInstantWatch({ db, now: new Date("2026-10-10T13:00:00Z"), env, fetchImpl: downFetch, sendImpl: deadTwilio, emailImpl });
  assert.equal(six.sms.sent, true);
  assert.equal(emails.length, 1);
});
