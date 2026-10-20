// Capital Blueprint — after a monthly soft pull lands, refresh checklist + letters.
//
// Blueprint buyers only. Does not replace C-06 on diagnostic pulls; this is the
// Finance OS system-request path (finance-os-pull-sweeper fulfil hook).

import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import { evaluateWaypoints } from "../waypoints/verify.mjs";
import { seedClientWaypoints } from "../waypoints/seed.mjs";
import { buildLetterPackForClient, PACK_REASON } from "../underwrite/letter-pack.mjs";
import {
  persistFundingLetterFiles,
  storeFromEnv
} from "../underwrite/funding-letter-pdf.mjs";

/**
 * runBlueprintMonthlyPullAftercare — waypoint verify, reseed paydowns, regen pack.
 * Best-effort: never throws for the whole call; reports partial failures.
 */
export async function runBlueprintMonthlyPullAftercare(db, {
  orgId,
  clientId,
  crsResultId = null,
  now = new Date(),
  isBuyer = isCapitalBlueprintBuyer,
  verify = evaluateWaypoints,
  seed = seedClientWaypoints,
  buildPack = buildLetterPackForClient,
  persist = persistFundingLetterFiles,
  store = null
} = {}) {
  if (!orgId || !clientId) {
    return { ok: false, skipped: true, reason: "missing_ids" };
  }

  const blueprint = await isBuyer(db, { orgId, clientId });
  if (!blueprint) {
    return { ok: true, skipped: true, reason: "not_blueprint_buyer" };
  }

  const out = {
    ok: true,
    skipped: false,
    crsResultId,
    waypoints: null,
    reseed: null,
    letterPack: null,
    failures: []
  };

  try {
    out.waypoints = await verify(db, { orgId, clientId, now });
  } catch (e) {
    out.waypoints = { ok: false, error: String(e?.message || e) };
  }

  try {
    out.reseed = await seed(db, { orgId, clientId, now });
  } catch (e) {
    out.reseed = { ok: false, error: String(e?.message || e) };
  }

  try {
    const pack = await buildPack(db, { clientId, pack: "funding" });
    if (!pack || pack.ok === false || pack.error || pack.engineSkip
        || (pack.reason && pack.reason !== PACK_REASON.EMPTY_PACK)) {
      throw new Error(pack?.reason || pack?.error || pack?.engineSkip || "letter_pack_failed");
    }
    const files = pack.files || [];
    out.letterPack = {
      ok: true,
      fileCount: files.length,
      reason: pack.reason || pack.engineSkip || null,
      letterSkip: pack.letterSkip || null
    };
    if (files.length && db && orgId) {
      const persisted = await persist(db, store || storeFromEnv(), {
        orgId,
        clientId,
        files,
        generatedBy: "blueprint-monthly-pull",
        sourceEventId: crsResultId ? `blueprint-monthly:${crsResultId}` : `blueprint-monthly:${clientId}`
      });
      out.letterPack.documentsStored = persisted.stored?.length ?? 0;
      out.letterPack.persistSkipped = persisted.skipped ?? null;
      out.letterPack.faults = persisted.faults || [];
      out.letterPack.unrecognised = persisted.unrecognised || [];
      if (persisted.ok === false || persisted.skipped || persisted.faults?.length
          || persisted.unrecognised?.length || persisted.notStored?.some((item) => item.fault)
          || ((persisted.stored?.length || 0) + (persisted.notStored?.length || 0)
            + (persisted.unrecognised?.length || 0) !== files.length)) {
        throw new Error("monthly_letter_files_not_saved");
      }
    }
    // Missing identity withholds letters even when the analysis PDFs exist.
    // Keep those useful saved files, but do not call the full delivery complete.
    if (pack.letterSkip) throw new Error(`monthly_letters_withheld: ${pack.letterSkip}`);
  } catch (e) {
    out.letterPack = { ...out.letterPack, ok: false, error: String(e?.message || e) };
  }

  for (const phase of ["waypoints", "reseed", "letterPack"]) {
    const result = out[phase];
    if (!result || result.ok !== true || result.error || result.errors?.length || result.errored?.length) {
      out.failures.push({ phase, error: result?.error || result?.reason || `${phase}_failed` });
    }
  }
  out.ok = out.failures.length === 0;

  return out;
}

export default runBlueprintMonthlyPullAftercare;
