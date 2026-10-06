// @ts-check
// "Research the market" (J2, flywheel step 2) on the server, in 5 saved steps on the
// marketing worker.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 row J2, §3.2 item 6 (row 2) and
// §6 "Slice 10": "reach check and plan; up to 3 sweep rounds of 4 parallel
// claude-sonnet-5-5 calls, one per surface, each saving on its own; up to 4 competitor
// teardowns, reads only, no forms, no bookings; verify up to 14 key findings two ways each;
// confidence computed in code, then one claude-opus-5-5 board call in its own pass".
// Ported from .claude/workflows/ad-research.js: the same six phases, the same surfaces,
// the same schemas, the same confidence formula, the NO_PHANTOM and READER_FALLBACK rules.
// Unit X2.
//
// THE JOB. marketing_jobs kind 'flywheel_stage' with payload {campaign, stage: 2, market,
// competitors, today}; one run per company, campaign and stage in flight (migration 429).
// The board lands in marketing/flywheel/<campaign>/02-ad-research.md through the repo
// outbox, stamped with the avatar's body hash from the same pinned repo read.
//
// SOURCE CHECKS IN CODE (§5 rule 14): a finding is thrown out unless its URL was in that
// call's own search or fetch result blocks or citations; a headline is "verbatim" only
// when Anthropic's cited text or the fetched page holds those words (else it is labelled
// a paraphrase); a price stays only when a page that call read states it; every link in
// the written board must be one of the kept sources.
//
// CAPS (§5 rule 13): $40 a run (the batch cap until Settings gives market research its
// own) and the $300 month cap. Before every batch: spent so far plus the batch's worst
// case, with the board's reserve held back. The batch shrinks first; when not even one call
// fits, the run stops with "Stopped at the $40 run cap after step N. What it found so far
// is saved." and Resume continues from the saved steps.
//
// THE READER FALLBACK (§6 slice 10): only after an HTTP error ("url_not_accessible"),
// never after a robots.txt or domain refusal ("url_not_allowed"). A page that failed with
// an HTTP error is offered to the next round through Jina Reader (https://r.jina.ai/<url>);
// web fetch can open it because the address is in that round's prompt.

import { researchCall, searcherModel, WRITER_MODEL } from "../research/web-call.mjs";
import { logResearchUsage, monthUsedUsd } from "../research/usage.mjs";
import { reserveUsd, fitBatch, dollars, capSentence } from "../research/cost-guard.mjs";
import {
  normalizeUrl, linkIsSourced, statedOnPage, priceStated, keepOnlySourcedLinks, READER_PREFIX
} from "../research/provenance.mjs";
import { runSavedSteps, StepError, CapStop } from "../research/runner.mjs";
import { readStageFiles, stagePath, STAGE_FILES } from "../research/repo-read.mjs";
import { reviveSources } from "../research/deep-research.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { queueBuzz } from "../notify.mjs";
import { withTransaction } from "../../db/with-transaction.mjs";

export const KIND = "flywheel_stage";
export const STAGE = 2;
export const STEPS_TOTAL = 5;

export const DEFAULT_MARKET = "people who want to start or run their own business-funding company: brokers, ISOs, and would-be funding-company owners";

/** The search limits. The run's ceiling is computed from them, never typed. */
export const LIMITS = Object.freeze({
  rounds: 3,
  surfaces: 4,
  sweepSearches: 7,
  sweepFetches: 5,
  teardowns: 4,
  teardownSearches: 2,
  teardownFetches: 6,
  verifyFindings: 14,
  staleSearches: 1,
  verifyFetches: 2,
  probeFetches: 7,
  retrySearches: 32
});

/**
 * At most 106 searches a run (3 rounds × 4 surfaces × 7, 4 teardowns × 2, 14 staleness
 * checks × 1); 138 when a slow surface is retried (design §3.2 row 2's numbers).
 */
export function searchCeiling({ withRetries = false } = {}) {
  const base = LIMITS.rounds * LIMITS.surfaces * LIMITS.sweepSearches
    + LIMITS.teardowns * LIMITS.teardownSearches
    + LIMITS.verifyFindings * LIMITS.staleSearches;
  return withRetries ? base + LIMITS.retrySearches : base;
}

export const FETCH_TOKENS = 10_000;
export const SEARCH_MAX_TOKENS = 12_000;
export const PLAN_MAX_TOKENS = 8_000;
export const BOARD_MAX_TOKENS = 16_000;
export const BOARD_PROMPT_CHARS = 70_000;
export const VERIFY_WAVE = 4;

export function boardReserveUsd() {
  return reserveUsd({ model: WRITER_MODEL, promptChars: BOARD_PROMPT_CHARS, maxTokens: BOARD_MAX_TOKENS });
}

// ── the chat workflow's words (.claude/workflows/ad-research.js) ───────────────

