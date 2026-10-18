// Exact catalog read checks. READ_GAPS contains only controls that still have
// no safe result probe. Measured read contracts run through proof modules that
// use GET only and return PASS, FAIL or skip without writing anything.

import {
  FIN_B27_H_READ_PROVED,
  runFinB27HReadResults,
} from "../catalog/proofs/fin-b27-h-read-contracts.mjs";

export const READ_GAPS = Object.freeze([]);

export const CHECK_IDS = Object.freeze([
  ...READ_GAPS.map((item) => item.id),
  ...FIN_B27_H_READ_PROVED.map((item) => item.id),
]);

export function sourceFileForReadSurface(surface) {
  if (surface === "read:climate/index.html#Map and national number: GET") return "public-pages.json";
  if (surface.startsWith("public/app/money-helper")) return "desks-d.json";
  if (surface.startsWith("public/app/") || surface === "payment-success.html") return "desks-e.json";
  if (surface.startsWith("present.html") || surface === "social-studio.html" || surface.startsWith("teleprompter.html")) return "desks-f.json";
  return "desks-a.json";
}

export async function gapChecks(ctx = {}) {
  const measured = await runFinB27HReadResults(ctx);
  const open = READ_GAPS.map((item) => ({
    id: item.id,
    status: "NOT_PROVED",
    detail: `${item.surface}: ${item.finding}`,
    suggestedFix: `Add a safe result probe for: ${item.control} Do not auto-fix. Chris fixes reds.`,
  }));
  const live = FIN_B27_H_READ_PROVED.map((item) => measured.get(item.id) || ({
    id: item.id,
    status: "skip",
    detail: `${item.surface}: the safe result probe returned no row.`,
    suggestedFix: null,
  }));
  return [...open, ...live];
}
