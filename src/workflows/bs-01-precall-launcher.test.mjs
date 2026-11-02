import { test } from "node:test";
import assert from "node:assert";
import {
  handle as actualHandle, gridCells, resolveCellKey, runDeckDrip as actualRunDeckDrip,
  currentDeckBooking, deckContentReady, deckTime, DECK_SLOTS, DECK_TITLES, DECK_INTROS,
  FUNDING_PREFIX, REPAIR_PREFIX, DAYS, SLOTS, DAILY_SLOTS, KICKOFF_SLOT, KICKOFF_WAIT,
  SMS_BS01_BOOKED, SMS_BS01_PRECALL, SMS_BS01_DAYOF
} from "./bs-01-precall-launcher.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const handle = (args) => actualHandle({ lessonsEnabled: true, bookingCurrent: async () => true,
  sendPush: async () => ({ sent: false, reason: "push_not_enabled" }), ...args });
const runDeckDrip = (args) => actualRunDeckDrip({ enabled: true, bookingCurrent: async () => true, ...args });

// The docs spell each cell `{prefix}-{day}-{slot}-{name}`; the trailing word is
// theirs, so tests seed a plausible one and the code must find it by prefix rather
// than by reconstructing the suffix.
const cellKey = (prefix, day, slot, name) => `${prefix}-${day}-${slot}-${name}`;

const templatesFor = (prefix, cells) =>
  cells.map(({ day, slot, name }) => ({
    org_id: "org-1", template_key: cellKey(prefix, day, slot, name),
    channel: "email", body: `${day}-${slot}`, compliance_passed: true
  }));

// All 18 cells populated — the "docs are complete" case, not today's reality.
const allCells = (prefix) => gridCells(prefix).map((c) => ({ day: c.day, slot: c.slot, name: c.name }));

const fundingClient = () => ({ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} });
const repairClient = () => ({ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} });

// Far enough that T-48h and the +71h grid are both still in the future.
const farStart = () => {
  const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
};
const soonStart = () => new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

test("deck plan covers both lanes and selects a distinct lesson for each slot", () => {
  assert.equal(DECK_SLOTS.length, 17);
  for (const lane of ["funding", "blueprint"]) {
    const slugs = DECK_SLOTS.map((slot) => slot[lane]).filter(Boolean);
    assert.equal(new Set(slugs).size, slugs.length, "a person never sees the same lesson twice");
    for (const slug of slugs) {
      assert.ok(DECK_TITLES[slug], slug);
      assert.ok(DECK_INTROS[slug], slug);
    }
  }
  assert.equal(new Set(DECK_SLOTS.flatMap((slot) => [slot.funding, slot.blueprint]).filter(Boolean)).size, 22);
  assert.equal(DECK_SLOTS.filter((slot) => slot.channel === "push").length, 3);
  const times = DECK_SLOTS.map((_, i) => deckTime("2026-11-10T17:00:00.000Z", i).getTime());
  assert.ok(times.every((time, i) => !i || time - times[i - 1] >= 60 * 60 * 1000));
});

test("deck emails use the saved survey lane and live URL", async () => {
  const db = pgFake({
    clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [
      { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
        subject: "{{deck_title}}", body: "{{deck_intro}}\n{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
        body: "{{deck_url}}", compliance_passed: true }
    ]
  });
  const pushes = [];
  const result = await runDeckDrip({ db, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "evt-decks", startTime: farStart(),
    sendPush: async (_db, args) => { pushes.push(args.slug); return { sent: true }; } });
  assert.equal(result.sent.length, 13);
  assert.equal(db.messages.length, 10);
  assert.equal(pushes.length, 3);
  assert.ok(db.messages.some((message) => /\/slideshows\/pre-underwriting\.html/.test(message.rendered_body)));
  assert.ok(db.messages.some((message) => /\/slideshows\/funding-sequence\.html/.test(message.rendered_body)));
  assert.ok(db.messages.some((message) => /strong score can still meet a bank rule/.test(message.rendered_body)));
});

test("push lessons fall back to email when app push is unavailable", async () => {
  const db = pgFake({ clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [
      { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
        body: "{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
        body: "{{deck_url}}", compliance_passed: true }
    ] });
  const result = await runDeckDrip({ db, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "evt-fallback", startTime: farStart(),
    sendPush: async () => ({ sent: false, reason: "push_not_enabled" }) });
  assert.equal(result.sent.length, 13);
  assert.equal(db.messages.length, 13);
  assert.equal(db.messages.filter((m) => m.channel === "email").length, 11);
  assert.equal(new Set(db.messages.map((m) => m.rendered_body)).size, 13);
  assert.equal(result.sent.filter((m) => m.channel === "email").length, 11);
});

