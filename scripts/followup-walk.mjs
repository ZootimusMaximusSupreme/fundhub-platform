#!/usr/bin/env node
// What each person gets, from lead to booked call and onward. SCRATCH DATABASE ONLY.
//
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/fundhub_scratch_walk node scripts/followup-walk.mjs [out.json]
//
// Seven made-up people walk the real follow-up workflows (S-00, S-02, S-NOBOOK,
// AI-SET-03, S-04B, S-05A) against a scratch Postgres that has every migration and
// seed, including the copy (db/seed/301_followup_flows_copy.sql). Inngest is a
// stand-in: step.run runs, step.sleep and step.sleepUntil move a pretend clock. So
// every message is the real row sendTemplated writes, rendered from the real
// template, and every time is the moment the workflow planned for it. The send-hour
// rule (src/messaging/send-window.mjs) says whether it goes out at that moment.
//
// It refuses any database that is not a loopback scratch, test or ci database
// (src/verification/scratch-guard.mjs). It sends nothing: no provider is loaded, and
// MESSAGING_DRY_RUN is forced on. It deletes the people it made when it is done.
//
// Board: ops/workflows/backend-selling-lanes-2026-10-30.md, section 6d.

import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../src/verification/scratch-guard.mjs";

const URL_ = process.env.DATABASE_URL;
if (!isLocalScratchDatabaseUrl(URL_)) {
  console.error("followup-walk: refusing. DATABASE_URL must be a loopback scratch, test or ci database.");
  process.exit(2);
}
process.env.MESSAGING_DRY_RUN = "1";
if (!process.env.UNSUBSCRIBE_TOKEN_SECRET) process.env.UNSUBSCRIBE_TOKEN_SECRET = crypto.randomBytes(32).toString("hex");

const { onSurveySubmitted } = await import("../src/handlers/client-lifecycle.mjs");
const s00 = await import("../src/workflows/s-00-welcome.mjs");
const s02 = await import("../src/workflows/s-02-incomplete-survey-nudge.mjs");
const nobook = await import("../src/workflows/s-nobook-chase.mjs");
const aiset03 = await import("../src/workflows/ai-set-03-no-answer-cadence.mjs");
const s04b = await import("../src/workflows/s-04b-booking-reminders.mjs");
const s05a = await import("../src/workflows/s-05a-no-show-recovery.mjs");
const { sendTiming, inDripWindow } = await import("../src/messaging/send-window.mjs");
const { inQuietHours } = await import("../src/messaging/gate.mjs");

const db = new pg.Pool({ connectionString: URL_, max: 4 });
const org = (await db.query("SELECT id FROM orgs ORDER BY is_default DESC NULLS LAST, created_at LIMIT 1")).rows[0]?.id;
if (!org) throw new Error("followup-walk: no org on this database");

const AZ = (s) => new Date(`${s}-07:00`);
const fmt = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short",
  day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) + " Arizona";
const RUN = crypto.randomBytes(3).toString("hex");
const made = [];

