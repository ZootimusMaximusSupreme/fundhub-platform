// The application document vault — the pure engine (status per line, expiry,
// per-business scopes, "file complete") and the staff decisions, against a stub db.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildVault, buildScopes, buildSlots, vaultLine, vaultComplete, readVault, shapeVault,
  loadVaultFacts, docCheckDocumentIds, decideDocument, addCustomItem, retireItem, waiveItem, unwaiveItem,
  addMonthsIso, addDaysIso, validThrough, isoDay, readPeriodEnd, VaultError, ITEM_STATUS
} from "./document-vault.mjs";
import { SUBTYPE_TITLES } from "../documents/kinds.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const BIZ_A = "11111111-1111-4111-8111-111111111111";
const BIZ_B = "22222222-2222-4222-8222-222222222222";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-07T12:00:00Z");

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const doc = (subtype, over = {}) => ({
  id: uuid(), kind: "client_upload", subtype, title: SUBTYPE_TITLES[subtype] || "Uploaded Document",
  generated_at: "2026-10-01T10:00:00Z", expires_at: null, metadata: {}, ...over
});
const review = (d, over = {}) => ({
  document_id: d.id, status: "accepted", item_key: null, entity_id: null, covers: 1,
  period_end: null, reason: null, reviewed_at: "2026-10-02T10:00:00Z", reviewed_by_name: "Sam Staff", ...over
});
const reviews = (...rs) => new Map(rs.map((r) => [String(r.document_id), r]));
const biz = (id, name) => ({ kind: "business", id, name });
const vault = (o = {}) => buildVault({ env: {}, now: NOW, ...o });
const line = (v, key, scopeId = null) =>
  v.items.find((i) => i.key === key && (scopeId === null || i.scope.id === scopeId));

describe("what a client owes", () => {
  test("no business: three personal lines, all missing, file not complete", () => {
    const v = vault();
    assert.deepEqual(v.items.map((i) => i.key), ["id_document", "proof_of_address", "tax_returns_personal"]);
    assert.ok(v.items.every((i) => i.status === ITEM_STATUS.MISSING && i.waiting_on === "client"));
    assert.equal(v.complete, false);
    assert.equal(v.summary.required, 3);
    assert.equal(v.missing.length, 3);
  });

  test("every business container gets its own copy of the five business lines", () => {
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC"), biz(BIZ_B, "Beta Inc")] });
    assert.equal(v.items.length, 3 + 5 * 2);
    assert.equal(v.items.filter((i) => i.key === "bank_statements_business").length, 2);
    assert.equal(line(v, "ein_letter", BIZ_B).label, "EIN confirmation letter — Beta Inc");
    assert.equal(line(v, "ein_letter", BIZ_B).slot, `ein_letter:${BIZ_B}`);
    assert.equal(line(v, "id_document").slot, "id_document:client");
    assert.equal(line(v, "id_document").label, "Government photo ID");
  });

  test("a business row with no container gets ONE set, so a file with a business cannot read complete without business papers", () => {
    const scopes = buildScopes({ containers: [], hasBusinessRow: true, businessRowName: "Solo LLC" });
    assert.deepEqual(scopes, [{ kind: "business", id: null, name: "Solo LLC" }]);
    const v = vault({ scopes });
    assert.equal(v.items.filter((i) => i.scope.kind === "business").length, 5);
    assert.equal(line(v, "tax_returns_business").slot, "tax_returns_business:business");
    assert.deepEqual(buildScopes({ containers: [], hasBusinessRow: false }), []);
    assert.equal(buildScopes({ containers: [{ id: "not-a-uuid", name: "x" }] }).length, 0);
  });

  test("lines are in the order a client is asked: identity first, business papers after", () => {
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")] });
    assert.deepEqual(v.items.map((i) => i.key), [
      "id_document", "proof_of_address", "tax_returns_personal", "bank_statements_business",
      "tax_returns_business", "articles_of_organization", "ein_letter", "certificate_good_standing"
    ]);
  });
});

describe("the file type decides the line, never the file name", () => {
  test("measured on the Blueprint sim client: six mailing proofs (one named proof-of-address) fill nothing and are not listed as stray", () => {
    const docs = [
      ...["mailing-proof.png", "mail-receipt.png", "proof-of-address-1.png", "mailing-proof-retry.png"].map((fn) =>
        doc("dispute_mail_receipt", { metadata: { original_filename: fn } })),
      doc("credit_analysis_report", { kind: "deliverable" }),
      doc("funding_snapshot", { kind: "deliverable" })
    ];
    const v = vault({ documents: docs });
    assert.ok(v.items.every((i) => i.status === ITEM_STATUS.MISSING));
    assert.equal(line(v, "proof_of_address").documents.length, 0, "a file NAMED proof-of-address is not proof of address");
    assert.deepEqual(v.unfiled, []);
    assert.equal(v.complete, false);
  });

  test("an upload with no label is listed as unfiled until a person files it under a line", () => {
    const stray = doc("other", { metadata: { original_filename: "scan.pdf" } });
    const v = vault({ documents: [stray] });
    assert.deepEqual(v.unfiled.map((u) => [u.id, u.reason, u.filename]), [[stray.id, "no_label", "scan.pdf"]]);
    const filed = vault({
      documents: [stray],
      reviews: reviews(review(stray, { item_key: "id_document" }))
    });
    assert.deepEqual(filed.unfiled, []);
    assert.equal(line(filed, "id_document").status, ITEM_STATUS.ACCEPTED);
    assert.equal(line(filed, "id_document").documents[0].accepted_by, "staff");
  });

  test("a paper the vault has no line for (pay stubs) is neither counted nor listed as stray", () => {
    const v = vault({ documents: [doc("proof_of_income")] });
    assert.deepEqual(v.unfiled, []);
    assert.ok(v.items.every((i) => i.documents.length === 0));
  });

  test("documents of other kinds (deliverables, contracts) are never read", () => {
    const v = vault({ documents: [doc("id_document", { kind: "deliverable" })] });
    assert.equal(line(v, "id_document").status, ITEM_STATUS.MISSING);
  });

  test("the inquiry door's ID counts, the way the identity packet counts it", () => {
    const d = doc("id_document", { kind: "inquiry_doc" });
    const v = vault({ documents: [d], reviews: reviews(review(d)) });
    assert.equal(line(v, "id_document").status, ITEM_STATUS.ACCEPTED);
  });
});

