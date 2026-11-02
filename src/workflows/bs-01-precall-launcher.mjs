// BS-01 — Pre-Call Backend Launcher.
// Source: the CRM system map BACK-END SELLING section.
// Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live): both are
// "Add to workflow" targets BS-01 enrolls into, not independently-triggered
// workflows, so they're one continuous flow here rather than three separate files.
// The [AGENT DRAFT] BS-EMAIL-FUNDING-72HR duplicate (identical subjects, same
// sequence) is RETIRED per spec §6's explicit note — this ports the "(live)" copy.
//
// CADENCE — the source is a DAY × SLOT grid, not a flat interval.
// The first port spaced every send 4h apart, which collapsed a three-day sequence
// into a 16-hour burst. Corrected here to the source shape:
//
//   D1-E1 Kickoff → wait → RECHECK (exit gate) → then, per day, four sends at
//   named slots: morning (E2), midday (E3), afternoon (E4), evening (E5),
//   repeating across D1, D2, D3.
//
// That is the D1-D3 × E1-E6 grid the docs repo keys against: three day rows, six
// slot columns = 18 cells. E1 is the kickoff column (only D1's is written), E2-E5
// are the four daily sends, E6 is spare. The docs currently carry copy for 11 of
// the 18; the other 7 — including D2-E1 and D3-E1 — are empty cells, not absent ones.
//
// The 7 empty cells are NOT filled in here. Copy is never invented (the same rule
// sendTemplated already holds). The grid is addressed in full and each cell is
// resolved against message_templates at send time — a cell with no row is skipped
// and reported in `gaps`, so the missing 7 surface as data rather than being
// silently baked into a shorter array.
//
// KEY NAMING: `BS-FUND-{day}-{slot}-{name}` / `BS-REPAIR-{day}-{slot}-{name}`
// (Darwin, from the docs repo — e.g. BS-FUND-D1-E1-morning). The trailing `-{name}`
// word varies per cell and is NOT reconstructable from the grid position, so cells
// are resolved by `{prefix}-{day}-{slot}-%` prefix match rather than by guessing
// the suffix. parse-email.mjs seeds template_key from the docs header verbatim, so
// these match exactly as the docs spell them — with no "EMAIL-" prefix, which the
// previous port invented and which never existed in the source.
//
// TIMING: booking.created carries no local-time anchor, so slot times are relative
// offsets, not wall-clock. Each day row totals 24h (12+1+3+3+4+1), so the whole
// sequence lands inside the source's 72-hour window — kickoff at t=0, last cell at
// t=+71h. A timing choice, logged in workflow-migration-table.md, not a business rule.
//
// RECHECK: the source's Gate 2 is an Exit, not a branch. BS-01 is pre-call material
// ("watch these before our call"), so once the call has been HELD the remaining
// content is stale and sending it is worse than sending nothing. The gate therefore
// tests call-held — DPC-02's `callHappened` (a `call.completed` event for this
// client), single-sourced from the workflow that owns the concept — and NOT
// cf_analyzer_recommendation, which is only written DURING the call and would
// therefore pass on exactly the wrong side. Checked at every wake, not only after
// the kickoff, because the sequence spans ~71 hours and the call normally lands
// inside it; a gate that fired once at t=+12h would still send 14 stale touches.
//
// Trigger: booking.created. Gate: product path decides which EMAIL drip runs
// (Funding vs Repair) — Rule 4-compliant (categorical path, not a dollar amount).
// SMS companion (owner 2026-08-15): three texts for every booking, no video links,
// parallel with the email drip, same call-held exit.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { callHappened } from "./dpc-02-call-outcome-enforcement.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { creditTierFor } from "../config/survey-qualification.mjs";
import { sendDeckPush } from "./bs-deck-push.mjs";

export const FUNDING_PREFIX = "BS-FUND";
export const REPAIR_PREFIX = "BS-REPAIR";

