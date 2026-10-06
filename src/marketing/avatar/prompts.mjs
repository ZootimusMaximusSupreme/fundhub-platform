// @ts-check
// Chris's Avatar Builder SOP prompts, for the server run of flywheel step 1.
//
// PORTED FROM .claude/workflows/avatar-builder.js (design
// docs/specs/command-center-design-2026-10-05.md §3.2 Endpoints: "Stage 1 ports
// .claude/workflows/avatar-builder.js (its prompts word for word, minus the chat-only
// lines) into src/marketing/avatar/*.mjs"). The SOP text below is that file's text.
// What changed, and only this:
//   * Chat mechanics are gone: "You have tool access … Read the repo at /home/user/…",
//     "Load Google Drive tools via ToolSearch", "load via ToolSearch if needed". The
//     server cannot read the laptop or Drive, so Prompt 1 reads THE BUSINESS FACTS
//     block the run builds from the repo instead.
//   * "Use WebSearch" names the server tool Anthropic runs ("the web_search tool").
//   * A research call cannot return structured output (web search with citations plus
//     a schema is HTTP 400), so each research prompt ends with OUTPUT_RULES: one JSON
//     object after the last search, every source an exact link. The checker in
//     src/marketing/avatar/sources.mjs keeps only what those links prove.
//   * The COMPLIANCE verifier lens is not run. Owner note in
//     marketing/flywheel/partner/00-OWNER-NOTES.md, 2026-08-31, "all": "no compliance
//     checking in this pipeline. The product already screens ads before they send";
//     CLAUDE.md §7 (removed 2026-09-08). Fabrication and specificity still run.
//   * Every prompt carries Chris's owner notes for this step (the stage 1 and "all"
//     lines) and, after a Tweak, his one tweak line.
// Do not "improve" the SOP wording. A wording change is Chris's call.
//
// esbuild bundles these as strings; nothing here reads a file.

/** The role every SOP prompt opens with. ("Fundhub", not the old spelling: owner law 2026-09-21.) */
export const STRATEGIST = `You are "The Strategist" - a world-class marketing strategist and avatar
specialist, a leading expert in applying Eugene Schwartz's "Breakthrough Advertising" to
modern service-based businesses. Core principles: Desire-First (start with core desires,
never demographics), Service-Centric, Cascading Logic (each stage builds on the previous
documents), Actionable Output. This is Chris Stanbridge's Service Avatar Project SOP for
Fundhub, a business-funding company.`;

export const NO_FABRICATION = `HARD RULE ON QUOTES AND SOURCES: never invent a quote, statistic,
study, or expert opinion. A "Client Voice" quote may only be included with the real place
you found it (URL or platform + thread). If you cannot find real ones, say so and give
fewer. A paraphrase must be labelled [PARAPHRASE]. A made-up quote poisons every
downstream step of this project.`;

/** Prompt 4's watering holes: one research call per source family, per round. */
export const DESIRE_SOURCES = Object.freeze([
  "Reddit and forums: r/smallbusiness, r/Entrepreneur, r/loanoriginators, r/CommercialLending, broker and MCA forums",
  "Review sites: Google Reviews, Trustpilot, BBB complaints about funding companies, brokers and white-label programs",
  "Social: LinkedIn posts and comments, YouTube comments on business-funding and broker-opportunity videos",
  "Q&A and groups: Quora on becoming a loan broker / starting a funding company, Facebook broker groups",
  "Competitor case studies and testimonials: white-label and broker-in-a-box programs - the language their success stories use"
]);

/** Prompt 6's source families: one research call each. */
export const INFO_SOURCES = Object.freeze([
  "Industry reports: SBA lending data, Fed small-business credit surveys, broker-industry reports, alternative-lending market studies",
  "Expert commentary and contrarian takes: fintech and lending thought leaders, recent interviews and LinkedIn essays",
  "Emerging trends and fresh data: HBR, Forbes, deBanked, industry press on broker economics, white-label models, funding demand"
]);