test("a setter correction changes the remaining lane at the next deck wake", async () => {
  const client = { ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } };
  const db = pgFake({ clients: [client], templates: [
    { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON",
      channel: "email", body: "{{deck_url}}", compliance_passed: true },
    { org_id: "org-1", template_key: "SMS-BS-DECK",
      channel: "sms", body: "{{deck_url}}", compliance_passed: true }
  ] });
  const step = fakeStep();
  const original = step.sleepUntil;
  let wakes = 0;
  step.sleepUntil = async (...args) => {
    wakes++;
    if (wakes === 3) client.custom_fields.setter_survey_edits = { cf_svy_self_reported_fico: "500-619" };
    return original(...args);
  };
  await runDeckDrip({ db, step, orgId: "org-1", clientId: "cl-1", eventId: "evt-switch",
    startTime: farStart(), sendPush: async () => ({ sent: true }) });
  assert.ok(db.messages.some((message) => /\/slideshows\/thirteen-points\.html/.test(message.rendered_body)));
  assert.ok(!db.messages.some((message) => /\/slideshows\/pre-underwriting\.html/.test(message.rendered_body)));
});

test("short notice bookings skip past deck slots and a held call stops remaining sends", async () => {
  const client = { ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } };
  const templates = [
    { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
      body: "{{deck_url}}", compliance_passed: true },
    { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
      body: "{{deck_url}}", compliance_passed: true }
  ];
  const shortDb = pgFake({ clients: [client], templates });
  const shortStart = soonStart();
  const short = await runDeckDrip({ db: shortDb, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "evt-short", startTime: shortStart, sendPush: async () => ({ sent: true }) });
  assert.ok(short.sent.length > 0 && short.sent.length <
    DECK_SLOTS.filter((slot) => slot.funding).length);
  for (const lesson of short.sent) {
    assert.ok(deckTime(shortStart, lesson.slot).getTime() - Date.now() >= 60 * 60 * 1000);
  }

  const heldDb = pgFake({ clients: [client], templates,
    events: [{ client_id: "cl-1", name: "call.completed" }] });
  const held = await runDeckDrip({ db: heldDb, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "evt-held", startTime: farStart(), sendPush: async () => ({ sent: true }) });
  assert.equal(held.stoppedBecause, "call_held");
  assert.equal(heldDb.messages.length, 0);
});

test("approved deck template replaces the old filler email grid", async () => {
  const db = pgFake({
    clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [
      { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
        subject: "{{deck_title}}", body: "{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
        body: "{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_BS01_PRECALL, channel: "sms",
        body: "Your call is coming up", compliance_passed: true },
      ...templatesFor(FUNDING_PREFIX, allCells(FUNDING_PREFIX))
    ]
  });
  const result = await handle({ event: ev("booking.created", {
    email: "a@b.com", startTime: farStart() }), db, step: fakeStep() });
  assert.equal(result.decks.sent.length, 13);
  assert.equal(result.gaps.length, 0);
  assert.equal(db.messages.filter((m) => m.template_key.startsWith("BS-FUND-")).length, 0);
  assert.equal(db.messages.filter((m) => m.template_key === "EMAIL-BS-DECK-LESSON").length, 11);
  assert.equal(db.messages.filter((m) => m.template_key === "SMS-BS-DECK").length, 2);
});

test("deck lessons stay off and the existing BS-01 grid continues until activation", async () => {
  const db = pgFake({
    clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [
      { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
        subject: "{{deck_title}}", body: "{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
        body: "{{deck_url}}", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_BS01_PRECALL, channel: "sms",
        body: "precall", compliance_passed: true },
      ...templatesFor(FUNDING_PREFIX, allCells(FUNDING_PREFIX))
    ]
  });
  const result = await actualHandle({ event: ev("booking.created", {
    email: "a@b.com", startTime: farStart() }), db, step: fakeStep(), lessonsEnabled: false });
  assert.equal(result.decks.skipped, "deck_lessons_disabled");
  assert.equal(db.messages.filter((m) => m.template_key.startsWith("BS-FUND-")).length, 18);
  assert.equal(db.messages.filter((m) => m.template_key === "EMAIL-BS-DECK-LESSON" || m.template_key === "SMS-BS-DECK").length, 0);
  assert.equal(db.messages.filter((m) => m.channel === "push").length, 0);
});

