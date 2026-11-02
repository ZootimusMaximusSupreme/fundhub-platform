// Approved, role-readable instruction files for the staff Knowledge Base.
// This is a small browse index; answer retrieval keeps its own tier gate.

import { assertBrainAccess } from "./access.mjs";

const INSTRUCTION_NAME = /(sop|playbook|guide|script|checklist|process|training|ramp|onboarding|funding|sales|support|handbook|class)/i;
const DOCUMENT_MIMES = [
  "application/pdf",
  "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown"
];

export function categoryForInstruction(name) {
  const title = String(name || "");
  if (/(sales|closer|setter|call|pipeline|lead|objection)/i.test(title)) return "Sales";
  if (/(onboard|intake|welcome|handoff|client)/i.test(title)) return "Onboarding";
  if (/(fund|credit|bank|lender|inquiry|repair)/i.test(title)) return "Funding";
  if (/(support|service|csm|success|portal)/i.test(title)) return "Support";
  return "General";
}

function safeDocumentUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function listLibraryFiles(database, { orgId, role } = {}) {
  const gate = assertBrainAccess(role);
  if (!gate.ok) return { ok: false, reason: gate.reason, files: [] };
  if (!orgId) return { ok: false, reason: "no_org_scope", files: [] };

  const result = await database.query(
    `SELECT f.id, f.name, f.web_view_link, f.source, f.updated_at
       FROM brain_files f
      WHERE f.org_id = $1
        AND f.approval_status = 'approved'
        AND f.client_id IS NULL
        AND f.access_tier = ANY($2::brain_access_tier[])
        AND f.access_tier <> 'affiliate'
        AND f.mime_type = ANY($3::text[])
        AND f.name ~* $4
        AND EXISTS (
          SELECT 1 FROM brain_chunks c
           WHERE c.file_id = f.id AND c.org_id = $1
             AND c.access_tier = f.access_tier
             AND c.embedding IS NOT NULL
        )
      ORDER BY f.name ASC
      LIMIT 200`,
    [orgId, gate.tiers, DOCUMENT_MIMES, INSTRUCTION_NAME.source]
  );

  return {
    ok: true,
    files: (result.rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      category: categoryForInstruction(row.name),
      url: safeDocumentUrl(row.web_view_link),
      source: row.source,
      updatedAt: row.updated_at
    }))
  };
}