/** The tags the word bank sorts quotes by (Chris's CUSTOMER LANGUAGE MINING SYSTEM, as the bank file names them). */
export const QUOTE_TAGS = Object.freeze(["pain", "desire", "objection", "trust", "status", "tone"]);

/* What a research call must end with. The server cannot take a schema next to web
   search, so the shape is asked for in words and checked in code. */
export const QUOTE_OUTPUT_RULES = `WHEN YOU ARE DONE SEARCHING, end your reply with ONE JSON object and nothing after it:
{"findings": "<what you learned, in a few sentences>",
 "quotes": [{"quote": "<the words exactly as written on the page>", "source": "<the exact URL of the search result it came from>", "paraphrase": false, "tag": "pain|desire|objection|trust|status|tone"}],
 "nothingNew": false}
Every "source" must be a full https:// link that appeared in your own search results in this conversation. A quote with no such link is thrown away by the checker. Put each quote's words in your answer with a citation to its result. If a quote is not word for word, set "paraphrase": true.`;

export const INFO_OUTPUT_RULES = `WHEN YOU ARE DONE, end your reply with ONE JSON object and nothing after it:
{"findings": [{"source": "<the exact URL>", "publication": "<publication, author, date>", "information": "<the new information>", "why_new": "<the sophistication gap>", "how_to_use": "<how to use it ethically>", "hooks": ["<hook>", "<hook>", "<hook>"]}],
 "nothingNew": false}
Every "source" must be a full https:// link that appeared in your own search or fetch results in this conversation. A finding with no such link is thrown away by the checker.`;

/** The owner-notes block every prompt carries. */
export function ownerNotesBlock(notes, tweak) {
  const lines = [];
  const n = String(notes || "").trim();
  if (n) lines.push(`OWNER NOTES (Chris's corrections for this step — follow every one):\n${n}`);
  const t = String(tweak || "").trim();
  if (t) lines.push(`CHRIS'S TWEAK FOR THIS RUN (follow it): ${t}`);
  return lines.join("\n\n");
}

const withNotes = (body, notes, tweak) => {
  const block = ownerNotesBlock(notes, tweak);
  return block ? `${body}\n\n${block}` : body;
};

/** Prompt 1 of 7 — the business foundation, from the facts the run gathered. */
export function foundationPrompt({ service, facts, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 1 OF 7 - SERVICE BUSINESS FOUNDATION.

Service to profile: ${service}

Ground every answer in the real business, not guesses. These are the business facts the
server read from the Fundhub repo for this run. Nothing outside them is known:

--- THE BUSINESS FACTS ---
${facts}
--- end of the business facts ---

Produce Service_Business_Foundation.md with every section of Chris's template, none omitted:
Part 1 Core Service Offering: 1. Primary Service (one sentence) 2. Service Category
3. The Core Problem.
Part 2 Client Profile & Transformation: 4. Ideal Client (specific) 5. The "Before" State
6. The "After" State.
Part 3 Service Delivery & Process: 7. Service Methodology 8. Key Deliverables 9. Pricing Model.
Part 4 Market Landscape & Differentiation: 10. Main Competitors (2-3, direct or indirect)
11. Your Differentiator 12. Client Objections.
Part 5 Client Voice & Evidence: 13. Best Testimonial (only if a real one exists in the
repo or Drive - otherwise write NONE ON FILE) 14. Common Questions (top 3-5)
15. Client Language (words they actually use).

${NO_FABRICATION}
Return only the markdown document.`, notes, tweak);
}

/** Prompt 3 of 7 — the client-centric overview. */
export function overviewPrompt({ foundation, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 3 OF 7 - SERVICE OVERVIEW BUILDER. Translate the foundation into a client-centric
overview. Key transformations Chris's SOP demands: Methodology becomes Process (the
client's journey), Deliverables become Tangible Outcomes, Differentiator becomes the
Unique Mechanism.

--- Service_Business_Foundation.md ---
${foundation}
--- end ---

Produce Service_Overview.md with all seven sections, none omitted:
1. The Core Promise (one clear statement of the result being bought)
2. The Client Journey (The Process) - step by step from the client's side
3. The Transformation (The Outcomes)
4. The Assumed Benefits (what outcomes let them DO or HAVE)
5. The Assumed Desires (what benefits let them FEEL or BECOME - "I want / I need" statements)
6. The Unique Mechanism (the differentiator, NAMED - a memorable proprietary name)
7. The Hidden Mechanisms (the reasons why the mechanism works)

Return only the markdown document.`, notes, tweak);
}

