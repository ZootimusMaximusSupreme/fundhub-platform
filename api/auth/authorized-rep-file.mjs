// GET  /api/auth/authorized-rep-file  — the files this login can open
// POST /api/auth/authorized-rep-file  { client_id } — look at that file
//
// A client login has one file and is refused here. An authorized
// representative can open only a file staff linked.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { listRepFiles, setActiveFile } from "../../src/auth/authorized-rep.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;
  if (!principal.authorizedRep) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  if (req.method === "GET") {
    const files = await listRepFiles(db, principal.accountId);
    return res.status(200).json({
      ok: true,
      active_client_id: principal.clientId,
      files: files.map((f) => ({
        client_id: f.client_id,
        name: [f.first_name, f.last_name].filter(Boolean).join(" ")
      }))
    });
  }

  const clientId = String((req.body || {}).client_id || "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // principal.orgId binds the switch to the caller's own company.
  const out = await setActiveFile(db, {
    accountId: principal.accountId, clientId, orgId: principal.orgId
  });
  if (!out.ok) {
    return res.status(403).json({
      ok: false,
      error: "That file is not one of yours."
    });
  }
  return res.status(200).json({ ok: true, client_id: out.clientId });
}
