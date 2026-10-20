// Company activity feed for Galaxy — staff + agents + open shifts + today's events.
// Presence respects Demo Mode (include is_demo when enabled). Money KPIs never include is_demo.

import { orgDemoModeEnabled } from "../demo/exclude-demo.mjs";

const ROLE_CLUSTER = {
  owner: "lead",
  admin: "lead",
  sales_manager: "sales",
  closer: "sales",
  setter: "sales",
  funding_advisor: "sales",
  inquiry_specialist: "inq"
};

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  sales_manager: "Sales Manager",
  closer: "Closer",
  setter: "Setter",
  funding_advisor: "Funding Advisor",
  inquiry_specialist: "Inquiry Remover"
};

const ROLE_UNIT = {
  owner: "files touched",
  admin: "files touched",
  sales_manager: "team roll-up",
  closer: "calls",
  setter: "calls",
  funding_advisor: "rounds",
  inquiry_specialist: "removals"
};

const ROLE_POOL = {
  lead: ["Reviewing open flags", "Checking team coverage", "Reading the funding queue"],
  sales: ["On a client call", "Logging a call outcome", "Prepping the next dial", "Chasing docs"],
  inq: ["Calling a bureau", "Working the inquiry queue", "Confirming a removal"],
  cfa: ["Handling inbound", "Qualifying a lead", "Updating the CRM"],
  ops: ["Running ops work", "Clearing a queue item", "Syncing status"]
};

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  let h = dt.getHours();
  const m = dt.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m < 10 ? "0" : ""}${m} ${ap}`;
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

function clusterForStaffRole(role) {
  return ROLE_CLUSTER[role] || "sales";
}

function clusterForAgent(agentClass) {
  return agentClass === "ops" ? "ops" : "cfa";
}

function buildHumanNode(row) {
  const cluster = clusterForStaffRole(row.role);
  const open = !!row.open_shift_id;
  const recent = Number(row.events_15m || 0) > 0;
  const state = open || recent ? "active" : "idle";
  const out = Number(row.events_today || 0) + Number(row.calls_today || 0);
  const target = row.role === "closer" || row.role === "setter" ? 8 : null;
  const pace = target == null ? null : out / target;
  const name = row.is_demo ? `DEMO · ${row.name}` : row.name;
  const act = state === "active"
    ? (ROLE_POOL[cluster][0] || "Working")
    : "Idle — no open shift";
  const tl = (row.timeline || []).map((t) => [fmtTime(t.at), t.label]);
  return {
    id: `staff:${row.id}`,
    c: cluster,
    name,
    ini: initials(row.name),
    role: ROLE_LABEL[row.role] || row.role || "Staff",
    kind: "human",
    state,
    tempo: state === "active" ? 0.55 + Math.min(0.4, out / 40) : 0.25,
    out,
    pace,
    unit: ROLE_UNIT[row.role] || "events",
    act,
    pool: ROLE_POOL[cluster] || ROLE_POOL.sales,
    shift: open ? fmtTime(row.shift_started_at) : "—",
    on: open ? fmtDuration(Date.now() - new Date(row.shift_started_at).getTime()) : "off shift",
    stats: [
      ["Events today", String(Number(row.events_today || 0))],
      ["Calls today", String(Number(row.calls_today || 0))],
      ["Open shift", open ? "yes" : "no"],
      ["State", state.toUpperCase()]
    ],
    files: row.files || [],
    tl: tl.length ? tl : [["—", "No timeline yet"]],
    is_demo: !!row.is_demo
  };
}

function buildAgentNode(row) {
  const cluster = clusterForAgent(row.agent_class);
  const live = row.status === "live";
  const out = Number(row.runs_today || 0);
  const recent = Number(row.runs_15m || 0) > 0;
  const blocked = Number(row.blocked_15m || 0) > 0;
  const state = blocked ? "blocked" : (recent ? "active" : "idle");
  return {
    id: `agent:${row.code}`,
    c: cluster,
    name: row.name,
    ini: initials(row.name),
    role: row.channel ? String(row.channel).replace(/_/g, " ") : "Agent",
    kind: "agent",
    state,
    tempo: state === "active" ? 0.5 : 0.2,
    out,
    pace: null,
    unit: "runs",
    act: blocked ? "Guardrail blocked a recent run"
      : (recent ? "Runtime active" : (live ? "Live · no run in 15 minutes" : (row.status || "idle"))),
    pool: ROLE_POOL[cluster] || ROLE_POOL.ops,
    shift: row.went_live_at ? fmtTime(row.went_live_at) : "—",
    on: live && row.went_live_at
      ? fmtDuration(Date.now() - new Date(row.went_live_at).getTime())
      : "—",
    stats: [
      ["Status", String(row.status || "—")],
      ["Class", String(row.agent_class || "—")],
      ["Channel", String(row.channel || "—")],
      ["Runtime", String(row.runtime || "—")],
      ["Runs today", String(out)],
      ["Runs in 15 minutes", String(Number(row.runs_15m || 0))]
    ],
    files: [],
    tl: [["—", blocked ? "Recent run blocked by guardrails" : (live ? "Agent is live" : "Agent not live")]],
    is_demo: false
  };
}

/**
 * companyActivity(db, { orgId }) → { demo_mode, simulated, nodes, kpis, clients, routes }
 */
export async function companyActivity(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("companyActivity: orgId required");
  const demoMode = await orgDemoModeEnabled(db, orgId);

  const staffRes = await db.query(
    `SELECT s.id, s.name, s.role, s.is_demo,
            sh.id AS open_shift_id, sh.started_at AS shift_started_at,
            (SELECT count(*)::int FROM staff_events e
              WHERE e.staff_id = s.id AND e.org_id = s.org_id
                AND e.created_at >= date_trunc('day', now())
                AND ($2::boolean OR COALESCE(e.is_demo, false) = false)
            ) AS events_today,
            (SELECT count(*)::int FROM staff_events e
              WHERE e.staff_id = s.id AND e.org_id = s.org_id
                AND e.created_at >= now() - interval '15 minutes'
                AND ($2::boolean OR COALESCE(e.is_demo, false) = false)
            ) AS events_15m,
            (SELECT count(*)::int FROM call_outcomes co
              WHERE co.staff_id = s.id AND co.org_id = s.org_id
                AND co.logged_at >= date_trunc('day', now())
                AND ($2::boolean OR COALESCE(co.is_demo, false) = false)
            ) AS calls_today
       FROM staff s
       LEFT JOIN shifts sh ON sh.staff_id = s.id AND sh.org_id = s.org_id AND sh.ended_at IS NULL
        AND ($2::boolean OR COALESCE(sh.is_demo, false) = false)
      WHERE s.org_id = $1
        AND COALESCE(s.status, 'active') = 'active'
        AND s.role IS NOT NULL
        AND s.role NOT IN ('client', 'affiliate', 'partner')
        AND ($2::boolean OR COALESCE(s.is_demo, false) = false)
      ORDER BY s.role, s.name`,
    [orgId, demoMode]
  );

  const staffIds = staffRes.rows.map((r) => r.id);
  const timelineByStaff = new Map();
  const filesByStaff = new Map();
  if (staffIds.length) {
    const tl = await db.query(
      `SELECT e.staff_id, e.created_at AS at, e.kind AS label
         FROM staff_events e
        WHERE e.org_id = $1 AND e.staff_id = ANY($2::uuid[])
          AND e.created_at >= date_trunc('day', now())
          AND ($3::boolean OR COALESCE(e.is_demo, false) = false)
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [orgId, staffIds, demoMode]
    );
    for (const row of tl.rows) {
      const list = timelineByStaff.get(row.staff_id) || [];
      if (list.length < 5) {
        list.push({ at: row.at, label: String(row.kind || "event").replace(/_/g, " ") });
        timelineByStaff.set(row.staff_id, list);
      }
    }
    const files = await db.query(
      `SELECT co.staff_id, co.is_demo,
              trim(both FROM concat_ws(' ', c.first_name, c.last_name)) AS client_name
         FROM call_outcomes co
         JOIN clients c ON c.id = co.client_id
        WHERE co.org_id = $1 AND co.staff_id = ANY($2::uuid[])
          AND co.logged_at >= date_trunc('day', now())
          AND ($3::boolean OR COALESCE(co.is_demo, false) = false)
        ORDER BY co.logged_at DESC
        LIMIT 100`,
      [orgId, staffIds, demoMode]
    );
    for (const row of files.rows) {
      if (!row.client_name) continue;
      const label = row.is_demo ? `DEMO · ${row.client_name}` : row.client_name;
      const list = filesByStaff.get(row.staff_id) || [];
      if (list.length < 4 && !list.includes(label)) {
        list.push(label);
        filesByStaff.set(row.staff_id, list);
      }
    }
  }

  const nodes = [];
  for (const row of staffRes.rows) {
    row.timeline = (timelineByStaff.get(row.id) || []).slice().reverse();
    row.files = filesByStaff.get(row.id) || [];
    nodes.push(buildHumanNode(row));
  }

  const agentsRes = await db.query(
    `SELECT a.code, a.name, a.agent_class, a.channel, a.status, a.runtime, a.went_live_at, a.sort_order,
            (SELECT count(*)::int FROM agent_runs r
              WHERE r.org_id = a.org_id AND r.agent_code = a.code
                AND r.created_at >= date_trunc('day', now())) AS runs_today,
            (SELECT count(*)::int FROM agent_runs r
              WHERE r.org_id = a.org_id AND r.agent_code = a.code
                AND r.created_at >= now() - interval '15 minutes') AS runs_15m,
            (SELECT count(*)::int FROM agent_shadow_log l
              WHERE l.org_id = a.org_id AND l.agent_code = a.code
                AND l.created_at >= now() - interval '15 minutes'
                AND l.reason IN ('guardrail_halt', 'guardrail_block')) AS blocked_15m
       FROM agents a
      WHERE a.org_id = $1
        AND a.status IN ('live', 'shadow')
        AND (a.retired_at IS NULL)
      ORDER BY a.sort_order, a.code
      LIMIT 40`,
    [orgId]
  );
  for (const row of agentsRes.rows) nodes.push(buildAgentNode(row));

  // Client names for rail pulses — presence only; money still excludes is_demo.
  const clientsRes = await db.query(
    `SELECT trim(both FROM concat_ws(' ', first_name, last_name)) AS name, is_demo
       FROM clients
      WHERE org_id = $1
        AND ($2::boolean OR COALESCE(is_demo, false) = false)
        AND coalesce(trim(both FROM concat_ws(' ', first_name, last_name)), '') <> ''
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 24`,
    [orgId, demoMode]
  );
  const clients = clientsRes.rows.map((r) =>
    r.is_demo ? `DEMO · ${r.name}` : r.name
  ).filter(Boolean);

  // Money KPIs — always exclude is_demo.
  const money = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint
          FROM call_outcomes
         WHERE org_id = $1 AND COALESCE(is_demo, false) = false
           AND logged_at >= date_trunc('day', now())) AS cash_cents,
       (SELECT COALESCE(SUM(funded_amount), 0)::numeric
          FROM clients
         WHERE org_id = $1 AND COALESCE(is_demo, false) = false
           AND funded IS TRUE
           AND updated_at >= date_trunc('day', now())) AS funded_today,
       (SELECT count(*)::int FROM call_outcomes
         WHERE org_id = $1 AND COALESCE(is_demo, false) = false
           AND logged_at >= date_trunc('day', now())
           AND outcome = 'deposit') AS deposits_today`,
    [orgId]
  );
  const m = money.rows[0] || {};
  const cash = Number(m.cash_cents || 0) / 100;
  const funded = Number(m.funded_today || 0);
  const deposits = Number(m.deposits_today || 0);
  const kpis = [
    { id: "cash", label: "Cash collected", v: cash, fmt: "money", hist: [], glow: 0, delta: "", deltaT: 0 },
    { id: "fund", label: "Funded today", v: funded, fmt: "money", hist: [], glow: 0, delta: "", deltaT: 0 },
    { id: "move", label: "Deposits", v: deposits, fmt: "int", hist: [], glow: 0, delta: "", deltaT: 0 }
  ];

  return {
    simulated: false,
    demo_mode: demoMode,
    nodes,
    kpis,
    clients,
    routes: []
  };
}