describe("status of a line", () => {
  test("uploaded and not yet decided = uploaded, and it is waiting on us, not the client", () => {
    const d = doc("id_document");
    const l = line(vault({ documents: [d] }), "id_document");
    assert.equal(l.status, ITEM_STATUS.UPLOADED);
    assert.equal(l.waiting_on, "staff");
    assert.equal(l.documents[0].status, ITEM_STATUS.UPLOADED);
    assert.equal(l.detail, "sent, waiting for review");
  });

  test("accepted by a person = accepted", () => {
    const d = doc("id_document");
    const l = line(vault({ documents: [d], reviews: reviews(review(d)) }), "id_document");
    assert.equal(l.status, ITEM_STATUS.ACCEPTED);
    assert.equal(l.waiting_on, null);
    assert.equal(l.documents[0].reviewed_by, "Sam Staff");
  });

  test("rejected with nothing else on file = rejected, with the reason the client reads", () => {
    const d = doc("id_document");
    const l = line(vault({ documents: [d], reviews: reviews(review(d, { status: "rejected", reason: "Photo is cut off" })) }), "id_document");
    assert.equal(l.status, ITEM_STATUS.REJECTED);
    assert.equal(l.waiting_on, "client");
    assert.equal(l.documents[0].reason, "Photo is cut off");
  });

  test("a rejected file next to an accepted one does not undo the accept", () => {
    const bad = doc("id_document");
    const good = doc("id_document", { generated_at: "2026-10-03T10:00:00Z" });
    const l = line(vault({
      documents: [bad, good],
      reviews: reviews(review(bad, { status: "rejected", reason: "blurry" }), review(good))
    }), "id_document");
    assert.equal(l.status, ITEM_STATUS.ACCEPTED);
  });

  test("a bank statement counts as proof of address once accepted, and not before", () => {
    const d = doc("bank_statement");
    assert.equal(line(vault({ documents: [d] }), "proof_of_address").status, ITEM_STATUS.UPLOADED);
    assert.equal(line(vault({ documents: [d], reviews: reviews(review(d)) }), "proof_of_address").status, ITEM_STATUS.ACCEPTED);
  });

  test("the document reader's accept counts for the ID and address lines only", () => {
    const idDoc = doc("id_document");
    const addr = doc("proof_of_address");
    const stmt = doc("business_bank_statement", { metadata: { entity_id: BIZ_A } });
    const v = vault({
      scopes: [biz(BIZ_A, "Alpha LLC")],
      documents: [idDoc, addr, stmt],
      docCheckDocIds: new Set([idDoc.id, addr.id, stmt.id])
    });
    assert.equal(line(v, "id_document").status, ITEM_STATUS.ACCEPTED);
    assert.equal(line(v, "id_document").documents[0].accepted_by, "doc-check");
    assert.equal(line(v, "proof_of_address").status, ITEM_STATUS.ACCEPTED);
    assert.equal(line(v, "bank_statements_business").status, ITEM_STATUS.UPLOADED, "the reader never judges a statement");
  });

  test("a person's reject beats the reader's accept", () => {
    const idDoc = doc("id_document");
    const v = vault({
      documents: [idDoc],
      docCheckDocIds: new Set([idDoc.id]),
      reviews: reviews(review(idDoc, { status: "rejected", reason: "expired license" }))
    });
    assert.equal(line(v, "id_document").status, ITEM_STATUS.REJECTED);
  });

  test("docCheckDocumentIds reads the documents the reader recorded as proof", () => {
    const a = uuid();
    const b = uuid();
    const ids = docCheckDocumentIds({
      legal_name: { document_id: a, agent: "DOC-CHECK" },
      address: { document_id: b },
      date_of_birth: { document_id: a },
      junk: { document_id: "not-a-uuid" },
      nothing: null
    });
    assert.deepEqual([...ids].sort(), [a, b].sort());
    assert.equal(docCheckDocumentIds(null).size, 0);
  });
});

