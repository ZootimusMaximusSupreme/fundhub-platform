// Contracts a client cannot sign, signed contracts with no stored file, and the sign door. Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These checks, their SQL and their verdicts used to live in
// src/pulse/coverage/gap-contracts.mjs. They moved here unchanged so the morning lane (which imports
// them back) and the hourly beat contract-signing run the same SQL and the same verdicts. A beat may
// import only from src/pulse/beats/lib, so the truth lives here.
//
//   contracts:sent-unsignable    sent or viewed, but the client still cannot sign
//   contracts:signed-not-stored  signed, but the signed file was not saved
//   the sign door verdict        a GET with no token, and a GET with a forged link, each must get the
//                                door's own 404 (judgeSignDoor; the lane wraps it as contracts:sign-route)
//
// db is anything with query(sql, params). Never signs a contract. Never edits a page. Never writes.

export const SIGN_PATH = "/api/contracts/sign";
/**
 * A link no contract owns: nil id, far-future expiry, a signature that cannot match.
 * The door checks the signature before the expiry (verifyContractUrl), so this link
 * can only answer 404 (secret set) or 503 (no secret). It can never answer 410.
 */
export const FORGED_LINK = `${SIGN_PATH}?id=00000000-0000-4000-8000-000000000000&exp=4102444800&sig=00`;
export const ROW_CAP = 50;

export const NO_SECOND =
  "Recon (AG-07) is the one tripwire. Do not add a second watchdog. Do not auto-fix from this pulse.";

/**
 * Sent or viewed, but the client still cannot sign. SELECT only.
 *
 * Mirrors what src/contracts/sign.mjs refuses, in the same order:
 *   verifyIntegrity: a frozen copy must exist (document_version_id + its checksum),
 *     and the hash of the words on the contract must equal that checksum and the
 *     contract's own body_sha. The hash is computed here the way send.mjs bodyHash
 *     does: "sha256:" plus the hex sha256 of the UTF-8 text.
 *   canSign: somebody must be able to sign now (a pending/sent/viewed signer, and
 *     in sequential order nobody unsigned ahead of them). A signer who declined
 *     leaves the contract stuck on purpose; it still shows, labeled 'declined',
 *     because only staff can void it or send a new one.
 * The DB itself refuses a sent contract with no body, no hash, or no PDF
 * (contracts_sent_has_artifact_ck), so those cases are listed only as a backstop.
 */
export const SQL_SENT = `
  /* gap:sent-unsignable */
  SELECT c.id::text AS id,
         c.template_key,
         c.status,
         CASE
           WHEN c.document_version_id IS NULL THEN 'no_anchor'
           WHEN dv.id IS NULL OR dv.checksum IS NULL THEN 'no_anchor'
           WHEN c.rendered_body IS NULL OR c.body_sha IS NULL THEN 'no_body'
           WHEN c.source_kind = 'pdf' AND c.source_document_id IS NULL THEN 'pdf_missing'
           WHEN h.sha IS DISTINCT FROM dv.checksum
             OR h.sha IS DISTINCT FROM c.body_sha THEN 'content_changed'
           WHEN EXISTS (
             SELECT 1 FROM contract_signers d
              WHERE d.contract_id = c.id AND d.status = 'declined'
           ) THEN 'declined'
           ELSE 'no_signer'
         END AS why
    FROM contracts c
    LEFT JOIN document_versions dv ON dv.id = c.document_version_id
    CROSS JOIN LATERAL (
      SELECT 'sha256:' || encode(sha256(convert_to(coalesce(c.rendered_body, ''), 'UTF8')), 'hex') AS sha
    ) h
   WHERE c.org_id = $1::uuid
     AND c.is_demo IS NOT TRUE
     AND c.status IN ('sent', 'viewed')
     AND (
       c.document_version_id IS NULL
       OR dv.id IS NULL
       OR dv.checksum IS NULL
       OR c.rendered_body IS NULL
       OR c.body_sha IS NULL
       OR (c.source_kind = 'pdf' AND c.source_document_id IS NULL)
       OR h.sha IS DISTINCT FROM dv.checksum
       OR h.sha IS DISTINCT FROM c.body_sha
       OR NOT EXISTS (
         SELECT 1
           FROM contract_signers s
          WHERE s.contract_id = c.id
            AND s.status IN ('pending', 'sent', 'viewed')
            AND (
              c.signing_order = 'parallel'
              OR NOT EXISTS (
                SELECT 1
                  FROM contract_signers ahead
                 WHERE ahead.contract_id = c.id
                   AND ahead.signer_index < s.signer_index
                   AND ahead.status <> 'signed'
              )
            )
       )
     )
   LIMIT ${ROW_CAP}`;

