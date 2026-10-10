// Closer and setter calendar ask. The one writer for the lane
// src/pulse/coverage/gap-closer-setup.mjs, which only reads.
//
//   node --env-file=.env scripts/closer-setup-ask.mjs open   --staff <staff id> --asked-at <ISO time> [--grace-days 3] [--dry-run]
//   node --env-file=.env scripts/closer-setup-ask.mjs snooze --staff <staff id> (--days <n> | --until <ISO time>) [--dry-run]
//   node --env-file=.env scripts/closer-setup-ask.mjs close  --staff <staff id> [--task <ask id>] [--dry-run]
//
// Times are written as a full ISO time with a zone, like 2026-10-07T17:41:33Z.
// Anything looser (a bare number, a date with no time, a time with no zone) is
// refused, so a typo cannot save a wrong ask.
//
// WHY. An ask sent from Gmail leaves no trace in our system, so the pulse had
// nothing to watch. This writes one task per person that says who was asked, when,
// and the day it turns red. ClickFunnels has no API call to invite a team member,
// connect a calendar or add a host, so a person clicks those steps there and the
// pulse only watches that they happened.
//
// open    One owner task per person, source "closer-calendar-ask". The body is
//         "closer-calendar:<staff id>:<asked ISO time>". The red-after time is the
//         ask time plus 3 days. created_at is left to the database.
//         Refuses an unknown or not-active staff id, and a second open ask for
//         the same person.
// snooze  Moves due_at on the one open ask for that person.
//         --days n  = n days after the later of the current due time and now.
//         --until   = that exact time (must be in the future).
// close   Marks the one open ask done (the person joined, or the ask is dropped).
//         snooze and close do not need the person to be active, so the ask for
//         someone who left can still be dropped.
//         With two open asks for one person (a race, or a hand insert), snooze
//         and close refuse and list their ids. Then close --task <ask id> closes
//         the one named, and the one left can be snoozed or closed on its own.
//
// --dry-run reads, prints what it would do, and writes nothing.

import { pathToFileURL } from "node:url";

import { createTask as defaultCreateTask } from "../src/lib/create-task.mjs";
import {
  ASK_BODY_PREFIX,
  ASK_SOURCE,
  GRACE_DAYS,
  parseIsoTime
} from "../src/pulse/coverage/gap-closer-setup.mjs";

export const COMMANDS = Object.freeze(["open", "snooze", "close"]);
export const EVENT_NAME = "Funding Strategy Meeting";
export const MAX_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = "America/Phoenix";
const SKEW_MS = 60 * 1000;

const STAFF_SQL = `SELECT id::text AS id, name, role, status, active
  FROM staff
 WHERE id = $1::uuid AND org_id = $2::uuid
 LIMIT 1`;

/* Every ask row for one person, open or done. The lane reads open ones the same way. */
const ASKS_FOR_STAFF_SQL = `SELECT id::text AS id, body, due_at, done
  FROM tasks
 WHERE org_id = $1::uuid
   AND source_workflow = $2::text
   AND is_demo = false
   AND left(body, char_length($3::text)) = $3::text
 ORDER BY created_at`;

/* Same pre-check shape as src/ops/csuite-tasks.mjs: createTask looks up with
   client_id = $1, which misses a NULL client, so this looks up first. */
const SAME_BODY_SQL = `SELECT id::text AS id, done
  FROM tasks
 WHERE client_id IS NOT DISTINCT FROM $1
   AND source_workflow = $2
   AND body = $3
 LIMIT 1`;

const SNOOZE_SQL = `UPDATE tasks SET due_at = $1::timestamptz
 WHERE id = $2::uuid AND org_id = $3::uuid AND source_workflow = $4::text AND done = false
 RETURNING id::text AS id, due_at`;

const CLOSE_SQL = `UPDATE tasks SET done = true
 WHERE id = $1::uuid AND org_id = $2::uuid AND source_workflow = $3::text AND done = false
 RETURNING id::text AS id`;

function refuse(reason, extra = {}) {
  return { ok: false, refused: true, reason, ...extra };
}

function validDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayLabel(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.month} ${p.day}, ${p.year}`;
}

/** argv (without node and the script) -> { command, staff, askedAt, graceDays, days, until, task, dryRun, help, errors }. */
export function parseArgs(argv = []) {
  const out = {
    command: null, staff: null, askedAt: null, graceDays: null, days: null, until: null, task: null,
    dryRun: false, help: false, errors: []
  };
  const list = [...argv];
  const takes = new Map([
    ["--staff", "staff"], ["--asked-at", "askedAt"], ["--grace-days", "graceDays"],
    ["--days", "days"], ["--until", "until"], ["--task", "task"]
  ]);
  while (list.length) {
    const a = list.shift();
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (takes.has(a)) {
      const v = list.shift();
      if (v == null || v.startsWith("--")) out.errors.push(`${a} needs a value.`);
      else out[takes.get(a)] = v;
    } else if (a.startsWith("--")) out.errors.push(`Unknown flag ${a}.`);
    else if (!out.command) out.command = a;
    else out.errors.push(`Unexpected word "${a}".`);
  }
  if (!out.help && !COMMANDS.includes(out.command)) {
    out.errors.push(`The first word must be one of: ${COMMANDS.join(", ")}.`);
  }
  return out;
}

async function loadStaff(db, orgId, staffId) {
  const res = await db.query(STAFF_SQL, [staffId, orgId]);
  return (res.rows && res.rows[0]) || null;
}

function isActive(staff) {
  return Boolean(staff) && String(staff.status || "").toLowerCase() === "active" && staff.active !== false;
}

async function openAsks(db, orgId, staffId) {
  const prefix = `${ASK_BODY_PREFIX}${staffId}:`;
  const res = await db.query(ASKS_FOR_STAFF_SQL, [orgId, ASK_SOURCE, prefix]);
  return (res.rows || []).filter((r) => r.done !== true);
}

/**
 * run(args, ctx) -> { ok, action, ... } or { ok: false, refused: true, reason }.
 * args is the output of parseArgs. ctx: { db, orgId, now, createTask, log }.
 * Reads always; writes only when dryRun is false.
 */
export async function run(args, { db, orgId, now = new Date(), createTask = defaultCreateTask, log = () => {} } = {}) {
  if (!db || typeof db.query !== "function") return refuse("No database was given.");
  if (!orgId) return refuse("No company was given.");
  if (!COMMANDS.includes(args.command)) return refuse(`The first word must be one of: ${COMMANDS.join(", ")}.`);
  if (!args.staff || !UUID_RE.test(String(args.staff))) {
    return refuse("--staff must be a staff id (a uuid).");
  }
  const staffId = String(args.staff).toLowerCase();
  const dry = args.dryRun === true;
  if (args.task != null) {
    if (args.command !== "close") return refuse("--task only goes with close.");
    if (!UUID_RE.test(String(args.task))) return refuse("--task must be an ask id (a uuid).");
  }

  if (args.command === "open") return openAsk({ args, db, orgId, now, createTask, log, staffId, dry });
  if (args.command === "snooze") return snoozeAsk({ args, db, orgId, now, log, staffId, dry });
  return closeAsk({ args, db, orgId, log, staffId, dry });
}

async function openAsk({ args, db, orgId, now, createTask, log, staffId, dry }) {
  if (!args.askedAt) return refuse("--asked-at is required: the time the email went out, as an ISO time.");
  const askedAt = parseIsoTime(args.askedAt);
  if (!askedAt) {
    return refuse(
      `--asked-at "${args.askedAt}" is not a time. Write the full time with a zone, like 2026-10-07T17:41:33Z.`
    );
  }
  if (askedAt.getTime() > now.getTime() + SKEW_MS) return refuse("--asked-at is in the future.");
  if (askedAt.getTime() < now.getTime() - MAX_DAYS * DAY_MS) {
    return refuse(`--asked-at is more than ${MAX_DAYS} days ago. Check the date.`);
  }

  let graceDays = GRACE_DAYS;
  if (args.graceDays != null) {
    graceDays = Number(args.graceDays);
    if (!Number.isFinite(graceDays) || graceDays <= 0 || graceDays > MAX_DAYS) {
      return refuse(`--grace-days must be a number from 1 to ${MAX_DAYS}.`);
    }
  }

  const staff = await loadStaff(db, orgId, staffId);
  if (!staff) return refuse(`No staff row has the id ${staffId} in this company.`);
  if (!isActive(staff)) {
    return refuse(`${staff.name} is not an active staff member (status ${staff.status || "unknown"}). Nothing was written.`);
  }

  const askedIso = askedAt.toISOString();
  const body = `${ASK_BODY_PREFIX}${staffId}:${askedIso}`;
  const dueAt = new Date(askedAt.getTime() + graceDays * DAY_MS);
  const title = `Waiting: ${staff.name} calendar on the booking page`;
  const detail =
    `Asked by email on ${dayLabel(askedAt)}. ` +
    `Needs: ClickFunnels invite, calendar connected, added as host on ${EVENT_NAME}.`;

  const same = await db.query(SAME_BODY_SQL, [null, ASK_SOURCE, body]);
  if (same.rows && same.rows[0]) {
    return refuse(`This ask is already on file (${same.rows[0].done ? "closed" : "open"}). Nothing was written.`, {
      id: same.rows[0].id
    });
  }
  const already = await openAsks(db, orgId, staffId);
  if (already.length > 0) {
    return refuse(
      `An open ask already exists for ${staff.name}. Use snooze to give more days or close to drop it. Nothing was written.`,
      { id: already[0].id }
    );
  }

  const plan = { title, body, dueAt: dueAt.toISOString(), detail, staffId, name: staff.name };
  if (dry) {
    log(`DRY RUN. Nothing was written. Would open this ask:`);
    log(`  who      : ${staff.name} (${staff.role || "no role"})`);
    log(`  title    : ${title}`);
    log(`  body     : ${body}`);
    log(`  red after: ${dueAt.toISOString()} (${graceDays} days after the ask)`);
    log(`  detail   : ${detail}`);
    return { ok: true, action: "open", dryRun: true, ...plan };
  }

  const made = await createTask(db, {
    orgId,
    clientId: null,
    title,
    sourceWorkflow: ASK_SOURCE,
    assigneeRole: "owner",
    body,
    eventId: body,
    dueAt,
    detail
  });
  if (!made.created) {
    return refuse(`The ask was not created (${made.reason || "already there"}).`, { id: made.id || null });
  }
  log(`Opened the ask for ${staff.name}. Red after ${dueAt.toISOString()}.`);
  return { ok: true, action: "open", dryRun: false, id: made.id, ...plan };
}

async function theOneOpenAsk(db, orgId, staffId) {
  const open = await openAsks(db, orgId, staffId);
  if (open.length === 0) return { error: "There is no open ask for that staff id." };
  if (open.length > 1) {
    const ids = open.map((r) => r.id).join(", ");
    return {
      error:
        `There are ${open.length} open asks for that staff id (ask ids: ${ids}). ` +
        "To close one, run: close --staff <staff id> --task <ask id>. " +
        "Snooze and close work on their own once one ask is left."
    };
  }
  return { row: open[0] };
}

async function snoozeAsk({ args, db, orgId, now, log, staffId, dry }) {
  const hasDays = args.days != null;
  const hasUntil = args.until != null;
  if (hasDays === hasUntil) return refuse("Give exactly one of --days or --until.");

  const found = await theOneOpenAsk(db, orgId, staffId);
  if (found.error) return refuse(found.error);
  const row = found.row;
  const current = validDate(row.due_at);

  let next;
  if (hasDays) {
    const days = Number(args.days);
    if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) {
      return refuse(`--days must be a number from 1 to ${MAX_DAYS}.`);
    }
    const base = current && current.getTime() > now.getTime() ? current : now;
    next = new Date(base.getTime() + days * DAY_MS);
  } else {
    next = parseIsoTime(args.until);
    if (!next) {
      return refuse(
        `--until "${args.until}" is not a time. Write the full time with a zone, like 2026-10-20T16:00:00Z.`
      );
    }
    if (next.getTime() <= now.getTime()) return refuse("--until must be in the future.");
  }

  const plan = { id: row.id, from: current ? current.toISOString() : null, to: next.toISOString() };
  if (dry) {
    log(`DRY RUN. Nothing was written. Would move the red-after time from ${plan.from || "none"} to ${plan.to}.`);
    return { ok: true, action: "snooze", dryRun: true, ...plan };
  }
  const res = await db.query(SNOOZE_SQL, [next.toISOString(), row.id, orgId, ASK_SOURCE]);
  if (!res.rows || !res.rows[0]) return refuse("The ask was closed while this ran. Nothing was changed.");
  log(`Moved the red-after time to ${plan.to}.`);
  return { ok: true, action: "snooze", dryRun: false, ...plan };
}

async function closeAsk({ args, db, orgId, log, staffId, dry }) {
  let row;
  if (args.task != null) {
    const want = String(args.task).toLowerCase();
    const open = await openAsks(db, orgId, staffId);
    row = open.find((r) => String(r.id).toLowerCase() === want);
    if (!row) return refuse("That ask id is not an open ask for that staff id. Nothing was changed.");
  } else {
    const found = await theOneOpenAsk(db, orgId, staffId);
    if (found.error) return refuse(found.error);
    row = found.row;
  }
  if (dry) {
    log(`DRY RUN. Nothing was written. Would mark the ask ${row.id} done.`);
    return { ok: true, action: "close", dryRun: true, id: row.id };
  }
  const res = await db.query(CLOSE_SQL, [row.id, orgId, ASK_SOURCE]);
  if (!res.rows || !res.rows[0]) return refuse("The ask was closed while this ran. Nothing was changed.");
  log(`Closed the ask ${row.id}.`);
  return { ok: true, action: "close", dryRun: false, id: row.id };
}

const USAGE = `Usage:
  node --env-file=.env scripts/closer-setup-ask.mjs open   --staff <staff id> --asked-at <ISO time> [--grace-days 3] [--dry-run]
  node --env-file=.env scripts/closer-setup-ask.mjs snooze --staff <staff id> (--days <n> | --until <ISO time>) [--dry-run]
  node --env-file=.env scripts/closer-setup-ask.mjs close  --staff <staff id> [--task <ask id>] [--dry-run]
Times are a full ISO time with a zone, like 2026-10-07T17:41:33Z.`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(e);
    console.error(USAGE);
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with: node --env-file=.env scripts/closer-setup-ask.mjs ...");
    return 1;
  }
  const { db, close, dbTarget } = await import("../src/db.mjs");
  const { resolveDefaultOrg } = await import("../src/auth/org.mjs");
  try {
    console.log(`database : ${dbTarget()}`);
    const orgId = await resolveDefaultOrg(db);
    const result = await run(args, { db, orgId, now: new Date(), log: (line) => console.log(line) });
    if (!result.ok) {
      console.error(result.reason);
      return 1;
    }
    return 0;
  } finally {
    await close();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then((code) => process.exit(code), (err) => {
    console.error(String((err && err.message) || err));
    process.exit(1);
  });
}
