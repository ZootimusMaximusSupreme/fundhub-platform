const FILE_RE = /\b(?:(?:src|api|netlify|scripts|e2e)\/)?[A-Za-z0-9_./[\]-]+\.mjs\b/g;
const PING_RE = /\b(?:reg|job|wf):[A-Za-z0-9_./:-]+/g;

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function proofTargets(evidence, resolve = (reference) => [reference]) {
  const text = String(evidence || "");
  const paths = unique((text.match(FILE_RE) || []).flatMap((reference) => resolve(reference) || []));
  return {
    tests: paths.filter((file) => file.endsWith(".test.mjs") || file.endsWith(".spec.mjs")),
    lanes: paths.filter((file) => /src\/pulse\/coverage\/gap-[^/]+\.mjs$/.test(file) && !file.endsWith(".test.mjs")),
    beats: paths.filter((file) => /src\/pulse\/beats\/beat-[^/]+\.mjs$/.test(file) && !file.endsWith(".test.mjs")),
    pings: unique(text.match(PING_RE) || [])
  };
}
