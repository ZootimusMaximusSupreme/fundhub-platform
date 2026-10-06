// src/ads/ad-number-cases.mjs — one table of cases for the ad number rule.
//
// Read by BOTH src/ads/ad-number.test.mjs (the JS mirror, no database) and
// src/http/ad-number.pg.test.mjs (the real SQL in 407, against Postgres), so
// the two are held to the same answers. A case marked `jsOnly: true` needs a
// fixture the database test does not build (a second company, or one Meta ad
// copied in through two connections) and runs in the JS test only.
//
// The four SLO rows are the real live ones (ops/workflows/ad-scripts-2026-10-02/
// w4-findings.md): ad set 120253626444640264, names "oVid: SLO1"–"oVid: SLO4",
// numbers 84, 90, 89, 86. The other ids are made up and start with 9.

export const ORG_A = "00000000-0000-4000-8000-0000000000aa";
export const ORG_B = "00000000-0000-4000-8000-0000000000bb";

export const SLO_SET = "120253626444640264";
export const AUGUST_SET = "120252674467310264";
export const DUP_SET = "900000000000000001";
export const MIRROR_SET = "900000000000000002";
export const OTHER_ORG_SET = "900000000000000003";

/* Our ad rows, flattened to the shape metaAdNumberOf reads. */
export const ADS = Object.freeze([
  { org_id: ORG_A, adset_external_id: SLO_SET, external_id: "120253626444660264", name: "oVid: SLO1", fundhub_ad_number: "84" },
  { org_id: ORG_A, adset_external_id: SLO_SET, external_id: "120253626574340264", name: "oVid: SLO2", fundhub_ad_number: "90" },
  { org_id: ORG_A, adset_external_id: SLO_SET, external_id: "120253626579160264", name: "oVid: SLO3", fundhub_ad_number: "89" },
  { org_id: ORG_A, adset_external_id: SLO_SET, external_id: "120253626580720264", name: "oVid: SLO4", fundhub_ad_number: "86" },
  // An August ad: in our table, never given a Fundhub number.
  { org_id: ORG_A, adset_external_id: AUGUST_SET, external_id: "120252674467320264", name: "oVid: 1", fundhub_ad_number: null },
  // Two DIFFERENT Meta ads with one name in one ad set. Only one has a number.
  { org_id: ORG_A, adset_external_id: DUP_SET, external_id: "900000000000000011", name: "Dup ad", fundhub_ad_number: "91" },
  { org_id: ORG_A, adset_external_id: DUP_SET, external_id: "900000000000000012", name: "Dup ad", fundhub_ad_number: null },
  // ONE Meta ad copied in twice (two connections); only one copy numbered.
  { org_id: ORG_A, adset_external_id: MIRROR_SET, external_id: "900000000000000021", name: "Mirror ad", fundhub_ad_number: "92" },
  { org_id: ORG_A, adset_external_id: MIRROR_SET, external_id: "900000000000000021", name: "Mirror ad", fundhub_ad_number: null },
  // Another company's ad.
  { org_id: ORG_B, adset_external_id: OTHER_ORG_SET, external_id: "900000000000000031", name: "Other org ad", fundhub_ad_number: "93" }
]);

/* [what it proves, { utm_content, utm_term }, expected ad number, options] */
export const CASES = Object.freeze([
  ["match: the live SLO2 tags resolve to 90", { utm_content: "oVid: SLO2", utm_term: SLO_SET }, "90"],
  ["match: SLO1 resolves to 84", { utm_content: "oVid: SLO1", utm_term: SLO_SET }, "84"],
  ["match: SLO4 resolves to 86, not to its Meta name order", { utm_content: "oVid: SLO4", utm_term: SLO_SET }, "86"],
  ["match: spaces around the tags are trimmed", { utm_content: "  oVid: SLO3  ", utm_term: ` ${SLO_SET} ` }, "89"],
  ["no match: case counts, Meta sends its exact name", { utm_content: "ovid: slo2", utm_term: SLO_SET }, null],
  ["no match: a name nobody has stays NULL", { utm_content: "oVid: SLO9", utm_term: SLO_SET }, null],
  ["no match: the right name in the wrong ad set stays NULL", { utm_content: "oVid: SLO2", utm_term: AUGUST_SET }, null],
  ["no match: an ad set nobody has stays NULL", { utm_content: "oVid: SLO2", utm_term: "999999999999999999" }, null],
  ["no number: an ad we have but never numbered stays NULL", { utm_content: "oVid: 1", utm_term: AUGUST_SET }, null],
  ["ambiguous: two Meta ads share the name — NULL even though one has a number", { utm_content: "Dup ad", utm_term: DUP_SET }, null],
  ["no match: a variant in utm_term is not an ad set id", { utm_content: "oVid: SLO2", utm_term: "sun" }, null],
  ["no match: a blank name", { utm_content: "   ", utm_term: SLO_SET }, null],
  ["no match: no name at all", { utm_content: null, utm_term: SLO_SET }, null],
  ["no match: no ad set id at all", { utm_content: "oVid: SLO2", utm_term: null }, null],
  ["no guess: a URL-encoded name is not decoded", { utm_content: "oVid%3A+SLO2", utm_term: SLO_SET }, null],
  ["leading digits still win: 84-slo-ad-1 is 84 with no lookup", { utm_content: "84-slo-ad-1", utm_term: SLO_SET }, "84"],
  ["leading digits still win: 43 is 43 whatever utm_term says", { utm_content: "43", utm_term: "sun" }, "43"],
  ["one Meta ad copied in twice still resolves to its one number", { utm_content: "Mirror ad", utm_term: MIRROR_SET }, "92", { jsOnly: true }],
  ["another company's ad never matches", { utm_content: "Other org ad", utm_term: OTHER_ORG_SET }, null, { jsOnly: true }]
]);
