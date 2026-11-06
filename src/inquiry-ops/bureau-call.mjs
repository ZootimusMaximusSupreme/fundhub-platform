// Launch a bureau dispute call for an inquiry removal case.
// COMPLIANCE REVIEW REQUIRED — dials a bureau with client identity.
//
// In-repo only: Postgres case + PII, vendor prompt builders, Bland via
// src/messaging/providers/bland-voice.mjs. No external host, no BASE URL.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { revealSsn } from "../pii/index.mjs";
import { recordDispatch } from "../lib/outbound-calls.mjs";
import { placeConfiguredCall, normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { menuSteps } from "./bureau-dial-plan.mjs";

const require = createRequire(import.meta.url);
const VENDOR = join(dirname(fileURLToPath(import.meta.url)), "../../vendor/inquiry-remover");
const { buildCallPacket, buildCallMetadata } = require(join(VENDOR, "src/lib/packet-builder.js"));
const { resolveSex, pickVoice } = require(join(VENDOR, "src/lib/client-sex.js"));
const { buildExperianCallConfig } = require(join(VENDOR, "src/agents/experian-prompt.js"));
const { buildEquifaxCallConfig } = require(join(VENDOR, "src/agents/equifax-prompt.js"));
const { buildTransUnionCallConfig } = require(join(VENDOR, "src/agents/transunion-prompt.js"));

const BUREAU_CONFIGS = Object.freeze({
  EX: buildExperianCallConfig,
  EQ: buildEquifaxCallConfig,
  TU: buildTransUnionCallConfig
});

export class BureauCallError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function firstBureau(raw) {
  const part = String(raw || "EX").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)[0];
  return part || "EX";
}

export function clientRequestedBureauTask(existingTask) {
  return [
    "You are Fundhub's automated assistant calling with the client's signed authorization about their saved inquiry case.",
    "When a person answers, disclose that you are Fundhub's automated assistant calling on behalf of the client and that the call may be recorded. Never claim to be the client.",
    "Use only the provided client identity to identify the authorized file. Use the bureau menu steps below only to reach the appropriate representative.",
    "Discuss only the listed inquiries and the client's existing submission. Ask what evidence or follow-up the bureau needs and obtain a reference and timeline.",
    "Never claim identity theft, unauthorized accounts, a police/FTC report, a CFPB complaint, or the absence of a fraud alert without verified evidence. A menu option is not proof of any of those facts.",
    "Never answer unknown security questions by guessing. Ask for the client's participation or transfer to the Fundhub representative when required.",
    "A representative's statement is a call outcome, not proof that an inquiry disappeared from the report. Record the response for verification.",
    "Client: {{client_first_name}} {{client_last_name}}. Address: {{client_address}}, {{client_city}}, {{client_state}} {{client_zip}}. Inquiries: {{inquiry_list}}.",
    "Bureau menu navigation:", ...menuSteps(existingTask)
  ].join("\n");
}

/**
 * @returns {Promise<{ ok:true, callId:string, bureau:string, caseId:string }>}
 */
