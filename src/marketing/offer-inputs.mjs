// What the offer generator is allowed to read, and nothing else.
//
// Two sources only (owner brief, 2026-10-05):
//   1. The summaries — avatar, ad research, owner notes. Supplied in the request,
//      or read from the flywheel's own stage files when the request leaves one out.
//   2. The repo's own offer facts — every price in src/config/offers.mjs.
//
// THE DEFAULTS FOLLOW THE CHAT FLOW EXACTLY (.claude/commands/flywheel.md, stage 3):
//   avatarSummary     = marketing/flywheel/<campaign>/01-avatar.md, body after the stamp
//   adResearchSummary = marketing/flywheel/<campaign>/02-ad-research.md, body after the stamp
//   ownerNotes        = the "## Notes" section of 00-OWNER-NOTES.md
// and each is cut to the same length offer.js cuts it to. Same input, same
// answer, whichever door started the run.
//
// ON NETLIFY those files exist only because netlify.toml lists
// "marketing/flywheel/**" in included_files. Without that line the defaults read
// nothing, and the endpoint says "no avatar on file" rather than inventing one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontMatter } from "../../scripts/flywheel/status.mjs";
import {
  OFFERS, OFFER_KEYS, PARTNER_ADD_ONS, PARTNER_ADD_ON_KEYS,
  formatCents, partnerAddOnPriceLabel
} from "../config/offers.mjs";
import {
  AVATAR_MAX_CHARS, RESEARCH_MAX_CHARS, OWNER_NOTES_MAX_CHARS
} from "./offer-rubric.mjs";

export const DEFAULT_CAMPAIGN = "partner";

/* A campaign name becomes a folder name, so it is held to a slug. Anything else
   ("../../.env") is refused before a path is ever built from it. */
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function isCampaign(value) {
  return typeof value === "string" && CAMPAIGN_RE.test(value);
}

/* Where the repo root is at run time. Locally and in tests it is two folders up
   from this file. In a Netlify bundle the code lives in
   netlify/functions/<name>.mjs, which is ALSO two folders down, and the included
   files sit beside it; process.cwd() and LAMBDA_TASK_ROOT are the fallbacks. The
   first one that actually holds the flywheel folder wins. */
function candidateRoots(env = process.env) {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  return [here, process.cwd(), env.LAMBDA_TASK_ROOT].filter(Boolean);
}

