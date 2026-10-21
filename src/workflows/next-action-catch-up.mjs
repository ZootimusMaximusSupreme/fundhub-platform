// The next-step catch-up — every hour (every five minutes until 2026-10-20, slowed
// for the Inngest Free plan run limit), the saved step is put back in
// line with the step the Client Control Panel shows.
//
// Hole 12, round 3, 2026-09-18. Measured live that afternoon: all six files
// holding a saved step (clients.custom_fields.employee_next_action) disagreed
// with the control panel — #8 saved "Pull CRS" while the panel said "Remove
// Inquiries"; #11, #12, Combo and Walk4 saved "Pull CRS" or "Collect
// Documents" while the panel said "Apply for Funding".
//
// Two causes, two halves of the fix:
//   1. A dozen jobs each saved their own fixed word. mergeCustomFields
//      (src/workflows/custom-fields.mjs) now saves the panel's step instead.
//   2. The panel's step also moves with NO save at all — a funding card moved
//      on the board, an inquiry case opened or closed, a credit report landed,
//      written permission recorded, a staff drag — and some jobs change the
//      step right after they save (C-05, S-DOC, F-11). Nothing wakes up for
//      those. This pass does: it works the step out again for every file that
//      has a saved one and saves it only when it differs.
//
// WHAT IT TOUCHES: one key, employee_next_action, on files that already have
// one. Nothing else on the record, and never a file without a saved step.
// The write only lands if the saved words are still the ones this pass read,
// so a job that saved in between is never overwritten with an older answer.
//
// WHAT IT NEVER DOES: send, queue a message, emit an event, create a task, or
// move a card. It reads, and it writes that one key. The only trigger on
// `clients` (set_updated_at, measured live) stamps updated_at and nothing else.
//
// IT NEVER SAVES A BLANK. When the panel's step cannot be worked out — a read
// failed, the answer came back degraded, or no step applies — the saved words
// are left exactly as they are.
//
// BOUNDED. One pass looks at CATCH_UP_BATCH files at most. With more files than
// that, each pass takes the next page (by the five-minute slot), so every file
// is looked at within ceil(files / CATCH_UP_BATCH) passes. Six files live today.
//
// NEVER THROWS. The next pass is the recovery.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { shownStepLabel } from "../fulfillment/client-step.mjs";
import { NEXT_ACTION_KEY } from "./custom-fields.mjs";

export const CATCH_UP_CRON = "5 * * * *";
export const CATCH_UP_BATCH = 100;
export const SOURCE_WORKFLOW = "next-action-catch-up";
const SLOT_MS = 5 * 60 * 1000;

/* "Has a saved step" means non-blank words, not merely the key. */
const COUNT_SQL =
  `SELECT count(*)::int AS n
     FROM clients
    WHERE COALESCE(custom_fields->>'${NEXT_ACTION_KEY}', '') <> ''`;

const PAGE_SQL =
  `SELECT id, custom_fields->>'${NEXT_ACTION_KEY}' AS saved
     FROM clients
    WHERE COALESCE(custom_fields->>'${NEXT_ACTION_KEY}', '') <> ''
    ORDER BY id
    LIMIT $1 OFFSET $2`;

/* One key, and only if the saved words are still the ones this pass read. */
const FIX_SQL =
  `UPDATE clients
      SET custom_fields = custom_fields || jsonb_build_object('${NEXT_ACTION_KEY}', $2::text)
    WHERE id = $1
      AND custom_fields->>'${NEXT_ACTION_KEY}' = $3
    RETURNING id`;

/* catchUp — one pass. `db`, the batch size and the clock are arguments so the
   tests drive it without Inngest. Returns counts plus the files it changed. */
export async function catchUp(db, { limit = CATCH_UP_BATCH, now = Date.now() } = {}) {
  const out = { ok: true, total: 0, checked: 0, corrected: 0, same: 0, kept: 0, raced: 0, failed: 0, changes: [] };
  try {
    const batch = Number.isInteger(limit) && limit > 0 ? limit : CATCH_UP_BATCH;
    const countRes = await db.query(COUNT_SQL);
    const total = Number(countRes?.rows?.[0]?.n) || 0;
    out.total = total;
    if (total === 0) return out;

    const pages = Math.ceil(total / batch);
    const slot = Math.floor(Number(now) / SLOT_MS);
    const offset = pages > 1 ? (((slot % pages) + pages) % pages) * batch : 0;
    const page = await db.query(PAGE_SQL, [batch, offset]);

    for (const row of page?.rows || []) {
      out.checked += 1;
      try {
        const shown = await shownStepLabel(db, row.id);
        if (!shown) { out.kept += 1; continue; }
        if (shown === row.saved) { out.same += 1; continue; }
        const fixed = await db.query(FIX_SQL, [row.id, shown, row.saved]);
        if (fixed?.rows?.length) {
          out.corrected += 1;
          out.changes.push({ client_id: row.id, from: row.saved, to: shown });
        } else {
          out.raced += 1;
        }
      } catch (err) {
        out.failed += 1;
        console.warn(`[${SOURCE_WORKFLOW}] one file skipped:`, err && err.message);
      }
    }
    return out;
  } catch (err) {
    return { ...out, ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow. It is a cron with no event trigger, so no journey will
   ever reach it and it will always appear in the runner's neverFired list —
   the correct outcome for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => catchUp(handleDb || db);
  return step && typeof step.run === "function" ? step.run("catch-up", run) : run();
}

export const nextActionCatchUp = inngest.createFunction(
  { id: "next-action-catch-up", name: "Next step catch-up" },
  { cron: CATCH_UP_CRON },
  () => catchUp(db)
);

export default catchUp;
