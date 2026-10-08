// Inquiry removal gaps for the morning pulse. Read only. Report only.
//
// Slice 29 already checks that the specialist doors and jobs are on the
// registry list. This file does not repeat that list. It looks for four
// breaks: a case that stopped moving, a funding round that should have a
// letter draft and does not, the specialist desk API answering 500, and the
// inquiry upload door dead.
//
// Tripwire is existing Recon (AG-07) on daily-pulse. This file reads that
// one row. It does not start a second watchdog.
//
// Never POST. Never mail a bureau. Never upload an ID. Never auto-fix.

export const STUCK_AFTER_MS = 72 * 60 * 60 * 1000;

/** Open cases the desk or the 15-minute sweeper should still be moving. */
export const OPEN_MOVE_STATUSES = Object.freeze([
  "Queued",
  "Scheduled",
  "In Progress",
  "Escalated"
]);

/** Same three the call sweeper is allowed to move. Escalated is not one of them. */
export const CALL_DUE_STATUSES = Object.freeze(["Queued", "Scheduled", "In Progress"]);

/** Gate writes a draft for any of these while the round still has open inquiries. */
export const LETTER_STATUSES = Object.freeze([
  "Queued",
  "Scheduled",
  "In Progress",
  "Escalated",
  "Blocked"
]);

export const AGENT_CODE = "AG-07";
export const SOURCE_WORKFLOW = "daily-pulse";

export const SPECIALIST_GETS = Object.freeze([
  "/api/read/inquiry-cases",
  "/api/inquiry?action=cases"
]);

export const UPLOAD_DOOR_PATH = "/app/client-portal.html";
export const UPLOAD_DOOR_MARKER = /data-kind\s*=\s*["']inquiry_doc["']/;

export const STUCK_SQL = `
SELECT count(*)::int AS n
  FROM inquiry_removal_cases irc
 WHERE irc.org_id = $1::uuid
   AND irc.is_demo IS NOT TRUE
   AND irc.closed_at IS NULL
   AND irc.case_status::text = ANY($2::text[])
   AND NOT EXISTS (
     SELECT 1 FROM clients c
      WHERE c.id = irc.client_id
        AND (c.is_demo IS TRUE OR c.custom_fields->>'synthetic' = 'true')
   )
   AND (
     irc.updated_at < $3::timestamptz
     OR (
       irc.call_due_at IS NOT NULL
       AND irc.call_due_at <= $4::timestamptz
       AND irc.call_fired_at IS NULL
       AND irc.case_status::text = ANY($5::text[])
     )
   )`;

export const LETTER_SQL = `
SELECT count(DISTINCT irc.funding_round_id)::int AS n
  FROM inquiry_removal_cases irc
 WHERE irc.org_id = $1::uuid
   AND irc.funding_round_id IS NOT NULL
   AND irc.open_inquiry_count > 0
   AND irc.is_demo IS NOT TRUE
   AND irc.case_status::text = ANY($2::text[])
   AND irc.letter_provider_id IS NULL
   AND irc.draft_letter_document_id IS NULL
   AND (irc.letter_draft_html IS NULL OR btrim(irc.letter_draft_html) = '')
   AND NOT EXISTS (
     SELECT 1 FROM clients c
      WHERE c.id = irc.client_id
        AND (c.is_demo IS TRUE OR c.custom_fields->>'synthetic' = 'true')
   )`;

export const RECON_SQL = `SELECT code, status, runtime, runtime_ref
       FROM agents
      WHERE org_id = $1 AND code = $2
      LIMIT 1`;

const NO_MAIL = "Do not mail a bureau from this pulse.";
const NO_FIX = "Do not auto-fix from this pulse.";
const NO_SECOND = "Do not invent a second watchdog.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).slice(0, 160);
}

function countOf(rows) {
  const n = Number(rows && rows[0] ? rows[0].n : 0);
  return Number.isFinite(n) ? n : null;
}

function originOf(baseUrl) {
  const raw = String(baseUrl || "https://fundhub.ai").trim() || "https://fundhub.ai";
  return raw.replace(/\/+$/, "");
}

function apiAlive(status) {
  return (
    (status >= 200 && status < 300) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "text/html,application/json" }
  });
  let text = "";
  if (res && typeof res.text === "function") text = String((await res.text()) || "");
  return { status: Number(res && res.status), text };
}

async function checkStuck({ db, orgId, now }) {
  if (!db || !orgId) {
    return check("inquiry:case-stuck", "skip", "no database — stuck inquiry cases not read");
  }
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  try {
    const { rows } = await db.query(STUCK_SQL, [
      orgId,
      [...OPEN_MOVE_STATUSES],
      stuckBefore.toISOString(),
      now.toISOString(),
      [...CALL_DUE_STATUSES]
    ]);
    const n = countOf(rows);
    if (n == null) {
      return check(
        "inquiry:case-stuck",
        "FAIL",
        "stuck inquiry case count was not a number",
        `Read inquiry_removal_cases. ${NO_MAIL} ${NO_FIX}`
      );
    }
    if (n === 0) {
      return check(
        "inquiry:case-stuck",
        "PASS",
        "no open inquiry case is stale for 72 hours or past a due call that never started"
      );
    }
    const noun = n === 1 ? "inquiry case is stuck" : "inquiry cases are stuck";
    return check(
      "inquiry:case-stuck",
      "FAIL",
      `${n} ${noun} (no update in 72 hours, or a call was due and never started)`,
      `Open the Specialist desk and move the stuck inquiry cases. ${NO_MAIL} ${NO_FIX}`
    );
  } catch (err) {
    return check(
      "inquiry:case-stuck",
      "FAIL",
      `could not read inquiry cases: ${clip(err)}`,
      `Read inquiry_removal_cases. ${NO_MAIL} ${NO_FIX}`
    );
  }
}

