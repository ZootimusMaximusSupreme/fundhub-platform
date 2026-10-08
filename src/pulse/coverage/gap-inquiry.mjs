// Inquiry removal gaps for the morning pulse. Read only. Report only.
//
// Slice 29 already checks that the specialist doors and jobs are on the
// registry list. The registry already pings GET /api/inquiry and
// GET /api/read/inquiry-cases (a 401 is a live door). Recon (AG-07) is read by
// the daily pulse itself. This file repeats none of that. It looks for four
// breaks that those cannot see: a case that stopped moving, a funding round
// that should have a letter draft and does not, the specialist desk reads
// failing behind the login, and the inquiry upload door gone from the portal.
//
// Never POST. Never mail a bureau. Never upload an ID. Never auto-fix.

import { listCases } from "../../inquiry-ops/cases.mjs";
import { loadDocPackets } from "../../inquiry-ops/doc-gate.mjs";
import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";

/** No update for this long on a case a person should be moving. */
export const STUCK_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * The call sweeper runs every 15 minutes (see JOBS in heartbeats.mjs). A call that
 * came due and is still not fired after 3 runs of that sweeper is stuck.
 */
export const CALL_SWEEPER_CRON = "*/15 * * * *";
export const CALL_GRACE_MS = STALE_MULTIPLE * (cronIntervalMs(CALL_SWEEPER_CRON) || 15 * 60 * 1000);

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

/** Only the inquiry gate writes a draft letter. Cases from the IRA webhook never get one. */
export const GATE_SOURCE = "inquiry_gate";

export const UPLOAD_DOOR_PATH = "/app/client-portal.html";
export const UPLOAD_DOOR_MARKER = /data-kind\s*=\s*["']inquiry_doc["']/;

/**
 * A case is stuck when no person or job is going to move it on its own:
 *   1. Escalated (needs a person) and untouched for 72 hours.
 *   2. Queued, Scheduled or In Progress, with no call scheduled and none fired
 *      (so nothing is waiting on a clock), untouched for 72 hours.
 *   3. A call came due, the sweeper had 3 runs to fire it, and it did not.
 * A case with a call still to come, or a call already fired, is waiting on the
 * bureau, not stuck. Blocked cases wait on client documents (documents lane).
 */
export const STUCK_SQL = `
SELECT count(*)::int AS n
  FROM inquiry_removal_cases irc
 WHERE irc.org_id = $1::uuid
   AND irc.is_demo IS NOT TRUE
   AND irc.closed_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM clients c
      WHERE c.id = irc.client_id
        AND (c.is_demo IS TRUE OR c.custom_fields->>'synthetic' = 'true')
   )
   AND (
     (
       irc.case_status::text = 'Escalated'
       AND irc.updated_at < $2::timestamptz
     )
     OR (
       irc.case_status::text = ANY($3::text[])
       AND irc.call_due_at IS NULL
       AND irc.call_fired_at IS NULL
       AND irc.updated_at < $2::timestamptz
     )
     OR (
       irc.case_status::text = ANY($3::text[])
       AND irc.call_due_at IS NOT NULL
       AND irc.call_due_at <= $4::timestamptz
       AND irc.call_fired_at IS NULL
     )
   )`;

export const LETTER_SQL = `
SELECT count(DISTINCT irc.funding_round_id)::int AS n
  FROM inquiry_removal_cases irc
 WHERE irc.org_id = $1::uuid
   AND irc.funding_round_id IS NOT NULL
   AND irc.request_source = $3::text
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

/**
 * The exact read behind GET /api/inquiry?action=cases (api/inquiry.mjs), one row.
 * The test pins the select list to that file so the two cannot drift apart.
 */
export const DESK_CASES_SQL = `
        SELECT id, case_id, client_id, case_status, selected_bureaus_raw,
               call_fired_at, ai_call_status, open_inquiry_count, created_at
          FROM inquiry_removal_cases
         WHERE org_id = $1::uuid ORDER BY created_at DESC LIMIT 1`;

/** Never a real client. This id matches nothing, so the packet read only proves the SQL runs. */
export const NIL_CLIENT_ID = "00000000-0000-0000-0000-000000000000";

const NO_MAIL = "Do not mail a bureau from this pulse.";
const NO_FIX = "Do not auto-fix from this pulse.";

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
  const staleBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const callOverdueBefore = new Date(now.getTime() - CALL_GRACE_MS);
  try {
    const { rows } = await db.query(STUCK_SQL, [
      orgId,
      staleBefore.toISOString(),
      [...CALL_DUE_STATUSES],
      callOverdueBefore.toISOString()
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
        "no inquiry case is stale for 72 hours with nothing moving it, and no call is due and unfired"
      );
    }
    const noun = n === 1 ? "inquiry case is stuck" : "inquiry cases are stuck";
    return check(
      "inquiry:case-stuck",
      "FAIL",
      `${n} ${noun} (no update in 72 hours with nothing scheduled, or a call was due and never started)`,
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
    const { rows } = await db.query(LETTER_SQL, [orgId, [...LETTER_STATUSES], GATE_SOURCE]);
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
      `Generate the missing letter draft on the Specialist desk. A client with no real name on file gets no draft. ${NO_MAIL} ${NO_FIX}`
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

/**
 * The desk reads behind the login. A GET with no session only ever reaches the
 * 401 gate, so it cannot see a crash. These run the same reads in this process:
 *   - GET /api/read/inquiry-cases: listCases (throws on a bad query) and the
 *     document packet read (answers null when it cannot read)
 *   - GET /api/inquiry?action=cases: the select in DESK_CASES_SQL
 */
async function checkSpecialist({ db, orgId, readers }) {
  const id = "inquiry:specialist-api";
  if (!db || !orgId) {
    return check(id, "skip", "no database — specialist desk reads not run");
  }
  const cases = readers.listCases || listCases;
  const packets = readers.loadDocPackets || loadDocPackets;
  const bad = [];
  try {
    await cases(db, { orgId, activeOnly: true, limit: 1 });
  } catch (err) {
    bad.push(`/api/read/inquiry-cases case list failed: ${clip(err)}`);
  }
  try {
    const packet = await packets(db, { orgId, clientIds: [NIL_CLIENT_ID] });
    if (packet == null) bad.push("/api/read/inquiry-cases document packet read failed (the desk shows not checked)");
  } catch (err) {
    bad.push(`/api/read/inquiry-cases document packet read failed: ${clip(err)}`);
  }
  try {
    await db.query(DESK_CASES_SQL, [orgId]);
  } catch (err) {
    bad.push(`/api/inquiry?action=cases failed: ${clip(err)}`);
  }
  if (bad.length === 0) {
    return check(id, "PASS", "specialist desk reads ran on the real database (case list, document packets, desk cases)");
  }
  return check(
    id,
    "FAIL",
    `specialist desk API would fail: ${bad.join("; ")}`,
    `Fix the specialist desk read. Do not place a bureau call. ${NO_FIX}`
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

/**
 * Four rows. Shape is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 * ctx: { db, orgId, fetchImpl (or fetch), baseUrl, now }. `ctx.readers` is for tests only.
 */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const fetchImpl = typeof ctx.fetchImpl === "function"
    ? ctx.fetchImpl
    : (typeof ctx.fetch === "function" ? ctx.fetch : null);
  const baseUrl = ctx.baseUrl;
  return [
    await checkStuck({ db, orgId, now }),
    await checkLetters({ db, orgId }),
    await checkSpecialist({ db, orgId, readers: ctx.readers || {} }),
    await checkUploadDoor({ fetchImpl, baseUrl })
  ];
}
