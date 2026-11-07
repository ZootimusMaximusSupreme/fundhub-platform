// The lender packet (Finance OS unit I3): which papers go in each packet, what is
// still missing, the one PDF, and the file read that guards org and client.
// The vault answers come from the REAL vault engine through the screen's sample
// person (src/http/fixtures/money-vault.sample.mjs), so these read exactly what
// GET /api/money/vault answers for those files.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import {
  PERSONAL, LONE_BUSINESS, FUNDHUB_PAPERS, LEFT_OUT, PACKET_MAX_BYTES,
  packetKeyOf, isPacketKey, packetsFromVault, findPacket, packetFiles,
  loadFundhubPapers, fileReader, buildPacketPdf, coverLines, coverPageCount, packetFilename
} from "./lender-packet.mjs";
import { createStore, memoryProvider } from "../documents/store.mjs";
import { sampleVault, CLIENT, BUSINESS, ORG_ID, NOW } from "../http/fixtures/money-vault.sample.mjs";

const SNAPSHOT = { id: "dddd0000-0000-4000-8000-000000000001", subtype: "funding_snapshot", title: "Funding Snapshot" };
const ANALYSIS = { id: "dddd0000-0000-4000-8000-000000000002", subtype: "credit_analysis_report", title: "Credit Analysis Report" };
const docId = (n) => `0d0c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function pdfOf(pages) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([612, 792]);
  return Buffer.from(await d.save());
}
const pageCount = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

/** A getFile that serves bytes from a map, the way fileReader answers. */
function serve(files) {
  const reads = [];
  const getFile = async (id) => {
    if (!(id in files)) return { left_out: LEFT_OUT.NOT_FOUND };
    const bytes = files[id];
    return { mime: null, size: bytes ? bytes.length : null, read: async () => { reads.push(id); return bytes; } };
  };
  return { getFile, reads };
}

describe("which packet a vault line belongs to", () => {
  test("personal, a business container's id, or the one unlabelled business", () => {
    assert.equal(packetKeyOf({ kind: "client", id: null }), PERSONAL);
    assert.equal(packetKeyOf(null), PERSONAL);
    assert.equal(packetKeyOf({ kind: "business", id: BUSINESS.id }), BUSINESS.id);
    assert.equal(packetKeyOf({ kind: "business", id: null }), LONE_BUSINESS);
  });

  test("the endpoint takes only those three shapes", () => {
    for (const ok of ["personal", "business", BUSINESS.id, ` ${BUSINESS.id} `]) assert.equal(isPacketKey(ok), true, ok);
    for (const bad of ["", null, undefined, "../etc", "Personal", "1234", `${BUSINESS.id}x`]) assert.equal(isPacketKey(bad), false, String(bad));
  });
});

describe("the packet list, from the real vault engine", () => {
  const full = () => packetsFromVault(sampleVault({ variant: "full" }), { fundhubPapers: [SNAPSHOT] });

  test("one packet for the personal file and one for the business, in that order", () => {
    const ps = full();
    assert.deepEqual(ps.map((p) => [p.key, p.kind, p.name]), [[PERSONAL, "client", null], [BUSINESS.id, "business", BUSINESS.name]]);
  });

  test("personal: ID and address are ready, one of two tax returns goes in, and the line is still missing", () => {
    const p = findPacket(full(), PERSONAL);
    assert.deepEqual(p.papers.map((x) => [x.key, x.status, x.files.map((f) => f.id)]), [
      ["id_document", "ready", [docId(1)]],
      ["proof_of_address", "ready", [docId(2)]],
      ["tax_returns_personal", "missing", [docId(3)]],
      ["funding_letter", "ready", [SNAPSHOT.id]],
      ["credit_summary", "missing", []]
    ]);
    assert.deepEqual(p.counts, { papers: 5, ready: 3, missing: 2, files: 4 });
    assert.equal(p.ready, false);
    assert.deepEqual(p.missing.map((m) => [m.key, m.have, m.need, m.unit]), [["tax_returns_personal", 1, 2, "year"], ["credit_summary", 0, 1, "file"]]);
  });

  test("business: only accepted, current files go in — never a rejected, unchecked or out-of-date one", () => {
    const p = findPacket(full(), BUSINESS.id);
    const by = Object.fromEntries(p.papers.map((x) => [x.key, x]));
    // Statements: Jul accepted (in), Aug rejected (out), Sep waiting (out).
    assert.equal(by.bank_statements_business.status, "waiting");
    assert.deepEqual(by.bank_statements_business.files.map((f) => f.id), [docId(4)]);
    assert.equal(by.articles_of_organization.status, "ready");
    assert.deepEqual(by.articles_of_organization.files.map((f) => f.id), [docId(7)]);
    assert.equal(by.ein_letter.status, "waiting");
    assert.deepEqual(by.ein_letter.files, [], "a letter nobody checked yet stays out");
    assert.equal(by.certificate_good_standing.status, "too_old");
    assert.deepEqual(by.certificate_good_standing.files, [], "an accepted but expired certificate stays out");
    assert.equal(by.tax_returns_business.status, "missing");
    assert.deepEqual(packetFiles(p).map((f) => f.id), [docId(4), docId(7), SNAPSHOT.id]);
    assert.ok(!packetFiles(p).some((f) => [docId(5), docId(6), docId(8), docId(9)].includes(f.id)));
  });

  test("the personal packet never carries a business paper, and the business packet never carries a personal one", () => {
    const [personal, business] = full();
    const keys = (p) => p.papers.filter((x) => x.from === "vault").map((x) => x.key);
    assert.deepEqual(keys(personal), ["id_document", "proof_of_address", "tax_returns_personal"]);
    assert.deepEqual(keys(business), ["bank_statements_business", "tax_returns_business", "articles_of_organization", "ein_letter", "certificate_good_standing"]);
  });

  test("a file every line is done: the packet is ready when both Fundhub papers are on file too", () => {
    const v = sampleVault({ variant: "complete" });
    const without = findPacket(packetsFromVault(v, { fundhubPapers: [] }), PERSONAL);
    assert.equal(without.ready, false);
    assert.deepEqual(without.missing.map((m) => [m.key, m.from, m.detail]), [["funding_letter", "fundhub", "not on file yet"], ["credit_summary", "fundhub", "not on file yet"]]);
    const withBoth = packetsFromVault(v, { fundhubPapers: [SNAPSHOT, ANALYSIS] });
    assert.ok(withBoth.every((p) => p.ready && p.missing.length === 0));
    assert.equal(findPacket(withBoth, BUSINESS.id).counts.files, 3 + 2 + 1 + 1 + 1 + 2);
  });

  test("a waived line counts as done and adds no file", () => {
    const v = sampleVault({ variant: "complete" });
    const it = v.items.find((i) => i.key === "tax_returns_business");
    it.status = "waived";
    it.documents = [];
    const b = findPacket(packetsFromVault(v, { fundhubPapers: [SNAPSHOT, ANALYSIS] }), BUSINESS.id);
    assert.equal(b.papers.find((p) => p.key === "tax_returns_business").status, "not_needed");
    assert.equal(b.ready, true);
  });

  test("one file that counts for two lines goes in once", () => {
    const v = sampleVault({ variant: "full" });
    const address = v.items.find((i) => i.key === "proof_of_address");
    const id = v.items.find((i) => i.key === "id_document");
    address.documents = [...address.documents, ...id.documents];
    const p = findPacket(packetsFromVault(v, { fundhubPapers: [] }), PERSONAL);
    const ids = packetFiles(p).map((f) => f.id);
    assert.equal(ids.filter((x) => x === docId(1)).length, 1);
  });

  test("a vault with no lines has no packets; the newest Fundhub paper of each kind is the one used", () => {
    assert.deepEqual(packetsFromVault({ items: [] }, { fundhubPapers: [SNAPSHOT] }), []);
    const older = { ...SNAPSHOT, id: "dddd0000-0000-4000-8000-000000000009" };
    const p = findPacket(packetsFromVault(sampleVault({ variant: "full" }), { fundhubPapers: [SNAPSHOT, older] }), PERSONAL);
    assert.deepEqual(p.papers.find((x) => x.key === "funding_letter").files.map((f) => f.id), [SNAPSHOT.id]);
  });

  test("the Fundhub papers are the two UnderwriteIQ deliverables, never the bureau letters", () => {
    assert.deepEqual(FUNDHUB_PAPERS.map((p) => p.subtype), ["funding_snapshot", "credit_analysis_report"]);
    assert.ok(!FUNDHUB_PAPERS.some((p) => /funding_inquiry_removal|funding_personal_info/.test(p.subtype)));
  });
});

describe("the one PDF", () => {
  async function personalFiles() {
    const p = findPacket(packetsFromVault(sampleVault({ variant: "full" }), { fundhubPapers: [SNAPSHOT] }), PERSONAL);
    return {
      p,
      files: { [docId(1)]: PNG_1PX, [docId(2)]: await pdfOf(1), [docId(3)]: await pdfOf(2), [SNAPSHOT.id]: await pdfOf(3) }
    };
  }

  test("a cover, then every file in order; the cover gives each file its page", async () => {
    const { p, files } = await personalFiles();
    const { getFile } = serve(files);
    const out = await buildPacketPdf({ packet: p, clientName: CLIENT.name, getFile, now: NOW });
    assert.ok(out.bytes && Buffer.from(out.bytes).subarray(0, 5).toString("latin1") === "%PDF-");
    assert.equal(await pageCount(out.bytes), 1 + 1 + 1 + 2 + 3);
    assert.deepEqual(out.included.map((f) => [f.id, f.pages, f.page]), [
      [docId(1), 1, 2], [docId(2), 1, 3], [docId(3), 2, 4], [SNAPSHOT.id, 3, 6]
    ]);
    assert.deepEqual(out.left_out, []);
  });

  test("past the size limit a file is left out by name — nothing is cut or shrunk", async () => {
    const { p, files } = await personalFiles();
    const { getFile, reads } = serve(files);
    const limit = files[docId(1)].length + files[docId(2)].length + 10;
    const out = await buildPacketPdf({ packet: p, getFile, now: NOW, maxBytes: limit });
    assert.deepEqual(out.included.map((f) => f.id), [docId(1), docId(2)]);
    assert.deepEqual(out.left_out.map((f) => [f.id, f.reason]), [[docId(3), LEFT_OUT.TOO_BIG], [SNAPSHOT.id, LEFT_OUT.TOO_BIG]]);
    assert.ok(!reads.includes(docId(3)), "a file known to be too big is never read");
    assert.equal(PACKET_MAX_BYTES, 4 * 1024 * 1024);
  });

  test("a file that is not a PDF or a photo, or a PDF that will not open, is left out and the rest still go in", async () => {
    const { p, files } = await personalFiles();
    files[docId(2)] = Buffer.from("hello, this is a text file");
    files[docId(3)] = Buffer.from("%PDF-1.7 this is not really a pdf");
    const out = await buildPacketPdf({ packet: p, getFile: serve(files).getFile, now: NOW });
    assert.deepEqual(out.left_out.map((f) => [f.id, f.reason]), [[docId(2), LEFT_OUT.NOT_SUPPORTED], [docId(3), LEFT_OUT.COULD_NOT_OPEN]]);
    assert.deepEqual(out.included.map((f) => f.id), [docId(1), SNAPSHOT.id]);
    assert.equal(await pageCount(out.bytes), 1 + 1 + 3);
  });

  test("nothing that could go in means no PDF at all, never a cover on its own", async () => {
    const { p } = await personalFiles();
    const out = await buildPacketPdf({ packet: p, getFile: serve({}).getFile, now: NOW });
    assert.equal(out.bytes, null);
    assert.equal(out.left_out.length, 4);
    assert.ok(out.left_out.every((f) => f.reason === LEFT_OUT.NOT_FOUND));
  });

  test("the cover words: who it is for, the day, and one row per file with its page", () => {
    const business = findPacket(packetsFromVault(sampleVault({ variant: "full" }), { fundhubPapers: [] }), BUSINESS.id);
    const w = coverLines({ packet: business, clientName: CLIENT.name, now: NOW, included: [{ paper: "Articles of Organization", name: "fundhub-llc-articles.pdf", page: 2 }] });
    assert.deepEqual(w, {
      title: "Lender packet",
      who: "Fundhub LLC",
      sub: "Owner: Test Test",
      made: "Made Oct 7, 2026 from the Fundhub document vault.",
      heading: "What is inside (1 file)",
      rows: [{ n: 1, text: "Articles of Organization: fundhub-llc-articles.pdf", page: 2 }]
    });
    assert.ok(!/\$|\d{3},\d{3}|score/i.test(JSON.stringify(w)), "the cover states no amount and no score");
  });

  test("a long list spills onto more cover pages and every page number still lands", async () => {
    assert.equal(coverPageCount(26), 1);
    assert.equal(coverPageCount(27), 2);
    assert.equal(coverPageCount(62), 2);
    assert.equal(coverPageCount(63), 3);
    const papers = [{ key: "custom_x", title: "Staff paper", files: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: `page-${i}.pdf` })) }];
    const one = await pdfOf(1);
    const files = Object.fromEntries(papers[0].files.map((f) => [f.id, one]));
    const out = await buildPacketPdf({ packet: { kind: "client", papers }, getFile: serve(files).getFile, now: NOW });
    assert.equal(await pageCount(out.bytes), 2 + 30);
    assert.equal(out.included[0].page, 3);
    assert.equal(out.included[29].page, 32);
  });

  test("a name the PDF font cannot draw becomes a question mark, never an error", async () => {
    const papers = [{ key: "articles_of_organization", title: "Articles", files: [{ id: "a", name: "статут-商业.pdf" }] }];
    const out = await buildPacketPdf({ packet: { kind: "business", name: "Café 東京 LLC", papers }, getFile: serve({ a: await pdfOf(1) }).getFile, now: NOW });
    assert.equal(await pageCount(out.bytes), 2);
  });

  test("the file name is plain ASCII", () => {
    assert.equal(packetFilename({ kind: "client" }, NOW), "lender-packet-personal-2026-10-07.pdf");
    assert.equal(packetFilename({ kind: "business", name: "Fundhub LLC" }, NOW), "lender-packet-fundhub-llc-2026-10-07.pdf");
    assert.equal(packetFilename({ kind: "business", name: "東京" }, NOW), "lender-packet-business-2026-10-07.pdf");
    assert.match(packetFilename({ kind: "business", name: 'a"b\r\nc' }, NOW), /^lender-packet-[a-z0-9-]+-2026-10-07\.pdf$/);
  });
});

describe("reading one file", () => {
  const OTHER_ORG = "fb789b0b-0000-4cdc-8a24-ee6b6659e0b6";
  const OTHER_CLIENT = "f1cb9c27-0000-4db1-b6bb-4eddc898bb8e";
  async function setup(row) {
    const objects = new Map();
    const store = createStore({ provider: memoryProvider({ objects }) });
    const key = await memoryProvider({ objects }).put("x/doc.pdf", Buffer.from("%PDF-hi"), { contentType: "application/pdf" });
    const resolved = [];
    const resolve = async (_db, args) => { resolved.push(args); return row ? { storage_key: key, ...row } : null; };
    return { store, resolve, resolved };
  }
  const base = { org_id: ORG_ID, client_id: CLIENT.id, mime_type: "application/pdf", byte_size: 7, checksum: null, expires_at: null };

  test("this org and this client: the bytes come from the store", async () => {
    const { store, resolve, resolved } = await setup(base);
    const getFile = fileReader({}, { orgId: ORG_ID, clientId: CLIENT.id, store, now: NOW, resolve });
    const f = await getFile(docId(2));
    assert.deepEqual(resolved, [{ documentId: docId(2) }]);
    assert.equal(f.size, 7);
    assert.equal((await f.read()).toString(), "%PDF-hi");
  });

  test("another org, another client, an expired row or no row is not found — nothing is read", async () => {
    for (const row of [{ ...base, org_id: OTHER_ORG }, { ...base, client_id: OTHER_CLIENT }, { ...base, expires_at: "2026-10-01T00:00:00Z" }, null]) {
      const { store, resolve } = await setup(row);
      const f = await fileReader({}, { orgId: ORG_ID, clientId: CLIENT.id, store, now: NOW, resolve })(docId(2));
      assert.deepEqual(f, { left_out: LEFT_OUT.NOT_FOUND }, JSON.stringify(row));
    }
  });

  test("a public blob URL is never fetched from here", async () => {
    const resolve = async () => ({ ...base, storage_key: "https://blob.example/x.pdf" });
    const f = await fileReader({}, { orgId: ORG_ID, clientId: CLIENT.id, store: null, now: NOW, resolve })(docId(2));
    assert.deepEqual(f, { left_out: LEFT_OUT.NOT_SUPPORTED });
  });
});

describe("the Fundhub papers read", () => {
  test("scoped by org and client, deliverables only, the two subtypes, current rows, newest first", async () => {
    const calls = [];
    const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [SNAPSHOT] }; } };
    const rows = await loadFundhubPapers(db, { orgId: ORG_ID, clientId: CLIENT.id, now: NOW });
    assert.deepEqual(rows, [SNAPSHOT]);
    const { sql, params } = calls[0];
    assert.match(sql, /WHERE org_id = \$1 AND client_id = \$2 AND kind = 'deliverable'/);
    assert.match(sql, /expires_at IS NULL OR expires_at > \$4/);
    assert.match(sql, /ORDER BY subtype, generated_at DESC/);
    assert.deepEqual(params, [ORG_ID, CLIENT.id, ["funding_snapshot", "credit_analysis_report"], NOW.toISOString()]);
  });

  test("no org or a bad client id never reaches the database", async () => {
    const db = { query: async () => { throw new Error("should not run"); } };
    await assert.rejects(loadFundhubPapers(db, { orgId: null, clientId: CLIENT.id }), TypeError);
    await assert.rejects(loadFundhubPapers(db, { orgId: ORG_ID, clientId: "nope" }), TypeError);
  });
});
