import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";
import { redact, pageParams } from "../http/read-api.mjs";
import { buildSetterHandoffText, performSetterSendAction } from "./send-actions.mjs";
import { advanceCardToStage } from "../workflows/cards.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { queueCloserSetAlert } from "../staff/lead-alerts.mjs";
import { tierBookingLink } from "../workflows/messaging.mjs";
import { creditTierFor, stampQualificationBucket } from "../config/survey-qualification.mjs";
import { refreshPrecallForScore } from "../workflows/precall-plan.mjs";
import { emit } from "../events/bus.mjs";

// Assigned setters have the same personal queue boundary as primary setters.
// Only the existing owner/admin seats may use the management-wide view.
const needsSetterAssignment = staff => !["owner", "admin"].includes(staff?.role);

const HANDOFF_FIELDS = new Set([
  "lead_type", "dialed_at", "call_attempts", "disposition", "voicemail_left",
  "missed_text_sent", "time_confirmed", "frame_warmed", "problem", "goal",
  "computer_ready", "app_on_phone", "triage_personal_or_business",
  "triage_problem", "triage_goal", "employment_status", "employment_details",
  "annual_personal_income", "income_verification"
]);
const BOOL_FIELDS = new Set(["voicemail_left", "missed_text_sent", "time_confirmed", "frame_warmed", "computer_ready", "app_on_phone"]);
const TEXT_FIELDS = new Set(["problem", "goal", "triage_problem", "triage_goal", "employment_details"]);
const DISPOSITIONS = new Set(["reached", "no_answer", "reschedule", "booked_on_call"]);
const EMPLOYMENT_STATUSES = new Set(["", "w2", "self_employed", "retired", "not_working", "other", "not_shared"]);
const PERSONAL_INCOME_OPTIONS = new Set(["", ...CF_SURVEY_QUESTIONS.find(q => q.id === "annual_personal_income").options, "not_shared"]);
const INCOME_VERIFICATION_OPTIONS = new Set(["", ...CF_SURVEY_QUESTIONS.find(q => q.id === "verify_income").options, "not_shared"]);
const FORBIDDEN_CLAIM = /\b(?:social security(?: number)?|ssn|pre[ -]?approved|approved for|qualif(?:y|ied) for|credit (?:was|has been|already) pulled)\b|\b\d{3}-\d{2}-\d{4}\b/i;
const SURVEY_KEYS = new Set(CF_SURVEY_QUESTIONS.filter(q => q.type !== "contact").map(q => q.payloadKey));

function jsonObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
}

