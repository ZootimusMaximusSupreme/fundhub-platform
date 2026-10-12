// Whole-company coverage catalog. Read only. Report only.
//
// The catalog is compiled before ship from Claude's 20-file surface map. This
// lane makes two promises visible in the morning pulse:
//   1. every mapped row still exists and has one recipe owner;
//   2. every unique item is either linked to executable proof or stays red.
//
// It does not run 3,941 checks here. Existing lanes, beats, pings and tests run
// those proofs. This lane checks the map that joins each company item to them.

import catalog from "../catalog/generated.json" with { type: "json" };

export const CHECK_IDS = Object.freeze(["catalog:all-mapped", "catalog:proof-linked"]);
export const MIN_MAPPED_ROWS = 3974;
export const EXPECTED_REPEATS = 33;
export const MIN_UNIQUE_ITEMS = 3941;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function judgeCatalog(value = catalog) {
  const rows = Number(value?.rows || 0);
  const repeats = Number(value?.repeats || 0);
  const unique = Number(value?.unique || 0);
  const wired = Number(value?.counts?.wired || 0);
  const red = Number(value?.counts?.red || 0);
  const items = Array.isArray(value?.items) ? value.items : [];
  const ids = new Set(items.map((item) => item?.id).filter(Boolean));
  const complete = rows >= MIN_MAPPED_ROWS && repeats === EXPECTED_REPEATS &&
    unique >= MIN_UNIQUE_ITEMS && items.length === unique && ids.size === unique;

  const mapRow = complete
    ? row(CHECK_IDS[0], "PASS", `${rows} mapped rows compile to ${unique} unique company items; ${repeats} marked repeats are removed.`)
    : row(
        CHECK_IDS[0],
        "FAIL",
        `Coverage catalog is incomplete: ${rows} mapped, ${repeats} repeats, ${unique} unique, ${items.length} saved items, ${ids.size} unique ids.`,
        "Restore the missing map rows or recipe owners, rebuild the catalog, and run npm run pulse:catalog -- --check. Do not hide or delete a red item."
      );

  const proofComplete = complete && wired + red === unique && red === 0;
  const proofRow = proofComplete
    ? row(CHECK_IDS[1], "PASS", `All ${unique} unique company items link to executable proof at the required level.`)
    : row(
        CHECK_IDS[1],
        "FAIL",
        `${wired} of ${unique} unique company items link to executable proof at the required level; ${red} remain red or unproved.`,
        "Open the generated coverage catalog, add real proof for red items, rebuild it, and keep moving. Never mark an item green without executable proof."
      );

  return [mapRow, proofRow];
}

export async function gapChecks() {
  return judgeCatalog(catalog);
}
