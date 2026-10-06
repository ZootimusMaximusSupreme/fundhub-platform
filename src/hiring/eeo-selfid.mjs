// Voluntary EEO self-identification — invite path, held APART from hiring.
//
// COMPLIANCE REVIEW REQUIRED — demographic data for bias audits (053_eeo_selfid.sql).
//
// THE WHOLE DESIGN IS UNLINKABILITY. Invites carry application_id only until the
// response lands; submit_eeo_response (Postgres) inserts the row and nulls the
// link in one transaction. This module never reads eeo_responses back alongside
// candidate_applications, and hiring endpoints must never query these tables.

import { randomBytes } from "node:crypto";
import { renderTemplate } from "../lib/render-template.mjs";
import { emailTarget } from "./outreach.mjs";

export const EEO_EMAIL_KEY = "EMAIL-CANDIDATE-EEO-INVITE";
export const SOURCE_WORKFLOW = "hiring-eeo-invite";

/** Allowed values — must match 053_eeo_selfid.sql CHECK constraints. */
export const EEO_FIELDS = Object.freeze({
  race_ethnicity: Object.freeze([
    "hispanic_or_latino", "white", "black_or_african_american",
    "native_hawaiian_or_pacific_islander", "asian",
    "american_indian_or_alaska_native", "two_or_more_races", "decline_to_state"
  ]),
  gender: Object.freeze(["male", "female", "non_binary", "decline_to_state"]),
  veteran_status: Object.freeze([
    "protected_veteran", "not_a_protected_veteran", "decline_to_state"
  ]),
  disability_status: Object.freeze(["yes", "no", "decline_to_state"])
});

const TOKEN_BYTES = 32;

export function mintSurveyToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function surveyUrl(token, baseUrl = "https://fundhub.ai") {
  const root = String(baseUrl || "https://fundhub.ai").replace(/\/$/, "");
  return `${root}/eeo-survey.html?token=${encodeURIComponent(token)}`;
}

function firstName(full) {
  const first = String(full || "").trim().split(/\s+/)[0];
  return first || "there";
}

function pickField(body, key) {
  const raw = body?.[key];
  if (raw == null || raw === "") return null;
  const val = String(raw).trim();
  if (!EEO_FIELDS[key].includes(val)) {
    return { ok: false, error: "invalid_field", field: key };
  }
  return { ok: true, value: val };
}

/** Parse a voluntary survey POST. Every field is optional; decline_to_state is valid. */
export function parseEeoBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const token = String(body.token || "").trim();
  if (token.length < 32) return { ok: false, error: "invalid_token" };

  const out = { ok: true, token };
  for (const key of Object.keys(EEO_FIELDS)) {
    const picked = pickField(body, key);
    if (!picked.ok) return picked;
    out[key] = picked.value;
  }
  return out;
}

/** Token status for the public GET — no PII, no application id. */
export async function getSurveyStatus(db, token) {
  const t = String(token || "").trim();
  if (t.length < 32) return { ok: false, error: "invalid_token" };

  const { rows } = await db.query(
    `SELECT i.consumed_at IS NOT NULL AS consumed,
            (r.id IS NOT NULL) AS responded
       FROM eeo_survey_invites i
       LEFT JOIN eeo_responses r ON r.invite_id = i.id
      WHERE i.survey_token = $1`,
    [t]);

  if (!rows[0]) return { ok: false, error: "invalid_token" };
  if (rows[0].consumed || rows[0].responded) {
    return { ok: true, already_submitted: true, fields: fieldSchema() };
  }
  return { ok: true, already_submitted: false, fields: fieldSchema(), voluntary: true };
}

export function fieldSchema() {
  return {
    race_ethnicity: { label: "Race / ethnicity (EEO-1)", options: EEO_FIELDS.race_ethnicity, optional: true },
    gender: { label: "Gender", options: EEO_FIELDS.gender, optional: true },
    veteran_status: { label: "Veteran status", options: EEO_FIELDS.veteran_status, optional: true },
    disability_status: { label: "Disability status", options: EEO_FIELDS.disability_status, optional: true }
  };
}

