// Cash-flow reminders — the write and read path for `cashflow_reminders`.
//
// *** NOTHING HERE SENDS ANYTHING. *** A reminder is a row. There is no email,
// no SMS, no push, no webhook and no outbound fetch in this file, and none may
// be added to it. Delivery does not exist anywhere in this repository —
// AUDIT-FINDINGS.md records that `sendTemplated` writes `messages` rows with
// status='queued' and nothing drains them, and this module has the same shape
// of honesty: it records that something OUGHT to be said, and stops.
//
// The functions below take `db` and write the table directly, exactly as
// src/auth/ and src/shifts/store.mjs do. No bus event is emitted: there is no
// canonical event for a reminder and per the repo convention names are not
// added to src/events/canonical.mjs unilaterally (see src/auth/PROPOSED-EVENTS.md,
// which reaches the same conclusion from the auth side).
//
// NO CLOCK. Every function that needs "now" takes it as an argument, for the
// same reason src/banking/cashflow.mjs does: a reminder store whose behaviour
// depends on the wall clock cannot be tested at a boundary, and the boundary is
// the whole point of `surface_at`.
//
// NOTHING HERE DECIDES *WHEN* TO SURFACE A REMINDER. `surfaceAt` is a required
// argument with no default and no derivation. Computing it would need a rule of
// the form "warn N days before due", and there is no row anywhere in this
// schema that holds N — see the header of db/migrations/087_cashflow_reminders.sql.
// src/banking/cashflow.mjs reports that gap by name rather than filling it in.
//
// NOTHING HERE DECIDES *WHAT TO SAY*. `body` is a required argument. Rendering
// belongs to whatever composes the sentence; storing it as written is what
// makes the reminder a record of what somebody was shown rather than something
// re-derived later from a template that has since changed.

/**
 * ReminderError — a domain failure carrying the HTTP status it should surface
 * as. Same shape as ShiftError (src/shifts/store.mjs) and InquiryWriteError
 * (src/inquiries/work.mjs). 400 by default, because the common case is a caller
 * that left out an id.
 */
export class ReminderError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "ReminderError";
    this.status = status;
  }
}

/**
 * The three things a reminder can be about (loan added by 451), and the five
 * things it can say.
 *
 * Exported as frozen constants so a caller building a reminder and the CHECK
 * constraint that will reject it cannot drift apart on a spelling. These MUST
 * match db/migrations/087_cashflow_reminders.sql (+ 451); the pg test asserts that they
 * do, against the live constraint rather than against this list.
 */
export const SUBJECT_KINDS = Object.freeze(["card_liability", "recurring_bill", "loan"]); // loan: 451
export const REMINDER_KINDS = Object.freeze([
  "payment_due",
  "statement_closed",
  "projected_shortfall",
  "payment_window_closing",
  "input_missing"
]);
export const ACK_BY_KINDS = Object.freeze(["staff", "account"]);

