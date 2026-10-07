// Daily pulse — audit only. Suggested fixes + proof. Never auto-fixes.
//
// 6:00 a.m. America/Phoenix, all year. Arizona does not change clocks.
// The morning brief texts right after this check.
//
// Do not stretch the Ops Admin money pulse into this.
// Tripwire is existing Recon (AG-07) + scripts/gate-relay. No second watchdog.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { relayDirs, readHeartbeat, isPidAlive, STALE_MS } from "../../scripts/gate-relay/index.mjs";
import { gmailConfigFromEnv, createGmailClientFromConfig } from "../gmail/index.mjs";
import { textChris, ticketDarwin } from "./notify.mjs";
import { checkRegistry } from "./registry.mjs";
import { checkMachine } from "./machine.mjs";
import { checkJobHeartbeats } from "./heartbeats.mjs";
import { checkPipelineMotion } from "./pipeline-motion.mjs";
import { buildScorecard, loadPreviousScorecard, phoenixDate, saveScorecard } from "./scorecard.mjs";
import { listUnrecordedCalls } from "../sales/unrecorded.mjs";

export const PULSE_CRON = "TZ=America/Phoenix 0 6 * * *";
export const PULSE_TZ = "America/Phoenix";
export const AGENT_CODE = "AG-07";
export const SOURCE_WORKFLOW = "daily-pulse";
export const DEFAULT_BASE_URL = "https://fundhub.ai";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

export function denverDateStamp(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PULSE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function scorecardPath(boardDir, dateStr) {
  return path.join(boardDir, `pulse-${dateStr}.md`);
}

export function defaultBoardDir(env = process.env, root = REPO_ROOT) {
  const named = String((env && env.PULSE_BOARD_DIR) || "").trim();
  return named || path.join(root, "ops/workflows");
}

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

async function readUrl(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: "text/html,application/json" } });
  const text = await res.text();
  return { status: res.status, text };
}

export async function checkHealth({ fetchImpl, baseUrl }) {
  const url = `${baseUrl}/api/health?strict=1`;
  try {
    const { status, text } = await readUrl(fetchImpl, url);
    if (status >= 200 && status < 300) {
      return check("health", "PASS", `strict health answered ${status}`);
    }
    return check(
      "health",
      "FAIL",
      `strict health answered ${status}: ${String(text).slice(0, 160)}`,
      "Read /api/health?strict=1 and fix the named outage. Do not auto-fix from this pulse."
    );
  } catch (err) {
    return check(
      "health",
      "FAIL",
      `strict health unreachable: ${String((err && err.message) || err).slice(0, 160)}`,
      "Confirm fundhub.ai /api/health is deployed."
    );
  }
}

export async function checkLogin({ fetchImpl, baseUrl }) {
  const url = `${baseUrl}/login.html`;
  try {
    const { status, text } = await readUrl(fetchImpl, url);
    const looksLikeLogin = /login|sign in|password/i.test(text);
    if (status >= 200 && status < 300 && looksLikeLogin) {
      return check("login", "PASS", "login page loaded");
    }
    return check(
      "login",
      "FAIL",
      `login page ${status}, sign-in copy missing=${!looksLikeLogin}`,
      "Open /login.html and restore the sign-in form."
    );
  } catch (err) {
    return check("login", "FAIL", String((err && err.message) || err).slice(0, 160), "Restore /login.html.");
  }
}

export async function checkApplyDoor({ fetchImpl, baseUrl }) {
  const url = `${baseUrl}/app/client-control-panel.html`;
  try {
    const { status, text } = await readUrl(fetchImpl, url);
    const looksLikeApply = /Generate Apps|Apply door|Funding · Apply/i.test(text);
    const clientEmailNotFundhub = /Apply shows the client email, not a Fundhub address/i.test(text);
    if (status >= 200 && status < 300 && looksLikeApply && clientEmailNotFundhub) {
      return check("apply", "PASS", "funding Apply door page loaded; client email, not Fundhub");
    }
    return check(
      "apply",
      "FAIL",
      `Apply door ${status}, apply copy missing=${!looksLikeApply}, client-email line missing=${!clientEmailNotFundhub}`,
      "Open Client Control Panel and restore the Funding Apply door. Do not submit a bank form."
    );
  } catch (err) {
    return check("apply", "FAIL", String((err && err.message) || err).slice(0, 160), "Restore /app/client-control-panel.html.");
  }
}

