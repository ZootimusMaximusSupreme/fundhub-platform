// Staff, roles, and hiring gaps for the morning pulse. Report only.
// Never auto-fix. Never invite a person. Never change a role. Never edit a page.
//
// Tripwire is existing Recon (AG-07) on the daily pulse. This file does not
// start a second watchdog and does not read the agents table.
//
// Not slice 11 (hiring bench and outreach sweepers).
// Not slice 30 (owner, sales manager, and CSM doors already on that list).

export const DEFAULT_BASE_URL = "https://fundhub.ai";

/** Role homes this lane watches. Slice 30 already lists pipeline, sales floor, and the CSM queue. */
export const ROLE_DESKS = [
  { role: "closer", path: "/app/closer-dashboard.html" },
  { role: "funding_advisor", path: "/app/client-control-panel.html" },
  { role: "inquiry_specialist", path: "/app/inquiry-remover.html" }
];

/** GET. Hiring role gate. A bad cookie used to crash every gated route with 500. */
export const ROLE_GATE_PATH = "/api/hiring/candidates";

/** GET. Public careers door. Never POST — a POST would file an application. */
export const HIRING_APPLY_PATH = "/api/hiring/apply";

const TRIPWIRE =
  "Recon (AG-07) is the only tripwire. Do not build a second watchdog. Do not auto-fix from this pulse.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only. Open staff invites versus an outbound email row to that login. */