function requireId(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new ReminderError(`${field} is required`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReminderError(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ReminderError(`${field} must be one of ${allowed.join(", ")} — got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A timestamp for the database.
 *
 * Refuses a bare number for the same reason src/shifts/timesheet.mjs and
 * src/banking/cashflow.mjs do: an epoch in seconds and an epoch in milliseconds
 * are indistinguishable at a glance, and guessing wrong puts a reminder fifty
 * years away from when it was meant to appear.
 */
function requireInstant(value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ReminderError(`${field} is an Invalid Date`);
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ReminderError(`${field} is not a valid timestamp: ${JSON.stringify(value)}`);
    }
    return parsed.toISOString();
  }
  throw new ReminderError(
    `${field} must be a Date or an ISO timestamp string, got ${JSON.stringify(value)}`
  );
}

const COLUMNS = `id, org_id, client_id, subject_kind, subject_id, subject_label,
                 reminder_kind, body, surface_at,
                 acknowledged_at, acknowledged_by_kind, acknowledged_by_id,
                 created_at, updated_at`;

/* uq_cashflow_reminders_dedupe is the only unique constraint on this table
   other than the gen_random_uuid() primary key, so a 23505 here can only be
   that index. Matching on the SQLSTATE rather than the constraint name means an
   index created under a different name — a hand-applied environment, a future
   rename — still reads as "already written" instead of a 500. Same reasoning as
   src/shifts/store.mjs. */
const isUniqueViolation = (e) => e?.code === "23505";

/**
 * createReminder(db, {...}) — write one reminder, or return the one that is
 * already there.
 *
 * IDEMPOTENT BY THE DATABASE, NOT BY A GUARD SELECT. The projection is pure and
 * takes its clock as a parameter, so a nightly run over unchanged inputs
 * produces the same findings with the same `surfaceAt` every time. Without a
 * unique index this table would grow a duplicate of every outstanding reminder
 * every night, and a reminders list that does that is one people stop reading.
 *
 * The insert is deliberately unconditional — ON CONFLICT DO NOTHING and then a
 * read, rather than SELECT-then-INSERT. A check followed by an insert is two
 * statements with a window between them, and two overlapping runs (a retried
 * job, a nightly sweep still going when the next starts) both read "no prior
 * reminder" and both insert. Only the index settles a race between two writers.
 *
 * @returns {{reminder: object, created: boolean}} `created: false` means an
 *          identical reminder already existed and this call changed nothing.
 */
export async function createReminder(
  db,
  { orgId, clientId, subjectKind, subjectId, subjectLabel, reminderKind, body, surfaceAt } = {}
) {
  requireId(orgId, "orgId");
  requireId(clientId, "clientId");
  requireId(subjectId, "subjectId");
  requireOneOf(subjectKind, SUBJECT_KINDS, "subjectKind");
  requireOneOf(reminderKind, REMINDER_KINDS, "reminderKind");
  requireText(subjectLabel, "subjectLabel");
  requireText(body, "body");
  const at = requireInstant(surfaceAt, "surfaceAt");

  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO cashflow_reminders
         (org_id, client_id, subject_kind, subject_id, subject_label, reminder_kind, body, surface_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (org_id, client_id, subject_kind, subject_id, reminder_kind, surface_at)
         DO NOTHING
       RETURNING ${COLUMNS}`,
      [orgId, clientId, subjectKind, subjectId, subjectLabel.trim(), reminderKind, body.trim(), at]
    );
  } catch (e) {
    /* ON CONFLICT already covers the dedupe index, so a 23505 escaping it means
       a DIFFERENT unique constraint was violated — which today cannot happen,
       and if it ever does it is a schema change nobody told this module about.
       Reported as a conflict rather than swallowed. */
    if (isUniqueViolation(e)) {
      throw new ReminderError("that reminder conflicts with an existing row", { status: 409 });
    }
    throw e;
  }

  if (inserted.rows.length === 1) return { reminder: inserted.rows[0], created: true };

  const existing = await db.query(
    `SELECT ${COLUMNS} FROM cashflow_reminders
      WHERE org_id = $1 AND client_id = $2 AND subject_kind = $3
        AND subject_id = $4 AND reminder_kind = $5 AND surface_at = $6`,
    [orgId, clientId, subjectKind, subjectId, reminderKind, at]
  );
  if (existing.rows.length === 0) {
    /* DO NOTHING fired but the row is not there. The only way that happens is a
       concurrent delete between the two statements. Saying so beats returning
       undefined and letting the caller dereference it. */
    throw new ReminderError("the conflicting reminder disappeared mid-write — retry", {
      status: 409
    });
  }
  return { reminder: existing.rows[0], created: false };
}

/**
 * dueReminders(db, { orgId, asOf, clientId?, limit? }) — what should be in
 * front of somebody now, and has not been acknowledged.
 *
 * `asOf` is required and there is no default. A reader that quietly used the
 * server clock would return a different answer on a machine whose clock has
 * drifted, and there would be no way to test the boundary — a reminder due at
 * exactly `asOf` IS due, and that is asserted in the pg test.
 *
 * NOTHING IS MARKED AS ANYTHING BY READING IT. There is no "surfaced_at"
 * stamped here and no state change of any kind: this is a SELECT. Reading a
 * reminder is not delivering it.
 */
export async function dueReminders(db, { orgId, asOf, clientId, limit = 100 } = {}) {
  requireId(orgId, "orgId");
  const at = requireInstant(asOf, "asOf");
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ReminderError(`limit must be a positive whole number, got ${JSON.stringify(limit)}`);
  }
  const params = [orgId, at, limit];
  let clientFilter = "";
  if (clientId !== undefined && clientId !== null && clientId !== "") {
    params.push(clientId);
    clientFilter = ` AND client_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM cashflow_reminders
      WHERE org_id = $1
        AND surface_at <= $2
        AND acknowledged_at IS NULL${clientFilter}
      ORDER BY surface_at ASC, created_at ASC
      LIMIT $3`,
    params
  );
  return rows;
}

