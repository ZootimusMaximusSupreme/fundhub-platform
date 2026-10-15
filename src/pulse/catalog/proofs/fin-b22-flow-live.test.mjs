// Batch 22 live flow checks, tested. These are practice tests OF the checks: the real SQL text runs over
// stand-in rows (fin-b22-sql-kit.mjs), a healthy set is counted clean, and each single break is counted as
// exactly one wrong result. The check on the server reads real rows; this proves the text it runs goes red
// when the saved result is wrong and stays green when it is right.
//
// For every check:
//   * a healthy set counts its rows and none is wrong
//   * each named break has a stand-in row set that breaks only that condition, and it is counted wrong
//   * rows the check must leave alone (staff-typed, test traffic, too new, too old, another company) are not
//     counted wrong
//   * dropping any one condition from the text changes the answer for some stand-in set, so no condition is
//     dead weight

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  FIN_B22_LIVE, FIN_B22_LIVE_SURFACES, finB22LiveId, runFinB22Live, judgeLive,
  copyHash, reduceSignOff, reduceSqlOnlyKeys, EIN_PATTERN, realClient,
  NUDGE_SOURCE_WORKFLOW, NUDGE_STAFF_TASK_ROLE,
  NUDGE_CHASEABLE_STATES, NUDGE_BOUGHT_STATUSES, NUDGE_CHECKOUT_LINK_DAYS, NUDGE_WAITING_DAYS,
} from "./fin-b22-flow-live.mjs";
import { buildSqlTemplateSnapshot, SNAPSHOT_FILE } from "./fin-b22-sql-template-snapshot.mjs";
import { templateStatements } from "./fin-b22-sql-template-keys.mjs";
import snapshot from "./fin-b22-sql-template-keys.json" with { type: "json" };
import { makeStandIn, schemaColumns, columnsUsed, tablesIn, CTE_NAMES, NOW, REPO_ROOT } from "./fin-b22-sql-kit.mjs";
import { TEST_ADDRESS_RE, RECEIPT_AFTER_HOURS } from "../../coverage/gap-sms.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const MIN = 1;
const HOUR = 60;
const DAY = 24 * 60;
const clone = (v) => JSON.parse(JSON.stringify(v));
const spec = (surface) => FIN_B22_LIVE.find((s) => s.surface === surface);

// ── the fixtures ────────────────────────────────────────────────────────────
// tables: {table: rows[]}; sample: expected sample_count; breaks: {condition: [[label, fn, {bad?}]]};
// ignored: [[label, fn, {sample?}]]; drops: [[label, from, to]] (a piece of the SQL text and its stand-in).
// fn mutates a fresh clone of the healthy tables.
const FIXTURES = new Map();

const find = (rows, id) => rows.find((r) => r.id === id);
const drop = (rows, id) => rows.splice(rows.findIndex((r) => r.id === id), 1);

// ── sms duplicates ──────────────────────────────────────────────────────────
{
  const PHONE = "+16025550101";
  const sms = (id, over = {}) => ({
    id, org_id: ORG, direction: "outbound", channel: "sms", status: "sent", template_key: "SMS-S00-WELCOME",
    rendered_body: "Hey Dana, it is Fundhub.", to_address: PHONE, client_id: u(900), sender_staff_id: null,
    is_demo: false, created_at: ago(300), last_attempt_at: ago(180), ...over,
  });
  FIXTURES.set("dispatch:sms-duplicate-guard-NOT-WIRED", {
    tables: {
      clients: [{ id: u(900), org_id: ORG, email: "dana@fundhub-client.test.io", is_demo: false, custom_fields: {} }],
      messages: [
        sms(u(1)),
        sms(u(2), { last_attempt_at: ago(120) }),                                   // same template, 60 min later: fine
        sms(u(3), { template_key: "SMS-S04-01-CONFIRM", last_attempt_at: ago(119) }), // other template: fine
        sms(u(4), { to_address: "+16025550102", last_attempt_at: ago(118) }),        // other phone: fine
      ],
    },
    sample: 4,
    breaks: {
      "the same template to the same phone twice inside 30 minutes": [
        ["welcome again 10 minutes after the first", (t) => t.messages.push(sms(u(5), { last_attempt_at: ago(170) }))],
      ],
      "the same words with no template to the same phone twice inside 30 minutes": [
        ["two untemplated texts, same body, 5 minutes apart", (t) => {
          t.messages.push(sms(u(5), { template_key: null, rendered_body: "Your docs are in.", last_attempt_at: ago(60) }));
          t.messages.push(sms(u(6), { template_key: null, rendered_body: "Your docs are in.", last_attempt_at: ago(55) }));
        }, { sample: 6 }],
      ],
      "a delivered copy counts the same as a sent one": [
        ["second copy already delivered", (t) => t.messages.push(sms(u(5), { status: "delivered", last_attempt_at: ago(175) }))],
      ],
      // dispatch.mjs claimDue and claimOne stamp last_attempt_at with now() for every row of one batch.
      "two identical texts claimed in one dispatch pass carry the same instant": [
        ["a pair at one instant (the likeliest duplicate)", (t) => {
          t.messages.push(sms(u(5), { to_address: "+16025550160", last_attempt_at: ago(90) }));
          t.messages.push(sms(u(6), { to_address: "+16025550160", last_attempt_at: ago(90) }));
        }, { sample: 6 }],
        ["three copies at one instant count two later sends", (t) => {
          t.messages.push(sms(u(5), { to_address: "+16025550160", last_attempt_at: ago(90) }));
          t.messages.push(sms(u(6), { to_address: "+16025550160", last_attempt_at: ago(90) }));
          t.messages.push(sms(u(7), { to_address: "+16025550160", last_attempt_at: ago(90) }));
        }, { sample: 7, bad: 2 }],
        ["no attempt time on either, the same created time", (t) => {
          t.messages.push(sms(u(5), { to_address: "+16025550160", last_attempt_at: null, created_at: ago(90) }));
          t.messages.push(sms(u(6), { to_address: "+16025550160", last_attempt_at: null, created_at: ago(90) }));
        }, { sample: 6 }],
        ["two untemplated texts with the same words at one instant", (t) => {
          t.messages.push(sms(u(5), { template_key: null, rendered_body: "Your docs are in.", to_address: "+16025550160", last_attempt_at: ago(90) }));
          t.messages.push(sms(u(6), { template_key: null, rendered_body: "Your docs are in.", to_address: "+16025550160", last_attempt_at: ago(90) }));
        }, { sample: 6 }],
      ],
      "the same phone typed two ways": [
        ["(602) 555-0101 against +16025550101", (t) => t.messages.push(sms(u(5), { to_address: "(602) 555-0101", last_attempt_at: ago(170) }))],
        ["+1 602-555-0101 against +16025550101", (t) => t.messages.push(sms(u(5), { to_address: "+1 602-555-0101", last_attempt_at: ago(170) }))],
      ],
    },
    ignored: [
      ["a person pressed Send twice (staff-typed)", (t) => t.messages.push(sms(u(5), { sender_staff_id: u(950), last_attempt_at: ago(170) })), { sample: 4 }],
      ["a duplicate that never left (failed)", (t) => t.messages.push(sms(u(5), { status: "failed", last_attempt_at: ago(170) })), { sample: 4 }],
      ["a duplicate still waiting (queued)", (t) => t.messages.push(sms(u(5), { status: "queued", last_attempt_at: null, created_at: ago(170) })), { sample: 4 }],
      ["31 minutes apart is not a duplicate", (t) => {
        t.messages.push(sms(u(5), { to_address: "+16025550150", last_attempt_at: ago(260) }));
        t.messages.push(sms(u(6), { to_address: "+16025550150", last_attempt_at: ago(229) }));
      }, { sample: 6 }],
      ["an email with the same template to the same address twice (the address carries ten digits)", (t) => {
        t.messages.push(sms(u(5), { channel: "email", to_address: "6025550101@fundhub-client.test.io", last_attempt_at: ago(100) }));
        t.messages.push(sms(u(6), { channel: "email", to_address: "6025550101@fundhub-client.test.io", last_attempt_at: ago(95) }));
      }, { sample: 4 }],
      ["the same words to the same phone before the lookback window", (t) => {
        t.messages.push(sms(u(5), { last_attempt_at: ago(20 * DAY) }));
        t.messages.push(sms(u(6), { last_attempt_at: ago(20 * DAY - 5) }));
      }, { sample: 4 }],
      ["an inbound message with the same words", (t) => t.messages.push(sms(u(5), { direction: "inbound", last_attempt_at: ago(170) })), { sample: 4 }],
      ["a demo message", (t) => t.messages.push(sms(u(5), { is_demo: true, last_attempt_at: ago(170) })), { sample: 4 }],
      ["a test client's duplicate", (t) => {
        t.clients.push({ id: u(901), org_id: ORG, email: "qa@example.com", is_demo: false, custom_fields: {} });
        t.messages.push(sms(u(5), { client_id: u(901), to_address: "+16025550177", last_attempt_at: ago(100) }));
        t.messages.push(sms(u(6), { client_id: u(901), to_address: "+16025550177", last_attempt_at: ago(95) }));
      }, { sample: 4 }],
      ["a synthetic client's duplicate", (t) => {
        t.clients.push({ id: u(902), org_id: ORG, email: "syn@fundhub-client.test.io", is_demo: false, custom_fields: { synthetic: "true" } });
        t.messages.push(sms(u(5), { client_id: u(902), to_address: "+16025550178", last_attempt_at: ago(100) }));
        t.messages.push(sms(u(6), { client_id: u(902), to_address: "+16025550178", last_attempt_at: ago(95) }));
      }, { sample: 4 }],
      ["another company's duplicate", (t) => {
        t.messages.push(sms(u(5), { org_id: OTHER, last_attempt_at: ago(170) }));
      }, { sample: 4 }],
      ["a message with no phone", (t) => {
        t.messages.push(sms(u(5), { to_address: "  ", last_attempt_at: ago(100) }));
        t.messages.push(sms(u(6), { to_address: "  ", last_attempt_at: ago(95) }));
      }, { sample: 4 }],
      ["two different phones at one instant", (t) => {
        t.messages.push(sms(u(5), { to_address: "+16025550161", last_attempt_at: ago(90) }));
        t.messages.push(sms(u(6), { to_address: "+16025550162", last_attempt_at: ago(90) }));
      }, { sample: 6 }],
      ["two different templates to one phone at one instant", (t) => {
        t.messages.push(sms(u(5), { to_address: "+16025550160", last_attempt_at: ago(90) }));
        t.messages.push(sms(u(6), { template_key: "SMS-S04-01-CONFIRM", to_address: "+16025550160", last_attempt_at: ago(90) }));
      }, { sample: 6 }],
      ["the same words 31 minutes apart at the same phone typed two ways", (t) => {
        t.messages.push(sms(u(5), { to_address: "+16025550163", last_attempt_at: ago(260) }));
        t.messages.push(sms(u(6), { to_address: "(602) 555-0163", last_attempt_at: ago(229) }));
      }, { sample: 6 }],
    ],
    drops: [
      ["company scope", "m.org_id = $1::uuid", "1 = 1"],
      ["outbound only", "m.direction = 'outbound'", "1 = 1"],
      ["texts only", "m.channel = 'sms'", "1 = 1"],
      ["left the building", "m.status IN ('sent', 'delivered')", "1 = 1"],
      ["not staff typed", "AND m.sender_staff_id IS NULL", ""],
      ["inside the lookback", "AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz", ""],
      ["not demo", "COALESCE(m.is_demo, false) = false", "1 = 1"],
      ["not a test client", "AND NOT EXISTS (\n           SELECT 1 FROM clients cl", "AND NOT NOT EXISTS (\n           SELECT 1 FROM clients cl"],
      ["earlier send", "WHERE (p.sent_at < a.sent_at OR (p.sent_at = a.sent_at AND p.id < a.id))", "WHERE 1 = 1"],
      ["a tie is broken by the id, so a pair at one instant still counts", " OR (p.sent_at = a.sent_at AND p.id < a.id)", ""],
      ["no phone digits at all is no phone", "AND NULLIF(regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g'), '') IS NOT NULL", ""],
      ["the phone is its digits", "right(regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g'), 10) AS phone", "right(COALESCE(m.to_address, ''), 10) AS phone"],
      ["the phone is its last ten digits", "right(regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g'), 10) AS phone", "regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g') AS phone"],
      ["inside the guard window", "AND p.sent_at >= a.sent_at - interval '30 minutes'", ""],
      ["same template", "(a.template_key IS NOT NULL AND p.template_key = a.template_key)", "1 = 0"],
      ["same words when untemplated", "OR (a.template_key IS NULL AND p.template_key IS NULL AND p.rendered_body = a.rendered_body)", ""],
      ["same phone", "JOIN sms p ON p.phone = a.phone", "JOIN sms p ON 1 = 1"],
    ],
  });
}

