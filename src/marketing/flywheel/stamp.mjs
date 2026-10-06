// @ts-check
// The stamp every stage file starts with (marketing/flywheel/README.md "How a
// stage knows it is out of date"): stage, version, status, the body hash of each
// input it was built from, and the counts its gate reads. Written in exactly the
// shape scripts/flywheel/status.mjs parseFrontMatter() reads back, so
// `npm run flywheel:status` and the Ideas tab agree on a file the server wrote.
// Unit X3.

import { bodyHash, splitFrontMatter, parseFrontMatter } from "../../../scripts/flywheel/status.mjs";

export { bodyHash, splitFrontMatter, parseFrontMatter };

const KEY = /^[A-Za-z0-9_./-]+$/;

/**
 * stampStage({ stage, version, status, inputs, counts, body }) → the whole file.
 * inputs: { "03-offer.md": "4596bcc6", ... } (missing inputs are left out)
 * counts: { hooks: 31, ... } whole numbers only (a count that is not a whole
 *         number is left out, so the gate reads "did not report" rather than a lie)
 * extra:  more top-level lines after status (unit GL: `job: <uuid>`, the offer run
 *         an approved 03-offer.md was written from). Plain keys and one-word values
 *         only; anything else is left out.
 * @param {{stage: number, version: number, status?: string,
 *          inputs?: Record<string, string|null|undefined>, counts?: Record<string, any>,
 *          extra?: Record<string, string|null|undefined>, body: string}} args
 */
export function stampStage({ stage, version, status = "draft", inputs = {}, counts = {}, extra = {}, body }) {
  const lines = ["---", `stage: ${Number(stage)}`, `version: ${Number(version)}`, `status: ${status}`];
  for (const [k, v] of Object.entries(extra)) {
    if (/^[a-z][a-z0-9_]*$/.test(k) && !["stage", "version", "status", "inputs", "counts"].includes(k) &&
        typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v)) lines.push(`${k}: ${v}`);
  }
  const ins = Object.entries(inputs).filter(([k, v]) => KEY.test(k) && typeof v === "string" && /^[0-9a-f]{8}$/.test(v));
  if (ins.length) {
    lines.push("inputs:");
    for (const [k, v] of ins) lines.push(`  ${k}: ${v}`);
  }
  const cs = Object.entries(counts).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_]*$/.test(k) && Number.isInteger(v));
  if (cs.length) {
    lines.push("counts:");
    for (const [k, v] of cs) lines.push(`  ${k}: ${v}`);
  }
  lines.push("---", "");
  const text = String(body || "").replace(/^\s+/, "");
  return `${lines.join("\n")}\n${text.endsWith("\n") ? text : `${text}\n`}`;
}

/** The next version number for a stage file: the old stamp's version + 1, or 1. */
export function nextVersion(oldText) {
  if (!oldText) return 1;
  const meta = parseFrontMatter(splitFrontMatter(String(oldText)).frontMatter);
  const v = Number(meta.version);
  return Number.isInteger(v) && v > 0 ? v + 1 : 1;
}

/** The body hash of a file's text, or null when the file is not there. */
export function hashOf(text) {
  return text == null ? null : bodyHash(String(text));
}

/** A file's body (after the stamp), trimmed; "" when the file is not there. */
export function bodyOf(text) {
  return text == null ? "" : splitFrontMatter(String(text)).body.trim();
}

/** A file's counts block ({} when none). */
export function countsOf(text) {
  if (text == null) return {};
  return parseFrontMatter(splitFrontMatter(String(text)).frontMatter).counts || {};
}