export function flywheelDir(campaign, { roots = candidateRoots() } = {}) {
  if (!isCampaign(campaign)) return null;
  for (const root of roots) {
    const dir = path.join(root, "marketing", "flywheel", campaign);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/** The body of a stamped stage file, or "" when the file is not there. */
function stageBody(dir, file) {
  if (!dir) return "";
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return "";
  return splitFrontMatter(fs.readFileSync(p, "utf8")).body.trim();
}

/** The "## Notes" section of 00-OWNER-NOTES.md: the lines under it, up to the next "## ". */
export function ownerNotesSection(text) {
  const lines = String(text || "").split("\n");
  const start = lines.findIndex((l) => /^##\s+Notes\s*$/i.test(l.trim()));
  if (start === -1) return "";
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * readFlywheelDefaults(campaign) → { avatar, research, ownerNotes, files }
 * Each value is the full text (not yet cut); `files` names where each came from,
 * or null when that file is missing.
 */
export function readFlywheelDefaults(campaign, opts = {}) {
  const dir = flywheelDir(campaign, opts);
  const rel = (f) => `marketing/flywheel/${campaign}/${f}`;
  const avatar = stageBody(dir, "01-avatar.md");
  const research = stageBody(dir, "02-ad-research.md");
  const notesPath = dir ? path.join(dir, "00-OWNER-NOTES.md") : null;
  const ownerNotes = notesPath && fs.existsSync(notesPath)
    ? ownerNotesSection(fs.readFileSync(notesPath, "utf8"))
    : "";
  return {
    avatar,
    research,
    ownerNotes,
    files: {
      avatar: avatar ? rel("01-avatar.md") : null,
      research: research ? rel("02-ad-research.md") : null,
      ownerNotes: ownerNotes ? rel("00-OWNER-NOTES.md") : null
    }
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * resolveOfferInputs(body, { readDefaults }) → { ok, inputs } | { ok:false, error, message }
 *
 * A supplied summary always wins over the file. A field left out (or blank)
 * falls back to the flywheel file. An avatar is required in the end: an offer
 * designed for nobody is a guess. Ad research may be empty — offer.js then
 * designs from the avatar and says so, and so does this.
 */
export function resolveOfferInputs(body = {}, { readDefaults = readFlywheelDefaults } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const rawCampaign = text(b.campaign).toLowerCase();
  const campaign = rawCampaign || DEFAULT_CAMPAIGN;
  if (!isCampaign(campaign)) {
    return { ok: false, error: "bad_campaign",
      message: "The campaign name can only use lower-case letters, numbers and dashes, like \"partner\"." };
  }
  for (const key of ["avatar_summary", "ad_research_summary", "owner_notes"]) {
    if (b[key] != null && typeof b[key] !== "string") {
      return { ok: false, error: "bad_input", message: `${key} must be text.` };
    }
  }

  const supplied = {
    avatar: text(b.avatar_summary),
    research: text(b.ad_research_summary),
    ownerNotes: text(b.owner_notes)
  };
  const needsFiles = !supplied.avatar || !supplied.research || !supplied.ownerNotes;
  const defaults = needsFiles ? readDefaults(campaign) : { files: {} };

  const pick = (key) => {
    if (supplied[key]) return { value: supplied[key], source: "supplied", full: supplied[key].length };
    const fromFile = text(defaults[key]);
    if (fromFile) return { value: fromFile, source: defaults.files[key], full: fromFile.length };
    return { value: "", source: null, full: 0 };
  };
  const avatar = pick("avatar");
  const research = pick("research");
  const ownerNotes = pick("ownerNotes");

  if (!avatar.value) {
    return { ok: false, error: "avatar_required",
      message: `There is no buyer summary on file for "${campaign}". Paste the avatar summary, or finish flywheel stage 1 first.` };
  }

  const cut = (v, max) => v.slice(0, max);
  return {
    ok: true,
    inputs: {
      campaign,
      avatarSummary: cut(avatar.value, AVATAR_MAX_CHARS),
      adResearchSummary: cut(research.value, RESEARCH_MAX_CHARS),
      ownerNotes: cut(ownerNotes.value, OWNER_NOTES_MAX_CHARS),
      sources: {
        avatar: avatar.source,
        adResearch: research.source,
        ownerNotes: ownerNotes.source
      },
      cut: {
        avatar: avatar.full > AVATAR_MAX_CHARS,
        adResearch: research.full > RESEARCH_MAX_CHARS,
        ownerNotes: ownerNotes.full > OWNER_NOTES_MAX_CHARS
      }
    }
  };
}

/* ── THE PRICE LIST ─────────────────────────────────────────────────────────
   The only Fundhub facts the generator may use besides the summaries. Built
   from src/config/offers.mjs every time, so a price change there reaches the
   next offer with no second copy to forget. */

function clientOfferLine(o) {
  const terms = [];
  if (o.successFeePercent != null) terms.push(`plus a ${o.successFeePercent}% success fee`);
  if (o.priceMinCents != null && o.priceMinCents !== o.priceCents) {
    terms.push(`lowest a closer may discount to: ${formatCents(o.priceMinCents)}`);
  }
  if (o.financing === true) terms.push("can be financed");
  return {
    key: o.key,
    name: o.name,
    price: formatCents(o.priceCents),
    priceCents: o.priceCents,
    sold: "one-time",
    audience: null,
    terms
  };
}

function addOnLine(a) {
  return {
    key: a.key,
    name: a.name,
    price: partnerAddOnPriceLabel(a),
    priceCents: a.priceCents,
    sold: a.billing,
    audience: "partner",
    terms: [a.summary].filter(Boolean)
  };
}

/** Every live price, as plain rows. */
export function offerFacts() {
  return [
    ...OFFER_KEYS.map((k) => clientOfferLine(OFFERS[k])),
    ...PARTNER_ADD_ON_KEYS.map((k) => addOnLine(PARTNER_ADD_ONS[k]))
  ];
}

/** The price list as the prompt shows it. */
export function offerFactsText(facts = offerFacts()) {
  const rows = facts.map((f) =>
    `- ${f.key}: "${f.name}" — ${f.price} (${f.sold}${f.audience === "partner" ? ", a partner add-on" : ""})` +
    (f.terms.length ? `; ${f.terms.join("; ")}` : ""));
  return [
    "PRICE LIST (src/config/offers.mjs — the only prices that exist):",
    ...rows,
    "NOT ON FILE: the cost to get a customer, the close rate, the daily ad budget.",
    "The partner program is $10,000 once and nothing monthly; the partner add-ons are optional and stack freely."
  ].join("\n");
}

/** Every dollar amount on the price list, as whole cents. */
export function knownPriceCents(facts = offerFacts()) {
  const set = new Set();
  for (const f of facts) {
    if (Number.isFinite(f.priceCents)) set.add(f.priceCents);
  }
  for (const k of OFFER_KEYS) {
    const o = OFFERS[k];
    if (Number.isFinite(o.priceMinCents)) set.add(o.priceMinCents);
    if (Number.isFinite(o.priceMaxCents)) set.add(o.priceMaxCents);
  }
  return set;
}