/** Prompt 4 of 7 — one source family, one round. */
export function desirePrompt({ round, source, foundation, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 4 OF 7 - DESIRE-BASED MARKET RESEARCH, round ${round}, source family: ${source}

North star - the Core Problem from the foundation document:
${String(foundation || "").slice(0, 2500)}

Use the web_search tool and search MANY different phrasings. You are
listening for the raw, unfiltered voice of the would-be funding-business owner or broker:
their Functional Wants, Emotional Needs, Pains & Frustrations, the Existing Solutions they
use and their complaints about each, and direct Client Voice quotes.
${round > 1 ? "Earlier rounds already captured a set of quotes - hunt for NEW angles and NEW threads, not repeats. Set nothingNew=true if this source family is exhausted." : ""}
${NO_FABRICATION}

${QUOTE_OUTPUT_RULES}`, notes, tweak);
}

/** Desire_Market_Research.md, assembled from the CHECKED notes only. Section 4 is written by code. */
export function desireAssemblePrompt({ notesJson, notes, tweak }) {
  return withNotes(`${STRATEGIST}

Assemble Desire_Market_Research.md from the raw research below, using Chris's exact template:
1. Wants & Needs Analysis (Functional Wants / Emotional Needs)
2. Pains & Frustrations (the big recurring ones)
3. Existing Solutions & Complaints (each current solution + its common complaint)
4. Client Voice Evidence (Direct Quotes) - at least 5-10, each with its real source; this
   is the most important section
5. New Desire Opportunities (untapped or underserved desires - the gaps)

Raw research notes:
${String(notesJson || "").slice(0, 60000)}

${NO_FABRICATION} Only quotes present in the notes above may appear.
Write section 4 as the single line "SECTION 4 IS FILLED IN BY THE CHECKER." - the server
puts every checked quote there with its link, so none can be retyped wrong.
Return only the markdown document.`, notes, tweak);
}

/** Prompt 5 of 7 — the mechanism (works from the overview alone). */
export function mechanismPrompt({ overview, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 5 OF 7 - NEW MECHANISM DISCOVERY. Weaponize the uniqueness. A mechanism for a
service is a framework, proprietary process, diagnostic tool, methodology or contrarian
approach - the answer to "why should I believe you when others failed?"

--- Service_Overview.md ---
${overview}
--- end ---

Produce New_Mechanisms.md with Chris's exact template:
1. The Core Mechanism (Named & Defined) - Mechanism Name + One-Sentence Definition
2. Mechanism Breakdown (The "How It Works") - 3 named Unique Elements
3. Contrarian Viewpoint (The "Why It's Different") - the industry wisdom this rejects
4. Marketing Hook Samples - 3 hooks that leverage the mechanism

Regulated consumer finance: no income claims, no credit-outcome claims, never name a lender.
Return only the markdown document.`, notes, tweak);
}

