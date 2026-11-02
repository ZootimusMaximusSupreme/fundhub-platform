// Read-only, role-scoped companion feed. Null means a number was not measured.
import { computePulse } from "../ops/pulse.mjs";
import { setterNumbers } from "../setter/dashboard.mjs";
import { closerMyNumbers, localDateString } from "../sales/metrics.mjs";
import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";
import { salesFloor } from "../sales/metrics.mjs";
import { readOutreach } from "../outreach/store.mjs";
import { readClientProgress } from "../progress/read.mjs";
import { listClientLibrary } from "../documents/retrieve.mjs";
import { listOpenIncidents } from "../pulse/records.mjs";
import { asStaff } from "../partners/rls.mjs";
import { AD_TODAY_SQL } from "../lib/ad-account-day.mjs";

const STAFF_ROLES = new Set([
  "owner", "admin", "sales_manager", "setter", "closer", "outbound_rep",
  "inquiry_specialist", "funding_advisor", "csm"
]);
const ROLE_HREF = {
  owner: "/app/ops-admin.html", admin: "/app/ops-admin.html",
  sales_manager: "/app/sales-floor.html", setter: "/app/setter-dashboard.html",
  closer: "/app/closer-dashboard.html", outbound_rep: "/app/bank-outreach.html",
  inquiry_specialist: "/app/inquiry-remover.html",
  funding_advisor: "/app/pipeline.html", csm: "/app/csm-queue.html"
};
const COMPANY = {
  new_clients: ["New clients", "count"], booked_calls: ["Booked calls", "count"],
  show_rate: ["Show rate", "ratio"], close_rate: ["Close rate", "ratio"],
  cash_cents: ["Cash collected", "cents"], funded_count: ["Funded files", "count"],
  funded_dollars_cents: ["Funded amount", "cents"],
  cost_per_funded_cents: ["Cost per funded", "cents"]
};

function metric(key, label, value, unit, period, asOf, reason = null) {
  const numeric = value == null ? null : Number(value);
  const valid = numeric != null && Number.isFinite(numeric);
  return {
    key, label, value: valid ? numeric : null, unit, period, asOf,
    unavailableReason: valid ? null : (reason || "source_unavailable")
  };
}
function item(id, title, detail, dueAt, href, urgency = "normal") {
  return { id: String(id), title: String(title), detail: detail || null,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null, href, urgency };
}
function urgencyFor(dueAt, now) {
  if (!dueAt) return "normal";
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return "normal";
  if (due < now.getTime()) return "urgent";
  if (due < now.getTime() + 24 * 60 * 60 * 1000) return "due";
  return "normal";
}
const URGENCY_ORDER = { urgent: 0, due: 1, normal: 2 };
const OWNER_ITEM_ORDER = { approval: 0, incident: 1, workflow: 2, agent: 3, staff: 4, pulse: 5, task: 6 };
function sortItems(items, role) {
  items.sort((a, b) => {
    const urgency = (URGENCY_ORDER[a.urgency] ?? 2) - (URGENCY_ORDER[b.urgency] ?? 2);
    if (urgency) return urgency;
    if (role === "owner" || role === "admin") {
      const source = (OWNER_ITEM_ORDER[a.id.split(":")[0]] ?? 9) - (OWNER_ITEM_ORDER[b.id.split(":")[0]] ?? 9);
      if (source) return source;
    }
    return (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) -
      (b.dueAt ? new Date(b.dueAt).getTime() : Infinity);
  });
}
export function staffRoles(staff) {
  const primary = String(staff?.role || "").toLowerCase().trim();
  const raw = Array.isArray(staff?.roles) ? staff.roles : [staff?.role];
  const roles = [...new Set(raw.map(r => String(r || "").toLowerCase().trim())
    .filter(r => STAFF_ROLES.has(r) && (r === primary || !["owner", "admin"].includes(r))))];
  // A multi-role session can add duties, but cannot hide its primary role.
  if (STAFF_ROLES.has(primary) && !roles.includes(primary)) roles.unshift(primary);
  return roles;
}

