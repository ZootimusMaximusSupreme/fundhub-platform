// The lender-ready packet — Finance OS wave 3, unit I3
// (ops/workflows/finance-os-wave3-brief.txt: "Lender-ready packet in one tap").
//
// WHAT IT IS. For the personal file, or for one business, it gathers the papers
// that are already READY in the document vault (src/finance/document-vault.mjs)
// and the two papers Fundhub itself made for this client, and builds ONE PDF: a
// cover page that lists what is inside, then every file in the vault's own order.
// The screen lists what is still missing, line by line.
//
//   personal packet   the vault's personal lines (ID, proof of address, personal
//                     tax returns, any staff-added personal line)
//   business packet   that business's lines (bank statements, tax returns, the
//                     formation papers — Articles and Good Standing — the EIN
//                     letter, any staff-added line for that business)
//   both              + "Funding letter"  = the Funding Snapshot deliverable
//                     + "Credit summary"  = the Credit Analysis Report deliverable
//
// The two Fundhub papers are the UnderwriteIQ deliverables the funding path
// already saves (src/underwrite/funding-letter-pdf.mjs FUNDING_ANALYSIS_SUBTYPE:
// funding_snapshot, credit_analysis_report). This file reads them; it never makes
// one, never prints a dollar amount and never reads a score. UnderwriteIQ stays
// the only source of funding dollars: the snapshot goes in exactly as it printed.
// "Funding letter" here means that snapshot, NOT the bureau letters the code also
// calls funding letters (funding_inquiry_removal / funding_personal_info): those
// go to a credit bureau, never to a lender, so they are not in a lender packet.
//
// WHAT GOES IN. Only a file the vault calls ready: accepted by a person (or by the
// document reader, for the ID pair) and not too old. A file that was sent and not
// checked yet, a rejected file and an out-of-date file stay out and the line shows
// as still missing — the same test the closer reads ("COMPLETE MEANS EVERY LINE IS
// ACCEPTED OR WAIVED", document-vault.mjs). A line with SOME ready files (1 of 2
// tax returns) puts those in and still lists the line as missing.
//
// READ ONLY, NOTHING STORED. The PDF is built in memory for one answer and thrown
// away. No file content is written anywhere: not to the store, not to the
// database, not to a log. The storage key is read on the server to fetch the
// bytes (resolveStorageTarget, the same read the signed download route uses) and
// never leaves this module. Every file is checked against the org AND the client
// before a byte is read, on top of the vault's own scoped query.
//
// TOO BIG FOR ONE ANSWER. A function answer has a size ceiling (6 MB on Netlify,
// and binary bodies are larger on the wire), so the packet carries at most
// PACKET_MAX_BYTES of files. A file that would go past it is left out and named
// in the answer (`x-packet-left-out`), and the screen tells the person to send it
// on its own. Nothing is shrunk or re-encoded.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { resolveStorageTarget } from "../documents/retrieve.mjs";

/** Packet keys: "personal", a business container's uuid, or "business" for the
    one unlabelled business a client with a `businesses` row but no container has. */
export const PERSONAL = "personal";
export const LONE_BUSINESS = "business";

/** The most file bytes one packet carries. See the header. */
export const PACKET_MAX_BYTES = 4 * 1024 * 1024;

/** The two papers Fundhub makes, in the order they go in after the vault's lines. */
export const FUNDHUB_PAPERS = Object.freeze([
  Object.freeze({
    key: "funding_letter",
    title: "Funding letter",
    subtype: "funding_snapshot",
    source: "src/underwrite/funding-letter-pdf.mjs FUNDING_ANALYSIS_SUBTYPE.funding_snapshot"
  }),
  Object.freeze({
    key: "credit_summary",
    title: "Credit summary",
    subtype: "credit_analysis_report",
    source: "src/underwrite/funding-letter-pdf.mjs FUNDING_ANALYSIS_SUBTYPE.credit_analysis"
  })
]);

