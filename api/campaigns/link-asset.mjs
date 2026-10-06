// POST /api/campaigns/link-asset — say which creative is running on an ad, and
// what our own number for that ad is.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS A HUMAN TYPING AND NOT A SYNC JOB
//
// ads.asset_id has existed since 046_ad_platforms.sql:291 and no code has ever
// written it. 377's Part 4b says the missing link was never a missing column,
// it was a missing WRITE. This file is that write.
//
// IT IS MANUAL BECAUSE THERE IS NOTHING TO MATCH ON. Checked 2026-09-08:
//
//   * The Meta pull is read-only and does not even ask for a creative.
//     api/campaigns/sync.mjs:229 requests "id,name,status,adset_id" from
//     /{adset_id}/ads. No creative field is requested and none is stored.
//   * Our creative_assets.provider_asset_id is the GENERATION vendor's id, not
//     Meta's. Every writer of that column goes through assetFrom() in
//     src/creative/providers/_http.mjs:100, and the five provider keys are
//     copy, static, ugc-video, product-video and resize
//     (src/creative/providers/*.mjs PROVIDER_KEY). There is no provider 'meta'
//     anywhere in the tree, so Meta has never seen one of these ids.
//   * Nothing has ever pushed one of our creatives TO Meta either.
//     src/adplatforms/meta.mjs:93 createAd() takes ad.external_creative_id, and
//     grep finds that field defined in the two adapters and supplied by nobody.
//     The only caller of guardedWrite() is src/optimize/run.mjs:95, whose
//     execute block does budget, pause and rotated_at — never an ad create.
//
// So the two sides share no identifier of any kind. The only remaining option
// would be matching Meta's ad NAME against something of ours, and 377's own
// header explains why that is refused: a wrong link makes every label answer
// silently wrong with no error anywhere. A human picking the row is slower and
// correct; a name guess is instant and unfalsifiable.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// NULL MEANS UNKNOWN, AND THAT IS WHY THIS READS KEY PRESENCE
//
// The two things this endpoint sets are set independently. A call that names
// only fundhub_ad_number must not blank out asset_id, and the other way round.
// So each field is applied only when its KEY IS PRESENT in the body — never on
// truthiness, because `asset_id: null` is a real instruction ("unlink this")
// and an absent asset_id is a different instruction ("leave it alone").
//
// KEY PRESENCE IS THE WHOLE TEST. A blank string is a present key, so it CLEARS,
// exactly as an explicit null does. There are two instructions here, not three:
//
//   key absent                    leave it alone
//   key present, null or blank    clear it
//   key present, a value          set it
//
// Clearing asset_id turns the labels for that ad back off with no error anywhere
// — the exact silent-empty failure 377 Part 4b warns about. That is why it takes
// a deliberate key, and why a screen showing an empty box must send nothing at
// all rather than "".
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THREE LOCKS STOP A CROSS-PARTNER LINK, AND ALL THREE ARE DELIBERATE
//
//   1. RLS. The whole body runs inside withPartnerScope as the PARTNER, exactly
//      as api/creative/actions.mjs:39 does. Another partner's ad and another
//      partner's asset are both invisible in here, so they read as not found.
//   2. This handler compares partner_id and org_id on both rows itself, so the
//      refusal is a 400 that names the problem rather than a row that silently
//      did not match.
//   3. trg_ads_asset_partner, added by 377 Part 4b. THE ANSWER TO "does anything
//      guard ad-to-creative": before 377, nothing did. 377 added that trigger in
//      the same file that starts reading the link, so the database now refuses
//      it too. Locks 1 and 2 are still worth having: the trigger raises a
//      plpgsql exception, which without them would surface as a 500.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The identical regex to ads_fundhub_ad_number_ck (377:569), which is itself the
   identical regex to client_ad_attribution_ad_id_ck (286:116-117). Checked here
   as well as in the database so a typo comes back as a sentence a person can
   read instead of a constraint name. */
const AD_NUMBER_RE = /^[0-9]{1,9}$/;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/* A blank string CLEARS the value, exactly like an explicit null. Leaving the KEY
   OUT is the only thing that means "leave it alone" — see the block above, which
   decides that on hasOwnProperty and not on the value.

   So `asset_id: ""` unlinks the creative, the same as `asset_id: null`. A screen
   with an empty select box must therefore OMIT asset_id, not post "". Storing ""
   is not an option: the column is a uuid and the ad-number CHECK refuses it. */
