// @ts-check
// "Research it" (J20) on the server: deep research in saved steps on the marketing worker.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 row J20, §3.2 item 5, §5 safety
// rules 13, 14, 16, 17, 18 and §6 "Slice 10". Ported from .claude/workflows/deep-research.js
// (same phases, same schemas, the HONESTY block word for word). Unit X2.
//
// THE STEPS (marketing_jobs kind 'deep_research', one in flight per company):
//   1 plan        Opus plans the sub-questions (structured output, no tools)
//   2 vault       the Hormozi vault's best passages, read as search_result blocks
//   3 sweep       one Sonnet call per sub-question with web search and web fetch;
//                 Quick look: one round. Leave nothing unturned: rounds until two come
//                 back dry (at most 6)
//   4 chase       (deep only) what the best sources cite, one layer deeper
//   5 critic      (deep only) what everyone missed, and the belief line attacked
//   6 verify      key claims checked: Quick look one way (up to 5), deep two ways (up to 15)
//   7 synthesize  Opus writes the report; a report built by code when it fails twice
//   8 save        report.md and sources.json to marketing/research/<date>-<slug>-<id8>/
//                 through the repo outbox, and one buzz
//
// NOTHING INVENTED, IN CODE (rule 14): a web finding is kept only when its link is in that
// call's own search or fetch results or citations; a quote stays only when its words are
// in Anthropic's cited text for that link or in the page web fetch returned; a vault quote
// must be in the named repo file. Every link in the written report must be a kept source.
//
// CAPS (rule 13): the stop amount Chris typed for this run (or Settings' "stop at $__ a
// run"), and the $300 month cap unless Settings says research has its own. Before every
// batch: spent so far plus the batch's worst case, with the write-up's reserve held back,
// so a run that hits its cap still ends with a report ("Done, stopped at the cap: $X after
// round N").

import { researchCall, searcherModel, WRITER_MODEL } from "./web-call.mjs";
import { logResearchUsage, monthUsedUsd } from "./usage.mjs";
import { reserveUsd, fitBatch, dollars } from "./cost-guard.mjs";
import {
  normText, linkIsSourced, quoteStatus, normalizeUrl, vaultQuoteHolds, keepOnlySourcedLinks
} from "./provenance.mjs";
import { loadVault, scorePassages, vaultBlocks, readVaultFile } from "./vault.mjs";
import { runSavedSteps, StepError } from "./runner.mjs";
import { readFlywheelDefaults } from "../offer-inputs.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { queueBuzz } from "../notify.mjs";
import { withTransaction } from "../../db/with-transaction.mjs";

export const KIND = "deep_research";
export const STEPS_TOTAL = 8;

/** How deep each choice goes. The search numbers are the run's hard ceiling. */
export const DEPTHS = Object.freeze({
  quick: Object.freeze({
    subs: 4, rounds: 1, sweepSearches: 13, sweepFetches: 5,
    chase: 0, chaseSearches: 0, chaseFetches: 0,
    critic: false, criticSearches: 0, criticFetches: 0,
    verifyClaims: 5, verifyWays: 1, verifySearches: 2, verifyFetches: 3,
    vaultPassages: 6
  }),
  deep: Object.freeze({
    subs: 8, rounds: 6, sweepSearches: 8, sweepFetches: 5,
    chase: 12, chaseSearches: 5, chaseFetches: 4,
    critic: true, criticSearches: 8, criticFetches: 4,
    verifyClaims: 15, verifyWays: 2, verifySearches: 3, verifyFetches: 3,
    vaultPassages: 10
  })
});

/**
 * The most web searches a run of this depth can make — computed from the limits above,
 * never typed (design §3.2: "N is computed by code from the server's own limits").
 * Quick look 62 ($0.62), Leave nothing unturned 542 ($5.42).
 */
export function searchCeiling(depth) {
  const d = DEPTHS[depth === "deep" ? "deep" : "quick"];
  return d.subs * d.rounds * d.sweepSearches + d.chase * d.chaseSearches
    + (d.critic ? d.criticSearches : 0) + d.verifyClaims * d.verifyWays * d.verifySearches;
}

/** Calls per verify pass (a pass is one worker claim). */
export const VERIFY_WAVE = 8;
/** Page size limit for a fetched page in research calls, in tokens. */
export const FETCH_TOKENS = 8000;
/* Output limits per call. Thinking counts toward max_tokens on Opus 5.5 and Sonnet 5.5
   and cannot be turned off, so a tight limit cuts a reply off ("cut off" is an error).
   These leave room for thinking and stay under the 270-second call cap without streaming:
   the long write-ups run at effort "medium" (Opus 5.5's own default) so they finish in time. */
export const SEARCH_MAX_TOKENS = 16_000;
export const PLAN_MAX_TOKENS = 16_000;
export const REPORT_MAX_TOKENS = 20_000;
/** The write-up's prompt is cut to about this many characters. */
export const REPORT_PROMPT_CHARS = 75_000;

/** What the write-up could cost at most — held back from every earlier batch. */
export function reportReserveUsd() {
  return reserveUsd({ model: WRITER_MODEL, promptChars: REPORT_PROMPT_CHARS, maxTokens: REPORT_MAX_TOKENS });
}

// ── prompts (from .claude/workflows/deep-research.js) ─────────────────────────

/* Word for word from the chat workflow (design §6 slice 10: "with the HONESTY block word
   for word"). */
