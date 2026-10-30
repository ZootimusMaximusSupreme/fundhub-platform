// Adversarial tests for the outbound messaging gate.
//
// Written to BREAK the gate, not to confirm it works. Every rule gets both
// directions, because both directions are bugs:
//
//   a BLOCKED case   — a message that must not reach a provider
//   a NEAR-MISS case — a message deliberately close to the blocked one that
//                      must still be ALLOWED
//
// The near-misses carry the weight. A quiet-hours rule that holds everything is
// as broken as one that holds nothing; it just fails in the direction where
// somebody turns the gate off instead of filing a bug.
//
// NO BYPASS IS USED ANYWHERE IN THIS FILE. Every case drives gate() with real
// inputs, and one test asserts that an options object carrying a bypass is
// rejected. If a future edit finds these tests inconvenient, the gate is what
// is right and the test is what changes — never the other way round.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gate, gateAndRecord, inQuietHours, hourInZone,
  isProveSimRecipient, emailLooksLikeProveSim, phoneIsAgentProveLine,
  QUIET_START_HOUR, QUIET_END_HOUR, QUIET_HOURS_TZ, GATE_SOURCE
} from "./gate.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { TASK_ROLES } from "../lib/create-task.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "../../db/migrations/047_compliance_rules.sql");

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const MESSAGE = "00000000-0000-4000-8000-000000000004";

/* The rules, parsed out of the migration's VALUES block — the same approach
   src/compliance/screen.test.mjs takes, for the same reason: reading the real
   SQL means a typo in the migration fails these tests instead of being mirrored
   by a hand-kept copy that was edited alongside it. */
function seededRules() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const block = sql.slice(sql.indexOf("CROSS JOIN (VALUES"), sql.indexOf("AS v(rule_set"));
  const rows = [];
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m;
  while ((m = re.exec(block))) {
    const [, rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation] = m;
    rows.push({
      rule_set, rule_key,
      offer_types: JSON.parse(offer_types),
      platforms: JSON.parse(platforms),
      match_type,
      pattern: pattern.replace(/''/g, "'"),
      severity,
      message: message.replace(/''/g, "'"),
      citation
    });
  }
  return rows;
}

const RULES = seededRules();

/* A db stand-in. `optedOut` is the set of "<client>:<channel>" pairs currently
   opted out. writes[] records every mutation so the tests can assert on what was
   persisted — and, just as importantly, on what was not. */
