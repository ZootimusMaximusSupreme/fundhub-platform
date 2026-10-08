// Contract and e-sign gaps for the morning pulse. Report only. Read only.
// Never signs a contract. Never edits a page. Never auto-fixes.
//
// Slice 10 already watches the chaser machine row and the registry door.
// This file does not repeat those two. A GET to the sign link with no token
// answers 404 on purpose. That closed door is not a break.
//
// Tripwire is existing Recon (AG-07) on the daily pulse. No second watchdog.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OFFERS, resolveContractTemplateKey } from "../../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_FILE = path.resolve(HERE, "../../../netlify/functions/api.mjs");

/** Same agent as src/pulse/daily-pulse.mjs. Not a new watchdog. */
const RECON_CODE = "AG-07";
const RECON_RUNTIME = "inngest";
const RECON_REF = "daily-pulse";

const SIGN_PATH = "/api/contracts/sign";
const DEFAULT_BASE_URL = "https://fundhub.ai";
const ROW_CAP = 50;

export const CHECK_IDS = Object.freeze([
  "contracts:sent-unsignable",
  "contracts:sign-route",
  "contracts:signed-not-stored",
  "contracts:template-missing",
  "contracts:tripwire"
]);

const NO_SECOND =
  "Recon (AG-07) is the tripwire. Do not add a second watchdog. Do not auto-fix from this pulse.";

