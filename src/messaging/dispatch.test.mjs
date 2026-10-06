// Adversarial tests for the outbound dispatcher.
//
// This is the file where a mistake actually sends something to a real person,
// so the cases are weighted accordingly. The single most important property in
// here is the first describe block: NO PATH REACHES A PROVIDER WITHOUT THE GATE
// SAYING "allowed". Every other test is secondary to that one.
//
// The provider is a spy throughout. If it was called, something was sent — so
// "the spy has zero calls" is the assertion that a message was really stopped,
// not merely marked as stopped.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dispatchOne, dispatchDue, claimDue, OUTCOME, MAX_ATTEMPTS, nextQuietHoursEnd,
  isPlaceholderCopy
} from "./dispatch.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { inQuietHours } from "./gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const MSG = "00000000-0000-4000-8000-000000000004";

// Midday Arizona, so nothing is accidentally inside quiet hours.
const MIDDAY = () => new Date("2026-08-01T16:00:00Z");

const claimed = (over = {}) => ({
  id: MSG, org_id: ORG, client_id: CLIENT, channel: "email",
  rendered_body: "Your documents were received.",
  template_key: "E-01", provider_ref: "workflow:E-01:evt1", attempts: 1,
  ...over
});

/* A database stand-in with just enough behaviour to drive the dispatcher.
   `updates` records every write so a test can assert what was persisted. */
function fakeDb({
  optedOut = new Set(),
  routing = { email: { provider: "mailgun", enabled: true }, sms: { provider: "ghl_relay", enabled: true } },
  client = { email: "person@example.com", ghl_contact_id: "crmContact123", phone: "+15551234567" },
  rules = [],
  subject = "Your file",
  due = [],
  /* custom_fields as stored on the client. The dispatcher reads it to refuse a
     synthetic (journey-run) record when the resolved provider can transmit. */
  customFields = null
} = {}) {
  const updates = [];
  return {
    updates,
    query: async (sql, params) => {
      if (sql.includes("client_authorized_reps")) return { rows: [] };
      if (sql.includes("FROM opt_outs")) {
        return { rows: optedOut.has(`${params[0]}:${params[1]}`) ? [{ x: 1 }] : [] };
      }
      if (sql.includes("FROM compliance_rules")) return { rows: rules };
      if (sql.includes("FROM message_channel_routing")) {
        const r = routing[params[1]];
        return { rows: r ? [r] : [] };
      }
      if (sql.includes("FROM message_templates")) return { rows: [{ subject }] };
      if (sql.includes("SELECT custom_fields FROM clients")) {
        return { rows: [{ custom_fields: customFields }] };
      }
      if (sql.includes("SELECT email, phone FROM clients")) {
        return { rows: [{ email: client.email ?? null, phone: client.phone ?? null }] };
      }
      if (sql.includes("FROM clients")) {
        // The dispatcher picks the column; echo whichever it asked for.
        const col = /SELECT (\w+) AS address/.exec(sql)?.[1];
        return { rows: [{ address: client[col] ?? null }] };
      }
      if (sql.includes("FROM tasks")) return { rows: [] };
      if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "t1" }] };
      if (sql.startsWith("UPDATE messages m")) return { rows: due };
      if (sql.includes("UPDATE messages")) { updates.push({ sql, params }); return { rows: [] }; }
      throw new Error(`unexpected query: ${sql.slice(0, 70)}`);
    }
  };
}

/** A provider spy. Zero calls means nothing was sent. */
function spy(result = { status: "sent", providerMessageId: "prov1", error: null, retryable: false }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "prov1", messageId: "prov1", sid: "SMprov1" }) };
  };
  fetchImpl.calls = calls;
  fetchImpl.result = result;
  return fetchImpl;
}

const ENV = {
  // The fence defaults to blocked; a send test must say it is down.
  MESSAGING_DRY_RUN: "0",
  MAILGUN_SEND_API_KEY: "key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  MAILGUN_SEND_DOMAIN: "mg.example.com",
  MAILGUN_SEND_FROM: "Fundhub <no-reply@mg.example.com>",
  GHL_RELAY_API_KEY: "crm-token",
  /* ADDED 2026-08-18 (T5-14). Outbound email now carries a signed unsubscribe
     link, appended at dispatch. Declared here so these tests exercise the real
     production path — with the secret set, the footer is built and the RFC 8058
     headers go out; without it dispatch sends anyway and logs loudly, which is
     the degraded path rather than the one worth testing by default. The value
     is a throwaway string; it only has to be long enough to be accepted. */
  UNSUBSCRIBE_TOKEN_SECRET: "test-unsubscribe-secret-0123456789abcdef0123456789abcdef",
  APP_BASE_URL: "https://fundhub.test"
};