// Thin SMS companion (owner 2026-08-15): pre-call touches, no video links, not the
// email 18-cell grid. One set for every booked contact — path split is email-only.
// 2026-08-22: the immediate booked text moved to S-04B (see runSmsDrip).
// RETIRED 2026-08-22 — S-04B owns the immediate booked text. Kept for the
// seed/audit trail; no send site references it.
export const SMS_BS01_BOOKED = "SMS-BS01-01-BOOKED";
export const SMS_BS01_PRECALL = "SMS-BS01-02-PRECALL";
// RETIRED 2026-08-22 — S-04B's SMS-S04-03-REMIND-2H owns the T-2h slot (same
// sleepUntil target). Kept for the seed/audit trail; no send site references it.
export const SMS_BS01_DAYOF = "SMS-BS01-03-DAYOF";
// RETIRED 2026-08-23 — precall is now T-48h from the appointment, not +24h from book.
export const SMS_PRECALL_WAIT = "24h";
export const SMS_DAYOF_OFFSET_MS = 2 * 60 * 60 * 1000;
export const PRECALL_LEAD_MS = 48 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// One lesson per slot. Shared lessons reach both lanes; the remaining 14 are
// lane-specific. No person receives the same deck twice.
export const DECK_SLOTS = Object.freeze([
  { funding: null, blueprint: "bank-said-no", channel: "email" },
  { funding: "the-call", blueprint: "the-call", channel: "push" },
  { funding: "pre-underwriting", blueprint: "thirteen-points", channel: "email" },
  { funding: "soft-pull", blueprint: "soft-pull", channel: "sms" },
  { funding: null, blueprint: "card-paydown", channel: "email" },
  { funding: "funding-sequence", blueprint: "credit-optimization", channel: "email" },
  { funding: "who-we-are", blueprint: "who-we-are", channel: "push" },
  { funding: "apply-yourself", blueprint: "blueprint-value", channel: "email" },
  { funding: "your-data-is-safe", blueprint: "your-data-is-safe", channel: "email" },
  { funding: null, blueprint: "business-one-two", channel: "email" },
  { funding: "money-on-the-table", blueprint: "credit-partner", channel: "email" },
  { funding: "cost-of-waiting", blueprint: "cost-of-waiting", channel: "sms" },
  { funding: "the-maximum", blueprint: "the-maximum", channel: "email" },
  { funding: null, blueprint: "blueprint-12-months", channel: "email" },
  { funding: "tried-before", blueprint: "tried-before", channel: "email" },
  { funding: "the-money-talk", blueprint: "the-money-talk", channel: "push" },
  { funding: "after-you-say-yes", blueprint: "blueprint-in-action", channel: "email" }
]);

export const DECK_TITLES = Object.freeze({
  "the-call": "Your file picks the path before any price",
  "soft-pull": "A soft pull does not move your score",
  "pre-underwriting": "Why a bank can deny good credit",
  "bank-said-no": "The reason a bank said no is on your report",
  "funding-sequence": "The order of applications changes the result",
  "thirteen-points": "The 13 points that shape funding readiness",
  "who-we-are": "How Fundhub works with your file",
  "apply-yourself": "What the next bank sees after an application",
  "card-paydown": "Which card to pay first",
  "your-data-is-safe": "How Fundhub handles your information",
  "money-on-the-table": "What a strong score can leave on the table",
  "credit-optimization": "Why the letters go out in order",
  "cost-of-waiting": "What changes while you wait",
  "after-you-say-yes": "What happens after you sign",
  "blueprint-value": "A roadmap built from your own file",
  "the-maximum": "How the maximum starts with your file",
  "business-one-two": "Why each business is judged on its own",
  "blueprint-12-months": "How the Blueprint guides your next 12 months",
  "tried-before": "Why past attempts did not fund",
  "the-money-talk": "The money talk happens on the call",
  "credit-partner": "How a credit partner can help",
  "blueprint-in-action": "Your Blueprint dashboard, start to finish"
});