/** Prompt 6 of 7 — one source family of new information. */
export function infoPrompt({ source, service, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 6 OF 7 - NEW INFORMATION RESEARCH. Source family: ${source}
Service: ${service}

Use the web_search tool. Use the web_fetch tool (at most 3 pages) to read a page from your
search results when its snippet is not enough. Find genuinely NEW information competitors are not using - a trend or
statistic that reframes the problem, a contrarian expert opinion, a recent case study or
data point. For each: Source (publication, author, date), The New Information, Why it's
NEW (the sophistication gap), How to Use Ethically, 3 Marketing Hook Samples.
${NO_FABRICATION}

${INFO_OUTPUT_RULES}`, notes, tweak);
}

/** New_Information.md from the CHECKED findings only. */
export function infoAssemblePrompt({ notesJson, notes, tweak }) {
  return withNotes(`${STRATEGIST}

Assemble New_Information.md from the notes below using Chris's template - sections:
1. Emerging Trend/Statistic  2. Contrarian Expert Opinion  3. New Case Study or Data Point
- each with Source / The New Information / Why it's NEW / How to Use Ethically / 3 Marketing
Hook Samples. ${NO_FABRICATION}

Notes:
${String(notesJson || "").slice(0, 50000)}

Return only the markdown document.`, notes, tweak);
}

/** Prompt 7 of 7 — the Core Avatar Profile. */
export function avatarPrompt({ foundation, overview, desireDoc, mechanismDoc, infoDoc, notes, tweak }) {
  return withNotes(`${STRATEGIST}

PROMPT 7 OF 7 - CORE AVATAR BUILDER. Synthesize everything into the final deliverable.
Not a summary: a multi-dimensional profile of a single, specific avatar, brought to life.

--- Service_Business_Foundation.md ---
${foundation}
--- Service_Overview.md ---
${overview}
--- Desire_Market_Research.md ---
${desireDoc}
--- New_Mechanisms.md ---
${mechanismDoc}
--- New_Information.md ---
${infoDoc}
--- end of inputs ---

Produce Core_Avatar_Profile.md using Chris's exact template:
- Avatar Name (memorable, e.g. "Growth-Stalled Gary" is the existing CLIENT avatar - this
  one must be distinct) and Profile Summary
- The Core 5 Avatar Framework:
  1. DESIRES - Core Desire + Surface-Level Desires in their own words
  2. EXPERIENCES - Situational + Service-Based (with other providers)
  3. EMOTIONS - Primary + Secondary
  4. BEHAVIORS & HABITS
  5. DEMOGRAPHICS - last, never the driver
- Marketing & Messaging Blueprint: Core Message to Resonate, Winning Hooks (using the New
  Information and the New Mechanism), Pain Points to Agitate, Key Belief to Shift (From -> To)

Return only the markdown document.`, notes, tweak);
}

/** The verifier's answer shape (structured output: no web search in this call). */
export const VERDICT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["problems", "fabricatedQuotes", "passed"],
  properties: {
    problems: { type: "array", items: { type: "string" } },
    fabricatedQuotes: { type: "array", items: { type: "string" } },
    passed: { type: "boolean" }
  }
});

/** The two verifier lenses the server runs (compliance is not run: see the header). */
export function verifyPrompts({ avatar, desireDoc, infoDoc }) {
  return [
    {
      lens: "fabrication",
      prompt: `Adversarially review this avatar profile. Lens: FABRICATION. Every quote,
statistic, study and expert opinion must trace to the research documents and carry a real
source. List anything that looks invented. Default to suspicious.
${avatar}
--- research the quotes must come from ---
${String(desireDoc || "").slice(0, 20000)}
${String(infoDoc || "").slice(0, 15000)}`
    },
    {
      lens: "specificity",
      prompt: `Adversarially review this avatar profile. Lens: SPECIFICITY. Chris's SOP
demands a single, specific, alive avatar - not a demographic mush. Flag every line that
could describe any business owner anywhere, every hedge, every "may/might/some". Also flag
any violation of: desires-first (demographics must not drive), and the Core 5 structure.
${avatar}`
    }
  ];
}

/** The one repair pass. */
export function repairPrompt({ avatar, issues, notes, tweak }) {
  return withNotes(`${STRATEGIST}

Repair this Core Avatar Profile. Fix every listed issue: delete anything fabricated
(do not replace it with new inventions), sharpen anything generic, remove anything
non-compliant. Keep Chris's template structure intact.

Issues:
${issues.map((i) => `- ${i}`).join("\n")}

Profile:
${avatar}

Return only the corrected markdown document.`, notes, tweak);
}
