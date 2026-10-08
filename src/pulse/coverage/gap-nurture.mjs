// Nurture breakage for the morning pulse. Read only.
// Tripwire is existing Recon (AG-07). Do not add another watcher.
// Never sends a text or email. Never flips messaging_settings.outbound_enabled.
//
// The nurture coverage slice already names N-01 through N-06 and the next-step
// catch-up, including which of those jobs are retired or unwired. This file
// does not repeat that list. It only reads the three breaks below, and only
// for a sequence the workflow file has turned on.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** 3x the 5-minute dispatch schedule. A row younger than this is still in flight. */
export const QUEUE_GRACE_MS = 15 * 60 * 1000;

/** N-06 sleeps 180 days (step.sleep "180d") before it writes a send row. */
export const RENEWAL_WAIT_MS = 180 * 24 * 60 * 60 * 1000;

export const CHECK_IDS = Object.freeze([
  "nurture:never-queued",
  "nurture:step-stuck",
  "nurture:on-without-send"
]);

/** Workflow files this lane owns. N-05 has no file; slice 16 already says so. */
export const NURTURE_WORKFLOW_FILES = Object.freeze([
  "src/workflows/n-01-cold-nurture.mjs",
  "src/workflows/n-02-warm-nurture.mjs",
  "src/workflows/n-03-hot-nurture.mjs",
  "src/workflows/n-04-post-funding-nurture.mjs",
  "src/workflows/n-06-renewal-second-wave.mjs"
]);