export const DECK_INTROS = Object.freeze({
  "the-call": "Your file comes first on the call. The path and price follow what it actually shows.",
  "soft-pull": "A soft file review lets us see where you stand before anyone applies at a bank.",
  "pre-underwriting": "A strong score can still meet a bank rule your file does not pass yet.",
  "bank-said-no": "A decline gives us a starting point: read the file, find the reason, then put the work in order.",
  "funding-sequence": "Bank choice and application order matter because each lender reads the file it receives.",
  "thirteen-points": "The Blueprint puts the 13 funding-readiness checks in an order you can act on.",
  "who-we-are": "See the people, records and written steps behind the Fundhub process.",
  "apply-yourself": "Before sending another application, see what the next lender may read on your file.",
  "card-paydown": "Each card has its own balance target and statement date. The order changes what reports next.",
  "your-data-is-safe": "See what information Fundhub uses, where it appears and what you approve before paying.",
  "money-on-the-table": "A sample file shows how card balances can change the funding path even with a strong score.",
  "credit-optimization": "Credit work moves through documented rounds, bureau replies and a visible record in your portal.",
  "cost-of-waiting": "Waiting has a cost only if it delays a real goal. Put your own timing against the work ahead.",
  "after-you-say-yes": "The agreement and portal show what starts after you sign, who acts and what approved means.",
  "blueprint-value": "The Blueprint starts with your file and turns it into an ordered 12-month plan.",
  "the-maximum": "Your first bank offer is one answer. Your file and application order shape what comes next.",
  "business-one-two": "Each business has its own setup and bank review, even when the owner is the same.",
  "blueprint-12-months": "See the first Blueprint steps and how the plan changes as your file changes.",
  "tried-before": "If a past funding attempt failed, look at what was sent and what it left on the file.",
  "the-money-talk": "If cost is the concern, bring it to the call. We will read the real terms with your file open.",
  "credit-partner": "A credit partner has a separate file, consent and obligation. See how that path works.",
  "blueprint-in-action": "Open a sample Blueprint dashboard and follow the first steps from the file review forward."
});

export async function currentDeckLane(database, clientId) {
  const r = await database.query("SELECT custom_fields FROM clients WHERE id = $1", [clientId]);
  return creditTierFor(r.rows[0]?.custom_fields || {});
}

export async function deckContentReady(database, orgId) {
  for (const key of ["EMAIL-BS-DECK-LESSON", "SMS-BS-DECK"]) {
    const result = await database.query(
      `SELECT body, subject, compliance_passed FROM message_templates
        WHERE org_id = $1 AND template_key = $2 LIMIT 1`, [orgId, key]
    );
    const template = result.rows[0];
    if (!template?.compliance_passed || !String(template.body || "").trim()
      || (key.startsWith("EMAIL-") && !String(template.subject || "").trim())) return false;
  }
  return true;
}

export async function currentDeckBooking(database, { orgId, clientId, bookingUid = null,
  startTime, now = new Date() }) {
  const expected = new Date(startTime).getTime();
  if (!Number.isFinite(expected) || expected <= new Date(now).getTime()) return false;
  const result = await database.query(
    `SELECT status, starts_at, provider_uid FROM bookings WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at DESC LIMIT 1`, [orgId, clientId]
  );
  const booking = result.rows[0];
  return ["booked", "rescheduled"].includes(booking?.status)
    && (!bookingUid || booking.provider_uid === bookingUid)
    && new Date(booking.starts_at).getTime() === expected;
}

// Arizona stays UTC-7 all year. Lessons occupy the three full days before the
// appointment, 9 a.m.–4 p.m. local, at least an hour apart. A late booking
// skips elapsed slots; it never flushes a backlog of lessons at once.
export function deckTime(startTime, index) {
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs) || index < 0 || index >= DECK_SLOTS.length) return null;
  const local = new Date(startMs - 7 * HOUR);
  const day = index < 6 ? 3 : index < 12 ? 2 : 1;
  const count = day === 1 ? 5 : 6;
  const callHour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const hours = day === 3 ? [9, 10, 11, 13, 15, 16]
    : [9, 10, 11, 12, 13, 14, 15, 16]
      .filter((hour) => Math.abs(hour - callHour) >= 1);
  const picks = count === 6
    ? (hours.length === 8 ? [0, 1, 2, 4, 5, 7]
      : hours.length === 7 ? [0, 1, 2, 3, 5, 6] : [0, 1, 2, 3, 4, 5])
    : [0, 1, Math.floor(hours.length / 2), hours.length - 2, hours.length - 1];
  const slot = index < 6 ? index : index < 12 ? index - 6 : index - 12;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
    local.getUTCDate() - day, hours[picks[slot]] + 7));
}

