// @ts-check
// Flywheel campaigns: one folder under marketing/flywheel/ per offer.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 row 6 ("Start a
// flywheel makes a folder and owner-notes file for any offer key in
// src/config/offers.mjs, for example the Capital Blueprint") and §3.0's word
// table ("Campaign folder names map to words: partner -> 'Partner offer'").
// Unit X3 (ops/workflows/marketing-machine-2026-10-extras.json).
//
// A campaign is a folder name (a slug). Which offer it sells is written once in
// its owner-notes file as the line "Offer key: <KEY>", so the stage writers can
// read the offer's facts (name, price) from src/config/offers.mjs and never
// guess them. The "partner" folder was made by hand before that line existed;
// it is the white-label partner program (marketing/flywheel/partner/03-offer.md
// sells the partnership), so it is mapped here by name.
//
// Pure: no database, no network, no disk.

import { OFFERS, OFFER_KEYS, getOffer } from "../../config/offers.mjs";
import { isCampaign, ownerNotesSection } from "../offer-inputs.mjs";

export { isCampaign, ownerNotesSection };

/** Folders made before the "Offer key:" line existed. */
export const KNOWN_CAMPAIGNS = Object.freeze({ partner: "PARTNER_ENTRY" });

/** Plain names for folders whose offer name reads badly as a tab label. */
const CAMPAIGN_WORDS = Object.freeze({ partner: "Partner offer" });

export const OFFER_LINE_RE = /^Offer key:\s*([A-Z0-9_]+)\s*$/m;

export const NOTES_FILE = "00-OWNER-NOTES.md";
export const NOTES_HEADING = "## Notes";

/** The offer keys a flywheel may be started for (every key in src/config/offers.mjs). */
export function offerKeys() {
  return [...OFFER_KEYS];
}

/**
 * The folder name for an offer: the existing folder when one is known, else the
 * offer's name as a slug ("Capital Blueprint" -> "capital-blueprint"). Words
 * after a dash or a bracket in the name are dropped ("Live Trial — seven days
 * under your brand" -> "live-trial"). null for a key that is not an offer.
 * @param {string} key
 * @returns {string|null}
 */
export function campaignForOffer(key) {
  const offer = getOffer(key);
  if (!offer) return null;
  for (const [campaign, k] of Object.entries(KNOWN_CAMPAIGNS)) if (k === offer.key) return campaign;
  const head = String(offer.name).split(/\s[—–-]\s|\s\(/)[0];
  let slug = head.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > 41) slug = slug.slice(0, 41).replace(/-[^-]*$/, "") || slug.slice(0, 41);
  return isCampaign(slug) ? slug : null;
}

/**
 * Which offer a campaign sells: the "Offer key:" line of its owner notes, else
 * the known folders, else null (the stage writers then say the offer is unknown).
 * @param {string} campaign
 * @param {string|null|undefined} notesText
 * @returns {string|null}
 */
export function offerKeyOf(campaign, notesText) {
  const m = OFFER_LINE_RE.exec(String(notesText || ""));
  if (m && getOffer(m[1])) return m[1];
  return Object.prototype.hasOwnProperty.call(KNOWN_CAMPAIGNS, campaign)
    ? KNOWN_CAMPAIGNS[/** @type {keyof typeof KNOWN_CAMPAIGNS} */ (campaign)]
    : null;
}

/**
 * The campaign in words, for every row label ("Ad copy for the Partner offer").
 * @param {string} campaign
 * @param {string|null|undefined} [notesText]
 */
export function campaignWords(campaign, notesText) {
  if (Object.prototype.hasOwnProperty.call(CAMPAIGN_WORDS, campaign)) {
    return CAMPAIGN_WORDS[/** @type {keyof typeof CAMPAIGN_WORDS} */ (campaign)];
  }
  const key = offerKeyOf(campaign, notesText);
  const offer = key ? getOffer(key) : null;
  if (offer) return String(offer.name).split(/\s[—–-]\s|\s\(/)[0];
  const words = String(campaign).split("-").filter(Boolean).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : String(campaign);
}

/**
 * The owner notes a new flywheel starts with. Same shape and same rule as
 * marketing/flywheel/partner/00-OWNER-NOTES.md, plus the offer line. The Notes
 * section starts empty: every line in it is Chris's.
 * @param {{campaign: string, offerKey: string, today: string}} args
 */
export function ownerNotesTemplate({ campaign, offerKey, today }) {
  const offer = getOffer(offerKey);
  if (!offer) throw new TypeError(`ownerNotesTemplate: ${offerKey} is not an offer in src/config/offers.mjs`);
  if (!isCampaign(campaign)) throw new TypeError("ownerNotesTemplate: campaign must be a folder name");
  return [
    `# Owner notes — ${campaign} flywheel`,
    "",
    "Hand-authored. Agents **append one line, never rewrite**. Same rule as the",
    "intended journey files.",
    "",
    `Offer key: ${offer.key}`,
    `Offer: ${offer.name}`,
    `Started from the Command Center on ${today}.`,
    "",
    "Every correction Chris makes to a stage goes here as one line, and it is fed",
    "back into that stage's prompt on every future re-run.",
    "",
    "Format:",
    "",
    "```",
    "YYYY-MM-DD | stage N | the correction, in one line",
    "```",
    "",
    NOTES_HEADING,
    ""
  ].join("\n");
}

/**
 * The owner-notes lines that apply to one stage: its own and the "all" lines.
 * The writers get these, never the whole file.
 * @param {string|null|undefined} notesText
 * @param {number} stage
 */
export function notesForStage(notesText, stage) {
  return ownerNotesSection(notesText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      const m = /^\d{4}-\d{2}-\d{2}\s*\|\s*(stage\s*(\d+)|all)\s*\|/i.exec(l);
      if (!m) return false;
      return m[1].toLowerCase() === "all" || Number(m[2]) === stage;
    })
    .join("\n");
}

/** One dated owner-notes line, in the file's own format. */
export function noteLine({ today, stage, note }) {
  const text = String(note || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return `${today} | stage ${stage} | ${text}`;
}

/** Every offer as {key, name, campaign} for the "Start a flywheel" picker. */
export function startableOffers() {
  return OFFER_KEYS.map((key) => ({ key, name: OFFERS[key].name, campaign: campaignForOffer(key) }));
}