export async function launchBureauCallForCase(db, {
  orgId,
  caseId,
  staffId,
  expectedClientId = null,
  accountId = null,
  clientRequested = false,
  inquiryIds = null,
  env = process.env,
  fetchImpl,
  placeCallImpl = placeConfiguredCall
} = {}) {
  if (!orgId || !caseId) {
    throw new BureauCallError("case_required", "Which inquiry case should we call for?");
  }

  const { rows: caseRows } = await db.query(
    `SELECT id, client_id, selected_bureaus_raw, case_status, call_fired_at
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid AND id = $2::uuid
      LIMIT 1`,
    [orgId, caseId]
  );
  const caseRow = caseRows[0];
  if (!caseRow) {
    throw new BureauCallError("not_found", "That inquiry case was not found.", 404);
  }
  if (expectedClientId && String(caseRow.client_id) !== String(expectedClientId)) {
    throw new BureauCallError("client_not_found", "That inquiry case is unavailable.", 404);
  }
  if (caseRow.case_status === "Canceled" || caseRow.case_status === "Completed") {
    throw new BureauCallError("case_closed", "This case is closed, so no call was placed.", 409);
  }

  const bureau = firstBureau(caseRow.selected_bureaus_raw);
  const buildConfig = BUREAU_CONFIGS[bureau];
  if (!buildConfig) {
    throw new BureauCallError("bad_bureau", `Bureau ${bureau} is not supported for phone calls.`);
  }

  const transfer = String(env.FUNDHUB_REP_NUMBER || "").trim();
  if (!transfer) {
    throw new BureauCallError(
      "rep_number_required",
      "Set FUNDHUB_REP_NUMBER so the robot has a Fundhub transfer line.",
      503
    );
  }

  const { rows: clientRows } = await db.query(
    `SELECT id, first_name, last_name, phone
       FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [caseRow.client_id, orgId]
  );
  const client = clientRows[0];
  if (!client) {
    throw new BureauCallError("client_not_found", "The client on this case was not found.", 404);
  }

  const { rows: idRows } = await db.query(
    `SELECT dob, addresses
       FROM pii_identity
      WHERE client_id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [client.id, orgId]
  );
  const identity = idRows[0] || {};
  const addresses = Array.isArray(identity.addresses)
    ? identity.addresses
    : (typeof identity.addresses === "string"
      ? JSON.parse(identity.addresses || "[]")
      : []);
  const addr = addresses[0] || {};

  let ssn;
  try {
    ({ ssn } = await revealSsn(db, {
      clientId: client.id,
      accessedBy: staffId || (accountId ? `account:${accountId}` : "inquiry-bureau-call"),
      reason: "bureau_dispute_call",
      env
    }));
  } catch (err) {
    throw new BureauCallError(
      err.status === 404 ? "ssn_required" : "ssn_reveal_failed",
      err.message || "Could not load SSN for this call.",
      err.status || 409
    );
  }

  const { rows: inqRows } = await db.query(
    `SELECT inquiry, created_at
       FROM inquiry_log
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND (
          inquiry_removal_case_id = $3::uuid
          OR upper(coalesce(bureau,'')) = $4
        )
        AND ($5::uuid[] IS NULL OR id = ANY($5::uuid[]))
      ORDER BY created_at ASC
      LIMIT 40`,
    [orgId, client.id, caseId, bureau, inquiryIds]
  );
  const inquiries = inqRows.map((r) => ({
    creditorName: r.inquiry || "Unauthorized inquiry",
    date: r.created_at ? String(r.created_at).slice(0, 10) : ""
  }));

  const clientData = {
    firstName: client.first_name,
    middleName: "",
    lastName: client.last_name,
    ssn,
    dob: identity.dob || "",
    phone: normalizePhone(client.phone) || client.phone || "",
    sex: null,
    address: {
      line1: addr.address_line1 || addr.addressLine1 || addr.line1 || addr.street || "",
      city: addr.address_city || addr.city || "",
      state: addr.address_state || addr.state || "",
      zip: addr.address_zip || addr.zip || addr.zip5 || addr.postal || ""
    }
  };

  let requestData;
  try {
    requestData = buildCallPacket(clientData, inquiries, transfer, bureau);
  } catch (err) {
    throw new BureauCallError("packet_invalid", err.message || "Client data is incomplete for a bureau call.", 409);
  }

  const voice = pickVoice(resolveSex(clientData.sex, clientData.firstName));
  const metadata = buildCallMetadata(String(client.id), bureau);
  const callConfig = buildConfig(requestData, {
    metadata,
    voice,
    webhookUrl: String(env.BLAND_WEBHOOK_URL || "").trim() || undefined
  });

  const result = await placeCallImpl({
    phoneNumber: callConfig.phoneNumber,
    task: clientRequested ? clientRequestedBureauTask(callConfig.task) : callConfig.task,
    requestData: callConfig.requestData,
    voice: callConfig.voice,
    waitForGreeting: callConfig.waitForGreeting,
    maxDuration: callConfig.maxDuration,
    transferNumber: transfer,
    metadata: { ...metadata, org_id: orgId, case_id: caseId, placed_by: staffId || null,
      ...(accountId ? { requested_account_id: accountId } : {}) },
    webhookUrl: callConfig.webhookUrl,
    env,
    fetchImpl
  });

  if (result.status !== "sent" || !result.callId) {
    throw new BureauCallError(
      result.reason || result.status || "call_failed",
      result.error || "The bureau call could not be placed.",
      result.blocked ? 503 : 502
    );
  }

  try {
    await recordDispatch({
      callId: result.callId,
      clientId: client.id,
      orgId,
      kind: "inquiry_bureau",
      db
    });
  } catch (err) {
    console.error(`[bureau-call] dispatch record failed for ${result.callId}: ${err && err.message}`);
  }

  await db.query(
    `UPDATE inquiry_removal_cases
        SET call_fired_at = coalesce(call_fired_at, now()),
            ai_call_status = 'calling',
            updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, caseId]
  );

  return {
    ok: true,
    callId: result.callId,
    bureau,
    caseId,
    clientId: client.id
  };
}

export default { launchBureauCallForCase, BureauCallError };