export async function runDeckDrip({ db: database, step, orgId, clientId, eventId, startTime,
  bookingUid = null, sendPush = sendDeckPush,
  bookingCurrent = currentDeckBooking,
  enabled = process.env.BS_DECK_LESSONS_ENABLED !== "false" }) {
  if (!enabled) return { sent: [], skipped: "deck_lessons_disabled" };
  if (!startTime) return { sent: [], skipped: "no_start_time" };
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return { sent: [], skipped: "bad_start_time" };
  const sent = [];
  for (let i = 0; i < DECK_SLOTS.length; i++) {
    const at = deckTime(startTime, i);
    if (!at || at.getTime() - Date.now() < HOUR) continue;
    // The appointment-hour slots are moved within the Arizona daytime window,
    // leaving at least an hour around each transactional reminder.
    if ([48, 24, 2].some((lead) =>
      Math.abs(at.getTime() - (startMs - lead * HOUR)) < HOUR)) continue;
    await step.sleepUntil(`wait-deck-${i}`, at);
    const held = await step.run(`check-deck-held-${i}`, () => callHappened(database, clientId));
    if (held || Date.now() >= startMs) return { sent, stoppedBecause: held ? "call_held" : "call_started" };
    const lane = await step.run(`check-deck-lane-${i}`, () => currentDeckLane(database, clientId));
    if (!lane) continue;
    const slot = DECK_SLOTS[i];
    const slug = slot[lane === "qualified" ? "funding" : "blueprint"];
    if (!slug) continue;
    const result = await step.run(`send-deck-${i}`, async () => {
      if (!await bookingCurrent(database, { orgId, clientId, bookingUid, startTime })) {
        return { sent: false, reason: "booking_changed" };
      }
      if (slot.channel === "push") {
        const pushed = await sendPush(database, { orgId, clientId, eventId, slug,
          bookingUid, startTime });
        if (pushed.sent) return { ...pushed, channel: "push" };
        if (!["push_not_enabled", "no_device_delivered", "daily_push_cap"].includes(pushed.reason)) {
          return { ...pushed, channel: "push" };
        }
      }
      const channel = slot.channel === "push" ? "email" : slot.channel;
      return { ...await sendTemplated(database, {
        orgId, clientId, channel,
        templateKey: channel === "sms" ? "SMS-BS-DECK" : "EMAIL-BS-DECK-LESSON",
        eventId: `bs-deck:${clientId}:${slug}`,
        context: { deck_title: DECK_TITLES[slug], deck_intro: DECK_INTROS[slug],
          deck_url: `https://fundhub.ai/slideshows/${slug}.html` }
      }), channel };
    });
    if (["booking_changed", "no_future_booking", "opted_out", "outbound_paused", "dry_run"].includes(result.reason)) {
      return { sent, stoppedBecause: result.reason };
    }
    sent.push({ slot: i, slug, ...result });
  }
  return { sent };
}

function waitMs(after) {
  if (!after) return 0;
  return Number(String(after).replace(/h$/, "")) * HOUR;
}

function firstPrecallAt(startTime) {
  if (startTime == null || startTime === "") return null;
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return null;
  return startMs - PRECALL_LEAD_MS;
}

export const DAYS = ["D1", "D2", "D3"];

// The kickoff column. In practice the docs only carry copy for D1-E1 — the
// enrollment touch — but D2-E1 and D3-E1 are real cells of the grid and are
// addressed like any other; they are simply two of the seven that are empty today.
export const KICKOFF_SLOT = "E1";

// Wait between the kickoff and the first recheck + morning send. Puts D1's morning
// touch on the morning after enrollment for a same-day booking.
export const KICKOFF_WAIT = "12h";

// The six slot columns. `after` is the wait BEFORE that cell, measured from the
// previous cell in the sequence. 12+1+3+3+4+1 = 24h, so each day row starts exactly
// one day after the last and the E6→E1 gap is the overnight roll. D1 is the one
// exception: its E1 fires immediately on enrollment and its E2 is preceded by
// KICKOFF_WAIT rather than the 1h intra-day step.
export const SLOT_COLUMNS = [
  { slot: "E1", name: "kickoff", after: "12h" },
  { slot: "E2", name: "morning", after: "1h" },
  { slot: "E3", name: "midday", after: "3h" },
  { slot: "E4", name: "afternoon", after: "3h" },
  { slot: "E5", name: "evening", after: "4h" },
  { slot: "E6", name: "spare", after: "1h" }
];

// The four named daily sends — the "four sends per day" the source describes.
export const DAILY_SLOTS = ["E2", "E3", "E4", "E5"];

export const SLOTS = SLOT_COLUMNS.map((s) => s.slot);

/**
 * Every cell of the 3x6 grid, in send order, each with the wait that precedes it.
 *
 * `gate` marks the cells whose wake re-tests call-held: everything except the
 * kickoff itself, which fires on enrollment before any gate exists.
 */