/**
 * Signed, but the signed file was not saved. SELECT only.
 * completeContract (src/contracts/sign.mjs) logs and carries on when the signed
 * PDF cannot be built, so the contract turns "signed" with these columns empty.
 */
export const SQL_SIGNED = `
  /* gap:signed-store */
  SELECT c.id::text AS id, c.template_key
    FROM contracts c
   WHERE c.org_id = $1::uuid
     AND c.is_demo IS NOT TRUE
     AND c.status = 'signed'
     AND (
       c.signed_document_id IS NULL
       OR c.signed_document_version_id IS NULL
       OR c.signed_body_sha IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM document_versions dv
          WHERE dv.id = c.signed_document_version_id
       )
       OR NOT EXISTS (
         SELECT 1 FROM documents d
          WHERE d.id = c.signed_document_id
       )
     )
   LIMIT ${ROW_CAP}`;

const WHY = Object.freeze({
  no_anchor: "no frozen copy to check",
  content_changed: "the words do not match the copy that was sent",
  no_body: "no words on the contract",
  pdf_missing: "the PDF file is missing",
  declined: "a signer said no, so staff must void it or send a new one",
  no_signer: "nobody can sign it"
});

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** A read that fails is a red row, not a quiet skip: a dropped column must not switch the watch off. */
export function readFailed(id, what, error) {
  return check(
    id,
    "FAIL",
    `could not read ${what}: ${error}`,
    `Read the ${what} query in src/pulse/beats/lib/contracts-truth.mjs against the live table. Do not write from this check. ${NO_SECOND}`
  );
}

export function needDb(id, db, orgId, what) {
  if (!db || !orgId) {
    return check(id, "skip", `no database in this run — ${what} not read`);
  }
  return null;
}

export async function readRows(db, sql, params) {
  try {
    const out = await db.query(sql, params);
    return { ok: true, rows: (out && out.rows) || [] };
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 160);
    return { ok: false, rows: [], error: message };
  }
}

function listIds(rows) {
  return rows
    .slice(0, 8)
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)
    .join(", ");
}

function capped(rows) {
  return rows.length >= ROW_CAP ? `at least ${ROW_CAP}` : String(rows.length);
}

/**
 * A GET with no token. 404 is the closed door, not a break.
 * Anything else (500, 405, 200 with no token, no answer) is a dead door.
 * One 404 IS a break: the router's own "no such route" answer carries a `path`.
 * The sign door's own 404 does not.
 */
export function classifyBareSignGet(status, body) {
  const code = Number(status);
  if (code === 404) {
    if (body && typeof body === "object" && typeof body.path === "string") {
      return {
        status: "FAIL",
        detail: `The router has no route for ${body.path}. GET /api/contracts/sign answers its own no-such-route 404, not the sign door's.`
      };
    }
    return {
      status: "PASS",
      detail:
        "GET /api/contracts/sign with no token returned 404. That is the closed door. It is not a break."
    };
  }
  if (code === 405) {
    return {
      status: "FAIL",
      detail: "GET on the sign link was refused. The client opens the link with GET."
    };
  }
  if (code === 200) {
    return {
      status: "FAIL",
      detail: "The sign link answered 200 with no token. It should stay closed until the link has a token."
    };
  }
  if (code === 503 || (body && body.error === "not_configured")) {
    return {
      status: "FAIL",
      detail: "The sign link says it is not configured, so a real link cannot be checked."
    };
  }
  if (code >= 500) {
    return {
      status: "FAIL",
      detail: `The sign link answered ${code}. The door is dead.`
    };
  }
  return {
    status: "FAIL",
    detail: `The sign link answered ${Number.isFinite(code) ? code : "nothing"} with no token.`
  };
}

/**
 * A GET with a well-formed link that nobody signed. With the signing secret set
 * the door answers 404 (bad signature) and never touches the database. With no
 * secret it answers 503 not_configured, and then EVERY client link is dead. The
 * bare GET cannot see that, because it is refused before the secret is read.
 */
export function classifyForgedSignGet(status, body) {
  const code = Number(status);
  if (code === 404) {
    if (body && typeof body === "object" && typeof body.path === "string") {
      return {
        status: "FAIL",
        detail: `The router has no route for ${body.path}. A forged sign link got the router's no-such-route 404, not the sign door's.`
      };
    }
    return {
      status: "PASS",
      detail:
        "A forged sign link returned 404. The signing secret is set and the door is checking links."
    };
  }
  if (code === 503 || (body && body.error === "not_configured")) {
    return {
      status: "FAIL",
      detail:
        "The sign link says it is not configured (no signing secret). Every client sign link would be dead."
    };
  }
  if (code === 200) {
    return {
      status: "FAIL",
      detail: "A forged sign link answered 200. The door is not checking the signature."
    };
  }
  if (code >= 500) {
    return {
      status: "FAIL",
      detail: `A forged sign link answered ${code}. The door crashed while checking a link.`
    };
  }
  return {
    status: "FAIL",
    detail: `A forged sign link answered ${Number.isFinite(code) ? code : "nothing"}, not the expected 404.`
  };
}