async function roleTasks(db, staff, role, now) {
  const result = await db.query(
    `WITH scoped AS (
       SELECT t.id, t.client_id, t.title, t.detail, t.due_at, t.created_at
         FROM tasks t
         LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
        WHERE t.org_id = $1 AND t.assignee_role = $2 AND t.done = false
          AND (t.assignee_staff_id IS NULL OR t.assignee_staff_id = $3)
          AND (t.client_id IS NULL OR (c.id IS NOT NULL AND c.custom_fields->>'crm_archived_at' IS NULL))
     ), tally AS (SELECT count(*)::int AS total FROM scoped),
     top AS (SELECT * FROM scoped ORDER BY due_at ASC NULLS LAST, created_at ASC LIMIT 4)
     SELECT tally.total, top.id, top.client_id, top.title, top.detail, top.due_at
       FROM tally LEFT JOIN top ON true`,
    [staff.org_id, role, staff.id]
  );
  const total = result.rows[0]?.total;
  const href = ROLE_HREF[role] || "/app/";
  return {
    total: total == null ? null : Number(total),
    items: result.rows.filter(row => row.id).map(row => item(
      `task:${row.id}`, row.title || "Open task", row.detail, row.due_at,
      row.client_id ? `${href}?id=${encodeURIComponent(row.client_id)}` : href,
      urgencyFor(row.due_at, now)
    ))
  };
}

async function settled(fn, fallback) {
  try { return { value: await fn(), failed: false }; }
  catch { return { value: fallback, failed: true }; }
}

// An owner-only count of all approval rows. The transaction supplies the same
// staff RLS context used by each source screen; every arm also binds the org.
export async function ownerApprovals(orgId, asStaffFn = asStaff) {
  return asStaffFn(async tx => {
    const result = await tx.query(`WITH pending AS (
      SELECT 'video'::text AS source, id::text AS id,
             ('Ad ' || ad_id || ' take ' || take_no)::text AS title,
             approval_expires_at AS due_at, updated_at AS waiting_since
        FROM ad_videos WHERE org_id = $1::uuid AND status = 'awaiting_approval'
      UNION ALL
      SELECT 'campaign', id::text, name, NULL::timestamptz, updated_at
        FROM campaigns WHERE org_id = $1::uuid AND approval_state = 'awaiting_approval'
      UNION ALL
      SELECT 'social', id::text, 'Social post', NULL::timestamptz, updated_at
        FROM social_posts WHERE org_id = $1::uuid AND status = 'awaiting_approval'
    ), tally AS (SELECT count(*)::int AS total FROM pending),
       top AS (SELECT * FROM pending ORDER BY waiting_since ASC LIMIT 4)
    SELECT tally.total, top.source, top.id, top.title, top.due_at
      FROM tally LEFT JOIN top ON true`, [orgId]);
    return { total: Number(result.rows[0]?.total ?? 0), rows: result.rows.filter(r => r.id) };
  });
}

async function ownerAgentFailures(db, orgId, now) {
  const result = await db.query(`WITH failures AS (
    SELECT id, agent_code, outcome, created_at FROM agent_runs
     WHERE org_id = $1::uuid AND created_at >= $2::timestamptz - interval '24 hours'
       AND outcome IN ('model_error', 'error', 'failed')
  ), tally AS (SELECT count(*)::int AS total FROM failures),
     top AS (SELECT * FROM failures ORDER BY created_at DESC LIMIT 3)
  SELECT tally.total, top.id, top.agent_code, top.outcome, top.created_at
    FROM tally LEFT JOIN top ON true`, [orgId, now.toISOString()]);
  return { total: Number(result.rows[0]?.total ?? 0), rows: result.rows.filter(r => r.id) };
}

async function ownerFailedEvents(db, orgId) {
  const result = await db.query(`SELECT count(*)::int AS total
    FROM failed_events WHERE org_id = $1::uuid AND status IN ('pending','exhausted')`, [orgId]);
  return Number(result.rows[0]?.total ?? 0);
}

async function ownerAdMetricRows(db, orgId) {
  const result = await db.query(`SELECT count(*)::int AS total FROM ad_metrics_daily
    WHERE org_id = $1::uuid AND date >= (${AD_TODAY_SQL} - 6)`, [orgId]);
  return Number(result.rows[0]?.total ?? 0);
}