// ── staff replies ───────────────────────────────────────────────────────────
{
  const reply = (id, over = {}) => ({
    id, org_id: ORG, direction: "outbound", channel: "sms", status: "delivered", sender_staff_id: u(950),
    provider_message_id: `SM${id.slice(-4)}`, is_demo: false, created_at: ago(2 * HOUR), last_attempt_at: ago(2 * HOUR - 1),
    scheduled_at: null, ...over,
  });
  FIXTURES.set("job:staff-message-sweeper", {
    tables: {
      messages: [
        reply(u(1)),
        reply(u(2), { status: "sent", last_attempt_at: ago(3 * HOUR) }),
        reply(u(3), { status: "queued", provider_message_id: null, scheduled_at: ago(MIN * 20), last_attempt_at: null, created_at: ago(5 * HOUR) }),
      ],
    },
    sample: 3,
    breaks: {
      "a reply is still queued 30 minutes after it was due": [
        ["queued, due 45 minutes ago", (t) => { find(t.messages, u(3)).scheduled_at = ago(45); }],
        ["queued, never given a time, typed 40 minutes ago", (t) => {
          const row = find(t.messages, u(3));
          row.scheduled_at = null;
          row.created_at = ago(40);
        }],
      ],
      "a reply is stuck on sending": [
        ["sending for 40 minutes", (t) => { Object.assign(find(t.messages, u(3)), { status: "sending", last_attempt_at: ago(40) }); }],
      ],
      "a reply says it left and carries no provider id": [
        ["sent, no provider id", (t) => { find(t.messages, u(2)).provider_message_id = null; }],
        ["delivered, blank provider id", (t) => { find(t.messages, u(1)).provider_message_id = "  "; }],
      ],
      "a reply ended failed or bounced and never reached the customer": [
        ["the provider turned it down (failed)", (t) => { Object.assign(find(t.messages, u(1)), { status: "failed", provider_message_id: null }); }],
        ["the sender gave up (failed, a provider id was kept)", (t) => { find(t.messages, u(1)).status = "failed"; }],
        ["the address bounced (bounced)", (t) => { find(t.messages, u(2)).status = "bounced"; }],
        ["an email that bounced a week after it was typed, inside the lookback", (t) => {
          Object.assign(find(t.messages, u(2)), { status: "bounced", channel: "email", created_at: ago(6 * DAY), last_attempt_at: ago(6 * DAY) });
        }],
      ],
      "a reply left and got no receipt for a day": [
        ["sent 25 hours ago, still sent", (t) => { find(t.messages, u(2)).last_attempt_at = ago(25 * HOUR); }],
        ["an email, the same", (t) => { Object.assign(find(t.messages, u(2)), { channel: "email", last_attempt_at: ago(25 * HOUR) }); }],
      ],
    },
    ignored: [
      ["held overnight, due in 4 hours", (t) => { find(t.messages, u(3)).scheduled_at = ago(-4 * HOUR); }],
      ["queued 10 minutes ago and due now", (t) => { Object.assign(find(t.messages, u(3)), { scheduled_at: null, created_at: ago(10) }); }],
      ["sent 23 hours ago and waiting on its receipt", (t) => { find(t.messages, u(2)).last_attempt_at = ago(23 * HOUR); }],
      ["a customer text from a workflow (no staff member)", (t) => t.messages.push(reply(u(9), { sender_staff_id: null, status: "queued", provider_message_id: null, scheduled_at: ago(5 * HOUR) })), { sample: 3 }],
      ["a reply typed before the lookback", (t) => t.messages.push(reply(u(9), { status: "queued", provider_message_id: null, scheduled_at: ago(9 * DAY), created_at: ago(10 * DAY) })), { sample: 3 }],
      ["a demo reply", (t) => t.messages.push(reply(u(9), { is_demo: true, status: "queued", provider_message_id: null, scheduled_at: ago(5 * HOUR) })), { sample: 3 }],
      ["another company's stuck reply", (t) => t.messages.push(reply(u(9), { org_id: OTHER, status: "queued", provider_message_id: null, scheduled_at: ago(5 * HOUR) })), { sample: 3 }],
      ["an inbound message", (t) => t.messages.push(reply(u(9), { direction: "inbound", status: "queued", provider_message_id: null, scheduled_at: ago(5 * HOUR) })), { sample: 3 }],
      ["blocked by the gate is a final answer", (t) => t.messages.push(reply(u(9), { status: "blocked", provider_message_id: null })), { sample: 4 }],
    ],
    drops: [
      ["company scope", "m.org_id = $1::uuid", "1 = 1"],
      ["outbound only", "m.direction = 'outbound'", "1 = 1"],
      ["failed", "m.status IN ('failed', 'bounced')\n         OR ", "1 = 0\n         OR "],
      ["failed alone", "m.status IN ('failed', 'bounced')", "m.status IN ('bounced')"],
      ["bounced alone", "m.status IN ('failed', 'bounced')", "m.status IN ('failed')"],
      ["staff typed only", "AND m.sender_staff_id IS NOT NULL", ""],
      ["not demo", "AND COALESCE(m.is_demo, false) = false", ""],
      ["inside the lookback", "AND m.created_at >= $2::timestamptz", ""],
      ["queued past due", "(m.status = 'queued' AND COALESCE(m.scheduled_at, m.created_at) < $3::timestamptz)", "1 = 0"],
      ["stuck sending", "OR (m.status = 'sending' AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz)", ""],
      ["no provider id", "OR (m.status IN ('sent', 'delivered') AND NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NULL)", ""],
      ["no receipt", "OR (m.status = 'sent' AND m.channel IN ('sms', 'email')\n             AND COALESCE(m.last_attempt_at, m.created_at) < $4::timestamptz)", ""],
    ],
  });
}

