// /api/marketing/scripts/edit — Chris saves his own words: a new version, and
// the old one is kept.
//
// Route key "marketing/scripts/edit" (netlify/functions/api.mjs ROUTES; the key
// is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8, §7.2 (voice pairs), §7.9 (repo file), §4 trap 9; shape
// docs/specs/marketing-machine-api.md §6.2.
//
//   POST {request_id, id, version, body, parts?, meta_copy?}
//     → 200 {script:S, warnings:[{rule, message}]}
//     In ONE transaction: the old version is archived (status superseded) and
//     the new one inserted at version + 1 with the same root and the same ad
//     number. A locked (or filmed) script's new version is locked: it keeps its
//     number. parts and meta_copy are kept when not sent; parts are cleared
//     (with a warning) when the words changed and no parts came with them.
//     warnings = the strict checker's findings. They never block the save.
//     Voice pairs are saved for the machine's lines Chris changed, and the repo
//     file is queued (outbox, mode 'replace', the same path as before).
//   400 {error:'invalid', field:'body'|'parts'|'meta_copy'|'id'|'version'|'request_id', message}
//       (id is also refused when the script is rejected or expired)
//   404 {error:'not_found', message}
//   409 {error:'stale', message, current:{version, body, parts}}
//   A repeated request_id answers the first save again and writes nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). A film key (header x-shoot-film)
// may save a new version of a script that is on that shoot, and no other
// script. One asStaff() transaction (withRequest); the worker is woken after
// it commits.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, NotFoundError
} from "../../../src/marketing/http.mjs";
import {
  parseScriptRef, parseBody, parseParts, parseMetaCopy, editScript
} from "../../../src/marketing/scripts-store.mjs";
import { scriptOnFilmShoot } from "../../../src/marketing/shoot-store.mjs";
import { FILM_LINK_CLOSED, filmFromReq } from "../../../src/marketing/shoot-film-key.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/scripts/edit";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to save a new version of a script." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source. A film key skips the staff gate
  // and is checked against the shoot inside the write. Everyone else still
  // goes through requireAuth, then requireRole(ROLE_SETS.MARKETING), then
  // hasCompany(res, staff).
  const auth = deps.requireAuth ?? requireAuth;
  const film = filmFromReq(req, deps);
  if (film?.bad) {
    return res.status(404).json({ error: "not_found", message: FILM_LINK_CLOSED });
  }
  let orgId = null;
  let staffId = null;
  if (film) {
    orgId = film.orgId;
  } else {
    const staff = await auth(req, res, { db: database });
    if (!staff) return;
    if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
    if (!hasCompany(res, staff)) return;
    orgId = staff.org_id;
    staffId = staff.id ?? null;
  }

  try {
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const { id, version } = parseScriptRef(body);
    const text = parseBody(body.body);
    const parts = parseParts(body.parts);
    const metaCopy = parseMetaCopy(body.meta_copy);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      if (film) {
        const on = await scriptOnFilmShoot(tx, { orgId, shootId: film.shootId, scriptId: id });
        if (!on) throw new NotFoundError("That script is not on this film link.");
      }
      return editScript(tx, { orgId, id, version, body: text, parts, metaCopy, staffId, requestId });
    });
    // After the commit: the outbox row is saved, so the worker can commit it.
    await (deps.wake ?? wakeWorker)(deps.env ?? process.env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Editing scripts")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
