// @ts-check
// Quick copy (the old "Write ad copy" button, demoted to the Ideas tab): the
// model it is forced to, and the checker's verdict in Chris's words.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 J9 ("One copy piece
// with the screen result, the checker's verdict, and the model actually used")
// and §3.2 "Existing": "force Anthropic with an explicit model as
// src/marketing/offer-transport.mjs does; run checkScriptText on the saved text
// and return the verdict". Unit X3.
//
// The verdict is the repo's own ad checker (scripts/ads/check-script.mjs
// checkScriptText, strict: Chris's Part 0 rules and the phrases he banned from
// the app) run on the words exactly as saved. No format is passed, so no
// length or close check runs: a Quick copy piece is short copy from a prompt,
// "not a checked ad script", and the card says so.

import { checkScriptText } from "../../scripts/ads/check-script.mjs";

/* The model it is forced to lives with the writer: src/creative/providers/copy.mjs
   QUICK_COPY_MODEL. */

/**
 * quickCopyVerdict(text) → { ok, words, failures: [{rule, message}] }
 * @param {string} text
 */
export function quickCopyVerdict(text) {
  const out = checkScriptText(String(text || ""), { strict: true });
  const failures = (out.failures || []).map((f) => ({ rule: f.rule, message: f.message }));
  const words = failures.length
    ? `Checked against the ad rules: ${failures.length} problem${failures.length === 1 ? "" : "s"}. ${failures.slice(0, 3).map((f) => cap(f.message)).join(" ")}`
    : "Checked against the ad rules: it passes.";
  return { ok: failures.length === 0, words, failures };
}

function cap(s) {
  const t = String(s || "").trim();
  const one = t ? t[0].toUpperCase() + t.slice(1) : t;
  return /[.!?]$/.test(one) ? one : `${one}.`;
}
