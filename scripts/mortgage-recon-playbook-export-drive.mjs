#!/usr/bin/env node
/**
 * Build styled playbook PDF + upload to Reconveyance Drive folder.
 *   node --env-file=.env scripts/mortgage-recon-playbook-export-drive.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { driveConfigFromEnv } from "../src/company-brain/config.mjs";
import { fetchOAuthAccessToken } from "../src/company-brain/auth.mjs";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const ROOT = process.cwd();
const MD_PATH = path.join(ROOT, "docs/sops/mortgage-reconveyance-playbook-2026-10-05.md");
const OUT_DIR = path.join(ROOT, "credentials/mortgage-recon-playbook");
const HTML_PATH = path.join(OUT_DIR, "Mortgage-ReCONveyance-Playbook.html");
const PDF_PATH = path.join(OUT_DIR, "Mortgage-ReCONveyance-Playbook.pdf");
const DRIVE_FOLDER = "1coNo39Vbm7830hyOct-Gcn23UWHqYElF";
const PDF_NAME = "Mortgage ReCONveyance Playbook — 7137 E Rancho Vista Dr 4011.pdf";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap');
:root {
  --ink: #0f172a;
  --muted: #64748b;
  --paper: #faf9f7;
  --card: #ffffff;
  --gold: #c9a227;
  --gold-dim: #f5ecd3;
  --navy: #0c1929;
  --done: #059669;
  --partial: #d97706;
  --gap: #dc2626;
  --course: #2563eb;
  --line: #e2e8f0;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 10.5pt; line-height: 1.45;
  color: var(--ink); background: var(--paper);
}
.cover {
  min-height: 100vh; padding: 48px 56px;
  background: linear-gradient(145deg, var(--navy) 0%, #1a365d 55%, #0c1929 100%);
  color: #fff; page-break-after: always;
  display: flex; flex-direction: column; justify-content: space-between;
}
.cover h1 {
  font-family: 'Instrument Serif', Georgia, serif;
  font-size: 42pt; font-weight: 400; line-height: 1.05;
  margin: 0 0 12px; letter-spacing: -0.02em;
}
.cover .sub { font-size: 13pt; opacity: 0.85; max-width: 28em; }
.cover .meta { font-size: 9pt; opacity: 0.65; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 20px; }
.gold-bar { height: 4px; width: 72px; background: var(--gold); margin: 24px 0; }
.page { padding: 40px 48px 48px; max-width: 820px; margin: 0 auto; }
h2 {
  font-family: 'Instrument Serif', Georgia, serif;
  font-size: 22pt; font-weight: 400;
  margin: 32px 0 12px; color: var(--navy);
  border-bottom: 2px solid var(--gold); padding-bottom: 6px;
}
h3 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 10px; }
.pipeline {
  display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 24px;
}
.pill {
  font-size: 8pt; font-weight: 600; padding: 6px 10px; border-radius: 999px;
  background: var(--card); border: 1px solid var(--line);
}
.pill.done { background: #ecfdf5; border-color: #6ee7b7; color: var(--done); }
.pill.partial { background: #fffbeb; border-color: #fcd34d; color: var(--partial); }
.pill.gap { background: #fef2f2; border-color: #fca5a5; color: var(--gap); }
.pill.course { background: #eff6ff; border-color: #93c5fd; color: var(--course); }
.flow-box {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 16px 20px; margin: 12px 0 20px;
  box-shadow: 0 1px 3px rgba(15,23,42,0.06);
}
.flow-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 9pt; }
.flow-arrow { color: var(--gold); font-weight: 700; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 8.5pt; margin-bottom: 20px; }
.legend span { display: flex; align-items: center; gap: 6px; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
table {
  width: 100%; border-collapse: collapse; margin: 10px 0 20px;
  font-size: 9pt; background: var(--card);
  border-radius: 8px; overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.05);
}
th {
  background: var(--navy); color: #fff; text-align: left;
  padding: 8px 10px; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em;
}
td { padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
.cb { font-family: monospace; font-size: 11pt; }
.priority {
  background: linear-gradient(90deg, var(--gold-dim), #fff);
  border-left: 4px solid var(--gold);
  padding: 14px 18px; border-radius: 0 10px 10px 0; margin: 16px 0;
}
.priority ol { margin: 8px 0 0; padding-left: 1.2em; }
.priority li { margin: 6px 0; }
.outstanding {
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px;
  padding: 16px 18px; margin-top: 20px;
}
.outstanding h2 { border-color: #f87171; color: #991b1b; }
ul.todo { list-style: none; padding: 0; }
ul.todo li { padding: 4px 0 4px 1.4em; position: relative; }
ul.todo li::before { content: '☐'; position: absolute; left: 0; color: var(--muted); }
ul.todo li.done::before { content: '☑'; color: var(--done); }
@media print {
  body { background: #fff; }
  .page { padding: 24px 32px; max-width: none; }
  .cover { min-height: auto; padding: 36px 40px; }
}
`;

function mdTableToHtml(block) {
  const lines = block.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return `<pre>${block}</pre>`;
  const rows = lines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()));
  let html = "<table>";
  rows.forEach((line, i) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const tag = i === 0 ? "th" : "td";
    if (i === 0) html += "<thead><tr>";
    else if (i === 1) html += "</tr></thead><tbody><tr>";
    else html += "<tr>";
    for (const c of cells) {
      let cell = c.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      cell = cell.replace(/✅/g, '<span class="pill done">DONE</span>');
      cell = cell.replace(/🟡/g, '<span class="pill partial">PARTIAL</span>');
      cell = cell.replace(/⬜/g, '<span class="pill gap">GAP</span>');
      cell = cell.replace(/📚/g, '<span class="pill course">COURSE</span>');
      html += `<${tag}>${cell}</${tag}>`;
    }
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

function mdToBody(md) {
  const parts = [];
  const chunks = md.split(/\n(?=## )/);
  for (const chunk of chunks) {
    if (chunk.startsWith("# ")) continue;
    const segs = chunk.split(/\n(?=### )/);
    const head = segs[0].match(/^## (.+)/);
    if (head) parts.push(`<h2>${head[1].replace(/^\d+\.\s*/, "")}</h2>`);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const h3 = seg.match(/^### (.+)/m);
      if (h3) parts.push(`<h3>${h3[1]}</h3>`);
      const tables = seg.split(/\n\n(?=\|)/);
      for (const t of tables) {
        if (t.trim().startsWith("|")) parts.push(mdTableToHtml(t));
        else if (t.includes("```mermaid")) {
          parts.push(`<div class="flow-box"><p><strong>Flowchart</strong> — see pipeline section below (Mermaid in repo markdown).</p></div>`);
        } else {
          let text = t.replace(/^### .+\n/m, "").replace(/^## .+\n/m, "");
          text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
          text = text.replace(/^- \[ \] (.+)$/gm, '<li class="todo-item">$1</li>');
          text = text.replace(/^- \[x\] (.+)$/gim, '<li class="done-item">$1</li>');
          if (text.includes("<li")) text = `<ul class="todo">${text}</ul>`;
          text = text.replace(/^(\d+)\. \[ \] (.+)$/gm, "<li>$2</li>");
          if (/^<li/m.test(text.trim())) text = `<ol>${text}</ol>`;
          text = text.split("\n\n").filter(Boolean).map((p) => {
            if (p.startsWith("<")) return p;
            if (p.startsWith("**Do first")) return `<div class="priority"><p>${p.replace(/\n/g, "</p><p>")}</p></div>`;
            return `<p>${p.replace(/\n/g, "<br/>")}</p>`;
          }).join("\n");
          if (text.trim() && !text.includes("<h2")) parts.push(text);
        }
      }
    }
  }
  return parts.join("\n");
}