const SURFACES = [
  {
    key: "competitor-funnels",
    what: `Direct competitors' own sites and funnels. Find the companies selling into this market and open their actual pages: sales pages, VSL pages, application and booking pages, pricing pages, order forms. For each, capture the exact headline, the promise, the price if shown, the guarantee if any, and the call to action. Names to start from if useful: Fund&Grow, Credit Repair Cloud, Jack McColl / Credit Stacking, business loan broker training programs, "broker in a box" and white-label funding programs.`
  },
  {
    key: "adjacent-productized",
    what: `Adjacent markets that already productized the same desire, because their language is proven and their pricing is public. Hard-money and real-estate lending "operate under your brand, our capital and back office" programs (Roc Capital, TVC, Unitas and similar), franchise-style business-in-a-box offers, and agency white-label programs. What do they promise, what do they charge, how do they structure the deal?`
  },
  {
    key: "organic-angles",
    what: `The angles the market is actually running organically, where reach is visible. YouTube titles and thumbnails aimed at this buyer, and how often the same angle repeats. A title format repeated across many videos and channels is a saturated angle. Note view counts and upload dates where visible, because an angle that stopped being made is a cooling angle.`
  },
  {
    key: "complaints-and-burnout",
    what: `Where the market says it has been burned, and which promises have stopped working. Reviews and complaints about competitor programs, refund and chargeback threads, "is X a scam" content, and forum threads where people say they have heard a pitch too many times. This is the evidence for calling an angle worn out.`
  }
];
export const SURFACE_KEYS = Object.freeze(SURFACES.map((s) => s.key));

const PROBE_TARGETS = [
  "https://www.google.com/",
  "https://www.youtube.com/",
  "https://www.trustpilot.com/",
  "https://www.reddit.com/",
  "https://www.dailyfunder.com/",
  "https://www.fundandgrow.com/",
  "https://www.creditrepaircloud.com/"
];

const NO_PHANTOM = `HARD RULE ON EVIDENCE: something goes on the board only if you actually
SAW it and can give the URL. Never reconstruct a page, a price or a headline from memory, and
never write "a typical offer in this space says...". If you cannot open a page, say so - a
blocked or dead URL is a result, not a failure, and it belongs in unreachable.
A price goes on the board only if a page stated it. "Around $5,000" without a page saying it
is a GUESS and does not ship.
"Worn out" is an INFERENCE, never a measurement: say exactly what you saw that made you infer
it. Competitor spend and conversion rates are NOT observable - do not imply you measured them.
A phantom competitor sends real money at a strategy nobody is running.`;

const JSON_ONLY = "When you are done, reply with ONE JSON object and nothing else - no words before or after it.";

const SEARCH_SYSTEM = "You are a careful market researcher for Fundhub. You have the web_search and web_fetch tools. Open the actual pages. Never submit a form, enter personal details, book anything or log in.";

const FINDING_SHAPE = `{"findings":[{"advertiser":"company name","headline":"the exact words on the page, verbatim","promise":"","price":"only if a page stated it; otherwise leave empty","guarantee":"","cta":"","angleId":"short-kebab-case-angle-id","sourceUrl":"the page address","evidenceTier":"A | B | C | D"}],"burnedOut":[{"angle":"","whyYouThinkSo":"","sourceUrl":""}],"unreachable":["a page or host you could not open, and how"],"nothingNew":false}`;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["competitors", "phrasings"],
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["name", "url", "why"],
        properties: { name: { type: "string" }, url: { type: "string" }, why: { type: "string" } }
      }
    },
    phrasings: { type: "array", items: { type: "string" } }
  }
};

function planPrompt(s) {
  return `Plan an investigation of what is already being sold into this market.

MARKET: ${s.market}
${s.avatar_summary ? `\nWHO THE BUYER IS (from the avatar stage):\n${s.avatar_summary}\n` : ""}
${s.competitors_seed.length ? `\nCompetitors already named by Chris: ${s.competitors_seed.join(", ")}` : ""}
${s.owner_notes ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override anything else:\n${s.owner_notes}` : ""}
${s.blocked.length ? `\nThese hosts did NOT answer and must not be planned against: ${s.blocked.join(", ")}` : ""}

Return:
- 5 to 10 named companies or programs selling into this market, each with the URL you would open first
- for each of the four surfaces below, the specific search phrasings worth trying, including
  insider jargon a naive researcher would not think of (ISO, MCA, merchant cash advance,
  broker in a box, white label funding, credit stacking, funding company startup)

The four surfaces: ${SURFACE_KEYS.join(", ")}

${NO_PHANTOM}`;
}

function probePrompt() {
  return `Before any research runs, find out what can actually be opened. Open each address below ONCE
with web_fetch. Do not read or analyse the pages. Then reply with one short line: done.

${PROBE_TARGETS.join("\n")}`;
}

function readerLines(urls) {
  if (!urls.length) return "";
  return `\nWHEN A PAGE REFUSES YOU: these pages answered with an error to a normal read. You may open them
through Jina Reader (it renders the page to plain text, needs no key and no login):
${urls.map((u) => `${READER_PREFIX}${u}`).join("\n")}
Evidence read through the reader is still tier C: you read the page, just not directly.\n`;
}

function sweepPrompt(s, surface, round) {
  return `Round ${round} of an investigation into what is already sold to this market.

MARKET: ${s.market}
YOUR SURFACE: ${surface.what}
Competitors already named: ${s.competitors.map((c) => `${c.name} (${c.url})`).join("; ") || "none yet - find them"}
Search phrasings worth trying: ${s.phrasings.join(" | ") || "use your judgement"}
${s.blocked.length ? `\nDo NOT plan against these, they did not answer: ${s.blocked.join(", ")}` : ""}
${round > 1 ? "\nEarlier rounds already logged findings. Report only what is NEW - different companies, different angles, different pages. Set nothingNew=true if this surface is exhausted." : ""}