const emptyToNull = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : v);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // requireAuth ignores a roles key (CLAUDE.md §12), so nothing here passes one.
  // requirePrincipal names the kinds it serves and refuses anything else, and
  // "partner, staff" is what every other write on this surface accepts —
  // api/campaigns/write.mjs:20, api/creative/actions.mjs:20.
  //
  // TWO THINGS THAT ARE OPEN ON PURPOSE, matching both those files exactly:
  //   * Any employee kind may do this, not only an owner. There is no requireRole
  //     after this line, so a setter has the same reach as the owner.
  //   * A staff caller names the partner in the body and resolvePartnerId takes
  //     it as given (src/http/partner-read-api.mjs:113). principal.orgId is
  //     available and is not used to narrow it, so nothing stops an employee
  //     naming a partner in another company. There is one company today.
  // Neither is tightened here, because doing it in one endpoint and not its two
  // siblings would be a difference nobody could see. Chris's call to make.
  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  const adId = emptyToNull(body.ad_id);
  if (!adId) return res.status(400).json({ ok: false, error: "ad_id_required" });
  if (!UUID_RE.test(String(adId))) {
    return res.status(400).json({ ok: false, error: "ad_id_not_a_uuid" });
  }

  const setsAsset  = has(body, "asset_id");
  const setsNumber = has(body, "fundhub_ad_number");
  if (!setsAsset && !setsNumber) {
    return res.status(400).json({
      ok: false,
      error: "nothing_to_set",
      message: "send asset_id, fundhub_ad_number, or both. Send either as null " +
               "— or as an empty string — to clear it. Leave the field out to keep it."
    });
  }

  const assetId = setsAsset ? emptyToNull(body.asset_id) : undefined;
  if (setsAsset && assetId !== null && !UUID_RE.test(String(assetId))) {
    return res.status(400).json({ ok: false, error: "asset_id_not_a_uuid" });
  }

  const adNumber = setsNumber ? emptyToNull(body.fundhub_ad_number) : undefined;
  if (setsNumber && adNumber !== null && !AD_NUMBER_RE.test(String(adNumber))) {
    return res.status(400).json({
      ok: false,
      error: "invalid_ad_number",
      message: "our ad number is 1 to 9 digits — the leading digits of utm_content. " +
               "Meta's own id is longer than that and belongs in external_id, not here."
    });
  }

  try {
    const out = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const ad = (await tx.query(
        `SELECT id, org_id, partner_id, asset_id, fundhub_ad_number
           FROM ads WHERE id = $1 AND partner_id = $2`,
        [adId, partnerId]
      )).rows[0];
      if (!ad) {
        const e = new Error("ad not found");
        e.code = "AD_NOT_FOUND";
        throw e;
      }

      // Read the asset before writing, so a cross-partner attempt is answered
      // with a sentence rather than by the trigger raising through as a 500.
      if (setsAsset && assetId !== null) {
        const asset = (await tx.query(
          `SELECT id, org_id, partner_id FROM creative_assets WHERE id = $1`,
          [assetId]
        )).rows[0];
        // Under partner scope another partner's asset is invisible, so "not
        // visible" and "does not exist" arrive here as the same thing. That is
        // correct: telling a caller a row exists but is not theirs confirms it
        // exists.
        if (!asset) {
          const e = new Error("creative asset not found");
          e.code = "ASSET_NOT_FOUND";
          throw e;
        }
        if (asset.partner_id !== ad.partner_id) {
          const e = new Error("that creative belongs to a different partner");
          e.code = "CROSS_PARTNER";
          throw e;
        }
        if (asset.org_id !== ad.org_id) {
          const e = new Error("that creative belongs to a different company");
          e.code = "CROSS_ORG";
          throw e;
        }
      }

      // COALESCE would be wrong here: it cannot express "set this to NULL".
      // Each field is in the statement only when its key was sent, so an absent
      // field is genuinely untouched rather than rewritten with its old value.
      const sets = [];
      const params = [adId, partnerId];
      if (setsAsset)  { params.push(assetId);  sets.push(`asset_id = $${params.length}`); }
      if (setsNumber) {
        params.push(adNumber);
        sets.push(`fundhub_ad_number = $${params.length}`);
        // A number typed here is a person's number: source 'manual' (416), which
        // the daily Meta sync never overwrites (spec §10.5). Clearing the number
        // clears its source too — no number, nothing to say where it came from.
        params.push(adNumber === null ? null : "manual");
        sets.push(`fundhub_ad_number_source = $${params.length}`);
      }

      const updated = (await tx.query(
        `UPDATE ads SET ${sets.join(", ")}, updated_at = now()
          WHERE id = $1 AND partner_id = $2
          RETURNING id, org_id, partner_id, asset_id, fundhub_ad_number,
                    fundhub_ad_number_source, external_id, name`,
        params
      )).rows[0];

      // Practically unreachable — the same predicate SELECTed a row two
      // statements ago inside this transaction. Kept so that if it ever does
      // happen it fails out loud instead of answering 200 with `ad: undefined`.
      if (!updated) {
        const e = new Error("ad not found");
        e.code = "AD_NOT_FOUND";
        throw e;
      }

      // The spine row for this ad, read back through the view the labels
      // actually arrive on. This is the proof the link did something: before the
      // write every label column here is NULL.
      const spine = (await tx.query(
        `SELECT * FROM v_ad_label_spine WHERE ad_row_id = $1`, [adId]
      )).rows[0] || null;

      return { ad: updated, spine };
    });

    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    if (err.code === "AD_NOT_FOUND" || err.code === "ASSET_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: err.code.toLowerCase(), message: err.message });
    }
    if (err.code === "CROSS_PARTNER" || err.code === "CROSS_ORG") {
      return res.status(400).json({ ok: false, error: err.code.toLowerCase(), message: err.message });
    }
    // No 23505 branch any more: 416 replaced the unique index on the number
    // (ads_fundhub_number_uq, 377:575) with a plain one, so one number may sit
    // on several Meta ads (spec §10.4) and nothing here can collide.
    // 23514 — the CHECK. The JS guard above should have caught it first; if it
    // did not, the two regexes have drifted apart and that is worth seeing.
    if (err.code === "23514") {
      return res.status(400).json({ ok: false, error: "invalid_ad_number", message: "the database refused that ad number" });
    }
    // P0001 — a RAISE EXCEPTION, which on this table means trg_ads_asset_partner
    // (377 Part 4b). Reachable only if the checks above were somehow bypassed.
    if (err.code === "P0001" && /crosses partners/i.test(String(err.message || ""))) {
      return res.status(400).json({ ok: false, error: "cross_partner", message: "that creative belongs to a different partner" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