// ── owner alert queue ───────────────────────────────────────────────────────
{
  const note = (id, over = {}) => ({
    id, org_id: ORG, status: "sent", channel: "sms", title: "Alert", body: "Alert", sent_at: ago(HOUR), created_at: ago(3 * HOUR), ...over,
  });
  FIXTURES.set("owner-alert:owner_notifications queue (finance alerts)", {
    tables: { owner_notifications: [note(u(1)), note(u(2), { status: "queued", sent_at: null, created_at: ago(30) })] },
    sample: 2,
    breaks: {
      "an alert waited more than an hour for a sender": [
        ["queued 3 hours", (t) => { find(t.owner_notifications, u(2)).created_at = ago(3 * HOUR); }],
      ],
      "an alert failed": [["failed", (t) => { find(t.owner_notifications, u(1)).status = "failed"; }]],
    },
    ignored: [
      ["queued 30 minutes ago, still inside the grace", () => {}],
      ["queued before the lookback", (t) => t.owner_notifications.push(note(u(9), { status: "queued", sent_at: null, created_at: ago(100 * DAY) })), { sample: 2 }],
      ["another company's queued alert", (t) => t.owner_notifications.push(note(u(9), { org_id: OTHER, status: "queued", sent_at: null, created_at: ago(5 * HOUR) })), { sample: 2 }],
    ],
    drops: [
      ["company scope", "n.org_id = $1::uuid", "1 = 1"],
      ["inside the lookback", "AND n.created_at >= $2::timestamptz", ""],
      ["failed", "WHERE n.status = 'failed'\n         OR", "WHERE"],
      ["queued past the grace", "OR (n.status = 'queued' AND n.created_at < $3::timestamptz)", ""],
    ],
  });
}

// ── twilio receipts ─────────────────────────────────────────────────────────
{
  const text = (id, over = {}) => ({
    id, org_id: ORG, direction: "outbound", channel: "sms", status: "delivered", provider_message_id: `SM${id.slice(-4)}`,
    to_address: "+16025550101", client_id: null, is_demo: false, created_at: ago(5 * HOUR), last_attempt_at: ago(5 * HOUR - 1), ...over,
  });
  FIXTURES.set("receipt:twilio-status-webhook", {
    tables: {
      clients: [],
      messages: [
        text(u(1), { last_attempt_at: ago(30 * HOUR) }),
        text(u(2), { status: "failed", last_attempt_at: ago(30 * HOUR) }),
        text(u(3), { status: "sent", last_attempt_at: ago(2 * HOUR) }),
      ],
    },
    sample: 3,
    breaks: {
      "a text sat on sent for a day with no receipt": [
        ["sent 26 hours ago", (t) => { find(t.messages, u(3)).last_attempt_at = ago(26 * HOUR); }],
      ],
    },
    ignored: [
      ["sent 20 hours ago, the receipt may still come", (t) => { find(t.messages, u(3)).last_attempt_at = ago(20 * HOUR); }],
      ["an email on sent for days", (t) => t.messages.push(text(u(9), { channel: "email", status: "sent", last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
      ["a text with no provider id (never reached the carrier)", (t) => t.messages.push(text(u(9), { status: "sent", provider_message_id: null, last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
      ["a text still queued", (t) => t.messages.push(text(u(9), { status: "queued", last_attempt_at: null })), { sample: 3 }],
      ["an inbound text", (t) => t.messages.push(text(u(9), { direction: "inbound", status: "sent", last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
      ["a test address", (t) => t.messages.push(text(u(9), { to_address: "e2e+qa@example.com", status: "sent", last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
      ["a demo text", (t) => t.messages.push(text(u(9), { is_demo: true, status: "sent", last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
      ["before the lookback", (t) => t.messages.push(text(u(9), { status: "sent", last_attempt_at: ago(40 * DAY) })), { sample: 3 }],
      ["another company's text", (t) => t.messages.push(text(u(9), { org_id: OTHER, status: "sent", last_attempt_at: ago(3 * DAY) })), { sample: 3 }],
    ],
    drops: [
      ["company scope", "m.org_id = $1::uuid", "1 = 1"],
      ["outbound only", "m.direction = 'outbound'", "1 = 1"],
      ["texts only", "m.channel = 'sms'", "1 = 1"],
      ["has a provider id", "AND NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NOT NULL", ""],
      ["inside the lookback", "AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz", ""],
      ["still on sent", "WHERE m.status = 'sent'\n         AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz", "WHERE COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz"],
      ["test traffic", "AND COALESCE(m.to_address, '') !~* $4::text", ""],
    ],
  });
}

// ── template delivery ───────────────────────────────────────────────────────
{
  const sent = (id, key, over = {}) => ({
    id, org_id: ORG, direction: "outbound", channel: "sms", template_key: key, status: "delivered", is_demo: false,
    to_address: "+16025550101", client_id: null, created_at: ago(3 * DAY), ...over,
  });
  FIXTURES.set("manual-proof:comms-map-2026-09-19 (template delivery proof)", {
    tables: {
      clients: [],
      messages: [
        // SMS-A: one send before its delivery, one delivery. EMAIL-B: the same, by email.
        sent(u(2), "SMS-A", { status: "sent", created_at: ago(4 * DAY) }), sent(u(1), "SMS-A"),
        sent(u(4), "EMAIL-B", { channel: "email", status: "sent", to_address: "a@fundhub-client.test.io", created_at: ago(4 * DAY) }),
        sent(u(3), "EMAIL-B", { channel: "email", to_address: "a@fundhub-client.test.io" }),
      ],
    },
    sample: 2,
    breaks: {
      "a template sent twice or more and never delivered": [
        ["two old texts, both still sent", (t) => {
          t.messages.push(sent(u(5), "SMS-C", { status: "sent" }));
          t.messages.push(sent(u(6), "SMS-C", { status: "failed" }));
        }, { sample: 3 }],
        ["an email template that only ever bounced", (t) => {
          t.messages.push(sent(u(5), "EMAIL-D", { channel: "email", status: "bounced", to_address: "b@fundhub-client.test.io" }));
          t.messages.push(sent(u(6), "EMAIL-D", { channel: "email", status: "sent", to_address: "b@fundhub-client.test.io" }));
        }, { sample: 3 }],
      ],
      // The old read was red only when a template had NO delivery in the whole window, so one delivered
      // row shielded every later failure.
      "a template that delivered once and has failed every send since": [
        ["delivered 12 days ago, then a failure and a send with no receipt", (t) => {
          t.messages.push(sent(u(5), "SMS-C", { created_at: ago(12 * DAY) }));
          t.messages.push(sent(u(6), "SMS-C", { status: "failed", created_at: ago(3 * DAY) }));
          t.messages.push(sent(u(7), "SMS-C", { status: "sent", created_at: ago(2 * DAY) }));
        }, { sample: 3 }],
        ["delivered 13 days ago, then thirty failures in the last two days", (t) => {
          t.messages.push(sent(u(5), "SMS-C", { created_at: ago(13 * DAY) }));
          for (let i = 0; i < 30; i += 1) t.messages.push(sent(u(100 + i), "SMS-C", { status: "failed", created_at: ago(2 * DAY - i) }));
        }, { sample: 3 }],
        ["delivered five days ago, then two bounces", (t) => {
          t.messages.push(sent(u(5), "EMAIL-D", { channel: "email", created_at: ago(5 * DAY), to_address: "b@fundhub-client.test.io" }));
          t.messages.push(sent(u(6), "EMAIL-D", { channel: "email", status: "bounced", created_at: ago(3 * DAY), to_address: "c@fundhub-client.test.io" }));
          t.messages.push(sent(u(7), "EMAIL-D", { channel: "email", status: "bounced", created_at: ago(2 * DAY), to_address: "d@fundhub-client.test.io" }));
        }, { sample: 3 }],
      ],
    },
    ignored: [
      ["one old row is not enough to judge", (t) => t.messages.push(sent(u(5), "SMS-C", { status: "sent" })), { sample: 3 }],
      ["one failure after the last delivery is not enough", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { created_at: ago(10 * DAY) }));
        t.messages.push(sent(u(6), "SMS-C", { status: "failed", created_at: ago(3 * DAY) }));
      }, { sample: 3 }],
      ["failures before the last delivery are history", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "failed", created_at: ago(9 * DAY) }));
        t.messages.push(sent(u(6), "SMS-C", { status: "failed", created_at: ago(8 * DAY) }));
        t.messages.push(sent(u(7), "SMS-C", { created_at: ago(3 * DAY) }));
      }, { sample: 3 }],
      ["a complaint is a delivery (the person got it)", (t) => {
        t.messages.push(sent(u(5), "EMAIL-D", { channel: "email", status: "failed", created_at: ago(9 * DAY), to_address: "b@fundhub-client.test.io" }));
        t.messages.push(sent(u(6), "EMAIL-D", { channel: "email", status: "failed", created_at: ago(8 * DAY), to_address: "b@fundhub-client.test.io" }));
        t.messages.push(sent(u(7), "EMAIL-D", { channel: "email", status: "complained", created_at: ago(3 * DAY), to_address: "b@fundhub-client.test.io" }));
      }, { sample: 3 }],
      ["two rows younger than a day", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "sent", created_at: ago(5 * HOUR) }));
        t.messages.push(sent(u(6), "SMS-C", { status: "sent", created_at: ago(4 * HOUR) }));
      }, { sample: 3 }],
      ["two failures younger than a day after a delivery", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { created_at: ago(3 * DAY) }));
        t.messages.push(sent(u(6), "SMS-C", { status: "failed", created_at: ago(5 * HOUR) }));
        t.messages.push(sent(u(7), "SMS-C", { status: "failed", created_at: ago(4 * HOUR) }));
      }, { sample: 3 }],
      ["a staff-typed text has no template", (t) => {
        t.messages.push(sent(u(5), null, { status: "sent" }));
        t.messages.push(sent(u(6), null, { status: "sent" }));
      }, { sample: 2 }],
      ["a test address", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "sent", to_address: "e2e+x@example.com" }));
        t.messages.push(sent(u(6), "SMS-C", { status: "sent", to_address: "e2e+y@example.com" }));
      }, { sample: 2 }],
      ["a demo message", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "sent", is_demo: true }));
        t.messages.push(sent(u(6), "SMS-C", { status: "sent", is_demo: true }));
      }, { sample: 2 }],
      ["before the 14 day window", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "sent", created_at: ago(20 * DAY) }));
        t.messages.push(sent(u(6), "SMS-C", { status: "sent", created_at: ago(19 * DAY) }));
      }, { sample: 2 }],
      ["another company's template", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { org_id: OTHER, status: "sent" }));
        t.messages.push(sent(u(6), "SMS-C", { org_id: OTHER, status: "sent" }));
      }, { sample: 2 }],
      ["inbound rows are not sends", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { direction: "inbound", status: "sent" }));
        t.messages.push(sent(u(6), "SMS-C", { direction: "inbound", status: "sent" }));
      }, { sample: 2 }],
      ["a message that was blocked never counted as a send", (t) => {
        t.messages.push(sent(u(5), "SMS-C", { status: "blocked" }));
        t.messages.push(sent(u(6), "SMS-C", { status: "blocked" }));
      }, { sample: 2 }],
    ],
    drops: [
      ["company scope", "m.org_id = $1::uuid", "1 = 1"],
      ["outbound only", "m.direction = 'outbound'", "1 = 1"],
      ["templated only", "AND m.template_key IS NOT NULL", ""],
      ["real statuses only", "AND m.status IN ('queued', 'sending', 'sent', 'delivered', 'complained', 'failed', 'bounced')", ""],
      ["inside the window", "AND m.created_at >= $2::timestamptz", ""],
      ["old enough", "s.created_at < $3::timestamptz", "1 = 1"],
      ["after the last delivery", "AND (o.ok_at IS NULL OR s.created_at > o.ok_at)", "AND o.ok_at IS NULL"],
      ["a template that never delivered counts every send", "o.ok_at IS NULL OR s.created_at > o.ok_at", "s.created_at > o.ok_at"],
      ["a complaint is a delivery", "WHERE s.status IN ('delivered', 'complained')", "WHERE s.status IN ('delivered')"],
      ["its own template's delivery", "o.template_key = s.template_key AND ", ""],
      ["enough rows", "dead_n >= 2", "dead_n >= 0"],
      ["test traffic", "AND COALESCE(m.to_address, '') !~* $4::text", ""],
    ],
  });
}