/** A vault line's status → the packet's word for it. */
const PAPER_STATUS = Object.freeze({
  accepted: "ready",
  waived: "not_needed",
  uploaded: "waiting",
  expired: "too_old",
  rejected: "redo",
  missing: "missing"
});
const DONE = new Set(["ready", "not_needed"]);

/** Why a file did not make it into the PDF. */
export const LEFT_OUT = Object.freeze({
  TOO_BIG: "too_big",
  NOT_FOUND: "not_found",
  NOT_SUPPORTED: "not_supported",
  COULD_NOT_OPEN: "could_not_open"
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v) => (Array.isArray(v) ? v : []);

/* ───────────────────────────── which packet ───────────────────────────── */

/** The packet key a vault scope belongs to. */
export function packetKeyOf(scope) {
  if (!scope || scope.kind !== "business") return PERSONAL;
  return scope.id ? String(scope.id) : LONE_BUSINESS;
}

/** Is this a packet key the endpoint takes? Shape only; the packet must exist too. */
export function isPacketKey(v) {
  const s = String(v ?? "").trim();
  return s === PERSONAL || s === LONE_BUSINESS || UUID_RE.test(s);
}

/* ───────────────────────────── the packet list (pure) ───────────────────────────── */

const fileName = (d) => d.filename || d.title || "File";

/** The files on a vault line that are ready to hand a lender. */
function readyFiles(item) {
  return list(item.documents)
    .filter((d) => d && d.status === "accepted" && d.expired !== true)
    .map((d) => ({ id: String(d.id), name: fileName(d) }));
}

function vaultPaper(item) {
  const status = PAPER_STATUS[item.status] || "missing";
  return {
    key: item.key,
    slot: item.slot,
    title: item.title,
    from: "vault",
    status,
    have: Number(item.have) || 0,
    need: Number(item.need) || 1,
    unit: item.unit || "file",
    detail: item.detail || null,
    files: readyFiles(item)
  };
}

function fundhubPaper(def, doc) {
  return {
    key: def.key,
    slot: def.key,
    title: def.title,
    from: "fundhub",
    status: doc ? "ready" : "missing",
    have: doc ? 1 : 0,
    need: 1,
    unit: "file",
    detail: doc ? null : "not on file yet",
    doc_title: doc ? (doc.title || null) : null,
    files: doc ? [{ id: String(doc.id), name: doc.title || def.title }] : []
  };
}

/**
 * packetsFromVault — one packet for the personal file and one per business,
 * built from the vault answer (shapeVault) and the client's Fundhub papers.
 *
 *   vault          the GET /api/money/vault body (items, scopes)
 *   fundhubPapers  rows from loadFundhubPapers: [{ id, subtype, title }]
 *
 * Pure. Returns [] when the vault has no lines at all (nothing to build yet).
 */
export function packetsFromVault(vault, { fundhubPapers = [] } = {}) {
  const items = list(vault && vault.items);
  if (!items.length) return [];
  const bySubtype = new Map();
  for (const row of list(fundhubPapers)) {
    if (row && row.subtype && !bySubtype.has(row.subtype)) bySubtype.set(row.subtype, row);
  }
  const fundhub = FUNDHUB_PAPERS.map((def) => fundhubPaper(def, bySubtype.get(def.subtype) || null));

  const scopes = [{ kind: "client", id: null, name: null }];
  for (const s of list(vault.scopes)) if (s && s.kind === "business") scopes.push(s);

  return scopes.map((scope) => {
    const key = packetKeyOf(scope);
    const lines = items.filter((it) => packetKeyOf(it && it.scope) === key).map(vaultPaper);
    const papers = [...lines, ...fundhub.map((p) => ({ ...p, files: p.files.map((f) => ({ ...f })) }))];
    // One file can count toward two lines (a bank statement is also a proof of
    // address). It goes in the PDF once, under the first line it counts for.
    const seen = new Set();
    for (const p of papers) {
      p.files = p.files.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
    }
    const ready = papers.filter((p) => DONE.has(p.status)).length;
    const files = papers.reduce((n, p) => n + p.files.length, 0);
    const missing = papers.filter((p) => !DONE.has(p.status)).map((p) => ({
      key: p.key, slot: p.slot, title: p.title, from: p.from, status: p.status,
      have: p.have, need: p.need, unit: p.unit, detail: p.detail
    }));
    return {
      key,
      kind: scope.kind === "business" ? "business" : "client",
      name: scope.kind === "business" ? (scope.name || null) : null,
      ready: missing.length === 0,
      counts: { papers: papers.length, ready, missing: missing.length, files },
      papers,
      missing
    };
  });
}

export function findPacket(packets, key) {
  const k = String(key ?? "").trim();
  return list(packets).find((p) => p.key === k) || null;
}

/** The files to put in, in order, each with the paper it belongs to. */
export function packetFiles(packet) {
  const out = [];
  for (const p of list(packet && packet.papers)) {
    for (const f of list(p.files)) out.push({ id: f.id, name: f.name, paper_key: p.key, paper: p.title });
  }
  return out;
}

/* ───────────────────────────── the database reads ───────────────────────────── */

/**
 * loadFundhubPapers — the newest current Funding Snapshot and Credit Analysis
 * Report saved for this client. Scoped by org AND client. Metadata only.
 */
export async function loadFundhubPapers(db, { orgId, clientId, now = new Date() } = {}) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!UUID_RE.test(String(clientId || ""))) throw new TypeError("client_id must be a uuid");
  const r = await db.query(
    `SELECT DISTINCT ON (subtype) id, subtype, title, mime_type, byte_size, generated_at
       FROM documents
      WHERE org_id = $1 AND client_id = $2 AND kind = 'deliverable'
        AND subtype = ANY($3::text[])
        AND (expires_at IS NULL OR expires_at > $4)
      ORDER BY subtype, generated_at DESC, id DESC`,
    [orgId, String(clientId).trim(), FUNDHUB_PAPERS.map((p) => p.subtype), new Date(now).toISOString()]
  );
  return r.rows;
}

