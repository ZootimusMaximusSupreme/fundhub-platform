// Render the reviewed policy text; the TXT is the single content source.
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const source = new URL("../docs/sops/Fundhub-Information-Security-Policy.txt", import.meta.url);
const destination = new URL("../docs/sops/Fundhub-Information-Security-Policy.pdf", import.meta.url);
const text = readFileSync(source, "utf8").trim();
const pdf = await PDFDocument.create();
const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const width = 504, left = 54, bottom = 60, lineHeight = 12;
const ink = rgb(0.12, 0.18, 0.25), navy = rgb(0.08, 0.19, 0.31);
let page, y;
function nextPage() {
  page = pdf.addPage([612, 792]); y = 730;
  page.drawText("FUNDHUB  /  INFORMATION SECURITY", { x: left, y, size: 9, font: bold, color: navy });
  page.drawLine({ start: { x: left, y: 718 }, end: { x: 558, y: 718 }, thickness: 1, color: rgb(0.7, 0.78, 0.83) });
  y = 695;
}
function wrapped(value, font, size) {
  const lines = []; let line = "";
  for (const word of value.split(/\s+/)) {
    if (font.widthOfTextAtSize(line ? line + " " + word : word, size) <= width) { line += (line ? " " : "") + word; continue; }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}
nextPage();
function draw(value, font = regular, size = 9.5, gap = 8, keep = false) {
  const lines = wrapped(value, font, size);
  if (keep && y - (lines.length + 3) * lineHeight < bottom) nextPage();
  for (const line of lines) {
    if (y < bottom) nextPage();
    page.drawText(line, { x: left, y, size, font, color: font === bold ? navy : ink });
    y -= lineHeight;
  }
  y -= gap;
}
for (const paragraph of text.split(/\n\s*\n/)) {
  const parts = paragraph.split("\n");
  if (parts[0] === "FUNDHUB LLC") {
    draw(parts[0], bold, 14, 7, true);
    draw(parts[1], bold, 12, 5);
    draw(parts.slice(2).join(" "), regular, 9, 16);
    continue;
  }
  if (/^(?:\d+\. [A-Z]|IMPLEMENTATION STATUS|PROVIDER EVIDENCE)/.test(parts[0])) {
    draw(parts.shift(), bold, 10, 5, true);
  }
  if (parts.some(line => /^\w+: https:\/\//.test(line))) {
    for (const line of parts) draw(line, regular, 8.5, 3);
  } else if (parts.length) draw(parts.join(" "));
}
for (const [index, sheet] of pdf.getPages().entries()) {
  sheet.drawText(`Fundhub LLC  |  Policy owner: Chris Stanbridge  |  ${index + 1} / ${pdf.getPageCount()}`,
    { x: left, y: 34, size: 8, font: regular, color: rgb(0.4, 0.45, 0.5) });
}
pdf.setTitle("Fundhub Information Security Policy");
pdf.setAuthor("Fundhub LLC");
writeFileSync(destination, await pdf.save());
console.log(`Rendered policy: ${pdf.getPageCount()} pages.`);
