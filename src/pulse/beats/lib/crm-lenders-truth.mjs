// crm-lenders-truth: the two lender-book checks of the morning CRM lane, shared with the hourly beat.
//
//   crm-data:lenders          the bank book is not empty, and the bank list read returns banks
//   crm-data:lender-matches   the bank match read answers for a client on file, and sees the book
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These two checks used to live only in
// src/pulse/coverage/gap-crm-links.mjs. Their SQL, their verdicts and the small helpers they lean on
// moved here unchanged, so the morning lane and the hourly beat lender-book judge with the same code.
// The lane imports all of it back and keeps every other check where it was.
//
// HOW EACH CLOCK READS. The checks take a db with query(sql, params) and two readers, listLenders and
// matchForClient. The morning lane hands in its plain database handle and the real readers from
// src/lenders/store.mjs. The hourly beat hands in the read box (ctx.read) and ./lender-store.mjs, a word
// for word copy of those readers that lender-store.test.mjs holds equal to the originals.
//
// NOTHING TO JUDGE IS NOT GREEN. With no client on file the match read has nobody to match, so
// crm-data:lender-matches is a skip, exactly as in the morning lane. It is never a PASS.
//
// Read only. SELECT only. No send, no write, no web call.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RECON = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse.";

/** The two checks this file judges, in the order the lane reports them. */
export const LENDER_CHECK_IDS = Object.freeze(["crm-data:lenders", "crm-data:lender-matches"]);

export const NO_DB_WHY = "no database in this run — records not read";
export const NO_ORG_WHY = "no org id in this run — records not read";

export function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

export function row(id, status, detail, suggestedFix = null) {
  return {
    id,
    status,
    detail: clip(detail, 500),
    suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null
  };
}

export function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
}

export async function one(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows && out.rows[0]) || {};
}

export const CLIENT_PICK_SQL = `
  /* gap:crm-client */
  SELECT id::text AS id
    FROM clients
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
   ORDER BY created_at DESC
   LIMIT 1
`;

export const LENDER_COUNT_SQL = `
  /* gap:crm-lender-count */
  SELECT count(*)::int AS n
    FROM lenders
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
`;

/** The newest real client, the one the record reads are run for. A read error is kept, not hidden. */
export async function pickClient(db, orgId) {
  let clientId = null;
  let pickError = null;
  try {
    const picked = await one((fn) => fn(db), CLIENT_PICK_SQL, [orgId]);
    clientId = UUID_RE.test(String(picked.id || "")) ? String(picked.id) : null;
  } catch (err) {
    pickError = errText(err);
  }
  return { clientId, pickError };
}

/** Banks on file for the match check. A failed read counts as none, as it always has. */
export async function readLenderCount(db, orgId) {
  let lenderCount = 0;
  try {
    lenderCount = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n) || 0;
  } catch {
    lenderCount = 0;
  }
  return lenderCount;
}

/** A record read that needs a client, when there is none: skip, or FAIL when picking one threw. */
export function noClientRow(id, pickError) {
  const why = pickError ? `could not pick a client (${pickError})` : "no client on file — the record reads were not run";
  const status = pickError ? "FAIL" : "skip";
  const fix = pickError ? `Read the clients table. ${RECON}` : null;
  return row(id, status, why, fix);
}

/** A library read whose code would not load. */
export function readersMissingRow(id, loadError) {
  return row(id, "FAIL", `the record read code would not load: ${loadError}`, `Restore src/lenders/store.mjs and src/tradelines/store.mjs. ${RECON}`);
}

export async function checkLenders(db, readers, orgId) {
  const id = "crm-data:lenders";
  try {
    const count = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n);
    const list = await readers.listLenders(db, { orgId, limit: 5 });
    if (!Array.isArray(list)) {
      return row(id, "FAIL", "the bank list read did not return a list", `Open Lenders. Restore listLenders. ${RECON}`);
    }
    if (!Number.isFinite(count) || count === 0) {
      return row(
        id,
        "FAIL",
        "the bank book is empty, so the client control panel has no bank to open",
        `Load the lender book on Lenders. ${RECON}`
      );
    }
    if (list.length === 0) {
      return row(
        id,
        "FAIL",
        `${count} banks are on file and the bank list read came back empty`,
        `Open Lenders from the client control panel. The list should show. ${RECON}`
      );
    }
    return row(id, "PASS", `${count} banks on file and the bank list read returned banks`);
  } catch (err) {
    return row(id, "FAIL", `the bank list read threw: ${errText(err)}`, `Open Lenders. Restore the bank list read. ${RECON}`);
  }
}

export async function checkLenderMatches(db, readers, orgId, clientId, lenderCount) {
  const id = "crm-data:lender-matches";
  try {
    const result = await readers.matchForClient(db, { orgId, clientId });
    if (!result || !result.summary || !Array.isArray(result.matches)) {
      return row(
        id,
        "FAIL",
        result ? "the bank match read did not return a match list for a client on file" : "a client is on file and the bank match read says there is no such client",
        `Open the client control panel. Restore the bank match read. ${RECON}`
      );
    }
    const book = result.summary.lender_count;
    if (lenderCount > 0 && Number(book) === 0) {
      return row(
        id,
        "FAIL",
        "banks are on file but the client match read says the bank book is empty",
        `Open Lenders and the client control panel. The bank list should show. ${RECON}`
      );
    }
    const n = result.summary.match_count == null ? result.matches.length : result.summary.match_count;
    return row(id, "PASS", `the bank match read answered for a client on file with ${n} matches`);
  } catch (err) {
    return row(id, "FAIL", `the bank match read threw: ${errText(err)}`, `Open the client control panel. Restore the bank match read. ${RECON}`);
  }
}

/**
 * runLenderBookChecks({ db, orgId, readers }) → [crm-data:lenders row, crm-data:lender-matches row]
 * The two checks, put together the way the morning lane's gapChecks puts them together: no database or
 * no org id skips both, readers that will not load fail both, no client on file skips the match check.
 * db: anything with query(sql, params). readers: { listLenders, matchForClient }. SELECT only.
 */
export async function runLenderBookChecks({ db = null, orgId = null, readers = null } = {}) {
  const orgRaw = String(orgId || "").trim();
  const org = UUID_RE.test(orgRaw) ? orgRaw : null;
  if (!db || typeof db.query !== "function") return LENDER_CHECK_IDS.map((id) => row(id, "skip", NO_DB_WHY));
  if (!org) return LENDER_CHECK_IDS.map((id) => row(id, "skip", NO_ORG_WHY));
  if (!readers || typeof readers.listLenders !== "function" || typeof readers.matchForClient !== "function") {
    return LENDER_CHECK_IDS.map((id) => readersMissingRow(id, "no lender readers were handed in"));
  }
  const lenders = await checkLenders(db, readers, org);
  const { clientId, pickError } = await pickClient(db, org);
  if (!clientId) return [lenders, noClientRow("crm-data:lender-matches", pickError)];
  const lenderCount = await readLenderCount(db, org);
  return [lenders, await checkLenderMatches(db, readers, org, clientId, lenderCount)];
}