test("deck activation needs both approved email and SMS copy", async () => {
  for (const sms of [null, { org_id: "org-1", template_key: "SMS-BS-DECK",
    channel: "sms", body: "draft", compliance_passed: false }]) {
    const db = pgFake({ clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
      templates: [
        { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
          body: "{{deck_url}}", compliance_passed: true },
        ...(sms ? [sms] : []),
        ...templatesFor(FUNDING_PREFIX, allCells(FUNDING_PREFIX))
      ] });
    assert.equal(await deckContentReady(db, "org-1"), false);
    const result = await handle({ event: ev("booking.created", { email: "a@b.com",
      startTime: farStart() }), db, step: fakeStep() });
    assert.equal(result.decks.skipped, "deck_template_pending");
    assert.equal(db.messages.filter((m) => m.template_key.startsWith("BS-FUND-")).length, 18);
    assert.equal(db.messages.filter((m) => m.template_key === "EMAIL-BS-DECK-LESSON").length, 0);
  }
});

test("old booking run stops when the current call has moved or cancelled", async () => {
  const oldStart = farStart();
  const movedStart = new Date(new Date(oldStart).getTime() + 60 * 60 * 1000).toISOString();
  let booking = { status: "rescheduled", starts_at: movedStart, provider_uid: "booking-uid-1" };
  const db = { async query(sql, params) {
    assert.match(sql, /FROM bookings/);
    assert.deepEqual(params, ["org-1", "cl-1"]);
    return { rows: [booking] };
  } };
  const check = () => currentDeckBooking(db, { orgId: "org-1", clientId: "cl-1",
    bookingUid: "booking-uid-1", startTime: oldStart });
  assert.equal(await check(), false);
  booking = { status: "cancelled", starts_at: oldStart, provider_uid: "booking-uid-1" };
  assert.equal(await check(), false);
  booking = { status: "booked", starts_at: oldStart, provider_uid: "new-booking-uid" };
  assert.equal(await check(), false);
  booking = { status: "booked", starts_at: oldStart, provider_uid: "booking-uid-1" };
  assert.equal(await check(), true);
});

test("a moved call is checked before any old-run deck message queues", async () => {
  const db = pgFake({ clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [{ org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON",
      channel: "email", body: "{{deck_url}}", compliance_passed: true }] });
  const result = await runDeckDrip({ db, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "old-event", startTime: farStart(), bookingUid: "old-uid",
    bookingCurrent: async () => false });
  assert.equal(result.stoppedBecause, "booking_changed");
  assert.equal(db.messages.length, 0);
});

test("a push booking change cannot fall back into a stale email", async () => {
  const db = pgFake({ clients: [{ ...fundingClient(), custom_fields: { cf_svy_self_reported_fico: "700-759" } }],
    templates: [{ org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON",
      channel: "email", body: "{{deck_url}}", compliance_passed: true }] });
  const result = await runDeckDrip({ db, step: fakeStep(), orgId: "org-1", clientId: "cl-1",
    eventId: "old-event", startTime: farStart(),
    sendPush: async () => ({ sent: false, reason: "booking_changed" }) });
  assert.equal(result.stoppedBecause, "booking_changed");
  assert.equal(db.messages.length, 0);
});

test("noon and 3 p.m. calls keep all lane lessons clear of reminders", async () => {
  for (const [hour, lane, expected] of [[19, "funding", 13], [22, "blueprint", 17]]) {
    const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    start.setUTCHours(hour, 0, 0, 0);
    const db = pgFake({ clients: [{ ...(lane === "funding" ? fundingClient() : repairClient()),
      custom_fields: { cf_svy_self_reported_fico: lane === "funding" ? "700-759" : "500-619" } }],
      templates: [
        { org_id: "org-1", template_key: "EMAIL-BS-DECK-LESSON", channel: "email",
          body: "{{deck_url}}", compliance_passed: true },
        { org_id: "org-1", template_key: "SMS-BS-DECK", channel: "sms",
          body: "{{deck_url}}", compliance_passed: true }
      ] });
    const result = await runDeckDrip({ db, step: fakeStep(), orgId: "org-1",
      clientId: "cl-1", eventId: `evt-spaced-${lane}`, startTime: start.toISOString(),
      sendPush: async () => ({ sent: true }) });
    assert.equal(result.sent.length, expected);
    for (const lesson of result.sent) {
      const at = deckTime(start, lesson.slot).getTime();
      for (const lead of [48, 24, 2]) {
        assert.ok(Math.abs(at - (start.getTime() - lead * 60 * 60 * 1000)) >= 60 * 60 * 1000);
      }
    }
  }
});