export function gridCells(prefix) {
  const cells = [];
  for (const day of DAYS) {
    for (const s of SLOT_COLUMNS) {
      let after = s.after;
      // D1 is anchored to enrollment: E1 fires at once, E2 waits out KICKOFF_WAIT.
      if (day === "D1" && s.slot === "E1") after = null;
      else if (day === "D1" && s.slot === "E2") after = KICKOFF_WAIT;

      cells.push({
        day, slot: s.slot, name: s.name, after,
        gate: !(day === "D1" && s.slot === "E1"),
        keyPrefix: `${prefix}-${day}-${s.slot}`
      });
    }
  }
  return cells;
}

/**
 * Resolve a grid cell to the exact template_key the docs seeded for it.
 *
 * Matched on `{prefix}-{day}-{slot}-%` because the trailing name word is the docs'
 * own and is not derivable from the grid position. Returns null when the cell has
 * no copy — the expected state for 7 of the 18 cells, reported and never filled in.
 */
export async function resolveCellKey(db, orgId, keyPrefix) {
  const r = await db.query(
    `SELECT template_key FROM message_templates
      WHERE org_id = $1 AND template_key LIKE $2 AND compliance_passed = true
      ORDER BY template_key LIMIT 1`,
    [orgId, `${keyPrefix}-%`]
  );
  return r.rows[0]?.template_key || null;
}

async function runDrip({ db, step, orgId, clientId, eventId, prefix, startTime }) {
  const sent = [];
  const gaps = [];
  const skipped = [];

  // Owner 2026-08-23: first precall touch is 48h before the appointment, not
  // at book. Later cells keep their grid gaps from that first fire. A cell
  // whose fire time is already past (call sooner than its lead) is skipped —
  // never sent immediately.
  const firstAt = firstPrecallAt(startTime);
  if (firstAt == null) {
    return { sent, gaps, skipped: [{ reason: startTime ? "bad_start_time" : "no_start_time" }], stoppedAt: null, stoppedBecause: null };
  }

  let offsetMs = 0;
  for (const cell of gridCells(prefix)) {
    if (cell.after) offsetMs += waitMs(cell.after);
    const fireAt = firstAt + offsetMs;
    if (Date.now() >= fireAt) {
      skipped.push({ day: cell.day, slot: cell.slot, name: cell.name, reason: "already_past" });
      continue;
    }

    await step.sleepUntil(`wait-${cell.day}-${cell.slot}`, new Date(fireAt));

    if (cell.gate) {
      const held = await step.run(`recheck-${cell.day}-${cell.slot}`, () => callHappened(db, clientId));
      if (held) return { sent, gaps, skipped, stoppedAt: `${cell.day}-${cell.slot}`, stoppedBecause: "call_held" };
    }

    const key = await step.run(`resolve-${cell.day}-${cell.slot}`, () => resolveCellKey(db, orgId, cell.keyPrefix));
    if (!key) {
      gaps.push({ day: cell.day, slot: cell.slot, name: cell.name, keyPrefix: cell.keyPrefix });
      continue;
    }

    const res = await step.run(`send-${cell.day}-${cell.slot}`, () =>
      sendTemplated(db, { orgId, clientId, channel: "email", templateKey: key, eventId: `${eventId}:${cell.day}:${cell.slot}` }));
    sent.push({ day: cell.day, slot: cell.slot, templateKey: key, ...res });
    await step.run(`stamp-last-sent-${cell.day}-${cell.slot}`, () =>
      mergeCustomFields(db, clientId, { bs_email_last_sent_ts: new Date().toISOString() }));
  }

  return { sent, gaps, skipped, stoppedAt: null, stoppedBecause: null };
}

/**
 * Pre-call SMS touches for every booked contact. Independent of funding/repair
 * email path. Stops when the call is held (same gate as the email drip).
 */