// ── waypoint nudges ─────────────────────────────────────────────────────────
{
  const nudge = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(900), waypoint_id: u(800), step: 1, kind: "client_message", channel: "sms",
    template_key: "SMS-WAYPOINT-DUE", outcome: "queued", message_id: u(500), task_id: null, idempotency_key: `k${id}`,
    created_at: ago(3 * HOUR), ...over,
  });
  const message = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(900), direction: "outbound", channel: "sms", template_key: "SMS-WAYPOINT-DUE",
    status: "delivered", created_at: ago(3 * HOUR), last_attempt_at: ago(3 * HOUR - 1), scheduled_at: null, ...over,
  });
  const task = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(900), source_workflow: NUDGE_SOURCE_WORKFLOW, assignee_role: NUDGE_STAFF_TASK_ROLE, title: "Client stalled", ...over,
  });
  const client = (id, over = {}) => ({ id, org_id: ORG, email: "dana@fundhub-client.test.io", is_demo: false, custom_fields: {}, ...over });
  // a client-owned item that came due `days` days ago
  const waypoint = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(901), key: "upload-id", title: "Upload your ID", owner_kind: "client", state: "not_started",
    due_at: ago(5 * DAY), completed_at: null, ...over,
  });
  FIXTURES.set("workflow:waypoint-nudge-sweeper", {
    tables: {
      clients: [client(u(900)), client(u(901), { email: "lee@fundhub-client.test.io" })],
      waypoint_nudges: [
        nudge(u(1)),
        nudge(u(2), { step: 2, channel: "email", template_key: "EMAIL-WAYPOINT-NUDGE-1", message_id: u(501) }),
        nudge(u(3), { step: 3, template_key: "SMS-WAYPOINT-NUDGE-2", message_id: u(502) }),
        nudge(u(4), { step: 4, kind: "staff_task", channel: null, template_key: null, outcome: "staff_task", message_id: null, task_id: u(700) }),
        nudge(u(5), { outcome: "no_contact", message_id: null, waypoint_id: u(801) }),
        nudge(u(6), { outcome: "refused", detail: "opted_out", message_id: null, waypoint_id: u(802) }),
      ],
      messages: [
        message(u(500)),
        message(u(501), { channel: "email", template_key: "EMAIL-WAYPOINT-NUDGE-1", status: "sent" }),
        message(u(502), { template_key: "SMS-WAYPOINT-NUDGE-2", status: "queued", scheduled_at: ago(-2 * HOUR), last_attempt_at: null }),
      ],
      tasks: [task(u(700))],
      // the ladder has rows for these three items, so none of them is a client nobody chases
      client_waypoints: [
        waypoint(u(800), { client_id: u(900), due_at: ago(10 * DAY) }),
        waypoint(u(801), { client_id: u(900), due_at: ago(10 * DAY) }),
        waypoint(u(802), { client_id: u(900), due_at: ago(10 * DAY) }),
      ],
      opt_outs: [],
      client_escalations: [],
      repair_programs: [],
      paid_service_requests: [],
    },
    sample: 6,
    breaks: {
      "a rung was claimed and the process died before it queued anything": [
        ["claimed 40 minutes ago", (t) => Object.assign(find(t.waypoint_nudges, u(1)), { outcome: "claimed", message_id: null, created_at: ago(40) })],
      ],
      "a rung was spent because the template is not approved": [
        ["template_pending", (t) => Object.assign(find(t.waypoint_nudges, u(5)), { outcome: "template_pending" })],
      ],
      // src/nudge/run.mjs writes "refused" with the reason in detail. Only the client's own opt-out is right.
      "a rung was refused and the client got nothing": [
        ["the template is still placeholder copy (draft_template)", (t) => Object.assign(find(t.waypoint_nudges, u(6)), { detail: "draft_template" })],
        ["the send threw (error:...)", (t) => Object.assign(find(t.waypoint_nudges, u(6)), { detail: "error:connection reset" })],
        ["refused with no reason saved", (t) => Object.assign(find(t.waypoint_nudges, u(6)), { detail: null })],
      ],
      "a queued rung has no message behind it": [
        ["no message id", (t) => { find(t.waypoint_nudges, u(1)).message_id = null; }],
        ["message row gone", (t) => drop(t.messages, u(500))],
        ["message in another company", (t) => { find(t.messages, u(500)).org_id = OTHER; }],
      ],
      "a queued rung's message is the wrong one": [
        ["another template", (t) => { find(t.messages, u(500)).template_key = "SMS-S00-WELCOME"; }],
        ["another channel", (t) => { find(t.messages, u(500)).channel = "email"; }],
        ["another client", (t) => { find(t.messages, u(500)).client_id = u(901); }],
        ["an inbound message", (t) => { find(t.messages, u(500)).direction = "inbound"; }],
        ["a template that is not on the ladder", (t) => { find(t.waypoint_nudges, u(1)).template_key = "SMS-S00-WELCOME"; find(t.messages, u(500)).template_key = "SMS-S00-WELCOME"; }],
        ["no template named anywhere", (t) => { find(t.waypoint_nudges, u(1)).template_key = null; find(t.messages, u(500)).template_key = null; }],
      ],
      "a queued rung's message is stuck": [
        ["queued and due 45 minutes ago", (t) => Object.assign(find(t.messages, u(500)), { status: "queued", scheduled_at: null, created_at: ago(45), last_attempt_at: null })],
        ["sending for 45 minutes", (t) => Object.assign(find(t.messages, u(500)), { status: "sending", last_attempt_at: ago(45) })],
      ],
      // dispatch.mjs finalise() writes failed (provider rejected, or gave up after its attempts), the status
      // receipt writes bounced, the gate writes blocked. None of those is a delivered client message.
      "a queued rung's message ended without reaching the client": [
        ["failed (the provider rejected it)", (t) => { find(t.messages, u(500)).status = "failed"; }],
        ["bounced", (t) => { find(t.messages, u(501)).status = "bounced"; }],
        ["blocked by the gate for restricted wording", (t) => Object.assign(find(t.messages, u(500)), { status: "blocked", blocked_reason: "restricted_phrase" })],
        ["blocked with no reason saved", (t) => Object.assign(find(t.messages, u(500)), { status: "blocked", blocked_reason: null })],
      ],
      "step 4 did not make its staff task": [
        ["no task id", (t) => { find(t.waypoint_nudges, u(4)).task_id = null; }],
        ["task row gone", (t) => drop(t.tasks, u(700))],
        ["task from another workflow", (t) => { find(t.tasks, u(700)).source_workflow = "other-flow"; }],
        ["task for another client", (t) => { find(t.tasks, u(700)).client_id = u(901); }],
        ["task for the wrong role", (t) => { find(t.tasks, u(700)).assignee_role = "closer"; }],
        ["task in another company", (t) => { find(t.tasks, u(700)).org_id = OTHER; }],
      ],
      // A sweeper that runs and spends no rung at all leaves no wrong row behind, so the rungs cannot see it.
      "a client's overdue item has had nobody chasing it": [
        ["due 5 days ago, the ladder never wrote a row for this client", (t) => t.client_waypoints.push(waypoint(u(810))), { sample: 7 }],
        ["due 400 days ago", (t) => t.client_waypoints.push(waypoint(u(810), { due_at: ago(400 * DAY) })), { sample: 7 }],
        ["an item already started is still chased (in_progress)", (t) => t.client_waypoints.push(waypoint(u(810), { state: "in_progress" })), { sample: 7 }],
        ["the client was last chased on an older item before this one came due", (t) => {
          t.client_waypoints.push(waypoint(u(810), { client_id: u(902), due_at: ago(5 * DAY) }));
          t.clients.push(client(u(902), { email: "kim@fundhub-client.test.io" }));
          t.waypoint_nudges.push(nudge(u(20), { client_id: u(902), waypoint_id: u(811), created_at: ago(20 * DAY) }));
        }, { sample: 7 }],
        ["the payment link they were sent expired a week ago", (t) => {
          t.client_waypoints.push(waypoint(u(810)));
          t.paid_service_requests.push({ id: u(830), org_id: ORG, client_id: u(901), waypoint_id: u(810), status: "awaiting_payment", requested_at: ago(8 * DAY) });
        }, { sample: 7 }],
        ["a client who opted out and back in is chased again", (t) => {
          t.client_waypoints.push(waypoint(u(810)));
          t.opt_outs.push({ id: u(840), org_id: ORG, client_id: u(901), channel: "sms", opted_out_at: ago(9 * DAY), opted_in_at: ago(8 * DAY) });
        }, { sample: 7 }],
        ["a purchase on a different item does not cover this one", (t) => {
          t.client_waypoints.push(waypoint(u(810)));
          t.paid_service_requests.push({ id: u(830), org_id: ORG, client_id: u(901), waypoint_id: u(811), status: "paid", requested_at: ago(8 * DAY) });
        }, { sample: 7 }],
        ["a refunded purchase is not a purchase", (t) => {
          t.client_waypoints.push(waypoint(u(810)));
          t.paid_service_requests.push({ id: u(830), org_id: ORG, client_id: u(901), waypoint_id: u(810), status: "refunded", requested_at: ago(8 * DAY) });
        }, { sample: 7 }],
      ],
    },
    ignored: [
      ["claimed 5 minutes ago may still be queueing", (t) => Object.assign(find(t.waypoint_nudges, u(1)), { outcome: "claimed", message_id: null, created_at: ago(5) }), { bad: 0 }],
      ["no usable address is a normal outcome", () => {}],
      ["a held message due in the future", () => {}],
      ["a refusal because the client opted out is the system working", () => {}],
      ["a message blocked because the client opted out after it was queued", (t) => Object.assign(find(t.messages, u(500)), { status: "blocked", blocked_reason: "opted_out" })],
      ["a rung older than the lookback", (t) => t.waypoint_nudges.push(nudge(u(9), { outcome: "template_pending", message_id: null, created_at: ago(20 * DAY), waypoint_id: u(803) })), { sample: 6 }],
      ["another company's stuck rung", (t) => t.waypoint_nudges.push(nudge(u(9), { org_id: OTHER, outcome: "template_pending", message_id: null, waypoint_id: u(803) })), { sample: 6 }],
      ["a test client's stuck rung", (t) => {
        t.clients.push(client(u(903), { email: "qa@example.com" }));
        t.waypoint_nudges.push(nudge(u(9), { client_id: u(903), outcome: "refused", detail: "draft_template", message_id: null, waypoint_id: u(803) }));
      }, { sample: 6 }],
      ["a demo client's stuck rung", (t) => {
        t.clients.push(client(u(904), { is_demo: true }));
        t.waypoint_nudges.push(nudge(u(9), { client_id: u(904), outcome: "template_pending", message_id: null, waypoint_id: u(803) }));
      }, { sample: 6 }],
      ["a synthetic client's stuck rung", (t) => {
        t.clients.push(client(u(905), { custom_fields: { synthetic: "true" } }));
        t.waypoint_nudges.push(nudge(u(9), { client_id: u(905), outcome: "template_pending", message_id: null, waypoint_id: u(803) }));
      }, { sample: 6 }],
      // the waiting side: each one is a reason nobody should chase, so it is not a client left waiting
      ["the ladder spoke to this client since the item came due (one message a day)", (t) => t.client_waypoints.push(waypoint(u(810), { client_id: u(900) })), { sample: 7 }],
      ["overdue only 2 days, inside the grace", (t) => t.client_waypoints.push(waypoint(u(810), { due_at: ago(2 * DAY) })), { sample: 6 }],
      ["no due date is not overdue", (t) => t.client_waypoints.push(waypoint(u(810), { due_at: null })), { sample: 6 }],
      ["the item is Fundhub's to do", (t) => t.client_waypoints.push(waypoint(u(810), { owner_kind: "fundhub" })), { sample: 6 }],
      ["the item is done", (t) => t.client_waypoints.push(waypoint(u(810), { state: "done" })), { sample: 6 }],
      ["the item is blocked", (t) => t.client_waypoints.push(waypoint(u(810), { state: "blocked" })), { sample: 6 }],
      ["the item has a completed date", (t) => t.client_waypoints.push(waypoint(u(810), { completed_at: ago(DAY) })), { sample: 6 }],
      ["another company's overdue item", (t) => t.client_waypoints.push(waypoint(u(810), { org_id: OTHER })), { sample: 6 }],
      ["the client opted out", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.opt_outs.push({ id: u(840), org_id: ORG, client_id: u(901), channel: "sms", opted_out_at: ago(9 * DAY), opted_in_at: null });
      }, { sample: 6 }],
      ["the client opted out by email only (either channel stops the ladder)", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.opt_outs.push({ id: u(840), org_id: ORG, client_id: u(901), channel: "email", opted_out_at: ago(9 * DAY), opted_in_at: null });
      }, { sample: 6 }],
      ["the client escalated (a lawyer, a threat)", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.client_escalations.push({ id: u(841), org_id: ORG, client_id: u(901), said_at: ago(9 * DAY), matched_pattern: "lawyer" });
      }, { sample: 6 }],
      ["the program is complete", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.repair_programs.push({ id: u(842), org_id: ORG, client_id: u(901), status: "complete" });
      }, { sample: 6 }],
      ["the program is cancelled", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.repair_programs.push({ id: u(842), org_id: ORG, client_id: u(901), status: "cancelled" });
      }, { sample: 6 }],
      ["the client bought the paid alternative", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.paid_service_requests.push({ id: u(830), org_id: ORG, client_id: u(901), waypoint_id: u(810), status: "paid", requested_at: ago(8 * DAY) });
      }, { sample: 6 }],
      ["a payment link is still live", (t) => {
        t.client_waypoints.push(waypoint(u(810)));
        t.paid_service_requests.push({ id: u(830), org_id: ORG, client_id: u(901), waypoint_id: u(810), status: "awaiting_payment", requested_at: ago(2 * DAY) });
      }, { sample: 6 }],
      ["a test client's overdue item", (t) => {
        t.clients.push(client(u(903), { email: "qa@example.com" }));
        t.client_waypoints.push(waypoint(u(810), { client_id: u(903) }));
      }, { sample: 6 }],
      ["a demo client's overdue item", (t) => {
        t.clients.push(client(u(904), { is_demo: true }));
        t.client_waypoints.push(waypoint(u(810), { client_id: u(904) }));
      }, { sample: 6 }],
      ["an item the ladder already has a row for", (t) => {
        t.client_waypoints.push(waypoint(u(810), { client_id: u(901) }));
        t.waypoint_nudges.push(nudge(u(21), { client_id: u(901), waypoint_id: u(810), created_at: ago(20 * DAY) }));
      }, { sample: 6 }],
    ],
    drops: [
      ["company scope", "n.org_id = $1::uuid", "1 = 1"],
      ["inside the lookback", "AND n.created_at >= $2::timestamptz", ""],
      ["claimed too long", "(n.outcome = 'claimed' AND n.created_at < $3::timestamptz)", "1 = 0"],
      ["template pending", "OR n.outcome = 'template_pending'", ""],
      ["refused for another reason", "OR (n.outcome = 'refused' AND COALESCE(n.detail, '') <> 'opted_out')", ""],
      ["a refusal with no reason is not the opt-out", "COALESCE(n.detail, '') <> 'opted_out'", "n.detail <> 'opted_out'"],
      ["named template", "n.template_key IS NULL\n                 OR n.template_key NOT IN", "n.template_key IS NULL AND 1 = 0\n                 OR n.template_key NOT IN"],
      ["outbound message", "OR m.direction IS DISTINCT FROM 'outbound'", ""],
      ["same template", "OR m.template_key IS DISTINCT FROM n.template_key", ""],
      ["same channel", "OR m.channel IS DISTINCT FROM n.channel", ""],
      ["same client", "OR m.client_id IS DISTINCT FROM n.client_id\n                 OR m.status IN", "OR m.status IN"],
      ["failed", "m.status IN ('failed', 'bounced')", "m.status IN ('bounced')"],
      ["bounced", "m.status IN ('failed', 'bounced')", "m.status IN ('failed')"],
      ["blocked", "OR (m.status = 'blocked' AND COALESCE(m.blocked_reason, '') NOT LIKE '%opted_out%')", ""],
      ["blocked for a reason that is not the opt-out", "AND COALESCE(m.blocked_reason, '') NOT LIKE '%opted_out%'", ""],
      ["queued stuck", "OR (m.status = 'queued' AND COALESCE(m.scheduled_at, m.created_at) < $4::timestamptz)", ""],
      ["sending stuck", "OR (m.status = 'sending' AND COALESCE(m.last_attempt_at, m.created_at) < $4::timestamptz)", ""],
      ["task from this workflow", "t.source_workflow IS DISTINCT FROM", "1 = 0 AND t.source_workflow IS DISTINCT FROM"],
      ["task for this client", "OR t.client_id IS DISTINCT FROM n.client_id", ""],
      ["task for the csm", "OR t.assignee_role IS DISTINCT FROM", "OR 1 = 0 AND t.assignee_role IS DISTINCT FROM"],
      ["message joined in this company", "LEFT JOIN messages m ON m.id = n.message_id AND m.org_id = n.org_id", "LEFT JOIN messages m ON m.id = n.message_id"],
      ["task joined in this company", "LEFT JOIN tasks t ON t.id = n.task_id AND t.org_id = n.org_id", "LEFT JOIN tasks t ON t.id = n.task_id"],
      ["rungs for real clients only", realClient("n.client_id", "$5"), "1 = 1"],
      ["waiting: company scope", "w.org_id = $1::uuid", "1 = 1"],
      ["waiting: the client's own items only", "w.owner_kind = 'client'", "1 = 1"],
      ["waiting: chaseable states only", "AND w.state IN ('not_started', 'in_progress')", ""],
      ["waiting: not completed", "AND w.completed_at IS NULL", ""],
      ["waiting: past the grace", "AND w.due_at < $6::timestamptz", ""],
      ["waiting: never touched", "AND NOT EXISTS (SELECT 1 FROM waypoint_nudges y WHERE y.waypoint_id = w.id)", ""],
      ["waiting: a client who opted out", "WHERE o.client_id = w.client_id AND o.channel IN ('sms', 'email') AND o.opted_in_at IS NULL", "WHERE 1 = 0"],
      ["waiting: opted out and back in", "AND o.opted_in_at IS NULL", ""],
      ["waiting: escalated", "WHERE e.client_id = w.client_id", "WHERE 1 = 0"],
      ["waiting: program finished", "WHERE rp.client_id = w.client_id AND rp.status IN ('complete', 'cancelled')", "WHERE 1 = 0"],
      ["waiting: bought", "p.status IN ('paid', 'staged', 'fulfilled')", "1 = 0"],
      ["waiting: live payment link", "OR (p.status = 'awaiting_payment' AND p.requested_at >= $7::timestamptz)", ""],
      ["waiting: a link that expired", "AND p.requested_at >= $7::timestamptz", ""],
      ["waiting: payment is for this item", "WHERE p.waypoint_id = w.id", "WHERE 1 = 1"],
      ["waiting: real clients only", realClient("w.client_id", "$5"), "1 = 1"],
      ["waiting: spoken to since it came due", "WHERE x.client_id = g.client_id AND x.created_at >= g.due_at", "WHERE 1 = 0"],
      ["waiting: spoken to AFTER it came due", "AND x.created_at >= g.due_at", ""],
      ["waiting: the same client", "WHERE x.client_id = g.client_id", "WHERE 1 = 1"],
    ],
  });
}

