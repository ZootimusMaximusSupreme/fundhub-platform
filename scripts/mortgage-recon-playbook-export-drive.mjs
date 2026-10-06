#!/usr/bin/env node
/**
 * Build styled playbook PDF + upload to Reconveyance Drive folder.
 *   node --env-file=.env scripts/mortgage-recon-playbook-export-drive.mjs
 *
 * Mermaid blocks in the markdown are drawn as plain HTML boxes here (no mermaid
 * library, no network), so the diagrams show in the PDF too.
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
const PDF_NAME = "Mortgage ReCONveyance SOP — Any Property (example Unit 4011).pdf";

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
  --ours: #7c3aed;
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
  page-break-after: avoid;
}
h3 { font-size: 12.5pt; color: var(--navy); margin: 26px 0 8px; page-break-after: avoid; }
h3.step {
  background: var(--navy); color: #fff; padding: 8px 12px; border-radius: 8px;
  border-left: 5px solid var(--gold);
}
h3.phase {
  font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em; color: var(--gold);
  margin-top: 34px; border-bottom: 1px solid var(--line); padding-bottom: 4px;
}
h4 { font-size: 10.5pt; color: var(--navy); margin: 18px 0 4px; page-break-after: avoid; }
p { margin: 6px 0 8px; }
ul, ol { margin: 4px 0 10px; padding-left: 1.4em; }
li { margin: 3px 0; }
ul.todo { list-style: none; padding-left: 0.2em; }
ul.todo li { padding-left: 1.5em; position: relative; }
ul.todo li::before { content: '☐'; position: absolute; left: 0; color: var(--muted); }
code { font-family: ui-monospace, Menlo, monospace; font-size: 8.5pt; background: #eef2f7; padding: 1px 4px; border-radius: 4px; word-break: break-all; }
a { color: var(--course); text-decoration: none; }
hr { border: 0; border-top: 1px solid var(--line); margin: 22px 0; }
.pipeline { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 24px; }
.pill {
  display: inline-block;
  font-size: 8pt; font-weight: 600; padding: 3px 9px; border-radius: 999px;
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
tr.phase td { background: var(--gold-dim) !important; font-weight: 600; color: var(--navy); }
tr { page-break-inside: avoid; }
.dg {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 16px; margin: 12px 0 22px; box-shadow: 0 1px 3px rgba(15,23,42,0.06);
}
.dg-group { border: 1px dashed #cbd5e1; border-radius: 10px; padding: 10px 12px; page-break-inside: avoid; }
.dg-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 8px; }
.dg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dg-node {
  font-size: 8.5pt; font-weight: 600; padding: 6px 10px; border-radius: 8px;
  background: #f8fafc; border: 1px solid #cbd5e1; color: var(--ink); max-width: 15em;
}
.dg-node.wait { background: var(--gold-dim); border: 1px dashed var(--gold); color: #6b5413; }
.dg-node.decision { background: #fffbeb; border-color: var(--partial); }
.dg-node.done { background: #ecfdf5; border-color: var(--done); color: #065f46; }
.dg-node.partial { background: #fffbeb; border-color: var(--partial); color: #92400e; }
.dg-node.gap { background: #fef2f2; border-color: var(--gap); color: #991b1b; }
.dg-node.ours { background: #f5f3ff; border-color: var(--ours); color: #4c1d95; }
.dg-node.related { background: #f1f5f9; border-color: var(--muted); color: #334155; }
.dg-node .dg-note { display: block; font-weight: 400; font-size: 7.5pt; color: var(--muted); margin-top: 3px; }
.dg-arrow { color: var(--gold); font-weight: 700; font-size: 11pt; }
.dg-down { text-align: center; color: var(--gold); font-weight: 700; font-size: 13pt; line-height: 1; margin: 4px 0; }
@media print {
  body { background: #fff; }
  .page { padding: 24px 32px; max-width: none; }
  .cover { min-height: auto; padding: 36px 40px; }
}
`;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(raw) {
  const codes = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/✅/g, '<span class="pill done">DONE</span>');
  s = s.replace(/🟡/g, '<span class="pill partial">PARTIAL</span>');
  s = s.replace(/⬜/g, '<span class="pill gap">GAP</span>');
  s = s.replace(/📚/g, '<span class="pill course">COURSE</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

function tableHtml(lines) {
  const rows = lines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()));
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const [head, ...body] = rows.map(cellsOf);
  let html = "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
  for (const cells of body) {
    if (cells.length > 1 && cells.slice(1).every((c) => !c)) {
      html += `<tr class="phase"><td colspan="${head.length}">${inline(cells[0])}</td></tr>`;
    } else {
      html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    }
  }
  return html + "</tbody></table>";
}

// --- Mermaid flowchart → HTML boxes -------------------------------------------------

const NODE_RE = /^([A-Za-z0-9_]+)\s*(?:(\{\{|\[\[|\[\(|\(\[|\(\(|\[|\(|\{)\s*(?:"([^"]*)"|([^\]\)\}"]*?))\s*(\}\}|\]\]|\)\]|\]\)|\)\)|\]|\)|\}))?(?::::(\w+))?/;
const EDGE_RE = /^(-->|-\.->|==>|---|-\.-)\s*(?:\|([^|]*)\|)?\s*/;