describe("counting months and years", () => {
  const scopes = [biz(BIZ_A, "Alpha LLC")];
  const stmt = (over = {}) => doc("business_bank_statement", { metadata: { entity_id: BIZ_A }, ...over });

  test("three months of statements need three: two accepted is still missing, with the count", () => {
    const [a, b] = [stmt(), stmt()];
    const l = line(vault({ scopes, documents: [a, b], reviews: reviews(review(a), review(b)) }), "bank_statements_business");
    assert.equal(l.status, ITEM_STATUS.MISSING);
    assert.equal([l.have, l.need].join("/"), "2/3");
    assert.equal(l.detail, "2 of 3 accepted");
  });

  test("three accepted files complete the line", () => {
    const ds = [stmt(), stmt(), stmt()];
    const l = line(vault({ scopes, documents: ds, reviews: reviews(...ds.map((d) => review(d))) }), "bank_statements_business");
    assert.equal(l.status, ITEM_STATUS.ACCEPTED);
  });

  test("one PDF that holds three months counts three when staff say so (covers)", () => {
    const d = stmt();
    const l = line(vault({ scopes, documents: [d], reviews: reviews(review(d, { covers: 3 })) }), "bank_statements_business");
    assert.equal(l.status, ITEM_STATUS.ACCEPTED);
    assert.equal(l.documents[0].covers, 3);
  });

  test("two accepted and one waiting for review reads uploaded: the next move is ours", () => {
    const [a, b, c] = [stmt(), stmt(), stmt()];
    const l = line(vault({ scopes, documents: [a, b, c], reviews: reviews(review(a), review(b)) }), "bank_statements_business");
    assert.equal(l.status, ITEM_STATUS.UPLOADED);
  });

  test("two years of personal returns need two files", () => {
    const [a, b] = [doc("tax_return"), doc("tax_return")];
    assert.equal(line(vault({ documents: [a], reviews: reviews(review(a)) }), "tax_returns_personal").status, ITEM_STATUS.MISSING);
    assert.equal(line(vault({ documents: [a, b], reviews: reviews(review(a), review(b)) }), "tax_returns_personal").status, ITEM_STATUS.ACCEPTED);
  });
});

describe("expiry", () => {
  const scopes = [biz(BIZ_A, "Alpha LLC")];
  const stmt = (over = {}) => doc("business_bank_statement", { metadata: { entity_id: BIZ_A }, ...over });
  const accepted = (d, over = {}) => reviews(review(d, { covers: 3, ...over }));

  test("a statement stays good for three months from its end date, through that last day", () => {
    const d = stmt();
    const ok = line(vault({ scopes, documents: [d], reviews: accepted(d, { period_end: "2026-07-07" }) }), "bank_statements_business");
    assert.equal(ok.status, ITEM_STATUS.ACCEPTED);
    assert.equal(ok.documents[0].valid_through, "2026-10-07");
    assert.equal(ok.documents[0].expired, false);
    const old = line(vault({ scopes, documents: [d], reviews: accepted(d, { period_end: "2026-07-06" }) }), "bank_statements_business");
    assert.equal(old.status, ITEM_STATUS.EXPIRED);
    assert.equal(old.documents[0].expired, true);
    assert.equal(old.documents[0].valid_through, "2026-10-06");
    assert.equal(old.waiting_on, "client");
    assert.equal(old.detail, "out of date, needs a new copy");
  });

  test("a rejected file has no 'good until' date: it counts toward nothing", () => {
    const d = stmt();
    const l = line(vault({ scopes, documents: [d], reviews: reviews(review(d, { status: "rejected", reason: "blurry" })) }), "bank_statements_business");
    assert.equal(l.documents[0].valid_through, null);
    const pending = line(vault({ scopes, documents: [stmt()] }), "bank_statements_business");
    assert.ok(pending.documents[0].valid_through, "a file waiting for review shows when it would age out");
  });

  test("with no end date typed, the clock starts the day the file was uploaded", () => {
    const d = stmt({ generated_at: "2026-06-01T09:00:00Z" });
    const l = line(vault({ scopes, documents: [d], reviews: accepted(d) }), "bank_statements_business");
    assert.equal(l.status, ITEM_STATUS.EXPIRED);
    assert.equal(l.documents[0].valid_through, "2026-09-01");
  });

  test("the owner's days override replaces the three months", () => {
    const d = stmt();
    const r = accepted(d, { period_end: "2026-09-20" });
    assert.equal(line(vault({ scopes, documents: [d], reviews: r }), "bank_statements_business").status, ITEM_STATUS.ACCEPTED);
    const tight = line(vault({
      scopes, documents: [d], reviews: r, env: { DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS: "10" }
    }), "bank_statements_business");
    assert.equal(tight.status, ITEM_STATUS.EXPIRED);
    assert.equal(tight.documents[0].valid_through, "2026-09-30");
  });

  test("a certificate of good standing is good for 60 days from the date it was issued", () => {
    const d = doc("certificate_good_standing", { metadata: { entity_id: BIZ_A } });
    const fresh = line(vault({ scopes, documents: [d], reviews: reviews(review(d, { period_end: "2026-08-08" })) }), "certificate_good_standing");
    assert.equal(fresh.status, ITEM_STATUS.ACCEPTED);
    assert.equal(fresh.documents[0].valid_through, "2026-10-07");
    const stale = line(vault({ scopes, documents: [d], reviews: reviews(review(d, { period_end: "2026-08-07" })) }), "certificate_good_standing");
    assert.equal(stale.status, ITEM_STATUS.EXPIRED);
  });

  test("things with no sourced age limit never expire: ID, address, returns, articles, EIN letter", () => {
    const old = { generated_at: "2020-01-01T00:00:00Z" };
    const ds = [doc("id_document", old), doc("proof_of_address", old), doc("tax_return", old), doc("tax_return", old),
      doc("articles_of_organization", { ...old, metadata: { entity_id: BIZ_A } }),
      doc("ein_letter", { ...old, metadata: { entity_id: BIZ_A } })];
    const v = vault({ scopes, documents: ds, reviews: reviews(...ds.map((d) => review(d))) });
    for (const key of ["id_document", "proof_of_address", "tax_returns_personal", "articles_of_organization", "ein_letter"]) {
      assert.equal(line(v, key).status, ITEM_STATUS.ACCEPTED, key);
    }
  });

  test("a registry document marked expired by its own date is expired too", () => {
    const d = doc("id_document", { expires_at: "2026-10-01T00:00:00Z" });
    const l = line(vault({ documents: [d], reviews: reviews(review(d)) }), "id_document");
    assert.equal(l.status, ITEM_STATUS.EXPIRED);
  });

  test("date helpers keep the day of the month, or the last day when the month is shorter", () => {
    assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonthsIso("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonthsIso("2026-11-30", 3), "2027-02-28");
    assert.equal(addMonthsIso("2026-10-07", 3), "2027-01-07");
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addMonthsIso("nope", 1), null);
    assert.equal(validThrough("2026-07-07", { kind: "months", value: 3 }), "2026-10-07");
    assert.equal(validThrough("2026-08-08", { kind: "days", value: 60 }), "2026-10-07");
    assert.equal(validThrough("2026-08-08", null), null);
    assert.equal(isoDay("2026-10-07T23:59:59Z"), "2026-10-07");
    assert.equal(isoDay(null), null);
  });
});