/**
 * forClient(db, { orgId, clientId, limit? }) — every reminder for one client,
 * acknowledged or not, newest first. The client-detail read.
 */
export async function forClient(db, { orgId, clientId, limit = 100 } = {}) {
  requireId(orgId, "orgId");
  requireId(clientId, "clientId");
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ReminderError(`limit must be a positive whole number, got ${JSON.stringify(limit)}`);
  }
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM cashflow_reminders
      WHERE org_id = $1 AND client_id = $2
      ORDER BY surface_at DESC, created_at DESC
      LIMIT $3`,
    [orgId, clientId, limit]
  );
  return rows;
}

/**
 * acknowledge(db, { orgId, reminderId, at, byKind, byId }) — somebody saw it
 * and said so.
 *
 * THE FIRST ACKNOWLEDGEMENT WINS. The WHERE clause carries
 * `acknowledged_at IS NULL`, so a second call does not overwrite who
 * acknowledged it first, and two racing calls cannot both claim it — the
 * database decides, in one statement, rather than a read-then-write deciding by
 * luck. A repeat call returns `{ ok: false, reason: "already_acknowledged" }`
 * with the row as it stands, which is a true answer rather than an error: the
 * caller's intent (this is acknowledged) is satisfied either way.
 *
 * `at` is required — see dueReminders for why there is no clock in here.
 */
export async function acknowledge(db, { orgId, reminderId, at, byKind, byId } = {}) {
  requireId(orgId, "orgId");
  requireId(reminderId, "reminderId");
  requireId(byId, "byId");
  requireOneOf(byKind, ACK_BY_KINDS, "byKind");
  const when = requireInstant(at, "at");

  const { rows } = await db.query(
    `UPDATE cashflow_reminders
        SET acknowledged_at = $1, acknowledged_by_kind = $2, acknowledged_by_id = $3
      WHERE id = $4 AND org_id = $5 AND acknowledged_at IS NULL
      RETURNING ${COLUMNS}`,
    [when, byKind, byId, reminderId, orgId]
  );
  if (rows.length === 1) return { ok: true, reminder: rows[0] };

  /* Nothing updated. Either it does not exist in this org, or it was already
     acknowledged. Those are different answers and the caller needs to be able
     to tell them apart — a 404 and a no-op are not the same thing. */
  const found = await db.query(
    `SELECT ${COLUMNS} FROM cashflow_reminders WHERE id = $1 AND org_id = $2`,
    [reminderId, orgId]
  );
  if (found.rows.length === 0) {
    throw new ReminderError("no such reminder in this org", { status: 404 });
  }
  return { ok: false, reason: "already_acknowledged", reminder: found.rows[0] };
}

/**
 * getReminder(db, { orgId, reminderId }) — one reminder, or null.
 *
 * SCOPED TO THE ORG, always. Every read in this module carries org_id in its
 * WHERE clause; an id on its own is not an authorisation to read a row, and
 * Rule 7 of the schema puts org_id on every table precisely so that it can be
 * filtered on rather than assumed.
 */
export async function getReminder(db, { orgId, reminderId } = {}) {
  requireId(orgId, "orgId");
  requireId(reminderId, "reminderId");
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM cashflow_reminders WHERE id = $1 AND org_id = $2`,
    [reminderId, orgId]
  );
  return rows[0] ?? null;
}
