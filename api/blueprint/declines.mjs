// GET  /api/blueprint/declines[?client_id=<uuid>]
// POST /api/blueprint/declines  { action, client_id?, ... }
//
// Capital Blueprint decline defense (Blueprint launch unit B1). The reading
// rules live in src/blueprint/decline-analyze.mjs; storing, the ops task and the
// outcome in src/blueprint/decline-defense.mjs. This file gates and dispatches.
//
// TWO CALLERS, the gate pattern of api/money/overview.mjs:
//   * a signed-in CLIENT acts on their own file only. client_id comes off the
//     SESSION; one in the query or body is never read on this branch. A client
//     may read their status in plain words, paste a decline letter, and link a
//     letter file they uploaded. Nothing else.
//   * STAFF: requireRole(ROLE_SETS.STAFF) — the gate api/applications.mjs puts on
//     bank decisions — + requireClientInOrg on client_id. The role check is its
//     own call; requireAuth drops a `roles` key (CLAUDE.md §12). Lender-book
//     lines in the plan are shown only to ROLE_SETS.LENDERS (owner call
//     2026-08-17); every other staff role gets the plan with those lines hidden.
//
// GET  → { ok, view }            the client's view (both callers)
//        { ok, view, staff }     plus the staff view (staff only)
// POST actions:
//   paste        { text, bank?, product?, application_id? }       client or staff
//   record       { bank? | application_id, product?, declined_on?, bureaus_pulled?,
//                  text?, letter_document_id?, recon_on? }         staff
//   link_letter  { decline_id, document_id }                      client or staff
//   step         { decline_id, step_key, status, filled_text? }   staff
//   schedule     { decline_id, recon_on }                         staff
//   outcome      { decline_id, outcome, approved_amount?, reapply_on?, notes? }  staff
//
// Writes need a paid Capital Blueprint (403 not_blueprint_buyer otherwise).
// Nothing here calls a bank, sends a text, or moves money.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, allowsRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  readDeclines, recordDecline, linkLetter, setStepStatus, scheduleRecon, recordOutcome,
  clientAnalysis, DeclineInputError, CLIENT_PASTES_PER_DAY
} from "../../src/blueprint/decline-defense.mjs";

const STAFF_ACTIONS = new Set(["paste", "record", "link_letter", "step", "schedule", "outcome"]);
const CLIENT_ACTIONS = new Set(["paste", "link_letter"]);

const REFUSALS = {
  not_blueprint_buyer: [403, "Decline help is part of the Capital Blueprint. This client has not bought it."],
  too_many_pastes: [429, `That is ${CLIENT_PASTES_PER_DAY} letters today. A Fundhub person will read them. Send more tomorrow.`]
};

/** Who is asking, and for which file. Returns { orgId, clientId, kind, staff,
 *  canSeeBook } or writes the refusal and returns null. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client", staff: null, canSeeBook: false, by: { kind: "client" } };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return {
    orgId: staff.org_id,
    clientId,
    kind: "staff",
    staff: { id: staff.id || principal.staffId || null, name: staff.name || principal.name || null, email: staff.email || principal.email || null },
    canSeeBook: allowsRole(ROLE_SETS.LENDERS, staff.role),
    by: { kind: "staff", staffId: staff.id || principal.staffId || null, name: staff.name || principal.name || null, email: staff.email || principal.email || null }
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const store = {
    read: deps.readDeclines || readDeclines,
    record: deps.recordDecline || recordDecline,
    link: deps.linkLetter || linkLetter,
    step: deps.setStepStatus || setStepStatus,
    schedule: deps.scheduleRecon || scheduleRecon,
    outcome: deps.recordOutcome || recordOutcome
  };

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const who = await scope(req, res, { database, gate, body });
  if (!who) return;
  const { orgId, clientId } = who;

  try {
    if (method === "GET") {
      const out = await store.read(database, {
        orgId, clientId, viewer: who.kind === "staff" ? { kind: "staff", canSeeBook: who.canSeeBook } : { kind: "client" }
      });
      if (!out) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(who.kind === "staff" ? { ok: true, view: out.view, staff: out.staff } : { ok: true, view: out.view });
    }

    const action = String(body.action || "");
    const allowed = who.kind === "staff" ? STAFF_ACTIONS : CLIENT_ACTIONS;
    if (!STAFF_ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });
    if (!allowed.has(action)) {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Only Fundhub staff can change this part of the plan." });
    }

    let out;
    if (action === "paste" || action === "record") {
      const input = {
        text: body.text,
        bank: body.bank,
        product: body.product,
        application_id: body.application_id || null
      };
      if (who.kind === "staff") {
        Object.assign(input, {
          declined_on: body.declined_on,
          bureaus_pulled: body.bureaus_pulled,
          letter_document_id: body.letter_document_id || null,
          recon_on: body.recon_on
        });
      }
      if (action === "paste" && !String(body.text || "").trim()) {
        return res.status(400).json({ ok: false, error: "letter_required", message: "Paste the whole letter or email from the bank." });
      }
      out = await store.record(database, {
        orgId, clientId, by: who.by, staff: who.staff, input, now: clock(),
        source: who.kind === "client" ? "client_paste" : "staff"
      });
      if (out && out.ok) {
        // Answer with the decline as this caller sees it. The raw analysis (it
        // carries lender-book lines) never goes back as it is.
        const read = out.decline_id
          ? await store.read(database, {
            orgId, clientId, viewer: who.kind === "staff" ? { kind: "staff", canSeeBook: who.canSeeBook } : { kind: "client" }
          })
          : null;
        if (who.kind === "staff") {
          const d = read && read.staff && read.staff.declines.find((x) => x.id === out.decline_id);
          out = { ok: true, created: !!out.created, duplicate: !!out.duplicate, task_created: !!(out.task && out.task.created), decline: d || null };
        } else {
          const d = read && read.view && read.view.declines.find((x) => x.id === out.decline_id);
          out = { ok: true, created: !!out.created, duplicate: !!out.duplicate, decline: d || null, analysis: clientAnalysis(out.analysis) };
        }
      }
    } else if (action === "link_letter") {
      out = await store.link(database, { orgId, clientId, declineId: body.decline_id, documentId: body.document_id, by: who.by });
    } else if (action === "step") {
      out = await store.step(database, {
        orgId, clientId, declineId: body.decline_id, stepKey: body.step_key, status: body.status,
        filledText: body.filled_text ?? null, by: who.by
      });
    } else if (action === "schedule") {
      out = await store.schedule(database, { orgId, clientId, declineId: body.decline_id, reconOn: body.recon_on });
    } else {
      out = await store.outcome(database, {
        orgId, clientId, declineId: body.decline_id, outcome: body.outcome,
        approvedAmount: body.approved_amount ?? null, reapplyOn: body.reapply_on ?? null,
        notes: body.notes ?? null, staff: who.staff, by: who.by
      });
    }

    if (!out || out.ok !== true) {
      const error = (out && out.error) || "not_saved";
      const [status, message] = REFUSALS[error] || [400, null];
      return res.status(status).json({ ok: false, error, ...(message ? { message } : {}) });
    }
    return res.status(action === "paste" || action === "record" ? (out.created ? 201 : 200) : 200).json({ ok: true, action, ...out });
  } catch (e) {
    if (e instanceof DeclineInputError) return res.status(e.status || 400).json({ ok: false, error: e.code, message: e.message });
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