describe("per business", () => {
  const scopes = [biz(BIZ_A, "Alpha LLC"), biz(BIZ_B, "Beta Inc")];

  test("a paper that names its business counts for that business only", () => {
    const d = doc("articles_of_organization", { metadata: { entity_id: BIZ_B } });
    const v = vault({ scopes, documents: [d], reviews: reviews(review(d)) });
    assert.equal(line(v, "articles_of_organization", BIZ_B).status, ITEM_STATUS.ACCEPTED);
    assert.equal(line(v, "articles_of_organization", BIZ_A).status, ITEM_STATUS.MISSING);
  });

  test("with two businesses a business paper that does not say which is unfiled, so nobody guesses", () => {
    const d = doc("ein_letter");
    const v = vault({ scopes, documents: [d] });
    assert.deepEqual(v.unfiled.map((u) => u.reason), ["choose_business"]);
    assert.equal(line(v, "ein_letter", BIZ_A).documents.length, 0);
  });

  test("with ONE business an unlabelled business paper is that business's", () => {
    const d = doc("ein_letter");
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")], documents: [d], reviews: reviews(review(d)) });
    assert.equal(line(v, "ein_letter").status, ITEM_STATUS.ACCEPTED);
    assert.deepEqual(v.unfiled, []);
  });

  test("a person can file a business paper under a business (entity_id on the decision)", () => {
    const d = doc("ein_letter");
    const v = vault({ scopes, documents: [d], reviews: reviews(review(d, { entity_id: BIZ_A })) });
    assert.equal(line(v, "ein_letter", BIZ_A).status, ITEM_STATUS.ACCEPTED);
    assert.equal(line(v, "ein_letter", BIZ_B).status, ITEM_STATUS.MISSING);
    assert.deepEqual(v.unfiled, []);
  });

  test("a business paper before any business exists is reported, not dropped", () => {
    const v = vault({ documents: [doc("business_bank_statement")] });
    assert.deepEqual(v.unfiled.map((u) => u.reason), ["no_business"]);
  });

  test("a paper for a business that is no longer a container is reported as unknown", () => {
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")], documents: [doc("ein_letter", { metadata: { entity_id: BIZ_B } })] });
    assert.deepEqual(v.unfiled.map((u) => u.reason), ["unknown_business"]);
  });

  test("a personal paper never counts toward a business, and a business paper never toward a person", () => {
    const personal = doc("tax_return", { metadata: { entity_id: BIZ_A } });
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")], documents: [personal], reviews: reviews(review(personal)) });
    assert.equal(line(v, "tax_returns_personal").status, ITEM_STATUS.MISSING);
    assert.equal(line(v, "tax_returns_business").status, ITEM_STATUS.MISSING);
    assert.deepEqual(v.unfiled.map((u) => u.reason), ["no_line"]);
  });
});