/** Live send pairs. A retired sequence is not in this list. */
export const SEND_PAIRS = Object.freeze([
  {
    id: "n-04-post-funding-nurture",
    email: "EMAIL-N04-POST-FUNDING",
    sms: "SMS-N04-POST-FUNDING",
    event: "round.closeout"
  },
  {
    id: "n-06-renewal-second-wave",
    email: "EMAIL-N06-RENEWAL",
    sms: "SMS-N06-RENEWAL",
    event: "round.funded"
  }
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not send a text or email. Do not flip outbound.";

export const NEVER_QUEUED_SQL = `
  /* gap:nurture-never-queued */
  SELECT count(*)::int AS n
    FROM (
      SELECT e.id
        FROM events e
        JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
       WHERE $4::boolean IS TRUE
         AND e.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND e.name = 'round.closeout'
         AND (
           e.payload->>'stage' = 'closed'
           OR lower(COALESCE(e.payload->>'engagementComplete', '')) = 'true'
         )
         AND e.created_at < $2::timestamptz
         AND NOT EXISTS (
           SELECT 1
             FROM messages m
            WHERE m.org_id = e.org_id
              AND m.client_id = e.client_id
              AND m.direction = 'outbound'
              AND m.channel IN ('email', 'sms')
              AND m.provider_ref IN (
                'workflow:EMAIL-N04-POST-FUNDING:' || e.id::text,
                'workflow:SMS-N04-POST-FUNDING:' || e.id::text
              )
         )
      UNION ALL
      SELECT e.id
        FROM events e
        JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
       WHERE $5::boolean IS TRUE
         AND e.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND e.name = 'round.funded'
         AND e.created_at < $3::timestamptz
         AND EXISTS (
           SELECT 1
             FROM funding_rounds fr
            WHERE fr.client_id = e.client_id
              AND COALESCE(fr.funded_amount, 0) > 0
         )
         AND NOT EXISTS (
           SELECT 1
             FROM messages m
            WHERE m.org_id = e.org_id
              AND m.client_id = e.client_id
              AND m.direction = 'outbound'
              AND m.channel IN ('email', 'sms')
              AND m.provider_ref IN (
                'workflow:EMAIL-N06-RENEWAL:' || e.id::text,
                'workflow:SMS-N06-RENEWAL:' || e.id::text
              )
         )
    ) q
`;

export const STEP_STUCK_SQL = `
  /* gap:nurture-step-stuck */
  SELECT count(*)::int AS n
    FROM (
      SELECT m.id::text AS k
        FROM messages m
        JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
       WHERE m.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND m.direction = 'outbound'
         AND m.template_key = ANY($3::text[])
         AND m.status = 'sending'
         AND COALESCE(m.last_attempt_at, m.updated_at, m.created_at) < $2::timestamptz
      UNION ALL
      SELECT m.id::text
        FROM messages m
        JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
       WHERE m.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND m.direction = 'outbound'
         AND m.template_key = ANY($3::text[])
         AND m.status = 'queued'
         AND (m.scheduled_at IS NULL OR m.scheduled_at <= $2::timestamptz)
         AND m.created_at < $2::timestamptz
         AND COALESCE((
           SELECT s.outbound_enabled
             FROM messaging_settings s
            WHERE s.org_id = m.org_id
         ), true) IS TRUE
      UNION ALL
      SELECT m.provider_ref
        FROM messages m
        JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
       WHERE $4::boolean IS TRUE
         AND m.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND m.direction = 'outbound'
         AND m.template_key IN ('EMAIL-N04-POST-FUNDING', 'SMS-N04-POST-FUNDING')
         AND m.created_at < $2::timestamptz
         AND split_part(COALESCE(m.provider_ref, ''), ':', 3) <> ''
         AND NOT EXISTS (
           SELECT 1
             FROM messages other
            WHERE other.org_id = m.org_id
              AND other.client_id = m.client_id
              AND other.direction = 'outbound'
              AND other.provider_ref = (
                'workflow:' ||
                CASE m.template_key
                  WHEN 'EMAIL-N04-POST-FUNDING' THEN 'SMS-N04-POST-FUNDING'
                  ELSE 'EMAIL-N04-POST-FUNDING'
                END || ':' || split_part(m.provider_ref, ':', 3)
              )
         )
      UNION ALL
      SELECT m.provider_ref
        FROM messages m
        JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
       WHERE $5::boolean IS TRUE
         AND m.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND m.direction = 'outbound'
         AND m.template_key IN ('EMAIL-N06-RENEWAL', 'SMS-N06-RENEWAL')
         AND m.created_at < $2::timestamptz
         AND split_part(COALESCE(m.provider_ref, ''), ':', 3) <> ''
         AND NOT EXISTS (
           SELECT 1
             FROM messages other
            WHERE other.org_id = m.org_id
              AND other.client_id = m.client_id
              AND other.direction = 'outbound'
              AND other.provider_ref = (
                'workflow:' ||
                CASE m.template_key
                  WHEN 'EMAIL-N06-RENEWAL' THEN 'SMS-N06-RENEWAL'
                  ELSE 'EMAIL-N06-RENEWAL'
                END || ':' || split_part(m.provider_ref, ':', 3)
              )
         )
    ) q
`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function clip(err) {
  return String(err?.message || err).slice(0, 180);
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function skipString(source, i) {
  const quote = source[i];
  for (let j = i + 1; j < source.length; j += 1) {
    if (source[j] === "\\") {
      j += 1;
      continue;
    }
    if (source[j] === quote) return j;
  }
  return -1;
}

function readBalanced(source, open, close, start) {
  if (source[start] !== open) return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const end = skipString(source, i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function triggerIsLive(triggerText) {
  const stripped = triggerText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
  if (/^\[\s*\]$/.test(stripped)) return false;
  return /\b(?:event|cron)\s*:/.test(stripped);
}

function hasSendCall(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return /sendTemplated\s*\(/.test(stripped);
}

/** Sequences whose createFunction trigger is live (not [] and not enabled: false). */
export function findSequences(source) {
  const found = [];
  const needle = "inngest.createFunction(";
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    let i = skipWs(source, at + needle.length);
    const config = readBalanced(source, "{", "}", i);
    if (!config) break;
    i = skipWs(source, config.end);
    if (source[i] !== ",") break;
    i = skipWs(source, i + 1);
    const open = source[i];
    const trigger = open === "["
      ? readBalanced(source, "[", "]", i)
      : open === "{"
        ? readBalanced(source, "{", "}", i)
        : null;
    if (!trigger) break;
    const idMatch = /id\s*:\s*["']([^"']+)["']/.exec(config.text);
    const enabledOff = /enabled\s*:\s*false/.test(config.text);
    found.push({
      id: idMatch ? idMatch[1] : "nurture-sequence",
      on: !enabledOff && triggerIsLive(trigger.text)
    });
    from = trigger.end;
  }
  return found;
}

/**
 * Turned-on nurture sequences in the workflow files.
 * Each item is { id, file, on, sends }.
 */
export function listLiveSequences(readText = defaultReadText) {
  const live = [];
  for (const file of NURTURE_WORKFLOW_FILES) {
    const source = readText(file);
    const sends = hasSendCall(source);
    for (const seq of findSequences(source)) {
      if (seq.on) live.push({ id: seq.id, file, on: true, sends });
    }
  }
  return live;
}

export function liveFlags(live) {
  const ids = new Set(live.map((seq) => seq.id));
  return {
    n04: ids.has("n-04-post-funding-nurture"),
    n06: ids.has("n-06-renewal-second-wave")
  };
}

export function liveTemplateKeys(live) {
  const ids = new Set(live.map((seq) => seq.id));
  const keys = [];
  for (const pair of SEND_PAIRS) {
    if (ids.has(pair.id)) keys.push(pair.email, pair.sms);
  }
  return keys;
}

export function nurtureCutoffs(now) {
  const t = now.getTime();
  return {
    queueBefore: new Date(t - QUEUE_GRACE_MS).toISOString(),
    renewalBefore: new Date(t - RENEWAL_WAIT_MS - QUEUE_GRACE_MS).toISOString()
  };
}

function onWithoutSendRow(live) {
  const id = "nurture:on-without-send";
  const broken = live.filter((seq) => !seq.sends);
  if (broken.length === 0) {
    return row(id, "PASS", "every turned-on nurture sequence writes a send row");
  }
  const names = broken.map((seq) => `${seq.id} (${seq.file})`).join("; ");
  return row(
    id,
    "FAIL",
    `${plural(broken.length, "nurture sequence")} turned on and no send row is written: ${names}.`,
    `${RECON} Put sendTemplated back on that sequence so a messages row can be queued.`
  );
}

async function checkNeverQueued({ db, orgId, now, flags }) {
  const id = "nurture:never-queued";
  if (!flags.n04 && !flags.n06) {
    return row(id, "PASS", "no nurture sequence is turned on, so a missing send is not a miss");
  }
  const cut = nurtureCutoffs(now);
  try {
    const result = await db.query(NEVER_QUEUED_SQL, [
      orgId,
      cut.queueBefore,
      cut.renewalBefore,
      flags.n04,
      flags.n06
    ]);
    const n = countOf(result);
    if (n === 0) {
      return row(id, "PASS", "no lead or client is missing a nurture text or email the live sequence should have queued");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "lead or client")} should have a nurture text or email and nothing was queued.`,
      `${RECON} Read that closeout or funded event and the messages row for the same event.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read the nurture queue: ${clip(err)}`,
      `${RECON} Read events and messages for the live nurture sequence.`
    );
  }
}

async function checkStepStuck({ db, orgId, now, flags, keys }) {
  const id = "nurture:step-stuck";
  if (!flags.n04 && !flags.n06) {
    return row(id, "PASS", "no nurture sequence is turned on, so no step is in flight");
  }
  const cut = nurtureCutoffs(now);
  try {
    const result = await db.query(STEP_STUCK_SQL, [
      orgId,
      cut.queueBefore,
      keys,
      flags.n04,
      flags.n06
    ]);
    const n = countOf(result);
    if (n === 0) {
      return row(id, "PASS", "no live nurture step is stuck");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "nurture step")} stuck (still sending, still queued while outbound is already on, or one channel of the pair never queued).`,
      `${RECON} Read that nurture message. Leave outbound as it is.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read nurture steps: ${clip(err)}`,
      `${RECON} Read messages for the live nurture sequence. Leave outbound as it is.`
    );
  }
}

/**
 * Three read-only checks. ctx: { db, orgId, now, readText }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;

  let live = null;
  let readError = null;
  try {
    live = listLiveSequences(readText);
  } catch (err) {
    readError = err;
  }

  const codeRow = readError
    ? row(
      "nurture:on-without-send",
      "FAIL",
      `could not read nurture sequences: ${clip(readError)}`,
      `${RECON} Read the nurture workflow files. Do not add another watcher.`
    )
    : onWithoutSendRow(live);

  if (!db || !orgId) {
    return [
      row("nurture:never-queued", "skip", "no database in this run — nurture queue not read"),
      row("nurture:step-stuck", "skip", "no database in this run — nurture steps not read"),
      codeRow
    ];
  }

  if (readError) {
    return [
      row(
        "nurture:never-queued",
        "FAIL",
        `could not read which nurture sequences are on: ${clip(readError)}`,
        `${RECON} Read the nurture workflow files before scoring the queue.`
      ),
      row(
        "nurture:step-stuck",
        "FAIL",
        `could not read which nurture sequences are on: ${clip(readError)}`,
        `${RECON} Read the nurture workflow files before scoring a stuck step.`
      ),
      codeRow
    ];
  }

  const flags = liveFlags(live);
  const keys = liveTemplateKeys(live);
  return [
    await checkNeverQueued({ db, orgId, now, flags }),
    await checkStepStuck({ db, orgId, now, flags, keys }),
    codeRow
  ];
}
