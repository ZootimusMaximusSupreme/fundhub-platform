// Exact catalog read checks. READ_GAPS contains only controls that still have
// no safe result probe. Measured read contracts run through proof modules that
// use GET only and return PASS, FAIL or skip without writing anything.

import {
  FIN_B27_H_READ_PROVED,
  runFinB27HReadResults,
} from "../catalog/proofs/fin-b27-h-read-contracts.mjs";

function gap(id, surface, control, finding) {
  return Object.freeze({ id, surface, control, finding });
}

export const READ_GAPS = Object.freeze([
  gap("catalog-read:present-send-lock", "present.html (+ present.js, contract-send.js)", "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)", "The page has six send controls. Four are proved by a rendered test (fin-b23-present-send-lock.test.mjs): Send agreement + pay link, Invoice this client, Send contract and Send letters now lock while sending, hold for the 4 second cooldown, show Sent at and count repeats. Two do not meet the contract. (1) Generate letters and email now: present.js fire() reads `delivered` and `reason` off the object public/app/data.js write() returns, where the server answer sits under `data`, so a delivered pack is shown as \"Nothing was sent\", gets no Sent at line and no cooldown. (2) Send soft pull: it is drawn with ckBtn, not sendBtn, so it never shows Sending..., Sent at or a count (only the refusal of a repeat press works). Both need a present.js change before this row can be proved."),
]);

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