describe("staff changes to the list", () => {
  test("a waived line counts as done, and the screen says why", () => {
    const waiver = { item_key: "tax_returns_personal", entity_id: null, note: "Filed no returns yet — new filer", created_at: "2026-10-02T00:00:00Z" };
    const v = vault({ waivers: [waiver] });
    const l = line(v, "tax_returns_personal");
    assert.equal(l.status, ITEM_STATUS.WAIVED);
    assert.equal(l.waived.reason, "Filed no returns yet — new filer");
    assert.equal(v.summary.waived, 1);
    assert.ok(!v.missing.some((m) => m.key === "tax_returns_personal"));
  });

  test("a waiver is per business: switching one off leaves the other", () => {
    const scopes = [biz(BIZ_A, "Alpha LLC"), biz(BIZ_B, "Beta Inc")];
    const v = vault({ scopes, waivers: [{ item_key: "certificate_good_standing", entity_id: BIZ_A, note: "not needed", created_at: null }] });
    assert.equal(line(v, "certificate_good_standing", BIZ_A).status, ITEM_STATUS.WAIVED);
    assert.equal(line(v, "certificate_good_standing", BIZ_B).status, ITEM_STATUS.MISSING);
  });

  test("the file is complete exactly when every line is accepted or waived", () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const rs = reviews(...ds.map((d) => review(d)));
    assert.equal(vault({ documents: ds, reviews: rs }).complete, true);
    const oneShort = vault({ documents: ds.slice(0, 3), reviews: reviews(...ds.slice(0, 3).map((d) => review(d))) });
    assert.equal(oneShort.complete, false);
    assert.deepEqual(oneShort.missing.map((m) => m.key), ["tax_returns_personal"]);
    const waived = vault({
      documents: ds.slice(0, 3), reviews: reviews(...ds.slice(0, 3).map((d) => review(d))),
      waivers: [{ item_key: "tax_returns_personal", entity_id: null, note: "none yet", created_at: null }]
    });
    assert.equal(waived.complete, true);
  });

  test("an unreviewed upload is not complete: the closer must not read it as done", () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const v = vault({ documents: ds });
    assert.equal(v.complete, false);
    assert.equal(v.summary.uploaded, 3);
    assert.ok(v.missing.every((m) => ["uploaded", "missing"].includes(m.status)));
  });

  test("a staff-added line is on the list, files by its subtype, and says staff added it", () => {
    const custom = [{ id: uuid(), item_key: "custom_ab12cd34", entity_id: null, title: "Business license", note: "Needed by the credit union", subtype: "business_license", need: 1 }];
    const missing = vault({ customItems: custom });
    const l = line(missing, "custom_ab12cd34");
    assert.equal(l.status, ITEM_STATUS.MISSING);
    assert.equal(l.custom, true);
    assert.equal(l.ask_text, "your business license");
    assert.equal(l.sources[0].note, "Added by staff for this client.");
    assert.equal(missing.items.length, 4);
    const d = doc("business_license");
    const got = vault({ customItems: custom, documents: [d], reviews: reviews(review(d)) });
    assert.equal(line(got, "custom_ab12cd34").status, ITEM_STATUS.ACCEPTED);
  });

  test("a staff-added line with no subtype is filled only by a person filing a file under it", () => {
    const custom = [{ id: uuid(), item_key: "custom_ffee0011", entity_id: null, title: "Profit and loss statement", note: null, subtype: null, need: 1 }];
    const stray = doc("other");
    const v = vault({ customItems: custom, documents: [stray], reviews: reviews(review(stray, { item_key: "custom_ffee0011" })) });
    assert.equal(line(v, "custom_ffee0011").status, ITEM_STATUS.ACCEPTED);
  });

  test("a staff-added line for a business that was archived drops off the list", () => {
    const custom = [{ id: uuid(), item_key: "custom_aaaa0000", entity_id: BIZ_B, title: "Franchise agreement", note: null, subtype: null, need: 1 }];
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")], customItems: custom });
    assert.ok(!v.items.some((i) => i.key === "custom_aaaa0000"));
  });

  test("buildSlots matches a waiver to its line and business", () => {
    const slots = buildSlots({ scopes: [biz(BIZ_A, "A")], waivers: [{ item_key: "ein_letter", entity_id: BIZ_A, note: "x" }] });
    assert.ok(slots.find((s) => s.key === "ein_letter").waiver);
    assert.equal(slots.find((s) => s.key === "articles_of_organization").waiver, null);
  });
});

describe("the sentence the closer reads", () => {
  test("complete", () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const v = vault({ documents: ds, reviews: reviews(...ds.map((d) => review(d))) });
    assert.equal(vaultLine(v), "Document vault: file complete — 3 of 3 items accepted.");
  });

  test("complete with a waived line says so", () => {
    const v = vault({
      documents: [doc("id_document"), doc("proof_of_address")].map((d) => d),
      waivers: [{ item_key: "tax_returns_personal", entity_id: null, note: "none", created_at: null }]
    });
    assert.ok(!v.complete);
    const ds = [doc("id_document"), doc("proof_of_address")];
    const done = vault({
      documents: ds, reviews: reviews(...ds.map((d) => review(d))),
      waivers: [{ item_key: "tax_returns_personal", entity_id: null, note: "none", created_at: null }]
    });
    assert.equal(vaultLine(done), "Document vault: file complete — 3 of 3 items accepted (1 waived by staff).");
  });

  test("incomplete names what is open and where each stands, and caps the list", () => {
    const d = doc("id_document");
    const v = vault({ scopes: [biz(BIZ_A, "Alpha LLC")], documents: [d] });
    const text = vaultLine(v, { max: 3 });
    assert.match(text, /^Document vault: 0 of 8 items done\. Still open: /);
    assert.match(text, /Government photo ID \(sent, waiting for review\)/);
    assert.match(text, /Proof of current address \(not sent\)/);
    assert.match(text, /; and 5 more\.$/);
  });

  test("a vault that could not be read says so; it never says complete", () => {
    assert.match(vaultLine({ complete: null }), /could not be checked/);
    assert.match(vaultLine(null), /could not be checked/);
  });
});

