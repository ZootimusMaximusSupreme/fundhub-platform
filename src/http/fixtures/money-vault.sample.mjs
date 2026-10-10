// One sample person for the funding-papers screen (/app/money-vault.html,
// Capital Blueprint unit B3): the FinanceOS test client "Test Test"
// (f1cb9c27-…) and its business container "Fundhub LLC" (386c687a-…) — the same
// pair docs/finance/document-vault.md reads. One person, one set of files, one
// story (.claude/rules/sample-clients-consistent.md).
//
// EVERY VIEW IS BUILT BY THE REAL VAULT ENGINE (buildVault + shapeVault in
// src/finance/document-vault.mjs), never typed by hand, so the screen test and the
// proof shots read exactly what GET /api/money/vault answers for these files.
//
// The story, as of Oct 7, 2026 (the doc's example date):
//   ID                      sent Sep 28, the document reader accepted it
//   proof of address        sent Sep 28, a person accepted it
//   personal tax returns    one year of two accepted — one more to send
//   business statements     Jul accepted, Aug rejected ("Page 2 is missing"),
//                           Sep sent and waiting — the doc's own illustration
//   business tax returns    nothing sent
//   Articles                accepted
//   EIN letter              sent last night, waiting for review
//   good standing           issued Jul 30, accepted Aug 3, now too old (60 days)
//   one unlabelled scan     sent with no paper type, so it waits to be sorted

import { buildVault, shapeVault } from "../../finance/document-vault.mjs";
import { SUBTYPE_TITLES } from "../../documents/kinds.mjs";