async function staffSection(db, staff, role, now, missing, shared) {
  const asOf = now.toISOString();
  const contexts = { owner: "operations", admin: "operations", sales_manager: "sales",
    setter: "setter", closer: "closer", inquiry_specialist: "credit-repair",
    funding_advisor: "onboarding", csm: "client-success" };
  const section = { role, metrics: [], items: [] };
  if (contexts[role]) section.sopHref = `/app/company-brain.html?sop=${contexts[role]}`;
  const tasks = await settled(() => roleTasks(db, staff, role, now), { total: null, items: [] });
  section.metrics.push(metric("open_tasks", "Open tasks", tasks.value.total, "count", "now", asOf,
    tasks.failed ? "task_read_failed" : "task_count_unavailable"));
  section.items.push(...tasks.value.items);
  if (tasks.failed) missing.push(`${role}:tasks`);

  if (role === "owner" || role === "admin") {
    const [pulse, incidents, agents, failedEvents, approvals, floor, adRows] = await Promise.all([
      settled(() => computePulse(db, { orgId: staff.org_id, period: "7d", now }), null),
      settled(() => listOpenIncidents(db, staff.org_id), null),
      settled(() => ownerAgentFailures(db, staff.org_id, now), null),
      settled(() => ownerFailedEvents(db, staff.org_id), null),
      settled(() => ownerApprovals(staff.org_id), null),
      (shared.floor ??= settled(() => salesFloor(db, { orgId: staff.org_id, now }), null)),
      settled(() => ownerAdMetricRows(db, staff.org_id), null)
    ]);
    for (const [key, [label, unit]] of Object.entries(COMPANY)) {
      const source = pulse.value?.company_8?.[key];
      section.metrics.push(metric(key, label, source?.value, unit, "7d", asOf,
        pulse.failed ? "pulse_read_failed" : source?.reason || "not_measured"));
    }
    if (pulse.failed) missing.push(`${role}:pulse`);
    for (const [index, gap] of (pulse.value?.gaps?.short || []).slice(0, 4).entries()) {
      section.items.push(item(`pulse:${index}:${gap.seat}:${gap.metric}`,
        `${gap.seat || "Company"}: ${gap.metric || "gap"}`,
        gap.reason || (gap.actual != null && gap.target != null ? `${gap.actual} of ${gap.target}` : null),
        null, ROLE_HREF[role], "urgent"));
    }
    const spend = pulse.value?.marketing;
    const spendVerified = !pulse.failed && !adRows.failed && adRows.value > 0;
    const spendReason = pulse.failed ? "pulse_read_failed" : adRows.failed ? "ad_metrics_read_failed"
      : adRows.value === 0 ? "no_ad_metric_rows" : spend?.spend_status || "not_measured";
    section.metrics.push(metric("ad_spend_cents", "Ad spend", spendVerified ? spend?.spend_cents : null,
      "cents", "7d", asOf, spendReason));
    section.metrics.push(metric("cost_per_booked_cents", "Cost per booked person",
      spendVerified ? spend?.cost_per_booked?.cost_cents : null, "cents", "7d", asOf,
      spendVerified ? spend?.cost_per_booked?.note : spendReason));
    if (!spendVerified || spend?.spend_cents == null) missing.push(`${role}:ad_spend_unverified`);

    const incidentRows = incidents.value?.ok ? incidents.value.rows : null;
    section.metrics.push(metric("open_pulse_incidents", "Open heartbeat incidents",
      incidentRows && incidentRows.length < 200 ? incidentRows.length : null,
      "count", "now", asOf,
      incidents.failed || incidents.value?.ok === false ? "pulse_incidents_read_failed" : "incident_list_capped"));
    if (!incidentRows) missing.push(`${role}:heartbeat_incidents`);
    for (const incident of (incidentRows || []).slice(0, 3)) {
      section.items.push(item(`incident:${incident.id}`, `Heartbeat: ${incident.beat_id}`,
        incident.first_step || "Pulse incident open", null,
        ROLE_HREF[role], "urgent"));
    }

    section.metrics.push(metric("ai_run_errors", "AI run errors", agents.value?.total,
      "count", "24h", asOf, agents.failed ? "agent_runs_read_failed" : "not_measured"));
    if (agents.failed) missing.push(`${role}:agent_runs`);
    for (const run of (agents.value?.rows || [])) {
      section.items.push(item(`agent:${run.id}`, `AI run: ${run.agent_code || "unknown agent"}`,
        run.outcome, null, "/app/agent-editor.html", "urgent"));
    }
    section.metrics.push(metric("failed_workflow_events", "Failed workflow events", failedEvents.value,
      "count", "now", asOf, failedEvents.failed ? "failed_events_read_failed" : "not_measured"));
    if (failedEvents.failed) missing.push(`${role}:failed_events`);
    if (failedEvents.value > 0) section.items.push(item("workflow:failures", "Workflow failures need review",
      `${failedEvents.value} open`, null, "/app/ops-admin.html", "urgent"));

    section.metrics.push(metric("approvals_waiting", "Approvals waiting", approvals.value?.total,
      "count", "now", asOf, approvals.failed ? "approvals_read_failed" : "not_measured"));
    if (approvals.failed) missing.push(`${role}:approvals`);
    const approvalHref = { video: "/app/marketing-command-center.html",
      campaign: "/app/campaign-manager.html", social: "/app/social-studio.html" };
    for (const approval of (approvals.value?.rows || [])) {
      section.items.push(item(`approval:${approval.source}:${approval.id}`,
        approval.title || "Approval waiting", approval.source,
        approval.due_at, approvalHref[approval.source] || ROLE_HREF[role], "urgent"));
    }

    const discipline = floor.value?.discipline;
    for (const [key, label] of [["unlogged_calls", "Calls not logged"], ["unrecorded_calls", "Calls not recorded"]]) {
      section.metrics.push(metric(key, label, discipline?.[key], "count", "now", asOf,
        floor.failed ? "sales_floor_read_failed" : "not_measured"));
      if (discipline?.[key] > 0) section.items.push(item(`staff:${key}`, label,
        `${discipline[key]} need review`, null, "/app/sales-floor.html", "urgent"));
    }
    section.metrics.push(metric("late_shifts", "Late shifts", discipline?.shifts_started_late,
      "count", "now", asOf, floor.failed ? "sales_floor_read_failed" : "shift_schedule_not_recorded"));
    if (floor.failed) missing.push(`${role}:staff_performance`);
    if (discipline?.shifts_started_late == null) missing.push(`${role}:late_shifts_not_measured`);
    for (const closer of (floor.value?.closers || []).filter(c => c.action && !c.action.startsWith("Leave them alone")).slice(0, 3)) {
      section.items.push(item(`staff:closer:${closer.staff_id}`, closer.name || "Closer needs review",
        closer.action, null, "/app/sales-floor.html", "urgent"));
    }
  } else if (role === "setter") {
    const result = await settled(() => setterNumbers(db, staff), null);
    for (const [key, label] of [["dials", "Dials today"], ["booked", "Booked today"], ["showed", "Showed today"]]) {
      section.metrics.push(metric(key, label, result.value?.[key], "count", "today", asOf,
        result.failed ? "setter_read_failed" : "not_measured"));
    }
    if (result.failed) missing.push("setter:numbers");
  } else if (role === "closer") {
    const [numbers, next] = await Promise.all([
      settled(() => closerMyNumbers(db, { orgId: staff.org_id, staffId: staff.id, now }), null),
      settled(() => closerDayCalendar(db, { orgId: staff.org_id, staffId: staff.id, now }), null)
    ]);
    section.metrics.push(metric("deposits", "Deposits", numbers.value?.pace?.deposits, "count", "this_month", asOf,
      numbers.failed ? "closer_read_failed" : "not_measured"));
    section.metrics.push(metric("cash_cents", "Cash collected", numbers.value?.pace?.cash_cents, "cents", "this_month", asOf,
      numbers.failed ? "closer_read_failed" : "not_measured"));
    if (numbers.failed) missing.push("closer:numbers");
    if (next.failed) missing.push("closer:calendar");
    section.calendar = next.failed
      ? {...closerDayWindow(now),status:"unavailable",asOf,viewer:{orgId:staff.org_id,staffId:staff.id},nextCallId:null,calls:null}
      : next.value;
    for (const call of next.value?.calls || []) {
      section.items.push(item(`call:${call.taskId}`,call.title,call.name,call.startsAt,
        call.clientHref,urgencyFor(call.startsAt,now)));
    }
  } else if (role === "sales_manager") {
    const floor = await (shared.floor ??= settled(() => salesFloor(db, { orgId: staff.org_id, now }), null));
    section.metrics.push(metric("team_cash_cents", "Team cash", floor.value?.hero?.cash_cents,
      "cents", "this_month", asOf, floor.failed ? "sales_floor_read_failed" : "not_measured"));
    section.metrics.push(metric("deposits_today", "Deposits today", floor.value?.today?.deposits,
      "count", "today", asOf, floor.failed ? "sales_floor_read_failed" : "not_measured"));
    if (floor.failed) missing.push("sales_manager:floor");
  } else if (role === "outbound_rep") {
    const outreach = await settled(() => readOutreach(db, { staff, query: { limit: 4 } }), null);
    section.metrics.push(metric("due_now", "Bank follow-ups due", outreach.value?.summary?.due_now,
      "count", "now", asOf, outreach.failed ? "outreach_read_failed" : "not_measured"));
    section.metrics.push(metric("replies_waiting", "Bank replies waiting", outreach.value?.summary?.replies_waiting,
      "count", "now", asOf, outreach.failed ? "outreach_read_failed" : "not_measured"));
    if (outreach.failed) missing.push("outbound_rep:outreach");
    for (const account of (outreach.value?.items || []).filter(a => a.next_due_at && new Date(a.next_due_at) <= now).slice(0, 4)) {
      section.items.unshift(item(`bank:${account.id}`, account.name || "Bank follow-up",
        account.next_action || null, account.next_due_at,
        `/app/bank-outreach.html?id=${encodeURIComponent(account.id)}`, urgencyFor(account.next_due_at, now)));
    }
  }
  // For specialist, funding and CSM, open tasks are the verified role queue.
  // Other production KPIs remain outside this read until a role-scoped source exists.
  sortItems(section.items, role);
  return section;
}