async function runSmsDrip({ db, step, orgId, clientId, eventId, startTime }) {
  const sent = [];

  // Owner 2026-08-23: SMS-BS01-02-PRECALL sits 48h before the call, before
  // S-04B's 24h reminder. If the call is sooner than 48h, skip — do not send now.
  const fireAt = firstPrecallAt(startTime);
  if (fireAt == null) {
    return { sent, stoppedAt: null, stoppedBecause: null, skippedDayOf: startTime ? "owned_by_s04b" : "no_start_time", skippedPrecall: startTime ? "bad_start_time" : "no_start_time" };
  }
  if (Date.now() >= fireAt) {
    return { sent, stoppedAt: null, stoppedBecause: null, skippedDayOf: "owned_by_s04b", skippedPrecall: "already_past" };
  }

  await step.sleepUntil("wait-sms-precall", new Date(fireAt));
  const heldPrecall = await step.run("recheck-sms-precall", () => callHappened(db, clientId));
  if (heldPrecall) {
    return { sent, stoppedAt: "sms-precall", stoppedBecause: "call_held", skippedDayOf: null, skippedPrecall: null };
  }

  const precall = await step.run("send-sms-precall", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_BS01_PRECALL,
      eventId: `${eventId}:sms:precall`
    }));
  sent.push({ templateKey: SMS_BS01_PRECALL, ...precall });
  if (precall.sent) {
    await step.run("stamp-sms-precall", () =>
      mergeCustomFields(db, clientId, { bs_sms_last_sent_ts: new Date().toISOString() }));
  }

  // Owner decision 2026-08-22 (confirmed against the 2026-08-20 live template
  // dump): the T-2h day-of text is S-04B's alone (SMS-S04-03-REMIND-2H,
  // s-04b-booking-reminders.mjs). Both workflows target the identical
  // sleepUntil(startTime - 2h) moment, so every booking with a start time was
  // getting two near-identical "your call is coming up" texts back to back.
  // BS-01 now stops after the +24h precall touch. SMS_BS01_DAYOF stays exported
  // and the template stays seeded; nothing sends it.
  return { sent, stoppedAt: null, stoppedBecause: null, skippedDayOf: "owned_by_s04b", skippedPrecall: null };
}

export async function handle({ event, db, step,
  lessonsEnabled = process.env.BS_DECK_LESSONS_ENABLED !== "false",
  bookingCurrent = currentDeckBooking, sendPush = sendDeckPush }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-precall", () => addTags(db, clientId, ["bs:precall"]));
  await step.run("set-precall-start", () => mergeCustomFields(db, clientId, { bs_precall_start_ts: new Date().toISOString() }));

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));

  // SMS for every booking. Start before (or beside) the email drip so the
  // email kickoff is not delayed by SMS sleeps.
  const startTime = event.payload?.startTime || event.payload?.start_time || null;
  const smsPromise = runSmsDrip({
    db, step, orgId, clientId, eventId,
    startTime
  });
  const deckTemplate = await step.run("deck-template-ready", () => deckContentReady(db, orgId));
  const decksPromise = deckTemplate && lessonsEnabled
    ? runDeckDrip({ db, step, orgId, clientId, eventId, startTime,
      bookingUid: event.payload?.bookingUid || event.payload?.booking_uid || null,
      bookingCurrent, sendPush, enabled: true })
    : Promise.resolve({ sent: [], skipped: deckTemplate ? "deck_lessons_disabled" : "deck_template_pending" });

  let prefix;
  let drip;
  if (isFundingPath(outcomeTier)) { prefix = FUNDING_PREFIX; drip = "funding"; }
  else if (isRepairOnlyPath(outcomeTier)) { prefix = REPAIR_PREFIX; drip = "repair"; }
  else {
    const [sms, decks] = await Promise.all([smsPromise, decksPromise]);
    return { done: true, drip: "none", reason: `no_matching_path:${outcomeTier}`, sms, decks };
  }

  if (!deckTemplate || !lessonsEnabled) {
    // Existing organizations without the new lesson template retain their
    // historical flow until the seed is applied; the legacy copy gate still
    // refuses the filler cells.
    const [sms, decks, legacy] = await Promise.all([
      smsPromise, decksPromise,
      runDrip({ db, step, orgId, clientId, eventId, prefix, startTime })
    ]);
    if (!legacy.stoppedAt) await step.run("tag-call-booked", () => addTags(db, clientId, ["call:booked"]));
    return { done: true, drip, ...legacy, sms, decks };
  }
  const [sms, decks] = await Promise.all([smsPromise, decksPromise]);
  if (!decks.stoppedBecause) await step.run("tag-call-booked", () => addTags(db, clientId, ["call:booked"]));
  return { done: true, drip, sent: decks.sent, gaps: [], skipped: [],
    stoppedAt: decks.stoppedBecause ? "deck" : null,
    stoppedBecause: decks.stoppedBecause || null, sms, decks };
}

export const bs01PrecallLauncher = inngest.createFunction(
  {
    id: "bs-01-precall-launcher",
    name: "BS-01 — Pre-Call Backend Launcher",
    cancelOn: [
      {
        event: "booking.rescheduled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      },
      {
        event: "booking.rescheduled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  [{ event: "booking.created" }, { event: "booking.rescheduled" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
