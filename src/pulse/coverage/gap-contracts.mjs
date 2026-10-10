// Contract and e-sign gaps for the morning pulse. Report only. Read only.
// Never signs a contract. Never edits a page. Never auto-fixes.
//
// Slice 10 already watches the chaser machine row and the registry door.
// This file does not repeat those two. A GET to the sign link with no token
// answers 404 on purpose. That closed door is not a break.
//
// Recon (AG-07) is read by the daily pulse itself (id: recon). This file does
// not read it again.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OFFERS, resolveContractTemplateKey } from "../../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_FILE = path.resolve(HERE, "../../../netlify/functions/api.mjs");

const SIGN_PATH = "/api/contracts/sign";
/**
 * A link no contract owns: nil id, far-future expiry, a signature that cannot match.
 * The door checks the signature before the expiry (verifyContractUrl), so this link
 * can only answer 404 (secret set) or 503 (no secret). It can never answer 410.
 */
export const FORGED_LINK = `${SIGN_PATH}?id=00000000-0000-4000-8000-000000000000&exp=4102444800&sig=00`;
const DEFAULT_BASE_URL = "https://fundhub.ai";
const ROW_CAP = 50;
/** A hung sign door must show as a red row, not wait for the pulse's own step cut. */
const FETCH_TIMEOUT_MS = 15_000;

export const CHECK_IDS = Object.freeze([
  "contracts:sent-unsignable",
  "contracts:sign-route",
  "contracts:signed-not-stored",
  "contracts:template-missing"
]);

const NO_SECOND =
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

/** Active templates for the keys this company should already have. SELECT only. */
export const SQL_TEMPLATES = `
  /* gap:templates */
  SELECT template_key
    FROM contract_templates
   WHERE org_id = $1::uuid
     AND active = true
     AND is_demo IS NOT TRUE
     AND template_key = ANY($2::text[])`;

const WHY = Object.freeze({
  no_anchor: "no frozen copy to check",
  content_changed: "the words do not match the copy that was sent",
  no_body: "no words on the contract",
  pdf_missing: "the PDF file is missing",
  declined: "a signer said no, so staff must void it or send a new one",
  no_signer: "nobody can sign it"
});

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** A read that fails is a red row, not a quiet skip: a dropped column must not switch the watch off. */
function readFailed(id, what, error) {
  return check(
    id,
    "FAIL",
    `could not read ${what}: ${error}`,
    `Read the ${what} query in src/pulse/coverage/gap-contracts.mjs against the live table. Do not write from this check. ${NO_SECOND}`
  );
}

function needDb(id, db, orgId, what) {
  if (!db || !orgId) {
    return check(id, "skip", `no database in this run — ${what} not read`);
  }
  return null;
}

async function readRows(db, sql, params) {
  try {
    const out = await db.query(sql, params);
    return { ok: true, rows: (out && out.rows) || [] };
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 160);
    return { ok: false, rows: [], error: message };
  }
}

/**
 * Template keys a live client offer sends, plus the funding-plus-repair
 * agreement. Offers with no contract key are not in this list.
 */
export function liveContractTemplateKeys() {
  const keys = new Set();
  for (const offer of Object.values(OFFERS)) {
    if (offer && offer.contractTemplateKey) keys.add(offer.contractTemplateKey);
  }
  const combo = resolveContractTemplateKey({
    offerKey: "FUNDING_DFY",
    tier: "FUNDING_PLUS_REPAIR"
  });
  if (combo) keys.add(combo);
  return [...keys].sort();
}