// ── soft-pull companies ─────────────────────────────────────────────────────
{
  const company = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(900), name: "Acme Holdings LLC", age_months: 38,
    entity_data: { source: "soft_pull_approve", address_line1: "500 Commerce Way", city: "Tempe", state: "AZ", postal_code: "85281", ein: "12-3456789", extra_owner_name: null, incorporated_date: "2023-08" },
    ...over,
  });
  const withData = (patch) => (t, id = u(1)) => { Object.assign(find(t.businesses, id).entity_data, patch); };
  FIXTURES.set("journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files", {
    tables: {
      clients: [{ id: u(900), org_id: ORG, email: "dana@fundhub-client.test.io", is_demo: false, custom_fields: {} }],
      businesses: [
        company(u(1)),
        company(u(2), { name: "Beta Partners Inc", entity_data: { source: "soft_pull_approve", address_line1: "9 Main St", city: "Mesa", state: "NV", postal_code: "89101", ein: "98-7654321", extra_owner_name: "Pat Lee", incorporated_date: "2020-01" } }),
      ],
    },
    sample: 2,
    breaks: {
      "a saved company has no client behind it": [
        ["client row missing", (t) => { find(t.businesses, u(1)).client_id = u(999); }],
        ["client in another company", (t) => { t.clients[0].org_id = OTHER; }, { bad: 2 }],
      ],
      "a saved company has no name": [
        ["blank name", (t) => { find(t.businesses, u(1)).name = "  "; }],
        ["null name", (t) => { find(t.businesses, u(1)).name = null; }],
      ],
      "a saved company has no street": [["no street", (t) => withData({ address_line1: "" })(t)]],
      "a saved company has no two-letter state": [
        ["no state", (t) => withData({ state: "" })(t)],
        ["state spelled out", (t) => withData({ state: "Arizona" })(t)],
      ],
      "a saved company has no well-formed EIN": [
        ["no EIN", (t) => withData({ ein: "" })(t)],
        ["EIN without the dash", (t) => withData({ ein: "123456789" })(t)],
        ["EIN too short", (t) => withData({ ein: "12-34567" })(t)],
      ],
      "a saved company has no age": [["age missing", (t) => { find(t.businesses, u(1)).age_months = null; }]],
    },
    ignored: [
      ["a company from another form (a different source)", (t) => t.businesses.push(company(u(9), { entity_data: { source: "slo_pull", state: "" } })), { sample: 2 }],
      ["another company's saved business", (t) => t.businesses.push(company(u(9), { org_id: OTHER, name: "" })), { sample: 2 }],
    ],
    drops: [
      ["company scope", "b.org_id = $1::uuid", "1 = 1"],
      ["this form only", "AND b.entity_data ->> 'source' = 'soft_pull_approve'", ""],
      ["client exists", "c.id IS NULL\n         OR", ""],
      ["name", "OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL", ""],
      ["street", "OR NULLIF(BTRIM(COALESCE(b.entity_data ->> 'address_line1', '')), '') IS NULL", ""],
      ["state", "OR LENGTH(BTRIM(COALESCE(b.entity_data ->> 'state', ''))) <> 2", ""],
      ["EIN", "OR COALESCE(b.entity_data ->> 'ein', '') !~* $2::text", ""],
      ["age", "OR b.age_months IS NULL", ""],
      ["client in this company", "LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id", "LEFT JOIN clients c ON c.id = b.client_id"],
    ],
  });
}