/** Create one invite per application. Idempotent on application_id. */
export async function createInvite(tx, { orgId, applicationId, invitedAtStage = null } = {}) {
  if (!orgId) throw new Error("createInvite: orgId is required");
  if (!applicationId) throw new Error("createInvite: applicationId is required");

  const existing = await tx.query(
    `SELECT id, survey_token, consumed_at FROM eeo_survey_invites
      WHERE application_id = $1`,
    [applicationId]);
  if (existing.rows[0]) {
    return { invite: existing.rows[0], created: false };
  }

  const token = mintSurveyToken();
  const { rows } = await tx.query(
    `INSERT INTO eeo_survey_invites (org_id, application_id, survey_token, invited_at_stage)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [orgId, applicationId, token, invitedAtStage]);

  return { invite: rows[0], created: true };
}

/** The one write path — Postgres function destroys the application link atomically. */
export async function submitEeoResponse(db, parsed) {
  const { rows } = await db.query(
    `SELECT submit_eeo_response($1, $2, $3, $4, $5) AS id`,
    [parsed.token, parsed.race_ethnicity, parsed.gender, parsed.veteran_status, parsed.disability_status]);
  const id = rows[0]?.id;
  if (id === null) return { ok: true, already_submitted: true };
  if (!id) return { ok: false, error: "submit_failed" };
  return { ok: true, submitted: true };
}

/** Queue the invite email. Writes a messages row only — dispatch sends it. */
export async function queueInviteEmail(db, {
  orgId, toAddress, firstName: name, token, baseUrl = null
} = {}) {
  if (!orgId || !toAddress || !token) {
    throw new Error("queueInviteEmail: orgId, toAddress and token are required");
  }

  const tpl = (await db.query(
    `SELECT template_key, channel, subject, body
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2 AND channel = 'email'`,
    [orgId, EEO_EMAIL_KEY])).rows[0];
  if (!tpl) return { queued: false, reason: "no_template" };

  const ctx = {
    candidate: { first_name: name || "there" },
    survey: { url: surveyUrl(token, baseUrl) }
  };
  const body = renderTemplate(tpl.body, ctx);
  const subject = tpl.subject ? renderTemplate(tpl.subject, ctx) : null;
  const providerRef = `${SOURCE_WORKFLOW}:${token.slice(0, 16)}`;

  const { rows } = await db.query(
    `INSERT INTO messages
       (org_id, client_id, direction, channel, template_key, rendered_body,
        provider, provider_ref, status, compliance_check_passed, to_address, subject)
     VALUES ($1, NULL, 'outbound', 'email', $2, $3, NULL, $4, 'queued', true, $5, $6)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, EEO_EMAIL_KEY, body, providerRef, toAddress, subject]);

  return { queued: !!rows[0]?.id, messageId: rows[0]?.id || null };
}

/** Mint invite + queue mail for one application. Called after apply(), not from the form. */
export async function sendInviteForApplication(db, {
  orgId, applicationId, baseUrl = null
} = {}) {
  if (!orgId || !applicationId) {
    throw new Error("sendInviteForApplication: orgId and applicationId are required");
  }

  const app = (await db.query(
    `SELECT a.id, a.org_id, s.key AS stage_key,
            c.full_name, c.email, c.email_opt_out_at
       FROM candidate_applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN pipeline_stages s ON s.id = a.stage_id
      WHERE a.id = $1 AND a.org_id = $2`,
    [applicationId, orgId])).rows[0];
  if (!app) return { ok: false, reason: "application_not_found" };

  const to = emailTarget(app);
  if (!to) return { ok: false, reason: "no_email" };

  const { invite, created } = await createInvite(db, {
    orgId,
    applicationId,
    invitedAtStage: app.stage_key
  });

  if (invite.consumed_at) return { ok: true, reason: "already_answered", created: false };

  const mail = await queueInviteEmail(db, {
    orgId,
    toAddress: to,
    firstName: firstName(app.full_name),
    token: invite.survey_token,
    baseUrl
  });

  return { ok: true, created, inviteId: invite.id, queued: mail.queued };
}

/** Aggregate read — v_eeo_aggregate only. Never selects eeo_responses directly. */
/* orgId is REQUIRED and binds the read to the caller's company. v_eeo_aggregate
   carries org_id on every row, and until 2026-10-05 this read returned every
   company's rows to any COMPLIANCE caller (api/read/eeo-aggregate.mjs; caught by
   src/http/read-endpoints-org-scope.test.mjs). No org, no rows — never "all". */
export async function fetchEeoAggregate(db, { orgId = null, roleKey = null } = {}) {
  if (!orgId) return [];
  const params = [orgId];
  let where = "WHERE org_id = $1::uuid";
  if (roleKey) {
    params.push(roleKey);
    where += ` AND role_key = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT org_id, role_key, race_ethnicity, gender, responses, hired, rejected,
            selection_rate_pct
       FROM v_eeo_aggregate
      ${where}
      ORDER BY role_key, race_ethnicity, gender`,
    params);
  return rows;
}

/** Prove the link is severed — for tests only. */
export async function inviteLinkSevered(db, inviteId) {
  const { rows } = await db.query(
    `SELECT application_id, consumed_at IS NOT NULL AS consumed
       FROM eeo_survey_invites WHERE id = $1`,
    [inviteId]);
  return rows[0]?.consumed === true && rows[0]?.application_id === null;
}

export default {
  EEO_EMAIL_KEY,
  EEO_FIELDS,
  SOURCE_WORKFLOW,
  mintSurveyToken,
  parseEeoBody,
  getSurveyStatus,
  fieldSchema,
  createInvite,
  submitEeoResponse,
  queueInviteEmail,
  sendInviteForApplication,
  fetchEeoAggregate,
  inviteLinkSevered
};
