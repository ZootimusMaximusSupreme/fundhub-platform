// GET /api/read/search?q=<term> — one org-scoped search across the CRM.
//
// Searches clients, contracts, documents, conversations/messages, and pipeline
// cards. One endpoint, one role gate, session org only — the same posture as
// read/inbox and read/documents (audit C1): a caller never picks their tenancy.
//
// ROLE_SETS.STAFF. Same set that already reads a client's file, contracts,
// documents, inbox and pipeline. A closer sees what a closer can already open;
// a partner / client / affiliate session is refused. Narrower FINANCE / HIRING
// / OPS surfaces are deliberately NOT searched here — those endpoints already
// gate themselves, and search must not become a side door into them.
//
// Hand-rolled rather than readHandler: the answer is five named groups, not a
// flat page of rows. Pagination still applies as a per-group cap.
//
// Empty `q` is an honest empty answer, not a 400 — typing into a search box
// starts empty, and telling the screen that is an error would flash a failure
// on every keystroke before the first character.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  requireRole, ROLE_SETS, redact, boundedLimit, CLIENT_DATA_ERRORS
} from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

const PER_GROUP_CAP = 8;
const MAX_Q = 200;

/* Escape ILIKE metacharacters so a search for "100%" means those characters,
   not "anything ending in 00". */
export function likePattern(raw) {
  const s = String(raw == null ? "" : raw).trim().slice(0, MAX_Q);
  if (!s) return null;
  return "%" + s.replace(/([\\%_])/g, "\\$1") + "%";
}

export function emptyGroups() {
  return {
    clients: [],
    contracts: [],
    documents: [],
    conversations: [],
    cards: []
  };
}

function clientHref(id) {
  return "/app/client-control-panel.html?id=" + encodeURIComponent(id);
}

function mapClient(row) {
  const name = String(row.title || "").trim() || "Unnamed client";
  const bits = [row.email, row.phone, row.business_name].filter(Boolean);
  return {
    type: "client",
    id: row.id,
    title: name,
    subtitle: bits.join(" · ") || "Client",
    href: clientHref(row.id),
    client_id: row.id
  };
}

function mapContract(row) {
  const client = String(row.client_name || "").trim() || "Unnamed client";
  return {
    type: "contract",
    id: row.id,
    title: row.title || "Untitled contract",
    subtitle: [row.status, client].filter(Boolean).join(" · "),
    href: "/app/contracts.html?client_id=" + encodeURIComponent(row.client_id),
    client_id: row.client_id
  };
}

function mapDocument(row) {
  const client = String(row.client_name || "").trim();
  const href = row.client_id
    ? "/app/documents.html?client_id=" + encodeURIComponent(row.client_id)
    : "/app/documents.html";
  return {
    type: "document",
    id: row.id,
    title: row.title || row.document_key || "Untitled document",
    subtitle: [row.kind, client].filter(Boolean).join(" · ") || "Document",
    href,
    client_id: row.client_id || null
  };
}

function mapConversation(row) {
  const name = String(row.client_name || "").trim() || "Unnamed client";
  const preview = String(row.preview || "").trim();
  return {
    type: "conversation",
    id: row.id,
    title: name,
    subtitle: [String(row.channel || "").toUpperCase(), preview].filter(Boolean).join(" · ")
      || "Conversation",
    href: "/app/messaging.html?conversation_id=" + encodeURIComponent(row.id),
    client_id: row.client_id,
    channel: row.channel || null
  };
}

function mapCard(row) {
  const name = String(row.client_name || row.partner_name || "").trim() || "Unnamed";
  const stage = [row.pipeline_name, row.stage_name].filter(Boolean).join(" / ");
  const href = row.client_id
    ? clientHref(row.client_id)
    : "/app/pipeline.html";
  return {
    type: "card",
    id: row.id,
    title: name,
    subtitle: stage || "Pipeline card",
    href,
    client_id: row.client_id || null,
    stage_id: row.stage_id || null
  };
}

