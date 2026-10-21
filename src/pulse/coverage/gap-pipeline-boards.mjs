// The shape of every board: does it paint every card, is anything sitting too long, is anything
// landing where nobody is watching, did anybody get lost. Report only. Read only.
// Never moves a card. Never texts. Never charges. Never pulls credit.
//
// Built for the 2026-10-10 coverage batch, workflow W3 "Pipelines truth".
// Board: ops/workflows/coverage-every-surface-2026-10-10.md, section 3 (P1, P3, P5, P6).
// The other half (is each card in the stage the facts say, did each move fire its event, do two
// records agree) is gap-pipeline-facts.mjs. The two lanes are split so each stays under 20 seconds.
//
//   pipeline:count-true      P1  every column paints as many cards as the database holds
//   pipeline:age             P3  no card sits past a stage time limit the repo already wrote
//   pipeline:age-no-limit    P3  boards with no written limit: a named setting, off, said out loud
//   pipeline:dead-stage      P5  stages no code moves a card to: green until a card lands there
//   pipeline:nobody-lost     P6  paying clients with no card, archived clients who paid, cards off the board
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). count-true, dead-stage and nobody-lost (their SQL, verdicts
// and the board lists) moved to src/pulse/beats/lib/pipeline-boards-truth.mjs, unchanged except for the
// read path, so this lane and the hourly beat pipeline-boards run the same code. The lane imports them
// back and still runs all five rows every morning. The age rows stay here (Repair clocks, owner hold).
//
// What this file reuses and does not copy:
//   gap-crm-links.mjs   BOARD_STAGES_SQL and BOARD_CARDS_SQL. They are the route's own reads
//                       (api/dashboard/pipeline.mjs); a test there fails the day they drift. The
//                       count check reads them from the truth file's held copy, and
//                       beat-pipeline-boards.test.mjs fails the day that copy drifts.
//   gap-consent.mjs     TEST_CLIENT_EMAIL_RE, the one test-client address pattern.
//   src/repair/sla.mjs  STAGE_SLA and isBreached, the Repair stage clocks.
//
// What is NOT invented: a board with no written stage clock gets no clock. Its limit is one named
// setting (AGE_LIMIT_HOURS), off, and the row says so in a way the audit checks again.

import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";
import {
  BOARDS, DEAD_APPLICATIONS_SQL, DEAD_CARDS_SQL, DEAD_STAGE_KEYS, HOUR_MS, NAME_AT_MOST, NO_AUTOFIX, UUID_RE,
  all, boardName, checkCountTrue, checkDeadStage, checkNobodyLost, errText, plural, read, row
} from "../beats/lib/pipeline-boards-truth.mjs";
import { OWNER_HOLD_CODE, heldCodesOf, ownerHoldRow, splitHeld, stillOwnerHold } from "../owner-hold.mjs";

export {
  ARCHIVED_THEN_PAID_SQL, BOARDS, BOARD_READ_LIMIT, DEAD_APPLICATIONS_SQL, DEAD_CARDS_SQL, DEAD_STAGES, DEAD_STAGE_KEYS,
  HIRING_PAINTED_SQL, HIRING_READ_LIMIT, HIRING_TRUTH_SQL, OFF_BOARD_SQL, PAID_GRACE_MS, PAID_NO_CARD_SQL, TRUTH_SQL,
  judgeCounts
} from "../beats/lib/pipeline-boards-truth.mjs";

export const CHECK_IDS = Object.freeze([
  "pipeline:count-true",
  "pipeline:age",
  "pipeline:age-no-limit",
  "pipeline:dead-stage",
  "pipeline:nobody-lost"
]);

/** The most cards read for the age check in one run. */
export const MAX_AGE_ROWS = 2000;

/* ───────────── the stage time limits ─────────────
   Written already, so imported and not copied:
     optimization   src/repair/sla.mjs STAGE_SLA (intake 3 business days ... response_received 24 hours)
   Nothing else has a clock per stage anywhere in the repo.
     Sales      DPC-05 is 72 hours of no progress for one client (pipeline:clients), not a limit per stage.
     Funding    the 72 hour line in gap-funding.mjs is the same no-progress line, and it only reddens when
                the screen shows no next step (funding:advisor-queue). A card may legitimately wait longer.
     Inquiry    72 hours per case (inquiry:case-stuck), not per card.
   Each of those is judged by its own check. None is a stage clock, so none is copied here as one.

   AGE_LIMIT_HOURS is the one named setting per board that has no written clock. null is off. A number
   turns the check on for every stage that board does not count as finished (BOARDS[].done).
   Chris decides the numbers. They are listed on the board under "Chris decides". */
export const AGE_LIMIT_HOURS = Object.freeze({
  sales: null,
  funding_card_stacking: null,
  funding_altfin: null,
  inquiry_removal: null,
  ar_collections: null,
  affiliates_white_label: null,
  hiring: null
});

/** Boards that run on a written clock. The age check reads these; every other board is judged by AGE_LIMIT_HOURS. */
export const WRITTEN_CLOCK_BOARDS = Object.freeze(["optimization"]);

/* ───────────── SQL ─────────────
   Every statement is one SELECT. No write verb, no transaction control. */

/** P3. $1 org, $2 test-client pattern. Every open card with its stage and, for Repair, the date the bureau answer is due. */
export const AGE_SQL = `
  /* gap:pipeline-age */
  SELECT p.key AS pipeline,
         s.key AS stage,
         s.name AS stage_name,
         cd.id::text AS card_id,
         c.client_code AS client_code,
         cd.entered_at,
         CASE WHEN p.key = 'optimization' THEN (
           SELECT min(dc.response_due_at)
             FROM dispute_cases dc
            WHERE dc.client_id = cd.client_id
              AND dc.org_id = cd.org_id
              AND dc.status NOT IN ('closed', 'cancelled')
              AND dc.response_due_at IS NOT NULL
         ) END AS response_due_at
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
    LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid
     AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
     AND COALESCE(cd.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $2::text
     AND (c.custom_fields->>'crm_archived_at') IS NULL
   ORDER BY cd.entered_at ASC
   LIMIT ${MAX_AGE_ROWS}
`;

/* ───────────── small helpers ───────────── */

/** ctx.db is what the read routes use (the plain role). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

function skipAll(why) {
  return CHECK_IDS.map((id) => row(id, "skip", why));
}

/** A written limit, as the repo says it: hours up to 72, days after. */
function limitText(ms) {
  const h = Math.round(ms / HOUR_MS);
  if (h <= 72) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${Math.round(h / 24)} days`;
}

function hoursText(ms) {
  const h = ms / HOUR_MS;
  if (h < 48) return `${Math.max(1, Math.round(h))} ${Math.round(h) === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/* ───────────── P3 pipeline:age ───────────── */

/**
 * Pure. rows are AGE_SQL rows. Returns the cards past a limit, for the boards that have one.
 * limits is AGE_LIMIT_HOURS. Boards in WRITTEN_CLOCK_BOARDS use the written clocks.
 */
export function judgeAges(rows, now, limits = AGE_LIMIT_HOURS) {
  const over = [];
  let judged = 0;
  const doneOf = new Map(BOARDS.map((b) => [b.key, new Set(b.done)]));
  for (const r of rows || []) {
    const board = String(r.pipeline);
    const stage = String(r.stage);
    const entered = r.entered_at ? new Date(r.entered_at) : null;
    if (!entered || !Number.isFinite(entered.getTime())) continue;
    const age = now.getTime() - entered.getTime();
    if (board === "optimization") {
      if (!STAGE_SLA[stage]) continue;
      judged += 1;
      const out = isBreached({ stageKey: stage, enteredAt: entered, asOf: now, responseDueAt: r.response_due_at });
      if (out.breached) over.push({ board, stage, name: r.stage_name || stage, age, limit: describeSla(STAGE_SLA[stage]) });
    } else {
      const hours = limits[board];
      if (!(Number(hours) > 0)) continue;
      if ((doneOf.get(board) || new Set()).has(stage)) continue;
      judged += 1;
      if (age > Number(hours) * HOUR_MS) over.push({ board, stage, name: r.stage_name || stage, age, limit: limitText(Number(hours) * HOUR_MS) });
    }
  }
  return { over, judged };
}

function describeSla(sla) {
  if (sla.minutes) return `${sla.minutes} minutes`;
  if (sla.hours) return `${sla.hours} ${sla.hours === 1 ? "hour" : "hours"}`;
  if (sla.days) return `${sla.days} ${sla.businessDays ? "business days" : "days"}`;
  if (sla.daysAfterDue != null) return `${sla.daysAfterDue} days after the bureau answer is due`;
  return "its limit";
}

async function checkAge(run, orgId, now) {
  const id = "pipeline:age";
  const fix = `Open Pipeline and read the stage the card sits in. The time limit is written in code; a card past it is not moving. ${NO_AUTOFIX}`;
  const read1 = await read(run, AGE_SQL, [orgId, TEST_CLIENT_EMAIL_RE]);
  if (read1.error) return row(id, "skip", `could not read the cards and their ages: ${read1.error}`);
  // A card for a file the owner put on hold (src/pulse/owner-hold.mjs) is not judged. When the held cards are
  // the only ones past a limit, the row names them instead of red or green.
  const { open, held } = splitHeld(read1.rows, (r) => r.client_code);
  const { over, judged } = judgeAges(open, now);
  if (!over.length && held.length) {
    const late = held.filter((r) => judgeAges([r], now).over.length > 0);
    if (late.length) return ownerHoldRow(id, orgId, heldCodesOf(late, (r) => r.client_code));
  }
  if (over.length) {
    const byGroup = new Map();
    for (const o of over) {
      const key = `${o.board}|${o.stage}|${o.limit}`;
      const g = byGroup.get(key) || { ...o, n: 0, oldest: 0 };
      g.n += 1;
      g.oldest = Math.max(g.oldest, o.age);
      byGroup.set(key, g);
    }
    const lines = [...byGroup.values()]
      .sort((a, b) => b.oldest - a.oldest)
      .slice(0, NAME_AT_MOST)
      .map((g) => `${boardName(g.board)} ${g.name}: ${plural(g.n, "card")} past ${g.limit} (oldest ${hoursText(g.oldest)})`);
    const more = byGroup.size > NAME_AT_MOST ? `, and ${byGroup.size - NAME_AT_MOST} more stages` : "";
    return row(id, "FAIL", `${plural(over.length, "card")} ${over.length === 1 ? "sits" : "sit"} past a stage time limit: ${lines.join("; ")}${more}.`, fix);
  }
  const boards = WRITTEN_CLOCK_BOARDS.map(boardName).join(" and ");
  const set = Object.keys(AGE_LIMIT_HOURS).filter((k) => Number(AGE_LIMIT_HOURS[k]) > 0).map(boardName);
  return row(
    id,
    "PASS",
    `${plural(judged, "card")} judged against a written time limit (${boards}${set.length ? `, and ${set.join(", ")} by its set limit` : ""}). None is past its limit.`
  );
}

/** Boards that have no written clock and no limit set. Pure. */
export function boardsWithNoLimit(limits = AGE_LIMIT_HOURS) {
  return Object.keys(limits).filter((k) => !(Number(limits[k]) > 0)).sort();
}

function ageNoLimitRow() {
  const id = "pipeline:age-no-limit";
  const boards = boardsWithNoLimit();
  if (!boards.length) {
    return row(id, "PASS", "every board has a stage time limit, written or set");
  }
  const names = boards.map(boardName);
  return row(
    id,
    "na",
    `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no stage time limit written. The limit is one named setting per board (AGE_LIMIT_HOURS) and it is off. Chris sets the numbers.`,
    null,
    { na: { code: "no-limit-set", args: { check: id, boards } } }
  );
}

/* ───────────── the lane ───────────── */

/** The audit asks the lane to prove a "nothing to judge" row again. Same SQL, same keys. */
export const naVerify = Object.freeze({
  [OWNER_HOLD_CODE]: async (args, ctx = {}) => {
    if (!args || args.check !== "pipeline:age") return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    if (!orgId || !UUID_RE.test(String(orgId))) return false;
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    return stillOwnerHold(await checkAge(run, String(orgId), now), args);
  },
  "no-card-on-stage": async (args, ctx = {}) => {
    if (!args || args.check !== "pipeline:dead-stage") return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    if (!orgId || !UUID_RE.test(String(orgId))) return false;
    const keys = Array.isArray(args.stages) ? args.stages.filter((k) => typeof k === "string") : [];
    if (!keys.length) return false;
    const [cards, apps] = await Promise.all([
      all(run, DEAD_CARDS_SQL, [orgId, keys, TEST_CLIENT_EMAIL_RE]),
      all(run, DEAD_APPLICATIONS_SQL, [orgId, keys])
    ]);
    return [...cards, ...apps].every((r) => !(Number(r.n) > 0));
  },
  "no-limit-set": async (args) => {
    if (!args || args.check !== "pipeline:age-no-limit") return false;
    const boards = Array.isArray(args.boards) ? args.boards : [];
    if (!boards.length) return false;
    // Still true only while every named board has no limit. Set a number and the claim stops holding.
    return boards.every((b) => Object.hasOwn(AGE_LIMIT_HOURS, b) && !(Number(AGE_LIMIT_HOURS[b]) > 0));
  }
});

/**
 * Morning-pulse rows for the shape of every board.
 * ctx: { db, scope, now, orgId }. SELECT only. No POST. Nothing is sent.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) return skipAll("no database in this run — the boards were not read");
  const orgRaw = String(ctx.orgId || "").trim();
  if (!UUID_RE.test(orgRaw)) return skipAll("no company id in this run — the boards were not read");
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  const [count, age, dead, lost] = await Promise.all([
    checkCountTrue(run, orgRaw).catch((err) => row("pipeline:count-true", "skip", `the count check threw: ${errText(err)}`)),
    checkAge(run, orgRaw, now).catch((err) => row("pipeline:age", "skip", `the age check threw: ${errText(err)}`)),
    checkDeadStage(run, orgRaw).catch((err) => row("pipeline:dead-stage", "skip", `the dead stage check threw: ${errText(err)}`)),
    checkNobodyLost(run, orgRaw, now).catch((err) => row("pipeline:nobody-lost", "skip", `the nobody-lost check threw: ${errText(err)}`))
  ]);
  return [count, age, ageNoLimitRow(), dead, lost];
}
