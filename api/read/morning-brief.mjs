// GET /api/read/morning-brief[?date=YYYY-MM-DD][&kind=morning|evening]
//
// The stored morning or evening brief. Owner and admin only.
// The page that draws this is not in this change. This is the read door.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { readMorningBrief, phoenixDateStamp, BRIEF_KINDS } from "../../src/ops/morning-brief.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export function parseBriefDate(raw, now = new Date()) {
  if (raw == null || raw === "") return phoenixDateStamp(now);
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

export function parseBriefKind(raw) {
  if (raw == null || raw === "") return "morning";
  const s = String(raw).trim();
  return BRIEF_KINDS.includes(s) ? s : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const clock = deps.now || (() => new Date());

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const staff = await auth(req, res, { db: database });
    if (!staff) return;
    if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

    const orgId = staff.org_id;
    if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

    const date = parseBriefDate(req.query?.date, clock());
    if (!date) return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });

    const kind = parseBriefKind(req.query?.kind);
    if (!kind) return res.status(400).json({ ok: false, error: "kind must be morning or evening" });

    const brief = await readMorningBrief(database, { orgId, date, kind });
    if (!brief) return res.status(404).json({ ok: false, error: "no_brief", date, kind });

    return res.status(200).json({ ok: true, date, kind, brief });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
