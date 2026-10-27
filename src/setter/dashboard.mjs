import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";
import { redact, pageParams } from "../http/read-api.mjs";
import { buildSetterHandoffText, performSetterSendAction } from "./send-actions.mjs";

const HANDOFF_FIELDS = new Set([
  "lead_type", "dialed_at", "call_attempts", "disposition", "voicemail_left",
  "missed_text_sent", "time_confirmed", "frame_warmed", "problem", "goal",
  "computer_ready", "app_on_phone", "triage_personal_or_business",
  "triage_problem", "triage_goal"
]);
const BOOL_FIELDS = new Set(["voicemail_left", "missed_text_sent", "time_confirmed", "frame_warmed", "computer_ready", "app_on_phone"]);
const TEXT_FIELDS = new Set(["problem", "goal", "triage_problem", "triage_goal"]);
const DISPOSITIONS = new Set(["reached", "no_answer", "reschedule", "booked_on_call"]);
const FORBIDDEN_CLAIM = /\b(?:social security(?: number)?|ssn|pre[ -]?approved|approved for|qualif(?:y|ied) for|credit (?:was|has been|already) pulled)\b|\b\d{3}-\d{2}-\d{4}\b/i;

function jsonObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
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
    const answer = Array.isArray(value) ? value.join(", ") : String(value ?? "").trim();
    return answer ? { question: q.title, answer } : null;
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
      if (!["", "personal", "business"].includes(value)) return { error: "invalid triage type" };
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
    setter_handoff: handoff,
    setter_staff_id: handoff.setter_staff_id || row.setter_staff_id || staff.id,
    closer_staff_id: handoff.closer_staff_id || row.closer_staff_id || (staff.role === "owner" ? staff.id : null)
  });
}

export async function listSetterQueue(db, staff, { limit = 50, offset = 0 } = {}) {
  const roleScoped = staff.role === "setter";
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
        AND (t.done = false OR (
          c.custom_fields->'setter_handoff'->>'complete_at' IS NOT NULL
          AND t.created_at >= now() - interval '7 days'
        ))
        AND ($2::boolean = false OR t.assignee_staff_id IS NULL OR t.assignee_staff_id = $3)
      ORDER BY c.id, t.created_at DESC
     )
     SELECT * FROM queue
      ORDER BY COALESCE(booked_at, created_at) DESC
      LIMIT $4 OFFSET $5`,
    [staff.org_id, roleScoped, staff.id, Math.min(page.limit, 100), page.offset]
  );
  const items = result.rows.map(row => mapItem(row, staff));
  return { items, count: items.length, booking_url: "https://apply.fundhub.ai/funding-book-call" };
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
      WHERE c.id = $1 AND c.org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  return result.rows[0] || null;
}

async function persistHandoff(db, clientId, orgId, patch) {
  const result = await db.query(
    `UPDATE clients
        SET custom_fields = jsonb_set(
          COALESCE(custom_fields, '{}'::jsonb), '{setter_handoff}',
          COALESCE(custom_fields->'setter_handoff', '{}'::jsonb) || $3::jsonb, true)
      WHERE id = $1 AND org_id = $2
      RETURNING custom_fields->'setter_handoff' AS setter_handoff`,
    [clientId, orgId, JSON.stringify(patch)]
  );
  return jsonObject(result.rows[0]?.setter_handoff);
}

export async function updateSetterHandoff(db, staff, { client_id, action, handoff: input = {} }, deps = {}) {
  const client = await getSetterClient(db, staff.org_id, client_id);
  if (!client) return { status: 404, body: { ok: false, error: "client_not_found" } };
  if (staff.role === "setter") {
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
  const validated = sanitizeHandoffPatch(input);
  if (validated.error) return { status: 400, body: { ok: false, error: validated.error } };
  const previous = jsonObject(jsonObject(client.custom_fields).setter_handoff);
  if (staff.role === "setter" && previous.setter_staff_id && previous.setter_staff_id !== staff.id) {
    return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
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
    setter_name: staff.name || staff.first_name || ""
  };
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
  if (staff.role === "setter") {
    const claim = await db.query(
      `UPDATE tasks SET assignee_staff_id = $3, updated_at = now()
        WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter'
          AND (assignee_staff_id IS NULL OR assignee_staff_id = $3)
        RETURNING id`,
      [staff.org_id, client_id, staff.id]
    );
    if (!claim.rows.length) return { status: 403, body: { ok: false, error: "assigned_to_other_setter" } };
  }
  let saved = await persistHandoff(db, client_id, staff.org_id, next);
  let send = null;
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
      handoff: saved, staff, db, orgId: staff.org_id, setterStaffId, closerStaffId
    });
    if (send?.handoffPatch && typeof send.handoffPatch === "object") {
      saved = await persistHandoff(db, client_id, staff.org_id, send.handoffPatch);
    }
  }
  if (action === "complete") {
    await db.query(
      `UPDATE tasks SET done = true, updated_at = now()
        WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter' AND done = false`,
      [staff.org_id, client_id]
    );
  }
  return { status: 200, body: { ok: true, item: { ...mapItem({ ...client, done: !!saved.complete_at, setter_staff_id: setterStaffId, closer_staff_id: closerStaffId, custom_fields: { ...jsonObject(client.custom_fields), setter_handoff: saved } }, staff) }, ...(send ? { send } : {}) } };
}
