#!/usr/bin/env node
// retention-purge — report what has passed its retention period, and (only when
// explicitly told to) act on it.
//
// ============================================================================
// *** DRY RUN IS THE DEFAULT. --apply IS THE ONLY WAY THIS TOOL WRITES. ***
// ============================================================================
//
//   Dry run — reports, changes nothing:
//     DATABASE_URL="..." node scripts/retention-purge.mjs --staff <staff-uuid>
//
//   For real — this DELETES AND REWRITES DATA:
//     DATABASE_URL="..." node scripts/retention-purge.mjs --staff <staff-uuid> --apply
//
// ============================================================================
// *** THIS TOOL IS NEVER SCHEDULED. ***
// ============================================================================
//
// There is no cron entry, no Inngest function, no Netlify scheduled function and
// no timer anywhere that calls this file. That is not an omission to be tidied
// up later — a purge that silently deletes consumer-credit records on a schedule
// is a defect in a regulated product, not a feature. Somebody types this command,
// reads the dry run, and decides. If a future change wires this to a scheduler,
// that change is the thing that needs the compliance review, not this file.
//
// The design backs the promise up rather than relying on the flag: a dry run
// does not call any code path that contains a write. src/retention/classes.mjs
// splits `count` (SELECT only) from `purge` (the writes), and the line below
// that calls `purge` sits inside `if (apply)`. There is no "purge with writes
// disabled" mode to get wrong.
//
// ============================================================================
// WHAT MAKES IT SAFE, IN ORDER
// ============================================================================
//
// 1. NOTHING IS PURGED WITHOUT A RETENTION PERIOD. Every retain_days ships NULL
//    from db/migrations/100_retention_policy.sql, NULL means UNSET, and an unset
//    class is SKIPPED and reported. So on a freshly migrated database this tool
//    removes nothing even with --apply. Somebody has to decide a number first.
//
// 2. ORG SCOPING COMES FROM THE SESSION, AND IT FAILS CLOSED. There is no --org
//    flag and there is no "all orgs" mode. You identify yourself, and the org is
//    read off YOUR staff record (staff.org_id). No actor, no org, wrong role, or
//    a staff row that is not active → the tool exits without running a query.
//    An operator cannot purge a tenant they do not belong to, because there is no
//    way to name one.
//
// 3. ONE TRANSACTION FOR THE WHOLE APPLY. Uses withTransaction from
//    src/finance/soft-pulls.mjs — a REAL transaction. The similar-looking helper
//    in src/pii/index.mjs is broken (its `typeof db.connect !== "function"` probe
//    is always true for the shared handle, so it runs multi-statement writes with
//    autocommit) and is deliberately not used. A half-applied purge is
//    unrecoverable: the records are gone and the report says something else.
//
// 4. MONEY IS NEVER INVENTED. The soft-pull ledger's cost_cents is integer cents
//    and NULL means UNKNOWN. Expiring rows with an unknown cost are reported as
//    their own count and the total prints as "unknown" rather than as $0.00.

import { db, close } from "../src/db.mjs";
import { withTransaction } from "../src/finance/soft-pulls.mjs";
import { hasRole } from "../src/http/middleware/requireRole.mjs";
import { verifySession } from "../src/auth/session.mjs";
import { DATA_CLASSES, loadPolicy, policyGaps } from "../src/retention/policy.mjs";
import { CLASSES } from "../src/retention/classes.mjs";
import { randomUUID } from "node:crypto";

// Who may run this. An owner passes every gate (SUPER_ROLES in requireRole.mjs),
// so this reads as "owner or admin". Gated on the role explicitly rather than
// left to requireAuth, because CLAUDE.md §12 records that requireAuth ignores a
// `roles` key entirely — passing one there would look like a gate and be none.
const ALLOWED_ROLES = ["admin"];

export function parseArgs(argv) {
  const out = { apply: false, staffId: null, sessionToken: null, help: false, unknown: [] };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    switch (arg) {
      case "--apply": out.apply = true; break;
      case "--staff": out.staffId = rest.shift() ?? null; break;
      case "--session": out.sessionToken = rest.shift() ?? null; break;
      case "-h":
      case "--help": out.help = true; break;
      default: out.unknown.push(arg);
    }
  }
  return out;
}

const USAGE = `
retention-purge — report expired data, and only remove it when told to.

  Dry run (default — reports, changes NOTHING):
    DATABASE_URL="..." node scripts/retention-purge.mjs --staff <staff-uuid>

  For real (THIS DELETES AND REWRITES DATA):
    DATABASE_URL="..." node scripts/retention-purge.mjs --staff <staff-uuid> --apply

  --staff <uuid>     Who is running this. The org is read off this staff record.
  --session <token>  Alternative to --staff: a live session token.
  --apply            Actually act. Without it nothing is written.

There is no --org flag, on purpose: the org comes from your own record so that
nobody can purge a tenant they do not belong to.
`.trimStart();