export async function checkSuggestionsDoor({ fetchImpl, baseUrl }) {
  const url = `${baseUrl}/api/read/underwrite`;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.status === 401 || res.status === 403 || (res.status >= 200 && res.status < 300)) {
      return check("suggestions", "PASS", `underwrite read door answered ${res.status}`);
    }
    if (res.status === 404) {
      return check(
        "suggestions",
        "FAIL",
        "underwrite read door is missing (404)",
        "Restore GET /api/read/underwrite. Do not change UnderwriteIQ dollar math."
      );
    }
    return check(
      "suggestions",
      "FAIL",
      `underwrite read door answered ${res.status}`,
      "Fix GET /api/read/underwrite so staff can read suggestions."
    );
  } catch (err) {
    return check("suggestions", "FAIL", String((err && err.message) || err).slice(0, 160), "Restore GET /api/read/underwrite.");
  }
}

export function checkGateRelay({ dirs, nowMs = Date.now(), staleMs = STALE_MS } = {}) {
  if (!dirs) {
    return check("gate-relay", "skip", "gate-relay is a Mac process — not on this host");
  }
  const hb = readHeartbeat(dirs);
  if (!hb) {
    return check(
      "gate-relay",
      "FAIL",
      "no heartbeat.json",
      "Start the existing messenger: node scripts/gate-relay/index.mjs watch"
    );
  }
  const at = Date.parse(hb.at || "");
  const stale = !Number.isFinite(at) || nowMs - at >= staleMs;
  const alive = hb.pid != null && isPidAlive(hb.pid);
  if (!alive || stale) {
    return check(
      "gate-relay",
      "FAIL",
      `heartbeat stale=${stale} pidAlive=${alive}`,
      "Start the existing messenger: node scripts/gate-relay/index.mjs watch. Do not build a second tripwire."
    );
  }
  return check("gate-relay", "PASS", `heartbeat fresh, pid ${hb.pid}`);
}

export async function checkRecon({ db, orgId } = {}) {
  if (!db || !orgId) {
    return check("recon", "skip", "no database in this run — Recon status not read");
  }
  const { rows } = await db.query(
    `SELECT code, status, runtime, runtime_ref
       FROM agents
      WHERE org_id = $1 AND code = $2
      LIMIT 1`,
    [orgId, AGENT_CODE]
  );
  const row = rows[0];
  if (!row) {
    return check("recon", "FAIL", "AG-07 is missing", "Re-seed Recon (AG-07). Do not invent a second watchdog.");
  }
  if (row.status !== "live" || row.runtime !== "inngest" || row.runtime_ref !== SOURCE_WORKFLOW) {
    return check(
      "recon",
      "FAIL",
      `AG-07 status=${row.status} runtime=${row.runtime} ref=${row.runtime_ref}`,
      "Turn AG-07 live on inngest / daily-pulse. Leave GHL-RECON retired."
    );
  }
  return check("recon", "PASS", "AG-07 Recon is live on daily-pulse");
}

export async function checkUnrecorded({ db, orgId, now = new Date() } = {}) {
  if (!db || !orgId) {
    return check("unrecorded", "skip", "no database in this run — unrecorded calls not read");
  }
  const rows = await listUnrecordedCalls(db, { orgId, now });
  const n = rows.length;
  if (n === 0) {
    return check("unrecorded", "PASS", "no held sales calls missing a recording or transcript");
  }
  return check(
    "unrecorded",
    "FAIL",
    `${n} sales call${n === 1 ? "" : "s"} logged with no recording and no transcript`,
    "Open My Numbers or Sales Floor. Hit Record on the next Meet. Do not auto-record. Do not text each miss."
  );
}

export async function checkGmail({ env = process.env, fetchImpl, gmailClient } = {}) {
  const cfg = gmailConfigFromEnv(env);
  if (!cfg.ready && !gmailClient) {
    return check("gmail", "skip", "Gmail oauth is not set — prove search skipped");
  }
  try {
    const client = gmailClient || createGmailClientFromConfig(cfg, { fetchImpl });
    const listed = await client.listMessages({ maxResults: 1, labelIds: [], q: "newer_than:7d" });
    return check("gmail", "PASS", `prove Gmail search returned ${listed.messages.length} id(s)`);
  } catch (err) {
    return check(
      "gmail",
      "FAIL",
      `Gmail search failed: ${String((err && err.message) || err).slice(0, 160)}`,
      "Fix prove Gmail oauth. Do not ask Chris to check mail."
    );
  }
}