// --- grid shape -------------------------------------------------------------

test("grid is a full 3 days x 6 slots — 18 cells, every one addressed", () => {
  const cells = gridCells(FUNDING_PREFIX);
  assert.equal(cells.length, 18);
  assert.deepEqual([...new Set(cells.map((c) => c.day))], DAYS);
  for (const day of DAYS) {
    assert.deepEqual(cells.filter((c) => c.day === day).map((c) => c.slot), SLOTS, `${day} addresses all six columns`);
  }

  // The kickoff is the enrollment touch: D1-E1 alone fires with no preceding wait.
  const kickoff = cells.find((c) => c.day === "D1" && c.slot === KICKOFF_SLOT);
  assert.equal(kickoff.after, null, "kickoff fires on enrollment");
  assert.equal(cells.filter((c) => c.after === null).length, 1);
});

test("cadence is four named daily sends per day across three days, not a flat interval", () => {
  const cells = gridCells(FUNDING_PREFIX);
  for (const day of DAYS) {
    const daily = cells.filter((c) => c.day === day && DAILY_SLOTS.includes(c.slot));
    assert.equal(daily.length, 4, `${day} has four named daily sends`);
    assert.deepEqual(daily.map((c) => c.name), ["morning", "midday", "afternoon", "evening"]);
  }
  // The bug this replaces: every gap was a flat "4h".
  const waits = cells.map((c) => c.after).filter(Boolean);
  assert.ok(new Set(waits).size > 1, "waits must not all be the same flat interval");
  assert.ok(!waits.every((w) => w === "4h"), "flat 4h spacing is the defect being fixed");
});

test("day rows are 24h apart, and the whole sequence lands inside the 72h window", () => {
  const hours = (w) => Number(String(w).replace(/h$/, ""));
  let t = 0;
  const at = gridCells(FUNDING_PREFIX).map((c) => { t += c.after ? hours(c.after) : 0; return { cell: c, t }; });

  assert.equal(at[0].t, 0, "kickoff at t=0");
  assert.equal(at.at(-1).t, 71, "last cell at +71h");
  assert.ok(at.at(-1).t < 72, "sequence stays inside the source's 72-hour window");

  // Same slot on consecutive days is exactly 24h apart.
  for (const slot of SLOTS) {
    const d2 = at.find((x) => x.cell.day === "D2" && x.cell.slot === slot).t;
    const d3 = at.find((x) => x.cell.day === "D3" && x.cell.slot === slot).t;
    assert.equal(d3 - d2, 24, `${slot} is 24h apart between D2 and D3`);
  }

  // D1's morning is preceded by the kickoff wait, not the intra-day step.
  assert.equal(at.find((x) => x.cell.day === "D1" && x.cell.slot === "E2").cell.after, KICKOFF_WAIT);

  // The old port put all five sends inside 16h; the fix must span three days.
  assert.ok(at.at(-1).t > 48, "a three-day sequence, not a one-day burst");
});

// --- key resolution ---------------------------------------------------------

test("cells resolve by prefix — the docs' trailing name word is not reconstructed", async () => {
  const db = pgFake({ templates: [{ org_id: "org-1", template_key: "BS-FUND-D1-E1-morning", body: "x", compliance_passed: true }] });
  const key = await resolveCellKey(db, "org-1", "BS-FUND-D1-E1");
  assert.equal(key, "BS-FUND-D1-E1-morning", "found without the code knowing the suffix");
});

test("an unpopulated cell resolves to null rather than a guessed key", async () => {
  const db = pgFake({ templates: [] });
  assert.equal(await resolveCellKey(db, "org-1", "BS-FUND-D2-E6"), null);
});

test("a cell whose template failed compliance does not resolve", async () => {
  const db = pgFake({ templates: [{ org_id: "org-1", template_key: "BS-FUND-D1-E2-morning", body: "x", compliance_passed: false }] });
  assert.equal(await resolveCellKey(db, "org-1", "BS-FUND-D1-E2"), null);
});

// --- drip behaviour ---------------------------------------------------------

test("happy path: funding-path client runs every populated funding cell", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, cells) });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, 18);
  assert.deepEqual(res.gaps, []);
  assert.deepEqual(res.skipped, []);
  assert.deepEqual(db.clients[0].tags.sort(), ["bs:precall", "call:booked"]);
});