Use web_search and web_fetch. OPEN THE ACTUAL PAGES.
${readerLines(s.reader_urls.slice(0, 6))}
A search snippet is weaker evidence than the page itself - if you only had the snippet, say so by
setting evidenceTier to D. A=the ad as served, B=someone else's copy of it, C=the destination page
itself, D=the market talking about it.

Give every distinct angle a short kebab-case angleId and reuse it if you see the same angle
again. Those ids travel down the whole chain, so make them descriptive.

${NO_PHANTOM}

${JSON_ONLY}
${FINDING_SHAPE}`;
}

function teardownPrompt(f) {
  return `Open this competitor's funnel properly and read what they actually sell.

START: ${f.sourceUrl}  (${f.advertiser})

Walk it as a buyer would: the sales page, then whatever it leads to - the VSL page, the
application, the booking page, the order form, the pricing page. Do not submit anything, do
not enter any personal details, do not book anything.

Report, verbatim where you can: the headline, the core promise, the named mechanism if they
have one, every price and payment term shown, the guarantee, what they ask for at the end,
and how many steps it takes to get there.

If a page needs a login or an application to go further, stop there and say so.

${NO_PHANTOM}

${JSON_ONLY}
{"advertiser":"","headline":"","promise":"","mechanism":"","prices":["each price exactly as the page shows it"],"guarantee":"","finalAsk":"","steps":["each page you opened, in order, with its address"],"stoppedBecause":""}`;
}

function provenancePrompt(f) {
  return `PROVENANCE CHECK. Someone reports that ${f.advertiser} runs this, at ${f.sourceUrl}:

  headline: "${f.headline}"
  ${f.price ? `price: ${f.price}` : ""}

Open that URL yourself (web_fetch) and check it says this. Try to REFUTE it. Set survives=false if the page
does not exist, does not say this, or says something materially different. Default to
survives=false when you are unsure.

${JSON_ONLY}
{"survives": true or false, "reason": "one sentence"}`;
}

function stalenessPrompt(f, today) {
  return `STALENESS CHECK, different lens. This claim about ${f.advertiser} may be
literally true and still misleading: "${f.headline}" ${f.price ? `at ${f.price}` : ""} (${f.sourceUrl}).

Today is ${today}. Is this current, or is it an old page nobody is driving traffic to any more?
Look for a last-updated date, copyright year, dead links, prices that contradict their other
pages, or a newer page that supersedes it. survives=false if this looks stale enough that
building an offer against it would be building against a ghost.

${JSON_ONLY}
{"survives": true or false, "reason": "one sentence"}`;
}

function boardPrompt(s, { solid, weaker, killed }) {
  const roundsLine = `${s.round}${s.round >= LIMITS.rounds && s.dry < 2 ? " (stopped at the round cap, not because the well ran dry)" : " (stopped because two rounds found nothing new)"}`;
  return `Write the ad research board for ${s.campaign}, as of ${s.today}.

You are handed a reliability header that was COMPUTED, not judged. Print it as written near the
top and do not soften it:

  Confidence: ${s.confidence}
  Findings: ${s.counts.rowsFound} | verified: ${s.counts.rowsVerified} | competitors: ${s.counts.competitorsFound} | with a stated price: ${s.counts.rowsWithFirstSeen}
  Rounds run: ${roundsLine}
  Could not reach: ${s.unreachable.join(", ") || "nothing"}
  The Meta Ad Library was NOT used. Competitor ad spend and conversion rates are not observable.

VERIFIED findings, these anchor the board:
${JSON.stringify(solid).slice(0, 18000)}

Other findings, present as weaker:
${JSON.stringify(weaker).slice(0, 12000)}

Funnel teardowns:
${JSON.stringify(s.teardowns).slice(0, 14000)}

Angles that look worn out:
${JSON.stringify(s.burned_out).slice(0, 6000)}

Findings that FAILED checking - mention in a "treat with caution" note, never as fact:
${JSON.stringify(killed).slice(0, 5000)}

Structure it as:
1. The one-line answer: what is this market actually being sold, and at what price.
2. What competitors charge - a short table, every price with the page it came from.
3. The angles in play, each with its angleId, and how heavily it is used.
4. Angles that look worn out, each with the specific evidence, clearly marked as inference.
5. What nobody is saying - the gaps. This is the most useful section for the offer stage.
6. What failed checking.
7. What could not be reached.

Write for Chris, who does not read code. Short sentences, plain words, no jargon without a
five-word definition. Every claim carries its URL inline. Use only the URLs given above.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** Do you recognise these competitors? · Is this angle really worn out? · Is anyone actually charging this?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const clean = (v, max = 1000) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const TIERS = new Set(["A", "B", "C", "D"]);
const OK_ONLY = (v) => !!(v && v.ok);

function arizonaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/* Sources ride through the checkpoint as JSON. */
function serializeSources(s) {
  return {
    urls: [...s.urls.entries()], cited: [...s.cited.entries()], fetched: [...s.fetched.entries()].map(([k, v]) => [k, v.slice(0, 200_000)]),
    fetchErrors: s.fetchErrors, searchErrors: s.searchErrors, vaultCited: [], searchQueries: s.searchQueries
  };
}

/**
 * keepMarketFindings(json, sources, round) → { kept, burned, dropped, paraphrased, pricesDropped, unreachable, readerUrls }
 * The source checks for one sweep call (rule 14).
 */
