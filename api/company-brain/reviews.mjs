// /api/company-brain/reviews
// GET  — list pending reviews (owner only, H-3): Drive tier classifications
//        AND staff uploads waiting for approval (board §3.6).
// POST — { review_id, decision: 'approve'|'reject' } (owner only)
//
// Owner-set H-3 (2026-08-02): ONLY the `owner` role decides. Admin is
// deliberately excluded and stays excluded.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import {
  listPendingReviews,
  decideClassificationReview
} from "../../src/company-brain/review.mjs";

/* H-3 2026-08-02: ONLY the owner role may approve or reject owner/affiliate
   classifications. Admin is deliberately excluded. */
const OWNER_ONLY = new Set(["owner"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;

  if (!requireRole(res, staff, OWNER_ONLY)) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });

  if (req.method === "GET") {
    const list = deps.listPendingReviews || listPendingReviews;
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 25));
    const offset = Math.max(0, Math.min(10000, Math.floor(Number(req.query?.offset) || 0)));
    const out = await list(database, { orgId, limit, offset });
    const rows = out.reviews || [];
    // Every field already on the row is kept exactly as it was — a screen is
    // built against them. The camelCase keys below are additions only.
    const reviews = rows.map((row) => {
      const kind = row.kind === "upload" ? "upload" : "classification";
      const size = row.size_bytes == null ? null : Number(row.size_bytes);
      return {
        ...row,
        kind,
        isUpload: kind === "upload",
        source: row.source || "drive",
        fileName: row.file_name || row.original_name || "",
        originalName: row.original_name || null,
        proposedTier: row.proposed_tier || null,
        accessTier: row.access_tier || null,
        approvalStatus: row.approval_status || null,
        sizeBytes: Number.isFinite(size) ? size : null,
        mimeType: row.mime_type || null,
        webViewLink: row.web_view_link || null,
        createdAt: row.created_at || null
      };
    });
    return res.status(200).json({
      ok: true,
      reviews,
      pendingCount: Number(out.pendingCount) || reviews.length,
      uploadCount: reviews.filter((r) => r.isUpload).length
    });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const reviewId = String(body.review_id || "").trim();
    const decision = String(body.decision || "").trim().toLowerCase();
    if (!isUuid(reviewId)) {
      return res.status(400).json({ ok: false, error: "review_id must be a uuid" });
    }
    if (decision !== "approve" && decision !== "reject") {
      return res.status(400).json({ ok: false, error: "decision must be approve or reject" });
    }
    const decide = deps.decideClassificationReview || decideClassificationReview;
    const out = await decide(database, {
      orgId,
      reviewId,
      role: staff.role,
      decision,
      decidedBy: staff.id || null
    });
    if (!out.ok) {
      const status = out.reason === "forbidden_role" ? 403
        : out.reason === "not_found" ? 404
        : out.reason === "not_pending" ? 409
        : 400;
      return res.status(status).json({ ok: false, error: out.reason });
    }
    return res.status(200).json({ ok: true, ...out });
  }

  res.setHeader("allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
