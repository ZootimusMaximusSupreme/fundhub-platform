// A readable copy of the complete stored CRS response, one section per bureau.
// This is source data, not the interpreted Credit Analysis Report. No score or
// tradeline is calculated here; absent fields remain absent.
import { PDFDocument, PDFString, StandardFonts, rgb } from "pdf-lib";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

const BUREAUS = Object.freeze({ TU: "TransUnion", EX: "Experian", EQ: "Equifax" });
const PAGE = Object.freeze({ width: 612, height: 792, left: 44, right: 44, top: 52, bottom: 48 });

function printable(value) {
  return Array.from(String(value ?? ""), (char) => {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return " ";
    // StandardFonts.Helvetica is WinAnsi. Escaping other code points keeps
    // their exact values legible instead of silently replacing them with '?'.
    if (code > 126) return `\\u{${code.toString(16).toUpperCase()}}`;
    return char;
  }).join("");
}

function flatten(value, path, out) {
  if (Array.isArray(value)) {
    if (!value.length) out.push(`${path}: []`);
    value.forEach((item, index) => flatten(item, `${path}[${index + 1}]`, out));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) out.push(`${path}: {}`);
    entries.forEach(([key, item]) => {
      const child = path ? `${path}.${key}` : key;
      // The stored CRS mapper redacts requestData.ssn. Keep that invariant if
      // an older stored result or a new vendor field carries the same secret.
      if (/(^|\.)(ssn|socialSecurityNumber|social_security_number|apiKey|accessToken|password)$/i.test(child)) {
        out.push(`${child}: [redacted]`);
      } else flatten(item, child, out);
    });
  } else {
    out.push(`${path}: ${value == null ? "Not reported" : String(value)}`);
  }
}

/** Every saved field under each bureau appears once, with its source path. */
export function creditReportLines(result) {
  const lines = [];
  lines.push({ heading: "Pull overview" });
  const overview = [];
  Object.entries(result || {}).forEach(([key, value]) => {
    if (key !== "bureaus") flatten(value, key, overview);
  });
  lines.push(...overview.map((text) => ({ text })));
  const bodies = result?.bureaus || {};
  for (const [code, label] of Object.entries(BUREAUS)) {
    lines.push({ heading: label });
    if (bodies[code] && typeof bodies[code] === "object") {
      const fields = [];
      flatten(bodies[code], "", fields);
      lines.push(...fields.map((text) => ({ text })));
    } else {
      const status = result?.bureauStatus?.[code] || "not returned";
      lines.push({ text: `Status: ${status}` });
      if (result?.bureauErrors?.[code]) lines.push({ text: `Provider note: ${result.bureauErrors[code]}` });
    }
  }
  return lines;
}

function wrap(text, font, size, maxWidth) {
  const words = printable(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
    if (current) lines.push(current);
    current = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(current + char, size) > maxWidth && current) {
        lines.push(current);
        current = "";
      }
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Full saved bureau data as a PDF. Only call for a real result. */
export async function buildCrsFullReportPdf(result, { clientName = "Client" } = {}) {
  if (!result?.bureaus || !Object.keys(result.bureaus).length) {
    throw new Error("A CRS report with bureau data is required");
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle("Fundhub Credit Report");
  pdf.setAuthor("Fundhub");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page;
  let y;
  let pageNo = 0;
  function newPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pageNo += 1;
    page.drawRectangle({ x: 0, y: PAGE.height - 7, width: PAGE.width, height: 7, color: rgb(0.08, 0.12, 0.11) });
    page.drawText("FUNDHUB  /  CREDIT REPORT", { x: PAGE.left, y: PAGE.height - 32, size: 10, font: bold, color: rgb(0.08, 0.12, 0.11) });
    page.drawText(`Page ${pageNo}`, { x: PAGE.width - 85, y: 24, size: 9, font: regular, color: rgb(0.42, 0.46, 0.45) });
    y = PAGE.height - PAGE.top - 8;
  }
  function ensure(height) { if (y - height < PAGE.bottom) newPage(); }
  newPage();
  const title = wrap(clientName, bold, 18, PAGE.width - PAGE.left - PAGE.right);
  for (const line of title) { ensure(25); page.drawText(line, { x: PAGE.left, y, size: 18, font: bold }); y -= 25; }
  const pulled = result.pulledAt ? new Date(result.pulledAt) : null;
  const date = pulled && !Number.isNaN(pulled.getTime()) ? pulled.toLocaleDateString("en-US", { timeZone: "UTC" }) : "Date not reported";
  page.drawText(`Pulled: ${date}  |  Source: CRS Softview`, { x: PAGE.left, y, size: 10, font: regular });
  y -= 31;
  const scores = result.scores || {};
  const width = (PAGE.width - PAGE.left - PAGE.right - 16) / 3;
  [["EXPERIAN", scores.ex], ["EQUIFAX", scores.eq], ["TRANSUNION", scores.tu]].forEach(([label, score], index) => {
    const x = PAGE.left + index * (width + 8);
    page.drawRectangle({ x, y: y - 46, width, height: 56, color: rgb(0.94, 0.96, 0.94) });
    page.drawText(label, { x: x + 11, y: y - 8, size: 8, font: bold, color: rgb(0.35, 0.41, 0.38) });
    page.drawText(printable(score == null ? "Not reported" : score), { x: x + 11, y: y - 30,
      size: score == null ? 11 : 18, font: bold, color: rgb(0.08, 0.12, 0.11) });
  });
  y -= 68;
  page.drawText("Every saved field follows. A missing score is not zero.", { x: PAGE.left, y, size: 9, font: regular, color: rgb(0.42, 0.46, 0.45) });
  y -= 25;
  for (const item of creditReportLines(result)) {
    if (item.heading) {
      ensure(35);
      y -= 5;
      page.drawRectangle({ x: PAGE.left, y: y - 3, width: PAGE.width - PAGE.left - PAGE.right, height: 20, color: rgb(0.91, 0.95, 0.93) });
      page.drawText(item.heading, { x: PAGE.left + 7, y: y + 3, size: 12, font: bold });
      y -= 27;
      continue;
    }
    const lines = wrap(item.text, regular, 8.5, PAGE.width - PAGE.left - PAGE.right);
    for (const line of lines) { ensure(12); page.drawText(line, { x: PAGE.left, y, size: 8.5, font: regular }); y -= 12; }
    y -= 3;
  }
  ensure(54);
  y -= 15;
  page.drawText("Want to review your next steps? Book a call:", { x: PAGE.left, y, size: 10, font: bold });
  y -= 17;
  page.drawText(BOOK_CALL_URL, { x: PAGE.left, y, size: 10, font: regular, color: rgb(0.12, 0.36, 0.35) });
  const linkWidth = regular.widthOfTextAtSize(BOOK_CALL_URL, 10);
  const link = pdf.context.obj({
    Type: "Annot", Subtype: "Link",
    Rect: [PAGE.left, y - 3, PAGE.left + linkWidth, y + 12],
    Border: [0, 0, 0],
    A: { S: "URI", URI: PDFString.of(BOOK_CALL_URL) }
  });
  page.node.addAnnot(pdf.context.register(link));
  return Buffer.from(await pdf.save());
}