function pipelineHtml() {
  return `
<div class="legend">
  <span><span class="dot" style="background:var(--done)"></span> Done</span>
  <span><span class="dot" style="background:var(--partial)"></span> Partial</span>
  <span><span class="dot" style="background:var(--gap)"></span> Not started / gap</span>
  <span><span class="dot" style="background:var(--course)"></span> Course only</span>
</div>
<div class="flow-box">
  <div class="flow-row">
    <span class="pill course">0 Intro</span><span class="flow-arrow">→</span>
    <span class="pill partial">1 Deed accept</span><span class="flow-arrow">→</span>
    <span class="pill course">2 Contract</span><span class="flow-arrow">→</span>
    <span class="pill partial">3 DOT file</span><span class="flow-arrow">→</span>
    <span class="pill done">4 UCC</span><span class="flow-arrow">→</span>
    <span class="pill partial">5 Note</span><span class="flow-arrow">→</span>
    <span class="pill course">6–7 Educ</span><span class="flow-arrow">→</span>
    <span class="pill gap">8 SOA</span><span class="flow-arrow">→</span>
    <span class="pill gap">9 Presentment</span><span class="flow-arrow">→</span>
    <span class="pill partial">10 Reconvey</span><span class="flow-arrow">→</span>
    <span class="pill course">11 MERS</span>
  </div>
</div>
<div class="flow-box">
  <strong>Notary chain (L30)</strong>
  <div class="flow-row" style="margin-top:10px">
    Private presentment <span class="flow-arrow">→</span> Request (notary)
    <span class="flow-arrow">→</span> Notice of Breach <em>(10d)</em>
    <span class="flow-arrow">→</span> Opportunity to Cure <em>(10d)</em>
    <span class="flow-arrow">→</span> Certificate of Dishonor
    <span class="flow-arrow">→</span> Record reconveyance
  </div>
</div>`;
}

