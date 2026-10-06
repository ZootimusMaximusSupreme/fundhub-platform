// POST /api/scripts/write — save a script, or save a rewrite of one.
//
// Route key: "scripts/write". A HANDLER FILE IS NOT A ROUTE (CLAUDE.md §12) —
// netlify/functions/api.mjs holds a hardcoded ROUTES map and this file answers
// 404 both locally and deployed until "scripts/write" is a key in it. That file
// is not edited from here on purpose; the integration lane owns it.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// 377 created ad_scripts and nothing in the tree can write a row to it. Until
// something does, v_ad_label_spine returns NULL labels for every ad and the
// whole spine reads as EMPTY rather than as broken. This is the way in.
//
// ═══════════════════════════════════════════════════════════════════════════
// A REWRITE ARCHIVES WHAT IT REPLACED, AND NEVER OVERWRITES ITS WORDS
//
// Pass parent_script_id and this, in ONE transaction (spec 2026-10-04 §4 trap
// 9, migration 413):
//   1. locks the parent row and refuses with 409 `stale` when it is already
//      archived — only the live version of a script can be rewritten, so two
//      people rewriting the same version cannot both win;
//   2. archives the parent (archived_at = now(); status 'superseded' when the
//      machine wrote it). Its words, labels and number are left exactly as they
//      were, so the rewrite can still be read beside the thing it came from;
//   3. inserts the new version at parent.version + 1 with parent_script_id
//      pointing back, the SAME root_script_id and the SAME ad_id. A locked or
//      filmed parent's rewrite lands locked: editing a locked script keeps its
//      number (spec §7.4), and its new words still have to be filmed.
// If step 3 fails, step 2 rolls back with it. 413's indexes back this up in the
// database: one live version per root, one row per (root, version).
//
// Before 413 this file never touched the parent at all, and two rewrites of one
// version could both be version 2. That is over.
//
// ═══════════════════════════════════════════════════════════════════════════
// LABELS ARE FREE TEXT AND THIS FILE HOLDS NO ALLOW-LIST
//
// The owner rule of 2026-09-06 forbids making naming a blocker. A brand-new
// angle nobody has ever written down saves the first time it is typed, and it
// groups the instant it is written. What this file does instead is NORMALISE —
// trim, lower case, separators to underscores — through src/ads/label-keys.mjs,
// which is the mitigation 377's own header names for 'denial_angle' and
// 'denialangle' otherwise splitting one angle's numbers across two groups. The
// normaliser lives in its own module so the checker and any later writer share
// one copy of the rule rather than each inlining their own.
//
// lane IS THE ONE VALIDATED FIELD, and not as a naming rule: it is a typed
// column (ad_lane), so a lane we do not recognise is a Postgres error nobody can
// read rather than new vocabulary. Refusing it here gives a plain sentence back.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DICTIONARY LEARNS, AND NEVER OVERWRITES
//
// Every label that lands on a script is also upserted into ad_labels so the
// vocabulary grows on its own. The friendly name is only ever FILLED IN where
// none exists (ON CONFLICT … DO UPDATE … WHERE ad_labels.name IS NULL). A name a
// human typed always wins.
//
// lane gets no dictionary row: ad_labels_kind_ck (377:318) lists exactly four
// kinds — script_type, angle, hook, offer — and lane is not one of them, because
// the five lanes are an enum in the database already.
//
// ═══════════════════════════════════════════════════════════════════════════
// NO IDEMPOTENCY KEY, STATED RATHER THAN FAKED
//
// api/creative/generate.mjs demands one because a repeat there double-bills a
// provider. Nothing here bills anything, ad_scripts has no idempotency column,
// and inventing one would be a schema change this unit was not asked to make. So
// two identical posts write two rows. That is a known behaviour, not an
// oversight.
//
// asStaff(), NOT a bare db.query. ad_scripts carries the standard partner
// isolation policy (377 Part 4e) and ad_labels is staff-write only, so an
// unscoped pooled connection is anonymous to both — it writes nothing and
// reports success. asStaff() also opens ONE real transaction, so the script row
// and its dictionary rows land together or not at all; that is why this file
// does not reach for src/db/with-transaction.mjs as well.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import {
  normaliseLabelKey, isLabelKey, friendlyName, normaliseLane, isLane
} from "../../src/ads/label-keys.mjs";
import { LANES } from "../../src/ads/registry.mjs";