function parseFlowchart(src) {
  const nodes = new Map();
  const order = [];
  const groups = [];
  const edges = [];
  let group = null;
  const touch = (id, label, open, cls) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: id, shape: "box", cls: "", group: group ? group.id : null };
      nodes.set(id, n);
      order.push(id);
      if (group) group.nodes.push(id);
    }
    if (label !== undefined) {
      n.label = label;
      n.shape = open === "{{" ? "wait" : open === "{" ? "decision" : "box";
    }
    if (cls) n.cls = cls;
    return n;
  };
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^(flowchart|graph|classDef|class |direction|style|%%)/.test(line)) continue;
    const sub = line.match(/^subgraph\s+([A-Za-z0-9_]+)\s*(?:\["?(.*?)"?\])?/);
    if (sub) {
      group = { id: sub[1], title: sub[2] || sub[1], nodes: [] };
      groups.push(group);
      continue;
    }
    if (line === "end") {
      group = null;
      continue;
    }
    let rest = line;
    let prev = null;
    let pendingLabel = null;
    while (rest) {
      const m = rest.match(NODE_RE);
      if (!m) break;
      const n = touch(m[1], m[2] ? (m[3] ?? m[4]) : undefined, m[2], m[6]);
      if (prev) edges.push({ from: prev.id, to: n.id, label: pendingLabel });
      prev = n;
      rest = rest.slice(m[0].length).trim();
      const e = rest.match(EDGE_RE);
      if (!e) break;
      pendingLabel = e[2] ? e[2].trim() : null;
      rest = rest.slice(e[0].length);
    }
  }
  return { nodes, order, groups, edges };
}

function flowchartHtml(src) {
  const { nodes, order, groups, edges } = parseFlowchart(src);
  const edgeOf = (a, b) => edges.find((e) => e.from === a && e.to === b);
  const drawn = new Set();
  const nodeHtml = (id, nextId) => {
    const n = nodes.get(id);
    const cls = ["dg-node", n.shape === "box" ? "" : n.shape, n.cls].filter(Boolean).join(" ");
    const notes = edges
      .filter((e) => e.from === id && e.to !== nextId && !drawn.has(e))
      .map((e) => {
        drawn.add(e);
        return `<span class="dg-note">→ ${e.label ? escapeHtml(e.label) + ": " : ""}${escapeHtml(nodes.get(e.to).label)}</span>`;
      })
      .join("");
    return `<span class="${cls}">${escapeHtml(n.label)}${notes}</span>`;
  };
  const rowHtml = (ids) => {
    let html = '<div class="dg-row">';
    ids.forEach((id, i) => {
      const next = ids[i + 1];
      const e = next ? edgeOf(id, next) : null;
      if (e) drawn.add(e);
      html += nodeHtml(id, e ? next : undefined);
      if (e) html += `<span class="dg-arrow">${e.label ? `<small>${escapeHtml(e.label)}</small> ` : ""}→</span>`;
    });
    return html + "</div>";
  };
  // Top-level items in first-appearance order: whole groups, or runs of ungrouped nodes.
  const items = [];
  const emitted = new Set();
  for (const id of order) {
    const n = nodes.get(id);
    if (n.group) {
      if (emitted.has(n.group)) continue;
      emitted.add(n.group);
      const g = groups.find((x) => x.id === n.group);
      items.push({ title: g.title, ids: g.nodes });
    } else {
      const last = items[items.length - 1];
      if (last && !last.title) last.ids.push(id);
      else items.push({ title: null, ids: [id] });
    }
  }
  // Group-to-group edges first, so they draw as a down arrow and not as a note.
  const links = items.map((it, i) => {
    const next = items[i + 1];
    if (!next) return null;
    const e = edges.find((x) => it.ids.includes(x.from) && next.ids.includes(x.to));
    if (e) drawn.add(e);
    return e;
  });
  let html = '<div class="dg">';
  items.forEach((it, i) => {
    const body = rowHtml(it.ids);
    html += it.title ? `<div class="dg-group"><div class="dg-title">${escapeHtml(it.title)}</div>${body}</div>` : body;
    if (links[i]) html += '<div class="dg-down">↓</div>';
  });
  return html + "</div>";
}

// --- Markdown → HTML -----------------------------------------------------------------

