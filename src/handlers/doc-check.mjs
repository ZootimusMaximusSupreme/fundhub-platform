// DOC-CHECK — Document Check.
//
// Seeded in db/migrations/114_ghl_agent_seed.sql against the GHL-era tag
// docs:uploaded. Nothing raises that tag. This module retriggers the seeded
// agent on docs.received for client identity / business document types.
//
// Renamed from GHL-DOC by db/migrations/310_doc_check_verified_identity.sql:
// GoHighLevel is out (owner, 2026-08-15) and this agent has only ever run on
// Inngest inside this repository.
//
// src/handlers/inquiry-docs.mjs also listens to docs.received for the inquiry
// gate. Discriminate on document type: inquiry_doc stays on that path.
// Spec 4.6 routes accept / request_more / hold here.
//
// WHAT AN ACCEPT NOW DOES. This agent is the only thing in the system that ever
// sees the client's government ID and proof of address. On accept it writes the
// name, address and date of birth it read off those images to
// pii_identity.verified_*, with the document version each field came from, so
// the dispute letters can quote a value a document actually proved instead of
// falling back to the name a closer typed on a sales call. See
// src/identity/verified.mjs.

import { byCode } from "../agents/registry.mjs";
import { callModel, classifyModelFailure, MODEL_NO_CREDIT } from "../agents/model.mjs";
import { record as recordFailedEvent } from "../events/dead-letter.mjs";
import { recordRun } from "../agents/shadow-log.mjs";
import { resolveStorageTarget } from "../documents/retrieve.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { mediaFromBytes } from "../repair/response-agent.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags, removeTags } from "../workflows/tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { FUNDING_DOC_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { SUBTYPE_TITLES } from "../documents/kinds.mjs";
import { extractVerifiedIdentity, recordVerifiedIdentity } from "../identity/verified.mjs";
import { VAULT_ONLY_SUBTYPES } from "../finance/document-vault-items.mjs";

export const AGENT_CODE = "DOC-CHECK";
export const WORKFLOW_ID = "doc-check";
export const EMAIL_DOC_03 = "EMAIL-DOC-03-APPROVED";
export const SMS_DOC_03 = "SMS-DOC-03-APPROVED";
export const SMS_DOC_02 = "SMS-DOC-02-REQUEST-MORE";

export const DOC_CHECK_TYPES = Object.freeze([
  "id_document",
  "proof_of_address",
  "articles_of_organization",
  "ssn_card",
  "proof_of_income",
  "bank_statement"
]);

export function shouldRunDocCheck(payload) {
  const p = payload || {};
  const hardKind = String(p.kind || "");
  if (hardKind === "inquiry_doc" || hardKind === "bureau_response") return false;
  /* THE VAULT'S BUSINESS PAPERS ARE NOT THIS READER'S. A business bank statement, a
     business tax return, an EIN letter, a certificate of good standing: this
     agent's prompt knows ID, proof of address and Articles, and on anything else it
     would text the client "documents approved, Round 1 shortly" or "one thing needs
     fixing" about a paper it cannot judge. Staff accept these in the vault
     (src/finance/document-vault.mjs). Every other upload is read as before. */
  if (VAULT_ONLY_SUBTYPES.includes(String(p.subtype || ""))) return false;
  if (hardKind === "client_upload") return true;
  const names = [p.kind, p.subtype].filter(Boolean).map(String);
  return DOC_CHECK_TYPES.some((t) => names.includes(t));
}

async function loadDocumentBytes(db, { documentId, versionId = null, store = null }) {
  const target = await resolveStorageTarget(db, { documentId, versionId });
  if (!target?.storage_key) return null;
  const s = store || storeFromEnv();
  const got = await s.get(target.storage_key);
  if (!got?.body) return null;
  return {
    buffer: got.body,
    mimeType: got.contentType || target.mime_type || "application/octet-stream",
    // Which exact version of the file the agent is about to read. This is the
    // provenance stamped on every verified field, so it travels with the bytes
    // rather than being looked up again later against a document that may have
    // gained a newer version in between.
    versionId: target.version_id || versionId || null
  };
}