/** Sent or viewed, but the client still cannot sign. SELECT only. */
export const SQL_SENT = `
  /* gap:sent-unsignable */
  SELECT c.id::text AS id,
         c.template_key,
         c.status,
         CASE
           WHEN c.document_version_id IS NULL THEN 'no_anchor'
           WHEN dv.id IS NULL OR dv.checksum IS NULL THEN 'no_anchor'
           WHEN c.body_sha IS NOT NULL
            AND dv.checksum IS NOT NULL
            AND c.body_sha IS DISTINCT FROM dv.checksum THEN 'content_changed'
           WHEN c.rendered_body IS NULL OR c.body_sha IS NULL THEN 'no_body'
           WHEN c.source_kind = 'pdf' AND c.source_document_id IS NULL THEN 'pdf_missing'
           ELSE 'no_signer'
         END AS why
    FROM contracts c
    LEFT JOIN document_versions dv ON dv.id = c.document_version_id
   WHERE c.org_id = $1::uuid
     AND c.status IN ('sent', 'viewed')
     AND (
       c.document_version_id IS NULL
       OR dv.id IS NULL
       OR dv.checksum IS NULL
       OR (
         c.body_sha IS NOT NULL
         AND dv.checksum IS NOT NULL
         AND c.body_sha IS DISTINCT FROM dv.checksum
       )
       OR c.rendered_body IS NULL
       OR c.body_sha IS NULL
       OR (c.source_kind = 'pdf' AND c.source_document_id IS NULL)
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

/** Signed, but the signed file was not saved. SELECT only. */
export const SQL_SIGNED = `
  /* gap:signed-store */
  SELECT c.id::text AS id, c.template_key
    FROM contracts c
   WHERE c.org_id = $1::uuid
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
     AND template_key = ANY($2::text[])`;

/** Existing Recon row. SELECT only. Same shape as the daily pulse. */
export const SQL_RECON = `
  /* gap:recon */
  SELECT code, status, runtime, runtime_ref
    FROM agents
   WHERE org_id = $1
     AND code = $2
   LIMIT 1`;

const WHY = Object.freeze({
  no_anchor: "no frozen copy to check",
  content_changed: "the words do not match the copy that was sent",
  no_body: "no words on the contract",
  pdf_missing: "the PDF file is missing",
  no_signer: "nobody can sign it"
});

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
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

/** True when netlify/functions/api.mjs mounts the client sign door. */
export function signRouteIsWired(source) {
  const text = source == null ? fs.readFileSync(API_FILE, "utf8") : String(source);
  return /"contracts\/sign"\s*:/.test(text);
}

/**
 * A GET with no token. 404 is the closed door, not a break.
 * Anything else (500, 405, 200 with no token, no answer) is a dead door.
 */
export function classifyBareSignGet(status, body) {
  const code = Number(status);
  if (code === 404) {
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
    return check(id, "skip", `could not read sent contracts: ${read.error}`);
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

async function checkSignRoute(ctx) {
  const id = "contracts:sign-route";
  const mounted = ctx.routeMounted == null ? signRouteIsWired() : ctx.routeMounted === true;
  if (!mounted) {
    return check(
      id,
      "FAIL",
      "The sign link route is not wired. GET /api/contracts/sign is missing from the route map.",
      `Wire GET and POST /api/contracts/sign. A GET with no token should stay a 404. That 404 is the closed door, not a break. Do not sign as a client. ${NO_SECOND}`
    );
  }

  let probe = ctx.signProbe || null;
  if (!probe && typeof ctx.fetchImpl === "function") {
    const origin = String(ctx.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const url = `${origin}${SIGN_PATH}`;
    try {
      probe = await ctx.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" }
      });
    } catch (err) {
      const message = String((err && err.message) || err).slice(0, 160);
      return check(
        id,
        "FAIL",
        `The sign link did not answer: ${message}`,
        `Bring GET /api/contracts/sign back. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
      );
    }
  }

  if (!probe) {
    return check(
      id,
      "PASS",
      "The sign link route is wired. This run did not call it. A GET with no token is a 404 on purpose."
    );
  }

  let seen;
  try {
    seen = await probeBody(probe);
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 160);
    return check(
      id,
      "FAIL",
      `The sign link did not answer: ${message}`,
      `Bring GET /api/contracts/sign back. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
    );
  }

  const verdict = classifyBareSignGet(seen.status, seen.body);
  if (verdict.status === "PASS") return check(id, "PASS", verdict.detail);
  return check(
    id,
    "FAIL",
    verdict.detail,
    `Fix the sign link door. A GET with no token should stay a 404. Do not sign as a client. ${NO_SECOND}`
  );
}

async function checkStored(db, orgId) {
  const id = "contracts:signed-not-stored";
  const skipped = needDb(id, db, orgId, "signed contracts");
  if (skipped) return skipped;
  const read = await readRows(db, SQL_SIGNED, [orgId]);
  if (!read.ok) {
    return check(id, "skip", `could not read signed contracts: ${read.error}`);
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
    return check(id, "skip", `could not read contract templates: ${read.error}`);
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

async function checkTripwire(db, orgId) {
  const id = "contracts:tripwire";
  const skipped = needDb(id, db, orgId, "Recon");
  if (skipped) return skipped;
  const read = await readRows(db, SQL_RECON, [orgId, RECON_CODE]);
  if (!read.ok) {
    return check(id, "skip", `could not read Recon: ${read.error}`);
  }
  const row = read.rows[0];
  if (!row) {
    return check(
      id,
      "FAIL",
      "AG-07 is missing",
      "Re-seed Recon (AG-07). Do not invent a second watchdog."
    );
  }
  if (row.status !== "live" || row.runtime !== RECON_RUNTIME || row.runtime_ref !== RECON_REF) {
    return check(
      id,
      "FAIL",
      `AG-07 status=${row.status} runtime=${row.runtime} ref=${row.runtime_ref}`,
      "Turn AG-07 live on inngest / daily-pulse. Leave any old recon retired. Do not invent a second watchdog."
    );
  }
  return check(
    id,
    "PASS",
    "AG-07 Recon is live on the daily pulse. That is the one tripwire."
  );
}

/**
 * @param {object} [ctx]
 * @param {object} [ctx.db] read-only query client
 * @param {string} [ctx.orgId]
 * @param {boolean} [ctx.routeMounted] test override for the route map
 * @param {Function} [ctx.fetchImpl] GET the sign door with no token. Optional.
 * @param {string} [ctx.baseUrl]
 * @param {object} [ctx.signProbe] `{ status, body }` or a fetch Response. Used instead of fetchImpl.
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  return [
    await checkSent(db, orgId),
    await checkSignRoute(ctx),
    await checkStored(db, orgId),
    await checkTemplates(db, orgId),
    await checkTripwire(db, orgId)
  ];
}