// ── the two template checks (judged in code over one read) ─────────────────
const templateRow = (key, over = {}) => ({
  id: u(Math.floor(Math.random() * 1e6)), org_id: ORG, template_key: key, channel: key.startsWith("EMAIL") ? "email" : "sms",
  subject: key.startsWith("EMAIL") ? `Subject for ${key}` : null, body: `Words for ${key}`, compliance_passed: true,
  approved_by: null, approved_body_sha: null, ...over,
});
const signed = (key, over = {}) => {
  const row = templateRow(key, over);
  return { ...row, approved_by: u(950), approved_body_sha: copyHash(row.subject, row.body), ...over };
};

{
  FIXTURES.set("template-copy:seed-vs-live-drift", {
    tables: {
      message_templates: [signed("SMS-A"), signed("EMAIL-B"), templateRow("SMS-C")],
    },
    sample: 2,
    breaks: {
      "an approved template's words changed after the sign-off": [
        ["body edited under a standing approval", (t) => { t.message_templates[0].body = "Different words"; }],
        ["subject edited under a standing approval", (t) => { t.message_templates[1].subject = "A new subject"; }],
      ],
      "an approval names a person and no hash of what they approved": [
        ["approver without a hash", (t) => { t.message_templates[0].approved_body_sha = null; }],
      ],
      "an approval has a hash that matches nothing": [
        ["wrong hash", (t) => { t.message_templates[0].approved_body_sha = "0".repeat(64); }],
      ],
    },
    ignored: [
      ["an unapproved template whose copy moved on (edit waiting for approval)", (t) => { Object.assign(t.message_templates[2], { compliance_passed: false, approved_by: u(950), approved_body_sha: "stale" }); }, { sample: 2 }],
      ["approved by the seeder, no person and no hash", (t) => t.message_templates.push(templateRow("SMS-D")), { sample: 2 }],
      ["another company's drifted template", (t) => t.message_templates.push({ ...signed("SMS-E"), org_id: OTHER, body: "changed" }), { sample: 2 }],
    ],
    drops: [
      ["company scope", "t.org_id = $1::uuid", "1 = 1"],
    ],
  });
}

