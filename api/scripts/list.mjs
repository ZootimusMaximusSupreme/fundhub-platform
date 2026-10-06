// GET /api/scripts/list — the scripts already saved, for the Script picker on
// public/app/creative-factory.html.
//
//   ?include_archived=1   ?limit= ?offset=
//
// WHY THIS EXISTS. The write half shipped on 2026-09-08 and the read half did
// not, so the Script picker on the Creative Factory screen was only ever filled
// by the save that had just happened, in that one browser tab. Reload the page
// and every script ever saved was invisible — the picker fell back to its one
// hardcoded "— none —" option and a person had no way to tie a new creative to
// a script written yesterday. /api/read/ad-spine cannot stand in for this:
// v_ad_label_spine starts FROM ads (377:650), so a script with no creative and
// no ad yields no row there at all.
//
// body IS NOT SELECTED IN FULL. A picker needs a label, not the script. The
// first 120 characters are enough to tell two untitled drafts apart, and sending
// two hundred whole scripts to fill a drop-down is a page-load cost paid for
// nothing. Anything that needs the words asks for the one script it is showing.
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";

/* fetchRows is exported so the SQL can be executed directly by
   src/http/scripts-list.pg.test.mjs, for the reason api/creative/library.mjs:25-28
   gives: an endpoint whose query only ever runs behind an HTTP handler is one
   whose column names go unchecked until a person opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const params = [limit + 1, offset];
  const where = [];

  // An archived script is hidden by default and can be asked for, matching
  // library.mjs:40. Archiving it is how somebody says "not this one any more",
  // and a picker that still offers it has ignored that.
  if (query.include_archived !== "1") where.push("s.archived_at IS NULL");

  return tx.query(
    `SELECT s.id, s.title, s.version, s.parent_script_id,
            s.script_type, s.lane::text AS lane,
            s.angle_key, s.hook_key, s.offer_key,
            s.archived_at, s.created_at,
            left(s.body, 120) AS body_preview
       FROM ad_scripts s
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

/* No partner_id in the WHERE, and that is not an omission. ad_scripts is on the
   partner-scoped list with FORCEd row-level security (src/partners/scope.mjs:154),
   and partnerReadHandler runs this inside withPartnerScope — so the policy does
   the filtering and a bare db.query here would be the leak. */
const run = partnerReadHandler({ fetch: fetchRows });

// deps lets a test hand in the unprivileged pool (see partner-read-api.mjs).
export default (req, res, deps = {}) => run(req, res, { db, ...deps });
