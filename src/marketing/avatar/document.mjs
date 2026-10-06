// @ts-check
// The files an avatar run saves to the repo, built from the run's saved progress.
// Pure: progress in, { path: text } out.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 J1 ("The Core Avatar
// Profile, six supporting documents and a Sources list, committed to
// marketing/flywheel/<campaign>/01-avatar* through the outbox") and §5 rule 14 ("Every
// file saved carries its sources list"; thin results print as thin, never padded).
// The stamp follows marketing/flywheel/README.md: stage, version, status, inputs,
// counts — read by scripts/flywheel/status.mjs (gates: quotes 20+, languageEntries 100+).

import { STAGES } from "../../../scripts/flywheel/status.mjs";
import { campaignWords } from "./campaigns.mjs";

const STAGE1 = STAGES.find((s) => s.n === 1);
/** The stage 1 gates, from the flywheel status script (one source of truth). */
export const GATES = Object.freeze({ quotes: STAGE1?.gates.quotes ?? 20, languageEntries: STAGE1?.gates.languageEntries ?? 100 });

/** The repo paths one run writes for a campaign. */
export function avatarPaths(campaign) {
  const dir = `marketing/flywheel/${campaign}`;
  return {
    main: `${dir}/01-avatar.md`,
    foundation: `${dir}/01-avatar/Service_Business_Foundation.md`,
    overview: `${dir}/01-avatar/Service_Overview.md`,
    desire: `${dir}/01-avatar/Desire_Market_Research.md`,
    mechanism: `${dir}/01-avatar/New_Mechanisms.md`,
    info: `${dir}/01-avatar/New_Information.md`,
    bank: `${dir}/01-avatar/Market_Language_Bank.md`,
    sources: `${dir}/01-avatar/Sources.md`
  };
}

/** The version number in a stage file's stamp, or 0. */
export function stampVersion(text) {
  const m = /^---\n[\s\S]*?^version:\s*(\d+)\s*$/m.exec(String(text || ""));
  return m ? Number(m[1]) : 0;
}

/** The avatar's name line ("Backdoored Brandon"), or null. */
export function avatarName(md) {
  const m = /^#{1,3}\s*Avatar Name:?\s*\**\s*"?([^"*\n]+?)"?\**\s*$/im.exec(String(md || ""));
  return m ? m[1].trim() : null;
}

/** Counts the stamp and the row print. */
export function runCounts(progress) {
  const q = progress?.quotes || {};
  const kept = Array.isArray(q.kept) ? q.kept : [];
  const info = progress?.info || {};
  const findings = Object.values(info.families || {}).reduce((n, f) => n + (Array.isArray(f?.kept) ? f.kept.length : 0), 0);
  const bank = progress?.bank || {};
  return {
    quotes: kept.length,
    verbatim: kept.filter((k) => k.verbatim).length,
    paraphrases: kept.filter((k) => !k.verbatim).length,
    dropped: (Number(q.dropped) || 0) + (Number(info.dropped) || 0),
    findings,
    newQuotes: Number(bank.added) || 0,
    keptEntries: Number(bank.kept) || 0,
    languageEntries: Number(bank.entries) || 0,
    unchecked: Array.isArray(progress?.check?.unchecked) ? progress.check.unchecked.length : 0,
    searches: Number(progress?.searches_used) || 0,
    fetches: Number(progress?.fetches_used) || 0,
    rounds: Number(q.round) || 0
  };
}

/** Thin lines, in the design's words ("Thin: 61 phrases, needs 100."). Empty when it clears the bar. */
export function thinLines(counts) {
  const out = [];
  if (counts.languageEntries < GATES.languageEntries) out.push(`Thin: ${counts.languageEntries} phrases, needs ${GATES.languageEntries}.`);
  if (counts.quotes < GATES.quotes) out.push(`Thin: ${counts.quotes} checked quotes, needs ${GATES.quotes}.`);
  return out;
}

/**
 * The one-line done sentence (design §3.2 row 1).
 * @param {ReturnType<typeof runCounts>} counts
 * @param {{ version?: number | null, approved?: boolean }} [opts]
 */
export function doneSentence(counts, { version = null, approved = false } = {}) {
  const v = version ? ` Version ${version}, built on the server.` : " Built on the server.";
  return `Done. ${counts.newQuotes} new quote${counts.newQuotes === 1 ? "" : "s"}, ${counts.keptEntries} kept.${v} ${approved ? "Approved." : "Not reviewed."}`;
}

function quoteLine(k) {
  return k.verbatim
    ? `- "${k.quote}" — ${k.source} (word for word: matched to the text Anthropic cited for this link)`
    : `- [PARAPHRASE] ${k.quote} — ${k.source} (the link was in the search results; the exact words could not be matched)`;
}

/** The checked Client Voice section the server writes into Desire_Market_Research.md. */
export function clientVoiceSection(kept) {
  const list = (kept || []).map(quoteLine);
  return [
    "## 4. Client Voice Evidence (Direct Quotes) — checked by the server",
    "",
    list.length ? list.join("\n") : "Thin: no quote could be checked against its link in this run.",
    ""
  ].join("\n");
}

/** Put the checked quotes where the model left the placeholder (or at the end). */
export function withClientVoice(desireDoc, kept) {
  const section = clientVoiceSection(kept);
  const doc = String(desireDoc || "");
  const marker = /^.*SECTION 4 IS FILLED IN BY THE CHECKER\.?.*$/m;
  if (marker.test(doc)) return doc.replace(marker, section.trimEnd());
  return `${doc.trimEnd()}\n\n${section}`;
}