{
  const all = snapshot.keys.filter((k) => !k.inactive);
  const rows = () => all.map((k) => templateRow(k.key, { channel: k.channel, compliance_passed: true }));
  FIXTURES.set("template-copy:SQL-seeded-only-keys-not-in-doc-source", {
    tables: { message_templates: rows() },
    sample: all.length,
    breaks: {
      "a SQL-seeded template is gone": [
        ["welcome text missing", (t) => { t.message_templates.splice(t.message_templates.findIndex((r) => r.template_key === "SMS-S00-WELCOME"), 1); }],
      ],
      "a SQL-seeded template is in the wrong channel": [
        ["email template saved as a text", (t) => { t.message_templates.find((r) => r.template_key === "EMAIL-PORTAL-MAGIC-LINK").channel = "sms"; }],
      ],
      "a SQL-seeded template has no words": [
        ["blank body", (t) => { t.message_templates.find((r) => r.template_key === "SMS-WAYPOINT-DUE").body = "   "; }],
        ["null body", (t) => { t.message_templates.find((r) => r.template_key === "SMS-WAYPOINT-DUE").body = null; }],
      ],
      "a SQL-seeded template holds placeholder copy": [
        ["a draft marker", (t) => { t.message_templates.find((r) => r.template_key === "SMS-WAYPOINT-NUDGE-2").body = "[DRAFT — NO SOURCE COPY] hello"; }],
        ["lorem ipsum", (t) => { t.message_templates.find((r) => r.template_key === "SMS-WAYPOINT-NUDGE-2").body = "Lorem ipsum dolor"; }],
        ["a draft subject", (t) => { t.message_templates.find((r) => r.template_key === "EMAIL-WAYPOINT-NUDGE-1").subject = "[DRAFT] subject"; }],
      ],
      "only another company has the template": [
        ["welcome text exists for another company only", (t) => { t.message_templates.find((r) => r.template_key === "SMS-S00-WELCOME").org_id = OTHER; }],
      ],
      "a template the seed approved is switched off": [
        ["unapproved", (t) => { t.message_templates.find((r) => r.template_key === "SMS-S00-WELCOME").compliance_passed = false; }],
      ],
    },
    ignored: [
      ["a retired template (no sender) is missing", (t) => {
        const retired = snapshot.keys.find((k) => k.inactive);
        assert.ok(retired, "the saved list holds at least one retired key");
        t.message_templates = t.message_templates.filter((r) => r.template_key !== retired.key);
      }, { sample: all.length }],
      ["a template the seed did not approve is switched off", (t) => {
        const pending = snapshot.keys.find((k) => !k.inactive && !k.approvedBySeed);
        assert.ok(pending, "the saved list holds a key the seed did not approve");
        t.message_templates.find((r) => r.template_key === pending.key).compliance_passed = false;
      }, { sample: all.length }],
      ["an extra template that is in no SQL file", (t) => t.message_templates.push(templateRow("SMS-NOT-IN-SQL")), { sample: all.length }],
    ],
    drops: [
      ["company scope", "t.org_id = $1::uuid", "1 = 1"],
    ],
  });
}

// ── client notification devices (web push) ──────────────────────────────────
{
  const device = (id, over = {}) => ({
    id, org_id: ORG, client_id: u(910), endpoint_hash: String(id).padStart(64, "a"),
    created_at: ago(30 * DAY), updated_at: ago(30 * DAY), last_success_at: ago(2 * DAY),
    failure_count: 0, expired_at: null, revoked_at: null, ...over,
  });
  const client = (id, over = {}) => ({ id, org_id: ORG, email: "casey@fundhub-client.test.io", is_demo: false, custom_fields: {}, ...over });
  FIXTURES.set("provider:web-push-and-client-push", {
    tables: {
      clients: [client(u(910))],
      client_push_subscriptions: [
        device(u(1)),                                                          // old and reached: fine
        device(u(2), { created_at: ago(2 * DAY), last_success_at: null }),    // turned on two days ago, nothing yet: still new
        device(u(3), { failure_count: 1 }),                                    // one bad answer after a success: fine
      ],
    },
    sample: 3,
    breaks: {
      "a device that waited past the grace with no push ever tried": [
        ["turned on 8 days ago, no success, no failure", (t) => t.client_push_subscriptions.push(
          device(u(4), { created_at: ago(8 * DAY), last_success_at: null }))],
        ["turned on 400 days ago, no success, no failure", (t) => t.client_push_subscriptions.push(
          device(u(4), { created_at: ago(400 * DAY), last_success_at: null }))],
      ],
      "a device the push service keeps failing that is still on file": [
        ["three failures after a success", (t) => t.client_push_subscriptions.push(device(u(4), { failure_count: 3 }))],
        ["three failures and never a success", (t) => t.client_push_subscriptions.push(
          device(u(4), { failure_count: 3, last_success_at: null, created_at: ago(1 * DAY) }))],
        ["nine failures", (t) => t.client_push_subscriptions.push(device(u(4), { failure_count: 9 }))],
      ],
    },
    ignored: [
      ["two failures and never a success (not yet three)", (t) => t.client_push_subscriptions.push(
        device(u(4), { failure_count: 2, last_success_at: null, created_at: ago(20 * DAY) })), { sample: 4 }],
      ["a retired device (the push service said gone) with many failures", (t) => t.client_push_subscriptions.push(
        device(u(4), { failure_count: 8, expired_at: ago(1 * DAY) })), { sample: 3 }],
      ["a device the client turned off", (t) => t.client_push_subscriptions.push(
        device(u(4), { revoked_at: ago(1 * DAY), last_success_at: null, created_at: ago(40 * DAY) })), { sample: 3 }],
      ["a test client's waiting device", (t) => {
        t.clients.push(client(u(911), { email: "qa@example.com" }));
        t.client_push_subscriptions.push(device(u(4), { client_id: u(911), created_at: ago(40 * DAY), last_success_at: null }));
      }, { sample: 3 }],
      ["a demo client's waiting device", (t) => {
        t.clients.push(client(u(912), { is_demo: true }));
        t.client_push_subscriptions.push(device(u(4), { client_id: u(912), created_at: ago(40 * DAY), last_success_at: null }));
      }, { sample: 3 }],
      ["a synthetic client's failing device", (t) => {
        t.clients.push(client(u(913), { custom_fields: { synthetic: "true" } }));
        t.client_push_subscriptions.push(device(u(4), { client_id: u(913), failure_count: 5 }));
      }, { sample: 3 }],
      ["another company's waiting device", (t) => t.client_push_subscriptions.push(
        device(u(4), { org_id: OTHER, created_at: ago(40 * DAY), last_success_at: null })), { sample: 3 }],
    ],
    drops: [
      ["company scope", "s.org_id = $1::uuid", "1 = 1"],
      ["not retired", "AND s.expired_at IS NULL", ""],
      ["not turned off", "AND s.revoked_at IS NULL", ""],
      ["never reached", "s.last_success_at IS NULL AND ", ""],
      ["never tried", "AND s.failure_count = 0 ", ""],
      ["past the grace", "AND s.created_at < $2::timestamptz", ""],
      ["failing", "OR s.failure_count >= 3", ""],
      ["not a test client", "AND NOT EXISTS (\n         SELECT 1 FROM clients cl", "AND NOT NOT EXISTS (\n         SELECT 1 FROM clients cl"],
    ],
  });
}

// ── the harness ─────────────────────────────────────────────────────────────

function standIn(spec, tables) {
  const names = new Set(Object.keys(tables));
  for (const name of tablesIn(spec.sql)) names.add(name);
  const kit = makeStandIn([...names].filter((n) => schemaColumns().has(n)));
  for (const [table, rows] of Object.entries(tables)) for (const row of rows) kit.insert(table, row);
  return kit;
}

async function answer(spec, tables, sqlOverride = null) {
  const kit = standIn(spec, tables);
  try {
    const live = sqlOverride ? { ...spec, sql: sqlOverride } : spec;
    const map = await runFinB22Live({ db: kit.handle(), orgId: ORG, now: NOW }, [live]);
    const got = map.get(finB22LiveId(spec));
    // The counts behind the verdict: read them from the same reducer or query the lane used.
    const params = live.params({ orgId: ORG, now: NOW });
    let stats;
    if (live.reduce) {
      stats = live.reduce(kit.all(live.sql, params));
    } else {
      stats = kit.run(live.sql, params);
    }
    return { result: got, stats };
  } finally {
    kit.close();
  }
}

for (const entry of FIN_B22_LIVE) {
  const fixture = FIXTURES.get(entry.surface);

  test(`${entry.surface}: has a fixture, a requirement in plain words and a read-only SELECT`, () => {
    assert.ok(fixture, "every live check has stand-in rows");
    assert.ok(entry.requirement.length > 40);
    assert.match(entry.sql, /^(WITH|SELECT) /);
    assert.ok(entry.sql.length < 4000, "one small statement");
    assert.doesNotMatch(entry.sql, /\b(?:INSERT|UPDATE|DELETE|CALL|CREATE|DROP|ALTER|TRUNCATE|SET)\b/i);
    assert.ok(FIN_B22_LIVE_SURFACES.has(entry.surface));
  });

  test(`${entry.surface}: names only real tables and columns`, () => {
    const schema = schemaColumns();
    for (const table of tablesIn(entry.sql)) {
      if (CTE_NAMES.includes(table)) continue;
      assert.ok(schema.has(table), `no table ${table}`);
    }
    for (const { table, column, alias } of columnsUsed(entry.sql)) {
      if (!schema.has(table)) continue;
      assert.ok(schema.get(table).has(column), `${alias}.${column} is not a column of ${table}`);
    }
  });

  test(`${entry.surface}: a healthy set is counted clean and judged green`, async () => {
    const { result, stats } = await answer(entry, clone(fixture.tables));
    assert.equal(stats.sample_count, fixture.sample, "sample");
    assert.equal(stats.bad_count, 0, "bad");
    assert.equal(result.status, "PASS");
    assert.ok(result.detail.includes(entry.surface));
  });

  for (const [condition, cases] of Object.entries(fixture.breaks)) {
    for (const [label, mutate, want = {}] of cases) {
      test(`${entry.surface}: ${label} is wrong (${condition})`, async () => {
        const tables = clone(fixture.tables);
        mutate(tables);
        const { result, stats } = await answer(entry, tables);
        assert.equal(stats.bad_count, want.bad ?? 1, "exactly the broken ones are counted");
        if (want.sample !== undefined) assert.equal(stats.sample_count, want.sample);
        assert.equal(result.status, "FAIL");
        assert.match(result.detail, /failed the exact check/);
      });
    }
  }

  for (const [label, mutate, want = {}] of fixture.ignored) {
    test(`${entry.surface}: left alone, ${label}`, async () => {
      const tables = clone(fixture.tables);
      mutate(tables);
      const { result, stats } = await answer(entry, tables);
      assert.equal(stats.bad_count, want.bad ?? 0);
      assert.equal(stats.sample_count, want.sample ?? fixture.sample, "sample");
      assert.equal(result.status, "PASS");
    });
  }

  test(`${entry.surface}: dropping any one condition changes the answer for some stand-in set`, async () => {
    const variants = [{ label: "healthy", tables: clone(fixture.tables) }];
    for (const cases of Object.values(fixture.breaks)) {
      for (const [label, mutate] of cases) { const t = clone(fixture.tables); mutate(t); variants.push({ label, tables: t }); }
    }
    for (const [label, mutate] of fixture.ignored) { const t = clone(fixture.tables); mutate(t); variants.push({ label, tables: t }); }
    const shape = async (sql) => {
      const out = [];
      for (const v of variants) {
        const { stats } = await answer(entry, clone(v.tables), sql);
        out.push(`${stats.sample_count}/${stats.bad_count}`);
      }
      return out.join(" ");
    };
    const original = await shape(null);
    for (const [label, from, to] of fixture.drops) {
      assert.equal(entry.sql.split(from).length - 1, 1, `${label}: the piece of text "${from.slice(0, 50)}" must appear exactly once`);
      const changed = await shape(entry.sql.replace(from, to));
      assert.notEqual(changed, original, `${label}: dropping this condition changed nothing, so it is dead weight`);
    }
  });
}