/**
 * fileReader — how the PDF builder gets one file's bytes. Returns
 * getFile(id) → { mime, size, read() } or { left_out }.
 *
 * The row must belong to this org AND this client, must not have expired, and
 * must live in our own store (an https storage key is a public blob URL; fetching
 * it would be an outbound call this module is not allowed to make).
 */
export function fileReader(db, { orgId, clientId, store, now = new Date(), resolve = resolveStorageTarget } = {}) {
  return async function getFile(documentId) {
    const t = await resolve(db, { documentId });
    if (!t || !t.storage_key) return { left_out: LEFT_OUT.NOT_FOUND };
    if (String(t.org_id) !== String(orgId) || String(t.client_id) !== String(clientId)) return { left_out: LEFT_OUT.NOT_FOUND };
    if (t.expires_at && new Date(t.expires_at).getTime() <= new Date(now).getTime()) return { left_out: LEFT_OUT.NOT_FOUND };
    const key = String(t.storage_key);
    if (/^https?:\/\//i.test(key)) return { left_out: LEFT_OUT.NOT_SUPPORTED };
    const size = Number(t.byte_size);
    return {
      mime: t.mime_type || null,
      size: Number.isFinite(size) && size >= 0 ? size : null,
      read: async () => {
        const obj = await store.get(key, { expectedChecksum: t.checksum || null });
        return obj && obj.body ? obj.body : null;
      }
    };
  };
}

/* ───────────────────────────── the PDF ───────────────────────────── */

const PAGE = Object.freeze({ w: 612, h: 792, margin: 54 }); // US Letter
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayWords(now) {
  const d = new Date(now);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The standard PDF fonts speak WinAnsi only. Anything else becomes "?". */
function safeText(font, s) {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  try { font.encodeText(text); return text; } catch { /* fall through */ }
  let out = "";
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += "?"; }
  }
  return out;
}