/* Which ad_labels.kind each script column feeds. Written out rather than
   derived from the column name, because angle_key → 'angle' drops a suffix and
   script_type → 'script_type' does not. A rule with one exception is a rule
   somebody gets wrong later.

   The third entry is the camelCase spelling a JavaScript caller is likely to
   send. Accepting both is the same courtesy api/creative/generate.mjs extends
   with asset_kind / assetKind — a label silently dropped because the caller
   typed angleKey would look exactly like a script nobody had classified. */
const LABEL_KINDS = [
  ["script_type", "script_type", "scriptType"],
  ["angle_key", "angle", "angleKey"],
  ["hook_key", "hook", "hookKey"],
  ["offer_key", "offer", "offerKey"]
];

const HOUSE_PARTNER_SLUG = "fundhub-house";

const bad = (res, error, message) => res.status(400).json({ ok: false, error, message });

/* EVERY REFUSAL COMES BACK THE SAME SHAPE: a short `error` code a screen can
   branch on, and a `message` sentence a person can read. They are separate
   fields on purpose — a screen that switches on `error` and is handed a
   paragraph has no case that matches, so it falls through to a generic failure
   and the sentence never reaches anybody.

   The checks above call bad(); the checks inside the transaction cannot return a
   response from in there, so they throw one of these instead and the catch at
   the bottom unpacks it. Same three parts either way. */
function fail(status, code, message, extra = null) {
  const e = new Error(message);
  e.httpStatus = status;
  e.errorCode = code;
  e.extra = extra;
  return e;
}

/* THE STALE ANSWER. Same shape the marketing routes use (spec §7.8):
   { error: 'stale', current: { id, version, body, parts } }, where current is
   the live version of the same script, or null when every version of it has
   been retired. A screen can show "somebody saved a newer version" and offer
   that one instead of losing the edit. */
const STALE_MESSAGE =
  "That version of the script has already been replaced. Rewrite the current version instead.";

async function staleFor(tx, rootId) {
  const current = rootId
    ? (await tx.query(
        `SELECT id, version, body, parts FROM ad_scripts
          WHERE root_script_id = $1 AND archived_at IS NULL`,
        [rootId]
      )).rows[0] || null
    : null;
  return fail(409, "stale", STALE_MESSAGE, { current });
}

/* 413's two version indexes. A unique-violation on either one means another
   save of the same script got there first — the same answer as stale. */
