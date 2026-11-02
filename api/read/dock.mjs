// GET /api/read/dock — a small read-only companion surface for staff and clients.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { buildDockFeed } from "../../src/dock/feed.mjs";

export default async function handler(req, res, deps = {}) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  const database = deps.db ?? db;
  const principal = deps.principal ?? await requirePrincipal(req, res, ["staff", "client"], { db: database });
  if (!principal) return;
  if (principal.kind !== "staff" && principal.kind !== "client") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const orgId = principal.kind === "staff" ? principal.staff?.org_id : principal.orgId;
  const actorId = principal.kind === "staff" ? principal.staff?.id : principal.clientId;
  if (!isUuid(orgId) || !isUuid(actorId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  try {
    const feed = await buildDockFeed(database, principal, { now: deps.now ?? new Date() });
    if (!feed) return res.status(404).json({ ok: false, error: "client_not_found" });
    return res.status(200).json(feed);
  } catch (error) {
    if (error instanceof TypeError && /_required$/.test(error.message)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    if (dbDown(res, error)) return;
    return res.status(500).json({ ok: false, error: "read_failed" });
  }
}
