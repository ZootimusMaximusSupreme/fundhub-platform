// followup-live-proof.mjs — the live proof of the follow-up workflows with two plus-tag test leads.
// PRODUCTION. Run only after the follow-up release has shipped and the release hold note is gone.
// One-off live proof of the follow-up workflows (2026-10-31). Two plus-tag test leads.
//
//   node --env-file=.env scripts/followup-live-proof.mjs send     post the leads the way /apply does
//   node --env-file=.env scripts/followup-live-proof.mjs check    read what happened (read only)
//
// Ana stops after two answers (the come-back chase). Ben finishes with a 700-759
// score and books nothing (setter task, never-booked chase, qualified calendar).
// Both use plus-tag addresses on the proof inbox and the agent phone. Never a real
// person, never a calendar booking. cleanup.mjs removes both afterwards.
import fs from "node:fs";
import pg from "pg";

const HERE = new URL("../ops/workflows/followup-flows-2026-10-31-evidence/", import.meta.url).pathname; // gitignored: the test addresses never reach git
fs.mkdirSync(HERE, { recursive: true });
const STATE = `${HERE}live-state.json`;
const SITE = "https://fundhub.ai";
const PHONE = "+16616054248";

function people(stamp) {
  const email = (who) => `stanbridgejchris+fhtest+sim-fu-${who}-${stamp}@gmail.com`;
  return {
    ana: {
      email: email("ana"), name: "Ana TEST",
      steps: [
        ["contact", {}],
        ["cf_svy_funding_target_amount", { cf_svy_funding_target_amount: "$50k - $100k" }],
        ["cf_svy_planned_use", { cf_svy_planned_use: "Equipment or buildout" }]
      ]
    },
    ben: {
      email: email("ben"), name: "Ben TEST",
      steps: [
        ["contact", {}],
        ["cf_svy_funding_target_amount", { cf_svy_funding_target_amount: "$100k - $200k" }],
        ["cf_svy_planned_use", { cf_svy_planned_use: "Growth (marketing, inventory, hiring)" }],
        ["cf_svy_money_change_now", { cf_svy_money_change_now: ["Grow faster (more customers / more reach)"] }],
        ["cf_svy_self_reported_fico", { cf_svy_self_reported_fico: "700-759" }],
        ["cf_svy_has_business", { cf_svy_has_business: "No, personal funding only" }],
        ["cf_svy_annual_income_range", { cf_svy_annual_income_range: "$100k-$199k" }],
        ["cf_svy_income_verifiable", { cf_svy_income_verifiable: "Yes, both" }],
        ["cf_svy_available_capital", { cf_svy_available_capital: "$5k - $25k" }]
      ]
    }
  };
}

async function post(person, stepKey, answers) {
  const body = {
    source: "apply-survey", funnel: "apply-survey", step_key: stepKey,
    email: person.email, name: person.name, phone: PHONE, answers, a1: null, a2: null,
    attribution: { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_path: "/apply", referrer_domain: null }
  };
  const res = await fetch(`${SITE}/api/webhooks/clickfunnels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Fundhub-Apply-Survey-Ingest": process.env.CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET },
    body: JSON.stringify(body)
  });
  return `${res.status} ${(await res.text()).slice(0, 80)}`;
}

async function send() {
  const stamp = Date.now().toString(36);
  const who = people(stamp);
  const state = { startedAt: new Date().toISOString(), stamp, people: {} };
  for (const [key, person] of Object.entries(who)) {
    let answers = {};
    const posts = [];
    for (const [stepKey, add] of person.steps) {
      answers = { ...answers, ...add };
      posts.push(`${stepKey}: ${await post(person, stepKey, answers)}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
    state.people[key] = { email: person.email, posts };
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
}

async function check() {
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const emails = Object.values(state.people).map((p) => p.email);
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN READ ONLY");
  const clients = (await c.query(
    `SELECT id, lower(email) AS email, is_demo, custom_fields->>'credit_tier' AS credit_tier, created_at
       FROM clients WHERE lower(email) = ANY($1)`, [emails])).rows;
  const ids = clients.map((x) => x.id);
  const events = (await c.query(
    `SELECT name, COALESCE(lower(payload->>'email'), '') AS email, client_id, created_at
       FROM events WHERE created_at >= $3::timestamptz AND (client_id = ANY($1) OR lower(payload->>'email') = ANY($2))
      ORDER BY created_at`, [ids, emails, state.startedAt])).rows;
  const messages = (await c.query(
    `SELECT m.id, m.client_id, m.template_key, m.channel, m.status, m.created_at, m.scheduled_at, m.blocked_reason,
            (m.rendered_body ~ 'apply\\.fundhub\\.ai/apply\\?r=') AS has_resume_link,
            substring(m.rendered_body from 'apply\\.fundhub\\.ai/apply\\?r=([A-Za-z0-9_-]+)') AS resume_token,
            substring(m.rendered_body from 'apply\\.fundhub\\.ai/(funding-book-call[A-Za-z0-9_-]*)') AS calendar
       FROM messages m WHERE m.client_id = ANY($1) ORDER BY m.created_at`, [ids])).rows;
  const tasks = (await c.query(
    `SELECT client_id, source_workflow, title, done, created_at FROM tasks WHERE client_id = ANY($1) ORDER BY created_at`, [ids])).rows;
  await c.query("COMMIT");
  await c.end();

  const byId = Object.fromEntries(clients.map((x) => [x.id, Object.keys(state.people).find((k) => state.people[k].email === x.email)]));
  const out = { checkedAt: new Date().toISOString(), startedAt: state.startedAt, people: {} };
  for (const [key, p] of Object.entries(state.people)) {
    const cl = clients.find((x) => x.email === p.email);
    out.people[key] = {
      client: cl ? { is_demo: cl.is_demo, credit_tier: cl.credit_tier } : null,
      events: events.filter((e) => e.email === p.email || (cl && e.client_id === cl.id)).map((e) => `${e.created_at.toISOString()} ${e.name}`),
      messages: messages.filter((m) => cl && m.client_id === cl.id).map((m) => ({
        at: m.created_at.toISOString(), key: m.template_key, channel: m.channel, status: m.status,
        scheduled_at: m.scheduled_at ? m.scheduled_at.toISOString() : null, blocked: m.blocked_reason || null,
        resume_link: m.has_resume_link, calendar: m.calendar || null
      })),
      tasks: tasks.filter((t) => cl && t.client_id === cl.id).map((t) => `${t.created_at.toISOString()} ${t.source_workflow} "${t.title}" done=${t.done}`)
    };
  }
  // The come-back door, opened with the newest link Ana was sent. The code is used, never printed.
  const anaId = clients.find((x) => x.email === state.people.ana.email)?.id;
  const token = [...messages].reverse().find((m) => m.client_id === anaId && m.resume_token)?.resume_token;
  if (token) {
    const res = await fetch(`${SITE}/api/public/survey-resume?r=${encodeURIComponent(token)}`);
    const j = await res.json().catch(() => ({}));
    out.people.ana.door = { status: res.status, ok: j.ok, first_name: j.contact?.first_name, next_key: j.next_key, answered: Object.keys(j.answers || {}) };
  }
  for (const k of Object.keys(byId)) void k;
  fs.writeFileSync(`${HERE}check-${Date.now()}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

const cmd = process.argv[2];
if (cmd === "send") await send();
else if (cmd === "check") await check();
else console.log("usage: livetest.mjs send|check");