/* resolveActor — identify the operator and read the org off THEIR record.
   Fails closed at every step: a missing flag, an unknown id, a suspended
   account, a staff row with no org, or the wrong role all return an error rather
   than a default. There is deliberately no fallback to the default org — an
   org-scoping rule with a fallback is not a rule. */
export async function resolveActor(dbh, { staffId, sessionToken, env = process.env } = {}) {
  if (sessionToken) {
    const result = await verifySession(dbh, sessionToken, { env });
    if (!result?.staff) return { error: "that session is not valid — log in again" };
    return gateStaff(result.staff);
  }

  if (staffId) {
    const { rows } = await dbh.query(
      `SELECT id, org_id, role, name, status FROM staff WHERE id = $1`,
      [staffId]
    );
    if (!rows.length) return { error: `no staff member with id ${staffId}` };
    return gateStaff(rows[0]);
  }

  return { error: "say who you are: --staff <uuid> or --session <token>. There is no unscoped mode." };
}

function gateStaff(staff) {
  // 'status' is nullable on older rows; only an explicit non-active value is a
  // refusal. Matches verifySession's reading of the same column.
  if (staff.status && String(staff.status) !== "active") {
    return { error: `staff ${staff.id} is ${staff.status}, not active` };
  }
  if (!staff.org_id) return { error: `staff ${staff.id} has no org — refusing to guess one` };
  if (!hasRole(staff, ALLOWED_ROLES)) {
    return { error: `role "${staff.role ?? "none"}" may not run a retention purge (needs owner or admin)` };
  }
  return { staff: { id: staff.id, orgId: staff.org_id, role: staff.role, name: staff.name } };
}

const money = (cents) =>
  cents === null || cents === undefined
    ? "unknown"
    : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * plan(dbh, { orgId }) — what WOULD happen. Reads only.
 *
 * Every class is included in the result, including the ones with no retention
 * period, because "this class is not covered" is the finding the report exists to
 * surface. A skipped class is not a quiet no-op here; it is a line in the output.
 */
export async function plan(dbh, { orgId } = {}) {
  const policy = await loadPolicy(dbh, { orgId });
  const items = [];

  for (const name of DATA_CLASSES) {
    const handler = CLASSES[name];
    const row = policy.get(name);

    if (!row) {
      items.push({ dataClass: name, label: handler.label, skipped: "no policy row for this org" });
      continue;
    }
    // *** THE NULL GATE. *** `"retainDays" in row` is false when the column is
    // NULL, because policy.mjs leaves the key ABSENT rather than setting it to
    // null or zero. This is the line that makes an undecided retention period
    // mean "do nothing" instead of "expire everything".
    if (!("retainDays" in row)) {
      items.push({
        dataClass: name, label: handler.label, action: row.action,
        skipped: "no retention period set — nobody has decided how long this is kept"
      });
      continue;
    }

    const counts = await handler.count(dbh, { orgId, retainDays: row.retainDays });
    const item = {
      dataClass: name,
      label: handler.label,
      action: row.action,
      why: handler.why,
      retainDays: row.retainDays,
      signedOff: !!row.signedOffAt,
      ...counts
    };
    if (handler.reportOnly) item.reportOnly = await handler.reportOnly(dbh, { orgId });
    items.push(item);
  }

  return { orgId, items, gaps: await policyGaps(dbh, { orgId }) };
}

/**
 * apply(dbh, { orgId, items }) — the only function in this file that writes.
 *
 * One transaction for all classes: a purge that half-applied would leave the
 * report describing a database that does not exist. Classes with no retention
 * period were already dropped by plan() and are not reachable from here; the
 * per-class ctxOrThrow() in classes.mjs checks it a second time anyway.
 */
export function countOnlyPlan(items = []) {
  return items.map((item) => ({
    dataClass: item.dataClass,
    action: item.action ?? null,
    retainDays: item.retainDays ?? null,
    signedOff: item.signedOff ?? false,
    expired: item.expired ?? null,
    skipped: item.skipped ?? null
  }));
}

export async function apply(dbh, { orgId, items, actorId } = {}) {
  const actionable = items.filter((i) => !i.skipped);
  if (!actionable.length) return [];
  if (!actorId) throw new Error("actorId is required before applying a retention purge");
  if (actionable.some((item) => !item.signedOff)) {
    throw new Error("every retention class must be signed off before applying a purge");
  }

  return withTransaction(dbh, async (tx) => {
    const done = [];
    for (const item of actionable) {
      const res = await CLASSES[item.dataClass].purge(tx, { orgId, retainDays: item.retainDays });
      done.push({ dataClass: item.dataClass, label: item.label, action: item.action, ...res });
    }
    const receipt = await tx.query(
      `INSERT INTO retention_run_receipts
         (org_id, run_key, kind, actor_staff_id, plan_counts, applied_counts)
       VALUES ($1, $2, 'apply', $3, $4::jsonb, $5::jsonb)
       RETURNING id`,
      [orgId, randomUUID(), actorId, JSON.stringify(countOnlyPlan(items)),
        JSON.stringify(done.map(({ dataClass, action, affected }) => ({ dataClass, action, affected })))]
    );
    if (!receipt?.rows?.[0]?.id) throw new Error("retention purge receipt was not saved; transaction rolled back");
    done.receiptId = receipt.rows[0].id;
    return done;
  });
}