export const INVITE_SQL = `
SELECT
  count(*) FILTER (
    WHERE s.status = 'invited'
      AND pr.kind = 'invite'
      AND pr.used_at IS NULL
      AND pr.expires_at > now()
  )::int AS open_invites,
  count(*) FILTER (
    WHERE s.status = 'invited'
      AND pr.kind = 'invite'
      AND pr.used_at IS NULL
      AND pr.expires_at > now()
      AND EXISTS (
        SELECT 1 FROM messages m
         WHERE m.org_id = s.org_id
           AND m.direction = 'outbound'
           AND m.channel = 'email'
           AND lower(m.to_address) = lower(s.email)
           AND m.created_at >= pr.created_at
      )
  )::int AS mailed
  FROM staff s
  JOIN password_resets pr ON pr.staff_id = s.id
 WHERE ($1::uuid IS NULL OR s.org_id = $1::uuid)
`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function origin(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function orgParam(ctx) {
  const id = ctx && ctx.orgId;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

function clip(err) {
  return String((err && err.message) || err || "error")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function readUrl(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { method: "GET", headers });
  let text = "";
  try {
    text = typeof res.text === "function" ? await res.text() : "";
  } catch {
    text = "";
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: Number(res && res.status), text, json };
}

function fix(line) {
  return `${line} ${TRIPWIRE}`;
}

/**
 * Staff invites waiting with no outbound mail row.
 * Does not POST /api/auth/invite. Does not insert a person.
 */
export async function checkStaffInviteSend(ctx = {}) {
  if (!ctx.db || typeof ctx.db.query !== "function") {
    return check(
      "staff-invite-send",
      "skip",
      "no database in this run — invite mail was not read. Did not invite a person."
    );
  }
  try {
    const out = await ctx.db.query(INVITE_SQL, [orgParam(ctx)]);
    const row = (out && out.rows && out.rows[0]) || {};
    const open = num(row.open_invites);
    const mailed = num(row.mailed);
    if (open === 0) {
      return check(
        "staff-invite-send",
        "skip",
        "no open staff invite to prove. Did not invite a person."
      );
    }
    if (mailed >= open) {
      return check(
        "staff-invite-send",
        "PASS",
        `${open} open staff invite${open === 1 ? "" : "s"} each have an outbound email row`
      );
    }
    const missing = open - mailed;
    return check(
      "staff-invite-send",
      "FAIL",
      `${missing} of ${open} open staff invite${open === 1 ? "" : "s"} have no outbound email row. The invite never sent. Did not invite a person.`,
      fix("Make the staff invite leave an outbound email. Do not invite a real person from this pulse.")
    );
  } catch (err) {
    return check(
      "staff-invite-send",
      "FAIL",
      `could not read staff invites: ${clip(err)}. Did not invite a person.`,
      fix("Read open staff invites. Do not invite a real person from this pulse.")
    );
  }
}

/**
 * Unsigned GET on the hiring candidates door, which is role-gated.
 * A crashed gate answers 500. 401 or 403 means it refused cleanly.
 * Sends a cookie that is not a session, so no role can change.
 */
export async function checkRoleGate(ctx = {}) {
  if (typeof ctx.fetchImpl !== "function") {
    return check("role-gate", "skip", "no fetch in this run — role gate was not read. Did not change a role.");
  }
  const url = `${origin(ctx)}${ROLE_GATE_PATH}`;
  try {
    const { status } = await readUrl(ctx.fetchImpl, url, {
      accept: "application/json",
      cookie: "fundhub_session=%zz"
    });
    if (status === 401 || status === 403) {
      return check("role-gate", "PASS", `role gate answered ${status}. Did not change a role.`);
    }
    if (status === 503) {
      return check(
        "role-gate",
        "skip",
        "role gate could not be checked (503). Did not change a role."
      );
    }
    if (status === 500) {
      return check(
        "role-gate",
        "FAIL",
        "role gate answered 500. Did not change a role.",
        fix("Make the role gate answer 401 or 403. Do not change a role from this pulse.")
      );
    }
    return check(
      "role-gate",
      "FAIL",
      `role gate answered ${status}. Did not change a role.`,
      fix("Restore the role gate so a stranger gets 401 or 403, not an error. Do not change a role from this pulse.")
    );
  } catch (err) {
    return check(
      "role-gate",
      "FAIL",
      `role gate unreachable: ${clip(err)}. Did not change a role.`,
      fix("Restore the role gate. Do not change a role from this pulse.")
    );
  }
}

/** Public GET /api/hiring/apply. Never POST. */
export async function checkHiringApply(ctx = {}) {
  if (typeof ctx.fetchImpl !== "function") {
    return check("hiring-apply", "skip", "no fetch in this run — hiring apply was not read. Did not file an application.");
  }
  const url = `${origin(ctx)}${HIRING_APPLY_PATH}`;
  try {
    const { status, json } = await readUrl(ctx.fetchImpl, url, { accept: "application/json" });
    const roles = json && json.roles;
    const live = status === 200 && json && json.ok === true && Array.isArray(roles);
    if (live) {
      return check("hiring-apply", "PASS", `hiring apply answered 200 with ${roles.length} open role${roles.length === 1 ? "" : "s"}`);
    }
    return check(
      "hiring-apply",
      "FAIL",
      `hiring apply route is dead (HTTP ${status}). Did not file an application.`,
      fix("Restore GET /api/hiring/apply so open roles load. Do not submit an application from this pulse.")
    );
  } catch (err) {
    return check(
      "hiring-apply",
      "FAIL",
      `hiring apply route is dead: ${clip(err)}. Did not file an application.`,
      fix("Restore GET /api/hiring/apply. Do not submit an application from this pulse.")
    );
  }
}

/** GET the desks a closer, funding advisor, and specialist must open. */
export async function checkRoleDesk(ctx = {}) {
  if (typeof ctx.fetchImpl !== "function") {
    return check("role-desk", "skip", "no fetch in this run — role desks were not opened. Did not edit a page.");
  }
  const base = origin(ctx);
  try {
    const hits = await Promise.all(ROLE_DESKS.map(async (desk) => {
      const { status } = await readUrl(ctx.fetchImpl, `${base}${desk.path}`, {
        accept: "text/html"
      });
      return { ...desk, status };
    }));
    const missing = hits.filter((hit) => hit.status === 404);
    if (missing.length) {
      const named = missing.map((hit) => `${hit.role} ${hit.path}`).join(", ");
      return check(
        "role-desk",
        "FAIL",
        `${missing.length} role desk${missing.length === 1 ? "" : "s"} answered 404: ${named}. Did not edit a page.`,
        fix("Restore the desk that role must open. Do not edit the page from this pulse.")
      );
    }
    const bad = hits.filter((hit) => hit.status < 200 || hit.status >= 300);
    if (bad.length) {
      const named = bad.map((hit) => `${hit.role} ${hit.path} ${hit.status}`).join(", ");
      return check(
        "role-desk",
        "FAIL",
        `role desk did not load: ${named}. Did not edit a page.`,
        fix("Restore the desk that role must open. Do not edit the page from this pulse.")
      );
    }
    return check(
      "role-desk",
      "PASS",
      `${hits.length} role desks loaded. Did not edit a page.`
    );
  } catch (err) {
    return check(
      "role-desk",
      "FAIL",
      `role desk unreachable: ${clip(err)}. Did not edit a page.`,
      fix("Restore the desk that role must open. Do not edit the page from this pulse.")
    );
  }
}

/** Four gap rows. Shape is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip. */
export async function gapChecks(ctx = {}) {
  return Promise.all([
    checkStaffInviteSend(ctx),
    checkRoleGate(ctx),
    checkHiringApply(ctx),
    checkRoleDesk(ctx)
  ]);
}