function fakeDb({
  rules = RULES, optedOut = new Set(), failOptOut = false,
  client = { email: "person@example.com", phone: "+15551234567" },
  staff = null
} = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (sql.includes("FROM opt_outs")) {
        if (failOptOut) throw new Error("connection terminated unexpectedly");
        return { rows: optedOut.has(`${params[0]}:${params[1]}`) ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("FROM staff")) {
        const allowed = staff && staff.id === params[1] && staff.phone === params[2]
          && staff.status === "active" && params[3].includes(staff.role)
          && (!params[4] || staff.notify_booked_call_sms === true);
        return { rows: allowed ? [{ id: staff.id }] : [] };
      }
      if (sql.includes("FROM clients")) return { rows: client ? [client] : [] };
      if (sql.includes("FROM compliance_rules")) return { rows: rules };
      if (sql.includes("UPDATE messages")) { writes.push({ kind: "message", sql, params }); return { rows: [] }; }
      // createTask's dedupe probe: no existing task, so the insert proceeds.
      if (sql.includes("FROM tasks")) return { rows: [] };
      if (sql.includes("INSERT INTO tasks")) {
        writes.push({ kind: "task", sql, params });
        return { rows: [{ id: "00000000-0000-4000-8000-0000000000aa" }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }
  };
}

// 2026-08-01 is a Saturday. Arizona is UTC-7 all year, so 16:00Z = 09:00 — the
// middle of the open window, and it isolates every non-quiet-hours case from
// the clock.
const MIDDAY = () => new Date("2026-08-01T16:00:00Z");

const base = { orgId: ORG, clientId: CLIENT, channel: "sms", body: "Hello, your file was updated." };
const run = (over = {}, dbOpts = {}) => gate(fakeDb(dbOpts), { ...base, ...over }, { now: MIDDAY });
const codes = (res) => res.reasons.map((x) => x.code);

beforeEach(() => clearRuleCache());

// ---------------------------------------------------------------------------
// The baseline. If this does not pass, every "blocked" below proves nothing —
// a gate that blocks everything would satisfy all of them.
// ---------------------------------------------------------------------------

describe("a clean message", () => {
  test("is allowed", async () => {
    const res = await run();
    assert.strictEqual(res.state, "allowed", `unexpectedly blocked: ${JSON.stringify(codes(res))}`);
    assert.deepStrictEqual(res.reasons, []);
    assert.strictEqual(res.task, null);
  });

  test("is allowed on email too", async () => {
    const res = await run({ channel: "email" });
    assert.strictEqual(res.state, "allowed", `unexpectedly blocked: ${JSON.stringify(codes(res))}`);
  });
});

describe("setter and staff contact hours", () => {
  const STAFF_ID = "00000000-0000-4000-8000-000000000099";
  const ALERT = { ...base, templateKey: "SMS-S04C-STAFF-BOOKED",
    providerRef: `workflow:SMS-S04C-STAFF-BOOKED:event-1:${STAFF_ID}`,
    toAddress: "+16616180865" };
  const enabledStaff = { id: STAFF_ID, role: "owner", status: "active",
    phone: "+16616180865", notify_booked_call_sms: true };

  test("client STOP does not block an enabled staff booking alert at 7 a.m.", async () => {
    const res = await gate(fakeDb({ staff: enabledStaff,
      optedOut: new Set([`${CLIENT}:sms`]) }), ALERT,
    { now: () => new Date("2026-08-01T14:00:00Z") });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("setter alert ignores the old optional switch but needs the exact active staff phone", async () => {
    const res = await gate(fakeDb({ staff: { ...enabledStaff, notify_booked_call_sms: false } }), ALERT,
      { now: MIDDAY });
    assert.strictEqual(res.state, "allowed");
    const wrongPhone = await gate(fakeDb({ staff: enabledStaff }), { ...ALERT, toAddress: "+14805550000" },
      { now: MIDDAY });
    assert.strictEqual(wrongPhone.state, "blocked");
    assert.ok(codes(wrongPhone).includes("recipient_unknown"));
  });

  test("staff alert at 10 p.m. is held until 6 a.m.", async () => {
    const res = await gate(fakeDb({ staff: enabledStaff }), ALERT,
      { now: () => new Date("2026-08-02T05:00:00Z") });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  test("verified internal lead alert sends at 10 p.m. while a wrong staff phone still blocks", async () => {
    const leadAlert = { ...ALERT, templateKey: null,
      providerRef: `staff-alert:lead:${CLIENT}:${STAFF_ID}` };
    const overnight = { now: () => new Date("2026-08-02T05:00:00Z") };
    const allowed = await gate(fakeDb({ staff: enabledStaff }), leadAlert, overnight);
    assert.strictEqual(allowed.state, "allowed", JSON.stringify(codes(allowed)));
    const wrongPhone = await gate(fakeDb({ staff: enabledStaff }),
      { ...leadAlert, toAddress: "+14805550000" }, overnight);
    assert.strictEqual(wrongPhone.state, "blocked");
    assert.ok(codes(wrongPhone).includes("recipient_unknown"));
  });

  test("different closer leg reads closer staff consent, not client STOP", async () => {
    const res = await gate(fakeDb({ staff: enabledStaff,
      optedOut: new Set([`${CLIENT}:sms`]) }), { ...base, templateKey: null,
      providerRef: `setter:${CLIENT}:booked:closer:${STAFF_ID}`, toAddress: enabledStaff.phone },
    { now: () => new Date("2026-08-01T14:00:00Z") });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("setter lead text uses 6 a.m.–10 p.m. but still honors the lead STOP", async () => {
    const message = { ...base, providerRef: `staff:setter-video:${CLIENT}:booked`, toAddress: "+15551234567" };
    const morning = () => new Date("2026-08-01T14:00:00Z");
    assert.strictEqual((await gate(fakeDb(), message, { now: morning })).state, "allowed");
    const stopped = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), message, { now: morning });
    assert.ok(codes(stopped).includes("opted_out"));
  });
});

// ---------------------------------------------------------------------------
// 1. Opt-out
// ---------------------------------------------------------------------------

describe("opt-out", () => {
  test("blocks a client who opted out of this channel", async () => {
    const res = await run({}, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("opted_out"), JSON.stringify(codes(res)));
  });

  // The near-miss: opt-out is PER CHANNEL. Someone who stopped texts has not
  // stopped emails, and collapsing the two would silently suppress a channel
  // they never objected to.
  test("does not block a different channel from the one opted out of", async () => {
    const res = await run({ channel: "email" }, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("does not block a different client", async () => {
    const other = "00000000-0000-4000-8000-00000000000f";
    const res = await run({ clientId: other }, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  // THE SLEEPING-WORKFLOW CASE. This is the one the whole gate exists for.
  //
  // A workflow queued this on Monday. It slept. It woke on Thursday. The client
  // opted out on Tuesday — after the message was created, before it was sent.
  // The message must be blocked.
  //
  // Every field a caller could use to argue "but it was fine when we queued it"
  // is passed in here deliberately, with values three days stale.
  test("blocks a client who opted out AFTER the message was queued", async () => {
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) });
    const res = await gate(db, {
      ...base,
      // All of these are ignored by the gate. They are passed to prove it.
      createdAt: new Date("2026-07-27T16:00:00Z"),   // Monday: queued
      scheduledAt: new Date("2026-07-27T16:00:00Z"),
      queuedAt: new Date("2026-07-27T16:00:00Z"),
      compliancePassedAt: new Date("2026-07-27T16:00:00Z") // "it passed then!"
    }, { now: MIDDAY });                                    // Thursday: sending

    assert.strictEqual(res.state, "blocked",
      "an opt-out recorded after queueing must still block the send");
    assert.ok(codes(res).includes("opted_out"));
  });

  // The structural guarantee behind that test: there is no queue-time field the
  // gate consults at all. If someone adds one, this fails.
  test("reads no queue-time field — the same message blocks with or without them", async () => {
    const withStamps = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), {
      ...base, createdAt: new Date("2020-01-01T00:00:00Z"), scheduledAt: new Date("2020-01-01T00:00:00Z")
    }, { now: MIDDAY });
    const without = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), base, { now: MIDDAY });
    assert.deepStrictEqual(codes(withStamps), codes(without));
  });

  // A message with nobody attached has no opt-out record to read. "No record"
  // must never resolve to "nobody objected".
  test("blocks when there is no client to check", async () => {
    const res = await run({ clientId: null });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });

  test("allows catalog AF1 email when the address is on the queued row", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "email",
      templateKey: "AF1",
      toAddress: "e2e+aff-click17@fundhub.ai"
    }, { now: MIDDAY });
    assert.ok(!codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });

  test("allows the partner welcome email when the address is on the queued row", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "email",
      templateKey: "EMAIL-PARTNER-WELCOME",
      toAddress: "e2e+wl-hole7@fundhub.ai"
    }, { now: MIDDAY });
    assert.ok(!codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });

  // The text half of the same welcome. src/partners/welcome.mjs only writes this
  // row when the applicant ticked the text box, so the row is the consent record.
  test("allows the partner welcome text when a real number is on the queued row", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "sms",
      templateKey: "SMS-PARTNER-WELCOME",
      toAddress: "+16615550143"
    }, { now: MIDDAY });
    assert.ok(!codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  // The near-miss. The allowance is the key AND a number we could dial. A
  // partner text with a junk destination has to fall back to blocked.
  for (const bad of ["", null, "6616054248", "not a phone", "+1"]) {
    test(`still blocks the partner welcome text with destination ${JSON.stringify(bad)}`, async () => {
      const res = await gate(fakeDb(), {
        ...base,
        clientId: null,
        channel: "sms",
        templateKey: "SMS-PARTNER-WELCOME",
        toAddress: bad
      }, { now: MIDDAY });
      assert.strictEqual(res.state, "blocked");
      assert.ok(codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
    });
  }

  // The allowance is per template key, not "any text with a phone number on it".
  test("does not let an ordinary text out just because it carries a number", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "sms",
      templateKey: "SMS-S00-WELCOME",
      toAddress: "+16615550143"
    }, { now: MIDDAY });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });

  // The email key must not become a text key by being passed a phone number.
  test("does not let the welcome EMAIL key out over sms", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "sms",
      templateKey: "EMAIL-PARTNER-WELCOME",
      toAddress: "+16615550143"
    }, { now: MIDDAY });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });

  // Quiet hours are untouched by the allowance above.
  test("a partner welcome text at 11pm Arizona still waits for 8:00", async () => {
    const res = await gate(fakeDb(), {
      ...base,
      clientId: null,
      channel: "sms",
      templateKey: "SMS-PARTNER-WELCOME",
      toAddress: "+16615550143"
    }, { now: () => new Date("2026-08-01T06:00:00Z") });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"), JSON.stringify(codes(res)));
  });
});