export const HONESTY = `HARD RULES: never invent a quote, number, study or expert. Every claim carries
its real source (URL or publication+date). If a source is paywalled or unreachable, record THAT
- "could not reach" is a finding, not a failure. Prefer primary sources over articles about them.`;

const JSON_ONLY = `When you are done, reply with ONE JSON object and nothing else - no words before or after it.`;

const FINDINGS_SHAPE = `{"findings":[{"claim":"one finding in plain words","source":"the exact web address you read it on","quote":"words copied exactly from that page (leave out if you have none)","cites":["what this source itself cites, if it matters"],"importance":"key | supporting | minor"}],"unreachable":["a source you could not open, and why"],"nothingNew":false}`;

const SEARCH_SYSTEM = `You are a careful researcher for Fundhub. You have the web_search and web_fetch tools. Search many phrasings, open the actual pages and read them. Only report what a page you opened (or a search result you saw) actually says, with that page's address as the source.`;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["subQuestions"],
  properties: {
    subQuestions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "sources", "phrasings"],
        properties: {
          question: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
          phrasings: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

function planPrompt(s, ownFiles) {
  return `Research question: ${s.question}
${s.focus ? `\nGo deeper on: ${s.focus}\n` : ""}
Decompose this into the plan for an exhaustive investigation:
- ${s.depth === "deep" ? "4-8" : "2-4"} sub-questions that together cover the whole question, including the unflattering ones
  (what would prove the premise wrong, who loses, what the skeptics say)
- for each sub-question, which source families matter: forums/communities, review sites and
  complaints, industry reports and data, expert commentary, news/press, academic, competitor
  materials, regulatory/legal, video/podcast transcripts
- search phrasings a naive researcher would NOT try: insider jargon, slang, misspellings,
  adjacent topics, opposite framings
${s.belief ? `\nWhat the person asking already thinks the answer is (plan sub-questions that could prove it wrong): ${s.belief}\n` : ""}${ownFiles ? `\nOur own files (background only; never cite them as web sources):\n${ownFiles}\n` : ""}
${HONESTY}`;
}

function sweepPrompt(s, sub, round) {
  return `Round ${round} of an exhaustive investigation.

Main question: ${s.question}
Your sub-question: ${sub.question}
Source families to hit: ${(sub.sources || []).join("; ")}
Phrasings to try: ${(sub.phrasings || []).join(" | ")}

Use web_search and web_fetch. Search MANY phrasings, open the actual pages, read them.
${round > 1 ? "Previous rounds already logged findings - report only what is NEW. Try angles and phrasings not yet used. Set nothingNew=true if this vein is exhausted.\n" : ""}For important sources, list what THEY cite in the cites field.
${HONESTY}

${JSON_ONLY}
${FINDINGS_SHAPE}`;
}

function vaultPrompt(s, subs) {
  return `Research question: ${s.question}
Sub-questions: ${subs.map((x) => x.question).join(" | ")}

The search results above are passages from our own Hormozi notes (each one names its file).
Report what these passages say that answers the question. For every finding, "source" is the
exact file name the passage came from, and "quote" is words copied exactly from that passage.
Report nothing the passages do not say.
${HONESTY}

${JSON_ONLY}
${FINDINGS_SHAPE}`;
}

function chasePrompt(s, cite) {
  return `A source found during research on "${s.question}" cites this: ${cite}

Find and READ the cited thing itself (web_search, web_fetch). Report what it actually says about the question - which is often different from how it was summarized. ${HONESTY}

${JSON_ONLY}
${FINDINGS_SHAPE}`;
}

function criticPrompt(s, claims) {
  return `An investigation of "${s.question}" produced these findings (claims only):
${claims.map((c) => `- ${c}`).join("\n").slice(0, 30000)}
${s.belief ? `\nThe person asking already believed: "${s.belief}". Hunt hardest for evidence against that.\n` : ""}
Your only job: what did everyone MISS? Run your own searches now - sources nobody used, framings nobody tried, the question behind the question, contrary evidence, what an insider would check first. Report only findings NOT in the list. ${HONESTY}

${JSON_ONLY}
${FINDINGS_SHAPE}`;
}

const VERDICT_SHAPE = `{"survives": true or false, "reason": "one sentence"}`;

function refutePrompt(f) {
  return `Try to REFUTE this claim - check the source is real and says this, check the number is current, hunt for contradicting evidence: "${f.claim}" (source: ${f.source}). Default survives=false if uncertain.

${JSON_ONLY}
${VERDICT_SHAPE}`;
}

function misleadingPrompt(f) {
  return `Different lens - is this claim MISLEADING even if literally true (cherry-picked, outdated context, survivorship)? Claim: "${f.claim}" (source: ${f.source}). survives=false if it misleads.

${JSON_ONLY}
${VERDICT_SHAPE}`;
}

function reportPrompt(s, { solid, others, killed, unreachable, ownFiles }) {
  return `Write the research report for: ${s.question}
${s.focus ? `(This run went deeper on: ${s.focus})\n` : ""}
VERIFIED key findings (these anchor the report):
${JSON.stringify(solid).slice(0, 25000)}

Supporting findings (unverified, present as such):
${JSON.stringify(others).slice(0, 30000)}

Claims that FAILED verification (mention in a "treat with caution" note, do not present as fact):
${JSON.stringify(killed).slice(0, 8000)}

Sources that could not be reached:
${unreachable.join("; ").slice(0, 3000)}
${s.belief ? `\nWhat the person asking believed before this research: "${s.belief}". Say plainly whether the evidence supports it.\n` : ""}${ownFiles ? `\nOur own files (background only):\n${ownFiles.slice(0, 6000)}\n` : ""}
Structure: lead with the answer, then the evidence by theme, every claim with its source inline, a "what this means" section, a "what failed checking" note, and a final "what we could not reach" section so the reader knows the true edge of the research. Plain language. No filler.
Use only the sources given above. Do not add any other web address.`;
}

// ── small helpers ─────────────────────────────────────────────────────────────

const clean = (v, max = 2000) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const IMPORTANCE = new Set(["key", "supporting", "minor"]);

/** "who-sells-business-funding" from a question: a-z and 0-9, dashes, at most 40. */
export function slugOf(question) {
  const words = String(question || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 40) break;
    out = next;
  }
  return out || "research";
}

