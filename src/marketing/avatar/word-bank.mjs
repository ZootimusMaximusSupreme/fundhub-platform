// @ts-check
// The market word bank (marketing/flywheel/<campaign>/01-avatar/Market_Language_Bank.md):
// merged in code, never replaced.
//
// Design docs/specs/command-center-design-2026-10-05.md §6 slice 5a step 5 ("merge the
// word bank in code, never replace it") and §3.2 ("The word bank is kept and added to,
// not replaced"). Every line already in the file stays exactly where it is. New checked
// quotes from this run are added under one new dated heading at the end. A quote whose
// words are already in the bank is not added twice.
//
// Entry format — the one the bank already uses:
//   - **<words>** — _<tag>_ (<source>)
// A paraphrase keeps the bank's own "[PARAPHRASE] " prefix inside the bold words.
//
// Pure: text in, text out.

import { normWords } from "./sources.mjs";

/* The bank holds three line shapes (it was mined in more than one pass):
     - **<words>** — _<tag>_ (<source>)
     - **<words>** — <source>
     - "<words>" ⭑            (the source on the next line, "  — <source>")
   Every one of them is an entry; the words are the bold or quoted part. */
const TAGGED = /^- \*\*(.+?)\*\* — _([^_]+)_ \((.*)\)\s*$/;
const BOLD = /^- \*\*(.+?)\*\*(?:\s+—\s+(.*))?\s*$/;
const QUOTED = /^- "(.+)"(?:\s*⭑)?\s*$/;

/**
 * The entries already in a bank file: [{ words, tag, source, key }]. key is the
 * normalized words (no "[PARAPHRASE]"), so a re-found quote matches its old line.
 * @param {string | null | undefined} text
 */
export function parseBank(text) {
  const out = [];
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let words = null; let tag = null; let source = null;
    let m;
    if ((m = TAGGED.exec(line))) { words = m[1]; tag = m[2]; source = m[3]; }
    else if ((m = BOLD.exec(line))) { words = m[1]; source = m[2] || null; }
    else if ((m = QUOTED.exec(line))) {
      words = m[1];
      const next = lines[i + 1] || "";
      if (/^\s+—\s+/.test(next)) source = next.replace(/^\s+—\s+/, "");
    }
    if (!words || !words.trim()) continue;
    const key = normWords(words);
    if (!key) continue;
    out.push({ words: words.trim(), tag: tag ? tag.trim() : null, source: source ? source.trim() : null, key });
  }
  return out;
}

/** One bank line for a checked quote. */
export function bankLine(q) {
  const words = String(q.quote || "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const shown = q.verbatim ? words : `[PARAPHRASE] ${words}`;
  const tag = String(q.tag || "tone").replace(/[_\s]+/g, "-");
  const src = String(q.source || "").replace(/[()\n]/g, " ").replace(/\s+/g, " ").trim();
  return `- **${shown}** — _${tag}_ (${src}; checked by the server against its search result)`;
}

/**
 * mergeBank(existing, quotes, { date, jobId, campaignWords }) →
 *   { text, kept, added, entries }
 *
 * kept:    entries already in the bank (all of them stay)
 * added:   new lines written this run
 * entries: kept + added
 * With no new quotes the file comes back unchanged.
 *
 * @param {string | null | undefined} existing the bank file as it is now (null = none yet)
 * @param {Array<{quote: string, source: string, tag?: string, verbatim: boolean}>} quotes
 * @param {{ date: string, jobId: string, campaignWords?: string }} opts
 */
export function mergeBank(existing, quotes, { date, jobId, campaignWords = "" }) {
  const old = parseBank(existing);
  const seen = new Set(old.map((e) => e.key));
  // "kept" counts different entries: the same words listed in two sections count once.
  const keptCount = seen.size;
  const fresh = [];
  for (const q of quotes || []) {
    const key = normWords(q.quote);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(q);
  }
  const base = existing == null || !String(existing).trim()
    ? `# Market Language Bank${campaignWords ? ` — ${campaignWords}` : ""}\n\nEvery entry keeps its source. Lines are added by each run, never removed.\n`
    : String(existing);
  if (!fresh.length) return { text: base, kept: keptCount, added: 0, entries: keptCount };
  const heading = `## Added by the server run on ${date} (job ${String(jobId).slice(0, 8)})`;
  const text = `${base.replace(/\s*$/, "")}\n\n${heading}\n\n${fresh.map(bankLine).join("\n")}\n`;
  return { text, kept: keptCount, added: fresh.length, entries: keptCount + fresh.length };
}