async function checkLetters({ db, orgId }) {
  if (!db || !orgId) {
    return check("inquiry:letter-round", "skip", "no database — letter drafts not read");
  }
  try {
    const { rows } = await db.query(LETTER_SQL, [orgId, [...LETTER_STATUSES]]);
    const n = countOf(rows);
    if (n == null) {
      return check(
        "inquiry:letter-round",
        "FAIL",
        "letter-round count was not a number",
        `Read inquiry letter drafts. ${NO_MAIL} ${NO_FIX}`
      );
    }
    if (n === 0) {
      return check(
        "inquiry:letter-round",
        "PASS",
        "every funding round that still has open inquiries has a letter draft or a letter already sent"
      );
    }
    const noun = n === 1 ? "funding round has" : "funding rounds have";
    return check(
      "inquiry:letter-round",
      "FAIL",
      `${n} ${noun} open inquiries and no letter draft`,
      `Generate the missing letter draft on the Specialist desk. ${NO_MAIL} ${NO_FIX}`
    );
  } catch (err) {
    return check(
      "inquiry:letter-round",
      "FAIL",
      `could not read letter drafts: ${clip(err)}`,
      `Read inquiry letter drafts. ${NO_MAIL} ${NO_FIX}`
    );
  }
}

async function checkSpecialist({ fetchImpl, baseUrl }) {
  if (!fetchImpl) {
    return check("inquiry:specialist-api", "skip", "no fetch — specialist desk API not read");
  }
  const origin = originOf(baseUrl);
  const bad = [];
  try {
    for (const path of SPECIALIST_GETS) {
      const { status } = await readGet(fetchImpl, `${origin}${path}`);
      if (!apiAlive(status)) bad.push(`${path} ${status}`);
    }
  } catch (err) {
    return check(
      "inquiry:specialist-api",
      "FAIL",
      `specialist desk API unreachable: ${clip(err)}`,
      `Restore GET /api/read/inquiry-cases and GET /api/inquiry?action=cases. Do not place a bureau call. ${NO_FIX}`
    );
  }
  if (bad.length === 0) {
    return check(
      "inquiry:specialist-api",
      "PASS",
      "specialist desk API answered on the case list (GET only)"
    );
  }
  const fiveHundred = bad.some((line) => /\s5\d\d$/.test(line));
  return check(
    "inquiry:specialist-api",
    "FAIL",
    fiveHundred
      ? `specialist desk API 500: ${bad.join("; ")}`
      : `specialist desk API down: ${bad.join("; ")}`,
    `Fix the specialist desk API. Do not place a bureau call. ${NO_FIX}`
  );
}

async function checkUploadDoor({ fetchImpl, baseUrl }) {
  if (!fetchImpl) {
    return check("inquiry:upload-door", "skip", "no fetch — inquiry upload door not read");
  }
  const url = `${originOf(baseUrl)}${UPLOAD_DOOR_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url);
    const hasDoor = UPLOAD_DOOR_MARKER.test(text);
    if (status >= 200 && status < 300 && hasDoor) {
      return check(
        "inquiry:upload-door",
        "PASS",
        "inquiry upload door is on the portal page"
      );
    }
    return check(
      "inquiry:upload-door",
      "FAIL",
      `upload door dead: portal ${status}, inquiry_doc box missing=${!hasDoor}`,
      `Restore the inquiry upload box on the client portal. Do not upload a real ID. ${NO_FIX}`
    );
  } catch (err) {
    return check(
      "inquiry:upload-door",
      "FAIL",
      `upload door dead: ${clip(err)}`,
      `Restore the inquiry upload box on the client portal. Do not upload a real ID. ${NO_FIX}`
    );
  }
}

async function checkRecon({ db, orgId }) {
  if (!db || !orgId) {
    return check("recon", "skip", "no database in this run — Recon status not read");
  }
  try {
    const { rows } = await db.query(RECON_SQL, [orgId, AGENT_CODE]);
    const row = rows && rows[0];
    if (!row) {
      return check("recon", "FAIL", "AG-07 is missing", `Re-seed Recon (AG-07). ${NO_SECOND}`);
    }
    if (row.status !== "live" || row.runtime !== "inngest" || row.runtime_ref !== SOURCE_WORKFLOW) {
      return check(
        "recon",
        "FAIL",
        `AG-07 status=${row.status} runtime=${row.runtime} ref=${row.runtime_ref}`,
        `Turn AG-07 live on inngest / daily-pulse. ${NO_SECOND}`
      );
    }
    return check("recon", "PASS", "AG-07 Recon is live on daily-pulse");
  } catch (err) {
    return check(
      "recon",
      "FAIL",
      `could not read Recon: ${clip(err)}`,
      `Read agents where code is AG-07. ${NO_SECOND}`
    );
  }
}

/** Five rows. Shape is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip. */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const fetchImpl = ctx.fetchImpl || null;
  const baseUrl = ctx.baseUrl;
  return [
    await checkStuck({ db, orgId, now }),
    await checkLetters({ db, orgId }),
    await checkSpecialist({ fetchImpl, baseUrl }),
    await checkUploadDoor({ fetchImpl, baseUrl }),
    await checkRecon({ db, orgId })
  ];
}