/** The folder this run saves to: marketing/research/<yyyy-mm-dd>-<slug>-<job id first 8>/. */
export function researchFolder(state, jobId) {
  return `marketing/research/${state.today}-${slugOf(state.question)}-${String(jobId).slice(0, 8)}`;
}

function arizonaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * keepWebFindings(json, sources, origin, round) → { kept, dropped, quotesUnchecked, unreachable }
 * The source checks for one web call's findings (rule 14).
 */
export function keepWebFindings(json, sources, origin, round) {
  const list = json && Array.isArray(json.findings) ? json.findings : [];
  const kept = [];
  let dropped = 0;
  let quotesUnchecked = 0;
  for (const f of list) {
    const claim = clean(f && f.claim, 1500);
    const source = clean(f && f.source, 500);
    if (!claim || !source || !linkIsSourced(source, sources)) { dropped += 1; continue; }
    const out = {
      claim,
      source: sources.urls.get(/** @type {string} */ (normalizeUrl(source))).url,
      importance: IMPORTANCE.has(f.importance) ? f.importance : "supporting",
      cites: Array.isArray(f.cites) ? f.cites.map((c) => clean(c, 300)).filter(Boolean).slice(0, 5) : [],
      origin, round
    };
    const quote = clean(f.quote, 600);
    if (quote) {
      if (quoteStatus(quote, out.source, sources) === "verbatim") Object.assign(out, { quote, quote_status: "verbatim" });
      else quotesUnchecked += 1;
    }
    kept.push(out);
  }
  const unreachable = [
    ...(json && Array.isArray(json.unreachable) ? json.unreachable.map((u) => clean(u, 300)).filter(Boolean) : []),
    ...sources.fetchErrors.map((e) => `${e.url || "a page"} (${e.code.replace(/_/g, " ")})`)
  ];
  return { kept, dropped, quotesUnchecked, unreachable };
}

/**
 * keepVaultFindings(json, passages, readFile) → { kept, dropped, quotesUnchecked }
 * A vault finding stays only when it names one of the passages' files and its quote is
 * in that repo file (read again from disk, never the model's copy).
 */
export function keepVaultFindings(json, passages, readFile) {
  const list = json && Array.isArray(json.findings) ? json.findings : [];
  const paths = new Set(passages.map((p) => p.path));
  const kept = [];
  let dropped = 0;
  let quotesUnchecked = 0;
  for (const f of list) {
    const claim = clean(f && f.claim, 1500);
    const source = clean(f && f.source, 300);
    const quote = clean(f && f.quote, 600);
    if (!claim || !paths.has(source)) { dropped += 1; continue; }
    const text = readFile(source);
    if (!quote || !text || !vaultQuoteHolds(quote, text)) { dropped += 1; if (quote) quotesUnchecked += 1; continue; }
    kept.push({
      claim, source, quote, quote_status: "verbatim",
      importance: IMPORTANCE.has(f.importance) ? f.importance : "supporting",
      cites: [], origin: "vault", round: 0
    });
  }
  return { kept, dropped, quotesUnchecked };
}

/** Add findings whose claim is new; returns how many were new. */
function addNovel(state, findings) {
  const seen = new Set(state.findings.map((f) => normText(f.claim)));
  let n = 0;
  for (const f of findings) {
    const k = normText(f.claim);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    state.findings.push({ ...f, id: state.next_id++ });
    n += 1;
  }
  return n;
}

function addUnreachable(state, list) {
  const have = new Set(state.unreachable);
  for (const u of list) if (u && !have.has(u)) { have.add(u); state.unreachable.push(u); }
  if (state.unreachable.length > 200) state.unreachable = state.unreachable.slice(0, 200);
}

/** The run's caps right now: { runCapUsd, monthCapUsd (null when research has its own), monthUsedUsd }. */
async function capsNow(io, state) {
  const s = (await io.db.query(
    `SELECT max_month_cost_usd, research_shares_month_cap FROM marketing_settings WHERE org_id = $1`,
    [io.orgId]
  )).rows[0] || {};
  const shares = s.research_shares_month_cap == null ? true : s.research_shares_month_cap === true;
  const monthCap = shares ? Number(s.max_month_cost_usd == null ? 300 : s.max_month_cost_usd) : null;
  return {
    runCapUsd: Number(state.cap_usd),
    monthCapUsd: monthCap,
    monthUsedUsd: monthCap == null ? 0 : await monthUsedUsd(io.db, io.orgId, { now: io.now() })
  };
}