function phoenixDay(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const part = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${part.year}-${part.month}-${part.day}`;
}

export function targetDialBy(createdAt) {
  const first = new Date(createdAt);
  if (!Number.isFinite(first.getTime())) return null;
  const minuteTarget = new Date(first.getTime() + 60_000);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(minuteTarget);
  const part = Object.fromEntries(local.map(x => [x.type, x.value]));
  const hour = Number(part.hour);
  if (hour >= 6 && hour < 22) return minuteTarget.toISOString();
  const next = new Date(Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), 13));
  if (hour >= 22) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function surveySummary(fields) {
  const cf = jsonObject(fields);
  return CF_SURVEY_QUESTIONS.filter(q => q.type !== "contact").map(q => {
    const value = cf[`${q.payloadKey}_label`] ?? cf[`${q.payloadKey}_labels`] ?? cf[q.payloadKey];
    const unpack = (part, depth = 0) => {
      if (depth < 3 && typeof part === "string" && part.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(part);
          if (Array.isArray(parsed)) return parsed.flatMap(item => unpack(item, depth + 1));
        } catch { /* Keep a plain answer as written. */ }
      }
      if (Array.isArray(part)) return part.flatMap(item => unpack(item, depth + 1));
      return [String(part ?? "").trim()];
    };
    const answerValues = unpack(value).filter(Boolean);
    return answerValues.length ? {
      key: q.payloadKey, question: q.title, answer: answerValues.join(", "),
      answer_values: answerValues, type: q.type, options: q.options || []
    } : null;
  }).filter(Boolean);
}

export function sanitizeHandoffPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "handoff must be an object" };
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!HANDOFF_FIELDS.has(key)) continue;
    if (BOOL_FIELDS.has(key)) {
      if (value !== true && value !== false && value !== null) return { error: `${key} must be yes or no` };
      patch[key] = value;
    } else if (TEXT_FIELDS.has(key)) {
      if (typeof value !== "string" || value.length > 1000 || FORBIDDEN_CLAIM.test(value)) {
        return { error: `${key} contains unsupported text` };
      }
      patch[key] = value.trim();
    } else if (key === "call_attempts") {
      if (!Number.isInteger(value) || value < 0 || value > 20) return { error: "call_attempts must be from 0 to 20" };
      patch[key] = value;
    } else if (key === "dialed_at") {
      if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) return { error: "dialed_at must be a date" };
      patch[key] = value;
    } else if (key === "disposition") {
      if (value !== "" && !DISPOSITIONS.has(value)) return { error: "invalid disposition" };
      patch[key] = value;
    } else if (key === "triage_personal_or_business") {
      if (!["", "personal", "business", "both"].includes(value)) return { error: "invalid triage type" };
      patch[key] = value;
    } else if (key === "employment_status") {
      if (!EMPLOYMENT_STATUSES.has(value)) return { error: "invalid employment status" };
      patch[key] = value;
    } else if (key === "annual_personal_income") {
      if (!PERSONAL_INCOME_OPTIONS.has(value)) return { error: "invalid personal income" };
      patch[key] = value;
    } else if (key === "income_verification") {
      if (!INCOME_VERIFICATION_OPTIONS.has(value)) return { error: "invalid income verification" };
      patch[key] = value;
    } else if (key === "lead_type") {
      if (!["booked", "opt_in"].includes(value)) return { error: "invalid lead type" };
      patch[key] = value;
    }
  }
  return { patch };
}

export function missingForCompletion(handoff, booking) {
  const h = jsonObject(handoff);
  const missing = [];
  if (!booking?.booked_at || !booking?.booking_time) missing.push("booking");
  if (!h.dialed_at) missing.push("dialed_at");
  if (!Number.isInteger(h.call_attempts) || h.call_attempts < 1) missing.push("call_attempts");
  if (!h.disposition || h.disposition === "no_answer" || h.disposition === "reschedule") missing.push("disposition");
  for (const key of ["problem", "goal"]) if (!String(h[key] || "").trim()) missing.push(key);
  for (const key of ["time_confirmed", "frame_warmed"]) if (h[key] !== true) missing.push(key);
  for (const key of ["computer_ready", "app_on_phone"]) if (typeof h[key] !== "boolean") missing.push(key);
  if (h.lead_type === "opt_in") {
    for (const key of ["triage_problem", "triage_goal", "triage_personal_or_business"]) {
      if (!String(h[key] || "").trim()) missing.push(key);
    }
  }
  return missing;
}

function mapItem(row, staff) {
  const cf = jsonObject(row.custom_fields);
  const handoff = jsonObject(cf.setter_handoff);
  const booked = !!row.booked_at;
  return redact({
    client_id: row.client_id,
    client_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
    phone: row.phone || null,
    email: row.email || null,
    lead_type: booked ? "booked" : "opt_in",
    created_at: row.created_at,
    booked_at: row.booked_at || null,
    booking_time: row.booking_time || null,
    target_dial_by: targetDialBy(booked ? row.booked_at : row.created_at),
    needs_work: row.done !== true,
    survey: surveySummary(cf),
    survey_edits: jsonObject(cf.setter_survey_edits),
    setter_handoff: handoff,
    setter_staff_id: handoff.setter_staff_id || row.setter_staff_id || staff.id,
    closer_staff_id: handoff.closer_staff_id || row.closer_staff_id || (staff.role === "owner" ? staff.id : null)
  });
}

export async function setterNumbers(db, staff, { now = new Date(), includeDemo = true } = {}) {
  const result = await db.query(
    `WITH bounds AS (
       SELECT date_trunc('day', $4::timestamptz AT TIME ZONE 'America/Phoenix')
                AT TIME ZONE 'America/Phoenix' AS day_start,
              (date_trunc('day', $4::timestamptz AT TIME ZONE 'America/Phoenix') + interval '1 day')
                AT TIME ZONE 'America/Phoenix' AS day_end
     ), attributed AS (
       SELECT c.id, c.custom_fields->'setter_handoff' AS handoff
         FROM clients c
        WHERE c.org_id = $1
          AND c.custom_fields->'setter_handoff'->>'setter_staff_id' = $2::text
          AND c.custom_fields->>'crm_archived_at' IS NULL
          AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
     )
     SELECT
       COALESCE((
         SELECT sum(CASE
           WHEN jsonb_typeof(a.handoff->'dial_attempt_days') = 'object'
             THEN COALESCE(NULLIF(a.handoff->'dial_attempt_days'->>
               to_char(x.day_start AT TIME ZONE 'America/Phoenix', 'YYYY-MM-DD'), '')::int, 0)
           WHEN NULLIF(a.handoff->>'dialed_at', '')::timestamptz >= x.day_start
            AND NULLIF(a.handoff->>'dialed_at', '')::timestamptz < x.day_end
             THEN COALESCE(NULLIF(a.handoff->>'call_attempts', '')::int, 0)
           ELSE 0
         END)
           FROM attributed a, bounds x
       ), 0)::int AS dials,
       COALESCE((
         SELECT count(DISTINCT b.id)
           FROM attributed a
           JOIN bookings b ON b.org_id = $1 AND b.client_id = a.id
           CROSS JOIN bounds x
          WHERE a.handoff->>'lead_type' = 'opt_in'
            AND b.status IN ('booked', 'rescheduled')
            AND b.created_at >= x.day_start AND b.created_at < x.day_end
       ), 0)::int AS booked,
       COALESCE((
         SELECT count(*) FILTER (WHERE o.outcome <> 'no_show')
           FROM attributed a
           JOIN call_outcomes o ON o.org_id = $1 AND o.client_id = a.id
           CROSS JOIN bounds x
          WHERE o.logged_at >= x.day_start AND o.logged_at < x.day_end
            AND ($3::boolean OR COALESCE(o.is_demo, false) = false)
       ), 0)::int AS showed,
       COALESCE((
         SELECT count(*) FILTER (WHERE o.outcome = 'no_show')
           FROM attributed a
           JOIN call_outcomes o ON o.org_id = $1 AND o.client_id = a.id
           CROSS JOIN bounds x
          WHERE o.logged_at >= x.day_start AND o.logged_at < x.day_end
            AND ($3::boolean OR COALESCE(o.is_demo, false) = false)
       ), 0)::int AS no_shows`,
    [staff.org_id, staff.id, includeDemo, now.toISOString()]
  );
  const row = result.rows[0] || {};
  const dials = Number(row.dials || 0);
  const booked = Number(row.booked || 0);
  const showed = Number(row.showed || 0);
  const noShows = Number(row.no_shows || 0);
  return {
    dials,
    booked,
    dial_to_book_rate: dials ? booked / dials : null,
    showed,
    no_shows: noShows,
    show_rate: showed + noShows ? showed / (showed + noShows) : null
  };
}

export async function listSetterQueue(db, staff, { limit = 50, offset = 0 } = {}) {
  const roleScoped = needsSetterAssignment(staff);
  const page = pageParams({ limit, offset });
  const result = await db.query(
    `WITH queue AS (
       SELECT DISTINCT ON (c.id)
            c.id AS client_id, c.first_name, c.last_name, c.email, c.phone, c.custom_fields,
            t.created_at, t.done,
            t.assignee_staff_id AS setter_staff_id,
            b.created_at AS booked_at, b.starts_at AS booking_time,
            ct.assignee_staff_id AS closer_staff_id
       FROM tasks t
       JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       LEFT JOIN LATERAL (
         SELECT created_at, starts_at FROM bookings
          WHERE org_id = t.org_id AND client_id = c.id AND status IN ('booked','rescheduled')
          ORDER BY created_at DESC LIMIT 1
       ) b ON true
       LEFT JOIN LATERAL (
         SELECT assignee_staff_id FROM tasks
          WHERE org_id = t.org_id AND client_id = c.id AND assignee_role = 'closer'
          ORDER BY created_at DESC LIMIT 1
       ) ct ON true
      WHERE t.org_id = $1 AND t.assignee_role = 'setter'
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND (t.done = false OR (
          c.custom_fields->'setter_handoff'->>'complete_at' IS NOT NULL
          AND t.created_at >= now() - interval '7 days'
        ))
        AND ($2::boolean = false OR t.assignee_staff_id IS NULL OR t.assignee_staff_id = $3)
        AND ($2::boolean = false OR NULLIF(c.custom_fields->'setter_handoff'->>'setter_staff_id','') IS NULL
          OR c.custom_fields->'setter_handoff'->>'setter_staff_id' = $3::text)
      ORDER BY c.id, t.created_at DESC
     )
     SELECT * FROM queue
      ORDER BY COALESCE(booked_at, created_at) DESC
      LIMIT $4 OFFSET $5`,
    [staff.org_id, roleScoped, staff.id, Math.min(page.limit, 100), page.offset]
  );
  // Each lead's own calendar, by the same score rule as its texts. Null = no answer
  // yet, so the screen falls back to the plain booking_url below.
  const items = result.rows.map(row => ({ ...mapItem(row, staff), booking_url: tierBookingLink(jsonObject(row.custom_fields)) }));
  const numbers = await setterNumbers(db, staff);
  return { items, count: items.length, numbers, booking_url: "https://apply.fundhub.ai/funding-book-call" };
}

export async function latestUndoableDial(db, staff) {
  const result = await db.query(
    `SELECT e.client_id, e.event_id, e.undo_until
       FROM setter_dial_events e
       JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
       LEFT JOIN LATERAL (
         SELECT id, assignee_staff_id FROM tasks
          WHERE org_id = e.org_id AND client_id = e.client_id AND assignee_role = 'setter'
          ORDER BY created_at DESC LIMIT 1
       ) t ON true
      WHERE e.org_id = $1 AND e.setter_staff_id = $2
        AND e.reversed_at IS NULL AND e.undo_blocked_at IS NULL AND e.undo_until > now()
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND c.custom_fields->'setter_handoff'->>'complete_at' IS NULL
        AND c.custom_fields->'setter_handoff'->>'disposition' IS DISTINCT FROM 'no_answer'
        AND COALESCE(NULLIF(c.custom_fields->'setter_handoff'->>'call_attempts', '')::int, 0) = e.attempt_after
        AND COALESCE(NULLIF(c.custom_fields->'setter_handoff'->'dial_attempt_days'->>(e.phoenix_day::text), '')::int, 0) = e.day_after
        AND NOT EXISTS (
          SELECT 1 FROM setter_dial_events later
           WHERE later.org_id = e.org_id AND later.client_id = e.client_id
             AND later.event_order > e.event_order AND later.reversed_at IS NULL
        )
        AND ($3::boolean = false OR (t.id IS NOT NULL
          AND (t.assignee_staff_id IS NULL OR t.assignee_staff_id = $2)
          AND c.custom_fields->'setter_handoff'->>'setter_staff_id' = $2::text))
      ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT 1`,
    [staff.org_id, staff.id, needsSetterAssignment(staff)]
  );
  return result.rows[0] || null;
}

export async function getSetterClient(db, orgId, clientId) {
  const result = await db.query(
    `SELECT c.id AS client_id, c.first_name, c.last_name, c.email, c.phone, c.custom_fields,
            b.created_at AS booked_at, b.starts_at AS booking_time,
            ct.assignee_staff_id AS closer_staff_id,
            st.created_at, st.done, st.assignee_staff_id AS setter_staff_id
       FROM clients c
       LEFT JOIN LATERAL (
         SELECT created_at, starts_at FROM bookings
          WHERE org_id = c.org_id AND client_id = c.id AND status IN ('booked','rescheduled')
          ORDER BY created_at DESC LIMIT 1
       ) b ON true
       LEFT JOIN LATERAL (
         SELECT assignee_staff_id FROM tasks
          WHERE org_id = c.org_id AND client_id = c.id AND assignee_role = 'closer'
          ORDER BY created_at DESC LIMIT 1
       ) ct ON true
       LEFT JOIN LATERAL (
         SELECT created_at, done, assignee_staff_id FROM tasks
          WHERE org_id = c.org_id AND client_id = c.id AND assignee_role = 'setter'
          ORDER BY created_at DESC LIMIT 1
       ) st ON true
      WHERE c.id = $1 AND c.org_id = $2
        AND c.custom_fields->>'crm_archived_at' IS NULL
      LIMIT 1`,
    [clientId, orgId]
  );
  return result.rows[0] || null;
}

async function persistHandoff(db, clientId, orgId, patch, expectedAttempts = null) {
  const result = await db.query(
    `UPDATE clients
        SET custom_fields = jsonb_set(
          COALESCE(custom_fields, '{}'::jsonb), '{setter_handoff}',
          COALESCE(custom_fields->'setter_handoff', '{}'::jsonb) || $3::jsonb, true)
      WHERE id = $1 AND org_id = $2
        AND ($4::int IS NULL OR COALESCE(NULLIF(custom_fields->'setter_handoff'->>'call_attempts', '')::int, 0) = $4)
      RETURNING custom_fields`,
    [clientId, orgId, JSON.stringify(patch), expectedAttempts]
  );
  return result.rows.length ? jsonObject(result.rows[0].custom_fields) : null;
}

async function persistSurveyEdits(db, clientId, orgId, edits) {
  const result = await db.query(
    `UPDATE clients
        SET custom_fields = jsonb_set(
          COALESCE(custom_fields, '{}'::jsonb), '{setter_survey_edits}', $3::jsonb, true)
      WHERE id = $1 AND org_id = $2
      RETURNING custom_fields->'setter_survey_edits' AS survey_edits`,
    [clientId, orgId, JSON.stringify(edits)]
  );
  return jsonObject(result.rows[0]?.survey_edits);
}

/* credit_tier on the person: "qualified" or "unqualified", the one word every
   screen and report reads (written when the survey is taken by
   src/handlers/client-lifecycle.mjs, and again here when a setter fixes the score). */
async function persistCreditTier(db, clientId, orgId, tier) {
  await db.query(
    `UPDATE clients
        SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('credit_tier', $3::text)
      WHERE id = $1 AND org_id = $2`,
    [clientId, orgId, tier]
  );
}

/* "No answer" starts the no-answer text cadence (AI-SET-03, trigger setter.no_answer).
   It starts when a save sets that result for the first time, or when the dial count
   went up (a fresh dial that again got no answer). Saving the same screen again
   changes neither, so it starts nothing. One event per lead per Arizona day: the
   second dial the same day finds the key taken and starts no second cadence.
   Runs after the save has succeeded, and a failure here logs a warning and never
   fails the save. */
async function startNoAnswerCadence(db, { orgId, clientId, previous, next, patch, setterStaffId }, deps) {
  if (patch.disposition !== "no_answer") return null;
  const attempts = Number(next.call_attempts || 0);
  if (previous.disposition === "no_answer" && !(attempts > Number(previous.call_attempts || 0))) return null;
  try {
    const at = (deps.now || (() => new Date()))();
    return await (deps.emit || emit)(
      db,
      "setter.no_answer",
      { disposition: "no_answer", setter_staff_id: setterStaffId, call_attempts: attempts },
      { orgId, clientId, idempotencyKey: `setter.no_answer:${clientId}:${phoenixDay(at instanceof Date ? at : new Date(at))}` }
    );
  } catch (error) {
    console.warn(`[setter] no-answer text cadence not started: ${error.message}`);
    return null;
  }
}

export async function updateSetterHandoff(db, staff, { client_id, action, handoff: input = {}, survey_edits, operation_id, event_id, expected_call_attempts }, deps = {}) {
  const transactionalDial = action === "undo_dial" || action === "log_dial";
  if (transactionalDial && !deps.dialTransaction) {
    const result = await withTransaction(db, writer => updateSetterHandoff(writer, staff,
      { client_id, action, handoff: input, survey_edits, operation_id, event_id },
      { ...deps, dialTransaction: true }));
    if (action === "log_dial" && result.status === 200 && !result.body.dial_event?.replayed) {
      await startNoAnswerCadence(db, {
        orgId: staff.org_id, clientId: client_id, previous: {},
        next: result.body.item.setter_handoff, patch: input,
        setterStaffId: result.body.item.setter_staff_id
      }, deps);
    }
    return result;
  }
  if (transactionalDial) {
    const locked = await db.query(
      `SELECT id FROM clients WHERE id = $1 AND org_id = $2
         AND custom_fields->>'crm_archived_at' IS NULL FOR UPDATE`,
      [client_id, staff.org_id]
    );
    if (!locked.rows.length) return { status: 404, body: { ok: false, error: "client_not_found" } };
  }
  const client = await getSetterClient(db, staff.org_id, client_id);
  if (!client) return { status: 404, body: { ok: false, error: "client_not_found" } };
  if (needsSetterAssignment(staff)) {
    const assigned = await db.query(
      `SELECT assignee_staff_id FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter'
        ORDER BY created_at DESC LIMIT 1`,
      [staff.org_id, client_id]
    );
    if (!assigned.rows[0] || (assigned.rows[0].assignee_staff_id && assigned.rows[0].assignee_staff_id !== staff.id)) {
      return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
    }
  }
  if (action === "undo_dial") {
    const eventResult = await db.query(
      `SELECT *, phoenix_day::text AS phoenix_day_text FROM setter_dial_events
        WHERE event_id = $1 AND org_id = $2 AND client_id = $3
          AND setter_staff_id = $4 FOR UPDATE`,
      [event_id, staff.org_id, client_id, staff.id]
    );
    const event = eventResult.rows[0];
    if (!event) return { status: 404, body: { ok: false, error: "dial_event_not_found" } };
    const fields = jsonObject(client.custom_fields);
    const handoff = jsonObject(fields.setter_handoff);
    if (needsSetterAssignment(staff) && handoff.setter_staff_id && handoff.setter_staff_id !== staff.id) {
      return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
    }
    const item = () => ({ ...mapItem(client, staff), booking_url: tierBookingLink(fields) });
    if (event.reversed_at) return { status: 200, body: { ok: true, item: item(), dial_event: { event_id, undone: true } } };
    if (handoff.complete_at) return { status: 409, body: { ok: false, error: "handoff_already_complete" } };
    if (handoff.disposition === "no_answer" || event.undo_blocked_at) {
      return { status: 409, body: { ok: false, error: "dial_undo_blocked_by_followup" } };
    }
    const now = (deps.now || (() => new Date()))();
    if (new Date(now) >= new Date(event.undo_until)) {
      return { status: 409, body: { ok: false, error: "dial_undo_expired" } };
    }
    const later = await db.query(
      `SELECT 1 FROM setter_dial_events
        WHERE org_id = $1 AND client_id = $2 AND event_order > $3
          AND reversed_at IS NULL LIMIT 1`,
      [staff.org_id, client_id, event.event_order]
    );
    const days = jsonObject(handoff.dial_attempt_days);
    const day = event.phoenix_day_text;
    if (later.rows.length || Number(handoff.call_attempts || 0) !== Number(event.attempt_after)
        || Number(days[day] || 0) !== Number(event.day_after)) {
      return { status: 409, body: { ok: false, error: "dial_undo_stale" } };
    }
    const restoredDays = { ...days };
    if (Number(event.day_before) === 0) delete restoredDays[day];
    else restoredDays[day] = Number(event.day_before);
    const savedFields = await persistHandoff(db, client_id, staff.org_id, {
      call_attempts: Number(event.attempt_before), dial_attempt_days: restoredDays,
      dialed_at: Number(event.attempt_before) === 0 ? (event.prior_dialed_at || null) : handoff.dialed_at
    });
    await db.query(
      `UPDATE setter_dial_events SET reversed_at = $2, reversed_by_staff_id = $3
        WHERE event_id = $1`, [event_id, new Date(now), staff.id]
    );
    await db.query(
      `INSERT INTO setter_dial_reversals (event_id, org_id, client_id, actor_staff_id, reversed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [event_id, staff.org_id, client_id, staff.id, new Date(now)]
    );
    return { status: 200, body: { ok: true,
      item: { ...mapItem({ ...client, custom_fields: savedFields }, staff), booking_url: tierBookingLink(savedFields) },
      dial_event: { event_id, undone: true }
    } };
  }
  if (action === "save_survey") {
    const previous = jsonObject(jsonObject(client.custom_fields).setter_handoff);
    if (needsSetterAssignment(staff) && previous.setter_staff_id && previous.setter_staff_id !== staff.id) {
      return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
    }
    if (!survey_edits || typeof survey_edits !== "object" || Array.isArray(survey_edits)) {
      return { status: 400, body: { ok: false, error: "invalid_survey_edits" } };
    }
    const visible = new Map(surveySummary(client.custom_fields).map(row => [row.key, row]));
    const previousEdits = jsonObject(jsonObject(client.custom_fields).setter_survey_edits);
    const edits = {};
    for (const [key, value] of Object.entries(survey_edits)) {
      const row = visible.get(key);
      if (!SURVEY_KEYS.has(key) || !row || typeof value !== "string" || value.length > 1000) {
        return { status: 400, body: { ok: false, error: "invalid_survey_edits" } };
      }
      const clean = value.trim();
      const choices = row.type === "multi" ? clean.split(", ").filter(Boolean) : [clean];
      const validChoice = row.type === "multi"
        ? choices.length === new Set(choices).size && choices.every(choice => row.options.includes(choice))
        : row.options.includes(clean);
      if (!validChoice && clean !== previousEdits[key]) {
        return { status: 400, body: { ok: false, error: "invalid_survey_edits" } };
      }
      edits[key] = clean;
    }
    if (needsSetterAssignment(staff)) {
      const claim = await db.query(
        `UPDATE tasks SET assignee_staff_id = $3, updated_at = now()
          WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter'
            AND (assignee_staff_id IS NULL OR assignee_staff_id = $3)
          RETURNING id`,
        [staff.org_id, client_id, staff.id]
      );
      if (!claim.rows.length) return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
    }
    return withTransaction(db, async writer => {
      const saved = await persistSurveyEdits(writer, client_id, staff.org_id, edits);
      // A corrected score moves the person's credit_tier. creditTierFor reads the fix
      // first; no readable score anywhere (null) leaves what is saved.
      const savedFields = jsonObject(client.custom_fields);
      const creditTier = creditTierFor({ ...savedFields, setter_survey_edits: saved });
      if (creditTier && savedFields.credit_tier !== creditTier) {
        await persistCreditTier(writer, client_id, staff.org_id, creditTier);
      }
      // Keep the saved call bucket in step with a setter correction. The booking
      // trigger and stamp preserve every booking that already has a bucket.
      await stampQualificationBucket(writer, client_id);
      if (previous.complete_at) {
        const closerStaffId = previous.closer_staff_id || client.closer_staff_id || (staff.role === "owner" ? staff.id : null);
        const closer = closerStaffId === staff.id ? staff : (await writer.query(
          `SELECT id, name FROM staff WHERE org_id = $1 AND id = $2 LIMIT 1`,
          [staff.org_id, closerStaffId]
        )).rows[0];
        const handoffText = (deps.buildText || buildSetterHandoffText)({
          client: { ...client, custom_fields: { ...jsonObject(client.custom_fields), setter_survey_edits: saved } },
          handoff: previous, booking: client, closer, setter: staff
        });
        await persistHandoff(writer, client_id, staff.org_id, { handoff_text: handoffText });
      }
      if (creditTier && savedFields.credit_tier !== creditTier) {
        await refreshPrecallForScore(writer,{orgId:staff.org_id,clientId:client_id,surveyEdits:saved},
          {now:(deps.now || (()=>new Date()))()});
      }
      // A corrected score can move the lead to the other calendar.
      const bookingUrl = tierBookingLink({ ...jsonObject(client.custom_fields), setter_survey_edits: saved });
      return { status: 200, body: { ok: true, survey_edits: saved, booking_url: bookingUrl } };
    });
  }
  const validated = sanitizeHandoffPatch(input);
  if (validated.error) return { status: 400, body: { ok: false, error: validated.error } };
  const previous = jsonObject(jsonObject(client.custom_fields).setter_handoff);
  if (expected_call_attempts != null && (!Number.isInteger(expected_call_attempts) || expected_call_attempts < 0 || expected_call_attempts > 20)) {
    return { status: 400, body: { ok: false, error: "invalid_expected_call_attempts" } };
  }
  const countWasEdited = Object.hasOwn(validated.patch, "call_attempts")
    && validated.patch.call_attempts !== (expected_call_attempts ?? Number(previous.call_attempts || 0));
  // Cached clients lack the baseline needed to tell a manual edit from a
  // stale echo. Reject divergent counts rather than erasing a logged dial.
  if (action !== "log_dial" && countWasEdited && expected_call_attempts == null) {
    return { status: 409, body: { ok: false, error: "handoff_dial_count_changed" } };
  }
  if (action !== "log_dial" && expected_call_attempts != null
      && countWasEdited && Number(previous.call_attempts || 0) !== expected_call_attempts) {
    return { status: 409, body: { ok: false, error: "handoff_dial_count_changed" } };
  }
  if (action === "complete" && expected_call_attempts != null
      && Number(previous.call_attempts || 0) !== expected_call_attempts) {
    return { status: 409, body: { ok: false, error: "handoff_dial_count_changed" } };
  }
  if (needsSetterAssignment(staff) && previous.setter_staff_id && previous.setter_staff_id !== staff.id) {
    return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
  }
  if (action === "log_dial" && operation_id) {
    const existing = await db.query(
      `SELECT event_id, client_id, undo_until, reversed_at FROM setter_dial_events
        WHERE org_id = $1 AND setter_staff_id = $2 AND operation_id = $3`,
      [staff.org_id, staff.id, operation_id]
    );
    const event = existing.rows[0];
    if (event) {
      if (event.client_id !== client_id) {
        return { status: 409, body: { ok: false, error: "dial_operation_conflict" } };
      }
      return { status: 200, body: { ok: true,
        item: { ...mapItem(client, staff), booking_url: tierBookingLink(jsonObject(client.custom_fields)) },
        dial_event: { event_id: event.event_id, undo_until: event.undo_until,
          undone: !!event.reversed_at, replayed: true }
      } };
    }
  }
  const leadType = previous.lead_type || (client.booked_at ? "booked" : "opt_in");
  const setterStaffId = previous.setter_staff_id || staff.id;
  let closerStaffId = previous.closer_staff_id || client.closer_staff_id || (staff.role === "owner" ? staff.id : null);
  if (!closerStaffId) {
    const owner = await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`,
      [staff.org_id]
    );
    closerStaffId = owner.rows[0]?.id || null;
  }
  const next = {
    ...previous, ...validated.patch,
    lead_type: leadType,
    setter_staff_id: setterStaffId,
    closer_staff_id: closerStaffId,
    setter_name: previous.setter_staff_id && previous.setter_staff_id !== staff.id
      ? previous.setter_name || ""
      : staff.name || staff.first_name || ""
  };
  let dialEvent = null;
  let dialDay = null;
  // The UI includes the currently selected result on unrelated autosaves. Only
  // a changed result records a new conversation; restamping an old "reached"
  // would suppress texts after a newer unanswered voice call.
  const dispositionSaved = Object.hasOwn(validated.patch, "disposition")
    && validated.patch.disposition !== previous.disposition;
  let actionDate = null;
  if (dispositionSaved || action === "log_dial") {
    const at = (deps.now || (() => new Date()))();
    actionDate = at instanceof Date ? at : new Date(at);
    if (!Number.isFinite(actionDate.getTime())) {
      return { status: 500, body: { ok: false, error: "dial_time_unavailable" } };
    }
  }
  if (dispositionSaved) next.disposition_at = actionDate.toISOString();
  if (action === "log_dial") {
    const day = phoenixDay(actionDate);
    dialDay = day;
    const days = jsonObject(previous.dial_attempt_days);
    next.call_attempts = Number(previous.call_attempts || 0) + 1;
    next.dialed_at = previous.dialed_at || actionDate.toISOString();
    next.dial_attempt_days = { ...days, [day]: Number(days[day] || 0) + 1 };
  }
  if (action === "complete") next.complete_at = previous.complete_at || new Date().toISOString();
  if (next.complete_at) {
    const missing = missingForCompletion(next, client);
    if (missing.length) return { status: 400, body: { ok: false, error: "handoff_incomplete", missing } };
    const closer = closerStaffId === staff.id ? staff : (await db.query(
      `SELECT id, name FROM staff WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [staff.org_id, closerStaffId]
    )).rows[0];
    next.handoff_text = (deps.buildText || buildSetterHandoffText)({ client, handoff: next, booking: client, closer, setter: staff });
  }
  if (needsSetterAssignment(staff)) {
    const claim = await db.query(
      `UPDATE tasks SET assignee_staff_id = $3, updated_at = now()
        WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter'
          AND (assignee_staff_id IS NULL OR assignee_staff_id = $3)
        RETURNING id`,
      [staff.org_id, client_id, staff.id]
    );
    if (!claim.rows.length) return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
  }
  const save = async (writer) => {
    const writePatch = action === "log_dial" ? next : {
      ...validated.patch,
      lead_type: leadType, setter_staff_id: setterStaffId,
      closer_staff_id: closerStaffId, setter_name: next.setter_name,
      ...(action === "complete" ? { complete_at: next.complete_at } : {}),
      ...(next.handoff_text ? { handoff_text: next.handoff_text } : {})
    };
    if (dispositionSaved) writePatch.disposition_at = next.disposition_at;
    // The checklist echoes the visible count on every Save. An unchanged echo
    // must not overwrite a dial committed after the client was read above.
    if (action !== "log_dial" && !countWasEdited) {
      delete writePatch.call_attempts;
    }
    if (action !== "log_dial" && writePatch.dialed_at === previous.dialed_at) {
      delete writePatch.dialed_at;
    }
    const countEdit = action !== "log_dial" && Object.hasOwn(writePatch, "call_attempts");
    const noAnswerSave = action === "save" && validated.patch.disposition === "no_answer";
    let savedFields = await persistHandoff(writer, client_id, staff.org_id, writePatch,
      countEdit || noAnswerSave || action === "complete" ? Number(previous.call_attempts || 0) : null);
    if (!savedFields) return { status: 409, body: { ok: false, error: "handoff_dial_count_changed" } };
    if (action !== "log_dial" && validated.patch.disposition === "no_answer") {
      // The text cadence runs after Save. Block Undo first and keep that fact
      // even if the disposition is edited again later.
      await writer.query(
        `UPDATE setter_dial_events SET undo_blocked_at = now()
          WHERE org_id = $1 AND client_id = $2 AND reversed_at IS NULL
            AND undo_blocked_at IS NULL AND undo_until > now()`,
        [staff.org_id, client_id]
      );
    }
    let saved = jsonObject(savedFields.setter_handoff);
    let send = null;
    if (action === "log_dial" && operation_id) {
      const inserted = await writer.query(
        `INSERT INTO setter_dial_events
          (org_id, client_id, setter_staff_id, operation_id, occurred_at, phoenix_day,
           attempt_before, attempt_after, day_before, day_after, prior_dialed_at, undo_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 CASE WHEN $12::boolean THEN '1970-01-01T00:00:00Z'::timestamptz
                   ELSE $5::timestamptz + interval '10 minutes' END)
         RETURNING event_id, undo_until`,
        [staff.org_id, client_id, staff.id, operation_id, actionDate, dialDay,
          Number(previous.call_attempts || 0), Number(next.call_attempts),
          Number(jsonObject(previous.dial_attempt_days)[dialDay] || 0),
          Number(jsonObject(next.dial_attempt_days)[dialDay]), previous.dialed_at || null,
          next.disposition === "no_answer"]
      );
      dialEvent = inserted.rows[0];
    }
    if (action === "send_intro_video" || action === "send_handoff") {
      if (action === "send_handoff" && !saved.complete_at) {
        return { status: 400, body: { ok: false, error: "handoff_incomplete", missing: ["complete_at"] } };
      }
      if (action === "send_handoff") {
        const missing = missingForCompletion(saved, client);
        if (missing.length) return { status: 400, body: { ok: false, error: "handoff_incomplete", missing } };
      }
      send = await (deps.sendAction || performSetterSendAction)({
        action, client: { ...client, booking_time: client.booking_time, booked_at: client.booked_at },
        handoff: saved, staff, db: writer, orgId: staff.org_id, setterStaffId, closerStaffId
      });
      if (send?.handoffPatch && typeof send.handoffPatch === "object") {
        savedFields = await persistHandoff(writer, client_id, staff.org_id, send.handoffPatch);
        saved = jsonObject(savedFields.setter_handoff);
      }
    }
    if (action === "complete") {
      const stage = await (deps.advanceStage || advanceCardToStage)(writer, {
        orgId: staff.org_id, clientId: client_id, pipelineKey: "sales", stageKey: "confirmed"
      });
      if (!stage.moved && stage.reason !== "already_at_or_past") {
        throw new Error(`setter_set_stage_failed:${stage.reason || "unknown"}`);
      }
      if (stage.moved) {
        await writer.query(
          `UPDATE cards cd SET entered_at = $3::timestamptz
             FROM pipelines p
            WHERE cd.pipeline_id = p.id AND cd.org_id = p.org_id
              AND p.org_id = $1 AND p.key = 'sales' AND cd.client_id = $2`,
          [staff.org_id, client_id, saved.complete_at]
        );
      }
      await writer.query(
        `UPDATE tasks SET done = true, updated_at = now()
          WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter' AND done = false`,
        [staff.org_id, client_id]
      );
    }
    return { status: 200, body: { ok: true, item: { ...mapItem({ ...client, done: !!saved.complete_at, setter_staff_id: setterStaffId, closer_staff_id: closerStaffId, custom_fields: savedFields }, staff), booking_url: tierBookingLink(savedFields) }, ...(send ? { send } : {}), ...(dialEvent ? { dial_event: dialEvent } : {}) } };
  };
  const result = action === "complete" || (action === "save" && validated.patch.disposition === "no_answer")
    ? await withTransaction(db, save) : await save(db);
  if (result.status === 200 && !transactionalDial) {
    await startNoAnswerCadence(db, {
      orgId: staff.org_id, clientId: client_id, previous, next, patch: validated.patch, setterStaffId
    }, deps);
  }
  if (action === "complete" && result.status === 200) {
    try {
      const updatedClient = await getSetterClient(db, staff.org_id, client_id);
      await (deps.closerAlert || queueCloserSetAlert)(db, {
        orgId: staff.org_id, clientId: client_id, closerStaffId, setterStaffId,
        client: updatedClient || client, handoff: result.body.item.setter_handoff, startTime: client.booking_time
      });
    } catch (error) {
      console.warn(`[setter] closer set alert failed: ${error.message}`);
    }
  }
  return result;
}
