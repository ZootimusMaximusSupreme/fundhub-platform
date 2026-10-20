import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { writeOutreach } from "../src/outreach/store.mjs";

const OUTREACH_ROLES = new Set(["owner", "admin", "sales_manager", "outbound_rep"]);

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = await requireAuth(req, res, { db: database });
  if (!staff || !requireRole(res, staff, OUTREACH_ROLES)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    return res.status(200).json(await writeOutreach(database, { staff, body: req.body || {} }));
  } catch (err) {
    if (err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ ok: false, error: err.code || "invalid_request", message: err.message });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
