// What the offer generator may read: the summaries (supplied, or the flywheel's
// own stage files) and the price list in src/config/offers.mjs. Nothing else.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOfferInputs, readFlywheelDefaults, ownerNotesSection, flywheelDir,
  offerFacts, offerFactsText, knownPriceCents, isCampaign
} from "./offer-inputs.mjs";
import { OFFERS, OFFER_KEYS, PARTNER_ADD_ONS, PARTNER_ADD_ON_KEYS } from "../config/offers.mjs";
import { AVATAR_MAX_CHARS, OWNER_NOTES_MAX_CHARS } from "./offer-rubric.mjs";

const files = (over = {}) => () => ({
  avatar: "AVATAR FROM FILE", research: "RESEARCH FROM FILE", ownerNotes: "NOTES FROM FILE",
  files: { avatar: "marketing/flywheel/partner/01-avatar.md", research: "marketing/flywheel/partner/02-ad-research.md", ownerNotes: "marketing/flywheel/partner/00-OWNER-NOTES.md" },
  ...over
});

test("a supplied summary wins; a missing one falls back to the flywheel file", () => {
  const r = resolveOfferInputs({ avatar_summary: "  MY AVATAR  " }, { readDefaults: files() });
  assert.equal(r.ok, true);
  assert.equal(r.inputs.campaign, "partner");
  assert.equal(r.inputs.avatarSummary, "MY AVATAR");
  assert.equal(r.inputs.adResearchSummary, "RESEARCH FROM FILE");
  assert.equal(r.inputs.ownerNotes, "NOTES FROM FILE");
  assert.deepEqual(r.inputs.sources, {
    avatar: "supplied",
    adResearch: "marketing/flywheel/partner/02-ad-research.md",
    ownerNotes: "marketing/flywheel/partner/00-OWNER-NOTES.md"
  });
});

test("everything supplied reads no file at all", () => {
  let read = 0;
  const r = resolveOfferInputs({ avatar_summary: "a", ad_research_summary: "b", owner_notes: "c" },
    { readDefaults: () => { read++; return {}; } });
  assert.equal(r.ok, true);
  assert.equal(read, 0);
});

test("inputs are cut to offer.js's lengths, and the cut is recorded", () => {
  const r = resolveOfferInputs({ avatar_summary: "x".repeat(AVATAR_MAX_CHARS + 50), owner_notes: "n".repeat(OWNER_NOTES_MAX_CHARS + 1) },
    { readDefaults: files() });
  assert.equal(r.inputs.avatarSummary.length, AVATAR_MAX_CHARS);
  assert.equal(r.inputs.ownerNotes.length, OWNER_NOTES_MAX_CHARS);
  assert.deepEqual(r.inputs.cut, { avatar: true, adResearch: false, ownerNotes: true });
});

test("no avatar anywhere is refused — an offer for nobody is a guess", () => {
  const r = resolveOfferInputs({}, { readDefaults: files({ avatar: "", files: {} }) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "avatar_required");
  assert.match(r.message, /no buyer summary on file for "partner"/);
});

test("no research is allowed: the offer is designed from the avatar and the source says none", () => {
  const r = resolveOfferInputs({ avatar_summary: "a" }, { readDefaults: files({ research: "", files: {} }) });
  assert.equal(r.ok, true);
  assert.equal(r.inputs.adResearchSummary, "");
  assert.equal(r.inputs.sources.adResearch, null);
});

test("a campaign is a slug; a path is refused before any file is opened", () => {
  for (const bad of ["../../.env", "Partner/../x", "a b", "-x", "x".repeat(60)]) {
    const r = resolveOfferInputs({ campaign: bad }, { readDefaults: () => { throw new Error("must not read"); } });
    assert.equal(r.ok, false, bad);
  }
  assert.equal(isCampaign("partner"), true);
  assert.equal(flywheelDir("../.."), null);
  assert.equal(resolveOfferInputs({ avatar_summary: 5 }).error, "bad_input");
});

test("the real partner flywheel files are found and read the way the chat flow reads them", () => {
  const d = readFlywheelDefaults("partner");
  assert.equal(d.files.avatar, "marketing/flywheel/partner/01-avatar.md");
  assert.equal(d.files.research, "marketing/flywheel/partner/02-ad-research.md");
  assert.equal(d.files.ownerNotes, "marketing/flywheel/partner/00-OWNER-NOTES.md");
  assert.doesNotMatch(d.avatar, /^---\s*\nstage:/, "the stamp is not part of the summary");
  assert.match(d.ownerNotes, /^\d{4}-\d{2}-\d{2} \|/);
  const none = readFlywheelDefaults("no-such-campaign-here");
  assert.deepEqual(none.files, { avatar: null, research: null, ownerNotes: null });
});

test("ownerNotesSection takes only the lines under ## Notes", () => {
  const text = "# Title\nintro\n## Notes\n\n2026-01-01 | stage 3 | one\n2026-01-02 | all | two\n## Later\nnot this";
  assert.equal(ownerNotesSection(text), "2026-01-01 | stage 3 | one\n2026-01-02 | all | two");
  assert.equal(ownerNotesSection("no notes heading"), "");
});

test("the price list is src/config/offers.mjs, every row, no second copy", () => {
  const facts = offerFacts();
  assert.equal(facts.length, OFFER_KEYS.length + PARTNER_ADD_ON_KEYS.length);
  for (const k of OFFER_KEYS) {
    const row = facts.find((f) => f.key === k);
    assert.equal(row.priceCents, OFFERS[k].priceCents, k);
  }
  for (const k of PARTNER_ADD_ON_KEYS) {
    const row = facts.find((f) => f.key === k);
    assert.equal(row.priceCents, PARTNER_ADD_ONS[k].priceCents, k);
  }
  const text = offerFactsText(facts);
  assert.match(text, /PARTNER_ENTRY: "White-label partner program" — \$10,000/);
  assert.match(text, /FUNDING_DFY: .* plus a 10% success fee/);
  assert.match(text, /NOT ON FILE: the cost to get a customer/);
  assert.ok(knownPriceCents().has(1000000));
  assert.ok(knownPriceCents().has(OFFERS.UWIQ_DELIVERABLES.priceMinCents));
});