/* ── WHEN THE READER HAS NO CREDIT ─────────────────────────────────────────
 *
 * MEASURED 2026-09-16, live walk: eight uploads in a row, eight answers of
 * `openai 429 … You have no credits remaining`, and every one of them ended
 * here as "the reader did not answer" — one task for a person and nothing else.
 * The Inngest run reported SUCCESS, so nothing ever came back to look again.
 * Repair letters cannot be staged until an ID has been read, so a dry AI account
 * froze credit repair for every client who uploaded during it, and it would have
 * stayed frozen after the account was funded: no upload, no event, no retry.
 *
 * An empty wallet is "not right now", not "no". So a temporary reader failure
 * now goes on the dead-letter queue (039_failed_events.sql) as a PENDING row
 * with a next_attempt_at, and src/workflows/doc-check-retry-sweeper.mjs comes
 * back for it on a clock. Once there is credit, the next sweep reads the file
 * and the client's record moves on its own. Nobody has to find it and re-upload.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not invent a reading. No
 * placeholder name, no address guessed off the credit report, no "we will fix it
 * later" value written to pii_identity. docs/DELIVERABLES-AND-REPAIR-TRUTH.md is
 * explicit that identity comes from the client's own documents; a letter sent in
 * the wrong name is worse than a letter sent late. Until a document is actually
 * read, the identity packet is left exactly as it was.
 *
 * WHY TWELVE ATTEMPTS AND NOT THE DEFAULT SEVEN. dead-letter backs off
 * 1m, 5m, 15m, 1h, 6h, then 24h for every attempt after that. Seven attempts
 * run out after about thirty-two hours, which is shorter than "the owner tops up
 * the account on Monday". Twelve reaches roughly nine days and then stops and
 * asks for a person. */
export const RETRY_HANDLER = WORKFLOW_ID;
export const RETRY_MAX_ATTEMPTS = 12;

/* How the task for a queued document starts. The retry sweeper closes that task
 * once the reader has answered (closeAnsweredWaits), and it finds it by this
 * prefix — so the two must never drift apart. */
export const WAITING_TASK_TITLE_PREFIX = "Waiting on the document reader";

/* THE BACKUP READER — WAITING WAS NOT THE ONLY WAY OUT.
 *
 * MEASURED 2026-09-18 on live, file #9 (hole 16 on
 * ops/workflows/live-prove-2026-09-17-notes.md): the OpenAI account had no
 * credit, so every read of the client's ID came back `openai 429 … no credits
 * remaining`. No verdict meant no "documents approved" text and no "please
 * retake it" text, and the ID stayed unread, so the dispute letters could not
 * be staged. Meanwhile the Anthropic key production holds was working the whole
 * time. callModel only turns to it when no OpenAI key is set AT ALL, so an
 * empty OpenAI wallet blocked a reader that was right there.
 *
 * So when the first read went to OpenAI and OpenAI said "no credit", the same
 * file is read once more by Anthropic. The stored OpenAI key is not touched: it
 * is only left out of this one call's copy of the environment (owner rule,
 * CLAUDE.md §11 — route around a bad credential, never remove one).
 *
 * The backup's answer is used only when it actually answered. If it failed
 * too, the first result stands and the document is queued for a later read
 * exactly as before — this never turns "not right now" into a verdict. */
export const BACKUP_READER_NOTE = "read by the backup reader (anthropic) because openai has no credit";

export async function readWithBackupReader(first, {
  env = process.env, modelArgs = {}, callModelImpl = callModel
} = {}) {
  if (!first || first.text) return null;
  if (first.request?.provider !== "openai") return null;
  if (!env || !env.ANTHROPIC_API_KEY) return null;
  const failure = classifyModelFailure({ status: first.status, error: first.error });
  if (failure.reason !== MODEL_NO_CREDIT) return null;
  const backupEnv = { ...env };
  delete backupEnv.OPENAI_API_KEY;
  delete backupEnv.COMPANY_BRAIN_OPENAI_API_KEY;
  const second = await callModelImpl({ ...modelArgs, env: backupEnv });
  if (!second || !second.text) return null;
  return { ...second, backupReader: true };
}