// Staff-only calendar detail. The Widget stores only its existing count whitelist.
const HANDOFF_DETAIL_KEYS = ["problem","goal","computer_ready","time_confirmed","frame_warmed",
  "app_on_phone","triage_personal_or_business","triage_problem","triage_goal","employment_status",
  "employment_details","annual_personal_income","income_verification","complete_at"];
function storedSurveyWords(value) {
  if (Array.isArray(value)) return value.map(storedSurveyWords).filter(Boolean).join(", ") || null;
  if (value == null || typeof value === "object") return null;
  const text=String(value).trim();
  if (!text || /^\d{5,}$/.test(text)) return null; // An option row ID is not an answer.
  if (text.startsWith("[")) {try {const parsed=JSON.parse(text);if(Array.isArray(parsed))return storedSurveyWords(parsed);}catch { /* Plain saved answer. */ }}
  return text;
}
function callSurvey(fields = {}) {
  const edits=fields.setter_survey_edits && typeof fields.setter_survey_edits==="object" ? fields.setter_survey_edits : {};
  return CF_SURVEY_QUESTIONS.filter(q=>q.type!=="contact").map(q=>{
    const corrected=storedSurveyWords(edits[q.payloadKey]);
    const original=storedSurveyWords(fields[`${q.payloadKey}_label`])
      || storedSurveyWords(fields[`${q.payloadKey}_labels`]) || storedSurveyWords(fields[q.payloadKey]);
    return {key:q.payloadKey,label:q.title,value:corrected || original,source:corrected ? "setter" : original ? "applicant" : null};
  });
}
function safeMeetHref(value) {
  try {const url=new URL(value);return url.protocol==="https:" && url.hostname==="meet.google.com"
    && !url.username && !url.password && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
    ? `${url.origin}${url.pathname}` : null;}catch{return null;}
}
export function closerDayWindow(now = new Date()) {
  const date=localDateString(now),start=new Date(`${date}T00:00:00-07:00`);
  return {date,timeZone:"America/Phoenix",startAt:start.toISOString(),endAt:new Date(start.getTime()+86_400_000).toISOString()};
}
export async function closerDayCalendar(db,{orgId,staffId,now=new Date()}={}) {
  if (!orgId || !staffId) throw new TypeError("closer_calendar_scope_required");
  const day=closerDayWindow(now);
  const result=await db.query(`SELECT t.id AS task_id,t.client_id,t.due_at,t.meeting_url,t.title,b.id AS booking_id,
      c.first_name,c.last_name,c.custom_fields
    FROM tasks t JOIN clients c ON c.id=t.client_id AND c.org_id=t.org_id
    LEFT JOIN LATERAL (SELECT id FROM bookings
      WHERE org_id=t.org_id AND client_id=t.client_id AND starts_at=t.due_at AND status IN ('booked','rescheduled')
      ORDER BY created_at DESC,updated_at DESC LIMIT 1) b ON true
    WHERE t.org_id=$1 AND t.assignee_role='closer' AND t.assignee_staff_id=$2
      AND t.done IS NOT TRUE AND c.custom_fields->>'crm_archived_at' IS NULL
      AND t.due_at >= $3::timestamptz AND t.due_at < $4::timestamptz
      AND NOT EXISTS(SELECT 1 FROM call_outcomes o WHERE o.org_id=t.org_id AND o.client_id=t.client_id
        AND (o.task_id=t.id OR (NULLIF(btrim(t.body),'') IS NOT NULL AND o.booking_ref=t.body)))
    ORDER BY t.due_at ASC,t.id ASC`,[orgId,staffId,day.startAt,day.endAt]);
  const calls=result.rows.map(row=>{
    const fields=row.custom_fields && typeof row.custom_fields==="object" ? row.custom_fields : {};
    const raw=fields.setter_handoff && typeof fields.setter_handoff==="object" ? fields.setter_handoff : {};
    const handoff=Object.fromEntries(HANDOFF_DETAIL_KEYS.filter(key=>raw[key]!=null && raw[key]!=="" && ["string","boolean","number"].includes(typeof raw[key]))
      .map(key=>[key,raw[key]]));
    return {taskId:String(row.task_id),clientId:String(row.client_id),bookingId:row.booking_id ? String(row.booking_id) : null,
      name:[row.first_name,row.last_name].filter(Boolean).join(" ").trim() || null,
      title:row.title || "Booked call",startsAt:new Date(row.due_at).toISOString(),
      secondsUntilStart:Math.floor((new Date(row.due_at)-now)/1000),
      meetHref:safeMeetHref(row.meeting_url),
      presentHref:`/app/present.html?contact=${encodeURIComponent(row.client_id)}&audience=1`,
      clientHref:`/app/closer-dashboard.html?client_id=${encodeURIComponent(row.client_id)}&task_id=${encodeURIComponent(row.task_id)}`,
      survey:callSurvey(fields),setterHandoff:Object.keys(handoff).length ? handoff : null,
      presence:{state:"unavailable",reason:"not_measured"}};
  });
  return {...day,status:"available",asOf:now.toISOString(),viewer:{orgId,staffId},
    nextCallId:calls.find(call=>new Date(call.startsAt)>=now)?.taskId || null,calls};
}