describe("the view a screen reads", () => {
  const scopes = [biz(BIZ_A, "Alpha LLC")];
  const d = doc("business_bank_statement", { metadata: { entity_id: BIZ_A, original_filename: "sept.pdf" } });
  const core = vault({ scopes, documents: [d] });
  const client = { id: CLIENT, name: "Sim Eleven" };
  const sign = { baseUrl: "https://app.example", secret: "s".repeat(40) };

  test("a client sees their lines and uploads, not where the rules came from", () => {
    const v = shapeVault({ client, core, audience: "client", now: NOW, env: {}, sign });
    assert.equal(v.ok, true);
    assert.equal(v.audience, "client");
    assert.equal(v.items[0].sources, undefined);
    const stmt = v.items.find((i) => i.key === "bank_statements_business");
    assert.equal(stmt.expires.kind, "months");
    assert.equal(stmt.expires.from_env, undefined);
    assert.equal(stmt.documents[0].filename, "sept.pdf");
    assert.match(stmt.documents[0].download.url, /^https:\/\/app\.example\/api\/documents\//);
  });

  test("staff also see each line's sources and the env var that moved a window", () => {
    const v = shapeVault({ client, core, audience: "staff", now: NOW, env: {}, sign });
    const stmt = v.items.find((i) => i.key === "bank_statements_business");
    assert.ok(stmt.sources.length >= 3);
    assert.ok(Object.hasOwn(stmt.expires, "from_env"));
  });

  test("a client sees the decision on a file, not which staff member made it", () => {
    const d2 = doc("id_document");
    const c2 = vault({ documents: [d2], reviews: reviews(review(d2)) });
    const asClient = shapeVault({ client, core: c2, audience: "client", now: NOW, env: {} });
    const asStaff = shapeVault({ client, core: c2, audience: "staff", now: NOW, env: {} });
    assert.equal(asClient.items[0].documents[0].status, "accepted");
    assert.equal(asClient.items[0].documents[0].reviewed_by, undefined);
    assert.equal(asStaff.items[0].documents[0].reviewed_by, "Sam Staff");
  });

  test("every line carries the exact fields to send to the existing upload endpoint", () => {
    const v = shapeVault({ client, core, audience: "client", now: NOW, env: {}, sign });
    const byKey = Object.fromEntries(v.items.map((i) => [i.key, i.upload]));
    assert.deepEqual(byKey.id_document, { endpoint: "/api/documents-upload", method: "POST", fields: { kind: "client_upload", subtype: "id_document" } });
    assert.deepEqual(byKey.bank_statements_business.fields, { kind: "client_upload", subtype: "business_bank_statement", entity_id: BIZ_A });
    assert.deepEqual(byKey.tax_returns_personal.fields, { kind: "client_upload", subtype: "tax_return" });
  });

  test("no signing secret means no link, never a broken one", () => {
    const v = shapeVault({ client, core, audience: "client", now: NOW, env: {}, sign: { baseUrl: "https://app.example" } });
    const stmt = v.items.find((i) => i.key === "bank_statements_business");
    assert.equal(stmt.documents[0].download, null);
    const none = shapeVault({ client, core, audience: "client", now: NOW, env: {} });
    assert.equal(none.items[0].documents.length, 0);
  });

  test("the answer carries the settings the screen can say out loud", () => {
    const v = shapeVault({ client, core, audience: "client", now: NOW, env: { DOCUMENT_VAULT_ASK_EVERY_DAYS: "4" }, sign });
    assert.deepEqual(v.settings, { ask_every_days: 4, statement_window_months: 3, statement_max_age_days: null, good_standing_max_age_days: 60 });
    assert.equal(v.complete, false);
    assert.equal(v.summary.required, 8);
    assert.equal(v.as_of, "2026-10-07T12:00:00.000Z");
  });
});

/* ───────────────────────────── database layer, against a stub ───────────────────────────── */

function stubDb(state = {}) {
  const s = {
    client: { id: CLIENT, first_name: "Sim", last_name: "Eleven" },
    containers: [], businesses: [], documents: [], reviews: [], items: [], ident: null, ...state
  };
  const calls = [];
  return {
    calls, state: s,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: s.client && params[0] === s.client.id && params[1] === ORG ? [{ "?column?": 1 }] : [] };
      }
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: s.client && params[0] === s.client.id && params[1] === ORG ? [s.client] : [] };
      }
      if (/SELECT 1 FROM entities/.test(sql)) {
        const ok = s.containers.some((c) => c.id === params[0]);
        return { rows: ok ? [{ "?column?": 1 }] : [] };
      }
      if (/FROM entities/.test(sql)) return { rows: s.containers };
      if (/FROM businesses/.test(sql)) return { rows: s.businesses };
      if (/FROM documents/.test(sql)) return { rows: s.documents };
      if (/FROM document_vault_reviews/.test(sql)) return { rows: s.reviews };
      if (/FROM document_vault_items/.test(sql)) return { rows: s.items };
      if (/FROM pii_identity/.test(sql)) return { rows: s.ident ? [s.ident] : [] };
      if (/INSERT INTO document_vault_reviews/.test(sql)) return { rows: [{ id: "review-1", status: params[3] }] };
      if (/INSERT INTO document_vault_items/.test(sql)) return { rows: /'waiver'/.test(sql) ? [{ id: "waiver-1" }] : [] };
      if (/UPDATE document_vault_items/.test(sql)) return { rows: s.retire === false ? [] : [{ id: params[0] }] };
      return { rows: [] };
    }
  };
}
const writes = (db) => db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

