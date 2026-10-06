// Flywheel campaigns: folder names from offer keys, the offer line, the words.
// Unit X3, design docs/specs/command-center-design-2026-10-05.md §3.2 row 6.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignForOffer, offerKeyOf, campaignWords, ownerNotesTemplate, notesForStage, noteLine,
  startableOffers, isCampaign, ownerNotesSection
} from "./campaigns.mjs";
import { OFFER_KEYS } from "../../config/offers.mjs";

test("every offer key makes a folder name; the partner program keeps its existing folder", () => {
  assert.equal(campaignForOffer("UWIQ_DELIVERABLES"), "capital-blueprint");
  assert.equal(campaignForOffer("PARTNER_ENTRY"), "partner");
  assert.equal(campaignForOffer("LIVE_TRIAL"), "live-trial", "words after a dash are dropped");
  assert.equal(campaignForOffer("NOPE"), null);
  for (const key of OFFER_KEYS) {
    const c = campaignForOffer(key);
    assert.ok(c && isCampaign(c), `${key} -> ${c}`);
  }
  const names = startableOffers().map((o) => o.campaign);
  assert.equal(new Set(names).size, names.length, "no two offers share a folder");
});

test("the offer comes from the notes' Offer key line, else the known folders, else unknown", () => {
  assert.equal(offerKeyOf("capital-blueprint", "x\nOffer key: UWIQ_DELIVERABLES\n"), "UWIQ_DELIVERABLES");
  assert.equal(offerKeyOf("partner", "# notes with no line"), "PARTNER_ENTRY");
  assert.equal(offerKeyOf("mystery", ""), null);
  assert.equal(offerKeyOf("mystery", "Offer key: NOT_AN_OFFER"), null, "a key that is not an offer is not trusted");
});

test("campaign words: Partner offer, the offer's own name, else the folder in words", () => {
  assert.equal(campaignWords("partner"), "Partner offer");
  assert.equal(campaignWords("capital-blueprint", "Offer key: UWIQ_DELIVERABLES"), "Capital Blueprint");
  assert.equal(campaignWords("summer-push"), "Summer push");
});

test("a new flywheel's owner notes: the offer line, the format, an empty Notes section", () => {
  const t = ownerNotesTemplate({ campaign: "capital-blueprint", offerKey: "UWIQ_DELIVERABLES", today: "2026-10-06" });
  assert.match(t, /^# Owner notes — capital-blueprint flywheel\n/);
  assert.match(t, /\nOffer key: UWIQ_DELIVERABLES\nOffer: Capital Blueprint\n/);
  assert.match(t, /Agents \*\*append one line, never rewrite\*\*/);
  assert.match(t, /\n## Notes\n$/);
  assert.equal(ownerNotesSection(t), "", "no line is written for Chris");
  assert.equal(offerKeyOf("capital-blueprint", t), "UWIQ_DELIVERABLES");
  assert.throws(() => ownerNotesTemplate({ campaign: "x", offerKey: "NOPE", today: "2026-10-06" }), /not an offer/);
  assert.throws(() => ownerNotesTemplate({ campaign: "../x", offerKey: "PARTNER_ENTRY", today: "2026-10-06" }), /folder name/);
});

test("a stage gets its own lines and the 'all' lines, nothing else", () => {
  const notes = [
    "# Owner notes", "", "## Notes", "",
    "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
    "2026-08-31 | all | no compliance checking in this pipeline.",
    "2026-10-06 | stage 4 | lead with the backdoor fear",
    "",
    "## Later",
    "2026-10-06 | stage 4 | not in Notes, not read"
  ].join("\n");
  assert.equal(notesForStage(notes, 4), "2026-08-31 | all | no compliance checking in this pipeline.\n2026-10-06 | stage 4 | lead with the backdoor fear");
  assert.equal(notesForStage(notes, 5), "2026-08-31 | all | no compliance checking in this pipeline.");
  assert.equal(notesForStage(null, 4), "");
});

test("a tweak line is one line in the file's format, with no extra column", () => {
  assert.equal(noteLine({ today: "2026-10-06", stage: 4, note: "  lead with\n the fear | not the price " }),
    "2026-10-06 | stage 4 | lead with the fear / not the price");
});