function mdToBody(md) {
  const lines = md.split("\n");
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br/>")}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^# /.test(line)) {
      flushPara();
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      flushPara();
      const lang = t.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(lang === "mermaid" ? flowchartHtml(buf.join("\n")) : `<pre>${escapeHtml(buf.join("\n"))}</pre>`);
      continue;
    }
    const h = line.match(/^(#{2,4}) (.+)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      const text = h[2];
      const cls = level === 3 && /^Step /.test(text) ? ' class="step"' : level === 3 && /^Phase /.test(text) ? ' class="phase"' : "";
      out.push(`<h${level}${cls}>${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (t === "---") {
      flushPara();
      out.push("<hr/>");
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      flushPara();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) buf.push(lines[i++]);
      out.push(tableHtml(buf));
      continue;
    }
    if (/^- \[[ x]\] /i.test(t)) {
      flushPara();
      let html = '<ul class="todo">';
      while (i < lines.length && /^- \[[ x]\] /i.test(lines[i].trim())) {
        html += `<li>${inline(lines[i].trim().replace(/^- \[[ x]\] /i, ""))}</li>`;
        i++;
      }
      out.push(html + "</ul>");
      continue;
    }
    if (/^(- |\d+\. )/.test(line)) {
      flushPara();
      const ordered = /^\d+\. /.test(line);
      let html = ordered ? "<ol>" : "<ul>";
      let open = false;
      let nested = false;
      while (i < lines.length && /^(\s*- |\d+\. )/.test(lines[i])) {
        const l = lines[i];
        if (/^\s+- /.test(l)) {
          if (!nested) {
            html += "<ul>";
            nested = true;
          }
          html += `<li>${inline(l.trim().slice(2))}</li>`;
        } else {
          if (nested) {
            html += "</ul>";
            nested = false;
          }
          if (open) html += "</li>";
          html += `<li>${inline(l.replace(/^(- |\d+\. )/, ""))}`;
          open = true;
        }
        i++;
      }
      if (nested) html += "</ul>";
      if (open) html += "</li>";
      out.push(html + (ordered ? "</ol>" : "</ul>"));
      continue;
    }
    if (!t) {
      flushPara();
      i++;
      continue;
    }
    para.push(t);
    i++;
  }
  flushPara();
  return out.join("\n");
}

function pipelineHtml() {
  const phases = ["1 Get ready", "2 Accept and secure", "3 Dispute and pay", "4 Statement of account and default", "5 Notary presentment", "6 Record and wait", "7 Reconveyance", "8 After"];
  return `
<div class="flow-box">
  <div class="flow-row">
    ${phases.map((p) => `<span class="pill">${p}</span>`).join('<span class="flow-arrow">→</span>')}
  </div>
</div>
<div class="flow-box">
  <strong>Waiting periods</strong>
  <div class="flow-row" style="margin-top:10px">
    Payments <span class="flow-arrow">→</span> <em>90+ days</em>
    <span class="flow-arrow">→</span> Statement of account <span class="flow-arrow">→</span> <em>14 days</em>
    <span class="flow-arrow">→</span> Default notice + notice of dishonor
    <span class="flow-arrow">→</span> Notice of Breach <em>(10 days)</em>
    <span class="flow-arrow">→</span> Opportunity to Cure <em>(10 days)</em>
    <span class="flow-arrow">→</span> Certificate of Dishonor
    <span class="flow-arrow">→</span> Recordings <span class="flow-arrow">→</span> <em>~2 weeks</em>
    <span class="flow-arrow">→</span> Substitution of trustee
  </div>
</div>`;
}

function coverHtml() {
  return `
<section class="cover">
  <div>
    <div class="gold-bar"></div>
    <h1>Mortgage Re{CON}veyance<br/>Step-by-Step SOP</h1>
    <p class="sub">The process for any property in any state, in the order Bryan does the work. Every step: what to do, documents, done when. Part B maps one example property.</p>
  </div>
  <div class="meta">
    <div><strong>Example (Part B):</strong> 7137 E Rancho Vista Dr Unit 4011, Scottsdale AZ 85251</div>
    <div><strong>Generated:</strong> ${new Date().toISOString().slice(0, 10)}</div>
    <div><strong>Source:</strong> Bryan-Stay-Strong-Thinkific-Course-Export.zip (37-lesson main track + extra tracks) + case folders</div>
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
<title>Mortgage ReCONveyance SOP</title>
<style>${CSS}</style>
</head><body>
${coverHtml()}
<div class="page">
<h2>At a glance</h2>
${pipelineHtml()}
${body}
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
  if (process.argv.includes("--no-upload")) return;
  const uploaded = await driveUpload(PDF_PATH, PDF_NAME, "application/pdf");
  console.log("Drive upload OK:", uploaded.name);
  console.log(uploaded.webViewLink);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