export function keepMarketFindings(json, sources, round) {
  const list = json && Array.isArray(json.findings) ? json.findings : [];
  const kept = [];
  let dropped = 0;
  let paraphrased = 0;
  let pricesDropped = 0;
  for (const f of list) {
    const headline = clean(f && f.headline, 600);
    const url = clean(f && f.sourceUrl, 600);
    if (!headline || !url || !linkIsSourced(url, sources)) { dropped += 1; continue; }
    const n = /** @type {string} */ (normalizeUrl(url));
    const out = {
      advertiser: clean(f.advertiser, 200) || "unknown",
      headline,
      headline_verbatim: statedOnPage(headline, url, sources),
      promise: clean(f.promise, 600),
      price: clean(f.price, 200),
      guarantee: clean(f.guarantee, 400),
      cta: clean(f.cta, 200),
      angleId: clean(f.angleId, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
      sourceUrl: sources.urls.get(n).url,
      evidenceTier: TIERS.has(f.evidenceTier) ? f.evidenceTier : "D",
      round
    };
    if (!out.headline_verbatim) paraphrased += 1;
    // A price goes on the board only if a page stated it (NO_PHANTOM), checked here.
    if (out.price && !priceStated(out.price, url, sources)) { out.price = ""; pricesDropped += 1; }
    kept.push(out);
  }
  const burned = (json && Array.isArray(json.burnedOut) ? json.burnedOut : [])
    .map((b) => ({ angle: clean(b && b.angle, 200), whyYouThinkSo: clean(b && b.whyYouThinkSo, 600), sourceUrl: clean(b && b.sourceUrl, 600) }))
    .filter((b) => b.angle && b.sourceUrl && linkIsSourced(b.sourceUrl, sources));
  const unreachable = [
    ...(json && Array.isArray(json.unreachable) ? json.unreachable.map((u) => clean(u, 300)).filter(Boolean) : []),
    ...sources.fetchErrors.map((e) => `${e.url || "a page"} (${e.code.replace(/_/g, " ")})`)
  ];
  // The reader fallback: only pages that failed with an HTTP error, never a robots.txt or
  // domain refusal (url_not_allowed), and never a page already read through the reader.
  const readerUrls = sources.fetchErrors
    .filter((e) => e.code === "url_not_accessible" && e.url && !String(e.url).startsWith(READER_PREFIX))
    .map((e) => String(e.url));
  return { kept, burned, dropped, paraphrased, pricesDropped, unreachable, readerUrls };
}

/** The confidence formula, unchanged from the chat workflow. Computed, never judged. */
export function confidenceOf({ findings, solid, teardowns }) {
  const tierC = findings.filter((f) => f.evidenceTier === "C").length;
  if (solid >= 6 && teardowns >= 2) return "measured";
  if (findings.length >= 8 && tierC >= 3) return "indirect";
  if (findings.length >= 3) return "inferred";
  return "unknown";
}

function addUnreachable(state, list) {
  const have = new Set(state.unreachable);
  for (const u of list) if (u && !have.has(u)) { have.add(u); state.unreachable.push(u); }
  if (state.unreachable.length > 200) state.unreachable = state.unreachable.slice(0, 200);
}

async function capsNow(io) {
  const s = (await io.db.query(`SELECT * FROM marketing_settings WHERE org_id = $1`, [io.orgId])).rows[0] || {};
  const runCaps = s.run_caps && typeof s.run_caps === "object" ? s.run_caps : {};
  const own = Number(runCaps.ad_research);
  const runCap = Number.isFinite(own) && own > 0 ? own : Number(s.max_batch_cost_usd == null ? 40 : s.max_batch_cost_usd);
  const shares = s.research_shares_month_cap == null ? true : s.research_shares_month_cap === true;
  const monthCap = shares ? Number(s.max_month_cost_usd == null ? 300 : s.max_month_cost_usd) : null;
  return {
    runCapUsd: runCap,
    monthCapUsd: monthCap,
    monthUsedUsd: monthCap == null ? 0 : await monthUsedUsd(io.db, io.orgId, { now: io.now() })
  };
}

/** How many of `wanted` calls fit; stops the run (Resume) when not even one does. */
async function fitOrStop(io, state, stepN, wanted, perCallUsd, { holdBack = true } = {}) {
  const caps = await capsNow(io);
  const spent = (await io.spent()).usd;
  const f = fitBatch({ wanted, perCallUsd, spentUsd: spent, ...caps, holdBackUsd: holdBack ? boardReserveUsd() : 0 });
  state.cap_usd = caps.runCapUsd;
  if (f.stop) {
    throw new CapStop(capSentence({ stop: f.stop, runCapUsd: caps.runCapUsd, monthCapUsd: caps.monthCapUsd, afterStep: stepN - 1 }), { stop: f.stop, capUsd: f.stop === "month_cap" ? caps.monthCapUsd : caps.runCapUsd });
  }
  return f;
}

async function searchesLeft(io) {
  const used = (await io.spent()).searches;
  return Math.max(0, searchCeiling({ withRetries: true }) - used);
}

async function logCalls(io, step, res) {
  for (const c of res.calls) {
    await logResearchUsage(io.db, { orgId: io.orgId, jobId: io.job.id, model: c.model, usage: c.usage, searches: c.searches, fetches: c.fetches, step });
  }
}

/** A batch of web calls, each saved the moment it lands. */
async function webBatch(io, state, stepN, items) {
  const left = await searchesLeft(io);
  const per = Math.max(...items.map((it) => reserveUsd({
    model: it.model, promptChars: it.prompt.length + SEARCH_SYSTEM.length, maxTokens: SEARCH_MAX_TOKENS,
    searches: it.searches, fetches: it.fetches, fetchTokens: FETCH_TOKENS
  })));
  const f = await fitOrStop(io, state, stepN, items.length, per);
  const chosen = items.slice(0, f.allowed);
  const share = Math.floor(left / Math.max(1, chosen.length));
  const results = await Promise.all(chosen.map((it) => io.once(it.key, async () => {
    const res = await researchCall({
      callModel: io.deps.callModel, env: io.env, model: it.model, system: SEARCH_SYSTEM, prompt: it.prompt,
      searches: it.searches > 0 ? Math.min(it.searches, share) : 0, fetches: it.fetches, fetchMaxTokens: FETCH_TOKENS,
      maxTokens: SEARCH_MAX_TOKENS, effort: "medium"
    });
    await logCalls(io, it.key, res);
    if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
    return { ok: true, json: res.json, sources: serializeSources(res.sources) };
  }, OK_ONLY)));
  return { results: [...results, ...items.slice(f.allowed).map(() => null)], fit: f };
}

function failIfAllFailed(results, what) {
  const done = results.filter(Boolean);
  if (!done.length || done.some((r) => r.ok)) return;
  const finalOne = done.find((r) => r.final);
  throw new StepError(`${what}: ${(finalOne || done[0]).plain}`, { final: !!finalOne });
}

/** "partner" → "Partner offer" (design §3.0 word table: folder names map to words). */
export function campaignWords(campaign) {
  if (campaign === "partner") return "Partner offer";
  return String(campaign || "").split("-").map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

// ── the steps ─────────────────────────────────────────────────────────────────

export const AD_RESEARCH_DEF = {
  kind: KIND,
  stepsTotal: STEPS_TOTAL,
  first: "plan",
  init(payload) {
    return {
      campaign: String(payload.campaign),
      market: clean(payload.market, 600) || DEFAULT_MARKET,
      competitors_seed: Array.isArray(payload.competitors) ? payload.competitors.map((c) => clean(c, 120)).filter(Boolean).slice(0, 20) : [],
      today: /^\d{4}-\d{2}-\d{2}$/.test(String(payload.today || "")) ? payload.today : arizonaToday(),
      owner_notes: "",
      note: clean(payload.note, 500) || null,
      avatar_summary: "",
      avatar_hash: null,
      inputs_source: null,
      inputs_sha: null,
      prior_version: null,
      probes: [],
      blocked: [],
      competitors: [],
      phrasings: [],
      findings: [],
      burned_out: [],
      unreachable: [],
      reader_urls: [],
      round: 0,
      dry: 0,
      teardowns: [],
      verify_keys: [],
      verdicts: {},
      dropped: 0,
      paraphrased: 0,
      prices_dropped: 0,
      failed_calls: 0,
      shrunk: [],
      cap_usd: null,
      confidence: null,
      counts: null,
      thin: null,
      document: null,
      links_removed: 0,
      repo_path: null
    };
  },
  progress(s) {
    return { round: s.round, findings: s.findings.length, checked: Object.values(s.verdicts).filter((v) => v.done).length, competitors: new Set(s.findings.map((f) => f.advertiser.toLowerCase())).size, shrunk: s.shrunk };
  },
  steps: {
    plan: {
      n: 1,
      word: () => "checking what can be reached and planning",
      async run(state, io) {
        // 1. The inputs, from one pinned repo read (or the bundle), with pending saves on top.
        const read = await (io.deps.readStageFiles || readStageFiles)(io.db, state.campaign, { env: io.env });
        state.inputs_source = read.source;
        state.inputs_sha = read.sha;
        state.avatar_summary = read.avatar ? read.avatar.body.slice(0, 6000) : "";
        state.avatar_hash = read.avatar ? read.avatar.hash : null;
        state.owner_notes = [read.ownerNotes, state.note ? `This run: ${state.note}` : ""].filter(Boolean).join("\n").slice(0, 2000);
        state.prior_version = read.priorVersion;

        // 2. Reach: open each target once. Reachable is decided in code from the fetch
        //    results, never from what the model says.
        const probeReserve = reserveUsd({ model: searcherModel(io.env), promptChars: 1000, maxTokens: 2000, fetches: LIMITS.probeFetches, fetchTokens: 1000 });
        const planReserve = reserveUsd({ model: WRITER_MODEL, promptChars: 12000, maxTokens: PLAN_MAX_TOKENS });
        await fitOrStop(io, state, 1, 1, probeReserve + planReserve);
        const probe = await io.once("reach", async () => {
          const res = await researchCall({
            callModel: io.deps.callModel, env: io.env, model: searcherModel(io.env), system: SEARCH_SYSTEM,
            prompt: probePrompt(), fetches: LIMITS.probeFetches, fetchMaxTokens: 1000, maxTokens: 2000, effort: "low"
          });
          await logCalls(io, "reach", res);
          if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
          return { ok: true, sources: serializeSources(res.sources) };
        }, OK_ONLY);
        if (!probe.ok) throw new StepError(`The reach check could not run: ${probe.plain}`, { final: !!probe.final });
        const ps = reviveSources(probe.sources);
        if (ps.urls.size + ps.fetchErrors.length === 0) {
          // The checker opened nothing at all (it did not try): try the step again.
          throw new StepError("The reach check did not try any page.");
        }
        state.probes = PROBE_TARGETS.map((t) => {
          const n = normalizeUrl(t);
          const err = ps.fetchErrors.find((e) => normalizeUrl(e.url) === n);
          const opened = !!n && ps.urls.has(n);
          return { target: String(n).split("/")[0], reachable: opened, evidence: opened ? "opened" : (err ? err.code.replace(/_/g, " ") : "not tried") };
        });
        state.blocked = state.probes.filter((p) => !p.reachable && p.evidence !== "not tried").map((p) => p.target);
        if (!state.probes.some((p) => p.reachable)) {
          throw new StepError("Anthropic's reader could not open any page. Nothing was researched.", { final: true });
        }

        // 3. The plan (Opus, structured output, no tools).
        const plan = await io.once("plan", async () => {
          const res = await researchCall({
            callModel: io.deps.callModel, env: io.env, model: WRITER_MODEL,
            prompt: planPrompt(state), maxTokens: PLAN_MAX_TOKENS, effort: "high", outputSchema: PLAN_SCHEMA
          });
          await logCalls(io, "plan", res);
          if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
          return { ok: true, json: res.json };
        }, OK_ONLY);
        if (!plan.ok) throw new StepError(`The plan was not written: ${plan.plain}`, { final: !!plan.final });
        const j = plan.json || {};
        state.competitors = (Array.isArray(j.competitors) ? j.competitors : [])
          .map((c) => ({ name: clean(c && c.name, 120), url: clean(c && c.url, 300), why: clean(c && c.why, 300) }))
          .filter((c) => c.name).slice(0, 10);
        state.phrasings = (Array.isArray(j.phrasings) ? j.phrasings : []).map((p) => clean(p, 150)).filter(Boolean).slice(0, 30);
        return { state, next: "sweep" };
      }
    },

    sweep: {
      n: 2,
      word: (s) => `reading the market, round ${Math.min(LIMITS.rounds, s.round + 1)} of ${LIMITS.rounds}`,
      async run(state, io) {
        const round = state.round + 1;
        const model = searcherModel(io.env);
        const items = SURFACES.map((s) => ({
          key: `sweep-r${round}-${s.key}`, prompt: sweepPrompt(state, s, round),
          searches: LIMITS.sweepSearches, fetches: LIMITS.sweepFetches, model
        }));
        const { results, fit } = await webBatch(io, state, 2, items);
        failIfAllFailed(results, `Round ${round} could not run`);
        state.round = round;
        if (fit.shrunk) state.shrunk.push(`Round ${round} read ${fit.allowed} of ${items.length} surfaces to stay under ${dollars(state.cap_usd)}.`);
        const seen = new Set(state.findings.map((f) => `${f.advertiser}|${f.headline}`.toLowerCase()));
        let novel = 0;
        let answered = 0;
        let allNothingNew = true;
        const reader = new Set(state.reader_urls);
        for (const r of results) {
          if (!r) continue;
          if (!r.ok) { state.failed_calls += 1; continue; }
          answered += 1;
          const k = keepMarketFindings(r.json, reviveSources(r.sources), round);
          for (const f of k.kept) {
            const key = `${f.advertiser}|${f.headline}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            state.findings.push({ ...f, id: state.findings.length + 1 });
            novel += 1;
          }
          state.burned_out.push(...k.burned);
          state.dropped += k.dropped;
          state.paraphrased += k.paraphrased;
          state.prices_dropped += k.pricesDropped;
          addUnreachable(state, k.unreachable);
          for (const u of k.readerUrls) reader.add(u);
          if (!(r.json && r.json.nothingNew === true)) allNothingNew = false;
        }
        state.reader_urls = [...reader].slice(0, 20);
        // A failed surface never counts toward a dry round.
        if (answered > 0 && (novel === 0 || allNothingNew)) state.dry += 1; else if (novel > 0) state.dry = 0;
        if (state.dry < 2 && state.round < LIMITS.rounds) return { state, next: "sweep" };
        return { state, next: "teardown" };
      }
    },

    teardown: {
      n: 3,
      word: () => "opening competitor funnels",
      async run(state, io) {
        const worth = state.findings.filter((f) => f.price || f.guarantee || f.evidenceTier === "C").slice(0, LIMITS.teardowns);
        if (!worth.length) return { state, next: "verify" };
        const model = searcherModel(io.env);
        const items = worth.map((f, i) => ({ key: `teardown-${i + 1}`, prompt: teardownPrompt(f), searches: LIMITS.teardownSearches, fetches: LIMITS.teardownFetches, model, finding: f }));
        const { results, fit } = await webBatch(io, state, 3, items);
        failIfAllFailed(results, "The funnel teardowns could not run");
        if (fit.shrunk) state.shrunk.push(`Opened ${fit.allowed} of ${items.length} funnels to stay under ${dollars(state.cap_usd)}.`);
        const teardowns = [];
        results.forEach((r, i) => {
          if (!r || !r.ok) { if (r && !r.ok) state.failed_calls += 1; return; }
          const src = reviveSources(r.sources);
          const pages = [...src.fetched.keys()];
          // Read-only teardown: it counts only when the call actually opened a page.
          if (!pages.length) { state.dropped += 1; return; }
          const j = r.json || {};
          const onAPage = (t) => pages.some((p) => statedOnPage(t, `https://${p}`, src));
          const prices = (Array.isArray(j.prices) ? j.prices : []).map((p) => clean(p, 200)).filter(Boolean);
          const keptPrices = prices.filter((t) => pages.some((p) => priceStated(t, `https://${p}`, src)));
          state.prices_dropped += prices.length - keptPrices.length;
          teardowns.push({
            advertiser: clean(j.advertiser, 200) || items[i].finding.advertiser,
            start: items[i].finding.sourceUrl,
            pages_read: pages.map((p) => src.urls.get(p).url),
            headline: clean(j.headline, 600),
            headline_verbatim: onAPage(clean(j.headline, 600)),
            promise: clean(j.promise, 800),
            mechanism: clean(j.mechanism, 400),
            prices: keptPrices,
            guarantee: clean(j.guarantee, 600),
            finalAsk: clean(j.finalAsk, 400),
            steps: (Array.isArray(j.steps) ? j.steps : []).map((x) => clean(x, 300)).filter(Boolean).slice(0, 12),
            stoppedBecause: clean(j.stoppedBecause, 300)
          });
          addUnreachable(state, src.fetchErrors.map((e) => `${e.url || "a page"} (${e.code.replace(/_/g, " ")})`));
        });
        state.teardowns = teardowns;
        return { state, next: "verify" };
      }
    },

    verify: {
      n: 4,
      word: (s) => `checking key findings (${Object.values(s.verdicts).filter((v) => v.done).length} of ${s.verify_keys.length || LIMITS.verifyFindings})`,
      async run(state, io) {
        if (!state.verify_keys.length) {
          state.verify_keys = state.findings.filter((f) => f.price || f.evidenceTier === "C").slice(0, LIMITS.verifyFindings).map((f) => f.id);
          if (!state.verify_keys.length) return { state, next: "board" };
        }
        const todo = state.verify_keys.filter((id) => !(state.verdicts[String(id)] && state.verdicts[String(id)].done));
        if (!todo.length) return { state, next: "board" };
        const wave = todo.slice(0, VERIFY_WAVE);
        const model = searcherModel(io.env);
        const byId = new Map(state.findings.map((f) => [f.id, f]));
        const items = wave.flatMap((id) => [
          { key: `verify-${id}-provenance`, prompt: provenancePrompt(byId.get(id)), searches: 0, fetches: LIMITS.verifyFetches, model },
          { key: `verify-${id}-staleness`, prompt: stalenessPrompt(byId.get(id), state.today), searches: LIMITS.staleSearches, fetches: LIMITS.verifyFetches, model }
        ]);
        const { results, fit } = await webBatch(io, state, 4, items);
        failIfAllFailed(results, "The checks could not run");
        for (const id of wave) {
          const f = byId.get(id);
          const prov = results[items.findIndex((it) => it.key === `verify-${id}-provenance`)];
          const stale = results[items.findIndex((it) => it.key === `verify-${id}-staleness`)];
          if (prov == null || stale == null) continue; // left out to stay under the cap
          const verdict = (r, needsOpen) => {
            if (!r.ok) return { survives: false, reason: "The check could not run." };
            const j = r.json || {};
            // Way one is only a pass when the checker really opened that page.
            const opened = !needsOpen || reviveSources(r.sources).fetched.has(/** @type {string} */ (normalizeUrl(f.sourceUrl)));
            if (needsOpen && !opened) return { survives: false, reason: "The checker could not open that page." };
            return { survives: j.survives === true, reason: clean(j.reason, 400) || "No reason given." };
          };
          const v = [verdict(prov, true), verdict(stale, false)];
          state.verdicts[String(id)] = { done: true, survives: v.every((x) => x.survives), doubts: v.filter((x) => !x.survives).map((x) => x.reason) };
        }
        if (fit.shrunk) {
          state.shrunk.push(`Checked ${Object.values(state.verdicts).filter((v) => v.done).length} of ${state.verify_keys.length} key findings to stay under ${dollars(state.cap_usd)}.`);
        }
        const left = state.verify_keys.filter((id) => !(state.verdicts[String(id)] && state.verdicts[String(id)].done));
        return { state, next: left.length && !fit.shrunk ? "verify" : "board" };
      }
    },

    board: {
      n: 5,
      word: () => "writing the board",
      async run(state, io) {
        const solid = state.findings.filter((f) => state.verdicts[String(f.id)] && state.verdicts[String(f.id)].survives);
        const killed = state.findings.filter((f) => state.verdicts[String(f.id)] && state.verdicts[String(f.id)].done && !state.verdicts[String(f.id)].survives)
          .map((f) => ({ advertiser: f.advertiser, headline: f.headline, doubts: state.verdicts[String(f.id)].doubts }));
        const weaker = state.findings.filter((f) => !solid.includes(f));
        state.counts = {
          rowsFound: state.findings.length,
          rowsVerified: solid.length,
          rowsWithFirstSeen: state.findings.filter((f) => f.price).length,
          competitorsFound: new Set(state.findings.map((f) => (f.advertiser || "").toLowerCase()).filter(Boolean)).size
        };
        state.confidence = confidenceOf({ findings: state.findings, solid: solid.length, teardowns: state.teardowns.length });
        if (state.confidence === "unknown") {
          // An `if`, not an agent, stops a board being written on top of nothing.
          state.thin = `Thin: not enough could be reached. ${state.counts.rowsFound} findings, ${state.counts.rowsVerified} checked.`;
          return { state, next: "done" };
        }
        await fitOrStop(io, state, 5, 1, boardReserveUsd(), { holdBack: false });
        const strip = (f) => ({ advertiser: f.advertiser, headline: f.headline_verbatim ? f.headline : `${f.headline} (paraphrase)`, promise: f.promise, price: f.price, guarantee: f.guarantee, cta: f.cta, angleId: f.angleId, sourceUrl: f.sourceUrl, evidenceTier: f.evidenceTier });
        const out = await io.once("board", async () => {
          const res = await researchCall({
            callModel: io.deps.callModel, env: io.env, model: WRITER_MODEL,
            prompt: boardPrompt(state, { solid: solid.map(strip), weaker: weaker.map(strip), killed }).slice(0, BOARD_PROMPT_CHARS),
            maxTokens: BOARD_MAX_TOKENS, effort: "high"
          });
          await logCalls(io, "board", res);
          if (!res.ok) return { ok: false, plain: res.plain, final: res.final };
          return { ok: true, text: res.text };
        }, (v) => !!(v && v.ok && String(v.text || "").trim()));
        if (!out.ok || !String(out.text || "").trim()) throw new StepError(`The board was not written: ${out.ok ? "it came back empty" : out.plain}`, { final: !!(out && out.final) });
        const kept = [...state.findings.map((f) => f.sourceUrl), ...state.teardowns.flatMap((t) => [t.start, ...t.pages_read]), ...state.burned_out.map((b) => b.sourceUrl)];
        const checked = keepOnlySourcedLinks(out.text, kept);
        state.document = checked.text.trim();
        state.links_removed = checked.removed;
        return { state, next: "save" };
      }
    },

    save: {
      n: 5,
      word: () => "saving the board to the repo",
      async run(state, io) {
        const file = renderStageFile(state);
        const repoPath = stagePath(state.campaign, "02-ad-research.md");
        await withTransaction(io.db, async (tx) => {
          await enqueueRepoWrite(tx, { orgId: io.orgId, opId: `flywheel-${io.job.id}-02`, path: repoPath, mode: "replace", content: file });
        });
        await queueBuzz(io.db, {
          orgId: io.orgId, kind: "flywheel_ready", groupKey: String(io.job.id),
          body: `The market research for ${campaignWords(state.campaign)} is ready to read.`
        });
        state.repo_path = repoPath;
        return { state, next: "done" };
      }
    }
  },
  async finish(state, io) {
    const spend = await io.spent();
    return {
      board: {
        campaign: state.campaign,
        confidence: state.confidence,
        counts: state.counts,
        thin: state.thin,
        repo_path: state.repo_path,
        version: state.repo_path ? (state.prior_version || 0) + 1 : null,
        inputs_source: state.inputs_source,
        cost_usd: spend.usd,
        searches: spend.searches,
        fetches: spend.fetches,
        sentence: state.thin || `Done. ${state.counts.rowsFound} findings, ${state.counts.rowsVerified} checked, ${state.counts.competitorsFound} competitors. Not reviewed.`
      }
    };
  }
};

/**
 * The stage file: the flywheel stamp (scripts/flywheel/status.mjs reads it), the board,
 * and a Sources list of every kept link. status starts draft; Approve flips it.
 */
export function renderStageFile(state) {
  const c = state.counts || { rowsFound: 0, rowsVerified: 0, rowsWithFirstSeen: 0, competitorsFound: 0 };
  const stamp = [
    "---",
    `stage: ${STAGE}`,
    `version: ${(state.prior_version || 0) + 1}`,
    "status: draft",
    "inputs:",
    ...(state.avatar_hash ? [`  01-avatar.md: ${state.avatar_hash}`] : []),
    "counts:",
    `  rowsFound: ${c.rowsFound}`,
    `  rowsVerified: ${c.rowsVerified}`,
    `  rowsWithFirstSeen: ${c.rowsWithFirstSeen}`,
    `  competitorsFound: ${c.competitorsFound}`,
    "---",
    ""
  ];
  const sources = [...new Set([
    ...state.findings.map((f) => f.sourceUrl),
    ...state.teardowns.flatMap((t) => t.pages_read)
  ])];
  const tail = [
    "",
    "---",
    "",
    "## How this was checked (written by code)",
    "",
    `- Built on the server as of ${state.today}. Inputs read from ${state.inputs_source === "github" ? `GitHub at ${String(state.inputs_sha || "").slice(0, 7)}` : "the copy bundled with the site"}.`,
    `- ${state.dropped} findings were thrown out because their link was not in what the search or fetch returned.`,
    `- ${state.paraphrased} headlines could not be matched word for word to the page, so they are marked paraphrase.`,
    `- ${state.prices_dropped} prices were left out because no page that was read stated them.`,
    `- ${state.links_removed} links in the write-up were removed because they were not sources this run read.`,
    ...state.shrunk.map((s) => `- ${s}`),
    "",
    "## Sources",
    "",
    ...sources.map((u) => `- ${u}`)
  ];
  return `${stamp.join("\n")}${state.document || ""}\n${tail.join("\n")}\n`;
}

/** The worker's handler for a stage-2 flywheel_stage job. */
export async function run(job, ctx) {
  return runSavedSteps(job, ctx, AD_RESEARCH_DEF);
}

export { STAGE_FILES };