function report({ actor, result, applied, didApply }) {
  const lines = [];
  lines.push("");
  lines.push(didApply ? "RETENTION PURGE — APPLIED" : "RETENTION PURGE — DRY RUN (nothing was changed)");
  lines.push("=".repeat(64));
  lines.push(`org:   ${result.orgId}`);
  lines.push(`actor: ${actor.name ?? actor.id} (${actor.role ?? "no role"})`);
  if (didApply && applied?.receiptId) lines.push(`receipt: ${applied.receiptId}`);
  lines.push("");

  for (const item of result.items) {
    lines.push(`${item.label}  [${item.dataClass}]`);
    if (item.skipped) {
      lines.push(`  SKIPPED — ${item.skipped}`);
      lines.push(`  nothing counted, nothing removed`);
      lines.push("");
      continue;
    }
    /* Three actions now, not two. 'retain' arrived with broker_upload_rows
       (db/migrations/275_decline_autopsy.sql): kept in full, on purpose. A
       retain class has no period, so it lands in the SKIPPED branch above and
       these lines are not reached — but printing "DE-IDENTIFY" for it if one
       ever were would be a lie in the operator's own report. */
    const WORDS = {
      delete: { future: "would delete", shout: "DELETE", past: "deleted" },
      de_identify: { future: "would de-identify", shout: "DE-IDENTIFY", past: "de-identified" },
      retain: { future: "would keep", shout: "RETAIN", past: "kept" }
    };
    const w = WORDS[item.action] ?? WORDS.de_identify;
    lines.push(`  keeps ${item.retainDays} days${item.signedOff ? "" : "   *** NOT SIGNED OFF ***"}`);
    lines.push(`  ${w.shout} — ${item.why}`);

    const did = applied?.find((a) => a.dataClass === item.dataClass);
    lines.push(did ? `  ${w.past}: ${did.affected} rows`
                   : `  ${w.future}: ${item.expired} rows`);

    if (item.clientsTouched !== undefined) lines.push(`  covering ${item.clientsTouched} clients`);
    if (item.unknownCost !== undefined) {
      // NULL means UNKNOWN. Reported as its own number, never folded into a zero.
      lines.push(`  known cost of expiring rows: ${money(item.knownCostCents)}`);
      lines.push(`  rows whose cost is UNKNOWN: ${item.unknownCost}  (unknown is not zero)`);
    }
    if (item.reportOnly?.length) {
      lines.push(`  REPORTED, NOT TOUCHED — demo client rows this tool will not delete:`);
      for (const c of item.reportOnly) {
        lines.push(`    ${c.email} (${c.clientId}) — ${c.crsResults} credit reports, ${c.softPulls} soft pulls, ${c.piiReads} PII reads`);
        lines.push(`    deleting this client cascades across five tables. That is a human's call, not this script's.`);
      }
    }
    lines.push("");
  }

  if (result.gaps.length) {
    lines.push("POLICY GAPS — classes nobody has decided or signed off");
    lines.push("-".repeat(64));
    for (const g of result.gaps) {
      lines.push(`  ${g.data_class}: ${g.status}`);
      lines.push(`    if this is wrong: ${g.consequence}`);
    }
    lines.push("");
  }

  if (!didApply) {
    const anyActionable = result.items.some((i) => !i.skipped && i.expired > 0);
    lines.push(anyActionable
      ? "This was a DRY RUN. Nothing changed. Add --apply to actually do it."
      : "This was a DRY RUN, and there was nothing to do anyway.");
  }
  lines.push("");
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), { dbh = db, out = console } = {}) {
  const args = parseArgs(argv);
  if (args.help) { out.log(USAGE); return 0; }
  if (args.unknown.length) {
    out.error(`unknown option: ${args.unknown.join(" ")}\n`);
    out.error(USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    out.error("DATABASE_URL is not set — refusing to run.");
    return 2;
  }

  const actor = await resolveActor(dbh, { staffId: args.staffId, sessionToken: args.sessionToken });
  if (actor.error) {
    // Fail closed, and say so rather than falling back to anything.
    out.error(`refusing to run: ${actor.error}`);
    return 2;
  }

  const result = await plan(dbh, { orgId: actor.staff.orgId });

  let applied = null;
  if (args.apply) {
    applied = await apply(dbh, { orgId: actor.staff.orgId, items: result.items, actorId: actor.staff.id });
  }

  out.log(report({ actor: actor.staff, result, applied, didApply: args.apply }));
  return 0;
}

/* Run only when invoked directly, so importing this file from a test does not
   execute it. process.argv[1] is the script path under `node scripts/...`. */
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .then(async (code) => { await close(); process.exit(code); })
    .catch(async (err) => {
      console.error(`retention-purge failed: ${err?.message ?? err}`);
      await close();
      process.exit(1);
    });
}
