// Slice 02 — the 6:00 a.m. Arizona daily pulse itself.
//
// Files this slice watches:
//   src/pulse/daily-pulse.mjs
//   src/pulse/registry.mjs
//   src/pulse/machine.mjs
//   src/pulse/notify.mjs
//   scripts/daily-pulse.mjs
//
// The pulse audits. It never fixes. This file does not send a text.
// The only database read is one SELECT inside BEGIN READ ONLY, then ROLLBACK.
// Do not print secrets. Do not read DATABASE_URL here.

export const SLICE_ID = "02-daily-pulse";

/** Inngest cron. Arizona's own clock, all year. */
export const CRON = "TZ=America/Phoenix 0 6 * * *";

export const AGENT_CODE = "AG-07";
export const TRIGGER_EVENT = "cron.daily-pulse";

/** Red when this many Arizona mornings have no AG-07 cron.daily-pulse row. */
export const RED_AFTER_MORNINGS = 3;

/** 6:00 a.m. Arizona. A morning counts once the clock reaches this minute. */
const DUE_MINUTE = 6 * 60;

export const LATEST_RUN_SQL = `
SELECT created_at, outcome, mode, trigger_event
  FROM agent_runs
 WHERE agent_code = $1
   AND trigger_event = $2
 ORDER BY created_at DESC
 LIMIT 1`.trim();

export const CHECKS = [
  {
    id: "ag-07-cron-daily-pulse",
    schedule: CRON,
    redAfter: "3 mornings",
    alreadyInRegistry: false,
    proof:
      "AG-07 row with trigger_event cron.daily-pulse. " +
      "Read the latest row only inside BEGIN READ ONLY, then ROLLBACK. " +
      "Select created_at, outcome, mode, and trigger_event. Do not select detail. " +
      "Red when that run is missing for 3 Arizona mornings. " +
      "Today counts once the Arizona clock is 6:00 or later. " +
      "Not a GET ping. The inngest route stays unmonitored because liveness is this cron."
  },
  {
    id: "script-dry-run-default",
    schedule: "manual — node scripts/daily-pulse.mjs",
    redAfter: "immediate if the default is not a dry run",
    alreadyInRegistry: false,
    proof:
      "scripts/daily-pulse.mjs defaults to dry-run. " +
      "dryRun is on unless --live is passed. " +
      "--db is one BEGIN READ ONLY transaction, then ROLLBACK, and it refuses --live. " +
      "Do not pass --live to prove this slice."
  },
  {
    id: "pulse-never-fixes",
    schedule: CRON,
    redAfter: "immediate if a run changes product code",
    alreadyInRegistry: false,
    proof:
      "runDailyPulse returns autoFix false. " +
      "The scorecard says the run does not auto-fix. " +
      "Suggested fixes stay words on the board."
  },
  {
    id: "proof-does-not-text",
    schedule: "proof only",
    redAfter: "immediate if a text is sent",
    alreadyInRegistry: false,
    proof:
      "This slice does not call textChris, ticketDarwin, or Twilio. " +
      "A dry-run pulse leaves the text unsent (sms reason dry_run). " +
      "Do not send a text. Do not print secrets."
  }
];

function denverParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const dayIndex = Math.floor(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))) / 86400000);
  return { dayIndex, minutes: hour * 60 + Number(get("minute")) };
}

/**
 * How many 6:00 a.m. Arizona mornings have passed since the latest run.
 * Null when there is no row. Today counts only at 6:00 or later.
 */
export function missedMornings(latestCreatedAt, now = new Date()) {
  if (latestCreatedAt == null || latestCreatedAt === "") return null;
  const latest = latestCreatedAt instanceof Date ? latestCreatedAt : new Date(latestCreatedAt);
  if (!Number.isFinite(latest.getTime())) return null;
  const due = denverParts(now);
  let missed = due.dayIndex - denverParts(latest).dayIndex;
  if (due.minutes < DUE_MINUTE) missed -= 1;
  return Math.max(0, missed);
}

/** True when the AG-07 cron.daily-pulse run has been missing for 3 mornings. */
export function runIsRed(latestCreatedAt, now = new Date(), limit = RED_AFTER_MORNINGS) {
  const missed = missedMornings(latestCreatedAt, now);
  if (missed == null) return true;
  return missed >= limit;
}

/**
 * Latest AG-07 cron.daily-pulse row.
 * One SELECT inside BEGIN READ ONLY, then ROLLBACK. Nothing is printed.
 */
export async function readLatestAgentRun(client, {
  agentCode = AGENT_CODE,
  triggerEvent = TRIGGER_EVENT
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new Error("readLatestAgentRun needs a query client");
  }
  await client.query("BEGIN READ ONLY");
  try {
    const { rows } = await client.query(LATEST_RUN_SQL, [agentCode, triggerEvent]);
    return rows[0] || null;
  } finally {
    await client.query("ROLLBACK");
  }
}