/** How many of `wanted` calls fit, holding back the write-up's reserve. */
async function fit(io, state, wanted, perCallUsd) {
  const caps = await capsNow(io, state);
  const spent = (await io.spent()).usd;
  return fitBatch({ wanted, perCallUsd, spentUsd: spent, ...caps, holdBackUsd: reportReserveUsd() });
}

/** Searches this run may still make, from the ledger, against the depth's ceiling. */
async function searchesLeft(io, state) {
  const used = (await io.spent()).searches;
  return Math.max(0, searchCeiling(state.depth) - used);
}

/** Run one web call and write its bill to the ledger, call by call. */
async function webCall(io, state, step, opts) {
  const res = await researchCall({ ...opts, callModel: io.deps.callModel, env: io.env });
  for (const c of res.calls) {
    await logResearchUsage(io.db, { orgId: io.orgId, jobId: io.job.id, model: c.model, usage: c.usage, searches: c.searches, fetches: c.fetches, step });
  }
  return res;
}

function stopAtCap(state, fitResult, where) {
  state.stopped_at_cap = {
    reason: fitResult.stop, after_round: state.round, at: where,
    sentence: fitResult.stop === "month_cap"
      ? "Stopped at the month cap. Raise it in Settings or wait for next month."
      : `Stopped at the ${dollars(state.cap_usd)} cap after round ${state.round}.`
  };
}

/**
 * One parallel batch of web calls under the caps and the search ceiling.
 * items: [{ key, prompt, searches, fetches, model, effort }]. Returns the results in order
 * (null for an item left out to stay under a cap) and the fit.
 */
async function webBatch(io, state, step, items) {
  if (!items.length) return { results: [], fit: { allowed: 0, shrunk: false, stop: null } };
  const left = await searchesLeft(io, state);
  const per = Math.max(...items.map((it) => reserveUsd({
    model: it.model, promptChars: it.prompt.length + SEARCH_SYSTEM.length, maxTokens: SEARCH_MAX_TOKENS,
    searches: it.searches, fetches: it.fetches, fetchTokens: FETCH_TOKENS
  })));
  const f = await fit(io, state, items.length, per);
  if (f.stop) return { results: items.map(() => null), fit: f };
  const chosen = items.slice(0, f.allowed);
  const share = Math.floor(left / chosen.length);
  const results = await Promise.all(chosen.map((it) => io.once(it.key, async () => {
    const res = await webCall(io, state, it.key, {
      model: it.model, system: SEARCH_SYSTEM, prompt: it.prompt,
      searches: Math.min(it.searches, share), fetches: it.fetches, fetchMaxTokens: FETCH_TOKENS,
      maxTokens: SEARCH_MAX_TOKENS, effort: it.effort || "medium"
    });
    if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
    return { ok: true, json: res.json, sources: serializeSources(res.sources) };
  }, OK_ONLY)));
  return { results: [...results, ...items.slice(f.allowed).map(() => null)], fit: f };
}

/** Save a call's answer to the checkpoint only when it worked. */
const OK_ONLY = (v) => !!(v && v.ok);

/* Sources ride through `partial` as JSON, so Maps become arrays and back. */
function serializeSources(s) {
  return {
    urls: [...s.urls.entries()], cited: [...s.cited.entries()], fetched: [...s.fetched.entries()].map(([k, v]) => [k, v.slice(0, 200_000)]),
    fetchErrors: s.fetchErrors, searchErrors: s.searchErrors, vaultCited: [...s.vaultCited.entries()], searchQueries: s.searchQueries
  };
}
export function reviveSources(j) {
  return {
    urls: new Map(j.urls || []), cited: new Map(j.cited || []), fetched: new Map(j.fetched || []),
    fetchErrors: j.fetchErrors || [], searchErrors: j.searchErrors || [], vaultCited: new Map(j.vaultCited || []),
    searchQueries: j.searchQueries || []
  };
}

/** Throw the right StepError when every call of a batch failed. */
function failIfAllFailed(results, what) {
  const done = results.filter(Boolean);
  if (!done.length || done.some((r) => r.ok)) return;
  const finalOne = done.find((r) => r.final);
  throw new StepError(`${what}: ${(finalOne || done[0]).plain}`, { final: !!finalOne });
}

/** Own files (when ticked): the partner flywheel's stage files, background for plan and write-up only. */
function ownFilesText(state) {
  if (!state.sources.own_files) return "";
  const d = readFlywheelDefaults("partner");
  const parts = [];
  if (d.avatar) parts.push(`Who we sell to (marketing/flywheel/partner/01-avatar.md):\n${d.avatar.slice(0, 4000)}`);
  if (d.research) parts.push(`What the market sells (marketing/flywheel/partner/02-ad-research.md):\n${d.research.slice(0, 4000)}`);
  if (d.ownerNotes) parts.push(`Chris's notes:\n${d.ownerNotes.slice(0, 1500)}`);
  return parts.join("\n\n");
}

// ── the code-built report, for a write-up that failed twice or did not fit the cap ──

export function fallbackReport(state, { solid, others, killed }) {
  const line = (f) => `- ${f.claim} (${f.source})${f.quote ? ` — "${f.quote}"` : ""}`;
  const out = [
    `# Research: ${state.question}`,
    "",
    "**The write-up could not be finished, so this report was built by code from what was found. Every line below is a finding with the source it was read on.**",
    "",
    "## Key findings that held up",
    ...(solid.length ? solid.map(line) : ["- None were checked and held up."]),
    "",
    "## Other findings (not checked)",
    ...(others.length ? others.slice(0, 120).map(line) : ["- None."]),
    "",
    "## Treat with caution",
    ...(killed.length ? killed.map((k) => `- ${k.claim} (${k.source}) — ${k.doubts.join(" ")}`) : ["- Nothing failed checking."]),
    "",
    "## What we could not reach",
    ...(state.unreachable.length ? state.unreachable.map((u) => `- ${u}`) : ["- Nothing reported."])
  ];
  return out.join("\n");
}