test("each live check answers a read that fails with a skip, never a pass", async () => {
  const broken = { async query() { throw new Error("connection reset"); } };
  const map = await runFinB22Live({ db: broken, orgId: ORG, now: NOW });
  assert.equal(map.size, FIN_B22_LIVE.length);
  for (const row of map.values()) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /was not checked: connection reset/);
  }
});

test("no database and no company are skips with the reason", async () => {
  for (const row of (await runFinB22Live({ now: NOW })).values()) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /no database in this run/);
  }
  for (const row of (await runFinB22Live({ db: { async query() { return { rows: [] }; } }, now: NOW })).values()) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /no company in this run/);
  }
});

test("a check with no emptyAs treats a missing result as red", () => {
  const strict = { surface: "x", family: "message", requirement: "something must exist", emptyAs: undefined };
  assert.equal(judgeLive(strict, { sample_count: 0, bad_count: 0 }).status, "FAIL");
  assert.equal(judgeLive({ ...strict, emptyAs: "quiet" }, { sample_count: 0, bad_count: 0 }).status, "PASS");
});

test("a failed read through the shared handle that returns no rows array is a skip", async () => {
  const map = await runFinB22Live({ db: { async query() { return {}; } }, orgId: ORG, now: NOW });
  for (const row of map.values()) assert.equal(row.status, "skip");
});

test("the sign-off hash is the one the template editor stores (subject, a NUL byte, then the body)", async () => {
  const editor = await import("../../../../api/message-templates.mjs");
  assert.equal(copyHash("Subject", "Body"), editor.copyHash("Subject", "Body"));
  assert.equal(copyHash(null, "Body"), editor.copyHash(null, "Body"));
  assert.notEqual(copyHash("a", "bc"), copyHash("ab", "c"));
  // reduceSignOff leaves a row that has no sign-off record out of the count
  assert.deepEqual(reduceSignOff([{ compliance_passed: true, approved_by: null, approved_body_sha: null, subject: null, body: "x", template_key: "K" }]),
    { sample_count: 0, bad_count: 0, names: [] });
});

test("the nudge check's workflow name, role and rung keys are the runner's own", async () => {
  const run = fs.readFileSync(path.join(REPO_ROOT, "src/nudge/run.mjs"), "utf8");
  assert.match(run, new RegExp(`export const SOURCE_WORKFLOW = "${NUDGE_SOURCE_WORKFLOW}"`));
  assert.match(run, new RegExp(`export const STAFF_TASK_ROLE = "${NUDGE_STAFF_TASK_ROLE}"`));
  const sql = spec("workflow:waypoint-nudge-sweeper").sql;
  for (const key of ["SMS-WAYPOINT-DUE", "EMAIL-WAYPOINT-NUDGE-1", "SMS-WAYPOINT-NUDGE-2"]) assert.ok(sql.includes(`'${key}'`), key);
});

test("the nudge check's waiting lists are the planner's own (chaseable states, bought statuses, link life, grace)", async () => {
  const exits = fs.readFileSync(path.join(REPO_ROOT, "src/nudge/exits.mjs"), "utf8");
  const setOf = (name) => {
    const m = new RegExp(`export const ${name} = Object\\.freeze\\(new Set\\(\\[([^\\]]*)\\]\\)\\)`).exec(exits);
    assert.ok(m, `${name} is a frozen Set in src/nudge/exits.mjs`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  assert.deepEqual([...NUDGE_CHASEABLE_STATES].sort(), setOf("CHASEABLE_STATES").sort());
  assert.deepEqual([...NUDGE_BOUGHT_STATUSES].sort(), setOf("BOUGHT_STATUSES").sort());
  const ttl = fs.readFileSync(path.join(REPO_ROOT, "src/paid-services/link-ttl.mjs"), "utf8");
  assert.match(ttl, new RegExp(`export const CHECKOUT_LINK_TTL_DAYS = ${NUDGE_CHECKOUT_LINK_DAYS};`));
  // the grace is longer than the ladder's second rung, so a client with the sweeper working is never here
  const { STEPS } = await import("../../../nudge/ladder.mjs");
  assert.ok(NUDGE_WAITING_DAYS > STEPS[1].daysOverdue);
  // the planner reads the same eligibility columns the waiting read does
  const run = fs.readFileSync(path.join(REPO_ROOT, "src/nudge/run.mjs"), "utf8");
  assert.match(run, /w\.owner_kind = 'client'/);
  assert.match(run, /w\.completed_at IS NULL/);
  assert.match(run, /w\.due_at IS NOT NULL/);
});

test("the EIN pattern accepts what the soft-pull form saves and refuses the rest", () => {
  const re = new RegExp(EIN_PATTERN, "i");
  assert.ok(re.test("12-3456789"));
  for (const bad of ["123456789", "12-345678", "1-23456789", "ab-3456789", ""]) assert.equal(re.test(bad), false, bad);
});

test("the test-address pattern is the sender lane's own", () => {
  assert.ok(new RegExp(TEST_ADDRESS_RE, "i").test("e2e+x@example.com"));
  assert.equal(RECEIPT_AFTER_HOURS, 24);
});

test("the saved list of SQL-only templates is fresh: it equals what the SQL files and the doc source give", () => {
  const rebuilt = buildSqlTemplateSnapshot(REPO_ROOT);
  const saved = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, SNAPSHOT_FILE), "utf8"));
  assert.deepEqual(saved, rebuilt, "run: node scripts/pulse/fin-b22-sql-template-keys.mjs --write");
  assert.ok(saved.keys.length >= 130);
  for (const k of ["SMS-S00-WELCOME", "EMAIL-PORTAL-MAGIC-LINK", "SMS-WAYPOINT-DUE", "EMAIL-PARTNER-WELCOME", "SMS-VAULT-ASK-1", "payment_link_notice"]) {
    assert.ok(saved.keys.some((r) => r.key === k), `${k} is a SQL-only key`);
  }
});

test("the SQL template reader finds the keys, channels and approved flag of each statement form", () => {
  const select = `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
    SELECT o.id, 'SMS-ONE', 'sms', NULL, 'it''s here', true FROM orgs o ON CONFLICT (org_id, template_key) DO UPDATE SET body = EXCLUDED.body;`;
  const values = `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
    SELECT o.id, k.template_key, 'email', k.subject, k.body, false FROM orgs o
    CROSS JOIN (VALUES ('EMAIL-TWO', $a$Sub$a$, $a$Body 'x'$a$), ('EMAIL-THREE', 's', 'b')) AS k(template_key, subject, body)
    ON CONFLICT (org_id, template_key) DO NOTHING;`;
  const lower = `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
    SELECT o.id, 'payment_link_notice', 'sms', NULL, 'Hi', false FROM orgs o;`;
  const a = templateStatements(select);
  assert.deepEqual(a[0].keys, ["SMS-ONE"]);
  assert.equal(a[0].approved, true);
  assert.equal(a[0].doNothing, false);
  const b = templateStatements(values);
  assert.deepEqual(b[0].keys, ["EMAIL-TWO", "EMAIL-THREE"]);
  assert.equal(b[0].approved, false);
  assert.equal(b[0].doNothing, true);
  assert.deepEqual(templateStatements(lower)[0].keys, ["payment_link_notice"]);
  // a comment and an unrelated INSERT are never read
  assert.deepEqual(templateStatements("-- INSERT INTO message_templates (x) SELECT 'SMS-NOPE';\nINSERT INTO other (a) SELECT 'SMS-NOPE2';"), []);
});

test("the reducers name the broken template keys", () => {
  const rows = [signed("SMS-A"), { ...signed("SMS-B"), body: "changed" }];
  const reduced = reduceSignOff(rows);
  assert.deepEqual(reduced, { sample_count: 2, bad_count: 1, names: ["SMS-B"] });
  const keys = [{ key: "SMS-X", channel: "sms", approvedBySeed: true, inactive: false }, { key: "SMS-Y", channel: "sms", approvedBySeed: true, inactive: true }];
  assert.deepEqual(reduceSqlOnlyKeys([], keys), { sample_count: 1, bad_count: 1, names: ["SMS-X"] });
});