function fit(font, s, size, width) {
  let t = s;
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function sniff(bytes) {
  const b = bytes;
  if (!b || b.length < 4) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

async function addFile(out, bytes) {
  const kind = sniff(bytes);
  if (kind === "application/pdf") {
    const src = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
    return pages.length;
  }
  if (kind === "image/png" || kind === "image/jpeg") {
    const img = kind === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    const page = out.addPage([PAGE.w, PAGE.h]);
    const boxW = PAGE.w - PAGE.margin * 2;
    const boxH = PAGE.h - PAGE.margin * 2;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (PAGE.w - w) / 2, y: (PAGE.h - h) / 2, width: w, height: h });
    return 1;
  }
  return 0;
}

const ROWS_FIRST = 26;
const ROWS_NEXT = 36;

/** How many cover pages a list of `rows` needs. */
export function coverPageCount(rows) {
  const n = Math.max(0, Number(rows) || 0);
  return n <= ROWS_FIRST ? 1 : 1 + Math.ceil((n - ROWS_FIRST) / ROWS_NEXT);
}

/**
 * coverLines — the words on the cover, as plain data, so a test can read them
 * without parsing a PDF. `included` = [{ paper, name, page }].
 */
export function coverLines({ packet, clientName, included, now }) {
  const who = packet.kind === "business" ? (packet.name || "Business") : (clientName || "Personal file");
  const sub = packet.kind === "business" && clientName ? `Owner: ${clientName}` : null;
  return {
    title: "Lender packet",
    who,
    sub,
    made: `Made ${dayWords(now)} from the Fundhub document vault.`,
    heading: `What is inside (${included.length} ${included.length === 1 ? "file" : "files"})`,
    rows: included.map((f, i) => ({ n: i + 1, text: `${f.paper}: ${f.name}`, page: f.page }))
  };
}