/** The code-built checks footer every report carries (rule 14: printed, with the counts). */
function checksFooter(state, { solid, killed, unchecked }) {
  return [
    "",
    "---",
    "",
    "## How this was checked",
    "",
    `- ${state.findings.length} findings kept, each with the link it was read on. ${state.dropped} dropped because their link was not in what the search or fetch returned.`,
    `- ${state.quotes_unchecked} quotes could not be matched to the page, so they were left out.`,
    `- Key claims: ${solid.length} held up, ${killed.length} did not, ${unchecked} not checked.`,
    state.stopped_at_cap ? `- ${state.stopped_at_cap.sentence}` : null,
    "",
    "### Treat with caution",
    ...(killed.length ? killed.map((k) => `- ${k.claim} (${k.source}) — ${k.doubts.join(" ") || "did not hold up"}`) : ["- Nothing failed checking."]),
    "",
    "### What we could not reach",
    ...(state.unreachable.length ? state.unreachable.map((u) => `- ${u}`) : ["- Nothing reported."]),
    "",
    "### Sources",
    ...[...new Set(state.findings.map((f) => f.source))].map((s) => `- ${s}`)
  ].filter((l) => l !== null).join("\n");
}

function splitByVerdict(state) {
  const verdicts = state.verdicts || {};
  const solid = [];
  const killed = [];
  for (const f of state.findings) {
    const v = verdicts[String(f.id)];
    if (!v || !v.done) continue;
    if (v.survives) solid.push(f);
    else killed.push({ claim: f.claim, source: f.source, doubts: v.doubts || [] });
  }
  const checked = new Set([...solid, ...killed].map((f) => f.claim));
  const others = state.findings.filter((f) => !checked.has(f.claim) && !solid.includes(f));
  const unchecked = (state.verify_ids || []).filter((id) => !(verdicts[String(id)] && verdicts[String(id)].done)).length;
  return { solid, killed, others, unchecked };
}

// ── the steps ─────────────────────────────────────────────────────────────────

const roundWord = (s) => `sweeping round ${Math.max(1, s.round + 1)} of up to ${DEPTHS[s.depth].rounds}`;