// ---------------------------------------------------------------------------
// 2. Quiet hours
// ---------------------------------------------------------------------------

describe("quiet hours", () => {
  // Each case is an exact instant, named in Arizona time, which is UTC-7 all year.
  const at = (iso) => gate(fakeDb(), base, { now: () => new Date(iso) });

  test("blocks a text at 8:30pm Arizona", async () => {
    const res = await at("2026-08-02T03:30:00Z"); // 20:30 MST
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"), JSON.stringify(codes(res)));
  });

  test("blocks a text at midnight Arizona", async () => {
    const res = await at("2026-08-01T07:00:00Z"); // 00:00 MST
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  test("blocks a text at 7:59am Arizona — one minute before the window opens", async () => {
    const res = await at("2026-08-01T14:59:00Z"); // 07:59 MST
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  // The boundaries, both sides. These are where an off-by-one lives.
  test("allows a text at exactly 8:00am Arizona — the window opens", async () => {
    const res = await at("2026-08-01T15:00:00Z"); // 08:00 MST
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("allows a text at 7:59pm Arizona — one minute before the window closes", async () => {
    const res = await at("2026-08-02T02:59:00Z"); // 19:59 MST
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("blocks a text at exactly 8:00pm Arizona — the window closes", async () => {
    const res = await at("2026-08-02T03:00:00Z"); // 20:00 MST
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  // Email is exempt. A gate that held overnight email would stop the drip
  // campaigns for half of every day and be switched off by whoever noticed.
  test("does not block email at midnight Arizona", async () => {
    const res = await gate(fakeDb(), { ...base, channel: "email" },
      { now: () => new Date("2026-08-01T07:00:00Z") });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("does not hold a +sim- plus-tag text at midnight Arizona", async () => {
    const res = await gate(
      fakeDb({ client: { email: "stanbridgejchris+sim-fund@gmail.com", phone: "+16616054248" } }),
      base,
      { now: () => new Date("2026-08-01T07:00:00Z") }
    );
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
    assert.ok(!codes(res).includes("quiet_hours"));
  });

  test("does not hold an e2e+ text at midnight Arizona", async () => {
    const res = await gate(
      fakeDb({ client: { email: "e2e+aff-prove@fundhub.ai", phone: "+16616054248" } }),
      base,
      { now: () => new Date("2026-08-01T07:00:00Z") }
    );
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("does not hold a +colin-qa text at midnight Arizona", async () => {
    const res = await gate(
      fakeDb({ client: { email: "stanbridgejchris+colin-qa@gmail.com", phone: "+16616054248" } }),
      base,
      { now: () => new Date("2026-08-01T07:00:00Z") }
    );
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("still holds a normal client at midnight Arizona", async () => {
    const res = await gate(
      fakeDb({ client: { email: "person@example.com", phone: "+15551234567" } }),
      base,
      { now: () => new Date("2026-08-01T07:00:00Z") }
    );
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  test("the agent prove line alone does not skip quiet hours", async () => {
    const res = await gate(
      fakeDb({ client: { email: "person@example.com", phone: "+16616054248" } }),
      base,
      { now: () => new Date("2026-08-01T07:00:00Z") }
    );
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  // Arizona does not observe daylight saving. That is the property this test
  // exists to hold: the same UTC instant is the same local hour in July and in
  // January, so the window does not drift an hour twice a year the way it did
  // when it was measured in Eastern. If somebody swaps the zone back to one
  // that shifts, these two lines stop agreeing.
  test("does not move across the daylight-saving change", () => {
    // 15:30Z is 08:30 in Phoenix in both seasons — just inside the open window.
    assert.strictEqual(inQuietHours(new Date("2026-07-01T15:30:00Z")), false, "July 15:30Z is 08:30 MST — open");
    assert.strictEqual(inQuietHours(new Date("2026-01-01T15:30:00Z")), false, "January 15:30Z is 08:30 MST — open");
  });

  test("reads the Arizona hour, not UTC", () => {
    assert.strictEqual(hourInZone(new Date("2026-08-01T16:00:00Z")), 9); // MST, UTC-7
    assert.strictEqual(hourInZone(new Date("2026-01-01T16:00:00Z")), 9); // MST, UTC-7 — unchanged
  });

  // Midnight is the value ICU disagrees about — "24" in some builds, "00" in
  // others. Either way it must be inside the window.
  test("treats midnight Arizona as inside the window", () => {
    assert.strictEqual(hourInZone(new Date("2026-08-01T07:00:00Z")), 0);
    assert.strictEqual(inQuietHours(new Date("2026-08-01T07:00:00Z")), true);
  });

  // The window wraps midnight, so it is an OR and not a range. Written the
  // obvious way it is never open at all.
  test("the window is open for a contiguous stretch of the day", () => {
    const open = [];
    for (let h = 0; h < 24; h++) {
      // 2026-08-01, Arizona: local hour h is UTC hour h+7.
      const d = new Date(Date.UTC(2026, 7, 1 + (h + 7 >= 24 ? 1 : 0), (h + 7) % 24, 30));
      if (!inQuietHours(d)) open.push(h);
    }
    const expected = [];
    for (let h = QUIET_END_HOUR; h < QUIET_START_HOUR; h++) expected.push(h);
    assert.deepStrictEqual(open, expected,
      `expected the open window to be ${QUIET_END_HOUR}:00-${QUIET_START_HOUR}:00 Arizona`);
  });
});

// ---------------------------------------------------------------------------
// 3. Restricted words
// ---------------------------------------------------------------------------

describe("restricted words", () => {
  const blockedBy = async (body, key) => {
    const res = await run({ body });
    assert.strictEqual(res.state, "blocked", `expected a block for: ${body}`);
    assert.ok(codes(res).includes(key),
      `expected rule ${key}, got ${JSON.stringify(codes(res))}`);
  };
  const allowed = async (body) => {
    const res = await run({ body });
    assert.strictEqual(res.state, "allowed",
      `expected this near-miss to survive, blocked by ${JSON.stringify(codes(res))}: ${body}`);
  };

  test("blocks a guaranteed score increase", () =>
    blockedBy("We guarantee a 100 point score increase this month.", "guaranteed-score-increase"));

  test("allows describing what the service does", () =>
    allowed("We dispute items on your report that look inaccurate. Results vary by file."));

  test("blocks promising to remove accurate negative items", () =>
    blockedBy("We will delete negative items from your report.", "promise-to-remove-accurate-info"));

  test("allows describing the dispute process", () =>
    allowed("If an item on your report is inaccurate, we can dispute it for you."));

  test("blocks an advance fee", () =>
    blockedBy("Pay a $99 upfront fee to get started today.", "advance-fee"));

  test("allows describing billing after work is done", () =>
    allowed("You are billed only after the first round of work is complete."));

  test("blocks a CPN offer", () =>
    blockedBy("Ask us about a CPN for a clean start.", "file-segregation-cpn"));

  test("blocks guaranteed approval", () =>
    blockedBy("Guaranteed approval, everyone is approved.", "guaranteed-approval"));

  test("allows an ordinary approval update", () =>
    allowed("Your application moved to underwriting. We will let you know the decision."));

  test("blocks a guaranteed funding amount", () =>
    blockedBy("We guarantee $50,000 in funding for you.", "guaranteed-funding-amount"));

  test("allows an up-to amount with conditions", () =>
    allowed("Clients qualify for up to $50,000 depending on credit and revenue."));

  // The TikTok row's pattern is `.*` — it matches literally every string. It is
  // scoped to a platform, and a text message is not sent on a platform, so it
  // must never fire here. If it does, the gate blocks 100% of messages and the
  // near-misses above are the only thing that would catch it.
  test("never fires the platform-scoped TikTok rule", async () => {
    const res = await run({ body: "Anything at all." });
    assert.ok(!codes(res).includes("tiktok-credit-repair-prohibited"),
      "a platform-scoped rule must not apply to a message");
    assert.strictEqual(res.state, "allowed");
  });

  // Presence rules describe an ad funnel carrying a disclosure, not a text.
  // Applying them here would block every message ever sent.
  test("does not require the ad-funnel disclosure in a text message", async () => {
    const res = await run({ body: "Your documents were received." });
    assert.ok(!codes(res).includes("croa-consumer-rights"), JSON.stringify(codes(res)));
    assert.strictEqual(res.state, "allowed");
  });

  // Scoping is deliberately WIDER than the ad screen's: a message declares no
  // offer type, so a CROA rule applies to it regardless. Narrowing this to
  // offer_type would let every CROA phrase through in a text.
  test("applies credit-repair rules even though a message declares no offer type", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase." });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).some((c) => c === "guaranteed-score-increase"));
  });

  test("raises a task, and names the rule in it", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    assert.ok(res.task, "a restricted-word block must raise a task");
    assert.match(res.task.title, /restricted wording/i);
    assert.ok(res.task.body.includes(MESSAGE), "the task must name the message");
    assert.ok(res.task.detail.some((d) => /score/i.test(d)), "the task must carry a readable reason");
    assert.strictEqual(res.task.orgId, ORG);
  });

  // Work with no owner reaches nobody — src/lib/create-task.mjs rejects a task
  // without an employee role, and task-routing.test.mjs fails the build on a
  // raw INSERT INTO tasks anywhere in src/.
  test("the task carries an owning employee role", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    assert.ok(TASK_ROLES.has(res.task.assigneeRole),
      `${res.task.assigneeRole} is not an employee role`);
    assert.strictEqual(res.task.sourceWorkflow, GATE_SOURCE);
  });

  // body is the dedupe key (006_tasks_idempotency.sql keys on client +
  // source_workflow + body). Re-gating the same held message must produce the
  // same key, or a retry loop files a task per attempt.
  test("the dedupe key is stable across re-gating the same message", async () => {
    const msg = { body: "We guarantee a 100 point score increase.", messageId: MESSAGE };
    const a = await run(msg);
    const b = await run(msg);
    assert.strictEqual(a.task.body, b.task.body);
  });

  test("the dedupe key differs between two different messages", async () => {
    const a = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    const b = await run({ body: "We guarantee a 100 point score increase.", messageId: CLIENT });
    assert.notStrictEqual(a.task.body, b.task.body);
  });

  // The task is an index over work, not a second outbox — the offending copy is
  // client-facing text about a consumer's file and is not duplicated into it.
  test("does not copy the message body into the task", async () => {
    const body = "We guarantee a 100 point score increase.";
    const res = await run({ body, messageId: MESSAGE });
    assert.ok(!res.task.body.includes(body), "the task must not carry the message body");
    assert.ok(!JSON.stringify(res.task.detail).includes(body),
      "the readable detail must not carry the message body either");
  });

  // The other two blocks clear on their own — the person opts back in, the clock
  // reaches 11am. Neither needs a human, so neither raises a task.
  test("raises no task for an opt-out block", async () => {
    const res = await run({}, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.task, null);
  });

  test("raises no task for a quiet-hours block", async () => {
    const res = await gate(fakeDb(), base, { now: () => new Date("2026-08-01T07:00:00Z") });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.task, null);
  });
});

// ---------------------------------------------------------------------------
// No bypass. This section is the reason the file exists as much as the rules are.
// ---------------------------------------------------------------------------

describe("there is no override", () => {
  // Each of these is a name somebody would plausibly reach for. All of them must
  // be rejected, and rejected INTO A BLOCK — an attempt to bypass the gate has
  // to close it, never open it.
  for (const flag of ["force", "skipCompliance", "override", "test_bypass", "bypass", "ignoreOptOut"]) {
    test(`rejects a ${flag} option, and blocks`, async () => {
      const res = await gate(fakeDb(), base, { now: MIDDAY, [flag]: true });
      assert.strictEqual(res.state, "blocked",
        `${flag} must not produce a send — it must fail closed`);
      assert.ok(codes(res).includes("gate_error"));
    });
  }

  // The same names on the MESSAGE rather than the options object. These are
  // simply not read, so they change nothing: an opted-out client stays blocked.
  test("ignores bypass-looking fields on the message itself", async () => {
    const res = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), {
      ...base, force: true, skipCompliance: true, override: true, compliance_check_passed: true
    }, { now: MIDDAY });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("opted_out"));
  });

  // The source itself carries no such word. This catches an override added in a
  // later edit that the cases above do not happen to name.
  test("the gate source contains no bypass flag", () => {
    const src = fs.readFileSync(path.join(HERE, "gate.mjs"), "utf8");
    // Strip comments AND string literals before looking. Both discuss these
    // words on purpose — the header at length, and assertNoBypass's error
    // message names them so a caller who tries one gets told why it failed.
    // What must not exist is an IDENTIFIER: a parameter, option or property
    // that actually does something. So this checks code, not prose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code),
        `gate.mjs must not contain a ${flag} identifier`);
    }
  });
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

describe("fails closed", () => {
  test("blocks when the database is down", async () => {
    const res = await run({}, { failOptOut: true });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"), JSON.stringify(codes(res)));
  });

  test("blocks when a rule pattern will not compile", async () => {
    const broken = [{
      rule_set: "claims", rule_key: "broken", offer_types: [], platforms: [],
      match_type: "regex", pattern: "([unclosed", severity: "block",
      message: "broken rule", citation: null
    }];
    const res = await run({}, { rules: broken });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks a message with no org", async () => {
    const res = await run({ orgId: null });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks an unknown channel", async () => {
    const res = await run({ channel: "carrier_pigeon" });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks a message with no channel", async () => {
    const res = await run({ channel: null });
    assert.strictEqual(res.state, "blocked");
  });
});

// ---------------------------------------------------------------------------
// Reasons accumulate
// ---------------------------------------------------------------------------

describe("reasons", () => {
  // An operator looking at a held message should see everything wrong with it,
  // not fix one thing and rediscover the next on the retry.
  test("reports every reason at once, not just the first", async () => {
    const res = await gate(
      fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }),
      { ...base, body: "We guarantee a 100 point score increase." },
      { now: () => new Date("2026-08-01T07:00:00Z") } // midnight Arizona
    );
    assert.strictEqual(res.state, "blocked");
    const c = codes(res);
    assert.ok(c.includes("opted_out"), JSON.stringify(c));
    assert.ok(c.includes("quiet_hours"), JSON.stringify(c));
    assert.ok(c.includes("guaranteed-score-increase"), JSON.stringify(c));
  });
});

// ---------------------------------------------------------------------------
// gateAndRecord
// ---------------------------------------------------------------------------

describe("gateAndRecord", () => {
  test("records the block on the message row", async () => {
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) });
    await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    const w = db.writes.find((x) => x.kind === "message");
    assert.ok(w, "a blocked message must be recorded");
    assert.strictEqual(w.params[0], MESSAGE);
    assert.match(w.params[1], /opted_out/);
  });

  test("writes the task when one was raised", async () => {
    const db = fakeDb();
    await gateAndRecord(db, {
      ...base, messageId: MESSAGE, body: "We guarantee a 100 point score increase."
    }, { now: MIDDAY });
    assert.ok(db.writes.some((x) => x.kind === "task"), "a restricted-word block must file a task");
  });

  // An allowed message is not an audit event. Writing one on every send would
  // put a row-per-message write in front of the dispatcher's hot path.
  test("writes nothing when the message is allowed", async () => {
    const db = fakeDb();
    const res = await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    assert.strictEqual(res.state, "allowed");
    assert.deepStrictEqual(db.writes, []);
  });

  // A block is an audit record. Nothing here may clear it — the way to send
  // after a block is a new message row that passes on its own merits.
  test("never clears an existing block", async () => {
    const db = fakeDb();
    await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    for (const w of db.writes) {
      assert.ok(!/blocked_reason\s*=\s*NULL/i.test(w.sql), "a block must never be cleared");
    }
  });
});

// ---------------------------------------------------------------------------
// The constants are what the ticket asked for
// ---------------------------------------------------------------------------

describe("configuration", () => {
  test("the quiet window is 20:00-08:00 Arizona", () => {
    assert.strictEqual(QUIET_START_HOUR, 20);
    assert.strictEqual(QUIET_END_HOUR, 8);
    assert.strictEqual(QUIET_HOURS_TZ, "America/Phoenix");
  });
});

describe("prove/sim identity", () => {
  test("plus-tags match and near-misses do not", () => {
    assert.equal(emailLooksLikeProveSim("stanbridgejchris+sim-fund@gmail.com"), true);
    assert.equal(emailLooksLikeProveSim("e2e+aff-prove@fundhub.ai"), true);
    assert.equal(emailLooksLikeProveSim("stanbridgejchris+colin-qa@gmail.com"), true);
    assert.equal(emailLooksLikeProveSim("person+similar@example.com"), false);
    assert.equal(emailLooksLikeProveSim("person+simulation@example.com"), false);
    assert.equal(emailLooksLikeProveSim("e2e@fundhub.ai"), false);
    assert.equal(emailLooksLikeProveSim("person@example.com"), false);
  });

  test("agent prove line is recognized but does not make a real email a sim file", () => {
    assert.equal(phoneIsAgentProveLine("+16616054248"), true);
    assert.equal(phoneIsAgentProveLine("661-605-4248"), true);
    assert.equal(isProveSimRecipient({ email: "person@example.com", phone: "+16616054248" }), false);
    assert.equal(isProveSimRecipient({
      email: "stanbridgejchris+sim-fund@gmail.com", phone: "+16616054248"
    }), true);
  });
});