test("branch: repair-only client runs the repair grid", async () => {
  const cells = allCells(REPAIR_PREFIX);
  const db = pgFake({ clients: [repairClient()], templates: templatesFor(REPAIR_PREFIX, cells) });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.drip, "repair");
  assert.equal(db.messages.length, 18);
  assert.ok(db.messages.every((m) => m.template_key.startsWith(REPAIR_PREFIX)));
});

test("branch: no matching path — tags precall but runs no drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "none");
  assert.equal(db.messages.length, 0);
});

// --- the 7 missing bodies ---------------------------------------------------

test("partially-populated grid: sends what exists, reports the rest as gaps, invents nothing", async () => {
  // 11 of 18 filled, matching the docs today. Which 11 is arbitrary here — the
  // point is that the code addresses all 18 and never fabricates the remainder.
  const filled = allCells(FUNDING_PREFIX).slice(0, 11);
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, filled) });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(db.messages.length, 11, "only the cells with real copy send");
  assert.equal(res.gaps.length, 7, "the empty cells are reported, not skipped silently");
  assert.equal(res.sent.length + res.gaps.length, 18, "all 18 cells are addressed either way");
  for (const g of res.gaps) assert.match(g.keyPrefix, /^BS-FUND-D[123]-E[1-6]$/);
});

test("empty grid: the whole drip is gaps and no message is invented", async () => {
  const db = pgFake({ clients: [fundingClient()], templates: [] });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, 0);
  assert.equal(res.gaps.length, 18);
});

// --- the recheck exit gate --------------------------------------------------

test("recheck exits the drip once the call has been held", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({
    clients: [fundingClient()],
    templates: templatesFor(FUNDING_PREFIX, cells),
    events: [{ client_id: "cl-1", name: "call.completed" }]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.stoppedBecause, "call_held");
  assert.equal(res.stoppedAt, "D1-E2", "stops at the first gated wake after the kickoff");
  assert.equal(db.messages.length, 1, "only the kickoff went out — pre-call copy stops at the call");
  assert.ok(!(db.clients[0].tags || []).includes("call:booked"), "a cut-short drip is not a completed one");
});

test("recheck gates every later wake, not only the one after the kickoff", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const gated = gridCells(FUNDING_PREFIX).filter((c) => c.gate);
  assert.equal(gated.length, 17, "every cell except the kickoff re-tests call-held");

  // Call lands mid-sequence: the drip must notice at the next wake, not run on.
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, cells) });
  let sends = 0;
  const step = {
    run: async (id, fn) => {
      if (id.startsWith("send-")) sends += 1;
      // Simulate call.completed arriving after the third send.
      if (sends === 3 && !db.events.length) db.events.push({ client_id: "cl-1", name: "call.completed" });
      return fn();
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step
  });

  assert.equal(res.stoppedBecause, "call_held");
  assert.ok(db.messages.length < 18, "the drip stopped rather than sending all 18");
  assert.ok(db.messages.length <= 4, `stopped promptly after the call, got ${db.messages.length}`);
});

test("recheck does not read cf_analyzer_recommendation — that field is written during the call", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const client = fundingClient();
  // Present-but-pre-call is impossible in the real model; if the gate read this
  // field it would pass on exactly the wrong side. The drip must ignore it.
  client.custom_fields = { cf_analyzer_recommendation: "FULL_FUNDING" };
  const db = pgFake({ clients: [client], templates: templatesFor(FUNDING_PREFIX, cells) });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.stoppedBecause, null, "the recommendation field must not stop the drip");
  assert.equal(db.messages.length, 18);
});

// --- timestamps + idempotency ----------------------------------------------

test("timestamps: bs_precall_start_ts and bs_email_last_sent_ts are real ISO strings, not 'now'", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, cells) });
  await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const cf = db.clients[0].custom_fields;
  assert.ok(cf.bs_precall_start_ts !== "now", "bs_precall_start_ts must not be literal 'now'");
  assert.ok(new Date(cf.bs_precall_start_ts).getFullYear() > 2020);
  assert.ok(cf.bs_email_last_sent_ts !== "now", "bs_email_last_sent_ts must not be literal 'now'");
});

test("duplicate delivery: replaying does not double-send the drip", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, cells) });
  const event = ev("booking.created", { startTime: farStart() }, { id: "evt-dup-bs01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 18, "per-cell provider_ref keeps a replay idempotent");
});