function offerLabel(templateKey) {
  const names = [];
  for (const offer of Object.values(OFFERS)) {
    if (offer && offer.contractTemplateKey === templateKey && offer.name) {
      names.push(offer.name);
    }
  }
  if (templateKey === "REPAIR-AND-FUNDING-AGREEMENT") names.push("Funding plus repair");
  return names.length ? `${names.join(", ")} (${templateKey})` : templateKey;
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
 * True when netlify/functions/api.mjs mounts the client sign door.
 * Returns null when the file cannot be read (it is not in every bundle), so the
 * caller can lean on the live probe instead of crashing the whole lane.
 */
export function signRouteIsWired(source, readFile = fs.readFileSync) {
  let text;
  try {
    text = source == null ? readFile(API_FILE, "utf8") : String(source);
  } catch {
    return null;
  }
  return /"contracts\/sign"\s*:/.test(text);
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

async function probeBody(probe) {
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

async function checkSent(db, orgId) {
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

function fetchOf(ctx) {
  if (typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/** GET one path, return { status, body } or throw. */
async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  return probeBody(res);
}

async function checkSignRoute(ctx) {
  const id = "contracts:sign-route";
  // routeMounted: true / false / null (could not read the route map). Undefined reads the real file.
  const mounted = ctx.routeMounted === undefined
    ? signRouteIsWired()
    : (ctx.routeMounted === null ? null : ctx.routeMounted === true);
  if (mounted === false) {
    return check(
      id,
      "FAIL",
      "The sign link route is not wired. GET /api/contracts/sign is missing from the route map.",
      `Wire GET and POST /api/contracts/sign. A GET with no token should stay a 404. That 404 is the closed door, not a break. Do not sign as a client. ${NO_SECOND}`
    );
  }

  const fetchImpl = fetchOf(ctx);
  const origin = String(ctx.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const down = (message) => check(
    id,
    "FAIL",
    `The sign link did not answer: ${message}`,
    `Bring GET /api/contracts/sign back. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
  );
  const fail = (detail) => check(
    id,
    "FAIL",
    detail,
    `Fix the sign link door. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
  );

  // The bare GET: a test can hand in a finished probe instead of a fetch.
  let bare = null;
  if (ctx.signProbe) {
    try { bare = await probeBody(ctx.signProbe); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  } else if (fetchImpl) {
    try { bare = await getJson(fetchImpl, `${origin}${SIGN_PATH}`); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  }

  // The forged-link GET: proves the signing secret is set and the door checks links.
  let forged = null;
  if (ctx.signLinkProbe) {
    try { forged = await probeBody(ctx.signLinkProbe); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  } else if (fetchImpl && !ctx.signProbe) {
    try { forged = await getJson(fetchImpl, `${origin}${FORGED_LINK}`); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  }

  if (!bare && !forged) {
    if (mounted == null) {
      return check(id, "skip", "The sign link route could not be read from the route map and this run has no fetch.");
    }
    return check(
      id,
      "PASS",
      "The sign link route is wired. This run did not call it. A GET with no token is a 404 on purpose."
    );
  }

  const bareVerdict = bare ? classifyBareSignGet(bare.status, bare.body) : null;
  if (bareVerdict && bareVerdict.status !== "PASS") return fail(bareVerdict.detail);
  const forgedVerdict = forged ? classifyForgedSignGet(forged.status, forged.body) : null;
  if (forgedVerdict && forgedVerdict.status !== "PASS") return fail(forgedVerdict.detail);
  const said = [bareVerdict, forgedVerdict].filter(Boolean).map((v) => v.detail).join(" ");
  return check(id, "PASS", said);
}

async function checkStored(db, orgId) {
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

async function checkTemplates(db, orgId) {
  const id = "contracts:template-missing";
  const skipped = needDb(id, db, orgId, "contract templates");
  if (skipped) return skipped;
  const wanted = liveContractTemplateKeys();
  const read = await readRows(db, SQL_TEMPLATES, [orgId, wanted]);
  if (!read.ok) {
    return readFailed(id, "contract templates", read.error);
  }
  const have = new Set(read.rows.map((row) => row.template_key).filter(Boolean));
  const missing = wanted.filter((key) => !have.has(key));
  if (missing.length === 0) {
    return check(
      id,
      "PASS",
      `${wanted.length} live offer templates are on file.`
    );
  }
  return check(
    id,
    "FAIL",
    `Template missing for ${missing.length} live offer${missing.length === 1 ? "" : "s"}: ${missing.map(offerLabel).join("; ")}.`,
    `Add the missing contract template and leave it active. Do not mint a new offer. ${NO_SECOND}`
  );
}

/**
 * @param {object} [ctx]
 * @param {object} [ctx.db] read-only query client
 * @param {string} [ctx.orgId]
 * @param {boolean|null} [ctx.routeMounted] test override for the route map (null = could not read it)
 * @param {Function} [ctx.fetchImpl] GET the sign door (bare and with a forged link). Optional. ctx.fetch also works.
 * @param {string} [ctx.baseUrl]
 * @param {object} [ctx.signProbe] `{ status, body }` or a fetch Response. Used instead of the bare GET.
 * @param {object} [ctx.signLinkProbe] same shape. Used instead of the forged-link GET.
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  return [
    await checkSent(db, orgId),
    await checkSignRoute(ctx),
    await checkStored(db, orgId),
    await checkTemplates(db, orgId)
  ];
}