async function person(first, answers = {}) {
  const email = `walk-${RUN}-${first.toLowerCase()}+fhtest@example.com`;
  const r = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, is_demo)
     VALUES ($1, $2, $3, 'Walk', $4, true) RETURNING id`,
    [org, email, first, `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`]
  );
  const id = r.rows[0].id;
  made.push(id);
  if (Object.keys(answers).length) {
    await onSurveySubmitted({ orgId: org, clientId: id, name: "survey.submitted", payload: { email, answers } }, db);
  }
  return { id, email, first };
}

async function event(name, who, at, payload = {}) {
  const r = await db.query(
    `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload, created_at, is_demo)
     VALUES ($1, $2, 1, $3, $4, $5, $6, true) RETURNING id`,
    [org, name, `walk:${RUN}:${name}:${who.id}:${at.toISOString()}`, who.id, { email: who.email, ...payload }, at.toISOString()]
  );
  return { id: r.rows[0].id, orgId: org, clientId: who.id, name, payload: { email: who.email, ...payload } };
}

/* A pretend Inngest: step.run runs; the sleeps move the clock. Each send step is
   stamped with the clock, so its rows carry the moment the workflow chose. */
/* Rows already claimed by an earlier step. Matched by id, never by time: a
   created_at read into JS loses its microseconds and would match a row twice. */
const seen = new Set();
async function freshRows() {
  if (!made.length) return [];
  const r = await db.query(
    `SELECT id FROM messages WHERE client_id = ANY($1) AND direction = 'outbound' ORDER BY created_at, id`, [made]);
  const out = r.rows.map((m) => m.id).filter((id) => !seen.has(id));
  for (const id of out) seen.add(id);
  return out;
}

function engine(start) {
  const clock = { ms: start.getTime() };
  const sends = [];
  const step = {
    run: async (id, fn) => {
      await freshRows();
      const out = await fn();
      for (const messageId of await freshRows()) sends.push({ messageId, at: new Date(clock.ms), step: id });
      return out === undefined ? null : JSON.parse(JSON.stringify(out));
    },
    sleep: async (_id, dur) => {
      const m = /^(\d+)([smhd])$/.exec(String(dur));
      const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m?.[2]] || 0;
      clock.ms += Number(m?.[1] || 0) * unit;
    },
    sleepUntil: async (_id, when) => { clock.ms = Math.max(clock.ms, new Date(when).getTime()); }
  };
  return { step, clock, sends, nowMs: () => clock.ms, nowDate: () => new Date(clock.ms) };
}

async function what(sends) {
  const out = [];
  for (const s of sends) {
    const m = (await db.query(
      `SELECT channel, template_key, subject, rendered_body FROM messages WHERE id = $1`, [s.messageId])).rows[0];
    if (!m || !m.template_key) continue;
    const timing = sendTiming(m.template_key);
    const open = timing === "instant" ? true
      : timing === "drip" ? inDripWindow(s.at)
        : m.channel !== "sms" || !inQuietHours(s.at);
    const text = m.channel === "email"
      ? String(m.rendered_body).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ").trim()
      : m.rendered_body;
    out.push({ at: fmt(s.at), iso: s.at.toISOString(), channel: m.channel, key: m.template_key, timing,
      goesOut: open ? "at that moment" : "held, then at the next opening", subject: m.subject || null, text });
  }
  return out;
}

const SURVEY_DONE_760 = {
  cf_svy_funding_target_amount: "$100k - $200k", cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
  cf_svy_money_change_now: ["Grow faster (more customers / more reach)"], cf_svy_self_reported_fico: "760-850",
  cf_svy_has_business: "Yes, 2-5 years", cf_svy_business_revenue: "$250k - $499k", cf_svy_revenue_verifiable: "Yes, both",
  cf_svy_available_capital: "$25k - $100k"
};
const SURVEY_DONE_640 = { ...SURVEY_DONE_760, cf_svy_self_reported_fico: "620-699" };
const THREE_ANSWERS = { cf_svy_funding_target_amount: "$50k - $100k", cf_svy_planned_use: "Equipment or buildout",
  cf_svy_money_change_now: ["Peace of mind (stop stressing about cash)"] };

const people = [];
async function walk(label, story, fn) {
  const runs = await fn();
  const messages = [];
  for (const r of runs) messages.push(...await what(r.sends));
  messages.sort((a, b) => a.iso.localeCompare(b.iso) || a.channel.localeCompare(b.channel));
  people.push({ label, story, messages, results: runs.map((r) => r.result) });
  console.log(`\n${label}: ${story}`);
  for (const m of messages) console.log(`  ${m.at} | ${m.channel} | ${m.key} | ${m.goesOut}`);
}

try {
  // 1. Opts in on a weekday morning and never answers a question.
  await walk("Ana", "Types her name, email and phone at 10:00 a.m. and never answers a question.", async () => {
    const who = await person("Ana");
    const at = AZ("2026-11-03T10:00:00");
    const ev = await event("entry.captured", who, at, { funnel: "apply-survey", source: "clickfunnels" });
    const a = engine(at); const ra = await s00.handle({ event: ev, db, step: a.step });
    const b = engine(at); const rb = await s02.handle({ event: ev, db, step: b.step, now: b.nowMs });
    return [{ sends: a.sends, result: ra }, { sends: b.sends, result: { exitedAt: rb?.exitedAt || rb?.reason || "done" } }];
  });

  // 2. Opts in at night, answers three questions, stops at the score question.
  await walk("Ben", "Starts at 9:05 p.m., answers three questions, stops at the credit score question.", async () => {
    const who = await person("Ben", THREE_ANSWERS);
    const at = AZ("2026-11-03T21:05:00");
    const ev = await event("entry.captured", who, at, { funnel: "apply-survey", source: "clickfunnels" });
    const a = engine(at); const ra = await s00.handle({ event: ev, db, step: a.step });
    const b = engine(at); const rb = await s02.handle({ event: ev, db, step: b.step, now: b.nowMs });
    return [{ sends: a.sends, result: ra }, { sends: b.sends, result: { exitedAt: rb?.exitedAt || rb?.reason || "done" } }];
  });

  // 3. Finishes the survey at 3:10 p.m. with a 760-850 score and never books.
  await walk("Cara", "Finishes the survey at 3:10 p.m. (score 760-850) and never books.", async () => {
    const who = await person("Cara", SURVEY_DONE_760);
    const at = AZ("2026-11-03T15:10:00");
    const ev = await event("survey.completed", who, at, { answers: SURVEY_DONE_760, funnel: "apply-survey" });
    const e = engine(at); const r = await nobook.handle({ event: ev, db, step: e.step, now: e.nowDate });
    const task = (await db.query(`SELECT title FROM tasks WHERE client_id = $1 AND source_workflow = 'setter-survey-done'`, [who.id])).rows[0];
    return [{ sends: e.sends, result: { exitedAt: r?.exitedAt, setterTask: task?.title || null } }];
  });

  // 4. Finishes at 10:00 a.m. with 620-699 and texts back after the first message.
  await walk("Dev", "Finishes at 10:00 a.m. (score 620-699), then texts back at 1:00 p.m.", async () => {
    const who = await person("Dev", SURVEY_DONE_640);
    const at = AZ("2026-11-03T10:00:00");
    const ev = await event("survey.completed", who, at, { answers: SURVEY_DONE_640, funnel: "apply-survey" });
    const e = engine(at);
    const realRun = e.step.run;
    let replied = false;
    e.step.run = async (id, fn) => {
      const out = await realRun(id, fn);
      if (!replied && String(id).startsWith("send-nobook-1")) {
        replied = true;
        await event("message.inbound", who, AZ("2026-11-03T13:00:00"), { channel: "email", body: "walk reply" });
      }
      return out;
    };
    const r = await nobook.handle({ event: ev, db, step: e.step, now: e.nowDate });
    return [{ sends: e.sends, result: { exitedAt: r?.exitedAt } }];
  });

  // 5. The setter calls at 4:50 p.m., no answer, nothing booked.
  await walk("Eve", "Opted in; the setter calls at 4:50 p.m. and gets no answer. No call booked.", async () => {
    const who = await person("Eve", { ...SURVEY_DONE_640 });
    const at = AZ("2026-11-03T16:50:00");
    const ev = await event("setter.no_answer", who, at, { disposition: "no_answer", call_attempts: 1 });
    const e = engine(at); const r = await aiset03.handle({ event: ev, db, step: e.step, now: e.nowDate });
    return [{ sends: e.sends, result: { exitedAt: r?.exitedAt } }];
  });

  // 6. Books at 11:40 p.m. for a call two days out at 10:00 a.m., then misses it.
  await walk("Finn", "Books at 11:40 p.m. (score 700-759) for Thursday 10:00 a.m., then misses the call.", async () => {
    const who = await person("Finn", { ...SURVEY_DONE_760, cf_svy_self_reported_fico: "700-759" });
    const at = AZ("2026-11-03T23:40:00");
    const start = AZ("2026-11-05T10:00:00");
    const booking = await event("booking.created", who, at, { startTime: start.toISOString(), bookingUid: `walk-${RUN}`, source: "clickfunnels" });
    const a = engine(at);
    const ra = await s04b.handle({
      event: booking, db, step: a.step, now: a.nowMs,
      requestMagicLinkImpl: async () => ({ ok: true, token: "walk-token" }),
      drainNowImpl: async () => ({ sent: 0, reason: "walk" })
    });
    const noshowAt = AZ("2026-11-05T10:35:00");
    const noshow = await event("booking.noshow", who, noshowAt, { startTime: start.toISOString(), bookingUid: `walk-${RUN}` });
    const b = engine(noshowAt); const rb = await s05a.handle({ event: noshow, db, step: b.step, now: b.nowMs });
    return [{ sends: a.sends, result: { reminders: ra?.skipped24h || ra?.skipped2h || "both planned" } },
      { sends: b.sends, result: { exitedAt: rb?.stoppedAt || "all four touches" } }];
  });

  // 7. Has a call booked; the setter's confirm call at 11:00 a.m. gets no answer.
  await walk("Gia", "Has a call booked for Friday; the setter's confirm call at 11:00 a.m. gets no answer.", async () => {
    const who = await person("Gia", { ...SURVEY_DONE_760 });
    await db.query(
      `INSERT INTO bookings (org_id, client_id, source, status, starts_at, attendee_email, provider_uid)
       VALUES ($1, $2, 'clickfunnels', 'booked', $3, $4, $5)`,
      [org, who.id, AZ("2026-11-06T10:00:00").toISOString(), who.email, `walk-gia-${RUN}`]
    );
    const at = AZ("2026-11-03T11:00:00");
    const ev = await event("setter.no_answer", who, at, { disposition: "no_answer", call_attempts: 1 });
    const e = engine(at); const r = await aiset03.handle({ event: ev, db, step: e.step, now: e.nowDate });
    return [{ sends: e.sends, result: { exitedAt: r?.exitedAt } }];
  });

  const out = process.argv[2];
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), database: new URL(URL_).pathname.slice(1), people }, null, 2));
    console.log(`\nwrote ${out}`);
  }
} finally {
  if (made.length) {
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [made]).catch(() => {});
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [made]).catch(() => {});
    await db.query(`DELETE FROM bookings WHERE client_id = ANY($1)`, [made]).catch(() => {});
    await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [made]).catch(() => {});
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [made]).catch((err) => console.error(`cleanup: ${err.message}`));
  }
  await db.end();
}