export const DEEP_RESEARCH_DEF = {
  kind: KIND,
  stepsTotal: STEPS_TOTAL,
  first: "plan",
  init(payload) {
    const depth = payload.depth === "deep" ? "deep" : "quick";
    return {
      question: clean(payload.question, 1000),
      depth,
      sources: {
        web: payload.sources ? payload.sources.web !== false : true,
        vault: payload.sources ? payload.sources.vault !== false : true,
        own_files: !!(payload.sources && payload.sources.own_files === true)
      },
      belief: clean(payload.belief, 500) || null,
      focus: clean(payload.focus, 300) || null,
      cap_usd: Number(payload.max_cost_usd),
      today: /^\d{4}-\d{2}-\d{2}$/.test(String(payload.today || "")) ? payload.today : arizonaToday(),
      subs: [],
      passages: [],
      findings: [],
      next_id: 1,
      unreachable: [],
      round: 0,
      dry: 0,
      dropped: 0,
      quotes_unchecked: 0,
      failed_calls: 0,
      shrunk: [],
      verify_ids: [],
      verdicts: {},
      stopped_at_cap: null,
      report: null
    };
  },
  progress(s) {
    return { round: s.round, findings: s.findings.length, shrunk: s.shrunk };
  },
  steps: {
    plan: {
      n: 1,
      word: () => "planning the questions",
      async run(state, io) {
        const per = reserveUsd({ model: WRITER_MODEL, promptChars: 12_000, maxTokens: PLAN_MAX_TOKENS });
        const f = await fit(io, state, 1, per);
        if (f.stop) { stopAtCap(state, f, "plan"); return { state, next: "synthesize" }; }
        const plan = await io.once("plan", async () => {
          const res = await researchCall({
            callModel: io.deps.callModel, env: io.env, model: WRITER_MODEL,
            prompt: planPrompt(state, ownFilesText(state)), maxTokens: PLAN_MAX_TOKENS, effort: "high",
            outputSchema: PLAN_SCHEMA
          });
          for (const c of res.calls) {
            await logResearchUsage(io.db, { orgId: io.orgId, jobId: io.job.id, model: c.model, usage: c.usage, searches: c.searches, fetches: c.fetches, step: "plan" });
          }
          if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
          return { ok: true, json: res.json };
        }, OK_ONLY);
        if (!plan.ok) throw new StepError(`The plan was not written: ${plan.plain}`, { final: !!plan.final });
        const subs = (plan.json && Array.isArray(plan.json.subQuestions) ? plan.json.subQuestions : [])
          .map((x) => ({
            question: clean(x && x.question, 500),
            sources: Array.isArray(x && x.sources) ? x.sources.map((v) => clean(v, 100)).filter(Boolean).slice(0, 8) : [],
            phrasings: Array.isArray(x && x.phrasings) ? x.phrasings.map((v) => clean(v, 150)).filter(Boolean).slice(0, 10) : []
          }))
          .filter((x) => x.question)
          .slice(0, DEPTHS[state.depth].subs);
        if (!subs.length) throw new StepError("The plan came back with no sub-questions.");
        state.subs = subs;
        return { state, next: state.sources.vault ? "vault" : (state.sources.web ? "sweep" : "synthesize") };
      }
    },

    vault: {
      n: 2,
      word: () => "reading the Hormozi vault",
      async run(state, io) {
        const docs = (io.deps.loadVault || loadVault)();
        const query = [state.question, state.focus || "", ...state.subs.map((x) => `${x.question} ${x.phrasings.join(" ")}`)].join(" ");
        const passages = scorePassages(docs, query, { limit: DEPTHS[state.depth].vaultPassages });
        state.passages = passages.map((p) => ({ path: p.path, title: p.title, index: p.index }));
        if (!passages.length) {
          addUnreachable(state, [docs.length ? "The Hormozi vault had nothing on this question." : "The Hormozi vault is not on this server."]);
          return { state, next: state.sources.web ? "sweep" : "synthesize" };
        }
        const prompt = vaultPrompt(state, state.subs);
        const per = reserveUsd({ model: searcherModel(io.env), promptChars: prompt.length + passages.reduce((n, p) => n + p.text.length, 0), maxTokens: SEARCH_MAX_TOKENS });
        const f = await fit(io, state, 1, per);
        if (f.stop) { stopAtCap(state, f, "vault"); return { state, next: "synthesize" }; }
        const out = await io.once("vault", async () => {
          const res = await researchCall({
            callModel: io.deps.callModel, env: io.env, model: searcherModel(io.env),
            content: [...vaultBlocks(passages), { type: "text", text: prompt }],
            maxTokens: SEARCH_MAX_TOKENS, effort: "medium"
          });
          for (const c of res.calls) {
            await logResearchUsage(io.db, { orgId: io.orgId, jobId: io.job.id, model: c.model, usage: c.usage, searches: 0, fetches: 0, step: "vault" });
          }
          if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
          return { ok: true, json: res.json };
        }, OK_ONLY);
        if (!out.ok) throw new StepError(`The vault could not be read: ${out.plain}`, { final: !!out.final });
        const readFile = io.deps.readVaultFile || ((p) => readVaultFile(p));
        const k = keepVaultFindings(out.json, passages, readFile);
        addNovel(state, k.kept);
        state.dropped += k.dropped;
        state.quotes_unchecked += k.quotesUnchecked;
        return { state, next: state.sources.web ? "sweep" : "synthesize" };
      }
    },

    sweep: {
      n: 3,
      word: roundWord,
      async run(state, io) {
        const d = DEPTHS[state.depth];
        const round = state.round + 1;
        const model = searcherModel(io.env);
        const items = state.subs.map((sub, i) => ({
          key: `sweep-r${round}-q${i + 1}`, prompt: sweepPrompt(state, sub, round),
          searches: d.sweepSearches, fetches: d.sweepFetches, model
        }));
        const { results, fit: f } = await webBatch(io, state, "sweep", items);
        if (f.stop) { stopAtCap(state, f, "sweep"); return { state, next: "synthesize" }; }
        failIfAllFailed(results, `Sweep round ${round} could not run`);
        state.round = round;
        if (f.shrunk) state.shrunk.push(`Round ${round} read ${f.allowed} of ${items.length} sub-questions to stay under ${dollars(state.cap_usd)}.`);
        let novel = 0;
        let answered = 0;
        let allNothingNew = true;
        for (const r of results) {
          if (!r) continue;
          if (!r.ok) { state.failed_calls += 1; continue; }
          answered += 1;
          const k = keepWebFindings(r.json, reviveSources(r.sources), "sweep", round);
          novel += addNovel(state, k.kept);
          state.dropped += k.dropped;
          state.quotes_unchecked += k.quotesUnchecked;
          addUnreachable(state, k.unreachable);
          if (!(r.json && r.json.nothingNew === true)) allNothingNew = false;
        }
        // A failed call never counts toward a dry round: only answers can be dry.
        if (answered > 0 && (novel === 0 || allNothingNew)) state.dry += 1; else if (novel > 0) state.dry = 0;
        const more = state.depth === "deep" && state.dry < 2 && state.round < d.rounds;
        if (more) return { state, next: "sweep" };
        return { state, next: state.depth === "deep" ? "chase" : "verify" };
      }
    },

    chase: {
      n: 4,
      word: () => "following what the best sources cite",
      async run(state, io) {
        const d = DEPTHS[state.depth];
        const cites = [...new Set(state.findings.flatMap((f) => f.cites || []))].slice(0, d.chase);
        if (!cites.length) return { state, next: "critic" };
        const model = searcherModel(io.env);
        const items = cites.map((c, i) => ({ key: `chase-${i + 1}`, prompt: chasePrompt(state, c), searches: d.chaseSearches, fetches: d.chaseFetches, model }));
        const { results, fit: f } = await webBatch(io, state, "chase", items);
        if (f.stop) { stopAtCap(state, f, "chase"); return { state, next: "synthesize" }; }
        failIfAllFailed(results, "The chase could not run");
        if (f.shrunk) state.shrunk.push(`The chase read ${f.allowed} of ${items.length} cited sources to stay under ${dollars(state.cap_usd)}.`);
        for (const r of results) {
          if (!r) continue;
          if (!r.ok) { state.failed_calls += 1; continue; }
          const k = keepWebFindings(r.json, reviveSources(r.sources), "chase", state.round);
          addNovel(state, k.kept);
          state.dropped += k.dropped;
          state.quotes_unchecked += k.quotesUnchecked;
          addUnreachable(state, k.unreachable);
        }
        return { state, next: "critic" };
      }
    },

    critic: {
      n: 5,
      word: () => "looking for what everyone missed",
      async run(state, io) {
        const d = DEPTHS[state.depth];
        const items = [{ key: "critic", prompt: criticPrompt(state, state.findings.map((f) => f.claim)), searches: d.criticSearches, fetches: d.criticFetches, model: searcherModel(io.env), effort: "high" }];
        const { results, fit: f } = await webBatch(io, state, "critic", items);
        if (f.stop) { stopAtCap(state, f, "critic"); return { state, next: "synthesize" }; }
        const r = results[0];
        if (r && r.ok) {
          const k = keepWebFindings(r.json, reviveSources(r.sources), "critic", state.round);
          addNovel(state, k.kept);
          state.dropped += k.dropped;
          state.quotes_unchecked += k.quotesUnchecked;
          addUnreachable(state, k.unreachable);
        } else if (r && !r.ok) {
          if (r.final) throw new StepError(`The critic could not run: ${r.plain}`, { final: true });
          state.failed_calls += 1;
        }
        return { state, next: "verify" };
      }
    },

    verify: {
      n: 6,
      word: (s) => `checking key claims (${Object.values(s.verdicts || {}).filter((v) => v.done).length} of ${s.verify_ids.length || DEPTHS[s.depth].verifyClaims})`,
      async run(state, io) {
        const d = DEPTHS[state.depth];
        if (!state.verify_ids.length) {
          state.verify_ids = state.findings.filter((f) => f.importance === "key" && f.origin !== "vault").slice(0, d.verifyClaims).map((f) => f.id);
          if (!state.verify_ids.length) return { state, next: "synthesize" };
        }
        const todo = state.verify_ids.filter((id) => !(state.verdicts[String(id)] && state.verdicts[String(id)].done));
        if (!todo.length || !state.sources.web) return { state, next: "synthesize" };
        const perWave = Math.max(1, Math.floor(VERIFY_WAVE / d.verifyWays));
        const wave = todo.slice(0, perWave);
        const model = searcherModel(io.env);
        const byId = new Map(state.findings.map((f) => [f.id, f]));
        const items = [];
        for (const id of wave) {
          const fnd = byId.get(id);
          items.push({ key: `verify-${id}-a`, prompt: refutePrompt(fnd), searches: d.verifySearches, fetches: d.verifyFetches, model });
          if (d.verifyWays > 1) items.push({ key: `verify-${id}-b`, prompt: misleadingPrompt(fnd), searches: d.verifySearches, fetches: d.verifyFetches, model });
        }
        const { results, fit: f } = await webBatch(io, state, "verify", items);
        if (f.stop) { stopAtCap(state, f, "verify"); return { state, next: "synthesize" }; }
        failIfAllFailed(results, "The checks could not run");
        for (const id of wave) {
          const lenses = d.verifyWays > 1 ? ["a", "b"] : ["a"];
          const got = lenses.map((l) => results[items.findIndex((it) => it.key === `verify-${id}-${l}`)]);
          if (got.some((g) => g == null)) continue; // left out to stay under the cap: still unchecked
          const verdicts = got.map((g) => {
            if (!g.ok) return { survives: false, reason: "The check could not run." };
            const j = g.json || {};
            // Default survives=false when the check did not answer plainly.
            return { survives: j.survives === true, reason: clean(j.reason, 400) || "No reason given." };
          });
          state.verdicts[String(id)] = {
            done: true,
            survives: verdicts.every((v) => v.survives),
            doubts: verdicts.filter((v) => !v.survives).map((v) => v.reason)
          };
        }
        const left = state.verify_ids.filter((id) => !(state.verdicts[String(id)] && state.verdicts[String(id)].done));
        if (f.shrunk) {
          state.shrunk.push(`Checked ${Object.values(state.verdicts).filter((v) => v.done).length} of ${state.verify_ids.length} key claims to stay under ${dollars(state.cap_usd)}.`);
          return { state, next: "synthesize" };
        }
        return { state, next: left.length ? "verify" : "synthesize" };
      }
    },

    synthesize: {
      n: 7,
      word: () => "writing the report",
      async run(state, io) {
        const parts = splitByVerdict(state);
        const strip = (f) => ({ claim: f.claim, source: f.source, quote: f.quote || undefined, importance: f.importance });
        const attempts = Number((io.checkpoint.steps.synthesize || {}).attempts) || 0;
        let markdown = null;
        let fallback = false;
        // The write-up's reserve was held back from every batch, so it fits unless spend
        // overshot. When it does not fit, or it failed twice, the report is built by code.
        const caps = await capsNow(io, state);
        const spent = (await io.spent()).usd;
        const fitsNow = fitBatch({ wanted: 1, perCallUsd: reportReserveUsd(), spentUsd: spent, ...caps }).allowed === 1;
        if (state.findings.length && fitsNow && attempts < 2) {
          const out = await io.once("report", async () => {
            const res = await researchCall({
              callModel: io.deps.callModel, env: io.env, model: WRITER_MODEL,
              prompt: reportPrompt(state, {
                solid: parts.solid.map(strip), others: parts.others.map(strip), killed: parts.killed,
                unreachable: state.unreachable, ownFiles: ownFilesText(state)
              }).slice(0, REPORT_PROMPT_CHARS),
              maxTokens: REPORT_MAX_TOKENS, effort: "medium"
            });
            for (const c of res.calls) {
              await logResearchUsage(io.db, { orgId: io.orgId, jobId: io.job.id, model: c.model, usage: c.usage, searches: 0, fetches: 0, step: "report" });
            }
            if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
            return { ok: true, text: res.text };
          }, (v) => !!(v && v.ok && String(v.text || "").trim()));
          if (!out.ok || !String(out.text || "").trim()) {
            throw new StepError(`The write-up failed: ${out.ok ? "it came back empty" : out.plain}`, { final: false });
          }
          markdown = out.text;
        } else {
          fallback = true;
          markdown = state.findings.length
            ? fallbackReport(state, parts)
            : `# Research: ${state.question}\n\n**Nothing was found that could be kept.** ${state.stopped_at_cap ? state.stopped_at_cap.sentence : "Every finding was dropped because its link was not in what the search returned, or nothing could be reached."}`;
        }
        const keptUrls = state.findings.map((f) => f.source).filter((s) => /^https?:/i.test(s));
        const checkedLinks = keepOnlySourcedLinks(markdown, keptUrls);
        state.report = {
          markdown: `${checkedLinks.text.trim()}\n${checksFooter(state, parts)}\n`,
          fallback_report: fallback,
          links_removed: checkedLinks.removed,
          key_verified: parts.solid.length,
          key_killed: parts.killed.length,
          key_unchecked: parts.unchecked
        };
        return { state, next: "save" };
      }
    },

    save: {
      n: 8,
      word: () => "saving the report to the repo",
      async run(state, io) {
        const folder = researchFolder(state, io.job.id);
        const spend = await io.spent();
        const started = io.checkpoint.progress && io.checkpoint.progress.started_at;
        const minutes = started ? Math.max(1, Math.round((io.now().getTime() - new Date(started).getTime()) / 60000)) : null;
        const reportFile = renderReportFile(state, { jobId: io.job.id, status: "draft", costUsd: spend.usd, approvedAt: null });
        const sourcesFile = JSON.stringify({
          question: state.question,
          depth: state.depth,
          job_id: io.job.id,
          saved_on: state.today,
          findings: state.findings.map((f) => ({
            claim: f.claim, source: f.source, quote: f.quote || null, quote_status: f.quote_status || null,
            importance: f.importance, origin: f.origin,
            verified: state.verdicts[String(f.id)] && state.verdicts[String(f.id)].done ? state.verdicts[String(f.id)].survives : null
          })),
          unreachable: state.unreachable,
          dropped: state.dropped,
          quotes_unchecked: state.quotes_unchecked
        }, null, 2) + "\n";
        await withTransaction(io.db, async (tx) => {
          await enqueueRepoWrite(tx, { orgId: io.orgId, opId: `research-${io.job.id}-report`, path: `${folder}/report.md`, mode: "replace", content: reportFile });
          await enqueueRepoWrite(tx, { orgId: io.orgId, opId: `research-${io.job.id}-sources`, path: `${folder}/sources.json`, mode: "replace", content: sourcesFile });
        });
        await queueBuzz(io.db, {
          orgId: io.orgId, kind: "research_ready", groupKey: String(io.job.id),
          body: `The research is ready to read: ${state.question.slice(0, 90)}`
        });
        state.report = {
          ...state.report,
          unreachable: state.unreachable,
          dropped: state.dropped,
          quotes_unchecked: state.quotes_unchecked,
          rounds: state.round,
          cost_usd: spend.usd,
          searches: spend.searches,
          fetches: spend.fetches,
          minutes,
          stopped_at_cap: state.stopped_at_cap,
          repo_path: `${folder}/report.md`,
          sources_path: `${folder}/sources.json`
        };
        return { state, next: "done" };
      }
    }
  },
  finish(state) {
    return { report: state.report };
  }
};