test("idempotency key is per grid cell, so two cells in one run never collide", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({ clients: [fundingClient()], templates: templatesFor(FUNDING_PREFIX, cells) });
  await handle({
    event: ev("booking.created", { startTime: farStart() }, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const refs = db.messages.map((m) => m.provider_ref);
  assert.equal(new Set(refs).size, refs.length, "every cell has a distinct provider_ref");
});

// --- SMS companion (owner 2026-08-15) ---------------------------------------

// SMS_BS01_BOOKED and SMS_BS01_DAYOF stay seeded but are no longer sent by BS-01
// (owner 2026-08-22 — S-04B owns both the immediate confirm text and the T-2h
// day-of text; BS-01's own DAYOF send collided with S-04B's REMIND-2H at the
// identical sleepUntil target, confirmed against the 2026-08-20 live template
// dump). Left in the fixture so the tests below prove BS-01 does NOT reach for
// either one.
const smsTemplates = () => [
  { org_id: "org-1", template_key: SMS_BS01_BOOKED, channel: "sms", body: "booked", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_BS01_PRECALL, channel: "sms", body: "precall", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_BS01_DAYOF, channel: "sms", body: "dayof", compliance_passed: true }
];

test("sms: every booking gets exactly one pre-call SMS, and never the retired booked or day-of texts", async () => {
  const start = farStart();
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: smsTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: start }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.drip, "none");
  assert.equal(db.messages.length, 1);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_BS01_PRECALL]);
  assert.ok(!db.messages.some((m) => m.template_key === SMS_BS01_BOOKED), "no duplicate booked text");
  assert.ok(!db.messages.some((m) => m.template_key === SMS_BS01_DAYOF), "no duplicate day-of text — S-04B owns T-2h");
  assert.equal(res.sms.stoppedBecause, null);
  assert.equal(res.sms.skippedDayOf, "owned_by_s04b");
  assert.ok(db.clients[0].custom_fields.bs_sms_last_sent_ts);
});

test("sms: reports no_start_time (not owned_by_s04b) when the booking has no startTime", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: smsTemplates()
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(db.messages.length, 0);
  assert.equal(res.sms.skippedPrecall, "no_start_time");
  assert.equal(res.sms.skippedDayOf, "no_start_time");
  assert.ok(!db.messages.some((m) => m.template_key === SMS_BS01_DAYOF));
});

test("sms: sends nothing when the call is already held before the precall wake", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: smsTemplates(),
    events: [{ client_id: "cl-1", name: "call.completed" }]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.sms.stoppedBecause, "call_held");
  assert.equal(res.sms.stoppedAt, "sms-precall");
  assert.equal(db.messages.length, 0);
});

test("sms + email: funding path queues email grid and the pre-call SMS together", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({
    clients: [fundingClient()],
    templates: [...templatesFor(FUNDING_PREFIX, cells), ...smsTemplates()]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: farStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, 19);
  assert.equal(db.messages.filter((m) => m.channel === "sms").length, 1);
  assert.equal(db.messages.filter((m) => m.channel === "email").length, 18);
});

test("bs-01: first precall touch is skipped when the call is sooner than 48 hours", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({
    clients: [fundingClient()],
    templates: [...templatesFor(FUNDING_PREFIX, cells), ...smsTemplates()]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: soonStart() }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.sms.skippedPrecall, "already_past");
  assert.ok(!db.messages.some((m) => m.template_key === SMS_BS01_PRECALL));
  assert.ok(res.skipped.some((s) => s.day === "D1" && s.slot === "E1" && s.reason === "already_past"));
  assert.ok(!db.messages.some((m) => /D1-E1/.test(m.template_key)));
});

test("bs-01: no start time skips the grid and the precall SMS (does not fire at book)", async () => {
  const cells = allCells(FUNDING_PREFIX);
  const db = pgFake({
    clients: [fundingClient()],
    templates: [...templatesFor(FUNDING_PREFIX, cells), ...smsTemplates()]
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.skipped[0].reason, "no_start_time");
  assert.equal(res.sms.skippedPrecall, "no_start_time");
  assert.equal(db.messages.length, 0);
});

test("bs-01 listens to booking.created and booking.rescheduled", async () => {
  const { bs01PrecallLauncher } = await import("./bs-01-precall-launcher.mjs");
  const names = (bs01PrecallLauncher.opts.triggers || []).map((t) => t.event).sort();
  assert.deepEqual(names, ["booking.created", "booking.rescheduled"]);
});