export function formatScorecard({ date, dryRun, checks = [], sms, darwin } = {}) {
  const named = checks.filter((c) => c.kind !== "registry");
  const uptime = checks.filter((c) => c.kind === "registry");
  const pass = named.filter((c) => c.status === "PASS").length;
  const fail = named.filter((c) => c.status === "FAIL").length;
  const skip = named.filter((c) => c.status === "skip").length;
  const up = uptime.filter((c) => c.status === "up").length;
  const down = uptime.filter((c) => c.status === "down").length;
  const score = uptime.length
    ? `Score: ${pass} PASS / ${fail} FAIL / ${skip} skip. Uptime: ${up} up / ${down} down`
    : `Score: ${pass} PASS / ${fail} FAIL / ${skip} skip`;
  const lines = [
    `# Pulse ${date}`,
    "",
    `Timezone: ${PULSE_TZ}. Cron: \`${PULSE_CRON}\` (6:00 a.m. Arizona, all year).`,
    `Dry-run: ${dryRun ? "yes" : "no"}. **This run does not auto-fix.**`,
    "",
    score,
    "",
    "| Check | Status | Proof | Suggested fix |",
    "|---|---|---|---|"
  ];
  for (const c of named) {
    const fix = c.suggestedFix ? String(c.suggestedFix).replace(/\|/g, "/") : "—";
    lines.push(`| ${c.id} | ${c.status} | ${String(c.detail || "").replace(/\|/g, "/")} | ${fix} |`);
  }
  if (uptime.length) {
    lines.push("");
    lines.push("## Uptime");
    lines.push("");
    lines.push("| Path | Status | Proof | Suggested fix |");
    lines.push("|---|---|---|---|");
    for (const c of uptime) {
      const fix = c.suggestedFix ? String(c.suggestedFix).replace(/\|/g, "/") : "—";
      const pathLabel = c.path || c.id;
      lines.push(`| ${pathLabel} | ${c.status} | ${String(c.detail || "").replace(/\|/g, "/")} | ${fix} |`);
    }
  }
  lines.push("");
  lines.push("## Notify");
  lines.push("");
  lines.push(`- Chris SMS: ${sms?.sent ? "sent" : "not sent"} (${sms?.reason || "n/a"})`);
  lines.push(`- Darwin WhatsApp: ${darwin?.sent ? "sent" : "not sent"} (${darwin?.reason || "n/a"})`);
  if (darwin?.ticket) {
    lines.push("");
    lines.push("## Darwin ticket (written even when WhatsApp is skipped)");
    lines.push("");
    lines.push("```");
    lines.push(darwin.ticket);
    lines.push("```");
  }
  lines.push("");
  lines.push("No product code was changed by this pulse.");
  lines.push("");
  return lines.join("\n");
}

export function writeScorecard(boardDir, dateStr, markdown) {
  fs.mkdirSync(boardDir, { recursive: true });
  const file = scorecardPath(boardDir, dateStr);
  fs.writeFileSync(file, markdown, "utf8");
  return file;
}

export async function defaultOrgId(db) {
  if (!db || typeof db.query !== "function") return null;
  const { rows } = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  return rows[0]?.id || null;
}

export async function recordAgentRun(db, { orgId, dryRun, checks, detail } = {}) {
  if (!db || !orgId) return { recorded: false, reason: "no_db" };
  // A registry row fails as "down", not "FAIL". Counting only "FAIL" stamped
  // nine live runs pass while a route answered 404 (2026-09-27..10-05).
  const fail = (checks || []).some((c) => c.status === "FAIL" || c.status === "down");
  await db.query(
    `INSERT INTO agent_runs (org_id, agent_code, trigger_event, channel, mode, outcome, detail)
     VALUES ($1, $2, 'cron.daily-pulse', 'internal', $3, $4, $5)`,
    [orgId, AGENT_CODE, dryRun ? "draft" : "live", fail ? "fail" : "pass", String(detail || "").slice(0, 2000)]
  );
  return { recorded: true };
}

/**
 * runDailyPulse — the whole audit, for tests, the CLI, and Inngest.
 * Never fixes. Never pulls credit. Never charges a card. Never mails paper.
 */