/* queueReaderRetry — put this document back in the queue for a later read.
 *
 * NEVER THROWS, for the same reason recordRun does not: this hangs off the end
 * of an upload that has already been stored. A queue write that fails must not
 * turn "we could not read your file yet" into a request that errors — the
 * unchecked-document task below is still raised either way, so a person still
 * hears about it.
 *
 * Needs a real event id. failed_events is unique on
 * (org_id, event_id, handler_name) with NULLS NOT DISTINCT, so queuing two
 * different documents with a null event id would collapse them into one row and
 * quietly lose one client's document. Without an id we do not queue, and the
 * run says so rather than pretending. */
export async function queueReaderRetry(db, {
  orgId, clientId, eventId, eventName = "docs.received", payload = {},
  documentId = null, versionId = null, reason = null, error = null,
  now = new Date(), recordImpl = recordFailedEvent
} = {}) {
  if (!orgId || !eventId) return { queued: false, reason: "no_event_id" };
  const res = await recordImpl(db, {
    orgId,
    eventId,
    eventName,
    clientId,
    // The version actually resolved travels with the payload, so a retry reads
    // the same bytes this run tried to read rather than whatever is newest.
    payload: { ...payload, document_id: documentId, version_id: versionId },
    handler: RETRY_HANDLER,
    error: { message: `document reader unavailable (${reason || "temporary"}): ${String(error || "").slice(0, 300)}` },
    maxAttempts: RETRY_MAX_ATTEMPTS,
    now
  });
  if (!res || res.ok !== true) {
    return { queued: false, reason: "queue_write_failed", error: res && res.error };
  }
  return { queued: true, id: res.id, attempts: res.attempts, status: res.status };
}

/* raiseUncheckedDocumentTask — a person is told when the robot could not read
 * a file.
 *
 * This is the honest half of "nothing checks a document". It does NOT check
 * anything and it must never be mistaken for a check: it says only that a file
 * arrived, that the reader did not produce a verdict on it, and that somebody
 * has to look. The identity packet is left exactly as it was.
 *
 * NEVER THROWS. It hangs off the end of an upload. A missing table, a locked
 * row or a bad role must not turn "we could not read your file" into a request
 * that fails outright — the document is already stored either way. */
export async function raiseUncheckedDocumentTask(db, {
  orgId, clientId, documentId = null, eventId = null, docType = "document", why = "",
  title = null
} = {}) {
  if (!orgId || !clientId) return { created: false, reason: "missing_ids" };
  const label = SUBTYPE_TITLES[String(docType)] || "Document";
  try {
    return await createTask(db, {
      orgId,
      clientId,
      // The title is overridable for the one case where "by hand" would be a
      // lie: the reader is coming back by itself, and the task exists so the
      // wait is visible rather than so somebody types the ID in manually.
      title: title || `Check this ${label.toLowerCase()} by hand — nobody has read it`,
      sourceWorkflow: WORKFLOW_ID,
      assigneeRole: "closer",
      eventId: eventId ? `${eventId}:unchecked` : null,
      body: [
        `A ${label.toLowerCase()} was uploaded and ${why || "nothing checked it"}.`,
        "Open the file, confirm it belongs to this client, and confirm it is readable.",
        documentId ? `Document: ${documentId}` : null
      ].filter(Boolean).join(" ")
    });
  } catch (err) {
    console.error(`[doc-check] could not raise the unchecked-document task: ${err && err.message}`);
    return { created: false, reason: "task_failed", error: String(err?.message || err) };
  }
}