function drawCover(out, words, pageCount, fonts) {
  const { regular, bold } = fonts;
  const ink = rgb(0.063, 0.078, 0.086);
  const gray = rgb(0.384, 0.412, 0.408);
  const width = PAGE.w - PAGE.margin * 2;
  let page = out.insertPage(0, [PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin - 8;
  page.drawText(safeText(bold, words.title), { x: PAGE.margin, y, size: 22, font: bold, color: ink });
  y -= 30;
  page.drawText(fit(bold, safeText(bold, words.who), 14, width), { x: PAGE.margin, y, size: 14, font: bold, color: ink });
  y -= 20;
  if (words.sub) {
    page.drawText(fit(regular, safeText(regular, words.sub), 11, width), { x: PAGE.margin, y, size: 11, font: regular, color: gray });
    y -= 16;
  }
  page.drawText(safeText(regular, words.made), { x: PAGE.margin, y, size: 11, font: regular, color: gray });
  y -= 34;
  page.drawText(safeText(bold, words.heading), { x: PAGE.margin, y, size: 12, font: bold, color: ink });
  y -= 22;
  let at = 0;
  let onPage = 0;
  for (const row of words.rows) {
    const limit = at === 0 ? ROWS_FIRST : ROWS_NEXT;
    if (onPage >= limit) {
      at += 1;
      onPage = 0;
      page = out.insertPage(at, [PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin - 8;
    }
    const pageWords = `page ${row.page}`;
    const pw = regular.widthOfTextAtSize(pageWords, 10);
    const label = fit(regular, safeText(regular, `${row.n}. ${row.text}`), 10, width - pw - 16);
    page.drawText(label, { x: PAGE.margin, y, size: 10, font: regular, color: ink });
    page.drawText(pageWords, { x: PAGE.w - PAGE.margin - pw, y, size: 10, font: regular, color: gray });
    y -= 18;
    onPage += 1;
  }
  if (at + 1 !== pageCount) throw new Error("cover page count drifted");
}

/**
 * buildPacketPdf — the one PDF. Reads each file through `getFile` (fileReader),
 * keeps to `maxBytes`, and puts a cover in front.
 *
 * Returns { bytes, included: [{ id, paper, name, pages, page }], left_out: [{ id, paper, name, reason }] }.
 * `bytes` is null when nothing could go in — the caller answers that, it does not
 * hand back a PDF with only a cover.
 */
export async function buildPacketPdf({ packet, clientName = null, getFile, now = new Date(), maxBytes = PACKET_MAX_BYTES } = {}) {
  if (!packet) throw new TypeError("packet is required");
  if (typeof getFile !== "function") throw new TypeError("getFile is required");
  const out = await PDFDocument.create();
  const included = [];
  const leftOut = [];
  let used = 0;

  for (const f of packetFiles(packet)) {
    const meta = await getFile(f.id);
    const skip = (reason) => leftOut.push({ id: f.id, paper: f.paper, name: f.name, reason });
    if (!meta || meta.left_out) { skip((meta && meta.left_out) || LEFT_OUT.NOT_FOUND); continue; }
    if (meta.size !== null && meta.size !== undefined && used + meta.size > maxBytes) { skip(LEFT_OUT.TOO_BIG); continue; }
    const bytes = await meta.read();
    if (!bytes || !bytes.length) { skip(LEFT_OUT.NOT_FOUND); continue; }
    if (used + bytes.length > maxBytes) { skip(LEFT_OUT.TOO_BIG); continue; }
    if (!sniff(bytes)) { skip(LEFT_OUT.NOT_SUPPORTED); continue; }
    const before = out.getPageCount();
    let pages = 0;
    try {
      pages = await addFile(out, bytes);
    } catch {
      // A locked or broken PDF, or a picture pdf-lib cannot read. Drop any pages
      // it half-added, so the PDF never carries part of a file.
      while (out.getPageCount() > before) out.removePage(out.getPageCount() - 1);
      skip(LEFT_OUT.COULD_NOT_OPEN);
      continue;
    }
    if (!pages) { skip(LEFT_OUT.NOT_SUPPORTED); continue; }
    used += bytes.length;
    included.push({ id: f.id, paper: f.paper, name: f.name, pages, start: before });
  }

  if (!included.length) return { bytes: null, included: [], left_out: leftOut };

  const covers = coverPageCount(included.length);
  const rows = included.map((f) => ({ ...f, page: covers + f.start + 1 }));
  const words = coverLines({ packet, clientName, included: rows, now });
  const fonts = { regular: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  drawCover(out, words, covers, fonts);

  out.setTitle(safeText(fonts.regular, `Lender packet - ${words.who}`));
  out.setCreator("Fundhub");
  out.setProducer("Fundhub");
  out.setCreationDate(new Date(now));
  out.setModificationDate(new Date(now));
  const bytes = await out.save();
  return {
    bytes,
    included: rows.map(({ id, paper, name, pages, page }) => ({ id, paper, name, pages, page })),
    left_out: leftOut
  };
}

/** A plain ASCII file name: lender-packet-personal-2026-11-07.pdf. */
export function packetFilename(packet, now = new Date()) {
  const raw = packet && packet.kind === "business" ? (packet.name || "business") : "personal";
  const slug = String(raw).normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "business";
  return `lender-packet-${slug}-${new Date(now).toISOString().slice(0, 10)}.pdf`;
}

export default {
  PERSONAL, LONE_BUSINESS, PACKET_MAX_BYTES, FUNDHUB_PAPERS, LEFT_OUT,
  packetKeyOf, isPacketKey, packetsFromVault, findPacket, packetFiles,
  loadFundhubPapers, fileReader, buildPacketPdf, coverLines, coverPageCount, packetFilename
};