function coverHtml() {
  return `
<section class="cover">
  <div>
    <div class="gold-bar"></div>
    <h1>Mortgage Re{CON}veyance<br/>Playbook</h1>
    <p class="sub">Hand this to the person doing the work. Lessons 1–37 in course order. Each step says what to do.</p>
  </div>
  <div class="meta">
    <div><strong>Property:</strong> 7137 E Rancho Vista Dr Unit 4011, Scottsdale AZ 85251</div>
    <div><strong>Generated:</strong> ${new Date().toISOString().slice(0, 10)}</div>
    <div><strong>Source:</strong> Bryan-Stay-Strong-Thinkific-Course-Export.zip + Drive case folders</div>
  </div>
</section>`;
}

async function buildHtml() {
  const md = fs.readFileSync(MD_PATH, "utf8");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const body = mdToBody(md);
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Mortgage ReCONveyance Playbook</title>
<style>${CSS}</style>
</head><body>
${coverHtml()}
<div class="page">
<h2>At a glance</h2>
${pipelineHtml()}
${body.replace(/## 6\. Outstanding/g, '</div><div class="page outstanding"><h2>Outstanding — placement TBD</h2>').replace(/## 7\. Should Grok.*/, "</div>")}
</div>
</body></html>`;
  fs.writeFileSync(HTML_PATH, html);
  return html;
}

async function htmlToPdf() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle" });
  await page.pdf({
    path: PDF_PATH,
    format: "Letter",
    printBackground: true,
    margin: { top: "0.5in", bottom: "0.6in", left: "0.5in", right: "0.5in" }
  });
  await browser.close();
}

async function driveUpload(filePath, name, mime) {
  const config = driveConfigFromEnv(process.env);
  const cand = (config.oauthCandidates || [])[0];
  if (!cand?.credentials?.refreshToken) throw new Error("Drive OAuth not ready");
  const tok = await fetchOAuthAccessToken(cand.credentials);
  const bytes = fs.readFileSync(filePath);
  const meta = { name, parents: [DRIVE_FOLDER] };
  const boundary = `fh${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok) throw new Error(json.error?.message || text.slice(0, 300));
  return json;
}

async function main() {
  await buildHtml();
  console.log("HTML:", HTML_PATH);
  await htmlToPdf();
  console.log("PDF:", PDF_PATH, fs.statSync(PDF_PATH).size, "bytes");
  const uploaded = await driveUpload(PDF_PATH, PDF_NAME, "application/pdf");
  console.log("Drive upload OK:", uploaded.name);
  console.log(uploaded.webViewLink);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