export async function routeDocCheckOutcome(db, {
  orgId, clientId, eventId, json, documentId = null, versionId = null
}) {
  const outcome = String(json?.outcome || "").trim().toLowerCase();
  if (!outcome) return { routed: false, reason: "no_outcome" };

  if (outcome === "accept") {
    // Truth first, then the messages. The verified name and address are what
    // the letters quote; a send that raced ahead of the write would be a client
    // told "you are approved" while the file still carries the closer's typing.
    const read = extractVerifiedIdentity(json);
    let identity;
    try {
      identity = await recordVerifiedIdentity(db, {
        orgId,
        clientId,
        documentId,
        versionId,
        agent: AGENT_CODE,
        legalName: read.legalName,
        address: read.address,
        dateOfBirth: read.dateOfBirth
      });
    } catch (err) {
      // An accept must never end in silence — that is the exact failure
      // db/migrations/267_document_check_live.sql was written to undo. The
      // client still gets told their documents passed; the identity write is
      // reported as failed rather than swallowed.
      identity = { written: false, reason: "write_failed", error: String(err?.message || err) };
    }

    const hold = await db.query(`SELECT custom_fields FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
    const reason = hold.rows[0]?.custom_fields?.round_hold_reason;
    const patch = {
      employee_next_action: "Optimize Profile",
      doc_agent_message: null
    };
    if (reason === FUNDING_DOC_HOLD) patch.round_hold_reason = null;
    await mergeCustomFields(db, clientId, patch);
    await removeTags(db, clientId, ["docs:missing"]);
    const email = await sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_DOC_03, eventId: `${eventId}:doc-03e`
    });
    const sms = await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_DOC_03, eventId: `${eventId}:doc-03s`
    });
    return { routed: true, outcome, email, sms, identity };
  }

  if (outcome === "request_more") {
    // Nothing is recorded. A document the agent would not accept has proved
    // nothing, however much of it the model managed to read.
    const message = json.message_to_client || json.messageToClient || null;
    await mergeCustomFields(db, clientId, { doc_agent_message: message });
    const sms = await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_DOC_02, eventId: `${eventId}:doc-02s`
    });
    return { routed: true, outcome, sms, gate: "closed" };
  }

  if (outcome === "hold") {
    const holdReason = json.hold_reason || json.holdReason || "needs review";
    const task = await createTask(db, {
      orgId,
      clientId,
      title: `Document hold — ${holdReason}`,
      sourceWorkflow: WORKFLOW_ID,
      assigneeRole: "closer",
      eventId,
      body: String(holdReason)
    });
    return { routed: true, outcome, task, gate: "closed" };
  }

  return { routed: false, reason: "unknown_outcome", outcome };
}

/** Plain-English on-file facts for the model. Without this, the seeded prompt
 * claims it "can see" name/address but none were passed — false request_more. */
export function clientContextLines(client) {
  const c = client || {};
  const cf = c.custom_fields && typeof c.custom_fields === "object" ? c.custom_fields : {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
    || String(cf.full_name || cf.name || "").trim()
    || "(name not on file)";
  const line1 = String(cf.address_line1 || cf.address || cf.mailing_address || "").trim();
  const city = String(cf.address_city || cf.city || "").trim();
  const state = String(cf.address_state || cf.state || "").trim();
  const zip = String(cf.address_zip || cf.zip || "").trim();
  const addr = [line1, [city, state].filter(Boolean).join(", "), zip].filter(Boolean).join(" ").trim()
    || "(address not on file)";
  const dob = String(cf.dob || cf.date_of_birth || c.dob || "").trim() || "(DOB not on file)";
  const biz = String(cf.business_name || cf.company_name || "").trim() || "(business name not on file)";
  const today = new Date().toISOString().slice(0, 10);
  return [
    `Client on file — full name: ${name}`,
    `Client on file — personal address: ${addr}`,
    `Client on file — DOB: ${dob}`,
    `Client on file — business name: ${biz}`,
    `Today's date (UTC): ${today}. A statement period ending on or before today is not "future-dated".`,
    "You are reviewing ONE uploaded file of the stated type. Judge only that file for that type.",
    "Do not request other document types (for example Articles) when reviewing a single ID, bank statement, or SSN card.",
    "If the address printed on the ID or statement matches the personal address on file (ignore case and punctuation), treat the address as matching.",
    "ZIP+4 extras on an ID (for example 85233-1901 or 85233+1901) still match when street, city, state, and the 5-digit ZIP agree with the address on file.",
    "If this upload is an ssn_card: it is optional support. If the card is legible and the name matches the client on file, outcome must be accept. Never request_more only because an SSN card is not a photo ID or proof of address.",
    "The on-file values above are for MATCHING only. Never copy them into verified_legal_name, verified_address or verified_date_of_birth — those three carry only what is printed on the image, and null when it is not printed there."
  ];
}

export async function onDocsReceivedDocCheck(db, event, deps = {}) {
  const {
    env = process.env,
    fetchImpl,
    callModelImpl = callModel,
    loadBytesImpl = null,
    recordRunImpl = recordRun,
    routeImpl = routeDocCheckOutcome,
    queueRetryImpl = queueReaderRetry
  } = deps;

  const payload = event?.payload || {};
  if (!shouldRunDocCheck(payload)) {
    return { done: false, reason: "not_doc_check_kind" };
  }

  const orgId = event.orgId || payload.org_id || payload.orgId;
  const clientId = event.clientId || payload.client_id || payload.clientId;
  const documentId = payload.document_id || payload.documentId;
  if (!orgId || !clientId || !documentId) {
    return { done: false, reason: "missing_docs_received_fields" };
  }

  const agent = await byCode(db, { orgId, code: AGENT_CODE });
  if (!agent || !String(agent.prompt || "").trim()) {
    return { done: false, reason: "doc_check_unavailable" };
  }
  // Retired Document Check must not queue SMS-DOC-02 (or DOC-03). Status is
  // the same switch the rest of the agent runtime already honors.
  // Still write an honest agent_runs row so an upload is not a silent skip.
  const status = String(agent.status || "");
  if (status === "retired" || status === "draft") {
    const reason = status === "retired" ? "doc_check_retired" : "doc_check_not_live";
    await recordRunImpl(db, {
      orgId, agentCode: AGENT_CODE, clientId,
      triggerEvent: "docs.received", eventId: event.id || null,
      channel: "internal", outcome: reason
    });
    return { done: false, reason };
  }

  const payloadVersionId = payload.version_id || payload.versionId || null;
  /* A READ THAT THROWS USED TO ERASE THE WHOLE RUN.
     Only a null return was handled. The storage client throws instead of
     returning null whenever its own environment is not wired up — and that
     throw travelled out of here, out of step.run(), and off the end of the
     Inngest attempt. Nothing was recorded, nobody was told, and the upload
     looked exactly like an upload that had been read and passed. Every way of
     failing to get the bytes is now the same recorded outcome. */
  let loaded = null;
  let loadError = null;
  try {
    loaded = await (loadBytesImpl || loadDocumentBytes)(db, {
      documentId,
      versionId: payloadVersionId
    });
  } catch (err) {
    loadError = String(err?.message || err);
  }
  if (!loaded?.buffer) {
    await recordRunImpl(db, {
      orgId, agentCode: AGENT_CODE, clientId,
      triggerEvent: "docs.received", eventId: event.id || null,
      channel: "internal", outcome: "document_bytes_missing",
      detail: loadError
    });
    await raiseUncheckedDocumentTask(db, {
      orgId, clientId, documentId,
      eventId: event.id || documentId,
      docType: payload.subtype || payload.kind || "document",
      why: "we could not open the file that was uploaded"
    });
    return { done: false, reason: "document_bytes_missing", error: loadError };
  }
  const versionId = loaded.versionId || payloadVersionId || null;

  const clientRow = await db.query(
    `SELECT first_name, last_name, custom_fields FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  ).catch(() => ({ rows: [] }));
  const clientCtx = clientContextLines(clientRow.rows?.[0] || null);

  const schema = agent.output_schema
    ? (typeof agent.output_schema === "string" ? agent.output_schema : JSON.stringify(agent.output_schema))
    : '{"outcome":"accept|request_more|hold"}';
  const docType = payload.subtype || payload.kind;
  const modelArgs = {
    system: String(agent.prompt),
    user: [
      `A client uploaded a ${docType} document.`,
      payload.original_filename ? `Filename: ${payload.original_filename}` : "",
      ...clientCtx,
      "Read the document image. Reply with ONLY a JSON object matching this schema:",
      schema
    ].filter(Boolean).join("\n"),
    media: mediaFromBytes(loaded.mimeType, loaded.buffer),
    fetchImpl,
    maxTokens: 2000
  };
  let modelResult = await callModelImpl({ ...modelArgs, env });
  const backupResult = await readWithBackupReader(modelResult, { env, modelArgs, callModelImpl });
  if (backupResult) modelResult = backupResult;

  const json = parseAgentJson(modelResult.text);
  /* A RETRY RECORDS ITS OWN ROW. agent_runs is unique on
     (org_id, event_id, agent_code) so that a redelivered event cannot inflate
     the run counter — which also means a second run on the SAME event is
     silently dropped. Left alone, a document the reader finally managed to read
     would still show "openai 429" as its only run, forever. A retry therefore
     records with no event id (the unique index is partial — it only covers rows
     that have one) and says in the detail that it is a retry. */
  const isRetry = event?.isRetry === true;
  await recordRunImpl(db, {
    orgId, agentCode: AGENT_CODE, clientId,
    triggerEvent: "docs.received", eventId: isRetry ? null : (event.id || null),
    channel: "internal",
    mode: modelResult.mode || null,
    outcome: json?.outcome || modelResult.error || "ran",
    detail: `${isRetry ? `retry of ${event.id || documentId}: ` : ""}${modelResult.backupReader ? `${BACKUP_READER_NOTE}: ` : ""}${String(modelResult.text || modelResult.error || "")}`.slice(0, 500)
  });

  /* NO ANSWER IS NOT A PASS.
     When the model is unreachable, errors, or replies with something that is
     not the JSON it was asked for, this used to return quietly: no message, no
     job for anybody, no mark on the file. An unread document then sat on the
     client's record looking exactly like one that had been read and accepted.
     A document nobody could read is work for a person, so it becomes one. */
  let routed;
  if (json) {
    routed = await routeImpl(db, {
      orgId, clientId, eventId: event.id || documentId, json, documentId, versionId
    });
  } else {
    /* NO ANSWER, AND WHICH KIND OF NO ANSWER. "The wallet is empty" and "the
       model replied with something that is not JSON" both arrive here as a
       missing verdict, and they need opposite handling: the first will come
       right on its own once the account has credit, the second will not. */
    const failure = classifyModelFailure({
      status: modelResult.status, error: modelResult.error
    });

    let retry = { queued: false, reason: "not_temporary" };
    if (failure.temporary) {
      retry = await queueRetryImpl(db, {
        orgId, clientId,
        eventId: event.id || null,
        eventName: event.name || "docs.received",
        payload,
        documentId, versionId,
        reason: failure.reason,
        error: modelResult.error
      });
    }

    const noCredit = failure.reason === MODEL_NO_CREDIT;
    const waiting = retry.queued === true;
    const task = await raiseUncheckedDocumentTask(db, {
      orgId, clientId, documentId,
      eventId: event.id || documentId,
      docType,
      title: waiting
        ? `${WAITING_TASK_TITLE_PREFIX} — this ${(SUBTYPE_TITLES[String(docType)] || "Document").toLowerCase()} has not been read yet`
        : null,
      why: waiting
        ? (noCredit
          ? "the document reader has no credit left on the AI account, so it could not read it. "
            + "It is queued and will read it by itself once there is credit — nobody needs to re-upload anything. "
            + "If this is still here in a few days, the reader gave up and a person has to check the file"
          : `the document reader could not be reached (${failure.reason}). `
            + "It is queued and will try again by itself")
        : (modelResult.error
          ? `the document reader could not finish (${modelResult.error})`
          : "the document reader did not answer")
    });
    routed = {
      routed: false,
      reason: waiting ? "reader_unavailable_queued" : "no_json",
      temporary: failure.temporary === true,
      failure: failure.reason,
      retry,
      task,
      gate: "closed"
    };
  }

  return {
    done: true,
    agent: AGENT_CODE,
    mode: modelResult.mode || null,
    json,
    routed: routed.routed === true,
    route: routed
  };
}

export function parseAgentJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : s;
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

export default onDocsReceivedDocCheck;