export async function runDailyPulse({
  dryRun = true,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  boardDir = null,
  db = null,
  orgId = null,
  env = process.env,
  gateRelayDirs = null,
  gmailClient = null,
  sendSms = undefined,
  sendWhatsApp = undefined,
  sendPulseText = true,
  recordRun = true,
  // Staff-visibility runner for the marketing-machine rows (asStaff on live).
  // Those tables are FORCE row security and read empty on the plain app role.
  staffScope = null
} = {}) {
  const date = phoenixDate(now);
  const origin = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const checks = [];

  checks.push(await checkHealth({ fetchImpl, baseUrl: origin }));
  checks.push(await checkLogin({ fetchImpl, baseUrl: origin }));
  checks.push(await checkApplyDoor({ fetchImpl, baseUrl: origin }));
  checks.push(await checkSuggestionsDoor({ fetchImpl, baseUrl: origin }));
  checks.push(checkGateRelay({ dirs: gateRelayDirs, nowMs: now.getTime() }));
  const resolvedOrg = orgId || await defaultOrgId(db);
  checks.push(await checkRecon({ db, orgId: resolvedOrg }));
  checks.push(await checkUnrecorded({ db, orgId: resolvedOrg, now }));
  if (resolvedOrg && db) {
    checks.push(...await checkPipelineMotion({ db, orgId: resolvedOrg, now }));
  }
  checks.push(await checkGmail({ env, fetchImpl, gmailClient }));
  checks.push(...await checkMachine({ db, scope: staffScope, now }));
  checks.push(...await checkRegistry({ fetchImpl, baseUrl: origin }));
  try {
    checks.push(...await checkJobHeartbeats({ db, now }));
  } catch (err) {
    checks.push(check(
      "jobs",
      "skip",
      `job heartbeats not read: ${String((err && err.message) || err).slice(0, 160)}`
    ));
  }

  const failRows = checks.filter((c) => c.status === "FAIL" || c.status === "down");
  const findings = failRows.map((c) => `${c.id}: ${c.detail}`);
  const suggestedFixes = failRows.map((c) => c.suggestedFix).filter(Boolean);
  const pass = checks.filter((c) => c.status === "PASS" || c.status === "up").length;
  const fail = failRows.length;
  const skip = checks.filter((c) => c.status === "skip").length;

  const sms = sendPulseText
    ? await textChris({
      date,
      pass,
      fail,
      skip,
      topFails: findings,
      env,
      dryRun,
      sendImpl: sendSms
    })
    : { sent: false, reason: "replaced_by_morning_brief", body: null, to: null };

  let scorecard = null;
  try {
    const previous = resolvedOrg ? await loadPreviousScorecard(db, resolvedOrg, date) : null;
    scorecard = buildScorecard({ checks, now, previous });
    if (resolvedOrg && db) await saveScorecard(db, resolvedOrg, scorecard);
  } catch (err) {
    if (!scorecard) {
      try { scorecard = buildScorecard({ checks, now }); } catch { scorecard = null; }
    }
  }
  const darwin = await ticketDarwin({
    date,
    findings,
    suggestedFixes,
    env,
    dryRun,
    sendImpl: sendWhatsApp
  });

  const markdown = formatScorecard({ date, dryRun, checks, sms, darwin });
  let wrote = null;
  const dest = boardDir || defaultBoardDir(env);
  try {
    wrote = writeScorecard(dest, date, markdown);
  } catch (err) {
    wrote = { ok: false, error: String((err && err.message) || err).slice(0, 160) };
  }

  let agentRun = { recorded: false, reason: "dry_run_or_skipped" };
  if (!dryRun && recordRun) {
    try {
      agentRun = await recordAgentRun(db, {
        orgId: resolvedOrg,
        dryRun,
        checks,
        detail: findings.join(" | ") || "all PASS"
      });
    } catch (err) {
      agentRun = { recorded: false, reason: String((err && err.message) || err).slice(0, 160) };
    }
  }

  return {
    dryRun,
    autoFix: false,
    date,
    checks,
    findings,
    suggestedFixes,
    sms,
    scorecard,
    darwin,
    wrote,
    agentRun,
    markdown
  };
}

export function localGateRelayDirs(root = REPO_ROOT) {
  return relayDirs(path.join(root, ".fundhub-relay"));
}