async function searchClients(database, orgId, pattern, limit) {
  const r = await database.query(
    `SELECT DISTINCT ON (c.id)
            c.id,
            TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS title,
            c.email,
            c.phone,
            COALESCE(b.name, c.custom_fields->>'business_name') AS business_name
       FROM clients c
       LEFT JOIN businesses b ON b.client_id = c.id AND b.org_id = c.org_id
      WHERE c.org_id = $1::uuid
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND (
          c.first_name ILIKE $2 ESCAPE '\\'
          OR c.last_name ILIKE $2 ESCAPE '\\'
          OR TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
             ILIKE $2 ESCAPE '\\'
          OR c.email ILIKE $2 ESCAPE '\\'
          OR c.phone ILIKE $2 ESCAPE '\\'
          OR c.custom_fields->>'business_name' ILIKE $2 ESCAPE '\\'
          OR b.name ILIKE $2 ESCAPE '\\'
        )
      ORDER BY c.id, c.updated_at DESC NULLS LAST
      LIMIT $3`,
    [orgId, pattern, limit]
  );
  return r.rows.map(mapClient);
}

async function searchContracts(database, orgId, pattern, limit) {
  const r = await database.query(
    `SELECT ct.id, ct.title, ct.status, ct.client_id,
            TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS client_name
       FROM contracts ct
       JOIN clients c ON c.id = ct.client_id AND c.org_id = ct.org_id
      WHERE ct.org_id = $1::uuid
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND (
          ct.title ILIKE $2 ESCAPE '\\'
          OR ct.template_key ILIKE $2 ESCAPE '\\'
          OR ct.status ILIKE $2 ESCAPE '\\'
          OR c.first_name ILIKE $2 ESCAPE '\\'
          OR c.last_name ILIKE $2 ESCAPE '\\'
          OR TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
             ILIKE $2 ESCAPE '\\'
        )
      ORDER BY ct.updated_at DESC NULLS LAST, ct.created_at DESC
      LIMIT $3`,
    [orgId, pattern, limit]
  );
  return r.rows.map(mapContract);
}

async function searchDocuments(database, orgId, pattern, limit) {
  const r = await database.query(
    `SELECT d.id, d.title, d.document_key, d.kind, d.subtype, d.client_id,
            TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS client_name
       FROM documents d
       LEFT JOIN clients c ON c.id = d.client_id AND c.org_id = d.org_id
      WHERE d.org_id = $1::uuid
        AND (d.client_id IS NULL OR (c.id IS NOT NULL AND c.custom_fields->>'crm_archived_at' IS NULL))
        AND (
          d.title ILIKE $2 ESCAPE '\\'
          OR d.document_key ILIKE $2 ESCAPE '\\'
          OR d.kind ILIKE $2 ESCAPE '\\'
          OR d.subtype ILIKE $2 ESCAPE '\\'
          OR c.first_name ILIKE $2 ESCAPE '\\'
          OR c.last_name ILIKE $2 ESCAPE '\\'
          OR TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
             ILIKE $2 ESCAPE '\\'
        )
      ORDER BY d.created_at DESC
      LIMIT $3`,
    [orgId, pattern, limit]
  );
  return r.rows.map(mapDocument);
}

async function searchConversations(database, orgId, pattern, limit) {
  const r = await database.query(
    `SELECT c.id, c.client_id, c.channel, c.summary,
            TRIM(BOTH ' ' FROM COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')) AS client_name,
            COALESCE(
              (SELECT m.rendered_body FROM messages m
                WHERE m.conversation_id = c.id AND m.org_id = c.org_id
                  AND m.rendered_body ILIKE $2 ESCAPE '\\'
                ORDER BY m.created_at DESC LIMIT 1),
              c.summary,
              (SELECT m2.rendered_body FROM messages m2
                WHERE m2.conversation_id = c.id AND m2.org_id = c.org_id
                ORDER BY m2.created_at DESC LIMIT 1)
            ) AS preview
       FROM conversations c
       JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
      WHERE c.org_id = $1::uuid
        AND cl.custom_fields->>'crm_archived_at' IS NULL
        AND (
          c.summary ILIKE $2 ESCAPE '\\'
          OR cl.first_name ILIKE $2 ESCAPE '\\'
          OR cl.last_name ILIKE $2 ESCAPE '\\'
          OR TRIM(BOTH ' ' FROM COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, ''))
             ILIKE $2 ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM messages m
             WHERE m.conversation_id = c.id
               AND m.org_id = c.org_id
               AND m.rendered_body ILIKE $2 ESCAPE '\\'
          )
        )
      ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC
      LIMIT $3`,
    [orgId, pattern, limit]
  );
  return r.rows.map(mapConversation);
}