beforeEach(() => clearRuleCache());

// ---------------------------------------------------------------------------
// THE PROPERTY THAT MATTERS MOST
// ---------------------------------------------------------------------------

describe("nothing reaches a provider without the gate allowing it", () => {
  test("an opted-out client is never sent to", async () => {
    const f = spy();
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:email`]) });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });

    assert.strictEqual(res.outcome, OUTCOME.BLOCKED);
    assert.strictEqual(f.calls.length, 0, "THE PROVIDER WAS CALLED FOR AN OPTED-OUT CLIENT");
  });

  test("a text inside quiet hours is never sent", async () => {
    const f = spy();
    const db = fakeDb();
    const res = await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: f, env: ENV, now: () => new Date("2026-08-01T07:00:00Z") // midnight Arizona
    });

    assert.strictEqual(res.outcome, OUTCOME.DEFERRED);
    assert.strictEqual(f.calls.length, 0, "A TEXT WAS SENT AT 3AM");
  });

  /* THE HALF THE ORIGINAL TEST DID NOT CHECK.
     "Never sent" was true of the old behaviour too — it was blocked, and a
     blocked message is never sent again either. These assert that the text is
     merely waiting: still queued, no permanent block written, and a due time
     that lands exactly on the hour the window opens. */
  test("a text inside quiet hours stays queued rather than being blocked", async () => {
    const db = fakeDb();
    await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: spy(), env: ENV, now: () => new Date("2026-08-01T07:00:00Z")
    });

    const wrote = db.updates.map((u) => u.sql).join(" ");
    assert.ok(/status = 'queued'/.test(wrote), "the text must go back on the queue");
    assert.ok(!/blocked_reason/.test(wrote),
      "A DEFERRED TEXT WAS RECORDED AS A PERMANENT BLOCK — it will never send");
    assert.ok(!/status = 'blocked'/.test(wrote), "quiet hours must not set status='blocked'");
  });

  test("a text deferred overnight does not spend a delivery attempt", async () => {
    const db = fakeDb();
    await dispatchOne(db, claimed({ channel: "sms", attempts: 1 }), {
      fetchImpl: spy(), env: ENV, now: () => new Date("2026-08-01T07:00:00Z")
    });
    assert.ok(db.updates.some((u) => /attempts = GREATEST\(attempts - 1, 0\)/.test(u.sql)),
      "an unopened window is not a failed delivery and must not burn the retry budget");
  });

  test("email is not held overnight — quiet hours are a text rule", async () => {
    const f = spy();
    const res = await dispatchOne(fakeDb(), claimed({ channel: "email" }), {
      fetchImpl: f, env: ENV, now: () => new Date("2026-08-01T07:00:00Z")
    });
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.strictEqual(f.calls.length, 1);
  });

  test("a +sim- text at 3am is not held for quiet hours", async () => {
    const f = spy();
    const db = fakeDb({
      client: { email: "stanbridgejchris+sim-fund@gmail.com", phone: "+16616054248" },
      routing: {
        email: { provider: "mailgun", enabled: true },
        sms: { provider: "twilio", enabled: true }
      }
    });
    const res = await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: f,
      env: { ...ENV, TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TWILIO_SEND_AUTH_TOKEN: "twilio-auth-token-value", TWILIO_SEND_FROM: "+15550001111" },
      now: () => new Date("2026-08-01T07:00:00Z")
    });
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.strictEqual(f.calls.length, 1, "the sim text must leave at night");
  });

  test("an e2e+ text at 3am is not held for quiet hours", async () => {
    const f = spy();
    const db = fakeDb({
      client: { email: "e2e+aff-prove@fundhub.ai", phone: "+16616054248" },
      routing: {
        email: { provider: "mailgun", enabled: true },
        sms: { provider: "twilio", enabled: true }
      }
    });
    const res = await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: f,
      env: { ...ENV, TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TWILIO_SEND_AUTH_TOKEN: "twilio-auth-token-value", TWILIO_SEND_FROM: "+15550001111" },
      now: () => new Date("2026-08-01T07:00:00Z")
    });
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.strictEqual(f.calls.length, 1);
  });

  test("a normal client text at 3am is still held", async () => {
    const f = spy();
    const db = fakeDb({
      client: { email: "person@example.com", phone: "+15551234567" },
      routing: {
        email: { provider: "mailgun", enabled: true },
        sms: { provider: "twilio", enabled: true }
      }
    });
    const res = await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: f,
      env: { ...ENV, TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TWILIO_SEND_AUTH_TOKEN: "twilio-auth-token-value", TWILIO_SEND_FROM: "+15550001111" },
      now: () => new Date("2026-08-01T07:00:00Z")
    });
    assert.strictEqual(res.outcome, OUTCOME.DEFERRED);
    assert.strictEqual(f.calls.length, 0, "A REAL CUSTOMER WAS TEXTED AT 3AM");
  });

  test("restricted wording is never sent", async () => {
    const rules = [{
      rule_set: "claims", rule_key: "guaranteed-approval", offer_types: [], platforms: [],
      match_type: "regex", pattern: "guarantee\\w*", severity: "block",
      message: "Guaranteed approval cannot be advertised.", citation: "FTC Act"
    }];
    const f = spy();
    const db = fakeDb({ rules });
    const res = await dispatchOne(db, claimed({ rendered_body: "We guarantee approval." }), {
      fetchImpl: f, env: ENV, now: MIDDAY
    });

    assert.strictEqual(res.outcome, OUTCOME.BLOCKED);
    assert.strictEqual(f.calls.length, 0, "COPY THAT BREAKS A COMPLIANCE RULE WAS SENT");
  });

  // The structural version: the gate runs before routing is even looked up, so
  // no routing bug can produce a send.
  test("the gate is consulted before routing is resolved", async () => {
    const order = [];
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:email`]) });
    const wrapped = {
      query: async (sql, params) => {
        if (sql.includes("FROM opt_outs")) order.push("gate");
        if (sql.includes("FROM message_channel_routing")) order.push("routing");
        return db.query(sql, params);
      }
    };
    await dispatchOne(wrapped, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    assert.strictEqual(order[0], "gate");
    assert.ok(!order.includes("routing"), "routing must not even be read for a blocked message");
  });

  test("a blocked message is recorded as blocked, not left queued", async () => {
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:email`]) });
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    assert.ok(db.updates.some((u) => /blocked_reason/.test(u.sql)), "the block must be persisted");
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("routing", () => {
  test("sends through the provider the org routed", async () => {
    const f = spy();
    const db = fakeDb();
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.ok(f.calls[0].url.includes("mailgun.net"), f.calls[0].url);
  });

  test("sms routed to the CRM stub is rejected — never hits the network", async () => {
    // Owner 2026-08-14: the CRM account canceled. ghl_relay stays registered so
    // historical routing rows do not crash, but TRANSMITS=false and send()
    // permanently rejects. Live SMS is Twilio; this test pins the stub.
    const f = spy();
    const db = fakeDb();
    const res = await dispatchOne(db, claimed({ channel: "sms" }), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.REJECTED);
    assert.strictEqual(f.calls.length, 0, "The CRM stub must not call the network");
  });

  // No route is a HOLD. The alternative — picking a provider — would send a
  // client's text through whatever happened to be first in the registry.
  test("no routing row holds the message and sends nothing", async () => {
    const f = spy();
    const db = fakeDb({ routing: {} });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.NO_ROUTE);
    assert.strictEqual(f.calls.length, 0);
  });

  test("a disabled channel holds the message and sends nothing", async () => {
    const f = spy();
    const db = fakeDb({ routing: { email: { provider: "mailgun", enabled: false } } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.NO_ROUTE);
    assert.strictEqual(f.calls.length, 0, "a disabled channel is a kill switch");
  });

  test("an unknown provider name holds rather than guessing", async () => {
    const f = spy();
    const db = fakeDb({ routing: { email: { provider: "sendgrid", enabled: true } } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.UNKNOWN_PROVIDER);
    assert.strictEqual(f.calls.length, 0);
  });

  test("a provider routed to a channel it does not carry is refused", async () => {
    const f = spy();
    const db = fakeDb({ routing: { email: { provider: "ghl_relay", enabled: true } } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.CHANNEL_MISMATCH);
    assert.strictEqual(f.calls.length, 0);
  });

  // A hold is a configuration problem, so the attempt is given back. Otherwise
  // a weekend of missing routing burns the retry budget and the backlog is dead
  // before anyone fixes it.
  test("a hold does not consume the retry budget", async () => {
    const db = fakeDb({ routing: {} });
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    const u = db.updates.find((x) => /attempts = GREATEST/.test(x.sql));
    assert.ok(u, "a hold must return the attempt");
    assert.ok(/status = 'queued'/.test(u.sql), "a held message stays queued");
  });
});

// ---------------------------------------------------------------------------
// THE SYNTHETIC FENCE
//
// A journey run mints fake clients and drives them through the real send path.
// preflight() stops a run when the org's routing can transmit — but the QUEUE
// OUTLIVES THE ROUTING. Run against `memory`, switch email to Mailgun tomorrow,
// and yesterday's invented people get mailed. These tests are that case.
//
// The spy is the assertion: zero calls means nothing was sent, not merely that
// something was marked as stopped.
// ---------------------------------------------------------------------------

describe("a test record never meets a real provider", () => {
  test("a synthetic client is refused when the provider can transmit", async () => {
    const f = spy();
    const db = fakeDb({ customFields: { synthetic: true } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });

    assert.strictEqual(res.outcome, OUTCOME.SYNTHETIC);
    assert.strictEqual(f.calls.length, 0, "A SYNTHETIC CLIENT WAS SENT TO BY A REAL PROVIDER");
  });

  test("the refusal is permanent — a fake person is never a real person later", async () => {
    const db = fakeDb({ customFields: { synthetic: true } });
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    const write = db.updates.at(-1);
    assert.match(write.sql, /SET status = \$2/);
    assert.strictEqual(write.params[1], "failed");
  });

  test("a real client is untouched by the fence", async () => {
    const f = spy();
    const db = fakeDb({ customFields: { source: "webform" } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.strictEqual(f.calls.length, 1);
  });

  test("the marker is strict — a truthy accident is a real client", async () => {
    // Matching isSynthetic(): the STRING "true" is a real client with a
    // confusing field. Guessing in its favour would refuse real mail.
    for (const value of ["true", 1, "yes"]) {
      const f = spy();
      const db = fakeDb({ customFields: { synthetic: value } });
      const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
      assert.strictEqual(res.outcome, OUTCOME.SENT, `synthetic: ${JSON.stringify(value)}`);
      assert.strictEqual(f.calls.length, 1);
    }
  });

  test("a non-transmitting provider does not pay for the lookup", async () => {
    // memory cannot leave the building, so the fence is not load-bearing and the
    // clients table is not read for it at all.
    let asked = 0;
    const inner = fakeDb({ routing: { email: { provider: "memory", enabled: true } } });
    const db = {
      updates: inner.updates,
      query: async (sql, params) => {
        if (sql.includes("SELECT custom_fields FROM clients")) asked += 1;
        return inner.query(sql, params);
      }
    };
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    assert.strictEqual(asked, 0);
  });
});

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

describe("addressing", () => {
  test("a client with no email is permanent, not retried", async () => {
    const f = spy();
    const db = fakeDb({ client: { email: null } });
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.NO_ADDRESS);
    assert.strictEqual(f.calls.length, 0);
  });

  test("a client never synced to the CRM cannot be texted", async () => {
    const f = spy();
    const db = fakeDb({ client: { ghl_contact_id: null } });
    const res = await dispatchOne(db, claimed({ channel: "sms" }), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.NO_ADDRESS);
    assert.strictEqual(f.calls.length, 0);
  });

  test("the email subject comes from the template, never invented", async () => {
    const f = spy();
    await dispatchOne(fakeDb({ subject: "Round submitted" }), claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(new URLSearchParams(f.calls[0].init.body).get("subject"), "Round submitted");
  });

  test("a template with no subject sends without one rather than making one up", async () => {
    const f = spy();
    await dispatchOne(fakeDb({ subject: null }), claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(new URLSearchParams(f.calls[0].init.body).get("subject"), null);
  });
});

// ---------------------------------------------------------------------------
// Recording the outcome
// ---------------------------------------------------------------------------

describe("recording", () => {
  test("a sent message records the provider's id and clears the error", async () => {
    const db = fakeDb();
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: ENV, now: MIDDAY });
    const u = db.updates.find((x) => /status = 'sent'/.test(x.sql));
    assert.ok(u, "a send must be recorded");
    assert.strictEqual(u.params[1], "mailgun");
    assert.strictEqual(u.params[2], "prov1");
    assert.ok(/last_error = NULL/.test(u.sql));
  });

  test("a transient failure goes back on the queue with the reason", async () => {
    const f = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
    const db = fakeDb();
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.RETRY);
    const u = db.updates.find((x) => /status = 'queued'/.test(x.sql));
    assert.ok(u && /last_error/.test(u.sql));
  });

  test("a permanent rejection stops — it is not retried", async () => {
    const f = async () => ({ ok: false, status: 400, text: async () => "not a valid address" });
    const db = fakeDb();
    const res = await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.REJECTED);
  });

  test("the retry budget runs out and the message stops", async () => {
    const f = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
    const db = fakeDb();
    const res = await dispatchOne(db, claimed({ attempts: MAX_ATTEMPTS }), { fetchImpl: f, env: ENV, now: MIDDAY });
    assert.strictEqual(res.outcome, OUTCOME.GAVE_UP);
  });

  test("a credential never reaches the recorded error", async () => {
    const f = async () => ({
      ok: false, status: 401,
      text: async () => `denied for key ${ENV.MAILGUN_SEND_API_KEY}`
    });
    const db = fakeDb();
    await dispatchOne(db, claimed(), { fetchImpl: f, env: ENV, now: MIDDAY });
    const written = JSON.stringify(db.updates);
    assert.ok(!written.includes(ENV.MAILGUN_SEND_API_KEY), "an api key was written to the database");
  });

  test("a message the client's own body broke does not stop the batch", async () => {
    const db = fakeDb();
    // A provider that throws outright — the contract says it should not, so this
    // is the belt-and-braces path.
    const res = await dispatchOne(db, claimed(), {
      fetchImpl: () => { throw new Error("kaboom"); }, env: ENV, now: MIDDAY
    });
    assert.ok([OUTCOME.RETRY, OUTCOME.GAVE_UP].includes(res.outcome), res.outcome);
  });
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

describe("claiming", () => {
  test("claims and dispatches a batch, counting the outcomes", async () => {
    const db = fakeDb({ due: [claimed(), claimed({ id: "m2" })] });
    const out = await dispatchDue(db, { fetchImpl: spy(), env: ENV, now: MIDDAY });
    assert.strictEqual(out.claimed, 2);
    assert.strictEqual(out.counts[OUTCOME.SENT], 2);
  });

  test("an empty queue is a no-op", async () => {
    const db = fakeDb({ due: [] });
    const out = await dispatchDue(db, { fetchImpl: spy(), env: ENV, now: MIDDAY });
    assert.strictEqual(out.claimed, 0);
    assert.deepStrictEqual(out.counts, {});
  });

  // The claim query is the double-send guard. These assert its shape, because
  // the failure it prevents cannot be reproduced in a fake.
  test("the claim marks rows 'sending' in the same statement that selects them", async () => {
    let seen = null;
    await claimDue({ query: async (sql) => { seen = sql; return { rows: [] }; } }, {});
    assert.match(seen, /UPDATE messages/, "must be an UPDATE, not a SELECT then UPDATE");
    assert.match(seen, /SET status = 'sending'/);
    assert.match(seen, /FOR UPDATE SKIP LOCKED/, "two dispatchers must not claim the same row");
    assert.match(seen, /RETURNING/);
  });

  test("the claim only takes outbound, queued, due rows under the attempt cap", async () => {
    let seen = null;
    await claimDue({ query: async (sql) => { seen = sql; return { rows: [] }; } }, {});
    assert.match(seen, /direction = 'outbound'/);
    assert.match(seen, /status = 'queued'/);
    assert.match(seen, /scheduled_at IS NULL OR scheduled_at <=/);
    assert.match(seen, /attempts < \$4/);
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

describe("the dispatcher, structurally", () => {
  const src = fs.readFileSync(path.join(HERE, "dispatch.mjs"), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  test("carries no bypass flag", () => {
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code), `dispatch.mjs must not contain a ${flag} identifier`);
    }
  });

  test("uses gateAndRecord, so every dispatch is audited", () => {
    assert.match(code, /gateAndRecord\s*\(/);
  });

  // Nothing schedules this. Building the dispatcher must not have started it.
  test("registers no scheduler, timer or workflow of its own", () => {
    assert.ok(!/setInterval|setTimeout|createFunction|inngest/i.test(code),
      "dispatch.mjs must not schedule itself — turning sending on is a separate act");
  });

  test("the address column can never be attacker-chosen", () => {
    // The column name is interpolated into SQL, so it must be allow-listed.
    assert.match(code, /ADDRESS_COLUMNS\.has\(field\)/,
      "the interpolated column must be checked against the allow-list");
  });
});

// ---------------------------------------------------------------------------
// THE OVERNIGHT WINDOW'S ARITHMETIC
//
// nextQuietHoursEnd decides when a held text wakes up. If it is wrong the text
// either goes out during quiet hours or sits for an extra day, so the window
// edges and both daylight-saving nights are asserted directly rather than
// trusted.
// ---------------------------------------------------------------------------

describe("nextQuietHoursEnd", () => {
  const azHour = (d) => Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", hour: "numeric", hour12: false
  }).formatToParts(d).find((p) => p.type === "hour").value) % 24;

  test("8pm Arizona wakes at 8am the next morning", () => {
    // 2026-08-01 20:00 Arizona is 2026-08-02 03:00 UTC (MST, UTC-7).
    const due = nextQuietHoursEnd(new Date("2026-08-02T03:00:00Z"));
    assert.strictEqual(azHour(due), 8);
    assert.strictEqual(due.toISOString(), "2026-08-02T15:00:00.000Z");
  });

  test("midnight Arizona wakes the same morning, not the next day", () => {
    const due = nextQuietHoursEnd(new Date("2026-08-01T07:00:00Z"));
    assert.strictEqual(due.toISOString(), "2026-08-01T15:00:00.000Z");
  });

  test("the wake time is always 8am Arizona, on every day of the year", () => {
    // Every day of 2026 at midnight Arizona, including both dates the rest of
    // the country changes its clocks and Arizona does not.
    for (let day = 0; day < 365; day += 1) {
      const from = new Date(Date.UTC(2026, 0, 1, 7, 0, 0) + day * 86400000);
      const due = nextQuietHoursEnd(from);
      assert.strictEqual(azHour(due), 8,
        `woke at ${azHour(due)}:00 Arizona, not 08:00, starting from ${from.toISOString()}`);
      assert.ok(due > from, "the wake time must be in the future");
      assert.ok(due - from < 36 * 3600 * 1000, "the wake time must be within a day and a half");
    }
  });

  test("a text is never woken into the window it was held by", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const from = new Date(Date.UTC(2026, 2, 8, hour, 0, 0)); // DST starts in the US
      const due = nextQuietHoursEnd(from);
      assert.ok(!inQuietHours(due), `woken back inside quiet hours from ${from.toISOString()}`);
    }
  });
});

/* ── T5-11 · unfinished placeholder copy never transmits ──────────────────
   32 of the 237 live message templates are unedited sample copy carrying
   lorem ipsum (measured against production 2026-08-18): a whole family of
   BS-EMAIL-, BS-FUND- and BS-REPAIR- rows imported verbatim from the source
   document and never written.

   They cannot be sent today — all 32 are compliance_passed = false and
   sendTemplated refuses an unapproved template. What this guard closes is the
   single human step between here and a client reading Latin: somebody pressing
   Approve in the template editor on a row they have not read. */

test("dispatch: SMS-DOC-02 is blocked when GHL-DOC is retired", async () => {
  const db = fakeDb();
  const orig = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes("FROM agents")) {
      return { rows: [{ status: "retired" }] };
    }
    return orig(sql, params);
  };
  const f = spy();
  const res = await dispatchOne(db, claimed({
    channel: "sms",
    template_key: "SMS-DOC-02-REQUEST-MORE",
    rendered_body: "got your upload — one thing needs fixing"
  }), { fetchImpl: f, env: ENV, now: MIDDAY });
  assert.strictEqual(res.outcome, OUTCOME.BLOCKED);
  assert.strictEqual(res.detail, "retired_ghl_doc");
  assert.strictEqual(f.calls.length, 0, "retired GHL-DOC must not reach a provider");
});

test("dispatch: a message whose copy is still lorem ipsum is blocked, not sent", async () => {
  const db = fakeDb();
  const f = spy();
  const res = await dispatchOne(db, claimed({
    rendered_body: "Lorem ipsum dolor sit amet, consectetur adipisicing elit."
  }), { fetchImpl: f, env: ENV, now: MIDDAY });
  assert.strictEqual(res.outcome, OUTCOME.BLOCKED);
  assert.strictEqual(res.detail, "placeholder_copy");
  assert.strictEqual(f.calls.length, 0, "nothing may reach a provider");
});

test("dispatch: placeholder copy in the SUBJECT is blocked too", async () => {
  const db = fakeDb();
  const f = spy();
  const res = await dispatchOne(db, claimed({ subject: "Lorem Ipsum" }), { fetchImpl: f, env: ENV, now: MIDDAY });
  assert.strictEqual(res.outcome, OUTCOME.BLOCKED);
  assert.strictEqual(f.calls.length, 0);
});

test("dispatch: the placeholder guard does not block real Spanish or Portuguese copy", () => {
  /* The rule is narrow on purpose. "dolor", "sit" and "amet" all appear in
     ordinary Spanish and Portuguese sentences, and a guard that stops a genuine
     message is worse than the gap it closes. */
  assert.equal(isPlaceholderCopy("Lamentamos el dolor de cabeza que esto le causó."), false);
  assert.equal(isPlaceholderCopy("Sit down and read this."), false);
  assert.equal(isPlaceholderCopy("Your documents were received."), false);
  assert.equal(isPlaceholderCopy(""), false);
  assert.equal(isPlaceholderCopy(null), false);
  assert.equal(isPlaceholderCopy("Lorem ipsum dolor sit amet"), true);
  assert.equal(isPlaceholderCopy("LOREM   IPSUM"), true, "case and spacing do not rescue it");
});

// ---------------------------------------------------------------------------
// TEST ADDRESSES — MEASURED 2026-10-01 (M7, perfect-machine-2026-10-05)
//
// Live test walks of the apply form used @example.com addresses. Each one
// queued a real welcome email and a real finish-your-application email, the
// dispatcher handed them to Resend, Resend answered HTTP 422 ("use our testing
// email address instead of domains like `example.com`"), and 6 welcome + 5
// finish-application rows were recorded as FAILED mail. No real person was
// involved; the report read as "the welcome email is broken".
//
// An address the provider refuses on sight must be held as a test address,
// not handed over and recorded as a failed delivery.
// ---------------------------------------------------------------------------

const RESEND_ENV = {
  ...ENV,
  RESEND_API_KEY: "re_test_0123456789abcdef",
  RESEND_FROM: "Fundhub <no-reply@fundhub.ai>"
};
const RESEND_ROUTING = { email: { provider: "resend", enabled: true } };

describe("an address the email provider refuses on sight", () => {
  test("an @example.com welcome email never reaches Resend and is not recorded as failed", async () => {
    const f = spy();
    const db = fakeDb({ routing: RESEND_ROUTING });
    const res = await dispatchOne(db,
      claimed({ template_key: "EMAIL-S00-WELCOME", to_address: "cfextract+walk@example.com" }),
      { fetchImpl: f, env: RESEND_ENV, now: MIDDAY });

    assert.strictEqual(f.calls.length, 0, "A TEST ADDRESS WAS HANDED TO RESEND");
    assert.strictEqual(res.outcome, OUTCOME.TEST_ADDRESS);
    const last = db.updates[db.updates.length - 1];
    assert.match(last.sql, /SET status = \$2/);
    assert.strictEqual(last.params[1], "blocked", "a test address is held, not a failed email");
    assert.match(String(last.params[3]), /example\.com/, "the reason names the test domain");
    assert.ok(!String(last.params[3]).includes("cfextract"), "the reason must not carry the address");
  });

  test("a real address through Resend still goes out", async () => {
    const f = spy();
    const db = fakeDb({ routing: RESEND_ROUTING });
    const res = await dispatchOne(db,
      claimed({ template_key: "EMAIL-S00-WELCOME", to_address: "someone@gmail.com" }),
      { fetchImpl: f, env: RESEND_ENV, now: MIDDAY });

    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.strictEqual(f.calls.length, 1);
  });
});