async function clientSection(db, principal, now, missing) {
  const asOf = now.toISOString();
  const section = { role: "client", metrics: [], items: [] };
  const [progress, documents] = await Promise.all([
    settled(() => readClientProgress(db, { orgId: principal.orgId, clientId: principal.clientId, now }), null),
    settled(() => listClientLibrary(db, { orgId: principal.orgId, clientId: principal.clientId, sign: false }), null)
  ]);
  section.metrics.push(metric("documents_on_file", "Documents on file", documents.value?.length,
    "count", "now", asOf, documents.failed ? "documents_read_failed" : "not_measured"));
  if (progress.failed) missing.push("client:progress");
  if (documents.failed) missing.push("client:documents");
  const next = progress.value?.nextStep;
  const waypoint = progress.value?.waypoints?.find(w => w.id === next?.waypointId);
  if (waypoint) section.items.push(item(`waypoint:${waypoint.id}`, waypoint.title || "Next step",
    waypoint.owner === "client" ? "Your action" : "Fundhub is working on this",
    waypoint.dueAt, "/progress.html", urgencyFor(waypoint.dueAt, now)));
  section.items.push(item("client:documents", "Documents", "View or upload documents", null,
    "/app/client-portal.html", "normal"));
  section.items.push(item("client:advisor", "Service advisor", "Contact your advisor from the portal", null,
    "/app/client-portal.html", "normal"));
  return section;
}

export async function buildDockFeed(db, principal, { now = new Date() } = {}) {
  const generatedAt = now.toISOString();
  const missing = [];
  if (principal?.kind === "client") {
    if (!principal.orgId || !principal.clientId) throw new TypeError("client_scope_required");
    const exists = await db.query("SELECT 1 FROM clients WHERE id = $1 AND org_id = $2", [principal.clientId, principal.orgId]);
    if (!exists.rows.length) return null;
    return { ok: true, generatedAt, identity: { kind: "client", roles: ["client"] },
      sections: [await clientSection(db, principal, now, missing)], missing };
  }
  if (principal?.kind !== "staff" || !principal.staff?.id || !principal.staff?.org_id) throw new TypeError("staff_scope_required");
  const roles = staffRoles(principal.staff);
  if (!roles.length) throw new TypeError("staff_role_required");
  const shared = {};
  const sections = await Promise.all(roles.map(role => staffSection(db, principal.staff, role, now, missing, shared)));
  return { ok: true, generatedAt, identity: { kind: "staff", roles }, sections, missing };
}