const VERSION_INDEXES = new Set(["ad_scripts_one_live_per_root_uq", "ad_scripts_root_version_uq"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // requireAuth ANSWERS "is this a signed-in employee" AND NOTHING ELSE. Its
  // third argument is { db, env }; a `roles` key there is silently dropped and
  // the endpoint ends up with no role gate at all (CLAUDE.md §12,
  // src/http/auth-gate.test.mjs). The gate is the separate call below.
  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const body = req.body || {};

  // The words. A script with no words is not a script — the same rule
  // ad_scripts_body_ck (377:193) states, asked here so the answer is a sentence
  // rather than a constraint violation.
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) {
    return bad(res, "body_required", "Send the script itself in `body`. A script with no words is not a script.");
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
  const hookText = typeof body.hook_text === "string" && body.hook_text.trim()
    ? body.hook_text.trim()
    : (typeof body.hookText === "string" && body.hookText.trim() ? body.hookText.trim() : null);

  /* THE FIVE LABELS. Normalised first, checked second. Normalising cannot always
     produce a legal key — "3 second hook" comes out as "3_second_hook", which the
     database refuses because a key must start with a letter — so the shape check
     runs on the normalised value and the refusal names the field and shows what
     the typed text became. */
  const labels = {};
  for (const [column, , camel] of LABEL_KINDS) {
    const raw = body[column] !== undefined ? body[column] : body[camel];
    const key = normaliseLabelKey(raw);
    if (key !== null && !isLabelKey(key)) {
      return bad(res, "label_invalid",
        `${column} came out as "${key}" after tidying, which is not a usable label. ` +
        "A label is lower case letters, digits and underscores, starts with a letter, " +
        "and is 2 to 49 characters long — for example denial_angle.");
    }
    labels[column] = key;
  }

  const lane = normaliseLane(body.lane);
  if (lane !== null && !isLane(lane)) {
    return bad(res, "lane_invalid",
      `lane must be one of ${LANES.join(", ")} — got ${JSON.stringify(String(body.lane))}. ` +
      "Leave it out if the script is not tied to one lane.");
  }

  const parentId = body.parent_script_id || body.parentScriptId || null;
  if (parentId && !isUuid(parentId)) {
    return bad(res, "parent_script_id_invalid", "parent_script_id must be the id of the script this one rewrites.");
  }

  const askedPartnerId = body.partner_id || body.partnerId || null;
  if (askedPartnerId && !isUuid(askedPartnerId)) {
    return bad(res, "partner_id_invalid", "partner_id must be a partner id.");
  }

  try {
    const out = await asStaff(async (tx) => {
      /* WHOSE SCRIPT IS THIS. FundHub's own scripts belong to the house partner
         377 Part 1 created, because ad_scripts.partner_id is NOT NULL and a row
         no partner owns is a row no policy matches. A caller may name a partner
         instead; it must be in this org, or a staff session in one company could
         file a script under another's. */
      let partnerId = askedPartnerId;
      let parent = null;

      if (parentId) {
        /* FOR UPDATE: a second rewrite of the same version waits here until the
           first one commits, then reads the parent as archived and gets 409. */
        parent = (await tx.query(
          `SELECT id, org_id, partner_id, version, root_script_id, ad_id,
                  status, source, archived_at
             FROM ad_scripts WHERE id = $1
              FOR UPDATE`,
          [parentId]
        )).rows[0];
        /* ONE CODE AND ONE SENTENCE FOR BOTH ANSWERS. "no such script" and "that
           script belongs to another company" are told apart here and must not be
           told apart out there: a caller who can tell which one they hit can
           walk a list of ids and learn which ones exist in somebody else's
           company. Same 404, same words, either way. */
        if (!parent || parent.org_id !== orgId) {
          throw fail(404, "parent_script_not_found",
            "The script being rewritten was not found.");
        }
        /* ONLY THE LIVE VERSION CAN BE REWRITTEN. An archived parent was already
           replaced (or retired); writing beside it would fork the script. */
        if (parent.archived_at) {
          throw await staleFor(tx, parent.root_script_id);
        }
        /* A REWRITE STAYS WITH ITS PARENT. Moving it would strand the pair on
           opposite sides of a partner boundary, and 377's own move guard
           (trg_ad_scripts_partner_move) exists because that shape leaks. A
           caller asking for a different partner is refused rather than ignored —
           silently overriding what somebody sent is how the wrong thing ships. */
        if (partnerId && partnerId !== parent.partner_id) {
          throw fail(400, "partner_id_mismatch",
            "A rewrite stays with the same partner as the script it replaces. Leave partner_id out.");
        }
        partnerId = parent.partner_id;
      }

      if (!partnerId) {
        const house = (await tx.query(
          `SELECT id FROM partners WHERE org_id = $1 AND slug = $2`,
          [orgId, HOUSE_PARTNER_SLUG]
        )).rows[0];
        /* DO NOT SAY "377 HAS NOT BEEN APPLIED" HERE. It is usually the wrong
           answer and it sends the reader to the wrong place. 377 only creates the
           house partner for the DEFAULT company — its INSERT ends
           `WHERE o.is_default` (377:139) — so a second company reaches this line
           with 377 fully applied and every table in place. The fix in that case
           is a house partner row for THIS company, or a partner_id on the
           request, not a migration. */
        if (!house) {
          throw fail(400, "house_partner_missing",
            "There is nowhere to file this script: this company has no \"FundHub (house)\" partner " +
            "to own it. Send a partner_id with the script, or add a partner with the slug " +
            "fundhub-house to this company.");
        }
        partnerId = house.id;
      }

      const partner = (await tx.query(
        `SELECT id, org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!partner || partner.org_id !== orgId) {
        throw fail(404, "partner_not_found", "That partner was not found.");
      }

      /* version IS COMPUTED, NEVER SENT. A caller choosing its own version number
         is a caller that can write version 1 twice and make the history unreadable.
         Since 413 a version number is used once per script (root), and only the
         live version can be rewritten, so parent.version + 1 is always free. */
      const version = parent ? Number(parent.version) + 1 : 1;

      /* THE ARCHIVE, then the insert — in this order, in this transaction. The
         old version has to stop being live before the new one can be, or 413's
         one-live-per-root index and 393's one-live-per-number index refuse the
         insert. `AND archived_at IS NULL` is the second lock on the stale case. */
      if (parent) {
        const archived = await tx.query(
          `UPDATE ad_scripts
              SET archived_at = now(),
                  status = CASE WHEN source = 'machine' THEN 'superseded' ELSE status END
            WHERE id = $1 AND archived_at IS NULL`,
          [parent.id]
        );
        if (archived.rowCount !== 1) throw await staleFor(tx, parent.root_script_id);
      }

      /* A NEW SCRIPT sends no root, number or status: 413's trigger makes it its
         own root and the defaults make it a draft written by chris. A REWRITE
         carries the parent's root and number, and stays locked when the parent
         was locked or filmed (its new words still have to be filmed). */
      const carried = parent
        ? {
            root: parent.root_script_id,
            adId: parent.ad_id,
            status: parent.status === "locked" || parent.status === "filmed" ? "locked" : "draft"
          }
        : { root: null, adId: null, status: "draft" };

      const script = (await tx.query(
        `INSERT INTO ad_scripts
           (org_id, partner_id, parent_script_id, version,
            title, body, hook_text,
            script_type, lane, angle_key, hook_key, offer_key,
            root_script_id, ad_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::ad_lane,$10,$11,$12,$13,$14,$15)
         RETURNING id, org_id, partner_id, parent_script_id, version,
                   title, body, hook_text,
                   script_type, lane::text AS lane, angle_key, hook_key, offer_key,
                   root_script_id, ad_id, status, source,
                   archived_at, created_at, updated_at`,
        [orgId, partnerId, parent ? parent.id : null, version,
         title, text, hookText,
         labels.script_type, lane, labels.angle_key, labels.hook_key, labels.offer_key,
         carried.root, carried.adId, carried.status]
      )).rows[0];

      /* THE DICTIONARY LEARNS. DO UPDATE … WHERE name IS NULL fills a blank name
         and leaves a real one alone; on a row that already has a name the WHERE
         is false, nothing is written, and no error is raised. So a label Chris
         named by hand keeps his wording forever, however many scripts carry it. */
      const learned = [];
      for (const [column, kind] of LABEL_KINDS) {
        const key = labels[column];
        if (!key) continue;
        await tx.query(
          `INSERT INTO ad_labels (org_id, kind, key, name)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (org_id, kind, key) DO UPDATE
             SET name = EXCLUDED.name
           WHERE ad_labels.name IS NULL`,
          [orgId, kind, key, friendlyName(key)]
        );
        learned.push({ kind, key });
      }

      return { script, learned };
    });

    return res.status(200).json({
      ok: true,
      created: true,
      is_rewrite: !!parentId,
      script: out.script,
      /* WHAT THE TYPED TEXT BECAME. Chris types "Denial Angle" and this says
         denial_angle, so the tidying is visible rather than a silent rename. */
      labels: {
        script_type: out.script.script_type,
        lane: out.script.lane,
        angle_key: out.script.angle_key,
        hook_key: out.script.hook_key,
        offer_key: out.script.offer_key
      },
      dictionary: out.learned
    });
  } catch (err) {
    /* A refusal raised inside the transaction, unpacked into the same
       { error, message } shape every refusal above already uses. */
    if (err.errorCode) {
      return res.status(err.httpStatus).json({
        ok: false, error: err.errorCode, message: err.message, ...(err.extra || {})
      });
    }
    /* Another save of the same script won the race between our read and our
       insert. Nothing was written (the transaction rolled back), so the answer
       is the same stale answer; the screen re-reads the live version. */
    if (err && err.code === "23505" && VERSION_INDEXES.has(err.constraint)) {
      return res.status(409).json({ ok: false, error: "stale", message: STALE_MESSAGE, current: null });
    }
    if (dbDown(res, err)) return;
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