/**
 * The report file: a small stamp, then the report. `status` is draft until Approve
 * (POST marketing/research/approve re-saves the same file with status approved).
 */
export function renderReportFile(state, { jobId, status, costUsd, approvedAt }) {
  const lines = [
    "---",
    "kind: deep-research",
    `job: ${jobId}`,
    `status: ${status}`,
    `question: ${JSON.stringify(state.question)}`,
    `depth: ${state.depth === "deep" ? "leave-nothing-unturned" : "quick-look"}`,
    `saved_on: ${state.today}`,
    approvedAt ? `approved_at: ${approvedAt}` : null,
    `cost_usd: ${costUsd == null ? "unknown" : Number(costUsd).toFixed(2)}`,
    `rounds: ${state.round}`,
    `key_verified: ${state.report ? state.report.key_verified : 0}`,
    `key_killed: ${state.report ? state.report.key_killed : 0}`,
    `fallback_report: ${state.report && state.report.fallback_report ? "true" : "false"}`,
    "---",
    ""
  ].filter((l) => l !== null);
  return `${lines.join("\n")}${state.report ? state.report.markdown : ""}`;
}

/** The worker's handler for kind 'deep_research' (src/marketing/job-kinds.mjs). */
export async function run(job, ctx) {
  return runSavedSteps(job, ctx, DEEP_RESEARCH_DEF);
}
