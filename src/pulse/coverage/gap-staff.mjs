// Staff, roles, and hiring gaps for the morning pulse. Report only.
// Never auto-fix. Never invite a person. Never change a role. Never edit a page.
//
// Tripwire is existing Recon (AG-07) on the daily pulse. This file does not
// start a second watchdog and does not read the agents table.
//
// Not slice 11 (hiring bench and outreach sweepers).
// Not slice 30 (owner, sales manager, and CSM doors already on that list).
// Not the registry: reg:* already pings every /app/*.html desk and the
// auth/invite, hiring/apply and hiring/candidates doors for a plain up or down.
// Each row below reads one thing those pings cannot see.
//
// Claude review 2026-10-08: the invite check used to look for a row in
// messages. The invite mail never writes one (it goes out through Resend
// straight to notify_email, not to the login address), so that check could not
// pass. A second fix dropped its replacement too: the Resend key and from-address
// are already read by gap:auth-reset-mail in gap-auth.mjs (it also ignores a
// masked key and looks for real Resend mail this week), so a second row would
// have called one break twice. This file keeps the part nobody else reads:
// an invited person with no working set-password link.

export const DEFAULT_BASE_URL = "https://fundhub.ai";

/** The staff jobs that have their own home desk in public/app/shell.js. */
export const STAFF_ROLES = Object.freeze([
  "owner",
  "admin",
  "funding_advisor",
  "closer",
  "inquiry_specialist",
  "setter",
  "sales_manager",
  "csm"
]);

/** GET. The app frame. Its HOME map says which desk each job lands on. */
export const SHELL_PATH = "/app/shell.js";

/** GET. Hiring role gate. A bad cookie used to crash every gated route with 500. */
export const ROLE_GATE_PATH = "/api/hiring/candidates";

/** GET. Public careers door. Never POST — a POST would file an application. */
export const HIRING_APPLY_PATH = "/api/hiring/apply";

const TRIPWIRE =
  "Recon (AG-07) is the only tripwire. Do not build a second watchdog. Do not auto-fix from this pulse.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only. People invited who cannot set a password: status is invited and
 * there is no invite link that is unused and not expired. Nothing is written.
 */