describe("reading from the database", () => {
  test("a client in another org is null, never an empty vault", async () => {
    const db = stubDb({ client: null });
    assert.equal(await loadVaultFacts(db, { orgId: ORG, clientId: CLIENT }), null);
    assert.equal(await vaultComplete(db, { orgId: ORG, clientId: CLIENT }), null);
    assert.equal(await readVault(db, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("vaultComplete is the answer the closer path reads", async () => {
    const d = doc("id_document");
    const db = stubDb({
      containers: [{ id: BIZ_A, name: "Alpha LLC" }],
      documents: [d],
      reviews: [review(d)]
    });
    const r = await vaultComplete(db, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.equal(r.complete, false);
    assert.equal(r.summary.required, 8);
    assert.equal(r.summary.accepted, 1);
    assert.equal(r.missing.length, 7);
    assert.ok(r.missing.every((m) => m.slot && m.label && m.status));
    assert.equal(writes(db).length, 0, "reading writes nothing");
  });

  test("a client's name comes from first and last, and a business row alone makes one business scope", async () => {
    const db = stubDb({ businesses: [{ name: "Solo LLC" }] });
    const facts = await loadVaultFacts(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(facts.client.name, "Sim Eleven");
    assert.deepEqual(facts.scopes, [{ kind: "business", id: null, name: "Solo LLC" }]);
    const two = await loadVaultFacts(stubDb({ businesses: [{ name: "A" }, { name: "B" }] }), { orgId: ORG, clientId: CLIENT });
    assert.deepEqual(two.scopes, [{ kind: "business", id: null, name: null }], "two lone rows: one scope, no guessed name");
  });

  test("the reader's accepts come from pii_identity.verified_field_sources", async () => {
    const d = doc("id_document");
    const db = stubDb({ documents: [d], ident: { verified_field_sources: { legal_name: { document_id: d.id } } } });
    const r = await readVault(db, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} });
    assert.equal(r.items.find((i) => i.key === "id_document").status, ITEM_STATUS.ACCEPTED);
  });

  test("a read with a bad client id is a TypeError, not a query", async () => {
    await assert.rejects(() => loadVaultFacts(stubDb(), { orgId: ORG, clientId: "nope" }), /uuid/);
    await assert.rejects(() => loadVaultFacts(stubDb(), { orgId: null, clientId: CLIENT }), /orgId/);
  });
});

describe("a person's decision on an upload", () => {
  const base = (db, over = {}) => ({ orgId: ORG, clientId: CLIENT, staffId: STAFF, now: NOW, env: {}, ...over });

  test("accept: one upsert with the staff id, the units and the end date", async () => {
    const d = doc("business_bank_statement");
    const db = stubDb({ containers: [{ id: BIZ_A, name: "Alpha LLC" }], documents: [d] });
    const out = await decideDocument(db, base(db, { documentId: d.id, status: "accepted", covers: "3", periodEnd: "2026-09-30" }));
    assert.equal(out.status, "accepted");
    assert.deepEqual(out.lines, [`bank_statements_business:${BIZ_A}`]);
    const w = writes(db);
    assert.equal(w.length, 1);
    assert.match(w[0].sql, /ON CONFLICT \(document_id\) DO UPDATE/);
    assert.deepEqual(w[0].params, [ORG, CLIENT, d.id, "accepted", null, null, 3, "2026-09-30", null, STAFF]);
  });

  test("reject needs a reason, and the reason is stored for the client", async () => {
    const d = doc("id_document");
    const db = stubDb({ documents: [d] });
    await assert.rejects(
      () => decideDocument(db, base(db, { documentId: d.id, status: "rejected" })),
      (e) => e instanceof VaultError && e.code === "invalid_reason"
    );
    assert.equal(writes(db).length, 0);
    await decideDocument(db, base(db, { documentId: d.id, status: "rejected", reason: "  Photo is   cut off " }));
    assert.equal(writes(db)[0].params[8], "Photo is cut off");
    assert.equal(writes(db)[0].params[6], 1, "units reset on a reject");
  });

  test("a file that would count toward no line is refused: accepting a paper that proves nothing is a lie", async () => {
    const stray = doc("other");
    const db = stubDb({ documents: [stray] });
    await assert.rejects(
      () => decideDocument(db, base(db, { documentId: stray.id, status: "accepted" })),
      (e) => e.code === "unfiled" && e.status === 409
    );
    assert.equal(writes(db).length, 0);
    // File it under a line and it goes through.
    const out = await decideDocument(db, base(db, { documentId: stray.id, status: "accepted", itemKey: "id_document" }));
    assert.deepEqual(out.lines, ["id_document:client"]);
    assert.equal(writes(db)[0].params[4], "id_document");
  });

  test("with two businesses, a business paper needs its business named", async () => {
    const d = doc("ein_letter");
    const db = stubDb({ containers: [{ id: BIZ_A, name: "A" }, { id: BIZ_B, name: "B" }], documents: [d] });
    await assert.rejects(
      () => decideDocument(db, base(db, { documentId: d.id, status: "accepted" })),
      (e) => e.code === "unfiled" && /item_key and entity_id/.test(e.message)
    );
    const out = await decideDocument(db, base(db, { documentId: d.id, status: "accepted", entityId: BIZ_B }));
    assert.deepEqual(out.lines, [`ein_letter:${BIZ_B}`]);
  });

  test("a second decision keeps the first one's filing when none is sent", async () => {
    const d = doc("other");
    const db = stubDb({ documents: [d], reviews: [review(d, { item_key: "id_document" })] });
    const out = await decideDocument(db, base(db, { documentId: d.id, status: "rejected", reason: "blurry" }));
    assert.deepEqual(out.lines, ["id_document:client"]);
  });

  test("bad input is refused in plain words before any write", async () => {
    const d = doc("id_document");
    const db = stubDb({ documents: [d] });
    const go = (over) => decideDocument(db, base(db, { documentId: d.id, status: "accepted", ...over }));
    await assert.rejects(() => go({ documentId: "nope" }), (e) => e.code === "invalid_document_id");
    await assert.rejects(() => go({ status: "maybe" }), (e) => e.code === "invalid_status");
    await assert.rejects(() => go({ covers: 0 }), (e) => e.code === "invalid_covers");
    await assert.rejects(() => go({ covers: 25 }), (e) => e.code === "invalid_covers");
    await assert.rejects(() => go({ covers: 1.5 }), (e) => e.code === "invalid_covers");
    await assert.rejects(() => go({ periodEnd: "next week" }), (e) => e.code === "invalid_period_end");
    await assert.rejects(() => go({ periodEnd: "2026-10-08" }), (e) => /future/.test(e.message));
    await assert.rejects(() => go({ itemKey: "Bad Key!" }), (e) => e.code === "invalid_item_key");
    await assert.rejects(() => go({ entityId: "nope" }), (e) => e.code === "invalid_entity_id");
    await assert.rejects(() => go({ entityId: BIZ_A }), (e) => e.code === "unknown_business" && e.status === 404);
    await assert.rejects(() => decideDocument(db, base(db, { documentId: uuid(), status: "accepted" })), (e) => e.code === "document_not_found" && e.status === 404);
    assert.equal(writes(db).length, 0);
  });

  test("readPeriodEnd: blank is none; a real date up to today is kept", () => {
    assert.equal(readPeriodEnd("", { now: NOW }), null);
    assert.equal(readPeriodEnd(undefined, { now: NOW }), null);
    assert.equal(readPeriodEnd("2026-10-07", { now: NOW }), "2026-10-07");
    assert.throws(() => readPeriodEnd("1999-12-31", { now: NOW }), /far back/);
    assert.throws(() => readPeriodEnd("2026-02-30", { now: NOW }), /date like/);
  });
});

describe("lines staff add, take off, waive and put back", () => {
  const base = { orgId: ORG, clientId: CLIENT, staffId: STAFF };

  test("add: a title is required, the key is custom_ plus eight hex, and the row says who", async () => {
    const db = stubDb();
    await assert.rejects(() => addCustomItem(db, { ...base, title: "  " }), (e) => e.code === "invalid_title");
    const out = await addCustomItem(db, { ...base, title: "Business   license", note: "Credit union asks", subtype: "business_license", need: 1 });
    assert.match(out.item_key, /^custom_[0-9a-f]{8}$/);
    const w = writes(db)[0];
    assert.match(w.sql, /INSERT INTO document_vault_items/);
    assert.deepEqual(w.params.slice(2), [CLIENT, null, out.item_key, "Business license", "Credit union asks", "business_license", 1, STAFF]);
  });

  test("add: need, subtype and business are checked", async () => {
    const db = stubDb({ containers: [{ id: BIZ_A, name: "A" }] });
    await assert.rejects(() => addCustomItem(db, { ...base, title: "x", need: 0 }), (e) => e.code === "invalid_need");
    await assert.rejects(() => addCustomItem(db, { ...base, title: "x", subtype: "selfie" }), (e) => e.code === "invalid_subtype");
    await assert.rejects(() => addCustomItem(db, { ...base, title: "x", entityId: "nope" }), (e) => e.code === "invalid_entity_id");
    await assert.rejects(() => addCustomItem(db, { ...base, title: "x", entityId: BIZ_B }), (e) => e.code === "unknown_business");
    assert.equal(writes(db).length, 0);
    const ok = await addCustomItem(db, { ...base, title: "Franchise agreement", entityId: BIZ_A });
    assert.ok(ok.id);
  });

  test("retire: stamps the row, never deletes it; an unknown or already-retired line is 404", async () => {
    const db = stubDb();
    const out = await retireItem(db, { ...base, itemId: uuid() });
    assert.ok(out.id);
    assert.match(writes(db)[0].sql, /SET retired_at = now\(\)/);
    assert.ok(!db.calls.some((c) => /DELETE/i.test(c.sql)));
    const gone = stubDb(); gone.state.retire = false;
    await assert.rejects(() => retireItem(gone, { ...base, itemId: uuid() }), (e) => e.status === 404);
    await assert.rejects(() => retireItem(db, { ...base, itemId: "nope" }), (e) => e.code === "invalid_item_id");
  });

  test("waive: only a standard line, with a reason; a business line names its business unless there is just one", async () => {
    const db = stubDb({ containers: [{ id: BIZ_A, name: "A" }] });
    await assert.rejects(() => waiveItem(db, { ...base, itemKey: "custom_ab12cd34", reason: "x" }), (e) => e.code === "invalid_item_key");
    await assert.rejects(() => waiveItem(db, { ...base, itemKey: "id_document", reason: "" }), (e) => e.code === "invalid_reason");
    await assert.rejects(() => waiveItem(db, { ...base, itemKey: "id_document", entityId: BIZ_A, reason: "x" }), (e) => e.code === "invalid_entity_id");
    const one = await waiveItem(db, { ...base, itemKey: "ein_letter", reason: "Sole proprietor, no EIN" });
    assert.equal(one.created, true);
    assert.deepEqual(writes(db)[0].params, [ORG, CLIENT, BIZ_A, "ein_letter", "Sole proprietor, no EIN", STAFF]);

    const two = stubDb({ containers: [{ id: BIZ_A, name: "A" }, { id: BIZ_B, name: "B" }] });
    await assert.rejects(() => waiveItem(two, { ...base, itemKey: "ein_letter", reason: "x" }), (e) => e.code === "choose_business");
    await assert.rejects(() => waiveItem(two, { ...base, itemKey: "ein_letter", entityId: uuid(), reason: "x" }), (e) => e.code === "unknown_business");
  });

  test("unwaive puts the line back by stamping the waiver, not deleting it", async () => {
    const db = stubDb();
    const out = await unwaiveItem(db, { ...base, itemKey: "tax_returns_personal" });
    assert.ok(out.id);
    assert.match(writes(db)[0].sql, /kind = 'waiver'/);
    await assert.rejects(() => unwaiveItem(db, { ...base, itemKey: "custom_x1" }), (e) => e.code === "invalid_item_key");
  });
});