/** Sources.md: every kept quote and finding with its link, what was dropped, what to treat with caution. */
export function sourcesDoc(progress, { campaign, jobId, date }) {
  const kept = progress?.quotes?.kept || [];
  const findings = Object.values(progress?.info?.families || {}).flatMap((f) => (Array.isArray(f?.kept) ? f.kept : []));
  const unchecked = progress?.check?.unchecked || [];
  const errors = [...(progress?.quotes?.errors || []), ...(progress?.info?.errors || [])];
  const counts = runCounts(progress);
  const lines = [
    `# Sources — ${campaignWords(campaign)} avatar`,
    "",
    `Built on the server on ${date} (job ${String(jobId).slice(0, 8)}). Every line below keeps the link it came from.`,
    `A quote or finding whose link was not in that same search's own results was thrown out by the checker (${counts.dropped} thrown out).`,
    "",
    `## Buyer quotes (${kept.length}: ${counts.verbatim} word for word, ${counts.paraphrases} paraphrased)`,
    "",
    kept.length ? kept.map(quoteLine).join("\n") : "Thin: none could be checked in this run.",
    "",
    `## New information (${findings.length})`,
    "",
    findings.length
      ? findings.map((f) => `- ${String(f.information || "").replace(/\s+/g, " ").trim()} — ${f.source}${f.publication ? ` (${String(f.publication).replace(/\s+/g, " ").trim()})` : ""}`).join("\n")
      : "Thin: no new information could be checked against a link in this run.",
    "",
    `## Treat with caution (${unchecked.length})`,
    "",
    unchecked.length
      ? `These quoted lines in the avatar are not in the checked quotes, so they are marked [UNCHECKED] where they appear:\n\n${unchecked.map((u) => `- "${u}"`).join("\n")}`
      : "Nothing: every quoted line in the avatar is in the checked quotes, the old word bank or the testimonials on file.",
    "",
    `## What we could not reach (${errors.length})`,
    "",
    errors.length ? errors.map((e) => `- ${e}`).join("\n") : "Nothing: every search and page read answered.",
    ""
  ];
  return lines.join("\n");
}

/** The review card at the bottom of 01-avatar.md (marketing/flywheel/README.md "What you actually read"). */
export function reviewCard(progress, counts) {
  const name = avatarName(progress?.docs?.final || progress?.docs?.avatar);
  const problems = (progress?.check?.issues || []).filter(Boolean).slice(0, 3);
  const three = problems.length
    ? problems.map((p, i) => `${i + 1}) ${String(p).replace(/\s+/g, " ").trim()}`).join(" ")
    : "1) Does the Core Desire sound like your buyers? 2) Is the Key Belief to Shift the one you sell against? 3) Would you run the Winning Hooks?";
  const unsure = [
    ...thinLines(counts),
    counts.paraphrases ? `${counts.paraphrases} quotes are paraphrased (their links are real; the exact words could not be matched).` : "",
    counts.unchecked ? `${counts.unchecked} quoted lines in the avatar are marked [UNCHECKED].` : ""
  ].filter(Boolean).join(" ");
  return [
    "## Review card",
    "",
    `**What this decided:** ${name ? `the buyer is "${name}".` : "who the buyer is (the avatar above)."}`,
    `**Three things to check:** ${three}`,
    `**What I wasn't sure about:** ${unsure || "nothing"}`,
    "**Say one of:** approve · tweak: <what to change> · redo",
    ""
  ].join("\n");
}

/**
 * avatarFiles(progress, { campaign, jobId, date, version, builtAt }) → { [repoPath]: text }
 * The eight files one run saves. The stamp's body hash is what later stages record.
 */
export function avatarFiles(progress, { campaign, jobId, date, version, builtAt }) {
  const p = avatarPaths(campaign);
  const d = progress?.docs || {};
  const counts = runCounts(progress);
  const stamp = [
    "---",
    "stage: 1",
    `version: ${version}`,
    "status: draft",
    "built_by: server",
    `job: ${jobId}`,
    `built_at: ${builtAt}`,
    "inputs:",
    "counts:",
    `  quotes: ${counts.quotes}`,
    `  languageEntries: ${counts.languageEntries}`,
    `  verbatim: ${counts.verbatim}`,
    `  paraphrases: ${counts.paraphrases}`,
    `  newQuotes: ${counts.newQuotes}`,
    `  keptEntries: ${counts.keptEntries}`,
    `  dropped: ${counts.dropped}`,
    `  unchecked: ${counts.unchecked}`,
    `  findings: ${counts.findings}`,
    `  searches: ${counts.searches}`,
    "---",
    ""
  ].join("\n");
  const body = [
    String(d.final || d.avatar || "").trim(),
    "",
    "## Sources",
    "",
    `Every quote and finding this avatar was built from is listed with its link in [01-avatar/Sources.md](01-avatar/Sources.md). ` +
      `${counts.quotes} checked quotes (${counts.verbatim} word for word), ${counts.findings} checked findings, ${counts.dropped} thrown out for having no matching link.`,
    "",
    reviewCard(progress, counts)
  ].join("\n");
  return {
    [p.main]: `${stamp}${body}`,
    [p.foundation]: `${String(d.foundation || "").trim()}\n`,
    [p.overview]: `${String(d.overview || "").trim()}\n`,
    [p.desire]: `${String(d.desire || "").trim()}\n`,
    [p.mechanism]: `${String(d.mechanism || "").trim()}\n`,
    [p.info]: `${String(d.info || "").trim()}\n`,
    [p.bank]: String(d.bank || ""),
    [p.sources]: sourcesDoc(progress, { campaign, jobId, date })
  };
}