export const STUCK_INVITE_SQL = `
SELECT
  count(*)::int AS invited,
  count(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM password_resets pr
       WHERE pr.staff_id = s.id
         AND pr.kind = 'invite'
         AND pr.used_at IS NULL
         AND pr.expires_at > $2::timestamptz
    )
  )::int AS no_link
  FROM staff s
 WHERE s.status = 'invited'
   AND ($1::uuid IS NULL OR s.org_id = $1::uuid)
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

function fetcher(ctx) {
  const f = ctx && (ctx.fetchImpl || ctx.fetch);
  return typeof f === "function" ? f : null;
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

async function readUrl(fetchImpl, url, headers, { body = true } = {}) {
  const res = await fetchImpl(url, { method: "GET", headers });
  let text = "";
  if (body) {
    try {
      text = typeof res.text === "function" ? await res.text() : "";
    } catch {
      text = "";
    }
  } else {
    // A desk page can be 200 KB. The status is all this row needs.
    try {
      if (res && res.body && typeof res.body.cancel === "function") await res.body.cancel();
    } catch {
      /* the status is already read */
    }
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
 * Invited people with no working set-password link. They cannot log in, and
 * nothing tells the owner. Does not POST /api/auth/invite. Does not insert a person.
 */
export async function checkStaffInviteLink(ctx = {}) {
  if (!ctx.db || typeof ctx.db.query !== "function") {
    return check(
      "staff-invite-link",
      "skip",
      "no database in this run — invited people were not read. Did not invite a person."
    );
  }
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now != null ? ctx.now : Date.now());
  try {
    const out = await ctx.db.query(STUCK_INVITE_SQL, [orgParam(ctx), now]);
    const row = (out && out.rows && out.rows[0]) || {};
    const invited = num(row.invited);
    const stuck = num(row.no_link);
    if (stuck > 0) {
      return check(
        "staff-invite-link",
        "FAIL",
        `${stuck} of ${invited} invited ${invited === 1 ? "person has" : "people have"} no working set-password link. They cannot log in. Did not invite a person.`,
        fix("Invite them again, or suspend them. Do not invite a real person from this pulse.")
      );
    }
    return check(
      "staff-invite-link",
      "PASS",
      invited === 0
        ? "nobody is waiting on a staff invite"
        : `${invited} invited ${invited === 1 ? "person has" : "people have"} a working set-password link`
    );
  } catch (err) {
    return check(
      "staff-invite-link",
      "FAIL",
      `could not read invited staff: ${clip(err)}. Did not invite a person.`,
      fix("Read invited staff. Do not invite a real person from this pulse.")
    );
  }
}

/**
 * Unsigned GET on the hiring candidates door, which is role-gated.
 * A crashed gate answers 500. 401 or 403 means it refused cleanly.
 * Sends a cookie that is not a session, so no role can change. The registry
 * pings this door with no cookie; only a bad cookie reaches the cookie reader.
 * Limit: the bad cookie is turned away at the cookie reader with a 401, before
 * the hiring role check runs. A crash inside the role check itself is not seen.
 */
export async function checkRoleGate(ctx = {}) {
  const fetchImpl = fetcher(ctx);
  if (!fetchImpl) {
    return check("role-gate", "skip", "no fetch in this run — role gate was not read. Did not change a role.");
  }
  const url = `${origin(ctx)}${ROLE_GATE_PATH}`;
  try {
    const { status } = await readUrl(fetchImpl, url, {
      accept: "application/json",
      cookie: "fundhub_session=%zz"
    });
    if (status === 401 || status === 403) {
      return check("role-gate", "PASS", `role gate answered ${status} to a bad cookie. Did not change a role.`);
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

/**
 * Public GET /api/hiring/apply. Never POST. The registry only needs a 2xx; this
 * row also needs the body to be the open-role list the careers page reads.
 */
export async function checkHiringApply(ctx = {}) {
  const fetchImpl = fetcher(ctx);
  if (!fetchImpl) {
    return check("hiring-apply", "skip", "no fetch in this run — hiring apply was not read. Did not file an application.");
  }
  const url = `${origin(ctx)}${HIRING_APPLY_PATH}`;
  try {
    const { status, json } = await readUrl(fetchImpl, url, { accept: "application/json" });
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

/**
 * Read the HOME map out of the app frame: which desk each job lands on.
 * Returns { role: "file.html" }, or null when the map is not there.
 */
export function parseHomeMap(js) {
  const hit = /var\s+HOME\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(String(js || ""));
  if (!hit) return null;
  const body = hit[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const map = {};
  for (const pair of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"/g)) {
    map[pair[1]] = pair[2];
  }
  return Object.keys(map).length ? map : null;
}

/**
 * The desk each staff job lands on, as the app itself says it (shell.js HOME),
 * must open. The registry pings every desk file, so a renamed desk still looks
 * up there; only this reads the link from the job to the desk.
 */
export async function checkRoleDesk(ctx = {}) {
  const fetchImpl = fetcher(ctx);
  if (!fetchImpl) {
    return check("role-desk", "skip", "no fetch in this run — role desks were not opened. Did not edit a page.");
  }
  const base = origin(ctx);
  try {
    const shell = await readUrl(fetchImpl, `${base}${SHELL_PATH}`, { accept: "*/*" });
    if (shell.status < 200 || shell.status >= 300) {
      return check(
        "role-desk",
        "FAIL",
        `the app frame ${SHELL_PATH} answered ${shell.status}, so no job can find its home desk. Did not edit a page.`,
        fix(`Restore ${SHELL_PATH}. Do not edit the page from this pulse.`)
      );
    }
    const home = parseHomeMap(shell.text);
    const jobs = home ? STAFF_ROLES.filter((role) => /^[\w.-]+\.html$/.test(String(home[role] || ""))) : [];
    if (!jobs.length) {
      return check(
        "role-desk",
        "skip",
        `could not read the HOME map in ${SHELL_PATH}, so role desks were not opened. Did not edit a page.`
      );
    }
    const files = [...new Set(jobs.map((role) => home[role]))];
    const hits = await Promise.all(files.map(async (file) => {
      const { status } = await readUrl(fetchImpl, `${base}/app/${file}`, { accept: "text/html" }, { body: false });
      return { file, status };
    }));
    const bad = hits.filter((hit) => hit.status < 200 || hit.status >= 300);
    if (bad.length) {
      const named = bad.map((hit) => {
        const who = jobs.filter((role) => home[role] === hit.file).join("/");
        return `${who} -> ${hit.file} (${hit.status})`;
      }).join(", ");
      return check(
        "role-desk",
        "FAIL",
        `${bad.length} home desk${bad.length === 1 ? "" : "s"} did not load: ${named}. Did not edit a page.`,
        fix("Point the job back at a desk that loads, or restore the desk. Do not edit the page from this pulse.")
      );
    }
    return check(
      "role-desk",
      "PASS",
      `${jobs.length} staff jobs each land on a desk that loads (${files.length} desks). Did not edit a page.`
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
    checkStaffInviteLink(ctx),
    checkRoleGate(ctx),
    checkHiringApply(ctx),
    checkRoleDesk(ctx)
  ]);
}