async function searchCards(database, orgId, pattern, limit) {
  const r = await database.query(
    `SELECT cd.id, cd.client_id, cd.stage_id,
            TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS client_name,
            pr.name AS partner_name,
            s.name AS stage_name,
            p.name AS pipeline_name
       FROM cards cd
       LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
       LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = cd.org_id
       JOIN pipeline_stages s ON s.id = cd.stage_id
       JOIN pipelines p ON p.id = cd.pipeline_id
      WHERE cd.org_id = $1::uuid
        AND (cd.client_id IS NULL OR (c.id IS NOT NULL AND c.custom_fields->>'crm_archived_at' IS NULL))
        AND (
          c.first_name ILIKE $2 ESCAPE '\\'
          OR c.last_name ILIKE $2 ESCAPE '\\'
          OR TRIM(BOTH ' ' FROM COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
             ILIKE $2 ESCAPE '\\'
          OR c.custom_fields->>'business_name' ILIKE $2 ESCAPE '\\'
          OR pr.name ILIKE $2 ESCAPE '\\'
          OR pr.brand_name ILIKE $2 ESCAPE '\\'
          OR pr.contact_email ILIKE $2 ESCAPE '\\'
          /* THE PERSON, NOT JUST THE COMPANY. api/public/partner-apply.mjs
             writes the COMPANY into partners.name and partners.brand_name
             (display = company or name, company winning). The human being
             who signed up is stored nowhere on the partner row — only on their
             accounts row. So the three predicates above find "Sim WL Book
             E2e27" and find the email, and return nothing at all for "Sim
             Wlabel E2e27", which is the name a staff member actually types.

             EXISTS rather than a join: a partner may hold more than one login,
             and joining accounts would return the same card once per login. */
          OR EXISTS (
               SELECT 1 FROM accounts a
                WHERE a.partner_id = cd.partner_id
                  AND a.org_id = cd.org_id
                  AND a.kind = 'partner'
                  AND a.name ILIKE $2 ESCAPE '\\'
             )
          /* AND THE APPLICANT, WHO HAS NO LOGIN YET. The accounts lookup above
             stopped finding the human on 2026-08-31, twice over:

               an APPLICATION now stops at partners status 'invited' — no login
               is minted until somebody approves it, so there is no accounts row
               to search at all for the whole review window; and

               approvePartnerApplication() names the account it finally does
               create after partners.name, which is the COMPANY. So even an
               approved partner's accounts.name reads "Sim WL Book E2e27", never
               "Sim Wlabel E2e27".

             The person's name survives in exactly one place the form writes:
             partners.notes, on a line reading contact=<name> (with their phone,
             their audience answer and their SMS tick). Searching it makes a
             staff member typing the name of the human they just spoke to find
             the card, which is the failure the 2026-08-27 walk recorded as
             "Search does not look at partners". Staff-only endpoint, and notes
             are matched but never returned — the row still renders as the
             partner's name and stage. */
          OR pr.notes ILIKE $2 ESCAPE '\\'
          OR s.name ILIKE $2 ESCAPE '\\'
          OR p.name ILIKE $2 ESCAPE '\\'
          OR cd.owner ILIKE $2 ESCAPE '\\'
        )
      ORDER BY cd.entered_at DESC
      LIMIT $3`,
    [orgId, pattern, limit]
  );
  return r.rows.map(mapCard);
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false,
      error: "org_required",
      message: "Your sign-in is not attached to a company, so there is nothing to search."
    });
  }

  const q = String((req.query && req.query.q) || "").trim().slice(0, MAX_Q);
  const pattern = likePattern(q);
  const limit = boundedLimit(req.query && req.query.limit, {
    fallback: PER_GROUP_CAP,
    cap: PER_GROUP_CAP
  });

  if (!pattern) {
    return res.status(200).json({ ok: true, q: "", groups: emptyGroups() });
  }

  try {
    const [clients, contracts, documents, conversations, cards] = await Promise.all([
      searchClients(db, orgId, pattern, limit),
      searchContracts(db, orgId, pattern, limit),
      searchDocuments(db, orgId, pattern, limit),
      searchConversations(db, orgId, pattern, limit),
      searchCards(db, orgId, pattern, limit)
    ]);

    return res.status(200).json(redact({
      ok: true,
      q,
      groups: { clients, contracts, documents, conversations, cards }
    }));
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(503).json({ ok: false, db: "down", error: safeError(err) });
  }
}