/** { status, body } from a fetch-shaped answer, or from a finished { status, body }. */
export async function probeBody(probe) {
  if (probe instanceof Error) throw probe;
  if (probe && typeof probe.text === "function") {
    const text = await probe.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: probe.status, body };
  }
  return { status: probe && probe.status, body: (probe && probe.body) || null };
}

/** The sign door gave no answer at all (refused, timed out, no network). */
export function signDoorDown(id, message) {
  return check(
    id,
    "FAIL",
    `The sign link did not answer: ${message}`,
    `Bring GET /api/contracts/sign back. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
  );
}

/**
 * Both sign door reads through a fetch-shaped `web(url, init)`, then the verdict. The hourly beat's
 * way in; the morning lane does the same two reads itself (it also takes finished probes in tests).
 */
export async function checkSignDoor(id, web, origin) {
  const base = String(origin || "").replace(/\/+$/, "");
  const get = async (path) => probeBody(await web(`${base}${path}`, { method: "GET", headers: { accept: "application/json" } }));
  let bare;
  let forged;
  try { bare = await get(SIGN_PATH); } catch (err) {
    return signDoorDown(id, String((err && err.message) || err).slice(0, 160));
  }
  try { forged = await get(FORGED_LINK); } catch (err) {
    return signDoorDown(id, String((err && err.message) || err).slice(0, 160));
  }
  return judgeSignDoor(id, bare, forged);
}

/**
 * The sign door's verdict from the bare GET and the forged-link GET ({ status, body } or null).
 * At least one must be given. The first one that is not the door's own 404 is the red.
 */
export function judgeSignDoor(id, bare, forged) {
  const fail = (detail) => check(
    id,
    "FAIL",
    detail,
    `Fix the sign link door. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
  );
  const bareVerdict = bare ? classifyBareSignGet(bare.status, bare.body) : null;
  if (bareVerdict && bareVerdict.status !== "PASS") return fail(bareVerdict.detail);
  const forgedVerdict = forged ? classifyForgedSignGet(forged.status, forged.body) : null;
  if (forgedVerdict && forgedVerdict.status !== "PASS") return fail(forgedVerdict.detail);
  const said = [bareVerdict, forgedVerdict].filter(Boolean).map((v) => v.detail).join(" ");
  return check(id, "PASS", said);
}

export async function checkSent(db, orgId) {
  const id = "contracts:sent-unsignable";
  const skipped = needDb(id, db, orgId, "sent contracts");
  if (skipped) return skipped;
  const read = await readRows(db, SQL_SENT, [orgId]);
  if (!read.ok) {
    return readFailed(id, "sent contracts", read.error);
  }
  if (read.rows.length === 0) {
    return check(id, "PASS", "No sent contract is stuck where the client cannot sign.");
  }
  const bits = read.rows.slice(0, 8).map((row) => {
    const why = WHY[row.why] || "cannot be signed";
    return `${row.id} (${why})`;
  });
  const more = read.rows.length > 8 ? ` and ${read.rows.length - 8} more` : "";
  return check(
    id,
    "FAIL",
    `${capped(read.rows)} sent contract${read.rows.length === 1 ? "" : "s"} cannot be signed: ${bits.join("; ")}${more}.`,
    `Send a fresh copy with a signer and a frozen file. Do not sign it for the client. ${NO_SECOND}`
  );
}

export async function checkStored(db, orgId) {
  const id = "contracts:signed-not-stored";
  const skipped = needDb(id, db, orgId, "signed contracts");
  if (skipped) return skipped;
  const read = await readRows(db, SQL_SIGNED, [orgId]);
  if (!read.ok) {
    return readFailed(id, "signed contracts", read.error);
  }
  if (read.rows.length === 0) {
    return check(id, "PASS", "Every signed contract has a stored copy.");
  }
  const ids = listIds(read.rows);
  return check(
    id,
    "FAIL",
    `${capped(read.rows)} signed contract${read.rows.length === 1 ? "" : "s"} ${read.rows.length === 1 ? "has" : "have"} no stored signed file${ids ? `: ${ids}` : ""}.`,
    `Save the signed file on the contract. Do not sign again as the client. ${NO_SECOND}`
  );
}