export const NOW = new Date("2026-10-07T12:00:00.000Z");
export const ORG_ID = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
export const CLIENT = Object.freeze({ id: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e", name: "Test Test" });
export const BUSINESS = Object.freeze({ kind: "business", id: "386c687a-167d-4d44-a000-8d50b5a80191", name: "Fundhub LLC" });
export const STAFF_NAME = "Sam Staff";

const docId = (n) => `0d0c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One registry row, the way POST /api/documents-upload stores it. */
export function sampleDoc(n, subtype, filename, generatedAt, { business = false } = {}) {
  return {
    id: docId(n),
    kind: "client_upload",
    subtype,
    title: SUBTYPE_TITLES[subtype] || "Uploaded Document",
    generated_at: generatedAt,
    expires_at: null,
    metadata: {
      original_filename: filename,
      label: { given: subtype, filed_as: subtype, source: "given" },
      ...(business ? { entity_id: BUSINESS.id } : {})
    }
  };
}

/** One document_vault_reviews row (a person's accept or reject). */
export function sampleReview(doc, over = {}) {
  return {
    document_id: doc.id, status: "accepted", item_key: null, entity_id: null, covers: 1,
    period_end: null, reason: null, reviewed_at: "2026-10-02T09:00:00.000Z",
    reviewed_by_name: STAFF_NAME, ...over
  };
}

function fullFacts() {
  const id = sampleDoc(1, "id_document", "drivers-license.jpg", "2026-09-28T16:05:00.000Z");
  const address = sampleDoc(2, "proof_of_address", "aps-bill-september.pdf", "2026-09-28T16:07:00.000Z");
  const ret2025 = sampleDoc(3, "tax_return", "2025-tax-return.pdf", "2026-09-30T17:10:00.000Z");
  const jul = sampleDoc(4, "business_bank_statement", "fundhub-llc-jul.pdf", "2026-10-01T15:00:00.000Z", { business: true });
  const aug = sampleDoc(5, "business_bank_statement", "fundhub-llc-aug.pdf", "2026-10-01T15:01:00.000Z", { business: true });
  const sep = sampleDoc(6, "business_bank_statement", "fundhub-llc-sep.pdf", "2026-10-05T18:20:00.000Z", { business: true });
  const articles = sampleDoc(7, "articles_of_organization", "fundhub-llc-articles.pdf", "2026-09-30T17:12:00.000Z", { business: true });
  const ein = sampleDoc(8, "ein_letter", "cp575-ein-letter.pdf", "2026-10-06T21:40:00.000Z", { business: true });
  const standing = sampleDoc(9, "certificate_good_standing", "good-standing-july.pdf", "2026-08-01T15:30:00.000Z", { business: true });
  const scan = sampleDoc(10, "other", "scan-0412.pdf", "2026-10-06T19:02:00.000Z");
  const reviews = [
    sampleReview(address, { reviewed_at: "2026-09-29T15:00:00.000Z" }),
    sampleReview(ret2025, { reviewed_at: "2026-10-01T16:00:00.000Z" }),
    sampleReview(jul, { period_end: "2026-07-31" }),
    sampleReview(aug, { status: "rejected", covers: null, reason: "Page 2 is missing" }),
    sampleReview(articles, { reviewed_at: "2026-10-01T16:05:00.000Z" }),
    sampleReview(standing, { period_end: "2026-07-30", reviewed_at: "2026-08-03T16:00:00.000Z" })
  ];
  return {
    documents: [id, address, ret2025, jul, aug, sep, articles, ein, standing, scan],
    reviews,
    docCheckDocIds: [id.id]
  };
}

function completeFacts() {
  const docs = [
    sampleDoc(1, "id_document", "drivers-license.jpg", "2026-09-28T16:05:00.000Z"),
    sampleDoc(2, "proof_of_address", "aps-bill-september.pdf", "2026-09-28T16:07:00.000Z"),
    sampleDoc(3, "tax_return", "2025-tax-return.pdf", "2026-09-30T17:10:00.000Z"),
    sampleDoc(11, "tax_return", "2024-tax-return.pdf", "2026-10-03T14:00:00.000Z"),
    sampleDoc(4, "business_bank_statement", "fundhub-llc-jul.pdf", "2026-10-01T15:00:00.000Z", { business: true }),
    sampleDoc(12, "business_bank_statement", "fundhub-llc-aug-full.pdf", "2026-10-03T14:05:00.000Z", { business: true }),
    sampleDoc(6, "business_bank_statement", "fundhub-llc-sep.pdf", "2026-10-05T18:20:00.000Z", { business: true }),
    sampleDoc(13, "business_tax_return", "fundhub-llc-2025-return.pdf", "2026-10-03T14:10:00.000Z", { business: true }),
    sampleDoc(14, "business_tax_return", "fundhub-llc-2024-return.pdf", "2026-10-03T14:11:00.000Z", { business: true }),
    sampleDoc(7, "articles_of_organization", "fundhub-llc-articles.pdf", "2026-09-30T17:12:00.000Z", { business: true }),
    sampleDoc(8, "ein_letter", "cp575-ein-letter.pdf", "2026-10-06T21:40:00.000Z", { business: true }),
    sampleDoc(15, "certificate_good_standing", "good-standing-october.pdf", "2026-10-06T22:00:00.000Z", { business: true })
  ];
  const ends = { [docId(4)]: "2026-07-31", [docId(12)]: "2026-08-31", [docId(6)]: "2026-09-30", [docId(15)]: "2026-10-05" };
  const reviews = docs.filter((d) => d.subtype !== "id_document").map((d) =>
    sampleReview(d, { period_end: ends[d.id] || null, reviewed_at: "2026-10-07T10:00:00.000Z" }));
  return { documents: docs, reviews, docCheckDocIds: [docId(1)] };
}

/**
 * sampleVault — the GET /api/money/vault answer for the sample person.
 *
 *   variant    "full" (the story above) | "complete" (every paper accepted) |
 *              "empty" (nothing sent yet)
 *   audience   "client" | "staff" — exactly the server's two shapes
 *   extra      { documents, reviews, customItems } added on top (the proof's
 *              fake server uses this to show an upload or a decision land)
 *   sign       passed to shapeVault so documents carry a "View" link
 *
 * Returns the JSON a browser receives (round-tripped, so `undefined` keys are gone).
 */
export function sampleVault({ variant = "full", audience = "client", extra = {}, sign = null, now = NOW } = {}) {
  const base = variant === "complete" ? completeFacts() : variant === "empty"
    ? { documents: [], reviews: [], docCheckDocIds: [] }
    : fullFacts();
  const documents = [...base.documents, ...(extra.documents || [])];
  const reviewRows = [...base.reviews, ...(extra.reviews || [])];
  const core = buildVault({
    scopes: [BUSINESS],
    customItems: extra.customItems || [],
    waivers: [],
    documents,
    reviews: new Map(reviewRows.map((r) => [String(r.document_id), r])),
    docCheckDocIds: new Set(base.docCheckDocIds),
    now,
    env: {}
  });
  return JSON.parse(JSON.stringify(shapeVault({ client: CLIENT, core, audience, now, env: {}, sign })));
}
